/*
  Who holds the renderer.

  There is one tracer in this app, because the picture on screen is promised to be the picture you
  download -- two renderers could not keep that promise, so `render-backend.js` keeps one and hands
  it to whoever asks. That makes "whoever asks" a real question the moment there is more than one
  asker, and there are three: the endless live trace, the one-shot render behind the tray and the
  download, and the Styles sweep walking a chosen set one tile at a time.

  **Sharing one renderer is not the same as taking turns on it, and the difference is invisible
  until it isn't.** `renderer.resize()` allocates a fresh accumulator and drops `pipelinesReady`;
  `setScene()` replaces every buffer the trace bind group points at. A one-shot render does both,
  and the live loop is `await`ing inside its own iteration while that happens -- so a tile would be
  traced against a scene half-swapped under it and come out as a picture nobody asked for, rendered
  perfectly. Nothing throws. The sweep's own rule covers *sweeps* ("a walk is refused while another
  job is outstanding") and says nothing about the live trace.

  So this is a **FIFO mutex**, and each of those three properties is load-bearing:

  * **First in, first served.** A queue that wakes every waiter and lets them race is the bug this
    exists to prevent, one level up. `take()` chains onto the previous holder rather than polling a
    flag, so two callers arriving in the same tick are ordered by arrival and neither observes the
    other mid-write.
  * **`held()` is what a loop yields on**, and it is the whole reason this is not just a mutex. The
    live trace must not *queue* behind a render -- it would take its turn between two of the
    sweep's tiles and repaint the stage from the wrong scene. It parks instead: one look at `held()`
    at the top of each iteration, `await` it if set, and carry on when the renderer is free. Only
    then does it take a turn, for its own prepare, so a render pressed mid-build queues behind it.
  * **A release is idempotent and cannot be lost.** `take()` resolves to the release function and
    nothing else can call it, so a caller that throws mid-render releases in its own `finally` and
    the queue does not wedge. Calling it twice is a no-op rather than a second release that would
    hand the renderer to two owners.

  **And a turn is not the same span as a job, which is what `suspend()` adds.** Taking turns is
  enough while there is one finite job; a Styles walk is *many* finite jobs with a gap between each,
  and in every gap the lock is free, so the live loop wakes, re-prepares a scene it is about to be
  parked out of again, samples one frame and parks. That is a BVH build per tile and it
  reads as a sweep that got slower for no reason. `suspend()` marks the *job* rather than the turn:
  it is reference counted, so `render()` holds one for its own duration and a walk holds one across
  all of its tiles, and `quiet()` does not settle until the last of them lets go. The live trace
  parks on `quiet()` first and on `held()` second: one tracer, one picture at a time.

  It is a separate file because it is the only part of the seam that stands alone. The rest of
  `render-backend.js` pulls `render/renderer.js`, which pulls three `.wgsl?raw` modules only Vite
  resolves; nothing here imports anything.
*/

/**
 * One renderer, one holder at a time.
 *
 * `createRenderLock()` rather than a module-level singleton, so a test can have its own and so the
 * ownership is a value the seam passes around rather than ambient state a second module could
 * quietly join.
 */
export function createRenderLock() {
  // The tail of the queue: a promise that settles when everyone currently waiting has finished.
  let tail = Promise.resolve();
  // The promise the *current* holder settles, or null when the renderer is free.
  let current = null;
  /*
    The suspension half. `suspensions` is a count rather than a flag because the two callers nest:
    a Styles walk holds one for the whole walk and each of its tiles takes another through
    `render()`, and a walk that ended while a tile was still finishing must not un-park the live
    trace under it. `quiet` is the promise every one of them settles, made once when the count
    leaves zero so that every parked caller waits on the same object.
  */
  let suspensions = 0;
  let quiet = null;
  let endQuiet = () => {};
  // How many suspensions have *begun*. A live trace that parked, rested or paused reads this to
  // decide whether anything else has had the renderer meantime -- `forgetSceneIfTakenOver()`.
  let takeovers = 0;

  return {
    /**
     * Wait for the renderer and take it. Resolves to the function that gives it back.
     *
     * Always release in a `finally`. A holder that throws without releasing wedges every later
     * caller, and the failure looks like a renderer that stopped rather than like a missing line.
     */
    take() {
      let release = () => {};
      const mine = new Promise((resolve) => {
        release = () => {
          // Idempotent: only the holder that is actually current may clear it, so a stray second
          // call cannot free a renderer someone else has since taken.
          if (current === mine) current = null;
          resolve();
        };
      });
      const turn = tail.then(() => {
        current = mine;
        return release;
      });
      tail = tail.then(() => mine);
      return turn;
    },

    /**
     * What currently holds the renderer, as a promise that settles when it lets go -- or `null`.
     *
     * This is the *parking* half. A caller that wants a turn calls `take()`; a caller that wants to
     * stay out of the way until the renderer is free awaits this and then re-checks, which is what
     * lets an endless loop yield to a finite job without joining the queue behind it.
     */
    held() {
      return current;
    },

    /**
     * Claim the renderer for a whole *job*, and hand back the function that ends the claim.
     *
     * `take()` is a turn and this is the span the turns belong to. The difference only shows with
     * more than one turn in a row: between two tiles of a Styles walk the queue is empty and
     * `held()` is null, and an endless loop that yields on `held()` alone therefore wakes up in
     * every gap. Reference counted and idempotent, for the reasons `take()`'s release is.
     */
    suspend() {
      suspensions += 1;
      takeovers += 1;
      if (suspensions === 1) {
        quiet = new Promise((resolve) => { endQuiet = resolve; });
      }
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        suspensions -= 1;
        if (suspensions === 0) {
          const settle = endQuiet;
          quiet = null;
          endQuiet = () => {};
          settle();
        }
      };
    },

    /**
     * What the renderer is claimed *for*, as a promise that settles when the last claim ends -- or
     * `null` when there is none.
     *
     * The parking half of `suspend()`, and the same shape as `held()` on purpose: a loop checks
     * this one first, because it is the longer of the two spans.
     */
    quiet() {
      return quiet;
    },

    /** How many jobs have claimed the renderer. A change means somebody else has been in it. */
    get takeovers() {
      return takeovers;
    },

    /** Whether anything holds the renderer. For a status readout, never for a decision. */
    get busy() {
      return current !== null;
    },

    /** Whether a job is claiming the renderer. For a status readout, never for a decision. */
    get suspended() {
      return suspensions > 0;
    },
  };
}
