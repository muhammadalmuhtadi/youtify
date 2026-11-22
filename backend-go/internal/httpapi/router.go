package httpapi

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strings"

	"github.com/younamp/backend-go/internal/media"
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
			models.SessionBridgeRequest
			Identifier string `json:"identifier"`
		}
		_ = decodeJSON(r, &body)
		if len(body.Cookies) > 0 || strings.TrimSpace(body.CookieInput) != "" || strings.TrimSpace(body.ChannelInput) != "" {
			resp, err := repo.ConnectYouTubeSession(r.Context(), body.SessionBridgeRequest)
			if err != nil {
				writeStoreError(w, err)
				return
			}
			setSessionCookie(w, r, resp.SessionID)
			writeJSON(w, http.StatusOK, resp)
			return
		}
		resp, err := repo.SyncYouTubePlaylists(r.Context())
		if err != nil {
			if idTrimmed := strings.TrimSpace(body.Identifier); idTrimmed != "" && (strings.HasPrefix(idTrimmed, "@") || strings.Contains(idTrimmed, "youtube.com/")) {
				resp, bridgeErr := repo.ConnectYouTubeSession(r.Context(), models.SessionBridgeRequest{
					ChannelInput: idTrimmed,
				})
				if bridgeErr == nil {
					setSessionCookie(w, r, resp.SessionID)
					writeJSON(w, http.StatusOK, resp)
					return
				}
			}
			writeStoreError(w, err)
			return
		}
		setSessionCookie(w, r, resp.SessionID)
		writeJSON(w, http.StatusOK, resp)
	})

	mux.HandleFunc("POST /api/auth/youtube/logout", func(w http.ResponseWriter, r *http.Request) {
		payload, err := repo.Logout(r.Context())
		if err != nil {
			writeStoreError(w, err)
			return
		}
		clearSessionCookie(w, r)
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
			writeError(w, http.StatusBadRequest, "Masukkan @handle/URL channel YouTube atau cookie session youtube.com.")
			return
		}
		if len(req.Cookies) == 0 && strings.TrimSpace(req.CookieInput) == "" && strings.TrimSpace(req.ChannelInput) == "" {
			writeError(w, http.StatusBadRequest, "Masukkan @handle/URL channel YouTube atau cookie session youtube.com.")
			return
		}
		resp, err := repo.ConnectYouTubeSession(r.Context(), req)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		setSessionCookie(w, r, resp.SessionID)
		writeJSON(w, http.StatusOK, resp)
	})

	mux.HandleFunc("DELETE /api/auth/youtube/session-bridge", func(w http.ResponseWriter, r *http.Request) {
		payload, err := repo.DisconnectYouTubeSession(r.Context())
		if err != nil {
			writeStoreError(w, err)
			return
		}
		clearSessionCookie(w, r)
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

	mux.HandleFunc("GET /api/youtube/recommendations", func(w http.ResponseWriter, r *http.Request) {
		explicitQ := strings.TrimSpace(r.URL.Query().Get("q"))
		seedQuery, exclude := repo.GetRecommendationSeedQuery(r.Context(), explicitQ)
		if strings.TrimSpace(seedQuery) == "" {
			seedQuery = "trending music mix"
		}
		results, err := youtube.SearchInnerTube(r.Context(), seedQuery, "music")
		if err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		recs := make([]youtube.SearchResult, 0, 12)
		seen := make(map[string]bool)
		for _, item := range results {
			if item.YoutubeID == "" || exclude[item.YoutubeID] || seen[item.YoutubeID] {
				continue
			}
			seen[item.YoutubeID] = true
			recs = append(recs, item)
			if len(recs) >= 12 {
				break
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"query":           seedQuery,
			"recommendations": recs,
		})
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
		ytID := ""
		title := strings.TrimSpace(r.URL.Query().Get("title"))
		artist := strings.TrimSpace(r.URL.Query().Get("artist"))
		if err != nil {
			if strings.HasPrefix(id, "yt_") {
				candidate := strings.TrimPrefix(id, "yt_")
				if len(candidate) == 11 {
					ytID = candidate
				}
			}
			if ytID == "" {
				writeStoreError(w, err)
				return
			}
		} else {
			if tr.SourceType == "audio" && tr.URL != "" {
				http.Redirect(w, r, tr.URL, http.StatusFound)
				return
			}
			ytID = tr.YoutubeID
			if title == "" {
				title = tr.Title
			}
			if artist == "" {
				artist = tr.Artist
			}
		}

		if ytID != "" && r.URL.Query().Get("format") != "json" && (strings.TrimSpace(r.URL.Query().Get("title")) != "" || (tr != nil && tr.Title != "" && tr.Title != "YT Song")) {
			if mErr := media.StreamYouTubeAudioMirror(r.Context(), w, r.Header.Get("Range"), ytID, title, artist); mErr == nil {
				return
			}
		}

		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
			"error":      "Use YouTube IFrame Player on Cloudflare Worker edge",
			"fallback":   "yt_iframe",
			"youtube_id": ytID,
		})
	})

	return withCORS(withSession(mux), allowedOrigins)
}

const sessionCookieName = "youtify_sid"

func extractSessionID(r *http.Request) string {
	if sid := strings.TrimSpace(r.Header.Get("X-Youtify-Session")); sid != "" && len(sid) <= 128 {
		return sid
	}
	if c, err := r.Cookie(sessionCookieName); err == nil {
		if sid := strings.TrimSpace(c.Value); sid != "" && len(sid) <= 128 {
			return sid
		}
	}
	return ""
}

func withSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if sid := extractSessionID(r); sid != "" {
			r = r.WithContext(store.WithSessionID(r.Context(), sid))
		}
		next.ServeHTTP(w, r)
	})
}

func setSessionCookie(w http.ResponseWriter, r *http.Request, sid string) {
	if strings.TrimSpace(sid) == "" {
		return
	}
	secure := r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    sid,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   secure,
		MaxAge:   60 * 60 * 24 * 30,
	})
}

func clearSessionCookie(w http.ResponseWriter, r *http.Request) {
	secure := r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   secure,
		MaxAge:   -1,
	})
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
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Youtify-Session")
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
	case errors.Is(err, store.ErrNeedsVerification):
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"error":                    msg,
			"needsBrowserVerification": true,
		})
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
	for _, prefix := range []string{"needs verification: ", "unauthorized: ", "not found: ", "conflict: ", "bad request: ", "bad gateway: "} {
		if strings.HasPrefix(raw, prefix) {
			return strings.TrimPrefix(raw, prefix)
		}
	}
	return raw
}
