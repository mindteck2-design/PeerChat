package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type Config struct {
	Profile          string `json:"profile"` // intranet | internet
	Host             string `json:"host"`
	Port             int    `json:"port"`
	DiscoveryPort    int    `json:"discovery_port"`
	DatabaseURL      string `json:"database_url"`
	DataDir          string `json:"data_dir"`
	InviteRequired   bool   `json:"invite_required"`
	InviteCode       string `json:"invite_code"`
	SessionIdleHours int    `json:"session_idle_hours"`
	SessionMaxHours  int    `json:"session_max_hours"`
	MaxUploadMB          int    `json:"max_upload_mb"`
	FileRetentionHours   int    `json:"file_retention_hours"`
	TLSCert              string `json:"tls_cert"`
	TLSKey               string `json:"tls_key"`
}

func Defaults() Config {
	return Config{
		Profile:          "intranet",
		Host:             "0.0.0.0",
		Port:             8765,
		DiscoveryPort:    41234,
		DatabaseURL:      "postgres://lanmsg:lanmsg@127.0.0.1:5432/lanmsg?sslmode=disable",
		DataDir:          "./data",
		InviteRequired:   false,
		SessionIdleHours: 12,
		SessionMaxHours:  72,
		MaxUploadMB:        2048,
		FileRetentionHours: 168, // 7 days staging on server
	}
}

func Load(path string) (Config, error) {
	cfg := Defaults()
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			_ = Save(path, cfg)
			return applyProfile(cfg), nil
		}
		return cfg, err
	}
	if err := json.Unmarshal(b, &cfg); err != nil {
		return cfg, err
	}
	return applyProfile(cfg), nil
}

func applyProfile(cfg Config) Config {
	if cfg.Profile == "internet" && !cfg.InviteRequired && cfg.InviteCode == "" {
		cfg.InviteRequired = true
	}
	if cfg.Port == 0 {
		cfg.Port = 8765
	}
	if cfg.DiscoveryPort == 0 {
		cfg.DiscoveryPort = 41234
	}
	if cfg.DataDir == "" {
		cfg.DataDir = "./data"
	}
	if cfg.MaxUploadMB == 0 {
		cfg.MaxUploadMB = 2048
	}
	if cfg.FileRetentionHours == 0 {
		cfg.FileRetentionHours = 168
	}
	return cfg
}

func Save(path string, cfg Config) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil && filepath.Dir(path) != "." {
		// ok if dir is .
	}
	b, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o600)
}
