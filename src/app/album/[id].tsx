import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { albumRepository } from '@/database/repositories/albumRepository';
import { vnRepository } from '@/database/repositories/vnRepository';
import { Album, VN } from '@/types/vn';
import { useAudio } from '@/services/audioPlayerContext';
import { VnItem } from '@/components/vn-item';
import { MiniPlayer } from '@/components/mini-player';
import { AppleArtwork } from '@/components/apple-artwork';
import { useTheme } from '@/hooks/use-theme';
import { teddyReactionService } from '@/services/teddyReactionService';

export default function AlbumDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const albumId = Array.isArray(id) ? id[0] : id;

  const [album, setAlbum] = useState<Album | null>(null);
  const [vns, setVns] = useState<VN[]>([]);
  const [loading, setLoading] = useState(true);

  // Add VN to Album Picker Modal
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [availableVns, setAvailableVns] = useState<VN[]>([]);

  const { currentVn, isPlaying, playVn, updateCurrentVnMetadata } = useAudio();
  const router = useRouter();
  const theme = useTheme();

  const loadData = useCallback(async () => {
    if (!albumId) return;
    try {
      const albumData = await albumRepository.getAlbumById(albumId);
      const albumVns = await albumRepository.getVnsInAlbum(albumId);
      setAlbum(albumData);
      setVns(albumVns);
    } catch (err) {
      console.warn('Error loading album details:', err);
    } finally {
      setLoading(false);
    }
  }, [albumId]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('library_updated', loadData);
    return () => sub.remove();
  }, [loadData]);

  async function openAddModal() {
    try {
      const allVns = await vnRepository.getAllVns();
      const currentIds = new Set(vns.map((v) => v.id));
      const unassigned = allVns.filter((v) => !currentIds.has(v.id));
      setAvailableVns(unassigned);
      setAddModalVisible(true);
    } catch (err) {
      Alert.alert('Error', 'Could not load library voice notes.');
    }
  }

  async function handleAddVn(vn: VN) {
    if (!albumId) return;
    try {
      await albumRepository.addVnToAlbum(albumId, vn.id);
      setAvailableVns((prev) => prev.filter((item) => item.id !== vn.id));
      DeviceEventEmitter.emit('library_updated');
      await loadData();
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not add voice note to album.');
    }
  }

  async function handleRemoveVn(vn: VN) {
    if (!albumId) return;
    Alert.alert(
      'Remove from Album',
      `Remove "${vn.title}" from this album? The voice note will still remain in your library.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await albumRepository.removeVnFromAlbum(albumId, vn.id);
              DeviceEventEmitter.emit('library_updated');
              await loadData();
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Could not remove voice note.');
            }
          },
        },
      ]
    );
  }

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
    } catch (err) {
      await loadData();
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
    } catch (err) {
      await loadData();
      if (currentVn?.id === vn.id) {
        updateCurrentVnMetadata({ isPinned: !nextState });
      }
    }
  }

  // Apple Music "Play All" Action
  function handlePlayAll() {
    if (vns.length > 0) {
      playVn(vns[0]);
    }
  }

  // Apple Music "Shuffle" Action
  function handleShufflePlay() {
    if (vns.length > 0) {
      const randomIndex = Math.floor(Math.random() * vns.length);
      playVn(vns[randomIndex]);
    }
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      {/* Top Header Bar */}
      <View style={styles.topBar}>
        <Pressable
          style={styles.backBtn}
          hitSlop={12}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/albums'))}>
          <Ionicons name="chevron-back" size={26} color={theme.tint} />
          <Text style={[styles.backText, { color: theme.tint }]}>Albums</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.addTopBtn,
            pressed && { opacity: 0.6 },
          ]}
          onPress={openAddModal}>
          <Ionicons name="add" size={22} color={theme.tint} />
          <Text style={[styles.addTopText, { color: theme.tint }]}>Add</Text>
        </Pressable>
      </View>

      {/* VN List with Hero Album Header */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.tint} />
        </View>
      ) : (
        <FlatList
          data={vns}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.heroHeader}>
              {/* Centered Large Album Artwork Tile */}
              <View style={styles.artworkWrapper}>
                <AppleArtwork
                  id={album?.id}
                  title={album?.name}
                  size={180}
                  borderRadius={18}
                  isAlbum
                />
              </View>

              {/* Album Title & Metadata */}
              <Text style={[styles.albumTitle, { color: theme.text }]} numberOfLines={2}>
                {album?.name || 'Album'}
              </Text>
              <Text style={[styles.albumSubtitle, { color: theme.textSecondary }]}>
                Voice Notes • {vns.length} {vns.length === 1 ? 'track' : 'tracks'}
              </Text>

              {/* Apple Music Dual Action Pills: Play & Shuffle */}
              {vns.length > 0 && (
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
                <Ionicons name="folder-open-outline" size={40} color={theme.tint} />
              </View>
              <Text style={[styles.emptyTitle, { color: theme.text }]}>This Album is Empty</Text>
              <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
                Add voice recordings from your library to keep them organized in this album.
              </Text>
              <Pressable
                style={({ pressed }) => [
                  styles.emptyBtn,
                  { backgroundColor: theme.tint },
                  pressed && { opacity: 0.8 },
                ]}
                onPress={openAddModal}>
                <Text style={styles.emptyBtnText}>Add Voice Notes</Text>
              </Pressable>
            </View>
          }
          renderItem={({ item, index }) => (
            <VnItem
              vn={item}
              trackNumber={index + 1}
              isPlaying={currentVn?.id === item.id && isPlaying}
              onPlay={playVn}
              onToggleLike={handleToggleLike}
              onTogglePin={handleTogglePin}
              onRemoveFromAlbum={handleRemoveVn}
              onPress={(vn) => router.push(`/player/${vn.id}` as any)}
            />
          )}
        />
      )}

      {/* Floating Mini Player */}
      <MiniPlayer />

      {/* Add VNs from Library Modal */}
      <Modal
        visible={addModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAddModalVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setAddModalVisible(false)}>
          <Pressable
            style={[
              styles.modalCard,
              { backgroundColor: theme.backgroundElement, borderColor: theme.separator },
            ]}
            onPress={(e) => e.stopPropagation()}>
            <View style={styles.dragHandle} />
            <Text style={[styles.modalTitle, { color: theme.text }]}>Add to "{album?.name}"</Text>
            <Text style={[styles.modalSubtitle, { color: theme.textSecondary }]}>
              Select recordings from your library:
            </Text>

            <ScrollView style={styles.availableList} keyboardShouldPersistTaps="handled">
              {availableVns.length === 0 ? (
                <Text style={[styles.noMoreText, { color: theme.textSecondary }]}>
                  All voice notes from your library are already in this album.
                </Text>
              ) : (
                availableVns.map((item) => (
                  <Pressable
                    key={item.id}
                    style={({ pressed }) => [
                      styles.availableItem,
                      { borderBottomColor: theme.separator },
                      pressed && { backgroundColor: theme.backgroundSelected },
                    ]}
                    onPress={() => handleAddVn(item)}>
                    <AppleArtwork id={item.id} title={item.title} size={40} borderRadius={8} />
                    <View style={styles.availableInfo}>
                      <Text style={[styles.availableTitle, { color: theme.text }]} numberOfLines={1}>
                        {item.title}
                      </Text>
                    </View>
                    <Ionicons name="add-circle" size={24} color={theme.tint} />
                  </Pressable>
                ))
              )}
            </ScrollView>

            <Pressable
              style={({ pressed }) => [
                styles.modalDoneBtn,
                { backgroundColor: theme.card },
                pressed && { opacity: 0.8 },
              ]}
              onPress={() => setAddModalVisible(false)}>
              <Text style={[styles.modalDoneText, { color: theme.text }]}>Done</Text>
            </Pressable>
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
  addTopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  addTopText: {
    fontSize: 17,
    fontWeight: '600',
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
    marginBottom: 18,
  },
  albumTitle: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
    textAlign: 'center',
    marginBottom: 4,
  },
  albumSubtitle: {
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
    paddingVertical: 50,
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
    marginBottom: 20,
    lineHeight: 20,
  },
  emptyBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 22,
  },
  emptyBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
    padding: 12,
  },
  modalCard: {
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 12,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(142, 142, 147, 0.4)',
    alignSelf: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  modalSubtitle: {
    fontSize: 13,
    marginBottom: 14,
  },
  availableList: {
    maxHeight: 280,
    marginBottom: 12,
  },
  availableItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  availableInfo: {
    flex: 1,
    marginLeft: 12,
  },
  availableTitle: {
    fontSize: 15,
    fontWeight: '500',
  },
  noMoreText: {
    textAlign: 'center',
    paddingVertical: 24,
    fontSize: 14,
    lineHeight: 20,
  },
  modalDoneBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalDoneText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
