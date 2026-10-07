import type { Song } from "../models/Song";
import { searchSongs } from "./catalog";

export interface ArtistInfo { name: string; bio?: string; photo?: string; genre?: string; url?: string; top: Song[]; similar: string[] }

const LASTFM = import.meta.env.VITE_LASTFM_API_KEY as string | undefined;
const cache = new Map<string, ArtistInfo>();
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const json = async (u: string) => (await fetch(u)).json();

/** Gathers a biography (Wikipedia), genre, the artist's songs (iTunes) and similar artists (Last.fm, optional). */
export async function getArtistInfo(name: string, lang: "es" | "en"): Promise<ArtistInfo> {
  const key = `${lang}|${name}`;
  if (cache.has(key)) return cache.get(key)!;
  const info: ArtistInfo = { name, top: [], similar: [] };
  await Promise.allSettled([wiki(info, lang), itunes(info), lastfm(info)]);
  cache.set(key, info);
  return info;
}

async function wiki(i: ArtistInfo, lang: string) {
  // The Spanish edition needs Spanish keywords to find and validate musician pages
  const host = `https://${lang}.wikipedia.org`, q = `${i.name} ${lang === "es" ? "cantante músico" : "singer musician"}`;
  const s = await json(`${host}/w/api.php?action=query&list=search&srlimit=1&format=json&origin=*&srsearch=${encodeURIComponent(q)}`);
  const title: string | undefined = s.query?.search?.[0]?.title;
  if (!title || !norm(title).includes(norm(i.name))) return;          // avoids showing the biography of a different person
  const d = await json(`${host}/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
  // Accept only pages that describe a musician or a band (keywords in both languages)
  if (d.type === "disambiguation" || !/(cantante|músic|rap|banda|dúo|compositor|singer|musician|band|rapper|songwriter|duo)/i.test(d.extract ?? "")) return;
  i.bio = d.extract; i.photo = d.thumbnail?.source; i.url = d.content_urls?.desktop?.page;
}

async function itunes(i: ArtistInfo) {
  const a = await json(`https://itunes.apple.com/search?media=music&entity=musicArtist&limit=1&term=${encodeURIComponent(i.name)}`);
  const hit = a.results?.[0];
  if (hit && norm(hit.artistName).includes(norm(i.name))) i.genre = hit.primaryGenreName;
  i.top = (await searchSongs(i.name, 20)).filter(s => norm(s.artist).includes(norm(i.name)));
}

async function lastfm(i: ArtistInfo) {
  if (!LASTFM) return;
  const d = await json(`https://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&limit=8&format=json&api_key=${LASTFM}&artist=${encodeURIComponent(i.name)}`);
  i.similar = (d.similarartists?.artist ?? []).map((a: any) => a.name);
}
