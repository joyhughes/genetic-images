// Genetic Images UI: 3x3 breeding grid + auto-evolve toward a target image.
(function () {
'use strict';
const $ = (id) => document.getElementById(id);
const CHILD_CELLS = [0, 1, 2, 3, 5, 6, 7, 8];
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } } };

// ---------- grid layout ----------
const grid = $('grid'), tiles = [];
for (let i = 0; i < 9; i++) {
  const el = document.createElement('div'); el.className = 'tile' + (i === 4 ? ' center' : '');
  const cv = document.createElement('canvas');
  const zoom = document.createElement('button'); zoom.className = 'zoom'; zoom.textContent = '⤢'; zoom.title = 'Large view';
  const badge = document.createElement('div'); badge.className = 'badge';
  el.append(cv, zoom, badge); grid.append(el);
  el.addEventListener('click', () => onTileClick(i));
  zoom.addEventListener('click', (e) => { e.stopPropagation(); if (cells[i]) openModal(cells[i]); });
  tiles.push({ el, cv, badge });
}
function layout() {
  const st = $('stage').getBoundingClientRect();
  const t = Math.max(90, Math.floor(Math.min((st.width - 48 - 24) / 3, (st.height - 48 - 24) / 3)));
  document.documentElement.style.setProperty('--tile', t + 'px');
  return t;
}
const TILE_RES = Math.min(256, Math.round(layout() * Math.min(2, window.devicePixelRatio || 1)));
for (const t of tiles) { t.cv.width = t.cv.height = TILE_RES; }
window.addEventListener('resize', layout);

// ---------- rendering ----------
function drawTree(tree, canvas) {
  const N = canvas.width, g = canvas.getContext('2d');
  const b = GP.evaluate(tree, N), img = g.createImageData(N, N);
  GP.toRGBA(b, N, img.data); GP.release(b); g.putImageData(img, 0, 0);
}
let queue = [], qGen = 0;
const cancelRenders = () => { queue = []; qGen++; };
const enqueue = (run) => queue.push({ gen: qGen, run });
function pumpQueue(budget) {
  const t0 = performance.now();
  while (queue.length && performance.now() - t0 < budget) { const j = queue.shift(); if (j.gen === qGen) j.run(); }
}
function emerge(i) { // child flies out of the centre tile into place
  const el = tiles[i].el, a = el.getBoundingClientRect(), c = tiles[4].el.getBoundingClientRect();
  el.style.transition = 'none';
  el.style.transform = `translate(${c.left - a.left}px, ${c.top - a.top}px) scale(.5)`;
  el.style.opacity = '0';
  void el.offsetWidth;
  el.style.transition = 'transform .4s cubic-bezier(.2,.7,.3,1), opacity .3s';
  el.style.transform = ''; el.style.opacity = '1';
}
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 1800); }

// ---------- interactive state ----------
let cells = new Array(9).fill(null);
let history = [];
let busy = false;
const amt = () => +$('amt').value;

function save() {
  store.set('gi.cells', JSON.stringify(cells.map((t) => GP.toString(t))));
  store.set('gi.history', JSON.stringify(history.slice(-40)));
}
function showGenome() { $('geno').value = cells[4] ? GP.pretty(cells[4]) : ''; $('back').disabled = !history.length; }
function renderAll(anim) {
  cancelRenders();
  for (let i = 0; i < 9; i++) {
    const t = tiles[i]; t.badge.style.display = 'none';
    if (anim && i !== 4) { t.el.style.opacity = '0'; }
    enqueue(() => { drawTree(cells[i], t.cv); if (anim && i !== 4) emerge(i); else t.el.style.opacity = '1'; });
  }
}
function randomNine() {
  if (cells[0]) history.push(cells.map((t) => GP.toString(t)));
  cells = Array.from({ length: 9 }, () => GP.randomInteresting(6));
  renderAll(false); showGenome(); save();
}
function breedFrom(parent, anim) {
  const kids = GP.mutants(parent, 8, amt());
  cells[4] = parent; CHILD_CELLS.forEach((c, j) => { cells[c] = kids[j]; });
  cancelRenders();
  tiles[4].el.style.opacity = '1';
  CHILD_CELLS.forEach((c) => { tiles[c].el.style.opacity = '0'; tiles[c].badge.style.display = 'none'; });
  tiles[4].badge.style.display = 'none';
  CHILD_CELLS.forEach((c) => enqueue(() => { drawTree(cells[c], tiles[c].cv); if (anim) emerge(c); else tiles[c].el.style.opacity = '1'; }));
  showGenome(); save();
}
function flyToCenter(i, done) {
  const src = tiles[i], a = src.el.getBoundingClientRect(), c = tiles[4].el.getBoundingClientRect();
  const fly = document.createElement('canvas'); fly.width = fly.height = TILE_RES; fly.className = 'fly';
  fly.getContext('2d').drawImage(src.cv, 0, 0);
  Object.assign(fly.style, { left: a.left + 'px', top: a.top + 'px', width: a.width + 'px', height: a.height + 'px' });
  document.body.append(fly);
  for (let j = 0; j < 9; j++) { const el = tiles[j].el; el.style.transition = 'opacity .35s'; el.style.opacity = j === i ? '0' : '0.12'; }
  void fly.offsetWidth;
  fly.style.transform = `translate(${c.left - a.left}px, ${c.top - a.top}px)`;
  let finished = false;
  const end = () => {
    if (finished) return; finished = true;
    tiles[4].cv.getContext('2d').drawImage(fly, 0, 0);
    tiles[4].el.style.transition = 'none'; tiles[4].el.style.opacity = '1';
    fly.remove(); done();
  };
  fly.addEventListener('transitionend', end); setTimeout(end, 650);
}
function choose(i) {
  if (busy || !cells[i]) return;
  history.push(cells.map((t) => GP.toString(t)));
  const parent = cells[i];
  if (i === 4) { breedFrom(parent, true); return; }
  busy = true; cancelRenders();
  flyToCenter(i, () => { busy = false; breedFrom(parent, true); });
}
function back() {
  if (busy || !history.length) return;
  cells = history.pop().map(GP.parse);
  renderAll(false); showGenome(); save();
}
function onTileClick(i) {
  if (mode === 'A') {
    if (!cells[i]) return;
    stopAuto(); setMode('I', true); // keep the evolved grid as the interactive grid
  }
  choose(i);
}

// ---------- modal ----------
let modalTree = null;
function openModal(tree) {
  modalTree = tree; $('modal').classList.remove('hidden');
  $('bigGeno').value = GP.pretty(tree) + '\n\n; ' + GP.size(tree) + ' nodes';
  const cv = $('bigCanvas'), g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height); g.fillStyle = '#888'; g.font = '20px system-ui'; g.fillText('rendering…', 24, 40);
  requestAnimationFrame(() => setTimeout(() => { if (modalTree === tree) drawTree(tree, cv); }, 0));
}
const closeModal = () => { $('modal').classList.add('hidden'); modalTree = null; };
async function copyText(s) {
  try { await navigator.clipboard.writeText(s); toast('Genome copied'); }
  catch (e) { const ta = $('bigGeno'); ta.value = s; ta.select(); toast('Select-all done; press ⌘C to copy'); }
}
$('bigClose').onclick = closeModal;
$('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
$('bigCopy').onclick = () => modalTree && copyText(GP.toString(modalTree, 6));
$('bigParent').onclick = () => {
  if (!modalTree) return; const t = modalTree; closeModal();
  if (mode === 'A') { stopAuto(); setMode('I', true); }
  history.push(cells.map((x) => GP.toString(x)));
  drawTree(t, tiles[4].cv); breedFrom(t, true);
};
$('bigTarget').onclick = () => { if (!modalTree) return; const t = modalTree; closeModal(); setMode('A'); setTargetFromTree(t, 'Chosen image'); };
$('bigSave').onclick = () => {
  if (!modalTree) return;
  const c = document.createElement('canvas'); c.width = c.height = 1024; drawTree(modalTree, c);
  c.toBlob((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'genetic-image.png'; a.click(); toast('If no download starts, right-click the image → Save Image As'); setTimeout(() => URL.revokeObjectURL(a.href), 5000); });
};

// ---------- interactive controls ----------
$('amtv').textContent = amt();
$('amt').oninput = () => { $('amtv').textContent = amt(); };
$('back').onclick = back;
$('rand').onclick = () => { if (mode === 'A') { stopAuto(); setMode('I', true); } randomNine(); };
$('bigC').onclick = () => cells[4] && openModal(cells[4]);
$('copy').onclick = () => cells[4] && copyText(GP.toString(cells[4], 6));
$('apply').onclick = () => {
  let t; try { t = GP.parse($('geno').value.replace(/;.*$/gm, '')); } catch (e) { toast('Parse error: ' + e.message); return; }
  history.push(cells.map((x) => GP.toString(x)));
  drawTree(t, tiles[4].cv); breedFrom(t, true);
};

// ---------- auto-evolve ----------
let mode = 'I', savedInteractive = null;
let evo = null, running = false, target = null, targetSrc = null, targetName = '';
let lastStats = 0, lastGrid = 0, lastBest = null, evalMark = { t: 0, n: 0, rate: 0 };
const shown = new Array(9).fill('');
const tgtSize = 256;

function setMode(m, keepGrid) {
  if (m === mode) return;
  mode = m;
  $('tabI').classList.toggle('on', m === 'I'); $('tabA').classList.toggle('on', m === 'A');
  $('paneI').classList.toggle('hidden', m !== 'I'); $('paneA').classList.toggle('hidden', m !== 'A');
  if (m === 'A') {
    savedInteractive = cells.map((t) => GP.toString(t));
    shown.fill('');
    if (evo) showPopulation(true);
  } else {
    stopAuto();
    if (!keepGrid && savedInteractive) { cells = savedInteractive.map(GP.parse); renderAll(false); }
    for (const t of tiles) t.badge.style.display = 'none';
    showGenome(); save();
  }
}
$('tabI').onclick = () => setMode('I');
$('tabA').onclick = () => setMode('A');

function makeSrcCanvas() { const c = document.createElement('canvas'); c.width = c.height = tgtSize; return c; }
function setTargetCanvas(c, name) {
  targetSrc = c; targetName = name;
  const t = $('tgtC').getContext('2d'); t.imageSmoothingQuality = 'high'; t.drawImage(c, 0, 0, $('tgtC').width, $('tgtC').height);
  rebuildTarget(); resetEvo();
}
function rebuildTarget() {
  if (!targetSrc) return;
  const N = +$('res').value, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(targetSrc, 0, 0, N, N);
  target = new GP.Target(g.getImageData(0, 0, N, N).data, N);
}
function setTargetFromTree(tree, name) { const c = makeSrcCanvas(); drawTree(tree, c); setTargetCanvas(c, name); }
function interactiveCenter() { return savedInteractive ? GP.parse(savedInteractive[4]) : cells[4]; }

function preset(name) {
  if (name === 'genome') return setTargetFromTree(GP.randomInteresting(6), 'Hidden random genome');
  if (name === 'center') return setTargetFromTree(interactiveCenter(), 'Interactive centre');
  const c = makeSrcCanvas(), g = c.getContext('2d'), S = tgtSize;
  if (name === 'sunset') {
    const sky = g.createLinearGradient(0, 0, 0, S * 0.62);
    sky.addColorStop(0, '#1b2a6b'); sky.addColorStop(0.55, '#c8507a'); sky.addColorStop(1, '#ffb347');
    g.fillStyle = sky; g.fillRect(0, 0, S, S * 0.62);
    g.fillStyle = '#ffe9a0'; g.beginPath(); g.arc(S * 0.5, S * 0.6, S * 0.14, 0, Math.PI * 2); g.fill();
    const sea = g.createLinearGradient(0, S * 0.62, 0, S); sea.addColorStop(0, '#3a2f5c'); sea.addColorStop(1, '#0c1030');
    g.fillStyle = sea; g.fillRect(0, S * 0.62, S, S * 0.38);
    g.fillStyle = '#ffd27a';
    for (let k = 0; k < 7; k++) { const y = S * (0.65 + k * 0.045), w = S * (0.2 - k * 0.022); g.fillRect(S * 0.5 - w / 2, y, w, S * 0.012); }
  } else if (name === 'rings') {
    const cols = ['#f3d34a', '#e4572e', '#29335c', '#a8c686', '#669bbc'];
    for (let k = 10; k > 0; k--) { g.fillStyle = cols[k % cols.length]; g.beginPath(); g.arc(S / 2, S / 2, k * S * 0.07, 0, Math.PI * 2); g.fill(); }
  } else if (name === 'letter') {
    g.fillStyle = '#f2ead3'; g.fillRect(0, 0, S, S); g.fillStyle = '#7a1f1f';
    g.font = `bold ${S * 0.85}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('K', S / 2, S * 0.54);
  } else if (name === 'flower') {
    g.fillStyle = '#9cc98a'; g.fillRect(0, 0, S, S);
    g.font = `${S * 0.8}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('🌼', S / 2, S * 0.55);
  } else return;
  setTargetCanvas(c, PRESET_NAMES[name]);
}
const PRESET_NAMES = { sunset: 'Sunset', rings: 'Rings', letter: 'Letter K', flower: 'Flower emoji' };
$('preset').onchange = (e) => { const v = e.target.value; e.target.value = ''; if (v) preset(v); };

async function loadImageFile(file) {
  if (!file || !file.type.startsWith('image/')) { toast('Not an image'); return; }
  try {
    const bmp = await createImageBitmap(file), c = makeSrcCanvas(), g = c.getContext('2d');
    const s = Math.min(bmp.width, bmp.height); // centre square crop
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, tgtSize, tgtSize);
    setTargetCanvas(c, file.name);
  } catch (e) { toast('Could not read image'); }
}
$('upload').onclick = () => $('file').click();
$('file').onchange = (e) => loadImageFile(e.target.files[0]);
const drop = $('drop');
for (const el of [drop, document.body]) {
  el.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  el.addEventListener('dragleave', () => drop.classList.remove('over'));
  el.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) { setMode('A'); loadImageFile(e.dataTransfer.files[0]); } });
}

function resetEvo() {
  const wasRunning = running;
  evo = null; lastBest = null; shown.fill('');
  if (!target) { updateStats(); return; }
  evo = new GP.Evolver(target, { popSize: +$('popSize').value, parsimony: +$('pars').value * 1e-5 });
  const seeds = [];
  if ($('seedC').checked) { const c = interactiveCenter(); if (c) { seeds.push(c); seeds.push(...GP.mutants(c, 8, 0.5)); } }
  evo.seed(seeds);
  evalMark = { t: performance.now(), n: 0, rate: 0 };
  showPopulation(true); drawBest(); updateStats();
  if (wasRunning) startAuto();
}
function startAuto() {
  if (!target) { toast('Choose a target first'); return; }
  if (!evo) resetEvo();
  running = true; $('run').textContent = '❚❚ Pause';
}
function stopAuto() { running = false; $('run').textContent = '▶ Start'; }
$('run').onclick = () => (running ? stopAuto() : startAuto());
$('reset').onclick = resetEvo;
$('popSize').onchange = resetEvo;
$('res').onchange = () => { rebuildTarget(); resetEvo(); };
$('seedC').onchange = () => {};
const parsLabel = () => { $('parsv').textContent = (+$('pars').value * 1e-5).toExponential(0) + ' / node'; };
parsLabel();
$('pars').oninput = () => {
  parsLabel();
  if (evo) { evo.parsimony = +$('pars').value * 1e-5; for (const p of evo.pop) p.fit = p.err + evo.parsimony * p.nodes; evo.updateBest(); }
};

function drawBest() {
  if (!evo || evo.best === lastBest) return;
  lastBest = evo.best; drawTree(evo.baked(evo.best), $('bestC'));
}
// Grid shows the best nine visually distinct members: best in the centre.
function showPopulation(force) {
  if (!evo || mode !== 'A') return;
  const sorted = evo.sorted(), pick = [], sigs = [];
  for (const p of sorted) {
    if (pick.length >= 9) break;
    const s = GP.signature(evo.baked(p), 16);
    if (sigs.some((o) => GP.sigDist(o, s) < 0.01)) continue;
    pick.push(p); sigs.push(s);
  }
  for (let k = 0; pick.length < 9 && k < sorted.length; k++) if (!pick.includes(sorted[k])) pick.push(sorted[k]);
  const order = [4].concat(CHILD_CELLS);
  pick.forEach((p, j) => {
    const i = order[j], t = tiles[i], baked = evo.baked(p);
    cells[i] = baked;
    t.badge.textContent = (j === 0 ? 'best ' : '') + p.rmse.toFixed(3); t.badge.style.display = 'block';
    t.el.style.opacity = '1';
    if (shown[i] !== p.str || force) { shown[i] = p.str; enqueue(() => drawTree(baked, t.cv)); }
  });
}
function updateStats() {
  if (!target) { $('stats').textContent = 'no target yet — pick one above'; return; }
  if (!evo) { $('stats').textContent = 'target: ' + targetName; return; }
  const now = performance.now();
  if (now - evalMark.t > 1000) { evalMark.rate = (evo.evals - evalMark.n) * 1000 / (now - evalMark.t); evalMark = { t: now, n: evo.evals, rate: evalMark.rate }; }
  const b = evo.best, f = (x) => Math.round(x).toLocaleString();
  $('stats').textContent =
    `target       ${targetName}\n` +
    `evaluations  ${f(evo.evals)}  (${f(evalMark.rate)}/s)\n` +
    `generations  ${f(evo.evals / evo.popSize)}\n` +
    `best RMSE    ${b.rmse.toFixed(4)}  (${(b.rmse * 100).toFixed(1)}% of range)\n` +
    `best size    ${b.nodes} nodes\n` +
    `population   ${evo.popSize} at ${target.N}px` + (running ? '' : '\n(paused)');
}


// ---------- function families ----------
function loadOpPrefs() {
  try { const off = JSON.parse(store.get('gi.off') || '[]'); GP.setAllEnabled(true); for (const n of off) GP.setEnabled(n, false); } catch (e) { GP.setAllEnabled(true); }
}
function saveOpPrefs() { store.set('gi.off', JSON.stringify(Object.keys(GP.OPS).filter((n) => !GP.OPS[n].on))); }
function buildFamilies() {
  const list = $('famList'); list.textContent = '';
  for (const f of GP.FAMILIES) {
    const box = document.createElement('div'); box.className = 'fam';
    const row = document.createElement('div'); row.className = 'famrow';
    const lab = document.createElement('label'), cb = document.createElement('input'); cb.type = 'checkbox'; cb.dataset.fam = f.id;
    lab.append(cb, document.createTextNode(f.name));
    const count = document.createElement('span'); count.className = 'count';
    const more = document.createElement('button'); more.className = 'more'; more.textContent = '▸'; more.title = 'Show functions';
    row.append(lab, count, more);
    const ops = document.createElement('div'); ops.className = 'opsl hidden';
    for (const name of f.ops) {
      const op = GP.OPS[name], l = document.createElement('label'), nm = document.createElement('span'), ds = document.createElement('span');
      const c = document.createElement('input'); c.type = 'checkbox'; c.dataset.op = name;
      nm.className = 'nm'; nm.append(c, document.createTextNode(name));
      ds.className = 'ds'; ds.textContent = op.desc + (op.arity ? ` · ${op.arity} arg${op.arity > 1 ? 's' : ''}` : '');
      l.append(nm, ds); ops.append(l);
      c.onchange = () => { GP.setEnabled(name, c.checked); saveOpPrefs(); syncFamilies(); };
    }
    cb.onchange = () => { GP.setFamily(f.id, cb.checked); saveOpPrefs(); syncFamilies(); };
    more.onclick = () => { const open = ops.classList.toggle('hidden'); more.textContent = open ? '▸' : '▾'; };
    box.append(row, ops); list.append(box);
    box._sync = () => {
      const on = f.ops.filter((n) => GP.OPS[n].on).length;
      cb.checked = on === f.ops.length; cb.indeterminate = on > 0 && on < f.ops.length;
      count.textContent = on + '/' + f.ops.length;
      for (const c of ops.querySelectorAll('input')) c.checked = GP.OPS[c.dataset.op].on;
    };
  }
  syncFamilies();
}
function syncFamilies() {
  for (const b of $('famList').children) b._sync();
  const on = GP.enabledNames().length, all = Object.keys(GP.OPS).length;
  $('famTotal').textContent = `${on} of ${all} on`;
  const leaves = GP.TERMS.some((o) => o.on), fns = GP.FUNCS.some((o) => o.on);
  if (!leaves || !fns) toast(!leaves ? 'No leaf functions on: using x and y' : 'No functions with arguments on: images will be very simple');
}
$('famAll').onclick = () => { GP.setAllEnabled(true); saveOpPrefs(); syncFamilies(); };
$('famNone').onclick = () => { GP.setAllEnabled(false); saveOpPrefs(); syncFamilies(); };
$('famReroll').onclick = () => { if (mode === 'A') { stopAuto(); setMode('I', true); } randomNine(); };
loadOpPrefs();
buildFamilies();

// ---------- main loop ----------
function frame() {
  const t0 = performance.now();
  if (running && evo && mode === 'A') evo.step(queue.length ? 14 : 22);
  pumpQueue(Math.max(6, 28 - (performance.now() - t0)));
  const now = performance.now();
  if (mode === 'A' && evo) {
    if (now - lastStats > 250) { lastStats = now; drawBest(); updateStats(); }
    if (running && now - lastGrid > 1500 && !queue.length) { lastGrid = now; showPopulation(false); }
  }
  requestAnimationFrame(frame);
}

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key === 'Escape') closeModal();
  else if (e.key === 'Backspace' && mode === 'I') { e.preventDefault(); back(); }
  else if (e.key === ' ' && mode === 'A') { e.preventDefault(); running ? stopAuto() : startAuto(); }
});

// ---------- start ----------
(function init() {
  try {
    const c = JSON.parse(store.get('gi.cells') || 'null'), h = JSON.parse(store.get('gi.history') || '[]');
    if (Array.isArray(c) && c.length === 9) { cells = c.map(GP.parse); history = Array.isArray(h) ? h : []; renderAll(false); showGenome(); }
    else randomNine();
  } catch (e) { history = []; randomNine(); }
  window.gi = { get cells() { return cells; }, get evo() { return evo; }, choose, preset, startAuto, stopAuto, setMode, GP };
  requestAnimationFrame(frame);
})();
})();
