// Shared input rules (v0.6): deadzones, response curves, smoothing, steering-wheel angle mapping,
// tilt/gyro calibration, auto-detect, remap conflict detection, pad layouts, button prompts and assists.
// Engine independent — every device (keyboard, pad, touch wheel, gyro) feeds the same InputState,
// so physics / AI / replay / online behave identically whichever device is used.

export type SteerCurve = 'linear' | 'soft' | 'aggressive';
export type SteerSource = 'keyboard' | 'gamepad' | 'touch' | 'wheel' | 'gyro';
export type PadBrand = 'xbox' | 'playstation' | 'generic';

export interface InputState {
  steer: number;      // -1 (right) .. +1 (left), the physics convention used by the game
  throttle: number;   // 0..1
  brake: number;      // 0..1
  handbrake: number;  // 0..1 (digital in practice)
  nitro: boolean;
  horn: boolean;
  camera: boolean;
  reset: boolean;
}

export function emptyInput(): InputState {
  return { steer: 0, throttle: 0, brake: 0, handbrake: 0, nitro: false, horn: false, camera: false, reset: false };
}

export function clampInput(i: InputState): InputState {
  return {
    steer: Math.max(-1, Math.min(1, i.steer || 0)),
    throttle: Math.max(0, Math.min(1, i.throttle || 0)),
    brake: Math.max(0, Math.min(1, i.brake || 0)),
    handbrake: Math.max(0, Math.min(1, i.handbrake || 0)),
    nitro: !!i.nitro, horn: !!i.horn, camera: !!i.camera, reset: !!i.reset,
  };
}

/** Pad + keyboard are summed but never above full lock, and a pad that is actually held wins over keys. */
export function mergeInput(a: InputState, b: InputState): InputState {
  return clampInput({
    steer: Math.abs(b.steer) > 0.02 ? b.steer : a.steer,
    throttle: Math.max(a.throttle, b.throttle),
    brake: Math.max(a.brake, b.brake),
    handbrake: Math.max(a.handbrake, b.handbrake),
    nitro: a.nitro || b.nitro, horn: a.horn || b.horn, camera: a.camera || b.camera, reset: a.reset || b.reset,
  });
}

// ---------------------------------------------------------------- deadzone + curves
export const DEFAULT_DEADZONE = 0.12;
export const TRIGGER_DEADZONE = 0.06;

/** Rescales past the deadzone so that the first live millimetre of travel is still worth something. */
export function applyDeadzone(v: number, dz = DEFAULT_DEADZONE): number {
  const a = Math.abs(v || 0), d = Math.max(0, Math.min(0.9, dz || 0));
  if (a <= d) return 0;
  return Math.sign(v) * Math.min(1, (a - d) / (1 - d));
}

/** soft = finer around centre (smooth), aggressive = bites immediately, linear = 1:1. Always ±1 at the ends. */
export function steerCurve(v: number, curve: SteerCurve = 'linear'): number {
  const x = Math.max(-1, Math.min(1, v || 0)), s = Math.sign(x), a = Math.abs(x);
  const out = curve === 'soft' ? Math.pow(a, 1.7) : curve === 'aggressive' ? Math.pow(a, 0.62) : a;
  return s * out;
}

/** Frame-rate independent smoothing toward the target. rate 14 ≈ full lock in ~140 ms, back in ~90 ms. */
export function steerSmoothing(target: number, current: number, dt: number, rate = 14): number {
  const k = 1 - Math.exp(-Math.max(0, rate) * Math.max(0, Math.min(0.2, dt)));
  const v = current + (target - current) * k;
  return Math.abs(v) < 0.004 ? 0 : Math.max(-1, Math.min(1, v));
}

export function triggerValue(v: number, dz = TRIGGER_DEADZONE): number {
  return Math.max(0, Math.min(1, applyDeadzone(v, dz)));
}

// ---------------------------------------------------------------- on-screen steering wheel
export const WHEEL_MAX_DEG = 450;

/** ±maxDeg mapped to ±1.0 steer. A real wheel is linear; the curve is exposed for taste. */
export function wheelAngleToSteer(deg: number, maxDeg = WHEEL_MAX_DEG, curve: SteerCurve = 'linear'): number {
  const d = Math.max(-1, Math.min(1, (deg || 0) / (maxDeg || WHEEL_MAX_DEG)));
  return steerCurve(d, curve);
}

/** Auto-centre angle toward 0 without ever stepping past it. */
export function wheelAutoCenter(deg: number, dt: number, rate = 7): number {
  const k = 1 - Math.exp(-Math.max(0, rate) * Math.max(0, Math.min(0.2, dt)));
  const v = deg - deg * k;
  return Math.abs(v) < 0.5 ? 0 : v;
}

/** True once the wheel passes straight-ahead, so the UI can fire a single haptic tick. */
export function wheelCenterCrossed(prevDeg: number, deg: number): boolean {
  return (prevDeg > 0 && deg <= 0) || (prevDeg < 0 && deg >= 0);
}

// ---------------------------------------------------------------- tilt / gyro
export type Orientation = 'portrait' | 'landscape-left' | 'landscape-right';

export function landscapeFromAngle(angle: number): Orientation {
  const a = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  return a === 90 ? 'landscape-left' : a === 270 ? 'landscape-right' : 'portrait';
}

/**
 * In landscape the device is rolled 90°, so the axis the player actually tilts around is beta,
 * not gamma — and its sign flips between the two landscapes. Portrait uses gamma as-is.
 */
export function tiltAxis(beta: number, gamma: number, o: Orientation): number {
  if (o === 'landscape-left') return beta || 0;
  if (o === 'landscape-right') return -(beta || 0);
  return gamma || 0;
}

/** The angle captured when the player presses CALIBRATE becomes neutral. */
export function tiltNeutral(beta: number, gamma: number, o: Orientation): number {
  return tiltAxis(beta, gamma, o);
}

export interface TiltOpts { sensitivity?: number; deadzone?: number; invert?: boolean; smoothing?: number; fullLockDeg?: number }

/**
 * axis/neutral come from tiltAxis(); `deadzone` and `fullLockDeg` are degrees of phone rotation.
 * Smoothing is a low-pass factor 0..0.95 applied to the previous output.
 */
export function tiltToSteer(axis: number, neutral: number, prev: number, opts: TiltOpts = {}): number {
  const sens = opts.sensitivity == null ? 1 : opts.sensitivity;
  const dz = opts.deadzone == null ? 3 : opts.deadzone;
  const full = opts.fullLockDeg == null ? 45 : opts.fullLockDeg;
  const smooth = Math.max(0, Math.min(0.95, opts.smoothing == null ? 0.35 : opts.smoothing));
  const delta = (axis - neutral) * sens;
  let target = 0;
  if (Math.abs(delta) > dz) {
    const t = (Math.abs(delta) - dz) / Math.max(1, full - dz);
    target = Math.sign(delta) * Math.min(1, t);
  }
  if (opts.invert) target = -target;
  return prev + (target - prev) * (1 - smooth);
}

// ---------------------------------------------------------------- auto-detect
export interface Detectable { touch: boolean; gamepad: boolean }
/** Auto (default): a connected pad wins, then a touch screen gets the on-screen wheel, else keyboard. */
export function autoDetectSteering(d: Detectable): 'gamepad' | 'wheel' | 'keyboard' {
  if (d.gamepad) return 'gamepad';
  if (d.touch) return 'wheel';
  return 'keyboard';
}

/** The value the Settings screen stores; 'auto' resolves through autoDetectSteering(). */
export function resolveSteering(setting: string, d: Detectable): Exclude<SteerSource, 'gyro'> | 'gyro' {
  if (setting && setting !== 'auto') return setting as SteerSource;
  return autoDetectSteering(d);
}

// ---------------------------------------------------------------- remapping
export type Binds = Record<string, string>;

/**
 * Returns the action that already owns `code` on the same device, or null.
 * Codes are compared as strings so one table can hold key codes ("KeyW") and pad buttons (0, 1, …).
 */
export function findConflict(binds: Binds, action: string, code: string | number): string | null {
  if (code == null || code === '') return null;
  for (const k of Object.keys(binds)) if (k !== action && String(binds[k]) === String(code)) return k;
  return null;
}

/** Rebind only when the code is free: a silent duplicate would make one action unreachable. */
export function rebind(binds: Binds, action: string, code: string | number): { binds: Binds; conflict: string | null } {
  const conflict = findConflict(binds, action, code);
  if (conflict) return { binds: { ...binds }, conflict };
  return { binds: { ...binds, [action]: String(code) }, conflict: null };
}

export function resetBinds(defaults: Binds): Binds { return { ...defaults }; }

// ---------------------------------------------------------------- controller menu navigation
/**
 * One D-pad step with wrap-around. -1 means "nothing focused yet", so any step focuses the first item;
 * the result is always a valid index or -1 when the list is empty.
 */
export function navStep(index: number, count: number, delta: number): number {
  if (!count || count < 1) return -1;
  if (index < 0 || index >= count) return 0;
  const d = delta < 0 ? -1 : delta > 0 ? 1 : 0;
  return ((index + d) % count + count) % count;
}

/** A held D-pad: the first move is immediate, then it repeats (first=320 ms, then every 120 ms). */
export function navRepeatReady(nowMs: number, lastMs: number, repeating: boolean, first = 320, rep = 120): boolean {
  return nowMs - lastMs > (repeating ? rep : first);
}

// ---------------------------------------------------------------- gamepads
export const PAD_ACTIONS = ['accel', 'brake', 'nitro', 'handbrake', 'shiftUp', 'shiftDown', 'horn', 'lookBack', 'reset', 'camera', 'map', 'pause', 'rewind'];
export const PAD_DEFAULT: Record<string, number> = {
  nitro: 0,        // A / Cross
  horn: 1,         // B / Circle
  handbrake: 2,    // X / Square
  camera: 3,       // Y / Triangle
  lookBack: 4,     // LB / L1
  reset: 5,        // RB / R1
  brake: 6,        // LT / L2
  accel: 7,        // RT / R2
  map: 8,          // Back / Select
  pause: 9,        // Start / Options
  rewind: 11,      // R3
};
/** Old "generic" pads often only have 6-7 buttons and no analogue triggers. */
export const PAD_FALLBACK: Record<string, number> = {
  accel: 0, brake: 1, nitro: 2, handbrake: 3, horn: 4, camera: 5, pause: 8, reset: 9, lookBack: 10, rewind: 11, map: 8,
};

/**
 * A browser only guarantees the standard mapping for `mapping === 'standard'`. Anything else gets the
 * fallback table, but a pad with 12+ buttons and 6+ axes is almost certainly standard-shaped anyway.
 */
export function padLayout(mapping: string, buttonCount: number): Record<string, number> {
  if (mapping === 'standard' || (buttonCount || 0) >= 12) return { ...PAD_DEFAULT };
  return { ...PAD_FALLBACK };
}

export function detectPadBrand(id: string): PadBrand {
  const s = String(id || '').toLowerCase();
  if (/xbox|xinput|microsoft/.test(s)) return 'xbox';
  if (/dualsense|dualshock|playstation|sony|054c|wireless controller/.test(s)) return 'playstation';
  return 'generic';
}

export const PAD_DRIFT = 0.12;
export const PAD_TRIGGER_DZ = 0.06;

// ---------------------------------------------------------------- button prompts
export const PROMPT_ICONS = {
  keyboard: { select: 'ENTER', back: 'ESC', up: '↑', down: '↓', left: '←', right: '→', accel: 'W', brake: 'S', steer: 'A/D', nitro: 'SHIFT', handbrake: 'SPACE', horn: 'H', camera: 'C', reset: 'R', pause: 'ESC', map: 'M', rewind: 'Z' },
  xbox: { select: 'A', back: 'B', up: 'D-UP', down: 'D-DOWN', left: 'D-LEFT', right: 'D-RIGHT', accel: 'RT', brake: 'LT', steer: 'LS', nitro: 'A', handbrake: 'X', horn: 'B', camera: 'Y', reset: 'RB', pause: 'START', map: 'BACK', rewind: 'R3', lookBack: 'LB' },
  playstation: { select: '✕', back: '○', up: 'D-UP', down: 'D-DOWN', left: 'D-LEFT', right: 'D-RIGHT', accel: 'R2', brake: 'L2', steer: 'LS', nitro: '✕', handbrake: '□', horn: '○', camera: '△', reset: 'R1', pause: 'OPTIONS', map: 'SHARE', rewind: 'R3', lookBack: 'L1' },
  touch: { select: 'TAP', back: 'BACK', up: '↑', down: '↓', left: '◀', right: '▶', accel: 'GAS', brake: 'BRAKE', steer: 'WHEEL', nitro: 'NOS', handbrake: 'HB', horn: 'HORN', camera: 'CAM', reset: 'RESET', pause: '❚❚', map: 'MAP', rewind: 'RW' },
};

export type PromptSet = keyof typeof PROMPT_ICONS;

/** Which icon set to show for a gamepad: the brand when we can tell, Xbox icons otherwise. */
export function padPromptSet(brand: PadBrand): PromptSet {
  return brand === 'playstation' ? 'playstation' : 'xbox';
}

export function promptIcons(device: PromptSet, action: string): string {
  const set = PROMPT_ICONS[device] || PROMPT_ICONS.keyboard;
  return (set as Record<string, string>)[action] || action.toUpperCase();
}

// ---------------------------------------------------------------- driving assists
export interface AssistOpts {
  traction?: boolean; abs?: boolean; autoBrake?: boolean; autoAccel?: boolean;
  stability?: boolean; steerAssist?: boolean; strength?: number;
}
export interface AssistCtx {
  speed?: number; slip?: number; curvature?: number; steerHint?: number; grip?: number; reversing?: boolean;
}

/**
 * Pure assist pass over the device input. Nothing here invents speed: assists only ever *reduce*
 * aggression (brake/throttle/steer) or add braking that the driver could have done themselves.
 */
export function applyAssists(i: InputState, ctx: AssistCtx, o: AssistOpts = {}): InputState {
  const out = { ...i };
  const k = o.strength == null ? 1 : Math.max(0, Math.min(1, o.strength));
  const speed = Math.max(0, ctx.speed || 0);
  const slip = Math.max(0, Math.min(1, (ctx.slip || 0) / 8));
  const curve = Math.max(0, ctx.curvature || 0);

  if (o.autoAccel && !ctx.reversing) {
    out.brake = Math.min(out.brake, 0.05);
    out.throttle = Math.max(out.throttle, 1);
  }
  if (o.traction && slip > 0.12) out.throttle *= 1 - Math.min(0.7, slip * 1.4 * k);
  if (o.abs && speed > 6) out.brake = Math.min(out.brake, 0.88);
  if (o.autoBrake && curve > 0.05) {
    // safe speed shrinks with how much the road bends in the next ~150 m (0..1 normalised bend)
    const safe = 46 - curve * 34;
    if (speed > safe) {
      out.brake = Math.max(out.brake, Math.min(1, (speed - safe) / 14));
      out.throttle = 0;
    }
  }
  if (o.stability && slip > 0.3) out.steer *= 1 - Math.min(0.45, (slip - 0.3) * k);
  if (o.steerAssist && ctx.steerHint != null) {
    const hint = Math.max(-1, Math.min(1, ctx.steerHint));
    // Fade the assist out below ~10 m/s. A car parked against a barrier, a full lock dragged on the
    // on-screen wheel or a stick held over at the start line used to be cancelled (and sometimes
    // *inverted*) by the pull toward the racing line, so the driver turned the wheel and nothing
    // happened — the classic "the car is stuck" bug. Below walking pace the driver is the only one
    // steering now, and above it the assist can still never reverse the direction they asked for.
    const w = Math.min(0.6, 0.55 * k) * (1 - Math.min(1, speed / 120) * 0.5) * Math.min(1, speed / 10);
    const mixed = out.steer * (1 - w) + hint * w;
    out.steer = (out.steer === 0 || mixed * out.steer > 0) ? mixed : 0;
  }
  return clampInput(out);
}
