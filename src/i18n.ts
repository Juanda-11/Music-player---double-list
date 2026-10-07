// Interface texts in Spanish and English. Used through data-i18n / data-i18n-ph / data-i18n-label in the HTML.
export type Lang = "es" | "en";

const D: Record<Lang, Record<string, string>> = {
  es: {
    app: "Mi reproductor", lang: "Idioma", theme: "Tema claro / oscuro",
    disc: "Disco", lyrics: "Letra", queue: "Lista", albums: "Álbumes", add: "Agregar", imp: "Importar",
    prev: "Anterior", play: "Reproducir", pause: "Pausar", next: "Siguiente", shuffle: "Aleatorio",
    delCurrent: "Eliminar canción", volume: "Volumen", seek: "Posición de la canción",
    idle: "Sin canciones", idleHint: "Busca o importa música para empezar", preview: "Vista previa de 30 s (iTunes)",
    songs: "canciones", empty: "La lista está vacía.", remove: "Quitar", noAlbum: "Sin álbum",
    search: "Buscar canciones", searchPh: "¿Qué quieres escuchar?", go: "Buscar", noResults: "Sin resultados.",
    position: "Posición al agregar", first: "Al inicio", last: "Al final", atIndex: "En un índice", index: "Índice (desde 0)",
    local: "Subir archivos de audio", localHint: "MP3, WAV, M4A… se reproducen completos.", localArtist: "Archivo local",
    lyricsLoading: "Buscando letra…", lyricsNone: "No encontramos la letra de esta canción.",
    connect: "Conectar con Spotify", importTracks: "Importar canciones guardadas", importAlbums: "Importar álbumes guardados",
    artists: "Artistas que sigues", needKey: "Falta la clave en el archivo .env (ver README).",
    added: "Agregada: ", removed: "Eliminada: ", shuffled: "Lista reordenada al azar.", atStart: "Ya estás en la primera canción.",
    atEnd: "Ya estás en la última canción.", wrapped: "Fin de la lista: vuelve al inicio.", badIndex: "Índice inválido.",
    imported: "{n} canciones importadas.", error: "Algo salió mal. Revisa la consola del navegador.",
    noAudio: "No se encontró audio para esta canción.", spotifyOk: "Spotify conectado.",
    listTitle: "Mi lista", colTitle: "Título", colAlbum: "Álbum", palette: "Paleta de colores",
    spConnect: "Conectar Spotify", spConnecting: "Conectando Spotify…", spLive: "Spotify activo", spLogout: "Desconectar",
    playlists: "Tus playlists de Spotify (toca una para importarla)", importOne: "Importar",
    spPlayErr: "Spotify no pudo reproducir. Revisa que la cuenta sea Premium y que Widevine esté activo.",
    playlistLocked: "Spotify solo permite leer playlists propias o colaborativas.", min: "min",
    artistTitle: "Sobre el artista", noBio: "No hay información disponible de este artista.", wiki: "Wikipedia · leer más",
    moreFrom: "Más de {a}", fullscreen: "Pantalla completa", exitFull: "Salir", removeDone: "Quitar al terminar",
    dragHint: "Mantén presionada una canción y arrástrala para colocarla donde quieras.",
    resetList: "Vaciar lista", resetSure: "¿Seguro? Pulsa de nuevo", cleared: "Lista vaciada.",
    finished: "Terminó y salió de la lista: ", similar: "Artistas parecidos", close: "Cerrar", albumsBar: "Álbumes",
  },
  en: {
    app: "My player", lang: "Language", theme: "Light / dark theme",
    disc: "Disc", lyrics: "Lyrics", queue: "Queue", albums: "Albums", add: "Add", imp: "Import",
    prev: "Previous", play: "Play", pause: "Pause", next: "Next", shuffle: "Shuffle",
    delCurrent: "Delete song", volume: "Volume", seek: "Song position",
    idle: "No songs", idleHint: "Search or import music to get started", preview: "30 s preview (iTunes)",
    songs: "songs", empty: "The playlist is empty.", remove: "Remove", noAlbum: "No album",
    search: "Search songs", searchPh: "What do you want to play?", go: "Search", noResults: "No results.",
    position: "Insert position", first: "At the start", last: "At the end", atIndex: "At an index", index: "Index (from 0)",
    local: "Upload audio files", localHint: "MP3, WAV, M4A… play in full.", localArtist: "Local file",
    lyricsLoading: "Looking for lyrics…", lyricsNone: "No lyrics found for this song.",
    connect: "Connect to Spotify", importTracks: "Import saved songs", importAlbums: "Import saved albums",
    artists: "Artists you follow", needKey: "Key missing in the .env file (see README).",
    added: "Added: ", removed: "Removed: ", shuffled: "Playlist shuffled.", atStart: "You're at the first song.",
    atEnd: "You're at the last song.", wrapped: "End of playlist: back to the start.", badIndex: "Invalid index.",
    imported: "{n} songs imported.", error: "Something went wrong. Check the browser console.",
    noAudio: "No audio found for this song.", spotifyOk: "Spotify connected.",
    listTitle: "My playlist", colTitle: "Title", colAlbum: "Album", palette: "Color palette",
    spConnect: "Connect Spotify", spConnecting: "Connecting Spotify…", spLive: "Spotify live", spLogout: "Disconnect",
    playlists: "Your Spotify playlists (tap one to import it)", importOne: "Import",
    spPlayErr: "Spotify couldn't play. Check the account is Premium and Widevine is enabled.",
    playlistLocked: "Spotify only lets apps read playlists you own or collaborate on.", min: "min",
    artistTitle: "About the artist", noBio: "No information available for this artist.", wiki: "Wikipedia · read more",
    moreFrom: "More from {a}", fullscreen: "Full screen", exitFull: "Exit", removeDone: "Remove when finished",
    dragHint: "Press and hold a song, then drag it wherever you like.",
    resetList: "Clear list", resetSure: "Sure? Press again", cleared: "Playlist cleared.",
    finished: "Finished and left the playlist: ", similar: "Similar artists", close: "Close", albumsBar: "Albums",
  },
};

let lang: Lang = (localStorage.getItem("lang") as Lang) || (navigator.language.startsWith("en") ? "en" : "es");
export const getLang = () => lang;
export const t = (k: string) => D[lang][k] ?? k;
export function setLang(l: Lang) { lang = l; localStorage.setItem("lang", l); }

/** Translates every marked element in the HTML. */
export function applyI18n() {
  document.documentElement.lang = lang;
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach(e => (e.textContent = t(e.dataset.i18n!)));
  document.querySelectorAll<HTMLInputElement>("[data-i18n-ph]").forEach(e => (e.placeholder = t(e.dataset.i18nPh!)));
  document.querySelectorAll<HTMLElement>("[data-i18n-label]").forEach(e => {
    e.setAttribute("aria-label", t(e.dataset.i18nLabel!)); e.title = t(e.dataset.i18nLabel!);
  });
}
