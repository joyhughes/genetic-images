const GP = require('../gp.js');
GP.seedRandom(12345);
let bad = 0, t0 = Date.now(), nodes = 0;
const trees = [];
for (let i = 0; i < 300; i++) {
  const t = GP.randomInteresting(5); trees.push(t); nodes += GP.size(t);
  const b = GP.evaluate(t, 64);
  for (const v of b) if (!Number.isFinite(v)) { bad++; break; }
  GP.release(b);
  const s = GP.toString(t), p = GP.parse(s);
  if (GP.toString(p) !== s) { console.log('roundtrip mismatch', s); process.exit(1); }
}
console.log('300 random trees @64: ms/eval', ((Date.now() - t0) / 300).toFixed(2), 'avg nodes', (nodes / 300).toFixed(1), 'nonfinite', bad);
// mutants
t0 = Date.now();
const ms = GP.mutants(trees[0], 8, 0.5);
console.log('8 mutants in', Date.now() - t0, 'ms; sizes', ms.map(GP.size).join(','));
// per-op coverage: every op evaluates finitely
for (const name in GP.OPS) {
  const op = GP.OPS[name];
  const t = { op: name, k: op.k.map(() => 0.7), a: Array.from({ length: op.arity }, (_, i) => ({ op: i ? 'y' : 'x', k: [], a: [] })) };
  const b = GP.evaluate(t, 32); let lo = Infinity, hi = -Infinity;
  for (const v of b) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  GP.release(b);
  if (!(hi > lo) && !['c', 'v'].includes(name)) console.log('flat op', name, lo, hi);
}
// resolution consistency: a 256 render downsampled should resemble 64 render
// GA on a target produced by a hidden random genome
const hidden = GP.randomInteresting(6), N = 48;
const hb = GP.evaluate(hidden, N), rgba = GP.toRGBA(hb, N); GP.release(hb);
const target = new GP.Target(rgba, N);
const ev = new GP.Evolver(target, { popSize: 60 });
ev.seed([]);
console.log('hidden:', GP.toString(hidden, 3));
t0 = Date.now();
let last = 0;
while (Date.now() - t0 < 20000) {
  ev.step(50);
  if (Date.now() - last > 4000) { last = Date.now(); console.log(((Date.now() - t0) / 1000).toFixed(0) + 's evals', ev.evals, 'rmse', ev.best.rmse.toFixed(4), 'nodes', ev.best.nodes); }
}
console.log('evals/s', (ev.evals / 20).toFixed(0), 'final rmse', ev.best.rmse.toFixed(4));
console.log('best:', GP.toString(ev.best.tree, 3));
// baked genome reproduces the scored image
const bk = ev.baked(ev.best), bb = GP.evaluate(bk, N);
let e = 0; for (let c = 0; c < 3; c++) for (let i = 0; i < N * N; i++) { const d = Math.min(1, Math.max(0, (bb[c * N * N + i] + 1) / 2)) - target.levels[0][c * N * N + i]; e += d * d; }
console.log('baked rmse', Math.sqrt(e / (3 * N * N)).toFixed(4));
// analytic "drawn" target: orange disc on blue-to-white sky
{
  const N = 48, rgba = new Uint8ClampedArray(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i + .5) / N * 2 - 1, y = 1 - (j + .5) / N * 2, k = (j * N + i) * 4, inDisc = (x - .2) ** 2 + (y - .1) ** 2 < .16;
    const s = (y + 1) / 2;
    rgba[k] = inDisc ? 250 : 255 * (1 - s) + 40 * s; rgba[k + 1] = inDisc ? 140 : 255 * (1 - s) + 90 * s; rgba[k + 2] = inDisc ? 20 : 255 * (1 - s) + 200 * s; rgba[k + 3] = 255;
  }
  const ev2 = new GP.Evolver(new GP.Target(rgba, N), { popSize: 80 }); ev2.seed([]);
  const t1 = Date.now(); let l = 0;
  while (Date.now() - t1 < 20000) { ev2.step(50); if (Date.now() - l > 5000) { l = Date.now(); console.log('disc', ((Date.now() - t1) / 1000).toFixed(0) + 's rmse', ev2.best.rmse.toFixed(4), 'nodes', ev2.best.nodes); } }
  console.log('disc best:', GP.toString(ev2.best.tree, 3));
}
