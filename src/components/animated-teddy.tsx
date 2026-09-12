import React, { useEffect } from 'react';
import { StyleSheet, View, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withSpring,
  Easing,
} from 'react-native-reanimated';

interface AnimatedTeddyProps {
  size?: number;
  isPlaying?: boolean;
}

export function AnimatedTeddy({ size = 76, isPlaying = false }: AnimatedTeddyProps) {
  // Gentle breathing float
  const translateY = useSharedValue(0);
  // Ear wiggle / head tilt
  const earTilt = useSharedValue(0);
  // Tap bounce scale
  const tapScale = useSharedValue(1);

  useEffect(() => {
    // Gentle breathing loop
    translateY.value = withRepeat(
      withSequence(
        withTiming(-4, { duration: 1600, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 1600, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );

    // Subtle head/ear tilt
    earTilt.value = withRepeat(
      withSequence(
        withTiming(-2.5, { duration: 2200, easing: Easing.inOut(Easing.ease) }),
        withTiming(2.5, { duration: 2200, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
  }, []);

  // When audio is playing, add a sweet rhythmic active pulse
  useEffect(() => {
    if (isPlaying) {
      tapScale.value = withRepeat(
        withSequence(
          withTiming(1.04, { duration: 650, easing: Easing.inOut(Easing.sin) }),
          withTiming(1.0, { duration: 650, easing: Easing.inOut(Easing.sin) })
        ),
        -1,
        true
      );
    } else {
      tapScale.value = withSpring(1, { damping: 14, stiffness: 140 });
    }
  }, [isPlaying, tapScale]);

  const animatedHeadStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value },
      { rotateZ: `${earTilt.value}deg` },
      { scale: tapScale.value },
    ],
  }));

  function handleTeddyPress() {
    tapScale.value = withSequence(
      withSpring(1.12, { damping: 10, stiffness: 220, mass: 0.8 }),
      withSpring(1.0, { damping: 12, stiffness: 160 })
    );
  }

  const scale = size / 80;

  return (
    <Pressable onPress={handleTeddyPress} style={[styles.wrapper, { width: size, height: size }]}>
      <Animated.View style={[styles.teddyContainer, animatedHeadStyle, { width: size, height: size }]}>
        {/* Left Ear */}
        <View
          style={[
            styles.ear,
            styles.leftEar,
            {
              width: 24 * scale,
              height: 24 * scale,
              borderRadius: 12 * scale,
            },
          ]}>
          <View
            style={[
              styles.innerEar,
              {
                width: 12 * scale,
                height: 12 * scale,
                borderRadius: 6 * scale,
              },
            ]}
          />
        </View>

        {/* Right Ear */}
        <View
          style={[
            styles.ear,
            styles.rightEar,
            {
              width: 24 * scale,
              height: 24 * scale,
              borderRadius: 12 * scale,
            },
          ]}>
          <View
            style={[
              styles.innerEar,
              {
                width: 12 * scale,
                height: 12 * scale,
                borderRadius: 6 * scale,
              },
            ]}
          />
        </View>

        {/* Head Main */}
        <View
          style={[
            styles.head,
            {
              width: 62 * scale,
              height: 54 * scale,
              borderRadius: 27 * scale,
            },
          ]}>
          {/* Eyes */}
          <View style={[styles.eyesRow, { marginTop: 12 * scale }]}>
            <View style={[styles.eye, { width: 6 * scale, height: 7 * scale, borderRadius: 3 * scale }]}>
              <View style={[styles.eyeCatch, { width: 2 * scale, height: 2 * scale, borderRadius: 1 * scale }]} />
            </View>
            <View style={[styles.eye, { width: 6 * scale, height: 7 * scale, borderRadius: 3 * scale }]}>
              <View style={[styles.eyeCatch, { width: 2 * scale, height: 2 * scale, borderRadius: 1 * scale }]} />
            </View>
          </View>

          {/* Cheerful Blush */}
          <View style={styles.blushRow}>
            <View style={[styles.blush, { width: 9 * scale, height: 5 * scale, borderRadius: 3 * scale }]} />
            <View style={[styles.blush, { width: 9 * scale, height: 5 * scale, borderRadius: 3 * scale }]} />
          </View>

          {/* Muzzle */}
          <View
            style={[
              styles.muzzle,
              {
                width: 28 * scale,
                height: 20 * scale,
                borderRadius: 10 * scale,
                bottom: 6 * scale,
              },
            ]}>
            {/* Cute Nose */}
            <View
              style={[
                styles.nose,
                {
                  width: 9 * scale,
                  height: 6 * scale,
                  borderRadius: 3 * scale,
                },
              ]}
            />
            {/* Smile line */}
            <View style={[styles.smile, { width: 10 * scale, height: 4 * scale }]} />
          </View>
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  teddyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  ear: {
    position: 'absolute',
    top: 2,
    backgroundColor: '#8B5A2B', // Cozy Teddy Brown
    borderWidth: 1.5,
    borderColor: '#734A22',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  leftEar: {
    left: 8,
  },
  rightEar: {
    right: 8,
  },
  innerEar: {
    backgroundColor: '#D4A373', // Soft Honey Inner Ear
  },
  head: {
    backgroundColor: '#9E6938', // Warm Plush Teddy Brown
    borderWidth: 2,
    borderColor: '#734A22',
    alignItems: 'center',
    justifyContent: 'flex-start',
    zIndex: 2,
    shadowColor: '#5C3817',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  eyesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '46%',
  },
  eye: {
    backgroundColor: '#2A180B',
    position: 'relative',
  },
  eyeCatch: {
    position: 'absolute',
    top: 1,
    left: 1,
    backgroundColor: '#FFFFFF',
  },
  blushRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '68%',
    marginTop: 2,
  },
  blush: {
    backgroundColor: 'rgba(235, 130, 145, 0.45)', // Sweet soft cheeks
  },
  muzzle: {
    position: 'absolute',
    backgroundColor: '#E6C29E', // Cream Muzzle
    borderWidth: 1,
    borderColor: '#C49B72',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nose: {
    backgroundColor: '#4A2A12',
    marginTop: -2,
  },
  smile: {
    borderBottomWidth: 1.5,
    borderColor: '#4A2A12',
    borderRadius: 6,
    marginTop: 1,
  },
});
