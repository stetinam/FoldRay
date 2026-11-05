/*
  The molecular surface: Mol*'s scalar field, Mol*'s marching cubes, our ladder and our colours.

  Three things are load-bearing here and each has a section below: **which field a detail level
  uses**, **what the group buffer means**, and **that the normals are the raw field gradient**.

  What Mol* supplies and what we supply:

  | | |
  | --- | --- |
  | the gaussian density field | `computeStructureGaussianDensity` |
  | the solvent-excluded field | `computeStructureMolecularSurface` |
  | the isosurface | `computeMarchingCubesMesh` |
  | the vdW radius each atom contributes | `PhysicalSizeTheme`, which is `atom.vdw_radius` |
  | **which rung uses which field, and the numbers on it** | `SURFACE_LEVELS` -- ours, authored |
  | **which atoms are in the field at all** | ours: the subset the style owns |
  | **the colour at every vertex** | ours, through the group buffer |

  ---

  ## The ladder crosses fields partway up, and that is the whole design

  A finer grid on a gaussian field buys a **finer blob** -- the same merged shape, sampled more
  closely. What opens a cleft is a **smaller probe**: a surface a 1.4 A water rolls straight over
  stays rolled over at any resolution. So the four rungs are not one dial turned four times; levels
  1-2 are gaussian and levels 3-4 are solvent-excluded, and the crossing is the point.

  **A coarse grid is not breadth.** It makes a surface **faceted**, and at 768 px the facets are
  plainly visible: at `resolution` 1.4, level 1 renders flat polygonal patches across the
  silhouette. Breadth is the `radiusOffset` and nothing else, and cheapness is not a real
  constraint at the bottom of the ladder.

  **What the ladder costs** (a 15 W laptop, best of three, 3RGK's protein):

    level 1   23,864 tri    field  39 ms   march  28   colour  43
    level 2   57,628 tri    field  64 ms   march  66   colour  52
    level 3   89,260 tri    field 344 ms   march  93   colour 277
    level 4  188,756 tri    field 492 ms   march 260   colour 450

  So a finer grid is nearly free on a gaussian rung and is **not** free on a solvent-excluded one,
  where the field dominates and scales with the cell count. That is the constraint the numbers on
  levels 3 and 4 are weighed against, and it is why their grids are one step finer rather than two.


  Everything below this table is the same code for every level.

  ---

  ## The atoms in the field are the atoms the style owns, and that needs a sub-`Structure`

  A surface is not per atom, so it cannot be filtered after the fact the way a sphere can: the field
  has to be built over exactly the atoms this style draws, or a selection layer's surface would
  bulge with the atoms of the base style beside it. `Structure.subsetBuilder` is Mol*'s own way to
  say that, and it keeps the whole calculation inside the one `Structure` the rest of the tree reads
  -- one `Structure`, one answer. The radii come from `PhysicalSizeTheme`, which is
  `StructureProperties.atom.vdw_radius`, which is the number `structure.js` already put on every
  atom record and the number the traced sphere already uses.

  **It is a *structure*-level field and not a per-unit one.** `Structure.ofModel` splits by chain,
  so a per-unit surface is
  one blob per chain: 1BNA's duplex comes back as **two** connected components instead of one, and
  every interface in a multimer grows a seam down it. Measured -- the structure-level field on
  1BNA's 486 nucleic atoms is 1 connected component; the two units taken separately are 2. The cost
  of the correction is that the group space changes with it, which is the next section.

  ---

  ## The group buffer, and why this builder resolves it itself

  A Mol* `Mesh`'s `groupBuffer` means different things per builder, so
  there is no shared group-to-colour function and `scene.js`'s `appendMesh()` deliberately takes
  colours rather than groups.

  For a **structure**-level field the group is the **serial element index within that structure** --
  `getStructureConformationAndRadius` writes `getSerialIndex(unit, element)` -- not the atom index
  within a unit, which is what the unit-level call gives. So the
  resolution is `serialMapping.unitIndices` / `elementIndices` -> the parent unit's own element
  order -> our atom. `Structure.subsetBuilder` preserves the parent's unit ids, which is what makes
  that last hop possible at all.

  A vertex whose two cube corners were both empty gets group `-1` (`marching-cubes/algorithm.js`
  states the convention). It has never been observed on a real field here -- a vertex sits on the
  isosurface, so at least one corner is inside it -- but a colour is not the place to find out, so
  it falls back to the style's own first colour and is **counted**, and `scene.js` states the count.

  ---

  ## The normals are the raw field gradient and are not unit length

  `|n|` spans [0.021, 1.516] on the gaussian surfaces here and reaches **224** on the finest
  solvent-excluded one (588 was measured on another). `pathtrace.wgsl`
  barycentric-interpolates vertex normals and never renormalises the *inputs*, so they are
  normalised in place here. `Mesh.computeNormals()` would also give unit length and is **not** the
  fix: it substitutes area-weighted face averages, mean 25.8 degrees away from the gradient. The
  gradient normals are the better ones; they are only the wrong length.

  The gradient sign is already outward -- `algorithm.js` computes `f(i-1) - f(i+1)`, the *negative*
  gradient, and density decreases outward -- which is confirmed by the winding: the face normal
  agrees with the vertex normal on 98.8-100% of triangles across the four levels, and the mesh's
  signed volume is positive.
*/

import { Structure } from 'molstar/lib/mol-model/structure.js';
import { SortedArray } from 'molstar/lib/mol-data/int.js';
import { PhysicalSizeTheme } from 'molstar/lib/mol-theme/size/physical.js';
import {
  computeStructureGaussianDensity, DefaultGaussianDensityProps,
} from 'molstar/lib/mol-repr/structure/visual/util/gaussian.js';
import {
  computeStructureMolecularSurface,
} from 'molstar/lib/mol-repr/structure/visual/util/molecular-surface.js';
import {
  DefaultMolecularSurfaceCalculationProps,
} from 'molstar/lib/mol-math/geometry/molecular-surface.js';
import { computeMarchingCubesMesh } from 'molstar/lib/mol-geo/util/marching-cubes/algorithm.js';
import { Mesh } from 'molstar/lib/mol-geo/geometry/mesh/mesh.js';
import { SyncRuntimeContext } from 'molstar/lib/mol-task/execution/synchronous.js';

/*
  The ladder's own numbers live in `geom/surface-levels.js` and are re-exported here.

  They live there for page weight and nothing else: `selection-model.js` needs three of
  them to derive the surface panel, `main.js` imports that eagerly, and reaching them through this
  file dragged Mol\*'s whole WebGL renderer onto the first-paint path to read a table of numbers.
  That file carries the measurement.

  Re-exported rather than re-homed, because every existing importer -- `scene.js` and this file's
  own `propsFor()` -- asks this module for them and there is no reason to make them ask twice.
*/
export {
  GAUSSIAN, SOLVENT_EXCLUDED, SURFACE_LEVELS,
  levelFor, levelSettingControls, levelSettingDefaults, levelWithSettings,
} from './surface-levels.js';
// `propsFor()` below is the only local reader, and it wants the field discriminator alone.
import { GAUSSIAN } from './surface-levels.js';


/*
  The Mol* props for a rung, built from its own defaults rather than from a literal.

  Spreading `DefaultGaussianDensityProps` / `DefaultMolecularSurfaceCalculationProps` is what keeps
  the fields Mol* does not offer as a control -- `probePositions`, `ignoreHydrogensVariant` -- at
  whatever Mol* decides they should be, so an upgrade that adds one does not silently get `undefined`.

  **`ignoreHydrogens` stays false, which is Mol*'s default and a decision worth naming.** A hydrogen
  contributes its own vdW radius to the field, so a structure with hydrogens modelled gets a surface
  about 1 A further out than the same structure without them. That is the physically right answer
  and it is the one the sphere builder already gives; the alternative is a surface whose size
  depends on how the file was refined.
*/
function propsFor(level) {
  if (level.field === GAUSSIAN) {
    return {
      ...DefaultGaussianDensityProps,
      resolution: level.resolution,
      radiusOffset: level.radiusOffset,
      smoothness: level.smoothness ?? DefaultGaussianDensityProps.smoothness,
    };
  }
  return {
    ...DefaultMolecularSurfaceCalculationProps,
    probeRadius: level.probeRadius,
    resolution: level.resolution,
  };
}

/*
  The sub-`Structure` holding exactly the atoms this style draws.

  `isSorted` is **false** on purpose. The builder sorts each unit's element list when it is not told
  otherwise, and the cost is one sort per unit against a wrong answer if a caller ever hands over
  residues in anything but structure order -- which `buildScene()`'s filters happen to preserve
  today and which nothing makes them promise.
*/
function subsetOf(structure, drawn) {
  const builder = structure.subsetBuilder(false);
  for (const { atom } of drawn) {
    const unit = structure.unitMap.get(atom.unitId);
    if (!unit) continue;
    builder.addToUnit(atom.unitId, unit.elements[atom.elementIndex]);
  }
  return builder.getStructure();
}

/**
 * Serial index within the subset -> the `{ atom, residue }` the style handed in.
 *
 * Two hops, and the middle one is the reason this is a function rather than an index: the subset's
 * `elementIndices` are **model** element indices, while our atom records address the *parent unit's*
 * own element order. `SortedArray.indexOf` is the bridge, and it is exact rather than a search over
 * our own list.
 */
function serialToDrawn(structure, subset, drawn) {
  const byAddress = new Map();
  for (const entry of drawn) {
    byAddress.set(`${entry.atom.unitId}:${entry.atom.elementIndex}`, entry);
  }
  const mapping = subset.serialMapping;
  const table = new Array(subset.elementCount);
  for (let serial = 0; serial < subset.elementCount; serial += 1) {
    const unit = subset.units[mapping.unitIndices[serial]];
    const parent = structure.unitMap.get(unit.id);
    const within = parent ? SortedArray.indexOf(parent.elements, mapping.elementIndices[serial]) : -1;
    table[serial] = within >= 0 ? byAddress.get(`${unit.id}:${within}`) : undefined;
  }
  return table;
}

/**
 * One surface, as the same `{ positions, normals, colors, indices }` the sweep produces.
 *
 * `atoms` is the flat list this style draws, each carrying the `{ atom, residue }` pair the colour
 * function wants -- the same shape `buildAtomStyle()` puts in its `drawn` map, and for the same
 * reason: a colour is a question about a residue that happens to be asked at an atom.
 *
 * `stats` is the builder's **own** numbers and is what a claim about surface cost has to quote: the
 * field milliseconds, the marching-cubes milliseconds and the triangle count. A shot's scene total
 * folds in whatever else is on the page and cannot answer this.
 *
 * `colorSharpness` is how hard the blend commits to one atom and defaults to the authored number
 * below. **It is a parameter rather than a constant read in place because the attribution and the
 * colour are two questions**, and the first is asked through this channel: colour every vertex with
 * its own atom's index and read the index back out, which a blend of atoms 41 and 43 would answer
 * with atom 42. `Infinity` is that question's value -- infinitely sharp *is* the argmax, so it is
 * the flat attribution rather than a special case bolted beside it -- and the product never passes
 * one.

 */
export async function buildSurface({
  structure, drawn, look, colorOf, fallbackColor = [1, 1, 1],
  colorSharpness = COLOR_SHARPNESS,
  colorMixtureFirmness = COLOR_MIXTURE_FIRMNESS,
}) {
  const empty = {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    colors: new Float32Array(0),
    indices: new Uint32Array(0),
  };
  if (!drawn.length) {
    return { ...empty, ungrouped: 0, stats: null };
  }

  const subset = subsetOf(structure, drawn);
  if (subset === Structure.Empty || subset.elementCount === 0) {
    return { ...empty, ungrouped: 0, stats: null };
  }

  // `scale: 1` -- the vdW radius itself, which is what `structure.js` reads onto every atom record
  // and what the sphere builder scales its own factor off. One radius table, one answer.
  const sizeTheme = PhysicalSizeTheme({ structure: subset }, { scale: 1 });
  const props = propsFor(look);

  const fieldStarted = now();
  const density = look.field === GAUSSIAN
    ? await computeStructureGaussianDensity(subset, sizeTheme, props).runInContext(SyncRuntimeContext)
    : await computeStructureMolecularSurface(subset, sizeTheme, props).runInContext(SyncRuntimeContext);
  const fieldMs = now() - fieldStarted;

  /*
    The two fields put their isosurface in different places and this is the whole of the difference.
    The gaussian field is a density: its level is `exp(-smoothness)`
    over the radius factor, which is 1 on the CPU path. The solvent-excluded field is a distance and
    its level is the probe radius itself.
  */
  const isoLevel = look.field === GAUSSIAN
    ? Math.exp(-props.smoothness) / density.radiusFactor
    : props.probeRadius;

  const marchStarted = now();
  const mesh = await computeMarchingCubesMesh({
    isoLevel, scalarField: density.field, idField: density.idField,
  }).runInContext(SyncRuntimeContext);
  const marchMs = now() - marchStarted;
  // Translation and uniform scaling, so `Mesh.transform` leaves the normals alone -- correctly, a
  // uniform scale does not turn a direction. They are still the wrong length; see below.
  Mesh.transform(mesh, density.transform);

  const vertexCount = mesh.vertexCount;
  const positions = mesh.vertexBuffer.ref.value.subarray(0, vertexCount * 3).slice();
  const normals = mesh.normalBuffer.ref.value.subarray(0, vertexCount * 3).slice();
  const groups = mesh.groupBuffer.ref.value;
  const indices = mesh.indexBuffer.ref.value.subarray(0, mesh.triangleCount * 3).slice();

  // Normalise in place. A zero-length gradient cannot be pointed anywhere sensible, so it keeps the
  // zero and the tracer's own facing test decides -- there is nothing better to substitute and
  // inventing an up vector would light one triangle out of a hundred thousand differently.
  for (let index = 0; index < vertexCount; index += 1) {
    const x = normals[index * 3];
    const y = normals[index * 3 + 1];
    const z = normals[index * 3 + 2];
    const length = Math.hypot(x, y, z);
    if (!(length > 1e-12)) continue;
    normals[index * 3] = x / length;
    normals[index * 3 + 1] = y / length;
    normals[index * 3 + 2] = z / length;
  }

  /*
    One colour lookup per group rather than per vertex: a surface has tens of thousands of vertices
    over a few thousand atoms, and `colorOf` walks a gradient or a categorical table on every call.

    `ungrouped` counts **vertices**, not groups, because that is what a reader of the note sees
    -- a patch of the wrong colour is as large as the vertices carrying it.
  */
  const colorStarted = now();
  const table = serialToDrawn(structure, subset, drawn);
  const cache = new Map();
  const unattributed = new Set();
  let ungrouped = 0;
  const dominant = new Array(vertexCount);
  for (let index = 0; index < vertexCount; index += 1) {
    const group = groups[index];
    let colour = cache.get(group);
    if (colour === undefined) {
      const entry = group >= 0 ? table[group] : undefined;
      if (entry) {
        colour = colorOf(entry.residue, entry.atom);
      } else {
        colour = fallbackColor;
        unattributed.add(group);
      }
      cache.set(group, colour);
    }
    if (unattributed.has(group)) ungrouped += 1;
    dominant[index] = colour;
  }

  /*
    The atoms the blend weighs, with the radius this rung draws them at: the van der Waals radius
    plus whatever standoff puts the isosurface where it is -- `radiusOffset` on a gaussian rung and
    `probeRadius` on a solvent-excluded one. Both are "how far past the atom this surface sits", so
    the weights cross where the surface is actually between two atoms rather than where their bare
    radii would have crossed.
  */
  const standoff = look.field === GAUSSIAN ? (look.radiusOffset ?? 0) : (look.probeRadius ?? 0);
  const weighed = drawn.map(({ atom, residue }) => ({
    x: atom.x,
    y: atom.y,
    z: atom.z,
    radius: atom.vdwRadius + standoff,
    color: colorOf(residue, atom),
  }));
  const colors = blendColors({
    positions,
    vertexCount,
    dominant,
    atoms: weighed,
    sharpness: colorSharpness,
    firmness: colorMixtureFirmness,
  });
  const colorMs = now() - colorStarted;

  return {
    positions,
    normals,
    colors,
    indices,
    ungrouped,
    stats: {
      field: look.field,
      atoms: subset.elementCount,
      // What Mol* actually used, not what was asked for: `ensureReasonableResolution` coarsens the
      // grid on a structure large enough to blow the cell budget, and a stat that reported the
      // request would describe a surface nobody rendered.
      resolution: density.resolution,
      grid: Array.from(density.field.space.dimensions),
      fieldMs,
      marchMs,
      colorMs,
      vertices: vertexCount,
      triangles: mesh.triangleCount,
    },
  };
}

/*
  ------------------------------------------------------------------------------------------------
  The colour boundary is the grid's until the attribution is read as a weight.
  ------------------------------------------------------------------------------------------------

  Mol* writes one atom id per grid point -- the **argmax** of the atoms' density contributions
  there (`gaussian-density/cpu.js`: `if (dens > densData[idx]) idData[idx] = id`) -- and a
  marching-cubes vertex takes the id of one of its two cube corners. So a vertex's colour by id is a
  winner-takes-all decision made on a grid, and the boundary between two atoms' colours runs along
  **cube edges**: an axis-aligned staircase one cell high at full contrast. Under `uniform` there is
  no boundary and nothing to see; under `element` it is the first thing anybody sees, and it reads
  as the surface being jagged when the surface is not -- the unbroken regions shade perfectly
  smoothly, because the normals are the field gradient and owe nothing to the grid.

  **What the argmax throws away is by how much it won**, and that is what the blend keeps. The same
  gaussian, read as a weight rather than as a vote, answers "which atoms is this vertex between"
  continuously: deep in one atom's territory it is one atom's colour, and where two compete it is a
  ramp whose width is set by how fast the weights cross. There is no grid anywhere in it, so there
  is no staircase to remove afterwards.

  `p = exp(-SHARPNESS * (d^2/r^2 - m))`, where `r` is the atom's van der Waals radius plus the
  standoff this rung draws at and `m` is the smallest `d^2/r^2` in reach -- subtracting the minimum
  is what keeps the top atom at exactly 1 and the exponentials off the floor, and it cancels out of
  the normalised blend. `SHARPNESS` is dimensionless (`d^2/r^2` is), which is what lets **one**
  number serve the whole ladder: it is a statement about how far two atoms have to be apart before
  the colour commits, in units of their own radii, and it knows nothing about the grid, the rung or
  the structure's size.

  **Measured against the umbrella-Laplacian diffusion over the mesh that it replaces**, on 3RGK
  under `element`, as the mean colour change per angstrom across mesh edges (lower is a smoother
  transition) against the mean distance of a vertex colour from the field's own mean (higher is less
  washed out). Three diffusion steps gave 0.387/A at 0.448 of saturation; twelve
  steps gave 0.249 at 0.345. **A diffusion buys smoothness with saturation and there is no setting
  of it that does not**: it is a low-pass filter over the flat attribution, and a small element
  patch is exactly the frequency it eats, so the picture goes pastel before the boundaries go soft.
  The blend at the sharpness below gives 0.196/A at 0.486, and **0.207/A at 0.515 as it ships**,
  with `COLOR_MIXTURE_FIRMNESS` on top -- smoother than twelve diffusion steps and carrying more
  colour than three. Both axes at once, which is what makes this a fix rather than a trade. Every
  number in this comment is the **sharpness axis alone**, at firmness 0; the firmness constant
  carries its own.

  It is not a second `smoothness` -- that one decides where the *surface* is, this one decides where
  the *colour* commits, and they are independent.

  4 was read off a sweep of the constant and then off the render.
  The shape of that sweep is worth knowing before anybody retunes it: the gradient falls off a cliff
  between `Infinity` and 32 -- 0.480 to 0.222 -- and then barely moves, because the staircase is a
  **grid** artefact and there is no grid in this at all; what is left at 32 is the molecule's own
  colour variation. So *any* blending removes the defect, and the number is choosing how wide the
  ramp is, not whether there is one. Below 4 the gradient improves slowly while the saturation falls
  quickly and the reach grows, so the cost climbs for a picture that is going pastel: 2 is 0.152 at
  0.386, which is less colour than the diffusion had. 8 is the other side -- 0.215 at 0.541, crisper
  than what shipped rather than softer, which is not what was asked for.
*/
const COLOR_SHARPNESS = 4;

/*
  How firmly a vertex commits to the atom nearest it, on top of the weights. 0 is the plain
  weighted mean.

  **A wide transition and saturated colours pull against each other, and this is the one lever that
  does not simply trade them.** Softening the sharpness widens the ramp in space, which is what
  makes it smooth; it also makes every vertex a mixture of more atoms, and on a protein most of
  those are carbon, so the whole surface drifts toward the carbon colour and the elements go pastel.
  Measured on 3RGK under `element`: the flat attribution carries 0.592 of saturation and the blend
  at sharpness 4 carries 0.486.

  **Compensating the chroma length does not reach it, and the reason is worth recording.**
  Restoring the *length* of the blended chroma toward the weighted mean of the inputs' own is the
  right fix for two saturated colours of different hue cancelling into a greyer one. That
  cancellation is real and it is not what happens here: mixing a colour with a near-grey scales its
  chroma vector down without turning it, so the mean of the lengths and the length of the mean are
  the same number and there is nothing to give back. Measured, it moves 0.486 to 0.491.

  What is left is the *shape of the mixture*, and it can be changed without narrowing the ramp: the
  normalised weights go through a `smoothstep`, `q^2(3 - 2q)`, and are renormalised. It is a curve
  with **zero slope at both ends and none in the middle** -- a vertex that is 85/15 becomes 94/6 and
  reads as its own element, a vertex that is 50/50 is left exactly where it is, and the transition
  still occupies every angstrom it did. So the ramp keeps its soft shoulders, which is what the eye
  reads as smooth, and spends less of its width near grey.

  0.7 restores **0.486 to 0.515** of saturation against the flat attribution's 0.592, for 0.196 ->
  0.207/A of gradient -- still smoother than the blend is at sharpness 8 with no firming at all
  (0.215/A), which is the comparison that makes this worth having rather than just raising the
  sharpness. 1.0 goes to 0.530 at 0.212/A, which is sharpness 8's picture arrived at the long way;
  0.7 is where the ramp is still visibly softer than that and the elements have most of their
  colour back.

  It cannot overshoot: smoothstep maps [0,1] onto [0,1] and the weights are renormalised after, so
  a blended colour is always inside the convex hull of the atoms it is between and no colour is
  invented.

*/
const COLOR_MIXTURE_FIRMNESS = 0.7;


/*
  Where the atoms are, as a flat uniform grid rather than a tree.

  One cell of `reach` a side, so a vertex's candidates are the 27 cells around it. A tree would be
  the reflex and would be the wrong shape: the atoms of one style are a few thousand points at
  roughly uniform density inside their own bounding box, which is the case a uniform grid is for.
*/
function atomGrid(atoms, reach) {
  let minX = Infinity; let minY = Infinity; let minZ = Infinity;
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
  for (const atom of atoms) {
    if (atom.x < minX) minX = atom.x;
    if (atom.y < minY) minY = atom.y;
    if (atom.z < minZ) minZ = atom.z;
    if (atom.x > maxX) maxX = atom.x;
    if (atom.y > maxY) maxY = atom.y;
    if (atom.z > maxZ) maxZ = atom.z;
  }
  const nx = Math.max(1, Math.ceil((maxX - minX) / reach) + 1);
  const ny = Math.max(1, Math.ceil((maxY - minY) / reach) + 1);
  const nz = Math.max(1, Math.ceil((maxZ - minZ) / reach) + 1);
  const cellOf = (x, y, z) => {
    const ix = Math.min(nx - 1, Math.max(0, Math.floor((x - minX) / reach)));
    const iy = Math.min(ny - 1, Math.max(0, Math.floor((y - minY) / reach)));
    const iz = Math.min(nz - 1, Math.max(0, Math.floor((z - minZ) / reach)));
    return (ix * ny + iy) * nz + iz;
  };
  const offsets = new Uint32Array(nx * ny * nz + 1);
  for (const atom of atoms) offsets[cellOf(atom.x, atom.y, atom.z) + 1] += 1;
  for (let cell = 0; cell < nx * ny * nz; cell += 1) offsets[cell + 1] += offsets[cell];
  const list = new Uint32Array(atoms.length);
  const at = offsets.slice(0, nx * ny * nz);
  for (let index = 0; index < atoms.length; index += 1) {
    const cell = cellOf(atoms[index].x, atoms[index].y, atoms[index].z);
    list[at[cell]] = index;
    at[cell] += 1;
  }
  return { offsets, list, nx, ny, nz, minX, minY, minZ };
}

/**
 * The vertex colours, blended over the atoms each vertex is actually between.
 *
 * `dominant` is the group buffer's own answer per vertex -- Mol*'s argmax, resolved through
 * `serialToDrawn` -- and it is the reference the blend is written against. It **cancels**
 * algebraically (`ref + sum(p * (c - ref)) / sum(p)` is `sum(p * c) / sum(p)`), so it steers
 * nothing; what it buys is the exact zero below, and it keeps Mol*'s group
 * mapping the single statement of which atom a vertex belongs to.
 *
 * **The blend is written on `c - reference` and not on `sum / weight`**, the same rule
 * `interpolateColors()` keeps one builder over. Every difference is an exact zero when a vertex's
 * whole neighbourhood is one colour, so the sum is an exact zero and the vertex keeps the authored
 * float -- which is what makes every surface under `uniform`, `chain` and `entity` **bit-identical**
 * to the flat attribution. `sum / weight` is only approximately the colour it is an average of, and
 * would have moved every recorded surface hash by a rounding error nobody could attribute.
 *
 * A vertex with no atom in reach keeps the dominant colour; there is nothing to blend it with.
 */
function blendColors({ positions, vertexCount, dominant, atoms, sharpness, firmness }) {
  const colors = new Float32Array(vertexCount * 3);
  const write = (index, colour) => {
    colors[index * 3] = colour[0];
    colors[index * 3 + 1] = colour[1];
    colors[index * 3 + 2] = colour[2];
  };
  if (!(sharpness > 0) || !Number.isFinite(sharpness) || atoms.length === 0) {
    for (let index = 0; index < vertexCount; index += 1) write(index, dominant[index]);
    return colors;
  }

  /*
    The cutoff, derived rather than authored, and it is what the cost is most sensitive to.

    An atom's weight relative to the winner is `exp(-sharpness * (x - m))`, where `x = d^2/r^2`. Past
    `CUTOFF` of that exponent the term is under 1e-6 against weights that sum to at least 1, which is
    an order of magnitude below the last bit of a float32 colour -- it cannot move the answer, and
    the exactness the paragraph above claims does not depend on it either way, because equal colours
    difference to zero however many of them are summed. So the reach is `r * sqrt(1 + CUTOFF /
    sharpness)`: at the shipped sharpness that is about 2.1 radii, and **the candidate count goes as
    its cube**. Sizing it for float32 exactness instead (an exponent of 30) reaches 2.9 radii and
    costs 2.6x the atoms for a difference no pixel can carry.
  */
  const CUTOFF = 14;
  let widest = 0;
  for (const atom of atoms) if (atom.radius > widest) widest = atom.radius;
  const reach = widest * Math.sqrt(1 + CUTOFF / sharpness);
  const { offsets, list, nx, ny, nz, minX, minY, minZ } = atomGrid(atoms, reach);

  // Flat and hoisted: the inner loop runs a few hundred million times on a large structure and
  // reading `atoms[i].x` through a record there is what makes it slow.
  const count = atoms.length;
  const ax = new Float64Array(count);
  const ay = new Float64Array(count);
  const az = new Float64Array(count);
  const scale = new Float64Array(count);
  const red = new Float64Array(count);
  const green = new Float64Array(count);
  const blue = new Float64Array(count);
  for (let index = 0; index < count; index += 1) {
    const atom = atoms[index];
    ax[index] = atom.x;
    ay[index] = atom.y;
    az[index] = atom.z;
    scale[index] = 1 / (atom.radius * atom.radius);
    red[index] = atom.color[0];
    green[index] = atom.color[1];
    blue[index] = atom.color[2];
  }
  // The candidates of one vertex, gathered once and measured twice: the 27 cells are walked for the
  // winner and then the *gathered* list for the sum, rather than the cells twice.
  let nearIndex = new Uint32Array(256);
  let nearSquared = new Float64Array(256);

  for (let index = 0; index < vertexCount; index += 1) {
    const px = positions[index * 3];
    const py = positions[index * 3 + 1];
    const pz = positions[index * 3 + 2];
    const ix = Math.min(nx - 1, Math.max(0, Math.floor((px - minX) / reach)));
    const iy = Math.min(ny - 1, Math.max(0, Math.floor((py - minY) / reach)));
    const iz = Math.min(nz - 1, Math.max(0, Math.floor((pz - minZ) / reach)));

    let found = 0;
    let closest = Infinity;
    for (let dx = -1; dx <= 1; dx += 1) {
      const gx = ix + dx;
      if (gx < 0 || gx >= nx) continue;
      for (let dy = -1; dy <= 1; dy += 1) {
        const gy = iy + dy;
        if (gy < 0 || gy >= ny) continue;
        const row = (gx * ny + gy) * nz;
        for (let dz = -1; dz <= 1; dz += 1) {
          const gz = iz + dz;
          if (gz < 0 || gz >= nz) continue;
          const cell = row + gz;
          for (let slot = offsets[cell]; slot < offsets[cell + 1]; slot += 1) {
            const atom = list[slot];
            const squared = ((px - ax[atom]) ** 2 + (py - ay[atom]) ** 2 + (pz - az[atom]) ** 2)
              * scale[atom];
            if (squared < closest) closest = squared;
            if (found === nearIndex.length) {
              const grownIndex = new Uint32Array(found * 2);
              const grownSquared = new Float64Array(found * 2);
              grownIndex.set(nearIndex);
              grownSquared.set(nearSquared);
              nearIndex = grownIndex;
              nearSquared = grownSquared;
            }
            nearIndex[found] = atom;
            nearSquared[found] = squared;
            found += 1;
          }
        }
      }
    }

    const reference = dominant[index];
    if (found === 0) {
      write(index, reference);
      continue;
    }
    const limit = closest + CUTOFF / sharpness;
    let weight = 0;
    for (let slot = 0; slot < found; slot += 1) {
      const squared = nearSquared[slot];
      // Most of the 27 cells' atoms are too far to contribute anything, and skipping the `exp` on
      // them rather than adding a term that rounds to nothing is most of what this function costs.
      if (squared > limit) continue;
      weight += Math.exp(-sharpness * (squared - closest));
    }

    let firm = 0;
    let toRed = 0;
    let toGreen = 0;
    let toBlue = 0;
    for (let slot = 0; slot < found; slot += 1) {
      const squared = nearSquared[slot];
      if (squared > limit) continue;
      const atom = nearIndex[slot];
      const share = Math.exp(-sharpness * (squared - closest)) / weight;
      // The firming curve, mixed in rather than applied outright, so the constant is a dial and 0
      // is exactly the plain weighted mean.
      const curved = share + firmness * (share * share * (3 - 2 * share) - share);
      firm += curved;
      toRed += curved * (red[atom] - reference[0]);
      toGreen += curved * (green[atom] - reference[1]);
      toBlue += curved * (blue[atom] - reference[2]);
    }
    /*
      Written on `c - reference` and renormalised by the curved weights' own sum. Every difference
      is an exact zero when the whole neighbourhood already agrees, so the sums are exact zeros and
      the vertex keeps the authored float whatever the weights did -- which is what keeps a uniform
      surface bit-identical to the flat attribution, and it holds for any weighting because it never
      depended on the weights at all.
    */
    colors[index * 3] = reference[0] + toRed / firm;
    colors[index * 3 + 1] = reference[1] + toGreen / firm;
    colors[index * 3 + 2] = reference[2] + toBlue / firm;
  }
  return colors;
}

/** Available on `window`, in a Worker and in node, so this needs no host check. */
function now() {
  return performance.now();
}
