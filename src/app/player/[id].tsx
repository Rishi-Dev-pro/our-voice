import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  GestureResponderEvent,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { vnRepository } from '@/database/repositories/vnRepository';
import { VN } from '@/types/vn';
import {
  useAudio,
  SUPPORTED_SPEEDS,
  SleepTimerOption,
} from '@/services/audioPlayerContext';
import { formatDuration, formatDate } from '@/utils/format';
import { useTheme } from '@/hooks/use-theme';
import { AppleArtwork } from '@/components/apple-artwork';
import { AppleActionSheet } from '@/components/apple-action-sheet';
import { AddToAlbumModal } from '@/components/add-to-album-modal';
import { sharingService } from '@/services/sharingService';
import { teddyReactionService } from '@/services/teddyReactionService';

const PLAYER_WAVE_WEIGHTS = [
  0.35, 0.45, 0.6, 0.8, 0.5, 0.7, 0.95, 0.65, 0.4, 0.75, 0.9, 0.55, 0.85, 1.0, 0.7, 0.5,
  0.65, 0.9, 0.75, 0.4, 0.8, 0.95, 0.6, 0.45, 0.7, 0.85, 0.5, 0.65, 0.4, 0.55, 0.45, 0.35
];

export default function PlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const vnId = Array.isArray(id) ? id[0] : id;

  const {
    currentVn,
    isPlaying,
    currentTime,
    duration,
    repeatMode,
    isShuffle,
    playbackRate,
    sleepTimerType,
    sleepTimerRemaining,
    manualQueue,
    playVn,
    togglePlayPause,
    cycleRepeatMode,
    toggleShuffle,
    playNextTrack,
    playPreviousTrack,
    addToQueue,
    playNext,
    setPlaybackRate,
    setSleepTimer,
    seekTo,
    updateCurrentVnMetadata,
  } = useAudio();

  const [loadedVn, setLoadedVn] = useState<VN | null>(null);
  const vn = currentVn || loadedVn;
  const setVn = setLoadedVn;
  const [loading, setLoading] = useState(!currentVn || currentVn.id !== vnId);
  const [progressBarWidth, setProgressBarWidth] = useState(0);

  // Real-time scrubbing state & layout refs
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubPosition, setScrubPosition] = useState(0);
  const trackRef = useRef<View>(null);
  const trackLayoutRef = useRef<{ pageX: number; width: number }>({ pageX: 0, width: 0 });

  // Volume slider refs
  const volumeTrackRef = useRef<View>(null);
  const volumeWidthRef = useRef<number>(200);
  const volumePageXRef = useRef<number>(0);

  // Modals & Action Sheet
  const [actionSheetVisible, setActionSheetVisible] = useState(false);
  const [albumModalVisible, setAlbumModalVisible] = useState(false);
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [renameInput, setRenameInput] = useState('');
  const [speedModalVisible, setSpeedModalVisible] = useState(false);
  const [sleepTimerModalVisible, setSleepTimerModalVisible] = useState(false);

  // Simulated Volume
  const [volumeLevel, setVolumeLevel] = useState(0.85);

  const router = useRouter();
  const theme = useTheme();
  const { width: screenWidth } = useWindowDimensions();

  // Periodic wave tick for gentle pulsing animation when playing
  const [waveTick, setWaveTick] = useState(0);
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setWaveTick((t) => (t + 1) % 100);
    }, 140);
    return () => clearInterval(interval);
  }, [isPlaying]);

  // Signature Apple Music Artwork Scaling Animation:
  // When playing: scale 1.0; when paused: scale 0.86
  const artworkScale = useSharedValue(isPlaying ? 1.0 : 0.86);

  useEffect(() => {
    artworkScale.value = withSpring(isPlaying ? 1.0 : 0.86, {
      damping: 15,
      stiffness: 120,
    });
  }, [isPlaying, artworkScale]);

  const animatedArtworkStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: artworkScale.value }],
    };
  });

  const hasAutoPlayedRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    // If audio player already has this track active, no DB fetch needed
    if (currentVn && currentVn.id === vnId) {
      return;
    }

    async function loadInitial() {
      if (!vnId) return;
      try {
        const data = await vnRepository.getVnById(vnId);
        if (!isMounted) return;
        setLoadedVn(data);
        setLoading(false);
        if (data && !hasAutoPlayedRef.current) {
          hasAutoPlayedRef.current = true;
          playVn(data);
        }
      } catch (err) {
        console.warn('Error loading initial VN in PlayerScreen:', err);
        if (isMounted) setLoading(false);
      }
    }

    loadInitial();

    return () => {
      isMounted = false;
    };
  }, [vnId, currentVn]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('library_updated', async () => {
      const activeId = currentVn?.id || vnId;
      if (activeId) {
        try {
          const data = await vnRepository.getVnById(activeId);
          if (data) setLoadedVn(data);
        } catch {}
      }
    });
    return () => sub.remove();
  }, [vnId, currentVn?.id]);

  // Horizontal Swipe Gestures for Previous / Next track
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) => {
          return (
            Math.abs(gestureState.dx) > 30 &&
            Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.5
          );
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dx < -50) {
            playNextTrack(true);
          } else if (gestureState.dx > 50) {
            playPreviousTrack(true);
          }
        },
      }),
    [playNextTrack, playPreviousTrack]
  );

  const activeDuration = duration || vn?.duration || 0;
  const displayTime = isScrubbing ? scrubPosition : currentTime;
  const progressPercent =
    activeDuration > 0 ? Math.min(100, Math.max(0, (displayTime / activeDuration) * 100)) : 0;
  const remainingTime = Math.max(0, activeDuration - displayTime);

  const updateTrackMeasurement = () => {
    trackRef.current?.measure((x, y, width, height, pageX) => {
      if (width > 0) {
        trackLayoutRef.current = { pageX: pageX || 0, width };
        setProgressBarWidth(width);
      }
    });
  };

  const getFractionFromEvent = (evt: GestureResponderEvent) => {
    const width = trackLayoutRef.current.width || progressBarWidth;
    if (width <= 0) return 0;
    const { pageX, locationX } = evt.nativeEvent;
    if (trackLayoutRef.current.pageX > 0 && pageX !== undefined) {
      const relX = pageX - trackLayoutRef.current.pageX;
      return Math.max(0, Math.min(1, relX / width));
    }
    return Math.max(0, Math.min(1, locationX / width));
  };

  const handleScrubStart = (evt: GestureResponderEvent) => {
    if (activeDuration <= 0) return;
    updateTrackMeasurement();
    const fraction = getFractionFromEvent(evt);
    const target = fraction * activeDuration;
    setIsScrubbing(true);
    setScrubPosition(target);
  };

  const handleScrubMove = (evt: GestureResponderEvent) => {
    if (activeDuration <= 0) return;
    const fraction = getFractionFromEvent(evt);
    const target = fraction * activeDuration;
    setScrubPosition(target);
  };

  const handleScrubEnd = (evt: GestureResponderEvent) => {
    if (activeDuration <= 0) {
      setIsScrubbing(false);
      return;
    }
    const fraction = getFractionFromEvent(evt);
    const target = fraction * activeDuration;
    setScrubPosition(target);
    seekTo(target);
    setTimeout(() => {
      setIsScrubbing(false);
    }, 150);
  };

  const handleVolumeTouch = (evt: GestureResponderEvent) => {
    const width = volumeWidthRef.current || 200;
    const { pageX, locationX } = evt.nativeEvent;
    let fraction: number;
    if (volumePageXRef.current > 0 && pageX !== undefined) {
      fraction = (pageX - volumePageXRef.current) / width;
    } else {
      fraction = locationX / width;
    }
    setVolumeLevel(Math.max(0, Math.min(1, fraction)));
  };

  async function handleToggleLike() {
    if (!vn) return;
    const nextState = !vn.isLiked;
    setVn((prev) => (prev ? { ...prev, isLiked: nextState } : null));
    if (currentVn?.id === vn.id) {
      updateCurrentVnMetadata({ isLiked: nextState });
    }
    try {
      await vnRepository.toggleLike(vn.id, nextState);
      DeviceEventEmitter.emit('library_updated');
      teddyReactionService.trigger(nextState ? 'LIKE' : 'UNLIKE');
    } catch {
      setVn((prev) => (prev ? { ...prev, isLiked: !nextState } : null));
      if (currentVn?.id === vn.id) {
        updateCurrentVnMetadata({ isLiked: !nextState });
      }
    }
  }

  async function handleTogglePin() {
    if (!vn) return;
    const nextState = !vn.isPinned;
    setVn((prev) => (prev ? { ...prev, isPinned: nextState } : null));
    if (currentVn?.id === vn.id) {
      updateCurrentVnMetadata({ isPinned: nextState });
    }
    try {
      await vnRepository.togglePin(vn.id, nextState);
      DeviceEventEmitter.emit('library_updated');
      teddyReactionService.trigger(nextState ? 'PIN' : 'UNPIN');
    } catch {
      setVn((prev) => (prev ? { ...prev, isPinned: !nextState } : null));
      if (currentVn?.id === vn.id) {
        updateCurrentVnMetadata({ isPinned: !nextState });
      }
    }
  }

  function handleMainPlayPress() {
    if (!vn) return;
    if (currentVn?.id === vn.id) {
      togglePlayPause();
    } else {
      playVn(vn);
    }
  }

  function handleSeekBackward() {
    const target = Math.max(0, currentTime - 10);
    seekTo(target);
  }

  function handleSeekForward() {
    const target = Math.min(activeDuration, currentTime + 10);
    seekTo(target);
  }

  function openRenameModal() {
    if (!vn) return;
    setRenameInput(vn.title);
    setRenameModalVisible(true);
  }

  async function handleSaveRename() {
    const trimmed = renameInput.trim();
    if (!trimmed || !vn) return;

    try {
      await vnRepository.updateVnTitle(vn.id, trimmed);
      setVn((prev) => (prev ? { ...prev, title: trimmed } : null));
      if (currentVn?.id === vn.id) {
        updateCurrentVnMetadata({ title: trimmed });
      }
      DeviceEventEmitter.emit('library_updated');
      setRenameModalVisible(false);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not rename voice note.');
    }
  }

  async function handleShare() {
    if (vn) {
      await sharingService.shareVnAudio(vn);
      teddyReactionService.trigger('SHARE');
    }
  }

  function handleTakeAgain() {
    if (vn) {
      teddyReactionService.trigger('TAKE_AGAIN');
      router.push(`/record?takeBaseTitle=${encodeURIComponent(vn.title)}` as any);
    }
  }

  const artworkSize = Math.min(screenWidth - 64, 320);

  if (loading) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.tint} />
        </View>
      </SafeAreaView>
    );
  }

  if (!vn) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
        <View style={styles.topBar}>
          <Pressable style={styles.navIconBtn} onPress={() => router.back()}>
            <Ionicons name="chevron-down" size={28} color={theme.text} />
          </Pressable>
        </View>
        <View style={styles.centered}>
          <Text style={[styles.notFoundText, { color: theme.text }]}>Voice note not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      {/* Top Sheet Grabber Bar */}
      <View style={styles.sheetHandle} />

      {/* Navigation Top Bar: Dismiss Chevron & Context Menu */}
      <View style={styles.topBar}>
        <Pressable
          style={styles.navIconBtn}
          hitSlop={12}
          onPress={() => router.back()}>
          <Ionicons name="chevron-down" size={28} color={theme.text} />
        </Pressable>

        <Text style={[styles.nowPlayingHeader, { color: theme.textSecondary }]}>
          NOW PLAYING
        </Text>

        <Pressable
          style={styles.navIconBtn}
          hitSlop={12}
          onPress={() => setActionSheetVisible(true)}>
          <Ionicons name="ellipsis-horizontal-circle" size={26} color={theme.text} />
        </Pressable>
      </View>

      <View style={styles.contentContainer}>
        {/* Animated Artwork Centerpiece with Apple Music Spring Scaling & Swipe Gestures */}
        <View style={styles.artworkContainer} {...panResponder.panHandlers}>
          <Animated.View style={[animatedArtworkStyle, styles.artworkShadow]}>
            <AppleArtwork
              id={vn.id}
              title={vn.title}
              size={artworkSize}
              borderRadius={20}
            />
          </Animated.View>
        </View>

        {/* Title, Date, and Star/Heart Favorite Button */}
        <View style={styles.trackInfoSection}>
          <View style={styles.titleColumn}>
            <Text style={[styles.trackTitle, { color: theme.text }]} numberOfLines={2}>
              {vn.title}
            </Text>
            <Text style={[styles.trackSubtitle, { color: theme.textSecondary }]}>
              Recorded {formatDate(vn.createdAt)}
            </Text>
          </View>

          <Pressable
            style={styles.favoriteBtn}
            hitSlop={14}
            onPress={handleToggleLike}>
            <Ionicons
              name={vn.isLiked ? 'heart' : 'heart-outline'}
              size={26}
              color={vn.isLiked ? theme.tint : theme.textSecondary}
            />
          </Pressable>
        </View>

        {/* Interactive Audio Scrubber & Waveform Visualizer */}
        <View style={styles.scrubberContainer}>
          {/* Animated Audio Waveform Visualizer */}
          <View
            style={styles.waveformContainer}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={handleScrubStart}
            onResponderMove={handleScrubMove}
            onResponderRelease={handleScrubEnd}
            onResponderTerminate={() => setIsScrubbing(false)}>
            {PLAYER_WAVE_WEIGHTS.map((weight, i) => {
              const barFraction = i / (PLAYER_WAVE_WEIGHTS.length - 1);
              const isPast = barFraction <= progressPercent / 100;
              const bounce = isPlaying ? Math.sin((waveTick * 0.45) + i * 0.5) * 0.28 : 0;
              const barHeight = Math.max(5, Math.min(30, 26 * (weight + bounce)));
              return (
                <View
                  key={`wave-bar-${i}`}
                  style={[
                    styles.waveformBar,
                    {
                      height: barHeight,
                      backgroundColor: isPast ? theme.tint : theme.backgroundSelected,
                      opacity: isPast ? 1 : 0.45,
                    },
                  ]}
                />
              );
            })}
          </View>

          {/* Generous 48px Scrubber Touch Zone */}
          <View
            ref={trackRef}
            style={styles.scrubberTouchZone}
            onLayout={(evt) => {
              const { width } = evt.nativeEvent.layout;
              setProgressBarWidth(width);
              trackLayoutRef.current.width = width;
              updateTrackMeasurement();
            }}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={handleScrubStart}
            onResponderMove={handleScrubMove}
            onResponderRelease={handleScrubEnd}
            onResponderTerminate={() => setIsScrubbing(false)}>
            <View style={[styles.scrubberTrack, { backgroundColor: theme.backgroundSelected }]}>
              {/* Scrubber Fill */}
              <View
                style={[
                  styles.scrubberFill,
                  { width: `${progressPercent}%`, backgroundColor: theme.tint },
                ]}
              />
              {/* Scrubber Circular Thumb Knob */}
              <View
                style={[
                  styles.scrubberThumb,
                  {
                    left: `${progressPercent}%`,
                    backgroundColor: theme.tint,
                    transform: [{ scale: isScrubbing ? 1.35 : 1.0 }],
                  },
                ]}
              />
            </View>
          </View>

          {/* Time Labels */}
          <View style={styles.timeLabelsRow}>
            <Text
              style={[
                styles.timeText,
                {
                  color: isScrubbing ? theme.tint : theme.textSecondary,
                  fontWeight: isScrubbing ? '700' : '500',
                },
              ]}>
              {formatDuration(displayTime)}
            </Text>
            <Text style={[styles.timeText, { color: theme.textSecondary }]}>
              -{formatDuration(remainingTime)}
            </Text>
          </View>
        </View>

        {/* Apple Music Main Playback Deck */}
        <View style={styles.controlsRow}>
          {/* Previous Track */}
          <Pressable
            style={({ pressed }) => [
              styles.skipBtn,
              pressed && { opacity: 0.6 },
            ]}
            hitSlop={10}
            onPress={() => playPreviousTrack()}>
            <Ionicons name="play-skip-back" size={28} color={theme.text} />
          </Pressable>

          {/* Skip -10s */}
          <Pressable
            style={({ pressed }) => [
              styles.skipBtn,
              pressed && { opacity: 0.6 },
            ]}
            hitSlop={10}
            onPress={handleSeekBackward}>
            <Ionicons name="play-back" size={26} color={theme.textSecondary} />
          </Pressable>

          {/* Large Center Play / Pause Button */}
          <Pressable
            style={({ pressed }) => [
              styles.mainPlayBtn,
              { backgroundColor: theme.text },
              pressed && { transform: [{ scale: 0.94 }] },
            ]}
            onPress={handleMainPlayPress}>
            <Ionicons
              name={isPlaying ? 'pause' : 'play'}
              size={36}
              color={theme.background}
              style={isPlaying ? {} : { marginLeft: 3 }}
            />
          </Pressable>

          {/* Skip +10s */}
          <Pressable
            style={({ pressed }) => [
              styles.skipBtn,
              pressed && { opacity: 0.6 },
            ]}
            hitSlop={10}
            onPress={handleSeekForward}>
            <Ionicons name="play-forward" size={26} color={theme.textSecondary} />
          </Pressable>

          {/* Next Track */}
          <Pressable
            style={({ pressed }) => [
              styles.skipBtn,
              pressed && { opacity: 0.6 },
            ]}
            hitSlop={10}
            onPress={() => playNextTrack()}>
            <Ionicons name="play-skip-forward" size={28} color={theme.text} />
          </Pressable>
        </View>

        {/* Interactive Volume Slider */}
        <View style={styles.volumeRow}>
          <Pressable hitSlop={8} onPress={() => setVolumeLevel(0)}>
            <Ionicons name="volume-low" size={18} color={theme.textSecondary} />
          </Pressable>
          <View
            ref={volumeTrackRef}
            style={styles.volumeTouchZone}
            onLayout={(evt) => {
              const { width } = evt.nativeEvent.layout;
              volumeWidthRef.current = width;
              volumeTrackRef.current?.measure((x, y, w, h, pageX) => {
                if (pageX) volumePageXRef.current = pageX;
              });
            }}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={handleVolumeTouch}
            onResponderMove={handleVolumeTouch}
            onResponderRelease={handleVolumeTouch}>
            <View style={[styles.volumeTrack, { backgroundColor: theme.backgroundSelected }]}>
              <View
                style={[
                  styles.volumeFill,
                  { width: `${volumeLevel * 100}%`, backgroundColor: theme.textSecondary },
                ]}
              />
              <View
                style={[
                  styles.volumeThumb,
                  { left: `${volumeLevel * 100}%`, backgroundColor: theme.textSecondary },
                ]}
              />
            </View>
          </View>
          <Pressable hitSlop={8} onPress={() => setVolumeLevel(1.0)}>
            <Ionicons name="volume-high" size={20} color={theme.textSecondary} />
          </Pressable>
        </View>

        {/* Bottom Auxiliary Bar: Shuffle, Repeat, Speed, Sleep Timer, Add to Album, Up Next */}
        <View style={styles.auxiliaryBar}>
          {/* Shuffle Button */}
          <Pressable
            style={({ pressed }) => [
              styles.auxBtn,
              pressed && { opacity: 0.7 },
            ]}
            onPress={() => {
              toggleShuffle();
              teddyReactionService.trigger('CUSTOM', !isShuffle ? 'Shuffle enabled 🔀' : 'Shuffle turned off ➡️');
            }}>
            <Ionicons
              name="shuffle"
              size={22}
              color={isShuffle ? theme.tint : theme.textSecondary}
            />
          </Pressable>

          {/* Repeat Button */}
          <Pressable
            style={({ pressed }) => [
              styles.auxBtn,
              pressed && { opacity: 0.7 },
            ]}
            onPress={() => {
              cycleRepeatMode();
              const next =
                repeatMode === 'off' ? 'ALL' : repeatMode === 'all' ? 'ONE' : 'OFF';
              if (next === 'ONE') {
                teddyReactionService.trigger('LOOP_ON');
              } else {
                teddyReactionService.trigger('CUSTOM', `Repeat: ${next} 🔁`);
              }
            }}>
            <View style={{ position: 'relative', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons
                name={repeatMode === 'off' ? 'repeat-outline' : 'repeat'}
                size={23}
                color={repeatMode === 'off' ? theme.textSecondary : theme.tint}
              />
              {repeatMode === 'one' && (
                <View
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -6,
                    backgroundColor: theme.tint,
                    borderRadius: 6,
                    paddingHorizontal: 3,
                    paddingVertical: 1,
                  }}>
                  <Text style={{ color: '#FFFFFF', fontSize: 9, fontWeight: '800' }}>1</Text>
                </View>
              )}
            </View>
          </Pressable>

          {/* Speed Button */}
          <Pressable
            style={({ pressed }) => [
              styles.auxBtn,
              styles.speedPillBtn,
              { backgroundColor: theme.backgroundSelected },
              pressed && { opacity: 0.7 },
            ]}
            onPress={() => setSpeedModalVisible(true)}>
            <Text style={[styles.speedBtnText, { color: theme.text }]}>
              {playbackRate}x
            </Text>
          </Pressable>

          {/* Sleep Timer Button */}
          <Pressable
            style={({ pressed }) => [
              styles.auxBtn,
              pressed && { opacity: 0.7 },
            ]}
            onPress={() => setSleepTimerModalVisible(true)}>
            <View style={styles.sleepTimerBtnWrap}>
              <Ionicons
                name="timer-outline"
                size={22}
                color={sleepTimerType !== 'off' ? theme.tint : theme.textSecondary}
              />
              {sleepTimerRemaining !== null && (
                <Text style={[styles.timerBadgeText, { color: theme.tint }]}>
                  {Math.floor(sleepTimerRemaining / 60)}m
                </Text>
              )}
              {sleepTimerType === 'end_of_vn' && (
                <Text style={[styles.timerBadgeText, { color: theme.tint }]}>
                  End
                </Text>
              )}
            </View>
          </Pressable>

          {/* Add to Album */}
          <Pressable
            style={styles.auxBtn}
            hitSlop={8}
            onPress={() => setAlbumModalVisible(true)}>
            <Ionicons name="folder-open-outline" size={21} color={theme.textSecondary} />
          </Pressable>

          {/* Up Next / Queue Button */}
          <Pressable
            style={({ pressed }) => [
              styles.auxBtn,
              pressed && { opacity: 0.7 },
            ]}
            hitSlop={8}
            onPress={() => router.push('/queue' as any)}>
            <View style={{ position: 'relative', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons
                name="list"
                size={22}
                color={manualQueue.length > 0 ? theme.tint : theme.textSecondary}
              />
              {manualQueue.length > 0 && (
                <View
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -6,
                    backgroundColor: theme.tint,
                    borderRadius: 6,
                    minWidth: 14,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 2,
                  }}>
                  <Text style={{ color: '#FFFFFF', fontSize: 9, fontWeight: '800' }}>
                    {manualQueue.length}
                  </Text>
                </View>
              )}
            </View>
          </Pressable>
        </View>
      </View>

      {/* Apple Music Action Sheet for Track Options */}
      <AppleActionSheet
        vn={vn}
        visible={actionSheetVisible}
        isPlaying={isPlaying}
        onClose={() => setActionSheetVisible(false)}
        onPlay={playVn}
        onPlayNext={(v) => {
          const res = playNext(v);
          teddyReactionService.trigger('CUSTOM', res.message);
        }}
        onAddToQueue={(v) => {
          const res = addToQueue(v);
          teddyReactionService.trigger('CUSTOM', res.message);
        }}
        onToggleLike={handleToggleLike}
        onTogglePin={handleTogglePin}
        onAddToAlbum={() => setAlbumModalVisible(true)}
        onRename={openRenameModal}
        onShare={handleShare}
        onTakeAgain={vn.source === 'recorded' ? handleTakeAgain : undefined}
      />

      {/* Add To Album Modal */}
      <AddToAlbumModal
        vn={vn}
        visible={albumModalVisible}
        onClose={() => setAlbumModalVisible(false)}
      />

      {/* Rename Modal */}
      <Modal
        visible={renameModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setRenameModalVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setRenameModalVisible(false)}>
          <Pressable
            style={[
              styles.modalCard,
              { backgroundColor: theme.card, borderColor: theme.separator },
            ]}
            onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Rename Voice Note</Text>
            <TextInput
              style={[
                styles.input,
                {
                  color: theme.text,
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.separator,
                },
              ]}
              value={renameInput}
              onChangeText={setRenameInput}
              autoFocus
            />
            <View style={styles.modalBtnRow}>
              <Pressable
                style={[styles.modalBtn, { backgroundColor: theme.backgroundElement }]}
                onPress={() => setRenameModalVisible(false)}>
                <Text style={[styles.modalBtnText, { color: theme.text }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, { backgroundColor: theme.tint }]}
                onPress={handleSaveRename}>
                <Text style={[styles.modalBtnText, { color: '#FFFFFF' }]}>Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Speed Selector Modal */}
      <Modal
        visible={speedModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSpeedModalVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setSpeedModalVisible(false)}>
          <Pressable
            style={[
              styles.modalCard,
              { backgroundColor: theme.card, borderColor: theme.separator },
            ]}
            onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Playback Speed</Text>
            <View style={styles.optionsList}>
              {SUPPORTED_SPEEDS.map((speed) => (
                <Pressable
                  key={speed}
                  style={({ pressed }) => [
                    styles.optionRow,
                    speed === playbackRate && { backgroundColor: theme.backgroundSelected },
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={() => {
                    const changed = speed !== playbackRate;
                    setPlaybackRate(speed);
                    setSpeedModalVisible(false);
                    if (changed) {
                      teddyReactionService.trigger('SPEED_CHANGED');
                    }
                  }}>
                  <Text
                    style={[
                      styles.optionLabel,
                      { color: speed === playbackRate ? theme.tint : theme.text },
                    ]}>
                    {speed}x {speed === 1.0 ? '(Normal)' : ''}
                  </Text>
                  {speed === playbackRate && (
                    <Ionicons name="checkmark" size={20} color={theme.tint} />
                  )}
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Sleep Timer Modal */}
      <Modal
        visible={sleepTimerModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSleepTimerModalVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setSleepTimerModalVisible(false)}>
          <Pressable
            style={[
              styles.modalCard,
              { backgroundColor: theme.card, borderColor: theme.separator },
            ]}
            onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Sleep Timer</Text>
            <View style={styles.optionsList}>
              {[
                { label: 'Off', value: 'off' as SleepTimerOption },
                { label: '5 minutes', value: '5m' as SleepTimerOption },
                { label: '10 minutes', value: '10m' as SleepTimerOption },
                { label: '15 minutes', value: '15m' as SleepTimerOption },
                { label: '30 minutes', value: '30m' as SleepTimerOption },
                { label: '60 minutes', value: '60m' as SleepTimerOption },
                { label: 'End of VN', value: 'end_of_vn' as SleepTimerOption },
              ].map((opt) => (
                <Pressable
                  key={opt.value}
                  style={({ pressed }) => [
                    styles.optionRow,
                    opt.value === sleepTimerType && { backgroundColor: theme.backgroundSelected },
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={() => {
                    setSleepTimer(opt.value);
                    setSleepTimerModalVisible(false);
                    if (opt.value !== 'off') {
                      teddyReactionService.trigger('SLEEP_TIMER_ON');
                    }
                  }}>
                  <Text
                    style={[
                      styles.optionLabel,
                      { color: opt.value === sleepTimerType ? theme.tint : theme.text },
                    ]}>
                    {opt.label}
                  </Text>
                  {opt.value === sleepTimerType && (
                    <Ionicons name="checkmark" size={20} color={theme.tint} />
                  )}
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  sheetHandle: {
    width: 38,
    height: 4.5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(142, 142, 147, 0.4)',
    alignSelf: 'center',
    marginTop: 8,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  navIconBtn: {
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nowPlayingHeader: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  contentContainer: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'space-between',
    paddingBottom: 20,
    paddingTop: 8,
  },
  artworkContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 12,
  },
  artworkShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 16,
  },
  trackInfoSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: 8,
  },
  titleColumn: {
    flex: 1,
    marginRight: 14,
  },
  trackTitle: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  trackSubtitle: {
    fontSize: 15,
    fontWeight: '400',
  },
  favoriteBtn: {
    padding: 6,
  },
  scrubberContainer: {
    width: '100%',
    marginVertical: 4,
  },
  waveformContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 34,
    width: '100%',
    paddingHorizontal: 2,
    marginBottom: 2,
  },
  waveformBar: {
    width: 3.5,
    borderRadius: 2,
  },
  scrubberTouchZone: {
    width: '100%',
    height: 44,
    justifyContent: 'center',
  },
  scrubberTrack: {
    height: 5,
    borderRadius: 2.5,
    width: '100%',
    position: 'relative',
    justifyContent: 'center',
  },
  scrubberFill: {
    height: '100%',
    borderRadius: 2.5,
  },
  scrubberThumb: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    marginLeft: -8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
  },
  timeLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  timeText: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    fontWeight: '500',
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    marginVertical: 10,
  },
  skipBtn: {
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mainPlayBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  volumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 20,
    marginVertical: 4,
  },
  volumeTouchZone: {
    flex: 1,
    maxWidth: 220,
    height: 36,
    justifyContent: 'center',
  },
  volumeTrack: {
    width: '100%',
    height: 5,
    borderRadius: 2.5,
    position: 'relative',
    justifyContent: 'center',
  },
  volumeFill: {
    height: '100%',
    borderRadius: 2.5,
  },
  volumeThumb: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    marginLeft: -6,
  },
  auxiliaryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 8,
  },
  auxBtn: {
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedPillBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  speedBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  sleepTimerBtnWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  timerBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: -2,
  },
  optionsList: {
    gap: 4,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  optionLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notFoundText: {
    fontSize: 16,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    borderRadius: 16,
    padding: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 14,
  },
  input: {
    height: 44,
    borderRadius: 10,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 15,
    marginBottom: 16,
  },
  modalBtnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  modalBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
