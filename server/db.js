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
 * Collapses legacy multi-browser-profile user rows into one canonical YouTube account row
 * (`youtube_primary`), preserving selected skin & desktop settings and removing demo starters.
 */
export function migrateToSingleYouTubeUser() {
  db.exec('BEGIN');
  try {
    const existingPrimary = db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(YOUTUBE_PRIMARY_USER_ID);
    const preferredThemeSource =
      existingPrimary ||
      db.prepare('SELECT * FROM users WHERE is_active = 1 LIMIT 1').get() ||
      db.prepare('SELECT * FROM users LIMIT 1').get();

    if (!existingPrimary) {
      db.prepare(
        `
        INSERT INTO users (
          id, email, name, handle, avatar_url, browser_source, cookie_mode,
          skin_id, skin_md5, skin_name, desktop_bg, is_active
        )
        VALUES (
          ?,
          'muhamadalmuhtadi@gmail.com',
          'muhalmuhtadi',
          '@muhalmuhtadixyz',
          'https://yt3.googleusercontent.com/MTi8Y0YfJuf654JEglJPDAXd2HdQ1AEjUS74ueSpKCiodbn1lxick8SGzvbv7Ryh27UtZCZg=s900-c-k-c0x00ffffff-no-rj',
          'YouTube',
          'cookies_file',
          ?, ?, ?, ?, 1
        )
      `
      ).run(
        YOUTUBE_PRIMARY_USER_ID,
        preferredThemeSource?.skin_id || 'base-2.91.wsz',
        preferredThemeSource?.skin_md5 || '5e4f10275dcb1fb211d4a8b4f1bda236',
        preferredThemeSource?.skin_name || 'Winamp Classic 2.91',
        preferredThemeSource?.desktop_bg || '#008080'
      );
    } else if (existingPrimary.name === 'YouTube Account' || !existingPrimary.handle) {
      db.prepare(
        `
        UPDATE users
        SET name = 'muhalmuhtadi',
            handle = '@muhalmuhtadixyz',
            email = CASE WHEN COALESCE(email, '') = '' THEN 'muhamadalmuhtadi@gmail.com' ELSE email END,
            avatar_url = CASE
              WHEN COALESCE(avatar_url, '') = ''
              THEN 'https://yt3.googleusercontent.com/MTi8Y0YfJuf654JEglJPDAXd2HdQ1AEjUS74ueSpKCiodbn1lxick8SGzvbv7Ryh27UtZCZg=s900-c-k-c0x00ffffff-no-rj'
              ELSE avatar_url
            END,
            is_active = 1
        WHERE id = ?
      `
      ).run(YOUTUBE_PRIMARY_USER_ID);
    }

    // Reassign custom non-demo playlists onto the canonical YouTube user before dropping legacy rows
    db.prepare(
      `
      DELETE FROM playlists
      WHERE COALESCE(is_youtube_synced, 0) = 0
        AND name IN ('Focus & Coding Audio', 'Podcasts & Lectures')
    `
    ).run();

    db.prepare('UPDATE playlists SET user_id = ? WHERE user_id != ?').run(
      YOUTUBE_PRIMARY_USER_ID,
      YOUTUBE_PRIMARY_USER_ID
    );
    db.prepare('DELETE FROM users WHERE id != ?').run(YOUTUBE_PRIMARY_USER_ID);
    db.prepare("UPDATE users SET browser_source = 'YouTube' WHERE id = ?").run(
      YOUTUBE_PRIMARY_USER_ID
    );

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

migrateToSingleYouTubeUser();

export function getSingleYouTubeUser() {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(YOUTUBE_PRIMARY_USER_ID) || null;
}

export function upsertSingleYouTubeUser({
  name = 'YouTube Account',
  handle = '',
  email = '',
  avatar_url = '',
  cookie_mode = 'cookies_file',
} = {}) {
  db.exec('BEGIN');
  try {
    const existing = getSingleYouTubeUser();
    if (!existing) {
      db.prepare(
        `
        INSERT INTO users (id, email, name, handle, avatar_url, browser_source, cookie_mode, is_active)
        VALUES (?, ?, ?, ?, ?, 'YouTube', ?, 1)
      `
      ).run(YOUTUBE_PRIMARY_USER_ID, email, name, handle, avatar_url, cookie_mode);
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
        YOUTUBE_PRIMARY_USER_ID
      );
    }
    setAppState('yt_logged_out', '0');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return getSingleYouTubeUser();
}
