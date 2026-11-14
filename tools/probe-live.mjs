// Throwaway: cache-busted probe of the live deployment.
const base = 'https://carvelocity-x.vercel.app';
for (const p of ['/?cb=' + Date.now(), '/web/js/game.js', '/web/vendor/game-core.js']) {
  try {
    const r = await fetch(base + p, { headers: { 'cache-control': 'no-cache', pragma: 'no-cache' } });
    const t = await r.text();
    console.log(p.split('?')[0].padEnd(26), r.status, r.headers.get('content-type'), '|', t.replace(/\s+/g, ' ').slice(0, 90));
  } catch (e) {
    console.log(p.padEnd(26), 'ERR', e.message);
  }
}
