import React, { useEffect, useState } from 'react';
import { Music, Upload, X } from 'lucide-react';

const COVER_PRESETS = [
  {
    label: 'Youtify Emerald',
    url: `data:image/svg+xml;utf8,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#1ED760"/><stop offset="100%" stop-color="#0B2E1A"/></linearGradient></defs><rect width="200" height="200" fill="url(#g)"/><path d="M72 52 C72 46 78 42 84 46 L152 88 C157 91 157 99 152 102 L84 144 C78 148 72 144 72 138 Z" fill="#FFFFFF"/><path d="M86 73 L103 96 L120 73 M103 96 L103 121" fill="none" stroke="#14532D" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    )}`,
  },
  {
    label: 'Crimson Play',
    url: `data:image/svg+xml;utf8,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#B91C1C"/><stop offset="100%" stop-color="#121212"/></linearGradient></defs><rect width="200" height="200" fill="url(#g)"/><path d="M72 52 C72 46 78 42 84 46 L152 88 C157 91 157 99 152 102 L84 144 C78 148 72 144 72 138 Z" fill="#FFFFFF"/><path d="M86 73 L103 96 L120 73 M103 96 L103 121" fill="none" stroke="#991B1B" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    )}`,
  },
  {
    label: 'Violet Haze',
    url: `data:image/svg+xml;utf8,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0"><stop offset="0%" stop-color="#4C1D95"/><stop offset="100%" stop-color="#121212"/></linearGradient></defs><rect width="200" height="200" fill="url(#g)"/><path d="M72 52 C72 46 78 42 84 46 L152 88 C157 91 157 99 152 102 L84 144 C78 148 72 144 72 138 Z" fill="#FFFFFF"/><path d="M86 73 L103 96 L120 73 M103 96 L103 121" fill="none" stroke="#4C1D95" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    )}`,
  },
  {
    label: 'Midnight Blue',
    url: `data:image/svg+xml;utf8,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="#1E3A8A"/><path d="M72 52 C72 46 78 42 84 46 L152 88 C157 91 157 99 152 102 L84 144 C78 148 72 144 72 138 Z" fill="#1ED760"/><path d="M86 73 L103 96 L120 73 M103 96 L103 121" fill="none" stroke="#1E3A8A" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    )}`,
  },
];

function resizeImageFileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image file.'));
      img.onload = () => {
        const maxSize = 360;
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function PlaylistModal({ isOpen, mode, initialPlaylist, onClose, onSave }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [coverImage, setCoverImage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    if (mode === 'edit' && initialPlaylist) {
      setName(initialPlaylist.name || '');
      setDescription(initialPlaylist.description || '');
      setCoverImage(initialPlaylist.cover_image || '');
    } else {
      setName('');
      setDescription('');
      setCoverImage('');
    }
    setError('');
  }, [isOpen, mode, initialPlaylist]);

  if (!isOpen) return null;

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImageFileToDataUrl(file);
      setCoverImage(dataUrl);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Playlist name is required.');
      return;
    }
    setIsSaving(true);
    setError('');
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        cover_image: coverImage.trim(),
      });
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to save playlist.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'edit' ? 'Edit details' : 'Create playlist'}
        className="w-full max-w-lg bg-[#282828] text-white rounded-xl border border-white/10 shadow-2xl overflow-hidden"
      >
        <div className="px-6 py-4 flex items-center justify-between border-b border-white/10">
          <h2 className="text-lg font-bold tracking-tight text-white">
            {mode === 'edit' ? 'Edit details' : 'Create playlist'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="w-8 h-8 rounded-full flex items-center justify-center text-[#B3B3B3] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Square Cover Art Preview */}
            <div className="w-32 h-32 rounded-md overflow-hidden bg-[#181818] border border-white/10 shrink-0 flex items-center justify-center shadow-lg">
              {coverImage ? (
                <img
                  src={coverImage}
                  alt="Playlist cover preview"
                  className="w-full h-full object-cover"
                />
              ) : (
                <Music className="w-10 h-10 text-[#B3B3B3]" aria-hidden="true" />
              )}
            </div>

            <div className="flex-1 space-y-3 min-w-0">
              <div>
                <label
                  htmlFor="playlist-name-input"
                  className="block text-xs font-bold text-[#B3B3B3] mb-1"
                >
                  Name
                </label>
                <input
                  id="playlist-name-input"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Playlist #1"
                  autoFocus
                  className="w-full h-10 px-3 rounded-md bg-[#3E3E3E] text-sm text-white placeholder-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-white"
                />
              </div>

              <div>
                <label
                  htmlFor="playlist-desc-input"
                  className="block text-xs font-bold text-[#B3B3B3] mb-1"
                >
                  Description
                </label>
                <textarea
                  id="playlist-desc-input"
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Add an optional description"
                  className="w-full p-2.5 rounded-md bg-[#3E3E3E] text-xs text-white placeholder-[#94A3B3] focus:outline-none focus:ring-2 focus:ring-white resize-none"
                />
              </div>
            </div>
          </div>

          {/* Cover URL + Upload + Swatches */}
          <div className="space-y-2 pt-1">
            <label className="block text-xs font-bold text-[#B3B3B3]">
              Cover Image URL or Upload
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={coverImage.startsWith('data:') ? '' : coverImage}
                onChange={(e) => setCoverImage(e.target.value)}
                placeholder="https://... (optional)"
                className="flex-1 h-9 px-3 rounded-md bg-[#3E3E3E] text-xs text-white placeholder-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-white"
              />
              <label className="bg-[#333333] hover:bg-[#444444] text-white h-9 px-3.5 rounded-full text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shrink-0">
                <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Choose photo</span>
                <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
              </label>
            </div>
            <div className="flex items-center gap-2 pt-0.5">
              {COVER_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setCoverImage(preset.url)}
                  title={preset.label}
                  className={`w-7 h-7 rounded overflow-hidden border cursor-pointer transition-transform hover:scale-105 ${
                    coverImage === preset.url
                      ? 'border-[#1ED760] ring-2 ring-[#1ED760]'
                      : 'border-white/20'
                  }`}
                >
                  <img src={preset.url} alt={preset.label} className="w-full h-full object-cover" />
                </button>
              ))}
              {coverImage && (
                <button
                  type="button"
                  onClick={() => setCoverImage('')}
                  className="text-xs text-[#B3B3B3] hover:text-white ml-1 cursor-pointer"
                >
                  Remove
                </button>
              )}
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="px-3 py-2 rounded-lg bg-red-500/15 border border-red-500/30 text-xs text-red-200"
            >
              {error}
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="text-xs font-bold text-[#B3B3B3] hover:text-white px-4 py-2 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="bg-white text-black hover:bg-[#F0F0F0] hover:scale-[1.02] disabled:opacity-50 px-6 py-2.5 rounded-full font-bold text-xs transition-transform cursor-pointer"
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
