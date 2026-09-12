import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { recentlyPlayedRepository } from '@/database/repositories/recentlyPlayedRepository';
import { vnRepository } from '@/database/repositories/vnRepository';
import { VN } from '@/types/vn';
import { useAudioState, useAudioActions, PlaybackContext } from '@/services/audioPlayerContext';
import { VnItem } from '@/components/vn-item';
import { MiniPlayer } from '@/components/mini-player';
import { AddToAlbumModal } from '@/components/add-to-album-modal';
import { AppleArtwork } from '@/components/apple-artwork';
import { useTheme } from '@/hooks/use-theme';
import { teddyReactionService } from '@/services/teddyReactionService';

export default function RecentlyPlayedScreen() {
  const [vns, setVns] = useState<VN[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [albumModalVn, setAlbumModalVn] = useState<VN | null>(null);

  const { currentVn, isPlaying } = useAudioState();
  const { playVn, shuffleAll, addAlbumToQueue, updateCurrentVnMetadata } = useAudioActions();
  const router = useRouter();
  const theme = useTheme();

  const loadRecentVns = useCallback(async () => {
    try {
      const data = await recentlyPlayedRepository.getRecentlyPlayed(50);
      setVns(data);
    } catch {
      Alert.alert('Error', 'Could not load recently played recordings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadRecentVns();
    }, [loadRecentVns])
  );

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('library_updated', loadRecentVns);
    return () => sub.remove();
  }, [loadRecentVns]);

  const filteredVns = useMemo(() => {
    if (!searchQuery.trim()) return vns;
    const query = searchQuery.toLowerCase().trim();
    return vns.filter((vn) => vn.title.toLowerCase().includes(query));
  }, [vns, searchQuery]);

  async function handleToggleLike(vn: VN) {
    const nextState = !vn.isLiked;
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
    } catch {
      await loadRecentVns();
      if (currentVn?.id === vn.id) {
        updateCurrentVnMetadata({ isLiked: !nextState });
      }
    }
  }

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
    } catch {
      await loadRecentVns();
      if (currentVn?.id === vn.id) {
        updateCurrentVnMetadata({ isPinned: !nextState });
      }
    }
  }

  function handleClearHistory() {
    if (vns.length === 0) return;
    Alert.alert(
      'Clear Recently Played',
      'Clear your playback history? Your recordings will still remain in your library.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              await recentlyPlayedRepository.clearRecentlyPlayed();
              setVns([]);
              DeviceEventEmitter.emit('library_updated');
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Could not clear history.');
            }
          },
        },
      ]
    );
  }

  // Playback Context for Recently Played
  const recentContext: PlaybackContext = {
    type: 'recent',
    title: 'Recently Played',
    items: filteredVns,
  };

  // Play All
  function handlePlayAll() {
    if (filteredVns.length > 0) {
      playVn(filteredVns[0], 0, recentContext);
    }
  }

  // Shuffle
  function handleShufflePlay() {
    if (filteredVns.length > 0) {
      shuffleAll(filteredVns, recentContext);
    }
  }

  function handleQueueAll() {
    if (filteredVns.length === 0) return;
    const res = addAlbumToQueue(filteredVns);
    if (res.addedCount > 0) {
      Alert.alert(
        'Queue Updated',
        `Added ${res.addedCount} recording${res.addedCount > 1 ? 's' : ''} to Up Next queue.`
      );
      teddyReactionService.trigger('CUSTOM', 'Added to Up Next! 🧸🎶');
    } else {
      Alert.alert('Already in Queue', 'All recent recordings are already in your queue.');
    }
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      {/* Top Header Bar */}
      <View style={styles.topBar}>
        <Pressable
          style={styles.backBtn}
          hitSlop={12}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
          <Ionicons name="chevron-back" size={26} color={theme.tint} />
          <Text style={[styles.backText, { color: theme.tint }]}>Library</Text>
        </Pressable>

        {vns.length > 0 && (
          <Pressable
            style={({ pressed }) => [styles.clearBtn, pressed && { opacity: 0.6 }]}
            hitSlop={8}
            onPress={handleClearHistory}>
            <Text style={[styles.clearText, { color: theme.tint }]}>Clear</Text>
          </Pressable>
        )}
      </View>

      {/* Header Info */}
      <View style={styles.headerInfo}>
        <View style={styles.artworkContainer}>
          <AppleArtwork title="Recently Played" size={120} borderRadius={16} isAlbum={false} />
        </View>
        <Text style={[styles.title, { color: theme.text }]}>Recently Played</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          {vns.length} {vns.length === 1 ? 'recording' : 'recordings'}
        </Text>
      </View>

      {/* Dual Play / Shuffle Buttons */}
      {vns.length > 0 && (
        <View style={styles.buttonRow}>
          <Pressable
            style={({ pressed }) => [
              styles.actionButton,
              { backgroundColor: theme.backgroundElement },
              pressed && { opacity: 0.75 },
            ]}
            onPress={handlePlayAll}>
            <Ionicons name="play" size={20} color={theme.tint} />
            <Text style={[styles.actionButtonText, { color: theme.tint }]}>Play</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.actionButton,
              { backgroundColor: theme.backgroundElement },
              pressed && { opacity: 0.75 },
            ]}
            onPress={handleShufflePlay}>
            <Ionicons name="shuffle" size={20} color={theme.tint} />
            <Text style={[styles.actionButtonText, { color: theme.tint }]}>Shuffle</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.actionButtonSmall,
              { backgroundColor: theme.backgroundElement },
              pressed && { opacity: 0.75 },
            ]}
            onPress={handleQueueAll}>
            <Ionicons name="list" size={18} color={theme.textSecondary} />
          </Pressable>
        </View>
      )}

      {/* Search Bar */}
      {vns.length > 5 && (
        <View
          style={[
            styles.searchContainer,
            { backgroundColor: theme.backgroundElement, borderColor: theme.separator },
          ]}>
          <Ionicons name="search" size={18} color={theme.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            placeholder="Search recent voice notes..."
            placeholderTextColor={theme.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            clearButtonMode="while-editing"
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
            </Pressable>
          )}
        </View>
      )}

      {/* List */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.tint} />
        </View>
      ) : (
        <FlatList
          data={filteredVns}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <VnItem
              vn={item}
              isPlaying={isPlaying && currentVn?.id === item.id}
              onPlay={() => playVn(item, 0, recentContext)}
              onToggleLike={() => handleToggleLike(item)}
              onTogglePin={() => handleTogglePin(item)}
              onAddToAlbum={(vn) => setAlbumModalVn(vn)}
            />
          )}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={[styles.emptyIconCircle, { backgroundColor: theme.accentSoft }]}>
                <Ionicons name="time-outline" size={40} color={theme.tint} />
              </View>
              <Text style={[styles.emptyTitle, { color: theme.text }]}>No Recent Recordings</Text>
              <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
                Voice notes you listen to will automatically appear here.
              </Text>
            </View>
          }
        />
      )}

      {/* Add to Album Modal */}
      <AddToAlbumModal
        vn={albumModalVn}
        visible={albumModalVn !== null}
        onClose={() => setAlbumModalVn(null)}
      />

      {/* Persistent Mini Player */}
      <MiniPlayer />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: -4,
  },
  backText: {
    fontSize: 17,
    fontWeight: '400',
    marginLeft: 2,
  },
  clearBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  clearText: {
    fontSize: 16,
    fontWeight: '500',
  },
  headerInfo: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 16,
    paddingHorizontal: 20,
  },
  artworkContainer: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
    marginBottom: 14,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '400',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: 16,
    alignItems: 'center',
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
    borderRadius: 12,
  },
  actionButtonSmall: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
  listContent: {
    paddingBottom: 24,
    flexGrow: 1,
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
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 19,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
