import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring } from 'react-native-reanimated';
import { VN } from '@/types/vn';
import { formatDuration, formatShortDate } from '@/utils/format';
import { useTheme } from '@/hooks/use-theme';
import { AppleArtwork } from './apple-artwork';
import { AppleActionSheet } from './apple-action-sheet';

interface VnItemProps {
  vn: VN;
  isPlaying?: boolean;
  trackNumber?: number;
  onPlay: (vn: VN) => void;
  onToggleLike: (vn: VN) => void;
  onTogglePin?: (vn: VN) => void;
  onDelete?: (vn: VN) => void;
  onAddToAlbum?: (vn: VN) => void;
  onRemoveFromAlbum?: (vn: VN) => void;
  onRename?: (vn: VN) => void;
  onPress?: (vn: VN) => void;
  onShare?: (vn: VN) => void;
  onTakeAgain?: (vn: VN) => void;
}

export function VnItem({
  vn,
  isPlaying = false,
  trackNumber,
  onPlay,
  onToggleLike,
  onTogglePin,
  onDelete,
  onAddToAlbum,
  onRemoveFromAlbum,
  onRename,
  onPress,
  onShare,
  onTakeAgain,
}: VnItemProps) {
  const theme = useTheme();
  const [sheetVisible, setSheetVisible] = useState(false);

  // Animated heart pop on like toggle
  const heartScale = useSharedValue(1);

  useEffect(() => {
    if (vn.isLiked) {
      heartScale.value = withSequence(
        withSpring(1.35, { damping: 4, stiffness: 300 }),
        withSpring(1.0, { damping: 8, stiffness: 200 })
      );
    }
  }, [vn.isLiked]);

  const animatedHeartStyle = useAnimatedStyle(() => ({
    transform: [{ scale: heartScale.value }],
  }));

  function handleTrackPress() {
    if (onPress) {
      onPress(vn);
    } else {
      onPlay(vn);
    }
  }

  function handleHeartPress() {
    heartScale.value = withSequence(
      withSpring(1.4, { damping: 4, stiffness: 300 }),
      withSpring(1.0, { damping: 8, stiffness: 200 })
    );
    onToggleLike(vn);
  }

  return (
    <View style={styles.outerContainer}>
      <View
        style={[
          styles.rowContainer,
          {
            backgroundColor: isPlaying ? 'rgba(217, 119, 6, 0.08)' : theme.card,
            borderColor: isPlaying ? '#D97706' : theme.separator,
          },
        ]}>
        {/* Main Clickable Area: Artwork + Title & Badges (Navigates to Player) */}
        <Pressable
          style={({ pressed }) => [
            styles.mainClickable,
            pressed && { opacity: 0.78 },
          ]}
          onPress={handleTrackPress}>
          {trackNumber !== undefined && (
            <Text
              style={[
                styles.trackNumber,
                { color: isPlaying ? theme.tint : theme.textSecondary },
              ]}>
              {trackNumber}
            </Text>
          )}

          {/* Artwork Thumbnail with Playing Indicator */}
          <View style={styles.artWrapper}>
            <AppleArtwork id={vn.id} title={vn.title} size={50} borderRadius={14} />
            {isPlaying && (
              <View style={[styles.playingBadge, { backgroundColor: '#D97706' }]}>
                <Ionicons name="volume-high" size={13} color="#FFFFFF" />
              </View>
            )}
          </View>

          {/* Content Info: Title + Pill Badges */}
          <View style={styles.content}>
            <View style={styles.titleRow}>
              <Text
                style={[
                  styles.title,
                  { color: isPlaying ? '#D97706' : theme.text },
                ]}
                numberOfLines={1}>
                {vn.title}
              </Text>
              {vn.isPinned && (
                <View style={styles.pinIndicator}>
                  <Ionicons name="pin" size={11} color="#D97706" />
                </View>
              )}
            </View>

            <View style={styles.badgeRow}>
              {/* Duration Pill */}
              <View style={[styles.pillBadge, { backgroundColor: theme.backgroundElement }]}>
                <Ionicons name="time-outline" size={11} color={theme.textSecondary} />
                <Text style={[styles.pillText, { color: theme.textSecondary }]}>
                  {formatDuration(vn.duration)}
                </Text>
              </View>

              {/* Source Pill */}
              <View
                style={[
                  styles.pillBadge,
                  {
                    backgroundColor:
                      vn.source === 'recorded'
                        ? 'rgba(217, 119, 6, 0.12)'
                        : 'rgba(59, 130, 246, 0.12)',
                  },
                ]}>
                <Text
                  style={[
                    styles.sourcePillText,
                    {
                      color: vn.source === 'recorded' ? '#D97706' : '#2563EB',
                    },
                  ]}>
                  {vn.source === 'recorded' ? '🎙️ VN' : '🎵 Song'}
                </Text>
              </View>

              {/* Compact Date */}
              <Text
                style={[styles.dateText, { color: theme.textTertiary }]}
                numberOfLines={1}
                ellipsizeMode="tail">
                {formatShortDate(vn.createdAt)}
              </Text>
            </View>
          </View>
        </Pressable>

        {/* Dedicated Trailing Actions */}
        <View style={styles.trailingActions}>
          {/* Direct Quick Play / Pause Button */}
          <Pressable
            style={({ pressed }) => [
              styles.quickPlayBtn,
              {
                backgroundColor: isPlaying ? '#D97706' : theme.backgroundElement,
              },
              pressed && { transform: [{ scale: 0.92 }] },
            ]}
            hitSlop={8}
            onPress={() => onPlay(vn)}
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? 'Pause' : 'Play'}>
            <Ionicons
              name={isPlaying ? 'pause' : 'play'}
              size={16}
              color={isPlaying ? '#FFFFFF' : theme.text}
              style={isPlaying ? {} : { marginLeft: 2 }}
            />
          </Pressable>

          {/* Favorite Heart Button */}
          <Pressable
            style={styles.iconBtn}
            hitSlop={8}
            onPress={handleHeartPress}
            accessibilityRole="button"
            accessibilityLabel={vn.isLiked ? 'Unlike' : 'Like'}>
            <Animated.View style={animatedHeartStyle}>
              <Ionicons
                name={vn.isLiked ? 'heart' : 'heart-outline'}
                size={20}
                color={vn.isLiked ? theme.tint : theme.textTertiary}
              />
            </Animated.View>
          </Pressable>

          {/* More Options Sheet Trigger */}
          <Pressable
            style={styles.iconBtn}
            hitSlop={8}
            onPress={() => setSheetVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="More options">
            <Ionicons name="ellipsis-horizontal" size={18} color={theme.textSecondary} />
          </Pressable>
        </View>
      </View>

      {/* Action Sheet */}
      <AppleActionSheet
        vn={vn}
        visible={sheetVisible}
        isPlaying={isPlaying}
        onClose={() => setSheetVisible(false)}
        onPlay={onPlay}
        onToggleLike={onToggleLike}
        onTogglePin={onTogglePin}
        onAddToAlbum={onAddToAlbum}
        onRename={onRename}
        onDelete={onDelete}
        onShare={onShare}
        onTakeAgain={onTakeAgain}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    width: '100%',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  rowContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1.2,
    shadowColor: '#451A03',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.07,
    shadowRadius: 6,
    elevation: 2,
    minHeight: 76,
  },
  mainClickable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 6,
  },
  trackNumber: {
    width: 22,
    fontSize: 14,
    fontWeight: '700',
    marginRight: 6,
    textAlign: 'center',
  },
  artWrapper: {
    position: 'relative',
    marginRight: 12,
  },
  playingBadge: {
    position: 'absolute',
    bottom: -3,
    right: -3,
    borderRadius: 10,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    elevation: 3,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 5,
  },
  title: {
    fontSize: 15.5,
    fontWeight: '700',
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  pinIndicator: {
    marginLeft: 6,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 6,
    backgroundColor: 'rgba(217, 119, 6, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    overflow: 'hidden',
  },
  pillBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2.5,
    borderRadius: 6,
    flexShrink: 0,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  sourcePillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  dateText: {
    fontSize: 11,
    fontWeight: '500',
    marginLeft: 2,
    flexShrink: 1,
  },
  trailingActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 2,
  },
  quickPlayBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 2,
  },
  iconBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
