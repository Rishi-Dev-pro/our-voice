import * as DocumentPicker from 'expo-document-picker';
import { DeviceEventEmitter } from 'react-native';
import { createAudioPlayer } from 'expo-audio';
import { vnRepository } from '@/database/repositories/vnRepository';
import { saveAudioFile, deleteAudioFile, checkAudioFileExists } from './fileService';
import { VN } from '@/types/vn';

const AUDIO_EXTENSIONS = [
  'mp3', 'm4a', 'wav', 'aac', 'ogg', 'flac', 'opus', 'wma', 'm4r', 'amr', 'caf', '3gp'
];

function isAudioFile(name: string, mimeType?: string | null): boolean {
  if (mimeType && mimeType.startsWith('audio/')) {
    return true;
  }
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex === -1) return false;
  const ext = name.slice(dotIndex + 1).toLowerCase();
  return AUDIO_EXTENSIONS.includes(ext);
}

/**
 * Extracts duration in seconds for a local audio file using expo-audio.
 * Fallback to 0 if duration cannot be extracted immediately.
 */
async function measureAudioDuration(fileUri: string): Promise<number> {
  let player: any = null;
  try {
    player = createAudioPlayer({ uri: fileUri });
    if (player.duration > 0) {
      const d = player.duration;
      try {
        player.remove?.();
      } catch {}
      return d;
    }

    return await new Promise<number>((resolve) => {
      let resolved = false;
      let sub: any = null;

      const finish = (val: number) => {
        if (!resolved) {
          resolved = true;
          try {
            sub?.remove?.();
          } catch {}
          try {
            player?.remove?.();
          } catch {}
          resolve(val);
        }
      };

      const timer = setTimeout(() => {
        finish(player?.duration || 0);
      }, 400);

      try {
        sub = player.addListener('playbackStatusUpdate', (status: any) => {
          if (status.isLoaded && status.duration && status.duration > 0) {
            clearTimeout(timer);
            finish(status.duration);
          }
        });
      } catch {
        clearTimeout(timer);
        finish(0);
      }
    });
  } catch (err) {
    console.warn('Could not pre-measure audio duration (defaulting to 0):', err);
    try {
      player?.remove?.();
    } catch {}
    return 0;
  }
}

export const vnService = {
  /**
   * Prompts the user to pick an audio file and imports it atomically into permanent local storage and SQLite.
   * Guarantees that no database record is created if physical storage fails.
   * Returns the new VN or null if canceled.
   */
  async importVn(): Promise<VN | null> {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['audio/*'],
      copyToCacheDirectory: true,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return null;
    }

    const asset = result.assets[0];
    if (!asset.uri || !asset.name) {
      throw new Error('Please choose a valid audio file.');
    }

    if (!isAudioFile(asset.name, asset.mimeType)) {
      throw new Error('Selected file is not a supported audio format.');
    }

    // Development logging as requested
    console.log('[VN IMPORT]');
    console.log('picker URI:', asset.uri);
    console.log('picker name:', asset.name);
    console.log('picker MIME type:', asset.mimeType);
    console.log('picker size:', asset.size);

    // Unique ID for the voice note
    const id = 'vn_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
    
    // Default display title is the original filename without extension
    const dotIndex = asset.name.lastIndexOf('.');
    const rawTitle = dotIndex !== -1 ? asset.name.slice(0, dotIndex) : asset.name;
    const title = rawTitle.trim() || 'Untitled VN';

    let permanentUri: string | null = null;

    try {
      // 1. Copy file to permanent app document storage & verify physical existence
      permanentUri = await saveAudioFile(asset.uri, asset.name, id, asset.mimeType);

      // 2. Extra verification check: NEVER create record if file is not on disk
      if (!checkAudioFileExists(permanentUri)) {
        throw new Error('Voice note was imported, but the local file could not be verified on device storage.');
      }

      // 3. Pre-measure duration (non-blocking fallback to 0)
      const duration = await measureAudioDuration(permanentUri);

      // 4. Save metadata in SQLite
      const vn = await vnRepository.createVn({
        id,
        title,
        fileUri: permanentUri,
        duration,
        createdAt: Date.now(),
        isLiked: false,
      });

      console.log('[VN IMPORT] SQLite fileUri:', vn.fileUri);

      return vn;
    } catch (err) {
      // Atomic rollback: if anything fails after copying, delete the copied file
      if (permanentUri) {
        try {
          deleteAudioFile(permanentUri);
        } catch (cleanupErr) {
          console.warn('Failed to clean up copied file during rollback:', cleanupErr);
        }
      }
      throw err;
    }
  },

  /**
   * Completely deletes a VN from SQLite, removes its album associations, and removes the audio file from disk.
   */
  async deleteVn(vn: VN): Promise<void> {
    // 1. Delete physical audio file
    deleteAudioFile(vn.fileUri);

    // 2. Delete from database (cascades to album_vns)
    await vnRepository.deleteVn(vn.id);

    // 3. Emit deletion and library updated events
    DeviceEventEmitter.emit('vn_deleted', vn.id);
    DeviceEventEmitter.emit('library_updated');
  },
};

