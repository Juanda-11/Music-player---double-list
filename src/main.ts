import "./styles/main.css";
import { DoublyLinkedList, Node as ListNode } from "./structures/DoublyLinkedList";
import type { Song } from "./models/Song";
import { searchSongs, hydrate, fetchLyrics, newId } from "./services/catalog";
import * as sp from "./services/spotify";
import { getArtistInfo } from "./services/artistInfo";
import { t, setLang, getLang, applyI18n } from "./i18n";

type N = ListNode<Song>;

// ============================================================
// State: the doubly linked list IS the playlist
// ============================================================
const list = new DoublyLinkedList<Song>();
const audio = new Audio();                 // engine 1: browser audio (local files and iTunes previews)
audio.volume = 0.8;

// Engine 2: Spotify Web Playback SDK (full songs, requires Premium)
let mode: "html" | "spotify" = "html";
let spLoaded = "";                         // URI loaded in the Spotify player
let spEndedFor = "";                       // prevents advancing twice when the same song ends
let spPos = 0, spDur = 0, spPaused = true, spStamp = 0; // state reported by the SDK (ms)

let token = 0;                             // avoids race conditions when songs change quickly
let synced: { t: number; text: string }[] | null = null;
let activeLine = -1;
let lastId = "";
let seeking = false;
let artistFor = "";                         // artist whose card is currently shown

// ---------- UI helpers ----------
const $ = <E extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as E;
const fmt = (s: number) => (Number.isFinite(s) && s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");
const fmtLong = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} ${t("min")}` : `${Math.floor(s / 60)} ${t("min")}`);
function mk<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e;
}
function paint(el: HTMLElement, s?: Song | null) {
  if (s?.cover) { el.style.backgroundImage = `url("${s.cover}")`; el.classList.remove("nocover"); }
  else { el.style.backgroundImage = ""; el.classList.add("nocover"); }
}
let toastTimer = 0;
function toast(msg: string) {
  const el = $("toast"); el.textContent = msg; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => el.classList.remove("show"), 2800);
}
const setFill = (el: HTMLInputElement) => el.style.setProperty("--p", `${(Number(el.value) / Number(el.max || 1)) * 100}%`);
const isPlaying = () => (mode === "spotify" ? !spPaused : !audio.paused);
/** A 30 s clip only counts as a "preview" if we can't use Spotify for that song. */
const isPreviewNow = (s: Song) => s.preview === true && !(s.uri && sp.playerReady());

// ---------- tabs with a sliding indicator ----------
function selectTab(group: string, name: string) {
  const seg = document.querySelector<HTMLElement>(`[data-seg="${group}"]`)!;
  seg.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b, i) => {
    const on = b.dataset.tab === name; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on));
    if (on) seg.style.setProperty("--i", String(i));
  });
  document.querySelectorAll<HTMLElement>(`[data-panel^="${group}:"]`).forEach(p => {
    const on = p.dataset.panel === `${group}:${name}`;
    if (on && p.hidden) { p.hidden = false; p.classList.remove("enter"); void p.offsetWidth; p.classList.add("enter"); }
    else if (!on) p.hidden = true;
  });
}
function initTabs(group: string) {
  const seg = document.querySelector<HTMLElement>(`[data-seg="${group}"]`)!;
  const btns = seg.querySelectorAll<HTMLButtonElement>("[data-tab]");
  seg.style.setProperty("--n", String(btns.length));
  btns.forEach(b => (b.onclick = () => selectTab(group, b.dataset.tab!)));
  selectTab(group, btns[0].dataset.tab!);
}

// ============================================================
// Playback engine (HTML audio or Spotify, same behaviour)
// ============================================================
function setPlayingUI() {
  const p = isPlaying();
  document.body.classList.toggle("playing", p);          // enables the disc spin and the equalizer
  for (const id of ["btn-play", "btn-playall", "fs-play"]) {
    $(id).textContent = p ? "⏸" : "▶"; $(id).setAttribute("aria-label", p ? t("pause") : t("play"));
  }
}

function updateTime(cur: number, dur: number) {
  const seek = $<HTMLInputElement>("seek");
  if (Number(seek.max) !== (dur || 1)) seek.max = String(dur || 1);
  if (!seeking) { seek.value = String(cur); setFill(seek); }
  $("t-cur").textContent = fmt(cur); $("t-tot").textContent = fmt(dur);
  const fsk = $<HTMLInputElement>("fs-seek"); fsk.max = seek.max; if (!seeking) { fsk.value = String(cur); setFill(fsk); }
  if (synced) syncLyrics(cur);
}

async function startSpotify(n: N) {
  try {
    sp.sdk.activate();                                   // unlocks audio (called from a click)
    await sp.playUri(n.data.uri!);
    spLoaded = n.data.uri!; spEndedFor = "";
  } catch (e) { console.error(e); toast(t("spPlayErr")); }
}

async function togglePlay() {
  const n = list.current; if (!n) return;
  if (mode === "spotify") {
    if (!spPaused) sp.sdk.pause();
    else if (spLoaded === n.data.uri) sp.sdk.resume();
    else startSpotify(n);
  } else if (audio.paused) audio.play().catch(() => toast(t("noAudio")));
  else audio.pause();
}

function doSeek(sec: number) {
  if (mode === "spotify") { sp.sdk.seek(sec * 1000); spPos = sec * 1000; spStamp = performance.now(); }
  else audio.currentTime = sec;
}

// ---- browser audio events ----
audio.onplay = audio.onpause = setPlayingUI;
audio.onloadedmetadata = () => {
  const s = list.current?.data;
  if (s && (!s.duration || s.source === "local")) { s.duration = Math.round(audio.duration); renderQueue(); }
};
audio.ontimeupdate = () => { if (mode === "html") updateTime(audio.currentTime, audio.duration || 0); };
audio.onended = () => goNext(false);                   // autoplay when a song ends

// ---- Spotify player events ----
function onSpotifyState(s: any) {
  if (!s) return;
  spPos = s.position; spDur = s.duration; spPaused = s.paused; spStamp = performance.now();
  const curId = list.current?.data.uri?.split(":").pop();
  // When a track ends, Spotify pauses at 0:00 with that track listed in "previous_tracks"
  if (s.paused && s.position === 0 && curId && spEndedFor !== curId && s.track_window.previous_tracks.some((p: any) => p.id === curId)) {
    spEndedFor = curId; spLoaded = ""; goNext(false); return;
  }
  if (mode === "spotify") { updateTime(spPos / 1000, spDur / 1000); setPlayingUI(); }
}
window.setInterval(() => { // the SDK only reports changes: here we interpolate progress for the bar and the lyrics
  if (mode === "spotify" && !spPaused) updateTime(Math.min(spDur, spPos + performance.now() - spStamp) / 1000, spDur / 1000);
}, 250);

// ============================================================
// Load the current song, navigate (skip forward / back), remove
// ============================================================
/** Before playing: makes sure there is audio (Spotify if possible; otherwise an iTunes clip). */
async function resolveAudio(s: Song) {
  if (s.source === "local") return;
  if (!s.uri && sp.playerReady()) { try { if (await sp.resolve(s)) return; } catch { /* fall back to iTunes */ } }
  if (!(s.uri && sp.playerReady())) await hydrate(s);
}

async function loadCurrent(play: boolean) {
  const n = list.current, my = ++token;
  audio.pause();
  if (!n) { mode = "html"; audio.removeAttribute("src"); if (!spPaused) sp.sdk.pause(); renderNow(); renderLists(); showLyrics(null, my); setPlayingUI(); updateTime(0, 0); return; }
  renderNow(); renderLists();
  await resolveAudio(n.data);
  if (my !== token) return;
  mode = n.data.uri && sp.playerReady() ? "spotify" : "html";
  renderNow(); renderLists(); showLyrics(n, my);
  if (mode === "html") {
    if (!spPaused) sp.sdk.pause();
    if (!n.data.audioUrl) { toast(t("noAudio")); setPlayingUI(); return; }
    audio.src = n.data.audioUrl; updateTime(0, n.data.duration ?? 0);
    if (play) audio.play().catch(() => {});
  } else {
    audio.removeAttribute("src"); spLoaded = ""; spEndedFor = ""; updateTime(0, n.data.duration ?? 0);
    if (play) await startSpotify(n);
  }
  setPlayingUI();
}

const autoRemove = () => $<HTMLInputElement>("auto-remove").checked;

/** When a song ends: it leaves the list (if the option is on) and the next one plays; after the last one it wraps to the start. */
function onTrackEnded() {
  const done = list.current; if (!done) return;
  const next = done.next ?? (done === list.head ? null : list.head);
  if (next) list.current = next;
  if (autoRemove()) { const name = done.data.title; list.remove(done); toast(t("finished") + name); } // readjusts next/prev
  loadCurrent(list.current !== null);
}

function goNext(manual: boolean) {
  if (!manual) { onTrackEnded(); return; }                                           // ended on its own
  if (list.moveNext()) loadCurrent(true); else toast(t("atEnd"));                    // Skip forward
}
function goPrev() { if (list.movePrev()) loadCurrent(true); else toast(t("atStart")); }  // Go back

function removeNode(n: N) {
  const wasCurrent = list.current === n, wasPlaying = isPlaying(), name = n.data.title;
  list.remove(n);                                                                    // readjusts next/prev
  toast(t("removed") + name);
  if (wasCurrent) loadCurrent(wasPlaying && list.size > 0); else renderLists();
}

/** Inserts according to the position selector (start / end / index). */
function insert(s: Song): boolean {
  const where = $<HTMLSelectElement>("add-where").value, had = list.current;
  if (where === "first") list.addFirst(s);
  else if (where === "index") {
    const i = Number($<HTMLInputElement>("add-index").value);
    if (!Number.isInteger(i) || i < 0 || i > list.size) { toast(t("badIndex")); return false; }
    list.insertAt(i, s);
  } else list.addLast(s);
  if (!had) loadCurrent(false); else renderLists();
  return true;
}

// ============================================================
// Lyrics
// ============================================================
async function showLyrics(n: N | null, my: number) {
  const box = $("lyrics"); synced = null; activeLine = -1;
  box.className = "lyrics plain"; box.textContent = ""; box.scrollTop = 0;
  if (!n) return;
  box.textContent = t("lyricsLoading");
  const ly = await fetchLyrics(n.data);
  if (my !== token) return;
  box.textContent = "";
  if (!ly) { box.textContent = t("lyricsNone"); return; }
  if (ly.synced && !isPreviewNow(n.data)) {            // 30 s clips don't line up with the lyric timestamps
    synced = ly.synced; box.className = "lyrics";
    ly.synced.forEach(l => box.appendChild(mk("p", "", l.text || "♪")));
  } else box.textContent = ly.plain ?? ly.synced?.map(l => l.text).join("\n") ?? t("lyricsNone");
}
function syncLyrics(cur: number) {
  let i = -1;
  for (let k = 0; k < synced!.length; k++) { if (synced![k].t <= cur) i = k; else break; }
  if (i === activeLine) return;
  activeLine = i;
  const box = $("lyrics");
  Array.from(box.children).forEach((p, k) => p.classList.toggle("on", k === i));
  const p = box.children[i] as HTMLElement | undefined;
  if (p) box.scrollTo({ top: p.offsetTop - box.clientHeight / 2 + p.clientHeight / 2, behavior: "smooth" });
}

// ============================================================
// Render
// ============================================================
function renderNow() {
  const s = list.current?.data;
  $("np-title").textContent = s ? s.title : t("idle");
  $("np-artist").textContent = s ? s.artist || "—" : t("idleHint");
  $("np-album").textContent = s?.album ?? "";
  $("np-note").textContent = s && isPreviewNow(s) ? t("preview") : "";
  paint($("label"), s); paint($("glow"), s);
  const hi = s?.cover?.replace("600x600", "1400x1400");               // large cover for full screen
  for (const id of ["fs-cover", "fs-bg"]) { const e = $(id); e.style.backgroundImage = hi ? `url("${hi}")` : ""; e.classList.toggle("nocover", !hi); }
  $("fs-title").textContent = s?.title ?? ""; $("fs-artist").textContent = s?.artist ?? "";
  if (s && s.id !== lastId) {                          // smooth transition when the song changes
    for (const id of ["glow", "label", "fs-cover"]) { const e = $(id); e.classList.remove("swap"); void e.offsetWidth; e.classList.add("swap"); }
  }
  if ((s?.artist ?? "") !== artistFor) loadArtist(s?.artist ?? "");
  lastId = s?.id ?? "";
}

function renderLists() { saveState(); renderBanner(); renderQueue(); renderAlbums(); }

/** Spotify-style header: collage of the first 4 covers, title and total duration. */
function renderBanner() {
  const col = $("collage"); col.textContent = "";
  let n = list.head;
  for (let i = 0; i < 4; i++) { const c = mk("div"); paint(c, n?.data); col.appendChild(c); n = n?.next ?? null; }
  let total = 0; list.forEach(s => { total += s.duration ?? 0; });
  $("list-title").textContent = t("listTitle");
  $("list-meta").textContent = `${list.size} ${t("songs")}${total ? ", " + fmtLong(total) : ""}`;
}

function renderQueue() {
  const ul = $("list"); ul.textContent = ""; rowNode.clear();
  if (!list.size) ul.appendChild(mk("li", "empty", t("empty")));
  list.forEach((s, i, node) => {
    const active = node === list.current;
    const li = mk("li", active ? "item active" : "item"), pick = mk("button", "pick");
    const idx = mk("span", "idx");
    if (active) idx.innerHTML = `<span class="eq"><i></i><i></i><i></i></span>`; else idx.textContent = String(i + 1);
    const thumb = mk("span", "thumb"); paint(thumb, s);
    const meta = mk("span", "meta"); meta.append(mk("b", "", s.title), mk("i", "", s.artist || "—"));
    const main = mk("span", "rowmain"); main.append(thumb, meta);
    pick.append(idx, main, mk("span", "alb", s.album), mk("span", "dur", s.duration ? fmt(s.duration) : ""));
    pick.onclick = () => { if (justDragged) return; list.current = node; loadCurrent(true); };
    rowNode.set(li, node); li.onpointerdown = e => startPress(e, li);
    const del = mk("button", "rm", "✕"); del.title = t("remove"); del.setAttribute("aria-label", `${t("remove")}: ${s.title}`);
    del.onclick = () => removeNode(node);
    li.append(pick, del); ul.appendChild(li);
  });
}

/** Album sidebar (the Map is only for the view; the list itself stays linked). Highlights the current song's album. */
let lastAlbumKey = "";
function renderAlbums() {
  const groups = new Map<string, { s: Song; first: N; count: number }>();
  list.forEach((s, _i, node) => {
    const key = `${s.album}|${s.artist}`, g = groups.get(key);
    if (g) g.count++; else groups.set(key, { s, first: node, count: 1 });
  });
  const rail = $("albumrail"); rail.textContent = "";
  const cur = list.current?.data, curKey = cur ? `${cur.album}|${cur.artist}` : "";
  let activeEl: HTMLElement | null = null;
  groups.forEach(({ s, first, count }, key) => {
    const b = mk("button", key === curKey ? "arow active" : "arow"); b.title = s.album || t("noAlbum");
    const cov = mk("span", "acov"); paint(cov, s);
    const txt = mk("span", "atxt"); txt.append(mk("b", "", s.album || t("noAlbum")), mk("i", "", `${s.artist || "—"} (${count})`));
    b.append(cov, txt);
    b.onclick = () => { list.current = first; loadCurrent(true); };
    rail.appendChild(b); if (key === curKey) activeEl = b;
  });
  if (activeEl && curKey !== lastAlbumKey) rail.scrollTo({ top: (activeEl as HTMLElement).offsetTop - rail.clientHeight / 2 + 30, behavior: "smooth" });
  lastAlbumKey = curKey;
}

/** Artist card: photo, genre, biography (Wikipedia) and more songs by the artist. */
async function loadArtist(name: string) {
  const card = $("artist"); artistFor = name;
  if (!name || name === t("localArtist")) { card.hidden = true; return; }
  card.hidden = false;
  $("a-name").textContent = name; $("a-genre").textContent = ""; $("a-bio").textContent = "…";
  $("a-link").hidden = true; $("a-top").textContent = ""; $("a-more-t").textContent = ""; $("a-sim-wrap").hidden = true;
  const cur = list.current?.data;
  const info = await getArtistInfo(name, getLang());
  if (artistFor !== name) return;                                      // the song changed while loading
  $("a-genre").textContent = info.genre ?? "";
  const bio = $("a-bio"); bio.textContent = info.bio ?? t("noBio"); bio.classList.remove("open"); bio.onclick = () => bio.classList.toggle("open");
  const link = $<HTMLAnchorElement>("a-link"); if (info.url) { link.href = info.url; link.hidden = false; }
  let photo = info.photo;
  if (cur?.artistId && sp.spotifyConnected()) { try { photo = (await sp.artistImage(cur.artistId)) ?? photo; } catch { /* use the Wikipedia photo */ } }
  if (artistFor !== name) return;
  paint($("a-photo"), { cover: photo } as Song);
  const more = info.top.filter(x => x.title !== cur?.title).slice(0, 5), ul = $("a-top");
  $("a-more-t").textContent = more.length ? t("moreFrom").replace("{a}", name) : "";
  more.forEach(x => {
    const li = mk("li", "item"), pick = mk("button", "pick simple"), thumb = mk("span", "thumb"); paint(thumb, x);
    const meta = mk("span", "meta"); meta.append(mk("b", "", x.title), mk("i", "", x.album));
    pick.append(thumb, meta, mk("span", "dur", "＋"));
    pick.onclick = () => { if (insert(x)) toast(t("added") + x.title); };
    li.appendChild(pick); ul.appendChild(li);
  });
  if (info.similar.length) {
    const box = $("a-sim"); box.textContent = "";
    info.similar.forEach(n => { const c = mk("button", "", n); c.onclick = () => { $<HTMLInputElement>("q").value = n; runSearch(n); }; box.appendChild(c); });
    $("a-sim-wrap").hidden = false;
  }
}

// ============================================================
// Reorder: press a song and drag it (uses list.moveBefore)
// ============================================================
const rowNode = new Map<HTMLElement, N>();      // table row → list node
let drag: { li: HTMLElement; node: N; y0: number; target: HTMLElement | null; after: boolean } | null = null;
let justDragged = false;

/** Mouse: drags on press + move. Finger/pen: drags after holding ~0.3 s. */
function startPress(e: PointerEvent, li: HTMLElement) {
  if (e.button !== 0 || (e.target as HTMLElement).closest(".rm")) return;
  const sx = e.clientX, sy = e.clientY, id = e.pointerId, y0 = e.clientY, mouse = e.pointerType === "mouse";
  const cancel = () => { clearTimeout(timer); li.removeEventListener("pointermove", early); li.removeEventListener("pointerup", cancel); li.removeEventListener("pointercancel", cancel); };
  const early = (m: PointerEvent) => {
    if (Math.hypot(m.clientX - sx, m.clientY - sy) <= 6) return;
    cancel();
    if (mouse) { beginDrag(li, id, y0); onDragMove(m); }   // mouse: press + move drags right away (holding first also works)
  };                                                       // finger: moving early is a scroll; it has to be held first
  const timer = window.setTimeout(() => { cancel(); beginDrag(li, id, y0); }, 300);
  li.addEventListener("pointermove", early); li.addEventListener("pointerup", cancel); li.addEventListener("pointercancel", cancel);
}

function beginDrag(li: HTMLElement, id: number, y0: number) {
  const node = rowNode.get(li); if (!node) return;
  drag = { li, node, y0, target: null, after: false };
  li.setPointerCapture(id); li.classList.add("dragging"); $("list").classList.add("sorting");
  li.onpointermove = onDragMove; li.onpointerup = li.onpointercancel = endDrag;
}

function onDragMove(e: PointerEvent) {
  if (!drag) return;
  drag.li.style.transform = `translateY(${e.clientY - drag.y0}px) scale(1.02)`;       // the row follows the pointer
  const panel = $("list").closest<HTMLElement>(".panel")!, pr = panel.getBoundingClientRect();
  if (e.clientY < pr.top + 60) panel.scrollTop -= 14; else if (e.clientY > pr.bottom - 60) panel.scrollTop += 14; // auto-scroll at the edges
  document.querySelectorAll(".drop-before,.drop-after").forEach(x => x.classList.remove("drop-before", "drop-after"));
  let hit: HTMLElement | null = null, first: HTMLElement | null = null, last: HTMLElement | null = null;
  for (const el of rowNode.keys()) {
    if (el === drag.li) continue;
    first ??= el; last = el;
    const b = el.getBoundingClientRect();
    if (!hit && e.clientY >= b.top && e.clientY <= b.bottom) hit = el;
  }
  if (!hit && first && last) hit = e.clientY < first.getBoundingClientRect().top ? first : e.clientY > last.getBoundingClientRect().bottom ? last : null;
  drag.target = hit;
  if (!hit) return;
  const b = hit.getBoundingClientRect();
  drag.after = hit === last && e.clientY > b.bottom ? true : e.clientY > b.top + b.height / 2;
  hit.classList.add(drag.after ? "drop-after" : "drop-before");
}

function endDrag(e: PointerEvent) {
  if (!drag) return;
  const { li, node, target, after } = drag; drag = null;
  li.releasePointerCapture?.(e.pointerId); li.onpointermove = li.onpointerup = li.onpointercancel = null;
  justDragged = true; window.setTimeout(() => { justDragged = false; }, 0);
  if (target && e.type === "pointerup") {
    const ref = rowNode.get(target)!;
    list.moveBefore(node, after ? ref.next : ref);                                      // relinks next/prev
  }
  renderLists();
}
window.addEventListener("touchmove", e => { if (drag) e.preventDefault(); }, { passive: false }); // on touch screens, don't scroll while dragging

// ============================================================
// Search, upload files and import
// ============================================================
async function runSearch(q: string) {
  selectTab("lib", "add");
  const ul = $("results"); ul.textContent = "…";
  try {
    let found: Song[];
    if (sp.spotifyConnected()) { try { found = await sp.searchTracks(q); } catch { found = await searchSongs(q); } } // Spotify = full song
    else found = await searchSongs(q);                                                                               // iTunes = 30 s
    ul.textContent = "";
    if (!found.length) ul.appendChild(mk("li", "empty", t("noResults")));
    found.forEach(s => {
      const li = mk("li", "item"), pick = mk("button", "pick simple");
      const thumb = mk("span", "thumb"); paint(thumb, s);
      const meta = mk("span", "meta"); meta.append(mk("b", "", s.title), mk("i", "", `${s.artist} — ${s.album}`));
      pick.append(thumb, meta, mk("span", "dur", "＋"));
      pick.onclick = () => { if (insert(s)) toast(t("added") + s.title); };
      li.appendChild(pick); ul.appendChild(li);
    });
  } catch (e) { console.error(e); ul.textContent = ""; toast(t("error")); }
}

async function runImport(fn: () => Promise<Song[]>) {
  try {
    const had = list.current, songs = await fn();
    songs.forEach(s => list.addLast(s));
    if (!had && list.current) loadCurrent(false); else renderLists();
    toast(t("imported").replace("{n}", String(songs.length)));
  } catch (e) { console.error(e); toast(String(e).includes("403") ? t("playlistLocked") : t("error")); }
}

function renderSpotifyChip() {
  const b = $("btn-sp");
  b.hidden = !sp.spotifyConfigured;
  b.textContent = !sp.spotifyConnected() ? t("spConnect") : sp.playerReady() ? `● ${t("spLive")}` : t("spConnecting");
  b.onclick = () => { if (!sp.spotifyConnected()) sp.spotifyLogin(); };
}

function renderImport() {
  renderSpotifyChip();
  const sb = $("sp-box"); sb.textContent = "";
  if (!sp.spotifyConfigured) sb.appendChild(mk("p", "hint", t("needKey")));
  else if (!sp.spotifyConnected()) { const b = mk("button", "btn pri", t("spConnect")); b.onclick = () => sp.spotifyLogin(); sb.appendChild(b); }
  else {
    const a = mk("button", "btn", t("importTracks")), b = mk("button", "btn", t("importAlbums")), c = mk("button", "btn", t("spLogout"));
    a.onclick = () => runImport(sp.importSavedTracks); b.onclick = () => runImport(sp.importSavedAlbums);
    c.onclick = () => { sp.spotifyLogout(); location.reload(); };
    sb.append(a, b, c);
  }
}

/** Lists the playlists and artists of the connected Spotify account. */
async function loadSpotifyLibrary() {
  if (!sp.spotifyConnected()) return;
  try {
    const pls = await sp.myPlaylists(), ul = $("pl-list"); ul.textContent = "";
    pls.forEach(p => {
      const li = mk("li", "item"), pick = mk("button", "pick simple");
      const thumb = mk("span", "thumb"); paint(thumb, { cover: p.cover } as Song);
      const meta = mk("span", "meta"); meta.append(mk("b", "", p.name), mk("i", "", `${p.total} ${t("songs")}`));
      pick.append(thumb, meta, mk("span", "dur", t("importOne")));
      pick.onclick = () => runImport(() => sp.importPlaylist(p.id));
      li.appendChild(pick); ul.appendChild(li);
    });
    $("pl-wrap").hidden = !pls.length;
  } catch (e) { console.error(e); }
  try {
    const names = await sp.followedArtists(), box = $("artists"); box.textContent = "";
    names.forEach(n => { const c = mk("button", "", n); c.onclick = () => { $<HTMLInputElement>("q").value = n; runSearch(n); }; box.appendChild(c); });
    $("artists-wrap").hidden = !names.length;
  } catch (e) { console.error(e); }
}

/** When the Spotify player is ready, links songs without a URI so they can be heard in full. */
async function upgradeToSpotify() {
  renderSpotifyChip();
  let n = list.head, count = 0;
  while (n && count < 40) {
    const s = n.data;
    if (!s.uri && s.source !== "local") { try { await sp.resolve(s); } catch { /* keep going */ } count++; }
    n = n.next;
  }
  renderLists();
  if (!isPlaying()) loadCurrent(false);
}

// ============================================================
// Persistence: the list (order and current song) is saved automatically in the browser
// ============================================================
const STORE = "playlist_v1";
let saveTimer = 0;
function saveState() { clearTimeout(saveTimer); saveTimer = window.setTimeout(saveNow, 300); }
function saveNow() {
  const songs: Song[] = []; let cur = -1;
  list.forEach((s, _i, node) => {
    if (s.source === "local") return;                        // uploaded files (blob:) don't survive closing the tab
    if (node === list.current) cur = songs.length;
    const { lyrics: _omit, ...rest } = s; songs.push(rest);  // lyrics are fetched again
  });
  try { localStorage.setItem(STORE, JSON.stringify({ v: 1, songs, current: cur })); } catch { /* storage full */ }
}
/** Returns true if a saved list existed (even an empty one). */
function loadState(): boolean {
  try {
    const d = JSON.parse(localStorage.getItem(STORE) || "null");
    if (!d || d.v !== 1 || !Array.isArray(d.songs)) return false;
    d.songs.forEach((s: Song) => list.addLast(s));
    const n = d.current >= 0 ? list.nodeAt(d.current) : null;
    if (n) list.current = n;
    return true;
  } catch { return false; }
}
window.addEventListener("pagehide", saveNow);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveNow(); });

/** Clears the list node by node (no arrays) and leaves the player blank. */
function clearList() {
  audio.pause(); if (mode === "spotify" && !spPaused) sp.sdk.pause();
  while (list.head) list.remove(list.head);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  loadCurrent(false);
  toast(t("cleared"));
}
let resetTimer = 0;
function disarmReset() { clearTimeout(resetTimer); const b = $("btn-reset"); b.classList.remove("armed"); b.textContent = t("resetList"); }
$("btn-reset").onclick = () => {                              // two steps to avoid accidental deletion
  const b = $("btn-reset");
  if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = t("resetSure"); resetTimer = window.setTimeout(disarmReset, 3000); return; }
  disarmReset(); clearList();
};

// ============================================================
// Control wiring
// ============================================================
$("btn-play").onclick = $("btn-playall").onclick = togglePlay;
$("btn-prev").onclick = goPrev;
$("btn-next").onclick = () => goNext(true);
$("btn-shuffle").onclick = () => { list.shuffle(); renderLists(); toast(t("shuffled")); };
$("btn-del").onclick = () => { if (list.current) removeNode(list.current); };
const seekEl = $<HTMLInputElement>("seek");
seekEl.onpointerdown = () => { seeking = true; };
seekEl.onpointerup = () => { seeking = false; };
seekEl.oninput = () => { setFill(seekEl); doSeek(Number(seekEl.value)); };
const volEl = $<HTMLInputElement>("vol");
volEl.oninput = () => { audio.volume = Number(volEl.value); sp.sdk.volume(Number(volEl.value)); setFill(volEl); };
$("add-where").onchange = () => { $("index-row").hidden = $<HTMLSelectElement>("add-where").value !== "index"; };
$("search-form").onsubmit = e => { e.preventDefault(); const q = $<HTMLInputElement>("q").value.trim(); if (q) runSearch(q); };
$<HTMLInputElement>("files").onchange = e => {
  const input = e.target as HTMLInputElement;
  for (const f of Array.from(input.files ?? []))
    insert({ id: newId(), title: f.name.replace(/\.[^.]+$/, ""), artist: t("localArtist"), album: "", audioUrl: URL.createObjectURL(f), source: "local" });
  input.value = "";
};
// Remove when finished (remembered)
$<HTMLInputElement>("auto-remove").checked = localStorage.getItem("autoRemove") !== "0";
$<HTMLInputElement>("auto-remove").onchange = e => localStorage.setItem("autoRemove", (e.target as HTMLInputElement).checked ? "1" : "0");

// Full screen with the cover art (controls appear when the mouse moves)
const fsEl = $("fs"); let fsTimer = 0;
const pokeFs = () => { fsEl.classList.add("show"); clearTimeout(fsTimer); fsTimer = window.setTimeout(() => fsEl.classList.remove("show"), 2800); };
const closeFs = () => { fsEl.hidden = true; if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
$("btn-fs").onclick = async () => { fsEl.hidden = false; pokeFs(); renderNow(); try { await fsEl.requestFullscreen(); } catch { /* stays as an in-page overlay */ } };
fsEl.onmousemove = fsEl.onclick = pokeFs;
$("fs-close").onclick = closeFs;
$("fs-prev").onclick = goPrev; $("fs-next").onclick = () => goNext(true); $("fs-play").onclick = togglePlay;
const fsSeek = $<HTMLInputElement>("fs-seek");
fsSeek.onpointerdown = () => { seeking = true; }; fsSeek.onpointerup = () => { seeking = false; };
fsSeek.oninput = () => { setFill(fsSeek); doSeek(Number(fsSeek.value)); };
document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement) fsEl.hidden = true; });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !fsEl.hidden) closeFs(); });

// Theme, palette and language (remembered between sessions)
const PALETTES = ["aurora", "dusk", "lagoon"];
function applyTheme(th: string) { document.documentElement.dataset.theme = th; localStorage.setItem("theme", th); }
function applyPalette(p: string) { document.documentElement.dataset.palette = p; localStorage.setItem("palette", p); }
$("btn-theme").onclick = () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
$("btn-palette").onclick = () => applyPalette(PALETTES[(PALETTES.indexOf(document.documentElement.dataset.palette!) + 1) % PALETTES.length]);
$("btn-lang").onclick = () => {
  disarmReset(); setLang(getLang() === "es" ? "en" : "es"); $("btn-lang").textContent = getLang().toUpperCase();
  applyI18n(); renderNow(); renderLists(); renderImport(); setPlayingUI(); loadSpotifyLibrary(); artistFor = ""; loadArtist(list.current?.data.artist ?? "");
};

// ============================================================
// Startup
// ============================================================
(async function init() {
  applyTheme(localStorage.getItem("theme") ?? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));
  applyPalette(localStorage.getItem("palette") ?? "aurora");
  $("btn-lang").textContent = getLang().toUpperCase();
  applyI18n(); initTabs("stage"); initTabs("lib");
  volEl.value = "0.8"; setFill(volEl);

  // Sample songs: audio and cover art are looked up automatically (Spotify if logged in; otherwise iTunes)
  if (!loadState())                                           // first visit: sample songs
    [["Blinding Lights", "The Weeknd"], ["Levitating", "Dua Lipa"], ["Viva la Vida", "Coldplay"], ["Despacito", "Luis Fonsi"]]
      .forEach(([title, artist]) => list.addLast({ id: newId(), title, artist, album: "", source: "seed" }));
  loadCurrent(false);
  let pending = 0; list.forEach(s => { if (!s.cover && !s.uri && pending++ < 12) hydrate(s).then(renderLists); });

  const justLoggedIn = await sp.spotifyHandleRedirect();
  renderImport();
  if (sp.spotifyConnected()) {
    if (justLoggedIn) { selectTab("lib", "import"); toast(t("spotifyOk")); }
    loadSpotifyLibrary();
    sp.initPlayer(onSpotifyState, m => { console.warn(m); if (!m.startsWith("auth")) toast(t("spPlayErr")); }).then(upgradeToSpotify);
  }
})();
