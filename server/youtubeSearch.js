/**
 * Reverse-engineered YouTube Web InnerTube search & autocomplete client.
 * Queries YouTube's internal /youtubei/v1/search endpoint directly so users can
 * discover and convert videos into audio tracks inside Younamp without an API key.
 */

const searchCache = new Map();
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const SEARCH_CACHE_MAX = 40;

const INNERTUBE_CLIENT = {
  clientName: 'WEB',
  clientVersion: '2.20250214.01.00',
  hl: 'id',
  gl: 'ID',
};

function extractText(node) {
  if (!node) return '';
  if (typeof node.simpleText === 'string') return node.simpleText;
  if (Array.isArray(node.runs)) return node.runs.map((r) => r.text || '').join('');
  return '';
}

/** Parse duration strings such as "3:58", "3.58", or "1:02:15" into integer seconds. */
export function parseDurationToSeconds(text = '') {
  const clean = String(text).trim().replace(/\./g, ':');
  if (!/^\d+(:\d{1,2})+$/.test(clean)) return 0;
  return clean.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
}

function normalizeVideoRenderer(v) {
  const videoId = v?.videoId;
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;

  const title = extractText(v.title).trim();
  if (!title) return null;

  const artist =
    extractText(v.ownerText).trim() || extractText(v.longBylineText).trim() || 'YouTube';
  const rawDuration = extractText(v.lengthText).trim();
  const duration = parseDurationToSeconds(rawDuration);

  return {
    youtube_id: videoId,
    title,
    artist,
    duration,
    duration_text: rawDuration ? rawDuration.replace(/\./g, ':') : 'LIVE',
    views: extractText(v.shortViewCountText).trim() || extractText(v.viewCountText).trim(),
    published_at: extractText(v.publishedTimeText).trim(),
    thumbnail_url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    source_type: 'youtube',
  };
}

function collectRenderers(data) {
  const sections =
    data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer
      ?.contents || [];
  const results = [];
  const seenIds = new Set();

  const pushVideo = (vr) => {
    const item = normalizeVideoRenderer(vr);
    if (!item || seenIds.has(item.youtube_id)) return;
    seenIds.add(item.youtube_id);
    results.push(item);
  };

  for (const sec of sections) {
    const items = sec?.itemSectionRenderer?.contents || [];
    for (const entry of items) {
      if (entry.videoRenderer) {
        pushVideo(entry.videoRenderer);
      } else if (entry.shelfRenderer?.content?.verticalListRenderer?.items) {
        for (const sub of entry.shelfRenderer.content.verticalListRenderer.items) {
          if (sub.videoRenderer) pushVideo(sub.videoRenderer);
        }
      }
      if (results.length >= 20) return results;
    }
  }
  return results;
}

function setSearchCache(key, results) {
  if (searchCache.has(key)) searchCache.delete(key);
  else if (searchCache.size >= SEARCH_CACHE_MAX) {
    const oldest = searchCache.keys().next().value;
    if (oldest) searchCache.delete(oldest);
  }
  searchCache.set(key, { results, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
}

/**
 * Search YouTube Web InnerTube directly by keyword and optional audio-oriented filter.
 * @param {string} rawQuery Search terms entered by the user.
 * @param {'all'|'music'|'podcast'} filter Search scope modifier.
 */
export async function searchYouTubeInnerTube(rawQuery, filter = 'all') {
  const q = String(rawQuery || '').trim();
  if (!q) return [];

  const normalizedFilter = ['all', 'music', 'podcast'].includes(filter) ? filter : 'all';
  const cacheKey = `${normalizedFilter}:${q.toLowerCase()}`;
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.results;
  }

  const effectiveQuery =
    normalizedFilter === 'music'
      ? `${q} official audio`
      : normalizedFilter === 'podcast'
        ? `${q} podcast`
        : q;

  const resp = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context: { client: INNERTUBE_CLIENT },
      query: effectiveQuery,
    }),
    signal: AbortSignal.timeout(9000),
  });

  if (!resp.ok) {
    throw new Error(`YouTube search request failed (status ${resp.status}).`);
  }

  const data = await resp.json();
  const results = collectRenderers(data);
  setSearchCache(cacheKey, results);
  return results;
}

/**
 * Fetch YouTube search autocomplete suggestions for a partial query.
 * @param {string} rawQuery Partial search phrase.
 */
export async function fetchYouTubeSuggestions(rawQuery) {
  const q = String(rawQuery || '').trim();
  if (q.length < 2) return [];

  try {
    const resp = await fetch(
      `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(q)}`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!resp.ok) return [];
    const data = await resp.json();
    const list = Array.isArray(data?.[1]) ? data[1] : [];
    return list.filter((s) => typeof s === 'string').slice(0, 6);
  } catch {
    return [];
  }
}
