/*
  The polymer sweep: Mol*'s trace, our cross-section, triangles.

  **One sweep and one profile function** build every cartoon, ribbon and nucleic look. A new look is
  three numbers in `profiles-catalog.js`, not a new builder, and a second sweep is never the answer.

  What Mol* supplies and what we supply:

  | | |
  | --- | --- |
  | the spine, per residue | `PolymerTraceIterator` + `interpolateCurveSegment` |
  | the frame the cross-section stands in | `normalVectors` / `binormalVectors` |
  | the taper between one residue's size and its neighbours' | `interpolateSizes` |
  | the secondary-structure kind | `v.secStrucType`, read straight off the iterator |
  | **the cross-section** | `profile.js` -- ours |
  | **the numbers in it** | `profiles-catalog.js` -- ours, authored |
  | **the beta arrow** | `arrow.js` -- ours, because Mol* does not put it in either size array |
  | **the surface normals** | ours: `cross(ring tangent, spine tangent)`, so a taper shades right |
  | **the edge rails** | ours: analytic tubes on the panel's own edge, closed across the short ends |

  **The secondary structure here is the one `secondary-structure.js` computed, mechanically rather
  than by agreement.** `PolymerTraceIterator` reads
  `SecondaryStructureProvider.get(structure).value.get(unit.invariantId)` -- the same attachment,
  made once with pinned params, on the same `Structure` object. So `v.secStrucType` and our own
  per-residue lookup cannot disagree, and this file reads `v.secStrucType` rather than keying the
  lookup by residue. One `Structure`, one answer to which residues are helical.

  ---

  ## The five traps

  Every one is measured, and every one renders a
  plausible picture rather than an error.

  1. **The size arrays are a second call.** `interpolateCurveSegment` fills *four* arrays -- points,
     tangents, normals, binormals -- and leaves `widthValues` and `heightValues` at zero.
     `interpolateSizes` is what fills them, and its six numbers are ours to supply.
  2. **The names are inverted.** Measured off real `addSheet` output: the extent along
     `normalVectors` is `2 x heightValues` and along `binormalVectors` is `2 x widthValues` --
     3.397 A against 0.680 A on a mid-strand residue. So Mol*'s *height* is the ribbon's **width**
     and its *width* is the ribbon's **thickness**. `THE CROSS` below is the one place this is
     written down; wire it the way the names read and every cartoon renders standing on its edge.
  3. **The frame is not orthonormal.** `n . b` is exact, but `t . n` reaches 7.5 degrees and the
     normal shrinks to 0.88 in length, because `interpolateNormals` box-smooths the normals in a
     final pass and only re-derives the binormal. Mol*'s own sheet therefore builds up to 12%
     narrower than its sizes ask for. `crossSectionAxes()` normalises.
  4. **A terminal residue does not sweep `0..linearSegments`.** `v.initial` and `v.final` halve the
     sample count and push the end control point out along the tangent; `v.initial` also shifts the
     three vector arrays. A residue that is both gets a bead instead of a tube.
  5. **The nucleic path negates `state.binormalVectors` in place.** Mol* swaps the two axes for a
     nucleotide *and* negates one of them, so a sweep that reuses one `CurveSegmentState` across
     residues inherits the negation and every protein residue after the first nucleic one is built
     on a flipped frame. **This file never writes to the state**: `crossSectionAxes()` applies the
     swap and the sign at read time, into its own two vectors. The negation is not decoration --
     `(-binormal, normal, tangent)` is right-handed exactly as `(normal, binormal, tangent)` is, so
     dropping it would build every nucleotide inside out.

  ---

  ## The rails

  `profiles-catalog.js` explains what a rail is and why it is not a fourth cross-section axis. What
  this file does with one:

  * The rail's centre line is the panel's **own outer edge** -- `spine +/- axisU x (breadth + radius)`
    at zero thickness -- so it is read off the same row the ring is placed on and inherits the
    taper, the arrow ramp and the frame for free. Nothing re-derives a curve.
  * **It carries its own sampling rate**, and `rails.js` is where and why. Eight samples a residue
    is 12.85 degrees of turn per step on an alpha helix; the panel shades that smooth through
    interpolated vertex normals and a rail, being analytic, cannot. So this file hands `rails.js`
    the rows and that file subdivides between them.
  * **The rim closes across the short ends**, and where it closes is *not* where `emitCap()` caps.
    A rim is a bar laid across the panel, so it belongs only where the panel has actually ended: a
    chain terminus, a residue nobody drew, an arrowhead's point. Not at a secondary-structure
    boundary, where the sizes interpolate across and the cap is invisible; and not at an arrowhead's
    shoulder, where the panel has got wider rather than ended. `sweepResidue()` carries both halves.
  * `rail` **tapers by the same shifted lerp** `r` does, so a helix's rails fade out into a loop that
    has none rather than stopping dead at the secondary-structure boundary -- except across an
    arrowhead, which holds its own cord to the point the way `arrow.js` holds everything but the
    breadth.
  * **The runs are per unit and are flushed with it.** A rail is a continuous stretch of edge from
    one cap to the next, which is longer than a residue, so it cannot be emitted from inside one --
    the frame flips sign between residues and consecutive residues share their boundary row, and
    both are only visible from the run. `rails.js` has the two.

  A look that names no `rail` on any of its three kinds emits nothing here and costs one `Math.max`.

  ---

  ## The four knobs this file reads off the look

  `profiles-catalog.js` argues for each of them beside the look that wanted it. What they do *here*,
  and the one thing about each that is not obvious:

  | | |
  | --- | --- |
  | `linearSegments` | rows per residue, through `segmentsFor()`. It sizes the `CurveSegmentState`, so it is read once per sweep and never per residue |
  | `faceStep` | overrides `FACE_STEP` when the ring is built. `0` leaves a straight face as the one segment it was |
  | `sides` | reaches `profileRing()` and nothing else. The polygon is a cross-section, not a builder |
  | `panel` | `false` skips the ring placement and all three mesh emits. **The rails still run**, off the same rows, so a cords look and a panelled one agree about where every cord is to the bit |

  **None of them changes what a residue *is*** -- that is `helixRod`, and it is the one knob that
  takes a kind out of the sweep altogether. These four change how the same swept residue is cut into
  triangles, or whether it is cut into triangles at all.
*/

import { Unit } from 'molstar/lib/mol-model/structure.js';
import { isNucleic, SecondaryStructureType } from 'molstar/lib/mol-model/structure/model/types.js';
import {
  PolymerTraceIterator,
} from 'molstar/lib/mol-repr/structure/visual/util/polymer/trace-iterator.js';
import {
  createCurveSegmentState, interpolateCurveSegment, interpolateSizes,
} from 'molstar/lib/mol-repr/structure/visual/util/polymer/curve-segment.js';
// The five constants live only at this path. It is a barrel, and the trouble with barrels is the
// ones that reach `mol-gl`;
// this one reaches `mol-model`, `mol-data` and two `mol-geo` leaves, and no rendering machinery.
import {
  StandardTension, HelixTension, StandardShift, NucleicShift, OverhangFactor,
} from 'molstar/lib/mol-repr/structure/visual/util/polymer.js';
import {
  HelixOrientationProvider,
} from 'molstar/lib/mol-model-props/computed/helix-orientation.js';
import { AssetManager } from 'molstar/lib/mol-util/assets.js';
import { SyncRuntimeContext } from 'molstar/lib/mol-task/execution/synchronous.js';

import { profileRing, profilePoint, ringSampleCount } from './profile.js';
import { createRails, addRails, closeRun, emitRails, RAIL_EPSILON } from './rails.js';
import { createRods, addRod, closeRod, emitRods, isRodResidue } from './rods.js';
import { applyOperator } from './operator.js';
import { createBases, addBase, emitBases, basesShape } from './bases.js';
import { profileFor, DEFAULT_TWIST } from './profiles-catalog.js';
import { arrowHalfWidth, isArrowResidue } from './arrow.js';
import { spreadTwist } from './frame.js';
import { FloatList, IndexList } from './buffers.js';

/**
 * Samples along the spine per residue.
 *
 * Eight is measured at 0.029 A of the underlying curve, which is far below anything a picture
 * shows, and triangle count is linear in it. It is Mol*'s own default too, so the spline is sampled
 * where Mol* samples it.
 */
export const LINEAR_SEGMENTS = 8;

/**
 * A look may sample its spine coarser or finer, and `LINEAR_SEGMENTS` is what it does when it does
 * not say.
 *
 * **This is the one tessellation number that is also art direction**, and it is worth saying why it
 * is not a contradiction of the note above. Eight is where the curve stops moving -- 0.029 A of the
 * underlying spline -- so no look wants *more*, and a look that asks for fewer is not accepting an
 * approximation of a smooth ribbon. It is asking for a different shape: `cartoon_lowpoly` is read
 * by its facets, and a facet is a statement about the residue rather than a step along a curve.
 *
 * Everything downstream already reads the count off the state rather than off the constant, so the
 * only thing that changes with it is how many rows a residue emits. Mol*'s
 * terminal-residue halving is a fraction of it and stays a fraction of it.
 */
export function segmentsFor(look) {
  return Math.max(1, Math.round(look.linearSegments ?? LINEAR_SEGMENTS));
}

/**
 * The longest a cross-section's **straight face** may run without an interior sample, in Angstroms.
 *
 * The other half of the grid, and it belongs here beside `LINEAR_SEGMENTS` rather than in the
 * catalogue: it is a tessellation number and not art direction, it changes no shape, and no look
 * has an opinion about it. `profile.js` carries the reasoning -- a quad's departure from the ruled
 * surface it approximates goes as the *product* of the two steps, so a 4.2 A face against a 0.2 A
 * spine step is the one place on the mesh where that product is large, and it lays a shadow comb
 * down every ribbon.
 *
 * 0.7 A is a little over the spine step a strand sweeps at (3.3 A per residue over eight) and about
 * three times a helix's. It cuts a cartoon's widest face into six and its narrow sides into none at
 * all. It adds nothing to a circle (`ribbon`, `ribbon_slender`, `nucleic_ribbon`, `nucleic_rings`)
 * and cuts every flat face, `ribbon_tape` and the nucleic tapes included (20 -> 28 or 30 samples).
 * Measured, going finer buys progressively less.
 */
export const FACE_STEP = 0.7;

/*
  The custom-property context, the same one `secondary-structure.js` uses: a synchronous runtime and
  an asset manager that never fetches. Only `cartoon_geometric` needs it.
*/
const propertyContext = { runtime: SyncRuntimeContext, assetManager: new AssetManager() };

/** Which of the catalogue's four kinds a trace element is. */
export function traceKind(element) {
  if (isNucleic(element.moleculeType)) return 'nucleic';
  if (SecondaryStructureType.is(element.secStrucType, SecondaryStructureType.Flag.Helix)) return 'helix';
  if (SecondaryStructureType.is(element.secStrucType, SecondaryStructureType.Flag.Beta)) return 'sheet';
  return 'loop';
}

/**
 * The two cross-section axes at one sample, unit length and in the right order.
 *
 * `outU` is the axis the broad half-width lies along and `outV` the axis the half-thickness lies
 * along. Traps 3 and 5 are both here and nowhere else:
 *
 * - **Normalised**, because Mol*'s normal is box-smoothed and not re-normalised, so it runs as
 *   short as 0.88 and a ribbon built on it is up to 12% narrow.
 * - **Swapped and negated for a nucleotide**, at read time, into the caller's own vectors -- the
 *   `CurveSegmentState` is never written to, so no residue can inherit another's sign.
 *
 * `(U, V)` is right-handed against the tangent in both cases: `normal x binormal` is the tangent,
 * and so is `(-binormal) x normal`. That is what the negation is for, and dropping it turns every
 * nucleotide inside out rather than merely mirroring it.
 */
export function crossSectionAxes(nucleic, normals, binormals, index, outU, outV) {
  const base = index * 3;
  const [source, target, sign] = nucleic
    ? [binormals, normals, -1]
    : [normals, binormals, 1];
  normalizeInto(outU, source[base] * sign, source[base + 1] * sign, source[base + 2] * sign);
  normalizeInto(outV, target[base], target[base + 1], target[base + 2]);
  return { u: outU, v: outV };
}

/**
 * The edge radius, tapered by the same rule `interpolateSizes` tapers the other two by.
 *
 * Mol* has two size arrays because it has two axes; the Minkowski profile has a third number and
 * Mol* has no opinion about it. Interpolating it any other way would step the corner radius at
 * every secondary-structure boundary while the width and thickness ran smoothly through it, so
 * this is deliberately the *same* two-segment shifted lerp rather than a similar one, re-derived
 * against `interpolateSizes` to keep it that way.
 */
export function interpolateRadii(out, r0, r1, r2, shift, linearSegments = LINEAR_SEGMENTS) {
  const shift1 = 1 - shift;
  for (let index = 0; index <= linearSegments; index += 1) {
    const t = index / linearSegments;
    out[index] = t < shift1 ? lerp(r0, r1, t + shift) : lerp(r1, r2, t - shift1);
  }
  return out;
}

/**
 * The colour at every row: a `(here, there, t)` blend, on `interpolateRadii`'s schedule.
 *
 * The shared schedule is what makes it continuous -- two residues meeting at a row both evaluate
 * the same mix of their two colours there. And `lerp` is `a + (b - a) * t`, so equal colours come
 * back as exactly themselves: that is the whole of the bit-identity claim for a categorical mode.
 */
export function interpolateColors(out, c0, c1, c2, shift, linearSegments = LINEAR_SEGMENTS) {
  const shift1 = 1 - shift;
  for (let index = 0; index <= linearSegments; index += 1) {
    const t = index / linearSegments;
    const from = t < shift1 ? c0 : c1;
    const to = t < shift1 ? c1 : c2;
    const at = t < shift1 ? t + shift : t - shift1;
    for (let channel = 0; channel < 3; channel += 1) {
      out[index * 3 + channel] = lerp(from[channel], to[channel], at);
    }
  }
  return out;
}

/**
 * How far a kind reaches back into a neighbouring one, in Angstroms, and 0 when it does not.
 *
 * The whole of `THE CORD GOES IN A LITTLE` below, exported because a mesh diff cannot see it: the
 * hold changes the ring count and the face subdivision too, so a held sweep and a loose one are not
 * even the same length of vertex array and "which vertices moved" is not a question with an answer.
 * The rule is small enough to state and to check directly.
 *
 * Three doors, all of them closed by default:
 *
 * * **The hold is off** *and the neighbour is not a rod*. With the hold off the sizes ramp across
 *   the boundary and the two residues agree at every shared row, so there is no step to bury. Off
 *   is bit-identical, and this is where that starts. **A rod is the exception and is not gated on
 *   the hold**, because a rod is a hard step whatever the taper is doing: it is not swept, so
 *   nothing ramps into it, and the loop's flat end cap lands exactly *coplanar* with the rod's own
 *   flat cap on the shared boundary row. Two coincident discs is not a butt joint that reads badly,
 *   it is coincident geometry, and the tracer speckles it.
 * * **This kind carries a rail.** `rails.js` builds a run out of the very rows an entry would move
 *   and relies on consecutive residues sharing their boundary one, so moving a row folds the run
 *   over itself. The cord is the side that moves; a panel is not.
 * * **This kind is not the narrower one across the face.** A panel pushed into a cord comes out of
 *   the cord's sides. Through the face there is no such test on purpose: a cord thicker than the
 *   card it lands on is allowed to swell, which is what a cord ending on a card looks like, and
 *   `cartoon_railed`'s 0.39 A loop against its 0.13 A panel is the case that wants it most.
 *
 * The depth is the cord's own thickness half-extent -- its radius, for every loop in the catalogue
 * -- so the cap clears the joint by a full radius however the spine turns through it.
 */
export function entryDepth(look, kind, neighbourKind) {
  const rod = isRodResidue(look, neighbourKind);
  if (!rod && !look.taperHold) return 0;
  const here = profileFor(look, kind);
  if ((here.rail ?? 0) > RAIL_EPSILON) return 0;
  // A rod states no cross-section -- it is a radius -- so its reach across the face is that radius
  // rather than a profile's `w + r`. Reading `profileFor()` here instead would fall the rod's kind
  // back to the loop's own numbers and compare the cord against itself, which is 0 every time.
  const neighbour = profileFor(look, neighbourKind);
  const reach = rod ? look.helixRod : neighbour.w + neighbour.r;
  if (!(here.w + here.r < reach)) return 0;
  return here.h + here.r;
}

/**
 * Every polymer trace in one structure, swept with one look.
 *
 * `residues` is the residue set the *style* owns, so a selection layer sweeps its own stretch and
 * the base sweeps what is left. A trace element whose residue is not in that set is skipped, and
 * its neighbours are capped against the gap.
 *
 * `colorOf(residue)` is the style's own colour function, asked about **three** residues per
 * element: this one and the two either side, blended along the backbone by `interpolateColors()`.
 * A residue at a chain end, or beside one this style does not draw, blends against itself. Its
 * sizes clamp the same way only at a chain end or beside a `hidden` residue.
 *
 * Returns the mesh in the shape `appendMesh()` wants, plus `beads`: **analytic spheres**, for the
 * lone-residue polymer element that has no tube to sweep. Analytic beats tessellated, so those
 * never become triangles.
 */
export async function buildPolymerSweep({ structure, model, residues, look, colorOf, hidden = [] }) {
  if (look.helixOrientation) {
    // `useHelixOrientation` throws `missing helix-orientation` without this, and it is a *model*
    // property with a different provider and a different target from the structure-level
    // secondary-structure one.
    await HelixOrientationProvider.attach(propertyContext, model ?? structure.models[0]);
  }

  const wanted = new Map();
  for (const residue of residues) {
    const anchor = residue.atoms[0];
    if (!anchor) continue;
    wanted.set(`${anchor.unitId}|${anchor.residueIndex}`, residue);
  }
  /*
    Residues nobody draws. Beside one, a residue clamps as at a chain end: tapering toward a kind
    that is not there flares a loop to half a hidden helix's width at its cap. A residue another
    style owns is still tapered toward, so two styles of one look meet at one size.
  */
  const vanished = new Set();
  for (const residue of hidden) {
    const anchor = residue.atoms[0];
    if (anchor) vanished.add(`${anchor.unitId}|${anchor.residueIndex}`);
  }

  /*
    The four mesh streams are typed lists rather than arrays of numbers (`geom/buffers.js` carries
    the profile that says why). The hint is the sweep's own arithmetic rather than a guess: every
    drawn residue emits about `linearSegments + 1` rows of a ring, and a ring is a couple of dozen
    samples on the widest cross-section in the catalogue, so three floats times that is the right
    order. Growing past it costs one copy per doubling and getting it roughly right costs nothing.
  */
  // No panel, no ring: the full hint would reserve ~0.5 GB for 1AYM's cords. The lists still grow.
  const hint = look.panel === false ? 4096 : Math.max(4096, wanted.size * (segmentsFor(look) + 1) * 24 * 3);
  const mesh = {
    positions: new FloatList(hint),
    normals: new FloatList(hint),
    colors: new FloatList(hint),
    indices: new IndexList(hint),
    beads: [],
    rails: { joints: [], rods: [] }, helices: { joints: [], rods: [] },
    bases: { joints: [], rods: [] }, basesSkipped: 0, residueCount: 0,
  };
  if (!wanted.size) return finish(mesh);

  const linearSegments = segmentsFor(look);
  const state = createCurveSegmentState(linearSegments);
  const radii = new Float32Array(linearSegments + 1);
  const railRadii = new Float32Array(linearSegments + 1);
  // `Float64Array`, so a row's colour is the double `colorOf()` returned rather than a rounded copy
  // of it: the analytic primitives carry these numbers straight out to the scene buffers.
  const rowColors = new Float64Array((linearSegments + 1) * 3);
  const scratch = new Scratch();

  const rails = createRails();
  const rods = createRods();
  // Bases have no runs and nothing to close between units: one solid and one stem per residue,
  // each complete in itself. It is the one of the three accumulators that never spans a boundary.
  const bases = createBases(look);
  for (const unit of structure.units) {
    if (!Unit.isAtomic(unit) || unit.polymerElements.length === 0) continue;
    // A run never spans two units: they are separate chains and their edges do not meet.
    closeRun(rails);
    closeRod(rods);
    /*
      **The sweep builds in Mol\*'s model space, and a symmetry copy is not there.** Everything
      below reads its control points through `PolymerTraceIterator`, which takes them out of
      `atomicConformation.x[index]` -- the deposition's own coordinates -- and hands back the same
      numbers for every unit an assembly built from one chain. So 10EC's twelve portal subunits came
      out **stacked on the deposition**: 5,472 residues swept, 2.09 M triangles emitted, and a
      bounding box of one subunit against the atoms' 163 x 163 A. `geom/bases.js` records that the
      trace is model space and matches it deliberately, which is right -- a base has to land on its
      own backbone -- and leaves the whole swept mesh one operator short of the molecule.

      The operator goes on in two places, because the geometry leaves in two ways. The triangles and
      the beads are appended *here*, during this unit's own walk, so `transformMesh()` moves them at
      the end of it. The rails, the rods and the base solids are emitted **after every unit** and
      have to stay that way -- a base's solids come after the whole backbone, which is what makes a
      `bases` look a bit-identical prefix of the one it shares numbers with -- so those three carry
      the operator on the accumulator and apply it as they copy each point in.

      **Get this wrong and only the picture shows it.** The atoms carry `P.atom.x`, which *is* the
      transformed position, so every sphere, stick, marker and surface is placed without it; only
      the swept looks depend on it, and only where more than one operator is in play. No recorded
      picture holds such a structure: 3RGK's assembly is six units and all six operators are the
      identity.
    */
    const operator = unit.conformation.operator;
    rails.operator = operator;
    rods.operator = operator;
    bases.operator = operator;
    const mark = markMesh(mesh);
    const options = { ignoreSecondaryStructure: false, useHelixOrientation: !!look.helixOrientation };

    /*
      Pass one records what each trace element *is*, because a residue's profile tapers into its
      neighbours' and the iterator hands over one element at a time from a single reused object.
      The alternative is a one-element lookahead threaded through the sweep, which buys nothing:
      the walk is a few hundred elements and costs less than one ring of triangles.
    */
    const kinds = [];
    const drawn = [];
    const arrows = [];
    const rodded = [];
    // The residue itself, not just whether there was one: the blend needs the two neighbours'
    // colours and `colorOf()` takes a residue.
    const owned = [];
    const hiddenAt = [];
    const iterate = () => PolymerTraceIterator(unit, structure, options);
    for (const survey = iterate(); survey.hasNext;) {
      const element = survey.move();
      const kind = traceKind(element);
      kinds.push(kind);
      arrows.push(isArrowResidue(look, kind, element.secStrucLast));
      rodded.push(isRodResidue(look, kind));
      const found = wanted.get(`${unit.id}|${unit.residueIndex[element.center.element]}`);
      owned.push(found);
      drawn.push(found !== undefined);
      hiddenAt.push(vanished.has(`${unit.id}|${unit.residueIndex[element.center.element]}`));
    }

    let index = -1;
    for (const walk = iterate(); walk.hasNext;) {
      const element = walk.move();
      index += 1;
      const residueIndex = unit.residueIndex[element.center.element];
      const residue = wanted.get(`${unit.id}|${residueIndex}`);
      if (!residue) continue;
      const clampedPrev = element.first || element.initial;
      const clampedNext = element.last || element.final;
      const endPrev = clampedPrev || hiddenAt[index - 1] === true;
      const endNext = clampedNext || hiddenAt[index + 1] === true;
      sweepResidue({
        mesh, state, radii, railRadii, scratch, rails, rods, bases, look, element,
        unit, residueIndex, linearSegments,
        kind: kinds[index],
        kindPrev: endPrev ? kinds[index] : kinds[index - 1] ?? kinds[index],
        kindNext: endNext ? kinds[index] : kinds[index + 1] ?? kinds[index],
        arrow: arrows[index],
        /*
          A rod is not swept, so a run of them is a stretch of chain the mesh never sees. Its two
          ends -- where the flat cap goes -- are decided from the *neighbours*, exactly the way the
          rail's rim is and deliberately not the way `emitCap()` is: a run breaks at a chain
          terminus, at a residue nobody drew and where the kind stops being a rod, and never at
          `secStrucFirst`/`secStrucLast`. `geom/rods.js` carries the measurement behind that.
        */
        rod: rodded[index],
        rodBefore: !clampedPrev && rodded[index - 1] === true && drawn[index - 1] === true,
        rodAfter: !clampedNext && rodded[index + 1] === true && drawn[index + 1] === true,
        // An arrowhead's *tip* is the strand's own width statement at that end, so what follows a
        // strand has to taper against zero rather than against the strand's full width. Without
        // this the loop after a strand starts at half the ribbon's width and reads as a wedge
        // floating just past the point, which is what Mol* itself draws.
        afterArrow: !endPrev && arrows[index - 1] === true,
        gapBefore: !clampedPrev && drawn[index - 1] === false,
        gapAfter: !clampedNext && drawn[index + 1] === false,
        color: colorOf(residue),
        // The colour clamps at every gap, not only a hidden one: the panel caps against it, and
        // each style colours its own residues.
        colorBefore: clampedPrev || !drawn[index - 1] ? null : colorOf(owned[index - 1]),
        colorAfter: clampedNext || !drawn[index + 1] ? null : colorOf(owned[index + 1]),
        rowColors,
      });
      mesh.residueCount += 1;
    }

    transformMesh(mesh, mark, operator);
  }
  emitRails(mesh, rails);
  emitRods(mesh, rods);
  emitBases(mesh, bases);
  mesh.basesSkipped = bases.skipped;
  return finish(mesh);
}


/** Where this unit's own triangles and beads start, for `transformMesh()` to move from. */
function markMesh(mesh) {
  return {
    positions: mesh.positions.length,
    normals: mesh.normals.length,
    beads: mesh.beads.length,
  };
}


/**
 * The triangles and beads this unit produced, moved onto this unit's operator.
 *
 * The rails, the rods and the base solids are not here: they are emitted after the whole walk and
 * carry their operator on the accumulator instead (`applyOperator()` in `geom/operator.js`).
 *
 * **The identity returns before touching anything**, which is not an optimisation: it is what keeps
 * every deposition, every asymmetric unit and every recorded picture bit-identical to the
 * untransformed build. Same rule as `twist`'s zero and the transmission lobe's.
 */
function transformMesh(mesh, mark, operator) {
  if (operator.isIdentity) return;
  /*
    `.data` rather than the list, because `applyOperator()` wants three consecutive indexable slots
    and that is the backing store. Only `mark..length` is touched, so the slack past the end is
    never read.
  */
  const positions = mesh.positions.data;
  for (let at = mark.positions; at < mesh.positions.length; at += 3) {
    applyOperator(operator, positions, at);
  }
  const normals = mesh.normals.data;
  for (let at = mark.normals; at < mesh.normals.length; at += 3) {
    applyOperator(operator, normals, at, true);
  }
  for (let index = mark.beads; index < mesh.beads.length; index += 1) {
    const bead = mesh.beads[index];
    const moved = [bead.x, bead.y, bead.z];
    applyOperator(operator, moved, 0);
    [bead.x, bead.y, bead.z] = moved;
  }
}

/** One trace element: its spine, its frame, its cross-section and its triangles. */
function sweepResidue(job) {
  const {
    mesh, state, radii, railRadii, rowColors, scratch, rails, rods, bases, look, element, kind,
    kindPrev, kindNext, color, linearSegments,
  } = job;
  const nucleic = kind === 'nucleic';
  const shift = nucleic ? NucleicShift : StandardShift;
  const helix = kind === 'helix';
  // Mol* relaxes a helix's tension back to the standard one once the curve is on the helix axis,
  // because the axis is already smooth and a 0.9 tension would over-shoot its own ends.
  const tension = helix && !look.helixOrientation ? HelixTension : StandardTension;

  interpolateCurveSegment(state, element, tension, shift);

  const here = profileFor(look, kind);

  /*
    ================================ HOW LONG A KIND HOLDS ================================
    `interpolateSizes` is a symmetric two-segment lerp from the midpoint of the previous residue to
    the midpoint of the next, so a residue reaches its **own** numbers at exactly one sample --
    the middle one -- and is on its way in or out everywhere else. On a run of one that is the whole
    residue spent in transit: 3INS chain A is `HHHHHHHHHH-HHHHHH----`, one loop residue between two
    helices, and the cord is 1 sample of 25. It renders as a ribbon pinched to a point where Mol*
    draws a visible linker.

    `taperHold` puts *this* residue's numbers at both ends of the ramp instead of its neighbours',
    so the kind holds across the whole of its own length and the crossover is the residue boundary
    itself. It is a look's authored setting, chosen by eye in front of this renderer against how
    many samples the middle kind is actually held for.

    **It is a switch and not a dial.** As a 0-1 number every value between the ends draws the same
    picture: a partial hold only slides the crossover a fraction of a sample either side of a
    boundary and leaves the same soft pinch. The two settings that read as different
    pictures are the two ends, so those are the two it has. Off is **bit-identical** -- the
    neighbour is returned untouched and nothing downstream can tell the setting exists.

    **Truthiness rather than `=== true`.** A saved set can carry a number here -- `0.8` means
    held -- and reading it strictly would turn that look silently off, which is exactly the quiet
    substitution this tree refuses everywhere else.

    **The arrow's zero survives it.** A residue after an arrowhead tapers up from the tip, and
    blending that zero toward this residue's width would leave a step off the point. The hold
    applies to the thickness and the radii; the breadth stays 0.

    **A step needs finishing where a ramp did not**, and that is the other half of this setting
    rather than a separate feature. Two things below are gated on it and on nothing else:
    `railCutAfter`, which closes the rim where the hold *cuts* a rail instead of running it out,
    and `entryDepth`, which buries the narrower cross-section's cap inside the wider one. Both are
    no-ops when it is off, so off stays bit-identical with them in the file.
  */
  const hold = !!look.taperHold;
  // One object for the whole residue: held, every neighbour is this residue's own profile, and the
  // `rail ?? 0` is spelled once here rather than at each of the three reads below.
  const held = hold ? { ...here, rail: here.rail ?? 0 } : null;
  const toward = (neighbour) => held ?? neighbour;
  // ======================================================================================

  const arrow = job.arrow === true;
  const after = toward(profileFor(look, kindNext));
  const previous = toward(profileFor(look, kindPrev));
  /*
    The arrow tapered its own breadth to zero, so that is the width this residue tapers up from --
    and its rail closed across the point, so that is a cord this residue starts again from nothing
    rather than one it inherits. Without the second, the two cords edging an arrowhead carry on past
    the tip as a pair of ridges laid down the loop behind it: measured on an all-strand structure,
    1.0 and 1.2 A of cord past the point on the two sides.
  */
  const before = job.afterArrow ? { ...previous, w: 0, rail: 0 } : previous;

  /*
    ================================ THE CROSS, ONCE ================================
    Our `w` is the broad half-width and our `h` is the half-thickness, which is the ordinary
    reading. Mol*'s are the other way round: its `widthValues` is the thickness and its
    `heightValues` is the breadth (measured). So the six numbers go in
    thickness-first, and they come back out `widthValues -> thickness`, `heightValues -> breadth`.
    This is the only place in the tree that knows.
  */
  /*
    **An arrowhead ramps its breadth and nothing else**, so it takes its *own* thickness and edge
    radius at both ends of the ramp rather than its neighbours'. That is `arrow.js`'s stated rule --
    "only the breadth ramps" -- and it is Mol*'s own behaviour measured
    (the broad face runs 5.100 -> 0.000 A across the residue while the thickness holds at
    0.680). Taking the neighbours' numbers instead shows at the tip: half a residue of taper toward
    whatever follows a strand arrives before the point. On `cartoon_railed`, whose sheet carries no
    edge radius at all and whose loop is a 0.39 A cord, the arrow comes out a 0.39 A-wide,
    0.44 A-thick bead and disappears into the tube behind it. It looks right only on a look that
    authors a sheet and a loop of nearly the same radius.
  */
  const beforeSize = arrow ? here : before;
  const afterSize = arrow ? here : after;
  interpolateSizes(
    state, beforeSize.h, here.h, afterSize.h, before.w, here.w, after.w, shift,
  );
  const thicknessValues = state.widthValues;
  const breadthValues = state.heightValues;
  // ================================================================================
  interpolateRadii(radii, beforeSize.r, here.r, afterSize.r, shift, linearSegments);

  /*
    The colour, on the same schedule and for the same reason. Every consumer below reads its own row
    out of `rowColors`: the mesh, the caps, the cord, the helix rod. **The base solids do not** -- a
    base is one object per nucleotide drawn beside the sweep and takes its residue's own colour.

    Not clamped by the arrow, unlike the sizes: an arrowhead ramps its breadth and nothing else.
  */
  interpolateColors(
    rowColors, job.colorBefore ?? color, color, job.colorAfter ?? color, shift, linearSegments,
  );

  /*
    The rails. `rail` is optional and most looks omit it, so the whole feature costs one `Math.max`
    when it is off. It tapers by the same shifted lerp as `r`, which is what fades a helix's rails
    out into a loop that has none.

    **An arrowhead holds its own cord to the point**, for the reason two blocks up: a head that
    tapered its cord toward whatever follows the strand would arrive at its tip carrying half the
    radius the strand behind it does, and the one cord that runs round the whole outline would thin
    over the last residue for no reason the shape gives.
  */
  const railHere = here.rail ?? 0;
  const railBefore = arrow ? railHere : (before.rail ?? 0);
  const railAfter = arrow ? railHere : (after.rail ?? 0);
  const railed = Math.max(railBefore, railHere, railAfter) > RAIL_EPSILON;
  if (railed) interpolateRadii(railRadii, railBefore, railHere, railAfter, shift, linearSegments);
  else closeRun(rails);

  /*
    The ring is decided once per residue, from the largest size this residue interpolates *through*,
    so the vertex count is constant along the tube even where the taper crosses zero. `profile.js`
    says why that matters.
  */
  const ringW = Math.max(before.w, here.w, after.w);
  // The thickness and the radius are read off the *swept* ends, which an arrowhead holds at its
  // own: a ring sized for a taper the residue does not take carries samples nothing places.
  const ringH = Math.max(beforeSize.h, here.h, afterSize.h);
  /*
    The face subdivision is decided on the widest this residue's face actually gets, which on an
    arrow residue is `arrowFactor` times its own `w` -- the ring is fixed for the residue and the
    arrowhead is where the face is widest, so deciding it on the unwidened `w` would leave the one
    place the comb is worst under-sampled.
  */
  const faceW = ringW * (job.arrow === true ? look.arrowFactor : 1);
  /*
    `faceStep` and `sides` are the look's when it states them. Neither is art direction in the way
    the cross-section is, and they are read here rather than in the catalogue's own vocabulary for
    two different reasons: a **prism** has no arc, so it needs `sides` before it can be built at
    all, and a **low-poly** look wants its faces left whole -- the comb `FACE_STEP` exists to cut is
    a defect on a ribbon claiming to be smooth and is the shape itself on one that does not.
  */
  // Not built with no panel: `profileRing()` throws on a zero extent, and a cords look's thickness
  // slider at its floor would raise that for a ring nothing places.
  const panel = look.panel !== false;
  const ring = panel
    ? profileRing(
      faceW, ringH, Math.max(beforeSize.r, here.r, afterSize.r), look.cornerSegments,
      look.faceStep ?? FACE_STEP, look.sides ?? 0,
    )
    : null;
  const ringCount = panel ? ringSampleCount(ring) : 0;

  // Trap 4: a terminal residue sweeps fewer samples, and `v.initial` shifts the arrays under them.
  let segmentCount = linearSegments;
  let offset = 0;
  if (element.initial) {
    segmentCount = Math.max(Math.round(linearSegments * shift), 1);
    offset = linearSegments - segmentCount;
  } else if (element.final) {
    segmentCount = Math.max(Math.round(linearSegments * (1 - shift)), 1);
  }

  /*
    A residue that is both `initial` and `final` is a polymer element on its own -- no curve to
    sweep, so Mol* draws a sphere and so do we, except that ours is an analytic one. The radius is
    the profile's *thickness* half-extent doubled, which is Mol*'s own choice read in our units: for
    a tube look that is twice the tube's radius, a bead rather than a bump.
  */
  if (element.initial && element.final) {
    closeRun(rails);
    mesh.beads.push({
      x: element.p2[0], y: element.p2[1], z: element.p2[2],
      radius: 2 * (here.h + here.r), color,
    });
    return;
  }

  const arrowBase = here.w;

  /*
    The overhang. Both terminal cases push the end control point out along the curve's own
    direction, so a chain does not stop dead on its last alpha carbon.

    Mol* pushes by `w1 x OverhangFactor` where its `w1` is the size theme's half-thickness. This
    tree has no size theme -- the sizes are authored, not derived from an atom -- so the length is
    the profile's own thickness half-extent including the edge roll, `(h + r) x OverhangFactor`,
    which is the tube's radius for a loop and lands within a tenth of an Angstrom of Mol*'s 0.68 A
    on the same structure. It is shape-derived rather than borrowed, and it moves with the look.
  */
  const overhang = (here.h + here.r) * OverhangFactor;
  const points = scratch.curvePoints(state.curvePoints, offset, segmentCount);
  if (element.initial) overhangInto(points, 0, points, 1, element.p2, overhang);
  else if (element.final) overhangInto(points, segmentCount, points, segmentCount - 1, element.p2, overhang);

  /*
    ================================== THE ROD =====================================
    A look that draws this kind as a rod does not sweep it. This is the line that makes that true,
    and it is placed here rather than earlier on purpose: the rod rides `points`, which is the same
    curve buffer the ring would have been placed on and which the overhang above has already
    finished writing. Nothing re-derives a spine, so a rod cannot disagree with the tube it replaces
    about where the helix is.

    **Returning here is what stops the residue being swept**, and that matters more than it looks.
    `cartoon_geometric` states no `helix` cross-section at all, so `profileFor()` would fall it
    back to the loop's -- a 0.32 A tube quietly drawn *inside* a 2.04 A rod, invisible until an
    opacity below one makes it visible, which is exactly the class of mistake that renders
    plausibly. The absent profile is what a neighbouring loop tapers toward; it is not what stops
    the sweep.

    It closes the rail run for the same reason `railed` being false does: a rod has no panel edge
    for a cord to ride.
  */
  if (job.rod) {
    closeRun(rails);
    addRod(
      rods, points, segmentCount + 1, look.helixRod, rowColors, offset,
      !job.rodBefore, !job.rodAfter,
    );
    return;
  }
  // ================================================================================

  /*
    ============================ THE CORD GOES IN A LITTLE ============================
    Held, two different cross-sections meet flush on one shared row: a slab cut off square with a
    tube starting out of the middle of the cut. That is a butt joint and it reads as one -- the
    surfaces meet exactly, so every shading discontinuity between them lands on the same line.
    `entryDepth()` above decides how far the narrower of the two reaches back along its own spine to
    bury its end cap in the wider one, and carries the three doors it has to get through.

    The two conditions that live *here* rather than in it, because they are about this residue's
    place in the chain and not about its profile:

    **Never across an arrowhead.** The residue after a tip tapers up from nothing and the tip's own
    geometry is a point rather than the strand's width, so `entryDepth()` would be comparing the
    wrong two shapes -- it is handed kinds, and the arrow is the one place a kind does not describe
    what got drawn.

    **And it cannot collide with the overhang above**, which writes the same two rows.
    `element.initial` clamps `kindPrev` to this residue's own kind and `element.final` clamps
    `kindNext`, so a row that overhangs is a row whose neighbour is itself and has no step to bury.
  */
  const entryBefore = job.afterArrow ? 0 : entryDepth(look, kind, kindPrev);
  const entryAfter = arrow ? 0 : entryDepth(look, kind, kindNext);
  if (entryBefore > 0) backInto(points, 0, 1, entryBefore);
  if (entryAfter > 0) backInto(points, segmentCount, segmentCount - 1, entryAfter);

  /*
    ================================ A LOOK WITH NO PANEL ================================
    `panel: false` draws the rails and not the surface they edge, which is a look rather than an
    optimisation: what is left is the cord running round the whole outline of every helix, every
    strand and every arrowhead, with daylight where the ribbon was.

    It is **the only thing in the catalogue that can remove the mesh**, so two things have to be
    true of a look that names it and neither is checked here, because the check that matters is the
    one a reader can make in the catalogue: every kind carries a `rail`, or the chain comes apart
    wherever one does not. A loop's circular cross-section has no edge, but it has an *extent* --
    the rails sit at `+/-(w + r)` whatever the shape is -- so a cord pair on a tube is two cords
    `2(w + r)` apart, which is what carries the look through the loops.

    The rail centre line is read off the same row the ring would have been placed on, and
    `entryDepth()`, the taper and the arrow ramp are all shared. Only the ring, its placement and the
    three emits below are skipped, which is where the whole cost is.
  */
  const rows = segmentCount + 1;
  const grid = panel ? scratch.grid(rows * ringCount) : null;
  const tangents = panel ? scratch.tangents(rows * ringCount) : null;
  const railGrid = railed ? scratch.rails(rows) : null;
  const sample = scratch.sample;
  const axisU = scratch.axisU;
  const axisV = scratch.axisV;

  /*
    The frame, for every row, before any of them is used.

    It is read first and in one pass because `frame.js` needs the whole residue in hand: it spreads
    the residue's roll evenly along the residue's own arc length, which is a statement about all
    nine rows at once. Mol*'s schedule concentrates that roll in the last third of every residue --
    1.85 degrees on the step leaving a residue boundary against 8.81 on the step before its end,
    measured on three structures -- and a flat ribbon on it reads as tiles rather than as a coil.
    `frame.js` has the measurement and why the two end rows are left exactly alone.
  */
  const axes = scratch.axes(rows);
  for (let row = 0; row < rows; row += 1) {
    crossSectionAxes(nucleic, state.normalVectors, state.binormalVectors, offset + row, axisU, axisV);
    const frame = row * 3;
    axes.u[frame] = axisU[0]; axes.u[frame + 1] = axisU[1]; axes.u[frame + 2] = axisU[2];
    axes.v[frame] = axisV[0]; axes.v[frame + 1] = axisV[1]; axes.v[frame + 2] = axisV[2];
  }
  /*
    **A circle has no frame.** When the cross-section is rotationally symmetric -- `w` and `h` zero
    through the whole residue, which is every loop and the entire ribbon family -- rolling the frame
    only slides each vertex around its own circle and moves no surface. Skipping it there is not an
    optimisation dressed as one: it is what keeps `ribbon` and `ribbon_slender`
    bit-identical at every `twist`. A rail rides on the width axis, so a
    railed profile is framed however round it is.
    Not true of a `sides` or `flat` ring: `cartoon_prism`'s and `cartoon_lowpoly`'s loop facets keep
    Mol*'s roll. Framing them would move both of those looks, so it is left as it is.
  */
  if (railed || ringW > 0 || ringH > 0) {
    spreadTwist(axes.u, axes.v, points, rows, look.twist ?? DEFAULT_TWIST);
  }

  for (let row = 0; row < rows; row += 1) {
    const frame = row * 3;
    axisU[0] = axes.u[frame]; axisU[1] = axes.u[frame + 1]; axisU[2] = axes.u[frame + 2];
    axisV[0] = axes.v[frame]; axisV[1] = axes.v[frame + 1]; axisV[2] = axes.v[frame + 2];
    /*
      The sizes are read at `offset + row`, the same parameter the curve point is read at. Mol*
      reads them at `row` instead -- it shifts the three vector arrays for `v.initial` and does not
      shift the two size arrays -- which puts a terminal residue's taper a fraction of a residue out
      of step with its own spine. It is invisible on a loop, whose sizes are constant, and it is
      wrong, so this does the matching thing.
    */
    const breadth = arrow
      ? arrowHalfWidth(arrowBase, look.arrowFactor, row, segmentCount, look.arrowLength ?? 1)
      : breadthValues[offset + row];
    const thickness = thicknessValues[offset + row];
    const radius = radii[offset + row];
    for (let k = 0; panel && k < ringCount; k += 1) {
      profilePoint(ring, k, breadth, thickness, radius, sample);
      const at = (row * ringCount + k) * 3;
      grid[at] = points[row * 3] + axisU[0] * sample[0] + axisV[0] * sample[1];
      grid[at + 1] = points[row * 3 + 1] + axisU[1] * sample[0] + axisV[1] * sample[1];
      grid[at + 2] = points[row * 3 + 2] + axisU[2] * sample[0] + axisV[2] * sample[1];
      // The ring tangent is `(-sin, cos)` in the cross-section's axes -- which is the arc's own
      // direction on a corner and the face's own direction along a straight edge, so it stays
      // correct when the corner radius is zero and the "arc" is a crease.
      tangents[at] = axisU[0] * -sample[3] + axisV[0] * sample[2];
      tangents[at + 1] = axisU[1] * -sample[3] + axisV[1] * sample[2];
      tangents[at + 2] = axisU[2] * -sample[3] + axisV[2] * sample[2];
    }
    /*
      The rail centre is the panel's own outer edge at zero thickness: `breadth + radius` along the
      width axis, which is the extreme point of the cross-section (`profile.js`: the total
      half-extent is `w + r`). Reading it here rather than re-deriving a curve is what makes it
      inherit the taper, the arrow ramp and the frame without a second opinion about any of them.
    */
    if (railed) {
      const reach = breadth + radius;
      for (let side = 0; side < 2; side += 1) {
        const sign = side === 0 ? 1 : -1;
        const at = (row * 2 + side) * 3;
        railGrid[at] = points[row * 3] + axisU[0] * sign * reach;
        railGrid[at + 1] = points[row * 3 + 1] + axisU[1] * sign * reach;
        railGrid[at + 2] = points[row * 3 + 2] + axisU[2] * sign * reach;
      }
    }
  }

  /*
    **`flat` gives every triangle its own three vertices carrying that triangle's own normal**, and
    it is the same technique -- and the same argument -- `geom/markers.js` makes for a faceted ion:
    `intersectTriangle` barycentric-interpolates the vertex normals, so *not* sharing them is what
    makes a facet catch its own highlight with a hard edge round it. Nothing about the surface moves;
    the triangle count is exactly the count the smooth path emits and only the vertex count grows.

    It is the shading half of a low-poly look and it is deliberately separate from the geometry
    half, which is `segmentsFor()` and `faceStep`. A look may have either without the other -- and
    on a look sampled at eight rows a residue, flat shading alone is a defect, which is why the two
    live in the catalogue as two numbers rather than as one flag called "low poly".
  */
  if (panel && look.flat === true) {
    emitFaceted(mesh, grid, tangents, rows, ringCount, rowColors, offset);
  } else if (panel) {
    const base = mesh.positions.length / 3;
    emitVertices(mesh, grid, tangents, rows, ringCount, rowColors, offset);
    emitTube(mesh, base, rows, ringCount);
  }

  /*
    Caps, on Mol*'s own rule plus the gaps this tree can have and Mol* cannot: a style draws a
    subset of the residues, so a segment can end against a residue nobody drew. An interior join
    needs no cap -- consecutive residues share their boundary sample *and* the size at it, because
    `interpolateSizes` evaluates the midpoint of the same two control sizes from both sides.
  */
  // `arrow` is in the first condition and Mol* has no equivalent: an arrowhead's base is
  // `arrowFactor` times the strand behind it, so its first ring is *wider* than the ring it abuts
  // and the shoulder would otherwise be an open slot on each side. The step is wanted -- an
  // arrowhead has shoulders -- and the hole is not.
  const capStart = !!(element.secStrucFirst || element.first || element.initial
    || job.gapBefore || arrow);
  const capEnd = !!(element.secStrucLast || element.last || element.final || job.gapAfter);
  // A cap is already flat -- one normal for the whole fan -- so `flat` has nothing to say to it.
  if (panel && capStart) emitCap(mesh, grid, rows, ringCount, rowColors, offset, 0);
  if (panel && capEnd) emitCap(mesh, grid, rows, ringCount, rowColors, offset, rows - 1);

  /*
    **The rim does not close where the mesh caps, and this is the one place the two conditions are
    deliberately different.** `emitCap()` closes at every secondary-structure *element* boundary,
    where the cap is invisible: the sizes interpolate across it, so the two flat discs coincide and
    the surface reads as continuous. A rim there is not invisible -- it is a bar laid across the
    middle of a ribbon nobody would say has ended. Mol*'s trace normalises every helix type, so the
    boundaries in question are kind changes and arrow shoulders, not kinks.

    A rim closes where the *rail* ends: a chain terminus, a residue nobody drew, an arrowhead's
    **point**. Where a helix runs into a loop the rail does not end -- it tapers to nothing with the
    panel it edges, and closes itself to a point, which is what a cord running out looks like.

    **An arrowhead's shoulder is where `emitCap()` caps and the rim deliberately does not**, which
    is the second half of the same lesson. The mesh needs that cap: the head's first ring is
    `arrowFactor` times the strand's, so the step would otherwise be an open slot on each side. A
    *rim* there is the bar across the middle again -- a panel has not ended at a shoulder, it has
    got wider, and only the two shoulder steps are free edge. So the cord is not cut there at all.
    It runs along the strand, turns out along the shoulder -- the two rail centres at that row are
    the step's own two ends, one residue's last row and the next's first at the same spine sample --
    and turns again down the slant to the point. One cord round the whole outline, which is the
    look, rather than three pieces and a bar laid across the widest part of the arrow.
  */
  /*
    **Where the hold cuts a rail rather than running it out.**

    The paragraph above is `toward()`'s argument, not `emitCap()`'s: a helix running into a loop
    does not *end*, because the loop residue inherits the helix's rail through its own `before` and
    the run really does carry on past the boundary and fade to a point inside it.

    Held, nothing is inherited. The helix holds its full rail radius to its last row and the loop --
    whose own kind names no rail -- is not railed at all, so the run stops with width still on it.
    That is a **cut**: the same thing as a chain terminus or a residue nobody drew, arriving by a
    third route, and the rim has to close there or the panel ends in mid-air with two cords stopping
    in the middle of the picture.

    **It is still not `secStrucFirst`/`secStrucLast`**: blended, the loop inherits the helix's rail
    across that boundary, so nothing is cut and no rim closes.
  */
  const railedKind = (kind) => (profileFor(look, kind).rail ?? 0) > RAIL_EPSILON;
  const railCutBefore = hold && railed && !railedKind(kindPrev);
  const railCutAfter = hold && railed && !railedKind(kindNext);
  const rimStart = !!(element.first || element.initial || job.gapBefore) || railCutBefore;
  const rimEnd = !!(element.last || element.final || job.gapAfter || arrow) || railCutAfter;
  if (railed) addRails(rails, railGrid, railRadii, rowColors, offset, rows, rimStart, rimEnd);

  /*
    The base, last, because it reads `points` after the overhang and the two entry depths have
    written into it -- the stem lands on the spine that was swept rather than on the one the curve
    state handed over.

    **Gated on the kind and not on the residue.** A `bases` look asked for a helix or a sheet draws
    no base at all rather than looking for ring atoms a peptide has not got, which is the same
    boundary `profileFor`'s fallback draws and for the same reason: a look states what it is for.
  */
  if (kind === 'nucleic' && basesShape(look)) {
    addBase(bases, job.unit, job.residueIndex, points, rows, color);
  }
}

/**
 * Vertex normals from the surface itself: `cross(ring tangent, spine tangent)`.
 *
 * The ring tangent is analytic, so a crease stays a crease -- a finite difference around the ring
 * would average across a sharp corner and bevel it. The spine tangent is a finite difference *along*
 * the tube, which is what makes a taper shade correctly: a beta arrowhead's sides slope in over
 * three Angstroms, and a normal taken from the cross-section alone would light them as though they
 * ran parallel to the spine.
 *
 * **This is also why the panel gets away with eight samples a residue and a rail does not.** These
 * normals are interpolated across every triangle, so the facets shade smooth; `rails.js` has the
 * measurement and what it costs there.
 *
 * **The first and last rows take a second-order one-sided difference, and that is not a nicety.**
 * A residue's first row is the previous residue's last, at the same position with the same frame
 * and the same sizes, so the two must agree about the normal or there is a shading crease at every
 * join -- and a first-order one-sided difference does not agree: one side looks forward over a step
 * and the other looks back over one, and the two chords differ by the curve's own turn. Measured on
 * 3RGK with a first-order difference: **8.7 degrees of disagreement at the median shared vertex**,
 * once per residue, all the way down every helix. `(-3f0 + 4f1 - f2) / 2` is exact for a quadratic
 * and takes the same median to under a tenth of a degree.
 */
function emitVertices(mesh, grid, tangents, rows, ringCount, colors, offset) {
  const normal = [0, 0, 0];
  for (let row = 0; row < rows; row += 1) {
    const c = (offset + row) * 3;
    for (let k = 0; k < ringCount; k += 1) {
      const at = (row * ringCount + k) * 3;
      surfaceNormal(normal, grid, tangents, rows, ringCount, row, k);
      mesh.positions.push3(grid[at], grid[at + 1], grid[at + 2]);
      mesh.normals.push3(normal[0], normal[1], normal[2]);
      mesh.colors.push3(colors[c], colors[c + 1], colors[c + 2]);
    }
  }
}

/**
 * The surface normal at one grid vertex, from the surface rather than from a triangle.
 *
 * Factored out of `emitVertices` because `emitFaceted` needs the same answer for a different
 * purpose -- and needs it to be the *same* answer, not a similar one: it is what decides which way
 * a facet faces, and two derivations of "which way is out" is the class of disagreement this tree
 * spends most of its comments on.
 */
function surfaceNormal(out, grid, tangents, rows, ringCount, row, k) {
  const spine = [0, 0, 0];
  const at = (row * ringCount + k) * 3;
  const ends = rows >= 3;
  const edge = ends && (row === 0 || row === rows - 1);
  if (edge) {
    const step = row === 0 ? 1 : -1;
    const near = ((row + step) * ringCount + k) * 3;
    const far = ((row + 2 * step) * ringCount + k) * 3;
    spine[0] = step * (-3 * grid[at] + 4 * grid[near] - grid[far]);
    spine[1] = step * (-3 * grid[at + 1] + 4 * grid[near + 1] - grid[far + 1]);
    spine[2] = step * (-3 * grid[at + 2] + 4 * grid[near + 2] - grid[far + 2]);
  } else {
    const from = (Math.max(row - 1, 0) * ringCount + k) * 3;
    const to = (Math.min(row + 1, rows - 1) * ringCount + k) * 3;
    spine[0] = grid[to] - grid[from];
    spine[1] = grid[to + 1] - grid[from + 1];
    spine[2] = grid[to + 2] - grid[from + 2];
  }
  cross(out, tangents[at], tangents[at + 1], tangents[at + 2], spine[0], spine[1], spine[2]);
  // A ring that has collapsed to a line -- a zero-width, zero-radius profile -- leaves nothing
  // to cross. The ring tangent is still the right plane, so fall back to it rotated a quarter
  // turn, which is the outward direction by construction.
  if (!normalizeInto(out, out[0], out[1], out[2])) {
    normalizeInto(out, tangents[at + 1], -tangents[at], 0);
  }
  return out;
}

/** The tube's quads, wound so the face normal agrees with the vertex normals. */
function emitTube(mesh, base, rows, ringCount) {
  for (let row = 0; row < rows - 1; row += 1) {
    for (let k = 0; k < ringCount; k += 1) {
      const next = (k + 1) % ringCount;
      const a = base + row * ringCount + k;
      const b = base + row * ringCount + next;
      const c = base + (row + 1) * ringCount + k;
      const d = base + (row + 1) * ringCount + next;
      mesh.indices.push6(a, b, c, b, d, c);
    }
  }
}

/**
 * The same tube, as triangles that share no vertices and carry their own plane's normal.
 *
 * `emitVertices` + `emitTube`'s alternative, for a look that is read by its facets. Same grid, same
 * winding, same triangle count -- the whole difference is that a vertex appears once per triangle
 * that uses it, which is what stops `intersectTriangle` interpolating a curve across a facet.
 *
 * **A facet's plane is not always trustworthy, and the surface it approximates always is.** The
 * grid is not made of well-shaped quads everywhere: near a chain terminus the spine step falls to a
 * few hundredths of an Angstrom while the cross-section's broad face stays a couple of Angstroms
 * across, and a 55:1 sliver's plane is well-defined in direction and *ill-conditioned in roll* --
 * it can tip past ninety degrees from the surface it lies on, which is a facet lit from inside the
 * ribbon. Measured on 3RGK at three rows a residue: one such triangle, exactly inverted.
 *
 * So `surfaceNormal()` -- the same function `emitVertices` uses, deliberately the same and not a
 * similar one -- is the reference. The plane's sign is taken from it, and where the plane disagrees
 * with it by more than sixty degrees the plane is discarded and the surface normal used instead.
 * Sixty is wide: a real facet on a coarse spine departs by a few degrees, so nothing an author
 * asked for is inside the threshold and everything ill-conditioned is.
 *
 * The alternative -- deciding "which way is out" from the row's own centroid -- reads as though it
 * ought to work, because the cross-section is convex and contains the spine. It does not, and this
 * is the same sliver: the *surface* normal at a vertex always points away from the centroid, and a
 * sliver's *plane* need not.
 */
function emitFaceted(mesh, grid, tangents, rows, ringCount, colors, offset) {
  const normal = [0, 0, 0];
  const surface = [0, 0, 0];
  for (let row = 0; row < rows - 1; row += 1) {
    for (let k = 0; k < ringCount; k += 1) {
      const next = (k + 1) % ringCount;
      const a = (row * ringCount + k) * 3;
      const b = (row * ringCount + next) * 3;
      const c = ((row + 1) * ringCount + k) * 3;
      const d = ((row + 1) * ringCount + next) * 3;
      for (const [triangle, corner] of [[[a, b, c], k], [[b, d, c], next]]) {
        surfaceNormal(surface, grid, tangents, rows, ringCount, row, corner);
        const base = mesh.positions.length / 3;
        if (!facetNormal(normal, grid, triangle, surface)) continue;
        for (const at of triangle) {
          // The vertices are unshared and carry the facet's one normal; the colour still comes from
          // the row the vertex is on, so a flat-shaded look ramps exactly as the smooth one does.
          const c = (offset + Math.floor(at / (ringCount * 3))) * 3;
          mesh.positions.push3(grid[at], grid[at + 1], grid[at + 2]);
          mesh.normals.push3(normal[0], normal[1], normal[2]);
          mesh.colors.push3(colors[c], colors[c + 1], colors[c + 2]);
        }
        mesh.indices.push3(base, base + 1, base + 2);
      }
    }
  }
}

/** How far a facet's plane may depart from the surface before the surface is believed instead. */
const FACET_LIMIT = Math.cos((60 * Math.PI) / 180);

/**
 * One triangle's outward plane normal, or `false` when it has no area to have one.
 *
 * A degenerate triangle is not an error and is not skipped for tidiness: a beta arrowhead's last
 * row collapses the ring to a point, so its final band of quads really is a fan of slivers with no
 * area at all. The smooth path emits them and gets away with it, because its normals come from the
 * ring rather than from the triangle; here a zero-length cross product would be written out as a
 * zero normal and shaded black, so the triangle is dropped instead.
 */
function facetNormal(out, grid, [a, b, c], surface) {
  cross(
    out,
    grid[b] - grid[a], grid[b + 1] - grid[a + 1], grid[b + 2] - grid[a + 2],
    grid[c] - grid[a], grid[c + 1] - grid[a + 1], grid[c + 2] - grid[a + 2],
  );
  if (!normalizeInto(out, out[0], out[1], out[2])) return false;
  const agreement = out[0] * surface[0] + out[1] * surface[1] + out[2] * surface[2];
  if (Math.abs(agreement) < FACET_LIMIT) {
    out[0] = surface[0]; out[1] = surface[1]; out[2] = surface[2];
  } else if (agreement < 0) {
    out[0] = -out[0]; out[1] = -out[1]; out[2] = -out[2];
  }
  return true;
}

/**
 * A flat fan closing one end of the tube.
 *
 * Its vertices are new ones at the same positions as the ring's, carrying the end's own normal
 * rather than the tube's -- a cap that shared vertices with the tube would round the rim it exists
 * to make sharp.
 */
function emitCap(mesh, grid, rows, ringCount, colors, offset, row) {
  const start = row === 0;
  const c = (offset + row) * 3;
  const other = start ? 1 : rows - 2;
  const normal = [0, 0, 0];
  const centre = ringCentre(grid, ringCount, row);
  const inside = ringCentre(grid, ringCount, other);
  // The cap looks along the spine, away from the tube. Both ends are ring centroids rather than
  // one sample each: at a beta arrow's tip the ring has all but collapsed, and a single sample
  // there is dominated by whatever is left of the cross-section.
  if (!normalizeInto(
    normal,
    centre[0] - inside[0], centre[1] - inside[1], centre[2] - inside[2],
  )) return;

  const base = mesh.positions.length / 3;
  mesh.positions.push3(centre[0], centre[1], centre[2]);
  mesh.normals.push3(normal[0], normal[1], normal[2]);
  mesh.colors.push3(colors[c], colors[c + 1], colors[c + 2]);
  for (let k = 0; k < ringCount; k += 1) {
    const at = (row * ringCount + k) * 3;
    mesh.positions.push3(grid[at], grid[at + 1], grid[at + 2]);
    mesh.normals.push3(normal[0], normal[1], normal[2]);
    mesh.colors.push3(colors[c], colors[c + 1], colors[c + 2]);
  }
  for (let k = 0; k < ringCount; k += 1) {
    const next = (k + 1) % ringCount;
    // Wound against the cap's own normal: the ring runs counter-clockwise seen from the far end of
    // the tube, so the start cap takes the rim backwards and the end cap takes it forwards.
    if (start) mesh.indices.push3(base, base + 1 + next, base + 1 + k);
    else mesh.indices.push3(base, base + 1 + k, base + 1 + next);
  }
}

function ringCentre(grid, ringCount, row) {
  const centre = [0, 0, 0];
  for (let k = 0; k < ringCount; k += 1) {
    const at = (row * ringCount + k) * 3;
    centre[0] += grid[at] / ringCount;
    centre[1] += grid[at + 1] / ringCount;
    centre[2] += grid[at + 2] / ringCount;
  }
  return centre;
}

/** Push the end control point out past the last alpha carbon, along the curve's own direction. */
function overhangInto(out, target, from, neighbour, centre, distance) {
  const direction = [0, 0, 0];
  if (!normalizeInto(
    direction,
    centre[0] - from[neighbour * 3],
    centre[1] - from[neighbour * 3 + 1],
    centre[2] - from[neighbour * 3 + 2],
  )) return;
  out[target * 3] = centre[0] + direction[0] * distance;
  out[target * 3 + 1] = centre[1] + direction[1] * distance;
  out[target * 3 + 2] = centre[2] + direction[2] * distance;
}

/**
 * Push an end row back along its own spine, so its cap sits inside whatever it meets there.
 *
 * `overhangInto()`'s sibling and deliberately not the same function: that one pushes a *terminus*
 * out past the last alpha carbon from the residue's own control point, and this one moves a row
 * that is already on the curve backwards along it. Same three lines of arithmetic, opposite
 * intent, and folding them together would need a signed distance and a base point argument that
 * every call site would have to get right.
 */
function backInto(points, row, neighbour, distance) {
  const direction = [0, 0, 0];
  const at = row * 3;
  if (!normalizeInto(
    direction,
    points[at] - points[neighbour * 3],
    points[at + 1] - points[neighbour * 3 + 1],
    points[at + 2] - points[neighbour * 3 + 2],
  )) return;
  points[at] += direction[0] * distance;
  points[at + 1] += direction[1] * distance;
  points[at + 2] += direction[2] * distance;
}

/*
  One set of grow-only scratch buffers for the whole sweep, because a structure is thousands of
  residues and each one would otherwise allocate four typed arrays it drops immediately.
  `curvePoints()` copies rather than aliasing `state.curvePoints`: the overhang writes into it, and
  trap 5's whole lesson is that writing into Mol*'s state is how one residue reaches another.
*/
class Scratch {
  constructor() {
    this.sample = new Float32Array(4);
    this.axisU = new Float32Array(3);
    this.axisV = new Float32Array(3);
    this.points = new Float32Array(0);
    this.gridBuffer = new Float32Array(0);
    this.tangentBuffer = new Float32Array(0);
    this.railBuffer = new Float32Array(0);
    this.axisUBuffer = new Float32Array(0);
    this.axisVBuffer = new Float32Array(0);
  }

  curvePoints(source, offset, segmentCount) {
    const need = (segmentCount + 1) * 3;
    if (this.points.length < need) this.points = new Float32Array(need);
    for (let index = 0; index < need; index += 1) this.points[index] = source[offset * 3 + index];
    return this.points;
  }

  grid(vertices) {
    if (this.gridBuffer.length < vertices * 3) this.gridBuffer = new Float32Array(vertices * 3);
    return this.gridBuffer;
  }

  tangents(vertices) {
    if (this.tangentBuffer.length < vertices * 3) this.tangentBuffer = new Float32Array(vertices * 3);
    return this.tangentBuffer;
  }

  /** Two rail centres per row. */
  rails(rows) {
    const need = rows * 2 * 3;
    if (this.railBuffer.length < need) this.railBuffer = new Float32Array(need);
    return this.railBuffer;
  }

  /** One cross-section frame per row: the width axis and the thickness axis. */
  axes(rows) {
    if (this.axisUBuffer.length < rows * 3) {
      this.axisUBuffer = new Float32Array(rows * 3);
      this.axisVBuffer = new Float32Array(rows * 3);
    }
    return { u: this.axisUBuffer, v: this.axisVBuffer };
  }
}

function finish(mesh) {
  return {
    positions: mesh.positions.toTyped(),
    normals: mesh.normals.toTyped(),
    colors: mesh.colors.toTyped(),
    indices: mesh.indices.toTyped(),
    beads: mesh.beads,
    rails: mesh.rails,
    helices: mesh.helices,
    bases: mesh.bases,
    basesSkipped: mesh.basesSkipped,
    residueCount: mesh.residueCount,
  };
}

const lerp = (a, b, t) => a + (b - a) * t;

function cross(out, ax, ay, az, bx, by, bz) {
  out[0] = ay * bz - az * by;
  out[1] = az * bx - ax * bz;
  out[2] = ax * by - ay * bx;
  return out;
}

/** Writes a unit vector and reports whether there was one to write. */
function normalizeInto(out, x, y, z) {
  const length = Math.hypot(x, y, z);
  if (!(length > 1e-9)) {
    out[0] = 0; out[1] = 0; out[2] = 0;
    return false;
  }
  out[0] = x / length;
  out[1] = y / length;
  out[2] = z / length;
  return true;
}
