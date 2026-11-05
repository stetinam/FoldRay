/*
  Save, and only when asked.

  Nothing touches the user's disk until they pick a location, and nothing rewrites what they picked
  afterwards. Each `Save As…` is one explicit write of the current state to one file the user chose
  in that gesture; the app keeps no handle to write to later, so there is no background persistence
  to argue about and no file quietly changing under the user between saves. The cost is stated
  rather than hidden: work done after a save is only in the tab until the next one, which is what
  the dirty label and the unload prompt are for.

  Every browser call is injected rather than reached for directly. `showSaveFilePicker` needs a
  real user gesture and cannot be driven in a headless browser, so keeping the seam here is what
  lets the state machine -- dirty tracking, fallback selection, the labels -- be tested in Node.
*/

export function supportsFileSystemAccess(scope = globalThis) {
  return typeof scope?.showSaveFilePicker === 'function';
}


/*
  status:
    'empty'  no structure loaded, nothing to save
    'dirty'  there is work no file on disk has (or nothing has been saved at all)
    'saving' a write is in flight
    'clean'  the last saved file matches the current state
    'error'  the last write failed; the work is still only in the tab
*/
export function createSessionLifecycle({
  supported,
  pickSaveFile,
  writeHandle,
  download,
  buildDocument,
  suggestName,
  now = () => Date.now(),
  onChange = () => {},
}) {
  let name;
  let status = 'empty';
  let savedAt;
  let message;
  // Whether anything has reached disk this session. Only the label reads it: 'Unsaved changes'
  // means "the file you saved is now behind", which is a different thing to say than "not saved".
  let written = false;
  let writing = false;
  // Moved by every edit and load, so a write that an edit overtook does not report it as saved.
  let revision = 0;
  // The revision a load, a restore or a save left the session at. Moved past it is work that
  // replacing the session would lose; 'dirty' alone also means "an opened file was never saved".
  let settledRevision = 0;
  // The structure the saved file holds: its name is only offered back while that structure is open.
  let savedStructure;
  let loadedStructure;
  const emit = () => onChange(snapshot());

  function snapshot() {
    return {
      status,
      name: name ?? 'Untitled',
      savedAt,
      message,
      label: label(),
    };
  }

  function label() {
    if (status === 'empty') return 'No structure';
    if (status === 'saving') return 'Saving…';
    if (status === 'error') return message ?? 'Save failed';
    // Not "N min ago": nothing re-renders a clean label, so it read "just now" for good.
    if (status === 'clean') return 'Saved';
    // Dirty, which is the resting state between saves and so has to make sense as something the
    // user might sit looking at.
    return written ? 'Unsaved changes' : 'not saved';
  }

  function markLoaded(structureFilename, { sameDocument = false } = {}) {
    revision += 1;
    settledRevision = revision;
    loadedStructure = structureFilename;
    status = 'dirty';
    savedAt = undefined;
    message = undefined;
    // An assembly reload is the same document; any other load is a new one, even of the same file.
    if (!sameDocument || !written || structureFilename !== savedStructure) {
      name = undefined;
      written = false;
      savedStructure = undefined;
    }
    emit();
  }

  function markDirty() {
    if (status === 'empty') return;
    revision += 1;
    status = 'dirty';
    emit();
  }

  // A restore writes its settings after `markLoaded()`; what it wrote is the document, not an edit.
  function markSettled() {
    settledRevision = revision;
  }

  function markWritten(fileName, structureFilename, captured) {
    // Unless another structure loaded while the file was being written.
    if (structureFilename === loadedStructure) {
      name = fileName;
      savedAt = now();
      written = true;
      savedStructure = structureFilename;
    }
    if (revision === captured) settledRevision = revision;
    status = revision === captured ? 'clean' : 'dirty';
    emit();
  }

  function fail(error) {
    status = 'error';
    message = `Save failed: ${error?.message || error}`;
    emit();
  }

  async function saveAs(structureFilename) {
    if (status === 'empty') return { ok: false, reason: 'no-structure' };
    if (writing) return { ok: false, reason: 'busy' };
    // The name the user last chose, so a second save offers to replace the file the first one made
    // rather than making them retype it. The picker is still where that decision is confirmed.
    const suggested = name ?? suggestName(structureFilename);

    if (!supported) {
      // Firefox and Safari: one download of exactly the same document, since there is no picker to
      // open. It is as saved as the Chromium path now is -- neither is rewritten afterwards.
      writing = true;
      status = 'saving';
      message = undefined;
      emit();
      try {
        const captured = revision;
        const document = await buildDocument();
        download(`${JSON.stringify(document, null, 2)}\n`, suggested);
        markWritten(suggested, structureFilename, captured);
        return { ok: true, downloaded: true };
      } catch (error) {
        fail(error);
        return { ok: false, reason: 'build-failed' };
      } finally {
        writing = false;
      }
    }

    let chosen;
    try {
      chosen = await pickSaveFile(suggested);
    } catch (error) {
      // An aborted picker is the user changing their mind, not a failure worth reporting.
      if (error?.name === 'AbortError') return { ok: false, reason: 'cancelled' };
      fail(error);
      return { ok: false, reason: 'picker-failed' };
    }
    if (!chosen) return { ok: false, reason: 'cancelled' };

    writing = true;
    status = 'saving';
    message = undefined;
    emit();
    try {
      const captured = revision;
      const document = await buildDocument();
      await writeHandle(chosen, `${JSON.stringify(document, null, 2)}\n`);
      markWritten(chosen.name ?? suggested, structureFilename, captured);
      return { ok: true, downloaded: false };
    } catch (error) {
      fail(error);
      return { ok: false, reason: 'write-failed' };
    } finally {
      writing = false;
    }
  }

  function reset() {
    name = undefined;
    status = 'empty';
    savedAt = undefined;
    message = undefined;
    written = false;
    writing = false;
    savedStructure = undefined;
    loadedStructure = undefined;
    emit();
  }

  return {
    snapshot,
    markLoaded,
    markDirty,
    markSettled,
    saveAs,
    reset,
    // Edits since the last load, restore or save: what replacing the session or leaving loses.
    hasUnsavedEdits() {
      return status !== 'empty' && revision !== settledRevision;
    },
    // Whether a file has been written this session. Not a handle: nothing here can write again.
    hasSavedFile() {
      return written;
    },
  };
}
