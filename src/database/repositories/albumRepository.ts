import { getDatabase } from '../database';
import { Album, VN } from '@/types/vn';

interface AlbumRow {
  id: string;
  name: string;
  createdAt: number;
  vnCount?: number;
}

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

export const albumRepository = {
  async getAllAlbums(): Promise<Album[]> {
    const db = getDatabase();
    const rows = db.getAllSync<AlbumRow>(`
      SELECT 
        a.id, 
        a.name, 
        a.createdAt, 
        COUNT(av.vnId) AS vnCount
      FROM albums a
      LEFT JOIN album_vns av ON a.id = av.albumId
      GROUP BY a.id
      ORDER BY a.createdAt DESC
    `);

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: Number(row.createdAt) || Date.now(),
      vnCount: Number(row.vnCount) || 0,
    }));
  },

  async getAlbumById(id: string): Promise<Album | null> {
    const db = getDatabase();
    const row = db.getFirstSync<AlbumRow>(`
      SELECT 
        a.id, 
        a.name, 
        a.createdAt, 
        COUNT(av.vnId) AS vnCount
      FROM albums a
      LEFT JOIN album_vns av ON a.id = av.albumId
      WHERE a.id = ?
      GROUP BY a.id
    `, [id]);

    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      createdAt: Number(row.createdAt) || Date.now(),
      vnCount: Number(row.vnCount) || 0,
    };
  },

  async createAlbum(name: string): Promise<Album> {
    const db = getDatabase();
    const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
    const createdAt = Date.now();

    db.runSync(
      'INSERT INTO albums (id, name, createdAt) VALUES (?, ?, ?)',
      [id, name.trim(), createdAt]
    );

    return {
      id,
      name: name.trim(),
      createdAt,
      vnCount: 0,
    };
  },

  async renameAlbum(id: string, name: string): Promise<void> {
    const db = getDatabase();
    db.runSync('UPDATE albums SET name = ? WHERE id = ?', [name.trim(), id]);
  },

  async deleteAlbum(id: string): Promise<void> {
    const db = getDatabase();
    db.runSync('DELETE FROM albums WHERE id = ?', [id]);
  },

  async getVnsInAlbum(albumId: string): Promise<VN[]> {
    const db = getDatabase();
    const rows = db.getAllSync<VnRow>(`
      SELECT v.id, v.title, v.fileUri, v.duration, v.createdAt, v.isLiked, v.source, v.isPinned, v.lastPosition
      FROM vns v
      INNER JOIN album_vns av ON v.id = av.vnId
      WHERE av.albumId = ?
      ORDER BY v.createdAt DESC
    `, [albumId]);

    return rows.map(mapRowToVn);
  },

  async addVnToAlbum(albumId: string, vnId: string): Promise<void> {
    const db = getDatabase();
    db.runSync(
      'INSERT OR IGNORE INTO album_vns (albumId, vnId) VALUES (?, ?)',
      [albumId, vnId]
    );
  },

  async removeVnFromAlbum(albumId: string, vnId: string): Promise<void> {
    const db = getDatabase();
    db.runSync(
      'DELETE FROM album_vns WHERE albumId = ? AND vnId = ?',
      [albumId, vnId]
    );
  },

  async getAlbumsForVn(vnId: string): Promise<string[]> {
    const db = getDatabase();
    const rows = db.getAllSync<{ albumId: string }>(
      'SELECT albumId FROM album_vns WHERE vnId = ?',
      [vnId]
    );
    return rows.map((r) => r.albumId);
  },
};

