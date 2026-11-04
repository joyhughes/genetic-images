# Genetic Images

A browser re-creation of Karl Sims's *Artificial Evolution for Computer Graphics* (SIGGRAPH 1991).
Open `index.html` through any static server (`python3 -m http.server`), no build step.

- **Interactive**: click one of the nine images; it flies to the centre and the other eight become its
  mutants. Click the centre to re-roll its mutants. Back / Backspace undoes. Genomes are Lisp-style
  expressions you can copy, edit, and paste back.
- **Auto-evolve**: pick or drop a target image; a steady-state GA (tournament selection, subtree
  crossover, Sims-style mutation, constant tuning, size penalty) minimises multi-scale RMS colour
  error after a per-channel affine colour fit, which is then baked into the genome.

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
`app.js` (UI), `test/core.test.js`, `test/ops.test.js`, `test/bench.js`.
