import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  DeviceEventEmitter,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Accelerometer } from 'expo-sensors';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
} from 'react-native-reanimated';

import { vnRepository } from '@/database/repositories/vnRepository';
import { albumRepository } from '@/database/repositories/albumRepository';
import { vnService } from '@/services/vnService';
import { VN } from '@/types/vn';
import { useAudio } from '@/services/audioPlayerContext';
import { VnItem } from '@/components/vn-item';
import { MiniPlayer } from '@/components/mini-player';
import { AddToAlbumModal } from '@/components/add-to-album-modal';
import { AnimatedTeddy } from '@/components/animated-teddy';
import { TeddyOnboarding } from '@/components/teddy-onboarding';
import { TeddyPickCard } from '@/components/teddy-pick-card';
import { AppleArtwork } from '@/components/apple-artwork';
import { TeddyColors } from '@/constants/theme';
import { preferencesService } from '@/services/preferencesService';
import { teddyReactionService } from '@/services/teddyReactionService';
import { teddyPickerService } from '@/services/teddyPickerService';
import { formatDuration } from '@/utils/format';

export default function LibraryScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const teddy = isDark ? TeddyColors.dark : TeddyColors.light;

  const [vns, setVns] = useState<VN[]>([]);
  const [albumCount, setAlbumCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState<boolean | null>(null);
  const [userName, setUserName] = useState<string>('');
  const [importing, setImporting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [albumModalVn, setAlbumModalVn] = useState<VN | null>(null);

  // Rename modal state
  const [renameTargetVn, setRenameTargetVn] = useState<VN | null>(null);
  const [renameInput, setRenameInput] = useState('');

  const [selectedTab, setSelectedTab] = useState<'all' | 'recorded' | 'imported'>('all');

  const { currentVn, isPlaying, playVn, pause, resume, updateCurrentVnMetadata } = useAudio();
  const router = useRouter();

  // Shake & interaction guards
  const isPlayingRef = useRef(false);
  isPlayingRef.current = isPlaying;

  const isTypingRef = useRef(false);
  isTypingRef.current = searchQuery.length > 0;

  const isModalOpenRef = useRef(false);
  isModalOpenRef.current = albumModalVn !== null || renameTargetVn !== null;

  const lastShakeTimeRef = useRef(0);
  const isSurprisingRef = useRef(false);

  // Animated button scale on tap
  const addBtnScale = useSharedValue(1);
  const animatedAddBtnStyle = useAnimatedStyle(() => ({
    transform: [{ scale: addBtnScale.value }],
  }));

  const loadData = useCallback(async () => {
    try {
      const vnData = await vnRepository.getAllVns();
      const albums = await albumRepository.getAllAlbums();
      setVns(vnData);
      setAlbumCount(albums.length);
    } catch (err: any) {
      console.warn('Error loading library data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleAccelerometerData = useCallback(
    (data: { x: number; y: number; z: number }) => {
      const magnitude = Math.sqrt(data.x * data.x + data.y * data.y + data.z * data.z);
      const delta = Math.abs(magnitude - 1.0);

      // Robust shake threshold: spike deviation > 1.1G or total magnitude > 2.2G
      if (delta > 1.1 || magnitude > 2.2) {
        const now = Date.now();
        // 1. 5-second cooldown
        if (now - lastShakeTimeRef.current < 5000) return;
        // 2. Strict guard: never interrupt active playback
        if (isPlayingRef.current) return;
        // 3. Strict guard: never interrupt while user is typing
        if (isTypingRef.current) return;
        // 4. Strict guard: never interrupt open modals / action sheets
        if (isModalOpenRef.current) return;
        // 5. Prevent double surprise triggers
        if (isSurprisingRef.current) return;

        lastShakeTimeRef.current = now;
        isSurprisingRef.current = true;

        teddyPickerService
          .pickVoiceNote(currentVn?.id)
          .then((result) => {
            if (result.status === 'success') {
              teddyReactionService.trigger('SHAKE_SURPRISE');
              router.push(`/player/${result.vn.id}` as any);
            } else if (result.status === 'empty') {
              teddyReactionService.trigger('EMPTY_LIBRARY');
            } else if (result.status === 'no_valid_audio') {
              teddyReactionService.trigger(
                'CUSTOM',
                "Teddy couldn't find the audio file for this one. 🧸"
              );
            }
          })
          .catch((err) => {
            console.warn('[SHAKE SURPRISE] Pick error:', err);
          })
          .finally(() => {
            setTimeout(() => {
              isSurprisingRef.current = false;
            }, 1500);
          });
      }
    },
    [currentVn?.id, router]
  );

  useFocusEffect(
    useCallback(() => {
      loadData();

      // Subscribe to accelerometer exclusively when dashboard is focused
      let sub: any = null;
      try {
        Accelerometer.setUpdateInterval(120);
        sub = Accelerometer.addListener((data) => {
          handleAccelerometerData(data);
        });
      } catch (err) {
        console.warn('[ACCELEROMETER] Sensor subscription failed:', err);
      }

      // AppState change handling: detach on background, reattach on foreground
      const appSub = AppState.addEventListener('change', (state) => {
        if (state !== 'active') {
          sub?.remove();
          sub = null;
        } else if (!sub) {
          try {
            sub = Accelerometer.addListener((data) => {
              handleAccelerometerData(data);
            });
          } catch {}
        }
      });

      return () => {
        sub?.remove();
        appSub.remove();
      };
    }, [loadData, handleAccelerometerData])
  );

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('library_updated', loadData);
    return () => sub.remove();
  }, [loadData]);

  // Check onboarding preferences on mount
  useEffect(() => {
    let isMounted = true;
    async function initPreferences() {
      try {
        const prefs = await preferencesService.getPreferences();
        if (isMounted) {
          setHasCompletedOnboarding(prefs.hasCompletedOnboarding);
          setUserName(prefs.userName);
        }
      } catch (err) {
        console.warn('Error loading user preferences:', err);
        if (isMounted) {
          setHasCompletedOnboarding(true);
        }
      }
    }
    initPreferences();
    return () => {
      isMounted = false;
    };
  }, []);

  const likedCount = useMemo(() => vns.filter((v) => v.isLiked).length, [vns]);
  const recordedCount = useMemo(() => vns.filter((v) => v.source === 'recorded').length, [vns]);
  const importedCount = useMemo(() => vns.filter((v) => v.source !== 'recorded').length, [vns]);

  const continueListeningVn = useMemo(() => {
    return (
      vns.find(
        (v) =>
          v.lastPosition &&
          v.lastPosition > 2 &&
          v.duration > 0 &&
          v.lastPosition < v.duration - 2
      ) || null
    );
  }, [vns]);

  const pinnedVns = useMemo(() => {
    return vns.filter((v) => v.isPinned);
  }, [vns]);

  const filteredVns = useMemo(() => {
    let list = vns;
    if (selectedTab === 'recorded') {
      list = list.filter((v) => v.source === 'recorded');
    } else if (selectedTab === 'imported') {
      list = list.filter((v) => v.source !== 'recorded');
    }
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter((v) => v.title.toLowerCase().includes(q));
  }, [vns, selectedTab, searchQuery]);

  async function handleTogglePin(vn: VN) {
    const nextState = !vn.isPinned;
    setVns((prev) =>
      prev.map((item) => (item.id === vn.id ? { ...item, isPinned: nextState } : item))
    );
    if (currentVn?.id === vn.id) {
      updateCurrentVnMetadata({ isPinned: nextState });
    }
    try {
      await vnRepository.togglePin(vn.id, nextState);
      DeviceEventEmitter.emit('library_updated');
      teddyReactionService.trigger(nextState ? 'PIN' : 'UNPIN');
    } catch (err) {
      setVns((prev) =>
        prev.map((item) => (item.id === vn.id ? { ...item, isPinned: !nextState } : item))
      );
      if (currentVn?.id === vn.id) {
        updateCurrentVnMetadata({ isPinned: !nextState });
      }
      Alert.alert('Error', 'Could not update pin status.');
    }
  }

  async function handleImportVn() {
    addBtnScale.value = withSequence(
      withSpring(0.92, { damping: 6 }),
      withSpring(1, { damping: 8 })
    );

    setImporting(true);
    try {
      const newVn = await vnService.importVn();
      if (newVn) {
        await loadData();
        teddyReactionService.trigger('CUSTOM', 'Teddy tucked it safely away! 🧸');
      }
    } catch (err: any) {
      Alert.alert('Import Failed', err?.message || 'Could not import audio file.');
    } finally {
      setImporting(false);
    }
  }

  async function handleToggleLike(vn: VN) {
    const nextState = !vn.isLiked;
    // Optimistic UI update
    setVns((prev) =>
      prev.map((item) => (item.id === vn.id ? { ...item, isLiked: nextState } : item))
    );
    if (currentVn?.id === vn.id) {
      updateCurrentVnMetadata({ isLiked: nextState });
    }
    try {
      await vnRepository.toggleLike(vn.id, nextState);
      DeviceEventEmitter.emit('library_updated');
      teddyReactionService.trigger(nextState ? 'LIKE' : 'UNLIKE');
    } catch (err) {
      // Revert on failure
      setVns((prev) =>
        prev.map((item) => (item.id === vn.id ? { ...item, isLiked: !nextState } : item))
      );
      if (currentVn?.id === vn.id) {
        updateCurrentVnMetadata({ isLiked: !nextState });
      }
      Alert.alert('Error', 'Could not update favorite status.');
    }
  }

  function handleOpenRename(vn: VN) {
    setRenameTargetVn(vn);
    setRenameInput(vn.title);
  }

  async function handleSaveRename() {
    const trimmed = renameInput.trim();
    if (!trimmed || !renameTargetVn) return;

    try {
      await vnRepository.updateVnTitle(renameTargetVn.id, trimmed);
      setVns((prev) =>
        prev.map((item) =>
          item.id === renameTargetVn.id ? { ...item, title: trimmed } : item
        )
      );
      if (currentVn?.id === renameTargetVn.id) {
        updateCurrentVnMetadata({ title: trimmed });
      }
      DeviceEventEmitter.emit('library_updated');
      setRenameTargetVn(null);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not rename voice note.');
    }
  }

  function handleDeleteVn(vn: VN) {
    Alert.alert(
      'Delete Voice Note',
      `Delete "${vn.title}" from your keepsakes?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await vnService.deleteVn(vn);
              await loadData();
              teddyReactionService.trigger('DELETE');
            } catch (err: any) {
              Alert.alert('Delete Failed', err?.message || 'Could not delete voice note.');
            }
          },
        },
      ]
    );
  }

  if (hasCompletedOnboarding === null) {
    return (
      <SafeAreaView
        style={[
          styles.safeArea,
          {
            backgroundColor: teddy.background,
            alignItems: 'center',
            justifyContent: 'center',
          },
        ]}>
        <AnimatedTeddy size={84} />
      </SafeAreaView>
    );
  }

  if (!hasCompletedOnboarding) {
    return (
      <TeddyOnboarding
        onComplete={(name) => {
          setUserName(name);
          setHasCompletedOnboarding(true);
        }}
      />
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: teddy.background }]}>
      {/* Top Header Row */}
      <View style={styles.topBar}>
        <View style={styles.titleCol}>
          <View style={styles.titleRow}>
            <Text style={[styles.appTitle, { color: teddy.text }]}>Our Voice</Text>
            <Pressable
              onLongPress={() => {
                if (__DEV__) {
                  Alert.alert(
                    'Dev: Reset Onboarding',
                    'Reset onboarding state for testing? (Your audio recordings & SQLite database will NOT be affected)',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Reset Onboarding',
                        style: 'destructive',
                        onPress: async () => {
                          await preferencesService.resetOnboardingForDev();
                          setHasCompletedOnboarding(false);
                          setUserName('');
                        },
                      },
                    ]
                  );
                }
              }}
              delayLongPress={600}
              style={[styles.badgePill, { backgroundColor: teddy.tagBg }]}>
              <Text style={[styles.badgeText, { color: teddy.primaryDark }]}>🧸 Teddy Mode</Text>
            </Pressable>
          </View>
          {userName ? (
            <Text style={[styles.userGreetingText, { color: teddy.textSecondary }]} numberOfLines={1}>
              Hello {userName} 👋
            </Text>
          ) : null}
        </View>

        {/* Quick Record Action */}
        <Animated.View style={animatedAddBtnStyle}>
          <Pressable
            style={({ pressed }) => [
              styles.addHeaderBtn,
              { backgroundColor: teddy.primary },
              pressed && { opacity: 0.85 },
            ]}
            onPress={() => router.push('/record' as any)}>
            <View style={styles.addBtnContent}>
              <Ionicons name="mic" size={17} color="#FFFFFF" />
              <Text style={styles.addBtnText}>Record</Text>
            </View>
          </Pressable>
        </Animated.View>
      </View>

      {/* Cozy Teddy Search Bar */}
      <View style={styles.searchContainer}>
        <View style={[styles.searchBar, { backgroundColor: teddy.card, borderColor: teddy.border }]}>
          <Ionicons name="search" size={18} color={teddy.textSecondary} style={styles.searchIcon} />
          <TextInput
            style={[styles.searchInput, { color: teddy.text }]}
            placeholder="Search voice notes & keepsakes..."
            placeholderTextColor={teddy.textTertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            clearButtonMode="while-editing"
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={teddy.textSecondary} />
            </Pressable>
          )}
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={teddy.primary} />
        </View>
      ) : (
        <FlatList
          data={filteredVns}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            searchQuery.length === 0 ? (
              <View style={styles.teddyHeaderSection}>
                {/* Hero Teddy Banner Card */}
                <View style={[styles.heroTeddyCard, { backgroundColor: teddy.card, borderColor: teddy.border }]}>
                  <View style={styles.heroTextCol}>
                    <View style={styles.rishiTag}>
                      <Text style={styles.rishiTagText}>Specially made by Rishi ❤️</Text>
                    </View>
                    <Text style={[styles.heroGreeting, { color: teddy.text }]} numberOfLines={2}>
                      {userName ? `Welcome back, ${userName}! 🧸` : 'Welcome back! 🧸'}
                    </Text>
                    <Text style={[styles.heroSubtitle, { color: teddy.textSecondary }]} numberOfLines={2}>
                      Here you can also sing and store other's VNs.
                    </Text>
                    <View style={styles.safeRow}>
                      <Ionicons name="shield-checkmark" size={13} color="#2E7D32" />
                      <Text style={[styles.safeText, { color: teddy.textSecondary }]}>
                        Fully safe & offline.
                      </Text>
                    </View>

                    {/* Dual Action Buttons (Record Voice & Import VN) */}
                    <View style={styles.heroBtnRow}>
                      <Pressable
                        style={({ pressed }) => [
                          styles.heroActionBtn,
                          { backgroundColor: teddy.primary },
                          pressed && { opacity: 0.88 },
                        ]}
                        onPress={() => router.push('/record' as any)}>
                        <Ionicons name="mic" size={15} color="#FFFFFF" />
                        <Text style={styles.heroActionText}>Record Voice</Text>
                      </Pressable>

                      <Pressable
                        style={({ pressed }) => [
                          styles.heroActionBtnSecondary,
                          { backgroundColor: teddy.cardAlt, borderColor: teddy.border },
                          pressed && { opacity: 0.88 },
                        ]}
                        disabled={importing}
                        onPress={handleImportVn}>
                        {importing ? (
                          <ActivityIndicator size="small" color={teddy.primary} />
                        ) : (
                          <>
                            <Ionicons name="add" size={15} color={teddy.text} />
                            <Text style={[styles.heroActionTextSecondary, { color: teddy.text }]}>
                              Import VN
                            </Text>
                          </>
                        )}
                      </Pressable>
                    </View>
                  </View>

                  {/* Animated Teddy Mascot */}
                  <View style={styles.heroMascotBox}>
                    <AnimatedTeddy size={80} isPlaying={isPlaying} />
                  </View>
                </View>

                {/* Continue Listening Card (only appears when there is meaningful unfinished playback) */}
                {continueListeningVn && (
                  <View
                    style={[
                      styles.continueCard,
                      { backgroundColor: teddy.card, borderColor: teddy.border },
                    ]}>
                    <View style={styles.continueHeader}>
                      <View style={[styles.continueBadge, { backgroundColor: '#FEF3C7' }]}>
                        <Text style={[styles.continueBadgeText, { color: '#D97706' }]}>
                          🧸 Continue Listening
                        </Text>
                      </View>
                      <Text style={[styles.continueTimeText, { color: teddy.textSecondary }]}>
                        {formatDuration(continueListeningVn.lastPosition || 0)} / {formatDuration(continueListeningVn.duration)}
                      </Text>
                    </View>

                    <View style={styles.continueBody}>
                      <AppleArtwork
                        id={continueListeningVn.id}
                        title={continueListeningVn.title}
                        size={46}
                        borderRadius={10}
                      />
                      <View style={styles.continueInfo}>
                        <Text style={[styles.continueTitle, { color: teddy.text }]} numberOfLines={1}>
                          {continueListeningVn.title}
                        </Text>
                        <Text style={[styles.continueSubtitle, { color: teddy.textSecondary }]}>
                          Resume from {formatDuration(continueListeningVn.lastPosition || 0)}
                        </Text>
                      </View>

                      <Pressable
                        style={({ pressed }) => [
                          styles.continuePlayBtn,
                          { backgroundColor: teddy.primary },
                          pressed && { opacity: 0.85 },
                        ]}
                        hitSlop={12}
                        onPress={() => {
                          if (currentVn?.id === continueListeningVn.id) {
                            if (isPlaying) {
                              pause();
                            } else {
                              resume();
                              teddyReactionService.trigger('CONTINUE_LISTENING');
                            }
                          } else {
                            playVn(continueListeningVn, continueListeningVn.lastPosition);
                            teddyReactionService.trigger('CONTINUE_LISTENING');
                          }
                        }}>
                        <Ionicons
                          name={currentVn?.id === continueListeningVn.id && isPlaying ? 'pause' : 'play'}
                          size={20}
                          color="#FFFFFF"
                          style={currentVn?.id === continueListeningVn.id && isPlaying ? {} : { marginLeft: 2 }}
                        />
                      </Pressable>
                    </View>
                  </View>
                )}

                {/* 2x2 Navigation Grid */}
                <View style={styles.navGrid}>
                  {/* Row 1: Recorded & Imported */}
                  <View style={styles.cozyNavRow}>
                    {/* Recorded Card */}
                    <Pressable
                      style={({ pressed }) => [
                        styles.cozyCard,
                        { backgroundColor: teddy.card, borderColor: teddy.border },
                        pressed && { opacity: 0.8, transform: [{ scale: 0.98 }] },
                      ]}
                      onPress={() => router.push('/recorded' as any)}>
                      <View style={styles.cozyCardTop}>
                        <View style={[styles.cozyIconCircle, { backgroundColor: '#FEF3C7' }]}>
                          <Ionicons name="mic" size={20} color="#D97706" />
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={teddy.textTertiary} />
                      </View>
                      <Text style={[styles.cozyCardTitle, { color: teddy.text }]}>Recorded 🎙️</Text>
                      <Text style={[styles.cozyCardCount, { color: teddy.textSecondary }]}>
                        {recordedCount} {recordedCount === 1 ? 'recording' : 'recordings'}
                      </Text>
                    </Pressable>

                    {/* Imported Card */}
                    <Pressable
                      style={({ pressed }) => [
                        styles.cozyCard,
                        { backgroundColor: teddy.card, borderColor: teddy.border },
                        pressed && { opacity: 0.8, transform: [{ scale: 0.98 }] },
                      ]}
                      onPress={() => router.push('/imported' as any)}>
                      <View style={styles.cozyCardTop}>
                        <View style={[styles.cozyIconCircle, { backgroundColor: '#E0F2FE' }]}>
                          <Ionicons name="musical-notes" size={20} color="#0284C7" />
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={teddy.textTertiary} />
                      </View>
                      <Text style={[styles.cozyCardTitle, { color: teddy.text }]}>Imported 🎵</Text>
                      <Text style={[styles.cozyCardCount, { color: teddy.textSecondary }]}>
                        {importedCount} {importedCount === 1 ? 'file' : 'files'}
                      </Text>
                    </Pressable>
                  </View>

                  {/* Row 2: Albums & Favorites */}
                  <View style={[styles.cozyNavRow, { marginTop: 10 }]}>
                    {/* Albums Card */}
                    <Pressable
                      style={({ pressed }) => [
                        styles.cozyCard,
                        { backgroundColor: teddy.card, borderColor: teddy.border },
                        pressed && { opacity: 0.8, transform: [{ scale: 0.98 }] },
                      ]}
                      onPress={() => router.push('/albums' as any)}>
                      <View style={styles.cozyCardTop}>
                        <View style={[styles.cozyIconCircle, { backgroundColor: '#F9EAD9' }]}>
                          <Ionicons name="albums" size={20} color={teddy.primary} />
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={teddy.textTertiary} />
                      </View>
                      <Text style={[styles.cozyCardTitle, { color: teddy.text }]}>Albums 📁</Text>
                      <Text style={[styles.cozyCardCount, { color: teddy.textSecondary }]}>
                        {albumCount} collections
                      </Text>
                    </Pressable>

                    {/* Favorites Card */}
                    <Pressable
                      style={({ pressed }) => [
                        styles.cozyCard,
                        { backgroundColor: teddy.card, borderColor: teddy.border },
                        pressed && { opacity: 0.8, transform: [{ scale: 0.98 }] },
                      ]}
                      onPress={() => router.push('/liked' as any)}>
                      <View style={styles.cozyCardTop}>
                        <View style={[styles.cozyIconCircle, { backgroundColor: '#FCE7EA' }]}>
                          <Ionicons name="heart" size={20} color="#E06D7F" />
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={teddy.textTertiary} />
                      </View>
                      <Text style={[styles.cozyCardTitle, { color: teddy.text }]}>Favorites 💖</Text>
                      <Text style={[styles.cozyCardCount, { color: teddy.textSecondary }]}>
                        {likedCount} starred
                      </Text>
                    </Pressable>
                  </View>
                </View>

                {/* Teddy's Pick Card */}
                <TeddyPickCard />

                {/* Pinned Keepsakes Section (only appears when pinnedVns.length > 0) */}
                {pinnedVns.length > 0 && (
                  <View style={styles.pinnedSection}>
                    <View style={styles.pinnedHeaderRow}>
                      <View style={styles.pinnedTitleBadge}>
                        <Ionicons name="pin" size={15} color="#D97706" />
                        <Text style={[styles.pinnedSectionTitle, { color: teddy.text }]}>
                          Pinned Keepsakes ({pinnedVns.length})
                        </Text>
                      </View>
                    </View>

                    <View style={styles.pinnedCardsList}>
                      {pinnedVns.map((pinnedVn) => (
                        <VnItem
                          key={`pinned-${pinnedVn.id}`}
                          vn={pinnedVn}
                          isPlaying={currentVn?.id === pinnedVn.id && isPlaying}
                          onPlay={playVn}
                          onToggleLike={handleToggleLike}
                          onTogglePin={handleTogglePin}
                          onDelete={handleDeleteVn}
                          onRename={handleOpenRename}
                          onAddToAlbum={(v) => setAlbumModalVn(v)}
                          onPress={(v) => router.push(`/player/${v.id}` as any)}
                        />
                      ))}
                    </View>
                  </View>
                )}

                {/* Segmented Filter Pills */}
                <View style={styles.segmentContainer}>
                  <Pressable
                    style={[
                      styles.segmentPill,
                      { backgroundColor: selectedTab === 'all' ? teddy.primary : teddy.card, borderColor: teddy.border },
                    ]}
                    onPress={() => setSelectedTab('all')}>
                    <Text
                      style={[
                        styles.segmentText,
                        { color: selectedTab === 'all' ? '#FFFFFF' : teddy.textSecondary },
                      ]}>
                      All ({vns.length})
                    </Text>
                  </Pressable>

                  <Pressable
                    style={[
                      styles.segmentPill,
                      { backgroundColor: selectedTab === 'recorded' ? teddy.primary : teddy.card, borderColor: teddy.border },
                    ]}
                    onPress={() => setSelectedTab('recorded')}>
                    <Text
                      style={[
                        styles.segmentText,
                        { color: selectedTab === 'recorded' ? '#FFFFFF' : teddy.textSecondary },
                      ]}>
                      🎙️ Recorded ({recordedCount})
                    </Text>
                  </Pressable>

                  <Pressable
                    style={[
                      styles.segmentPill,
                      { backgroundColor: selectedTab === 'imported' ? teddy.primary : teddy.card, borderColor: teddy.border },
                    ]}
                    onPress={() => setSelectedTab('imported')}>
                    <Text
                      style={[
                        styles.segmentText,
                        { color: selectedTab === 'imported' ? '#FFFFFF' : teddy.textSecondary },
                      ]}>
                      🎵 Imported ({importedCount})
                    </Text>
                  </Pressable>
                </View>

                {/* Section Header */}
                <View style={styles.sectionHeader}>
                  <Text style={[styles.sectionTitle, { color: teddy.textSecondary }]}>
                    {selectedTab === 'all'
                      ? '🍯 ALL VOICE KEEPSAKES'
                      : selectedTab === 'recorded'
                      ? '🎙️ RECORDED IN OUR VOICE'
                      : '🎵 IMPORTED FROM DEVICE'}
                  </Text>
                </View>
              </View>
            ) : (
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: teddy.textSecondary }]}>
                  SEARCH RESULTS ({filteredVns.length})
                </Text>
              </View>
            )
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={styles.emptyTeddyBox}>
                <AnimatedTeddy size={90} />
              </View>
              <Text style={[styles.emptyTitle, { color: teddy.text }]}>
                {searchQuery ? 'No Matching Keepsakes' : 'Your Voice Journal is Quiet 🧸'}
              </Text>
              <Text style={[styles.emptySubtitle, { color: teddy.textSecondary }]}>
                {searchQuery
                  ? `No voice notes matching "${searchQuery}".`
                  : 'Start by recording your singing or importing your favorite voice notes.'}
              </Text>
              {!searchQuery && (
                <View style={styles.emptyActionRow}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.emptyBtn,
                      { backgroundColor: teddy.primary },
                      pressed && { opacity: 0.85 },
                    ]}
                    onPress={() => router.push('/record' as any)}>
                    <Ionicons name="mic" size={16} color="#FFFFFF" />
                    <Text style={styles.emptyBtnText}>Record Voice</Text>
                  </Pressable>

                  <Pressable
                    style={({ pressed }) => [
                      styles.emptyBtnSecondary,
                      { backgroundColor: teddy.card, borderColor: teddy.border },
                      pressed && { opacity: 0.85 },
                    ]}
                    onPress={handleImportVn}>
                    <Ionicons name="add" size={16} color={teddy.text} />
                    <Text style={[styles.emptyBtnTextSecondary, { color: teddy.text }]}>Import VN</Text>
                  </Pressable>
                </View>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <VnItem
              vn={item}
              isPlaying={currentVn?.id === item.id && isPlaying}
              onPlay={playVn}
              onToggleLike={handleToggleLike}
              onTogglePin={handleTogglePin}
              onDelete={handleDeleteVn}
              onRename={handleOpenRename}
              onAddToAlbum={(vn) => setAlbumModalVn(vn)}
              onPress={(vn) => router.push(`/player/${vn.id}` as any)}
            />
          )}
        />
      )}

      {/* Floating Mini Player */}
      <MiniPlayer />

      {/* Add To Album Modal */}
      <AddToAlbumModal
        vn={albumModalVn}
        visible={!!albumModalVn}
        onClose={() => setAlbumModalVn(null)}
      />

      {/* Rename Modal */}
      <Modal
        visible={!!renameTargetVn}
        transparent
        animationType="fade"
        onRequestClose={() => setRenameTargetVn(null)}>
        <Pressable style={styles.renameBackdrop} onPress={() => setRenameTargetVn(null)}>
          <Pressable
            style={[styles.renameCard, { backgroundColor: teddy.card, borderColor: teddy.border }]}
            onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.renameTitle, { color: teddy.text }]}>Rename Voice Note ✏️</Text>
            <TextInput
              style={[
                styles.renameInput,
                {
                  color: teddy.text,
                  backgroundColor: teddy.cardAlt,
                  borderColor: teddy.border,
                },
              ]}
              value={renameInput}
              onChangeText={setRenameInput}
              autoFocus
            />
            <View style={styles.renameBtnRow}>
              <Pressable
                style={[styles.renameBtn, { backgroundColor: teddy.cardAlt }]}
                onPress={() => setRenameTargetVn(null)}>
                <Text style={[styles.renameBtnText, { color: teddy.text }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.renameBtn, { backgroundColor: teddy.primary }]}
                onPress={handleSaveRename}>
                <Text style={[styles.renameBtnText, { color: '#FFFFFF' }]}>Save</Text>
              </Pressable>
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
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 4,
  },
  titleCol: {
    justifyContent: 'center',
    flex: 1,
    paddingRight: 8,
  },
  userGreetingText: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  appTitle: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  badgePill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 14,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  addHeaderBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    shadowColor: '#8B5A2B',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  addBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  addBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  searchContainer: {
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 42,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    height: '100%',
    padding: 0,
  },
  listContent: {
    paddingBottom: 24,
    flexGrow: 1,
  },
  teddyHeaderSection: {
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  heroTeddyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
    borderRadius: 24,
    borderWidth: 1,
    marginBottom: 16,
    shadowColor: '#7A4A20',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  heroTextCol: {
    flex: 1,
    paddingRight: 10,
  },
  rishiTag: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(224, 109, 127, 0.12)',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
    marginBottom: 6,
  },
  rishiTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#E06D7F',
  },
  heroGreeting: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.2,
    lineHeight: 23,
    marginBottom: 2,
  },
  heroSubtitle: {
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
    marginBottom: 6,
  },
  safeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 12,
  },
  safeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  heroBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  heroActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 13,
    borderRadius: 14,
  },
  heroActionText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  heroActionBtnSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  heroActionTextSecondary: {
    fontSize: 13,
    fontWeight: '700',
  },
  heroMascotBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  navGrid: {
    marginBottom: 16,
  },
  cozyNavRow: {
    flexDirection: 'row',
    gap: 10,
  },
  cozyCard: {
    flex: 1,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  cozyCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  cozyIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cozyCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  cozyCardCount: {
    fontSize: 12,
    fontWeight: '500',
  },
  segmentContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  continueCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    marginBottom: 16,
    shadowColor: '#7A4A20',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  continueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  continueBadge: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  continueBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  continueTimeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  continueBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  continueInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  continueTitle: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  continueSubtitle: {
    fontSize: 12,
    fontWeight: '500',
  },
  continuePlayBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#8B5A2B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  pinnedSection: {
    marginTop: 12,
    marginBottom: 14,
  },
  pinnedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  pinnedTitleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pinnedSectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  pinnedCardsList: {
    marginHorizontal: -16,
    gap: 2,
  },
  segmentPill: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
  },
  sectionHeader: {
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  emptyTeddyBox: {
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  emptyActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 22,
  },
  emptyBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  emptyBtnSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 22,
    borderWidth: 1,
  },
  emptyBtnTextSecondary: {
    fontSize: 14,
    fontWeight: '700',
  },
  renameBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  renameCard: {
    width: '100%',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
  },
  renameTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 14,
  },
  renameInput: {
    height: 46,
    borderRadius: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    fontSize: 15,
    marginBottom: 16,
  },
  renameBtnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  renameBtn: {
    paddingVertical: 9,
    paddingHorizontal: 18,
    borderRadius: 10,
  },
  renameBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
});

