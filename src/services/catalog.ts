import type { Song, Lyrics, LyricLine } from "../models/Song";

let counter = 0;
export const newId = () => `s${Date.now()}_${counter++}`;

/** Searches the public iTunes catalogue (no key): cover art + 30 s preview. */
export async function searchSongs(q: string, limit = 20): Promise<Song[]> {
  const r = await fetch(`https://itunes.apple.com/search?media=music&entity=song&limit=${limit}&term=${encodeURIComponent(q)}`);
  const d = await r.json();
  return d.results.map((x: any): Song => ({
    id: newId(), title: x.trackName, artist: x.artistName, album: x.collectionName ?? "",
    cover: x.artworkUrl100?.replace("100x100", "600x600"), audioUrl: x.previewUrl, preview: true,
    duration: x.trackTimeMillis ? Math.round(x.trackTimeMillis / 1000) : undefined, source: "itunes",
  }));
}

/** Fills in audio and cover art when missing (sample or imported songs). */
export async function hydrate(s: Song): Promise<void> {
  if (s.source === "local" || (s.audioUrl && s.cover)) return;
  try {
    const [m] = await searchSongs(`${s.title} ${s.artist}`, 1);
    if (!m) return;
    if (!s.audioUrl && m.audioUrl) { s.audioUrl = m.audioUrl; s.preview = true; }
    s.cover ??= m.cover;
    if (!s.album) s.album = m.album;
  } catch { /* offline: will be retried later */ }
}

/** Converts LRC text ("[01:23.45] line") into timed lines. */
function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const ln of lrc.split("\n")) {
    const m = /^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/.exec(ln);
    if (m) out.push({ t: +m[1] * 60 + +m[2], text: m[3] });
  }
  return out;
}

/** Looks up lyrics on LRCLIB (free, no key). */
export async function fetchLyrics(s: Song): Promise<Lyrics | null> {
  if (s.lyrics !== undefined) return s.lyrics;
  try {
    const url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(s.title)}&artist_name=${encodeURIComponent(s.artist)}`;
    const found = (await (await fetch(url)).json()).filter((x: any) => x.syncedLyrics || x.plainLyrics);
    // Pick the version whose length is closest to the song's (better sync)
    const d = s.duration ?? 0;
    const hit = d ? found.sort((a: any, b: any) => Math.abs(a.duration - d) - Math.abs(b.duration - d))[0] : found[0];
    s.lyrics = hit ? { synced: hit.syncedLyrics ? parseLrc(hit.syncedLyrics) : null, plain: hit.plainLyrics ?? null } : null;
    return s.lyrics;
  } catch { return null; }
}
