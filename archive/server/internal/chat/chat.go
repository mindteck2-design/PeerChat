package chat

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Conversation struct {
	ID        string  `json:"id"`
	Kind      string  `json:"kind"`
	Title     *string `json:"title,omitempty"`
	CreatedAt string  `json:"created_at"`
	PeerID    string  `json:"peer_id,omitempty"`
	PeerName  string  `json:"peer_name,omitempty"`
}

type Message struct {
	ID             string          `json:"id"`
	ConversationID string          `json:"conversation_id"`
	SenderID       string          `json:"sender_id"`
	Kind           string          `json:"kind"`
	Ciphertext     string          `json:"ciphertext"`
	Nonce          string          `json:"nonce"`
	WrappedKeys    json.RawMessage `json:"wrapped_keys"`
	Signature      string          `json:"signature"`
	FileID         *string         `json:"file_id,omitempty"`
	CreatedAt      string          `json:"created_at"`
}

type Store struct {
	Pool *pgxpool.Pool
}

func (s *Store) IsMember(ctx context.Context, convID, userID string) (bool, error) {
	var n int
	err := s.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM conversation_members
		WHERE conversation_id = $1::uuid AND user_id = $2::uuid
	`, convID, userID).Scan(&n)
	return n > 0, err
}

func (s *Store) MemberIDs(ctx context.Context, convID string) ([]string, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT user_id::text FROM conversation_members WHERE conversation_id = $1::uuid
	`, convID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (s *Store) GetOrCreateDM(ctx context.Context, a, b string) (Conversation, error) {
	var id string
	err := s.Pool.QueryRow(ctx, `
		SELECT c.id::text FROM conversations c
		JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = $1::uuid
		JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = $2::uuid
		WHERE c.kind = 'dm'
		LIMIT 1
	`, a, b).Scan(&id)
	if err == nil {
		return s.getConv(ctx, id, a)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Conversation{}, err
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Conversation{}, err
	}
	defer tx.Rollback(ctx)
	err = tx.QueryRow(ctx, `
		INSERT INTO conversations(kind, created_by) VALUES ('dm', $1::uuid) RETURNING id::text
	`, a).Scan(&id)
	if err != nil {
		return Conversation{}, err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO conversation_members(conversation_id, user_id) VALUES ($1::uuid, $2::uuid), ($1::uuid, $3::uuid)
	`, id, a, b)
	if err != nil {
		return Conversation{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Conversation{}, err
	}
	return s.getConv(ctx, id, a)
}

func (s *Store) CreateGroup(ctx context.Context, creatorID, title string, memberIDs []string, wraps map[string]string) (Conversation, error) {
	title = strings.TrimSpace(title)
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Conversation{}, err
	}
	defer tx.Rollback(ctx)
	var id string
	err = tx.QueryRow(ctx, `
		INSERT INTO conversations(kind, title, created_by) VALUES ('group', $1, $2::uuid) RETURNING id::text
	`, title, creatorID).Scan(&id)
	if err != nil {
		return Conversation{}, err
	}
	set := map[string]bool{creatorID: true}
	for _, m := range memberIDs {
		set[m] = true
	}
	for uid := range set {
		_, err = tx.Exec(ctx, `
			INSERT INTO conversation_members(conversation_id, user_id, wrapped_group_key)
			VALUES ($1::uuid, $2::uuid, $3)
		`, id, uid, wraps[uid])
		if err != nil {
			return Conversation{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return Conversation{}, err
	}
	return s.getConv(ctx, id, creatorID)
}

func (s *Store) ListConversations(ctx context.Context, userID string) ([]Conversation, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT c.id::text, c.kind, c.title, c.created_at::text
		FROM conversations c
		JOIN conversation_members m ON m.conversation_id = c.id
		WHERE m.user_id = $1::uuid
		ORDER BY c.created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Conversation
	for rows.Next() {
		var c Conversation
		if err := rows.Scan(&c.ID, &c.Kind, &c.Title, &c.CreatedAt); err != nil {
			return nil, err
		}
		if c.Kind == "dm" {
			_ = s.Pool.QueryRow(ctx, `
				SELECT u.id::text, u.display_name FROM conversation_members m
				JOIN users u ON u.id = m.user_id
				WHERE m.conversation_id = $1::uuid AND m.user_id <> $2::uuid
				LIMIT 1
			`, c.ID, userID).Scan(&c.PeerID, &c.PeerName)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) getConv(ctx context.Context, id, viewer string) (Conversation, error) {
	var c Conversation
	err := s.Pool.QueryRow(ctx, `
		SELECT id::text, kind, title, created_at::text FROM conversations WHERE id = $1::uuid
	`, id).Scan(&c.ID, &c.Kind, &c.Title, &c.CreatedAt)
	if err != nil {
		return c, err
	}
	if c.Kind == "dm" {
		_ = s.Pool.QueryRow(ctx, `
			SELECT u.id::text, u.display_name FROM conversation_members m
			JOIN users u ON u.id = m.user_id
			WHERE m.conversation_id = $1::uuid AND m.user_id <> $2::uuid LIMIT 1
		`, id, viewer).Scan(&c.PeerID, &c.PeerName)
	}
	return c, nil
}

func (s *Store) AddMessage(ctx context.Context, convID, senderID, kind, ciphertext, nonce, signature string, wraps json.RawMessage, fileID *string) (Message, error) {
	ok, err := s.IsMember(ctx, convID, senderID)
	if err != nil {
		return Message{}, err
	}
	if !ok {
		return Message{}, errors.New("forbidden")
	}
	if wraps == nil {
		wraps = json.RawMessage(`{}`)
	}
	var m Message
	err = s.Pool.QueryRow(ctx, `
		INSERT INTO messages(conversation_id, sender_id, kind, ciphertext, nonce, wrapped_keys, signature, file_id)
		VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb, $7, $8)
		RETURNING id::text, conversation_id::text, sender_id::text, kind, ciphertext, nonce, wrapped_keys, signature, file_id::text, created_at::text
	`, convID, senderID, kind, ciphertext, nonce, string(wraps), signature, fileID).Scan(
		&m.ID, &m.ConversationID, &m.SenderID, &m.Kind, &m.Ciphertext, &m.Nonce, &m.WrappedKeys, &m.Signature, &m.FileID, &m.CreatedAt,
	)
	return m, err
}

func (s *Store) ListMessages(ctx context.Context, convID, userID string, limit int) ([]Message, error) {
	ok, err := s.IsMember(ctx, convID, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, errors.New("forbidden")
	}
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT id::text, conversation_id::text, sender_id::text, kind, ciphertext, nonce, wrapped_keys, signature, file_id::text, created_at::text
		FROM messages WHERE conversation_id = $1::uuid
		ORDER BY created_at ASC
		LIMIT $2
	`, convID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Message
	for rows.Next() {
		var m Message
		if err := rows.Scan(&m.ID, &m.ConversationID, &m.SenderID, &m.Kind, &m.Ciphertext, &m.Nonce, &m.WrappedKeys, &m.Signature, &m.FileID, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Store) CreateFile(ctx context.Context, convID, uploaderID, encName, nameNonce string, size int64, chunks int, wraps json.RawMessage, retentionHours int) (string, error) {
	ok, err := s.IsMember(ctx, convID, uploaderID)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", errors.New("forbidden")
	}
	if wraps == nil {
		wraps = json.RawMessage(`{}`)
	}
	if retentionHours <= 0 {
		retentionHours = 168
	}
	var id string
	err = s.Pool.QueryRow(ctx, `
		INSERT INTO files(conversation_id, uploader_id, enc_filename, filename_nonce, size_bytes, chunk_count, wrapped_keys, expires_at)
		VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb, now() + ($8 * interval '1 hour'))
		RETURNING id::text
	`, convID, uploaderID, encName, nameNonce, size, chunks, string(wraps), retentionHours).Scan(&id)
	return id, err
}

func (s *Store) GetFile(ctx context.Context, fileID, userID string) (map[string]any, error) {
	var convID, uploader, encName, nameNonce string
	var size int64
	var chunks int
	var wraps []byte
	var purged *string
	err := s.Pool.QueryRow(ctx, `
		SELECT conversation_id::text, uploader_id::text, enc_filename, filename_nonce, size_bytes, chunk_count, wrapped_keys, purged_at::text
		FROM files WHERE id = $1::uuid
	`, fileID).Scan(&convID, &uploader, &encName, &nameNonce, &size, &chunks, &wraps, &purged)
	if err != nil {
		return nil, err
	}
	ok, err := s.IsMember(ctx, convID, userID)
	if err != nil || !ok {
		return nil, errors.New("forbidden")
	}
	return map[string]any{
		"id": fileID, "conversation_id": convID, "uploader_id": uploader,
		"enc_filename": encName, "filename_nonce": nameNonce,
		"size_bytes": size, "chunk_count": chunks, "wrapped_keys": json.RawMessage(wraps),
		"purged": purged != nil,
	}, nil
}

func (s *Store) MarkDownloaded(ctx context.Context, fileID, userID string) error {
	meta, err := s.GetFile(ctx, fileID, userID)
	if err != nil {
		return err
	}
	_ = meta
	_, err = s.Pool.Exec(ctx, `
		INSERT INTO file_downloads(file_id, user_id) VALUES ($1::uuid, $2::uuid)
		ON CONFLICT DO NOTHING
	`, fileID, userID)
	return err
}

func (s *Store) ShouldPurgeBlobs(ctx context.Context, fileID string) (bool, error) {
	var members, downloads int
	var expired bool
	var purged *string
	err := s.Pool.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*) FROM conversation_members cm JOIN files f ON f.conversation_id = cm.conversation_id WHERE f.id = $1::uuid),
			(SELECT COUNT(*) FROM file_downloads WHERE file_id = $1::uuid),
			EXISTS(SELECT 1 FROM files WHERE id = $1::uuid AND expires_at IS NOT NULL AND expires_at < now()),
			(SELECT purged_at::text FROM files WHERE id = $1::uuid)
	`, fileID).Scan(&members, &downloads, &expired, &purged)
	if err != nil {
		return false, err
	}
	if purged != nil {
		return false, nil
	}
	if expired {
		return true, nil
	}
	return members > 0 && downloads >= members, nil
}

func (s *Store) MarkPurged(ctx context.Context, fileID string) error {
	_, err := s.Pool.Exec(ctx, `UPDATE files SET purged_at = now() WHERE id = $1::uuid AND purged_at IS NULL`, fileID)
	return err
}

func (s *Store) ListPurgeCandidates(ctx context.Context) ([]string, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT f.id::text FROM files f
		WHERE f.purged_at IS NULL AND (
			(f.expires_at IS NOT NULL AND f.expires_at < now())
			OR (
				(SELECT COUNT(*) FROM file_downloads d WHERE d.file_id = f.id)
				>= (SELECT COUNT(*) FROM conversation_members m WHERE m.conversation_id = f.conversation_id)
			)
		)
		LIMIT 200
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (s *Store) ListMembers(ctx context.Context, convID, userID string) ([]map[string]string, error) {
	ok, err := s.IsMember(ctx, convID, userID)
	if err != nil || !ok {
		return nil, errors.New("forbidden")
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT u.id::text, u.username, u.display_name, u.x25519_public, u.ed25519_public
		FROM conversation_members m
		JOIN users u ON u.id = m.user_id
		WHERE m.conversation_id = $1::uuid
		ORDER BY u.display_name
	`, convID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]string
	for rows.Next() {
		var id, username, display, x, e string
		if err := rows.Scan(&id, &username, &display, &x, &e); err != nil {
			return nil, err
		}
		out = append(out, map[string]string{
			"id": id, "username": username, "display_name": display,
			"x25519_public": x, "ed25519_public": e,
		})
	}
	return out, rows.Err()
}

func (s *Store) GetWrappedGroupKey(ctx context.Context, convID, userID string) (string, error) {
	var w *string
	err := s.Pool.QueryRow(ctx, `
		SELECT wrapped_group_key FROM conversation_members
		WHERE conversation_id = $1::uuid AND user_id = $2::uuid
	`, convID, userID).Scan(&w)
	if err != nil {
		return "", err
	}
	if w == nil {
		return "", nil
	}
	return *w, nil
}

// RotateGroupKeys replaces wrapped group keys for all members (caller encrypts new key).
func (s *Store) RotateGroupKeys(ctx context.Context, convID, actorID string, wraps map[string]string) error {
	ok, err := s.IsMember(ctx, convID, actorID)
	if err != nil || !ok {
		return errors.New("forbidden")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	for uid, wrap := range wraps {
		tag, err := tx.Exec(ctx, `
			UPDATE conversation_members SET wrapped_group_key = $3
			WHERE conversation_id = $1::uuid AND user_id = $2::uuid
		`, convID, uid, wrap)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return errors.New("member missing for wrap: " + uid)
		}
	}
	return tx.Commit(ctx)
}
