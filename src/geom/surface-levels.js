/*
  The surface ladder as *numbers*, with no renderer behind them.

  `geom/surface.js` builds a surface and needs six Mol\* entry points to do it -- the gaussian
  density, the molecular surface, marching cubes, `Mesh`, `PhysicalSizeTheme`, `SortedArray`. This
  file is the half of that module that is only a table and the four functions that read it, and it
  imports nothing at all.

  **The split is a page-weight one and it is measured.** `src/selection-model.js` wants three of
  these functions to derive the surface panel's controls, and `src/main.js` imports
  `selection-model.js` eagerly -- so without this file, opening the app pulls Mol\*'s
  **entire WebGL renderer** into the first-paint chunk to read a table of five numbers: the
  gaussian-density builder reaches `mol-math/geometry/gaussian-density/gpu.js`, which reaches
  `mol-gl/shader-code.js`, which brings 96 inlined GLSL fragment shaders and `mol-gl/renderable/*`
  with it.

  The measurement, from a build that stubbed each edge in turn: that edge alone is
  **1,500.1 -> 1,457.0 KiB** of eager JavaScript, and together with `main.js`'s own
  `mol-model/loci.js` import it is **1,500.1 -> 1,118.4 raw / 342.1 KiB gzipped** -- a third off
  what a first paint downloads. Neither edge alone moves much, which is exactly why this note names
  both.

  `geom/surface.js` re-exports every name below, so nothing that already imports from there has to
  move -- and `scene.js` should not, because it is behind `scene-pipeline.js`'s lazy seam already
  and wants the builder anyway.
*/

/** The two fields, named so a level says which one it is on rather than implying it by its props. */
export const GAUSSIAN = 'gaussian';
export const SOLVENT_EXCLUDED = 'ses';

/*
  The rungs, and every number on them chosen by eye in front of this renderer.

  Each rung carries three numbers -- a resolution, a breadth or a probe, and a smoothness. The
  **shape of the control** is a decision of its own: one picker, four levels, 1 broad and smooth
  through 4 open pockets.

  Each entry records what its number was chosen against, the way `profiles-catalog.js` does, because
  the provenance guard matches filenames and cannot see a scalar.

  The starting points are Mol*'s own defaults: `resolution` 1, `radiusOffset` 0, `smoothness` 1.5
  for the gaussian field; `probeRadius` 1.4, `resolution` 0.5 for the solvent-excluded one. Those
  are starting points and not the ladder.

  `smoothness` is the gaussian's falloff exponent and it is **the dial that decides how bubbly a
  gaussian rung looks**.

  The density is `sum over atoms of exp(-smoothness * d^2 / r^2)` and the isolevel is
  `exp(-smoothness)`, so an **isolated** atom's isosurface sits at exactly `r = vdw + radiusOffset`
  whatever `smoothness` is -- it cannot move a lone atom's radius at all. What it moves is how far
  a neighbour's density reaches, and therefore how much two atoms **sum into one body** rather than
  standing as two balls. Mol*'s own parameter description is the same fact in four words: *lower is
  smoother*.

  **It is not a substitute for `radiusOffset` and must not be moved on its own**, because the fusing
  is also what pushes the isosurface past any single atom's radius. Measured on 3RGK's protein at
  `resolution` 0.9: dropping 1.5 -> 0.7 at a fixed 0.8 offset takes the mean vertex standoff from
  3.04 A to 3.69 and the surface's radius of gyration from 19.64 A to past 20 -- the side chains
  fuse, and the fold and the heme pocket close over with them, which is level 1's own failure at
  `radiusOffset` 1.0 arriving by another road. The two move **together**: 1.0 with a 0.5 offset is
  19.41 A of gyration against 19.64 at 1.5 and 0.8, the same body with the knobs between the atoms
  filled in.

*/
export const SURFACE_LEVELS = {
  /*
    Level 1. The default, and the one 21 of the 90 Styles name.

    Broad and smooth: a body to light, not a surface to read a pocket off.

    **The offset and the smoothness are one decision and are taken together.** Breadth moves the
    isosurface **out**; it does not make two atoms into one shape, so pushing it alone makes the
    balls bigger rather than fewer, and at 1.0 the fold drowns. `smoothness` is the knob that fuses
    them (see the note above this table) and it inflates as it fuses -- so the pair moves together
    and the body stays the size it was: **1.5/0.8 -> 1.0/0.5**, radius of gyration 19.64 -> 19.41 A
    and mean vertex standoff 3.04 -> 2.91, chosen off four candidates rendered at 100 samples under
    `element`, where a bubbly surface -- a pile of balls rather than a body -- is visible. 0.8/0.3
    is the least bubbly of them and was passed over for changing the size.

    **The breadth is the `radiusOffset` and it is emphatically not the grid.** 0.8 A was where
    3RGK's side chains stopped reading as separate knobs and became lobes of one body, chosen
    against the two either side: at 0.6 the side chains are still individually countable, which is
    level 2's job, and at 1.0 the fold has gone -- the two lobes of the molecule merge and the heme
    pocket closes over. `resolution` 0.9 is the grid that renders it without facets at 768 px, and
    is 39 ms of field (`surface.js`'s table). **The grid is not part of that decision**: a coarse
    grid is faceted rather than broad, and none of this was ever about the sampling.
  */
  surface: {
    field: GAUSSIAN,
    resolution: 0.9,
    radiusOffset: 0.5,
    smoothness: 1.0,
    label: 'broad and smooth',
  },

  /*
    Level 2. The same read with more shape in it.

    Every side chain is its own lobe again and the fold is legible through the surface, which is
    what makes this a different picture rather than a higher-resolution version of level 1.

    **`radiusOffset` 0 is where the jaggedness comes from.** At offset 0 with Mol\*'s
    default smoothness the isosurface sits exactly on the
    **saddle** between two atoms that have barely merged -- the one place in a summed gaussian where
    the gradient nearly vanishes and its direction swings fastest. Marching cubes takes its vertex
    normals from that gradient, so two vertices a cell apart disagree by up to 122 degrees:
    measured on 3RGK, the angle between the normals of neighbouring vertices had a **p95 of 78.4
    degrees and a p99 of 122.2**, against level 1's 31.2 and 55.9. That is a hard crease once per
    cell, all over the surface, and no colour or shading change reaches it.

    A small offset lifts the isosurface off the saddle and a lower `smoothness` fills the saddle in
    by fusing the two atoms; both are needed and the grid then has something well-conditioned to
    sample. **0.15 / 1.0 / 0.6 puts this rung at level 1's own smoothness while carrying 2.4x the
    triangles** -- p95 31.7 and p99 55.9 against level 1's 31.2 and 55.9, 57,628 triangles against
    23,864. The offset stays far below level 1's 0.5, so the surface is still tight to the atoms and
    the fold still reads; what goes is the crease, not the relief.
  */
  surface_soft_pockets: {
    field: GAUSSIAN,
    resolution: 0.6,
    radiusOffset: 0.15,
    smoothness: 1.0,
    label: 'finer, with the fold showing through',
  },

  /*
    Level 3. The first rung where a cleft is a cleft.

    `probeRadius` 1.4 A is the water probe -- Lee & Richards 1971, and Mol*'s own default -- so this
    one is a published number rather than an authored one. The change from level 2 is visible and is
    exactly the one the ladder promises: the recesses between side chains stop being dimples and
    become shadowed clefts.

    **`resolution` is 0.5 rather than 0.6, and what it buys is normals rather than features.** The
    shape here is probe-limited and not grid-limited, so the coarser grid loses nothing of it --
    but marching cubes reads its vertex normal off the field gradient, and a coarser grid samples
    that gradient more coarsely whatever the shape is doing. Measured on 3RGK, the angle between
    neighbouring vertices' normals falls from a p95 of 32.7 degrees to 27.9 and a p99 of 41.9 to
    36.7, which is worth the 1.5x triangles (61,468 -> 89,260).

    A solvent-excluded rung has no saddle problem to fix -- a distance field's gradient is unit
    length almost everywhere, which is why level 2 needs its offset off 0 and this one only needs
    a finer grid.
  */
  surface_smooth_pockets: {
    field: SOLVENT_EXCLUDED,
    probeRadius: 1.4,
    resolution: 0.5,
    label: 'solvent-excluded, at the water probe',
  },
  /*
    Level 4. Ligand pockets and cavities.

    A smaller probe **and** a finer grid, because at this rung the two are the same decision: a
    0.9 A probe opens necks a 0.6 A grid cannot resolve, and a picture that opens a cleft and then
    aliases its walls is worse than one that never opened it.

    0.9 rather than smaller, and the smaller one was rendered rather than reasoned about. Probe 0.7
    at a 0.45 grid opens more, and it is also where the surface starts reading as **fused spheres**
    rather than as a molecular surface, because a probe well under an atomic radius stops being able
    to bridge anything. It costs 165k triangles against 120k for a difference that is mostly
    texture. 0.9 is the smallest probe that still draws a surface.

    **`resolution` is 0.4 rather than 0.5**, for the reason level 3's grid is 0.5 rather than 0.6,
    and on the rung that needs it most: this is the roughest surface in the ladder and it measured
    the roughest normals with it, a p95 of 39.2 degrees against level 3's 32.7. At 0.4 that is 32.3
    and the p99 falls from 55.3 to 44.8. It is the most expensive change in the ladder -- 120,416
    triangles to 188,756 and about half again the field time -- and it is spent rather than
    economised because a rung whose whole purpose is fine structure cannot be the one that looks
    creased.
  */
  surface_open_cavities: {
    field: SOLVENT_EXCLUDED,
    probeRadius: 0.9,
    resolution: 0.4,
    label: 'solvent-excluded, opening pockets and cavities',
  },
  /*
    Not a fifth rung.

    `surface_refined` is level 1 under another name, and the precedent is already in
    `capabilities.js`: `spheres_refined` and `spheres` are one representation there because
    "refined" means **mesh subdivision** and a ray-traced isosurface has none. The same argument
    applies here -- what a surface's detail *is* in this renderer is the grid and the probe, and
    those are what levels 1-4 already ladder. The id is kept API-compatible and out of the picker;
    keeping it resolvable is what lets an older document open here.

    Written out in full rather than spread from `surface`, so it can carry that argument; the two
    are held equal number by number.
  */
  surface_refined: {
    field: GAUSSIAN,
    resolution: 0.9,
    radiusOffset: 0.5,
    smoothness: 1.0,
    aliasOf: 'surface',
    label: 'broad and smooth',
  },

  /*
    The nucleic component's one surface choice, and it is **not** level 1's numbers.

    A duplex is read by its grooves, and a groove is not a pocket: it is broad, so a smaller probe
    does nothing for it while a fattened field closes it. Chosen against three renders of 1BNA
    under `nucleic_part` colour, where the bases in the major groove are yellow and either visible
    or not: at level 1's own 0.9/0.5 the backbone is a fat rope and the minor groove has closed
    over; at 1.0/0.2 the grooves are open and the coarser grid facets visibly on the turns.
    **0.8/0.2** is both -- 17,100 triangles, the backbone a clean helical ridge, both grooves
    open. The offset is 0.2 rather than 0 because at this grid a bare field draws the backbone
    phosphates as a string of separate beads.

    **The grid is 0.6 rather than 0.8 and the smoothness 1.2 rather than 1.5**, for level 2's
    reason and on the same measurement: on 1BNA at 0.8/1.5 the angle between neighbouring vertices'
    normals had a p95 of 33.6 degrees and a p99 of 49.6, and at 0.6/1.2 it is 22.3 and 33.5 for
    30,468 triangles against 17,100. **The offset stays at 0.2**, deliberately: it is the number
    the groove decision above was taken on, and moving it is the one change here that could close a
    groove. Smoothness fuses rather than fattens, so it is the safe half of the pair -- and the
    render was checked against the grooves rather than assumed.
  */
  nucleic_surface: {
    field: GAUSSIAN,
    resolution: 0.6,
    radiusOffset: 0.2,
    smoothness: 1.2,
    label: 'broad and smooth, with the grooves open',
  },

};

/** One rung, keyed the way `capabilities.js` is keyed. `undefined` for an id with no level. */
export function levelFor(representation) {
  return SURFACE_LEVELS[representation];
}


/*
  ------------------------------------------------------------------------------------------------
  The rungs as controls, derived from the rung rather than tabulated.
  ------------------------------------------------------------------------------------------------

  Built the same way `geom/profiles-catalog.js`'s look controls are, for the same two reasons: no
  second table of the numbers, and silence is bit-identical.

  **The field is what decides which controls exist, and that is the whole design of the ladder said
  again.** A gaussian rung has a `radiusOffset` and a solvent-excluded one has a `probeRadius`, and
  neither has the other -- the ladder crosses fields; it is not one dial turned four times.
  Offering a probe on level 1 would be a control that reached nothing, and offering breadth on level
  3 would be a control that reached the wrong thing: **a coarse grid is faceted, not broad**, as
  level 1's note says.

  `grid_resolution` is offered on both because both have one, and it is the one number here where
  *smaller is finer and slower*. Its floor is 0.4 rather than Mol*'s own 0.5, and its ceiling 1.4 --
  where level 1 renders flat polygonal patches across the silhouette, so the top of this range is a
  picture somebody has looked at and rejected. It is reachable because a fast preview of a large
  assembly is a legitimate thing to want; it is not the default of anything.
*/
export function levelSettingControls(level) {
  if (!level) return [];
  const controls = [['grid_resolution', 'Grid resolution', 0.4, 1.4, 0.05, false]];
  if (level.field === GAUSSIAN) {
    controls.push(['radius_offset', 'Breadth', 0, 2, 0.05, false]);
  } else {
    controls.push(['probe_radius', 'Probe radius', 0.4, 3, 0.05, false]);
  }
  return controls;
}

export function levelSettingDefaults(level) {
  if (!level) return undefined;
  const defaults = { grid_resolution: level.resolution };
  if (level.field === GAUSSIAN) defaults.radius_offset = level.radiusOffset;
  else defaults.probe_radius = level.probeRadius;
  return defaults;
}

/**
 * The rung a request asks for: the authored one with the user's numbers over it.
 *
 * Identity when nothing was said, exactly as `lookWithSettings()` is, so a request with no settings
 * builds from the authored object.
 */
export function levelWithSettings(level, settings) {
  if (!level || !settings) return level;
  const defaults = levelSettingDefaults(level);
  const named = Object.entries(settings).filter(
    ([field, value]) => value !== undefined && defaults[field] !== undefined && value !== defaults[field],
  );
  if (named.length === 0) return level;
  const chosen = { ...defaults, ...Object.fromEntries(named) };
  const next = { ...level, resolution: chosen.grid_resolution };
  if (level.field === GAUSSIAN) next.radiusOffset = chosen.radius_offset;
  else next.probeRadius = chosen.probe_radius;
  return next;
}
