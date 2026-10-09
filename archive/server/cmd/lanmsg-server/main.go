package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/lanmsg/server/internal/api"
	"github.com/lanmsg/server/internal/auth"
	"github.com/lanmsg/server/internal/chat"
	"github.com/lanmsg/server/internal/config"
	"github.com/lanmsg/server/internal/db"
	"github.com/lanmsg/server/internal/discovery"
	"github.com/lanmsg/server/internal/presence"
	"github.com/lanmsg/server/internal/tlsutil"
)

func main() {
	cfgPath := flag.String("config", "config.json", "path to config.json")
	flag.Parse()

	cfg, err := config.Load(*cfgPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	if v := os.Getenv("DATABASE_URL"); v != "" {
		cfg.DatabaseURL = v
	}
	if v := os.Getenv("LANMSG_PROFILE"); v != "" {
		cfg.Profile = v
	}

	_ = os.MkdirAll(cfg.DataDir, 0o700)
	ctx := context.Background()
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("database: %v\nSet database_url in config.json or DATABASE_URL env.\nExample: postgres://lanmsg:pass@127.0.0.1:5432/lanmsg?sslmode=disable", err)
	}
	defer pool.Close()

	certFile, keyFile, fp, err := tlsutil.Ensure(cfg.DataDir, cfg.TLSCert, cfg.TLSKey)
	if err != nil {
		log.Fatalf("tls: %v", err)
	}

	authSvc := &auth.Service{
		Pool:            pool,
		InviteRequired:  cfg.InviteRequired || cfg.Profile == "internet",
		InviteCode:      cfg.InviteCode,
		SessionIdle:     time.Duration(cfg.SessionIdleHours) * time.Hour,
		SessionMax:      time.Duration(cfg.SessionMaxHours) * time.Hour,
		InternetProfile: cfg.Profile == "internet",
	}
	if authSvc.SessionIdle == 0 {
		authSvc.SessionIdle = 12 * time.Hour
	}
	if authSvc.SessionMax == 0 {
		authSvc.SessionMax = 72 * time.Hour
	}

	hub := presence.New()
	chatStore := &chat.Store{Pool: pool}
	apiSrv := api.New(cfg, authSvc, chatStore, hub, fp, cfg.DataDir)

	stopDisco := make(chan struct{})
	discovery.Start(cfg.DiscoveryPort, cfg.Port, fp, cfg.Profile, stopDisco)
	defer close(stopDisco)

	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	httpSrv := &http.Server{
		Addr:              addr,
		Handler:           apiSrv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("LanMsg server starting profile=%s https://%s fingerprint=%s", cfg.Profile, addr, fp)
		log.Printf("UDP discovery on %d; data dir %s", cfg.DiscoveryPort, filepath.Clean(cfg.DataDir))
		if err := httpSrv.ListenAndServeTLS(certFile, keyFile); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	go func() {
		t := time.NewTicker(15 * time.Minute)
		defer t.Stop()
		for {
			apiSrv.PurgeExpiredBlobs()
			select {
			case <-t.C:
			case <-stopDisco:
				return
			}
		}
	}()

	ch := make(chan os.Signal, 1)
	signal.Notify(ch, os.Interrupt, syscall.SIGTERM)
	<-ch
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(shutdownCtx)
}
