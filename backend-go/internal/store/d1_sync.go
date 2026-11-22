package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/younamp/backend-go/internal/models"
	"github.com/younamp/backend-go/internal/youtube"
)

func (s *D1Store) saveStoredSession(ctx context.Context, sess *youtube.CookieSession) error {
	if s.kv == nil || sess == nil {
		return nil
	}
	payload := models.StoredYouTubeSession{
		Connected: true,
		Session:   sess,
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return s.kv.PutString(kvSessionKey, string(raw))
}

func (s *D1Store) getStoredCookieSession(ctx context.Context) *youtube.CookieSession {
	if s.kv == nil {
		return nil
	}
	raw, err := s.kv.GetString(kvSessionKey)
	if err != nil || strings.TrimSpace(raw) == "" {
		return nil
	}
	var st models.StoredYouTubeSession
	if err := json.Unmarshal([]byte(raw), &st); err != nil || !st.Connected || st.Session == nil {
		return nil
	}
	return st.Session
}

func (s *D1Store) upsertSingleUser(ctx context.Context, id youtube.AccountIdentity) error {
	existing, err := s.getSingleUser(ctx)
	if err != nil {
		return err
	}
	name := strings.TrimSpace(id.Name)
	if name == "" {
		name = "YouTube Account"
	}
	if existing == nil {
		_, err = s.db.ExecContext(ctx, `
			INSERT INTO users (
				id, email, name, handle, avatar_url, browser_source, profile_dir, cookie_mode, is_active
			)
			VALUES (?, ?, ?, ?, ?, 'YouTube', 'Default', 'cookies_file', 1)
		`, models.PrimaryUserID, id.Email, name, id.Handle, id.AvatarURL)
	} else {
		_, err = s.db.ExecContext(ctx, `
			UPDATE users
			SET name = CASE WHEN ? != '' AND ? != 'YouTube Account' THEN ? ELSE name END,
			    handle = CASE WHEN ? != '' THEN ? ELSE handle END,
			    email = CASE WHEN ? != '' THEN ? ELSE email END,
			    avatar_url = CASE WHEN ? != '' THEN ? ELSE avatar_url END,
			    browser_source = 'YouTube',
			    profile_dir = 'Default',
			    cookie_mode = 'cookies_file',
			    is_active = 1
			WHERE id = ?
		`, name, name, name, id.Handle, id.Handle, id.Email, id.Email, id.AvatarURL, id.AvatarURL, models.PrimaryUserID)
	}
	if err != nil {
		return err
	}
	return s.setAppState(ctx, "yt_logged_out", "0")
}

func (s *D1Store) upsertRemotePlaylistsToD1(ctx context.Context, userID string, remotePlaylists []youtube.RemotePlaylist, mirrorDeletes bool, forceEditable *bool) ([]models.Playlist, int, int, error) {
	syncedAt := time.Now().UTC().Format(time.RFC3339)
	var maxPos int
	if err := s.db.QueryRowContext(ctx, `SELECT COALESCE(MAX(position), -1) FROM playlists WHERE user_id = ?`, userID).Scan(&maxPos); err != nil {
		return nil, 0, 0, err
	}
	nextPos := maxPos + 1

	upsertedIDs := make([]string, 0, len(remotePlaylists))
	syncedCount := 0
	trackCount := 0
	remoteIDSet := make(map[string]bool, len(remotePlaylists))

	for _, rp := range remotePlaylists {
		ytPlID := strings.TrimSpace(rp.YoutubePlaylistID)
		if ytPlID == "" {
			continue
		}
		remoteIDSet[ytPlID] = true

		var existingID, existingName string
		var existingEditable int
		err := s.db.QueryRowContext(ctx, `
			SELECT id, name, COALESCE(yt_editable, 1)
			FROM playlists
			WHERE user_id = ? AND youtube_playlist_id = ?
			LIMIT 1
		`, userID, ytPlID).Scan(&existingID, &existingName, &existingEditable)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, 0, 0, err
		}

		editableFlag := 1
		if forceEditable != nil {
			if !*forceEditable {
				editableFlag = 0
			}
		} else if !rp.YtEditable {
			editableFlag = 0
		}

		plName := strings.TrimSpace(rp.Name)
		if plName == "" {
			if existingName != "" {
				plName = existingName
			} else {
				plName = "YouTube Playlist"
			}
		}

		var playlistID string
		if existingID != "" {
			playlistID = existingID
			if _, err := s.db.ExecContext(ctx, `
				UPDATE playlists
				SET name = ?, description = CASE WHEN ? != '' THEN ? ELSE description END,
				    cover_image = CASE WHEN ? != '' THEN ? ELSE cover_image END,
				    is_youtube_synced = 1, yt_editable = ?, last_synced_at = ?, updated_at = CURRENT_TIMESTAMP
				WHERE id = ?
			`, plName, rp.Description, rp.Description, rp.CoverImage, rp.CoverImage, editableFlag, syncedAt, playlistID); err != nil {
				return nil, 0, 0, err
			}
		} else {
			playlistID = GenerateID("pl")
			if _, err := s.db.ExecContext(ctx, `
				INSERT INTO playlists (
					id, user_id, name, description, cover_image, youtube_playlist_id,
					is_youtube_synced, yt_editable, last_synced_at, position
				)
				VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
			`, playlistID, userID, plName, rp.Description, rp.CoverImage, ytPlID, editableFlag, syncedAt, nextPos); err != nil {
				return nil, 0, 0, err
			}
			nextPos++
		}

		// Preserve cached positive durations on YouTube tracks & keep non-YouTube tracks
		existingTracks, err := s.queryTracksByPlaylist(ctx, playlistID)
		if err != nil {
			return nil, 0, 0, err
		}
		cachedDur := make(map[string]int)
		nonYtTracks := make([]models.Track, 0)
		for _, tr := range existingTracks {
			if tr.SourceType == "youtube" && tr.YoutubeID != "" && tr.Duration > 0 {
				cachedDur[tr.YoutubeID] = tr.Duration
			} else if tr.SourceType != "youtube" {
				nonYtTracks = append(nonYtTracks, tr)
			}
		}

		if _, err := s.db.ExecContext(ctx, `DELETE FROM tracks WHERE playlist_id = ? AND source_type = 'youtube'`, playlistID); err != nil {
			return nil, 0, 0, err
		}

		for idx, tr := range rp.Tracks {
			dur := tr.Duration
			if dur <= 0 {
				dur = cachedDur[tr.YoutubeID]
			}
			thumb := tr.ThumbnailURL
			if thumb == "" && tr.YoutubeID != "" {
				thumb = fmt.Sprintf("https://i.ytimg.com/vi/%s/hqdefault.jpg", tr.YoutubeID)
			}
			title := strings.TrimSpace(tr.Title)
			if title == "" {
				title = fmt.Sprintf("YouTube Audio (%s)", tr.YoutubeID)
			}
			artist := strings.TrimSpace(tr.Artist)
			if artist == "" {
				artist = "YouTube"
			}
			u := tr.URL
			if u == "" && tr.YoutubeID != "" {
				u = "https://www.youtube.com/watch?v=" + tr.YoutubeID
			}
			if _, err := s.db.ExecContext(ctx, `
				INSERT INTO tracks (
					id, playlist_id, title, artist, url, source_type, youtube_id,
					yt_set_video_id, duration, thumbnail_url, position
				)
				VALUES (?, ?, ?, ?, ?, 'youtube', ?, ?, ?, ?, ?)
			`, GenerateID("tr"), playlistID, title, artist, u, tr.YoutubeID, tr.YtSetVideoID, dur, thumb, idx); err != nil {
				return nil, 0, 0, err
			}
		}

		for idx, tr := range nonYtTracks {
			_, _ = s.db.ExecContext(ctx, `UPDATE tracks SET position = ? WHERE id = ?`, len(rp.Tracks)+idx, tr.ID)
		}

		upsertedIDs = append(upsertedIDs, playlistID)
		syncedCount++
		trackCount += len(rp.Tracks)
	}

	if mirrorDeletes && len(remotePlaylists) > 0 {
		rows, err := s.db.QueryContext(ctx, `SELECT id, youtube_playlist_id FROM playlists WHERE user_id = ? AND is_youtube_synced = 1`, userID)
		if err == nil {
			var toDelete []string
			for rows.Next() {
				var id, ypid string
				if rows.Scan(&id, &ypid) == nil && ypid != "" && !remoteIDSet[ypid] {
					toDelete = append(toDelete, id)
				}
			}
			rows.Close()
			for _, id := range toDelete {
				_, _ = s.db.ExecContext(ctx, `DELETE FROM playlists WHERE id = ?`, id)
			}
		}
	}

	out := make([]models.Playlist, 0, len(upsertedIDs))
	for _, id := range upsertedIDs {
		if pl, _ := s.getPlaylistByIDWithStats(ctx, id); pl != nil {
			out = append(out, *pl)
		}
	}
	return out, syncedCount, trackCount, nil
}

func (s *D1Store) syncUserFeedPlaylistsToD1(ctx context.Context, userID string, session *youtube.CookieSession, initialData map[string]any, handle string) (models.SyncSummary, error) {
	cards, err := youtube.FetchUserFeedPlaylists(ctx, session, initialData, handle)
	if err != nil {
		return models.SyncSummary{}, err
	}
	if len(cards) == 0 {
		return models.SyncSummary{}, errors.New("YouTube returned 0 playlists")
	}

	if len(cards) > 40 {
		cards = cards[:40]
	}

	hydrated := make([]youtube.RemotePlaylist, len(cards))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 4)

	for i, card := range cards {
		i, card := i, card
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			full, ferr := youtube.FetchPlaylistVideos(ctx, card.YoutubePlaylistID, session, 5)
			if ferr != nil {
				hydrated[i] = youtube.RemotePlaylist{
					YoutubePlaylistID: card.YoutubePlaylistID,
					Name:              card.Name,
					Description:       card.Description,
					CoverImage:        card.CoverImage,
					YtEditable:        card.YtEditable,
				}
				return
			}
			if card.Name != "" {
				full.Name = card.Name
			}
			if card.Description != "" {
				full.Description = card.Description
			}
			if card.CoverImage != "" {
				full.CoverImage = card.CoverImage
			}
			full.YtEditable = card.YtEditable || full.YtEditable
			hydrated[i] = full
		}()
	}
	wg.Wait()

	_, syncedCount, trackCount, err := s.upsertRemotePlaylistsToD1(ctx, userID, hydrated, true, nil)
	if err != nil {
		return models.SyncSummary{}, err
	}
	allPlaylists, err := s.ListPlaylists(ctx)
	if err != nil {
		return models.SyncSummary{}, err
	}
	return models.SyncSummary{
		Playlists:   allPlaylists,
		SyncedCount: syncedCount,
		TrackCount:  trackCount,
		SyncedAt:    time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func (s *D1Store) ConnectYouTubeSession(ctx context.Context, req models.SessionBridgeRequest) (models.SessionBridgeResponse, error) {
	sess, err := youtube.ParseCookieInput(req.Cookies, req.CookieInput)
	if err != nil {
		return models.SessionBridgeResponse{}, fmt.Errorf("%w: %s", ErrBadRequest, err.Error())
	}
	if req.YtContext != nil {
		sess.YtContext = *req.YtContext
	}

	resolvedInit := req.InitialPlaylistsData
	if !sess.YtContext.LoggedIn || resolvedInit == nil {
		liveCtx, liveInit, _ := youtube.FetchLiveYouTubeFeedContext(ctx, sess)
		if liveCtx != nil {
			if liveCtx.LoggedIn {
				sess.YtContext = *liveCtx
			} else if !sess.YtContext.LoggedIn && req.YtContext == nil {
				sess.YtContext = *liveCtx
			}
		}
		if liveInit != nil && (!sess.YtContext.LoggedIn || resolvedInit == nil) {
			resolvedInit = liveInit
		}
	}

	if err := s.saveStoredSession(ctx, sess); err != nil {
		return models.SessionBridgeResponse{}, err
	}

	identity := youtube.FetchAccountIdentity(ctx, sess, resolvedInit)
	if err := s.upsertSingleUser(ctx, identity); err != nil {
		return models.SessionBridgeResponse{}, err
	}

	syncRes, err := s.syncUserFeedPlaylistsToD1(ctx, models.PrimaryUserID, sess, resolvedInit, identity.Handle)
	if err != nil {
		if s.kv != nil {
			_ = s.kv.Delete(kvSessionKey)
		}
		_, _ = s.db.ExecContext(ctx, `UPDATE users SET is_active = 0, cookie_mode = 'none' WHERE id = ?`, models.PrimaryUserID)
		return models.SessionBridgeResponse{}, fmt.Errorf("%w: %s", ErrBadRequest, err.Error())
	}

	sessionPayload, err := s.GetSession(ctx)
	if err != nil {
		return models.SessionBridgeResponse{}, err
	}
	return models.SessionBridgeResponse{
		Authenticated: sessionPayload.Authenticated,
		ActiveUser:    sessionPayload.ActiveUser,
		Accounts:      sessionPayload.Accounts,
		Sync:          syncRes,
		Playlists:     syncRes.Playlists,
	}, nil
}

func (s *D1Store) DisconnectYouTubeSession(ctx context.Context) (models.SessionPayload, error) {
	if s.kv != nil {
		_ = s.kv.Delete(kvSessionKey)
	}
	_, _ = s.db.ExecContext(ctx, `UPDATE users SET cookie_mode = 'none' WHERE id = ?`, models.PrimaryUserID)
	return s.Logout(ctx)
}

func (s *D1Store) SyncYouTubePlaylists(ctx context.Context) (models.SessionBridgeResponse, error) {
	_ = s.setAppState(ctx, "yt_logged_out", "0")
	_, _ = s.db.ExecContext(ctx, `UPDATE users SET is_active = 1 WHERE id = ?`, models.PrimaryUserID)

	active, err := s.getActiveUser(ctx)
	if err != nil {
		return models.SessionBridgeResponse{}, err
	}
	if active == nil {
		return models.SessionBridgeResponse{}, fmt.Errorf("%w: Please connect your YouTube account first.", ErrUnauthorized)
	}

	var syncRes models.SyncSummary
	syncedLive := false
	if sess := s.getStoredCookieSession(ctx); sess != nil {
		liveCtx, liveInit, _ := youtube.FetchLiveYouTubeFeedContext(ctx, sess)
		if liveCtx != nil && liveCtx.LoggedIn {
			sess.YtContext = *liveCtx
			_ = s.saveStoredSession(ctx, sess)
		}
		identity := youtube.FetchAccountIdentity(ctx, sess, liveInit)
		if identity.Handle != "" || (identity.Name != "" && identity.Name != "YouTube Account") {
			_ = s.upsertSingleUser(ctx, identity)
		}
		handleHint := identity.Handle
		if handleHint == "" {
			handleHint = active.Handle
		}
		if res, syncErr := s.syncUserFeedPlaylistsToD1(ctx, models.PrimaryUserID, sess, liveInit, handleHint); syncErr == nil && res.SyncedCount > 0 {
			syncRes = res
			syncedLive = true
		}
	}

	if !syncedLive {
		allPls, listErr := s.ListPlaylists(ctx)
		if listErr != nil {
			return models.SessionBridgeResponse{}, listErr
		}
		totalTracks := 0
		for _, pl := range allPls {
			totalTracks += pl.TrackCount
		}
		syncRes = models.SyncSummary{
			Playlists:   allPls,
			SyncedCount: len(allPls),
			TrackCount:  totalTracks,
			SyncedAt:    time.Now().UTC().Format(time.RFC3339),
		}
	}

	sessionPayload, err := s.GetSession(ctx)
	if err != nil {
		return models.SessionBridgeResponse{}, err
	}
	return models.SessionBridgeResponse{
		Authenticated: sessionPayload.Authenticated,
		ActiveUser:    sessionPayload.ActiveUser,
		Accounts:      sessionPayload.Accounts,
		Sync:          syncRes,
		Playlists:     syncRes.Playlists,
	}, nil
}

func (s *D1Store) ImportPublicYouTube(ctx context.Context, input string) (models.ImportYouTubeResponse, error) {
	active, err := s.getActiveUser(ctx)
	if err != nil {
		return models.ImportYouTubeResponse{}, err
	}
	if active == nil {
		return models.ImportYouTubeResponse{}, fmt.Errorf("%w: Please connect your YouTube account first.", ErrUnauthorized)
	}
	if strings.TrimSpace(input) == "" {
		return models.ImportYouTubeResponse{}, fmt.Errorf("%w: Enter a YouTube playlist URL, ID, or @channel handle.", ErrBadRequest)
	}
	imported, err := youtube.FetchPublicImport(ctx, input)
	if err != nil {
		return models.ImportYouTubeResponse{}, fmt.Errorf("%w: %s", ErrBadRequest, err.Error())
	}
	hasCookies := s.getStoredCookieSession(ctx) != nil
	var forceEdit *bool
	if !hasCookies {
		f := false
		forceEdit = &f
	}
	upserted, impCount, trCount, err := s.upsertRemotePlaylistsToD1(ctx, active.ID, imported, false, forceEdit)
	if err != nil {
		return models.ImportYouTubeResponse{}, err
	}
	allPls, err := s.ListPlaylists(ctx)
	if err != nil {
		return models.ImportYouTubeResponse{}, err
	}
	firstID := ""
	if len(upserted) > 0 {
		firstID = upserted[0].ID
	}
	return models.ImportYouTubeResponse{
		Playlists:         allPls,
		ImportedPlaylists: impCount,
		ImportedTracks:    trCount,
		FirstPlaylistID:   firstID,
	}, nil
}
