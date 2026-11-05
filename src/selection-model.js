/*
  The selection model: what a layer can name, what a component can be drawn as, and how a residue
  set is compressed for the document.

  Three properties of this file are absences, and an absence is the one thing a reader cannot see:

  1. **No per-look geometry table.** A look *is* its numbers, authored in front of this renderer in
     `src/geom/profiles-catalog.js` and `src/geom/surface.js`, so no second table of per-look
     width, thickness or probe values lives in this file -- a copy would be a divergence waiting to
     happen. What does stay is the **atom radii**, which are the product's own and which
     `src/scene.js` needs.
  2. **A selection layer names a representation the way everything else does.**
     `COMPONENT_REPRESENTATIONS` carries the prefixed ids, so there is one vocabulary and no alias
     table anywhere.
  3. **This file classifies nothing.** A classifier here would be a second answer to questions
     `src/residues.js` and `src/color.js` already answer from the one Mol* `Structure`, which is
     how a structure gets two answers to what a nucleotide is. Call `classifyResidue()` and
     `nucleicBaseLabel()`.
*/

export const MAX_SELECTION_LAYERS = 16;

/*
  The look catalogue, for the two functions that answer "what can a user move on this
  representation". A swept look's controls and their defaults are properties of the look, so they
  are read from the one file that authors them rather than restated here -- see
  `representationSettingControls()`. Data only: nothing in `geom/` imports this file back.
*/
import { quotedValue } from './display-text.js';
import {
  lookFor, lookSettingControls, lookSettingDefaults, repairLookSettings,
} from './geom/profiles-catalog.js';
/*
  From `geom/surface-levels.js` rather than from `geom/surface.js`, and the difference is a third
  of the first-paint bundle. This module is imported eagerly by `main.js`; reaching through the
  builder would drag Mol*'s entire WebGL renderer along with it, to read a table of five numbers.
  `geom/surface-levels.js` carries the measurement.
*/
import { levelFor, levelSettingControls, levelSettingDefaults } from './geom/surface-levels.js';

export const SURFACE_DETAIL_OPTIONS = [
  ['1', 'Level 1'],
  ['2', 'Level 2'],
  ['3', 'Level 3'],
  ['4', 'Level 4'],
];

export const ATOM_SCOPE_OPTIONS = [
  ['all', 'All atoms'],
  ['sidechains', 'Side chains'],
];

/*
  The cartoon looks, expressed as a picker. Retired and renamed ids live in
  `src/session-format.js`'s import tables.

  `railed` leads because it is `DEFAULT_CARTOON_TYPE`: the picker's first tile and the type a fresh
  load already has selected are the same one. It leads *as a look* because it raises an edge --
  `r > h` is a bevel and cannot, and a cord laid on the panel's outer edge can. The two are
  different effects, not degrees of one.

  After `railed` come the two bevels, the two other railed looks, the rod, the cords and the
  low-poly facets. Every value here has a row in
  `src/capabilities.js` and a look in `src/geom/profiles-catalog.js`, asserted in both directions,
  so a look added to the catalogue without a tile fails loudly.
*/
export const CARTOON_TYPE_OPTIONS = [
  ['railed', 'Railed'],
  ['classic', 'Classic'],
  ['chonky', 'Chonky'],
  ['railed_blend', 'Railed tapered'],
  ['railed_chonky', 'Railed chonky'],
  ['geometric', 'Cylindrical'],
  ['cords', 'Cords'],
  ['lowpoly', 'Low poly'],
];

export const DEFAULT_CARTOON_TYPE = 'railed';

/*
  The ribbons. `standard` and `slender` are circles of two authored radii
  (`geom/profiles-catalog.js`); an older document's `fine` opens as `slender`, and its `bold` has no
  counterpart and is not offered.

  `tape` is the third thing a ribbon can be: one flat profile across every secondary-structure
  kind, which is the ribbon the word means outside this product.
*/
export const RIBBON_TYPE_OPTIONS = [
  ['standard', 'Standard'],
  ['slender', 'Slender'],
  ['tape', 'Tape'],
];

// A representation setting is a number field unless its third element is this
// marker, which makes it a checkbox.  Only `show_hydrogens` uses it: hydrogen
// visibility is not a geometry setting but a runtime atomic-number filter,
// so it has no range to clamp against.
export const BOOLEAN_SETTING = 'boolean';

export function isBooleanRepresentationSetting(control) {
  return Array.isArray(control) && control[2] === BOOLEAN_SETTING;
}

const REPRESENTATION_SETTING_CONTROLS = {
  ball_and_stick: [
    ['sphere_radius', 'Sphere radius', 0.01, 5, 0.01, false],
    ['bond_radius', 'Bond radius', 0.01, 5, 0.01, false],
    ['show_hydrogens', 'Show hydrogens', BOOLEAN_SETTING],
  ],
  sticks: [
    ['stick_radius', 'Stick radius', 0.01, 5, 0.01, false],
    ['show_hydrogens', 'Show hydrogens', BOOLEAN_SETTING],
  ],
  spheres: [
    ['sphere_radius', 'Sphere radius', 0.01, 5, 0.01, false],
    ['show_hydrogens', 'Show hydrogens', BOOLEAN_SETTING],
  ],
  /*
    No `surface`, `ribbon`, `nucleic_cartoon` or `nucleic_ribbon` block. Those ids offer settings
    -- `surface` two, `ribbon` four, `nucleic_ribbon` four, `cartoon` thirteen -- and
    `representationSettingControls()` reads them out of the look (`geom/profiles-catalog.js`,
    `geom/surface-levels.js`); a block here would be a second copy of the look's own numbers.

    The **families stay** (see `representationSettingsFamily` below), because that function answers
    a second question -- can this look be coloured per atom -- and a surface can.
  */
  ion_spheres: [
    ['sphere_radius', 'Base sphere radius', 0.01, 5, 0.01, false],
  ],
  ion_faceted: [
    ['sphere_radius', 'Base sphere radius', 0.01, 5, 0.01, false],
  ],
  water_dots: [
    ['sphere_radius', 'Sphere radius', 0.01, 5, 0.01, false],
  ],
};

/*
  **There is no `subdivisions` row, and there cannot be one.** A subdivision count states how many
  triangles approximate a sphere; spheres and capped cylinders are intersected exactly here, so
  there are no such triangles for it to be about -- the same argument that makes `spheres_refined`
  and `spheres` one builder. A Style that named it would be inert: `representationSettings()` in
  `scene.js` merges the field and no builder asks for it, exactly as it does for any other field a
  look does not offer.
*/

/*
  **Hydrogens are off in every row.** On a structure that carries explicit hydrogens, drawing them
  is a fog of small spheres nobody asked for, and off is the same picture every Style already
  forces (`hideHydrogensForStyle()` in `src/main.js`). The checkbox is what turns them back on.

  **It moves no recorded picture**: none of the six recorded subjects carries a hydrogen atom, so
  the filter in `scene.js` has nothing to drop either way.
*/
const REPRESENTATION_SETTINGS_DEFAULTS = {
  ball_and_stick_refined: { sphere_radius: 0.29, bond_radius: 0.2, show_hydrogens: false },
  sticks: { stick_radius: 0.28, show_hydrogens: false },
  spheres_refined: { sphere_radius: 0.65, show_hydrogens: false },
  // Every row is an **atom** radius, which is the product's own number and the one `src/scene.js`
  // reads: it falls back per *family* otherwise -- `sphere_radius ?? 1.0` for all of `spheres` --
  // which renders every spheres look half again too large and fuses a heme into a white blob.
  nucleic_ball_and_stick: { sphere_radius: 0.29, bond_radius: 0.2, show_hydrogens: false },
  nucleic_sticks: { stick_radius: 0.28, show_hydrogens: false },
  nucleic_spheres: { sphere_radius: 0.65, show_hydrogens: false },
  ligand_ball_and_stick: { sphere_radius: 0.29, bond_radius: 0.2, show_hydrogens: false },
  ligand_sticks: { stick_radius: 0.28, show_hydrogens: false },
  ligand_spheres: { sphere_radius: 0.65, show_hydrogens: false },
  ion_spheres: { sphere_radius: 0.75 },
  ion_faceted: { sphere_radius: 0.75 },
  /*
    Water. A factor on the oxygen's van der Waals radius like every other sphere row, so 0.12 is
    0.18 A: a dot that marks a position without competing with the molecule it surrounds. 0.35
    (0.53 A) read as a scatter of beads rather than as solvent. The slider reaches 5, so anybody
    who wants beads can have them.
  */
  water_dots: { sphere_radius: 0.12 },
};

/*
  Ids that take another id's settings, because they are one representation under two names.

  `ion_octahedron` aliases to `ion_faceted` for the same reason `spheres` aliases to
  `spheres_refined`: one builder, one control set, and the only difference is a vertex table
  (`src/geom/markers.js`). Without the row it would have no authored radius, fall through to
  `scene.js`'s family constant and draw an octahedron inscribed in a sphere a third larger than the
  two looks beside it -- a size difference that reads as a bug in the shape, not a missing row.
*/
const REPRESENTATION_SETTINGS_ALIASES = {
  ball_and_stick: 'ball_and_stick_refined',
  ion_octahedron: 'ion_faceted',
  side_chain_ball_and_stick: 'ball_and_stick_refined',
  side_chain_ball_and_stick_refined: 'ball_and_stick_refined',
  side_chain_sticks: 'sticks',
  spheres: 'spheres_refined',
  side_chain_spheres: 'spheres_refined',
  side_chain_spheres_refined: 'spheres_refined',
};

const ATOM_COLOR_REPRESENTATION_FAMILIES = new Set([
  'ball_and_stick',
  'sticks',
  'spheres',
  'surface',
  'ion_spheres',
  'ion_faceted',
]);

function canonicalRepresentationSettingsId(representation) {
  return REPRESENTATION_SETTINGS_ALIASES[representation] ?? representation;
}


export function representationSettingsFamily(representation) {
  const canonical = canonicalRepresentationSettingsId(representation);
  if (typeof canonical !== 'string') return undefined;
  if (['ball_and_stick_refined', 'ligand_ball_and_stick'].includes(canonical)) {
    return 'ball_and_stick';
  }
  if (canonical === 'nucleic_cartoon') return 'nucleic_cartoon';
  if (canonical === 'nucleic_ribbon') return 'nucleic_ribbon';
  if (canonical === 'nucleic_ball_and_stick') return 'ball_and_stick';
  if (['sticks', 'ligand_sticks', 'nucleic_sticks'].includes(canonical)) return 'sticks';
  if (['spheres_refined', 'ligand_spheres', 'nucleic_spheres'].includes(canonical)) return 'spheres';
  // Its own row rather than `spheres`, because the sphere block offers a hydrogen checkbox and this
  // look draws one solid per residue: the control would have been there and reached nothing.
  if (canonical === 'water_dots') return 'water_dots';
  if (canonical === 'ion_spheres') return 'ion_spheres';
  // Not `faceted`: `COMPONENT_REPRESENTATIONS` names `ion_faceted`, so there is no second spelling
  // to resolve.
  if (canonical === 'ion_faceted') return 'ion_faceted';
  if (canonical.startsWith('surface') || canonical === 'nucleic_surface') return 'surface';
  if (canonical.startsWith('ribbon')) return 'ribbon';
  return undefined;
}


export function representationSupportsAtomColors(representation) {
  return ATOM_COLOR_REPRESENTATION_FAMILIES.has(
    representationSettingsFamily(representation),
  );
}


/*
  The `?? []` is load-bearing.

  Not every family this function can name has a controls block.
  `representationSettingsFamily('surface')` answers `'surface'` -- deliberately, because that is
  also what makes a surface colourable per atom -- and the lookup below then misses. Without the
  `?? []`, a surface, a ribbon and both nucleic backbones return `undefined` from a function whose
  every caller does `.length` or `.find()` on the result.
*/
export function representationSettingControls(representation) {
  /*
    **A swept look answers for itself.**

    Every other family here has one control block because every representation in it has the same
    knobs -- a sphere radius is a sphere radius. A cartoon's knobs are *its own*: which
    secondary-structure kinds it states, whether it lays a rail, whether it draws its helices as
    rods, whether it has an arrowhead, whether it carries bases. A family-keyed table cannot say any
    of that, and a table keyed per look would be `PROFILES` written twice.

    So the look is asked (`geom/profiles-catalog.js`), and this file keeps the *shape* -- the
    `[name, label, min, max, step, integer]` tuples the validator below reads and `main.js`'s
    generic editor renders. Nothing about the numbers lives here.
  */
  const look = lookFor(representation);
  if (look) return lookSettingControls(look);
  // And a surface rung answers for itself for the same reason: which controls it has is decided by
  // which *field* it is built from, and the ladder crosses fields rather than turning one dial.
  const level = levelFor(representation);
  if (level) return levelSettingControls(level);
  const family = representationSettingsFamily(representation);
  return (family ? REPRESENTATION_SETTING_CONTROLS[family] : undefined) ?? [];
}


export function representationSettingsForRepresentation(representation) {
  // Same argument as `representationSettingControls()` above: the look's own numbers are the look's
  // defaults, read out of `PROFILES` rather than copied into a table beside it.
  const look = lookFor(representation);
  if (look) return lookSettingDefaults(look);
  const level = levelFor(representation);
  if (level) return levelSettingDefaults(level);
  const canonical = canonicalRepresentationSettingsId(representation);
  const defaults = REPRESENTATION_SETTINGS_DEFAULTS[canonical];
  return defaults ? { ...defaults } : undefined;
}


/*
  No unprefixed-to-prefixed resolution: a layer already holds `ligand_spheres`, and which settings
  block that uses is `representationSettingsFamily()` directly.
*/

export function representationSettingValue(representation, field, value) {
  const control = representationSettingControls(representation).find(([name]) => name === field);
  if (!control) throw new Error(`Unsupported representation setting: ${quotedValue(field)}.`);
  if (isBooleanRepresentationSetting(control)) {
    return typeof value === 'boolean' ? value : undefined;
  }
  if (typeof value === 'string' && value.trim() === '') return undefined;
  const number = Number(value);
  const [, , minimum, maximum, , integer] = control;
  if (!Number.isFinite(number) || number < minimum || number > maximum) return undefined;
  if (integer && !Number.isInteger(number)) return undefined;
  return number;
}


export function constrainedRepresentationSetting(representation, field, value, fallback) {
  const control = representationSettingControls(representation).find(([name]) => name === field);
  if (!control) throw new Error(`Unsupported representation setting: ${quotedValue(field)}.`);
  const validValue = representationSettingValue(representation, field, value);
  if (validValue !== undefined) return validValue;
  if (isBooleanRepresentationSetting(control)) {
    // A checkbox has no out-of-range state to clamp, so anything unusable falls
    // straight back to the caller's value and then to the shipped default.
    if (typeof fallback === 'boolean') return fallback;
    return representationSettingsForRepresentation(representation)[field];
  }
  const [, , minimum, maximum, , integer] = control;
  const number = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
  if (Number.isFinite(number)) {
    const bounded = Math.min(maximum, Math.max(minimum, number));
    return integer ? Math.round(bounded) : bounded;
  }
  const validFallback = representationSettingValue(representation, field, fallback);
  if (validFallback === undefined) {
    throw new Error(`Representation setting ${field.replaceAll('_', ' ')} has no valid fallback.`);
  }
  return validFallback;
}


/*
  The fields this representation has to move so the value just set can be built, and their new
  values -- `{}` when nothing has to move, which is every representation at its own defaults.

  **The question a control asks after it has written its own field.** Some settings cannot be set
  alone: a cross-section needs extent on both of its axes, so a width taken to 0 on a look whose
  edge radius is 0 moves the edge instead of refusing. `main.js` asks this and knows none of it --
  the rule is `geom/profile.js`'s and which field to move is `geom/profiles-catalog.js`'s.

  A repaired value is still a value of its own field, so it goes back through the same clamp
  everything else does.
*/
export function repairedRepresentationSettings(representation, settings, changedField) {
  const look = lookFor(representation);
  if (!look || !settings) return {};
  return Object.fromEntries(
    Object.entries(repairLookSettings(look, settings, changedField)).map(([field, value]) => [
      field, constrainedRepresentationSetting(representation, field, value, settings[field]),
    ]),
  );
}


/*
  A settings block **paired with the representation it will be drawn as**: every field that look or
  rung offers, taken from `settings` where it names one and from the authored default where it does
  not, and clamped rather than refused.

  `validatedRepresentationSettings()` below is the strict form and is right for a request, which is
  a document that has to mean exactly what it says. This is the lenient one, for the place where a
  block authored against *some* representation meets *this* one -- a Style overlay pass declares
  the block, the pickers resolve the representation, and `captureSelectionLayer()` is the one
  caller. An import does **not** come through here: `session-format.js` narrows on its own path,
  and the only block that reaches this function in a foreign vocabulary is an imported layer whose
  representation id did not resolve, which that path keeps whole by design.

  **The trap is that a mismatch is silent for a look with no controls.** Against `[]` the strict
  validator walks no fields, returns `{}` and throws nothing, so a block naming fields the look
  lacks is dropped whole and the authored numbers stand. `surface`, `ribbon` and the nucleic
  backbones offer two, four and four controls (a cartoon thirteen), so against them the same block
  is a settings object missing every field the validator walks, which is a refusal rather than a
  fallback. Narrowing is what keeps the two halves apart: the fields this tree does have
  (`sphere_radius`, `bond_radius`, `stick_radius`, `show_hydrogens`) are the caller's, and the ones
  it does not are the look's.
*/
export function narrowedRepresentationSettings(representation, settings) {
  const controls = representationSettingControls(representation);
  if (controls.length === 0) return undefined;
  const authored = representationSettingsForRepresentation(representation) ?? {};
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return { ...authored };
  return Object.fromEntries(controls.map(([field]) => [
    field,
    settings[field] === undefined
      ? authored[field]
      : constrainedRepresentationSetting(representation, field, settings[field], authored[field]),
  ]));
}


export function validatedRepresentationSettings(representation, settings) {
  const controls = representationSettingControls(representation);
  if (controls.length === 0 || !settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('Geometry settings require a supported protein representation.');
  }
  const result = {};
  controls.forEach((control) => {
    const [field, , minimum, maximum, , integer] = control;
    if (isBooleanRepresentationSetting(control)) {
      // A session without this field takes the shipped default rather than being rejected.
      const shown = settings[field]
        ?? representationSettingsForRepresentation(representation)[field];
      if (typeof shown !== 'boolean') {
        throw new Error(`${field.replaceAll('_', ' ')} must be true or false.`);
      }
      result[field] = shown;
      return;
    }
    const value = settings[field];
    if (typeof value !== 'number' || !Number.isFinite(value)
      || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
      const qualifier = integer ? 'whole number ' : '';
      throw new Error(
        `${field.replaceAll('_', ' ')} must be a ${qualifier}between ${minimum} and ${maximum}.`,
      );
    }
    result[field] = value;
  });
  return result;
}

const SURFACE_DETAIL_REPRESENTATIONS = [
  'surface',
  'surface_soft_pockets',
  'surface_smooth_pockets',
  'surface_open_cavities',
];

/*
  Type to representation id, in `CARTOON_TYPE_OPTIONS` order. Every right-hand value has a row in
  `src/capabilities.js`.

  **`cords` and `lowpoly` are offered and `cartoon_prism` is not**, which is a choice about the
  picker rather than a measurement. All three still render; only two of them are offered.

  **`slender` is gone from this table.** It named `cartoon_slender`, whose numbers
  `cartoon` now carries, so the pair would have been one look under two names -- see
  `geom/profiles-catalog.js`'s `cartoon` block. `session-format.js` migrates the id and the type.
*/
const CARTOON_TYPE_REPRESENTATIONS = [
  ['railed', 'cartoon_railed'],
  ['classic', 'cartoon'],
  ['chonky', 'cartoon_chonky'],
  ['railed_blend', 'cartoon_railed_blend'],
  ['railed_chonky', 'cartoon_railed_chonky'],
  ['geometric', 'cartoon_geometric'],
  ['cords', 'cartoon_cords'],
  ['lowpoly', 'cartoon_lowpoly'],
];

const RIBBON_TYPE_REPRESENTATIONS = [
  ['standard', 'ribbon'],
  ['slender', 'ribbon_slender'],
  ['tape', 'ribbon_tape'],
];

const ATOM_SCOPE_REPRESENTATIONS = [
  ['sticks', 'side_chain_sticks'],
  ['ball_and_stick', 'side_chain_ball_and_stick'],
  ['ball_and_stick_refined', 'side_chain_ball_and_stick_refined'],
  ['spheres', 'side_chain_spheres'],
  ['spheres_refined', 'side_chain_spheres_refined'],
];

/*
  What a selection layer may be drawn as, **in `src/capabilities.js`'s own vocabulary**.

  One vocabulary, the prefixed one, and no alias table anywhere in the tree. Unprefixed names -- a
  ligand layer saying `spheres`, an ion layer `faceted` -- are two vocabularies for one set of
  looks, and measured: of the fifteen ids the four namespaces offer, fourteen resolve against our
  table **by coincidence** -- a ligand layer's `spheres` landing on the *protein* row of that name
  and happening to carry the right family -- and `faceted` does not resolve at all, so an ion layer
  under the faceted look would draw nothing. Every value below has a row in `capabilities.js` and
  is asserted against it, so the resolution is by construction rather than by luck.

  Ordered as `catalog/representations.js` orders the rail's pickers, so a layer lists the
  representations in the same order the left rail shows them.
*/
const COMPONENT_REPRESENTATIONS = {
  protein: [
    ['cartoon', 'Cartoon'],
    ['ribbon', 'Ribbon'],
    ['surface', 'Surface'],
    ['ball_and_stick', 'Ball & stick'],
    ['sticks', 'Sticks'],
    ['spheres', 'Spheres'],
  ],
  ligand: [
    ['ligand_ball_and_stick', 'Ball & stick'],
    ['ligand_sticks', 'Sticks'],
    ['ligand_spheres', 'Spheres'],
  ],
  nucleic: [
    ['nucleic_blocks', 'Blocks'],
    ['nucleic_rings', 'Rings'],
    ['nucleic_cartoon', 'Tape'],
    ['nucleic_ribbon', 'Ribbon'],
    ['nucleic_ball_and_stick', 'Ball & stick'],
    ['nucleic_sticks', 'Sticks'],
    ['nucleic_spheres', 'Spheres'],
    ['nucleic_surface', 'Surface'],
  ],
  ion: [
    ['ion_spheres', 'Smooth spheres'],
    ['ion_faceted', 'Faceted markers'],
    ['ion_octahedron', 'Octahedral markers'],
  ],
  // One look, so a water layer's picker has one option in it. That is not a gap: the size and the
  // colour are the controls, and the shape is not one (`src/capabilities.js`).
  water: [
    ['water_dots', 'Small spheres'],
  ],
};


export function representationForSurfaceDetail(representation, detail) {
  if (representation !== 'surface') return representation;
  const index = Number(detail) - 1;
  return SURFACE_DETAIL_REPRESENTATIONS[index] ?? SURFACE_DETAIL_REPRESENTATIONS[0];
}


export function surfaceDetailForRepresentation(representation) {
  const index = SURFACE_DETAIL_REPRESENTATIONS.indexOf(representation);
  return index < 0 ? undefined : index + 1;
}


export function representationForCartoonType(representation, type) {
  if (representation !== 'cartoon') return representation;
  return CARTOON_TYPE_REPRESENTATIONS.find(([value]) => value === type)?.[1] ?? 'cartoon';
}


export function cartoonTypeForRepresentation(representation) {
  return CARTOON_TYPE_REPRESENTATIONS.find(([, value]) => value === representation)?.[0];
}


export function representationForRibbonType(representation, type) {
  if (representation !== 'ribbon') return representation;
  return RIBBON_TYPE_REPRESENTATIONS.find(([value]) => value === type)?.[1] ?? 'ribbon';
}


export function ribbonTypeForRepresentation(representation) {
  return RIBBON_TYPE_REPRESENTATIONS.find(([, value]) => value === representation)?.[0];
}


export function representationForAtomScope(representation, scope) {
  const pair = ATOM_SCOPE_REPRESENTATIONS.find(([allAtoms]) => allAtoms === representation);
  if (!pair) return representation;
  return scope === 'sidechains' ? pair[1] : pair[0];
}


export function atomScopeForRepresentation(representation) {
  const pair = ATOM_SCOPE_REPRESENTATIONS.find((representations) => (
    representations.includes(representation)
  ));
  if (!pair) return undefined;
  return representation === pair[1] ? 'sidechains' : 'all';
}


export function allAtomRepresentation(representation) {
  return ATOM_SCOPE_REPRESENTATIONS.find((representations) => (
    representations.includes(representation)
  ))?.[0];
}

const COMPONENT_LABELS = {
  protein: 'Protein',
  nucleic: 'Nucleic acid',
  ligand: 'Ligand',
  ion: 'Ion',
  water: 'Water',
};


export function polymerChainShortcuts(chainInstances) {
  const entityIdsByAuthorChain = new Map();
  chainInstances.forEach((instance) => {
    if (instance.entity_type !== 'polymer') return;
    const chainId = String(instance.chain_id ?? '').trim();
    const entityId = String(instance.entity_id ?? '').trim();
    if (!entityId) return;
    const entityIds = entityIdsByAuthorChain.get(chainId) ?? new Set();
    entityIds.add(entityId);
    entityIdsByAuthorChain.set(chainId, entityIds);
  });
  return [...entityIdsByAuthorChain.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([chainId, entityIds]) => ({
      chain_id: chainId,
      entity_ids: [...entityIds].sort((left, right) => left.localeCompare(right)),
    }));
}


export function polymerChainSelectionSchema(shortcut) {
  return {
    items: shortcut.entity_ids.map((entityId) => ({
      auth_asym_id: shortcut.chain_id,
      label_entity_id: entityId,
    })),
  };
}


/*
  No residue classifier lives here. Call instead:

  | question | call | where |
  | --- | --- | --- |
  | which component | `classifyResidue(name, group, atomCount, moleculeType, entityType)` | `src/residues.js` |
  | nucleic or not | `isNucleic(atom.moleculeType)` | Mol\*, via the atom |
  | which base | `nucleicBaseLabel(residueName)` | `src/color.js` |

  An ion is a name Mol\* calls an ion **and** a residue with one atom in it; a test on the name
  alone puts a sulfate on the marker path, and a marker only means anything on a monoatomic ion.

  Two classifiers of the nucleic question part on modified bases -- on 1EHZ, **14 of 76
  residues** -- and a tRNA renders in fifteen pieces. Two classifiers that agree on today's files
  agree by luck. There is one `Structure` and there is one answer.
*/

export function representationOptionsForComponents(componentTypes) {
  const types = [...new Set(componentTypes)].filter((type) => type in COMPONENT_REPRESENTATIONS);
  return types.length === 1 ? COMPONENT_REPRESENTATIONS[types[0]] : [];
}


export function componentTypeSummary(componentTypes) {
  const types = [...new Set(componentTypes)].filter((type) => type in COMPONENT_LABELS);
  return types.map((type) => COMPONENT_LABELS[type]).join(' + ') || 'Protein';
}


function compareResidues(left, right) {
  return left.chain_id.localeCompare(right.chain_id)
    || left.sequence_id - right.sequence_id
    || left.insertion_code.localeCompare(right.insertion_code);
}


export function normalizeResidues(residues) {
  const unique = new Map();
  residues.forEach((residue) => {
    const chainId = String(residue.chain_id ?? '').trim();
    const sequenceId = Number(residue.sequence_id);
    const insertionCode = String(residue.insertion_code ?? '').trim();
    if (!Number.isInteger(sequenceId)) return;
    const normalized = {
      chain_id: chainId,
      sequence_id: sequenceId,
      insertion_code: insertionCode,
    };
    unique.set(`${chainId}\u0000${sequenceId}\u0000${insertionCode}`, normalized);
  });
  return [...unique.values()].sort(compareResidues);
}


export function compressResidues(residues) {
  const normalized = normalizeResidues(residues);
  const residueRanges = [];
  const insertionResidues = [];
  const plainByChain = new Map();

  normalized.forEach((residue) => {
    if (residue.insertion_code) {
      insertionResidues.push(residue);
      return;
    }
    const sequenceIds = plainByChain.get(residue.chain_id) ?? [];
    sequenceIds.push(residue.sequence_id);
    plainByChain.set(residue.chain_id, sequenceIds);
  });

  [...plainByChain.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([chainId, sequenceIds]) => {
      let start;
      let end;
      sequenceIds.forEach((sequenceId) => {
        if (start === undefined) {
          start = sequenceId;
          end = sequenceId;
        } else if (sequenceId === end + 1) {
          end = sequenceId;
        } else {
          residueRanges.push({ chain_id: chainId, start, end });
          start = sequenceId;
          end = sequenceId;
        }
      });
      if (start !== undefined) residueRanges.push({ chain_id: chainId, start, end });
    });

  return {
    residue_ranges: residueRanges,
    residues: insertionResidues,
    residue_count: normalized.length,
    chains: [...new Set(normalized.map((residue) => residue.chain_id))].sort(),
  };
}


export function selectionSummary(selection) {
  const count = selection.residue_count;
  const residueLabel = `${count} residue${count === 1 ? '' : 's'}`;
  const chains = selection.chains.map((chain) => chain || '(blank)').join(', ');
  return `${residueLabel} · Chain${selection.chains.length === 1 ? '' : 's'} ${chains}`;
}
