import React, { useEffect } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { VN } from '@/types/vn';
import { TeddyColors } from '@/constants/theme';
import { AnimatedTeddy } from '@/components/animated-teddy';
import { formatDuration } from '@/utils/format';
import { checkAudioFileExists } from '@/services/fileService';

interface TeddyRecommendationModalProps {
  visible: boolean;
  vn: VN | null;
  onClose: () => void;
  onPlay: (vn: VN) => void;
}

export function TeddyRecommendationModal({
  visible,
  vn,
  onClose,
  onPlay,
}: TeddyRecommendationModalProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const teddy = isDark ? TeddyColors.dark : TeddyColors.light;

  // Entrance animation values
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.88);
  const translateY = useSharedValue(18);

  useEffect(() => {
    if (visible) {
      opacity.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.ease) });
      scale.value = withSpring(1, { damping: 14, stiffness: 150 });
      translateY.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.quad) });
    } else {
      opacity.value = withTiming(0, { duration: 140 });
      scale.value = withTiming(0.92, { duration: 140 });
      translateY.value = withTiming(14, { duration: 140 });
    }
  }, [visible, opacity, scale, translateY]);

  const animatedBackdropStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const animatedCardStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { scale: scale.value },
      { translateY: translateY.value },
    ],
  }));

  if (!visible && !vn) {
    return null;
  }

  function handlePlayPress() {
    if (!vn) return;
    // Verify file still exists on disk before launching playback
    if (!checkAudioFileExists(vn.fileUri)) {
      onClose();
      return;
    }
    onPlay(vn);
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}>
      <View style={styles.overlayRoot}>
        {/* Semi-transparent Dimmed Backdrop */}
        <Animated.View style={[styles.backdrop, animatedBackdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>

        {/* Centered Recommendation Card */}
        <Animated.View
          style={[
            styles.card,
            animatedCardStyle,
            {
              backgroundColor: teddy.card,
              borderColor: teddy.border,
            },
          ]}>
          {/* Top Decorative Star Tag */}
          <View style={styles.badgeContainer}>
            <View style={[styles.badge, { backgroundColor: isDark ? '#451A03' : '#FEF3C7' }]}>
              <Ionicons name="sparkles" size={13} color="#D97706" style={{ marginRight: 5 }} />
              <Text style={styles.badgeText}>TEDDY&apos;S RECOMMENDATION</Text>
            </View>
          </View>

          {/* Teddy Holding Music Box Centerpiece */}
          <View style={styles.teddyMusicBoxWrap}>
            {/* Animated Teddy */}
            <View style={styles.teddyWrapper}>
              <AnimatedTeddy size={82} isPlaying={false} />
            </View>

            {/* Vintage Music Box with Teddy's Paws */}
            <View style={styles.musicBoxHolder}>
              {/* Left Teddy Paw */}
              <View style={[styles.paw, styles.leftPaw]}>
                <View style={styles.pawPad} />
              </View>

              {/* Music Box Chest */}
              <View style={styles.musicBox}>
                {/* Lid Rim */}
                <View style={styles.boxLid}>
                  <View style={styles.lidGleam} />
                </View>

                {/* Box Front Face */}
                <View style={styles.boxBody}>
                  {/* Brass Lock / Emblem */}
                  <View style={styles.goldLatch}>
                    <Ionicons name="musical-notes" size={13} color="#78350F" />
                  </View>
                </View>

                {/* Sparkling notes floating from box */}
                <View style={styles.floatingSparkleLeft}>
                  <Ionicons name="sparkles" size={11} color="#D97706" />
                </View>
                <View style={styles.floatingSparkleRight}>
                  <Ionicons name="musical-note" size={12} color="#D97706" />
                </View>
              </View>

              {/* Right Teddy Paw */}
              <View style={[styles.paw, styles.rightPaw]}>
                <View style={styles.pawPad} />
              </View>
            </View>
          </View>

          {/* Prompt Header */}
          <Text style={[styles.recommendTitle, { color: teddy.text }]}>
            Teddy found a keepsake!
          </Text>
          <Text style={[styles.recommendSubtitle, { color: teddy.textSecondary }]}>
            A special memory from your library
          </Text>

          {/* Selected VN Preview Box */}
          <View
            style={[
              styles.vnPreviewBox,
              {
                backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : '#FBF7F0',
                borderColor: teddy.border,
              },
            ]}>
            <View style={styles.vnHeaderRow}>
              <View style={styles.vnIconCircle}>
                <Ionicons
                  name={vn?.source === 'recorded' ? 'mic' : 'musical-note'}
                  size={16}
                  color="#8B5A2B"
                />
              </View>
              <View style={styles.vnMetaWrap}>
                <Text
                  style={[styles.vnTitle, { color: teddy.text }]}
                  numberOfLines={2}
                  ellipsizeMode="tail">
                  {vn?.title || 'Untitled Keepsake'}
                </Text>
                <View style={styles.vnSubRow}>
                  <Text style={[styles.vnDuration, { color: teddy.textSecondary }]}>
                    {vn?.duration ? formatDuration(vn.duration) : 'Voice Note'}
                  </Text>
                  {vn?.isLiked ? (
                    <View style={styles.likedTag}>
                      <Ionicons name="heart" size={11} color="#E06D7F" style={{ marginRight: 3 }} />
                      <Text style={styles.likedTagText}>Favorite</Text>
                    </View>
                  ) : null}
                  {vn?.isPinned ? (
                    <View style={styles.pinnedTag}>
                      <Ionicons name="pin" size={11} color="#D97706" style={{ marginRight: 3 }} />
                      <Text style={styles.pinnedTagText}>Pinned</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </View>
          </View>

          {/* Exactly Two Primary Actions: Close and Play */}
          <View style={styles.actionRow}>
            {/* Close Button */}
            <Pressable
              style={({ pressed }) => [
                styles.closeButton,
                {
                  backgroundColor: isDark ? '#292524' : '#F5F5F4',
                  borderColor: teddy.border,
                },
                pressed && { opacity: 0.8, transform: [{ scale: 0.98 }] },
              ]}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close recommendation overlay">
              <Ionicons
                name="close"
                size={16}
                color={teddy.textSecondary}
                style={{ marginRight: 5 }}
              />
              <Text style={[styles.closeButtonText, { color: teddy.text }]}>Close</Text>
            </Pressable>

            {/* Play Button */}
            <Pressable
              style={({ pressed }) => [
                styles.playButton,
                {
                  backgroundColor: teddy.primary,
                },
                pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
              ]}
              onPress={handlePlayPress}
              accessibilityRole="button"
              accessibilityLabel={`Play ${vn?.title || 'keepsake'}`}>
              <Ionicons name="play" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.playButtonText}>Play</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlayRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(28, 25, 23, 0.65)',
  },
  card: {
    width: '86%',
    maxWidth: 340,
    borderRadius: 24,
    borderWidth: 1.5,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 22,
    alignItems: 'center',
    shadowColor: '#451A03',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
    elevation: 12,
  },
  badgeContainer: {
    marginBottom: 10,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#D97706',
    letterSpacing: 0.6,
  },
  teddyMusicBoxWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
  },
  teddyWrapper: {
    zIndex: 2,
  },
  musicBoxHolder: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -16,
    zIndex: 3,
  },
  paw: {
    width: 20,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#8B5A2B',
    borderWidth: 1.5,
    borderColor: '#734A22',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 4,
  },
  leftPaw: {
    marginRight: -6,
    transform: [{ rotate: '18deg' }],
  },
  rightPaw: {
    marginLeft: -6,
    transform: [{ rotate: '-18deg' }],
  },
  pawPad: {
    width: 9,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#D4A373',
  },
  musicBox: {
    width: 86,
    height: 48,
    backgroundColor: '#9E6938',
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#6B421A',
    shadowColor: '#3A1E07',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 4,
    elevation: 3,
    alignItems: 'center',
    position: 'relative',
    overflow: 'visible',
  },
  boxLid: {
    width: 88,
    height: 12,
    backgroundColor: '#B57D47',
    borderTopLeftRadius: 7,
    borderTopRightRadius: 7,
    borderWidth: 1.2,
    borderColor: '#6B421A',
    marginTop: -1,
  },
  lidGleam: {
    width: '80%',
    height: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
    borderRadius: 1,
    alignSelf: 'center',
    marginTop: 2,
  },
  boxBody: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8B5A2B',
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
  },
  goldLatch: {
    width: 22,
    height: 18,
    backgroundColor: '#F59E0B',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#B45309',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1,
  },
  floatingSparkleLeft: {
    position: 'absolute',
    top: -14,
    left: 4,
  },
  floatingSparkleRight: {
    position: 'absolute',
    top: -18,
    right: 6,
  },
  recommendTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginTop: 10,
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  recommendSubtitle: {
    fontSize: 12.5,
    fontWeight: '500',
    marginTop: 2,
    marginBottom: 14,
    textAlign: 'center',
  },
  vnPreviewBox: {
    width: '100%',
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    marginBottom: 16,
  },
  vnHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  vnIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F2E8DA',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 11,
  },
  vnMetaWrap: {
    flex: 1,
  },
  vnTitle: {
    fontSize: 14.5,
    fontWeight: '700',
    letterSpacing: -0.2,
    marginBottom: 3,
  },
  vnSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  vnDuration: {
    fontSize: 12,
    fontWeight: '600',
  },
  likedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FDE8EB',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  likedTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#E06D7F',
  },
  pinnedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  pinnedTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#D97706',
  },
  actionRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 10,
  },
  closeButton: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  playButton: {
    flex: 1.4,
    paddingVertical: 11,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#5C3817',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  playButtonText: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
