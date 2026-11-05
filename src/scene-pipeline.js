/*
  The geometry half of the app, loaded on first use rather than at page load.

  `scene.js` and `request-scene.js` reach `src/geom/`, `src/structure.js` and, through them, Mol*'s
  CIF and PDB readers, its polymer trace and its marching cubes -- none of which the page needs
  until there is a structure to build. Each is used from async call sites only (`main.js`'s
  `readStructure()`, its secondary-structure recompute and `scaffoldingPage()`;
  `render-backend.js`'s `prepare()`), so deferring them costs one `await` apiece and restructures
  nothing.

  **Read the eager size off `dist/index.html` rather than off a comment**: the entry `<script>`
  plus its `<link rel="modulepreload">` chain is the eager set, and `vite.config.js` prints the sum
  on every build for exactly that reason. A number written down here drifts.

  **Two static edges reach Mol*'s WebGL and mol-geo layers from the entry, and neither alone moves
  a byte.** Measured one at a time by stubbing each edge:

    * `main.js -> mol-model/loci.js -> mol-model/shape.js -> mol-gl/render-object.js`. The loci
      barrel re-exports `Shape`, and a shape owns render objects, so asking for `EmptyLoci` asks
      for ten `mol-gl/renderable/*` modules.
    * `main.js -> selection-model.js -> geom/surface.js -> mol-repr/.../gaussian.js` and
      `mol-geo/util/marching-cubes`. `selection-model.js` wants three metadata functions --
      `levelFor`, `levelSettingControls`, `levelSettingDefaults`, for the derived surface panel --
      and pays for the whole surface builder to get them.

  Cutting the loci import on its own: 1,500.1 -> 1,500.1 KiB. Cutting the surface import on its
  own: 1,500.1 -> 1,457.0. Cutting both: 1,500.1 -> **1,118.4 KiB, 342.1 gzipped** -- the 398.9 KiB
  chunk carrying Mol*'s `mol-gl/webgl` and `mol-geo/geometry` leaves the first paint entirely. So a
  change to either file alone is a null result, and both have to land together. Both are cut:
  `selection-model.js` reads `geom/surface-levels.js`, and `Loci` (with `FocusLoci`, a third edge to
  the same layer) reaches `main.js` through `preview-canvas.js`.

  The ceiling, for whoever prices the rest: with every Mol* edge off the entry graph the eager JS is
  **486.5 KiB, 144.2 gzipped, 120.5 brotli** -- a third of what it is. The remaining 1,009.8 KiB of
  Mol* is `mol-model/structure` (610.9) plus that GL chunk (398.9), and the opening screen needs
  none of it: nothing is parsed until a structure arrives.

  **One module rather than a memoised loader in each caller.** Two loaders would be two answers to
  when the geometry half arrives, and the studio has one: `render-backend.js` renders through the
  same builders `main.js` frames the camera from.
*/

let loaded;

/** The scene builders, imported once, on the first render or the first structure. */
export function ensureScenePipeline() {
  loaded ??= Promise.all([
    import('./request-scene.js'),
    import('./scene.js'),
  ]).then(([requestScene, scene]) => ({
    sceneInputsFromRequest: requestScene.sceneInputsFromRequest,
    heldParse: requestScene.heldParse,
    restoreHeldParse: requestScene.restoreHeldParse,
    buildScene: scene.buildScene,
    resolveCamera: scene.resolveCamera,
    resolveLighting: scene.resolveLighting,
    lightingScene: scene.lightingScene,
  }), (error) => {
    // A failed chunk fetch is not kept, so the next call can retry it.
    loaded = undefined;
    throw error;
  });
  return loaded;
}
