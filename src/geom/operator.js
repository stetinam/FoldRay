/*
  One symmetry operator, applied to one point in place.

  --------------------------------------------------------------------------------------------
  WHY THE SWEEP NEEDS THIS AND THE SPHERES DO NOT.

  An atom carries `StructureProperties.atom.x`, which reads the *unit's* conformation -- the
  operator is already on it -- so every sphere, stick, marker and surface in this tree has always
  been where the molecule is. The sweep does not read atoms. It reads `PolymerTraceIterator`, whose
  control points come out of `atomicConformation.x[index]`: **model space, the deposition's own
  coordinates, the same numbers for every unit an assembly expanded from one chain.**

  So a swept look drew a biological assembly as one copy with N-1 more stacked inside it. 10EC's
  twelve-fold portal ring swept all 5,472 residues and emitted 2.09 M triangles into a bounding box
  of 76.9 x 73.7 A, against the atoms' 163.0 x 163.0. On screen that is one subunit -- correct in
  every detail, in the wrong place, eleven times over -- beside a sphere pack of the whole ring.

  `geom/bases.js` already recorded that the trace is model space and matched it on purpose, which
  is right: a base has to land on its own backbone. The answer is not to stop matching it but to
  put the finished geometry back where the unit is, which is what this does.

  --------------------------------------------------------------------------------------------
  WHAT IT IS SAFE TO ASSUME.

  `operator.matrix` is Mol*'s own `Mat4`: **column-major**, so the translation is m[12..14]. The
  operators a biological assembly is built from are rigid, so:

  - a direction takes the same 3x3 as a point, without the translation;
  - a normal needs no inverse transpose and comes back unit length, so nothing renormalises;
  - a distance is preserved, which is what lets `geom/rails.js` keep deciding `flipped` and
    `SAME_POINT` on transformed points and get the same answers it got on model-space ones;
  - a radius is untouched.

  **The identity returns before touching anything.** That is not an optimisation. Every deposition
  and every asymmetric unit is all-identity -- 3RGK's assembly is six units and all six -- so it is
  what keeps every recorded picture bit-exact across a change that moves geometry. Same rule as
  `twist`'s zero in `geom/frame.js` and the transmission lobe's short circuit in `pathtrace.wgsl`.
*/

/**
 * `out[at .. at+2]`, moved onto `operator`. A direction takes the rotation only.
 *
 * `out` is anything indexable by three consecutive slots: a flat position array at `at`, or a
 * three-element point at 0.
 */
export function applyOperator(operator, out, at = 0, direction = false) {
  if (operator === undefined || operator.isIdentity) return out;
  const m = operator.matrix;
  const x = out[at], y = out[at + 1], z = out[at + 2];
  out[at] = m[0] * x + m[4] * y + m[8] * z + (direction ? 0 : m[12]);
  out[at + 1] = m[1] * x + m[5] * y + m[9] * z + (direction ? 0 : m[13]);
  out[at + 2] = m[2] * x + m[6] * y + m[10] * z + (direction ? 0 : m[14]);
  return out;
}
