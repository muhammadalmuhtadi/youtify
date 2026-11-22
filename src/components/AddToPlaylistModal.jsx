import React, { useEffect, useState } from 'react';
import { FolderPlus, Loader2, Plus, Search, X } from 'lucide-react';
import YoutifyLogo from './YoutifyLogo';

export default function AddToPlaylistModal({
  isOpen,
  track,
  playlists = [],
  onClose,
  onConfirmAdd,
  onCreatePlaylistAndAdd,
}) {
  const [filterText, setFilterText] = useState('');
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [busyPlaylistId, setBusyPlaylistId] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setFilterText('');
    setNewPlaylistName('');
    setBusyPlaylistId('');
    setErrorMsg('');
  }, [isOpen, track?.youtube_id]);

  if (!isOpen || !track) return null;

  const filtered = playlists.filter((pl) =>
    (pl.name || '').toLowerCase().includes(filterText.trim().toLowerCase())
  );

  const handleSelectPlaylist = async (playlistId) => {
    if (busyPlaylistId) return;
    setBusyPlaylistId(playlistId);
    setErrorMsg('');
    try {
      await onConfirmAdd(playlistId, track);
      onClose();
    } catch (err) {
      setErrorMsg(err.message || 'Gagal menambahkan lagu ke playlist.');
    } finally {
      setBusyPlaylistId('');
    }
  };

  const handleCreateAndAdd = async (e) => {
    e.preventDefault();
    const clean = newPlaylistName.trim();
    if (!clean || busyPlaylistId) return;
    setBusyPlaylistId('__create__');
    setErrorMsg('');
    try {
      await onCreatePlaylistAndAdd(clean, track);
      onClose();
    } catch (err) {
      setErrorMsg(err.message || 'Gagal membuat playlist baru.');
    } finally {
      setBusyPlaylistId('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add to Playlist"
        className="w-full max-w-md bg-[#282828] text-white rounded-xl border border-white/10 shadow-2xl flex flex-col max-h-[84vh] overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3 shrink-0">
          <h2 className="text-base font-bold text-white">Add to Playlist</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Add to Playlist popup"
            className="w-8 h-8 rounded-full flex items-center justify-center text-[#B3B3B3] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Selected Track Preview */}
        <div className="px-5 py-3 bg-[#181818] border-b border-white/10 flex items-center gap-3 shrink-0">
          {track.thumbnail_url ? (
            <img
              src={track.thumbnail_url}
              alt=""
              className="w-11 h-11 rounded object-cover shrink-0 bg-black"
            />
          ) : (
            <div className="w-11 h-11 rounded bg-[#242424] flex items-center justify-center shrink-0">
              <YoutifyLogo className="w-6 h-6" variant="green" title="" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-white truncate">{track.title}</div>
            <div className="text-xs text-[#B3B3B3] truncate">{track.artist || 'YouTube'}</div>
          </div>
        </div>

        {/* Body */}
        <div className="p-4 overflow-y-auto flex-1 space-y-3">
          {errorMsg && (
            <div
              role="alert"
              className="px-3.5 py-2 rounded-lg bg-red-500/15 border border-red-500/30 text-xs text-red-200"
            >
              {errorMsg}
            </div>
          )}

          {/* Filter Playlists */}
          <div className="relative">
            <Search
              className="w-4 h-4 text-[#B3B3B3] absolute left-3 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Find a playlist"
              className="w-full h-9 pl-9 pr-3 rounded-md bg-[#121212] text-xs text-white placeholder-[#B3B3B3] border border-white/10 focus:outline-none focus:ring-1 focus:ring-white"
            />
          </div>

          {/* Create New Playlist Quick Row */}
          <form onSubmit={handleCreateAndAdd} className="flex items-center gap-2">
            <input
              type="text"
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              placeholder="New playlist name..."
              className="flex-1 min-w-0 h-9 px-3 rounded-md bg-[#121212] text-xs text-white placeholder-[#B3B3B3] border border-white/10 focus:outline-none focus:ring-1 focus:ring-[#1ED760]"
            />
            <button
              type="submit"
              disabled={!newPlaylistName.trim() || Boolean(busyPlaylistId)}
              className="h-9 px-3.5 rounded-full bg-[#1ED760] hover:bg-[#3BE477] disabled:opacity-45 text-black text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              {busyPlaylistId === '__create__' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <FolderPlus className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>Create &amp; Add</span>
            </button>
          </form>

          {/* Playlist Choices */}
          <div className="space-y-1 pt-1">
            {filtered.length === 0 ? (
              <div className="py-6 text-center text-xs text-[#B3B3B3]">
                No matching playlists. Create one above!
              </div>
            ) : (
              filtered.map((pl) => {
                const isThisBusy = busyPlaylistId === pl.id;
                return (
                  <button
                    key={pl.id}
                    type="button"
                    disabled={Boolean(busyPlaylistId)}
                    onClick={() => handleSelectPlaylist(pl.id)}
                    className="w-full p-2 rounded-lg flex items-center justify-between gap-3 bg-[#181818] hover:bg-[#333333] disabled:opacity-60 transition-colors text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {pl.cover_image ? (
                        <img
                          src={pl.cover_image}
                          alt=""
                          className="w-10 h-10 rounded object-cover shrink-0 bg-[#242424]"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded bg-[#242424] flex items-center justify-center shrink-0">
                          <YoutifyLogo className="w-6 h-6" variant="green" title="" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-white truncate">{pl.name}</div>
                        <div className="text-[11px] text-[#B3B3B3]">
                          {pl.track_count || 0} songs
                        </div>
                      </div>
                    </div>

                    <span className="w-8 h-8 rounded-full bg-[#242424] flex items-center justify-center text-white shrink-0">
                      {isThisBusy ? (
                        <Loader2 className="w-4 h-4 animate-spin text-[#1ED760]" aria-hidden="true" />
                      ) : (
                        <Plus className="w-4 h-4" aria-hidden="true" />
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
