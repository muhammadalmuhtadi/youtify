package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/younamp/backend-go/internal/media"
	"github.com/younamp/backend-go/internal/models"
	"github.com/younamp/backend-go/internal/youtube"
)

var allowedCookieModes = map[string]bool{
	"none":         true,
	"cookies_file": true,
	"chrome":       true,
	"edge":         true,
	"firefox":      true,
	"brave":        true,
	"opera":        true,
	"vivaldi":      true,
}

type D1Store struct {
	db *sql.DB
	kv SessionKV
}

func NewD1Store(db *sql.DB, kvNs SessionKV) *D1Store {
	return &D1Store{db: db, kv: kvNs}
}

func (s *D1Store) getAppState(ctx context.Context, key, fallback string) (string, error) {
	var val string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM app_state WHERE key = ?`, key).Scan(&val)
	if errors.Is(err, sql.ErrNoRows) {
		return fallback, nil
	}
	if err != nil {
		return "", err
	}
	return val, nil
}

func (s *D1Store) setAppState(ctx context.Context, key, value string) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO app_state (key, value)
		VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value
	`, key, value)
	return err
}

func kvSessionKeyFor(userID string) string {
	return "yt_session:" + userID
}

func (s *D1Store) getUserByID(ctx context.Context, userID string) (*models.User, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, nil
	}
	var u models.User
	err := s.db.QueryRowContext(ctx, `
		SELECT
			id, COALESCE(email, ''), name, COALESCE(handle, ''), COALESCE(given_name, ''),
			COALESCE(avatar_url, ''), COALESCE(browser_source, 'YouTube'), COALESCE(profile_dir, 'Default'),
			COALESCE(cookie_mode, 'none'), COALESCE(skin_id, 'base-2.91.wsz'),
			COALESCE(skin_md5, ''), COALESCE(skin_name, ''), COALESCE(desktop_bg, '#008080'),
			COALESCE(profile_customized, 0), COALESCE(is_active, 0), COALESCE(created_at, '')
		FROM users
		WHERE id = ?
		LIMIT 1
	`, userID).Scan(
		&u.ID, &u.Email, &u.Name, &u.Handle, &u.GivenName,
		&u.AvatarURL, &u.BrowserSource, &u.ProfileDir,
		&u.CookieMode, &u.SkinID, &u.SkinMD5, &u.SkinName, &u.DesktopBG,
		&u.ProfileCustomized, &u.IsActive, &u.CreatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (s *D1Store) getActiveUser(ctx context.Context) (*models.User, error) {
	sid := strings.TrimSpace(SessionIDFromContext(ctx))
	if sid == "" {
		return nil, nil
	}
	loggedOut, err := s.getAppState(ctx, "yt_logged_out:"+sid, "0")
	if err != nil {
		return nil, err
	}
	if loggedOut == "1" {
		return nil, nil
	}
	authed, _ := s.getAppState(ctx, "yt_browser_auth:"+sid, "0")
	user, err := s.getUserByID(ctx, sid)
	if err != nil {
		return nil, err
	}
	if user == nil && authed == "1" {
		user, err = s.getUserByID(ctx, models.PrimaryUserID)
		if err != nil {
			return nil, err
		}
		if user != nil {
			user.IsActive = 1
		}
	}
	if user == nil || (user.IsActive == 0 && authed != "1") {
		return nil, nil
	}
	user.IsActive = 1
	if sess := s.getStoredCookieSession(ctx, user.ID); sess != nil {
		user.YtSyncConnected = true
		user.YtSyncUpdatedAt = sess.UpdatedAt
		user.YtSyncCookieCount = sess.CookieCount
	} else {
		user.YtSyncUpdatedAt = user.CreatedAt
		user.YtSyncCookieCount = 0
	}
	return user, nil
}

func (s *D1Store) GetSession(ctx context.Context) (models.SessionPayload, error) {
	active, err := s.getActiveUser(ctx)
	if err != nil {
		return models.SessionPayload{}, err
	}
	if active == nil {
		return models.SessionPayload{
			Authenticated: false,
			ActiveUser:    nil,
			Accounts:      []models.User{},
		}, nil
	}
	sid := strings.TrimSpace(SessionIDFromContext(ctx))
	if sid == "" {
		sid = active.ID
	}
	return models.SessionPayload{
		Authenticated: true,
		SessionID:     sid,
		ActiveUser:    active,
		Accounts:      []models.User{*active},
	}, nil
}

func (s *D1Store) Logout(ctx context.Context) (models.SessionPayload, error) {
	sid := strings.TrimSpace(SessionIDFromContext(ctx))
	if sid != "" {
		_, _ = s.db.ExecContext(ctx, `UPDATE users SET is_active = 0 WHERE id = ?`, sid)
		if err := s.setAppState(ctx, "yt_browser_auth:"+sid, "0"); err != nil {
			return models.SessionPayload{}, err
		}
		if err := s.setAppState(ctx, "yt_logged_out:"+sid, "1"); err != nil {
			return models.SessionPayload{}, err
		}
	}
	return models.SessionPayload{
		Authenticated: false,
		ActiveUser:    nil,
		Accounts:      []models.User{},
	}, nil
}

func (s *D1Store) UpdateSettings(ctx context.Context, req models.UpdateSettingsRequest) (models.SessionPayload, error) {
	active, err := s.getActiveUser(ctx)
	if err != nil {
		return models.SessionPayload{}, err
	}
	if active == nil {
		return models.SessionPayload{}, fmt.Errorf("%w: Please connect your YouTube account first.", ErrUnauthorized)
	}

	nextCookieMode := active.CookieMode
	if nextCookieMode == "" {
		nextCookieMode = "cookies_file"
	}
	if req.CookieMode != nil {
		mode := strings.TrimSpace(*req.CookieMode)
		if !allowedCookieModes[mode] {
			return models.SessionPayload{}, fmt.Errorf("%w: Invalid cookie_mode option.", ErrBadRequest)
		}
		nextCookieMode = mode
	}

	nextDesktopBG := active.DesktopBG
	if nextDesktopBG == "" {
		nextDesktopBG = "#008080"
	}
	if req.DesktopBG != nil {
		if trimmed := strings.TrimSpace(*req.DesktopBG); trimmed != "" {
			nextDesktopBG = trimmed
		}
	}

	_, err = s.db.ExecContext(ctx, `
		UPDATE users
		SET cookie_mode = ?, desktop_bg = ?
		WHERE id = ?
	`, nextCookieMode, nextDesktopBG, active.ID)
	if err != nil {
		return models.SessionPayload{}, err
	}
	return s.GetSession(ctx)
}

func (s *D1Store) getPlaylistByIDWithStats(ctx context.Context, playlistID string) (*models.Playlist, error) {
	var p models.Playlist
	err := s.db.QueryRowContext(ctx, `
		SELECT
			p.id, p.user_id, p.name, COALESCE(p.description, ''), COALESCE(p.cover_image, ''),
			COALESCE(p.youtube_playlist_id, ''), COALESCE(p.is_youtube_synced, 0),
			COALESCE(p.yt_editable, 1), COALESCE(p.last_synced_at, ''),
			COALESCE(p.position, 0), COALESCE(p.created_at, ''), COALESCE(p.updated_at, ''),
			COUNT(t.id) AS track_count,
			COALESCE(SUM(t.duration), 0) AS total_duration,
			COALESCE(
				NULLIF(p.cover_image, ''),
				(SELECT thumbnail_url FROM tracks WHERE playlist_id = p.id AND thumbnail_url != '' ORDER BY position ASC, added_at ASC LIMIT 1),
				''
			) AS effective_cover
		FROM playlists p
		LEFT JOIN tracks t ON t.playlist_id = p.id
		WHERE p.id = ?
		GROUP BY p.id
	`, playlistID).Scan(
		&p.ID, &p.UserID, &p.Name, &p.Description, &p.CoverImage,
		&p.YoutubePlaylistID, &p.IsYoutubeSynced,
		&p.YtEditable, &p.LastSyncedAt,
		&p.Position, &p.CreatedAt, &p.UpdatedAt,
		&p.TrackCount, &p.TotalDuration, &p.EffectiveCover,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *D1Store) ListPlaylists(ctx context.Context) ([]models.Playlist, error) {
	active, err := s.getActiveUser(ctx)
	if err != nil {
		return nil, err
	}
	if active == nil {
		return nil, fmt.Errorf("%w: YouTube browser session required.", ErrUnauthorized)
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT
			p.id, p.user_id, p.name, COALESCE(p.description, ''), COALESCE(p.cover_image, ''),
			COALESCE(p.youtube_playlist_id, ''), COALESCE(p.is_youtube_synced, 0),
			COALESCE(p.yt_editable, 1), COALESCE(p.last_synced_at, ''),
			COALESCE(p.position, 0), COALESCE(p.created_at, ''), COALESCE(p.updated_at, ''),
			COUNT(t.id) AS track_count,
			COALESCE(SUM(t.duration), 0) AS total_duration,
			COALESCE(
				NULLIF(p.cover_image, ''),
				(SELECT thumbnail_url FROM tracks WHERE playlist_id = p.id AND thumbnail_url != '' ORDER BY position ASC, added_at ASC LIMIT 1),
				''
			) AS effective_cover
		FROM playlists p
		LEFT JOIN tracks t ON t.playlist_id = p.id
		WHERE p.user_id = ?
		GROUP BY p.id
		ORDER BY p.position ASC, p.created_at ASC
	`, active.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	playlists := make([]models.Playlist, 0)
	for rows.Next() {
		var p models.Playlist
		if err := rows.Scan(
			&p.ID, &p.UserID, &p.Name, &p.Description, &p.CoverImage,
			&p.YoutubePlaylistID, &p.IsYoutubeSynced,
			&p.YtEditable, &p.LastSyncedAt,
			&p.Position, &p.CreatedAt, &p.UpdatedAt,
			&p.TrackCount, &p.TotalDuration, &p.EffectiveCover,
		); err != nil {
			return nil, err
		}
		playlists = append(playlists, p)
	}
	return playlists, rows.Err()
}

func (s *D1Store) CreatePlaylist(ctx context.Context, req models.CreatePlaylistRequest) (models.Playlist, bool, error) {
	active, err := s.getActiveUser(ctx)
	if err != nil {
		return models.Playlist{}, false, err
	}
	if active == nil {
		return models.Playlist{}, false, fmt.Errorf("%w: YouTube browser session required.", ErrUnauthorized)
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return models.Playlist{}, false, fmt.Errorf("%w: Playlist name is required.", ErrBadRequest)
	}

	syncToYT := true
	if req.SyncToYouTube != nil && !*req.SyncToYouTube {
		syncToYT = false
	}

	var ytPlID, lastSyncedAt string
	isYtSynced := 0
	if sess := s.getStoredCookieSession(ctx, active.ID); sess != nil && syncToYT {
		if createdID, ytErr := youtube.CreateYouTubePlaylist(ctx, sess, name, req.Description, "PRIVATE"); ytErr == nil && createdID != "" {
			ytPlID = createdID
			isYtSynced = 1
			lastSyncedAt = time.Now().UTC().Format(time.RFC3339)
		}
	}

	var maxPos int
	if err := s.db.QueryRowContext(ctx, `SELECT COALESCE(MAX(position), -1) FROM playlists WHERE user_id = ?`, active.ID).Scan(&maxPos); err != nil {
		return models.Playlist{}, false, err
	}

	id := GenerateID("pl")
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO playlists (
			id, user_id, name, description, cover_image,
			youtube_playlist_id, is_youtube_synced, yt_editable, last_synced_at, position
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
	`, id, active.ID, name, strings.TrimSpace(req.Description), strings.TrimSpace(req.CoverImage), ytPlID, isYtSynced, lastSyncedAt, maxPos+1)
	if err != nil {
		return models.Playlist{}, false, err
	}

	created, err := s.getPlaylistByIDWithStats(ctx, id)
	if err != nil || created == nil {
		return models.Playlist{}, false, err
	}
	return *created, isYtSynced == 1, nil
}

func (s *D1Store) UpdatePlaylist(ctx context.Context, id string, req models.UpdatePlaylistRequest) (models.Playlist, bool, error) {
	existing, err := s.getPlaylistByIDWithStats(ctx, id)
	if err != nil {
		return models.Playlist{}, false, err
	}
	if existing == nil {
		return models.Playlist{}, false, fmt.Errorf("%w: Playlist not found.", ErrNotFound)
	}

	nextName := existing.Name
	if req.Name != nil {
		trimmed := strings.TrimSpace(*req.Name)
		if trimmed == "" {
			return models.Playlist{}, false, fmt.Errorf("%w: Playlist name cannot be empty.", ErrBadRequest)
		}
		nextName = trimmed
	}
	nextDesc := existing.Description
	if req.Description != nil {
		nextDesc = strings.TrimSpace(*req.Description)
	}
	nextCover := existing.CoverImage
	if req.CoverImage != nil {
		nextCover = strings.TrimSpace(*req.CoverImage)
	}

	ytSynced := false
	lastSyncedAt := existing.LastSyncedAt
	if existing.YoutubePlaylistID != "" && existing.YtEditable == 1 && !isSystemPlaylist(existing.YoutubePlaylistID) {
		if sess := s.getStoredCookieSession(ctx, existing.UserID); sess != nil {
			if err := youtube.UpdateYouTubePlaylist(ctx, sess, existing.YoutubePlaylistID, &nextName, &nextDesc); err == nil {
				ytSynced = true
				lastSyncedAt = time.Now().UTC().Format(time.RFC3339)
			}
		}
	}

	_, err = s.db.ExecContext(ctx, `
		UPDATE playlists
		SET name = ?, description = ?, cover_image = ?, last_synced_at = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, nextName, nextDesc, nextCover, lastSyncedAt, id)
	if err != nil {
		return models.Playlist{}, false, err
	}

	updated, err := s.getPlaylistByIDWithStats(ctx, id)
	if err != nil || updated == nil {
		return models.Playlist{}, false, err
	}
	return *updated, ytSynced, nil
}

func (s *D1Store) DeletePlaylist(ctx context.Context, id string) (bool, error) {
	existing, err := s.getPlaylistByIDWithStats(ctx, id)
	if err != nil {
		return false, err
	}
	if existing == nil {
		return false, fmt.Errorf("%w: Playlist not found.", ErrNotFound)
	}

	ytSynced := false
	if existing.YoutubePlaylistID != "" && existing.YtEditable == 1 && !isSystemPlaylist(existing.YoutubePlaylistID) {
		if sess := s.getStoredCookieSession(ctx, existing.UserID); sess != nil {
			if err := youtube.DeleteYouTubePlaylist(ctx, sess, existing.YoutubePlaylistID); err == nil {
				ytSynced = true
			}
		}
	}

	if _, err := s.db.ExecContext(ctx, `DELETE FROM playlists WHERE id = ?`, id); err != nil {
		return false, err
	}
	return ytSynced, nil
}

func (s *D1Store) queryTracksByPlaylist(ctx context.Context, playlistID string) ([]models.Track, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT
			id, playlist_id, title, COALESCE(artist, 'Unknown Artist'), url,
			source_type, COALESCE(youtube_id, ''), COALESCE(yt_set_video_id, ''),
			COALESCE(duration, 0), COALESCE(thumbnail_url, ''), COALESCE(position, 0),
			COALESCE(added_at, '')
		FROM tracks
		WHERE playlist_id = ?
		ORDER BY position ASC, added_at ASC
	`, playlistID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tracks := make([]models.Track, 0)
	for rows.Next() {
		var t models.Track
		if err := rows.Scan(
			&t.ID, &t.PlaylistID, &t.Title, &t.Artist, &t.URL,
			&t.SourceType, &t.YoutubeID, &t.YtSetVideoID,
			&t.Duration, &t.ThumbnailURL, &t.Position, &t.AddedAt,
		); err != nil {
			return nil, err
		}
		tracks = append(tracks, t)
	}
	return tracks, rows.Err()
}

func (s *D1Store) GetTrackByID(ctx context.Context, trackID string) (*models.Track, error) {
	var t models.Track
	err := s.db.QueryRowContext(ctx, `
		SELECT
			id, playlist_id, title, COALESCE(artist, 'Unknown Artist'), url,
			source_type, COALESCE(youtube_id, ''), COALESCE(yt_set_video_id, ''),
			COALESCE(duration, 0), COALESCE(thumbnail_url, ''), COALESCE(position, 0),
			COALESCE(added_at, '')
		FROM tracks WHERE id = ?
	`, trackID).Scan(
		&t.ID, &t.PlaylistID, &t.Title, &t.Artist, &t.URL,
		&t.SourceType, &t.YoutubeID, &t.YtSetVideoID,
		&t.Duration, &t.ThumbnailURL, &t.Position, &t.AddedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("%w: Track not found.", ErrNotFound)
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (s *D1Store) GetPlaylistTracks(ctx context.Context, playlistID string) (models.Playlist, []models.Track, error) {
	pl, err := s.getPlaylistByIDWithStats(ctx, playlistID)
	if err != nil {
		return models.Playlist{}, nil, err
	}
	if pl == nil {
		return models.Playlist{}, nil, fmt.Errorf("%w: Playlist not found.", ErrNotFound)
	}
	tracks, err := s.queryTracksByPlaylist(ctx, playlistID)
	if err != nil {
		return models.Playlist{}, nil, err
	}
	return *pl, tracks, nil
}

func (s *D1Store) AddTrack(ctx context.Context, playlistID string, req models.AddTrackRequest) (models.Track, bool, error) {
	active, err := s.getActiveUser(ctx)
	if err != nil {
		return models.Track{}, false, err
	}
	if active == nil {
		return models.Track{}, false, fmt.Errorf("%w: YouTube browser session required.", ErrUnauthorized)
	}

	pl, err := s.getPlaylistByIDWithStats(ctx, playlistID)
	if err != nil {
		return models.Track{}, false, err
	}
	if pl == nil {
		return models.Track{}, false, fmt.Errorf("%w: Target playlist not found.", ErrNotFound)
	}

	parsed, err := media.ParseMediaURL(req.URL)
	if err != nil {
		return models.Track{}, false, fmt.Errorf("%w: %s", ErrBadRequest, err.Error())
	}

	var existingTitle string
	if parsed.SourceType == "youtube" && parsed.YouTubeID != "" {
		err = s.db.QueryRowContext(ctx, `SELECT title FROM tracks WHERE playlist_id = ? AND youtube_id = ? LIMIT 1`, playlistID, parsed.YouTubeID).Scan(&existingTitle)
	} else {
		err = s.db.QueryRowContext(ctx, `SELECT title FROM tracks WHERE playlist_id = ? AND url = ? LIMIT 1`, playlistID, parsed.CanonicalURL).Scan(&existingTitle)
	}
	if err == nil {
		return models.Track{}, false, fmt.Errorf(`%w: Musik "%s" sudah ada di playlist "%s".`, ErrConflict, existingTitle, pl.Name)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return models.Track{}, false, err
	}

	title := strings.TrimSpace(req.Title)
	artist := strings.TrimSpace(req.Artist)
	thumb := strings.TrimSpace(req.ThumbnailURL)
	duration := max(0, req.Duration)

	if parsed.SourceType == "youtube" {
		if title == "" {
			title = "YouTube Audio (" + parsed.YouTubeID + ")"
		}
		if artist == "" {
			artist = "YouTube"
		}
		if thumb == "" {
			thumb = "https://i.ytimg.com/vi/" + parsed.YouTubeID + "/hqdefault.jpg"
		}
	} else {
		if title == "" {
			if u, perr := url.Parse(parsed.CanonicalURL); perr == nil {
				if base := path.Base(u.Path); base != "" && base != "/" && base != "." {
					title = base
				} else {
					title = u.Hostname()
				}
			} else {
				title = parsed.CanonicalURL
			}
		}
		if artist == "" {
			if parsed.SourceType == "soundcloud" {
				artist = "SoundCloud"
			} else {
				artist = "Audio Stream"
			}
		}
	}

	var ytSetVideoID string
	ytSynced := false
	if pl.YoutubePlaylistID != "" && pl.YtEditable == 1 && !isSystemPlaylist(pl.YoutubePlaylistID) && parsed.SourceType == "youtube" && parsed.YouTubeID != "" {
		if sess := s.getStoredCookieSession(ctx, pl.UserID); sess != nil {
			if svID, ytErr := youtube.AddVideoToYouTubePlaylist(ctx, sess, pl.YoutubePlaylistID, parsed.YouTubeID); ytErr == nil {
				ytSetVideoID = svID
				ytSynced = true
			}
		}
	}

	var maxPos int
	if err := s.db.QueryRowContext(ctx, `SELECT COALESCE(MAX(position), -1) FROM tracks WHERE playlist_id = ?`, playlistID).Scan(&maxPos); err != nil {
		return models.Track{}, false, err
	}

	trackID := GenerateID("tr")
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO tracks (
			id, playlist_id, title, artist, url, source_type, youtube_id, yt_set_video_id, duration, thumbnail_url, position
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, trackID, playlistID, title, artist, parsed.CanonicalURL, parsed.SourceType, parsed.YouTubeID, ytSetVideoID, duration, thumb, maxPos+1)
	if err != nil {
		return models.Track{}, false, err
	}

	if ytSynced {
		_, _ = s.db.ExecContext(ctx, `UPDATE playlists SET last_synced_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, time.Now().UTC().Format(time.RFC3339), playlistID)
	} else {
		_, _ = s.db.ExecContext(ctx, `UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, playlistID)
	}

	track, err := s.GetTrackByID(ctx, trackID)
	if err != nil {
		return models.Track{}, false, err
	}
	return *track, ytSynced, nil
}

func (s *D1Store) DeleteTrack(ctx context.Context, trackID string) (string, bool, error) {
	tr, err := s.GetTrackByID(ctx, trackID)
	if err != nil {
		return "", false, err
	}
	pl, _ := s.getPlaylistByIDWithStats(ctx, tr.PlaylistID)

	ytSynced := false
	if pl != nil && pl.YoutubePlaylistID != "" && pl.YtEditable == 1 && !isSystemPlaylist(pl.YoutubePlaylistID) && tr.SourceType == "youtube" && tr.YoutubeID != "" {
		if sess := s.getStoredCookieSession(ctx, pl.UserID); sess != nil {
			if err := youtube.RemoveVideoFromYouTubePlaylist(ctx, sess, pl.YoutubePlaylistID, tr.YoutubeID, tr.YtSetVideoID); err == nil {
				ytSynced = true
			}
		}
	}

	if _, err := s.db.ExecContext(ctx, `DELETE FROM tracks WHERE id = ?`, trackID); err != nil {
		return "", false, err
	}
	_, _ = s.db.ExecContext(ctx, `UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, tr.PlaylistID)
	return tr.PlaylistID, ytSynced, nil
}

func (s *D1Store) UpdateTrackDuration(ctx context.Context, trackID string, duration int) (int, error) {
	if duration <= 0 {
		return 0, fmt.Errorf("%w: Positive duration is required.", ErrBadRequest)
	}
	res, err := s.db.ExecContext(ctx, `UPDATE tracks SET duration = ? WHERE id = ?`, duration, trackID)
	if err != nil {
		return 0, err
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		return 0, fmt.Errorf("%w: Track not found.", ErrNotFound)
	}
	return duration, nil
}

func (s *D1Store) ReorderTracks(ctx context.Context, playlistID string, trackIDs []string) ([]models.Track, error) {
	pl, err := s.getPlaylistByIDWithStats(ctx, playlistID)
	if err != nil {
		return nil, err
	}
	if pl == nil {
		return nil, fmt.Errorf("%w: Playlist not found.", ErrNotFound)
	}

	prevTracks, _ := s.queryTracksByPlaylist(ctx, playlistID)

	for idx, tid := range trackIDs {
		if _, err := s.db.ExecContext(ctx, `UPDATE tracks SET position = ? WHERE id = ? AND playlist_id = ?`, idx, tid, playlistID); err != nil {
			return nil, err
		}
	}
	_, _ = s.db.ExecContext(ctx, `UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, playlistID)

	if pl.YoutubePlaylistID != "" && pl.YtEditable == 1 {
		if sess := s.getStoredCookieSession(ctx, pl.UserID); sess != nil {
			setIDByTrack := make(map[string]string, len(prevTracks))
			for _, t := range prevTracks {
				setIDByTrack[t.ID] = t.YtSetVideoID
			}
			var movedID string
			for idx, tid := range trackIDs {
				if idx < len(prevTracks) && prevTracks[idx].ID != tid {
					movedID = tid
					break
				}
			}
			if movedID != "" && setIDByTrack[movedID] != "" {
				var predSetID string
				for idx, tid := range trackIDs {
					if tid == movedID && idx > 0 {
						predSetID = setIDByTrack[trackIDs[idx-1]]
						break
					}
				}
				_ = youtube.ReorderVideoInYouTubePlaylist(ctx, sess, pl.YoutubePlaylistID, setIDByTrack[movedID], predSetID)
			}
		}
	}

	return s.queryTracksByPlaylist(ctx, playlistID)
}

func (s *D1Store) MoveTrack(ctx context.Context, trackID string, targetPlaylistID string) (models.Track, string, bool, error) {
	tr, err := s.GetTrackByID(ctx, trackID)
	if err != nil {
		return models.Track{}, "", false, err
	}
	targetPl, err := s.getPlaylistByIDWithStats(ctx, targetPlaylistID)
	if err != nil {
		return models.Track{}, "", false, err
	}
	if targetPl == nil {
		return models.Track{}, "", false, fmt.Errorf("%w: Target playlist not found.", ErrNotFound)
	}
	if tr.PlaylistID == targetPlaylistID {
		return *tr, tr.PlaylistID, false, nil
	}

	sourcePl, _ := s.getPlaylistByIDWithStats(ctx, tr.PlaylistID)
	nextSetVideoID := tr.YtSetVideoID
	ytSynced := false

	if tr.SourceType == "youtube" && tr.YoutubeID != "" {
		if sess := s.getStoredCookieSession(ctx, targetPl.UserID); sess != nil {
			if targetPl.YoutubePlaylistID != "" && targetPl.YtEditable == 1 && !isSystemPlaylist(targetPl.YoutubePlaylistID) {
				if svID, ytErr := youtube.AddVideoToYouTubePlaylist(ctx, sess, targetPl.YoutubePlaylistID, tr.YoutubeID); ytErr == nil {
					nextSetVideoID = svID
					ytSynced = true
				}
			}
			if sourcePl != nil && sourcePl.YoutubePlaylistID != "" && sourcePl.YtEditable == 1 && !isSystemPlaylist(sourcePl.YoutubePlaylistID) {
				if ytErr := youtube.RemoveVideoFromYouTubePlaylist(ctx, sess, sourcePl.YoutubePlaylistID, tr.YoutubeID, tr.YtSetVideoID); ytErr == nil {
					ytSynced = true
				}
			}
		}
	}

	var maxPos int
	if err := s.db.QueryRowContext(ctx, `SELECT COALESCE(MAX(position), -1) FROM tracks WHERE playlist_id = ?`, targetPlaylistID).Scan(&maxPos); err != nil {
		return models.Track{}, "", false, err
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE tracks SET playlist_id = ?, position = ?, yt_set_video_id = ? WHERE id = ?`, targetPlaylistID, maxPos+1, nextSetVideoID, trackID); err != nil {
		return models.Track{}, "", false, err
	}
	_, _ = s.db.ExecContext(ctx, `UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id IN (?, ?)`, tr.PlaylistID, targetPlaylistID)

	updated, err := s.GetTrackByID(ctx, trackID)
	if err != nil {
		return models.Track{}, "", false, err
	}
	return *updated, tr.PlaylistID, ytSynced, nil
}

func isSystemPlaylist(ytID string) bool {
	return ytID == "WL" || ytID == "LL" || ytID == "LM"
}

func (s *D1Store) GetRecommendationSeedQuery(ctx context.Context, explicitQuery string) (string, map[string]bool) {
	exclude := make(map[string]bool)
	seedQuery := strings.TrimSpace(explicitQuery)
	if active, err := s.getActiveUser(ctx); err == nil && active != nil {
		rows, err := s.db.QueryContext(ctx, `
			SELECT t.title, COALESCE(t.artist, ''), COALESCE(t.youtube_id, '')
			FROM tracks t
			JOIN playlists p ON p.id = t.playlist_id
			WHERE p.user_id = ?
			ORDER BY t.added_at DESC
			LIMIT 25
		`, active.ID)
		if err == nil {
			defer rows.Close()
			var firstTitle, firstArtist string
			for rows.Next() {
				var title, artist, yid string
				if rows.Scan(&title, &artist, &yid) == nil {
					if yid != "" {
						exclude[yid] = true
					}
					if firstTitle == "" && title != "" {
						firstTitle = title
						firstArtist = artist
					}
				}
			}
			if seedQuery == "" && firstTitle != "" {
				if firstArtist != "" && firstArtist != "YouTube" {
					seedQuery = firstArtist + " " + firstTitle + " mix"
				} else {
					seedQuery = firstTitle + " mix"
				}
			}
		}
	}
	if seedQuery == "" {
		seedQuery = "top hits indonesia music playlist"
	}
	return seedQuery, exclude
}
