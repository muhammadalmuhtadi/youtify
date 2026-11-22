import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, clearBrowserSessionId, setBrowserSessionId } from './utils/format';
import SpotifyTopBar from './components/SpotifyTopBar';
import SpotifyLibrarySidebar from './components/SpotifyLibrarySidebar';
import SpotifyPlaylistView from './components/SpotifyPlaylistView';
import SpotifyHomeView from './components/SpotifyHomeView';
import SpotifyRightPanel from './components/SpotifyRightPanel';
import SpotifyPlayerBar from './components/SpotifyPlayerBar';
import YouTubeSearchView from './components/YouTubeSearchView';
import SpotifyLoginView from './components/SpotifyLoginView';
import PlaylistModal from './components/PlaylistModal';
import AccountModal from './components/AccountModal';
import AddToPlaylistModal from './components/AddToPlaylistModal';

export default function App() {
  const [activeUser, setActiveUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [accountModalTab, setAccountModalTab] = useState('user');
  const [recommendations, setRecommendations] = useState([]);
  const [isLoadingRecommendations, setIsLoadingRecommendations] = useState(false);
  const [addModalTrack, setAddModalTrack] = useState(null);

  const [playlists, setPlaylists] = useState([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [isLoadingTracks, setIsLoadingTracks] = useState(false);
  const [draggingTrackId, setDraggingTrackId] = useState(null);

  const [isAddingUrl, setIsAddingUrl] = useState(false);
  const [isImportingYt, setIsImportingYt] = useState(false);
  const [isSyncingYt, setIsSyncingYt] = useState(false);
  const [ytSyncStatus, setYtSyncStatus] = useState('');
  const [ytSyncError, setYtSyncError] = useState('');
  const [urlError, setUrlError] = useState('');
  const [ytSearchQuery, setYtSearchQuery] = useState('');
  const [ytSearchFilter, setYtSearchFilter] = useState('all');
  const [ytSearchResults, setYtSearchResults] = useState([]);
  const [isSearchingYt, setIsSearchingYt] = useState(false);
  const [ytSearchError, setYtSearchError] = useState('');
  const [addingVideoId, setAddingVideoId] = useState('');

  const selectedPlaylistIdRef = useRef(null);
  selectedPlaylistIdRef.current = selectedPlaylistId;

  const [playlistModal, setPlaylistModal] = useState({
    isOpen: false,
    mode: 'create',
    playlist: null,
  });

  // Audio Playback Engine state ('html5' | 'yt_iframe')
  const audioRef = useRef(null);
  const ytPlayerRef = useRef(null);
  const ytReadyRef = useRef(false);
  const ytBlockedIdsRef = useRef(new Set());
  const pendingYtVideoIdRef = useRef(null);
  const syncedDurationIdsRef = useRef(new Set());
  const shouldBePlayingRef = useRef(false);
  const resumeTimeRef = useRef(0);
  const lastAutoResumeAtRef = useRef(0);
  const prewarmedTrackIdRef = useRef('');
  const lastLoadedSrcRef = useRef('');
  const audioRetryCountRef = useRef(0);
  const prevEngineRef = useRef('html5');
  const retryTimerRef = useRef(null);
  const streamNonceRef = useRef(0);
  const [engineType, setEngineType] = useState('html5');
  const [currentTrack, setCurrentTrack] = useState(null);
  const [playbackContextTracks, setPlaybackContextTracks] = useState([]);
  const [playbackPlaylistName, setPlaybackPlaylistName] = useState('');
  const [manualQueue, setManualQueue] = useState([]);
  const [history, setHistory] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [audioError, setAudioError] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [streamNonce, setStreamNonce] = useState(0);
  const [volume, setVolume] = useState(() => {
    const saved = Number(localStorage.getItem('younamp_volume'));
    return Number.isFinite(saved) && saved >= 0 && saved <= 1 ? saved : 0.85;
  });
  const [isMuted, setIsMuted] = useState(false);
  const [isShuffle, setIsShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState('off'); // 'off' | 'playlist' | 'track'

  // Spotify Shell Navigation & Panel Layout
  const [mainView, setMainView] = useState('playlist'); // 'playlist' | 'home' | 'search'
  const [rightPanelMode, setRightPanelMode] = useState('now_playing'); // 'now_playing' | 'queue' | 'closed'
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [mobileLibraryOpen, setMobileLibraryOpen] = useState(false);

  const selectedPlaylist = useMemo(
    () => playlists.find((p) => p.id === selectedPlaylistId) || null,
    [playlists, selectedPlaylistId]
  );

  // Load initial session & playlists
  const loadPlaylists = useCallback(async (preferredPlaylistId = null) => {
    const data = await apiFetch('/api/playlists');
    const list = data.playlists || [];
    setPlaylists(list);

    setSelectedPlaylistId((prev) => {
      const target = preferredPlaylistId || prev;
      if (target && list.some((p) => p.id === target)) return target;
      return list[0]?.id || null;
    });
    return list;
  }, []);

  const loadTracksForPlaylist = useCallback(async (playlistId) => {
    if (!playlistId) {
      setTracks([]);
      return [];
    }
    setIsLoadingTracks(true);
    try {
      const data = await apiFetch(`/api/playlists/${playlistId}/tracks`);
      const list = data.tracks || [];
      setTracks(list);
      return list;
    } catch (err) {
      console.error('Failed to load tracks:', err);
      setTracks([]);
      return [];
    } finally {
      setIsLoadingTracks(false);
    }
  }, []);

  const fetchRecommendations = useCallback(async (queryHint = '') => {
    setIsLoadingRecommendations(true);
    try {
      const qs = queryHint ? `?q=${encodeURIComponent(queryHint)}` : '';
      const data = await apiFetch(`/api/youtube/recommendations${qs}`);
      setRecommendations(data?.recommendations || []);
    } catch (err) {
      console.error('Failed to fetch YouTube recommendations:', err);
    } finally {
      setIsLoadingRecommendations(false);
    }
  }, []);

  const applySyncedSessionPayload = useCallback(
    async (data) => {
      if (!data) return;
      setActiveUser(data.activeUser || null);
      setIsAuthenticated(Boolean(data.activeUser));
      setSessionLoaded(true);

      const updatedList = Array.isArray(data.playlists)
        ? data.playlists
        : await loadPlaylists(selectedPlaylistIdRef.current);
      if (Array.isArray(data.playlists)) {
        setPlaylists(updatedList);
      }
      const activePlId =
        selectedPlaylistIdRef.current &&
        updatedList.some((p) => p.id === selectedPlaylistIdRef.current)
          ? selectedPlaylistIdRef.current
          : updatedList[0]?.id;
      if (activePlId) {
        setSelectedPlaylistId(activePlId);
        await loadTracksForPlaylist(activePlId).catch(() => []);
      } else {
        setTracks([]);
      }
      setTimeout(() => {
        fetchRecommendations().catch(() => {});
      }, 250);

      const nameLabel = data.activeUser?.handle
        ? `${data.activeUser.name} (${data.activeUser.handle})`
        : data.activeUser?.name || 'YouTube Account';
      setYtSyncStatus(
        `Synced ${data?.sync?.syncedCount ?? updatedList.length} playlist(s) (${data?.sync?.trackCount ?? 0} tracks) for ${nameLabel}.`
      );
    },
    [loadPlaylists, loadTracksForPlaylist, fetchRecommendations]
  );

  const loadSession = useCallback(async () => {
    const session = await apiFetch('/api/auth/session');
    const authenticated = Boolean(session.authenticated && session.activeUser);
    setActiveUser(session.activeUser || null);
    setIsAuthenticated(authenticated);
    setSessionLoaded(true);
    return session;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const session = await loadSession();
        if (session?.authenticated && session?.activeUser) {
          await loadPlaylists();
          setTimeout(() => {
            fetchRecommendations().catch(() => {});
          }, 300);
        } else {
          setPlaylists([]);
          setTracks([]);
          setSelectedPlaylistId(null);
          setRecommendations([]);
        }
      } catch (err) {
        console.error('Failed to initialize Youtify web player:', err);
        setSessionLoaded(true);
      }
    })();
  }, [loadSession, loadPlaylists, fetchRecommendations]);

  useEffect(() => {
    loadTracksForPlaylist(selectedPlaylistId);
  }, [selectedPlaylistId, loadTracksForPlaylist]);

  // Always use first-party HTML5 <audio> engine so iOS/Android keep playing on browser minimize & lockscreen
  const resolveEngineForTrack = useCallback(() => {
    return 'html5';
  }, []);

  const buildStreamUrl = useCallback((track, nonce, isRetry = false) => {
    if (!track?.id) return '';
    const params = new URLSearchParams({
      v: String(nonce),
      ytId: track.youtube_id || '',
      title: track.title || '',
      artist: track.artist || '',
      duration: String(Math.round(track.duration || 0)),
    });
    if (isRetry) params.set('retry', '1');
    return `/api/stream/${track.id}?${params.toString()}`;
  }, []);

  useEffect(() => {
    streamNonceRef.current = streamNonce;
  }, [streamNonce]);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  // Sync audio element & YT player volume/mute
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = volume;
      audio.muted = isMuted;
    }
    const yt = ytPlayerRef.current;
    if (ytReadyRef.current && yt) {
      try {
        yt.setVolume(Math.round(volume * 100));
        if (isMuted) yt.mute();
        else yt.unMute();
      } catch {
        // Ignore if YT iframe is transitioning
      }
    }
    localStorage.setItem('younamp_volume', String(volume));
  }, [volume, isMuted]);

  // Poll elapsed time, duration & state when using YT.Player engine (+ silent 3.5s fallback to HTML5 mirror)
  useEffect(() => {
    if (engineType !== 'yt_iframe' || !currentTrack) return;
    let startedPlayback = false;
    const startedAt = Date.now();
    const id = setInterval(() => {
      const yt = ytPlayerRef.current;
      if (!ytReadyRef.current || !yt) return;
      try {
        const pState = yt.getPlayerState?.();
        if (pState === 1 || pState === 2) {
          startedPlayback = true;
        }
        if (pState === 1) {
          setIsPlaying(true);
          setIsLoadingAudio(false);
          setAudioError(null);
        } else if (pState === 5) {
          yt.playVideo?.();
        } else if (!startedPlayback && Date.now() - startedAt > 3500) {
          const ytId = engineStateRef.current.currentTrack?.youtube_id;
          if (ytId) ytBlockedIdsRef.current.add(ytId);
          setIsPlaying(false);
          setIsLoadingAudio(false);
          setAudioError('YouTube audio unavailable for this track');
          return;
        }
        const t = yt.getCurrentTime?.();
        const d = yt.getDuration?.();
        if (Number.isFinite(t)) setCurrentTime(t);
        if (Number.isFinite(d) && d > 0) {
          setDuration(d);
          engineStateRef.current.persistTrackDuration?.(
            engineStateRef.current.currentTrack,
            d
          );
        }
      } catch {
        // Ignore polling error
      }
    }, 250);
    return () => clearInterval(id);
  }, [engineType, currentTrack?.id]);

  // Load & play when currentTrack, engineType, or streamNonce changes
  useEffect(() => {
    const audio = audioRef.current;
    const prevEngine = prevEngineRef.current;
    prevEngineRef.current = engineType;
    if (!currentTrack) return;

    setAudioError(null);
    setIsLoadingAudio(true);
    setCurrentTime(0);
    setDuration(currentTrack.duration || 0);

    if (engineType === 'yt_iframe' && currentTrack.youtube_id) {
      lastLoadedSrcRef.current = '';
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
      if (ytReadyRef.current && ytPlayerRef.current?.loadVideoById) {
        try {
          ytPlayerRef.current.loadVideoById(currentTrack.youtube_id);
          ytPlayerRef.current.playVideo?.();
        } catch {
          pendingYtVideoIdRef.current = currentTrack.youtube_id;
        }
      } else {
        pendingYtVideoIdRef.current = currentTrack.youtube_id;
      }
      return;
    }

    // HTML5 <audio> engine — only stop YouTube iframe when transitioning out of it
    if (prevEngine === 'yt_iframe' && ytReadyRef.current && ytPlayerRef.current?.stopVideo) {
      try {
        ytPlayerRef.current.stopVideo();
      } catch {
        // Ignore
      }
    }
    if (!audio) return;

    const expectedUrl = buildStreamUrl(currentTrack, streamNonce, false);
    if (lastLoadedSrcRef.current === expectedUrl) {
      return;
    }
    lastLoadedSrcRef.current = expectedUrl;
    audio.src = expectedUrl;

    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch((err) => {
        if (err?.name === 'AbortError') return;
        if (err?.name === 'NotAllowedError') {
          setIsPlaying(false);
          setIsLoadingAudio(false);
        }
      });
    }
  }, [currentTrack?.id, engineType, streamNonce, buildStreamUrl]);

  const startTrack = useCallback(
    (track, contextList = null, playlistName = null, pushToHistory = true) => {
      if (!track) return;
      shouldBePlayingRef.current = true;
      audioRetryCountRef.current = 0;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }

      if (pushToHistory && currentTrack && currentTrack.id !== track.id) {
        setHistory((prev) => [...prev.slice(-30), currentTrack]);
      }
      if (Array.isArray(contextList)) {
        setPlaybackContextTracks(contextList);
      }
      if (playlistName !== null) {
        setPlaybackPlaylistName(playlistName);
      } else if (selectedPlaylist) {
        setPlaybackPlaylistName(selectedPlaylist.name);
      }

      const nextEngine = resolveEngineForTrack(track);

      const triggerSyncAudio = (targetTrack, isRetry = false) => {
        const nextNonce = streamNonceRef.current + 1;
        streamNonceRef.current = nextNonce;
        const audio = audioRef.current;
        if (audio) {
          const nextUrl = buildStreamUrl(targetTrack, nextNonce, isRetry);
          lastLoadedSrcRef.current = nextUrl;
          audio.src = nextUrl;
          audio.load();
          const p = audio.play();
          if (p && typeof p.catch === 'function') {
            p.catch((err) => {
              if (err?.name === 'AbortError') return;
              if (err?.name === 'NotAllowedError') {
                setIsPlaying(false);
                setIsLoadingAudio(false);
              }
            });
          }
        }
        return nextNonce;
      };

      if (currentTrack?.id === track.id) {
        const audio = audioRef.current;
        if (nextEngine === 'html5' && engineType === 'html5' && audio && !audioError) {
          audio.currentTime = 0;
          audio.play().catch(() => {});
          return;
        }
        if (nextEngine === 'yt_iframe' && engineType === 'yt_iframe' && ytReadyRef.current && ytPlayerRef.current && !audioError) {
          ytPlayerRef.current.seekTo(0, true);
          ytPlayerRef.current.playVideo();
          return;
        }
        if (nextEngine === 'html5') {
          const nextNonce = triggerSyncAudio(track, Boolean(audioError));
          setEngineType('html5');
          setStreamNonce(nextNonce);
          return;
        }
        setEngineType(nextEngine);
        setStreamNonce((n) => n + 1);
        return;
      }

      if (nextEngine === 'html5') {
        const nextNonce = triggerSyncAudio(track, false);
        setEngineType(nextEngine);
        setCurrentTrack(track);
        setStreamNonce(nextNonce);
      } else {
        setEngineType(nextEngine);
        setCurrentTrack(track);
        setStreamNonce((n) => n + 1);
      }
    },
    [currentTrack, engineType, audioError, selectedPlaylist, resolveEngineForTrack, buildStreamUrl]
  );

  const persistTrackDuration = useCallback((track, rawDuration) => {
    if (!track || !Number.isFinite(rawDuration) || rawDuration <= 0) return;
    const rounded = Math.round(rawDuration);
    if (track.duration && track.duration > 0) return;

    setTracks((prev) =>
      prev.map((t) => (t.id === track.id ? { ...t, duration: rounded } : t))
    );
    if (String(track.id || '').startsWith('yt_')) return;
    if (!syncedDurationIdsRef.current.has(track.id)) {
      syncedDurationIdsRef.current.add(track.id);
      apiFetch(`/api/tracks/${track.id}/duration`, {
        method: 'PATCH',
        body: JSON.stringify({ duration: rounded }),
      }).catch(() => {});
    }
  }, []);

  // Keep fresh ref for audio & YT.Player event handlers
  const engineStateRef = useRef({});
  engineStateRef.current = {
    engineType,
    currentTrack,
    currentTime,
    duration,
    isPlaying,
    manualQueue,
    playbackContextTracks,
    tracks,
    isShuffle,
    repeatMode,
    history,
    volume,
    isMuted,
    startTrack,
    resolveEngineForTrack,
    persistTrackDuration,
  };

  const handleNext = useCallback((fromAutoEnded = false) => {
    const {
      engineType: activeEngine,
      currentTrack: active,
      manualQueue: q,
      playbackContextTracks: ctx,
      tracks: visibleTracks,
      isShuffle: shuffle,
      repeatMode: repeat,
      startTrack: playFn,
    } = engineStateRef.current;

    if (fromAutoEnded && repeat === 'track') {
      if (activeEngine === 'yt_iframe' && ytReadyRef.current && ytPlayerRef.current) {
        ytPlayerRef.current.seekTo(0, true);
        ytPlayerRef.current.playVideo();
        return;
      }
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = 0;
        audio.play().catch(() => {});
        return;
      }
    }

    if (q.length > 0) {
      const [nextItem, ...rest] = q;
      setManualQueue(rest);
      playFn(nextItem.track, null, nextItem.playlistName || '', true);
      return;
    }

    const pool = ctx.length > 0 ? ctx : visibleTracks;
    if (pool.length === 0) {
      setIsPlaying(false);
      return;
    }

    if (shuffle) {
      const candidates =
        pool.length > 1 ? pool.filter((t) => t.id !== active?.id) : pool;
      const randomTrack = candidates[Math.floor(Math.random() * candidates.length)];
      playFn(randomTrack, pool, null, true);
      return;
    }

    const currentIndex = pool.findIndex((t) => t.id === active?.id);
    const nextIndex = currentIndex + 1;

    if (nextIndex < pool.length) {
      playFn(pool[nextIndex], pool, null, true);
    } else if (repeat === 'playlist') {
      playFn(pool[0], pool, null, true);
    } else {
      shouldBePlayingRef.current = false;
      setIsPlaying(false);
    }
  }, []);

  const handlePrev = useCallback(() => {
    const {
      engineType: activeEngine,
      currentTime: elapsed,
      history: hist,
      currentTrack: active,
      playbackContextTracks: ctx,
      tracks: visibleTracks,
      repeatMode: repeat,
      resolveEngineForTrack: resolveFn,
    } = engineStateRef.current;

    if (elapsed > 3) {
      if (activeEngine === 'yt_iframe' && ytReadyRef.current && ytPlayerRef.current) {
        ytPlayerRef.current.seekTo(0, true);
        setCurrentTime(0);
        return;
      }
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = 0;
        setCurrentTime(0);
        return;
      }
    }

    if (hist.length > 0) {
      const prevTrack = hist[hist.length - 1];
      setHistory((prev) => prev.slice(0, -1));
      setEngineType(resolveFn(prevTrack));
      setCurrentTrack(prevTrack);
      setStreamNonce((n) => n + 1);
      return;
    }

    const pool = ctx.length > 0 ? ctx : visibleTracks;
    if (pool.length === 0) return;

    const idx = pool.findIndex((t) => t.id === active?.id);
    if (idx > 0) {
      startTrack(pool[idx - 1], pool, null, false);
    } else if (repeat === 'playlist' && pool.length > 1) {
      startTrack(pool[pool.length - 1], pool, null, false);
    } else if (activeEngine === 'yt_iframe' && ytReadyRef.current && ytPlayerRef.current) {
      ytPlayerRef.current.seekTo(0, true);
      setCurrentTime(0);
    } else if (audioRef.current) {
      audioRef.current.currentTime = 0;
      setCurrentTime(0);
    }
  }, [startTrack]);

  const handlePlay = useCallback(() => {
    shouldBePlayingRef.current = true;
    if (!currentTrack) {
      if (tracks.length > 0) {
        startTrack(tracks[0], tracks, selectedPlaylist?.name || '', true);
      }
      return;
    }
    if (audioError) {
      setStreamNonce((n) => n + 1);
      return;
    }
    if (engineType === 'yt_iframe') {
      const yt = ytPlayerRef.current;
      if (ytReadyRef.current && yt?.playVideo) yt.playVideo();
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    audio.play().catch((err) => {
      setAudioError(err?.message || 'Unable to play audio.');
    });
  }, [currentTrack, tracks, selectedPlaylist?.name, audioError, engineType, startTrack]);

  const handlePause = useCallback(() => {
    shouldBePlayingRef.current = false;
    if (!currentTrack) return;
    if (engineType === 'yt_iframe') {
      const yt = ytPlayerRef.current;
      if (ytReadyRef.current && yt?.pauseVideo) yt.pauseVideo();
      return;
    }
    audioRef.current?.pause();
  }, [currentTrack, engineType]);

  const handleStop = useCallback(() => {
    shouldBePlayingRef.current = false;
    if (!currentTrack) return;
    if (engineType === 'yt_iframe') {
      const yt = ytPlayerRef.current;
      if (ytReadyRef.current && yt) {
        try {
          yt.pauseVideo?.();
          yt.seekTo?.(0, true);
        } catch {
          // Ignore
        }
      }
    } else if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
    setIsLoadingAudio(false);
    setCurrentTime(0);
  }, [currentTrack, engineType]);

  const handleTogglePlay = useCallback(() => {
    if (!currentTrack) {
      handlePlay();
      return;
    }
    if (audioError) {
      setStreamNonce((n) => n + 1);
      return;
    }
    if (engineType === 'yt_iframe') {
      if (isPlaying) handlePause();
      else handlePlay();
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) handlePlay();
    else handlePause();
  }, [currentTrack, audioError, engineType, isPlaying, handlePlay, handlePause]);

  const handleSeek = useCallback(
    (seconds) => {
      if (!Number.isFinite(seconds)) return;
      if (engineType === 'yt_iframe') {
        const yt = ytPlayerRef.current;
        if (ytReadyRef.current && yt?.seekTo) {
          yt.seekTo(seconds, true);
        }
        setCurrentTime(seconds);
        return;
      }
      const audio = audioRef.current;
      if (!audio) return;
      audio.currentTime = seconds;
      setCurrentTime(seconds);
    },
    [engineType]
  );

  // Initialize hidden official YouTube IFrame Player bridge once on mount
  useEffect(() => {
    let destroyed = false;

    const createBridge = () => {
      if (destroyed || ytPlayerRef.current || !window.YT?.Player) return;
      const mountEl = document.getElementById('younamp-yt-bridge');
      if (!mountEl) return;

      ytPlayerRef.current = new window.YT.Player('younamp-yt-bridge', {
        height: '200',
        width: '200',
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          enablejsapi: 1,
          fs: 0,
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
          origin: window.location.origin,
        },
        events: {
          onReady: (event) => {
            if (destroyed) return;
            ytReadyRef.current = true;
            try {
              const iframe = event.target.getIframe?.();
              if (iframe) {
                iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
                iframe.setAttribute('allow', 'autoplay; encrypted-media');
              }
            } catch {
              // Ignore
            }
            const { volume: v, isMuted: muted } = engineStateRef.current;
            try {
              event.target.setVolume(Math.round((v ?? 0.85) * 100));
              if (muted) event.target.mute();
              else event.target.unMute();
            } catch {
              // Ignore
            }
            if (pendingYtVideoIdRef.current) {
              const vid = pendingYtVideoIdRef.current;
              pendingYtVideoIdRef.current = null;
              event.target.loadVideoById(vid);
              event.target.playVideo?.();
            }
          },
          onStateChange: (event) => {
            if (destroyed || engineStateRef.current.engineType !== 'yt_iframe') return;
            const state = event.data;
            const YTState = window.YT?.PlayerState || {};

            if (state === YTState.PLAYING || state === 1) {
              setIsPlaying(true);
              setIsLoadingAudio(false);
              setAudioError(null);
              const d = event.target.getDuration?.();
              if (Number.isFinite(d) && d > 0) {
                setDuration(d);
                engineStateRef.current.persistTrackDuration(
                  engineStateRef.current.currentTrack,
                  d
                );
              }
            } else if (state === YTState.PAUSED || state === 2) {
              setIsPlaying(false);
              setIsLoadingAudio(false);
            } else if (state === YTState.BUFFERING || state === 3) {
              setIsLoadingAudio(true);
            } else if (state === YTState.CUED || state === 5) {
              event.target.playVideo?.();
            } else if (state === YTState.ENDED || state === 0) {
              handleNext(true);
            }
          },
          onError: () => {
            if (destroyed || engineStateRef.current.engineType !== 'yt_iframe') return;
            const failedYtId = engineStateRef.current.currentTrack?.youtube_id;
            if (failedYtId) {
              ytBlockedIdsRef.current.add(failedYtId);
            }
            setIsPlaying(false);
            setIsLoadingAudio(false);
            setAudioError('YouTube audio unavailable for this track');
          },
        },
      });
      try {
        const iframe = ytPlayerRef.current?.getIframe?.();
        if (iframe) {
          iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
          iframe.setAttribute('allow', 'autoplay; encrypted-media');
        }
      } catch {
        // Ignore
      }
    };

    if (window.YT?.Player) {
      createBridge();
    } else {
      const existingScript = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
      const prevCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof prevCallback === 'function') prevCallback();
        createBridge();
      };
      if (!existingScript) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        tag.async = true;
        document.head.appendChild(tag);
      }
    }

    return () => {
      destroyed = true;
      try {
        ytPlayerRef.current?.destroy?.();
      } catch {
        // Ignore cleanup failure
      }
      ytPlayerRef.current = null;
      ytReadyRef.current = false;
    };
  }, [handleNext]);

  // Spacebar play/pause shortcut when focus isn't inside an input
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.code !== 'Space') return;
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (['input', 'textarea', 'select', 'button'].includes(tag)) return;
      e.preventDefault();
      handleTogglePlay();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleTogglePlay]);

  // Browser / OS Media Session API (Global Media Controls, Next/Prev keys, Lockscreen, Page Title)
  const mediaActionsRef = useRef({});
  mediaActionsRef.current = {
    handlePlay,
    handlePause,
    handleStop,
    handlePrev,
    handleNext,
    handleSeek,
  };

  useEffect(() => {
    if (!currentTrack) {
      document.title = 'Youtify — Web Player';
    } else {
      const artistLabel = currentTrack.artist || 'YouTube Audio';
      document.title = isPlaying
        ? `${currentTrack.title} • ${artistLabel}`
        : `${currentTrack.title} — Youtify`;
    }

    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

    const ms = navigator.mediaSession;
    if (!currentTrack) {
      ms.metadata = null;
      ms.playbackState = 'none';
    } else {
      const thumbSrc =
        currentTrack.thumbnail_url ||
        (currentTrack.youtube_id
          ? `https://i.ytimg.com/vi/${currentTrack.youtube_id}/hqdefault.jpg`
          : '');
      const artwork = thumbSrc
        ? ['96x96', '128x128', '192x192', '256x256', '384x384', '512x512'].map((sizes) => ({
            src: thumbSrc,
            sizes,
          }))
        : [];

      if (typeof window.MediaMetadata === 'function') {
        ms.metadata = new window.MediaMetadata({
          title: currentTrack.title || 'Unknown Track',
          artist: currentTrack.artist || 'YouTube Audio',
          album: playbackPlaylistName || selectedPlaylist?.name || 'Youtify',
          artwork,
        });
      }
      ms.playbackState = isPlaying || shouldBePlayingRef.current ? 'playing' : 'paused';
    }

    const actions = [
      ['play', () => mediaActionsRef.current.handlePlay()],
      ['pause', () => mediaActionsRef.current.handlePause()],
      ['previoustrack', () => mediaActionsRef.current.handlePrev()],
      ['nexttrack', () => mediaActionsRef.current.handleNext(false)],
      [
        'seekto',
        (details) => {
          if (typeof details?.seekTime === 'number') {
            mediaActionsRef.current.handleSeek(details.seekTime);
          }
        },
      ],
    ];

    for (const [action, handler] of actions) {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        // Ignore unsupported MediaSession action in older browsers
      }
    }
  }, [currentTrack, isPlaying, playbackPlaylistName, selectedPlaylist?.name]);

  const roundedPositionSec = Math.floor(currentTime || 0);
  useEffect(() => {
    if (
      typeof navigator === 'undefined' ||
      !('mediaSession' in navigator) ||
      typeof navigator.mediaSession.setPositionState !== 'function'
    ) {
      return;
    }
    if (!currentTrack || !Number.isFinite(duration) || duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: 1,
        position: Math.max(0, Math.min(duration, currentTime || 0)),
      });
    } catch {
      // Ignore transient duration/position mismatch during track switch
    }
  }, [currentTrack, duration, isPlaying, roundedPositionSec]);

  // Keep background playback running smoothly when mobile browser is minimized or screen is locked
  useEffect(() => {
    const resumeIfIntended = () => {
      if (!shouldBePlayingRef.current) return;
      if (engineStateRef.current.engineType !== 'html5') return;
      const audio = audioRef.current;
      if (audio && audio.paused && !audio.ended) {
        audio.play().catch(() => {});
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        resumeIfIntended();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  // Playlist CRUD handlers (2-way synced with YouTube when connected)
  const handleSavePlaylist = async (payload) => {
    setYtSyncError('');
    if (playlistModal.mode === 'create') {
      const data = await apiFetch('/api/playlists', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await loadPlaylists(data.playlist.id);
      if (data?.youtubeSynced) {
        setYtSyncStatus(`Created "${data.playlist.name}" & synced live to YouTube.`);
      }
    } else if (playlistModal.playlist) {
      const data = await apiFetch(`/api/playlists/${playlistModal.playlist.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      await loadPlaylists(playlistModal.playlist.id);
      if (data?.youtubeSynced) {
        setYtSyncStatus(`Updated "${data.playlist.name}" & synced live to YouTube.`);
      }
    }
  };

  const handleDeletePlaylist = async (playlistId) => {
    setYtSyncError('');
    try {
      const data = await apiFetch(`/api/playlists/${playlistId}`, { method: 'DELETE' });
      await loadPlaylists();
      if (data?.youtubeSynced) {
        setYtSyncStatus('Deleted playlist from Younamp & YouTube /feed/playlists.');
      }
    } catch (err) {
      setYtSyncError(err.message || 'Failed to delete playlist.');
    }
  };

  // URL Ingestion & In-App YouTube Search
  const handleAddUrl = async (playlistId, url) => {
    setIsAddingUrl(true);
    setUrlError('');
    setYtSyncError('');
    try {
      const data = await apiFetch(`/api/playlists/${playlistId}/tracks`, {
        method: 'POST',
        body: JSON.stringify({ url }),
      });
      await loadPlaylists(selectedPlaylistId);
      if (playlistId === selectedPlaylistId) {
        await loadTracksForPlaylist(playlistId);
      } else {
        setSelectedPlaylistId(playlistId);
      }
      if (data?.youtubeSynced) {
        setYtSyncStatus(`Added "${data.track?.title || 'track'}" & synced to YouTube playlist.`);
      }
      return true;
    } catch (err) {
      setUrlError(err.message || 'Failed to add URL.');
      return false;
    } finally {
      setIsAddingUrl(false);
    }
  };

  const handleSearchYouTube = async (query, filterOverride = ytSearchFilter) => {
    const clean = String(query || '').trim();
    if (!clean) return;
    setMainView('search');
    setYtSearchQuery(clean);
    setYtSearchFilter(filterOverride);
    setYtSearchError('');
    setIsSearchingYt(true);
    try {
      const data = await apiFetch(
        `/api/youtube/search?q=${encodeURIComponent(clean)}&filter=${encodeURIComponent(filterOverride)}`
      );
      setYtSearchResults(data.results || []);
    } catch (err) {
      setYtSearchError(err.message || 'Failed to search YouTube.');
    } finally {
      setIsSearchingYt(false);
    }
  };

  const handleChangeYtSearchFilter = async (nextFilter) => {
    setYtSearchFilter(nextFilter);
    if (ytSearchQuery.trim()) {
      await handleSearchYouTube(ytSearchQuery, nextFilter);
    }
  };

  const handlePlaySearchResult = (item) => {
    if (!item?.youtube_id) return;
    const streamTrack = {
      id: `yt_${item.youtube_id}`,
      title: item.title || `YouTube (${item.youtube_id})`,
      artist: item.artist || 'YouTube',
      url: item.url || `https://www.youtube.com/watch?v=${item.youtube_id}`,
      source_type: 'youtube',
      youtube_id: item.youtube_id,
      duration: item.duration || 0,
      thumbnail_url:
        item.thumbnail_url || `https://i.ytimg.com/vi/${item.youtube_id}/hqdefault.jpg`,
    };
    startTrack(streamTrack, [streamTrack], 'YouTube Search', true);
  };

  const handleAddTrackToChosenPlaylist = async (playlistId, item) => {
    setAddingVideoId(item.youtube_id || '');
    setYtSearchError('');
    setYtSyncError('');
    try {
      const data = await apiFetch(`/api/playlists/${playlistId}/tracks`, {
        method: 'POST',
        body: JSON.stringify({
          url: item.url || `https://www.youtube.com/watch?v=${item.youtube_id}`,
          title: item.title,
          artist: item.artist,
          duration: item.duration,
          thumbnail_url: item.thumbnail_url,
        }),
      });
      await loadPlaylists(playlistId);
      if (selectedPlaylistIdRef.current === playlistId) {
        await loadTracksForPlaylist(playlistId);
      }
      const plName = playlists.find((p) => p.id === playlistId)?.name || 'Playlist';
      setYtSyncStatus(
        data?.youtubeSynced
          ? `Added "${data.track?.title || item.title}" to "${plName}" & synced to YouTube.`
          : `Added "${data.track?.title || item.title}" to "${plName}".`
      );
      return data;
    } finally {
      setAddingVideoId('');
    }
  };

  const handleCreatePlaylistAndAddTrack = async (name, item) => {
    const created = await apiFetch('/api/playlists', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    const newPl = created?.playlist;
    if (!newPl?.id) {
      throw new Error('Failed to create target playlist.');
    }
    await handleAddTrackToChosenPlaylist(newPl.id, item);
    if (!selectedPlaylistIdRef.current) {
      setSelectedPlaylistId(newPl.id);
    }
  };

  // Track Reordering & Moving & Removing
  const handleReorderTracks = async (playlistId, trackIds) => {
    const mapById = new Map(tracks.map((t) => [t.id, t]));
    const optimistic = trackIds.map((id) => mapById.get(id)).filter(Boolean);
    setTracks(optimistic);
    if (playbackPlaylistName === selectedPlaylist?.name) {
      setPlaybackContextTracks(optimistic);
    }

    try {
      const data = await apiFetch(`/api/playlists/${playlistId}/tracks/reorder`, {
        method: 'PUT',
        body: JSON.stringify({ trackIds }),
      });
      setTracks(data.tracks || optimistic);
    } catch (err) {
      console.error('Reorder failed:', err);
      loadTracksForPlaylist(playlistId);
    }
  };

  const handleMoveTrack = async (trackId, targetPlaylistId) => {
    setYtSyncError('');
    try {
      const data = await apiFetch(`/api/tracks/${trackId}/move`, {
        method: 'POST',
        body: JSON.stringify({ targetPlaylistId }),
      });
      setTracks((prev) => prev.filter((t) => t.id !== trackId));
      await loadPlaylists(selectedPlaylistId);
      if (data?.youtubeSynced) {
        setYtSyncStatus('Moved track & synced live to YouTube.');
      }
    } catch (err) {
      console.error('Move track failed:', err);
      setYtSyncError(err.message || 'Failed to move track.');
    }
  };

  const handleRemoveTrack = async (trackId) => {
    setYtSyncError('');
    try {
      const data = await apiFetch(`/api/tracks/${trackId}`, { method: 'DELETE' });
      setTracks((prev) => prev.filter((t) => t.id !== trackId));
      setPlaybackContextTracks((prev) => prev.filter((t) => t.id !== trackId));
      setManualQueue((prev) => prev.filter((item) => item.track.id !== trackId));
      await loadPlaylists(selectedPlaylistId);
      if (data?.youtubeSynced) {
        setYtSyncStatus('Removed track from Younamp & YouTube playlist.');
      }
    } catch (err) {
      console.error('Remove track failed:', err);
      setYtSyncError(err.message || 'Failed to remove track.');
    }
  };

  // Queue handlers
  const handleAddToQueue = (track) => {
    setManualQueue((prev) => [
      ...prev,
      {
        queueId: `${track.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        track,
        playlistName: selectedPlaylist?.name || '',
      },
    ]);
  };

  const handlePlayPlaylist = (list, startIndex = 0) => {
    if (!list.length) return;
    setIsShuffle(false);
    startTrack(list[startIndex], list, selectedPlaylist?.name || '', true);
  };

  const handleShufflePlaylist = (list) => {
    if (!list.length) return;
    setIsShuffle(true);
    const randIndex = Math.floor(Math.random() * list.length);
    startTrack(list[randIndex], list, selectedPlaylist?.name || '', true);
  };

  const handleCycleRepeat = useCallback(() => {
    setRepeatMode((m) => (m === 'off' ? 'playlist' : m === 'playlist' ? 'track' : 'off'));
  }, []);

  // Per-Browser YouTube Session Auth & /feed/playlists 2-Way Sync handlers
  const handleYouTubeLogin = async (credentials = {}) => {
    setIsSyncingYt(true);
    setYtSyncError('');
    try {
      if (credentials?.oauthSid) {
        setBrowserSessionId(credentials.oauthSid);
        const session = await loadSession();
        if (session?.authenticated && session?.activeUser) {
          const list = await loadPlaylists();
          if (list?.[0]?.id) {
            await loadTracksForPlaylist(list[0].id).catch(() => []);
          }
          setTimeout(() => {
            fetchRecommendations().catch(() => {});
          }, 250);
          return session;
        }
        throw new Error('Sesi OAuth YouTube tidak ditemukan. Silakan coba lagi.');
      }
      const data = await apiFetch('/api/auth/youtube/login', {
        method: 'POST',
        body: JSON.stringify(credentials || {}),
      });
      await applySyncedSessionPayload(data);
      return data;
    } catch (err) {
      if (!err?.needsBrowserVerification) {
        setYtSyncError(err.message || 'Gagal autentikasi dengan YouTube.');
      }
      throw err;
    } finally {
      setIsSyncingYt(false);
    }
  };

  const handleYouTubeLogout = async () => {
    handleStop();
    setCurrentTrack(null);
    setPlaybackContextTracks([]);
    setManualQueue([]);
    try {
      await apiFetch('/api/auth/youtube/logout', { method: 'POST' });
    } finally {
      clearBrowserSessionId();
      setActiveUser(null);
      setIsAuthenticated(false);
      setPlaylists([]);
      setTracks([]);
      setRecommendations([]);
      setSelectedPlaylistId(null);
      setYtSyncStatus('');
      setYtSyncError('');
    }
  };

  const handleSyncYouTubePlaylists = async () => {
    setIsSyncingYt(true);
    setYtSyncError('');
    try {
      const data = await apiFetch('/api/youtube/playlists/sync', { method: 'POST' });
      await applySyncedSessionPayload(data);
      return data;
    } catch (err) {
      setYtSyncError(err.message || 'Failed to sync YouTube /feed/playlists.');
      throw err;
    } finally {
      setIsSyncingYt(false);
    }
  };

  const handleImportPublicYouTube = async (input) => {
    setIsImportingYt(true);
    setYtSyncError('');
    setUrlError('');
    try {
      const data = await apiFetch('/api/youtube/playlists/import', {
        method: 'POST',
        body: JSON.stringify({ input }),
      });
      const targetPlId = data?.firstPlaylistId || selectedPlaylistId;
      await loadPlaylists(targetPlId);
      setMainView('playlist');
      if (targetPlId) {
        setSelectedPlaylistId(targetPlId);
        await loadTracksForPlaylist(targetPlId);
      }
      setYtSyncStatus(
        `Imported ${data?.importedPlaylists || 1} YouTube playlist(s) (${data?.importedTracks || 0} tracks).`
      );
      return data;
    } catch (err) {
      const msg = err.message || 'Failed to import YouTube playlist.';
      setYtSyncError(msg);
      setUrlError(msg);
      return null;
    } finally {
      setIsImportingYt(false);
    }
  };

  const handleConnectYouTubeSession = async (payloadOrCookie) => {
    setIsSyncingYt(true);
    setYtSyncError('');
    try {
      const body =
        typeof payloadOrCookie === 'string'
          ? { cookieInput: payloadOrCookie }
          : payloadOrCookie || {};
      const data = await apiFetch('/api/auth/youtube/session-bridge', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      await applySyncedSessionPayload(data);
      return data;
    } catch (err) {
      setYtSyncError(err.message || 'Failed to connect YouTube session.');
      throw err;
    } finally {
      setIsSyncingYt(false);
    }
  };

  const handleDisconnectYouTubeSession = async () => {
    handleStop();
    setCurrentTrack(null);
    setPlaybackContextTracks([]);
    setManualQueue([]);
    await apiFetch('/api/auth/youtube/session-bridge', { method: 'DELETE' });
    clearBrowserSessionId();
    setActiveUser(null);
    setIsAuthenticated(false);
    setPlaylists([]);
    setTracks([]);
    setRecommendations([]);
    setSelectedPlaylistId(null);
    setYtSyncStatus('Disconnected YouTube account.');
  };

  const handleUpdateSettings = async (updates) => {
    const data = await apiFetch('/api/auth/settings', {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    setActiveUser(data.activeUser);
  };

  const openSettingsModal = useCallback((initialTab = 'user') => {
    setAccountModalTab(initialTab);
    setAccountModalOpen(true);
  }, []);

  const handleToggleRightPanel = useCallback((targetMode) => {
    setRightPanelMode((prev) => (prev === targetMode ? 'closed' : targetMode));
  }, []);

  const handleSelectAndPlayPlaylist = async (playlistId) => {
    setSelectedPlaylistId(playlistId);
    setMainView('playlist');
    const list = await loadTracksForPlaylist(playlistId);
    if (list.length > 0) {
      const plName = playlists.find((p) => p.id === playlistId)?.name || '';
      startTrack(list[0], list, plName, true);
    }
  };

  // Compute "Up Next from Playlist" for Right Panel Queue
  const upNextTracks = useMemo(() => {
    const pool = playbackContextTracks.length > 0 ? playbackContextTracks : tracks;
    if (!currentTrack) return pool;
    const idx = pool.findIndex((t) => t.id === currentTrack.id);
    if (idx === -1) return pool;
    return pool.slice(idx + 1);
  }, [playbackContextTracks, tracks, currentTrack]);

  // Pre-warm next track into edge cache near end of current song so locked-screen next-track transition is instant
  useEffect(() => {
    if (!currentTrack || !Number.isFinite(duration) || duration <= 25) return;
    if (roundedPositionSec < Math.floor(duration - 25)) return;
    const nextCandidate = manualQueue[0]?.track || upNextTracks[0];
    if (!nextCandidate?.id || prewarmedTrackIdRef.current === nextCandidate.id) return;
    prewarmedTrackIdRef.current = nextCandidate.id;

    const p = new URLSearchParams({
      v: '0',
      ytId: nextCandidate.youtube_id || '',
      title: nextCandidate.title || '',
      artist: nextCandidate.artist || '',
      duration: String(Math.round(nextCandidate.duration || 0)),
    });
    fetch(`/api/stream/${nextCandidate.id}?${p.toString()}`, {
      headers: { Range: 'bytes=0-1023' },
    }).catch(() => {});
  }, [currentTrack?.id, duration, roundedPositionSec, manualQueue, upNextTracks]);

  const showLoginGate = sessionLoaded && !isAuthenticated;

  return (
    <div className="h-screen w-screen overflow-hidden bg-black text-white flex flex-col">
      <audio
        ref={audioRef}
        preload="auto"
        playsInline
        onLoadStart={() => {
          if (engineType === 'html5' && currentTrack) setIsLoadingAudio(true);
        }}
        onWaiting={() => {
          if (engineType === 'html5') setIsLoadingAudio(true);
        }}
        onCanPlay={() => {
          if (engineType !== 'html5') return;
          setIsLoadingAudio(false);
          setAudioError(null);
        }}
        onPlaying={() => {
          if (engineType !== 'html5') return;
          audioRetryCountRef.current = 0;
          setIsPlaying(true);
          setIsLoadingAudio(false);
          setAudioError(null);
        }}
        onPause={(e) => {
          if (engineType !== 'html5') return;
          const audio = e.currentTarget;
          if (
            document.visibilityState === 'hidden' &&
            shouldBePlayingRef.current &&
            !audio.ended
          ) {
            const now = Date.now();
            if (now - lastAutoResumeAtRef.current > 400) {
              lastAutoResumeAtRef.current = now;
              setTimeout(() => {
                if (
                  shouldBePlayingRef.current &&
                  audioRef.current &&
                  audioRef.current.paused &&
                  !audioRef.current.ended
                ) {
                  audioRef.current.play().catch(() => {});
                }
              }, 50);
              return;
            }
          }
          setIsPlaying(false);
        }}
        onTimeUpdate={(e) => {
          if (engineType === 'html5') setCurrentTime(e.currentTarget.currentTime || 0);
        }}
        onLoadedMetadata={(e) => {
          if (engineType !== 'html5') return;
          const dur = e.currentTarget.duration;
          if (resumeTimeRef.current > 0) {
            try {
              const targetTime =
                Number.isFinite(dur) && dur > 0
                  ? Math.min(resumeTimeRef.current, dur)
                  : resumeTimeRef.current;
              e.currentTarget.currentTime = targetTime;
            } catch {
              // Ignore seek failure before range readiness
            }
            resumeTimeRef.current = 0;
          }
          if (Number.isFinite(dur) && dur > 0) {
            if (!currentTrack?.duration || dur >= currentTrack.duration * 0.5) {
              setDuration(dur);
              persistTrackDuration(currentTrack, dur);
            }
          }
        }}
        onEnded={() => {
          if (engineType === 'html5') handleNext(true);
        }}
        onError={() => {
          if (engineType !== 'html5' || !currentTrack) return;
          if (audioRetryCountRef.current < 2) {
            audioRetryCountRef.current += 1;
            const retryNum = audioRetryCountRef.current;
            setIsLoadingAudio(true);
            setAudioError(null);
            if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
            const targetTrack = currentTrack;
            retryTimerRef.current = setTimeout(() => {
              const audio = audioRef.current;
              if (!audio || engineStateRef.current.currentTrack?.id !== targetTrack.id) return;
              const retryUrl = buildStreamUrl(targetTrack, streamNonceRef.current + retryNum, true);
              lastLoadedSrcRef.current = retryUrl;
              audio.src = retryUrl;
              audio.load();
              if (shouldBePlayingRef.current) {
                audio.play().catch(() => {});
              }
            }, 400);
            return;
          }
          if (
            document.visibilityState !== 'hidden' &&
            currentTrack.source_type === 'youtube' &&
            currentTrack.youtube_id &&
            ytReadyRef.current &&
            !ytBlockedIdsRef.current.has(currentTrack.youtube_id)
          ) {
            setEngineType('yt_iframe');
            return;
          }
          setIsPlaying(false);
          setIsLoadingAudio(false);
          setAudioError('Audio stream unavailable');
        }}
      />

      <div
        aria-hidden="true"
        className="w-[200px] h-[200px] overflow-hidden opacity-0 pointer-events-none fixed -bottom-[260px] -left-[260px]"
      >
        <div id="younamp-yt-bridge" />
      </div>

      {showLoginGate ? (
        <SpotifyLoginView
          isBusy={isSyncingYt}
          error={ytSyncError}
          onLogin={handleYouTubeLogin}
        />
      ) : (
        <>
          {/* Spotify 5-Zone Desktop Shell */}
      <SpotifyTopBar
        mainView={mainView}
        searchQuery={ytSearchQuery}
        activeUser={activeUser}
        isSyncingYt={isSyncingYt}
        selectedPlaylistId={selectedPlaylistId}
        onGoHome={() => setMainView('home')}
        onSearchYouTube={(q) => handleSearchYouTube(q)}
        onAddUrlToSelected={handleAddUrl}
        onSyncYouTube={() => {
          if (isAuthenticated) {
            handleSyncYouTubePlaylists().catch(() => {});
          } else {
            openSettingsModal('user');
          }
        }}
        onLogout={handleYouTubeLogout}
        onOpenAccountModal={(tabName) => openSettingsModal(tabName || 'user')}
        onOpenMobileLibrary={() => setMobileLibraryOpen(true)}
      />

      <div className="flex-1 min-h-0 flex gap-2 px-2 pb-2 overflow-hidden">
        <SpotifyLibrarySidebar
          playlists={playlists}
          selectedPlaylistId={selectedPlaylistId}
          playbackPlaylistName={playbackPlaylistName}
          currentTrack={currentTrack}
          isPlaying={isPlaying}
          activeUser={activeUser}
          recommendations={recommendations}
          isLoadingRecommendations={isLoadingRecommendations}
          collapsed={libraryCollapsed}
          mobileOpen={mobileLibraryOpen}
          onCloseMobile={() => setMobileLibraryOpen(false)}
          onToggleCollapse={() => setLibraryCollapsed((c) => !c)}
          onSelectPlaylist={(id) => {
            setSelectedPlaylistId(id);
            setMainView('playlist');
          }}
          onOpenCreatePlaylist={() =>
            setPlaylistModal({ isOpen: true, mode: 'create', playlist: null })
          }
          onRefreshRecommendations={() =>
            fetchRecommendations(ytSearchQuery || currentTrack?.artist || '')
          }
          onPlayRecommendedTrack={handlePlaySearchResult}
          onAddRecommendedTrack={(item) => setAddModalTrack(item)}
          onMoveTrack={handleMoveTrack}
        />

        <main className="flex-1 min-w-0 h-full overflow-hidden flex">
          {mainView === 'home' ? (
            <SpotifyHomeView
              playlists={playlists}
              activeUser={activeUser}
              isSyncingYt={isSyncingYt}
              onSelectAndPlayPlaylist={handleSelectAndPlayPlaylist}
              onSelectPlaylist={(id) => {
                setSelectedPlaylistId(id);
                setMainView('playlist');
              }}
              onOpenCreatePlaylist={() =>
                setPlaylistModal({ isOpen: true, mode: 'create', playlist: null })
              }
              onSyncYouTube={() => {
                if (isAuthenticated) {
                  handleSyncYouTubePlaylists().catch(() => {});
                } else {
                  openSettingsModal('user');
                }
              }}
            />
          ) : mainView === 'search' ? (
            <YouTubeSearchView
              query={ytSearchQuery}
              filter={ytSearchFilter}
              results={ytSearchResults}
              isSearching={isSearchingYt}
              error={ytSearchError}
              selectedPlaylist={selectedPlaylist}
              playlistTracks={tracks}
              currentTrack={currentTrack}
              addingVideoId={addingVideoId}
              onSearch={handleSearchYouTube}
              onChangeFilter={handleChangeYtSearchFilter}
              onAddTrack={(item) => setAddModalTrack(item)}
              onPlayTrack={(item) => handlePlaySearchResult(item)}
            />
          ) : (
            <SpotifyPlaylistView
              playlist={selectedPlaylist}
              playlists={playlists}
              tracks={tracks}
              isLoadingTracks={isLoadingTracks}
              activeUser={activeUser}
              currentTrack={currentTrack}
              playbackPlaylistName={playbackPlaylistName}
              isPlaying={isPlaying}
              isShuffle={isShuffle}
              isAddingUrl={isAddingUrl}
              isSyncingYt={isSyncingYt}
              ytSyncStatus={ytSyncStatus}
              ytSyncError={ytSyncError}
              urlError={urlError}
              draggingTrackId={draggingTrackId}
              onClearYtSyncFeedback={() => {
                setYtSyncStatus('');
                setYtSyncError('');
              }}
              onClearUrlError={() => setUrlError('')}
              onPlayPlaylist={handlePlayPlaylist}
              onShufflePlaylist={handleShufflePlaylist}
              onTogglePlay={handleTogglePlay}
              onPlayTrack={(track, list) =>
                startTrack(track, list, selectedPlaylist?.name || '', true)
              }
              onAddToQueue={handleAddToQueue}
              onMoveTrack={handleMoveTrack}
              onRemoveTrack={handleRemoveTrack}
              onReorderTracks={handleReorderTracks}
              onAddUrl={handleAddUrl}
              onSyncYouTube={() => {
                if (isAuthenticated) {
                  handleSyncYouTubePlaylists().catch(() => {});
                } else {
                  openSettingsModal('user');
                }
              }}
              onEditPlaylist={(pl) =>
                setPlaylistModal({ isOpen: true, mode: 'edit', playlist: pl })
              }
              onDeletePlaylist={handleDeletePlaylist}
              onOpenCreatePlaylist={() =>
                setPlaylistModal({ isOpen: true, mode: 'create', playlist: null })
              }
              onOpenSearch={() => setMainView('search')}
              onDragStartTrack={(id) => setDraggingTrackId(id)}
              onDragEndTrack={() => setDraggingTrackId(null)}
            />
          )}
        </main>

        <SpotifyRightPanel
          mode={rightPanelMode}
          onChangeMode={setRightPanelMode}
          onClose={() => setRightPanelMode('closed')}
          currentTrack={currentTrack}
          playbackPlaylistName={playbackPlaylistName}
          selectedPlaylistName={selectedPlaylist?.name || ''}
          manualQueue={manualQueue}
          upNextTracks={upNextTracks}
          engineType={engineType}
          onPlayTrack={(track) =>
            startTrack(
              track,
              playbackContextTracks.length > 0 ? playbackContextTracks : tracks,
              playbackPlaylistName || selectedPlaylist?.name || '',
              true
            )
          }
          onPlayTrackFromQueue={(item, idx) => {
            setManualQueue((prev) => prev.filter((_, i) => i !== idx));
            startTrack(item.track, null, item.playlistName || '', true);
          }}
          onRemoveFromManualQueue={(queueId) =>
            setManualQueue((prev) => prev.filter((item) => item.queueId !== queueId))
          }
          onClearManualQueue={() => setManualQueue([])}
        />
      </div>

      <SpotifyPlayerBar
        currentTrack={currentTrack}
        isPlaying={isPlaying}
        isLoadingAudio={isLoadingAudio}
        audioError={audioError}
        currentTime={currentTime}
        duration={duration}
        volume={volume}
        isMuted={isMuted}
        isShuffle={isShuffle}
        repeatMode={repeatMode}
        rightPanelMode={rightPanelMode}
        onTogglePlay={handleTogglePlay}
        onPrev={handlePrev}
        onNext={() => handleNext(false)}
        onSeek={handleSeek}
        onChangeVolume={(val) => {
          setVolume(val);
          if (val > 0 && isMuted) setIsMuted(false);
        }}
        onToggleMute={() => setIsMuted((m) => !m)}
        onToggleShuffle={() => setIsShuffle((s) => !s)}
        onCycleRepeat={handleCycleRepeat}
        onRetryAudio={() => {
          if (currentTrack) {
            setAudioError(null);
            setStreamNonce((n) => n + 1);
          }
        }}
        onToggleRightPanel={handleToggleRightPanel}
      />

      <PlaylistModal
        isOpen={playlistModal.isOpen}
        mode={playlistModal.mode}
        initialPlaylist={playlistModal.playlist}
        onClose={() => setPlaylistModal({ isOpen: false, mode: 'create', playlist: null })}
        onSave={handleSavePlaylist}
      />

      <AccountModal
        isOpen={accountModalOpen}
        initialTab={accountModalTab}
        requireAuth={false}
        activeUser={activeUser}
        storedUser={null}
        isSyncingYt={isSyncingYt}
        onClose={() => {
          if (isAuthenticated) setAccountModalOpen(false);
        }}
        onYouTubeLogout={handleYouTubeLogout}
        onUpdateSettings={handleUpdateSettings}
        onConnectYouTubeSession={handleConnectYouTubeSession}
        onDisconnectYouTubeSession={handleDisconnectYouTubeSession}
        onSyncYouTube={handleSyncYouTubePlaylists}
        onImportPublicYouTube={handleImportPublicYouTube}
      />

      <AddToPlaylistModal
        isOpen={Boolean(addModalTrack)}
        track={addModalTrack}
        playlists={playlists}
        onClose={() => setAddModalTrack(null)}
        onConfirmAdd={handleAddTrackToChosenPlaylist}
        onCreatePlaylistAndAdd={handleCreatePlaylistAndAddTrack}
      />
        </>
      )}
    </div>
  );
}
