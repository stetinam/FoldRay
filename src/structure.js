/*
  The structure file, read once into one Mol* `Structure`.

  **One `Structure`, and building it here is the one design decision this file exists for.** Reading
  `_atom_site` straight out of a `CifFrame` into flat atom records would never build a `Structure` at
  all. Bonds come from `unit.bonds` / `structure.interUnitBonds` and secondary structure from
  `SecondaryStructureProvider`, and both require one. A private extraction beside them would give the
  app **two answers to "what atoms are there"** -- one from an `_atom_site` walk and
  one from Mol*'s model builder -- differing on altlocs, on element assignment and on residue
  identity, with nothing reporting the disagreement.

  So: the `Structure` is built here, once, and everything downstream is a projection of it.
  `atoms` is a flat array in `structure.units` order; `residues` groups that array; `bonds` indexes
  into it. Nothing else in this tree may parse a structure file.

  The *reading* is `CIF.parseText`, `parsePDB` + `pdbToMmCif`, and `chooseFormat()`'s two-format
  decision. `.pdb` is not a special case -- it becomes the same `CifFrame` the mmCIF reader
  produces, carrying `auth_asym_id`, `auth_seq_id`, `pdbx_PDB_ins_code` and `pdbx_PDB_model_num`,
  which are the identifiers everything downstream is keyed on.

  Three questions this file answers for itself:

  - **The alt-loc filter.** A filter that simply keeps `.`/`?`/blank/`A` is not what runs here. The
    answer is **our own**: one conformer per residue, the one whose
    atoms carry the highest occupancy, ties broken by the order the file lists them
    (`chooseConformers()` below) -- drawing three overlapping copies of a side chain is a picture of
    a molecule that does not exist. On 3RGK the two rules happen to agree exactly, 1,317 atoms of
    1,347, because all 27 of its alternate groups are 50/50 ties in which the first listed is `A`;
    on a structure with unequal occupancies they would not, and ours is the one that means
    something.
  - **Entity numbering.** No rule of our own computes it: `label_entity_id` is Mol*'s own answer to
    the question and is what the `entity` colour mode reads here.
  - **The van der Waals table.** There is none. `StructureProperties.atom.vdw_radius` covers every
    element, is the same number the Mol* canvas sizes a spacefill with, and needs no second table to
    keep current.

  Coarse-grained models are refused rather than half-read: `Unit.isAtomic` is the gate, and a
  structure with no atomic unit throws. The coarse path is not exercised,
  and a silent empty picture is the failure mode this tree is least willing to ship.

  **The atom array is a projection and not the whole element set, so it says so.** `elementCount`
  is what Mol* has and `atoms.length` is what we draw, and `enumerateBonds()` reports `total` beside
  `count` for the same reason: the proof that each of Mol*'s bonds is counted exactly once has to
  survive the filtering, or the filter becomes a place a double-count can hide.
*/

import { quotedValue } from './display-text.js';
import { CIF } from 'molstar/lib/mol-io/reader/cif.js';
import { parsePDB } from 'molstar/lib/mol-io/reader/pdb/parser.js';
import { pdbToMmCif } from 'molstar/lib/mol-model-formats/structure/pdb/to-cif.js';
import { trajectoryFromMmCIF } from 'molstar/lib/mol-model-formats/structure/mmcif.js';
import { Structure, StructureSymmetry, StructureElement, StructureProperties, Unit } from 'molstar/lib/mol-model/structure.js';
import { Task } from 'molstar/lib/mol-task/index.js';

import { groupResidues } from './residues.js';
import { detectStructureMetric } from './structure-metrics.js';

/*
  One accessor, and it is where the CIF null tokens are handled.

  Mol*'s `CifField.str()` already maps both `.` and `?` to `''`, and a column absent from the file
  is either a missing field or one with `isDefined === false` (`pdbToMmCif` emits the second for
  `label_seq_id` when the file carries no insertion codes). Collapsing all four cases to `undefined`
  is what lets the pLDDT reader below read as a `?? fallback` chain rather than a null test per
  column.
*/
function text(field, row) {
  if (!field || !field.isDefined) return undefined;
  const value = field.str(row);
  return value === '' ? undefined : value;
}

/** The block the atoms are in. Files here have one, but "the first block with atoms" is what a
    linear scan amounts to, so it is what this does. */
function atomBlock(file) {
  return file.blocks.find((block) => block.categories.atom_site) ?? file.blocks[0];
}

/**
 * `.cif` or `.pdb`, decided by the filename and sniffed only when that fails.
 *
 * The extension is authoritative on every path a user can reach. The sniff exists for the paths
 * that are not a user: a saved session carries whatever `filename` was recorded with it, and a
 * harness may hand over a request it assembled. PDB is the fallback only when the text has no
 * `data_` header and does have a coordinate record, so an unrecognised extension on an mmCIF still
 * reads as mmCIF.
 */
export function chooseFormat(source, filename) {
  const extension = String(filename ?? '').toLowerCase().split('.').pop();
  if (extension === 'pdb') return 'pdb';
  if (extension === 'cif' || extension === 'mmcif') return 'cif';
  if (/^data_/m.test(source)) return 'cif';
  if (/^(ATOM {2}|HETATM)/m.test(source)) return 'pdb';
  return 'cif';
}

async function readFrame(source, filename) {
  const format = chooseFormat(source, filename);
  if (format === 'pdb') {
    const parsed = await parsePDB(source, filename ?? 'structure.pdb').run();
    if (parsed.isError) throw new Error(`the PDB file could not be read: ${parsed.message}`);
    return { format, frame: await pdbToMmCif(parsed.result), file: undefined };
  }
  const parsed = await CIF.parseText(source).run();
  if (parsed.isError) throw new Error(`the mmCIF file could not be read: ${parsed.message}`);
  return { format, frame: atomBlock(parsed.result), file: parsed.result };
}

/**
 * The biological assemblies the file offers, read off its own `pdbx_struct_assembly` category.
 *
 * Read from the `CifFrame` rather than through `ModelSymmetry.Provider`, and that is not a
 * preference. Importing `mol-model-formats/structure/property/symmetry.js` -- statically or
 * dynamically -- breaks the page in the browser: Vite pre-bundles Mol* into one optimized chunk in
 * which `mmcif.js` reads `ModelSymmetry.Provider` at module scope before the symmetry module has
 * finished evaluating, and it throws `Cannot read properties of undefined (reading 'Provider')`
 * before anything renders. Node's resolver orders the cycle the other way, so a headless check
 * passes and the app does not. The category is the file's own answer anyway.
 */
function assembliesIn(frame) {
  const category = frame?.categories?.pdbx_struct_assembly;
  if (!category || !category.rowCount) return [];
  const id = category.getField('id');
  const details = category.getField('details');
  const count = category.getField('oligomeric_count');
  return Array.from({ length: category.rowCount }, (_, row) => ({
    id: String(id?.str(row) ?? row + 1),
    details: details?.str(row) || null,
    oligomericCount: count?.str(row) || null,
  }));
}

/**
 * The molecule a file means when nobody has said: **its first biological assembly, or the
 * asymmetric unit when it declares none.**
 *
 * **The asymmetric unit is the wrong default.** It is a statement about the deposition rather than
 * about the molecule, and it is not what Mol*'s own viewer shows: Mol*'s default hierarchy preset
 * displays the first assembly when the file supplies operators, which is the behaviour a viewer is
 * compared against.
 *
 * **The measurement.** Of the fourteen structures this tree and its gallery stand on, assembly 1
 * differs from the asymmetric unit for five, and every one of the five is a picture the asymmetric
 * unit cannot draw at all: 1AYM 6,896 atoms -> **413,760** (the complete
 * icosahedral capsid), 10EC 1,824 -> **21,888** (the twelve-fold portal ring), 8PWW 8,968/4 chains
 * -> 4,600/2, 9HAF 6,427/6 -> 2,200/2, 3INS 1,893/4 -> 865/2. The other nine -- 3RGK, 1BNA, 1UBQ,
 * 3ECA, 6M0J, 1AOI, 1AON, 1CLL, 4HHB -- build byte-identically either way.
 */
export function defaultAssembly(assemblies) {
  return assemblies[0]?.id ?? null;
}

/**
 * The first model of the trajectory, as one `Structure`.
 *
 * `getFrameAtIndex(0)` is the model filter: a multi-model NMR ensemble or a trajectory renders its
 * first frame, which is what a `pdbx_PDB_model_num == 1` filter means. Mol* keeps
 * the rest of the trajectory available for anything that wants it.
 *
 * **Three values and they are three different questions.** `undefined` is "whichever molecule this
 * file means", answered by `defaultAssembly()`; **`null` is the asymmetric unit, asked for** --
 * everything the file deposits, which is what `Structure.ofModel()` gives; and a string names one
 * assembly and is refused rather than substituted if the file has no such id. Collapsing the first
 * two makes the assembly a control nothing can reach: read as `options.assembly ?? null`, "say
 * nothing" and "give me the deposition" are one value.
 */
async function buildStructure(frame, file, assembly) {
  const trajectory = await trajectoryFromMmCIF(frame, file).run();
  if (trajectory.frameCount === 0) throw new Error('the structure contains no atom records');
  const model = await Task.resolveInContext(trajectory.getFrameAtIndex(0));
  const assemblies = assembliesIn(frame);

  const asymmetricUnit = Structure.ofModel(model);
  const chosen = assembly === undefined ? defaultAssembly(assemblies) : assembly;
  if (chosen === null) {
    return { model, structure: asymmetricUnit, frameCount: trajectory.frameCount, assemblies, assembly: null };
  }

  const wanted = String(chosen);
  if (!assemblies.some((one) => one.id === wanted)) {
    // Refuse rather than substitute. Falling back to the asymmetric unit here would
    // render a different molecule than the one asked for and say nothing about it.
    throw new Error(
      `this structure has no biological assembly ${quotedValue(wanted)}.`
      + (assemblies.length
        ? ` It offers: ${assemblies.map((one) => one.id).join(', ')}.`
        : ' It declares none, so only the asymmetric unit can be drawn.'),
    );
  }
  const built = await StructureSymmetry.buildAssembly(asymmetricUnit, wanted).run();
  return { model, structure: built, frameCount: trajectory.frameCount, assemblies, assembly: wanted };
}

/*
  The flat atom record, read off the `Structure` rather than off `_atom_site`.

  Every field is consumed downstream and three of them decide more than they look like they do:

  - `index` is this atom's position in the returned array and is what `bonds` refers to. It is
    written here rather than inferred by a caller because the bond arrays are built in the same
    walk.
  - `unitId` / `elementIndex` are the atom's address *back into the `Structure`*, which is what lets
    `secondary-structure.js` answer per-residue questions about our own residue list rather than
    about a second one it walks itself.
  - `symmetryId` is **which copy** of the molecule this is, and it exists because `chainId` cannot
    say: an author chain id repeats once per copy in an expanded biological assembly.
  - `moleculeType` is Mol*'s classification of the residue, carried here for the same reason:
    `residues.js` decides the nucleic component from it rather than from a name set of its own, so
    the component router and the polymer sweep cannot disagree about what a nucleotide is.
  - `entityType` is the file's own `_entity.type`, one of Mol*'s six `EntityType` names --
    `unknown`, `polymer`, `non-polymer`, `macrolide`, `water`, `branched` -- and **lowercased by
    Mol\***, because the column is `Aliased(lstr)`, which is what lets `residues.js` compare it
    against a literal. It is the only thing that says whether a residue is *part of a chain*, which
    a residue name cannot: 3ECA's bound aspartate is spelled `ASP` and is the reaction product
    sitting in the active site. `residues.js` is where it decides a component.
  - `chainId` and `residueId` prefer the **author** identifiers, because those are what a person
    types and what a selection layer will name. `groupResidues()` keys on `unitId` and
    `residueIndex` instead: an author number can recur in one chain, a Mol* residue cannot.
*/
function readAtoms(structure) {
  const location = StructureElement.Location.create(structure);
  const P = StructureProperties;
  const atoms = [];
  for (const unit of structure.units) {
    if (!Unit.isAtomic(unit)) continue;
    location.unit = unit;
    /*
      Which symmetry copy this unit is, read once per unit rather than once per atom -- it is a
      property of the operator that built the unit, and 1AYM's capsid has 413,760 atoms.

      **`chainId` alone cannot say.** An author chain id is unique within a deposition and repeats
      once per copy in an expanded assembly, so anything that means "along this chain" has to be
      told which copy: without it `sequenceFactors()` runs one N-to-C ramp across all twelve of
      10EC's portal subunits, which is a rainbow across the ring where the picture wants the same
      rainbow twelve times. On an asymmetric unit every unit carries one operator, so this changes
      nothing there.
    */
    const symmetryId = unit.conformation.operator.name;
    /*
      **Nine of the twenty-four fields belong to the residue or to its chain, not to the atom**,
      so they are read once a residue rather than once an atom.

      That is a fact about Mol* rather than a guess about the file:
      `mol-model/structure/structure/properties.js` indexes `group_PDB`, `auth_seq_id`,
      `label_seq_id` and `pdbx_PDB_ins_code` through `unit.residueIndex[element]`, and
      `auth_asym_id`, `label_asym_id` and `label_entity_id` through `unit.chainIndex[element]` --
      and a residue lies inside exactly one chain, so all seven are constant for as long as
      `residueIndex` is. `moleculeType` is the same derived array keyed the same way.

      `entity.type` joins them by the same argument -- `eK()` reaches its row through that same
      `chainIndex` -- so it is an eighth read per residue and the counts below, which measure the
      hoisting itself, do not include it.

      **"A residue lies inside exactly one chain" is the load-bearing half of all four chain
      columns, and it is Mol*'s own segmentation rather than a property of well-formed files**:
      `findHierarchyOffsets()` sets `newResidue = newChain || ...`, so a chain can never start
      inside a residue. It was measured (11,572 atoms over 2,026 residues on
      3RGK + 3ECA) because the cost of it being false is silent -- the first atoms of a chain would
      carry the previous chain's answers.

      Measured on 1AON (58,870 atoms, 8,029 residues): **29.4 ms -> 19.2 ms**, floor of nine
      parses. Seventeen `StructureProperties` calls per atom become ten per atom and seven per
      residue -- 1,000,790 calls down to 644,903, and five of the seven that move (`group_PDB`,
      the two chain ids, the entity id, the insertion code) are ones that return a string.

      **`auth_comp_id` is deliberately not in that set, and that is the trap this could have walked
      into.** It is an *atom* column in Mol* -- `atomicHierarchy.atoms.auth_comp_id`, not
      `.residues` -- which is exactly what `hasMicroheterogeneity()` next to it exists for: one
      residue index can carry two component names across its alternate locations. Hoisting it would
      give every atom of such a residue the first conformer's name, silently, which is this tree's
      recurring defect shape rather than a speed-up.

      The cache is declared inside the unit loop, so a symmetry copy re-reads rather than inheriting
      the previous unit's answers for the same `residueIndex`.
    */
    const moleculeTypes = unit.model.atomicHierarchy.derived.residue.moleculeType;
    const elements = unit.elements;
    let cachedResidueIndex = -1;
    // Mol*'s own answer to "what kind of molecule is this residue", read off the derived array
    // because `StructureProperties.residue` exposes no accessor for it. It is the same array
    // `sweep.js` reads through the trace iterator's `element.moleculeType`, which is the point:
    // `residues.js` answers the nucleic question from it rather than from a name set of its own.
    let moleculeType;
    let group;
    let chainId;
    let labelChainId;
    let entityId;
    let entityType;
    let residueId;
    let labelSeqId;
    let insertionCode;
    for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
      const element = elements[elementIndex];
      location.element = element;
      const residueIndex = unit.residueIndex[element];
      if (residueIndex !== cachedResidueIndex) {
        cachedResidueIndex = residueIndex;
        moleculeType = moleculeTypes[residueIndex];
        group = P.residue.group_PDB(location) || 'ATOM';
        chainId = P.chain.auth_asym_id(location) || P.chain.label_asym_id(location) || 'A';
        labelChainId = P.chain.label_asym_id(location) || 'A';
        entityId = P.chain.label_entity_id(location) || P.chain.auth_asym_id(location);
        entityType = P.entity.type(location);
        residueId = P.residue.auth_seq_id(location);
        const seqId = P.residue.label_seq_id(location);
        labelSeqId = seqId >= 0 ? seqId : null;
        insertionCode = P.residue.pdbx_PDB_ins_code(location) || '';
      }
      atoms.push({
        index: atoms.length,
        residueIndex,
        moleculeType,
        occupancy: P.atom.occupancy(location),
        unitId: unit.id,
        symmetryId,
        elementIndex,
        group,
        element: (P.atom.type_symbol(location) || 'C').toUpperCase(),
        name: P.atom.auth_atom_id(location) || P.atom.label_atom_id(location) || '',
        altLoc: P.atom.label_alt_id(location) || '',
        residueName: (P.atom.auth_comp_id(location) || 'UNK').toUpperCase(),
        chainId,
        labelChainId,
        entityId,
        entityType,
        residueId,
        labelSeqId,
        insertionCode,
        x: P.atom.x(location),
        y: P.atom.y(location),
        z: P.atom.z(location),
        bFactor: P.atom.B_iso_or_equiv(location),
        // Mol*'s own table (`ElementVdwRadii`), so the traced sphere and the preview's spacefill
        // are one number rather than two that agree by hand.
        vdwRadius: P.atom.vdw_radius(location),
      });
    }
  }
  if (!atoms.length) {
    throw new Error(
      'the structure contains no atomic records. Coarse-grained and integrative models are not'
      + ' read here yet, and this renderer refuses one rather than drawing an empty picture.',
    );
  }
  return atoms;
}

/**
 * One conformer per **residue**: the alternate location with the highest occupancy, ties broken by
 * the order the file lists them.
 *
 * A crystallographer's alternate locations are a
 * statement that a side chain is in two places some of the time; drawing all of them at once is a
 * picture of a molecule that does not exist, and in ball-and-stick it reads as a modelling error
 * rather than as disorder. Every viewer that shows one is showing less than the file says, and this
 * one is a renderer of pictures.
 *
 * Occupancy first because that is the number the file gives for exactly this purpose. File order
 * second, and it settles every group in 3RGK: all 27 are 50/50 and the first listed is `A`. The
 * rule is ours. "Keep blank or `A`" is the alternative, and it quietly picks the *minority*
 * conformer whenever `B` is the major one.
 *
 * **The choice is per residue, and that is the whole reason this function is not three lines.**
 * Written per *atom*, the choice can assemble a side chain out of two conformers at
 * once: give a serine's A location
 * occupancies 0.55/0.48 and its B location 0.45/0.52, and the highest-occupancy atom is `CB` from
 * A and `OG` from B. Mol* does not bond across alternate locations, so what renders is a hydroxyl
 * floating 2.787 A off its own beta carbon -- a molecule that exists in neither conformer, reading
 * as a modelling error, which is precisely the pair of failures the decision was taken to avoid.
 * A conformer is a property of a residue, so the residue is what picks one.
 *
 * **Mean occupancy across the label's atoms, not the sum.** Refinement writes one occupancy per
 * alternate on every atom of it, so the mean recovers that number exactly when the file is regular
 * and stays meaningful when it is not: two labels modelling different atom counts -- an `A`/`B`
 * pair spelling ALA and SER, say -- would let a sum elect the longer side chain rather than the
 * likelier one.
 *
 * Grouped by unit and `residueIndex` rather than by author identifiers, which is exact where an
 * auth sequence id joined to an insertion code is a string waiting to collide.
 */
function chooseConformers(atoms) {
  // residue -> label -> running mean. `Map` keeps insertion order, so the first label the file
  // lists is the one a tie leaves standing.
  const groups = new Map();
  for (const atom of atoms) {
    if (!atom.altLoc) continue;
    const key = `${atom.unitId}|${atom.residueIndex}`;
    let labels = groups.get(key);
    if (!labels) groups.set(key, labels = new Map());
    const standing = labels.get(atom.altLoc);
    if (standing) {
      standing.total += atom.occupancy;
      standing.count += 1;
    } else {
      labels.set(atom.altLoc, { total: atom.occupancy, count: 1 });
    }
  }

  /*
    A file with no alternate locations is the common case and it has nothing to choose, so the
    array comes back as it went in rather than as a copy with every `index` rewritten to the value
    it already held. 1AON is 58,870 atoms and 0 alternates; 3RGK is 1,347 and 27 groups, so both
    paths still run in the fixtures. `elementCount - atoms.length` is 0 either way, which is what
    `parseStructure()` reports as `alternatesDropped`.
  */
  if (groups.size === 0) return atoms;

  const chosen = new Map();
  for (const [key, labels] of groups) {
    let best;
    let bestMean = -Infinity;
    for (const [label, { total, count }] of labels) {
      const mean = total / count;
      if (mean > bestMean) {
        bestMean = mean;
        best = label;
      }
    }
    chosen.set(key, best);
  }

  const kept = atoms.filter(
    (atom) => !atom.altLoc || chosen.get(`${atom.unitId}|${atom.residueIndex}`) === atom.altLoc,
  );
  // Re-index, because `index` is what `bonds` refers to and the array it refers into has changed.
  kept.forEach((atom, index) => { atom.index = index; });
  return kept;
}

/**
 * Every bond Mol* perceives, each one exactly once, as indices into `atoms`.
 *
 * The two traps are opposite and both are here:
 *
 * - **Intra-unit.** `unit.bonds.edgeCount` counts *undirected* edges, but `a`/`b` -- and the
 *   `edgeProps` indexed alongside them -- hold each edge **twice**. Walking without `a[i] < b[i]`
 *   draws every covalent bond twice, which is invisible in a picture and doubles the primitive
 *   count.
 * - **Inter-unit.** `structure.interUnitBonds.edges` holds each bond twice, once per direction, and
 *   `interUnitBonds.edgeCount` is that *doubled* number. 3RGK reports 4 and has 2 bonds.
 *
 * `unitA` / `unitB` on an inter-unit edge are unit **ids**, not positions in `structure.units`, so
 * the address map is keyed by id. On `Structure.ofModel` the two happen to coincide, which is
 * precisely why indexing by position would survive every test until an assembly is expanded.
 *
 * `order` and `flags` are carried because they cost nothing and Mol* is the first parser in this
 * project that has them: `BondType.Flag.Disulfide`, `.Aromatic`, `.Computed`, `.HydrogenBond`, and
 * bond order for doubles. **What is drawn from them is not decided here** -- hydrogen bonds are
 * enumerated and then not turned into cylinders (`capabilities.js`), because the enumeration is a
 * statement about the file and the cylinder is a statement about the picture.
 *
 * `total` is every distinct bond Mol* has and `count` is how many survive the conformer filter.
 * They are reported separately so that "each of Mol*'s bonds is counted exactly once" stays
 * checkable after the filtering -- otherwise the filter is a place a double-count can hide.
 */
export function enumerateBonds(structure, atoms) {
  /*
    The address table: `(unit id, element index) -> our atom index`.

    Not one `Map` keyed on `${unitId}:${elementIndex}`: that is a string built once per atom to
    fill it and twice per bond to read it -- 58,870 + 118,580 short-lived strings on 1AON, for a
    lookup whose second half is already a dense integer inside its unit. So it is one `Int32Array`
    per unit instead, `-1` for an element we did not keep. Measured on 1AON with the bond graph
    already perceived, floor of nine: **18.8 ms -> 4.9 ms** for the whole function.

    An element index past the end of its unit's table reads `undefined`, and `undefined < 0` is
    false, so an out-of-range address returns `undefined` exactly as a missing map key would.
  */
  const tables = new Map();
  for (const unit of structure.units) {
    if (!Unit.isAtomic(unit)) continue;
    tables.set(unit.id, new Int32Array(unit.elements.length).fill(-1));
  }
  for (const atom of atoms) {
    const table = tables.get(atom.unitId);
    if (table !== undefined) table[atom.elementIndex] = atom.index;
  }
  // `undefined` is a real answer, not an error: it means the bond touches a conformer we did
  // not keep. A bond naming an element the *Structure* has not is still impossible.
  const at = (unitId, elementIndex) => {
    const table = tables.get(unitId);
    if (table === undefined) return undefined;
    const index = table[elementIndex];
    return index < 0 ? undefined : index;
  };

  const a = [];
  const b = [];
  const order = [];
  const flags = [];
  let total = 0;
  const push = (first, second, bondOrder, bondFlags) => {
    total += 1;
    if (first === undefined || second === undefined) return;
    a.push(Math.min(first, second));
    b.push(Math.max(first, second));
    order.push(bondOrder);
    flags.push(bondFlags);
  };

  for (const unit of structure.units) {
    if (!Unit.isAtomic(unit)) continue;
    // Every edge of this walk addresses this unit, so the table is looked up once rather than
    // twice an edge. Reading `unit.bonds` is what makes Mol* perceive the bond graph -- 140.8 ms
    // of 1AON's parse, behind a lazy getter, and by far the largest single cost in it.
    const table = tables.get(unit.id);
    const bonds = unit.bonds;
    const edgeOrder = bonds.edgeProps.order;
    const edgeFlags = bonds.edgeProps.flags;
    for (let edge = 0; edge < bonds.a.length; edge += 1) {
      const first = bonds.a[edge];
      const second = bonds.b[edge];
      if (first > second) continue;
      const one = table[first];
      const other = table[second];
      push(
        one < 0 ? undefined : one, other < 0 ? undefined : other,
        edgeOrder[edge], edgeFlags[edge],
      );
    }
  }

  const seen = new Set();
  for (const edge of structure.interUnitBonds.edges) {
    const key = [`${edge.unitA}:${edge.indexA}`, `${edge.unitB}:${edge.indexB}`].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    push(at(edge.unitA, edge.indexA), at(edge.unitB, edge.indexB), edge.props.order, edge.props.flag);
  }

  return {
    count: a.length,
    total,
    // **`X.from(array)` stays, and it is the fast one.** The obvious tidy here is
    // `new Uint32Array(a)`, on the reasoning that `.from` goes through the iterator protocol; on
    // V8 it does not for a packed array of small integers, and the constructor is the one that
    // takes the generic array-like path. Measured on 1AON's 59,317 bonds, floor of 200 runs:
    // `Uint32Array.from` 0.030 ms against `new Uint32Array` 0.180, and the same 5x on the `order`
    // and `flags` arrays.
    a: Uint32Array.from(a),
    b: Uint32Array.from(b),
    order: Uint8Array.from(order),
    flags: Uint16Array.from(flags),
  };
}

/**
 * `modelcif_plddt`: per-residue pLDDT from `ma_qa_metric_local`, keyed by *label* chain and
 * sequence id, which is what the ModelCIF tables use.
 *
 * Returns a `Map` from `label chain|label seq id` to the score, or `null` when the file carries no
 * declared pLDDT metric -- the product refuses to read a plain B factor as confidence, and so does
 * this. It reads the `CifFrame` rather than the `Structure` because Mol* does not surface the
 * ModelCIF quality tables as a structure property.
 */
function parseModelCifPlddt(frame) {
  const metric = frame.categories.ma_qa_metric;
  const local = frame.categories.ma_qa_metric_local;
  if (!metric || !local) return null;
  const idField = metric.getField('id');
  if (!idField) return null;
  const described = ['name', 'type', 'mode'].map((name) => metric.getField(name));
  const accepted = new Set();
  for (let row = 0; row < metric.rowCount; row += 1) {
    const description = described.map((f) => (f ? f.str(row) : '')).join(' ');
    const canonical = description.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (canonical.includes('plddt') || canonical.includes('predictedlddt')) {
      accepted.add(idField.str(row));
    }
  }
  if (!accepted.size) return null;
  const metricId = local.getField('metric_id');
  const asymId = local.getField('label_asym_id');
  const seqId = local.getField('label_seq_id');
  const metricValue = local.getField('metric_value');
  if (!metricId || !asymId || !seqId || !metricValue) return null;
  const values = new Map();
  for (let row = 0; row < local.rowCount; row += 1) {
    if (!accepted.has(metricId.str(row))) continue;
    const value = Number.parseFloat(metricValue.str(row));
    if (!Number.isFinite(value)) continue;
    values.set(`${asymId.str(row)}|${Number.parseInt(seqId.str(row), 10)}`, value);
  }
  return absolutePlddt(values);
}

/*
  An explicitly labelled prediction PDB carries pLDDT in its B-factor column.
  Gated on `detectStructureMetric()` so the file that is offered pLDDT is exactly the file that has it.
*/
function parsePdbPlddt(source, filename, residues) {
  if (detectStructureMetric(source, filename) !== 'plddt') return null;
  const values = new Map();
  for (const residue of residues) {
    const atom = residue.atoms.find((candidate) => candidate.name === 'CA') ?? residue.atoms[0];
    if (!Number.isFinite(atom?.bFactor)) continue;
    values.set(`${atom.labelChainId}|${residue.labelSeqId}`, atom.bFactor);
  }
  return absolutePlddt(values);
}

function absolutePlddt(values) {
  if (!values.size) return null;
  // Several predictors write the same score as a 0-1 fraction, and the ramp is absolute, so an
  // unconverted field would render entirely below its first stop -- one flat "very low confidence"
  // orange, which is a confident picture of the opposite claim.
  let maximum = -Infinity;
  let minimum = Infinity;
  for (const score of values.values()) {
    if (score > maximum) maximum = score;
    if (score < minimum) minimum = score;
  }
  if (maximum > 0 && maximum <= 1 && minimum >= 0) {
    for (const [key, value] of values) values.set(key, value * 100);
  }
  return values;
}

// A tab's heap holds roughly this many before the per-atom records run it out of memory.
export const MAX_STRUCTURE_ATOMS = 3_000_000;

/**
 * One structure file, read once: the `Structure`, and every projection of it this app uses.
 *
 * Async because Mol*'s readers are `Task`s -- they chunk the parse so a large file yields to the
 * event loop rather than freezing it.
 *
 * `options.assembly` names a biological assembly to build. **Omit it for the molecule the file
 * means** -- its first assembly, or the asymmetric unit when it declares none -- and pass `null` to
 * ask for the asymmetric unit itself. `assemblies` comes back either way, so a control can offer
 * what this file actually declares rather than a guess, and `assembly` says which one was built.
 */
export async function parseStructure(source, filename, options = {}) {
  const { format, frame, file } = await readFrame(source, filename);
  // An empty .cif has no block at all.
  if (!frame?.categories?.atom_site) throw new Error('the structure contains no atom records');
  const { model, structure, frameCount, assemblies, assembly } =
    await buildStructure(frame, file, options.assembly);
  // Mol*'s assembly is lazy and cheap; one record per atom below is not (1M4X's is 16.3M atoms).
  if (structure.elementCount > MAX_STRUCTURE_ATOMS) {
    const molecule = assembly === null ? 'the asymmetric unit' : `biological assembly ${assembly}`;
    throw new Error(`${molecule} has ${structure.elementCount.toLocaleString('en-US')} atoms, more than `
      + `the ${MAX_STRUCTURE_ATOMS.toLocaleString('en-US')} this page can hold`);
  }
  const everyElement = readAtoms(structure);
  const atoms = chooseConformers(everyElement);
  const residues = groupResidues(atoms);
  return {
    format,
    frameCount,
    model,
    structure,
    // Which molecule this is, beside what the file offers -- `null` is the asymmetric unit.
    assembly,
    assemblies,
    atoms,
    // What Mol* has, beside what we draw. The gap is the alternate conformations that lost, and it
    // is reported rather than left to be inferred from two numbers that no longer match.
    elementCount: everyElement.length,
    alternatesDropped: everyElement.length - atoms.length,
    residues,
    bonds: enumerateBonds(structure, atoms),
    plddt: format === 'pdb' ? parsePdbPlddt(source, filename, residues) : parseModelCifPlddt(frame),
  };
}

