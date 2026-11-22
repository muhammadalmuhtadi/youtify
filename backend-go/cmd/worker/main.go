package main

import (
	"database/sql"
	"log"
	"strings"

	"github.com/syumai/workers-go"
	"github.com/syumai/workers-go/cloudflare"
	_ "github.com/syumai/workers-go/cloudflare/d1"
	"github.com/syumai/workers-go/cloudflare/kv"
	"github.com/younamp/backend-go/internal/httpapi"
	"github.com/younamp/backend-go/internal/store"
)

func main() {
	db, err := sql.Open("d1", "YOUNAMP_DB")
	if err != nil {
		log.Fatalf("failed to open D1 database YOUNAMP_DB: %v", err)
	}

	kvNs, err := kv.NewNamespace("YT_SESSIONS")
	if err != nil {
		log.Printf("YT_SESSIONS KV binding not available: %v", err)
	}

	rawOrigins := cloudflare.Getenv("ALLOWED_ORIGINS")
	var origins []string
	if rawOrigins != "" {
		origins = strings.Split(rawOrigins, ",")
	}

	repo := store.NewD1Store(db, store.NewWorkersKV(kvNs))
	workers.Serve(httpapi.NewRouter(repo, origins))
}
