package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/argon2"
)

var (
	ErrInvalidCreds   = errors.New("invalid username or password")
	ErrRateLimited    = errors.New("too many login attempts; try again later")
	ErrInviteRequired = errors.New("invite code required")
	ErrInviteInvalid  = errors.New("invalid invite code")
	ErrUserExists     = errors.New("username already taken")
	ErrUnauthorized   = errors.New("unauthorized")
)

type User struct {
	ID            string `json:"id"`
	Username      string `json:"username"`
	DisplayName   string `json:"display_name"`
	X25519Public  string `json:"x25519_public"`
	Ed25519Public string `json:"ed25519_public"`
	Online        bool   `json:"online,omitempty"`
}

type Service struct {
	Pool             *pgxpool.Pool
	InviteRequired   bool
	InviteCode       string
	SessionIdle      time.Duration
	SessionMax       time.Duration
	InternetProfile  bool
}

func HashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	// Argon2id OWASP-ish params
	hash := argon2.IDKey([]byte(password), salt, 3, 64*1024, 4, 32)
	return "argon2id$v=19$m=65536,t=3,p=4$" +
		base64.RawStdEncoding.EncodeToString(salt) + "$" +
		base64.RawStdEncoding.EncodeToString(hash), nil
}

func VerifyPassword(encoded, password string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 5 || parts[0] != "argon2id" {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, 3, 64*1024, 4, 32)
	if len(got) != len(want) {
		return false
	}
	var v byte
	for i := range got {
		v |= got[i] ^ want[i]
	}
	return v == 0
}

func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func NewToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func (s *Service) CheckRateLimit(ctx context.Context, ip, username string) error {
	window := 15 * time.Minute
	maxFails := 10
	if s.InternetProfile {
		maxFails = 5
	}
	var n int
	_ = window
	err := s.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM login_attempts
		WHERE ok = false AND created_at > now() - interval '15 minutes'
		  AND (ip = $1 OR username = $2)
	`, ip, strings.ToLower(username)).Scan(&n)
	if err != nil {
		return err
	}
	if n >= maxFails {
		return ErrRateLimited
	}
	return nil
}

func (s *Service) RecordAttempt(ctx context.Context, ip, username string, ok bool) {
	_, _ = s.Pool.Exec(ctx, `INSERT INTO login_attempts(ip, username, ok) VALUES ($1,$2,$3)`,
		ip, strings.ToLower(username), ok)
}

func (s *Service) Signup(ctx context.Context, username, password, displayName, x25519Pub, ed25519Pub, invite string) (User, string, error) {
	username = strings.TrimSpace(strings.ToLower(username))
	displayName = strings.TrimSpace(displayName)
	if username == "" || password == "" || displayName == "" || x25519Pub == "" || ed25519Pub == "" {
		return User{}, "", errors.New("missing fields")
	}
	if s.InviteRequired {
		if invite == "" {
			return User{}, "", ErrInviteRequired
		}
		if invite != s.InviteCode {
			return User{}, "", ErrInviteInvalid
		}
	}
	hash, err := HashPassword(password)
	if err != nil {
		return User{}, "", err
	}
	var u User
	err = s.Pool.QueryRow(ctx, `
		INSERT INTO users(username, display_name, password_hash, x25519_public, ed25519_public)
		VALUES ($1,$2,$3,$4,$5)
		RETURNING id::text, username, display_name, x25519_public, ed25519_public
	`, username, displayName, hash, x25519Pub, ed25519Pub).Scan(
		&u.ID, &u.Username, &u.DisplayName, &u.X25519Public, &u.Ed25519Public,
	)
	if err != nil {
		if strings.Contains(err.Error(), "unique") || strings.Contains(err.Error(), "duplicate") {
			return User{}, "", ErrUserExists
		}
		return User{}, "", err
	}
	token, err := s.createSession(ctx, u.ID)
	return u, token, err
}

func (s *Service) Login(ctx context.Context, ip, username, password string) (User, string, error) {
	username = strings.TrimSpace(strings.ToLower(username))
	if err := s.CheckRateLimit(ctx, ip, username); err != nil {
		return User{}, "", err
	}
	var u User
	var hash string
	err := s.Pool.QueryRow(ctx, `
		SELECT id::text, username, display_name, password_hash, x25519_public, ed25519_public
		FROM users WHERE username = $1
	`, username).Scan(&u.ID, &u.Username, &u.DisplayName, &hash, &u.X25519Public, &u.Ed25519Public)
	if err != nil {
		s.RecordAttempt(ctx, ip, username, false)
		if errors.Is(err, pgx.ErrNoRows) {
			return User{}, "", ErrInvalidCreds
		}
		return User{}, "", err
	}
	if !VerifyPassword(hash, password) {
		s.RecordAttempt(ctx, ip, username, false)
		return User{}, "", ErrInvalidCreds
	}
	s.RecordAttempt(ctx, ip, username, true)
	token, err := s.createSession(ctx, u.ID)
	return u, token, err
}

func (s *Service) createSession(ctx context.Context, userID string) (string, error) {
	token, err := NewToken()
	if err != nil {
		return "", err
	}
	th := HashToken(token)
	expires := time.Now().Add(s.SessionMax)
	_, err = s.Pool.Exec(ctx, `
		INSERT INTO sessions(user_id, token_hash, expires_at) VALUES ($1::uuid, $2, $3)
	`, userID, th, expires)
	return token, err
}

func (s *Service) Resolve(ctx context.Context, token string) (User, error) {
	if token == "" {
		return User{}, ErrUnauthorized
	}
	th := HashToken(token)
	var u User
	var expires, lastSeen time.Time
	err := s.Pool.QueryRow(ctx, `
		SELECT u.id::text, u.username, u.display_name, u.x25519_public, u.ed25519_public,
		       s.expires_at, s.last_seen_at
		FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = $1
	`, th).Scan(&u.ID, &u.Username, &u.DisplayName, &u.X25519Public, &u.Ed25519Public, &expires, &lastSeen)
	if err != nil {
		return User{}, ErrUnauthorized
	}
	now := time.Now()
	if now.After(expires) || now.After(lastSeen.Add(s.SessionIdle)) {
		_, _ = s.Pool.Exec(ctx, `DELETE FROM sessions WHERE token_hash = $1`, th)
		return User{}, ErrUnauthorized
	}
	_, _ = s.Pool.Exec(ctx, `UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1`, th)
	return u, nil
}

func (s *Service) Logout(ctx context.Context, token string) {
	_, _ = s.Pool.Exec(ctx, `DELETE FROM sessions WHERE token_hash = $1`, HashToken(token))
}

func (s *Service) LogoutAll(ctx context.Context, userID string) {
	_, _ = s.Pool.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1::uuid`, userID)
}

func (s *Service) UpdateProfile(ctx context.Context, userID, displayName string) error {
	_, err := s.Pool.Exec(ctx, `
		UPDATE users SET display_name = $2, updated_at = now() WHERE id = $1::uuid
	`, userID, strings.TrimSpace(displayName))
	return err
}

func (s *Service) ChangePassword(ctx context.Context, userID, oldPass, newPass string) error {
	var hash string
	err := s.Pool.QueryRow(ctx, `SELECT password_hash FROM users WHERE id = $1::uuid`, userID).Scan(&hash)
	if err != nil {
		return err
	}
	if !VerifyPassword(hash, oldPass) {
		return ErrInvalidCreds
	}
	nh, err := HashPassword(newPass)
	if err != nil {
		return err
	}
	_, err = s.Pool.Exec(ctx, `UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1::uuid`, userID, nh)
	if err != nil {
		return err
	}
	s.LogoutAll(ctx, userID)
	return nil
}

func (s *Service) ListUsers(ctx context.Context) ([]User, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id::text, username, display_name, x25519_public, ed25519_public
		FROM users ORDER BY display_name
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Username, &u.DisplayName, &u.X25519Public, &u.Ed25519Public); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}
