import React, { useState } from 'react';
import {
  Compass,
  Home,
  LogOut,
  Menu,
  RefreshCw,
  Search,
  Settings,
  X,
} from 'lucide-react';
import YoutifyLogo from './YoutifyLogo';

export default function SpotifyTopBar({
  mainView,
  searchQuery,
  activeUser,
  isSyncingYt,
  selectedPlaylistId,
  onGoHome,
  onSearchYouTube,
  onAddUrlToSelected,
  onSyncYouTube,
  onLogout,
  onOpenAccountModal,
  onOpenMobileLibrary,
}) {
  const [inputVal, setInputVal] = useState(searchQuery || '');

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = inputVal.trim();
    if (!trimmed) return;
    if (/^https?:\/\//i.test(trimmed)) {
      if (selectedPlaylistId) {
        const ok = await onAddUrlToSelected(selectedPlaylistId, trimmed);
        if (ok) setInputVal('');
      }
      return;
    }
    onSearchYouTube(trimmed);
  };

  const userInitial = (activeUser?.name || activeUser?.handle || 'Y')
    .replace(/^@/, '')
    .charAt(0)
    .toUpperCase();

  return (
    <header className="h-16 bg-black px-3 sm:px-4 flex items-center justify-between gap-2 sm:gap-4 shrink-0 select-none">
      {/* Left: Mobile Drawer Toggle & Brand Mark */}
      <div className="flex items-center gap-2.5 shrink-0">
        <button
          type="button"
          onClick={onOpenMobileLibrary}
          aria-label="Open Your Library"
          className="md:hidden w-9 h-9 rounded-full bg-[#1F1F1F] hover:bg-[#2A2A2A] text-white flex items-center justify-center cursor-pointer transition-colors"
        >
          <Menu className="w-4 h-4" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={onGoHome}
          title="Youtify Web Player"
          aria-label="Youtify Home"
          className="w-9 h-9 rounded-full flex items-center justify-center hover:scale-105 transition-transform cursor-pointer focus-visible:outline-2 focus-visible:outline-white"
        >
          <YoutifyLogo className="w-9 h-9" variant="white" title="" />
        </button>
      </div>

      {/* Center: Circular Home + Spotify Search Pill */}
      <div className="flex items-center gap-2 flex-1 max-w-[540px] justify-center min-w-0">
        <button
          type="button"
          onClick={onGoHome}
          title="Home"
          aria-label="Home"
          aria-pressed={mainView === 'home'}
          className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 cursor-pointer transition-all hover:scale-105 focus-visible:outline-2 focus-visible:outline-white ${
            mainView === 'home'
              ? 'bg-[#2A2A2A] text-white'
              : 'bg-[#1F1F1F] hover:bg-[#2A2A2A] text-[#B3B3B3] hover:text-white'
          }`}
        >
          <Home className="w-5 h-5" aria-hidden="true" />
        </button>

        <form
          onSubmit={handleSubmit}
          className="flex-1 min-w-0 h-11 rounded-full bg-[#1F1F1F] hover:bg-[#2A2A2A] focus-within:ring-2 focus-within:ring-white focus-within:bg-[#242424] px-3.5 flex items-center gap-2.5 transition-colors"
        >
          <Search className="w-5 h-5 text-[#B3B3B3] shrink-0" aria-hidden="true" />
          <input
            type="text"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            placeholder="What do you want to play?"
            aria-label="Search YouTube audio or paste a link"
            className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder-[#B3B3B3] focus:outline-none"
          />
          {inputVal && (
            <button
              type="button"
              onClick={() => setInputVal('')}
              aria-label="Clear search"
              className="text-[#B3B3B3] hover:text-white p-0.5 cursor-pointer"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
          <div className="h-5 w-px bg-white/15 hidden sm:block shrink-0" />
          <button
            type="submit"
            title="Search YouTube audio catalog"
            aria-label="Browse YouTube Search"
            className={`hidden sm:inline-flex items-center justify-center p-1 rounded-full transition-colors cursor-pointer shrink-0 ${
              mainView === 'search' ? 'text-[#1ED760]' : 'text-[#B3B3B3] hover:text-white'
            }`}
          >
            <Compass className="w-5 h-5" aria-hidden="true" />
          </button>
        </form>
      </div>

      {/* Right: Sync Pill, Settings & User Avatar */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          disabled={isSyncingYt}
          onClick={() => {
            if (activeUser) {
              onSyncYouTube();
            } else {
              onOpenAccountModal('user');
            }
          }}
          className="hidden sm:inline-flex items-center gap-1.5 bg-white text-black hover:bg-[#F0F0F0] hover:scale-[1.03] active:scale-[0.98] disabled:opacity-60 font-bold text-xs px-4 py-2 rounded-full transition-all cursor-pointer"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${isSyncingYt ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          <span>
            {isSyncingYt
              ? 'Syncing...'
              : activeUser
                ? 'Sync YouTube'
                : 'Connect YouTube'}
          </span>
        </button>

        <button
          type="button"
          onClick={() => onOpenAccountModal('audio')}
          title="Audio & Playback Settings"
          aria-label="Audio & Playback Settings"
          className="w-9 h-9 rounded-full flex items-center justify-center text-[#B3B3B3] hover:text-white hover:bg-[#1F1F1F] transition-colors cursor-pointer"
        >
          <Settings className="w-4 h-4" aria-hidden="true" />
        </button>

        {activeUser && onLogout && (
          <button
            type="button"
            onClick={onLogout}
            title="Sign Out"
            aria-label="Sign Out"
            className="w-9 h-9 rounded-full flex items-center justify-center text-[#B3B3B3] hover:text-red-400 hover:bg-[#1F1F1F] transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" aria-hidden="true" />
          </button>
        )}

        <button
          type="button"
          onClick={() => onOpenAccountModal('user')}
          title={
            activeUser?.handle
              ? `${activeUser.name} (${activeUser.handle})`
              : activeUser?.name || 'Connect Your YouTube Account'
          }
          aria-label="YouTube Account Profile"
          className="w-10 h-10 rounded-full bg-[#1F1F1F] p-1 hover:scale-105 transition-transform cursor-pointer flex items-center justify-center focus-visible:outline-2 focus-visible:outline-white"
        >
          {activeUser?.avatar_url ? (
            <img
              src={activeUser.avatar_url}
              alt={activeUser.name || 'YouTube Avatar'}
              className="w-full h-full rounded-full object-cover"
            />
          ) : (
            <span className="w-full h-full rounded-full bg-[#B49BC8] text-black font-extrabold text-xs flex items-center justify-center">
              {userInitial}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}
