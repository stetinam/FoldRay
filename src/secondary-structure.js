/*
  Secondary structure, computed from the one `Structure` and pinned rather than defaulted.

  The measurement behind this file corrects the obvious
  assumption: **`auto` is not DSSP.** `computeAuto()` returns the file's own `HELX_P` / `struct_conf`
  records whenever `(isFromPdbArchive && isExperimental && !isCoarseGrained) || hasSecondaryStructure`
  and only otherwise computes. On 3RGK that is a 13-residue disagreement with DSSP about what is
  helical.

  **Pinning and defaulting are the same value and not the same act.** `auto` is the decided default
  -- the file's own assignment when it has one, computed when it does not -- and it is passed
  explicitly on every call, so a Mol* upgrade that changed its default would fail a test here
  rather than silently move every cartoon in the app.

  The other three are a control, not an internal: a depositor's helices and DSSP's genuinely
  disagree and which is *right* is the user's call. A fourth option that older documents may name
  does not come across -- it identified a geometric assignment computed outside this renderer, at
  import; Mol*'s Zhang-Skolnick fills the "geometric, no hydrogens needed" slot it occupied.

  It also **reports which branch `auto` took**, beside the answer: three methods behind one word
  is not a thing the control can leave unsaid.

  This file computes; it never substitutes. A structure whose chosen method cannot answer produces a
  message that names the cause and offers the method that can -- the hole
  in `auto`, said out loud.
*/

import { Model, Unit } from 'molstar/lib/mol-model/structure.js';
import { SecondaryStructureType } from 'molstar/lib/mol-model/structure/model/types.js';
import {
  SecondaryStructureProvider,
} from 'molstar/lib/mol-model-props/computed/secondary-structure.js';
import { DefaultDSSPComputationProps }
  from 'molstar/lib/mol-model-props/computed/secondary-structure/dssp.js';
import { AssetManager } from 'molstar/lib/mol-util/assets.js';
import { SyncRuntimeContext } from 'molstar/lib/mol-task/execution/synchronous.js';

/**
 * The four methods, in the order a picker would offer them. `auto` first because it is the default.
 *
 * These are Mol*'s own parameter names, not a vocabulary of ours, so a request that names one can
 * be handed straight to the provider. `dssp` is Mol*'s implementation of Kabsch & Sander,
 * "Dictionary of protein secondary structure", Biopolymers 22(12), 1983.
 */
export const SECONDARY_STRUCTURE_METHODS = ['auto', 'model', 'dssp', 'zhang-skolnick'];

export const SECONDARY_STRUCTURE_LABELS = {
  auto: 'Automatic (the file’s own records, computed when it has none)',
  model: 'The file’s own records',
  dssp: 'DSSP',
  'zhang-skolnick': 'Zhang-Skolnick (geometric)',
};

export const DEFAULT_SECONDARY_STRUCTURE_METHOD = 'auto';

/**
 * What `auto` actually ran, in the words the picker shows.
 *
 * `auto` is three methods and the file decides which, so the option has to be able to say which one
 * answered. Presentation only: the option's value stays `auto`, which is what the request carries.
 */
export const SECONDARY_STRUCTURE_AUTO_LABELS = {
  records: 'Automatic — records',
  dssp: 'Automatic — DSSP',
  'zhang-skolnick': 'Automatic — Zhang–Skolnick',
};

/** No structure, no protein, or a method with no branch to report. `index.html` ships this word. */
export const SECONDARY_STRUCTURE_AUTO_LABEL = 'Automatic';

/*
  The custom-property context: a synchronous runtime and an asset manager that never fetches
  anything: no plugin, no canvas, no DOM.
*/
const propertyContext = { runtime: SyncRuntimeContext, assetManager: new AssetManager() };

/** Mol*'s bit flags, read into the three kinds the geometry cares about. */
export function secondaryStructureKind(type) {
  if (SecondaryStructureType.is(type, SecondaryStructureType.Flag.Helix)) return 'helix';
  if (SecondaryStructureType.is(type, SecondaryStructureType.Flag.Beta)) return 'sheet';
  return 'loop';
}

/**
 * A `Map` from our residue key to `'helix' | 'sheet' | 'loop'`, for every protein residue.
 *
 * It walks **our** residue list rather than the hierarchy, which is what makes preview/trace
 * agreement structural rather than asserted: the keys are the keys
 * `groupResidues()` made, the residue set is the set the geometry draws, and there is no second
 * walk that could disagree about either. Each residue's address back into the `Structure` travels
 * on its atoms (`unitId` / `elementIndex`), so the lookup is direct.
 *
 * Non-protein residues are absent by design, not missing: nothing in this app draws a nucleic
 * cartoon off a helix flag, and a structure with no protein returns an empty lookup rather than
 * refusing.
 */
export async function computeSecondaryStructure(structure, residues, method = DEFAULT_SECONDARY_STRUCTURE_METHOD) {
  if (!SECONDARY_STRUCTURE_METHODS.includes(method)) {
    throw new Error(
      `"${String(method)}" is not a secondary-structure method this renderer has.`
      + ` Choose one of: ${SECONDARY_STRUCTURE_METHODS.join(', ')}.`,
    );
  }
  const protein = residues.filter((residue) => residue.component === 'protein');
  const lookup = new Map();
  if (!protein.length) return { method, lookup, proteinResidues: 0, autoBranch: null };

  /*
    Pinned, never taken. `{ type: { name, params } }` is the provider's own parameter shape.

    **`{}` is not "the defaults" and `dssp` is the one method that has any.** Mol*'s two DSSP
    flags both default to true, so an empty object silently selected the *revised* definition:
    135 helical residues on 3RGK where Mol*'s own defaults give 119, and where `auto`'s internal
    DSSP fallback -- which does take the defaults -- gave a different answer again on any file
    with no records. Two methods spelled DSSP disagreeing is the substitution this file refuses.
  */
  const params = method === 'dssp' ? DefaultDSSPComputationProps : {};
  await SecondaryStructureProvider.attach(propertyContext, structure, { type: { name: method, params } });
  const computed = SecondaryStructureProvider.get(structure).value;

  for (const residue of protein) {
    const anchor = residue.atoms[0];
    const unit = structure.unitMap.get(anchor.unitId);
    if (!unit || !Unit.isAtomic(unit)) continue;
    const element = unit.elements[anchor.elementIndex];
    const assignment = computed?.get(unit.invariantId);
    const index = assignment?.getIndex(unit.residueIndex[element]) ?? -1;
    const type = index >= 0 ? assignment?.type[index] : undefined;
    if (type === undefined) throw unassignable(method, residue, protein.length);
    lookup.set(residue.key, secondaryStructureKind(type));
  }

  /*
    The branch is reported only here, past the loop -- a file that fell into `unassignable()` throws
    instead and never gets a label claiming a branch it did not complete.
  */
  return {
    method,
    lookup,
    proteinResidues: protein.length,
    autoBranch: method === 'auto' ? autoSecondaryStructureBranch(structure) : null,
  };
}

/*
  Which of `computeAuto`'s three branches this structure takes.

  **It must track `computeAuto`** in `molstar/lib/mol-model-props/computed/secondary-structure.js`:
  Mol* returns the assignment and never says what made it, so this re-derives the branch from the
  same exported predicates, in the same order, over the same units. It is a read of the model, not a
  second computation -- change there, change here.
*/
function unitAutoBranch(unit) {
  const model = unit.model;
  if ((Model.isFromPdbArchive(model) && Model.isExperimental(model) && !Model.isCoarseGrained(model))
    || Model.hasSecondaryStructure(model)) return 'records';
  if (Unit.isAtomic(unit) && !Model.isCoarseGrained(model)) return 'dssp';
  if (Unit.isAtomic(unit)) return 'zhang-skolnick';
  // computeAuto assigns nothing for such a unit, so its residues reach `unassignable()`.
  return null;
}

/** One answer or none: units that disagree have no single word a picker could show. */
export function autoSecondaryStructureBranch(structure) {
  const branches = new Set();
  for (const group of structure.unitSymmetryGroups) {
    const branch = unitAutoBranch(group.units[0]);
    if (branch) branches.add(branch);
  }
  return branches.size === 1 ? [...branches][0] : null;
}

/**
 * A message naming the cause and the method that can answer, instead of a bare throw.
 *
 * `computeAuto`'s first branch tests `isFromPdbArchive && isExperimental && !isCoarseGrained` *or*
 * `hasSecondaryStructure` -- a proxy for "has records", not a check that any exist. A PDB-archive
 * experimental file carrying no `HELX_P` at all therefore gets **no assignment for that unit**, and
 * not a DSSP fallback. Failing loudly is the right side to fail on; failing loudly without naming
 * the fix is not.
 */
function unassignable(method, residue, count) {
  const where = `${residue.chainId} ${residue.name}${residue.residueId}${residue.insertionCode}`;
  // Not "it looks deposited": the records branch is reached through `hasSecondaryStructure` alone as
  // well, and 3RGK is one such file. Name the branch, never the predicate that may not have fired.
  const cause = method === 'auto'
    ? '"auto" took the file\'s own secondary-structure records -- and they do not cover it.'
    : `The "${method}" method produced no assignment for it.`;
  const fix = method === 'dssp'
    ? ' Try "zhang-skolnick", which is geometric and needs no hydrogens.'
    : ' Choose "dssp" to compute the assignment from the coordinates instead.';
  return new Error(
    `No secondary structure was assigned to ${where}, one of ${count} protein residues.`
    + ` ${cause}${fix}`,
  );
}
