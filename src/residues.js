/*
  Which residues are what, and which atoms are backbone.

  Two of these three are the product's own and the third is Mol*'s -- and the split is the point,
  because "Mol* answers this too" is not on its own a reason to take Mol*'s answer.

  - `classifyResidue()` sorts a residue into the five component groups the **product** has --
    protein, nucleic, ligand, ion, water. Those groups are the request's own vocabulary
    (`nucleic_style`, `ligand_style`, `ion_style`, `water_style`, `component_type` on a selection
    layer). They are not a chemical taxonomy, and Mol*'s `MoleculeType` is not a drop-in for them:
    it has no notion of "ion" as a component at all.

    **`water` is a component and not solvent that gets dropped**, so the group carries a
    `water_style`, a picker and a `component_type` like the other four. What is *not* part of it is
    the framing and the gradient scope -- `main.js`'s bounding spheres and `scene.js`'s colour
    source exclude water by name, because a solvent box that sets the camera distance and flattens
    every positional ramp is the defect below, and drawing water is a separate question from
    measuring over it.
  - `groupResidues()` builds the ordered residue records every geometry pass walks.
  - `isSideChainOrAlphaCarbon()` **is Mol*'s.** The obvious rule of one's own is `is_side_chain or
    is_alpha_carbon` -- everything but the amide N and carbonyl C/O -- and this is not that. It rests
    on Mol*'s own `ProteinBackboneAtoms` (20 names) and `NucleicBackboneAtoms` (33). It is a
    four-atom-name distinction every viewer makes, so taking Mol*'s costs nothing and owes nothing.

  **Mol*'s set is not the four-name rule, deliberately.** It carries the backbone hydrogens (`H`,
  `H1`, `H2`, `H3`, `HA`, `HN`, `HXT`) and the alternative terminal oxygens (`O1`, `O2`, `OC1`,
  `OT1`, ...), none of which a four-name rule catches. So a side-chain representation drawn here
  excludes `HA` and every terminal-oxygen spelling, where a four-name rule draws them. That is the
  better answer and it is a visible difference.

  **Ions and water are Mol*'s `IonNames` (209) and `WaterNames` (11)**, which are in the bundle
  already. A short hand-written set gets four names wrong, each of them drawing a plausible
  picture:

  - **`SOL`, `TIP3` and `D3O` are water.** Missed, they fall through to `ligand`, so a GROMACS or
    CHARMM-derived file draws its whole solvent box as ligands -- and worse than drawn, *framed*:
    `main.js`'s bounding sphere and `scene.js`'s gradient ranges both exclude water by name, so
    thousands of waters set the camera distance and flatten every positional ramp over the
    molecule.
  - **`IOD` is an ion**: iodide, the standard heavy atom for phasing.
  - **`SO4` and `PO4` are one kind of thing**: two tetrahedral oxyanions of the same shape, which a
    set naming one and not the other draws two different ways, for no reason a viewer could learn.
  - **`I` is inosine, not an ion.** Iodide is `IOD`, and Mol* does not call `I` an ion.

  **Mol* does not miss the oxidation-state spellings -- `FE3`, `CU2` -- because the PDB does not
  spell them that way.** Measured against the chemical component dictionary on 2026-09-19: `FE`
  *is* iron(III) ("FE (III) ION") and `FE2` is iron(II);
  `CU` is copper(II), `CU1` copper(I), `CU3` copper(III). `CU2` and `V2` are not dictionary ids at
  all. `FE3` is 4-(2-aminoethyl)-3-chlorobenzoic acid, `CR3` a C20 benzenolate, `HG2` dibromomercury,
  `CO2` carbon dioxide, and `AS` and `SC` are DNA-linking nucleotide analogues -- so `IonNames`
  (209 names, Mol* 5.4.2) excludes every one of them **correctly**, and a supplement set of those
  spellings would draw a 13-atom organic acid as thirteen markers with its bonds stripped. An
  oxidation state that does have an id of its own carries a numeric **prefix**: `3NI`, `4MO`,
  `6MO`.

  **The monoatomic narrowing below refuses them anyway, and that is what two guards are for.**
  `FE3`, `CR3`, `HG2` and `CO2` all hold more than one atom, so `atomCount === 1` rejects them
  whatever a name set says.

  What is genuinely outside `IonNames` is the dictionary's single-**atom** entries -- `SE`, `TE`,
  `MO`, `GD`, `HO`, `RH`, `RE` -- which Mol* leaves out because the dictionary calls them atoms
  rather than ions. Whether a free heavy atom should take the marker path is a product question
  rather than a name to add here.

  **The ion component is narrowed to monoatomic residues, which the name sets alone cannot do.**
  Mol*'s `IonNames` is a chemical answer and includes the polyatomic oxyanions -- `SO4`, `PO4`,
  `CO3`, `NO3`, `ACT`, `BF4`. The product's ion component is not a chemical class, it is a **marker**
  style: `ion_spheres` and `ion_faceted` draw one shape per atom and no bonds at all, so a sulfate on
  that path is five loose beads rather than a sulfate, and one faceted marker per atom is five gems.
  `IonNames` verbatim would make that worse rather than better, since it names the oxyanions as
  ions. So an ion is *a name Mol\* calls an ion **and** a residue with one atom in it*, and
  everything polyatomic falls to `ligand` and gets bonds.

  The atom count is a fact about the residue rather than a second table, which is why it is an
  argument here rather than a set: `groupResidues()` counts the residue first and classifies it
  after.

  **Nucleic is Mol*'s `moleculeType`, not a name set.** A set of the ten standard names -- the four
  bases each with and without a `D` -- misses **14 of 76 nucleotides** on `1EHZ` (yeast
  tRNA-Phe): `PSU`, `5MC` x2, `1MA`, `7MG`, `H2U` x2, `2MG`, `M2G`, `OMC`, `OMG`, `5MU`, `YYG`.
  Every one of them is a modified base, which is what a tRNA is *made of*.

  **The failure is not that they draw wrongly; it is that two files disagree about what a
  nucleotide is.** Missed, they fall to `ligand`, so `ligand_style` draws them -- while `sweep.js`,
  which reads `isNucleic(v.moleculeType)` off Mol*, still walks all 76 and marks those fourteen
  `drawn = false`. The sweep caps its mesh at an undrawn residue, so the ribbon comes apart into
  fifteen pieces with fourteen CPK ball-and-stick fragments sitting in the gaps. That is
  *one `Structure`, one answer* failing, and it is why `classifyResidue()` asks Mol* rather than a
  longer set: it takes the residue's `moleculeType`, the same derived array the sweep reads.

  **No name set as a fallback either, and that is measured rather than assumed.** The obvious
  worry is a file with no `chem_comp` records, where `getMoleculeType` has nothing to look up. It
  does not arise. Mol* falls back to `getComponentType`, whose `BaseNames` (18) is a strict superset
  of the ten -- and for a PDB file `ComponentBuilder.getType()` infers the type from the **atom
  names present in the residue** (`RnaAtomIdsList` / `DnaAtomIdsList`), which is stronger than any
  name set can be. Measured both ways: `1EHZ.cif` and `1EHZ.pdb` both give 76 of 76. So such a set
  cannot catch a residue Mol* misses; it would be a table that only ever agrees.

  **Protein is Mol*'s `moleculeType` too, and 1FWJ is the file that shows why.** A set spelling
  eight modified residues (`MSE`, `SEC`, `PYL`, `HYP`, `CSO`, `SEP`, `TPO`, `PTR`) sends everything
  else modified to `ligand`, exactly as with the modified bases. 1FWJ's three copies of `KCX` 217
  -- carboxylated lysine, `HETATM`, `MoleculeType.Protein`, in the `polymer` entity -- are the 1EHZ
  failure in the component every cartoon draws: classified `ligand` while the sweep walks them,
  **chain C's ribbon is cut at 217 in three copies** and the sequence strip carries 217 as a hetero
  chip in `C · other` with a hole where it belongs in the chain. The branch is
  `isProtein(moleculeType)`, which is the same question the nucleic branch beside it asks.

  **A residue moving between `protein` and `ligand` moves what the polymer sweep draws, so the two
  answers were measured side by side.** Over a 36-file corpus -- 110,841 residues -- the name set
  and `moleculeType` differ on **three residues in all of it**, and they are 1FWJ's three `KCX`.
  The five recorded subjects (`3RGK`, `1BNA`, `beta-sheet`, `ions`, `modified-rna`) move **none**,
  confirmed a second way by a scene-buffer A/B: sphere, cylinder, triangle and vertex buffers
  hashed across four colour modes each, 20 builds, byte-identical. 1FWJ itself goes 2,298 -> 2,301
  protein residues, 3 -> 0 ligands and 3,289,032 -> 3,293,064 triangles.

  **No name set as a fallback here either, by the same test -- where the case comes out
  stronger.** Measured in all three ways a file can say what a component is, generating each name
  as the middle residue of a peptide: a deposited mmCIF stating `_chem_comp.type` resolves 31 of
  31; a PDB, where `ComponentBuilder.getType()` infers from the **atom names present in the residue**
  (`ProteinAtomIdsList` is CA, C, N), resolves 31 of 31; an mmCIF carrying no `chem_comp` resolves
  28, leaving `ASX`, `GLX` and `CSO`. So unlike the nucleic case there *is* an input a set catches
  and Mol\* does not -- and **what it catches them into is the finding**. Mol\* gives all three
  `MoleculeType.Other`, hence `PolymerType.NA`, hence **no polymer trace**, so as `protein` they are
  a component the sweep cannot draw one triangle of. Such a set does not catch a residue Mol\*
  misses; it disagrees with Mol\*, which is the defect rather than the cure. And Mol\* resolves, in
  all three formats, names such a set does not spell: `PCA` (pyroglutamate, a common N-terminal
  cap), `DAL` and `DPN`.

  **And both polymer branches are gated on the entity, because neither a name nor a molecule type
  can say whether a residue is in a chain.** 3ECA is E. coli L-asparaginase II and
  the thing in its four active sites is `ASP` -- free L-aspartate, the reaction product, nine atoms,
  `HETATM`, its own `non-polymer` entity. Ungated, it takes the protein branch, so the substrate is
  `protein`: the sequence strip draws it as a **327th chip on chain A's polymer row**, labelled `D`
  and numbered 401, and the structure has no ligand component at all. The picture is worse than the
  label -- the four aspartates are their own Mol\* units with `polymerElements = 0`, and `sweep.js`
  skips a unit with none, so under every cartoon and every ribbon the substrate **draws nothing
  whatsoever** while being counted as protein by the framing, the gradient scope and the component
  shortcuts.

  **The discriminator is `_entity.type` and the trap is what it must not break.** A modified polymer
  residue is `HETATM` *and* part of the chain -- `MSE` is the canonical one -- so the group is not
  the test, and reordering on it would tear every selenomethionine out of every protein.
  Mol\*'s own `Ligand` query asks the entity column, in
  `mol-plugin-state/helpers/structure-selection-query.js`, and so does this. Measured over 32
  structures -- 1AYM's 413,760-atom capsid and both
  formats of 1EHZ included -- it moves **four residues in the whole corpus**, and they are 3ECA's
  four aspartates. 1EHZ's fourteen modified bases are `HETATM` in a `polymer` entity and do not
  move; nor does a hand-made PDB's mid-chain `MSE`. On the same corpus `entity === 'polymer'` and
  "Mol\* gives this residue a polymer trace" agree on **every residue of every file** -- 110,723
  residues, 0 disagreements -- which is the *one `Structure`, one answer* property the 1EHZ case
  above loses, measured rather than hoped for.

  **What that measurement is not.** It is a property of *this corpus*, not of Mol\* -- the `.pdb`
  paragraph below is the case the corpus does not carry.

  **The stronger claim is one file short of holding.** That claim is that our own `protein`/`nucleic`
  components are exactly the residues Mol\* traces. Walked over the whole corpus it has **one
  disagreement in 110,841 residues**: the hand-made PDB's free `ASP` (classified `protein`,
  untraced), which is exactly the `.pdb` case further down and is open for the reason given
  there. A protein name set would add 1FWJ's three `KCX` (classified `ligand`, traced), all in the
  direction of a component the sweep draws nothing for.

  **It is a negative test (`!== 'non-polymer'`) and that is the fail-closed half.** A PDB file
  declares no entities, so Mol*'s `EntityBuilder` infers them from the molecule type and keys a
  polymer by chain -- which puts a free `ASP` in the *polymer* entity and leaves it `protein`.
  `polymer`, `water`, `branched`, `macrolide`, an empty column and a type nobody has heard of all
  reach the polymer branches as though this rule were not there; only a residue a file **states**
  is outside every polymer is moved.

  **And the gate has to hold on the last line too.** A fall-through of
  `group === 'HETATM' ? 'ligand' : 'protein'` lets an `ATOM` record reach `protein` however the
  file has declared its entity -- the gate above it decides nothing for one. No file in the corpus
  hits it, because every one of them writes its hetero groups as `HETATM`. An **all-ATOM export is
  the shape that does**, and it is the same file class the `SOL`/`TIP3` paragraph above is about:
  measured on a hand-made PDB whose `PC1` head group is an `ATOM` record, Mol\*'s `EntityBuilder`
  puts it in a `non-polymer` entity (it is not a polymer molecule type) and without `!inPolymer` it
  comes back `protein` -- drawn as protein, framed as protein, traced as nothing, which is 3ECA's
  failure arriving by the one door the gate would otherwise leave open. It moves nothing in the
  corpus.

  **Water is two questions for the same reason.** Mol\*'s own water component --
  `Queries.internal.water()`, which is what `preview.setWaterVisible()` hides -- tests **only**
  `entity.type`. Testing only `WaterNames` here, a residue a file puts in a water entity under a
  solvent name Mol\* does not list would be hidden in the preview and drawn in the trace, and worse
  than drawn: `frameStructureCamera()` and `buildColorSource()` exclude water *by component*, so it
  would set the camera distance and flatten every positional ramp. So either question alone answers
  yes. The corpus carries the disagreement **0 times in either direction**, so this is inert on the
  corpus and is a rule rather than a repair. It is not symmetrical and that is not hidden: a
  residue Mol\* names water in a non-water entity is still ours and not the preview's.

  **Fail-closed is not the same as harmless here, and the difference has to be said.** On a `.pdb`
  the free aspartate is still `protein` while Mol* still gives it no polymer trace, so under every
  cartoon and every ribbon it still draws nothing -- the defect survives, on the one path the file
  cannot answer for. Measured on a hand-made PDB carrying a free amino acid as a ligand. The reach
  is bounded: an accession is downloaded as `.cif`
  (`pdb-source.js`), so this is an uploaded `.pdb` only. **Open question, not an oversight** -- the
  honest discriminator on that path is Mol*'s own polymer trace, which `structure.js` has and this
  function is not handed.
*/

import {
  ProteinBackboneAtoms, NucleicBackboneAtoms, WaterNames, isNucleic, isProtein,
} from 'molstar/lib/mol-model/structure/model/types.js';
// Not re-exported by `types.js`, which imports it from here itself.
import { IonNames } from 'molstar/lib/mol-model/structure/model/types/ions.js';

/**
 * Which component group a residue belongs to.
 *
 * `atomCount` is the number of atoms in *this* residue and is what separates a monoatomic ion from
 * a polyatomic one; there is no useful default for it, because a missing count would silently send
 * every ion to `ligand`. `groupResidues()` is the caller and it always has one.
 *
 * `moleculeType` is Mol*'s, carried on every atom by `structure.js`, and both polymer branches are
 * it -- see the header for why neither is a name set.
 *
 * `entityType` is the file's own `_entity.type`, and it is what makes those branches true rather
 * than usually true.
 *
 * Water is tested first, and the overlap it settles is `W`: Martini's water bead **and** the PDB's
 * code for tungsten. Mol*'s own `getMoleculeType` resolves it the same way round, so this follows
 * it rather than inventing a third answer.
 */
export function classifyResidue(name, group, atomCount, moleculeType, entityType) {
  const upper = name.toUpperCase();
  // Two questions, because Mol* asks two: `Queries.internal.water()` -- the component the preview
  // hides -- reads only the entity column, and the name set is what a file declaring no entity can
  // be read by. Either alone leaves the other's answer drawn *and framed* as a ligand.
  if (entityType === 'water' || WaterNames.has(upper)) return 'water';
  // A molecule type says what a residue is made of; the entity says whether it is part of a chain.
  // Only a residue the file puts outside every polymer is taken off the polymer branches, so an
  // entity type this does not recognise -- or a file that declares none -- classifies by molecule
  // type alone.
  const inPolymer = entityType !== 'non-polymer';
  if (inPolymer && isProtein(moleculeType)) return 'protein';
  if (inPolymer && isNucleic(moleculeType)) return 'nucleic';
  // The record type is not asked, for the same reason the fall-through below does not ask it
  // alone: an all-ATOM export writes its ions as ATOM, and the two questions that decide an ion
  // -- Mol* spells the name, and the residue has one atom -- are both answered without it.
  if (atomCount === 1 && IonNames.has(upper)) return 'ion';
  // `ATOM` is not a claim to be polymer. An all-ATOM export writes its lipids and hetero groups as
  // ATOM too, so without `!inPolymer` here the gate reaches nothing for them and they come back
  // `protein` -- drawn as protein, framed as protein, and traced as nothing.
  return group === 'HETATM' || !inPolymer ? 'ligand' : 'protein';
}

/**
 * Mol*'s backbone sets, read as "side chain, or the alpha carbon".
 *
 * `ProteinBackboneAtoms` contains `CA`, so the alpha carbon is added back by name: that is what
 * makes the function's name true, and it is the whole difference between this and "side chain".
 * A ligand or an ion has no backbone, so every one of its atoms is kept.
 *
 * **Proline's `N` is added back with it, and it is not a courtesy to a special case.** Proline is
 * the one residue whose side chain runs *through* the backbone nitrogen: `CD` bonds to `N`, not to
 * anything else, so a set that keeps the ring and drops the atom closing it draws four fifths of a
 * pyrrolidine with `CD` hanging free. Measured on 3INS B28 -- the ring came back open in all five
 * `side_chain_*` looks, which reads as a modelling error rather than as a scope, and it is the
 * failure mode this tree calls a plausible picture. It is **Mol*'s own answer** rather than ours:
 * `sidechainWithTrace` in `mol-plugin-state/helpers/structure-selection-query.js` is exactly this
 * predicate, and its third clause is `auth_comp_id == 'PRO' && label_atom_id == 'N'`. Taking two of
 * its three clauses and leaving the third would make this a partial copy of a table rather than a
 * reading of it. `auth_comp_id` is what `residueName` carries (`structure.js`), so the two ask the
 * same column. The nucleic branch's trace atom is `P` by the same query; no nucleic representation
 * is `sideChainOnly`, so that clause has nothing here to be true of and is not written.
 */
export function isSideChainOrAlphaCarbon(atom, component) {
  if (component === 'protein') {
    return atom.name === 'CA'
      || (atom.name === 'N' && atom.residueName === 'PRO')
      || !ProteinBackboneAtoms.has(atom.name);
  }
  if (component === 'nucleic') return !NucleicBackboneAtoms.has(atom.name);
  return true;
}

/**
 * Group the flat atom array into ordered residues, keeping first-seen order.
 *
 * **Classification is a second pass, and it has to be**: `classifyResidue()` asks how many atoms
 * the residue has, and that is not known until every atom has been seen. Doing it on the first
 * atom can only ever see a count of one, which would call every sulfate a monoatomic ion and defeat
 * the narrowing entirely.
 *
 * **A residue is Mol*'s residue: the key is the unit and `residueIndex`, never the author
 * numbering.** Mol* starts a residue segment wherever the sequence id or insertion code changes, so
 * in an mmCIF a number that recurs non-adjacently in one chain is two residues to Mol*. Keyed on
 * the author numbers instead, the second copy's atoms join the first's record and the sweep, which
 * finds a residue by its first atom's `residueIndex`, never visits it, with nothing noted. Measured
 * on hand-made mmCIFs: 3RGK's residues 1-40 twice in one chain come back as 40 residues and half
 * the cartoon; waters numbered 9998, 9999, 0, 1, 9998, 9999 in one asym draw four dots of six; `NA`
 * numbered 1, 2, 3, 1 in four asyms of one author chain makes a two-atom ligand.
 *
 * **A `.pdb` is not changed by this, and the difference is Mol*'s.** A PDB file has no
 * `label_seq_id`, so Mol* substitutes the author number and sorts each chain by it before
 * segmenting: the same three files as `.pdb` are one segment per repeated number, holding every
 * copy, and so one residue here -- which is also what the preview draws.
 *
 * **The unit is what makes a symmetry copy its own residue.** `residueIndex` belongs to the model,
 * so an expanded assembly's N copies of chain A residue 12 share it; without the unit they collapse
 * into one residue holding N times the atoms -- 10EC's portal ring draws one subunit's ribbon
 * inside twelve subunits of spheres, and a monoatomic ion in an N-fold assembly has N atoms and
 * stops being an ion.
 *
 * **Alternate locations and microheterogeneity stay one residue, because Mol*'s segmentation keeps
 * them together**: `findHierarchyOffsets()` does not test `label_alt_id` or `label_comp_id`, and
 * the atom site is bucketed by `label_seq_id` within a polymer chain before it is segmented.
 * `chooseConformers()` in `structure.js` picks per the same key, so 1EJG's PRO/SER 22 is one
 * residue of whichever conformer wins.
 *
 * The author identifiers still travel on the record, and they are what a selection layer and the
 * sequence strip name, so two residues sharing a number are one chip and one layer entry -- as they
 * are in Mol*'s own selection.
 */
export function groupResidues(atoms) {
  const residues = [];
  const index = new Map();
  /*
    The key string is `residue.key` downstream, so it has to be built -- but built once per *atom*
    it is thrown away for all but the first atom of each residue: 58,870 strings on 1AON where
    8,029 are wanted. The atoms of one residue arrive together out of `readAtoms()`, so the previous
    atom's residue is reused whenever both key components are `===` to that atom's. Anything that
    differs falls through to the `Map`. Together with the `byName` loop below, 12.6 ms -> 8.3 ms on
    1AON, floor of nine.
  */
  let previousAtom = null;
  let previousResidue = null;
  for (const atom of atoms) {
    if (previousAtom !== null
      && atom.unitId === previousAtom.unitId
      && atom.residueIndex === previousAtom.residueIndex) {
      previousAtom = atom;
      previousResidue.atoms.push(atom);
      previousResidue.atomIndices.push(atom.index);
      continue;
    }
    const key = `${atom.unitId}|${atom.residueIndex}`;
    let residue = index.get(key);
    if (!residue) {
      residue = {
        key,
        chainId: atom.chainId,
        // Which symmetry copy. `chainId` repeats once per copy in an expanded assembly, so
        // anything that means "along this chain" has to be told which one (`sequenceFactors()`).
        symmetryId: atom.symmetryId,
        residueId: atom.residueId,
        labelSeqId: atom.labelSeqId,
        insertionCode: atom.insertionCode,
        name: atom.residueName,
        group: atom.group,
        moleculeType: atom.moleculeType,
        // Whether the file puts this residue in a polymer. `classifyResidue()` is the only reader.
        entityType: atom.entityType,
        component: null,
        atoms: [],
        atomIndices: [],
      };
      index.set(key, residue);
      residues.push(residue);
    }
    residue.atoms.push(atom);
    residue.atomIndices.push(atom.index);
    previousAtom = atom;
    previousResidue = residue;
  }
  for (const residue of residues) {
    residue.component = classifyResidue(
      residue.name, residue.group, residue.atoms.length, residue.moleculeType, residue.entityType,
    );
    /*
      **A ligand that is chemically an ion, marked rather than reclassified.**

      `classifyResidue()` calls a residue an `ion` only when Mol* names it one *and* it has a single
      atom, which is the narrowing that keeps a sulfate off the marker path -- five loose beads, and
      five gems once a marker has facets. That is right, and it leaves SO4, PO4, CO3, NO3, ACT and
      BF4 in the ligand bucket, where 3RGK's three sulfates sit beside its heme and read as three
      more ligands.

      So this is a **second fact about the same residue** rather than a fifth component: which
      bucket it is drawn in does not move, and `ligand_style.hide_polyatomic_ions` is a filter the
      user can switch on when the crystallisation buffer is not what the picture is about. Computed
      here because the atom count is only known once every atom has been seen -- the same reason
      the classification itself is a second pass.
    */
    residue.polyatomicIon = residue.component === 'ligand'
      && residue.atoms.length > 1
      && IonNames.has(residue.name.toUpperCase());
    /*
      Not `new Map(residue.atoms.map((atom) => [atom.name, atom]))`: that builds one two-element
      array per atom -- 58,870 of them on 1AON -- to hand a constructor that sets them in that same
      order and lets a later duplicate name win, which is what the loop does directly. It joins this
      pass rather than keeping its own, and `byName` is assigned after `polyatomicIon`, which keeps
      the records' property order stable.
    */
    const byName = new Map();
    for (const atom of residue.atoms) byName.set(atom.name, atom);
    residue.byName = byName;
  }
  return residues;
}
