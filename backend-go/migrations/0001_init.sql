-- Younamp Cloudflare D1 Initial Schema (migrated from server/db.js)

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT DEFAULT '',
  name TEXT NOT NULL,
  handle TEXT DEFAULT '',
  given_name TEXT DEFAULT '',
  avatar_url TEXT DEFAULT '',
  browser_source TEXT DEFAULT 'YouTube',
  profile_dir TEXT DEFAULT 'Default',
  cookie_mode TEXT DEFAULT 'none',
  skin_id TEXT DEFAULT 'base-2.91.wsz',
  skin_md5 TEXT DEFAULT '5e4f10275dcb1fb211d4a8b4f1bda236',
  skin_name TEXT DEFAULT 'Winamp Classic 2.91',
  desktop_bg TEXT DEFAULT '#008080',
  profile_customized INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  cover_image TEXT DEFAULT '',
  youtube_playlist_id TEXT DEFAULT '',
  is_youtube_synced INTEGER DEFAULT 0,
  yt_editable INTEGER DEFAULT 1,
  last_synced_at TEXT DEFAULT '',
  position INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL,
  title TEXT NOT NULL,
  artist TEXT DEFAULT 'Unknown Artist',
  url TEXT NOT NULL,
  source_type TEXT NOT NULL,
  youtube_id TEXT,
  yt_set_video_id TEXT DEFAULT '',
  duration INTEGER DEFAULT 0,
  thumbnail_url TEXT DEFAULT '',
  position INTEGER DEFAULT 0,
  added_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists(user_id, position);
CREATE INDEX IF NOT EXISTS idx_playlists_yt ON playlists(user_id, youtube_playlist_id);
CREATE INDEX IF NOT EXISTS idx_tracks_playlist ON tracks(playlist_id, position);

INSERT OR IGNORE INTO users (
  id, email, name, handle, avatar_url, browser_source, cookie_mode, is_active
) VALUES (
  'youtube_primary',
  'muhamadalmuhtadi@gmail.com',
  'muhalmuhtadi',
  '@muhalmuhtadixyz',
  'https://yt3.googleusercontent.com/MTi8Y0YfJuf654JEglJPDAXd2HdQ1AEjUS74ueSpKCiodbn1lxick8SGzvbv7Ryh27UtZCZg=s900-c-k-c0x00ffffff-no-rj',
  'YouTube',
  'cookies_file',
  1
);
