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
let focusId = null;      // the player shown alone, full size (null = normal grid)
let focusRestore = null; // each player's mute state before focusing, so Back can put it back

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
const FULL_RECT = { x: 0, y: 0, w: 1, h: 1 };
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
    const s = focusId === t.id ? FULL_RECT : rects[i];
    Object.assign(t.el.style, { left: s.x * 100 + '%', top: s.y * 100 + '%', width: s.w * 100 + '%', height: s.h * 100 + '%' });
    t.el.classList.toggle('focused', focusId === t.id);
    const fb = t.el.querySelector('[data-a=focus]');
    if (fb) { fb.classList.toggle('on', focusId === t.id); fb.title = focusId === t.id ? 'Back to the grid (Esc)' : 'Show only this player, full size, with sound (Esc to go back)'; }
  });
  placeDividers(focusId !== null ? [] : dividers); // no resize handles while one player fills the stage
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
        <button data-a="focus" title="Show only this player, full size, with sound (Esc to go back)">▣</button>
        <button data-a="chat" hidden title="Show / hide chat">💬</button>
        <button data-a="close" title="Close">✕</button>
      </div>
      <div class="hud bot">
        <div class="seekrow" hidden><span class="tcur">0:00</span><span class="seekwrap"><input class="seek" type="range" min="0" max="1000" step="1" value="0"><span class="seektip" hidden>0:00</span></span><span class="tdur">0:00</span></div>
        <button data-a="play" title="Play / pause">⏸</button>
        <button data-a="golive" class="golive" hidden title="Go to the live point">LIVE</button>
        <span class="volgrp"><button data-a="mute" title="Mute / unmute"></button><input class="vol" type="range" min="0" max="1" step="0.01"></span>
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
  t.muteBtn = el.querySelector('[data-a=mute]'); t.liveBtn = el.querySelector('[data-a=golive]');
  t.ttl = el.querySelector('.ttl');
  el.querySelector('.lnk').href = /^https?:\/\//i.test(url) ? url : 'https://' + url;
  t.box.classList.toggle('fill', t.fill);
  t.ttl.textContent = url;
  stage.appendChild(el);
  tiles.push(t);

  el.querySelectorAll('[data-a]').forEach((b) => (b.onclick = () => action(t, b.dataset.a)));
  // hovering the seek bar shows the time under the mouse; dragging shows the time you will jump to
  const tip = el.querySelector('.seektip');
  const THUMB = 14; // px; the slider's handle never goes past half its width from each end
  const showTip = (ratio) => {
    if (!t.dur) { tip.hidden = true; return; }
    ratio = Math.min(1, Math.max(0, ratio));
    const w = t.seek.clientWidth;
    tip.textContent = t.live ? liveOffset((1 - ratio) * t.dur) : fmt(ratio * t.dur); tip.hidden = false;
    tip.style.left = (THUMB / 2 + ratio * (w - THUMB)) + 'px';
  };
  const ratioAt = (clientX) => { const r = t.seek.getBoundingClientRect(); return (clientX - r.left - THUMB / 2) / Math.max(1, r.width - THUMB); };
  t.seek.addEventListener('pointermove', (e) => showTip(ratioAt(e.clientX)));
  t.seek.addEventListener('pointerdown', (e) => showTip(ratioAt(e.clientX)));
  t.seek.addEventListener('pointerleave', () => { if (!t.seeking) tip.hidden = true; });
  t.seek.oninput = () => {
    t.seeking = true;
    t.tcur.textContent = t.live ? liveOffset((1 - t.seek.value / 1000) * t.dur) : fmt((t.seek.value / 1000) * t.dur);
    showTip(t.seek.value / 1000);
  };
  t.seek.onchange = () => {
    const to = (t.live ? t.winStart : 0) + (t.seek.value / 1000) * t.dur;
    if (t.video) t.video.currentTime = to;
    if (t.iframe) ytCmd(t, 'seekTo', [to, true]);
    t.seeking = false;
    if (!t.seek.matches(':hover')) tip.hidden = true;
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
    if (t.dragged) { t.dragged = false; return; }
    if (e.target.closest('.hud, .cfgmenu, .divider')) { bump(); return; }
    const on = !t.box.classList.contains('active');
    tiles.forEach((o) => o.box.classList.remove('active'));
    if (on) { t.box.classList.add('active'); bump(); }
  });
  setupDnD(t);
  setupPointerDrag(t);
  // mouse click on the picture pauses / plays (a drag is ignored; on touch screens a tap shows the controls instead)
  t.box.addEventListener('click', (e) => {
    if (t.dragged) { t.dragged = false; return; }
    if (e.pointerType && e.pointerType !== 'mouse') return;
    if (e.button !== 0 || e.target.closest('.hud, .cfgmenu, .dropzone, .divider, .status, .flash, button, a, input, select, textarea')) return;
    if (!t.video && !t.iframe) return;
    action(t, 'play');
    flashPlay(t);
  });
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
    const cookies = signinFor(t.url);
    const r = cookies
      ? await fetch('/api/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: t.url, embed: t.pref === 'embed', cookies }) })
      : await fetch('/api/resolve?url=' + encodeURIComponent(t.url) + (t.pref === 'embed' ? '&embed=1' : ''));
    data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Could not resolve');
  } catch (e) { return setStatus(t, 'err', e.message); }
  if (!tiles.includes(t)) return;
  t.kind = data.type; t.title = data.title || t.url; t.live = !!data.live; t.source = data.source || '';
  t.native = !!data.native; t.captions = data.captions || []; t.capIdx = -1; t.vid = data.id || '';
  updateChatBtn(t);
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
  if (t.liveBtn) t.liveBtn.hidden = true;
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
// live: "-1:05" behind the live point, or "LIVE" at it
const liveOffset = (sec) => (sec < 3 ? 'LIVE' : '-' + fmt(sec));
// for a live stream: the part that can be rewound, from the oldest kept point to the live point
// YouTube's own player stops reporting while paused, so the live point is estimated from the time since the pause
const ytLiveEnd = (t) => Math.max(t.ytDur || 0, t.ytCur || 0, t.paused && t.pausedAt ? t.pausedDur + (Date.now() - t.pausedAt) / 1000 : 0);
function liveWindow(t) {
  if (t.iframe) return t.ytDvr && t.ytDur > 5 ? { start: 0, end: ytLiveEnd(t) } : null;
  const v = t.video; if (!v || t.mpegts) return null; // FLV keeps catching up to live, so it cannot be rewound
  let start = Infinity, end = 0;
  [v.seekable, v.buffered].forEach((r) => { if (r.length) { start = Math.min(start, r.start(0)); end = Math.max(end, r.end(r.length - 1)); } });
  if (t.hls && t.hls.liveSyncPosition) end = Math.max(t.hls.liveSyncPosition, v.currentTime); // not the buffer ahead of it
  return end - start > 5 ? { start, end } : null;
}
function updateProgress(t, cur, dur) {
  if (t.live) {
    const w = liveWindow(t);
    t.seekRow.hidden = !w;
    if (!w) return;
    t.winStart = w.start; t.dur = w.end - w.start; t.tdur.textContent = '';
    if (!t.seeking) {
      t.seek.value = Math.round(Math.min(1, Math.max(0, (cur - w.start) / t.dur)) * 1000);
      t.tcur.textContent = liveOffset(w.end - cur);
    }
    return;
  }
  const ok = dur > 0 && isFinite(dur);
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
  if (kind === 'err' && /Sign-ins/.test(msg) && signinAllowed) {
    const k = document.createElement('button'); k.textContent = '🔑 Open Sign-ins'; k.onclick = () => openSignin(true, siteKeyOf(t.url));
    s.appendChild(k);
  }
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
    tr.track.addEventListener('cuechange', () => placeCues(tr.track));
  });
  [...v.textTracks].forEach((x) => { x.mode = 'disabled'; }); // captions start off, like YouTube
  v.playbackRate = t.speed || 1;
  v.addEventListener('playing', () => setStatus(t, 'ok'));
  v.addEventListener('waiting', () => { if (!v.paused && v.readyState < 3) setStatus(t, 'loading', 'Buffering…'); });
  v.addEventListener('canplay', () => setStatus(t, 'ok'));
  const prog = () => updateProgress(t, v.currentTime, v.duration);
  v.addEventListener('timeupdate', prog); v.addEventListener('durationchange', prog);
  t.liveBtn.hidden = !t.live;
  ['timeupdate', 'pause', 'play'].forEach((ev) => v.addEventListener(ev, () => liveState(t)));
  v.addEventListener('ended', () => setStatus(t, 'err', t.live ? 'Stream ended' : 'Finished'));
  applyAudio(t);
  const start = () => v.play().catch(() => { t.muted = true; applyAudio(t); applyAudioUI(t); v.play().catch(() => {}); });
  // if nothing plays within 15s, treat it as a failure of this format
  const watchdog = setTimeout(() => { if (t.mountedFor === src && v.readyState < 2) fail('Stream did not start (offline or blocked)'); }, 15000);
  v.addEventListener('playing', () => clearTimeout(watchdog), { once: true });

  if (src.type === 'hls') {
    if (window.Hls && Hls.isSupported()) {
      const hls = new Hls({ lowLatencyMode: true, liveSyncDurationCount: 3, maxBufferLength: 20, backBufferLength: t.live ? 180 : 30 });
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
    // mpegts.js runs its network code in a Web Worker, which cannot resolve a relative link like /proxy?…, so give it a full address
    const p = mpegts.createPlayer({ type: 'flv', isLive: true, url: new URL(src.url, location.href).href }, { enableWorker: true, liveBufferLatencyChasing: true });
    t.mpegts = p; p.attachMediaElement(v); p.load(); start();
    p.on(mpegts.Events.ERROR, (type, detail, info) => fail('Stream error or ended' + (detail ? ' (' + detail + (info && info.msg ? ': ' + String(info.msg).slice(0, 80) : '') + ')' : '')));
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
    if (d.info && d.info.videoData && d.info.videoData.isLive !== undefined) {
      t.live = !!d.info.videoData.isLive; t.liveBtn.hidden = !t.live; t.ytDvr = t.live && d.info.videoData.allowLiveDvr !== false;
      if (d.info.videoData.video_id) t.vid = d.info.videoData.video_id;
      updateChatBtn(t);
    }
    if (d.info && (d.info.duration !== undefined || d.info.currentTime !== undefined)) {
      if (d.info.duration !== undefined) t.ytDur = d.info.duration;
      if (d.info.currentTime !== undefined) t.ytCur = d.info.currentTime;
      updateProgress(t, t.ytCur || 0, t.ytDur || 0);
    }
    if (d.info) liveState(t);
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
// LIVE button: red at the live point, grey when behind (paused, or resumed after a pause); a click jumps to live
function liveLag(t) {
  if (t.iframe) return ytLiveEnd(t) - (t.ytCur || 0); // YouTube's own player: its duration is the live point
  const v = t.video; if (!v) return 0;
  if (t.hls && t.hls.liveSyncPosition) return t.hls.liveSyncPosition - v.currentTime;
  let edge = 0;
  [v.seekable, v.buffered].forEach((r) => { if (r.length) edge = Math.max(edge, r.end(r.length - 1)); });
  return edge ? edge - v.currentTime : 0;
}
function liveState(t) {
  if (!t.liveBtn || t.liveBtn.hidden) return;
  const behind = (t.video ? t.video.paused : t.paused) || liveLag(t) > (t.iframe ? 15 : 5);
  t.liveBtn.classList.toggle('behind', behind);
  t.liveBtn.title = behind ? 'Behind live: click to go to the live point' : 'You are watching live';
}
setInterval(() => tiles.forEach((t) => {
  if (!t.live || !t.paused) return;
  if (t.video) updateProgress(t, t.video.currentTime, t.video.duration);
  else if (t.iframe) updateProgress(t, t.ytCur || 0, t.ytDur || 0);
  liveState(t);
}), 1000);
function goLive(t) {
  if (t.iframe) return ytCmd(t, 'seekTo', [(t.ytDur || 0) + 3600, true]); // past the end lands on the live point
  const v = t.video; if (!v) return;
  try {
    if (t.mpegts) { t.mpegts.unload(); t.mpegts.load(); return; } // FLV: reconnecting is the reliable way back to live
    if (t.hls && t.hls.liveSyncPosition) { v.currentTime = t.hls.liveSyncPosition; return; }
    const r = v.seekable.length ? v.seekable : v.buffered;
    if (r.length) v.currentTime = Math.max(0, r.end(r.length - 1) - 2);
  } catch {}
}
function setPlayIcon(t) { t.el.querySelector('[data-a=play]').textContent = t.paused ? '▶' : '⏸'; }
function updateMuteAll() {
  const allMuted = tiles.length > 0 && tiles.every((t) => t.muted), b = $('#muteAllBtn');
  // the button always offers the action it will do next
  b.innerHTML = '<span class="ic">' + (allMuted ? '🔇' : '🔊') + '</span><span class="lbl">' + (allMuted ? 'Unmute all' : 'Mute all') + '</span>';
  b.title = allMuted ? 'Unmute every player' : 'Mute every player';
  b.classList.toggle('on', allMuted);
}

function action(t, a) {
  switch (a) {
    case 'close': return removeTile(t);
    case 'chat': return toggleChat(t);
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
      if (t.paused) { t.pausedDur = Math.max(t.ytDur || 0, t.ytCur || 0); t.pausedAt = Date.now(); }
      if (t.video) t.paused ? t.video.pause() : t.video.play().catch(() => {});
      if (t.iframe) ytCmd(t, t.paused ? 'pauseVideo' : 'playVideo');
      return setPlayIcon(t);
    case 'golive':
      goLive(t);
      if (t.paused) {
        t.paused = false; setPlayIcon(t);
        if (t.video) t.video.play().catch(() => {}); else ytCmd(t, 'playVideo');
      }
      return liveState(t);
    case 'main': return swap(tiles.indexOf(t), 0);
    case 'cfg': return toggleCfg(t);
    case 'focus': return focusId === t.id ? exitFocus() : enterFocus(t);
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
/* ---------------- caption style (applies to every player, saved in this browser) ---------------- */
const CAP_KEY = 'splitdeck.capstyle';
const CAP_DEFAULT = { size: '100', color: '#ffffff', bg: 'semi', font: 'sans', edge: 'none', pos: 'auto' };
const CAP_OPTS = {
  size: [['55', 'X-small'], ['75', 'Small'], ['100', 'Normal'], ['130', 'Large'], ['170', 'Huge']],
  color: [['#ffffff', 'White'], ['#ffeb3b', 'Yellow'], ['#4dd0e1', 'Cyan'], ['#7cff8a', 'Green'], ['#ff8a80', 'Red']],
  bg: [['none', 'None'], ['light', 'Light'], ['semi', 'Medium'], ['solid', 'Solid']],
  font: [['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono'], ['round', 'Rounded'], ['bold', 'Bold']],
  edge: [['none', 'None'], ['shadow', 'Shadow'], ['outline', 'Outline']],
  pos: [['auto', 'As made'], ['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']],
};
let capStyle = Object.assign({}, CAP_DEFAULT);
try { const sv = JSON.parse(localStorage.getItem(CAP_KEY) || 'null'); if (sv) for (const k of Object.keys(CAP_DEFAULT)) if (CAP_OPTS[k].some(([v]) => v === sv[k])) capStyle[k] = sv[k]; } catch {}
const saveCapStyle = () => { try { localStorage.setItem(CAP_KEY, JSON.stringify(capStyle)); } catch {} };
function applyCapStyle() {
  const bg = { none: 'transparent', light: 'rgba(0,0,0,.35)', semi: 'rgba(0,0,0,.7)', solid: '#000' }[capStyle.bg];
  const font = { sans: 'system-ui, "Segoe UI", Arial, sans-serif', serif: 'Georgia, "Times New Roman", serif', mono: 'Consolas, "Courier New", monospace', round: '"Segoe UI Rounded", "Arial Rounded MT Bold", "Comic Sans MS", system-ui, sans-serif', bold: 'system-ui, "Segoe UI", Arial, sans-serif' }[capStyle.font];
  const edge = { none: 'none', shadow: '2px 2px 3px #000, 0 0 4px #000', outline: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 2px #000' }[capStyle.edge];
  let el = document.getElementById('capstyle');
  if (!el) { el = document.createElement('style'); el.id = 'capstyle'; document.head.appendChild(el); }
  el.textContent = '.box video::cue { color: ' + capStyle.color + '; background: ' + bg + '; font-family: ' + font + '; font-weight: ' + (capStyle.font === 'bold' ? '700' : '400') +
    '; font-size: ' + (1.15 * capStyle.size / 100).toFixed(3) + 'em; text-shadow: ' + edge + '; }';
  tiles.forEach((t) => { if (t.video) [...t.video.textTracks].forEach((tr) => { if (tr.mode === 'showing') { placeCues(tr, true); tr.mode = 'hidden'; tr.mode = 'showing'; } }); }); // re-show so a paused video redraws its caption now
}
// Top / Middle / Bottom: move each line; "As made" keeps the position the captions came with
function placeCues(track, all) {
  const list = all ? track.cues : track.activeCues;
  if (!list) return;
  for (const cue of list) {
    if (!('line' in cue)) continue;
    if (cue._orig === undefined) cue._orig = { line: cue.line, snap: cue.snapToLines, lineAlign: cue.lineAlign, position: cue.position, align: cue.align };
    if (capStyle.pos === 'auto') { const o = cue._orig; cue.snapToLines = o.snap; cue.line = o.line; cue.lineAlign = o.lineAlign; cue.position = o.position; cue.align = o.align; continue; }
    cue.snapToLines = false; cue.position = 'auto'; cue.align = 'center';
    if (capStyle.pos === 'top') { cue.line = 4; cue.lineAlign = 'start'; }
    else if (capStyle.pos === 'middle') { cue.line = 50; cue.lineAlign = 'center'; }
    else { cue.line = 92; cue.lineAlign = 'end'; }
  }
}
function setCapStyle(key, value) { capStyle[key] = value; saveCapStyle(); applyCapStyle(); }
applyCapStyle();

function setCaption(t, i) {
  t.capIdx = i;
  if (t.video) [...t.video.textTracks].forEach((tt, k) => { tt.mode = k === i ? 'showing' : 'disabled'; if (k === i) setTimeout(() => placeCues(tt, true), 300); });
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
    d.innerHTML = title ? '<div class="cfgt">' + esc(title) + '</div>' : '';
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
  if (t.captions && t.captions.length) {
    sec('Captions', [{ label: 'Off', on: t.capIdx < 0, fn: () => setCaption(t, -1) }, ...t.captions.map((c, i) => ({ label: c.name, on: t.capIdx === i, fn: () => setCaption(t, i) }))]);
    // its own heading, so it is not mistaken for one more language
    sec('Caption style', [{ label: t.capStyleOpen ? '▾ Hide style options' : '▸ Size, color, font, position', on: false, fn: () => { t.capStyleOpen = !t.capStyleOpen; } }]);
    if (t.capStyleOpen) {
      const cs = capStyle, opt = (key, list) => list.map(([v, label]) => ({ label, on: cs[key] === v, fn: () => setCapStyle(key, v) }));
      sec('Caption size', opt('size', CAP_OPTS.size));
      sec('Caption color', opt('color', CAP_OPTS.color));
      sec('Caption background', opt('bg', CAP_OPTS.bg));
      sec('Caption font', opt('font', CAP_OPTS.font));
      sec('Caption outline', opt('edge', CAP_OPTS.edge));
      sec('Caption position', opt('pos', CAP_OPTS.pos));
      sec('', [{ label: 'Reset caption style', on: false, fn: () => { capStyle = Object.assign({}, CAP_DEFAULT); saveCapStyle(); applyCapStyle(); } }]);
    }
  }
  if (h && h.audioTracks && h.audioTracks.length > 1) sec('Audio', h.audioTracks.map((a, i) => ({ label: a.name || a.lang || 'Track ' + (i + 1), on: h.audioTrack === i, fn: () => { h.audioTrack = i; } })));
  if (t.native || isYt) sec('Player', [
    { label: 'Clean player', on: !isYt, fn: () => { t.pref = ''; t.triedDirect = false; load(t); } },
    { label: "YouTube's own player", on: isYt, fn: () => { t.pref = 'embed'; load(t); } },
  ]);
  if (!m.children.length) m.innerHTML = '<div class="cfgt">No options for this stream</div>';
}
document.addEventListener('mousedown', (e) => tiles.forEach((t) => { if (t.menu && !t.menu.contains(e.target) && !e.target.closest('[data-a=cfg]')) closeCfg(t); }));

/* ---------------- focus: one player alone, full size, with sound ---------------- */
const focusBackBtn = $('#focusBack');
function enterFocus(t) {
  if (focusId === null) {
    focusRestore = tiles.map((o) => ({ id: o.id, muted: o.muted }));
    try { history.pushState({ splitdeckFocus: 1 }, ''); } catch {} // the phone's Back button then returns to the grid too
  }
  focusId = t.id;
  // sound only from this player; the others keep running, muted, in the background
  tiles.forEach((o) => {
    o.muted = o.id !== t.id;
    if (!o.muted && o.vol === 0) o.vol = 0.6;
    applyAudio(o); applyAudioUI(o);
  });
  document.body.classList.add('focusing');
  focusBackBtn.hidden = false;
  tiles.forEach((o) => o.box.classList.remove('active'));
  applyLayout(false);
}
function exitFocus(fromHistory) {
  if (focusId === null) return;
  focusId = null;
  if (focusRestore) {
    focusRestore.forEach((r) => { const o = tiles.find((x) => x.id === r.id); if (o) { o.muted = r.muted; applyAudio(o); applyAudioUI(o); } });
    focusRestore = null;
  }
  document.body.classList.remove('focusing');
  focusBackBtn.hidden = true;
  applyLayout(false);
  save();
  if (!fromHistory && history.state && history.state.splitdeckFocus) { try { history.back(); } catch {} }
}
focusBackBtn.onclick = () => exitFocus();
window.addEventListener('popstate', () => { if (focusId !== null) exitFocus(true); });

// a short play / pause symbol in the middle of the player, like YouTube
function flashPlay(t) {
  let f = t.box.querySelector('.flash');
  if (!f) { f = document.createElement('div'); f.className = 'flash'; t.box.appendChild(f); }
  f.textContent = t.paused ? '❚❚' : '▶';
  f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
}

/* ---------------- chat: a floating window per player, hidden until its 💬 button is clicked ---------------- */
// Twitch only allows its chat inside pages on localhost (not an IP address, and not plain http on other names),
// so elsewhere its own popout chat opens as a separate small window.
const onLocalhost = location.hostname === 'localhost';
function chatSource(t) {
  let u; try { u = new URL(/^https?:\/\//i.test(t.url) ? t.url : 'https://' + t.url); } catch { return null; }
  const host = u.hostname.replace(/^(www|m)\./, ''), seg = u.pathname.split('/').filter(Boolean);
  if (host === 'twitch.tv' && seg[0] && !/^(videos|directory|clip)$/.test(seg[0]) && seg.length === 1) {
    const ch = encodeURIComponent(seg[0].toLowerCase());
    return onLocalhost ? { name: 'Twitch', embed: 'https://www.twitch.tv/embed/' + ch + '/chat?parent=localhost&darkpopout' }
      : { name: 'Twitch', popout: 'https://www.twitch.tv/popout/' + ch + '/chat?popout=' };
  }
  if (host === 'kick.com' && seg.length === 1) return { name: 'Kick', embed: 'https://kick.com/popout/' + encodeURIComponent(seg[0].toLowerCase()) + '/chat' };
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host) && t.live && t.vid) {
    return { name: 'YouTube', embed: 'https://www.youtube.com/live_chat?v=' + encodeURIComponent(t.vid) + '&embed_domain=' + encodeURIComponent(location.hostname) + '&dark_theme=1' };
  }
  return null;
}
function updateChatBtn(t) {
  const b = t.el.querySelector('[data-a=chat]'), src = chatSource(t);
  b.hidden = !src;
  if (!src) closeChat(t);
}
function closeChat(t) {
  if (t.chat) { t.chat.remove(); t.chat = null; }
  if (t.chatWin) { try { t.chatWin.close(); } catch {} t.chatWin = null; }
  const b = t.el && t.el.querySelector('[data-a=chat]'); if (b) b.classList.remove('on');
}
function toggleChat(t) {
  if (t.chat || (t.chatWin && !t.chatWin.closed)) return closeChat(t);
  const src = chatSource(t); if (!src) return;
  if (src.popout) {
    t.chatWin = window.open(src.popout, 'splitdeck-chat-' + t.id, 'width=360,height=640');
    if (!t.chatWin) return toast('The browser blocked the chat window. Allow pop-ups for SplitDeck and try again.');
    t.el.querySelector('[data-a=chat]').classList.add('on');
    return;
  }
  const c = document.createElement('div');
  c.className = 'chatpop';
  c.innerHTML = '<div class="chathead"><span>💬 ' + esc(src.name) + ' chat · ' + esc(t.title || '') + '</span><button title="Hide chat">✕</button></div><iframe allow="clipboard-write" referrerpolicy="origin"></iframe>';
  c.querySelector('iframe').src = src.embed;
  c.querySelector('button').onclick = () => closeChat(t);
  // start beside the player, inside the window
  const r = t.el.getBoundingClientRect(), W = Math.min(340, innerWidth - 16), H = Math.min(520, innerHeight - 16);
  const x = r.right + W + 8 <= innerWidth ? r.right + 8 : Math.max(8, r.right - W - 8);
  c.style.cssText = 'left:' + x + 'px;top:' + Math.max(8, Math.min(r.top, innerHeight - H - 8)) + 'px;width:' + W + 'px;height:' + H + 'px';
  dragChat(c);
  document.body.appendChild(c);
  t.chat = c;
  t.el.querySelector('[data-a=chat]').classList.add('on');
}
// move the chat window by its title bar (pointer capture keeps the drag working over the chat page)
function dragChat(c) {
  const head = c.querySelector('.chathead');
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const sx = e.clientX - c.offsetLeft, sy = e.clientY - c.offsetTop;
    try { head.setPointerCapture(e.pointerId); } catch {}
    c.classList.add('moving');
    const move = (ev) => {
      c.style.left = Math.min(innerWidth - 60, Math.max(0, ev.clientX - sx)) + 'px';
      c.style.top = Math.min(innerHeight - 30, Math.max(0, ev.clientY - sy)) + 'px';
    };
    const up = () => { c.classList.remove('moving'); head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up); };
    head.addEventListener('pointermove', move); head.addEventListener('pointerup', up); head.addEventListener('pointercancel', up);
  });
}
function removeTile(t) {
  if (focusId === t.id) exitFocus(); // closing the focused player returns to the grid
  const i = tiles.indexOf(t); if (i < 0) return;
  closeChat(t); destroyMedia(t); t.el.remove(); tiles.splice(i, 1);
  applyLayout(); updateMuteAll(); save();
}
function swap(i, j) {
  if (i === j || i < 0 || j < 0) return;
  [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  applyLayout(); save();
}

/* ---------------- drag & drop (swap places) ---------------- */
let dragSrc = null;
// Drag anywhere on a player (not just the handle). Works for mouse and touch; a plain click or tap is unaffected because the
// drag only starts after the pointer has moved a few pixels. (Players inside an iframe, like an embedded player, cannot be
// dragged this way because the iframe swallows the mouse; use the handle for those.)
function setupPointerDrag(t) {
  const box = t.box, dz = t.el.querySelector('.dropzone');
  box.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || focusId !== null) return;
    if (e.target.closest('.hud, .cfgmenu, .dropzone, .divider, button, a, input, select, textarea')) return;
    const st = { x: e.clientX, y: e.clientY, id: e.pointerId, on: false }, thr = e.pointerType === 'mouse' ? 6 : 10;
    let over = null;
    try { box.setPointerCapture(e.pointerId); } catch {}
    const move = (ev) => {
      if (ev.pointerId !== st.id) return;
      if (!st.on) {
        if (Math.hypot(ev.clientX - st.x, ev.clientY - st.y) < thr) return;
        st.on = true; t.dragged = true;
        dragSrc = t; document.body.classList.add('dragging'); t.el.classList.add('dragsrc');
        tiles.forEach((o) => o.box.classList.remove('active'));
      }
      const hit = document.elementFromPoint(ev.clientX, ev.clientY);
      const z = hit && hit.closest ? hit.closest('.dropzone') : null;
      if (over && over !== z) over.classList.remove('over');
      over = z && z !== dz ? z : null;
      if (over) over.classList.add('over');
    };
    const end = (ev) => {
      if (ev.pointerId !== st.id) return;
      box.removeEventListener('pointermove', move); box.removeEventListener('pointerup', end); box.removeEventListener('pointercancel', end);
      try { box.releasePointerCapture(st.id); } catch {}
      if (st.on) {
        document.body.classList.remove('dragging'); t.el.classList.remove('dragsrc');
        if (over && ev.type === 'pointerup') {
          const target = tiles.find((o) => o.el.querySelector('.dropzone') === over);
          if (target) swap(tiles.indexOf(t), tiles.indexOf(target));
        }
        document.querySelectorAll('.dropzone.over').forEach((d) => d.classList.remove('over'));
        dragSrc = null;
      }
    };
    box.addEventListener('pointermove', move); box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
  });
}

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
  if (focusId !== null) exitFocus(); // so the new player is visible
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
  if (e.key === 'Escape') {
    const panelOpen = !liveEl.hidden || !insEl.hidden || !signinEl.hidden, immersive = document.body.classList.contains('immersive');
    if (focusId !== null && !panelOpen && !immersive) { exitFocus(); return; }
    setImmersive(false); openLive(false); openInspect(false); openSignin(false);
  }
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
const live = { site: 'twitch', lang: '', qs: { twitch: '', kick: '', youtube: '' }, ttq: '', token: 0, cat: { twitch: '', kick: '', youtube: '' }, catName: { twitch: '', kick: '', youtube: '' }, cats: {}, langs: {}, next: null, loading: false, seen: new Set() };
try { live.lang = localStorage.getItem('splitdeck.lang') || ''; localStorage.removeItem('splitdeck.tiktok'); } catch {} // the old TikTok watchlist is gone
const kfmt = (n) => (n == null ? '' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K' : String(n));

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
  if (site === 'following') {
    liveCtl.innerHTML = '<div class="fsites">' + FOLLOW_SITES.map(([k, n]) => '<button type="button" data-k="' + k + '"' + (follow.off.includes(k) ? '' : ' class="on"') + '>' + n + '</button>').join('') + '</div>' +
      '<div class="hint">Live channels you follow, from the accounts saved under 🔑 Sign-ins. Checked every 2 minutes while SplitDeck is open.</div>' +
      '<label class="fnotify"><input type="checkbox"' + (follow.notify ? ' checked' : '') + '> Tell me when someone goes live</label>' +
      '<div class="hint">Twitch and TikTok are not included: they block this from outside their own sites.</div>';
    // a platform switched off is hidden here and left out of the background check
    liveCtl.querySelectorAll('.fsites button').forEach((b) => { b.onclick = () => {
      const k = b.dataset.k;
      follow.off = follow.off.includes(k) ? follow.off.filter((x) => x !== k) : follow.off.concat(k);
      try { localStorage.setItem('splitdeck.followoff', JSON.stringify(follow.off)); } catch {}
      if (follow.off.includes(k)) { delete follow.known[k]; followBadge(); }
      loadLive();
    }; });
    liveCtl.querySelector('.fnotify input').onchange = (e) => { follow.notify = e.target.checked; try { localStorage.setItem('splitdeck.follownotify', follow.notify ? '1' : '0'); } catch {} };
    return;
  }
  if (site === 'tiktok') {
    liveCtl.innerHTML = '<form class="srch"><input type="text" placeholder="Look up a TikTok username…" value="' + esc(live.ttq) + '"><button>Look up</button>' + (live.ttq ? '<button type="button" class="clr" title="Clear">✕</button>' : '') + '</form>' +
      '<div class="hint">TikTok has no public search or live list. Look up a username to see if they are live.</div>';
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

// "3 hours ago" today, "2 days ago" after that
function ago(sec) {
  const m = Math.max(0, (Date.now() / 1000 - sec) / 60), n = (v, u) => v + ' ' + u + (v === 1 ? '' : 's') + ' ago';
  if (m < 60) return m < 1 ? 'just now' : n(Math.floor(m), 'minute');
  if (m < 1440) return n(Math.floor(m / 60), 'hour');
  const d = Math.floor(m / 1440);
  return d < 31 ? n(d, 'day') : d < 365 ? n(Math.floor(d / 30), 'month') : n(Math.floor(d / 365), 'year');
}
function liveRow(it, kind) {
  const tt = kind !== 'std', off = tt && !it.live;
  const row = document.createElement('div');
  row.className = 'litem' + (off ? ' off' : '');
  const title = tt ? (it.found ? it.title || '' : 'User not found') : it.title;
  row.innerHTML = '<div class="lthumb">' + (it.thumb ? '<img loading="lazy" referrerpolicy="no-referrer" src="' + esc(it.thumb) + '">' : '') + (it.isLive ? '<span class="llive">LIVE</span>' : '') + (!off && it.viewers != null ? '<span class="lv">' + kfmt(it.viewers) + '</span>' : '') + '</div>' +
    '<div class="lmeta"><div class="lt">' + esc(title || '') + '</div><div class="lc">' + esc((tt ? '@' + it.user + (it.found && !it.live ? ' · offline' : '') : it.channel) + (it.category ? ' · ' + it.category : '') + (it.uploaded ? ' · ' + ago(it.uploaded) : '')) + '</div></div>';
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
  if (live.loading || !live.next || live.site === 'tiktok' || live.site === 'following') return;
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
  if (site === 'following') return loadFollowing(my);
  if (site === 'tiktok') {
    if (!live.ttq) return msg('', 'Look up a username above.');
    liveList.innerHTML = '<div class="lmsg"><div class="spin"></div>Loading…</div>';
    try {
      const res = await liveFetch('site=tiktok&users=' + encodeURIComponent(live.ttq));
      if (my !== live.token) return;
      liveList.innerHTML = '';
      res.forEach((it) => liveList.appendChild(liveRow(it, 'tt')));
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
/* ---------------- following: who is live on the user's own accounts (needs their sign-ins) ---------------- */
const FOLLOW_SITES = [['youtube', 'YouTube'], ['kick', 'Kick']]; // Twitch and TikTok block this from outside their own sites
const follow = { notify: true, known: {}, off: [] };
try { follow.notify = localStorage.getItem('splitdeck.follownotify') !== '0'; follow.off = JSON.parse(localStorage.getItem('splitdeck.followoff') || '[]'); } catch {}
const savedSignin = (site) => (signinAllowed && (loadSignins()[site] || {}).header) || '';
async function fetchFollowing(site) {
  const cookies = savedSignin(site);
  if (!cookies) return null;
  const r = await fetch('/api/following', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ site, cookies }) });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'failed');
  return d;
}
const followOne = fetchFollowing;
const canFollow = (site) => !follow.off.includes(site) && !!savedSignin(site);

// remember who is live per site; on later checks, announce the ones that just went live
function noteLive(site, items) {
  const prev = follow.known[site], now = new Set(items.map((it) => it.url));
  if (prev && follow.notify) {
    const fresh = items.filter((it) => !prev.has(it.url)), name = FOLLOW_SITES.find((s) => s[0] === site)[1];
    if (fresh.length === 1) toast(fresh[0].channel + ' is live on ' + name);
    else if (fresh.length > 1) toast(fresh.length + ' channels you follow went live on ' + name);
  }
  follow.known[site] = now;
  followBadge();
}
function followBadge() {
  const n = Object.values(follow.known).reduce((a, s) => a + s.size, 0), b = $('#liveBadge');
  b.textContent = n; b.hidden = !n; b.title = n + ' followed channel' + (n === 1 ? ' is' : 's are') + ' live';
}
function followPoll() {
  FOLLOW_SITES.forEach(([s]) => { if (canFollow(s)) followOne(s).then((d) => { if (d) noteLive(s, d.live || []); }).catch(() => {}); });
}

function loadFollowing(my) {
  liveList.innerHTML = '';
  if (!signinAllowed) { liveList.innerHTML = '<div class="lmsg">Sign-ins are turned off on this SplitDeck, so there is nothing to follow.</div>'; return; }
  const vbox = document.createElement('div'); // YouTube's latest videos go last, after every site's live list
  const shown = FOLLOW_SITES.filter(([s]) => !follow.off.includes(s));
  if (!shown.length) { liveList.innerHTML = '<div class="lmsg">Every platform is switched off. Pick one above.</div>'; return; }
  shown.forEach(([s, name]) => {
    const box = document.createElement('div'); liveList.appendChild(box);
    const head = '<div class="lsec">' + name + (s === 'youtube' ? ' · Live now' : '') + '</div>';
    const line = (html, cls) => box.insertAdjacentHTML('beforeend', '<div class="fmsg' + (cls ? ' ' + cls : '') + '">' + html + '</div>');
    if (!canFollow(s)) {
      box.innerHTML = head; line('Add your ' + name + ' sign-in to see who is live. <button class="clink">Open Sign-ins</button>');
      box.querySelector('.clink').onclick = () => openSignin(true, s);
      return;
    }
    box.innerHTML = head; line('<span class="spin sm"></span>Checking…');
    followOne(s).then((d) => {
      if (my !== live.token) return;
      noteLive(s, d.live || []);
      box.innerHTML = head;
      if (d.note) line(esc(d.note));
      if (!d.live.length && !d.note) line('Nobody you follow is live right now.');
      d.live.forEach((it) => box.appendChild(liveRow({ ...it, isLive: true }, 'std')));
      if (d.videos && d.videos.length) { vbox.innerHTML = '<div class="lsec">Latest videos · YouTube</div>'; d.videos.forEach((it) => vbox.appendChild(liveRow(it, 'std'))); }
    }).catch((e) => { if (my === live.token) { box.innerHTML = head; line(esc(e.message), 'err'); } });
  });
  liveList.appendChild(vbox);
}

function openLive(on = true) { liveEl.hidden = !on; if (on) { insEl.hidden = true; signinEl.hidden = true; loadLive(); } }
$('#liveBtn').onclick = (e) => { e.stopPropagation(); openLive(liveEl.hidden); };
$('#liveClose').onclick = () => openLive(false);
$('#liveRefresh').onclick = () => loadLive();
$('#liveTabs').onclick = (e) => {
  const b = e.target.closest('button[data-site]'); if (!b) return;
  live.site = b.dataset.site;
  document.querySelectorAll('#liveTabs button').forEach((x) => x.classList.toggle('on', x === b));
  loadLive();
};

/* ---------------- link finder: scan a page for .m3u8 / .mp4 / .flv links ---------------- */
const insEl = $('#inspect'), insForm = $('#inspForm'), insList = $('#inspList'), insInput = insForm.querySelector('input');
function openInspect(on = true) {
  insEl.hidden = !on;
  if (on) { liveEl.hidden = true; signinEl.hidden = true; setTimeout(() => insInput.focus(), 50); }
}
$('#inspectBtn').onclick = (e) => { e.stopPropagation(); openInspect(insEl.hidden); };
$('#inspClose').onclick = () => openInspect(false);
const KIND_LABEL = { hls: 'HLS', mp4: 'MP4', flv: 'FLV' };

async function copyText(txt) {
  try { await navigator.clipboard.writeText(txt); return true; } catch {}
  const ta = document.createElement('textarea');
  ta.value = txt; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch {}
  ta.remove(); return ok;
}
function probeText(p) {
  if (p.error) return { cls: 'bad', text: p.error };
  const bits = ['HTTP ' + p.status];
  if (p.status >= 400) { if (p.note) bits.push(p.note); return { cls: 'bad', text: bits.join(' · ') }; }
  if (p.kind === 'hls' && p.ok) {
    bits.push('HLS playlist');
    if (p.variants) bits.push(p.variants + ' quality level' + (p.variants === 1 ? '' : 's') + (p.heights && p.heights.length ? ' (' + p.heights[0] + 'p–' + p.heights[p.heights.length - 1] + 'p)' : ''));
    if (p.live === true) bits.push('live'); else if (p.live === false) bits.push('recorded');
    if (p.encrypted) bits.push('encrypted segments');
  } else if (p.ok) bits.push((p.kind || 'media').toUpperCase() + ' file');
  else bits.push('not recognised as ' + (p.kind || 'media').toUpperCase());
  if (p.note) bits.push(p.note);
  return { cls: p.ok ? 'good' : 'bad', text: bits.join(' · ') };
}
function inspectRow(r) {
  const row = document.createElement('div');
  row.className = 'irow';
  row.innerHTML = '<div class="itop"><span class="ibadge k-' + r.kind + '">' + KIND_LABEL[r.kind] + '</span><code class="iurl" title="' + esc(r.url) + '">' + esc(r.url) + '</code></div>' +
    '<div class="imeta">Found in ' + esc(r.where) + ' · ' + esc(r.via) + '</div>' +
    '<div class="iact"><button data-a="play">▶ Play</button><button data-a="copy">Copy</button><button data-a="test">Test</button></div><div class="iprobe" hidden></div>';
  const out = row.querySelector('.iprobe');
  row.querySelector('[data-a=play]').onclick = (e) => { if (addUrl(r.url)) e.target.textContent = 'Added ✓'; };
  row.querySelector('[data-a=copy]').onclick = async (e) => { const ok = await copyText(r.url); e.target.textContent = ok ? 'Copied ✓' : 'Copy failed'; setTimeout(() => { e.target.textContent = 'Copy'; }, 1500); };
  row.querySelector('[data-a=test]').onclick = async (e) => {
    const b = e.target; b.disabled = true; out.hidden = false; out.className = 'iprobe'; out.textContent = 'Testing…';
    try {
      const res = await fetch('/api/probe?url=' + encodeURIComponent(r.url)); const p = await res.json();
      const t = probeText(res.ok ? p : { error: p.error || 'failed' });
      out.className = 'iprobe ' + t.cls; out.textContent = t.text;
    } catch (err) { out.className = 'iprobe bad'; out.textContent = err.message; }
    b.disabled = false;
  };
  return row;
}
function renderInspect(d) {
  insList.innerHTML = '';
  const okDocs = d.scanned.filter((s) => !s.error), failed = d.scanned.length - okDocs.length;
  const frames = okDocs.filter((s) => s.kind === 'iframe').length, scripts = okDocs.filter((s) => s.kind === 'script').length;
  const sum = document.createElement('div');
  sum.className = 'isum';
  sum.innerHTML = '<b>' + esc(d.page.title || d.page.url) + '</b><div>Scanned the page, ' + frames + ' frame' + (frames === 1 ? '' : 's') + ' and ' + scripts + ' script' + (scripts === 1 ? '' : 's') +
    (failed ? ' (' + failed + ' could not be loaded)' : '') + '. Found <b>' + d.results.length + '</b> link' + (d.results.length === 1 ? '' : 's') + '.</div>' +
    '<button class="ipage">▶ Try the page link itself</button>';
  sum.querySelector('.ipage').onclick = (e) => { if (addUrl(d.page.url)) e.target.textContent = 'Added ✓'; };
  insList.appendChild(sum);
  if (!d.results.length) {
    insList.insertAdjacentHTML('beforeend', '<div class="lmsg">No direct .m3u8, .mp4 or .flv links in the page source.<br><small>Many pages only load their video with JavaScript after the page opens, or protect it. This tool does not run scripts or get around protection. “Try the page link itself” hands the page to yt-dlp, which understands many sites.</small></div>');
    return;
  }
  d.results.forEach((r) => insList.appendChild(inspectRow(r)));
}
insForm.onsubmit = async (e) => {
  e.preventDefault();
  const link = insInput.value.trim(); if (!link) return;
  insList.innerHTML = '<div class="lmsg"><div class="spin"></div>Scanning the page, its frames and scripts…</div>';
  try {
    const r = await fetch('/api/inspect?url=' + encodeURIComponent(link)); const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'failed');
    renderInspect(d);
  } catch (err) { insList.innerHTML = '<div class="lmsg err">' + esc(err.message) + '</div>'; }
};

/* ---------------- sign-ins (stored only in this browser) ---------------- */
const SIGNIN_KEY = 'splitdeck.signin';
const SIGNIN_SITES = [
  { key: 'tiktok', name: 'TikTok', domain: 'tiktok.com', home: 'https://www.tiktok.com/', host: /(^|\.)tiktok\.com$/i, why: 'Age-restricted (18+) LIVEs, and LIVEs limited to followers or subscribers.' },
  { key: 'youtube', name: 'YouTube', domain: 'youtube.com', home: 'https://www.youtube.com/', host: /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i, why: 'Age-restricted and members-only videos and streams, and your subscriptions in Live → Following.' },
  { key: 'twitch', name: 'Twitch', domain: 'twitch.tv', home: 'https://www.twitch.tv/', host: /(^|\.)twitch\.tv$/i, why: 'Subscriber-only streams and VODs.' },
  { key: 'kick', name: 'Kick', domain: 'kick.com', home: 'https://kick.com/', host: /(^|\.)kick\.com$/i, why: 'Your followed channels in Live → Following.' },
];
const signinEl = $('#signinPanel'), signinBody = $('#signinBody'), signinBtn = $('#signinBtn');
let signinAllowed = false;
const loadSignins = () => { try { return JSON.parse(localStorage.getItem(SIGNIN_KEY) || '{}') || {}; } catch { return {}; } };
const storeSignins = (o) => { try { localStorage.setItem(SIGNIN_KEY, JSON.stringify(o)); return true; } catch { return false; } };
function siteKeyOf(u) {
  let host = ''; try { host = new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u).hostname; } catch { return ''; }
  const s = SIGNIN_SITES.find((x) => x.host.test(host)); return s ? s.key : '';
}
function signinFor(u) { if (!signinAllowed) return ''; const k = siteKeyOf(u); const v = k && loadSignins()[k]; return v && v.header ? v.header : ''; }

// Turn any common export into "name=value; name=value", keeping only this site's cookies.
// Accepts: a cookies.txt (Netscape) export, a JSON export (array of {name, value, domain}), or a "name=value; ..." line.
function parseCookieText(text, site) {
  const t = String(text || '').trim(), pairs = new Map();
  const forSite = (d) => { d = String(d || '').replace(/^#HttpOnly_/, '').replace(/^\./, '').toLowerCase(); return d === site.domain || d.endsWith('.' + site.domain); };
  const now = Date.now() / 1000;
  if (!t) return { header: '', count: 0, skipped: 0 };
  let skipped = 0;
  if (t.startsWith('[') || t.startsWith('{')) {
    let arr; try { arr = JSON.parse(t); } catch { throw new Error('That looks like JSON but could not be read.'); }
    if (!Array.isArray(arr)) arr = arr.cookies || [arr];
    for (const c of arr) {
      if (!c || !c.name) continue;
      if (c.domain && !forSite(c.domain)) { skipped++; continue; }
      const exp = c.expirationDate || c.expires; if (exp && exp > 0 && exp < now) { skipped++; continue; }
      pairs.set(c.name, String(c.value == null ? '' : c.value));
    }
  } else if (/\t/.test(t)) {
    for (const line of t.split(/\r?\n/)) {
      if (!line || (line.startsWith('#') && !line.startsWith('#HttpOnly_'))) continue;
      const f = line.split('\t'); if (f.length < 7) continue;
      if (!forSite(f[0])) { skipped++; continue; }
      const exp = +f[4]; if (exp && exp < now) { skipped++; continue; }
      pairs.set(f[5], f[6]);
    }
  } else {
    for (const part of t.replace(/^cookie:\s*/i, '').split(/;\s*/)) { const i = part.indexOf('='); if (i > 0) pairs.set(part.slice(0, i).trim(), part.slice(i + 1).trim()); }
  }
  const header = [...pairs].filter(([n]) => /^[!#$%&'*+\-.^\w`|~]+$/.test(n)).map(([n, v]) => n + '=' + v).join('; ');
  return { header, count: header ? header.split('; ').length : 0, skipped };
}

function openSignin(on = true, focusKey) {
  signinEl.hidden = !on;
  if (on) {
    liveEl.hidden = true; insEl.hidden = true; renderSignin();
    if (focusKey) { const ta = signinBody.querySelector('[data-k="' + focusKey + '"] textarea'); if (ta) setTimeout(() => ta.focus(), 50); }
  }
}
signinBtn.onclick = (e) => { e.stopPropagation(); openSignin(signinEl.hidden); };
$('#signinClose').onclick = () => openSignin(false);

function renderSignin() {
  const saved = loadSignins();
  signinBody.innerHTML = '<div class="cinfo">Some streams only play for a signed-in account, for example age-restricted (18+) TikTok LIVEs. Paste your sign-in for that site here. It is <b>saved only in this browser</b> and sent only to your own SplitDeck server, and only when you open a stream from that site.</div>' +
    SIGNIN_SITES.map((s) => {
      const v = saved[s.key];
      const status = v && v.header ? '<span class="sgok">● Saved</span> · ' + v.count + ' cookie' + (v.count === 1 ? '' : 's') + ' · ' + esc(new Date(v.savedAt).toLocaleDateString()) : '<span class="sgno">○ Not set</span>';
      return '<div class="sgsite" data-k="' + s.key + '"><div class="sgtop"><b>' + s.name + '</b><span class="sgstat">' + status + '</span></div>' +
        '<div class="sgwhy">' + esc(s.why) + '</div>' +
        '<textarea spellcheck="false" autocomplete="off" placeholder="Paste a cookies.txt export, a JSON cookie export, or a name=value; … line"></textarea>' +
        '<div class="sgact"><button data-do="save">Save</button>' + (v && v.header ? '<button data-do="remove" class="danger">Remove</button>' : '') + '<span class="sgmsg"></span></div></div>';
    }).join('') +
    '<details class="sghow"><summary>How do I get my sign-in?</summary><ol>' +
      '<li>In your browser, sign in to the site (TikTok, YouTube, Twitch or Kick).</li>' +
      '<li>Install a cookie-export extension that saves in the <b>cookies.txt (Netscape)</b> or <b>JSON</b> format, for example “Get cookies.txt LOCALLY”.</li>' +
      '<li>Open the site, export its cookies, open the file, copy everything and paste it in the box above. Only that site’s cookies are kept.</li>' +
      '<li>Sign-ins expire. If a stream stops working, paste a fresh one.</li></ol></details>' +
    '<div class="hint cnote"><b>Keep it private:</b> a sign-in works like your password for that site. Only use this on your own SplitDeck, never on a copy run by someone else. <button class="clink" id="sgClearAll">Remove all sign-ins</button></div>';
  signinBody.querySelectorAll('.sgsite').forEach((box) => {
    const site = SIGNIN_SITES.find((x) => x.key === box.dataset.k), msg = box.querySelector('.sgmsg'), ta = box.querySelector('textarea');
    box.querySelector('[data-do=save]').onclick = () => {
      let p; try { p = parseCookieText(ta.value, site); } catch (e) { msg.textContent = e.message; msg.className = 'sgmsg bad'; return; }
      if (!p.count) { msg.textContent = 'No ' + site.name + ' cookies found in that text.'; msg.className = 'sgmsg bad'; return; }
      const all = loadSignins(); all[site.key] = { header: p.header, count: p.count, savedAt: Date.now() };
      if (!storeSignins(all)) { msg.textContent = 'This browser would not save it (private window?).'; msg.className = 'sgmsg bad'; return; }
      ta.value = '';
      renderSignin();
      const m2 = signinBody.querySelector('[data-k="' + site.key + '"] .sgmsg');
      if (m2) { m2.textContent = 'Saved' + (p.skipped ? ' (ignored ' + p.skipped + ' cookie' + (p.skipped === 1 ? '' : 's') + ' from other sites or expired)' : '') + '. Retry the stream.'; m2.className = 'sgmsg good'; }
      retrySiteTiles(site.key); followPoll();
    };
    const rm = box.querySelector('[data-do=remove]');
    if (rm) rm.onclick = () => { const all = loadSignins(); delete all[site.key]; storeSignins(all); delete follow.known[site.key]; followBadge(); renderSignin(); };
  });
  $('#sgClearAll').onclick = () => { if (!confirm('Remove all saved sign-ins from this browser?')) return; try { localStorage.removeItem(SIGNIN_KEY); } catch {} follow.known = {}; followBadge(); renderSignin(); };
}
// after saving a sign-in, retry the players from that site that failed
function retrySiteTiles(key) { tiles.forEach((t) => { if (siteKeyOf(t.url) === key && !t.status.hidden && t.status.classList.contains('err')) load(t); }); }

// the server says whether sign-ins are allowed here (only on this computer or the home network)
fetch('/api/config').then((r) => r.json()).then((c) => { signinAllowed = !!c.signin; signinBtn.hidden = !signinAllowed; }).catch(() => {})
  .then(() => { followPoll(); setInterval(followPoll, 120000); }); // track followed channels while the app is open

/* ---------------- reset ---------------- */
$('#resetBtn').onclick = () => {
  if (tiles.length && !confirm('Close all streams and start fresh?')) return;
  if (focusId !== null) exitFocus();
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
