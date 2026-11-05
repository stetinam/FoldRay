/*
  The scene build, off the main thread.

  The BVH build is a single-threaded JavaScript binned-SAH pass that the live viewport re-runs on
  every representation edit, every structure load and every Style apply. With a live viewport that
  is a visible freeze rather than a frame-budget overrun. There are three ways out; this is the
  first: a Worker with the geometry passed as `ArrayBuffer`s.

  It is deliberately not the other two. `SharedArrayBuffer` avoids the one copy this pays, but it
  needs COOP/COEP response headers, and that decides the *host* before the renderer exists -- a
  static host which cannot set arbitrary headers would be ruled out by a renderer-internal
  optimisation. A compute-shader build avoids the copy too and is a larger change to renderer code
  rather than to glue. Both stay available; neither is needed for the number measured here.

  The file is tiny on purpose: everything it does is in `scene-geometry.js`, which the main thread
  also calls directly when a Worker is unavailable. One implementation, two hosts.
*/

import { prepareSceneGeometry, preparedTransferables } from './scene-geometry.js';

self.onmessage = (event) => {
  const { id, geometry } = event.data;
  try {
    const prepared = prepareSceneGeometry(geometry);
    self.postMessage({ id, prepared }, preparedTransferables(prepared));
  } catch (error) {
    // A message, not a throw. An uncaught throw here reaches `worker.onerror` as a bare
    // "Script error" on some hosts, and the main thread would report a broken scene as a broken
    // Worker -- then silently fall back and build the same broken scene again.
    self.postMessage({ id, error: error?.message ?? String(error) });
  }
};
