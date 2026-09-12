import JSZip from 'jszip';
import { File, Paths } from 'expo-file-system';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import { DeviceEventEmitter } from 'react-native';

import { getDatabase } from '@/database/database';
import { albumRepository } from '@/database/repositories/albumRepository';
import { Album } from '@/types/vn';
import { ensureAudioDirectory, getNormalizedAudioExtension } from './fileService';

export interface OvpManifestItem {
  id: string;
  title: string;
  duration: number;
  isLiked?: boolean;
  isPinned?: boolean;
  originalOrder: number;
  fileName: string;
}

export interface OvpManifest {
  formatVersion: number;
  appVersion: string;
  packageType: 'album' | 'playlist';
  playlistName: string;
  createdAt: number;
  itemCount: number;
  items: OvpManifestItem[];
}

const MAX_PACKAGE_SIZE_BYTES = 250 * 1024 * 1024; // 250 MB
const MAX_ITEM_COUNT = 200;
const MAX_SINGLE_FILE_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_MANIFEST_STRING_BYTES = 10 * 1024 * 1024; // 10 MB limit for manifest.json

/**
 * Normalizes file URIs and generates all possible candidate path representations
 * to resolve Expo Go scoping and double-encoding issues (%2540, %40, @, %252F, %2F).
 */
export function getCandidateFileUris(fileUri: string): string[] {
  const candidates: string[] = [];
  const add = (uri: string) => {
    if (uri && !candidates.includes(uri)) {
      candidates.push(uri);
    }
  };

  add(fileUri);

  // 1. Single decode: %2540 -> %40, %252F -> %2F, %25 -> %
  const singleDecoded = fileUri
    .replace(/%2540/gi, '%40')
    .replace(/%252F/gi, '%2F')
    .replace(/%25/g, '%');
  add(singleDecoded);

  // 2. Fully decoded characters: %40 / %2540 -> @ and %2F / %252F -> /
  const fullyDecoded = fileUri
    .replace(/%2540/gi, '@')
    .replace(/%40/gi, '@')
    .replace(/%252F/gi, '/')
    .replace(/%2F/gi, '/');
  add(fullyDecoded);

  // 3. Keep %40 but slashify %2F
  const mixedDecoded = fileUri
    .replace(/%2540/gi, '%40')
    .replace(/%252F/gi, '/')
    .replace(/%2F/gi, '/');
  add(mixedDecoded);

  // 4. Standard decodeURI / decodeURI twice
  try {
    const d1 = decodeURI(fileUri);
    add(d1);
    const d2 = decodeURI(d1);
    add(d2);
  } catch {}

  return candidates;
}

/**
 * Checks file existence across all candidate URIs and legacy path variations.
 */
export async function checkAudioFileExistsResilient(fileUri: string): Promise<boolean> {
  const candidates = getCandidateFileUris(fileUri);
  for (const uri of candidates) {
    try {
      const file = new File(uri);
      if (file.exists) return true;
    } catch {}
    try {
      const info = await FileSystemLegacy.getInfoAsync(uri);
      if (info.exists) return true;
    } catch {}
    if (uri.startsWith('file://')) {
      try {
        const info = await FileSystemLegacy.getInfoAsync(uri.slice(7));
        if (info.exists) return true;
      } catch {}
    }
  }
  return false;
}

/**
 * Reads binary audio/package content with an infallible multi-tier reader:
 * 1. Modern File.bytes() with candidate URIs
 * 2. Native React Native fetch().arrayBuffer() (bypasses ExponentFileSystem permission checks)
 * 3. Modern File.base64() with candidate URIs
 * 4. FileSystemLegacy.readAsStringAsync with candidate URIs
 * 5. FileSystemLegacy.readAsStringAsync with path-only (null scheme bypasses ExponentFileSystem permission checks)
 */
export async function readAudioFileBinary(fileUri: string): Promise<Uint8Array | ArrayBuffer | string> {
  const candidates = getCandidateFileUris(fileUri);
  let lastError: any = null;

  // Tier 1: Modern File.bytes()
  for (const uri of candidates) {
    try {
      const file = new File(uri);
      if (file.exists) {
        const bytes = await file.bytes();
        if (bytes && bytes.byteLength > 0) {
          return bytes;
        }
      }
    } catch (err) {
      lastError = err;
    }
  }

  // Tier 2: React Native networking fetch().arrayBuffer()
  // React Native's OkHttpClient handles local file:// streams directly without ExponentFileSystem scoping errors.
  for (const uri of candidates) {
    try {
      const res = await fetch(uri);
      if (res.ok || res.status === 200 || res.status === 0) {
        const ab = await res.arrayBuffer();
        if (ab && ab.byteLength > 0) {
          return new Uint8Array(ab);
        }
      }
    } catch (err) {
      lastError = err;
    }
  }

  // Tier 3: Modern File.base64()
  for (const uri of candidates) {
    try {
      const file = new File(uri);
      if (file.exists) {
        const b64 = await file.base64();
        if (b64 && b64.length > 0) {
          return b64;
        }
      }
    } catch (err) {
      lastError = err;
    }
  }

  // Tier 4: FileSystemLegacy.readAsStringAsync with candidate URIs
  for (const uri of candidates) {
    try {
      const b64 = await FileSystemLegacy.readAsStringAsync(uri, {
        encoding: FileSystemLegacy.EncodingType.Base64,
      });
      if (b64 && b64.length > 0) {
        return b64;
      }
    } catch (err) {
      lastError = err;
    }
  }

  // Tier 5: FileSystemLegacy.readAsStringAsync with raw path (stripping file://)
  // When scheme is null, ExponentFileSystem grants READ permission unconditionally
  for (const uri of candidates) {
    if (uri.startsWith('file://')) {
      const rawPath = uri.slice(7);
      try {
        const b64 = await FileSystemLegacy.readAsStringAsync(rawPath, {
          encoding: FileSystemLegacy.EncodingType.Base64,
        });
        if (b64 && b64.length > 0) {
          return b64;
        }
      } catch (err) {
        lastError = err;
      }
    }
  }

  throw new Error(
    `Failed to read audio file: ${lastError?.message || 'File is not readable or missing.'}`
  );
}

/**
 * Normalizes output URI for Android sharing so that FileProvider and SharingModule
 * can read the file without permission rejections.
 */
function normalizeForSharing(uri: string): string {
  const decoded = uri.replace(/%2540/gi, '@').replace(/%252F/gi, '/');
  try {
    const fDecoded = new File(decoded);
    if (fDecoded.exists) {
      return decoded;
    }
  } catch {}
  return uri;
}

/**
 * Validates whether an archive relative path is safe against path traversal attacks.
 */
function isSafeArchivePath(path: string): boolean {
  if (!path || typeof path !== 'string') return false;
  // Disallow parent directory navigation
  if (path.includes('..')) return false;
  // Disallow absolute unix and windows paths
  if (path.startsWith('/') || path.startsWith('\\')) return false;
  // Disallow windows drive letters
  if (/^[a-zA-Z]:/.test(path)) return false;
  // Disallow null bytes
  if (path.includes('\0')) return false;
  return true;
}

function sanitizeBaseName(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9_\-]/g, '_').replace(/_+/g, '_');
  return clean.slice(0, 40) || 'track';
}

export interface OvpPackagePreview {
  albumName: string;
  itemCount: number;
  sizeBytes: number;
  createdAt?: number;
}

export const packageService = {
  /**
   * Safely inspects an Our Voice package (.ovp) without extracting audio files or modifying the database.
   * Performs full manifest, size, archive integrity, and security checks.
   */
  async inspectPackage(fileUri: string): Promise<OvpPackagePreview> {
    // 1. Basic file size verification
    let fileSizeBytes = 0;
    const candidates = getCandidateFileUris(fileUri);
    for (const u of candidates) {
      try {
        const f = new File(u);
        if (f.exists && f.size) {
          fileSizeBytes = f.size;
          break;
        }
      } catch {}
      try {
        const info = await FileSystemLegacy.getInfoAsync(u);
        if (info.exists && info.size) {
          fileSizeBytes = info.size;
          break;
        }
      } catch {}
    }

    if (fileSizeBytes > MAX_PACKAGE_SIZE_BYTES) {
      throw new Error('This package exceeds the maximum supported size limit (250 MB).');
    }

    // 2. Read archive via multi-strategy reader
    let archiveData: Uint8Array | ArrayBuffer | string;
    try {
      archiveData = await readAudioFileBinary(fileUri);
    } catch {
      throw new Error('Unable to read the selected package file.');
    }

    let zip: JSZip;
    try {
      if (typeof archiveData === 'string') {
        zip = await JSZip.loadAsync(archiveData, { base64: true });
      } else {
        zip = await JSZip.loadAsync(archiveData);
      }
    } catch {
      throw new Error('The package file is corrupted or not a valid Our Voice Package (.ovp).');
    }

    // 3. Security check on archive entries (Path traversal prevention)
    const entryNames = Object.keys(zip.files);
    for (const entry of entryNames) {
      if (!isSafeArchivePath(entry)) {
        throw new Error('Security check failed: Package contains unsafe file paths.');
      }
    }

    // 4. Validate manifest.json
    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) {
      throw new Error('Package is missing the required manifest.json file.');
    }

    let manifest: OvpManifest;
    try {
      const manifestStr = await manifestFile.async('string');
      if (manifestStr.length > MAX_MANIFEST_STRING_BYTES) {
        throw new Error('Manifest size exceeds maximum safe limit.');
      }
      manifest = JSON.parse(manifestStr);
    } catch (err: any) {
      if (err?.message?.includes('Manifest size')) throw err;
      throw new Error('The package manifest is corrupted or contains invalid JSON.');
    }

    if (!manifest.formatVersion || manifest.formatVersion > 1) {
      throw new Error('This package was created with an unsupported or newer format version.');
    }

    if (!manifest.items || !Array.isArray(manifest.items) || manifest.items.length === 0) {
      throw new Error('The package does not contain any voice note recordings.');
    }

    if (manifest.items.length > MAX_ITEM_COUNT) {
      throw new Error(`Package exceeds maximum track limit (${MAX_ITEM_COUNT} items).`);
    }

    // 5. Verify all declared audio files exist inside the zip archive
    for (const item of manifest.items) {
      if (!item.fileName || !isSafeArchivePath(item.fileName)) {
        throw new Error(`Invalid audio file path declared for "${item.title || 'recording'}".`);
      }
      const zipEntry = zip.file(item.fileName);
      if (!zipEntry) {
        throw new Error(`Package is missing declared audio file: ${item.fileName}`);
      }
    }

    const calculatedSize =
      fileSizeBytes > 0
        ? fileSizeBytes
        : typeof archiveData === 'string'
        ? archiveData.length
        : archiveData.byteLength;

    return {
      albumName: (manifest.playlistName || 'Imported Album').trim(),
      itemCount: manifest.items.length,
      sizeBytes: calculatedSize,
      createdAt: manifest.createdAt,
    };
  },

  /**
   * Validates and atomically imports an Our Voice package (.ovp).
   * Atomic from the user perspective: verifies all audio files exist before packaging.
   */
  async exportAlbumPackage(albumId: string): Promise<string> {
    const album = await albumRepository.getAlbumById(albumId);
    if (!album) {
      throw new Error("Couldn't find the requested album to export.");
    }

    const vns = await albumRepository.getVnsInAlbum(albumId);
    if (!vns || vns.length === 0) {
      throw new Error('This album is empty. Add recordings to it before exporting.');
    }

    // 1. Verify all audio files exist before starting archive creation
    for (const vn of vns) {
      const exists = await checkAudioFileExistsResilient(vn.fileUri);
      if (!exists) {
        throw new Error(
          `Unable to export album because audio file for "${vn.title}" is missing from local storage.`
        );
      }
    }

    const zip = new JSZip();
    const manifestItems: OvpManifestItem[] = [];

    // 2. Package each voice note into the audio/ directory
    for (let i = 0; i < vns.length; i++) {
      const vn = vns[i];
      const ext = getNormalizedAudioExtension(vn.fileUri);
      const safeTitle = sanitizeBaseName(vn.title);
      const archiveFileName = `audio/track_${i + 1}_${safeTitle}.${ext}`;

      // Read audio data binary via resilient multi-strategy pipeline
      const audioData = await readAudioFileBinary(vn.fileUri);
      if (typeof audioData === 'string') {
        zip.file(archiveFileName, audioData, { base64: true });
      } else {
        zip.file(archiveFileName, audioData, { binary: true });
      }

      manifestItems.push({
        id: vn.id,
        title: vn.title,
        duration: vn.duration,
        isLiked: vn.isLiked,
        isPinned: vn.isPinned,
        originalOrder: i,
        fileName: archiveFileName,
      });
    }

    // 3. Generate and include manifest.json
    const manifest: OvpManifest = {
      formatVersion: 1,
      appVersion: '1.0.0',
      packageType: 'album',
      playlistName: album.name,
      createdAt: Date.now(),
      itemCount: manifestItems.length,
      items: manifestItems,
    };

    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    // 4. Generate the .ovp archive as Uint8Array
    const zipUint8 = await zip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    // 5. Write to temporary cache directory for sharing
    const safeAlbumName = sanitizeBaseName(album.name);
    const fileName = `${safeAlbumName}_${Date.now()}.ovp`;
    const destFile = new File(Paths.cache, fileName);
    let destinationUri = destFile.uri;
    let writeSuccess = false;

    try {
      destFile.write(zipUint8);
      if (destFile.exists) {
        writeSuccess = true;
        destinationUri = destFile.uri;
      }
    } catch (writeErr) {
      console.warn('[PACKAGE EXPORT] Modern File.write failed, falling back to legacy:', writeErr);
    }

    if (!writeSuccess) {
      // Fallback: write via legacy FileSystem with base64
      const zipBase64 = await zip.generateAsync({
        type: 'base64',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });
      const legacyTarget = `${FileSystemLegacy.cacheDirectory}${fileName}`;
      const targets = getCandidateFileUris(legacyTarget);
      for (const target of targets) {
        try {
          await FileSystemLegacy.writeAsStringAsync(target, zipBase64, {
            encoding: FileSystemLegacy.EncodingType.Base64,
          });
          const check = await FileSystemLegacy.getInfoAsync(target);
          if (check.exists && (check.size ?? 0) > 0) {
            writeSuccess = true;
            destinationUri = target;
            break;
          }
        } catch {}
      }
    }

    if (!writeSuccess) {
      throw new Error("Couldn't write the Our Voice package archive.");
    }

    return normalizeForSharing(destinationUri);
  },

  /**
   * Validates and atomically imports an Our Voice package (.ovp).
   * Extracts audio files into permanent storage and creates the album & VNs in SQLite.
   * If any step fails, performs a full rollback.
   */
  async importPackage(fileUri: string): Promise<{ album: Album; importedCount: number }> {
    // 1. Basic file size verification
    let fileSizeBytes = 0;
    const candidates = getCandidateFileUris(fileUri);
    for (const u of candidates) {
      try {
        const f = new File(u);
        if (f.exists && f.size) {
          fileSizeBytes = f.size;
          break;
        }
      } catch {}
      try {
        const info = await FileSystemLegacy.getInfoAsync(u);
        if (info.exists && info.size) {
          fileSizeBytes = info.size;
          break;
        }
      } catch {}
    }

    if (fileSizeBytes > MAX_PACKAGE_SIZE_BYTES) {
      throw new Error('This package exceeds the maximum supported size limit (250 MB).');
    }

    // 2. Read archive via multi-strategy reader
    let archiveData: Uint8Array | ArrayBuffer | string;
    try {
      archiveData = await readAudioFileBinary(fileUri);
    } catch {
      throw new Error('Unable to read the selected package file.');
    }

    let zip: JSZip;
    try {
      if (typeof archiveData === 'string') {
        zip = await JSZip.loadAsync(archiveData, { base64: true });
      } else {
        zip = await JSZip.loadAsync(archiveData);
      }
    } catch {
      throw new Error('The package file is corrupted or not a valid Our Voice Package (.ovp).');
    }

    // 3. Security check on archive entries (Path traversal prevention)
    const entryNames = Object.keys(zip.files);
    for (const entry of entryNames) {
      if (!isSafeArchivePath(entry)) {
        throw new Error('Security check failed: Package contains unsafe file paths.');
      }
    }

    // 4. Validate manifest.json
    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) {
      throw new Error('Package is missing the required manifest.json file.');
    }

    let manifest: OvpManifest;
    try {
      const manifestStr = await manifestFile.async('string');
      if (manifestStr.length > MAX_MANIFEST_STRING_BYTES) {
        throw new Error('Manifest size exceeds maximum safe limit.');
      }
      manifest = JSON.parse(manifestStr);
    } catch (err: any) {
      if (err?.message?.includes('Manifest size')) throw err;
      throw new Error('The package manifest is corrupted or contains invalid JSON.');
    }

    if (!manifest.formatVersion || manifest.formatVersion > 1) {
      throw new Error('This package was created with an unsupported or newer format version.');
    }

    if (!manifest.items || !Array.isArray(manifest.items) || manifest.items.length === 0) {
      throw new Error('The package does not contain any voice note recordings.');
    }

    if (manifest.items.length > MAX_ITEM_COUNT) {
      throw new Error(`Package exceeds maximum track limit (${MAX_ITEM_COUNT} items).`);
    }

    // 5. Verify all declared audio files exist inside the zip archive
    for (const item of manifest.items) {
      if (!item.fileName || !isSafeArchivePath(item.fileName)) {
        throw new Error(`Invalid audio file path declared for "${item.title || 'recording'}".`);
      }
      const zipEntry = zip.file(item.fileName);
      if (!zipEntry) {
        throw new Error(`Package is missing declared audio file: ${item.fileName}`);
      }
    }

    // 6. Extraction into permanent local storage with rollback safety
    const audioDir = await ensureAudioDirectory();
    const createdFileUris: string[] = [];
    const extractedItems: {
      vnId: string;
      title: string;
      fileUri: string;
      duration: number;
      createdAt: number;
      isLiked: boolean;
      isPinned: boolean;
    }[] = [];

    try {
      for (const item of manifest.items) {
        const zipEntry = zip.file(item.fileName);
        if (!zipEntry) continue;

        const audioBytes = await zipEntry.async('uint8array');
        const ext = getNormalizedAudioExtension(item.fileName);
        const uniqueFileName = `vn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}.${ext}`;
        const destFile = new File(audioDir, uniqueFileName);

        let writeOk = false;
        try {
          destFile.write(audioBytes);
          if (destFile.exists && (destFile.size ?? 0) > 0 && (destFile.size ?? 0) <= MAX_SINGLE_FILE_BYTES) {
            writeOk = true;
          }
        } catch {}

        if (!writeOk) {
          // Fallback legacy write
          const audioBase64 = await zipEntry.async('base64');
          const destUri = `${audioDir.uri}/${uniqueFileName}`;
          await FileSystemLegacy.writeAsStringAsync(destUri, audioBase64, {
            encoding: FileSystemLegacy.EncodingType.Base64,
          });
          const checkExtracted = await FileSystemLegacy.getInfoAsync(destUri);
          if (checkExtracted.exists && (checkExtracted.size ?? 0) > 0 && (checkExtracted.size ?? 0) <= MAX_SINGLE_FILE_BYTES) {
            writeOk = true;
          }
        }

        if (!writeOk) {
          throw new Error(`Failed to extract audio for "${item.title}".`);
        }

        createdFileUris.push(destFile.uri);

        extractedItems.push({
          vnId: `vn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          title: item.title || 'Voice Note',
          fileUri: destFile.uri,
          duration: Number(item.duration) || 0,
          createdAt: Date.now(),
          isLiked: Boolean(item.isLiked),
          isPinned: Boolean(item.isPinned),
        });
      }

      // 7. Atomic SQLite Transaction
      const db = getDatabase();
      const newAlbumId = `album_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const albumTitle = (manifest.playlistName || 'Imported Album').trim();

      db.execSync('BEGIN TRANSACTION;');
      try {
        // Insert Album
        db.runSync(
          'INSERT INTO albums (id, name, createdAt) VALUES (?, ?, ?);',
          [newAlbumId, albumTitle, Date.now()]
        );

        // Insert VNs and Album/VN relations
        for (const item of extractedItems) {
          db.runSync(
            `INSERT INTO vns (id, title, fileUri, duration, createdAt, isLiked, source, isPinned, lastPosition)
             VALUES (?, ?, ?, ?, ?, ?, 'imported', ?, 0);`,
            [
              item.vnId,
              item.title,
              item.fileUri,
              item.duration,
              item.createdAt,
              item.isLiked ? 1 : 0,
              item.isPinned ? 1 : 0,
            ]
          );

          db.runSync(
            'INSERT OR IGNORE INTO album_vns (albumId, vnId) VALUES (?, ?);',
            [newAlbumId, item.vnId]
          );
        }

        db.execSync('COMMIT;');
      } catch (dbErr) {
        try {
          db.execSync('ROLLBACK;');
        } catch {}
        throw dbErr;
      }

      // 8. Notify app listeners
      DeviceEventEmitter.emit('library_updated');

      const createdAlbum: Album = {
        id: newAlbumId,
        name: albumTitle,
        createdAt: Date.now(),
      };

      return {
        album: createdAlbum,
        importedCount: extractedItems.length,
      };
    } catch (err: any) {
      // Rollback: Clean up newly created audio files
      for (const uri of createdFileUris) {
        try {
          const f = new File(uri);
          if (f.exists) f.delete();
        } catch {}
        try {
          await FileSystemLegacy.deleteAsync(uri, { idempotent: true });
        } catch {}
      }

      console.warn('[PACKAGE IMPORT] Import failed, rolled back:', err);
      throw new Error(err?.message || 'Import failed. Your existing library was not changed.');
    }
  },

  /**
   * Prompts the user to pick an .ovp package and imports it.
   */
  async pickAndImportPackage(): Promise<{ album: Album; importedCount: number } | null> {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['*/*'],
      copyToCacheDirectory: true,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return null;
    }

    const asset = result.assets[0];
    const fileName = asset.name.toLowerCase();

    // Verify extension
    if (!fileName.endsWith('.ovp') && !fileName.endsWith('.zip')) {
      throw new Error(
        'Selected file is not an Our Voice Package (.ovp). Please choose a valid .ovp file.'
      );
    }

    return await this.importPackage(asset.uri);
  },
};

