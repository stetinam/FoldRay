/*
  Grow-by-doubling typed lists, for the four mesh streams and the scene's own six.

  **This exists because building the geometry was mostly not building the geometry.** Profiled on
  1AON's cartoon (8,029 residues, 3,010,480 triangles, `node --cpu-prof` over four builds), the
  scene build spent its time like this:

  | | |
  | --- | --- |
  | `appendMesh` -- copying a finished mesh into the scene's vertex list | 22.3% |
  | `emitVertices` -- pushing positions, normals and colours | 14.6% |
  | `buildScene`'s own frame, which is `new Float32Array(out.vertices)` on a 24 M-element array | 10.5% |
  | the garbage collector | 10.5% |
  | `emitTube` -- pushing indices | 6.1% |
  | `finish` -- `Float32Array.from(mesh.positions)` | 3.7% |

  Two thirds of a 1.15 s build, and every line of it is storage rather than arithmetic. A plain
  `Array` of numbers is a boxed, growable, double-width thing that has to be walked and converted at
  the end; these are the typed array the caller wanted, written into directly.

  **The values are identical, and that is a property of where the rounding happens rather than an
  approximation.** A double pushed into an `Array` and then converted by `new Float32Array(array)`
  is rounded to float32 exactly once, at the conversion; a double written into a `Float32Array` is
  rounded to float32 exactly once, at the write. One rounding either way, the same rounding, so
  every vertex, every normal and every colour comes out bit for bit what it was -- which is what the
  byte-identity of every recorded picture rests on.

  **One case rounds twice, it is named here rather than left to be discovered, and it is measured.**
  `transformMesh()` in `sweep.js` revisits what a unit emitted and puts it on the unit's symmetry
  operator. Positions arrive from a `Float32Array` grid, so they are float32 values before they are
  stored and the store changes nothing; **shading normals arrive from `surfaceNormal()` as doubles**,
  so they are now rounded before the operator instead of after it. Measured on 10EC's twelve-fold
  portal ring, 1,144,896 vertices, old against new:

  | | |
  | --- | --- |
  | position components differing | **0** of 3,434,688 |
  | colour components differing | **0** |
  | normal components differing | 516,060 of 3,434,688, **max 5.96e-8** -- one float32 ULP |
  | worst normal direction change | **3.4e-6 degrees** |

  It reaches nothing else: an operator that `isIdentity` returns before touching anything, so every
  deposition, every asymmetric unit and every recorded picture -- 3RGK's assembly is six identity
  operators -- is bit for bit unmoved. Only a symmetry-*expanded* assembly is in scope, and only its
  normals, by a third of a millionth of a degree. It is written down because nothing that compares
  pictures can see it, which is exactly the kind of change this tree insists on stating out loud.

  **Fixed-arity pushes rather than rest arguments**, because a rest parameter allocates an array per
  call and this is called once per vertex. Three at a time is what every caller in the tree wants:
  a position, a normal, a colour, a triangle.
*/

/**
 * The starting capacity, in elements.
 *
 * Small enough that a scene of a few hundred primitives does not allocate a megabyte, large enough
 * that a real mesh reaches its size in twelve doublings rather than twenty. A caller that knows
 * roughly how big its mesh will be should say so -- `hint` costs nothing and saves the copies.
 */
const INITIAL_CAPACITY = 4096;

class TypedList {
  constructor(Kind, hint = INITIAL_CAPACITY) {
    this.Kind = Kind;
    this.data = new Kind(Math.max(4, hint));
    this.length = 0;
  }

  /*
    Doubling, and never by less than what is being asked for.

    `set()` on the grown array is one `memcpy` in every engine, so the total copied across a build
    is bounded by twice the final size however many times it grows.
  */
  reserve(extra) {
    const need = this.length + extra;
    if (need <= this.data.length) return;
    let capacity = this.data.length * 2;
    while (capacity < need) capacity *= 2;
    const grown = new this.Kind(capacity);
    grown.set(this.data);
    this.data = grown;
  }

  push3(a, b, c) {
    if (this.length + 3 > this.data.length) this.reserve(3);
    const at = this.length;
    this.data[at] = a;
    this.data[at + 1] = b;
    this.data[at + 2] = c;
    this.length = at + 3;
  }

  push4(a, b, c, d) {
    if (this.length + 4 > this.data.length) this.reserve(4);
    const at = this.length;
    this.data[at] = a;
    this.data[at + 1] = b;
    this.data[at + 2] = c;
    this.data[at + 3] = d;
    this.length = at + 4;
  }

  push6(a, b, c, d, e, f) {
    if (this.length + 6 > this.data.length) this.reserve(6);
    const at = this.length;
    this.data[at] = a;
    this.data[at + 1] = b;
    this.data[at + 2] = c;
    this.data[at + 3] = d;
    this.data[at + 4] = e;
    this.data[at + 5] = f;
    this.length = at + 6;
  }

  push8(a, b, c, d, e, f, g, h) {
    if (this.length + 8 > this.data.length) this.reserve(8);
    const at = this.length;
    this.data[at] = a;
    this.data[at + 1] = b;
    this.data[at + 2] = c;
    this.data[at + 3] = d;
    this.data[at + 4] = e;
    this.data[at + 5] = f;
    this.data[at + 6] = g;
    this.data[at + 7] = h;
    this.length = at + 8;
  }

  /**
   * The list as exactly its own length.
   *
   * A copy, so the caller owns a buffer nothing else can grow underneath it -- which matters here:
   * `preparedTransferables()` hands these buffers to a Worker, and a transferred buffer with slack
   * on the end would carry the slack across and detach a list still in use.
   */
  toTyped() {
    return this.data.length === this.length ? this.data : this.data.slice(0, this.length);
  }
}

export class FloatList extends TypedList {
  constructor(hint) {
    super(Float32Array, hint);
  }
}

export class IndexList extends TypedList {
  constructor(hint) {
    super(Uint32Array, hint);
  }
}
