export type Screen = "home" | "albums" | "create" | "detail" | "artist";
export type Track = {
  id?: string;
  title: string;
  artist?: string;
  url?: string;
  coverUrl?: string;
  duration?: number | null;
  genre?: string;
  order?: number;
  lyricsLrc?: string | null;
  lyricsTtml?: string | null;
  playCount?: number;
};
export type Album = {
  id: string;
  name: string;
  artist: string;
  year?: number | null;
  genre?: string;
  coverUrl?: string;
  trackCount?: number;
  canEdit?: boolean;
  tracks?: Track[];
};
export type AlbumDetailsResponse = { album: Album; tracks?: Track[] };
export type AuthResponse = { accessToken: string; expiresAt: string };
export type PendingTrack = {
  id: string;
  file: File;
  title: string;
  artist: string;
  duration: number | null;
  lyricsLrc: string;
  lyricsTtml: string;
};
