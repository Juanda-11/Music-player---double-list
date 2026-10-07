import type { Song } from "../models/Song";
import { newId } from "./catalog";

// =====================================================================
// Spotify: login (OAuth PKCE), import and full playback
// with the Web Playback SDK (requires a Premium account).
// =====================================================================
// The Client ID is public (not a secret). It can be overridden with VITE_SPOTIFY_CLIENT_ID on Vercel.
const CLIENT_ID = (import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined) || "795ea8e3263b482f872c052480687eba";
const REDIRECT = `${location.origin}/`;
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const SCOPES = [
  "streaming", "user-read-email", "user-read-private", "user-modify-playback-state", "user-read-playback-state",
  "user-library-read", "user-follow-read", "playlist-read-private", "playlist-read-collaborative",
].join(" ");
export const spotifyConfigured = !!CLIENT_ID;

// ---------- Session (stored so the user doesn't have to log in on every reload) ----------
interface Auth { access: string; refresh?: string; exp: number }
const loadAuth = (): Auth | null => { try { return JSON.parse(localStorage.getItem("sp_auth") || "null"); } catch { return null; } };
const saveAuth = (d: any) => localStorage.setItem("sp_auth", JSON.stringify(
  { access: d.access_token, refresh: d.refresh_token ?? loadAuth()?.refresh, exp: Date.now() + d.expires_in * 1000 }));
export const spotifyConnected = () => !!loadAuth();
export const spotifyLogout = () => { localStorage.removeItem("sp_auth"); };

async function tokenRequest(params: Record<string, string>): Promise<void> {
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID!, ...params }) });
  const d = await r.json();
  if (!d.access_token) throw new Error(d.error_description ?? "token");
  saveAuth(d);
}

/** Returns a valid token, refreshing it if it is about to expire. */
export async function getToken(): Promise<string> {
  let a = loadAuth();
  if (!a) throw new Error("not-connected");
  if (Date.now() > a.exp - 60_000) {
    if (!a.refresh) { spotifyLogout(); throw new Error("expired"); }
    await tokenRequest({ grant_type: "refresh_token", refresh_token: a.refresh });
    a = loadAuth()!;
  }
  return a.access;
}

const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Redirects to Spotify to ask for permission. */
export async function spotifyLogin(): Promise<void> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)).buffer);
  localStorage.setItem("sp_verifier", verifier);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  location.href = "https://accounts.spotify.com/authorize?" + new URLSearchParams({
    client_id: CLIENT_ID!, response_type: "code", redirect_uri: REDIRECT, scope: SCOPES,
    code_challenge_method: "S256", code_challenge: challenge,
  });
}

/** If we come back from Spotify with ?code=..., exchanges it for a token. */
export async function spotifyHandleRedirect(): Promise<boolean> {
  const p = new URLSearchParams(location.search), code = p.get("code");
  if (!code && !p.get("error")) return false;
  history.replaceState({}, "", REDIRECT);
  if (!code || !CLIENT_ID) return false;
  try {
    await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: localStorage.getItem("sp_verifier") ?? "" });
    return true;
  } catch (e) { console.error(e); return false; }
}

async function api(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch("https://api.spotify.com/v1" + path,
    { ...init, headers: { Authorization: "Bearer " + (await getToken()), "Content-Type": "application/json" } });
  if (!r.ok) throw new Error(`Spotify ${r.status} ${path}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}

/** Downloads up to `max` items, paging 50 at a time. */
async function pages(path: string, max = 100): Promise<any[]> {
  const out: any[] = [], sep = path.includes("?") ? "&" : "?";
  for (let o = 0; o < max; o += 50) {
    const d = await api(`${path}${sep}limit=50&offset=${o}`);
    out.push(...d.items);
    if (!d.next) break;
  }
  return out;
}

const toSong = (t: any, album = t.album): Song => ({
  id: newId(), title: t.name, artist: t.artists?.[0]?.name ?? "", album: album?.name ?? "",
  cover: album?.images?.[0]?.url, artistId: t.artists?.[0]?.id, duration: Math.round((t.duration_ms ?? 0) / 1000) || undefined, uri: t.uri, source: "spotify",
});

// ---------- Import ----------
export const importSavedTracks = async (): Promise<Song[]> => (await pages("/me/tracks")).map(i => toSong(i.track));

export async function importSavedAlbums(): Promise<Song[]> {
  const out: Song[] = [];
  for (const { album } of await pages("/me/albums", 50)) for (const t of album.tracks.items) out.push(toSong(t, album));
  return out;
}

export async function followedArtists(): Promise<string[]> {
  const d = await api("/me/following?type=artist&limit=50");
  return d.artists.items.map((a: any) => a.name);
}

export interface PlaylistInfo { id: string; name: string; total: number; cover?: string }
export async function myPlaylists(): Promise<PlaylistInfo[]> {
  return (await pages("/me/playlists", 200)).filter(Boolean).map((p: any) => ({
    id: p.id, name: p.name, total: p.items?.total ?? p.tracks?.total ?? 0, cover: p.images?.[0]?.url }));
}

/** Imports a playlist. Since Feb 2026 the endpoint is /items (formerly /tracks) and the field is "item" (formerly "track"). */
export async function importPlaylist(id: string): Promise<Song[]> {
  let rows: any[];
  try { rows = await pages(`/playlists/${id}/items`, 500); } catch { rows = await pages(`/playlists/${id}/tracks`, 500); }
  return rows.map(r => r.item ?? r.track).filter(x => x && x.type === "track" && !x.is_local).map(x => toSong(x));
}

// ---------- Search (max. 10 results since Feb 2026) ----------
export async function searchTracks(q: string, limit = 10): Promise<Song[]> {
  const d = await api(`/search?type=track&limit=${limit}&q=${encodeURIComponent(q)}`);
  return d.tracks.items.map((t: any) => toSong(t));
}

/** Links a song that has no URI (sample songs, etc.) to its Spotify version. */
export async function resolve(s: Song): Promise<boolean> {
  const [m] = await searchTracks(`${s.title} ${s.artist}`.trim(), 1);
  if (!m) return false;
  s.uri = m.uri; s.artistId = m.artistId;
  s.cover ??= m.cover;
  s.duration = m.duration ?? s.duration;
  if (!s.album) s.album = m.album;
  return true;
}

// ---------- Full player (Web Playback SDK) ----------
let player: any = null, deviceId = "", ready: Promise<void> | null = null;
export const playerReady = () => !!deviceId;

/** Creates the Spotify "device" inside this tab. */
export function initPlayer(onState: (s: any) => void, onError: (m: string) => void): Promise<void> {
  if (ready) return ready;
  ready = new Promise<void>(resolveReady => {
    (window as any).onSpotifyWebPlaybackSDKReady = () => {
      player = new (window as any).Spotify.Player({
        name: "My player (Doubly linked list)", volume: 0.8,
        getOAuthToken: (cb: (t: string) => void) => { getToken().then(cb).catch(() => onError("auth")); },
      });
      player.addListener("ready", ({ device_id }: any) => { deviceId = device_id; resolveReady(); });
      player.addListener("player_state_changed", onState);
      for (const ev of ["initialization_error", "authentication_error", "account_error", "playback_error"])
        player.addListener(ev, ({ message }: any) => onError(`${ev}: ${message}`));
      player.connect();
    };
    const s = document.createElement("script");
    s.src = "https://sdk.scdn.co/spotify-player.js"; document.body.appendChild(s);
  });
  return ready;
}

export const sdk = {
  activate: () => player?.activateElement?.(),   // must be called from a click
  pause: () => player?.pause(),
  resume: () => player?.resume(),
  seek: (ms: number) => player?.seek(ms),
  volume: (v: number) => player?.setVolume(v),
};

/** Tells this tab's device to play the song. */
export async function playUri(uri: string): Promise<void> {
  await api(`/me/player/play?device_id=${deviceId}`, { method: "PUT", body: JSON.stringify({ uris: [uri] }) });
}

/** Artist photo (the images field is still available after the Feb 2026 changes). */
export async function artistImage(id: string): Promise<string | undefined> {
  return (await api(`/artists/${id}`)).images?.[0]?.url;
}
