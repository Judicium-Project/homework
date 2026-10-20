//go:build integration

// Docker'daki yerel PG ister: `go test -tags integration ./internal/platform/db/`
// (bin/chatapp-dev ya da docker compose -p chatapp ... up). Ayrı bir veritabanı kullanır.
package db

import (
	"context"
	"io"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestMigrateUpDownUp(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	admin := os.Getenv("CHATAPP_TEST_ADMIN_URL")
	if admin == "" {
		admin = "postgres://chatapp@127.0.0.1:54320/chatapp?sslmode=disable"
	}
	conn, err := pgx.Connect(ctx, admin)
	if err != nil {
		t.Fatalf("PG yok (compose açık mı?): %v", err)
	}
	defer conn.Close(ctx)
	_, _ = conn.Exec(ctx, "DROP DATABASE IF EXISTS chatapp_migrate_test")
	if _, err := conn.Exec(ctx, "CREATE DATABASE chatapp_migrate_test"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		c, err := pgx.Connect(context.Background(), admin)
		if err == nil {
			_, _ = c.Exec(context.Background(), "DROP DATABASE IF EXISTS chatapp_migrate_test WITH (FORCE)")
			_ = c.Close(context.Background())
		}
	})

	pool, err := Open(ctx, "postgres://chatapp@127.0.0.1:54320/chatapp_migrate_test?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	for _, step := range []MigrateCommand{MigrateUp, MigrateReset, MigrateUp} {
		if err := Migrate(ctx, pool, step, io.Discard, log); err != nil {
			t.Fatalf("%s: %v", step, err)
		}
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> 'goose_db_version'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 32 { // 00004: auth_tokens, 00005: connection_log, 00006: instance_settings, instance_audit_log, 00008: error_group, error_event, 00009: media_session, media_sample, sys_sample, sys_hourly, sys_daily, media_daily, 00010: admin_report
		t.Fatalf("tablo sayısı %d, beklenen 32", n)
	}
}
