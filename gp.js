// Genetic Images core: expression-tree genomes in the style of Karl Sims (1991).
// A genome is a tree of {op, k: [constants], a: [children]}. Every node evaluates to a
// 3-channel image over the square [-1,1]^2. Evaluation is done a whole image at a time on
// Float32Arrays, so coordinate ops (warp, rotate, kaleidoscope...) re-evaluate their child at
// transformed coordinates and screen-space ops (blur, gradient, bump) act on the pixel grid.
// Pure JS, no DOM: loads as a <script> (window.GP) or as a Node module.
(function (root) {
'use strict';

// ---------- randomness ----------
let rnd = Math.random;
const rand = (a, b) => a + (b - a) * rnd();
const randi = (n) => Math.floor(rnd() * n);
function gauss() { let u = 0, v = 0; while (u === 0) u = rnd(); v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307 * v); }
function poisson(l) { const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; }
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------- buffer pool ----------
class Pool {
  constructor() { this.free = new Map(); }
  get(len) { const l = this.free.get(len); return l && l.length ? l.pop() : new Float32Array(len); }
  put(b) { let l = this.free.get(b.length); if (!l) this.free.set(b.length, l = []); if (l.length < 256) l.push(b); }
}
const pool = new Pool();

// ---------- noise ----------
const GX = new Float32Array(256), GY = new Float32Array(256);
for (let i = 0; i < 256; i++) { const t = i * Math.PI * 2 / 256 + 0.1; GX[i] = Math.cos(t); GY[i] = Math.sin(t); }
function hash(x, y, s) {
  let h = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(s, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h & 255;
}
function noise2(x, y, s) {
  const x0 = Math.floor(x), y0 = Math.floor(y), xi = x0 | 0, yi = y0 | 0, fx = x - x0, fy = y - y0;
  const g00 = hash(xi, yi, s), g10 = hash(xi + 1, yi, s), g01 = hash(xi, yi + 1, s), g11 = hash(xi + 1, yi + 1, s);
  const d00 = GX[g00] * fx + GY[g00] * fy, d10 = GX[g10] * (fx - 1) + GY[g10] * fy;
  const d01 = GX[g01] * fx + GY[g01] * (fy - 1), d11 = GX[g11] * (fx - 1) + GY[g11] * (fy - 1);
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = d00 + u * (d10 - d00), b = d01 + u * (d11 - d01);
  return (a + v * (b - a)) * 1.6;
}
function fbm2(x, y, s) { let t = 0, a = 1, f = 1; for (let o = 0; o < 4; o++) { t += a * noise2(x * f, y * f, s + o * 101); a *= 0.5; f *= 2.03; } return t * 0.6; }

// ---------- constant kinds ----------
const fmtInt = (v) => String(Math.round(v));
const K = {
  unit:   { gen: () => rand(-1, 1),                                   mut: (v, a) => v + gauss() * 0.3 * a },
  freq:   { gen: () => Math.exp(rand(0, Math.log(12))),              mut: (v, a) => Math.min(60, Math.max(0.2, v * Math.exp(gauss() * 0.35 * a))) },
  seed:   { gen: () => randi(100000), int: true,                     mut: (v, a) => (rnd() < 0.35 * a ? randi(100000) : v) },
  angle:  { gen: () => rand(-Math.PI, Math.PI),                      mut: (v, a) => v + gauss() * 0.5 * a },
  scale:  { gen: () => Math.exp(gauss() * 0.7),                      mut: (v, a) => Math.min(20, Math.max(0.05, v * Math.exp(gauss() * 0.3 * a))) },
  radius: { gen: () => Math.exp(rand(Math.log(0.01), Math.log(0.15))), mut: (v, a) => Math.min(0.5, Math.max(0.003, v * Math.exp(gauss() * 0.4 * a))) },
  gain:   { gen: () => Math.exp(rand(Math.log(0.5), Math.log(6))),   mut: (v, a) => Math.min(40, Math.max(0.05, v * Math.exp(gauss() * 0.3 * a))) },
  warpk:  { gen: () => rand(-0.8, 0.8),                              mut: (v, a) => v + gauss() * 0.2 * a },
  levels: { gen: () => 2 + randi(7), int: true,                      mut: (v, a) => Math.min(16, Math.max(2, Math.round(v + gauss() * 2 * a))) },
  segs:   { gen: () => 2 + randi(9), int: true,                      mut: (v, a) => Math.min(16, Math.max(2, Math.round(v + gauss() * 2 * a))) },
};

// ---------- ops ----------
const OPS = {};
const TERMS = [], FUNCS = [];
function def(name, arity, k, w, ev) { const op = { name, arity, k: k || [], w, ev }; OPS[name] = op; (arity ? FUNCS : TERMS).push(op); }
const E = (ctx, node, X, Y) => OPS[node.op].ev(ctx, node, X, Y);

function lum(ctx, b) {
  const n = ctx.n, o = pool.get(n);
  for (let i = 0; i < n; i++) o[i] = (b[i] + b[i + n] + b[i + 2 * n]) * (1 / 3);
  return o;
}
function fill3(ctx, src) { const n = ctx.n, o = pool.get(3 * n); o.set(src, 0); o.set(src, n); o.set(src, 2 * n); return o; }
function pw1(f) {
  return (ctx, node, X, Y) => { const a = E(ctx, node.a[0], X, Y), k = node.k; for (let i = 0, L = a.length; i < L; i++) a[i] = f(a[i], k); return a; };
}
function pw2(f) {
  return (ctx, node, X, Y) => {
    const a = E(ctx, node.a[0], X, Y), b = E(ctx, node.a[1], X, Y), k = node.k;
    for (let i = 0, L = a.length; i < L; i++) a[i] = f(a[i], b[i], k);
    pool.put(b); return a;
  };
}
// Re-evaluate the child at transformed coordinates.
function coordOp(map) {
  return (ctx, node, X, Y) => {
    const n = ctx.n, X2 = pool.get(n), Y2 = pool.get(n);
    map(node.k, X, Y, X2, Y2, n);
    const r = E(ctx, node.a[0], X2, Y2);
    pool.put(X2); pool.put(Y2); return r;
  };
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fract = (v) => v - Math.floor(v);

// terminals
def('x', 0, [], 3, (ctx, n, X) => fill3(ctx, X));
def('y', 0, [], 3, (ctx, n, X, Y) => fill3(ctx, Y));
def('r', 0, [], 1.5, (ctx, nd, X, Y) => { const n = ctx.n, o = pool.get(3 * n); for (let i = 0; i < n; i++) o[i] = o[i + n] = o[i + 2 * n] = Math.sqrt(X[i] * X[i] + Y[i] * Y[i]); return o; });
def('th', 0, [], 0.7, (ctx, nd, X, Y) => { const n = ctx.n, o = pool.get(3 * n); for (let i = 0; i < n; i++) o[i] = o[i + n] = o[i + 2 * n] = Math.atan2(Y[i], X[i]) / Math.PI; return o; });
def('c', 0, [K.unit], 1, (ctx, nd) => pool.get(3 * ctx.n).fill(nd.k[0]));
def('v', 0, [K.unit, K.unit, K.unit], 1.5, (ctx, nd) => { const n = ctx.n, o = pool.get(3 * n); o.fill(nd.k[0], 0, n); o.fill(nd.k[1], n, 2 * n); o.fill(nd.k[2], 2 * n); return o; });
def('noise', 0, [K.freq, K.seed], 1, (ctx, nd, X, Y) => { const n = ctx.n, o = pool.get(3 * n), f = nd.k[0], s = nd.k[1] | 0; for (let i = 0; i < n; i++) o[i] = o[i + n] = o[i + 2 * n] = noise2(X[i] * f, Y[i] * f, s); return o; });
def('cnoise', 0, [K.freq, K.seed], 1, (ctx, nd, X, Y) => { const n = ctx.n, o = pool.get(3 * n), f = nd.k[0], s = nd.k[1] | 0; for (let c = 0; c < 3; c++) for (let i = 0; i < n; i++) o[i + c * n] = noise2(X[i] * f, Y[i] * f, s + c * 7919); return o; });
def('fbm', 0, [K.freq, K.seed], 0.8, (ctx, nd, X, Y) => { const n = ctx.n, o = pool.get(3 * n), f = nd.k[0], s = nd.k[1] | 0; for (let i = 0; i < n; i++) o[i] = o[i + n] = o[i + 2 * n] = fbm2(X[i] * f, Y[i] * f, s); return o; });

// unary pointwise
def('neg', 1, [], 0.2, pw1((a) => -a));
def('abs', 1, [], 0.6, pw1((a) => Math.abs(a)));
def('sin', 1, [K.freq, K.angle], 1.4, pw1((a, k) => Math.sin(a * k[0] + k[1])));
def('tanh', 1, [K.gain], 0.4, pw1((a, k) => Math.tanh(a * k[0])));
def('log', 1, [], 0.3, pw1((a) => Math.log(Math.abs(a) + 1e-4)));
def('exp', 1, [], 0.2, pw1((a) => Math.exp(clamp(a, -10, 10))));
def('sqrt', 1, [], 0.3, pw1((a) => Math.sqrt(Math.abs(a))));
def('sq', 1, [], 0.3, pw1((a) => a * a));
def('floor', 1, [K.levels], 0.4, pw1((a, k) => Math.floor(a * k[0]) / k[0]));
def('lum', 1, [], 0.3, (ctx, nd, X, Y) => { const a = E(ctx, nd.a[0], X, Y), l = lum(ctx, a); a.set(l, 0); a.set(l, ctx.n); a.set(l, 2 * ctx.n); pool.put(l); return a; });
def('hsv', 1, [], 0.8, (ctx, nd, X, Y) => {
  const a = E(ctx, nd.a[0], X, Y), n = ctx.n;
  for (let i = 0; i < n; i++) {
    const h = fract(a[i] * 0.5 + 0.5) * 6, s = clamp(a[i + n] * 0.5 + 0.5, 0, 1), v = clamp(a[i + 2 * n] * 0.5 + 0.5, 0, 1);
    const hi = Math.floor(h), f = h - hi, p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
    let r, g, b;
    switch (hi % 6) { case 0: r = v; g = t; b = p; break; case 1: r = q; g = v; b = p; break; case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break; case 4: r = t; g = p; b = v; break; default: r = v; g = p; b = q; }
    a[i] = r * 2 - 1; a[i + n] = g * 2 - 1; a[i + 2 * n] = b * 2 - 1;
  }
  return a;
});

// screen-space ops (act on the pixel grid of the image being evaluated)
function boxH(s, d, N, r) {
  const inv = 1 / (2 * r + 1), M = N - 1;
  for (let y = 0; y < N; y++) {
    const o = y * N; let acc = 0;
    for (let i = -r; i <= r; i++) acc += s[o + (i < 0 ? 0 : i > M ? M : i)];
    for (let x = 0; x < N; x++) { d[o + x] = acc * inv; const ad = x + r + 1, sb = x - r; acc += s[o + (ad > M ? M : ad)] - s[o + (sb < 0 ? 0 : sb)]; }
  }
}
function boxV(s, d, N, r) {
  const inv = 1 / (2 * r + 1), M = N - 1;
  for (let x = 0; x < N; x++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += s[(i < 0 ? 0 : i > M ? M : i) * N + x];
    for (let y = 0; y < N; y++) { d[y * N + x] = acc * inv; const ad = y + r + 1, sb = y - r; acc += s[(ad > M ? M : ad) * N + x] - s[(sb < 0 ? 0 : sb) * N + x]; }
  }
}
def('blur', 1, [K.radius], 0.5, (ctx, nd, X, Y) => {
  const a = E(ctx, nd.a[0], X, Y), N = ctx.N, n = ctx.n;
  const r = Math.round(nd.k[0] * N / 2 / 1.7);
  if (r < 1) return a;
  const tmp = pool.get(n);
  for (let c = 0; c < 3; c++) { const v = a.subarray(c * n, c * n + n); for (let p = 0; p < 3; p++) { boxH(v, tmp, N, r); boxV(tmp, v, N, r); } }
  pool.put(tmp); return a;
});
function grads(ctx, a, i, N) { // central differences in coordinate units at pixel i of a single channel
  const x = i % N, y = (i / N) | 0, M = N - 1, s = N / 4;
  const gx = (a[i - x + (x < M ? x + 1 : M)] - a[i - x + (x > 0 ? x - 1 : 0)]) * s;
  const gy = (a[(y > 0 ? y - 1 : 0) * N + x] - a[(y < M ? y + 1 : M) * N + x]) * s;
  return [gx, gy];
}
function gradOp(f) {
  return (ctx, nd, X, Y) => {
    const a = E(ctx, nd.a[0], X, Y), N = ctx.N, n = ctx.n, o = pool.get(3 * n);
    for (let c = 0; c < 3; c++) { const v = a.subarray(c * n, c * n + n); for (let i = 0; i < n; i++) { const g = grads(ctx, v, i, N); o[i + c * n] = f(g[0], g[1]); } }
    pool.put(a); return o;
  };
}
def('gmag', 1, [], 0.4, gradOp((gx, gy) => Math.sqrt(gx * gx + gy * gy) * 0.3));
def('gdir', 1, [], 0.3, gradOp((gx, gy) => Math.atan2(gy, gx) / Math.PI));
def('bump', 1, [K.angle], 0.5, (ctx, nd, X, Y) => {
  const a = E(ctx, nd.a[0], X, Y), N = ctx.N, n = ctx.n, l = lum(ctx, a);
  const lx = Math.cos(nd.k[0]) * 0.6, ly = Math.sin(nd.k[0]) * 0.6, lz = 0.8;
  for (let i = 0; i < n; i++) {
    const g = grads(ctx, l, i, N), nx = -g[0] * 0.15, ny = -g[1] * 0.15, inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
    const sh = 0.25 + 1.2 * Math.max(0, (nx * lx + ny * ly + lz) * inv);
    for (let c = 0; c < 3; c++) a[i + c * n] = (a[i + c * n] + 1) * sh - 1;
  }
  pool.put(l); return a;
});

// coordinate ops
def('rot', 1, [K.angle], 0.5, coordOp((k, X, Y, X2, Y2, n) => { const c = Math.cos(k[0]), s = Math.sin(k[0]); for (let i = 0; i < n; i++) { X2[i] = c * X[i] - s * Y[i]; Y2[i] = s * X[i] + c * Y[i]; } }));
def('xform', 1, [K.scale, K.unit, K.unit], 0.4, coordOp((k, X, Y, X2, Y2, n) => { for (let i = 0; i < n; i++) { X2[i] = X[i] * k[0] + k[1]; Y2[i] = Y[i] * k[0] + k[2]; } }));
def('polar', 1, [], 0.4, coordOp((k, X, Y, X2, Y2, n) => { for (let i = 0; i < n; i++) { X2[i] = Math.atan2(Y[i], X[i]) / Math.PI; Y2[i] = Math.sqrt(X[i] * X[i] + Y[i] * Y[i]) * 2 - 1; } }));
def('kal', 1, [K.segs], 0.4, coordOp((k, X, Y, X2, Y2, n) => {
  const seg = Math.PI * 2 / Math.round(k[0]);
  for (let i = 0; i < n; i++) { const r = Math.sqrt(X[i] * X[i] + Y[i] * Y[i]); let a = Math.atan2(Y[i], X[i]); a = a - seg * Math.floor(a / seg); a = Math.abs(a - seg / 2); X2[i] = r * Math.cos(a); Y2[i] = r * Math.sin(a); }
}));
def('tile', 1, [K.gain], 0.3, coordOp((k, X, Y, X2, Y2, n) => { const s = k[0]; for (let i = 0; i < n; i++) { X2[i] = fract((X[i] * s + 1) / 2) * 2 - 1; Y2[i] = fract((Y[i] * s + 1) / 2) * 2 - 1; } }));
def('swirl', 1, [K.unit], 0.4, coordOp((k, X, Y, X2, Y2, n) => { const w = k[0] * 6; for (let i = 0; i < n; i++) { const r = Math.sqrt(X[i] * X[i] + Y[i] * Y[i]), t = w * (1 - r), c = Math.cos(t), s = Math.sin(t); X2[i] = c * X[i] - s * Y[i]; Y2[i] = s * X[i] + c * Y[i]; } }));

// binary pointwise
def('add', 2, [], 1, pw2((a, b) => a + b));
def('sub', 2, [], 0.8, pw2((a, b) => a - b));
def('mul', 2, [], 1.2, pw2((a, b) => a * b));
def('div', 2, [], 0.5, pw2((a, b) => a / (Math.abs(b) < 1e-3 ? (b < 0 ? -1e-3 : 1e-3) : b)));
def('mod', 2, [], 0.5, pw2((a, b) => (Math.abs(b) < 1e-3 ? a : a - b * Math.floor(a / b))));
def('min', 2, [], 0.5, pw2((a, b) => (a < b ? a : b)));
def('max', 2, [], 0.5, pw2((a, b) => (a > b ? a : b)));
def('atan2', 2, [], 0.5, pw2((a, b) => Math.atan2(a, b) / Math.PI));
def('pow', 2, [], 0.3, pw2((a, b) => Math.pow(Math.abs(a) + 1e-6, clamp(b, -4, 4))));
def('and', 2, [], 0.3, pw2((a, b) => ((Math.floor(a * 16) & Math.floor(b * 16)) / 16)));
def('or', 2, [], 0.3, pw2((a, b) => ((Math.floor(a * 16) | Math.floor(b * 16)) / 16)));
def('xor', 2, [], 0.3, pw2((a, b) => ((Math.floor(a * 16) ^ Math.floor(b * 16)) / 16)));
function warpedNoise(color) {
  return (ctx, nd, X, Y) => {
    const n = ctx.n, ua = E(ctx, nd.a[0], X, Y), u = lum(ctx, ua); pool.put(ua);
    const va = E(ctx, nd.a[1], X, Y), v = lum(ctx, va); pool.put(va);
    const o = pool.get(3 * n), f = nd.k[0], s = nd.k[1] | 0;
    if (color) { for (let c = 0; c < 3; c++) for (let i = 0; i < n; i++) o[i + c * n] = noise2(u[i] * f, v[i] * f, s + c * 7919); }
    else for (let i = 0; i < n; i++) o[i] = o[i + n] = o[i + 2 * n] = noise2(u[i] * f, v[i] * f, s);
    pool.put(u); pool.put(v); return o;
  };
}
def('wnoise', 2, [K.freq, K.seed], 0.6, warpedNoise(false));
def('wcnoise', 2, [K.freq, K.seed], 0.6, warpedNoise(true));

// ternary
def('lerp', 3, [], 0.8, (ctx, nd, X, Y) => {
  const a = E(ctx, nd.a[0], X, Y), b = E(ctx, nd.a[1], X, Y), t = E(ctx, nd.a[2], X, Y);
  for (let i = 0, L = a.length; i < L; i++) { const w = clamp(t[i] * 0.5 + 0.5, 0, 1); a[i] += (b[i] - a[i]) * w; }
  pool.put(b); pool.put(t); return a;
});
def('if', 3, [], 0.5, (ctx, nd, X, Y) => {
  const ca = E(ctx, nd.a[0], X, Y), c = lum(ctx, ca); pool.put(ca);
  const a = E(ctx, nd.a[1], X, Y), b = E(ctx, nd.a[2], X, Y), n = ctx.n;
  for (let ch = 0; ch < 3; ch++) for (let i = 0; i < n; i++) if (!(c[i] > 0)) a[i + ch * n] = b[i + ch * n];
  pool.put(b); pool.put(c); return a;
});
def('vec', 3, [], 1, (ctx, nd, X, Y) => {
  const n = ctx.n, o = pool.get(3 * n);
  for (let ch = 0; ch < 3; ch++) { const a = E(ctx, nd.a[ch], X, Y); for (let i = 0; i < n; i++) o[i + ch * n] = (a[i] + a[i + n] + a[i + 2 * n]) * (1 / 3); pool.put(a); }
  return o;
});
def('warp', 3, [], 0.6, (ctx, nd, X, Y) => {
  const ua = E(ctx, nd.a[1], X, Y), u = lum(ctx, ua); pool.put(ua);
  const va = E(ctx, nd.a[2], X, Y), v = lum(ctx, va); pool.put(va);
  const r = E(ctx, nd.a[0], u, v); pool.put(u); pool.put(v); return r;
});
def('wrel', 3, [K.warpk], 0.8, (ctx, nd, X, Y) => {
  const n = ctx.n, k = nd.k[0];
  const ua = E(ctx, nd.a[1], X, Y), u = lum(ctx, ua); pool.put(ua);
  const va = E(ctx, nd.a[2], X, Y), v = lum(ctx, va); pool.put(va);
  for (let i = 0; i < n; i++) { u[i] = X[i] + k * u[i]; v[i] = Y[i] + k * v[i]; }
  const r = E(ctx, nd.a[0], u, v); pool.put(u); pool.put(v); return r;
});

// ---------- evaluation ----------
const grids = new Map();
function grid(N) {
  let g = grids.get(N);
  if (!g) {
    const n = N * N, X = new Float32Array(n), Y = new Float32Array(n);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { X[j * N + i] = (i + 0.5) / N * 2 - 1; Y[j * N + i] = 1 - (j + 0.5) / N * 2; }
    grids.set(N, g = { X, Y });
  }
  return g;
}
// Returns a pooled planar RGB Float32Array (length 3*N*N). Call release() when done with it.
function evaluate(tree, N) {
  const g = grid(N), ctx = { N, n: N * N };
  const o = E(ctx, tree, g.X, g.Y);
  for (let i = 0, L = o.length; i < L; i++) { const v = o[i]; o[i] = v === v ? (v > 1e4 ? 1e4 : v < -1e4 ? -1e4 : v) : 0; }
  return o;
}
const release = (b) => pool.put(b);
// planar values -> RGBA bytes (display mapping: [-1,1] -> [0,255])
function toRGBA(buf, N, out) {
  const n = N * N; out = out || new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) { out[i * 4] = (buf[i] + 1) * 127.5; out[i * 4 + 1] = (buf[i + n] + 1) * 127.5; out[i * 4 + 2] = (buf[i + 2 * n] + 1) * 127.5; out[i * 4 + 3] = 255; }
  return out;
}

// ---------- tree utilities ----------
function clone(t) { return { op: t.op, k: t.k.slice(), a: t.a.map(clone) }; }
function size(t) { let s = 1; for (const c of t.a) s += size(c); return s; }
function depth(t) { let d = 0; for (const c of t.a) d = Math.max(d, depth(c)); return d + 1; }
function collect(t, out = [], parent = null, idx = -1, d = 0) { out.push({ node: t, parent, idx, d }); t.a.forEach((c, i) => collect(c, out, t, i, d + 1)); return out; }
function pickWeighted(list) { let s = 0; for (const o of list) s += o.w; let r = rnd() * s; for (const o of list) { r -= o.w; if (r <= 0) return o; } return list[list.length - 1]; }
function makeNode(op, kids) { return { op: op.name, k: op.k.map((s) => s.gen()), a: kids }; }
function randTree(maxDepth = 4, d = 0) {
  const term = d >= maxDepth || (d > 0 && rnd() < 0.1 + 0.6 * d / maxDepth);
  const op = pickWeighted(term ? TERMS : FUNCS);
  return makeNode(op, Array.from({ length: op.arity }, () => randTree(maxDepth, d + 1)));
}
function jitterConsts(node, amt) {
  const spec = OPS[node.op].k;
  if (!spec.length) return false;
  const all = rnd() < 0.3;
  const j = randi(spec.length);
  for (let i = 0; i < spec.length; i++) if (all || i === j) node.k[i] = spec[i].mut(node.k[i], amt);
  return true;
}
function replaceAt(tree, entry, repl) { if (!entry.parent) return repl; entry.parent.a[entry.idx] = repl; return tree; }

function mutateOnce(t, amt) {
  const nodes = collect(t);
  const e = nodes[randi(nodes.length)];
  const r = rnd();
  if (r < 0.35) { // jitter constants of some node that has them
    const cands = nodes.filter((x) => x.node.k.length);
    if (cands.length) { jitterConsts(cands[randi(cands.length)].node, amt); return t; }
  }
  if (r < 0.50) return replaceAt(t, e, randTree(1 + randi(3), 0)); // new random subtree
  if (r < 0.66) { // change the function, keeping what arguments fit
    const old = e.node, oldOp = OPS[old.op];
    const pool_ = oldOp.arity === 0 ? TERMS : rnd() < 0.7 ? FUNCS.filter((o) => o.arity === oldOp.arity) : FUNCS;
    const op = pickWeighted(pool_);
    const kids = [];
    for (let i = 0; i < op.arity; i++) kids.push(i < old.a.length ? old.a[i] : old.a.length && rnd() < 0.5 ? clone(old.a[randi(old.a.length)]) : randTree(1 + randi(2), 0));
    const nn = makeNode(op, kids);
    if (op.k.length === old.k.length) nn.k = old.k.slice();
    return replaceAt(t, e, nn);
  }
  if (r < 0.78) { // node becomes an argument to a new function
    const op = pickWeighted(FUNCS), slot = randi(op.arity);
    const kids = Array.from({ length: op.arity }, (_, i) => (i === slot ? e.node : randTree(1 + randi(2), 0)));
    return replaceAt(t, e, makeNode(op, kids));
  }
  if (r < 0.88) { // an argument jumps out and replaces its node
    if (e.node.a.length) return replaceAt(t, e, e.node.a[randi(e.node.a.length)]);
    return replaceAt(t, e, randTree(2, 0));
  }
  // copy of another node in the tree
  const src = nodes[randi(nodes.length)].node;
  return replaceAt(t, e, clone(src));
}
function mutate(tree, amt = 0.5, maxNodes = 120) {
  for (let tries = 0; tries < 20; tries++) {
    let t = clone(tree);
    const m = 1 + poisson(amt * 1.5);
    for (let i = 0; i < m; i++) t = mutateOnce(t, amt);
    if (size(t) <= maxNodes) return t;
  }
  return clone(tree);
}
function crossover(a, b, maxNodes = 120) {
  for (let tries = 0; tries < 10; tries++) {
    const t = clone(a), nt = collect(t), nb = collect(b);
    const pick = (ns) => { const inner = ns.filter((x) => x.node.a.length); return inner.length && rnd() < 0.85 ? inner[randi(inner.length)] : ns[randi(ns.length)]; };
    const r = replaceAt(t, pick(nt), clone(pick(nb).node));
    if (size(r) <= maxNodes) return r;
  }
  return clone(a);
}

// ---------- text form: (op consts... children...) ----------
function fmtNum(v, prec) { if (Math.abs(v) < 1e-9) return '0'; return String(+v.toPrecision(prec)); }
function toString(t, prec = 7) {
  const op = OPS[t.op];
  if (t.op === 'c') return fmtNum(t.k[0], prec);
  if (!op.k.length && !t.a.length) return t.op;
  const parts = [t.op];
  op.k.forEach((s, i) => parts.push(s.int ? fmtInt(t.k[i]) : fmtNum(t.k[i], prec)));
  for (const c of t.a) parts.push(toString(c, prec));
  return '(' + parts.join(' ') + ')';
}
function pretty(t, prec = 3, ind = 0, width = 64) {
  const flat = toString(t, prec);
  if (flat.length + ind <= width || !t.a.length) return flat;
  const op = OPS[t.op];
  const head = '(' + [t.op].concat(op.k.map((s, i) => (s.int ? fmtInt(t.k[i]) : fmtNum(t.k[i], prec)))).join(' ');
  const pad = ' '.repeat(ind + 2);
  return head + t.a.map((c) => '\n' + pad + pretty(c, prec, ind + 2, width)).join('') + ')';
}
function parse(str) {
  const toks = str.replace(/[()]/g, (m) => ' ' + m + ' ').trim().split(/\s+/);
  let p = 0;
  const num = (s) => { const v = Number(s); if (!isFinite(v)) throw new Error('expected number, got "' + s + '"'); return v; };
  function node() {
    const t = toks[p++];
    if (t === undefined) throw new Error('unexpected end');
    if (t === '(') {
      const name = toks[p++], op = OPS[name];
      if (!op) throw new Error('unknown op "' + name + '"');
      const k = op.k.map(() => num(toks[p++]));
      const a = []; for (let i = 0; i < op.arity; i++) a.push(node());
      if (toks[p++] !== ')') throw new Error('expected ) after ' + name);
      return { op: name, k, a };
    }
    if (OPS[t]) { if (OPS[t].arity || OPS[t].k.length) throw new Error('"' + t + '" needs parentheses'); return { op: t, k: [], a: [] }; }
    return { op: 'c', k: [num(t)], a: [] };
  }
  const t = node();
  if (p !== toks.length) throw new Error('trailing text after expression');
  return t;
}

// ---------- signatures (for rejecting dull / duplicate mutants) ----------
function signature(tree, N = 20) {
  const b = evaluate(tree, N), s = new Float32Array(b.length);
  for (let i = 0; i < b.length; i++) s[i] = clamp(b[i] * 0.5 + 0.5, 0, 1);
  release(b); return s;
}
function sigStd(s) { let m = 0; for (const v of s) m += v; m /= s.length; let q = 0; for (const v of s) q += (v - m) * (v - m); return Math.sqrt(q / s.length); }
function sigDist(a, b) { let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]); return d / a.length; }

// Random genome that isn't a flat field.
function randomInteresting(maxDepth = 5) {
  for (let i = 0; i < 40; i++) { const t = randTree(3 + randi(maxDepth - 2)); if (sigStd(signature(t)) > 0.06) return t; }
  return randTree(maxDepth);
}
// n mutants of parent, each visibly different from the parent and from each other, none flat.
function mutants(parent, count, amt, maxNodes = 120) {
  const ps = signature(parent), out = [], sigs = [ps], strs = new Set([toString(parent)]);
  for (let tries = 0; out.length < count && tries < count * 40; tries++) {
    const c = mutate(parent, amt, maxNodes), str = toString(c);
    if (strs.has(str)) continue;
    const s = signature(c);
    const late = tries > count * 25; // relax the checks if this parent is hard to vary
    if (sigStd(s) < (late ? 0.005 : 0.03)) continue;
    if (!late && sigs.some((o) => sigDist(o, s) < 0.012)) continue;
    strs.add(str); sigs.push(s); out.push(c);
  }
  while (out.length < count) out.push(randomInteresting());
  return out;
}

// ---------- target matching ----------
function downsample(src, N) { // planar 3ch NxN -> (N/2)x(N/2)
  const M = N >> 1, n = N * N, m = M * M, o = new Float32Array(3 * m);
  for (let c = 0; c < 3; c++) for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
    const i = c * n + 2 * y * N + 2 * x;
    o[c * m + y * M + x] = (src[i] + src[i + 1] + src[i + N] + src[i + N + 1]) * 0.25;
  }
  return o;
}
// rgba: Uint8 RGBA NxN. Stores target in display space [0,1] plus a pyramid.
class Target {
  constructor(rgba, N) {
    this.N = N; const n = N * N, t = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) t[c * n + i] = rgba[i * 4 + c] / 255;
    this.levels = [t];
    for (let s = N; s >= 16 && this.levels.length < 4; s >>= 1) this.levels.push(downsample(this.levels[this.levels.length - 1], s));
  }
}
// Distance from tree to target, after the best per-channel affine colour fit (linear scaling).
// Returns {err, rmse, a, b} where display = clamp((a*v + b + 1)/2).
function distance(tree, target) {
  const N = target.N, n = N * N, v = evaluate(tree, N), t = target.levels[0];
  const A = [0, 0, 0], B = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    let sv = 0, st = 0, svv = 0, svt = 0;
    for (let i = c * n, e = i + n; i < e; i++) { const x = clamp(v[i], -3, 3), y = t[i] * 2 - 1; sv += x; st += y; svv += x * x; svt += x * y; }
    const mv = sv / n, mt = st / n, varv = svv / n - mv * mv, cov = svt / n - mv * mt;
    const a = varv > 1e-9 ? clamp(cov / varv, -20, 20) : 0;
    A[c] = a; B[c] = mt - a * mv;
  }
  const d = new Float32Array(3 * n);
  for (let c = 0; c < 3; c++) for (let i = c * n, e = i + n; i < e; i++) d[i] = clamp((A[c] * v[i] + B[c] + 1) * 0.5, 0, 1);
  release(v);
  let lv = d, s = N, err = 0, rmse = 0;
  for (let l = 0; l < target.levels.length; l++) {
    const T = target.levels[l]; let q = 0;
    for (let i = 0; i < lv.length; i++) { const e = lv[i] - T[i]; q += e * e; }
    q /= lv.length; if (l === 0) rmse = Math.sqrt(q);
    err += q;
    if (l + 1 < target.levels.length) { lv = downsample(lv, s); s >>= 1; }
  }
  return { err: err / target.levels.length, rmse, a: A, b: B };
}
// Fold a colour fit into the genome itself: (add (mul T (v a)) (v b)).
function bake(tree, a, b) {
  return { op: 'add', k: [], a: [{ op: 'mul', k: [], a: [clone(tree), { op: 'v', k: a.slice(), a: [] }] }, { op: 'v', k: b.slice(), a: [] }] };
}

// Steady-state GA with tournament selection, subtree crossover, Sims-style mutation,
// constant hill-climbing around the champion, and a small size penalty.
// Phenotype dedupe: two genomes whose error agrees to ~1e-5 are treated as the same image, so
// neutral variants (dead code, tiny constant changes) can't flood the population.
class Evolver {
  constructor(target, opts = {}) {
    this.target = target;
    this.popSize = opts.popSize || 60;
    this.maxNodes = opts.maxNodes || 80;
    this.parsimony = opts.parsimony != null ? opts.parsimony : 3e-5;
    this.dedupe = opts.dedupe !== false;
    this.tune = opts.tune != null ? opts.tune : 0.12;
    this.pop = []; this.strs = new Set(); this.keys = new Map();
    this.evals = 0; this.improvements = 0; this.best = null;
  }
  score(tree) {
    const d = distance(tree, this.target);
    this.evals++;
    return { tree, str: toString(tree), err: d.err, rmse: d.rmse, a: d.a, b: d.b, nodes: size(tree), fit: d.err + this.parsimony * size(tree), key: Math.round(d.err * 1e5) };
  }
  seed(trees) {
    for (const t of trees) { if (this.pop.length >= this.popSize) break; this.add(this.score(t)); }
    for (let i = 0; this.pop.length < this.popSize && i < this.popSize * 20; i++) this.add(this.score(randomInteresting(5)));
    this.updateBest();
  }
  add(ind) {
    if (this.strs.has(ind.str) || (this.dedupe && this.keys.has(ind.key))) return false;
    this.pop.push(ind); this.strs.add(ind.str); if (this.dedupe) this.keys.set(ind.key, ind); return true;
  }
  swap(old, ind) {
    this.pop[this.pop.indexOf(old)] = ind;
    this.strs.delete(old.str); this.strs.add(ind.str);
    if (this.dedupe) { this.keys.delete(old.key); this.keys.set(ind.key, ind); }
    if (ind.fit < this.best.fit) { this.best = ind; this.improvements++; } else if (old === this.best) this.updateBest();
  }
  updateBest() { let b = this.pop[0]; for (const p of this.pop) if (p.fit < b.fit) b = p; if (b !== this.best) { this.best = b; this.improvements++; } }
  tour(k = 3) { let b = null; for (let i = 0; i < k; i++) { const p = this.pop[randi(this.pop.length)]; if (!b || p.fit < b.fit) b = p; } return b; }
  child() {
    const r = rnd();
    if (r < this.tune) { const t = clone(this.best.tree), ns = collect(t).filter((x) => x.node.k.length); if (ns.length) { jitterConsts(ns[randi(ns.length)].node, 0.3); return t; } }
    if (r < this.tune + 0.3) { const c = crossover(this.tour().tree, this.tour().tree, this.maxNodes); return rnd() < 0.4 ? mutate(c, 0.4, this.maxNodes) : c; }
    if (r < 0.96) return mutate(this.tour().tree, 0.5, this.maxNodes);
    return randomInteresting(5);
  }
  step(budgetMs = 20) {
    const t0 = now();
    let n = 0;
    do {
      const t = this.child(), str = toString(t);
      if (this.strs.has(str)) continue;
      const ind = this.score(t); n++;
      if (this.dedupe) {
        const twin = this.keys.get(ind.key);
        if (twin) { if (ind.fit < twin.fit) this.swap(twin, ind); continue; } // same image: keep the smaller genome
      }
      // replace the worst of a random handful if the child beats it
      let w = null; for (let i = 0; i < 4; i++) { const p = this.pop[randi(this.pop.length)]; if (!w || p.fit > w.fit) w = p; }
      if (ind.fit < w.fit) this.swap(w, ind);
    } while (now() - t0 < budgetMs);
    return n;
  }
  sorted() { return this.pop.slice().sort((a, b) => a.fit - b.fit); }
  baked(ind) { return bake(ind.tree, ind.a, ind.b); }
}
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const GP = { OPS, TERMS, FUNCS, evaluate, release, toRGBA, randTree, randomInteresting, mutate, mutants, crossover, clone, size, depth,
  toString, pretty, parse, signature, sigStd, sigDist, Target, distance, bake, Evolver, noise2,
  setRandom: (f) => { rnd = f; }, seedRandom: (s) => { rnd = mulberry32(s); }, useMathRandom: () => { rnd = Math.random; } };
if (typeof module !== 'undefined' && module.exports) module.exports = GP; else root.GP = GP;
})(typeof self !== 'undefined' ? self : this);
