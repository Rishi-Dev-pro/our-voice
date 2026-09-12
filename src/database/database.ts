import * as SQLite from 'expo-sqlite';

let dbInstance: SQLite.SQLiteDatabase | null = null;

/**
 * Returns the singleton synchronous SQLite database instance for Our Voice.
 * Creates tables synchronously if they do not already exist.
 * Uses openDatabaseSync and execSync to avoid Android NativeDatabase.prepareAsync
 * NullPointerException race conditions.
 */
export function getDatabase(): SQLite.SQLiteDatabase {
  if (!dbInstance) {
    try {
      const db = SQLite.openDatabaseSync('ourvoice.db');

      db.execSync('PRAGMA journal_mode = WAL;');
      db.execSync('PRAGMA foreign_keys = ON;');

      db.execSync(`
        CREATE TABLE IF NOT EXISTS vns (
          id TEXT PRIMARY KEY NOT NULL,
          title TEXT NOT NULL,
          fileUri TEXT NOT NULL,
          duration REAL NOT NULL DEFAULT 0,
          createdAt INTEGER NOT NULL,
          isLiked INTEGER NOT NULL DEFAULT 0,
          source TEXT NOT NULL DEFAULT 'imported',
          isPinned INTEGER NOT NULL DEFAULT 0,
          lastPosition REAL NOT NULL DEFAULT 0
        );
      `);

      // Safe non-destructive migrations: ensure 'source', 'isPinned', and 'lastPosition' exist
      try {
        const columns = db.getAllSync<{ name: string }>('PRAGMA table_info(vns);');
        const hasSource = columns.some((col) => col.name === 'source');
        if (!hasSource) {
          db.execSync("ALTER TABLE vns ADD COLUMN source TEXT NOT NULL DEFAULT 'imported';");
          console.log('[DATABASE] Successfully added source column to vns table.');
        }
        const hasIsPinned = columns.some((col) => col.name === 'isPinned');
        if (!hasIsPinned) {
          db.execSync("ALTER TABLE vns ADD COLUMN isPinned INTEGER NOT NULL DEFAULT 0;");
          console.log('[DATABASE] Successfully added isPinned column to vns table.');
        }
        const hasLastPosition = columns.some((col) => col.name === 'lastPosition');
        if (!hasLastPosition) {
          db.execSync("ALTER TABLE vns ADD COLUMN lastPosition REAL NOT NULL DEFAULT 0;");
          console.log('[DATABASE] Successfully added lastPosition column to vns table.');
        }
      } catch (migrationErr) {
        console.warn('[DATABASE] Migration check notice:', migrationErr);
      }

      db.execSync(`
        CREATE TABLE IF NOT EXISTS albums (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          createdAt INTEGER NOT NULL
        );
      `);

      db.execSync(`
        CREATE TABLE IF NOT EXISTS album_vns (
          albumId TEXT NOT NULL,
          vnId TEXT NOT NULL,
          PRIMARY KEY (albumId, vnId),
          FOREIGN KEY (albumId) REFERENCES albums (id) ON DELETE CASCADE,
          FOREIGN KEY (vnId) REFERENCES vns (id) ON DELETE CASCADE
        );
      `);

      db.execSync(`
        CREATE TABLE IF NOT EXISTS recently_played (
          vnId TEXT PRIMARY KEY NOT NULL,
          lastPlayedAt INTEGER NOT NULL,
          FOREIGN KEY (vnId) REFERENCES vns (id) ON DELETE CASCADE
        );
      `);

      // Safe non-destructive performance indexes
      db.execSync(`
        CREATE INDEX IF NOT EXISTS idx_vns_createdAt ON vns(createdAt DESC);
        CREATE INDEX IF NOT EXISTS idx_vns_source ON vns(source);
        CREATE INDEX IF NOT EXISTS idx_vns_isLiked ON vns(isLiked);
        CREATE INDEX IF NOT EXISTS idx_vns_isPinned ON vns(isPinned);
        CREATE INDEX IF NOT EXISTS idx_album_vns_albumId ON album_vns(albumId);
        CREATE INDEX IF NOT EXISTS idx_album_vns_vnId ON album_vns(vnId);
        CREATE INDEX IF NOT EXISTS idx_recently_played_lastPlayedAt ON recently_played(lastPlayedAt DESC);
      `);

      dbInstance = db;
    } catch (err) {
      console.error('[DATABASE] Failed to initialize SQLite database:', err);
      throw err;
    }
  }

  return dbInstance;
}

/**
 * Executes a database action safely.
 * Returns a Promise to maintain asynchronous interface compatibility with callers.
 */
export async function withDatabase<T>(
  action: (db: SQLite.SQLiteDatabase) => T | Promise<T>
): Promise<T> {
  const db = getDatabase();
  return Promise.resolve(action(db));
}

