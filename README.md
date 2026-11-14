# VELOCITY X — DRIVE BEYOND LIMITS. (v0.7)

Arcade racing with keyboard, controller, on-screen wheel, touch buttons and gyro steering — one shared
input layer, the same engine in the browser and in the Windows app.

v0.7 adds full mobile responsiveness, a frame-time budget that is actually measured, an RPM-driven engine
with a real audio graph, and a free-world SELF / AUTO drive mode. `TEST_REPORT.md` has the numbers.

## Folder
- `web/`      the game (index.html, css/, js/, models/, vendor/, PWA manifest + service worker)
- `packages/game-core/`  TypeScript rules shared by every device (input, setup, ranking, rewards, save)
- `desktop/`  Electron wrapper (contextIsolation on, nodeIntegration off, sandbox, preload)
- `server/`   Node + ws relay (online BETA, time-trial leaderboard, horn/taunt relay)
- `tools/`    static server, headless game simulation, vendor build, global-name checker
- `tests/`    Playwright browser acceptance tests

## Run in browser
`npm run serve` then open http://127.0.0.1:8099/ (the server redirects to `web/index.html`).
Opening `web/index.html` from disk (`file://`) does **not** work: browsers block the car-model fetches,
so the start button stays at "LOADING 3D CARS". Always use the local server (or the desktop app).

## Run as desktop app
`npm run desktop`   (installs Electron + three.js, bundles everything for offline play)

## Build the Windows installer (.exe) — run on Windows
`npm run installer`   -> output in `desktop/dist/`

## Tests
```
npm run verify:fast   # globals + typecheck + core build + 37 unit tests + 16 headless game scenarios
npm run verify        # the above + the real-browser acceptance suites
npx playwright test tests/responsive.spec.ts   # 12 screen sizes, layout audit + screenshots
npx playwright test tests/quality.spec.ts      # every vehicle × mode, Auto drive, frame time, audio
```
`npx playwright install chromium` is needed once. `TEST_REPORT.txt` lists every test and, honestly,
what is still unverified. Unit tests are in `packages/game-core/test/` (no extra packages: node's own
runner with `--experimental-strip-types`). Browser tests need a real browser because they drive the real
scripts, real physics and the real Gamepad API path.

## What is in this build (v0.7: responsive, performance, audio, auto drive)
**Mobile layout** — every screen is laid out from `env(safe-area-inset-*)` and `dvh`, with `clamp()` type
and `--tb` (touch-button scale) driven by the viewport, not by fixed pixels. Breakpoints at
320/360/390/430/600/768/1024/1280+. The canvas is sized by DPR capped at 2 and resized on `resize` and
`orientationchange` (and by `visualViewport`), the HUD has a portrait column and a compact short-landscape
shape, the minimap is absolutely positioned in that column, and the steering wheel is clamped to the
screen so it can never cover the pedals. 48 px minimum taps, multi-touch buttons sized through CSS (not a
`transform`, which used to leave a ghost copy on screen), no horizontal scroll, no scroll-jail.
**Performance** — fixed 1/60 timestep with render interpolation, `dt` capped and the catch-up loop
bounded (no spiral of death). Nothing is allocated in the physics or render path any more: shared input
records instead of a fresh object per car per step, `for` loops instead of `forEach` closures, a flat
`Float32Array` replay buffer with a hard cap, direct typed-array rain updates, typed-array sorting for the
1% low, and the wheel/HUD DOM only touched when a value actually changed. Resize is a no-op when the size
is unchanged (the mobile URL bar fires it constantly). Dynamic resolution governor, Auto/Low/Medium/High/
Ultra quality, WebGL context-loss restore, and a per-frame exception guard that fails over to the menu
instead of freezing on the last picture. Optional FPS/frame-time/draw-call overlay in Settings (debug).
**Engine audio** — a real Web Audio graph: three oscillators plus noise per car profile (V8, supercar,
turbo JDM, EV whine), pitch from the actual rpm, rev-limiter stutter, shift drops, lift burble, wind and
road-noise layers that follow speed and surface, tyre screech from slip angle, brake squeal, turbo whistle
and blow-off, nitro whoosh, distance/doppler/stereo panning for rivals, interior low-pass. Parameters are
smoothed with `setTargetAtTime`; no nodes are created per frame. Master/engine/music/effects/environment
buses are respected, and the graph resumes after a tab switch.
**SELF / AUTO** — a free-world drive mode with a real AI at the wheel: the same physics car, driven
through the same `input` record (lane keeping, corner braking, traffic avoidance, safe gaps, nitro on
straights, auto-recovery). Cinematic camera cycling, reduced documented XP rate, and an instant, blended
take-over from any real input (or the TAKE CONTROL button, or `T`). The pause menu can switch modes; the
choice is saved.
**Controller** — Gamepad API, hot-plug with a toast, first active pad wins. Xbox / PlayStation / generic
pads: standard mapping plus a fallback table for pads that report no mapping (or fewer than 12 buttons).
RT accelerate and LT brake are analog, left stick steers (deadzone + linear/soft/aggressive curve +
smoothing), A/Cross nitro, X/Square handbrake, Y/Triangle camera, B/Circle horn, LB look back, RB reset
car, Back map, R3 rewind, Start pause/resume. Unplugging mid-race pauses the race instead of driving on
with dead input. Dual-rumble haptics on kerbs, off-road, slides, nitro and collisions with an intensity
slider. Full menu navigation with a focus ring (D-pad/stick move, A select, B back, auto-repeat).
Remapping for controller *and* keyboard is saved in the save file, refuses duplicates and can be reset.

**Horn** — H, controller B/Circle, the HORN touch button or the on-screen button. Four synthesised voices
(standard, sport, air horn, melody) chosen per car in the Garage and saved. Hold = continuous, tap = short
beep, 3D positional audio through the shared SFX bus. Traffic pulls aside and eases back (AI racers react
too), the honk is recorded in replays, counted in stats/achievements, and forwarded to other players in
online races (rate-limited server-side).

**Steering type** — Keyboard / Gamepad / Touch buttons / On-screen wheel / Gyro / Auto-detect, applied
instantly. The wheel is draggable to ±450° = ±1.0 lock with smooth auto-centre (or no auto-centre),
multi-touch safe, with size, opacity, side, skin and centre-tick haptics. Gyro uses the iOS permission
request, CALIBRATE, sensitivity/deadzone/invert/low-pass, works in both landscapes, shows a live preview
and falls back to the wheel automatically. The touch HUD layout can be dragged, resized, faded and reset.
Mobile assists (steering, TC, ABS, auto-brake, one-pedal, stability) and mobile quality: fullscreen +
landscape lock, Wake Lock, installable PWA with an offline cache, battery saver, dynamic resolution,
`touch-action:none`, `navigator.vibrate`.

**Earlier builds still included:** splash, 12 cars, 6 locations, 6 modes, garage/customisation, career,
settings, dynamic weather during a race, generated music + SFX with separate volume buses, replay
cameras, time-trial ghost, upgrades that change physics, tunnels/bridge/pit, online BETA with a persistent
leaderboard, and `packages/game-core` rules with automated tests.

## Implementation notes
- Every script is a classic script sharing one global scope, so top-level names must be unique:
  `npm run check` guards this (`11 scripts, 409 globals, 0 problems`).
- All input rules live in `packages/game-core/src/input.ts` and are compiled to `web/vendor/game-core.js`
  (`npm run build`). Every device feeds the same `InputState`, so physics, AI, replay and online behave
  identically whichever device is used.
- `web/js/controls.js` is DOM + gestures + persistence only; it exposes `window.VXDBG` so the browser
  tests can read live game state without the game leaking internals.
- When you ship a change, bump `CACHE` in `web/sw.js` (and the `?v=` tags in `index.html`) so players do
  not keep the old files from the offline cache.

## Honest limitations
- **No physical device testing.** Controller paths are tested through the real Gamepad API with a stubbed
  pad; gyro through synthetic orientation events; touch through emulated touch at phone size. Real phones,
  real pads (especially DualSense triggers and cheap generic pads) and real rumble still need a human.
- Horn sounds are synthesised at runtime (original, no licensed audio). There are no sampled engine or
  music recordings.
- Online is a relay with validation, not physics-authoritative; no matchmaking, friends or accounts.
- Tunnels/bridge are visual structures on a flat road (no elevation change). Pit lane is decorative
  (beyond the walls).
- Not implemented yet, and never shown as working: living track, touge duels, driver-DNA coach, telemetry,
  nitro-skill scoring, crews/economy expansion, photo mode, livery/tuning/track editors, weather/surface
  extension, real multiplayer matchmaking/spectate/anti-cheat, wheel force feedback, WebXR,
  multi-monitor, localisation. Anything in the UI that is not finished is labelled "coming soon".
