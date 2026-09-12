import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Alert, DeviceEventEmitter } from 'react-native';
import { AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { VN } from '@/types/vn';
import { vnRepository } from '@/database/repositories/vnRepository';
import { checkAudioFileExists } from './fileService';

export type SleepTimerOption = 'off' | '5m' | '10m' | '15m' | '30m' | '60m' | 'end_of_vn';

const SLEEP_TIMER_DURATIONS: Record<SleepTimerOption, number | null> = {
  off: null,
  '5m': 5 * 60,
  '10m': 10 * 60,
  '15m': 15 * 60,
  '30m': 30 * 60,
  '60m': 60 * 60,
  end_of_vn: null,
};

export const SUPPORTED_SPEEDS = [0.75, 1.0, 1.25, 1.5, 2.0] as const;
export type PlaybackSpeed = (typeof SUPPORTED_SPEEDS)[number];

export type RepeatMode = 'off' | 'all' | 'one';
export type PlaybackContextType = 'album' | 'liked' | 'pinned' | 'all' | 'search';

export interface PlaybackContext {
  type: PlaybackContextType;
  id?: string;
  title?: string;
  items: VN[];
}

interface AudioContextType {
  currentVn: VN | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  isLooping: boolean;
  repeatMode: RepeatMode;
  playbackRate: PlaybackSpeed;
  sleepTimerType: SleepTimerOption;
  sleepTimerRemaining: number | null;
  manualQueue: VN[];
  playbackContext: PlaybackContext | null;
  playVn: (vn: VN, startPosition?: number, newContext?: PlaybackContext) => Promise<void>;
  pause: () => void;
  resume: () => void;
  togglePlayPause: () => void;
  toggleLoop: () => void;
  setRepeatMode: (mode: RepeatMode) => void;
  cycleRepeatMode: () => void;
  setPlaybackRate: (rate: PlaybackSpeed) => void;
  setSleepTimer: (option: SleepTimerOption) => void;
  seekTo: (seconds: number) => Promise<void>;
  stop: () => void;
  updateCurrentVnMetadata: (updates: Partial<VN>) => void;
  stopIfPlaying: (vnId: string) => void;
  setPlaybackContext: (context: PlaybackContext) => void;
  addToQueue: (vn: VN) => { success: boolean; message: string };
  playNext: (vn: VN) => { success: boolean; message: string };
  removeFromQueue: (vnId: string) => void;
  clearQueue: () => void;
  moveQueueItem: (fromIndex: number, direction: 'up' | 'down') => void;
  playNextTrack: (fromSwipe?: boolean) => Promise<void>;
  playPreviousTrack: (forcePrevious?: boolean) => Promise<void>;
}

const AudioContext = createContext<AudioContextType | null>(null);

export function AudioPlayerProvider({ children }: { children: React.ReactNode }) {
  const [currentVn, setCurrentVn] = useState<VN | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [repeatMode, setRepeatModeState] = useState<RepeatMode>('all');
  const [playbackRate, setPlaybackRateState] = useState<PlaybackSpeed>(1.0);
  const [sleepTimerType, setSleepTimerType] = useState<SleepTimerOption>('off');
  const [sleepTimerRemaining, setSleepTimerRemaining] = useState<number | null>(null);
  const [manualQueue, setManualQueue] = useState<VN[]>([]);
  const [playbackContext, setPlaybackContextState] = useState<PlaybackContext | null>(null);

  const playerRef = useRef<AudioPlayer | null>(null);
  const subscriptionRef = useRef<{ remove: () => void } | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const didJustFinishRef = useRef(false);
  const isBusyRef = useRef(false);

  const repeatModeRef = useRef<RepeatMode>('all');
  repeatModeRef.current = repeatMode;

  const isLooping = repeatMode === 'one';
  const isLoopingRef = useRef(false);
  isLoopingRef.current = isLooping;

  const playbackRateRef = useRef<PlaybackSpeed>(1.0);
  playbackRateRef.current = playbackRate;

  const sleepTimerTypeRef = useRef<SleepTimerOption>('off');
  sleepTimerTypeRef.current = sleepTimerType;

  const currentVnRef = useRef<VN | null>(null);
  currentVnRef.current = currentVn;

  const currentTimeRef = useRef(0);
  currentTimeRef.current = currentTime;

  const durationRef = useRef(0);
  durationRef.current = duration;

  const lastSavedPositionRef = useRef(0);

  const manualQueueRef = useRef<VN[]>([]);
  manualQueueRef.current = manualQueue;

  const playbackContextRef = useRef<PlaybackContext | null>(null);
  playbackContextRef.current = playbackContext;

  const stopRef = useRef<() => void>(() => {});

  useEffect(() => {
    // Configure audio mode for offline local playback
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    }).catch((err) => console.warn('Could not set audio mode:', err));

    // Listen to global VN deletion events to clear player and queue immediately
    const delSub = DeviceEventEmitter.addListener('vn_deleted', (deletedId: string) => {
      setManualQueue((prev) => prev.filter((v) => v.id !== deletedId));
      setPlaybackContextState((prev) =>
        prev ? { ...prev, items: prev.items.filter((v) => v.id !== deletedId) } : null
      );
      if (currentVnRef.current?.id === deletedId) {
        stopRef.current();
      }
    });

    // Listen to global metadata update events
    const metaSub = DeviceEventEmitter.addListener(
      'vn_metadata_updated',
      ({ id, updates }: { id: string; updates: Partial<VN> }) => {
        setManualQueue((prev) =>
          prev.map((v) => (v.id === id ? { ...v, ...updates } : v))
        );
        setPlaybackContextState((prev) =>
          prev
            ? { ...prev, items: prev.items.map((v) => (v.id === id ? { ...v, ...updates } : v)) }
            : null
        );
        if (currentVnRef.current?.id === id) {
          setCurrentVn((prev) => (prev ? { ...prev, ...updates } : null));
        }
      }
    );

    return () => {
      delSub.remove();
      metaSub.remove();
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
      cleanupPlayer();
    };
  }, []);

  function cleanupPlayer() {
    if (subscriptionRef.current) {
      subscriptionRef.current.remove();
      subscriptionRef.current = null;
    }
    if (playerRef.current) {
      try {
        playerRef.current.pause();
        playerRef.current.remove();
      } catch (e) {
        console.warn('Error during player cleanup:', e);
      }
      playerRef.current = null;
    }
    didJustFinishRef.current = false;
  }

  const updateCurrentVnMetadata = (updates: Partial<VN>) => {
    setCurrentVn((prev) => (prev ? { ...prev, ...updates } : null));
    setManualQueue((prev) =>
      prev.map((v) => (v.id === currentVnRef.current?.id ? { ...v, ...updates } : v))
    );
    setPlaybackContextState((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map((v) =>
              v.id === currentVnRef.current?.id ? { ...v, ...updates } : v
            ),
          }
        : null
    );
  };

  const stopIfPlaying = (vnId: string) => {
    if (currentVnRef.current?.id === vnId) {
      stop();
    }
  };

  const setPlaybackRate = (rate: PlaybackSpeed) => {
    setPlaybackRateState(rate);
    playbackRateRef.current = rate;
    if (playerRef.current) {
      try {
        playerRef.current.setPlaybackRate(rate);
      } catch (e) {
        console.warn('Error setting playback rate on active player:', e);
      }
    }
  };

  const setRepeatMode = (mode: RepeatMode) => {
    setRepeatModeState(mode);
    repeatModeRef.current = mode;
    const looping = mode === 'one';
    isLoopingRef.current = looping;
    if (playerRef.current) {
      try {
        playerRef.current.loop = looping;
      } catch (e) {
        console.warn('Could not set player.loop:', e);
      }
    }
  };

  const cycleRepeatMode = () => {
    const nextMode: RepeatMode =
      repeatModeRef.current === 'off' ? 'all' : repeatModeRef.current === 'all' ? 'one' : 'off';
    setRepeatMode(nextMode);
  };

  const toggleLoop = () => {
    // Unifies existing toggleLoop with repeatMode
    if (repeatModeRef.current === 'one') {
      setRepeatMode('off');
    } else {
      setRepeatMode('one');
    }
  };

  const setSleepTimer = (option: SleepTimerOption) => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }

    setSleepTimerType(option);
    sleepTimerTypeRef.current = option;

    // If End of VN is selected, prevent native player from silently auto-repeating
    if (option === 'end_of_vn') {
      if (playerRef.current) {
        try {
          playerRef.current.loop = false;
        } catch (e) {
          console.warn('Could not set player.loop = false for end_of_vn timer:', e);
        }
      }
    } else if (isLoopingRef.current && playerRef.current) {
      try {
        playerRef.current.loop = true;
      } catch (e) {
        console.warn('Could not restore player.loop:', e);
      }
    }

    const seconds = SLEEP_TIMER_DURATIONS[option];
    if (seconds === null) {
      setSleepTimerRemaining(null);
      return;
    }

    setSleepTimerRemaining(seconds);
    const targetEndTime = Date.now() + seconds * 1000;

    timerIntervalRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.round((targetEndTime - Date.now()) / 1000));
      if (remaining <= 0) {
        if (timerIntervalRef.current) {
          clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;
        }
        setSleepTimerType('off');
        sleepTimerTypeRef.current = 'off';
        setSleepTimerRemaining(null);
        pause();
      } else {
        setSleepTimerRemaining(remaining);
      }
    }, 1000);
  };

  const setPlaybackContext = (context: PlaybackContext) => {
    setPlaybackContextState(context);
    playbackContextRef.current = context;
  };

  const addToQueue = (vn: VN): { success: boolean; message: string } => {
    if (manualQueueRef.current.some((item) => item.id === vn.id)) {
      return { success: false, message: 'Already in queue' };
    }
    setManualQueue((prev) => [...prev, vn]);
    return { success: true, message: `Added "${vn.title}" to queue` };
  };

  const playNext = (vn: VN): { success: boolean; message: string } => {
    setManualQueue((prev) => [vn, ...prev.filter((item) => item.id !== vn.id)]);
    return { success: true, message: `"${vn.title}" will play next` };
  };

  const removeFromQueue = (vnId: string) => {
    setManualQueue((prev) => prev.filter((item) => item.id !== vnId));
  };

  const clearQueue = () => {
    setManualQueue([]);
  };

  const moveQueueItem = (fromIndex: number, direction: 'up' | 'down') => {
    setManualQueue((prev) => {
      const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
      if (toIndex < 0 || toIndex >= prev.length) return prev;
      const next = [...prev];
      const item = next.splice(fromIndex, 1)[0];
      next.splice(toIndex, 0, item);
      return next;
    });
  };

  // Internal playback execution helper
  const playInternal = async (
    vn: VN,
    startPosition: number = 0,
    newContext?: PlaybackContext
  ) => {
    if (newContext) {
      setPlaybackContextState(newContext);
      playbackContextRef.current = newContext;
    } else if (!playbackContextRef.current) {
      // Default to All Songs context if none is active
      try {
        const allVns = await vnRepository.getAllVns();
        const defaultCtx: PlaybackContext = {
          type: 'all',
          title: 'All Voice Notes',
          items: allVns,
        };
        setPlaybackContextState(defaultCtx);
        playbackContextRef.current = defaultCtx;
      } catch (err) {
        console.warn('Could not populate default playback context:', err);
      }
    }

    // Verify local file exists before playing
    if (!checkAudioFileExists(vn.fileUri)) {
      isBusyRef.current = false;
      Alert.alert(
        'File Unavailable',
        `Couldn't play "${vn.title}" because its local audio file is unavailable. Skipping to next valid track.`,
        [{ text: 'OK' }]
      );
      // Skip to next track safely
      await playNextTrack();
      return;
    }

    // Save previous track's position if applicable
    if (
      currentVnRef.current &&
      currentVnRef.current.id !== vn.id &&
      currentTimeRef.current > 2 &&
      durationRef.current &&
      currentTimeRef.current < durationRef.current - 2
    ) {
      vnRepository.updateLastPosition(currentVnRef.current.id, currentTimeRef.current).catch(() => {});
    }

    cleanupPlayer();
    setCurrentVn(vn);
    const initialPos =
      startPosition > 1 && vn.duration && startPosition < vn.duration - 2 ? startPosition : 0;
    setCurrentTime(initialPos);
    currentTimeRef.current = initialPos;
    lastSavedPositionRef.current = initialPos;
    setDuration(vn.duration || 0);

    try {
      const player = createAudioPlayer({ uri: vn.fileUri }, { updateInterval: 250 });
      try {
        player.loop = isLoopingRef.current;
      } catch (e) {
        console.warn('Could not set initial player.loop:', e);
      }

      try {
        player.setPlaybackRate(playbackRateRef.current);
      } catch (e) {
        console.warn('Could not set initial player.playbackRate:', e);
      }

      playerRef.current = player;
      didJustFinishRef.current = false;

      if (initialPos > 0) {
        try {
          await player.seekTo(initialPos);
        } catch (seekErr) {
          console.warn('Could not seek to initial resume position:', seekErr);
        }
      }

      const sub = player.addListener('playbackStatusUpdate', (status) => {
        if (status.isLoaded) {
          setIsPlaying(status.playing);
          setCurrentTime(status.currentTime || 0);
          currentTimeRef.current = status.currentTime || 0;

          if (status.duration && status.duration > 0) {
            setDuration(status.duration);
            durationRef.current = status.duration;
          }

          // Throttled Continue Listening persistence: save progress every ~4s of playback
          if (
            status.playing &&
            status.currentTime > 2 &&
            status.duration &&
            status.currentTime < status.duration - 2
          ) {
            if (Math.abs(status.currentTime - lastSavedPositionRef.current) >= 4) {
              lastSavedPositionRef.current = status.currentTime;
              vnRepository.updateLastPosition(vn.id, status.currentTime).catch(() => {});
            }
          }

          if (status.didJustFinish) {
            handleTrackFinish(vn);
          }
        }
      });
      subscriptionRef.current = sub;

      player.play();
      setIsPlaying(true);
    } catch (err: any) {
      Alert.alert('Playback Error', err?.message || 'Failed to play this audio file.');
      cleanupPlayer();
      setCurrentVn(null);
      setIsPlaying(false);
    } finally {
      isBusyRef.current = false;
    }
  };

  // Automatic transition when track naturally finishes
  const handleTrackFinish = async (finishedVn: VN) => {
    // 1. Sleep timer "End of VN" takes priority
    if (sleepTimerTypeRef.current === 'end_of_vn') {
      setSleepTimer('off');
      didJustFinishRef.current = true;
      setIsPlaying(false);
      setCurrentTime(0);
      currentTimeRef.current = 0;
      lastSavedPositionRef.current = 0;
      vnRepository.clearLastPosition(finishedVn.id).catch(() => {});
      DeviceEventEmitter.emit('library_updated');
      return;
    }

    // 2. Repeat One takes next priority
    if (repeatModeRef.current === 'one') {
      if (playerRef.current) {
        try {
          await playerRef.current.seekTo(0);
          playerRef.current.play();
          setIsPlaying(true);
          setCurrentTime(0);
          currentTimeRef.current = 0;
          lastSavedPositionRef.current = 0;
          vnRepository.clearLastPosition(finishedVn.id).catch(() => {});
          DeviceEventEmitter.emit('library_updated');
          return;
        } catch (loopErr) {
          console.warn('Error during repeat one replay:', loopErr);
        }
      }
    }

    // Clear progress for naturally completed track
    vnRepository.clearLastPosition(finishedVn.id).catch(() => {});
    DeviceEventEmitter.emit('library_updated');

    // 3. Manual Queue has next priority
    if (manualQueueRef.current.length > 0) {
      const nextVn = manualQueueRef.current[0];
      setManualQueue((prev) => prev.slice(1));
      await playInternal(nextVn, 0);
      return;
    }

    // 4. Current Playback Context continuation
    const context = playbackContextRef.current;
    if (context && context.items.length > 0) {
      const currentIndex = context.items.findIndex((v) => v.id === finishedVn.id);
      if (currentIndex !== -1 && currentIndex + 1 < context.items.length) {
        const nextVn = context.items[currentIndex + 1];
        await playInternal(nextVn, 0);
        return;
      } else if (repeatModeRef.current === 'all') {
        // Wrap to the beginning of the context
        const firstVn = context.items[0];
        await playInternal(firstVn, 0);
        return;
      }
    }

    // 5. Repeat Off or end of context reached with no repeat
    didJustFinishRef.current = true;
    setIsPlaying(false);
    setCurrentTime(0);
    currentTimeRef.current = 0;
    lastSavedPositionRef.current = 0;
  };

  const playVn = async (vn: VN, startPosition?: number, newContext?: PlaybackContext) => {
    // If the same VN is already loaded, toggle pause/resume or handle seek
    if (currentVnRef.current?.id === vn.id && playerRef.current) {
      if (isPlaying) {
        pause();
        return;
      }
      if (
        startPosition !== undefined &&
        startPosition > 0 &&
        Math.abs(currentTimeRef.current - startPosition) > 2
      ) {
        await seekTo(startPosition);
      }
      resume();
      return;
    }

    if (isBusyRef.current) return;
    isBusyRef.current = true;

    await playInternal(vn, startPosition || 0, newContext);
  };

  const playNextTrack = async (fromSwipe: boolean = false) => {
    if (isBusyRef.current) return;

    // Repeat One rule: do NOT move to another song
    if (repeatModeRef.current === 'one' && currentVnRef.current) {
      if (playerRef.current) {
        try {
          await playerRef.current.seekTo(0);
          playerRef.current.play();
          setIsPlaying(true);
          setCurrentTime(0);
          currentTimeRef.current = 0;
        } catch (e) {
          console.warn('Error in repeat-one Next:', e);
        }
      }
      return;
    }

    isBusyRef.current = true;

    // 1. Manual Queue priority
    if (manualQueueRef.current.length > 0) {
      const nextVn = manualQueueRef.current[0];
      setManualQueue((prev) => prev.slice(1));
      await playInternal(nextVn, 0);
      return;
    }

    // 2. Playback Context priority
    const context = playbackContextRef.current;
    if (context && context.items.length > 0) {
      const currentId = currentVnRef.current?.id;
      const currentIndex = currentId
        ? context.items.findIndex((v) => v.id === currentId)
        : -1;

      if (currentIndex !== -1 && currentIndex + 1 < context.items.length) {
        await playInternal(context.items[currentIndex + 1], 0);
        return;
      } else if (repeatModeRef.current === 'all') {
        await playInternal(context.items[0], 0);
        return;
      } else if (repeatModeRef.current === 'off') {
        // Stop cleanly at end
        pause();
        isBusyRef.current = false;
        return;
      }
    } else {
      // Fallback: load all VNs if no context
      try {
        const allVns = await vnRepository.getAllVns();
        if (allVns.length > 0) {
          const currentId = currentVnRef.current?.id;
          const idx = currentId ? allVns.findIndex((v) => v.id === currentId) : -1;
          const nextIdx = idx !== -1 && idx + 1 < allVns.length ? idx + 1 : 0;
          await playInternal(allVns[nextIdx], 0, {
            type: 'all',
            title: 'All Voice Notes',
            items: allVns,
          });
          return;
        }
      } catch (err) {
        console.warn('Fallback playNextTrack failed:', err);
      }
    }

    isBusyRef.current = false;
  };

  const playPreviousTrack = async (forcePrevious: boolean = false) => {
    if (isBusyRef.current) return;

    // Standard player rule: If current position > 3s and not forcing previous, restart track
    if (!forcePrevious && currentTimeRef.current > 3 && playerRef.current) {
      try {
        await playerRef.current.seekTo(0);
        setCurrentTime(0);
        currentTimeRef.current = 0;
      } catch (e) {
        console.warn('Error seeking to 0 on previous:', e);
      }
      return;
    }

    isBusyRef.current = true;

    // Check context for previous track
    const context = playbackContextRef.current;
    if (context && context.items.length > 0) {
      const currentId = currentVnRef.current?.id;
      const currentIndex = currentId
        ? context.items.findIndex((v) => v.id === currentId)
        : -1;

      if (currentIndex > 0) {
        await playInternal(context.items[currentIndex - 1], 0);
        return;
      } else if (currentIndex === 0) {
        if (repeatModeRef.current === 'all') {
          await playInternal(context.items[context.items.length - 1], 0);
          return;
        } else {
          // Stay on first track and seek to 0
          if (playerRef.current) {
            await playerRef.current.seekTo(0);
            setCurrentTime(0);
            currentTimeRef.current = 0;
          }
          isBusyRef.current = false;
          return;
        }
      }
    }

    // Default fallback: restart current track
    if (playerRef.current) {
      try {
        await playerRef.current.seekTo(0);
        setCurrentTime(0);
        currentTimeRef.current = 0;
      } catch {}
    }
    isBusyRef.current = false;
  };

  const pause = () => {
    if (playerRef.current) {
      playerRef.current.pause();
      setIsPlaying(false);

      // Save position immediately when paused
      if (
        currentVnRef.current &&
        currentTimeRef.current > 2 &&
        durationRef.current &&
        currentTimeRef.current < durationRef.current - 2
      ) {
        lastSavedPositionRef.current = currentTimeRef.current;
        vnRepository
          .updateLastPosition(currentVnRef.current.id, currentTimeRef.current)
          .catch(() => {});
        DeviceEventEmitter.emit('library_updated');
      }
    }
  };

  const resume = async () => {
    if (playerRef.current) {
      try {
        // If reached the end or finished, seek to start before replaying
        if (didJustFinishRef.current || (duration > 0 && currentTime >= duration - 0.5)) {
          await playerRef.current.seekTo(0);
          setCurrentTime(0);
          currentTimeRef.current = 0;
          didJustFinishRef.current = false;
        }
        playerRef.current.play();
        setIsPlaying(true);
      } catch (err) {
        console.warn('Error resuming playback:', err);
      }
    } else if (currentVnRef.current) {
      await playInternal(currentVnRef.current, currentTimeRef.current);
    }
  };

  const togglePlayPause = () => {
    if (isPlaying) {
      pause();
    } else {
      resume();
    }
  };

  const seekTo = async (seconds: number) => {
    if (playerRef.current) {
      try {
        didJustFinishRef.current = false;
        await playerRef.current.seekTo(seconds);
        setCurrentTime(seconds);
        currentTimeRef.current = seconds;
        lastSavedPositionRef.current = seconds;
        if (currentVnRef.current) {
          vnRepository.updateLastPosition(currentVnRef.current.id, seconds).catch(() => {});
        }
      } catch (err) {
        console.warn('Seek error:', err);
      }
    }
  };

  const stop = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    setSleepTimerType('off');
    sleepTimerTypeRef.current = 'off';
    setSleepTimerRemaining(null);

    // If stopping before finish, preserve lastPosition if meaningful
    if (
      currentVnRef.current &&
      currentTimeRef.current > 2 &&
      durationRef.current &&
      currentTimeRef.current < durationRef.current - 2
    ) {
      vnRepository.updateLastPosition(currentVnRef.current.id, currentTimeRef.current).catch(() => {});
      DeviceEventEmitter.emit('library_updated');
    }
    cleanupPlayer();
    setCurrentVn(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  };
  stopRef.current = stop;

  return (
    <AudioContext.Provider
      value={{
        currentVn,
        isPlaying,
        currentTime,
        duration,
        isLooping,
        repeatMode,
        playbackRate,
        sleepTimerType,
        sleepTimerRemaining,
        manualQueue,
        playbackContext,
        playVn,
        pause,
        resume,
        togglePlayPause,
        toggleLoop,
        setRepeatMode,
        cycleRepeatMode,
        setPlaybackRate,
        setSleepTimer,
        seekTo,
        stop,
        updateCurrentVnMetadata,
        stopIfPlaying,
        setPlaybackContext,
        addToQueue,
        playNext,
        removeFromQueue,
        clearQueue,
        moveQueueItem,
        playNextTrack,
        playPreviousTrack,
      }}>
      {children}
    </AudioContext.Provider>
  );
}

export function useAudio() {
  const context = useContext(AudioContext);
  if (!context) {
    throw new Error('useAudio must be used within an AudioPlayerProvider');
  }
  return context;
}

