import React, { useEffect, useRef, useState } from 'react';
import YoutifyLogo from './YoutifyLogo';
import { setBrowserSessionId } from '../utils/format';

// Inline 12-frame 40x40 animated GIF89a spinner (zero network delay)
const LOADER_GIF_DATA_URI =
  'data:image/gif;base64,R0lGODlhKAAoAJEAABISEi4uLh7XYJr1uCH/C05FVFNDQVBFMi4wAwEAAAAh+QQJBgAAACwAAAAAKAAoAAAClATrY+py+8MIA62WSnb3zYeDnReSVVaiQQRq3OO+WwNP8mJLOKLn4m55DD7hcFQEHI2mDzBIXD4xzsIxeWpGVVNCFTsdgME/6Dc8GEu35jOT7FyjtWpzXB5cs9vpoEAQVvBE9A0K3FgxEPa1HCYkKi5WFD44Ss5YDCJSrlBQdjqeeIY+Zoh6bpUSbhmUqra6vsIuFAAAIfkECQYAAAAsAAAAACgAKAAAApEE62PqcvvDCAOtlkp2982Hg50XklVWokEEatzjvlsDT/JiSzii5+JueQw+4XBUBByNpg8wSFw+Mc7CMXlqRlVTQhU77UK/Xu44CJZuz9p0+SJgl5GC+VscNtDpzgH/js/XSfANDjAAzgkS8jUcBjYoLjo0OiLQKUZMZuYNZmhqRnZ6Tm6J5m39aZ6qrrK2LhQAACH5BAkGAAAALAAAAAAoACgAAAKYBOtj6nL7wwgDrZZKdvfNh4OdF5JVVqJBBGrc475bA0/yYks4oufibnkMPuFwVAQcjaYPMEhcPjHOwlFglU6RTYO1myVUu4KvFloQj79hr3p7FpPX1ribgE47eXb4NAm45/n9oSmZIdzhxQjuESrWKSAmIgwM6C1EolFqVj42YHZtahpCfAqEUmIFYZ4OkDGKhbrKztLSFgAAIfkECQYAAAAsAAAAACgAKAAAApQE62PqcvvDCAOtlkp2982Hg50XklVWokEEatzjvlsjCOIkL3SNnTai6zwE3A8oLPgKQNpxmAQsm0hLMSgFPKPXrHFLPWilXKv4awg3x0yvCdwtt8/vtFmJHj2hc3zcvV/lESwJ8PVV/bUE2t0twMwMDiQqHtIMWF6iZABdcpYI6XBihkgJhFqyXBGYEqW2ur7CAhQAACH5BAkGAAAALAAAAAAoACgAAAKYBOtj6nL7wwgDrZZKJi63+Qjh1pEfIIakmqGpWkKtyMCNLEycLUud1n50Cp5JiACaCJcEMWksIJNKDwglLSyrsysga4hKvVArV0wAO6lf8tV8YofV421bfoanK0d05jkP1ekxoQzkCQ4KDCgGuX0pPhZG+DBAPuY0IlQOYCzUOFS+rEg8hnpGKJb69aVycnWFusbKztIaFAAAIfkECQYAAAAsAAAAACgAKAAAApME62PqcvvDCAWtNOAgme0iZ9vheSAoAmRnmpu6sudEMrHm0E/c5NC+eEQsYAcFGCaKxqNspDQiDc9ly1lZFqpSC5agLUyhTTC3+yWEUWfAoN3uMkMH99s8JtAH8HV+f2f3Ua0BumENEsoJHcYlRkQl/Pg8Qk4uRNZcItg42nRWNniG3myIbgqWjtp5wrG2ur4aFAAAIfkECQYAAAAsAAAAACgAKAAAApEE62PqcvvDCAWtlkp2982Hg50XklSQlWSwRqBmrqzDTXHc0JF9L5u3nxQ+DwCoGCAxRMIugXwOlszmARqVTnkGKzYr20K7RRuC26WCn2J0gb10j7VSOPxHPtQz9Dt2zycaIeRB5AXa/eENLhgmAAURMjZGLk5KVrY56jhubupxfn5JgHL2jcqVfoqprrK2GhQAACH5BAkGAAAALAAAAAAoACgAAAKSBOtj6nL7wwgFrZZKdvfNh4OdNwyhKWRkeYaRSlYa97zqtDU1Kc2L7uEUgaHNAwgihkpjwRJIKJfMY/R5qE4L2Gs0S9gawFPxt+slA9AetDrDNmff0jhcW2fKh970nd+XVFlxzRm1BeK1+RFCHC4ECj48NkhGNk5SCmE6PHJ2unWC6q2FctKRiu6R7q2ytroaFAAAIfkECQYAAAAsAAAAACgAKAAAApkE62PqcvvDCAel4mIhWe35b0cQdNV3hsBIlsOJSuvYvvAjzwNT33gAvRq+XyS48IVsCGRKacClCqAlNApwqmRWaYa62hKmTy1YXKhuzQS0VZ39lrsi8naE8Y7A7/wcXqefAUaxrRFuMPXxDQoGMkIg4ilGQEZKOgwJUR5pJgwRKXhOeo5yMpCefsagYlqt+oGh6snO0tYaFAAAIfkECQYAAAAsAAAAACgAKAAAApkE62PqcvvDCAOt42LJKg/4C9rRdR8moCJAluaAphLbgnD8zMxr3xsJ8XoJliQYWvw0QWRHBVgOOU4CLyqdQg3NKdWG2HKro2vYO65wu7AvGWvWtp1iODo9L4Dd6zMl/XzjxancESTJERYKFgHS1YlksSk2VOwpEEV0CEVKbjr6GFrlTc6QguKUoqqgknKtcmqs+snO0tYaFAAAIfkECQYAAAAsAAAAACgAKAAAApkE62PqcvvDCAOtlkp2982Hg9UweEB4jqR0hukYgVrgvg4H0fVyR7kgWzwpAXHXKQ2ISsWxBFAWERsnARo1NKlWaZBahXIr3u/y0/VuzeJxGnvWgtUYdty9RtcLWWdb/+bnEUzBBQr+ZfTZ3SEmKs5JWP0Y7TVESk4eKlg+xCxYXtqwbERmiF40cppSFK6ognqJjsnO0tYuFAAAIfkECQYAAAAsAAAAACgAKAAAApME62PqcvvDCAOtlkp2982Hg50XklVWokEEatzjvlsDT/JiSzii59TwK0Qewq+Y4GWKxo9leFAOdk1nASo1UYnKKyYLsDKxWQGZzFV5y+Zwd6w+ewFqATz9ZqPd5XN+OKfXOc0FCWX83RRCHCImNvwBMk45PMYgGTxCOpRgDvaAcO6NcICuOW2AxhFYYKa2ur6+FgAAOw==';

export default function SpotifyLoginView({
  isBusy = false,
  error = '',
  onLogin,
}) {
  const [localError, setLocalError] = useState('');
  const [isCheckingSession, setIsCheckingSession] = useState(false);
  const activeStateRef = useRef('');
  const popupRef = useRef(null);
  const pollTimerRef = useRef(null);
  const handledRef = useRef(false);

  const cleanupAuthListeners = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const closePopupSafely = () => {
    try {
      if (popupRef.current && !popupRef.current.closed) {
        popupRef.current.close();
      }
    } catch {
      // Ignore cross-origin window close errors
    }
    popupRef.current = null;
  };

  const finalizeOAuthResult = async (result) => {
    if (!result || handledRef.current) return;
    if (result.state && activeStateRef.current && result.state !== activeStateRef.current) return;
    handledRef.current = true;
    cleanupAuthListeners();
    closePopupSafely();

    if (result.ok && result.sid) {
      try {
        setBrowserSessionId(result.sid);
        await onLogin({ oauthSid: result.sid });
        setIsCheckingSession(false);
        return;
      } catch (err) {
        setIsCheckingSession(false);
        setLocalError(err?.message || 'Gagal memuat sesi YouTube. Silakan coba lagi.');
        return;
      }
    }

    setIsCheckingSession(false);
    setLocalError(result.error || 'Autentikasi YouTube dibatalkan atau gagal. Silakan coba lagi.');
  };

  useEffect(() => {
    let bc = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        bc = new BroadcastChannel('youtify_auth');
        bc.onmessage = (ev) => {
          if (ev?.data?.type === 'youtify-oauth-result') {
            finalizeOAuthResult(ev.data);
          }
        };
      } catch {
        bc = null;
      }
    }

    const onMessage = (ev) => {
      if (ev.origin !== window.location.origin) return;
      if (ev?.data?.type === 'youtify-oauth-result') {
        finalizeOAuthResult(ev.data);
      }
    };

    const onStorage = (ev) => {
      if (ev.key !== 'youtify_oauth_event' || !ev.newValue) return;
      try {
        const parsed = JSON.parse(ev.newValue);
        if (parsed?.type === 'youtify-oauth-result') {
          finalizeOAuthResult(parsed);
        }
      } catch {
        // Ignore malformed event
      }
    };

    window.addEventListener('message', onMessage);
    window.addEventListener('storage', onStorage);

    return () => {
      cleanupAuthListeners();
      window.removeEventListener('message', onMessage);
      window.removeEventListener('storage', onStorage);
      if (bc) {
        try {
          bc.close();
        } catch {
          // Ignore
        }
      }
    };
  }, []);

  const handlePrimaryLogin = async () => {
    if (isCheckingSession || isBusy) return;
    setLocalError('');
    cleanupAuthListeners();
    handledRef.current = false;

    const state =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, '')
        : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    activeStateRef.current = state;

    const startUrl = `/api/auth/google/start?state=${encodeURIComponent(state)}`;
    const popup = window.open(
      startUrl,
      'youtify_google_oauth',
      'width=500,height=660,menubar=no,toolbar=no,location=yes,status=no,resizable=yes,scrollbars=yes'
    );
    popupRef.current = popup || null;

    if (!popup) {
      // If popup blocked by browser, redirect current window seamlessly to OAuth flow
      window.location.href = startUrl;
      return;
    }

    setIsCheckingSession(true);

    pollTimerRef.current = setInterval(async () => {
      if (handledRef.current) return;
      try {
        const resp = await fetch(`/api/auth/google/poll?state=${encodeURIComponent(state)}`, {
          credentials: 'include',
        });
        if (resp.ok) {
          const data = await resp.json().catch(() => null);
          if (data && data.pending === false) {
            await finalizeOAuthResult({ ...data, state });
            return;
          }
        }
      } catch {
        // Retry on next tick
      }
    }, 1200);
  };

  const showLoader = isCheckingSession || isBusy;
  const displayError = localError || error;

  return (
    <div className="min-h-screen w-screen overflow-y-auto bg-gradient-to-b from-[#1F1F1F] via-[#121212] to-black text-white flex flex-col justify-center px-4 py-10 select-none">
      <div className="w-full max-w-[390px] mx-auto flex flex-col items-center">
        <YoutifyLogo className="w-12 h-12 mb-5 shadow-lg" variant="white" title="Youtify" />

        <h1 className="text-[32px] sm:text-[40px] font-extrabold tracking-tight text-white text-center leading-[1.12] mb-6">
          Selamat datang kembali
        </h1>

        {displayError && !showLoader && (
          <div
            role="alert"
            className="w-full mb-5 px-4 py-2.5 rounded-md bg-[#E91429]/15 border border-[#E91429]/50 text-xs text-red-200 text-center"
          >
            {displayError}
          </div>
        )}

        {showLoader ? (
          <div
            role="status"
            aria-live="polite"
            className="w-full rounded-2xl bg-[#181818] border border-white/10 p-6 flex flex-col items-center gap-4 shadow-2xl"
          >
            <img
              src={LOADER_GIF_DATA_URI}
              alt="Memuat autentikasi YouTube"
              width={40}
              height={40}
              className="w-10 h-10 object-contain"
            />

            <div className="eq-bars" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>

            <p className="text-sm font-semibold text-white text-center leading-snug">
              Memeriksa &amp; menghubungkan akun YouTube Anda...
            </p>
            <p className="text-xs text-[#B3B3B3] text-center leading-relaxed">
              Pilih akun atau login Google/YouTube di jendela popup. Halaman ini akan masuk otomatis setelah selesai.
            </p>
            <button
              type="button"
              onClick={() => {
                cleanupAuthListeners();
                closePopupSafely();
                handledRef.current = true;
                setIsCheckingSession(false);
              }}
              className="text-xs text-[#B3B3B3] hover:text-white underline cursor-pointer"
            >
              Batal &amp; coba lagi
            </button>
          </div>
        ) : (
          <div className="w-full space-y-3">
            <button
              type="button"
              onClick={handlePrimaryLogin}
              className="relative w-full h-12 px-6 rounded-full bg-[#1ED760] hover:bg-[#3BE477] hover:scale-[1.02] active:scale-[0.99] text-black font-bold text-sm flex items-center justify-center gap-2.5 transition-all cursor-pointer shadow-lg"
            >
              <span className="inline-flex items-center justify-center rounded-full bg-white p-[1px]">
                <YoutifyLogo className="w-5 h-5" variant="red" title="" />
              </span>
              <span>Lanjutkan dengan YouTube</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
