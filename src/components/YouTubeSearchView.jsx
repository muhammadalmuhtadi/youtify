import React from 'react';
import {
  Check,
  Disc3,
  Loader2,
  Music,
  Play,
  Plus,
} from 'lucide-react';

const SEARCH_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'music', label: 'Songs' },
  { id: 'podcast', label: 'Podcasts & Shows' },
];

const BROWSE_CATEGORIES = [
  { title: 'City Pop & Diskoria', color: '#DC148C' },
  { title: '90s Emo & Rock', color: '#1E3264' },
  { title: 'Lofi Beats', color: '#006450' },
  { title: 'Indonesian Pop', color: '#8400E7' },
  { title: 'Podcasts & Tech', color: '#E8115B' },
];

export default function YouTubeSearchView({
  query,
  filter,
  results,
  isSearching,
  error,
  selectedPlaylist,
  playlistTracks,
  currentTrack,
  addingVideoId,
  onSearch,
  onChangeFilter,
  onAddTrack,
  onPlayTrack,
}) {
  const topResult = results[0] || null;
  const topSongs = results.slice(0, 4);
  const moreResults = results.slice(4);

  return (
    <div className="flex-1 min-w-0 h-full bg-[#121212] rounded-lg overflow-y-auto px-5 sm:px-7 py-5 space-y-6">
      {/* Filter Pills */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2" role="group" aria-label="Search filter">
          {SEARCH_FILTERS.map((f) => {
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => onChangeFilter(f.id)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors cursor-pointer ${
                  active
                    ? 'bg-white text-black'
                    : 'bg-[#232323] text-white hover:bg-[#2A2A2A]'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        <div className="text-xs text-[#B3B3B3]">
          Click a song to play • Click <span className="text-white font-semibold">+</span> to choose a playlist
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="px-4 py-2.5 rounded-lg bg-red-500/15 border border-red-500/30 text-xs text-red-200"
        >
          {error}
        </div>
      )}

      {/* Main Content */}
      {isSearching ? (
        <div className="py-20 flex flex-col items-center justify-center gap-3 text-sm text-[#B3B3B3]">
          <Loader2 className="w-7 h-7 animate-spin text-[#1ED760]" aria-hidden="true" />
          <span>Searching YouTube catalog...</span>
        </div>
      ) : results.length === 0 ? (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-bold text-white">
              {query ? `No results found for "${query}"` : 'Browse all'}
            </h2>
            <p className="text-xs text-[#B3B3B3] mt-1">
              Type any song, artist, or podcast in the search bar above for 1-click ad-free playback.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {BROWSE_CATEGORIES.map((cat) => (
              <button
                key={cat.title}
                type="button"
                onClick={() => onSearch(cat.title, filter)}
                style={{ backgroundColor: cat.color }}
                className="relative h-28 rounded-lg p-4 text-left overflow-hidden hover:scale-[1.02] transition-transform cursor-pointer"
              >
                <span className="text-base font-extrabold text-white leading-tight block pr-4">
                  {cat.title}
                </span>
                <Disc3
                  className="w-12 h-12 text-white/25 absolute -bottom-2 -right-2 rotate-12"
                  aria-hidden="true"
                />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-8 pb-6">
          {/* Spotify "Top result" + "Songs" Split Grid */}
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-6">
            {topResult && (
              <section aria-label="Top result" className="space-y-3">
                <h2 className="text-lg font-bold text-white">Top result</h2>
                <div
                  onClick={() => onPlayTrack(topResult)}
                  className="group relative p-5 rounded-lg bg-[#181818] hover:bg-[#282828] transition-colors cursor-pointer space-y-4"
                >
                  {topResult.thumbnail_url ? (
                    <img
                      src={topResult.thumbnail_url}
                      alt=""
                      className="w-24 h-24 rounded-md object-cover shadow-lg bg-black"
                    />
                  ) : (
                    <div className="w-24 h-24 rounded-md bg-[#242424] flex items-center justify-center text-[#B3B3B3]">
                      <Music className="w-8 h-8" aria-hidden="true" />
                    </div>
                  )}

                  <div>
                    <div className="text-2xl font-extrabold text-white line-clamp-2 leading-tight">
                      {topResult.title}
                    </div>
                    <div className="text-xs text-[#B3B3B3] mt-1.5">
                      Song • <span className="text-white font-medium">{topResult.artist}</span>
                      {topResult.duration_text ? ` • ${topResult.duration_text}` : ''}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPlayTrack(topResult);
                    }}
                    aria-label={`Play ${topResult.title}`}
                    className="absolute right-5 bottom-5 w-12 h-12 rounded-full bg-[#1ED760] hover:bg-[#3BE477] hover:scale-105 text-black flex items-center justify-center shadow-xl opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all cursor-pointer"
                  >
                    <Play className="w-5 h-5 fill-current ml-0.5" aria-hidden="true" />
                  </button>
                </div>
              </section>
            )}

            {/* Songs List */}
            <section aria-label="Songs" className="space-y-3">
              <h2 className="text-lg font-bold text-white">Songs</h2>
              <div className="space-y-1">
                {topSongs.map((item) => {
                  const existing = playlistTracks.find(
                    (t) => t.youtube_id === item.youtube_id || t.url === item.url
                  );
                  const isBusy = addingVideoId === item.youtube_id;
                  const isNowPlaying = currentTrack?.youtube_id === item.youtube_id;

                  return (
                    <div
                      key={item.youtube_id}
                      onClick={() => onPlayTrack(item)}
                      className="group flex items-center gap-3 px-2.5 py-2 rounded-md hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      <div className="relative w-10 h-10 rounded overflow-hidden bg-[#242424] shrink-0">
                        {item.thumbnail_url ? (
                          <img
                            src={item.thumbnail_url}
                            alt=""
                            loading="lazy"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[#B3B3B3]">
                            <Music className="w-4 h-4" aria-hidden="true" />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                          {isBusy ? (
                            <Loader2 className="w-4 h-4 animate-spin text-white" aria-hidden="true" />
                          ) : (
                            <Play className="w-4 h-4 text-white fill-current" aria-hidden="true" />
                          )}
                        </div>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div
                          className={`text-sm font-medium truncate ${
                            isNowPlaying ? 'text-[#1ED760]' : 'text-white'
                          }`}
                        >
                          {item.title}
                        </div>
                        <div className="text-xs text-[#B3B3B3] truncate">{item.artist}</div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddTrack(item);
                          }}
                          title={
                            existing
                              ? `Also in ${selectedPlaylist?.name || 'playlist'} — click to add to another playlist`
                              : 'Choose playlist to add song'
                          }
                          aria-label={`Add ${item.title} to playlist`}
                          className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                            existing
                              ? 'text-[#1ED760] border border-[#1ED760]/40 hover:border-[#1ED760]'
                              : 'text-[#B3B3B3] hover:text-white border border-white/20 hover:border-white'
                          }`}
                        >
                          {existing ? (
                            <Check className="w-4 h-4" aria-hidden="true" />
                          ) : (
                            <Plus className="w-4 h-4" aria-hidden="true" />
                          )}
                        </button>

                        <span className="text-xs text-[#B3B3B3] tabular-nums w-10 text-right">
                          {item.duration_text || '--:--'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          {/* More Matching Tracks */}
          {moreResults.length > 0 && (
            <section aria-label="More results" className="space-y-3">
              <h2 className="text-lg font-bold text-white">More matches</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                {moreResults.map((item) => {
                  const existing = playlistTracks.find(
                    (t) => t.youtube_id === item.youtube_id || t.url === item.url
                  );
                  const isBusy = addingVideoId === item.youtube_id;
                  const isNowPlaying = currentTrack?.youtube_id === item.youtube_id;

                  return (
                    <div
                      key={item.youtube_id}
                      onClick={() => onPlayTrack(item)}
                      className="group flex items-center gap-3 px-2.5 py-2 rounded-md hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      <div className="relative w-10 h-10 rounded overflow-hidden bg-[#242424] shrink-0">
                        {item.thumbnail_url ? (
                          <img
                            src={item.thumbnail_url}
                            alt=""
                            loading="lazy"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[#B3B3B3]">
                            <Music className="w-4 h-4" aria-hidden="true" />
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div
                          className={`text-sm font-medium truncate ${
                            isNowPlaying ? 'text-[#1ED760]' : 'text-white'
                          }`}
                        >
                          {item.title}
                        </div>
                        <div className="text-xs text-[#B3B3B3] truncate">
                          {item.artist}
                          {item.views ? ` • ${item.views}` : ''}
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5 shrink-0">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddTrack(item);
                          }}
                          aria-label={`Add ${item.title} to playlist`}
                          className={`px-3 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1 cursor-pointer ${
                            existing
                              ? 'bg-[#1ED760]/15 text-[#1ED760]'
                              : 'bg-[#242424] hover:bg-white hover:text-black text-white'
                          }`}
                        >
                          {existing ? (
                            <>
                              <Check className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Added</span>
                            </>
                          ) : (
                            <>
                              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Add</span>
                            </>
                          )}
                        </button>
                        <span className="text-xs text-[#B3B3B3] tabular-nums w-10 text-right">
                          {item.duration_text || '--:--'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
