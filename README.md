# Genetic Images

A browser re-creation of Karl Sims's *Artificial Evolution for Computer Graphics* (SIGGRAPH 1991).
Open `index.html` through any static server (`python3 -m http.server`), no build step.

- **Interactive**: click one of the nine images; it flies to the centre and the other eight become its
  mutants. Click the centre to re-roll its mutants. Back / Backspace undoes. Genomes are Lisp-style
  expressions you can copy, edit, and paste back.
- **Saving**: Save PNG (512/1024/2048) and Save genome in the large view, Save centre PNG,
  Save best PNG. Inside claude.ai the page uses the artifact `downloads` capability (you confirm
  each save); elsewhere a normal download.
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
