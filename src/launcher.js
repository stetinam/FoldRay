/*
  Where a dropped file goes, and the guard that stops the browser eating one.

  **The window-wide drop guard is why this file exists** rather than the router being four lines in
  `main.js`. Without it the browser navigates away from any file dropped outside a drop zone --
  which, the app having no modal of its own, is the entire window.

  Two rules it keeps:

  * **The extension patterns are built from `session-format.js`'s constants**, not restated. The
    importer reads a desktop `.sprsession` as well as this tree's own `.foldray` and the
    `.rendersession` that preceded it, so the three must agree by construction; a literal here is
    a fourth place for the name to be wrong.
  * **`routeFile` is always returned.** There is no early exit, because markup missing an input
    that handed the caller an undefined router would kill the drop path silently while every other
    control went on working.
*/

import {
  SESSION_FILE_EXTENSION, SUPERSEDED_SESSION_FILE_EXTENSION, LEGACY_SESSION_FILE_EXTENSION,
} from './session-format.js';

/** `.foldray` -> `foldray`, ready to go inside a character class-free alternation. */
const bare = (extension) => extension.replace(/^\./, '');

const STRUCTURE_PATTERN = /\.(?:cif|pdb|cif\.gz|pdb\.gz)$/i;
/*
  All three session extensions, plus `.json` -- a session document *is* JSON, and a browser that
  renamed the download is the common case. The parser is what refuses a JSON file that is not a
  session, by name; the router only decides which input a file belongs to. The superseded name is
  here because a file on disk outlives the name it was written under.
*/
const SESSION_PATTERN = new RegExp(
  `\\.(?:${[
    SESSION_FILE_EXTENSION, SUPERSEDED_SESSION_FILE_EXTENSION, LEGACY_SESSION_FILE_EXTENSION,
  ].map(bare).join('|')}|json)$`,
  'i',
);

/**
 * Hand one file to the input that owns it, exactly as if it had been picked by hand.
 *
 * A `DataTransfer` is what lets `.files` be assigned, so drag-and-drop lands on the same load,
 * validation and error path as the file picker rather than becoming a second loader that can
 * drift. Returns the input it belongs to, or `null` when nothing here accepts it.
 *
 * **The input it is already on is a target, not a skip.** `#structure-file` accepts a session as
 * well as a structure and asks this function which it has, so a structure comes back naming the
 * very input whose `change` handler called us -- re-assigning and re-dispatching there would
 * re-enter that handler forever. Returning the target rather than a boolean is what lets the
 * caller tell *routed away* from *stays here*.
 */
export function routeFile(file, { structureInput, sessionInput, onReject }) {
  const target = STRUCTURE_PATTERN.test(file.name)
    ? structureInput
    : (SESSION_PATTERN.test(file.name) ? sessionInput : undefined);
  if (!target) {
    onReject(`${file.name} is not a structure or a session. Structures are .cif, .pdb, .cif.gz and `
      + `.pdb.gz; sessions are ${SESSION_FILE_EXTENSION}`
      // Named, because it is accepted: `src/main.js` imports a desktop session one way and reports
      // what it could not carry, so a user holding one should not read this line as a refusal.
      + `, and a desktop ${LEGACY_SESSION_FILE_EXTENSION} is imported too.`);
    return null;
  }
  if (target.disabled) return null;
  if (target.files?.[0] === file) return target;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  target.files = transfer.files;
  target.dispatchEvent(new Event('change', { bubbles: true }));
  return target;
}

/**
 * The router, plus the guard that keeps the browser from navigating to a dropped file.
 *
 * `#window-drop-zone` is the full-window overlay that appears while a drag is over the page; it is
 * optional, so markup without it still gets the guard and simply shows nothing.
 */
export function initLauncher({ onReject, isBusy }) {
  const windowDropZone = document.querySelector('#window-drop-zone');
  const structureInput = document.querySelector('#structure-file');
  const sessionInput = document.querySelector('#session-file');

  const route = (file) => routeFile(file, { structureInput, sessionInput, onReject });

  /*
    `dragenter`/`dragleave` fire once per element the pointer crosses, not once per window, so the
    overlay is reference-counted rather than toggled -- a bare toggle flickers off the moment the
    drag crosses any child boundary.
  */
  let dragCounter = 0;
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((type) => {
    window.addEventListener(type, (event) => {
      // Always prevented: this is the line that stops the browser replacing the app with the file.
      event.preventDefault();
      // The count is kept while busy too: a drag straddling the end of a load went negative and the
      // overlay blinked at every element boundary for the rest of the page.
      if (type === 'dragenter') {
        dragCounter += 1;
        if (!isBusy()) windowDropZone?.removeAttribute('hidden');
      } else if (type === 'dragleave') {
        dragCounter = Math.max(0, dragCounter - 1);
        if (dragCounter === 0) windowDropZone?.setAttribute('hidden', '');
      } else if (type === 'drop') {
        dragCounter = 0;
        windowDropZone?.setAttribute('hidden', '');
        if (isBusy()) return;
        const [file] = event.dataTransfer?.files ?? [];
        if (file) route(file);
      }
    });
  });

  return { routeFile: route };
}
