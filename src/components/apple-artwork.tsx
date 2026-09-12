import React from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

interface AppleArtworkProps {
  id?: string;
  title?: string;
  size?: number;
  borderRadius?: number;
  icon?: IoniconsName;
  isAlbum?: boolean;
}

// Curated Apple Music gradient color pairings
const APPLE_MUSIC_PALETTES = [
  { bg: '#FF2D55', secondary: '#FF5E3A', glyph: '#FFFFFF', name: 'Sunset Crimson' },
  { bg: '#5856D6', secondary: '#AF52DE', glyph: '#FFFFFF', name: 'Electric Violet' },
  { bg: '#007AFF', secondary: '#5856D6', glyph: '#FFFFFF', name: 'Deep Indigo' },
  { bg: '#34C759', secondary: '#30B0C7', glyph: '#FFFFFF', name: 'Emerald Wave' },
  { bg: '#FF9500', secondary: '#FF2D55', glyph: '#FFFFFF', name: 'Vibrant Amber' },
  { bg: '#32D74B', secondary: '#64D2FF', glyph: '#FFFFFF', name: 'Neon Mint' },
  { bg: '#BF5AF2', secondary: '#FF375F', glyph: '#FFFFFF', name: 'Magenta Glow' },
  { bg: '#FF375F', secondary: '#FF9F0A', glyph: '#FFFFFF', name: 'Radiant Coral' },
];

function getPalette(seed?: string) {
  if (!seed) return APPLE_MUSIC_PALETTES[0];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % APPLE_MUSIC_PALETTES.length;
  return APPLE_MUSIC_PALETTES[index];
}

export function AppleArtwork({
  id,
  title = '',
  size = 56,
  borderRadius,
  icon,
  isAlbum = false,
}: AppleArtworkProps) {
  const palette = getPalette(id || title);
  const radius = borderRadius !== undefined ? borderRadius : Math.round(size * 0.22);
  const iconSize = Math.round(size * 0.44);

  const defaultIcon: keyof typeof Ionicons.glyphMap = isAlbum ? 'folder' : 'mic';
  const displayIcon = icon || defaultIcon;

  return (
    <View
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: palette.bg,
        },
      ]}>
      {/* Upper diagonal radiant highlight */}
      <View
        style={[
          styles.gradientLayer,
          {
            backgroundColor: palette.secondary,
            borderRadius: radius,
          },
        ]}
      />

      {/* Subtle glossy glass shine at the top half */}
      <View style={[styles.glossLayer, { borderTopLeftRadius: radius, borderTopRightRadius: radius }]} />

      {/* Center Apple Music Icon Glyph */}
      <View style={styles.iconWrapper}>
        <Ionicons name={displayIcon} size={iconSize} color={palette.glyph} />
      </View>

      {/* Inner subtle border for premium finish */}
      <View style={[styles.innerBorder, { borderRadius: radius }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  gradientLayer: {
    ...StyleSheet.absoluteFill,
    opacity: 0.55,
    transform: [{ rotate: '35deg' }, { scale: 1.4 }],
  },
  glossLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '45%',
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  iconWrapper: {
    zIndex: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerBorder: {
    ...StyleSheet.absoluteFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
});
