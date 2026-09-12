import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useTheme } from '@/hooks/use-theme';
import { packageService, OvpPackagePreview } from '@/services/packageService';
import {
  cleanupTempPackageFile,
  copyIncomingUriToCache,
  resetProcessedUri,
} from '@/services/incomingPackageService';
import { teddyReactionService } from '@/services/teddyReactionService';

interface IncomingPackageModalProps {
  incomingUri: string | null;
  onDismiss: () => void;
}

export function IncomingPackageModal({ incomingUri, onDismiss }: IncomingPackageModalProps) {
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [preview, setPreview] = useState<OvpPackagePreview | null>(null);
  const [tempFileUri, setTempFileUri] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const theme = useTheme();
  const router = useRouter();

  useEffect(() => {
    if (!incomingUri) {
      return;
    }

    let isCancelled = false;
    let localTempUri: string | null = null;

    async function loadPackagePreview(uri: string) {
      setLoadingPreview(true);
      setPreview(null);

      try {
        // 1. Safely copy to private temporary cache
        localTempUri = await copyIncomingUriToCache(uri);
        if (isCancelled) {
          await cleanupTempPackageFile(localTempUri);
          return;
        }
        setTempFileUri(localTempUri);

        // 2. Validate package structure, manifest, and audio files
        const packagePreview = await packageService.inspectPackage(localTempUri);
        if (isCancelled) {
          await cleanupTempPackageFile(localTempUri);
          return;
        }

        setPreview(packagePreview);
      } catch (err: any) {
        if (!isCancelled) {
          if (localTempUri) {
            await cleanupTempPackageFile(localTempUri);
          }
          setTempFileUri(null);
          setPreview(null);
          resetProcessedUri(uri);

          const errorDetail =
            err?.message ||
            'The package file is corrupted or not a valid Our Voice Package (.ovp).';
          Alert.alert(
            "This Our Voice package couldn't be imported.",
            errorDetail,
            [{ text: 'OK', onPress: onDismiss }]
          );
        }
      } finally {
        if (!isCancelled) {
          setLoadingPreview(false);
        }
      }
    }

    loadPackagePreview(incomingUri);

    return () => {
      isCancelled = true;
    };
  }, [incomingUri, onDismiss]);

  const handleCancel = async () => {
    if (tempFileUri) {
      await cleanupTempPackageFile(tempFileUri);
    }
    resetProcessedUri(incomingUri);
    setTempFileUri(null);
    setPreview(null);
    onDismiss();
  };

  const handleImport = async () => {
    if (!tempFileUri || isImporting) return;
    setIsImporting(true);

    try {
      const result = await packageService.importPackage(tempFileUri);

      // Clean up temporary cache file
      await cleanupTempPackageFile(tempFileUri);
      setTempFileUri(null);
      setPreview(null);
      onDismiss();

      // Teddy celebration reaction
      teddyReactionService.trigger('CUSTOM', `Imported "${result.album.name}" package! 📦✨`);
      DeviceEventEmitter.emit('library_updated');

      Alert.alert(
        'Package Imported! 📦🎉',
        `Album "${result.album.name}" with ${result.importedCount} track(s) has been imported to your library.`,
        [
          {
            text: 'View Album',
            onPress: () => router.push(`/album/${result.album.id}` as any),
          },
          { text: 'OK', style: 'default' },
        ]
      );
    } catch (err: any) {
      await cleanupTempPackageFile(tempFileUri);
      setTempFileUri(null);
      setPreview(null);
      onDismiss();

      Alert.alert(
        "This Our Voice package couldn't be imported.",
        err?.message || 'An unexpected error occurred during import. Your library was not changed.'
      );
    } finally {
      setIsImporting(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (!bytes || bytes <= 0) return 'Unknown size';
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (!incomingUri) return null;

  return (
    <Modal
      visible={Boolean(incomingUri)}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
      statusBarTranslucent>
      <View style={styles.overlay}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.card,
              borderColor: theme.border,
            },
          ]}>
          {/* Header Icon */}
          <View style={[styles.iconContainer, { backgroundColor: theme.accentSoft }]}>
            <Ionicons name="cube-outline" size={40} color={theme.tint} />
          </View>

          {/* Title */}
          <Text style={[styles.title, { color: theme.text }]}>
            Import Our Voice Package?
          </Text>

          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            An Our Voice package (.ovp) was opened from an external app.
          </Text>

          {loadingPreview ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={theme.tint} />
              <Text style={[styles.loadingText, { color: theme.textSecondary }]}>
                Reading package contents...
              </Text>
            </View>
          ) : preview ? (
            <View style={[styles.packageDetails, { backgroundColor: theme.groupedBackground }]}>
              {/* Album Title */}
              <View style={styles.detailRow}>
                <Ionicons name="musical-notes" size={20} color={theme.tint} />
                <View style={styles.detailTextContainer}>
                  <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>
                    Album Name
                  </Text>
                  <Text style={[styles.detailValue, { color: theme.text }]} numberOfLines={1}>
                    {preview.albumName}
                  </Text>
                </View>
              </View>

              {/* VN Track Count */}
              <View style={styles.detailRow}>
                <Ionicons name="mic-outline" size={20} color={theme.tint} />
                <View style={styles.detailTextContainer}>
                  <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>
                    Voice Notes
                  </Text>
                  <Text style={[styles.detailValue, { color: theme.text }]}>
                    {preview.itemCount} {preview.itemCount === 1 ? 'recording' : 'recordings'}
                  </Text>
                </View>
              </View>

              {/* Package Size */}
              <View style={styles.detailRow}>
                <Ionicons name="hardware-chip-outline" size={20} color={theme.tint} />
                <View style={styles.detailTextContainer}>
                  <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>
                    Package Size
                  </Text>
                  <Text style={[styles.detailValue, { color: theme.text }]}>
                    {formatFileSize(preview.sizeBytes)}
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          {/* Action Buttons */}
          <View style={styles.buttonContainer}>
            <Pressable
              style={[styles.button, styles.cancelButton, { borderColor: theme.border }]}
              onPress={handleCancel}
              disabled={isImporting}>
              <Text style={[styles.cancelButtonText, { color: theme.text }]}>Cancel</Text>
            </Pressable>

            <Pressable
              style={[
                styles.button,
                styles.importButton,
                { backgroundColor: theme.tint },
                (isImporting || loadingPreview || !preview) && styles.buttonDisabled,
              ]}
              onPress={handleImport}
              disabled={isImporting || loadingPreview || !preview}>
              {isImporting ? (
                <View style={styles.importingRow}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                  <Text style={styles.importButtonText}>Importing...</Text>
                </View>
              ) : (
                <Text style={styles.importButtonText}>Import</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 24,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 12,
  },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  loadingContainer: {
    paddingVertical: 28,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    fontWeight: '500',
  },
  packageDetails: {
    width: '100%',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    gap: 14,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  detailTextContainer: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 15,
    fontWeight: '600',
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  button: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButton: {
    borderWidth: 1,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  importButton: {},
  buttonDisabled: {
    opacity: 0.5,
  },
  importButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  importingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
