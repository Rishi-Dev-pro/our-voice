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

interface AudioContextType {
  currentVn: VN | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  isLooping: boolean;
  playbackRate: PlaybackSpeed;
  sleepTimerType: SleepTimerOption;
  sleepTimerRemaining: number | null;
  playVn: (vn: VN, startPosition?: number) => Promise<void>;
  pause: () => void;
  resume: () => void;
  togglePlayPause: () => void;
  toggleLoop: () => void;
  setPlaybackRate: (rate: PlaybackSpeed) => void;
  setSleepTimer: (option: SleepTimerOption) => void;
  seekTo: (seconds: number) => Promise<void>;
  stop: () => void;
  updateCurrentVnMetadata: (updates: Partial<VN>) => void;
  stopIfPlaying: (vnId: string) => void;
}

const AudioContext = createContext<AudioContextType | null>(null);

export function AudioPlayerProvider({ children }: { children: React.ReactNode }) {
  const [currentVn, setCurrentVn] = useState<VN | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLooping, setIsLooping] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState<PlaybackSpeed>(1.0);
  const [sleepTimerType, setSleepTimerType] = useState<SleepTimerOption>('off');
  const [sleepTimerRemaining, setSleepTimerRemaining] = useState<number | null>(null);

  const playerRef = useRef<AudioPlayer | null>(null);
  const subscriptionRef = useRef<{ remove: () => void } | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const didJustFinishRef = useRef(false);
  const isBusyRef = useRef(false);

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

  useEffect(() => {
    // Configure audio mode for offline local playback
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    }).catch((err) => console.warn('Could not set audio mode:', err));

    // Listen to global VN deletion events to clear player immediately if needed
    const delSub = DeviceEventEmitter.addListener('vn_deleted', (deletedId: string) => {
      if (currentVnRef.current?.id === deletedId) {
        stop();
      }
    });

    // Listen to global metadata update events
    const metaSub = DeviceEventEmitter.addListener(
      'vn_metadata_updated',
      ({ id, updates }: { id: string; updates: Partial<VN> }) => {
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

  const playVn = async (vn: VN, startPosition?: number) => {
    // If the same VN is already loaded, toggle pause/resume or handle seek
    if (currentVnRef.current?.id === vn.id && playerRef.current) {
      if (isPlaying) {
        pause();
        return;
      }
      if (startPosition !== undefined && startPosition > 0 && Math.abs(currentTimeRef.current - startPosition) > 2) {
        await seekTo(startPosition);
      }
      resume();
      return;
    }

    // Prevent race conditions during rapid consecutive taps
    if (isBusyRef.current) return;
    isBusyRef.current = true;

    // Verify local file exists before playing
    if (!checkAudioFileExists(vn.fileUri)) {
      isBusyRef.current = false;
      Alert.alert(
        'File Unavailable',
        `Couldn't play "${vn.title}" because its local audio file is unavailable from device storage. Would you like to remove this missing record from your library?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: async () => {
              try {
                await vnRepository.deleteVn(vn.id);
                DeviceEventEmitter.emit('library_updated');
                cleanupPlayer();
                setCurrentVn(null);
                setIsPlaying(false);
              } catch (e) {
                console.warn('Error removing missing VN record:', e);
              }
            },
          },
        ]
      );
      return;
    }

    cleanupPlayer();
    setCurrentVn(vn);
    const initialPos = startPosition && startPosition > 1 && vn.duration && startPosition < vn.duration - 2 ? startPosition : 0;
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
            if (sleepTimerTypeRef.current === 'end_of_vn') {
              // End of VN sleep timer stops playback and overrides loop for this finish
              setSleepTimer('off');
              didJustFinishRef.current = true;
              setIsPlaying(false);
              setCurrentTime(0);
              currentTimeRef.current = 0;
              lastSavedPositionRef.current = 0;
              vnRepository.clearLastPosition(vn.id).catch(() => {});
              DeviceEventEmitter.emit('library_updated');
            } else if (isLoopingRef.current) {
              try {
                player.seekTo(0);
                player.play();
                setIsPlaying(true);
                setCurrentTime(0);
                currentTimeRef.current = 0;
                lastSavedPositionRef.current = 0;
                vnRepository.clearLastPosition(vn.id).catch(() => {});
                DeviceEventEmitter.emit('library_updated');
              } catch (loopErr) {
                console.warn('Error during loop replay:', loopErr);
              }
            } else {
              didJustFinishRef.current = true;
              setIsPlaying(false);
              setCurrentTime(0);
              currentTimeRef.current = 0;
              lastSavedPositionRef.current = 0;
              // Clear continue listening progress on natural completion
              vnRepository.clearLastPosition(vn.id).catch(() => {});
              DeviceEventEmitter.emit('library_updated');
            }
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
        vnRepository.updateLastPosition(currentVnRef.current.id, currentTimeRef.current).catch(() => {});
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
      await playVn(currentVnRef.current, currentTimeRef.current);
    }
  };

  const togglePlayPause = () => {
    if (isPlaying) {
      pause();
    } else {
      resume();
    }
  };

  const toggleLoop = () => {
    setIsLooping((prev) => {
      const next = !prev;
      isLoopingRef.current = next;
      if (playerRef.current) {
        try {
          playerRef.current.loop = next;
        } catch (e) {
          console.warn('Could not set player.loop:', e);
        }
      }
      return next;
    });
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

  return (
    <AudioContext.Provider
      value={{
        currentVn,
        isPlaying,
        currentTime,
        duration,
        isLooping,
        playbackRate,
        sleepTimerType,
        sleepTimerRemaining,
        playVn,
        pause,
        resume,
        togglePlayPause,
        toggleLoop,
        setPlaybackRate,
        setSleepTimer,
        seekTo,
        stop,
        updateCurrentVnMetadata,
        stopIfPlaying,
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
