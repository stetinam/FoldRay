/*
  Which Styles to put in front of someone, given what they just loaded.

  This is the only structure-aware part of the whole Styles feature, and keeping it the only one is
  the design. The category rows never gate: every tile in the gallery is always clickable, because a
  by-chain look on a monomer is one colour rather than an error, and `applyStyleWrites()` already
  skips a colour mode the structure does not offer. All the "what suits this" judgement lives here.

  IT IS A WEIGHTED SAMPLE, NOT AN ORDER. The table below is a set of pools, each with a weight that
  reads the profile, a cap, and a flag for the ones that must appear at all. A structure with pLDDT
  gets a confidence look guaranteed and a good chance of a second; a 90-residue monomer gets Small &
  detailed guaranteed and up to five of them; a capsid can never be offered a peptide interface. The
  rest is drawn at random from what is left, so the same file gives a different nine next time --
  which is what makes `Randomize styles` an answer rather than a refresh.

  An ordered first-fire table taking the head of each row would leave ~40 of the 90 Styles unable to
  appear and give one file the same nine every time. What the sampling costs instead is
  explicability: there is no sentence per pick, and the panel shows what was *read* from the
  structure rather than an argument for the result.

  Pools contribute members, not ids. Adding a Style to `src/catalog/styles.js` on the right row
  therefore makes it recommendable with no edit here, which is what keeps the catalogue a one-file
  change.
*/

import { stylePool } from './catalog/styles.js';
import { DETAIL_RESIDUE_LIMIT, PEPTIDE_RESIDUE_LIMIT } from './structure-profile.js';

/*
  The row holds ten slots. Nine are recommendations and the tenth is `Randomize styles`, which
  resamples -- so the offer to see other answers costs a tile rather than a row of chrome, and the
  row's width never changes.

  Nine rather than seven because the pools outnumber the slots on most real files: a multimer with a
  ligand and a metal centre has eight pools eligible at once, and at seven the sample would spend
  every slot on a guarantee and have none left to be interesting with.
*/
export const RECOMMENDED_LIMIT = 10;
export const RECOMMENDED_COUNT = RECOMMENDED_LIMIT - 1;

/*
  Above `DETAIL_TAPER_LIMIT` residues a side-chain pass is a hairball, but between the small-protein
  line and it the picture is merely busy rather than useless -- so Small & detailed thins out there
  instead of disappearing.

  `PARTNER_RESIDUE_LIMIT` is the largest partner that still reads drawn atom by atom. The Interfaces
  row's own notes put a 79-residue peptide inside it and a 41-atom ligand outside, so the line sits
  where a chain stops being a peptide rather than where sticks stop rendering.
*/
export const DETAIL_TAPER_LIMIT = 300;
export const PARTNER_RESIDUE_LIMIT = 150;

/*
  How much a pool's weight drops each time it is drawn from. Without it the heaviest pool takes
  every free slot before a lighter one is reached; at 0.55 a pool of weight 8 still leads, offers a
  second, and is roughly level with a pool of weight 3 by its third.
*/
const POOL_DECAY = 0.55;
/*
  What a Style shown in the previous sample is worth in the next one. Not zero: `Randomize styles`
  should feel like a different answer, not like a ban on the best one, and on a structure with only
  six eligible Styles a ban would leave the row half empty.
*/
const RECENT_WEIGHT = 0.25;
/*
  Slots the guaranteed pass may not touch, so a file that satisfies five guarantees at once still
  has room for something unasked for.
*/
const FREE_SLOTS = 2;


/*
  The table. Order matters only for the guaranteed pass -- it is the order the must-appear pools
  claim their slot in, so the fact that most defines the structure claims first.

  `weight` returning 0 means ineligible, and is the only eligibility test a pool has. `guaranteed`
  is the answer to "would the row be wrong without one of these", which is a stricter question than
  "does this suit": B-factors are on nearly every deposited file, so Disorder is offered rather than
  promised, while a bound ligand is the reason the file was opened.

  Caps are sized so the eligible pools comfortably outnumber the row's nine slots. A pool set whose
  caps only just cover the row is not a sample -- everything eligible is taken whatever its weight,
  and a medium single-chain protein, with three eligible pools, is exactly that case.
*/
export const STYLE_POOLS = [
  {
    /*
      Leads everything, because pLDDT is the one fact that changes what the picture *means* rather
      than what it looks like: a predicted model coloured uniformly throws away the confidence data
      it came with, and someone who has just loaded an AlphaFold file has almost always come to look
      at exactly that. Weight 8 against a cap of 3 is what makes a second one likely and a third
      possible without the row becoming four ramps.
    */
    id: 'predicted',
    weight: (profile) => (profile.metric === 'plddt' ? 8 : 0),
    guaranteed: (profile) => profile.metric === 'plddt',
    max: 3,
  },
  {
    // A protein/DNA complex is a picture *of* the complex, so the pool that colours the nucleic acid
    // separately outranks everything about the protein's shape.
    id: 'nucleic',
    weight: (profile) => (profile.hasNucleic ? 8 : 0),
    guaranteed: (profile) => profile.hasNucleic,
    max: 3,
  },
  {
    // The one pool with a hard door. A capsid look on a 200-residue monomer renders a smooth blob
    // at a lens meant for something 50 times the size, which is why medium and small structures may
    // not be offered one at any weight.
    id: 'assemblies',
    weight: (profile) => (profile.isAssembly ? 7 : 0),
    guaranteed: (profile) => profile.isAssembly,
    max: 4,
  },
  {
    // Not suppressed by nucleic acid: a protein/DNA complex with an inhibitor in it is a file
    // where both pools have something to say, and the row has ten slots.
    id: 'ligands',
    weight: (profile) => (profile.hasLigand ? 6 : 0),
    guaranteed: (profile) => profile.hasLigand,
    max: 3,
  },
  {
    /*
      Cap 5: on something small enough to draw every atom, the side-chain looks *are* the answer,
      and offering five of them is the recommendation rather than a flood.
    */
    id: 'detailed',
    weight: (profile) => {
      if (profile.proteinResidues === 0) return 0;
      if (profile.proteinResidues <= DETAIL_RESIDUE_LIMIT) return 6;
      return profile.proteinResidues <= DETAIL_TAPER_LIMIT ? 3 : 0;
    },
    guaranteed: (profile) => profile.proteinResidues > 0
      && profile.proteinResidues <= DETAIL_RESIDUE_LIMIT,
    max: 5,
  },
  {
    /*
      Telling the chains apart is the point of a multimer's picture, and the weight drops in the two
      cases where it is less so: on an assembly a surface has taken over, and on a peptide complex
      one "chain" is a 2% speck, so a by-chain palette is one big colour and a dot. Neither closes
      the pool -- both are still true pictures of what is there.
    */
    id: 'multimers_chain',
    weight: (profile) => {
      if (profile.proteinChains < 2) return 0;
      if (profile.isAssembly) return 3;
      const peptidePartner = profile.partnerResidues > 0
        && profile.partnerResidues <= PEPTIDE_RESIDUE_LIMIT;
      return peptidePartner ? 3 : 6;
    },
    guaranteed: (profile) => profile.proteinChains >= 2 && !profile.isAssembly,
    max: 4,
  },
  {
    // Its partner is drawn atom by atom, so it needs a partner small enough for that to read. The
    // partner is the smallest chain and only that chain, which is exactly what the Style paints.
    id: 'interfaces_peptide',
    weight: (profile) => {
      if (profile.proteinChains < 2 || profile.smallestChainResidues === 0) return 0;
      if (profile.smallestChainResidues <= PEPTIDE_RESIDUE_LIMIT) return 6;
      return profile.smallestChainResidues <= PARTNER_RESIDUE_LIMIT ? 4 : 0;
    },
    guaranteed: () => false,
    max: 4,
  },
  {
    /*
      Its partner is a cartoon or a ribbon, which reads at any size, so this half needs only that
      there be a second chain -- three chains and up are as much an interface as two, and the pool
      stays open until the structure is an assembly, where "the largest chain and everything else"
      stops describing anything.
    */
    id: 'interfaces_domain',
    weight: (profile) => {
      if (profile.proteinChains < 2 || profile.isAssembly) return 0;
      return profile.proteinChains <= 4 ? 5 : 3;
    },
    guaranteed: () => false,
    max: 4,
  },
  {
    // The general-purpose overviews, and the only pool eligible for every protein. It thins as the
    // structure grows because a single uniform colour says less the more chains there are.
    id: 'monomers',
    weight: (profile) => {
      if (profile.proteinResidues === 0) return 0;
      if (profile.isAssembly) return 1;
      return profile.proteinChains >= 2 ? 2 : 5;
    },
    guaranteed: (profile) => profile.proteinChains === 1,
    max: 7,
  },
  {
    // A 14 mm lens down a structure works at every size, so the wide-angle four are eligible
    // wherever there is a protein -- including the monomer they are filed one shelf away from.
    id: 'wide',
    weight: (profile) => (profile.proteinResidues > 0 ? 3 : 0),
    guaranteed: () => false,
    max: 3,
  },
  {
    // One atom. The pool differs in how the *body* around the ion is drawn rather than in how the
    // ion is, so one is an offer and two would be the same picture twice -- and a ligand in the same
    // file is the bigger subject.
    id: 'ions',
    weight: (profile) => {
      if (!profile.hasIon) return 0;
      return profile.hasLigand ? 1.5 : 3;
    },
    guaranteed: () => false,
    max: 1,
  },
  {
    /*
      Its pLDDT twin leads the table and this one closes it, and the asymmetry is the whole
      judgement. `metric === 'plddt'` marks a file someone loaded *to look at the confidence*; almost
      every deposited structure carries a B-factor column, so at any real weight this would lead the
      row on every crystal structure in the world. Here it is what it is: a specific analysis worth
      offering once, sometimes twice.
    */
    id: 'disorder',
    weight: (profile) => (profile.metric === 'bfactor' ? 2 : 0),
    guaranteed: () => false,
    max: 2,
  },
];


/*
  Whether a Style is worth *recommending* for this structure -- never whether it can be applied.
  Clicking any tile always works; `requires` only keeps a look off the Recommended row when the data
  behind it is absent, which is the one case where the tile would be actively misleading: pLDDT
  colouring over a crystal structure paints confidence bands from refined B-factors and means
  nothing at all.
*/
export function styleSuits(style, profile) {
  switch (style.requires) {
    case 'plddt': return profile.metric === 'plddt';
    case 'bfactor': return profile.metric === 'bfactor';
    case 'metric': return profile.metric !== undefined;
    case 'nucleic': return profile.hasNucleic;
    case 'ligand': return profile.hasLigand;
    case 'ion': return profile.hasIon;
    case 'chains': return profile.proteinChains >= 2;
    default: return true;
  }
}


// One draw from a weighted list. `random` is injected so a test can pin an outcome and the app can
// stay unseeded.
function weightedPick(items, weightOf, random) {
  const total = items.reduce((sum, item) => sum + weightOf(item), 0);
  if (total <= 0) return items[0];
  let ticket = random() * total;
  for (const item of items) {
    ticket -= weightOf(item);
    if (ticket < 0) return item;
  }
  return items[items.length - 1];
}


/**
 * The Recommended row: up to nine Style ids, sampled.
 *
 * @param {object} profile from `structureProfile()`
 * @param {object[]} catalog `STYLE_CATALOG`
 * @param {{limit?: number, random?: () => number, recent?: string[]}} options
 *   `recent` is the previous sample, whose members are drawn against so a resample reads as a
 *   different answer.
 * @returns {string[]}
 */
export function recommendStyles(profile, catalog, options = {}) {
  const { limit = RECOMMENDED_COUNT, random = Math.random, recent = [] } = options;
  if (!profile?.loaded) return [];

  const recentIds = new Set(recent);
  const chosen = [];
  const pools = STYLE_POOLS
    .map((pool) => ({
      pool,
      weight: pool.weight(profile),
      taken: 0,
      styles: catalog.filter(
        (style) => stylePool(style) === pool.id && styleSuits(style, profile),
      ),
    }))
    .filter((entry) => entry.weight > 0 && entry.styles.length > 0);

  const draw = (entry) => {
    const options_ = entry.styles.filter((style) => !chosen.includes(style.id));
    if (options_.length === 0) return false;
    const pick = weightedPick(
      options_,
      (style) => (recentIds.has(style.id) ? RECENT_WEIGHT : 1),
      random,
    );
    chosen.push(pick.id);
    entry.taken += 1;
    entry.weight *= POOL_DECAY;
    return true;
  };

  // The must-appears first, in table order, and never into the last two slots.
  pools.forEach((entry) => {
    if (chosen.length >= limit - FREE_SLOTS) return;
    if (!entry.pool.guaranteed(profile)) return;
    draw(entry);
  });

  // Then the sample.
  while (chosen.length < limit) {
    const spare = (entry) => entry.styles.some((style) => !chosen.includes(style.id));
    let open = pools.filter((entry) => entry.taken < entry.pool.max && spare(entry));
    /*
      Caps shape a full row; they must not leave a short one. A bare DNA duplex is eligible for one
      pool, and stopping at its cap of three would leave four empty slots beside four Styles that
      suit the file perfectly well.
    */
    if (open.length === 0) open = pools.filter(spare);
    if (open.length === 0) break;
    if (!draw(weightedPick(open, (entry) => entry.weight, random))) break;
  }

  return chosen;
}
