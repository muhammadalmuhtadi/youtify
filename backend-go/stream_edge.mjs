const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const YT_ORIGIN = 'https://www.youtube.com';
const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const DURATION_PART_RE = /^\d+(:\d{1,2})+$/;

let scClientCache = { id: '', expiresAt: 0 };
let ytVisitorCache = { val: '', expiresAt: 0 };
const ytDirectAudioCache = new Map();
const YT_DIRECT_CACHE_MAX = 64;
const YT_DIRECT_TTL_MS = 25 * 60 * 1000;

const ORIGINAL_AUDIO_LABELS = new Set([
  'original',
  'originale',
  'оригинал',
  'オリジナル',
  '원본',
  '原始',
  'أصلي',
  'मूल',
  'মূল',
  'asli',
  'orijinal',
  'nguyên bản',
  'ต้นฉบับ',
  'origineel',
  'oryginalny',
  'alkuperäinen',
  'originál',
  'πρωτότυπο',
  'מקורי',
  'eredeti',
  'اصلی',
  'asal',
  'orihinal',
  'اصل',
  'оригинален',
  'originalus',
  'oriģināls',
  'originaal',
  'ორიგინალი',
]);

const YT_AUDIO_CLIENTS = [
  {
    key: 'visionos',
    clientName: 'VISIONOS',
    clientVersion: '1.02',
    clientId: '101',
    osName: 'visionOS',
    osVersion: '26.5.23O471',
    deviceMake: 'Apple',
    deviceModel: 'RealityDevice17,1',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  },
  {
    key: 'ipados',
    clientName: 'IOS',
    clientVersion: '21.03.3',
    clientId: '5',
    osName: 'iPadOS',
    osVersion: '17.7.10.21H450',
    deviceMake: 'Apple',
    deviceModel: 'iPad7,6',
    userAgent:
      'com.google.ios.youtube/21.03.3 (iPad7,6; U; CPU iPadOS 17_7_10 like Mac OS X; en-US)',
  },
  {
    key: 'android-vr',
    clientName: 'ANDROID_VR',
    clientVersion: '1.65.10',
    clientId: '28',
    osName: 'Android',
    osVersion: '12L',
    deviceMake: 'Oculus',
    deviceModel: 'Quest 3',
    androidSdkVersion: 32,
    userAgent:
      'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
  },
  {
    key: 'android-vr-161',
    clientName: 'ANDROID_VR',
    clientVersion: '1.61.48',
    clientId: '28',
    osName: 'Android',
    osVersion: '12',
    deviceMake: 'Oculus',
    deviceModel: 'Quest 3',
    androidSdkVersion: 32,
    userAgent:
      'com.google.android.apps.youtube.vr.oculus/1.61.48 (Linux; U; Android 12; en_US; Quest 3; Build/SQ3A.220605.009.A1; Cronet/132.0.6808.3)',
  },
];

async function mintYouTubeVisitorData(forceRefresh = false) {
  if (!forceRefresh && ytVisitorCache.val && ytVisitorCache.expiresAt > Date.now()) {
    return ytVisitorCache.val;
  }
  const c = YT_AUDIO_CLIENTS[0];
  try {
    const resp = await fetch(`${YT_ORIGIN}/youtubei/v1/visitor_id?prettyPrint=false`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': c.userAgent,
        'X-YouTube-Client-Name': c.clientId,
        'X-YouTube-Client-Version': c.clientVersion,
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: c.clientName,
            clientVersion: c.clientVersion,
            osName: c.osName,
            osVersion: c.osVersion,
            deviceMake: c.deviceMake,
            deviceModel: c.deviceModel,
            hl: 'en',
            gl: 'US',
          },
        },
      }),
    });
    if (resp.ok) {
      const data = await resp.json().catch(() => null);
      const vd = String(data?.responseContext?.visitorData || '').trim();
      if (/^Cg[ts]/.test(vd)) {
        ytVisitorCache = { val: vd, expiresAt: Date.now() + 30 * 60 * 1000 };
        return vd;
      }
    }
  } catch {
    // Fallback to sw.js_data below
  }

  try {
    const swResp = await fetch(`${YT_ORIGIN}/sw.js_data`, {
      headers: { 'User-Agent': BROWSER_UA },
    });
    if (swResp.ok) {
      const swText = await swResp.text();
      const m = swText.match(/Cg[ts][A-Za-z0-9_-]{8,}/);
      if (m?.[0]) {
        ytVisitorCache = { val: m[0], expiresAt: Date.now() + 30 * 60 * 1000 };
        return m[0];
      }
    }
  } catch {
    // Proceed without visitorData if both minting attempts fail
  }
  return '';
}

function selectOriginalAudioFormat(adaptiveFormats = []) {
  const candidates = (Array.isArray(adaptiveFormats) ? adaptiveFormats : []).filter((f) => {
    const mime = String(f?.mimeType || '').toLowerCase();
    return mime.startsWith('audio/') && typeof f?.url === 'string' && f.url.length > 0;
  });
  if (!candidates.length) return null;

  const isDubbed = (f) => {
    const xtags = String(f?.xtags || '').toLowerCase();
    const disp = String(f?.audioTrack?.displayName || '').toLowerCase();
    return xtags.includes('acont=dubbed') || /\bdubbed\b/.test(disp);
  };
  const isOriginal = (f) => {
    if (isDubbed(f)) return false;
    const xtags = String(f?.xtags || '').toLowerCase();
    const disp = String(f?.audioTrack?.displayName || '').toLowerCase().trim();
    const id = String(f?.audioTrack?.id || '');
    return (
      xtags.includes('acont=original') ||
      id.endsWith('.4') ||
      ORIGINAL_AUDIO_LABELS.has(disp) ||
      f?.audioTrack?.audioIsDefault === true
    );
  };

  const originals = candidates.filter(isOriginal);
  const nonDubbed = candidates.filter((f) => !isDubbed(f));
  const pool = originals.length ? originals : nonDubbed.length ? nonDubbed : candidates;

  const sortBest = (list) =>
    [...list].sort((a, b) => {
      if (a.itag === 140 && b.itag !== 140) return -1;
      if (b.itag === 140 && a.itag !== 140) return 1;
      return (b.averageBitrate || b.bitrate || 0) - (a.averageBitrate || a.bitrate || 0);
    });

  const mp4Audio = pool.filter((f) => String(f.mimeType || '').toLowerCase().includes('audio/mp4'));
  if (mp4Audio.length) return sortBest(mp4Audio)[0];
  const webmAudio = pool.filter((f) => String(f.mimeType || '').toLowerCase().includes('audio/webm'));
  if (webmAudio.length) return sortBest(webmAudio)[0];
  return sortBest(pool)[0];
}

function setYtDirectCache(youtubeId, entry) {
  if (ytDirectAudioCache.has(youtubeId)) ytDirectAudioCache.delete(youtubeId);
  else if (ytDirectAudioCache.size >= YT_DIRECT_CACHE_MAX) {
    const oldest = ytDirectAudioCache.keys().next().value;
    if (oldest) ytDirectAudioCache.delete(oldest);
  }
  ytDirectAudioCache.set(youtubeId, entry);
}

async function resolveDirectYouTubeAudio(youtubeId, forceRefresh = false) {
  if (!VIDEO_ID_RE.test(String(youtubeId || ''))) return null;
  if (!forceRefresh) {
    const cached = ytDirectAudioCache.get(youtubeId);
    if (cached && cached.expiresAt > Date.now()) return cached;
  }

  let visitorData = await mintYouTubeVisitorData(forceRefresh);

  for (let pass = 0; pass < 2; pass++) {
    let sawBotWall = false;
    for (const c of YT_AUDIO_CLIENTS) {
      try {
        const clientPayload = {
          clientName: c.clientName,
          clientVersion: c.clientVersion,
          osName: c.osName,
          osVersion: c.osVersion,
          deviceMake: c.deviceMake,
          deviceModel: c.deviceModel,
          hl: 'en',
          gl: 'US',
          ...(c.androidSdkVersion ? { androidSdkVersion: c.androidSdkVersion } : {}),
          ...(visitorData ? { visitorData } : {}),
        };
        const resp = await fetch(`${YT_ORIGIN}/youtubei/v1/player?prettyPrint=false`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': c.userAgent,
            'X-YouTube-Client-Name': c.clientId,
            'X-YouTube-Client-Version': c.clientVersion,
            ...(visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {}),
          },
          body: JSON.stringify({
            videoId: youtubeId,
            contentCheckOk: true,
            racyCheckOk: true,
            context: { client: clientPayload },
          }),
        });
        if (!resp.ok) continue;
        const data = await resp.json().catch(() => null);
        const status = data?.playabilityStatus?.status;
        if (status === 'LOGIN_REQUIRED') {
          sawBotWall = true;
          continue;
        }
        if (status !== 'OK') continue;

        const fmt = selectOriginalAudioFormat(data?.streamingData?.adaptiveFormats || []);
        if (!fmt?.url) continue;

        const entry = {
          streamUrl: fmt.url,
          mimeType: String(fmt.mimeType || 'audio/mp4').split(';')[0].trim() || 'audio/mp4',
          contentLength: fmt.contentLength || null,
          itag: fmt.itag || 0,
          bitrate: Math.round((fmt.averageBitrate || fmt.bitrate || 128000) / 1000),
          clientName: c.key,
          userAgent: c.userAgent,
          durationSec: Number.parseInt(data?.videoDetails?.lengthSeconds || '0', 10) || 0,
          title: String(data?.videoDetails?.title || '').trim(),
          expiresAt: Date.now() + YT_DIRECT_TTL_MS,
        };
        setYtDirectCache(youtubeId, entry);
        return entry;
      } catch {
        // Try next client in ladder
      }
    }
    if (!sawBotWall || pass === 1) break;
    visitorData = await mintYouTubeVisitorData(true);
  }
  return null;
}

function isOriginAllowed(origin) {
  if (!origin) return false;
  return (
    origin === 'https://youtify.muhalmuhtadi.com' ||
    origin.endsWith('.pages.dev') ||
    origin.startsWith('http://localhost:') ||
    origin.startsWith('http://127.0.0.1:')
  );
}

function buildCorsHeaders(req) {
  const origin = req.headers.get('Origin') || '';
  const headers = {};
  if (isOriginAllowed(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
    headers['Vary'] = 'Origin';
    headers['Access-Control-Allow-Methods'] = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Youtify-Session';
  }
  return headers;
}

function jsonResponse(req, data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...buildCorsHeaders(req),
      ...extraHeaders,
    },
  });
}

function extractSessionId(req) {
  const hdr = (req.headers.get('X-Youtify-Session') || '').trim();
  if (hdr && hdr.length <= 128) return hdr;
  const cookieHdr = req.headers.get('Cookie') || '';
  for (const part of cookieHdr.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    if (name === 'youtify_sid') {
      const val = decodeURIComponent(part.slice(idx + 1).trim());
      if (val && val.length <= 128) return val;
    }
  }
  return '';
}

function extractText(node) {
  if (typeof node === 'string') return node;
  if (!node || typeof node !== 'object') return '';
  if (typeof node.content === 'string') return node.content;
  if (typeof node.simpleText === 'string') return node.simpleText;
  if (Array.isArray(node.runs)) {
    let out = '';
    for (const r of node.runs) {
      if (typeof r?.text === 'string') out += r.text;
    }
    return out;
  }
  return '';
}

function parseDurationToSeconds(text) {
  const clean = String(text || '').trim().replace(/\./g, ':');
  if (!DURATION_PART_RE.test(clean)) return 0;
  let total = 0;
  for (const part of clean.split(':')) {
    const n = Number.parseInt(part, 10);
    if (!Number.isFinite(n)) return 0;
    total = total * 60 + n;
  }
  return total;
}

function normalizeVideoRenderer(vr) {
  if (!vr || typeof vr !== 'object') return null;
  const videoId = String(vr.videoId || '').trim();
  if (!VIDEO_ID_RE.test(videoId)) return null;
  const title = extractText(vr.title).trim();
  if (!title) return null;
  const artist =
    extractText(vr.ownerText).trim() ||
    extractText(vr.longBylineText).trim() ||
    'YouTube';
  const rawDur = extractText(vr.lengthText).trim();
  const duration = parseDurationToSeconds(rawDur);
  const durationText = rawDur ? rawDur.replace(/\./g, ':') : 'LIVE';
  const views =
    extractText(vr.shortViewCountText).trim() ||
    extractText(vr.viewCountText).trim();

  return {
    youtube_id: videoId,
    title,
    artist,
    duration,
    duration_text: durationText,
    views,
    published_at: extractText(vr.publishedTimeText).trim(),
    thumbnail_url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    url: `${YT_ORIGIN}/watch?v=${videoId}`,
    source_type: 'youtube',
  };
}

function collectSearchRenderers(data) {
  const sections =
    data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
  const results = [];
  const seen = new Set();

  const push = (vr) => {
    const item = normalizeVideoRenderer(vr);
    if (!item || seen.has(item.youtube_id)) return;
    seen.add(item.youtube_id);
    results.push(item);
  };

  for (const sec of sections) {
    const items = sec?.itemSectionRenderer?.contents || [];
    for (const entry of items) {
      if (entry?.videoRenderer) {
        push(entry.videoRenderer);
      } else if (entry?.shelfRenderer?.content?.verticalListRenderer?.items) {
        for (const sub of entry.shelfRenderer.content.verticalListRenderer.items) {
          if (sub?.videoRenderer) push(sub.videoRenderer);
        }
      }
      if (results.length >= 20) return results;
    }
  }
  return results;
}

async function searchInnerTubeEdge(rawQuery, filter = 'all') {
  const q = String(rawQuery || '').trim();
  if (!q) return [];

  let effectiveQuery = q;
  if (filter === 'music') {
    effectiveQuery = `${q} official audio`;
  } else if (filter === 'podcast') {
    effectiveQuery = `${q} podcast`;
  }

  const resp = await fetch(`${YT_ORIGIN}/youtubei/v1/search?prettyPrint=false`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': BROWSER_UA,
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20250214.01.00',
          hl: 'id',
          gl: 'ID',
        },
      },
      query: effectiveQuery,
    }),
  });

  if (!resp.ok) {
    throw new Error(`YouTube search request failed (status ${resp.status}).`);
  }
  const data = await resp.json();
  return collectSearchRenderers(data);
}

async function handleSearchEdge(req, url, ctx) {
  const q = (url.searchParams.get('q') || '').trim();
  if (!q) {
    return jsonResponse(req, { error: 'Search query is required.' }, 400);
  }
  const filter = (url.searchParams.get('filter') || 'all').trim();

  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const cacheKey = new Request(
    `https://youtify-search-cache.local/v1?q=${encodeURIComponent(q.toLowerCase())}&filter=${encodeURIComponent(filter)}`
  );
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) {
      const cachedData = await hit.json().catch(() => null);
      if (cachedData) {
        return jsonResponse(req, cachedData, 200, { 'X-Youtify-Edge-Cache': 'HIT' });
      }
    }
  }

  try {
    const results = await searchInnerTubeEdge(q, filter);
    const payload = { results };
    if (cache && ctx?.waitUntil) {
      ctx.waitUntil(
        cache
          .put(
            cacheKey,
            new Response(JSON.stringify(payload), {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=300',
              },
            })
          )
          .catch(() => {})
      );
    }
    return jsonResponse(req, payload, 200);
  } catch (err) {
    return jsonResponse(req, { error: err?.message || 'Failed to search YouTube.' }, 502);
  }
}

async function handleSuggestEdge(req, url) {
  const q = (url.searchParams.get('q') || '').trim();
  if (q.length < 2) {
    return jsonResponse(req, { suggestions: [] }, 200);
  }
  try {
    const resp = await fetch(
      `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(q)}`,
      { headers: { 'User-Agent': BROWSER_UA } }
    );
    if (!resp.ok) {
      return jsonResponse(req, { suggestions: [] }, 200);
    }
    const raw = await resp.json().catch(() => null);
    const items = Array.isArray(raw?.[1]) ? raw[1] : [];
    const suggestions = items.filter((s) => typeof s === 'string' && s).slice(0, 6);
    return jsonResponse(req, { suggestions }, 200);
  } catch {
    return jsonResponse(req, { suggestions: [] }, 200);
  }
}

async function resolveActiveUserIdFromD1(env, sid) {
  if (!env?.YOUNAMP_DB || !sid) return null;
  try {
    const loggedOutRow = await env.YOUNAMP_DB.prepare(
      'SELECT value FROM app_state WHERE key = ?'
    )
      .bind(`yt_logged_out:${sid}`)
      .first();
    if (loggedOutRow?.value === '1') return null;

    const authRow = await env.YOUNAMP_DB.prepare(
      'SELECT value FROM app_state WHERE key = ?'
    )
      .bind(`yt_browser_auth:${sid}`)
      .first();
    const authed = authRow?.value === '1';

    const userRow = await env.YOUNAMP_DB.prepare(
      'SELECT id, COALESCE(is_active, 0) AS is_active FROM users WHERE id = ? LIMIT 1'
    )
      .bind(sid)
      .first();
    if (!userRow || Number(userRow.is_active) === 0 || !authed) {
      return null;
    }
    return userRow.id;
  } catch {
    return null;
  }
}

async function handleRecommendationsEdge(req, env, url) {
  const explicitQ = (url.searchParams.get('q') || '').trim();
  const sid = extractSessionId(req);
  const exclude = new Set();
  let seedQuery = explicitQ;

  if (env?.YOUNAMP_DB && sid) {
    try {
      const userId = await resolveActiveUserIdFromD1(env, sid);
      if (userId) {
        const res = await env.YOUNAMP_DB.prepare(
          `SELECT t.title, COALESCE(t.artist, '') AS artist, COALESCE(t.youtube_id, '') AS youtube_id
           FROM tracks t
           JOIN playlists p ON p.id = t.playlist_id
           WHERE p.user_id = ?
           ORDER BY t.added_at DESC
           LIMIT 25`
        )
          .bind(userId)
          .all();
        const rows = Array.isArray(res?.results) ? res.results : [];
        let firstTitle = '';
        let firstArtist = '';
        for (const r of rows) {
          if (r?.youtube_id) exclude.add(r.youtube_id);
          if (!firstTitle && r?.title) {
            firstTitle = r.title;
            firstArtist = r.artist || '';
          }
        }
        if (!seedQuery && firstTitle) {
          seedQuery =
            firstArtist && firstArtist !== 'YouTube'
              ? `${firstArtist} ${firstTitle} mix`
              : `${firstTitle} mix`;
        }
      }
    } catch {
      // Fallback to default seed query if D1 read fails
    }
  }

  if (!seedQuery) {
    seedQuery = 'top hits indonesia music playlist';
  }

  try {
    const results = await searchInnerTubeEdge(seedQuery, 'music');
    const recommendations = [];
    const seen = new Set();
    for (const item of results) {
      if (!item.youtube_id || exclude.has(item.youtube_id) || seen.has(item.youtube_id)) continue;
      seen.add(item.youtube_id);
      recommendations.push(item);
      if (recommendations.length >= 12) break;
    }
    return jsonResponse(req, { query: seedQuery, recommendations }, 200);
  } catch (err) {
    return jsonResponse(req, { error: err?.message || 'Failed to load recommendations.' }, 502);
  }
}

async function getSoundCloudClientId(forceRefresh = false) {
  if (!forceRefresh && scClientCache.id && scClientCache.expiresAt > Date.now()) {
    return scClientCache.id;
  }
  const homeResp = await fetch('https://soundcloud.com', {
    headers: { 'User-Agent': BROWSER_UA },
  });
  if (!homeResp.ok) {
    throw new Error(`SoundCloud homepage failed (${homeResp.status})`);
  }
  const html = await homeResp.text();
  const bundles = [...html.matchAll(/https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js/g)].map(
    (m) => m[0]
  );
  for (const bundleUrl of bundles.slice(-5).reverse()) {
    try {
      const jsResp = await fetch(bundleUrl, { headers: { 'User-Agent': BROWSER_UA } });
      if (!jsResp.ok) continue;
      const jsText = await jsResp.text();
      const match = jsText.match(/client_id:"([a-zA-Z0-9]{20,40})"/);
      if (match?.[1]) {
        scClientCache = { id: match[1], expiresAt: Date.now() + 6 * 60 * 60 * 1000 };
        return match[1];
      }
    } catch {
      // Try next bundle
    }
  }
  throw new Error('Could not resolve SoundCloud client_id');
}

function cleanMirrorTitle(rawTitle) {
  return String(rawTitle || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(
      /\([^)]*(official|video|lyrics|lyric|audio|4k|60fps|hd|soundtrack|music video|visualizer|mv|bass boosted|lirik)[^)]*\)/gi,
      ' '
    )
    .replace(
      /\b(official soundtrack|official audio|official music video|official video|music video|lyric video|lirik lagu|lyrics|bass boosted)\b/gi,
      ' '
    )
    .replace(/[|]+|\/\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildMirrorQueries(title, artist) {
  const prePipeRaw = String(title || '').split(/\s*[|]\s*|\s*\/\/\s*/)[0] || '';
  const prePipeClean = cleanMirrorTitle(prePipeRaw);
  const cleanTitle = cleanMirrorTitle(title);

  const a = String(artist || '').trim();
  const lowerTitle = cleanTitle.toLowerCase();
  const lowerArtist = a.toLowerCase();
  const isLabelOrGenericChannel =
    !a ||
    ['youtube', 'unknown artist', 'nocopyrightsounds', 'watertower music', 'album musik', 'gp records'].includes(
      lowerArtist
    ) ||
    /\b(musik|music|musikindo|records|record|studios|studio|production|entertainment|publishing|media|label|vevo|channel|official|lyrics|lirik|topic|tv|station)\b/i.test(
      a
    );

  const queries = [];
  const pushQuery = (q) => {
    const trimmed = String(q || '').trim();
    if (trimmed && !queries.includes(trimmed)) queries.push(trimmed);
  };

  if (prePipeClean.includes(' - ')) {
    pushQuery(prePipeClean);
  }
  if (cleanTitle.includes(' - ')) {
    pushQuery(cleanTitle);
  }
  if (!isLabelOrGenericChannel && prePipeClean && !prePipeClean.toLowerCase().includes(lowerArtist)) {
    pushQuery(`${a} ${prePipeClean}`);
  }
  if (!isLabelOrGenericChannel && cleanTitle && !lowerTitle.includes(lowerArtist)) {
    pushQuery(`${a} ${cleanTitle}`);
  }
  if (prePipeClean) pushQuery(prePipeClean);
  if (cleanTitle) pushQuery(cleanTitle);
  if (queries.length === 0 && title) {
    pushQuery(title);
  }
  return queries;
}

const VARIANT_PENALTY_KEYWORDS = [
  'cover',
  'covered by',
  'vocal cover',
  'remix',
  'rmx',
  'koplo',
  'karaoke',
  'instrumental',
  'acoustic',
  'akustik',
  'live',
  'slowed',
  'reverb',
  'nightcore',
  'edit',
  'bootleg',
  'mashup',
  'parody',
  'ai cover',
  'rising star',
  'idol',
  'speed up',
  'sped up',
  '8d audio',
  'remastered',
  'extended',
];

function scoreSoundCloudCandidate(hit, { title, artist, targetDurationSec }) {
  const hitTitle = String(hit?.title || '').toLowerCase();
  const hitDesc = String(hit?.description || '').toLowerCase();
  const hitUser = String(hit?.user?.username || '').toLowerCase();
  const hitDurSec = Math.round((Number(hit?.duration) || 0) / 1000);
  const reqTitleLower = String(title || '').toLowerCase();

  let score = 0;

  // Heavy penalty for unrequested covers, remixes, edits, live versions, karaoke, etc.
  for (const kw of VARIANT_PENALTY_KEYWORDS) {
    if (hitTitle.includes(kw) && !reqTitleLower.includes(kw)) {
      score -= 130;
    }
  }
  if (/\bdj\b/.test(hitTitle) && !/\bdj\b/.test(reqTitleLower)) {
    score -= 130;
  }

  // Penalize covers that have social self-promotion or cover notes in description / user
  if (
    (hitDesc.includes('full video on youtube') ||
      hitDesc.includes('cover') ||
      hitDesc.includes('covered by') ||
      hitDesc.includes('instagram :') ||
      hitDesc.includes('tiktok :') ||
      hitDesc.includes('youtube :')) &&
    !reqTitleLower.includes('cover')
  ) {
    score -= 120;
  }

  // Penalize unrequested featuring vocalist versions (e.g. "feat Virzha", "ft Rony Parulian")
  const hitHasFeat = /\b(feat\.?|ft\.?)\b/i.test(hitTitle);
  const reqHasFeat = /\b(feat\.?|ft\.?)\b/i.test(reqTitleLower);
  if (hitHasFeat && !reqHasFeat) {
    score -= 80;
  }

  // Token match bonus & required song-title token enforcement (prevents picking a different song by the same artist)
  const cleanPrePipe = cleanMirrorTitle(String(title || '').split(/\s*[|]\s*|\s*\/\/\s*/)[0] || '').toLowerCase();
  const dashIdx = cleanPrePipe.indexOf(' - ');
  if (dashIdx !== -1) {
    const songPartTokens = cleanPrePipe
      .slice(dashIdx + 3)
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2 && !['the', 'and', 'for', 'with', 'feat', 'ft'].includes(w));
    if (songPartTokens.length > 0 && !songPartTokens.some((tok) => hitTitle.includes(tok))) {
      score -= 200;
    }
  }

  const cleanReqTokens = reqTitleLower
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !['official', 'music', 'video', 'audio', 'lyrics', 'lyric', 'mv', 'hd', 'bass', 'boosted'].includes(w));
  let matchedTokens = 0;
  for (const tok of cleanReqTokens) {
    if (hitTitle.includes(tok) || hitUser.includes(tok)) {
      matchedTokens += 1;
    }
  }
  if (cleanReqTokens.length > 0) {
    score += Math.round((matchedTokens / cleanReqTokens.length) * 60);
  }

  // Duration proximity match (Music Videos often include a 5-15s visual intro/outro)
  const targetDur = Number(targetDurationSec) || 0;
  if (targetDur > 0 && hitDurSec > 0) {
    const diff = Math.abs(hitDurSec - targetDur);
    if (diff <= 15) {
      score += 45 - diff;
    } else if (diff <= 30) {
      score += 20;
    } else if (diff <= 45) {
      score += 5;
    } else if (diff > 60) {
      score -= 100;
    }
  }

  return score;
}

async function resolveYouTubeOEmbed(youtubeId) {
  const r = await fetch(
    `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${youtubeId}`)}&format=json`
  );
  if (!r.ok) return { title: '', artist: '' };
  const j = await r.json().catch(() => null);
  return {
    title: String(j?.title || '').trim(),
    artist: String(j?.author_name || '').trim(),
  };
}

async function resolveSoundCloudStreamUrl(queries, meta) {
  let clientId = await getSoundCloudClientId(false);
  for (const query of queries) {
    let sResp = await fetch(
      `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&client_id=${encodeURIComponent(clientId)}&limit=15`,
      { headers: { 'User-Agent': BROWSER_UA } }
    );
    if (sResp.status === 401 || sResp.status === 403) {
      clientId = await getSoundCloudClientId(true);
      sResp = await fetch(
        `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&client_id=${encodeURIComponent(clientId)}&limit=15`,
        { headers: { 'User-Agent': BROWSER_UA } }
      );
    }
    if (!sResp.ok) continue;

    const sData = await sResp.json().catch(() => null);
    const rawHits = Array.isArray(sData?.collection) ? sData.collection : [];
    const rankedHits = rawHits
      .map((hit, idx) => ({
        hit,
        score: scoreSoundCloudCandidate(hit, meta),
        idx,
      }))
      .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.idx - b.idx))
      .map((item) => item.hit);

    for (const hit of rankedHits) {
      const trans = Array.isArray(hit?.media?.transcodings) ? hit.media.transcodings : [];
      if (!trans.length || !hit?.track_authorization) continue;

      const valid = trans.filter(
        (t) => t?.url && !(t.format?.mime_type?.includes('mpegurl') && t.format?.protocol === 'hls')
      );
      const sorted = [
        ...valid.filter((t) => t.format?.protocol === 'progressive' && t.format?.mime_type?.includes('mpeg')),
        ...valid.filter((t) => t.preset === 'aac_160k'),
        ...valid.filter((t) => t.format?.mime_type?.includes('mp4')),
        ...valid,
      ];
      const seen = new Set();
      for (const tc of sorted) {
        if (seen.has(tc.url)) continue;
        seen.add(tc.url);
        const sep = tc.url.includes('?') ? '&' : '?';
        const trResp = await fetch(
          `${tc.url}${sep}client_id=${encodeURIComponent(clientId)}&track_authorization=${encodeURIComponent(hit.track_authorization)}`,
          { headers: { 'User-Agent': BROWSER_UA } }
        );
        if (!trResp.ok) continue;
        const trJson = await trResp.json().catch(() => null);
        if (!trJson?.url) continue;

        const mimeRaw = String(tc.format?.mime_type || '');
        const isProg = tc.format?.protocol === 'progressive';
        const mimeType =
          mimeRaw.includes('mpeg') && !mimeRaw.includes('mpegurl') ? 'audio/mpeg' : 'audio/mp4';
        return {
          streamUrl: trJson.url,
          mimeType,
          isProg,
          matchedTitle: hit.title || '',
          matchedDuration: Math.round((Number(hit.duration) || 0) / 1000),
        };
      }
    }
  }
  return null;
}

function serveBytesWithRange(req, arrayBuffer, mimeType, rangeHeader, extraHeaders = {}) {
  const total = arrayBuffer.byteLength;
  const baseHeaders = {
    'Content-Type': mimeType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=900',
    'X-Younamp-Audio-Only': 'true',
    ...buildCorsHeaders(req),
    ...extraHeaders,
  };

  if (rangeHeader && rangeHeader.trim().startsWith('bytes=')) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (m) {
      let start = m[1] ? Number(m[1]) : 0;
      let end = m[2] ? Number(m[2]) : total - 1;
      if (!m[1] && m[2]) {
        start = Math.max(0, total - Number(m[2]));
        end = total - 1;
      }
      end = Math.min(end, total - 1);
      if (start >= 0 && start < total && start <= end) {
        const slice = arrayBuffer.slice(start, end + 1);
        return new Response(slice, {
          status: 206,
          headers: {
            ...baseHeaders,
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Content-Length': String(slice.byteLength),
          },
        });
      }
    }
  }

  return new Response(arrayBuffer, {
    status: 200,
    headers: {
      ...baseHeaders,
      'Content-Length': String(total),
    },
  });
}

async function handleAudioStreamEdge(req, env, ctx, url) {
  if (url.searchParams.get('format') === 'json') return null;

  const trackId = decodeURIComponent(url.pathname.slice('/api/stream/'.length));
  let title = (url.searchParams.get('title') || '').trim();
  let artist = (url.searchParams.get('artist') || '').trim();
  let durationSec = Number.parseInt(url.searchParams.get('duration') || '0', 10) || 0;
  const queryYtId = (url.searchParams.get('ytId') || '').trim();
  let ytId =
    VIDEO_ID_RE.test(queryYtId)
      ? queryYtId
      : trackId.startsWith('yt_') && trackId.length === 14
        ? trackId.slice(3)
        : '';

  if ((!ytId || !title || !durationSec) && env?.YOUNAMP_DB && trackId && !trackId.startsWith('yt_')) {
    try {
      const row = await env.YOUNAMP_DB.prepare(
        `SELECT title, COALESCE(artist, '') AS artist, COALESCE(duration, 0) AS duration,
                COALESCE(youtube_id, '') AS youtube_id, source_type, url
         FROM tracks WHERE id = ? LIMIT 1`
      )
        .bind(trackId)
        .first();
      if (row) {
        if (row.source_type === 'audio' && row.url) {
          return Response.redirect(row.url, 302);
        }
        if (!ytId && row.youtube_id) ytId = row.youtube_id;
        if (!title && row.title) title = row.title;
        if (!artist && row.artist) artist = row.artist;
        if (!durationSec && row.duration) durationSec = Number(row.duration) || 0;
      }
    } catch {
      // Fallback cleanly if D1 lookup fails
    }
  }

  if (!title && !ytId) return null;

  const rangeHeader = req.headers.get('Range') || '';

  // Primary Engine (FlowTube + NouTube pattern): Direct genuine YouTube InnerTube audio stream
  if (ytId && VIDEO_ID_RE.test(ytId)) {
    try {
      let ytDirect = await resolveDirectYouTubeAudio(ytId, false);
      if (ytDirect?.streamUrl) {
        let up = await fetch(ytDirect.streamUrl, {
          headers: {
            'User-Agent': ytDirect.userAgent,
            ...(rangeHeader ? { Range: rangeHeader } : {}),
          },
        });
        if (up.status === 403 || up.status === 410) {
          ytDirectAudioCache.delete(ytId);
          ytDirect = await resolveDirectYouTubeAudio(ytId, true);
          if (ytDirect?.streamUrl) {
            up = await fetch(ytDirect.streamUrl, {
              headers: {
                'User-Agent': ytDirect.userAgent,
                ...(rangeHeader ? { Range: rangeHeader } : {}),
              },
            });
          }
        }
        if (up && (up.ok || up.status === 206) && up.body) {
          const outHeaders = new Headers({
            'Content-Type': up.headers.get('Content-Type') || ytDirect.mimeType || 'audio/mp4',
            'Accept-Ranges': up.headers.get('Accept-Ranges') || 'bytes',
            'Cache-Control': 'public, max-age=300',
            'X-Younamp-Audio-Only': 'true',
            'X-Youtify-Audio-Engine': `yt-${ytDirect.clientName}`,
            'X-Youtify-Audio-Itag': String(ytDirect.itag || ''),
            ...buildCorsHeaders(req),
          });
          const cLen = up.headers.get('Content-Length');
          if (cLen) outHeaders.set('Content-Length', cLen);
          const cRange = up.headers.get('Content-Range');
          if (cRange) outHeaders.set('Content-Range', cRange);
          return new Response(up.body, { status: up.status, headers: outHeaders });
        }
      }
    } catch {
      // Fall through to SoundCloud emergency fallback below if direct InnerTube extraction fails
    }
  }

  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const cacheReq = new Request(
    `https://youtify-audio-cache.local/v4/${encodeURIComponent(trackId)}?q=${encodeURIComponent(title + '|' + artist + '|' + durationSec)}`
  );

  if (cache) {
    const cached = await cache.match(cacheReq);
    if (cached) {
      const buf = await cached.arrayBuffer();
      return serveBytesWithRange(req, buf, cached.headers.get('Content-Type') || 'audio/mp4', rangeHeader, {
        'X-Youtify-Audio-Engine': 'sc-fallback',
        'X-Youtify-Matched-Title': cached.headers.get('X-Youtify-Matched-Title') || '',
      });
    }
  }

  try {
    if ((!title || title.startsWith('YouTube Audio (')) && ytId) {
      const meta = await resolveYouTubeOEmbed(ytId);
      if (meta.title) title = meta.title;
      if (!artist && meta.artist) artist = meta.artist;
    }
    if (!title) return null;

    const queries = buildMirrorQueries(title, artist);
    const resolved = await resolveSoundCloudStreamUrl(queries, {
      title,
      artist,
      targetDurationSec: durationSec,
    });
    if (!resolved) return null;

    if (resolved.isProg) {
      const up = await fetch(resolved.streamUrl, {
        headers: { 'User-Agent': BROWSER_UA, ...(rangeHeader ? { Range: rangeHeader } : {}) },
      });
      if (!up.ok && up.status !== 206) return null;
      const hdrs = new Headers(up.headers);
      hdrs.set('X-Younamp-Audio-Only', 'true');
      hdrs.set('X-Youtify-Audio-Engine', 'sc-fallback');
      if (resolved.matchedTitle) hdrs.set('X-Youtify-Matched-Title', resolved.matchedTitle);
      for (const [k, v] of Object.entries(buildCorsHeaders(req))) {
        hdrs.set(k, v);
      }
      return new Response(up.body, { status: up.status, headers: hdrs });
    }

    const mResp = await fetch(resolved.streamUrl, { headers: { 'User-Agent': BROWSER_UA } });
    if (!mResp.ok) return null;
    const m3u8 = await mResp.text();
    const mapMatch = m3u8.match(/#EXT-X-MAP:URI="([^"]+)"/);
    const lines = m3u8.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const urls = [];
    if (mapMatch?.[1]) {
      urls.push(new URL(mapMatch[1], resolved.streamUrl).toString());
    }
    for (const l of lines) {
      if (!l.startsWith('#')) {
        urls.push(new URL(l, resolved.streamUrl).toString());
      }
    }
    if (!urls.length) return null;

    // Keep total subrequests safely under Cloudflare Workers 50-subrequest limit
    const capped = urls.slice(0, 32);
    const bufs = new Array(capped.length);
    let cursor = 0;
    const workers = Math.min(5, capped.length);
    await Promise.all(
      Array.from({ length: workers }, async () => {
        while (cursor < capped.length) {
          const i = cursor++;
          const r = await fetch(capped[i]);
          if (r.ok) {
            bufs[i] = new Uint8Array(await r.arrayBuffer());
          }
        }
      })
    );

    if (!bufs[0]) return null;
    let totalLen = 0;
    for (const b of bufs) {
      if (b) totalLen += b.byteLength;
    }
    const assembled = new Uint8Array(totalLen);
    let offset = 0;
    for (const b of bufs) {
      if (b) {
        assembled.set(b, offset);
        offset += b.byteLength;
      }
    }

    if (cache && ctx?.waitUntil) {
      const cacheResp = new Response(assembled.buffer.slice(0), {
        status: 200,
        headers: {
          'Content-Type': resolved.mimeType,
          'Cache-Control': 'public, max-age=900',
          ...(resolved.matchedTitle ? { 'X-Youtify-Matched-Title': resolved.matchedTitle } : {}),
        },
      });
      ctx.waitUntil(cache.put(cacheReq, cacheResp).catch(() => {}));
    }

    return serveBytesWithRange(req, assembled.buffer, resolved.mimeType, rangeHeader, {
      'X-Youtify-Audio-Engine': 'sc-fallback',
      ...(resolved.matchedTitle ? { 'X-Youtify-Matched-Title': resolved.matchedTitle } : {}),
    });
  } catch {
    return null;
  }
}

export async function maybeHandleEdgeRequest(req, env, ctx) {
  const url = new URL(req.url);

  if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
    return new Response(null, { status: 204, headers: buildCorsHeaders(req) });
  }

  if (req.method !== 'GET') return null;

  if (url.pathname === '/api/health') {
    return jsonResponse(req, { ok: true, runtime: 'cloudflare-worker-edge' }, 200);
  }
  if (url.pathname === '/api/youtube/search') {
    return handleSearchEdge(req, url, ctx);
  }
  if (url.pathname === '/api/youtube/suggest') {
    return handleSuggestEdge(req, url);
  }
  if (url.pathname === '/api/youtube/recommendations') {
    return handleRecommendationsEdge(req, env, url);
  }
  if (url.pathname.startsWith('/api/stream/')) {
    return handleAudioStreamEdge(req, env, ctx, url);
  }

  return null;
}

export async function maybeHandleEdgeAudioStream(req, ctxOrEnv, maybeCtx) {
  if (maybeCtx !== undefined) {
    return maybeHandleEdgeRequest(req, ctxOrEnv, maybeCtx);
  }
  return maybeHandleEdgeRequest(req, null, ctxOrEnv);
}
