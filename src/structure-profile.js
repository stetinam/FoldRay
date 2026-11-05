/*
  What the app knows about the loaded structure, as one small object.

  Everything here was already being computed and then thrown away. `collectStructureResidues()` in
  main.js walks every atom and every residue to fill the colour-category labels and
  `availableComponents`, and `detectStructureMetric()` has always answered "does this file carry
  pLDDT or B-factors". This module only names the answers and puts them in one place, so the
  recommender has something to read that is not the DOM.

  Pure on purpose: no Mol*, no controls, no imports. That is what lets the whole recommendation
  system be tested by handing it numbers, which matters more here than usual -- the rules are
  judgement calls about what suits what, and judgement calls need to be cheap to argue with.

  The thresholds are the only opinions in the file, and they are deliberately few and blunt. They
  answer two questions and no others: how big is this thing, and how lopsided are its chains. The
  weights that act on those answers live in `style-recommendations.js`, so a change of taste never
  reaches this file.
*/

/*
  The size ladder, in protein residues. Each boundary is a real change in what can be drawn, not a
  round number: a peptide is small enough that every atom is the picture, 150 residues is roughly a
  small domain (ubiquitin is 76, myoglobin 153) and the point above which a side-chain pass becomes
  a hairball, and 600 is where a single chain stops being a domain and starts being a machine.
*/
export const PEPTIDE_RESIDUE_LIMIT = 40;
export const DETAIL_RESIDUE_LIMIT = 150;
export const MEDIUM_RESIDUE_LIMIT = 600;

/*
  Above either of these, per-chain cartoons stop reading as chains and start reading as noise, and a
  surface is the honest picture. A capsid is 60+ chains, a ribosome ~80, a proteasome 28; an
  antibody complex is 6. The residue count is the second door into the same room: a two-chain
  structure of 4000 residues is an assembly whatever its chain count says.
*/
export const ASSEMBLY_CHAIN_COUNT = 12;
export const ASSEMBLY_RESIDUE_COUNT = 2500;


function plural(count, noun) {
  return `${count.toLocaleString('en')} ${noun}${count === 1 ? '' : 's'}`;
}


/**
 * Summarise a loaded structure. Every input is a plain count, so this never touches a viewer.
 *
 * `proteinChainResidues` is one residue count per protein chain, in any order. It is what tells a
 * bound peptide apart from a second copy of the protein, which is the whole difference between the
 * two halves of the Interfaces row -- and it is the one fact the old profile threw away.
 *
 * Sizes only, never chain ids: which chain is the smallest is main.js's answer, not this file's.
 */
export function structureProfile({
  proteinChains = 0,
  nucleicChains = 0,
  proteinResidues = 0,
  nucleicResidues = 0,
  ligandResidues = 0,
  ionResidues = 0,
  proteinChainResidues = [],
  metric,
} = {}) {
  const hasNucleic = nucleicResidues > 0;
  const hasLigand = ligandResidues > 0;
  const hasIon = ionResidues > 0;
  const loaded = proteinResidues + nucleicResidues + ligandResidues + ionResidues > 0;

  /*
    The sides a scoped duo Style paints, derived from the same rules `resolveOverlayScope()` in
    main.js applies, so what the profile calls a partner is what the Style would draw as one.
    `partnerResidues` is everything outside the largest chain, which is the domain half's partner;
    `smallestChainResidues` is the one chain the peptide half draws atom by atom.

    All three stay 0 when no per-chain counts were handed in. That is deliberate: a partner of 0
    residues is not a peptide, so an incomplete profile recommends no interface at all rather than
    guessing one from the total.
  */
  const chainSizes = [...proteinChainResidues].filter((count) => count > 0);
  const largestChainResidues = chainSizes.length > 0 ? Math.max(...chainSizes) : 0;
  const smallestChainResidues = chainSizes.length > 1 ? Math.min(...chainSizes) : 0;
  const partnerResidues = chainSizes.length > 0
    ? chainSizes.reduce((total, count) => total + count, 0) - largestChainResidues
    : 0;

  /*
    How big the protein is, used by the weights and by nothing else. Deliberately about the protein
    alone: a monomer with a bound DNA duplex is still a monomer to frame and light, and what the
    nucleic acid changes is which *pool* is eligible, not this.
  */
  let sizeClass = 'none';
  if (proteinResidues > 0) {
    if (proteinResidues <= PEPTIDE_RESIDUE_LIMIT) sizeClass = 'peptide';
    else if (proteinResidues <= DETAIL_RESIDUE_LIMIT) sizeClass = 'small';
    else if (proteinResidues <= MEDIUM_RESIDUE_LIMIT) sizeClass = 'medium';
    else sizeClass = 'large';
  }

  return {
    proteinChains,
    nucleicChains,
    proteinResidues,
    nucleicResidues,
    ligandResidues,
    ionResidues,
    largestChainResidues,
    smallestChainResidues,
    partnerResidues,
    metric,
    predicted: metric === 'plddt',
    hasNucleic,
    hasLigand,
    hasIon,
    loaded,
    sizeClass,
    isAssembly: proteinChains >= ASSEMBLY_CHAIN_COUNT
      || proteinResidues >= ASSEMBLY_RESIDUE_COUNT,
  };
}


/*
  The facts, in the words the "Why these?" panel shows them in.

  Naming what was read is what makes a recommendation auditable instead of magic, and it is the part
  that will still be worth having after the rules themselves are rewritten. It reports absences too
  -- "no ligands or ions" -- because a rule that did *not* fire is as much a part of the explanation
  as one that did, and a silent absence reads as an oversight.
*/
export function profileFacts(profile) {
  if (!profile.loaded) return ['No structure loaded'];
  const facts = [];
  if (profile.proteinChains > 0) {
    facts.push(`${plural(profile.proteinChains, 'protein chain')} · ${plural(profile.proteinResidues, 'residue')}`);
  }
  if (profile.hasNucleic) {
    facts.push(`${plural(profile.nucleicChains, 'nucleic acid chain')} · ${plural(profile.nucleicResidues, 'nucleotide')}`);
  }
  const extras = [];
  if (profile.hasLigand) extras.push(plural(profile.ligandResidues, 'ligand'));
  if (profile.hasIon) extras.push(plural(profile.ionResidues, 'ion'));
  facts.push(extras.length > 0 ? extras.join(' · ') : 'No ligands or ions');
  if (profile.metric === 'plddt') facts.push('pLDDT confidence values present');
  else if (profile.metric === 'bfactor') facts.push('B-factors present');
  else facts.push('No confidence or B-factor column');
  return facts;
}
