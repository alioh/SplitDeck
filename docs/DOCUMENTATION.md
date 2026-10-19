# SplitDeck documentation

SplitDeck is a small local web app. A Node.js server runs on your computer and serves a web page. You open that page in your browser and paste links; each link becomes a player. Only the video is shown.

## Contents

1. [Requirements](#1-requirements)
2. [Installation](#2-installation)
3. [Running](#3-running)
4. [Using SplitDeck](#4-using-splitdeck)
5. [Layouts and resizing](#5-layouts-and-resizing)
6. [Player controls](#6-player-controls)
   - [6a. Phones and tablets](#6a-phones-and-tablets)
7. [The Live browser](#7-the-live-browser)
8. [YouTube: clean player and YouTube's player](#8-youtube-clean-player-and-youtubes-player)
9. [Saved data and reset](#9-saved-data-and-reset)
10. [Keyboard shortcuts](#10-keyboard-shortcuts)
11. [Supported sites](#11-supported-sites)
12. [Configuration](#12-configuration)
13. [HTTP API](#13-http-api)
14. [How it works](#14-how-it-works)
15. [Project structure](#15-project-structure)
16. [Troubleshooting](#16-troubleshooting)
17. [Limitations](#17-limitations)
18. [Privacy and security](#18-privacy-and-security)
19. [Third-party components](#19-third-party-components)

---

## 1. Requirements

| Requirement | Notes |
|---|---|
| Node.js 18 or newer | Uses the built-in `fetch`. No npm packages are needed. |
| yt-dlp | Downloaded for you by `npm run setup`, or use your own copy (see [Configuration](#12-configuration)). |
| `curl` | Used for Kick requests. Included with Windows 10/11, macOS and most Linux systems. |
| A modern browser | Chrome, Edge, Brave, Firefox or Safari. |

## 2. Installation

```bash
git clone https://github.com/alioh/SplitDeck.git
cd SplitDeck
npm run setup
```

`npm run setup` downloads the right yt-dlp binary for your system into `bin/`. The binary is not stored in the repository. You only need to do this once.

To update yt-dlp later, run `npm run setup` again (it overwrites the old copy). Sites change often, and an out-of-date yt-dlp is the most common cause of a link that stops working.

## 3. Running

```bash
npm start
```

Open <http://localhost:8787>.

On Windows, `start.bat` does the same and also downloads yt-dlp first if it is missing, then opens your browser. Close its window to stop the server.

The server listens on `127.0.0.1` only, so it is not reachable from other computers.

## 4. Using SplitDeck

### Adding players

- Paste a link into the top bar and press **Enter** or click **+ Add**.
- You can paste several links at once, separated by spaces or new lines.
- The limit is **8 players**. The counter at the top shows how many are in use.
- A player is created only when you add one, so with 3 links you see exactly 3 players.

The first player you add has sound. Later players start muted so they do not talk over each other. Change this with each player's volume controls.

### Top bar

| Control | What it does |
|---|---|
| Link box and **+ Add** | Adds players. |
| Counter (`3 / 8`) | Players in use. |
| **Live** | Opens the Live browser ([section 7](#7-the-live-browser)). |
| **Layout** | Choose an arrangement ([section 5](#5-layouts-and-resizing)). |
| **All** (speaker) | Mutes or unmutes every player. |
| **Reset** | Closes everything and starts fresh ([section 9](#9-saved-data-and-reset)). |
| **Hide UI** | Hides the top bar so only video remains. |

### Hiding the interface

Click **Hide UI** (or press **H**) to hide the top bar. To bring it back:

- click the faint **Show UI** button in the top-right corner, or
- press **H** or **Esc**, or
- move the mouse to the very top edge of the window, or
- press **/** (also focuses the link box).

## 5. Layouts and resizing

### Layouts

The **Layout** menu shows a preview of every arrangement available for the current number of players. The options change with the count. Examples:

- **Grid** and **Grid (flipped)**
- **Big left / right / top / bottom**: one large player with the rest in a strip or column
- **2 | 3** or **2 / 3**: players split into two groups (columns or rows)
- **Small left / top**: one small player, the others large
- **Row** and **Column**

Your choice is remembered per player count.

### Swapping players

Each player has a **⋮⋮** handle at the top left. Drag it and drop it on another player to swap their positions (on a touch screen, press and drag the handle). The players keep playing while they move. The **★ Main** button swaps a player into the first (usually largest) position.

### Resizing

Every split has a divider between players. Drag a divider to make one side bigger and the other smaller. Double-click a divider to reset that split to its default size. Sizes are remembered per layout.

## 6. Player controls

Hover a player to show its controls (on a touch screen, tap it). They fade after a moment of stillness.

### Top bar of a player

| Control | What it does |
|---|---|
| **⋮⋮** | Drag handle for swapping. |
| **↗** | Opens the original page in a new tab. |
| Title | Name of the stream or video, with a **LIVE** badge when live. |
| **★ Main** | Moves this player to the main position. |
| **⤢** | Switches between *fit* (whole picture visible) and *fill* (crops to fill the player). |
| **⟳** | Reloads the player. |
| **⛶** | Fullscreen for this player. Double-clicking the video does the same. |
| **✕** | Closes the player. |

### Bottom bar of a player

| Control | What it does |
|---|---|
| ⏸ / ▶ | Pause or play. |
| Speaker and slider | Mute and volume for this player only. |
| **Solo** | Hear only this player; everything else is muted. Click again to unmute the rest. |
| Seek bar | Appears for recorded videos (not live). Shows time played and length; drag to seek. |
| **CC** | Turns captions on or off. Shown only when captions exist. |
| **⚙** | Settings menu. |

### Settings menu (⚙)

Sections appear only when they apply to the current player.

| Section | Options |
|---|---|
| Speed | 0.5× to 2× (not for live). |
| Quality | Auto, or a fixed resolution. |
| Captions | Off, or any available language. |
| Audio | Appears when there is more than one audio track. |
| Player | YouTube only: switch between the clean player and YouTube's own player. |

## 6a. Phones and tablets

SplitDeck adapts to touch screens and small windows. It works in a phone or tablet browser, for example by opening the address of a SplitDeck running on another computer. The app itself has no login, so keep it on a private network.

| Area | What changes |
|---|---|
| Top bar | On tablets the buttons show icons only. On phones the link box takes its own row and the buttons sit below it. |
| Showing controls | There is no hover on a touch screen, so **tap a picture** to show its controls. They hide again after a few seconds, or when you tap another player. |
| Swapping | Press the **⋮⋮** handle, drag onto another player and let go. |
| Resizing | The handles between players are always visible and larger. Drag them with a finger. |
| Default layout | If you have not chosen a layout yet, portrait screens get stacked layouts: one picture per row on phones, two columns on tablets from 4 players. Rotating the device picks a suitable default again. A layout you chose yourself is kept. |
| Small players | Very small players hide the least-used buttons (fit/fill, reload, volume slider, title) so the rest still fit. Open the player in fullscreen to see everything. |
| Live panel | Fills the whole width on phones. Use ✕ to close it and watch. |
| Fullscreen | On iPhone and iPad only the video itself can go fullscreen, so SplitDeck's own controls are not shown there. |
| Text boxes | Use a 16 px font so iOS does not zoom the page when you tap them. |

The keyboard shortcuts in [section 10](#10-keyboard-shortcuts) need a keyboard. On a phone use the **Show UI** button instead of **H**.

---

## 7. The Live browser

Click **Live** in the top bar to open a panel listing what is live right now. Click any row to add it as a player. A row you added is outlined.

There is one tab per site.

### Twitch, Kick and YouTube

- **Search box**: search by name, title or category.
- **Language** (Twitch, Kick): shows only streams in that language.
- **Category**: opens a searchable list. On Kick it covers every category that currently has live streams; on Twitch it shows the top categories and searches all categories as you type; on YouTube it is a fixed list.
- Results are sorted by viewer count.
- **Scroll to the bottom** to load the next group of results.
- The ⟳ button refreshes the list.

On Twitch and Kick, a search overrides the language and category filters. On YouTube, the category and the search words are combined.

Kick has no language filter of its own, so SplitDeck scans its list page by page and keeps matching streams. A rare language can take several seconds the first time.

### TikTok

TikTok does not offer a public list of who is live. Instead:

1. Type a username (with or without `@`) and click **Look up**. The result shows whether they are live.
2. Click **＋** on the result to add them to your **watchlist**.
3. The watchlist shows who is live right now. Offline accounts are dimmed.

The watchlist is saved in your browser.

## 8. YouTube: clean player and YouTube's player

By default, YouTube links play in SplitDeck's **clean player**. It has no logo, no suggested-video box, no annotations and no burned-in captions, and it provides the full toolbar from [section 6](#6-player-controls): captions, speed, quality up to 1080p, and audio tracks.

If the clean player cannot load a video, SplitDeck falls back automatically to YouTube's embedded player. You can also switch manually: **⚙ → Player**. YouTube's player has its own limits (overlays you cannot remove) and only speed is available from SplitDeck's menu.

Captions in the clean player include every language the uploader provided, plus the automatic captions in the video's own language. Captions are off until you turn them on.

## 9. Saved data and reset

SplitDeck remembers your session in the browser's `localStorage`:

| Key | Contents |
|---|---|
| `splitdeck.v2` | The list of players (link, volume, mute, fit/fill), chosen layouts and divider sizes. |
| `splitdeck.lang` | Last language filter in the Live browser. |
| `splitdeck.tiktok` | The TikTok watchlist. |

When you reopen the page, the same players are added again and start playing.

**Reset** closes all players, clears the saved list and resets layouts and divider sizes. It does not clear the TikTok watchlist or language filter.

Data is stored per browser and per address. Using a different browser, or a different port, starts empty.

## 10. Keyboard shortcuts

| Key | Action |
|---|---|
| **H** | Hide or show the top bar. |
| **Esc** | Show the top bar and close the Live panel. |
| **/** | Show the top bar and focus the link box. |
| **Enter** (in the link box) | Add the link. |

## 11. Supported sites

| Site | How it is handled |
|---|---|
| YouTube | Clean player via yt-dlp; embedded player as a fallback. |
| TikTok LIVE | Read directly from TikTok's web API (yt-dlp as a fallback). |
| Twitch | yt-dlp. |
| Kick | yt-dlp. |
| Other sites | Anything [yt-dlp supports](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md) that yields an HLS, MP4 or FLV stream. |

Paste a link and SplitDeck decides how to play it. If a site works in yt-dlp, it should work here.

## 12. Configuration

Environment variables, set before `npm start`:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | Port the server listens on. |
| `YTDLP` | auto | Path to a yt-dlp executable. By default SplitDeck uses `bin/yt-dlp` (from `npm run setup`), and otherwise `yt-dlp` on your `PATH`. |

Examples:

```bash
# macOS / Linux
PORT=9000 npm start

# Windows (PowerShell)
$env:PORT = 9000; npm start
```

If you change the port, also change the address you open (and the one in `start.bat`).

## 13. HTTP API

The page talks to the local server with these endpoints. They are internal and may change.

| Endpoint | Purpose |
|---|---|
| `GET /api/resolve?url=…[&embed=1]` | Turns a link into something the page can play. Returns `type` (`hls`, `file`, `flv` or `youtube`), a playable `url`, a list of fallback `sources`, `title`, `live`, and for YouTube `captions`. `embed=1` forces YouTube's embedded player. |
| `GET /api/live?site=…` | Lists live streams for `twitch`, `kick` or `youtube`, or checks usernames for `tiktok`. Parameters: `lang`, `cat`, `q` (search), `after` (paging token), `users` (TikTok). Returns `items` and `next`. |
| `GET /api/categories?site=…[&q=…]` | Category list for `twitch`, `kick` or `youtube`, optionally filtered by `q`. |
| `GET /api/languages?site=…` | Languages available for `twitch` or `kick`. |
| `GET /proxy?s=…&u=…` | Fetches a media URL with the right headers and adds CORS headers. Rewrites HLS playlists so every segment also goes through the proxy. |
| `GET /master?id=…` | Serves a generated HLS master playlist (used for YouTube). |
| Anything else | Static files from `public/`. |

## 14. How it works

### Playing a link

1. The page sends the link to `/api/resolve`.
2. The server finds a playable stream (see below) and returns a proxied URL.
3. The page plays it in a `<video>` element using hls.js (HLS) or mpegts.js (FLV), or directly for plain files.
4. All media goes through `/proxy`. Many sites reject requests from a web page, so the proxy adds the headers they expect and the CORS headers the browser needs.

If the first stream format fails or does not start within 15 seconds, the page tries the next one (for example HLS, then FLV).

### Per-site details

- **yt-dlp** is run as a command to extract the stream URL for most sites. Results are not cached; each add resolves fresh.
- **TikTok LIVE** is read from TikTok's web API first, because yt-dlp's live detection is sometimes wrong. yt-dlp is used if that fails.
- **YouTube** exposes video and audio as separate HLS streams. The server builds one master playlist from them so hls.js can offer quality levels and audio tracks, and returns the caption files so the page can show them. If that fails it returns the embed instead.
- **Kick** blocks requests from Node.js, so the server uses the system `curl` for Kick's public listing.
- **Twitch** listings use Twitch's public web API. Because it limits each request to 30 results and blocks "next page" tokens, the server builds a larger list from many parallel requests (one per top category, or per language when a category is chosen), sorts by viewers and pages through it.

### Live browser paging

Each list returns up to 30 items and a `next` token. The page asks for the next group when you scroll near the bottom. Lists are cached on the server for about a minute.

### Layout engine

A layout is a tree of splits. Leaves are player slots; each inner node splits its area into side-by-side or stacked children with adjustable ratios. Every inner node has a draggable divider. Layout previews, positioning and saved sizes all come from this one structure. Dragging a player only changes which slot it occupies; the video elements are never moved in the page, so they keep playing.

## 15. Project structure

```
SplitDeck/
├── server.js            Node server: static files, resolver, proxy, Live lists
├── setup.js             Downloads yt-dlp into bin/
├── start.bat            Windows launcher
├── package.json
├── assets/
│   └── social-preview.png  1280x640 repository image
├── docs/
│   └── DOCUMENTATION.md This file
└── public/
    ├── index.html       Page structure
    ├── style.css        Styles
    ├── logo.svg         Logo and favicon
    ├── app.js           All client logic
    └── vendor/          hls.js and mpegts.js
```

`bin/` (yt-dlp) is created by `npm run setup` and is not committed.

## 16. Troubleshooting

| Problem | What to try |
|---|---|
| A link will not play, or says "not live" for something that is live | Update yt-dlp with `npm run setup` and press **Ctrl+F5**. If it still fails, click **Retry** on the player and read the message shown on it. |
| Changes do not appear after updating the code | Restart the server, then press **Ctrl+F5** in the browser. A running server keeps the old code. |
| The port is already in use | Another copy is running. Close it, or start with a different `PORT`. |
| `yt-dlp` not found | Run `npm run setup`, or set `YTDLP` to its path. |
| Kick lists say "Kick blocked the request" | Make sure `curl` is installed and on your `PATH`. If Kick changed its protection, this may need a code update. |
| No sound | Players after the first start muted. Use the speaker, **All**, or **Solo**. Browsers may also block sound until you click the page. |
| A YouTube video shows YouTube's overlays | The clean player could not load it and the embed was used. Try **⟳**, or update yt-dlp. |
| Captions button missing | The video has no captions, or the player is YouTube's embed. |
| Everything is stuck or wrong | Click **Reset**, then press **Ctrl+F5**. |

## 17. Limitations

- Maximum of 8 players.
- Clean YouTube playback is limited to 1080p.
- Twitch search shows one page of results. A Twitch category combined with a language also shows one page.
- TikTok has no public search or live list; only username lookup and a watchlist.
- Kick's language filter scans pages, so rare languages can be slow on the first load.
- SplitDeck relies on public web endpoints and yt-dlp, not official APIs. Sites can change them without notice, which can break a feature until the project is updated.
- Some content cannot be played: private, age-restricted, region-locked or login-only streams.

## 18. Privacy and security

- The server runs only on your computer and listens on `127.0.0.1`.
- Everything you save (players, layouts, watchlist) stays in your browser. Nothing is sent to a SplitDeck server.
- Your computer requests media and listings directly from the sites you use, as a normal browser would.
- The media proxy only accepts session IDs that your own server issued, and it is reachable only from your computer.
- You are responsible for following the terms of the sites you use.

## 19. Third-party components

| Component | Use | License |
|---|---|---|
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Finds stream URLs (downloaded separately). | Unlicense |
| [hls.js](https://github.com/video-dev/hls.js) | Plays HLS streams in the browser (`public/vendor/hls.min.js`). | Apache-2.0 |
| [mpegts.js](https://github.com/xqq/mpegts.js) | Plays FLV streams in the browser (`public/vendor/mpegts.js`). | Apache-2.0 |
