import React, { useEffect, useState } from 'react';
import {
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInRight,
  SlideOutLeft,
} from 'react-native-reanimated';

import { AnimatedTeddy } from '@/components/animated-teddy';
import { TeddyColors } from '@/constants/theme';
import { preferencesService } from '@/services/preferencesService';

interface TeddyOnboardingProps {
  onComplete: (userName: string) => void;
}

interface GuideStep {
  emoji: string;
  tag: string;
  title: (name: string) => string;
  subtitle: string;
  accentIcon: keyof typeof Ionicons.glyphMap;
  accentBg: string;
  accentColor: string;
}

const GUIDE_STEPS: GuideStep[] = [
  {
    emoji: '🧸',
    tag: 'Welcome Home',
    title: (name) => `Welcome to Our Voice, ${name}! ❤️`,
    subtitle: 'Your cozy, private space for sweet voices and cherished VNs.',
    accentIcon: 'heart',
    accentBg: '#FCE7EA',
    accentColor: '#E06D7F',
  },
  {
    emoji: '🎵',
    tag: 'Safe Keepsakes',
    title: () => 'Import your favorite VNs',
    subtitle: 'Bring audio from your phone and keep it safely on your device forever.',
    accentIcon: 'musical-notes',
    accentBg: '#E0F2FE',
    accentColor: '#0284C7',
  },
  {
    emoji: '🎙️',
    tag: 'Clear Studio',
    title: () => 'Record your own voice',
    subtitle: 'Sing, talk, or record anything you want with a single tap.',
    accentIcon: 'mic',
    accentBg: '#FEF3C7',
    accentColor: '#D97706',
  },
  {
    emoji: '📁',
    tag: 'Custom Albums',
    title: () => 'Keep everything organized',
    subtitle: 'Create albums, like VNs, rename them, and find them easily.',
    accentIcon: 'albums',
    accentBg: '#F9EAD9',
    accentColor: '#8B5A2B',
  },
  {
    emoji: '🔁',
    tag: 'Cozy Player',
    title: () => 'Listen your way',
    subtitle: 'Play, pause, seek, and loop your favorite voice notes anytime.',
    accentIcon: 'repeat',
    accentBg: '#E8F5E9',
    accentColor: '#2E7D32',
  },
];

export function TeddyOnboarding({ onComplete }: TeddyOnboardingProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const teddy = isDark ? TeddyColors.dark : TeddyColors.light;

  const [screen, setScreen] = useState<'name' | 'guide'>('name');
  const [nameInput, setNameInput] = useState('');
  const [validationError, setValidationError] = useState('');
  const [guideStep, setGuideStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Android hardware back button handler
  useEffect(() => {
    const backAction = () => {
      if (screen === 'guide') {
        if (guideStep > 0) {
          setGuideStep((prev) => prev - 1);
          return true; // handled
        } else {
          // Go back to name screen
          setScreen('name');
          return true; // handled
        }
      } else {
        // In name screen: dismiss keyboard if active
        Keyboard.dismiss();
        // Return true to prevent accidentally exiting into uncompleted dashboard
        return true;
      }
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [screen, guideStep]);

  async function handleNameSubmit() {
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setValidationError('Please enter a name to continue ❤️');
      return;
    }
    setValidationError('');
    Keyboard.dismiss();
    setScreen('guide');
  }

  async function handleFinishOnboarding() {
    if (submitting) return;
    setSubmitting(true);
    const finalName = nameInput.trim() || 'Friend';
    try {
      await preferencesService.completeOnboarding(finalName);
      onComplete(finalName);
    } catch (err) {
      console.warn('[ONBOARDING] Failed to save preferences:', err);
      // Fallback complete in UI
      onComplete(finalName);
    } finally {
      setSubmitting(false);
    }
  }

  function handleNextGuideStep() {
    if (guideStep < GUIDE_STEPS.length - 1) {
      setGuideStep((prev) => prev + 1);
    } else {
      handleFinishOnboarding();
    }
  }

  function handlePrevGuideStep() {
    if (guideStep > 0) {
      setGuideStep((prev) => prev - 1);
    } else {
      setScreen('name');
    }
  }

  const currentGuide = GUIDE_STEPS[guideStep];
  const isLastStep = guideStep === GUIDE_STEPS.length - 1;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: teddy.background }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {screen === 'name' ? (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled">
            {/* Mascot Top */}
            <View style={styles.mascotWrapper}>
              <AnimatedTeddy size={100} />
            </View>

            {/* Teddy Speech Bubble Card */}
            <View
              style={[
                styles.bubbleCard,
                {
                  backgroundColor: teddy.card,
                  borderColor: teddy.border,
                },
              ]}>
              <View style={[styles.badgePill, { backgroundColor: teddy.tagBg }]}>
                <Text style={[styles.badgeText, { color: teddy.primaryDark }]}>
                  🧸 Welcome to Our Voice
                </Text>
              </View>

              <Text style={[styles.greetingTitle, { color: teddy.text }]}>
                Hey there! 👋
              </Text>
              <Text style={[styles.greetingSubtitle, { color: teddy.textSecondary }]}>
                What should Teddy call you?
              </Text>

              {/* Name Input */}
              <View
                style={[
                  styles.inputWrapper,
                  {
                    backgroundColor: teddy.cardAlt,
                    borderColor: validationError ? '#E06D7F' : teddy.border,
                  },
                ]}>
                <Ionicons
                  name="person-outline"
                  size={19}
                  color={teddy.textSecondary}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={[styles.textInput, { color: teddy.text }]}
                  placeholder="Enter your name"
                  placeholderTextColor={teddy.textTertiary}
                  value={nameInput}
                  onChangeText={(val) => {
                    setNameInput(val);
                    if (validationError) setValidationError('');
                  }}
                  autoCapitalize="words"
                  autoCorrect={false}
                  maxLength={50}
                  returnKeyType="done"
                  onSubmitEditing={handleNameSubmit}
                />
                {nameInput.length > 0 && (
                  <Pressable
                    onPress={() => setNameInput('')}
                    hitSlop={8}
                    style={styles.clearIcon}>
                    <Ionicons name="close-circle" size={18} color={teddy.textSecondary} />
                  </Pressable>
                )}
              </View>

              {validationError ? (
                <Text style={styles.errorText}>{validationError}</Text>
              ) : null}

              {/* Offline Safe Badge */}
              <View style={styles.safeOfflineRow}>
                <Ionicons name="shield-checkmark" size={14} color="#2E7D32" />
                <Text style={[styles.safeOfflineText, { color: teddy.textSecondary }]}>
                  Saved securely on this phone only. 100% offline.
                </Text>
              </View>

              {/* Continue Button */}
              <Pressable
                style={({ pressed }) => [
                  styles.primaryBtn,
                  { backgroundColor: teddy.primary },
                  pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] },
                ]}
                onPress={handleNameSubmit}>
                <Text style={styles.primaryBtnText}>Continue</Text>
                <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
              </Pressable>
            </View>
          </ScrollView>
        ) : (
          <View style={styles.guideContainer}>
            {/* Guide Top Bar */}
            <View style={styles.guideTopBar}>
              <Pressable
                onPress={handlePrevGuideStep}
                hitSlop={12}
                style={styles.topBackBtn}>
                <Ionicons name="chevron-back" size={24} color={teddy.text} />
              </Pressable>

              {/* Step Progress Indicators */}
              <View style={styles.progressRow}>
                {GUIDE_STEPS.map((_, idx) => (
                  <View
                    key={idx}
                    style={[
                      styles.progressPill,
                      {
                        backgroundColor:
                          idx === guideStep
                            ? teddy.primary
                            : idx < guideStep
                            ? teddy.accent
                            : teddy.border,
                        width: idx === guideStep ? 24 : 8,
                      },
                    ]}
                  />
                ))}
              </View>

              {/* Skip Option */}
              <Pressable
                onPress={handleFinishOnboarding}
                hitSlop={12}
                style={styles.skipBtn}>
                <Text style={[styles.skipBtnText, { color: teddy.textSecondary }]}>
                  Skip
                </Text>
              </Pressable>
            </View>

            {/* Interactive Step Card */}
            <ScrollView
              contentContainerStyle={styles.guideScrollContent}
              showsVerticalScrollIndicator={false}>
              <View style={styles.mascotWrapperGuide}>
                <AnimatedTeddy size={100} />
              </View>

              <Animated.View
                key={`guide-step-${guideStep}`}
                entering={SlideInRight.duration(280)}
                exiting={SlideOutLeft.duration(200)}
                style={[
                  styles.guideCard,
                  {
                    backgroundColor: teddy.card,
                    borderColor: teddy.border,
                  },
                ]}>
                {/* Step Tag & Emoji */}
                <View style={styles.guideCardHeader}>
                  <View
                    style={[
                      styles.stepIconCircle,
                      { backgroundColor: currentGuide.accentBg },
                    ]}>
                    <Ionicons
                      name={currentGuide.accentIcon}
                      size={24}
                      color={currentGuide.accentColor}
                    />
                  </View>
                  <View style={[styles.stepTagPill, { backgroundColor: teddy.tagBg }]}>
                    <Text style={[styles.stepTagText, { color: teddy.primaryDark }]}>
                      Step {guideStep + 1} of {GUIDE_STEPS.length} • {currentGuide.tag}
                    </Text>
                  </View>
                </View>

                {/* Step Title & Subtitle */}
                <Text style={[styles.guideTitle, { color: teddy.text }]}>
                  {currentGuide.title(nameInput.trim() || 'Friend')}
                </Text>
                <Text style={[styles.guideSubtitle, { color: teddy.textSecondary }]}>
                  {currentGuide.subtitle}
                </Text>

                {/* Step 5 Special Completion Note */}
                {isLastStep && (
                  <Animated.View
                    entering={FadeIn.delay(150)}
                    exiting={FadeOut}
                    style={[styles.allSetBox, { backgroundColor: teddy.cardAlt }]}>
                    <Text style={[styles.allSetText, { color: teddy.text }]}>
                      {"You're all set! 🧸❤️"}
                    </Text>
                  </Animated.View>
                )}
              </Animated.View>
            </ScrollView>

            {/* Bottom Actions */}
            <View style={styles.guideBottomBar}>
              <Pressable
                style={({ pressed }) => [
                  styles.primaryBtn,
                  { backgroundColor: teddy.primary },
                  pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] },
                ]}
                disabled={submitting}
                onPress={handleNextGuideStep}>
                <Text style={styles.primaryBtnText}>
                  {isLastStep ? "Let's go 🧸" : 'Next'}
                </Text>
                <Ionicons
                  name={isLastStep ? 'sparkles' : 'arrow-forward'}
                  size={18}
                  color="#FFFFFF"
                />
              </Pressable>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 22,
    paddingVertical: 32,
  },
  mascotWrapper: {
    alignItems: 'center',
    marginBottom: 16,
  },
  mascotWrapperGuide: {
    alignItems: 'center',
    marginVertical: 12,
  },
  bubbleCard: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 24,
    shadowColor: '#7A4A20',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  badgePill: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 14,
    marginBottom: 12,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  greetingTitle: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: 6,
  },
  greetingSubtitle: {
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 20,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    borderRadius: 16,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  inputIcon: {
    marginRight: 10,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    height: '100%',
    padding: 0,
    fontWeight: '600',
  },
  clearIcon: {
    padding: 4,
  },
  errorText: {
    color: '#E06D7F',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    marginLeft: 4,
  },
  safeOfflineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    marginBottom: 22,
    paddingHorizontal: 4,
  },
  safeOfflineText: {
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    borderRadius: 18,
    gap: 8,
    shadowColor: '#8B5A2B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  guideContainer: {
    flex: 1,
    justifyContent: 'space-between',
  },
  guideTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  topBackBtn: {
    padding: 4,
    width: 44,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  progressPill: {
    height: 8,
    borderRadius: 4,
  },
  skipBtn: {
    padding: 4,
    width: 44,
    alignItems: 'flex-end',
  },
  skipBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  guideScrollContent: {
    paddingHorizontal: 22,
    paddingBottom: 20,
  },
  guideCard: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 24,
    shadowColor: '#7A4A20',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  guideCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  stepIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepTagPill: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  stepTagText: {
    fontSize: 12,
    fontWeight: '700',
  },
  guideTitle: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
    lineHeight: 28,
    marginBottom: 8,
  },
  guideSubtitle: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },
  allSetBox: {
    marginTop: 18,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  allSetText: {
    fontSize: 15,
    fontWeight: '700',
  },
  guideBottomBar: {
    paddingHorizontal: 22,
    paddingBottom: 24,
    paddingTop: 8,
  },
});
