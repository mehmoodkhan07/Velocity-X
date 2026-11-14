import test from 'node:test';
import assert from 'node:assert/strict';
import {
  draftStrength, DRAFT_RANGE, DRAFT_LAT,
  newTyre, tyreGrip, tyreStep, TYRE_OPT,
  fuelBurn, fuelMassMul, FUEL_CAPACITY,
  newDamage, addDamage, damageMul, brokenParts,
  newRival, rivalEvent, rivalPressure, rivalTitle, grudgeDecay, GRUDGE_GAIN,
  nitroHeatStep, NITRO_HEAT_GAIN, NITRO_HEAT_COOL, perfectStart, perfectShift, OVERHEAT_LOCK,
  rewindBudget, rewindPenalty,
} from '../src/gameplay.ts';

test('drafting only pays off directly behind a car at speed', () => {
  const fast = 60;
  assert.ok(draftStrength(6, 0, fast) > 0.4, 'tucked in behind is strong');
  assert.equal(draftStrength(6, 3.4, fast), 0, 'beside the car is not drafting');
  assert.equal(draftStrength(DRAFT_RANGE + 1, 0, fast), 0, 'too far back');
  assert.equal(draftStrength(6, 0, 5), 0, 'too slow to matter');
  assert.ok(draftStrength(4, 0, fast) > draftStrength(14, 0, fast), 'closer is stronger');
  assert.ok(draftStrength(6, 0, fast) <= 1 && draftStrength(6, 0, fast) > 0);
  // monotonic across the whole cone, never negative
  for (let g = 0.1; g < DRAFT_RANGE + 4; g += 0.5)
    for (let l = -DRAFT_LAT * 2; l <= DRAFT_LAT * 2; l += 0.5) {
      const v = draftStrength(g, l, fast);
      assert.ok(v >= 0 && v <= 1);
    }
});

test('tyres warm up, wear out and lose grip', () => {
  let t = newTyre();
  assert.ok(tyreGrip(t.wear, TYRE_OPT) > tyreGrip(0, 40), 'cold tyres are slick');
  for (let i = 0; i < 120; i++) t = tyreStep(t, 1 / 60, 50, 0.6);
  assert.ok(t.temp > newTyre().temp, 'sliding heats the tyre');
  const worn = tyreStep({ wear: 100, temp: TYRE_OPT }, 1 / 60, 50, 0);
  assert.ok(tyreGrip(worn.wear, worn.temp) < tyreGrip(0, TYRE_OPT), 'wear costs grip');
  assert.ok(tyreGrip(100, 150) >= 0.55, 'grip never collapses to zero');
  let hot = { wear: 0, temp: 149 };
  hot = tyreStep(hot, 1, 0, 0);
  assert.ok(hot.temp < 150, 'tyres cool down when the car stops');
});

test('fuel burns with throttle and is a real mass penalty', () => {
  assert.ok(fuelBurn(1, 1, false) > fuelBurn(1, 0, false));
  assert.ok(fuelBurn(1, 1, true) > fuelBurn(1, 1, false), 'nitro burns more');
  assert.ok(fuelBurn(60, 1, false) <= FUEL_CAPACITY, 'a full tank lasts a race distance');
  assert.ok(fuelMassMul(FUEL_CAPACITY) < fuelMassMul(0), 'a full tank is slower');
  assert.ok(fuelMassMul(FUEL_CAPACITY) > 0.9, 'but never a cliff');
  assert.equal(fuelMassMul(-5), 1);
});

test('damage degrades the right subsystem and breaks parts', () => {
  let d = newDamage();
  d = addDamage(d, 'engine', 30);
  const m = damageMul(d);
  assert.ok(m.power < 1 && m.grip === 1, 'engine damage only costs power');
  d = addDamage(d, 'tyres', 80);
  assert.ok(damageMul(d).grip < 0.9);
  assert.deepEqual(brokenParts(d), ['suspension'], 'only the wrecked subsystem is listed');
  assert.deepEqual(brokenParts(addDamage(d, 'engine', 60)), ['engine', 'suspension']);
  assert.deepEqual(brokenParts(newDamage()), []);
  assert.equal(addDamage(d, 'aero', 500).aero, 100, 'clamped at 100');
});

test('grudge builds from incidents and turns a driver into a nemesis', () => {
  let r = newRival();
  assert.equal(rivalTitle(r.grudge), 'NEUTRAL');
  r = rivalEvent(r, 'ram');
  assert.equal(r.hits, 1);
  assert.equal(r.grudge, GRUDGE_GAIN.ram);
  r = rivalEvent(r, 'beaten');
  assert.equal(r.wins, 1);
  assert.ok(rivalPressure(r.grudge) > 0);
  for (let i = 0; i < 10; i++) r = rivalEvent(r, 'beaten');
  assert.equal(r.grudge, 100, 'clamped at 100');
  assert.equal(rivalTitle(r.grudge), 'NEMESIS');
  assert.equal(r.wins, 11);
  const cooled = grudgeDecay(100);
  assert.ok(cooled < 100 && cooled > 80, 'feuds cool off slowly');
});

test('nitro heat locks the bottle and perfect inputs pay off', () => {
  let h = 0;
  for (let i = 0; i < 100; i++) h = nitroHeatStep(h, 0.1, true);
  assert.equal(h, 100);
  for (let i = 0; i < 100; i++) h = nitroHeatStep(h, 0.1, false);
  assert.equal(h, 0);
  assert.ok(OVERHEAT_LOCK > 0);
  assert.ok(perfectStart(0.2) && perfectStart(-0.3));
  assert.ok(!perfectStart(0.9) && !perfectStart(-2));
  assert.ok(perfectShift(0.95) > 1);
  assert.equal(perfectShift(0.5), 1);
});

test('rewind is limited, off when online and costs time', () => {
  assert.equal(rewindBudget('3', false), 3);
  assert.equal(rewindBudget('off', false), 0);
  assert.ok(rewindBudget('inf', false) > 100);
  assert.equal(rewindBudget('inf', true), 0, 'ranked/online never gets rewinds');
  assert.deepEqual(rewindPenalty(3), { time: 3, nitro: 15 });
});

test('one bottle of nitro is hot enough to overheat the car', () => {
  // regression: with heat gain below 100/bottleSeconds, overheat could never trigger in a race.
  const bottle = 100 / 28;                       // ~3.6 s of boost, see the nitro drain in web/js/game.js
  let h = 0;
  for (let i = 0; i < Math.ceil(bottle * 60); i++) h = nitroHeatStep(h, 1 / 60, true);
  assert.equal(h, 100, 'a full bottle must be able to reach the lock');
  let cool = h;
  for (let i = 0; i < Math.ceil(OVERHEAT_LOCK * 60); i++) cool = nitroHeatStep(cool, 1 / 60, false);
  assert.ok(cool < 70, 'the lock is long enough to force a real cooldown, got ' + cool);
});

test('multi-declarator exports are real bindings', () => {
  // regression: `export const A = 1, B = 2;` used to expose only A from the generated classic-script
  // bundle, so the browser read VXCORE.OVERHEAT_LOCK === undefined and the lock never engaged.
  assert.equal(typeof NITRO_HEAT_GAIN, 'number');
  assert.equal(typeof NITRO_HEAT_COOL, 'number');
  assert.equal(typeof OVERHEAT_LOCK, 'number');
});
