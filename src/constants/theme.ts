/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    tint: '#FA2D48',
    text: '#000000',
    textSecondary: '#8E8E93',
    textTertiary: '#C7C7CC',
    background: '#FFFFFF',
    groupedBackground: '#F2F2F7',
    backgroundElement: '#F2F2F7',
    backgroundSelected: '#E5E5EA',
    card: '#FFFFFF',
    border: '#E5E5EA',
    separator: '#E5E5EA',
    miniPlayerBg: 'rgba(255, 255, 255, 0.94)',
    accentSoft: 'rgba(250, 45, 72, 0.12)',
  },
  dark: {
    tint: '#FF375F',
    text: '#FFFFFF',
    textSecondary: '#8E8E93',
    textTertiary: '#48484A',
    background: '#000000',
    groupedBackground: '#121214',
    backgroundElement: '#1C1C1E',
    backgroundSelected: '#2C2C2E',
    card: '#1C1C1E',
    border: '#2C2C2E',
    separator: '#38383A',
    miniPlayerBg: 'rgba(28, 28, 30, 0.94)',
    accentSoft: 'rgba(255, 55, 95, 0.16)',
  },
} as const;

export const TeddyColors = {
  light: {
    background: '#FAF5EF', // Warm cozy latte background
    card: '#FFFFFF',
    cardAlt: '#F5ECE1',
    border: '#E8DC CE',
    primary: '#8B5A2B', // Cozy Teddy Brown
    primaryDark: '#6F431B',
    accent: '#D4A373', // Honey Amber
    honey: '#E5A65E',
    rose: '#E27B88', // Soft warm heart pink
    text: '#3D2817', // Deep espresso text
    textSecondary: '#856A54',
    textTertiary: '#B8A495',
    tagBg: '#F2E6D8',
  },
  dark: {
    background: '#1A130E', // Cozy chocolate night background
    card: '#241B14',
    cardAlt: '#2F231B',
    border: '#3D2F24',
    primary: '#D4A373', // Warm Honey Brown
    primaryDark: '#B58253',
    accent: '#E5A65E',
    honey: '#E5A65E',
    rose: '#E27B88',
    text: '#F5EBE1', // Warm cream text
    textSecondary: '#B8A495',
    textTertiary: '#735E50',
    tagBg: '#36281D',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif',
    serif: 'ui-serif, Georgia, serif',
    rounded: 'ui-rounded, system-ui, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = {
  small: 8,
  medium: 12,
  card: 14,
  large: 18,
  pill: 9999,
} as const;

export const AppleShadows = {
  light: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 4,
  },
  glow: {
    shadowColor: '#FA2D48',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  floating: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 10,
  },
};

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

