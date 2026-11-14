// VELOCITY X online server (beta). Rooms, ready-up, server-side race clock + finish times, position sanity checks, persistent leaderboard.
// NOT physics-authoritative: clients report positions, the server rejects impossible jumps and decides finish times itself.
const http = require('http'), fs = require('fs'), { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 8080, LB = 'leaderboard.json';
let lb = fs.existsSync(LB) ? JSON.parse(fs.readFileSync(LB)) : [];
const srv = http.createServer((q, r) => {
  r.setHeader('Access-Control-Allow-Origin', '*'); r.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (q.method === 'OPTIONS') return r.end();
  if (q.url === '/leaderboard') { r.setHeader('content-type', 'application/json'); return r.end(JSON.stringify(lb.slice(0, 20))); }
  if (q.url === '/score' && q.method === 'POST') {
    let b = ''; q.on('data', d => { b += d; if (b.length > 1e4) q.destroy(); });
    q.on('end', () => { try { const s = JSON.parse(b);
      if (typeof s.time === 'number' && s.time > 20 && s.time < 3600 && typeof s.name === 'string') {
        lb.push({ name: s.name.slice(0, 16), loc: s.loc | 0, time: s.time, d: Date.now() }); lb.sort((a, c) => a.time - c.time); lb = lb.slice(0, 200); fs.writeFileSync(LB, JSON.stringify(lb)); } } catch (e) {} r.end('ok'); });
    return;
  }
  r.end('VELOCITY X server');
});
const wss = new WebSocketServer({ server: srv }), rooms = {}; let nid = 1;
const send = (w, o) => w.readyState === 1 && w.send(JSON.stringify(o));
const list = rm => [...rm.players].map(p => ({ id: p.id, name: p.name, ready: p.ready, car: p.car }));
const bcast = (rm, o, except) => rm.players.forEach(p => p !== except && send(p, o));
wss.on('connection', ws => {
  ws.id = nid++; send(ws, { t: 'hello', id: ws.id });
  ws.on('message', m => { let d; try { d = JSON.parse(m); } catch (e) { return; }
    if (d.t === 'join') {
      const name = String(d.room || 'lobby').slice(0, 20), rm = rooms[name] = rooms[name] || { players: new Set(), state: 'lobby', order: [] };
      if (rm.state !== 'lobby' || rm.players.size >= 16) return send(ws, { t: 'error', msg: 'room busy' });
      ws.rm = rm; ws.name = String(d.name || 'Driver').slice(0, 16); ws.car = d.car | 0; ws.ready = false; rm.players.add(ws);
      return bcast(rm, { t: 'room', players: list(rm) }), send(ws, { t: 'room', players: list(rm) });
    }
    const rm = ws.rm; if (!rm) return;
    if (d.t === 'ready') { ws.ready = !ws.ready; bcast(rm, { t: 'room', players: list(rm) }); send(ws, { t: 'room', players: list(rm) });
      if (rm.players.size >= 2 && [...rm.players].every(p => p.ready)) {
        rm.state = 'race'; rm.order = []; rm.t0 = Date.now() + 4000;
        const cfg = { loc: Math.floor(Math.random() * 6), laps: 2, wx: ['clear', 'rain', 'fog'][Math.floor(Math.random() * 3)], tod: 'day' }; let s = 0;
        const players = list(rm); rm.players.forEach(p => { p.slot = s++; p.fin = null; p.lp = null; send(p, { t: 'start', cfg, slot: p.slot, me: p.id, players }); }); } }
    if (d.t === 'pos' && rm.state === 'race' && Date.now() >= rm.t0 - 500) {
      const now = Date.now(), n = { x: +d.x, z: +d.z };
      if (!isFinite(n.x) || !isFinite(n.z)) return;
      if (ws.lp) { const dt = (now - ws.lp.t) / 1000, dist = Math.hypot(n.x - ws.lp.x, n.z - ws.lp.z); if (dist > 150 * dt + 5) return; } // reject teleports
      ws.lp = { x: n.x, z: n.z, t: now }; bcast(rm, { t: 'pos', id: ws.id, x: n.x, z: n.z, h: +d.h || 0 }, ws); }
    // horn + taunt relay (rate limited, positional when the client has reported a position)
    if (d.t === 'horn' && rm.state === 'race') {
      const now = Date.now();
      if (ws.hornT && now - ws.hornT < 220) return;                 // max ~4 horns/s per client
      ws.hornT = now;
      const type = ['standard', 'sport', 'air', 'melody'].indexOf(String(d.type)) >= 0 ? String(d.type) : 'standard';
      bcast(rm, { t: 'horn', id: ws.id, type: type, x: ws.lp ? ws.lp.x : null, z: ws.lp ? ws.lp.z : null }, ws);
      return;
    }
    if (d.t === 'taunt' && rm.state === 'race') {
      const now = Date.now();
      if (ws.tauntT && now - ws.tauntT < 3000) return;               // one taunt every 3 s
      ws.tauntT = now;
      return bcast(rm, { t: 'taunt', id: ws.id, text: String(d.text || '').slice(0, 60) }, ws);
    }
    if (d.t === 'fin' && rm.state === 'race' && ws.fin == null) {
      ws.fin = (Date.now() - rm.t0) / 1000; if (ws.fin < 15) { ws.fin = null; return; } // too fast to be real
      rm.order.push({ name: ws.name, time: ws.fin }); const res = { t: 'results', list: rm.order };
      rm.players.forEach(p => send(p, res));
      if (rm.order.length >= rm.players.size) setTimeout(() => { rm.state = 'lobby'; rm.players.forEach(p => p.ready = false); }, 10000); }
  });
  ws.on('close', () => { const rm = ws.rm; if (!rm) return; rm.players.delete(ws); bcast(rm, { t: 'room', players: list(rm) }); });
});
srv.listen(PORT, () => console.log('VELOCITY X server on :' + PORT));
