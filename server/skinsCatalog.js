import zlib from 'node:zlib';

export const WEBAMP_SKINS = [
  {
    id: 'base-2.91.wsz',
    name: 'Winamp Classic 2.91',
    md5: '5e4f10275dcb1fb211d4a8b4f1bda236',
    fileName: 'base-2.91.wsz',
    screenshotUrl: 'https://r2.webampskins.org/screenshots/5e4f10275dcb1fb211d4a8b4f1bda236.png',
    museumUrl: 'https://skins.webamp.org/skin/5e4f10275dcb1fb211d4a8b4f1bda236/base-2.91.wsz',
    palette: {
      frameTop: '#323246',
      frameBottom: '#242434',
      bevelLight: '#5C5C78',
      bevelDark: '#101018',
      titleTop: '#2D2D40',
      titleBottom: '#1C1C28',
      goldBar: '#D6BE74',
      lcdBg: '#000000',
      lcdText: '#00FF00',
      accent: '#F97316',
      btnTop: '#C7CCD8',
      btnBottom: '#8A91A6',
      btnText: '#11131F',
      activeRow: '#0000A8',
    },
  },
  {
    id: 'Winamp3_Classified_v5.5.wsz',
    name: 'Winamp3 Classified',
    md5: 'cd251187a5e6ff54ce938d26f1f2de02',
    fileName: 'Winamp3_Classified_v5.5.wsz',
    screenshotUrl: 'https://r2.webampskins.org/screenshots/cd251187a5e6ff54ce938d26f1f2de02.png',
    museumUrl: 'https://skins.webamp.org/skin/cd251187a5e6ff54ce938d26f1f2de02/Winamp3_Classified_v5.5.wsz',
    palette: {
      frameTop: '#3E4652',
      frameBottom: '#252B34',
      bevelLight: '#717D8E',
      bevelDark: '#0F1318',
      titleTop: '#363E4A',
      titleBottom: '#1E242D',
      goldBar: '#8FBCE6',
      lcdBg: '#050C14',
      lcdText: '#67E8F9',
      accent: '#38BDF8',
      btnTop: '#D1D7E0',
      btnBottom: '#939DAA',
      btnText: '#0F172A',
      activeRow: '#0369A1',
    },
  },
  {
    id: 'Winamp5_Classified_v5.5.wsz',
    name: 'Winamp5 Classified',
    md5: 'b0fb83cc20af3abe264291bb17fb2a13',
    fileName: 'Winamp5_Classified_v5.5.wsz',
    screenshotUrl: 'https://r2.webampskins.org/screenshots/b0fb83cc20af3abe264291bb17fb2a13.png',
    museumUrl: 'https://skins.webamp.org/skin/b0fb83cc20af3abe264291bb17fb2a13/Winamp5_Classified_v5.5.wsz',
    palette: {
      frameTop: '#2B3347',
      frameBottom: '#1A2030',
      bevelLight: '#5C6B8E',
      bevelDark: '#0A0D16',
      titleTop: '#242C40',
      titleBottom: '#151B28',
      goldBar: '#7BA4E8',
      lcdBg: '#030816',
      lcdText: '#60A5FA',
      accent: '#3B82F6',
      btnTop: '#CBD5E1',
      btnBottom: '#7E8BA3',
      btnText: '#0F172A',
      activeRow: '#1D4ED8',
    },
  },
  {
    id: 'Bento_Classified.wsz',
    name: 'Bento Classified',
    md5: 'd6010aa35bed659bc1311820daa4b341',
    fileName: 'Bento_Classified.wsz',
    screenshotUrl: 'https://r2.webampskins.org/screenshots/d6010aa35bed659bc1311820daa4b341.png',
    museumUrl: 'https://skins.webamp.org/skin/d6010aa35bed659bc1311820daa4b341/Bento_Classified.wsz',
    palette: {
      frameTop: '#26262C',
      frameBottom: '#18181D',
      bevelLight: '#52525E',
      bevelDark: '#08080A',
      titleTop: '#202026',
      titleBottom: '#121216',
      goldBar: '#F59E0B',
      lcdBg: '#070709',
      lcdText: '#FBBF24',
      accent: '#F59E0B',
      btnTop: '#9CA3AF',
      btnBottom: '#52525B',
      btnText: '#09090B',
      activeRow: '#B45309',
    },
  },
  {
    id: 'Fallout - Pip Boy 2000 1.2.wsz',
    name: 'Fallout Pip-Boy 2000',
    md5: '80fb8e391fc925f297174a8fd9c5b6ad',
    fileName: 'Fallout - Pip Boy 2000 1.2.wsz',
    screenshotUrl: 'https://r2.webampskins.org/screenshots/80fb8e391fc925f297174a8fd9c5b6ad.png',
    museumUrl: 'https://skins.webamp.org/skin/80fb8e391fc925f297174a8fd9c5b6ad/Fallout%20-%20Pip%20Boy%202000%201.2.wsz',
    palette: {
      frameTop: '#363E2F',
      frameBottom: '#23281E',
      bevelLight: '#6A755B',
      bevelDark: '#0F130C',
      titleTop: '#2C3325',
      titleBottom: '#1B2017',
      goldBar: '#A3E635',
      lcdBg: '#021205',
      lcdText: '#4ADE80',
      accent: '#84CC16',
      btnTop: '#A8B296',
      btnBottom: '#6E785D',
      btnText: '#141910',
      activeRow: '#166534',
    },
  },
  {
    id: 'Zelda_Amp_3.wsz',
    name: 'Zelda Amp 3',
    md5: 'd770a634cc1ab252cfb16c64f4f5f616',
    fileName: 'Zelda_Amp_3.wsz',
    screenshotUrl: 'https://r2.webampskins.org/screenshots/d770a634cc1ab252cfb16c64f4f5f616.png',
    museumUrl: 'https://skins.webamp.org/skin/d770a634cc1ab252cfb16c64f4f5f616/Zelda_Amp_3.wsz',
    palette: {
      frameTop: '#1D4231',
      frameBottom: '#12291E',
      bevelLight: '#4C8B69',
      bevelDark: '#08150E',
      titleTop: '#183728',
      titleBottom: '#0E2218',
      goldBar: '#FACC15',
      lcdBg: '#031109',
      lcdText: '#86EFAC',
      accent: '#EAB308',
      btnTop: '#D1D5DB',
      btnBottom: '#86EFAC',
      btnText: '#052E16',
      activeRow: '#15803D',
    },
  },
  {
    id: 'Deus_Ex_Amp_by_AJ.wsz',
    name: 'Deus Ex Amp',
    md5: '971c1afc05b56f5160903d0748b73239',
    fileName: 'Deus_Ex_Amp_by_AJ.wsz',
    screenshotUrl: 'https://r2.webampskins.org/screenshots/971c1afc05b56f5160903d0748b73239.png',
    museumUrl: 'https://skins.webamp.org/skin/971c1afc05b56f5160903d0748b73239/Deus_Ex_Amp_by_AJ.wsz',
    palette: {
      frameTop: '#292218',
      frameBottom: '#19140E',
      bevelLight: '#6B573A',
      bevelDark: '#090704',
      titleTop: '#231C13',
      titleBottom: '#14100A',
      goldBar: '#F59E0B',
      lcdBg: '#090703',
      lcdText: '#FCD34D',
      accent: '#D97706',
      btnTop: '#D6C39A',
      btnBottom: '#8D774B',
      btnText: '#1C1408',
      activeRow: '#92400E',
    },
  },
  {
    id: 'DOOM_II_AMP_update.wsz',
    name: 'DOOM II Amp',
    md5: '93220dd1556a346036d200a8df07b35f',
    fileName: 'DOOM_II_AMP_update.wsz',
    screenshotUrl: 'https://r2.webampskins.org/screenshots/93220dd1556a346036d200a8df07b35f.png',
    museumUrl: 'https://skins.webamp.org/skin/93220dd1556a346036d200a8df07b35f/DOOM_II_AMP_update.wsz',
    palette: {
      frameTop: '#422222',
      frameBottom: '#291414',
      bevelLight: '#7D4747',
      bevelDark: '#140808',
      titleTop: '#381B1B',
      titleBottom: '#220E0E',
      goldBar: '#EF4444',
      lcdBg: '#0D0303',
      lcdText: '#FCA5A5',
      accent: '#EF4444',
      btnTop: '#B8B2AD',
      btnBottom: '#786E6A',
      btnText: '#1C1010',
      activeRow: '#991B1B',
    },
  },
  {
    id: 'Microchip_2.wsz',
    name: 'Microchip 2',
    md5: '03a967351bc69b83a3c063782997d434',
    fileName: 'Microchip_2.wsz',
    screenshotUrl: 'https://r2.webampskins.org/screenshots/03a967351bc69b83a3c063782997d434.png',
    museumUrl: 'https://skins.webamp.org/skin/03a967351bc69b83a3c063782997d434/Microchip_2.wsz',
    palette: {
      frameTop: '#16352E',
      frameBottom: '#0E241F',
      bevelLight: '#367567',
      bevelDark: '#06120F',
      titleTop: '#122B25',
      titleBottom: '#0A1A16',
      goldBar: '#D97706',
      lcdBg: '#020B08',
      lcdText: '#2DD4BF',
      accent: '#14B8A6',
      btnTop: '#99F6E4',
      btnBottom: '#4D9E8E',
      btnText: '#042F2E',
      activeRow: '#0F766E',
    },
  },
  {
    id: 'Super_Mario_Land_First_GB_Model.wsz',
    name: 'GameBoy DMG Classic',
    md5: '3e5f4c237cbad07fce684f0e171abe6a',
    fileName: 'Super_Mario_Land_First_GB_Model.wsz',
    screenshotUrl: 'https://r2.webampskins.org/screenshots/3e5f4c237cbad07fce684f0e171abe6a.png',
    museumUrl: 'https://skins.webamp.org/skin/3e5f4c237cbad07fce684f0e171abe6a/Super_Mario_Land_First_GB_Model.wsz',
    palette: {
      frameTop: '#6B6D6A',
      frameBottom: '#4E504D',
      bevelLight: '#9FA39E',
      bevelDark: '#262725',
      titleTop: '#5B5D5A',
      titleBottom: '#3E403D',
      goldBar: '#9B2242',
      lcdBg: '#8BAC0F',
      lcdText: '#0F380F',
      accent: '#84CC16',
      btnTop: '#D4D4D8',
      btnBottom: '#8C8E94',
      btnText: '#18181B',
      activeRow: '#306230',
    },
  },
  {
    id: 'Simplex2.wsz',
    name: 'Simplex 2 Minimal',
    md5: '1ec5c59bdcbc250ffdf2caf684f6f7e6',
    fileName: 'Simplex2.wsz',
    screenshotUrl: 'https://r2.webampskins.org/screenshots/1ec5c59bdcbc250ffdf2caf684f6f7e6.png',
    museumUrl: 'https://skins.webamp.org/skin/1ec5c59bdcbc250ffdf2caf684f6f7e6/Simplex2.wsz',
    palette: {
      frameTop: '#2E2E34',
      frameBottom: '#1F1F24',
      bevelLight: '#5C5C66',
      bevelDark: '#0D0D10',
      titleTop: '#26262C',
      titleBottom: '#18181C',
      goldBar: '#A1A1AA',
      lcdBg: '#09090B',
      lcdText: '#E4E4E7',
      accent: '#E4E4E7',
      btnTop: '#E4E4E7',
      btnBottom: '#A1A1AA',
      btnText: '#09090B',
      activeRow: '#3F3F46',
    },
  },
  {
    id: 'SoundLair_v1_21.wsz',
    name: 'SoundLair Studio',
    md5: 'eda35a53d88257c88c0dbf7ca9c4a98d',
    fileName: 'SoundLair_v1_21.wsz',
    screenshotUrl: 'https://r2.webampskins.org/screenshots/eda35a53d88257c88c0dbf7ca9c4a98d.png',
    museumUrl: 'https://skins.webamp.org/skin/eda35a53d88257c88c0dbf7ca9c4a98d/SoundLair_v1_21.wsz',
    palette: {
      frameTop: '#23283D',
      frameBottom: '#161928',
      bevelLight: '#4C5680',
      bevelDark: '#090B14',
      titleTop: '#1D2234',
      titleBottom: '#121522',
      goldBar: '#22D3EE',
      lcdBg: '#040812',
      lcdText: '#34D399',
      accent: '#22D3EE',
      btnTop: '#CBD5E1',
      btnBottom: '#64748B',
      btnText: '#0F172A',
      activeRow: '#0E7490',
    },
  },
];

const DEFAULT_PALETTE = WEBAMP_SKINS[0].palette;
const resolvedSkinCache = new Map();

function formatSkinName(fileName = '') {
  return decodeURIComponent(fileName)
    .replace(/\.wsz$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Winamp Skin';
}

function clampByte(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function rgbHex(r, g, b) {
  return `#${clampByte(r).toString(16).padStart(2, '0')}${clampByte(g).toString(16).padStart(2, '0')}${clampByte(b).toString(16).padStart(2, '0')}`;
}

function adjustColor(hex, factor, delta = 0) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex || '#242434';
  const v = parseInt(m[1], 16);
  const r = ((v >> 16) & 255) * factor + delta;
  const g = ((v >> 8) & 255) * factor + delta;
  const b = (v & 255) * factor + delta;
  return rgbHex(r, g, b);
}

/** Extract uncompressed file buffers keyed by lowercase basename from a .wsz ZIP buffer. */
function unzipWszBuffer(buf) {
  const files = {};
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return files;

  const total = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);

  for (let n = 0; n < total && pos + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;
    const method = buf.readUInt16LE(pos + 10);
    const compSize = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOff = buf.readUInt32LE(pos + 42);
    const name = buf.slice(pos + 46, pos + 46 + nameLen).toString('utf8');
    pos += 46 + nameLen + extraLen + commentLen;

    if (compSize <= 0 || localOff + 30 > buf.length) continue;
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    if (dataStart + compSize > buf.length) continue;

    const raw = buf.slice(dataStart, dataStart + compSize);
    const base = name.split(/[/\\]/).pop().toLowerCase();
    try {
      files[base] = method === 8 ? zlib.inflateRawSync(raw) : raw;
    } catch {
      // Skip corrupted zip entry
    }
  }
  return files;
}

function normalizeHex(raw) {
  const m = /#?([0-9a-f]{6})/i.exec((raw || '').trim());
  return m ? `#${m[1].toUpperCase()}` : null;
}

function parsePleditTxt(buf) {
  if (!buf) return {};
  const text = buf.toString('utf8');
  const getVal = (key) => {
    const m = new RegExp(`^${key}\\s*=\\s*(.+)$`, 'im').exec(text);
    return m ? normalizeHex(m[1]) : null;
  };
  return {
    lcdText: getVal('Normal'),
    accent: getVal('Current'),
    lcdBg: getVal('NormalBG'),
    activeRow: getVal('SelectedBG'),
  };
}

function parseViscolorTxt(buf) {
  if (!buf) return {};
  const rows = buf
    .toString('utf8')
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter(Boolean)
    .map((line) => line.split(',').slice(0, 3).map((n) => parseInt(n.trim(), 10)))
    .filter((rgb) => rgb.length === 3 && rgb.every((n) => Number.isFinite(n)));

  const res = {};
  if (rows[0]) res.lcdBg = rgbHex(...rows[0]);
  const pick = rows[16] || rows[9] || rows[2];
  if (pick) res.accent = rgbHex(...pick);
  return res;
}

function sampleMainBmpFrameColor(buf) {
  if (!buf || buf.length < 54 || buf.readUInt16LE(0) !== 0x4d42) return null;
  const pixelOffset = buf.readUInt32LE(10);
  const dibSize = buf.readUInt32LE(14);
  const width = buf.readInt32LE(18);
  const height = Math.abs(buf.readInt32LE(22));
  const bpp = buf.readUInt16LE(28);
  const compression = buf.readUInt32LE(30);
  if (compression !== 0 || width <= 0 || height <= 0) return null;

  let palette = null;
  if (bpp <= 8) {
    const palOffset = 14 + dibSize;
    const count = 1 << bpp;
    palette = [];
    for (let i = 0; i < count && palOffset + i * 4 + 3 < buf.length; i++) {
      palette.push([
        buf[palOffset + i * 4 + 2],
        buf[palOffset + i * 4 + 1],
        buf[palOffset + i * 4],
      ]);
    }
  }

  const rowStride = Math.floor((bpp * width + 31) / 32) * 4;
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let count = 0;

  for (let y = 0; y < height; y += 6) {
    const rowStart = pixelOffset + y * rowStride;
    for (let x = 0; x < width; x += 8) {
      let r = 0;
      let g = 0;
      let b = 0;
      if (bpp === 24 || bpp === 32) {
        const px = rowStart + x * (bpp / 8);
        if (px + 2 >= buf.length) continue;
        b = buf[px];
        g = buf[px + 1];
        r = buf[px + 2];
      } else if (bpp === 8 && palette) {
        const idx = buf[rowStart + x];
        if (!palette[idx]) continue;
        [r, g, b] = palette[idx];
      } else {
        continue;
      }
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (luma > 25 && luma < 190) {
        rSum += r;
        gSum += g;
        bSum += b;
        count += 1;
      }
    }
  }

  if (count < 8) return null;
  const r = clampByte(rSum / count * 0.78);
  const g = clampByte(gSum / count * 0.78);
  const b = clampByte(bSum / count * 0.78);
  return rgbHex(r, g, b);
}

/**
 * Download & unzip a real .wsz archive from skins.webamp.org (r2.webampskins.org),
 * extracting BMP sprite textures and deriving matching palette tokens.
 */
export async function resolveWszSkinAssets({ id = '', md5 = '', name = '', fileName = '' }) {
  const catalogMatch = WEBAMP_SKINS.find(
    (s) => (md5 && s.md5 === md5) || (id && s.id === id)
  );
  const resolvedMd5 = catalogMatch?.md5 || md5;
  const resolvedId = catalogMatch?.id || id || fileName || resolvedMd5;
  const resolvedName = catalogMatch?.name || name || formatSkinName(fileName || resolvedId);
  const resolvedFile = catalogMatch?.fileName || fileName || resolvedId;

  if (!resolvedMd5 || !/^[0-9a-f]{32}$/i.test(resolvedMd5)) {
    return {
      id: resolvedId,
      name: resolvedName,
      md5: resolvedMd5,
      fileName: resolvedFile,
      screenshotUrl: catalogMatch?.screenshotUrl || '',
      museumUrl: catalogMatch?.museumUrl || 'https://skins.webamp.org',
      palette: catalogMatch?.palette || DEFAULT_PALETTE,
      bitmaps: {},
    };
  }

  if (resolvedSkinCache.has(resolvedMd5)) {
    return resolvedSkinCache.get(resolvedMd5);
  }

  let bitmaps = {};
  let dynamicPalette = {};

  try {
    const res = await fetch(`https://r2.webampskins.org/skins/${resolvedMd5}.wsz`, {
      signal: AbortSignal.timeout(9000),
    });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      const entries = unzipWszBuffer(buf);

      for (const key of ['main.bmp', 'eqmain.bmp', 'pledit.bmp', 'titlebar.bmp']) {
        if (entries[key]) {
          bitmaps[key.replace('.bmp', '')] = `data:image/bmp;base64,${entries[key].toString('base64')}`;
        }
      }

      const pledit = parsePleditTxt(entries['pledit.txt']);
      const vis = parseViscolorTxt(entries['viscolor.txt']);
      const frameBase = sampleMainBmpFrameColor(entries['main.bmp']);

      if (frameBase) {
        dynamicPalette.frameBottom = frameBase;
        dynamicPalette.frameTop = adjustColor(frameBase, 1.24, 12);
        dynamicPalette.titleTop = adjustColor(frameBase, 1.12, 8);
        dynamicPalette.titleBottom = adjustColor(frameBase, 0.72, -6);
        dynamicPalette.bevelLight = adjustColor(frameBase, 1.65, 32);
        dynamicPalette.bevelDark = adjustColor(frameBase, 0.45, -8);
        dynamicPalette.btnTop = adjustColor(frameBase, 1.9, 95);
        dynamicPalette.btnBottom = adjustColor(frameBase, 1.45, 50);
        dynamicPalette.btnText = '#0F172A';
      }
      if (pledit.lcdBg || vis.lcdBg) dynamicPalette.lcdBg = pledit.lcdBg || vis.lcdBg;
      if (pledit.lcdText) dynamicPalette.lcdText = pledit.lcdText;
      if (pledit.accent || vis.accent) dynamicPalette.accent = vis.accent || pledit.accent;
      if (pledit.activeRow) dynamicPalette.activeRow = pledit.activeRow;
      if (vis.accent || pledit.accent) dynamicPalette.goldBar = vis.accent || pledit.accent;
    }
  } catch (err) {
    console.warn(`[Younamp] .wsz fetch fallback for ${resolvedMd5}:`, err?.message || err);
  }

  const mergedPalette = catalogMatch?.palette
    ? { ...catalogMatch.palette }
    : { ...DEFAULT_PALETTE, ...dynamicPalette };

  const resolved = {
    id: resolvedId,
    name: resolvedName,
    md5: resolvedMd5,
    fileName: resolvedFile,
    screenshotUrl:
      catalogMatch?.screenshotUrl || `https://r2.webampskins.org/screenshots/${resolvedMd5}.png`,
    museumUrl:
      catalogMatch?.museumUrl ||
      `https://skins.webamp.org/skin/${resolvedMd5}/${encodeURIComponent(resolvedFile)}`,
    palette: mergedPalette,
    bitmaps,
  };

  resolvedSkinCache.set(resolvedMd5, resolved);
  return resolved;
}

/**
 * Search the live Winamp Skin Museum (skins.webamp.org) by keyword or pasted museum URL.
 */
export async function searchWebampMuseumSkins(rawQuery = '') {
  const q = rawQuery.trim();
  if (!q) return WEBAMP_SKINS;

  const urlMatch = /skins\.webamp\.org\/skin\/([0-9a-f]{32})(?:\/([^/?#]+))?/i.exec(q);
  if (urlMatch) {
    const resolved = await resolveWszSkinAssets({
      id: decodeURIComponent(urlMatch[2] || `${urlMatch[1]}.wsz`),
      md5: urlMatch[1].toLowerCase(),
      fileName: decodeURIComponent(urlMatch[2] || `${urlMatch[1]}.wsz`),
    });
    return [resolved];
  }

  const localMatches = WEBAMP_SKINS.filter(
    (s) => s.name.toLowerCase().includes(q.toLowerCase()) || s.fileName.toLowerCase().includes(q.toLowerCase())
  );

  try {
    const res = await fetch(`https://skins.webamp.org/?query=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return localMatches;
    const html = await res.text();
    const unescaped = html.replace(/\\"/g, '"');
    const marker = '"initialSearchSkins":[';
    const startIdx = unescaped.indexOf(marker);
    if (startIdx === -1) return localMatches;

    const slice = unescaped.slice(startIdx + marker.length - 1);
    const endIdx = slice.indexOf('],"totals":');
    const arrStr = endIdx !== -1 ? `${slice.slice(0, endIdx)}]` : null;
    if (!arrStr) return localMatches;

    const parsed = JSON.parse(arrStr);
    const seen = new Set(localMatches.map((s) => s.md5));
    const remoteSkins = [];

    for (const item of parsed) {
      if (!item?.md5 || item.nsfw || seen.has(item.md5)) continue;
      seen.add(item.md5);
      const fileName = item.fileName || `${item.md5}.wsz`;
      remoteSkins.push({
        id: fileName,
        name: formatSkinName(fileName),
        md5: item.md5,
        fileName,
        screenshotUrl: item.screenshotUrl || `https://r2.webampskins.org/screenshots/${item.md5}.png`,
        museumUrl: `https://skins.webamp.org/skin/${item.md5}/${encodeURIComponent(fileName)}`,
        palette: DEFAULT_PALETTE,
      });
      if (remoteSkins.length >= 18) break;
    }

    return [...localMatches, ...remoteSkins];
  } catch {
    return localMatches;
  }
}
