/*
  The authored looks: three numbers per secondary-structure kind, per representation.

  **These are ours.** Geometry in this tree comes from one of three places -- Mol* has it, it is a
  published fact, or we author it -- and a cross-section is the third. These numbers are chosen for
  this renderer's tone map, its spline and its material model; they are design decisions and they
  carry no obligation to match anything.

  **The geometry is stated per secondary-structure kind, not as a settings table per cartoon type.**

  **What the numbers *are* anchored on is Mol*'s own trace, which is MIT and is already the spline
  underneath.** Mol*'s cartoon defaults -- `sizeFactor 0.2`, `aspectRatio 5`, a carbon trace atom --
  put a protein sheet at a 0.340 A half-thickness and a 1.700 A half-width, measured through the
  seam at 0.680 x 3.397 A full extents. That is the scale a cartoon is legible at, so it is the
  scale these start from. Every departure from it below is a choice, not a fit.

  ---

  ## The vocabulary

  `w` is the broad half-width, `h` is the half-thickness, `r` is the edge radius -- and the profile
  is their Minkowski sum, so a look's **full** extents are `2(w + r)` across the face and `2(h + r)`
  through it. `profile.js` has the shape.

  A look states a profile per **kind**: `helix`, `sheet`, `loop` and `nucleic`. The kind is read off
  the trace element -- `v.secStrucType` for protein, `isNucleic(v.moleculeType)` for nucleic -- and
  `sweep.js` tapers between a residue's kind and its neighbours', which is what makes a helix run
  out into a loop rather than stop against one. A look that does not name a kind falls back to its
  `loop`, so a protein look needs no nucleic entry it will never be asked for.

  `arrow` turns on the beta arrow (`arrow.js`); `helixOrientation` puts the curve on the helix
  *axis* rather than through the alpha carbons; `helixRod` is a **radius**, and it takes the helix
  out of the sweep altogether -- `rods.js` lays an analytic flat-capped capsule chain along that
  axis instead. The two together are the cylindrical cartoon, and a look that names `helixRod`
  states no `helix` cross-section because it no longer has one.
  `cornerSegments` is steps per quarter-arc and is chosen for how smooth a rolled edge's highlight
  is: it is the only thing it affects, and triangle count is linear in it.
  **Five knobs exist because three numbers per kind could not reach the picture.** They are listed
  together here because they share that justification and nothing else:

  * `panel: false` draws the rails and **not** the surface they edge. It is the only entry in this
    file that removes geometry, and a look that names it needs a `rail` on every kind or the chain
    comes apart wherever one is missing.
  * `flat: true` gives every triangle its own three vertices carrying its own plane's normal --
    `geom/markers.js`'s technique and its argument, one scale up. It changes no surface and no
    triangle count; it stops the tracer interpolating a curve across a facet.
  * `linearSegments` is how many samples of spine a residue takes, defaulting to `sweep.js`'s
    `LINEAR_SEGMENTS`. Eight is where the curve stops moving, so this only ever goes *down*, and
    when it does it is a different shape rather than a coarser version of the same one.
  * `faceStep` overrides `FACE_STEP`, and `0` leaves a cross-section's straight faces uncut. That
    constant exists to take a shadow comb out of a ribbon claiming to be smooth; a look that is not
    claiming that has nothing to spend the triangles on.
  * `sides` replaces the profile's rounding **disc** with a regular polygon of circumradius `r`, so
    the cross-section becomes flat facets meeting at hard creases. `profile.js` carries the
    construction; a look that names it needs `r > 0` on every kind, because a polygon with no
    circumradius is the rectangle it would collapse to and is refused rather than substituted.

  `bases` names a solid -- `block` or `ring` -- and is the third knob of that family: it draws one
  flat-shaded solid and one analytic stem per **nucleotide**, beside the sweep and never inside it,
  and it is the only thing in this table that reads an atom the trace does not pass through.
  `geom/bases.js` carries it, with `baseThickness`, `basePad` and `baseStem`.

  ## The ridge: `r > h` is a bevel, not a raised edge

  An edge roll fatter than the face does not stand proud of it. **The Minkowski profile cannot do
  that**: it puts the face at `h + r`, which is exactly the top of the corner arc, so face and roll
  are tangent by construction and a large `r` makes a fatter, rounder ribbon and nothing else. Two
  of the cartoons below are bevels and are the better for it -- a rounded rectangle is what
  `cartoon` and `cartoon_chonky` are for -- but neither is sold as a raised edge.

  The raised edge is the rail, in the next section, and the three `cartoon_railed*` looks carry it.
  The two inequalities -- `r > h` and `rail > h + r` -- are held apart.

  **These numbers were chosen by eye in front of this renderer**, against reference renders as art
  direction and not as a target. A look is done when the picture is liked; changing a number here is
  the supported way to change one and needs nothing else touched.

  ## The rails, which are a fourth number and not a fourth axis of the cross-section

  **`rail` is a separate effect from `r` and the two are not degrees of the same thing.** `r` rounds
  the panel's own edge and can never make it stand proud -- "The ridge" above is why.

  A **rail** is a tube of radius `rail` laid along the panel's own outer edge -- centred at
  `u = +/-(w + r)`, `v = 0` -- and closed across the short ends, so the rim runs cleanly all the way
  round. It stands proud of the face exactly when **`rail > h + r`**, and that inequality is the
  whole of this effect.

  **A rail is per kind, and the point of that is that it need not be on for all of them.** It sits
  in `profiles` beside `w`, `h` and `r` rather than on the look, so a helix can carry a cord while a
  strand does not, or the other way round, or both. Where one kind has a rail and its neighbour
  has none, the cord fades out with the panel it edges rather than stopping on a face.

  The look it makes is **PyMOL/MolScript's fancy-helix dumbbell cross-section** -- a thin flat panel
  with a fat round cord down each edge -- which is a published look, decades old, and named here
  because that is the shortest way to say what it is. `sweep.js` builds it from analytic spheres and
  capped cylinders on the rail's own centre line rather than folding it into the cross-section:
  analytic beats tessellated, and it keeps `profile.js` and every ring count untouched.

  A look that names no `rail` emits none.
*/

// For `repairLookSettings()` at the foot of this file, which asks `profile.js` whether a
// cross-section can be swept rather than restating the rule.
import { profileRefusal } from './profile.js';

/**
 * The profile a kind falls back to.
 *
 * A protein look is never asked for a nucleic kind (the component filter in `scene.js` decides
 * which residues each style owns) and a nucleic look is never asked for helix or sheet, because
 * Mol* assigns no secondary structure to a nucleotide. So the fallback is a safety net rather than
 * a shape anyone sees, and pointing it at `loop` is what keeps a look three numbers rather than
 * twelve.
 */
const FALLBACK_KIND = 'loop';

/**
 * How much of a residue's roll is spread evenly along it. A look's `twist`, when it states one.
 *
 * **This is a look-level number and deliberately not a fifth per-kind one.** `w`, `h`, `r` and
 * `rail` describe the cross-section, which is a different shape for a helix and for a loop; how the
 * frame carrying that cross-section rotates between one residue's stated orientation and the next's
 * is the same question whatever shape is standing in it. `frame.js` is the whole of it, and carries
 * the measurement: Mol*'s own schedule puts 1.85 degrees of roll on the step leaving a residue
 * boundary and 8.81 on the step before its end, so a flat ribbon reads as tiles rather than a coil.
 *
 * `0` is Mol*'s schedule exactly, bit for bit; `1` is fully even. The default is **1**, because
 * there is no argument for the other end -- the schedule
 * is how one frame is reached from another, not a statement about the protein, and the statements
 * themselves (the two end frames, one per residue) are untouched at every setting. It is a knob at
 * all, rather than a correction applied silently, because a number like this one is chosen by eye
 * in front of the renderer.
 */
export const DEFAULT_TWIST = 1;

export const PROFILES = {
  /*
    ---- the six cartoons, and the two beneath them.

    A flat ribbon through helices and sheets, a thin tube through loops, a beta arrow on the last
    residue of every strand. They divide into two bevels (`cartoon`, `cartoon_chonky`), three rails
    (`cartoon_railed`, `_blend`, `_chonky`) and one that draws its helices as rods
    (`cartoon_geometric`) -- plus `cartoon_cords` and `cartoon_lowpoly` below them.
  */

  /*
    Cartoon -- classic.

    1.13/0.12/0.09 on the helix. The same look at 1.60/0.24/0.14 hides the fold behind itself on
    anything larger than a single domain, so the narrow one is what "classic" means. Two entries a
    size apart are one look with a slider on it, not two looks.

    `session-format.js` reads the `cartoon_slender` representation id and the `slender` cartoon type
    as this look, so a saved session naming either opens rather than failing to resolve.
  */
  cartoon: {
    label: 'Cartoon — classic',
    arrow: true,
    arrowFactor: 1.6,
    cornerSegments: 4,
    profiles: {
      helix: { w: 1.13, h: 0.12, r: 0.09 },
      sheet: { w: 1.00, h: 0.14, r: 0.11 },
      loop: { w: 0.00, h: 0.00, r: 0.20 },
    },
  },

  /*
    Cartoon -- chonky. The other end of the same axis: full width, and thick enough that the rolled
    edge is a third of the profile rather than a hint of one. `r < h` on both kinds, so it is a
    rounded rectangle and not a raised edge -- see "The ridge" above for why that distinction is
    worth restating on every bevel.
  */
  cartoon_chonky: {
    label: 'Cartoon — chonky',
    arrow: true,
    arrowFactor: 1.68,
    cornerSegments: 5,
    profiles: {
      helix: { w: 1.55, h: 0.37, r: 0.33 },
      sheet: { w: 1.55, h: 0.35, r: 0.25 },
      loop: { w: 0.00, h: 0.00, r: 0.50 },
    },
  },

  /*
    Cartoon -- geometric. What a viewer picks it for is that the whole picture reads as
    straight-edged solids, and the cylinder is how that is done rather than what it is for.

    `helixOrientation` moves the curve onto the helix axis (measured: 132 of
    3RGK's 149 control points move, mean 2.207 A), and **the helix is then not swept at all**:
    `helixRod` hands it to `geom/rods.js`, which lays an analytic capsule chain along that axis and
    leaves both of its ends flat-capped.

    **This look states no `helix` cross-section, and the absence is deliberate.** It has none -- it
    has a radius. What the absence *does* is make a neighbouring loop taper toward the loop's own
    numbers, so the cord holds its width right up to the cap instead of swelling toward a helix
    profile nothing draws. It is not what stops the sweep; `sweep.js`'s `THE ROD` block is, and the
    two are worth keeping apart -- a helix quietly swept as a 0.32 A tube *inside* a 2.04 A rod is
    invisible until an opacity below one reveals it.

    Swept instead as a `{ w: 0, h: 0, r: 2.30 }` tube, it renders a sausage: it
    tapers into the loop at both ends, so a helix swells out of the cord and pinches back into it
    with no cap anywhere. **A cylinder is a constant radius that stops**, and neither half of that
    is true of a swept tube.

    **`arrowLength: 0` is how this look has no arrowhead**, and it is a different statement from
    `arrow: false`. The strand keeps its own breadth to its last sample (`arrow.js`, "No head"),
    so a sheet ends in a flat cut rather than tapering to a point -- which is the same family of
    decision as the rod's flat cap, and the reason the look reads as geometry rather than as
    ribbon. `arrowFactor: 1` states the same thing a second way and is kept because it makes the
    intent legible in the table.

    ## The radius, which is authored

    **2.04 A, authored by eye in front of this renderer**, from a side-by-side comparison: at the
    2.30 of the alpha carbons' own radius about the helix axis -- a published fact and a sound
    anchor -- 3RGK's rods crowd each other, the two that cross in the middle very nearly
    merge, and the caps stop reading as separate discs. Around 2.0 there is daylight between them
    and each cap reads. That is the whole of the argument; it is a design decision and it carries no
    obligation to match anything.

    **A reference render is art direction and not a source of numbers.** The loop's 0.32 is
    authored, like the rod.
  */
  cartoon_geometric: {
    label: 'Cartoon — geometric',
    arrow: true,
    arrowFactor: 1,
    arrowLength: 0,
    taperHold: true,
    helixOrientation: true,
    helixRod: 2.04,
    cornerSegments: 5,
    profiles: {
      sheet: { w: 1.23, h: 0.31, r: 0.25 },
      loop: { w: 0.00, h: 0.00, r: 0.32 },
    },
  },

  /*
    ---- the three railed cartoons. **`rail > h + r`.**

    The raised edge. The panel is a thin card and each of its two long edges carries a round cord,
    so the cord stands proud of both faces and the rim closes across the short ends. `sweep.js`
    emits it as analytic spheres and cylinders on the rail's own centre line, so it costs no
    triangle and no ring count.

    All three carry a rail on the **strand as well as the helix**, and an arrowhead differs from a
    helix in three places, each of which draws a plausible picture when missed. A rim closed at the
    arrowhead's *shoulder* lays a 4.70 A bar across the widest part of the arrow and cuts the cord
    into three pieces; a cord not stopped at the *point* runs 1.0 and 1.2 A past it, as a pair of
    ridges down the loop behind; and a head whose cross-section blends halfway into the loop's by
    the time it gets there makes a point 0.39 A across that disappears into the tube. `sweep.js`
    carries each rule beside the condition it governs.

    The loop carries no rail on any of them: a circular cross-section has no edge to lay one on, and
    what a rail does there is fade out with the panel it was edging.

    **The three differ by two things and it is worth saying which.** `cartoon_railed` and
    `cartoon_railed_blend` are the *same* cross-section and differ only in `taperHold` -- held, a
    kind keeps its own numbers to its own boundary and the crossover is a step; blended, it ramps
    into its neighbour's across the join and a short helix pinches. Both are pictures somebody
    wants, which is why the switch is two entries rather than a default.
    `cartoon_railed_chonky` is a separate cross-section: a fatter cord on a thicker panel, and a
    helix cord (0.56) noticeably fatter than its strand's (0.37), so the two kinds read apart by
    their rims rather than by their widths.
  */
  cartoon_railed: {
    label: 'Cartoon — railed',
    arrow: true,
    arrowFactor: 1.69,
    taperHold: true,
    cornerSegments: 3,
    profiles: {
      helix: { w: 1.11, h: 0.13, r: 0.00, rail: 0.21 },
      sheet: { w: 1.02, h: 0.14, r: 0.00, rail: 0.21 },
      loop: { w: 0.00, h: 0.00, r: 0.39 },
    },
  },
  cartoon_railed_blend: {
    label: 'Cartoon — railed (blend)',
    arrow: true,
    arrowFactor: 1.69,
    cornerSegments: 3,
    profiles: {
      helix: { w: 1.11, h: 0.13, r: 0.00, rail: 0.21 },
      sheet: { w: 1.02, h: 0.14, r: 0.00, rail: 0.21 },
      loop: { w: 0.00, h: 0.00, r: 0.39 },
    },
  },
  cartoon_railed_chonky: {
    label: 'Cartoon — railed (chonky)',
    arrow: true,
    arrowFactor: 1.69,
    taperHold: true,
    cornerSegments: 4,
    profiles: {
      helix: { w: 1.06, h: 0.17, r: 0.00, rail: 0.56 },
      sheet: { w: 1.06, h: 0.21, r: 0.00, rail: 0.37 },
      loop: { w: 0.00, h: 0.00, r: 0.34 },
    },
  },

  /*
    ---- the three that are not made of the same parts as the rest.

    Every look above was chosen in front of the renderer and these three were not: they went into
    the catalogue to be looked at, and their numbers are first guesses rather than choices. Each one
    asks for a knob the catalogue did not have, and the knob is the reason it is worth rendering at
    all -- three numbers per kind cannot reach any of these three pictures.

    **`cartoon_cords` and `cartoon_lowpoly` are in the type picker.** `cartoon_prism` is not: it
    stays declared and drawable, offered nowhere, which is the one withheld look in this file.

    Being in the picker does **not** mean their numbers have been chosen in front of the renderer --
    they have not, and the paragraph above still holds. What it means is that they are offered.

    ## `cartoon_cords`: the rail without the panel

    `panel: false` is the one entry in this file that *removes* geometry, and what is left is the
    cord already running round the whole outline of every helix, every strand and every arrowhead.
    It is the railed look with the card taken out from between the two cords, so the fold reads as
    wire rather than as ribbon and you can see straight through it.

    **Every kind carries a rail, and that is a requirement rather than a choice here.** A kind with
    no rail on a look with no panel draws *nothing at all*, so the chain would come apart at every
    loop. A loop has no edge to lay a cord on -- its cross-section is a circle -- but it has an
    extent, and the rails sit at `+/-(w + r)` whatever the shape is, so what the loop gets is a pair
    of cords `2(w + r)` apart. `sweep.js`'s `A LOOK WITH NO PANEL` carries the rest.

    ## `cartoon_lowpoly`: the facets are the look

    Two knobs, and they are deliberately two. `linearSegments: 3` is the geometry -- the spine is
    sampled below where the curve stops moving, so a residue is three flat bands rather than eight
    -- and `flat: true` is the shading, giving every triangle its own vertices and its own plane's
    normal so each facet catches its own highlight. Either alone is a defect: flat shading at eight
    rows a residue is a smooth ribbon that has been made to look chipped, and three rows with
    smooth normals is a smooth ribbon that is subtly wrong. `faceStep: 0` is the third: `FACE_STEP`
    exists to cut a comb out of a ribbon claiming to be smooth, and this one is not claiming that.

    It is the only look in the catalogue that costs **fewer** triangles than `cartoon`, and by a
    lot -- three bands against eight and no face subdivision at all.

    ## `cartoon_prism`: the disc was one choice of rounding

    `sides: 6` replaces the profile's rounding disc with a regular hexagon, so the Minkowski sum is
    a polygon and the cross-section is flat facets meeting at hard creases. It is not a low-poly
    approximation of the rounded look: the facets run the *length* of the ribbon, so each one
    carries an unbroken specular line down a helix the way a rail's cord does, and the loops come
    out as hexagonal rod. Extruded aluminium rather than a bevel.

    **It needs `r > 0` on every kind** -- a polygon of zero circumradius is the rectangle it would
    collapse to, and `profile.js` refuses rather than drawing one.
  */
  cartoon_cords: {
    label: 'Cartoon — cords',
    arrow: true,
    arrowFactor: 1.69,
    taperHold: true,
    panel: false,
    cornerSegments: 3,
    profiles: {
      helix: { w: 1.11, h: 0.13, r: 0.00, rail: 0.24 },
      sheet: { w: 1.02, h: 0.14, r: 0.00, rail: 0.24 },
      loop: { w: 0.00, h: 0.00, r: 0.34, rail: 0.17 },
    },
  },
  cartoon_lowpoly: {
    label: 'Cartoon — low poly',
    arrow: true,
    arrowFactor: 1.70,
    taperHold: true,
    flat: true,
    linearSegments: 3,
    faceStep: 0,
    cornerSegments: 2,
    profiles: {
      helix: { w: 1.50, h: 0.30, r: 0.20 },
      sheet: { w: 1.35, h: 0.28, r: 0.18 },
      loop: { w: 0.00, h: 0.00, r: 0.42 },
    },
  },
  cartoon_prism: {
    label: 'Cartoon — prism',
    arrow: true,
    arrowFactor: 1.70,
    taperHold: true,
    sides: 6,
    cornerSegments: 5,
    profiles: {
      helix: { w: 1.15, h: 0.18, r: 0.42 },
      sheet: { w: 1.05, h: 0.16, r: 0.38 },
      loop: { w: 0.00, h: 0.00, r: 0.50 },
    },
  },

  /*
    ---- the two ribbons.

    A circle, everywhere. No secondary-structure distinction and
    no arrow -- a ribbon is a trace of the fold, and a strand that widened into an arrowhead would
    be a cartoon. The two differ by one number, which is the whole of what a ribbon is.

    **1.61 and 0.94 A, both authored by eye in front of this renderer**, and far enough apart (a
    factor of 1.7) that a viewer can tell which one they picked. A third radius between them would
    be one look with a slider on it, not a third look.
  */
  ribbon: {
    label: 'Ribbon — standard',
    arrow: false,
    cornerSegments: 6,
    profiles: { loop: { w: 0.00, h: 0.00, r: 1.61 } },
  },
  ribbon_slender: {
    label: 'Ribbon — slender',
    arrow: false,
    cornerSegments: 6,
    profiles: { loop: { w: 0.00, h: 0.00, r: 0.94 } },
  },

  /*
    Ribbon -- flat tape. **The one look in this file that was found rather than designed.**

    `nucleic_cartoon`'s cross-section is a wide flat band, and pointing a *nucleic* look at a
    protein draws exactly this: the look states only `nucleic` and `loop`, a peptide is
    never either of the first, so every kind falls back to the second and the whole chain comes out
    as one uniform tape with no secondary structure in it anywhere. That is a look, and it is the
    third thing a ribbon can be -- the first two are circles of two radii, and this is the flat
    band the word "ribbon" means outside this product.

    It is a **separate entry rather than a note on the nucleic one** because a look states what it
    is for, and because the two would otherwise be one set of numbers serving two components with
    no way to move either without the other. The numbers are `nucleic_cartoon`'s exactly; they are a
    starting point and not a decision.

    No arrow and no per-kind profile, which is what makes it a ribbon rather than a cartoon: the
    fold is traced, and nothing about it is annotated.
  */
  ribbon_tape: {
    label: 'Ribbon — flat tape',
    arrow: false,
    cornerSegments: 4,
    profiles: { loop: { w: 1.85, h: 0.26, r: 0.16 } },
  },

  /*
    ---- nucleic.

    A duplex is wider and flatter than a peptide ribbon because a base pair is wider than a residue,
    and Mol* agrees: its own nucleic branch takes `h = w x aspectRatio` exactly as its sheets and
    helices do. The `nucleic` kind is the only one any of these four looks is ever asked for.

    **The trace atom is an oxygen and not a phosphorus.** A
    nucleotide's trace atom is `O3'` -- `PolymerTypeAtomRoleId[PolymerType.DNA].trace` is
    `{O3', O3*}` -- so Mol*'s derived width tracks an oxygen's van der Waals radius, not a
    phosphorus's. It changes nothing here, because these are absolute half-extents rather than a
    radius times a factor, but it is load-bearing one file over: `bases.js`'s stem ends at the
    **spine** rather than at that atom, and knowing which atom the spine is threaded through is how
    anyone checks that.

    ---- and the base looks.

    `nucleic_cartoon` and `nucleic_ribbon` draw the backbone and stop, which is a true picture of a
    phosphodiester chain and not a picture of DNA: the duplex comes out hollow. These two draw the
    bases. Each of the four is tuned on its own rather than sharing the numbers of the look it
    extends: the blocks' backbone is a thinner tape, and the rings' tube is thinner than the
    ribbon's.

    `bases` is a look-level knob in the same family as `helixRod` and `rail`: it adds analytic and
    flat-shaded geometry beside the sweep rather than changing the sweep, and a look that does not
    name one emits nothing and costs one property read. `geom/bases.js` has the construction and the
    measurements; the three numbers here are the authored part.

    - `baseThickness` is the slab's **half**-thickness: `nucleic_blocks`' 0.25 is a 0.50 A base
      against a backbone tape 0.58 A thick, and `nucleic_rings`' 0.20 is a 0.40 A prism against a
      2.0 A tube -- thinner than the backbone it hangs off either way, which is what keeps a stack
      of them from reading as a second ribbon.
    - `basePad` grows the ring's own in-plane extent, standing in for the hydrogens, the exocyclic
      groups and the van der Waals skin that ring-atom *centres* leave out. 0.45 puts a standard
      purine at about 4.5 A across, which is where Mol*'s fixed number puts it -- but arrived at
      from the ring in front of it, so a modified base is sized rather than assumed. The prism uses
      **no pad at all**: there the outline is the look, and padding it would round off the fusion
      notch that tells a purine from a pyrimidine.
    - `baseStem` is the connector's radius, and it is a radius rather than a half-width because the
      connector is a capsule.
  */
  nucleic_cartoon: {
    label: 'Nucleic tape',
    arrow: false,
    cornerSegments: 4,
    profiles: {
      nucleic: { w: 1.85, h: 0.26, r: 0.16 },
      loop: { w: 1.85, h: 0.26, r: 0.16 },
    },
  },
  nucleic_ribbon: {
    label: 'Nucleic ribbon',
    arrow: false,
    cornerSegments: 6,
    profiles: {
      nucleic: { w: 0, h: 0, r: 1.75 },
      loop: { w: 0, h: 0, r: 1.75 },
    },
  },
  nucleic_blocks: {
    label: 'Nucleic blocks',
    arrow: false,
    cornerSegments: 4,
    bases: 'block',
    baseThickness: 0.25,
    basePad: 0.45,
    baseStem: 0.22,
    profiles: {
      nucleic: { w: 1.5, h: 0.13, r: 0.16 },
      loop: { w: 1.85, h: 0.26, r: 0.16 },
    },
  },
  nucleic_rings: {
    label: 'Nucleic rings',
    arrow: false,
    cornerSegments: 6,
    bases: 'ring',
    baseThickness: 0.20,
    basePad: 0,
    baseStem: 0.20,
    profiles: {
      nucleic: { w: 0, h: 0, r: 1 },
      loop: { w: 0, h: 0, r: 1 },
    },
  },
};

/** The four kinds a trace element can be, which is the key space of every look's `profiles`. */
export const PROFILE_KINDS = ['helix', 'sheet', 'loop', 'nucleic'];

/** The look a representation id is drawn with, or `undefined` when it is not a sweep. */
export function lookFor(representation) {
  return PROFILES[representation];
}

/** One kind's `(w, h, r)`, through the look's own fallback. */
export function profileFor(look, kind) {
  return look.profiles[kind] ?? look.profiles[FALLBACK_KIND];
}


/*
  ------------------------------------------------------------------------------------------------
  The looks as controls: what a user may move, derived from the look rather than tabulated.
  ------------------------------------------------------------------------------------------------

  **This exposes the numbers that are already here**: a look *is* its authored numbers, and a second
  table of them would be a second answer. So the panel is derived from the look, and holds itself to
  two rules:

  1. **No second table.** The controls and their defaults are *derived from the look* -- which kinds
     it states, whether it carries a rail, a rod, an arrow or bases -- so a look added to `PROFILES`
     gets its panel for free and a look edited there moves its own defaults. There is nowhere for a
     copy to drift.
  2. **Silence is bit-identical.** `lookWithSettings(look, {})` returns the look itself, by identity,
     and every field's default is the look's own value. A request that carries no
     `representation_settings` renders exactly what it rendered before -- which is what keeps a
     recorded picture a measurement rather than a re-baseline. Both halves are asserted.

  A field is `[name, label, min, max, step, integer]`, or `[name, label, BOOLEAN_SETTING]` --
  `src/selection-model.js`'s own shape, because that file's validator and `main.js`'s generic editor
  are what read these and inventing a second shape here would mean a translator between them.

  **Every minimum is at or below the authored value it defaults to, and that is not decoration.**
  `constrainedRepresentationSetting()` *clamps*, so a floor above a look's own number would rewrite
  that number the moment the editor first wrote its values -- `cartoon_railed` carries `r: 0` on its
  helix and its sheet, because a railed look bevels nothing, so an `edge` minimum of 0.01 would have
  moved three looks by hand while every gate stayed green. The three cross-section axes therefore
  floor at 0.

  What that leaves reachable is a panel with no extent -- `h + r` or `w + r` at 0, which one slider
  reaches on any kind authored at `r: 0` -- and `profile.js` **throws** on it rather than sweeping a
  line. A `panel: false` look builds no ring and does not throw. **The throw is still the right
  answer for a document and is not what a slider gets**: `repairLookSettings()` at the foot of this
  file moves the partner field instead, because moving one control must not produce a refusal. A
  slider that silently clamps a look's authored number is still worse than either.

  **Every floor that names a piece of geometry is 0**: a
  rail, a base slab and a base stem are each removed by taking their own field to zero, and each is
  read through an epsilon at the builder (`RAIL_EPSILON`, `SOLID_EPSILON`, `STEM_EPSILON`), so zero
  lays no cord rather than a cord of no radius. A `rail` floor of 0.01 would keep a `panel: false`
  look from drawing nothing at all; that picture is reachable instead, and what it gets is
  `renderer.js`'s refusal by name rather than an empty frame.

  **`helix_rod_radius` keeps its 0.1 and is the one that is not a feature switch.** Zero there is not
  "no rod" -- `isRodResidue()` stops answering, so the helix is *swept*, and `cartoon_geometric`
  states no helix cross-section, so the kind falls back to its loop's 0.32 A tube. That is a fatter
  helix than the floor itself draws: a slider that reverses direction at its last step, and a look
  quietly becoming a different look. Turning the rods off wants its own switch, the way `arrow_head`
  is one, rather than the bottom of this slider.
*/

// `selection-model.js`'s marker, restated rather than imported: this file is the geometry layer and
// must not depend on the model layer. The two are held equal.
const BOOLEAN_SETTING = 'boolean';

/** Which axis of a kind's `(w, h, r)` a field name refers to, and how it reads in the panel. */
const KIND_AXES = [
  ['width', 'w', 'Width', 0, 6],
  ['thickness', 'h', 'Thickness', 0, 3],
  ['edge', 'r', 'Edge radius', 0, 3],
];

const KIND_LABELS = {
  helix: 'Helix', sheet: 'Sheet', loop: 'Loop', nucleic: 'Nucleic',
};

/** The kinds a look states in its own table, in `PROFILE_KINDS` order so the panel is stable. */
function statedKinds(look) {
  return PROFILE_KINDS.filter((kind) => look.profiles[kind] !== undefined);
}

/**
 * The kinds a control can reach. A nucleic look states `loop` only as the fallback: `traceKind()`
 * answers `nucleic` for every nucleotide, so its loop fields and the hold moved no vertex (1BNA,
 * 1EHZ and a modified RNA, all four looks).
 */
function offeredKinds(look) {
  return look.profiles.nucleic !== undefined ? ['nucleic'] : statedKinds(look);
}

/**
 * The kinds of this look that lay a rail, which is what makes a rail control meaningful.
 *
 * **Per kind, not one field for the whole look.** A single "Rail radius" whose
 * default is read off *the first* kind with a positive rail, and whose value is then written into
 * **every** kind that has one, needs the precondition that "the rail is one number across the look
 * in every look that has one" -- and the catalogue two hundred lines above does not keep it:
 *
 * | | |
 * | --- | --- |
 * | `cartoon_railed`, `cartoon_railed_blend` | helix 0.21, sheet 0.21 -- one number, as assumed |
 * | `cartoon_railed_chonky` | helix **0.56**, sheet **0.37** |
 * | `cartoon_cords` | helix 0.24, sheet 0.24, loop **0.17** |
 *
 * So on two of the four railed looks one field would *misdescribe* the look before anything is
 * touched, and the first edit to any field -- including "Overall size" -- would silently widen the
 * sheet cord by 51% and the loop cord by 41%, with no way back short of reloading. No recorded
 * picture shows it: `lookWithSettings(look, {})` still returns the authored look by identity.
 *
 * A rail is a number belonging to a cross-section, exactly as `w`, `h` and `r` are, so it is
 * offered the way those are -- one field per kind that has one. That is this panel's own rule
 * ("which fields a look offers follows from what the look *has*"), applied to the rail too.
 */
function railedKinds(look) {
  return offeredKinds(look).filter((kind) => (look.profiles[kind].rail ?? 0) > 0);
}

/**
 * Every control this look offers, derived from what the look actually has.
 *
 * The order is the order the panel shows: the one global dial, then the cross-section kind by kind,
 * then the three optional pieces of geometry, then the two switches. A look with no arrow gets no
 * arrow field rather than a disabled one: the honest form of "this look has no arrowhead" is not
 * offering one.
 */
export function lookSettingControls(look) {
  if (!look) return [];
  const controls = [['size_scale', 'Overall size', 0.2, 3, 0.01, false]];
  for (const kind of offeredKinds(look)) {
    for (const [axis, , label, minimum, maximum] of KIND_AXES) {
      controls.push([`${kind}_${axis}`, `${KIND_LABELS[kind]} ${label.toLowerCase()}`, minimum, maximum, 0.01, false]);
    }
  }
  for (const kind of railedKinds(look)) {
    controls.push([`${kind}_rail`, `${KIND_LABELS[kind]} rail radius`, 0, 2, 0.01, false]);
  }
  if (look.helixRod !== undefined) {
    controls.push(['helix_rod_radius', 'Helix rod radius', 0.1, 5, 0.01, false]);
  }
  if (look.bases !== undefined) {
    controls.push(
      ['base_thickness', 'Base thickness', 0, 2, 0.01, false],
      ['base_pad', 'Base pad', 0, 3, 0.01, false],
      ['base_stem', 'Base stem radius', 0, 2, 0.01, false],
    );
  }
  /*
    The arrow pair, and the condition is `arrowLength` rather than `arrow`.

    `cartoon_geometric` says `arrow: true` **and** `arrowLength: 0`, which is how it has no head: the
    strand keeps its own breadth to its last sample and ends in a flat cut. Its `arrowFactor` is 1,
    stated to make the intent legible. Offering a width field there would be a control with nothing
    behind it *and* a clamp against the 1.01 floor below, which would move a number nobody touched.

    Strictly above 1 for the looks that do have a head: `arrowFactor <= 1` over a non-zero
    `arrowLength` ramps the breadth from `w` to `w`, so the sweep does the arrow's work and draws a
    strand -- that combination is refused in the catalogue, and the panel must not be the way back
    in.
  */
  if (look.arrow && (look.arrowLength ?? 1) > 0) {
    controls.push(['arrow_width', 'Arrowhead width', 1.01, 3, 0.01, false]);
    controls.push(['arrow_head', 'Draw arrowheads', BOOLEAN_SETTING]);
  }
  // Only where there are two kinds to blend between. A one-kind look draws one shape the whole
  // way, so on all three ribbons the switch would be a bit-identical no-op.
  if (offeredKinds(look).length > 1) {
    controls.push(['taper_hold', 'Hold each kind to its own width', BOOLEAN_SETTING]);
  }
  return controls;
}

/**
 * The look's own values, as the panel's defaults.
 *
 * Every entry reads out of `PROFILES` rather than restating a number, so this cannot disagree with
 * the look it describes. `size_scale` is the one field with no counterpart in the look: it is a
 * multiplier and its neutral value is 1.
 */
export function lookSettingDefaults(look) {
  if (!look) return undefined;
  const defaults = { size_scale: 1 };
  for (const kind of offeredKinds(look)) {
    for (const [axis, key] of KIND_AXES) defaults[`${kind}_${axis}`] = look.profiles[kind][key];
  }
  // One per railed kind, read off that kind. See `railedKinds()` for what a single field would cost.
  for (const kind of railedKinds(look)) defaults[`${kind}_rail`] = look.profiles[kind].rail;
  if (look.helixRod !== undefined) defaults.helix_rod_radius = look.helixRod;
  if (look.bases !== undefined) {
    defaults.base_thickness = look.baseThickness ?? 0;
    defaults.base_pad = look.basePad ?? 0;
    defaults.base_stem = look.baseStem ?? 0;
  }
  if (look.arrow && (look.arrowLength ?? 1) > 0) {
    defaults.arrow_width = look.arrowFactor;
    defaults.arrow_head = true;
  }
  if (offeredKinds(look).length > 1) defaults.taper_hold = look.taperHold === true;
  return defaults;
}

/**
 * The look a request asks for: the authored one with the user's numbers over it.
 *
 * **Returns the look itself when nothing was said**, by identity rather than by value, so the
 * common path allocates nothing and a caller comparing looks sees the same object. That is the
 * renderer's own rule for a no-op knob one layer up -- a knob that does nothing must be *provably*
 * nothing, or a recorded picture stops being able to tell a real change from this one.
 *
 * A field the look does not offer is ignored rather than applied: the panel only ever writes the
 * fields `lookSettingControls()` produced, so anything else arrived from a hand-built request or a
 * document written against a different look, and silently growing a rail on a look that has none
 * would be the substitution this tree refuses everywhere.
 */
export function lookWithSettings(look, settings) {
  if (!look || !settings) return look;
  const defaults = lookSettingDefaults(look);
  const named = Object.entries(settings).filter(
    ([field, value]) => value !== undefined && defaults[field] !== undefined && value !== defaults[field],
  );
  if (named.length === 0) return look;
  const chosen = { ...defaults, ...Object.fromEntries(named) };
  const scale = chosen.size_scale;
  const profiles = {};
  for (const kind of statedKinds(look)) {
    const authored = look.profiles[kind];
    // A kind with no fields of its own (a nucleic look's loop) still takes the overall size.
    profiles[kind] = {
      ...authored,
      w: (chosen[`${kind}_width`] ?? authored.w) * scale,
      h: (chosen[`${kind}_thickness`] ?? authored.h) * scale,
      r: (chosen[`${kind}_edge`] ?? authored.r) * scale,
      /*
        A kind that never had a rail does not grow one: `rail` stays absent, which is what
        `sweep.js` reads to decide whether this kind lays a cord at all. A kind whose rail is
        authored at zero keeps its zero for the same reason -- `railedKinds()` offers no field for
        it, so `chosen` has none and the authored value is what carries through.
      */
      ...(look.profiles[kind].rail !== undefined
        ? { rail: (chosen[`${kind}_rail`] ?? look.profiles[kind].rail) * scale }
        : {}),
    };
  }
  const next = { ...look, profiles, taperHold: chosen.taper_hold ?? look.taperHold };
  if (look.helixRod !== undefined) next.helixRod = chosen.helix_rod_radius * scale;
  if (look.bases !== undefined) {
    next.baseThickness = chosen.base_thickness * scale;
    next.basePad = chosen.base_pad * scale;
    next.baseStem = chosen.base_stem * scale;
  }
  if (look.arrow && (look.arrowLength ?? 1) > 0) {
    next.arrow = chosen.arrow_head === true;
    next.arrowFactor = chosen.arrow_width;
  }
  return next;
}


/*
  ------------------------------------------------------------------------------------------------
  The repair: a slider may not reach a combination that will not build.
  ------------------------------------------------------------------------------------------------

  It exists because of the floors above: every cross-section axis floors at 0, so on a kind authored
  at `r: 0` one slider reaches `w + r = 0` and the scene stops building.
  The rule is `profile.js`'s and is **asked, never restated** -- `profileRefusal()` is the oracle
  here, so this file contributes which field to move and by how much and nothing about what is
  legal.

  **Minimum movement, and the field the user is holding moves last.** What they just set is what
  they asked for, so the repair raises a *partner*: a width taken to 0 raises that kind's edge
  radius by one of its own steps, and the same edge taken back to 0 raises whichever axis the rule
  is then short of. Raising is the only direction that can help -- every term in the rule grows with
  every axis.

  **The one corner where the changed field is the one that moves** is `w`, `h` and `r` all at 0:
  no other single field clears it (raising `w` alone leaves `h + r` at 0, and the other way round),
  so the edge is held at one step and the slider is seen to refuse zero. Two fields would be the
  alternative, and moving two of the user's numbers to honour a third is worse than one that holds.
*/

/** The value rounded onto its control's own grid, so a repaired box reads `0.14` and not `0.14000000000000001`. */
function snapToStep(value, step) {
  return Number(value.toFixed((String(step).split('.')[1] ?? '').length));
}

/** The fewest of this control's own steps that clear the refusal, or `undefined` if none do. */
function raisedToClear(axes, key, control, refused) {
  if (!control) return undefined;
  const [, , minimum, maximum, step] = control;
  const from = Math.max(axes[key], minimum);
  const steps = Math.ceil((maximum - from) / step);
  for (let count = 1; count <= steps; count += 1) {
    const value = snapToStep(Math.min(from + count * step, maximum), step);
    if (value > axes[key] && !refused({ ...axes, [key]: value })) return value;
  }
  return undefined;
}

/**
 * The fields this look has to move so `settings` can be built, and their new values.
 *
 * `{}` when nothing has to move, which is every authored look at its own defaults.
 * `changedField` is the one the user is holding and is the last thing this will touch.
 */
export function repairLookSettings(look, settings, changedField) {
  // A `panel: false` look places no ring (`sweep.js`), so its cross-section cannot be refused.
  if (!look || !settings || look.panel === false) return {};
  const controls = new Map(lookSettingControls(look).map((control) => [control[0], control]));
  const defaults = lookSettingDefaults(look);
  const moved = {};
  for (const kind of offeredKinds(look)) {
    const fields = KIND_AXES.map(([axis, key]) => [`${kind}_${axis}`, key]);
    const axes = {};
    for (const [field, key] of fields) axes[key] = settings[field] ?? defaults[field];
    // `size_scale` cannot reach this: it floors at 0.2, and a positive scale multiplies every term
    // of the rule alike.
    const refused = (candidate) => profileRefusal(
      candidate.w, candidate.h, candidate.r, look.sides ?? 0,
    ) !== '';
    if (!refused(axes)) continue;
    /*
      The edge radius first and the field the user is holding last. `r > 0` clears every form of
      the refusal -- both sums and a prism's circumradius -- so it is the axis that can always
      answer, and picking it rather than the first that happens to work makes the answer the same
      whichever kind the gesture was in. **That is what makes the repair idempotent**: a pass
      recomputes every kind, so a kind the gesture did not name would otherwise be re-answered with
      its width and take a zero the user set themselves. For the kind that *was* named the two
      orders agree on every input, because raising `w` cannot clear `h + r` and vice versa.
    */
    const rank = ([field, key]) => (field === changedField ? 2 : (key === 'r' ? 0 : 1));
    const order = fields.slice().sort((a, b) => rank(a) - rank(b));
    for (const [field, key] of order) {
      const raised = raisedToClear(axes, key, controls.get(field), refused);
      if (raised === undefined) continue;
      moved[field] = raised;
      axes[key] = raised;
      break;
    }
    // Nothing single-field clears it: the refusal stands rather than a guess at what the user meant.
  }
  return moved;
}
