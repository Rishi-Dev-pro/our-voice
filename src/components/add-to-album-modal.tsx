import React, { useEffect, useState } from 'react';
import {
  Alert,
  DeviceEventEmitter,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { albumRepository } from '@/database/repositories/albumRepository';
import { Album, VN } from '@/types/vn';
import { useTheme } from '@/hooks/use-theme';
import { AppleArtwork } from './apple-artwork';

interface AddToAlbumModalProps {
  vn: VN | null;
  visible: boolean;
  onClose: () => void;
}

export function AddToAlbumModal({ vn, visible, onClose }: AddToAlbumModalProps) {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [showCreateInput, setShowCreateInput] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState('');
  const theme = useTheme();

  useEffect(() => {
    if (visible && vn) {
      loadAlbums();
    } else {
      setShowCreateInput(false);
      setNewAlbumName('');
    }
  }, [visible, vn]);

  async function loadAlbums() {
    try {
      const list = await albumRepository.getAllAlbums();
      setAlbums(list);
    } catch (err) {
      console.warn('Error loading albums:', err);
    }
  }

  async function handleSelectAlbum(album: Album) {
    if (!vn) return;
    try {
      await albumRepository.addVnToAlbum(album.id, vn.id);
      DeviceEventEmitter.emit('library_updated');
      Alert.alert('Added', `"${vn.title}" added to "${album.name}".`);
      onClose();
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not add to album.');
    }
  }

  async function handleCreateAndAdd() {
    const trimmed = newAlbumName.trim();
    if (!trimmed) {
      Alert.alert('Validation', 'Please enter a valid album name.');
      return;
    }
    if (!vn) return;

    try {
      const created = await albumRepository.createAlbum(trimmed);
      await albumRepository.addVnToAlbum(created.id, vn.id);
      DeviceEventEmitter.emit('library_updated');
      Alert.alert('Success', `Created "${created.name}" and added "${vn.title}".`);
      onClose();
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not create album.');
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.modalCard,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: theme.separator,
            },
          ]}
          onPress={(e) => e.stopPropagation()}>
          {/* Top Indicator */}
          <View style={styles.dragHandle} />

          <Text style={[styles.modalTitle, { color: theme.text }]}>Add to Album</Text>
          <Text style={[styles.modalSubtitle, { color: theme.textSecondary }]} numberOfLines={1}>
            {vn?.title}
          </Text>

          {showCreateInput ? (
            <View style={styles.createBox}>
              <TextInput
                style={[
                  styles.input,
                  {
                    color: theme.text,
                    backgroundColor: theme.card,
                    borderColor: theme.separator,
                  },
                ]}
                placeholder="New album name..."
                placeholderTextColor={theme.textTertiary}
                value={newAlbumName}
                onChangeText={setNewAlbumName}
                autoFocus
              />
              <View style={styles.buttonRow}>
                <Pressable
                  style={[styles.smallBtn, { backgroundColor: theme.card }]}
                  onPress={() => setShowCreateInput(false)}>
                  <Text style={[styles.btnText, { color: theme.textSecondary }]}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.smallBtn, { backgroundColor: theme.tint }]}
                  onPress={handleCreateAndAdd}>
                  <Text style={[styles.btnText, { color: '#FFFFFF' }]}>Create & Add</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <>
              {/* "+ New Album" Button Row */}
              <Pressable
                style={({ pressed }) => [
                  styles.newAlbumBtn,
                  { backgroundColor: theme.card, borderColor: theme.separator },
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => setShowCreateInput(true)}>
                <Ionicons name="add-circle" size={24} color={theme.tint} />
                <Text style={[styles.newAlbumText, { color: theme.tint }]}>New Album...</Text>
              </Pressable>

              <ScrollView style={styles.albumList} keyboardShouldPersistTaps="handled">
                {albums.length === 0 ? (
                  <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                    No albums created yet.
                  </Text>
                ) : (
                  albums.map((album) => (
                    <Pressable
                      key={album.id}
                      style={({ pressed }) => [
                        styles.albumItem,
                        { borderBottomColor: theme.separator },
                        pressed && { backgroundColor: theme.backgroundSelected },
                      ]}
                      onPress={() => handleSelectAlbum(album)}>
                      <AppleArtwork id={album.id} title={album.name} size={40} borderRadius={8} isAlbum />
                      <View style={styles.albumInfo}>
                        <Text style={[styles.albumName, { color: theme.text }]} numberOfLines={1}>
                          {album.name}
                        </Text>
                        <Text style={[styles.albumCount, { color: theme.textSecondary }]}>
                          {album.vnCount} {album.vnCount === 1 ? 'voice note' : 'voice notes'}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={theme.textTertiary} />
                    </Pressable>
                  ))
                )}
              </ScrollView>
            </>
          )}

          <Pressable
            style={({ pressed }) => [
              styles.cancelBtn,
              { backgroundColor: theme.card },
              pressed && { opacity: 0.8 },
            ]}
            onPress={onClose}>
            <Text style={[styles.cancelText, { color: theme.text }]}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
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
    marginBottom: 16,
  },
  newAlbumBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  newAlbumText: {
    fontSize: 16,
    fontWeight: '600',
  },
  albumList: {
    maxHeight: 260,
    marginBottom: 12,
  },
  albumItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  albumInfo: {
    flex: 1,
    marginLeft: 12,
  },
  albumName: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  albumCount: {
    fontSize: 12,
  },
  emptyText: {
    textAlign: 'center',
    paddingVertical: 24,
    fontSize: 14,
  },
  createBox: {
    gap: 12,
    marginBottom: 16,
  },
  input: {
    height: 46,
    borderRadius: 10,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 15,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  smallBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
  },
  btnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  cancelBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    fontSize: 16,
    fontWeight: '600',
  },
});

