/*
  The helix rod: the cylindrical cartoon's helix, drawn as a cylinder.

  `helixOrientation` moves the curve onto the helix axis. A fat circular cross-section swept along
  that axis tapers into the loop at each end the way every other kind tapers into its neighbours,
  and renders a sausage. **A cylinder is not a fat tube; it is a constant radius that stops.** Two
  things make the difference and neither is the radius:

  1. **It does not taper.** The rod is one radius from end to end, so the eye reads a solid of
     revolution rather than a swelling.
  2. **It ends in a flat disc.** The rim of that disc is the whole signature of the look -- it is
     what a helix seen end-on is, and it is what the thin loop appears to emerge from.

  Both were chosen by eye in front of this renderer. The numbers below are what the picture asked
  for.

  ---

  ## Why it is analytic and not a swept mesh

  *Analytic beats tessellated; never mesh something the tracer can intersect.* A
  constant-radius tube along a polyline is exactly a capsule chain -- a sphere at every joint and a
  capped cylinder between consecutive ones -- and the tracer intersects both exactly. So the rod is
  cheaper than the mesh it replaces **and** its silhouette and its cap rim are exact at any zoom,
  which matters more here than anywhere else: the cap rim is the feature the look is read by, and a
  tessellated one is a 24-gon.

  This is the same construction `rails.js` makes for a cord on a panel edge, and it shares that
  file's chain emitter for the same reason a rail needs one -- the spheres are load-bearing, because
  the tracer's cylinders are flat-capped and a chain of rods alone creases at every joint.

  **Except at the two ends, where the spheres are exactly wrong.** A rail runs out to a point and
  wants its end sphere; a rod wants the flat cap the terminal cylinder already has, and a sphere
  there would round off the one edge the look exists to show. That is the whole of what
  `roundStart` / `roundEnd` are for.

  ## Why it follows Mol*'s axis instead of being one straight cylinder

  The obvious reading of "draw the helix as a cylinder" is one cylinder per helix, fitted. It is
  wrong, and the measurement says so: fitting each contiguous helix run
  to its own least-squares line leaves the axis by up to **10.16 A** on 4HHB (a 38-residue run
  spanning 36.7 A), 8.40 A on 3RGK and 6.84 A on 3ECA. A 2 A rod misses its own helix by five radii.
  Long helices are curved, and the reference render agrees -- its long rods are visibly banana-shaped
  and only the short ones read as straight.

  So the rod rides the spine the sweep already produced, which is Mol*'s axis, and inherits the fold
  for free.

  ## Where a rod ends, which is not where `emitCap()` caps

  The same distinction `rails.js` draws, for the same reason. A run is a **contiguous stretch of
  helix**: it breaks at a chain terminus, at a residue nobody drew, and where the kind stops being
  `helix`. It does **not** break at `secStrucFirst` / `secStrucLast`. Mol*'s trace normalises every
  helix type, so inside a helix those never fire -- counted on real structures they are 1 per run,
  the run's own start -- and the two groupings agree.

  ## The sampling rate, which is the sweep's own rate divided by eight

  **A rod takes one point per residue, not the sweep's eight, and hands the subdivision back to
  `rails.js` to put them where the rod actually bends.** Both halves of that matter.

  Eight per residue is 0.19 A between points on a helix axis. Against a 2.00 A radius that is a
  chain of spheres 99% inside one another: **1,861 of them on 3RGK against the 927 one point per
  residue takes**, every one a box in the BVH that every ray near a helix has to sort, for a surface
  four would describe. The redundancy is structural rather than measured -- at that spacing consecutive spheres
  are almost the same sphere -- and it is the argument on its own.

  **Both counts move with `RAIL_TURN_LIMIT`, and the pair is the reason to measure them together.**
  At a limit of 5 they read 1,099 against 332. The limit is 1, for the banding `rails.js` names in
  the *cord*, and the rod pays the same rate because it goes through the same `emitCapsuleChain`.
  So the decimation this section argues for saves 3.3x at one limit and 2.0x at the other without a
  line of this file changing -- a count recorded here can be invalidated by an edit two modules
  away, and only re-measuring both halves shows it.

  **What is deliberately not claimed here is a speed-up.** The primitive counts above are exact and
  reproduce; an achieved sample count does not, because the renders that produce one stop on a wait
  threshold rather than on a fixed sample budget. Three shots of one unchanged build gave **342, 338
  and 294** -- a 16% spread with nothing whatever changing. A rendering cost claimed from this kind
  of run needs the run-to-run floor established first.

  The eight-row rate also put the nearest sphere inside one radius of the flat cap, which
  `emitCapsuleChain` has to trim back (`rails.js` carries the measurement) -- and a rate that only
  works because something downstream removes most of it is the wrong rate.

  One point per residue is 1.5 A of axis, where the turn is a mean of 8.5 degrees and a p95 of 32.
  That is well past what a capsule chain shades smoothly, and it is exactly the question
  `RAIL_TURN_LIMIT` already answers. `emitCapsuleChain` subdivides
  *through* those points on turn, centripetal Catmull-Rom, so the rod still passes through the axis
  at every residue boundary and only the corners between them move. The cost follows the curvature:
  a straight helix pays one segment a residue and a bent one pays four.
*/

import { applyOperator } from './operator.js';
import { emitCapsuleChain } from './rails.js';

/**
 * Below this a rod is not a rod.
 *
 * A floor on a *radius in Angstroms*, exactly as `RAIL_EPSILON` is: it is what keeps the
 * looks that name no `helixRod` from emitting a primitive, at the cost of one comparison.
 */
export const ROD_EPSILON = 1e-4;

/** Consecutive residues share their boundary row, and two copies of it is one sphere too many. */
const SAME_POINT = 1e-6;

/** Whether this look draws this kind as a rod rather than sweeping it. */
export function isRodResidue(look, kind) {
  return kind === 'helix' && (look.helixRod ?? 0) > ROD_EPSILON;
}

/**
 * A rod run under construction: one contiguous stretch of helix, from one flat cap to the next.
 *
 * `colors` is per **point**, like `radius`, so a rod ramps along its own length the way the panel
 * it replaces does.
 */
export function createRods() {
  return { runs: [], open: null, operator: undefined };
}

/**
 * One residue's worth of spine, as the **two rows that are its ends**.
 *
 * `points` is the sweep's own curve buffer -- the same `scratch.curvePoints()` the ring would be
 * placed on, already carrying the terminal overhang -- so nothing here re-derives a curve and a rod
 * cannot disagree with the tube it replaces about where the helix is.
 *
 * Rows 0 and `rows - 1` and nothing between them: the sampling-rate note above says why. The last
 * row of one residue is the first row of the next, so `SAME_POINT` drops the duplicate and a run of
 * N residues carries N + 1 points. The terminal overhang lives on row 0 (`element.initial`) or on
 * row `rows - 1` (`element.final`), so both survive the decimation by construction.
 *
 * **A blended colour therefore reaches a rod at half amplitude**: the middle row, where a residue
 * reaches its own colour, is one of the six dropped, so a rod ramps between the two midpoints
 * either side and reads `(prev + 2 * here + next) / 4` at the centre. Keeping that row would double
 * the joint spheres to smooth a tone that already ramps.
 */
export function addRod(rods, points, rows, radius, colors, offset, capStart, capEnd) {
  if (capStart) closeRod(rods);
  for (const row of rows > 1 ? [0, rows - 1] : [0]) {
    const at = row * 3;
    // The unit's operator lands here, on the copy, because the sweep's own `points` buffer is model
    // space and is still being read for the mesh. `geom/operator.js` carries why, and the identity
    // is a no-op.
    const point = applyOperator(rods.operator, [points[at], points[at + 1], points[at + 2]]);
    let run = rods.open;
    if (run) {
      // Consecutive residues share their boundary row, and both blend to the same colour there.
      if (distance(run.points[run.points.length - 1], point) <= SAME_POINT) continue;
    } else {
      run = { points: [], radius: [], colors: [] };
      rods.open = run;
      rods.runs.push(run);
    }
    const c = (offset + row) * 3;
    run.colors.push([colors[c], colors[c + 1], colors[c + 2]]);
    run.points.push(point);
    run.radius.push(radius);
  }
  if (capEnd) closeRod(rods);
}

/** No more rows will join this run, whatever comes next. */
export function closeRod(rods) {
  rods.open = null;
}

/**
 * Every run, as spheres and capped cylinders, with **no sphere at either end**.
 *
 * That omission is the flat cap. The terminal cylinder is already flat-capped perpendicular to its
 * own last segment, which is what a helix seen end-on looks like; a joint sphere there would round
 * it into the sausage this file exists to stop drawing.
 */
export function emitRods(mesh, rods) {
  for (const run of rods.runs) {
    // A run of one row has no length and no cap to show. It is not a bead: `sweep.js` already draws
    // one of those for a polymer element that is a residue on its own, and a helix is never that.
    if (run.points.length < 2) continue;
    const straight = straightenEnds(run);
    emitCapsuleChain(mesh.helices, straight.points, straight.radius, straight.colors, false, false);
  }
  return mesh;
}

/**
 * The last radius of centre line at each end, replaced by one straight segment.
 *
 * **This is what makes a flat cap flat, and suppressing the end sphere is only half of it.** Any
 * sphere within one radius of the cap pokes out through it -- `emitCapsuleChain` in `rails.js`
 * carries that measurement -- and dropping those spheres instead is worse, not better: the cylinders
 * still turn at each of those joints, and a turn with no sphere in it is a groove cut round the rod.
 * Either way the cap is wrong: a dome where a sphere pokes through, a groove where one is dropped.
 *
 * Removing the *points* removes the turns with them. What is left is one straight cylinder from the
 * cap to the first joint that clears it, which is what the end of a cylinder is, and is what the
 * reference render shows: its rods are straight at the ends and bend in the middle.
 *
 * It also takes the hook off. A run's end row is the boundary it *shares with a loop*, so the
 * spline there is already swinging toward an alpha carbon that is not on the axis; straightening
 * the end pulls the cap back onto the rod's own direction rather than the loop's.
 *
 * No kept interior point is within one radius of either end; a run with none left is its two end
 * points and a single cylinder. That is correct rather than degenerate: a helix that short is a
 * cylinder seen almost end-on.
 */
function straightenEnds(run) {
  const { points, radius, colors } = run;
  const last = points.length - 1;
  let head = 1;
  while (head < last && distance(points[0], points[head]) < radius[0]) head += 1;
  let tail = last - 1;
  while (tail > head && distance(points[last], points[tail]) < radius[last]) tail -= 1;
  // The tail walk stops at `head` without testing it: on 1N8Z a 3.60 A run kept one 0.63 A proud.
  if (tail === head && head < last && distance(points[last], points[head]) < radius[last]) {
    return {
      points: [points[0], points[last]],
      radius: [radius[0], radius[last]],
      colors: [colors[0], colors[last]],
    };
  }
  if (head === 1 && tail === last - 1) return run;

  // A colour belongs to a point, so the kept points keep theirs: the straightened end runs from the
  // cap's own colour to the first joint that clears it, which is the ramp with fewer steps in it.
  const kept = [0];
  for (let index = head; index <= tail; index += 1) kept.push(index);
  kept.push(last);
  return {
    points: kept.map((index) => points[index]),
    radius: kept.map((index) => radius[index]),
    colors: kept.map((index) => colors[index]),
  };
}

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
