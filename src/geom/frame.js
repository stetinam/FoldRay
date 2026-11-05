/*
  The cross-section's frame, and the one thing this tree does to Mol*'s.

  `sweep.js` reads the frame Mol* built -- `normalVectors` and `binormalVectors`, through
  `crossSectionAxes()` -- and stands the cross-section in it. That frame decides which way the
  ribbon's broad face points, so **how the roll is distributed along a residue is the difference
  between a helix that coils and a helix that looks folded out of tiles.**

  ## What Mol* does, and why it is uneven

  `interpolateNormals` (`mol-repr/.../polymer/curve-segment.js`, MIT) has to get from the frame the
  *previous* residue ended on to the frame the *next* one starts on, inside one segment. It does it
  by slerping toward the far end on a `smoothstep`-warped schedule:

      j = smoothstep(0, n - 1, i) * (n - 1)
      t = i === 0 ? 0 : 1 / (n - j)

  which is monotone and lands exactly on the far frame, so it is correct -- and it is not even. `t`
  stays small for most of the segment and then rises sharply, so most of a residue's roll happens in
  its last third. A three-tap box pass over rows `1 .. n-2` softens it and cannot remove it, because
  the schedule is what it is smoothing.

  **Measured** on 3RGK, 1UBQ and 3ECA, as the frame's rotation about its own tangent per step, with
  a residue's eight steps binned by position:

      step        0     1     2     3     4     5     6     7      <- 0 leaves a residue boundary
      3RGK     1.85  2.66  3.94  4.99  7.01  8.81  7.66  5.84  deg
      3ECA     2.04  2.53  3.58  4.88  6.79  8.20  6.86  5.02  deg

  A 4.8x swing, in phase with the residues, on all three. The spine has nothing to do with it: a
  ribbon with a **circular** cross-section is drawn on exactly the same curve and is smooth, because
  a circle has no frame to get wrong.

  **This is not the boundary defect it looks like.** `interpolateNormals`' box pass runs
  `for (i = 1; i < n - 1)`, so rows 0 and 8 -- the two a residue shares with its neighbours -- keep
  their raw values, which reads like a systematic kink once per residue. It is not: those two rows
  are the *anchors*, they carry the least roll of any step in the residue, and the excess is in the
  middle. The hypothesis was worth testing and the measurement above is what refuted it.

  ## What we do

  Spread the residue's own roll evenly along its own arc length, keeping both ends exactly as Mol*
  left them. The ends are the whole of the residue-to-residue agreement -- each is a frame derived
  from one residue's smoothed peptide direction (`d12` / `d23`) -- so anchoring them means

  * **no residue's stated orientation moves.** The ribbon still faces where the protein says, once
    per residue. Only the schedule between two consecutive statements changes;
  * **the joins stay exact.** Two neighbours share a row and both leave it alone, so nothing can
    open a seam that was closed;
  * **the beta pleat survives**, for the same reason: it is a property of the anchors.

  `strength` is the blend, and 0 is a bit-exact no-op -- the property the denoiser's own strength 0
  has, and for the same reason. 1 is fully even.

  ## Why the angles are folded into (-90, 90]

  The cross-section is centrosymmetric, so a half turn about the tangent maps the ribbon exactly
  onto itself and "the frame rotated by 175 degrees" and "the frame rotated by -5 degrees" are the
  same picture. Every step is folded to the smaller of the two before it is accumulated, which is
  unambiguous here because the largest single step measured on any of the three structures is 38.7
  degrees. Accumulating the *unfolded* angles would let one sign convention inside Mol* turn into a
  half-turn of ribbon spread across one residue.
*/

/** Below this there is no rotation to spread and no arc to spread it over. */
const EPSILON = 1e-9;

/**
 * How much the schedule eases in and out of each residue, rather than running at a flat rate.
 *
 * **A flat rate inside every residue is not the same as a flat rate along the chain**, and this
 * number is the difference. Each residue's roll total is its own, so a purely even schedule leaves
 * the *rate* stepping at every join -- and where Mol*'s schedule breaks the rate by 3x at each join
 * (5.84 degrees on the last step of a residue against 1.85 on the next residue's first), a purely
 * even one breaks it by however much two neighbours' totals differ. A break in the rate is a
 * crease, and a crease is the visible failure: it is a line down the ribbon once per residue, and
 * on the railed look it is a real corner in an analytic tube that `rails.js` cannot subdivide away.
 *
 * `3u^2 - 2u^3` has zero rate at both ends, so **every join matches every join, with no residue
 * needing to know anything about its neighbours.** That is the whole reason for the shape. The cost
 * is a rate that rises to 1.5x in the middle of each residue and falls back, which is a smooth
 * modulation rather than a break -- and smooth modulation is what the eye does not see.
 *
 * Measured on 3RGK, both consequences read off the mesh itself -- the angle between the two shading
 * normals at a vertex two residues share, and the worst crease at a rail joint:
 *
 * | schedule | `cartoon` seam mean / p95 / max | `cartoon_railed` worst rail crease |
 * | --- | --- | --- |
 * | Mol*'s own | 7.38 / 22.16 / 56.30 deg | 11.80 deg |
 * | fully even | 4.35 / 22.17 / 56.62 | 13.77 |
 * | **eased, this** | **1.11 / 3.85 / 9.37** | **10.60** |
 *
 * Even beats Mol* on the average and not on the tail, which is the tell: it moved the roll off the
 * places Mol* piled it up and left a break of its own at every join. Easing removes the break
 * instead of relocating it, and is the only one of the three that improves the rail.
 */
const SCHEDULE_EASE = 1;

/*
  Grow-only scratch, for the reason `sweep.js`'s `Scratch` has some: this runs once per residue and
  a structure is thousands of them, so four typed arrays allocated and dropped per call would be the
  most expensive thing in the file.
*/
let axisBuffer = new Float32Array(0);
let carriedBuffer = new Float32Array(0);
let arcBuffer = new Float32Array(0);
let rolledBuffer = new Float32Array(0);
const movedBuffer = new Float32Array(3);
const scratch = new Float32Array(3);

function room(rows) {
  if (axisBuffer.length < rows * 3) {
    axisBuffer = new Float32Array(rows * 3);
    carriedBuffer = new Float32Array(rows * 3);
    arcBuffer = new Float32Array(rows);
    rolledBuffer = new Float32Array(rows);
  }
}

/**
 * Even out one residue's roll, in place.
 *
 * `axesU` and `axesV` are `rows` frames, three floats each, as `crossSectionAxes()` wrote them:
 * unit length and exactly perpendicular to each other, though **not** to Mol*'s tangent (the frame
 * is not orthonormal, measured). So the rotation axis here is the frame's own
 * third vector, `u x v`, and never the tangent: rotating about the tangent would shear a frame that
 * is up to 7.5 degrees off it, and the ribbon's two axes would stop being square to each other.
 *
 * `points` is the spine, three floats per row, *after* the overhang -- the arc the surface actually
 * follows.
 */
export function spreadTwist(axesU, axesV, points, rows, strength) {
  if (!(strength > 0) || rows < 3) return;

  const last = rows - 1;
  room(rows);
  const axis = axisBuffer;
  const arc = arcBuffer;
  arc[0] = 0;
  for (let row = 0; row < rows; row += 1) {
    const at = row * 3;
    cross(axis, at, axesU, axesV, at);
    if (!normalizeAt(axis, at)) return;      // a degenerate frame: leave the residue alone
    if (row > 0) {
      arc[row] = arc[row - 1] + Math.hypot(
        points[at] - points[at - 3],
        points[at + 1] - points[at - 2],
        points[at + 2] - points[at - 1],
      );
    }
  }
  const total = arc[last];
  if (!(total > EPSILON)) return;

  /*
    Two walks down the segment at once.

    `carried` is the roll-free reference: row 0's width axis carried along by the minimal rotation
    from each row's frame axis to the next's, so it turns with the curve and never about it.
    `rolled` is how far Mol* has rolled past that reference by each row, accumulated from **one
    step at a time** -- each step's own rotation is folded, then added. Reading the total off
    `carried` against Mol*'s axis in one go would be the ambiguous form of the same number: it is a
    rotation modulo 180 degrees, and a residue can roll further than that.
  */
  const carried = carriedBuffer;
  const rolled = rolledBuffer;
  const moved = movedBuffer;
  carried[0] = axesU[0]; carried[1] = axesU[1]; carried[2] = axesU[2];
  rolled[0] = 0;
  for (let row = 1; row < rows; row += 1) {
    const at = row * 3;
    transport(carried, at, carried, at - 3, axis, at - 3, axis, at);
    if (!normalizeAt(carried, at)) return;
    transport(moved, 0, axesU, at - 3, axis, at - 3, axis, at);
    if (!normalizeAt(moved, 0)) return;
    rolled[row] = rolled[row - 1] + fold(signedAngle(moved, 0, axesU, at, axis, at, scratch));
  }

  /*
    Rewrite the interior rows only. Row 0 and row `last` are the anchors -- what the neighbouring
    residues share -- and are not touched, so `strength` cannot move a join.
  */
  for (let row = 1; row < last; row += 1) {
    const at = row * 3;
    const target = rolled[last] * schedule(arc[row] / total);
    const turn = rolled[row] + (target - rolled[row]) * strength;
    rotateAbout(axesU, at, carried, at, axis, at, turn);
    // v completes the right-handed triple the frame already was: u x v = axis, so v = axis x u.
    cross(axesV, at, axis, axesU, at);
    normalizeAt(axesV, at);
  }
}

/**
 * How far through its roll the residue is, at fraction `u` of its own arc length.
 *
 * See `SCHEDULE_EASE`. `u - u` cancels to the straight line at ease 0 and to `3u^2 - 2u^3` at 1.
 */
function schedule(u) {
  return u + SCHEDULE_EASE * (u * u * (3 - 2 * u) - u);
}

/** The representative of `degrees` in `(-90, 90]`. See the file header. */
function fold(degrees) {
  let value = degrees;
  while (value > 90) value -= 180;
  while (value <= -90) value += 180;
  return value;
}

/** `out[at..] = a[atA..] x b[atB..]`, where `a` and `b` share the offset. */
function cross(out, at, a, b, atAB) {
  const ax = a[atAB]; const ay = a[atAB + 1]; const az = a[atAB + 2];
  const bx = b[atAB]; const by = b[atAB + 1]; const bz = b[atAB + 2];
  out[at] = ay * bz - az * by;
  out[at + 1] = az * bx - ax * bz;
  out[at + 2] = ax * by - ay * bx;
}

function normalizeAt(array, at) {
  const length = Math.hypot(array[at], array[at + 1], array[at + 2]);
  if (!(length > EPSILON)) return false;
  array[at] /= length; array[at + 1] /= length; array[at + 2] /= length;
  return true;
}

/** Rotate `source[atS..]` by the minimal rotation taking unit `from` to unit `to`. Rodrigues. */
function transport(out, at, source, atS, from, atF, to, atT) {
  const fx = from[atF]; const fy = from[atF + 1]; const fz = from[atF + 2];
  const tx = to[atT]; const ty = to[atT + 1]; const tz = to[atT + 2];
  let kx = fy * tz - fz * ty;
  let ky = fz * tx - fx * tz;
  let kz = fx * ty - fy * tx;
  const s = Math.hypot(kx, ky, kz);
  const c = fx * tx + fy * ty + fz * tz;
  const vx = source[atS]; const vy = source[atS + 1]; const vz = source[atS + 2];
  if (!(s > EPSILON)) {
    const sign = c >= 0 ? 1 : -1;
    out[at] = vx * sign; out[at + 1] = vy * sign; out[at + 2] = vz * sign;
    return;
  }
  kx /= s; ky /= s; kz /= s;
  const kv = kx * vx + ky * vy + kz * vz;
  out[at] = vx * c + (ky * vz - kz * vy) * s + kx * kv * (1 - c);
  out[at + 1] = vy * c + (kz * vx - kx * vz) * s + ky * kv * (1 - c);
  out[at + 2] = vz * c + (kx * vy - ky * vx) * s + kz * kv * (1 - c);
}

/** The signed angle from `a` to `b` about unit `axis`, in degrees. */
function signedAngle(a, atA, b, atB, axis, atAxis, scratch) {
  const ax = a[atA]; const ay = a[atA + 1]; const az = a[atA + 2];
  const bx = b[atB]; const by = b[atB + 1]; const bz = b[atB + 2];
  scratch[0] = ay * bz - az * by;
  scratch[1] = az * bx - ax * bz;
  scratch[2] = ax * by - ay * bx;
  const sin = scratch[0] * axis[atAxis] + scratch[1] * axis[atAxis + 1] + scratch[2] * axis[atAxis + 2];
  const cos = ax * bx + ay * by + az * bz;
  return Math.atan2(sin, cos) * (180 / Math.PI);
}

/** `out[at..] = source[atS..] rotated by `degrees` about unit `axis`. */
function rotateAbout(out, at, source, atS, axis, atAxis, degrees) {
  const radians = degrees * (Math.PI / 180);
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const kx = axis[atAxis]; const ky = axis[atAxis + 1]; const kz = axis[atAxis + 2];
  const vx = source[atS]; const vy = source[atS + 1]; const vz = source[atS + 2];
  const kv = kx * vx + ky * vy + kz * vz;
  out[at] = vx * c + (ky * vz - kz * vy) * s + kx * kv * (1 - c);
  out[at + 1] = vy * c + (kz * vx - kx * vz) * s + ky * kv * (1 - c);
  out[at + 2] = vz * c + (kx * vy - ky * vx) * s + kz * kv * (1 - c);
}
