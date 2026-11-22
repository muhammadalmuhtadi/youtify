const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let scClientCache = { id: '', expiresAt: 0 };

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
  for (const bundleUrl of bundles.slice(-4).reverse()) {
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

function buildMirrorQueries(title, artist) {
  const cleanTitle = String(title || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(
      /\([^)]*(official|video|lyrics|audio|4k|60fps|hd|soundtrack|music video|visualizer)[^)]*\)/gi,
      ' '
    )
    .replace(/\b(official soundtrack|official audio|official music video|official video|lyrics)\b/gi, ' ')
    .replace(/[|]+|\/\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const a = String(artist || '').trim();
  const lowerTitle = cleanTitle.toLowerCase();
  const lowerArtist = a.toLowerCase();
  const isGenericArtist =
    !a ||
    ['youtube', 'unknown artist', 'nocopyrightsounds', 'watertower music', 'album musik'].includes(
      lowerArtist
    ) ||
    /\b(musik|music|channel|official|lyrics|lirik|topic)\b/i.test(a);

  const queries = [];
  if (cleanTitle.includes(' - ') && cleanTitle) {
    queries.push(cleanTitle);
  }
  if (!isGenericArtist && cleanTitle && !lowerTitle.includes(lowerArtist)) {
    const combo = `${a} ${cleanTitle}`.trim();
    if (combo && !queries.includes(combo)) queries.push(combo);
  }
  if (cleanTitle && !queries.includes(cleanTitle)) {
    queries.push(cleanTitle);
  }
  if (queries.length === 0 && title) {
    queries.push(String(title).trim());
  }
  return queries;
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

async function resolveSoundCloudStreamUrl(queries) {
  let clientId = await getSoundCloudClientId(false);
  for (const query of queries) {
    let sResp = await fetch(
      `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&client_id=${encodeURIComponent(clientId)}&limit=5`,
      { headers: { 'User-Agent': BROWSER_UA } }
    );
    if (sResp.status === 401 || sResp.status === 403) {
      clientId = await getSoundCloudClientId(true);
      sResp = await fetch(
        `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&client_id=${encodeURIComponent(clientId)}&limit=5`,
        { headers: { 'User-Agent': BROWSER_UA } }
      );
    }
    if (!sResp.ok) continue;

    const sData = await sResp.json().catch(() => null);
    const hits = Array.isArray(sData?.collection) ? sData.collection : [];
    for (const hit of hits) {
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
        return { streamUrl: trJson.url, mimeType, isProg };
      }
    }
  }
  return null;
}

function serveBytesWithRange(arrayBuffer, mimeType, rangeHeader) {
  const total = arrayBuffer.byteLength;
  const baseHeaders = {
    'Content-Type': mimeType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=900',
    'X-Younamp-Audio-Only': 'true',
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

export async function maybeHandleEdgeAudioStream(req, ctx) {
  if (req.method !== 'GET') return null;
  const url = new URL(req.url);
  if (!url.pathname.startsWith('/api/stream/')) return null;
  if (url.searchParams.get('format') === 'json') return null;

  const trackId = decodeURIComponent(url.pathname.slice('/api/stream/'.length));
  let title = (url.searchParams.get('title') || '').trim();
  let artist = (url.searchParams.get('artist') || '').trim();
  const ytId = trackId.startsWith('yt_') && trackId.length === 14 ? trackId.slice(3) : '';

  if (!title && !ytId) return null;

  const rangeHeader = req.headers.get('Range') || '';
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const cacheReq = new Request(
    `https://youtify-audio-cache.local/${encodeURIComponent(trackId)}?q=${encodeURIComponent(title + '|' + artist)}`
  );

  if (cache) {
    const cached = await cache.match(cacheReq);
    if (cached) {
      const buf = await cached.arrayBuffer();
      return serveBytesWithRange(buf, cached.headers.get('Content-Type') || 'audio/mp4', rangeHeader);
    }
  }

  try {
    if (!title && ytId) {
      const meta = await resolveYouTubeOEmbed(ytId);
      title = meta.title;
      if (!artist) artist = meta.artist;
    }
    if (!title) return null;

    const queries = buildMirrorQueries(title, artist);
    const resolved = await resolveSoundCloudStreamUrl(queries);
    if (!resolved) return null;

    if (resolved.isProg) {
      const up = await fetch(resolved.streamUrl, {
        headers: { 'User-Agent': BROWSER_UA, ...(rangeHeader ? { Range: rangeHeader } : {}) },
      });
      if (!up.ok && up.status !== 206) return null;
      const hdrs = new Headers(up.headers);
      hdrs.set('X-Younamp-Audio-Only', 'true');
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
        },
      });
      ctx.waitUntil(cache.put(cacheReq, cacheResp).catch(() => {}));
    }

    return serveBytesWithRange(assembled.buffer, resolved.mimeType, rangeHeader);
  } catch {
    return null;
  }
}
