import React from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useAudio } from '@/services/audioPlayerContext';
import { formatDuration } from '@/utils/format';
import { useTheme } from '@/hooks/use-theme';
import { AppleArtwork } from '@/components/apple-artwork';
import { VN } from '@/types/vn';

export default function QueueScreen() {
  const {
    currentVn,
    isPlaying,
    currentTime,
    duration,
    manualQueue,
    playbackContext,
    repeatMode,
    isShuffle,
    shuffledOrder,
    removeFromQueue,
    clearQueue,
    moveQueueItem,
    playVn,
  } = useAudio();

  const router = useRouter();
  const theme = useTheme();

  const handleClearQueue = () => {
    Alert.alert('Clear Queue', 'Remove all items from the manual queue?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: clearQueue },
    ]);
  };

  // Calculate upcoming context items
  const upcomingContextItems: VN[] = React.useMemo(() => {
    if (!playbackContext || playbackContext.items.length === 0) return [];
    const items = playbackContext.items;
    const currentId = currentVn?.id;
    const currentIndex = currentId ? items.findIndex((v) => v.id === currentId) : -1;

    if (currentIndex === -1) {
      return items;
    }

    // When Shuffle is active and we have the shuffled order for this context
    if (isShuffle && shuffledOrder && shuffledOrder.length === items.length) {
      const pointer = shuffledOrder.indexOf(currentIndex);
      if (pointer !== -1) {
        const afterPointer = shuffledOrder
          .slice(pointer + 1)
          .map((idx) => items[idx])
          .filter(Boolean);
        if (repeatMode === 'all') {
          const beforePointer = shuffledOrder
            .slice(0, pointer)
            .map((idx) => items[idx])
            .filter(Boolean);
          return [...afterPointer, ...beforePointer];
        }
        return afterPointer;
      }
    }

    const afterCurrent = items.slice(currentIndex + 1);
    if (repeatMode === 'all') {
      const beforeCurrent = items.slice(0, currentIndex);
      return [...afterCurrent, ...beforeCurrent];
    }
    return afterCurrent;
  }, [playbackContext, currentVn?.id, repeatMode, isShuffle, shuffledOrder]);

  const activeDuration = duration || currentVn?.duration || 0;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      {/* Top Handle */}
      <View style={styles.sheetHandle} />

      {/* Top Bar */}
      <View style={styles.topBar}>
        <Pressable
          style={styles.closeBtn}
          hitSlop={12}
          onPress={() => router.back()}>
          <Ionicons name="chevron-down" size={28} color={theme.text} />
        </Pressable>

        <Text style={[styles.headerTitle, { color: theme.text }]}>Up Next</Text>

        {manualQueue.length > 0 ? (
          <Pressable
            style={styles.clearBtn}
            hitSlop={10}
            onPress={handleClearQueue}>
            <Text style={[styles.clearBtnText, { color: '#EF4444' }]}>Clear</Text>
          </Pressable>
        ) : (
          <View style={{ width: 44 }} />
        )}
      </View>

      <FlatList
        data={manualQueue}
        keyExtractor={(item, index) => `queue-${item.id}-${index}`}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View>
            {/* Now Playing Card */}
            {currentVn && (
              <View style={styles.sectionWrap}>
                <Text style={[styles.sectionHeader, { color: theme.textSecondary }]}>
                  NOW PLAYING
                </Text>
                <Pressable
                  style={[
                    styles.currentCard,
                    {
                      backgroundColor: theme.card,
                      borderColor: '#D97706',
                    },
                  ]}
                  onPress={() => router.back()}>
                  <AppleArtwork
                    id={currentVn.id}
                    title={currentVn.title}
                    size={48}
                    borderRadius={12}
                  />
                  <View style={styles.cardInfo}>
                    <Text style={[styles.cardTitle, { color: '#D97706' }]} numberOfLines={1}>
                      {currentVn.title}
                    </Text>
                    <Text style={[styles.cardMeta, { color: theme.textSecondary }]}>
                      {isPlaying ? 'Playing • ' : 'Paused • '}
                      {formatDuration(currentTime)} / {formatDuration(activeDuration)}
                    </Text>
                  </View>
                  <View style={[styles.playingBadge, { backgroundColor: '#D97706' }]}>
                    <Ionicons
                      name={isPlaying ? 'volume-high' : 'pause'}
                      size={14}
                      color="#FFFFFF"
                    />
                  </View>
                </Pressable>
              </View>
            )}

            {/* Manual Queue Header */}
            <View style={styles.sectionWrap}>
              <View style={styles.queueHeaderRow}>
                <Text style={[styles.sectionHeader, { color: theme.textSecondary }]}>
                  MANUAL QUEUE ({manualQueue.length})
                </Text>
                {repeatMode === 'one' && (
                  <View style={styles.repeatBadge}>
                    <Ionicons name="repeat" size={12} color="#D97706" />
                    <Text style={styles.repeatBadgeText}>Repeat One active</Text>
                  </View>
                )}
              </View>

              {manualQueue.length === 0 && (
                <View
                  style={[
                    styles.emptyQueueBox,
                    { backgroundColor: theme.backgroundElement, borderColor: theme.separator },
                  ]}>
                  <Text style={[styles.emptyQueueTitle, { color: theme.text }]}>
                    Queue is empty 🧸
                  </Text>
                  <Text style={[styles.emptyQueueSub, { color: theme.textSecondary }]}>
                    Use &ldquo;Play Next&rdquo; or &ldquo;Add to Queue&rdquo; from any voice note&apos;s menu to
                    queue up tracks.
                  </Text>
                </View>
              )}
            </View>
          </View>
        }
        renderItem={({ item, index }) => (
          <View
            style={[
              styles.queueItemRow,
              {
                backgroundColor: theme.card,
                borderColor: theme.separator,
              },
            ]}>
            <AppleArtwork id={item.id} title={item.title} size={42} borderRadius={10} />

            <View style={styles.itemCenterInfo}>
              <Text style={[styles.itemTitle, { color: theme.text }]} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={[styles.itemDuration, { color: theme.textSecondary }]}>
                {formatDuration(item.duration)}
              </Text>
            </View>

            {/* Reorder Buttons: Move Up & Move Down */}
            <View style={styles.reorderGroup}>
              <Pressable
                style={[styles.reorderBtn, index === 0 && { opacity: 0.25 }]}
                disabled={index === 0}
                hitSlop={6}
                onPress={() => moveQueueItem(index, 'up')}>
                <Ionicons name="chevron-up" size={18} color={theme.text} />
              </Pressable>

              <Pressable
                style={[
                  styles.reorderBtn,
                  index === manualQueue.length - 1 && { opacity: 0.25 },
                ]}
                disabled={index === manualQueue.length - 1}
                hitSlop={6}
                onPress={() => moveQueueItem(index, 'down')}>
                <Ionicons name="chevron-down" size={18} color={theme.text} />
              </Pressable>
            </View>

            {/* Remove Button */}
            <Pressable
              style={styles.removeBtn}
              hitSlop={8}
              onPress={() => removeFromQueue(item.id)}>
              <Ionicons name="close-circle" size={22} color="#EF4444" />
            </Pressable>
          </View>
        )}
        ListFooterComponent={
          <View style={styles.contextSectionWrap}>
            <View style={styles.queueHeaderRow}>
              <Text style={[styles.sectionHeader, { color: theme.textSecondary }]}>
                CONTINUING FROM {playbackContext?.title?.toUpperCase() || 'ALL SONGS'}
              </Text>
              <Text style={[styles.repeatStatusText, { color: theme.textTertiary }]}>
                {isShuffle ? 'SHUFFLE • ' : ''}Repeat: {repeatMode.toUpperCase()}
              </Text>
            </View>

            {upcomingContextItems.length > 0 ? (
              upcomingContextItems.slice(0, 15).map((contextItem, cIdx) => (
                <Pressable
                  key={`ctx-${contextItem.id}-${cIdx}`}
                  style={({ pressed }) => [
                    styles.contextItemRow,
                    {
                      backgroundColor: theme.card,
                      borderColor: theme.separator,
                    },
                    pressed && { opacity: 0.75 },
                  ]}
                  onPress={() => playVn(contextItem)}>
                  <AppleArtwork
                    id={contextItem.id}
                    title={contextItem.title}
                    size={38}
                    borderRadius={8}
                  />
                  <View style={styles.itemCenterInfo}>
                    <Text
                      style={[styles.itemTitle, { color: theme.text }]}
                      numberOfLines={1}>
                      {contextItem.title}
                    </Text>
                    <Text style={[styles.itemDuration, { color: theme.textSecondary }]}>
                      {formatDuration(contextItem.duration)}
                    </Text>
                  </View>
                  <Ionicons name="play-circle-outline" size={22} color={theme.tint} />
                </Pressable>
              ))
            ) : (
              <View
                style={[
                  styles.emptyQueueBox,
                  { backgroundColor: theme.backgroundElement, borderColor: theme.separator },
                ]}>
                <Text style={[styles.emptyQueueSub, { color: theme.textSecondary }]}>
                  {repeatMode === 'off'
                    ? 'Playback will stop after the current song.'
                    : 'No additional tracks in current context.'}
                </Text>
              </View>
            )}
          </View>
        }
      />
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  closeBtn: {
    padding: 6,
    width: 44,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  clearBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  clearBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  sectionWrap: {
    marginTop: 14,
    marginBottom: 6,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  currentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 16,
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  cardInfo: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  cardMeta: {
    fontSize: 13,
    fontWeight: '400',
  },
  playingBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  repeatBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  repeatBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#D97706',
  },
  emptyQueueBox: {
    padding: 16,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
  },
  emptyQueueTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  emptyQueueSub: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  queueItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  itemCenterInfo: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  itemDuration: {
    fontSize: 12,
  },
  reorderGroup: {
    flexDirection: 'column',
    alignItems: 'center',
    marginRight: 10,
  },
  reorderBtn: {
    padding: 4,
  },
  removeBtn: {
    padding: 4,
  },
  contextSectionWrap: {
    marginTop: 20,
  },
  repeatStatusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  contextItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 6,
  },
});
