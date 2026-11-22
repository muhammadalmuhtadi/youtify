package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/younamp/backend-go/internal/models"
	"github.com/younamp/backend-go/internal/store"
)

func doReq(t *testing.T, h http.Handler, method, path string, body any, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatalf("encode body: %v", err)
		}
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestSessionAndCORS(t *testing.T) {
	repo := store.NewMemoryStore(false)
	h := NewRouter(repo, []string{"https://younamp.pages.dev"})

	rec := doReq(t, h, http.MethodGet, "/api/auth/session", nil, map[string]string{
		"Origin": "https://youtify.muhalmuhtadi.com",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "https://youtify.muhalmuhtadi.com" {
		t.Fatalf("CORS origin = %q", got)
	}
	var payload models.SessionPayload
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.Authenticated || payload.ActiveUser != nil || len(payload.Accounts) != 0 {
		t.Fatalf("expected unauthenticated empty session, got %+v", payload)
	}

	// Unauthenticated playlists request must return 401
	unauth := doReq(t, h, http.MethodGet, "/api/playlists", nil, nil)
	if unauth.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated /api/playlists status = %d, want 401", unauth.Code)
	}

	// Production subdomain youtify.muhalmuhtadi.com must be allowed by CORS
	domainRec := doReq(t, h, http.MethodGet, "/api/health", nil, map[string]string{
		"Origin": "https://youtify.muhalmuhtadi.com",
	})
	if domainRec.Header().Get("Access-Control-Allow-Origin") != "https://youtify.muhalmuhtadi.com" {
		t.Fatalf("expected youtify.muhalmuhtadi.com CORS allow, got %q", domainRec.Header().Get("Access-Control-Allow-Origin"))
	}
}

func TestBridgeSearchAndEdgeStream(t *testing.T) {
	repo := store.NewMemoryStore(false)
	h := NewRouter(repo, []string{"https://youtify.muhalmuhtadi.com"})

	// Unverified browser clicking "Lanjutkan dengan YouTube" must get 401 needsBrowserVerification=true
	unverifiedLogin := doReq(t, h, http.MethodPost, "/api/auth/youtube/login", map[string]string{}, nil)
	if unverifiedLogin.Code != http.StatusUnauthorized {
		t.Fatalf("unverified login status = %d, want 401", unverifiedLogin.Code)
	}
	var verifyBody struct {
		NeedsBrowserVerification bool `json:"needsBrowserVerification"`
	}
	_ = json.NewDecoder(unverifiedLogin.Body).Decode(&verifyBody)
	if !verifyBody.NeedsBrowserVerification {
		t.Fatalf("expected needsBrowserVerification=true, got %+v", verifyBody)
	}

	// Empty session bridge must fail 400
	badBridge := doReq(t, h, http.MethodPost, "/api/auth/youtube/session-bridge", map[string]string{
		"cookieInput": "",
	}, nil)
	if badBridge.Code != http.StatusBadRequest {
		t.Fatalf("empty session-bridge status = %d, want 400", badBridge.Code)
	}

	// Valid session bridge connects account for THIS browser session only
	okBridge := doReq(t, h, http.MethodPost, "/api/auth/youtube/session-bridge", map[string]string{
		"cookieInput": "SAPISID=abc; SID=xyz",
	}, nil)
	if okBridge.Code != http.StatusOK {
		t.Fatalf("valid session-bridge status = %d: %s", okBridge.Code, okBridge.Body.String())
	}
	var bridgePayload models.SessionBridgeResponse
	if err := json.NewDecoder(okBridge.Body).Decode(&bridgePayload); err != nil {
		t.Fatal(err)
	}
	if !bridgePayload.Authenticated || bridgePayload.SessionID == "" {
		t.Fatalf("expected authenticated session with sessionId, got %+v", bridgePayload)
	}
	sessHeaders := map[string]string{"X-Youtify-Session": bridgePayload.SessionID}

	// Another browser without session token MUST still be unauthenticated (no shared cache leak)
	otherSession := doReq(t, h, http.MethodGet, "/api/auth/session", nil, nil)
	var otherPayload models.SessionPayload
	_ = json.NewDecoder(otherSession.Body).Decode(&otherPayload)
	if otherPayload.Authenticated || otherPayload.ActiveUser != nil {
		t.Fatalf("expected isolated unauthenticated browser, got %+v", otherPayload)
	}
	otherPlaylists := doReq(t, h, http.MethodGet, "/api/playlists", nil, nil)
	if otherPlaylists.Code != http.StatusUnauthorized {
		t.Fatalf("other browser /api/playlists status = %d, want 401", otherPlaylists.Code)
	}

	// Search without q returns 400
	badSearch := doReq(t, h, http.MethodGet, "/api/youtube/search", nil, sessHeaders)
	if badSearch.Code != http.StatusBadRequest {
		t.Fatalf("search without q status = %d, want 400", badSearch.Code)
	}

	// Create playlist + add YT track + add Direct Audio track, verify /api/stream/{id}
	plRec := doReq(t, h, http.MethodPost, "/api/playlists", map[string]any{"name": "Edge Test"}, sessHeaders)
	if plRec.Code != http.StatusCreated {
		t.Fatalf("create playlist status = %d: %s", plRec.Code, plRec.Body.String())
	}
	var plResp struct {
		Playlist models.Playlist `json:"playlist"`
	}
	_ = json.NewDecoder(plRec.Body).Decode(&plResp)

	ytRec := doReq(t, h, http.MethodPost, "/api/playlists/"+plResp.Playlist.ID+"/tracks", map[string]any{
		"url":   "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
		"title": "YT Song",
	}, sessHeaders)
	var ytTr struct {
		Track models.Track `json:"track"`
	}
	_ = json.NewDecoder(ytRec.Body).Decode(&ytTr)

	audioRec := doReq(t, h, http.MethodPost, "/api/playlists/"+plResp.Playlist.ID+"/tracks", map[string]any{
		"url":   "https://cdn.example.com/song.mp3",
		"title": "Direct Audio",
	}, sessHeaders)
	var auTr struct {
		Track models.Track `json:"track"`
	}
	_ = json.NewDecoder(audioRec.Body).Decode(&auTr)

	streamYT := doReq(t, h, http.MethodGet, "/api/stream/"+ytTr.Track.ID, nil, sessHeaders)
	if streamYT.Code != http.StatusUnprocessableEntity {
		t.Fatalf("edge YouTube stream status = %d, want 422", streamYT.Code)
	}
	streamAudio := doReq(t, h, http.MethodGet, "/api/stream/"+auTr.Track.ID, nil, sessHeaders)
	if streamAudio.Code != http.StatusFound || streamAudio.Header().Get("Location") != "https://cdn.example.com/song.mp3" {
		t.Fatalf("direct audio stream status=%d loc=%q", streamAudio.Code, streamAudio.Header().Get("Location"))
	}
}

func TestPlaylistTrackCRUDAndAuthFlow(t *testing.T) {
	repo := store.NewMemoryStore(true)
	h := NewRouter(repo, nil)

	// 1. Settings update validation + success
	badSettings := doReq(t, h, http.MethodPut, "/api/auth/settings", map[string]string{"cookie_mode": "invalid"}, nil)
	if badSettings.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid cookie_mode, got %d", badSettings.Code)
	}
	okSettings := doReq(t, h, http.MethodPut, "/api/auth/settings", map[string]string{"cookie_mode": "chrome"}, nil)
	if okSettings.Code != http.StatusOK {
		t.Fatalf("expected 200 for valid settings, got %d", okSettings.Code)
	}

	// 2. Create two playlists
	rec1 := doReq(t, h, http.MethodPost, "/api/playlists", map[string]any{
		"name":        "City Pop",
		"description": "Night drive",
	}, nil)
	if rec1.Code != http.StatusCreated {
		t.Fatalf("create playlist 1 status = %d: %s", rec1.Code, rec1.Body.String())
	}
	var pl1Resp struct {
		Playlist models.Playlist `json:"playlist"`
	}
	_ = json.NewDecoder(rec1.Body).Decode(&pl1Resp)

	rec2 := doReq(t, h, http.MethodPost, "/api/playlists", map[string]any{"name": "Favorites"}, nil)
	if rec2.Code != http.StatusCreated {
		t.Fatalf("create playlist 2 status = %d", rec2.Code)
	}
	var pl2Resp struct {
		Playlist models.Playlist `json:"playlist"`
	}
	_ = json.NewDecoder(rec2.Body).Decode(&pl2Resp)

	// 3. Update playlist name
	upd := doReq(t, h, http.MethodPut, "/api/playlists/"+pl1Resp.Playlist.ID, map[string]string{"name": "City Pop Mix"}, nil)
	if upd.Code != http.StatusOK {
		t.Fatalf("update playlist status = %d", upd.Code)
	}

	// 4. Add two tracks + reject duplicate (409)
	t1Rec := doReq(t, h, http.MethodPost, "/api/playlists/"+pl1Resp.Playlist.ID+"/tracks", map[string]any{
		"url":   "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
		"title": "Track One",
	}, nil)
	if t1Rec.Code != http.StatusCreated {
		t.Fatalf("add track 1 status = %d: %s", t1Rec.Code, t1Rec.Body.String())
	}
	var tr1Resp struct {
		Track models.Track `json:"track"`
	}
	_ = json.NewDecoder(t1Rec.Body).Decode(&tr1Resp)

	dupRec := doReq(t, h, http.MethodPost, "/api/playlists/"+pl1Resp.Playlist.ID+"/tracks", map[string]any{
		"url": "https://youtu.be/dQw4w9WgXcQ",
	}, nil)
	if dupRec.Code != http.StatusConflict {
		t.Fatalf("expected 409 duplicate track, got %d", dupRec.Code)
	}

	t2Rec := doReq(t, h, http.MethodPost, "/api/playlists/"+pl1Resp.Playlist.ID+"/tracks", map[string]any{
		"url":   "https://www.youtube.com/watch?v=9bZkp7q19f0",
		"title": "Track Two",
	}, nil)
	if t2Rec.Code != http.StatusCreated {
		t.Fatalf("add track 2 status = %d", t2Rec.Code)
	}
	var tr2Resp struct {
		Track models.Track `json:"track"`
	}
	_ = json.NewDecoder(t2Rec.Body).Decode(&tr2Resp)

	// 5. Update duration
	durRec := doReq(t, h, http.MethodPatch, "/api/tracks/"+tr1Resp.Track.ID+"/duration", map[string]float64{"duration": 212.6}, nil)
	if durRec.Code != http.StatusOK {
		t.Fatalf("patch duration status = %d", durRec.Code)
	}

	// 6. Reorder tracks (t2 before t1)
	reRec := doReq(t, h, http.MethodPut, "/api/playlists/"+pl1Resp.Playlist.ID+"/tracks/reorder", map[string]any{
		"trackIds": []string{tr2Resp.Track.ID, tr1Resp.Track.ID},
	}, nil)
	if reRec.Code != http.StatusOK {
		t.Fatalf("reorder status = %d", reRec.Code)
	}
	var reResp struct {
		Tracks []models.Track `json:"tracks"`
	}
	_ = json.NewDecoder(reRec.Body).Decode(&reResp)
	if len(reResp.Tracks) != 2 || reResp.Tracks[0].ID != tr2Resp.Track.ID {
		t.Fatalf("unexpected reorder result: %+v", reResp.Tracks)
	}

	// 7. Move track 1 to playlist 2
	mvRec := doReq(t, h, http.MethodPost, "/api/tracks/"+tr1Resp.Track.ID+"/move", map[string]string{
		"targetPlaylistId": pl2Resp.Playlist.ID,
	}, nil)
	if mvRec.Code != http.StatusOK {
		t.Fatalf("move track status = %d", mvRec.Code)
	}

	// 8. Delete track 2 and playlist 1
	delTr := doReq(t, h, http.MethodDelete, "/api/tracks/"+tr2Resp.Track.ID, nil, nil)
	if delTr.Code != http.StatusOK {
		t.Fatalf("delete track status = %d", delTr.Code)
	}
	delPl := doReq(t, h, http.MethodDelete, "/api/playlists/"+pl1Resp.Playlist.ID, nil, nil)
	if delPl.Code != http.StatusOK {
		t.Fatalf("delete playlist status = %d", delPl.Code)
	}

	// 9. Logout clears active session, then /api/auth/youtube/login restores it
	outRec := doReq(t, h, http.MethodPost, "/api/auth/youtube/logout", nil, nil)
	if outRec.Code != http.StatusOK {
		t.Fatalf("logout status = %d", outRec.Code)
	}
	var outPayload models.SessionPayload
	_ = json.NewDecoder(outRec.Body).Decode(&outPayload)
	if outPayload.Authenticated {
		t.Fatal("expected authenticated=false after logout")
	}

	inRec := doReq(t, h, http.MethodPost, "/api/auth/youtube/login", map[string]string{
		"identifier": "muhamadalmuhtadi@gmail.com",
	}, nil)
	if inRec.Code != http.StatusOK {
		t.Fatalf("login status = %d: %s", inRec.Code, inRec.Body.String())
	}
	var inPayload models.SessionBridgeResponse
	_ = json.NewDecoder(inRec.Body).Decode(&inPayload)
	if !inPayload.Authenticated {
		t.Fatal("expected authenticated=true after login")
	}
}
