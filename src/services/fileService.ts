import { Directory, File, Paths } from 'expo-file-system';
import * as FileSystemLegacy from 'expo-file-system/legacy';

/**
 * Safely extracts and normalizes the audio file extension.
 * Defaults to 'm4a' if cannot be reliably detected.
 */
export function getNormalizedAudioExtension(originalName: string, mimeType?: string | null): string {
  const dotIndex = originalName.lastIndexOf('.');
  if (dotIndex !== -1) {
    const rawExt = originalName.slice(dotIndex + 1).trim().toLowerCase();
    const cleanExt = rawExt.replace(/[^a-z0-9]/g, '');
    if (cleanExt && cleanExt.length <= 8) {
      return cleanExt;
    }
  }
  if (mimeType) {
    const lower = mimeType.toLowerCase();
    if (lower.includes('audio/mp4') || lower.includes('audio/m4a') || lower.includes('audio/x-m4a')) return 'm4a';
    if (lower.includes('audio/mpeg') || lower.includes('audio/mp3')) return 'mp3';
    if (lower.includes('audio/wav') || lower.includes('audio/wave') || lower.includes('audio/x-wav')) return 'wav';
    if (lower.includes('audio/aac') || lower.includes('audio/x-aac')) return 'aac';
    if (lower.includes('audio/ogg')) return 'ogg';
    if (lower.includes('audio/flac')) return 'flac';
    if (lower.includes('audio/opus')) return 'opus';
    if (lower.includes('audio/3gpp')) return '3gp';
  }
  return 'm4a';
}

/**
 * Ensures the permanent local audio directory under the app document directory exists.
 * Uses idempotent and intermediate flags to prevent errors on repeated calls.
 */
export async function ensureAudioDirectory(): Promise<Directory> {
  const audioDir = new Directory(Paths.document, 'audio');
  if (!audioDir.exists) {
    try {
      audioDir.create({ intermediates: true, idempotent: true });
    } catch (err) {
      console.warn('[VN IMPORT] audioDir.create warning:', err);
    }
  }
  // Secondary check with legacy if Directory.create had any permission or timing quirk
  if (!audioDir.exists) {
    try {
      await FileSystemLegacy.makeDirectoryAsync(audioDir.uri, { intermediates: true });
    } catch (err) {
      console.warn('[VN IMPORT] legacy makeDirectoryAsync warning:', err);
    }
  }
  // If still reported not existing, try creating a tiny probe file to force directory creation
  if (!audioDir.exists) {
    try {
      const probe = new File(audioDir, '.probe');
      probe.write('1');
      probe.delete();
    } catch (probeErr) {
      console.warn('[VN IMPORT] probe file write warning:', probeErr);
    }
  }
  return audioDir;
}

/**
 * Returns the permanent local audio directory under the app document directory.
 */
export function getAudioDirectory(): Directory {
  const audioDir = new Directory(Paths.document, 'audio');
  if (!audioDir.exists) {
    try {
      audioDir.create({ intermediates: true, idempotent: true });
    } catch {
      // Ignored: ensureAudioDirectory handles async fallback
    }
  }
  return audioDir;
}

/**
 * Copies an imported audio file to permanent local document storage and verifies its existence.
 * Uses a 4-tier resilient copy pipeline:
 * 1. Legacy FileSystem.copyAsync (Native ContentResolver on Android)
 * 2. Modern File.copy
 * 3. Stream piping
 * 4. Fetch/ContentResolver binary write
 *
 * @param sourceUri URI of the picked audio file (from cache or provider)
 * @param originalName Original file name
 * @param id Unique ID for the VN
 * @param mimeType Optional MIME type
 * @returns Permanent file URI in local storage
 */
export async function saveAudioFile(
  sourceUri: string,
  originalName: string,
  id: string,
  mimeType?: string | null
): Promise<string> {
  // 1. Ensure audio destination directory exists
  const audioDir = await ensureAudioDirectory();

  // 2. Generate clean, safe filename from VN id and validated extension
  const ext = getNormalizedAudioExtension(originalName, mimeType);
  const targetFileName = `${id}.${ext}`;
  const destFile = new File(audioDir, targetFileName);

  let copySucceeded = false;
  let lastError: any = null;

  // Strategy 1: Legacy FileSystem.copyAsync (Most resilient on Android for content:// & file://)
  try {
    await FileSystemLegacy.copyAsync({
      from: sourceUri,
      to: destFile.uri,
    });
    const info = await FileSystemLegacy.getInfoAsync(destFile.uri);
    if (info.exists && (info.size ?? 1) > 0) {
      copySucceeded = true;
    }
  } catch (err: any) {
    console.warn('[VN IMPORT] Strategy 1 (FileSystem.copyAsync) failed:', err?.message || err);
    lastError = err;
  }

  // Strategy 2: Modern File.copy
  if (!copySucceeded) {
    try {
      const sourceFile = new File(sourceUri);
      await sourceFile.copy(destFile, { overwrite: true });
      if (destFile.exists && (destFile.size ?? 1) > 0) {
        copySucceeded = true;
      }
    } catch (err: any) {
      console.warn('[VN IMPORT] Strategy 2 (File.copy) failed:', err?.message || err);
      lastError = err;
    }
  }

  // Strategy 3: Stream piping
  if (!copySucceeded) {
    try {
      const sourceFile = new File(sourceUri);
      if (!destFile.exists) {
        destFile.create({ overwrite: true });
      }
      await sourceFile.readableStream().pipeTo(destFile.writableStream());
      if (destFile.exists && (destFile.size ?? 1) > 0) {
        copySucceeded = true;
      }
    } catch (err: any) {
      console.warn('[VN IMPORT] Strategy 3 (Stream pipeTo) failed:', err?.message || err);
      lastError = err;
    }
  }

  // Strategy 4: Native ContentResolver / fetch stream via React Native networking
  if (!copySucceeded) {
    try {
      const res = await fetch(sourceUri);
      const arrayBuffer = await res.arrayBuffer();
      if (arrayBuffer && arrayBuffer.byteLength > 0) {
        destFile.write(new Uint8Array(arrayBuffer));
        if (destFile.exists && (destFile.size ?? 1) > 0) {
          copySucceeded = true;
        }
      }
    } catch (err: any) {
      console.warn('[VN IMPORT] Strategy 4 (fetch byte copy) failed:', err?.message || err);
      lastError = err;
    }
  }

  if (!copySucceeded) {
    // Final check with legacy getInfoAsync
    const info = await FileSystemLegacy.getInfoAsync(destFile.uri);
    if (!info.exists || (info.size !== undefined && info.size === 0)) {
      throw new Error(
        `Could not copy audio file to permanent storage (${lastError?.message || 'unknown error'})`
      );
    }
  }

  return destFile.uri;
}

/**
 * Safely deletes a local audio file if it exists.
 * @param fileUri URI of the audio file to delete
 */
export function deleteAudioFile(fileUri: string): void {
  try {
    const file = new File(fileUri);
    if (file.exists) {
      file.delete();
    }
  } catch (error) {
    try {
      FileSystemLegacy.deleteAsync(fileUri, { idempotent: true });
    } catch (legacyErr) {
      console.warn('Failed to delete audio file from disk:', legacyErr);
    }
  }
}

/**
 * Checks if a local audio file exists on the filesystem.
 * Returns true if and only if the physical file exists.
 */
export function checkAudioFileExists(fileUri: string): boolean {
  if (!fileUri || typeof fileUri !== 'string') return false;
  try {
    const file = new File(fileUri);
    if (file.exists) return true;
  } catch {}

  // Fallback check for decoded URI variation
  try {
    const decoded = decodeURI(fileUri);
    if (decoded !== fileUri) {
      const fileDecoded = new File(decoded);
      if (fileDecoded.exists) return true;
    }
  } catch {}

  return false;
}

/**
 * Permanently stores a freshly recorded audio file inside the app document audio directory.
 * Verifies existence and size, and safely removes the temporary recording file.
 *
 * @param tempUri File URI produced by the audio recorder
 * @param id Unique VN identifier
 * @returns Permanent file URI
 */
export async function saveRecordedAudioFile(tempUri: string, id: string): Promise<string> {
  const audioDir = await ensureAudioDirectory();
  const targetFileName = `${id}.m4a`;
  const destFile = new File(audioDir, targetFileName);

  let copied = false;
  let lastErr: any = null;

  try {
    await FileSystemLegacy.copyAsync({
      from: tempUri,
      to: destFile.uri,
    });
    const info = await FileSystemLegacy.getInfoAsync(destFile.uri);
    if (info.exists && (info.size ?? 1) > 0) {
      copied = true;
    }
  } catch (err: any) {
    console.warn('[RECORDING SAVE] FileSystemLegacy.copyAsync failed:', err);
    lastErr = err;
  }

  if (!copied) {
    try {
      const sourceFile = new File(tempUri);
      await sourceFile.copy(destFile, { overwrite: true });
      if (destFile.exists && (destFile.size ?? 1) > 0) {
        copied = true;
      }
    } catch (err: any) {
      console.warn('[RECORDING SAVE] File.copy failed:', err);
      lastErr = err;
    }
  }

  if (!copied) {
    const info = await FileSystemLegacy.getInfoAsync(destFile.uri);
    if (!info.exists || (info.size !== undefined && info.size === 0)) {
      throw new Error(`Failed to save recording to permanent storage (${lastErr?.message || 'unknown error'})`);
    }
  }

  // Cleanup temporary recording file
  try {
    deleteAudioFile(tempUri);
  } catch (cleanErr) {
    console.warn('[RECORDING SAVE] Could not delete temporary recording file:', cleanErr);
  }

  return destFile.uri;
}
