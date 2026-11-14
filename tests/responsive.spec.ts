import { test, expect, type Page } from '@playwright/test';

// Responsive acceptance test (upgrade 1).
//
// Every screen the player can reach is rendered at each of the 12 required sizes and measured, not
// eyeballed: horizontal document overflow, any element sticking out of the viewport, HUD blocks
// colliding with each other, and the canvas backing store (devicePixelRatio cap + aspect ratio).
// A PNG of every screen at every size is written to test-results/responsive/ for the report.
// Screenshots are captured at CSS resolution (scale: 'css') on a 3x device, so the files stay a
// sensible size while the browser still reports devicePixelRatio 3 — which is what the DPR cap
// assertion needs to see.

const SIZES = [
  { w: 320, h: 568, name: '320x568' },
  { w: 360, h: 640, name: '360x640' },
  { w: 375, h: 667, name: '375x667' },
  { w: 390, h: 844, name: '390x844' },
  { w: 412, h: 915, name: '412x915' },
  { w: 430, h: 932, name: '430x932' },
  { w: 600, h: 960, name: '600x960' },
  { w: 768, h: 1024, name: '768x1024' },
  { w: 844, h: 390, name: '844x390' },
  { w: 915, h: 412, name: '915x412' },
  { w: 1024, h: 768, name: '1024x768' },
  { w: 1920, h: 1080, name: '1920x1080' }
];

const SHOTS = 'test-results/responsive';

// A phone with a 3x screen: the canvas must cap its backing store at 2x, so this catches a missing cap.
test.use({ deviceScaleFactor: 3, hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

// software-rendered WebGL in CI is slow (a 4K-class screenshot of the canvas can take seconds), and every
// size re-boots the whole game, so give each case a generous budget. Each size runs independently so one
// failure never hides the other eleven.
test.setTimeout(300_000);

async function boot(page: Page) {
  await page.goto('/web/index.html');
  await page.waitForFunction(() => !!window.VXDBG, null, { timeout: 40_000 });
  // the splash ends when the models are in; the START button only enables once they are
  await page.waitForFunction(() => {
    const b = document.getElementById('start');
    return b && !(b as HTMLButtonElement).disabled;
  }, null, { timeout: 60_000 });
}

/** Everything wrong with the current layout, as human-readable lines. */
async function audit(page: Page) {
  return page.evaluate(() => {
    const tag = (el: HTMLElement) => el.id ? '#' + el.id
      : el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '');
    const out: string[] = [];
    const vw = window.innerWidth, vh = window.innerHeight, doc = document.documentElement;

    // 1. no horizontal scrolling anywhere
    if (doc.scrollWidth > vw + 1) out.push('document scrollWidth ' + doc.scrollWidth + ' > viewport ' + vw);

    // 2. no element sticks out sideways (only visible ones matter)
    const seen = new Set<string>();
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      // a scroll container is allowed to be exactly its own size; its children may overflow inside it
      const inScroller = !!el.closest('[data-vxscroll]');
      if (r.right > vw + 1 && !inScroller) out.push('overflow right: ' + tag(el) + ' right=' + Math.round(r.right));
      if (r.left < -1 && !inScroller) out.push('overflow left: ' + tag(el) + ' left=' + Math.round(r.left));
      if (r.bottom > vh + 1 && !inScroller && cs.position === 'fixed') out.push('fixed off-screen: ' + tag(el));
      seen.add(tag(el));
    }

    // 3. body text must be readable (>= 14 px effective)
    const small: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('.screen .panel label, .screen .panel p, .screen .panel .sub, #sum, #pinfo'))) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || +cs.opacity === 0) continue;
      const r = el.getBoundingClientRect();
      // not rendered right now (inside a hidden screen): computed style still reports a font size
      if (r.width < 2 || r.height < 2) continue;
      const px = parseFloat(cs.fontSize);
      if (px && px < 13.5) small.push(tag(el) + ' ' + px.toFixed(1) + 'px');
    }
    if (small.length) out.push('text under 14px: ' + small.slice(0, 4).join(', '));

    // 4. touch targets: every visible button/control at least 44x44 (48 requested; 44 is the hard floor).
    // A checkbox / radio is tapped through its <label>, so that is what gets measured.
    const tiny: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('.screen button, .screen select, .screen input, .vxbtn'))) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      let r = el.getBoundingClientRect();
      if (r.width < 1 && r.height < 1) continue;
      const box = el as HTMLInputElement;
      if (box.type === 'checkbox' || box.type === 'radio') {
        const lab = el.closest('label');
        if (lab) r = lab.getBoundingClientRect();
      }
      if (r.width < 43.5 || r.height < 43.5) tiny.push(tag(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
    if (tiny.length) out.push('touch target under 44px: ' + tiny.slice(0, 5).join(', '));

    return { errors: out, seen: [...seen].slice(0, 4), vw, vh };
  });
}

/** The HUD blocks must never sit on top of each other — including the touch pad and the steering wheel. */
async function hudOverlaps(page: Page) {
  return page.evaluate(() => {
    const one = (sel: string, id: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return null;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return null;
      return { id, l: r.left, t: r.top, r: r.right, b: r.bottom };
    };
    const boxes = ['hl', 'hb', 'mm', 'vxpan', 'vxauto', 'pb', 'help'].map(id => one('#' + id, '#' + id));
    // the thumb controls are part of the layout too: a pedal on top of the wheel is a mis-tap
    boxes.push(one('#vxwheel', '#vxwheel'));
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('#vxtch .vxbtn'))) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || +cs.opacity === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      boxes.push({ id: 'btn:' + (el.textContent || '').trim(), l: r.left, t: r.top, r: r.right, b: r.bottom });
    }
    const list = boxes.filter(Boolean) as { id: string; l: number; t: number; r: number; b: number }[];
    const hits: string[] = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l);
        const oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
        if (ox > 4 && oy > 4) hits.push(a.id + ' x ' + b.id + ' (' + Math.round(ox) + 'x' + Math.round(oy) + 'px)');
      }
    }
    return hits;
  });
}

/** Canvas backing store must match the CSS box times min(dpr, 2) — no stretch, no blur. */
async function canvasCheck(page: Page) {
  return page.evaluate(() => {
    const c = document.getElementById('gl') as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    const want = Math.min(window.devicePixelRatio || 1, 2);
    // the renderer owns canvas.width; VXSTAT.pr is what it actually applied
    const pr = (window as any).VXDBG.perf.pixelRatio || 0;
    return {
      css: [Math.round(r.width), Math.round(r.height)],
      buffer: [c.width, c.height],
      pr,
      wantMax: want,
      ratioX: r.width ? c.width / r.width : 0,
      ratioY: r.height ? c.height / r.height : 0,
      viewportRatio: window.innerWidth / Math.max(1, window.innerHeight)
    };
  });
}

for (const s of SIZES) {
  test(s.name, async ({ page }) => {
    await page.setViewportSize({ width: s.w, height: s.h });
    await boot(page);

    const problems: string[] = [];

    // ---- splash -----------------------------------------------------------------------------
    await page.screenshot({ path: `${SHOTS}/${s.name}-1-splash.png`, scale: 'css' });

    // ---- main menu --------------------------------------------------------------------------
    await page.evaluate(() => document.getElementById('start')!.click());
    await page.waitForFunction(() => !document.getElementById('menu')!.classList.contains('hidden'));
    await page.waitForTimeout(350);
    const menu = await audit(page);
    problems.push(...menu.errors.map(e => 'menu: ' + e));
    await page.screenshot({ path: `${SHOTS}/${s.name}-2-menu.png`, scale: 'css' });

    // ---- garage -----------------------------------------------------------------------------
    await page.evaluate(() => showGarage());
    await page.waitForTimeout(500);
    const gar = await audit(page);
    problems.push(...gar.errors.map(e => 'garage: ' + e));
    await page.screenshot({ path: `${SHOTS}/${s.name}-3-garage.png`, scale: 'css' });

    // ---- settings ---------------------------------------------------------------------------
    await page.evaluate(() => { document.getElementById('xs')?.classList.add('hidden'); VXDBG.settings(); });
    await page.waitForTimeout(400);
    const set = await audit(page);
    problems.push(...set.errors.map(e => 'settings: ' + e));
    await page.screenshot({ path: `${SHOTS}/${s.name}-4-settings.png`, scale: 'css' });

    // ---- race HUD ---------------------------------------------------------------------------
    await page.evaluate(() => { document.getElementById('xs')?.classList.add('hidden'); VXDBG.start({ mode: 'open', laps: 999, loc: 0 }); });
    await page.waitForFunction(() => VXDBG.state === 'race', null, { timeout: 60_000 });
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1_200);
    const hud = await audit(page);
    problems.push(...hud.errors.map(e => 'hud: ' + e));
    const overlaps = await hudOverlaps(page);
    problems.push(...overlaps.map(o => 'hud overlap: ' + o));
    const cv = await canvasCheck(page);
    if (Math.abs(cv.ratioX - cv.ratioY) > 0.02) problems.push(`canvas stretched: x${cv.ratioX.toFixed(2)} y${cv.ratioY.toFixed(2)}`);
    if (cv.ratioX > cv.wantMax + 0.02) problems.push(`canvas DPR ${cv.ratioX.toFixed(2)} exceeds the cap ${cv.wantMax}`);
    if (Math.abs(cv.ratioX - cv.pr) > 0.06) problems.push(`canvas ${cv.ratioX.toFixed(2)}x but the renderer reports ${cv.pr}`);
    await page.screenshot({ path: `${SHOTS}/${s.name}-5-hud.png`, scale: 'css' });
    await page.keyboard.up('KeyW');

    // ---- pause menu (includes the SELF/AUTO switch) -------------------------------------------
    await page.evaluate(() => pauseGame());
    await page.waitForTimeout(400);
    const pause = await audit(page);
    problems.push(...pause.errors.map(e => 'pause: ' + e));
    await page.screenshot({ path: `${SHOTS}/${s.name}-6-pause.png`, scale: 'css' });

    // ---- results ----------------------------------------------------------------------------
    await page.evaluate(() => { (window as any).finish(); });
    await page.waitForTimeout(400);
    const res = await audit(page);
    problems.push(...res.errors.map(e => 'results: ' + e));
    await page.screenshot({ path: `${SHOTS}/${s.name}-7-results.png`, scale: 'css' });

    expect(problems, s.name + ' layout problems:\n  ' + problems.join('\n  ')).toEqual([]);
  });
}
