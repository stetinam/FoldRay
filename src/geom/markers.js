/*
  The ion markers: a faceted solid where `ion_spheres` draws a sphere.

  **What a marker is, and why it is not just another atom representation.** The ion component is the
  one place this product draws a *symbol* rather than a molecule. `ion_spheres` and everything here
  put one shape at one atom and draw no bonds at all -- there is nothing to bond a monoatomic ion
  to -- so the shape is free to be chosen for how it reads rather than for what it measures.
  `src/residues.js` is what makes that safe: an ion is a name Mol* calls an ion **and** a residue
  with one atom in it, so a sulfate never arrives here and is never drawn as five gems.

  **These are triangles, and that is not a contradiction of "analytic beats tessellated".** That
  rule says never to mesh something the tracer can intersect exactly, and it is why `ion_spheres`
  stays an analytic sphere and must. A faceted solid is not something the tracer can intersect --
  there is no analytic primitive to beat -- and the facets *are* the look rather than an
  approximation of a rounder one. The cost is nil either way: an icosahedron is 20 triangles and an
  octahedron 8, so nine ions are 180 or 72 against a cartoon's seventy thousand.

  **Every marker is inscribed in the sphere `ion_spheres` would have drawn.** One rule, stated once:
  the vertex tables below are unit vectors, so a marker's vertices land exactly on the sphere of the
  same radius and no facet ever reaches past it. Switching an ion look therefore never grows the
  thing -- a marker cannot start touching something the sphere did not. The visible consequence is
  that a solid with few faces looks *smaller* than the sphere: an octahedron's faces sit at
  1/sqrt(3) = 0.577 of the radius and an icosahedron's at 0.795. That is the shape and not a size
  bug, and it is why the octahedron reads as a sharp little diamond rather than as a ball.

  **Flat shading is the whole effect and it is free.** `intersectTriangle` barycentric-interpolates
  the vertex normals, so giving each face its own three vertices carrying that face's own normal
  makes every facet catch its own specular highlight with a hard edge between them. It also makes
  `smoothOffset()` exactly zero here -- it measures how far the shading normal has lifted the
  surface off the triangle plane, and on a flat face `dot(p - v, n)` is zero for all three vertices.
  So the terminator fix neither helps nor hinders a marker, which is the right answer for a solid
  that really is flat.

  **The orientation is fixed and shared, deliberately.** A per-ion rotation seeded off the atom
  would read as scattered gems and would be defensible, but a shared one reads as intentional -- a
  row of ions all facing the same way looks placed rather than spilled -- and it needs no hash, so
  the renderer's bit-determinism holds by construction rather than by a seed nobody may change. The
  octahedron carries a vertex on +Z, which is the renderer's up, so it stands on its point.

  **Provenance.** Both solids are Platonic, which is about as published as a fact gets; the
  icosahedron's twelve vertices are the standard three golden rectangles, `(0, +/-1, +/-phi)` and
  its two cyclic permutations. The icosahedron's vertex and face order is the common table Mol\*'s
  `mol-geo/primitive/icosahedron` and three.js carry. The tables are re-derived rather than trusted
  -- every vertex unit length, every face wound so its normal points outward, every edge shared by
  exactly two faces -- because a mistyped index in a face table draws a solid with a hole in it that
  looks fine from most angles.
*/

import { FloatList, IndexList } from './buffers.js';

const PHI = (1 + Math.sqrt(5)) / 2;

function normalized(vertices) {
  return vertices.map(([x, y, z]) => {
    const length = Math.hypot(x, y, z);
    return [x / length, y / length, z / length];
  });
}

/*
  The regular icosahedron: 12 vertices, 20 faces.

  This is `ion_faceted`, and it is the shape that row promises. Twenty faces is close enough to
  round that the silhouette still reads as a ball; what it buys over `ion_spheres` is twenty flat
  highlights instead of one, which is the difference between a bead and a cut stone.
*/
const ICOSAHEDRON = {
  vertices: normalized([
    [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
    [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
    [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
  ]),
  faces: [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ],
};

/*
  The regular octahedron: 6 vertices, 8 faces.

  Two square pyramids base to base, which is the shape most people mean by "a diamond" and is also
  the coordination geometry of half the metals that reach this component -- Mg(2+), Ca(2+), Fe(3+),
  Mn(2+) are all six-coordinate. So it is apt rather than arbitrary, which is worth having when the
  alternative is a shape chosen only because it looked good.

  The first four faces share the +Z apex and the last four the -Z one, so the solid stands on a
  point in the renderer's Z-up world.
*/
const OCTAHEDRON = {
  vertices: normalized([
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ]),
  faces: [
    [0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4],
    [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5],
  ],
};

/*
  Keyed by representation id, the way `profiles-catalog.js` is keyed for the sweep.

  A new marker shape is a vertex table and a face table -- never a builder. `capabilities.js` is the
  other half: these keys and the ids whose family is `marker` must be the same set in both
  directions, since a marker row with no solid would draw nothing and a solid with no row would be
  unreachable, and both of those are silent.
*/
export const MARKERS = {
  ion_faceted: ICOSAHEDRON,
  ion_octahedron: OCTAHEDRON,
};

/** The solid a representation id names, or `null` -- the caller refuses rather than substituting. */
export function markerFor(representation) {
  return MARKERS[representation] ?? null;
}

/** The outward unit normal of one face from its own winding, or `null` for a degenerate one. */
export function faceNormal(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  const length = Math.hypot(n[0], n[1], n[2]);
  if (!(length > 1e-12)) return null;
  return [n[0] / length, n[1] / length, n[2] / length];
}

/**
 * One mesh carrying every marker in a style.
 *
 * `markers` is `{ position, radius, color }` per ion, and the mesh comes back in the shape
 * `appendMesh()` reads: flat `positions` / `normals` / `colors` triples and an `indices` array. One
 * mesh rather than one per ion, because the scene builder appends meshes and each append walks the
 * whole vertex list -- and because every marker in a style shares one material anyway.
 *
 * Vertices are **not** shared between faces. That is the flat shading: a shared vertex would carry
 * one averaged normal and round every edge off, which is the one thing this shape exists not to do.
 */
export function buildMarkerMesh(solid, markers) {
  // The exact size is known before a vertex is written -- one marker is `solid.faces.length`
  // triangles and every one of them is three fresh vertices -- so these never grow.
  const vertices = markers.length * solid.faces.length * 3;
  const positions = new FloatList(Math.max(4, vertices * 3));
  const normals = new FloatList(Math.max(4, vertices * 3));
  const colors = new FloatList(Math.max(4, vertices * 3));
  const indices = new IndexList(Math.max(4, vertices));
  for (const marker of markers) {
    const [cx, cy, cz] = marker.position;
    const { radius, color } = marker;
    for (const [ia, ib, ic] of solid.faces) {
      const a = solid.vertices[ia];
      const b = solid.vertices[ib];
      const c = solid.vertices[ic];
      const normal = faceNormal(a, b, c);
      const base = positions.length / 3;
      for (const vertex of [a, b, c]) {
        positions.push3(cx + vertex[0] * radius, cy + vertex[1] * radius, cz + vertex[2] * radius);
        normals.push3(normal[0], normal[1], normal[2]);
        colors.push3(color[0], color[1], color[2]);
      }
      indices.push3(base, base + 1, base + 2);
    }
  }
  return {
    positions: positions.toTyped(),
    normals: normals.toTyped(),
    colors: colors.toTyped(),
    indices: indices.toTyped(),
  };
}
