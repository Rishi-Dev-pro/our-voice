import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  AppStateStatus,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  withSpring,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import { RecordingPresets, useAudioRecorder, useAudioRecorderState } from 'expo-audio';

import { useTheme } from '@/hooks/use-theme';
import { useAudioActions } from '@/services/audioPlayerContext';
import { recordService } from '@/services/recordService';
import { deleteAudioFile } from '@/services/fileService';
import { sharingService } from '@/services/sharingService';
import { formatDuration } from '@/utils/format';
import { LiveWaveform } from '@/components/live-waveform';
import { VN } from '@/types/vn';
import { teddyReactionService } from '@/services/teddyReactionService';

type RecordStage = 'idle' | 'recording' | 'paused' | 'stopped' | 'saving' | 'saved';

export default function RecordScreen() {
  const router = useRouter();
  const { takeBaseTitle } = useLocalSearchParams<{ takeBaseTitle?: string }>();
  const theme = useTheme();
  const { stop: stopPlayback } = useAudioActions();

  const [stage, setStage] = useState<RecordStage>('idle');
  const stageRef = useRef<RecordStage>('idle');
  stageRef.current = stage;

  // Suppress teddy reactions while recording/paused
  useEffect(() => {
    const isRecording = stage === 'recording' || stage === 'paused';
    teddyReactionService.setRecordingActive(isRecording);
  }, [stage]);

  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const [checkingPermission, setCheckingPermission] = useState(true);
  const [finalUri, setFinalUri] = useState<string | null>(null);
  const finalUriRef = useRef<string | null>(null);
  finalUriRef.current = finalUri;
  const isSavingRef = useRef(false);
  const [finalDuration, setFinalDuration] = useState(0);
  const [titleInput, setTitleInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  isSavingRef.current = isSaving;
  const [savedVn, setSavedVn] = useState<VN | null>(null);

  // Audio Recorder Hook with metering enabled for live waveform
  const recordingOptions = useMemo(
    () => ({
      ...RecordingPresets.HIGH_QUALITY,
      isMeteringEnabled: true,
    }),
    []
  );
  const recorder = useAudioRecorder(recordingOptions);
  const recorderState = useAudioRecorderState(recorder, 100);

  // Wall-clock timestamp timer tracking (immune to interval drift and render lag)
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startTimeRef = useRef<number>(0);
  const accumulatedMsRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Animations for pulsing recording indicator
  const pulseScale = useSharedValue(1);
  const pulseOpacity = useSharedValue(0.4);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
    opacity: pulseOpacity.value,
  }));

  // Initial setup: stop audio player, check mic permission, initialize title
  useEffect(() => {
    stopPlayback();
    checkInitialPermission();
    initializeTitle();

    return () => {
      clearTimer();
      teddyReactionService.setRecordingActive(false);
      // Safely cleanup active or abandoned recording session on sudden unmount
      try {
        if (stageRef.current === 'recording' || stageRef.current === 'paused') {
          recorder.stop().catch(() => {});
          if (recorder.uri) {
            deleteAudioFile(recorder.uri);
          }
        } else if (stageRef.current === 'stopped' && finalUriRef.current) {
          deleteAudioFile(finalUriRef.current);
        }
      } catch {}
      recordService.restoreAudioAfterRecording();
    };
  }, []);

  async function checkInitialPermission() {
    setCheckingPermission(true);
    const granted = await recordService.checkPermissions();
    setPermissionGranted(granted);
    setCheckingPermission(false);
  }

  async function requestPermission() {
    const granted = await recordService.requestPermissions();
    setPermissionGranted(granted);
    if (!granted) {
      Alert.alert(
        'Microphone Permission Required',
        'Our Voice needs microphone access to record audio. Please enable microphone permission in your device settings.',
        [{ text: 'OK' }]
      );
    }
  }

  async function initializeTitle() {
    if (takeBaseTitle) {
      try {
        const nextTake = await recordService.getNextTakeTitle(takeBaseTitle);
        setTitleInput(nextTake);
        return;
      } catch {}
    }
    const def = await recordService.getDefaultTitle();
    setTitleInput(def);
  }

  // AppState backgrounding: gracefully auto-pause recording when app moves to background
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState !== 'active' && stageRef.current === 'recording') {
        handlePauseRecording();
      }
    });
    return () => subscription.remove();
  }, []);

  // Handle hardware back press on Android when recording/paused
  useEffect(() => {
    const backAction = () => {
      if (stage === 'recording' || stage === 'paused') {
        confirmExitOptions();
        return true;
      }
      return false;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [stage, finalUri, titleInput, elapsedSeconds]);

  function clearTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function startTimer() {
    clearTimer();
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      const currentMs = accumulatedMsRef.current + (Date.now() - startTimeRef.current);
      setElapsedSeconds(Math.max(0, Math.floor(currentMs / 1000)));
    }, 250);
  }

  function pauseTimer() {
    clearTimer();
    accumulatedMsRef.current += Date.now() - startTimeRef.current;
    setElapsedSeconds(Math.max(0, Math.floor(accumulatedMsRef.current / 1000)));
  }

  function resetTimer() {
    clearTimer();
    accumulatedMsRef.current = 0;
    startTimeRef.current = 0;
    setElapsedSeconds(0);
  }

  // Pulsing animation control
  useEffect(() => {
    if (stage === 'recording') {
      pulseScale.value = withRepeat(
        withSequence(
          withTiming(1.3, { duration: 800, easing: Easing.inOut(Easing.ease) }),
          withTiming(1.0, { duration: 800, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        true
      );
      pulseOpacity.value = withRepeat(
        withSequence(
          withTiming(0.15, { duration: 800, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.4, { duration: 800, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        true
      );
    } else {
      cancelAnimation(pulseScale);
      cancelAnimation(pulseOpacity);
      pulseScale.value = withSpring(1);
      pulseOpacity.value = 0;
    }
  }, [stage]);

  // Record Lifecycle Actions
  async function handleStartRecording() {
    if (!permissionGranted) {
      const granted = await recordService.requestPermissions();
      setPermissionGranted(granted);
      if (!granted) return;
    }

    try {
      stopPlayback();
      await recordService.prepareAudioForRecording();
      await recorder.prepareToRecordAsync();
      recorder.record();
      setStage('recording');
      resetTimer();
      startTimer();
    } catch (err: any) {
      console.error('[RECORD] Start recording failed:', err);
      Alert.alert('Recording Error', err?.message || 'Could not start recording.');
    }
  }

  function handlePauseRecording() {
    try {
      recorder.pause();
      pauseTimer();
      setStage('paused');
    } catch (err: any) {
      console.error('[RECORD] Pause recording failed:', err);
    }
  }

  function handleResumeRecording() {
    try {
      recorder.record();
      startTimer();
      setStage('recording');
    } catch (err: any) {
      console.error('[RECORD] Resume recording failed:', err);
    }
  }

  async function handleStopRecording() {
    pauseTimer();
    try {
      await recorder.stop();
      const recordedUri = recorder.uri;
      const durationSec =
        recorderState.durationMillis > 0
          ? Math.round(recorderState.durationMillis / 1000)
          : Math.max(1, elapsedSeconds);

      if (!recordedUri) {
        throw new Error('No audio file was generated.');
      }

      setFinalUri(recordedUri);
      setFinalDuration(Math.max(1, durationSec));
      setStage('stopped');
      await recordService.restoreAudioAfterRecording();
    } catch (err: any) {
      console.error('[RECORD] Stop recording failed:', err);
      Alert.alert('Error', err?.message || 'Failed to finalize audio recording.');
      setStage('idle');
    }
  }

  async function handleSaveRecording() {
    if (!finalUri || isSavingRef.current) return;
    setIsSaving(true);
    setStage('saving');
    try {
      const saved = await recordService.saveRecording(finalUri, finalDuration, titleInput);
      setSavedVn(saved);
      setStage('saved');
      teddyReactionService.trigger('RECORDING_SAVED');
    } catch (err: any) {
      console.error('[RECORD] Save recording failed:', err);
      Alert.alert('Save Failed', err?.message || 'Could not save voice note to permanent storage.');
      setStage('stopped');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleTakeAgain() {
    // Generate next take title from current title
    const currentBase = titleInput.trim() || 'Voice Note';
    const nextTitle = await recordService.getNextTakeTitle(currentBase);

    // Reset studio state cleanly for the new take
    setFinalUri(null);
    setFinalDuration(0);
    resetTimer();
    setSavedVn(null);
    setTitleInput(nextTitle);
    setStage('idle');
    teddyReactionService.trigger('TAKE_AGAIN');
  }

  async function handleShareSaved() {
    if (savedVn) {
      await sharingService.shareVnAudio(savedVn);
      teddyReactionService.trigger('SHARE');
    }
  }

  function handleDiscard() {
    Alert.alert(
      'Discard Recording',
      'Are you sure you want to discard this recording? It cannot be recovered.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            if (finalUri) {
              deleteAudioFile(finalUri);
            }
            setFinalUri(null);
            setFinalDuration(0);
            resetTimer();
            setStage('idle');
            initializeTitle();
          },
        },
      ]
    );
  }

  function confirmExitOptions() {
    Alert.alert(
      'Recording in progress 🧸',
      'Would you like to save or discard your current recording before leaving?',
      [
        { text: 'Keep Recording', style: 'cancel' },
        {
          text: 'Save & Exit',
          onPress: async () => {
            try {
              pauseTimer();
              await recorder.stop();
              const recordedUri = recorder.uri;
              if (recordedUri) {
                const duration = Math.max(1, elapsedSeconds);
                await recordService.saveRecording(recordedUri, duration, titleInput);
              }
            } catch (e) {
              console.warn('Could not save on exit:', e);
            }
            router.back();
          },
        },
        {
          text: 'Discard & Exit',
          style: 'destructive',
          onPress: async () => {
            try {
              pauseTimer();
              await recorder.stop();
              if (recorder.uri) {
                deleteAudioFile(recorder.uri);
              }
            } catch {}
            router.back();
          },
        },
      ]
    );
  }

  function handleBack() {
    if (isSaving || stage === 'saving') {
      // Do not allow exiting or deleting while save is actively in flight
      return;
    }
    if (stage === 'recording' || stage === 'paused') {
      confirmExitOptions();
    } else {
      if (stage === 'stopped' && finalUri) {
        deleteAudioFile(finalUri);
        setFinalUri(null);
      }
      router.back();
    }
  }

  const currentDurationSec =
    stage === 'stopped' || stage === 'saved'
      ? finalDuration
      : elapsedSeconds;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      {/* Top Header */}
      <View style={styles.topBar}>
        <Pressable style={styles.backBtn} hitSlop={12} onPress={handleBack}>
          <Ionicons name="chevron-back" size={26} color={theme.tint} />
          <Text style={[styles.backText, { color: theme.tint }]}>
            {stage === 'saved' ? 'Done' : 'Cancel'}
          </Text>
        </Pressable>
        <Text style={[styles.navTitle, { color: theme.text }]}>Voice Studio</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Main Studio Area */}
      <View style={styles.content}>
        {/* Permission Denied Notice */}
        {permissionGranted === false && !checkingPermission && (
          <View
            style={[
              styles.permissionCard,
              { backgroundColor: theme.card, borderColor: theme.separator },
            ]}>
            <Ionicons name="mic-off-outline" size={36} color={theme.tint} />
            <Text style={[styles.permissionTitle, { color: theme.text }]}>
              Microphone Permission Needed
            </Text>
            <Text style={[styles.permissionSub, { color: theme.textSecondary }]}>
              Our Voice records your voice notes completely offline. Please grant microphone access to start recording.
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.grantBtn,
                { backgroundColor: theme.tint },
                pressed && { opacity: 0.8 },
              ]}
              onPress={requestPermission}>
              <Text style={styles.grantBtnText}>Grant Permission</Text>
            </Pressable>
          </View>
        )}

        {/* Center Visualizer & Status */}
        <View style={styles.centerSection}>
          {/* Pulsing Mic Circle */}
          <View style={styles.micCircleContainer}>
            <Animated.View
              style={[
                styles.pulseRing,
                { backgroundColor: theme.tint },
                pulseStyle,
              ]}
            />
            <View
              style={[
                styles.micCircle,
                {
                  backgroundColor:
                    stage === 'recording'
                      ? '#FF3B30'
                      : stage === 'paused'
                      ? '#FF9500'
                      : stage === 'stopped' || stage === 'saved'
                      ? '#34C759'
                      : theme.tint,
                },
              ]}>
              <Ionicons
                name={
                  stage === 'recording'
                    ? 'mic'
                    : stage === 'paused'
                    ? 'pause'
                    : stage === 'stopped' || stage === 'saved'
                    ? 'checkmark-done'
                    : 'mic-outline'
                }
                size={44}
                color="#FFFFFF"
              />
            </View>
          </View>

          {/* Status Label with Teddy encouragement */}
          <Text style={[styles.statusText, { color: theme.textSecondary }]}>
            {stage === 'idle' && 'Ready to record your voice 🧸'}
            {stage === 'recording' && 'Listening to your voice... 🧸'}
            {stage === 'paused' && 'Paused — take your time 🧸'}
            {stage === 'stopped' && 'Recording completed ✨'}
            {stage === 'saved' && 'Saved safely on your device ❤️🧸'}
          </Text>

          {/* Large Accurate Duration Display */}
          <Text style={[styles.timerText, { color: theme.text }]}>
            {formatDuration(currentDurationSec)}
          </Text>

          {/* Real-time Visual Waveform */}
          <View style={styles.waveformWrapper}>
            <LiveWaveform
              stage={stage === 'saved' || stage === 'saving' ? 'stopped' : stage}
              metering={recorderState.metering}
              height={64}
            />
          </View>

          {/* Privacy Reassurance Pill */}
          <View style={[styles.offlinePill, { backgroundColor: theme.backgroundElement }]}>
            <Ionicons name="shield-checkmark" size={14} color="#34C759" />
            <Text style={[styles.offlinePillText, { color: theme.textSecondary }]}>
              100% Private & Stored Locally
            </Text>
          </View>
        </View>

        {/* Post-Recording Title & Options (Stopped State) */}
        {stage === 'stopped' && (
          <View
            style={[
              styles.stoppedCard,
              { backgroundColor: theme.card, borderColor: theme.separator },
            ]}>
            <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
              Voice Note Title
            </Text>
            <TextInput
              style={[
                styles.titleInput,
                {
                  color: theme.text,
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.separator,
                },
              ]}
              value={titleInput}
              onChangeText={setTitleInput}
              placeholder="Recording name..."
              placeholderTextColor={theme.textTertiary}
            />
          </View>
        )}

        {/* Saved State Card with Take Again & Share */}
        {stage === 'saved' && savedVn && (
          <View
            style={[
              styles.savedCard,
              { backgroundColor: theme.card, borderColor: theme.separator },
            ]}>
            <View style={styles.savedCardHeader}>
              <Ionicons name="checkmark-circle" size={24} color="#34C759" />
              <View style={styles.savedCardTextContainer}>
                <Text style={[styles.savedCardTitle, { color: theme.text }]} numberOfLines={1}>
                  {savedVn.title}
                </Text>
                <Text style={[styles.savedCardSub, { color: theme.textSecondary }]}>
                  {formatDuration(savedVn.duration)} • Saved to Keepsakes
                </Text>
              </View>
            </View>

            {/* Quick Actions Grid: Take Again & Share */}
            <View style={styles.savedActionsRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.takeAgainBtn,
                  { backgroundColor: theme.backgroundElement, borderColor: theme.separator },
                  pressed && { opacity: 0.75 },
                ]}
                onPress={handleTakeAgain}>
                <Ionicons name="repeat" size={18} color={theme.tint} />
                <Text style={[styles.takeAgainText, { color: theme.tint }]}>Take Again</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.shareBtn,
                  { backgroundColor: theme.backgroundElement, borderColor: theme.separator },
                  pressed && { opacity: 0.75 },
                ]}
                onPress={handleShareSaved}>
                <Ionicons name="share-outline" size={18} color={theme.tint} />
                <Text style={[styles.shareText, { color: theme.tint }]}>Share</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Controls Section */}
        <View style={styles.controlsSection}>
          {/* IDLE: Big Start Button */}
          {stage === 'idle' && (
            <Pressable
              style={({ pressed }) => [
                styles.mainActionBtn,
                { backgroundColor: theme.tint },
                pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
              ]}
              onPress={handleStartRecording}>
              <Ionicons name="radio-button-on" size={24} color="#FFFFFF" />
              <Text style={styles.mainActionText}>Start Recording</Text>
            </Pressable>
          )}

          {/* RECORDING: Pause and Done */}
          {stage === 'recording' && (
            <View style={styles.dualControls}>
              <Pressable
                style={({ pressed }) => [
                  styles.secondaryControlBtn,
                  { backgroundColor: theme.backgroundElement },
                  pressed && { opacity: 0.7 },
                ]}
                onPress={handlePauseRecording}>
                <Ionicons name="pause" size={22} color={theme.text} />
                <Text style={[styles.secondaryControlText, { color: theme.text }]}>Pause</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.stopControlBtn,
                  pressed && { opacity: 0.85 },
                ]}
                onPress={handleStopRecording}>
                <Ionicons name="stop" size={22} color="#FFFFFF" />
                <Text style={styles.stopControlText}>Done</Text>
              </Pressable>
            </View>
          )}

          {/* PAUSED: Resume and Done */}
          {stage === 'paused' && (
            <View style={styles.dualControls}>
              <Pressable
                style={({ pressed }) => [
                  styles.secondaryControlBtn,
                  { backgroundColor: theme.tint },
                  pressed && { opacity: 0.85 },
                ]}
                onPress={handleResumeRecording}>
                <Ionicons name="play" size={22} color="#FFFFFF" />
                <Text style={[styles.secondaryControlText, { color: '#FFFFFF' }]}>Resume</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.stopControlBtn,
                  pressed && { opacity: 0.85 },
                ]}
                onPress={handleStopRecording}>
                <Ionicons name="stop" size={22} color="#FFFFFF" />
                <Text style={styles.stopControlText}>Done</Text>
              </Pressable>
            </View>
          )}

          {/* STOPPED: Discard and Save */}
          {stage === 'stopped' && (
            <View style={styles.stoppedControls}>
              <Pressable
                style={({ pressed }) => [
                  styles.discardBtn,
                  { backgroundColor: theme.backgroundElement },
                  pressed && { opacity: 0.7 },
                ]}
                onPress={handleDiscard}>
                <Ionicons name="trash-outline" size={20} color="#FF3B30" />
                <Text style={styles.discardBtnText}>Discard</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.saveBtn,
                  { backgroundColor: theme.tint },
                  pressed && { opacity: 0.85 },
                  isSaving && { opacity: 0.6 },
                ]}
                disabled={isSaving}
                onPress={handleSaveRecording}>
                {isSaving ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="cloud-download-outline" size={20} color="#FFFFFF" />
                    <Text style={styles.saveBtnText}>Save Recording</Text>
                  </>
                )}
              </Pressable>
            </View>
          )}

          {/* SAVED: View in Library and Done */}
          {stage === 'saved' && (
            <View style={styles.savedBottomControls}>
              <Pressable
                style={({ pressed }) => [
                  styles.viewRecordedBtn,
                  { backgroundColor: theme.backgroundElement },
                  pressed && { opacity: 0.75 },
                ]}
                onPress={() => router.replace('/recorded' as any)}>
                <Ionicons name="folder-open-outline" size={18} color={theme.text} />
                <Text style={[styles.viewRecordedText, { color: theme.text }]}>View in Library</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.doneBtn,
                  { backgroundColor: theme.tint },
                  pressed && { opacity: 0.85 },
                ]}
                onPress={() => router.back()}>
                <Text style={styles.doneBtnText}>Done</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  backText: {
    fontSize: 16,
    marginLeft: -4,
  },
  navTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
    paddingBottom: 32,
  },
  permissionCard: {
    padding: 20,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    marginVertical: 20,
    gap: 10,
  },
  permissionTitle: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  permissionSub: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  grantBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
    marginTop: 6,
  },
  grantBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  centerSection: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  micCircleContainer: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginBottom: 16,
  },
  pulseRing: {
    position: 'absolute',
    width: 115,
    height: 115,
    borderRadius: 58,
  },
  micCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  statusText: {
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 6,
  },
  timerText: {
    fontSize: 48,
    fontWeight: '700',
    letterSpacing: 1,
    fontVariant: ['tabular-nums'],
    marginBottom: 12,
  },
  waveformWrapper: {
    width: '100%',
    marginVertical: 6,
    alignItems: 'center',
  },
  offlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    marginTop: 8,
  },
  offlinePillText: {
    fontSize: 13,
    fontWeight: '500',
  },
  stoppedCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    marginVertical: 12,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  titleInput: {
    height: 44,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  savedCard: {
    padding: 16,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    marginVertical: 8,
    gap: 12,
  },
  savedCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  savedCardTextContainer: {
    flex: 1,
  },
  savedCardTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  savedCardSub: {
    fontSize: 13,
    marginTop: 2,
  },
  savedActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  takeAgainBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 42,
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  takeAgainText: {
    fontSize: 14,
    fontWeight: '600',
  },
  shareBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 42,
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  shareText: {
    fontSize: 14,
    fontWeight: '600',
  },
  controlsSection: {
    width: '100%',
    paddingBottom: 8,
  },
  mainActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 56,
    borderRadius: 28,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  mainActionText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  dualControls: {
    flexDirection: 'row',
    gap: 14,
  },
  secondaryControlBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 54,
    borderRadius: 27,
    gap: 8,
  },
  secondaryControlText: {
    fontSize: 16,
    fontWeight: '600',
  },
  stopControlBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 54,
    borderRadius: 27,
    backgroundColor: '#FF3B30',
    gap: 8,
  },
  stopControlText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  stoppedControls: {
    flexDirection: 'row',
    gap: 12,
  },
  discardBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 54,
    borderRadius: 27,
    gap: 6,
  },
  discardBtnText: {
    color: '#FF3B30',
    fontSize: 16,
    fontWeight: '600',
  },
  saveBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 54,
    borderRadius: 27,
    gap: 8,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  savedBottomControls: {
    flexDirection: 'row',
    gap: 12,
  },
  viewRecordedBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    borderRadius: 26,
    gap: 6,
  },
  viewRecordedText: {
    fontSize: 15,
    fontWeight: '600',
  },
  doneBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    borderRadius: 26,
  },
  doneBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
