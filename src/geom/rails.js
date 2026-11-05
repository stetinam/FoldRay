/*
  The edge rails: the panel's own boundary, drawn as one flowing tube.

  `profiles-catalog.js` says what a rail is and why it is not a fourth cross-section axis.
  This file exists for one measurement, the way `arrow.js` exists for one:

  **The sweep samples the spine eight times per residue, and on an alpha helix that is 12.85 degrees
  of turn per step.** Measured on 3RGK's 26-residue A21-46 helix. The panel gets away with it --
  `emitVertices()` gives its triangles interpolated vertex normals, so the facets shade smooth and
  the silhouette error is 0.017 A, which nothing shows. **A rail cannot get away with it.** It is
  analytic, its normals are exact, and every one of those corners is a real crease in the union of
  two cylinders -- two creases per Angstrom, running straight down the specular highlight the whole
  look exists to carry. Off the spine and out on the panel's edge it is worse still: the 1.39 A
  lever arm on a frame Mol* box-smooths but never re-normalises takes the same statistic to a mean
  of 14.2 and a p95 of 28.8 degrees.

  So **the rail carries its own sampling rate**, and that is the whole of this file. It is not
  `LINEAR_SEGMENTS`: raising that would triple the triangle count of a mesh that already looks
  right, to fix a surface made of spheres and cylinders. The rail's centre line is subdivided
  *through the points the sweep already produced* -- centripetal Catmull-Rom, which interpolates --
  so a rail can never come off the edge it is riding no matter how finely it is cut. Only the
  corners between those points move, and they move to wherever the curve through them goes.

  Subdivision is **adaptive on turn**, so the cost follows the curvature: a loop or a straight
  stretch pays nothing and a tight helix pays three or four steps. That is also why the limit is an
  angle rather than a multiplier.

  ---

  ## Two things the runs have to get right, both of which draw a plausible picture wrong

  1. **The frame flips sign between residues.** Mol*'s `normalVectors` reverses on 2 of 26 residues
     in that helix, which the panel does not notice -- the cross-section is symmetric in `u`, so
     `-axisU` sweeps the same ring -- and which turns a naively accumulated pair of rail chains
     inside out, crossing them over the ribbon at a 2.78 A stride. The two points at a shared row
     are the *same two points* either way, so the test is exact: whichever pairing is nearer is the
     right one.
  2. **Consecutive residues share their boundary row.** Emitting both copies puts two coincident
     spheres of two different colours at every residue join, and which one the tracer reports is
     whichever the traversal reaches first. One run, one point, one colour -- and the colour is per
     point, so a sub-point and a rod take the lerp its radius does.
*/
import { applyOperator } from './operator.js';


/**
 * Below this a rail is not a rail.
 *
 * A floor on a *radius in Angstroms*, not a tolerance: it is what keeps a look with no `rail` from
 * emitting primitives, and what stops the fade into a railless neighbour from trailing a line of
 * sub-picometre spheres nothing can see and the BVH still has to sort.
 */
export const RAIL_EPSILON = 1e-4;

/**
 * The most a rail is allowed to turn at one joint, in degrees.
 *
 * **A crease of `θ` is a step of `θ` in the surface normal**, and that is the number the eye reads.
 * A crease swings a reflected ray by `2θ`, which makes a mirror finish look like the strictest
 * test. It is not: a diffuse surface has no highlight to break, so it reads the normal itself, and
 * every joint is a step in `N·L` -- a band across the cord, once per joint, all the way down it.
 * Judge it on the *shading*, not on the *reflection*.
 *
 * **No construction can remove that corner, which is why this is a number.** The joint sphere is
 * tangent to both rods, so the *outside* of every bend is already seamless -- the two rod ends and
 * the sphere between them meet with all three normals radial. On the inside the two rods cross and
 * leave a real corner of exactly `θ`, at `r·sec(θ/2)` from the joint, which is *outside* the sphere
 * and so is on the surface. Nothing but a finer cut reaches it.
 *
 * Measured on 3RGK `cartoon_railed`, the bands read off primitives shaded on `N·L` alone so that
 * nothing but the normals can be what is being looked at:
 *
 * | limit | joint spheres | crease mean / p95 / max | bands |
 * | --- | --- | --- | --- |
 * | 5 | 7,357 | 3.77 / 5.11 / 7.65 deg | plain |
 * | 2 | 16,360 | 1.71 / 2.36 / 4.84 | faint |
 * | **1** | **31,298** | **0.90 / 1.26 / 2.81** | **none** |
 *
 * **The cost is primitives and it is linear**, because the joints needed are the cord's total turn
 * over this number: the whole `cartoon_railed` scene on 3RGK goes 47,650 -> 95,532 primitives and
 * its BVH build **165 -> 330 ms** -- the min of twelve builds in each of three processes, spread
 * under 6%, because a single timing of this does not reproduce and the primitive count does.
 * The helix rod pays the same rate on far less curve, 271 spheres -> 927.
 *
 * **It buys nothing at all on a loop or a strand**: the rate is adaptive on turn and a straight
 * stretch still takes one step. All of it is spent on the coiled helix, which is the only place a
 * cord's own curve radius (~2.3 A) is close to its radius (0.21) and so the only place it creases.
 */
export const RAIL_TURN_LIMIT = 1;

/**
 * However hard a curve turns, one segment is never cut into more than this.
 *
 * **It must be a guard and not the binding constraint.** At one degree with a cap of 8 the
 * realized crease stalls at a 1.68 mean and a 7.30 max, because a segment turning 14 degrees is
 * given 8 steps and takes 1.75 each. At 24 it is a guard -- 7% more joints than 16, and the worst
 * crease 3.84 -> 2.81 degrees.
 */
const MAX_STEPS = 24;

/** Two points at a shared row are the same two points, so "did the frame flip" is not a tolerance. */
const SAME_POINT = 1e-6;

/**
 * A rail run under construction: one continuous stretch of edge, from one cap to the next.
 *
 * `a` and `b` are the two sides; `radius` and `colors` are both per **point**. `capStart` and
 * `capEnd` are whether the rim closes across the panel at each end.
 * They are the *rail's* own condition and deliberately **not** `emitCap()`'s -- `sweep.js` says
 * why, at the one place the two differ.
 */
export function createRails() {
  return { runs: [], open: null, operator: undefined };
}

/**
 * One residue's worth of rail rows.
 *
 * `grid` is `sweep.js`'s rail grid -- two centres per row, `(row * 2 + side) * 3` -- and `radii` and
 * `colors` are read at `offset + row`, the same parameter the curve point and the sizes are. The
 * cord therefore ramps with the panel it edges rather than carrying one band per residue.
 */
export function addRails(rails, grid, radii, colors, offset, rows, capStart, capEnd) {
  if (capStart) closeRun(rails);
  /*
    Trap 1 is asked **once, on the first row this call joins an existing run at**, and the answer
    held for the rest of the residue. That is not a saving; it is the difference between a test that
    is exact and one that is a 10% margin.

    The frame flips *between* residues and cannot flip within one -- `interpolateNormals` produces
    one residue's rows in one pass and `frame.js` re-spreads them, so `crossSectionAxes()` walks a
    continuous frame from row 0 to row 8. So the question is a per-residue one, and the row it is
    asked at is the one where the answer is exact: the two residues share that boundary sample, so
    the two candidates are the *same two points* as the previous row's, at 0 and at the full width
    of the panel.

    Asked again at every row it eventually meets a row where it is not exact. An arrowhead's last
    row is the one: the breadth has ramped to zero, so the two rail centres are `2r` apart -- 0.08 A
    on `cartoon_railed` -- against a spine step of 0.41, and the two candidate distances come out
    0.50 and 0.55. A 10% margin decides which side of an arrow a cord is on, and losing it crosses
    the two cords over the point.
  */
  let flipped = null;
  for (let row = 0; row < rows; row += 1) {
    const radius = radii[offset + row];
    if (!(radius > RAIL_EPSILON)) { closeRun(rails); flipped = null; continue; }
    const at = row * 2 * 3;
    // The unit's operator, on the copy rather than on the sweep's own grid -- `geom/operator.js`
    // carries why, and why the two `distance()` questions below are unaffected by it.
    let a = applyOperator(rails.operator, [grid[at], grid[at + 1], grid[at + 2]]);
    let b = applyOperator(rails.operator, [grid[at + 3], grid[at + 4], grid[at + 5]]);

    let run = rails.open;
    if (run) {
      const last = run.a.length - 1;
      if (flipped === null) flipped = distance(run.a[last], a) > distance(run.a[last], b);
      if (flipped) { const swap = a; a = b; b = swap; }
      // Trap 2: consecutive residues share their boundary row, and both blend to the same colour
      // there, so the duplicate carries nothing the run has not already got.
      if (distance(run.a[last], a) <= SAME_POINT) continue;
    } else {
      // A run with no previous point has no pairing to agree with; it defines its own.
      flipped = false;
      run = { a: [], b: [], radius: [], colors: [], capStart: !!capStart, capEnd: false };
      rails.open = run;
      rails.runs.push(run);
    }
    const c = (offset + row) * 3;
    // One array per point, shared by both sides: the two cords at a row are the same colour.
    run.colors.push([colors[c], colors[c + 1], colors[c + 2]]);
    run.a.push(a);
    run.b.push(b);
    run.radius.push(radius);
  }
  if (capEnd && rails.open) { rails.open.capEnd = true; closeRun(rails); }
}

/** No more rows will join this run, whatever comes next. */
export function closeRun(rails) {
  rails.open = null;
}

/**
 * Every run, as spheres and capped cylinders.
 *
 * A sphere at every point and a cylinder between consecutive ones is a capsule chain: the tracer's
 * cylinders are flat-capped, so the sphere is what makes each joint tangent-continuous rather than
 * a crease. **That tangency is a fact about a rod carrying one radius**, and where the cord tapers
 * the rod carries two and is the tangent cone instead -- `pushRod()`. The cross-bars that close the
 * rim need no corner treatment either way: the joint spheres are already sitting at both of their
 * ends.
 */
export function emitRails(mesh, rails) {
  for (const run of rails.runs) {
    if (run.a.length < 2) {
      // A single row is a rim with no length. It still closes, if it was asked to.
      if (run.a.length === 1 && (run.capStart || run.capEnd)) crossBar(mesh, run, 0);
      continue;
    }
    for (const side of ['a', 'b']) emitSide(mesh, run, run[side]);
    if (run.capStart) crossBar(mesh, run, 0);
    if (run.capEnd) crossBar(mesh, run, run.a.length - 1);
  }
  return mesh;
}

function emitSide(mesh, run, points) {
  emitCapsuleChain(mesh.rails, points, run.radius, run.colors, true, true);
}

/**
 * A polyline as a capsule chain: a sphere at every point, a capped cylinder between consecutive
 * ones, subdivided *through* those points on turn so no joint creases.
 *
 * **Shared, because `geom/rods.js` needs exactly this and needs it to be the same one.** A rail and
 * a helix rod are the same construction on two different centre lines -- the panel's own outer edge
 * and Mol*'s helix axis -- so everything at the top of this file applies to both: why it is spheres
 * and cylinders rather than rods alone, why the subdivision interpolates, and why the rate is an
 * angle. A second copy would be a second answer to how finely an analytic tube is cut.
 *
 * `radii` and `colors` are both per **point**, and a sub-point takes the same lerp of the two it
 * lies between that its radius does.
 *
 * **Where the radius changes along the chain, the rod between two spheres is the cone *tangent* to
 * both and not the chord between them.** `pushRod()` is that construction and carries the
 * measurement. A rod whose two radii are equal returns early as a plain chord and is
 * bit-identical, which is every stick, every base stem, every helix rod and every rail on a look
 * whose cord holds its radius.
 *
 * **`roundStart` and `roundEnd` are the only thing the two callers disagree about.** A rail runs
 * out to a point and wants its end sphere. A rod wants neither: the terminal cylinder is already
 * flat-capped perpendicular to its own last segment, which is what a helix seen end-on is, and a
 * sphere there would round off the one edge that look is read by.
 *
 * **Suppressing the end joint is necessary and not sufficient**, and the caller owns the other
 * half. A sphere anywhere within one radius of the cap pokes out through it -- at the sweep's own
 * eight rows a residue that is the *next* joint, 0.19 A in on a 2.00 A rod, standing 1.81 A proud,
 * and it domes all twelve of 3RGK's rod ends. It cannot be fixed here by dropping those
 * joints: the cylinders still turn at each of them, and a turn with no sphere in it is a groove cut
 * round the rod. `rods.js` fixes it where it belongs, on the centre line, by making the end
 * straight.
 */
export function emitCapsuleChain(target, points, radii, colors, roundStart = true, roundEnd = true) {
  const { joints, rods } = target;
  const last = points.length - 1;
  let previous = null;
  for (let index = 0; index < last; index += 1) {
    /*
      **A flat end is a straight end, and the two cannot be separated.** The caller has already
      pulled the turns out of the terminal segment so that no sphere can reach through the cap;
      subdividing it here would put them straight back, because `splinePoint()` curves the segment
      and drops a joint part way along it -- inside the one radius the caller just cleared. Measured
      on 3RGK: the ends came back protruding 0.34-1.63 A with the centre line already straightened.
      One segment, one cylinder, and the cap is the outermost thing at that end.
    */
    const flat = (index === 0 && !roundStart) || (index === last - 1 && !roundEnd);
    const steps = flat ? 1 : stepsFor(points, index);
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps;
      const point = step === 0 ? points[index] : splinePoint(points, index, t);
      const radius = lerp(radii[index], radii[index + 1], t);
      const colour = mixColor(colors[index], colors[index + 1], t);
      /*
        **A rod takes the colour where it starts and a joint the colour at its own point.** Read per
        *segment* instead -- "where the rod starts" being the segment it lies in, and the joint's
        colour serving for both -- every band lands a whole segment late: 109 of 927 rods, 23.7% of
        the rod length, on 3RGK's helix rods. Which side of a join a band falls on is not a
        question either: `sweep.js` blends, so both residues meeting at a point evaluate the same
        colour there.
      */
      // Every rod inside the walk ends on a point that gets a sphere, so both of its ends can be
      // trimmed back to the tangent circle. Only the chain's two extremities can lack one.
      if (previous) pushRod(rods, previous, { point, radius }, previous.color, true);
      // Only the chain's very first point can reach `roundStart`: every later `step === 0` already
      // has a `previous`, because the walk never breaks.
      const sphered = previous !== null || roundStart;
      if (sphered) joints.push({ p: point, radius, color: colour });
      previous = { point, radius, sphered, color: colour };
    }
  }
  const end = points[last];
  const radius = radii[last];
  pushRod(rods, previous, { point: end, radius, sphered: roundEnd }, previous.color, roundEnd);
  if (roundEnd) joints.push({ p: end, radius, color: colors[last] });
}

// A colour part way between two, and exactly the first one when the two are equal: `a + (b - a) * t`
// has an exact zero in it where `a * (1 - t) + b * t` does not, and byte-identity rests on that.
function mixColor(from, to, t) {
  if (t === 0) return from;
  return [lerp(from[0], to[0], t), lerp(from[1], to[1], t), lerp(from[2], to[2], t)];
}

/**
 * One rod of a capsule chain: the cone **tangent** to the two joint spheres it runs between.
 *
 * A rod from centre to centre carrying one radius is exact only while the radius holds. The
 * cylinder is then tangent to both spheres along exactly its two cap circles, both normals radial,
 * so the union has no second surface in it -- that is the argument in `emitRails()` and it is why
 * the spheres are there at all. **Where the radius tapers it stops being true**, and the way it
 * fails is worth naming because it draws a plausible picture: given the mean of the two radii, the
 * rod is fatter than the thinner sphere by half the step and thinner than the fatter one by the
 * same half, so **every joint carries a protruding flat cap ring on one side and a protruding
 * sphere on the other**. Measured on 3RGK `cartoon_railed_blend`: 457 tapering rods, a ledge of
 * 0.0044 A in the mean and 0.0131 at worst -- and at the thin end of a taper, where the cord is
 * running out to nothing, **50% of the local radius**. A 90-degree edge that size is a ring of
 * light on a specular cord, once per joint, and it makes a cord that should fade out come apart
 * into segments.
 *
 * The fix is the external tangent cone of two spheres, which is a solved piece of school geometry.
 * With `d` the centre distance and `s = (rA - rB) / d` the sine of the cone's half-angle, the cone
 * touches sphere A on a circle at axial offset `rA * s` of radius `rA * sqrt(1 - s*s)`, and sphere
 * B at `rB * s` with radius `rB * sqrt(1 - s*s)`. Both surfaces then meet along a circle where
 * both normals agree, which is the same tangency the equal-radius case has, so the ledge is not
 * reduced -- it is **gone**, exactly, with no extra primitive and no finer sampling. It costs one
 * `sqrt` per rod at build time and a second radius in the record `pathtrace.wgsl` already had a
 * spare float for.
 *
 * Three doors return the plain chord, and the first is what keeps everything else in the app
 * bit-identical:
 *
 * * **The radius holds.** `s` is then 0 and the construction is the identity, but it is spelled as
 *   an early return rather than relied on: `a + w * 0` is only *numerically* `a`, and byte-identity
 *   against a recorded baseline is worth more than one branch.
 * * **A sphere is missing at one end.** Half a tangent cone is not a tangent cone. In practice this
 *   is `rods.js`'s two flat ends, and a rod holds one radius end to end, so the door is never the
 *   reason a rod is a chord.
 * * **One sphere contains the other** (`|rA - rB| >= d`). No external tangent cone exists; the
 *   union is just the larger sphere and there is nothing useful to draw between them.
 */
function pushRod(rods, from, to, colour, trimTo) {
  const held = 0.5 * (from.radius + to.radius);
  const axis = subtract(to.point, from.point);
  const span = norm(axis);
  const delta = from.radius - to.radius;
  if (delta === 0 || !from.sphered || !trimTo || !(span > 1e-9) || Math.abs(delta) >= span) {
    rods.push({ a: from.point, b: to.point, radius: held, radiusB: held, color: colour });
    return;
  }
  const sine = delta / span;
  const cosine = Math.sqrt(1 - sine * sine);
  const along = (point, shift) => [
    point[0] + (axis[0] / span) * shift,
    point[1] + (axis[1] / span) * shift,
    point[2] + (axis[2] / span) * shift,
  ];
  rods.push({
    a: along(from.point, from.radius * sine),
    b: along(to.point, to.radius * sine),
    radius: from.radius * cosine,
    radiusB: to.radius * cosine,
    color: colour,
  });
}

/** The rim, closed across the panel. Its radius is the rail's own at that row. */
function crossBar(mesh, run, index) {
  const a = run.a[index];
  const b = run.b[index];
  // A panel that has tapered to nothing -- a beta arrow's tip, a loop -- puts both rails in the
  // same place, and the joint sphere is the whole of the rim there.
  if (distance(a, b) <= RAIL_EPSILON) return;
  const colour = run.colors[index];
  // `rim: true` is what tells a cross-bar from a rail. The two are the same tube and the tracer
  // cannot tell them apart, but a corner between them is a right angle **on purpose** and every
  // other joint being a right angle would be a defect -- so the distinction has to be in the data
  // rather than inferred from a length that a tapered panel makes untrue.
  // One radius at both ends: a rim is a bar and never a cone, so it says so rather than leaving
  // `radiusB` for `pushCylinder()` to default.
  mesh.rails.rods.push({
    a, b, radius: run.radius[index], radiusB: run.radius[index], color: colour, rim: true,
  });
}

/**
 * How many sub-steps this segment is cut into, from how hard the curve turns at its two ends.
 *
 * The turn at a point is the angle between the segments meeting there, so a segment inherits the
 * worse of its own two -- which is what keeps the sub-steps from stepping down abruptly one segment
 * before a corner and reintroducing the crease somewhere else.
 */
function stepsFor(points, index) {
  const turn = Math.max(turnAt(points, index), turnAt(points, index + 1));
  if (!(turn > RAIL_TURN_LIMIT)) return 1;
  return Math.min(MAX_STEPS, Math.ceil(turn / RAIL_TURN_LIMIT));
}

function turnAt(points, index) {
  const before = points[index - 1];
  const after = points[index + 1];
  if (!before || !after) return 0;
  const u = subtract(points[index], before);
  const v = subtract(after, points[index]);
  const lengths = norm(u) * norm(v);
  if (!(lengths > 1e-12)) return 0;
  const cosine = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / lengths;
  return (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
}

/*
  Centripetal Catmull-Rom, on the segment from `points[index]` to `points[index + 1]`.

  **Centripetal (α = 0.5) rather than uniform**, because the steps are not evenly spaced -- 0.24 to
  0.97 A on that same helix, since the two rails run at different radii about the helix axis -- and
  uniform Catmull-Rom overshoots and can cusp on uneven spacing. Centripetal provably does neither
  (Yuksel, Schaefer & Keyser, "Parameterization and applications of Catmull-Rom curves",
  Computer-Aided Design 43(7), 2011).

  It **interpolates**: every original point is on the curve it returns. That is the property the
  whole approach rests on, because those points are the panel's own edge and a rail that left them
  would open a seam between the cord and the ribbon it edges.

  The ends reflect a phantom neighbour (`2 P1 - P2`) rather than duplicating one, which gives the
  first and last segments the curvature of their neighbours instead of flattening them.
*/
function splinePoint(points, index, t) {
  const p1 = points[index];
  const p2 = points[index + 1];
  const p0 = points[index - 1] ?? reflect(p1, p2);
  const p3 = points[index + 2] ?? reflect(p2, p1);

  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const at = t1 + (t2 - t1) * t;

  const a1 = blend(p0, p1, t0, t1, at);
  const a2 = blend(p1, p2, t1, t2, at);
  const a3 = blend(p2, p3, t2, t3, at);
  const b1 = blend(a1, a2, t0, t2, at);
  const b2 = blend(a2, a3, t1, t3, at);
  return blend(b1, b2, t1, t2, at);
}

/** The centripetal knot: the square root of the chord, floored so coincident points cannot divide. */
function knot(a, b) {
  return Math.max(Math.sqrt(distance(a, b)), 1e-4);
}

function blend(a, b, from, to, at) {
  const span = to - from;
  const u = span > 1e-12 ? (to - at) / span : 0;
  const v = 1 - u;
  return [a[0] * u + b[0] * v, a[1] * u + b[1] * v, a[2] * u + b[2] * v];
}

const reflect = (near, far) => [2 * near[0] - far[0], 2 * near[1] - far[1], 2 * near[2] - far[2]];
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (v) => Math.hypot(v[0], v[1], v[2]);
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const lerp = (a, b, t) => a + (b - a) * t;
