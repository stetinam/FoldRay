/*
  The cross-section every cartoon, every ribbon and every loop is swept along.

  One profile function, and a look is three numbers.

      profile(w, h, r) = the Minkowski sum of a rectangle of half-extents (w, h)
                         with a disc of radius r

  Total half-extents `(w + r, h + r)`; straight sides of length `2h` and `2w`; quarter-circle
  corners of radius `r`. Nothing is special-cased, because the degenerate cases fall out of the
  same arithmetic:

  | Look | w | h | r | Result |
  | --- | --- | --- | --- | --- |
  | tube, ribbon family, loop | 0 | 0 | R | a circle of radius R |
  | flat cartoon | W | H | 0 | a sharp rectangle |
  | classic cartoon | W | H | small | a rounded rectangle |
  | bevelled cartoon | W | small | > h | a fatter, rounder ribbon -- **not** a raised edge |

  **`r > h` is a bevel and nothing more.** The face
  sits at `h + r`, which is exactly the top of the corner arc, so face and roll are tangent by
  construction and no value of `r` lifts an edge above a face. The raised edge is the rail, which is
  `rails.js` and is not a cross-section at all; `profiles-catalog.js` carries both arguments.

  ---

  ## The disc is one choice of rounding, and `sides` is the other

  **`sides` replaces the disc with a regular polygon of circumradius `r`, and everything else about
  this file holds for both.** The sum is still a Minkowski sum of the same rectangle with a convex
  shape centred on the origin, so `profilePoint()` still places a sample from `(w, h, r)` and the
  taper still runs through it -- what differs is that the boundary is flat facets meeting at hard
  creases instead of an arc.

  Two facts make it a small change rather than a second profile function:

  * **The Minkowski sum of two convex polygons is the merge of their edges by normal angle.** Each
    polygon face appears translated by the rectangle's *support point* in that face's own normal
    direction -- `(w x sign(nx), h x sign(ny))` -- and the rectangle's four edges appear between
    them. So a ring sample is still a rectangle sign pair plus a unit direction, which is exactly
    the shape the arc path already returns.
  * **Where a face normal is axis-aligned the support is an edge rather than a point**, and its two
    ends are the face's two ends: the rectangle's own edge with that normal is *collinear* with the
    polygon's, so the two merge into one straight run. That is the only case in the construction
    that is not a sign, and `polygonRing()` carries it.

  A polygon needs `r > 0` to be a polygon, so `sides` with no corner radius is refused rather than
  quietly drawing the rectangle it would collapse to.

  **On a polygon the normal is not the position direction, and that is why a ring sample is six
  floats.** On a disc the two are the same vector -- for a Minkowski sum with a disc the outward
  normal *is* the arc direction. On a polygon a vertex has no normal of its own: it is the meeting
  of two faces, so it appears twice, once with each face's normal, and the position it appears at
  is the same both times. Separating them is what keeps the
  crease a crease, and it is the same trick `emitVertices()` relies on one file over.

  ---

  **Topology and geometry are separated, and that is the one non-obvious thing in this file.**

  A sweep tapers `(w, h, r)` along a residue -- Mol*'s `interpolateSizes` lerps the first two
  between the previous, current and next residue's sizes, and `sweep.js` mirrors that lerp for the
  third. So the numbers change from sample to sample *within one residue*, and a ring whose vertex
  count depended on them would change count halfway along a tube that has to be triangulated as a
  grid.

  So `profileRing()` decides the ring **once per residue, from the largest `(w, h, r)` that residue
  interpolates through**, and returns *unit* samples: a quadrant sign pair, a direction on the
  corner shape, and the outward normal there. `profilePoint()` then places a sample for any
  `(w, h, r)`. The count is fixed; only the positions move.

  That also makes the de-duplication exact rather than a tolerance. Two adjacent ring samples
  coincide for the *whole* residue exactly when they share an arc direction and the axis that
  separates them is zero-length throughout -- which is how a circle (`w = h = 0`) comes back with
  `4 x segments` samples instead of `4 x (segments + 1)`, and how a sharp rectangle (`r = 0`) comes
  back with eight: two per corner, carrying the two face normals, so the crease stays a crease.
*/

/*
  The four corner centres, counter-clockwise from `(+w, +h)`. Quadrant `q` owns the arc from
  `q x 90` to `(q + 1) x 90` degrees, so quadrant 0's `0` sample is the right face and its `90`
  sample is the top face -- and the straight edge between one quadrant's last sample and the next
  quadrant's first is the face itself.
*/
const QUADRANT_SIGNS = [[1, 1], [-1, 1], [-1, -1], [1, -1]];

/**
 * Six floats per ring sample: the rectangle corner it belongs to, its direction on the corner
 * shape, and the outward normal there.
 *
 * **On a disc the last two equal the middle two**, because a Minkowski sum with a *disc* has the
 * property that the outward normal is the position direction. A polygon does
 * not: its vertices carry no normal of their own and appear once per adjoining face. The header
 * has the argument.
 */
export const RING_STRIDE = 6;

/**
 * Why this cross-section cannot be swept, or `''`.
 *
 * **The rule, stated once.** `profileRing()` throws what this returns, and
 * `profiles-catalog.js`'s `repairLookSettings()` asks it rather than restating it -- so the panel
 * that can reach a refusal and the builder that raises it cannot drift apart.
 */
export function profileRefusal(w, h, r, sides = 0) {
  if (!(w >= 0) || !(h >= 0) || !(r >= 0)) {
    return `a profile needs non-negative (w, h, r); got (${w}, ${h}, ${r})`;
  }
  if (w + r <= 0 || h + r <= 0) {
    return 'a profile with no extent on one of its axes has no surface to sweep.'
      + ` (w + r) is ${w + r} and (h + r) is ${h + r}; a tube is (0, 0, R), not (0, 0, 0).`;
  }
  if (sides >= 3) {
    if (r > 0) return '';
    return 'a polygon cross-section needs a circumradius to be a polygon; `sides` is '
      + `${Math.round(sides)} and r is 0, which is the rectangle it would collapse to.`
      + ' State the rectangle, or give it an r.';
  }
  if (sides > 0) return `a polygon cross-section needs at least three sides; got ${sides}`;
  return '';
}

/**
 * The ring of a profile family, as unit samples.
 *
 * `w`, `h` and `r` are the *largest* values this ring will be evaluated at, and their zero-ness
 * decides which samples survive -- an axis that is zero everywhere collapses, an axis that is ever
 * non-zero keeps its samples. `cornerSegments` is how many steps each quarter-arc takes, which is
 * the only thing it controls: how smooth the highlight running along a rolled edge is.
 *
 * `faceStep` is the longest a **straight face** may run without an interior sample, in Angstroms,
 * and `0` leaves the faces as the single segments they were.
 *
 * **Why a straight face wants interior samples at all, when it is straight.** It is straight in the
 * cross-section and not in the sweep: two consecutive rings are the same shape rolled about the
 * spine, so the quad between two face samples is a *twisted* one, and the two triangles it is cut
 * into lay a roof over the ruled surface they are approximating. The height of that roof goes as
 * the product of the two grid steps, so a face 4.2 A across stepping 0.19 A along a helix is a
 * 22:1 quad carrying twenty-eight times the roof of its neighbours -- measured on 1UBQ, 0.056 A
 * against 0.002 A, on the 6% of quads that are the flat faces. At grazing light every one of those roofs
 * shadows the next and lays a dark comb down the ribbon, once per row, which converges rather than
 * averaging away because it is a real shape and not noise. Cutting the face into segments of the
 * spine step's own order takes the roof down with it, and it is the cheapest place to spend a
 * triangle: the faces are a twelfth of the ring and every other quad is already square.
 *
 * The interior samples are the same six numbers the corners are -- a quadrant sign pair, a shape
 * direction and a normal -- with the sign *interpolated* rather than +/-1, so `profilePoint()`
 * places them with no new arithmetic and they carry the face's own exact normal. A face of zero
 * length (an axis this family never uses) collapses them onto its endpoints through the same
 * de-duplication that already turns a circle's four quadrants into one ring.
 *
 * `sides`, when it is 3 or more, replaces the disc with a regular polygon of circumradius `r` --
 * the header says what that costs and what it does not. `cornerSegments` then has nothing to
 * describe and is ignored, because a facet has no arc to step along.
 *
 * Returns a `Float32Array` of `RING_STRIDE` floats per sample: `su`, `sv`, `px`, `py`, `nx`, `ny`.
 */
export function profileRing(w, h, r, cornerSegments = 4, faceStep = 0, sides = 0) {
  const refusal = profileRefusal(w, h, r, sides);
  if (refusal) throw new Error(refusal);
  if (sides >= 3) return pack(polygonSamples(w, h, r, Math.round(sides), faceStep));
  const hasW = w > 0;
  const hasH = h > 0;
  // With no corner radius the arc is not an arc: its two endpoints are the two faces meeting at a
  // sharp corner, and every sample between them is the same point with a bevelled normal.
  const steps = r > 0 ? Math.max(1, Math.round(cornerSegments)) : 1;

  const samples = [];
  for (let quadrant = 0; quadrant < 4; quadrant += 1) {
    const [su, sv] = QUADRANT_SIGNS[quadrant];
    for (let step = 0; step <= steps; step += 1) {
      // The arc index across the whole ring, so a junction's two samples compare exactly rather
      // than through two cosines that differ in the last bit.
      const arc = quadrant * steps + step;
      const angle = ((quadrant + step / steps) * Math.PI) / 2;
      samples.push({ su, sv, arc, cos: snap(Math.cos(angle)), sin: snap(Math.sin(angle)) });
    }
    /*
      The straight face leaving this quadrant, cut into `faceStep`-long segments.

      Its two endpoints are this quadrant's last sample and the next one's first: the same arc
      direction, one sign flipped, and the axis that sign scales is the face's own length. So the
      interior samples are that sign swept from one end to the other, and they share the arc index
      -- which is what lets the de-duplication below collapse them when the face has no length.
    */
    const [nextU, nextV] = QUADRANT_SIGNS[(quadrant + 1) % 4];
    const length = 2 * (su !== nextU ? w : h);
    // The epsilon is not decoration: `4.2 / 0.7` is `6.000000000000001`, so a face that is an exact
    // multiple of the step would take an extra segment on some widths and not on others, and the
    // ring count would depend on which. The ratio is a small number, so an absolute 1e-9 on it is
    // far below any width worth distinguishing and far above the error being absorbed.
    const pieces = faceStep > 0 ? Math.ceil(length / faceStep - 1e-9) : 1;
    if (pieces > 1) {
      const arc = (quadrant + 1) * steps;
      const angle = ((quadrant + 1) * Math.PI) / 2;
      const cos = snap(Math.cos(angle));
      const sin = snap(Math.sin(angle));
      for (let piece = 1; piece < pieces; piece += 1) {
        const t = piece / pieces;
        samples.push({ su: su + (nextU - su) * t, sv: sv + (nextV - sv) * t, arc, cos, sin });
      }
    }
  }

  /*
    Drop a sample that is its predecessor for every `(w, h, r)` in this family: same arc direction,
    and the axis whose sign differs is zero-length throughout. The wrap-around pair is the last
    against the first, whose arc indices are `4 x steps` and `0` -- the same direction, one turn
    apart -- so it is compared explicitly.
  */
  const kept = [];
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const previous = kept[kept.length - 1];
    if (previous && duplicate(previous, sample, hasW, hasH)) continue;
    kept.push(sample);
  }
  const first = kept[0];
  const last = kept[kept.length - 1];
  if (kept.length > 1 && duplicate(last, { ...first, arc: 4 * steps }, hasW, hasH)) kept.pop();

  return pack(kept);
}

/*
  The rectangle's own four edges, by the normal each one carries and the half-extent that gives it
  length. The edge facing `+u` is the one 2h tall, which is the crossing the whole file is about.
*/
const RECT_EDGES = [
  { degrees: 0, nx: 1, ny: 0, broad: false },
  { degrees: 90, nx: 0, ny: 1, broad: true },
  { degrees: 180, nx: -1, ny: 0, broad: false },
  { degrees: 270, nx: 0, ny: -1, broad: true },
];

/*
  The regular polygon of circumradius 1, summed with the rectangle, walked counter-clockwise.

  One vertex sits on `+u`, so the shape is symmetric about both cross-section axes and an even
  `sides` puts a vertex on `-u` as well -- which is what keeps a prism's silhouette the same read
  from either side of the ribbon.

  **The sum's edges are both shapes' edges, sorted by normal angle, and forgetting the rectangle's
  four draws a plausible picture.** Each polygon face appears translated by the rectangle's support
  point in that face's normal direction; each *rectangle* edge appears translated by the polygon's,
  which is the vertex the two neighbouring faces share. Emitting only the polygon's leaves the
  rectangle's edges as unlabelled gaps between consecutive samples -- straight, in the right place,
  and shaded by interpolating the two facet normals either side of them, so a panel's broad faces
  come out subtly barrelled with the error worst at their two ends.

  A rectangle edge of zero length is **not** emitted: it is a point, and two samples there would
  bevel the polygon vertex it sits on. That is what makes `w = h = 0` a plain prism through the same
  arithmetic rather than through a special case.

  A face and a rectangle edge with the *same* normal are collinear and merge into one run. That is
  the axis-aligned case in `supportSign()` and it needs no test of its own: the strict comparison
  below leaves the rectangle edge out, and the face's two ends already reach the full width.
*/
function polygonSamples(w, h, r, sides, faceStep) {
  // The `r > 0` guard is `profileRefusal()`'s, above: one statement of the rule.
  const kept = [];
  const faceDegrees = (face) => (180 * (2 * face + 1)) / sides;
  for (let face = 0; face < sides; face += 1) {
    const from = (2 * Math.PI * face) / sides;
    const to = (2 * Math.PI * (face + 1)) / sides;
    // The face's own outward normal bisects the two vertices it joins.
    const nx = snap(Math.cos((from + to) / 2));
    const ny = snap(Math.sin((from + to) / 2));
    const vertexFrom = [snap(Math.cos(from)), snap(Math.sin(from))];
    const vertexTo = [snap(Math.cos(to)), snap(Math.sin(to))];
    pushFace(kept, nx, ny, vertexFrom, vertexTo, w, h, r, faceStep);

    /*
      The rectangle edges whose normals fall strictly inside this junction, in the order the walk
      meets them. A junction spans `360 / sides` degrees, which is under 360, so each edge lifts
      into it at most once; sorting matters only for a triangle, whose junctions are wide enough to
      take two.
    */
    const low = faceDegrees(face);
    const high = faceDegrees(face + 1);
    const between = [];
    for (const edge of RECT_EDGES) {
      if (!((edge.broad ? w : h) > 0)) continue;
      let degrees = edge.degrees;
      while (degrees <= low) degrees += 360;
      if (degrees < high) between.push({ ...edge, degrees });
    }
    between.sort((a, b) => a.degrees - b.degrees);
    // A rectangle edge is translated by the polygon's support point in *its* normal direction,
    // which is the vertex these two faces share -- so both of its ends sit on `vertexTo`.
    for (const edge of between) {
      pushFace(kept, edge.nx, edge.ny, vertexTo, vertexTo, w, h, r, faceStep);
    }
  }
  return kept;
}

/**
 * One edge of the sum: its two ends, and `faceStep`'s cuts between them.
 *
 * `nx`/`ny` is the edge's own normal and is carried by every sample it emits, which is what makes
 * the facet flat and the join to the next edge a crease. `from`/`to` are the polygon directions the
 * two ends sit on -- the same one twice for a rectangle edge, whose length comes entirely from the
 * sign pair flipping.
 *
 * The cut is the one `profileRing()` makes in a rectangle's straight faces and is there for the
 * same reason: a flat facet swept along a turning spine is a twisted quad, and two triangles across
 * it lay a roof over the ruled surface they approximate.
 */
function pushFace(kept, nx, ny, from, to, w, h, r, faceStep) {
  const start = { su: supportSign(nx, ny, false), sv: supportSign(ny, nx, true), px: from[0], py: from[1], nx, ny };
  // Where a component of the normal is zero the rectangle's support is an edge rather than a point,
  // and this edge is collinear with it -- so the two ends take the support's two ends. Which is
  // which follows from the direction of travel, the normal turned a quarter turn counter-clockwise.
  const end = {
    su: nx !== 0 ? start.su : -start.su,
    sv: ny !== 0 ? start.sv : -start.sv,
    px: to[0],
    py: to[1],
    nx,
    ny,
  };
  kept.push(start);
  const length = Math.hypot(
    (end.su - start.su) * w + r * (end.px - start.px),
    (end.sv - start.sv) * h + r * (end.py - start.py),
  );
  // The same 1e-9 the arc path takes, and for the same reason: a face that is an exact multiple of
  // the step must not take an extra segment on some widths and not on others.
  const pieces = faceStep > 0 ? Math.ceil(length / faceStep - 1e-9) : 1;
  for (let piece = 1; piece < pieces; piece += 1) {
    const t = piece / pieces;
    kept.push({
      su: start.su + (end.su - start.su) * t,
      sv: start.sv + (end.sv - start.sv) * t,
      px: start.px + (end.px - start.px) * t,
      py: start.py + (end.py - start.py) * t,
      nx,
      ny,
    });
  }
  kept.push(end);
}

/**
 * The rectangle's support sign on one axis, for an edge with this normal.
 *
 * `mine` is the normal's component on the axis being decided and `other` is the component on the
 * axis it is not. When `mine` is non-zero the support is a corner and the sign is its own; when it
 * is zero the support is a whole edge and the answer is the *start* of it, which is a quarter turn
 * back from the direction of travel `(-ny, nx)`.
 */
function supportSign(mine, other, isV) {
  if (mine !== 0) return Math.sign(mine);
  return isV ? -Math.sign(other) : Math.sign(other);
}

/** The sample list as the flat array the sweep reads, arc and polygon alike. */
function pack(kept) {
  const ring = new Float32Array(kept.length * RING_STRIDE);
  kept.forEach((sample, index) => {
    const at = index * RING_STRIDE;
    ring[at] = sample.su;
    ring[at + 1] = sample.sv;
    // An arc sample's position direction and its normal are the same vector, which is the property
    // a Minkowski sum with a disc has and a polygon does not.
    ring[at + 2] = sample.px ?? sample.cos;
    ring[at + 3] = sample.py ?? sample.sin;
    ring[at + 4] = sample.nx ?? sample.cos;
    ring[at + 5] = sample.ny ?? sample.sin;
  });
  return ring;
}

function duplicate(a, b, hasW, hasH) {
  if (a.arc !== b.arc) return false;
  if (hasW && a.su !== b.su) return false;
  if (hasH && a.sv !== b.sv) return false;
  return true;
}

/*
  `Math.cos(Math.PI / 2)` is 6.1e-17, not zero, and a flat face whose normal is `(6.1e-17, 1)`
  shades no differently but *reads* differently in a test and drifts once it is scaled by a radius.
  The four cardinal directions are exact here.
*/
function snap(value) {
  return Math.abs(value) < 1e-12 ? 0 : value;
}

export function ringSampleCount(ring) {
  return ring.length / RING_STRIDE;
}

/**
 * One ring sample, placed at `(w, h, r)`.
 *
 * `out` receives four numbers: the point `(u, v)` in the cross-section's own axes, and the outward
 * normal `(nu, nv)`. The normal is exact rather than approximated in both families -- for a
 * Minkowski sum with a disc it *is* the arc direction, on the corners and along the faces alike,
 * and for one with a polygon it is the facet's own, carried by every sample the facet emitted.
 */
export function profilePoint(ring, index, w, h, r, out) {
  const base = index * RING_STRIDE;
  out[0] = ring[base] * w + r * ring[base + 2];
  out[1] = ring[base + 1] * h + r * ring[base + 3];
  out[2] = ring[base + 4];
  out[3] = ring[base + 5];
  return out;
}

/**
 * The whole closed polyline, for a caller that wants the shape rather than the sweep.
 *
 * This is what a test and a reader want: `points` is `2 x count` coordinates in the cross-section's
 * own axes and `normals` is `2 x count` outward directions, both closed by wrapping.
 */
export function profilePolyline(w, h, r, cornerSegments = 4, faceStep = 0, sides = 0) {
  const ring = profileRing(w, h, r, cornerSegments, faceStep, sides);
  const count = ringSampleCount(ring);
  const points = new Float32Array(count * 2);
  const normals = new Float32Array(count * 2);
  const sample = new Float32Array(4);
  for (let index = 0; index < count; index += 1) {
    profilePoint(ring, index, w, h, r, sample);
    points[index * 2] = sample[0];
    points[index * 2 + 1] = sample[1];
    normals[index * 2] = sample[2];
    normals[index * 2 + 1] = sample[3];
  }
  return { count, points, normals };
}
