import { test, expect, type Page } from '@playwright/test';

// Acceptance tests for "no lagging and no stuckness": every vehicle, both drive modes, the Auto driver,
// frame-time/heap stability and the RPM-driven engine note. Everything is measured through the live game
// (VXDBG / VXAUTOAPI / VXAUDAPI) — nothing is mocked. The headless browser renders on SwiftShader (a
// software rasteriser), so the absolute FPS here is a *lower bound*; the numbers are printed for
// TEST_REPORT.md and the assertions are deliberately loose enough to be meaningful on that renderer.

const CARS = [0, 1, 2, 3];
const MODES: Array<'race' | 'open'> = ['race', 'open'];
const consoleErrors: string[] = [];

function watch(page: Page) {
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
}

async function load(page: Page) {
  watch(page);
  await page.goto('/web/index.html');
  await page.waitForFunction(() => !!window.VXDBG, null, { timeout: 40_000 });
}

async function start(page: Page, cfg: Record<string, unknown>) {
  await page.evaluate(c => VXDBG.start(c), cfg);
  await page.waitForFunction(() => VXDBG.state === 'race', null, { timeout: 90_000 });
}

/** Distance the player covered and its top speed over `ms` of wall time (teleports over 30 m are ignored). */
async function travel(page: Page, ms: number) {
  return page.evaluate(async (dur: number) => {
    let last = VXDBG.player, d = 0, vmax = 0;
    if (!last) return { d: 0, vmax: 0 };
    const t0 = performance.now();
    while (performance.now() - t0 < dur) {
      await new Promise(r => setTimeout(r, 100));
      const p = VXDBG.player;
      if (!p) break;
      const step = Math.hypot(p.x - last.x, p.z - last.z);
      if (step < 30) d += step;
      vmax = Math.max(vmax, p.spd * 3.6);
      last = p;
    }
    return { d, vmax };
  }, ms);
}

test.describe('stability', () => {
  test.setTimeout(300_000);

  for (const car of CARS) {
    test(`vehicle ${car} drives in race and open world without getting stuck`, async ({ page }) => {
      await load(page);
      for (const mode of MODES) {
        await start(page, { car, mode, num: 4, laps: 1, loc: car % 6 });
        await page.keyboard.down('w');
        const run = await travel(page, 6000);
        const perf = await page.evaluate(() => VXDBG.perf);
        await page.keyboard.up('w');
        console.log(`vehicle ${car} / ${mode}: ${run.d.toFixed(0)} m, top ${run.vmax.toFixed(0)} km/h, ${perf.fps} fps, ` +
          `${perf.ms} ms/frame, ${perf.calls} draw calls, ${perf.tris} tris, pixelRatio ${perf.pixelRatio}`);
        // straight-line throttle with no steering runs into the barrier on a curved track, so the bar is
        // "the car still accelerates and still moves", not a lap time
        expect(run.vmax, `vehicle ${car} in ${mode} never got going`).toBeGreaterThan(25);
        expect(run.d, `vehicle ${car} in ${mode} only moved ${run.d.toFixed(1)} m`).toBeGreaterThan(20);
        expect(perf.calls, 'draw calls').toBeGreaterThan(0);
        await page.evaluate(() => VXDBG.menu());
      }
    });
  }

  test('auto drive keeps the car moving and hands control back', async ({ page }) => {
    await load(page);
    await start(page, { car: 0, mode: 'open', num: 3, laps: 1 });
    await page.evaluate(() => VXDBG.autoSet(1));
    const a = await page.evaluate(() => VXAUTOAPI.stats);
    expect(a.on, 'auto mode engaged').toBeTruthy();
    await page.waitForTimeout(20_000);
    const b = await page.evaluate(() => VXAUTOAPI.stats);
    const gained = b.dist - a.dist;
    console.log(`auto: +${gained} m in 20 s, ${b.spd} km/h at the end, resets ${b.resets - a.resets}, hits ${b.hits - a.hits}`);
    expect(gained, 'auto distance').toBeGreaterThan(60);
    expect(b.resets - a.resets, 'auto recoveries').toBeLessThanOrEqual(3);
    // any real input has to take over immediately
    await page.keyboard.down('w');
    await page.waitForFunction(() => VXAUTOAPI.on === false, null, { timeout: 20_000 });
    // travel is a poor signal here (open world traffic can block the lane), so assert the thing that
    // actually matters after a take-over: the player's own throttle reaches the physics (read it while
    // the key is still held)
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => ({ input: VXDBG.player.input, spd: VXDBG.player.spd }));
    await page.keyboard.up('w');
    console.log(`take-over: throttle ${after.input.t.toFixed(2)}, speed ${(after.spd * 3.6).toFixed(0)} km/h`);
    expect(after.input.t, 'player throttle reaches the physics').toBeGreaterThan(.9);
    expect(after.spd, 'car is moving').toBeGreaterThan(1.5);
  });

  test('frame time and memory stay flat over 20 s of racing', async ({ page }) => {
    await load(page);
    await start(page, { car: 1, mode: 'race', num: 6, laps: 3 });
    await page.keyboard.down('w');
    await page.waitForTimeout(6000);
    const a = await page.evaluate(() => VXDBG.perf);
    await page.waitForTimeout(14_000);
    const b = await page.evaluate(() => VXDBG.perf);
    await page.keyboard.up('w');
    const growth = a.heap && b.heap ? (b.heap - a.heap) / 1048576 : 0;
    console.log(`perf: ${b.fps} fps, ${b.ms} ms avg, ${b.p1} ms 1% low, ${b.worst} ms worst, ${b.calls} calls, ` +
      `heap ${growth.toFixed(2)} MB growth over 14 s, governor ${b.govScale}/${b.govCeiling}, restores ${b.restores}`);
    expect(b.fps, 'fps on the software rasteriser').toBeGreaterThan(8);
    expect(b.p1).toBeGreaterThan(0);
    expect(b.calls).toBeLessThan(150);
    expect(growth).toBeLessThan(12);
  });

  test('the engine note follows the rpm and does not leak nodes', async ({ page }) => {
    await load(page);
    // no synthetic click here: the browser is launched with --autoplay-policy=no-user-gesture-required so
    // the AudioContext is allowed to run without a gesture (clicking START also requests fullscreen, which
    // stalls a headless page). The real unlock-on-gesture path is covered by tests/controls.spec.ts.
    await start(page, { car: 2, mode: 'race', num: 2, laps: 2 });
    const idle = await page.evaluate(() => VXAUDAPI.probe());
    await page.keyboard.down('w');
    await page.waitForTimeout(3000);
    const lo = await page.evaluate(() => VXAUDAPI.probe());
    await page.waitForTimeout(5000);
    const hi = await page.evaluate(() => VXAUDAPI.probe());
    await page.keyboard.up('w');
    console.log(`audio: idle rpm ${idle.rpm} f0 ${idle.f0}; 3 s rpm ${lo.rpm} f0 ${lo.f0}; 8 s rpm ${hi.rpm} f0 ${hi.f0}; ` +
      `nodes ${idle.nodes} -> ${hi.nodes}, ready ${hi.ready}, on ${hi.on}`);
    expect(hi.ready, 'audio graph built').toBe(true);
    expect(hi.f0, 'oscillator frequency follows rpm').toBeGreaterThan(idle.f0 * 1.5);
    expect(hi.nodes - idle.nodes, 'no audio node growth').toBeLessThan(12);
  });

  test('no console errors or page errors', async () => {
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
  });
});
