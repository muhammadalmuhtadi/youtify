import React, { useEffect, useRef, useState } from 'react';
import {
  FolderInput,
  ListPlus,
  Music2,
  Pause,
  Play,
  Trash2,
} from 'lucide-react';
import { formatTime } from '../utils/format';

function formatAddedDate(rawDate) {
  if (!rawDate) return 'Synced';
  const normalized = String(rawDate).includes('T')
    ? rawDate
    : String(rawDate).replace(' ', 'T') + 'Z';
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return 'Synced';
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function TrackRow({
  track,
  index,
  isCurrentTrack,
  isPlaying,
  otherPlaylists,
  onPlayTrack,
  onTogglePlay,
  onAddToQueue,
  onMoveTrack,
  onRemoveTrack,
  onDragStartTrack,
  onDragEndTrack,
  onDropReorder,
  isDragged,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropPosition, setDropPosition] = useState(null); // 'top' | 'bottom' | null
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [menuOpen]);

  const handleDragStart = (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(
      'application/x-younamp-track',
      JSON.stringify({
        trackId: track.id,
        sourcePlaylistId: track.playlist_id,
      })
    );
    onDragStartTrack(track.id);
  };

  const handleDragOver = (e) => {
    if (!e.dataTransfer.types.includes('application/x-younamp-track')) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    setDropPosition(e.clientY < mid ? 'top' : 'bottom');
  };

  const handleDragLeave = () => {
    setDropPosition(null);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const pos = dropPosition || 'bottom';
    setDropPosition(null);
    const raw = e.dataTransfer.getData('application/x-younamp-track');
    if (!raw) return;
    try {
      const payload = JSON.parse(raw);
      if (
        payload?.trackId &&
        payload.trackId !== track.id &&
        payload.sourcePlaylistId === track.playlist_id
      ) {
        onDropReorder(payload.trackId, track.id, pos);
      }
    } catch {
      // Ignore malformed drop payload
    }
  };

  const sourceLabel =
    track.source_type === 'soundcloud'
      ? 'SoundCloud'
      : track.source_type === 'youtube'
        ? 'YouTube'
        : 'Direct Audio';

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={() => {
        setDropPosition(null);
        onDragEndTrack();
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onDoubleClick={() => (isCurrentTrack ? onTogglePlay() : onPlayTrack(track))}
      className={`group relative grid grid-cols-[32px_minmax(0,1fr)_88px] md:grid-cols-[36px_minmax(0,5fr)_90px_96px] xl:grid-cols-[36px_minmax(0,5fr)_90px_100px_104px] items-center gap-3 px-3 h-14 rounded-md transition-colors ${
        isDragged
          ? 'opacity-40 bg-white/5'
          : isCurrentTrack
            ? 'bg-white/10'
            : 'hover:bg-white/10'
      }`}
    >
      {/* Drag reorder drop line */}
      {dropPosition === 'top' && (
        <div className="absolute left-2 right-2 -top-px h-0.5 bg-[#1ED760] pointer-events-none" />
      )}
      {dropPosition === 'bottom' && (
        <div className="absolute left-2 right-2 -bottom-px h-0.5 bg-[#1ED760] pointer-events-none" />
      )}

      {/* Col 1: Track Number / Animated EQ / Play-Pause Button */}
      <div className="flex items-center justify-center">
        <button
          type="button"
          onClick={() => (isCurrentTrack ? onTogglePlay() : onPlayTrack(track))}
          aria-label={isCurrentTrack && isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
          className="w-7 h-7 flex items-center justify-center cursor-pointer"
        >
          {isCurrentTrack ? (
            isPlaying ? (
              <>
                <span className="flex items-end gap-[2px] h-3.5 group-hover:hidden" aria-hidden="true">
                  <span className="spotify-eq-bar" />
                  <span className="spotify-eq-bar" />
                  <span className="spotify-eq-bar" />
                </span>
                <Pause className="w-4 h-4 text-[#1ED760] fill-current hidden group-hover:block" aria-hidden="true" />
              </>
            ) : (
              <>
                <span className="text-sm font-medium text-[#1ED760] tabular-nums group-hover:hidden">
                  {index + 1}
                </span>
                <Play className="w-4 h-4 text-[#1ED760] fill-current hidden group-hover:block" aria-hidden="true" />
              </>
            )
          ) : (
            <>
              <span className="text-sm text-[#B3B3B3] tabular-nums group-hover:hidden">
                {index + 1}
              </span>
              <Play className="w-4 h-4 text-white fill-current hidden group-hover:block" aria-hidden="true" />
            </>
          )}
        </button>
      </div>

      {/* Col 2: Artwork + Title + Artist */}
      <button
        type="button"
        onClick={() => (isCurrentTrack ? onTogglePlay() : onPlayTrack(track))}
        className="min-w-0 flex items-center gap-3 text-left cursor-pointer"
      >
        {track.thumbnail_url ? (
          <img
            src={track.thumbnail_url}
            alt=""
            loading="lazy"
            className="w-10 h-10 rounded object-cover shrink-0 bg-[#242424]"
          />
        ) : (
          <div className="w-10 h-10 rounded bg-[#242424] flex items-center justify-center shrink-0 text-[#B3B3B3]">
            <Music2 className="w-4 h-4" aria-hidden="true" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div
            className={`text-sm font-medium truncate ${
              isCurrentTrack ? 'text-[#1ED760]' : 'text-white'
            }`}
          >
            {track.title}
          </div>
          <div className="text-xs text-[#B3B3B3] truncate mt-0.5">
            {track.artist || 'Unknown Artist'}
          </div>
        </div>
      </button>

      {/* Col 3: Source Platform (Spotify "Album" slot) */}
      <div className="hidden md:block text-xs text-[#B3B3B3] truncate">
        {sourceLabel}
      </div>

      {/* Col 4: Date Added */}
      <div className="hidden xl:block text-xs text-[#B3B3B3] truncate">
        {formatAddedDate(track.created_at)}
      </div>

      {/* Col 5: Actions + Duration */}
      <div className="flex items-center justify-end gap-1.5">
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAddToQueue(track);
            }}
            title="Add to queue"
            aria-label="Add to queue"
            className="p-1 text-[#B3B3B3] hover:text-white cursor-pointer"
          >
            <ListPlus className="w-3.5 h-3.5" aria-hidden="true" />
          </button>

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              disabled={otherPlaylists.length === 0}
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              title={
                otherPlaylists.length === 0
                  ? 'Create another playlist to move songs'
                  : 'Move to playlist'
              }
              aria-label="Move to another playlist"
              className="p-1 text-[#B3B3B3] hover:text-white disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
            >
              <FolderInput className="w-3.5 h-3.5" aria-hidden="true" />
            </button>

            {menuOpen && otherPlaylists.length > 0 && (
              <div className="absolute right-0 top-full mt-1 w-48 py-1 rounded-md bg-[#282828] border border-white/10 shadow-2xl z-30">
                <div className="px-3 py-1.5 text-[11px] font-bold text-[#B3B3B3] border-b border-white/10">
                  Move to playlist
                </div>
                <div className="max-h-48 overflow-y-auto py-1">
                  {otherPlaylists.map((pl) => (
                    <button
                      key={pl.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpen(false);
                        onMoveTrack(track.id, pl.id);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs text-white hover:bg-white/10 truncate cursor-pointer"
                    >
                      {pl.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemoveTrack(track.id);
            }}
            title="Remove from this playlist"
            aria-label="Remove from playlist"
            className="p-1 text-[#B3B3B3] hover:text-red-400 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>

        <span className="text-xs text-[#B3B3B3] tabular-nums w-10 text-right shrink-0">
          {track.duration > 0 ? formatTime(track.duration) : '--:--'}
        </span>
      </div>
    </div>
  );
}
