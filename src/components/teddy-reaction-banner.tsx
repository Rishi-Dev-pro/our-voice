import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  DeviceEventEmitter,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { TeddyReactionData } from '@/services/teddyReactionService';

export function TeddyReactionBanner() {
  const insets = useSafeAreaInsets();

  const [currentReaction, setCurrentReaction] = useState<TeddyReactionData | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Animation values
  const translateY = useSharedValue(-80);
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.9);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value },
      { scale: scale.value },
    ],
    opacity: opacity.value,
  }));

  const dismissReaction = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    translateY.value = withTiming(-80, { duration: 220 });
    opacity.value = withTiming(0, { duration: 200 }, (finished) => {
      if (finished) {
        runOnJS(setCurrentReaction)(null);
      }
    });
    scale.value = withTiming(0.9, { duration: 200 });
  }, []);

  useEffect(() => {
    // 1. Show listener
    const showSub = DeviceEventEmitter.addListener(
      'teddy_reaction_show',
      (reaction: TeddyReactionData) => {
        if (dismissTimerRef.current) {
          clearTimeout(dismissTimerRef.current);
          dismissTimerRef.current = null;
        }

        setCurrentReaction(reaction);

        // Animate entrance
        translateY.value = withSpring(0, { damping: 14, stiffness: 220 });
        opacity.value = withTiming(1, { duration: 200 });
        scale.value = withSpring(1, { damping: 12, stiffness: 200 });

        // Auto-dismiss
        dismissTimerRef.current = setTimeout(() => {
          dismissReaction();
        }, reaction.durationMs || 3000);
      }
    );

    // 2. Clear listener
    const clearSub = DeviceEventEmitter.addListener('teddy_reaction_clear', () => {
      dismissReaction();
    });

    // 3. AppState listener: immediately dismiss if app backgrounds
    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        dismissReaction();
      }
    });

    return () => {
      showSub.remove();
      clearSub.remove();
      appStateSub.remove();
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
      }
    };
  }, [dismissReaction]);

  if (!currentReaction) {
    return null;
  }

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.overlayContainer,
        { top: Math.max(insets.top + 8, 16) },
      ]}>
      <Animated.View style={[styles.cardShadowWrapper, animatedStyle]}>
        <Pressable
          style={({ pressed }) => [
            styles.bannerCard,
            {
              backgroundColor: '#8B5A2B', // Warm Teddy Brown
              borderColor: '#D4A373', // Honey Accent Border
            },
            pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
          ]}
          onPress={dismissReaction}
          accessibilityRole="alert"
          accessibilityLabel={`Teddy says: ${currentReaction.message}`}
          accessibilityHint="Tap to dismiss">
          <View style={styles.badgeRow}>
            <Text style={styles.teddyIcon}>🧸</Text>
            <Text style={styles.messageText} numberOfLines={2}>
              {currentReaction.message}
            </Text>
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlayContainer: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
    zIndex: 99999,
  },
  cardShadowWrapper: {
    width: '100%',
    maxWidth: 420,
    shadowColor: '#3E2723',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  bannerCard: {
    borderRadius: 22,
    borderWidth: 1.5,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  teddyIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  messageText: {
    color: '#FFF8F0',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    flexShrink: 1,
    letterSpacing: 0.2,
  },
});
