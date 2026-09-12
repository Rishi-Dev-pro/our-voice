import { Alert, Share } from 'react-native';
import { VN } from '@/types/vn';
import { checkAudioFileExists } from './fileService';

import * as ExpoSharing from 'expo-sharing';

export const OVP_MIME_TYPE = 'application/vnd.ourvoice.ovp';

export const sharingService = {
  /**
   * Opens the Android share sheet to export/share a physical voice note audio file.
   * Uses expo-sharing if linked, with fallback to React Native Share.
   * Completely offline, zero cloud uploads.
   */
  async shareVnAudio(vn: VN): Promise<boolean> {
    try {
      // 1. Verify local audio file exists in permanent storage
      if (!checkAudioFileExists(vn.fileUri)) {
        Alert.alert(
          'Recording Unavailable',
          "Sorry, Teddy couldn't find this recording file in local storage. 🧸"
        );
        return false;
      }

      // 2. Try expo-sharing native module if available
      if (ExpoSharing && typeof ExpoSharing.isAvailableAsync === 'function') {
        try {
          const isAvailable = await ExpoSharing.isAvailableAsync();
          if (isAvailable) {
            await ExpoSharing.shareAsync(vn.fileUri, {
              mimeType: 'audio/m4a',
              dialogTitle: `Share "${vn.title}"`,
              UTI: 'public.audio',
            });
            return true;
          }
        } catch (shareErr) {
          console.warn('[SHARING SERVICE] expo-sharing failed, falling back to core Share:', shareErr);
        }
      }

      // 3. Resilient fallback to React Native core Share
      await Share.share({
        title: vn.title,
        message: `Voice Note: "${vn.title}" 🧸`,
        url: vn.fileUri,
      });

      return true;
    } catch (err: any) {
      console.warn('[SHARING SERVICE] Error sharing voice note:', err);
      if (
        err?.message &&
        !err.message.includes('User did not share') &&
        !err.message.includes('canceled') &&
        !err.message.includes('dismissed')
      ) {
        Alert.alert('Sharing Error', err?.message || 'Failed to open share sheet.');
      }
      return false;
    }
  },

  /**
   * Shares an arbitrary file (such as an .ovp package) via Android share sheet.
   */
  async shareFile(fileUri: string, dialogTitle: string, mimeType?: string): Promise<boolean> {
    const resolvedMimeType =
      mimeType ||
      (fileUri.toLowerCase().includes('.ovp') ? OVP_MIME_TYPE : 'application/octet-stream');

    try {
      if (ExpoSharing && typeof ExpoSharing.isAvailableAsync === 'function') {
        const isAvailable = await ExpoSharing.isAvailableAsync();
        if (isAvailable) {
          const urisToTry = [fileUri];
          const decoded = fileUri.replace(/%2540/gi, '@').replace(/%252F/gi, '/');
          if (decoded !== fileUri && !urisToTry.includes(decoded)) {
            urisToTry.push(decoded);
          }

          let shareSuccess = false;
          let lastShareErr: any = null;
          for (const u of urisToTry) {
            try {
              await ExpoSharing.shareAsync(u, {
                mimeType: resolvedMimeType,
                dialogTitle,
              });
              shareSuccess = true;
              break;
            } catch (err) {
              lastShareErr = err;
            }
          }

          if (shareSuccess) return true;
          console.warn('[SHARING SERVICE] ExpoSharing failed with candidate URIs:', lastShareErr);
        }
      }

      await Share.share({
        title: dialogTitle,
        url: fileUri,
      });
      return true;
    } catch (err: any) {
      if (
        err?.message &&
        !err.message.includes('User did not share') &&
        !err.message.includes('canceled') &&
        !err.message.includes('dismissed')
      ) {
        Alert.alert('Sharing Error', err?.message || 'Failed to share file.');
      }
      return false;
    }
  },
};
