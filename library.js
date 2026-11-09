// Run library: every interactive lineage and every auto-evolve run is saved automatically
// (IndexedDB, falling back to localStorage, then memory) and can be browsed later. Any image of
// any run can be recovered: bred from interactively, evolved further toward the run's target,
// used as a target, saved, or the whole run turned into a movie.
(function (root) {
'use strict';
const $ = (id) => document.getElementById(id);
let H = null; // hooks from app.js

// ---------- storage ----------
// Two stores: 'meta' (small summaries for the list) and 'runs' (full records with every genome).
const store = { mode: 'memory', db: null, mem: new Map(), memMeta: new Map() };
const metaOf = (r) => ({ id: r.id, kind: r.kind, title: r.title, targetName: r.targetName || '', created: r.created, updated: r.updated,
  n: r.steps.length, last: r.steps[r.steps.length - 1].s, parent: r.parent || null, hasTarget: !!r.target,
  nodes: r.nodes ? r.nodes.length : r.steps.length, ends: r.nodes ? leafCount(r.nodes) : 1, sig: sigOf(r) });
const sigOf = (r) => r.sig || r.steps.length + '|' + r.steps[r.steps.length - 1].s;
function leafCount(nodes) { const hasKid = new Uint8Array(nodes.length); for (const n of nodes) if (n.p >= 0) hasKid[n.p] = 1; let k = 0; for (let i = 0; i < nodes.length; i++) if (!hasKid[i]) k++; return k; }
// Any run as a tree: interactive runs store nodes; auto runs (and older saves) are a single chain.
function toTree(r) {
  if (r.nodes && r.nodes.length) return { nodes: r.nodes, head: r.head >= 0 && r.head < r.nodes.length ? r.head : r.nodes.length - 1 };
  return { nodes: r.steps.map((st, i) => ({ p: i - 1, d: i, s: st.s, cap: st.cap, grid: null })), head: r.steps.length - 1 };
}
function idbReq(req) { return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); }); }
async function openStore() {
  try {
    const req = indexedDB.open('genetic-images', 1);
    req.onupgradeneeded = () => { const db = req.result; db.createObjectStore('runs', { keyPath: 'id' }); db.createObjectStore('meta', { keyPath: 'id' }); };
    store.db = await idbReq(req); store.mode = 'idb'; return;
  } catch (e) { /* sandboxed or disabled */ }
  try { localStorage.setItem('gi.t', '1'); localStorage.removeItem('gi.t'); store.mode = 'local'; } catch (e) { store.mode = 'memory'; }
}
function tx(names, mode) { return store.db.transaction(names, mode); }
async function put(rec) {
  const meta = metaOf(rec);
  if (store.mode === 'idb') {
    const t = tx(['runs', 'meta'], 'readwrite'); t.objectStore('runs').put(rec); t.objectStore('meta').put(meta);
    await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  } else if (store.mode === 'local') {
    localStorage.setItem('gi.run.' + rec.id, JSON.stringify(rec));
    const idx = JSON.parse(localStorage.getItem('gi.runs') || '{}'); idx[rec.id] = meta; localStorage.setItem('gi.runs', JSON.stringify(idx));
  } else { store.mem.set(rec.id, JSON.parse(JSON.stringify(rec))); store.memMeta.set(rec.id, meta); }
}
async function listMeta() {
  let all;
  if (store.mode === 'idb') all = await idbReq(tx(['meta'], 'readonly').objectStore('meta').getAll());
  else if (store.mode === 'local') all = Object.values(JSON.parse(localStorage.getItem('gi.runs') || '{}'));
  else all = [...store.memMeta.values()];
  return all.sort((a, b) => b.updated - a.updated);
}
async function getRun(id) {
  if (store.mode === 'idb') return idbReq(tx(['runs'], 'readonly').objectStore('runs').get(id));
  if (store.mode === 'local') return JSON.parse(localStorage.getItem('gi.run.' + id) || 'null');
  return store.mem.get(id) || null;
}
async function del(id) {
  if (store.mode === 'idb') {
    const t = tx(['runs', 'meta'], 'readwrite'); t.objectStore('runs').delete(id); t.objectStore('meta').delete(id);
    await new Promise((res) => { t.oncomplete = res; t.onerror = res; });
  } else if (store.mode === 'local') {
    localStorage.removeItem('gi.run.' + id);
    const idx = JSON.parse(localStorage.getItem('gi.runs') || '{}'); delete idx[id]; localStorage.setItem('gi.runs', JSON.stringify(idx));
  } else { store.mem.delete(id); store.memMeta.delete(id); }
}

// ---------- autosave ----------
// app.js reports its live runs (the current lineage and auto-evolve run); anything that changed
// since the last save is written every few seconds and when the page is hidden.
const savedSig = new Map(), deleted = new Set();
let saving = false, warned = false;
async function flush() {
  if (saving || !H) return; saving = true;
  try {
    for (const r of H.live()) {
      if (!r || r.steps.length < 2 || deleted.has(r.id)) continue;
      const sig = sigOf(r);
      if (savedSig.get(r.id) === sig) continue;
      r.updated = Date.now();
      try { await put(r); savedSig.set(r.id, sig); }
      catch (e) { if (!warned) { warned = true; H.toast('Could not auto-save runs: ' + (e && e.name === 'QuotaExceededError' ? 'storage is full, delete some runs' : e && e.message || e)); } }
    }
  } finally { saving = false; }
  if (isOpen()) refreshList();
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---------- thumbnails ----------
const thumbQ = []; let thumbBusy = false;
function queueThumb(canvas, s) { thumbQ.push({ canvas, s }); if (!thumbBusy) { thumbBusy = true; setTimeout(pumpThumbs, 0); } }
function pumpThumbs() {
  const t0 = performance.now();
  while (thumbQ.length && performance.now() - t0 < 12) {
    const j = thumbQ.shift();
    if (!j.canvas.isConnected) continue;
    try { H.drawTree(H.GP.parse(j.s), j.canvas); } catch (e) { /* unparsable */ }
  }
  if (thumbQ.length) setTimeout(pumpThumbs, 0); else thumbBusy = false;
}
const mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const fmtDate = (t) => { const d = new Date(t); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); };

// ---------- browser ----------
// A run is shown as a tree (interactive sessions branch whenever you go back and pick differently).
// `sel` is the selected node; the path runs from the root through sel and on down the most recent
// branch. Each node's grid of nine is shown: ↳ tiles were taken (click to follow that branch), the
// others can be picked to start a new branch from there.
let cur = null, T = null, sel = 0, selTile = 4, path = [], metas = [];
const STRIP_MAX = 240; // path thumbnails shown; the slider reaches every step
async function refreshList() {
  metas = await listMeta();
  const live = new Set(H.live().filter(Boolean).map((r) => r.id));
  const list = $('libList'); list.textContent = '';
  $('libInfo').textContent = `${metas.length} saved run${metas.length === 1 ? '' : 's'} · ` +
    (store.mode === 'idb' ? 'kept in this browser (IndexedDB)' : store.mode === 'local' ? 'kept in this browser (localStorage, limited space)' : 'storage unavailable here: runs last until the page closes, so export them');
  for (const m of metas) {
    const row = mk('div', 'librow' + (cur && cur.id === m.id ? ' on' : ''));
    const c = mk('canvas'); c.width = c.height = 48; queueThumb(c, m.last);
    const txt = mk('div', 'libtxt');
    txt.append(mk('div', 'libt', (m.kind === 'run' ? '⚙ ' : '✋ ') + m.title));
    const size = (m.nodes || m.n) + ' images' + ((m.ends || 1) > 1 ? ` · ${m.ends} branches` : '');
    txt.append(mk('div', 'libs', `${size} · ${fmtDate(m.updated)}${live.has(m.id) ? ' · ● recording' : ''}`));
    row.append(c, txt); row.onclick = () => select(m.id);
    list.append(row);
  }
  if (!metas.length) list.append(mk('div', 'help', 'No runs yet. Pick images in Interactive mode or run auto-evolve: both save themselves here.'));
}
async function select(id, node) {
  let r = await getRun(id); if (!r) return;
  const live = H.live().find((x) => x && x.id === id); if (live) r = Object.assign({}, r, live); // newest state of a run being recorded
  cur = r; const t = toTree(r);
  const kids = t.nodes.map(() => []); t.nodes.forEach((n, i) => { if (n.p >= 0) kids[n.p].push(i); });
  T = { nodes: t.nodes, kids, head: t.head };
  $('libDel').textContent = 'Delete run'; $('libDel').dataset.armed = '';
  const i = metas.findIndex((m) => m.id === id);
  [...$('libList').children].forEach((row, j) => row.classList.toggle('on', j === i));
  $('libTitle').textContent = r.title + (r.parent ? `  (branched from ${r.parent.title} at image ${r.parent.step + 1})` : '');
  $('libDetail').classList.remove('hidden'); $('libEmpty').classList.add('hidden');
  layoutTree();
  const isTree = r.kind === 'lineage';
  $('libResume').classList.toggle('hidden', !isTree);
  $('libContinue').classList.toggle('hidden', !r.target);
  go(node != null ? node : T.head, true);
}
// Path through node i: its ancestors, then down the most recent child each time.
function pathThrough(i) {
  const up = []; for (let j = i; j >= 0; j = T.nodes[j].p) up.push(j); up.reverse();
  for (let j = i; T.kids[j].length;) { const k = T.kids[j]; const n = T.nodes[j]; j = k.includes(n.last) ? n.last : k[k.length - 1]; up.push(j); }
  return up;
}
function go(i, rebuildStrip) {
  if (!T || !T.nodes[i]) return;
  const newPath = path.includes(i) && !rebuildStrip ? path : pathThrough(i);
  const changed = newPath !== path; path = newPath; sel = i; selTile = 4;
  if (changed || rebuildStrip) buildStrip();
  const pos = path.indexOf(sel);
  $('libK').max = path.length - 1; $('libK').value = pos;
  $('libPos').textContent = `step ${pos + 1} of ${path.length}` + (T.kids[sel].length > 1 ? ` · ${T.kids[sel].length} branches from here` : '');
  for (const c of $('libStrip').children) c.classList.toggle('on', +c.dataset.k === sel);
  const on = $('libStrip').querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  drawTreeSvg(); showNode();
}
function buildStrip() {
  const strip = $('libStrip'); strip.textContent = '';
  const idx = H.Movie.thinIdx(path.length, STRIP_MAX);
  for (const j of idx) {
    const k = path[j], n = T.nodes[k], w = mk('div', 'lth'); w.dataset.k = k;
    const c = mk('canvas'); c.width = c.height = 64; queueThumb(c, n.s);
    w.title = `step ${j + 1}: ${n.cap || ''}`; w.append(c);
    if (T.kids[k].length > 1) w.append(mk('span', 'fork', '⑂' + T.kids[k].length));
    w.onclick = () => go(k); strip.append(w);
  }
  $('libStripNote').textContent = path.length > idx.length ? `showing ${idx.length} of ${path.length} steps on this branch; the slider reaches every one` : '';
}
function showNode() {
  const n = T.nodes[sel], g = $('libGrid'); g.textContent = '';
  const takenBy = new Map(); for (const k of T.kids[sel]) takenBy.set(T.nodes[k].s, k);
  const nextOnPath = path[path.indexOf(sel) + 1];
  if (n.grid) {
    g.classList.remove('single');
    n.grid.forEach((s, j) => {
      const w = mk('div', 'lgt' + (j === 4 ? ' centre' : '')); const c = mk('canvas'); c.width = c.height = 128; queueThumb(c, s); w.append(c);
      const child = j === 4 ? undefined : takenBy.get(s);
      if (child != null) { w.classList.add('taken'); if (child === nextOnPath) w.classList.add('next'); w.append(mk('span', 'tk', '↳ ' + subtreeSize(child))); w.title = 'taken: click to follow this branch'; }
      else w.title = j === 4 ? 'the centre at this step' : 'not taken: select it, then breed from it to start a new branch';
      w.onclick = () => { if (child != null) go(child); else { selTile = j; markTile(); showTile(); } };
      w.dataset.j = j; g.append(w);
    });
  } else {
    g.classList.add('single');
    const w = mk('div', 'lgt centre'); const c = mk('canvas'); c.width = c.height = 384; queueThumb(c, n.s); w.append(c); g.append(w);
  }
  markTile(); showTile();
}
function subtreeSize(i) { let k = 0; const st = [i]; while (st.length) { const x = st.pop(); k++; st.push(...T.kids[x]); } return k; }
function markTile() { for (const w of $('libGrid').children) w.classList.toggle('sel', +w.dataset.j === selTile || (!T.nodes[sel].grid)); }
const tileGenome = () => { const n = T.nodes[sel]; return n.grid ? n.grid[selTile] : n.s; };
function showTile() {
  const n = T.nodes[sel], s = tileGenome();
  $('libCap').textContent = (n.cap || 'step') + (n.grid && selTile !== 4 ? ` · image ${selTile < 4 ? selTile + 1 : selTile} of the 8 offered` : ' · centre');
  let tree = null; try { tree = H.GP.parse(s); } catch (e) { /* ignore */ }
  $('libGeno').value = tree ? H.GP.pretty(tree) : s;
  $('libBreed').textContent = selTile === 4 ? '✋ Breed from this centre (new mutants)' : '✋ Breed from this image (new branch)';
}
// ---- tree overview (SVG): depth left→right, one row per branch end ----
let lay = null;
function layoutTree() {
  const N = T.nodes.length, x = new Int32Array(N), y = new Float32Array(N);
  let leaf = 0; const roots = []; T.nodes.forEach((n, i) => { if (n.p < 0) roots.push(i); });
  const order = []; const st = roots.slice().reverse().map((r) => [r, 0]);
  while (st.length) { // iterative DFS (chains can be thousands deep)
    const [i, phase] = st.pop();
    if (phase === 0) { x[i] = T.nodes[i].p >= 0 ? x[T.nodes[i].p] + 1 : 0; st.push([i, 1]); for (let k = T.kids[i].length - 1; k >= 0; k--) st.push([T.kids[i][k], 0]); }
    else { y[i] = T.kids[i].length ? y[T.kids[i][0]] : leaf++; order.push(i); } // a parent sits on its first child's row
  }
  let maxX = 0; for (let i = 0; i < N; i++) maxX = Math.max(maxX, x[i]);
  lay = { x, y, maxX, leaves: Math.max(1, leaf) };
}
function drawTreeSvg() {
  const wrap = $('libTreeWrap'), W = Math.max(200, wrap.clientWidth - 12), N = T.nodes.length;
  const dx = Math.max(2.5, Math.min(26, (W - 16) / Math.max(1, lay.maxX))), dy = Math.max(6, Math.min(16, 120 / lay.leaves));
  const w = Math.ceil(16 + lay.maxX * dx), h = Math.ceil(16 + (lay.leaves - 1) * dy);
  const X = (i) => 8 + lay.x[i] * dx, Y = (i) => 8 + lay.y[i] * dy;
  const onPath = new Uint8Array(N); for (const k of path) onPath[k] = 1;
  let edges = '', hot = '';
  for (let i = 0; i < N; i++) { const p = T.nodes[i].p; if (p < 0) continue; const seg = `M${X(p).toFixed(1)} ${Y(p).toFixed(1)}V${Y(i).toFixed(1)}H${X(i).toFixed(1)}`; if (onPath[i]) hot += seg; else edges += seg; }
  const r = dx < 5 ? 1.6 : 3; let dots = '';
  const big = N > 1500; // too many to draw every dot: draw branch points, ends and the path
  for (let i = 0; i < N; i++) {
    if (big && !onPath[i] && T.kids[i].length === 1) continue;
    dots += `<circle data-i="${i}" cx="${X(i).toFixed(1)}" cy="${Y(i).toFixed(1)}" r="${i === sel ? r + 2.5 : r}" class="${i === sel ? 'sel' : onPath[i] ? 'hot' : ''}${T.kids[i].length > 1 ? ' fork' : ''}"/>`;
  }
  const svg = $('libTree'); svg.setAttribute('width', w); svg.setAttribute('height', h);
  svg.innerHTML = `<path d="${edges}" class="e"/><path d="${hot}" class="e hot"/>${dots}`;
  const sx = X(sel) - wrap.clientWidth / 2; if (Math.abs(wrap.scrollLeft - sx) > wrap.clientWidth / 3) wrap.scrollLeft = sx;
}
function step(d) { const p = path.indexOf(sel) + d; if (p >= 0 && p < path.length) go(path[p]); }
function sibling(d) { // switch to the next/previous branch at the nearest fork at or above sel
  for (let j = sel; j >= 0; j = T.nodes[j].p) {
    const p = T.nodes[j].p; if (p < 0) return;
    const sib = T.kids[p]; if (sib.length < 2) continue;
    const k = sib[(sib.indexOf(j) + d + sib.length) % sib.length]; go(k, true); return;
  }
}
function isOpen() { return !$('lib').classList.contains('hidden'); }
async function open() {
  await flush();
  $('lib').classList.remove('hidden');
  await refreshList();
  if (cur && metas.some((m) => m.id === cur.id)) await select(cur.id, sel);
  else if (metas.length) await select(metas[0].id);
  else { cur = null; $('libDetail').classList.add('hidden'); $('libEmpty').classList.remove('hidden'); }
}
function close() { $('lib').classList.add('hidden'); }
async function exportAll() {
  await flush();
  const runs = []; for (const m of await listMeta()) { const r = await getRun(m.id); if (r) runs.push(r); }
  const blob = new Blob([JSON.stringify({ format: 'genetic-images-runs', version: 1, runs })], { type: 'application/json' });
  H.saveFile(blob, 'genetic-images-runs-' + H.stamp() + '.json');
}
async function importFile(file) {
  try {
    const d = JSON.parse(await file.text());
    const runs = Array.isArray(d) ? d : d.runs;
    if (!Array.isArray(runs)) throw new Error('not a runs file');
    let n = 0;
    for (const r of runs) if (r && r.id && Array.isArray(r.steps) && r.steps.length >= 2) { await put(r); n++; }
    H.toast(`Imported ${n} run${n === 1 ? '' : 's'}`); refreshList();
  } catch (e) { H.toast('Import failed: ' + e.message); }
}
let readyResolve; const ready = new Promise((r) => { readyResolve = r; });
async function init(hooks) {
  H = hooks;
  await openStore(); readyResolve();
  // runs already on disk count as saved, so reloading the page doesn't re-save (and reorder) them
  try { for (const m of await listMeta()) savedSig.set(m.id, m.sig || m.n + '|' + m.last); } catch (e) { /* empty */ }
  setInterval(flush, 3000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);
  $('libClose').onclick = close;
  const curTree = () => { try { return H.GP.parse(tileGenome()); } catch (e) { return null; } };
  // interactive trees resume in place; images from auto runs start a new interactive tree
  $('libResume').onclick = () => { if (!cur) return; const r = cur, k = sel; close(); H.resumeTree(r, k, null); };
  $('libBreed').onclick = () => {
    if (!cur) return; const r = cur, k = sel, j = selTile; close();
    if (r.kind === 'lineage') H.resumeTree(r, k, T.nodes[k].grid ? j : 4);
    else H.breedFrom(r, k);
  };
  $('libContinue').onclick = () => { if (!cur || !cur.target) return; const r = cur, k = sel; close(); H.continueAuto(r, k); };
  $('libTarget').onclick = () => { const t = curTree(); if (t) { close(); H.useAsTarget(t); } };
  $('libPng').onclick = () => { const t = curTree(); if (t) H.savePNG(t, H.pngSize()); };
  $('libCopy').onclick = () => H.copyText(tileGenome());
  $('libMovie').onclick = () => { if (cur) { const r = cur, steps = path.map((k) => ({ s: T.nodes[k].s, cap: T.nodes[k].cap })); close(); H.movie(r, steps); } };
  $('libK').oninput = () => go(path[+$('libK').value]);
  $('libPrev').onclick = () => step(-1); $('libNext').onclick = () => step(1);
  $('libTree').onclick = (e) => { const i = e.target.dataset && e.target.dataset.i; if (i != null) go(+i, true); };
  $('libDel').onclick = async () => {
    if (!cur) return;
    const b = $('libDel');
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Click again to delete'; return; }
    deleted.add(cur.id); await del(cur.id); cur = null; H.toast('Run deleted'); open();
  };
  $('libExport').onclick = exportAll;
  $('libImport').onclick = () => $('libFile').click();
  $('libFile').onchange = (e) => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ''; };
  document.addEventListener('keydown', (e) => {
    if (!isOpen() || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); step(e.key === 'ArrowLeft' ? -1 : 1); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); sibling(e.key === 'ArrowUp' ? -1 : 1); }
  });
}
root.Library = { init, ready, toTree, open, close, isOpen, flush, select, go, step, sibling, get current() { return cur; }, get sel() { return sel; }, get path() { return path; }, uid, listMeta, getRun, get mode() { return store.mode; } };
})(window);
