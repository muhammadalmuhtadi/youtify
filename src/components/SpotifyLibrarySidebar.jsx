import React, { useMemo, useState } from 'react';
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Library,
  List,
  Plus,
  Search,
  Volume2,
  X,
} from 'lucide-react';
import YoutifyLogo from './YoutifyLogo';

export default function SpotifyLibrarySidebar({
  playlists,
  selectedPlaylistId,
  playbackPlaylistName,
  isPlaying,
  activeUser,
  collapsed,
  mobileOpen,
  onCloseMobile,
  onToggleCollapse,
  onSelectPlaylist,
  onOpenCreatePlaylist,
  onOpenAccountModal,
  onMoveTrack,
}) {
  const [filterChip, setFilterChip] = useState('all'); // 'all' | 'youtube' | 'local'
  const [libSearch, setLibSearch] = useState('');
  const [showSearchInput, setShowSearchInput] = useState(false);
  const [promoDismissed, setPromoDismissed] = useState(false);
  const [dragTargetId, setDragTargetId] = useState(null);

  const filteredPlaylists = useMemo(() => {
    let list = playlists;
    if (filterChip === 'youtube') {
      list = list.filter((p) => Boolean(p.youtube_playlist_id));
    } else if (filterChip === 'local') {
      list = list.filter((p) => !p.youtube_playlist_id);
    }
    const q = libSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((p) => (p.name || '').toLowerCase().includes(q));
    }
    return list;
  }, [playlists, filterChip, libSearch]);

  const handleDragOver = (e, playlistId) => {
    if (!e.dataTransfer.types.includes('application/x-younamp-track')) return;
    e.preventDefault();
    setDragTargetId(playlistId);
  };

  const handleDrop = (e, playlistId) => {
    e.preventDefault();
    setDragTargetId(null);
    const raw = e.dataTransfer.getData('application/x-younamp-track');
    if (!raw) return;
    try {
      const payload = JSON.parse(raw);
      if (payload?.trackId && payload.sourcePlaylistId !== playlistId) {
        onMoveTrack(payload.trackId, playlistId);
      }
    } catch {
      // Ignore malformed drop payload
    }
  };

  const ownerLabel = activeUser?.name || 'Youtify';

  const sidebarContent = (isCompact) => (
    <aside
      aria-label="Your Library"
      className="h-full bg-[#121212] rounded-lg flex flex-col overflow-hidden select-none"
    >
      {/* Header */}
      <div
        className={`px-4 pt-3.5 pb-2 flex items-center ${
          isCompact ? 'justify-center flex-col gap-3' : 'justify-between gap-2'
        }`}
      >
        <button
          type="button"
          onClick={onToggleCollapse}
          title={isCompact ? 'Expand Your Library' : 'Collapse Your Library'}
          className="flex items-center gap-2.5 text-[#B3B3B3] hover:text-white font-bold text-sm transition-colors cursor-pointer"
        >
          <Library className="w-5 h-5 shrink-0" aria-hidden="true" />
          {!isCompact && <span>Your Library</span>}
        </button>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenCreatePlaylist}
            title="Create playlist"
            aria-label="Create playlist"
            className="bg-[#1F1F1F] hover:bg-[#2A2A2A] text-white rounded-full px-3 py-1.5 text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            {!isCompact && <span>Create</span>}
          </button>

          {!isCompact && (
            <button
              type="button"
              onClick={mobileOpen ? onCloseMobile : onToggleCollapse}
              aria-label={mobileOpen ? 'Close library drawer' : 'Collapse library'}
              className="w-7 h-7 rounded-full flex items-center justify-center text-[#B3B3B3] hover:text-white hover:bg-[#242424] transition-colors cursor-pointer"
            >
              {mobileOpen ? (
                <X className="w-4 h-4" aria-hidden="true" />
              ) : (
                <ArrowLeftToLine className="w-4 h-4" aria-hidden="true" />
              )}
            </button>
          )}
        </div>
      </div>

      {isCompact ? (
        <div className="flex justify-center pb-2">
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Expand library"
            className="w-8 h-8 rounded-full flex items-center justify-center text-[#B3B3B3] hover:text-white hover:bg-[#242424] cursor-pointer"
          >
            <ArrowRightToLine className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <>
          {/* Filter Chips */}
          <div className="px-4 py-2 flex items-center gap-2 overflow-x-auto shrink-0">
            {[
              { id: 'all', label: 'Playlists' },
              { id: 'youtube', label: 'YouTube' },
              { id: 'local', label: 'Local' },
            ].map((chip) => {
              const active = filterChip === chip.id;
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setFilterChip(chip.id)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                    active
                      ? 'bg-white text-black'
                      : 'bg-[#232323] text-white hover:bg-[#2A2A2A]'
                  }`}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>

          {/* YouTube Library Sync Promo Card (Spotify "Import your music" style) */}
          {!promoDismissed && !activeUser?.yt_sync_connected && (
            <div className="mx-3 mt-1 mb-2 p-3.5 rounded-lg bg-gradient-to-br from-[#4C2A9B] via-[#3A217B] to-[#24164D] relative shrink-0">
              <button
                type="button"
                onClick={() => setPromoDismissed(true)}
                aria-label="Dismiss YouTube sync card"
                className="absolute top-2.5 right-2.5 text-white/70 hover:text-white p-0.5 cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
              <div className="text-sm font-bold text-white pr-5 leading-snug">
                Sync your YouTube playlists
              </div>
              <p className="text-xs text-white/80 mt-1">
                Bring your real private &amp; public /feed/playlists into Youtify.
              </p>
              <button
                type="button"
                onClick={() => onOpenAccountModal('user')}
                className="mt-3 bg-white text-black hover:bg-[#F0F0F0] hover:scale-[1.02] font-bold text-xs px-4 py-1.5 rounded-full transition-transform cursor-pointer"
              >
                Connect YouTube
              </button>
            </div>
          )}

          {/* Library Search & Recents Row */}
          <div className="px-3 py-1.5 flex items-center justify-between gap-2 shrink-0">
            {showSearchInput ? (
              <div className="flex-1 flex items-center gap-1.5 bg-[#242424] rounded px-2 py-1">
                <Search className="w-3.5 h-3.5 text-[#B3B3B3] shrink-0" aria-hidden="true" />
                <input
                  type="text"
                  value={libSearch}
                  onChange={(e) => setLibSearch(e.target.value)}
                  placeholder="Search in Your Library"
                  autoFocus
                  className="flex-1 min-w-0 bg-transparent text-xs text-white placeholder-[#B3B3B3] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    setLibSearch('');
                    setShowSearchInput(false);
                  }}
                  aria-label="Close library filter"
                  className="text-[#B3B3B3] hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowSearchInput(true)}
                aria-label="Search in Your Library"
                className="w-7 h-7 rounded-full flex items-center justify-center text-[#B3B3B3] hover:text-white hover:bg-[#242424] transition-colors cursor-pointer"
              >
                <Search className="w-4 h-4" aria-hidden="true" />
              </button>
            )}

            <div className="flex items-center gap-1 text-xs text-[#B3B3B3] font-medium shrink-0">
              <span>Recents</span>
              <List className="w-3.5 h-3.5" aria-hidden="true" />
            </div>
          </div>
        </>
      )}

      {/* Playlists List */}
      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
        {filteredPlaylists.length === 0 ? (
          !isCompact && (
            <div className="px-3 py-8 text-center text-xs text-[#B3B3B3]">
              No playlists found. Create one or sync from YouTube.
            </div>
          )
        ) : (
          filteredPlaylists.map((pl) => {
            const isSelected = pl.id === selectedPlaylistId;
            const isCurrentlyPlayingPl =
              isPlaying && playbackPlaylistName && playbackPlaylistName === pl.name;
            const isDropTarget = dragTargetId === pl.id;

            return (
              <button
                key={pl.id}
                type="button"
                onClick={() => {
                  onSelectPlaylist(pl.id);
                  if (mobileOpen) onCloseMobile();
                }}
                onDragOver={(e) => handleDragOver(e, pl.id)}
                onDragLeave={() => setDragTargetId(null)}
                onDrop={(e) => handleDrop(e, pl.id)}
                title={pl.name}
                className={`w-full p-2 rounded-md flex items-center gap-3 text-left transition-colors cursor-pointer ${
                  isDropTarget
                    ? 'ring-2 ring-[#1ED760] bg-[#1ED760]/15'
                    : isSelected
                      ? 'bg-[#232323]'
                      : 'hover:bg-[#1A1A1A]'
                } ${isCompact ? 'justify-center' : ''}`}
              >
                {pl.cover_image ? (
                  <img
                    src={pl.cover_image}
                    alt=""
                    loading="lazy"
                    className="w-12 h-12 rounded-md object-cover shrink-0 bg-[#242424]"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-md bg-gradient-to-br from-[#2E2E3A] to-[#1A1A22] flex items-center justify-center shrink-0">
                    <YoutifyLogo className="w-7 h-7" variant="green" title="" />
                  </div>
                )}

                {!isCompact && (
                  <>
                    <div className="min-w-0 flex-1">
                      <div
                        className={`text-sm font-medium truncate ${
                          isCurrentlyPlayingPl ? 'text-[#1ED760]' : 'text-white'
                        }`}
                      >
                        {pl.name}
                      </div>
                      <div className="text-xs text-[#B3B3B3] truncate mt-0.5">
                        {pl.youtube_playlist_id ? 'YouTube Playlist' : 'Playlist'} • {ownerLabel}
                        {typeof pl.track_count === 'number' ? ` • ${pl.track_count} songs` : ''}
                      </div>
                    </div>

                    {isCurrentlyPlayingPl && (
                      <Volume2
                        className="w-4 h-4 text-[#1ED760] shrink-0"
                        aria-label="Now playing from this playlist"
                      />
                    )}
                  </>
                )}
              </button>
            );
          })
        )}
      </div>
    </aside>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <div
        className={`hidden md:block shrink-0 h-full transition-[width] duration-200 ${
          collapsed ? 'w-[72px]' : 'w-[272px] xl:w-[320px]'
        }`}
      >
        {sidebarContent(collapsed)}
      </div>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 w-80 max-w-[85vw] h-full p-2">
            {sidebarContent(false)}
          </div>
        </div>
      )}
    </>
  );
}
