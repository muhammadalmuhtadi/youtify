import React, { useMemo } from 'react';
import { FolderPlus, Play, RefreshCw } from 'lucide-react';
import YoutifyLogo from './YoutifyLogo';

function getGreeting() {
  const hr = new Date().getHours();
  if (hr < 12) return 'Good morning';
  if (hr < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function SpotifyHomeView({
  playlists,
  activeUser,
  isSyncingYt,
  onSelectAndPlayPlaylist,
  onSelectPlaylist,
  onOpenCreatePlaylist,
  onSyncYouTube,
}) {
  const greeting = useMemo(() => getGreeting(), []);
  const quickPicks = playlists.slice(0, 6);

  return (
    <div className="flex-1 min-w-0 h-full bg-[#121212] rounded-lg overflow-y-auto">
      <div
        className="px-5 sm:px-7 pt-6 pb-8 min-h-full space-y-8"
        style={{
          background: 'linear-gradient(180deg, #222222 0%, #121212 240px)',
        }}
      >
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              {greeting}
            </h1>
            {activeUser?.name && (
              <p className="text-xs text-[#B3B3B3] mt-0.5">
                Signed in as {activeUser.name}
                {activeUser.handle ? ` (${activeUser.handle})` : ''}
              </p>
            )}
          </div>

          <button
            type="button"
            disabled={isSyncingYt}
            onClick={onSyncYouTube}
            className="bg-white/10 hover:bg-white/20 text-white text-xs font-bold px-4 py-2 rounded-full inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isSyncingYt ? 'animate-spin text-[#1ED760]' : ''}`}
              aria-hidden="true"
            />
            <span>{isSyncingYt ? 'Syncing YouTube...' : 'Refresh Playlists'}</span>
          </button>
        </div>

        {/* Spotify 6-card Quick Picks Grid */}
        {quickPicks.length > 0 && (
          <section aria-label="Quick picks">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {quickPicks.map((pl) => (
                <div
                  key={pl.id}
                  onClick={() => onSelectPlaylist(pl.id)}
                  className="group h-16 bg-white/10 hover:bg-white/20 rounded-md overflow-hidden flex items-center justify-between pr-3 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1 h-full">
                    {pl.cover_image ? (
                      <img
                        src={pl.cover_image}
                        alt=""
                        className="w-16 h-16 object-cover shrink-0 bg-[#242424]"
                      />
                    ) : (
                      <div className="w-16 h-16 bg-gradient-to-br from-[#3A2E5F] to-[#1D1D26] flex items-center justify-center shrink-0">
                        <YoutifyLogo className="w-9 h-9" variant="green" title="" />
                      </div>
                    )}
                    <span className="text-sm font-bold text-white truncate pr-2">
                      {pl.name}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectAndPlayPlaylist(pl.id);
                    }}
                    aria-label={`Play ${pl.name}`}
                    className="w-10 h-10 rounded-full bg-[#1ED760] hover:bg-[#3BE477] hover:scale-105 text-black flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-all cursor-pointer shrink-0"
                  >
                    <Play className="w-4 h-4 fill-current ml-0.5" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Made For You / All Playlists Card Shelf */}
        <section aria-label="Your Playlists">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-white">Your Playlists</h2>
            <button
              type="button"
              onClick={onOpenCreatePlaylist}
              className="text-xs font-bold text-[#B3B3B3] hover:text-white inline-flex items-center gap-1 cursor-pointer"
            >
              <FolderPlus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>New Playlist</span>
            </button>
          </div>

          {playlists.length === 0 ? (
            <div className="p-8 rounded-lg bg-[#181818] text-center space-y-3">
              <p className="text-sm font-bold text-white">No playlists synced yet</p>
              <p className="text-xs text-[#B3B3B3]">
                Connect your YouTube account or create a custom playlist folder.
              </p>
              <button
                type="button"
                onClick={onOpenCreatePlaylist}
                className="bg-[#1ED760] hover:bg-[#3BE477] text-black font-bold text-xs px-5 py-2 rounded-full cursor-pointer"
              >
                Create Playlist
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {playlists.map((pl) => (
                <div
                  key={pl.id}
                  onClick={() => onSelectPlaylist(pl.id)}
                  className="group p-3.5 rounded-lg bg-[#181818] hover:bg-[#282828] transition-colors cursor-pointer flex flex-col"
                >
                  <div className="relative aspect-square w-full rounded-md overflow-hidden bg-[#242424] shadow-lg mb-3">
                    {pl.cover_image ? (
                      <img
                        src={pl.cover_image}
                        alt={pl.name}
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <YoutifyLogo className="w-14 h-14" variant="green" title="" />
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectAndPlayPlaylist(pl.id);
                      }}
                      aria-label={`Play ${pl.name}`}
                      className="absolute right-2.5 bottom-2.5 w-11 h-11 rounded-full bg-[#1ED760] hover:bg-[#3BE477] hover:scale-105 text-black flex items-center justify-center shadow-xl opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all cursor-pointer"
                    >
                      <Play className="w-5 h-5 fill-current ml-0.5" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="text-sm font-bold text-white truncate">{pl.name}</div>
                  <div className="text-xs text-[#B3B3B3] truncate mt-1">
                    {pl.youtube_playlist_id ? 'YouTube Playlist' : 'Playlist'} •{' '}
                    {pl.track_count || 0} songs
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
