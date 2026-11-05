/*
  What this renderer can actually do -- the one table, and the only one.

  **This is what the tracer dispatches on and what the pickers are greyed from, and there is no
  second list.** Deleting a row must stop the geometry. Two separate lists kept in agreement by
  hand is exactly how it goes wrong: an id in the picker and written by Styles while the tracer's
  set omits it draws nothing, and says so only to an array nobody reads.

  The readers are `render-backend.js`/`renderer.js`, `main.js`'s `applyFidelityGating()` (which
  greys out an unbuilt option in the pickers) and the derived regression case list. **There is no
  reader who is a person**, so a row that stops being true has one fewer place to show it.

  **The table states only what it can state truthfully: which builder draws an id, and whether it
  draws side chains only.** It does not grade how close a picture comes to anything: there is no
  reference picture to judge against, and a vocabulary invented without one would be a guess.
  `state` is *derived* from `family` rather than stored beside it, so there is no second field to
  keep in step and no bucket anyone can set wrongly: a row with a builder is BUILT, a row without
  one is NOT_BUILT and `buildStyle()` pushes a note instead of geometry.

  `note` is the channel that makes a non-exact answer honest, and it lives here because it is a
  statement about this renderer.
*/

import { assetBase } from './asset-base.js';
// The method list is `secondary-structure.js`'s, not a second copy of it: this file declares what
// the renderer offers and that file decides what it has.
import { SECONDARY_STRUCTURE_METHODS } from './secondary-structure.js';
import { BondType } from 'molstar/lib/mol-model/structure/model/types.js';

export const BUILT = 'built';
export const NOT_BUILT = 'not_built';

/*
  Every representation the product can ask for.

  The universe is the whole request vocabulary: what the four pickers produce, what the 90 Styles
  name, and what the request contract accepts. Carrying the whole list -- rather than only the ids that draw --
  is what makes an unimplemented id *declared* rather than unknown: `buildStyle()` refuses a
  representation with no family and says which one, and `representationNote()` says when it lands.

  `family` is the tracer's own dispatch. `null` means no geometry is built for it, which is the same
  fact as NOT_BUILT seen from the other side. `sideChainOnly` is orthogonal to both: it decides
  which atoms the family draws, not whether it draws them.
*/
export const REPRESENTATIONS = {
  // ---- analytic. Spheres and capped cylinders are intersected exactly, at any zoom.
  spheres: { family: 'spheres' },
  spheres_refined: { family: 'spheres' },
  ligand_spheres: { family: 'spheres' },
  ion_spheres: { family: 'spheres' },
  nucleic_spheres: { family: 'spheres' },
  /*
    Two ids, one representation. "Refined" named mesh subdivision on the authored templates, and a ray-traced analytic sphere has none -- so the pair resolve to the same builder
    here and the distinction costs nothing.
  */
  side_chain_spheres: { family: 'spheres', sideChainOnly: true },
  side_chain_spheres_refined: { family: 'spheres', sideChainOnly: true },
  ball_and_stick: { family: 'ball_and_stick' },
  ball_and_stick_refined: { family: 'ball_and_stick' },
  ligand_ball_and_stick: { family: 'ball_and_stick' },
  nucleic_ball_and_stick: { family: 'ball_and_stick' },
  side_chain_ball_and_stick: { family: 'ball_and_stick', sideChainOnly: true },
  side_chain_ball_and_stick_refined: { family: 'ball_and_stick', sideChainOnly: true },
  sticks: { family: 'sticks' },
  ligand_sticks: { family: 'sticks' },
  nucleic_sticks: { family: 'sticks' },
  side_chain_sticks: { family: 'sticks', sideChainOnly: true },

  /*
    ---- the ion markers (`geom/markers.js`).

    The one place this product draws a *symbol* rather than a molecule: one faceted solid at one
    atom, no bonds, because a monoatomic ion has nothing to bond to. `src/residues.js` is what keeps
    that honest -- an ion is a name Mol* calls an ion **and** a residue with one atom -- so a
    polyatomic oxyanion is a ligand and is never drawn as a handful of gems.

    **A row loses its note in the edit that gives it geometry**: a row that apologises for a
    shortfall it does not have is the same defect as one that hides a real one.

    Same family for both because the *builder* is one; what differs is a vertex table and a face
    table, and `geom/markers.js` is keyed by these ids so a look and its row cannot drift apart.
  */
  ion_faceted: { family: 'marker' },
  ion_octahedron: { family: 'marker' },

  /*
    ---- water.

    **One look, and one is the decision.** Water is drawn as a dot per molecule -- `wholeResidue` on
    the sphere family, which is the same kind of orthogonal per-row flag `sideChainOnly` already is,
    so it narrows which atoms the family draws rather than adding a builder. Not ball-and-stick,
    sticks or space-filling: no deposited entry carries water hydrogens, so all three would draw a
    bare oxygen or nothing at all, and three ways to draw one atom is three ways to ask the same
    question.

    The size and the colour are the controls; the shape is not one.
  */
  water_dots: { family: 'spheres', wholeResidue: true },

  /*
    ---- the sweep.

    One sweep and one profile function build all sixteen. The family is the same for every one of
    them because the *builder* is the same; what differs is three numbers per secondary-structure
    kind, and `geom/profiles-catalog.js` is keyed by these ids so that a look and its row cannot
    drift apart. The two key sets are asserted equal in both directions -- a sweep row with no look
    would draw nothing, and a look with no row would be unreachable.

    No note: these are built, and a built row explains itself by being drawn. The cross-sections are
    **authored** rather than measured against anything, which is a design decision and not a
    shortfall, so there is nothing here to warn about.
  */
  cartoon: { family: 'sweep' },
  cartoon_chonky: { family: 'sweep' },
  cartoon_geometric: { family: 'sweep' },
  cartoon_railed: { family: 'sweep' },
  cartoon_railed_blend: { family: 'sweep' },
  cartoon_railed_chonky: { family: 'sweep' },
  /*
    Four proposals, three of which reached the type picker (`cartoon_cords`, `cartoon_lowpoly` and
    `ribbon_tape`; `cartoon_prism` did not). Same family and same builder as every row above --
    each one is a look-level knob in `geom/profiles-catalog.js`, which is where they are argued for,
    and none of them is a second sweep.

    **They carry no note and that is deliberate.** A note is for a row whose picture is not the one
    that was asked for; these are drawn exactly as authored. How far their *numbers* have been
    tuned is a fact about the catalogue rather than about this renderer, and the catalogue says so
    beside each of them.
  */
  cartoon_cords: { family: 'sweep' },
  cartoon_lowpoly: { family: 'sweep' },
  cartoon_prism: { family: 'sweep' },
  ribbon: { family: 'sweep' },
  ribbon_slender: { family: 'sweep' },
  ribbon_tape: { family: 'sweep' },
  nucleic_cartoon: { family: 'sweep' },
  nucleic_ribbon: { family: 'sweep' },
  /*
    The two that draw a base. Same family and same builder as the fourteen above -- `bases` is a
    look-level knob in `geom/profiles-catalog.js`, the way `rail` and `helixRod` are, so these rows
    say nothing the other sweeps do not.

    **No note, and that is a claim rather than an omission.** These are the only representations in
    the table that can fail *per residue*: a base whose ring Mol* cannot complete is refused rather
    than drawn with a notch, so `scene.js` states the count in the picture's own notes. A row-level
    note would say the same thing about every structure, including the ones where it is not true.
  */
  nucleic_blocks: { family: 'sweep' },
  nucleic_rings: { family: 'sweep' },

  /*
    ---- the surface. Gaussian by default, solvent-excluded at high detail.

    One family, one builder, six ids and a table of numbers -- the same shape as the sweep and the
    markers, and `geom/surface.js` is keyed by these ids so a rung and its row cannot drift apart.
    The two key sets are asserted equal in both directions.

    **The four levels are a ladder that changes *field* partway up**, which is the one thing about
    this family worth knowing before reading a picture: a finer grid on a gaussian field buys a
    finer blob, and only a smaller probe opens a cleft. So 1-2 are gaussian and 3-4 are
    solvent-excluded.

    **No note on any of them, and that is a claim.** These are drawn exactly as authored; that the
    numbers are ours is a design decision and not a shortfall, so there
    is nothing here to warn about. The one thing that can
    go wrong per structure -- a vertex the field cannot attribute to an atom -- reaches the
    picture's own notes from `scene.js`, because a row-level note would say it about every structure
    including the ones where it is not true.

    `surface_refined` is **level 1 under another name**, exactly as `spheres_refined` is `spheres`:
    "refined" named mesh subdivision on the authored templates, and a ray-traced
    isosurface has none. `geom/surface.js` carries that argument beside the entry.
  */
  surface: { family: 'surface' },
  surface_soft_pockets: { family: 'surface' },
  surface_smooth_pockets: { family: 'surface' },
  surface_open_cavities: { family: 'surface' },
  surface_refined: { family: 'surface' },
  nucleic_surface: { family: 'surface' },
};

/*
  The twelve colour modes, and the one that is not.

  All of them are table lookups and gradient evaluations over atom attributes with no coupling to
  the renderer -- which is why twelve of the thirteen are implemented. `nucleic_duplex`
  is the gap and it is a real one: its factor is a PCA of the residue centres rather than a sequence
  position, so sharing the N-to-C branch would render a plausible ramp along the wrong axis. It
  renders uniform and says so, which is the whole difference between a gap and a lie.
*/
export const COLOR_MODES = {
  uniform: { implemented: true },
  element: { implemented: true },
  chain: { implemented: true },
  entity: { implemented: true },
  sequence: { implemented: true, endpoints: true },
  x_axis: { implemented: true, endpoints: true },
  y_axis: { implemented: true, endpoints: true },
  z_axis: { implemented: true, endpoints: true },
  plddt: { implemented: true },
  bfactor: { implemented: true },
  nucleic_base: { implemented: true },
  nucleic_part: { implemented: true },
  nucleic_duplex: {
    implemented: false,
    endpoints: true,
    note: 'the duplex axis is a PCA of the residue centres rather than a sequence position;'
      + ' a request for it renders uniform and says so in the picture\'s own notes.',
  },
};

// Modes whose card offers the two gradient endpoints. Not `scene.js`'s ramp dispatch: an
// implemented `nucleic_duplex` must not join the N-to-C branch.
export const GRADIENT_COLOR_MODES = new Set(
  Object.keys(COLOR_MODES).filter((id) => COLOR_MODES[id].endpoints === true),
);

/*
  Which of Mol*'s bond types become a cylinder.

  mmCIF `struct_conn` records reach `unit.bonds`
  flagged `BondType.Flag.HydrogenBond` -- 32 of them across `1BNA.cif`'s twelve Watson-Crick base
  pairs -- and drawing each as a stick puts a covalent-looking rod between two bases that are not
  covalently joined. Worse, it is not even stable across formats: the *same* entry as `1BNA.pdb`
  carries none, because the PDB format has no such record, so one structure would draw two
  different pictures depending on which file it arrived in.

  The rule is **not** narrowed to nucleic. A hydrogen bond is the same thing in a protein and a
  helix has hundreds of them; a filter that applied only to DNA would draw one bond type two ways
  for no reason a viewer could learn. Mol*'s own bond visual includes them, so this is a deliberate
  divergence from Mol* rather than a bug in it.

  It is a *drawing* decision and lives here rather than in the enumeration: `structure.js` still
  reports every hydrogen bond Mol* found, which is what a future dashed-line representation would
  be built from and what keeps the enumeration a statement about the file.
*/
export const BOND_TYPES_DRAWN = ['covalent', 'metal-coordination', 'disulfide', 'aromatic', 'computed'];

export const BOND_TYPES_NOT_DRAWN = {
  'hydrogen-bond': 'enumerated but not drawn: a stick between two bases that are not covalently'
    + ' joined reads as a bond, and the record only exists in mmCIF, so the same structure would'
    + ' draw differently as a .pdb.',
};

/*
  `BondType.Names` is Mol*'s map from name to bit. It is read at module load rather than copied,
  so a bit that moves moves here too -- and a name that disappears fails loudly rather than
  silently matching nothing, which would draw no bonds at all.
*/
const BOND_TYPE_BITS = (() => {
  const bits = {};
  for (const name of [...BOND_TYPES_DRAWN, ...Object.keys(BOND_TYPES_NOT_DRAWN)]) {
    const bit = BondType.Names[name];
    if (bit === undefined) throw new Error(`Mol* no longer has a bond type called "${name}"`);
    bits[name] = bit;
  }
  return bits;
})();

/**
 * Whether a bond with these flags becomes a cylinder.
 *
 * A bond may carry several flags at once, so this asks whether *any* drawn type is present rather
 * than whether an undrawn one is: an aromatic bond that also happens to be flagged as a hydrogen
 * bond is still an aromatic bond and is still drawn.
 */
export function bondIsDrawn(flags) {
  for (const name of BOND_TYPES_DRAWN) if (flags & BOND_TYPE_BITS[name]) return true;
  return false;
}

/** The tracer's geometry dispatch. `null` is "no geometry is built for this". */
export function representationFamily(id) {
  return REPRESENTATIONS[id]?.family ?? null;
}

/** Whether this representation draws side chains and the alpha carbon only. */
export function representationIsSideChainOnly(id) {
  return REPRESENTATIONS[id]?.sideChainOnly === true;
}

/** Whether this representation draws one solid per residue rather than one per atom. */
export function representationIsWholeResidue(id) {
  return REPRESENTATIONS[id]?.wholeResidue === true;
}

/** Whether `residueColorFactory()` has real arithmetic for this mode, or falls back to uniform. */
export function colorModeImplemented(id) {
  return COLOR_MODES[id]?.implemented === true;
}

/** Derived, never stored: a row with a builder is built and a row without one is not. */
export function representationState(id) {
  return representationFamily(id) ? BUILT : NOT_BUILT;
}

/*
  The prose beside an id that is not simply drawn, keyed the way the tables are keyed. An unknown id
  has no note because it has no row -- `buildStyle()` names it in the scene's own notes instead.
*/
export function representationNote(id) {
  return REPRESENTATIONS[id]?.note;
}

export function colorModeNote(id) {
  return COLOR_MODES[id]?.note;
}

/*
  The prose beside a material this renderer does not shade from its whole graph.

  Keyed and read the way `representationNote` and `colorModeNote` are, and for the same reason:
  a reader states *which* part is missing rather than saying only that something is, and a reader
  with a sentence of its own would be a second list to keep in step. Every id here has to be in
  `materialsNotShaded` and in the material catalogue, and both are asserted.
*/
const MATERIAL_NOTES = {
  jelly: 'Its transmission, its roughness and its IOR are all rendered. What is not is its'
    + ' Subsurface Weight of 0.5 at a 5 A mean free path -- three atoms across, so it is a'
    + ' scattering medium rather than a surface finish, and there is no subsurface lobe here.'
    + ' Half of this material renders as a rough dielectric over a diffuse base instead.',
};

export function materialNote(id) {
  return MATERIAL_NOTES[id];
}

/** Every material this table has a note for. Exported so a test can hold it against the catalogue. */
export function notedMaterials() {
  return Object.keys(MATERIAL_NOTES);
}

// Takes the dispatch's own predicates, so no reader of this table can disagree with `buildStyle()`
// about a row.
function idsByState(entries, isBuilt) {
  const built = [];
  const notBuilt = [];
  for (const id of Object.keys(entries)) (isBuilt(id) ? built : notBuilt).push(id);
  return { [BUILT]: built, [NOT_BUILT]: notBuilt };
}

/**
 * What this renderer can do, machine-readable.
 *
 * Every gap here is otherwise discovered by the render either failing or -- worse -- succeeding
 * wrongly: a Style asking for a representation this does not build renders without it and reports
 * nothing. Anything presenting what this renderer can do is a view of this function and of nothing
 * else.
 */
/*
  The view transforms this renderer applies, **in the order `present.wgsl` dispatches on**.

  `renderer.js` takes a transform's *index* out of this list for the display pass's uniform. A
  second copy of the order would be a picture rendered through the wrong curve with nothing to say
  so.

  **`filmic` is first and `filmic` is the default, and they are two different facts.** First is the
  shader's fallback for an id it does not know; the default is `index.html`'s selected option and
  `render-backend.js`'s own fallback. They coincide, and the distinction is kept in writing
  precisely because they do -- an editor who moves a row here on the reasoning that "the first one
  is the default anyway" changes the fallback for an unknown id.

  **`filmic` rather than `agx` is a judgement about the picture**, not about the implementation.
  Both are built and both are offered; AgX is analytic and costs no data files, and what the
  default buys is that the 464 KB of Filmic LUTs `ready()` loads is on the path of the picture
  almost everyone actually gets.
*/
// `raw` is appended, never inserted: the index is the shader's enum.
export const VIEW_TRANSFORMS = ['filmic', 'agx', 'standard', 'raw'];

/** What a request gets when it names no transform, or names one this renderer does not apply. */
export const DEFAULT_VIEW_TRANSFORM = 'filmic';

export function capabilities() {
  return {
    renderer: 'webgpu-pathtracer',
    /*
      Any size, because the live trace fills a **responsive** stage while the product promises the
      picture on screen is the picture you download -- which cannot hold if a download refuses
      1000 px and accepts 1024. `pathtrace.wgsl` puts the aspect term on X, and `renderer.js` pads
      `bytesPerRow` to WebGPU's 256-byte row alignment and crops the rows back out.

      A square render is untouched by either: the aspect ratio of equal dimensions is exactly 1.0
      and the padded stride equals the packed one.
    */
    // `boundedByAdapter`: `renderer.js` `resize()` refuses a target past the device's buffer limit.
    size: { square: false, widthMultipleOf: 1, boundedByAdapter: true },
    // Exactly what the Output card offers, in the order the shader's own enum uses --
    // `renderer.js` takes the index out of this list rather than keeping a second table, so a row
    // that moves here moves the shader with it. An option the card offers and this list does not
    // carry would be a silent substitution.
    viewTransforms: VIEW_TRANSFORMS,
    /*
      **All four are applied.** A mode `resolveLighting()` does not know falls back to `source`,
      which renders the unsplit environment and says nothing.

      They are the authored shaders rather than inventions:
      `studio` is a ten-stop EASE ramp of two broad panels along the reflection vector's X at a
      Background strength of 0.9, and `grid` is Cycles' checker texture on that vector, scaled 7 and
      turned 35 degrees, at 0.65. Both read the ray direction rotated by the user's lighting
      orientation **alone** -- not by the authored World's mapping and not by the camera anchor,
      which belong to the illumination branch.
    */
    reflectionEnvironments: ['source', 'color', 'studio', 'grid'],
    /*
      `glass`, `translucent_context`, `jelly` and `satin` shade from their whole graph -- the rough
      dielectric, the ray-type Transparent mix `glass` carries, the view-angle opacity ramp
      `translucent_context` carries, and `satin`'s contact shading -- with one exception.

      **`jelly` is listed for its `Subsurface Weight` of 0.5.** The distinction the table draws is
      the *scale*: `ceramic` carries subsurface too and is not listed,
      because its radius times its scale is 0.06 x 0.05 = 0.003 Blender units, which is 0.3 A
      against a ~1.7 A sphere and reads as diffuse. `jelly`'s is 0.05 x 1.0 -- **5 A**, three atoms
      across -- and there is no subsurface lobe here to give it. Half of that material is a
      scattering medium and renders as a rough dielectric over a diffuse base instead.
    */
    materialsNotShaded: ['jelly'],
    // The three runtime style tunables, all three implemented.
    runtimeTunables: { uniform_color: true, emission_strength: true, opacity: true },
    // `present.wgsl` returns the pixel's own alpha, so a downloaded picture carries real
    // transparency and a backdrop is composited at download time.
    transparentFilm: true,
    // Computed here from the one `Structure`, never carried in from a document.
    secondaryStructureMethods: SECONDARY_STRUCTURE_METHODS,
    // Every bond Mol* perceives is enumerated; these are the ones that become a cylinder.
    bondTypesDrawn: BOND_TYPES_DRAWN,
    structureFormats: ['cif', 'pdb'],
    /*
      **The `NOT_BUILT` bucket is empty and that is a fact worth stating rather than a reason to
      delete the state.**

      All 42 declared representations draw. A two-state vocabulary with one empty bucket looks like
      a table that has stopped saying anything, and the temptation is to replace it with something
      more expressive. Do not. The state is *derived* from whether a row has a builder, so an empty
      bucket is a measurement rather than a claim -- it goes back to being non-empty the day
      someone declares a representation before writing it, which is exactly the day something needs
      to say so.

      **What this renderer cannot do is therefore not in this pair.** It is in the
      sibling fields -- `colorModes`' `NOT_BUILT`, `materialsNotShaded`, and whatever the card
      offers beyond `viewTransforms` and `reflectionEnvironments`. Anything presenting them
      composes them out of this function and nothing else: a reader with a list of its own is the
      split this table exists to prevent.
    */
    representations: idsByState(REPRESENTATIONS, (id) => representationState(id) === BUILT),
    colorModes: idsByState(COLOR_MODES, colorModeImplemented),
    // A render stops at its sample count and Live at its target, so every machine reaches the same
    // count; the bytes belong to the GPU, so two adapters are never compared pixel for pixel.
    reproducibility: { pixelsVaryByAdapter: true },
    assetBase: assetBase(),
  };
}
