import test from 'node:test';
import assert from 'node:assert/strict';
import { hashSeed, mulberry32, dailyChallenge, eliminationTimes, KO_START, KO_INTERVAL, WEATHERS, TIMES } from '../src/daily.ts';
import { validateSetup, GRID_SIZES } from '../src/index.ts';

test('seed hash is stable and platform independent', () => {
  assert.equal(hashSeed('2026-11-11'), hashSeed('2026-11-11'));
  assert.notEqual(hashSeed('2026-11-11'), hashSeed('2026-11-12'));
  assert.ok(hashSeed('') >= 0 && hashSeed('') < 2 ** 32);
});

test('mulberry32 stays inside [0,1) and repeats for the same seed', () => {
  const a = mulberry32(12345), b = mulberry32(12345);
  for (let i = 0; i < 500; i++) {
    const v = a();
    assert.ok(v >= 0 && v < 1);
    assert.equal(v, b());
  }
});

test('daily challenge is identical for the same day and differs across days', () => {
  const d = dailyChallenge('2026-11-11'), same = dailyChallenge('2026-11-11');
  assert.deepEqual(d, same);
  const other = dailyChallenge('2026-11-12');
  assert.ok(JSON.stringify(d) !== JSON.stringify(other));
  // a week of challenge days must always be buildable
  for (let i = 0; i < 30; i++) {
    const c = dailyChallenge('2026-12-' + String(i + 1).padStart(2, '0'));
    assert.ok(c.car >= 0 && c.car < 12);
    assert.ok(c.loc >= 0 && c.loc < 6);
    assert.ok(c.laps >= 2 && c.laps <= 4);
    assert.ok(WEATHERS.includes(c.wx) && TIMES.includes(c.tod));
    assert.ok(c.diff >= 2 && c.diff <= 5);
    assert.ok(c.target > c.laps * 30, 'par time must be reachable');
  }
});

test('daily challenge is a legal race setup', () => {
  const c = dailyChallenge('2026-11-11');
  assert.deepEqual(validateSetup({ car: c.car, num: 8, diff: c.diff, laps: c.laps, loc: c.loc, wx: c.wx }, [c.car]), []);
});

test('elimination schedule knocks out exactly one car per interval', () => {
  const t = eliminationTimes(KO_START, KO_INTERVAL, 5);
  assert.deepEqual(t, [15, 35, 55, 75, 95]);
  assert.equal(t.length, 5);
  assert.equal(eliminationTimes(KO_START, KO_INTERVAL, 0).length, 0);
  for (const n of GRID_SIZES) assert.equal(eliminationTimes(0, 20, n - 1).length, n - 1);
});
