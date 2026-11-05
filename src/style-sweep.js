/*
  The opt-in Styles sweep: render the Styles the user chose on the user's own structure.

  This app has no render queue and no preset manager, and this is deliberately neither. The
  guarantees that keep it on the right side of that line are structural, not just intentions:

    * user-initiated -- nothing starts without a click on the sweep's start button, which names
      the subset it is about to walk ("Render 10 styles"; "Render selected styles" only while
      nothing is chosen);
    * one-shot -- it walks a fixed list once and stops, with no resubmission and no retry;
    * single-worker -- `renderOne` is awaited, so there is never a second job in flight;
    * cancellable at any tile -- `stop()` is honoured between tiles and the walk unwinds;
    * session-scoped -- results live in this object and nothing is written anywhere.

  The chosen subset is the fixed list. Selection defaults to the first
  `defaultSelection` Styles (12), which the strip re-seeds with the recommendation on each load, and
  every count, estimate and completion message is derived from the subset rather than from the
  catalogue -- a three-Style sweep estimated as a
  ten-Style one would be exactly the dishonest number the measure step exists to avoid. Choosing is
  refused while a walk is running, because a list that can grow underneath the walk is no longer
  one pass over one list.

  The estimate is measured rather than guessed: the first Style establishes the per-tile
  time, the running status switches to a real extrapolation, and the same user-initiated walk then
  continues automatically. Stop is available throughout and is honoured before the next tile.

  Every clock and render call is injected, so the pacing, the estimate and the cancel paths can be
  driven without a GPU -- the same seam the File System Access API is held behind. Whatever
  `renderOne` resolves to is opaque here: this module only tells "something" from `undefined`, so a
  caller can carry a render's settings beside its URL without this file knowing what either is.
*/

export const SWEEP_IDLE = 'idle';
export const SWEEP_MEASURING = 'measuring';
export const SWEEP_ESTIMATED = 'estimated';
export const SWEEP_RUNNING = 'running';
export const SWEEP_DONE = 'done';
export const SWEEP_FAILED = 'failed';
export const DEFAULT_SWEEP_SELECTION = 12;


export function formatRemaining(milliseconds) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `~${seconds} s remaining`;
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? '~1 min remaining' : `~${minutes} min remaining`;
}


export function createStyleSweep({
  styles,
  renderOne,
  now = () => Date.now(),
  onChange = () => {},
  defaultSelection = DEFAULT_SWEEP_SELECTION,
} = {}) {
  const catalog = styles.map((style) => style.id);
  /*
    THERE IS NO CAP ON THE SUBSET. What keeps "one pass over one fixed list" from reading as a queue
    is the other four guarantees -- one click starts it, one pass covers it, one render is in flight
    at a time, and Stop is honoured between every tile -- and none of them depend on how long the
    list is. A 90-Style walk is the same one-shot walk as a 9-Style one, just longer, and the
    measured estimate says how much longer before it is started.
  */
  const initialSelection = Math.min(catalog.length, Math.max(1, Math.floor(defaultSelection)));
  let selected = new Set(catalog.slice(0, initialSelection));
  let state = SWEEP_IDLE;
  let results = new Map();
  let structureKey;
  let perStyle;
  let message = '';
  let stopRequested = false;
  let canResume = false;

  // The list a walk covers, always in catalogue order so the sweep runs in the order the strip
  // shows -- a Set preserves insertion order, which is the order the user happened to click in.
  const order = () => catalog.filter((id) => selected.has(id));

  /*
    Derived from the results map, never counted up separately. A separate counter can be
    incremented twice for the same Style -- calling measure() a second time re-renders index 0 and
    would push the count to 2 -- after which the walk resumes one index too far and the sweep
    reports "All N rendered" having silently skipped one. Keying off the map makes that
    unrepresentable: the same Style rendered twice is still one result. Only the chosen Styles
    count, so deselecting one cannot leave the sweep claiming more done than it will render.
  */
  const completed = () => order().filter((id) => results.has(id)).length;
  const pending = () => order().filter((id) => !results.has(id));
  const busy = () => state === SWEEP_MEASURING || state === SWEEP_RUNNING;

  const snapshot = () => {
    const total = order().length;
    return {
      state,
      completed: completed(),
      total,
      chosen: new Set(selected),
      message,
      results: new Map(results),
      canResume,
      // Only meaningful once the first render has been measured.
      remaining: perStyle === undefined
        ? undefined
        : formatRemaining(perStyle * (total - completed())),
    };
  };

  const emit = () => onChange(snapshot());

  function describe() {
    const total = order().length;
    if (perStyle === undefined) return `${completed()} of ${total} done`;
    const seconds = Math.round(perStyle / 100) / 10;
    return `${completed()} of ${total} done in ${seconds} s, ${formatRemaining(perStyle * (total - completed()))}`;
  }

  // A sweep is only valid for the structure it was rendered against, so a new structure discards
  // it rather than showing the previous protein under this one's name. The chosen subset survives:
  // it is what the user wants tested, not a result of testing.
  function useStructure(key) {
    if (key === structureKey) return;
    structureKey = key;
    results = new Map();
    perStyle = undefined;
    state = SWEEP_IDLE;
    message = '';
    canResume = false;
    emit();
  }

  /*
    Re-derives the walk's standing after the list underneath it changed. A failure is left alone:
    it names the Style that broke and nothing about choosing a different set makes that untrue.
  */
  function resettle() {
    if (state === SWEEP_FAILED) {
      emit();
      return;
    }
    canResume = false;
    const total = order().length;
    const done = completed();
    if (done === 0) {
      state = SWEEP_IDLE;
      message = '';
    } else if (done >= total) {
      state = SWEEP_DONE;
      message = `All ${total} rendered.`;
    } else {
      state = SWEEP_ESTIMATED;
      message = describe();
    }
    emit();
  }

  async function renderIds(ids) {
    for (const id of ids) {
      if (stopRequested) {
        state = SWEEP_ESTIMATED;
        canResume = true;
        message = `Stopped after ${completed()} of ${order().length}.`;
        emit();
        return false;
      }
      const started = now();
      let result;
      try {
        result = await renderOne(id);
      } catch (error) {
        state = SWEEP_FAILED;
        message = `Sweep failed on ${id}: ${error.message || error}`;
        emit();
        return false;
      }
      if (result === undefined) {
        // A cancelled job, not a crash: keep what was rendered and stand down quietly.
        state = SWEEP_ESTIMATED;
        canResume = true;
        message = `Stopped after ${completed()} of ${order().length}.`;
        emit();
        return false;
      }
      results.set(id, result);
      // Measured from the first render only. Later tiles vary with representation cost, and an
      // estimate that keeps moving is worse than one honest number.
      if (perStyle === undefined) perStyle = now() - started;
      message = describe();
      emit();
    }
    return true;
  }

  return {
    snapshot,
    useStructure,
    result: (id) => results.get(id),
    isSelected: (id) => selected.has(id),

    /*
      Choosing what the next walk covers. Refused mid-walk for the same reason `order` is a
      snapshot of the selection rather than a live view of it: one pass over one list.
    */
    setSelected(id, on) {
      if (busy() || !catalog.includes(id)) return;
      if (on) selected.add(id); else selected.delete(id);
      resettle();
    },

    setAllSelected(on) {
      if (busy()) return;
      selected = on ? new Set(catalog) : new Set();
      resettle();
    },

    /*
      Choose an explicit subset -- what the Recommended row does when a structure is loaded.

      With eleven rows ordered by structure class, the first twelve are the whole of Small &
      detailed and Monomers and none of the rest, which is a worse default than random. Filtered
      through the catalogue so an unknown id is dropped rather than admitted.
    */
    setSelectedIds(ids) {
      if (busy()) return;
      const wanted = new Set(ids);
      selected = new Set(catalog.filter((id) => wanted.has(id)));
      resettle();
    },

    /*
      The product path: one click walks the fixed pending subset. The first render establishes the
      estimate, then the rest follow automatically; this split keeps the measured estimate honest
      without turning it into a confirmation gate.
    */
    async start() {
      if (busy()) return;
      const list = pending();
      const total = order().length;
      if (total === 0) {
        message = 'Choose at least one style first.';
        emit();
        return;
      }
      if (list.length === 0) {
        state = SWEEP_DONE;
        message = `All ${total} rendered.`;
        emit();
        return;
      }
      stopRequested = false;
      canResume = false;
      state = SWEEP_MEASURING;
      message = `Rendering ${completed() + 1} of ${total}…`;
      emit();
      const firstOk = await renderIds(list.slice(0, 1));
      if (!firstOk) return;
      if (completed() >= total) {
        state = SWEEP_DONE;
        message = `All ${total} rendered.`;
        emit();
        return;
      }
      // Stop may have been pressed while the first render itself was in flight.
      if (stopRequested) {
        state = SWEEP_ESTIMATED;
        canResume = true;
        message = `Stopped after ${completed()} of ${total}.`;
        emit();
        return;
      }
      state = SWEEP_RUNNING;
      message = describe();
      emit();
      const restOk = await renderIds(list.slice(1));
      if (!restOk) return;
      state = SWEEP_DONE;
      message = `All ${total} rendered.`;
      emit();
    },

    /*
      The measurement phase remains independently testable, but the UI calls start(), which
      continues automatically instead of presenting this phase as a confirmation gate.
    */
    async measure() {
      if (busy()) return;
      const list = order();
      if (list.length === 0) {
        message = 'Choose at least one style first.';
        emit();
        return;
      }
      stopRequested = false;
      canResume = false;
      state = SWEEP_MEASURING;
      message = `Rendering 1 of ${list.length}…`;
      emit();
      const ok = await renderIds(list.slice(0, 1));
      if (!ok) return;
      state = completed() >= list.length ? SWEEP_DONE : SWEEP_ESTIMATED;
      canResume = state === SWEEP_ESTIMATED;
      message = state === SWEEP_DONE ? `All ${list.length} rendered.` : describe();
      emit();
    },

    /* Continues from an explicit Stop/cancellation over the still-chosen, unrendered Styles. */
    async resume() {
      if (busy()) return;
      const rest = pending();
      if (rest.length === 0) return;
      stopRequested = false;
      canResume = false;
      state = SWEEP_RUNNING;
      message = describe();
      emit();
      const ok = await renderIds(rest);
      if (!ok) return;
      state = SWEEP_DONE;
      message = `All ${order().length} rendered.`;
      emit();
    },

    stop() {
      stopRequested = true;
    },

    isBusy: busy,
  };
}
