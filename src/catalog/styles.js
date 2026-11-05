/*
  Styles: the image-led preset feature.

  A Style is frontend-only. It writes values into controls that already exist, so it introduces no
  request field at all.

  STYLE_FIELDS is the enforceable half of that promise. It is an allowlist: a Style may write these
  forty-five fields and nothing else, so a Style can never reach camera framing, the Output card or
  the loaded structure, all of which are deliberately absent from it. `styleWrites()` rejects any
  other key rather than ignoring it, so a typo fails loudly instead of silently doing nothing.

  Not `view_transform`. It is an Output-card control -- it sits behind that card's
  `Advanced settings` beside the render size, the samples and denoising -- and the Output card is
  the user's statement of what this session renders at, not something a picture clicked in the
  gallery gets to rewrite: a Style that authored it would silently reset a view transform the user
  had chosen.
  A Style is a look on the composition; the Output card is how that composition is written out.
  Leaving it out also makes "a Style changes nothing in Output" checkable by grep.

  Three of the forty-five are camera-adjacent, and they are the deliberate exceptions to "a Style
  never touches the camera": the two depth-of-field fields and `focal_length`. None of them is
  *framing* -- framing is where the camera stands, what it points at and what is therefore in shot,
  and that is what `STYLE_NEVER_WRITES` still names.
  All three are authored exactly like every other field, as a value on an existing Camera-card
  control applied through the same `styleWrites()`/`applyWrites()` path. The Style options panel
  does not offer depth of field for editing before applying -- see the panel's own comment in
  `src/styles-strip.js` -- so the authored value is what renders, and changing any
  of the three afterwards is the Camera card's job.

  `focal_length` is baselined like every other key: a Style silent on it resets the lens to 29mm,
  the control's own fresh-app position. See `STYLE_BASELINE`.

  Key order is apply order and matters four times over: `representation` must land before its type,
  because main.js only enables #cartoon-type once #representation is `cartoon`; `color_mode` must
  land before `color` and the gradient pair, because the mode decides which of them the picture
  reads; a component's `enabled` checkbox must land before that component's own controls, since a
  disabled component hides its detail row; and `lighting_source` must land before
  `reflection_environment`, because changing the source relabels the reflection options.

  The component blocks (nucleic, ligand, ion) are what make "Protein + DNA" and "Ghost protein,
  bright ligand" real Styles rather than ones that merely switch a component on and leave it the
  colour it happened to be. They are still only controls that already exist, so the promise at the
  top of this file is unchanged: no request field.

  Adding or removing a Style is a one-file edit plus a baked WebP tile -- no HTML, no CSS, no
  picker code.

  ----

  **An `id` never moves; its caption moves with the geometry.** `ridged_trace` draws the railed
  cartoon under an id that says ridged, so every saved session resolves, and its `label` and `blurb`
  say what the app draws, because a caption is part of a tile. The railed cartoon is the raised edge
  a ridge would promise: `r > h` is a bevel and no value of it raises an edge above a face, while a
  cord laid on the panel's own outer edge stands proud.

  **Every one of the ninety tiles in `src/thumbs/style/` is a render made by this renderer**, and
  none is a picture of geometry produced by anything else. That is what makes a tile a promise the
  app can keep, and it is why the tiles are baked here rather than carried in with the entries.
*/

import { DEFAULT_CARTOON_TYPE } from '../selection-model.js';

export const STYLE_FIELDS = {
  representation: { control: 'representation', event: 'change' },
  cartoon_type: { control: 'cartoon-type', event: 'change' },
  ribbon_type: { control: 'ribbon-type', event: 'change' },
  surface_detail: { control: 'surface-detail', event: 'change' },
  atom_scope: { control: 'atom-scope', event: 'change' },
  material: { control: 'material', event: 'change' },
  color_mode: { control: 'protein-color-mode', event: 'change' },
  // #color-hex, not #color-wheel: its handler normalises the text and calls setColor(), which
  // writes the wheel, the hex field and the preset row together.
  color: { control: 'color-hex', event: 'input' },
  // Read only by the gradient colour modes (sequence, the three axis ramps). Writing them under a
  // uniform Style is harmless and keeps a later mode change from picking up a previous Style's ramp.
  gradient_start: { control: 'protein-gradient-start-hex', event: 'input' },
  gradient_end: { control: 'protein-gradient-end-hex', event: 'input' },
  opacity: { control: 'protein-opacity', event: 'input' },
  emission_strength: { control: 'protein-emission-strength', event: 'input' },

  /*
    The three component blocks. Each leads with its own visibility checkbox, because a component
    that is off hides its detail row -- and because a Style that colours a ligand without asking for
    the ligand to be drawn is describing a picture nobody will see.

    `nucleic_enabled` is written only by Styles that are about nucleic acid. main.js auto-enables
    the component when the structure has one, so a Style that stayed silent here still gets the DNA;
    what these Styles add is what it looks like.
  */
  nucleic_enabled: { control: 'nucleic-enabled', event: 'change', kind: 'checkbox' },
  nucleic_representation: { control: 'nucleic-representation', event: 'change' },
  nucleic_material: { control: 'nucleic-material', event: 'change' },
  nucleic_color_mode: { control: 'nucleic-color-mode', event: 'change' },
  nucleic_color: { control: 'nucleic-color-hex', event: 'input' },
  /*
    The nucleic block's gradient endpoints, and the mirror of the protein pair above.
    `nucleic_duplex` and a nucleic `sequence` ramp are two of the most useful things a duplex can be
    coloured by, and without a control for their endpoints a Style could select the mode with no way
    to say what the two colours are -- the picture would come back in the app's own defaults, and a
    colour scheme would have nothing to write.
  */
  nucleic_gradient_start: { control: 'nucleic-gradient-start-hex', event: 'input' },
  nucleic_gradient_end: { control: 'nucleic-gradient-end-hex', event: 'input' },
  nucleic_opacity: { control: 'nucleic-opacity', event: 'input' },
  /*
    The three component emission strengths and the ion alpha complete the set, and completeness is the
    reason they are here: only the ligand strength is authored away from its default anywhere in the
    catalogue, by the two Styles whose ligand is genuinely bioluminescent. They are on the
    allowlist so `resolvedStyleWrites()` can *reset* them, which is what closes the last gap in "a
    Style describes the whole picture". Without them a user who had turned ion alpha down to 0.3, or
    lit a ligand with an emissive material, would keep that under every Style afterwards -- and every
    one of those Styles would render something it never described.
  */
  nucleic_emission_strength: { control: 'nucleic-emission-strength', event: 'input' },

  ligands: { control: 'ligand-enabled', event: 'change', kind: 'checkbox' },
  ligand_representation: { control: 'ligand-representation', event: 'change' },
  ligand_material: { control: 'ligand-material', event: 'change' },
  ligand_color_mode: { control: 'ligand-color-mode', event: 'change' },
  ligand_color: { control: 'ligand-color-hex', event: 'input' },
  ligand_opacity: { control: 'ligand-opacity', event: 'input' },
  ligand_emission_strength: { control: 'ligand-emission-strength', event: 'input' },

  ions: { control: 'ion-enabled', event: 'change', kind: 'checkbox' },
  ion_representation: { control: 'ion-representation', event: 'change' },
  ion_material: { control: 'ion-material', event: 'change' },
  ion_color_mode: { control: 'ion-color-mode', event: 'change' },
  ion_color: { control: 'ion-color-hex', event: 'input' },
  ion_opacity: { control: 'ion-opacity', event: 'input' },
  // #ion-fluorescence, not #ion-emission-strength: the control predates the shared naming.
  ion_emission_strength: { control: 'ion-fluorescence', event: 'input' },

  lighting_source: { control: 'lighting-source', event: 'change' },
  lighting_strength: { control: 'lighting-strength', event: 'input' },
  lighting_anchor: { control: 'lighting-anchor', event: 'change' },
  lighting_elevation: { control: 'hdri-elevation', event: 'input' },
  lighting_azimuth: { control: 'hdri-azimuth', event: 'input' },
  reflection_environment: { control: 'reflection-environment', event: 'change' },
  // After the mode, which enables it. Baselined so `ghost_surface`'s 'color' reflects the hex its
  // tile was baked with, not the user's last one.
  reflection_color: { control: 'reflection-color-hex', event: 'input' },

  /*
    The camera-adjacent group, and the two deliberate exceptions to "a Style never touches the
    camera". Neither of them is *framing*: framing is where the camera stands, what it points at and
    what is therefore in shot, and a Style may not move any of that.

    Depth of field: see the file header.

    `focal_length` is here because a lens is a property of the look rather than of the shot. The
    four wide `wide_*` Styles in Multimers were composed on a 14mm lens on purpose: the whole point
    of those pictures is the perspective rushing away down the assembly, and a tile rendered at 14mm
    applied at the user's 50mm is a different picture wearing the same name. `#focal-length` dollies
    from the current camera as it changes (`focalLengthDollyScale()`), so writing it changes the
    perspective and keeps the subject the same size -- it is the one camera control that does not
    reframe.

    Like every other allowlisted field it is full-replaced on every apply, so a Style that states
    no lens resets it to STYLE_BASELINE's 29mm rather than inheriting the previous Style's.
  */
  focal_length: { control: 'focal-length', event: 'input' },
  depth_of_field_enabled: { control: 'depth-of-field-enabled', event: 'change', kind: 'checkbox' },
  depth_of_field_f_stop: { control: 'f-stop', event: 'input' },
};

/*
  Named so the exclusion is greppable, and held by assertion rather than by convention.

  Selection layers are not on this list; the line is narrower than "layers" and is enforced in
  style-overlays.js: a Style may declare overlay passes scoped to a whole component, and may never
  name a chain, a residue, a range or an atom -- the narrowest line the evidence supports, and not a
  wider one.
*/
export const STYLE_NEVER_WRITES = [
  'camera framing (#fit-visible-structure): where the camera stands and what is in shot.\n   The lens (#focal-length) is not framing and is on the allowlist -- see below',
  'residue-level selections of any kind (an overlay pass names a component, never a residue)',
  'render dimensions and samples (#render-width, #render-height, #render-samples)',
  'anything in the Output card, the view transform and denoising included (#output-advanced)',
  'the depth-of-field focus point (#pick-depth-of-field-focus), which is a live Mol* pick',
  'the loaded structure',
];

/*
  The value each STYLE_FIELDS control resets to when a Style stays silent on it. Applying a Style
  without this would be a merge into whatever the previously applied Style (or a manual edit) left
  behind -- e.g. a ligand-focused Style turns ligands on, and the next Style, having no opinion on
  ligands, would leave them on. `resolvedStyleWrites()` below reads this so every apply is a full,
  deterministic replace of all forty-five fields instead.

  Each value is the control's own fresh-app default, taken straight from index.html (or
  DEFAULT_CARTOON_TYPE for cartoon_type, the one field with a named constant instead). Every
  baselined field is held equal to that markup by assertion, so a value that drifts from the
  control's fresh position is a named failure rather than a Style that quietly resets it wrong.

  `focal_length` is baselined at '29', the control's own fresh-app position. Omitting it would mean
  a Style silent on the lens emits no write at all, so the 14mm of the four wide Multimers Styles
  would stick to every Style applied after them -- a picture composed on a lens it never asked for,
  with nothing reporting it. The two costs of baselining it are known and accepted: an apply nudges
  a composition by the
  fraction of a degree between the live field of view and the nearest whole stop (the readout rounds
  where the camera does not), and a lens the user set by hand is reset by the next Style that has no
  opinion about lenses. Both are the same full-replace promise every other field already makes, and
  a visible reset beats a silent inheritance.

  Three more STYLE_FIELDS keys are deliberately absent: `ligands`, `ions` and `nucleic_enabled`,
  none of which resets to its fresh-page value. main.js tracks nucleic acid to the loaded structure
  on every load, so `resolvedStyleWrites()` takes it from context. A fresh page draws ligands and
  ions, but a Style silent about them turns them off -- in a group it replaces, and in one it does
  not while the switch still holds that unchosen default (`context.unchosen`) -- so it draws what
  its tile shows. That `false` is the Style's rule, not a copy of the markup.
*/
export const STYLE_BASELINE = {
  representation: 'cartoon',
  cartoon_type: DEFAULT_CARTOON_TYPE,
  ribbon_type: 'standard',
  surface_detail: '1',
  atom_scope: 'all',
  material: 'diffuse',
  color_mode: 'uniform',
  color: '#58BFA8',
  gradient_start: '#176FD3',
  gradient_end: '#E2B84B',
  opacity: '1',
  emission_strength: '3.5',
  nucleic_representation: 'nucleic_blocks',
  nucleic_material: 'diffuse',
  nucleic_color_mode: 'nucleic_base',
  nucleic_color: '#8A51C2',
  nucleic_gradient_start: '#58BFA8',
  nucleic_gradient_end: '#E56B6F',
  nucleic_opacity: '1',
  nucleic_emission_strength: '3.5',
  ligand_representation: 'ligand_ball_and_stick',
  ligand_material: 'diffuse',
  ligand_color_mode: 'element',
  ligand_color: '#E56B6F',
  ligand_opacity: '1',
  ligand_emission_strength: '3.5',
  ion_representation: 'ion_spheres',
  ion_material: 'diffuse',
  ion_color_mode: 'element',
  ion_color: '#E2B84B',
  ion_opacity: '1',
  ion_emission_strength: '3.5',
  lighting_source: 'autumn_meadow',
  lighting_strength: '1',
  lighting_anchor: 'camera',
  lighting_elevation: '-168.5',
  lighting_azimuth: '21.1',
  reflection_environment: 'source',
  reflection_color: '#182533',
  focal_length: '29',
  depth_of_field_enabled: false,
  depth_of_field_f_stop: '2.8',
};


/*
  The rows the gallery is organised into, in the order it shows them.

  They are *structure classes*, not visual families, and that choice is worth stating because the
  obvious alternative fails. A "publication" look at capsid scale is a by-chain
  surface and at monomer scale a railed cartoon -- same intent, wholly different recipe -- so
  organising by intent would have put visually unrelated tiles side by side and left the reader
  comparing pictures that were never alternatives to each other.

  A row never gates on the loaded structure. Every tile is always clickable: by-chain colour on a
  monomer is one colour rather than an error, and `applyStyleWrites()` already skips a colour mode
  the structure does not offer. All the structure-awareness lives in one place --
  `style-recommendations.js` and the Recommended row it fills -- which is what keeps this file a
  catalogue rather than a second rule engine.

  `cover` is the row a purely structural taxonomy would lose, and it holds the looks people
  enjoy most. It exists so the gallery is not only a filing system.
*/
export const STYLE_ROWS = [
  {
    id: 'detailed',
    label: 'Small & detailed',
    blurb: 'One chain, small enough to draw individual atoms and side chains.',
  },
  {
    id: 'monomers',
    label: 'Monomers & domains',
    blurb: 'One polymer chain, at any size: the general-purpose overviews.',
  },
  {
    id: 'multimers',
    label: 'Multimers',
    blurb: 'Several chains, where telling them apart is the point of the picture.',
  },
  /*
    Two rows, split on the question each half answers. `multimers` is "how many chains is this and
    which is which", asked of a whole oligomer; `interfaces` is "what is bound here and where do the
    two sides meet", asked of exactly two partners. As one shelf of twenty-two tiles under a
    two-noun heading, the interface half would be reached by scrolling past ten by-chain looks that
    are not alternatives to it.

    The split is mechanical, not editorial: every `interfaces` entry is one of the twelve
    scope-sided duo Styles -- `duo_scheme` set, `duo_sides` unset, one overlay pass per side --
    which is a set the shape of the entries already defines.
  */
  {
    id: 'interfaces',
    label: 'Protein Interfaces',
    blurb: 'Two partners in contact, with each side given its own treatment.',
  },
  /*
    Three rows, and the order inside them is the order of how much of the picture the non-protein
    part takes up. A protein/DNA complex is a picture *of* the complex, a
    bound ligand is usually a detail in a picture of a protein, and an ion is a single atom -- so
    Nucleic acids leads, Ions closes, and the shelf a reader stops at is the one that matches what
    they loaded. As one row it would be nineteen tiles under a three-noun heading, which names the
    row's contents rather than answering a question, and the reader would have to scan the whole
    shelf to find the third of it that is about their file.

    They sit *above* Assemblies & machines for the same reason: what is bound in a structure is a
    more common question than what a capsid looks like, and the rows a reader scrolls past first
    should be the ones most files have an answer in.
  */
  {
    id: 'nucleic',
    label: 'Nucleic acids',
    blurb: 'DNA or RNA alongside protein, where the complex is the subject.',
  },
  {
    id: 'ligands',
    label: 'Ligands',
    blurb: 'A bound ligand, made the subject of the picture rather than a detail in it.',
  },
  {
    id: 'ions',
    label: 'Ions',
    blurb: 'A single bound atom, and what it takes to make one atom read.',
  },
  {
    id: 'assemblies',
    label: 'Assemblies & machines',
    blurb: 'Capsids, motors and filaments, where a surface reads better than ribbons.',
  },
  {
    /*
      Two rows, one question asked of two kinds of file: which part of this model should you
      believe? A predicted model answers it with pLDDT and an experimental one with B-factor, and no
      structure ever carries both -- `structureProfile()` reports a single `metric` -- so a reader
      only ever has business in one of them. As two shelves, a reader can tell at a glance which is
      theirs, rather than reading four tiles in before the ramp says so.

      The two rows are four looks each and the four are the *same* four: cartoon, sphere pack,
      surface, and cartoon with side chains. Only `color_mode` differs across the pair, which is
      what makes the ramp the one variable a reader has to account for.
    */
    id: 'predicted',
    label: 'Confidence (pLDDT)',
    blurb: 'Predicted models coloured by pLDDT: which part of the model to believe.',
  },
  {
    id: 'disorder',
    label: 'Disorder (B-factor)',
    blurb: 'Experimental models coloured by B-factor: what is well ordered and what moves.',
  },
  {
    id: 'cover',
    label: 'Concept',
    blurb: 'Materials and light for their own sake. Suits any structure.',
  },
];

export const STYLE_ROW_IDS = STYLE_ROWS.map((row) => row.id);


/*
  A `row` is a shelf in the gallery; a `pool` is what the recommender draws from. They are the same
  thing for nine of the eleven rows, and `stylePool()` says so by falling back to the row.

  Two rows split, because half of each suits a structure the other half does not, and a shelf is a
  worse place to say that than a field. **Multimers** holds six by-chain looks that need more than
  one chain and four wide-angle looks that suit anything, so the wide four are recommendable for a
  monomer while sitting on the multimer shelf a reader browses. **Interfaces** holds twelve duo
  looks split by how the partner is drawn: `interfaces_peptide` draws it atom by atom, which only
  reads for a small partner, and `interfaces_domain` draws it as cartoon or ribbon, which reads at
  any size. The split is mechanical -- it is the representation of the partner pass -- so a
  new interface Style files itself by looking at its own second pass.

  `cover` names no pool and is the one row that is never recommended: Concept is a shelf to browse,
  not an answer to what was loaded.
*/
export function stylePool(style) {
  return style.pool ?? style.row;
}


export function stylesInRow(rowId, catalog = STYLE_CATALOG) {
  return catalog.filter((style) => style.row === rowId);
}


export function stylesInPool(poolId, catalog = STYLE_CATALOG) {
  return catalog.filter((style) => stylePool(style) === poolId);
}


/*
  STACKING: which component a field belongs to, and why a Style may inherit one it never mentions.

  The full replace below is the right rule *within* a picture: a Style owns its protein look, and a
  chain palette the previous Style left behind leaking into the next one is a render that disagrees
  with the name on the bar. It is the wrong rule *between* components. Applying an ion Style and
  then a protein Style is a reasonable thing to do -- the two describe different parts of one
  picture -- and a full replace of all forty-five fields would answer it by switching the ions back
  off and forgetting everything the ion Style said about them.

  So the fields are grouped by the component they describe, and an apply full-replaces only the
  component groups the incoming Style actually has an opinion about. A group it stays silent on
  keeps whatever is there -- the previous Style's ions, or the user's own. That is the whole of the
  stacking rule:

      The latest Style is primary. Every group it touches is replaced outright.
      Every group it does not touch is left alone.

  A group counts as touched when the Style declares any field in it, or aims an overlay pass at it
  (`overlayComponents()` in style-overlays.js supplies the second half; the caller unions them).
  There is no merging inside a group and no per-field precedence, so there is never a picture that
  is half one Style and half another within one component: a conflict is decided by the newer Style
  taking the whole group.

  Everything outside the four groups -- lighting, the lens, depth of field -- is `global` and is
  always replaced, because that is what makes the incoming Style primary rather than one voice among
  several. Two Styles cannot each light the same picture.

  A key that is not listed here is global, which is the conservative side: an unlisted field is
  full-replaced on every apply.
*/
export const STYLE_COMPONENT_GROUPS = ['protein', 'nucleic', 'ligand', 'ion'];

const PROTEIN_STYLE_FIELDS = new Set([
  'representation',
  'cartoon_type',
  'ribbon_type',
  'surface_detail',
  'atom_scope',
  'material',
  'color_mode',
  'color',
  'gradient_start',
  'gradient_end',
  'opacity',
  'emission_strength',
]);

export function styleFieldComponent(key) {
  if (PROTEIN_STYLE_FIELDS.has(key)) return 'protein';
  if (key === 'nucleic_enabled' || key.startsWith('nucleic_')) return 'nucleic';
  if (key === 'ligands' || key.startsWith('ligand_')) return 'ligand';
  if (key === 'ions' || key.startsWith('ion_')) return 'ion';
  return 'global';
}

/*
  The component groups a Style states something about through its `writes`. The overlay half lives in
  style-overlays.js, and `styles-strip.js` unions the two: a Style whose only ligand opinion is an
  overlay pass still owns the ligand group, or its pass would sit over a ligand base the previous
  Style set.
*/
export function styleWrittenComponents(style) {
  const writes = assertKnownWrites(style);
  return new Set(
    Object.keys(writes)
      .map(styleFieldComponent)
      .filter((group) => group !== 'global'),
  );
}


/*
  Turns a Style into the ordered list of writes that applies it. Pure, so the shape and the
  allowlist can be tested without a DOM.
*/
function assertKnownWrites(style) {
  const writes = style?.writes ?? {};
  for (const key of Object.keys(writes)) {
    if (!(key in STYLE_FIELDS)) {
      throw new Error(`Style ${style?.id} writes unsupported field ${JSON.stringify(key)}.`);
    }
  }
  return writes;
}

export function styleWrites(style) {
  const writes = assertKnownWrites(style);
  return Object.entries(STYLE_FIELDS)
    .filter(([key]) => writes[key] !== undefined)
    .map(([key, field]) => ({ ...field, field: key, value: writes[key] }));
}

/*
  styleWrites()'s full-replace counterpart: every STYLE_FIELDS key, always, so applying a Style can
  never leave a field at whatever the previously applied Style left it. A Style's own declared
  value wins; everything it stays silent on falls back to STYLE_BASELINE, except the three
  component-visibility checkboxes documented above it.
  `focal_length` is included: a Style with no opinion about the lens resets it to 29mm rather than
  inheriting whichever lens the previously applied Style left standing.
*/
export function resolvedStyleWrites(style, context = {}) {
  const writes = assertKnownWrites(style);
  const baseline = (key) => {
    if (key === 'ligands' || key === 'ions') return false;
    if (key === 'nucleic_enabled') return Boolean(context.nucleicPresent);
    return STYLE_BASELINE[key];
  };
  /*
    `context.components` is the stacking rule (see STYLE_COMPONENT_GROUPS above): the set of
    component groups this apply replaces. A field in a group outside it is *omitted from the list
    entirely* rather than written -- not written back at its current value -- so a group the Style
    is silent about keeps whatever is on screen without the control being touched, dispatched or
    marked. Omitting it is what leaves the previous Style's ion look, and the layers built for it,
    standing.

    Absent, every field is resolved. The sweep passes nothing on purpose: a walk
    has to render each tile as its own whole picture, or the twelfth result would carry the eleven
    before it and stop matching the thumbnail that was clicked.
  */
  const replaces = (key) => {
    if (!context.components || context.unchosen?.has(key)) return true;
    const group = styleFieldComponent(key);
    return group === 'global' || context.components.has(group);
  };
  return Object.entries(STYLE_FIELDS)
    .filter(([key]) => replaces(key))
    .map(([key, field]) => ({
      ...field,
      field: key,
      value: writes[key] !== undefined ? writes[key] : baseline(key),
    }));
}


// The eight pairs every sequence-gradient Style offers, in one order: one copy, or a missed edit
// gives one Style a menu its `As designed` swatch is not a member of.
const SEQUENCE_GRADIENT_PAIRS = Object.freeze([
  ['#178BD3', '#E2A34B'],
  ['#30CFB4', '#DD46AD'],
  ['#8EDC84', '#D98CD2'],
  ['#D27941', '#4B8AE2'],
  ['#D651A3', '#5DD5A3'],
  ['#955ED9', '#4EDAC9'],
  ['#5ED9C5', '#D7DA4E'],
  ['#D55D48', '#DB486D'],
].map(Object.freeze));


/*
  Ninety Styles across the eleven rows above.

  Most of them were derived from compositions someone actually made rather than invented: each was
  read for its exact representation, material, colour, lighting and view transform, and the looks
  that recurred became Styles. That provenance is why the catalogue is worth thirty-odd entries
  instead of ten: these are pictures someone actually wanted.

  +-------------------------------------------------------------------------------------------+
  | WHERE THE NUMBERS COME FROM, AND WHAT THAT IS WORTH HERE. **Every number below is         |
  | carried rather than derived.** The compositions they were read out of are not part of     |
  | this repository, so nothing here can be re-derived or re-checked against its origin.      |
  |                                                                                           |
  | What stands in for that missing check is the bake: every tile in `src/thumbs/style/` is   |
  | a render of its own entry made by this renderer, so an entry and its tile cannot          |
  | disagree.                                                                                 |
  |                                                                                           |
  | An entry marked "by hand" was written rather than derived, usually because its source     |
  | carried a selection a Style may not express. Two things a composition could state that a  |
  | Style cannot: the per-element colour table (a Style reaches per-label colours only        |
  | through a colour scheme, so carbon renders at its own default), and hidden or             |
  | partial-component layers, which are composition rather than look.                         |
  +-------------------------------------------------------------------------------------------+

  The saved Improve image recipe is the one part of a session that is carried separately: it lives
  in `src/catalog/style-improve.js`, keyed by Style id, and the Style card's Improve image switch
  arms it on apply -- so a Style composed at shadows -90 is finished at shadows -90 rather than at
  the panel's generic Auto improve. The switch decides *whether* to finish, never *how*.

  Optional fields beyond `writes`:

    row            -- which shelf of the gallery it sits on. Exactly one; a Style in two rows would
                      read as a duplicate rather than as a cross-reference.
    requires       -- what data the look needs to *mean* anything. It never blocks applying; it only
                      keeps a Style off the Recommended row when the data is absent. pLDDT colouring
                      over a crystal structure is the case it exists for: it paints confidence bands
                      out of refined B-factors and says something false.
    overlays       -- extra whole-component rendering passes. See src/style-overlays.js for the
                      rule and, more importantly, for why a pass list that touches the protein almost
                      always has to open with `{ component: 'protein', from: 'base' }`.
    scheme_target  -- which component the Style options panel offers colour alternates for. Defaults
                      to `protein`, and `ghost_ligand` is the one Style that declares anything else:
                      it ghosts the protein to 0.3 so the molecule can be the subject, and its
                      molecule is drawn by element, which no pair could recolour truthfully. See
                      src/style-color-schemes.js.
    color_schemes  -- the alternate gradient pairs the options panel offers after `As designed`, for
                      a gradient-mode Style whose alternates were chosen by eye. Omit it and
                      `suggestColorSchemePairs()` generates them by rotating the authored hues; that
                      rule makes a pleasant set but cannot make a specific one. Gradient modes only:
                      every other mode picks a named family from a table.
    extra_colors   -- extra off-palette colours a uniform Style offers beside its own, drawn in the
                      `Style colours` group under the scheme row. `fluorescent_glow` is the one
                      Style that states any: its two other fluorophore hues. Uniform mode only,
                      because it is the authored *colour* the group is about.
    nucleo_scheme  -- which member of NUCLEO_SCHEMES a protein-and-nucleic Style rests on, by name.
                      One entry is a protein colour plus three nucleic colours, so one click
                      recolours both halves of the picture; where the three land follows the
                      Style's own nucleic colour mode. The five nucleosome Styles state it.
    scheme_tint    -- the overlay passes that follow whichever scheme the card is set to, as a
                      paler cast of it, rather than keeping their authored colour. For a shell read
                      *through*: `in_glass` and `fluorescent_glow` name their `Glass shell`. Naming
                      a pass that does not exist throws.
    color_scheme   -- which member of CATEGORICAL_SCHEMES a by-chain Style rests on, by name. A
                      *name*, never a palette: the family is per colour mode and shared, so a Style
                      stating its own colours would be stating a family of one. Silence rests on
                      Broad wheel.
    duo_scheme     -- which member of DUO_SCHEMES a two-sided Style rests on, by name. Required
                      rather than optional for the Styles that use it, and stating it is what makes
                      the two-colour family the one the options panel offers at all. See the
                      Protein Interfaces row, and `scope` in src/style-overlays.js for the passes
                      it colours.
    duo_sides      -- the two *components* a duo pair lands on, `[host, partner]`, for a Style whose
                      two sides are components rather than two sides of one protein. Omit it and the
                      pair is applied to the two scoped overlay passes, which is what the interface
                      Styles want; state it and the pair becomes two ordinary colour writes. The
                      four protein-against-ligand Styles in Ligands state it.
                      See src/style-color-schemes.js.
    duo_schemes    -- the members of DUO_SCHEMES a duo Style offers, by name, in the order to draw
                      them. Silence means all eighteen, which is what keeps the interface Styles one
                      identical row of swatches. `open_pocket` is the one Style that narrows it: its
                      picture is a cavity in a white body, and a saturated host turns the cavity
                      into a highlight. A list that omits the Style's own pair throws.
*/
export const STYLE_CATALOG = [
  /* ----------
    Small & detailed

    All seven come from one sitting's compositions -- see the box above this array for what that
    provenance is worth here.
  ---------- */
  {
    // Its whole-chain sticks layer masked the base away, so the
    // pass *is* the base here: same picture, no layer, and colour schemes to pick from.
    id: 'sticks_trace',
    row: 'detailed',
    label: 'Bond trace',
    blurb: 'Every bond drawn along the chain, in soft ceramic.',
    color_schemes: SEQUENCE_GRADIENT_PAIRS,
    writes: {
      representation: 'sticks',
      material: 'ceramic',
      color_mode: 'sequence',
      gradient_start: '#178BD3',
      gradient_end: '#E2A34B',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '175.2',
      lighting_azimuth: '2.1',
      reflection_environment: 'source',
      focal_length: '24',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.8',
    },
  },
  {
    /*
      Both passes cover the whole protein and neither
      mirrors the base, so the base renders nothing and this Style deliberately describes none: a
      representation or material written here would never appear.
    */
    id: 'tube_side_chains',
    row: 'detailed',
    label: 'Tube & side chains',
    blurb: 'A slim glossy tube with every side chain drawn out.',
    color_schemes: SEQUENCE_GRADIENT_PAIRS,
    writes: {
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '163.4',
      lighting_azimuth: '17',
      reflection_environment: 'source',
      focal_length: '24',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.8',
    },
    overlays: [
      {
        component: 'protein',
        name: 'Tube',
        representation: 'ribbon_slender',
        material: 'glossy',
        color_mode: 'sequence',
        gradient_start: '#30CFB4',
        gradient_end: '#DD46AD',
        opacity: 1,
      },
      {
        component: 'protein',
        name: 'Side chains',
        representation: 'side_chain_sticks',
        material: 'ceramic',
        color_mode: 'sequence',
        gradient_start: '#30CFB4',
        gradient_end: '#DD46AD',
        opacity: 1,
      },
    ],
  },
  {
    id: 'cartoon_side_chains',
    row: 'detailed',
    label: 'Cartoon & side chains',
    blurb: 'Railed cartoon with pale mint side chains over it.',
    color_schemes: SEQUENCE_GRADIENT_PAIRS,
    writes: {
      representation: 'cartoon',
      cartoon_type: 'railed',
      material: 'ceramic',
      color_mode: 'sequence',
      gradient_start: '#8EDC84',
      gradient_end: '#D98CD2',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '175.2',
      lighting_azimuth: '2.1',
      reflection_environment: 'source',
      focal_length: '24',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.8',
    },
    overlays: [
      { component: 'protein', from: 'base', name: 'Backbone' },
      {
        component: 'protein',
        name: 'Side chains',
        representation: 'side_chain_sticks',
        material: 'soft_glossy',
        color_mode: 'sequence',
        gradient_start: '#8EDC84',
        gradient_end: '#D98CD2',
        color: '#ADFFED',
        opacity: 1,
      },
    ],
  },
  {
    /*
      A copy of the original, because
      that carries a hidden one-residue layer, which is a composition rather than a look and cannot
      be expressed as an overlay pass. Both remaining passes cover the whole protein and neither
      mirrors the base, so the base renders nothing and this Style deliberately describes none.
    */
    id: 'cartoon_ball_and_stick',
    row: 'detailed',
    label: 'Cartoon & ball-and-stick',
    blurb: 'A broad classic cartoon with every side chain beaded out in ball-and-stick.',
    color_schemes: SEQUENCE_GRADIENT_PAIRS,
    writes: {
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '175.2',
      lighting_azimuth: '2.1',
      reflection_environment: 'source',
      focal_length: '24',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.8',
    },
    overlays: [
      {
        component: 'protein',
        name: 'Backbone',
        representation: 'cartoon',
        material: 'ceramic',
        color_mode: 'sequence',
        gradient_start: '#D27941',
        gradient_end: '#4B8AE2',
        opacity: 1,
      },
      {
        component: 'protein',
        name: 'Side chains',
        representation: 'side_chain_ball_and_stick',
        representation_settings: { sphere_radius: 0.29, bond_radius: 0.2, show_hydrogens: false },
        material: 'soft_glossy',
        color_mode: 'sequence',
        gradient_start: '#D27941',
        gradient_end: '#4B8AE2',
        color: '#ADFFED',
        opacity: 1,
      },
    ],
  },
  {
    id: 'glass_tube',
    row: 'detailed',
    label: 'Glass tube',
    blurb: 'A glass tube drawn around a railed cartoon.',
    color_schemes: SEQUENCE_GRADIENT_PAIRS,
    writes: {
      representation: 'cartoon',
      cartoon_type: 'railed',
      material: 'ceramic',
      color_mode: 'sequence',
      gradient_start: '#D651A3',
      gradient_end: '#5DD5A3',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '175.2',
      lighting_azimuth: '2.1',
      reflection_environment: 'source',
      focal_length: '24',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.8',
    },
    overlays: [
      { component: 'protein', from: 'base', name: 'Backbone' },
      {
        component: 'protein',
        name: 'Glass tube',
        representation: 'ribbon',
        material: 'glass',
        color_mode: 'uniform',
        color: '#9FFEE9',
        opacity: 0.45,
      },
    ],
  },
  {
    id: 'ball_and_stick_element',
    row: 'detailed',
    label: 'Ball & stick',
    blurb: 'The chemistry-textbook view, coloured by element.',
    writes: {
      representation: 'ball_and_stick_refined',
      material: 'glossy',
      color_mode: 'element',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1.2',
      lighting_anchor: 'camera',
      lighting_elevation: '154.3',
      lighting_azimuth: '19.7',
      reflection_environment: 'source',
      focal_length: '24',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.6',
    },
  },
  {
    /*
      Its whole-protein sphere layer masked the base away and was
      folded into the base controls: the layer's `spheres` and the base picker's `spheres_refined`
      are the same sphere per atom at the same radius, so the picture is unchanged and the Style
      describes a base like `ball_and_stick_element` beside it -- one fewer layer, and colour
      schemes that land on something visible rather than having to reach the picture through a
      pass.
    */
    id: 'sphere_pack',
    row: 'detailed',
    label: 'Spheres',
    blurb: 'Van der Waals spheres, coloured by element.',
    writes: {
      representation: 'spheres_refined',
      material: 'glossy',
      color_mode: 'element',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '152.6',
      lighting_azimuth: '26.5',
      reflection_environment: 'source',
      focal_length: '24',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.8',
    },
  },

  /* ----------
    Monomers & domains

    Seventeen of the eighteen are derived from their sessions, the same way the Small & detailed
    row is. `rainbow_trace` is the exception and has no session at all: it is `sidechain_beads`
    with the side-chain pass removed, written by hand rather than approximated against a session
    that does not exist.
    Sixteen come from the `AF-P69905_*` sessions; `fluorescent_glow` comes from a GFP session, and
    its tile is rendered on this row's own chain rather than on that session's subject. A Style
    carries a look and never its subject, so the protein a session happened to be made on is not
    the protein its tile shows.

    The row is one protein at one scale, which is what makes the colour rule below legible. Five
    Styles are `uniform` and rest on a named colour from the Protein card's own Uniform colour row,
    `fluorescent_glow` reaches the same named presets through its glowing pass rather than a base,
    two are `element`, one is a spatial `z_axis` ramp, and the remaining nine are `sequence` ramps
    that state the **same eight pairs as Small & detailed** and differ only in which one they rest
    on -- `rainbow_ribbon` on the first, `ribbon_beads` on the second, down to `in_glass` on the
    eighth. `rainbow_trace` shares the first with `rainbow_ribbon`, which is the one place the row
    doubles up: a cartoon and a ribbon of the same ramp are already two different pictures, and the
    ramp is the whole subject of both. Eight side-chain and glass variations of one 142-residue
    globin on a single blue-to-amber ramp would read as one picture rendered eight ways; one pair
    per Style is what tells them apart at 36px. The seven sessions after the first are
    `_scheme<N>` copies, made and re-rendered exactly as the Small & detailed copies were, with the
    originals left untouched.
  ---------- */
  {
    id: 'ridged_trace',
    row: 'monomers',
    label: 'Railed cartoon',
    blurb: 'A railed cartoon in soft ceramic, the plain overview.',
    writes: {
      representation: 'cartoon',
      cartoon_type: 'railed',
      material: 'ceramic',
      color_mode: 'uniform',
      color: '#58BFA8',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '169.8',
      lighting_azimuth: '7.5',
      reflection_environment: 'source',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '2.2',
    },
  },
  {
    id: 'publication',
    row: 'monomers',
    label: 'Classic cartoon',
    blurb: 'A classic cartoon under flat, even light for print figures.',
    writes: {
      representation: 'cartoon',
      cartoon_type: 'classic',
      material: 'diffuse',
      color_mode: 'uniform',
      color: '#E56B6F',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '169.8',
      lighting_azimuth: '7.5',
      reflection_environment: 'source',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '2.2',
    },
  },
  {
    /*
      The one hand-written entry on this row: `sidechain_beads` with its side-chain pass taken away,
      so what is left is the railed ceramic cartoon under that Style's shallow f/1.2 depth of field.
      It rests on the *first* of the row's eight pairs rather than a spare one, because the whole
      subject here is the ramp itself running N to C -- there is nothing else in the picture to tell
      it apart from its neighbours, so it opens on the pair the row's menu opens on.
    */
    id: 'rainbow_trace',
    row: 'monomers',
    label: 'Rainbow cartoon',
    blurb: 'N to C along the chain, in soft ceramic at a shallow depth of field.',
    color_schemes: SEQUENCE_GRADIENT_PAIRS,
    writes: {
      representation: 'cartoon',
      cartoon_type: 'railed',
      material: 'ceramic',
      color_mode: 'sequence',
      gradient_start: '#178BD3',
      gradient_end: '#E2A34B',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '169.8',
      lighting_azimuth: '7.5',
      reflection_environment: 'source',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.2',
    },
  },
  {
    id: 'golden_hour',
    row: 'monomers',
    label: 'Golden hour',
    blurb: 'Warm outdoor light on a soft metallic sheen.',
    writes: {
      representation: 'cartoon',
      cartoon_type: 'geometric',
      material: 'metallic',
      color_mode: 'uniform',
      color: '#F2AB40',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1.2',
      lighting_anchor: 'camera',
      lighting_elevation: '-36.3',
      lighting_azimuth: '55.1',
      reflection_environment: 'source',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '2.2',
    },
  },
  {
    id: 'ghost',
    row: 'monomers',
    label: 'Ghost',
    blurb: 'A pale translucent cartoon that lets everything behind it through.',
    writes: {
      representation: 'cartoon',
      cartoon_type: 'railed',
      material: 'diffuse',
      color_mode: 'uniform',
      color: '#DDE4EA',
      opacity: '0.3',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '169.8',
      lighting_azimuth: '7.5',
      reflection_environment: 'source',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '2.2',
    },
  },
  {
    id: 'ghost_surface',
    row: 'monomers',
    label: 'Ghost surface',
    blurb: 'A cartoon inside a translucent envelope, for showing context.',
    writes: {
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '169.8',
      lighting_azimuth: '7.5',
      reflection_environment: 'color',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.2',
    },
    overlays: [
      {
        component: 'protein',
        name: 'Backbone',
        representation: 'cartoon',
        material: 'diffuse',
        color_mode: 'uniform',
        /*
          Ocean, a member of UNIFORM_COLOR_PRESETS, not the #0B79EF this was derived from. A Style
          rests on a member of its own menu rather than a hair off one: off the palette by a digit,
          this Style would frame nothing in the twelve-swatch row and instead draw its own colour in
          the `Style colours` group below, indistinguishable from the Ocean above it. Resting on the preset
          frames Ocean in place, and the picture is the same blue.
        */
        color: '#176FD3',
        opacity: 1,
      },
      {
        component: 'protein',
        name: 'Envelope',
        representation: 'surface',
        material: 'translucent_context',
        color_mode: 'uniform',
        color: '#E0E0E0',
        opacity: 0.25,
      },
    ],
  },
  {
    id: 'surface_gradient',
    row: 'monomers',
    label: 'Surface gradient',
    blurb: 'A molecular surface ramped through space.',
    color_schemes: SEQUENCE_GRADIENT_PAIRS,
    writes: {
      representation: 'surface',
      surface_detail: '1',
      material: 'glossy',
      color_mode: 'z_axis',
      /*
        The first pair of the stated `color_schemes` list above, and it has to stay that way. A
        gradient that is not one of the eight it offers -- the app's own default protein gradient
        (#176FD3 -> #E2B84B), say -- is prepended by `gradientSchemes()`, and the row draws nine
        swatches whose first two are the same picture a hair apart. Resting on a member of its own
        menu is what makes `As designed` a member of the set rather than an extra in front of it.
      */
      gradient_start: '#178BD3',
      gradient_end: '#E2A34B',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '165.5',
      lighting_azimuth: '33.6',
      reflection_environment: 'source',
      depth_of_field_enabled: false,
    },
  },
  {
    id: 'surface_atoms',
    row: 'monomers',
    label: 'Atom surface',
    blurb: 'A molecular surface coloured by element.',
    writes: {
      representation: 'surface',
      surface_detail: '2',
      material: 'glossy',
      color_mode: 'element',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '165.5',
      lighting_azimuth: '33.6',
      reflection_environment: 'source',
      depth_of_field_enabled: false,
    },
  },
  {
    id: 'atom_spheres',
    row: 'monomers',
    label: 'Spheres 2',
    blurb: 'Van der Waals spheres, coloured by element.',
    writes: {
      representation: 'spheres_refined',
      material: 'glossy',
      color_mode: 'element',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '152.6',
      lighting_azimuth: '26.5',
      reflection_environment: 'source',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.2',
    },
  },
  {
    id: 'rainbow_ribbon',
    row: 'monomers',
    label: 'Rainbow ribbon',
    blurb: 'A broad ribbon running N to C along the chain.',
    color_schemes: SEQUENCE_GRADIENT_PAIRS,
    writes: {
      lighting_source: 'autumn_meadow',
      lighting_strength: '1.2',
      lighting_anchor: 'camera',
      lighting_elevation: '-36.3',
      lighting_azimuth: '55.1',
      reflection_environment: 'source',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.2',
    },
    overlays: [
      {
        component: 'protein',
        name: 'Ribbon',
        representation: 'ribbon',
        material: 'ceramic',
        color_mode: 'sequence',
        gradient_start: '#178BD3',
        gradient_end: '#E2A34B',
        opacity: 1,
      },
    ],
  },
  {
    id: 'ribbon_beads',
    row: 'monomers',
    label: 'Ribbon & beads',
    blurb: 'A slender ribbon with every side chain beaded out.',
    color_schemes: SEQUENCE_GRADIENT_PAIRS,
    writes: {
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '169.8',
      lighting_azimuth: '7.5',
      reflection_environment: 'source',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.2',
    },
    overlays: [
      {
        component: 'protein',
        name: 'Ribbon',
        representation: 'ribbon_slender',
        material: 'ceramic',
        color_mode: 'sequence',
        gradient_start: '#30CFB4',
        gradient_end: '#DD46AD',
        opacity: 1,
      },
      {
        component: 'protein',
        name: 'Side chains',
        representation: 'side_chain_ball_and_stick',
        representation_settings: { sphere_radius: 0.36, bond_radius: 0.31 },
        material: 'soft_glossy',
        color_mode: 'sequence',
        gradient_start: '#30CFB4',
        gradient_end: '#DD46AD',
        color: '#ADFFED',
        opacity: 1,
      },
    ],
  },
  {
    id: 'sidechain_sticks',
    row: 'monomers',
    label: 'Cartoon & side chains 2',
    blurb: 'Backbone cartoon with every side chain drawn over it.',
    color_schemes: SEQUENCE_GRADIENT_PAIRS,
    writes: {
      representation: 'cartoon',
      cartoon_type: 'railed',
      material: 'ceramic',
      color_mode: 'sequence',
      gradient_start: '#8EDC84',
      gradient_end: '#D98CD2',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '169.8',
      lighting_azimuth: '7.5',
      reflection_environment: 'source',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.2',
    },
    overlays: [
      { component: 'protein', from: 'base', name: 'Backbone' },
      {
        component: 'protein',
        name: 'Side chains',
        representation: 'side_chain_sticks',
        material: 'soft_glossy',
        color_mode: 'sequence',
        gradient_start: '#8EDC84',
        gradient_end: '#D98CD2',
        color: '#CDFEF3',
        opacity: 1,
      },
    ],
  },
  {
    id: 'sidechain_beads',
    row: 'monomers',
    label: 'Cartoon & ball-and-stick 2',
    blurb: 'Ball-and-stick side chains over a railed cartoon.',
    color_schemes: SEQUENCE_GRADIENT_PAIRS,
    writes: {
      representation: 'cartoon',
      cartoon_type: 'railed',
      material: 'ceramic',
      color_mode: 'sequence',
      gradient_start: '#D27941',
      gradient_end: '#4B8AE2',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '169.8',
      lighting_azimuth: '7.5',
      reflection_environment: 'source',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.2',
    },
    overlays: [
      { component: 'protein', from: 'base', name: 'Backbone' },
      {
        component: 'protein',
        name: 'Side chains',
        representation: 'side_chain_ball_and_stick',
        material: 'soft_glossy',
        color_mode: 'sequence',
        gradient_start: '#D27941',
        gradient_end: '#4B8AE2',
        color: '#CDFEF3',
        opacity: 1,
      },
    ],
  },
  {
    id: 'sidechain_spheres',
    row: 'monomers',
    label: 'Side chain spheres',
    blurb: 'Side chains beaded out as spheres over a railed cartoon.',
    color_schemes: SEQUENCE_GRADIENT_PAIRS,
    writes: {
      representation: 'cartoon',
      cartoon_type: 'railed',
      material: 'ceramic',
      color_mode: 'sequence',
      gradient_start: '#D651A3',
      gradient_end: '#5DD5A3',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '169.8',
      lighting_azimuth: '7.5',
      reflection_environment: 'source',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.2',
    },
    overlays: [
      { component: 'protein', from: 'base', name: 'Backbone' },
      {
        component: 'protein',
        name: 'Side chains',
        representation: 'side_chain_spheres',
        representation_settings: { sphere_radius: 0.46 },
        material: 'soft_glossy',
        color_mode: 'sequence',
        gradient_start: '#D651A3',
        gradient_end: '#5DD5A3',
        color: '#ADFFED',
        opacity: 1,
      },
    ],
  },
  {
    id: 'sidechain_glass',
    row: 'monomers',
    label: 'Side chains in glass',
    blurb: 'Side-chain sticks sealed under a glass envelope.',
    color_schemes: SEQUENCE_GRADIENT_PAIRS,
    writes: {
      representation: 'cartoon',
      cartoon_type: 'railed',
      material: 'ceramic',
      color_mode: 'sequence',
      gradient_start: '#955ED9',
      gradient_end: '#4EDAC9',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '169.8',
      lighting_azimuth: '7.5',
      reflection_environment: 'source',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.2',
    },
    overlays: [
      { component: 'protein', from: 'base', name: 'Backbone' },
      {
        component: 'protein',
        name: 'Side chains',
        representation: 'side_chain_sticks',
        material: 'soft_glossy',
        color_mode: 'sequence',
        gradient_start: '#955ED9',
        gradient_end: '#4EDAC9',
        color: '#CDFEF3',
        opacity: 1,
      },
      {
        component: 'protein',
        name: 'Glass shell',
        representation: 'surface',
        material: 'glass',
        color_mode: 'uniform',
        color: '#D6FFF6',
        opacity: 0.32,
      },
    ],
  },
  {
    id: 'glass_ribbon',
    row: 'monomers',
    label: 'Glass ribbon',
    blurb: 'A rainbow cartoon under a glass ribbon.',
    color_schemes: SEQUENCE_GRADIENT_PAIRS,
    writes: {
      representation: 'cartoon',
      cartoon_type: 'railed',
      material: 'ceramic',
      color_mode: 'sequence',
      gradient_start: '#5ED9C5',
      gradient_end: '#D7DA4E',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '169.8',
      lighting_azimuth: '7.5',
      reflection_environment: 'source',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.2',
    },
    overlays: [
      { component: 'protein', from: 'base', name: 'Backbone' },
      {
        component: 'protein',
        name: 'Glass ribbon',
        representation: 'ribbon',
        material: 'glass',
        color_mode: 'uniform',
        color: '#ADFFED',
        opacity: 0.32,
      },
    ],
  },
  {
    id: 'in_glass',
    row: 'monomers',
    label: 'Glass surface',
    blurb: 'A rainbow cartoon sealed inside a glass envelope.',
    color_schemes: SEQUENCE_GRADIENT_PAIRS,
    writes: {
      representation: 'cartoon',
      cartoon_type: 'railed',
      material: 'ceramic',
      color_mode: 'sequence',
      gradient_start: '#D55D48',
      gradient_end: '#DB486D',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '169.8',
      lighting_azimuth: '7.5',
      reflection_environment: 'studio',
      /*
        Off, and a deliberate departure from the session it was derived from, which had it on at
        f/1.2. A shell this transparent is read *through*, so a shallow focus blurs the far wall
        of the glass and the far half of the cartoon behind it together, and the picture loses the
        one thing it is about: that there is a whole fold sealed inside.

        The f-stop goes with it, and that holds across the whole catalogue: a Style with the switch
        off states no aperture, because it would write over the user's own for a lens nothing is
        looking through.
      */
      depth_of_field_enabled: false,
    },
    // The glass follows whichever rainbow the card is set to; see `scheme_tint` in
    // src/style-color-schemes.js.
    scheme_tint: ['Glass shell'],
    overlays: [
      { component: 'protein', from: 'base', name: 'Backbone' },
      {
        component: 'protein',
        name: 'Glass shell',
        representation: 'surface',
        material: 'glass',
        color_mode: 'uniform',
        color: '#CDFEF3',
        opacity: 0.40,
      },
    ],
  },

  {
    // Derived from a GFP composition, whose subject is the one thing a Style
    // never carries: the tile is rendered on the same 142-residue chain as the rest of this row,
    // so what differs between tiles is the look.
    id: 'fluorescent_glow',
    row: 'monomers',
    label: 'Fluorescent',
    blurb: 'A self-lit cartoon glowing inside a faint glass shell, lit dark-field.',
    /*
      The one Style whose own colour is not, and should not become, a member of the app's twelve
      named presets. #17EE3A is a fluorophore green: it is what a self-lit cartoon under dark-field
      light has to be to read as emitting rather than as lit, and Mint or Sea in its place renders a
      picture the tile does not show. It is not a thirteenth swatch in the Colour scheme row: the
      presets are twelve interchangeable body colours, and this is not one of them.

      Its colour therefore lands in the `Style colours` group under the scheme row, which is where
      *any* uniform Style's off-palette colour goes. What `extra_colors` states is the company it
      keeps down there. The two beside it are the same colour at the same saturation and value
      (HSV S 0.903, V 0.933) at two other hues, named for the fluorophores they are: swapping one
      for another is changing which dye this is, which is a different question from the
      twelve-preset "what colour is this protein" the scheme row asks.

      It is uniform-mode only, because it is the authored *colour* the group is about and only a
      uniform Style has one. See `uniformSchemes()` in src/style-color-schemes.js.
    */
    extra_colors: [
      ['mCherry red', '#EE1755'],
      ['CFP cyan', '#17D9EE'],
    ],
    writes: {
      lighting_source: 'fluorescence_darkfield',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '90.1',
      lighting_azimuth: '89',
      reflection_environment: 'source',
      // Off, where the session had it on at f/1.8, a deliberate departure and for the
      // same reason as `in_glass` above: a self-lit body inside a shell is a picture read through
      // two surfaces, and blurring both of them blurs the glow itself. The f-stop goes with the
      // switch, as `in_glass`'s does.
      depth_of_field_enabled: false,
    },
    // The shell is a paler cast of the dye, so it follows whichever dye is chosen -- including the
    // two in `extra_colors`. See `scheme_tint` in src/style-color-schemes.js.
    scheme_tint: ['Glass shell'],
    overlays: [
      {
        component: 'protein',
        name: 'Glowing cartoon',
        representation: 'cartoon',
        material: 'bioluminescent',
        color_mode: 'uniform',
        color: '#17EE3A',
        opacity: 1,
      },
      {
        component: 'protein',
        name: 'Glass shell',
        representation: 'surface',
        material: 'glass',
        color_mode: 'uniform',
        color: '#45F29A',
        opacity: 0.25,
      },
    ],
  },

  /* ---------- Multimers ---------- */
  {
    id: 'chain_palette',
    row: 'multimers',
    pool: 'multimers_chain',
    label: 'Railed chains',
    blurb: 'One colour per chain, warm and readable.',
    requires: 'chains',
    writes: {
      representation: 'cartoon',
      cartoon_type: 'railed',
      material: 'ceramic',
      color_mode: 'chain',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '-168.5',
      lighting_azimuth: '21.1',
      reflection_environment: 'source',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '2.2',
    },
  },
  {
    /*

      Classic cartoon for a multimer: the Monomers & domains Style of that name, kept setting for
      setting -- classic cartoon, diffuse, autumn meadow at 169.8/7.5 reflected in itself,
      depth of field at f/2.2 -- with its single uniform coral replaced by by-chain colour, which is
      the one thing a print figure of an assembly has to do that a figure of one chain does not.
      It therefore takes the same `CATEGORICAL_SCHEMES` family `chain_palette` offers, Vivid and
      Pastel included, rather than the uniform presets `publication` gets.

      Its session carries `publication`'s own Improve image recipe and the tile is baked through
      it. Improve image is the Style card's per-apply switch and never an authored field, so the
      recipe travels with the session and the picture, not with the entry.
    */
    id: 'publication_chains',
    color_scheme: 'Ocean',
    row: 'multimers',
    pool: 'multimers_chain',
    label: 'Classic chains',
    blurb: 'A classic cartoon under flat, even light, one colour per chain.',
    requires: 'chains',
    writes: {
      representation: 'cartoon',
      cartoon_type: 'classic',
      material: 'diffuse',
      color_mode: 'chain',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '169.8',
      lighting_azimuth: '7.5',
      reflection_environment: 'source',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '2.2',
    },
  },
  {
    /*

      The three sessions from here to Ribbon chains are one 4HHB composition in three geometries --
      cylindrical cartoon, molecular surface, every-atom spheres -- and each keeps its own light,
      because the shape is what each one is answering to: a surface wants the source overhead at
      177.5 degrees, a cylinder bundle does not.
    */
    id: 'chain_cylinders',
    color_scheme: 'Sunset',
    row: 'multimers',
    pool: 'multimers_chain',
    label: 'Cylinder chains',
    blurb: 'Helices as cylinders, one colour per chain.',
    requires: 'chains',
    writes: {
      representation: 'cartoon',
      cartoon_type: 'geometric',
      material: 'glossy',
      color_mode: 'chain',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '-168.5',
      lighting_azimuth: '21.1',
      reflection_environment: 'source',
      focal_length: '29',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '2.2',
    },
  },
  {
    id: 'chain_surface',
    color_scheme: 'Meadow',
    row: 'multimers',
    pool: 'multimers_chain',
    label: 'Surface chains',
    blurb: 'Solid surface, chains told apart by colour.',
    requires: 'chains',
    writes: {
      representation: 'surface',
      surface_detail: '1',
      material: 'glossy',
      color_mode: 'chain',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1.1',
      lighting_anchor: 'camera',
      lighting_elevation: '177.5',
      lighting_azimuth: '21.1',
      reflection_environment: 'source',
      focal_length: '29',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '2.2',
    },
  },
  {
    id: 'chain_spheres',
    color_scheme: 'Orchid',
    row: 'multimers',
    pool: 'multimers_chain',
    label: 'Sphere chains',
    blurb: 'Every atom a sphere, one colour per chain.',
    requires: 'chains',
    writes: {
      representation: 'spheres_refined',
      material: 'glossy',
      color_mode: 'chain',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '-168.5',
      lighting_azimuth: '21.1',
      reflection_environment: 'source',
      focal_length: '29',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '2.2',
    },
  },
  {
    id: 'duo_ribbon',
    color_scheme: 'Graphite',
    row: 'multimers',
    pool: 'multimers_chain',
    label: 'Ribbon chains',
    blurb: 'Ribbon backbones, one colour per chain.',
    requires: 'chains',
    writes: {
      representation: 'ribbon',
      ribbon_type: 'standard',
      material: 'ceramic',
      color_mode: 'chain',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '155.2',
      lighting_azimuth: '18.2',
      reflection_environment: 'source',
      focal_length: '29',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '2.2',
    },
  },

  /*
    The four wide 3ECA Styles, derived from their sessions. They are one composition photographed
    four ways -- the same L-asparaginase tetramer, the same ceramic railed cartoon, the same
    autumn-meadow light -- differing only in what happens to the side chains: nothing, sticks,
    ball-and-stick, spheres.

    They are the reason `focal_length` is on STYLE_FIELDS at all. All four sessions were composed on
    a **14mm** lens rather than the ~29mm every other picture in this catalogue rests on, and that is
    the whole subject of them: at 14mm the near chains loom and the far ones rush away, which is what
    makes a tetramer read as an assembly with depth instead of a flat knot of ribbon. Applied at
    whatever lens the user happened to be on, they are a different picture wearing the same name.
    `#focal-length` dollies as it changes, so writing it alters the perspective and leaves the
    subject the same size -- it is the one camera control that does not reframe the shot.

    All four state the same eight gradient pairs and rest on a different one -- `wide_cartoon` on the
    first, `wide_side_chains` on the second, `wide_beads` on the third, `wide_spheres` on the fourth.
    That is the Small & detailed row's rule and it is here for the same reason: four looks on one
    protein, opened on one blue-to-amber ramp, read as one picture rendered four times. The list is
    stated rather than generated, so the menu is the same eight in the same order under each of them
    and only the marked swatch moves. `wide_cartoon` is the one whose colour was left exactly as it
    was designed; the other three sessions were recoloured and re-rendered, which is what the
    `_scheme<N>` copies beside them are.

    The three with side chains carry a `from: 'base'` mirror because their sessions did: the
    whole-protein side-chain layer masks the base away, so the mirror is what puts it back.
    `wide_cartoon` has no side-chain pass and therefore nothing masking its base, so its session's
    lone mirror was a no-op -- a layer that hid the base and redrew it identically -- and it carries
    no overlay at all. A whole-component layer has exactly three outcomes: it becomes the base, it
    becomes a pass with a mirror behind it, or it is dropped as a no-op.
  */
  {
    id: 'wide_cartoon',
    row: 'multimers',
    pool: 'wide',
    label: 'Wide-angle cartoon',
    blurb: 'A 14 mm lens down the whole assembly, rainbowed along the sequence.',
    color_schemes: SEQUENCE_GRADIENT_PAIRS,
    writes: {
      representation: 'cartoon',
      cartoon_type: 'railed',
      material: 'ceramic',
      color_mode: 'sequence',
      gradient_start: '#178BD3',
      gradient_end: '#E2A34B',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '169.8',
      lighting_azimuth: '7.5',
      reflection_environment: 'source',
      focal_length: '14',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '0.3',
    },
  },
  {
    id: 'wide_side_chains',
    row: 'multimers',
    pool: 'wide',
    label: 'Wide-angle side chains',
    blurb: 'The same wide cartoon with every side chain drawn out in sticks.',
    color_schemes: SEQUENCE_GRADIENT_PAIRS,
    writes: {
      representation: 'cartoon',
      cartoon_type: 'railed',
      material: 'ceramic',
      color_mode: 'sequence',
      gradient_start: '#30CFB4',
      gradient_end: '#DD46AD',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '169.8',
      lighting_azimuth: '7.5',
      reflection_environment: 'source',
      focal_length: '14',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '0.3',
    },
    overlays: [
      { component: 'protein', from: 'base', name: 'Backbone' },
      {
        component: 'protein',
        name: 'Side chains',
        representation: 'side_chain_sticks',
        representation_settings: { stick_radius: 0.28, show_hydrogens: false },
        material: 'soft_glossy',
        color_mode: 'sequence',
        gradient_start: '#30CFB4',
        gradient_end: '#DD46AD',
        color: '#CDFEF3',
        opacity: 1,
      },
    ],
  },
  {
    id: 'wide_beads',
    row: 'multimers',
    pool: 'wide',
    label: 'Wide-angle beads',
    blurb: 'Side chains beaded out in ball-and-stick over a wide cartoon.',
    color_schemes: SEQUENCE_GRADIENT_PAIRS,
    writes: {
      representation: 'cartoon',
      cartoon_type: 'railed',
      material: 'ceramic',
      color_mode: 'sequence',
      gradient_start: '#8EDC84',
      gradient_end: '#D98CD2',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '169.8',
      lighting_azimuth: '7.5',
      reflection_environment: 'source',
      focal_length: '14',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '0.3',
    },
    overlays: [
      { component: 'protein', from: 'base', name: 'Backbone' },
      {
        component: 'protein',
        name: 'Side chains',
        representation: 'side_chain_ball_and_stick',
        representation_settings: { sphere_radius: 0.29, bond_radius: 0.2, show_hydrogens: true },
        material: 'soft_glossy',
        color_mode: 'sequence',
        gradient_start: '#8EDC84',
        gradient_end: '#D98CD2',
        color: '#ADFFED',
        opacity: 1,
      },
    ],
  },
  {
    id: 'wide_spheres',
    row: 'multimers',
    pool: 'wide',
    label: 'Wide-angle spheres',
    blurb: 'Side chains as soft spheres, packed along a wide cartoon.',
    color_schemes: SEQUENCE_GRADIENT_PAIRS,
    writes: {
      representation: 'cartoon',
      cartoon_type: 'railed',
      material: 'ceramic',
      color_mode: 'sequence',
      gradient_start: '#D27941',
      gradient_end: '#4B8AE2',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '169.8',
      lighting_azimuth: '7.5',
      reflection_environment: 'source',
      focal_length: '14',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '0.3',
    },
    overlays: [
      { component: 'protein', from: 'base', name: 'Backbone' },
      {
        component: 'protein',
        name: 'Side chains',
        representation: 'side_chain_spheres',
        representation_settings: { sphere_radius: 0.48, show_hydrogens: true },
        material: 'soft_glossy',
        color_mode: 'sequence',
        gradient_start: '#D27941',
        gradient_end: '#4B8AE2',
        color: '#CDFEF3',
        opacity: 1,
      },
    ],
  },
  /*
    ---------------------------------------------------------------------------------------------
    THE PEPTIDE-PARTNER GROUP: six looks whose small side is another chain rather than a molecule.

    They are the same six pictures the 7LCK Styles make in Ligands, in the
    same order, with the partner changed from a ligand component to a protein chain -- so a reader
    who has found a look on one row can find it on the other. `interface_bound` and
    `interface_ghost` are `bound_cartoon` and `ghost_ligand`; `interface_glow_peptide` and
    `interface_glow_pocket` are `bound_glow` and `pocket_glow`; `interface_peptide` and
    `interface_pocket` are the two the traffic ran the other way for, being the sessions the ligand
    row's own sphere-pack and open-cavity looks were adapted *from*.

    WHAT CHANGES IN THE CROSSING is one thing and always the same: a ligand is a component with its
    own controls, and a chain is not, so a component base becomes a scoped overlay pass
    (`larger_chains` / `smallest_chain`) and the `duo_sides` pair becomes the ordinary scoped pair
    every other interface Style uses. Everything else is carried unchanged -- the representations,
    the materials, the light and its angle, the f-stop -- because "the same picture with a different
    partner" is only true if nothing else moved.

    WHAT CANNOT CROSS is anything that reads a *molecule*. `ghost_ligand` draws its partner by
    element, which is the honest way to colour forty-one atoms and a wall of grey carbon over a
    peptide, so `interface_ghost` paints one colour instead and becomes an ordinary duo Style. The
    rule cuts both ways, which is why the two rows are not one list: a 79-residue peptide reads in
    sticks where a 41-atom ligand does not.
    ---------------------------------------------------------------------------------------------
  */
  {
    /*
      `bound_cartoon` from Ligands, with a chain for a partner: a ceramic
      railed cartoon body with the other side drawn atom by atom in front of it, autumn meadow at
      -163/18.4 reflected in itself, and f/0.6. Every one of those is that Style's own value,
      carried across exactly as `interface_glow_peptide` carried `bound_glow`'s cool night.

      It is the row's plainest interface picture and the only one whose body is a cartoon with an
      all-atom partner -- `interface_print` is cartoon on cartoon, `interface_ribbon` is a ribbon
      under a translucent shell, and the four surface-bodied looks all hide the backbone. So it is
      the entry to reach for when the question is "what binds here" rather than "what does this look
      like".

      CYAN & MAGENTA is the last saturated pair no Style in this row rests on, which is the whole
      requirement for the leading tile of a group: the two entries after it are a near-white ghost
      and a slate ribbon, so a quiet host here would have made three pale tiles in a row. `bound_glow`
      rests on the same pair one row down, which is fine and deliberate -- distinctness is per-row,
      and these two Styles are meant to read as relatives.

      The partner's ball-and-stick is the app's own protein default (0.29 / 0.2) rather than
      `bound_cartoon`'s 0.29 / 0.3, which is the *ligand* picker's: the pass is a protein pass now,
      and it takes the defaults its own control offers.
    */
    id: 'interface_bound',
    row: 'interfaces',
    pool: 'interfaces_peptide',
    label: 'Bound peptide',
    blurb: 'A ceramic cartoon body with its partner drawn atom by atom.',
    requires: 'chains',
    duo_scheme: 'Cyan & magenta',
    writes: {
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '-163',
      lighting_azimuth: '18.4',
      reflection_environment: 'source',
      focal_length: '29',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '0.6',
    },
    overlays: [
      {
        component: 'protein',
        scope: 'larger_chains',
        name: 'Host chains',
        representation: 'cartoon_railed',
        material: 'ceramic',
        color_mode: 'uniform',
        color: '#59F7E5',
        opacity: 1,
      },
      {
        component: 'protein',
        scope: 'smallest_chain',
        name: 'Binding partner',
        representation: 'ball_and_stick',
        representation_settings: { sphere_radius: 0.29, bond_radius: 0.2, show_hydrogens: false },
        material: 'glossy',
        color_mode: 'uniform',
        color: '#C73FD9',
        opacity: 1,
      },
    ],
  },
  {
    /*
      `ghost_ligand` from Ligands, with a chain for a partner: the big side is
      a cartoon at 0.3 opacity in a near-white that reads as glass rather than as a colour, and the
      partner is a sphere per atom in front of it. The body is context and says so; the thing that
      binds is the only solid object in the frame. Autumn meadow at -69.9/98.5 and f/0.8 are that
      Style's own values, carried unchanged.

      IT IS A DUO STYLE WHERE ITS SIBLING IS NOT, and that is the one thing the crossing changed.
      `ghost_ligand` paints its ligand *by element* -- blue is nitrogen, red is oxygen -- and
      declares `scheme_target: 'ligand'` so its alternates are carbon tints. A peptide by element is
      a wall of grey carbon with a few red and blue dots in it, which says nothing about the
      interface, so this pass takes one colour and the ordinary two-sided family with it.

      PEARL & VIOLET is a white-host pair, and the reason is the same one that put those pairs in
      DUO_SCHEMES for `open_pocket`: the host here is deliberately almost not there, so the pair has
      to be one that quietens it without turning it grey. Violet is the one saturated partner hue no
      other Style in this row uses -- the eleven others take blue, indigo, lilac, cyan, sand, red,
      amber, teal, coral and magenta -- and against a near-white ghost it is the colour that stays
      legible at 36px.

      The pass's 0.3 opacity is the second non-opaque pass in the row, after `interface_ribbon`'s
      translucent shell. It is on the *host* here rather than on the partner, which is what makes
      this a ghost rather than a veil: you see the partner through the body, not the body through
      the partner.
    */
    id: 'interface_ghost',
    row: 'interfaces',
    pool: 'interfaces_peptide',
    label: 'Ghost & peptide',
    blurb: 'A near-transparent cartoon body with its partner packed atom by atom.',
    requires: 'chains',
    duo_scheme: 'Pearl & violet',
    writes: {
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '-69.9',
      lighting_azimuth: '98.5',
      reflection_environment: 'source',
      focal_length: '29',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '0.8',
    },
    overlays: [
      {
        component: 'protein',
        scope: 'larger_chains',
        name: 'Host chains',
        representation: 'cartoon_railed',
        material: 'diffuse',
        color_mode: 'uniform',
        color: '#DDE4EA',
        opacity: 0.3,
      },
      {
        component: 'protein',
        scope: 'smallest_chain',
        name: 'Binding partner',
        representation: 'spheres',
        representation_settings: { sphere_radius: 0.65, show_hydrogens: false },
        material: 'glossy',
        color_mode: 'uniform',
        color: '#8A51C2',
        opacity: 1,
      },
    ],
  },
  {
    /*
      Written by hand -- the same composition behind interface_peptide, with the
      two components' colours-and-materials feature restated:
      `bound_glow`'s own look (a glossy ribbon body, a bioluminescent partner) reaches this
      structure by changing what the glow lands *on*. 2GNS has no ligand, so the small side is the
      5-residue peptide (chain P) rather than a ligand component, and a bioluminescent selection
      layer scoped to `smallest_chain` is how a protein chain reads as a source -- the same mechanism
      `interface_peptide`'s sticks pass uses, with the material swapped.

      `duo_scheme: 'Slate & sand'`: its own colour *is* that pair rather than a custom pick -- the
      same choice `interface_peptide` and `interface_pocket` make with Mint & lilac and Bone & cyan.
      Slate's cool grey-blue reads correctly as a body under this look's cool_night light (warm
      hosts fail there, as they do for `pocket_glow`), and Sand is warm enough to
      read as emitting against it without competing with Steel & red on the entry below.
    */
    id: 'interface_glow_peptide',
    row: 'interfaces',
    pool: 'interfaces_peptide',
    label: 'Ribbon & peptide',
    blurb: 'A glassy ribbon body with its peptide partner lit from inside.',
    requires: 'chains',
    duo_scheme: 'Slate & sand',
    writes: {
      lighting_source: 'cool_night',
      lighting_strength: '1.05',
      lighting_anchor: 'camera',
      lighting_elevation: '47.6',
      lighting_azimuth: '157.8',
      reflection_environment: 'source',
      focal_length: '29',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.2',
    },
    overlays: [
      {
        component: 'protein',
        scope: 'larger_chains',
        name: 'Host chains',
        representation: 'ribbon',
        material: 'glossy',
        color_mode: 'uniform',
        color: '#5F7FA6',
        opacity: 1,
      },
      {
        component: 'protein',
        scope: 'smallest_chain',
        name: 'Binding partner',
        representation: 'sticks',
        representation_settings: { stick_radius: 0.34, show_hydrogens: false },
        material: 'bioluminescent',
        color_mode: 'uniform',
        color: '#E3B57A',
        opacity: 1,
        emission_strength: '9.5',
      },
    ],
  },
  {
    /*
      Written by hand -- the same pairing one entry up, with `pocket_glow`'s
      body instead of `bound_glow`'s: a closed ceramic surface rather
      than a ribbon, so the peptide glows *through* the enzyme rather than beside it, exactly as the
      7LCK agonist does through the extracellular domain. The partner is ball-and-stick rather than
      sticks and its emission sits at 7 rather than 9.5, both carried from `pocket_glow` unchanged
      -- an all-atom partner reads better through a solid body, and a surface needs less emission
      behind it than open air does to look lit.

      `pocket_glow`, its sibling in Ligands, rests on `Steel & amber`, so this entry takes
      `Steel & red` -- the other member of the quiet-host group, whose whole point (one quiet body,
      one loud partner) is exactly this picture. Steel is close enough to Slate above that the two entries
      read as a matched pair of looks rather than unrelated ones, and Red is a clean saturated
      contrast to it.
    */
    id: 'interface_glow_pocket',
    row: 'interfaces',
    pool: 'interfaces_peptide',
    label: 'Surface & peptide dark',
    blurb: 'A ceramic surface body with its partner glowing through it.',
    requires: 'chains',
    duo_scheme: 'Steel & red',
    writes: {
      lighting_source: 'cool_night',
      lighting_strength: '1.05',
      lighting_anchor: 'camera',
      lighting_elevation: '47.6',
      lighting_azimuth: '157.8',
      reflection_environment: 'source',
      focal_length: '29',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.2',
    },
    overlays: [
      {
        component: 'protein',
        scope: 'larger_chains',
        name: 'Host chains',
        representation: 'surface_soft_pockets',
        material: 'ceramic',
        color_mode: 'uniform',
        color: '#8FA3B8',
        opacity: 1,
      },
      {
        component: 'protein',
        scope: 'smallest_chain',
        name: 'Binding partner',
        representation: 'ball_and_stick',
        representation_settings: { sphere_radius: 0.3, bond_radius: 0.24, show_hydrogens: false },
        material: 'bioluminescent',
        color_mode: 'uniform',
        color: '#D4392F',
        opacity: 1,
        emission_strength: '7',
      },
    ],
  },
  {
    // Written by hand. Its source's `reflection_environment: 'color'` is not
    // carried: reflections follow the lighting.
    id: 'interface_peptide',
    row: 'interfaces',
    pool: 'interfaces_peptide',
    label: 'Spheres & peptide',
    blurb: 'A packed protein surface with its bound peptide drawn out in sticks.',
    requires: 'chains',
    duo_scheme: 'Mint & lilac',
    writes: {
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '169.8',
      lighting_azimuth: '7.5',
      reflection_environment: 'source',
      focal_length: '29',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '0.6',
    },
    overlays: [
      {
        component: 'protein',
        scope: 'larger_chains',
        name: 'Host chains',
        representation: 'spheres',
        representation_settings: { sphere_radius: 0.65, show_hydrogens: true },
        material: 'glossy',
        color_mode: 'uniform',
        color: '#58BFA8',
        opacity: 1,
      },
      {
        component: 'protein',
        scope: 'smallest_chain',
        name: 'Binding partner',
        representation: 'sticks',
        representation_settings: { stick_radius: 0.34, show_hydrogens: false },
        material: 'soft_glossy',
        color_mode: 'uniform',
        color: '#B987E8',
        opacity: 1,
      },
    ],
  },
  {
    /*
      The only Style in the catalogue that shows a *groove*. A pocketed surface leaves the
      binding site open to the camera and the partner is drawn atom by atom inside it, which is the
      one thing none of the other five interface Styles can answer: not where the two sides meet,
      but what the contact is made of.

      It is at its best on a small partner and it does not break on a large one -- that was checked
      rather than assumed. On a 434-residue partner the ball-and-stick is a dense wire nest, heavy
      but still legible as an all-atom partner; on 79 residues it is exactly right. `requires:
      'chains'` keeps it off the Recommended row for a monomer and, as always, never blocks a click.

      2GNS's own `reflection_environment: 'color'` is not carried, for the same reason
      `interface_peptide` does not carry it: reflections follow the lighting.

      The host is surface rung 3 rather than 4, and its dark twin `interface_glow_pocket` sits on
      rung 2.
    */
    id: 'interface_pocket',
    row: 'interfaces',
    pool: 'interfaces_peptide',
    label: 'Surface & peptide light',
    blurb: 'A pocketed surface with its partner drawn atom by atom.',
    requires: 'chains',
    duo_scheme: 'Bone & cyan',
    writes: {
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '169.8',
      lighting_azimuth: '7.5',
      reflection_environment: 'source',
      focal_length: '29',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.2',
    },
    overlays: [
      {
        component: 'protein',
        scope: 'larger_chains',
        name: 'Host chains',
        representation: 'surface_smooth_pockets',
        material: 'ceramic',
        color_mode: 'uniform',
        color: '#CFC4AE',
        opacity: 1,
      },
      {
        component: 'protein',
        scope: 'smallest_chain',
        name: 'Binding partner',
        representation: 'ball_and_stick',
        // Hydrogens off explicitly rather than left to applyStyleOverlays() to force: this family
        // defaults to showing them, and the tile beside this entry was rendered without.
        representation_settings: { sphere_radius: 0.3, bond_radius: 0.24, show_hydrogens: false },
        material: 'glossy',
        color_mode: 'uniform',
        color: '#12BFD9',
        opacity: 1,
      },
    ],
  },


  /* ----------
    The interface Styles: eight looks, in four pairs -- six of them below, and the peptide pair
    above with the peptide-partner group, where its subject puts it.

    They draw two parts of one protein differently, stating a `scope` -- a host pass against a
    partner pass, resolved by main.js against whatever
    was loaded. The domain looks here take `largest_chain` / `other_chains`, because their partner is
    a polymer and a Fab is two chains; the peptide looks above take `larger_chains` /
    `smallest_chain`, because a partner drawn atom by atom has to be one small chain. See
    src/style-overlays.js for why those are constants rather than a selection language, and why
    a chain id is the one thing a Style may never carry.

    Every one of the eight is two scoped passes and **no base appearance at all**: each pair of
    scopes partitions the protein between them, so the base renders nothing and a representation,
    material or colour written there would never appear.

    THE PAIRS. Each odd entry is a look and the one after it is that look with a single decision
    changed, which is what makes the row worth scanning vertically:

      spheres  -> packed    the sphere pack moves from the receptor to its antibody
      peptide  -> pocket    the host opens into a cavity and the peptide gains its atoms  (above)
      ribbon   -> print     the host's ribbon becomes a cartoon
      surface  -> trace     the partner's railed cartoon becomes a slender ribbon

    The peptide pair sits above rather than here because a row is read in order and its subject is
    the one the group above shares: a bound peptide. Nothing else about it differs -- it is one of
    the eight, two scoped passes, held to the same rules.

    WHERE THEY COME FROM. The first of each pair is written from a `*-Interface` session (1N8Z,
    2GNS, 8PWW, 9HAF): a receptor ectodomain against its Fab, an enzyme with a peptide in its
    groove, two halves of a complex laid together, a surface with a helix into it. The seconds were
    chosen from twelve alternates rendered across all four interfaces: everything that held up was
    one shape -- *a quiet body, one saturated partner, honest geometry* -- and everything that did
    not either made the material the subject (chrome, a dark-field glow, two glass shells) or drew
    both sides loud so neither led (a cylinder bundle, a both-sides-cartoon duo).

    NONE OF THEM CAN BE DERIVED, and that is a property of the feature rather than an omission. A
    session whose layer covers *part* of a component -- which is exactly what an interface session
    is -- cannot be turned into a Style mechanically, so all eight were written by hand. What
    stands in for the derivation check is assertion: the two-passes-largest-first shape and the
    masked base are pinned, as is each entry's stated `duo_scheme` against the colours its own
    passes are painted in.

    TILES. All eight are baked from this renderer like every other Style tile: the four with a
    session behind them on that session, the four without on the same interface subject.

    COLOUR. Each rests on a different member of `DUO_SCHEMES`, and the panel offers all eighteen in
    table order. Two of the twelve alternates above are schemes rather than tiles: "Epitope surface" is
    `interface_surface` in a different palette and "Space-filling host" is `interface_spheres` in
    another, so they are the `Bone & amber` and `Steel & amber` entries
    instead of near-duplicate pictures in a row of twenty-two. **A new interface look earns a tile
    when its geometry is new and a scheme when only its palette is.**
  ---------- */
  {
    // Written by hand: its source scopes its layers to chain C and to
    // chains A+B, which no Style may name.
    id: 'interface_spheres',
    row: 'interfaces',
    pool: 'interfaces_domain',
    label: 'Spheres & cartoon',
    blurb: 'The big subunit packed as atoms, its partner laid over it in cartoon.',
    requires: 'chains',
    duo_scheme: 'Rose & blue',
    writes: {
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '172.3',
      lighting_azimuth: '0.6',
      reflection_environment: 'source',
      focal_length: '29',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.1',
    },
    overlays: [
      {
        component: 'protein',
        scope: 'largest_chain',
        name: 'Largest chain',
        representation: 'spheres',
        material: 'diffuse',
        color_mode: 'uniform',
        color: '#E64CA6',
        opacity: 1,
      },
      {
        component: 'protein',
        scope: 'other_chains',
        name: 'Binding partner',
        representation: 'cartoon',
        material: 'diffuse',
        color_mode: 'uniform',
        color: '#3375E1',
        opacity: 1,
      },
    ],
  },
  {
    /*
      `interface_spheres` with the two sides swapped in treatment: the host becomes a
      surface -- detail 2, soft pockets -- and the partner becomes the sphere pack. Its sibling
      answers "how big is this receptor"; this one answers "how much of it does the partner
      actually cover", because a smooth surface has a footprint and a sphere pack does not.

      It takes the peptide pair of scopes, so on 1N8Z, its own subject, the pack is the Fab's
      light chain alone and the heavy chain joins the receptor's surface.

      The surface is detail 2, soft pockets, in ceramic, and the sphere pack is glossy: a
      ceramic host reads as a solid body under the packed partner, and a glossy pack keeps the
      individual atoms separable where a diffuse one flattens into one mass. The lighting and the
      f-stop are still its sibling's -- the same 172.3/0.6 and the same f/1.1.
    */
    id: 'interface_packed',
    row: 'interfaces',
    pool: 'interfaces_peptide',
    label: 'Surface & spheres',
    blurb: 'A smooth receptor surface with its binder packed atom by atom.',
    requires: 'chains',
    duo_scheme: 'Gold & indigo',
    writes: {
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '172.3',
      lighting_azimuth: '0.6',
      reflection_environment: 'source',
      focal_length: '29',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.1',
    },
    overlays: [
      {
        component: 'protein',
        scope: 'larger_chains',
        name: 'Host chains',
        representation: 'surface_soft_pockets',
        material: 'ceramic',
        color_mode: 'uniform',
        color: '#EFC245',
        opacity: 1,
      },
      {
        component: 'protein',
        scope: 'smallest_chain',
        name: 'Binding partner',
        representation: 'spheres',
        representation_settings: { sphere_radius: 0.65, show_hydrogens: false },
        material: 'glossy',
        color_mode: 'uniform',
        color: '#4A56B8',
        opacity: 1,
      },
    ],
  },
  {
    // Written by hand.
    id: 'interface_ribbon',
    row: 'interfaces',
    pool: 'interfaces_domain',
    label: 'Ribbon & cartoon',
    blurb: 'One side as a bold ribbon, the other as translucent cartoon around it.',
    requires: 'chains',
    duo_scheme: 'Cyan & amber',
    writes: {
      lighting_source: 'autumn_meadow',
      lighting_strength: '1.2',
      lighting_anchor: 'camera',
      lighting_elevation: '-36.3',
      lighting_azimuth: '29.7',
      reflection_environment: 'source',
      focal_length: '29',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '2.8',
    },
    overlays: [
      {
        component: 'protein',
        scope: 'largest_chain',
        name: 'Largest chain',
        representation: 'ribbon',
        material: 'soft_glossy',
        color_mode: 'uniform',
        color: '#00ACC1',
        opacity: 1,
      },
      {
        component: 'protein',
        scope: 'other_chains',
        name: 'Binding partner',
        representation: 'cartoon_railed',
        material: 'soft_glossy',
        color_mode: 'uniform',
        color: '#E8A33D',
        // The one pass in the row that is not opaque, and it is what makes this Style an interface
        // picture rather than two objects: the partner is a shell you read the ribbon through.
        opacity: 0.6,
      },
    ],
  },
  {
    /*
      The only cartoon-on-cartoon look in the row, and the one that generalised best of everything
      tested: no surface, no sphere pack, no transparency, so there is nothing in it that a
      structure can fail to suit. Its one weakness is a very large, very loopy big side -- 581
      residues of classic cartoon is a tangle -- which is the case `interface_spheres` and
      `interface_surface` are already better at.

      Its lighting is the row's own 169.8/7.5 rather than any one session's. That is a real choice:
      8PWW's session lights from *below* at -36.3 degrees, which flatters a ribbon and turns a pale
      body olive down one side, and a Style writes lighting for every structure it will ever meet.
    */
    id: 'interface_print',
    row: 'interfaces',
    pool: 'interfaces_domain',
    label: 'Double cartoon',
    blurb: 'Two cartoons: the big side in warm ember, its partner in cool teal.',
    requires: 'chains',
    duo_scheme: 'Ember & teal',
    writes: {
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '169.8',
      lighting_azimuth: '7.5',
      reflection_environment: 'source',
      focal_length: '29',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '2',
    },
    overlays: [
      {
        component: 'protein',
        scope: 'largest_chain',
        name: 'Largest chain',
        representation: 'cartoon',
        material: 'ceramic',
        color_mode: 'uniform',
        color: '#E0603C',
        opacity: 1,
      },
      {
        component: 'protein',
        scope: 'other_chains',
        name: 'Binding partner',
        representation: 'cartoon_railed',
        material: 'glossy',
        color_mode: 'uniform',
        color: '#3FB39A',
        opacity: 1,
      },
    ],
  },
  {
    // Written by hand.
    id: 'interface_surface',
    row: 'interfaces',
    pool: 'interfaces_domain',
    label: 'Surface & cartoon',
    blurb: 'A ceramic molecular surface with the partner chain railed into its groove.',
    requires: 'chains',
    duo_scheme: 'Aqua & coral',
    writes: {
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '162.2',
      lighting_azimuth: '34.6',
      reflection_environment: 'source',
      focal_length: '29',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.2',
    },
    overlays: [
      {
        component: 'protein',
        scope: 'largest_chain',
        name: 'Largest chain',
        representation: 'surface',
        material: 'ceramic',
        color_mode: 'uniform',
        color: '#6BE5E1',
        opacity: 1,
      },
      {
        component: 'protein',
        scope: 'other_chains',
        name: 'Binding partner',
        representation: 'cartoon_railed',
        material: 'glossy',
        color_mode: 'uniform',
        color: '#E56B6F',
        opacity: 1,
      },
    ],
  },
  {
    /*
      `interface_surface` with its partner reduced from a railed cartoon to a slender ribbon. The
      surface, its ceramic and its light are untouched; what changes is that the partner stops
      being a second solid object and becomes a line drawn on the first, so the coil of the two
      helices is legible where the railed cartoon reads as a slab.

      It is the one pair where the two members take *different kinds* of scheme, and that is the
      point rather than an inconsistency. A railed cartoon is a solid partner and holds its own
      against a saturated host, so `interface_surface` rests on two saturated colours. A slender
      ribbon is thin, and a thin partner needs a quiet host or it is lost against it -- so this one
      rests on a quiet-host pair. See the group comment in DUO_SCHEMES for why those exist.
    */
    id: 'interface_trace',
    row: 'interfaces',
    pool: 'interfaces_domain',
    label: 'Surface & ribbon',
    blurb: 'A ceramic surface with its partner drawn as one slender ribbon.',
    requires: 'chains',
    duo_scheme: 'Bone & amber',
    writes: {
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '162.2',
      lighting_azimuth: '34.6',
      reflection_environment: 'source',
      focal_length: '29',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.2',
    },
    overlays: [
      {
        component: 'protein',
        scope: 'largest_chain',
        name: 'Largest chain',
        representation: 'surface',
        material: 'ceramic',
        color_mode: 'uniform',
        color: '#CFC4AE',
        opacity: 1,
      },
      {
        component: 'protein',
        scope: 'other_chains',
        name: 'Binding partner',
        representation: 'ribbon_slender',
        material: 'glossy',
        color_mode: 'uniform',
        color: '#F2A03D',
        opacity: 1,
      },
    ],
  },

  /* ---------- Nucleic acids ---------- */
  /*
    ---------------------------------------------------------------------------------------------
    THE FIVE 4R8P STYLES, and the family that had to be invented for them.

    Each of these five is one of a family of renders re-expressed as base controls: the
    same histone octamer wrapped in 147 base pairs of DNA, the same camera, the same autumn meadow
    at -171/93.2, differing in what the protein is made of and how the duplex is coloured.
    `nucleosome` is its session to the digit; the other four were recoloured onto new schemes.

    They are the Styles that state `nucleo_scheme`, and they are why NUCLEO_SCHEMES exists. A
    protein/DNA picture has two components on screen and the interesting decision is the two
    together -- a body colour, and the colours running through the duplex. `duo_scheme` is the
    nearest existing family and cannot express it: a duo pair is one flat colour per side, and a
    duplex that is one flat colour stops reading as a duplex. So each of these Styles names one
    entry of a table of eight, each entry a protein colour and three nucleic colours, and where
    those three land follows the Style's own nucleic colour mode. One click changes every colour in
    the picture, the protein's included, which is the whole requirement.

    Their nucleic gradients are why `nucleic_gradient_start`/`nucleic_gradient_end` are on
    STYLE_FIELDS. Three of the five colour the duplex along a ramp -- by strand pair, or 5' to 3'
    -- and without those two keys a Style could pick that mode and have nothing to say about its two
    colours.
    ---------------------------------------------------------------------------------------------
  */
  {
    /*
      Its source composition, exactly. The plain statement of what the structure is: the octamer
      as a sea-green railed cartoon, the DNA drawn atom by atom and coloured by backbone part, so
      the phosphate spiral is legible as a spiral rather than as a colour.

      `Teal & bases` is this picture, and it leads NUCLEO_SCHEMES for that reason: its three nucleic
      colours are NUCLEIC_PART_COLOR_DEFAULTS in table order, which is what the session was saved
      in. The Style states no nucleic hex at all -- `nucleic_part` paints from `color_overrides`,
      which no control reaches, so the three colours arrive through the scheme.

      Its tile is baked on this session unrecoloured, which is what makes it the plain statement of
      the row rather than one of the four variations.
    */
    id: 'nucleosome',
    row: 'nucleic',
    label: 'Beads & cartoon',
    blurb: 'Sea-green histones with the DNA drawn atom by atom.',
    requires: 'nucleic',
    nucleo_scheme: 'Teal & bases',
    writes: {
      representation: 'cartoon',
      cartoon_type: 'railed',
      material: 'diffuse',
      color_mode: 'uniform',
      color: '#3D8F89',
      opacity: '1',
      nucleic_enabled: true,
      nucleic_representation: 'nucleic_ball_and_stick',
      nucleic_material: 'diffuse',
      nucleic_color_mode: 'nucleic_part',
      nucleic_opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '-171',
      lighting_azimuth: '93.2',
      reflection_environment: 'source',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '0.6',
    },
  },
  {
    /*
      Recoloured from its source. Everything is atoms: the protein in glossy sticks rather
      than a cartoon, the DNA in ball-and-stick beside it, so the two are made of visibly the same
      thing and only their colour tells them apart. That is exactly the picture a body colour and a
      base palette have to be chosen together for, which is why it rests on `Slate & ember`: a
      cool slate protein is a backdrop, and the warm bases come forward off it.

      `nucleic_base` has six labels (A, C, G, T, U and Other) against the scheme's three colours, so
      they are spread along it by `spreadColors()` -- a ramp over the bases rather than three of
      them coloured and three left at the defaults.
    */
    id: 'nucleosome_sticks',
    row: 'nucleic',
    label: 'Beads & sticks',
    blurb: 'Protein and duplex both drawn atom by atom, told apart by colour.',
    requires: 'nucleic',
    nucleo_scheme: 'Slate & ember',
    writes: {
      representation: 'sticks',
      material: 'glossy',
      color_mode: 'uniform',
      color: '#5F7FA6',
      opacity: '1',
      nucleic_enabled: true,
      nucleic_representation: 'nucleic_ball_and_stick',
      nucleic_material: 'soft_glossy',
      nucleic_color_mode: 'nucleic_base',
      nucleic_opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '-171',
      lighting_azimuth: '93.2',
      reflection_environment: 'source',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '0.4',
    },
  },
  {
    /*
      Recoloured from its source. The octamer as one solid surface with the duplex packed
      sphere by sphere around it: the answer to "how much of this particle is DNA", which neither a
      cartoon nor a ribbon can give.

      `Bone & ocean` puts a pale body under a cyan-to-indigo duplex, which is the quiet-host shape
      the interface row's four quiet DUO_SCHEMES pairs settled on, for the same reason: with the
      body neutral the eye follows the DNA around the particle.

      **The mode is `sequence`, where this look was composed on `nucleic_duplex` -- the one colour
      mode `capabilities.js` declares and does not implement.** Both are gradient modes reading the
      scheme's two endpoints; they differ in the *factor*, end-to-end along the duplex axis (a PCA
      of the residue centres) against position along each strand. Named as composed, this Style --
      the only one in the catalogue that would name that mode -- would render its whole duplex **one
      flat colour**, with the reason only in a scene note the gallery never shows. `sequence` is
      the nearest factor that exists and it puts the cyan-to-indigo ramp back on the DNA.
      Implementing `nucleic_duplex` and putting this back is the better answer, and it is a
      renderer question rather than one to settle inside a Style.
    */
    id: 'nucleosome_surface',
    row: 'nucleic',
    label: 'Wrapped surface',
    blurb: 'A pale solid particle with the duplex packed around it.',
    requires: 'nucleic',
    nucleo_scheme: 'Bone & ocean',
    writes: {
      representation: 'surface',
      surface_detail: '2',
      material: 'diffuse',
      color_mode: 'uniform',
      color: '#CFC4AE',
      opacity: '1',
      nucleic_enabled: true,
      nucleic_representation: 'nucleic_spheres',
      nucleic_material: 'glossy',
      nucleic_color_mode: 'sequence',
      nucleic_gradient_start: '#6BE5E1',
      nucleic_gradient_end: '#4A56B8',
      nucleic_opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '-171',
      lighting_azimuth: '93.2',
      reflection_environment: 'source',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '0.8',
    },
  },
  {
    /*
      Recoloured from its source. The same solid particle as `nucleosome_surface` with
      the duplex reduced to a ribbon and coloured 5' to 3', so the picture answers where the DNA
      starts and ends rather than how much of it there is. The pair is worth reading side by side:
      one decision changed, and a different question answered.

      `Plum & meadow` is the one entry in the table whose protein is a saturated colour under a
      ramp that runs through the same hue -- gold to mint to ocean past a violet body. A quiet host
      was tried here and lost the thin ribbon against it, which is the same finding the interface
      row recorded for `interface_trace`.
    */
    id: 'nucleosome_ribbon',
    row: 'nucleic',
    label: 'Duplex ribbon',
    blurb: 'A violet particle with the duplex traced end to end.',
    requires: 'nucleic',
    nucleo_scheme: 'Plum & meadow',
    writes: {
      representation: 'cartoon',
      cartoon_type: 'classic',
      material: 'diffuse',
      color_mode: 'uniform',
      color: '#8A51C2',
      opacity: '1',
      nucleic_enabled: true,
      nucleic_representation: 'nucleic_cartoon',
      nucleic_material: 'glossy',
      nucleic_color_mode: 'sequence',
      nucleic_gradient_start: '#EFD75E',
      nucleic_gradient_end: '#176FD3',
      nucleic_opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '-171',
      lighting_azimuth: '93.2',
      reflection_environment: 'source',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '0.8',
    },
  },
  {
    /*
      Recoloured from its source. Every atom of both halves as a sphere, which is the
      honest answer to how big this particle is and how tightly the DNA is wound onto it -- the same
      question `sphere_pack` asks of a peptide and `machine_spheres` of an assembly.

      `Sand & indigo` is the one scheme whose nucleic ramp ends nearly black. A sphere pack has no
      silhouette of its own once it fills the frame, so the duplex needs to darken as it goes round
      the back for the winding to read at all; a bright ramp came back as one bright shell.
    */
    id: 'nucleosome_pack',
    row: 'nucleic',
    label: 'Sphere complex',
    blurb: 'Every atom of particle and duplex, packed sphere by sphere.',
    requires: 'nucleic',
    nucleo_scheme: 'Sand & indigo',
    writes: {
      representation: 'spheres_refined',
      material: 'glossy',
      color_mode: 'uniform',
      color: '#E3B57A',
      opacity: '1',
      nucleic_enabled: true,
      nucleic_representation: 'nucleic_spheres',
      nucleic_material: 'glossy',
      nucleic_color_mode: 'sequence',
      nucleic_gradient_start: '#12BFD9',
      nucleic_gradient_end: '#332288',
      nucleic_opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '-171',
      lighting_azimuth: '93.2',
      reflection_environment: 'source',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '0.8',
    },
  },

  /* ---------- Ligands ---------- */
  /*
    ---------------------------------------------------------------------------------------------
    FOUR 7LCK STYLES.

    They are the `7LCK-Render-*` sessions, on the GLP-1 receptor around one small-molecule
    agonist, on the same hand-framed camera as `bound_glow` and `pocket_glow`, differing in what the
    body is made of and how much of the ligand is shown.

    ALL FOUR ARE HAND-WRITTEN, for the reason `bound_glow` and `pocket_glow` are: every one of
    those sessions hides the extracellular domain (chain R 28-128) so the pocket is open at all,
    and hiding part of a structure is a composition rather than a look, so no Style can carry it
    and none of these could be derived whole. What each entry *is* was still taken from the session
    rather than invented, with the hidden layer stripped and the colours decided separately. Two of
    them (`open_pocket`, `ligand_pack`) had one whole-protein layer, folded into the base -- a
    layer covering the whole component and the base picker's own settings for it are the same
    picture -- so these Styles need no overlay pass.

    THE HIDDEN LAYER IS IN THE TILES AND CANNOT BE IN THE STYLES, which is this row's standing cost
    and is worth restating here because all four pay it. Each tile is baked on a baseline that
    keeps the session's hidden layers, so it shows the extracellular domain out of shot and the
    agonist visible. Applying any of these Styles to a file the user loaded brings that domain
    back, and the ligand is then seen through a closed body. The alternative is a row of tiles
    showing a blob with a smudge in it: with the domain present, the best of 400 view directions
    exposes 8 of the ligand's 41 atoms.

    TWO OF THE FOUR WERE RECOLOURED AND TWO SHIP AS COMPOSED, and which is which follows from
    whether the session's own colours already told this row's four pictures apart. `bound_cartoon`
    and `ligand_pack` were both composed in the app's own mint, so shipped as composed they would
    have read as one picture twice; each rests on a DUO_SCHEMES pair no other Style in the row
    rests on. `ghost_ligand` and `open_pocket` keep their sessions' colours. Every one of the four
    tiles is baked on its own session through that session's Improve image recipe.
    ---------------------------------------------------------------------------------------------
  */
  {
    /*
      The plainest true statement this row can make about a bound
      ligand: a ceramic railed cartoon, the ligand drawn atom by atom in front of it, one light
      and a shallow depth of field. No transparency, no emission, no surface -- so it is the entry
      to reach for when the question is "what is bound here" rather than "what does this look like".

      ROSE & BLUE, where the session is mint and ember. Both halves move, and that is the point:
      this Style leads the row, and the two looks nearest it -- `ghost_ligand`'s near-white body and
      `bound_glow`'s cyan ribbon -- are both cool and pale, so a mint cartoon beside them would read
      as a third variation on one colour. The table's most saturated pair is the one that makes the
      leading tile a picture of its own, and the blue ligand keeps its distance from the row's
      magenta, amber and coral partners.
    */
    id: 'bound_cartoon',
    row: 'ligands',
    label: 'Bound ligand',
    blurb: 'Ceramic cartoon with the ligand drawn atom by atom.',
    requires: 'ligand',
    duo_scheme: 'Rose & blue',
    duo_sides: ['protein', 'ligand'],
    writes: {
      representation: 'cartoon',
      cartoon_type: 'railed',
      material: 'ceramic',
      color_mode: 'uniform',
      color: '#E64CA6',
      opacity: '1',
      ligands: true,
      ligand_representation: 'ligand_ball_and_stick',
      ligand_material: 'glossy',
      ligand_color_mode: 'uniform',
      ligand_color: '#3375E1',
      ligand_opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '-163',
      lighting_azimuth: '18.4',
      reflection_environment: 'source',
      focal_length: '29',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '0.6',
    },
  },
  {
    /*
      The one Style in this row whose colours are its source's, untouched.

      A spotlit ligand, as composed: the protein is a cartoon at 0.3
      opacity in a near-white that reads as glass rather than as a colour, and the ligand is a
      sphere per atom in element colour, lit at emission 9 so it carries the whole picture. The body
      is context and says so; the molecule is the subject and is the only thing in the frame with a
      colour.

      IT IS NOT A DUO STYLE, and that is the point rather than an oversight. A duo pair is one flat
      colour per side, and this ligand's colours are its *elements* -- blue is nitrogen, red is
      oxygen, and the picture would stop being true if a pair painted over them. So it declares
      `scheme_target: 'ligand'` and takes the element family, whose schemes move carbon and nothing
      else: the alternates are eight carbon tints under an unchanged nitrogen and oxygen, which is
      the only honest way to recolour a molecule drawn by element. It is the one Style in the
      catalogue that declares a scheme target at all.

      ITS TILE IS BAKED ON ITS OWN SESSION, unrecoloured: the session's own two colours *are* the
      entry's, so the tile and the entry are the same picture with nothing to reconcile.

      Two things the session carries and this entry does not. Its ligand spheres carry a
      `subdivisions` value this app has no control for; a Style could not state it either way,
      because STYLE_FIELDS has no representation_settings key. And its `emission_strength` of 9 is
      **inert**: emission strength does nothing at all unless the material is `emission` or
      `bioluminescent`, and this ligand is glossy. What makes the molecule read as the subject here
      is the ghost around it, not a light inside it -- so the field is left at its baseline rather
      than authored at a number that would describe a picture nobody renders.
    */
    id: 'ghost_ligand',
    row: 'ligands',
    label: 'Ghost & ligand',
    blurb: 'Near-transparent cartoon; the ligand lit, in element colour.',
    requires: 'ligand',
    // The body is a glass envelope on purpose; the colour worth offering alternates for is the
    // molecule's. See src/style-color-schemes.js on why this is declared rather than detected.
    scheme_target: 'ligand',
    writes: {
      representation: 'cartoon',
      cartoon_type: 'railed',
      material: 'diffuse',
      color_mode: 'uniform',
      color: '#DDE4EA',
      opacity: '0.3',
      ligands: true,
      ligand_representation: 'ligand_spheres',
      ligand_material: 'glossy',
      ligand_color_mode: 'element',
      ligand_opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '-69.9',
      lighting_azimuth: '98.5',
      reflection_environment: 'source',
      focal_length: '29',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '0.8',
    },
  },
  {
    /*
      Re-expressed as base controls.

      The session is three selection layers over a blue cartoon base, and none of the three can be a
      Style: every one of them names a residue range on chain R. Two of them turn out not to need
      to. The cyan glossy ribbon covers essentially the whole visible protein, so it is promoted to
      the base and the blue cartoon underneath it goes; the bioluminescent ligand layer covers one
      whole residue, which is the ligand component, so it becomes the ligand base. The third layer
      is the transparent one -- opacity 0 over chain R 28-128, hiding a domain -- and hiding part of
      one protein is a composition rather than a look, so it is deliberately not carried. That is
      the same line a partial-component layer always falls on, and why this entry is hand-written
      rather than derived.

      It has two sides, and they are two *components* rather than two halves of one protein --
      hence `duo_sides`. A menu
      of single-colour presets would leave the ligand's magenta unreachable from the Style card,
      which for this picture is the half that matters.
    */
    id: 'bound_glow',
    row: 'ligands',
    label: 'Ribbon & ligand',
    blurb: 'Glassy cyan ribbon with the ligand lit from inside.',
    requires: 'ligand',
    // The two sides of the picture, [host, partner], matching [big, other] in DUO_SCHEMES.
    duo_scheme: 'Cyan & magenta',
    duo_sides: ['protein', 'ligand'],
    writes: {
      representation: 'ribbon',
      ribbon_type: 'standard',
      material: 'glossy',
      color_mode: 'uniform',
      color: '#59F7E5',
      opacity: '1',
      ligands: true,
      ligand_representation: 'ligand_sticks',
      ligand_material: 'bioluminescent',
      ligand_color_mode: 'uniform',
      ligand_color: '#C73FD9',
      // The one shipped Style that moves a component emission off its default, and the whole reason
      // the ligand reads as a source rather than as a brightly painted stick.
      ligand_emission_strength: '9.5',
      lighting_source: 'cool_night',
      lighting_strength: '1.05',
      lighting_anchor: 'camera',
      lighting_elevation: '47.6',
      lighting_azimuth: '157.8',
      reflection_environment: 'source',
      focal_length: '29',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.2',
    },
  },
  {
    /*
      The size answer: every atom of the protein as a sphere, with the
      agonist threaded through the pack in sticks. It is the same question `interface_peptide`
      asks in Protein Interfaces -- how big is this molecule against the thing it binds -- with the
      partner drawn as a line rather than as a second pack, because a 41-atom ligand packed inside a
      3000-atom pack disappears into it and drawn as sticks it stays a shape.

      The session's whole-protein `spheres` layer is folded into the base as `spheres_refined`:
      both are one sphere per atom at the same radius (0.65, the base picker's own default), the
      layer's other setting has no control here, and every Style renders with hydrogens hidden
      anyway. That leaves this Style with no overlay pass, which is what lets its colour schemes
      land on a visible control -- the same move `sphere_pack` made in Small & detailed.

      AQUA & CORAL keeps the session's coral ligand and lifts the body from the app's mint to the
      brighter aqua, so the row's two mint-bodied sessions do not ship as two mint tiles. The tile is
      rendered on the session and baked with its own Improve image recipe, as `open_pocket`'s is.
    */
    id: 'ligand_pack',
    row: 'ligands',
    label: 'Spheres & ligand',
    blurb: 'Every atom a sphere, with the ligand threaded through.',
    requires: 'ligand',
    duo_scheme: 'Aqua & coral',
    duo_sides: ['protein', 'ligand'],
    writes: {
      representation: 'spheres_refined',
      material: 'glossy',
      color_mode: 'uniform',
      color: '#6BE5E1',
      opacity: '1',
      ligands: true,
      ligand_representation: 'ligand_sticks',
      ligand_material: 'soft_glossy',
      ligand_color_mode: 'uniform',
      ligand_color: '#E56B6F',
      ligand_opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '179.9',
      lighting_azimuth: '-0.7',
      reflection_environment: 'source',
      focal_length: '29',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '0.6',
    },
  },
  {
    /*
      Re-expressed as base controls by the same three steps `bound_glow`
      took: the surface layer covers essentially the whole
      visible protein and becomes the base, the ligand layer covers one whole residue and becomes
      the ligand base. Every layer in that session names a residue range, so none of it could be
      derived and this entry is hand-written.

      What it adds over `bound_glow` is the *body*: a ceramic soft-pockets surface instead of a
      ribbon, so the ligand is seen glowing through the protein rather than beside it. The session
      states its surface through settings this app does not have; `surface_detail: '2'` is the rung
      of this app's own ladder that makes the same picture.

      THE THIRD LAYER CANNOT BE CARRIED, and that is a property of the feature rather than an
      omission here. The session hides the extracellular domain -- chain R 28-128, drawn at opacity
      0 -- which is what opens the pocket and lets the agonist be seen at all. A Style may never
      name a chain, a residue or a range: `assertNoSelection` in src/style-overlays.js refuses it,
      and the four whole-component constants and the two interface scopes cannot express one
      domain of one chain. So applying this Style brings the domain back, and the picture it makes
      is the ligand seen *through* the closed body rather than sitting in an opened groove. Hiding a
      domain is a composition the user makes with a layer, not a look a preset carries.

      THE TILE IS BAKED ON A WIDENED BASELINE -- this Style's own source with that
      third layer kept as a genuinely `hidden` one rather than the authored opacity-0 one, and its
      camera untouched. A baseline's hidden layers survive into the bake, so the tile has the
      extracellular domain (the lid over the pocket) hidden, the pocket open and the ligand in it,
      while every other value in the picture is this entry's own. That hidden layer lives only on
      the baseline -- it is not part of this Style's `writes` and cannot be, per the
      `assertNoSelection` rule above. The tile is then finished with the louder Improve image
      recipe `bound_glow` renders under, rather than this Style's own:
      at 256px the glow is most of what makes a bioluminescent ligand read as a source, and a
      full-size render does not need it (see `src/catalog/style-improve.js`).

      Know what it costs, which is the same cost `bound_glow`'s tile carries: the open pocket is a
      property of the baseline and not of the Style, so it is in the tile and absent from every
      render this Style makes on a file the user loaded.

      IT DOES NOT REST ON THE SESSION'S OWN PAIR, and that is the one place the derivation gives.
      Both 7LCK sessions were composed in #59F7E5/#C73FD9 -- Cyan & magenta -- and `bound_glow` two
      entries up already rests there, so carrying it here would put both of the row's ligand
      Styles on one palette, which the per-row distinctness rule refuses and an assertion holds.
      Steel & amber is the answer rather than an arbitrary substitute: it is the quiet-host group,
      whose whole point is one quiet body and one
      loud partner saying which side to look at first, which is exactly what a ligand seen through a
      surface is. THE STYLE'S OWN "As designed" HOST IS NOT THE TABLE'S STEEL EXACTLY --
      it authors `#628BB7` rather than the table's `#8FA3B8`, a deliberately bluer host settled on by
      eye; the Steel & amber scheme itself is untouched, so picking it from the Style card still
      lands on the table's own `#8FA3B8`.

      Three hosts were rendered on the way to it, and the two rejects are worth knowing because the
      room is what decides. Cool night is a cold dark studio, so a *warm* host turns to mud in it:
      Bone's #CFC4AE came back brown, with the amber glow bleeding into a body the same family of
      colours, and nothing in the picture read as cool. Gold & indigo failed the other way -- a gold
      body is loud and a bioluminescent indigo ligand comes back pale, so the glow stopped being the
      subject. Steel's #8FA3B8 is the coldest host in the table that is not also dark (Cyan & amber's
      #00ACC1 and Slate & sand's #5F7FA6 both render near-black under this light), and against it the
      amber reads as the only warm thing in the frame. The session's own pair is still one click away
      in the Style card, where every scheme in the table is.
    */
    id: 'pocket_glow',
    row: 'ligands',
    label: 'Surface & ligand dark',
    blurb: 'Ceramic surface with the ligand glowing through it.',
    requires: 'ligand',
    duo_scheme: 'Steel & amber',
    duo_sides: ['protein', 'ligand'],
    writes: {
      representation: 'surface',
      surface_detail: '2',
      material: 'ceramic',
      color_mode: 'uniform',
      color: '#628BB7',
      opacity: '1',
      ligands: true,
      ligand_representation: 'ligand_ball_and_stick',
      ligand_material: 'bioluminescent',
      ligand_color_mode: 'uniform',
      ligand_color: '#F0A227',
      // 7, where `bound_glow` writes 9.5: this ligand is seen through a surface rather than beside
      // a ribbon, and the session settled the difference by eye.
      ligand_emission_strength: '7',
      lighting_source: 'cool_night',
      lighting_strength: '1.05',
      lighting_anchor: 'camera',
      lighting_elevation: '47.6',
      lighting_azimuth: '157.8',
      reflection_environment: 'source',
      focal_length: '29',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.2',
    },
  },
  {
    /*
      The only Style in the catalogue that shows a *cavity* with
      something burning in it. `pocket_glow` sees the ligand through a closed ceramic body; this one
      opens the body -- an open-cavities surface, which is the base picker's detail 4 and the
      session's settings to the digit -- and puts a half-transparent bioluminescent ligand in the
      groove. The session's whole-protein surface layer is folded into the base, so there is no
      overlay pass: the layer and the base picker's own controls are the same picture.

      WHITE HOSTS ONLY, and it is stated rather than left to the reader. `duo_schemes` names the seven
      pale-hosted pairs and nothing else, because this picture only works one way: a white body reads
      as a wall with a hole in it, and every colour the eye finds is inside the hole. Put a saturated
      body under it and the glow becomes a highlight on a coloured surface -- still a pleasant
      render, and no longer a picture of a pocket. The `Pearl`/`Chalk` pairs in DUO_SCHEMES are
      there for exactly this menu, beside the three `Bone` ones, the last of them this Style's own.
      There is no `Pearl & coral`: on this menu it would draw the coral of `Bone & coral` over a
      second pale body, which at 256px is the Style's own tile again.

      THE MENU IS ORDERED BY THE LIGHT IN THE HOLE, not by the wall: warm, then cool, then the two
      that give the group a green and a magenta source. `Chalk &
      mint` is the GFP reading of this picture and `Pearl & rose` the one that stays legible against
      a warm-lit body, and both are stated last so the Style's own composition still opens the row.

      IT SHIPS IN ITS SESSION'S OWN COLOURS, which is why `Bone & coral` is in DUO_SCHEMES at all.
      Every colour decision here was made by eye against a render -- the bone body, the coral glow,
      the amount of transparency the lip of the cavity needs -- and the session is that decision.
      So the pair is in the table rather than the Style resting on a near neighbour of it: a
      Style rests on a member of its own menu, and the honest way to satisfy that when the
      composition is already right is to name the composition. `Cyan & magenta` is in the table
      the same way, from 7LCK-Render-2.

      ITS TILE IS BAKED ON ITS OWN SESSION, which hides the extracellular domain -- so the tile
      shows the open pocket, and at 256px the finished glow is most of what says the ligand is a
      light source.
    */
    id: 'open_pocket',
    row: 'ligands',
    label: 'Surface & ligand light',
    blurb: 'White cavity surface with the ligand burning in the groove.',
    requires: 'ligand',
    duo_scheme: 'Bone & coral',
    // The whole menu, in the order to draw it: every pale-hosted pair in the table and no other.
    duo_schemes: [
      'Bone & coral', 'Bone & amber', 'Bone & cyan', 'Pearl & violet', 'Chalk & ember',
      'Chalk & mint', 'Pearl & rose',
    ],
    duo_sides: ['protein', 'ligand'],
    writes: {
      representation: 'surface',
      surface_detail: '4',
      material: 'ceramic',
      color_mode: 'uniform',
      color: '#CFC4AE',
      opacity: '1',
      ligands: true,
      ligand_representation: 'ligand_ball_and_stick',
      ligand_material: 'bioluminescent',
      ligand_color_mode: 'uniform',
      ligand_color: '#E56B6F',
      // Half-transparent and lit at 6.5: the ligand has to be seen *through* the lip of the cavity
      // from most angles, and a solid one at this emission fills the groove with white.
      ligand_opacity: '0.5',
      ligand_emission_strength: '6.5',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '-166.8',
      lighting_azimuth: '112',
      reflection_environment: 'source',
      focal_length: '29',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.2',
    },
  },

  /* ---------- Ions ---------- */
  /*
    ---------------------------------------------------------------------------------------------
    EIGHT ION STYLES, and what changes when the bound thing is a single atom.

    Most of them are the peptide-partner looks from Protein Interfaces -- `interface_bound` through
    `interface_pocket` -- carried across to a bound ION, beside the composition that started the
    row and three readings that only a metal ion makes sense of. The subject throughout is
    a 100-residue designed protein holding one Mn2+ at the centre of its fold. Every entry below
    was rendered before it was written, twenty-seven renders in all.

    WHAT AN ION STYLE CAN AND CANNOT SAY. The partner side of each of those looks is a peptide
    drawn atom by atom -- ball-and-stick, a sphere pack, sticks -- and a peptide has bonds, a
    backbone and a length. An ion component offers three markers (smooth, faceted or octahedral)
    and a size, and STYLE_FIELDS carries no representation setting at all: those inputs are
    generated per representation with no stable ids, so every ion Style renders at the picker's own
    0.75 radius whatever it would prefer. That is the single hardest constraint here, because
    radius is the dial that decides whether the ion is an atom in a structure or the subject of a
    picture. It costs these Styles nothing only because
    B_des_17-Render-13 is itself composed at 0.75 -- the size its author was already happy with.

    THE ION IS BURIED, where the six source Styles' partners sit in grooves open to the camera.
    Carried verbatim, `interface_pocket`'s open-cavity surface renders a picture with no ion in it
    at all, so it is the one of the six that is deliberately NOT here. In its place is
    `darkfield_ion`, which answers the same question --
    what does a body do so the thing inside it can be seen -- by going transparent rather than by
    opening a hole that never reaches the core.

    EMISSION IS NOT CARRIED AT THE SOURCE STYLES' VALUES. `interface_glow_peptide` lights its
    partner at 9.5, tuned against an object with hundreds of times an ion's screen area; on one
    sphere that clips to flat white and takes the authored colour with it. Every value in this group
    was therefore found by rendering rather than by scaling, and they do not agree with each other
    because the pictures do not: `glowing_ion` sits at 7 with its room dimmed to 0.85,
    `darkfield_ion` at 13.5, found against a shell at 0.25 and seen through one at 0.4, and
    `metal_centre_dark` at 17.5, nearly the top of the control's 0-20 range, because an emitter that
    small in a body that dark has almost no area to work with. The rule they share is the one an ion
    breaks: an emissive ion shows its colour in the light it spills onto what surrounds it, not on
    its own surface.

    ALL EIGHT ARE HAND-WRITTEN except `bound_ion`, which is derived from its session.
    ---------------------------------------------------------------------------------------------
  */
  {
    /*
      The composition the rest of the row came out of, shipped as
      its author made it: a ceramic cartoon in the app's own mint with the ion a glossy rose bead,
      one light and a shallow depth of field. The plainest of the eight and the one to reach for
      when the question is "what is bound here".

      MINT & LILAC, with the partner half revised. The session's own two colours are #58BFA8 and
      #DD466C, and the table's nearest member shares the host exactly and differs on the partner --
      so this rests on Mint & lilac and authors its own rose, which is the same thing `pocket_glow`
      does with its host and what `authoredPair` in style-color-schemes.js exists for. `As designed`
      is therefore the session's rose rather than the table's lilac. `seated_ion` below is the entry
      that actually rests on the table's pair, so nothing frames Mint & lilac twice.

      ONE THING THE CROSSING LOSES, and it is the generic one rather than anything about ions:
      the session's cartoon carries hand-moved geometry sliders, and STYLE_FIELDS has no
      `cartoon_settings` key, so the Style writes the Classic cartoon type and renders a slightly
      fuller ribbon than the session's own render.
    */
    id: 'bound_ion',
    row: 'ions',
    label: 'Classic cartoon & ion',
    blurb: 'Ceramic cartoon with the ion as a glossy bead.',
    requires: 'ion',
    duo_scheme: 'Mint & lilac',
    duo_sides: ['protein', 'ion'],
    writes: {
      representation: 'cartoon',
      cartoon_type: 'classic',
      material: 'ceramic',
      color_mode: 'uniform',
      color: '#58BFA8',
      opacity: '1',
      ions: true,
      ion_representation: 'ion_spheres',
      ion_material: 'glossy',
      ion_color_mode: 'uniform',
      ion_color: '#DD466C',
      ion_opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '169.8',
      lighting_azimuth: '7.5',
      reflection_environment: 'source',
      focal_length: '29',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.2',
    },
  },
  {
    /*
      `interface_peptide` from Protein Interfaces, and the one of the six that had to be rebuilt
      rather than carried. That Style is a sphere-pack host with its peptide drawn out in sticks,
      and neither half survives contact with this subject: an ion has no bonds to draw as sticks,
      and an all-atom host is off the table on a design file whose side-chain atoms sit on the
      origin -- the same point the ion occupies -- so a packed body would render a wad of coincident
      spheres over the subject.

      What carries across is the idea underneath it: a solid host with the guest drawn in a
      different geometry family. For an ion that means the FACETED marker against a smooth body, and
      it is the one genuinely ion-native decision in this group -- the facets read as a crystal
      rather than as another sphere, which is how to give a one-atom object material character
      without asking it to be reflective (see the two metal entries below for why reflective fails).

      GOLD & INDIGO rather than the source Style's Mint & lilac, which `bound_ion` above already
      rests on. An indigo crystal in a gold body is also the strongest reading of the facets at
      36px, where a lilac marker on mint was two pale colours.
    */
    id: 'seated_ion',
    row: 'ions',
    label: 'Railed cartoon & ion',
    blurb: 'A glossy body with the ion cut as a faceted crystal.',
    requires: 'ion',
    duo_scheme: 'Gold & indigo',
    duo_sides: ['protein', 'ion'],
    writes: {
      representation: 'cartoon',
      cartoon_type: 'railed',
      material: 'glossy',
      color_mode: 'uniform',
      color: '#EFC245',
      opacity: '1',
      ions: true,
      ion_representation: 'ion_faceted',
      ion_material: 'soft_glossy',
      ion_color_mode: 'uniform',
      ion_color: '#4A56B8',
      ion_opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '169.8',
      lighting_azimuth: '7.5',
      reflection_environment: 'source',
      focal_length: '29',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '0.6',
    },
  },
  {
    /*
      The first of the three metal entries, and the one idea in this group that uses what the
      partner actually IS: a manganese ion drawn as metal. `chrome_bead` below is this same mirror
      smoothed into a sphere; `metal_centre_dark`, further down the row, is what the idea has to
      become once the body goes dark and a mirror has nothing left to show.

      CHROME, AND THE REFLECTION IS THE WHOLE PICTURE. A mirror the size of one atom has no shape of
      its own to show: it renders whatever surrounds it, so what it is given to reflect decides
      whether it is visible at all. Two environments were rendered before this one and both fail --
      the studio softboxes and the scientific grid put cold bright panels in the facets that read as
      grey against a pale body, and the grid tints them olive. `reflection_environment: 'source'`
      hands the marker the autumn meadow HDRI instead, which is warm and has a sky and a ground in
      it, so the bead comes back a dark warm gold against the bone cartoon and reads as metal rather
      than as a dot. That is also why this entry keeps its amber base colour: a metal's base colour
      is its reflectance, and the amber is what warms what the meadow gives back.

      The lesson generalises and is the opposite of the obvious one. Reaching for a brighter, more
      structured environment makes a small mirror *less* visible, because a bright panel reflected in
      a curved facet is a small grey highlight; a warm HDRI with tonal range in it gives the whole
      bead a colour. `lighting_strength` cannot be used for any of this -- it is global, and lighting
      the ion means lighting the protein.

      BONE & AMBER: a quiet warm body with a warm metal in it, which is the pairing this picture
      wants and the reason the quiet-host group exists at all.
    */
    id: 'chrome_centre',
    row: 'ions',
    label: 'Chrome mineral',
    blurb: 'A quiet body with the metal ion faceted and lit.',
    requires: 'ion',
    duo_scheme: 'Bone & amber',
    duo_sides: ['protein', 'ion'],
    writes: {
      representation: 'cartoon',
      cartoon_type: 'railed',
      material: 'ceramic',
      color_mode: 'uniform',
      color: '#CFC4AE',
      opacity: '1',
      ions: true,
      ion_representation: 'ion_faceted',
      ion_material: 'chrome',
      ion_color_mode: 'uniform',
      ion_color: '#F2A03D',
      ion_emission_strength: '3.5',
      ion_opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '169.8',
      lighting_azimuth: '7.5',
      reflection_environment: 'source',
      focal_length: '29',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.2',
    },
  },
  {
    /*
      `chrome_centre` with the marker smoothed into a bead, and the pair is worth having because the
      two are not the same mirror. Facets break the surround into a handful of flat planes, each
      returning one patch of it; a sphere is one continuous mirror, so it returns the whole field at
      once -- the body around it, the ground below and the sky above, wrapped into a single image a
      few pixels across. That is what makes this the entry to reach for when the point is that the
      ion is *in* something rather than that it is metal.

      A SATURATED BODY, WHERE ITS SIBLING TAKES A QUIET ONE, and the reason is the reflection rather
      than the palette. A mirror shows what surrounds it, so the host's colour is half of what the
      bead looks like: against `chrome_centre`'s bone the reflection is a pale wash, and against
      ember the bead carries the protein's own colour in it, which is the whole subject here. It is
      also what keeps the two tiles apart -- at 0.75 units and 256px, faceted against smooth is a
      difference you have to hunt for, while a warm body against a pale one is not.

      Ember & teal puts the one cool bead in a warm frame, so what reads at tile size is a green
      mirror in an orange fold. `reflection_environment: 'source'` is carried from its sibling and
      for the same reason: the autumn meadow HDRI has a sky, a ground and warmth in it, and a small
      mirror is only ever as interesting as what it is given to reflect. The studio and grid
      environments were rendered first for the faceted entry and both come back as grey highlights.
    */
    id: 'chrome_bead',
    row: 'ions',
    label: 'Chrome bead',
    blurb: 'A mirrored bead that carries the fold and the sky in it.',
    requires: 'ion',
    duo_scheme: 'Ember & teal',
    duo_sides: ['protein', 'ion'],
    writes: {
      representation: 'cartoon',
      cartoon_type: 'railed',
      material: 'ceramic',
      color_mode: 'uniform',
      color: '#E0603C',
      opacity: '1',
      ions: true,
      ion_representation: 'ion_spheres',
      ion_material: 'chrome',
      ion_color_mode: 'uniform',
      ion_color: '#3FB39A',
      ion_emission_strength: '3.5',
      ion_opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '169.8',
      lighting_azimuth: '7.5',
      reflection_environment: 'source',
      focal_length: '29',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.2',
    },
  },
  {
    /*
      `interface_ghost` with an ion for a partner, and the crossing that needed the least changing
      of all six -- the radius aside, which no Style can state anyway. That Style's premise is that
      the host is context and says so while the bound thing is the only solid object in the frame,
      and this is a more accurate description of a metal centre than it ever was of a peptide.

      PEARL & VIOLET is the source Style's own pair, kept because it is the reason that entry works:
      a body deliberately almost not there needs a pair that quietens it without turning it grey,
      and violet is the saturated partner hue this row does not otherwise use. It is the one entry
      of the eight whose scheme is carried across unchanged, because nothing about the pairing was
      about the peptide.
    */
    id: 'ghost_ion',
    row: 'ions',
    label: 'Ghost & ion',
    blurb: 'A near-transparent body with the ion the only solid thing in it.',
    requires: 'ion',
    duo_scheme: 'Pearl & violet',
    duo_sides: ['protein', 'ion'],
    writes: {
      representation: 'cartoon',
      cartoon_type: 'railed',
      material: 'diffuse',
      color_mode: 'uniform',
      color: '#DDE4EA',
      opacity: '0.3',
      ions: true,
      ion_representation: 'ion_octahedron',
      ion_material: 'glossy',
      ion_color_mode: 'uniform',
      ion_color: '#8A51C2',
      ion_opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '-69.9',
      lighting_azimuth: '98.5',
      reflection_environment: 'source',
      focal_length: '29',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '0.8',
    },
  },
  {
    /*
      The third metal entry, and it changes two things rather than one: the body goes dark, and the
      marker stops being a mirror and becomes a light. It sits apart from `chrome_centre` and
      `chrome_bead` in the row because it is not the same picture as either.

      WHY THE MATERIAL HAD TO CHANGE WITH THE BODY. `chrome_centre` works because a mirror reflects
      the meadow, and a mirror is only ever as bright as what surrounds it -- put the same bead in
      front of a body this dark and it reflects the dark body and disappears. That is the failure
      chrome cannot be rescued from, and it was rendered in both directions before this entry
      settled. So the dark half uses `emission`: not a lit surface but a light, which owes nothing
      to its surroundings and is therefore the one material whose visibility a dark body cannot take
      away.

      EMISSION 17.5, which is far above anything else in the catalogue and is a property of the
      subject rather than a taste for brightness. `#ion-fluorescence` runs 0-20, and an object 0.75
      units across sitting in the fold's own shadow needs most of that range before it reads as a
      source; the two glow entries elsewhere in this row sit at 7 and 13.5 on larger or less
      occluded geometry. At this value the bead throws a visible warm cast onto the ribbon nearest
      it, which is wanted here -- it is what makes the ion look like the thing lighting the picture
      -- and is exactly what the pale half must avoid.

      THE DARKNESS IS THE HOST COLOUR, NOT THE ROOM, and a pair in DUO_SCHEMES says so. Turning
      the lights down is the wrong mechanism twice over: `dark_studio` leaves a pale body pale, so
      the picture is not dark at all, and dimming the room dims the marker along with it.
      `Ink & amber` is the table's one dark host, there for exactly this --
      see the note beside it in color-defaults.js for why a dark body is admissible on the same
      ground the quiet-host group is.
    */
    id: 'metal_centre_dark',
    row: 'ions',
    label: 'Cartoon & glowing ion',
    blurb: 'The metal ion lit against a body gone to shadow.',
    requires: 'ion',
    duo_scheme: 'Ink & amber',
    duo_sides: ['protein', 'ion'],
    writes: {
      representation: 'cartoon',
      cartoon_type: 'railed',
      material: 'ceramic',
      color_mode: 'uniform',
      color: '#243441',
      opacity: '1',
      ions: true,
      ion_representation: 'ion_faceted',
      ion_material: 'emission',
      ion_color_mode: 'uniform',
      ion_color: '#F2A03D',
      ion_emission_strength: '17.5',
      ion_opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '169.8',
      lighting_azimuth: '7.5',
      reflection_environment: 'studio',
      focal_length: '29',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.2',
    },
  },
  {
    /*
      `interface_glow_peptide` with an ion for a partner: a glassy ribbon body under cool night with
      the guest lit from inside. The most literal crossing of the six, because that Style lights a
      peptide from within and an ion is already a point source -- and the one that had to have a
      number changed rather than a colour.

      EMISSION 7 UNDER A DIMMED ROOM, and the two go together. The source Style's 9.5 was tuned
      against a five-residue peptide and clips a single 0.75 sphere to flat white, taking the
      authored colour with it; 4 was tried and reads as a lit bead rather than a source. 7 with
      `lighting_strength` at 0.85 is the pairing that works: dropping the room a notch is what buys
      the extra emission back, so the ion gains without the ribbon around it turning pink. The rule
      underneath is worth stating, because it is the one an ion breaks: an emissive ion shows its
      colour in the light it spills onto what surrounds it, not on its own surface, so both numbers
      are chosen by looking at the spill rather than at the sphere.

      THE STANDARD RIBBON, not the slender one. Slender leaves a guest this small unobstructed,
      but at 0.75 the ion does not need the help: at
      emission 7 it reads through the standard weight, and the heavier ribbon is the better picture
      of a fold.

      SLATE & SAND is the source Style's own pair, and it is the one place this group repeats a
      pair already used elsewhere -- `interface_glow_peptide` rests on it too. Three cooler
      alternatives were rendered first and every one failed on the light rather than on taste:
      cool night is a dark
      room, a warm host (Bone & cyan) comes back brown in it, and the two near-white hosts (Pearl,
      Chalk) come back a washed mauve with the glow dyeing the body pink. Slate is the one host in
      the table that is cool and mid-dark, which is what a source needs to be seen against. The
      repeat is admissible because the rule it bends exists to stop one picture shipping twice, and
      these two are not one picture: a sphere-packed receptor under autumn meadow against a fine
      ribbon in a dark room with a burning core.
    */
    id: 'glowing_ion',
    row: 'ions',
    label: 'Ribbon & glowing ion',
    blurb: 'A glassy ribbon with the ion lit from inside.',
    requires: 'ion',
    duo_scheme: 'Slate & sand',
    duo_sides: ['protein', 'ion'],
    writes: {
      representation: 'ribbon',
      ribbon_type: 'standard',
      material: 'glossy',
      color_mode: 'uniform',
      color: '#5F7FA6',
      opacity: '1',
      ions: true,
      ion_representation: 'ion_spheres',
      ion_material: 'bioluminescent',
      ion_color_mode: 'uniform',
      ion_color: '#E3B57A',
      ion_emission_strength: '7',
      ion_opacity: '1',
      lighting_source: 'cool_night',
      lighting_strength: '0.85',
      lighting_anchor: 'camera',
      lighting_elevation: '47.6',
      lighting_azimuth: '157.8',
      reflection_environment: 'source',
      focal_length: '29',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.2',
    },
  },
  {
    /*
      The eighth, and the one that stands in for `interface_pocket`. That Style opens a cavity so
      its partner can be seen in the groove, and on a buried ion it renders a picture with no ion in
      it: cavities are opened by rolling a probe over the outside of the fold, so whether the core is
      reached is a property of the structure and not of the Style. Dropping the body's opacity brings
      the ion back but leaves it weak, a pale guest inside a pale translucent host.

      What answers the same question -- what does a body do so the thing inside it can be seen --
      is this: the fold as a faint glass shell with the ion genuinely burning inside it, under
      dark-field light. Transparency instead of a hole, and it cannot fail on a structure whose
      pocket happens not to reach the surface.

      AN OPAQUE SOURCE INSIDE A SHELL THAT IS NOT QUITE GLASS. The ion is `emission` at 13.5 and
      fully opaque -- a source has nothing to gain from being see-through -- and the 0.4 is on the
      *shell*: `opacity` 0.4 against the 0.25 `fluorescent_glow` carries under the same dark-field
      light. Those extra 0.15 are what give the body enough substance to catch the light coming off
      the ion, so the picture is a lit interior rather than a bright dot behind a pane.
      Both readings were rendered before this one shipped; the transparent-ion version comes back
      greyer, because an emitter with a quarter of its area missing has that much less to emit from.

      The emission is high for the same reason `metal_centre_dark`'s is higher still: an object this
      small has very little area to emit from, and here it is also being seen through a body. An
      emissive material only ever reads as emitting against a dark field; under autumn meadow it
      renders as a pastel dot. View this tile against the Black matte.

      CYAN & AMBER, a warm source inside a cold envelope. The shell ships at 0.4, which is where
      the cyan is a colour of its own and the source still reads as being inside it; thinner than
      that and the envelope is barely a colour at all.
    */
    id: 'darkfield_ion',
    row: 'ions',
    label: 'Glow in glass',
    blurb: 'A glass shell with the ion burning inside it.',
    requires: 'ion',
    duo_scheme: 'Cyan & amber',
    duo_sides: ['protein', 'ion'],
    writes: {
      representation: 'surface',
      surface_detail: '1',
      material: 'glass',
      color_mode: 'uniform',
      color: '#00ACC1',
      opacity: '0.4',
      ions: true,
      ion_representation: 'ion_spheres',
      ion_material: 'emission',
      ion_color_mode: 'uniform',
      ion_color: '#E8A33D',
      ion_emission_strength: '13.5',
      ion_opacity: '1',
      lighting_source: 'fluorescence_darkfield',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '90.1',
      lighting_azimuth: '89',
      reflection_environment: 'source',
      focal_length: '29',
      // Off. The subject is a single ion a few ångström across seen through a shell, and at f/1.8
      // it falls out of focus as easily as into it -- the one thing in the frame that has to be
      // sharp, decided by where the focus point happens to land. The f-stop goes with the
      // switch, as the other two glass Styles' do.
      depth_of_field_enabled: false,
    },
  },

  /* ---------- Assemblies & machines ---------- */
  /*
    The row reads in two halves. The first three are the capsid -- one subject, three ways of
    drawing sixty chains -- and each rests on a different member of CATEGORICAL_SCHEMES for exactly
    the reason the six 4HHB Styles in Multimers do: three by-chain looks on one sphere of chains,
    all opening on Broad wheel, read as one picture rendered three times. They walk the family in
    its own order, one member per Style, first to third.

    The rest are machines. `machine_spheres` and its two variants are 10EC and walk the shared
    eight gradient pairs the same way, first to third; the last three are the Multimers looks that
    only come into their own at assembly scale, copied here and rendered on GroEL/GroES. A copy is
    deliberately a copy: both halves name the same session, so only the id, the row, the palette it
    opens on and -- for `assembly_wide_beads` -- the gradient it was recoloured onto may differ.
  */
  {
    /*
      `chain_surface` in Multimers, at assembly scale, and the row's lead: a solid surface with
      the chains in colour is the plainest true statement about an assembly, so it is
      the picture to open on. Same look, same session behind it (4HHB-surfacemultimer_scheme4), a
      tile rendered on the capsid instead of the tetramer, and the first member of the family rather
      than that Style's Meadow.
    */
    id: 'assembly_chain_surface',
    color_scheme: 'Broad wheel',
    row: 'assemblies',
    label: 'Ceramic virus',
    blurb: 'Solid surface, chains told apart by colour.',
    requires: 'chains',
    writes: {
      representation: 'surface',
      surface_detail: '1',
      material: 'glossy',
      color_mode: 'chain',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1.1',
      lighting_anchor: 'camera',
      lighting_elevation: '177.5',
      lighting_azimuth: '21.1',
      reflection_environment: 'source',
      focal_length: '29',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '2.2',
    },
  },
  {
    // The capsid as a sphere of chains, on the family's second member.
    id: 'capsid',
    color_scheme: 'Ocean',
    row: 'assemblies',
    label: 'Planet virus',
    blurb: 'One low-detail surface, chains picked out in colour.',
    writes: {
      representation: 'surface',
      surface_detail: '1',
      material: 'diffuse',
      color_mode: 'chain',
      opacity: '1',
      lighting_source: 'overcast_sky',
      lighting_strength: '1.1',
      lighting_anchor: 'camera',
      lighting_elevation: '93.7',
      lighting_azimuth: '-80.4',
      reflection_environment: 'source',
      depth_of_field_enabled: false,
    },
  },
  {
    id: 'dark_assembly',
    color_scheme: 'Sunset',
    row: 'assemblies',
    label: 'Dark virus',
    blurb: 'A machine lit from a dark room, chains in cool light.',
    writes: {
      representation: 'surface',
      surface_detail: '1',
      material: 'satin',
      color_mode: 'chain',
      opacity: '1',
      lighting_source: 'dark_studio',
      lighting_strength: '1.6',
      lighting_anchor: 'camera',
      reflection_environment: 'grid',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '2.0',
    },
  },
  {
    /*
      Every atom a sphere, coloured along the chain, on the first of the
      eight pairs. It rests on a member of its own menu like every other gradient Style with a
      stated one: a gradient a hair off one of the pairs draws a ninth swatch nobody can tell from
      its neighbour.
    */
    id: 'machine_spheres',
    row: 'assemblies',
    label: 'Machine rainbow',
    blurb: 'Every atom a sphere; scale you can feel.',
    color_schemes: SEQUENCE_GRADIENT_PAIRS,
    writes: {
      representation: 'spheres_refined',
      atom_scope: 'all',
      material: 'diffuse',
      color_mode: 'sequence',
      gradient_start: '#178BD3',
      gradient_end: '#E2A34B',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '-178.2',
      lighting_azimuth: '9',
      reflection_environment: 'source',
      depth_of_field_enabled: false,
    },
  },
  {
    /*
      The machine sphere pack again, with the two decisions that change what it is *about*: glossy
      instead of diffuse, so every atom keeps a highlight and the pack reads as a surface of beads
      rather than one mass; and `x_axis` instead of `sequence`, so the ramp runs straight across the
      assembly and colours where a thing sits rather than how far along its chain it is. On a
      machine built of many copies of a few chains that is the more honest of the two.

      One thing to know before changing its pair: a ramp across a body this deep only ever shows the
      part of itself that faces the camera, so several of the eight collapse on this subject. Blue
      to amber comes back teal-to-blue, mint to lime comes back one green, and red to rose comes
      back one red -- a tile of a Style whose whole subject is that the colour changes across the
      machine, not changing across the machine.
    */
    id: 'machine_axis',
    row: 'assemblies',
    label: 'Machine axis',
    blurb: 'Every atom a glossy sphere, coloured straight across the machine.',
    color_schemes: SEQUENCE_GRADIENT_PAIRS,
    writes: {
      representation: 'spheres_refined',
      atom_scope: 'all',
      material: 'glossy',
      color_mode: 'x_axis',
      gradient_start: '#30CFB4',
      gradient_end: '#DD46AD',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '-178.2',
      lighting_azimuth: '9',
      reflection_environment: 'source',
      depth_of_field_enabled: false,
    },
  },
  {
    /*
      `rainbow_ribbon` at assembly scale, and the third axis rather than the chain: `z_axis` runs
      the ramp into the picture, so the near face of a machine and its far face are different
      colours and the depth of the thing is what the colour says. Depth of field is off where that
      Style has it on -- an assembly has to stay legible from front to back, which is the whole
      subject here.
    */
    id: 'machine_ribbon',
    row: 'assemblies',
    label: 'Machine ribbon',
    blurb: 'A broad ribbon through the machine, coloured front to back.',
    color_schemes: SEQUENCE_GRADIENT_PAIRS,
    writes: {
      representation: 'ribbon',
      ribbon_type: 'standard',
      material: 'ceramic',
      color_mode: 'z_axis',
      gradient_start: '#8EDC84',
      gradient_end: '#D98CD2',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1.2',
      lighting_anchor: 'camera',
      lighting_elevation: '-36.3',
      lighting_azimuth: '55.1',
      reflection_environment: 'source',
      depth_of_field_enabled: false,
    },
  },
  {
    /*
      `wide_spheres` in Multimers, rendered on GroEL/GroES. The look is a 14mm lens over a body of
      chains, and a tetramer is the smallest thing it says anything on; on a
      fourteen-subunit barrel the near chains loom and the far ones rush away, which is what the
      lens was put on the allowlist for. Same session, same writes -- see the note at the top of
      this row.
    */
    id: 'assembly_wide_spheres',
    row: 'assemblies',
    label: 'Wide-angle spheres 2',
    blurb: 'Side chains as soft spheres, packed along a wide cartoon.',
    color_schemes: SEQUENCE_GRADIENT_PAIRS,
    writes: {
      representation: 'cartoon',
      cartoon_type: 'railed',
      material: 'ceramic',
      color_mode: 'sequence',
      gradient_start: '#D27941',
      gradient_end: '#4B8AE2',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '169.8',
      lighting_azimuth: '7.5',
      reflection_environment: 'source',
      focal_length: '14',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '0.3',
    },
    overlays: [
      { component: 'protein', from: 'base', name: 'Backbone' },
      {
        component: 'protein',
        name: 'Side chains',
        representation: 'side_chain_spheres',
        representation_settings: { sphere_radius: 0.48, show_hydrogens: true },
        material: 'soft_glossy',
        color_mode: 'sequence',
        gradient_start: '#D27941',
        gradient_end: '#4B8AE2',
        color: '#CDFEF3',
        opacity: 1,
      },
    ],
  },
  {
    /*
      `wide_beads` in Multimers, rendered on GroEL/GroES. See `assembly_wide_spheres`.

      This is the one copy that is *not* its original's colours: it rests on the fifth pair where
      `wide_beads` rests on the third, so the two wide tiles in this row are not one picture in two
      bead sizes. Both the base and the side-chain pass carry the pair, because `styleWithScheme()`
      only recolours a pass that holds the same colours as the base it mirrors. The gradient is the
      only deliberate departure; everything else in this entry is `wide_beads`'s.
    */
    id: 'assembly_wide_beads',
    row: 'assemblies',
    label: 'Wide-angle beads 2',
    blurb: 'Side chains beaded out in ball-and-stick over a wide cartoon.',
    color_schemes: SEQUENCE_GRADIENT_PAIRS,
    writes: {
      representation: 'cartoon',
      cartoon_type: 'railed',
      material: 'ceramic',
      color_mode: 'sequence',
      gradient_start: '#D651A3',
      gradient_end: '#5DD5A3',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '169.8',
      lighting_azimuth: '7.5',
      reflection_environment: 'source',
      focal_length: '14',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '0.3',
    },
    overlays: [
      { component: 'protein', from: 'base', name: 'Backbone' },
      {
        component: 'protein',
        name: 'Side chains',
        representation: 'side_chain_ball_and_stick',
        representation_settings: { sphere_radius: 0.29, bond_radius: 0.2, show_hydrogens: true },
        material: 'soft_glossy',
        color_mode: 'sequence',
        gradient_start: '#D651A3',
        gradient_end: '#5DD5A3',
        color: '#ADFFED',
        opacity: 1,
      },
    ],
  },
  {
    /*
      `chain_spheres` in Multimers, rendered on GroEL/GroES. Four chains is enough to show what
      one colour per chain means and too few to show what it is *for*: on a barrel of
      fourteen identical subunits plus a cap, the palette is what tells the ring from the lid.
      It rests on the fourth member rather than that Style's fifth.
    */
    id: 'assembly_chain_spheres',
    color_scheme: 'Meadow',
    row: 'assemblies',
    label: 'Machine spheres',
    blurb: 'Every atom a sphere, one colour per chain.',
    requires: 'chains',
    writes: {
      representation: 'spheres_refined',
      material: 'glossy',
      color_mode: 'chain',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '-168.5',
      lighting_azimuth: '21.1',
      reflection_environment: 'source',
      focal_length: '29',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '2.2',
    },
  },

  /* ---------- Confidence & Disorder ---------- */
  {
    /*
      `plddt` is not an authored <option>: main.js adds
      it to #protein-color-mode only when the file carries confidence values, and
      applyStyleWrites() skips
      a value the control does not offer -- so this Style degrades to leaving the colour alone
      rather than blanking it. `requires` is what keeps it off the Recommended row meanwhile.
    */
    id: 'confidence',
    row: 'predicted',
    label: 'Confidence cartoon',
    blurb: 'AlphaFold pLDDT bands on a railed ceramic cartoon.',
    requires: 'plddt',
    writes: {
      representation: 'cartoon',
      cartoon_type: 'railed',
      material: 'ceramic',
      color_mode: 'plddt',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '-168.5',
      lighting_azimuth: '21.1',
      reflection_environment: 'source',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.2',
    },
  },
  {
    /*
      The same light and lens as `confidence`, on every
      atom instead of the trace, so the disordered tails read as bulk rather than as a line.
    */
    id: 'confidence_atoms',
    row: 'predicted',
    label: 'Confidence spheres',
    blurb: 'Every atom as a glossy bead, banded by confidence.',
    requires: 'plddt',
    writes: {
      representation: 'spheres_refined',
      material: 'glossy',
      color_mode: 'plddt',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '-168.5',
      lighting_azimuth: '21.1',
      reflection_environment: 'source',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.2',
    },
  },
  {
    id: 'confidence_surface',
    row: 'predicted',
    label: 'Confidence surface',
    blurb: 'Confidence read off the envelope rather than the trace.',
    requires: 'plddt',
    writes: {
      representation: 'surface',
      surface_detail: '3',
      material: 'soft_glossy',
      color_mode: 'plddt',
      opacity: '1',
      lighting_source: 'overcast_sky',
      lighting_strength: '1.1',
      lighting_anchor: 'camera',
      lighting_elevation: '171.3',
      lighting_azimuth: '-15.6',
      reflection_environment: 'source',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.8',
      focal_length: '29',
    },
  },
  {
    /*
      `confidence`'s cartoon with every side chain beaded out over it, and both halves banded by the
      same confidence. The composition is `sidechain_beads` from Monomers & domains -- railed ceramic
      cartoon, a `from: 'base'` mirror of it, and one soft-glossy ball-and-stick pass -- on this
      row's own light rather than that Style's, so it sits beside `confidence` as the same picture
      with the side chains added.

      What it shows that `confidence` does not: a low-confidence region is low-confidence in its
      *rotamers* as much as in its trace, and drawing only the backbone hides that. The beads make a
      disordered stretch read as a spray of loose amber rather than as a thin amber line.

      Both passes cover the whole protein, so the base is masked away and the mirror is what puts
      the cartoon back -- see THE MASKING TRAP in src/style-overlays.js. The ball-and-stick pass
      carries no colour table of its own; `styleOverlayLayerState()` in main.js hands it the
      protein's, which is what keeps the beads and the cartoon on the same ramp when a colour scheme
      other than `As designed` is chosen.
    */
    id: 'confidence_side_chains',
    row: 'predicted',
    label: 'Confidence side chains',
    blurb: 'Ball-and-stick side chains over a cartoon, both banded by confidence.',
    requires: 'plddt',
    writes: {
      representation: 'cartoon',
      cartoon_type: 'railed',
      material: 'ceramic',
      color_mode: 'plddt',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '-168.5',
      lighting_azimuth: '21.1',
      reflection_environment: 'source',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.2',
    },
    overlays: [
      { component: 'protein', from: 'base', name: 'Backbone' },
      {
        component: 'protein',
        name: 'Side chains',
        representation: 'side_chain_ball_and_stick',
        material: 'soft_glossy',
        color_mode: 'plddt',
        opacity: 1,
      },
    ],
  },
  {
    /*
      The B-factor half of this row. `confidence`'s light and lens to
      the digit -- the two were composed in one sitting so the two halves read as one row -- with
      the ramp doing the other
      job: on calmodulin the rigid EF-hand lobes come back navy and the central helix that lets them
      close comes back hot, which is the picture B-factor is for.

      Like `confidence`, the session's own `color_overrides` are dropped on the way in. Unlike it,
      they are not lost: that table *is* BFACTOR_COLOR_STOPS, so `As designed` renders exactly
      what the session did. See src/color-defaults.js.
    */
    id: 'flexibility',
    row: 'disorder',
    label: 'Disorder cartoon',
    blurb: 'B-factor along a railed ceramic cartoon: what moves and what does not.',
    requires: 'bfactor',
    writes: {
      representation: 'cartoon',
      cartoon_type: 'railed',
      material: 'ceramic',
      color_mode: 'bfactor',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '-168.5',
      lighting_azimuth: '21.1',
      reflection_environment: 'source',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.2',
      focal_length: '29',
    },
  },
  {
    /*
      `confidence_atoms` to the digit, with `bfactor` in place of `plddt` and nothing else changed.

      That is deliberate and it is the point of the pair. The two halves of this row answer the same
      question from different data, so holding the *look* fixed across them is what makes the ramp
      the only variable a reader has to account for -- a B-factor sphere pack under its own light
      and lens would have been a second picture rather than the same picture over different data.
      Its tile is rendered on 1CLL for the same reason in reverse: the look is shared, so the
      subject has to say which half you are looking at.
    */
    id: 'flexibility_atoms',
    row: 'disorder',
    label: 'Disorder spheres',
    blurb: 'Every atom as a glossy bead, banded by B-factor.',
    requires: 'bfactor',
    writes: {
      representation: 'spheres_refined',
      material: 'glossy',
      color_mode: 'bfactor',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '-168.5',
      lighting_azimuth: '21.1',
      reflection_environment: 'source',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.2',
    },
  },
  {
    // `confidence_surface` to the digit, with `bfactor` in place of `plddt`. See
    // `flexibility_atoms` above for why the two rows' looks are held identical.
    id: 'flexibility_surface',
    row: 'disorder',
    label: 'Disorder surface',
    blurb: 'Mobility read off the envelope rather than the trace.',
    requires: 'bfactor',
    writes: {
      representation: 'surface',
      surface_detail: '3',
      material: 'soft_glossy',
      color_mode: 'bfactor',
      opacity: '1',
      lighting_source: 'overcast_sky',
      lighting_strength: '1.1',
      lighting_anchor: 'camera',
      lighting_elevation: '171.3',
      lighting_azimuth: '-15.6',
      reflection_environment: 'source',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.8',
      focal_length: '29',
    },
  },

  {
    /*
      The B-factor twin of `confidence_side_chains`, identical to it but for the colour mode -- the
      same rule the rest of this row follows, and for the reason `flexibility_atoms` gives. It is
      also the entry where holding the look fixed pays off most: a high-B-factor side chain is
      precisely the one whose density was too weak to place with confidence, so the loose amber
      spray means the same thing on both halves of the row.
    */
    id: 'flexibility_side_chains',
    row: 'disorder',
    label: 'Disorder side chains',
    blurb: 'Ball-and-stick side chains over a cartoon, both banded by B-factor.',
    requires: 'bfactor',
    writes: {
      representation: 'cartoon',
      cartoon_type: 'railed',
      material: 'ceramic',
      color_mode: 'bfactor',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '-168.5',
      lighting_azimuth: '21.1',
      reflection_environment: 'source',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.2',
    },
    overlays: [
      { component: 'protein', from: 'base', name: 'Backbone' },
      {
        component: 'protein',
        name: 'Side chains',
        representation: 'side_chain_ball_and_stick',
        material: 'soft_glossy',
        color_mode: 'bfactor',
        opacity: 1,
      },
    ],
  },

  /* ---------- Concept ---------- */
  /*
    The row is ordered by what the material does with light, which is the only axis its entries
    share: a Concept Style states a material and a lamp and almost nothing else, so ordering them by
    representation or by colour would sort them on the variable they are not about.

    The walk is absorb -> scatter -> transmit -> reflect -> emit. Clay swallows the light, Jelly
    scatters it under the skin, Crystal and Glass pipe bend it through an envelope and then
    through the thinner ribbon, Cast metal and Chrome balls hand it back -- first off a struck
    surface, then off several hundred mirrors -- and Glow is the one that supplies its
    own. Reading down the row a viewer sees one property change at a time, and the two refractive
    entries and the two reflective ones sit beside their own kind rather than across the shelf from
    them.
  */
  {
    id: 'clay_model',
    row: 'cover',
    label: 'Clay',
    blurb: 'Matte ceramic, shape before colour.',
    writes: {
      representation: 'surface',
      surface_detail: '1',
      material: 'ceramic',
      color_mode: 'uniform',
      color: '#D86A3B',
      lighting_source: 'neutral_softbox',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '-156.5',
      lighting_azimuth: '-40.9',
      reflection_environment: 'source',
      depth_of_field_enabled: false,
    },
  },
  {
    id: 'jelly',
    row: 'cover',
    label: 'Jelly',
    blurb: 'A soft translucent body under a neutral softbox.',
    writes: {
      representation: 'surface',
      surface_detail: '2',
      material: 'jelly',
      color_mode: 'uniform',
      color: '#D63AA8',
      opacity: '0.75',
      lighting_source: 'neutral_softbox',
      lighting_strength: '1.2',
      lighting_anchor: 'camera',
      lighting_elevation: '-149.3',
      lighting_azimuth: '15.4',
      reflection_environment: 'source',
      depth_of_field_enabled: false,
    },
  },
  {
    id: 'crystal',
    row: 'cover',
    label: 'Crystal',
    blurb: 'Refractive glass against a bright studio.',
    writes: {
      representation: 'surface',
      surface_detail: '2',
      material: 'glass',
      color_mode: 'uniform',
      color: '#8FE3F5',
      lighting_source: 'glass_studio',
      lighting_strength: '1.3',
      reflection_environment: 'studio',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '2.0',
    },
  },
  {
    /*
      The second refractive entry, and the one that shows what `crystal` cannot: glass on a form
      thin enough to see the far side of the fold through the near side. `crystal` seals the whole
      protein inside one envelope and reads as an object; a standard ribbon in the same material
      reads as the trace, lensed. That is the pair the two make, so they sit together.

      It is the row's only entry lit by the meadow rather than a studio or a softbox -- a refractive
      ribbon needs something with structure behind it to bend, and a featureless softbox gives it
      nothing to carry.
    */
    id: 'meadow_glass',
    row: 'cover',
    label: 'Glass pipe',
    blurb: 'A refractive ribbon lensing the sky behind it.',
    writes: {
      representation: 'ribbon',
      ribbon_type: 'standard',
      material: 'glass',
      color_mode: 'uniform',
      color: '#58BFA8',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1.2',
      lighting_anchor: 'camera',
      lighting_elevation: '154.3',
      lighting_azimuth: '19.7',
      reflection_environment: 'source',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.6',
      focal_length: '24',
    },
  },
  {
    /*
      The reflective pair opens here. `chrome_balls` is a mirror the size of one atom and therefore
      has no shape of its own to show; this one is struck metal over the fold itself, backbone and
      side chains in the same material, so the sheen follows the helix instead of the pack. Same
      meadow and same 24mm lens as the beads beside it, which is what makes the two read as one
      material question asked at two scales.

      Two whole-protein passes and no base mirror, which is deliberate: a pass removes its atoms
      from the protein base, and between them the backbone and the side chains are the whole
      protein, so a base pass would render nothing. That is why the Style states no base
      `representation`, `material` or `color_mode` -- the same shape `chrome_balls` has, and it is
      asserted rather than taken on trust.
    */
    id: 'cast_metal',
    row: 'cover',
    label: 'Cast metal',
    blurb: 'Backbone and side chains struck in the same metal.',
    // The same eight pairs every other sequence-gradient Style states, and this one rests on the
    // fourth of them exactly as `cartoon_ball_and_stick` and `sidechain_beads` do. Left unstated it
    // would draw generated alternates: six anonymous pairs in an order nothing else shares, under a
    // picture whose colours are the row's own.
    color_schemes: SEQUENCE_GRADIENT_PAIRS,
    writes: {
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '175.2',
      lighting_azimuth: '2.1',
      reflection_environment: 'source',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.8',
      focal_length: '24',
    },
    overlays: [
      {
        component: 'protein',
        name: 'Backbone',
        representation: 'cartoon',
        material: 'metallic',
        color_mode: 'sequence',
        gradient_start: '#D27941',
        gradient_end: '#4B8AE2',
        opacity: 1,
      },
      {
        component: 'protein',
        name: 'Side chains',
        representation: 'side_chain_ball_and_stick',
        representation_settings: { sphere_radius: 0.29, bond_radius: 0.2, show_hydrogens: false },
        material: 'metallic',
        color_mode: 'sequence',
        gradient_start: '#D27941',
        gradient_end: '#4B8AE2',
        color: '#ADFFED',
        opacity: 1,
      },
    ],
  },
  {
    /*
      The row's one entry made of atoms rather than an envelope, and the one that owes its whole
      look to a material. Chrome the size of one atom has no shape to show of its own -- the same
      thing `chrome_bead` says about a single mirrored ion -- so a pack of them shows the meadow,
      and each other, several hundred times over. That is why it sits here and not on Small &
      detailed: the picture is the material, and the fold is only what holds it up.

      It carries no overlay pass, and that is the point rather than an omission. Its session had
      one -- a single whole-protein layer of spheres in chrome -- but the layer stated nothing the
      base picker does not already default to (0.65 radius; `show_hydrogens` is forced off for
      every Style anyway), so it folds into the base controls. Same
      picture, one fewer selection layer, one fewer rail card, and the colour schemes land on a base
      that actually renders. A pass earns its layer by asking for something `writes` cannot say --
      a non-default radius, a second pass over the same atoms -- and this one does not.
    */
    id: 'chrome_balls',
    row: 'cover',
    label: 'Chrome balls',
    blurb: 'Every atom a mirrored bead, holding the sky and its neighbours.',
    writes: {
      representation: 'spheres_refined',
      material: 'chrome',
      color_mode: 'element',
      opacity: '1',
      lighting_source: 'autumn_meadow',
      lighting_strength: '1',
      lighting_anchor: 'camera',
      lighting_elevation: '152.6',
      lighting_azimuth: '26.5',
      reflection_environment: 'source',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '1.8',
      focal_length: '24',
    },
  },
  {
    // Self-lit protein in a dark field. Last on the row because it is the
    // one material that needs no lamp at all -- the walk from absorb to emit ends here.
    id: 'bioluminescent',
    row: 'cover',
    label: 'Glow',
    blurb: 'Self-lit ribbon in dark field.',
    writes: {
      representation: 'cartoon',
      // Composed on a `slender` cartoon type; `classic` carries that cross-section.
      cartoon_type: 'classic',
      material: 'bioluminescent',
      color_mode: 'uniform',
      color: '#3AD6BB',
      emission_strength: '0.5',
      lighting_source: 'fluorescence_darkfield',
      lighting_strength: '0.8',
      reflection_environment: 'source',
      depth_of_field_enabled: true,
      depth_of_field_f_stop: '2.0',
    },
  },
];


export function styleById(id) {
  return STYLE_CATALOG.find((style) => style.id === id);
}
