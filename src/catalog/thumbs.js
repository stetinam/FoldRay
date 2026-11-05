/*
  Tile artwork lives at src/thumbs/<kind>/<id>.webp, where <kind> is the picker
  key and <id> is the <option> value it decorates. Filling a gap is a matter of
  dropping a file in; no code here changes.

  **WebP rather than PNG, and every one of the 139 tiles is a render made by
  this renderer.** None is a picture of geometry the app cannot produce: a tile
  is baked by driving the same gallery Apply and the same Create Image a user
  presses. The encoding is free at bake time and expensive to redo later.

  Every grid compares like with like, and what each holds fixed is the baker's
  business rather than this file's: the protein grids render one subject with one
  control varied, the material grid renders one surface under one light twelve
  times, and each Style renders on its own subject through its own camera.

  The glob is what makes the bundler emit the files, so it has to be a literal
  call Vite can rewrite. Outside a bundler import.meta.glob is undefined and
  calling it throws, which is the signal that no artwork is resolvable in this
  environment; the tiles on disk are asserted separately.
*/
let bundled = {};
try {
  bundled = import.meta.glob('../thumbs/**/*.webp', {
    eager: true,
    query: '?url',
    import: 'default',
  });
} catch {
  bundled = {};
}

const BY_KEY = new Map(
  Object.entries(bundled).map(([path, url]) => {
    const segments = path.split('/');
    const id = segments.pop().replace(/\.webp$/, '');
    const kind = segments.pop();
    return [`${kind}/${id}`, url];
  }),
);


export function thumbUrl(kind, id) {
  return BY_KEY.get(`${kind}/${id}`);
}
