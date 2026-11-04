const GP = require('../gp.js');
GP.seedRandom(7);
let fail = 0;
const kid = (i) => [{ op: 'x', k: [], a: [] }, { op: 'y', k: [], a: [] }, { op: 'r', k: [], a: [] }][i];
const slow = [];
for (const name in GP.OPS) {
  const op = GP.OPS[name];
  for (let trial = 0; trial < 5; trial++) {
    const t = { op: name, k: op.k.map(() => 0), a: [] };
    t.k = GP.randTree(0).k; // placeholder
    // random consts from spec via a fresh random node of this op
    const nd = { op: name, k: op.k.map((s) => s.gen()), a: Array.from({ length: op.arity }, (_, i) => trial ? GP.randomInteresting(3) : kid(i)) };
    const t0 = process.hrtime.bigint();
    const b = GP.evaluate(nd, 128);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    let lo = Infinity, hi = -Infinity, bad = 0;
    for (const v of b) { if (!Number.isFinite(v)) bad++; lo = Math.min(lo, v); hi = Math.max(hi, v); }
    GP.release(b);
    if (bad) { console.log('NONFINITE', name); fail++; }
    if (trial === 0 && !(hi > lo) && !['c', 'v', 'gdir'].includes(name)) console.log('flat', name, GP.toString(nd, 3));
    if (trial === 0 && ms > 15) slow.push(name + ' ' + ms.toFixed(1) + 'ms');
    const s = GP.toString(nd); if (GP.toString(GP.parse(s)) !== s) { console.log('roundtrip', name); fail++; }
  }
}
console.log('ops:', Object.keys(GP.OPS).length, 'families:', GP.FAMILIES.length, 'slow@128:', slow.join(', ') || 'none');
// family restriction
GP.setAllEnabled(false); GP.setFamily('pattern', true); GP.setFamily('xform', true);
const allowed = new Set([...GP.FAMILIES.find(f => f.id === 'pattern').ops, ...GP.FAMILIES.find(f => f.id === 'xform').ops]);
let t = GP.randomInteresting(5);
for (let i = 0; i < 300; i++) {
  t = GP.mutate(t, 0.6);
  const walk = (n) => { if (!allowed.has(n.op)) { console.log('disallowed op generated', n.op); fail++; } n.a.forEach(walk); };
  walk(t);
}
console.log('restricted sample:', GP.toString(t, 3).slice(0, 160));
GP.setAllEnabled(false); // nothing enabled -> leaves fall back to x,y
console.log('none enabled ->', GP.toString(GP.randTree(4)), GP.mutants(GP.randTree(3), 8, 0.5).length, 'mutants');
GP.setAllEnabled(true);
console.log(fail ? 'FAIL ' + fail : 'OK');
process.exit(fail ? 1 : 0);
