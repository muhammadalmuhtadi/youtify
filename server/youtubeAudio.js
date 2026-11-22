import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const COOKIES_FILE_PATH = path.resolve(__dirname, '..', 'data', 'youtube_cookies.txt');

const execFileAsync = promisify(execFile);

// In-memory cache: key -> stream metadata
const streamCache = new Map();
const STREAM_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours
const SC_CLIENT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
let scClientIdCache = { id: '', expiresAt: 0 };
let scClientIdPromise = null;

// LRU cache for assembled SoundCloud audio buffers (instant Range seeking)
const scBufferCache = new Map();
const scInFlightCache = new Map();
const SC_BUFFER_MAX = 8;

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const YT_ORIGIN = 'https://www.youtube.com';
let ytVisitorCache = { val: '', expiresAt: 0 };
let pipePlayerCache = { player: '', signatureTimestamp: 0, expiresAt: 0 };
const ytDirectCache = new Map();
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
      signal: AbortSignal.timeout(6000),
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
      signal: AbortSignal.timeout(7000),
    });
    if (!resp.ok) return null;
    const j = await resp.json().catch(() => null);
    return j?.responses?.[0]?.data || null;
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
            gl: 'US',
          },
        },
      }),
      signal: AbortSignal.timeout(6000),
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
      signal: AbortSignal.timeout(6000),
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
    // Proceed without visitorData
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

function setYtDirectCache(youtubeId, entry) {
  if (ytDirectCache.has(youtubeId)) ytDirectCache.delete(youtubeId);
  else if (ytDirectCache.size >= YT_DIRECT_CACHE_MAX) {
    const oldest = ytDirectCache.keys().next().value;
    if (oldest) ytDirectCache.delete(oldest);
  }
  ytDirectCache.set(youtubeId, entry);
}

export async function resolveDirectYouTubeAudioHttp(youtubeId, forceRefresh = false) {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(String(youtubeId || ''))) return null;
  if (!forceRefresh) {
    const cached = ytDirectCache.get(youtubeId);
    if (cached && cached.expiresAt > Date.now()) return cached;
  }

  let visitorData = await mintYouTubeVisitorData(forceRefresh);
  let pipePlayer = null;

  for (let pass = 0; pass < 2; pass++) {
    let sawBotWall = false;
    for (const c of YT_AUDIO_CLIENTS) {
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
            ...(c.useSignatureTimestamp && pipePlayer?.signatureTimestamp
              ? {
                  playbackContext: {
                    contentPlaybackContext: {
                      signatureTimestamp: pipePlayer.signatureTimestamp,
                    },
                  },
                }
              : {}),
          }),
          signal: AbortSignal.timeout(7000),
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
        if (!fmt) continue;
        if ((fmt.signatureCipher || fmt.cipher || String(fmt.url || '').includes('n=')) && !pipePlayer) {
          pipePlayer = await getPipePipeLatestPlayer(false);
        }
        const resolvedUrl = await finalizeAudioFormatUrl(fmt, pipePlayer);
        if (!resolvedUrl) continue;

        const entry = {
          audioUrl: resolvedUrl,
          mimeType: String(fmt.mimeType || 'audio/mp4').split(';')[0].trim() || 'audio/mp4',
          contentLength: fmt.contentLength || null,
          itag: fmt.itag || 0,
          abr: Math.round((fmt.averageBitrate || fmt.bitrate || 128000) / 1000),
          clientName: c.key,
          userAgent: c.userAgent,
          httpHeaders: { 'User-Agent': c.userAgent },
          duration: Number.parseInt(data?.videoDetails?.lengthSeconds || '0', 10) || 0,
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

export async function getSoundCloudClientId(forceRefresh = false) {
  if (!forceRefresh && scClientIdCache.id && scClientIdCache.expiresAt > Date.now()) {
    return scClientIdCache.id;
  }
  if (!forceRefresh && scClientIdPromise) {
    return scClientIdPromise;
  }

  scClientIdPromise = (async () => {
    const homeResp = await fetch('https://soundcloud.com', {
      headers: { 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!homeResp.ok) {
      throw new Error(`SoundCloud homepage failed (${homeResp.status})`);
    }
    const html = await homeResp.text();
    const assetUrls = [...html.matchAll(/https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js/g)].map(
      (m) => m[0]
    );
    for (const bundleUrl of assetUrls.slice(-5).reverse()) {
      try {
        const jsResp = await fetch(bundleUrl, {
          headers: { 'User-Agent': BROWSER_UA },
          signal: AbortSignal.timeout(8000),
        });
        if (!jsResp.ok) continue;
        const jsText = await jsResp.text();
        const match = jsText.match(/client_id:"([a-zA-Z0-9]{20,40})"/);
        if (match?.[1]) {
          scClientIdCache = { id: match[1], expiresAt: Date.now() + SC_CLIENT_TTL_MS };
          return match[1];
        }
      } catch {
        // Check next asset bundle
      }
    }
    throw new Error('Could not resolve SoundCloud client_id.');
  })().finally(() => {
    scClientIdPromise = null;
  });

  return scClientIdPromise;
}

export async function warmSoundCloudClientId() {
  return getSoundCloudClientId(false);
}

export function hasCustomCookiesFile() {
  try {
    return fs.existsSync(COOKIES_FILE_PATH) && fs.statSync(COOKIES_FILE_PATH).size > 0;
  } catch {
    return false;
  }
}

export function saveCustomCookiesFile(content) {
  fs.mkdirSync(path.dirname(COOKIES_FILE_PATH), { recursive: true });
  const trimmed = typeof content === 'string' ? content.trim() : '';
  if (!trimmed) {
    if (fs.existsSync(COOKIES_FILE_PATH)) fs.unlinkSync(COOKIES_FILE_PATH);
    return false;
  }
  fs.writeFileSync(COOKIES_FILE_PATH, `${trimmed}\n`, 'utf8');
  return true;
}

function getYtDlpCookieArgs(cookieMode = 'none', profileDir = '') {
  if ((cookieMode === 'cookies_file' || cookieMode === 'none') && hasCustomCookiesFile()) {
    return ['--cookies', COOKIES_FILE_PATH];
  }
  const validBrowsers = ['chrome', 'edge', 'firefox', 'brave', 'opera', 'vivaldi'];
  if (cookieMode && validBrowsers.includes(cookieMode)) {
    const browserSpec =
      profileDir && cookieMode !== 'firefox' ? `${cookieMode}:${profileDir}` : cookieMode;
    return ['--cookies-from-browser', browserSpec];
  }
  return [];
}

export function extractYouTubeId(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  let normalized = rawUrl.trim();
  if (!/^https?:\/\//i.test(normalized)) {
    if (/^(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com|m\.youtube\.com)/i.test(normalized)) {
      normalized = `https://${normalized}`;
    } else {
      return null;
    }
  }

  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
  let candidate = null;

  if (host === 'youtu.be') {
    candidate = parsed.pathname.split('/').filter(Boolean)[0];
  } else if (
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'music.youtube.com' ||
    host === 'youtube-nocookie.com'
  ) {
    if (parsed.pathname === '/watch') {
      candidate = parsed.searchParams.get('v');
    } else if (parsed.pathname.startsWith('/shorts/')) {
      candidate = parsed.pathname.split('/')[2];
    } else if (parsed.pathname.startsWith('/embed/')) {
      candidate = parsed.pathname.split('/')[2];
    } else if (parsed.pathname.startsWith('/live/')) {
      candidate = parsed.pathname.split('/')[2];
    } else if (parsed.pathname.startsWith('/v/')) {
      candidate = parsed.pathname.split('/')[2];
    }
  }

  if (candidate && /^[a-zA-Z0-9_-]{11}$/.test(candidate)) {
    return candidate;
  }
  return null;
}

export function isSoundCloudUrl(parsed) {
  const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
  return host === 'soundcloud.com' || host === 'm.soundcloud.com' || host === 'on.soundcloud.com';
}

export function parseMediaUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('Please paste a valid YouTube, SoundCloud, or audio URL.');
  }

  let trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error('Please paste a valid YouTube, SoundCloud, or audio URL.');
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Invalid URL format. Please check the link and try again.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https URLs are supported.');
  }

  const youtubeId = extractYouTubeId(trimmed);
  if (youtubeId) {
    return {
      sourceType: 'youtube',
      youtubeId,
      canonicalUrl: `https://www.youtube.com/watch?v=${youtubeId}`,
    };
  }

  if (isSoundCloudUrl(parsed)) {
    return {
      sourceType: 'soundcloud',
      youtubeId: null,
      canonicalUrl: parsed.toString(),
      parsedUrl: parsed,
    };
  }

  return {
    sourceType: 'audio',
    youtubeId: null,
    canonicalUrl: parsed.toString(),
    parsedUrl: parsed,
  };
}

async function runYtDlpJson(youtubeUrl, cookieMode = 'none', profileDir = '') {
  const baseArgs = [
    '-m',
    'yt_dlp',
    '-f',
    'bestaudio[ext=m4a][protocol^=http]/bestaudio[acodec!=none][vcodec=none][protocol^=http]/bestaudio[ext=m4a]/bestaudio[acodec!=none][vcodec=none]/bestaudio',
    '--dump-single-json',
    '--no-playlist',
    '--no-warnings',
    '--no-check-certificates',
  ];

  const cookieArgs = getYtDlpCookieArgs(cookieMode, profileDir);

  if (cookieArgs.length > 0) {
    try {
      const { stdout } = await execFileAsync(
        'python',
        [...baseArgs, ...cookieArgs, youtubeUrl],
        { timeout: 22000, maxBuffer: 12 * 1024 * 1024 }
      );
      return JSON.parse(stdout);
    } catch {
      // Retry without cookies if browser locks or decrypts cookie DB on Windows
    }
  }

  const { stdout } = await execFileAsync('python', [...baseArgs, youtubeUrl], {
    timeout: 22000,
    maxBuffer: 12 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function pickAudioStreamFromInfo(info) {
  let chosen = null;

  if (info.url && (!info.vcodec || info.vcodec === 'none')) {
    chosen = info;
  } else if (Array.isArray(info.formats)) {
    const audioOnly = info.formats.filter(
      (f) => f.url && f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none')
    );
    const m4aDirect = audioOnly.filter(
      (f) => f.ext === 'm4a' && (!f.protocol || f.protocol.startsWith('http'))
    );
    const webmDirect = audioOnly.filter(
      (f) => f.ext === 'webm' && (!f.protocol || f.protocol.startsWith('http'))
    );
    const pool = m4aDirect.length ? m4aDirect : webmDirect.length ? webmDirect : audioOnly;
    pool.sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0));
    chosen = pool[0] || info;
  } else {
    chosen = info;
  }

  if (!chosen?.url) {
    throw new Error('Could not extract an audio-only stream URL from YouTube.');
  }

  const ext = chosen.ext || 'm4a';
  const mimeType =
    ext === 'webm'
      ? 'audio/webm'
      : ext === 'mp3'
        ? 'audio/mpeg'
        : ext === 'ogg' || ext === 'opus'
          ? 'audio/ogg'
          : 'audio/mp4';

  return {
    audioUrl: chosen.url,
    mimeType,
    ext,
    contentLength: chosen.filesize || chosen.filesize_approx || null,
    abr: Math.round(chosen.abr || chosen.tbr || 128),
    httpHeaders: chosen.http_headers || info.http_headers || {},
    duration: Math.round(info.duration || 0),
    title: info.title || 'YouTube Audio',
    artist: info.uploader || info.channel || info.artist || 'YouTube',
    thumbnailUrl:
      info.thumbnail ||
      (info.id ? `https://i.ytimg.com/vi/${info.id}/hqdefault.jpg` : ''),
    expiresAt: Date.now() + STREAM_TTL_MS,
  };
}

export async function getAudioStreamInfo(
  youtubeId,
  cookieMode = 'none',
  forceRefresh = false,
  profileDir = ''
) {
  const cacheKey = `${youtubeId}:${cookieMode || 'none'}:${profileDir || 'Default'}`;
  const cached = streamCache.get(cacheKey);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  const youtubeUrl = `https://www.youtube.com/watch?v=${youtubeId}`;
  const info = await runYtDlpJson(youtubeUrl, cookieMode, profileDir);
  const streamInfo = pickAudioStreamFromInfo(info);
  streamCache.set(cacheKey, streamInfo);
  return streamInfo;
}

export async function fetchYouTubeOEmbed(youtubeId) {
  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    `https://www.youtube.com/watch?v=${youtubeId}`
  )}&format=json`;
  const resp = await fetch(endpoint, { signal: AbortSignal.timeout(6000) });
  if (!resp.ok) {
    throw new Error(`YouTube video not found or unavailable (status ${resp.status}).`);
  }
  const data = await resp.json();
  return {
    title: data.title || `YouTube Audio (${youtubeId})`,
    artist: data.author_name || 'YouTube',
    duration: 0,
    thumbnailUrl: data.thumbnail_url || `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
  };
}

async function runYtDlpSoundCloudJson(scUrl) {
  const args = ['-m', 'yt_dlp', '--dump-single-json', '--no-playlist', '--no-warnings', scUrl];
  try {
    const { stdout } = await execFileAsync('python', args, {
      timeout: 45000,
      maxBuffer: 12 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout);
    return parsed?.entries?.[0] || parsed;
  } catch (err) {
    // Fallback: if direct slug 404s (e.g. artist display name slug mismatch), try SoundCloud search
    const parsedUrl = new URL(scUrl);
    const terms = decodeURIComponent(parsedUrl.pathname)
      .replace(/[-_/]+/g, ' ')
      .trim();
    if (terms) {
      const { stdout } = await execFileAsync(
        'python',
        ['-m', 'yt_dlp', '--dump-single-json', '--no-warnings', `scsearch1:${terms}`],
        { timeout: 45000, maxBuffer: 12 * 1024 * 1024 }
      );
      const searchJson = JSON.parse(stdout);
      const entry = searchJson?.entries?.[0] || searchJson;
      if (entry?.url || Array.isArray(entry?.formats)) {
        return entry;
      }
    }
    throw err;
  }
}

function pickSoundCloudStreamFromInfo(info, originalUrl) {
  const formats = Array.isArray(info.formats) ? info.formats.filter((f) => f.url) : [];
  const httpFormats = formats.filter((f) => f.protocol === 'http' || f.protocol === 'https');
  const hlsAac = formats.filter((f) => f.format_id?.includes('aac') && f.protocol?.includes('m3u8'));
  const hlsMp3 = formats.filter((f) => f.format_id?.includes('mp3') && f.protocol?.includes('m3u8'));

  const sortByBitrate = (list) => [...list].sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0));
  const chosen =
    sortByBitrate(httpFormats)[0] ||
    sortByBitrate(hlsAac)[0] ||
    sortByBitrate(hlsMp3)[0] ||
    sortByBitrate(formats)[0] ||
    (info.url ? info : null);

  if (!chosen?.url) {
    throw new Error('Could not find a playable SoundCloud audio stream.');
  }

  const ext = chosen.ext || 'm4a';
  const mimeType =
    ext === 'mp3'
      ? 'audio/mpeg'
      : ext === 'ogg' || ext === 'opus'
        ? 'audio/ogg'
        : 'audio/mp4';

  return {
    streamUrl: chosen.url,
    protocol: chosen.protocol || 'm3u8_native',
    ext,
    mimeType,
    abr: Math.round(chosen.abr || chosen.tbr || 160),
    duration: Math.round(info.duration || 0),
    title: info.title || 'SoundCloud Audio',
    artist: info.uploader || info.channel || 'SoundCloud Artist',
    thumbnailUrl: info.thumbnail || '',
    webpageUrl: info.webpage_url || originalUrl,
    expiresAt: Date.now() + 20 * 60 * 1000, // SoundCloud signed HLS URLs expire sooner (~20-60 min)
  };
}

export async function getSoundCloudStreamInfo(scUrl, forceRefresh = false) {
  const cacheKey = `sc:${scUrl}`;
  const cached = streamCache.get(cacheKey);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  const info = await runYtDlpSoundCloudJson(scUrl);
  const streamInfo = pickSoundCloudStreamFromInfo(info, scUrl);
  streamCache.set(cacheKey, streamInfo);
  if (streamInfo.webpageUrl && streamInfo.webpageUrl !== scUrl) {
    streamCache.set(`sc:${streamInfo.webpageUrl}`, streamInfo);
  }
  return streamInfo;
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

export function scoreSoundCloudCandidate(hit, { title, targetDurationSec }) {
  const hitTitle = String(hit?.title || '').toLowerCase();
  const hitDesc = String(hit?.description || '').toLowerCase();
  const hitUser = String(hit?.user?.username || '').toLowerCase();
  const hitDurSec = Math.round((Number(hit?.duration) || 0) / 1000);
  const reqTitleLower = String(title || '').toLowerCase();

  let score = 0;

  for (const kw of VARIANT_PENALTY_KEYWORDS) {
    if (hitTitle.includes(kw) && !reqTitleLower.includes(kw)) {
      score -= 130;
    }
  }
  if (/\bdj\b/.test(hitTitle) && !/\bdj\b/.test(reqTitleLower)) {
    score -= 130;
  }

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

  const hitHasFeat = /\b(feat\.?|ft\.?)\b/i.test(hitTitle);
  const reqHasFeat = /\b(feat\.?|ft\.?)\b/i.test(reqTitleLower);
  if (hitHasFeat && !reqHasFeat) {
    score -= 80;
  }

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

export function buildSearchQueriesFromTrack(track) {
  const prePipeRaw = String(track.title || '').split(/\s*[|]\s*|\s*\/\/\s*/)[0] || '';
  const prePipeClean = cleanMirrorTitle(prePipeRaw);
  const cleanTitle = cleanMirrorTitle(track.title);

  const artist = (track.artist || '').trim();
  const lowerTitle = cleanTitle.toLowerCase();
  const lowerArtist = artist.toLowerCase();
  const isGenericArtist =
    !artist ||
    ['youtube', 'unknown artist', 'nocopyrightsounds', 'watertower music', 'album musik', 'gp records'].includes(
      lowerArtist
    ) ||
    /\b(musik|music|musikindo|records|record|studios|studio|production|entertainment|publishing|media|label|vevo|channel|official|lyrics|lirik|topic|tv|station)\b/i.test(
      artist
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
  if (!isGenericArtist && prePipeClean && !prePipeClean.toLowerCase().includes(lowerArtist)) {
    pushQuery(`${artist} ${prePipeClean}`);
  }
  if (!isGenericArtist && !lowerTitle.includes(lowerArtist)) {
    pushQuery(`${artist} ${cleanTitle}`);
  }
  if (prePipeClean) pushQuery(prePipeClean);
  if (cleanTitle) pushQuery(cleanTitle);
  if (queries.length === 0 && track.title) {
    pushQuery(track.title);
  }
  return queries;
}

async function searchFirstMirrorEntry(query) {
  const { stdout } = await execFileAsync(
    'python',
    ['-m', 'yt_dlp', '--dump-single-json', '--no-warnings', `scsearch1:${query}`],
    { timeout: 45000, maxBuffer: 12 * 1024 * 1024 }
  );
  const searchJson = JSON.parse(stdout);
  const entry = searchJson?.entries?.[0] || searchJson;
  if (!entry || (!entry.url && !Array.isArray(entry.formats))) {
    return null;
  }
  return entry;
}

export async function resolveSoundCloudMirrorHttp(track) {
  const queries = buildSearchQueriesFromTrack(track);
  if (queries.length === 0) return null;

  let clientId = await getSoundCloudClientId(false);
  for (const query of queries) {
    let searchResp = await fetch(
      `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&client_id=${encodeURIComponent(clientId)}&limit=15`,
      { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(6000) }
    );
    if (searchResp.status === 401 || searchResp.status === 403) {
      clientId = await getSoundCloudClientId(true);
      searchResp = await fetch(
        `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&client_id=${encodeURIComponent(clientId)}&limit=15`,
        { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(6000) }
      );
    }
    if (!searchResp.ok) continue;

    const searchData = await searchResp.json().catch(() => null);
    const rawHits = Array.isArray(searchData?.collection) ? searchData.collection : [];
    const hits = rawHits
      .map((hit, idx) => ({
        hit,
        score: scoreSoundCloudCandidate(hit, {
          title: track.title,
          targetDurationSec: track.duration || 0,
        }),
        idx,
      }))
      .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.idx - b.idx))
      .map((item) => item.hit);

    for (const hit of hits) {
      const transcodings = Array.isArray(hit?.media?.transcodings) ? hit.media.transcodings : [];
      if (transcodings.length === 0 || !hit?.track_authorization) continue;

      const validTrans = transcodings.filter(
        (t) =>
          t?.url &&
          !(t.format?.mime_type?.includes('mpegurl') && t.format?.protocol === 'hls')
      );
      const sorted = [
        ...validTrans.filter((t) => t.format?.protocol === 'progressive' && t.format?.mime_type?.includes('mpeg')),
        ...validTrans.filter((t) => t.preset === 'aac_160k'),
        ...validTrans.filter((t) => t.format?.mime_type?.includes('mp4')),
        ...validTrans,
      ];
      const seen = new Set();
      for (const tc of sorted) {
        if (!tc?.url || seen.has(tc.url)) continue;
        seen.add(tc.url);
        try {
          const sep = tc.url.includes('?') ? '&' : '?';
          const trResp = await fetch(
            `${tc.url}${sep}client_id=${encodeURIComponent(clientId)}&track_authorization=${encodeURIComponent(hit.track_authorization)}`,
            { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(5000) }
          );
          if (!trResp.ok) continue;
          const trJson = await trResp.json().catch(() => null);
          if (!trJson?.url) continue;

          const mimeRaw = String(tc.format?.mime_type || '');
          const isProg = tc.format?.protocol === 'progressive';
          const mimeType = mimeRaw.includes('mpeg') && !mimeRaw.includes('mpegurl') ? 'audio/mpeg' : 'audio/mp4';
          return {
            streamUrl: trJson.url,
            protocol: isProg ? 'https' : 'm3u8_native',
            ext: mimeType === 'audio/mpeg' ? 'mp3' : 'm4a',
            mimeType,
            abr: tc.preset === 'aac_96k' ? 96 : 160,
            duration: Math.round((Number(hit.duration) || 0) / 1000),
            title: hit.title || track.title || 'SoundCloud Audio',
            artist: hit.user?.username || track.artist || 'YouTube',
            thumbnailUrl: hit.artwork_url || '',
            webpageUrl: hit.permalink_url || track.url,
            expiresAt: Date.now() + 20 * 60 * 1000,
          };
        } catch {
          // Try next transcoding
        }
      }
    }
  }
  return null;
}

export async function getYouTubeMirrorStreamInfo(track, forceRefresh = false) {
  const cacheKey = `yt_sc:${track.youtube_id}:v4`;
  const cached = streamCache.get(cacheKey);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  try {
    const fastStream = await resolveSoundCloudMirrorHttp(track);
    if (fastStream) {
      streamCache.set(cacheKey, fastStream);
      return fastStream;
    }
  } catch {
    // Fall back to yt-dlp mirror search if direct SoundCloud HTTP call fails
  }

  const queries = buildSearchQueriesFromTrack(track);
  if (queries.length === 0) {
    throw new Error('Cannot resolve audio query for YouTube track.');
  }

  let entry = null;
  for (const query of queries) {
    try {
      entry = await searchFirstMirrorEntry(query);
      if (entry) break;
    } catch {
      // Try next fallback search query
    }
  }

  if (!entry) {
    throw new Error('No audio mirror found for YouTube track.');
  }
  const streamInfo = pickSoundCloudStreamFromInfo(entry, track.url);
  streamCache.set(cacheKey, streamInfo);
  return streamInfo;
}

export async function resolveTrackMetadata(rawUrl, cookieMode = 'none', profileDir = '') {
  const parsed = parseMediaUrl(rawUrl);

  if (parsed.sourceType === 'soundcloud') {
    const info = await getSoundCloudStreamInfo(parsed.canonicalUrl, false);
    return {
      title: info.title,
      artist: info.artist,
      url: info.webpageUrl || parsed.canonicalUrl,
      source_type: 'soundcloud',
      youtube_id: null,
      duration: info.duration,
      thumbnail_url: info.thumbnailUrl || '',
    };
  }

  if (parsed.sourceType === 'youtube') {
    const canUseBackendCookies =
      Boolean(cookieMode && cookieMode !== 'none') &&
      (cookieMode !== 'cookies_file' || hasCustomCookiesFile());

    if (!canUseBackendCookies) {
      const oembed = await fetchYouTubeOEmbed(parsed.youtubeId);
      return {
        title: oembed.title,
        artist: oembed.artist,
        url: parsed.canonicalUrl,
        source_type: 'youtube',
        youtube_id: parsed.youtubeId,
        duration: oembed.duration,
        thumbnail_url: oembed.thumbnailUrl,
      };
    }

    try {
      const streamInfo = await getAudioStreamInfo(parsed.youtubeId, cookieMode, false, profileDir);
      return {
        title: streamInfo.title,
        artist: streamInfo.artist,
        url: parsed.canonicalUrl,
        source_type: 'youtube',
        youtube_id: parsed.youtubeId,
        duration: streamInfo.duration,
        thumbnail_url:
          streamInfo.thumbnailUrl || `https://i.ytimg.com/vi/${parsed.youtubeId}/hqdefault.jpg`,
      };
    } catch {
      const oembed = await fetchYouTubeOEmbed(parsed.youtubeId);
      return {
        title: oembed.title,
        artist: oembed.artist,
        url: parsed.canonicalUrl,
        source_type: 'youtube',
        youtube_id: parsed.youtubeId,
        duration: oembed.duration,
        thumbnail_url: oembed.thumbnailUrl,
      };
    }
  }

  // Direct audio URL validation
  const pathname = parsed.parsedUrl.pathname;
  const rawName = decodeURIComponent(pathname.split('/').filter(Boolean).pop() || '');
  const looksLikeAudioExt = /\.(mp3|m4a|aac|ogg|opus|wav|flac|webm)$/i.test(rawName);

  if (!looksLikeAudioExt) {
    try {
      const headResp = await fetch(parsed.canonicalUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(6000),
      });
      const contentType = headResp.headers.get('content-type') || '';
      if (!contentType.startsWith('audio/') && !contentType.includes('ogg')) {
        throw new Error(
          'URL does not appear to be a YouTube video or a direct audio file (.mp3, .m4a, .ogg, .wav, .flac).'
        );
      }
    } catch (err) {
      if (err.message.includes('does not appear')) throw err;
      // If HEAD fails due to server restrictions, allow if URL path has audio or user explicitly pasted it
      throw new Error(
        'Could not verify audio URL. Paste a valid YouTube link or direct audio URL (.mp3, .m4a, .ogg, .wav).'
      );
    }
  }

  const cleanTitle =
    rawName.replace(/\.[^/.]+$/, '').replace(/[-_]+/g, ' ').trim() ||
    parsed.parsedUrl.hostname;

  return {
    title: cleanTitle,
    artist: parsed.parsedUrl.hostname.replace(/^www\./, ''),
    url: parsed.canonicalUrl,
    source_type: 'audio',
    youtube_id: null,
    duration: 0,
    thumbnail_url: '',
  };
}

function pipeYtDlpFallback(req, res, youtubeId, cookieMode, profileDir = '') {
  const youtubeUrl = `https://www.youtube.com/watch?v=${youtubeId}`;
  const args = [
    '-m',
    'yt_dlp',
    '-f',
    'bestaudio[ext=m4a]/bestaudio[acodec!=none][vcodec=none]/bestaudio',
    '--no-playlist',
    '--no-warnings',
    '-o',
    '-',
    youtubeUrl,
  ];

  const cookieArgs = getYtDlpCookieArgs(cookieMode, profileDir);
  if (cookieArgs.length > 0) {
    args.splice(args.length - 1, 0, ...cookieArgs);
  }

  const child = spawn('python', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  res.status(200);
  res.setHeader('Content-Type', 'audio/mp4');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Younamp-Audio-Only', 'true');

  child.stdout.pipe(res);

  req.on('close', () => {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  });

  child.on('error', () => {
    if (!res.headersSent) {
      res.status(502).json({ error: 'Audio stream fallback failed.' });
    } else {
      res.end();
    }
  });
}

function setScBufferCache(trackId, entry) {
  if (scBufferCache.has(trackId)) {
    scBufferCache.delete(trackId);
  } else if (scBufferCache.size >= SC_BUFFER_MAX) {
    const oldestKey = scBufferCache.keys().next().value;
    if (oldestKey) scBufferCache.delete(oldestKey);
  }
  scBufferCache.set(trackId, entry);
}

function sendBufferWithRange(req, res, buffer, mimeType, abr) {
  const total = buffer.length;
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('X-Younamp-Audio-Only', 'true');
  if (abr) res.setHeader('X-Younamp-Bitrate', `${abr}kbps`);

  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (match) {
      let start = match[1] ? Number(match[1]) : 0;
      let end = match[2] ? Number(match[2]) : total - 1;
      if (!match[1] && match[2]) {
        start = Math.max(0, total - Number(match[2]));
        end = total - 1;
      }
      end = Math.min(end, total - 1);
      if (start >= total || start > end) {
        res.status(416);
        res.setHeader('Content-Range', `bytes */${total}`);
        return res.end();
      }
      const slice = buffer.subarray(start, end + 1);
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', String(slice.length));
      return res.end(slice);
    }
  }

  res.status(200);
  res.setHeader('Content-Length', String(total));
  return res.end(buffer);
}

async function proxyDirectAudioUrl(req, res, targetUrl, fallbackAbr) {
  const controller = new AbortController();
  req.on('close', () => controller.abort());

  const headers = {};
  if (req.headers.range) headers.Range = req.headers.range;

  const upstream = await fetch(targetUrl, { headers, signal: controller.signal });
  if (!upstream.ok && upstream.status !== 206) {
    return res.status(upstream.status).json({ error: 'Upstream audio URL returned an error.' });
  }

  res.status(upstream.status);
  const passHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
  for (const h of passHeaders) {
    const val = upstream.headers.get(h);
    if (val) res.setHeader(h, val);
  }
  if (!upstream.headers.get('accept-ranges')) {
    res.setHeader('Accept-Ranges', 'bytes');
  }
  res.setHeader('X-Younamp-Audio-Only', 'true');
  if (fallbackAbr) res.setHeader('X-Younamp-Bitrate', `${fallbackAbr}kbps`);

  if (upstream.body) {
    const nodeStream = Readable.fromWeb(upstream.body);
    nodeStream.on('error', () => {
      if (!res.writableEnded) res.end();
    });
    nodeStream.pipe(res);
  } else {
    res.end();
  }
}

async function fetchSegmentWithRetry(u, signal = null) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const combinedSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000);
      const r = await fetch(u, { signal: combinedSignal });
      if (!r.ok) throw new Error(`Segment fetch failed (${r.status})`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (attempt === 1 || signal?.aborted) throw e;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

async function parseHlsManifest(streamInfo, refreshFn) {
  let info = streamInfo;
  let m3u8Resp = await fetch(info.streamUrl, { signal: AbortSignal.timeout(15000) });
  if (m3u8Resp.status === 403 || m3u8Resp.status === 410 || m3u8Resp.status === 404) {
    info = await refreshFn();
    m3u8Resp = await fetch(info.streamUrl, { signal: AbortSignal.timeout(15000) });
  }
  if (!m3u8Resp.ok) {
    throw new Error(`Audio manifest error (${m3u8Resp.status})`);
  }

  const m3u8Text = await m3u8Resp.text();
  const mapLine = m3u8Text.split(/\r?\n/).find((l) => l.startsWith('#EXT-X-MAP:URI='));
  const rawInitUrl = mapLine ? mapLine.split('"')[1] : null;
  const initUrl = rawInitUrl ? new URL(rawInitUrl, info.streamUrl).toString() : null;
  const segUrls = m3u8Text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => new URL(l, info.streamUrl).toString());
  const urls = [...(initUrl ? [initUrl] : []), ...segUrls];
  const mimeType = initUrl ? 'audio/mp4' : info.mimeType || 'audio/mpeg';
  return { info, urls, mimeType };
}

async function streamHlsProgressivelyAndCache(req, res, track, initialInfo, refreshFn, onDurationResolved) {
  const cachedBuf = scBufferCache.get(track.id);
  if (cachedBuf) {
    return sendBufferWithRange(req, res, cachedBuf.buffer, cachedBuf.mimeType, cachedBuf.abr);
  }

  if ((!track.duration || track.duration === 0) && initialInfo.duration > 0 && onDurationResolved) {
    onDurationResolved(initialInfo.duration);
  }

  if (initialInfo.protocol === 'http' || initialInfo.protocol === 'https') {
    return proxyDirectAudioUrl(req, res, initialInfo.streamUrl, initialInfo.abr);
  }

  const existingInflight = scInFlightCache.get(track.id);
  if (existingInflight) {
    const entry = await existingInflight;
    if (entry && !res.writableEnded && !req.destroyed) {
      return sendBufferWithRange(req, res, entry.buffer, entry.mimeType, entry.abr);
    }
  }

  const { info, urls, mimeType } = await parseHlsManifest(initialInfo, refreshFn);
  if (urls.length === 0) {
    return res.status(502).json({ error: 'Audio stream had no playable segments.' });
  }

  // Standard tracks (<= 120 segments): assemble concurrently in ~400ms so Chrome knows exact duration & full Range seek works
  if (urls.length <= 120) {
    const controller = new AbortController();
    const assemblePromise = (async () => {
      const buffers = new Array(urls.length);
      let cursor = 0;
      const concurrency = Math.min(12, urls.length);
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          while (cursor < urls.length) {
            const idx = cursor++;
            buffers[idx] = await fetchSegmentWithRetry(urls[idx], controller.signal);
          }
        })
      );
      const entry = { buffer: Buffer.concat(buffers), mimeType, abr: info.abr };
      setScBufferCache(track.id, entry);
      return entry;
    })()
      .catch(() => null)
      .finally(() => {
        scInFlightCache.delete(track.id);
      });

    scInFlightCache.set(track.id, assemblePromise);
    const assembled = await assemblePromise;
    if (assembled && !res.writableEnded && !req.destroyed) {
      return sendBufferWithRange(req, res, assembled.buffer, assembled.mimeType, assembled.abr);
    }
    if (res.writableEnded || req.destroyed) return;
  }

  // Fallback progressive chunked streaming for super long sets (> 120 segments)
  const controller = new AbortController();
  let clientClosed = false;
  req.on('close', () => {
    clientClosed = true;
    controller.abort();
  });

  res.status(200);
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Younamp-Audio-Only', 'true');
  if (info.abr) res.setHeader('X-Younamp-Bitrate', `${info.abr}kbps`);
  res.flushHeaders?.();

  const collected = [];
  const canCache = urls.length <= 120;
  const batchSize = 4;

  try {
    // First fetch init + first audio segment (2 URLs) so playback starts ASAP
    const firstSlice = urls.slice(0, Math.min(2, urls.length));
    const firstBufs = await Promise.all(
      firstSlice.map((u) => fetchSegmentWithRetry(u, controller.signal))
    );
    for (const buf of firstBufs) {
      if (clientClosed || res.writableEnded) break;
      res.write(buf);
      if (canCache) collected.push(buf);
    }

    for (let i = firstSlice.length; i < urls.length; i += batchSize) {
      if (clientClosed || res.writableEnded) break;
      const slice = urls.slice(i, i + batchSize);
      const bufs = await Promise.all(
        slice.map((u) => fetchSegmentWithRetry(u, controller.signal))
      );
      for (const buf of bufs) {
        if (clientClosed || res.writableEnded) break;
        res.write(buf);
        if (canCache) collected.push(buf);
      }
    }

    if (!clientClosed && canCache && collected.length === urls.length) {
      setScBufferCache(track.id, {
        buffer: Buffer.concat(collected),
        mimeType,
        abr: info.abr,
      });
    }
  } catch (err) {
    if (!clientClosed) {
      console.error('[Younamp] Progressive segment stream error:', err?.message || err);
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
}

async function warmTrackIntoBuffer(track) {
  if (!track || scBufferCache.has(track.id) || scInFlightCache.has(track.id)) return;
  if (track.source_type === 'youtube' && track.youtube_id) {
    await resolveDirectYouTubeAudioHttp(track.youtube_id, false).catch(() => null);
    return;
  }
  const promise = (async () => {
    let info;
    let refreshFn;
    if (track.source_type === 'soundcloud') {
      info = await getSoundCloudStreamInfo(track.url, false);
      refreshFn = () => getSoundCloudStreamInfo(track.url, true);
    } else {
      return null;
    }

    if (info.protocol === 'http' || info.protocol === 'https') return null;
    const { urls, mimeType } = await parseHlsManifest(info, refreshFn);
    if (urls.length === 0 || urls.length > 90) return null;

    const buffers = new Array(urls.length);
    const batchSize = 6;
    for (let i = 0; i < urls.length; i += batchSize) {
      const slice = urls.slice(i, i + batchSize);
      const fetched = await Promise.all(slice.map((u) => fetchSegmentWithRetry(u)));
      fetched.forEach((b, offset) => {
        buffers[i + offset] = b;
      });
    }
    const entry = { buffer: Buffer.concat(buffers), mimeType, abr: info.abr };
    setScBufferCache(track.id, entry);
    console.log(`[Younamp] Pre-warmed: ${track.title} (${entry.buffer.length} bytes)`);
    return entry;
  })()
    .catch(() => null)
    .finally(() => {
      scInFlightCache.delete(track.id);
    });
  scInFlightCache.set(track.id, promise);
  await promise;
}

let prewarmRunning = false;
const prewarmQueue = [];

export function prewarmTracks(tracks = []) {
  for (const t of tracks) {
    if (
      t &&
      (t.source_type === 'soundcloud' || t.source_type === 'youtube') &&
      !scBufferCache.has(t.id) &&
      !prewarmQueue.some((q) => q.id === t.id)
    ) {
      prewarmQueue.push(t);
    }
  }
  if (prewarmRunning) return;
  prewarmRunning = true;
  (async () => {
    try {
      while (prewarmQueue.length > 0 && scBufferCache.size < SC_BUFFER_MAX) {
        const nextTrack = prewarmQueue.shift();
        await warmTrackIntoBuffer(nextTrack);
      }
    } finally {
      prewarmRunning = false;
    }
  })();
}

export async function proxyAudioStream(
  req,
  res,
  track,
  cookieMode = 'none',
  onDurationResolved,
  profileDir = '',
  { strictYt = false } = {}
) {
  if (track.source_type === 'audio') {
    return proxyDirectAudioUrl(req, res, track.url);
  }

  if (track.source_type === 'soundcloud') {
    const scInfo = await getSoundCloudStreamInfo(track.url, false);
    return streamHlsProgressivelyAndCache(
      req,
      res,
      track,
      scInfo,
      () => {
        streamCache.delete(`sc:${track.url}`);
        return getSoundCloudStreamInfo(track.url, true);
      },
      onDurationResolved
    );
  }

  // 1. Primary Engine (FlowTube + NouTube pattern): Genuine direct YouTube InnerTube audio stream
  let streamInfo = await resolveDirectYouTubeAudioHttp(track.youtube_id, false);
  let usedDirectInnerTube = Boolean(streamInfo);

  // 2. Fallback to yt-dlp only if user configured local cookies AND direct InnerTube extraction failed
  const canUseDirectYtCookies =
    (cookieMode === 'cookies_file' && hasCustomCookiesFile()) ||
    ['chrome', 'edge', 'firefox', 'brave', 'opera', 'vivaldi'].includes(cookieMode);

  if (!streamInfo && canUseDirectYtCookies) {
    try {
      streamInfo = await getAudioStreamInfo(track.youtube_id, cookieMode, false, profileDir);
    } catch {
      streamInfo = null;
    }
  }

  // 3. Strictly pure YouTube: never substitute SoundCloud mirror for YouTube tracks
  if (!streamInfo) {
    return res.status(422).json({
      error: 'Direct YouTube audio unavailable',
      fallback: 'yt_iframe',
      youtube_id: track.youtube_id,
    });
  }
  if ((!track.duration || track.duration === 0) && streamInfo.duration > 0 && onDurationResolved) {
    onDurationResolved(streamInfo.duration);
  }

  const attemptUpstream = async (info) => {
    const controller = new AbortController();
    const onClose = () => controller.abort();
    req.once('close', onClose);

    const headers = {
      'User-Agent':
        info.httpHeaders?.['User-Agent'] ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    };
    if (req.headers.range) {
      headers.Range = req.headers.range;
    }

    try {
      const upstream = await fetch(info.audioUrl, { headers, signal: controller.signal });
      return { upstream, controller, onClose };
    } catch (err) {
      req.off('close', onClose);
      throw err;
    }
  };

  let result = await attemptUpstream(streamInfo);

  // If cached URL expired or hit GVS 403/410, invalidate cache, reroll visitorData & re-extract once
  if (result.upstream.status === 403 || result.upstream.status === 410) {
    req.off('close', result.onClose);
    if (usedDirectInnerTube) {
      ytDirectCache.delete(track.youtube_id);
      streamInfo = await resolveDirectYouTubeAudioHttp(track.youtube_id, true);
      if (streamInfo) {
        result = await attemptUpstream(streamInfo);
      }
    } else {
      streamCache.delete(`${track.youtube_id}:${cookieMode || 'none'}:${profileDir || 'Default'}`);
      streamInfo = await getAudioStreamInfo(track.youtube_id, cookieMode, true, profileDir);
      result = await attemptUpstream(streamInfo);
    }
  }

  if (!result?.upstream || (!result.upstream.ok && result.upstream.status !== 206)) {
    if (result?.onClose) req.off('close', result.onClose);
    if (canUseDirectYtCookies && !usedDirectInnerTube) {
      return pipeYtDlpFallback(req, res, track.youtube_id, cookieMode, profileDir);
    }
    return res.status(422).json({
      error: 'Direct YouTube audio unavailable',
      fallback: 'yt_iframe',
      youtube_id: track.youtube_id,
    });
  }

  res.status(result.upstream.status);
  const contentType = result.upstream.headers.get('content-type') || streamInfo.mimeType;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Accept-Ranges', result.upstream.headers.get('accept-ranges') || 'bytes');
  res.setHeader('X-Younamp-Audio-Only', 'true');
  res.setHeader(
    'X-Youtify-Audio-Engine',
    usedDirectInnerTube ? `yt-${streamInfo.clientName}` : 'yt-dlp'
  );
  if (streamInfo.itag) {
    res.setHeader('X-Youtify-Audio-Itag', String(streamInfo.itag));
  }
  if (streamInfo.abr) {
    res.setHeader('X-Younamp-Bitrate', `${streamInfo.abr}kbps`);
  }

  const contentLength = result.upstream.headers.get('content-length');
  if (contentLength) res.setHeader('Content-Length', contentLength);
  const contentRange = result.upstream.headers.get('content-range');
  if (contentRange) res.setHeader('Content-Range', contentRange);

  if (result.upstream.body) {
    const nodeStream = Readable.fromWeb(result.upstream.body);
    nodeStream.on('error', () => {
      if (!res.writableEnded) res.end();
    });
    nodeStream.pipe(res);
  } else {
    res.end();
  }
}

export function getCachedStreamMeta(youtubeId, cookieMode = 'none') {
  return streamCache.get(`${youtubeId}:${cookieMode || 'none'}`) || null;
}
