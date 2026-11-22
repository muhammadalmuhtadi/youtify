import React, { useEffect, useState } from 'react';
import {
  Link2,
  ListVideo,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Unlink,
  Upload,
  X,
  Youtube,
} from 'lucide-react';
import YoutifyLogo from './YoutifyLogo';

const COOKIE_MODES = [
  { value: 'none', label: 'YouTube Session + Embedded Audio Player (Default)' },
  { value: 'cookies_file', label: 'Use Persisted YouTube Session Cookies' },
  { value: 'chrome', label: 'Use Chrome YouTube Cookies (Local Dev)' },
  { value: 'edge', label: 'Use Edge YouTube Cookies (Local Dev)' },
  { value: 'brave', label: 'Use Brave YouTube Cookies (Local Dev)' },
  { value: 'firefox', label: 'Use Firefox YouTube Cookies (Local Dev)' },
];

export default function AccountModal({
  isOpen,
  initialTab = 'user',
  requireAuth = false,
  activeUser,
  storedUser = null,
  isSyncingYt = false,
  onClose,
  onYouTubeLogout,
  onUpdateSettings,
  onConnectYouTubeSession,
  onDisconnectYouTubeSession,
  onSyncYouTube,
  onImportPublicYouTube,
}) {
  const [tab, setTab] = useState(initialTab === 'audio' ? 'audio' : 'user');
  const [authStatus, setAuthStatus] = useState('');
  const [authError, setAuthError] = useState('');
  const [cookieBridgeInput, setCookieBridgeInput] = useState('');
  const [showSessionCookieForm, setShowSessionCookieForm] = useState(!storedUser);
  const [publicImportInput, setPublicImportInput] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setTab(requireAuth ? 'user' : initialTab === 'audio' ? 'audio' : 'user');
    setAuthStatus('');
    setAuthError('');
    setShowSessionCookieForm(!activeUser && !storedUser);
  }, [isOpen, initialTab, requireAuth, activeUser, storedUser]);

  if (!isOpen) return null;

  const handleLogoutClick = async () => {
    if (isBusy) return;
    setIsBusy(true);
    setAuthError('');
    setAuthStatus('');
    try {
      await onYouTubeLogout();
      setAuthStatus('Signed out from YouTube session.');
    } catch (err) {
      setAuthError(err.message || 'Failed to sign out.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleConnectBridgeClick = async () => {
    if (isBusy || !cookieBridgeInput.trim()) return;
    setIsBusy(true);
    setAuthError('');
    setAuthStatus('');
    try {
      const data = await onConnectYouTubeSession(cookieBridgeInput);
      const count = data?.sync?.syncedCount ?? 0;
      const trackCount = data?.sync?.trackCount ?? 0;
      setCookieBridgeInput('');
      setAuthStatus(
        `Connected YouTube session & synced ${count} playlists (${trackCount} tracks) from /feed/playlists.`
      );
    } catch (err) {
      setAuthError(err.message || 'Failed to connect YouTube session cookies.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleSyncNowClick = async () => {
    if (isBusy || isSyncingYt) return;
    setIsBusy(true);
    setAuthError('');
    setAuthStatus('');
    try {
      const data = await onSyncYouTube();
      const count = data?.sync?.syncedCount ?? 0;
      const trackCount = data?.sync?.trackCount ?? 0;
      setAuthStatus(`YouTube session active — synced ${count} playlists (${trackCount} tracks).`);
    } catch (err) {
      setAuthError(err.message || 'Failed to sync YouTube session.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleDisconnectBridgeClick = async () => {
    if (isBusy) return;
    setIsBusy(true);
    setAuthError('');
    setAuthStatus('');
    try {
      await onDisconnectYouTubeSession();
      setAuthStatus('Cleared stored YouTube session cookies.');
    } catch (err) {
      setAuthError(err.message || 'Failed to clear YouTube session.');
    } finally {
      setIsBusy(false);
    }
  };

  const handlePublicImportClick = async () => {
    if (isBusy || !publicImportInput.trim()) return;
    setIsBusy(true);
    setAuthError('');
    setAuthStatus('');
    try {
      const data = await onImportPublicYouTube(publicImportInput);
      if (data) {
        setPublicImportInput('');
        setAuthStatus(
          `Imported ${data.importedPlaylists || 1} public YouTube playlist(s) (${data.importedTracks || 0} tracks).`
        );
      }
    } catch (err) {
      setAuthError(err.message || 'Failed to import public YouTube playlist.');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={
          requireAuth ? 'Sign In with YouTube Session' : 'Youtify Account & Audio Settings'
        }
        className="w-full max-w-xl bg-[#282828] text-white rounded-xl border border-white/10 shadow-2xl flex flex-col max-h-[88vh] overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <YoutifyLogo className="w-6 h-6" variant="green" title="" />
            <h2 className="text-lg font-bold tracking-tight text-white">
              {requireAuth ? 'Sign In with YouTube Session' : 'Account & Settings'}
            </h2>
          </div>

          {!requireAuth && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close modal"
              className="w-8 h-8 rounded-full flex items-center justify-center text-[#B3B3B3] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Navigation Pills */}
        {!requireAuth && (
          <div className="px-6 pt-3 pb-1 flex items-center gap-2 shrink-0">
            {[
              { id: 'user', label: 'YouTube Session', icon: Youtube },
              { id: 'audio', label: 'Audio & Playback', icon: ShieldCheck },
            ].map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                    active
                      ? 'bg-white text-black'
                      : 'bg-[#181818] text-[#B3B3B3] hover:text-white hover:bg-[#333333]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Body */}
        <div className="p-4 sm:p-6 overflow-y-auto overflow-x-hidden flex-1 space-y-4">
          {tab === 'user' && (
            <div className="space-y-4">
              {authStatus && (
                <div
                  role="status"
                  className="px-3.5 py-2.5 rounded-lg bg-[#1ED760]/15 border border-[#1ED760]/30 text-xs text-[#1ED760]"
                >
                  {authStatus}
                </div>
              )}
              {authError && (
                <div
                  role="alert"
                  className="px-3.5 py-2.5 rounded-lg bg-red-500/15 border border-red-500/30 text-xs text-red-200"
                >
                  {authError}
                </div>
              )}

              {activeUser ? (
                <>
                  {/* Connected Real YouTube Account Card */}
                  <div className="p-4 rounded-xl bg-[#181818] border border-white/10 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {activeUser.avatar_url ? (
                          <img
                            src={activeUser.avatar_url}
                            alt={activeUser.name}
                            className="w-12 h-12 rounded-full object-cover border border-white/20 shrink-0"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-full bg-[#CC0000] text-white flex items-center justify-center shrink-0">
                            <Youtube className="w-6 h-6" aria-hidden="true" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-bold text-white truncate">
                              {activeUser.name}
                            </span>
                            {activeUser.handle && (
                              <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#242424] text-[#B3B3B3] font-medium">
                                {activeUser.handle}
                              </span>
                            )}
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#1ED760]/20 text-[#1ED760] font-bold">
                              Session Active
                            </span>
                          </div>
                          {activeUser.email && (
                            <div className="text-xs text-[#B3B3B3] truncate mt-0.5">
                              {activeUser.email}
                            </div>
                          )}
                          <div className="text-[11px] text-[#94A3B8] mt-0.5">
                            YouTube Session Active • No browser extension needed
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                        <button
                          type="button"
                          disabled={isBusy || isSyncingYt}
                          onClick={handleSyncNowClick}
                          className="bg-[#1ED760] hover:bg-[#3BE477] text-black font-bold text-xs px-4 py-2 rounded-full inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <RefreshCw
                            className={`w-3.5 h-3.5 ${isBusy || isSyncingYt ? 'animate-spin' : ''}`}
                            aria-hidden="true"
                          />
                          <span>Sync /feed/playlists Now</span>
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={handleLogoutClick}
                          className="bg-[#242424] hover:bg-red-500/20 text-red-300 font-bold text-xs px-3.5 py-2 rounded-full inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Sign Out</span>
                        </button>
                      </div>
                    </div>

                    <p className="text-xs text-[#B3B3B3] leading-relaxed">
                      All playlists and tracks sync directly with your YouTube session&apos;s{' '}
                      <code className="text-white/90 font-mono-num">/feed/playlists</code> on the server.
                    </p>
                  </div>

                  {/* Public YouTube Playlist / @handle Quick Import */}
                  <div className="p-4 rounded-xl bg-[#181818] border border-white/10 space-y-2">
                    <label
                      htmlFor="public-yt-import-input"
                      className="block text-xs font-bold text-white"
                    >
                      Import Additional Public YouTube Playlist or @handle
                    </label>
                    <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                      <input
                        id="public-yt-import-input"
                        type="text"
                        value={publicImportInput}
                        onChange={(e) => setPublicImportInput(e.target.value)}
                        placeholder="https://www.youtube.com/playlist?list=... or @channel"
                        className="flex-1 min-w-0 w-full h-9 px-3.5 rounded-full bg-[#242424] text-white placeholder-[#B3B3B3] text-xs focus:outline-none focus:ring-2 focus:ring-white"
                      />
                      <button
                        type="button"
                        disabled={isBusy || !publicImportInput.trim()}
                        onClick={handlePublicImportClick}
                        className="bg-white text-black hover:bg-[#F0F0F0] disabled:opacity-45 h-9 px-4 rounded-full text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shrink-0"
                      >
                        <ListVideo className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Import</span>
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                /* Signed Out Auth Gate — Pure YouTube Session (Zero Extension Required) */
                <div className="p-4 rounded-xl bg-[#181818] border border-white/10 space-y-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-bold text-white">
                      <Youtube className="w-4 h-4 text-[#FF0000]" aria-hidden="true" />
                      <span>Sign In with YouTube Session</span>
                    </div>
                    <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#1ED760]/20 text-[#1ED760]">
                      No Extension Required
                    </span>
                  </div>

                  <p className="text-xs text-[#B3B3B3] leading-relaxed">
                    Youtify authenticates directly via your YouTube session on the backend — no Chrome or Edge extension needs to be installed.
                  </p>

                  {storedUser && (
                    <div className="p-3.5 rounded-lg bg-[#242424] space-y-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {storedUser.avatar_url ? (
                          <img
                            src={storedUser.avatar_url}
                            alt={storedUser.name}
                            className="w-10 h-10 rounded-full object-cover border border-white/20 shrink-0"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-[#CC0000] text-white flex items-center justify-center shrink-0">
                            <Youtube className="w-5 h-5" aria-hidden="true" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-bold text-white truncate">
                              {storedUser.name}
                            </span>
                            {storedUser.handle && (
                              <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#181818] text-[#B3B3B3]">
                                {storedUser.handle}
                              </span>
                            )}
                          </div>
                          {storedUser.email && (
                            <div className="text-xs text-[#B3B3B3] truncate">
                              {storedUser.email}
                            </div>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={isBusy || isSyncingYt}
                        onClick={handleSyncNowClick}
                        className="w-full sm:w-auto bg-[#1ED760] hover:bg-[#3BE477] text-black font-bold text-xs px-5 py-2.5 rounded-full inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {isBusy || isSyncingYt ? (
                          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <LogIn className="w-4 h-4" aria-hidden="true" />
                        )}
                        <span>Continue with YouTube Session &amp; Sync</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Direct YouTube Session Cookies Input (No Extension Needed) */}
              <div className="p-3.5 rounded-xl bg-[#181818] border border-white/10 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setShowSessionCookieForm((v) => !v)}
                    className="text-xs font-semibold text-white hover:text-[#1ED760] cursor-pointer inline-flex items-center gap-1.5 transition-colors"
                  >
                    <Link2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>
                      {showSessionCookieForm
                        ? '▾ Hide YouTube Session Cookie Input'
                        : '▸ Update / Paste YouTube Session Cookies (Header or cookies.txt)'}
                    </span>
                  </button>
                  {activeUser?.yt_sync_connected && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={handleDisconnectBridgeClick}
                      className="text-xs text-red-400 hover:text-red-300 cursor-pointer inline-flex items-center gap-1"
                    >
                      <Unlink className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Clear Stored Cookies</span>
                    </button>
                  )}
                </div>

                {showSessionCookieForm && (
                  <div className="p-3 rounded-lg bg-[#242424] space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-[#B3B3B3]">
                        Paste your <code className="text-white font-mono-num">youtube.com</code> Cookie header or upload <code className="text-white font-mono-num">cookies.txt</code>:
                      </span>
                      <label className="bg-[#333333] hover:bg-[#3E3E3E] text-white px-2.5 py-1 rounded-full text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer shrink-0">
                        <Upload className="w-3 h-3" aria-hidden="true" />
                        <span>Load .txt</span>
                        <input
                          type="file"
                          accept=".txt,.json,text/plain,application/json"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            setCookieBridgeInput(await file.text());
                          }}
                        />
                      </label>
                    </div>
                    <textarea
                      rows={2}
                      value={cookieBridgeInput}
                      onChange={(e) => setCookieBridgeInput(e.target.value)}
                      placeholder="Paste YouTube Cookie header (SAPISID=...; SID=...) or Netscape cookies.txt..."
                      className="w-full p-2.5 rounded-lg bg-[#121212] text-white placeholder-[#7F7F7F] font-mono-num text-[11px] border border-white/10 focus:outline-none focus:ring-2 focus:ring-white resize-none"
                    />
                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={isBusy || !cookieBridgeInput.trim()}
                        onClick={handleConnectBridgeClick}
                        className="bg-white text-black hover:bg-[#F0F0F0] disabled:opacity-45 px-4 py-1.5 rounded-full text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Link2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Connect &amp; Sync YouTube</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'audio' && (
            <div className="p-4 rounded-xl bg-[#181818] border border-white/10 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-bold text-white">
                  <ShieldCheck className="w-4 h-4 text-[#1ED760]" aria-hidden="true" />
                  <span>Audio Playback Session Mode</span>
                </div>
                <button
                  type="button"
                  onClick={() => setTab('user')}
                  className="bg-[#242424] hover:bg-[#2E2E2E] text-white px-3 py-1 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Youtube className="w-3.5 h-3.5 text-[#FF0000]" aria-hidden="true" />
                  <span>Manage YouTube Session</span>
                </button>
              </div>

              <select
                value={activeUser?.cookie_mode || 'none'}
                onChange={(e) => onUpdateSettings({ cookie_mode: e.target.value })}
                className="w-full h-10 px-3 rounded-lg bg-[#242424] text-white text-xs border border-white/10 focus:outline-none focus:ring-2 focus:ring-white cursor-pointer"
              >
                {COOKIE_MODES.map((m) => (
                  <option key={m.value} value={m.value} className="bg-[#181818] text-white">
                    {m.label}
                  </option>
                ))}
              </select>

              <p className="text-xs text-[#B3B3B3] leading-relaxed">
                Audio playback runs natively via HTML5 streaming locally or the embedded YouTube audio player on Cloudflare Workers using your active YouTube session — no extension needed.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
