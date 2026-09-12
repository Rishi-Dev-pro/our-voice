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

const VN_COLUMNS = 'id, title, fileUri, duration, createdAt, isLiked, source, isPinned, lastPosition';

export const vnRepository = {
  async getAllVns(): Promise<VN[]> {
    const db = getDatabase();
    const rows = db.getAllSync<VnRow>(
      `SELECT ${VN_COLUMNS} FROM vns ORDER BY createdAt DESC`
    );
    return rows.map(mapRowToVn);
  },

  async getImportedVns(): Promise<VN[]> {
    const db = getDatabase();
    const rows = db.getAllSync<VnRow>(
      `SELECT ${VN_COLUMNS} FROM vns WHERE source = 'imported' OR source IS NULL ORDER BY createdAt DESC`
    );
    return rows.map(mapRowToVn);
  },

  async getRecordedVns(): Promise<VN[]> {
    const db = getDatabase();
    const rows = db.getAllSync<VnRow>(
      `SELECT ${VN_COLUMNS} FROM vns WHERE source = 'recorded' ORDER BY createdAt DESC`
    );
    return rows.map(mapRowToVn);
  },

  async getLikedVns(): Promise<VN[]> {
    const db = getDatabase();
    const rows = db.getAllSync<VnRow>(
      `SELECT ${VN_COLUMNS} FROM vns WHERE isLiked = 1 OR isLiked = "1" ORDER BY createdAt DESC`
    );
    return rows.map(mapRowToVn);
  },

  async getPinnedVns(): Promise<VN[]> {
    const db = getDatabase();
    const rows = db.getAllSync<VnRow>(
      `SELECT ${VN_COLUMNS} FROM vns WHERE isPinned = 1 OR isPinned = "1" ORDER BY createdAt DESC`
    );
    return rows.map(mapRowToVn);
  },

  async getContinueListeningVn(): Promise<VN | null> {
    const db = getDatabase();
    // Finds the most recent VN with meaningful unfinished playback (> 2s and < duration - 2s)
    const row = db.getFirstSync<VnRow>(
      `SELECT ${VN_COLUMNS} FROM vns WHERE lastPosition > 2 AND lastPosition < (duration - 2) ORDER BY createdAt DESC LIMIT 1`
    );
    return row ? mapRowToVn(row) : null;
  },

  async getVnById(id: string): Promise<VN | null> {
    const db = getDatabase();
    const row = db.getFirstSync<VnRow>(
      `SELECT ${VN_COLUMNS} FROM vns WHERE id = ?`,
      [id]
    );
    return row ? mapRowToVn(row) : null;
  },

  async createVn(vn: Omit<VN, 'isLiked'> & { isLiked?: boolean; source?: 'imported' | 'recorded'; isPinned?: boolean; lastPosition?: number }): Promise<VN> {
    const db = getDatabase();
    const isLikedNum = vn.isLiked ? 1 : 0;
    const isPinnedNum = vn.isPinned ? 1 : 0;
    const src = vn.source === 'recorded' ? 'recorded' : 'imported';
    const lastPos = vn.lastPosition || 0;
    db.runSync(
      'INSERT INTO vns (id, title, fileUri, duration, createdAt, isLiked, source, isPinned, lastPosition) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [vn.id, vn.title, vn.fileUri, vn.duration, vn.createdAt, isLikedNum, src, isPinnedNum, lastPos]
    );

    return {
      id: vn.id,
      title: vn.title,
      fileUri: vn.fileUri,
      duration: vn.duration,
      createdAt: vn.createdAt,
      isLiked: !!vn.isLiked,
      source: src,
      isPinned: !!vn.isPinned,
      lastPosition: lastPos,
    };
  },

  async toggleLike(id: string, isLiked: boolean): Promise<void> {
    const db = getDatabase();
    db.runSync('UPDATE vns SET isLiked = ? WHERE id = ?', [isLiked ? 1 : 0, id]);
  },

  async togglePin(id: string, isPinned: boolean): Promise<void> {
    const db = getDatabase();
    db.runSync('UPDATE vns SET isPinned = ? WHERE id = ?', [isPinned ? 1 : 0, id]);
  },

  async updateLastPosition(id: string, position: number): Promise<void> {
    const db = getDatabase();
    const safePos = Math.max(0, isNaN(position) ? 0 : position);
    db.runSync('UPDATE vns SET lastPosition = ? WHERE id = ?', [safePos, id]);
  },

  async clearLastPosition(id: string): Promise<void> {
    const db = getDatabase();
    db.runSync('UPDATE vns SET lastPosition = 0 WHERE id = ?', [id]);
  },

  async updateVnTitle(id: string, title: string): Promise<void> {
    const db = getDatabase();
    db.runSync('UPDATE vns SET title = ? WHERE id = ?', [title, id]);
  },

  async deleteVn(id: string): Promise<void> {
    const db = getDatabase();
    db.runSync('DELETE FROM vns WHERE id = ?', [id]);
  },
};
