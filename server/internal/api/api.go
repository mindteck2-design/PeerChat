package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/lanmsg/server/internal/auth"
	"github.com/lanmsg/server/internal/chat"
	"github.com/lanmsg/server/internal/config"
	"github.com/lanmsg/server/internal/presence"
)

type Server struct {
	Cfg        config.Config
	Auth       *auth.Service
	Chat       *chat.Store
	Hub        *presence.Hub
	Fingerprint string
	DataDir    string
	upgrader   websocket.Upgrader
}

func New(cfg config.Config, a *auth.Service, c *chat.Store, h *presence.Hub, fp, dataDir string) *Server {
	return &Server{
		Cfg: cfg, Auth: a, Chat: c, Hub: h, Fingerprint: fp, DataDir: dataDir,
		upgrader: websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }},
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.health)
	mux.HandleFunc("GET /api/info", s.info)
	mux.HandleFunc("POST /api/auth/signup", s.signup)
	mux.HandleFunc("POST /api/auth/login", s.login)
	mux.HandleFunc("POST /api/auth/logout", s.auth(s.logout))
	mux.HandleFunc("GET /api/me", s.auth(s.me))
	mux.HandleFunc("PATCH /api/me", s.auth(s.patchMe))
	mux.HandleFunc("POST /api/me/password", s.auth(s.changePassword))
	mux.HandleFunc("GET /api/users", s.auth(s.users))
	mux.HandleFunc("GET /api/conversations", s.auth(s.listConvs))
	mux.HandleFunc("POST /api/conversations/dm", s.auth(s.openDM))
	mux.HandleFunc("POST /api/conversations/group", s.auth(s.createGroup))
	mux.HandleFunc("GET /api/conversations/{id}/messages", s.auth(s.listMessages))
	mux.HandleFunc("POST /api/conversations/{id}/messages", s.auth(s.sendMessage))
	mux.HandleFunc("GET /api/conversations/{id}/group-key", s.auth(s.groupKey))
	mux.HandleFunc("POST /api/conversations/{id}/group-key/rotate", s.auth(s.rotateGroupKey))
	mux.HandleFunc("GET /api/conversations/{id}/members", s.auth(s.members))
	mux.HandleFunc("POST /api/files", s.auth(s.createFile))
	mux.HandleFunc("GET /api/files/{id}", s.auth(s.getFile))
	mux.HandleFunc("POST /api/files/{id}/downloaded", s.auth(s.fileDownloaded))
	mux.HandleFunc("PUT /api/files/{id}/chunks/{index}", s.auth(s.putChunk))
	mux.HandleFunc("GET /api/files/{id}/chunks/{index}", s.auth(s.getChunk))
	mux.HandleFunc("GET /ws", s.ws)
	return withSecurityHeaders(mux)
}

// PurgeExpiredBlobs deletes staged ciphertext chunks when all members downloaded or TTL elapsed.
func (s *Server) PurgeExpiredBlobs() {
	ids, err := s.Chat.ListPurgeCandidates(context.Background())
	if err != nil {
		return
	}
	for _, id := range ids {
		s.purgeFileBlobs(id)
	}
}

func (s *Server) purgeFileBlobs(fileID string) {
	dir := filepath.Join(s.DataDir, "files", fileID)
	_ = os.RemoveAll(dir)
	_ = s.Chat.MarkPurged(context.Background(), fileID)
}

func withSecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (s *Server) bearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if strings.HasPrefix(h, "Bearer ") {
		return strings.TrimPrefix(h, "Bearer ")
	}
	return r.URL.Query().Get("token")
}

type authedFunc func(http.ResponseWriter, *http.Request, auth.User)

func (s *Server) auth(fn authedFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, err := s.Auth.Resolve(r.Context(), s.bearer(r))
		if err != nil {
			writeJSON(w, 401, map[string]string{"error": "unauthorized"})
			return
		}
		fn(w, r, u)
	}
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"ok": true, "profile": s.Cfg.Profile, "e2e": true})
}

func (s *Server) info(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{
		"profile": s.Cfg.Profile,
		"fingerprint": s.Fingerprint,
		"invite_required": s.Cfg.InviteRequired || (s.Cfg.Profile == "internet"),
		"port": s.Cfg.Port,
	})
}

func (s *Server) signup(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username      string `json:"username"`
		Password      string `json:"password"`
		DisplayName   string `json:"display_name"`
		X25519Public  string `json:"x25519_public"`
		Ed25519Public string `json:"ed25519_public"`
		Invite        string `json:"invite"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, map[string]string{"error": "bad json"})
		return
	}
	u, token, err := s.Auth.Signup(r.Context(), body.Username, body.Password, body.DisplayName, body.X25519Public, body.Ed25519Public, body.Invite)
	if err != nil {
		code := 400
		if errors.Is(err, auth.ErrUserExists) {
			code = 409
		}
		if errors.Is(err, auth.ErrInviteRequired) || errors.Is(err, auth.ErrInviteInvalid) {
			code = 403
		}
		writeJSON(w, code, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 201, map[string]any{"user": u, "token": token, "server_fingerprint": s.Fingerprint})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, map[string]string{"error": "bad json"})
		return
	}
	u, token, err := s.Auth.Login(r.Context(), clientIP(r), body.Username, body.Password)
	if err != nil {
		code := 401
		if errors.Is(err, auth.ErrRateLimited) {
			code = 429
		}
		writeJSON(w, code, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"user": u, "token": token, "server_fingerprint": s.Fingerprint})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request, _ auth.User) {
	s.Auth.Logout(r.Context(), s.bearer(r))
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) me(w http.ResponseWriter, r *http.Request, u auth.User) {
	writeJSON(w, 200, map[string]any{"user": u, "server_fingerprint": s.Fingerprint, "profile": s.Cfg.Profile})
}

func (s *Server) patchMe(w http.ResponseWriter, r *http.Request, u auth.User) {
	var body struct {
		DisplayName string `json:"display_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, map[string]string{"error": "bad json"})
		return
	}
	if err := s.Auth.UpdateProfile(r.Context(), u.ID, body.DisplayName); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	u.DisplayName = body.DisplayName
	writeJSON(w, 200, map[string]any{"user": u})
}

func (s *Server) changePassword(w http.ResponseWriter, r *http.Request, u auth.User) {
	var body struct {
		Old string `json:"old_password"`
		New string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, map[string]string{"error": "bad json"})
		return
	}
	if err := s.Auth.ChangePassword(r.Context(), u.ID, body.Old, body.New); err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "true", "note": "sessions revoked; login again"})
}

func (s *Server) users(w http.ResponseWriter, r *http.Request, u auth.User) {
	list, err := s.Auth.ListUsers(r.Context())
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	online := s.Hub.OnlineIDs()
	for i := range list {
		list[i].Online = online[list[i].ID]
		if list[i].ID == u.ID {
			list[i].Online = true
		}
	}
	writeJSON(w, 200, map[string]any{"users": list})
}

func (s *Server) listConvs(w http.ResponseWriter, r *http.Request, u auth.User) {
	list, err := s.Chat.ListConversations(r.Context(), u.ID)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"conversations": list})
}

func (s *Server) openDM(w http.ResponseWriter, r *http.Request, u auth.User) {
	var body struct {
		PeerID string `json:"peer_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.PeerID == "" {
		writeJSON(w, 400, map[string]string{"error": "peer_id required"})
		return
	}
	c, err := s.Chat.GetOrCreateDM(r.Context(), u.ID, body.PeerID)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"conversation": c})
}

func (s *Server) createGroup(w http.ResponseWriter, r *http.Request, u auth.User) {
	var body struct {
		Title   string            `json:"title"`
		Members []string          `json:"members"`
		Wraps   map[string]string `json:"wrapped_group_keys"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, map[string]string{"error": "bad json"})
		return
	}
	c, err := s.Chat.CreateGroup(r.Context(), u.ID, body.Title, body.Members, body.Wraps)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 201, map[string]any{"conversation": c})
}

func (s *Server) listMessages(w http.ResponseWriter, r *http.Request, u auth.User) {
	id := r.PathValue("id")
	msgs, err := s.Chat.ListMessages(r.Context(), id, u.ID, 300)
	if err != nil {
		writeJSON(w, 403, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"messages": msgs})
}

func (s *Server) sendMessage(w http.ResponseWriter, r *http.Request, u auth.User) {
	id := r.PathValue("id")
	var body struct {
		Kind        string          `json:"kind"`
		Ciphertext  string          `json:"ciphertext"`
		Nonce       string          `json:"nonce"`
		WrappedKeys json.RawMessage `json:"wrapped_keys"`
		Signature   string          `json:"signature"`
		FileID      *string         `json:"file_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, map[string]string{"error": "bad json"})
		return
	}
	if body.Kind == "" {
		body.Kind = "text"
	}
	m, err := s.Chat.AddMessage(r.Context(), id, u.ID, body.Kind, body.Ciphertext, body.Nonce, body.Signature, body.WrappedKeys, body.FileID)
	if err != nil {
		writeJSON(w, 403, map[string]string{"error": err.Error()})
		return
	}
	members, _ := s.Chat.MemberIDs(r.Context(), id)
	s.Hub.SendToUsers(members, map[string]any{"type": "message", "message": m})
	writeJSON(w, 201, map[string]any{"message": m})
}

func (s *Server) groupKey(w http.ResponseWriter, r *http.Request, u auth.User) {
	id := r.PathValue("id")
	k, err := s.Chat.GetWrappedGroupKey(r.Context(), id, u.ID)
	if err != nil {
		writeJSON(w, 403, map[string]string{"error": "forbidden"})
		return
	}
	writeJSON(w, 200, map[string]any{"wrapped_group_key": k})
}

func (s *Server) members(w http.ResponseWriter, r *http.Request, u auth.User) {
	list, err := s.Chat.ListMembers(r.Context(), r.PathValue("id"), u.ID)
	if err != nil {
		writeJSON(w, 403, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"members": list})
}

func (s *Server) rotateGroupKey(w http.ResponseWriter, r *http.Request, u auth.User) {
	var body struct {
		Wraps map[string]string `json:"wrapped_group_keys"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Wraps) == 0 {
		writeJSON(w, 400, map[string]string{"error": "wrapped_group_keys required"})
		return
	}
	if err := s.Chat.RotateGroupKeys(r.Context(), r.PathValue("id"), u.ID, body.Wraps); err != nil {
		writeJSON(w, 403, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) createFile(w http.ResponseWriter, r *http.Request, u auth.User) {
	var body struct {
		ConversationID string          `json:"conversation_id"`
		EncFilename    string          `json:"enc_filename"`
		FilenameNonce  string          `json:"filename_nonce"`
		SizeBytes      int64           `json:"size_bytes"`
		ChunkCount     int             `json:"chunk_count"`
		WrappedKeys    json.RawMessage `json:"wrapped_keys"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, map[string]string{"error": "bad json"})
		return
	}
	max := int64(s.Cfg.MaxUploadMB) * 1024 * 1024
	if body.SizeBytes <= 0 || body.SizeBytes > max || body.ChunkCount <= 0 {
		writeJSON(w, 400, map[string]string{"error": "invalid size"})
		return
	}
	id, err := s.Chat.CreateFile(r.Context(), body.ConversationID, u.ID, body.EncFilename, body.FilenameNonce, body.SizeBytes, body.ChunkCount, body.WrappedKeys, s.Cfg.FileRetentionHours)
	if err != nil {
		writeJSON(w, 403, map[string]string{"error": err.Error()})
		return
	}
	dir := filepath.Join(s.DataDir, "files", id)
	_ = os.MkdirAll(dir, 0o700)
	writeJSON(w, 201, map[string]any{"file_id": id})
}

func (s *Server) fileDownloaded(w http.ResponseWriter, r *http.Request, u auth.User) {
	fileID := r.PathValue("id")
	if err := s.Chat.MarkDownloaded(r.Context(), fileID, u.ID); err != nil {
		writeJSON(w, 403, map[string]string{"error": err.Error()})
		return
	}
	purge, _ := s.Chat.ShouldPurgeBlobs(r.Context(), fileID)
	if purge {
		s.purgeFileBlobs(fileID)
	}
	writeJSON(w, 200, map[string]any{"ok": true, "purged": purge})
}

func (s *Server) getFile(w http.ResponseWriter, r *http.Request, u auth.User) {
	meta, err := s.Chat.GetFile(r.Context(), r.PathValue("id"), u.ID)
	if err != nil {
		writeJSON(w, 403, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"file": meta})
}

func safeIndex(idx string) (int, bool) {
	n, err := strconv.Atoi(idx)
	if err != nil || n < 0 || n > 1_000_000 {
		return 0, false
	}
	return n, true
}

func (s *Server) chunkPath(fileID string, index int) (string, error) {
	if strings.Contains(fileID, "..") || strings.Contains(fileID, "/") || strings.Contains(fileID, "\\") {
		return "", errors.New("bad id")
	}
	dir := filepath.Join(s.DataDir, "files", fileID)
	return filepath.Join(dir, strconv.Itoa(index)+".chunk"), nil
}

func (s *Server) putChunk(w http.ResponseWriter, r *http.Request, u auth.User) {
	fileID := r.PathValue("id")
	idx, ok := safeIndex(r.PathValue("index"))
	if !ok {
		writeJSON(w, 400, map[string]string{"error": "bad index"})
		return
	}
	meta, err := s.Chat.GetFile(r.Context(), fileID, u.ID)
	if err != nil {
		writeJSON(w, 403, map[string]string{"error": "forbidden"})
		return
	}
	if purged, _ := meta["purged"].(bool); purged {
		writeJSON(w, 410, map[string]string{"error": "file staging expired"})
		return
	}
	path, err := s.chunkPath(fileID, idx)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "bad id"})
		return
	}
	_ = os.MkdirAll(filepath.Dir(path), 0o700)
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer f.Close()
	limited := io.LimitReader(r.Body, 2<<20) // 2MiB max per chunk ciphertext
	if _, err := io.Copy(f, limited); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	if iv := r.Header.Get("X-Chunk-Nonce"); iv != "" {
		_ = os.WriteFile(path+".nonce", []byte(iv), 0o600)
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) getChunk(w http.ResponseWriter, r *http.Request, u auth.User) {
	fileID := r.PathValue("id")
	idx, ok := safeIndex(r.PathValue("index"))
	if !ok {
		writeJSON(w, 400, map[string]string{"error": "bad index"})
		return
	}
	meta, err := s.Chat.GetFile(r.Context(), fileID, u.ID)
	if err != nil {
		writeJSON(w, 403, map[string]string{"error": "forbidden"})
		return
	}
	if purged, _ := meta["purged"].(bool); purged {
		writeJSON(w, 410, map[string]string{"error": "file staging expired; ask sender to re-share"})
		return
	}
	path, err := s.chunkPath(fileID, idx)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "bad id"})
		return
	}
	b, err := os.ReadFile(path)
	if err != nil {
		writeJSON(w, 404, map[string]string{"error": "missing chunk"})
		return
	}
	if nb, err := os.ReadFile(path + ".nonce"); err == nil {
		w.Header().Set("X-Chunk-Nonce", string(nb))
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.WriteHeader(200)
	_, _ = w.Write(b)
}

func (s *Server) ws(w http.ResponseWriter, r *http.Request) {
	u, err := s.Auth.Resolve(r.Context(), s.bearer(r))
	if err != nil {
		http.Error(w, "unauthorized", 401)
		return
	}
	c, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	s.Hub.Add(u.ID, c)
	s.Hub.Broadcast(map[string]any{"type": "presence", "online": s.Hub.OnlineIDs()}, "")
	defer func() {
		s.Hub.Remove(u.ID, c)
		_ = c.Close()
		s.Hub.Broadcast(map[string]any{"type": "presence", "online": s.Hub.OnlineIDs()}, "")
	}()
	for {
		var msg map[string]any
		if err := c.ReadJSON(&msg); err != nil {
			return
		}
		if msg["type"] == "ping" {
			_ = c.WriteJSON(map[string]any{"type": "pong", "t": time.Now().Unix()})
		}
	}
}
