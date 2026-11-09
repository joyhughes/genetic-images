# Genetic Images

A browser re-creation of Karl Sims's *Artificial Evolution for Computer Graphics* (SIGGRAPH 1991).
Open `index.html` through any static server (`python3 -m http.server`), no build step.

- **Interactive**: click one of the nine images; it flies to the centre and the other eight become its
  mutants. Click the centre to re-roll its mutants. Back / Backspace undoes. Genomes are Lisp-style
  expressions you can copy, edit, and paste back.
- **Saving**: Save PNG (512/1024/2048) and Save genome in the large view, Save centre PNG,
  Save best PNG. Inside claude.ai the page uses the artifact `downloads` capability (you confirm
  each save); elsewhere a normal download.
- **Off-centre functions** (checkbox + rate in the Function families panel, off by default): the 37
  position-dependent functions (◎ in the list: r, th, rings, spiral, star, dots, checker…, rot, zoom,
  swirl, kal, fisheye, cinv…, julia, mandel, kifs…) can carry their own centre `node.o = [cx, cy]`,
  written `(rings@0.3,-0.2 5)`. The op is evaluated at shifted coordinates while its children keep
  the parent's frame, and coordinate-mapping ops add the offset back, so `(rot@c a t)` rotates `t`
  about c. New centred nodes get an offset with the chosen probability; mutation moves, adds and
  removes centres. x, y, grad and noise have none (an offset would only be a constant or reseed).
  No measurable evaluation cost (`test/offset.test.js` checks the semantics).
- **Localized functions** (checkbox + rate, off by default): any node can carry a box
  `node.b = [cx, cy, halfW, halfH, soft]`, written `(swirl#0.2,-0.3,0.4,0.3,0.08 0.7 …)`. Its result
  is blended with its first argument through a smoothstep-edged box mask (leaves fade to 0, mid-grey),
  so the function only acts locally. Evolution boxes only functions with arguments: boxed leaves made
  mostly flat grey images. The first argument is evaluated once and reused by the op
  (`ctx.memo`). Mutation moves, resizes and softens boxes, and adds and removes them. On the sunset
  benchmark (6 seeds, 20 s) boxes didn't improve the match: mean RMSE 0.060 without, 0.062 at
  15% (within noise), 0.086 at 35%. They're for the look, not the fit.
- **Interactive sessions are trees**: every grid of nine you are shown is a node (centre + the 8
  offered). ← Back / Forward → (or the arrow keys) move along it without losing anything; choosing
  a different image after going back starts a branch. Tiles you already took show "↳ explored".
- **Saved runs** (📚 in either pane): each interactive tree (a new one per "New random 9") and
  each auto-evolve run (a new one per reset or target) saves itself every 3 s and when the page is
  hidden. Storage is IndexedDB, falling back to localStorage, then memory. The browser shows:
  - a tree overview of the run (click any node);
  - the current branch as a strip, plus a slider (← → step along it, ↑ ↓ switch branches);
  - the grid of nine at the selected step, where ↳ tiles were taken (click to follow that branch).

  From any step you can:
  - **Resume** in Interactive mode with that exact grid.
  - Select an image you didn't take and **breed from it**. This adds a new branch to the same tree.
  - **Continue auto-evolve** from an image of an auto run: reloads its target and weights, and
    seeds the population with the image and its mutants.
  - Use it as the target, save a PNG, copy the genome, or make a movie of the branch.

  Auto runs are chains of improving bests; breeding from one starts a new tree whose trunk is that
  run. Export all / Import move runs between browsers as JSON.
- **Big PNGs**: 1024 to 8192 px. Genomes without image filters render in horizontal strips
  (bounded memory; an 8192² swirl took ~9 s including PNG encoding). Genomes with filters (blur,
  edges, emboss…) need the whole pixel grid at once, so they're capped at 4096.
- **Movies** (🎬 in either mode): every new centre you pick, and every new best of an auto-evolve
  run, is recorded. The movie steps through them (thinned evenly to the length you choose).
  Consecutive genomes with the same tree shape morph by interpolating their constants frame by
  frame; others crossfade. Options: seconds per step, max length, size up to 1080 px, 24/30/60 fps,
  target alongside, captions (generation, error). Frames are rendered offline and encoded with
  WebCodecs H.264 into an MP4 muxed in `movie.js` (no libraries), so heavy frames never stutter;
  without WebCodecs it falls back to real-time MediaRecorder. A 10 s 720×360 run movie takes ~3 s,
  a 15 s 1080² one ~9 s (Chrome, M-series Mac).
- **Mating**: ♥ any two tiles and press Mate. In interactive mode ♥A moves to the centre and the
  eight around it are crossover children of A and B. In auto-evolve, 16 children are scored and
  offered to the parents' islands.
- **Auto-evolve**: pick or drop a target image. An island-model steady-state GA minimises a weighted
  match error, after a per-channel affine colour fit that is baked into the genome. Measures, each
  divided by the score of a flat image of the target's mean colour (0 = perfect, 1 = flat), weighted
  by sliders (presets: Colour only, Balanced, Look & feel, Shape): colour distance (RGB, 4 scales),
  hue (weighted by target saturation), saturation, brightness (HSV value), edge strength (gradient
  maps, 2 scales), colour statistics (histograms, means, spreads), structure (SSIM).
  - islands evolve separately (tournament selection, subtree crossover, Sims-style mutation,
    constant tuning, size penalty, phenotype dedupe) and pass champions around a ring;
  - every few generations the two most different-looking images among each island's top matches
    are mated (crossover both ways); a child is kept only if it beats both parents. Without that
    rule, mated children flooded the islands and erased their differences (island spread 0.003 vs
    0.069 with it). In 6-seed benchmarks, diverse mating didn't measurably improve the final error;
    the gap was within run-to-run noise. Migrating every 50 rather than 20 generations kept the
    islands ~5x more distinct at equal error;
  - the grid shows the overall best in the centre and island champions (★) around it; ⚭ marks a
    child of diverse mating, ♥ a child of your mating, → a migrant.

## Function families (119 primitives)

Each family, and each function inside it, can be switched off in the sidebar; this restricts new random images, mutations and auto-evolve.

- **Coordinates** (7): `x`, `y`, `r`, `th`, `l1`, `linf`, `grad`
- **Constants** (2): `c`, `v`
- **Patterns** (9): `checker`, `stripes`, `rings`, `dots`, `spiral`, `star`, `hexgrid`, `eggcrate`, `bricks`
- **Noise** (11): `noise`, `cnoise`, `fbm`, `ridged`, `turb`, `cells`, `cracks`, `ccells`, `wnoise`, `wcnoise`, `wcells`
- **Arithmetic** (12): `add`, `sub`, `mul`, `div`, `mod`, `neg`, `abs`, `min`, `max`, `avg`, `absdiff`, `hypot`
- **Periodic & shaping** (8): `sin`, `tri`, `saw`, `sqwave`, `tanh`, `smooth`, `fold`, `clamp`
- **Powers & logs** (9): `log`, `exp`, `sqrt`, `sq`, `cube`, `recip`, `gamma`, `pow`, `atan2`
- **Logic & quantize** (8): `floor`, `step`, `gt`, `and`, `or`, `xor`, `if`, `dither`
- **Colour** (9): `hsv`, `lum`, `vec`, `hue`, `sat`, `chan`, `swap`, `palette`, `sepia`
- **Blending** (6): `lerp`, `mask`, `screen`, `overlay`, `dodge`, `burn`
- **Coordinate transforms** (17): `rot`, `xform`, `zoom`, `shear`, `mirror`, `tile`, `brick`, `pixel`, `polar`, `unpolar`, `kal`, `swirl`, `fisheye`, `pinch`, `ripple`, `wave`, `cinv`
- **Warps** (5): `warp`, `wrel`, `wgrad`, `wrot`, `wscale`
- **Image filters** (11): `blur`, `hblur`, `vblur`, `sharpen`, `edges`, `gmag`, `gdir`, `bump`, `emboss`, `erode`, `dilate`
- **Fractals** (5): `julia`, `mandel`, `juliaw`, `kifs`, `sierp`

Files: `gp.js` (genome, ~50 primitives, mutation, evaluation, GA; runs in Node too),
`app.js` (UI), `test/core.test.js`, `test/ops.test.js`, `test/metrics.test.js`, `test/bench.js`.
