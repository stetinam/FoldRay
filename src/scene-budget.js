/*
  What a style will cost, estimated before it is built, from counts already in hand.

  The scene build holds the main thread and Mol*'s marching cubes cannot be interrupted, so a
  composition too large to build freezes the tab before anything can say so. Nothing here builds
  geometry: it counts residues, atoms and bonds, and for a surface it sizes the grid Mol* will
  allocate.

  Two answers come out of it, and only one of them stops anything. A style the tracer would refuse
  once it was built -- more primitives than it can index -- is not started. Everything else is
  built; a build expected to hold the page for tens of seconds, or to take gigabytes, is announced
  first.

  **Every constant below was measured**, one style per build under node on one workstation, against
  32 structures (every shipped sample and 27 depositions and predictions, the 413,760-atom 1AYM
  capsid and the 10EC portal ring among them). A 15 W laptop is slower by a factor not measured
  here, so the time threshold is a ratio to that workstation rather than a promise about any other.
*/

import { representationFamily, bondIsDrawn } from './capabilities.js';
import { profileFor } from './geom/profiles-catalog.js';
import { profileRing, ringSampleCount } from './geom/profile.js';
import { segmentsFor, FACE_STEP } from './geom/sweep.js';
import { RAIL_EPSILON, RAIL_TURN_LIMIT } from './geom/rails.js';
import { isRodResidue } from './geom/rods.js';
import { GAUSSIAN } from './geom/surface-levels.js';
import { markerFor } from './geom/markers.js';

/** A BVH leaf start and child index are float32, exact only to here (`render/renderer.js`). */
export const PRIMITIVE_LIMIT = 2 ** 24;

/*
  A refusal reads `floor`, which counts a cord or a rod at one step a row and a stick at its bonds
  alone, and it has run over its own build by at most 1.13 (the ring taken at the widest of three
  residues). A style is refused only when even this much overshoot leaves it past the limit, so a
  refusal is certain rather than a guess.
*/
export const ESTIMATE_OVERSHOOT = 1.15;

/*
  Warn at 20 s of main-thread build on that workstation, or 3 GiB of build allocation. The lines fall
  between what works and what does not: the 1AYM capsid as `surface` (11 s, 0.7 GiB) or `cartoon`
  (6 s, 1.7 GiB) stays quiet, and so does every bench case and gallery tile; as
  `surface_soft_pockets` (32 s), `surface_smooth_pockets` (133 s, 3.9 GiB), `surface_open_cavities`
  (267 s, 8.2 GiB) or `cartoon_cords` (28 s, 4.4 GiB) it warns, as do 1AON's two solvent-excluded
  rungs (35 s and 51 s).
*/
export const WARN_BUILD_MS = 20000;
export const WARN_BUILD_BYTES = 3 * 2 ** 30;

/*
  Per-unit costs, least squares over the corpus: milliseconds and bytes per primitive, per grid
  cell, and per cell stamped round an atom (the field's own work, which is what separates a dense
  capsid from sixty ions spread over the same box). The gaussian pair is fitted to 1AYM alone --
  its protein at levels 1 and 2 and its ions -- because that is where the line is drawn. Bytes are
  the build's own peak over the parse, one process per style on 1AYM; an untouched grid cell is
  never paged in, so it costs the one array Mol* fills.
*/
const COST = {
  sweepTriangle: { ms: 0.00036, bytes: 117 },
  sweepAnalytic: { ms: 0.0015, bytes: 256 },
  markerTriangle: { ms: 0.0007, bytes: 430 },
  atomPrimitive: { ms: 0.0012, bytes: 120 },
  gaussianCell: { ms: 0.00003, bytes: 4 },
  gaussianStamp: { ms: 0.0002, bytes: 12 },
  sesCell: { ms: 0.00017, bytes: 8 },
  sesStamp: { ms: 0.0016, bytes: 25 },
};

const PROTEIN_KINDS = new Set(['helix', 'sheet', 'loop']);
const TRACED = new Set(['protein', 'nucleic']);

/*
  How far a cord turns across one residue, in degrees, fitted low over the corpus's railed looks. A
  cord takes a step per `RAIL_TURN_LIMIT` of turn, so this over the limit is its steps.
*/
const CORD_TURN = { helix: 115, sheet: 40, loop: 95, nucleic: 95 };

function residueKind(residue, secondaryStructure) {
  if (residue.component === 'nucleic') return 'nucleic';
  const kind = secondaryStructure?.get(residue.key);
  return PROTEIN_KINDS.has(kind) ? kind : 'loop';
}

const unitOf = (residue) => residue.atoms[0]?.unitId;

/*
  A sweep: `rows` ring segments of two triangles per ring sample, the ring being the one `sweep.js`
  places -- the widest of the residue and its two neighbours. Rails, rods and bases are analytic.
*/
function sweepCounts(look, residues, secondaryStructure) {
  const rows = segmentsFor(look);
  const panel = look.panel !== false;
  const rings = new Map();
  const ringFor = (before, here, after) => {
    const key = `${before}|${here}|${after}`;
    let count = rings.get(key);
    if (count === undefined) {
      const [a, b, c] = [profileFor(look, before), profileFor(look, here), profileFor(look, after)];
      try {
        count = ringSampleCount(profileRing(
          Math.max(a.w, b.w, c.w), Math.max(a.h, b.h, c.h), Math.max(a.r, b.r, c.r),
          look.cornerSegments, look.faceStep ?? FACE_STEP, look.sides ?? 0,
        ));
      } catch {
        // `sweep.js` refuses this ring with a note of its own.
        count = 0;
      }
      rings.set(key, count);
    }
    return count;
  };
  let triangles = 0;
  let analytic = 0;
  let floor = 0;
  const kinds = residues.map((residue) => residueKind(residue, secondaryStructure));
  for (let index = 0; index < residues.length; index += 1) {
    if (!TRACED.has(residues[index].component)) continue;
    const kind = kinds[index];
    const unit = unitOf(residues[index]);
    const before = index > 0 && unitOf(residues[index - 1]) === unit ? kinds[index - 1] : kind;
    const after = index + 1 < residues.length && unitOf(residues[index + 1]) === unit
      ? kinds[index + 1] : kind;
    if (isRodResidue(look, kind)) {
      analytic += 2 * rows;
      floor += 2;
      continue;
    }
    if (panel) triangles += 2 * rows * ringFor(before, kind, after);
    // Two cords, each a joint and a rod per step.
    if ((profileFor(look, kind).rail ?? 0) > RAIL_EPSILON) {
      analytic += 2 * 2 * Math.max(rows, Math.round(CORD_TURN[kind] / RAIL_TURN_LIMIT));
      floor += 2 * 2 * rows;
    }
    if (kind === 'nucleic' && look.bases) {
      analytic += 3;
      floor += 3;
    }
  }
  return { triangles, analytic, floor: triangles + floor };
}

function drawnBondCount(drawn, bonds) {
  let count = 0;
  for (let edge = 0; edge < bonds.count; edge += 1) {
    if (!bondIsDrawn(bonds.flags[edge])) continue;
    if (drawn.has(bonds.a[edge]) && drawn.has(bonds.b[edge])) count += 1;
  }
  return count;
}

/*
  Mol*'s grid for one rung, sized as its `gaussian-density/cpu.js` and `molecular-surface.js` size
  it: the atoms' box (which bounds each atom's sphere, not its centre), padded by twice the largest
  radius plus a cell for the gaussian and the largest radius plus a cell for the solvent-excluded
  field, over the resolution -- first coarsened where Mol*'s `ensureReasonableResolution()` would.
  Within 3% of the grid Mol* built on every structure past a thousand atoms.
*/
const MOLSTAR_MAX_CELLS = 500000000;
function surfaceGrid(level, drawn) {
  let minX = Infinity; let minY = Infinity; let minZ = Infinity;
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
  let maxRadius = 0;
  let atoms = 0;
  for (const { atom } of drawn.values()) {
    atoms += 1;
    if (atom.x < minX) minX = atom.x;
    if (atom.y < minY) minY = atom.y;
    if (atom.z < minZ) minZ = atom.z;
    if (atom.x > maxX) maxX = atom.x;
    if (atom.y > maxY) maxY = atom.y;
    if (atom.z > maxZ) maxZ = atom.z;
    if (atom.vdwRadius > maxRadius) maxRadius = atom.vdwRadius;
  }
  if (!atoms) return { atoms, cells: 0, resolution: level.resolution, maxRadius };
  const extent = [maxX - minX, maxY - minY, maxZ - minZ].map((length) => length + 2 * maxRadius);
  const [first, second] = extent.map(Math.ceil).sort((a, b) => b - a);
  const maxAreaCells = Math.floor(Math.cbrt(MOLSTAR_MAX_CELLS) ** 2);
  let { resolution } = level;
  if (Math.ceil((first * second) / resolution ** 2) > maxAreaCells) {
    resolution = Math.sqrt((first * second) / maxAreaCells);
  }
  const pad = level.field === GAUSSIAN
    ? 2 * (maxRadius + level.radiusOffset) + resolution
    : maxRadius + resolution;
  let cells = 1;
  for (const length of extent) cells *= Math.ceil((length + 2 * pad) / resolution);
  return { atoms, cells, resolution, maxRadius };
}

function priced(family, primitives, floor, parts, extra = {}) {
  let ms = 0;
  let bytes = 0;
  for (const [cost, count] of parts) {
    ms += (cost.ms ?? 0) * count;
    bytes += (cost.bytes ?? 0) * count;
  }
  return { family, primitives, floor, ms, bytes, ...extra };
}

/**
 * One style's estimated cost: `primitives` expected and the `floor` under them (both 0 for a
 * surface, whose triangle count no cheap count predicts), `ms` of main-thread build and `bytes` of
 * allocation, and `cells` for a surface.
 *
 * `drawn` is `scene.js`'s `drawnAtoms()` map for the atom and surface families; `look` is the swept
 * look or the surface rung with the user's settings already over it.
 */
export function estimateStyle({ representation, look, residues, drawn, bonds, secondaryStructure }) {
  const family = representationFamily(representation);
  if (family === 'sweep') {
    const { triangles, analytic, floor } = sweepCounts(look, residues, secondaryStructure);
    return priced(family, triangles + analytic, floor,
      [[COST.sweepTriangle, triangles], [COST.sweepAnalytic, analytic]]);
  }
  if (family === 'surface') {
    const grid = surfaceGrid(look, drawn);
    // A gaussian is summed out to twice an atom's radius, a distance field to radius plus probe.
    const parts = look.field === GAUSSIAN
      ? [[COST.gaussianCell, grid.cells], [COST.gaussianStamp,
        grid.atoms * ((2 * (grid.maxRadius + look.radiusOffset)) / grid.resolution) ** 3]]
      : [[COST.sesCell, grid.cells], [COST.sesStamp,
        grid.atoms * ((grid.maxRadius + look.probeRadius) / grid.resolution) ** 3]];
    return priced(family, 0, 0, parts, { cells: grid.cells, resolution: grid.resolution });
  }
  if (family === 'marker') {
    const triangles = drawn.size * (markerFor(representation)?.faces.length ?? 0);
    return priced(family, triangles, triangles, [[COST.markerTriangle, triangles]]);
  }
  if (family === 'spheres') {
    return priced(family, drawn.size, drawn.size, [[COST.atomPrimitive, drawn.size]]);
  }
  // A stick joint is drawn only where a bond reaches, so only the bonds are certain.
  const bondCount = drawnBondCount(drawn, bonds);
  const primitives = drawn.size + bondCount;
  const floor = family === 'sticks' ? bondCount : primitives;
  return priced(family, primitives, floor, [[COST.atomPrimitive, primitives]]);
}

const millions = (count) => `${(count / 1e6).toFixed(1)} million`;

/**
 * The sentence refusing a style the tracer could not hold once built, or `null`. `before` is what
 * the scene has already built, counted exactly.
 */
export function budgetRefusal(estimate, before, representation) {
  if (!estimate || before + estimate.floor / ESTIMATE_OVERSHOOT <= PRIMITIVE_LIMIT) return null;
  const onTop = before > 0 ? ` with ${millions(before)} already built` : '';
  return `${representation}: not built, it needs about ${millions(estimate.primitives)} primitives`
    + ` here${onTop} and the tracer holds ${millions(PRIMITIVE_LIMIT)}`;
}

const HEAVY = 'a very large build here; the page may stop responding for minutes while it builds,'
  + ' and the browser may run out of memory';

/** The warnings a planned scene deserves before it is built, one sentence each. */
export function budgetWarnings(plans) {
  const sentences = [];
  let ms = 0;
  let bytes = 0;
  for (const { representation, estimate } of plans) {
    // Refused at build time, and said there.
    if (!estimate || estimate.floor / ESTIMATE_OVERSHOOT > PRIMITIVE_LIMIT) continue;
    ms += estimate.ms;
    bytes += estimate.bytes;
    if (estimate.primitives > PRIMITIVE_LIMIT) {
      sentences.push(
        `${representation}: about ${millions(estimate.primitives)} primitives here and the tracer`
        + ` holds ${millions(PRIMITIVE_LIMIT)}, so part of it may not be drawn`,
      );
    } else if (estimate.ms >= WARN_BUILD_MS || estimate.bytes >= WARN_BUILD_BYTES) {
      sentences.push(`${representation}: ${HEAVY}`);
    }
  }
  if (!sentences.length && (ms >= WARN_BUILD_MS || bytes >= WARN_BUILD_BYTES)) {
    sentences.push(`these styles together: ${HEAVY}`);
  }
  return sentences;
}
