import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  FlatList,
  Modal,
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
import { vnService } from '@/services/vnService';
import { VN } from '@/types/vn';
import { useAudio } from '@/services/audioPlayerContext';
import { VnItem } from '@/components/vn-item';
import { MiniPlayer } from '@/components/mini-player';
import { AddToAlbumModal } from '@/components/add-to-album-modal';
import { AppleArtwork } from '@/components/apple-artwork';
import { useTheme } from '@/hooks/use-theme';
import { sharingService } from '@/services/sharingService';
import { teddyReactionService } from '@/services/teddyReactionService';

export default function RecordedScreen() {
  const [vns, setVns] = useState<VN[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [albumModalVn, setAlbumModalVn] = useState<VN | null>(null);

  // Rename modal state
  const [renameTargetVn, setRenameTargetVn] = useState<VN | null>(null);
  const [renameInput, setRenameInput] = useState('');

  const { currentVn, isPlaying, playVn, updateCurrentVnMetadata } = useAudio();
  const router = useRouter();
  const theme = useTheme();

  const loadData = useCallback(async () => {
    try {
      const data = await vnRepository.getRecordedVns();
      setVns(data);
    } catch (err) {
      console.warn('Error loading recorded VNs:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('library_updated', loadData);
    return () => sub.remove();
  }, [loadData]);

  const filteredVns = useMemo(() => {
    if (!searchQuery.trim()) return vns;
    const q = searchQuery.toLowerCase();
    return vns.filter((v) => v.title.toLowerCase().includes(q));
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
      setVns((prev) =>
        prev.map((item) => (item.id === vn.id ? { ...item, isLiked: !nextState } : item))
      );
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
      setVns((prev) =>
        prev.map((item) => (item.id === vn.id ? { ...item, isPinned: !nextState } : item))
      );
      if (currentVn?.id === vn.id) {
        updateCurrentVnMetadata({ isPinned: !nextState });
      }
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
    } catch {
      Alert.alert('Error', 'Could not rename recording.');
    }
  }

  function handleDeleteVn(vn: VN) {
    Alert.alert(
      'Delete Recording',
      `Are you sure you want to delete "${vn.title}"? The recording will be permanently deleted.`,
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
              Alert.alert('Delete Failed', err?.message || 'Could not delete recording.');
            }
          },
        },
      ]
    );
  }

  function handleTakeAgain(vn: VN) {
    teddyReactionService.trigger('TAKE_AGAIN');
    router.push(`/record?takeBaseTitle=${encodeURIComponent(vn.title)}` as any);
  }

  async function handleShare(vn: VN) {
    await sharingService.shareVnAudio(vn);
    teddyReactionService.trigger('SHARE');
  }

  function handlePlayAll() {
    if (filteredVns.length > 0) {
      playVn(filteredVns[0]);
    }
  }

  function handleShufflePlay() {
    if (filteredVns.length > 0) {
      const randomIndex = Math.floor(Math.random() * filteredVns.length);
      playVn(filteredVns[randomIndex]);
    }
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      {/* Top Header */}
      <View style={styles.topBar}>
        <Pressable
          style={styles.backBtn}
          hitSlop={12}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
          <Ionicons name="chevron-back" size={26} color={theme.tint} />
          <Text style={[styles.backText, { color: theme.tint }]}>Library</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.actionTopBtn,
            pressed && { opacity: 0.6 },
          ]}
          onPress={() => router.push('/record' as any)}>
          <Ionicons name="mic" size={20} color={theme.tint} />
          <Text style={[styles.actionTopText, { color: theme.tint }]}>Record</Text>
        </Pressable>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <View style={[styles.searchBar, { backgroundColor: theme.backgroundElement }]}>
          <Ionicons name="search" size={18} color={theme.textSecondary} style={styles.searchIcon} />
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            placeholder="Search voice recordings..."
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
              <View style={styles.artworkWrapper}>
                <AppleArtwork title="Recorded" size={150} borderRadius={18} icon="mic" />
              </View>
              <Text style={[styles.heroTitle, { color: theme.text }]}>Voice Recordings</Text>
              <Text style={[styles.heroSubtitle, { color: theme.textSecondary }]}>
                {vns.length} {vns.length === 1 ? 'recording created' : 'recordings created'} in Our Voice
              </Text>

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
                <Ionicons name="mic-outline" size={40} color={theme.tint} />
              </View>
              <Text style={[styles.emptyTitle, { color: theme.text }]}>
                {searchQuery ? 'No Matching Recordings' : 'No Voice Recordings Yet'}
              </Text>
              <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
                {searchQuery
                  ? `No voice recordings match "${searchQuery}".`
                  : 'Record your singing, thoughts, or keepsakes directly inside Our Voice.'}
              </Text>
              {!searchQuery && (
                <Pressable
                  style={({ pressed }) => [
                    styles.emptyBtn,
                    { backgroundColor: theme.tint },
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={() => router.push('/record' as any)}>
                  <Text style={styles.emptyBtnText}>Start Recording</Text>
                </Pressable>
              )}
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
              onRename={handleOpenRename}
              onDelete={handleDeleteVn}
              onAddToAlbum={(vn) => setAlbumModalVn(vn)}
              onTakeAgain={handleTakeAgain}
              onShare={handleShare}
              onPress={(vn) => router.push(`/player/${vn.id}` as any)}
            />
          )}
        />
      )}

      {/* Mini Player */}
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
        <Pressable style={styles.modalBackdrop} onPress={() => setRenameTargetVn(null)}>
          <Pressable
            style={[
              styles.modalCard,
              { backgroundColor: theme.card, borderColor: theme.separator },
            ]}
            onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Rename Voice Note</Text>
            <TextInput
              style={[
                styles.modalInput,
                {
                  color: theme.text,
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.separator,
                },
              ]}
              value={renameInput}
              onChangeText={setRenameInput}
              autoFocus
              selectTextOnFocus
            />
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalBtn, { backgroundColor: theme.backgroundElement }]}
                onPress={() => setRenameTargetVn(null)}>
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
    marginLeft: -4,
  },
  actionTopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  actionTopText: {
    fontSize: 17,
    fontWeight: '600',
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
    paddingTop: 8,
    paddingBottom: 20,
    paddingHorizontal: 24,
  },
  artworkWrapper: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 8,
    marginBottom: 14,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  heroSubtitle: {
    fontSize: 14,
    marginBottom: 18,
  },
  dualPillRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    paddingHorizontal: 12,
  },
  actionPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
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
  modalInput: {
    height: 44,
    borderRadius: 10,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 15,
    marginBottom: 16,
  },
  modalActions: {
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
