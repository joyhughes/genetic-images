// Localized (boxed) functions: semantics, memo reuse, text round trip, mutation.
const GP = require('../gp.js');
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } };
const N = 32;
const img = (s) => { const b = GP.evaluate(typeof s === 'string' ? GP.parse(s) : s, N), c = b.slice(); GP.release(b); return c; };
const at = (a, x, y, ch = 0) => { const i = Math.floor((1 - y) / 2 * N) * N + Math.floor((x + 1) / 2 * N); return a[ch * N * N + i]; };
const diff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };

// a boxed neg: inside = -x, outside = x
const b = img('(neg#0.5,0.5,0.25,0.25,0.01 x)');
assert(Math.abs(at(b, 0.5, 0.5) + 0.5) < 0.05, 'inside negated ' + at(b, 0.5, 0.5));
assert(Math.abs(at(b, -0.5, -0.5) + 0.5) < 0.05 && Math.abs(at(b, -0.5, 0.5) + 0.5) < 0.05, 'outside passes x through');
assert(Math.abs(at(b, 0.9, 0.9) - 0.9) < 0.05, 'outside right passes through');
// leaf: boxed constant is a soft rectangle on grey 0
const c = img('(v#0,0,0.3,0.3,0.05 1 -1 0.5)');
assert(Math.abs(at(c, 0, 0) - 1) < 1e-4 && Math.abs(at(c, 0, 0, 1) + 1) < 1e-4 && Math.abs(at(c, 0.9, 0.9)) < 1e-6, 'boxed leaf');
// soft edge gives intermediate values
const e = img('(v#0,0,0.5,0.5,0.3 1 1 1)'); const mid = at(e, 0.5, 0);
assert(mid > 0.2 && mid < 0.8, 'soft edge ' + mid);
// box covering everything with tiny softness = unboxed
assert(diff(img('(swirl#0,0,5,5,0.01 0.7 (rings 4))'), img('(swirl 0.7 (rings 4))')) < 1e-6, 'full box = no box');
// memo: base reuse gives the same answer as recomputing for ops that read child 0 several ways
for (const s of ['(add#0.1,0,0.4,0.6,0.1 (rings 3) y)', '(blur#0,0,0.5,0.5,0.1 0.05 (checker 4))', '(rot@0.3,0#0,0,0.5,0.5,0.1 0.8 (stripes 3 0.4))',
  '(bump#0,0,0.5,0.5,0.1 0.7 (fbm 3 5))', '(lerp#0.2,0.2,0.4,0.4,0.2 x y (rings 2))']) {
  const t = GP.parse(s), plain = GP.clone(t); delete plain.b;
  const got = img(t), f = img(plain), base = img(t.a[0]);
  // reconstruct expected: base + (f - base) * mask, with mask from a boxed constant 1 over grey 0
  const m = img({ op: 'c', k: [1], a: [], b: t.b.slice() });
  let worst = 0; for (let i = 0; i < got.length; i++) { const mi = m[i % (N * N)]; worst = Math.max(worst, Math.abs(got[i] - (base[i] + (f[i] - base[i]) * mi))); }
  assert(worst < 1e-4, 'blend formula for ' + s + ' err ' + worst);
}
// round trip incl. offset + box and boxed constant
for (const s of ['(rings@0.1,0.2#0,0,0.4,0.3,0.1 5)', 'r#0.5,0.5,0.2,0.2,0.05', '(c#0,0,0.3,0.3,0.1 0.5)', '(add#-0.2,0.1,0.3,0.4,0.05 x th@0.3,0)']) {
  assert(GP.toString(GP.parse(s)) === s, 'round trip ' + s + ' -> ' + GP.toString(GP.parse(s)));
}
// rates
GP.seedRandom(11); GP.setBoxRate(0); let any = false;
for (let i = 0; i < 200; i++) if (GP.toString(GP.mutate(GP.randTree(5), 0.6)).includes('#')) any = true;
assert(!any, 'rate 0: no boxes');
GP.setBoxRate(0.3); GP.setOffsetRate(0.3); let cnt = 0, bad = 0;
for (let i = 0; i < 300; i++) {
  let t = GP.randTree(5); for (let j = 0; j < 5; j++) t = GP.mutate(t, 0.6);
  const s = GP.toString(t); if (s.includes('#')) cnt++;
  assert(GP.toString(GP.parse(s)) === s, 'random round trip');
  const bb = GP.evaluate(t, 16); for (const v of bb) if (!isFinite(v)) bad++; GP.release(bb);
}
assert(cnt > 100 && bad === 0, 'boxes appear and evaluate finitely ' + cnt + ' ' + bad);
console.log('box tests ok (' + cnt + '/300 random trees had boxes)');
