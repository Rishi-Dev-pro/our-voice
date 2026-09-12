import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { VN } from '@/types/vn';
import { AppleArtwork } from './apple-artwork';
import { formatDuration, formatDate } from '@/utils/format';
import { useTheme } from '@/hooks/use-theme';

interface AppleActionSheetProps {
  vn: VN | null;
  visible: boolean;
  isPlaying?: boolean;
  onClose: () => void;
  onPlay: (vn: VN) => void;
  onPlayNext?: (vn: VN) => void;
  onAddToQueue?: (vn: VN) => void;
  onToggleLike: (vn: VN) => void;
  onTogglePin?: (vn: VN) => void;
  onAddToAlbum?: (vn: VN) => void;
  onRename?: (vn: VN) => void;
  onDelete?: (vn: VN) => void;
  onShare?: (vn: VN) => void;
  onTakeAgain?: (vn: VN) => void;
}

export function AppleActionSheet({
  vn,
  visible,
  isPlaying = false,
  onClose,
  onPlay,
  onPlayNext,
  onAddToQueue,
  onToggleLike,
  onTogglePin,
  onAddToAlbum,
  onRename,
  onDelete,
  onShare,
  onTakeAgain,
}: AppleActionSheetProps) {
  const theme = useTheme();

  if (!vn) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable
          style={[styles.sheetContainer, { backgroundColor: theme.backgroundElement }]}
          onPress={(e) => e.stopPropagation()}>
          {/* Top Indicator Drag Bar */}
          <View style={styles.dragHandle} />

          {/* Track Header Card */}
          <View style={[styles.headerCard, { borderBottomColor: theme.separator }]}>
            <AppleArtwork id={vn.id} title={vn.title} size={48} borderRadius={10} />
            <View style={styles.headerInfo}>
              <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>
                {vn.title}
              </Text>
              <Text style={[styles.headerMeta, { color: theme.textSecondary }]}>
                {formatDuration(vn.duration)} • {formatDate(vn.createdAt)}
              </Text>
            </View>
          </View>

          {/* Grouped Action Items */}
          <View style={styles.actionsGroup}>
            {/* Play / Pause */}
            <Pressable
              style={({ pressed }) => [
                styles.actionRow,
                { borderBottomColor: theme.separator },
                pressed && { backgroundColor: theme.backgroundSelected },
              ]}
              onPress={() => {
                onClose();
                onPlay(vn);
              }}>
              <Text style={[styles.actionLabel, { color: theme.text }]}>
                {isPlaying ? 'Pause' : 'Play Voice Note'}
              </Text>
              <Ionicons
                name={isPlaying ? 'pause' : 'play'}
                size={20}
                color={theme.tint}
              />
            </Pressable>

            {/* Play Next */}
            {onPlayNext && (
              <Pressable
                style={({ pressed }) => [
                  styles.actionRow,
                  { borderBottomColor: theme.separator },
                  pressed && { backgroundColor: theme.backgroundSelected },
                ]}
                onPress={() => {
                  onClose();
                  setTimeout(() => {
                    onPlayNext(vn);
                  }, 120);
                }}>
                <Text style={[styles.actionLabel, { color: theme.text }]}>Play Next</Text>
                <Ionicons name="play-skip-forward-outline" size={20} color={theme.tint} />
              </Pressable>
            )}

            {/* Add to Queue */}
            {onAddToQueue && (
              <Pressable
                style={({ pressed }) => [
                  styles.actionRow,
                  { borderBottomColor: theme.separator },
                  pressed && { backgroundColor: theme.backgroundSelected },
                ]}
                onPress={() => {
                  onClose();
                  setTimeout(() => {
                    onAddToQueue(vn);
                  }, 120);
                }}>
                <Text style={[styles.actionLabel, { color: theme.text }]}>Add to Queue</Text>
                <Ionicons name="list-outline" size={20} color={theme.text} />
              </Pressable>
            )}

            {/* Favorite / Unfavorite */}
            <Pressable
              style={({ pressed }) => [
                styles.actionRow,
                { borderBottomColor: theme.separator },
                pressed && { backgroundColor: theme.backgroundSelected },
              ]}
              onPress={() => {
                onClose();
                onToggleLike(vn);
              }}>
              <Text style={[styles.actionLabel, { color: theme.text }]}>
                {vn.isLiked ? 'Undo Favorite' : 'Favorite'}
              </Text>
              <Ionicons
                name={vn.isLiked ? 'heart' : 'heart-outline'}
                size={20}
                color={vn.isLiked ? theme.tint : theme.text}
              />
            </Pressable>

            {/* Pin / Unpin */}
            {onTogglePin && (
              <Pressable
                style={({ pressed }) => [
                  styles.actionRow,
                  { borderBottomColor: theme.separator },
                  pressed && { backgroundColor: theme.backgroundSelected },
                ]}
                onPress={() => {
                  onClose();
                  onTogglePin(vn);
                }}>
                <Text style={[styles.actionLabel, { color: theme.text }]}>
                  {vn.isPinned ? 'Unpin from Top' : 'Pin to Top'}
                </Text>
                <Ionicons
                  name={vn.isPinned ? 'pin' : 'pin-outline'}
                  size={20}
                  color={vn.isPinned ? '#D97706' : theme.text}
                />
              </Pressable>
            )}

            {/* Add to Album */}
            {onAddToAlbum && (
              <Pressable
                style={({ pressed }) => [
                  styles.actionRow,
                  { borderBottomColor: theme.separator },
                  pressed && { backgroundColor: theme.backgroundSelected },
                ]}
                onPress={() => {
                  onClose();
                  setTimeout(() => {
                    onAddToAlbum(vn);
                  }, 150);
                }}>
                <Text style={[styles.actionLabel, { color: theme.text }]}>Add to an Album...</Text>
                <Ionicons name="folder-open-outline" size={20} color={theme.text} />
              </Pressable>
            )}

            {/* Take Again (for recorded VNs) */}
            {onTakeAgain && (
              <Pressable
                style={({ pressed }) => [
                  styles.actionRow,
                  { borderBottomColor: theme.separator },
                  pressed && { backgroundColor: theme.backgroundSelected },
                ]}
                onPress={() => {
                  onClose();
                  setTimeout(() => {
                    onTakeAgain(vn);
                  }, 150);
                }}>
                <Text style={[styles.actionLabel, { color: theme.text }]}>Take Again 🔁</Text>
                <Ionicons name="repeat-outline" size={20} color={theme.text} />
              </Pressable>
            )}

            {/* Share Voice Note */}
            {onShare && (
              <Pressable
                style={({ pressed }) => [
                  styles.actionRow,
                  { borderBottomColor: theme.separator },
                  pressed && { backgroundColor: theme.backgroundSelected },
                ]}
                onPress={() => {
                  onClose();
                  setTimeout(() => {
                    onShare(vn);
                  }, 150);
                }}>
                <Text style={[styles.actionLabel, { color: theme.text }]}>Share Voice Note 📤</Text>
                <Ionicons name="share-outline" size={20} color={theme.text} />
              </Pressable>
            )}

            {/* Rename */}
            {onRename && (
              <Pressable
                style={({ pressed }) => [
                  styles.actionRow,
                  { borderBottomColor: theme.separator },
                  pressed && { backgroundColor: theme.backgroundSelected },
                ]}
                onPress={() => {
                  onClose();
                  setTimeout(() => {
                    onRename(vn);
                  }, 150);
                }}>
                <Text style={[styles.actionLabel, { color: theme.text }]}>Rename</Text>
                <Ionicons name="pencil-outline" size={20} color={theme.text} />
              </Pressable>
            )}

            {/* Delete (Destructive) */}
            {onDelete && (
              <Pressable
                style={({ pressed }) => [
                  styles.actionRow,
                  pressed && { backgroundColor: theme.backgroundSelected },
                ]}
                onPress={() => {
                  onClose();
                  onDelete(vn);
                }}>
                <Text style={[styles.actionLabel, { color: '#FF3B30' }]}>
                  Delete from Library
                </Text>
                <Ionicons name="trash-outline" size={20} color="#FF3B30" />
              </Pressable>
            )}
          </View>

          {/* Cancel Button */}
          <Pressable
            style={({ pressed }) => [
              styles.cancelButton,
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
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
    padding: 12,
  },
  sheetContainer: {
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
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
  headerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
  },
  headerInfo: {
    flex: 1,
    marginLeft: 14,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  headerMeta: {
    fontSize: 13,
    fontWeight: '400',
  },
  actionsGroup: {
    borderRadius: 14,
    overflow: 'hidden',
    marginVertical: 6,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actionLabel: {
    fontSize: 16,
    fontWeight: '500',
    letterSpacing: -0.2,
  },
  cancelButton: {
    marginTop: 10,
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
