/*
  Turn one parsed structure and one render request into the primitive arrays the path tracer
  consumes.

  **This is the atom half.** Spheres and cylinders come from `buildAtomStyle()`. Every swept
  representation -- every cartoon, ribbon and nucleic look -- is built by `geom/sweep.js` from three
  authored numbers per look (`geom/profiles-catalog.js`), reached through one `family === 'sweep'`
  branch rather than a per-representation dispatch. Bonds come from Mol*'s perception and the radius
  off the atom.

  **No request needs to carry a secondary-structure assignment.** It is computed from the one
  `Structure` in this process rather than read out of a document that might not have it, so there is
  nothing here to guard against a request that omits one. See `request-scene.js`.

  What is *not* here on purpose: a set of representation ids. A dispatch set in the scene builder
  is forbidden, so `representationFamily()` in `capabilities.js` is what `buildStyle()` branches
  on. Delete a row there and the geometry stops.
*/

import { isSideChainOrAlphaCarbon } from './residues.js';
// The product's per-id geometry defaults. Read rather than copied -- the radii must not live in
// two files, and `representationSettings()` below is the one place this scene builder resolves
// them.
import { representationSettingsForRepresentation } from './selection-model.js';
import {
  userGradient, sequenceFactors, hexToLinear,
  jmolElementColor, DEFAULT_ELEMENT_COLORS, CATEGORICAL_PALETTE,
  NUCLEIC_STRAND_PALETTE, NUCLEIC_BASE_COLORS, NUCLEIC_PART_COLORS,
  categoricalLookup, metricStops, piecewiseColor, normalizedRange, applyRange, rescaleWithin,
  nucleicBaseLabel, nucleicPartLabel, MISSING_COLOR,
} from './color.js';
import { loadMaterial } from './materials.js';
import { LIGHTING_SOURCE_PROFILES, DEFAULT_LIGHTING_SOURCE } from './lighting-compass.js';
import { buildPolymerSweep } from './geom/sweep.js';
import { FloatList, IndexList } from './geom/buffers.js';
import { lookFor, lookWithSettings } from './geom/profiles-catalog.js';
import { markerFor, buildMarkerMesh } from './geom/markers.js';
import { buildSurface, levelFor, levelWithSettings } from './geom/surface.js';
import {
  representationFamily, representationIsSideChainOnly, representationIsWholeResidue,
  colorModeImplemented, representationNote, bondIsDrawn,
} from './capabilities.js';
import { normalizeElementSymbol } from './color-defaults.js';
import { estimateStyle, budgetRefusal, budgetWarnings } from './scene-budget.js';

function residueInRanges(residue, ranges) {
  // A range is plain sequence ids, as `compressResidues()` and Mol*'s `pdbx_PDB_ins_code: ''` read it.
  if ((residue.insertionCode ?? '') !== '') return false;
  for (const range of ranges ?? []) {
    if (range.chain_id !== residue.chainId) continue;
    if (residue.residueId >= range.start && residue.residueId <= range.end) return true;
  }
  return false;
}


/*
  A layer names its residues in **two** fields and a reader that takes one of them drops the other.

  `compressResidues()` (`src/selection-model.js`) puts a residue with an insertion code into
  `residues` and every other residue into `residue_ranges`, because a range is a numeric span and an
  insertion code is not a number. Matching `residue_ranges` alone puts an insertion-coded residue
  in no layer at all: not drawn by the layer that named it and, because `claimed` is built from the
  same test, still drawn by the base style underneath -- visible, unstyled and unhideable. Both
  fields are OR'd, which is what selection resolution has to do. Antibodies are where it bites: an
  insertion code is how a CDR loop is numbered.
*/
function residueInLayer(residue, layer) {
  if (residueInRanges(residue, layer.residue_ranges)) return true;
  for (const named of layer.residues ?? []) {
    if (named.chain_id !== residue.chainId) continue;
    if (named.sequence_id !== residue.residueId) continue;
    if ((named.insertion_code ?? '') === (residue.insertionCode ?? '')) return true;
  }
  return false;
}

const AXIS_INDEX = { x_axis: 'x', y_axis: 'y', z_axis: 'z' };
// `nucleic_duplex` is deliberately absent: its factor is a PCA of the residue centres, not a
// sequence position, so it reaches `notes` rather than quietly rendering as the N-to-C ramp, which
// is what sharing this branch would do. That absence is one row in `capabilities.js`.
const GRADIENT_MODES = new Set(['sequence', 'x_axis', 'y_axis', 'z_axis']);

/**
 * Everything a colour mode reads that is *not* the style's own atoms.
 *
 * Three of the modes are only defined against the whole structure: `categoricalLookup` assigns the
 * palette by sorted-label position, so a chain's colour depends on which other chains exist;
 * B factors span the structure's own robust range; and the axis gradients normalise over every
 * imported coordinate before `rescaleWithin` re-spans them across the style's scope. Water is
 * dropped first, because letting a thousand waters set the x-axis range would flatten the ramp over
 * the molecule.
 *
 * **Water is dropped here even when it is drawn, and that is a decision.**
 * What a colour is measured *over* is a separate question from what is drawn, and the two answers
 * differ here for the reason `residues.js` records. Two consequences,
 * both stated rather than discovered: a water atom is not in `chainLabels`, so `chain` and `entity`
 * would fall to the component's uniform colour -- which is one of the reasons water offers uniform
 * and nothing else -- and an axis ramp measured over the molecule clamps on a water outside its
 * box, which is right.
 */
function buildColorSource(session) {
  const molecule = session.residues.filter((residue) => residue.component !== 'water');
  /*
    **A file that is nothing but water: then the water is the molecule.** Excluding water is about
    not letting a solvent box swamp the thing being looked at, which cannot happen when there is no
    other thing -- and measuring over an empty set is not a neutral no-op, it is `normalizedRange()`
    throwing "no finite values" and the whole scene failing to build. One `water=` query reaches
    this path.
  */
  const residues = molecule.length > 0 ? molecule : session.residues;
  /*
    One walk, five columns, and the columns are typed where they can be.

    Not seven passes over every atom in the structure -- a `flatMap` to collect them and then six
    `map`s, each allocating an array as long as the atom list: this runs on **every** scene build,
    which is every representation edit, every colour change and every Style apply. On 1AON (58,870
    atoms) the seven passes measured 14.0 ms and seven full-length arrays a build, of which the four
    `normalizedRange` inputs existed only to be reduced to two numbers each and then dropped.

    The two label columns stay plain arrays because `categoricalLookup` sorts their distinct values
    as strings; the three coordinate columns and the B factor become `Float64Array`, which is what
    `normalizedRange` wants to sort for its robust percentiles anyway.
  */
  let total = 0;
  for (const residue of residues) total += residue.atoms.length;
  const atoms = new Array(total);
  const chainLabels = new Array(total);
  const entityLabels = new Array(total);
  const bFactors = new Float64Array(total);
  const xs = new Float64Array(total);
  const ys = new Float64Array(total);
  const zs = new Float64Array(total);
  let at = 0;
  for (const residue of residues) {
    for (const atom of residue.atoms) {
      atoms[at] = atom;
      chainLabels[at] = atom.chainId;
      entityLabels[at] = atom.entityId ?? atom.chainId;
      bFactors[at] = atom.bFactor;
      xs[at] = atom.x;
      ys[at] = atom.y;
      zs[at] = atom.z;
      at += 1;
    }
  }
  return {
    atoms,
    /*
      One past the largest `atom.index` in the *whole* structure, which is not `atoms.length`.

      `atoms` above drops water, and `src/structure.js` numbers every atom it kept -- water
      included -- in `structure.units` order. So a protein atom's index can exceed the non-water
      count whenever a water sorts before it, and anything sizing a table by `atoms.length` would
      write that atom's entry off the end and read back `undefined`. Silently: a typed array's
      out-of-range write is a no-op and its read is `undefined`, so the colour would fall to the
      missing-data grey on exactly the structures that have waters in them.
    */
    indexBound: session.atoms.length,
    chainLabels,
    entityLabels,
    bFactorRange: normalizedRange(bFactors, { robust: true }),
    axisRanges: {
      x: normalizedRange(xs),
      y: normalizedRange(ys),
      z: normalizedRange(zs),
    },
    sequence: sequenceFactors(residues),
    plddt: session.plddt ?? null,
  };
}

/**
 * `buildColorSource()`, kept for as long as the structure it describes.
 *
 * Everything in it is a function of `session.residues` and `session.plddt` alone -- not of the
 * request, not of the style, not of a colour. So rebuilding it on every scene build would recompute
 * a constant: the chain labels of a structure do not change when somebody moves a radius slider.
 *
 * A `WeakMap` on the residue array rather than a field on the session, because the session object
 * is rebuilt per request while the residue array is the one `src/structure.js` produced and is the
 * thing the answer actually depends on. It also means the cache cannot outlive the structure: drop
 * the parse and this goes with it.
 */
const colorSources = new WeakMap();

function colorSourceFor(session) {
  const key = session.residues;
  const standing = colorSources.get(key);
  // `plddt` is the one input that is not the residue array, and a session carrying a different one
  // over the same residues is a different answer -- so it is compared rather than assumed.
  if (standing && standing.plddt === (session.plddt ?? null)) return standing;
  const built = buildColorSource(session);
  colorSources.set(key, built);
  return built;
}

/** The atom a per-residue colour is read at. */
function representativeAtom(residue) {
  return residue.byName?.get('CA') ?? residue.atoms[0];
}

/*
  A residue's B factor is the mean over its own atoms, because the *range* is measured over atoms.

  `buildColorSource()` normalises B factor across every atom in the structure, so a consumer that
  is handed no atom -- the polymer sweep, which is the only one (`scene.js`'s one
  `colorOf(residue)` call site) -- cannot be scored at one atom: that is one atom against a
  population it is not drawn from. The alpha carbon is systematically at the cold end of that
  population, a backbone being the ordered part of a residue, so a cartoon scored by it cannot
  reach the warm half of the ramp while the sphere pack and the surface beside it do. Fraction past
  the ramp's own midpoint -- every atom of every non-water residue, then protein residues by their
  CA and by their mean: 1H8P 19.4% / 10.2% / 17.0%, 1CLL 32.1% / 23.6% / 27.8%, 3RGK 23.4% / 14.1%
  / 20.1%.

  **The mean rather than the median**, which is the other statistic to reach for and tracks the
  backbone instead of the residue -- 15.9% / 25.7% / 14.8% on the same three, within a point of the
  CA on 3RGK. A side-chain-only mean overshoots the other way (25.0% / 35.4% / 32.9%). A range
  taken per layer is the third way out and is refused in `residueColorFactory()` below -- two
  layers of one structure have to be comparable.
*/
const residueBFactors = new WeakMap();
function residueBFactor(residue) {
  let mean = residueBFactors.get(residue);
  if (mean === undefined) {
    let total = 0;
    for (const atom of residue.atoms) total += atom.bFactor;
    mean = total / residue.atoms.length;
    residueBFactors.set(residue, mean);
  }
  return mean;
}

/** The sequence factor / the three axes, before `rescaleWithin` re-spans them. */
function positionalFactor(mode, source, atom, residue) {
  if (mode === 'sequence') return source.sequence.get(residue.key) ?? 0.5;
  return applyRange(atom[AXIS_INDEX[mode]], source.axisRanges[AXIS_INDEX[mode]]);
}

/**
 * Per style: a function from (residue, atom) to linear Rec.709.
 *
 * `scope` is the residues the style's whole component owns, which is what the positional gradients
 * are spread across: not the atoms this style paints, and not the whole structure. A style with no
 * opinion never reaches any of this.
 */
function residueColorFactory(style, residues, source, scope, notes = []) {
  const mode = style.color_mode ?? 'uniform';
  if (!colorModeImplemented(mode)) {
    notes.push(`colour mode "${mode}" is not implemented yet; rendered uniform`);
  }
  const overrides = style.color_overrides ?? null;
  const component = style.component ?? 'protein';
  const uniform = hexToLinear(style.color ?? '#58BFA8');

  if (GRADIENT_MODES.has(mode)) {
    /*
      One gradient call for the whole style: the Oklch stops are derived per call, and the ramp is
      only correct if every atom is placed on the same one.

      **Indexed by the atom's own `index`, not by a wrapper object.** Not
      `residues.flatMap((r) => r.atoms.map((atom) => ({ atom, residue })))` -- one fresh object per
      atom, walked twice more, then a `Map` keyed on the atom carrying a fresh three-element array
      per atom. On 1AON that is four allocations per atom and measured **20.3 ms per style per
      build** against 459 ms for the whole cartoon build, all of it to remember which residue an
      atom came from and where its colour landed.

      `atom.index` is that answer already: `src/structure.js` numbers every atom in `structure.units`
      order and re-numbers after the conformer filter, so it is a dense key into a flat table. The
      table is one `Float32Array` and the lookup is three reads.
    */
    /*
      **`Float64Array`, and that is byte-identity rather than taste.** `userGradient()` is handed
      `Float32Array.from(spread)`, so the factor is rounded to float32 exactly once, at that call.
      Holding the factors at float32 through `rescaleWithin()` would round once on the way in and
      again on the way out, and the second rounding lands on a colour the recorded pictures are
      compared against byte for byte.
    */
    let drawn = 0;
    for (const residue of residues) drawn += residue.atoms.length;
    const raw = new Float64Array(drawn);
    // Which slot of `raw` each atom took, so the finished colour can be found again by atom index.
    // -1 is "this style does not paint that atom", which is what the missing colour answers.
    const slotOf = new Int32Array(source.indexBound).fill(-1);
    let at = 0;
    for (const residue of residues) {
      for (const atom of residue.atoms) {
        raw[at] = positionalFactor(mode, source, atom, residue);
        slotOf[atom.index] = at;
        at += 1;
      }
    }
    let scopeCount = 0;
    for (const residue of scope) scopeCount += residue.atoms.length;
    const scopeFactors = new Float64Array(scopeCount);
    let scopeAt = 0;
    for (const residue of scope) {
      for (const atom of residue.atoms) {
        scopeFactors[scopeAt] = positionalFactor(mode, source, atom, residue);
        scopeAt += 1;
      }
    }
    const spread = scopeCount ? rescaleWithin(raw, scopeFactors) : raw;
    const table = userGradient(
      Float32Array.from(spread),
      style.gradient_start ?? '#000000',
      style.gradient_end ?? '#FFFFFF',
      style.gradient_midpoints ?? [],
    );
    const missing = hexToLinear(MISSING_COLOR);
    /*
      The returned colour is a fresh array per call rather than a shared one, because every caller
      keeps it: `pushSphere` and the sweep both read it after the next call has been made.
    */
    return (residue, atom) => {
      const from = atom ?? representativeAtom(residue);
      const slot = from === undefined ? -1 : slotOf[from.index] ?? -1;
      if (slot < 0) return missing;
      return [table[slot * 3], table[slot * 3 + 1], table[slot * 3 + 2]];
    };
  }

  if (mode === 'element') {
    // Three layers, narrowest first: the user's own override, then the product's fifteen authored
    // colours, then Mol*'s Jmol table for everything else. `color.js` says why the third is not a
    // local table.
    const table = { ...DEFAULT_ELEMENT_COLORS };
    for (const [label, hex] of Object.entries(overrides ?? {})) table[String(label).toUpperCase()] = hex;
    const cache = new Map();
    return (residue, atom) => {
      // D and T fold to H, or a deuterium ignores the only hydrogen swatch the grid offers.
      const element = normalizeElementSymbol((atom ?? representativeAtom(residue))?.element ?? 'C');
      if (!cache.has(element)) {
        const hex = table[element] ?? jmolElementColor(element);
        cache.set(element, hex ? hexToLinear(hex) : uniform);
      }
      return cache.get(element);
    };
  }

  if (mode === 'chain' || mode === 'entity') {
    // Nucleic strands get their own wheel so a duplex beside a protein never borrows the protein
    // chain colours. `entity` takes no overrides.
    const labels = mode === 'chain' ? source.chainLabels : source.entityLabels;
    const palette = mode === 'chain' && component === 'nucleic'
      ? NUCLEIC_STRAND_PALETTE : CATEGORICAL_PALETTE;
    const lookup = categoricalLookup(labels, mode === 'chain' ? overrides : null, null, palette);
    return (residue, atom) => {
      const from = atom ?? representativeAtom(residue);
      const label = mode === 'chain' ? from.chainId : (from.entityId ?? from.chainId);
      return lookup.get(label) ?? uniform;
    };
  }

  if (mode === 'nucleic_base' || mode === 'nucleic_part') {
    const isBase = mode === 'nucleic_base';
    const labels = isBase
      ? residues.map((residue) => nucleicBaseLabel(residue.name))
      : residues.flatMap((residue) => residue.atoms.map((atom) => nucleicPartLabel(atom.name)));
    const lookup = categoricalLookup(
      labels, overrides, isBase ? NUCLEIC_BASE_COLORS : NUCLEIC_PART_COLORS,
    );
    return (residue, atom) => lookup.get(
      isBase ? nucleicBaseLabel(residue.name) : nucleicPartLabel((atom ?? representativeAtom(residue)).name),
    ) ?? uniform;
  }

  if (mode === 'bfactor' || mode === 'plddt') {
    // Data-valued ramps ignore the scope on purpose: pLDDT reads an absolute 0-100 scale, and
    // rescaling B factor per layer would make two layers of the same structure incomparable.
    const stops = metricStops(mode, overrides);
    const cache = new Map();
    const value = mode === 'bfactor'
      // No atom is the sweep asking about a whole residue, and the answer is the residue's own
      // mean: see `residueBFactor()`. pLDDT is stored per residue already and ignores the atom.
      ? (residue, atom) => applyRange(atom ? atom.bFactor : residueBFactor(residue), source.bFactorRange)
      : (residue) => source.plddt?.get(`${residue.atoms[0].labelChainId}|${residue.labelSeqId}`) ?? NaN;
    return (residue, atom) => {
      const raw = value(residue, atom);
      const key = Number.isFinite(raw) ? Math.round(raw * 4096) : 'missing';
      if (!cache.has(key)) cache.set(key, piecewiseColor(raw, stops));
      return cache.get(key);
    };
  }

  return () => uniform;
}

/**
 * A triangle mesh, into the flat buffers `pathtrace.wgsl` reads.
 *
 * The vertex stride is three `vec4f` -- position, normal, colour -- and `intersectTriangle`
 * barycentric-interpolates the second and third, so nothing here needs a per-face anything. The
 * fourth component of each is padding the shader never reads.
 *
 * **This is where a Mol* `Mesh` would arrive too, and it would not arrive through this function.**
 * A `Mesh`'s `groupBuffer` means the atom index within the unit for a
 * surface and the trace-element index for the polymer trace, so the group-to-colour step is
 * per-builder. Our own sweep assigns the colour itself and has no group to resolve, which is why
 * this takes `colors` and not a group buffer.
 */
function appendMesh(out, mesh, material) {
  const base = out.vertexCount;
  const vertices = mesh.positions.length / 3;
  /*
    Reserved up front and written by index, rather than pushed a vertex at a time.

    Pushed, this is the single most expensive function in a scene build -- 22.3% of 1AON's cartoon
    on a `--cpu-prof` over four builds, ahead of every piece of geometry arithmetic in the tree --
    because it is one call per vertex over a mesh that can be a million of them, into a list that
    reallocates as it goes. Every builder upstream hands over typed arrays (`geom/buffers.js`), so
    the size is known before the first write and the copy is a straight indexed one.
  */
  out.vertices.reserve(vertices * 12);
  const target = out.vertices.data;
  let at = out.vertices.length;
  for (let index = 0; index < vertices; index += 1) {
    const from = index * 3;
    target[at] = mesh.positions[from];
    target[at + 1] = mesh.positions[from + 1];
    target[at + 2] = mesh.positions[from + 2];
    target[at + 3] = 0;
    target[at + 4] = mesh.normals[from];
    target[at + 5] = mesh.normals[from + 1];
    target[at + 6] = mesh.normals[from + 2];
    target[at + 7] = 0;
    target[at + 8] = mesh.colors[from];
    target[at + 9] = mesh.colors[from + 1];
    target[at + 10] = mesh.colors[from + 2];
    target[at + 11] = 0;
    at += 12;
  }
  out.vertices.length = at;
  out.vertexCount += vertices;
  const triangles = mesh.indices.length / 3;
  out.triangles.reserve(triangles * 4);
  const faces = out.triangles.data;
  let face = out.triangles.length;
  for (let index = 0; index < mesh.indices.length; index += 3) {
    faces[face] = base + mesh.indices[index];
    faces[face + 1] = base + mesh.indices[index + 1];
    faces[face + 2] = base + mesh.indices[index + 2];
    faces[face + 3] = material;
    face += 4;
  }
  out.triangles.length = face;
}

/**
 * The polymer sweep: every cartoon, ribbon and nucleic look.
 *
 * One branch, because there is one builder. Which look it sweeps with is
 * `geom/profiles-catalog.js`'s answer, keyed by the representation id -- so this function names no
 * representation and adds no dispatch set.
 *
 * The beads are the sweep's lone-residue case and they come back as **analytic spheres** rather
 * than as triangles, so a one-residue polymer element is exact at any zoom like every other sphere
 * in the picture.
 *
 * The rails are the other analytic half: a look that authors one (`geom/profiles-catalog.js`) edges
 * its panel with a capsule chain rather than widening the cross-section, so a railed cartoon adds
 * primitives here and not one triangle. They take the sweep's own per-residue colour and the same
 * material as the panel, which is what keeps a rail from reading as a second object under a colour
 * mode, a selection layer or an alpha below one.
 *
 * The helices are the third, and the only one that *replaces* triangles rather than adding to them:
 * a look naming `helixRod` does not sweep its helices at all, so `cartoon_geometric` arrives here
 * with a capsule chain in place of a swept tube. Same two arrays, same colours, same material,
 * and the same reason -- analytic beats tessellated, which matters most here because the feature
 * the look is read by is the flat cap's *rim* and a swept one is a polygon.
 */
async function buildSweepStyle(out, session, residues, colorOf, material, representation, notes, hidden, look) {
  if (!look) {
    notes.push(`${representation}: not drawn, no cross-section defined`);
    return;
  }
  const mesh = await buildPolymerSweep({
    structure: session.structure,
    model: session.model,
    residues,
    look,
    colorOf: (residue) => colorOf(residue),
    hidden,
  });
  appendMesh(out, mesh, material);
  for (const bead of mesh.beads) {
    pushSphere(out, [bead.x, bead.y, bead.z], bead.radius, bead.color, material);
  }
  for (const joint of mesh.rails.joints) {
    pushSphere(out, joint.p, joint.radius, joint.color, material);
  }
  for (const rod of mesh.rails.rods) {
    pushCylinder(out, rod.a, rod.b, rod.radius, rod.color, material, rod.radiusB);
  }
  for (const joint of mesh.helices.joints) {
    pushSphere(out, joint.p, joint.radius, joint.color, material);
  }
  for (const rod of mesh.helices.rods) {
    pushCylinder(out, rod.a, rod.b, rod.radius, rod.color, material, rod.radiusB);
  }
  // The bases are the fourth: a flat-shaded solid per nucleotide, already in the mesh above, plus
  // one analytic capsule per base joining it to the spine. Same two arrays and the same reason.
  for (const joint of mesh.bases.joints) {
    pushSphere(out, joint.p, joint.radius, joint.color, material);
  }
  for (const rod of mesh.bases.rods) {
    pushCylinder(out, rod.a, rod.b, rod.radius, rod.color, material, rod.radiusB);
  }
  /*
    The one place a sweep refuses per residue rather than per representation. A base whose ring
    Mol* cannot complete is not drawn -- geometry that cannot be built produces a note, never a
    quiet fallback -- and a base silently absent from a duplex
    is exactly the kind of hole that reads as a modelling error rather than as a refusal.
  */
  if (mesh.basesSkipped > 0) {
    const bases = mesh.basesSkipped === 1 ? '1 base' : `${mesh.basesSkipped} bases`;
    notes.push(`${representation}: ${bases} not drawn (ring atoms missing from the file)`);
  }
  if (mesh.residueCount === 0) {
    notes.push(`${representation}: nothing drawn, no residues here are on a polymer chain`);
  }
}

function pushSphere(out, position, radius, colour, material) {
  out.spheres.push4(position[0], position[1], position[2], radius);
  out.sphereAttributes.push4(colour[0], colour[1], colour[2], material);
}
/*
  The eighth float is the **radius at `b`**, so a cylinder is the `radiusB === radius` case of a
  cone: `geom/rails.js`'s `pushRod()` is why a tapering capsule chain needs one, and
  `render/pathtrace.wgsl`'s `intersectCylinder()` is the intersection. It defaults to `radius`, so a
  bond, a rim and every other plain tube says nothing about it.
*/
function pushCylinder(out, a, b, radius, colour, material, radiusB = radius) {
  out.cylinders.push8(a[0], a[1], a[2], radius, b[0], b[1], b[2], radiusB);
  out.cylinderAttributes.push4(colour[0], colour[1], colour[2], material);
}

// Keyed by the material *and* the two runtime style tunables that live on it -- emission strength
// and opacity -- not by the material alone: both are per style, so two styles can name
// `bioluminescent` and mean two different brightnesses, or name `ceramic` and mean 1.0 and 0.5.
// Sharing one slot would silently give both the first one's value, which for opacity renders one
// half of a composition at the other's alpha and looks like a colour mistake.
async function materialIndex(out, id, style) {
  const material = await loadMaterial(id, style);
  const key = `${id}@${material.emissionStrength}@${material.alpha}`;
  if (out.materialIds.has(key)) return out.materialIds.get(key);
  const index = out.materials.length;
  out.materials.push(material);
  out.materialIds.set(key, index);
  return index;
}

/*
  A style's geometry settings, resolved once: the user's value, then the **product's authored
  default for this id**, and only then the family constant at the call site.

  Without the middle term there is a visible gap rather than a tidiness one. `sphere_radius` is a
  factor on the van der Waals radius, so the family fallback of 1.0 draws every spheres look at
  full vdW where the product authors 0.65 -- half again too large, and at 1.0 a heme fuses into an
  unreadable white blob. It reaches every look the ligand and ion pickers can ask for.

  **The table is `src/selection-model.js`'s and is read rather than copied.** The per-id radii must
  not live in two files; a second copy here is how the two drift, and that divergence having
  happened once is why the rule is written down.

  **Applied whole rather than field by field.** `show_hydrogens` comes with the radii -- authored
  `false` for the three `sticks` ids and `true` for the ball and sphere families -- because half a
  table is the same divergence one edit later. No structure bundled in this repository carries a
  hydrogen, so today that term changes nothing it can be measured on; it is right rather than
  observable, which is worth saying plainly.

  An explicit `undefined` in a style is not a value and must not shadow the default: a validated
  settings object never carries one, but a hand-built request can, and it would silently reinstate
  the very fallback this exists to remove.
*/
function representationSettings(style, representation) {
  const authored = representationSettingsForRepresentation(representation) ?? {};
  const chosen = Object.entries(style.representation_settings ?? {})
    .filter(([, value]) => value !== undefined);
  return { ...authored, ...Object.fromEntries(chosen) };
}

/**
 * Which atoms a style draws, as `index -> { atom, residue }`.
 *
 * **One answer to that question, shared by every builder that needs it.** The two filters -- side
 * chains only, and hidden hydrogens -- are properties of the *style*, not of the family, so a
 * second copy of them beside a new builder is a second answer waiting to disagree. The surface
 * needs the same set as the spheres for a reason the sphere builder does not have: a field is not
 * per atom, so it cannot be filtered afterwards. A hydrogen left in the atom list is a hydrogen in
 * the field and roughly an angstrom of extra surface, with nothing to point at afterwards.
 */
function drawnAtoms(style, residues, representation) {
  const settings = representationSettings(style, representation);
  const sideChainOnly = representationIsSideChainOnly(representation);
  // One solid per residue (`water_dots`), and the atom it stands on is the first non-hydrogen --
  // the oxygen on a water. A residue that is hydrogens only keeps its first atom rather than
  // vanishing, because a residue nobody drew is a refusal and this is not one.
  const wholeResidue = representationIsWholeResidue(representation);
  const drawn = new Map();
  for (const residue of residues) {
    if (wholeResidue) {
      const heavy = residue.atoms.find(
        (atom) => normalizeElementSymbol(atom.element) !== 'H',
      ) ?? residue.atoms[0];
      if (heavy) drawn.set(heavy.index, { atom: heavy, residue });
      continue;
    }
    for (const atom of residue.atoms) {
      if (sideChainOnly && !isSideChainOrAlphaCarbon(atom, residue.component)) continue;
      // D and T through `normalizeElementSymbol`: a neutron structure's deuteriums are hydrogens,
      // a raw `=== 'H'` here would be the one place in the app that disagreed.
      if (normalizeElementSymbol(atom.element) === 'H' && settings.show_hydrogens === false) continue;
      drawn.set(atom.index, { atom, residue });
    }
  }
  return drawn;
}

/**
 * The molecular surface: one scalar field over the atoms this style owns, one isosurface, one mesh.
 *
 * One branch, because there is one builder and four detail levels are a table
 * (`geom/surface.js`). Which rung it is on is `levelFor(representation)`'s answer, so this function
 * names no representation and adds no dispatch set -- the same rule the sweep branch above follows.
 *
 * **Nothing analytic comes back.** A surface is the one family in this renderer that is triangles
 * and only triangles: there is no sphere, capsule or rod to fall out of a marching cubes grid, so
 * "analytic beats tessellated" has nothing to beat here.
 *
 * The two things it can report are both refusals rather than approximations: a style whose atoms
 * produce no isosurface at all, and a vertex the field could not attribute to an atom. The second
 * has never been seen on a real structure and is counted rather than assumed away, because the
 * alternative is a patch of the wrong colour that reads as a colour-mode bug.
 */
async function buildSurfaceStyle(out, session, style, colorOf, material, representation, notes, look, drawnMap) {
  if (!look) {
    notes.push(`${representation}: not drawn, no detail level defined`);
    return;
  }
  const drawn = [...drawnMap.values()];
  const built = await buildSurface({
    structure: session.structure,
    drawn,
    look,
    colorOf,
    fallbackColor: hexToLinear(style.color ?? '#58BFA8'),
  });
  if (built.indices.length === 0) {
    const atoms = drawn.length === 1 ? '1 atom' : `${drawn.length} atoms`;
    notes.push(`${representation}: no surface formed from ${atoms} at this detail level`);
    return;
  }
  appendMesh(out, built, material);
  if (built.ungrouped > 0) {
    const vertices = built.ungrouped === 1 ? '1 vertex' : `${built.ungrouped} vertices`;
    notes.push(`${representation}: ${vertices} matched no atom and use the style colour`);
  }
  // The builder's own numbers, kept beside the geometry rather than printed: a scene total folds in
  // whatever else is on the page and cannot answer "what did this surface cost".
  out.surfaces.push({ representation, ...built.stats });
}

/**
 * Spheres and capped cylinders, from the atoms and Mol*'s bonds.
 *
 * **Bonds are filtered, never re-perceived.** `session.bonds` is every bond Mol* found, once each,
 * as indices into the flat atom array (`structure.js`). A style draws a subset of the atoms -- side
 * chains only, or hydrogens hidden -- so a bond is drawn when *both* of its ends are in that
 * subset. A distance search over the filtered atom list would be a second answer to "what is
 * bonded to what", and it gives a different one at every altloc and every hidden-hydrogen
 * boundary.
 *
 * The second filter is by **type**, and it is `capabilities.js`'s table rather than a set here: a
 * hydrogen bond is enumerated and is not a stick. Same rule as the representations -- one table,
 * and the scene builder holds no list of its own.
 *
 * **A bond is a capsule, so every joint carries a sphere.** The tracer's cylinders are flat-capped,
 * and without one a bend is a chisel and a free end is a sawn-off tube. The two blocks at the
 * bottom of this function are that, and the cylinder count it costs.
 */
function buildAtomStyle(out, style, residues, colorOf, material, representation, bonds, notes, drawn) {
  const family = representationFamily(representation);
  const settings = representationSettings(style, representation);

  /*
    A look that asks for hydrogens and finds none drew a different picture than the one asked for,
    and the file is the reason -- so it is a note rather than a silence. Hydrogens are off in every
    authored row, so this is reachable only by the checkbox in a component's
    advanced settings, which is exactly the case where somebody has asked a question and deserves
    the answer.
  */
  if (settings.show_hydrogens === true) {
    let hydrogens = 0;
    for (const { atom } of drawn.values()) {
      if (normalizeElementSymbol(atom.element) === 'H') hydrogens += 1;
    }
    if (hydrogens === 0) {
      notes?.push(`${representation}: no hydrogens in this file, heavy atoms only`);
    }
  }

  // `sphere_radius` is a *factor* on the van der Waals radius, not a length: ball-and-stick's 0.29
  // is 0.49 A on carbon against a 0.2 A bond, which is the ratio that reads as balls on sticks.
  if (family === 'spheres') {
    const scale = settings.sphere_radius ?? 1.0;
    for (const { atom, residue } of drawn.values()) {
      pushSphere(out, [atom.x, atom.y, atom.z], atom.vdwRadius * scale, colorOf(residue, atom), material);
    }
    return;
  }

  /*
    The ion markers, and the early return is load-bearing.

    A faceted solid at the same radius the sphere would have used, so the two ion looks are the same
    size and switching between them changes the shading and nothing else (`geom/markers.js`). It
    reuses the `drawn` map above rather than filtering again, which is what keeps "which atoms does
    this style draw" a question with one answer.

    **This must return before the bond path**, which is why it sits here beside `spheres` rather
    than at the bottom of the function. Everything below is two unconditional passes -- a cylinder
    per bond, then a sphere at every atom a drawn bond reaches -- so a marker family that fell
    through would draw its ion as sticks *and* joint spheres. That is a plausible picture of a
    different representation, which is the failure this whole product class dies of.
  */
  if (family === 'marker') {
    const solid = markerFor(representation);
    if (!solid) {
      notes?.push(`${representation}: not drawn, no marker shape defined`);
      return;
    }
    const scale = settings.sphere_radius ?? 1.0;
    const markers = [...drawn.values()].map(({ atom, residue }) => ({
      position: [atom.x, atom.y, atom.z],
      radius: atom.vdwRadius * scale,
      color: colorOf(residue, atom),
    }));
    appendMesh(out, buildMarkerMesh(solid, markers), material);
    return;
  }

  const sphereScale = settings.sphere_radius ?? 0.29;
  // Bond radius is a real length: a cylinder has no van der Waals radius to scale.
  const bondRadius = settings.bond_radius ?? settings.stick_radius ?? 0.2;

  /*
    One cylinder per bond, and two only where the two ends disagree about the colour.

    The split at the midpoint exists so each half can take its own atom's colour. Where there is one
    colour it buys nothing and costs a primitive, and that is most of them. **Every count below is
    3RGK's protein base style alone**, which is the builder's own number rather than a scene total:
    on its 1,184 drawn bonds, uniform and by-chain sticks fall 2,368 -> 1,184 cylinders, by-sequence
    to 1,332 and by-element to 1,782. Against the 1,159 joint spheres below, the split and the joints
    together are **-1.1% of primitives by chain or uniform, +5.2% by sequence and +24.2% by
    element**.

    Quote the builder's number and never a scene total. A scene total folds in whatever the ligand,
    ion and nucleic styles happen to be drawing, so it moves when *they* change and the figure reads
    as though this builder had.

    **The consequence to know before it reads as a bug: the primitive count depends on the colour
    mode.** The same structure at the same representation builds a different number of
    cylinders by chain than by element, so it builds a different BVH -- a byte-identity baseline is
    per colour mode, and changing a colour can move the picture by more than its colour.
  */
  const bonded = new Set();
  for (let edge = 0; edge < bonds.count; edge += 1) {
    if (!bondIsDrawn(bonds.flags[edge])) continue;
    const first = drawn.get(bonds.a[edge]);
    const second = drawn.get(bonds.b[edge]);
    if (!first || !second) continue;
    bonded.add(bonds.a[edge]);
    bonded.add(bonds.b[edge]);
    const a = first.atom;
    const b = second.atom;
    const here = colorOf(first.residue, a);
    const there = colorOf(second.residue, b);
    if (here[0] === there[0] && here[1] === there[1] && here[2] === there[2]) {
      pushCylinder(out, [a.x, a.y, a.z], [b.x, b.y, b.z], bondRadius, here, material);
      continue;
    }
    const midpoint = [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2];
    pushCylinder(out, [a.x, a.y, a.z], midpoint, bondRadius, here, material);
    pushCylinder(out, midpoint, [b.x, b.y, b.z], bondRadius, there, material);
  }

  /*
    Bonds are the whole of a stick look, so a style whose atoms have none between them drew an empty
    picture -- an ion layer asked for as sticks is the reachable case. Stated, because an empty
    scene and a scene nobody asked about look identical from here.
  */
  if (family === 'sticks' && bonded.size === 0 && drawn.size > 0) {
    notes?.push(`${representation}: nothing drawn, these residues have no bonds`);
  }

  /*
    A sphere at every atom a drawn bond reaches, and it is the whole of a stick's end and bend.

    The tracer's cylinders are flat-capped, so without it a bond ends in a disc through the atom
    centre. At a **bend** the two discs meet at an angle and the outside of the corner is cut back
    to the atom itself -- the missing material is a full bond radius deep, at every one of 3RGK's
    826 bends (median bond angle 116 degrees, minimum 100.7), and it renders as a chisel. At a
    **free end** -- 333 of them on the same structure -- the disc is the end, and it reads as a
    tube someone sawed off. Both counts are the protein base style's, as above.

    A sphere of the stick's own radius fixes both at once, and it is the same shape rather than an
    approximation of it: a stick is a swept sphere, so a bond is a capsule, and a capsule is a
    cylinder plus a sphere at each end. At an atom where n bonds meet, those n end spheres are the
    same sphere, so one serves all of them. The radii being equal is what makes it seamless -- the
    cylinder's lateral surface is tangent to the sphere along exactly the cap circle, with both
    normals radial there, so the union is smooth in silhouette *and* in shading with no blend, no
    fillet and no second surface anywhere.

    `geom/rails.js` already works this way for the same reason: the tracer's cylinders are
    flat-capped, and a rail built of rods alone creases at every joint. A stick is the same
    argument at a different scale.

    **A bend and a free end are two decisions, and only the first one follows from that.** The
    tangency argument says a *joint* must be filled; it says nothing about what a stick that stops
    should look like, and `emitCapsuleChain()` in `geom/rails.js` keeps `roundStart`/`roundEnd`
    separate for exactly this reason. Here they are both round, and the second half is art
    direction settled by eye rather than derived: the sticks end in domes, and one sphere per
    bonded atom is what draws both. A flat-ended stick is a different
    look and would need the terminus separated back out.

    **The radius is the larger of the ball and the stick**, so a joint is never narrower than the
    stick that meets it. For `sticks` there is no ball and it is the stick radius; for
    `ball_and_stick` the ball is normally the wider of the two (0.49 A on carbon against 0.20) and
    nothing moves, but a style that shrinks `sphere_radius` below the bond radius gets a rounded
    joint rather than a notch. An atom **no drawn bond reaches** keeps only its
    ball, so `sticks` still draws nothing for an unbonded atom -- which is a separate question and
    is deliberately left open.
  */
  for (const [index, { atom, residue }] of drawn) {
    const ball = family === 'ball_and_stick' ? atom.vdwRadius * sphereScale : 0;
    const radius = bonded.has(index) ? Math.max(ball, bondRadius) : ball;
    if (radius <= 0) continue;
    pushSphere(out, [atom.x, atom.y, atom.z], radius, colorOf(residue, atom), material);
  }
}

/*
  What a style draws and what it will cost, settled before anything is built, so the estimate and
  the build read one answer: the same look, the same atoms.
*/
function planStyle(session, style, residues) {
  const representation = style.representation;
  const family = representationFamily(representation);
  if (!residues.length || !family) return { representation, family };
  const settings = representationSettings(style, representation);
  let look = null;
  let drawn = null;
  if (family === 'sweep') {
    /*
      The user's numbers over the authored ones.

      `lookWithSettings()` returns the authored look **by identity** when nothing was said or when
      every field is still its own default, so a request carrying no `representation_settings`
      builds from the authored object itself. That is the property the 87 recorded pictures rest
      on, and it is asserted on every look rather than left as a claim.
    */
    const authored = lookFor(representation);
    look = authored ? lookWithSettings(authored, settings) : null;
  } else if (family === 'surface') {
    // The user's numbers over the rung's, identity when nothing was said, as above.
    const authored = levelFor(representation);
    look = authored ? levelWithSettings(authored, settings) : null;
    drawn = drawnAtoms(style, residues, representation);
  } else {
    drawn = drawnAtoms(style, residues, representation);
  }
  const estimate = (family === 'sweep' || family === 'surface') && !look ? null : estimateStyle({
    representation, look, residues, drawn,
    bonds: session.bonds, secondaryStructure: session.secondaryStructure,
  });
  return { representation, family, look, drawn, estimate };
}

function primitiveCount(out) {
  return out.spheres.length / 4 + out.cylinders.length / 8 + out.triangles.length / 4;
}

/**
 * One style, drawn -- or refused by name.
 *
 * Geometry that cannot be built produces a note, never a quiet fallback to something else -- a
 * representation drawn as a different representation is the failure mode this whole product class
 * dies of. So a representation with no family in `capabilities.js` reaches `notes` and draws
 * nothing, and the note carries that id's own sentence when the table has one.
 */
async function buildStyle(out, session, job, source, bonds, notes, hidden = []) {
  const { style, residues, scope, plan } = job;
  if (!residues.length) return;
  const { representation, family } = plan;
  if (!family) {
    const detail = representationNote(representation);
    notes.push(`representation "${representation}" is not built yet${detail ? `: ${detail}` : ''}`);
    return;
  }
  // A build the tracer would refuse once it was finished is not started.
  const refusal = budgetRefusal(plan.estimate, primitiveCount(out), representation);
  if (refusal) {
    notes.push(refusal);
    out.refusals.push(refusal);
    return;
  }
  const material = await materialIndex(out, style.material ?? 'diffuse', style);
  const colorOf = residueColorFactory(style, residues, source, scope, notes);
  if (family === 'sweep') {
    await buildSweepStyle(out, session, residues, colorOf, material, representation, notes, hidden, plan.look);
    return;
  }
  if (family === 'surface') {
    await buildSurfaceStyle(out, session, style, colorOf, material, representation, notes, plan.look, plan.drawn);
    return;
  }
  buildAtomStyle(out, style, residues, colorOf, material, representation, bonds, notes, plan.drawn);
}

/**
 * Every style the request draws, in build order, each with what it will draw and its estimated
 * cost -- the whole scene, planned and nothing built.
 */
export function planScene(session) {
  const request = session.request;
  const componentResidues = (component) => session.residues.filter(
    (residue) => residue.component === component,
  );

  /*
    **Hiding beats every other layer, and that is what makes the result order-independent.**

    Two sets, built from the same walk. `claimed` is every residue any layer names, hidden or not,
    and it is what the four base styles subtract -- so a hidden region is not drawn by the base and
    a styled region is not drawn twice. `hidden` is the residues a *hidden* layer names, and it is
    subtracted again from every visible layer below.

    Without the second subtraction the disagreement is silent: `preview-canvas.js` applies hidden
    layers **last**, so the preview hides the overlap and the trace still draws it. The most
    reachable case is a Style, whose overlay passes are whole-component and land after the user's
    own layers -- so applying any Style over a hidden region brings it back in the render and
    nowhere else. The rule this keeps is that hiding beats every other layer, so the
    result does not depend on the order the layers happen to be in. Doing it by subtraction rather
    than by ordering is what makes that true of this renderer too.
  */
  const layers = (request.selection_layers ?? []).filter((layer) => !layer.hidden);
  const claimed = new Set();
  const hiddenResidues = new Set();
  for (const layer of request.selection_layers ?? []) {
    for (const residue of session.residues) {
      if (residue.component !== (layer.component_type ?? 'protein')) continue;
      if (!residueInLayer(residue, layer)) continue;
      claimed.add(residue.key);
      if (layer.hidden) hiddenResidues.add(residue.key);
    }
  }
  // Nobody draws these, so a swept residue beside one ends there as at a chain end.
  const hidden = session.residues.filter((residue) => hiddenResidues.has(residue.key));

  // A base style's positional gradients span its whole component, layers included, while a layer is
  // its own scope -- which is what lets one stretch of chain carry the whole ramp by itself.
  const proteinResidues = componentResidues('protein');
  const baseResidues = proteinResidues.filter((residue) => !claimed.has(residue.key));
  // Every style first, in build order, so the whole scene is estimated before any of it is built.
  const jobs = [];
  jobs.push({ style: {
    component: 'protein',
    representation: request.representation,
    material: request.material,
    color_mode: request.color_mode,
    color: request.color,
    // The base protein style is the one style assembled field by field rather than spread from the
    // request, so every tunable it carries has to be named here. Selection layers and the three
    // component styles reach `buildStyle()` as `{ component, ...layer }` and carry theirs for free.
    // Leave `opacity` out and the base protein renders solid while a layer at the same opacity is
    // translucent.
    opacity: request.opacity,
    emission_strength: request.emission_strength,
    color_overrides: request.color_overrides,
    gradient_start: request.gradient_start,
    gradient_end: request.gradient_end,
    gradient_midpoints: request.gradient_midpoints,
    /*
      **Not `cartoon_settings`**: nothing acts on it. No builder here asks for it, `main.js`
      deletes it out of every request it builds, `session-format.js` drops it on import with a
      reason, and `style-overlays.js` lists it among the fields a Style may not write. Forwarding it
      here would suggest an opinion no builder holds.
    */
    representation_settings: request.representation_settings,
  },
  residues: baseResidues,
  scope: proteinResidues });

  for (const layer of layers) {
    const component = layer.component_type ?? 'protein';
    const residues = session.residues.filter(
      (residue) => residue.component === component
        && residueInLayer(residue, layer)
        && !hiddenResidues.has(residue.key),
    );
    jobs.push({ style: { component, ...layer }, residues, scope: residues });
  }

  for (const [component, key] of [
    ['nucleic', 'nucleic_style'], ['ligand', 'ligand_style'], ['ion', 'ion_style'],
    // Water's `enabled` defaults false, so a request that says nothing
    // draws no water and every recorded picture stands; a **layer** naming water draws whatever the
    // component's own switch says, because the layer loop above never reads `enabled` -- which is
    // what makes "hide all water, show this one" two ordinary controls rather than a new mechanism.
    ['water', 'water_style'],
  ]) {
    const style = request[key];
    if (!style?.enabled) continue;
    /*
      **`hide_polyatomic_ions` narrows the component before anything else reads it.**

      SO4, PO4, CO3, NO3, ACT and BF4 are ligands here -- `residues.js` classifies an `ion` as a
      name Mol* calls an ion *and* a residue with one atom in it, which is what keeps a sulfate off
      the marker path. They are also, very often, crystallisation buffer rather than the subject:
      3RGK's ligand component is one heme and three sulfates, and the sulfates are scattered away
      from it.

      It narrows `all` as well as `residues`, and that is the load-bearing half: `all` is the scope
      a positional gradient is measured over, so filtering only the drawn set would leave a hidden
      sulfate stretching the ramp across empty space. Applied here rather than inside `buildStyle()`
      because it is a fact about *which residues this component has*, and `buildStyle()`'s two lists
      have to agree about that.
    */
    const drop = component === 'ligand' && style.hide_polyatomic_ions === true;
    const all = componentResidues(component)
      .filter((residue) => !(drop && residue.polyatomicIon));
    const residues = all.filter((residue) => !claimed.has(residue.key));
    jobs.push({ style: { component, ...style }, residues, scope: all });
  }

  for (const job of jobs) job.plan = planStyle(session, job.style, job.residues);
  return { jobs, hidden, warnings: budgetWarnings(jobs.map((job) => job.plan)) };
}

/**
 * `onWarning` is awaited with the budget's warnings before the first style is built, so a caller
 * can put them in front of the user while the thread is still free to paint them.
 */
export async function buildScene(session, { onWarning } = {}) {
  const notes = [];
  const out = {
    spheres: new FloatList(), sphereAttributes: new FloatList(),
    cylinders: new FloatList(), cylinderAttributes: new FloatList(),
    vertices: new FloatList(), triangles: new IndexList(), vertexCount: 0,
    materials: [], materialIds: new Map(),
    // What each surface build cost, in its own numbers: the field ms, the marching-cubes ms and
    // the triangle count `geom/surface.js` produced. Nothing else in the scene can supply them.
    surfaces: [],
    refusals: [],
    notes,
  };

  const { jobs, hidden, warnings } = planScene(session);
  if (warnings.length && onWarning) await onWarning(warnings);
  const source = colorSourceFor(session);
  const bonds = session.bonds;

  const styles = [];
  for (const job of jobs) {
    const before = primitiveCount(out);
    await buildStyle(out, session, job, source, bonds, notes, hidden);
    if (job.plan.estimate) {
      styles.push({
        component: job.style.component,
        representation: job.plan.representation,
        estimate: job.plan.estimate,
        built: primitiveCount(out) - before,
      });
    }
  }
  /*
    Refused whole when the budget refused every style that had something to draw: said as a throw,
    the way `setScene()` says an empty scene, so the reason reaches the status line and is not
    replaced there by "no geometry".
  */
  if (out.refusals.length && primitiveCount(out) === 0) throw new Error(out.refusals.join(' '));

  return {
    spheres: out.spheres.toTyped(),
    sphereAttributes: out.sphereAttributes.toTyped(),
    cylinders: out.cylinders.toTyped(),
    cylinderAttributes: out.cylinderAttributes.toTyped(),
    vertices: out.vertices.toTyped(),
    triangles: out.triangles.toTyped(),
    materials: out.materials,
    surfaces: out.surfaces,
    // Each style's estimate beside what it built, for the budget's own calibration.
    styles,
    notes,
  };
}

/** Everything the shader needs about the camera, in Angstroms. */
export function resolveCamera(request) {
  const camera = request.camera;
  const position = camera.position.slice();
  const target = camera.target.slice();
  const up = camera.up.slice();
  const fov = (camera.vertical_fov_degrees * Math.PI) / 180;

  const forward = normalize(subtract(target, position));
  const right = normalize(crossProduct(forward, up));
  const correctedUp = normalize(crossProduct(right, forward));

  const dof = request.render_settings?.depth_of_field ?? { enabled: false };
  // A 24 mm sensor height fitted vertically, and an f-stop turned into an aperture radius of
  // (lens mm / 1000) / (2 * fstop) in units of 100 A -- which the divide converts to Angstroms,
  // the units everything else in this file is in.
  const lensMillimetres = 24 / (2 * Math.tan(fov / 2));
  let apertureRadius = 0;
  let focusDistance = length(subtract(target, position));
  if (dof.enabled) {
    apertureRadius = ((lensMillimetres / 1000) / (2 * dof.f_stop)) / 0.01;
    // A picked point wins; `auto_focus_point` is the frame-centre hit main.js adds on the way in.
    const focus = dof.focus_target?.position ?? camera.auto_focus_point;
    const along = focus ? dotProduct(subtract(focus, position), forward) : 0;
    // A picked point the camera has moved past would aim every ray backwards: keep the target's.
    if (along > 1e-3) focusDistance = along;
  }
  return { position, target, forward, right, up: correctedUp, fov, apertureRadius, focusDistance, lensMillimetres };
}

/**
 * Which authored environment one `lighting_setup.source` opens.
 *
 * **Derived from `lighting-compass.js`'s profiles rather than restated.** A literal table here
 * would be a second table about the same nine ids, which are enumerated there with their
 * orientations. Two of the nine are not named after their source (blue studio is `base_scene`,
 * dark studio is `dark_scene`), which is precisely the fact a second copy gets wrong.
 */
export const LIGHTING_SCENES = Object.fromEntries(
  Object.entries(LIGHTING_SOURCE_PROFILES).map(([source, profile]) => [source, profile.scene]),
);

export function lightingScene(request) {
  const source = request?.lighting_setup?.source ?? request?.look ?? DEFAULT_LIGHTING_SOURCE;
  return LIGHTING_SCENES[source] ?? LIGHTING_SCENES[DEFAULT_LIGHTING_SOURCE];
}

/**
 * The two environments whose world is more than "map times a strength".
 *
 * Both carry more than a map and a strength, so their extras are restated here from
 * `public/assets/env/<scene>.json` -- the dump is the record and this is the shader's copy of it.
 * `mode` matches `WORLD_*` in `pathtrace.wgsl`.
 */
const WORLD_EXTRAS = {
  // Dim cool tint on the map, plus a cyan side rim added along |x| of the mapped direction.
  fluorescence_darkfield_scene: {
    mode: 1,
    tint: [0.035, 0.11, 0.28],
    rim: { from: 0.48, to: 0.96, color: [0.03, 0.32, 0.62] },
  },
  // Glossy and transmission rays see broad softbox panels instead of the map, at their own
  // background strength -- the same split the `reflection_environment` control uses.
  glass_studio_scene: { mode: 2, panelStrength: 0.95 },
};

function findEnvironmentTree(worldDump) {
  for (const [name, tree] of Object.entries(worldDump?.world_trees ?? {})) {
    if (tree.nodes?.some((node) => node.type === 'ShaderNodeTexEnvironment')) return [name, tree];
  }
  return [null, null];
}
const inputValue = (node, match) => Object.entries(node?.inputs ?? {})
  .find(([key]) => key.includes(match))?.[1];

/**
 * Read the authored world's two runtime-relevant numbers out of its dump.
 *
 * Both forms appear across the nine. Seven are flat -- coordinate, mapping, environment texture,
 * background -- so the rotation is the mapping's own Z euler and the strength is the background's
 * own value. Autumn meadow wraps the same chain in a handler group, where the rotation arrives in
 * *degrees* and the strength is `2 ** EVs`.
 */
function authoredWorld(worldDump) {
  const outer = worldDump?.world_trees?.['Shader Nodetree'];
  const group = outer?.nodes?.find((node) => node.type === 'ShaderNodeGroup');
  if (group) {
    const rotation = inputValue(group, 'Rotation');
    const evs = inputValue(group, 'Strength');
    return {
      rotation: ((rotation?.value ?? 0) * Math.PI) / 180,
      strength: 2 ** (evs?.value ?? 0),
    };
  }
  const [, tree] = findEnvironmentTree(worldDump);
  const mapping = tree?.nodes?.find((node) => node.type === 'ShaderNodeMapping');
  const rotation = inputValue(mapping, 'Rotation');
  // The illumination background is the one whose colour comes from the environment texture; glass
  // studio's second background drives its reflection panels and must not be read as the strength.
  const environment = tree?.nodes?.find((node) => node.type === 'ShaderNodeTexEnvironment');
  const colorLink = tree?.links?.find((link) => link.from_node === environment?.name);
  const backgrounds = tree?.nodes?.filter((node) => node.type === 'ShaderNodeBackground') ?? [];
  const lit = backgrounds.find((node) => node.name === colorLink?.to_node) ?? backgrounds[0];
  return {
    rotation: rotation?.linked ? 0 : (rotation?.value?.[2] ?? 0),
    strength: inputValue(lit, 'Strength')?.value ?? 1,
  };
}

/*
  What a glossy or transmission ray sees instead of the HDRI, as the shader's own small enum.

  `source` is 0 and means the illumination environment, unsplit. The other three are the split, and
  they reproduce the authored reflection environment: it cuts the authored World's Surface link
  and mixes the illumination against a second Background on
  `max(Is Glossy Ray, Is Transmission Ray)`.

  **`color` keeps its authored 0.8 here and the other two keep theirs in the shader**, which is not
  an inconsistency: the colour is the *user's* and only its strength is authored, while `studio`'s
  panels and `grid`'s checker are authored colours *and* an authored strength, and splitting one
  authored world across two files is how its numbers drift apart.
  `pathtrace.wgsl`'s `studioPanels()` and `reflectionGrid()` carry them together.
*/
const REFLECTION_MODES = { source: 0, color: 1, studio: 2, grid: 3 };

export function resolveLighting(request, worldDump, scene = lightingScene(request)) {
  const setup = request.lighting_setup ?? {};
  const strength = setup.strength ?? 1;
  const reflection = setup.reflection_environment ?? 'source';
  const reflectionMode = REFLECTION_MODES[reflection] ?? REFLECTION_MODES.source;
  /*
    What the split reflection branch is multiplied by, and the user's Strength is in it.

    **The trap is an order of operations.** The lighting strength is applied *before* the second
    Background is built, so the multiplier walks a World that does not yet contain the environment it
    is meant to reach. The consequence is visible rather than theoretical: three environments the
    product offers hold their authored brightness against a slider that moves everything else in the
    picture -- which on a chrome or glass subject reads as the slider doing nothing at all.

    **The multiplier alone, never `strength` above**, which is that multiplier times the *authored*
    world's own -- autumn meadow's is `2 ** 0.15`, 1.110. That number belongs to the HDRI, and the
    HDRI is the branch this one replaces.

    **One field rather than a colour and a scalar.** For `color` the environment *is* a constant
    colour, so its radiance is the multiplier; for `studio` and `grid` the pattern carries the
    colour and this is grey. At the product's strength of 1 the second two are exactly `1`, and a
    float times 1 is itself -- which is what keeps every recorded picture where it is, and also why
    only a person moving the slider can see this go wrong.
  */
  let reflectionScale = null;
  if (reflectionMode === REFLECTION_MODES.color) {
    reflectionScale = hexToLinear(setup.reflection_color ?? '#FFFFFF')
      .map((value) => value * 0.8 * strength);
  } else if (reflectionMode !== REFLECTION_MODES.source) {
    reflectionScale = [strength, strength, strength];
  }
  const authored = worldDump ? authoredWorld(worldDump) : { rotation: 0, strength: 1 };
  const extras = WORLD_EXTRAS[scene] ?? {};
  return {
    scene,
    reflectionMode,
    anchor: setup.anchor ?? 'world',
    elevation: ((setup.elevation ?? 0) * Math.PI) / 180,
    azimuth: ((setup.azimuth ?? 0) * Math.PI) / 180,
    strength: strength * authored.strength,
    authoredRotation: authored.rotation,
    reflectionScale,
    worldMode: extras.mode ?? 0,
    worldTint: extras.tint ?? [1, 1, 1],
    rim: extras.rim ?? { from: 0, to: 1, color: [0, 0, 0] },
    // Glass studio's panels carry their own background strength, scaled by the user's multiplier
    // the same way the illumination branch is.
    panelStrength: (extras.panelStrength ?? 0) * strength,
  };
}

const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dotProduct = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crossProduct = (a, b) => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];
const length = (a) => Math.hypot(a[0], a[1], a[2]);
function normalize(a) {
  const l = length(a);
  return l < 1e-12 ? [0, 0, 1] : [a[0] / l, a[1] / l, a[2] / l];
}
