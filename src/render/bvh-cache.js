/*
  The BVH, kept by geometry signature.

  The BVH build reruns whenever geometry changes -- every representation edit, every structure
  load, every Style apply -- because the viewport is live, and on a cartoon it is 555 ms of the
  670 ms a scene build takes. **Most of those rebuilds build the same tree.** A Style that differs
  from the one before it only in material, colour or opacity does not move a triangle, and a
  gallery drawing seven tiles of one representation pays seven identical builds, which is most of
  its ~21 s on a 15 W laptop.

  ---

  ## What the signature covers, and the one thing it must not

  **Positions and topology, never appearance.** The BVH is built over primitive *bounds*, so it
  depends on sphere centres and radii, cylinder endpoints and radii, triangle vertex positions and
  the index list -- and on nothing else. Hashing the colours too would be simpler and would defeat
  the whole feature: the case this exists for is precisely two scenes that differ only in colour.

  That is why the vertex hash strides. `scene.js` interleaves each vertex as three `vec4f` --
  position, normal, colour -- so a quarter of that array is what the tree is built from and the
  other three quarters are what a Style changes. The stride is not an optimisation; it is the
  correctness condition.

  **The interleaved outputs are deliberately not cached.** `prepareSceneGeometry()` returns
  `spheres` and `cylinders` with their colours and material indices packed in, so caching those
  under a geometry-only signature would hand the second Style the first one's colours. Only the two
  buffers that are a pure function of the geometry -- `nodes` and `order` -- live here, and the
  interleave runs every time. It is the cheap half: a cartoon's interleave is a few hundred analytic
  primitives while its BVH is 219,072 triangles' worth of binned SAH.

  ---

  ## Why a hash rather than an identity check

  Two scenes built from one structure at one representation are different array objects with equal
  contents, so reference equality would never hit. A content hash is what makes them the same key.

  It is FNV-1a in two independent 32-bit lanes -- different offset bases, different primes -- which
  is 64 bits of digest for two multiplies per word. A collision would hand back a tree built for
  different geometry, which is a wrong picture rather than a crash, so the width matters: at 64 bits
  a session would need on the order of a billion distinct scenes before it were an even bet. The
  primitive counts are in the key as plain text beside the digest, so the commonest way for two
  scenes to differ cannot collide at all.

  The hash walks the same words the BVH would read, so it is a fraction of the build it avoids --
  and on a miss it is a fraction of the build it is about to pay for anyway.
*/

/*
  FNV-1a over 32-bit words, two lanes.

  The float bits are hashed rather than the values: `-0` and `0` have different bit patterns and
  therefore different keys, which costs a spurious miss and can never cost a wrong hit. That is the
  right way round.
*/
const LANE_A_BASIS = 0x811c9dc5;
const LANE_B_BASIS = 0x01000193;
const LANE_A_PRIME = 16777619;
const LANE_B_PRIME = 2166136261;

function words(array) {
  return new Uint32Array(array.buffer, array.byteOffset, array.length);
}

/**
 * Hash `count` words of `view`, starting at `offset`, taking `take` of every `stride`.
 *
 * The stride is what lets the vertex buffer contribute its positions and not its colours. Every
 * other array is hashed whole, which is `stride === take`.
 */
function mix(state, view, { offset = 0, stride = 1, take = stride } = {}) {
  let { a, b } = state;
  for (let index = offset; index < view.length; index += stride) {
    for (let word = 0; word < take; word += 1) {
      const value = view[index + word];
      // The shift carries high bits down: a multiply alone never does, so a sign flip or a doubled
      // radius would stay in the top bits of both lanes.
      a = Math.imul(a ^ value, LANE_A_PRIME);
      a = (a ^ (a >>> 15)) >>> 0;
      b = Math.imul(b ^ value, LANE_B_PRIME);
      b = (b ^ (b >>> 15)) >>> 0;
    }
  }
  return { a, b };
}

/**
 * A key for the tree this geometry would build.
 *
 * `geometry` is the same object `prepareSceneGeometry()` takes: `spheres`, `cylinders`, `vertices`
 * and `triangles` plus the two attribute arrays, which are **not** read here.
 */
export function geometrySignature(geometry) {
  const sphereCount = geometry.spheres.length / 4;
  const cylinderCount = geometry.cylinders.length / 8;
  const triangleCount = geometry.triangles.length / 4;

  let state = { a: LANE_A_BASIS, b: LANE_B_BASIS };
  // Whole: `spheres` is `[x, y, z, r]` and `cylinders` is `[ax, ay, az, ra, bx, by, bz, rb]`. Both
  // are geometry with nothing else packed in -- the colours live in the parallel attribute arrays.
  state = mix(state, words(geometry.spheres));
  state = mix(state, words(geometry.cylinders));
  // Whole: three vertex indices and a material index per triangle. The material is in there and it
  // is geometry as far as this is concerned -- it is not part of the tree, but two scenes that
  // differ in it differ in a buffer the tree is indexed alongside, and including it costs nothing.
  state = mix(state, words(geometry.triangles));
  // Strided: the first three words of each twelve-word vertex. See the header.
  state = mix(state, words(geometry.vertices), { stride: 12, take: 3 });

  return `${sphereCount}.${cylinderCount}.${triangleCount}`
    + `:${state.a.toString(36)}.${state.b.toString(36)}`;
}

/** Bytes an entry holds, which is what the cache is bounded by rather than a count alone. */
function entryBytes(entry) {
  return entry.nodes.byteLength + entry.order.byteLength;
}

/*
  A bounded LRU of built trees.

  **Bounded by bytes as well as by entries**, because the two are not proportional: a cartoon's BVH
  is 6.2 MB and a three-sulfate ion style's is a few kilobytes, so a count alone would either hold
  four cartoons or evict a hundred cheap scenes.

  The defaults are chosen against the thing this exists for -- a gallery drawing seven tiles -- plus
  headroom for the user's own scene and the one before it. Nine entries and 96 MB holds that with
  room to spare and is a small fraction of the accumulation buffers a 1024x1024 target already
  costs.
*/
export class BvhCache {
  constructor({ maxEntries = 9, maxBytes = 96 * 1024 * 1024 } = {}) {
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    // `Map` iterates in insertion order, so re-inserting on a hit is the whole LRU.
    this.entries = new Map();
    this.bytes = 0;
    this.hits = 0;
    this.misses = 0;
  }

  get(signature) {
    const entry = this.entries.get(signature);
    if (!entry) {
      this.misses += 1;
      return null;
    }
    this.hits += 1;
    this.entries.delete(signature);
    this.entries.set(signature, entry);
    return entry;
  }

  /**
   * Keep a built tree.
   *
   * A tree larger than the whole budget is **not** kept and does not evict anything: storing it
   * would empty the cache to hold one entry that the next scene evicts again, which is worse than
   * not caching it at all.
   */
  set(signature, entry) {
    const size = entryBytes(entry);
    if (size > this.maxBytes) return;
    if (this.entries.has(signature)) {
      this.bytes -= entryBytes(this.entries.get(signature));
      this.entries.delete(signature);
    }
    this.entries.set(signature, entry);
    this.bytes += size;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.bytes -= entryBytes(this.entries.get(oldest.value));
      this.entries.delete(oldest.value);
    }
  }

  clear() {
    this.entries.clear();
    this.bytes = 0;
  }

  /** What it is holding and how it has been doing, for a readout rather than for a decision. */
  stats() {
    return {
      entries: this.entries.size, bytes: this.bytes, hits: this.hits, misses: this.misses,
    };
  }
}
