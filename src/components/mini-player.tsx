import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAudio } from '@/services/audioPlayerContext';
import { formatDuration } from '@/utils/format';
import { useTheme } from '@/hooks/use-theme';
import { AppleArtwork } from './apple-artwork';

export function MiniPlayer() {
  const {
    currentVn,
    isPlaying,
    currentTime,
    duration,
    togglePlayPause,
    stop,
  } = useAudio();
  const router = useRouter();
  const theme = useTheme();

  if (!currentVn) {
    return null;
  }

  const activeDuration = duration || currentVn.duration || 0;
  const progressPercent =
    activeDuration > 0 ? Math.min(100, (currentTime / activeDuration) * 100) : 0;

  return (
    <View style={styles.outerWrapper}>
      <Pressable
        style={({ pressed }) => [
          styles.container,
          {
            backgroundColor: theme.miniPlayerBg,
            borderColor: theme.separator,
          },
          pressed && { opacity: 0.95 },
        ]}
        onPress={() => router.push(`/player/${currentVn.id}` as any)}>
        {/* Left: Mini Artwork */}
        <View style={styles.artContainer}>
          <AppleArtwork id={currentVn.id} title={currentVn.title} size={42} borderRadius={8} />
        </View>

        {/* Center: Track Title & Subtitle */}
        <View style={styles.infoContainer}>
          <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
            {currentVn.title}
          </Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]} numberOfLines={1}>
            {isPlaying ? 'Playing • ' : 'Paused • '}
            {formatDuration(currentTime)} / {formatDuration(activeDuration)}
          </Text>
        </View>

        {/* Right: Apple Music Controls */}
        <View style={styles.controls}>
          {/* Play / Pause */}
          <Pressable
            style={({ pressed }) => [
              styles.controlBtn,
              pressed && { opacity: 0.6 },
            ]}
            hitSlop={8}
            onPress={(e) => {
              e.stopPropagation();
              togglePlayPause();
            }}>
            <Ionicons
              name={isPlaying ? 'pause' : 'play'}
              size={24}
              color={theme.text}
            />
          </Pressable>

          {/* Close / Dismiss */}
          <Pressable
            style={({ pressed }) => [
              styles.controlBtn,
              pressed && { opacity: 0.6 },
            ]}
            hitSlop={8}
            onPress={(e) => {
              e.stopPropagation();
              stop();
            }}>
            <Ionicons name="close" size={20} color={theme.textSecondary} />
          </Pressable>
        </View>

        {/* Bottom Flush Progress Line */}
        <View style={[styles.progressTrack, { backgroundColor: theme.backgroundSelected }]}>
          <View
            style={[
              styles.progressBarFill,
              { width: `${progressPercent}%`, backgroundColor: theme.tint },
            ]}
          />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  outerWrapper: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    paddingTop: 4,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 8,
  },
  artContainer: {
    marginRight: 12,
  },
  infoContainer: {
    flex: 1,
    justifyContent: 'center',
    marginRight: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '400',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingRight: 4,
  },
  controlBtn: {
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressTrack: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 2.5,
  },
  progressBarFill: {
    height: '100%',
  },
});

