import JSZip from 'jszip';
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

export const packageService = {
  /**
   * Exports an entire album and all its voice notes into a portable .ovp archive.
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
      const info = await FileSystemLegacy.getInfoAsync(vn.fileUri);
      if (!info.exists) {
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

      // Read audio data as base64
      const base64Content = await FileSystemLegacy.readAsStringAsync(vn.fileUri, {
        encoding: FileSystemLegacy.EncodingType.Base64,
      });

      zip.file(archiveFileName, base64Content, { base64: true });

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

    // 4. Generate the .ovp archive
    const zipBase64 = await zip.generateAsync({
      type: 'base64',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    // 5. Write to temporary cache directory for sharing
    const safeAlbumName = sanitizeBaseName(album.name);
    const destinationUri = `${FileSystemLegacy.cacheDirectory}${safeAlbumName}_${Date.now()}.ovp`;

    await FileSystemLegacy.writeAsStringAsync(destinationUri, zipBase64, {
      encoding: FileSystemLegacy.EncodingType.Base64,
    });

    // Verify written archive exists and is non-empty
    const checkInfo = await FileSystemLegacy.getInfoAsync(destinationUri);
    if (!checkInfo.exists || !checkInfo.size) {
      throw new Error("Couldn't write the Our Voice package archive.");
    }

    return destinationUri;
  },

  /**
   * Validates and atomically imports an Our Voice package (.ovp).
   * Extracts audio files into permanent storage and creates the album & VNs in SQLite.
   * If any step fails, performs a full rollback.
   */
  async importPackage(fileUri: string): Promise<{ album: Album; importedCount: number }> {
    // 1. Basic file size verification
    const fileInfo = await FileSystemLegacy.getInfoAsync(fileUri);
    if (!fileInfo.exists) {
      throw new Error('Selected package file could not be found.');
    }
    if (fileInfo.size && fileInfo.size > MAX_PACKAGE_SIZE_BYTES) {
      throw new Error('This package exceeds the maximum supported size limit (250 MB).');
    }

    // 2. Read archive
    let base64Data: string;
    try {
      base64Data = await FileSystemLegacy.readAsStringAsync(fileUri, {
        encoding: FileSystemLegacy.EncodingType.Base64,
      });
    } catch {
      throw new Error('Unable to read the selected package file.');
    }

    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(base64Data, { base64: true });
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
      manifest = JSON.parse(manifestStr);
    } catch {
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

        const audioBase64 = await zipEntry.async('base64');
        const ext = getNormalizedAudioExtension(item.fileName);
        const uniqueFileName = `vn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}.${ext}`;
        const destUri = `${audioDir.uri}/${uniqueFileName}`;

        await FileSystemLegacy.writeAsStringAsync(destUri, audioBase64, {
          encoding: FileSystemLegacy.EncodingType.Base64,
        });
        createdFileUris.push(destUri);

        // Verify extracted file
        const checkExtracted = await FileSystemLegacy.getInfoAsync(destUri);
        if (!checkExtracted.exists || (checkExtracted.size && checkExtracted.size > MAX_SINGLE_FILE_BYTES)) {
          throw new Error(`Failed to extract audio for "${item.title}".`);
        }

        extractedItems.push({
          vnId: `vn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          title: item.title || 'Voice Note',
          fileUri: destUri,
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
