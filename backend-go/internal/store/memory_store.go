package store

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/younamp/backend-go/internal/media"
	"github.com/younamp/backend-go/internal/models"
	"github.com/younamp/backend-go/internal/youtube"
)

type memSession struct {
	user        models.User
	loggedOut   bool
	ytConnected bool
	ytSession   *youtube.CookieSession
}

// MemoryStore implements Repository in-memory for local unit and HTTP tests.
type MemoryStore struct {
	mu         sync.RWMutex
	defaultSID string
	sessions   map[string]*memSession
	playlists  map[string]*models.Playlist
	tracks     map[string]*models.Track
}

func NewMemoryStore(authenticated bool) *MemoryStore {
	sessions := make(map[string]*memSession)
	defaultSID := ""
	if authenticated {
		sid := "usr_test"
		defaultSID = sid
		now := time.Now().UTC().Format(time.RFC3339)
		sessions[sid] = &memSession{
			user: models.User{
				ID:                sid,
				Name:              "Test Listener",
				Handle:            "@testlistener",
				BrowserSource:     "YouTube",
				ProfileDir:        "Default",
				CookieMode:        "cookies_file",
				DesktopBG:         "#008080",
				IsActive:          1,
				YtSyncConnected:   true,
				YtSyncUpdatedAt:   now,
				YtSyncCookieCount: 13,
			},
			loggedOut:   false,
			ytConnected: true,
			ytSession: &youtube.CookieSession{
				UpdatedAt:   now,
				CookieCount: 13,
			},
		}
	}
	return &MemoryStore{
		defaultSID: defaultSID,
		sessions:   sessions,
		playlists:  make(map[string]*models.Playlist),
		tracks:     make(map[string]*models.Track),
	}
}

func (m *MemoryStore) resolveSIDLocked(ctx context.Context) string {
	sid := strings.TrimSpace(SessionIDFromContext(ctx))
	if sid != "" {
		return sid
	}
	return m.defaultSID
}

func (m *MemoryStore) activeSessionLocked(ctx context.Context) (*memSession, *models.User) {
	sid := m.resolveSIDLocked(ctx)
	if sid == "" {
		return nil, nil
	}
	sess, ok := m.sessions[sid]
	if !ok || sess.loggedOut || !sess.ytConnected || sess.ytSession == nil {
		return nil, nil
	}
	u := sess.user
	u.YtSyncConnected = true
	u.YtSyncUpdatedAt = sess.ytSession.UpdatedAt
	u.YtSyncCookieCount = sess.ytSession.CookieCount
	return sess, &u
}

func (m *MemoryStore) playlistWithStatsLocked(p *models.Playlist) models.Playlist {
	copyPl := *p
	var count, totalDur int
	var firstThumb string
	tracks := m.tracksForPlaylistLocked(p.ID)
	for _, tr := range tracks {
		count++
		totalDur += tr.Duration
		if firstThumb == "" && tr.ThumbnailURL != "" {
			firstThumb = tr.ThumbnailURL
		}
	}
	copyPl.TrackCount = count
	copyPl.TotalDuration = totalDur
	if copyPl.CoverImage != "" {
		copyPl.EffectiveCover = copyPl.CoverImage
	} else {
		copyPl.EffectiveCover = firstThumb
	}
	return copyPl
}

func (m *MemoryStore) tracksForPlaylistLocked(playlistID string) []models.Track {
	list := make([]models.Track, 0)
	for _, tr := range m.tracks {
		if tr.PlaylistID == playlistID {
			list = append(list, *tr)
		}
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].Position != list[j].Position {
			return list[i].Position < list[j].Position
		}
		return list[i].AddedAt < list[j].AddedAt
	})
	return list
}

func (m *MemoryStore) GetSession(ctx context.Context) (models.SessionPayload, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	_, active := m.activeSessionLocked(ctx)
	if active == nil {
		return models.SessionPayload{Authenticated: false, ActiveUser: nil, Accounts: []models.User{}}, nil
	}
	return models.SessionPayload{
		Authenticated: true,
		SessionID:     active.ID,
		ActiveUser:    active,
		Accounts:      []models.User{*active},
	}, nil
}

func (m *MemoryStore) Logout(ctx context.Context) (models.SessionPayload, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	sid := m.resolveSIDLocked(ctx)
	if sid != "" {
		if sess, ok := m.sessions[sid]; ok {
			sess.loggedOut = true
			sess.user.IsActive = 0
		}
	}
	return models.SessionPayload{Authenticated: false, SessionID: sid, ActiveUser: nil, Accounts: []models.User{}}, nil
}

func (m *MemoryStore) DisconnectYouTubeSession(ctx context.Context) (models.SessionPayload, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	sid := m.resolveSIDLocked(ctx)
	if sid != "" {
		delete(m.sessions, sid)
	}
	return models.SessionPayload{Authenticated: false, ActiveUser: nil, Accounts: []models.User{}}, nil
}

func (m *MemoryStore) UpdateSettings(ctx context.Context, req models.UpdateSettingsRequest) (models.SessionPayload, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	sess, active := m.activeSessionLocked(ctx)
	if active == nil || sess == nil {
		return models.SessionPayload{}, fmt.Errorf("%w: Please connect your YouTube account first.", ErrUnauthorized)
	}
	if req.CookieMode != nil {
		mode := strings.TrimSpace(*req.CookieMode)
		if !allowedCookieModes[mode] {
			return models.SessionPayload{}, fmt.Errorf("%w: Invalid cookie_mode option.", ErrBadRequest)
		}
		sess.user.CookieMode = mode
	}
	if req.DesktopBG != nil && strings.TrimSpace(*req.DesktopBG) != "" {
		sess.user.DesktopBG = strings.TrimSpace(*req.DesktopBG)
	}
	_, updated := m.activeSessionLocked(ctx)
	return models.SessionPayload{
		Authenticated: true,
		SessionID:     updated.ID,
		ActiveUser:    updated,
		Accounts:      []models.User{*updated},
	}, nil
}

func (m *MemoryStore) ConnectYouTubeSession(ctx context.Context, req models.SessionBridgeRequest) (models.SessionBridgeResponse, error) {
	var (
		ytSess   *youtube.CookieSession
		identity youtube.AccountIdentity
		mode     string
	)

	if len(req.Cookies) > 0 || strings.TrimSpace(req.CookieInput) != "" {
		parsed, err := youtube.ParseCookieInput(req.Cookies, req.CookieInput)
		if err != nil {
			return models.SessionBridgeResponse{}, fmt.Errorf("%w: %s", ErrBadRequest, err.Error())
		}
		ytSess = parsed
		mode = "cookies_file"
		if req.InitialPlaylistsData != nil {
			identity = youtube.ParseAccountIdentityFromMenu(req.InitialPlaylistsData)
		}
	} else if strings.TrimSpace(req.ChannelInput) != "" {
		resolvedID, _, err := youtube.ResolvePublicChannelSession(ctx, req.ChannelInput)
		if err != nil {
			return models.SessionBridgeResponse{}, fmt.Errorf("%w: %s", ErrBadRequest, err.Error())
		}
		identity = resolvedID
		mode = "channel"
		ytSess = &youtube.CookieSession{
			UpdatedAt:   time.Now().UTC().Format(time.RFC3339),
			CookieCount: 0,
		}
	} else {
		return models.SessionBridgeResponse{}, fmt.Errorf("%w: Masukkan @handle/URL channel YouTube atau cookie session youtube.com.", ErrBadRequest)
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	sid := strings.TrimSpace(SessionIDFromContext(ctx))
	if sid == "" {
		sid = GenerateID("usr")
	}
	sess, exists := m.sessions[sid]
	if !exists {
		sess = &memSession{
			user: models.User{
				ID:            sid,
				Name:          "YouTube Account",
				BrowserSource: "YouTube",
				ProfileDir:    "Browser Session",
				DesktopBG:     "#008080",
			},
		}
		m.sessions[sid] = sess
	}
	sess.loggedOut = false
	sess.ytConnected = true
	sess.ytSession = ytSess
	sess.user.ID = sid
	sess.user.IsActive = 1
	sess.user.CookieMode = mode
	if identity.Name != "" {
		sess.user.Name = identity.Name
		sess.user.Handle = identity.Handle
		sess.user.Email = identity.Email
		sess.user.AvatarURL = identity.AvatarURL
	} else if strings.TrimSpace(req.ChannelInput) != "" {
		sess.user.Name = strings.TrimSpace(req.ChannelInput)
	}
	u := sess.user
	u.YtSyncConnected = true
	u.YtSyncUpdatedAt = ytSess.UpdatedAt
	u.YtSyncCookieCount = ytSess.CookieCount
	active := &u
	pls := m.listPlaylistsLocked(sid)
	return models.SessionBridgeResponse{
		Authenticated: true,
		SessionID:     sid,
		ActiveUser:    active,
		Accounts:      []models.User{*active},
		Sync: models.SyncSummary{
			Playlists: pls,
			SyncedAt:  time.Now().UTC().Format(time.RFC3339),
		},
		Playlists: pls,
	}, nil
}

func (m *MemoryStore) SyncYouTubePlaylists(ctx context.Context) (models.SessionBridgeResponse, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	sid := m.resolveSIDLocked(ctx)
	if sid == "" {
		return models.SessionBridgeResponse{}, fmt.Errorf("%w: Verifikasi akun YouTube browser Anda untuk melanjutkan.", ErrNeedsVerification)
	}
	sess, ok := m.sessions[sid]
	if !ok || !sess.ytConnected || sess.ytSession == nil {
		return models.SessionBridgeResponse{}, fmt.Errorf("%w: Verifikasi akun YouTube browser Anda untuk melanjutkan.", ErrNeedsVerification)
	}
	if sess.loggedOut {
		sess.loggedOut = false
		sess.user.IsActive = 1
	}
	_, active := m.activeSessionLocked(ctx)
	if active == nil {
		return models.SessionBridgeResponse{}, fmt.Errorf("%w: Verifikasi akun YouTube browser Anda untuk melanjutkan.", ErrNeedsVerification)
	}
	pls := m.listPlaylistsLocked(sid)
	totalTracks := 0
	for _, pl := range pls {
		totalTracks += pl.TrackCount
	}
	return models.SessionBridgeResponse{
		Authenticated: true,
		SessionID:     sid,
		ActiveUser:    active,
		Accounts:      []models.User{*active},
		Sync: models.SyncSummary{
			Playlists:   pls,
			SyncedCount: len(pls),
			TrackCount:  totalTracks,
			SyncedAt:    time.Now().UTC().Format(time.RFC3339),
		},
		Playlists: pls,
	}, nil
}

func (m *MemoryStore) ImportPublicYouTube(ctx context.Context, input string) (models.ImportYouTubeResponse, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	_, active := m.activeSessionLocked(ctx)
	if active == nil {
		return models.ImportYouTubeResponse{}, fmt.Errorf("%w: Please connect your YouTube account first.", ErrUnauthorized)
	}
	if strings.TrimSpace(input) == "" {
		return models.ImportYouTubeResponse{}, fmt.Errorf("%w: Enter a YouTube playlist URL, ID, or @channel handle.", ErrBadRequest)
	}
	pls := m.listPlaylistsLocked(active.ID)
	return models.ImportYouTubeResponse{
		Playlists:         pls,
		ImportedPlaylists: 0,
		ImportedTracks:    0,
	}, nil
}

func (m *MemoryStore) listPlaylistsLocked(userID string) []models.Playlist {
	out := make([]models.Playlist, 0, len(m.playlists))
	for _, p := range m.playlists {
		if p.UserID == userID {
			out = append(out, m.playlistWithStatsLocked(p))
		}
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Position < out[j].Position
	})
	return out
}

func (m *MemoryStore) ListPlaylists(ctx context.Context) ([]models.Playlist, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	_, active := m.activeSessionLocked(ctx)
	if active == nil {
		return nil, fmt.Errorf("%w: YouTube browser session required.", ErrUnauthorized)
	}
	return m.listPlaylistsLocked(active.ID), nil
}

func (m *MemoryStore) CreatePlaylist(ctx context.Context, req models.CreatePlaylistRequest) (models.Playlist, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, active := m.activeSessionLocked(ctx)
	if active == nil {
		return models.Playlist{}, false, fmt.Errorf("%w: YouTube browser session required.", ErrUnauthorized)
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return models.Playlist{}, false, fmt.Errorf("%w: Playlist name is required.", ErrBadRequest)
	}
	maxPos := -1
	for _, p := range m.playlists {
		if p.UserID == active.ID && p.Position > maxPos {
			maxPos = p.Position
		}
	}
	now := time.Now().UTC().Format(time.RFC3339)
	pl := &models.Playlist{
		ID:          GenerateID("pl"),
		UserID:      active.ID,
		Name:        name,
		Description: strings.TrimSpace(req.Description),
		CoverImage:  strings.TrimSpace(req.CoverImage),
		YtEditable:  1,
		Position:    maxPos + 1,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	m.playlists[pl.ID] = pl
	return m.playlistWithStatsLocked(pl), false, nil
}

func (m *MemoryStore) UpdatePlaylist(ctx context.Context, id string, req models.UpdatePlaylistRequest) (models.Playlist, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, active := m.activeSessionLocked(ctx)
	if active == nil {
		return models.Playlist{}, false, fmt.Errorf("%w: YouTube browser session required.", ErrUnauthorized)
	}
	pl, ok := m.playlists[id]
	if !ok || pl.UserID != active.ID {
		return models.Playlist{}, false, fmt.Errorf("%w: Playlist not found.", ErrNotFound)
	}
	if req.Name != nil {
		trimmed := strings.TrimSpace(*req.Name)
		if trimmed == "" {
			return models.Playlist{}, false, fmt.Errorf("%w: Playlist name cannot be empty.", ErrBadRequest)
		}
		pl.Name = trimmed
	}
	if req.Description != nil {
		pl.Description = strings.TrimSpace(*req.Description)
	}
	if req.CoverImage != nil {
		pl.CoverImage = strings.TrimSpace(*req.CoverImage)
	}
	pl.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	return m.playlistWithStatsLocked(pl), false, nil
}

func (m *MemoryStore) DeletePlaylist(ctx context.Context, id string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, active := m.activeSessionLocked(ctx)
	if active == nil {
		return false, fmt.Errorf("%w: YouTube browser session required.", ErrUnauthorized)
	}
	pl, ok := m.playlists[id]
	if !ok || pl.UserID != active.ID {
		return false, fmt.Errorf("%w: Playlist not found.", ErrNotFound)
	}
	delete(m.playlists, id)
	for tid, tr := range m.tracks {
		if tr.PlaylistID == id {
			delete(m.tracks, tid)
		}
	}
	return false, nil
}

func (m *MemoryStore) GetPlaylistTracks(ctx context.Context, playlistID string) (models.Playlist, []models.Track, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	pl, ok := m.playlists[playlistID]
	if !ok {
		return models.Playlist{}, nil, fmt.Errorf("%w: Playlist not found.", ErrNotFound)
	}
	return m.playlistWithStatsLocked(pl), m.tracksForPlaylistLocked(playlistID), nil
}

func (m *MemoryStore) GetTrackByID(ctx context.Context, trackID string) (*models.Track, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	tr, ok := m.tracks[trackID]
	if !ok {
		return nil, fmt.Errorf("%w: Track not found.", ErrNotFound)
	}
	copyTr := *tr
	return &copyTr, nil
}

func (m *MemoryStore) AddTrack(ctx context.Context, playlistID string, req models.AddTrackRequest) (models.Track, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, active := m.activeSessionLocked(ctx)
	if active == nil {
		return models.Track{}, false, fmt.Errorf("%w: YouTube browser session required.", ErrUnauthorized)
	}
	pl, ok := m.playlists[playlistID]
	if !ok || pl.UserID != active.ID {
		return models.Track{}, false, fmt.Errorf("%w: Target playlist not found.", ErrNotFound)
	}
	parsed, err := media.ParseMediaURL(req.URL)
	if err != nil {
		return models.Track{}, false, fmt.Errorf("%w: %s", ErrBadRequest, err.Error())
	}
	for _, tr := range m.tracks {
		if tr.PlaylistID != playlistID {
			continue
		}
		if (parsed.SourceType == "youtube" && parsed.YouTubeID != "" && tr.YoutubeID == parsed.YouTubeID) || tr.URL == parsed.CanonicalURL {
			return models.Track{}, false, fmt.Errorf(`%w: Musik "%s" sudah ada di playlist "%s".`, ErrConflict, tr.Title, pl.Name)
		}
	}

	title := strings.TrimSpace(req.Title)
	if title == "" {
		if parsed.YouTubeID != "" {
			title = "YouTube Audio (" + parsed.YouTubeID + ")"
		} else {
			title = parsed.CanonicalURL
		}
	}
	artist := strings.TrimSpace(req.Artist)
	if artist == "" {
		artist = "YouTube"
	}
	thumb := strings.TrimSpace(req.ThumbnailURL)
	if thumb == "" && parsed.YouTubeID != "" {
		thumb = "https://i.ytimg.com/vi/" + parsed.YouTubeID + "/hqdefault.jpg"
	}

	maxPos := -1
	for _, tr := range m.tracks {
		if tr.PlaylistID == playlistID && tr.Position > maxPos {
			maxPos = tr.Position
		}
	}

	tr := &models.Track{
		ID:           GenerateID("tr"),
		PlaylistID:   playlistID,
		Title:        title,
		Artist:       artist,
		URL:          parsed.CanonicalURL,
		SourceType:   parsed.SourceType,
		YoutubeID:    parsed.YouTubeID,
		Duration:     max(0, req.Duration),
		ThumbnailURL: thumb,
		Position:     maxPos + 1,
		AddedAt:      time.Now().UTC().Format(time.RFC3339),
	}
	m.tracks[tr.ID] = tr
	return *tr, false, nil
}

func (m *MemoryStore) DeleteTrack(ctx context.Context, trackID string) (string, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	tr, ok := m.tracks[trackID]
	if !ok {
		return "", false, fmt.Errorf("%w: Track not found.", ErrNotFound)
	}
	plID := tr.PlaylistID
	delete(m.tracks, trackID)
	return plID, false, nil
}

func (m *MemoryStore) UpdateTrackDuration(ctx context.Context, trackID string, duration int) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if duration <= 0 {
		return 0, fmt.Errorf("%w: Positive duration is required.", ErrBadRequest)
	}
	tr, ok := m.tracks[trackID]
	if !ok {
		return 0, fmt.Errorf("%w: Track not found.", ErrNotFound)
	}
	tr.Duration = duration
	return duration, nil
}

func (m *MemoryStore) ReorderTracks(ctx context.Context, playlistID string, trackIDs []string) ([]models.Track, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.playlists[playlistID]; !ok {
		return nil, fmt.Errorf("%w: Playlist not found.", ErrNotFound)
	}
	for idx, tid := range trackIDs {
		if tr, ok := m.tracks[tid]; ok && tr.PlaylistID == playlistID {
			tr.Position = idx
		}
	}
	return m.tracksForPlaylistLocked(playlistID), nil
}

func (m *MemoryStore) MoveTrack(ctx context.Context, trackID string, targetPlaylistID string) (models.Track, string, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	tr, ok := m.tracks[trackID]
	if !ok {
		return models.Track{}, "", false, fmt.Errorf("%w: Track not found.", ErrNotFound)
	}
	if _, ok := m.playlists[targetPlaylistID]; !ok {
		return models.Track{}, "", false, fmt.Errorf("%w: Target playlist not found.", ErrNotFound)
	}
	sourceID := tr.PlaylistID
	if sourceID != targetPlaylistID {
		maxPos := -1
		for _, item := range m.tracks {
			if item.PlaylistID == targetPlaylistID && item.Position > maxPos {
				maxPos = item.Position
			}
		}
		tr.PlaylistID = targetPlaylistID
		tr.Position = maxPos + 1
	}
	return *tr, sourceID, false, nil
}

func (m *MemoryStore) GetRecommendationSeedQuery(ctx context.Context, explicitQuery string) (string, map[string]bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	exclude := make(map[string]bool)
	_, active := m.activeSessionLocked(ctx)
	seed := strings.TrimSpace(explicitQuery)
	if active != nil {
		for _, tr := range m.tracks {
			if pl, ok := m.playlists[tr.PlaylistID]; ok && pl.UserID == active.ID {
				if tr.YoutubeID != "" {
					exclude[tr.YoutubeID] = true
				}
				if seed == "" && tr.Title != "" {
					if tr.Artist != "" && tr.Artist != "YouTube" {
						seed = tr.Artist + " " + tr.Title + " music"
					} else {
						seed = tr.Title + " music"
					}
				}
			}
		}
	}
	if seed == "" {
		seed = "trending music mix"
	}
	return seed, exclude
}
