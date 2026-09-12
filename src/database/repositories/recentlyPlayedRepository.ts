import { DeviceEventEmitter } from 'react-native';
import { getDatabase } from '../database';
import { VN } from '@/types/vn';

interface VnRow {
  id: string;
  title: string;
  fileUri: string;
  duration: number;
  createdAt: number;
  isLiked: number;
  source?: string;
  isPinned?: number;
  lastPosition?: number;
}

function mapRowToVn(row: VnRow): VN {
  return {
    id: row.id,
    title: row.title,
    fileUri: row.fileUri,
    duration: Number(row.duration) || 0,
    createdAt: Number(row.createdAt) || Date.now(),
    isLiked: Number(row.isLiked) === 1 || String(row.isLiked) === '1' || Boolean(row.isLiked) === true,
    source: row.source === 'recorded' ? 'recorded' : 'imported',
    isPinned: Number(row.isPinned) === 1 || String(row.isPinned) === '1' || Boolean(row.isPinned) === true,
    lastPosition: Number(row.lastPosition) || 0,
  };
}

const VN_COLUMNS = 'v.id, v.title, v.fileUri, v.duration, v.createdAt, v.isLiked, v.source, v.isPinned, v.lastPosition';

export const recentlyPlayedRepository = {
  /**
   * Records that a VN was played. Moves it to the top of the recently played list.
   * Keeps the total entries bounded (max 100).
   */
  async recordPlay(vnId: string): Promise<void> {
    if (!vnId) return;
    const db = getDatabase();
    const now = Date.now();
    try {
      db.runSync(
        'INSERT OR REPLACE INTO recently_played (vnId, lastPlayedAt) VALUES (?, ?);',
        [vnId, now]
      );
      // Prune history to keep only the top 100 most recent
      db.runSync(`
        DELETE FROM recently_played 
        WHERE vnId NOT IN (
          SELECT vnId FROM recently_played ORDER BY lastPlayedAt DESC LIMIT 100
        );
      `);
      DeviceEventEmitter.emit('library_updated');
    } catch (err) {
      console.warn('[RECENTLY PLAYED] Error recording play:', err);
    }
  },

  /**
   * Retrieves the recently played VNs ordered by lastPlayedAt DESC.
   */
  async getRecentlyPlayed(limit = 50): Promise<VN[]> {
    const db = getDatabase();
    try {
      const rows = db.getAllSync<VnRow>(
        `SELECT ${VN_COLUMNS} 
         FROM recently_played rp
         INNER JOIN vns v ON rp.vnId = v.id
         ORDER BY rp.lastPlayedAt DESC
         LIMIT ?;`,
        [limit]
      );
      return rows.map(mapRowToVn);
    } catch (err) {
      console.warn('[RECENTLY PLAYED] Error fetching recently played:', err);
      return [];
    }
  },

  /**
   * Clears all entries from the recently played history.
   */
  async clearRecentlyPlayed(): Promise<void> {
    const db = getDatabase();
    try {
      db.runSync('DELETE FROM recently_played;');
    } catch (err) {
      console.warn('[RECENTLY PLAYED] Error clearing recently played:', err);
    }
  },

  /**
   * Removes a single VN from recently played history.
   */
  async removeByVnId(vnId: string): Promise<void> {
    if (!vnId) return;
    const db = getDatabase();
    try {
      db.runSync('DELETE FROM recently_played WHERE vnId = ?;', [vnId]);
    } catch (err) {
      console.warn('[RECENTLY PLAYED] Error removing VN from recently played:', err);
    }
  },
};
