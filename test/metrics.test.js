const GP = require('../gp.js');
GP.seedRandom(11);
const N = 48, hidden = GP.parse('(add (cnoise 2 5) (mul (rings 3) (v 1 0 -1)))'), hb = GP.evaluate(hidden, N), rgba = GP.toRGBA(hb, N); GP.release(hb);
const all = {}; for (const m of GP.METRICS) all[m.id] = 1;
const T = new GP.Target(rgba, N, all);
const fmt = (t) => Object.entries(t).map(([k, v]) => k + '=' + v.toFixed(3)).join(' ');
console.log('hidden genome vs itself:', fmt(GP.distance(hidden, T).terms));
console.log('flat grey           :', fmt(GP.distance(GP.parse('0'), T).terms));
console.log('random other        :', fmt(GP.distance(GP.randomInteresting(6), T).terms));
let fail = 0;
const self = GP.distance(hidden, T); for (const k in self.terms) if (self.terms[k] > 0.1) { console.log('self term too big', k); fail++; }
const flat = GP.distance(GP.parse('0'), T); for (const k in flat.terms) if (Math.abs(flat.terms[k] - 1) > 0.05) { console.log('flat term not ~1', k, flat.terms[k]); fail++; }
// cost per metric
const trees = Array.from({ length: 200 }, () => GP.randomInteresting(5));
for (const m of [null, ...GP.METRICS.map((x) => x.id)]) {
  const w = { rgb: 0 }; if (m) w[m] = 1; else w.rgb = 1;
  const t2 = new GP.Target(rgba, N, w); const t0 = process.hrtime.bigint();
  for (const t of trees) GP.distance(t, t2);
  console.log((m || 'rgb only').padEnd(8), (Number(process.hrtime.bigint() - t0) / 1e6 / trees.length).toFixed(3), 'ms/eval');
}
const t3 = new GP.Target(rgba, N, all); let t0 = process.hrtime.bigint(); for (const t of trees) GP.distance(t, t3);
console.log('all on  ', (Number(process.hrtime.bigint() - t0) / 1e6 / trees.length).toFixed(3), 'ms/eval');
// rescore after weight change
const ev = new GP.Evolver(T, { popSize: 40, islands: 2 }); ev.seed([]); const t1 = Date.now(); while (Date.now() - t1 < 1500) ev.step(50);
T.setWeights({ edges: 1 }); ev.rescore();
if (ev.best !== ev.sorted()[0] || !ev.best.terms.edges) { console.log('rescore broken'); fail++; }
// grey target: a coloured candidate must not explode the saturation term
const grey = GP.evaluate(GP.parse('(noise 3 9)'), N), Tg = new GP.Target(GP.toRGBA(grey, N), N, all); GP.release(grey);
const dg = GP.distance(GP.parse('(cnoise 3 9)'), Tg); console.log('grey target, colour candidate:', fmt(dg.terms));
if (dg.terms.sat > 50) { console.log('sat term exploded'); fail++; }
console.log(fail ? 'FAIL' : 'OK'); process.exit(fail ? 1 : 0);
