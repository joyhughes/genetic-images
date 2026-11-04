// Per-node centre offsets: evaluation semantics, text round trip, mutation.
const GP = require('../gp.js');
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } };
const N = 32;
const img = (s) => { const b = GP.evaluate(GP.parse(s), N), c = b.slice(); GP.release(b); return c; };
const diff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };

// r about (0.5, 0) rotated about the same point is unchanged
assert(diff(img('(rot@0.5,0 1.1 r@0.5,0)'), img('r@0.5,0')) < 1e-5, 'rot about c leaves r@c unchanged');
// rings@c equals rings of a translated frame: (xform 1 -cx -cy (rings f))
assert(diff(img('(rings@0.3,-0.2 5)'), img('(xform 1 -0.3 0.2 (rings 5))')) < 1e-5, 'rings offset = translated rings');
// children of a 'pos' op still see unshifted coordinates: juliaw children x,y
assert(diff(img('(juliaw@0.4,0.1 12 x y)'), img('(xform 1 -0.4 -0.1 (juliaw 12 (xform 1 0.4 0.1 x) (xform 1 0.4 0.1 y)))')) < 1e-5, 'juliaw children unshifted');
// zoom about c: point c is fixed -> child sampled at c there; compare to explicit translate sandwich
assert(diff(img('(zoom@-0.3,0.4 2 (rings 3))'), img('(xform 1 0.3 -0.4 (zoom 2 (xform 1 -0.3 0.4 (rings 3))))')) < 1e-5, 'zoom about c');
// offset on a non-centred op is ignored by parse
assert(!GP.parse('(add@0.1,0.1 x y)').o, 'non-centred op drops offset');
// round trip
const s = '(swirl@0.25,-0.5 0.4 (mul (rings@0.1,0.2 4) th@-0.3,0))';
assert(GP.toString(GP.parse(s)) === s, 'round trip: ' + GP.toString(GP.parse(s)));
assert(GP.clone(GP.parse(s)).a[0].a[0].o[1] === 0.2, 'clone keeps offset');
// with rate 0 nothing gets offsets; with rate 1 they appear and evaluate finitely
GP.seedRandom(7); GP.setOffsetRate(0);
let any = false; for (let i = 0; i < 200; i++) if (GP.toString(GP.randTree(5)).includes('@')) any = true;
assert(!any, 'rate 0: no offsets');
GP.setOffsetRate(0.6); let cnt = 0, bad = 0;
for (let i = 0; i < 300; i++) {
  let t = GP.randTree(5); for (let j = 0; j < 5; j++) t = GP.mutate(t, 0.6);
  const str = GP.toString(t); if (str.includes('@')) cnt++;
  assert(GP.toString(GP.parse(str)) === str, 'round trip random');
  const b = GP.evaluate(t, 16); for (const v of b) if (!isFinite(v)) bad++; GP.release(b);
}
assert(cnt > 50, 'rate 0.6 produces offsets: ' + cnt);
assert(bad === 0, 'finite');
console.log('offset tests ok (' + cnt + '/300 random trees had offsets)');
