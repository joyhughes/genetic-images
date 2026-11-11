// Renders genomes off the main thread for the breeding grid: {id, tree, N} -> {id, px} (RGBA bytes).
importScripts('gp.js');
onmessage = (e) => {
  const { id, tree, N } = e.data;
  try {
    const b = GP.evaluate(tree, N), px = new Uint8ClampedArray(N * N * 4);
    GP.toRGBA(b, N, px); GP.release(b);
    postMessage({ id, px }, [px.buffer]);
  } catch (err) { postMessage({ id, err: String(err && err.message || err) }); }
};
