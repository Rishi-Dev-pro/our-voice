export interface VN {
  id: string;
  title: string;
  fileUri: string;
  duration: number; // Duration in seconds
  createdAt: number; // Timestamp in milliseconds
  isLiked: boolean;
  source?: 'imported' | 'recorded';
  isPinned?: boolean;
  lastPosition?: number; // Last playback position in seconds for continue listening
}


export interface Album {
  id: string;
  name: string;
  createdAt: number; // Timestamp in milliseconds
  vnCount?: number;
}

export interface AlbumVN {
  albumId: string;
  vnId: string;
}
