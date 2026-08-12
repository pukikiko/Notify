# Notify

A private, streaming music webapp. Music is **pulled from the Soulseek network**,
stored in a **local shared cache**, transcoded on demand to each user's preferred format,
enriched with **Spotify** metadata, and streamed to any number of accounts.

## Features

- **Accounts** — register/login, per-user settings (preferred format), sessions
- **Library** — like tracks, artists and albums
- **Playlists** — create, rename, reorder-friendly ordering, add/remove tracks
- **Radio** — start from a **track, artist, album or playlist**; Notify builds a
  station from genre-tag similarity, same-artist/same-album affinity and Spotify
  "related artists". Stations extend themselves forever as you play.
- **Soulseek downloads** — search an artist/album/song; Spotify resolves it and the
  correct file is picked and downloaded into the shared cache automatically on play
- **Multi-source failover** — if a track can't be found on Soulseek (or the download
  fails), Notify falls back to **YouTube Music**, then **SoundCloud**, via yt-dlp
  so the track still plays
- **Shared transcoding cache pool** — the original file is cached once; each streamed
  format (MP3 320/192, Ogg Vorbis, Opus, FLAC passthrough) is transcoded once with
  ffmpeg and reused by *all* users who select that format
- **Streaming** — HTTP range requests, HTML5 `<audio>` player, shuffle/repeat/seek/volume
- **Metadata** — embedded tags + cover art extracted from files, then enriched from
  Spotify (genres, related artists, release year, album art)

## Quick start (offline / no Soulseek account)

The app ships with a `mock` Soulseek backend that synthesizes audio with ffmpeg, so the
whole pipeline works end-to-end without network access.

```bash
npm --prefix backend install
npm --prefix frontend install

# terminal 1 — backend (mock mode is the default)
npm run dev:backend

# terminal 2 — frontend dev server (proxies /api to :4000)
npm run dev:frontend
```

Open http://localhost:5173, create an account, go to Search, and hit play on any artist, album
or song. Spotify resolves the query and the song is downloaded & cached automatically —
no manual downloads (a plain search with no query browses the whole mock catalog).

Or run it fully built (backend serves the frontend):

```bash
npm install  # no-op, see below
npm --prefix backend install
npm --prefix frontend install
npm start    # builds frontend, serves everything on http://localhost:4000
```

## Docker

The repo ships a `Dockerfile` and `docker-compose.yml` that run the whole app —
backend, built frontend, and a bundled [slskd](https://github.com/slskd/slskd)
daemon (so the real Soulseek network works out of the box). The image bundles
`ffmpeg` and a self-contained `yt-dlp` binary (the `yt-dlp_linux` build, which
needs no Python), so the YouTube Music / SoundCloud failover works out of the
box. `data/`, `node_modules/` and other local artifacts are excluded from the
build context via `.dockerignore`.

```bash
# first run: create the cache directories slskd requires (it refuses to start without them)
mkdir -p data/cache/original data/cache/incomplete

docker compose up --build
```

Open http://localhost:4000 and register an account. slskd is exposed on
:5030 (API) / :5031 (UI) / :50300 (Soulseek peer connections), and downloads
land in `data/cache/original` — the same cache the backend streams from.

Configuration comes from your environment (or a `.env` file next to
`docker-compose.yml`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `SLSKD_USERNAME` / `SLSKD_PASSWORD` | — | Soulseek network credentials for slskd |
| `SLSKD_API_KEY` | — | API key used by the backend to talk to slskd (required for real-network mode) |
| `SLSKD_URL` | `http://slskd:5030` | slskd API base (compose-internal hostname) |
| `SOULSEEK_MODE` | `slskd` | `slskd` (real network, compose default) or `mock` (offline demo) |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | — | Spotify metadata + artwork |
| `PORT` | `4000` | host port mapped to the backend |
| `YOUTUBE_ENABLED` / `SOUNDCLOUD_ENABLED` | `true` | yt-dlp web failover sources |
| `YTDLP_PATH` | `yt-dlp` | path to the yt-dlp binary (in Docker it's on `PATH` at `/usr/local/bin/yt-dlp`) |

Set the Soulseek credentials and an API key, then:

```bash
# .env next to docker-compose.yml (git-ignored)
SLSKD_USERNAME=you
SLSKD_PASSWORD=yourpass
SLSKD_API_KEY=$(openssl rand -hex 24)
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret

docker compose up --build
```

`DATA_DIR` is fixed to the `./data` bind mount in the compose file, so the DB and
cache persist across container restarts. For a fully offline demo, override the
mode:

```bash
SOULSEEK_MODE=mock docker compose up --build
```

## Using the real Soulseek network

Notify talks to [slskd](https://github.com/slskd/slskd), the self-hosted Soulseek
daemon, over its HTTP API. You need a Soulseek account (username/password); a fresh
username is usually accepted by the server.

```bash
# 1. download slskd + write config (uses SLSKD_USERNAME / SLSKD_PASSWORD if set)
SLSKD_USERNAME=you SLSKD_PASSWORD=yourpass npm run setup

# 2. start slskd + the backend together (reads bin/api-key.txt automatically)
npm run dev:slskd
```

or manually:

```bash
bin/slskd-*/slskd --config bin/slskd.yml      # downloads land in data/cache/original
SOULSEEK_MODE=slskd SLSKD_API_KEY=$(cat bin/api-key.txt) node backend/src/index.js
```

Soulseek UI is at http://localhost:5031 (notify/notify); the API listens on :5030.

## Spotify metadata (search + artwork)

Discovery search, artist/album pages and background enrichment are powered by the
**Spotify Web API** (Client Credentials flow — no user login, and audio is never
touched; it only resolves metadata, artwork and related artists).

1. Create a free app at https://developer.spotify.com/dashboard (Settings → show
   Client ID + Client secret).
2. Export the credentials:

```bash
export SPOTIFY_CLIENT_ID=your_client_id
export SPOTIFY_CLIENT_SECRET=your_client_secret
```

Discovery and enrichment silently degrade (raw Soulseek search fallback) if the
credentials are missing or Spotify is unreachable.

## Web failover (YouTube Music + SoundCloud via yt-dlp)

When Soulseek has no usable result for a track (or a queued transfer fails), the
backend falls back to **YouTube Music**, then **SoundCloud**, via
[yt-dlp](https://github.com/yt-dlp/yt-dlp): the best-matching audio stream is
downloaded into the same shared cache and streamed exactly like a Soulseek
download. Metadata (title, artist, duration, thumbnail) comes directly from each
platform's search results, so obscure tracks that aren't on Spotify still get
cover art and correct tags. This works for single tracks and for the tracks of a
partially-available album.

Discovery search follows the same priority: Spotify is asked first, but its fuzzy
search returns *something* for almost any query — even when it doesn't actually
have the track. If the top Spotify results don't cover the query's significant
tokens (e.g. "madeon pop culture" only surfaces other artists' "Pop Culture"
tracks), the query counts as not-found and the Soulseek catalog plus YouTube Music
and SoundCloud tracks take over — web results only ever appear when Spotify
couldn't match your query. An artist query is also not allowed to hijack an
"artist + title" search (a "Pop Culture" artist page must not swallow
"madeon pop culture"), and genre words like "synthwave" / "indie folk" never
trigger the fallback. Queries that ask for a specific **version or remix**
(nightcore, remix, cover, mashup, slowed, ...) always include YouTube Music /
SoundCloud results too, since that kind of content lives mostly on YouTube and
SoundCloud. Tune the strictness with `DISCOVER_COVERAGE_MIN`.

Install yt-dlp (macOS: `brew install yt-dlp`, Debian/Ubuntu: `sudo apt install yt-dlp`,
Windows: `winget install yt-dlp.yt-dlp`) and make sure `ffmpeg` is available for
transcoding. No configuration is required — it's enabled by default and only used as a
fallback. Disable each source with `YOUTUBE_ENABLED=false` / `SOUNDCLOUD_ENABLED=false`.

> Note: when running locally, install the **standalone `yt-dlp`** or the self-contained
> `yt-dlp_linux` binary — the plain `yt-dlp` download from the GitHub releases page is a
> Python zipapp and will not run unless `python3` is on the system. The Docker image uses
> the `yt-dlp_linux` binary precisely so it works without Python inside the container.

## Requirements

- **Node.js ≥ 22** (the backend uses the built-in `node:sqlite` module — no native deps)
- **ffmpeg / ffprobe** on `PATH` (mock audio synthesis + transcoding)
- **yt-dlp** on `PATH` (optional; only used for the YouTube Music / SoundCloud failover)

Platform support:

- **Mock mode** (the default) works on any platform Node.js runs on.
- The **real Soulseek network** needs the [slskd](https://github.com/slskd/slskd) daemon,
  which ships binaries for **macOS and Linux** only (x64 + arm64); `npm run setup`
  downloads the correct build for the current machine and `scripts/dev-slskd.sh` locates
  it automatically. On Windows, run slskd yourself (e.g. WSL or Docker) and point Notify
  at it with `SLSKD_URL`.

## Architecture

```
┌────────────────────────┐     HTTP/JSON      ┌──────────────────────┐
│  React SPA (Vite)      │ ─────────────────► │  Express backend      │
│  search / library /    │   /api/*           │  auth · library ·     │
│  playlists / radio     │ ◄───────────────── │  playlists · radio    │
└────────────────────────┘     audio+range    │  streaming · settings │
                                              └──────────┬───────────┘
                    ┌──────────────┬─────────────────────┼──────────────────┐
                    ▼              ▼                     ▼                  ▼
          ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  ┌──────────────┐
          │ Soulseek     │  │ Spotify      │  │ ffmpeg transcode │  │ SQLite       │
          │ (slskd /     │  │ metadata +   │  │ shared cache     │  │ users/tracks/│
          │ mock)        │  │ cover art    │  │ data/cache/      │  │ likes/...    │
          └──────────────┘  └──────────────┘  │ transcoded/<hash>│  └──────────────┘
                                               └──────────────────┘
```

Key modules (`backend/src`):

| File | Role |
| --- | --- |
| `soulseek.js` | slskd REST client + offline mock that synthesizes audio |
| `downloader.js` | download queue, ingest, artist/album/track upserts |
| `metadata.js` | embedded tag/cover extraction + Spotify enrichment |
| `transcoder.js` | ffmpeg transcoding, single-flight, shared across users |
| `web.js` | YouTube Music + SoundCloud via yt-dlp (search, rank, download) |
| `radio.js` | station generation from track/artist/album/playlist seeds |
| `routes/stream.js` | Range-enabled audio streaming |
| `db.js` | `node:sqlite` schema (no native deps) |

The cache pool lives in `data/cache`:
- `original/<id>.<ext>` — the raw Soulseek download (shared by everyone)
- `transcoded/<hash>.<ext>` — one per (source, format); reused by all users
- `art/` — extracted covers

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `4000` | backend port |
| `DATA_DIR` | `./data` | where the DB and cache live |
| `SOULSEEK_MODE` | `mock` | `mock` or `slskd` |
| `SLSKD_URL` | `http://127.0.0.1:5030` | slskd API base |
| `SLSKD_API_KEY` | — | slskd API key |
| `SLSKD_API_USERNAME` / `SLSKD_API_PASSWORD` | — | basic-auth fallback for slskd API |
| `SLSKD_DOWNLOAD_START_TIMEOUT_MS` | `60000` | fall back to YouTube Music/SoundCloud if a Soulseek transfer hasn't started within this window |
| `SOULAR_MIN_MATCH_RATIO` | `0.8` | filename match ratio a track must score to be selected |
| `SOULAR_MIN_ARTIST_SCORE` | `0.6` | how well a candidate file/directory must mention the artist (prevents wrong-artist downloads) |
| `SOULAR_ALLOWED_FILETYPES` | `flac 24/192,flac 16/44.1,flac,mp3 320,mp3` | quality tiers tried in order |
| `SOULAR_PREPEND_ARTIST` | `true` | include the artist in Soulseek search queries |
| `SOULAR_IGNORED_USERS` | — | comma-separated peers never selected as sources |
| `SOULAR_SEARCH_BLACKLIST` | — | words stripped out of Soulseek queries |
| `SOULAR_SEARCH_TIMEOUT_MS` | `5000` | slskd search collection window (ms) before results are polled |
| `SOULAR_MAX_PEER_QUEUE` | `50` | peers with a longer queue than this are skipped |
| `SOULAR_MIN_PEER_UPLOAD_SPEED` | `0` | peers with a slower average upload than this (kbps) are skipped |
| `SOULAR_ASSUMED_UPLOAD_SPEED_KBPS` | `100` | assumed upload speed (kbps) for peers that don't advertise one; used when ranking candidates |
| `SOULAR_MAX_ALTERNATE_SOURCES` | `5` | extra Soulseek candidates kept as fallbacks before falling back to YouTube Music/SoundCloud |
| `MOCK_DURATION` | `45` | seconds of audio per mock download |
| `MOCK_DOWNLOAD_MS` | `2500` | simulated download time |
| `SPOTIFY_CLIENT_ID` | — | Spotify API client ID (discovery/enrichment) |
| `SPOTIFY_CLIENT_SECRET` | — | Spotify API client secret |
| `DISCOVER_COVERAGE_MIN` | `0.8` | minimum fraction of a query's significant tokens the top Spotify results must cover to count as "found on Spotify"; below it the search falls back to catalog + YouTube Music/SoundCloud |
| `YOUTUBE_ENABLED` | `true` | enable the YouTube Music (yt-dlp) failover source |
| `YTDLP_PATH` | `yt-dlp` | path to the yt-dlp binary |
| `YTDLP_SEARCH` | `ytsearch` | search engine prefix (`ytsearch` or `ytmsearch`) |
| `YTDLP_MAX_RESULTS` | `6` | candidates evaluated per search |
| `YTDLP_TIMEOUT_MS` | `30000` | per-search timeout |
| `YTDLP_DOWNLOAD_TIMEOUT_MS` | `600000` | timeout for the actual audio download |
| `SOUNDCLOUD_ENABLED` | `true` | enable the SoundCloud (yt-dlp) failover source |
| `SOUNDCLOUD_MAX_RESULTS` | `6` | candidates evaluated per SoundCloud search |
| `SOUNDCLOUD_TIMEOUT_MS` | `30000` | per-SoundCloud-search timeout |
| `SOUNDCLOUD_DOWNLOAD_TIMEOUT_MS` | `600000` | timeout for the actual SoundCloud audio download |
