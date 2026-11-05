/*
  Colour schemes for a Style: one alternate-picker that works for every colour mode, not just two.

  THE FAMILY IS CHOSEN FROM THE MODE, because half the modes do not carry a colour in `writes` at
  all. Reading `writes.color` for a `uniform` Style and `writes.gradient_start`/`gradient_end` for a
  `sequence` one reaches only two of the eight: every by-chain multimer and assembly Style, both
  confidence ramps and every by-element study paint from `color_overrides` instead, a table keyed on
  something the *structure* supplies -- a chain id, an element symbol, a base letter, a confidence
  band. A picker that reads `writes` reads the wrong half of the colour state for a third of the
  catalogue.

  So: one function, `styleColorSchemes(style)`, answering "what else could this Style be coloured
  as" for all eight modes, with a family per mode:

      uniform                                -> the twelve named presets (UNIFORM_COLOR_PRESETS),
                                                 plus the authored hex below them when it is not one
      sequence / x_axis / y_axis / z_axis     -> a stated `color_schemes` menu, or, for a Style that
                                                 states none, the authored pair + generated pairs
      chain                                   -> named positional palettes (CATEGORICAL_SCHEMES),
                                                 resting on the member `color_scheme` names
      element                                 -> named carbon tints (ELEMENT_SCHEMES)
      nucleic_base / nucleic_part             -> named keyed palettes
      plddt / bfactor                         -> named ramp recolourings, stops unmoved

  and one family chosen by a stated field rather than by the mode:

      duo_scheme                              -> named two-colour pairs (DUO_SCHEMES), one colour
                                                 per side of an interface
      nucleo_scheme                           -> named protein-and-nucleic sets (NUCLEO_SCHEMES),
                                                 one body colour and three duplex colours

  Both stated families are answered first, before the mode is even read. An interface Style is
  `uniform` on both of its scoped passes and has no visible base at all, so the mode alone would
  send it to the twelve single-colour presets -- a menu for a picture whose subject is that it has
  two colours. A protein-and-nucleic Style is `uniform` on its protein base and would go the same
  way, leaving every colour in the duplex -- the half the picture is named for -- unreachable.

  The Style's own authored colour is always a member of the list rather than a state outside it, so
  the picker always has something already selected. It is not always first: a family whose menu is a
  fixed table in a fixed order -- the twelve uniform presets, the eight gradient pairs, the duo
  pairs -- draws it where it sits, marked `As designed`, so several Styles sharing a family draw one
  identical row and differ only in which swatch opens framed. Look the `authored` id up; never
  assume `schemes[0]`.

  TWO GROUPS. The scheme row is the family's own table. A uniform Style's authored colour that is
  *not* one of the twelve presets goes into a second group the card draws under it, along with any
  colours the Style names in `extra_colors` (`fluorescent_glow`'s two other dyes). Nothing else
  changes -- same writes, same ids, same choosing -- so `group` is read by the panel and by nobody
  else.

  A scheme carries its writes *and* its overrides, because the two families reach the app by
  different routes and the caller should not have to know which: `writes` are STYLE_FIELDS keys that
  go through the ordinary `applyWrites()` path, and `labels`/`palette` are per-category colours that
  main.js writes into `styleColorOverrides`. Nothing here touches the DOM, so the whole system is
  testable by handing it a catalogue entry.

  WHICH COMPONENT. A Style's colour is normally its protein base, and that is the default. One
  shipped Style is about something else -- `ghost_ligand` ghosts the protein down to a glassy
  envelope so the ligand can be the subject -- and for it the colour worth offering alternates for is
  the component's. (A protein/DNA picture needs both components' colours rather than one
  component's, which is what `nucleo_scheme` answers.) It says so with an explicit `scheme_target`
  rather than being detected by a heuristic over opacity and greyness, because the catalogue is the
  place that knows what a Style is *about*.

  OVERLAY PASSES. `styleWithScheme()` also re-colours the Style's overlay passes, and it has to:
  `sidechain_beads` writes its rainbow twice, once on the base cartoon and once on the side-chain
  pass, so a scheme that only rewrote the base would recolour the cartoon and leave the beads on
  the authored gradient. A pass is re-coloured only when it is in the same colour mode as
  the base *and* currently holds the same colours, i.e. when it was authored as a copy of the base.
  A pass that deliberately differs -- `glass_ribbon`'s uniform pale shell over a rainbow ribbon --
  is left exactly alone, unless the Style names it in `scheme_tint` (see below).

  A GLASS SHELL. `scheme_tint` is the third answer, for the passes that are neither. `in_glass` and
  `fluorescent_glow` seal their body inside a faint glass envelope, and that envelope was authored
  as its own pale colour -- not a copy of the body, so nothing carries it along, and choosing a
  blue-to-amber rainbow would leave a mint shell over it. It is not a copy either, so it cannot take
  the scheme's colour: at the body's saturation the shell stops being glass. A named pass therefore
  keeps its own saturation and lightness and takes only the *hue* of the chosen scheme, through
  `tintedToward()` in color-defaults.js. `darkfield_ion`, the third glass Style, needs none of this:
  its shell is the protein base itself and a `duo_sides` pair already writes it.

  A MASKED BASE. `tube_side_chains` has no base look at all: its two passes cover the whole protein
  and mask it away, so the Style states no representation, material or colour -- none of it would
  appear. Reading `writes` there answers with STYLE_BASELINE's mint over a picture painted as a
  rainbow. `styleColorState()` therefore sources such a Style's colour from the first pass that
  paints one, and marks the state `fromPass` so the schemes carry no `writes`: there is no visible
  base control to write, and `styleWithScheme()` reaches the picture through the passes. It is the
  fallback and not the goal: where a look allows it, folding a whole-protein pass into the base is
  what puts a Style's schemes on an ordinary visible control.
*/

import { GRADIENT_COLOR_MODES } from './capabilities.js';
import { STYLE_BASELINE } from './catalog/styles.js';
import { OVERLAY_SCOPE_SIDES, overlayMasksBase } from './style-overlays.js';
import {
  BFACTOR_COLOR_STOPS,
  CATEGORICAL_SCHEMES,
  DUO_SCHEMES,
  ELEMENT_SCHEMES,
  METRIC_RAMP_SCHEMES,
  NUCLEIC_BASE_COLOR_DEFAULTS,
  NUCLEIC_BASE_SCHEMES,
  NUCLEIC_PART_COLOR_DEFAULTS,
  NUCLEIC_PART_SCHEMES,
  NUCLEO_SCHEMES,
  PLDDT_COLOR_STOPS,
  spreadColors,
  defaultCategoryColor,
  suggestColorSchemePairs,
  tintedToward,
  UNIFORM_COLOR_PRESETS,
} from './color-defaults.js';

// How many generated alternates the two computed families offer beside the authored colour. The
// named families have as many as their table does.
export const COLOR_SCHEME_COUNT = 5;

/*
  Which section of the Style card a scheme is drawn in. Every scheme is in `SCHEME_GROUP` except a
  uniform Style's own colour when it is not one of the twelve presets, and the colours it names in
  `extra_colors`, which are drawn in a second group under the first (see `uniformSchemes()`). It is
  presentation and nothing else: a scheme in either group carries the same writes and is chosen the
  same way, so the sweep, the apply path and `colorSchemeById()` never look at it.
*/
export const SCHEME_GROUP = 'scheme';
export const EXTRA_COLOR_GROUP = 'extra';
/*
  `Style colours`, not `Colours`, because the group holds two shapes: `fluorescent_glow`'s three
  dyes, a row of alternatives, and a uniform Style whose colour is simply not one of the twelve
  presets, which draws the same group with one swatch in it. Over one swatch "Colours" reads as a
  second, shorter palette rather than as this Style's own colour. The longer label is true of both:
  these are the colours that belong to the Style rather than to the app's row of twelve.
*/
export const EXTRA_COLOR_GROUP_LABEL = 'Style colours';


export function schemesInGroup(schemes, group = SCHEME_GROUP) {
  return schemes.filter((entry) => (entry.group ?? SCHEME_GROUP) === group);
}

// The four components a scheme can target, and the STYLE_FIELDS keys each one's colour lives in.
// `gradient` is offered for protein only: the nucleic endpoints (`nucleic_gradient_start/end`) are
// written by `nucleoSchemes()` alone, and ligand and ion have none in STYLE_FIELDS.
const COMPONENT_COLOR_FIELDS = {
  protein: {
    mode: 'color_mode', color: 'color', start: 'gradient_start', end: 'gradient_end',
  },
  nucleic: { mode: 'nucleic_color_mode', color: 'nucleic_color' },
  ligand: { mode: 'ligand_color_mode', color: 'ligand_color' },
  ion: { mode: 'ion_color_mode', color: 'ion_color' },
};

export const SCHEME_TARGETS = Object.keys(COMPONENT_COLOR_FIELDS);

// The protein base's endpoint modes (only protein has `start` in COMPONENT_COLOR_FIELDS). Narrower
// than GRADIENT_COLOR_MODES because `nucleic_duplex` is not a protein mode.
const GRADIENT_MODES = new Set(['sequence', 'x_axis', 'y_axis', 'z_axis']);


/** Which component's colour a Style's schemes are about. `protein` unless the Style says otherwise. */
export function styleSchemeTarget(style) {
  const declared = style?.scheme_target;
  if (declared === undefined) return 'protein';
  if (!SCHEME_TARGETS.includes(declared)) {
    throw new Error(
      `Style ${style?.id} targets schemes at ${JSON.stringify(declared)}; `
      + `a scheme targets one of ${SCHEME_TARGETS.join(', ')}.`,
    );
  }
  return declared;
}


/*
  The colour state a Style really applies for one component: its own declared value where it has
  one, STYLE_BASELINE's where it stays silent. Reading the baseline matters as much as reading the
  declaration -- `resolvedStyleWrites()` writes the baseline for every field a Style omits, so a
  Style silent on `ligand_color_mode` genuinely applies `element`, and offering it uniform-colour
  alternates would describe a picture it does not render.
*/
export function styleColorState(style, target = styleSchemeTarget(style)) {
  const fields = COMPONENT_COLOR_FIELDS[target];
  const writes = style?.writes ?? {};
  const read = (key) => (key && writes[key] !== undefined ? writes[key] : STYLE_BASELINE[key]);
  /*
    A Style whose whole-component passes mask its own base is a real and shipped case -- the Small &
    detailed row has one, where the picture is a tube and its side chains and the base underneath
    renders nothing. Reading the base's controls there would offer alternates for a colour nobody
    can see (and, since such a Style states no colour at all, would offer STYLE_BASELINE's mint
    under a rainbow). The colour worth offering is the one the passes are painted in, so that is
    what is read, and `fromPass` is what stops the scheme writing it back into the invisible base
    controls.
  */
  if (overlayMasksBase(style, target)) {
    const painted = (style.overlays ?? []).find((pass) => (
      pass.component === target && pass.from !== 'base' && pass.color_mode !== undefined
    ));
    if (painted) {
      return {
        target,
        fromPass: true,
        mode: painted.color_mode,
        color: painted.color ?? read(fields.color),
        gradientStart: painted.gradient_start ?? read(fields.start),
        gradientEnd: painted.gradient_end ?? read(fields.end),
      };
    }
  }
  return {
    target,
    mode: read(fields.mode),
    color: read(fields.color),
    gradientStart: read(fields.start),
    gradientEnd: read(fields.end),
  };
}


function scheme(base, extra) {
  return { ...base, ...extra };
}


/** One `[name, {label: hex}]` table entry as a scheme, with a swatch drawn from `preview`. */
function keyedScheme(target, mode, id, [label, labels], preview) {
  return {
    id,
    label,
    target,
    mode,
    kind: 'palette',
    // The default entry is `{}` -- "leave every label at its own default" -- and carrying it
    // explicitly is what makes re-picking it a real reset rather than a no-op over stale overrides.
    labels: { ...labels },
    swatch: preview(labels),
    writes: {},
  };
}


// The colours a keyed scheme shows on its button: the labels it actually moves, in table order,
// against enough unchanged neighbours to read as a palette rather than a single dot.
function keyedSwatch(component, mode, order) {
  return (labels) => order
    .slice(0, 5)
    .map((label, index) => labels[label] ?? defaultCategoryColor(component, mode, label, index));
}


/*
  The alternates a uniform Style offers are the twelve named presets the Protein card's own Uniform
  colour row draws, not hues generated from the authored one. `suggestColorSchemes()` rotates a hex
  by a fixed rule, so every Style would offer a different five and none of them would have a name --
  six anonymous dots that change per tile. The presets are the colours this app already says are
  its colours, so picking one from a Style card and picking one from the left rail land on the same
  set, and the swatch has something to be called.

  ONE ROW, ONE ORDER, EVERY STYLE. The scheme row is exactly `UNIFORM_COLOR_PRESETS` in table order,
  for every uniform Style, which is what makes the twelve swatches a menu a reader learns once
  rather than twelve per tile. Leading with the authored colour would draw a preset out of its own
  place, and put a thirteenth swatch in front for every Style whose colour is not one: same colours,
  a different order under each tile. Only the *framing* moves. If the authored colour is one of the
  twelve, that preset is the `authored` entry and is labelled `As designed` where it already sits;
  the row is otherwise untouched.

  A COLOUR THAT IS NOT ONE OF THE TWELVE GOES BELOW, in the second group the panel draws under the
  row: a colour that is not a preset is a colour chosen for this picture, and drawn at the head of
  the preset row it reads as a body colour the user had simply not been offered. `extra_colors`
  therefore does not *move* the authored colour; it names the colours to draw *beside* it down
  there, which for `fluorescent_glow` is two other dyes.
*/
function uniformSchemes(target, mode, authored, extras) {
  const fields = COMPONENT_COLOR_FIELDS[target];
  const isAuthored = (hex) => hex.toUpperCase() === authored.toUpperCase();
  const preset = UNIFORM_COLOR_PRESETS.findIndex(([, hex]) => isAuthored(hex));
  const rows = [
    // The scheme row: the twelve, in table order, whatever this Style is painted in.
    ...UNIFORM_COLOR_PRESETS.map(([label, hex], index) => (
      [index === preset ? 'As designed' : label, hex, SCHEME_GROUP, index === preset]
    )),
    // The group below: the authored colour when it is not one of the twelve, then whatever the
    // catalogue names beside it. A Style painted in a preset has nothing to put here, and the panel
    // hides the empty group.
    ...(preset < 0 ? [['As designed', authored, EXTRA_COLOR_GROUP, true]] : []),
    ...(extras ?? []).map(([label, hex]) => [label, hex, EXTRA_COLOR_GROUP, false]),
  ];
  return rows.map(([label, hex, group, authoredHere]) => scheme({
    id: authoredHere ? 'authored' : `uniform-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    label,
    group,
    target,
    mode,
    kind: 'uniform',
    swatch: [hex],
    color: hex,
    writes: { [fields.color]: hex },
  }));
}


/*
  A catalogue entry may state its own `color_schemes`, which is how a Style whose alternates were
  chosen by eye keeps them: `suggestColorSchemePairs()` rotates the authored hues by a fixed rule,
  so it can offer a pleasant set but not a specific one.

  **A stated list is the whole menu, in the order to draw it** -- not alternates appended after the
  authored pair. The Style's own pair is one of its members and is labelled `As designed` wherever
  it sits, so several Styles sharing one set of pairs draw one identical row and differ only in
  which swatch opens already framed. That is what the five Small & detailed gradient Styles do:
  one eight-pair menu in one order, each Style resting on a different member of it. Promoting the
  pair to the front instead would have reordered the row per Style, which reads as five different
  menus, and leaving it in place *and* prepending it would draw the same pair twice.

  A generated list still leads with the authored pair, and so does a stated list that does not
  contain it -- there has to be an `As designed` entry either way.
*/
function gradientSchemes(target, mode, start, end, authoredPairs) {
  const fields = COMPONENT_COLOR_FIELDS[target];
  const isAuthoredPair = ([from, to]) => from.toUpperCase() === start.toUpperCase()
    && to.toUpperCase() === end.toUpperCase();
  const stated = authoredPairs?.length ? authoredPairs : undefined;
  const pairs = stated?.some(isAuthoredPair)
    ? stated
    : [[start, end], ...(stated ?? suggestColorSchemePairs(start, end, COLOR_SCHEME_COUNT))];
  // Only the first match is `As designed`; a list repeating the pair would otherwise carry the id
  // twice and light two swatches from one click.
  let authoredIndex = pairs.findIndex(isAuthoredPair);
  if (authoredIndex < 0) authoredIndex = 0;
  return pairs.map(([from, to], index) => scheme({
    id: index === authoredIndex ? 'authored' : `gradient-${index}`,
    label: index === authoredIndex ? 'As designed' : `${from.toUpperCase()} → ${to.toUpperCase()}`,
    target,
    mode,
    kind: 'gradient',
    swatch: [from, to],
    gradientStart: from,
    gradientEnd: to,
    writes: { [fields.start]: from, [fields.end]: to },
  }));
}


/*
  The named families. Each is `[name, table]` from color-defaults.js with its first entry relabelled
  `As designed`, so every mode's picker reads the same way: the authored look first, already
  selected, and the alternates after it.
*/
function namedSchemes(target, mode, table, preview) {
  return table.map(([name, labels], index) => keyedScheme(
    target,
    mode,
    index === 0 ? 'authored' : `${mode}-${index}`,
    [index === 0 ? 'As designed' : name, labels],
    preview,
  ));
}


/*
  A by-chain Style may state which member of `CATEGORICAL_SCHEMES` it rests on, in `color_scheme`.

  This is the palette answer to the gradient `color_schemes` above, and it exists for the same
  reason and in the same shape: the menu is one fixed list in one fixed order, and a Style says
  which of its members opens already framed. The six 4HHB Styles in Multimers & interfaces are one
  tetramer photographed six ways, so on one palette the row would read as one picture rendered six
  times; each rests on a different member, exactly as the five Small & detailed gradient Styles do.

  It is a *name*, not a list and not a palette: the family is per colour mode and shared by every
  by-chain Style, so a Style stating its own colours would be stating a family of one. An unknown
  name throws rather than falling back to Broad wheel -- a typo would otherwise ship the default
  under a Style that says it rests on something else, and the tile would be the only evidence.

  A Style that stays silent rests on the first member, which is the app's own chain wheel.
*/
export function styleAuthoredPaletteIndex(style) {
  const name = style?.color_scheme;
  if (name === undefined) return 0;
  const index = CATEGORICAL_SCHEMES.findIndex(([label]) => label === name);
  if (index < 0) {
    throw new Error(
      `Style "${style?.id}" states color_scheme "${name}", which is not in CATEGORICAL_SCHEMES`,
    );
  }
  return index;
}


/*
  The two-colour family, for a Style whose picture is an interface rather than a protein.

  This is the third shape of "state which member you rest on", after the gradient `color_schemes`
  list and the by-chain `color_scheme` name, and it exists because the interface Styles have a
  colour state none of the other eight modes can describe. Their base is masked away entirely -- the
  two scoped passes partition the protein between them -- so there is no base hex to read, and the
  thing worth choosing is not *a* colour but the *pair*: which two colours the largest chain and its
  partners are told apart by.

  `duo_scheme` is required rather than optional, unlike `color_scheme`. A by-chain Style that stays
  silent rests on Broad wheel, which is the app's own default and a real answer; a duo Style that
  stayed silent would rest on whichever pair happened to be first, which is a guess about a picture
  the catalogue already contains. So the field is stated and an unknown name throws: the named pair
  has to be the colours the Style's own passes are actually painted in, or the entry, the table and
  the tile stop being one picture.
*/
export function styleDuoSchemeIndex(style) {
  const name = style?.duo_scheme;
  const index = DUO_SCHEMES.findIndex(([label]) => label === name);
  if (index < 0) {
    throw new Error(
      `Style "${style?.id}" states duo_scheme ${JSON.stringify(name)}, which is not in DUO_SCHEMES`,
    );
  }
  return index;
}


/*
  Which members of the table a duo Style offers, as table indices in the order to draw them.

  Silence is the normal answer and means all eighteen, which is what keeps the interface Styles one
  identical row of swatches with only the framed one moving. A Style may narrow it by stating
  `duo_schemes`, a list of names -- the same shape as a gradient Style's `color_schemes`, and here
  for a sharper reason than taste: `open_pocket` is a white body with a lit cavity in it, and a
  saturated host turns the cavity into a highlight on a coloured surface. The pairs it may rest on
  are a property of that picture, so the catalogue states them rather than trusting every future
  reader of the table to notice.

  Two things throw rather than falling back, for the reason an unknown `duo_scheme` does: a name
  that is not in the table, and a menu that does not contain the Style's own pair. The second would
  leave `As designed` undrawn -- the one entry the card must always be able to return to.
*/
export function styleDuoSchemeMenu(style) {
  const authored = styleDuoSchemeIndex(style);
  const stated = style?.duo_schemes;
  if (stated === undefined) return DUO_SCHEMES.map((entry, index) => index);
  const menu = (Array.isArray(stated) ? stated : []).map((name) => {
    const index = DUO_SCHEMES.findIndex(([label]) => label === name);
    if (index < 0) {
      throw new Error(
        `Style "${style?.id}" lists duo scheme ${JSON.stringify(name)}, which is not in DUO_SCHEMES`,
      );
    }
    return index;
  });
  if (!menu.includes(authored)) {
    throw new Error(
      `Style "${style?.id}" rests on ${JSON.stringify(style?.duo_scheme)}, `
      + 'which its own duo_schemes list does not offer',
    );
  }
  return menu;
}


/*
  Which two *components* a duo Style's pair lands on, for a Style whose two sides are components
  rather than two sides of one protein.

  The interface Styles partition one protein between two scoped overlay passes, so their pair is
  applied by `scope` and there is no base control to write. `bound_glow` is the other shape: its
  host is the protein base and its partner is the ligand base, both ordinary visible controls, and
  it has no overlay passes at all. Stating the two sides is what lets one table serve both -- and it
  is stated rather than detected for the same reason `duo_scheme` is: the catalogue is the place
  that knows which side of a picture is the host.

  Order is the whole contract: `[host, partner]`, matching `[big, other]` in DUO_SCHEMES, so a
  quiet-host pair quietens the body and never the thing the picture is about.
*/
export function styleDuoSides(style) {
  const sides = style?.duo_sides;
  if (sides === undefined) return undefined;
  const named = Array.isArray(sides) ? sides : [];
  const known = named.length === 2
    && named.every((name) => SCHEME_TARGETS.includes(name))
    && named[0] !== named[1];
  if (!known) {
    throw new Error(
      `Style "${style?.id}" states duo_sides ${JSON.stringify(sides)}; `
      + `a duo pair lands on two different components of ${SCHEME_TARGETS.join(', ')}.`,
    );
  }
  return [...named];
}


/*
  Every pair in the table, in table order, with the Style's own marked `As designed` -- the same
  shape `paletteSchemes()` has, for the same reason: the interface Styles sharing one menu in one
  order read as one set, and only the framed swatch moves between them. A Style that states
  `duo_schemes` draws that subset instead, still in the order it states (see styleDuoSchemeMenu).

  `writes` is empty for a scope-sided Style and that is not an omission: its base controls render
  nothing, so there is no visible control for a scheme to write, and the pair reaches the picture
  through `styleWithScheme()` painting the two scoped passes. A `duo_sides` Style is the opposite --
  both of its sides *are* base controls, so the pair is an ordinary pair of writes and travels the
  same `applyWrites()` path every other scheme's writes do.

  `authoredPair` is the Style's own writes for its two sides, read at the call site rather than here
  -- for a scope-sided Style there is no such pair, and the table entry itself is what "As designed"
  means. For a `duo_sides` Style it is not always the table's own pair: a Style may rest on a member
  of the table (naming it in `duo_scheme`) while authoring a colour off that member, e.g.
  `pocket_glow`'s host. Falling back to the table's pair there
  would make "As designed" apply a colour the Style never wrote.
*/
function duoSchemes(target, authoredIndex, sides, authoredPair, menu) {
  const writesFor = (pair) => (sides
    ? Object.fromEntries(sides.map((side, half) => [COMPONENT_COLOR_FIELDS[side].color, pair[half]]))
    : {});
  // Ids stay the table's own index, never the menu's: a narrowed menu is a different set of
  // swatches, not a different numbering, so `duo-11` means Steel & amber under every Style.
  return menu.map((index) => {
    const [name, pair] = DUO_SCHEMES[index];
    const isAuthored = index === authoredIndex;
    const resolved = isAuthored && authoredPair ? authoredPair : pair;
    return {
      id: isAuthored ? 'authored' : `duo-${index}`,
      label: isAuthored ? 'As designed' : name,
      target,
      mode: 'uniform',
      kind: 'duo',
      // [host, partner]. Fixed, so picking a scheme recolours the two sides and never swaps them.
      duo: [...resolved],
      sides: sides ? [...sides] : undefined,
      swatch: [...resolved],
      writes: writesFor(resolved),
    };
  });
}


/*
  Which member of `NUCLEO_SCHEMES` a protein-and-nucleic Style rests on.

  Required rather than optional, for the same reason `duo_scheme` is: a Style that stayed silent
  would rest on whichever entry happened to be first, which is a guess about a picture the
  catalogue already contains. An unknown name throws rather than falling back, so a typo is a named
  failure instead of a tile nobody can tell from its neighbour.
*/
export function styleNucleoSchemeIndex(style) {
  const name = style?.nucleo_scheme;
  const index = NUCLEO_SCHEMES.findIndex(([label]) => label === name);
  if (index < 0) {
    throw new Error(
      `Style "${style?.id}" states nucleo_scheme ${JSON.stringify(name)}, which is not in NUCLEO_SCHEMES`,
    );
  }
  return index;
}


// The labels each keyed nucleic mode paints, in the order its own default table lists them. Order
// is what makes a scheme's three colours a *ramp* over them rather than an arbitrary assignment.
const NUCLEIC_KEYED_LABELS = {
  nucleic_base: Object.keys(NUCLEIC_BASE_COLOR_DEFAULTS),
  nucleic_part: Object.keys(NUCLEIC_PART_COLOR_DEFAULTS),
};


/*
  The protein-and-nucleic family: one protein colour and three nucleic colours per entry, drawn as
  one four-stop swatch so the card shows the whole picture's palette rather than half of it.

  Where the three nucleic colours land follows the Style's own nucleic colour mode, and that is the
  only dispatch in here -- see the table's comment in color-defaults.js for why one table has to
  serve a keyed mode, a gradient and a flat colour alike.

  The protein half is always an ordinary `color` write, so it travels the same `applyWrites()` path
  every other scheme's writes do; the keyed half is `labels`, which main.js writes into
  `styleColorOverrides`, exactly as an element or base scheme's are. A caller never has to know
  which route a given entry used.
*/
function nucleoSchemes(style, authoredIndex) {
  const { mode } = styleColorState(style, 'nucleic');
  const keyed = NUCLEIC_KEYED_LABELS[mode];
  return NUCLEO_SCHEMES.map(([name, { protein, nucleic }], index) => {
    const writes = { color: protein };
    let labels;
    if (keyed) {
      const spread = spreadColors(nucleic, keyed.length);
      labels = Object.fromEntries(keyed.map((label, at) => [label, spread[at]]));
    } else if (GRADIENT_COLOR_MODES.has(mode)) {
      writes.nucleic_gradient_start = nucleic[0];
      writes.nucleic_gradient_end = nucleic[nucleic.length - 1];
    } else {
      writes.nucleic_color = nucleic[0];
    }
    return {
      id: index === authoredIndex ? 'authored' : `nucleo-${index}`,
      label: index === authoredIndex ? 'As designed' : name,
      target: 'nucleic',
      mode,
      kind: 'nucleo',
      protein,
      nucleic: [...nucleic],
      // The body first, then the duplex: the swatch reads in the same order the name does.
      swatch: [protein, ...nucleic],
      labels,
      writes,
    };
  });
}


function paletteSchemes(target, mode, authoredIndex = 0) {
  return CATEGORICAL_SCHEMES.map(([name, palette], index) => ({
    id: index === authoredIndex ? 'authored' : `chain-${index}`,
    label: index === authoredIndex ? 'As designed' : name,
    target,
    mode,
    kind: 'palette',
    // Positional, because chain ids are whatever the file says. main.js maps this onto the labels
    // its own category grid detected, in that grid's order.
    palette: [...palette],
    swatch: palette.slice(0, 5),
    writes: {},
  }));
}


/*
  Every scheme a Style offers, authored first.

  Returns a single-entry list for a mode with no family -- there is exactly one way to colour it, so
  the panel has nothing to choose and hides the section rather than showing one lonely swatch.
*/
export function styleColorSchemes(style) {
  if (!style) return [];
  const target = styleSchemeTarget(style);
  /*
    Declared, never detected, and answered before the mode dispatch below. A duo Style is `uniform`
    on both of its passes, so falling through would offer the twelve single-colour presets for a
    picture whose whole point is that it has two colours -- and `styleColorState()` would read only
    the first pass, silently making the partner side unreachable.
  */
  if (style.duo_scheme !== undefined) {
    const sides = styleDuoSides(style);
    const authoredPair = sides
      ? sides.map((side) => style.writes?.[COMPONENT_COLOR_FIELDS[side].color])
      : undefined;
    return duoSchemes(
      target,
      styleDuoSchemeIndex(style),
      sides,
      authoredPair,
      styleDuoSchemeMenu(style),
    );
  }
  /*
    Declared and answered before the mode dispatch, for the same reason the duo family is. A
    protein-and-nucleic Style is `uniform` on its protein base, so falling through would offer the
    twelve single-colour presets for a picture whose subject is the duplex -- and every colour in
    that duplex would be unreachable from the Style card.
  */
  if (style.nucleo_scheme !== undefined) {
    return nucleoSchemes(style, styleNucleoSchemeIndex(style));
  }
  const state = styleColorState(style, target);
  const { mode } = state;
  // Pass-sourced state (see styleColorState): the base controls render nothing, so a scheme for one
  // of these Styles carries no writes at all and reaches the picture through the passes alone.
  const offered = (schemes) => (state.fromPass
    ? schemes.map((entry) => ({ ...entry, writes: {} }))
    : schemes);

  if (mode === 'uniform' && state.color) {
    return offered(uniformSchemes(target, mode, state.color, style.extra_colors));
  }
  if (GRADIENT_MODES.has(mode) && state.gradientStart && state.gradientEnd
    && COMPONENT_COLOR_FIELDS[target].start) {
    return offered(gradientSchemes(
      target,
      mode,
      state.gradientStart,
      state.gradientEnd,
      style.color_schemes,
    ));
  }
  if (mode === 'chain') return offered(paletteSchemes(target, mode, styleAuthoredPaletteIndex(style)));
  if (mode === 'element') {
    return offered(
      namedSchemes(target, mode, ELEMENT_SCHEMES, keyedSwatch(target, mode, ['C', 'N', 'O', 'S'])),
    );
  }
  if (mode === 'nucleic_base') {
    return offered(namedSchemes(
      target,
      mode,
      NUCLEIC_BASE_SCHEMES,
      keyedSwatch(target, mode, ['A', 'C', 'G', 'T', 'U']),
    ));
  }
  if (mode === 'nucleic_part') {
    return offered(namedSchemes(
      target,
      mode,
      NUCLEIC_PART_SCHEMES,
      keyedSwatch(target, mode, ['Phosphate', 'Sugar', 'Base']),
    ));
  }
  if (METRIC_RAMP_SCHEMES[mode]) {
    const stops = (mode === 'plddt' ? PLDDT_COLOR_STOPS : BFACTOR_COLOR_STOPS).map(([label]) => label);
    return offered(namedSchemes(
      target,
      mode,
      METRIC_RAMP_SCHEMES[mode],
      keyedSwatch(target, mode, stops),
    ));
  }
  return [];
}


export function authoredColorScheme(style) {
  return styleColorSchemes(style).find((entry) => entry.id === 'authored');
}


export function colorSchemeById(style, id) {
  const schemes = styleColorSchemes(style);
  // The fallback is the authored entry by id, not `schemes[0]`: no family promotes it to the front,
  // so a uniform Style's first swatch is whatever `UNIFORM_COLOR_PRESETS` starts with, and an
  // unknown id would quietly apply Ocean to every Style in the catalogue.
  return schemes.find((entry) => entry.id === id)
    ?? schemes.find((entry) => entry.id === 'authored')
    ?? schemes[0];
}


/*
  Does this overlay pass hold the base's authored colour, i.e. was it authored as a copy of it?

  `sidechain_beads` and `sidechain_sticks` write their rainbow twice -- once on the base cartoon and
  once on the side-chain pass -- so an alternate scheme that only rewrote the base leaves the beads
  on the authored gradient and the render comes back half recoloured. Re-colouring the pass is the
  answer; testing that it *matches* first is what keeps `in_glass`'s deliberately different glass
  tint out of it.
*/
function passTracksBase(pass, state) {
  if (pass.from === 'base') return false;
  if (pass.component !== state.target) return false;
  if (pass.color_mode !== state.mode) return false;
  if (GRADIENT_MODES.has(state.mode)) {
    return pass.gradient_start === state.gradientStart && pass.gradient_end === state.gradientEnd;
  }
  if (state.mode === 'uniform') return pass.color === state.color;
  // Every other mode paints from color_overrides, which a pass does not carry, so a pass in one of
  // them has no colour of its own to bring in line.
  return false;
}


/*
  The passes a Style hands the chosen scheme's hue, by name.

  Stated in the catalogue and not detected, for the reason every other "what is this Style about"
  question here is stated: a heuristic over opacity, material and paleness would also catch
  `ghost_ligand`'s deliberately colourless envelope, whose whole job is to *not* be the picture's
  colour. An unknown name throws rather than being ignored, so renaming a pass and forgetting this
  list is a named failure instead of a shell that quietly stopped following.
*/
export function styleSchemeTintPasses(style) {
  const named = style?.scheme_tint;
  if (named === undefined) return new Set();
  const passes = style?.overlays ?? [];
  for (const name of named) {
    const pass = passes.find((entry) => entry.name === name);
    if (pass === undefined || pass.color_mode !== 'uniform') {
      throw new Error(
        `Style "${style?.id}" names ${JSON.stringify(name)} in scheme_tint; `
        + 'a tinted pass is one of its own overlay passes, in uniform colour mode.',
      );
    }
  }
  return new Set(named);
}


/*
  The colours a chosen scheme paints the body in, first colour first: `tintedToward()` takes its hue
  from the head of this list.
*/
function schemeSourceColors(chosen) {
  if (chosen.kind === 'gradient') return [chosen.gradientStart, chosen.gradientEnd];
  if (chosen.kind === 'uniform') return chosen.color ? [chosen.color] : [];
  // Every other family paints from a table rather than from one hex; its swatch is that table's
  // colours, which is the same question asked of a picture with more than two of them.
  return chosen.swatch ?? [];
}


/*
  The Style as the chosen scheme renders it: the authored writes with the scheme's over them, and
  every overlay pass that was a copy of the base brought along with it.

  Deliberately returns a plain object rather than mutating: `STYLE_CATALOG` is module state shared by
  the bar, both tiers, the sweep and the recommender, and a scheme is one user's choice for one
  apply.
*/
export function styleWithScheme(style, chosen) {
  if (!style || !chosen) return style;
  /*
    A duo pair is applied by *side*, not by matching the colour a pass currently holds. The two
    scoped passes are the whole picture and each is a fixed half of the pair, so there is nothing to
    track and nothing to leave alone -- and matching on colour would quietly skip a pass whose
    authored hex had been edited by a digit.
  */
  if (chosen.kind === 'duo') {
    // Keyed on the side rather than on the scope, so both scope pairs land the same way round.
    const bySide = { host: chosen.duo[0], partner: chosen.duo[1] };
    return {
      ...style,
      // Empty for a scope-sided Style, and the two component colours for a `duo_sides` one. Merging
      // unconditionally keeps one branch for both shapes.
      writes: { ...style.writes, ...chosen.writes },
      overlays: (style.overlays ?? []).map((pass) => (
        pass.color_mode === 'uniform' && bySide[OVERLAY_SCOPE_SIDES[pass.scope]] !== undefined
          ? { ...pass, color: bySide[OVERLAY_SCOPE_SIDES[pass.scope]] }
          : pass
      )),
    };
  }
  const state = styleColorState(style, chosen.target);
  const tinted = styleSchemeTintPasses(style);
  const overlays = (style.overlays ?? []).map((pass) => {
    if (tinted.has(pass.name)) {
      // `As designed` is the Style exactly as the catalogue wrote it, shell included: the authored
      // tint is a chosen colour, not a derived one, and deriving it would move it.
      if (chosen.id === 'authored') return pass;
      return { ...pass, color: tintedToward(pass.color, schemeSourceColors(chosen)) };
    }
    if (!passTracksBase(pass, state)) return pass;
    if (chosen.kind === 'gradient') {
      return { ...pass, gradient_start: chosen.gradientStart, gradient_end: chosen.gradientEnd };
    }
    if (chosen.kind === 'uniform') return { ...pass, color: chosen.color };
    return pass;
  });
  return {
    ...style,
    writes: { ...style.writes, ...chosen.writes },
    overlays,
  };
}
