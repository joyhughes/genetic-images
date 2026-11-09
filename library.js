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
  n: r.steps.length, last: r.steps[r.steps.length - 1].s, parent: r.parent || null, hasTarget: !!r.target });
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
      const last = r.steps[r.steps.length - 1].s, sig = r.steps.length + '|' + last;
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
let cur = null, curK = 0, metas = [];
const STRIP_MAX = 240; // thumbnails shown; the slider reaches every step
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
    txt.append(mk('div', 'libs', `${m.n} images · ${fmtDate(m.updated)}${live.has(m.id) ? ' · ● recording' : ''}${m.parent ? ' · branch' : ''}`));
    row.append(c, txt); row.onclick = () => select(m.id);
    list.append(row);
  }
  if (!metas.length) list.append(mk('div', 'help', 'No runs yet. Pick images in Interactive mode or run auto-evolve: both save themselves here.'));
}
async function select(id, k) {
  const r = await getRun(id); if (!r) return;
  cur = r; $('libDel').textContent = 'Delete run'; $('libDel').dataset.armed = '';
  for (const row of $('libList').children) row.classList.toggle('on', false);
  const i = metas.findIndex((m) => m.id === id); if (i >= 0 && $('libList').children[i]) $('libList').children[i].classList.add('on');
  $('libTitle').textContent = r.title + (r.parent ? `  (branched at image ${r.parent.step + 1})` : '');
  $('libDetail').classList.remove('hidden'); $('libEmpty').classList.add('hidden');
  const strip = $('libStrip'); strip.textContent = '';
  const n = r.steps.length, idx = H.Movie.thinIdx(n, STRIP_MAX);
  for (const j of idx) {
    const c = mk('canvas'); c.width = c.height = 64; c.dataset.k = j; c.title = `image ${j + 1}: ${r.steps[j].cap || ''}`;
    c.onclick = () => pick(j); strip.append(c); queueThumb(c, r.steps[j].s);
  }
  $('libStripNote').textContent = n > idx.length ? `showing ${idx.length} of ${n} images; the slider reaches every one` : '';
  const sl = $('libK'); sl.max = n - 1; sl.oninput = () => pick(+sl.value);
  $('libContinue').disabled = !r.target;
  $('libContinue').title = r.target ? '' : 'Only auto-evolve runs have a target';
  pick(k != null ? k : n - 1);
}
function pick(k) {
  if (!cur) return;
  curK = Math.max(0, Math.min(cur.steps.length - 1, k));
  $('libK').value = curK;
  const st = cur.steps[curK];
  $('libCap').textContent = `image ${curK + 1} of ${cur.steps.length}` + (st.cap ? ' · ' + st.cap : '');
  let tree = null; try { tree = H.GP.parse(st.s); } catch (e) { /* ignore */ }
  $('libGeno').value = tree ? H.GP.pretty(tree) : st.s;
  if (tree) H.drawTree(tree, $('libBig'));
  for (const c of $('libStrip').children) c.classList.toggle('on', +c.dataset.k === curK);
}
const curTree = () => (cur ? H.GP.parse(cur.steps[curK].s) : null);
function isOpen() { return !$('lib').classList.contains('hidden'); }
async function open() {
  await flush();
  $('lib').classList.remove('hidden');
  await refreshList();
  if (cur && metas.some((m) => m.id === cur.id)) await select(cur.id, curK);
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
async function init(hooks) {
  H = hooks;
  await openStore();
  // runs already on disk count as saved, so reloading the page doesn't re-save (and reorder) them
  try { for (const m of await listMeta()) savedSig.set(m.id, m.n + '|' + m.last); } catch (e) { /* empty */ }
  setInterval(flush, 3000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);
  $('libClose').onclick = close;
  $('libBreed').onclick = () => { if (!cur) return; const r = cur, k = curK; close(); H.breedFrom(r, k); };
  $('libContinue').onclick = () => { if (!cur || !cur.target) return; const r = cur, k = curK; close(); H.continueAuto(r, k); };
  $('libTarget').onclick = () => { const t = curTree(); if (t) { close(); H.useAsTarget(t); } };
  $('libPng').onclick = () => { const t = curTree(); if (t) H.savePNG(t, 1024); };
  $('libCopy').onclick = () => { if (cur) H.copyText(cur.steps[curK].s); };
  $('libMovie').onclick = () => { if (cur) { const r = cur; close(); H.movie(r); } };
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
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); pick(curK + (e.key === 'ArrowLeft' ? -1 : 1)); }
  });
}
root.Library = { init, open, close, isOpen, flush, select, pick, get current() { return cur; }, uid, listMeta, getRun, get mode() { return store.mode; } };
})(window);
