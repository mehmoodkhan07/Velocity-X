// Tiny static file server for the browser tests and for playing locally over http (a service worker and
// the Pointer Lock / Wake Lock APIs only exist on http(s), not on file://).
// usage: node tools/serve.js [port]     then open http://127.0.0.1:8099/web/index.html
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const PORT = +(process.argv[2] || process.env.PORT || 8099);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg'
};

http.createServer((req, res) => {
  const url = decodeURIComponent(String(req.url || '/').split('?')[0]);
  // the game lives in /web — send bare visits there instead of a bare 404
  if (url === '/' || url === '') { res.writeHead(302, { location: '/web/index.html' }); return res.end(); }
  let file = path.normalize(path.join(ROOT, url));
  if (file.indexOf(ROOT) !== 0) { res.writeHead(403); return res.end('forbidden'); }
  try { if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html'); } catch (e) { }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found: ' + url); }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*'
    });
    res.end(buf);
  });
}).listen(PORT, '127.0.0.1', () => console.log('VELOCITY X static server on http://127.0.0.1:' + PORT + '/web/index.html'));
