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
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { albumRepository } from '@/database/repositories/albumRepository';
import { Album } from '@/types/vn';
import { MiniPlayer } from '@/components/mini-player';
import { AppleArtwork } from '@/components/apple-artwork';
import { useTheme } from '@/hooks/use-theme';

export default function AlbumsScreen() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Create / Rename Modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [editingAlbum, setEditingAlbum] = useState<Album | null>(null);
  const [albumNameInput, setAlbumNameInput] = useState('');

  const router = useRouter();
  const theme = useTheme();
  const { width: screenWidth } = useWindowDimensions();

  const loadAlbums = useCallback(async () => {
    try {
      const data = await albumRepository.getAllAlbums();
      setAlbums(data);
    } catch (err) {
      console.warn('Error loading albums:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadAlbums();
    }, [loadAlbums])
  );

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('library_updated', loadAlbums);
    return () => sub.remove();
  }, [loadAlbums]);

  const filteredAlbums = useMemo(() => {
    if (!searchQuery.trim()) return albums;
    const q = searchQuery.toLowerCase();
    return albums.filter((a) => a.name.toLowerCase().includes(q));
  }, [albums, searchQuery]);

  function openCreateModal() {
    setEditingAlbum(null);
    setAlbumNameInput('');
    setModalVisible(true);
  }

  function openRenameModal(album: Album) {
    setEditingAlbum(album);
    setAlbumNameInput(album.name);
    setModalVisible(true);
  }

  async function handleSaveAlbum() {
    const trimmed = albumNameInput.trim();
    if (!trimmed) {
      Alert.alert('Validation Error', 'Album name cannot be empty.');
      return;
    }

    try {
      if (editingAlbum) {
        await albumRepository.renameAlbum(editingAlbum.id, trimmed);
      } else {
        await albumRepository.createAlbum(trimmed);
      }
      setModalVisible(false);
      DeviceEventEmitter.emit('library_updated');
      await loadAlbums();
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not save album.');
    }
  }

  function handleDeleteAlbum(album: Album) {
    Alert.alert(
      'Delete Album',
      `Are you sure you want to delete "${album.name}"? Voice notes inside this album will NOT be deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await albumRepository.deleteAlbum(album.id);
              DeviceEventEmitter.emit('library_updated');
              await loadAlbums();
            } catch (err: any) {
              Alert.alert('Delete Failed', err?.message || 'Could not delete album.');
            }
          },
        },
      ]
    );
  }

  const columnWidth = (screenWidth - 48) / 2;

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

        <Pressable
          style={({ pressed }) => [
            styles.createBtn,
            pressed && { opacity: 0.6 },
          ]}
          onPress={openCreateModal}>
          <Ionicons name="add" size={20} color={theme.tint} />
          <Text style={[styles.createText, { color: theme.tint }]}>New</Text>
        </Pressable>
      </View>

      {/* Large Title */}
      <View style={styles.titleSection}>
        <Text style={[styles.largeTitle, { color: theme.text }]}>Albums</Text>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <View style={[styles.searchBar, { backgroundColor: theme.backgroundElement }]}>
          <Ionicons name="search" size={18} color={theme.textSecondary} style={styles.searchIcon} />
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            placeholder="Search albums..."
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

      {/* 2-Column Grid */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.tint} />
        </View>
      ) : (
        <FlatList
          data={filteredAlbums}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={styles.listContent}
          columnWrapperStyle={styles.columnWrapper}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={[styles.emptyIconCircle, { backgroundColor: theme.accentSoft }]}>
                <Ionicons name="albums-outline" size={44} color={theme.tint} />
              </View>
              <Text style={[styles.emptyTitle, { color: theme.text }]}>
                {searchQuery ? 'No Albums Found' : 'No Albums Yet'}
              </Text>
              <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
                {searchQuery
                  ? `No albums match "${searchQuery}".`
                  : 'Create albums to organize your voice notes into themed collections.'}
              </Text>
              {!searchQuery && (
                <Pressable
                  style={({ pressed }) => [
                    styles.emptyBtn,
                    { backgroundColor: theme.tint },
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={openCreateModal}>
                  <Text style={styles.emptyBtnText}>Create Album</Text>
                </Pressable>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [
                styles.gridCard,
                { width: columnWidth },
                pressed && { opacity: 0.85 },
              ]}
              onPress={() => router.push(`/album/${item.id}` as any)}>
              {/* Album Artwork Tile */}
              <AppleArtwork
                id={item.id}
                title={item.name}
                size={columnWidth}
                borderRadius={14}
                isAlbum
              />

              {/* Album Text Info */}
              <View style={styles.cardInfo}>
                <Text style={[styles.albumName, { color: theme.text }]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={[styles.albumMeta, { color: theme.textSecondary }]}>
                  {item.vnCount} {item.vnCount === 1 ? 'voice note' : 'voice notes'}
                </Text>
              </View>

              {/* Action Sheet Menu Dots */}
              <Pressable
                style={styles.cardMenuDots}
                hitSlop={8}
                onPress={(e) => {
                  e.stopPropagation();
                  Alert.alert(item.name, 'Album Options', [
                    { text: 'Rename', onPress: () => openRenameModal(item) },
                    { text: 'Delete', style: 'destructive', onPress: () => handleDeleteAlbum(item) },
                    { text: 'Cancel', style: 'cancel' },
                  ]);
                }}>
                <Ionicons name="ellipsis-horizontal" size={16} color={theme.textSecondary} />
              </Pressable>
            </Pressable>
          )}
        />
      )}

      {/* Floating Mini Player */}
      <MiniPlayer />

      {/* Create / Rename Modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setModalVisible(false)}>
          <Pressable
            style={[
              styles.modalCard,
              { backgroundColor: theme.card, borderColor: theme.separator },
            ]}
            onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>
              {editingAlbum ? 'Rename Album' : 'New Album'}
            </Text>

            <TextInput
              style={[
                styles.input,
                {
                  color: theme.text,
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.separator,
                },
              ]}
              placeholder="Enter album name"
              placeholderTextColor={theme.textTertiary}
              value={albumNameInput}
              onChangeText={setAlbumNameInput}
              autoFocus
            />

            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.modalBtn, { backgroundColor: theme.backgroundElement }]}
                onPress={() => setModalVisible(false)}>
                <Text style={[styles.modalBtnText, { color: theme.text }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, { backgroundColor: theme.tint }]}
                onPress={handleSaveAlbum}>
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
    fontWeight: '400',
    marginLeft: -4,
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  createText: {
    fontSize: 17,
    fontWeight: '600',
  },
  titleSection: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 6,
  },
  largeTitle: {
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: -0.4,
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
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
    flexGrow: 1,
  },
  columnWrapper: {
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  gridCard: {
    position: 'relative',
  },
  cardInfo: {
    marginTop: 8,
  },
  albumName: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  albumMeta: {
    fontSize: 13,
    fontWeight: '400',
  },
  cardMenuDots: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    borderRadius: 12,
    padding: 5,
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
    paddingVertical: 80,
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
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
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
  input: {
    height: 44,
    borderRadius: 10,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 15,
    marginBottom: 16,
  },
  modalButtons: {
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
