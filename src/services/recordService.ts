import { DeviceEventEmitter } from 'react-native';
import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import { vnRepository } from '@/database/repositories/vnRepository';
import { deleteAudioFile, saveRecordedAudioFile } from './fileService';
import { VN } from '@/types/vn';

export const recordService = {
  /**
   * Checks if microphone permission has been granted.
   */
  async checkPermissions(): Promise<boolean> {
    try {
      const response = await getRecordingPermissionsAsync();
      return response.granted;
    } catch (err) {
      console.warn('[RECORD SERVICE] checkPermissions error:', err);
      return false;
    }
  },

  /**
   * Requests microphone permission from the user.
   */
  async requestPermissions(): Promise<boolean> {
    try {
      const response = await requestRecordingPermissionsAsync();
      return response.granted;
    } catch (err) {
      console.warn('[RECORD SERVICE] requestPermissions error:', err);
      return false;
    }
  },

  /**
   * Configures the system audio session for recording.
   */
  async prepareAudioForRecording(): Promise<void> {
    try {
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        interruptionMode: 'doNotMix',
      });
    } catch (err) {
      console.warn('[RECORD SERVICE] prepareAudioForRecording error:', err);
    }
  },

  /**
   * Restores the system audio session to background playback mode.
   */
  async restoreAudioAfterRecording(): Promise<void> {
    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        interruptionMode: 'doNotMix',
      });
    } catch (err) {
      console.warn('[RECORD SERVICE] restoreAudioAfterRecording error:', err);
    }
  },

  /**
   * Generates a sensible default title like "Recording 1", "Recording 2".
   */
  async getDefaultTitle(): Promise<string> {
    try {
      const recorded = await vnRepository.getRecordedVns();
      return `Recording ${recorded.length + 1}`;
    } catch {
      return `Recording ${Date.now().toString().slice(-4)}`;
    }
  },

  /**
   * Generates a collision-free next take title for a recording.
   * Examples:
   * "My Song" -> "My Song — Take 2"
   * "My Song — Take 2" -> "My Song — Take 3"
   */
  async getNextTakeTitle(baseTitle: string): Promise<string> {
    const trimmed = baseTitle.trim();
    if (!trimmed) {
      return await this.getDefaultTitle();
    }

    // 1. Extract root title if baseTitle already has " — Take N"
    const takeMatch = trimmed.match(/^(.+?)\s+—\s+Take\s+(\d+)$/i);
    const rootTitle = takeMatch ? takeMatch[1].trim() : trimmed;

    try {
      const allVns = await vnRepository.getAllVns();
      const escapedRoot = rootTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`^${escapedRoot}(?:\\s+—\\s+Take\\s+(\\d+))?$`, 'i');

      const existingNumbers = new Set<number>();
      for (const vn of allVns) {
        const match = vn.title.trim().match(pattern);
        if (match) {
          if (match[1]) {
            existingNumbers.add(parseInt(match[1], 10));
          } else {
            // Root title without take suffix counts as Take 1
            existingNumbers.add(1);
          }
        }
      }

      // Determine next available take number starting from 2
      let nextTake = 2;
      while (existingNumbers.has(nextTake)) {
        nextTake++;
      }

      return `${rootTitle} — Take ${nextTake}`;
    } catch {
      return `${rootTitle} — Take 2`;
    }
  },

  /**
   * Atomically saves a finalized recording into permanent storage and SQLite.
   * Automatically cleans up the permanent audio file if SQLite insertion fails.
   */
  async saveRecording(
    tempUri: string,
    durationSeconds: number,
    customTitle?: string
  ): Promise<VN> {
    const id = 'rec_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
    const title = customTitle?.trim() || (await this.getDefaultTitle());

    // 1. Copy to permanent document storage and verify physical file
    const permanentUri = await saveRecordedAudioFile(tempUri, id);

    let vn: VN;
    try {
      // 2. Insert metadata into SQLite
      vn = await vnRepository.createVn({
        id,
        title,
        fileUri: permanentUri,
        duration: Math.max(0, durationSeconds),
        createdAt: Date.now(),
        isLiked: false,
        source: 'recorded',
      });
    } catch (dbErr) {
      // Atomic rollback: remove copied file if database insert fails
      deleteAudioFile(permanentUri);
      throw dbErr;
    }

    console.log('[RECORD SERVICE] Saved recording to library:', vn.title, vn.fileUri);

    // 3. Notify app components
    DeviceEventEmitter.emit('library_updated');

    return vn;
  },
};
