import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { TeddyColors } from '@/constants/theme';
import { teddyPickerService } from '@/services/teddyPickerService';
import { teddyReactionService } from '@/services/teddyReactionService';
import { useAudio } from '@/services/audioPlayerContext';

interface TeddyPickCardProps {
  onRecordPress?: () => void;
  onImportPress?: () => void;
}

export function TeddyPickCard({ onRecordPress, onImportPress }: TeddyPickCardProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const teddy = isDark ? TeddyColors.dark : TeddyColors.light;
  const router = useRouter();
  const { currentVn } = useAudio();

  const [isPicking, setIsPicking] = useState(false);
  const isPickingRef = useRef(false);

  async function handlePickForMe() {
    // Prevent rapid double-taps
    if (isPickingRef.current) return;
    isPickingRef.current = true;
    setIsPicking(true);

    try {
      const result = await teddyPickerService.pickVoiceNote(currentVn?.id);

      if (result.status === 'empty') {
        teddyReactionService.trigger('EMPTY_LIBRARY');
      } else if (result.status === 'no_valid_audio') {
        teddyReactionService.trigger('CUSTOM', "Teddy couldn't find the audio file for this one. 🧸");
      } else if (result.status === 'success') {
        // Trigger reaction & navigate to the selected player
        teddyReactionService.trigger('TEDDY_PICK');
        router.push(`/player/${result.vn.id}` as any);
      }
    } catch (err) {
      console.warn('[TEDDY PICK] Error during pick:', err);
    } finally {
      // Small cooldown to prevent button spamming
      setTimeout(() => {
        isPickingRef.current = false;
        setIsPicking(false);
      }, 1000);
    }
  }

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: teddy.card,
          borderColor: teddy.border,
        },
      ]}>
      {/* Top Header Row with Teddy badge */}
      <View style={styles.headerRow}>
        <View style={styles.badgeWrap}>
          <View style={styles.iconCircle}>
            <Text style={styles.teddyEmoji}>🧸</Text>
          </View>
          <View>
            <Text style={[styles.title, { color: teddy.text }]}>{"Teddy's Pick"}</Text>
            <Text style={[styles.subtitle, { color: teddy.textSecondary }]}>
              {'"Let me choose one for you"'}
            </Text>
          </View>
        </View>
        <Ionicons name="sparkles" size={18} color="#D97706" />
      </View>

      {/* Action Button */}
      <Pressable
        style={({ pressed }) => [
          styles.pickButton,
          {
            backgroundColor: teddy.primary,
          },
          pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] },
        ]}
        disabled={isPicking}
        onPress={handlePickForMe}
        accessibilityRole="button"
        accessibilityLabel="Teddy's Pick: Pick a voice note for me"
        accessibilityHint="Teddy randomly selects a keepsake from your library">
        {isPicking ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <View style={styles.btnContent}>
            <Ionicons name="gift-outline" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
            <Text style={styles.pickButtonText}>✨ Pick for me ✨</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 16,
    marginVertical: 10,
    shadowColor: '#5C3817',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 3,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  badgeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FEF3C7', // Soft warm yellow
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  teddyEmoji: {
    fontSize: 20,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  subtitle: {
    fontSize: 12.5,
    fontWeight: '500',
    marginTop: 1,
  },
  pickButton: {
    borderRadius: 14,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
