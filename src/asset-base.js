/*
  Where the renderer's runtime assets are served from: `public/assets/`, which Vite copies to
  `/assets/`.

  A module-level setting rather than a parameter on every call, because the three consumers -- the
  material dumps, the LUTs and the environment maps -- are reached from three different depths of
  the renderer, and threading a base through `buildScene()` to `loadAuthored()` would put an
  argument nobody reads on every function between them.
*/

let base = '/assets';

/** Point the renderer at a different asset root, for a harness serving its own copy. */
export function setAssetBase(value) {
  base = String(value ?? '').replace(/\/+$/, '');
}

export function assetBase() {
  return base;
}

export function assetUrl(path) {
  return `${base}/${String(path).replace(/^\/+/, '')}`;
}
