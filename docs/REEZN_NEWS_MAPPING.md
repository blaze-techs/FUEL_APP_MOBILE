# Reezn TV (APK) reverse-engineering → News tab mapping

Source analysed: `reezn.apk` (36,312,116 bytes, valid ZIP). Unzipped to 2,682
entries and statically analysed (no device execution). This document records
what the app IS and, more importantly, how each of its features was mapped onto
the existing FuelPro **News** tab without duplicating any player.

## App identity

| Property | Value |
|---|---|
| App name | Reezn TV |
| Package | `com.rmedia.rplayer` |
| versionName | 2.0.19 |
| Cleartext traffic | allowed |
| Domain | `reezntvapp.com` |
| Backend hosts | `api.rmedia.live`, `api.cardinal-kingd.store`, `api.ott-topred.site` |

### Native + protection

- **Native libs**: `libffmpegJNI.so`, `libreezn.so`, `librzcore.so`
  (armeabi-v7a, arm64-v8a, x86, x86_64).
- **Packer**: ApkDex2C-Pro v3.1.50 (ProtectTime 2026-09-14); obfuscation assets
  `assets/OoooooOooo`, `assets/d_shell_data_001`.
- **HTTP/player classes**: `ReeznHttpClient`, `ReeznPlayer`, `ReeznPinNative`,
  `ReeznLog`, `ReeznApp`, `Reezn-Client`. Firebase Messaging service present.
- **Media stack**: AndroidX Media3 / ExoPlayer with HLG/PQ (HDR) shaders +
  ffmpeg JNI; plus 50+ site-specific "extractor" classes (VixSrc, VidLink,
  TwoEmbed, Cuevana, StreamingCommunity, Anime variants, …).

### Backend responsiveness (probed live from this environment)

`api.rmedia.live`, `api.cardinal-kingd.store` → connection failure (000).
`api.ott-topred.site` → HTTP 502. `reezntvapp.com` serves 200 for the site but
`/api/v3/` is 404.

**Conclusion: the Reezn backend is not reachable.** Porting its endpoints would
have produced a broken feature. The correct move was to replicate its *feature
set* on FuelPro's working sources (movies catalog, tvgarden + iptv-org live
channels, on-device caption engine).

## Feature surface observed in the APK

Bottom navigation: **Home, Movies, TV Shows, Live TV, Sports, My List.**
Supporting features: Discover (filter/sort), Coming Up (upcoming), Downloads
(offline), Actor pages + Similar titles, Subtitles (embedded + external),
Watchlist/Favorites, Watch progress, TMDB enrichment, Sports push, Playlists,
AppConfig/fallback domains, Preferences.

## Mapping to the FuelPro News tab

Every row below reuses an EXISTING FuelPro player and cloud key — no second
source of truth. The sub-tab ids are pinned by
`src/test/reezn-news-parity.test.ts` and declared in
`src/react-app/config/subtab-registry.ts`.

| Reezn surface | FuelPro News sub-tab | Implementation |
|---|---|---|
| Home / Movies | `movies` | `MoviesEmbed` (catalog, `initialType="movie"`) |
| TV Shows | `series` | `MoviesEmbed` catalog, `initialType="tv"` |
| My List / Watchlist | `my-list` | `MoviesEmbed` library surface (favorites + watchlist + continue watching, cloud) |
| Discover | `discover` | `MoviesEmbed` browse/genre/sort over the live catalog |
| Coming Up | `coming-up` | `MoviesEmbed` `/api/movies?mode=browse&slider=latest` feed |
| Live TV | `live-tv` | `LiveFeedEmbed` (tvgarden + iptv-org, 13k+ channels) |
| Live Radio | `live-radio` | `LiveFeedEmbed` radio family |
| Sports | `sports` | `LiveFeedEmbed` `defaultCategory="sports"` |
| Preferences | `player-settings` | `PlayerSettingsPanel` (autoplay, captions, data saver, auto-next) |
| Subtitles | (in-player CC) | embedded HLS tracks + on-device Whisper/Web-Speech captions with translation |
| Watch progress | (library) | `movie_history` → Continue Watching |
| Actor / Similar | (detail modal) | cast + related titles in the Movies detail view |
| Downloads | (out of scope) | a browser/WebView app cannot register Android DownloadManager; the offline path is cloud cache + PWA |

## Preference keys (single source of truth)

`PlayerSettingsPanel` writes the SAME keys the players read, so a change there
takes effect immediately, everywhere, cross-device:

- `movie_auto_next` — MoviesEmbed AUTO ON/OFF.
- `live_feed_autoplay` — LiveFeedEmbed autoplay gate (now consumed: play calls
  are wrapped in `if (autoStart)`).
- `live_feed_subtitle_lang` — preferred caption language for Movies + Live TV/
  Radio.
- `movie_data_saver` — applied as a real `capLevelToPlayerSize` cap in the
  Movies hls.js instance.

## How to re-verify

```
npx vitest run src/test/reezn-news-parity.test.ts
npx vitest run src/test/subtab-registry.test.ts
```

The parity test fails if a sub-tab loses its render branch, its SubTabBar
entry, its registry declaration, or if a preference key stops being shared.
