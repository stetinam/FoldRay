// The colour maths, one function per operation so a mismatch in the
// picture can be traced to one of them.  Everything returns *linear* Rec.709, which is what a
// Principled BSDF is fed.
//
// One deliberate difference: there is no local element-colour table of any kind.  Mol*'s
// `ElementSymbolColors` is the fallback, and `jmolElementColor()` in `color-defaults.js` carries
// the reasoning.

import {
  jmolElementColor,
  ELEMENT_COLOR_DEFAULTS,
  CATEGORICAL_PALETTE,
  NUCLEIC_STRAND_PALETTE,
  NUCLEIC_BASE_COLOR_DEFAULTS,
  NUCLEIC_PART_COLOR_DEFAULTS,
  PLDDT_COLOR_STOPS,
  BFACTOR_COLOR_STOPS,
} from './color-defaults.js';

// Björn Ottosson's Oklab matrices, https://bottosson.github.io/posts/oklab/ (public domain).
const LINEAR_TO_LMS = [
  [0.4122214708, 0.5363325363, 0.0514459929],
  [0.2119034982, 0.6806995451, 0.1073969566],
  [0.0883024619, 0.2817188376, 0.6299787005],
];
const LMS_TO_OKLAB = [
  [0.2104542553, 0.7936177850, -0.0040720468],
  [1.9779984951, -2.4285922050, 0.4505937099],
  [0.0259040371, 0.7827717662, -0.8086757660],
];
const ACHROMATIC_CHROMA = 1e-4;

function invert3(m) {
  const [a, b, c] = m[0];
  const [d, e, f] = m[1];
  const [g, h, i] = m[2];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}
const LMS_TO_LINEAR = invert3(LINEAR_TO_LMS);
const OKLAB_TO_LMS = invert3(LMS_TO_OKLAB);

const apply = (m, v) => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

export function srgbToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
export function hexToSrgb(hex) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`Not a #RRGGBB colour: ${hex}`);
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
}
export function hexToLinear(hex) {
  return hexToSrgb(hex).map(srgbToLinear);
}

function linearToOklab(linear) {
  const lms = apply(LINEAR_TO_LMS, linear);
  return apply(LMS_TO_OKLAB, lms.map(Math.cbrt));
}

/*
  Oklab -> linear Rec.709, as scalars rather than as three arrays, because this is the one
  expression in the file that runs per *atom*.

  `userGradient()` below calls it once per atom for a colour that lands inside sRGB and **fourteen
  times** for one that does not -- the probe, twelve bisection steps and the final conversion --
  and `scene.js` rebuilds the whole table on every scene build, for every gradient colour mode. In
  the array form that was up to 800,000 three-element arrays plus one `inGamut` closure per atom on
  1AON's 58,870: 74.6 ms a build, and 250 ms at the 200k atoms this is meant to survive.

  It is **bit-identical rather than equivalent**: each output is the same
  `m[0]*v0 + m[1]*v1 + m[2]*v2` evaluated left to right that `apply()` wrote, in the same order,
  with `** 3` on the same intermediates. The matrix rows are destructured once at module scope so
  the inner loop indexes numbers instead of walking two levels of array per term. On its own this
  takes 1AON's whole-structure ramp from 74.6 ms to 45.4; the run cache below takes the sequence
  ramp the rest of the way.

  The scratch triple is module-scope and single-use: `fitToSrgbInto()` is the only caller, it is a
  leaf, and JavaScript here is single-threaded, so nothing can be part-way through it when the next
  call starts.
*/
const [[OL00, OL01, OL02], [OL10, OL11, OL12], [OL20, OL21, OL22]] = OKLAB_TO_LMS;
const [[LL00, LL01, LL02], [LL10, LL11, LL12], [LL20, LL21, LL22]] = LMS_TO_LINEAR;
const GAMUT_LOW = -1e-6;
const GAMUT_HIGH = 1 + 1e-6;
const scratch = [0, 0, 0];

function oklabToLinearInto(lightness, a, b, out) {
  const long = OL00 * lightness + OL01 * a + OL02 * b;
  const medium = OL10 * lightness + OL11 * a + OL12 * b;
  const short = OL20 * lightness + OL21 * a + OL22 * b;
  const l3 = long ** 3;
  const m3 = medium ** 3;
  const s3 = short ** 3;
  out[0] = LL00 * l3 + LL01 * m3 + LL02 * s3;
  out[1] = LL10 * l3 + LL11 * m3 + LL12 * s3;
  out[2] = LL20 * l3 + LL21 * m3 + LL22 * s3;
  return out[0] >= GAMUT_LOW && out[0] <= GAMUT_HIGH
    && out[1] >= GAMUT_LOW && out[1] <= GAMUT_HIGH
    && out[2] >= GAMUT_LOW && out[2] <= GAMUT_HIGH;
}

function oklchStops(colors) {
  const oklab = colors.map((hex) => linearToOklab(hexToLinear(hex)));
  const lightness = oklab.map((value) => value[0]);
  const chroma = oklab.map((value) => Math.hypot(value[1], value[2]));
  let hue = oklab.map((value) => ((Math.atan2(value[2], value[1]) * 180) / Math.PI + 360) % 360);
  const chromatic = chroma.map((value) => value > ACHROMATIC_CHROMA);
  if (chromatic.some(Boolean)) {
    const donors = chromatic.map((flag, index) => (flag ? index : -1)).filter((index) => index >= 0);
    hue = hue.map((_, index) => {
      let best = donors[0];
      for (const donor of donors) {
        if (Math.abs(index - donor) < Math.abs(index - best)) best = donor;
      }
      return hue[best];
    });
  } else {
    hue = hue.map(() => 0);
  }
  const unwrapped = [hue[0]];
  for (let index = 1; index < hue.length; index += 1) {
    const step = (((hue[index] - hue[index - 1]) + 540) % 360) - 180;
    unwrapped.push(unwrapped[index - 1] + step);
  }
  return lightness.map((value, index) => [value, chroma[index], unwrapped[index]]);
}

/**
 * The requested Oklab colour, brought inside sRGB by scaling its chroma, written straight into
 * `out` at `offset` as three linear Rec.709 values.
 *
 * Twelve bisection steps and the same clamp as before; the only change is that the candidate never
 * becomes an array, and the gamut test rides back on the conversion that produced it rather than
 * being a separate `.every()` over a fresh closure.
 */
function fitToSrgbInto(lightness, a, b, out, offset) {
  if (!oklabToLinearInto(lightness, a, b, scratch)) {
    let low = 0;
    let high = 1;
    for (let step = 0; step < 12; step += 1) {
      const middle = (low + high) / 2;
      if (oklabToLinearInto(lightness, a * middle, b * middle, scratch)) low = middle;
      else high = middle;
    }
    oklabToLinearInto(lightness, a * low, b * low, scratch);
  }
  out[offset] = Math.min(Math.max(scratch[0], 0), 1);
  out[offset + 1] = Math.min(Math.max(scratch[1], 0), 1);
  out[offset + 2] = Math.min(Math.max(scratch[2], 0), 1);
}

function interpolate(positions, values, t) {
  if (t <= positions[0]) return values[0];
  if (t >= positions[positions.length - 1]) return values[values.length - 1];
  let index = 0;
  while (index < positions.length - 2 && t > positions[index + 1]) index += 1;
  const span = positions[index + 1] - positions[index];
  const fraction = span === 0 ? 0 : (t - positions[index]) / span;
  return values[index] + (values[index + 1] - values[index]) * fraction;
}

/** Blend the ordered colours through Oklch, shorter hue arc. */
export function userGradient(factors, start, end, midpoints = []) {
  const stops = oklchStops([start, ...midpoints, end]);
  const positions = stops.map((_, index) => index / (stops.length - 1));
  const lightness = stops.map((stop) => stop[0]);
  const chroma = stops.map((stop) => stop[1]);
  const hue = stops.map((stop) => stop[2]);
  const out = new Float32Array(factors.length * 3);
  /*
    A one-entry cache on `t`, because the ramp is a function of `t` alone and the commonest
    gradient mode hands it the same `t` several times in a row.

    `sequence` is a per-*residue* factor read at every atom of that residue, so 1AON asks for 58,870
    colours at 8,029 distinct positions and the run lengths are exactly the residues. The three axis
    modes are per atom and never hit, and pay one float comparison for it. Keeping one previous
    value rather than a `Map` is the point: a memo over every distinct `t` would be a 58,870-entry
    table on the structure this is trying not to spend memory on, for a hit pattern that is already
    consecutive. Measured on 1AON with the same three-stop ramp: the sequence ramp 72.1 ms -> 6.8,
    the x-axis ramp 73.1 -> 45.5 (the scalar conversion alone, no cache hits at all).
  */
  let previousT = NaN;
  for (let index = 0; index < factors.length; index += 1) {
    const t = Math.min(Math.max(factors[index], 0), 1);
    if (t === previousT) {
      out[index * 3] = out[index * 3 - 3];
      out[index * 3 + 1] = out[index * 3 - 2];
      out[index * 3 + 2] = out[index * 3 - 1];
      continue;
    }
    previousT = t;
    const radians = (interpolate(positions, hue, t) * Math.PI) / 180;
    const c = interpolate(positions, chroma, t);
    fitToSrgbInto(
      interpolate(positions, lightness, t),
      c * Math.cos(radians),
      c * Math.sin(radians),
      out,
      index * 3,
    );
  }
  return out;
}

/**
 * `sequence_factors`: 0..1 per author chain **per symmetry copy**, in source-file residue order.
 *
 * **The copy is half the key and `chainId` cannot supply it.** An author chain id is unique within
 * a deposition and repeats once per copy in an expanded biological assembly, so keyed on the chain
 * alone this ran a single N-to-C ramp across all twelve of 10EC's portal subunits: the ring came
 * out blue on one side and red on the other, where the picture is the same rainbow twelve times
 * over. Two Styles read this on an assembly (`machine_spheres`, and the two `assembly_wide_*`), and
 * on a deposition it is the same grouping it always was -- one operator, so `symmetryId` is
 * constant and no recorded picture moves.
 */
export function sequenceFactors(residues) {
  const perChain = new Map();
  /*
    `has` then `get` then `push` was three passes over a key built once per residue, and the
    residues of one chain arrive together, so the previous residue's list is reused whenever both
    key components are `===` to it -- which is exactly when the joined string would have been the
    same. `scene.js` calls this on every scene build, so it is on the interactive path rather than
    only on load. It is a small number either way -- 0.8 ms -> 0.5 on 1AON's 8,029 residues -- and
    it is here because the string it stops building is one per residue on every build, not because
    the milliseconds were the problem.
  */
  let previous = null;
  let previousList = null;
  for (const residue of residues) {
    if (previous !== null
      && residue.symmetryId === previous.symmetryId
      && residue.chainId === previous.chainId) {
      previousList.push(residue);
      previous = residue;
      continue;
    }
    const key = `${residue.symmetryId}|${residue.chainId}`;
    let list = perChain.get(key);
    if (list === undefined) perChain.set(key, list = []);
    list.push(residue);
    previous = residue;
    previousList = list;
  }
  const factors = new Map();
  for (const list of perChain.values()) {
    const span = list.length - 1;
    for (let index = 0; index < list.length; index += 1) {
      factors.set(list[index].key, span > 0 ? index / span : 0.5);
    }
  }
  return factors;
}

export { jmolElementColor, CATEGORICAL_PALETTE, NUCLEIC_STRAND_PALETTE };

// The renderer's names for the UI's tables, so a label with no override paints what its swatch
// shows. Carbon is the authored #BDBDBD, not Jmol's #909090 (linear 0.497 against 0.275).
export const DEFAULT_ELEMENT_COLORS = ELEMENT_COLOR_DEFAULTS;
export const NUCLEIC_BASE_COLORS = NUCLEIC_BASE_COLOR_DEFAULTS;
export const NUCLEIC_PART_COLORS = NUCLEIC_PART_COLOR_DEFAULTS;
export const MISSING_COLOR = '#9A9A9A';

// A stop's *position* is part of what the picture means -- pLDDT's are the AlphaFold bands on an
// absolute 0-100 scale, B-factor's even thirds of the robust range -- so only its colour is
// overridable, by label. `i / 3` is the same double as the literal `1 / 3` the table used to state.
export const PLDDT_STOPS = PLDDT_COLOR_STOPS.map(([label, hex]) => [Number(label), hex]);
export const BFACTOR_STOPS = BFACTOR_COLOR_STOPS.map(([, hex], index, all) => [index / (all.length - 1), hex]);
const METRIC_COLOR_STOPS = {
  plddt: [PLDDT_STOPS, PLDDT_COLOR_STOPS.map(([label]) => label)],
  bfactor: [BFACTOR_STOPS, BFACTOR_COLOR_STOPS.map(([label]) => label)],
};

/** `metric_stops`: one fixed ramp with the user's colours substituted at its own stops. */
export function metricStops(mode, overrides) {
  const [stops, labels] = METRIC_COLOR_STOPS[mode];
  if (!overrides) return stops;
  return stops.map(([position, color], index) => [position, overrides[labels[index]] ?? color]);
}

/** Interpolate the stop colours in sRGB, then convert to linear. */
export function piecewiseColor(value, stops) {
  if (!Number.isFinite(value)) return hexToLinear(MISSING_COLOR);
  const positions = stops.map((stop) => stop[0]);
  const colors = stops.map((stop) => hexToSrgb(stop[1]));
  const clamped = Math.min(Math.max(value, positions[0]), positions[positions.length - 1]);
  const srgb = [0, 1, 2].map((channel) => interpolate(positions, colors.map((c) => c[channel]), clamped));
  return srgb.map(srgbToLinear);
}

/**
 * `categorical_colors`: the palette is assigned by the label's position in the *sorted unique*
 * set, not by the label itself, so which colour a chain gets depends on every other chain in the
 * structure.  The label set therefore has to come from the whole imported structure, not from the
 * atoms one style happens to paint.
 */
export function categoricalLookup(labels, overrides = null, defaults = null, palette = CATEGORICAL_PALETTE) {
  const unique = [...new Set(labels)].sort();
  const lookup = new Map();
  unique.forEach((label, index) => {
    const hex = overrides?.[label] ?? defaults?.[label] ?? palette[index % palette.length];
    lookup.set(label, hexToLinear(hex));
  });
  return lookup;
}

/** numpy's default `linear` percentile, so the B-factor range matches `_normalized(robust=True)`. */
export function percentile(sorted, q) {
  if (!sorted.length) return NaN;
  const position = (q / 100) * (sorted.length - 1);
  const low = Math.floor(position);
  const high = Math.min(low + 1, sorted.length - 1);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

/**
 * 0..1 over the whole imported structure, robustly for B factors.
 *
 * **The robust path sorts a `Float64Array`, and that is the same order.** It was
 * `values.filter(Number.isFinite)` followed by `[...finite].sort((a, b) => a - b)` -- two full
 * copies of a per-atom array plus a comparator call per comparison, for a number two of them are
 * read out of. A typed array sorts ascending numerically with no comparator, and the copy it needs
 * is the one the filter was making anyway. The only pair the two orders can disagree on is `-0`
 * against `+0` (a comparator returning `-0` reads as equal and leaves them where they were, while
 * a typed sort puts `-0` first); `percentile()` only ever does arithmetic on them, and `-0` and
 * `+0` are `===`, so no reader can tell. 1AON's 58,870 B factors: **12.8 ms -> 4.0 ms**, and
 * `scene.js` asks for this on every scene build. The three non-robust axis ranges, which lose the
 * `filter()` copy and nothing else, go 3.3 ms -> 0.2 for all three together.
 */
export function normalizedRange(values, { robust = false } = {}) {
  if (robust) {
    const finite = new Float64Array(values.length);
    let count = 0;
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index];
      if (Number.isFinite(value)) { finite[count] = value; count += 1; }
    }
    if (!count) throw new Error('The requested numeric colour field has no finite values');
    if (count > 1) {
      const sorted = finite.subarray(0, count).sort();
      return [percentile(sorted, 5), percentile(sorted, 95)];
    }
    return [finite[0], finite[0]];
  }
  const { count, minimum, maximum } = finiteExtent(values);
  if (!count) throw new Error('The requested numeric colour field has no finite values');
  return [minimum, maximum];
}

/*
  Min and max over the finite values, in one pass and with no copy.

  `Math.min(...array)` is a spread, and a structure large enough to be interesting overflows the
  argument list -- a colour mode is not the place to discover the call-stack limit. This does the
  filtering in the same pass rather than in front of it: the three axis ranges were each allocating
  a second array the length of the first, per scene build, to find two numbers.
*/
function finiteExtent(values) {
  let count = 0;
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) continue;
    count += 1;
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
  }
  return { count, minimum, maximum };
}

export function applyRange(value, [minimum, maximum]) {
  if (!Number.isFinite(value)) return NaN;
  if (Math.abs(maximum - minimum) < 1e-12) return 0.5;
  return Math.min(Math.max((value - minimum) / (maximum - minimum), 0), 1);
}

/**
 * Re-span a structure-wide positional field across the atoms one style
 * actually paints.  Without it a ligand base or a selection layer receives whatever thin slice of
 * the structure-wide ramp its atoms occupy, and a small component renders one flat colour.
 */
export function rescaleWithin(factors, scope) {
  const { count, minimum, maximum } = finiteExtent(scope);
  if (!count) return factors;
  if (maximum - minimum < 1e-12) return factors.map((value) => (Number.isFinite(value) ? 0.5 : value));
  return factors.map((value) => (value - minimum) / (maximum - minimum));
}

/** `nucleic_base_labels`: collapse DNA/RNA residue names to A/C/G/T/U. */
const NUCLEIC_BASE_ALIASES = {
  A: 'A', DA: 'A', ADE: 'A', C: 'C', DC: 'C', CYT: 'C', G: 'G', DG: 'G', GUA: 'G',
  T: 'T', DT: 'T', THY: 'T', U: 'U', DU: 'U', URI: 'U',
};
export function nucleicBaseLabel(residueName) {
  return NUCLEIC_BASE_ALIASES[String(residueName).trim().toUpperCase()] ?? 'Other';
}

/** `nucleic_part_labels`: phosphate, sugar or base, by atom name. */
const PHOSPHATE_ATOMS = new Set(['P', 'OP1', 'OP2', 'OP3', 'O1P', 'O2P', 'O3P']);
export function nucleicPartLabel(atomName) {
  const name = String(atomName).trim().toUpperCase().replaceAll('*', "'");
  if (PHOSPHATE_ATOMS.has(name)) return 'Phosphate';
  return name.includes("'") ? 'Sugar' : 'Base';
}
