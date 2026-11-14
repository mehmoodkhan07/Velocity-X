// Pure, engine-independent game rules (shared-core seed for the future monorepo). Same formulas the web game uses.
export interface RaceCfg { car: number; num: number; diff: number; laps: number; loc: number; wx: string }
export const GRID_SIZES = [2, 4, 6, 8, 10, 12, 16];
export function validateSetup(c: RaceCfg, owned: number[]): string[] {
  const e: string[] = [];
  if (!GRID_SIZES.includes(c.num)) e.push('invalid car count');
  if (!Number.isInteger(c.laps) || c.laps < 1 || c.laps > 10) e.push('laps must be 1-10');
  if (!owned.includes(c.car)) e.push('car not owned');
  if (c.diff < 0 || c.diff > 5) e.push('invalid difficulty');
  if (c.loc < 0 || c.loc > 5) e.push('invalid location');
  if (!['clear', 'rain', 'fog', 'dyn'].includes(c.wx)) e.push('invalid weather');
  return e;
}
const PERS = ['Aggressive', 'Balanced', 'Defensive', 'Technical', 'Speed-focused'];
export function spawnOpponents(num: number, playerCar: number, carCount: number, rng: () => number) {
  const pool = [...Array(carCount).keys()].filter(i => i !== playerCar), out = [];
  for (let i = 0; i < num - 1; i++) out.push({ name: 'AI-' + (i + 1), car: pool[i % pool.length], personality: PERS[Math.floor(rng() * 5)] });
  return out;
}
export interface RaceEntry { id: string; total: number; fin: number | null }
export function rankRace(cars: RaceEntry[]): string[] {
  return [...cars].sort((a, b) => a.fin != null && b.fin != null ? a.fin - b.fin : a.fin != null ? -1 : b.fin != null ? 1 : b.total - a.total).map(c => c.id);
}
export function calcRewards(pos: number, n: number) {
  return { credits: Math.round(((n - pos + 1) / n) * n * 150 + (pos === 1 ? 500 : 0)), xp: Math.round(((n - pos + 1) / n) * 400 + (pos === 1 ? 300 : 0)) };
}
export function purchase(credits: number, price: number, level: number, minLevel: number) {
  if (level < minLevel) return { ok: false, credits, reason: 'level too low' };
  if (credits < price) return { ok: false, credits, reason: 'not enough credits' };
  return { ok: true, credits: credits - price, reason: '' };
}
export const SAVE_VERSION = 2;
export function migrateSave(raw: unknown) {
  const d = { version: SAVE_VERSION, credits: 5000, xp: 0, owned: [0] as number[], wins: 0, races: 0 };
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>, num = (v: unknown, f: number) => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : f);
  return { version: SAVE_VERSION, credits: num(r.credits, d.credits), xp: num(r.xp, 0), wins: num(r.wins, 0), races: num(r.races, 0),
    owned: Array.isArray(r.owned) && r.owned.length && r.owned.every(x => Number.isInteger(x)) ? (r.owned as number[]) : [0] };
}
