import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import * as Linking from 'expo-linking';
import { File } from 'expo-file-system';
import * as FileSystemLegacy from 'expo-file-system/legacy';

const { OurVoiceIncomingPackage } = NativeModules;

export interface IncomingPackagePayload {
  uri: string;
  mimeType?: string;
  action?: string;
}

const PROCESSED_CACHE_TTL_MS = 5000;
const processedUris = new Map<string, number>();

/**
 * Diagnostic logger that logs operational metadata without exposing private contents.
 */
function logIncomingDiag(step: string, details: Record<string, any>) {
  console.log(`[INCOMING DIAGNOSTIC] ${step}:`, JSON.stringify(details));
}

/**
 * Checks whether an incoming URI is a candidate for an Our Voice package (.ovp).
 * Filters out internal app schemes (ourvoice://), web links (http/https), etc.
 */
export function isOvpUriCandidate(rawUri: string | null | undefined): boolean {
  if (!rawUri || typeof rawUri !== 'string') return false;

  const trimmed = rawUri.trim();
  if (trimmed.length === 0) return false;

  // Ignore custom app navigation scheme and web URLs
  if (
    trimmed.startsWith('ourvoice://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://')
  ) {
    return false;
  }

  // Must be a content:// or file:// URI
  if (!trimmed.startsWith('content://') && !trimmed.startsWith('file://')) {
    return false;
  }

  // Check if URI or decoded path contains .ovp
  const lower = trimmed.toLowerCase();
  if (lower.includes('.ovp')) {
    return true;
  }

  try {
    const decoded = decodeURIComponent(trimmed).toLowerCase();
    if (decoded.includes('.ovp')) {
      return true;
    }
  } catch {}

  // For Android content URIs from external apps matching our intent filter, allow processing
  // (structure will be strictly validated against manifest.json before any permanent changes)
  if (trimmed.startsWith('content://')) {
    return true;
  }

  return false;
}

/**
 * Prevents handling the exact same URI multiple times within a short cooldown window.
 */
export function shouldProcessIncomingUri(rawUri: string): boolean {
  const now = Date.now();

  // Clean up expired entries
  for (const [key, timestamp] of processedUris.entries()) {
    if (now - timestamp > PROCESSED_CACHE_TTL_MS) {
      processedUris.delete(key);
    }
  }

  const lastProcessed = processedUris.get(rawUri);
  if (lastProcessed && now - lastProcessed < PROCESSED_CACHE_TTL_MS) {
    return false;
  }

  processedUris.set(rawUri, now);
  return true;
}

/**
 * Resets the cooldown tracking for a URI, allowing it to be immediately reopened
 * if the user explicitly triggers it again after dismissing.
 */
export function resetProcessedUri(rawUri: string | null | undefined): void {
  if (rawUri) {
    processedUris.delete(rawUri);
  }
}

/**
 * Subscribes to incoming packages from both:
 * 1. Native bridge (OurVoiceIncomingPackage) for ACTION_SEND / ACTION_VIEW (Cold Start & Warm Start)
 * 2. React Native / Expo Linking for deep links (Fallback)
 */
export function subscribeToIncomingPackages(
  onPackageReceived: (payload: IncomingPackagePayload) => void
): () => void {
  let isSubscribed = true;

  const handlePayload = (payload: IncomingPackagePayload | null | undefined, source: string) => {
    if (!payload || !payload.uri) return;

    const uri = payload.uri;
    const uriScheme = uri.split(':')[0] || 'unknown';

    logIncomingDiag('incoming intent received', {
      source,
      action: payload.action || 'unknown',
      mimeType: payload.mimeType || 'unknown',
      uriScheme,
      isCandidate: isOvpUriCandidate(uri),
    });

    if (!isOvpUriCandidate(uri)) {
      logIncomingDiag('candidate check rejected', { uriScheme });
      return;
    }

    if (!shouldProcessIncomingUri(uri)) {
      logIncomingDiag('deduplication suppressed duplicate intent', { uriScheme });
      return;
    }

    logIncomingDiag('package processing started', {
      source,
      action: payload.action,
      mimeType: payload.mimeType,
      uriScheme,
    });

    if (isSubscribed) {
      onPackageReceived(payload);
    }
  };

  // 1. Native Bridge: Warm start / background resume event listener
  const nativeSub = DeviceEventEmitter.addListener(
    'ourvoiceIncomingPackage',
    (event: IncomingPackagePayload) => {
      handlePayload(event, 'native_event');
    }
  );

  // 2. Native Bridge: Cold start check (getPendingPackage)
  if (Platform.OS === 'android' && OurVoiceIncomingPackage?.getPendingPackage) {
    OurVoiceIncomingPackage.getPendingPackage()
      .then((pending: IncomingPackagePayload | null) => {
        if (pending && pending.uri) {
          logIncomingDiag('found pending package in native memory', {
            action: pending.action,
            mimeType: pending.mimeType,
          });
          OurVoiceIncomingPackage.clearPendingPackage?.();
          handlePayload(pending, 'native_pending');
        }
      })
      .catch((err: any) => {
        console.warn('[INCOMING PACKAGE] Error checking pending package:', err);
      });
  }

  // 3. Fallback: Core Linking module for deep links
  Linking.getInitialURL()
    .then((initialUrl) => {
      if (initialUrl) {
        Linking.clearInitialURL?.();
        handlePayload(
          { uri: initialUrl, action: 'android.intent.action.VIEW' },
          'linking_initial'
        );
      }
    })
    .catch((err) => {
      console.warn('[INCOMING PACKAGE] Error getting initial linking URL:', err);
    });

  const linkingSub = Linking.addEventListener('url', ({ url }) => {
    handlePayload({ uri: url, action: 'android.intent.action.VIEW' }, 'linking_event');
  });

  return () => {
    isSubscribed = false;
    nativeSub.remove();
    linkingSub.remove();
  };
}

/**
 * Safely copies an external content:// or file:// URI into the app's private cache directory.
 * Never modifies or deletes the original file.
 * Uses a resilient multi-tier reader for Android Content Providers.
 */
export async function copyIncomingUriToCache(sourceUri: string): Promise<string> {
  const uriScheme = sourceUri.split(':')[0] || 'unknown';
  logIncomingDiag('cache copy started', { uriScheme });

  const tempDir = `${FileSystemLegacy.cacheDirectory}incoming_ovp/`;
  try {
    await FileSystemLegacy.makeDirectoryAsync(tempDir, { intermediates: true });
  } catch {}

  const tempFileName = `incoming_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.ovp`;
  const destUri = `${tempDir}${tempFileName}`;

  let copySuccess = false;
  let lastError: any = null;

  // Strategy 1: FileSystemLegacy.copyAsync (Native Android ContentResolver stream)
  try {
    await FileSystemLegacy.copyAsync({
      from: sourceUri,
      to: destUri,
    });
    const info = await FileSystemLegacy.getInfoAsync(destUri);
    if (info.exists && (info.size ?? 0) > 0) {
      copySuccess = true;
    }
  } catch (err) {
    lastError = err;
    console.warn('[INCOMING PACKAGE] Strategy 1 (copyAsync) failed:', err);
  }

  // Strategy 2: React Native networking fetch().arrayBuffer() (Bypasses scoped storage restrictions)
  if (!copySuccess) {
    try {
      const res = await fetch(sourceUri);
      if (res.ok || res.status === 200 || res.status === 0) {
        const ab = await res.arrayBuffer();
        if (ab && ab.byteLength > 0) {
          const destFile = new File(destUri);
          destFile.write(new Uint8Array(ab));
          if (destFile.exists && (destFile.size ?? 0) > 0) {
            copySuccess = true;
          }
        }
      }
    } catch (err) {
      lastError = err;
      console.warn('[INCOMING PACKAGE] Strategy 2 (fetch buffer) failed:', err);
    }
  }

  // Strategy 3: FileSystemLegacy.readAsStringAsync with Base64 encoding
  if (!copySuccess) {
    try {
      const b64 = await FileSystemLegacy.readAsStringAsync(sourceUri, {
        encoding: FileSystemLegacy.EncodingType.Base64,
      });
      if (b64 && b64.length > 0) {
        await FileSystemLegacy.writeAsStringAsync(destUri, b64, {
          encoding: FileSystemLegacy.EncodingType.Base64,
        });
        const info = await FileSystemLegacy.getInfoAsync(destUri);
        if (info.exists && (info.size ?? 0) > 0) {
          copySuccess = true;
        }
      }
    } catch (err) {
      lastError = err;
      console.warn('[INCOMING PACKAGE] Strategy 3 (base64 read/write) failed:', err);
    }
  }

  if (!copySuccess) {
    await cleanupTempPackageFile(destUri);
    logIncomingDiag('cache copy failed', { error: lastError?.message || 'Unknown copy failure' });
    throw new Error(
      `Could not access the package file: ${lastError?.message || 'Unable to read content URI.'}`
    );
  }

  logIncomingDiag('cache copy succeeded', { destUri });
  return destUri;
}

/**
 * Safely removes a temporary package file from the cache directory.
 */
export async function cleanupTempPackageFile(fileUri: string | null | undefined): Promise<void> {
  if (!fileUri) return;
  try {
    const f = new File(fileUri);
    if (f.exists) {
      f.delete();
      return;
    }
  } catch {}

  try {
    await FileSystemLegacy.deleteAsync(fileUri, { idempotent: true });
  } catch {}
}
