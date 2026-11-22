export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0:00';
  }
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function formatTotalDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0 min';
  }
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);

  if (hrs > 0) {
    return mins > 0 ? `${hrs} hr ${mins} min` : `${hrs} hr`;
  }
  if (mins > 0) {
    return `${mins} min`;
  }
  return `${total} sec`;
}

const SESSION_STORAGE_KEY = 'youtify_browser_sid';

export function getBrowserSessionId() {
  try {
    return localStorage.getItem(SESSION_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setBrowserSessionId(sid) {
  try {
    if (sid) localStorage.setItem(SESSION_STORAGE_KEY, String(sid));
  } catch {
    // Ignore storage quota / privacy mode error
  }
}

export function clearBrowserSessionId() {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

export async function apiFetch(url, options = {}) {
  const sid = getBrowserSessionId();
  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(sid ? { 'X-Youtify-Session': sid } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : null;

  if (data?.sessionId) {
    setBrowserSessionId(data.sessionId);
  }

  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    if (data?.needsBrowserVerification) err.needsBrowserVerification = true;
    err.status = res.status;
    throw err;
  }
  return data;
}
