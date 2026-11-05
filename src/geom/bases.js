/*
  The nucleotide bases: one solid per base, on the ring atoms' own plane.

  `profiles-catalog.js` says what a `bases` look is and why it is not a second builder. This file
  exists for the same reason `arrow.js` and `rails.js` do -- one thing that had to be measured
  before it could be authored:

  **A base is flat to 0.008 A.** That is the RMS deviation of a purine's nine ring atoms from their
  own least-squares plane, meaned over 1BNA; 0.015 A over 1EHZ's 76, modified bases included.
  Against a slab 0.40 A thick that is a fortieth of the thickness, so **a solid on the ring plane is
  a description of the base rather than an approximation of one** -- which is the whole argument for
  drawing it as a slab at all, and the same argument `geom/markers.js` makes for a faceted ion.

  Two consequences follow from it and are worth stating before either reads as a shortcut. The plane
  normal can be taken from the ring polygon directly (Newell's method, below) rather than fitted,
  because at that flatness the two agree to well under a degree. And the solid needs no smoothing:
  its faces are flat, so its vertices are **not** shared between faces and each carries its own
  face's normal, exactly as a marker's do. A shared vertex would average two face normals and round
  off the one edge a base is read by.

  ---

  ## What comes from Mol* and what is ours

  **Mol* answers "which atoms are the ring".** `setPurinIndices` / `setPyrimidineIndices` in
  `mol-repr/structure/visual/util/nucleotide.js` -- the same directory `sweep.js` already takes
  `PolymerTraceIterator` and `curve-segment.js` from, so this is the seam that exists rather than a
  new one. They are worth taking rather than writing: they carry the modified-ring fallbacks (DP
  spells its C5 as N5 and its N7 as C7; DZ spells its N1 as C1), and `getNucleotideBaseType` falls
  back to the C4-N9 distance when a component name is unknown to the dictionary. Hand-written atom
  lists would get all three wrong on the structures that need them most.

  **Nothing else does.** The perimeter order, the frame, the extents, the thickness and the stem are
  ours. In particular the block is sized from **its own ring's** extent rather than from Mol*'s fixed
  4.5 x 4.5 A for a purine and 4.5 x 3.0 for a pyrimidine: the longest ring diagonal measures 3.57 A
  mean on 1BNA and 3.66 on 1EHZ with a p95 of 4.4, so a fixed pair of numbers is a fit to the two
  standard cases and says nothing about a modified base. `basePad` grows the ring's own extent
  in-plane instead, which is one authored number that means the same thing on every base.

  **And Mol*'s own block and ring meshes are deliberately not used.** `createNucleotideBlockMesh` and
  `createNucleotideRingMesh` are module-private -- only the `UnitsMeshVisual` factories are exported,
  and those are the rasteriser, which is this product's preview and never its picture.
  Their numbers are the size-theme vocabulary `profiles-catalog.js` replaced with authored
  Angstroms, and the block's glycosidic connector is a `radialSegments 16` tube where this tracer
  intersects a capsule exactly.

  ---

  ## The stem attaches to the spine, not to the trace atom

  Mol*'s block runs its connector from N9 or N1 to the **trace atom**, which for a nucleotide is
  `O3'` (`PolymerTypeAtomRoleId[DNA].trace`, not the phosphorus). It gets away with that because its
  own nucleic ribbon is wide and flat and the atom is buried inside it. Ours cannot: the spine is a
  tensioned interpolation *through* the trace atoms and passes near them rather than through them,
  and a nucleic backbone here is a cord rather than a slab -- a 3.5 A tube on `nucleic_ribbon`, a
  panel 0.58 A thick on `nucleic_blocks` -- so a stem ending at the atom would end in mid-air beside
  it on the looks where it shows most.

  So the stem ends at the nearest point on **the spine this residue was actually swept along**,
  which is `rails.js`'s rule one scale down: read the centre line off the rows the sweep placed, so
  it inherits the taper, the overhang and the frame with nothing re-deriving a curve. The stem is
  4.54 A long on 1BNA (p05 4.14, p95 4.78) and it is long because the spine is on the backbone and
  the base points inward at it; that is the shape, not a slack connector.

  **The stem is a capsule and shares `emitCapsuleChain`** with the rail and the rod, for the reason
  that file gives: the tracer's cylinders are flat-capped, so a tube with nothing at its ends is a
  sawn-off tube. Both ends are round here -- the base end because it is a free end, the spine end
  because it is buried and costs nothing to round.
*/

import {
  createNucleicIndices, setPurinIndices, setPyrimidineIndices,
  hasPurinIndices, hasPyrimidineIndices, getNucleotideBaseType,
} from 'molstar/lib/mol-repr/structure/visual/util/nucleotide.js';

import { faceNormal } from './markers.js';
import { applyOperator } from './operator.js';
import { emitCapsuleChain } from './rails.js';

/**
 * The shapes a look may name, and the key space of `blockSolid`/`ringSolid` below.
 *
 * Every `bases` value in the catalogue has to be one of these, the way every sweep row has to have
 * a look: a look naming a shape nobody builds would draw a backbone and no bases and say nothing
 * about it.
 */
export const BASE_SHAPES = ['block', 'ring'];

/**
 * Below this a stem is not a stem -- the same floor, and the same reason, as `RAIL_EPSILON`.
 *
 * It keeps a look that authored no `baseStem` from emitting a line of sub-picometre spheres that
 * nothing can see and the BVH still has to sort.
 */
const STEM_EPSILON = 1e-4;

/**
 * Below this a base is not a base, and the panel's `Base thickness` reaches 0.
 *
 * A slab of no thickness is not a thin slab: `emitSolid()` drops its four zero-area walls and what
 * is left is the two caps, coincident and wound against each other -- the same coincident geometry
 * `sweep.js` refuses at a rod's end cap, and the tracer speckles it. Zero is how the base comes off,
 * so it emits nothing; the stem is a separate field with a separate zero.
 */
const SOLID_EPSILON = 1e-4;

/*
  The **perimeter** of each ring, in order, which is not the numbering order.

  A pyrimidine is one six-ring and the two coincide. A purine is a six-ring (N1 C2 N3 C4 C5 C6)
  fused to a five-ring (C4 C5 N7 C8 N9) across the C4-C5 bond, so its outline is the union minus
  that bond: N1 C2 N3 C4 **N9 C8 N7 C5** C6, a nine-gon. Walking the numbering instead would fold
  the polygon across the fusion and the solid would come out with a crease through the middle of it.

  This is the same outline Mol*'s `stripIndicesRing5_6` traces; it is the shape of the molecule
  rather than anybody's choice, which is why it is written as the fact it is and not cited.
*/
const PURINE_RIM = ['N1', 'C2', 'N3', 'C4', 'N9', 'C8', 'N7', 'C5', 'C6'];
const PYRIMIDINE_RIM = ['N1', 'C2', 'N3', 'C4', 'C5', 'C6'];

/** The shape a look draws its bases as, or `null` when it draws none. */
export function basesShape(look) {
  return look.bases ?? null;
}

/**
 * The accumulator, holding the look because every base in a style shares it.
 *
 * `skipped` is not a debug counter. Geometry that cannot be built produces a note, never a quiet
 * fallback -- and a base whose ring Mol* cannot complete is exactly that case, so the count travels
 * out of here and `scene.js` states it.
 */
export function createBases(look) {
  return { look, items: [], skipped: 0, operator: undefined };
}

/**
 * One residue's base, if it has one.
 *
 * `points` and `rows` are the sweep's own spine for this residue -- the array `sweepResidue` built,
 * after the overhang and the entry depth have written into it -- so the stem lands on the curve that
 * was drawn rather than on the one that would have been.
 *
 * Positions come from `unit.conformation.invariantPosition`, which is the **model** space
 * `PolymerTraceIterator` reads its control points in (`atomicConformation.x[index]`, not the unit's
 * transformed mapping). Matching it is not optional: a base a whole operator away from its own
 * backbone is the failure this reads for.
 */
export function addBase(bases, unit, residueIndex, points, rows, color) {
  const rim = readRim(unit, residueIndex);
  if (!rim) {
    bases.skipped += 1;
    return;
  }
  /*
    The rim, the anchor and the spine are all found in model space -- the rim off
    `unit.conformation.invariantPosition`, the spine off the sweep's own curve -- and the unit's
    operator goes on all three together, once they agree with each other. `geom/operator.js` has
    why the sweep needs one at all; the identity is a no-op, so a deposition is untouched.
  */
  const spine = nearestOnSpine(points, rows, rim.anchor);
  for (const p of rim.points) applyOperator(bases.operator, p);
  applyOperator(bases.operator, rim.anchor);
  applyOperator(bases.operator, spine);
  bases.items.push({ rim, anchor: rim.anchor, spine, color });
}

/**
 * Every base in the style, as triangles plus the stems as capsules.
 *
 * The mesh half goes into the same `positions`/`normals`/`colors`/`indices` arrays the sweep writes,
 * because it is the same style and the same material; the stems go into `mesh.bases`, which
 * `scene.js` reads exactly as it reads `mesh.rails` and `mesh.helices`.
 */
export function emitBases(mesh, bases) {
  const { look } = bases;
  const shape = basesShape(look);
  if (!shape) return mesh;
  const half = look.baseThickness ?? 0;
  const pad = look.basePad ?? 0;
  const stem = look.baseStem ?? 0;
  for (const item of bases.items) {
    const normal = newellNormal(item.rim.points);
    if (!normal) { bases.skipped += 1; continue; }
    if (half > SOLID_EPSILON) {
      const solid = shape === 'block'
        ? blockSolid(item.rim, item.anchor, normal, half, pad)
        : ringSolid(item.rim, normal, half);
      emitSolid(mesh, solid, item.color);
    }
    if (stem > STEM_EPSILON) {
      // Two points, so two colours: a base is one object per nucleotide and both ends of its stem
      // are that residue's own colour, which is the colour the blended backbone carries at the row
      // the residue reaches its own numbers on.
      emitCapsuleChain(
        mesh.bases, [item.anchor, item.spine], [stem, stem], [item.color, item.color], true, true,
      );
    }
  }
  return mesh;
}

/**
 * The ring atoms in perimeter order, plus the glycosidic anchor.
 *
 * Returns `null` rather than a partial ring, and the caller counts it: a base missing one of its
 * ring atoms is a base this renderer refuses to draw, not one it draws with a notch in it.
 */
function readRim(unit, residueIndex) {
  const idx = createNucleicIndices();
  const { isPurine, isPyrimidine } = getNucleotideBaseType(unit, residueIndex);
  let order;
  let anchorKey;
  if (isPurine) {
    setPurinIndices(idx, unit, residueIndex);
    if (!hasPurinIndices(idx)) return null;
    order = PURINE_RIM;
    anchorKey = 'N9';
  } else if (isPyrimidine) {
    setPyrimidineIndices(idx, unit, residueIndex);
    if (!hasPyrimidineIndices(idx)) return null;
    order = PYRIMIDINE_RIM;
    anchorKey = 'N1';
  } else {
    return null;
  }
  const at = (key) => {
    const out = [0, 0, 0];
    unit.conformation.invariantPosition(idx[key], out);
    return out;
  };
  return { points: order.map(at), anchor: at(anchorKey) };
}

/**
 * The ring plane's unit normal, by Newell's method.
 *
 * Newell's is the area-weighted cross-product sum over the polygon's own edges, so every ring atom
 * contributes and no three of them are privileged -- which matters on a nine-gon whose two rings
 * are very slightly out of plane with each other. It is also **signed by the winding**, so the
 * normal it returns is the one the perimeter above runs counter-clockwise about; the prism's caps
 * and its wall are wound against that and cannot disagree with each other.
 *
 * `null` when the polygon has no area, which no real base has and a mangled file might.
 */
function newellNormal(points) {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const length = Math.hypot(x, y, z);
  if (!(length > 1e-9)) return null;
  return [x / length, y / length, z / length];
}

/**
 * The slab: an oriented box on the ring's own plane, sized from the ring's own extent.
 *
 * The frame is `(l, w, n)`, right-handed. `n` is the plane normal; `l` runs from the glycosidic
 * anchor toward the ring centroid, which is **the direction the base points away from the
 * backbone** and is the one axis with a meaning a viewer can name; `w` is `n x l`. Deriving `l`
 * from the anchor rather than from a named pair of ring atoms is what makes it work unchanged on a
 * purine, a pyrimidine and a modified ring whose atom names we have never seen.
 *
 * The extents are the rim's own projections onto `l` and `w`, grown by `basePad`. The pad is the
 * one authored number here and it stands in for what the ring-atom centres leave out -- the
 * hydrogens, the exocyclic oxygens and amines, and the van der Waals skin. `blockSolid` is
 * therefore never smaller than the ring it is drawn for, which is the property it is held to.
 */
function blockSolid(rim, anchor, normal, half, pad) {
  const centre = centroid(rim.points);
  const along = normalize(subtract(centre, anchor));
  const l = along ?? anyPerpendicular(normal);
  // Re-orthogonalise against the normal before taking `w`: the anchor is a ring atom, so `l` is
  // in-plane to the same 0.008 A the plane is flat to, but "very nearly" is not a basis.
  const lp = normalize(subtract(l, scale(normal, dot(l, normal)))) ?? anyPerpendicular(normal);
  const w = cross(normal, lp);

  let lLo = Infinity; let lHi = -Infinity;
  let wLo = Infinity; let wHi = -Infinity;
  for (const point of rim.points) {
    const d = subtract(point, centre);
    const dl = dot(d, lp);
    const dw = dot(d, w);
    if (dl < lLo) lLo = dl;
    if (dl > lHi) lHi = dl;
    if (dw < wLo) wLo = dw;
    if (dw > wHi) wHi = dw;
  }
  lLo -= pad; lHi += pad; wLo -= pad; wHi += pad;

  // Corner `a*4 + b*2 + c`, where the bits are (l, w, n) and 1 is the high side. The six faces
  // below are wound counter-clockwise seen from outside, which is re-derived from the winding
  // rather than trusted.
  const corner = (a, b, c) => add(
    add(centre, scale(lp, a ? lHi : lLo)),
    add(scale(w, b ? wHi : wLo), scale(normal, c ? half : -half)),
  );
  const vertices = [];
  for (let a = 0; a < 2; a += 1) {
    for (let b = 0; b < 2; b += 1) {
      for (let c = 0; c < 2; c += 1) vertices.push(corner(a, b, c));
    }
  }
  const faces = [];
  const quad = (p, q, r, s) => { faces.push([p, q, r], [p, r, s]); };
  quad(1, 5, 7, 3); // +n
  quad(0, 2, 6, 4); // -n
  quad(4, 6, 7, 5); // +l
  quad(0, 1, 3, 2); // -l
  quad(2, 3, 7, 6); // +w
  quad(0, 4, 5, 1); // -w
  return { vertices, faces };
}

/**
 * The prism: the ring's own outline, extruded.
 *
 * This is the shape a block only approximates -- a purine's fused nine-gon and a pyrimidine's
 * hexagon read apart by silhouette rather than by size, which is the whole reason to have both
 * looks. No pad: the outline **is** the look here, and growing it would round the fusion notch that
 * distinguishes the two.
 *
 * The caps are fans from the rim centroid rather than a hand-authored index table. A centroid fan
 * needs the polygon to contain its own centroid, which both rings do by a wide margin, and it costs
 * two triangles more per base than the minimal fan while working unchanged on a modified ring of
 * any size.
 */
function ringSolid(rim, normal, half) {
  const n = rim.points.length;
  const lift = scale(normal, half);
  const vertices = [];
  for (const point of rim.points) vertices.push(add(point, lift));
  for (const point of rim.points) vertices.push(subtract(point, lift));
  const centre = centroid(rim.points);
  const top = vertices.push(add(centre, lift)) - 1;
  const bottom = vertices.push(subtract(centre, lift)) - 1;

  const faces = [];
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    // Caps: counter-clockwise about `+n` on top, and the reverse below, which is the winding
    // Newell's normal already fixed.
    faces.push([top, i, j]);
    faces.push([bottom, n + j, n + i]);
    // The wall. Outward is `edge x n`, and `(bottom i, bottom j, top j, top i)` winds
    // counter-clockwise about it.
    faces.push([n + i, n + j, j], [n + i, j, i]);
  }
  return { vertices, faces };
}

/**
 * A solid as flat-shaded triangles, vertices unshared.
 *
 * The same construction and the same reason as `geom/markers.js`: `intersectTriangle`
 * barycentric-interpolates the vertex normals, so one normal per face per vertex is what makes each
 * face catch its own highlight with a hard edge between them. It also makes `smoothOffset()` exactly
 * zero on a base, which is the right answer for a solid that really is flat.
 */
function emitSolid(mesh, solid, color) {
  for (const [ia, ib, ic] of solid.faces) {
    const a = solid.vertices[ia];
    const b = solid.vertices[ib];
    const c = solid.vertices[ic];
    const normal = faceNormal(a, b, c);
    if (!normal) continue;
    const base = mesh.positions.length / 3;
    for (const vertex of [a, b, c]) {
      mesh.positions.push3(vertex[0], vertex[1], vertex[2]);
      mesh.normals.push3(normal[0], normal[1], normal[2]);
      mesh.colors.push3(color[0], color[1], color[2]);
    }
    mesh.indices.push3(base, base + 1, base + 2);
  }
}

/**
 * The point on this residue's swept spine nearest the base's anchor.
 *
 * Nearest on the **polyline**, segment by segment, rather than nearest sample: at eight samples a
 * residue the two differ by up to half a step, which is enough to angle every stem in a duplex the
 * same wrong way and read as a systematic lean rather than as noise.
 */
function nearestOnSpine(points, rows, anchor) {
  let best = [points[0], points[1], points[2]];
  let bestDistance = Infinity;
  for (let row = 0; row + 1 < rows; row += 1) {
    const a = [points[row * 3], points[row * 3 + 1], points[row * 3 + 2]];
    const b = [points[(row + 1) * 3], points[(row + 1) * 3 + 1], points[(row + 1) * 3 + 2]];
    const ab = subtract(b, a);
    const length = dot(ab, ab);
    const t = length > 1e-12 ? Math.max(0, Math.min(1, dot(subtract(anchor, a), ab) / length)) : 0;
    const point = add(a, scale(ab, t));
    const d = distanceSquared(point, anchor);
    if (d < bestDistance) { bestDistance = d; best = point; }
  }
  return best;
}

function centroid(points) {
  const out = [0, 0, 0];
  for (const p of points) { out[0] += p[0]; out[1] += p[1]; out[2] += p[2]; }
  return [out[0] / points.length, out[1] / points.length, out[2] / points.length];
}

/** Any unit vector perpendicular to `v`, for the degenerate case where the anchor is the centroid. */
function anyPerpendicular(v) {
  const axis = Math.abs(v[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return normalize(cross(v, axis)) ?? [1, 0, 0];
}

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const distanceSquared = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

function normalize(v) {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (!(length > 1e-9)) return null;
  return [v[0] / length, v[1] / length, v[2] / length];
}
