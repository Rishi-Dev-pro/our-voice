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

import { vnRepository } from '@/database/repositories/vnRepository';
import { VN } from '@/types/vn';
import { useAudio, PlaybackContext } from '@/services/audioPlayerContext';
import { VnItem } from '@/components/vn-item';
import { MiniPlayer } from '@/components/mini-player';
import { AddToAlbumModal } from '@/components/add-to-album-modal';
import { AppleArtwork } from '@/components/apple-artwork';
import { useTheme } from '@/hooks/use-theme';
import { teddyReactionService } from '@/services/teddyReactionService';

export default function LikedScreen() {
  const [vns, setVns] = useState<VN[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [albumModalVn, setAlbumModalVn] = useState<VN | null>(null);

  const { currentVn, isPlaying, playVn, updateCurrentVnMetadata } = useAudio();
  const router = useRouter();
  const theme = useTheme();

  const loadLikedVns = useCallback(async () => {
    try {
      const data = await vnRepository.getLikedVns();
      setVns(data);
    } catch {
      Alert.alert('Error', 'Could not load favorites.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadLikedVns();
    }, [loadLikedVns])
  );

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('library_updated', loadLikedVns);
    return () => sub.remove();
  }, [loadLikedVns]);

  const filteredVns = useMemo(() => {
    if (!searchQuery.trim()) return vns;
    const q = searchQuery.toLowerCase();
    return vns.filter((v) => v.title.toLowerCase().includes(q));
  }, [vns, searchQuery]);

  async function handleToggleLike(vn: VN) {
    // Unliking from the liked screen removes it from the list
    setVns((prev) => prev.filter((item) => item.id !== vn.id));
    if (currentVn?.id === vn.id) {
      updateCurrentVnMetadata({ isLiked: false });
    }
    try {
      await vnRepository.toggleLike(vn.id, false);
      DeviceEventEmitter.emit('library_updated');
      teddyReactionService.trigger('UNLIKE');
    } catch (err) {
      // Revert if error
      await loadLikedVns();
      if (currentVn?.id === vn.id) {
        updateCurrentVnMetadata({ isLiked: true });
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
      setVns((prev) =>
        prev.map((item) => (item.id === vn.id ? { ...item, isPinned: !nextState } : item))
      );
      if (currentVn?.id === vn.id) {
        updateCurrentVnMetadata({ isPinned: !nextState });
      }
    }
  }

  const likedContext: PlaybackContext = useMemo(
    () => ({
      type: 'liked',
      title: 'Favorites',
      items: filteredVns,
    }),
    [filteredVns]
  );

  function handlePlayAll() {
    if (filteredVns.length > 0) {
      playVn(filteredVns[0], 0, likedContext);
    }
  }

  function handleShufflePlay() {
    if (filteredVns.length > 0) {
      const randomIndex = Math.floor(Math.random() * filteredVns.length);
      playVn(filteredVns[randomIndex], 0, likedContext);
    }
  }

  function handlePlayTrack(track: VN) {
    playVn(track, 0, likedContext);
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
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <View style={[styles.searchBar, { backgroundColor: theme.backgroundElement }]}>
          <Ionicons name="search" size={18} color={theme.textSecondary} style={styles.searchIcon} />
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            placeholder="Search favorite recordings..."
            placeholderTextColor={theme.textTertiary}
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
      </View>

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
          ListHeaderComponent={
            <View style={styles.heroHeader}>
              {/* Centered Large Favorite Artwork Tile */}
              <View style={styles.artworkWrapper}>
                <AppleArtwork
                  title="Favorites"
                  size={160}
                  borderRadius={18}
                  icon="heart"
                />
              </View>

              <Text style={[styles.heroTitle, { color: theme.text }]}>
                Favorite Voice Notes
              </Text>
              <Text style={[styles.heroSubtitle, { color: theme.textSecondary }]}>
                {vns.length} {vns.length === 1 ? 'recording' : 'recordings'}
              </Text>

              {/* Apple Music Dual Action Pills: Play & Shuffle */}
              {filteredVns.length > 0 && (
                <View style={styles.dualPillRow}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.actionPill,
                      { backgroundColor: theme.backgroundElement },
                      pressed && { opacity: 0.75 },
                    ]}
                    onPress={handlePlayAll}>
                    <Ionicons name="play" size={20} color={theme.tint} />
                    <Text style={[styles.actionPillText, { color: theme.tint }]}>Play</Text>
                  </Pressable>

                  <Pressable
                    style={({ pressed }) => [
                      styles.actionPill,
                      { backgroundColor: theme.backgroundElement },
                      pressed && { opacity: 0.75 },
                    ]}
                    onPress={handleShufflePlay}>
                    <Ionicons name="shuffle" size={20} color={theme.tint} />
                    <Text style={[styles.actionPillText, { color: theme.tint }]}>Shuffle</Text>
                  </Pressable>
                </View>
              )}
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={[styles.emptyIconCircle, { backgroundColor: theme.accentSoft }]}>
                <Ionicons name="heart-outline" size={40} color={theme.tint} />
              </View>
              <Text style={[styles.emptyTitle, { color: theme.text }]}>
                {searchQuery ? 'No Matching Favorites' : 'No Favorites Yet'}
              </Text>
              <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
                {searchQuery
                  ? `No favorite recordings match "${searchQuery}".`
                  : 'Tap the heart icon on any voice recording in your library to add it here.'}
              </Text>
            </View>
          }
          renderItem={({ item, index }) => (
            <VnItem
              vn={item}
              trackNumber={index + 1}
              isPlaying={currentVn?.id === item.id && isPlaying}
              onPlay={handlePlayTrack}
              onToggleLike={handleToggleLike}
              onTogglePin={handleTogglePin}
              onAddToAlbum={(vn) => setAlbumModalVn(vn)}
              onPress={(vn) => {
                handlePlayTrack(vn);
                router.push(`/player/${vn.id}` as any);
              }}
            />
          )}
        />
      )}

      {/* Floating Island Mini Player */}
      <MiniPlayer />

      {/* Add To Album Modal */}
      <AddToAlbumModal
        vn={albumModalVn}
        visible={!!albumModalVn}
        onClose={() => setAlbumModalVn(null)}
      />
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
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  backText: {
    fontSize: 17,
    fontWeight: '400',
    marginLeft: -4,
  },
  searchContainer: {
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 38,
    borderRadius: 10,
    paddingHorizontal: 10,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    height: '100%',
    padding: 0,
  },
  listContent: {
    paddingBottom: 24,
    flexGrow: 1,
  },
  heroHeader: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 24,
    paddingHorizontal: 24,
  },
  artworkWrapper: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 18,
    elevation: 10,
    marginBottom: 16,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
    textAlign: 'center',
    marginBottom: 4,
  },
  heroSubtitle: {
    fontSize: 14,
    fontWeight: '400',
    marginBottom: 20,
    textAlign: 'center',
  },
  dualPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    paddingHorizontal: 10,
  },
  actionPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 46,
    borderRadius: 12,
  },
  actionPillText: {
    fontSize: 16,
    fontWeight: '600',
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
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 19,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
