import React, { useState } from 'react';
import { ArrowLeft, ExternalLink, KeyRound, Loader2, Upload } from 'lucide-react';
import YoutifyLogo from './YoutifyLogo';

export default function SpotifyLoginView({
  isBusy = false,
  error = '',
  needsVerification = false,
  onLogin,
  onConnect,
  onCancelVerification,
}) {
  const [channelInput, setChannelInput] = useState('');
  const [showCookieBox, setShowCookieBox] = useState(false);
  const [cookieInput, setCookieInput] = useState('');
  const [localError, setLocalError] = useState('');

  const handlePrimaryLogin = async () => {
    if (isBusy) return;
    setLocalError('');
    try {
      await onLogin();
    } catch (err) {
      setLocalError(err.message || 'Gagal masuk dengan akun YouTube.');
    }
  };

  const handleChannelVerify = async (e) => {
    e.preventDefault();
    const clean = channelInput.trim();
    if (isBusy || !clean) return;
    setLocalError('');
    try {
      await onConnect({ channelInput: clean });
      setChannelInput('');
    } catch (err) {
      setLocalError(err.message || 'Channel YouTube tidak ditemukan atau belum publik.');
    }
  };

  const handleCookieSubmit = async (e) => {
    e.preventDefault();
    const clean = cookieInput.trim();
    if (isBusy || !clean) return;
    setLocalError('');
    try {
      await onConnect({ cookieInput: clean });
      setCookieInput('');
    } catch (err) {
      setLocalError(err.message || 'Cookie session YouTube tidak valid.');
    }
  };

  const displayError = localError || error;

  return (
    <div className="min-h-screen w-screen overflow-y-auto bg-gradient-to-b from-[#1F1F1F] via-[#121212] to-black text-white flex flex-col justify-center px-4 py-10 select-none">
      <div className="w-full max-w-[360px] mx-auto flex flex-col items-center">
        {/* Top Centered Youtify Logo (Y inside Play Button) */}
        <YoutifyLogo className="w-12 h-12 mb-5 shadow-lg" variant="white" title="Youtify" />

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

        {!needsVerification ? (
          <div className="w-full space-y-4">
            <button
              type="button"
              disabled={isBusy}
              onClick={handlePrimaryLogin}
              className="relative w-full h-12 px-6 rounded-full bg-[#1ED760] hover:bg-[#3BE477] hover:scale-[1.02] active:scale-[0.99] disabled:opacity-60 text-black font-bold text-sm flex items-center justify-center gap-2.5 transition-all cursor-pointer shadow-lg"
            >
              {isBusy ? (
                <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
              ) : (
                <span className="inline-flex items-center justify-center rounded-full bg-white p-[1px]">
                  <YoutifyLogo className="w-5 h-5" variant="red" title="" />
                </span>
              )}
              <span>Lanjutkan dengan YouTube</span>
            </button>
          </div>
        ) : (
          <div className="w-full rounded-xl bg-[#181818] border border-white/15 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setLocalError('');
                  setShowCookieBox(false);
                  onCancelVerification?.();
                }}
                className="inline-flex items-center gap-1.5 text-xs text-[#B3B3B3] hover:text-white cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Kembali</span>
              </button>
              <a
                href="https://www.youtube.com/feed/playlists"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#1ED760] hover:underline"
              >
                <span>Buka YouTube di Browser Ini</span>
                <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>
            </div>

            <p className="text-xs text-[#B3B3B3] leading-relaxed">
              Belum ada sesi YouTube yang terverifikasi untuk browser ini. Pastikan Anda sudah login
              di YouTube pada browser ini, lalu verifikasi akun YouTube Anda dengan{' '}
              <code className="text-white">@handle</code> channel atau cookie sesi{' '}
              <code className="text-white">youtube.com</code>.
            </p>

            <form onSubmit={handleChannelVerify} className="space-y-3">
              <div>
                <label
                  htmlFor="youtify-channel-verify"
                  className="block text-xs font-bold text-white mb-1.5"
                >
                  Handle atau URL Channel YouTube Anda
                </label>
                <input
                  id="youtify-channel-verify"
                  type="text"
                  value={channelInput}
                  onChange={(e) => setChannelInput(e.target.value)}
                  placeholder="@username atau youtube.com/@username"
                  autoFocus
                  className="w-full h-11 px-3.5 rounded-[4px] bg-[#121212] border border-[#727272] hover:border-white focus:border-white focus:outline-none text-sm text-white placeholder-[#7F7F7F] transition-colors"
                />
              </div>

              <button
                type="submit"
                disabled={isBusy || !channelInput.trim()}
                className="w-full h-11 rounded-full bg-[#1ED760] hover:bg-[#3BE477] disabled:opacity-50 text-black font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                {isBusy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
                <span>Verifikasi &amp; Masuk</span>
              </button>
            </form>

            <div className="pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setShowCookieBox((v) => !v)}
                className="w-full py-1.5 text-xs font-semibold text-[#B3B3B3] hover:text-white inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {showCookieBox
                    ? 'Tutup Cookie Session YouTube'
                    : 'Sinkronisasi Penuh via Cookie Browser (youtube.com)'}
                </span>
              </button>

              {showCookieBox && (
                <form onSubmit={handleCookieSubmit} className="mt-3 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-[#B3B3B3]">
                      Paste header Cookie <code className="text-white">youtube.com</code> atau{' '}
                      <code className="text-white">cookies.txt</code>:
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
                    placeholder="SAPISID=...; SID=... atau Netscape cookies.txt"
                    className="w-full p-2.5 rounded bg-[#121212] text-white placeholder-[#7F7F7F] font-mono-num text-[11px] border border-white/10 focus:outline-none focus:ring-1 focus:ring-white resize-none"
                  />
                  <button
                    type="submit"
                    disabled={isBusy || !cookieInput.trim()}
                    className="w-full h-9 rounded-full bg-white text-black hover:bg-[#F0F0F0] disabled:opacity-45 text-xs font-bold cursor-pointer"
                  >
                    Simpan Cookie &amp; Masuk
                  </button>
                </form>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
