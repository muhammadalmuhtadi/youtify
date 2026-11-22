import React from 'react';
import {
  CheckCircle2,
  ListMusic,
  Music,
  PanelRight,
  Trash2,
  X,
} from 'lucide-react';
import { formatTime } from '../utils/format';
import YoutifyLogo from './YoutifyLogo';

export default function SpotifyRightPanel({
  mode, // 'now_playing' | 'queue' | 'closed'
  onChangeMode,
  onClose,
  currentTrack,
  playbackPlaylistName,
  selectedPlaylistName,
  manualQueue,
  upNextTracks,
  engineType,
  onPlayTrack,
  onPlayTrackFromQueue,
  onRemoveFromManualQueue,
  onClearManualQueue,
}) {
  if (mode === 'closed') return null;

  const headerTitle =
    mode === 'queue'
      ? 'Queue'
      : playbackPlaylistName || selectedPlaylistName || 'Now Playing';

  const nextUpcomingTrack = manualQueue[0]?.track || upNextTracks[0] || null;
  const nextUpcomingIsManual = manualQueue.length > 0;

  return (
    <aside
      aria-label={headerTitle}
      className="hidden lg:flex w-[300px] xl:w-[356px] shrink-0 h-full bg-[#121212] rounded-lg flex-col overflow-hidden"
    >
      {/* Header Bar */}
      <div className="px-4 py-3 flex items-center justify-between gap-2 shrink-0">
        <span className="text-sm font-bold text-white truncate">{headerTitle}</span>

        <div className="flex items-center gap-1 shrink-0">
          {[
            { id: 'now_playing', label: 'Now Playing', icon: PanelRight },
            { id: 'queue', label: 'Queue', icon: ListMusic },
          ].map((item) => {
            const Icon = item.icon;
            const active = mode === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onChangeMode(item.id)}
                title={item.label}
                aria-label={item.label}
                aria-pressed={active}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#242424] text-[#1ED760]'
                    : 'text-[#B3B3B3] hover:text-white hover:bg-[#1F1F1F]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            );
          })}

          <button
            type="button"
            onClick={onClose}
            aria-label="Close right panel"
            className="w-7 h-7 rounded-full flex items-center justify-center text-[#B3B3B3] hover:text-white hover:bg-[#1F1F1F] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 space-y-4">
        {mode === 'now_playing' && (
          <>
            {/* Square Cover Art */}
            <div className="aspect-square w-full rounded-lg overflow-hidden bg-[#242424] shadow-xl">
              {currentTrack?.thumbnail_url ? (
                <img
                  src={currentTrack.thumbnail_url}
                  alt={currentTrack.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-[#B3B3B3] gap-3">
                  <YoutifyLogo className="w-16 h-16" variant="green" title="" />
                  <span className="text-xs">Select a track to play</span>
                </div>
              )}
            </div>

            {/* Track Title + Green Verified Check */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-xl font-extrabold text-white truncate">
                  {currentTrack?.title || 'Nothing Playing'}
                </div>
                <div className="text-sm text-[#B3B3B3] truncate mt-0.5">
                  {currentTrack?.artist || 'Select any song from your playlists'}
                </div>
              </div>
              {currentTrack && (
                <CheckCircle2
                  className="w-5 h-5 text-[#1ED760] shrink-0 mt-1"
                  aria-label="Saved in library"
                />
              )}
            </div>

            {/* Next in Queue Card (exact Spotify Right Sidebar pattern) */}
            <div className="p-4 rounded-lg bg-[#1F1F1F] space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-white">Next in queue</span>
                <button
                  type="button"
                  onClick={() => onChangeMode('queue')}
                  className="text-xs font-bold text-[#B3B3B3] hover:text-white hover:underline cursor-pointer"
                >
                  Open queue
                </button>
              </div>

              {nextUpcomingTrack ? (
                <button
                  type="button"
                  onClick={() =>
                    nextUpcomingIsManual
                      ? onPlayTrackFromQueue(manualQueue[0], 0)
                      : onPlayTrack(nextUpcomingTrack)
                  }
                  className="w-full flex items-center gap-3 text-left p-1.5 -mx-1.5 rounded-md hover:bg-white/10 transition-colors cursor-pointer"
                >
                  {nextUpcomingTrack.thumbnail_url ? (
                    <img
                      src={nextUpcomingTrack.thumbnail_url}
                      alt=""
                      className="w-10 h-10 rounded object-cover shrink-0 bg-black"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded bg-[#2A2A2A] flex items-center justify-center text-[#B3B3B3] shrink-0">
                      <Music className="w-4 h-4" aria-hidden="true" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-white truncate">
                      {nextUpcomingTrack.title}
                    </div>
                    <div className="text-xs text-[#B3B3B3] truncate">
                      {nextUpcomingTrack.artist || 'Unknown'}
                    </div>
                  </div>
                </button>
              ) : (
                <p className="text-xs text-[#B3B3B3]">Queue is empty</p>
              )}
            </div>
          </>
        )}

        {mode === 'queue' && (
          <div className="space-y-5">
            {/* Now Playing */}
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-[#B3B3B3] mb-2">
                Now playing
              </div>
              {currentTrack ? (
                <div className="flex items-center gap-3 p-2 rounded-md bg-white/5">
                  {currentTrack.thumbnail_url ? (
                    <img
                      src={currentTrack.thumbnail_url}
                      alt=""
                      className="w-10 h-10 rounded object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded bg-[#242424] flex items-center justify-center shrink-0">
                      <Music className="w-4 h-4 text-[#B3B3B3]" aria-hidden="true" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-[#1ED760] truncate">
                      {currentTrack.title}
                    </div>
                    <div className="text-xs text-[#B3B3B3] truncate">
                      {currentTrack.artist || 'Unknown'}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-[#B3B3B3]">No active track</p>
              )}
            </div>

            {/* Next in Queue (Manual) */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[#B3B3B3]">
                  Next in queue ({manualQueue.length})
                </span>
                {manualQueue.length > 0 && (
                  <button
                    type="button"
                    onClick={onClearManualQueue}
                    className="text-xs font-semibold text-[#B3B3B3] hover:text-white cursor-pointer"
                  >
                    Clear queue
                  </button>
                )}
              </div>

              {manualQueue.length === 0 ? (
                <p className="text-xs text-[#B3B3B3]">
                  Add songs to your queue from the track menu.
                </p>
              ) : (
                <div className="space-y-1">
                  {manualQueue.map((item, idx) => (
                    <div
                      key={item.queueId}
                      className="group flex items-center gap-2.5 p-1.5 rounded-md hover:bg-white/10"
                    >
                      <button
                        type="button"
                        onClick={() => onPlayTrackFromQueue(item, idx)}
                        className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
                      >
                        <img
                          src={item.track.thumbnail_url || ''}
                          alt=""
                          className="w-9 h-9 rounded object-cover bg-[#242424] shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium text-white truncate">
                            {item.track.title}
                          </div>
                          <div className="text-[11px] text-[#B3B3B3] truncate">
                            {item.track.artist || 'Unknown'}
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveFromManualQueue(item.queueId)}
                        aria-label={`Remove ${item.track.title} from queue`}
                        className="opacity-0 group-hover:opacity-100 text-[#B3B3B3] hover:text-white p-1 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Next Up From Playlist */}
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-[#B3B3B3] mb-2 truncate">
                Next from: {playbackPlaylistName || selectedPlaylistName || 'Playlist'}
              </div>
              {upNextTracks.length === 0 ? (
                <p className="text-xs text-[#B3B3B3]">End of playlist</p>
              ) : (
                <div className="space-y-1">
                  {upNextTracks.map((track) => (
                    <button
                      key={track.id}
                      type="button"
                      onClick={() => onPlayTrack(track)}
                      className="w-full flex items-center gap-2.5 p-1.5 rounded-md hover:bg-white/10 text-left cursor-pointer"
                    >
                      <img
                        src={track.thumbnail_url || ''}
                        alt=""
                        className="w-9 h-9 rounded object-cover bg-[#242424] shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-white truncate">
                          {track.title}
                        </div>
                        <div className="text-[11px] text-[#B3B3B3] truncate">
                          {track.artist || 'Unknown'}
                        </div>
                      </div>
                      <span className="text-[11px] text-[#B3B3B3] tabular-nums shrink-0">
                        {track.duration > 0 ? formatTime(track.duration) : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
