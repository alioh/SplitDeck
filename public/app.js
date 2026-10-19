(() => {
const MAX = 8;
const $ = (s) => document.querySelector(s);
const stage = $('#stage'), emptyEl = $('#empty'), countEl = $('#count');
const form = $('#addForm'), input = $('#urlInput'), addBtn = $('#addBtn');
const layoutBtn = $('#layoutBtn'), layoutPop = $('#layoutPop');

/* ---------------- layout engine ----------------
   A layout is a split tree: leaves are player slots, inner nodes split their area
   into side-by-side ('h') or stacked ('v') children with adjustable ratios.
   Every inner node gets a draggable divider. */
let leafCtr = 0;
const LF = () => ({ leaf: true, i: leafCtr++ });
const eq = (k) => Array(k).fill(1 / k);
const split = (dir, r, kids) => ({ dir, r: r.slice(), def: r.slice(), kids });
const leaves = (k) => Array.from({ length: k }, LF);
// k equal tiles side by side / stacked
const rowOf = (k) => (k === 1 ? LF() : split('h', eq(k), leaves(k)));
const colOf = (k) => (k === 1 ? LF() : split('v', eq(k), leaves(k)));
const rowsT = (counts) => (counts.length === 1 ? rowOf(counts[0]) : split('v', eq(counts.length), counts.map(rowOf)));
const colsT = (counts) => (counts.length === 1 ? colOf(counts[0]) : split('h', eq(counts.length), counts.map(colOf)));
function balanced(n, maxCols) {
  const cols = Math.min(maxCols, n <= 2 ? n : n <= 4 ? 2 : n <= 6 ? 3 : 4);
  const counts = [];
  for (let left = n; left > 0; left -= cols) counts.push(Math.min(cols, left));
  return counts;
}
const stackT = (m) => (m <= 4 ? colOf(m) : rowsT(balanced(m, 2)));
const stripT = (m) => (m <= 4 ? rowOf(m) : rowsT(balanced(m, 4)));

function computeLayout(tree) {
  const rects = [], dividers = [];
  (function walk(node, r) {
    if (node.leaf) { rects[node.i] = r; return; }
    const h = node.dir === 'h';
    let pos = h ? r.x : r.y;
    node.kids.forEach((kid, k) => {
      const size = node.r[k] * (h ? r.w : r.h);
      walk(kid, h ? { x: pos, y: r.y, w: size, h: r.h } : { x: r.x, y: pos, w: r.w, h: size });
      pos += size;
      if (k < node.kids.length - 1) dividers.push({ node, k, rect: r, at: pos });
    });
  })(tree, { x: 0, y: 0, w: 1, h: 1 });
  return { rects, dividers };
}
const collectRatios = (tree) => {
  const out = [];
  (function walk(n) { if (n.leaf) return; out.push(n.r.slice()); n.kids.forEach(walk); })(tree);
  return out;
};
const applyRatios = (tree, saved) => {
  let idx = 0;
  (function walk(n) {
    if (n.leaf) return;
    const s = saved[idx++];
    if (s && s.length === n.r.length) n.r = s.slice();
    n.kids.forEach(walk);
  })(tree);
};

// build the list of layouts offered for n players (fresh trees)
function buildLayouts(n) {
  if (n <= 1) { leafCtr = 0; return [{ name: 'Single', tree: LF() }]; }
  const defs = [], m = n - 1, f = n === 2 ? 0.7 : 0.66;
  const def = (name, fn) => defs.push({ name, fn });
  if (n === 2) {
    def('Side by side', () => rowOf(2));
    def('Stacked', () => colOf(2));
  } else {
    def('Grid', () => rowsT(balanced(n, 4)));
    def('Grid (flipped)', () => colsT(balanced(n, 4)));
  }
  def('Big left', () => { const b = LF(); return split('h', [f, 1 - f], [b, stackT(m)]); });
  def('Big right', () => { const b = LF(); const s = stackT(m); return split('h', [1 - f, f], [s, b]); });
  def('Big top', () => { const b = LF(); return split('v', [f, 1 - f], [b, stripT(m)]); });
  def('Big bottom', () => { const b = LF(); const s = stripT(m); return split('v', [1 - f, f], [s, b]); });
  if (n >= 3) {
    const a = Math.floor(n / 2), b = n - a;
    def('2 columns', () => rowsT(balanced(n, 2)));
    def(`${a} | ${b}`, () => colsT([a, b]));
    if (a !== b) def(`${b} | ${a}`, () => colsT([b, a]));
    def(`${a} / ${b}`, () => rowsT([a, b]));
    if (a !== b) def(`${b} / ${a}`, () => rowsT([b, a]));
    // one small, the rest big
    def('Small left', () => { const s = LF(); return split('h', [0.2, 0.8], [s, rowsT(balanced(m, 3))]); });
    def('Small top', () => { const s = LF(); return split('v', [0.25, 0.75], [s, rowsT(balanced(m, 3))]); });
    if (n <= 5) { def('Row', () => rowOf(n)); def('Column', () => colOf(n)); }
  }
  const out = [], seen = new Set();
  for (const d of defs) {
    leafCtr = 0;
    const tree = d.fn();
    const sig = computeLayout(tree).rects.map((r) => [r.x, r.y, r.w, r.h].map((v) => v.toFixed(3)).join(',')).join('|');
    if (!seen.has(sig)) { seen.add(sig); out.push({ name: d.name, tree }); }
  }
  return out;
}

/* ---------------- state ---------------- */
const tiles = [];          // index = slot
const layoutPref = {};     // n -> layout name
const ratioStore = {};     // "n:name" -> saved divider ratios
const layoutCache = {};    // n -> built layouts (kept so dragged ratios persist while you work)
let nextId = 1;

const snapshot = () => tiles.map((t) => ({ url: t.url, vol: t.vol, muted: t.muted, fill: t.fill }));
function save() {
  try { localStorage.setItem('splitdeck.v2', JSON.stringify({ tiles: snapshot(), layoutPref, ratioStore })); } catch {}
}
function currentLayouts() {
  const n = tiles.length;
  if (!layoutCache[n]) {
    layoutCache[n] = buildLayouts(n);
    layoutCache[n].forEach((l) => { const s = ratioStore[n + ':' + l.name]; if (s) applyRatios(l.tree, s); });
  }
  return layoutCache[n];
}
function currentLayout() {
  const ls = currentLayouts();
  const chosen = ls.find((l) => l.name === layoutPref[tiles.length]);
  if (chosen) return chosen;
  // no choice yet: in portrait (phones) prefer stacked layouts so every picture stays wide
  const portrait = stage.clientHeight > stage.clientWidth * 1.05, n = tiles.length;
  // phones (narrow): one wide picture per row; tablets (wide): two columns from 4 players up
  const wide = stage.clientWidth >= 600;
  const want = !portrait || n < 2 ? [] : n === 2 ? ['Stacked'] : wide ? (n === 3 ? ['Column'] : ['2 columns', 'Grid']) : n <= 5 ? ['Column'] : ['2 columns'];
  for (const w of want) { const f = ls.find((l) => l.name === w); if (f) return f; } // first match in order of preference
  return ls[0];
}

/* ---------------- rendering ---------------- */
let dividerEls = [];
function applyLayout(rebuildPop = true) {
  const n = tiles.length;
  emptyEl.hidden = n > 0;
  countEl.textContent = `${n} / ${MAX}`;
  addBtn.disabled = n >= MAX;
  layoutBtn.disabled = n < 2;
  if (!n) { dividerEls.forEach((d) => d.remove()); dividerEls = []; return; }
  const lay = currentLayout();
  const { rects, dividers } = computeLayout(lay.tree);
  tiles.forEach((t, i) => {
    const s = rects[i];
    Object.assign(t.el.style, { left: s.x * 100 + '%', top: s.y * 100 + '%', width: s.w * 100 + '%', height: s.h * 100 + '%' });
  });
  placeDividers(dividers);
  if (rebuildPop) buildLayoutPop();
}
function placeDividers(dividers) {
  if (dividerEls.length !== dividers.length) {
    dividerEls.forEach((d) => d.remove());
    dividerEls = dividers.map(() => makeDivider());
  }
  dividers.forEach((d, i) => {
    const el = dividerEls[i], h = d.node.dir === 'h';
    el._d = d;
    el.className = 'divider ' + (h ? 'dv' : 'dh');
    if (h) Object.assign(el.style, { left: d.at * 100 + '%', top: d.rect.y * 100 + '%', height: d.rect.h * 100 + '%', width: '', });
    else Object.assign(el.style, { top: d.at * 100 + '%', left: d.rect.x * 100 + '%', width: d.rect.w * 100 + '%', height: '' });
  });
}
function makeDivider() {
  const el = document.createElement('div');
  stage.appendChild(el);
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault(); el.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing', el._d.node.dir === 'h' ? 'rs-h' : 'rs-v');
    const startD = el._d, node = startD.node, k = startD.k;
    const before = node.r.slice(), pairSum = before[k] + before[k + 1];
    const lead = before.slice(0, k).reduce((a, b) => a + b, 0);
    const sr = stage.getBoundingClientRect(), MIN = 0.08;
    const move = (ev) => {
      const h = node.dir === 'h', rect = startD.rect;
      const p = h ? (ev.clientX - sr.left) / sr.width : (ev.clientY - sr.top) / sr.height;
      const frac = (p - (h ? rect.x : rect.y)) / (h ? rect.w : rect.h);
      let a = frac - lead;
      a = Math.max(MIN, Math.min(pairSum - MIN, a));
      node.r[k] = a; node.r[k + 1] = pairSum - a;
      applyLayout(false);
    };
    const up = () => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      document.body.classList.remove('resizing', 'rs-h', 'rs-v');
      persistRatios();
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  });
  // double-click a divider: reset that split to its default proportions
  el.addEventListener('dblclick', () => { const n = el._d.node; n.r = n.def.slice(); applyLayout(false); persistRatios(); });
  return el;
}
function persistRatios() {
  const lay = currentLayout();
  ratioStore[tiles.length + ':' + lay.name] = collectRatios(lay.tree);
  save();
}
function buildLayoutPop() {
  layoutPop.innerHTML = '';
  const cur = currentLayout();
  currentLayouts().forEach((l) => {
    const { rects } = computeLayout(l.tree);
    const b = document.createElement('div');
    b.className = 'lay' + (l === cur ? ' on' : '');
    b.innerHTML = `<div class="th">${rects.map((s) => `<i style="left:${s.x * 100}%;top:${s.y * 100}%;width:${s.w * 100}%;height:${s.h * 100}%"></i>`).join('')}</div><span>${l.name}</span>`;
    b.onclick = () => { layoutPref[tiles.length] = l.name; applyLayout(); save(); };
    layoutPop.appendChild(b);
  });
}

function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 4500);
}

/* ---------------- tiles ---------------- */
const ICON = { vol: '🔊', mute: '🔇' };

function createTile(url, opts = {}) {
  const t = {
    id: nextId++, url, vol: opts.vol ?? 0.6, muted: opts.muted ?? false, fill: !!opts.fill,
    title: url, source: '', live: false, kind: null, paused: false, ready: false,
  };
  const el = document.createElement('div');
  el.className = 'tile';
  el.innerHTML = `
    <div class="box">
      <div class="media"></div>
      <div class="shield"></div>
      <div class="status"><div class="spin"></div><div class="msg">Resolving stream…</div></div>
      <div class="hud top">
        <button class="grip" draggable="true" title="Drag onto another player to swap places">⋮⋮</button>
        <a class="lnk" target="_blank" rel="noopener noreferrer" title="Open the original page in a new tab">↗</a>
        <div class="ttl"></div>
        <button data-a="main" title="Make this the main (first) player">★ Main</button>
        <button data-a="fit" title="Fit / fill">⤢</button>
        <button data-a="reload" title="Reload">⟳</button>
        <button data-a="fs" title="Fullscreen">⛶</button>
        <button data-a="close" title="Close">✕</button>
      </div>
      <div class="hud bot">
        <div class="seekrow" hidden><span class="tcur">0:00</span><input class="seek" type="range" min="0" max="1000" step="1" value="0"><span class="tdur">0:00</span></div>
        <button data-a="play" title="Play / pause">⏸</button>
        <button data-a="mute" title="Mute / unmute"></button>
        <input class="vol" type="range" min="0" max="1" step="0.01">
        <button data-a="solo" title="Only hear this one">Solo</button>
        <span class="grow"></span>
        <button data-a="cc" hidden title="Captions on/off">CC</button>
        <button data-a="cfg" title="Settings: speed, quality, captions, audio">⚙</button>
      </div>
      <div class="dropzone">Swap here</div>
    </div>`;
  t.el = el;
  t.box = el.querySelector('.box');
  t.media = el.querySelector('.media');
  t.status = el.querySelector('.status');
  t.volEl = el.querySelector('.vol');
  t.seekRow = el.querySelector('.seekrow'); t.seek = el.querySelector('.seek');
  t.tcur = el.querySelector('.tcur'); t.tdur = el.querySelector('.tdur');
  t.muteBtn = el.querySelector('[data-a=mute]');
  t.ttl = el.querySelector('.ttl');
  el.querySelector('.lnk').href = /^https?:\/\//i.test(url) ? url : 'https://' + url;
  t.box.classList.toggle('fill', t.fill);
  t.ttl.textContent = url;
  stage.appendChild(el);
  tiles.push(t);

  el.querySelectorAll('[data-a]').forEach((b) => (b.onclick = () => action(t, b.dataset.a)));
  t.seek.oninput = () => { t.seeking = true; t.tcur.textContent = fmt((t.seek.value / 1000) * t.dur); };
  t.seek.onchange = () => {
    const to = (t.seek.value / 1000) * t.dur;
    if (t.video) t.video.currentTime = to;
    if (t.iframe) ytCmd(t, 'seekTo', [to, true]);
    t.seeking = false;
  };
  t.volEl.oninput = () => { t.vol = +t.volEl.value; t.muted = t.vol === 0; applyAudio(t); applyAudioUI(t); save(); };
  el.addEventListener('dblclick', (e) => { if (!e.target.closest('.hud')) action(t, 'fs'); });
  // hide cursor + HUD after a moment of stillness
  let idleT;
  t.box.addEventListener('mousemove', () => {
    t.box.classList.remove('idle'); clearTimeout(idleT);
    idleT = setTimeout(() => t.box.classList.add('idle'), 2800);
  });
  t.box.addEventListener('mouseleave', () => { clearTimeout(idleT); t.box.classList.remove('idle'); });
  // touch: tap the picture to show its controls; they hide again after a few seconds
  const bump = () => { clearTimeout(t.hideT); t.hideT = setTimeout(() => { if (!t.menu) t.box.classList.remove('active'); }, 4500); };
  t.box.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse') return;
    if (e.target.closest('.hud, .cfgmenu, .divider')) { bump(); return; }
    const on = !t.box.classList.contains('active');
    tiles.forEach((o) => o.box.classList.remove('active'));
    if (on) { t.box.classList.add('active'); bump(); }
  });
  setupDnD(t);
  applyAudioUI(t);
  applyLayout();
  load(t);
  return t;
}

async function load(t, direct = false) {
  destroyMedia(t);
  setStatus(t, 'loading', 'Resolving stream…');
  let data;
  try {
    const r = await fetch('/api/resolve?url=' + encodeURIComponent(t.url) + (t.pref === 'embed' ? '&embed=1' : ''));
    data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Could not resolve');
  } catch (e) { return setStatus(t, 'err', e.message); }
  if (!tiles.includes(t)) return;
  t.kind = data.type; t.title = data.title || t.url; t.live = !!data.live; t.source = data.source || '';
  t.native = !!data.native; t.captions = data.captions || []; t.capIdx = -1;
  t.el.querySelector('[data-a=cc]').hidden = !t.captions.length; t.el.querySelector('[data-a=cc]').classList.remove('on');
  t.ttl.innerHTML = `${t.live ? '<span class="live">LIVE</span> ' : ''}<small>${esc(prettySource(t.source))}</small>${esc(t.title)}`;
  t.paused = false; setPlayIcon(t); t.ytDur = 0; t.ytCur = 0;
  try {
    if (data.type === 'youtube') mountYoutube(t, data.id);
    else if (data.type === 'embed') mountEmbed(t, data.url);
    else mountVideo(t, data);
  } catch (e) { setStatus(t, 'err', e.message); }
}

function destroyMedia(t) {
  if (t.hls) { try { t.hls.destroy(); } catch {} t.hls = null; }
  if (t.mpegts) { try { t.mpegts.destroy(); } catch {} t.mpegts = null; }
  if (t.ytTimer) { clearInterval(t.ytTimer); t.ytTimer = null; }
  if (t.onMsg) { window.removeEventListener('message', t.onMsg); t.onMsg = null; }
  t.video = null; t.iframe = null; t.ready = false; t.dur = 0; t.seekRow.hidden = true; closeCfg(t);
  t.media.innerHTML = '';
}

const fmt = (sec) => {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = String(sec % 60).padStart(2, '0');
  return h ? h + ':' + String(m).padStart(2, '0') + ':' + x : m + ':' + x;
};
// show a seek bar only for things with a real duration (not live streams)
function updateProgress(t, cur, dur) {
  const ok = dur > 0 && isFinite(dur) && !t.live;
  t.seekRow.hidden = !ok;
  if (!ok) return;
  t.dur = dur; t.tdur.textContent = fmt(dur);
  if (!t.seeking) { t.seek.value = Math.round((cur / dur) * 1000); t.tcur.textContent = fmt(cur); }
}

function setStatus(t, kind, msg) {
  const s = t.status;
  if (kind === 'ok') { s.hidden = true; return; }
  s.hidden = false; s.className = 'status' + (kind === 'err' ? ' err' : '');
  s.innerHTML = kind === 'err'
    ? `<div>${esc(msg)}</div><button>Retry</button>` : `<div class="spin"></div><div class="msg">${esc(msg)}</div>`;
  const b = s.querySelector('button'); if (b) b.onclick = () => load(t);
}

function mountVideo(t, data, i = 0) {
  const sources = data.sources || [{ type: data.type, url: data.url }];
  const src = sources[i];
  // on a hard failure try the next candidate format (e.g. HLS -> FLV) before giving up
  const fail = (msg) => {
    if (t.mountedFor !== src) return;
    if (i + 1 < sources.length) { destroyMedia(t); setStatus(t, 'loading', 'Trying another format…'); return mountVideo(t, data, i + 1); }
    setStatus(t, 'err', msg);
  };
  t.mountedFor = src;
  const v = document.createElement('video');
  v.playsInline = true; v.autoplay = true; v.controls = false;
  t.media.appendChild(v); t.video = v;
  (t.captions || []).forEach((c) => {
    const tr = document.createElement('track');
    tr.kind = 'subtitles'; tr.label = c.name; tr.srclang = String(c.code || '').slice(0, 2); tr.src = c.url;
    v.appendChild(tr);
  });
  [...v.textTracks].forEach((x) => { x.mode = 'disabled'; }); // captions start off, like YouTube
  v.playbackRate = t.speed || 1;
  v.addEventListener('playing', () => setStatus(t, 'ok'));
  v.addEventListener('waiting', () => { if (!v.paused && v.readyState < 3) setStatus(t, 'loading', 'Buffering…'); });
  v.addEventListener('canplay', () => setStatus(t, 'ok'));
  const prog = () => updateProgress(t, v.currentTime, v.duration);
  v.addEventListener('timeupdate', prog); v.addEventListener('durationchange', prog);
  v.addEventListener('ended', () => setStatus(t, 'err', t.live ? 'Stream ended' : 'Finished'));
  applyAudio(t);
  const start = () => v.play().catch(() => { t.muted = true; applyAudio(t); applyAudioUI(t); v.play().catch(() => {}); });
  // if nothing plays within 15s, treat it as a failure of this format
  const watchdog = setTimeout(() => { if (t.mountedFor === src && v.readyState < 2) fail('Stream did not start (offline or blocked)'); }, 15000);
  v.addEventListener('playing', () => clearTimeout(watchdog), { once: true });

  if (src.type === 'hls') {
    if (window.Hls && Hls.isSupported()) {
      const hls = new Hls({ lowLatencyMode: true, liveSyncDurationCount: 3, maxBufferLength: 20, backBufferLength: 30 });
      t.hls = hls;
      hls.loadSource(src.url); hls.attachMedia(v);
      hls.on(Hls.Events.MANIFEST_PARSED, start);
      let retries = 0;
      hls.on(Hls.Events.ERROR, (_, d) => {
        if (!d.fatal) return;
        if (d.type === Hls.ErrorTypes.NETWORK_ERROR && retries++ < 3 && !(d.response && [403, 404].includes(d.response.code))) {
          setStatus(t, 'loading', 'Reconnecting…'); setTimeout(() => t.hls === hls && hls.startLoad(), 1500);
        } else if (d.type === Hls.ErrorTypes.MEDIA_ERROR && retries++ < 3) hls.recoverMediaError();
        else fail('Playback error: ' + d.details);
      });
    } else { v.src = src.url; start(); }
  } else if (src.type === 'flv') {
    if (!window.mpegts || !mpegts.isSupported()) return fail('FLV streams not supported in this browser');
    const p = mpegts.createPlayer({ type: 'flv', isLive: true, url: src.url }, { enableWorker: true, liveBufferLatencyChasing: true });
    t.mpegts = p; p.attachMediaElement(v); p.load(); start();
    p.on(mpegts.Events.ERROR, (_, d) => fail('Stream error or ended' + (d ? ' (' + d + ')' : '')));
  } else { v.src = src.url; start(); }
  v.onerror = () => { if (!t.hls && !t.mpegts) fail('Could not play this stream'); };
}

// a site's own embedded player (used when we cannot get the raw stream); volume/speed are controlled inside it
function mountEmbed(t, src) {
  const f = document.createElement('iframe');
  f.src = src; f.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture'; f.allowFullscreen = true;
  t.media.appendChild(f); t.iframe = f;
  f.addEventListener('load', () => setStatus(t, 'ok'));
  setTimeout(() => { if (t.iframe === f) setStatus(t, 'ok'); }, 4000);
}

function mountYoutube(t, id) {
  const f = document.createElement('iframe');
  const q = new URLSearchParams({ enablejsapi: 1, autoplay: 1, controls: 0, modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0, disablekb: 1, origin: location.origin });
  if (t.muted) q.set('mute', 1);
  f.src = `https://www.youtube.com/embed/${encodeURIComponent(id)}?${q}`;
  f.allow = 'autoplay; encrypted-media; picture-in-picture';
  t.media.appendChild(f); t.iframe = f;
  t.onMsg = (e) => {
    if (e.source !== f.contentWindow) return;
    let d; try { d = JSON.parse(e.data); } catch { return; }
    if (!t.ready && (d.event === 'onReady' || d.event === 'initialDelivery' || d.event === 'infoDelivery')) {
      t.ready = true; applyAudio(t); setStatus(t, 'ok');
    }
    if (d.info && (d.info.duration !== undefined || d.info.currentTime !== undefined)) {
      if (d.info.duration !== undefined) t.ytDur = d.info.duration;
      if (d.info.currentTime !== undefined) t.ytCur = d.info.currentTime;
      updateProgress(t, t.ytCur || 0, t.ytDur || 0);
    }
    if (d.event === 'onError') {
      // embedding disabled by the uploader: fall back to extracting the raw stream
      if (!t.triedDirect) { t.triedDirect = true; t.pref = ''; load(t, true); }
      else setStatus(t, 'err', 'YouTube cannot play this video');
    }
  };
  window.addEventListener('message', t.onMsg);
  let tries = 0;
  f.addEventListener('load', () => {
    t.ytTimer = setInterval(() => {
      if (t.ready || ++tries > 40) return clearInterval(t.ytTimer);
      f.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: t.id, channel: 'widget' }), '*');
    }, 400);
  });
  setTimeout(() => { if (t.iframe === f) setStatus(t, 'ok'); }, 1500);
}
function ytCmd(t, func, args = []) {
  if (t.iframe && t.iframe.contentWindow) t.iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
}

/* ---------------- audio ---------------- */
function applyAudio(t) {
  if (t.video) { t.video.muted = t.muted; t.video.volume = t.vol; }
  if (t.iframe) { ytCmd(t, 'setVolume', [Math.round(t.vol * 100)]); ytCmd(t, t.muted ? 'mute' : 'unMute'); }
}
function applyAudioUI(t) {
  t.volEl.value = t.muted ? 0 : t.vol;
  t.muteBtn.textContent = t.muted || t.vol === 0 ? ICON.mute : ICON.vol;
  updateMuteAll();
}
function setPlayIcon(t) { t.el.querySelector('[data-a=play]').textContent = t.paused ? '▶' : '⏸'; }
function updateMuteAll() { $('#muteAllBtn').innerHTML = '<span class="ic">' + (tiles.length && tiles.every((t) => t.muted) ? '🔇' : '🔊') + '</span><span class="lbl">All</span>'; }

function action(t, a) {
  switch (a) {
    case 'close': return removeTile(t);
    case 'reload': return load(t);
    case 'fit': t.fill = !t.fill; t.box.classList.toggle('fill', t.fill); return save();
    case 'fs':
      if (document.fullscreenElement) return document.exitFullscreen();
      if (t.box.requestFullscreen) return t.box.requestFullscreen();
      if (t.video && t.video.webkitEnterFullscreen) return t.video.webkitEnterFullscreen();
      return;
    case 'mute':
      t.muted = !t.muted; if (!t.muted && t.vol === 0) t.vol = 0.6;
      applyAudio(t); applyAudioUI(t); return save();
    case 'solo': {
      const alreadySolo = !t.muted && tiles.every((o) => o === t || o.muted);
      tiles.forEach((o) => { o.muted = alreadySolo ? false : o !== t; if (!o.muted && o.vol === 0) o.vol = 0.6; applyAudio(o); applyAudioUI(o); });
      return save();
    }
    case 'play':
      t.paused = !t.paused;
      if (t.video) t.paused ? t.video.pause() : t.video.play().catch(() => {});
      if (t.iframe) ytCmd(t, t.paused ? 'pauseVideo' : 'playVideo');
      return setPlayIcon(t);
    case 'main': return swap(tiles.indexOf(t), 0);
    case 'cfg': return toggleCfg(t);
    case 'cc': {
      if (t.capIdx >= 0) return setCaption(t, -1);
      const pref = (navigator.language || 'en').slice(0, 2);
      const i = t.captions.findIndex((c) => String(c.code).startsWith(pref));
      return setCaption(t, i >= 0 ? i : 0);
    }
  }
}

/* ---------------- settings menu (speed / quality / captions / audio) ---------------- */
function setSpeed(t, r) {
  t.speed = r;
  if (t.video) t.video.playbackRate = r;
  if (t.iframe) ytCmd(t, 'setPlaybackRate', [r]);
}
function setCaption(t, i) {
  t.capIdx = i;
  if (t.video) [...t.video.textTracks].forEach((tt, k) => { tt.mode = k === i ? 'showing' : 'disabled'; });
  const b = t.el.querySelector('[data-a=cc]'); if (b) b.classList.toggle('on', i >= 0);
}
function closeCfg(t) {
  if (t.menu) { t.menu.remove(); t.menu = null; }
  const b = t.el && t.el.querySelector('[data-a=cfg]'); if (b) b.classList.remove('on');
}
function toggleCfg(t) {
  if (t.menu) return closeCfg(t);
  tiles.forEach((o) => { if (o !== t) closeCfg(o); });
  t.menu = document.createElement('div');
  t.menu.className = 'cfgmenu';
  t.box.appendChild(t.menu);
  t.el.querySelector('[data-a=cfg]').classList.add('on');
  renderCfg(t);
}
function renderCfg(t) {
  const m = t.menu; if (!m) return;
  m.innerHTML = '';
  const sec = (title, chips) => {
    if (!chips.length) return;
    const d = document.createElement('div'); d.className = 'cfgsec';
    d.innerHTML = '<div class="cfgt">' + esc(title) + '</div>';
    const row = document.createElement('div'); row.className = 'cfgrow';
    chips.forEach((c) => {
      const b = document.createElement('button'); b.textContent = c.label; if (c.on) b.classList.add('on');
      b.onclick = () => { c.fn(); renderCfg(t); };
      row.appendChild(b);
    });
    d.appendChild(row); m.appendChild(d);
  };
  const isYt = t.kind === 'youtube', h = t.hls;
  if (!t.live && (t.video || isYt)) sec('Speed', [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((r) => ({ label: r === 1 ? 'Normal' : r + '×', on: (t.speed || 1) === r, fn: () => setSpeed(t, r) })));
  if (h && h.levels.length > 1) {
    const lv = h.levels.map((l, i) => ({ i, h: l.height })).filter((x) => x.h).sort((a, b) => b.h - a.h);
    const cur = h.autoLevelEnabled && h.currentLevel >= 0 && h.levels[h.currentLevel] ? ' (' + h.levels[h.currentLevel].height + 'p)' : '';
    sec('Quality', [{ label: 'Auto' + cur, on: h.autoLevelEnabled, fn: () => { h.currentLevel = -1; } },
      ...lv.map((x) => ({ label: x.h + 'p', on: !h.autoLevelEnabled && h.currentLevel === x.i, fn: () => { h.currentLevel = x.i; } }))]);
  }
  if (t.captions && t.captions.length) sec('Captions', [{ label: 'Off', on: t.capIdx < 0, fn: () => setCaption(t, -1) }, ...t.captions.map((c, i) => ({ label: c.name, on: t.capIdx === i, fn: () => setCaption(t, i) }))]);
  if (h && h.audioTracks && h.audioTracks.length > 1) sec('Audio', h.audioTracks.map((a, i) => ({ label: a.name || a.lang || 'Track ' + (i + 1), on: h.audioTrack === i, fn: () => { h.audioTrack = i; } })));
  if (t.native || isYt) sec('Player', [
    { label: 'Clean player', on: !isYt, fn: () => { t.pref = ''; t.triedDirect = false; load(t); } },
    { label: "YouTube's own player", on: isYt, fn: () => { t.pref = 'embed'; load(t); } },
  ]);
  if (!m.children.length) m.innerHTML = '<div class="cfgt">No options for this stream</div>';
}
document.addEventListener('mousedown', (e) => tiles.forEach((t) => { if (t.menu && !t.menu.contains(e.target) && !e.target.closest('[data-a=cfg]')) closeCfg(t); }));

function removeTile(t) {
  const i = tiles.indexOf(t); if (i < 0) return;
  destroyMedia(t); t.el.remove(); tiles.splice(i, 1);
  applyLayout(); updateMuteAll(); save();
}
function swap(i, j) {
  if (i === j || i < 0 || j < 0) return;
  [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  applyLayout(); save();
}

/* ---------------- drag & drop (swap places) ---------------- */
let dragSrc = null;
function setupDnD(t) {
  const grip = t.el.querySelector('.grip'), dz = t.el.querySelector('.dropzone');
  grip.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return; // mouse uses native drag & drop below
    e.preventDefault();
    grip.draggable = false;
    try { grip.setPointerCapture(e.pointerId); } catch {}
    dragSrc = t; document.body.classList.add('dragging'); t.el.classList.add('dragsrc');
    let over = null;
    const mark = (ev) => {
      const hit = document.elementFromPoint(ev.clientX, ev.clientY);
      const z = hit && hit.closest ? hit.closest('.dropzone') : null;
      if (over && over !== z) over.classList.remove('over');
      over = z && z !== dz ? z : null;
      if (over) over.classList.add('over');
    };
    const end = (ev) => {
      grip.removeEventListener('pointermove', mark); grip.removeEventListener('pointerup', end); grip.removeEventListener('pointercancel', end);
      document.body.classList.remove('dragging'); t.el.classList.remove('dragsrc');
      if (over && ev.type === 'pointerup') {
        const target = tiles.find((o) => o.el.querySelector('.dropzone') === over);
        if (target) swap(tiles.indexOf(t), tiles.indexOf(target));
      }
      document.querySelectorAll('.dropzone.over').forEach((d) => d.classList.remove('over'));
      grip.draggable = true; dragSrc = null;
    };
    grip.addEventListener('pointermove', mark); grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
  });
  grip.addEventListener('dragstart', (e) => {
    dragSrc = t; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(t.id));
    try { e.dataTransfer.setDragImage(grip, 10, 10); } catch {}
    requestAnimationFrame(() => { document.body.classList.add('dragging'); t.el.classList.add('dragsrc'); });
  });
  grip.addEventListener('dragend', () => {
    document.body.classList.remove('dragging'); t.el.classList.remove('dragsrc');
    document.querySelectorAll('.dropzone.over').forEach((d) => d.classList.remove('over')); dragSrc = null;
  });
  dz.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
  dz.addEventListener('dragenter', () => dz.classList.add('over'));
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault(); dz.classList.remove('over');
    if (dragSrc && dragSrc !== t) swap(tiles.indexOf(dragSrc), tiles.indexOf(t));
  });
}

/* ---------------- UI wiring ---------------- */
function addUrl(u) {
  if (tiles.length >= MAX) { toast(`Maximum ${MAX} players`); return false; }
  // the first player gets sound; later ones start muted so streams don't talk over each other
  createTile(u, { muted: tiles.some((o) => !o.muted) });
  save();
  return true;
}
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const raw = input.value.trim(); if (!raw) return;
  if (tiles.length >= MAX) return toast(`Maximum ${MAX} players`);
  // allow several links pasted at once (whitespace / newline separated)
  const urls = raw.split(/[\s,]+/).filter(Boolean).slice(0, MAX - tiles.length);
  input.value = '';
  urls.forEach((u) => addUrl(u));
});
layoutBtn.onclick = (e) => { e.stopPropagation(); layoutPop.hidden = !layoutPop.hidden; };
document.addEventListener('click', (e) => { if (!layoutPop.contains(e.target)) layoutPop.hidden = true; });
$('#muteAllBtn').onclick = () => {
  const mute = !tiles.every((t) => t.muted);
  tiles.forEach((t) => { t.muted = mute; if (!mute && t.vol === 0) t.vol = 0.6; applyAudio(t); applyAudioUI(t); });
  save();
};
function setImmersive(on) { document.body.classList.toggle('immersive', on); if (!on) { topbar.classList.remove('reveal'); document.body.classList.remove('revealed'); } }
$('#immersiveBtn').onclick = () => setImmersive(true);
$('#showUiBtn').onclick = () => setImmersive(false);
document.addEventListener('keydown', (e) => {
  if (e.target === input) { if (e.key === 'Escape') input.blur(); return; }
  if (e.key === 'h' || e.key === 'H') setImmersive(!document.body.classList.contains('immersive'));
  if (e.key === 'Escape') { setImmersive(false); openLive(false); }
  if (e.key === '/' ) { e.preventDefault(); setImmersive(false); input.focus(); }
});
const topbar = $('#topbar');
$('#edge').addEventListener('mouseenter', () => { topbar.classList.add('reveal'); document.body.classList.add('revealed'); });
topbar.addEventListener('mouseleave', () => { topbar.classList.remove('reveal'); document.body.classList.remove('revealed'); });
const syncTop = () => document.documentElement.style.setProperty('--top', topbar.offsetHeight + 'px');
new ResizeObserver(syncTop).observe(topbar);
let resizeT;
const onResize = () => { syncTop(); clearTimeout(resizeT); resizeT = setTimeout(() => applyLayout(), 120); };
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);
syncTop();

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function prettySource(s) { return String(s).replace(/(Live|Stream)$/i, '').replace(/^youtube$/i, 'YouTube') || 'Video'; }

/* ---------------- live browser ---------------- */
const liveEl = $('#live'), liveList = $('#liveList'), liveCtl = $('#liveCtl');
const live = { site: 'twitch', lang: '', qs: { twitch: '', kick: '', youtube: '' }, ttq: '', tt: [], token: 0, cat: { twitch: '', kick: '', youtube: '' }, catName: { twitch: '', kick: '', youtube: '' }, cats: {}, langs: {}, next: null, loading: false, seen: new Set() };
try { live.lang = localStorage.getItem('splitdeck.lang') || ''; live.tt = JSON.parse(localStorage.getItem('splitdeck.tiktok') || '[]'); } catch {}
const kfmt = (n) => (n == null ? '' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K' : String(n));
const saveTT = () => { try { localStorage.setItem('splitdeck.tiktok', JSON.stringify(live.tt)); } catch {} };

const ttClean = (v) => v.trim().replace(/^.*tiktok\.com\/@/i, '').replace(/^@/, '').replace(/[\/?#].*$/, '');
const optHtml = (v, n, sel) => '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(n) + '</option>';

function fillSelect(sel, list, value, allLabel) {
  if (sel) sel.innerHTML = optHtml('', allLabel, !value) + (list || []).map((x) => optHtml(x.value, x.name, x.value === value)).join('');
}
// languages / categories come from the server (they differ per site); fetched once, then cached
function ensureList(kind, site, apply) {
  const store = kind === 'lang' ? live.langs : live.cats;
  if (store[site]) return;
  store[site] = [];
  fetch('/api/' + (kind === 'lang' ? 'languages' : 'categories') + '?site=' + site).then((r) => r.json()).then((d) => {
    store[site] = d.items || [];
    if (live.site === site) apply();
  }).catch(() => { delete store[site]; });
}

function renderLiveCtl() {
  const site = live.site;
  if (site === 'tiktok') {
    liveCtl.innerHTML = '<form class="srch"><input type="text" placeholder="Look up a TikTok username…" value="' + esc(live.ttq) + '"><button>Look up</button>' + (live.ttq ? '<button type="button" class="clr" title="Clear">✕</button>' : '') + '</form>' +
      '<div class="hint">TikTok has no public search or live list. Look up a username to see if they are live, then ＋ add them to your watchlist.</div>';
    liveCtl.querySelector('form').onsubmit = (e) => { e.preventDefault(); live.ttq = ttClean(liveCtl.querySelector('input').value); loadLive(); };
    const clr = liveCtl.querySelector('.clr'); if (clr) clr.onclick = () => { live.ttq = ''; loadLive(); };
    return;
  }
  const q = live.qs[site] || '', yt = site === 'youtube';
  // on Twitch/Kick a search overrides the filters; on YouTube the category is combined with the search words
  const lock = q && !yt ? ' disabled' : '';
  let html = '<form class="srch"><input type="text" placeholder="' + (yt ? 'Search live videos…' : 'Search name, title or category…') + '" value="' + esc(q) + '"><button>Search</button>' + (q ? '<button type="button" class="clr" title="Clear search">✕</button>' : '') + '</form>';
  html += '<div class="selrow">' + (yt ? '' : '<select class="sl"' + lock + '></select>') +
    '<div class="cat"><button type="button" class="catbtn"' + lock + '>' + esc(live.cat[site] ? live.catName[site] : 'All categories') + '</button>' +
    '<div class="catpop" hidden><input type="text" placeholder="Search categories…"><div class="catlist"></div></div></div></div>';
  if (q && !yt) html += '<div class="hint">Filters are off while searching.</div>';
  liveCtl.innerHTML = html;
  const sl = liveCtl.querySelector('.sl');
  const fill = () => fillSelect(sl, live.langs[site], live.lang, 'All languages');
  if (sl) { fill(); ensureList('lang', site, fill); }
  bindCatPicker(site);
  liveCtl.querySelector('form').onsubmit = (e) => { e.preventDefault(); live.qs[site] = liveCtl.querySelector('input').value.trim(); loadLive(); };
  const clr = liveCtl.querySelector('.clr'); if (clr) clr.onclick = () => { live.qs[site] = ''; loadLive(); };
  if (sl) sl.onchange = (e) => { live.lang = e.target.value; try { localStorage.setItem('splitdeck.lang', live.lang); } catch {} loadLive(); };
}

// searchable category picker: top categories when empty, live search while typing (full lists, not just the top few)
function bindCatPicker(site) {
  const wrap = liveCtl.querySelector('.cat'), btn = wrap.querySelector('.catbtn'), pop = wrap.querySelector('.catpop');
  const inp = pop.querySelector('input'), list = pop.querySelector('.catlist');
  let timer, seq = 0;
  const render = (items) => {
    list.innerHTML = '';
    const add = (v, n, sub) => {
      const d = document.createElement('div');
      d.className = 'copt' + (v === (live.cat[site] || '') ? ' on' : '');
      d.innerHTML = '<span>' + esc(n) + '</span>' + (sub ? '<small>' + kfmt(sub) + '</small>' : '');
      d.onclick = () => { live.cat[site] = v; live.catName[site] = n; pop.hidden = true; loadLive(); };
      list.appendChild(d);
    };
    add('', 'All categories');
    items.forEach((c) => add(c.value, c.name, c.viewers));
    if (!items.length) list.insertAdjacentHTML('beforeend', '<div class="cnone">No categories found</div>');
  };
  const load = async () => {
    const my = ++seq;
    list.innerHTML = '<div class="cnone">Loading…</div>';
    try {
      const r = await fetch('/api/categories?site=' + site + '&q=' + encodeURIComponent(inp.value.trim()));
      const d = await r.json();
      if (my === seq) render(d.items || []);
    } catch { if (my === seq) list.innerHTML = '<div class="cnone">Could not load</div>'; }
  };
  btn.onclick = (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; if (!pop.hidden) { inp.value = ''; load(); inp.focus(); } };
  inp.oninput = () => { clearTimeout(timer); timer = setTimeout(load, 250); };
  pop.onclick = (e) => e.stopPropagation();
}
document.addEventListener('click', () => document.querySelectorAll('.catpop').forEach((p) => { p.hidden = true; }));

function liveRow(it, kind) {
  const tt = kind !== 'std', off = tt && !it.live;
  const row = document.createElement('div');
  row.className = 'litem' + (off ? ' off' : '');
  const title = tt ? (it.found ? it.title || '' : 'User not found') : it.title;
  const watching = tt && live.tt.includes(it.user);
  const btn = kind === 'tt-watch' ? '<button class="lrm" title="Remove from watchlist">✕</button>'
    : kind === 'tt-result' && it.found && !watching ? '<button class="lrm" title="Add to watchlist">＋</button>' : '';
  row.innerHTML = '<div class="lthumb">' + (it.thumb ? '<img loading="lazy" referrerpolicy="no-referrer" src="' + esc(it.thumb) + '">' : '') + (!off && it.viewers != null ? '<span class="lv">' + kfmt(it.viewers) + '</span>' : '') + '</div>' +
    '<div class="lmeta"><div class="lt">' + esc(title || '') + '</div><div class="lc">' + esc((tt ? '@' + it.user + (it.found && !it.live ? ' · offline' : '') : it.channel) + (it.category ? ' · ' + it.category : '')) + '</div></div>' + btn;
  const b = row.querySelector('.lrm');
  if (b) b.onclick = (e) => {
    e.stopPropagation();
    if (kind === 'tt-watch') live.tt = live.tt.filter((x) => x !== it.user); else if (!live.tt.includes(it.user)) live.tt.push(it.user);
    saveTT(); loadLive();
  };
  row.onclick = () => { if (!off && it.found !== false && addUrl(it.url)) row.classList.add('added'); };
  return row;
}

async function liveFetch(qs) {
  const r = await fetch('/api/live?' + qs); const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'failed');
  return data.items || [];
}

// ---- Twitch / Kick / YouTube: paged list with "load more when you reach the bottom" ----
const moreObserver = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) loadMore(); }, { root: liveList, rootMargin: '300px' });
// scroll listener as well as the observer: both just ask for the next page when near the bottom
liveList.addEventListener('scroll', () => { if (liveList.scrollHeight - liveList.scrollTop - liveList.clientHeight < 400) loadMore(); });
function liveQuery(after) {
  const site = live.site, qs = new URLSearchParams({ site }), q = live.qs[site] || '';
  if (q) qs.set('q', q);
  if (site === 'youtube') { if (live.cat.youtube) qs.set('cat', live.cat.youtube); }
  else if (!q) { if (live.lang) qs.set('lang', live.lang); if (live.cat[site]) qs.set('cat', live.cat[site]); }
  if (after) qs.set('after', after);
  return qs;
}
function setSentinel(html, retry) {
  moreObserver.disconnect();
  const old = liveList.querySelector('.lmore, .lend'); if (old) old.remove();
  if (!html) return;
  const el = document.createElement('div');
  el.className = retry === undefined ? 'lend' : 'lmore';
  el.innerHTML = html;
  liveList.appendChild(el);
  if (retry === null) moreObserver.observe(el);          // observing: reaching it loads the next page
  else if (retry) el.querySelector('button').onclick = retry; // error: manual retry
}
function appendItems(items) {
  const sentinel = liveList.querySelector('.lmore, .lend'); if (sentinel) sentinel.remove();
  items.forEach((it) => { if (live.seen.has(it.url)) return; live.seen.add(it.url); liveList.appendChild(liveRow(it, 'std')); });
}
function afterPage(data, my) {
  live.next = data.next || null;
  if (live.next) setSentinel('<div class="spin"></div>Loading more…', null);
  else if (live.seen.size) setSentinel('End of list');
}
async function loadMore() {
  if (live.loading || !live.next || live.site === 'tiktok') return;
  const my = live.token, after = live.next;
  live.loading = true;
  try {
    const r = await fetch('/api/live?' + liveQuery(after)); const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'failed');
    if (my !== live.token) return;
    appendItems(data.items || []); afterPage(data, my);
  } catch (e) {
    if (my === live.token) setSentinel('Could not load more. <button>Retry</button>', () => loadMore());
  } finally { live.loading = false; }
}

async function loadLive() {
  const my = ++live.token, site = live.site;
  live.loading = false; live.next = null; live.seen = new Set(); moreObserver.disconnect();
  renderLiveCtl();
  const msg = (cls, html) => { if (my === live.token) liveList.innerHTML = '<div class="lmsg ' + cls + '">' + html + '</div>'; };
  if (site === 'tiktok') {
    if (!live.ttq && !live.tt.length) return msg('', 'Your watchlist is empty.<br>Look up a username above.');
    liveList.innerHTML = '<div class="lmsg"><div class="spin"></div>Loading…</div>';
    try {
      const [res, watch] = await Promise.all([
        live.ttq ? liveFetch('site=tiktok&users=' + encodeURIComponent(live.ttq)) : Promise.resolve([]),
        live.tt.length ? liveFetch('site=tiktok&users=' + encodeURIComponent(live.tt.join(','))) : Promise.resolve([]),
      ]);
      if (my !== live.token) return;
      liveList.innerHTML = '';
      if (res.length) { liveList.insertAdjacentHTML('beforeend', '<div class="lsec">Result</div>'); res.forEach((it) => liveList.appendChild(liveRow(it, 'tt-result'))); }
      if (watch.length) { liveList.insertAdjacentHTML('beforeend', '<div class="lsec">Watchlist</div>'); watch.forEach((it) => liveList.appendChild(liveRow(it, 'tt-watch'))); }
    } catch (e) { msg('err', 'Could not load: ' + esc(e.message)); }
    return;
  }
  const slow = site === 'kick' && live.lang ? 'Scanning Kick for ' + esc((live.langs.kick.find((l) => l.value === live.lang) || {}).name || 'that language') + ' streams…' : 'Loading…';
  liveList.innerHTML = '<div class="lmsg"><div class="spin"></div>' + slow + '</div>';
  try {
    const r = await fetch('/api/live?' + liveQuery('')); const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'failed');
    if (my !== live.token) return; // a newer request replaced this one
    const q = live.qs[site] || '';
    if (!(data.items || []).length) return msg('', q ? 'No live streams match “' + esc(q) + '”.' : 'Nothing found.');
    liveList.innerHTML = '';
    appendItems(data.items); afterPage(data, my);
  } catch (e) { msg('err', 'Could not load: ' + esc(e.message)); }
}
function openLive(on = true) { liveEl.hidden = !on; if (on) loadLive(); }
$('#liveBtn').onclick = (e) => { e.stopPropagation(); openLive(liveEl.hidden); };
$('#liveClose').onclick = () => openLive(false);
$('#liveRefresh').onclick = () => loadLive();
$('#liveTabs').onclick = (e) => {
  const b = e.target.closest('button[data-site]'); if (!b) return;
  live.site = b.dataset.site;
  document.querySelectorAll('#liveTabs button').forEach((x) => x.classList.toggle('on', x === b));
  loadLive();
};

/* ---------------- reset ---------------- */
$('#resetBtn').onclick = () => {
  if (tiles.length && !confirm('Close all streams and start fresh?')) return;
  tiles.slice().forEach((t) => { destroyMedia(t); t.el.remove(); });
  tiles.length = 0;
  Object.keys(layoutPref).forEach((k) => delete layoutPref[k]);
  Object.keys(ratioStore).forEach((k) => delete ratioStore[k]);
  Object.keys(layoutCache).forEach((k) => delete layoutCache[k]);
  applyLayout(); updateMuteAll();
  try { localStorage.removeItem('splitdeck.v2'); } catch {}
};

/* ---------------- restore ---------------- */
try {
  const saved = JSON.parse(localStorage.getItem('splitdeck.v2') || 'null');
  if (saved) {
    Object.assign(layoutPref, saved.layoutPref || {});
    Object.assign(ratioStore, saved.ratioStore || {});
    (saved.tiles || []).slice(0, MAX).forEach((x) => createTile(x.url, x));
  }
  ['splitdeck.v1', 'splitdeck.saved', 'splitdeck.prefs'].forEach((k) => localStorage.removeItem(k));
  sessionStorage.removeItem('splitdeck.session');
} catch {}
applyLayout();
window.splitdeck = { tiles, createTile };
})();
