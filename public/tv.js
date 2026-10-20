/* SplitDeck TV view. Shows the dashboard's players on a TV and is controlled from the dashboard or the TV remote.
   Written in plain older-style JavaScript (no arrow functions, async/await or optional chaining) so it runs
   in the browsers built into older smart TVs. */
(function () {
  'use strict';
  function qs(name) { var m = location.search.match(new RegExp('[?&]' + name + '=([^&]*)')); return m ? decodeURIComponent(m[1]) : ''; }
  var token = qs('t');
  var stage = document.getElementById('stage'), osd = document.getElementById('osd'), help = document.getElementById('help'), msg = document.getElementById('msg');

  var players = {};            // tile id -> player
  var tiles = [];              // tiles in dashboard order: {id, url, title, fill, rect}
  var focusId = null;          // enlarged tile id, or null for the whole grid
  var selId = null;            // tile highlighted for remote navigation
  var ringOn = false, ringTimer = null; // the selection ring only shows while the remote is in use
  var gesture = false;         // the user has pressed a key (needed before sound is allowed on some TVs)
  var osdTimer = null, helpTimer = null;

  /* ---------- small helpers ---------- */
  function showMsg(title, small, corner) {
    msg.innerHTML = '';
    msg.appendChild(document.createTextNode(title));
    if (small) { var s = document.createElement('small'); s.appendChild(document.createTextNode(small)); msg.appendChild(s); }
    msg.className = corner ? 'corner' : '';
  }
  function hideMsg() { msg.className = 'hidden'; }
  function post(path, body) {
    try {
      var x = new XMLHttpRequest();
      x.open('POST', path + '?t=' + encodeURIComponent(token), true);
      x.setRequestHeader('Content-Type', 'application/json');
      x.send(JSON.stringify(body));
    } catch (e) {}
  }
  function getJson(url, cb) {
    var x = new XMLHttpRequest();
    x.open('GET', url, true);
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      var data = null; try { data = JSON.parse(x.responseText); } catch (e) {}
      cb(x.status >= 200 && x.status < 300 ? null : ((data && data.error) || 'Request failed'), data);
    };
    x.send();
  }
  function tileById(id) { for (var i = 0; i < tiles.length; i++) if (tiles[i].id === id) return tiles[i]; return null; }
  function titleOf(id) { var t = tileById(id); if (!t) return ''; if (t.title) return t.title; try { return t.url.replace(/^https?:\/\//, '').slice(0, 60); } catch (e) { return ''; } }

  /* ---------- on-screen hints ---------- */
  function showOsd(text) {
    if (!text) return;
    osd.textContent = text; osd.className = 'on';
    clearTimeout(osdTimer); osdTimer = setTimeout(function () { osd.className = ''; }, 4000);
  }
  function showHelp() {
    help.className = 'on';
    clearTimeout(helpTimer); helpTimer = setTimeout(function () { help.className = ''; }, 6000);
  }

  /* ---------- players ---------- */
  function makePlayer(tile) {
    var el = document.createElement('div'); el.className = 'p';
    var inner = document.createElement('div'); inner.className = 'in';
    var ring = document.createElement('div'); ring.className = 'ring';
    el.appendChild(inner); el.appendChild(ring); stage.appendChild(el);
    var p = { id: tile.id, url: tile.url, el: el, inner: inner, video: null, iframe: null, hls: null, mpegts: null, data: null, srcIndex: 0, dead: false, watchdog: null, kind: '' };
    note(p, 'Loading…');
    resolveTile(p);
    return p;
  }
  function note(p, text, isErr) {
    var n = p.inner.querySelector('.note');
    if (!text) { if (n) p.inner.removeChild(n); return; }
    if (!n) { n = document.createElement('div'); p.inner.appendChild(n); }
    n.className = 'note' + (isErr ? ' err' : ''); n.textContent = text;
  }
  function destroyMedia(p) {
    clearTimeout(p.watchdog);
    if (p.hls) { try { p.hls.destroy(); } catch (e) {} p.hls = null; }
    if (p.mpegts) { try { p.mpegts.destroy(); } catch (e) {} p.mpegts = null; }
    p.video = null; p.iframe = null;
    var kids = p.inner.querySelectorAll('video, iframe');
    for (var i = 0; i < kids.length; i++) p.inner.removeChild(kids[i]);
  }
  function destroyPlayer(p) { p.dead = true; destroyMedia(p); if (p.el.parentNode) p.el.parentNode.removeChild(p.el); }
  function resolveTile(p) {
    getJson('/tv/resolve?t=' + encodeURIComponent(token) + '&url=' + encodeURIComponent(p.url), function (err, data) {
      if (p.dead) return;
      if (err) { note(p, err, true); return; }
      p.data = data; p.srcIndex = 0; mount(p);
    });
  }
  function nextSource(p, why) {
    var list = (p.data && p.data.sources) || [];
    if (p.srcIndex + 1 < list.length) { p.srcIndex++; destroyMedia(p); note(p, 'Trying another format…'); mount(p); }
    else note(p, why || 'Could not play this stream', true);
  }
  function mount(p) {
    if (p.dead) return;
    var d = p.data;
    if (d.type === 'youtube') {
      var f = document.createElement('iframe');
      f.src = 'https://www.youtube.com/embed/' + encodeURIComponent(d.id) + '?autoplay=1&mute=1&controls=0&rel=0&modestbranding=1&playsinline=1&enablejsapi=1';
      f.setAttribute('allow', 'autoplay; encrypted-media'); p.inner.appendChild(f); p.iframe = f; p.kind = 'youtube';
      f.onload = function () { note(p, ''); applyAudio(p); };
      return;
    }
    if (d.type === 'embed') {
      var e = document.createElement('iframe'); e.src = d.url; e.setAttribute('allow', 'autoplay; fullscreen'); p.inner.appendChild(e); p.iframe = e; p.kind = 'embed';
      e.onload = function () { note(p, ''); };
      return;
    }
    var src = (d.sources && d.sources[p.srcIndex]) || { type: d.type, url: d.url };
    var v = document.createElement('video');
    v.muted = true; v.autoplay = true; v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
    p.inner.appendChild(v); p.video = v; p.kind = 'video';
    v.addEventListener('playing', function () { clearTimeout(p.watchdog); note(p, ''); });
    v.addEventListener('error', function () { if (!p.hls && !p.mpegts) nextSource(p); });
    var start = function () { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); };
    p.watchdog = setTimeout(function () { if (v.readyState < 2) nextSource(p, 'The stream did not start'); }, 20000);
    if (src.type === 'hls' && window.Hls && Hls.isSupported()) {
      var h = new Hls({ capLevelToPlayerSize: true, lowLatencyMode: true, liveSyncDurationCount: 3, maxBufferLength: 20, backBufferLength: 30 });
      p.hls = h; h.loadSource(src.url); h.attachMedia(v);
      h.on(Hls.Events.MANIFEST_PARSED, start);
      var retries = 0;
      h.on(Hls.Events.ERROR, function (ev, data) {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && retries++ < 3) { setTimeout(function () { if (p.hls === h) h.startLoad(); }, 1500); }
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && retries++ < 3) h.recoverMediaError();
        else nextSource(p, 'Playback error');
      });
    } else if (src.type === 'flv' && window.mpegts && mpegts.isSupported()) {
      var m = mpegts.createPlayer({ type: 'flv', isLive: true, url: src.url }, { enableWorker: false, liveBufferLatencyChasing: true });
      p.mpegts = m; m.attachMediaElement(v); m.load(); start();
      m.on(mpegts.Events.ERROR, function () { nextSource(p, 'Stream error'); });
    } else { v.src = src.url; start(); }
    applyAudio(p);
  }

  /* ---------- sound: only the enlarged player, or the first one, is audible ---------- */
  function audibleId() { return focusId !== null ? focusId : (tiles.length ? tiles[0].id : null); }
  function applyAudio(p) {
    var on = p.id === audibleId();
    if (p.video) {
      var v = p.video;
      v.muted = !on; v.volume = 1;
      // browsers may refuse to unmute without a button press: fall back to muted and ask for OK
      if (on) setTimeout(function () {
        if (p.video === v && v.paused && !v.ended && v.readyState > 1 && !/ hide/.test(p.el.className)) {
          v.muted = true; var pr = v.play(); if (pr && pr.catch) pr.catch(function () {});
          if (!gesture) showOsd('Press OK on the remote to turn the sound on');
        }
      }, 400);
    }
    if (p.iframe && p.kind === 'youtube') {
      try { p.iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: on ? 'unMute' : 'mute', args: [] }), '*'); } catch (e) {}
    }
  }
  function applyAllAudio() { for (var id in players) if (players.hasOwnProperty(id)) applyAudio(players[id]); }

  /* ---------- layout ---------- */
  function setPaused(p, paused) {
    if (!p.video) return;
    try {
      if (paused) p.video.pause();
      else {
        if (p.hls) { try { p.hls.startLoad(); if (p.hls.liveSyncPosition) p.video.currentTime = p.hls.liveSyncPosition; } catch (e) {} }
        var pr = p.video.play(); if (pr && pr.catch) pr.catch(function () {});
      }
    } catch (e) {}
  }
  function layout() {
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i], p = players[t.id]; if (!p) continue;
      var r = t.rect;
      p.el.style.left = (r.x * 100) + '%'; p.el.style.top = (r.y * 100) + '%'; p.el.style.width = (r.w * 100) + '%'; p.el.style.height = (r.h * 100) + '%';
      var isFocus = focusId === t.id, hidden = focusId !== null && !isFocus;
      var cls = 'p' + (isFocus ? ' full' : '') + (hidden ? ' hide' : '') + (t.fill ? ' fill' : '') + (selId === t.id && focusId === null && ringOn ? ' sel' : '');
      var was = p.el.className;
      p.el.className = cls;
      var wasHidden = / hide/.test(was), nowHidden = hidden;
      if (nowHidden && !wasHidden) setPaused(p, true);          // save the TV's effort while one player is enlarged
      else if (!nowHidden && wasHidden) setPaused(p, false);
    }
    applyAllAudio();
  }
  function applyState(state) {
    tiles = state.tiles || []; focusId = state.focus === undefined ? focusId : state.focus;
    var ids = {};
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i]; ids[t.id] = true;
      var p = players[t.id];
      if (p && p.url !== t.url) { destroyPlayer(p); delete players[t.id]; p = null; }
      if (!p) players[t.id] = makePlayer(t);
    }
    for (var id in players) if (players.hasOwnProperty(id) && !ids[id]) { destroyPlayer(players[id]); delete players[id]; }
    if (selId === null || !tileById(selId)) selId = tiles.length ? tiles[0].id : null;
    if (focusId !== null && !tileById(focusId)) focusId = null;
    layout();
    if (tiles.length) hideMsg(); else showMsg('SplitDeck TV', 'Add players on the dashboard', false);
  }
  function setFocus(id, announce) {
    focusId = id; if (id !== null) selId = id;
    layout();
    if (announce !== false) showOsd(id !== null ? titleOf(id) : 'All players');
    if (id !== null) { try { history.pushState({ f: 1 }, ''); } catch (e) {} }
  }

  /* ---------- remote control ---------- */
  function move(dir) {
    var cur = tileById(selId); if (!cur) return;
    var cx = cur.rect.x + cur.rect.w / 2, cy = cur.rect.y + cur.rect.h / 2, best = null, bestScore = 1e9;
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i]; if (t.id === cur.id) continue;
      var dx = (t.rect.x + t.rect.w / 2) - cx, dy = (t.rect.y + t.rect.h / 2) - cy, along, across;
      if (dir === 'left') { along = -dx; across = Math.abs(dy); } else if (dir === 'right') { along = dx; across = Math.abs(dy); }
      else if (dir === 'up') { along = -dy; across = Math.abs(dx); } else { along = dy; across = Math.abs(dx); }
      if (along <= 0.001) continue;
      var score = along + across * 2;
      if (score < bestScore) { bestScore = score; best = t; }
    }
    if (best) { selId = best.id; layout(); showOsd(titleOf(selId)); }
  }
  function step(delta) { // previous / next player while one is enlarged
    var idx = -1; for (var i = 0; i < tiles.length; i++) if (tiles[i].id === focusId) idx = i;
    if (idx < 0 || tiles.length < 2) return;
    var n = tiles[(idx + delta + tiles.length) % tiles.length];
    post('/tv/focus', { id: n.id });
  }
  document.addEventListener('keydown', function (e) {
    var k = e.keyCode, handled = true;
    if (!gesture) { gesture = true; applyAllAudio(); }
    showHelp();
    ringOn = true; clearTimeout(ringTimer); ringTimer = setTimeout(function () { ringOn = false; layout(); }, 8000);
    if (k === 37) { if (focusId !== null) step(-1); else move('left'); }
    else if (k === 39) { if (focusId !== null) step(1); else move('right'); }
    else if (k === 38) { if (focusId !== null) step(-1); else move('up'); }
    else if (k === 40) { if (focusId !== null) step(1); else move('down'); }
    else if (k === 13) { if (focusId === null && selId !== null) post('/tv/focus', { id: selId }); else post('/tv/focus', { id: null }); }
    else if (k === 10009 || k === 8 || k === 27) { if (focusId !== null) post('/tv/focus', { id: null }); else handled = false; }
    else handled = false;
    if (handled) e.preventDefault();
  });
  document.addEventListener('click', function () { gesture = true; applyAllAudio(); });
  window.addEventListener('popstate', function () { if (focusId !== null) post('/tv/focus', { id: null }); }); // the TV's Back button returns to the grid

  /* ---------- connection to the dashboard ---------- */
  var es = null;
  function connect() {
    if (!window.EventSource) { showMsg('This browser is too old', 'SplitDeck TV needs EventSource support', false); return; }
    es = new EventSource('/tv/events?t=' + encodeURIComponent(token));
    es.addEventListener('state', function (e) { try { applyState(JSON.parse(e.data)); } catch (err) {} });
    es.addEventListener('focus', function (e) { try { var d = JSON.parse(e.data); if (d.id !== focusId) setFocus(d.id); } catch (err) {} });
    es.addEventListener('bye', function () { es.close(); showMsg('Casting ended', 'You can close this page', false); });
    es.onopen = function () { if (tiles.length) hideMsg(); else showMsg('SplitDeck TV', 'Waiting for the dashboard…', false); };
    es.onerror = function () { showMsg('Reconnecting…', '', true); };
  }
  if (!token) showMsg('SplitDeck TV', 'This link is missing its code. Start casting from SplitDeck.', false);
  else connect();
})();
