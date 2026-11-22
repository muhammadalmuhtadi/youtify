import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'younamp.db');

export const YOUTUBE_PRIMARY_USER_ID = 'youtube_primary';

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

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
  CREATE INDEX IF NOT EXISTS idx_tracks_playlist ON tracks(playlist_id, position);
`);

for (const migration of [
  "ALTER TABLE users ADD COLUMN handle TEXT DEFAULT ''",
  "ALTER TABLE users ADD COLUMN skin_id TEXT DEFAULT 'base-2.91.wsz'",
  "ALTER TABLE users ADD COLUMN skin_md5 TEXT DEFAULT '5e4f10275dcb1fb211d4a8b4f1bda236'",
  "ALTER TABLE users ADD COLUMN skin_name TEXT DEFAULT 'Winamp Classic 2.91'",
  "ALTER TABLE users ADD COLUMN desktop_bg TEXT DEFAULT '#008080'",
  'ALTER TABLE users ADD COLUMN profile_customized INTEGER DEFAULT 0',
  "ALTER TABLE users ADD COLUMN profile_dir TEXT DEFAULT 'Default'",
  "ALTER TABLE playlists ADD COLUMN youtube_playlist_id TEXT DEFAULT ''",
  'ALTER TABLE playlists ADD COLUMN is_youtube_synced INTEGER DEFAULT 0',
  'ALTER TABLE playlists ADD COLUMN yt_editable INTEGER DEFAULT 1',
  "ALTER TABLE playlists ADD COLUMN last_synced_at TEXT DEFAULT ''",
  "ALTER TABLE tracks ADD COLUMN yt_set_video_id TEXT DEFAULT ''",
]) {
  try {
    db.exec(migration);
  } catch {
    // Column already exists on upgraded SQLite DB
  }
}

db.exec('CREATE INDEX IF NOT EXISTS idx_playlists_yt ON playlists(user_id, youtube_playlist_id);');

export function getAppState(key, fallback = '') {
  const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setAppState(key, value) {
  db.prepare(
    `
    INSERT INTO app_state (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `
  ).run(key, String(value));
}

export function generateId(prefix = 'id') {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

/**
 * Multi-browser session schema setup (auth state controlled strictly per-browser, never shared).
 */
export function ensurePerBrowserSchema() {
  db.exec('BEGIN');
  try {
    db.prepare(
      `
      DELETE FROM playlists
      WHERE user_id IN ('youtube_primary', 'usr_youtube_primary')
         OR (COALESCE(is_youtube_synced, 0) = 0 AND name IN ('Focus & Coding Audio', 'Podcasts & Lectures'))
    `
    ).run();
    db.prepare(
      `
      DELETE FROM users
      WHERE id IN ('youtube_primary', 'usr_youtube_primary')
         OR handle = '@muhalmuhtadixyz'
    `
    ).run();
    db.prepare(
      `
      DELETE FROM app_state
      WHERE key LIKE 'yt_browser_auth:youtube_primary%'
         OR key LIKE 'yt_browser_auth:usr_youtube_primary%'
    `
    ).run();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  try {
    const legacyCookieFile = path.join(DATA_DIR, 'youtube_cookies.txt');
    if (fs.existsSync(legacyCookieFile)) {
      fs.unlinkSync(legacyCookieFile);
    }
  } catch {
    // Ignore cleanup error
  }
}

ensurePerBrowserSchema();

export function getUserById(userId) {
  if (!userId) return null;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId) || null;
}

export function getSingleYouTubeUser(userId = '') {
  return getUserById(userId);
}

export function upsertUserById(
  userId,
  {
    name = 'YouTube Account',
    handle = '',
    email = '',
    avatar_url = '',
    cookie_mode = 'cookies_file',
  } = {}
) {
  if (!userId) throw new Error('userId is required');
  db.exec('BEGIN');
  try {
    const existing = getUserById(userId);
    if (!existing) {
      db.prepare(
        `
        INSERT INTO users (id, email, name, handle, avatar_url, browser_source, cookie_mode, is_active)
        VALUES (?, ?, ?, ?, ?, 'YouTube', ?, 1)
      `
      ).run(userId, email, name, handle, avatar_url, cookie_mode);
    } else {
      db.prepare(
        `
        UPDATE users
        SET name = CASE WHEN ? != '' AND ? != 'YouTube Account' THEN ? ELSE name END,
            handle = CASE WHEN ? != '' THEN ? ELSE handle END,
            email = CASE WHEN ? != '' THEN ? ELSE email END,
            avatar_url = CASE WHEN ? != '' THEN ? ELSE avatar_url END,
            browser_source = 'YouTube',
            cookie_mode = ?,
            is_active = 1
        WHERE id = ?
      `
      ).run(
        name,
        name,
        name,
        handle,
        handle,
        email,
        email,
        avatar_url,
        avatar_url,
        cookie_mode,
        userId
      );
    }
    setAppState(`yt_browser_auth:${userId}`, '1');
    setAppState(`yt_logged_out:${userId}`, '0');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return getUserById(userId);
}

export function upsertSingleYouTubeUser(data = {}, userId = '') {
  return upsertUserById(userId || data.id, data);
}
