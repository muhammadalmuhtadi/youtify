package store

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/younamp/backend-go/internal/models"
)

var (
	ErrUnauthorized      = errors.New("unauthorized")
	ErrNeedsVerification = errors.New("needs verification")
	ErrNotFound          = errors.New("not found")
	ErrConflict          = errors.New("conflict")
	ErrBadRequest        = errors.New("bad request")
	ErrBadGateway        = errors.New("bad gateway")
)

type ctxKey string

const sessionIDCtxKey ctxKey = "youtify_session_id"

func WithSessionID(ctx context.Context, sid string) context.Context {
	return context.WithValue(ctx, sessionIDCtxKey, sid)
}

func SessionIDFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	v, _ := ctx.Value(sessionIDCtxKey).(string)
	return v
}

type SessionKV interface {
	GetString(key string) (string, error)
	PutString(key, value string) error
	Delete(key string) error
}

type Repository interface {
	GetSession(ctx context.Context) (models.SessionPayload, error)
	Logout(ctx context.Context) (models.SessionPayload, error)
	UpdateSettings(ctx context.Context, req models.UpdateSettingsRequest) (models.SessionPayload, error)

	ConnectYouTubeSession(ctx context.Context, req models.SessionBridgeRequest) (models.SessionBridgeResponse, error)
	DisconnectYouTubeSession(ctx context.Context) (models.SessionPayload, error)
	SyncYouTubePlaylists(ctx context.Context) (models.SessionBridgeResponse, error)
	ImportPublicYouTube(ctx context.Context, input string) (models.ImportYouTubeResponse, error)

	ListPlaylists(ctx context.Context) ([]models.Playlist, error)
	CreatePlaylist(ctx context.Context, req models.CreatePlaylistRequest) (models.Playlist, bool, error)
	UpdatePlaylist(ctx context.Context, id string, req models.UpdatePlaylistRequest) (models.Playlist, bool, error)
	DeletePlaylist(ctx context.Context, id string) (bool, error)

	GetPlaylistTracks(ctx context.Context, playlistID string) (models.Playlist, []models.Track, error)
	GetTrackByID(ctx context.Context, trackID string) (*models.Track, error)
	AddTrack(ctx context.Context, playlistID string, req models.AddTrackRequest) (models.Track, bool, error)
	DeleteTrack(ctx context.Context, trackID string) (string, bool, error)
	UpdateTrackDuration(ctx context.Context, trackID string, duration int) (int, error)
	ReorderTracks(ctx context.Context, playlistID string, trackIDs []string) ([]models.Track, error)
	MoveTrack(ctx context.Context, trackID string, targetPlaylistID string) (models.Track, string, bool, error)
	GetRecommendationSeedQuery(ctx context.Context, explicitQuery string) (string, map[string]bool)
}

func GenerateID(prefix string) string {
	size := 6
	if prefix == "usr" {
		size = 16
	}
	b := make([]byte, size)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%s_%s", prefix, hex.EncodeToString(b))
}
