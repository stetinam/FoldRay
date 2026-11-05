/*
  Each Style's own Improve image recipe: the finishing pass its session was saved with.

  WHY PER STYLE. One value for every Style -- `automaticPostProcessing()`, the panel's own Auto
  improve -- is the right answer for most of the ninety, because most of the sessions behind them
  were downloaded through Auto improve untouched. It is the wrong answer for forty of them, and
  wrong in a way that is invisible in the catalogue and obvious in the picture: `glass_tube` was
  composed at shadows -90 and sharpness 28, `bound_glow` and `cast_metal` at glow 24, `open_pocket`
  at saturation 40. Rendered through Auto improve, those Styles return a flat frame next to the tile
  that was clicked, and nothing says why.

  WHERE THE NUMBERS COME FROM, AND WHAT THAT IS WORTH HERE. Every one is the finishing pass read
  out of the saved session the Style was composed in, named in the entry's own comment.

  **Those sessions are not part of this repository, so the numbers are carried rather than
  derived.** They were chosen by eye against renders made by a different renderer under the same
  Filmic curve; this is a path tracer of its own. The tone map is not part of the gap -- Filmic
  is the default and is the curve these recipes were tuned under -- so what differs from their
  origin is the *renderer* alone.

  **What replaces the check is the bake, and it is a stronger check of a weaker thing.** The bake
  leaves the Style card's Improve image at its own default, which is on, so every one of the ninety
  tiles in `src/thumbs/style/` is a render made *through* `improveForStyle()` on this renderer. This
  file and the gallery therefore cannot disagree about what a Style looks like -- a wrong recipe
  shows as a wrong tile -- which is the whole promise the Improve image switch makes, and it holds
  by construction rather than by a diff against a session.

  What it cannot check is whether a number is *good*. That was looked at rather than assumed:
  contact sheets of all ninety baked through their own recipes turned up none spoiled by one, and
  the two largest recipes here -- `glass_tube` at total magnitude 175 and `open_pocket` at 148 --
  were rendered three ways, with no finishing pass, with Auto improve, and with their own. The pass
  reaches the picture and moves it the way the numbers say (`open_pocket`'s `saturation: 40` takes
  mean saturation 0.173 -> 0.236) and neither result is worse than Auto improve. **Re-authoring
  them by eye against this renderer is a real open question**, not one to answer here by inventing
  numbers -- which is what "ADDING ONE" below forbids, and it forbids it just as much when the
  inventor has a reason.

  WHAT IS NOT HERE, AND WHY THAT IS NOT A GAP. A Style absent from this table renders under
  `automaticPostProcessing()`, and `improveForStyle()` is where that happens. Fifty Styles are
  absent, in three groups:

    * the session's own recipe *is* Auto improve, to the digit -- most of the catalogue. Listing it
      would be forty lines saying nothing;
    * the session predates the Improve image panel and carries no `post_processing` at all
      (`capsid`, `dark_assembly`, the three `machine_*`, `chain_palette`, and the Concept row's
      hand-written `clay_model`, `jelly`, `crystal`). Nothing was lost that can be
      recovered: those figures never went through a finishing pass. Their tiles were rendered on a
      row baseline that carries Auto improve, so Auto improve is also what matches the tile;
    * the Style is a crossing of another Style onto a new subject and its tile was rendered and
      baked on the *destination* session, not the source. `rainbow_trace` is the only such entry
      whose source recipe was Auto improve anyway.

  THE EMISSIVE HALO. `fluorescent_glow`, `interface_glow_peptide`, `interface_glow_pocket`,
  `bound_glow`, `pocket_glow` and `open_pocket` carry `halo: 2`: each composes an
  emissive or bioluminescent material, and a source spills light past its own silhouette the way
  `cast_metal` and `bioluminescent` already say it does. Their sessions carry the same halo, so
  the table stays derived rather than hand-tuned.

  ADDING ONE. Read the session, copy its non-zero fields, and name the file in the comment. Do not
  invent a recipe: the point of the table is that every number in it was chosen by eye on a real
  render, and a hand-tuned entry with no session behind it is what this rule forbids. Nothing here
  can detect one; only the bake shows it.
*/

import { automaticPostProcessing, normalizePostProcessing } from '../post-processing.js';

/*
  Style id -> the non-zero fields of its session's Improve image recipe. Catalogue order.

  Omitted fields are zero; `improveForStyle()` normalizes each entry through
  `normalizePostProcessing()`, so a partial object here becomes the same complete, clamped,
  schema-stamped payload `restorePostProcessing()` takes from a loaded session.
*/
export const STYLE_IMPROVE = Object.freeze({
  // ---------- Small & detailed. The 1L2Y sessions, and the row that hand-tuned the most.
  // 1L2Y-TRP_cage_sticks
  sticks_trace: { highlights: 2, shadows: -20, contrast: 20, saturation: 12, sharpness: 5 },
  // 1L2Y-TRP_cage_tube_sticks_scheme2
  tube_side_chains: { shadows: -48, contrast: 9, saturation: 6, sharpness: 5, glow: 2 },
  /*
    1L2Y-TRP_cage_tube_scheme5, and the entry that makes the case for this whole file. A glass tube
    under Auto improve is a pale grey noodle: the shadows have to go to -90 before the envelope
    reads as thick, and sharpness 28 is what puts the caustics back that a softer render leaves
    smeared. A sibling composition was made at the same warmth and
    sharpness from the same sitting, which is the corroboration that these are the look and not one
    lucky drag of a slider.
  */
  glass_tube: {
    shadows: -90, contrast: 12, warmth: -29, saturation: 14, sharpness: 28, glow: 2,
  },
  // 1L2Y-TRP_cage_ball_sticks
  ball_and_stick_element: {
    highlights: -3, shadows: -43, contrast: 19, warmth: 2, saturation: 9, sharpness: 5, glow: 3,
  },
  // 1L2Y-TRP_cage_spheres
  sphere_pack: { shadows: -48, contrast: 9, saturation: 6, sharpness: 5, glow: 2 },

  // ---------- Monomers & domains. AF-P69905, one sitting.
  // AF-P69905-classic. The print recipe: sharpness 24 and a soft glow rather than added contrast.
  publication: { highlights: 3, shadows: -14, saturation: 5, sharpness: 24, glow: 10 },
  // AF-P69905-golden_hour. Glow 24 is most of what "golden hour" means here.
  golden_hour: { shadows: -3, contrast: 8, saturation: 6, sharpness: 9, glow: 24 },
  // AF-P69905-ghostsurface
  ghost_surface: {
    highlights: 11, shadows: -47, contrast: 11, warmth: -5, saturation: 11, sharpness: 10, glow: 13,
  },
  // AF-P69905_ball_sidechain_scheme5. Auto improve with the shadow lift dropped.
  sidechain_spheres: { highlights: 3, contrast: 9, saturation: 5, sharpness: 5 },
  // AF-P69905_stick_sidechain_glass_scheme6. Highlights -36 is the glass: the envelope blows out
  // white at 1024 samples and pulling the top end back is what returns its edges.
  sidechain_glass: {
    highlights: -36, shadows: -34, contrast: 20, saturation: 19, brightness: -6, sharpness: 17,
  },
  // AF-P69905_in_glass_ribbon_scheme7
  glass_ribbon: {
    highlights: -3, shadows: -17, contrast: 17, warmth: -2, saturation: 14, sharpness: 20,
  },
  // AF-P69905_in_glass2_scheme8
  in_glass: { shadows: -23, contrast: 14, warmth: 19, saturation: 17, sharpness: 20 },
  // P42212-GFP. A fluorophore is a source, so the pass darkens the body (brightness -6) and lets
  // glow 24 carry the light instead of raising exposure.
  fluorescent_glow: {
    shadows: -11, contrast: 5, saturation: 3, brightness: -6, sharpness: 12, tint: -2, glow: 24, halo: 2,
  },

  // ---------- Multimers. The 4HHB `_scheme<N>` copies carry the original's recipe.
  // 4HHB-publication_chains_scheme2. `publication`'s recipe, on four chains.
  publication_chains: { highlights: 3, shadows: -14, saturation: 5, sharpness: 24, glow: 10 },
  // 4HHB-surfacemultimer_scheme4
  chain_surface: { shadows: -34, contrast: 8, saturation: 5, sharpness: 6, glow: 3 },
  // 4HHB-spheres_scheme5
  chain_spheres: {
    highlights: 3, shadows: -8, contrast: 3, saturation: 12, sharpness: 5, glow: 5,
  },
  // 4HHB-ribbon_scheme6
  duo_ribbon: {
    shadows: -6, contrast: 8, warmth: 8, saturation: 12, sharpness: 12, glow: 11,
  },

  /*
    ---------- The interface Styles. None of the twelve can be derived (see the row's group comment
    in styles.js), so each takes the recipe of the `*-Interface` session it was written from, which
    is also the recipe its tile is baked through.

    `interface_bound` and `interface_ghost` are the exception worth naming: they are `bound_cartoon`
    and `ghost_ligand` crossed onto a chain partner, and they take **2GNS-Interface's** recipe
    rather than their source Styles' 7LCK ones. That is deliberate and it is what the tile shows --
    both were rendered on 2GNS through `2GNS-style-bound-partner` / `2GNS-style-ghosted-body` and
    baked with that session's pass. Carrying `ghost_ligand`'s saturation 29 across would have
    finished a picture that was never taken with it.
  */
  // 2GNS-Interface
  interface_bound: { highlights: 3, shadows: -8, contrast: 12, saturation: 11, sharpness: 5 },
  // 2GNS-Interface
  interface_ghost: { highlights: 3, shadows: -8, contrast: 12, saturation: 11, sharpness: 5 },
  // 2GNS-bound_glow. Saturation 36 is the whole reason an emissive peptide reads as coloured light
  // rather than as a white smear; glow 6 is deliberately low beside it.
  interface_glow_peptide: {
    shadows: -9, contrast: 8, saturation: 36, sharpness: 5, glow: 6, halo: 2,
  },
  // 2GNS-pocket_glow. The same pass as its pair, and the same session but for the layer it glows.
  interface_glow_pocket: {
    shadows: -9, contrast: 8, saturation: 36, sharpness: 5, glow: 6, halo: 2,
  },
  // 2GNS-Interface
  interface_peptide: { highlights: 3, shadows: -8, contrast: 12, saturation: 11, sharpness: 5 },
  // 2GNS-Interface
  interface_pocket: { highlights: 3, shadows: -8, contrast: 12, saturation: 11, sharpness: 5 },
  // 1N8Z-Interface
  interface_spheres: { shadows: -23, contrast: 6, saturation: 8, sharpness: 9, glow: 3 },
  // 1N8Z-Interface, its pair's session and therefore its pair's pass.
  interface_packed: { shadows: -23, contrast: 6, saturation: 8, sharpness: 9, glow: 3 },

  // ---------- Nucleic acids. 4R8P, one camera.
  // 4R8P-Render-2
  nucleosome: {
    highlights: 3, shadows: -8, contrast: 19, saturation: 16, sharpness: 5, glow: 1,
  },
  // 4R8P-Render-6
  nucleosome_sticks: {
    highlights: 3, shadows: -8, contrast: 19, saturation: 16, sharpness: 5, glow: 1,
  },

  // ---------- Ligands. The 7LCK sessions: the GLP-1 receptor and one agonist.
  // 7LCK-Render-16
  ghost_ligand: { highlights: 16, shadows: -42, contrast: 19, saturation: 29, sharpness: 5 },
  // 7LCK-Render-2. Glow 24 with the body pulled down two stops: the agonist is the only lit
  // thing in the frame, and Auto improve renders it as a brightly painted stick instead.
  bound_glow: {
    highlights: -5, shadows: -29, contrast: 9, saturation: 19, brightness: -2, sharpness: 5,
    glow: 24, halo: 2,
  },
  /*
    7LCK-Render-13, the session this Style is re-expressed from -- not 7LCK-Render-2, whose recipe
    the *tile* was baked with. The two disagree, and the entry in styles.js explains why the tile
    took the louder one: it is a 256px picture of a bioluminescent ligand and needed the glow.
    A full-size render does not, and what this Style was composed under is its own source's pass.
    The widened baseline the tile renders on carries this same recipe.
  */
  pocket_glow: {
    shadows: -19, contrast: 9, saturation: 14, sharpness: 5, glow: 12, halo: 2,
  },
  // 7LCK-Render-26. Saturation 40 and shadows -68 are how a cavity reads as a cavity: the pass is
  // doing the work a cut-open surface cannot do on its own.
  open_pocket: {
    exposure: 0.05, highlights: 3, shadows: -68, contrast: 5, warmth: -23, saturation: 40,
    sharpness: 5, glow: 2, halo: 2,
  },

  // ---------- Assemblies & machines. The two copies of 4HHB Styles keep their originals' passes.
  // 4HHB-surfacemultimer_scheme4, via `chain_surface`.
  assembly_chain_surface: { shadows: -34, contrast: 8, saturation: 5, sharpness: 6, glow: 3 },
  // 4HHB-spheres_scheme5, via `chain_spheres`.
  assembly_chain_spheres: {
    highlights: 3, shadows: -8, contrast: 3, saturation: 12, sharpness: 5, glow: 5,
  },

  /*
    ---------- Confidence & disorder. The pLDDT half's sessions, and the B-factor half held to them
    to the digit -- the same rule `flexibility_atoms` states in styles.js for every other value it
    copies. A B-factor sphere pack finished differently from its pLDDT twin would have made the
    finishing pass a second variable in a row whose whole design is that the ramp is the only one.
  */
  // AF-P05067-F1-model_v6-Render-11
  confidence_atoms: {
    highlights: 19, shadows: -6, contrast: 12, saturation: 11, sharpness: 5, glow: 7,
  },
  // AF-P05067-F1-model_v6-Render-8
  confidence_surface: {
    highlights: 19, shadows: -6, contrast: 12, saturation: 11, sharpness: 5, glow: 7,
  },
  // AF-P05067-F1-model_v6-Render-11, via `confidence_atoms`.
  flexibility_atoms: {
    highlights: 19, shadows: -6, contrast: 12, saturation: 11, sharpness: 5, glow: 7,
  },
  // AF-P05067-F1-model_v6-Render-8, via `confidence_surface`.
  flexibility_surface: {
    highlights: 19, shadows: -6, contrast: 12, saturation: 11, sharpness: 5, glow: 7,
  },

  // ---------- Concept.
  // 1L2Y-Render-8. Glow 24 and a halo of 3: struck metal throws light past its own edge, and the
  // halo is what puts that back.
  cast_metal: {
    shadows: -5, contrast: 14, saturation: 19, sharpness: 5, glow: 24, halo: 3,
  },
  // 1L2Y-chromeballs
  chrome_balls: { shadows: -48, contrast: 9, saturation: 6, sharpness: 5, glow: 2 },
  // GFP_P42212. Halo 37 beside glow 8: a self-lit ribbon in a dark field spills light well past
  // its own silhouette, and the halo is what carries that rather than a raised glow. Contrast 40
  // and saturation 50 are what keep the emissive teal from washing to white.
  bioluminescent: {
    contrast: 40, saturation: 50, sharpness: 5, glow: 8, halo: 37,
  },
});


/*
  The recipe to arm when a Style is applied with Improve image on.

  Always a complete payload, never a partial one: the Style options card arms this unconditionally
  on every apply (see `applyWithOptions()` in src/styles-strip.js), so a half-stated object
  here would leave the previous render's values on the fields it did not mention -- the same trap
  `STYLE_BASELINE` exists to close on the control allowlist.
*/
export function improveForStyle(styleId) {
  const recipe = STYLE_IMPROVE[styleId];
  if (!recipe) return automaticPostProcessing();
  return normalizePostProcessing(recipe);
}
