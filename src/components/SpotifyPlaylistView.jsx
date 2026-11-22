import React, { useMemo, useState } from 'react';
import {
  Clock,
  FolderPlus,
  Link2,
  List,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Shuffle,
  Trash2,
  X,
} from 'lucide-react';
import TrackRow from './TrackRow';
import YoutifyLogo from './YoutifyLogo';

const HERO_GRADIENTS = [
  '#8E0D15', // Spotify Crimson (like screenshot)
  '#14532D', // Deep Emerald
  '#1E3A8A', // Midnight Cobalt
  '#7C2D12', // Burnt Amber
  '#4C1D95', // Deep Violet
  '#115E59', // Deep Teal
];

function getHeroColor(id = '') {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return HERO_GRADIENTS[hash % HERO_GRADIENTS.length];
}

function formatTotalDuration(tracks) {
  const totalSec = tracks.reduce((sum, t) => sum + (Number(t.duration) || 0), 0);
  if (totalSec <= 0) return '';
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  if (hours > 0) return `${hours} hr ${mins} min`;
  return `${Math.max(1, mins)} min`;
}

export default function SpotifyPlaylistView({
  playlist,
  playlists,
  tracks,
  isLoadingTracks,
  activeUser,
  currentTrack,
  playbackPlaylistName,
  isPlaying,
  isShuffle,
  isAddingUrl,
  isSyncingYt,
  ytSyncStatus,
  ytSyncError,
  urlError,
  draggingTrackId,
  onClearYtSyncFeedback,
  onClearUrlError,
  onPlayPlaylist,
  onShufflePlaylist,
  onTogglePlay,
  onPlayTrack,
  onAddToQueue,
  onMoveTrack,
  onRemoveTrack,
  onReorderTracks,
  onAddUrl,
  onSyncYouTube,
  onEditPlaylist,
  onDeletePlaylist,
  onOpenCreatePlaylist,
  onOpenSearch,
  onDragStartTrack,
  onDragEndTrack,
}) {
  const [showAddUrl, setShowAddUrl] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const heroColor = useMemo(() => getHeroColor(playlist?.id || ''), [playlist?.id]);
  const otherPlaylists = useMemo(
    () => playlists.filter((p) => p.id !== playlist?.id),
    [playlists, playlist?.id]
  );

  const mosaicThumbs = useMemo(() => {
    const thumbs = tracks.map((t) => t.thumbnail_url).filter(Boolean);
    if (thumbs.length === 0) return [];
    const unique = Array.from(new Set(thumbs));
    if (unique.length >= 4) return unique.slice(0, 4);
    const filled = [];
    for (let i = 0; i < 4; i++) {
      filled.push(unique[i % unique.length]);
    }
    return filled;
  }, [tracks]);

  const isThisPlaylistPlaying =
    isPlaying &&
    playbackPlaylistName &&
    playlist?.name &&
    playbackPlaylistName === playlist.name &&
    Boolean(currentTrack);

  const totalDurationLabel = useMemo(() => formatTotalDuration(tracks), [tracks]);

  const handleDropReorder = (draggedId, targetId, position) => {
    const ids = tracks.map((t) => t.id).filter((id) => id !== draggedId);
    const targetIndex = ids.indexOf(targetId);
    if (targetIndex === -1) return;
    const insertIndex = position === 'top' ? targetIndex : targetIndex + 1;
    ids.splice(insertIndex, 0, draggedId);
    onReorderTracks(playlist.id, ids);
  };

  const handleSubmitUrl = async (e) => {
    e.preventDefault();
    if (!urlInput.trim() || !playlist?.id || isAddingUrl) return;
    const ok = await onAddUrl(playlist.id, urlInput.trim());
    if (ok) {
      setUrlInput('');
      setShowAddUrl(false);
    }
  };

  if (!playlist) {
    return (
      <div className="flex-1 h-full bg-[#121212] rounded-lg flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-[#242424] flex items-center justify-center mb-4">
          <YoutifyLogo className="w-10 h-10" variant="green" title="" />
        </div>
        <h2 className="text-2xl font-bold text-white">No Playlist Selected</h2>
        <p className="text-sm text-[#B3B3B3] mt-2 max-w-md">
          Sync your YouTube account or create a new playlist folder to start listening ad-free.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onSyncYouTube}
            className="bg-[#1ED760] hover:bg-[#3BE477] text-black font-bold text-sm px-6 py-2.5 rounded-full transition-colors cursor-pointer"
          >
            Sync YouTube Library
          </button>
          <button
            type="button"
            onClick={onOpenCreatePlaylist}
            className="bg-[#242424] hover:bg-[#2A2A2A] text-white font-bold text-sm px-5 py-2.5 rounded-full inline-flex items-center gap-2 transition-colors cursor-pointer"
          >
            <FolderPlus className="w-4 h-4" aria-hidden="true" />
            <span>Create Playlist</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 h-full bg-[#121212] rounded-lg overflow-y-auto relative">
      {/* Spotify Dynamic Ambient Top Gradient */}
      <div
        className="px-5 sm:px-7 pt-6 pb-6"
        style={{
          background: `linear-gradient(180deg, ${heroColor} 0%, ${heroColor}99 58%, #121212 100%)`,
        }}
      >
        {/* Hero Header */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-5 sm:gap-6">
          {/* Artwork / 2x2 Mosaic */}
          <div className="w-40 h-40 sm:w-44 sm:h-44 xl:w-52 xl:h-52 rounded-md overflow-hidden shadow-[0_14px_40px_rgba(0,0,0,0.55)] bg-[#282828] shrink-0">
            {playlist.cover_image ? (
              <img
                src={playlist.cover_image}
                alt={playlist.name}
                className="w-full h-full object-cover"
              />
            ) : mosaicThumbs.length === 4 ? (
              <div className="w-full h-full grid grid-cols-2 grid-rows-2">
                {mosaicThumbs.map((src, i) => (
                  <img
                    key={`${src}-${i}`}
                    src={src}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ))}
              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <YoutifyLogo className="w-16 h-16" variant="green" title="" />
              </div>
            )}
          </div>

          {/* Playlist Title & Metadata */}
          <div className="min-w-0 flex-1 space-y-2">
            <div className="text-xs font-semibold text-white/90">
              {playlist.youtube_playlist_id ? 'YouTube Playlist' : 'Playlist'}
            </div>
            <h1 className="text-3xl sm:text-5xl xl:text-6xl font-extrabold tracking-tight text-white leading-tight break-words">
              {playlist.name}
            </h1>
            {playlist.description && (
              <p className="text-sm text-white/75 line-clamp-2 max-w-2xl">
                {playlist.description}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-1.5 text-sm text-white/90 pt-1">
              {activeUser?.avatar_url ? (
                <img
                  src={activeUser.avatar_url}
                  alt=""
                  className="w-5 h-5 rounded-full object-cover"
                />
              ) : null}
              <span className="font-bold text-white">{activeUser?.name || 'Youtify'}</span>
              <span className="text-white/75">•</span>
              <span className="text-white/80">
                {tracks.length} {tracks.length === 1 ? 'song' : 'songs'}
                {totalDurationLabel ? `, ${totalDurationLabel}` : ''}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Body with subtle dark wash continuation */}
      <div
        className="px-5 sm:px-7 pb-8"
        style={{
          background: `linear-gradient(180deg, ${heroColor}22 0%, #121212 130px)`,
        }}
      >
        {/* Main Action Toolbar */}
        <div className="py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              type="button"
              disabled={tracks.length === 0}
              onClick={() => (isThisPlaylistPlaying ? onTogglePlay() : onPlayPlaylist(tracks, 0))}
              aria-label={isThisPlaylistPlaying ? 'Pause playlist' : 'Play playlist'}
              className="w-14 h-14 rounded-full bg-[#1ED760] hover:bg-[#3BE477] hover:scale-105 active:scale-95 disabled:opacity-45 disabled:hover:scale-100 text-black flex items-center justify-center shadow-xl transition-transform cursor-pointer disabled:cursor-not-allowed"
            >
              {isThisPlaylistPlaying ? (
                <Pause className="w-6 h-6 fill-current" aria-hidden="true" />
              ) : (
                <Play className="w-6 h-6 fill-current ml-0.5" aria-hidden="true" />
              )}
            </button>

            <button
              type="button"
              disabled={tracks.length === 0}
              onClick={() => onShufflePlaylist(tracks)}
              title="Shuffle playlist"
              aria-label="Shuffle playlist"
              aria-pressed={isShuffle}
              className={`p-2 rounded-full transition-colors cursor-pointer disabled:opacity-40 ${
                isShuffle ? 'text-[#1ED760]' : 'text-[#B3B3B3] hover:text-white'
              }`}
            >
              <Shuffle className="w-6 h-6" aria-hidden="true" />
            </button>

            <button
              type="button"
              disabled={isSyncingYt}
              onClick={onSyncYouTube}
              title="Sync playlist with YouTube /feed/playlists"
              aria-label="Sync with YouTube"
              className="p-2 rounded-full text-[#B3B3B3] hover:text-white transition-colors cursor-pointer disabled:opacity-40"
            >
              <RefreshCw
                className={`w-5 h-5 ${isSyncingYt ? 'animate-spin text-[#1ED760]' : ''}`}
                aria-hidden="true"
              />
            </button>

            <button
              type="button"
              onClick={() => onEditPlaylist(playlist)}
              title="Edit playlist details"
              aria-label="Edit playlist details"
              className="p-2 rounded-full text-[#B3B3B3] hover:text-white transition-colors cursor-pointer"
            >
              <Pencil className="w-5 h-5" aria-hidden="true" />
            </button>

            {confirmDelete ? (
              <div className="inline-flex items-center gap-1.5 bg-[#242424] rounded-full px-3 py-1">
                <span className="text-xs text-white">Delete?</span>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmDelete(false);
                    onDeletePlaylist(playlist.id);
                  }}
                  className="text-xs font-bold text-red-400 hover:text-red-300 cursor-pointer"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs text-[#B3B3B3] hover:text-white cursor-pointer"
                >
                  No
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                title="Delete playlist"
                aria-label="Delete playlist"
                className="p-2 rounded-full text-[#B3B3B3] hover:text-red-400 transition-colors cursor-pointer"
              >
                <Trash2 className="w-5 h-5" aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-xs text-[#B3B3B3] font-medium">
            <span>List</span>
            <List className="w-4 h-4" aria-hidden="true" />
          </div>
        </div>

        {/* Spotify Action Pills ("+ Add", "Name & details", "+ Search") */}
        <div className="pb-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              onClearUrlError?.();
              setShowAddUrl((v) => !v);
            }}
            className="bg-[#232323] hover:bg-[#2A2A2A] text-white text-xs font-bold px-3.5 py-1.5 rounded-full inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>Add</span>
          </button>

          <button
            type="button"
            onClick={() => onEditPlaylist(playlist)}
            className="bg-[#232323] hover:bg-[#2A2A2A] text-white text-xs font-bold px-3.5 py-1.5 rounded-full inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Name &amp; details</span>
          </button>

          <button
            type="button"
            onClick={onOpenSearch}
            className="bg-[#232323] hover:bg-[#2A2A2A] text-white text-xs font-bold px-3.5 py-1.5 rounded-full inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Search className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Find songs</span>
          </button>
        </div>

        {/* Inline Add URL Bar when "+ Add" clicked */}
        {showAddUrl && (
          <form
            onSubmit={handleSubmitUrl}
            className="mb-4 p-3 rounded-lg bg-[#1F1F1F] border border-white/10 space-y-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Link2 className="w-4 h-4 text-[#B3B3B3] shrink-0" aria-hidden="true" />
              <input
                type="url"
                value={urlInput}
                onChange={(e) => {
                  setUrlInput(e.target.value);
                  if (urlError) onClearUrlError?.();
                }}
                placeholder="Paste a YouTube, SoundCloud, or direct audio URL..."
                autoFocus
                className="flex-1 min-w-[200px] bg-[#2A2A2A] rounded-full px-3.5 py-1.5 text-sm text-white placeholder-[#B3B3B3] focus:outline-none focus:ring-2 focus:ring-white"
              />
              <button
                type="submit"
                disabled={isAddingUrl || !urlInput.trim()}
                className="bg-[#1ED760] hover:bg-[#3BE477] disabled:opacity-45 text-black font-bold text-xs px-4 py-1.5 rounded-full cursor-pointer"
              >
                {isAddingUrl ? 'Adding...' : 'Add track'}
              </button>
              <button
                type="button"
                onClick={() => setShowAddUrl(false)}
                aria-label="Close add URL"
                className="p-1 text-[#B3B3B3] hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            {urlError && (
              <div role="alert" className="text-xs text-red-400 pl-6">
                {urlError}
              </div>
            )}
          </form>
        )}

        {/* Sync Feedback Toast */}
        {(ytSyncStatus || ytSyncError) && (
          <div
            role={ytSyncError ? 'alert' : 'status'}
            className={`mb-4 px-3.5 py-2 rounded-lg flex items-center justify-between gap-2 text-xs ${
              ytSyncError
                ? 'bg-red-500/15 border border-red-500/30 text-red-200'
                : 'bg-[#1ED760]/15 border border-[#1ED760]/30 text-[#1ED760]'
            }`}
          >
            <span className="truncate">{ytSyncError || ytSyncStatus}</span>
            <button
              type="button"
              onClick={onClearYtSyncFeedback}
              aria-label="Dismiss notification"
              className="opacity-75 hover:opacity-100 cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Track Table Header */}
        <div className="grid grid-cols-[32px_minmax(0,1fr)_88px] md:grid-cols-[36px_minmax(0,5fr)_90px_96px] xl:grid-cols-[36px_minmax(0,5fr)_90px_100px_104px] items-center gap-3 px-3 py-2 border-b border-white/10 text-xs uppercase tracking-wider text-[#B3B3B3] font-medium">
          <div className="text-center">#</div>
          <div>Title</div>
          <div className="hidden md:block">Source</div>
          <div className="hidden xl:block">Date added</div>
          <div className="flex justify-end pr-2">
            <Clock className="w-4 h-4" aria-label="Duration" />
          </div>
        </div>

        {/* Track List */}
        {isLoadingTracks ? (
          <div className="py-4 space-y-2">
            {[1, 2, 3, 4].map((n) => (
              <div
                key={n}
                className="h-14 rounded-md bg-white/5 animate-pulse"
              />
            ))}
          </div>
        ) : tracks.length === 0 ? (
          <div className="py-14 text-center space-y-3">
            <p className="text-base font-bold text-white">This playlist is empty</p>
            <p className="text-xs text-[#B3B3B3] max-w-sm mx-auto">
              Search YouTube in the top bar or click Find songs to add ad-free audio tracks.
            </p>
            <div className="flex items-center justify-center gap-2.5 pt-2">
              <button
                type="button"
                onClick={onOpenSearch}
                className="bg-white text-black hover:bg-[#F0F0F0] font-bold text-xs px-5 py-2 rounded-full cursor-pointer"
              >
                Find songs
              </button>
              <button
                type="button"
                onClick={() => setShowAddUrl(true)}
                className="bg-[#242424] hover:bg-[#2A2A2A] text-white font-bold text-xs px-4 py-2 rounded-full cursor-pointer"
              >
                + Add URL
              </button>
            </div>
          </div>
        ) : (
          <div className="pt-2 space-y-0.5">
            {tracks.map((track, idx) => (
              <TrackRow
                key={track.id}
                track={track}
                index={idx}
                isCurrentTrack={currentTrack?.id === track.id}
                isPlaying={isPlaying && currentTrack?.id === track.id}
                otherPlaylists={otherPlaylists}
                onPlayTrack={(t) => onPlayTrack(t, tracks)}
                onTogglePlay={onTogglePlay}
                onAddToQueue={onAddToQueue}
                onMoveTrack={onMoveTrack}
                onRemoveTrack={onRemoveTrack}
                onDragStartTrack={onDragStartTrack}
                onDragEndTrack={onDragEndTrack}
                onDropReorder={handleDropReorder}
                isDragged={draggingTrackId === track.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
