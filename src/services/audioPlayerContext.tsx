import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, DeviceEventEmitter, Platform } from 'react-native';
import { AudioPlayer, createAudioPlayer, setAudioModeAsync, requestNotificationPermissionsAsync } from 'expo-audio';
import Constants from 'expo-constants';
import { VN } from '@/types/vn';
import { vnRepository } from '@/database/repositories/vnRepository';
import { recentlyPlayedRepository } from '@/database/repositories/recentlyPlayedRepository';
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
export type PlaybackContextType = 'album' | 'liked' | 'pinned' | 'all' | 'recent' | 'search' | 'single';

export interface PlaybackContext {
  type: PlaybackContextType;
  id?: string;
  title?: string;
  items: VN[];
}

export interface AudioState {
  currentVn: VN | null;
  isPlaying: boolean;
  isLooping: boolean;
  repeatMode: RepeatMode;
  isShuffle: boolean;
  shuffledOrder: number[];
  playbackRate: PlaybackSpeed;
  sleepTimerType: SleepTimerOption;
  sleepTimerRemaining: number | null;
  manualQueue: VN[];
  playbackContext: PlaybackContext | null;
}

export interface AudioProgress {
  currentTime: number;
  duration: number;
}

export interface AudioActions {
  playVn: (vn: VN, startPosition?: number, newContext?: PlaybackContext) => Promise<void>;
  pause: () => void;
  resume: () => void;
  togglePlayPause: () => void;
  toggleLoop: () => void;
  setRepeatMode: (mode: RepeatMode) => void;
  cycleRepeatMode: () => void;
  toggleShuffle: () => void;
  shuffleAll: (allVns?: VN[], customContext?: PlaybackContext) => Promise<void>;
  addAlbumToQueue: (vns: VN[]) => { success: boolean; addedCount: number };
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

export type AudioContextType = AudioState & AudioProgress & AudioActions;

const AudioStateContext = createContext<AudioState | null>(null);
const AudioProgressContext = createContext<AudioProgress | null>(null);
const AudioActionsContext = createContext<AudioActions | null>(null);

function generateShuffledOrder(count: number, startIndex: number = 0): number[] {
  if (count <= 1) return [0];
  const indices = Array.from({ length: count }, (_, i) => i);
  if (startIndex >= 0 && startIndex < count) {
    indices.splice(startIndex, 1);
    indices.unshift(startIndex);
  }
  for (let i = indices.length - 1; i > 1; i--) {
    const j = 1 + Math.floor(Math.random() * i);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

function generateReshuffledOrder(count: number, lastPlayedIndex: number): number[] {
  if (count <= 1) return [0];
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (order[0] === lastPlayedIndex && count > 1) {
    const swapWith = 1 + Math.floor(Math.random() * (count - 1));
    [order[0], order[swapWith]] = [order[swapWith], order[0]];
  }
  return order;
}

export function AudioPlayerProvider({ children }: { children: React.ReactNode }) {
  // Authoritative State
  const [currentVn, setCurrentVn] = useState<VN | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [repeatMode, setRepeatModeState] = useState<RepeatMode>('all');
  const [isShuffle, setIsShuffle] = useState(false);
  const [shuffledOrder, setShuffledOrder] = useState<number[]>([]);
  const [playbackRate, setPlaybackRateState] = useState<PlaybackSpeed>(1.0);
  const [sleepTimerType, setSleepTimerType] = useState<SleepTimerOption>('off');
  const [sleepTimerRemaining, setSleepTimerRemaining] = useState<number | null>(null);
  const [manualQueue, setManualQueue] = useState<VN[]>([]);
  const [playbackContext, setPlaybackContextState] = useState<PlaybackContext | null>(null);

  // Authoritative Refs for synchronous and background operations
  const playerRef = useRef<AudioPlayer | null>(null);
  const subscriptionRef = useRef<{ remove: () => void } | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const didJustFinishRef = useRef(false);

  // Transition token to eliminate async race conditions across rapid Next/Prev commands
  const transitionTokenRef = useRef(0);

  const isPlayingRef = useRef(false);
  isPlayingRef.current = isPlaying;

  const repeatModeRef = useRef<RepeatMode>('all');
  repeatModeRef.current = repeatMode;

  const isShuffleRef = useRef(false);
  isShuffleRef.current = isShuffle;

  const shuffledOrderRef = useRef<number[]>([]);
  shuffledOrderRef.current = shuffledOrder;

  const shufflePointerRef = useRef(0);
  const recordedRecentForTrackRef = useRef<string | null>(null);
  const isLockScreenActiveRef = useRef(false);

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

  // Track playback history stack (recent 50 played VN IDs) for deterministic Previous navigation
  const playbackHistoryRef = useRef<string[]>([]);
  const lastContextIndexRef = useRef<number>(-1);
  const clearedVnIdRef = useRef<string | null>(null);

  const stopRef = useRef<() => void>(() => {});
  const pauseRef = useRef<() => void>(() => {});
  const resumeRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const seekToRef = useRef<(sec: number) => Promise<void>>(() => Promise.resolve());
  const playInternalRef = useRef<
    (vn: VN, startPos?: number, ctx?: PlaybackContext, token?: number) => Promise<void>
  >(() => Promise.resolve());
  const resolveNextTrackRef = useRef<(manual?: boolean) => Promise<void>>(() => Promise.resolve());
  const resolvePreviousTrackRef = useRef<(force?: boolean) => Promise<void>>(() => Promise.resolve());
  const playNextTrackRef = useRef<(_fromSwipe?: boolean) => Promise<void>>(() => Promise.resolve());

  const addToHistory = useCallback((vnId: string) => {
    const hist = playbackHistoryRef.current;
    if (hist.length === 0 || hist[hist.length - 1] !== vnId) {
      playbackHistoryRef.current = [...hist.slice(-49), vnId];
    }
  }, []);

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    }).catch((err) => console.warn('Could not set audio mode:', err));

    if (Platform.OS === 'android') {
      requestNotificationPermissionsAsync().catch((err) => {
        console.warn('Could not request notification permissions:', err);
      });
    }

    const delSub = DeviceEventEmitter.addListener('vn_deleted', (deletedId: string) => {
      manualQueueRef.current = manualQueueRef.current.filter((v) => v.id !== deletedId);
      setManualQueue(manualQueueRef.current);
      setPlaybackContextState((prev) => {
        if (!prev) return null;
        const updated = { ...prev, items: prev.items.filter((v) => v.id !== deletedId) };
        playbackContextRef.current = updated;
        return updated;
      });
      playbackHistoryRef.current = playbackHistoryRef.current.filter((id) => id !== deletedId);

      if (currentVnRef.current?.id === deletedId) {
        // Current playing VN was deleted: stop player and advance to next valid track without replaying deleted VN
        cleanupPlayer();
        currentVnRef.current = null;
        setCurrentVn(null);
        setIsPlaying(false);
        isPlayingRef.current = false;
        setCurrentTime(0);
        currentTimeRef.current = 0;
        lastSavedPositionRef.current = 0;
        resolveNextTrackRef.current(true);
      }
    });

    const metaSub = DeviceEventEmitter.addListener(
      'vn_metadata_updated',
      ({ id, updates }: { id: string; updates: Partial<VN> }) => {
        manualQueueRef.current = manualQueueRef.current.map((v) =>
          v.id === id ? { ...v, ...updates } : v
        );
        setManualQueue(manualQueueRef.current);

        setPlaybackContextState((prev) => {
          if (!prev) return null;
          const updated = {
            ...prev,
            items: prev.items.map((v) => (v.id === id ? { ...v, ...updates } : v)),
          };
          playbackContextRef.current = updated;
          return updated;
        });

        if (currentVnRef.current?.id === id) {
          setCurrentVn((prev) => (prev ? { ...prev, ...updates } : null));
          if (isLockScreenActiveRef.current && playerRef.current) {
            try {
              playerRef.current.updateLockScreenMetadata({
                title: updates.title || currentVnRef.current?.title || 'Voice Note',
                artist: 'Our Voice',
                albumTitle: playbackContextRef.current?.title || 'Our Voice',
              });
            } catch (err) {
              console.warn('Could not update lock screen metadata on rename event:', err);
            }
          }
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
      if (isLockScreenActiveRef.current) {
        try {
          playerRef.current.clearLockScreenControls();
        } catch {}
        isLockScreenActiveRef.current = false;
      }
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

  const updateCurrentVnMetadata = useCallback((updates: Partial<VN>) => {
    setCurrentVn((prev) => (prev ? { ...prev, ...updates } : null));
    manualQueueRef.current = manualQueueRef.current.map((v) =>
      v.id === currentVnRef.current?.id ? { ...v, ...updates } : v
    );
    setManualQueue(manualQueueRef.current);

    setPlaybackContextState((prev) => {
      if (!prev) return null;
      const updated = {
        ...prev,
        items: prev.items.map((v) =>
          v.id === currentVnRef.current?.id ? { ...v, ...updates } : v
        ),
      };
      playbackContextRef.current = updated;
      return updated;
    });

    if (isLockScreenActiveRef.current && playerRef.current) {
      try {
        playerRef.current.updateLockScreenMetadata({
          title: updates.title || currentVnRef.current?.title || 'Voice Note',
          artist: 'Our Voice',
          albumTitle: playbackContextRef.current?.title || 'Our Voice',
        });
      } catch {}
    }
  }, []);

  const setPlaybackRate = useCallback((rate: PlaybackSpeed) => {
    setPlaybackRateState(rate);
    playbackRateRef.current = rate;
    if (playerRef.current) {
      try {
        playerRef.current.setPlaybackRate(rate);
      } catch (e) {
        console.warn('Error setting playback rate on active player:', e);
      }
    }
  }, []);

  const setRepeatMode = useCallback((mode: RepeatMode) => {
    setRepeatModeState(mode);
    repeatModeRef.current = mode;
    isLoopingRef.current = mode === 'one';
    // Semantics: JS authoritative engine controls repeats.
    // player.loop is intentionally kept false so expo-audio emits didJustFinish cleanly on Android.
    if (playerRef.current) {
      try {
        playerRef.current.loop = false;
      } catch {}
    }
  }, []);

  const cycleRepeatMode = useCallback(() => {
    const nextMode: RepeatMode =
      repeatModeRef.current === 'off' ? 'all' : repeatModeRef.current === 'all' ? 'one' : 'off';
    setRepeatMode(nextMode);
  }, [setRepeatMode]);

  const toggleLoop = useCallback(() => {
    if (repeatModeRef.current === 'one') {
      setRepeatMode('off');
    } else {
      setRepeatMode('one');
    }
  }, [setRepeatMode]);

  const setSleepTimer = useCallback((option: SleepTimerOption) => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }

    setSleepTimerType(option);
    sleepTimerTypeRef.current = option;

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
        pauseRef.current();
      } else {
        setSleepTimerRemaining(remaining);
      }
    }, 1000);
  }, []);

  const toggleShuffle = useCallback(() => {
    const nextState = !isShuffleRef.current;
    setIsShuffle(nextState);
    isShuffleRef.current = nextState;

    if (nextState && playbackContextRef.current && playbackContextRef.current.items.length > 0) {
      const items = playbackContextRef.current.items;
      const currentId = currentVnRef.current?.id;
      const startIdx = currentId ? items.findIndex((v) => v.id === currentId) : 0;
      if (startIdx !== -1) {
        lastContextIndexRef.current = startIdx;
      }
      const order = generateShuffledOrder(items.length, startIdx >= 0 ? startIdx : 0);
      shuffledOrderRef.current = order;
      setShuffledOrder(order);
      shufflePointerRef.current = 0;
    }
  }, []);

  const setPlaybackContext = useCallback((context: PlaybackContext) => {
    setPlaybackContextState(context);
    playbackContextRef.current = context;
    const currentId = currentVnRef.current?.id;
    const startIdx = currentId ? context.items.findIndex((v) => v.id === currentId) : 0;
    if (startIdx !== -1) {
      lastContextIndexRef.current = startIdx;
    }
    if (isShuffleRef.current && context.items.length > 0) {
      const order = generateShuffledOrder(context.items.length, startIdx >= 0 ? startIdx : 0);
      shuffledOrderRef.current = order;
      setShuffledOrder(order);
      shufflePointerRef.current = 0;
    }
  }, []);

  const addAlbumToQueue = useCallback((vns: VN[]): { success: boolean; addedCount: number } => {
    if (!vns || vns.length === 0) {
      return { success: false, addedCount: 0 };
    }
    const existingQueueIds = new Set(manualQueueRef.current.map((v) => v.id));
    const toAdd = vns.filter((v) => !existingQueueIds.has(v.id));
    if (toAdd.length === 0) {
      return { success: false, addedCount: 0 };
    }
    const updated = [...manualQueueRef.current, ...toAdd];
    manualQueueRef.current = updated;
    setManualQueue(updated);
    return { success: true, addedCount: toAdd.length };
  }, []);

  const addToQueue = useCallback((vn: VN): { success: boolean; message: string } => {
    if (manualQueueRef.current.some((item) => item.id === vn.id)) {
      return { success: false, message: 'Already in queue' };
    }
    const updated = [...manualQueueRef.current, vn];
    manualQueueRef.current = updated;
    setManualQueue(updated);
    return { success: true, message: `Added "${vn.title}" to queue` };
  }, []);

  const playNext = useCallback((vn: VN): { success: boolean; message: string } => {
    const filtered = manualQueueRef.current.filter((item) => item.id !== vn.id);
    const updated = [vn, ...filtered];
    manualQueueRef.current = updated;
    setManualQueue(updated);
    return { success: true, message: `"${vn.title}" will play next` };
  }, []);

  const removeFromQueue = useCallback((vnId: string) => {
    const updated = manualQueueRef.current.filter((item) => item.id !== vnId);
    manualQueueRef.current = updated;
    setManualQueue(updated);
  }, []);

  const clearQueue = useCallback(() => {
    manualQueueRef.current = [];
    setManualQueue([]);
  }, []);

  const moveQueueItem = useCallback((fromIndex: number, direction: 'up' | 'down') => {
    const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
    const prev = manualQueueRef.current;
    if (toIndex < 0 || toIndex >= prev.length) return;
    const next = [...prev];
    const item = next.splice(fromIndex, 1)[0];
    next.splice(toIndex, 0, item);
    manualQueueRef.current = next;
    setManualQueue(next);
  }, []);

  // Internal playback execution helper guarded by transition token
  const playInternal = async (
    vn: VN,
    startPosition: number = 0,
    newContext?: PlaybackContext,
    assignedToken?: number
  ) => {
    const token = assignedToken ?? ++transitionTokenRef.current;

    if (newContext) {
      setPlaybackContextState(newContext);
      playbackContextRef.current = newContext;
      const idx = newContext.items.findIndex((item) => item.id === vn.id);
      if (idx !== -1) {
        lastContextIndexRef.current = idx;
      }
      if (isShuffleRef.current && newContext.items.length > 0) {
        const startIdx = newContext.items.findIndex((v) => v.id === vn.id);
        const order = generateShuffledOrder(newContext.items.length, startIdx >= 0 ? startIdx : 0);
        shuffledOrderRef.current = order;
        setShuffledOrder(order);
        shufflePointerRef.current = 0;
      }
    } else if (
      !playbackContextRef.current ||
      !playbackContextRef.current.items.some((item) => item.id === vn.id)
    ) {
      // Single VN fallback context: track does not belong to existing context.
      // Establish dedicated single context to prevent cross-context pollution!
      const singleContext: PlaybackContext = {
        type: 'single',
        id: vn.id,
        title: vn.title,
        items: [vn],
      };
      setPlaybackContextState(singleContext);
      playbackContextRef.current = singleContext;
      lastContextIndexRef.current = 0;
    } else {
      // vn is inside active playbackContextRef.current:
      const idx = playbackContextRef.current.items.findIndex((item) => item.id === vn.id);
      if (idx !== -1) {
        lastContextIndexRef.current = idx;
      }
      if (isShuffleRef.current && playbackContextRef.current.items.length > 0) {
        const orderIdx = shuffledOrderRef.current.indexOf(idx);
        if (orderIdx !== -1) {
          shufflePointerRef.current = orderIdx;
        }
      }
    }

    // Verify local file exists before playing
    if (!checkAudioFileExists(vn.fileUri)) {
      if (transitionTokenRef.current !== token) return;
      Alert.alert(
        'File Unavailable',
        `Couldn't play "${vn.title}" because its local audio file is unavailable. Skipping to next valid track.`,
        [{ text: 'OK' }]
      );
      await resolveNextTrack(false);
      return;
    }

    // Save previous track's position if applicable
    if (
      !didJustFinishRef.current &&
      currentVnRef.current &&
      currentVnRef.current.id !== vn.id &&
      clearedVnIdRef.current !== currentVnRef.current.id &&
      currentTimeRef.current > 2 &&
      durationRef.current &&
      currentTimeRef.current < durationRef.current - 2
    ) {
      vnRepository.updateLastPosition(currentVnRef.current.id, currentTimeRef.current).catch(() => {});
    }

    if (transitionTokenRef.current !== token) return;

    cleanupPlayer();
    clearedVnIdRef.current = null;
    didJustFinishRef.current = false;
    setCurrentVn(vn);
    currentVnRef.current = vn;

    const initialPos =
      startPosition > 1 && vn.duration && startPosition < vn.duration - 2 ? startPosition : 0;
    setCurrentTime(initialPos);
    currentTimeRef.current = initialPos;
    lastSavedPositionRef.current = initialPos;
    setDuration(vn.duration || 0);
    durationRef.current = vn.duration || 0;
    recordedRecentForTrackRef.current = null;

    try {
      const player = createAudioPlayer({ uri: vn.fileUri }, { updateInterval: 250 });

      // Keep native player.loop false so expo-audio status fires didJustFinish reliably on all devices
      try {
        player.loop = false;
      } catch {}

      try {
        player.setPlaybackRate(playbackRateRef.current);
      } catch (e) {
        console.warn('Could not set initial player.playbackRate:', e);
      }

      playerRef.current = player;
      didJustFinishRef.current = false;

      // Lock Screen & Notification media controls setup
      const isExpoGo = Constants.appOwnership === 'expo';
      if (!isExpoGo && typeof player.setActiveForLockScreen === 'function') {
        try {
          const activeTitle = (newContext || playbackContextRef.current)?.title || 'Our Voice';
          player.setActiveForLockScreen(
            true,
            {
              title: vn.title,
              artist: 'Our Voice',
              albumTitle: activeTitle,
            },
            {
              showSeekForward: true,
              showSeekBackward: true,
            }
          );
          isLockScreenActiveRef.current = true;
        } catch (lockErr) {
          isLockScreenActiveRef.current = false;
          console.warn('[LOCK SCREEN] Failed to set lock screen controls:', lockErr);
        }
      } else {
        isLockScreenActiveRef.current = false;
      }

      if (initialPos > 0) {
        try {
          await player.seekTo(initialPos);
        } catch (seekErr) {
          console.warn('Could not seek to initial resume position:', seekErr);
        }
      }

      if (transitionTokenRef.current !== token) {
        // Newer transition was requested while preparing player
        try {
          player.remove();
        } catch {}
        return;
      }

      const sub = player.addListener('playbackStatusUpdate', (status) => {
        if (status.isLoaded) {
          const wasPlaying = isPlayingRef.current;
          setIsPlaying(status.playing);
          isPlayingRef.current = status.playing;
          setCurrentTime(status.currentTime || 0);
          currentTimeRef.current = status.currentTime || 0;

          if (status.duration && status.duration > 0) {
            setDuration(status.duration);
            durationRef.current = status.duration;
          }

          // Immediate position save on pause
          if (wasPlaying && !status.playing && !status.didJustFinish && !didJustFinishRef.current) {
            if (
              vn.id !== clearedVnIdRef.current &&
              status.currentTime > 2 &&
              status.duration &&
              status.currentTime < status.duration - 2
            ) {
              lastSavedPositionRef.current = status.currentTime;
              vnRepository.updateLastPosition(vn.id, status.currentTime).catch(() => {});
              DeviceEventEmitter.emit('library_updated');
            }
          }

          // Throttled Continue Listening persistence: every ~5 seconds of continuous playback
          if (
            status.playing &&
            !status.didJustFinish &&
            !didJustFinishRef.current &&
            vn.id !== clearedVnIdRef.current &&
            status.currentTime > 2 &&
            status.duration &&
            status.currentTime < status.duration - 2
          ) {
            if (Math.abs(status.currentTime - lastSavedPositionRef.current) >= 5) {
              lastSavedPositionRef.current = status.currentTime;
              vnRepository.updateLastPosition(vn.id, status.currentTime).catch(() => {});
            }
          }

          // Record to Recently Played once playback reaches >= 3 seconds
          if (
            status.playing &&
            status.currentTime >= 3 &&
            recordedRecentForTrackRef.current !== vn.id
          ) {
            recordedRecentForTrackRef.current = vn.id;
            recentlyPlayedRepository.recordPlay(vn.id).catch(() => {});
          }

          if (status.didJustFinish) {
            didJustFinishRef.current = true;
            resolveNextTrack(false);
          }
        }
      });
      subscriptionRef.current = sub;

      player.play();
      setIsPlaying(true);
      isPlayingRef.current = true;
    } catch (err: any) {
      if (transitionTokenRef.current === token) {
        Alert.alert('Playback Error', err?.message || 'Failed to play this audio file.');
        cleanupPlayer();
        setCurrentVn(null);
        currentVnRef.current = null;
        setIsPlaying(false);
        isPlayingRef.current = false;
      }
    }
  };

  /**
   * PART 5 & 17 — Single Authoritative Next Track Decision Engine
   * Deterministic priority order:
   * 1. Sleep timer 'end_of_vn'
   * 2. Repeat One (replays current track on natural finish; on explicit Next without queue, replays track)
   * 3. Clear progress of finished track
   * 4. Manual Queue (strict FIFO / insertion order, skips missing files safely)
   * 5. Playback Context (Shuffle cycle or Sequential order, respecting Repeat All / Off)
   * 6. Clean Stop if nothing playable remains
   */
  const resolveNextTrack = async (isManualNext: boolean = false) => {
    const currentToken = ++transitionTokenRef.current;
    const current = currentVnRef.current;

    // Record to Recently Played if finished before 3 seconds
    if (current && recordedRecentForTrackRef.current !== current.id) {
      recordedRecentForTrackRef.current = current.id;
      recentlyPlayedRepository.recordPlay(current.id).catch(() => {});
    }

    // 1. Sleep timer "End of VN" takes priority
    if (sleepTimerTypeRef.current === 'end_of_vn') {
      setSleepTimer('off');
      didJustFinishRef.current = true;
      setIsPlaying(false);
      isPlayingRef.current = false;
      setCurrentTime(0);
      currentTimeRef.current = 0;
      lastSavedPositionRef.current = 0;
      if (current) {
        clearedVnIdRef.current = current.id;
        vnRepository.clearLastPosition(current.id).catch(() => {});
        DeviceEventEmitter.emit('library_updated');
      }
      return;
    }

    // 2. Repeat One Handling: replays current track ONLY on natural finish (!isManualNext)
    // Manual Next always advances to manual queue or next context track and NEVER traps the user.
    if (
      !isManualNext &&
      repeatModeRef.current === 'one' &&
      current &&
      checkAudioFileExists(current.fileUri)
    ) {
      if (playerRef.current) {
        try {
          await playerRef.current.seekTo(0);
          playerRef.current.play();
          setIsPlaying(true);
          isPlayingRef.current = true;
          setCurrentTime(0);
          currentTimeRef.current = 0;
          lastSavedPositionRef.current = 0;
          clearedVnIdRef.current = current.id;
          vnRepository.clearLastPosition(current.id).catch(() => {});
          DeviceEventEmitter.emit('library_updated');
          return;
        } catch (loopErr) {
          console.warn('Error during repeat one replay:', loopErr);
        }
      }
    }

    // 3. Clear progress for naturally completed track
    if (current) {
      clearedVnIdRef.current = current.id;
      lastSavedPositionRef.current = 0;
      currentTimeRef.current = 0;
      vnRepository.clearLastPosition(current.id).catch(() => {});
      DeviceEventEmitter.emit('library_updated');
    }

    // 4. Manual Queue priority (deterministic FIFO)
    while (manualQueueRef.current.length > 0) {
      const nextVn = manualQueueRef.current[0];
      const updatedQueue = manualQueueRef.current.slice(1);
      manualQueueRef.current = updatedQueue;
      setManualQueue(updatedQueue);

      if (checkAudioFileExists(nextVn.fileUri)) {
        if (current) addToHistory(current.id);
        await playInternal(nextVn, 0, undefined, currentToken);
        return;
      }
      // If candidate file is missing, silently consume and continue to next queue item
    }

    // 5. Current Playback Context continuation
    const context = playbackContextRef.current;
    if (context && context.items.length > 0) {
      // If single-item context, do not loop unless repeat is 'all'
      if (context.type === 'single') {
        if (repeatModeRef.current === 'all') {
          const candidate = context.items[0];
          if (candidate && checkAudioFileExists(candidate.fileUri)) {
            if (current) addToHistory(current.id);
            await playInternal(candidate, 0, undefined, currentToken);
            return;
          }
        }
      } else if (isShuffleRef.current && shuffledOrderRef.current.length > 0) {
        let nextPointer = shufflePointerRef.current + 1;
        while (nextPointer < shuffledOrderRef.current.length) {
          const nextIdx = shuffledOrderRef.current[nextPointer];
          const candidate = context.items[nextIdx];
          if (candidate && checkAudioFileExists(candidate.fileUri)) {
            shufflePointerRef.current = nextPointer;
            if (current) addToHistory(current.id);
            await playInternal(candidate, 0, undefined, currentToken);
            return;
          }
          nextPointer++;
        }

        // Reached end of shuffle cycle
        if (repeatModeRef.current === 'all') {
          const lastIdx = shuffledOrderRef.current[shuffledOrderRef.current.length - 1];
          const reshuffled = generateReshuffledOrder(context.items.length, lastIdx);
          shuffledOrderRef.current = reshuffled;
          setShuffledOrder(reshuffled);
          shufflePointerRef.current = 0;

          let p = 0;
          while (p < reshuffled.length) {
            const candidate = context.items[reshuffled[p]];
            if (candidate && checkAudioFileExists(candidate.fileUri)) {
              shufflePointerRef.current = p;
              if (current) addToHistory(current.id);
              await playInternal(candidate, 0, undefined, currentToken);
              return;
            }
            p++;
          }
        }
      } else {
        // Sequential Context
        const currentId = current?.id;
        const currentInContext = currentId ? context.items.findIndex((v) => v.id === currentId) : -1;
        const currentIndex = currentInContext !== -1 ? currentInContext : lastContextIndexRef.current;
        let searchIndex = currentIndex + 1;

        while (searchIndex < context.items.length) {
          const candidate = context.items[searchIndex];
          if (candidate && checkAudioFileExists(candidate.fileUri)) {
            lastContextIndexRef.current = searchIndex;
            if (current) addToHistory(current.id);
            await playInternal(candidate, 0, undefined, currentToken);
            return;
          }
          searchIndex++;
        }

        // Reached end of sequential context
        if (repeatModeRef.current === 'all') {
          let wrapIndex = 0;
          while (wrapIndex <= currentIndex && wrapIndex < context.items.length) {
            const candidate = context.items[wrapIndex];
            if (candidate && checkAudioFileExists(candidate.fileUri)) {
              lastContextIndexRef.current = wrapIndex;
              if (current) addToHistory(current.id);
              await playInternal(candidate, 0, undefined, currentToken);
              return;
            }
            wrapIndex++;
          }
        }
      }
    }

    // 6. Repeat Off or end of context reached with nothing playable
    didJustFinishRef.current = true;
    setIsPlaying(false);
    isPlayingRef.current = false;
    setCurrentTime(0);
    currentTimeRef.current = 0;
    lastSavedPositionRef.current = 0;
  };

  /**
   * PART 18 & 19 — Single Authoritative Previous Track Decision Engine
   */
  const resolvePreviousTrack = async (forcePrevious: boolean = false) => {
    const currentToken = ++transitionTokenRef.current;

    // Standard player rule: If current position > 3s and not forcing previous, restart track
    if (!forcePrevious && currentTimeRef.current > 3 && playerRef.current) {
      try {
        await playerRef.current.seekTo(0);
        setCurrentTime(0);
        currentTimeRef.current = 0;
        return;
      } catch (e) {
        console.warn('Error seeking to 0 on previous:', e);
      }
    }

    // Check playback history stack first for deterministic back-navigation
    const history = playbackHistoryRef.current;
    while (history.length > 0) {
      const prevId = history.pop();
      if (prevId && prevId !== currentVnRef.current?.id) {
        try {
          const prevVn = await vnRepository.getVnById(prevId);
          if (prevVn && checkAudioFileExists(prevVn.fileUri)) {
            await playInternal(prevVn, 0, undefined, currentToken);
            return;
          }
        } catch {}
      }
    }

    // Fallback: Context-based previous track
    const context = playbackContextRef.current;
    if (context && context.items.length > 0) {
      if (isShuffleRef.current && shuffledOrderRef.current.length > 0) {
        if (shufflePointerRef.current > 0) {
          shufflePointerRef.current -= 1;
          const prevIdx = shuffledOrderRef.current[shufflePointerRef.current];
          const candidate = context.items[prevIdx];
          if (candidate && checkAudioFileExists(candidate.fileUri)) {
            await playInternal(candidate, 0, undefined, currentToken);
            return;
          }
        } else if (repeatModeRef.current === 'all') {
          shufflePointerRef.current = shuffledOrderRef.current.length - 1;
          const prevIdx = shuffledOrderRef.current[shufflePointerRef.current];
          const candidate = context.items[prevIdx];
          if (candidate && checkAudioFileExists(candidate.fileUri)) {
            await playInternal(candidate, 0, undefined, currentToken);
            return;
          }
        }
      } else {
        const currentId = currentVnRef.current?.id;
        const currentIndex = currentId ? context.items.findIndex((v) => v.id === currentId) : -1;

        if (currentIndex > 0) {
          const candidate = context.items[currentIndex - 1];
          if (candidate && checkAudioFileExists(candidate.fileUri)) {
            await playInternal(candidate, 0, undefined, currentToken);
            return;
          }
        } else if (currentIndex === 0 && repeatModeRef.current === 'all') {
          const candidate = context.items[context.items.length - 1];
          if (candidate && checkAudioFileExists(candidate.fileUri)) {
            await playInternal(candidate, 0, undefined, currentToken);
            return;
          }
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
  };

  playInternalRef.current = playInternal;
  resolveNextTrackRef.current = resolveNextTrack;
  resolvePreviousTrackRef.current = resolvePreviousTrack;

  const playVn = useCallback(async (vn: VN, startPosition?: number, newContext?: PlaybackContext) => {
    // If the same VN is already loaded, toggle pause/resume or handle seek
    if (currentVnRef.current?.id === vn.id && playerRef.current) {
      if (isPlayingRef.current) {
        pauseRef.current();
        return;
      }
      if (
        startPosition !== undefined &&
        startPosition > 0 &&
        Math.abs(currentTimeRef.current - startPosition) > 2
      ) {
        await seekToRef.current(startPosition);
      }
      await resumeRef.current();
      return;
    }

    // Record current track to history stack when navigating to a different track manually
    if (currentVnRef.current && currentVnRef.current.id !== vn.id) {
      addToHistory(currentVnRef.current.id);
    }

    await playInternalRef.current(vn, startPosition || 0, newContext);
  }, [addToHistory]);

  const playNextTrack = useCallback(async (_fromSwipe: boolean = false) => {
    await resolveNextTrackRef.current(true);
  }, []);
  playNextTrackRef.current = playNextTrack;

  const playPreviousTrack = useCallback(async (forcePrevious: boolean = false) => {
    await resolvePreviousTrackRef.current(forcePrevious);
  }, []);

  const pause = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.pause();
      setIsPlaying(false);
      isPlayingRef.current = false;

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
  }, []);
  pauseRef.current = pause;

  const resume = useCallback(async () => {
    if (playerRef.current) {
      try {
        if (didJustFinishRef.current || (durationRef.current > 0 && currentTimeRef.current >= durationRef.current - 0.5)) {
          await playerRef.current.seekTo(0);
          setCurrentTime(0);
          currentTimeRef.current = 0;
          didJustFinishRef.current = false;
        }
        playerRef.current.play();
        setIsPlaying(true);
        isPlayingRef.current = true;
      } catch (err) {
        console.warn('Error resuming playback:', err);
      }
    } else if (currentVnRef.current) {
      await playInternalRef.current(currentVnRef.current, currentTimeRef.current);
    }
  }, []);
  resumeRef.current = resume;

  const togglePlayPause = useCallback(() => {
    if (isPlayingRef.current) {
      pauseRef.current();
    } else {
      resumeRef.current();
    }
  }, []);

  const seekTo = useCallback(async (seconds: number) => {
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
  }, []);
  seekToRef.current = seekTo;

  const stop = useCallback(() => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    setSleepTimerType('off');
    sleepTimerTypeRef.current = 'off';
    setSleepTimerRemaining(null);

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
    currentVnRef.current = null;
    setIsPlaying(false);
    isPlayingRef.current = false;
    setCurrentTime(0);
    currentTimeRef.current = 0;
    setDuration(0);
    durationRef.current = 0;
  }, []);
  stopRef.current = stop;

  const stopIfPlaying = useCallback((vnId: string) => {
    if (currentVnRef.current?.id === vnId) {
      stop();
    }
  }, [stop]);

  const shuffleAll = useCallback(async (allVns?: VN[], customContext?: PlaybackContext) => {
    let list = allVns;
    if (!list || list.length === 0) {
      try {
        list = await vnRepository.getAllVns();
      } catch (err) {
        console.warn('Error fetching all VNs for shuffleAll:', err);
      }
    }
    if (!list || list.length === 0) {
      Alert.alert('No Recordings', 'There are no recordings in your library to shuffle.');
      return;
    }

    const validList = list.filter((item) => checkAudioFileExists(item.fileUri));
    if (validList.length === 0) {
      Alert.alert('No Files Available', 'Could not find local audio files for library recordings.');
      return;
    }

    const shuffled = [...validList];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const newContext: PlaybackContext = customContext
      ? { ...customContext, items: shuffled }
      : {
          type: 'all',
          title: 'All Voice Notes',
          items: shuffled,
        };

    setIsShuffle(true);
    isShuffleRef.current = true;
    const order = Array.from({ length: shuffled.length }, (_, i) => i);
    shuffledOrderRef.current = order;
    setShuffledOrder(order);
    shufflePointerRef.current = 0;

    await playInternalRef.current(shuffled[0], 0, newContext);
  }, []);

  // Memoized Context Values
  const stateValue = useMemo<AudioState>(
    () => ({
      currentVn,
      isPlaying,
      isLooping,
      repeatMode,
      isShuffle,
      shuffledOrder,
      playbackRate,
      sleepTimerType,
      sleepTimerRemaining,
      manualQueue,
      playbackContext,
    }),
    [
      currentVn,
      isPlaying,
      isLooping,
      repeatMode,
      isShuffle,
      shuffledOrder,
      playbackRate,
      sleepTimerType,
      sleepTimerRemaining,
      manualQueue,
      playbackContext,
    ]
  );

  const progressValue = useMemo<AudioProgress>(
    () => ({
      currentTime,
      duration,
    }),
    [currentTime, duration]
  );

  const actionsValue = useMemo<AudioActions>(
    () => ({
      playVn,
      pause,
      resume,
      togglePlayPause,
      toggleLoop,
      setRepeatMode,
      cycleRepeatMode,
      toggleShuffle,
      shuffleAll,
      addAlbumToQueue,
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
    }),
    [
      playVn,
      pause,
      resume,
      togglePlayPause,
      toggleLoop,
      setRepeatMode,
      cycleRepeatMode,
      toggleShuffle,
      shuffleAll,
      addAlbumToQueue,
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
    ]
  );

  return (
    <AudioActionsContext.Provider value={actionsValue}>
      <AudioStateContext.Provider value={stateValue}>
        <AudioProgressContext.Provider value={progressValue}>
          {children}
        </AudioProgressContext.Provider>
      </AudioStateContext.Provider>
    </AudioActionsContext.Provider>
  );
}

/**
 * Returns stable actions (playVn, addToQueue, playNext, etc.).
 * Guarantees 0 re-renders on playback time ticks!
 */
export function useAudioActions(): AudioActions {
  const context = useContext(AudioActionsContext);
  if (!context) {
    throw new Error('useAudioActions must be used within an AudioPlayerProvider');
  }
  return context;
}

/**
 * Returns slow-moving playback state (currentVn, isPlaying, manualQueue, repeatMode, etc.).
 * Does NOT subscribe to 250ms position updates!
 */
export function useAudioState(): AudioState {
  const context = useContext(AudioStateContext);
  if (!context) {
    throw new Error('useAudioState must be used within an AudioPlayerProvider');
  }
  return context;
}

/**
 * Returns high-frequency playback progress (currentTime, duration).
 * Used only by progress bars and scrubbers.
 */
export function useAudioProgress(): AudioProgress {
  const context = useContext(AudioProgressContext);
  if (!context) {
    throw new Error('useAudioProgress must be used within an AudioPlayerProvider');
  }
  return context;
}

/**
 * Complete Audio Context combining State, Progress, and Actions.
 * 100% backward compatible with existing screens.
 */
export function useAudio(): AudioContextType {
  const state = useAudioState();
  const progress = useAudioProgress();
  const actions = useAudioActions();

  return useMemo(
    () => ({
      ...state,
      ...progress,
      ...actions,
    }),
    [state, progress, actions]
  );
}
