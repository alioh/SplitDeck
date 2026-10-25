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
   - [6b. Find stream links](#6b-find-stream-links)
   - [6c. Sign-ins for restricted streams](#6c-sign-ins-for-restricted-streams)
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

**+ Add**, **Find** and **Live** sit together on the left; the layout, mute, reset and hide controls are on the right. On a phone the first row holds the link box, **+ Add**, **Find** and **Live**, and the second row holds the rest.

| Control | What it does |
|---|---|
| Link box and **+ Add** | Adds players. |
| **Find** | Opens the link finder ([section 6b](#6b-find-stream-links)). |
| **Live** | Opens the Live browser ([section 7](#7-the-live-browser)). |
| Counter (`3 / 8`) | Players in use. |
| **Layout** | Choose an arrangement ([section 5](#5-layouts-and-resizing)). |
| **Mute all** / **Unmute all** (speaker) | Mutes every player. When everything is muted the button turns red and says **Unmute all**, which turns the sound back on for every player. |
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

### Clicking a player

A single click on the picture pauses or plays it. Pressing and **moving** the mouse instead starts a drag to swap players (below), so the two never get mixed up. Double-click goes fullscreen.

### Swapping players

**Press anywhere on a player and move it onto another player** to swap their positions. This works with a mouse and with a finger. A plain click or tap does nothing special, because the drag only starts after the pointer has moved a few pixels. The other players light up with **Swap here** while you drag; let go over one to swap. The players keep playing while they move.

Players shown through an embedded page (such as the Facebook fallback) swallow the mouse, so for those use the **⋮⋮** handle at the top left of the player instead; it works the same way and still works on every player. The **★ Main** button swaps a player into the first (usually largest) position.

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
| **▣** | **Focus:** shows only this player, full size, with sound. See [Focusing one player](#focusing-one-player). |
| **✕** | Closes the player. |

### Focusing one player

Click the **▣** button in a player's top-right controls (just left of **✕**) to focus it:

- The player fills the whole stage, on its own.
- Sound switches to it (at its volume, or 60% if it was at zero).
- Every other player **keeps running in the background, muted**, so you are still live when you come back.
- A red **◀ Back to grid** button appears at the top left.

To return, use any of these: the **Back to grid** button, **Esc**, the **▣** button again (it is lit while focused), or the browser's or phone's **Back** button. The grid, the layout, your divider sizes and each player's earlier mute state come back exactly as they were.

Adding a player or using **Reset** also returns to the grid. Closing the focused player returns to the grid too. Resize handles are hidden while a player is focused.

### Bottom bar of a player

| Control | What it does |
|---|---|
| ⏸ / ▶ | Pause or play. You can also **click the picture** to pause or play (a short ▶ / ❚❚ symbol shows in the middle). On a touch screen a tap shows the controls instead. |
| **● LIVE** | Shown on live streams. Red when you are watching live, grey when you are behind (for example after a pause). Click it to jump to the live point. Resuming after a pause continues from where you paused. |
| Speaker and slider | Mute and volume for this player only. The volume slider slides out of the speaker button when you hover over it (on touch screens it is always shown). |
| **Solo** | Hear only this player; everything else is muted. Click again to unmute the rest. |
| Seek bar | For recorded videos it shows time played and length; drag to seek. **Hover over it to see the time at that point**, and while dragging it shows the time you will jump to. For live streams it covers the part you can rewind: drag back to watch an earlier moment, forward to catch up. It shows how far behind live you are (for example *-0:38*), or **LIVE**, and keeps updating while paused, so you can move back or forward before you press play. It also appears in YouTube's own player when the stream allows rewinding. |
| **CC** | Turns captions on or off. Shown only when captions exist. |
| **⚙** | Settings menu. |

How far back a live stream can be rewound depends on the site. YouTube live streams often keep a long window. Twitch and Kick only publish the last moments, so the bar covers what SplitDeck has kept: up to about 3 minutes, counted from when you added the player. TikTok LIVEs that play as FLV keep catching up to live on their own, so they have no seek bar, only the LIVE button.

### Settings menu (⚙)

Sections appear only when they apply to the current player.

| Section | Options |
|---|---|
| Speed | 0.5× to 2× (not for live). |
| Quality | Auto, or a fixed resolution. |
| Captions | Off, or any available language. The **Caption style** row below it opens the style options. |
| Audio | Appears when there is more than one audio track. |
| Player | YouTube only: switch between the clean player and YouTube's own player. |

## 6a. Phones and tablets

SplitDeck adapts to touch screens and small windows. It works in a phone or tablet browser, for example by opening the address of a SplitDeck running on another computer. The app itself has no login, so keep it on a private network.

| Area | What changes |
|---|---|
| Top bar | On tablets the buttons show icons only. On phones the link box takes its own row and the buttons sit below it. |
| Showing controls | There is no hover on a touch screen, so **tap a picture** to show its controls. They hide again after a few seconds, or when you tap another player. |
| Swapping | Press anywhere on a player, drag onto another player and let go (the **⋮⋮** handle works too). |
| Focus | The **▣** button shows one player alone with sound. **Back to grid** (or the phone's Back button) returns. |
| Resizing | The handles between players are always visible and larger. Drag them with a finger. |
| Default layout | If you have not chosen a layout yet, portrait screens get stacked layouts: one picture per row on phones, two columns on tablets from 4 players. Rotating the device picks a suitable default again. A layout you chose yourself is kept. |
| Small players | Very small players hide the least-used buttons (fit/fill, reload, volume slider, title) so the rest still fit. Open the player in fullscreen to see everything. |
| Live panel | Fills the whole width on phones. Use ✕ to close it and watch. |
| Fullscreen | On iPhone and iPad only the video itself can go fullscreen, so SplitDeck's own controls are not shown there. |
| Text boxes | Use a 16 px font so iOS does not zoom the page when you tap them. |

The keyboard shortcuts in [section 10](#10-keyboard-shortcuts) need a keyboard. On a phone use the **Show UI** button instead of **H**.

---

## 6b. Find stream links

Click **Find** in the top bar to open the link finder. Paste the address of a web page and press **Scan**. SplitDeck downloads the page and lists any `.m3u8` (HLS), `.mp4` and `.flv` links it can see in the page's source. It is like looking at a page's source for video links, done for you.

### What it scans

- The page itself.
- Its frames (`<iframe>`), up to two levels deep, because players are often nested.
- A few of its script files.
- It handles links written with escaped slashes (`https:\/\/…`), protocol-relative links (`//host/file.m3u8`) and relative links (`clips/a.mp4`), and notes when a link came from a `<video>` tag or a meta tag.

It stops after about 18 downloads, and each is size- and time-limited.

### What each result offers

| Button | What it does |
|---|---|
| **▶ Play** | Adds the link as a player. |
| **Copy** | Copies the link. |
| **Test** | Asks the server for the link and reports what came back: the HTTP status, and for a playlist the number of quality levels, whether it is live or recorded, and whether its segments are encrypted. A `403` usually means the server only serves the page that embeds it. |

**Try the page link itself** hands the whole page to the normal link handling (yt-dlp), which understands many sites and can find video that a plain scan cannot.

### What it does not do

- It does **not** run scripts. If a page loads its video with JavaScript after it opens, the link will not appear in the source and the scan will find nothing.
- It does **not** decode, decrypt or deobfuscate anything, and it does not get around protection such as login walls, signed links, referer checks or DRM.
- Playing a found link sends no special headers, so links that only work from their own page will not play.

Use it only with content you have the right to watch.

### Safety

The scanner makes requests from your computer to any address you give it, so it refuses private-network addresses: your own machine, `10.x`, `172.16–31.x`, `192.168.x`, link-local addresses (including cloud metadata addresses) and their IPv6 equivalents. This is checked for every redirect too. To inspect a page on your own network on purpose, start the server with `ALLOW_PRIVATE_URLS=1` (see [Configuration](#12-configuration)).

---

## 6c. Sign-ins for restricted streams

Some streams only play for a signed-in account:

| Site | Needs a sign-in for |
|---|---|
| TikTok | Age-restricted (18+) LIVEs, and LIVEs limited to followers or subscribers |
| YouTube | Age-restricted and members-only videos and streams |
| Twitch | Subscriber-only streams and videos |

A sign-in also fills the **★ Following** tab of the Live browser with the channels you follow on YouTube and Kick. See [Following](#following).

When that happens the player says so, for example *"This TikTok LIVE is age-restricted (18+)…"*, with an **🔑 Open Sign-ins** button.

### Adding a sign-in

1. In your normal browser, sign in to the site (TikTok, YouTube, Twitch or Kick).
2. Install a cookie-export extension that saves in the **cookies.txt (Netscape)** or **JSON** format, for example "Get cookies.txt LOCALLY".
3. Open the site, export its cookies, open the exported file and copy everything.
4. In SplitDeck, click **🔑 Sign-ins** in the top bar, paste into that site's box and click **Save**.

Players from that site that had failed are retried straight away. SplitDeck accepts a cookies.txt export, a JSON export (a list of `{name, value, domain}`), or a `name=value; name=value` line, and keeps only that site's cookies (cookies for other sites and expired ones are dropped).

Sign-ins expire. If restricted streams stop working, paste a fresh one. **Remove** deletes a site's sign-in; **Remove all sign-ins** deletes them all.

### Why it is not automatic

A web page cannot read another site's cookies; browsers block this on purpose. Chrome, Edge and Brave on Windows also encrypt their cookies so that other programs cannot read them. So the sign-in has to be exported and pasted once.

### Where your sign-in goes

- It is saved **only in this browser** (local storage), on the computer you use SplitDeck from.
- When you open a stream, only **that site's** sign-in is sent, inside the request (never in the address), to **your own SplitDeck server**.
- While SplitDeck is open, it also sends each saved sign-in to your server every 2 minutes to check who you follow is live ([Following](#following)). The server only asks that site for your followed channels.
- The server uses it for that one lookup and then forgets it. It is never written to the log. For yt-dlp it is put in a private temporary file that is deleted as soon as the lookup ends.
- The server accepts sign-ins only from the same computer or your home network (private network addresses). Requests from elsewhere are treated as if no sign-in was sent.
- To turn the feature off completely, start the server with `DISABLE_SIGNIN=1`. The **Sign-ins** button then disappears.

**Keep it private.** A sign-in works like your password for that site. Only paste it into **your own** copy of SplitDeck, never into a copy someone else runs. Clearing your browser's site data for SplitDeck also removes it.

The older method still works: a `cookies.txt` file in the SplitDeck folder (see [Facebook and logins](#facebook-and-logins)). A sign-in pasted in the app is used first.

---

## 7. The Live browser

Click **Live** in the top bar to open a panel listing what is live right now. Click any row to add it as a player. A row you added is outlined.

There is a **★ Following** tab, then one tab per site.

### Following

Shows who you follow that is live right now, using the sign-ins saved under **🔑 Sign-ins** ([section 6c](#6c-sign-ins-for-restricted-streams)):

| Site | What it shows | Notes |
|---|---|---|
| YouTube | Live streams from your subscriptions, then **Latest videos** from your subscriptions feed | Slowest to load (several seconds). Checked at most every 3 minutes. |
| Kick | Followed channels that are live | Needs the `session_token` cookie in the sign-in. |

Twitch and TikTok are not included: both block follow lists for requests from outside their own sites.

The platform buttons at the top (**YouTube**, **Kick**) choose which platforms are shown; click one to switch it off or on. A platform that is switched off is also left out of the background check and the notes. The choice is remembered.

A site without a sign-in shows an **Open Sign-ins** link. If a site says it did not accept your sign-in, it has probably expired: paste a fresh one.

While SplitDeck is open, it checks again every 2 minutes, even with the panel closed. The **Live** button shows how many followed channels are live, and a short note appears when someone goes live (*"… is live on Kick"*). Untick **Tell me when someone goes live** to turn the notes off. Nothing is checked while SplitDeck is closed.

These lists come from each site's own, unofficial web endpoints. A site can change them at any time, and then that site's section shows an error until SplitDeck is updated.

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

TikTok does not offer a public list of who is live. Instead, type a username (with or without `@`) and click **Look up**. The result shows whether they are live; click it to add the player.

## 8. YouTube: clean player and YouTube's player

By default, YouTube links play in SplitDeck's **clean player**. It has no logo, no suggested-video box, no annotations and no burned-in captions, and it provides the full toolbar from [section 6](#6-player-controls): captions, speed, quality up to 1080p, and audio tracks.

If the clean player cannot load a video, SplitDeck falls back automatically to YouTube's embedded player. You can also switch manually: **⚙ → Player**. YouTube's player has its own limits (overlays you cannot remove) and only speed is available from SplitDeck's menu. The **● LIVE** button still works there on live streams.

Captions in the clean player include every language the uploader provided, plus the automatic captions in the video's own language. Captions are off until you turn them on.

### Caption style

In a player's **⚙** menu, under **Caption style**, click **▸ Size, color, font, position** to change how captions look:

| Option | Choices |
|---|---|
| Size | X-small, Small, Normal, Large, Huge |
| Color | White, Yellow, Cyan, Green, Red |
| Background | None, Light, Medium, Solid |
| Font | Sans, Serif, Mono, Rounded, Bold |
| Outline | None, Shadow, Outline |
| Position | As made (where the captions place themselves), Top, Middle, Bottom |

One style applies to every player and is remembered in this browser. **Reset caption style** goes back to the defaults. The style applies to SplitDeck's own players (the clean YouTube player and other videos with captions), not to YouTube's own embedded player, which has its own caption settings.

## 9. Saved data and reset

SplitDeck remembers your session in the browser's `localStorage`:

| Key | Contents |
|---|---|
| `splitdeck.v2` | The list of players (link, volume, mute, fit/fill), chosen layouts and divider sizes. |
| `splitdeck.lang` | Last language filter in the Live browser. |
| `splitdeck.signin` | Sign-ins saved under **🔑 Sign-ins**. |
| `splitdeck.capstyle` | Caption style. |
| `splitdeck.follownotify` | Whether to show a note when a followed channel goes live. |
| `splitdeck.followoff` | Platforms switched off in the Following tab. |

When you reopen the page, the same players are added again and start playing.

**Reset** closes all players, clears the saved list and resets layouts and divider sizes. It does not clear the language filter.

Data is stored per browser and per address. Using a different browser, or a different port, starts empty.

## 10. Keyboard shortcuts

| Key | Action |
|---|---|
| **H** | Hide or show the top bar. |
| **Esc** | Go back to the grid from a focused player; otherwise show the top bar and close the open panel. |
| **/** | Show the top bar and focus the link box. |
| **Enter** (in the link box) | Add the link. |

## 11. Supported sites

| Site | How it is handled |
|---|---|
| YouTube | Clean player via yt-dlp; embedded player as a fallback. |
| TikTok LIVE | Read directly from TikTok's web API (yt-dlp as a fallback). |
| Twitch | yt-dlp. |
| Kick | yt-dlp. |
| X (Twitter) | yt-dlp. Works for live broadcasts and their replays (`x.com/i/broadcasts/…`) and for videos in posts. Audio-only X Spaces play as sound with no picture, and usually need a login (see cookies below). |
| Facebook | Best effort. SplitDeck first asks yt-dlp; if that fails (it often does without a login), it shows Facebook's own embedded player, which works for public videos and live streams. See [Facebook and logins](#facebook-and-logins). |
| Other sites | Anything [yt-dlp supports](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md) that yields an HLS, MP4 or FLV stream. |

Paste a link and SplitDeck decides how to play it. If a site works in yt-dlp, it should work here.

The Live browser lists Twitch, Kick, YouTube and TikTok only. X and Facebook have no public list of live streams, so for those you paste a link.

### Facebook and logins

Facebook, some X content and **age-restricted (18+) TikTok LIVEs** need you to be signed in, and yt-dlp's Facebook support changes often. What SplitDeck does:

1. It tries yt-dlp first. If that works you get the normal clean player with the full toolbar.
2. If it fails, it shows Facebook's **embedded player** inside the tile. That works for **public** videos and live streams. It is Facebook's own player, so SplitDeck's volume, mute, speed and quality controls do not apply to it; use the controls inside it. A private or removed video shows Facebook's own "Video unavailable" message.

**TikTok 18+ LIVEs:** TikTok marks some LIVEs as age-restricted. It then shows them only to signed-in adult accounts and leaves the video out for everyone else, so without a login SplitDeck shows *"This TikTok LIVE is age-restricted (18+)"*. The easiest fix is to add your TikTok sign-in under **🔑 Sign-ins** ([section 6c](#6c-sign-ins-for-restricted-streams)).

Alternatively, for all sites at once, put a cookies file in the project folder named `cookies.txt` (Netscape format, exported from your browser with a cookie-export extension), or point the `COOKIES` variable at it. Keep this file private: it is excluded from Git and never uploaded anywhere, but anyone with the file can use your logins.

## 12. Configuration

Environment variables, set before `npm start`:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | Port the server listens on. |
| `ALLOW_PRIVATE_URLS` | off | Set to `1` to let the link finder scan addresses on your own network. Leave it off unless you need it. |
| `DISABLE_SIGNIN` | off | Set to `1` to turn off the **Sign-ins** panel; sign-ins sent by the page are then ignored. |
| `COOKIES` | `cookies.txt` if it exists | Path to a Netscape-format cookies file passed to yt-dlp, for sites that need a login. Optional. |
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
| `POST /api/resolve` | Same as below, with a JSON body `{url, embed, cookies}`. `cookies` is that site's sign-in from the Sign-ins panel; it is only accepted from this computer or the home network. |
| `POST /api/following` | JSON body `{site, cookies}` with `site` `youtube` or `kick`. Returns the followed channels that are `live` (and YouTube's latest `videos`), each with `url`, `channel`, `title`, `viewers`, `thumb`. Only accepted from this computer or the home network. |
| `GET /api/config` | Tells the page whether sign-ins are allowed (`{signin: true/false}`). |
| `GET /api/resolve?url=…[&embed=1]` | Turns a link into something the page can play. Returns `type` (`hls`, `file`, `flv`, `youtube` or `embed`), a playable `url`, a list of fallback `sources`, `title`, `live`, and for YouTube `captions`. `embed=1` forces YouTube's embedded player. |
| `GET /api/live?site=…` | Lists live streams for `twitch`, `kick` or `youtube`, or checks usernames for `tiktok`. Parameters: `lang`, `cat`, `q` (search), `after` (paging token), `users` (TikTok). Returns `items` and `next`. |
| `GET /api/categories?site=…[&q=…]` | Category list for `twitch`, `kick` or `youtube`, optionally filtered by `q`. |
| `GET /api/languages?site=…` | Languages available for `twitch` or `kick`. |
| `GET /api/inspect?url=…` | Scans a page for stream links ([section 6b](#6b-find-stream-links)). Returns `page`, `results` (each with `url`, `kind`, `via`, `where`) and `scanned`. |
| `GET /api/probe?url=…` | Tests one link and reports status, content type and, for playlists, quality levels and live/recorded. |
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
  TikTok serves some accounts as HLS and others only as FLV, depending on which of its networks carries the stream. SplitDeck plays both. (FLV is played with mpegts.js; its background worker needs a full web address, which SplitDeck supplies.)
- **YouTube** exposes video and audio as separate HLS streams. The server builds one master playlist from them so hls.js can offer quality levels and audio tracks, and returns the caption files so the page can show them. If that fails it returns the embed instead.
- **Kick** blocks requests from Node.js, so the server uses the system `curl` for Kick's public listing.
- **X** is handled by yt-dlp. A post with several videos plays the first one. If a result has no video at all (for example an audio-only Space), the best audio stream is played.
- **Facebook** is tried with yt-dlp first and falls back to Facebook's embedded player (`type: embed`) when extraction fails.
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
| No sound | Players after the first start muted. Use a player's speaker, **Unmute all**, or **Solo**. Browsers may also block sound until you click the page. |
| A YouTube video shows YouTube's overlays | The clean player could not load it and the embed was used. Try **⟳**, or update yt-dlp. |
| Captions button missing | The video has no captions, or the player is YouTube's embed. |
| A Facebook link shows "Video unavailable" | The video is private, removed or not public. The embedded player can only show public videos. |
| An X or Facebook link needs a login | Add a `cookies.txt` (see [Facebook and logins](#facebook-and-logins)) and restart. |
| The link finder shows no results | The page probably loads its video with JavaScript, or protects it. The finder only reads source text. Try **Try the page link itself**. |
| The link finder says an address is blocked | It refuses private-network addresses. See `ALLOW_PRIVATE_URLS` in [Configuration](#12-configuration). |
| A TikTok LIVE says it is age-restricted (18+) | TikTok only shows it to signed-in adults. Add your TikTok sign-in under **🔑 Sign-ins** ([section 6c](#6c-sign-ins-for-restricted-streams)). |
| It says TikTok did not accept your sign-in | The sign-in has expired, or the account is not 18+. Export and paste a fresh one. |
| The Sign-ins button is missing | The server was started with `DISABLE_SIGNIN=1`, or you are opening SplitDeck from outside your computer or home network. |
| A TikTok LIVE says it is live but did not share its video | The LIVE is restricted in another way (for example followers or subscribers only, or a region). A sign-in from an account that can watch it may help. |
| Everything is stuck or wrong | Click **Reset**, then press **Ctrl+F5**. |

## 17. Limitations

- Maximum of 8 players.
- Clean YouTube playback is limited to 1080p.
- Twitch search shows one page of results. A Twitch category combined with a language also shows one page.
- TikTok has no public search or live list; only username lookup.
- Kick's language filter scans pages, so rare languages can be slow on the first load.
- SplitDeck relies on public web endpoints and yt-dlp, not official APIs. Sites can change them without notice, which can break a feature until the project is updated.
- Some content cannot be played: private, age-restricted, region-locked or login-only streams.
- Facebook is best effort. The embedded fallback has no SplitDeck volume, mute, speed or quality controls.
- X and Facebook have no entries in the Live browser.
- The link finder reads only source text; it does not run scripts, so pages that build their player with JavaScript show no links.

## 18. Privacy and security

- The server runs only on your computer and listens on `127.0.0.1`.
- The link finder refuses private-network addresses by default, so it cannot be used to probe your home network.
- Sign-ins pasted in the app stay in your browser and are only sent to your own SplitDeck server, only from this computer or your home network, and never logged (see [section 6c](#6c-sign-ins-for-restricted-streams)).
- Your optional `cookies.txt` stays on your computer and is excluded from Git. Treat it like a password.
- Everything you save (players, layouts, sign-ins) stays in your browser. Nothing is sent to a SplitDeck server.
- Your computer requests media and listings directly from the sites you use, as a normal browser would.
- The media proxy only accepts session IDs that your own server issued, and it is reachable only from your computer.
- You are responsible for following the terms of the sites you use.

## 19. Third-party components

| Component | Use | License |
|---|---|---|
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Finds stream URLs (downloaded separately). | Unlicense |
| [hls.js](https://github.com/video-dev/hls.js) | Plays HLS streams in the browser (`public/vendor/hls.min.js`). | Apache-2.0 |
| [mpegts.js](https://github.com/xqq/mpegts.js) | Plays FLV streams in the browser (`public/vendor/mpegts.js`). | Apache-2.0 |
