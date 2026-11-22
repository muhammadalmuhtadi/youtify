import React, { useState } from 'react';
import { ExternalLink, KeyRound, Youtube } from 'lucide-react';
import YoutifyLogo from './YoutifyLogo';

// Inline 12-frame 40x40 animated GIF89a spinner (zero network delay)
const LOADER_GIF_DATA_URI =
  'data:image/gif;base64,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';

export default function SpotifyLoginView({
  isBusy = false,
  error = '',
  onLogin,
}) {
  const [needsCredentials, setNeedsCredentials] = useState(false);
  const [authTab, setAuthTab] = useState('cookies'); // 'cookies' | 'channel'
  const [cookieInput, setCookieInput] = useState('');
  const [channelInput, setChannelInput] = useState('');
  const [localError, setLocalError] = useState('');
  const [isCheckingSession, setIsCheckingSession] = useState(false);

  const handlePrimaryLogin = async () => {
    if (isCheckingSession || isBusy) return;
    setLocalError('');
    setIsCheckingSession(true);
    try {
      await onLogin({});
    } catch (err) {
      if (err?.needsBrowserVerification) {
        setNeedsCredentials(true);
      } else {
        setLocalError(err?.message || 'Gagal autentikasi dengan YouTube.');
      }
    } finally {
      setIsCheckingSession(false);
    }
  };

  const handleSubmitCredentials = async (e) => {
    e.preventDefault();
    if (isCheckingSession || isBusy) return;

    const payload =
      authTab === 'cookies'
        ? { cookieInput: cookieInput.trim() }
        : { channelInput: channelInput.trim() };

    if (authTab === 'cookies' && !payload.cookieInput) {
      setLocalError('Tempel Cookie YouTube browser Anda atau upload file cookies.txt.');
      return;
    }
    if (authTab === 'channel' && !payload.channelInput) {
      setLocalError('Masukkan @handle atau URL channel YouTube Anda sendiri.');
      return;
    }

    setLocalError('');
    setIsCheckingSession(true);
    try {
      await onLogin(payload);
    } catch (err) {
      setLocalError(err?.message || 'Verifikasi akun YouTube gagal. Periksa kembali kredensial Anda.');
    } finally {
      setIsCheckingSession(false);
    }
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
              Memverifikasi kredensial YouTube browser Anda...
            </p>
          </div>
        ) : !needsCredentials ? (
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
        ) : (
          <form
            onSubmit={handleSubmitCredentials}
            className="w-full rounded-2xl bg-[#181818] border border-white/10 p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
                  <Youtube className="w-4 h-4 text-[#FF0000]" aria-hidden="true" />
                  <span>Hubungkan Akun YouTube Anda</span>
                </h2>
                <p className="text-[11px] text-[#B3B3B3] mt-1 leading-relaxed">
                  Setiap perangkat menggunakan kredensial YouTube masing-masing dan terisolasi per browser.
                </p>
              </div>
              <a
                href="https://www.youtube.com/feed/playlists"
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-[11px] font-semibold text-[#1ED760] hover:underline inline-flex items-center gap-1"
              >
                <span>YouTube</span>
                <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>
            </div>

            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-full bg-[#121212] border border-white/10">
              <button
                type="button"
                onClick={() => {
                  setAuthTab('cookies');
                  setLocalError('');
                }}
                className={`h-8 rounded-full text-xs font-bold transition-colors cursor-pointer ${
                  authTab === 'cookies'
                    ? 'bg-white text-black'
                    : 'text-[#B3B3B3] hover:text-white'
                }`}
              >
                Cookie Sesi Asli
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthTab('channel');
                  setLocalError('');
                }}
                className={`h-8 rounded-full text-xs font-bold transition-colors cursor-pointer ${
                  authTab === 'channel'
                    ? 'bg-white text-black'
                    : 'text-[#B3B3B3] hover:text-white'
                }`}
              >
                @Handle Channel
              </button>
            </div>

            {authTab === 'cookies' ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="yt-cookie-input" className="text-xs font-semibold text-white">
                    Cookie / <code className="font-mono-num">cookies.txt</code> dari YouTube Anda
                  </label>
                  <label className="bg-[#282828] hover:bg-[#333333] text-white px-2.5 py-1 rounded-full text-[11px] font-semibold cursor-pointer">
                    Upload .txt
                    <input
                      type="file"
                      accept=".txt,.json,text/plain,application/json"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) setCookieInput(await file.text());
                      }}
                    />
                  </label>
                </div>
                <textarea
                  id="yt-cookie-input"
                  rows={3}
                  value={cookieInput}
                  onChange={(e) => setCookieInput(e.target.value)}
                  placeholder="Tempel header Cookie youtube.com (SAPISID=...; SID=...) atau isi cookies.txt..."
                  className="w-full p-2.5 rounded-lg bg-[#121212] text-white placeholder-[#7F7F7F] font-mono-num text-[11px] border border-white/10 focus:outline-none focus:ring-2 focus:ring-[#1ED760] resize-none"
                />
                <p className="text-[11px] text-[#94A3B8]">
                  Autentikasi penuh dengan sesi akun YouTube Anda sendiri (termasuk semua playlist pribadi &amp; Liked Videos).
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <label htmlFor="yt-channel-input" className="block text-xs font-semibold text-white">
                  @handle atau URL Channel YouTube Anda
                </label>
                <input
                  id="yt-channel-input"
                  type="text"
                  value={channelInput}
                  onChange={(e) => setChannelInput(e.target.value)}
                  placeholder="@username atau https://youtube.com/@username"
                  className="w-full h-10 px-3.5 rounded-lg bg-[#121212] text-white placeholder-[#7F7F7F] text-xs border border-white/10 focus:outline-none focus:ring-2 focus:ring-[#1ED760]"
                />
                <p className="text-[11px] text-[#94A3B8]">
                  Praktis di HP tanpa ekspor cookie — menyinkronkan profil channel dan playlist publik milik Anda sendiri.
                </p>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setNeedsCredentials(false);
                  setLocalError('');
                }}
                className="h-10 px-4 rounded-full bg-[#242424] hover:bg-[#333333] text-xs font-semibold text-white cursor-pointer"
              >
                Kembali
              </button>
              <button
                type="submit"
                className="flex-1 h-10 px-4 rounded-full bg-[#1ED760] hover:bg-[#3BE477] text-black text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Verifikasi &amp; Masuk</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
