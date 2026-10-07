export interface LyricLine { t: number; text: string }          // t = seconds
export interface Lyrics { synced: LyricLine[] | null; plain: string | null }

export interface Song {
  id: string;
  title: string;
  artist: string;
  album: string;
  cover?: string;      // Cover image URL
  audioUrl?: string;   // Audio URL (resolved automatically if missing)
  preview?: boolean;   // true = 30 s preview clip (iTunes)
  duration?: number;   // seconds
  artistId?: string;   // Spotify artist id (for the photo)
  uri?: string;        // Spotify URI (spotify:track:...) → full playback with the SDK
  source: "seed" | "itunes" | "local" | "spotify";
  lyrics?: Lyrics | null; // lyrics cache
}
