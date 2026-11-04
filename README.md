# Genetic Images

A browser re-creation of Karl Sims's *Artificial Evolution for Computer Graphics* (SIGGRAPH 1991).
Open `index.html` through any static server (`python3 -m http.server`), no build step.

- **Interactive**: click one of the nine images; it flies to the centre and the other eight become its
  mutants. Click the centre to re-roll its mutants. Back / Backspace undoes. Genomes are Lisp-style
  expressions you can copy, edit, and paste back.
- **Auto-evolve**: pick or drop a target image; a steady-state GA (tournament selection, subtree
  crossover, Sims-style mutation, constant tuning, size penalty) minimises multi-scale RMS colour
  error after a per-channel affine colour fit, which is then baked into the genome.

Files: `gp.js` (genome, ~50 primitives, mutation, evaluation, GA; runs in Node too),
`app.js` (UI), `test/core.test.js`, `test/bench.js`.
