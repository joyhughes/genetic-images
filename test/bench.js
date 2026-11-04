// Compare GA variants on an analytic sunset (sky gradient, sun disc, sea). node test/bench.js [seconds]
const GP = require('../gp.js');
const N = 48, rgba = new Uint8ClampedArray(N * N * 4);
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const x = (i + .5) / N * 2 - 1, y = 1 - (j + .5) / N * 2, k = (j * N + i) * 4;
  let c;
  if (x * x + (y + 0.2) ** 2 < 0.08 && y > -0.24) c = [255, 233, 160];
  else if (y > -0.24) { const s = (y + 0.24) / 1.24; c = [255 * (1 - s) + 27 * s, 179 * (1 - s) + 42 * s, 71 * (1 - s) + 107 * s]; }
  else c = [40, 35, 80];
  rgba[k] = c[0]; rgba[k + 1] = c[1]; rgba[k + 2] = c[2]; rgba[k + 3] = 255;
}
const target = new GP.Target(rgba, N), secs = +process.argv[2] || 15;
for (const variant of (process.argv[3] ? JSON.parse(process.argv[3]) : [{ dedupe: false, tune: 0.2 }, { dedupe: true, tune: 0.12 }])) {
  const res = []; let sum = 0, spread = 0;
  for (const seed of Array.from({ length: +process.argv[4] || 3 }, (_, i) => i + 1)) {
    GP.seedRandom(seed); GP.setOffsetRate(variant.offsetRate || 0); GP.setBoxRate(variant.boxRate || 0);
    const ev = new GP.Evolver(target, { popSize: 80, ...variant }); ev.seed([]);
    const t0 = Date.now(); while (Date.now() - t0 < secs * 1000) ev.step(50);
    res.push(ev.best.rmse.toFixed(4) + '/' + ev.best.nodes + 'n'); sum += ev.best.rmse; spread += ev.islandSpread ? ev.islandSpread() : 0;
  }
  console.log(JSON.stringify(variant), 'mean', (sum / res.length).toFixed(4), 'spread', (spread / res.length).toFixed(3), ' ', res.join('  '));
}
