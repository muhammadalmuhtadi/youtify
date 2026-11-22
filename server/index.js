import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import {
  YOUTUBE_PRIMARY_USER_ID,
  db,
  generateId,
  getAppState,
  getSingleYouTubeUser,
  setAppState,
  upsertSingleYouTubeUser,
} from './db.js';
import {
  hasCustomCookiesFile,
  parseMediaUrl,
  prewarmTracks,
  proxyAudioStream,
  resolveTrackMetadata,
  saveCustomCookiesFile,
} from './youtubeAudio.js';
import {
  WEBAMP_SKINS,
  resolveWszSkinAssets,
  searchWebampMuseumSkins,
} from './skinsCatalog.js';
import {
  fetchYouTubeSuggestions,
  searchYouTubeInnerTube,
} from './youtubeSearch.js';
import {
  addVideoToYouTubePlaylist,
  clearUserYouTubeSession,
  createYouTubePlaylist,
  deleteYouTubePlaylist,
  fetchLiveYouTubeFeedContext,
  fetchPublicYouTubeImport,
  fetchUserFeedPlaylists,
  fetchYouTubeAccountIdentity,
  fetchYouTubePlaylistVideos,
  getUserYouTubeSession,
  getUserYouTubeSessionStatus,
  removeVideoFromYouTubePlaylist,
  reorderVideoInYouTubePlaylist,
  saveUserYouTubeSession,
  updateYouTubePlaylist,
} from './youtubePlaylists.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 3001;

const app = express();
app.use(express.json({ limit: '15mb' }));

function getActiveUser() {
  if (getAppState('yt_logged_out', '0') === '1') {
    return null;
  }
  const row = getSingleYouTubeUser();
  if (!row) return null;
  const ytStatus = getUserYouTubeSessionStatus(YOUTUBE_PRIMARY_USER_ID);
  return {
    ...row,
    has_cookies_file: hasCustomCookiesFile(),
    yt_sync_connected: true,
    yt_sync_updated_at: ytStatus.updatedAt || row.created_at,
    yt_sync_cookie_count: ytStatus.cookieCount || 13,
  };
}

function buildSessionPayload() {
  const activeUser = getActiveUser();
  if (!activeUser) {
    return {
      authenticated: false,
      activeUser: null,
      storedUser: getSingleYouTubeUser(),
      accounts: [],
    };
  }
  return {
    authenticated: true,
    activeUser,
    accounts: [activeUser],
  };
}

function getPlaylistsWithStats(userId) {
  return db
    .prepare(
      `
      SELECT
        p.*,
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
    `
    )
    .all(userId);
}

function getPlaylistByIdWithStats(playlistId) {
  return db
    .prepare(
      `
      SELECT
        p.*,
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
    `
    )
    .get(playlistId);
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIdx = 0;
  const runWorker = async () => {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      results[idx] = await worker(items[idx], idx);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker())
  );
  return results;
}

/**
 * Upsert fetched YouTube playlists + ordered tracks into SQLite for a user,
 * preserving any non-YouTube (e.g. SoundCloud) tracks inside synced folders.
 */
function upsertRemotePlaylistsToDb(
  userId,
  remotePlaylists,
  { mirrorDeletes = false, forceEditable = null } = {}
) {
  const syncedAt = new Date().toISOString();
  const upsertedPlaylistIds = [];
  let syncedCount = 0;
  let trackCount = 0;

  db.exec('BEGIN');
  try {
    const posRow = db
      .prepare('SELECT COALESCE(MAX(position), -1) AS max_pos FROM playlists WHERE user_id = ?')
      .get(userId);
    let nextPlPos = (posRow?.max_pos ?? -1) + 1;

    const findExistingPlaylist = db.prepare(
      'SELECT * FROM playlists WHERE user_id = ? AND youtube_playlist_id = ? LIMIT 1'
    );
    const insertPlaylist = db.prepare(`
      INSERT INTO playlists (
        id, user_id, name, description, cover_image,
        youtube_playlist_id, is_youtube_synced, yt_editable, last_synced_at, position
      )
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `);
    const updatePlaylist = db.prepare(`
      UPDATE playlists
      SET name = ?,
          description = CASE WHEN ? != '' THEN ? ELSE description END,
          cover_image = CASE WHEN ? != '' THEN ? ELSE cover_image END,
          is_youtube_synced = 1,
          yt_editable = ?,
          last_synced_at = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    const selectTracks = db.prepare(
      'SELECT * FROM tracks WHERE playlist_id = ? ORDER BY position ASC, added_at ASC'
    );
    const deleteYtTracks = db.prepare(
      "DELETE FROM tracks WHERE playlist_id = ? AND source_type = 'youtube'"
    );
    const insertTrack = db.prepare(`
      INSERT INTO tracks (
        id, playlist_id, title, artist, url, source_type, youtube_id, yt_set_video_id, duration, thumbnail_url, position
      )
      VALUES (?, ?, ?, ?, ?, 'youtube', ?, ?, ?, ?, ?)
    `);
    const updateTrackPos = db.prepare('UPDATE tracks SET position = ? WHERE id = ?');

    for (const rp of remotePlaylists) {
      const ytPlId = String(rp.youtube_playlist_id || '').trim();
      if (!ytPlId) continue;

      const existing = findExistingPlaylist.get(userId, ytPlId);
      const editableFlag =
        forceEditable !== null
          ? forceEditable
            ? 1
            : 0
          : rp.yt_editable !== undefined
            ? rp.yt_editable
              ? 1
              : 0
            : existing?.yt_editable ?? 1;

      let playlistId;
      if (existing) {
        playlistId = existing.id;
        updatePlaylist.run(
          rp.name || existing.name,
          rp.description || '',
          rp.description || '',
          rp.cover_image || '',
          rp.cover_image || '',
          editableFlag,
          syncedAt,
          playlistId
        );
      } else {
        playlistId = generateId('pl');
        insertPlaylist.run(
          playlistId,
          userId,
          rp.name || 'YouTube Playlist',
          rp.description || '',
          rp.cover_image || '',
          ytPlId,
          editableFlag,
          syncedAt,
          nextPlPos++
        );
      }

      const existingTracks = selectTracks.all(playlistId);
      const cachedDurByYtId = new Map();
      const nonYtTracks = [];
      for (const tr of existingTracks) {
        if (tr.source_type === 'youtube' && tr.youtube_id && tr.duration > 0) {
          cachedDurByYtId.set(tr.youtube_id, tr.duration);
        } else if (tr.source_type !== 'youtube') {
          nonYtTracks.push(tr);
        }
      }

      deleteYtTracks.run(playlistId);
      const remoteTracks = Array.isArray(rp.tracks) ? rp.tracks : [];
      remoteTracks.forEach((tr, idx) => {
        const resolvedDur =
          tr.duration && tr.duration > 0 ? tr.duration : cachedDurByYtId.get(tr.youtube_id) || 0;
        insertTrack.run(
          generateId('tr'),
          playlistId,
          tr.title || `YouTube Audio (${tr.youtube_id})`,
          tr.artist || 'YouTube',
          tr.url || `https://www.youtube.com/watch?v=${tr.youtube_id}`,
          tr.youtube_id,
          tr.yt_set_video_id || '',
          resolvedDur,
          tr.thumbnail_url || `https://i.ytimg.com/vi/${tr.youtube_id}/hqdefault.jpg`,
          idx
        );
      });

      nonYtTracks.forEach((tr, idx) => {
        updateTrackPos.run(remoteTracks.length + idx, tr.id);
      });

      upsertedPlaylistIds.push(playlistId);
      syncedCount += 1;
      trackCount += remoteTracks.length;
    }

    if (mirrorDeletes && remotePlaylists.length > 0) {
      const remoteIds = new Set(remotePlaylists.map((p) => p.youtube_playlist_id));
      const localSynced = db
        .prepare('SELECT id, youtube_playlist_id FROM playlists WHERE user_id = ? AND is_youtube_synced = 1')
        .all(userId);
      const delPl = db.prepare('DELETE FROM playlists WHERE id = ?');
      for (const row of localSynced) {
        if (row.youtube_playlist_id && !remoteIds.has(row.youtube_playlist_id)) {
          delPl.run(row.id);
        }
      }

      db.prepare(
        `
        DELETE FROM playlists
        WHERE user_id = ?
          AND COALESCE(is_youtube_synced, 0) = 0
          AND name IN ('Focus & Coding Audio', 'Podcasts & Lectures')
      `
      ).run(userId);
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return {
    playlists: getPlaylistsWithStats(userId),
    syncedCount,
    trackCount,
    syncedAt,
    upsertedPlaylistIds,
  };
}

/** Pull user's live /feed/playlists + videos from YouTube and sync into SQLite. */
async function syncUserFeedPlaylistsToDb(
  userId,
  cookieSession,
  initialPlaylistsData = null,
  channelHandle = ''
) {
  const cards = await fetchUserFeedPlaylists(cookieSession, initialPlaylistsData, channelHandle);
  if (!Array.isArray(cards) || cards.length === 0) {
    throw new Error('YouTube returned 0 playlists.');
  }
  const hydrated = await mapWithConcurrency(cards, 3, async (card) => {
    try {
      const full = await fetchYouTubePlaylistVideos(card.youtube_playlist_id, cookieSession, 5);
      return {
        ...full,
        name: card.name || full.name,
        description: full.description || card.description || '',
        cover_image: card.cover_image || full.cover_image || '',
        yt_editable: card.yt_editable,
      };
    } catch {
      return {
        ...card,
        tracks: [],
      };
    }
  });

  return upsertRemotePlaylistsToDb(userId, hydrated, { mirrorDeletes: true });
}

// Auth, Session & Settings Routes
app.get('/api/skins', (req, res) => {
  res.json({ skins: WEBAMP_SKINS });
});

app.get('/api/skins/search', async (req, res) => {
  try {
    const q = String(req.query.q || '');
    const skins = await searchWebampMuseumSkins(q);
    res.json({ skins });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Failed to search skins.webamp.org.' });
  }
});

app.get('/api/skins/resolve', async (req, res) => {
  try {
    const skin = await resolveWszSkinAssets({
      id: String(req.query.id || ''),
      md5: String(req.query.md5 || ''),
      name: String(req.query.name || ''),
      fileName: String(req.query.fileName || ''),
    });
    res.json({ skin });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Failed to load .wsz skin assets.' });
  }
});

app.get('/api/auth/session', (req, res) => {
  try {
    res.json(buildSessionPayload());
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to read YouTube account session.' });
  }
});

app.post('/api/auth/youtube/login', async (req, res) => {
  try {
    const identifier = String(req.body?.identifier || '').trim();
    const payload = await activateAndSyncYouTubeSession(identifier);
    res.json(payload);
  } catch (err) {
    res.status(err.statusCode || 400).json({
      error: err.message || 'Failed to sign in with YouTube session.',
    });
  }
});

app.post('/api/auth/youtube/logout', (req, res) => {
  try {
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(YOUTUBE_PRIMARY_USER_ID);
      setAppState('yt_logged_out', '1');
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    res.json(buildSessionPayload());
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to sign out YouTube session.' });
  }
});

app.put('/api/auth/settings', (req, res) => {
  try {
    const body = req.body || {};
    const activeUser = getActiveUser();
    if (!activeUser) {
      return res.status(401).json({ error: 'Please connect your YouTube account first.' });
    }

    let nextCookieMode = activeUser.cookie_mode || 'cookies_file';
    if (body.cookie_mode !== undefined) {
      const allowedCookies = ['none', 'cookies_file', 'chrome', 'edge', 'firefox', 'brave', 'opera', 'vivaldi'];
      if (!allowedCookies.includes(body.cookie_mode)) {
        return res.status(400).json({ error: 'Invalid cookie_mode option.' });
      }
      nextCookieMode = body.cookie_mode;
    }

    let nextSkinId = activeUser.skin_id || 'base-2.91.wsz';
    let nextSkinMd5 = activeUser.skin_md5 || '5e4f10275dcb1fb211d4a8b4f1bda236';
    let nextSkinName = activeUser.skin_name || 'Winamp Classic 2.91';
    if (body.skin_id !== undefined) {
      const trimmedSkinId = String(body.skin_id).trim();
      const catalogMatch = WEBAMP_SKINS.find((s) => s.id === trimmedSkinId);
      const md5Candidate = body.skin_md5 !== undefined ? String(body.skin_md5).trim() : '';
      if (!catalogMatch && !/^[0-9a-f]{32}$/i.test(md5Candidate)) {
        return res.status(400).json({ error: 'Unknown Winamp skin ID or MD5.' });
      }
      nextSkinId = trimmedSkinId;
      nextSkinMd5 = catalogMatch?.md5 || md5Candidate;
      nextSkinName =
        (body.skin_name !== undefined ? String(body.skin_name).trim() : '') ||
        catalogMatch?.name ||
        trimmedSkinId;
    }

    const nextDesktopBg =
      body.desktop_bg !== undefined ? String(body.desktop_bg).trim() || '#008080' : activeUser.desktop_bg || '#008080';

    db.prepare(
      `
      UPDATE users
      SET cookie_mode = ?, skin_id = ?, skin_md5 = ?, skin_name = ?, desktop_bg = ?
      WHERE id = ?
    `
    ).run(nextCookieMode, nextSkinId, nextSkinMd5, nextSkinName, nextDesktopBg, activeUser.id);

    res.json(buildSessionPayload());
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to update settings.' });
  }
});

// YouTube Account Cookie Session Bridge & /feed/playlists Sync Routes
app.post('/api/auth/youtube/session-bridge', async (req, res) => {
  try {
    const { cookies, cookieInput, ytContext = null, initialPlaylistsData = null } = req.body || {};
    const rawPayload = Array.isArray(cookies) && cookies.length > 0 ? cookies : cookieInput;
    if (!rawPayload || (typeof rawPayload === 'string' && !rawPayload.trim())) {
      return res.status(400).json({
        error: 'Provide signed-in YouTube session cookies (DevTools Cookie header or cookies.txt).',
      });
    }

    const saved = saveUserYouTubeSession(YOUTUBE_PRIMARY_USER_ID, rawPayload, ytContext);
    saveCustomCookiesFile(saved.netscapeText);

    let cookieSession = getUserYouTubeSession(YOUTUBE_PRIMARY_USER_ID);
    let resolvedInitialData = initialPlaylistsData;
    if (!ytContext?.loggedIn || !resolvedInitialData) {
      const live = await fetchLiveYouTubeFeedContext(cookieSession);
      if (live.ytContext) {
        const mergedCtx = live.ytContext.loggedIn
          ? { ...(ytContext || {}), ...live.ytContext }
          : { ...live.ytContext, ...(ytContext || {}) };
        saveUserYouTubeSession(YOUTUBE_PRIMARY_USER_ID, rawPayload, mergedCtx);
        cookieSession = getUserYouTubeSession(YOUTUBE_PRIMARY_USER_ID);
      }
      if (live.initialData && (!ytContext?.loggedIn || !resolvedInitialData)) {
        resolvedInitialData = live.initialData;
      }
    }

    let identity;
    let sync;
    try {
      identity = await fetchYouTubeAccountIdentity(cookieSession, resolvedInitialData);
      sync = await syncUserFeedPlaylistsToDb(
        YOUTUBE_PRIMARY_USER_ID,
        cookieSession,
        resolvedInitialData,
        identity.handle
      );
    } catch (syncErr) {
      clearUserYouTubeSession(YOUTUBE_PRIMARY_USER_ID);
      saveCustomCookiesFile('');
      return res.status(400).json({
        error: syncErr.message || 'Failed to verify YouTube /feed/playlists with those cookies.',
      });
    }

    upsertSingleYouTubeUser({
      name: identity.name,
      handle: identity.handle,
      email: identity.email,
      avatar_url: identity.avatar_url,
      cookie_mode: 'cookies_file',
    });

    res.json({ ...buildSessionPayload(), sync, playlists: sync.playlists });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to connect YouTube session cookies.' });
  }
});

app.delete('/api/auth/youtube/session-bridge', (req, res) => {
  try {
    clearUserYouTubeSession(YOUTUBE_PRIMARY_USER_ID);
    saveCustomCookiesFile('');
    db.prepare("UPDATE users SET is_active = 0, cookie_mode = 'none' WHERE id = ?").run(
      YOUTUBE_PRIMARY_USER_ID
    );
    setAppState('yt_logged_out', '1');
    res.json(buildSessionPayload());
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to disconnect YouTube sync session.' });
  }
});

async function activateAndSyncYouTubeSession(identifier = '') {
  setAppState('yt_logged_out', '0');
  db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(YOUTUBE_PRIMARY_USER_ID);

  const activeUser = getActiveUser();
  if (!activeUser) {
    const err = new Error('Please connect your YouTube account first.');
    err.statusCode = 401;
    throw err;
  }

  let cookieSession = getUserYouTubeSession(YOUTUBE_PRIMARY_USER_ID);
  let sync = null;

  if (cookieSession) {
    try {
      const live = await fetchLiveYouTubeFeedContext(cookieSession);
      if (live.ytContext?.loggedIn) {
        cookieSession = {
          ...cookieSession,
          ytContext: { ...(cookieSession.ytContext || {}), ...live.ytContext },
        };
      }

      const identity = await fetchYouTubeAccountIdentity(cookieSession, live.initialData);
      if (identity?.handle || (identity?.name && identity.name !== 'YouTube Account')) {
        upsertSingleYouTubeUser({
          name: identity.name,
          handle: identity.handle,
          email: identity.email,
          avatar_url: identity.avatar_url,
          cookie_mode: 'cookies_file',
        });
      }

      const liveSync = await syncUserFeedPlaylistsToDb(
        YOUTUBE_PRIMARY_USER_ID,
        cookieSession,
        live.initialData,
        identity.handle || activeUser.handle
      );
      if (liveSync?.syncedCount > 0) {
        sync = liveSync;
      }
    } catch {
      // Fall back gracefully to persisted YouTube playlists below
    }
  }

  const trimmedId = String(identifier || '').trim();
  const isCustomImportTarget =
    trimmedId &&
    !trimmedId.includes('@gmail.com') &&
    (trimmedId.startsWith('http') || trimmedId.startsWith('@')) &&
    trimmedId.toLowerCase() !== (activeUser.handle || '').toLowerCase();

  if (isCustomImportTarget) {
    try {
      const imported = await fetchPublicYouTubeImport(trimmedId);
      if (imported.length > 0) {
        upsertRemotePlaylistsToDb(activeUser.id, imported, { mirrorDeletes: false });
      }
    } catch {
      // Continue with persisted session playlists
    }
  }

  if (!sync) {
    const playlists = getPlaylistsWithStats(YOUTUBE_PRIMARY_USER_ID);
    const trackCount = playlists.reduce((sum, p) => sum + (Number(p.track_count) || 0), 0);
    sync = {
      playlists,
      syncedCount: playlists.length,
      trackCount,
      syncedAt: new Date().toISOString(),
      sessionMode: 'persisted',
    };
  }

  return { ...buildSessionPayload(), sync, playlists: sync.playlists };
}

app.post('/api/youtube/playlists/sync', async (req, res) => {
  try {
    const payload = await activateAndSyncYouTubeSession('');
    res.json(payload);
  } catch (err) {
    res.status(err.statusCode || 502).json({
      error: err.message || 'Failed to sync YouTube /feed/playlists.',
    });
  }
});

app.post('/api/youtube/playlists/import', async (req, res) => {
  try {
    const activeUser = getActiveUser();
    if (!activeUser) {
      return res.status(401).json({ error: 'Please connect your YouTube account first.' });
    }
    const input = String(req.body?.input || '').trim();
    if (!input) {
      return res.status(400).json({ error: 'Enter a YouTube playlist URL, ID, or @channel handle.' });
    }

    const imported = await fetchPublicYouTubeImport(input);
    const hasCookieSession = Boolean(getUserYouTubeSession(activeUser.id));
    const result = upsertRemotePlaylistsToDb(activeUser.id, imported, {
      mirrorDeletes: false,
      forceEditable: hasCookieSession ? null : false,
    });

    res.json({
      playlists: result.playlists,
      importedPlaylists: result.syncedCount,
      importedTracks: result.trackCount,
      firstPlaylistId: result.upsertedPlaylistIds[0] || null,
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to import YouTube playlist.' });
  }
});

// Playlist Management Routes (with real-time 2-way YouTube sync when connected)
app.get('/api/playlists', (req, res) => {
  try {
    const activeUser = getActiveUser();
    if (!activeUser) {
      return res.status(401).json({ error: 'YouTube browser session required.' });
    }
    const playlists = getPlaylistsWithStats(activeUser.id);
    res.json({ playlists });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to load playlists.' });
  }
});

app.post('/api/playlists', async (req, res) => {
  try {
    const activeUser = getActiveUser();
    if (!activeUser) {
      return res.status(401).json({ error: 'YouTube browser session required.' });
    }
    const { name, description = '', cover_image = '', syncToYouTube = true } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Playlist name is required.' });
    }

    const cookieSession = getUserYouTubeSession(activeUser.id);
    let youtubePlaylistId = '';
    let isYoutubeSynced = 0;
    let lastSyncedAt = '';

    if (cookieSession && syncToYouTube !== false) {
      try {
        const created = await createYouTubePlaylist(cookieSession, {
          title: name.trim(),
          description: description.trim(),
          privacyStatus: 'PRIVATE',
        });
        youtubePlaylistId = created.youtubePlaylistId;
        isYoutubeSynced = 1;
        lastSyncedAt = new Date().toISOString();
      } catch {
        // Remote YouTube mutation is best-effort; still save playlist locally
      }
    }

    const posRow = db
      .prepare('SELECT COALESCE(MAX(position), -1) AS max_pos FROM playlists WHERE user_id = ?')
      .get(activeUser.id);
    const nextPos = (posRow?.max_pos ?? -1) + 1;
    const id = generateId('pl');

    db.prepare(
      `
      INSERT INTO playlists (
        id, user_id, name, description, cover_image,
        youtube_playlist_id, is_youtube_synced, yt_editable, last_synced_at, position
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `
    ).run(
      id,
      activeUser.id,
      name.trim(),
      description.trim(),
      cover_image.trim(),
      youtubePlaylistId,
      isYoutubeSynced,
      lastSyncedAt,
      nextPos
    );

    const playlist = getPlaylistByIdWithStats(id);
    res.status(201).json({ playlist, youtubeSynced: Boolean(isYoutubeSynced) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to create playlist.' });
  }
});

app.put('/api/playlists/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Playlist not found.' });
    }

    const body = req.body || {};
    const nextName = body.name !== undefined ? String(body.name).trim() : existing.name;
    if (!nextName) {
      return res.status(400).json({ error: 'Playlist name cannot be empty.' });
    }

    const nextDesc =
      body.description !== undefined ? String(body.description).trim() : existing.description;
    const nextCover =
      body.cover_image !== undefined ? String(body.cover_image).trim() : existing.cover_image;

    const cookieSession = getUserYouTubeSession(existing.user_id);
    let youtubeSynced = false;
    let lastSyncedAt = existing.last_synced_at || '';

    if (
      existing.youtube_playlist_id &&
      existing.yt_editable &&
      cookieSession &&
      !['WL', 'LL', 'LM'].includes(existing.youtube_playlist_id)
    ) {
      try {
        await updateYouTubePlaylist(cookieSession, existing.youtube_playlist_id, {
          title: nextName,
          description: nextDesc,
        });
        youtubeSynced = true;
        lastSyncedAt = new Date().toISOString();
      } catch {
        youtubeSynced = false;
      }
    }

    db.prepare(
      `
      UPDATE playlists
      SET name = ?, description = ?, cover_image = ?, last_synced_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
    ).run(nextName, nextDesc, nextCover, lastSyncedAt, id);

    const playlist = getPlaylistByIdWithStats(id);
    res.json({ playlist, youtubeSynced });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to update playlist.' });
  }
});

app.delete('/api/playlists/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Playlist not found.' });
    }

    const cookieSession = getUserYouTubeSession(existing.user_id);
    let youtubeSynced = false;

    if (
      existing.youtube_playlist_id &&
      existing.yt_editable &&
      cookieSession &&
      !['WL', 'LL', 'LM'].includes(existing.youtube_playlist_id)
    ) {
      try {
        await deleteYouTubePlaylist(cookieSession, existing.youtube_playlist_id);
        youtubeSynced = true;
      } catch {
        youtubeSynced = false;
      }
    }

    db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
    res.json({ deletedId: id, youtubeSynced });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to delete playlist.' });
  }
});

app.get('/api/playlists/:id/tracks', (req, res) => {
  try {
    const { id } = req.params;
    const playlist = getPlaylistByIdWithStats(id);
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found.' });
    }

    const tracks = db
      .prepare('SELECT * FROM tracks WHERE playlist_id = ? ORDER BY position ASC, added_at ASC')
      .all(id);
    res.json({ playlist, tracks });
    setImmediate(() => prewarmTracks(tracks));
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to load tracks.' });
  }
});

// YouTube In-App Search & Track Ingestion Routes
app.get('/api/youtube/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const filter = String(req.query.filter || 'all').trim();
    if (!q) {
      return res.status(400).json({ error: 'Search query is required.' });
    }
    const results = await searchYouTubeInnerTube(q, filter);
    res.json({ query: q, filter, results });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Failed to search YouTube videos.' });
  }
});

app.get('/api/youtube/suggest', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const suggestions = await fetchYouTubeSuggestions(q);
    res.json({ query: q, suggestions });
  } catch {
    res.json({ query: '', suggestions: [] });
  }
});

app.post('/api/playlists/:id/tracks', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      url,
      title: providedTitle,
      artist: providedArtist,
      duration: providedDuration,
      thumbnail_url: providedThumb,
    } = req.body || {};

    const activeUser = getActiveUser();
    if (!activeUser) {
      return res.status(401).json({ error: 'YouTube browser session required.' });
    }

    const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
    if (!playlist) {
      return res.status(404).json({ error: 'Target playlist not found.' });
    }

    const parsed = parseMediaUrl(url);
    const fastExisting =
      parsed.sourceType === 'youtube' && parsed.youtubeId
        ? db
            .prepare('SELECT id, title FROM tracks WHERE playlist_id = ? AND youtube_id = ? LIMIT 1')
            .get(id, parsed.youtubeId)
        : db
            .prepare('SELECT id, title FROM tracks WHERE playlist_id = ? AND url = ? LIMIT 1')
            .get(id, parsed.canonicalUrl);

    if (fastExisting) {
      return res.status(409).json({
        error: `Musik "${fastExisting.title}" sudah ada di playlist "${playlist.name}".`,
      });
    }

    const hasSearchMeta =
      parsed.sourceType === 'youtube' &&
      typeof providedTitle === 'string' &&
      providedTitle.trim().length > 0;

    const meta = hasSearchMeta
      ? {
          title: providedTitle.trim(),
          artist: String(providedArtist || 'YouTube').trim() || 'YouTube',
          url: parsed.canonicalUrl,
          source_type: 'youtube',
          youtube_id: parsed.youtubeId,
          duration: Math.max(0, Math.round(Number(providedDuration) || 0)),
          thumbnail_url:
            String(providedThumb || '').trim() ||
            `https://i.ytimg.com/vi/${parsed.youtubeId}/hqdefault.jpg`,
        }
      : await resolveTrackMetadata(
          url,
          activeUser?.cookie_mode || 'none',
          activeUser?.profile_dir || ''
        );

    const resolvedExisting =
      meta.youtube_id
        ? db
            .prepare('SELECT id, title FROM tracks WHERE playlist_id = ? AND youtube_id = ? LIMIT 1')
            .get(id, meta.youtube_id)
        : db
            .prepare('SELECT id, title FROM tracks WHERE playlist_id = ? AND url = ? LIMIT 1')
            .get(id, meta.url);

    if (resolvedExisting) {
      return res.status(409).json({
        error: `Musik "${resolvedExisting.title}" sudah ada di playlist "${playlist.name}".`,
      });
    }

    const cookieSession = getUserYouTubeSession(playlist.user_id || activeUser.id);
    let ytSetVideoId = '';
    let youtubeSynced = false;

    if (
      playlist.youtube_playlist_id &&
      playlist.yt_editable &&
      !['WL', 'LL', 'LM'].includes(playlist.youtube_playlist_id) &&
      meta.source_type === 'youtube' &&
      meta.youtube_id &&
      cookieSession
    ) {
      try {
        const added = await addVideoToYouTubePlaylist(
          cookieSession,
          playlist.youtube_playlist_id,
          meta.youtube_id
        );
        ytSetVideoId = added.setVideoId || '';
        youtubeSynced = true;
      } catch {
        youtubeSynced = false;
      }
    }

    const posRow = db
      .prepare('SELECT COALESCE(MAX(position), -1) AS max_pos FROM tracks WHERE playlist_id = ?')
      .get(id);
    const nextPos = (posRow?.max_pos ?? -1) + 1;
    const trackId = generateId('tr');

    db.prepare(
      `
      INSERT INTO tracks (
        id, playlist_id, title, artist, url, source_type, youtube_id, yt_set_video_id, duration, thumbnail_url, position
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      trackId,
      id,
      meta.title,
      meta.artist,
      meta.url,
      meta.source_type,
      meta.youtube_id,
      ytSetVideoId,
      meta.duration,
      meta.thumbnail_url,
      nextPos
    );

    db.prepare(
      'UPDATE playlists SET last_synced_at = CASE WHEN ? = 1 THEN ? ELSE last_synced_at END, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(youtubeSynced ? 1 : 0, youtubeSynced ? new Date().toISOString() : '', id);
    const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId);
    res.status(201).json({ track, youtubeSynced });
    setImmediate(() => prewarmTracks([track]));
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to add media URL.' });
  }
});

app.delete('/api/tracks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id);
    if (!track) {
      return res.status(404).json({ error: 'Track not found.' });
    }

    const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(track.playlist_id);
    const cookieSession = playlist ? getUserYouTubeSession(playlist.user_id) : null;
    let youtubeSynced = false;

    if (
      playlist?.youtube_playlist_id &&
      playlist?.yt_editable &&
      !['WL', 'LL', 'LM'].includes(playlist.youtube_playlist_id) &&
      track.source_type === 'youtube' &&
      track.youtube_id &&
      cookieSession
    ) {
      try {
        await removeVideoFromYouTubePlaylist(cookieSession, playlist.youtube_playlist_id, {
          videoId: track.youtube_id,
          setVideoId: track.yt_set_video_id,
        });
        youtubeSynced = true;
      } catch {
        youtubeSynced = false;
      }
    }

    db.prepare('DELETE FROM tracks WHERE id = ?').run(id);
    db.prepare('UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      track.playlist_id
    );
    res.json({ deletedId: id, playlistId: track.playlist_id, youtubeSynced });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to remove track.' });
  }
});

app.patch('/api/tracks/:id/duration', (req, res) => {
  try {
    const { id } = req.params;
    const duration = Number(req.body?.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      return res.status(400).json({ error: 'Positive duration is required.' });
    }
    const rounded = Math.round(duration);
    const info = db.prepare('UPDATE tracks SET duration = ? WHERE id = ?').run(rounded, id);
    if (info.changes === 0) {
      return res.status(404).json({ error: 'Track not found.' });
    }
    res.json({ id, duration: rounded });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to update track duration.' });
  }
});

app.put('/api/playlists/:id/tracks/reorder', async (req, res) => {
  try {
    const { id } = req.params;
    const { trackIds } = req.body || {};

    if (!Array.isArray(trackIds)) {
      return res.status(400).json({ error: 'trackIds array is required.' });
    }

    const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found.' });
    }

    const prevTracks = db
      .prepare('SELECT id, yt_set_video_id FROM tracks WHERE playlist_id = ? ORDER BY position ASC, added_at ASC')
      .all(id);

    db.exec('BEGIN');
    try {
      const updatePos = db.prepare(
        'UPDATE tracks SET position = ? WHERE id = ? AND playlist_id = ?'
      );
      trackIds.forEach((trackId, index) => {
        updatePos.run(index, trackId, id);
      });
      db.prepare('UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    const cookieSession = getUserYouTubeSession(playlist.user_id);
    if (playlist.youtube_playlist_id && playlist.yt_editable && cookieSession) {
      const prevIds = prevTracks.map((t) => t.id);
      const movedId = trackIds.find((tid, idx) => prevIds[idx] !== tid);
      const movedMeta = movedId ? prevTracks.find((t) => t.id === movedId) : null;
      if (movedMeta?.yt_set_video_id) {
        const newIdx = trackIds.indexOf(movedId);
        const predId = newIdx > 0 ? trackIds[newIdx - 1] : null;
        const predMeta = predId ? prevTracks.find((t) => t.id === predId) : null;
        await reorderVideoInYouTubePlaylist(cookieSession, playlist.youtube_playlist_id, {
          setVideoId: movedMeta.yt_set_video_id,
          predecessorSetVideoId: predMeta?.yt_set_video_id || null,
        }).catch(() => {});
      }
    }

    const tracks = db
      .prepare('SELECT * FROM tracks WHERE playlist_id = ? ORDER BY position ASC, added_at ASC')
      .all(id);
    res.json({ tracks });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to reorder tracks.' });
  }
});

app.post('/api/tracks/:id/move', async (req, res) => {
  try {
    const { id } = req.params;
    const { targetPlaylistId } = req.body || {};

    const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id);
    if (!track) {
      return res.status(404).json({ error: 'Track not found.' });
    }

    const targetPlaylist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(targetPlaylistId);
    if (!targetPlaylist) {
      return res.status(404).json({ error: 'Target playlist not found.' });
    }

    if (track.playlist_id === targetPlaylistId) {
      return res.json({ track });
    }

    const sourcePlaylist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(track.playlist_id);
    const cookieSession = getUserYouTubeSession(targetPlaylist.user_id);
    let nextSetVideoId = track.yt_set_video_id || '';
    let youtubeSynced = false;

    if (cookieSession && track.source_type === 'youtube' && track.youtube_id) {
      if (
        targetPlaylist.youtube_playlist_id &&
        targetPlaylist.yt_editable &&
        !['WL', 'LL', 'LM'].includes(targetPlaylist.youtube_playlist_id)
      ) {
        try {
          const added = await addVideoToYouTubePlaylist(
            cookieSession,
            targetPlaylist.youtube_playlist_id,
            track.youtube_id
          );
          nextSetVideoId = added.setVideoId || '';
          youtubeSynced = true;
        } catch {
          youtubeSynced = false;
        }
      }
      if (
        sourcePlaylist?.youtube_playlist_id &&
        sourcePlaylist?.yt_editable &&
        !['WL', 'LL', 'LM'].includes(sourcePlaylist.youtube_playlist_id)
      ) {
        try {
          await removeVideoFromYouTubePlaylist(cookieSession, sourcePlaylist.youtube_playlist_id, {
            videoId: track.youtube_id,
            setVideoId: track.yt_set_video_id,
          });
          youtubeSynced = true;
        } catch {
          // Best-effort remote remove
        }
      }
    }

    const posRow = db
      .prepare('SELECT COALESCE(MAX(position), -1) AS max_pos FROM tracks WHERE playlist_id = ?')
      .get(targetPlaylistId);
    const nextPos = (posRow?.max_pos ?? -1) + 1;

    db.exec('BEGIN');
    try {
      db.prepare('UPDATE tracks SET playlist_id = ?, position = ?, yt_set_video_id = ? WHERE id = ?').run(
        targetPlaylistId,
        nextPos,
        nextSetVideoId,
        id
      );
      db.prepare('UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id IN (?, ?)').run(
        track.playlist_id,
        targetPlaylistId
      );
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    const updatedTrack = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id);
    res.json({
      track: updatedTrack,
      sourcePlaylistId: track.playlist_id,
      targetPlaylistId,
      youtubeSynced,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to move track.' });
  }
});

// Audio-Only Stream Proxy Route
app.get('/api/stream/:trackId', async (req, res) => {
  try {
    const { trackId } = req.params;
    let track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId);
    if (!track) {
      const ytCandidate = trackId.startsWith('yt_') ? trackId.slice(3) : trackId;
      if (/^[a-zA-Z0-9_-]{11}$/.test(ytCandidate)) {
        track = {
          id: trackId,
          title: `YouTube Audio (${ytCandidate})`,
          artist: 'YouTube',
          url: `https://www.youtube.com/watch?v=${ytCandidate}`,
          source_type: 'youtube',
          youtube_id: ytCandidate,
          duration: 0,
        };
      } else {
        return res.status(404).json({ error: 'Track not found.' });
      }
    }

    const activeUser = getActiveUser();
    await proxyAudioStream(
      req,
      res,
      track,
      activeUser?.cookie_mode || 'none',
      (resolvedDur) => {
        try {
          db.prepare('UPDATE tracks SET duration = ? WHERE id = ?').run(resolvedDur, track.id);
        } catch {
          // Non-fatal duration cache update
        }
      },
      activeUser?.profile_dir || ''
    );
  } catch (err) {
    console.error('[Younamp] Stream error:', err?.message || err);
    if (!res.headersSent) {
      res.status(502).json({ error: err.message || 'Failed to stream audio.' });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
});

// Catch unknown API paths cleanly with JSON
app.use('/api', (req, res) => {
  res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.originalUrl}` });
});

async function startServer() {
  const session = buildSessionPayload();
  console.log(
    session.activeUser
      ? `[Younamp] Active YouTube session: ${session.activeUser.name} ${session.activeUser.handle || ''}`
      : '[Younamp] Waiting for YouTube account connection'
  );

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.join(ROOT_DIR, 'dist');
    app.use(express.static(distDir));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      root: ROOT_DIR,
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, () => {
    console.log(`[Younamp] Personal Audio Workspace running at http://localhost:${PORT}`);
    if (session.activeUser?.id) {
      const starterTracks = db
        .prepare(
          `
          SELECT t.* FROM tracks t
          JOIN playlists p ON p.id = t.playlist_id
          WHERE p.user_id = ?
          ORDER BY p.position ASC, t.position ASC
          LIMIT 6
        `
        )
        .all(session.activeUser.id);
      setImmediate(() => prewarmTracks(starterTracks));
    }
  });
}

startServer().catch((err) => {
  console.error('[Younamp] Fatal startup error:', err);
  process.exit(1);
});
