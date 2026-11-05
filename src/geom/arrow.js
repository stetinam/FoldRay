/*
  The beta arrow, which is ours.

  Mol*'s measured behaviour corrects the obvious assumption. It would be
  convenient if `interpolateSizes` widened the strand-final residue and our sweep just followed the
  array; **it does not.** `interpolateSizes` is a plain two-segment lerp that never sees
  `secStrucLast` or any arrow factor, and its output on a strand-final residue is flat to within
  1e-6. Mol* puts the arrow in as an *argument* to `addSheet`, which then discards `heightValues`
  for that residue entirely and substitutes `arrowHeight x (1 - j / segments)` -- measured, the
  broad face ramps 5.100 -> 0.000 A across the eight samples while the thickness holds at 0.680.

  So there is nothing to take, and what replaces it is fifteen lines: one linear ramp on the broad
  half-width, keyed off `v.secStrucLast`. That, and not a fitted width scale, is why there is no
  arrow width scale here.

  **How long the head is, is authored.** Mol* runs the ramp across the whole strand-final residue,
  which draws a notably long arrowhead; `arrowHalfWidth`'s `length` shortens it by moving the
  shoulders later into the residue, and defaults to Mol*'s whole-residue behaviour so the number
  changes nothing until a look asks it to.

  **Only the breadth ramps.** The thickness holds, which is what makes an arrowhead read as the
  same ribbon rather than as a separate wedge, and the edge radius holds too -- so a ridged strand's
  edge roll runs unbroken to the tip, and the tip is a rounded point of half-width `r` rather than a
  mathematical zero. On the widest look in the catalogue that tip is 0.5 A across against a 3.6 A
  strand, which reads as a point.
*/

/**
 * The broad half-width at sample `j` of a strand-final residue.
 *
 * `breadth` is the strand's own half-width at this residue's centre -- the value the ramp starts
 * from, widened by `factor` -- rather than the interpolated value at `j`, so the arrowhead's base
 * is a fixed multiple of the strand behind it however the taper into the next kind is running.
 *
 * `segments` is this residue's own sample count, which a terminal residue halves,
 * so the ramp always reaches exactly zero at the last sample.
 *
 * **`length` is how much of that residue the head occupies**, and `1` -- the default -- is the
 * behaviour this function had before it existed: shoulders at the residue's first sample, tip at
 * its last, one whole residue of arrowhead. That is Mol*'s own choice (`addSheet` substitutes
 * `arrowHeight x (1 - j / segments)` across the entire residue) and it draws a long head. At `0.5`
 * the strand runs at its own width for the first half of the residue and the head occupies the
 * second; at `0` there is no head at all and the strand simply ends.
 *
 * Before the shoulders the width is the **strand's**, not the widened base, which is what makes the
 * shoulder a shoulder: an arrowhead is a step out to `breadth x factor` and then a taper to a
 * point, not a wedge that starts wide. The step lands between the last sample below `1 - length`
 * and the first at or above it, so with `LINEAR_SEGMENTS` at 8 the shoulder face is one segment
 * deep wherever it falls -- shortening the head does not sharpen the shoulder, it only moves it.
 *
 * Kept bit-identical at the default on purpose: `length` is a look's authored number, and a new
 * knob that moves a picture nobody asked to move is how a byte-identity baseline stops meaning
 * anything.
 */
export function arrowHalfWidth(breadth, factor, sample, segments, length = 1) {
  const span = Math.max(segments, 1);
  const along = Math.min(Math.max(sample, 0), span) / span;
  const head = Math.min(Math.max(length, 0), 1);
  // No head: the strand keeps its own width to the end. Same picture as `arrow: false` for this
  // residue, reached by a number rather than by a flag, so a look can dial it out.
  if (head <= 0) return breadth;
  const shoulders = 1 - head;
  if (along < shoulders) return breadth;
  // 0 at the shoulders, 1 at the tip.
  const into = (along - shoulders) / head;
  return breadth * factor * (1 - into);
}

/**
 * Whether this trace element is the one that carries the arrowhead.
 *
 * A strand's *last* residue, and only when the look asks for arrows -- a ribbon is a trace of the
 * fold and an arrowhead on one would make it a cartoon.
 *
 * True on a headless look too (`cartoon_geometric`), which caps and skips the entry burial as though
 * a tip were there. Requiring a head would move that look's sheet geometry (7,700 -> 7,640
 * triangles), so it stays as it is.
 */
export function isArrowResidue(look, kind, secStrucLast) {
  return look.arrow === true && kind === 'sheet' && secStrucLast === true;
}
