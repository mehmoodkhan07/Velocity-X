import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSetup, spawnOpponents, rankRace, calcRewards, purchase, migrateSave, GRID_SIZES } from '../src/index.ts';
const ok = { car: 0, num: 8, diff: 2, laps: 3, loc: 1, wx: 'rain' };
test('setup validation', () => {
  assert.deepEqual(validateSetup(ok, [0]), []);
  assert.ok(validateSetup({ ...ok, num: 7 }, [0]).includes('invalid car count'));
  assert.ok(validateSetup({ ...ok, laps: 11 }, [0]).length);
  assert.ok(validateSetup({ ...ok, car: 3 }, [0]).includes('car not owned'));
});
test('exact opponent count for every grid size (total includes player)', () => {
  for (const n of GRID_SIZES) { const o = spawnOpponents(n, 0, 12, Math.random); assert.equal(o.length, n - 1); assert.ok(o.every(x => x.car !== 0)); }
});
test('race ranking uses finish, then laps+progress', () => {
  assert.deepEqual(rankRace([{ id: 'a', total: 900, fin: null }, { id: 'b', total: 960, fin: 80 }, { id: 'c', total: 960, fin: 75 }, { id: 'd', total: 950, fin: null }]), ['c', 'b', 'd', 'a']);
});
test('rewards', () => {
  assert.deepEqual(calcRewards(1, 8), { credits: 1700, xp: 700 });
  assert.ok(calcRewards(8, 8).credits < calcRewards(2, 8).credits);
});
test('purchases', () => {
  assert.deepEqual(purchase(5000, 3000, 2, 1), { ok: true, credits: 2000, reason: '' });
  assert.equal(purchase(1000, 3000, 2, 1).ok, false);
  assert.equal(purchase(9000, 3000, 1, 4).reason, 'level too low');
});
test('save load / migration / recovery', () => {
  assert.deepEqual(migrateSave(null).owned, [0]);
  assert.equal(migrateSave({ credits: -5, xp: 'x' }).credits, 5000);
  const s = migrateSave({ credits: 777, xp: 12, owned: [0, 4], wins: 2, races: 5 });
  assert.equal(s.credits, 777); assert.deepEqual(s.owned, [0, 4]); assert.equal(s.version, 2);
});
