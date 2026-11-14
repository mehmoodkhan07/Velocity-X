// Unit tests for the shared input rules: deadzone/curve/smoothing math, wheel mapping, tilt calibration,
// auto-detect and remap conflict detection. These are the rules every device goes through.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDeadzone, steerCurve, steerSmoothing, triggerValue, mergeInput, emptyInput, clampInput,
  wheelAngleToSteer, wheelAutoCenter, wheelCenterCrossed, WHEEL_MAX_DEG,
  landscapeFromAngle, tiltAxis, tiltNeutral, tiltToSteer,
  autoDetectSteering, resolveSteering,
  findConflict, rebind, resetBinds, navStep, navRepeatReady,
  padLayout, detectPadBrand, PAD_DEFAULT, PAD_FALLBACK,
  promptIcons, padPromptSet, PROMPT_ICONS,
  applyAssists,
} from '../src/input.ts';

test('deadzone kills stick drift and rescales the live range', () => {
  assert.equal(applyDeadzone(0.05, 0.12), 0);
  assert.equal(applyDeadzone(-0.12, 0.12), 0, 'exactly on the deadzone is still 0');
  assert.ok(applyDeadzone(0.56, 0.12) > 0.4 && applyDeadzone(0.56, 0.12) < 0.6);
  assert.equal(applyDeadzone(1, 0.12), 1);
  assert.equal(applyDeadzone(-1, 0.12), -1);
  assert.ok(applyDeadzone(-0.56, 0.12) < 0, 'sign is preserved');
  // a zero deadzone must not divide by zero
  assert.equal(applyDeadzone(0.3, 0), 0.3);
});

test('response curves are monotonic, symmetric and hit both ends', () => {
  for (const c of ['linear', 'soft', 'aggressive'] as const) {
    assert.equal(steerCurve(0, c), 0);
    assert.equal(steerCurve(1, c), 1);
    assert.equal(steerCurve(-1, c), -1);
    let prev = -1;
    for (let x = -1; x <= 1.0001; x += 0.05) {
      const v = steerCurve(x, c);
      assert.ok(v >= prev - 1e-9, c + ' must not go backwards');
      assert.ok(Math.abs(v) <= 1);
      prev = v;
    }
    assert.ok(Math.abs(steerCurve(0.5, c) + steerCurve(-0.5, c)) < 1e-12, 'odd function');
  }
  // soft gives finer control near centre, aggressive bites earlier
  assert.ok(steerCurve(0.4, 'soft') < 0.4);
  assert.ok(steerCurve(0.4, 'aggressive') > 0.4);
  assert.equal(steerCurve(0.4, 'linear'), 0.4);
});

test('smoothing ramps in, centres and is frame-rate independent', () => {
  let a = 0;
  for (let i = 0; i < 60; i++) a = steerSmoothing(1, a, 1 / 60, 14);
  const oneSec = a;
  assert.ok(oneSec > 0.99, 'full lock inside a second, got ' + oneSec);
  let b = 0;
  for (let i = 0; i < 10; i++) b = steerSmoothing(1, b, 1 / 10, 14);   // same 1 s at 10 Hz
  assert.ok(Math.abs(oneSec - b) < 0.01, 'same result at a different frame rate');
  let c = 1;
  for (let i = 0; i < 60; i++) c = steerSmoothing(0, c, 1 / 60, 14);
  assert.equal(c, 0, 'snaps to exactly zero when centred');
  assert.ok(steerSmoothing(1, 0, 0.25, 14) > 0.8, 'a quarter second is already most of the lock');
});

test('trigger deadzone keeps the first part of the travel silent', () => {
  assert.equal(triggerValue(0.02, 0.06), 0);
  assert.ok(triggerValue(0.5, 0.06) > 0.4);
  assert.equal(triggerValue(1, 0.06), 1);
});

test('the shared input state is clamped and the active pad wins the wheel', () => {
  const i = clampInput({ steer: 4, throttle: 2, brake: -1, handbrake: 9, nitro: 1, horn: 0, camera: 0, reset: 0 } as any);
  assert.equal(i.steer, 1); assert.equal(i.throttle, 1); assert.equal(i.brake, 0);
  assert.equal(i.handbrake, 1); assert.equal(i.nitro, true);
  assert.equal(emptyInput().steer, 0);
  const m = mergeInput({ ...emptyInput(), steer: -1, throttle: 1 }, { ...emptyInput(), steer: 0.5, brake: 0.5 });
  assert.equal(m.steer, 0.5, 'pad steer replaces keyboard steer');
  assert.equal(m.throttle, 1, 'throttle is the strongest of both');
  assert.equal(m.brake, 0.5);
  const k = mergeInput({ ...emptyInput(), steer: -1 }, { ...emptyInput(), steer: 0 });
  assert.equal(k.steer, -1, 'an untouched pad does not cancel the keyboard');
});

test('steering wheel: ±450° is full lock and the wheel re-centres', () => {
  assert.equal(WHEEL_MAX_DEG, 450);
  assert.equal(wheelAngleToSteer(0), 0);
  assert.equal(wheelAngleToSteer(450), 1);
  assert.equal(wheelAngleToSteer(-450), -1);
  assert.equal(wheelAngleToSteer(900), 1, 'clamped');
  assert.ok(Math.abs(wheelAngleToSteer(225) - 0.5) < 1e-9);
  let deg = 300;
  for (let i = 0; i < 120; i++) deg = wheelAutoCenter(deg, 1 / 60, 7);
  assert.equal(deg, 0, 'auto-centre settles exactly on straight ahead');
  assert.ok(wheelAutoCenter(300, 1 / 60, 7) < 300);
  assert.ok(wheelCenterCrossed(5, -1) && wheelCenterCrossed(-5, 1));
  assert.ok(!wheelCenterCrossed(-5, -1) && !wheelCenterCrossed(5, 7), 'only one tick per crossing');
});

test('landscape detection handles both rotations', () => {
  assert.equal(landscapeFromAngle(0), 'portrait');
  assert.equal(landscapeFromAngle(180), 'portrait');
  assert.equal(landscapeFromAngle(90), 'landscape-left');
  assert.equal(landscapeFromAngle(-90), 'landscape-right');
  assert.equal(landscapeFromAngle(270), 'landscape-right');
});

test('tilt calibration makes the current angle neutral and steering is symmetric', () => {
  const o = 'landscape-left' as const;
  const neutral = tiltNeutral(12, 3, o);
  assert.equal(neutral, 12);
  assert.ok(Math.abs(tiltToSteer(12, neutral, 0, { smoothing: 0 }) - 0) < 1e-9, 'calibrated pose = no steer');
  const right = tiltToSteer(12 - 40, neutral, 0, { smoothing: 0, sensitivity: 1, deadzone: 3 });
  const left = tiltToSteer(12 + 40, neutral, 0, { smoothing: 0, sensitivity: 1, deadzone: 3 });
  assert.ok(Math.abs(right + left) < 1e-9, 'symmetric');
  assert.ok(Math.abs(right) > 0.5, 'a 40° tilt is a real input: ' + right);
  assert.equal(tiltToSteer(12 + 1, neutral, 0, { smoothing: 0, deadzone: 3 }), 0, 'inside the deadzone');
  assert.ok(tiltToSteer(12 + 40, neutral, 0, { smoothing: 0, invert: true }) < 0, 'invert flips the sign');
  const sens = Math.abs(tiltToSteer(12 + 20, neutral, 0, { smoothing: 0, sensitivity: 2 }));
  const normal = Math.abs(tiltToSteer(12 + 20, neutral, 0, { smoothing: 0, sensitivity: 1 }));
  assert.ok(sens > normal, 'sensitivity slider matters');
  // low-pass: the output moves toward the target but never past it
  const jumped = tiltToSteer(12 + 40, neutral, 0, { smoothing: 0.8 });
  assert.ok(jumped > 0 && jumped < normal + 0.4);
});

test('portrait uses gamma, landscape uses beta with a flipped sign per side', () => {
  assert.equal(tiltAxis(10, 20, 'portrait'), 20);
  assert.equal(tiltAxis(10, 20, 'landscape-left'), 10);
  assert.equal(tiltAxis(10, 20, 'landscape-right'), -10);
});

test('auto-detect: pad wins, then touch wheel, otherwise keyboard', () => {
  assert.equal(autoDetectSteering({ touch: false, gamepad: false }), 'keyboard');
  assert.equal(autoDetectSteering({ touch: true, gamepad: false }), 'wheel');
  assert.equal(autoDetectSteering({ touch: true, gamepad: true }), 'gamepad');
  assert.equal(autoDetectSteering({ touch: false, gamepad: true }), 'gamepad');
  assert.equal(resolveSteering('auto', { touch: false, gamepad: true }), 'gamepad');
  assert.equal(resolveSteering('auto', { touch: true, gamepad: false }), 'wheel');
  assert.equal(resolveSteering('gyro', { touch: true, gamepad: true }), 'gyro', 'an explicit choice is never overridden');
  assert.equal(resolveSteering('keyboard', { touch: true, gamepad: true }), 'keyboard');
});

test('remap conflict detection refuses to bind one button to two actions', () => {
  const binds = { accel: 'KeyW', brake: 'KeyS', steer: 'KeyA' };
  assert.equal(findConflict(binds, 'brake', 'KeyW'), 'accel');
  assert.equal(findConflict(binds, 'brake', 'KeyQ'), null);
  assert.equal(findConflict(binds, 'brake', 'KeyS'), null, 'rebinding an action to its own key is fine');
  const ok = rebind(binds, 'brake', 'KeyQ');
  assert.equal(ok.conflict, null);
  assert.equal(ok.binds.brake, 'KeyQ');
  assert.equal(binds.brake, 'KeyS', 'the original object is not mutated');
  const bad = rebind(binds, 'brake', 'KeyW');
  assert.equal(bad.conflict, 'accel');
  assert.equal(bad.binds.brake, 'KeyS', 'a conflicting bind is rejected');
  const d = resetBinds({ a: 'KeyA' });
  assert.deepEqual(d, { a: 'KeyA' });
});

test('remap conflict detection also works on numeric controller buttons', () => {
  const pad: any = { accel: 7, brake: 6, nitro: 0, horn: 1 };
  assert.equal(findConflict(pad, 'handbrake', 1), 'horn', 'string/number codes are compared by value');
  assert.equal(findConflict(pad, 'handbrake', '2'), null);
  const ok = rebind(pad, 'handbrake', 2);
  assert.equal(ok.conflict, null);
  assert.equal(ok.binds.handbrake, '2', 'the stored code is a string, like the keyboard table');
  assert.equal(pad.handbrake, undefined, 'the saved layout is not mutated by a failed/partial rebind');
  const bad = rebind(pad, 'handbrake', 7);
  assert.equal(bad.conflict, 'accel');
});

test('menu navigation steps one item at a time and wraps at both ends', () => {
  assert.equal(navStep(-1, 4, 1), 0, 'the first press focuses the first item');
  assert.equal(navStep(-1, 4, -1), 0, 'up from nothing still starts at the top');
  assert.equal(navStep(0, 4, 1), 1);
  assert.equal(navStep(3, 4, 1), 0, 'down wraps to the top');
  assert.equal(navStep(0, 4, -1), 3, 'up wraps to the bottom');
  assert.equal(navStep(2, 4, 0), 2, 'no direction = no move');
  assert.equal(navStep(0, 0, 1), -1, 'an empty screen has nothing to focus');
});

test('a held D-pad moves immediately, then repeats', () => {
  assert.equal(navRepeatReady(100, 0, false), false, 'held from t=0: the 320 ms first delay has not passed');
  assert.equal(navRepeatReady(400, 0, false), true);
  assert.equal(navRepeatReady(500, 400, true), false, 'the repeat interval is 120 ms');
  assert.equal(navRepeatReady(530, 400, true), true);
});

test('pad layouts cover standard and generic controllers', () => {
  assert.deepEqual(padLayout('standard', 17), PAD_DEFAULT);
  assert.deepEqual(padLayout('', 17), PAD_DEFAULT, 'a 17-button pad is standard-shaped');
  assert.deepEqual(padLayout('', 6), PAD_FALLBACK, 'a 6-button pad needs the fallback table');
  assert.equal(PAD_DEFAULT.accel, 7, 'RT accelerates');
  assert.equal(PAD_DEFAULT.brake, 6, 'LT brakes');
  assert.equal(PAD_DEFAULT.nitro, 0, 'A/Cross = nitro');
  assert.equal(PAD_DEFAULT.handbrake, 2, 'X/Square = handbrake');
  assert.equal(PAD_DEFAULT.horn, 1, 'B/Circle = horn');
  assert.equal(PAD_DEFAULT.camera, 3, 'Y/Triangle = camera');
  assert.equal(PAD_DEFAULT.lookBack, 4, 'LB looks back');
  assert.equal(PAD_DEFAULT.reset, 5, 'RB resets the car');
  assert.equal(PAD_DEFAULT.pause, 9, 'Start pauses');
  assert.equal(PAD_DEFAULT.map, 8, 'Back opens the map');
});

test('controller brand decides which button icons are drawn', () => {
  assert.equal(detectPadBrand('Xbox Wireless Controller (STANDARD GAMEPAD)'), 'xbox');
  assert.equal(detectPadBrand('DualSense Wireless Controller'), 'playstation');
  assert.equal(detectPadBrand('054c:0ce6 Wireless Controller'), 'playstation');
  assert.equal(detectPadBrand('Speedlink Generic Pad'), 'generic');
  assert.equal(padPromptSet('playstation'), 'playstation');
  assert.equal(padPromptSet('xbox'), 'xbox');
  assert.equal(padPromptSet('generic'), 'xbox');
  assert.equal(promptIcons('xbox', 'nitro'), 'A');
  assert.equal(promptIcons('playstation', 'nitro'), PROMPT_ICONS.playstation.nitro);
  assert.equal(promptIcons('keyboard', 'horn'), 'H');
  assert.equal(promptIcons('touch', 'steer'), 'WHEEL');
});

test('assists only ever calm the car down', () => {
  const full = { steer: 1, throttle: 1, brake: 0, handbrake: 0, nitro: false, horn: false, camera: false, reset: false };
  const tc = applyAssists(full, { speed: 40, slip: 6 }, { traction: true });
  assert.ok(tc.throttle < 1, 'traction control trims the throttle');
  assert.equal(applyAssists(full, { speed: 40, slip: 0 }, { traction: true }).throttle, 1, 'no slip, no cut');
  const abs = applyAssists({ ...full, brake: 1 }, { speed: 40 }, { abs: true });
  assert.ok(abs.brake < 1, 'ABS releases some brake pressure');
  assert.equal(applyAssists({ ...full, brake: 1 }, { speed: 2 }, { abs: true }).brake, 1, 'ABS is inactive at a crawl');
  const ab = applyAssists(full, { speed: 45, curvature: 0.9 }, { autoBrake: true });
  assert.ok(ab.brake > 0 && ab.throttle === 0, 'auto-brake brakes into a bend');
  assert.equal(applyAssists(full, { speed: 10, curvature: 0.9 }, { autoBrake: true }).brake, 0, 'not below the safe speed');
  const one = applyAssists({ ...full, throttle: 0 }, { speed: 20 }, { autoAccel: true });
  assert.equal(one.throttle, 1, 'one-pedal mode accelerates');
  const st = applyAssists({ ...full, steer: 0 }, { speed: 20, steerHint: 0.8 }, { steerAssist: true });
  assert.ok(st.steer > 0.2, 'steering assist pulls toward the racing line');
  // a stationary car must steer exactly as told: the racing-line pull used to cancel (or invert) a full
  // lock at 0 m/s, so the driver turned the wheel and nothing happened
  const parked = applyAssists({ ...full, steer: -1 }, { speed: 0, steerHint: 1 }, { steerAssist: true });
  assert.equal(parked.steer, -1, 'no steering assist at a standstill');
  const slow = applyAssists({ ...full, steer: -1 }, { speed: 20, steerHint: 1 }, { steerAssist: true });
  assert.ok(slow.steer <= 0, 'the assist may soften a lock but never reverse it');
  const stab = applyAssists(full, { speed: 30, slip: 8 }, { stability: true });
  assert.ok(stab.steer < 1, 'stability control trims the lock in a slide');
  // nothing may exceed the physical range
  const all = applyAssists(full, { speed: 60, slip: 8, curvature: 1, steerHint: 1 }, { traction: true, abs: true, autoBrake: true, autoAccel: true, stability: true, steerAssist: true });
  assert.ok(all.steer >= -1 && all.steer <= 1 && all.throttle >= 0 && all.throttle <= 1 && all.brake >= 0 && all.brake <= 1);
});
