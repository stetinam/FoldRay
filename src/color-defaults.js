/*
  Product colour defaults shared by every browser-created style.

  The families are deliberately small and purposeful: gradients begin with complementary or
  near-complementary pairs, category colours walk broadly around the wheel, and the uniform row
  includes lighter, darker and quieter relatives of the core hues. The scientific pLDDT/B-factor
  ramps below stay conventional rather than borrowing this art palette; they are the defaults a
  user starts from, and `color.js` derives the renderer's tables from these, so a request omitting
  them still renders the same colours.
*/

import { ElementSymbolColors } from 'molstar/lib/mol-theme/color/element-symbol.js';

export const UNIFORM_COLOR_PRESETS = [
  ['Ocean', '#176FD3'],
  ['Deep ocean', '#164B7A'],
  ['Sky', '#78B7D0'],
  ['Sea', '#3D8F89'],
  ['Mint', '#58BFA8'],
  ['Violet', '#8A51C2'],
  ['Lavender', '#B996D9'],
  ['Coral', '#E56B6F'],
  ['Raspberry', '#B83F5D'],
  ['Gold', '#EFD75E'],
  ['Amber', '#F2AB40'],
  ['Pearl', '#DDE4EA'],
];

export const COMPONENT_COLOR_DEFAULTS = {
  protein: {
    // Mint, not the Ocean the gradient still starts from: it is the hue the picker tiles are
    // rendered in, so a fresh load matches its own artwork.
    uniform: '#58BFA8',
    gradient: ['#176FD3', '#E2B84B'],
  },
  nucleic: {
    uniform: '#8A51C2',
    gradient: ['#58BFA8', '#E56B6F'],
  },
  ligand: {
    uniform: '#E56B6F',
    gradient: ['#3D8F89', '#E56B6F'],
  },
  ion: {
    uniform: '#E2B84B',
    gradient: ['#176FD3', '#E2B84B'],
  },
  // Water. The card offers no colour mode (water is always uniform), so the gradient pair is here
  // for parity with the other four rather than for a control to read.
  water: {
    uniform: '#6FC3E8',
    gradient: ['#176FD3', '#6FC3E8'],
  },
};

// A broad hue cycle for an unknown number of chains/entities. Adjacent sorted labels receive
// strongly separated hues; lighter and quieter variants enter only after the core wheel is used.
export const CATEGORICAL_PALETTE = [
  '#176FD3', '#E56B6F', '#3D8F89', '#E2B84B', '#8A51C2',
  '#D88934', '#78B7D0', '#B83F5D', '#58BFA8', '#6F7891',
];

// These are explicit overrides for every component's By element mode. C/N/O/P are the product
// contract; the remaining values are related, distinguishable hues.
export const ELEMENT_COLOR_DEFAULTS = {
  H: '#F2F2F2', C: '#BDBDBD', N: '#3B58E8', O: '#E33131', F: '#73C98A',
  P: '#E2D436', S: '#E2B84B', CL: '#3D8F89', FE: '#D88934', ZN: '#8A84B8',
  MG: '#58BFA8', CA: '#78B7D0', NA: '#8A51C2', K: '#B34FA5', CU: '#B87333',
};

/*
  The fallback element colour, from Mol*'s own table.

  `ElementSymbolColors` ships in Mol* under MIT and cites `jmol.sourceforge.net/jscolors/` in its
  own header, so these are Jmol's published colours. Where Mol* has a table it is used rather than
  one of our own: the vdW radii likewise come from Mol*, which cites Mantina et al. 2009.

  It covers 119 symbols, so an element ELEMENT_COLOR_DEFAULTS does not name -- manganese, nickel,
  cobalt, arsenic -- gets its Jmol colour instead of falling through to the style's uniform one.

  Here rather than in `color.js`, which imports this file's tables at load, so the seed below needs
  no import cycle.
*/
export function jmolElementColor(symbol) {
  const value = ElementSymbolColors[symbol];
  return value === undefined ? undefined : `#${value.toString(16).toUpperCase().padStart(6, '0')}`;
}

/*
  Deuterium and tritium are hydrogen everywhere this app looks, so they are never their own
  category. A D swatch would be a control with nothing behind it -- the atoms it claimed would
  already be taking the H colour. Fold them the moment a label is detected instead.
*/
export const HYDROGEN_ISOTOPE_SYMBOLS = ['D', 'T'];

export function normalizeElementSymbol(symbol) {
  const upper = String(symbol ?? '').toUpperCase();
  return HYDROGEN_ISOTOPE_SYMBOLS.includes(upper) ? 'H' : upper;
}

/*
  By strand, positionally like every other categorical mode -- never keyed on chain IDs. A table
  keyed on chains named, say, I and J never fires on the far more common A/B/C or D/R naming, and
  strands silently fall through to CATEGORICAL_PALETTE, which is the *protein* chain wheel: a DNA
  duplex beside a protein takes the protein's colours and stops reading as nucleic acid at all.

  The first two entries are the same complementary pair (167 deg apart at matched saturation and
  lightness) as COMPONENT_COLOR_DEFAULTS.nucleic.gradient, so a duplex coloured By strand and the
  same duplex coloured Along duplex agree about which end is which. Later entries walk the wheel
  from the nucleic family violet outwards. Assignment is by sorted-label index, matching
  `categoricalLookup()` in `color.js`, which paints from this same table.
*/
export const NUCLEIC_STRAND_PALETTE = [
  '#58BFA8', '#E56B6F', '#8A51C2', '#E2B84B', '#78B7D0', '#B83F5D',
];

// These two nucleic-acid palettes are established product choices.
export const NUCLEIC_BASE_COLOR_DEFAULTS = {
  A: '#59B86C', C: '#4C8EDA', G: '#E0A72E', T: '#E66B6B', U: '#A873D1', Other: '#AEB7C5',
};

export const NUCLEIC_PART_COLOR_DEFAULTS = {
  Phosphate: '#E56B6F', Sugar: '#78B7D0', Base: '#E2B84B',
};

/*
  The two data-valued ramps, as ordered [stop label, default colour] pairs.

  A stop's position is part of what the picture means -- pLDDT's are the AlphaFold confidence
  bands on an absolute 0-100 scale, and B-factor's four stops are even thirds of the structure's
  own robust range -- so the user chooses the colour at each stop and never the stop count or where
  it sits. That is also why these are lists rather than objects: the order is the ramp, and the
  pLDDT labels are numbers, which sort as 0, 100, 50, 70, 90 the moment anything treats them as
  category labels. `color.js` derives PLDDT_STOPS/BFACTOR_STOPS from these lists, so there is
  one copy.

  Both defaults are the colours the Confidence & Disorder Styles were composed on, for one reason:
  a tile is reduced from the figure its session rendered, so a default that differs from the
  session ships a tile the Style cannot reproduce when it is clicked. pLDDT's `50` is #FFB347 --
  the softer amber two of the three AF-P05067 sessions hand-tuned -- rather than AlphaFold's own
  #FFDB13, which the `AlphaFold` entry in PLDDT_RAMP_SCHEMES offers by name. The whole B-factor
  ramp is 1CLL-Render-5's, navy through periwinkle and sand to a hot red, and Cividis is one click
  away in BFACTOR_RAMP_SCHEMES.
*/
export const PLDDT_COLOR_STOPS = [
  ['0', '#FF7D45'], ['50', '#FFB347'], ['70', '#65CBF3'], ['90', '#0053D6'], ['100', '#001A72'],
];

export const BFACTOR_COLOR_STOPS = [
  ['Lowest', '#061D60'], ['Low', '#8F8FEA'], ['High', '#DBB461'], ['Highest', '#D63F24'],
];

export const METRIC_COLOR_STOPS = {
  plddt: PLDDT_COLOR_STOPS,
  bfactor: BFACTOR_COLOR_STOPS,
};


/*
  ---------------------------------------------------------------------------------------------
  Colour schemes: the *alternates* a Style offers, one family per colour mode.

  The generated alternates above (`suggestColorSchemes`, `suggestColorSchemePairs`) answer only two
  of the eight colour modes this app has -- one uniform hex, and a start/end gradient. Every other
  mode paints from a table keyed on something the structure supplies: a chain id, an element symbol,
  a base letter, a confidence band. Without a table, a Style in one of those modes -- a third of
  the catalogue -- would have nothing to offer, and the Style options panel hides the colour section
  of a Style that has none.

  The tables below are the other half. Each is an ordered list of `[name, colours]`, and the first
  entry of every one is the app's own default, so "as designed" is a member of the set rather than a
  special case outside it. Two shapes, chosen by whether the labels are knowable ahead of time:

    * positional (`chain`) -- a list applied by sorted-label index, exactly as
      `defaultCategoryColor()` walks `CATEGORICAL_PALETTE`. Chain ids are whatever the file says, so
      there is nothing to key on.
    * keyed (element, nucleic base/part, both metric ramps) -- a `{ label: hex }` map, because those
      labels are fixed vocabulary. Keying matters most for `element`: recolouring oxygen by position
      would say something false, so an element scheme only ever moves carbon.

  All of them travel in the `color_overrides` the request already carries, so this adds no request
  field. `src/style-color-schemes.js` is how a Style picks its family.
*/

// Ten entries each, matching CATEGORICAL_PALETTE's length, so a ten-chain assembly gets ten
// distinguishable colours before any scheme starts to cycle.
export const CATEGORICAL_SCHEMES = [
  ['Broad wheel', CATEGORICAL_PALETTE],
  ['Ocean', [
    '#0F3F73', '#176FD3', '#3D8F89', '#78B7D0', '#58BFA8',
    '#164B7A', '#4C8EDA', '#2E6E68', '#9FCBDF', '#6F7891',
  ]],
  ['Sunset', [
    '#B83F5D', '#E56B6F', '#D88934', '#E2B84B', '#8A4A6B',
    '#F2AB40', '#C1566B', '#A8632E', '#EFCB84', '#6F5A62',
  ]],
  ['Meadow', [
    '#3D8F89', '#59B86C', '#E2B84B', '#8A9E3F', '#58BFA8',
    '#D88934', '#7FAE5A', '#2E6E68', '#C7D18A', '#6F7891',
  ]],
  ['Orchid', [
    '#8A51C2', '#B996D9', '#B34FA5', '#5B4FB0', '#D63AA8',
    '#7E57C2', '#C77BD4', '#4A3E8C', '#E0AEE8', '#6F7891',
  ]],
  ['Graphite', [
    '#DDE4EA', '#9AA6B5', '#6F7891', '#4A5263', '#B6C0CD',
    '#828C9E', '#5A6273', '#C9D2DC', '#3A4150', '#7E8798',
  ]],
  /*
    Vivid and Pastel are the same wheel at two other chromas, and they are deliberately the only
    two entries here that keep Broad wheel's *hue order* rather than picking a new family. The five
    above them each answer "what if this assembly were an ocean / a sunset / a meadow", which moves
    every chain to an unrelated hue; these answer "louder" and "quieter", so a multimer recoloured
    into one of them is still recognisably the same chain in the same place, which is what a reader
    comparing two figures of one structure needs.

    Hue is kept and only saturation and value move -- but not by a formula. Rotating the wheel at a
    fixed saturation collapses pairs that the default palette separates by lightness instead: teal
    and mint land within a few degrees of each other, and slate's hue is the blue's, so a mechanical
    Vivid drew chains 1 and 10 in the same colour. Both lists are therefore hand-separated, and each
    keeps one dark neutral in the tenth slot for the same reason the default wheel does.
  */
  ['Vivid', [
    '#1E7BFF', '#FF3B3B', '#00B3A4', '#FFC300', '#9B2BFF',
    '#FF7A00', '#35C8FF', '#FF1F6B', '#2BF5B0', '#2A3550',
  ]],
  ['Pastel', [
    '#A9C8F2', '#F4B3B0', '#A6D6CF', '#F2DDA8', '#CDB4E8',
    '#F3C9A2', '#BFE0EF', '#E8A9C6', '#AEE3CE', '#C7CBD6',
  ]],
];

/*
  The two-colour family, for a Style whose picture has two sides rather than a set of labels.

  Every other family here answers "what colour is this label" -- a chain index, an element symbol, a
  confidence band. A two-sided picture has no labels: it has a *host* and a *partner*, and what it
  needs is a pair that separates them at a glance and still reads as one figure. So this table is
  pairs, `[host, partner]`, applied by side rather than by name.

  Two kinds of side reach it, and the table does not care which:

    - the interface Styles in Multimers & interfaces, whose sides are the largest protein chain and
      every other one (`scope` in `src/style-overlays.js`);
    - a Style whose sides are two whole *components*, stated as `duo_sides` in the catalogue --
      `bound_glow` is protein against ligand.

  Positional like `CATEGORICAL_SCHEMES` and for the same reason: there is nothing to key on. Which
  half of the pair lands where is fixed -- the first colour is the host, mechanically the largest
  chain for an interface Style and the protein for a component pair -- so choosing a scheme never
  swaps the two sides under a reader who has already worked out which is which.

  The first four are the pairs the four `*-Interface` sessions were actually composed in, in the
  order their Styles appear in the row. The rest were added to complete the set, chosen to
  complement rather than repeat them:
  the sessions between them cover pink/blue, teal/violet, cyan/amber and aqua/coral, so the
  additions take the pairings that were missing -- warm yellow against indigo, orange against teal,
  a lit cyan against magenta, and one deliberately quiet pair for a figure that has to sit under a
  caption without shouting.

  `Cyan & magenta` came out of a session rather than out of that exercise: it is 7LCK-Render-2's
  own two colours, and `bound_glow` is what rests on it.

  Eighteen, in four groups: the eight saturated pairs, five quiet-host ones, four white-host ones
  added for a cavity picture, and one dark-host. Each group's own comment says what admits it, and
  the rule they share is the one below.

  Both members of every pair carry real chroma on the *partner* side. A "colour one side, grey the
  other" pair is refused: greying a partner says it is background, and in an
  interface picture both sides are the subject. Quietening the *host* is a different statement and
  is what the last two groups do -- the first colour is always the host, so a pale entry can only
  ever say which side to look at first, and never that the partner does not matter.
*/
export const DUO_SCHEMES = [
  ['Rose & blue', ['#E64CA6', '#3375E1']],
  ['Mint & lilac', ['#58BFA8', '#B987E8']],
  ['Cyan & amber', ['#00ACC1', '#E8A33D']],
  ['Aqua & coral', ['#6BE5E1', '#E56B6F']],
  ['Gold & indigo', ['#EFC245', '#4A56B8']],
  ['Ember & teal', ['#E0603C', '#3FB39A']],
  ['Cyan & magenta', ['#59F7E5', '#C73FD9']],
  ['Slate & sand', ['#5F7FA6', '#E3B57A']],

  /*
    The quiet-host group, which amends this table's own rule rather than bending it. The eight pairs
    above are two saturated colours, because an interface picture has two subjects and greying one
    of them says it is background.

    These five neutralise a side on purpose, and they are admissible because of *which* side. The
    first colour of a pair is always the host -- the largest chain, or the protein of a component
    pair -- so it is mechanically the body that goes quiet and never the partner. A pale host under a loud partner still says both sides are the
    subject; it says which one to look at first, which is exactly what an epitope, a groove or a
    docked domain needs. Greying the partner remains excluded and always will be.

    Of twelve alternates rendered for this row, every look that held up was one quiet body and one
    saturated partner, and every look that did not either made the material the subject or drew
    both sides loud. Two of those that held up were `interface_surface` and `interface_spheres` in
    exactly these palettes, which is why they are
    schemes here instead of near-duplicate tiles in a row that already holds twelve.
  */
  ['Bone & amber', ['#CFC4AE', '#F2A03D']],
  ['Bone & cyan', ['#CFC4AE', '#12BFD9']],
  // 7LCK-Render-26's own two colours, and the second entry after `Cyan & magenta` to come out of a
  // session rather than out of the exercise above. `open_pocket` rests on it, which is what lets
  // that Style ship in the colours its figure was composed in without diverging from the table.
  ['Bone & coral', ['#CFC4AE', '#E56B6F']],
  ['Steel & red', ['#8FA3B8', '#D4392F']],
  ['Steel & amber', ['#8FA3B8', '#F0A227']],

  /*
    The white-host group, which is the quiet-host argument taken to its end rather than a fourth
    idea. Bone and Steel quieten a body; these take it to a near-white one, and they exist because a
    picture whose subject is a *cavity* wants exactly that: a white body reads as a wall with a hole
    in it, and anything the light finds inside the hole is the only colour in the frame.

    `open_pocket` in Ligands is the Style they are for, and it is also
    the one Style that offers no other kind: it states `duo_schemes` and names the pale-hosted pairs
    and nothing else, because a saturated body under a glowing groove turns the groove into a
    highlight on a coloured surface and the picture stops being about the pocket. Every other duo
    Style draws all eighteen, so these are four more quiet bodies for an epitope or a docked domain
    as well.

    Not `Pearl & coral`: both its halves are already in the table, so it would offer a new
    combination rather than a new colour, and at tile size, on the one Style that draws pale hosts, a
    coral partner over Pearl and the same coral over Bone are the same picture twice.
  */
  ['Pearl & violet', ['#DDE4EA', '#8A51C2']],
  ['Chalk & ember', ['#F2F1EC', '#E0603C']],
  /*
    Two more of the same shape, here for what the *partner* adds rather than for another shade of
    white. Without them the pale-host partners run amber, cyan, violet, ember and coral -- warm
    orange through to blue, with no green and no magenta anywhere in it, so a cavity Style could not
    show a green source at all.

    Mint is the app's own #58BFA8 and the colour a reader coming from any GFP figure expects a lit
    pocket to be; Rose is #E64CA6, otherwise only a host (`Rose & blue`). Both hosts are the group's
    two near-whites rather than a third: what these add is the light in the hole, not the wall
    around it.
  */
  ['Chalk & mint', ['#F2F1EC', '#58BFA8']],
  ['Pearl & rose', ['#DDE4EA', '#E64CA6']],

  /*
    The dark-host entry, which amends this table's own rule for a picture rather than for taste.
    Bone and Steel quieten a body; Pearl and Chalk take that to a near-white one; this goes the
    other way, to a body darker than anything else here.

    It is admissible on exactly the same ground as those two groups: the first colour is always the
    host, so a dark entry can only ever quieten the body and never the thing bound to it. What it
    adds is the one surround a *source* needs. A lit or emissive partner is only legible against
    something darker than itself -- `metal_centre_dark` in Ions is the
    Style it is for, and the renders behind it are unambiguous: the same faceted marker at
    the same emission is a bright object against this body and a pale dot against Bone or Chalk.
    That is also why the pale-host group cannot simply be reused with a dimmer light: dimming
    the room dims the marker with it, while a dark body does not.

    It is the one pair whose host is dark enough to lose its own shape in a thumbnail, which is the
    cost and the reason there is one of these rather than a group of three. A Style resting here is
    saying the body is a surround; a Style that wants its body read as a shape should not.
  */
  ['Ink & amber', ['#243441', '#F2A03D']],
];


/*
  Element schemes move carbon and nothing else.

  Colouring a ball-and-stick by element is a *claim*: blue is nitrogen, red is oxygen, and a scheme
  that reassigned those would be a picture that lies. Carbon is the one element with no convention
  worth defending -- grey is a habit, not a meaning -- and tinting it is the established way to tell
  two molecules apart in one frame. So these are carbon tints, keyed, and every other symbol keeps
  ELEMENT_COLOR_DEFAULTS.
*/
/*
  The protein-and-nucleic family, for a Style whose picture is a protein wrapped around a nucleic
  acid rather than a protein on its own.

  Why a fourteenth table. Every other family answers "what colour is this label" for one component:
  a chain index, an element symbol, a base letter, a confidence band. A protein/DNA picture has two
  components on screen at once, and the thing worth choosing is neither of their tables alone -- it
  is the body colour and the colours running through the duplex, together. `DUO_SCHEMES` is the
  nearest existing answer and cannot do it: a duo pair is one flat colour per side, so the moment
  the nucleic acid is coloured by base, by part or along a gradient -- which is what makes it read
  as a nucleic acid at all -- the pair has nowhere to land.

  The shape. One protein colour, and three nucleic colours in order. That is the whole rule, and it
  is three rather than two so a scheme can state a *middle*: `nucleic_part` has exactly three labels
  (Phosphate, Sugar, Base), which is the mode the row's first Style is painted in.

  How the three land is the one piece of dispatch, in `nucleoSchemes()`:

    a keyed nucleic mode (base, part)  -> its labels in table order, spread along the three
    a gradient nucleic mode            -> the first and the last as the two endpoints
    a uniform nucleic                  -> the first

  So one table serves every nucleic mode, and the user changes every colour in the picture -- the
  protein's included -- with one click. That was the requirement the family was written for: a
  scheme that recoloured only the DNA would leave the body it is wrapped around stuck on whatever
  the Style authored.

  The first colour is always the protein, exactly as the first colour of a DUO_SCHEMES pair is
  always the host, so picking a scheme can never swap the body and the duplex under a reader who
  has already worked out which is which. `Teal & bases` leads because it is the app's own nucleic
  defaults (NUCLEIC_PART_COLOR_DEFAULTS, in table order) under a sea-green protein, which is the
  picture `nucleosome` ships as.
*/
export const NUCLEO_SCHEMES = [
  ['Teal & bases', { protein: '#3D8F89', nucleic: ['#E56B6F', '#78B7D0', '#E2B84B'] }],
  ['Slate & ember', { protein: '#5F7FA6', nucleic: ['#EFD75E', '#E0603C', '#B83F5D'] }],
  ['Bone & ocean', { protein: '#CFC4AE', nucleic: ['#6BE5E1', '#176FD3', '#4A56B8'] }],
  ['Plum & meadow', { protein: '#8A51C2', nucleic: ['#EFD75E', '#58BFA8', '#176FD3'] }],
  ['Graphite & rose', { protein: '#4A5263', nucleic: ['#F2AB40', '#E64CA6', '#8A51C2'] }],
  ['Sand & indigo', { protein: '#E3B57A', nucleic: ['#12BFD9', '#4A56B8', '#332288'] }],
  ['Moss & coral', { protein: '#8A9E3F', nucleic: ['#E56B6F', '#B996D9', '#78B7D0'] }],
  ['Pearl & ember', { protein: '#DDE4EA', nucleic: ['#E2B84B', '#E0603C', '#8A51C2'] }],
];


/*
  Spread a scheme's colours over `count` labels, in order.

  A nucleic table's label count is a property of the *mode* (three parts, six bases) and a scheme
  states three colours, so something has to bridge the two. Interpolating is what lets one table
  serve both without the table knowing which mode it will land in: three labels take the three
  colours exactly, and six take them as a ramp. Wrapping was the alternative and is wrong -- it
  would paint A and T the same colour, which is a claim about the chemistry.
*/
export function spreadColors(colors, count) {
  if (count <= 0) return [];
  if (count === 1) return [colors[0]];
  return Array.from({ length: count }, (_, index) => {
    const position = (index / (count - 1)) * (colors.length - 1);
    const low = Math.floor(position);
    const fraction = position - low;
    // Exact at every stated colour, and the reason it has to be exact rather than merely close:
    // `nucleic_part` has three labels against a scheme's three colours, so every one of them lands
    // on a fraction of 0 and must come back as the hex the table wrote, not a round-trip of it.
    if (fraction === 0) return colors[low];
    return mixHsl(colors[low], colors[Math.min(low + 1, colors.length - 1)], fraction);
  });
}


/*
  Mix two hexes in HSL, taking the shorter way round the hue circle.

  In RGB this is the obvious one-liner and it is the wrong one: orange to rose passes through a
  muddy pink, so a six-label base ramp spread over three colours comes back with four labels nobody
  can tell apart -- a picture claiming to colour by base that does not. The same two colours in
  HSL travel through red, and the six bases land on six legible hues. Lightness and saturation are
  interpolated straight, so a ramp between two colours of similar weight stays that weight.
*/
function mixHsl(from, to, fraction) {
  const start = rgbToHsl(from);
  const end = rgbToHsl(to);
  let delta = end.hue - start.hue;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  const between = (first, second) => first + (second - first) * fraction;
  return hslToHex({
    hue: start.hue + delta * fraction,
    saturation: between(start.saturation, end.saturation),
    lightness: between(start.lightness, end.lightness),
  });
}


/*
  A pale envelope moved onto another hue: `tint`'s own saturation and lightness, carried to the hue
  of the colours the body under it is being painted in.

  It exists for the glass shell Styles. A shell is authored as one faint colour over a body whose
  colour the Style card lets the user change, and the two are not the same colour -- the shell is
  much paler and often a different hue family -- so it is neither a copy of the base (which
  `passTracksBase()` would carry along) nor something that should sit still while the body under it
  turns from a rainbow to a blue-to-amber ramp. Keeping saturation and lightness is what keeps the
  glass glass: only where on the wheel it is faint about moves.

  `colors` is the scheme's own colour, or the colours it paints a ramp or a table in, and the hue
  comes from the **first** of them: a colour that is actually in the picture. Not a mix of the two
  ends of a ramp: halfway between a blue and an amber, the shorter way round, is a green, so a
  blue-to-amber body would sit under a green shell that matches neither end of it. Anything that is
  not a hex comes straight back, so a malformed scheme leaves the authored tint alone rather than
  rendering a shell of NaN.
*/
export function tintedToward(tint, colors) {
  const source = (Array.isArray(colors) ? colors : [colors]).map(normalizedHex).filter(Boolean);
  const base = normalizedHex(tint);
  if (base === undefined || source.length === 0) return tint;
  const { saturation, lightness } = rgbToHsl(base);
  return hslToHex({ hue: rgbToHsl(source[0]).hue, saturation, lightness });
}


export const ELEMENT_SCHEMES = [
  ['Standard', {}],
  ['Carbon teal', { C: '#58BFA8' }],
  ['Carbon violet', { C: '#8A51C2' }],
  ['Carbon gold', { C: '#E2B84B' }],
  ['Carbon coral', { C: '#E56B6F' }],
  ['Carbon slate', { C: '#6F7891' }],
  // Moss and graphite keep the same rule: neither hex is any other symbol's default, so no scheme
  // here can be read as a claim about a second element. Graphite is the dark end the mid-grey slate
  // does not reach, which is what a dense ball-and-stick or a sphere pack wants.
  ['Carbon moss', { C: '#8A9E3F' }],
  ['Carbon graphite', { C: '#4A5263' }],
];

/*
  Base schemes, keyed on the letters. `Purine / pyrimidine` is the one that changes what the picture
  says rather than how it looks: A and G share a hue, C, T and U share another, so the chemistry the
  two-ring/one-ring split describes is legible at a glance instead of being five unrelated colours.
*/
export const NUCLEIC_BASE_SCHEMES = [
  ['Standard', {}],
  ['Purine / pyrimidine', {
    A: '#3D8F89', G: '#58BFA8', C: '#E56B6F', T: '#B83F5D', U: '#D88934', Other: '#AEB7C5',
  }],
  ['Cool', {
    A: '#4C8EDA', C: '#58BFA8', G: '#8A51C2', T: '#78B7D0', U: '#B996D9', Other: '#AEB7C5',
  }],
  ['Warm', {
    A: '#E2B84B', C: '#D88934', G: '#E56B6F', T: '#B83F5D', U: '#F2AB40', Other: '#AEB7C5',
  }],
];

export const NUCLEIC_PART_SCHEMES = [
  ['Standard', {}],
  ['Cool', { Phosphate: '#176FD3', Sugar: '#78B7D0', Base: '#58BFA8' }],
  ['Warm', { Phosphate: '#B83F5D', Sugar: '#D88934', Base: '#E2B84B' }],
  ['Graphite', { Phosphate: '#6F7891', Sugar: '#9AA6B5', Base: '#DDE4EA' }],
];

/*
  The two data ramps, recoloured stop for stop and never restopped: pLDDT's positions are the
  AlphaFold bands on an absolute 0-100 scale and B-factor's four stops are even thirds of the
  structure's own robust range, so the count and the spacing are part of what the picture means.
  Each alternate
  therefore has exactly as many entries as its ramp, keyed on the same labels in the same order.
*/
export const PLDDT_RAMP_SCHEMES = [
  ['As composed', {}],
  /*
    AlphaFold DB's four band colours to the digit, plus a darker navy at 100 that is ours.
    PLDDT_COLOR_STOPS holds the softer #FFB347 at `50` that the Confidence Styles were composed on
    (see that table's comment); only `50` differs, so this and `As composed` are one stop apart --
    which is the point. The canonical bands are what a reader coming from the AlphaFold database
    expects to recognise, so the app keeps them while its default matches the tiles.
  */
  ['AlphaFold', { 0: '#FF7D45', 50: '#FFDB13', 70: '#65CBF3', 90: '#0053D6', 100: '#001A72' }],
  /*
    The AlphaFold ramp with the warm half pushed to red: 50 -- the band AlphaFold itself calls low
    -- is fully red rather than the brightest colour on the ramp, 70 is orange rather than yellow,
    and 0 is a dark saturated red no eye reads as a highlight. The cool half is AlphaFold's own
    cyan and blue moved up one stop, and that pairing is deliberate: red interpolates to *navy*
    through a muddy grey band that lands right on 75-88, which is where a real predicted model
    spends much of its length, while red to a light cyan stays clean the whole way. Same five stops
    in the same places; only the colours move, which is what every entry in this table is.
  */
  ['Red below 70', { 0: '#A21111', 50: '#DE2E1C', 70: '#F3922F', 90: '#65CBF3', 100: '#0053D6' }],
  ['Warm to cool', { 0: '#B83F5D', 50: '#D88934', 70: '#E2B84B', 90: '#58BFA8', 100: '#176FD3' }],
];

/*
  B-factor's four, and the one table in this file whose members were chosen against three specific
  pictures rather than in the abstract: the Confidence & Disorder row's `flexibility`,
  `flexibility_atoms` and `flexibility_surface` are a ridged ceramic cartoon, a glossy sphere pack
  and a soft-glossy envelope, all of them lit from close to camera. That narrows what works. A ramp
  whose two ends are both light loses the rigid core against the specular on the spheres, so each
  entry below opens on a genuinely dark stop and travels cold to warm. Rendered on 1CLL all four say
  the same thing -- the two rigid EF-hand lobes cold, the linker helix between them hot -- which is
  the test they were chosen against rather than a claim about ramps in general.

  `As composed` is 1CLL-Render-5's own ramp and is what PLDDT_COLOR_STOPS' comment describes.
  `Cividis` is kept by name for every figure drawn on it. The last two were authored for this row
  out of CATEGORICAL_PALETTE's hues, which is what keeps them recognisably this app's colours rather
  than two more borrowed matplotlib maps.
*/
export const BFACTOR_RAMP_SCHEMES = [
  ['As composed', {}],
  ['Cividis', { Lowest: '#00224E', Low: '#575D6D', High: '#A59C74', Highest: '#FDE737' }],
  // Graphite to coral: the quietest of the four. The cold half is neutral rather than blue, so on
  // the surface Style the mobile loops are the only thing carrying hue at all.
  ['Slate to coral', { Lowest: '#2A3140', Low: '#6F7891', High: '#E8A87C', Highest: '#E56B6F' }],
  // The one ramp here that is not blue-to-red, for a figure printed beside one that is. Named for
  // what it renders as and not for its darkest stop: #123B2E reads as deep forest only in shadow,
  // and across the lit face the cold half is the teal of #3D8F89 the whole way.
  ['Teal to gold', { Lowest: '#123B2E', Low: '#3D8F89', High: '#A8C46A', Highest: '#E2B84B' }],
];

export const METRIC_RAMP_SCHEMES = {
  plddt: PLDDT_RAMP_SCHEMES,
  bfactor: BFACTOR_RAMP_SCHEMES,
};


/** Return one metric ramp's stop labels in ramp order, or an empty list for any other mode. */
export function metricColorStopLabels(mode) {
  return (METRIC_COLOR_STOPS[mode] ?? []).map(([label]) => label);
}


function normalizedHex(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim())
    ? value.trim().toUpperCase()
    : undefined;
}


function rgbToHsl(hex) {
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const maximum = Math.max(...channels);
  const minimum = Math.min(...channels);
  const chroma = maximum - minimum;
  const lightness = (maximum + minimum) / 2;
  let hue = 0;
  if (chroma > 0) {
    if (maximum === channels[0]) hue = ((channels[1] - channels[2]) / chroma) % 6;
    else if (maximum === channels[1]) hue = (channels[2] - channels[0]) / chroma + 2;
    else hue = (channels[0] - channels[1]) / chroma + 4;
    hue = (hue * 60 + 360) % 360;
  }
  const saturation = chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * lightness - 1));
  return { hue, saturation, lightness };
}


function hslToHex({ hue, saturation, lightness }) {
  const normalizedHue = ((hue % 360) + 360) % 360;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const section = normalizedHue / 60;
  const secondary = chroma * (1 - Math.abs((section % 2) - 1));
  const [red, green, blue] = [
    [chroma, secondary, 0], [secondary, chroma, 0], [0, chroma, secondary],
    [0, secondary, chroma], [secondary, 0, chroma], [chroma, 0, secondary],
  ][Math.min(5, Math.floor(section))];
  const offset = lightness - chroma / 2;
  return `#${[red, green, blue]
    .map((channel) => Math.round((channel + offset) * 255).toString(16).padStart(2, '0'))
    .join('')}`.toUpperCase();
}


function hueDistance(first, second) {
  const distance = Math.abs(first - second) % 360;
  return Math.min(distance, 360 - distance);
}


function farthestHue(candidates, existing) {
  return candidates.reduce((best, candidate) => {
    const score = Math.min(...existing.map((color) => hueDistance(candidate.hue, color.hue)));
    return score > best.score ? { candidate, score } : best;
  }, { candidate: candidates[0], score: -1 }).candidate;
}


/*
  Recommend one new stop without rewriting the supplied list.

  Two existing stops are completed toward a triad, three toward a tetradic balance, and the fifth
  stop is a light/dark monochromatic relative. Farthest-hue selection avoids suggesting a colour
  already represented when a user has replaced one of the defaults with a custom value.
*/
export function suggestGradientColor(rawColors) {
  const colors = rawColors.map(normalizedHex).filter(Boolean);
  if (colors.length === 0) return COMPONENT_COLOR_DEFAULTS.protein.uniform;
  const hsl = colors.map(rgbToHsl);
  const first = hsl[0];
  const averageSaturation = Math.min(
    0.82,
    Math.max(0.52, hsl.reduce((sum, color) => sum + color.saturation, 0) / hsl.length),
  );
  const averageLightness = Math.min(
    0.66,
    Math.max(0.42, hsl.reduce((sum, color) => sum + color.lightness, 0) / hsl.length),
  );
  if (colors.length === 1) {
    return hslToHex({
      hue: first.hue + 180,
      saturation: averageSaturation,
      lightness: averageLightness,
    });
  }
  if (colors.length === 2) {
    return hslToHex(farthestHue([
      { hue: first.hue + 120, saturation: averageSaturation, lightness: averageLightness },
      { hue: first.hue - 120, saturation: averageSaturation, lightness: averageLightness },
    ], hsl));
  }
  if (colors.length === 3) {
    return hslToHex(farthestHue([
      { hue: first.hue + 180, saturation: averageSaturation, lightness: averageLightness },
      { hue: first.hue + 90, saturation: averageSaturation, lightness: averageLightness },
      { hue: first.hue - 90, saturation: averageSaturation, lightness: averageLightness },
    ], hsl));
  }
  const last = hsl.at(-1);
  return hslToHex({
    hue: last.hue,
    saturation: Math.min(0.78, Math.max(0.42, last.saturation * 0.82)),
    lightness: last.lightness >= 0.55 ? 0.34 : 0.72,
  });
}


/*
  Alternates to one authored colour, for the Style options panel's colour-scheme picker.

  Reuses suggestGradientColor exactly as the gradient editor's "Add colour" button does: each call
  reads the growing list so far and completes it toward a triad, then a tetrad, then a
  light/dark monochromatic relative, so the alternates spread out rather than clustering near the
  original hue. It is a heuristic over one colour: nothing here reads what colours the rest of the
  composition already uses.
*/
export function suggestColorSchemes(baseHex, count = 5) {
  const colors = [baseHex];
  for (let i = 0; i < count; i += 1) colors.push(suggestGradientColor(colors));
  return colors.slice(1);
}


/*
  The two-colour equivalent, for a Style whose authored look is a start/end gradient rather than
  one uniform colour. Each end is diversified on its own -- `suggestColorSchemes(startHex)` never
  reads `endHex` or the other way round -- so an alternate pair keeps the same kind of start/end
  relationship the authored pair has (two hues apart, not two shades of one) rather than converging
  the pair toward each other.
*/
export function suggestColorSchemePairs(startHex, endHex, count = 5) {
  const starts = suggestColorSchemes(startHex, count);
  const ends = suggestColorSchemes(endHex, count);
  return starts.map((start, index) => [start, ends[index]]);
}


export function defaultCategoryColor(component, mode, label, index) {
  if (mode === 'element') {
    // Jmol before grey: this seed is what the request carries, so it has to be the renderer's own.
    const symbol = normalizeElementSymbol(label);
    return ELEMENT_COLOR_DEFAULTS[symbol] ?? jmolElementColor(symbol) ?? '#9AA6B5';
  }
  if (component === 'nucleic' && mode === 'chain') {
    return NUCLEIC_STRAND_PALETTE[index % NUCLEIC_STRAND_PALETTE.length];
  }
  if (mode === 'nucleic_base') {
    return NUCLEIC_BASE_COLOR_DEFAULTS[label] ?? NUCLEIC_BASE_COLOR_DEFAULTS.Other;
  }
  if (mode === 'nucleic_part') return NUCLEIC_PART_COLOR_DEFAULTS[label] ?? '#9AA6B5';
  if (METRIC_COLOR_STOPS[mode]) {
    return METRIC_COLOR_STOPS[mode].find(([stop]) => stop === label)?.[1] ?? '#9AA6B5';
  }
  return CATEGORICAL_PALETTE[index % CATEGORICAL_PALETTE.length];
}
