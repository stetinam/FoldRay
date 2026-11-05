/*
  Everything `setScene()` does before it touches the GPU, as one pure function.

  It is a separate module for one reason: it is the whole of the stall, and it has to be callable
  from a Worker. The stall is wall-clock across the whole of `setScene()` rather than `bvhTime`:
  the per-primitive interleave loops and the `bounds` array run *before* the BVH timer starts and
  the GPU buffer creation runs after it. Moving only `buildBvh()` off the main thread would leave
  the loops behind, and on the bench cartoon they are not free.

  So the split is: this module owns everything that is arithmetic over typed arrays, and
  `renderer.js` keeps everything that needs a `GPUDevice`. Nothing here touches `document`,
  `navigator.gpu` or the renderer instance, which is what makes it legal inside a Worker and
  testable in `node --test` without a browser.

  Determinism matters more than it looks: the bench compares pixels byte for byte, so this code
  must not change one node of the tree `setScene()` would have built inline.
*/

import { buildBvh } from './bvh.js';

/**
 * Interleave the analytic primitives with their attributes, bound every primitive, and build the
 * BVH over the lot.
 *
 * `geometry` is the subset of a `buildScene()` result this needs: `spheres`, `sphereAttributes`,
 * `cylinders`, `cylinderAttributes`, `vertices` and `triangles`. `materials` and `notes` stay on
 * the main thread -- they are not typed arrays and nothing here reads them.
 *
 * `cached` is a tree already built for this exact geometry (`render/bvh-cache.js`), and passing one
 * skips **both** the BVH build and the `bounds` array that feeds it -- which is the larger half on
 * a mesh-heavy scene, since bounding a triangle reads three vertices. The interleave still runs,
 * and it must: `spheres` and `cylinders` carry each primitive's colour and material index, so a
 * scene that differs from the cached one only in colour needs them rebuilt and needs the same tree.
 * That asymmetry is the whole design; `bvh-cache.js` has the argument.
 */
export function prepareSceneGeometry(geometry, cached = null) {
  const sphereCount = geometry.spheres.length / 4;
  const cylinderCount = geometry.cylinders.length / 8;
  const triangleCount = geometry.triangles.length / 4;
  const total = sphereCount + cylinderCount + triangleCount;

  /*
    The interleaves and the bounds below are written as direct element assignment rather than as
    `set(subarray(...))` and `set([...])`.

    Both of those allocate per primitive -- a `subarray` is a new typed-array *object* and an array
    literal is a new array -- and this runs over every sphere, every cylinder and every triangle of
    every scene the app builds. On 1AON's ball-and-stick (58,674 spheres and 59,087 cylinders) that
    is a quarter of a million short-lived objects for six floats each. The arithmetic is identical
    either way; only the garbage is gone.
  */
  const spheres = new Float32Array(Math.max(sphereCount, 1) * 8);
  for (let index = 0; index < sphereCount; index += 1) {
    const from = index * 4;
    const to = index * 8;
    spheres[to] = geometry.spheres[from];
    spheres[to + 1] = geometry.spheres[from + 1];
    spheres[to + 2] = geometry.spheres[from + 2];
    spheres[to + 3] = geometry.spheres[from + 3];
    spheres[to + 4] = geometry.sphereAttributes[from];
    spheres[to + 5] = geometry.sphereAttributes[from + 1];
    spheres[to + 6] = geometry.sphereAttributes[from + 2];
    spheres[to + 7] = geometry.sphereAttributes[from + 3];
  }
  const cylinders = new Float32Array(Math.max(cylinderCount, 1) * 12);
  for (let index = 0; index < cylinderCount; index += 1) {
    const from = index * 8;
    const attribute = index * 4;
    const to = index * 12;
    cylinders[to] = geometry.cylinders[from];
    cylinders[to + 1] = geometry.cylinders[from + 1];
    cylinders[to + 2] = geometry.cylinders[from + 2];
    cylinders[to + 3] = geometry.cylinders[from + 3];
    cylinders[to + 4] = geometry.cylinders[from + 4];
    cylinders[to + 5] = geometry.cylinders[from + 5];
    cylinders[to + 6] = geometry.cylinders[from + 6];
    cylinders[to + 7] = geometry.cylinders[from + 7];
    cylinders[to + 8] = geometry.cylinderAttributes[attribute];
    cylinders[to + 9] = geometry.cylinderAttributes[attribute + 1];
    cylinders[to + 10] = geometry.cylinderAttributes[attribute + 2];
    cylinders[to + 11] = geometry.cylinderAttributes[attribute + 3];
  }

  if (cached) {
    return {
      spheres,
      cylinders,
      nodes: cached.nodes,
      order: cached.order,
      // Zero because no tree was built, and `bvhCached` beside it so a readout can say *why* it is
      // zero. A timing of 0 ms with nothing to explain it reads as a broken measurement.
      bvhTime: 0,
      bvhCached: true,
      counts: {
        sphereCount, cylinderCount, triangleCount, total,
        nodes: cached.nodeCount, maxDepth: cached.maxDepth,
      },
    };
  }

  const bounds = new Float32Array(total * 6);
  let cursor = 0;
  for (let index = 0; index < sphereCount; index += 1) {
    const from = index * 4;
    const x = geometry.spheres[from];
    const y = geometry.spheres[from + 1];
    const z = geometry.spheres[from + 2];
    const r = geometry.spheres[from + 3];
    const at = cursor * 6;
    bounds[at] = x - r; bounds[at + 1] = y - r; bounds[at + 2] = z - r;
    bounds[at + 3] = x + r; bounds[at + 4] = y + r; bounds[at + 5] = z + r;
    cursor += 1;
  }
  for (let index = 0; index < cylinderCount; index += 1) {
    const from = index * 8;
    const ax = geometry.cylinders[from];
    const ay = geometry.cylinders[from + 1];
    const az = geometry.cylinders[from + 2];
    const bx = geometry.cylinders[from + 4];
    const by = geometry.cylinders[from + 5];
    const bz = geometry.cylinders[from + 6];
    // The wider of the two ends. A cone's box is its fat end's, and a cylinder's two are equal, so
    // this is exactly the box it always was for everything but a tapering rail -- which matters:
    // the bench hashes pixels exactly, and a box decides the tree.
    const r = Math.max(geometry.cylinders[from + 3], geometry.cylinders[from + 7]);
    const at = cursor * 6;
    /*
      `Math.min`/`Math.max` rather than a ternary, deliberately: they differ on `-0` and on NaN, and
      a bound of `-0` where the old code wrote `0` reaches the slab test as a sign flip on a
      division by zero. This loop is being made cheaper by not allocating, not by second-guessing
      the comparison.
    */
    bounds[at] = Math.min(ax, bx) - r;
    bounds[at + 1] = Math.min(ay, by) - r;
    bounds[at + 2] = Math.min(az, bz) - r;
    bounds[at + 3] = Math.max(ax, bx) + r;
    bounds[at + 4] = Math.max(ay, by) + r;
    bounds[at + 5] = Math.max(az, bz) + r;
    cursor += 1;
  }
  for (let index = 0; index < triangleCount; index += 1) {
    const corner = index * 4;
    const a = geometry.triangles[corner] * 12;
    const b = geometry.triangles[corner + 1] * 12;
    const c = geometry.triangles[corner + 2] * 12;
    const at = cursor * 6;
    for (let axis = 0; axis < 3; axis += 1) {
      const va = geometry.vertices[a + axis];
      const vb = geometry.vertices[b + axis];
      const vc = geometry.vertices[c + axis];
      bounds[at + axis] = Math.min(va, vb, vc);
      bounds[at + 3 + axis] = Math.max(va, vb, vc);
    }
    cursor += 1;
  }

  const started = now();
  const bvh = buildBvh(bounds, total);
  const bvhTime = now() - started;

  return {
    spheres,
    cylinders,
    nodes: bvh.nodes,
    order: bvh.order,
    bvhTime,
    bvhCached: false,
    counts: {
      sphereCount, cylinderCount, triangleCount, total,
      nodes: bvh.nodeCount, maxDepth: bvh.maxDepth,
    },
  };
}

/** Available on `window`, on `WorkerGlobalScope` and in node, so this needs no host check. */
function now() {
  return performance.now();
}

/**
 * The four buffers a Worker hands back, for its `postMessage` transfer list.
 *
 * These are all *outputs* -- allocated inside `prepareSceneGeometry()` and never referenced again
 * by the side that made them -- so transferring them is free and safe. The *inputs* are cloned
 * rather than transferred, deliberately; `renderer.js` says why.
 *
 * **A cache hit never goes through a Worker**, so `nodes` and `order` being shared with the cache
 * on that path is not a transfer hazard: `renderer.js` checks the cache *before* it posts, and a
 * prepared result that came back from a Worker owns buffers nothing else holds.
 */
export function preparedTransferables(prepared) {
  return [prepared.spheres.buffer, prepared.cylinders.buffer,
    prepared.nodes.buffer, prepared.order.buffer];
}
