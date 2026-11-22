package models

import "github.com/younamp/backend-go/internal/youtube"

const PrimaryUserID = "youtube_primary"

type User struct {
	ID                string `json:"id"`
	Email             string `json:"email"`
	Name              string `json:"name"`
	Handle            string `json:"handle"`
	GivenName         string `json:"given_name"`
	AvatarURL         string `json:"avatar_url"`
	BrowserSource     string `json:"browser_source"`
	ProfileDir        string `json:"profile_dir"`
	CookieMode        string `json:"cookie_mode"`
	SkinID            string `json:"skin_id"`
	SkinMD5           string `json:"skin_md5"`
	SkinName          string `json:"skin_name"`
	DesktopBG         string `json:"desktop_bg"`
	ProfileCustomized int    `json:"profile_customized"`
	IsActive          int    `json:"is_active"`
	CreatedAt         string `json:"created_at"`
	HasCookiesFile    bool   `json:"has_cookies_file"`
	YtSyncConnected   bool   `json:"yt_sync_connected"`
	YtSyncUpdatedAt   string `json:"yt_sync_updated_at"`
	YtSyncCookieCount int    `json:"yt_sync_cookie_count"`
}

type SessionPayload struct {
	Authenticated bool   `json:"authenticated"`
	ActiveUser    *User  `json:"activeUser"`
	StoredUser    *User  `json:"storedUser,omitempty"`
	Accounts      []User `json:"accounts"`
}

type StoredYouTubeSession struct {
	Connected bool                   `json:"connected"`
	Session   *youtube.CookieSession `json:"session,omitempty"`
}

type Playlist struct {
	ID                string `json:"id"`
	UserID            string `json:"user_id"`
	Name              string `json:"name"`
	Description       string `json:"description"`
	CoverImage        string `json:"cover_image"`
	YoutubePlaylistID string `json:"youtube_playlist_id"`
	IsYoutubeSynced   int    `json:"is_youtube_synced"`
	YtEditable        int    `json:"yt_editable"`
	LastSyncedAt      string `json:"last_synced_at"`
	Position          int    `json:"position"`
	CreatedAt         string `json:"created_at"`
	UpdatedAt         string `json:"updated_at"`
	TrackCount        int    `json:"track_count"`
	TotalDuration     int    `json:"total_duration"`
	EffectiveCover    string `json:"effective_cover"`
}

type Track struct {
	ID           string `json:"id"`
	PlaylistID   string `json:"playlist_id"`
	Title        string `json:"title"`
	Artist       string `json:"artist"`
	URL          string `json:"url"`
	SourceType   string `json:"source_type"`
	YoutubeID    string `json:"youtube_id"`
	YtSetVideoID string `json:"yt_set_video_id"`
	Duration     int    `json:"duration"`
	ThumbnailURL string `json:"thumbnail_url"`
	Position     int    `json:"position"`
	AddedAt      string `json:"added_at"`
}

type UpdateSettingsRequest struct {
	CookieMode *string `json:"cookie_mode"`
	DesktopBG  *string `json:"desktop_bg"`
}

type CreatePlaylistRequest struct {
	Name          string `json:"name"`
	Description   string `json:"description"`
	CoverImage    string `json:"cover_image"`
	SyncToYouTube *bool  `json:"syncToYouTube"`
}

type UpdatePlaylistRequest struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
	CoverImage  *string `json:"cover_image"`
}

type AddTrackRequest struct {
	URL          string `json:"url"`
	Title        string `json:"title"`
	Artist       string `json:"artist"`
	Duration     int    `json:"duration"`
	ThumbnailURL string `json:"thumbnail_url"`
}

type UpdateDurationRequest struct {
	Duration float64 `json:"duration"`
}

type ReorderTracksRequest struct {
	TrackIDs []string `json:"trackIds"`
}

type MoveTrackRequest struct {
	TargetPlaylistID string `json:"targetPlaylistId"`
}

type SessionBridgeRequest struct {
	Cookies              []youtube.CookieEntry `json:"cookies"`
	CookieInput          string                `json:"cookieInput"`
	YtContext            *youtube.YtContext    `json:"ytContext"`
	InitialPlaylistsData map[string]any        `json:"initialPlaylistsData"`
}

type SyncSummary struct {
	Playlists   []Playlist `json:"playlists"`
	SyncedCount int        `json:"syncedCount"`
	TrackCount  int        `json:"trackCount"`
	SyncedAt    string     `json:"syncedAt"`
}

type SessionBridgeResponse struct {
	Authenticated bool        `json:"authenticated"`
	ActiveUser    *User       `json:"activeUser"`
	Accounts      []User      `json:"accounts"`
	Sync          SyncSummary `json:"sync"`
	Playlists     []Playlist  `json:"playlists"`
}

type ImportYouTubeRequest struct {
	Input string `json:"input"`
}

type ImportYouTubeResponse struct {
	Playlists         []Playlist `json:"playlists"`
	ImportedPlaylists int        `json:"importedPlaylists"`
	ImportedTracks    int        `json:"importedTracks"`
	FirstPlaylistID   string     `json:"firstPlaylistId"`
}
