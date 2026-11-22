import React, { useState } from 'react';
import { ExternalLink, KeyRound, Loader2, Upload } from 'lucide-react';
import YoutifyLogo from './YoutifyLogo';

export default function SpotifyLoginView({
  storedUser = null,
  isBusy = false,
  error = '',
  onLogin,
  onConnectCookie,
}) {
  const [identifier, setIdentifier] = useState(
    storedUser?.email || storedUser?.handle || ''
  );
  const [showCookieBox, setShowCookieBox] = useState(false);
  const [cookieInput, setCookieInput] = useState('');
  const [localError, setLocalError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isBusy) return;
    setLocalError('');
    try {
      await onLogin(identifier.trim());
    } catch (err) {
      setLocalError(err.message || 'Gagal masuk dengan akun YouTube.');
    }
  };

  const handleProviderLogin = async () => {
    if (isBusy) return;
    setLocalError('');
    try {
      await onLogin(identifier.trim());
    } catch (err) {
      setLocalError(err.message || 'Gagal masuk dengan session YouTube.');
    }
  };

  const handleCookieSubmit = async (e) => {
    e.preventDefault();
    if (isBusy || !cookieInput.trim()) return;
    setLocalError('');
    try {
      await onConnectCookie(cookieInput.trim());
      setCookieInput('');
    } catch (err) {
      setLocalError(err.message || 'Session cookie YouTube tidak valid.');
    }
  };

  const displayError = localError || error;

  return (
    <div className="min-h-screen w-screen overflow-y-auto bg-gradient-to-b from-[#1F1F1F] via-[#121212] to-black text-white flex flex-col justify-between px-4 py-8 sm:py-12 select-none">
      <div className="w-full max-w-[360px] mx-auto flex flex-col items-center">
        {/* Top Centered Brand Logo (Y inside Play Button) */}
        <YoutifyLogo className="w-12 h-12 mb-5 shadow-lg" variant="white" title="Youtify" />

        {/* Heading matching Spotify Web Login */}
        <h1 className="text-[32px] sm:text-[40px] font-extrabold tracking-tight text-white text-center leading-[1.12] mb-8">
          Selamat datang kembali
        </h1>

        {displayError && (
          <div
            role="alert"
            className="w-full mb-5 px-4 py-2.5 rounded-md bg-[#E91429]/15 border border-[#E91429]/50 text-xs text-red-200 text-center"
          >
            {displayError}
          </div>
        )}

        {/* Email / @handle Login Form */}
        <form onSubmit={handleSubmit} className="w-full space-y-4">
          <div>
            <label
              htmlFor="youtify-login-identifier"
              className="block text-xs font-bold text-white mb-2"
            >
              Email atau nama pengguna YouTube
            </label>
            <input
              id="youtify-login-identifier"
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="muhamadalmuhtadi@gmail.com atau @handle"
              className="w-full h-12 px-3.5 rounded-[4px] bg-[#121212] border border-[#727272] hover:border-white focus:border-white focus:ring-1 focus:ring-white focus:outline-none text-sm text-white placeholder-[#B3B3B3] transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={isBusy}
            className="w-full h-12 rounded-full bg-[#1ED760] hover:bg-[#3BE477] hover:scale-[1.02] active:scale-[0.99] disabled:opacity-60 text-black font-bold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            {isBusy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
            <span>Lanjutkan</span>
          </button>
        </form>

        {/* Divider */}
        <div className="my-5 text-xs font-bold text-white">atau</div>

        {/* Outlined Provider Buttons (Spotify Login Pattern) */}
        <div className="w-full space-y-2.5">
          <button
            type="button"
            disabled={isBusy}
            onClick={handleProviderLogin}
            className="relative w-full h-12 px-5 rounded-full bg-transparent border border-[#727272] hover:border-white text-white font-bold text-sm flex items-center justify-center transition-colors cursor-pointer disabled:opacity-60"
          >
            <svg
              viewBox="0 0 24 24"
              className="w-5 h-5 absolute left-5"
              aria-hidden="true"
            >
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.3 0 6.08-1.09 8.1-2.96l-3.88-3.05c-1.09.73-2.48 1.16-4.22 1.16-3.25 0-6-2.19-6.98-5.14H1.01v3.14C3.03 21.15 7.21 24 12 24Z"
              />
              <path
                fill="#FBBC05"
                d="M5.02 14.01c-.25-.73-.39-1.51-.39-2.31s.14-1.58.39-2.31V6.25H1.01C.37 7.53 0 8.97 0 10.5c0 1.53.37 2.97 1.01 4.25l4.01-3.14Z"
              />
              <path
                fill="#EA4335"
                d="M12 4.85c1.8 0 3.41.62 4.68 1.83l3.51-3.51C18.07 1.19 15.3 0 12 0 7.21 0 3.03 2.85 1.01 7.11l4.01 3.14c.98-2.95 3.73-5.14 6.98-5.14Z"
              />
            </svg>
            <span>Lanjutkan dengan Google</span>
          </button>

          <button
            type="button"
            disabled={isBusy}
            onClick={handleProviderLogin}
            className="relative w-full h-12 px-5 rounded-full bg-transparent border border-[#727272] hover:border-white text-white font-bold text-sm flex items-center justify-center transition-colors cursor-pointer disabled:opacity-60"
          >
            <span className="absolute left-5 flex items-center">
              <YoutifyLogo className="w-5 h-5" variant="red" title="" />
            </span>
            <span>
              {storedUser?.handle
                ? `Lanjutkan dengan YouTube (${storedUser.handle})`
                : 'Lanjutkan dengan YouTube Session'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setShowCookieBox((v) => !v)}
            className="relative w-full h-12 px-5 rounded-full bg-transparent border border-[#727272] hover:border-white text-white font-bold text-sm flex items-center justify-center transition-colors cursor-pointer"
          >
            <KeyRound className="w-4 h-4 absolute left-5 text-[#B3B3B3]" aria-hidden="true" />
            <span>Perbarui Cookie Session YouTube</span>
          </button>
        </div>

        {/* Optional Collapsible Cookie Session Input */}
        {showCookieBox && (
          <form
            onSubmit={handleCookieSubmit}
            className="w-full mt-4 p-3.5 rounded-lg bg-[#181818] border border-white/15 space-y-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-[#B3B3B3]">
                Paste header Cookie <code className="text-white">youtube.com</code> atau upload <code className="text-white">cookies.txt</code>:
              </span>
              <label className="bg-[#282828] hover:bg-[#333333] text-white px-2.5 py-1 rounded-full text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer shrink-0">
                <Upload className="w-3 h-3" aria-hidden="true" />
                <span>Load .txt</span>
                <input
                  type="file"
                  accept=".txt,.json,text/plain,application/json"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setCookieInput(await file.text());
                  }}
                />
              </label>
            </div>
            <textarea
              rows={2}
              value={cookieInput}
              onChange={(e) => setCookieInput(e.target.value)}
              placeholder="SAPISID=...; SID=... atau format Netscape cookies.txt..."
              className="w-full p-2.5 rounded bg-[#121212] text-white placeholder-[#7F7F7F] font-mono-num text-[11px] border border-white/10 focus:outline-none focus:ring-1 focus:ring-white resize-none"
            />
            <button
              type="submit"
              disabled={isBusy || !cookieInput.trim()}
              className="w-full h-9 rounded-full bg-white text-black hover:bg-[#F0F0F0] disabled:opacity-45 text-xs font-bold cursor-pointer"
            >
              Simpan &amp; Sinkronkan Session
            </button>
          </form>
        )}

        {/* Register / Open YouTube Account Link */}
        <div className="mt-8 text-center space-y-1.5">
          <div className="text-sm text-[#B3B3B3]">Tidak punya akun YouTube?</div>
          <a
            href="https://www.youtube.com/"
            target="_blank"
            rel="noreferrer"
            className="text-sm font-bold text-white hover:text-[#1ED760] underline underline-offset-4 inline-flex items-center gap-1"
          >
            <span>Daftar di YouTube</span>
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
          </a>
        </div>
      </div>

      {/* Bottom Legal / Session Info Footer */}
      <footer className="mt-10 text-center text-[11px] text-[#7F7F7F] max-w-xs mx-auto leading-relaxed">
        Youtify terhubung langsung dengan session YouTube Anda (D1 + KV Session Bridge) tanpa ekstensi browser.
      </footer>
    </div>
  );
}
