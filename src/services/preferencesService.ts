import { File, Paths } from 'expo-file-system';
import * as FileSystemLegacy from 'expo-file-system/legacy';

export interface UserPreferences {
  hasCompletedOnboarding: boolean;
  userName: string;
  onboardedAt?: number;
  recentTeddyPicks?: string[];
}

const DEFAULT_PREFERENCES: UserPreferences = {
  hasCompletedOnboarding: false,
  userName: '',
  recentTeddyPicks: [],
};

const PREFERENCES_FILE_NAME = 'user_preferences.json';

/**
 * Gets the preferences file instance using Expo FileSystem Paths.
 */
function getPreferencesFile(): File {
  return new File(Paths.document, PREFERENCES_FILE_NAME);
}

/**
 * Gets the legacy URI string for the preferences file.
 */
function getLegacyPreferencesUri(): string {
  const baseUri = FileSystemLegacy.documentDirectory || '';
  return `${baseUri}${PREFERENCES_FILE_NAME}`;
}

export const preferencesService = {
  /**
   * Retrieves user preferences from local storage.
   * Completely offline, does not interact with the SQLite database.
   */
  async getPreferences(): Promise<UserPreferences> {
    try {
      const prefsFile = getPreferencesFile();
      if (prefsFile.exists) {
        const content = await prefsFile.text();
        if (content && content.trim()) {
          const parsed = JSON.parse(content);
          return {
            hasCompletedOnboarding: Boolean(parsed.hasCompletedOnboarding),
            userName: typeof parsed.userName === 'string' ? parsed.userName.trim() : '',
            onboardedAt: typeof parsed.onboardedAt === 'number' ? parsed.onboardedAt : undefined,
            recentTeddyPicks: Array.isArray(parsed.recentTeddyPicks) ? parsed.recentTeddyPicks : [],
          };
        }
      }
    } catch (modernErr) {
      console.warn('[PREFERENCES] Modern file read attempt fallback:', modernErr);
    }

    // Fallback: Legacy FileSystem read
    try {
      const legacyUri = getLegacyPreferencesUri();
      const info = await FileSystemLegacy.getInfoAsync(legacyUri);
      if (info.exists) {
        const content = await FileSystemLegacy.readAsStringAsync(legacyUri);
        if (content && content.trim()) {
          const parsed = JSON.parse(content);
          return {
            hasCompletedOnboarding: Boolean(parsed.hasCompletedOnboarding),
            userName: typeof parsed.userName === 'string' ? parsed.userName.trim() : '',
            onboardedAt: typeof parsed.onboardedAt === 'number' ? parsed.onboardedAt : undefined,
            recentTeddyPicks: Array.isArray(parsed.recentTeddyPicks) ? parsed.recentTeddyPicks : [],
          };
        }
      }
    } catch (legacyErr) {
      console.warn('[PREFERENCES] Legacy file read error:', legacyErr);
    }

    return { ...DEFAULT_PREFERENCES };
  },

  /**
   * Saves updated user preferences to local storage.
   */
  async savePreferences(prefs: Partial<UserPreferences>): Promise<UserPreferences> {
    const current = await this.getPreferences();
    const updated: UserPreferences = {
      ...current,
      ...prefs,
    };

    const payload = JSON.stringify(updated, null, 2);
    let writeSuccess = false;

    // Strategy 1: Modern File.write
    try {
      const prefsFile = getPreferencesFile();
      prefsFile.write(payload);
      writeSuccess = true;
    } catch (modernErr) {
      console.warn('[PREFERENCES] Modern file write attempt fallback:', modernErr);
    }

    // Strategy 2: Legacy FileSystem write fallback
    if (!writeSuccess) {
      try {
        const legacyUri = getLegacyPreferencesUri();
        await FileSystemLegacy.writeAsStringAsync(legacyUri, payload);
        writeSuccess = true;
      } catch (legacyErr) {
        console.error('[PREFERENCES] Failed to write preferences file:', legacyErr);
        throw legacyErr;
      }
    }

    return updated;
  },

  /**
   * Records that onboarding has been completed and stores the user's name.
   */
  async completeOnboarding(userName: string): Promise<UserPreferences> {
    const cleanName = userName.trim();
    return this.savePreferences({
      hasCompletedOnboarding: true,
      userName: cleanName,
      onboardedAt: Date.now(),
    });
  },

  /**
   * Retrieves the bounded list of recently picked voice note IDs.
   */
  async getRecentTeddyPicks(): Promise<string[]> {
    const prefs = await this.getPreferences();
    return prefs.recentTeddyPicks || [];
  },

  /**
   * Records a newly picked voice note ID into bounded recent history (max 8 items).
   */
  async recordTeddyPick(vnId: string): Promise<void> {
    const current = await this.getRecentTeddyPicks();
    const updated = [vnId, ...current.filter((id) => id !== vnId)].slice(0, 8);
    await this.savePreferences({ recentTeddyPicks: updated });
  },

  /**
   * DEV ONLY: Resets onboarding state without modifying or deleting any SQLite VN data or audio files.
   */
  async resetOnboardingForDev(): Promise<void> {
    try {
      await this.savePreferences({
        hasCompletedOnboarding: false,
        userName: '',
        onboardedAt: undefined,
        recentTeddyPicks: [],
      });
      console.log('[PREFERENCES] Dev reset complete: onboarding state reset.');
    } catch (err) {
      console.error('[PREFERENCES] Failed to reset onboarding for dev:', err);
    }
  },
};
