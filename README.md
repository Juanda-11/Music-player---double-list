# Reproductor de música · Lista doblemente enlazada (TypeScript + Vite)

## Ejecutarlo en VS Code
1. Instala [Node.js 18+](https://nodejs.org). Descomprime y abre la carpeta `music-player` en VS Code.
2. En la terminal: `npm install` y luego `npm run dev`.
3. Abre **http://127.0.0.1:5173/** (esa dirección exacta, no `localhost`).

## Qué trae
- **Izquierda:** disco/letra, controles, botón ⛶ de pantalla completa (portada) y tarjeta del artista (foto, género, biografía de Wikipedia, más canciones suyas).
- **Centro:** lista de reproducción (la lista doblemente enlazada). **Presiona una canción y arrástrala** para colocarla donde quieras (en pantalla táctil, mantenla presionada ~0,3 s). Agregar al inicio / final / índice. Al terminar, la canción sale de la lista (opción "Quitar al terminar"). La lista y la canción actual **se guardan solas** en el navegador y vuelven al abrir de nuevo; el botón **Vaciar lista** (con confirmación) la deja en blanco para empezar de cero. Los archivos de audio subidos desde tu computador no se guardan (el navegador no conserva su enlace al cerrar).
- **Derecha:** barra de álbumes que se despliega con el mouse y resalta el álbum de la canción actual.

## Spotify (reproducción completa, requiere Premium)
En [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) → tu app → Settings:
- Redirect URIs: `http://127.0.0.1:5173/` (local) y `https://TU-PROYECTO.vercel.app/` (producción, con la barra final).
- Marca *Web API* y *Web Playback SDK*.
- Brave/Linux sin sonido: activa Widevine en `brave://settings/extensions`.
- Development Mode (feb-2026): solo el dueño de la app + hasta 5 usuarios autorizados (Settings → User management), todos con Premium.

## Publicar en Vercel
1. Sube la carpeta a un repositorio de GitHub (el `.gitignore` ya excluye `node_modules`, `dist` y `.env`).
2. En [vercel.com](https://vercel.com) → *Add New Project* → importa el repositorio. Vercel detecta Vite solo (`vercel.json` ya fija: build `npm run build`, salida `dist`).
3. Variables de entorno (opcionales): `VITE_SPOTIFY_CLIENT_ID` (si no la pones, usa la del código) y `VITE_LASTFM_API_KEY`. Si las cambias, haz *Redeploy*.
4. Agrega la URL final de Vercel como Redirect URI en Spotify (ver arriba). Usa el dominio de producción, no las URLs de *preview*.

## Opcional: artistas parecidos
Clave gratuita en [last.fm/api](https://www.last.fm/api) → `VITE_LASTFM_API_KEY`.

## Sin Spotify
Búsqueda con iTunes (fragmentos de 30 s) y subida de tus propios MP3/WAV/M4A (completos, con letra sincronizada).

## Estructura
```
src/
├─ main.ts                       # Controlador
├─ i18n.ts                       # Español / Inglés
├─ structures/Node.ts · DoublyLinkedList.ts   # La estructura de datos (sin arreglos)
├─ models/Song.ts
├─ services/ catalog.ts · spotify.ts · artistInfo.ts
└─ styles/main.css
```
