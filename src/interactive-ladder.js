/*
  ======================== THE LADDER IS MEASURED, NOT LOOKED UP ========================

  How big the live trace draws while the camera is moving, and how many samples it submits at a
  time once it has stopped. Two numbers, one estimate, and the estimate is of the machine actually
  running rather than of a machine somebody named.

  The two machines that bracket this audience are **eighty to a hundred and sixty times apart**:
  104-205 samples/s at 1024 squared on a mid-range desktop card against **1.27** on a 15 W laptop's
  integrated graphics. Neither is unusual, which is the whole argument for measuring: a
  vendor-and-architecture allowlist would have to know that the laptop wants ~128 px where the
  desktop card wants 256+, and would be wrong about the next machine either way. Trace a short calibration burst
  on the actual loaded scene and set the interactive resolution and batch from the observed
  samples/s.

  A fixed pair -- scale 0.5 and `interacting ? 1 : 2` on every machine -- gets **both ends of that
  range wrong**:

  * On the 15 W laptop, one sample of a 976x686 stage at half scale is ~125 ms and a *settled* batch
    of two at full scale is ~1 s. That is a 5 fps orbit and a full second between a drag starting
    and the picture reacting to it -- the loop cannot see the nudge until the batch it is inside
    comes back.
  * On the desktop card, two samples a frame at 60 Hz is **120 samples a second** whatever the card can
    do. At the interactive size that card is good for 800-1800, so the picture converges at a
    seventh of the available rate.

  So there is one control law and it drives both, from one number: **pixels sampled per
  millisecond**, exponentially averaged over the iterations `createLiveTrace()` timed cleanly.

  | | |
  | --- | --- |
  | while the input is moving | choose the **scale** so an iteration lands near `INTERACTIVE_FRAME_MS`, and keep the batch at one |
  | once it settles | full scale, and choose the **batch** so an iteration lands near `SETTLED_FRAME_MS` |

  **The scale is capped at `INTERACTIVE_SCALE` and never rises above it**: a machine fast enough
  for it gets exactly the half-scale interactive picture, and only a machine that would drop frames
  goes below it. The settled batch is the other way round -- it may go up as far as
  the card can take, and down to one, which is the number that unblocks the slow laptop's first
  drag.

  **None of this can move a rendered picture.** The accumulator is a mean over samples, so how many
  are submitted per iteration changes when frames appear and never what they contain; a bit-exact
  render does not come through here at all (`renderExactly()` drives the renderer directly); and a
  *final* render is `traceOnce()`, whose batch is its own. What changes is only how a live picture
  is paced.

  **It is its own module so the arithmetic stands apart from the renderer.** `render-backend.js`
  imports `pathtrace.wgsl?raw`, which is a Vite transform, so anything living in that file can only
  ever be checked by reading it. This is arithmetic with edges -- a floor, a cap, an unmeasured
  device, a stage of one pixel -- and edges deserve better than a grep.
*/

/**
 * The fraction of the stage's pixels traced while the input is moving, before any measurement.
 *
 * 0.5 is a quarter of the work, which is the difference between a camera that drags and one that
 * does not. It is also the **ceiling**: the measured law may go below it and never above.
 */
export const INTERACTIVE_SCALE = 0.5;

/** How long after the last input the trace climbs back to full resolution. */
export const SETTLE_MS = 180;

/** The floor on the interactive scale. Below this the picture stops being worth looking at. */
export const MIN_INTERACTIVE_SCALE = 0.15;

/** And an absolute one, so a small stage cannot be scaled into a postage stamp. */
export const MIN_INTERACTIVE_EDGE = 128;

/**
 * How long one iteration should take while the input is moving.
 *
 * 40 ms is 25 frames a second, which is where a drag stops reading as a drag and starts reading as
 * a slideshow. It is deliberately not 16: the trace is *sampling*, and a machine that can only give
 * this 25 fps has better uses for the other 24 ms than an emptier picture.
 */
export const INTERACTIVE_FRAME_MS = 40;

/**
 * And how long one should take once the input has settled.
 *
 * Nothing is waiting on this except the readout and the next nudge, so it is longer -- which is
 * what lets a fast card put twenty samples into one iteration instead of two. It is also the
 * latency the *first* drag after a rest pays, because the loop can only notice a nudge between
 * iterations, so it is 100 ms rather than a second.
 */
export const SETTLED_FRAME_MS = 100;

/** The most samples one settled iteration may hold, however fast the card is. */
export const MAX_SETTLED_BATCH = 32;

/**
 * The exponential average of pixels-per-millisecond, given the standing estimate and one reading.
 *
 * 0.25 settles in about a dozen frames and rides out a single hitch -- a compositor stall, a
 * background tab, another window taking the GPU. The first reading is taken whole rather than
 * blended toward zero, because there is nothing to blend with and starting at zero would spend a
 * dozen frames climbing out of a number that means "unmeasured".
 */
export function blendThroughput(standing, pixels, ms) {
  if (!(ms > 0) || !(pixels > 0)) return standing;
  const rate = pixels / ms;
  return standing > 0 ? standing * 0.75 + rate * 0.25 : rate;
}

/**
 * The interactive scale for a stage of this size on a device measured at this throughput.
 *
 * `sqrt` because the estimate is in pixels and the scale is a linear factor on both edges. Capped
 * at `INTERACTIVE_SCALE`, and floored twice beneath that cap -- by a fraction and by an absolute
 * edge -- so a slow device cannot scale a stage into something nobody could read. A throughput of 0
 * means nothing has been measured yet and the answer is `INTERACTIVE_SCALE` itself.
 */
export function interactiveScaleFor(throughput, stageWidth, stageHeight) {
  if (!(throughput > 0)) return INTERACTIVE_SCALE;
  const pixels = Math.max(stageWidth * stageHeight, 1);
  const wanted = Math.sqrt((INTERACTIVE_FRAME_MS * throughput) / pixels);
  const longest = Math.max(stageWidth, stageHeight, 1);
  // `INTERACTIVE_SCALE` caps both floors, so below a 256 px longest edge the picture is half size
  // rather than `MIN_INTERACTIVE_EDGE`.
  const floor = Math.max(MIN_INTERACTIVE_SCALE, Math.min(1, MIN_INTERACTIVE_EDGE / longest));
  return Math.min(INTERACTIVE_SCALE, Math.max(floor, wanted));
}

/**
 * How long one *dispatch* should take, which is a different question from how long an iteration
 * should take and is not about this app at all.
 *
 * A GPU switches between applications between dispatches rather than inside one, so a dispatch is
 * how long everything else on the machine waits its turn. Measured with a second process watching
 * a render on the 15 W laptop: at 1024 square, where one whole-frame dispatch is 313 ms, the
 * watcher fell to **7 frames a second** against 56 idle, and no submit batch changed that -- a
 * batch of 32 was no worse than a batch of 1, because the pending work was never what anybody was
 * waiting on. At 256 square, where a dispatch is 28 ms, the same watcher held 36.
 *
 * 16 ms is one frame at 60 Hz: the budget at which another application's next frame is not the one
 * that waits. Lower buys nothing anybody can see and costs dispatches.
 */
export const TILE_FRAME_MS = 16;

/**
 * What a final render plans its bands and drains on before this device has been measured.
 *
 * The 15 W laptop's 1.27 samples/s at 1024 square, in pixels per ms. A
 * render's first two batches are unmeasured, and a whole-frame dispatch at 3840 square is seconds.
 *
 * **The live loop plans on it too, and the exemption it used to have was wrong.** Being drawn at
 * `INTERACTIVE_SCALE` does not make a first frame small: a resize or a scene change clears the
 * loop's `measurable`, so on a heavy scene its first iteration is one 1358 ms dispatch at half
 * scale and the two after it are whole frames at full size.
 */
export const UNMEASURED_RENDER_THROUGHPUT = (1024 * 1024 * 1.27) / 1000;

/**
 * How long Stop may take to be honoured on a final render.
 *
 * **Not a responsiveness number and not free.** The queue cannot be recalled once submitted, so the
 * only way to bound how long a cancel waits is to stop submitting and let the GPU catch up -- and
 * each of those costs one round trip, the 2.5-5 ms this machine measures. Undrained it is
 * **1.1-7.3 s**, one whole sample, because a flag is read at CPU speed while the wait is on the
 * GPU.
 *
 * **The cost is a ratio rather than a number, which is what makes it portable**: one bubble per
 * group, so it is `bubble / group`, and a group is never smaller than half this constant (the band
 * count is floored, and a group is more than `STOP_LATENCY_MS - bandMs` wide whenever a band fits
 * inside it at all). So the worst case is `2 * bubble / STOP_LATENCY_MS` on any device.
 *
 * **400 is chosen against a 2% ceiling.** At the 4-5 ms bubble measured here that is 2.0-2.5% worst
 * case and ~1% in the cases that actually arise -- measured at 250, where the policy's own choice
 * cost **1.7% at 1024 square and 0.5% at 2048**; 400 issues fewer drains than that, not more. A
 * platform whose round trip is much dearer would need this raised in proportion, and the ratio is
 * written here so that is arithmetic rather than a re-measure.
 */
export const STOP_LATENCY_MS = 400;

/**
 * How many bands to submit between drains, at this throughput and band size.
 *
 * 0 means never drain, which is the answer when nothing has been measured -- and, like the band
 * size, not a number any caller reaches: `plannedThroughput()` stands in first. A band is `bandRows`
 * deep, or the whole frame where tiling did not engage, and the group is whatever fits
 * `STOP_LATENCY_MS`: on a fast card a whole frame is 6.7 ms, so the group is larger than any batch
 * and no drain ever falls inside one.
 */
export function bandsPerDrain(throughput, width, bandRows) {
  if (!(throughput > 0) || !(width > 0) || !(bandRows > 0)) return 0;
  const bandMs = (width * bandRows) / throughput;
  return Math.max(1, Math.floor(STOP_LATENCY_MS / bandMs));
}

/**
 * How many rows of film one dispatch should cover, at this throughput and width.
 *
 * **0 means the whole frame**, and it is the answer for a frame already inside the budget, so a
 * machine fast enough for its own render is untouched and the tiling can never be the reason a
 * first frame is late. It is also the answer at a throughput of 0, which is why no caller passes
 * one: `render-backend.js`'s `plannedThroughput()` substitutes `UNMEASURED_RENDER_THROUGHPUT`
 * first, for the live loop as well as the final render.
 *
 * Rounded down to a multiple of the 8-row workgroup, and floored at one workgroup: a partial band
 * costs a whole dispatch and covers less film than it charges for.
 *
 * **A band count is not the thing to bound, and a cap on one is actively harmful.** The exposure
 * worth worrying about is a platform whose submit is dearer than the ~26 us measured here through
 * Chrome, Dawn and D3D12 -- Firefox goes through wgpu and Safari through WebKit's own backend, and
 * none of them can be reached from this tree. But a *time* budget already bounds it: each band is
 * aimed at `TILE_FRAME_MS`, so the rate is about `1000 / TILE_FRAME_MS` submits a second on any
 * device, whatever the count per sample -- 62 a second here, which is 0.16% of the frame at 26 us
 * and still only 6% at a whole millisecond. Where the 8-row floor binds the band overruns the
 * budget and the rate falls *below* 62, so the bound holds at both ends.
 *
 * **The whole millisecond is measured, not hypothetical.** One `queue.submit()` costs about 0.9 ms
 * on `nvidia/lovelace` against the 26 us measured on `amd/rdna-3` through the same Chrome, Dawn and
 * D3D12 (2026-09-23), so at 1024 square 16-row bands cost **+347%** there where they cost +4.5% on
 * `amd/rdna-3`, and 8-row **+688%** against +11.2%. The budget above still holds, because a band
 * sized from an honest measurement is 16 ms of work and 0.9 ms is 6% of it. What it does not cover
 * is a band sized from a throughput far below the device's -- `UNMEASURED_RENDER_THROUGHPUT` on a
 * card like that -- which is bounded instead by how briefly it lasts: one iteration, or two.
 *
 * So there is no cap on the band count: one of 64 bounds a count nothing needs bounding and, on the
 * slow-and-large corner tiling exists for, takes the dispatch from 52 ms to **210** -- protecting a
 * hypothetical platform by damaging the measured one.
 */
export function tileRowsFor(throughput, width, height) {
  if (!(throughput > 0) || !(width > 0) || !(height > 0)) return 0;
  const wanted = (TILE_FRAME_MS * throughput) / width;
  const rows = Math.max(8, Math.floor(wanted / 8) * 8);
  return rows >= height ? 0 : rows;
}

/**
 * How many samples to submit in one settled iteration, at this throughput and traced size.
 *
 * 1 until something has been measured -- which is also the answer for a device so slow that one
 * sample already overruns the budget, and is what unblocks its next drag.
 */
export function settledBatchFor(throughput, pixels) {
  if (!(throughput > 0)) return 1;
  const wanted = Math.round((SETTLED_FRAME_MS * throughput) / Math.max(pixels, 1));
  return Math.max(1, Math.min(MAX_SETTLED_BATCH, wanted));
}
