// Movie maker: turns a recorded sequence of genomes (the interactive lineage, or every new best
// of an auto-evolve run) into a video. Frames are rendered one at a time at full quality and
// encoded with WebCodecs H.264 into an MP4 (muxed here, no libraries), so slow frames never
// make the video stutter. Browsers without WebCodecs fall back to MediaRecorder in real time.
(function (root) {
'use strict';
const $ = (id) => document.getElementById(id);
let H = null; // hooks from app.js: { GP, drawTree, saveFile, stamp, toast, reels(), target(), pause(), resume(state) }

// ---------- genome interpolation ----------
// Two genomes with the same tree shape can be morphed smoothly by interpolating their constants;
// auto-evolve's successive bests often differ only that way (constant tuning, colour fit).
function shapeKey(t) { return t.op + (t.o ? '@' : '') + (t.a.length ? '(' + t.a.map(shapeKey).join(',') + ')' : ''); }
function lerpTree(A, B, u) {
  const spec = H.GP.OPS[A.op].k;
  return { op: A.op,
    k: A.k.map((v, i) => { const x = v + (B.k[i] - v) * u; return spec[i] && spec[i].int ? Math.round(x) : x; }),
    a: A.a.map((c, i) => lerpTree(c, B.a[i], u)),
    ...(A.o && B.o ? { o: [A.o[0] + (B.o[0] - A.o[0]) * u, A.o[1] + (B.o[1] - A.o[1]) * u] } : {}) };
}
const ease = (u) => u * u * (3 - 2 * u);
const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h || w; return c; };

// ---------- planning ----------
function thinIdx(n, k) { // k indices spread evenly over 0..n-1, always first and last
  if (n <= k) return Array.from({ length: n }, (_, i) => i);
  const out = []; for (let i = 0; i < k; i++) out.push(Math.round(i * (n - 1) / (k - 1)));
  return out;
}
function options() {
  return { src: $('mvSrc').value, sec: +$('mvSec').value, max: +$('mvMax').value, trans: $('mvTr').value,
    size: +$('mvSize').value, fps: +$('mvFps').value, withTarget: $('mvTgt').checked, captions: $('mvCap').checked };
}
function plan(o) {
  const reel = H.reels()[o.src] || [];
  const extra = 2; // seconds of extra hold on the first and last image
  const k = Math.max(2, Math.floor((o.max - extra) / o.sec) + 1);
  const idx = thinIdx(reel.length, k);
  const steps = [];
  for (const i of idx) {
    let tree; try { tree = H.GP.parse(reel[i].s); } catch (e) { continue; } // e.g. a stored genome using a since-renamed op
    steps.push({ tree, shape: shapeKey(tree), cap: reel[i].cap, i });
  }
  const per = Math.max(1, Math.round(o.sec * o.fps));
  const tr = o.trans === 'cut' || steps.length < 2 ? 0 : Math.max(1, Math.round(per * 0.55));
  const hold = per - tr, endHold = Math.round(o.fps * extra / 2);
  const total = steps.length ? steps.length * hold + (steps.length - 1) * tr + 2 * endHold : 0;
  const tgt = o.src === 'run' && o.withTarget ? H.target() : null;
  const S = o.size, W = tgt ? 2 * S : S;
  return { o, reel, steps, hold, tr, endHold, total, tgt, S, W, Hh: S };
}

// ---------- frame rendering ----------
function compose(p, g, a, b, u, step, S) {
  const x0 = p.tgt ? S : 0, W = p.tgt ? 2 * S : S;
  g.globalAlpha = 1; g.fillStyle = '#000'; g.fillRect(0, 0, W, S);
  if (p.tgt) { g.imageSmoothingQuality = 'high'; g.drawImage(p.tgt, 0, 0, S, S); }
  g.drawImage(a, x0, 0, S, S);
  if (b && u > 0) { g.globalAlpha = u; g.drawImage(b, x0, 0, S, S); g.globalAlpha = 1; }
  if (!p.o.captions) return;
  const fs = Math.max(11, Math.round(S * 0.032)), pad = Math.round(fs * 0.6);
  g.font = `${fs}px ui-monospace, Menlo, monospace`; g.textBaseline = 'alphabetic';
  const label = (txt, x, right) => {
    const w = g.measureText(txt).width + 2 * pad, h = fs + 2 * pad, y = S - h - pad;
    const bx = right ? x - w - pad : x + pad;
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(bx, y, w, h);
    g.fillStyle = '#f2efe6'; g.fillText(txt, bx + pad, y + pad + fs * 0.82);
  };
  if (step && step.cap) label(step.cap, x0, false);
  if (p.tgt) label('target', 0, false);
}
// Renders every frame of the plan at size S into one canvas and hands it to sink(canvas, index).
async function renderFrames(p, S, sink, cancelled) {
  const steps = p.steps, out = mkCanvas(p.tgt ? 2 * S : S, S), g = out.getContext('2d');
  let a = mkCanvas(S), b = mkCanvas(S); const m = mkCanvas(S);
  let f = 0;
  const emit = async () => { await sink(out, f++); if (cancelled()) throw new Error('cancelled'); };
  H.drawTree(steps[0].tree, a);
  for (let i = 0; i < steps.length; i++) {
    const A = steps[i], last = i === steps.length - 1;
    const n = p.hold + (i === 0 ? p.endHold : 0) + (last ? p.endHold : 0);
    compose(p, g, a, null, 0, A, S);
    for (let j = 0; j < n; j++) await emit();
    if (last) break;
    const B = steps[i + 1], morph = p.o.trans === 'morph' && A.shape === B.shape;
    if (!morph || !p.tr) H.drawTree(B.tree, b);
    for (let j = 1; j <= p.tr; j++) {
      const u = ease(j / (p.tr + 1));
      if (morph) { H.drawTree(lerpTree(A.tree, B.tree, u), m); compose(p, g, m, null, 0, u < 0.5 ? A : B, S); }
      else compose(p, g, a, b, u, u < 0.5 ? A : B, S);
      await emit();
    }
    if (morph && p.tr) H.drawTree(B.tree, b);
    const t = a; a = b; b = t;
  }
  return f;
}

// ---------- MP4 (ISO BMFF) muxer for one H.264 track ----------
const u16 = (n) => [(n >> 8) & 255, n & 255];
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const ascii = (s) => Array.from(s, (c) => c.charCodeAt(0));
function box(type, ...parts) {
  let len = 8; for (const q of parts) len += q.length;
  const out = new Uint8Array(len); out.set(u32(len), 0); out.set(ascii(type), 4);
  let off = 8; for (const q of parts) { out.set(q, off); off += q.length; }
  return out;
}
const fullBox = (type, v, flags, ...parts) => box(type, [v, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...parts);
function muxMP4(chunks, W, Hh, fps, avcC) {
  const n = chunks.length, timescale = fps * 1000, delta = 1000, dur = n * delta;
  const matrix = [].concat(u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000));
  const ftyp = box('ftyp', ascii('isom'), u32(512), ascii('isomiso2avc1mp41'));
  let dataLen = 0; for (const c of chunks) dataLen += c.d.length;
  const mdatHead = new Uint8Array([].concat(u32(8 + dataLen), ascii('mdat')));
  const avc1 = box('avc1', new Array(6).fill(0), u16(1), new Array(16).fill(0), u16(W), u16(Hh), u32(0x480000), u32(0x480000),
    u32(0), u16(1), new Array(32).fill(0), u16(0x18), u16(0xffff), box('avcC', avcC));
  const keys = []; chunks.forEach((c, i) => { if (c.key) keys.push(i + 1); });
  const sizes = new Uint8Array(4 * n); chunks.forEach((c, i) => sizes.set(u32(c.d.length), 4 * i));
  const keyBytes = new Uint8Array(4 * keys.length); keys.forEach((k, i) => keyBytes.set(u32(k), 4 * i));
  const stbl = box('stbl',
    fullBox('stsd', 0, 0, u32(1), avc1),
    fullBox('stts', 0, 0, u32(1), u32(n), u32(delta)),
    fullBox('stss', 0, 0, u32(keys.length), keyBytes),
    fullBox('stsc', 0, 0, u32(1), u32(1), u32(n), u32(1)),
    fullBox('stsz', 0, 0, u32(0), u32(n), sizes),
    fullBox('stco', 0, 0, u32(1), u32(ftyp.length + 8)));
  const minf = box('minf', fullBox('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0)),
    box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1))), stbl);
  const mdia = box('mdia',
    fullBox('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(dur), u16(0x55c4), u16(0)),
    fullBox('hdlr', 0, 0, u32(0), ascii('vide'), u32(0), u32(0), u32(0), ascii('Genetic Images'), [0]), minf);
  const tkhd = fullBox('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(dur), u32(0), u32(0), u16(0), u16(0), u16(0), u16(0),
    matrix, u32(W * 65536), u32(Hh * 65536));
  const mvhd = fullBox('mvhd', 0, 0, u32(0), u32(0), u32(timescale), u32(dur), u32(0x10000), u16(0x100), u16(0), u32(0), u32(0),
    matrix, new Array(24).fill(0), u32(2));
  const moov = box('moov', mvhd, box('trak', tkhd, mdia));
  return new Blob([ftyp, mdatHead].concat(chunks.map((c) => c.d), [moov]), { type: 'video/mp4' });
}

// Baseline profile first: it never uses B-frames, so decode order = display order and no ctts box is needed.
const AVC_CODECS = ['avc1.42E033', 'avc1.42E02A', 'avc1.42E028', 'avc1.4D0033', 'avc1.640033'];
async function pickEncoder(W, Hh, fps) {
  if (typeof VideoEncoder === 'undefined') return null;
  const bitrate = Math.round(Math.min(40e6, Math.max(2e6, W * Hh * fps * 0.25)));
  for (const codec of AVC_CODECS) {
    const cfg = { codec, width: W, height: Hh, bitrate, framerate: fps, avc: { format: 'avc' } };
    try { const s = await VideoEncoder.isConfigSupported(cfg); if (s && s.supported) return cfg; } catch (e) { /* try next */ }
  }
  return null;
}
const bytesOf = (x) => (ArrayBuffer.isView(x) ? new Uint8Array(x.buffer, x.byteOffset, x.byteLength) : new Uint8Array(x)).slice();
const tick = () => new Promise((r) => setTimeout(r, 0));

async function encodeMP4(p, cfg, progress, cancelled) {
  const chunks = []; let avcC = null, failure = null;
  const enc = new VideoEncoder({
    output: (chunk, meta) => {
      if (meta && meta.decoderConfig && meta.decoderConfig.description) avcC = bytesOf(meta.decoderConfig.description);
      const d = new Uint8Array(chunk.byteLength); chunk.copyTo(d); chunks.push({ d, key: chunk.type === 'key' });
    },
    error: (e) => { failure = e; },
  });
  enc.configure(cfg);
  const us = 1e6 / p.o.fps, gop = p.o.fps * 2;
  try {
    await renderFrames(p, p.S, async (canvas, f) => {
      if (failure) throw failure;
      const vf = new VideoFrame(canvas, { timestamp: Math.round(f * us), duration: Math.round(us) });
      enc.encode(vf, { keyFrame: f % gop === 0 }); vf.close();
      while (enc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 2));
      if (f % 3 === 0) { progress(f, canvas); await tick(); }
    }, cancelled);
    await enc.flush();
  } finally { if (enc.state !== 'closed') enc.close(); }
  if (failure) throw failure;
  if (!avcC) throw new Error('encoder gave no avcC');
  return muxMP4(chunks, p.W, p.Hh, p.o.fps, avcC);
}
// Fallback: real-time MediaRecorder capture of the frame canvas (WebM in Chrome/Firefox, MP4 in Safari).
async function encodeRecorder(p, progress, cancelled) {
  const types = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  const type = types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
  if (!type) throw new Error('this browser cannot record video');
  let rec = null, track = null, t0 = 0; const parts = [];
  await renderFrames(p, p.S, async (canvas, f) => {
    if (!rec) {
      const stream = canvas.captureStream(0); track = stream.getVideoTracks()[0];
      rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: Math.min(25e6, p.W * p.Hh * p.o.fps * 0.25) });
      rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
      rec.start(1000); t0 = performance.now();
    }
    const due = t0 + f * 1000 / p.o.fps;
    while (performance.now() < due) await new Promise((r) => setTimeout(r, Math.max(0, due - performance.now())));
    track.requestFrame();
    if (f % 3 === 0) progress(f, canvas);
  }, cancelled);
  await new Promise((r) => setTimeout(r, 1000 / p.o.fps));
  await new Promise((r) => { rec.onstop = r; rec.stop(); });
  return new Blob(parts, { type: type.split(';')[0] });
}

// ---------- dialog ----------
let busy = null; // { cancel: bool }
function refreshInfo() {
  const o = options(), reels = H.reels();
  for (const opt of $('mvSrc').options) {
    const n = (reels[opt.value] || []).length;
    opt.textContent = (opt.value === 'run' ? 'Auto-evolve run' : 'Interactive lineage') + ` (${n} image${n === 1 ? '' : 's'})`;
  }
  $('mvTgtRow').classList.toggle('hidden', o.src !== 'run');
  const p = plan(o), n = p.reel.length;
  const ok = n >= 2;
  $('mvPlay').disabled = $('mvMake').disabled = !ok || !!busy;
  if (!ok) {
    $('mvInfo').textContent = o.src === 'run'
      ? 'Nothing recorded yet: run auto-evolve and every new best is kept for the movie.'
      : 'Nothing recorded yet: pick a few images in Interactive mode and each new centre is kept for the movie.';
    return;
  }
  const what = o.src === 'run' ? 'improvements' : 'centres';
  const used = p.steps.length < n ? `${p.steps.length} spread evenly through them (raise the length or shorten the step time to use more)` : `all ${n}`;
  const morphs = o.trans === 'morph' ? p.steps.slice(1).filter((s, i) => s.shape === p.steps[i].shape).length : 0;
  $('mvInfo').textContent = `${n} ${what} recorded; using ${used}. ` +
    `${(p.total / o.fps).toFixed(1)} s at ${p.W}×${p.Hh}, ${p.total} frames.` +
    (o.trans === 'morph' ? ` ${morphs} of ${p.steps.length - 1} changes can morph smoothly (same tree shape); the rest crossfade.` : '');
}
function setBusy(b) {
  busy = b;
  for (const id of ['mvSrc', 'mvSec', 'mvMax', 'mvTr', 'mvSize', 'mvFps', 'mvTgt', 'mvCap']) $(id).disabled = !!b;
  $('mvStop').disabled = !b; refreshInfo();
}
function previewDraw(canvas) {
  const pv = $('mvPrev'), g = pv.getContext('2d');
  if (pv.width !== canvas.width || pv.height !== canvas.height) { pv.width = canvas.width; pv.height = canvas.height; }
  g.drawImage(canvas, 0, 0);
}
async function preview() {
  const o = options(), p = plan(o); if (p.steps.length < 2) return;
  const job = { cancel: false }, resume = H.pause(); setBusy(job);
  const S = Math.min(p.S, 360), t0 = performance.now();
  try {
    await renderFrames(p, S, async (canvas, f) => {
      previewDraw(canvas);
      $('mvProg').textContent = `preview ${(f / o.fps).toFixed(1)} / ${(p.total / o.fps).toFixed(1)} s`;
      const due = t0 + (f + 1) * 1000 / o.fps;
      await new Promise((r) => setTimeout(r, Math.max(0, due - performance.now())));
    }, () => job.cancel);
    $('mvProg').textContent = 'preview finished';
  } catch (e) { $('mvProg').textContent = job.cancel ? 'stopped' : 'preview failed: ' + e.message; }
  setBusy(null); H.resume(resume);
}
async function make() {
  const o = options(), p = plan(o); if (p.steps.length < 2) return;
  const job = { cancel: false }, resume = H.pause(); setBusy(job);
  const t0 = performance.now();
  const progress = (f, canvas) => {
    previewDraw(canvas);
    const el = (performance.now() - t0) / 1000, eta = f > 0 ? el * (p.total - f) / f : 0;
    $('mvProg').textContent = `rendering frame ${f} / ${p.total}  (${Math.round(100 * f / p.total)}%, ~${Math.ceil(eta)} s left)`;
  };
  try {
    const cfg = await pickEncoder(p.W, p.Hh, o.fps);
    const blob = cfg ? await encodeMP4(p, cfg, progress, () => job.cancel) : await encodeRecorder(p, progress, () => job.cancel);
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    $('mvProg').textContent = `done: ${(blob.size / 1e6).toFixed(1)} MB ${ext.toUpperCase()}, ${(p.total / o.fps).toFixed(1)} s` +
      (cfg ? '' : ' (recorded in real time; this browser has no WebCodecs H.264 encoder)');
    root.Movie.last = blob;
    await H.saveFile(blob, 'genetic-images-' + (o.src === 'run' ? 'evolution' : 'lineage') + '-' + H.stamp() + '.' + ext);
  } catch (e) { $('mvProg').textContent = job.cancel ? 'stopped' : 'failed: ' + (e && e.message || e); }
  setBusy(null); H.resume(resume);
}
function open(src) {
  if (src) $('mvSrc').value = src;
  $('movie').classList.remove('hidden');
  $('mvProg').textContent = '';
  refreshInfo();
  // show the last image of the reel as a poster frame
  const p = plan(options());
  if (p.steps.length) {
    const S = Math.min(p.S, 360), c = mkCanvas(p.tgt ? 2 * S : S, S), a = mkCanvas(S); const s = p.steps[p.steps.length - 1];
    H.drawTree(s.tree, a); compose(p, c.getContext('2d'), a, null, 0, s, S); previewDraw(c);
  } else { const pv = $('mvPrev'); pv.getContext('2d').clearRect(0, 0, pv.width, pv.height); }
}
function close() { if (busy) busy.cancel = true; $('movie').classList.add('hidden'); }
function init(hooks) {
  H = hooks;
  for (const id of ['mvSrc', 'mvSec', 'mvMax', 'mvTr', 'mvSize', 'mvFps', 'mvTgt', 'mvCap']) $(id).onchange = () => (id === 'mvSrc' ? open() : refreshInfo());
  $('mvPlay').onclick = preview;
  $('mvMake').onclick = make;
  $('mvStop').onclick = () => { if (busy) busy.cancel = true; };
  $('mvClose').onclick = close;
  $('mvStop').disabled = true;
}
root.Movie = { init, open, close, isOpen: () => !$('movie').classList.contains('hidden'), muxMP4, shapeKey, lerpTree, thinIdx, plan, options };
})(window);
