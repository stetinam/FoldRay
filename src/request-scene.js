/*
  A render request, turned into the inputs `buildScene()` wants.

  One consumer shape, and the shape is the contract: the app hands over a `render_request` it has
  just built, and a harness hands over one it parsed out of a saved document. They are the same
  object, which is what keeps this file forty lines rather than a second reader.

  **The secondary structure is the one thing this file does not read out of the request.**
  Reading `request.secondary_structure.assignments` into a `Map` and, when the document carries none,
  handing on an empty one is the trap: that silent fallback renders every residue as `loop` -- the
  same triangle count a correct render produces, reported "Complete", with nothing downstream able
  to see it. Surviving it needs a guard and a refusal.

  There is nothing to fall back *from* here. The `Structure` is in this process, so the assignment
  is computed from it (`secondary-structure.js`), and the request carries the *method* rather than
  the answer. A document that names a method we do not have is refused by name; a document that
  names none gets the decided default, pinned. The failure mode the guard existed for cannot occur.
*/

import { parseStructure } from './structure.js';
import {
  computeSecondaryStructure, DEFAULT_SECONDARY_STRUCTURE_METHOD,
} from './secondary-structure.js';

/** The gzip magic number. A request should never carry compressed bytes -- but a saved session read
    straight off disk might, and a silent mojibake parse is worse than a sentence. */
function decodeStructure(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    throw new Error('the structure is gzip-compressed, which this renderer does not decode');
  }
  return new TextDecoder().decode(bytes);
}

/*
  The last parse, kept.

  **This is what makes "one `Structure`, one answer" a property of the code rather than a promise.**
  The studio rebuilds its request whenever a control moves, and the live trace re-reads it once a
  frame; without this, changing a colour would re-parse the file and hand the tracer a second
  `Structure` built from the same bytes -- and the preview canvas, which adopts the one the studio
  walked, would then be drawing a different object from the one being traced.

  The key is what `parseStructure()` reads: the bytes (by identity, because a load produces the
  base64 once and every later request carries that same string), the filename and the assembly.
  Anything else in the request is style, which `buildScene()` reads and this does not. One entry,
  because there is one open structure.

  **The secondary-structure method is deliberately *not* part of that key.** Keying on it means
  that changing `#secondary-structure-method` re-parses the file and hands the tracer a second
  `Structure` -- while the preview canvas goes on drawing the first one it adopted, which is
  exactly the collision this memo exists to prevent, reached through the
  one control that asks for a different answer rather than a different picture. It is not needed:
  Mol*'s `CustomStructureProperty.attach` recomputes when the params differ (`if (property.data.value
  && PD.areEqual(defaults, property.props, p)) return;`), so a method change is a recompute **on the
  same `Structure`**. The preview does not follow on its own: its cartoon re-reads the attachment only
  inside a representation update, so `main.js` calls `preview.refreshRepresentations()` after one.
*/
let lastParse = null;

/*
  The parse in hand, and putting it back. A file read and then declined replaced it, and the next
  request for the open structure would parse that file again -- a second `Structure` beside the one
  the preview adopted. Only between a read and its load, with nothing adopted in between.
*/
export function heldParse() {
  return lastParse;
}

export function restoreHeldParse(held) {
  lastParse = held;
}

/*
  Async because Mol*'s readers are `Task`s -- they chunk the parse so a large file yields to the
  event loop rather than freezing it -- and because the secondary-structure provider is too.
*/
export async function sceneInputsFromRequest(request, { fresh = false } = {}) {
  /*
    Three values, and the third is what keeps this memo honest.

    A document that **names** an assembly gets that one, and `null` is the asymmetric unit named
    rather than assumed (`src/structure.js`). A request that says **nothing**
    -- `readStructure()`'s opening probe and `refreshSecondaryStructure()`'s recompute both do --
    means "whatever this structure is already loaded as", so it matches the parse in hand rather
    than re-deciding the question.

    **That last clause is load-bearing and not a convenience.** Key an absent field as a value of
    its own and the app's opening probe (no assembly) and its first real request (the resolved id)
    would be two different keys on one file -- a re-parse, and therefore a *second* `Structure`
    while the preview canvas goes on drawing the first. That is exactly the collision this memo
    exists to prevent, and it is how the secondary-structure method came out of the key above.

    `fresh` is a file being opened rather than probed: it asks for the molecule the file means, so
    it only hits a parse that was itself built from an absent field. Without it, re-opening a file
    after choosing its asymmetric unit built the asymmetric unit again.
  */
  const named = request.assembly !== undefined;
  const method = request.secondary_structure?.method ?? DEFAULT_SECONDARY_STRUCTURE_METHOD;
  const hit = lastParse
    && lastParse.bytes === request.structure_base64
    && lastParse.filename === request.filename
    && (named ? lastParse.assembly === request.assembly : (!fresh || lastParse.defaulted));
  if (!hit) {
    const source = decodeStructure(request.structure_base64);
    const built = await parseStructure(
      source, request.filename, named ? { assembly: request.assembly } : {},
    );
    lastParse = {
      bytes: request.structure_base64,
      filename: request.filename,
      // The molecule that was *built*, never the value that was asked for: an absent field
      // resolves here and a later request naming that same id has to hit rather than re-parse.
      assembly: built.assembly,
      defaulted: !named,
      method,
      parsed: built,
      secondary: await computeSecondaryStructure(built.structure, built.residues, method),
    };
  } else if (lastParse.method !== method) {
    /*
      A different method on the same `Structure`. The recompute is awaited before anything is
      recorded, so a method that answers for no residue throws with `secondary-structure.js`'s own
      sentence and leaves the previous answer in place rather than a half-swapped one.
    */
    const secondary = await computeSecondaryStructure(
      lastParse.parsed.structure, lastParse.parsed.residues, method,
    );
    lastParse = { ...lastParse, method, secondary };
  }
  const { parsed, secondary } = lastParse;
  /*
    A fresh wrapper every time, carrying the *incoming* request. The parse is shared; the styles are
    not, and returning the cached object would hand `buildScene()` the previous edit's request --
    which renders perfectly and reads as a control that stopped working.
  */
  return {
    request,
    filename: request.filename,
    // The one `Structure` travels with the inputs rather than being rebuilt by anything that wants
    // it: preview/trace agreement is only checkable while there is exactly one of these.
    structure: parsed.structure,
    model: parsed.model,
    format: parsed.format,
    assembly: parsed.assembly,
    assemblies: parsed.assemblies,
    atoms: parsed.atoms,
    // What Mol* has, beside what we draw: the difference is the alternate conformations that lost.
    elementCount: parsed.elementCount,
    alternatesDropped: parsed.alternatesDropped,
    residues: parsed.residues,
    bonds: parsed.bonds,
    plddt: parsed.plddt,
    secondaryStructure: secondary.lookup,
    secondaryStructureMethod: secondary.method,
    // Which of `auto`'s three methods answered, for the picker to say so. `null` for the three
    // methods that name themselves, and for a structure with no protein.
    secondaryStructureAutoBranch: secondary.autoBranch,
  };
}
