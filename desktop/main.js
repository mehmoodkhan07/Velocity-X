const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

// The game is served from a privileged app:// origin instead of file://. A file:// page is an opaque
// origin, so Chromium refuses to fetch() the .glb car models or import() the game-core ES module.
const ROOT = path.join(__dirname, 'web');
protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
}]);

// app://game/models/sports.glb -> <app>/web/models/sports.glb, refusing anything outside web/
function resolve(url) {
  let rel;
  try { rel = decodeURIComponent(new URL(url).pathname); } catch { return null; }
  if (!rel || rel === '/') rel = '/index.html';
  const file = path.join(ROOT, path.normalize(rel).replace(/^[\\/]+/, ''));
  return file === ROOT || file.startsWith(ROOT + path.sep) ? file : null;
}

function serveGame() {
  if (typeof protocol.handle === 'function') {
    protocol.handle('app', request => {
      const file = resolve(request.url);
      return file ? net.fetch(pathToFileURL(file).toString()) : new Response('Forbidden', { status: 403 });
    });
  } else {
    protocol.registerFileProtocol('app', (request, callback) => {
      const file = resolve(request.url);
      file ? callback({ path: file }) : callback({ error: -10 });
    });
  }
}

function create() {
  const w = new BrowserWindow({ width: 1600, height: 900, backgroundColor: '#080A0F', autoHideMenuBar: true, title: 'VELOCITY X',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.js') } });
  w.loadURL('app://game/index.html');
}
app.whenReady().then(() => { serveGame(); create(); });
app.on('window-all-closed', () => app.quit());
