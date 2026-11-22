const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const YT_ORIGIN = 'https://www.youtube.com';
const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const DURATION_PART_RE = /^\d+(:\d{1,2})+$/;

let scClientCache = { id: '', expiresAt: 0 };
let ytVisitorCache = { val: '', expiresAt: 0 };
let pipePlayerCache = { player: '', signatureTimestamp: 0, expiresAt: 0 };
const ytDirectAudioCache = new Map();
const YT_DIRECT_CACHE_MAX = 64;
const YT_DIRECT_TTL_MS = 25 * 60 * 1000;
const PIPEPIPE_UA = 'PipePipe/4.9.0';
const PIPEPIPE_LATEST_URL = 'https://api.pipepipe.dev/decoder/latest-player';
const PIPEPIPE_DECODE_URL = 'https://api.pipepipe.dev/decoder/decode';

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
    key: 'ios-21',
    clientName: 'IOS',
    clientVersion: '21.03.1',
    clientId: '5',
    osName: 'iOS',
    osVersion: '18.2.22C152',
    deviceMake: 'Apple',
    deviceModel: 'iPhone16,2',
    userAgent:
      'com.google.ios.youtube/21.03.1 (iPhone16,2; U; CPU iOS 18_2 like Mac OS X;)',
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
    key: 'mweb',
    clientName: 'MWEB',
    clientVersion: '2.20250122.04.00',
    clientId: '2',
    platform: 'MOBILE',
    useSignatureTimestamp: true,
    sendUserAgentInContext: true,
    loginSupported: true,
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 16_7_10 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1,gzip(gfe)',
  },
];

async function getPipePipeLatestPlayer(forceRefresh = false) {
  if (!forceRefresh && pipePlayerCache.player && pipePlayerCache.expiresAt > Date.now()) {
    return pipePlayerCache;
  }
  try {
    const resp = await fetch(PIPEPIPE_LATEST_URL, {
      headers: { 'User-Agent': PIPEPIPE_UA },
    });
    if (!resp.ok) return null;
    const j = await resp.json().catch(() => null);
    const player = String(j?.player || '').trim();
    const signatureTimestamp = Number(j?.signatureTimestamp || 0) || 0;
    if (!player || !signatureTimestamp) return null;
    pipePlayerCache = {
      player,
      signatureTimestamp,
      expiresAt: Date.now() + 6 * 60 * 60 * 1000,
    };
    return pipePlayerCache;
  } catch {
    return null;
  }
}

async function decodePipePipe(player, { sig = '', n = '' } = {}) {
  const params = new URLSearchParams({ player });
  if (sig) params.set('sig', sig);
  if (n) params.set('n', n);
  try {
    const resp = await fetch(`${PIPEPIPE_DECODE_URL}?${params.toString()}`, {
      headers: { 'User-Agent': PIPEPIPE_UA },
    });
    if (!resp.ok) return null;
    const j = await resp.json().catch(() => null);
    return j?.responses?.[0]?.data || null;
  } catch {
    return null;
  }
}

async function sha1HexEdge(input) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function buildSapisidAuthHeaderEdge(cookieMap, datasyncId = '') {
  if (!cookieMap || typeof cookieMap !== 'object') return '';
  const sapisid = cookieMap.SAPISID || cookieMap['__Secure-3PAPISID'] || '';
  const sapisid1p = cookieMap['__Secure-1PAPISID'] || '';
  const sapisid3p = cookieMap['__Secure-3PAPISID'] || '';
  if (!sapisid && !sapisid1p && !sapisid3p) return '';

  const ts = String(Math.floor(Date.now() / 1000));
  const dsPrimary = String(datasyncId || '').split('||')[0].trim();
  const validDs = dsPrimary && !dsPrimary.startsWith('V');

  const compute = async (scheme, secret) => {
    if (!secret) return '';
    if (validDs) {
      const h = await sha1HexEdge(`${dsPrimary} ${ts} ${secret} ${YT_ORIGIN}`);
      return `${scheme} ${ts}_${h}_u`;
    }
    const h = await sha1HexEdge(`${ts} ${secret} ${YT_ORIGIN}`);
    return `${scheme} ${ts}_${h}`;
  };

  const parts = (
    await Promise.all([
      compute('SAPISIDHASH', sapisid),
      compute('SAPISID1PHASH', sapisid1p),
      compute('SAPISID3PHASH', sapisid3p),
    ])
  ).filter(Boolean);
  return parts.join(' ');
}

async function getUserCookieSessionFromKV(env, sid) {
  if (!env?.YT_SESSIONS || !sid) return null;
  try {
    const raw = await env.YT_SESSIONS.get(`yt_session:${sid}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.connected || !parsed?.session?.cookieHeader) return null;
    return parsed.session;
  } catch {
    return null;
  }
}

function parseSignatureCipher(rawCipher) {
  if (!rawCipher || typeof rawCipher !== 'string') return null;
  const sp = new URLSearchParams(rawCipher);
  const url = sp.get('url');
  const s = sp.get('s');
  const param = sp.get('sp') || 'signature';
  if (!url || !s) return null;
  return { url, s, param };
}

async function finalizeAudioFormatUrl(fmt, pipePlayer) {
  let finalUrl = typeof fmt?.url === 'string' ? fmt.url : '';
  let decodedWithPipe = null;

  if (!finalUrl && (fmt?.signatureCipher || fmt?.cipher)) {
    const parsed = parseSignatureCipher(fmt.signatureCipher || fmt.cipher);
    if (!parsed || !pipePlayer?.player) return '';
    const nValInitial = (() => {
      try {
        return new URL(parsed.url).searchParams.get('n') || '';
      } catch {
        return '';
      }
    })();
    decodedWithPipe = await decodePipePipe(pipePlayer.player, {
      sig: parsed.s,
      n: nValInitial,
    });
    const solvedSig = decodedWithPipe?.[parsed.s];
    if (!solvedSig) return '';
    const sep = parsed.url.includes('?') ? '&' : '?';
    finalUrl = `${parsed.url}${sep}${encodeURIComponent(parsed.param)}=${encodeURIComponent(solvedSig)}`;
    if (nValInitial && decodedWithPipe?.[nValInitial]) {
      try {
        const u = new URL(finalUrl);
        u.searchParams.set('n', decodedWithPipe[nValInitial]);
        finalUrl = u.toString();
      } catch {
        // Keep URL as-is
      }
    }
    return finalUrl;
  }

  if (!finalUrl) return '';
  try {
    const u = new URL(finalUrl);
    const nVal = u.searchParams.get('n');
    if (nVal && pipePlayer?.player) {
      const dec = await decodePipePipe(pipePlayer.player, { n: nVal });
      if (dec?.[nVal] && dec[nVal] !== nVal) {
        u.searchParams.set('n', dec[nVal]);
        finalUrl = u.toString();
      }
    }
  } catch {
    // Keep URL as-is
  }
  return finalUrl;
}

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
            gl: 'ID',
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
    const hasPlayableSource =
      (typeof f?.url === 'string' && f.url.length > 0) ||
      Boolean(f?.signatureCipher || f?.cipher);
    return mime.startsWith('audio/') && hasPlayableSource;
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

function setYtDirectCache(cacheKey, entry) {
  if (ytDirectAudioCache.has(cacheKey)) ytDirectAudioCache.delete(cacheKey);
  else if (ytDirectAudioCache.size >= YT_DIRECT_CACHE_MAX) {
    const oldest = ytDirectAudioCache.keys().next().value;
    if (oldest) ytDirectAudioCache.delete(oldest);
  }
  ytDirectAudioCache.set(cacheKey, entry);
}

async function resolveDirectYouTubeAudio(
  youtubeId,
  { forceRefresh = false, userCookieSession = null, sessionId = '', ctx = null } = {}
) {
  if (!VIDEO_ID_RE.test(String(youtubeId || ''))) return { entry: null, diag: ['invalid_id'] };
  const isUserScoped = Boolean(userCookieSession?.cookieHeader && sessionId);
  const memKey = isUserScoped ? `${youtubeId}:${sessionId}` : youtubeId;
  const edgeCache = !isUserScoped && typeof caches !== 'undefined' ? caches.default : null;
  const edgeCacheReq = edgeCache
    ? new Request(`https://youtify-yt-url-cache.local/v1/${encodeURIComponent(youtubeId)}`)
    : null;

  if (!forceRefresh) {
    const cached = ytDirectAudioCache.get(memKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { entry: cached, diag: ['mem-hit'] };
    }
    if (edgeCache && edgeCacheReq) {
      const hit = await edgeCache.match(edgeCacheReq);
      if (hit) {
        const j = await hit.json().catch(() => null);
        if (j?.streamUrl) {
          const entry = { ...j, expiresAt: Date.now() + 10 * 60 * 1000 };
          setYtDirectCache(memKey, entry);
          return { entry, diag: ['edge-url-hit'] };
        }
      }
    }
  } else if (edgeCache && edgeCacheReq) {
    try {
      await edgeCache.delete(edgeCacheReq);
    } catch {
      // Ignore edge url cache delete error
    }
  }

  let visitorData = await mintYouTubeVisitorData(forceRefresh);
  let pipePlayer = null;
  const diag = [];

  const attemptClients = [];
  if (isUserScoped) {
    const mwebClient = YT_AUDIO_CLIENTS.find((c) => c.key === 'mweb');
    if (mwebClient) {
      attemptClients.push({ ...mwebClient, key: 'mweb-auth', withAuth: true });
    }
  }
  attemptClients.push(...YT_AUDIO_CLIENTS);

  for (let pass = 0; pass < 2; pass++) {
    let sawBotWall = false;
    for (const c of attemptClients) {
      try {
        if (c.useSignatureTimestamp && !pipePlayer) {
          pipePlayer = await getPipePipeLatestPlayer(false);
        }
        const clientPayload = {
          clientName: c.clientName,
          clientVersion: c.clientVersion,
          hl: 'en',
          gl: 'ID',
          ...(c.osName ? { osName: c.osName } : {}),
          ...(c.osVersion ? { osVersion: c.osVersion } : {}),
          ...(c.deviceMake ? { deviceMake: c.deviceMake } : {}),
          ...(c.deviceModel ? { deviceModel: c.deviceModel } : {}),
          ...(c.androidSdkVersion ? { androidSdkVersion: c.androidSdkVersion } : {}),
          ...(c.platform ? { platform: c.platform } : {}),
          ...(c.sendUserAgentInContext ? { userAgent: c.userAgent } : {}),
          ...(visitorData && !c.withAuth ? { visitorData } : {}),
        };
        const headers = {
          'Content-Type': 'application/json',
          'User-Agent': c.userAgent,
          'X-YouTube-Client-Name': c.clientId,
          'X-YouTube-Client-Version': c.clientVersion,
          ...(visitorData && !c.withAuth ? { 'X-Goog-Visitor-Id': visitorData } : {}),
        };
        if (c.withAuth && userCookieSession?.cookieHeader) {
          headers.Cookie = userCookieSession.cookieHeader;
          const authHdr = await buildSapisidAuthHeaderEdge(
            userCookieSession.cookieMap,
            userCookieSession.ytContext?.datasyncId || ''
          );
          if (authHdr) {
            headers.Origin = YT_ORIGIN;
            headers.Referer = `${YT_ORIGIN}/`;
            headers.Authorization = authHdr;
            headers['X-Goog-AuthUser'] = userCookieSession.ytContext?.sessionIndex || '0';
            if (userCookieSession.ytContext?.delegatedSessionId) {
              headers['X-Goog-PageId'] = userCookieSession.ytContext.delegatedSessionId;
            }
          }
        }
        const body = {
          videoId: youtubeId,
          contentCheckOk: true,
          racyCheckOk: true,
          context: { client: clientPayload },
          ...(c.useSignatureTimestamp && pipePlayer?.signatureTimestamp
            ? {
                playbackContext: {
                  contentPlaybackContext: {
                    signatureTimestamp: pipePlayer.signatureTimestamp,
                  },
                },
              }
            : {}),
        };
        const resp = await fetch(`${YT_ORIGIN}/youtubei/v1/player?prettyPrint=false`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
        if (!resp.ok) {
          diag.push(`${c.key}:http${resp.status}`);
          continue;
        }
        const data = await resp.json().catch(() => null);
        const status = data?.playabilityStatus?.status;
        if (status === 'LOGIN_REQUIRED') {
          sawBotWall = true;
          diag.push(`${c.key}:LOGIN_REQUIRED`);
          continue;
        }
        if (status !== 'OK') {
          diag.push(`${c.key}:${status || 'unknown'}`);
          continue;
        }

        const fmt = selectOriginalAudioFormat(data?.streamingData?.adaptiveFormats || []);
        if (!fmt) {
          diag.push(`${c.key}:no_fmt`);
          continue;
        }
        if ((fmt.signatureCipher || fmt.cipher || String(fmt.url || '').includes('n=')) && !pipePlayer) {
          pipePlayer = await getPipePipeLatestPlayer(false);
        }
        const resolvedUrl = await finalizeAudioFormatUrl(fmt, pipePlayer);
        if (!resolvedUrl) {
          diag.push(`${c.key}:cipher_fail`);
          continue;
        }

        const entry = {
          streamUrl: resolvedUrl,
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
        setYtDirectCache(memKey, entry);
        if (edgeCache && edgeCacheReq && ctx?.waitUntil) {
          ctx.waitUntil(
            edgeCache
              .put(
                edgeCacheReq,
                new Response(JSON.stringify(entry), {
                  status: 200,
                  headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'public, max-age=900',
                  },
                })
              )
              .catch(() => {})
          );
        }
        diag.push(`${c.key}:OK`);
        return { entry, diag };
      } catch (e) {
        diag.push(`${c.key}:err`);
      }
    }
    if (!sawBotWall || pass === 1) break;
    visitorData = await mintYouTubeVisitorData(true);
  }
  return { entry: null, diag };
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

  if (!ytId) return null;

  const rangeHeader = req.headers.get('Range') || '';
  const sid = extractSessionId(req);
  const userCookieSession = sid ? await getUserCookieSessionFromKV(env, sid) : null;
  let diagSummary = '';

  // Primary Engine (FlowTube + NouTube pattern): Direct genuine YouTube InnerTube audio stream
  if (ytId && VIDEO_ID_RE.test(ytId)) {
    try {
      let { entry: ytDirect, diag } = await resolveDirectYouTubeAudio(ytId, {
        forceRefresh: false,
        userCookieSession,
        sessionId: sid,
        ctx,
      });
      diagSummary = diag.join(',');
      if (ytDirect?.streamUrl) {
        let up = await fetch(ytDirect.streamUrl, {
          headers: {
            'User-Agent': ytDirect.userAgent,
            ...(rangeHeader ? { Range: rangeHeader } : {}),
          },
        });
        if (up.status === 403 || up.status === 410) {
          diagSummary += `,upstream:${up.status}`;
          ytDirectAudioCache.delete(userCookieSession && sid ? `${ytId}:${sid}` : ytId);
          const refreshed = await resolveDirectYouTubeAudio(ytId, {
            forceRefresh: true,
            userCookieSession,
            sessionId: sid,
            ctx,
          });
          ytDirect = refreshed.entry;
          diagSummary += `,retry:[${refreshed.diag.join(',')}]`;
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
            'Cache-Control': userCookieSession ? 'private, no-store' : 'public, max-age=300',
            'X-Younamp-Audio-Only': 'true',
            'X-Youtify-Audio-Engine': `yt-${ytDirect.clientName}`,
            'X-Youtify-Audio-Itag': String(ytDirect.itag || ''),
            'X-Youtify-YT-Diag': diagSummary,
            ...buildCorsHeaders(req),
          });
          const cLen = up.headers.get('Content-Length');
          if (cLen) outHeaders.set('Content-Length', cLen);
          const cRange = up.headers.get('Content-Range');
          if (cRange) outHeaders.set('Content-Range', cRange);
          return new Response(up.body, { status: up.status, headers: outHeaders });
        }
        if (up) {
          diagSummary += `,googlevideo:${up.status}`;
        }
      }
    } catch {
      diagSummary += ',yt_exc';
    }
  }

  if (ytId) {
    return jsonResponse(
      req,
      {
        error: 'Direct YouTube audio unavailable on edge',
        fallback: 'yt_iframe',
        youtube_id: ytId,
        diag: diagSummary,
      },
      422,
      { 'X-Youtify-YT-Diag': diagSummary }
    );
  }
  return null;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildSessionCookieHeader(reqUrl, sid) {
  const isHttps = reqUrl.protocol === 'https:';
  return `youtify_sid=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${isHttps ? '; Secure' : ''}`;
}

function renderOAuthCallbackHtml({ ok, sid = '', state = '', error = '', origin = 'https://youtify.muhalmuhtadi.com' }) {
  const payload = JSON.stringify({ type: 'youtify-oauth-result', ok: Boolean(ok), sid, state, error, ts: Date.now() });
  const heading = ok ? 'Berhasil terhubung ke YouTube!' : 'Autentikasi YouTube Gagal';
  const sub = ok
    ? 'Menutup jendela ini dan memuat playlist Anda di Youtify...'
    : error || 'Terjadi kesalahan saat menghubungkan akun YouTube Anda.';
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Youtify — YouTube Login</title>
<style>
  body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #121212; color: #fff; display: flex; min-height: 100vh; align-items: center; justify-content: center; padding: 24px; text-align: center; }
  .card { max-width: 380px; width: 100%; background: #181818; border: 1px solid rgba(255,255,255,.1); border-radius: 16px; padding: 28px 22px; box-shadow: 0 20px 50px rgba(0,0,0,.6); }
  h1 { font-size: 18px; margin: 0 0 10px; }
  p { font-size: 13px; color: #b3b3b3; line-height: 1.5; margin: 0 0 18px; word-break: break-word; }
  a, button { display: inline-block; background: #1ed760; color: #000; border: 0; border-radius: 999px; font-weight: 700; font-size: 13px; padding: 10px 20px; text-decoration: none; cursor: pointer; }
</style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(heading)}</h1>
    <p>${escapeHtml(sub)}</p>
    <button type="button" onclick="window.close(); window.location.replace('/');">${ok ? 'Lanjutkan ke Youtify' : 'Tutup & Coba Lagi'}</button>
  </div>
  <script>
    (function () {
      var data = ${payload};
      try {
        if (data.ok && data.sid) {
          localStorage.setItem('youtify_browser_sid', data.sid);
        }
        localStorage.setItem('youtify_oauth_event', JSON.stringify(data));
      } catch (e) {}
      try {
        if (typeof BroadcastChannel !== 'undefined') {
          var bc = new BroadcastChannel('youtify_auth');
          bc.postMessage(data);
          bc.close();
        }
      } catch (e) {}
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(data, ${JSON.stringify(origin)});
        }
      } catch (e) {}
      setTimeout(function () {
        try { window.close(); } catch (e) {}
      }, ${ok ? 250 : 1200});
    })();
  </script>
</body>
</html>`;
}

async function fetchJsonWithBearer(url, accessToken) {
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await resp.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { ok: resp.ok, status: resp.status, json, text };
}

function pickThumb(thumbs) {
  return (
    thumbs?.high?.url ||
    thumbs?.medium?.url ||
    thumbs?.default?.url ||
    thumbs?.standard?.url ||
    ''
  );
}

async function upsertOAuthAccountAndSyncToD1(env, { sid, accessToken, refreshToken, expiresAt, userInfo }) {
  if (!env?.YOUNAMP_DB) {
    throw new Error('D1 database is unavailable.');
  }

  // 1. Fetch user's YouTube channel metadata via YouTube Data API v3
  const chRes = await fetchJsonWithBearer(
    'https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&mine=true',
    accessToken
  );

  if (!chRes.ok) {
    const errMsg = chRes.json?.error?.message || `YouTube API error (${chRes.status})`;
    const reason = chRes.json?.error?.errors?.[0]?.reason || '';
    if (chRes.status === 403 && (reason === 'accessNotConfigured' || errMsg.includes('has not been used in project'))) {
      throw new Error(
        'YouTube Data API v3 belum diaktifkan di Google Cloud Console project Anda. Buka Google Cloud Console -> APIs & Services -> Library -> cari "YouTube Data API v3" lalu klik Enable.'
      );
    }
    throw new Error(errMsg);
  }

  const ch = chRes.json?.items?.[0] || null;
  const channelId = ch?.id || '';
  const channelTitle = ch?.snippet?.title || userInfo?.name || 'YouTube Account';
  const handle = ch?.snippet?.customUrl || '';
  const avatarUrl = pickThumb(ch?.snippet?.thumbnails) || userInfo?.picture || '';
  const email = userInfo?.email || '';
  const givenName = userInfo?.given_name || channelTitle.split(' ')[0] || '';
  const likesPlId = ch?.contentDetails?.relatedPlaylists?.likes || '';

  // 2. Upsert active per-device user + app_state auth flags
  const existingUser = await env.YOUNAMP_DB.prepare('SELECT id FROM users WHERE id = ? LIMIT 1')
    .bind(sid)
    .first();

  if (!existingUser) {
    await env.YOUNAMP_DB.prepare(
      `INSERT INTO users (
        id, email, name, handle, given_name, avatar_url, browser_source, profile_dir, cookie_mode, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, 'YouTube', 'OAuth', 'none', 1)`
    )
      .bind(sid, email, channelTitle, handle, givenName, avatarUrl)
      .run();
  } else {
    await env.YOUNAMP_DB.prepare(
      `UPDATE users
       SET email = ?, name = ?, handle = ?, given_name = ?, avatar_url = ?,
           browser_source = 'YouTube', profile_dir = 'OAuth', is_active = 1
       WHERE id = ?`
    )
      .bind(email, channelTitle, handle, givenName, avatarUrl, sid)
      .run();
  }

  await env.YOUNAMP_DB.batch([
    env.YOUNAMP_DB.prepare(
      `INSERT INTO app_state (key, value) VALUES (?, '1')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).bind(`yt_browser_auth:${sid}`),
    env.YOUNAMP_DB.prepare(
      `INSERT INTO app_state (key, value) VALUES (?, '0')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).bind(`yt_logged_out:${sid}`),
  ]);

  // 3. Save isolated OAuth tokens in KV strictly keyed by yt_oauth:${sid}
  if (env.YT_SESSIONS) {
    await env.YT_SESSIONS.put(
      `yt_oauth:${sid}`,
      JSON.stringify({
        accessToken,
        refreshToken: refreshToken || '',
        expiresAt,
        channelId,
        handle,
        email,
        name: channelTitle,
        avatarUrl,
      })
    );
  }

  // 4. Fetch user's playlists (public, unlisted, private)
  const rawPlaylists = [];
  let pageToken = '';
  for (let page = 0; page < 2; page++) {
    const qs = new URLSearchParams({
      part: 'snippet,contentDetails,status',
      mine: 'true',
      maxResults: '50',
    });
    if (pageToken) qs.set('pageToken', pageToken);
    const plRes = await fetchJsonWithBearer(
      `https://www.googleapis.com/youtube/v3/playlists?${qs.toString()}`,
      accessToken
    );
    if (!plRes.ok) break;
    for (const p of plRes.json?.items || []) {
      rawPlaylists.push({
        ytPlaylistId: p.id,
        name: p.snippet?.title || 'YouTube Playlist',
        description: p.snippet?.description || '',
        coverImage: pickThumb(p.snippet?.thumbnails),
        ytEditable: 1,
      });
    }
    pageToken = plRes.json?.nextPageToken || '';
    if (!pageToken) break;
  }

  if (likesPlId && !rawPlaylists.some((p) => p.ytPlaylistId === likesPlId)) {
    rawPlaylists.push({
      ytPlaylistId: likesPlId,
      name: 'Liked Videos',
      description: 'YouTube Liked Videos',
      coverImage: '',
      ytEditable: 0,
    });
  }

  // 5. Fetch playlist items in bounded parallel batches (safe within Cloudflare subrequest budget)
  const toFetchItems = rawPlaylists.slice(0, 25);
  const itemsByPl = new Map();
  let cursor = 0;
  const concurrency = Math.min(6, toFetchItems.length || 1);
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (cursor < toFetchItems.length) {
        const pl = toFetchItems[cursor++];
        const itemQs = new URLSearchParams({
          part: 'snippet,contentDetails',
          playlistId: pl.ytPlaylistId,
          maxResults: '50',
        });
        const itRes = await fetchJsonWithBearer(
          `https://www.googleapis.com/youtube/v3/playlistItems?${itemQs.toString()}`,
          accessToken
        );
        if (!itRes.ok) continue;
        const tracks = [];
        for (const item of itRes.json?.items || []) {
          const videoId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId || '';
          const title = String(item.snippet?.title || '').trim();
          if (!VIDEO_ID_RE.test(videoId) || title === 'Private video' || title === 'Deleted video') {
            continue;
          }
          const rawOwner = String(item.snippet?.videoOwnerChannelTitle || '').trim();
          const artist = rawOwner.replace(/\s*-\s*Topic$/i, '') || channelTitle || 'YouTube';
          tracks.push({
            youtubeId: videoId,
            title: title || `YouTube (${videoId})`,
            artist,
            thumbnailUrl: pickThumb(item.snippet?.thumbnails) || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            ytSetVideoId: item.id || '',
          });
        }
        itemsByPl.set(pl.ytPlaylistId, tracks);
      }
    })
  );

  // 6. Sync playlists & tracks into D1
  const syncedAt = new Date().toISOString();
  const maxPosRow = await env.YOUNAMP_DB.prepare(
    'SELECT COALESCE(MAX(position), -1) AS m FROM playlists WHERE user_id = ?'
  )
    .bind(sid)
    .first();
  let nextPos = Number(maxPosRow?.m ?? -1) + 1;
  let syncedCount = 0;
  let trackCount = 0;

  for (const pl of rawPlaylists) {
    const existingPl = await env.YOUNAMP_DB.prepare(
      'SELECT id FROM playlists WHERE user_id = ? AND youtube_playlist_id = ? LIMIT 1'
    )
      .bind(sid, pl.ytPlaylistId)
      .first();

    let playlistId = existingPl?.id || '';
    const fetchedTracks = itemsByPl.get(pl.ytPlaylistId) || [];
    const cover = pl.coverImage || fetchedTracks[0]?.thumbnailUrl || '';

    if (playlistId) {
      await env.YOUNAMP_DB.prepare(
        `UPDATE playlists
         SET name = ?, description = ?, cover_image = CASE WHEN ? != '' THEN ? ELSE cover_image END,
             is_youtube_synced = 1, yt_editable = ?, last_synced_at = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
        .bind(pl.name, pl.description, cover, cover, pl.ytEditable, syncedAt, playlistId)
        .run();
    } else {
      playlistId = `pl_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
      await env.YOUNAMP_DB.prepare(
        `INSERT INTO playlists (
          id, user_id, name, description, cover_image, youtube_playlist_id,
          is_youtube_synced, yt_editable, last_synced_at, position
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
      )
        .bind(playlistId, sid, pl.name, pl.description, cover, pl.ytPlaylistId, pl.ytEditable, syncedAt, nextPos++)
        .run();
    }

    if (itemsByPl.has(pl.ytPlaylistId)) {
      const durRows = await env.YOUNAMP_DB.prepare(
        `SELECT youtube_id, duration FROM tracks WHERE playlist_id = ? AND source_type = 'youtube' AND duration > 0`
      )
        .bind(playlistId)
        .all();
      const durMap = new Map();
      for (const r of durRows?.results || []) {
        if (r?.youtube_id) durMap.set(r.youtube_id, Number(r.duration) || 0);
      }

      const stmts = [
        env.YOUNAMP_DB.prepare(`DELETE FROM tracks WHERE playlist_id = ? AND source_type = 'youtube'`).bind(playlistId),
      ];
      for (let i = 0; i < fetchedTracks.length; i++) {
        const t = fetchedTracks[i];
        const trId = `tr_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
        stmts.push(
          env.YOUNAMP_DB.prepare(
            `INSERT INTO tracks (
              id, playlist_id, title, artist, url, source_type, youtube_id,
              yt_set_video_id, duration, thumbnail_url, position
            ) VALUES (?, ?, ?, ?, ?, 'youtube', ?, ?, ?, ?, ?)`
          ).bind(
            trId,
            playlistId,
            t.title,
            t.artist,
            `${YT_ORIGIN}/watch?v=${t.youtubeId}`,
            t.youtubeId,
            t.ytSetVideoId,
            durMap.get(t.youtubeId) || 0,
            t.thumbnailUrl,
            i
          )
        );
      }
      await env.YOUNAMP_DB.batch(stmts);
      trackCount += fetchedTracks.length;
    }
    syncedCount++;
  }

  if (rawPlaylists.length === 0) {
    const anyPl = await env.YOUNAMP_DB.prepare('SELECT id FROM playlists WHERE user_id = ? LIMIT 1')
      .bind(sid)
      .first();
    if (!anyPl) {
      await env.YOUNAMP_DB.prepare(
        `INSERT INTO playlists (id, user_id, name, description, yt_editable, position)
         VALUES (?, ?, 'My Playlist', 'Custom Youtify playlist', 1, 0)`
      )
        .bind(`pl_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`, sid)
        .run();
    }
  }

  return {
    activeUser: {
      id: sid,
      email,
      name: channelTitle,
      handle,
      given_name: givenName,
      avatar_url: avatarUrl,
      browser_source: 'YouTube',
      is_active: 1,
    },
    syncedCount,
    trackCount,
  };
}

async function handleGoogleOAuthStartEdge(req, env, url) {
  const clientId = String(env?.GOOGLE_CLIENT_ID || '').trim();
  if (!clientId) {
    return jsonResponse(req, { error: 'GOOGLE_CLIENT_ID secret is not configured.' }, 500);
  }
  const state = (url.searchParams.get('state') || '').trim() || crypto.randomUUID();
  const redirectUri = `${url.origin}/api/auth/google/callback`;
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile https://www.googleapis.com/auth/youtube.readonly');
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('include_granted_scopes', 'true');
  authUrl.searchParams.set('prompt', 'select_account');
  authUrl.searchParams.set('state', state);

  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl.toString(),
      'Cache-Control': 'no-store',
    },
  });
}

async function handleGoogleOAuthCallbackEdge(req, env, url) {
  const state = (url.searchParams.get('state') || '').trim();
  const oauthErr = (url.searchParams.get('error') || '').trim();
  const code = (url.searchParams.get('code') || '').trim();

  const fail = async (message) => {
    if (env?.YT_SESSIONS && state) {
      await env.YT_SESSIONS.put(
        `yt_oauth_state:${state}`,
        JSON.stringify({ ok: false, error: message }),
        { expirationTtl: 300 }
      ).catch(() => {});
    }
    return new Response(
      renderOAuthCallbackHtml({ ok: false, state, error: message, origin: url.origin }),
      {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      }
    );
  };

  if (oauthErr) {
    return fail(oauthErr === 'access_denied' ? 'Login YouTube dibatalkan oleh pengguna.' : oauthErr);
  }
  if (!code) {
    return fail('Kode otorisasi Google tidak ditemukan.');
  }

  const clientId = String(env?.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = String(env?.GOOGLE_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) {
    return fail('Konfigurasi OAuth server belum lengkap.');
  }

  try {
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${url.origin}/api/auth/google/callback`,
        grant_type: 'authorization_code',
      }).toString(),
    });
    const tokenJson = await tokenResp.json().catch(() => null);
    if (!tokenResp.ok || !tokenJson?.access_token) {
      return fail(tokenJson?.error_description || tokenJson?.error || 'Gagal menukar token Google.');
    }

    const accessToken = tokenJson.access_token;
    const refreshToken = tokenJson.refresh_token || '';
    const expiresAt = Date.now() + Math.max(60, Number(tokenJson.expires_in) || 3600) * 1000;

    const uInfoRes = await fetchJsonWithBearer('https://www.googleapis.com/oauth2/v2/userinfo', accessToken);
    const userInfo = uInfoRes.ok ? uInfoRes.json || {} : {};

    const sid = `yt_oauth_${crypto.randomUUID().replace(/-/g, '')}`;
    await upsertOAuthAccountAndSyncToD1(env, {
      sid,
      accessToken,
      refreshToken,
      expiresAt,
      userInfo,
    });

    if (env?.YT_SESSIONS && state) {
      await env.YT_SESSIONS.put(
        `yt_oauth_state:${state}`,
        JSON.stringify({ ok: true, sid }),
        { expirationTtl: 300 }
      );
    }

    return new Response(
      renderOAuthCallbackHtml({ ok: true, sid, state, origin: url.origin }),
      {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Set-Cookie': buildSessionCookieHeader(url, sid),
        },
      }
    );
  } catch (err) {
    return fail(err?.message || 'Gagal menghubungkan akun YouTube Anda.');
  }
}

async function handleGoogleOAuthPollEdge(req, env, url) {
  const state = (url.searchParams.get('state') || '').trim();
  if (!state || !env?.YT_SESSIONS) {
    return jsonResponse(req, { pending: true }, 200, { 'Cache-Control': 'no-store' });
  }
  const raw = await env.YT_SESSIONS.get(`yt_oauth_state:${state}`).catch(() => null);
  if (!raw) {
    return jsonResponse(req, { pending: true }, 200, { 'Cache-Control': 'no-store' });
  }
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (!parsed) {
    return jsonResponse(req, { pending: true }, 200, { 'Cache-Control': 'no-store' });
  }
  if (parsed.ok && parsed.sid) {
    return jsonResponse(
      req,
      { ok: true, pending: false, sid: parsed.sid },
      200,
      {
        'Cache-Control': 'no-store',
        'Set-Cookie': buildSessionCookieHeader(url, parsed.sid),
      }
    );
  }
  return jsonResponse(
    req,
    { ok: false, pending: false, error: parsed.error || 'Autentikasi gagal.' },
    200,
    { 'Cache-Control': 'no-store' }
  );
}

async function handleYouTubeOAuthSyncEdge(req, env, url) {
  const sid = extractSessionId(req);
  if (!sid || !env?.YT_SESSIONS || !env?.YOUNAMP_DB) return null;
  const raw = await env.YT_SESSIONS.get(`yt_oauth:${sid}`).catch(() => null);
  if (!raw) return null;

  let oauth = null;
  try {
    oauth = JSON.parse(raw);
  } catch {
    oauth = null;
  }
  if (!oauth?.accessToken && !oauth?.refreshToken) return null;

  let accessToken = oauth.accessToken || '';
  let refreshToken = oauth.refreshToken || '';
  let expiresAt = Number(oauth.expiresAt || 0);

  if ((!accessToken || expiresAt < Date.now() + 60_000) && refreshToken) {
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: String(env.GOOGLE_CLIENT_ID || ''),
        client_secret: String(env.GOOGLE_CLIENT_SECRET || ''),
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });
    const tokenJson = await tokenResp.json().catch(() => null);
    if (tokenResp.ok && tokenJson?.access_token) {
      accessToken = tokenJson.access_token;
      expiresAt = Date.now() + Math.max(60, Number(tokenJson.expires_in) || 3600) * 1000;
    }
  }

  try {
    const result = await upsertOAuthAccountAndSyncToD1(env, {
      sid,
      accessToken,
      refreshToken,
      expiresAt,
      userInfo: {
        email: oauth.email || '',
        name: oauth.name || '',
        picture: oauth.avatarUrl || '',
      },
    });
    const plRows = await env.YOUNAMP_DB.prepare(
      `SELECT p.id, p.user_id, p.name, COALESCE(p.description, '') AS description,
              COALESCE(p.cover_image, '') AS cover_image, COALESCE(p.youtube_playlist_id, '') AS youtube_playlist_id,
              COALESCE(p.is_youtube_synced, 0) AS is_youtube_synced, COALESCE(p.yt_editable, 1) AS yt_editable,
              COALESCE(p.last_synced_at, '') AS last_synced_at, COALESCE(p.position, 0) AS position,
              COALESCE(p.created_at, '') AS created_at, COALESCE(p.updated_at, '') AS updated_at,
              (SELECT COUNT(*) FROM tracks t WHERE t.playlist_id = p.id) AS track_count,
              (SELECT COALESCE(SUM(t.duration), 0) FROM tracks t WHERE t.playlist_id = p.id) AS total_duration
       FROM playlists p WHERE p.user_id = ? ORDER BY p.position ASC`
    )
      .bind(sid)
      .all();

    return jsonResponse(req, {
      authenticated: true,
      sessionId: sid,
      activeUser: result.activeUser,
      playlists: plRows?.results || [],
      sync: { syncedCount: result.syncedCount, trackCount: result.trackCount },
    });
  } catch (err) {
    return jsonResponse(req, { error: err?.message || 'Gagal menyinkronkan playlist YouTube.' }, 502);
  }
}

export async function maybeHandleEdgeRequest(req, env, ctx) {
  const url = new URL(req.url);

  if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
    return new Response(null, { status: 204, headers: buildCorsHeaders(req) });
  }

  if (req.method === 'POST' && url.pathname === '/api/youtube/playlists/sync') {
    return handleYouTubeOAuthSyncEdge(req, env, url);
  }

  if (req.method !== 'GET') return null;

  if (url.pathname === '/api/health') {
    return jsonResponse(req, { ok: true, runtime: 'cloudflare-worker-edge' }, 200);
  }
  if (url.pathname === '/api/auth/google/start') {
    return handleGoogleOAuthStartEdge(req, env, url);
  }
  if (url.pathname === '/api/auth/google/callback') {
    return handleGoogleOAuthCallbackEdge(req, env, url);
  }
  if (url.pathname === '/api/auth/google/poll') {
    return handleGoogleOAuthPollEdge(req, env, url);
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
