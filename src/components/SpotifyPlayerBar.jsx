import React from 'react';
import {
  CheckCircle2,
  ListMusic,
  Loader2,
  Music,
  PanelRight,
  Pause,
  Play,
  Repeat,
  Repeat1,
  RotateCcw,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { formatTime } from '../utils/format';
import YoutifyLogo from './YoutifyLogo';

export default function SpotifyPlayerBar({
  currentTrack,
  isPlaying,
  isLoadingAudio,
  audioError,
  currentTime,
  duration,
  volume,
  isMuted,
  isShuffle,
  repeatMode,
  rightPanelMode,
  onTogglePlay,
  onPrev,
  onNext,
  onSeek,
  onChangeVolume,
  onToggleMute,
  onToggleShuffle,
  onCycleRepeat,
  onRetryAudio,
  onToggleRightPanel,
}) {
  const safeDuration = duration > 0 ? duration : 0;
  const clampedTime = safeDuration > 0 ? Math.min(currentTime, safeDuration) : 0;
  const seekPercent = safeDuration > 0 ? (clampedTime / safeDuration) * 100 : 0;
  const volPercent = isMuted ? 0 : Math.round(volume * 100);

  return (
    <footer
      aria-label="Playback Controls"
      className="h-[82px] bg-black px-3 sm:px-4 flex items-center justify-between gap-3 sm:gap-4 shrink-0 border-t border-white/5 select-none"
    >
      {/* Left: Now Playing Track Info */}
      <div className="w-[38%] sm:w-[30%] min-w-0 flex items-center gap-3">
        {currentTrack ? (
          <>
            <div className="w-14 h-14 rounded-md overflow-hidden bg-[#242424] shrink-0 shadow">
              {currentTrack.thumbnail_url ? (
                <img
                  src={currentTrack.thumbnail_url}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[#B3B3B3]">
                  <Music className="w-5 h-5" aria-hidden="true" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-white truncate">
                {currentTrack.title}
              </div>
              <div className="text-xs text-[#B3B3B3] truncate">
                {currentTrack.artist || 'YouTube Audio'}
              </div>
              {audioError && (
                <button
                  type="button"
                  onClick={onRetryAudio}
                  className="mt-0.5 max-w-full inline-flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">{audioError} • Retry</span>
                </button>
              )}
            </div>
            <CheckCircle2
              className="hidden sm:block w-4 h-4 text-[#1ED760] shrink-0"
              aria-hidden="true"
            />
          </>
        ) : (
          <div className="flex items-center gap-3 text-[#B3B3B3] min-w-0">
            <div className="w-12 h-12 rounded-md bg-[#181818] flex items-center justify-center shrink-0">
              <YoutifyLogo className="w-7 h-7" variant="green" title="" />
            </div>
            <div className="min-w-0 hidden sm:block">
              <div className="text-xs font-medium text-white truncate">No track selected</div>
              <div className="text-[11px] text-[#B3B3B3] truncate">
                Choose a song to start playing
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Center: Transport & Seek Bar */}
      <div className="flex-1 max-w-[600px] flex flex-col items-center gap-1.5 min-w-0">
        <div className="flex items-center gap-3 sm:gap-5">
          <button
            type="button"
            onClick={onToggleShuffle}
            aria-label="Toggle shuffle"
            aria-pressed={isShuffle}
            className={`relative p-1 transition-colors cursor-pointer ${
              isShuffle ? 'text-[#1ED760]' : 'text-[#B3B3B3] hover:text-white'
            }`}
          >
            <Shuffle className="w-4 h-4" aria-hidden="true" />
            {isShuffle && (
              <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#1ED760]" />
            )}
          </button>

          <button
            type="button"
            disabled={!currentTrack}
            onClick={onPrev}
            aria-label="Previous track"
            className="p-1 text-[#B3B3B3] hover:text-white disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            <SkipBack className="w-4 h-4 fill-current" aria-hidden="true" />
          </button>

          <button
            type="button"
            disabled={!currentTrack}
            onClick={onTogglePlay}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="w-8 h-8 rounded-full bg-white hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100 text-black flex items-center justify-center transition-transform cursor-pointer disabled:cursor-not-allowed"
          >
            {isLoadingAudio ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : isPlaying ? (
              <Pause className="w-4 h-4 fill-current" aria-hidden="true" />
            ) : (
              <Play className="w-4 h-4 fill-current ml-0.5" aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            disabled={!currentTrack}
            onClick={onNext}
            aria-label="Next track"
            className="p-1 text-[#B3B3B3] hover:text-white disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            <SkipForward className="w-4 h-4 fill-current" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onCycleRepeat}
            aria-label={`Repeat mode: ${repeatMode}`}
            aria-pressed={repeatMode !== 'off'}
            className={`relative p-1 transition-colors cursor-pointer ${
              repeatMode !== 'off' ? 'text-[#1ED760]' : 'text-[#B3B3B3] hover:text-white'
            }`}
          >
            {repeatMode === 'track' ? (
              <Repeat1 className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Repeat className="w-4 h-4" aria-hidden="true" />
            )}
            {repeatMode !== 'off' && (
              <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#1ED760]" />
            )}
          </button>
        </div>

        {/* Seek Bar */}
        <div className="w-full flex items-center gap-2 group">
          <span className="text-[11px] text-[#B3B3B3] tabular-nums w-9 text-right shrink-0">
            {formatTime(clampedTime)}
          </span>
          <input
            type="range"
            min={0}
            max={safeDuration || 100}
            step={0.5}
            disabled={!currentTrack || safeDuration === 0}
            value={clampedTime}
            onChange={(e) => onSeek(Number(e.target.value))}
            aria-label="Seek track position"
            style={{ '--range-progress': `${seekPercent}%` }}
            className="spotify-slider flex-1 min-w-0"
          />
          <span className="text-[11px] text-[#B3B3B3] tabular-nums w-9 shrink-0">
            {safeDuration > 0 ? formatTime(safeDuration) : '0:00'}
          </span>
        </div>
      </div>

      {/* Right: Panel Toggles & Volume */}
      <div className="w-[28%] sm:w-[30%] hidden sm:flex items-center justify-end gap-2.5">
        <button
          type="button"
          onClick={() => onToggleRightPanel('now_playing')}
          title="Now playing view"
          aria-label="Now playing view"
          aria-pressed={rightPanelMode === 'now_playing'}
          className={`hidden lg:flex relative p-1.5 transition-colors cursor-pointer ${
            rightPanelMode === 'now_playing'
              ? 'text-[#1ED760]'
              : 'text-[#B3B3B3] hover:text-white'
          }`}
        >
          <PanelRight className="w-4 h-4" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => onToggleRightPanel('queue')}
          title="Queue"
          aria-label="Queue"
          aria-pressed={rightPanelMode === 'queue'}
          className={`hidden lg:flex relative p-1.5 transition-colors cursor-pointer ${
            rightPanelMode === 'queue'
              ? 'text-[#1ED760]'
              : 'text-[#B3B3B3] hover:text-white'
          }`}
        >
          <ListMusic className="w-4 h-4" aria-hidden="true" />
        </button>

        <div className="flex items-center gap-2 group w-28 sm:w-32">
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
            className="text-[#B3B3B3] hover:text-white p-1 transition-colors cursor-pointer shrink-0"
          >
            {isMuted || volume === 0 ? (
              <VolumeX className="w-4 h-4" aria-hidden="true" />
            ) : volume < 0.5 ? (
              <Volume1 className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Volume2 className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={isMuted ? 0 : volume}
            onChange={(e) => onChangeVolume(Number(e.target.value))}
            aria-label="Volume"
            style={{ '--range-progress': `${volPercent}%` }}
            className="spotify-slider flex-1 min-w-0"
          />
        </div>
      </div>
    </footer>
  );
}
