import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useTheme } from '@/hooks/use-theme';

export type WaveformStage = 'idle' | 'recording' | 'paused' | 'stopped' | 'error';

interface LiveWaveformProps {
  stage: WaveformStage;
  metering?: number;
  height?: number;
}

const NUM_BARS = 28;

// Harmonic weighting curve for the 28 bars (centers react most vigorously like speech frequencies)
const BAR_WEIGHTS = Array.from({ length: NUM_BARS }, (_, i) => {
  const normIndex = (i - NUM_BARS / 2) / (NUM_BARS / 2);
  const bell = Math.exp(-1.8 * normIndex * normIndex);
  return 0.35 + 0.65 * bell;
});

function WaveformBar({
  amplitude,
  stage,
  index,
  maxHeight,
}: {
  amplitude: number;
  stage: WaveformStage;
  index: number;
  maxHeight: number;
}) {
  const theme = useTheme();
  const heightAnim = useSharedValue(4);

  const weight = BAR_WEIGHTS[index];
  const targetHeight =
    stage === 'recording'
      ? Math.max(4, Math.min(maxHeight, amplitude * maxHeight * weight))
      : stage === 'paused'
      ? Math.max(4, Math.min(maxHeight, amplitude * maxHeight * weight * 0.7))
      : 4;

  useEffect(() => {
    heightAnim.value = withTiming(targetHeight, {
      duration: 120,
      easing: Easing.out(Easing.quad),
    });
  }, [targetHeight]);

  const animatedStyle = useAnimatedStyle(() => ({
    height: heightAnim.value,
  }));

  const barColor =
    stage === 'recording'
      ? '#D4954A' // Warm teddy honey amber
      : stage === 'paused'
      ? '#FF9500' // Paused amber
      : stage === 'error'
      ? '#FF3B30' // Error red
      : theme.separator; // Soft baseline

  const opacity = stage === 'paused' ? 0.6 : stage === 'idle' ? 0.4 : 1;

  return (
    <View style={styles.barSlot}>
      <Animated.View
        style={[
          styles.bar,
          { backgroundColor: barColor, opacity },
          animatedStyle,
        ]}
      />
    </View>
  );
}

export function LiveWaveform({ stage, metering, height = 72 }: LiveWaveformProps) {
  const [history, setHistory] = useState<number[]>(() =>
    Array(NUM_BARS).fill(0.08)
  );
  const lastUpdateRef = useRef<number>(0);

  useEffect(() => {
    if (stage !== 'recording') {
      return;
    }

    const now = Date.now();
    // Throttle waveform updates to ~100ms for high performance and smooth rendering
    if (now - lastUpdateRef.current < 90) {
      return;
    }
    lastUpdateRef.current = now;

    // Convert metering dBFS to normalized amplitude [0.08, 1.0]
    // In expo-audio, metering is in dBFS (typically -160 to 0)
    // Silence is <= -60 dB, typical speech is -35 dB to -10 dB
    let normAmp = 0.08;
    if (typeof metering === 'number' && metering > -60) {
      // Linearize between -60 dB and -6 dB
      const clamped = Math.max(-60, Math.min(-6, metering));
      normAmp = 0.08 + 0.92 * ((clamped + 60) / 54);
    }

    setHistory((prev) => {
      // Shift array and push new normalized amplitude with natural micro-variation
      const next = [...prev.slice(1)];
      next.push(normAmp);
      return next;
    });
  }, [metering, stage]);

  return (
    <View style={[styles.container, { height }]}>
      <View style={styles.barsRow}>
        {history.map((amp, idx) => (
          <WaveformBar
            key={idx}
            index={idx}
            amplitude={amp}
            stage={stage}
            maxHeight={height - 8}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    width: '100%',
    gap: 3,
  },
  barSlot: {
    flex: 1,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bar: {
    width: '100%',
    maxWidth: 6,
    minHeight: 4,
    borderRadius: 3,
  },
});
