package httpapi

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strings"

	"github.com/younamp/backend-go/internal/models"
	"github.com/younamp/backend-go/internal/store"
	"github.com/younamp/backend-go/internal/youtube"
)

func NewRouter(repo store.Repository, allowedOrigins []string) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"runtime": "go-cloudflare-worker",
		})
	})

	// Auth & Session Bridge
	mux.HandleFunc("GET /api/auth/session", func(w http.ResponseWriter, r *http.Request) {
		payload, err := repo.GetSession(r.Context())
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, payload)
	})

	mux.HandleFunc("POST /api/auth/youtube/login", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Identifier string `json:"identifier"`
		}
		_ = decodeJSON(r, &body)
		resp, err := repo.SyncYouTubePlaylists(r.Context())
		if err != nil {
			writeStoreError(w, err)
			return
		}
		idTrimmed := strings.TrimSpace(body.Identifier)
		if idTrimmed != "" && !strings.Contains(idTrimmed, "@gmail.com") && (strings.HasPrefix(idTrimmed, "@") || strings.HasPrefix(idTrimmed, "http")) && (resp.ActiveUser == nil || !strings.EqualFold(idTrimmed, resp.ActiveUser.Handle)) {
			if _, impErr := repo.ImportPublicYouTube(r.Context(), idTrimmed); impErr == nil {
				if pls, lErr := repo.ListPlaylists(r.Context()); lErr == nil {
					resp.Playlists = pls
					resp.Sync.Playlists = pls
					resp.Sync.SyncedCount = len(pls)
				}
			}
		}
		writeJSON(w, http.StatusOK, resp)
	})

	mux.HandleFunc("POST /api/auth/youtube/logout", func(w http.ResponseWriter, r *http.Request) {
		payload, err := repo.Logout(r.Context())
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, payload)
	})

	mux.HandleFunc("PUT /api/auth/settings", func(w http.ResponseWriter, r *http.Request) {
		var req models.UpdateSettingsRequest
		if err := decodeJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON payload.")
			return
		}
		payload, err := repo.UpdateSettings(r.Context(), req)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, payload)
	})

	mux.HandleFunc("POST /api/auth/youtube/session-bridge", func(w http.ResponseWriter, r *http.Request) {
		var req models.SessionBridgeRequest
		if err := decodeJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, "Provide signed-in YouTube session cookies (DevTools Cookie header or cookies.txt).")
			return
		}
		if len(req.Cookies) == 0 && strings.TrimSpace(req.CookieInput) == "" {
			writeError(w, http.StatusBadRequest, "Provide signed-in YouTube session cookies (DevTools Cookie header or cookies.txt).")
			return
		}
		resp, err := repo.ConnectYouTubeSession(r.Context(), req)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, resp)
	})

	mux.HandleFunc("DELETE /api/auth/youtube/session-bridge", func(w http.ResponseWriter, r *http.Request) {
		payload, err := repo.DisconnectYouTubeSession(r.Context())
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, payload)
	})

	// YouTube /feed/playlists Sync, Public Import & InnerTube Search
	mux.HandleFunc("POST /api/youtube/playlists/sync", func(w http.ResponseWriter, r *http.Request) {
		resp, err := repo.SyncYouTubePlaylists(r.Context())
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, resp)
	})

	mux.HandleFunc("POST /api/youtube/playlists/import", func(w http.ResponseWriter, r *http.Request) {
		var req models.ImportYouTubeRequest
		if err := decodeJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, "Enter a YouTube playlist URL, ID, or @channel handle.")
			return
		}
		resp, err := repo.ImportPublicYouTube(r.Context(), req.Input)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, resp)
	})

	mux.HandleFunc("GET /api/youtube/search", func(w http.ResponseWriter, r *http.Request) {
		q := strings.TrimSpace(r.URL.Query().Get("q"))
		if q == "" {
			writeError(w, http.StatusBadRequest, "Search query is required.")
			return
		}
		filter := r.URL.Query().Get("filter")
		results, err := youtube.SearchInnerTube(r.Context(), q, filter)
		if err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"results": results})
	})

	mux.HandleFunc("GET /api/youtube/suggest", func(w http.ResponseWriter, r *http.Request) {
		q := strings.TrimSpace(r.URL.Query().Get("q"))
		suggestions, _ := youtube.FetchSuggestions(r.Context(), q)
		writeJSON(w, http.StatusOK, map[string]any{"suggestions": suggestions})
	})

	// Playlists CRUD
	mux.HandleFunc("GET /api/playlists", func(w http.ResponseWriter, r *http.Request) {
		playlists, err := repo.ListPlaylists(r.Context())
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"playlists": playlists})
	})

	mux.HandleFunc("POST /api/playlists", func(w http.ResponseWriter, r *http.Request) {
		var req models.CreatePlaylistRequest
		if err := decodeJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON payload.")
			return
		}
		pl, ytSynced, err := repo.CreatePlaylist(r.Context(), req)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{
			"playlist":      pl,
			"youtubeSynced": ytSynced,
		})
	})

	mux.HandleFunc("PUT /api/playlists/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var req models.UpdatePlaylistRequest
		if err := decodeJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON payload.")
			return
		}
		pl, ytSynced, err := repo.UpdatePlaylist(r.Context(), id, req)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"playlist":      pl,
			"youtubeSynced": ytSynced,
		})
	})

	mux.HandleFunc("DELETE /api/playlists/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		ytSynced, err := repo.DeletePlaylist(r.Context(), id)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"deletedId":     id,
			"youtubeSynced": ytSynced,
		})
	})

	// Tracks CRUD, Reorder, Move & Edge Stream Handler
	mux.HandleFunc("GET /api/playlists/{id}/tracks", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		pl, tracks, err := repo.GetPlaylistTracks(r.Context(), id)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"playlist": pl,
			"tracks":   tracks,
		})
	})

	mux.HandleFunc("POST /api/playlists/{id}/tracks", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var req models.AddTrackRequest
		if err := decodeJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON payload.")
			return
		}
		tr, ytSynced, err := repo.AddTrack(r.Context(), id, req)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{
			"track":         tr,
			"youtubeSynced": ytSynced,
		})
	})

	mux.HandleFunc("DELETE /api/tracks/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		plID, ytSynced, err := repo.DeleteTrack(r.Context(), id)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"deletedId":     id,
			"playlistId":    plID,
			"youtubeSynced": ytSynced,
		})
	})

	mux.HandleFunc("PATCH /api/tracks/{id}/duration", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var req models.UpdateDurationRequest
		if err := decodeJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON payload.")
			return
		}
		if math.IsNaN(req.Duration) || math.IsInf(req.Duration, 0) || req.Duration <= 0 {
			writeError(w, http.StatusBadRequest, "Positive duration is required.")
			return
		}
		rounded := int(math.Round(req.Duration))
		dur, err := repo.UpdateTrackDuration(r.Context(), id, rounded)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"id":       id,
			"duration": dur,
		})
	})

	mux.HandleFunc("PUT /api/playlists/{id}/tracks/reorder", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var req models.ReorderTracksRequest
		if err := decodeJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON payload.")
			return
		}
		if req.TrackIDs == nil {
			writeError(w, http.StatusBadRequest, "trackIds array is required.")
			return
		}
		tracks, err := repo.ReorderTracks(r.Context(), id, req.TrackIDs)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"tracks": tracks})
	})

	mux.HandleFunc("POST /api/tracks/{id}/move", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var req models.MoveTrackRequest
		if err := decodeJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON payload.")
			return
		}
		tr, sourceID, ytSynced, err := repo.MoveTrack(r.Context(), id, req.TargetPlaylistID)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"track":            tr,
			"sourcePlaylistId": sourceID,
			"targetPlaylistId": req.TargetPlaylistID,
			"youtubeSynced":    ytSynced,
		})
	})

	mux.HandleFunc("GET /api/stream/{trackId}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("trackId")
		tr, err := repo.GetTrackByID(r.Context(), id)
		if err != nil {
			if strings.HasPrefix(id, "yt_") {
				ytID := strings.TrimPrefix(id, "yt_")
				if len(ytID) == 11 {
					writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
						"error":      "Use YouTube IFrame Player on Cloudflare Worker edge",
						"fallback":   "yt_iframe",
						"youtube_id": ytID,
					})
					return
				}
			}
			writeStoreError(w, err)
			return
		}
		if tr.SourceType == "audio" && tr.URL != "" {
			http.Redirect(w, r, tr.URL, http.StatusFound)
			return
		}
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
			"error":      "Use YouTube IFrame Player on Cloudflare Worker edge",
			"fallback":   "yt_iframe",
			"youtube_id": tr.YoutubeID,
		})
	})

	return withCORS(mux, allowedOrigins)
}

func withCORS(next http.Handler, allowedOrigins []string) http.Handler {
	allowedSet := make(map[string]bool, len(allowedOrigins))
	for _, o := range allowedOrigins {
		if trimmed := strings.TrimSpace(o); trimmed != "" {
			allowedSet[trimmed] = true
		}
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if isOriginAllowed(origin, allowedSet) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func isOriginAllowed(origin string, allowedSet map[string]bool) bool {
	if origin == "" {
		return false
	}
	if allowedSet[origin] {
		return true
	}
	return strings.HasPrefix(origin, "http://localhost:") ||
		strings.HasPrefix(origin, "http://127.0.0.1:") ||
		strings.HasSuffix(origin, ".pages.dev") ||
		origin == "https://youtify.muhalmuhtadi.com"
}

func decodeJSON(r *http.Request, dst any) error {
	dec := json.NewDecoder(r.Body)
	return dec.Decode(dst)
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func writeStoreError(w http.ResponseWriter, err error) {
	msg := cleanErrorMessage(err.Error())
	switch {
	case errors.Is(err, store.ErrUnauthorized):
		writeError(w, http.StatusUnauthorized, msg)
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, msg)
	case errors.Is(err, store.ErrConflict):
		writeError(w, http.StatusConflict, msg)
	case errors.Is(err, store.ErrBadRequest):
		writeError(w, http.StatusBadRequest, msg)
	case errors.Is(err, store.ErrBadGateway):
		writeError(w, http.StatusBadGateway, msg)
	default:
		writeError(w, http.StatusInternalServerError, msg)
	}
}

func cleanErrorMessage(raw string) string {
	for _, prefix := range []string{"unauthorized: ", "not found: ", "conflict: ", "bad request: ", "bad gateway: "} {
		if strings.HasPrefix(raw, prefix) {
			return strings.TrimPrefix(raw, prefix)
		}
	}
	return raw
}
