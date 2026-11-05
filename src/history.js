/*
  Undo and redo for the composition, the Mol* view included.

  What lives here is only the part with no DOM in it: the bounded ring of captured states, the
  cursor that walks it, and the coalescing that turns one continuous gesture into one entry. The
  capture and the clock are injected, exactly as `style-sweep.js` and `session-lifecycle.js` inject
  theirs -- which is the only reason "a rotation is one undo step" can be checked rather than hoped
  for. A state is opaque here: this module compares two of them
  through the caller's `serialize` and never looks inside one.

  Three properties are structural rather than incidental.

    * A state is captured *after* the app has settled, never before it changed. Every record() arms
      the same window; the capture happens when it closes. That is what makes one trackball drag
      one entry -- Mol* redraws every frame and keeps redrawing through its own inertia -- and it is
      also why two edits made inside one window share an entry: by the time the second is seen, the
      first one's "before" is already gone. At COALESCE_MS that only merges edits made in the same
      breath, and it is the price of recording settled states rather than diffing controls.

    * undo() and redo() flush a pending capture first. Rotating and then reaching straight for
      Ctrl+Z must undo the rotation, not the edit before it, and flushing is what turns the
      not-yet-committed gesture into a real entry before the cursor moves.

    * pause() exists because applying an entry writes the controls back, which fires exactly the
      events that record history. Without it a restore records itself and the ring loops. It is the
      same guard `styles-strip.js` spells `applying`.

  Nothing here is written anywhere: no storage, no file, nothing in the session document. The ring
  lives as long as the tab holds one structure and is dropped when another loads. There is no
  project saving in this app, and an undo stack that survived a reload would be exactly that.
*/

/*
  Fifty is deep enough for a working session -- a Style, a dozen control edits and the camera moves
  between them -- and shallow enough to stay bounded in a way that can be reasoned about. The bound
  is on entries, not bytes, and that is only safe because an entry is settings-sized: the caller
  captures with the structure omitted, so a 64 MB file is nowhere in the ring. The oldest entry is
  dropped when the fifty-first arrives, which is the ordinary undo bargain: deep, not infinite.
*/
export const HISTORY_LIMIT = 50;

/*
  One window for every kind of change. Long enough that a trackball drag, a held arrow key and a
  range input being dragged each settle into a single entry; short enough that two deliberate edits
  stay two entries. It is also what gives main.js's own change handlers time to run before the
  state is read, so an entry can never hold a control that has moved without its dependants.
*/
export const COALESCE_MS = 400;


export function createHistory({
  capture,
  // `rendered_at` is a fresh timestamp on every capture, so the caller passes a serializer that
  // ignores it. Comparing the whole object would make every state look new and defeat the drop.
  serialize = (state) => JSON.stringify(state),
  /*
    The same state with the view left out, which is what makes undoSettings() mean anything. Undo
    remembers states, so "material, then rotate, then undo the material" is two entries back, not
    one: the entry directly behind the cursor has the new material and the old camera, and stepping
    to it with the camera skipped would visibly do nothing at all. Comparing on settings alone lets
    the settings-only step walk past the entries that only moved the view -- which is exactly what
    "keep my view, take back what I changed" asks for.
  */
  serializeSettings = serialize,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  coalesceMs = COALESCE_MS,
  limit = HISTORY_LIMIT,
  onChange = () => {},
} = {}) {
  // `{ state, digest, settings }`: both digests are kept beside the state so the "nothing actually
  // changed" drop and the settings-only walk cost one serialize each per capture, not one per
  // comparison.
  const entries = [];
  let index = -1;
  let paused = false;
  let timer;
  let pendingKey;
  /*
    Captures are awaited, so two that overlap could otherwise push in the order they finished
    rather than the order they started -- which for a state-based history means remembering the
    newer state as the older one. Chaining them is cheaper than reasoning about that.
  */
  let chain = Promise.resolve();
  /*
    Bumped whenever the ring stops describing the app: a new structure, or an entry being applied
    back. A capture that was already in flight then belongs to the world before that happened, and
    pushing it would seed the fresh ring with a stale state or record the restore as an edit.
  */
  let generation = 0;

  // The entry a settings-only step would land on: the nearest one in that direction whose settings
  // actually differ. -1 when everything there differs only in the view.
  function settingsEntry(delta) {
    if (index < 0 || ![-1, 1].includes(delta)) return -1;
    for (
      let candidate = index + delta;
      candidate >= 0 && candidate < entries.length;
      candidate += delta
    ) {
      if (entries[candidate].settings !== entries[index].settings) return candidate;
    }
    return -1;
  }

  function snapshot() {
    return {
      length: entries.length,
      index,
      canUndo: index > 0,
      canUndoSettings: settingsEntry(-1) >= 0,
      canRedo: index >= 0 && index < entries.length - 1,
      canRedoSettings: settingsEntry(1) >= 0,
      // What a gesture in progress looks like from outside, so a test can assert the window is
      // still open rather than sleeping and hoping.
      pending: timer !== undefined ? (pendingKey ?? true) : undefined,
    };
  }

  const emit = () => onChange(snapshot());

  function cancelPending() {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
    pendingKey = undefined;
  }

  function push(state) {
    if (state === undefined) return false;
    const digest = serialize(state);
    if (index >= 0 && digest === entries[index].digest) return false;
    // Everything past the cursor is a future this edit has just replaced.
    entries.length = index + 1;
    entries.push({ state, digest, settings: serializeSettings(state) });
    if (entries.length > limit) entries.splice(0, entries.length - limit);
    index = entries.length - 1;
    return true;
  }

  async function commit(era) {
    let state;
    try {
      state = await capture();
    } catch {
      // Mid-edit there is no coherent state to remember -- a half-typed colour is the real case.
      // Swallowed rather than propagated so the chain below can never reject and stall.
      return;
    }
    if (era !== generation) return;
    if (push(state)) emit();
  }

  // While the ring holds nothing past its baseline, the state replaces it rather than following it.
  async function rebaseline(era) {
    let state;
    try {
      state = await capture();
    } catch {
      return;
    }
    if (era !== generation || state === undefined) return;
    if (index > 0) {
      if (push(state)) emit();
      return;
    }
    entries.length = 0;
    entries.push({ state, digest: serialize(state), settings: serializeSettings(state) });
    index = 0;
    emit();
  }

  // The era is read here, synchronously, and not inside commit(): by the time a queued capture
  // actually runs, the reset or pause it should have been discarded by has already happened.
  function queueCommit(run = commit) {
    const era = generation;
    chain = chain.then(() => run(era));
    return chain;
  }

  function flush() {
    if (timer === undefined) return chain;
    cancelPending();
    return queueCommit();
  }

  async function moveTo(next) {
    if (next < 0 || next >= entries.length || next === index) return undefined;
    index = next;
    emit();
    return entries[index].state;
  }

  async function step(delta) {
    if (paused) return undefined;
    await flush();
    return moveTo(index + delta);
  }

  async function stepSettings(delta) {
    if (paused) return undefined;
    await flush();
    return moveTo(settingsEntry(delta));
  }

  return {
    snapshot,

    /*
      "Something changed, and it is this kind of thing." The key names the gesture -- a control id,
      or 'camera' -- and only reports what is in flight; the window is the same either way, because
      a state captured after the fact cannot tell one settled edit from two.
    */
    record(key) {
      if (paused) return;
      cancelPending();
      pendingKey = key;
      timer = setTimer(() => {
        timer = undefined;
        pendingKey = undefined;
        queueCommit();
      }, coalesceMs);
    },

    // The state as it stands, with no window: the baseline a freshly loaded structure starts from,
    // and the settled state after a snapshot has been loaded back into the controls.
    commit() {
      cancelPending();
      return queueCommit();
    },

    /*
      The state as it stands, as the baseline itself rather than a step from it: a view that settles
      after the load committed (Mol* frames the structure a frame later) is where the structure
      arrived, and there must be nothing to undo back to before it. Once anything has been recorded
      past the baseline it is an ordinary commit.
    */
    rebaseline() {
      if (paused) return chain;
      return queueCommit(rebaseline);
    },

    flush,
    undo: () => step(-1),
    // The same ring and cursor, walking to the nearest entry in either direction whose *settings*
    // differ. The caller omits the camera while applying both variants, so they symmetrically move
    // settings backward and forward under the view the user has composed.
    undoSettings: () => stepSettings(-1),
    redoSettings: () => stepSettings(1),
    redo: () => step(1),

    reset() {
      cancelPending();
      generation += 1;
      entries.length = 0;
      index = -1;
      emit();
    },

    pause() {
      paused = true;
      cancelPending();
      generation += 1;
    },

    resume() {
      paused = false;
    },
  };
}
