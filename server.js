// SplitDeck local server: static files + /api/resolve (yt-dlp) + /proxy (CORS/header-adding stream proxy)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { Readable } = require('stream');
const os = require('os');
const { AsyncLocalStorage } = require('async_hooks');

const PORT = process.env.PORT || 8787;
const PUBLIC = path.join(__dirname, 'public');
// yt-dlp: $YTDLP, else the copy downloaded by `npm run setup`, else whatever is on PATH
const BUNDLED = path.join(__dirname, 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const YTDLP = process.env.YTDLP || (fs.existsSync(BUNDLED) ? BUNDLED : 'yt-dlp');
// optional: a Netscape-format cookies file, from $COOKIES or ./cookies.txt (git-ignored). yt-dlp only sends each cookie to its own site.
const COOKIES_FILE = process.env.COOKIES || (fs.existsSync(path.join(__dirname, 'cookies.txt')) ? path.join(__dirname, 'cookies.txt') : '');

// ---------- sign-ins pasted in the app (Sign-ins panel) ----------
// The browser keeps them; when a stream is opened it sends only that site's cookies, in the request body, to this server.
// They are used for that one lookup (never logged or saved), and are only accepted from this computer or the home network.
// Set DISABLE_SIGNIN=1 to turn the feature off.
const SIGNIN_ENABLED = process.env.DISABLE_SIGNIN !== '1';
const SIGNIN_SITES = {
  tiktok: { domain: '.tiktok.com', host: /(^|\.)tiktok\.com$/i },
  youtube: { domain: '.youtube.com', host: /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i },
  twitch: { domain: '.twitch.tv', host: /(^|\.)twitch\.tv$/i },
};
const signinStore = new AsyncLocalStorage(); // { site, header, cookieFile } while a request with a sign-in is being handled
function siteOfUrl(u) {
  let host = ''; try { host = new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u).hostname; } catch { return ''; }
  for (const [k, v] of Object.entries(SIGNIN_SITES)) if (v.host.test(host)) return k;
  return '';
}
// accept only a clean "name=value; name=value" list (the app converts every export format to this)
function cleanCookieHeader(text) {
  const out = [];
  for (const part of String(text || '').split(';')) {
    const i = part.indexOf('='); if (i < 1) continue;
    const name = part.slice(0, i).trim(), value = part.slice(i + 1).trim();
    if (!/^[!#$%&'*+\-.^\w`|~]+$/.test(name) || /[\x00-\x1f\x7f;,\s"\\]/.test(value) && !/^"[^"]*"$/.test(value)) continue;
    out.push(name + '=' + value);
    if (out.length >= 200) break;
  }
  return out.join('; ');
}
// run fn() with a sign-in for the site of url (if any); yt-dlp gets a private temporary cookies file that is deleted afterwards
async function withSignin(url, cookieText, fn) {
  const site = siteOfUrl(url), header = site ? cleanCookieHeader(cookieText) : '';
  if (!header) return fn();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'splitdeck-signin-'));
  const cookieFile = path.join(dir, 'cookies.txt');
  const lines = ['# Netscape HTTP Cookie File'].concat(header.split('; ').map((kv) => {
    const i = kv.indexOf('='); return [SIGNIN_SITES[site].domain, 'TRUE', '/', 'TRUE', '0', kv.slice(0, i), kv.slice(i + 1)].join('\t');
  }));
  fs.writeFileSync(cookieFile, lines.join('\n') + '\n', { mode: 0o600 });
  try { return await signinStore.run({ site, header, cookieFile }, fn); }
  finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
}
const fromLocalNetwork = (req) => { const a = String(req.socket.remoteAddress || ''); return a === '::1' || isPrivateIp(a.replace(/^::ffff:/, '')); };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};

// stream sessions: id -> headers to send upstream
const sessions = new Map();

function ytdlp(args, timeout = 45000) {
  return new Promise((resolve, reject) => {
    const st = signinStore.getStore(), cookieFile = (st && st.cookieFile) || COOKIES_FILE;
    execFile(YTDLP, cookieFile ? ['--cookies', cookieFile, ...args] : args, { timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || err.message || '').split('\n').filter((l) => l.includes('ERROR')).pop() || stderr || err.message;
        return reject(new Error(msg.replace(/^ERROR:\s*/, '').trim()));
      }
      resolve(stdout);
    });
  });
}

function youtubeId(u) {
  try {
    const url = new URL(u);
    const h = url.hostname.replace(/^www\.|^m\./, '');
    if (h === 'youtu.be') return url.pathname.slice(1).split('/')[0];
    if (h.endsWith('youtube.com') || h.endsWith('youtube-nocookie.com')) {
      if (url.searchParams.get('v')) return url.searchParams.get('v');
      const m = url.pathname.match(/^\/(?:embed|live|shorts|v)\/([\w-]{11})/);
      if (m) return m[1];
      return null; // channel / handle: needs resolving
    }
  } catch {}
  return null;
}
const isYoutube = (u) => /(^|\/\/|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)/i.test(u);

// returns candidate formats best-first: HLS, then plain files, then FLV (client falls back down the list)
function pickFormats(info) {
  const fmts = (info.formats && info.formats.length ? info.formats : [info]).filter((f) => f.url);
  const proto = (f) => String(f.protocol || '');
  const hasVideo = (f) => f.vcodec !== 'none' && !/only_audio=1/.test(f.url) && !/-ao$/.test(f.format_id || '');
  const score = (f) => (f.height || 0) * 10 + (f.quality || 0) + (f.tbr || 0) / 1000 + (f.acodec && f.acodec !== 'none' ? 5 : 0);
  const best = (list) => list.filter(hasVideo).sort((a, b) => score(b) - score(a))[0];
  const out = [];
  const hls = best(fmts.filter((f) => proto(f).startsWith('m3u8')));
  if (hls) out.push({ f: hls, kind: 'hls' });
  const file = best(fmts.filter((f) => (proto(f) === 'https' || proto(f) === 'http') && f.ext !== 'flv'));
  if (file) out.push({ f: file, kind: 'file' });
  const flv = best(fmts.filter((f) => f.ext === 'flv'));
  if (flv) out.push({ f: flv, kind: 'flv' });
  if (!out.length) {
    const aud = fmts.filter((f) => f.vcodec === 'none' && f.acodec !== 'none').sort((x, y) => (y.abr || y.tbr || 0) - (x.abr || x.tbr || 0))[0];
    if (aud) out.push({ f: aud, kind: proto(aud).startsWith('m3u8') ? 'hls' : 'file' });
  }
  return out;
}

// TikTok LIVE straight from TikTok's web API. yt-dlp's TikTok live detection is flaky
// ("not currently live" while the channel is live), so this runs first and yt-dlp is the fallback.
function tiktokLiveUser(u) {
  const m = u.match(/tiktok\.com\/@([\w.\-]+)\/live/i);
  return m ? m[1] : null;
}
// Cookies for TikTok from the optional cookies.txt (Netscape format), so age-restricted LIVEs work for a signed-in
// adult account. Read fresh each time so a new file is picked up without a restart.
function tiktokCookieHeader() {
  if (!COOKIES_FILE) return '';
  let text; try { text = fs.readFileSync(COOKIES_FILE, 'utf8'); } catch { return ''; }
  const now = Date.now() / 1000, pairs = [];
  for (let line of text.split(/\r?\n/)) {
    if (line.startsWith('#HttpOnly_')) line = line.slice(10);
    else if (!line || line.startsWith('#')) continue;
    const f = line.split('\t');
    if (f.length < 7 || !/(^|\.)tiktok\.com$/i.test(f[0].replace(/^\./, ''))) continue;
    const exp = +f[4];
    if (exp && exp < now) continue;
    pairs.push(f[5] + '=' + f[6]);
  }
  return pairs.join('; ');
}
const tiktokHeaders = () => {
  const h = { 'User-Agent': UA, Referer: 'https://www.tiktok.com/', Accept: 'application/json' };
  const st = signinStore.getStore();
  const c = st && st.site === 'tiktok' ? st.header : tiktokCookieHeader(); if (c) h.Cookie = c;
  return h;
};
const hasTiktokSignin = () => !!tiktokHeaders().Cookie;
const AGE_MSG = 'This TikTok LIVE is age-restricted (18+). TikTok only shows it to signed-in adult accounts. To watch it, add your TikTok sign-in under 🔑 Sign-ins.';
const AGE_MSG_SIGNED = 'This TikTok LIVE is age-restricted (18+) and TikTok did not accept your sign-in for it. The sign-in may have expired or the account may not be 18+. Paste a fresh one under 🔑 Sign-ins.';

async function resolveTiktokLive(user) {
  const api = `https://www.tiktok.com/api-live/user/room/?aid=1988&uniqueId=${encodeURIComponent(user)}&sourceType=54`;
  let j;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(api, { headers: tiktokHeaders() });
      j = await r.json();
      if (j && j.data && j.data.user) break;
    } catch {}
    await new Promise((res) => setTimeout(res, 600));
  }
  const room = j && j.data && j.data.liveRoom;
  if (!j || !j.data || !j.data.user) throw new Error('TikTok did not answer (try again in a moment)');
  if (!room || room.status !== 2) throw new Error('TikTok says this channel is not live right now');

  let streams = null; // { quality: { hls, flv } }
  if (room.streamData && room.streamData.pull_data) {
    const sd = JSON.parse(room.streamData.pull_data.stream_data).data;
    streams = {}; for (const q of Object.keys(sd)) if (sd[q].main) streams[q] = { hls: sd[q].main.hls, flv: sd[q].main.flv };
  } else {
    // Live, but no stream in the public answer: ask the room service why (and, with cookies, it may hand over the stream).
    const roomId = j.data.user.roomId;
    let info = null;
    try { info = await (await fetch('https://webcast.tiktok.com/webcast/room/info/?aid=1988&room_id=' + encodeURIComponent(roomId), { headers: tiktokHeaders() })).json(); } catch {}
    if (info && info.status_code === 4003110) throw Object.assign(new Error(hasTiktokSignin() ? AGE_MSG_SIGNED : AGE_MSG), { final: true, ageRestricted: true });
    const su = info && info.data && info.data.stream_url;
    if (su) {
      streams = {};
      try {
        const sd = JSON.parse(su.live_core_sdk_data.pull_data.stream_data).data;
        for (const q of Object.keys(sd)) if (sd[q].main) streams[q] = { hls: sd[q].main.hls, flv: sd[q].main.flv };
      } catch {
        const flv = su.flv_pull_url || {}, best = flv.FULL_HD1 || flv.HD1 || flv.SD1 || flv.SD2 || su.rtmp_pull_url;
        streams.hd = { hls: su.hls_pull_url || '', flv: best || '' };
      }
    }
    if (!streams) throw Object.assign(new Error('TikTok says this channel is live but did not share its video. It may be restricted (for example to followers, subscribers or some regions). A sign-in under 🔑 Sign-ins from an account that can watch it may help.'), { final: !hasTiktokSignin() });
  }
  const sources = [];
  const sid = crypto.randomBytes(8).toString('hex');
  sessions.set(sid, { 'User-Agent': UA, Referer: 'https://www.tiktok.com/' });
  setTimeout(() => sessions.delete(sid), 6 * 3600 * 1000).unref();
  const px = (url) => `/proxy?s=${sid}&u=${encodeURIComponent(url)}`;
  for (const q of ['origin', 'uhd', 'hd', 'sd', 'ld']) {
    const m = streams[q];
    if (!m) continue;
    if (m.hls) sources.push({ type: 'hls', url: px(m.hls) });
    if (m.flv) sources.push({ type: 'flv', url: px(m.flv) });
  }
  if (!sources.length) throw new Error('TikTok returned no video stream');
  return { type: sources[0].type, url: sources[0].url, sources, title: room.title || `@${user}`, live: true, source: 'TikTok' };
}

async function youtubeEmbed(u) {
  let id = youtubeId(u), title = '';
  if (!id) {
    const out = await ytdlp(['--no-playlist', '--print', '%(id)s\t%(title)s', u]);
    [id, title] = out.trim().split('\n')[0].split('\t');
  }
  return { type: 'youtube', id, title: title || 'YouTube', source: 'youtube' };
}

// YouTube serves video and audio as separate HLS streams. We stitch them into one master playlist
// (so hls.js gives quality levels + audio tracks) and expose the caption files, which gives a clean
// player without YouTube's overlays ("More videos", logo, annotations, burned-in captions).
const masters = new Map();
async function resolveYoutubeNative(u) {
  const info = JSON.parse(await ytdlp(['-J', '--no-playlist', '--no-warnings', u], 60000));
  const fm = (info.formats || []).filter((f) => f.url && String(f.protocol).startsWith('m3u8'));
  const byHeight = new Map();
  fm.filter((f) => f.vcodec !== 'none' && f.acodec === 'none' && /^avc1/.test(f.vcodec)).forEach((f) => {
    const cur = byHeight.get(f.height); if (!cur || (f.tbr || 0) > (cur.tbr || 0)) byHeight.set(f.height, f);
  });
  const vids = [...byHeight.values()].sort((x, y) => (x.height || 0) - (y.height || 0));
  const audByLang = new Map();
  fm.filter((f) => f.vcodec === 'none').forEach((f) => {
    const key = f.language || 'und'; const cur = audByLang.get(key); if (!cur || (f.abr || f.tbr || 0) > (cur.abr || cur.tbr || 0)) audByLang.set(key, f);
  });
  const auds = [...audByLang.values()];
  if (!vids.length || !auds.length) throw new Error('no separate HLS video/audio streams');

  const sid = crypto.randomBytes(8).toString('hex');
  sessions.set(sid, Object.assign({ 'User-Agent': UA }, vids[0].http_headers || {}));
  setTimeout(() => sessions.delete(sid), 6 * 3600 * 1000).unref();
  const lines = ['#EXTM3U', '#EXT-X-VERSION:4', '#EXT-X-INDEPENDENT-SEGMENTS'];
  const defIdx = Math.max(0, auds.findIndex((f) => /original|default/i.test(f.format_note || '') || (info.language && f.language === info.language)));
  auds.forEach((f, i) => {
    const name = (f.format_note || f.language || 'Audio').replace(/[",]/g, '');
    lines.push('#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="' + name + '"' + (f.language ? ',LANGUAGE="' + f.language + '"' : '') +
      ',DEFAULT=' + (i === defIdx ? 'YES' : 'NO') + ',AUTOSELECT=YES,URI="' + proxyUrl(sid, f.url) + '"');
  });
  vids.forEach((f) => {
    const bw = Math.round((f.tbr || (f.height || 360) * 3.5) * 1000) + 130000;
    lines.push('#EXT-X-STREAM-INF:BANDWIDTH=' + bw + ',RESOLUTION=' + f.width + 'x' + f.height + ',CODECS="' + f.vcodec + ',mp4a.40.2"' + (f.fps ? ',FRAME-RATE=' + f.fps : '') + ',AUDIO="aud"');
    lines.push(proxyUrl(sid, f.url));
  });
  const mid = crypto.randomBytes(8).toString('hex');
  masters.set(mid, lines.join('\n') + '\n');
  setTimeout(() => masters.delete(mid), 6 * 3600 * 1000).unref();

  // captions: every uploaded subtitle track + the automatic caption in the video's own language
  const caps = [];
  const pickVtt = (arr) => (arr || []).find((x) => x.ext === 'vtt');
  Object.entries(info.subtitles || {}).forEach(([code, arr]) => { const f = pickVtt(arr); if (f) caps.push({ code, name: f.name || code, auto: false, url: proxyUrl(sid, f.url) }); });
  Object.entries(info.automatic_captions || {}).filter(([code]) => /-orig$/.test(code)).forEach(([code, arr]) => {
    const f = pickVtt(arr); if (f) caps.push({ code, name: (f.name || code).replace(/\s*\(.*\)$/, '') + ' (auto)', auto: true, url: proxyUrl(sid, f.url) });
  });
  const url = '/master?id=' + mid;
  return { type: 'hls', url, sources: [{ type: 'hls', url }], title: info.title || 'YouTube', live: !!info.is_live, source: 'YouTube', native: true, captions: caps.slice(0, 40) };
}

// Facebook rarely lets yt-dlp in without a login, so when extraction fails we fall back to Facebook's own
// embedded player, which works for public videos and live streams without signing in.
const isFacebook = (u) => /^https?:\/\/([\w-]+\.)*(facebook\.com|fb\.watch|fb\.com)\//i.test(u);
const facebookEmbed = (u) => ({
  type: 'embed', source: 'Facebook (embedded)', title: 'Facebook video', live: false,
  url: 'https://www.facebook.com/plugins/video.php?href=' + encodeURIComponent(u) + '&show_text=false&autoplay=true&allowfullscreen=true&width=1280',
});

async function resolve(inputUrl, embed = false) {
  let u = inputUrl.trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;

  if (isYoutube(u)) {
    if (!embed) {
      try { return await resolveYoutubeNative(u); }
      catch (e) { console.log('youtube native failed:', e.message, '- using the embed'); }
    }
    return youtubeEmbed(u);
  }

  const ttUser = tiktokLiveUser(u);
  if (ttUser) {
    try { return await resolveTiktokLive(ttUser); }
    catch (e) {
      if (e.final) throw e; // e.g. age-restricted: yt-dlp would only say "not currently live"
      console.log('tiktok native failed:', e.message, '- trying yt-dlp');
    }
  }
  let out;
  try { out = await ytdlp(['-J', '--no-playlist', '--no-warnings', u]); }
  catch (e) { if (isFacebook(u)) return facebookEmbed(u); throw e; }
  let info = JSON.parse(out);
  if (info && info._type === 'playlist') info = (info.entries || []).find(Boolean) || info;
  const picks = pickFormats(info);
  if (!picks.length) { if (isFacebook(u)) return facebookEmbed(u); throw new Error('No playable video stream found'); }
  const sid = crypto.randomBytes(8).toString('hex');
  const headers = Object.assign({ 'User-Agent': UA }, picks[0].f.http_headers || info.http_headers || {});
  sessions.set(sid, headers);
  setTimeout(() => sessions.delete(sid), 6 * 3600 * 1000).unref();
  const sources = picks.map((p) => ({ type: p.kind, url: `/proxy?s=${sid}&u=${encodeURIComponent(p.f.url)}` }));
  return {
    type: sources[0].type, // hls | file | flv
    url: sources[0].url,
    sources,
    title: info.title || info.uploader || info.webpage_url_domain || 'Stream',
    live: !!info.is_live,
    source: info.extractor_key || info.extractor || '',
  };
}

// ---------- "Live now" discovery lists (paged, cached briefly) ----------
const PAGE = 30;
const liveCache = new Map();
async function cached(key, ttl, fn) {
  const hit = liveCache.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  const v = await fn();
  liveCache.set(key, { t: Date.now(), v });
  if (liveCache.size > 400) liveCache.delete(liveCache.keys().next().value);
  return v;
}
// [code, display name, Twitch language enum (or null), available on Kick]
const LANGS = [
  ['en', 'English', 'EN', 1], ['ar', 'Arabic', 'AR', 1], ['es', 'Spanish', 'ES', 1], ['fr', 'French', 'FR', 1], ['de', 'German', 'DE', 1],
  ['pt', 'Portuguese', 'PT', 1], ['tr', 'Turkish', 'TR', 1], ['ru', 'Russian', 'RU', 1], ['ja', 'Japanese', 'JA', 1], ['ko', 'Korean', 'KO', 1],
  ['pl', 'Polish', 'PL', 1], ['it', 'Italian', 'IT', 1], ['nl', 'Dutch', 'NL', 0], ['th', 'Thai', 'TH', 1], ['vi', 'Vietnamese', 'VI', 0],
  ['id', 'Indonesian', 'ID', 0], ['zh', 'Chinese', 'ZH', 0], ['hi', 'Hindi', 'HI', 1], ['sv', 'Swedish', 'SV', 1], ['cs', 'Czech', 'CS', 1],
  ['da', 'Danish', 'DA', 0], ['el', 'Greek', 'EL', 1], ['fi', 'Finnish', 'FI', 1], ['hu', 'Hungarian', 'HU', 1], ['no', 'Norwegian', 'NO', 0],
  ['ro', 'Romanian', 'RO', 1], ['sk', 'Slovak', 'SK', 1], ['uk', 'Ukrainian', 'UK', 1], ['bg', 'Bulgarian', 'BG', 1], ['fa', 'Persian', null, 1],
  ['he', 'Hebrew', null, 1], ['tl', 'Filipino', 'TL', 1], ['sr', 'Serbian', null, 1], ['sq', 'Albanian', null, 1],
];
const langByCode = (c) => LANGS.find((l) => l[0] === c);
const langsFor = (site) => LANGS.filter((l) => (site === 'twitch' ? l[2] : l[3])).map((l) => ({ value: l[0], name: l[1] }));

const YT_CATS = [
  ['gaming', 'Gaming', 'gaming'], ['music', 'Music', 'music'], ['news', 'News', 'news'], ['sports', 'Sports', 'sports'],
  ['talk', 'Podcasts & talk', 'podcast talk show'], ['cooking', 'Cooking', 'cooking'], ['education', 'Education', 'learn tutorial class'],
  ['tech', 'Science & tech', 'technology science'], ['travel', 'Travel & IRL', 'travel irl walk'], ['animals', 'Animals & pets', 'animals pets cam'],
  ['art', 'Art & design', 'art drawing'], ['fitness', 'Fitness', 'workout fitness'], ['anime', 'Anime', 'anime'], ['lofi', 'Lofi & radio', 'lofi radio'],
  ['religion', 'Religion', 'quran church prayer'], ['finance', 'Finance & crypto', 'crypto trading stocks'],
];

function curlJson(url) {
  return new Promise((resolve, reject) => execFile('curl', ['-s', '-m', '20', '-A', UA, url],
    { maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (e, out) => {
      if (e) return reject(new Error('curl failed: ' + e.message));
      try { resolve(JSON.parse(out)); } catch { reject(new Error('Kick blocked the request')); }
    }));
}
async function twitchGql(query) {
  const r = await fetch('https://gql.twitch.tv/gql', { method: 'POST', headers: { 'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko', 'Content-Type': 'application/json' }, body: JSON.stringify([{ query }]) });
  const j = await r.json();
  if (j[0].errors) throw new Error(j[0].errors[0].message);
  return j[0].data;
}
// Categories: Twitch = top games, or a live search; Kick = every category that has live streams (~700), filtered here;
// YouTube = our fixed list.
const kickCats = () => cached('kickcats', 10 * 60000, async () => {
  const pages = await Promise.all(Array.from({ length: 26 }, (_, i) => curlJson('https://kick.com/api/v1/subcategories?limit=50&page=' + (i + 1)).catch(() => ({ data: [] }))));
  const seen = new Set();
  return pages.flatMap((j) => j.data || []).filter((c) => c.viewers > 0 && !seen.has(c.slug) && seen.add(c.slug))
    .sort((x, y) => y.viewers - x.viewers).map((c) => ({ value: c.slug, name: c.name, viewers: c.viewers }));
});
async function categories(site, q) {
  const needle = (q || '').trim().toLowerCase();
  if (site === 'youtube') return YT_CATS.filter((c) => !needle || c[1].toLowerCase().includes(needle)).map((c) => ({ value: c[0], name: c[1] }));
  if (site === 'twitch') {
    if (needle) {
      const d = await twitchGql('{ searchCategories(query: ' + JSON.stringify(q.trim()) + ', first: 40) { edges { node { name viewersCount } } } }');
      return d.searchCategories.edges.map((e) => ({ value: e.node.name, name: e.node.name, viewers: e.node.viewersCount }));
    }
    const d = await twitchGql('{ games(first: 100) { edges { node { name viewersCount } } } }');
    return d.games.edges.map((e) => ({ value: e.node.name, name: e.node.name, viewers: e.node.viewersCount }));
  }
  const all = await kickCats();
  return (needle ? all.filter((c) => c.name.toLowerCase().includes(needle)) : all).slice(0, 150);
}

// ---- Twitch: cursor paging (browse) / search ----
const TW_NODE = 'viewersCount title previewImageURL(width: 320, height: 180) broadcaster { login displayName } game { name }';
const twItem = (n) => ({ url: 'https://www.twitch.tv/' + n.broadcaster.login, channel: n.broadcaster.displayName, title: n.title, viewers: n.viewersCount, thumb: n.previewImageURL, category: n.game && n.game.name });
// Twitch rejects "next page" cursors (integrity check), and a single query returns at most 30 streams.
// So we build a pool from many parallel queries (one per top category, or per language when a category
// is chosen), dedupe, sort by viewers and page through the pool ourselves.
async function twitchPool(lang, cat) {
  const L = langByCode(lang);
  const lopt = (code) => (code ? `, options: { broadcasterLanguages: [` + code + `] }` : '');
  const fields = `(first: 30@@) { edges { node { ` + TW_NODE + ` } } }`;
  const mk = (game, code) => {
    const f = fields.replace('@@', lopt(code));
    return game ? `{ game(name: ` + JSON.stringify(game) + `) { streams` + f + ` } }` : `{ streams` + f + ` }`;
  };
  const jobs = [];
  if (cat) {
    if (L && L[2]) jobs.push(mk(cat, L[2]));
    else LANGS.filter((l) => l[2]).forEach((l) => jobs.push(mk(cat, l[2])));
  } else {
    jobs.push(mk(null, L && L[2]));
    (await cached('cat:twitch:', 10 * 60000, () => categories('twitch', ''))).forEach((c) => jobs.push(mk(c.value, L && L[2])));
  }
  const results = await Promise.all(jobs.map((q) => twitchGql(q).catch(() => null)));
  const byLogin = new Map();
  for (const d of results) {
    const st = d && (d.game ? d.game.streams : d.streams);
    ((st && st.edges) || []).forEach((e) => byLogin.set(e.node.broadcaster.login, twItem(e.node)));
  }
  return [...byLogin.values()].sort((x, y) => (y.viewers || 0) - (x.viewers || 0));
}
async function liveTwitch(lang, cat, q, after) {
  if (q) return searchTwitch(q, after);
  const pool = await cached(`twpool:` + lang + ':' + cat, 60000, () => twitchPool(lang, cat));
  const off = parseInt(after, 10) || 0;
  return { items: pool.slice(off, off + PAGE), next: off + PAGE < pool.length ? String(off + PAGE) : null };
}
async function searchTwitch(q, after) {
  const qq = JSON.stringify(q), afterArg = after ? `, after: ${JSON.stringify(after)}` : '';
  const chan = after ? '' : `ch: searchFor(userQuery: ${qq}, platform: "web", options: { targets: [{ index: CHANNEL }] }) { channels { edges { item { ... on User { login displayName stream { viewersCount title game { name } previewImageURL(width: 320, height: 180) } } } } } }`;
  const d = await twitchGql(`{ ${chan} st: searchStreams(userQuery: ${qq}, first: ${PAGE}${afterArg}) { edges { cursor node { ${TW_NODE} } } pageInfo { hasNextPage } } }`);
  const out = [], seen = new Set();
  const push = (login, channel, n) => {
    if (seen.has(login.toLowerCase())) return; seen.add(login.toLowerCase());
    out.push({ url: 'https://www.twitch.tv/' + login, channel, title: n.title, viewers: n.viewersCount, thumb: n.previewImageURL, category: n.game && n.game.name });
  };
  ((d.ch && d.ch.channels && d.ch.channels.edges) || []).forEach(({ item }) => { if (item && item.stream) push(item.login, item.displayName, item.stream); });
  const edges = (d.st && d.st.edges) || [];
  edges.forEach(({ node: n }) => push(n.broadcaster.login, n.broadcaster.displayName, n));
  return { items: out, next: null };
}

// ---- Kick: its list API is page-based, sorted by viewers, with no language/search filter, so we scan pages
//      (cached) and filter here. One call collects about PAGE matches; "next" is the page to continue from.
const kickThumb = (t) => (t && (t.src || t.url || (t.srcset || '').split(' ')[0])) || '';
const kickItem = (d) => ({
  url: 'https://kick.com/' + d.channel.slug, channel: (d.channel.user && d.channel.user.username) || d.channel.slug, title: d.session_title,
  viewers: d.viewer_count, thumb: kickThumb(d.thumbnail), category: d.categories && d.categories[0] && d.categories[0].name,
});
const kickPage = (p, cat) => cached('kp:' + cat + ':' + p, 60000, () =>
  curlJson('https://kick.com/stream/livestreams/en?limit=32&sort=desc&page=' + p + (cat ? '&subcategory=' + encodeURIComponent(cat) : '')));
async function liveKick(lang, cat, q, after) {
  const L = langByCode(lang), wantLang = L && L[1].toLowerCase();
  const needle = (q || '').toLowerCase();
  const hay = (d) => [d.channel && d.channel.slug, d.channel && d.channel.user && d.channel.user.username, d.session_title, (d.categories || []).map((c) => c.name).join(' ')].join(' ').toLowerCase();
  const ok = (d) => d.is_live && d.channel && (!wantLang || (d.language || '').toLowerCase().startsWith(wantLang)) && (!needle || hay(d).includes(needle));
  let page = after ? parseInt(after, 10) || 1 : 1;
  const items = [], seen = new Set();
  const add = (d) => { if (seen.has(d.channel.slug)) return; seen.add(d.channel.slug); items.push(kickItem(d)); };
  if (needle && page === 1) { // exact channel name first (it may sit far down the viewer ranking)
    try {
      const c = await curlJson('https://kick.com/api/v2/channels/' + encodeURIComponent(q.trim().toLowerCase().replace(/[\s_]+/g, '-')));
      if (c && c.livestream && c.livestream.is_live) add({ ...c.livestream, channel: { slug: c.slug, user: c.user }, categories: c.livestream.categories });
    } catch {}
  }
  let exhausted = false, scanned = 0;
  while (items.length < PAGE && !exhausted && scanned < 80) {
    const batch = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => kickPage(page + i, cat).catch(() => ({ data: [] }))));
    for (const pg of batch) {
      if (!pg.data || !pg.data.length) { exhausted = true; break; }
      pg.data.filter(ok).forEach(add); page++; scanned++;
      if (items.length >= PAGE) break;
    }
  }
  return { items, next: exhausted ? null : String(page) };
}

// ---- YouTube: one cached search (up to 120 live results), sorted by viewers, served PAGE at a time ----
async function liveYoutube(q, cat, after) {
  const c = YT_CATS.find((x) => x[0] === cat);
  const query = [c && c[2], q].filter(Boolean).join(' ') || 'live';
  const all = await cached('yt:' + query, 90000, async () => {
    const url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query) + '&sp=EgJAAQ%253D%253D';
    const out = await ytdlp(['--flat-playlist', '-J', '--playlist-end', '120', '--no-warnings', url], 90000);
    return JSON.parse(out).entries.filter((e) => e.live_status === 'is_live' || e.concurrent_view_count != null)
      .map((e) => ({ url: 'https://www.youtube.com/watch?v=' + e.id, channel: e.channel || e.uploader || '', title: e.title, viewers: e.concurrent_view_count, thumb: (e.thumbnails || []).slice(-1)[0] && e.thumbnails.slice(-1)[0].url, category: c && c[1] }))
      .sort((a, b) => (b.viewers || 0) - (a.viewers || 0));
  });
  const off = parseInt(after, 10) || 0;
  return { items: all.slice(off, off + PAGE), next: off + PAGE < all.length ? String(off + PAGE) : null };
}

// TikTok has no public "browse live" list; we can only check specific usernames
async function tiktokStatus(user) {
  const api = `https://www.tiktok.com/api-live/user/room/?aid=1988&uniqueId=${encodeURIComponent(user)}&sourceType=54`;
  const r = await fetch(api, { headers: tiktokHeaders() });
  const j = await r.json();
  if (!j.data || !j.data.user) return { user, found: false };
  const room = j.data.liveRoom || {};
  const st = (room.liveRoomStats || {});
  return {
    user, found: true, live: room.status === 2, channel: j.data.user.nickname || user, title: room.title || '',
    viewers: st.userCount, thumb: room.coverUrl || j.data.user.avatarMedium, url: `https://www.tiktok.com/@${user}/live`,
  };
}

function proxyUrl(sid, abs) { return `/proxy?s=${sid}&u=${encodeURIComponent(abs)}`; }

function rewriteM3u8(text, base, sid) {
  const rewriteUri = (uri) => proxyUrl(sid, new URL(uri, base).href);
  return text.split(/\r?\n/).map((line) => {
    if (!line.trim()) return line;
    if (line.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${rewriteUri(uri)}"`);
    return rewriteUri(line.trim());
  }).join('\n');
}

async function handleProxy(req, res, q) {
  const sid = q.get('s');
  const target = q.get('u');
  const headers = sessions.get(sid);
  if (!headers || !target) { res.writeHead(404); return res.end('unknown stream'); }
  const up = Object.assign({}, headers);
  if (req.headers.range) up.Range = req.headers.range;
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  let r;
  try { r = await fetch(target, { headers: up, signal: ac.signal, redirect: 'follow' }); }
  catch (e) { if (!res.headersSent) { res.writeHead(502); res.end('upstream error'); } return; }
  const ct = r.headers.get('content-type') || '';
  const isM3u8 = /mpegurl/i.test(ct) || /\.m3u8(\?|$)/i.test(target);
  const out = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
  if (isM3u8) {
    const text = await r.text();
    out['Content-Type'] = 'application/vnd.apple.mpegurl';
    res.writeHead(r.status, out);
    return res.end(rewriteM3u8(text, r.url || target, sid));
  }
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const v = r.headers.get(h); if (v) out[h] = v;
  }
  res.writeHead(r.status, out);
  if (!r.body) return res.end();
  const stream = Readable.fromWeb(r.body);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

function serveStatic(req, res, pathname) {
  let p = decodeURIComponent(pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// ---------- Link finder: scan a web page's source for stream links (.m3u8 / .mp4 / .flv) ----------
// Deliberately simple: it downloads the page, its iframes and scripts (a few levels, size-limited) and
// looks for URLs in the text. It does not run scripts, decode or deobfuscate anything, or work around
// protection. Requests to private-network addresses are refused unless ALLOW_PRIVATE_URLS=1.
const dns = require('dns').promises;
const net = require('net');
const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE_URLS === '1';

function isPrivateIp(ip) {
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::') return true;
    if (/^f[cd]/.test(l) || /^fe[89ab]/.test(l)) return true;
    const m = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return m ? isPrivateIp(m[1]) : false;
  }
  const p = ip.split('.').map(Number);
  return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
}
async function assertPublic(u) {
  const url = new URL(u);
  if (!/^https?:$/.test(url.protocol)) throw new Error('Only http and https links are supported');
  if (ALLOW_PRIVATE) return url;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('That address is on a private network and is blocked for safety');
  return url;
}
// fetch with redirect checking, a time limit and a size limit
async function safeFetch(u, { maxBytes = 1500000, timeout = 15000, headers = {} } = {}) {
  let cur = u;
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(cur);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    try {
      const r = await fetch(cur, { headers: Object.assign({ 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.8' }, headers), redirect: 'manual', signal: ac.signal });
      if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.get('location')) { cur = new URL(r.headers.get('location'), cur).href; try { await r.body.cancel(); } catch {} continue; }
      const chunks = []; let total = 0, truncated = false;
      if (r.body) {
        const reader = r.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(Buffer.from(value)); total += value.length;
          if (total >= maxBytes) { truncated = true; try { await reader.cancel(); } catch {} break; }
        }
      }
      return { status: r.status, url: cur, headers: r.headers, body: Buffer.concat(chunks).slice(0, maxBytes), truncated };
    } finally { clearTimeout(timer); }
  }
  throw new Error('Too many redirects');
}

const KIND = { m3u8: 'hls', mp4: 'mp4', flv: 'flv' };
const EXT_RE = '(?:m3u8|mp4|flv)';
// pull media URLs out of text (page source, script, JSON); resolves relative and protocol-relative links
function extractMedia(raw, base) {
  const t = raw.replace(/\\\//g, '/').replace(/\\u0026/gi, '&').replace(/\\x2F/gi, '/').replace(/&amp;/g, '&');
  const found = new Map();
  const add = (u, idx) => {
    let abs; try { abs = new URL(u, base).href; } catch { return; }
    if (!/^https?:/i.test(abs)) return;
    abs = abs.replace(/#.*$/, '');
    const ext = (abs.split('?')[0].match(/\.(m3u8|mp4|flv)$/i) || [])[1];
    if (!ext || found.has(abs)) return;
    const ctx = t.slice(Math.max(0, idx - 90), idx).toLowerCase();
    const via = /<video[^>]*$/.test(ctx) || /<source[^>]*$/.test(ctx) ? 'video tag' : /og:video|twitter:player:stream/.test(ctx) ? 'meta tag' : 'page source';
    found.set(abs, { url: abs, kind: KIND[ext.toLowerCase()], via });
  };
  let m;
  const abs = new RegExp('https?://[^\\s"\'<>\\\\)\\]},;]+?\\.' + EXT_RE + '(?:\\?[^\\s"\'<>\\\\)\\]},;]*)?(?=["\'\\s<>\\\\)\\]},;]|$)', 'gi');
  while ((m = abs.exec(t))) add(m[0], m.index);
  const proto = new RegExp('(?:^|["\'(=\\s])(//[^\\s"\'<>\\\\)]+?\\.' + EXT_RE + '(?:\\?[^\\s"\'<>\\\\)]*)?)(?=["\'\\s<>\\\\)]|$)', 'gi');
  while ((m = proto.exec(t))) add('https:' + m[1], m.index);
  const rel = new RegExp('["\'(=]\\s*((?!https?:|//|data:|javascript:)[\\w\\-./%~]+?\\.' + EXT_RE + '(?:\\?[^"\'\\s<>)]*)?)\\s*["\')]', 'gi');
  while ((m = rel.exec(t))) add(m[1], m.index);
  return [...found.values()];
}
const attrUrls = (html, tag, attr, base) => {
  const out = [], re = new RegExp('<' + tag + '\\b[^>]*?\\b' + attr + '\\s*=\\s*["\']([^"\']+)["\']', 'gi');
  let m;
  while ((m = re.exec(html))) { try { const u = new URL(m[1].replace(/&amp;/g, '&'), base).href; if (/^https?:/i.test(u)) out.push(u); } catch {} }
  return [...new Set(out)];
};

// turn low-level network errors into something readable
function friendlyError(e) {
  const code = (e.cause && (e.cause.code || (e.cause.errors && e.cause.errors[0] && e.cause.errors[0].code))) || e.code || '';
  if (e.name === 'AbortError' || /TIMEOUT/.test(code)) return 'The server took too long to answer.';
  if (code === 'ENOTFOUND') return 'That address does not exist (name lookup failed).';
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET') return 'The server refused or dropped the connection.';
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) return "The site's security certificate is not valid.";
  return e.message;
}

async function inspectPage(inputUrl) {
  let start = inputUrl.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(start) && !/^https?:\/\//i.test(start)) throw new Error('Only http and https links are supported');
  if (!/^https?:\/\//i.test(start)) start = 'https://' + start;
  const scanned = [], results = new Map();
  let budget = 18; // total downloads
  const note = (e) => { if (!results.has(e.url)) results.set(e.url, e); };

  const scan = async (url, kind, referer, depth) => {
    if (budget-- <= 0) return null;
    try {
      const r = await safeFetch(url, { headers: referer ? { Referer: referer } : {} });
      const text = r.body.toString('utf8');
      scanned.push({ url: r.url, kind, status: r.status, bytes: r.body.length, truncated: r.truncated });
      const label = kind === 'page' ? 'the page' : kind === 'iframe' ? 'frame ' + new URL(r.url).host : 'script ' + (new URL(r.url).pathname.split('/').pop() || r.url);
      // a direct media link given as the "page"
      if (kind === 'page' && /\.(m3u8|mp4|flv)(\?|$)/i.test(r.url)) note({ url: r.url, kind: KIND[(r.url.split('?')[0].match(/\.(m3u8|mp4|flv)$/i) || [])[1].toLowerCase()], via: 'the link you gave', where: label });
      extractMedia(text, r.url).forEach((e) => note(Object.assign(e, { where: label })));
      return { r, text };
    } catch (e) {
      scanned.push({ url, kind, error: friendlyError(e) });
      return null;
    }
  };

  const page = await scan(start, 'page', '', 0);
  if (!page) throw new Error(scanned[0].error || 'Could not load the page');
  const title = (page.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  const pageUrl = page.r.url;
  // frames and scripts: up to two levels of frames, a handful of scripts per document
  let frames = attrUrls(page.text, 'iframe', 'src', pageUrl).slice(0, 6).map((u) => [u, pageUrl]);
  const scripts = attrUrls(page.text, 'script', 'src', pageUrl).slice(0, 6).map((u) => [u, pageUrl]);
  const docs = [];
  await Promise.all(frames.map(async ([u, ref]) => { const d = await scan(u, 'iframe', ref, 1); if (d) docs.push(d); }));
  const scripts2 = [];
  for (const d of docs) {
    const base = d.r.url;
    frames = attrUrls(d.text, 'iframe', 'src', base).slice(0, 3).map((u) => [u, base]);
    attrUrls(d.text, 'script', 'src', base).slice(0, 4).forEach((u) => scripts2.push([u, base]));
    await Promise.all(frames.map(async ([u, ref]) => { const x = await scan(u, 'iframe', ref, 2); if (x) attrUrls(x.text, 'script', 'src', x.r.url).slice(0, 3).forEach((s) => scripts2.push([s, x.r.url])); }));
  }
  await Promise.all([...scripts, ...scripts2].map(([u, ref]) => scan(u, 'script', ref, 1)));

  const order = { hls: 0, flv: 1, mp4: 2 };
  const list = [...results.values()].sort((a, b) => order[a.kind] - order[b.kind]).slice(0, 100);
  return { page: { url: pageUrl, title: title ? title.replace(/\s+/g, ' ').trim().slice(0, 140) : '' }, results: list, scanned };
}

// quick check of one candidate link: does it answer, and does it look like what its extension says?
async function probeLink(u) {
  const r = await safeFetch(u, { maxBytes: 400000, timeout: 15000, headers: { Range: 'bytes=0-399999' } });
  const ct = r.headers.get('content-type') || '';
  const out = { status: r.status, finalUrl: r.url, contentType: ct, bytes: r.body.length, contentLength: r.headers.get('content-length') || null };
  const head = r.body.slice(0, 16).toString('latin1'), text = r.body.toString('utf8');
  const path = r.url.split('?')[0].toLowerCase();
  if (r.status >= 400) { out.ok = false; out.note = r.status === 403 || r.status === 401 ? 'The server refuses a direct request (it may only serve the page that embeds it).' : 'The server returned an error.'; return out; }
  if (path.endsWith('.m3u8') || /mpegurl/i.test(ct) || head.startsWith('#EXTM3U')) {
    out.kind = 'hls'; out.ok = text.startsWith('#EXTM3U');
    if (out.ok) {
      const res = [...text.matchAll(/RESOLUTION=\d+x(\d+)/g)].map((x) => +x[1]);
      out.variants = (text.match(/#EXT-X-STREAM-INF/g) || []).length;
      out.heights = [...new Set(res)].sort((a, b) => a - b);
      out.segments = (text.match(/#EXTINF/g) || []).length;
      out.live = out.segments > 0 ? !/#EXT-X-ENDLIST/.test(text) : null; // unknown for a master playlist
      out.encrypted = /#EXT-X-KEY:[^\n]*METHOD=(AES-128|SAMPLE-AES)/.test(text);
    }
  } else if (path.endsWith('.flv')) { out.kind = 'flv'; out.ok = head.startsWith('FLV'); }
  else {
    out.kind = 'mp4'; out.ok = r.body.slice(4, 8).toString('latin1') === 'ftyp' || /^video\//i.test(ct);
    if (!out.ok && /text\/html/i.test(ct)) out.note = 'This link returns a web page, not a video file.';
  }
  return out;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/config') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ signin: SIGNIN_ENABLED && fromLocalNetwork(req) }));
    }
    if (url.pathname === '/api/resolve') {
      res.setHeader('Content-Type', 'application/json');
      try {
        let target = url.searchParams.get('url') || '', embed = url.searchParams.get('embed') === '1', cookies = '';
        if (req.method === 'POST') {
          const body = await new Promise((ok, bad) => {
            let size = 0; const parts = [];
            req.on('data', (c) => { size += c.length; if (size > 65536) { bad(new Error('Request too large')); req.destroy(); } else parts.push(c); });
            req.on('end', () => { try { ok(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch { bad(new Error('Invalid request')); } });
            req.on('error', bad);
          });
          target = String(body.url || ''); embed = !!body.embed;
          if (body.cookies && SIGNIN_ENABLED && fromLocalNetwork(req)) cookies = String(body.cookies).slice(0, 16384);
        }
        const data = await withSignin(target, cookies, () => resolve(target, embed));
        res.end(JSON.stringify(data));
      } catch (e) {
        res.statusCode = 422;
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }
    if (url.pathname === '/api/categories' || url.pathname === '/api/languages') {
      res.setHeader('Content-Type', 'application/json');
      const site = url.searchParams.get('site');
      try {
        if (!['twitch', 'kick', 'youtube'].includes(site)) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'unknown site' })); }
        if (url.pathname === '/api/languages') return res.end(JSON.stringify({ items: langsFor(site) }));
        const cq = (url.searchParams.get('q') || '').trim();
        return res.end(JSON.stringify({ items: await cached('cat:' + site + ':' + cq, cq ? 5 * 60000 : 10 * 60000, () => categories(site, cq)) }));
      } catch (e) { res.statusCode = 502; return res.end(JSON.stringify({ error: e.message })); }
    }
    if (url.pathname === '/api/live') {
      res.setHeader('Content-Type', 'application/json');
      const p = url.searchParams, site = p.get('site'), lang = p.get('lang') || '', cat = p.get('cat') || '', q = (p.get('q') || '').trim(), after = p.get('after') || '';
      try {
        if (site === 'twitch') return res.end(JSON.stringify(await cached(['tw', lang, cat, q, after].join('|'), 45000, () => liveTwitch(lang, cat, q, after))));
        if (site === 'kick') return res.end(JSON.stringify(await cached(['ki', lang, cat, q, after].join('|'), 45000, () => liveKick(lang, cat, q, after))));
        if (site === 'youtube') return res.end(JSON.stringify(await liveYoutube(q, cat, after)));
        if (site === 'tiktok') {
          const users = (p.get('users') || '').split(',').map((x) => x.trim().replace(/^@/, '')).filter(Boolean).slice(0, 30);
          return res.end(JSON.stringify({ items: await Promise.all(users.map((u) => tiktokStatus(u).catch(() => ({ user: u, found: false })))), next: null }));
        }
        res.statusCode = 400; return res.end(JSON.stringify({ error: 'unknown site' }));
      } catch (e) { res.statusCode = 502; return res.end(JSON.stringify({ error: e.message })); }
    }
    if (url.pathname === '/api/inspect' || url.pathname === '/api/probe') {
      res.setHeader('Content-Type', 'application/json');
      const target = (url.searchParams.get('url') || '').trim();
      try {
        if (!target) throw new Error('Enter a link');
        const data = url.pathname === '/api/inspect' ? await inspectPage(target) : await probeLink(target);
        return res.end(JSON.stringify(data));
      } catch (e) { res.statusCode = 422; return res.end(JSON.stringify({ error: friendlyError(e) })); }
    }
    if (url.pathname === '/master') {
      const text = masters.get(url.searchParams.get('id'));
      if (!text) { res.writeHead(404); return res.end('expired'); }
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
      return res.end(text);
    }
    if (url.pathname === '/proxy') return handleProxy(req, res, url.searchParams);
    serveStatic(req, res, url.pathname);
  } catch (e) {
    if (!res.headersSent) res.writeHead(500);
    res.end('server error');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`SplitDeck running at http://localhost:${PORT}`));
