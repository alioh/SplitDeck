// Casting to a TV.
//
// How it works: the TV opens a read-only "TV view" page served by this computer. The dashboard pushes its
// players and layout to that page, so the TV shows the same screen and can enlarge one player.
//  - Samsung (Tizen) TVs: found with SSDP, then asked (over Samsung's remote-control WebSocket) to open
//    the TV view in their web browser. The TV shows an "Allow" prompt the first time.
//  - Any other TV with a web browser: SplitDeck shows the address to open.
// While casting, a second listener on the local network serves ONLY the TV view, protected by a random token,
// and only lets the TV resolve/play the links currently on the dashboard. It is closed when casting stops.
'use strict';
const http = require('http');
const net = require('net');
const tls = require('tls');
const dgram = require('dgram');
const os = require('os');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

module.exports = function createCast(ctx) {
  const { resolve, handleProxy, masters, PUBLIC, DATA_DIR } = ctx;
  const CAST_PORT = parseInt(process.env.CAST_PORT, 10) || 8788;

  /* ---------------- small helpers ---------------- */
  const json = (res, code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };
  const readJson = (req, limit = 1 << 20) => new Promise((resolveBody, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolveBody(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
  const sse = (res, event, data) => { try { res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'); } catch {} };
  const ipToInt = (ip) => ip.split('.').reduce((a, b) => ((a << 8) + (+b)) >>> 0, 0);
  const lanInterfaces = () => {
    const out = [];
    for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a);
    return out;
  };
  const lanIpFor = (tvIp) => {
    const ifs = lanInterfaces();
    if (tvIp) { const t = ipToInt(tvIp); for (const a of ifs) { const m = ipToInt(a.netmask); if ((ipToInt(a.address) & m) === (t & m)) return a.address; } }
    return ifs[0] ? ifs[0].address : '127.0.0.1';
  };
  const readData = (file, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')); } catch { return fallback; } };
  const writeData = (file, obj) => { try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(obj, null, 2)); } catch {} };
  const tsEqual = (a, b) => { try { return a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch { return false; } };

  /* ---------------- minimal WebSocket client (for Samsung's remote API) ---------------- */
  function wsConnect({ host, port, path: p, secure, timeout = 8000 }) {
    return new Promise((resolveConn, reject) => {
      const key = crypto.randomBytes(16).toString('base64');
      const sock = secure ? tls.connect({ host, port, rejectUnauthorized: false }) : net.connect({ host, port }); // TVs use self-signed certificates
      let buf = Buffer.alloc(0), open = false, ended = false, partial = null;
      const onMsg = [], onClose = [];
      const timer = setTimeout(() => { sock.destroy(); reject(new Error('The TV did not answer')); }, timeout);
      const finish = () => { if (ended) return; ended = true; onClose.forEach((f) => f()); };
      const frame = (op, payload) => {
        const body = Buffer.from(payload || ''), mask = crypto.randomBytes(4), n = body.length;
        const head = n < 126 ? Buffer.from([0x80 | op, 0x80 | n]) : n < 65536 ? Buffer.from([0x80 | op, 0x80 | 126, n >> 8, n & 255]) : null;
        if (!head) throw new Error('Message too large');
        const masked = Buffer.alloc(n); for (let i = 0; i < n; i++) masked[i] = body[i] ^ mask[i % 4];
        return Buffer.concat([head, mask, masked]);
      };
      const api = {
        send: (text) => sock.write(frame(1, text)),
        close: () => { try { sock.write(frame(8, '')); } catch {} sock.end(); setTimeout(() => sock.destroy(), 300); },
        onMessage: (f) => onMsg.push(f), onClose: (f) => onClose.push(f),
      };
      const parse = () => {
        for (;;) {
          if (buf.length < 2) return;
          const fin = !!(buf[0] & 0x80), op = buf[0] & 0x0f; let len = buf[1] & 0x7f, off = 2;
          if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (buf.length < 10) return; len = buf.readUInt32BE(6); off = 10; }
          const masked = !!(buf[1] & 0x80); if (masked) off += 4;
          if (buf.length < off + len) return;
          let payload = buf.slice(off, off + len);
          if (masked) { const m = buf.slice(off - 4, off); payload = Buffer.from(payload.map((b, i) => b ^ m[i % 4])); }
          buf = buf.slice(off + len);
          if (op === 9) { try { sock.write(frame(10, payload)); } catch {} }
          else if (op === 8) { api.close(); return; }
          else if (op === 1 || op === 0) {
            partial = op === 1 ? payload : Buffer.concat([partial || Buffer.alloc(0), payload]);
            if (fin) { const text = partial.toString('utf8'); partial = null; onMsg.forEach((f) => f(text)); }
          }
        }
      };
      sock.on(secure ? 'secureConnect' : 'connect', () => {
        sock.write('GET ' + p + ' HTTP/1.1\r\nHost: ' + host + ':' + port + '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
      });
      sock.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        if (!open) {
          const i = buf.indexOf('\r\n\r\n'); if (i < 0) return;
          const head = buf.slice(0, i).toString(); buf = buf.slice(i + 4);
          clearTimeout(timer);
          if (!/^HTTP\/1\.1 101/.test(head)) { sock.destroy(); return reject(new Error('The TV refused the connection')); }
          open = true; resolveConn(api);
        }
        parse();
      });
      sock.on('error', (e) => { if (!open) { clearTimeout(timer); reject(e); } else finish(); });
      sock.on('close', () => { if (!open) { clearTimeout(timer); reject(new Error('The TV closed the connection')); } finish(); });
    });
  }

  /* ---------------- Samsung (Tizen) driver ---------------- */
  const tokenStore = () => readData('cast-tokens.json', {});
  async function samsungInfo(ip, port = 8001, timeout = 3000) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeout);
    try {
      const r = await fetch('http://' + ip + ':' + port + '/api/v2/', { signal: ac.signal });
      const j = await r.json();
      return j && j.device ? j : null;
    } catch { return null; } finally { clearTimeout(t); }
  }
  // one remote-control session: connect (the TV may ask the user to allow it), then ask it to open the browser at `url`
  function samsungSession(ip, target, url, status) {
    const tokens = tokenStore(), token = tokens[ip] || '';
    const name = Buffer.from('SplitDeck').toString('base64');
    const p = '/api/v2/channels/samsung.remote.control?name=' + name + (token ? '&token=' + token : '');
    status('connecting', 'Connecting to the TV…');
    return wsConnect({ host: ip, port: target.port, path: p, secure: target.secure, timeout: 8000 }).then((ws) => new Promise((resolveS, rejectS) => {
      let done = false;
      const end = (err) => { if (done) return; done = true; clearTimeout(waitTimer); try { ws.close(); } catch {} err ? rejectS(err) : resolveS(); };
      let waitTimer = setTimeout(() => end(Object.assign(new Error(token ? 'The TV did not answer' : 'No answer from the TV. Did you choose Allow on the TV?'), { fatal: true })), token ? 12000 : 60000);
      if (!token) status('allow', 'Look at your TV and choose “Allow” with the remote.');
      let connected = false;
      ws.onClose(() => { if (!connected) end(new Error('The TV closed the connection')); });
      ws.onMessage((text) => {
        let m; try { m = JSON.parse(text); } catch { return; }
        const ev = m.event || '';
        if (ev === 'ms.channel.connect') {
          connected = true;
          if (m.data && m.data.token) { const all = tokenStore(); all[ip] = String(m.data.token); writeData('cast-tokens.json', all); }
          status('opening', 'Opening the TV view…');
          ws.send(JSON.stringify({ method: 'ms.channel.emit', params: { event: 'ed.apps.launch', to: 'host', data: { action_type: 'NATIVE_LAUNCH', appId: 'org.tizen.browser', metaTag: url } } }));
          setTimeout(() => end(), 1800); // give the TV a moment to report an error before we hang up
        } else if (ev === 'ms.channel.unauthorized' || ev === 'ms.error' || ev === 'ms.channel.timeOut') {
          end(Object.assign(new Error(ev === 'ms.channel.timeOut' ? 'The TV timed out waiting for Allow.' : 'The TV did not allow SplitDeck. In the TV settings, check Connection Manager / Device Connection manager, then try again.'), { fatal: true }));
        }
      });
    }));
  }
  async function samsungLaunch(ip, url, status, o = {}) {
    const targets = [{ secure: true, port: o.securePort || 8002 }, { secure: false, port: o.plainPort || 8001 }];
    let last;
    for (const t of targets) {
      try { return await samsungSession(ip, t, url, status); }
      catch (e) { last = e; if (e.fatal) throw e; }
    }
    throw last || new Error('Could not reach the TV');
  }

  /* ---------------- finding TVs (SSDP) ---------------- */
  const ST = ['urn:samsung.com:device:RemoteControlReceiver:1', 'urn:schemas-upnp-org:device:MediaRenderer:1', 'urn:dial-multiscreen-org:service:dial:1'];
  function ssdpSearch(timeoutMs = 3500) {
    return new Promise((resolveS) => {
      const hits = new Map(), socks = [];
      const ifs = lanInterfaces();
      if (!ifs.length) return resolveS([]);
      ifs.forEach((a) => {
        const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        socks.push(s);
        s.on('error', () => {});
        s.on('message', (msg, rinfo) => {
          const h = {}; msg.toString().split('\r\n').forEach((l) => { const i = l.indexOf(':'); if (i > 0) h[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim(); });
          const prev = hits.get(rinfo.address) || { ip: rinfo.address, sts: new Set() };
          if (h.location) prev.location = h.location;
          if (h.st) prev.sts.add(h.st);
          if (h.server) prev.server = h.server;
          hits.set(rinfo.address, prev);
        });
        s.bind(0, a.address, () => {
          try { s.setMulticastTTL(2); s.setMulticastInterface(a.address); } catch {}
          ST.forEach((st) => {
            const m = Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ' + st + '\r\n\r\n');
            try { s.send(m, 1900, '239.255.255.250'); } catch {}
          });
        });
      });
      setTimeout(() => { socks.forEach((s) => { try { s.close(); } catch {} }); resolveS([...hits.values()]); }, timeoutMs);
    });
  }
  const unescapeXml = (t) => t.replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const xmlTag = (xml, tag) => { const m = xml.match(new RegExp('<' + tag + '>([^<]*)</' + tag + '>', 'i')); return m ? unescapeXml(m[1].trim()) : ''; };
  async function describe(hit) {
    const out = { ip: hit.ip, name: '', model: '', manufacturer: '', kind: 'other', driver: 'manual' };
    if (hit.location) {
      const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 2500);
      try { const xml = await (await fetch(hit.location, { signal: ac.signal })).text(); out.name = xmlTag(xml, 'friendlyName'); out.model = xmlTag(xml, 'modelName'); out.manufacturer = xmlTag(xml, 'manufacturer'); } catch {} finally { clearTimeout(t); }
    }
    const sams = await samsungInfo(hit.ip, 8001, 2500);
    if (sams || /samsung/i.test(out.manufacturer) || [...hit.sts].some((s) => /samsung/i.test(s))) {
      out.kind = 'samsung'; out.driver = 'samsung';
      if (sams) { out.name = out.name || sams.device.name || ''; out.model = out.model || sams.device.modelName || ''; }
    } else if (/\blg\b|lge/i.test(out.manufacturer)) out.kind = 'lg';
    else if (/sony/i.test(out.manufacturer)) out.kind = 'sony';
    else if (/google/i.test(out.manufacturer)) out.kind = 'chromecast';
    else if (/roku/i.test(out.manufacturer + (hit.server || ''))) out.kind = 'roku';
    out.name = out.name || out.model || out.manufacturer || hit.ip;
    return out;
  }
  async function scan() {
    const hits = await ssdpSearch();
    const found = await Promise.all(hits.map((h) => describe(h)));
    const saved = readData('cast-tvs.json', []);
    saved.forEach((s) => { if (!found.some((f) => f.ip === s.ip)) found.push(Object.assign({}, s, { saved: true })); });
    const rank = { samsung: 0, lg: 1, sony: 1, chromecast: 2, roku: 2, other: 3 };
    return found.sort((a, b) => (rank[a.kind] - rank[b.kind]) || a.name.localeCompare(b.name));
  }
  const rememberTv = (tv) => { const all = readData('cast-tvs.json', []).filter((x) => x.ip !== tv.ip); all.push({ ip: tv.ip, name: tv.name, model: tv.model || '', manufacturer: tv.manufacturer || '', kind: tv.kind, driver: tv.driver }); writeData('cast-tvs.json', all); };

  /* ---------------- the cast session ---------------- */
  const S = {
    active: false, token: '', tv: null, tvUrl: '', phase: 'idle', message: '', lanServer: null, port: 0, sockets: new Set(),
    state: { tiles: [], focus: null, seq: 0 }, tvClients: new Set(), ctlClients: new Set(),
    allowedUrls: new Set(), sids: new Set(), mids: new Set(),
  };
  const publicStatus = () => ({ active: S.active, phase: S.phase, message: S.message, tv: S.tv, tvUrl: S.tvUrl, tvClients: S.tvClients.size, focus: S.state.focus });
  const broadcastCtl = (event, data) => S.ctlClients.forEach((r) => sse(r, event, data));
  const broadcastTv = (event, data) => S.tvClients.forEach((r) => sse(r, event, data));
  const setPhase = (phase, message) => { S.phase = phase; S.message = message || ''; broadcastCtl('status', publicStatus()); };
  function setFocus(id) {
    if (id !== null && !S.state.tiles.some((t) => t.id === id)) return false;
    S.state.focus = id; S.state.seq++;
    broadcastTv('focus', { id }); broadcastCtl('focus', { id });
    return true;
  }
  function setState(body) {
    const tiles = (Array.isArray(body.tiles) ? body.tiles : []).slice(0, 8).map((t) => ({
      id: +t.id, url: String(t.url || '').slice(0, 2000), title: String(t.title || '').slice(0, 200), fill: !!t.fill,
      rect: t.rect && ['x', 'y', 'w', 'h'].every((k) => typeof t.rect[k] === 'number') ? { x: t.rect.x, y: t.rect.y, w: t.rect.w, h: t.rect.h } : { x: 0, y: 0, w: 1, h: 1 },
    })).filter((t) => Number.isFinite(t.id) && t.url);
    S.state.tiles = tiles; S.allowedUrls = new Set(tiles.map((t) => t.url));
    if (S.state.focus !== null && !tiles.some((t) => t.id === S.state.focus)) S.state.focus = null;
    S.state.seq++;
    broadcastTv('state', S.state); broadcastCtl('focus', { id: S.state.focus });
  }
  // remember which proxy sessions / playlists came from resolves done for the TV, so the TV can fetch only those
  function trackAllowed(data) {
    const s = JSON.stringify(data);
    for (const m of s.matchAll(/[?&]s=([0-9a-f]{16})/g)) S.sids.add(m[1]);
    for (const m of s.matchAll(/\/master\?id=([0-9a-f]{16})/g)) S.mids.add(m[1]);
  }

  /* ---- the listener the TV connects to (only while casting) ---- */
  const TV_FILES = {
    '/tv': ['tv.html', 'text/html; charset=utf-8'], '/tv.js': ['tv.js', 'text/javascript; charset=utf-8'], '/tv.css': ['tv.css', 'text/css; charset=utf-8'],
    '/vendor/hls.min.js': ['vendor/hls.min.js', 'text/javascript; charset=utf-8'], '/vendor/mpegts.js': ['vendor/mpegts.js', 'text/javascript; charset=utf-8'],
  };
  async function lanHandler(req, res) {
    const u = new URL(req.url, 'http://tv.local');
    const p = u.pathname, authed = S.active && tsEqual(u.searchParams.get('t') || '', S.token);
    try {
      if (TV_FILES[p]) {
        if (p === '/tv' && !authed) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Casting is not active, or this link has expired. Start casting again from SplitDeck.'); }
        const [file, type] = TV_FILES[p];
        const data = fs.readFileSync(path.join(PUBLIC, file));
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); return res.end(data);
      }
      if (p === '/tv/events') {
        if (!authed) { res.writeHead(403); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        S.tvClients.add(res); sse(res, 'state', S.state); broadcastCtl('status', publicStatus());
        const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch {} }, 15000);
        req.on('close', () => { clearInterval(hb); S.tvClients.delete(res); broadcastCtl('status', publicStatus()); });
        return;
      }
      if (p === '/tv/resolve') {
        if (!authed) return json(res, 403, { error: 'Not allowed' });
        const target = u.searchParams.get('url') || '';
        if (!S.allowedUrls.has(target)) return json(res, 403, { error: 'That link is not on the dashboard' });
        const data = await resolve(target, u.searchParams.get('embed') === '1');
        trackAllowed(data);
        return json(res, 200, data);
      }
      if (p === '/tv/focus' && req.method === 'POST') {
        if (!authed) return json(res, 403, { error: 'Not allowed' });
        const b = await readJson(req, 4096);
        return json(res, 200, { ok: setFocus(b.id === null || b.id === undefined ? null : +b.id) });
      }
      if (p === '/proxy') {
        return handleProxy(req, res, u.searchParams, (sid) => S.active && S.sids.has(sid));
      }
      if (p === '/master') {
        const text = S.active && S.mids.has(u.searchParams.get('id')) ? masters.get(u.searchParams.get('id')) : null;
        if (!text) { res.writeHead(404); return res.end('expired'); }
        res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
        return res.end(text);
      }
      res.writeHead(404); res.end('not found');
    } catch (e) {
      if (!res.headersSent) json(res, 422, { error: e.message }); else res.end();
    }
  }
  function listenLan() {
    return new Promise((resolveL, rejectL) => {
      const tryPort = (port, left) => {
        const srv = http.createServer(lanHandler);
        srv.on('connection', (sk) => { S.sockets.add(sk); sk.on('close', () => S.sockets.delete(sk)); });
        srv.once('error', (e) => { if (e.code === 'EADDRINUSE' && left > 0) tryPort(port + 1, left - 1); else rejectL(e); });
        srv.listen(port, '0.0.0.0', () => { S.lanServer = srv; S.port = port; resolveL(port); });
      };
      tryPort(CAST_PORT, 10);
    });
  }
  function stopSession() {
    if (!S.active && !S.lanServer) return;
    broadcastTv('bye', {});
    S.active = false; S.token = ''; S.tv = null; S.tvUrl = ''; S.phase = 'idle'; S.message = '';
    S.state = { tiles: [], focus: null, seq: 0 }; S.allowedUrls = new Set(); S.sids = new Set(); S.mids = new Set();
    const srv = S.lanServer; S.lanServer = null;
    setTimeout(() => { S.tvClients.forEach((r) => { try { r.end(); } catch {} }); S.tvClients.clear(); S.sockets.forEach((sk) => sk.destroy()); if (srv) srv.close(); }, 400);
    broadcastCtl('status', publicStatus());
  }
  async function startSession(tv) {
    if (S.active) stopSession();
    await new Promise((r) => setTimeout(r, S.lanServer ? 500 : 0));
    await listenLan();
    S.active = true; S.token = crypto.randomBytes(16).toString('hex'); S.tv = tv || null;
    S.state = { tiles: [], focus: null, seq: 0 };
    S.tvUrl = 'http://' + lanIpFor(tv && tv.ip) + ':' + S.port + '/tv?t=' + S.token;
    if (tv && tv.driver === 'samsung') {
      rememberTv(tv);
      setPhase('connecting', 'Connecting to the TV…');
      samsungLaunch(tv.ip, S.tvUrl, (ph, msg) => { if (S.active) setPhase(ph, msg); })
        .then(() => { if (S.active) setPhase('opened', 'Waiting for the TV to load the view…'); })
        .catch((e) => { if (S.active) setPhase('error', e.message); });
    } else {
      if (tv && tv.ip) rememberTv(tv);
      setPhase('manual', 'Open this address in the TV’s web browser.');
    }
    return publicStatus();
  }

  /* ---------------- requests from the dashboard (127.0.0.1 only) ---------------- */
  async function handleLocal(req, res, url) {
    const p = url.pathname;
    try {
      if (p === '/api/cast/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        S.ctlClients.add(res); sse(res, 'status', publicStatus());
        const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch {} }, 15000);
        req.on('close', () => { clearInterval(hb); S.ctlClients.delete(res); });
        return true;
      }
      if (p === '/api/cast/info') { json(res, 200, publicStatus()); return true; }
      if (p === '/api/cast/scan') { json(res, 200, { items: await scan() }); return true; }
      if (p === '/api/cast/probe') {
        const ip = (url.searchParams.get('ip') || '').trim();
        if (!net.isIPv4(ip)) { json(res, 422, { error: 'Enter the TV’s IP address, like 192.168.1.20' }); return true; }
        const info = await samsungInfo(ip);
        const tv = info
          ? { ip, name: info.device.name || 'Samsung TV', model: info.device.modelName || '', manufacturer: 'Samsung', kind: 'samsung', driver: 'samsung' }
          : { ip, name: ip, model: '', manufacturer: '', kind: 'other', driver: 'manual' };
        json(res, 200, tv); return true;
      }
      if (req.method === 'POST' && p === '/api/cast/start') {
        const b = await readJson(req, 8192);
        const tv = b.ip ? { ip: String(b.ip), name: String(b.name || b.ip), model: String(b.model || ''), manufacturer: String(b.manufacturer || ''), kind: String(b.kind || 'other'), driver: b.driver === 'samsung' ? 'samsung' : 'manual' } : null;
        if (tv && !net.isIPv4(tv.ip)) { json(res, 422, { error: 'Invalid TV address' }); return true; }
        json(res, 200, await startSession(tv)); return true;
      }
      if (req.method === 'POST' && p === '/api/cast/state') {
        if (!S.active) { json(res, 409, { error: 'Not casting' }); return true; }
        setState(await readJson(req)); json(res, 200, { ok: true, tvClients: S.tvClients.size }); return true;
      }
      if (req.method === 'POST' && p === '/api/cast/focus') {
        if (!S.active) { json(res, 409, { error: 'Not casting' }); return true; }
        const b = await readJson(req, 4096);
        json(res, 200, { ok: setFocus(b.id === null || b.id === undefined ? null : +b.id) }); return true;
      }
      if (req.method === 'POST' && p === '/api/cast/stop') { stopSession(); json(res, 200, { ok: true }); return true; }
      if (req.method === 'POST' && p === '/api/cast/reopen') {
        if (!S.active || !S.tv || S.tv.driver !== 'samsung') { json(res, 409, { error: 'Nothing to reopen' }); return true; }
        setPhase('connecting', 'Connecting to the TV…');
        samsungLaunch(S.tv.ip, S.tvUrl, (ph, msg) => { if (S.active) setPhase(ph, msg); })
          .then(() => { if (S.active) setPhase('opened', 'Waiting for the TV to load the view…'); })
          .catch((e) => { if (S.active) setPhase('error', e.message); });
        json(res, 200, { ok: true }); return true;
      }
    } catch (e) { json(res, 422, { error: e.message }); return true; }
    return false;
  }

  return { handleLocal, stopSession, _test: { samsungLaunch, wsConnect, ssdpSearch, describe, S } };
};
