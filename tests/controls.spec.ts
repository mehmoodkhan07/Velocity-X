import { test, expect, type Page } from '@playwright/test';

// Real-browser acceptance tests for the controls work (see TEST_REPORT.txt).
// Everything is asserted against the live game through the small VXDBG bridge in web/js/controls.js —
// no mocked game state, the real input layer and the real physics are used. The browser-side globals
// these specs touch are declared in tests/game-globals.d.ts, so `npm run typecheck` stays clean.

/** Load the game and start a real race, then wait until the countdown hands over the car. */
async function startRace(page: Page, cfg: any = {}) {
  await page.evaluate(c => VXDBG.start(c), Object.assign({ laps: 3 }, cfg));
  await page.waitForFunction(() => VXDBG.state === 'race', null, { timeout: 40_000 });
}

async function load(page: Page) {
  await page.goto('/web/index.html');
  await page.waitForFunction(() => !!window.VXDBG, null, { timeout: 30_000 });
}

const inp = (page: Page) => page.evaluate(() => VXDBG.player && VXDBG.player.input);

/** Read the button prompts the HUD is currently showing, as one string ("RT|LS|A|B|"). */
const prompts = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll('#vxprompt .vxp b')].map(b => b.textContent || '').join('|'));

/**
 * Records every text change of an element from now on. The game reuses one status line and several
 * messages can arrive within a couple of frames, so a single read is racy — this keeps them all.
 */
async function record(page: Page, id: string) {
  await page.evaluate(elId => {
    let el = document.getElementById(elId);
    if (!el) { document.body.insertAdjacentHTML('beforeend', '<div id="' + elId + '"></div>'); el = document.getElementById(elId); }
    const w = window as any;
    w.__rec = w.__rec || {};
    w.__rec[elId] = [''];
    if (!el || !w.MutationObserver) return;
    new MutationObserver(() => w.__rec[elId].push(el ? el.textContent || '' : ''))
      .observe(el, { childList: true, characterData: true, subtree: true });
  }, id);
}

/** Waits until one of the recorded lines of `id` matches (case-insensitive). */
const waitText = (page: Page, id: string, re: RegExp) => page.waitForFunction(
  arg => ((window as any).__rec[arg.id] || []).some((t: string) => new RegExp(arg.src, 'i').test(t)),
  { id, src: re.source }, { timeout: 20_000 });

type PadOpts = { id: string; mapping: string; buttons: number };

/**
 * Installs a stubbed Gamepad the way a browser reports one, plus the small __btn/__axis/__unplug
 * helpers the specs drive it with. The pad is described by data, so the Xbox, DualSense and cheap
 * generic cases share one implementation instead of four copies of the same object literal.
 */
async function stubPad(page: Page, o: PadOpts) {
  await page.addInitScript(opts => {
    const pad: any = {
      id: opts.id, index: 0, mapping: opts.mapping, connected: true,
      axes: [0, 0, 0, 0], timestamp: 0,
      buttons: Array.from({ length: opts.buttons }, () => ({ pressed: false, value: 0, touched: false })),
      vibrationActuator: {
        effects: [] as any[],
        playEffect(type: string, params: any) { this.effects.push({ type, params }); return Promise.resolve('complete'); }
      }
    };
    const plugs: any[] = [pad];
    window.__pad = pad;
    window.__plugs = plugs;
    window.__btn = (i: number, v: number) => { pad.buttons[i] = { pressed: v > 0, value: v, touched: v > 0 }; };
    window.__axis = (i: number, v: number) => { pad.axes[i] = v; };
    window.__unplug = () => { pad.connected = false; plugs.length = 0; };
    navigator.getGamepads = () => plugs;
  }, o);
}

const XBOX: PadOpts = { id: 'Xbox Wireless Controller (STANDARD GAMEPAD)', mapping: 'standard', buttons: 17 };

test('the page boots with no script errors', async ({ page }) => {
  const errs: string[] = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await load(page);
  await page.waitForTimeout(2_500);
  expect(errs, 'browser errors:\n' + errs.join('\n')).toEqual([]);
});

test.describe('touch device (phone in landscape)', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });

  test('the on-screen wheel appears, dragging it steers, and a phone cannot switch it off', async ({ page }) => {
    // the player answers "Allow" to the motion prompt (a denied prompt falls back to the wheel by design)
    await page.context().grantPermissions(['accelerometer', 'gyroscope', 'magnetometer']);
    await load(page);
    await startRace(page);

    expect(await page.evaluate(() => VXDBG.input().source)).toBe('wheel');
    const wheel = page.locator('#vxwheel');
    await expect(wheel).toBeVisible();

    // drag the rim a quarter turn (top of the rim -> left of the rim)
    const b = (await wheel.boundingBox())!;
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2, r = b.width * 0.35;
    await page.mouse.move(cx, cy - r);
    await page.mouse.down();
    await page.mouse.move(cx - r * 0.7, cy - r * 0.7, { steps: 8 });
    await page.mouse.move(cx - r, cy, { steps: 8 });

    const deg = (await page.evaluate(() => VXDBG.wheel())).deg;
    expect(Math.abs(deg), 'the wheel must have rotated with the finger: ' + deg + '°').toBeGreaterThan(30);
    await expect.poll(async () => (await inp(page)).s).toBeLessThan(-0.05);

    await page.mouse.up();
    await expect.poll(async () => Math.abs((await page.evaluate(() => VXDBG.wheel())).deg), { timeout: 5_000 })
      .toBeLessThan(30);

    // a phone has exactly two steering choices (wheel or tilt): the old "wheel off" setting cannot leave it
    // with no steering at all, and the retired ◀ ▶ buttons never come back
    await page.evaluate(() => { VXDBG.save.set.wheelOn = 0; persist(); });
    await page.waitForTimeout(300);
    await expect(wheel).toBeVisible();
    expect(await page.locator('.vxbtn[data-act=left],.vxbtn[data-act=right]').count()).toBe(0);

    // TILT from the pause menu chooser, then back to WHEEL
    await page.evaluate(() => pauseGame());
    const pick = page.locator('#pause .vxsteer');
    await expect(pick).toBeVisible();
    // force: the software renderer of the CI browser draws ~15 fps under the blurred pause backdrop, which can
    // keep Playwright's "stable" wait spinning; the button is already asserted visible above
    await pick.locator('button[data-st=gyro]').click({ force: true });
    await expect.poll(() => page.evaluate(() => VXDBG.input().source)).toBe('gyro');
    await pick.locator('button[data-st=wheel]').click({ force: true });
    await expect.poll(() => page.evaluate(() => VXDBG.input().source)).toBe('wheel');
    // keyboard / gamepad / auto from an older save still resolve to one of the two
    await page.evaluate(() => { VXDBG.save.set.steerType = 'keyboard'; });
    await expect.poll(() => page.evaluate(() => VXDBG.input().source)).toBe('wheel');
  });

  test('exactly four touch buttons: GAS, BRAKE, NOS, HORN; the legacy pad stays hidden', async ({ page }) => {
    await load(page);
    await startRace(page);
    await page.waitForTimeout(300);
    const acts = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#vxtch .vxbtn')]
      .filter(e => getComputedStyle(e).display !== 'none').map(e => e.dataset.act).sort());
    expect(acts).toEqual(['brake', 'gas', 'horn', 'nitro']);
    expect(await page.locator('#tch').isVisible(), 'the retired six-button pad').toBe(false);
  });

  test('the touch buttons drive: gas, brake, nitro, horn', async ({ page }) => {
    await load(page);
    await startRace(page);
    // The pad is rebuilt whenever the layout or the steering source changes, so a button can be
    // missing its box for a frame or two. Retry instead of hanging on a single boundingBox().
    const box = async (act: string) => {
      const el = page.locator(`.vxbtn[data-act=${act}]`);
      for (let i = 0; i < 20; i++) {
        const b = await el.boundingBox({ timeout: 1_500 }).catch(() => null);
        if (b && b.width > 1) return b;
        await page.waitForTimeout(150);
      }
      throw new Error('touch button never got a box: ' + act);
    };
    const press = async (act: string, ms: number) => {
      const bb = await box(act);
      await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(ms);
      const i = await inp(page);
      await page.mouse.up();
      return i;
    };
    const gas = await press('gas', 250);
    expect(gas.t, 'GAS button gives throttle').toBeGreaterThan(0.8);
    const brk = await press('brake', 250);
    expect(brk.b, 'BRAKE button brakes').toBeGreaterThan(0.8);
    const nos = await press('nitro', 150);
    expect(nos.n, 'NOS button fires nitro').toBe(1);
    const honks0 = await page.evaluate(() => VXDBG.save.honks || 0);
    await press('horn', 150);
    await expect.poll(() => page.evaluate(() => VXDBG.save.honks || 0)).toBeGreaterThan(honks0);
  });
});

test.describe('desktop with a stubbed Xbox controller', () => {
  test.beforeEach(async ({ page }) => { await stubPad(page, XBOX); });

  test('controller drives the car: analog triggers, stick, nitro, horn, pause, camera', async ({ page }) => {
    await load(page);
    await startRace(page);

    const info = await page.evaluate(() => VXDBG.input());
    expect(info.connected, 'the pad is detected').toBe(true);
    expect(info.source, 'auto-detect picks the pad').toBe('gamepad');

    await page.evaluate(() => __axis(0, -0.85));
    await expect.poll(async () => (await inp(page)).s).toBeGreaterThan(0.2);

    await page.evaluate(() => { __axis(0, 0); __btn(7, 1); });
    await expect.poll(async () => (await inp(page)).t).toBeGreaterThan(0.9);

    await page.evaluate(() => { __btn(7, 0); __btn(6, 1); });
    await expect.poll(async () => (await inp(page)).b).toBeGreaterThan(0.9);
    await page.evaluate(() => { __btn(6, 0); __btn(7, 1); });

    await page.evaluate(() => __btn(2, 1));
    await expect.poll(async () => (await inp(page)).hb).toBe(1);
    await page.evaluate(() => __btn(2, 0));

    await page.evaluate(() => __btn(0, 1));
    await expect.poll(async () => (await inp(page)).n).toBe(1);
    await page.evaluate(() => __btn(0, 0));

    const cam0 = await page.evaluate(() => VXDBG.cam);
    await page.evaluate(() => __btn(3, 1));
    await expect.poll(() => page.evaluate(() => VXDBG.cam)).not.toBe(cam0);
    await page.evaluate(() => __btn(3, 0));

    const honks0 = await page.evaluate(() => VXDBG.save.honks || 0);
    await page.evaluate(() => __btn(1, 1));
    await expect.poll(() => page.evaluate(() => VXDBG.save.honks || 0)).toBeGreaterThan(honks0);
    await page.evaluate(() => __btn(1, 0));

    // Start pauses, and Start again resumes (through the 3-2-1 countdown)
    await page.evaluate(() => __btn(9, 1));
    await page.waitForFunction(() => VXDBG.state === 'pause', null, { timeout: 10_000 });
    await page.evaluate(() => __btn(9, 0));
    await page.waitForTimeout(250);                       // let the tick see the release
    await page.evaluate(() => __btn(9, 1));
    await page.waitForFunction(() => VXDBG.state === 'resume' || VXDBG.state === 'race', null, { timeout: 10_000 });
    await page.evaluate(() => __btn(9, 0));
    await page.waitForFunction(() => VXDBG.state === 'race', null, { timeout: 15_000 });

    // the prompts follow the controller, not the keyboard
    await expect.poll(() => prompts(page), { timeout: 5_000 }).toMatch(/RT|LS/);
  });

  test('Start opens the pause menu, the D-pad moves the focus ring and A selects', async ({ page }) => {
    await load(page);
    await startRace(page);

    await page.evaluate(() => __btn(9, 1));                        // Start / Options
    await page.waitForFunction(() => VXDBG.state === 'pause', null, { timeout: 15_000 });
    await page.evaluate(() => __btn(9, 0));
    await page.waitForTimeout(250);

    // hold the D-pad like a player would: the ring appears and walks through the items (auto-repeat)
    const ringId = () => page.evaluate(() => (document.querySelector('#pause .navfocus') || { id: '' }).id);
    await page.evaluate(() => __btn(13, 1));
    await page.waitForFunction(() => !!document.querySelector('#pause .navfocus'), null, { timeout: 15_000 });
    const first = await ringId();
    expect(first, 'the ring lands on a real pause-menu control').toMatch(/^(resume|prestart|pset|quit)$/);
    await page.waitForFunction(prev => (document.querySelector('#pause .navfocus') || { id: '' }).id !== prev, first, { timeout: 15_000 });
    await page.evaluate(() => __btn(13, 0));
    const target = await ringId();
    expect(target, 'further D-pad steps move the ring').not.toBe(first);

    // A / Cross activates whatever the ring is on (the exact step + wrap logic is asserted in tools/sim.js)
    await page.evaluate(() => __btn(0, 1));
    if (target === 'pset') await expect(page.locator('#xs')).toBeVisible();
    else await page.waitForFunction(() => VXDBG.state !== 'pause', null, { timeout: 25_000 });
    await page.evaluate(() => __btn(0, 0));
  });
});

test.describe('remapping in the settings screen', () => {
  test.beforeEach(async ({ page }) => { await stubPad(page, XBOX); });

  test('a pad button rebinds, a taken button is refused, and reset restores the defaults', async ({ page }) => {
    await load(page);
    await page.evaluate(() => VXDBG.settings());
    await record(page, 'vxtoast');
    const padGrid = page.locator('#xs .vxremap').nth(1);          // 0 = keyboard, 1 = controller

    await padGrid.getByRole('button', { name: /Nitro/ }).click();
    await page.evaluate(() => __btn(10, 1));
    await page.waitForFunction(() => VXDBG.save.set.pad.nitro === 10, null, { timeout: 10_000 });
    expect(await page.evaluate(() => +VXDBG.save.set.padCustom), 'the custom layout flag is set').toBe(1);
    await page.evaluate(() => __btn(10, 0));

    // button 10 now belongs to nitro: giving it to horn must be refused
    await padGrid.getByRole('button', { name: /Horn/ }).click();
    await page.evaluate(() => __btn(10, 1));
    await waitText(page, 'vxtoast', /ALREADY NITRO/);
    expect(await page.evaluate(() => VXDBG.save.set.pad.horn)).toBe(1);
    await page.evaluate(() => __btn(10, 0));

    await page.locator('#xs', { hasText: 'RESET CONTROLLER LAYOUT' }).getByText('RESET CONTROLLER LAYOUT').click();
    expect(await page.evaluate(() => VXDBG.save.set.pad.nitro), 'defaults restored').toBe(0);
    expect(await page.evaluate(() => +VXDBG.save.set.padCustom)).toBe(0);
  });

  test('a keyboard key already in use is refused', async ({ page }) => {
    await load(page);
    await page.evaluate(() => VXDBG.settings());
    await record(page, 'vxtoast');
    await page.evaluate(() => vxRemapKey('brk'));
    await page.keyboard.press('KeyW');
    await waitText(page, 'vxtoast', /ALREADY USED BY ACC/);
    expect(await page.evaluate(() => VXDBG.save.set.keys.brk)).toBe('KeyS');
  });
});

test.describe('generic pad with no standard mapping', () => {
  test.beforeEach(async ({ page }) => { await stubPad(page, { id: 'USB Joystick', mapping: '', buttons: 10 }); });

  test('the fallback layout drives the car, rumbles and pauses on unplug', async ({ page }) => {
    await load(page);
    await startRace(page);
    await record(page, 'vxtoast');
    expect((await page.evaluate(() => VXDBG.input())).source, 'auto-detect picks the pad').toBe('gamepad');

    // no standard mapping -> PAD_FALLBACK: 0 accelerate, 1 brake, 2 nitro, 4 horn
    await page.evaluate(() => __btn(0, 1));
    await expect.poll(async () => (await inp(page)).t).toBeGreaterThan(0.9);
    await page.evaluate(() => { __btn(0, 0); __btn(1, 1); });
    await expect.poll(async () => (await inp(page)).b).toBeGreaterThan(0.9);
    await page.evaluate(() => __btn(1, 0));

    const honks0 = await page.evaluate(() => VXDBG.save.honks || 0);
    await page.evaluate(() => __btn(4, 1));
    await expect.poll(() => page.evaluate(() => VXDBG.save.honks || 0)).toBeGreaterThan(honks0);
    await page.evaluate(() => __btn(4, 0));

    // nitro makes the pad rumble through its vibration actuator
    await page.evaluate(() => { __btn(0, 1); __btn(2, 1); });
    await expect.poll(() => page.evaluate(() => __pad.vibrationActuator.effects.length), { timeout: 10_000 })
      .toBeGreaterThan(0);
    await page.evaluate(() => { __btn(0, 0); __btn(2, 0); });

    // unplugging mid-race must pause instead of driving on with dead input
    await page.evaluate(() => __unplug());
    await page.waitForFunction(() => VXDBG.state === 'pause', null, { timeout: 15_000 });
    await waitText(page, 'vxtoast', /DISCONNECTED/);
  });
});

test.describe('PlayStation pad', () => {
  test.beforeEach(async ({ page }) => {
    await stubPad(page, { id: 'DualSense Wireless Controller', mapping: 'standard', buttons: 17 });
  });

  test('a DualSense is detected as PlayStation and the prompts use its icons', async ({ page }) => {
    await load(page);
    await startRace(page);
    expect(await page.evaluate(() => VXDBG.input().pad)).toContain('DualSense');

    await page.evaluate(() => __btn(7, 1));          // R2 = accelerate, so the prompts switch to the pad
    await expect.poll(() => prompts(page), { timeout: 10_000 }).toMatch(/R2\|L2/);
    await page.evaluate(() => __btn(7, 0));
  });
});

test('H honks the horn', async ({ page }) => {
  await load(page);
  await startRace(page);
  await record(page, 'msg');
  const honks0 = await page.evaluate(() => VXDBG.save.honks || 0);
  const events0 = await page.evaluate(() => VXHORN.events().length);
  await page.keyboard.down('KeyH');
  // the horn message is written by the game tick, one frame after the key press — wait for it
  await waitText(page, 'msg', /HORN/);
  const live = await page.evaluate(() => ({ honks: VXDBG.save.honks || 0, ev: VXHORN.events().length }));
  await page.keyboard.up('KeyH');
  expect(live.honks, 'the honk counter goes up').toBeGreaterThan(honks0);
  expect(live.ev, 'the honk is recorded for the replay').toBeGreaterThan(events0);
});

test('gyro: a mocked DeviceOrientationEvent steers the car', async ({ page }) => {
  await load(page);
  await startRace(page);
  await page.evaluate(() => {
    VXDBG.save.set.steerType = 'gyro';
    VXDBG.attachGyro();                            // the listener a granted permission installs
    VXCTRL.calibrate();
  });
  await expect.poll(() => page.evaluate(() => VXDBG.input().source)).toBe('gyro');

  await page.keyboard.down('KeyW');                 // roll, so the heading can change
  await page.evaluate(() => {
    const fire = (gamma: number) => window.dispatchEvent(
      new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 0, gamma, absolute: true } as any));
    fire(35);
  });
  await expect.poll(async () => (await inp(page)).s).toBeGreaterThan(0.3);

  await page.evaluate(() => window.dispatchEvent(
    new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 0, gamma: -35, absolute: true } as any)));
  await expect.poll(async () => (await inp(page)).s).toBeLessThan(-0.3);
  await page.keyboard.up('KeyW');
});

test('settings survive a reload', async ({ page }) => {
  await load(page);
  await page.evaluate(() => {
    VXDBG.save.set.steerType = 'gyro';
    VXDBG.save.set.padDz = 0.21;
    VXDBG.save.set.wheelSize = 260;
    VXDBG.save.set.assists.tc = 1;
    persist();
  });
  await page.reload();
  await page.waitForFunction(() => !!window.VXDBG);
  const s = await page.evaluate(() => VXDBG.save.set);
  expect(s.steerType).toBe('gyro');
  expect(s.padDz).toBeCloseTo(0.21, 3);
  expect(s.wheelSize).toBe(260);
  expect(s.assists.tc).toBe(1);
});
