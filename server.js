// SplitDeck local server: static files + /api/resolve (yt-dlp) + /proxy (CORS/header-adding stream proxy)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { Readable } = require('stream');

const PORT = process.env.PORT || 8787;
const PUBLIC = path.join(__dirname, 'public');
// yt-dlp: $YTDLP, else the copy downloaded by `npm run setup`, else whatever is on PATH
const BUNDLED = path.join(__dirname, 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const YTDLP = process.env.YTDLP || (fs.existsSync(BUNDLED) ? BUNDLED : 'yt-dlp');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};

// stream sessions: id -> headers to send upstream
const sessions = new Map();

function ytdlp(args, timeout = 45000) {
  return new Promise((resolve, reject) => {
    execFile(YTDLP, args, { timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
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
  return out;
}

// TikTok LIVE straight from TikTok's web API. yt-dlp's TikTok live detection is flaky
// ("not currently live" while the channel is live), so this runs first and yt-dlp is the fallback.
function tiktokLiveUser(u) {
  const m = u.match(/tiktok\.com\/@([\w.\-]+)\/live/i);
  return m ? m[1] : null;
}
async function resolveTiktokLive(user) {
  const api = `https://www.tiktok.com/api-live/user/room/?aid=1988&uniqueId=${encodeURIComponent(user)}&sourceType=54`;
  let j;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(api, { headers: { 'User-Agent': UA, Referer: 'https://www.tiktok.com/', Accept: 'application/json' } });
      j = await r.json();
      if (j && j.data && j.data.user) break;
    } catch {}
    await new Promise((res) => setTimeout(res, 600));
  }
  const room = j && j.data && j.data.liveRoom;
  if (!j || !j.data || !j.data.user) throw new Error('TikTok did not answer (try again in a moment)');
  if (!room || room.status !== 2 || !room.streamData) throw new Error('TikTok says this channel is not live right now');
  const sd = JSON.parse(room.streamData.pull_data.stream_data).data;
  const sources = [];
  const sid = crypto.randomBytes(8).toString('hex');
  sessions.set(sid, { 'User-Agent': UA, Referer: 'https://www.tiktok.com/' });
  setTimeout(() => sessions.delete(sid), 6 * 3600 * 1000).unref();
  const px = (url) => `/proxy?s=${sid}&u=${encodeURIComponent(url)}`;
  for (const q of ['origin', 'uhd', 'hd', 'sd', 'ld']) {
    const m = sd[q] && sd[q].main;
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
    catch (e) { console.log('tiktok native failed:', e.message, '- trying yt-dlp'); }
  }
  const out = await ytdlp(['-J', '--no-playlist', '--no-warnings', u]);
  const info = JSON.parse(out);
  const picks = pickFormats(info);
  if (!picks.length) throw new Error('No playable video stream found');
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
  const r = await fetch(api, { headers: { 'User-Agent': UA, Referer: 'https://www.tiktok.com/', Accept: 'application/json' } });
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

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/resolve') {
      res.setHeader('Content-Type', 'application/json');
      try {
        const data = await resolve(url.searchParams.get('url') || '', url.searchParams.get('embed') === '1');
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
