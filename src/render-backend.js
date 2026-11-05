/*
  The render seam: one backend, one renderer, and this shape:

      render(request, { onStage, onProgress, onWarning })
                                                ->  { blob, adapter, samples, notes, cancelled? }
      cancel()                                  ->  nothing
      capabilities()                            ->  what this renderer can actually do

  There is no `discard()`: no server holds a result for it to release. A walk costs one scene's GPU
  memory because the renderer is shared and a replaced resource is retired.

  **Bytes at the seam, never a URL.** A URL handed over here would be fetched and turned into a
  second URL by the caller, and only the second would ever be revoked -- so "revoke every object
  URL" would read as satisfied while one leaked per tile. `imageUrlFrom()` below is the single place
  a URL is made.
*/
import { assetUrl } from './asset-base.js';
import { environmentImagePath } from './lighting-compass.js';
import { ensureScenePipeline } from './scene-pipeline.js';
import { Renderer } from './render/renderer.js';
import { capabilities, DEFAULT_VIEW_TRANSFORM } from './capabilities.js';
import { createRenderLock } from './render-lock.js';
/*
  Imported as well as re-exported below, and the two are not the same thing.

  `export { X } from '...'` forwards a name to this module's *consumers* and creates **no local
  binding** -- so a re-export alone leaves `nudge()`'s `setTimeout(..., SETTLE_MS)` a
  `ReferenceError` at the first pointer event. It is only observable by clicking the page and
  reading the console: this module imports `pathtrace.wgsl?raw`, so a plain module test cannot load
  it at all.
*/
import {
  SETTLE_MS, blendThroughput, interactiveScaleFor, settledBatchFor, tileRowsFor, bandsPerDrain,
  UNMEASURED_RENDER_THROUGHPUT,
} from './interactive-ladder.js';
// Ours, from the TIFF 6.0 specification: the download's linear float master. See `keepMaster()`.
import { encodeTiffFloat } from './tiff.js';
import { APP_SIGNATURE } from './version.js';

export { capabilities };

/*
  One device, one adapter, one set of pipelines, kept across renders.

  Creating a `GPUDevice` and compiling three shader modules per render is a cold start, and the
  studio submits one job at a time by construction, so there is never a second one to serve. The
  live trace below shares this same renderer: the picture on screen is promised to be the picture
  the download gives you, and two renderers could not keep that promise.
*/
let renderer = null;
let readyPromise = null;
let boundCanvas = null;

/**
 * The shared renderer, created against `canvas` the first time it is asked for.
 *
 * The canvas matters and is not incidental: `Renderer.create` configures a WebGPU context on it and
 * `present()` draws there. The live stage passes its own; a headless caller passes none and gets a
 * 1x1 offscreen one, because `readPixels()` is the only path that works without a compositor.
 */
export async function ready(canvas) {
  /*
    The check is against `boundCanvas` rather than against `renderer`, and that is deliberate rather
    than an accident of ordering. `boundCanvas` is assigned *before* the first `await`, so a second
    caller arriving while the first `Renderer.create()` is still in flight is refused; keying on
    `renderer` instead would let it through and hand it the first caller's tracer on somebody else's
    canvas, which renders perfectly into a canvas nobody is looking at.
  */
  if (canvas && boundCanvas && canvas !== boundCanvas) {
    throw new Error('The tracer is already bound to a different canvas.');
  }
  if (renderer) return renderer;
  if (!readyPromise) {
    boundCanvas = canvas ?? offscreenCanvas();
    readyPromise = (async () => {
      const created = await Renderer.create(boundCanvas);
      await created.loadLuts().catch((error) => {
        created.device.destroy();
        // A download failure, which the page must not report as a missing GPU.
        error.assetFailure = true;
        throw error;
      });
      renderer = created;
      return created;
    })();
  }
  return readyPromise;
}

function offscreenCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  return canvas;
}

function encodePng(width, height, pixels) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').putImageData(
    new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0,
  );
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('the traced image could not be encoded'));
    }, 'image/png');
  });
}

/*
  The linear float master that rides beside the PNG, and the one-slot hand-off that carries it.

  The seam's result travels to the stage through `foldray:render-complete`, whose detail is built field
  by field, so a fifth member on the result would not arrive. The master is therefore left here for
  exactly one caller to take, **keyed on the PNG blob it was made with**: a taker holding a
  different picture's blob gets nothing rather than the wrong master, so the order of the two calls
  is not what makes this correct.

  One slot rather than a map: nothing here knows when a tray entry goes away, and a map keyed on a
  blob would hold every picture of the session alive. Once taken, the master's lifetime is the
  entry's, and `disposeEntryImages()` is what ends it.
*/
let pendingMaster;

async function keepMaster(active, blob, samples) {
  try {
    const linear = await active.readPixelsLinear();
    const bytes = encodeTiffFloat({
      ...linear, description: `Path-traced, ${samples} samples, scene-linear Rec.709, straight alpha`,
      software: APP_SIGNATURE,
    });
    pendingMaster = { blob, tiff: new Blob([bytes], { type: 'image/tiff' }) };
  } catch (error) {
    // Never fatal to the render: the PNG is already made. It reports through the button instead.
    pendingMaster = { blob, error: error.message || String(error) };
  }
}

/**
 * The linear float master of `blob`, once, or nothing if the last one made was of another picture.
 */
export function takeMaster(blob) {
  if (!blob || pendingMaster?.blob !== blob) return undefined;
  const master = pendingMaster;
  pendingMaster = undefined;
  return master;
}

/*
  The authored world's dump, kept per scene. It is a build asset, so one answer each, and the
  camera path below asks for one on every frame of an orbit.
*/
const worldDumps = new Map();

// A lost device never comes back, and a reload discards the tray: say so before sending anyone to it.
const RELOAD_ADVICE = 'Save the session and download the renders in the tray, then reload the page.';

async function worldDumpFor(envScene) {
  if (!worldDumps.has(envScene)) {
    const url = assetUrl(`env/${envScene}.json`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load ${url} (HTTP ${response.status})`);
    worldDumps.set(envScene, await response.json());
  }
  return worldDumps.get(envScene);
}

/*
  The fields a camera orbit and the lighting controls move, and **an allowlist rather than a
  blocklist**: a field added to the request later differs its way to the full prepare instead of
  being skipped in silence.

  `camera` is `resolveCamera()`'s input; `lighting_setup` and `look` are `lightingScene()`'s and
  `resolveLighting()`'s. `buildScene()` and `sceneInputsFromRequest()` read none of the three --
  `request.` appears in `scene.js` only inside those two functions, and `request-scene.js` reads
  `structure_base64`, `filename`, `assembly` and `secondary_structure.method` alone.
*/
const AIM_FIELDS = new Set(['camera', 'lighting_setup', 'look']);
// Render settings the build never reads: `prepare()`, `resolveCamera()` and the loop's cap apply them.
const AIM_SETTINGS = ['denoising', 'denoiser', 'view_transform', 'live_sample_target', 'seed', 'depth_of_field'];

function sameValue(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length
      && a.every((item, index) => sameValue(item, b[index]));
  }
  const keys = Object.keys(a);
  const others = Object.keys(b);
  // A key present on one side and absent on the other is a difference, so the counts are compared
  // before the values -- `{ x: undefined }` and `{ y: undefined }` agree field by field otherwise.
  return keys.length === others.length
    && keys.every((key) => others.includes(key) && sameValue(a[key], b[key]));
}

/**
 * Whether `next` would build the geometry `previous` already built.
 *
 * `structure_base64` compares by identity -- one load makes the string once and every request
 * carries that same one (`request-scene.js`) -- so the megabyte is never walked.
 */
function sameGeometry(previous, next) {
  if (!previous) return false;
  const [a, b] = [geometryView(previous), geometryView(next)];
  for (const field of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (AIM_FIELDS.has(field)) continue;
    if (!sameValue(a[field], b[field])) return false;
  }
  return true;
}

// The request minus the Output card's size and sample count, which only Create Image reads.
function liveView(request) {
  const { width, height, samples, ...rest } = request.render_settings ?? {};
  return { ...request, render_settings: rest };
}

function geometryView(request) {
  const view = liveView(request);
  const settings = { ...view.render_settings };
  for (const field of AIM_SETTINGS) delete settings[field];
  return { ...view, render_settings: settings };
}

/*
  Everything a request says about the world, resolved once.

  Shared by the one-shot render and the live trace so the two cannot disagree about which
  environment is loaded or where the camera is -- which is the same "one answer" argument the
  geometry layer is built on, one level up.

  **`geometry: false` is the camera path, and it is this same function rather than a second one.**
  An orbit re-enters here once per animation frame, and rebuilding the scene there is a sweep, a
  primitive interleave and six replaced GPU buffers per frame for geometry nobody moved -- 3RGK
  `cartoon` 59 ms and `cartoon_railed` 105 + 24, measured under node. Everything below the build
  runs either way, so the camera, the lighting and all five render settings land as on a full build.
*/
async function prepare(
  active, request, onStage = () => {}, { geometry = true, onWarning = () => {} } = {},
) {
  if (geometry) onStage('Loading structure', 'Reading the structure and building the scene.');
  const {
    sceneInputsFromRequest, buildScene, resolveCamera, resolveLighting, lightingScene,
  } = await ensureScenePipeline();
  let scene = null;
  if (geometry) {
    const inputs = await sceneInputsFromRequest(request);
    /*
      A heavy build is announced before it starts and the page is given a paint to show it: the
      build holds the main thread, and a warning queued behind it would arrive with the picture.
      An empty list takes it down again, whether the build finished or threw.
    */
    let warned = false;
    const warn = async (sentences) => {
      warned = true;
      onWarning(sentences);
      await afterPaint();
    };
    try {
      scene = await buildScene(inputs, { onWarning: warn });
    } finally {
      if (warned) onWarning([]);
    }
  }
  const camera = resolveCamera(request);
  const envScene = lightingScene(request);
  const worldDump = await worldDumpFor(envScene);
  if (active.environmentScene !== envScene) {
    await active.loadEnvironment(assetUrl(environmentImagePath(envScene)));
    active.environmentScene = envScene;
  }
  const lighting = resolveLighting(request, worldDump, envScene);
  if (scene) await active.setScene(scene);
  active.setCamera(camera, lighting, 8);
  /*
    One filter in two configurations, never two algorithms. `auto` schedules
    `min(1, sqrt(reference / frames))`: full strength to 64 samples, then falling -- 0.71 at 128,
    0.25 at 1024. It approaches zero and never arrives, so a final render is filtered too, lightly;
    `off` is the only no-op. The constructor's default stays `off` so a measurement harness gets the
    raw tracer; this is the call site that is the product.

    **`render_settings.denoising` has to be read here.** Without it the Output card's checkbox
    reaches the request and nothing else, so unticking it renders a denoised picture with nothing
    saying so -- a silent substitution, and the one this file is least entitled to make: the
    invariant is that strength 0 is bit-identical to the raw path, which is only a promise worth
    anything if the user can ask for it. Off means `off` rather than a strength of zero, because
    those are the same picture and the second one still runs the filter.
  */
  active.denoiseMode = request.render_settings?.denoising === false ? 'off' : 'auto';
  /*
    **`render_settings.view_transform` has to be read here too.**

    Without it the Output card's select reaches the request and stops there, so every picture comes
    out through Filmic whatever it says -- the same silence as `denoising` above: a control that
    reaches nothing.

    An id this renderer does not apply resolves to the default rather than refusing, and **no id
    the page offers takes that branch**: `index.html`'s options and `capabilities().viewTransforms`
    are equal. The fallback stays because a query string and a
    session document can both still name anything. "Refuse rather than substitute" is about
    geometry -- a representation drawn as a different representation is unrecoverable, and a tone
    curve is a setting the user can see and change.
  */
  const named = request.render_settings?.view_transform;
  active.viewTransform = capabilities().viewTransforms.includes(named)
    ? named : DEFAULT_VIEW_TRANSFORM;
  active.backdrop = 0;
  /*
    And backdrop 3 on the canvas, which is the same picture premultiplied.

    A WebGPU context has no straight-alpha mode, so a transparent film reaching a canvas has to be
    premultiplied or composited. On an `alphaMode: 'opaque'` context the alpha channel is simply
    dropped, and the Alpha backdrop's checkerboard sits behind an opaque canvas, visible only until
    the first frame lands. `readPixels()` reads `backdrop`, so the download and every recorded
    picture are untouched by this (`src/render/renderer.js`).
  */
  active.canvasBackdrop = 3;
  /*
    The sampler seed offset the request names. 0 is the product's own value and a bit-exact no-op,
    which is what makes byte-identity checkable at all -- and the recorded renders do not come
    through here: `renderExactly()` sets `renderer.seed` itself, so no recorded picture can move
    with this line. A document written before the field existed carries none and gets 0, which is
    what it was rendered with.
  */
  active.seed = Number.isInteger(request.render_settings?.seed) ? request.render_settings.seed : 0;
  /*
    Straight alpha out of the display pass, not premultiplied. `backdrop = 0` makes `present.wgsl`
    return `vec4f(rgb, alpha)`, which is only the right pair while `rgb` has been divided by the
    coverage. This changes nothing today; it is here because a future `false` would silently
    double-premultiply every downloaded picture rather than fail.
  */
  active.unpremultiply = true;
  return scene;
}

/*
  One renderer, one holder at a time. `src/render-lock.js` carries the argument and the tests; what
  it settles here is that the endless live trace and the finite one-shot render can share a tracer
  without one of them writing into the other's scene.

  **A render claims the renderer and the live trace parks.** They are not symmetrical and must not
  be: a render is a job with an end, so it queues; the live trace is endless, so it waits out every
  claim at the top of each iteration, and only then takes a turn for its own prepare.
*/
const lock = createRenderLock();

/*
  Live traces resting on their cap. A claim that ends wakes them, because nothing else would and the
  claim may have left its own scene and size in the renderer (a cancelled or failed Create Image).
*/
const restingTraces = new Set();

function wakeRestingTraces() {
  // A macrotask, so a finished render's own mode change lands first and no scene is rebuilt for a
  // stage that has already left Live.
  setTimeout(() => { for (const wake of restingTraces) wake(); }, 0);
}

/*
  ==================== HOW THE LOOP YIELDS, AND WHY IT IS TWO ANSWERS ====================

  Between iterations the trace has to give the page a turn. Which turn depends on whether anybody
  is looking.

  **Visible: `requestAnimationFrame`.** It paces the loop to the display and lets input, layout and
  paint happen. Without it the trace starves the very interaction it is dropping resolution for.

  **Hidden: a `MessageChannel` message, and this is the answer rather than the fallback.** Every
  browser throttles `requestAnimationFrame` in a background tab and most stop it altogether, so on
  that alone switching tabs **freezes the live trace** -- which is precisely the thing a converging
  picture promises it will not do, and precisely what a
  person does when they start a twenty-minute render and go and do something else. (The one-shot
  `traceOnce()` above does not have this problem: it awaits `onSubmittedWorkDone()` and nothing
  else, so **Create Image keeps going in a hidden tab.** Only the endless loop would stall.)

  **`setTimeout` is not the answer and would look like one.** Chrome clamps timer chains in a
  background tab to one second after thirty seconds hidden, and to one *minute* under intensive
  throttling after five -- so a `setTimeout(0)` yield would converge for five minutes and then
  crawl, which reads as a bug that only appears when nobody is watching. A `MessageChannel`
  message is a macrotask and not a timer, so none of that applies to it; it is the same reason
  schedulers reach for one.

  The requirement, in those terms: start a good render and walk away. It stays the user's decision
  in the sense that matters -- leaving *Live* still stops the GPU, because that is a mode change
  and this is not.
*/
/*
  Pixels sampled per millisecond on this device, shared by the live loop and the one-shot render.

  Kept as the live loop's own closure it leaves a final render -- the longest and heaviest thing
  this app does, and the one whose dispatch length the rest of the machine feels -- with no
  measurement at all, starting from nothing every time. There is one device and one answer to how
  fast it is; a second copy would be a second answer that disagreed on its first frame.
*/
let measuredThroughput = 0;

/*
  What a band is planned on before this device has been measured.

  0 is what `measuredThroughput` holds until an iteration has been timed cleanly, and every
  consumer answers it with "do not tile" -- the whole frame in one dispatch, which is the one thing
  `tileRowsFor()` exists to prevent. The live loop is where that bites, because `measurable` is
  false for exactly the iterations a resize or a scene change precedes: measured on a heavy scene,
  the first live iteration is a single **1358 ms** dispatch at `INTERACTIVE_SCALE` and the two
  after it are **167 and 115 ms** whole-frame dispatches at full size, because `SETTLE_MS` had
  already run out while the first one was in flight. On the slow end of the audience the same three
  are seconds, which is past Windows' 2 s reset timeout -- the device is lost, and the next reload
  starts from 0 again.

  `UNMEASURED_RENDER_THROUGHPUT` is the slow end of the audience, so the first bands are small and
  the first honest reading corrects them. It is a *plan*, not a measurement: nothing here feeds
  `blendThroughput()`.

  **The interactive scale is not planned this way and must not be.** `interactiveScaleFor()` reads
  `measuredThroughput` itself, where 0 means `INTERACTIVE_SCALE`; planning that on the slow
  laptop's number would open every page at the floor scale on a machine that never needed it.
*/
const plannedThroughput = () => (
  measuredThroughput > 0 ? measuredThroughput : UNMEASURED_RENDER_THROUGHPUT
);

let hiddenTick = null;

function yieldWhileHidden() {
  if (typeof MessageChannel !== 'function') {
    // No `MessageChannel` at all: a timer is throttled but it is not nothing, and a host without
    // one is not a host this product is shipping to.
    return new Promise((resolve) => { setTimeout(resolve, 0); });
  }
  // One channel for the life of the page rather than one per iteration: a `MessageChannel` is two
  // ports and a task queue, and this runs several times a second for as long as somebody is away.
  if (!hiddenTick) {
    hiddenTick = new MessageChannel();
    hiddenTick.port1.start();
  }
  return new Promise((resolve) => {
    hiddenTick.port1.onmessage = () => resolve();
    hiddenTick.port2.postMessage(0);
  });
}

// A frame requested just before the tab hides never fires while it is hidden, so hiding ends the wait.
function nextFrame() {
  return new Promise((resolve) => {
    const done = () => {
      globalThis.document?.removeEventListener?.('visibilitychange', done);
      resolve();
    };
    globalThis.document?.addEventListener?.('visibilitychange', done);
    requestAnimationFrame(done);
  });
}

function yieldBetweenIterations() {
  const hidden = typeof document !== 'undefined' && document.hidden === true;
  if (hidden) return yieldWhileHidden();
  return nextFrame();
}

// Two frames: the first callback runs before the paint that shows what was just written, the second
// after it. A hidden page paints nothing, so there is nothing to wait for.
function afterPaint() {
  const hidden = typeof document === 'undefined' || document.hidden === true;
  if (hidden || typeof requestAnimationFrame !== 'function') return Promise.resolve();
  return nextFrame().then(nextFrame);
}

/**
 * Whether anything at all was drawn: alpha is coverage, so a film with none is not a picture.
 *
 * Read on straight RGBA -- `traceOnce()` sets `backdrop = 0` -- where alpha is the silhouette and
 * nothing else. One pass over the bytes, which is milliseconds against a render of seconds.
 */
function anyCoverage(pixels) {
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] !== 0) return true;
  }
  return false;
}

// Every render submitted and not yet finished, whether queued for its turn or tracing.
const jobs = new Set();

/*
  A cancel is a flag the sample loop reads between batches, and the status arrives through
  `onStage` like every other stage, so this returns nothing. The flag is each job's own: a job still
  queued for the lock keeps it, and a job submitted afterwards never sees it.
*/
export function cancel() {
  for (const job of jobs) job.cancelled = true;
}

/**
 * One picture, traced to a sample target and handed back as bytes.
 *
 * This is the tray, the sweep and the download -- everything that wants *a* picture rather than
 * the live one. The Live panel is `createLiveTrace()` below.
 */
export async function render(
  request, { onStage = () => {}, onProgress = () => {}, onWarning = () => {} } = {},
) {
  /*
    The claim is taken **before** the turn and given back **after** it, so the live trace is parked
    for the whole of this job rather than for the part of it that holds the queue. Both are released
    in the same `finally` for the same reason: a render that throws must not wedge the renderer for
    everything after it -- a sweep would then stall on its next tile and read as a tracer that
    stopped -- and a claim that leaked would park the live trace for the life of the page.
  */
  const job = { cancelled: false };
  jobs.add(job);
  const resume = lock.suspend();
  const release = await lock.take();
  try {
    return await traceOnce(request, job, { onStage, onProgress, onWarning });
  } finally {
    jobs.delete(job);
    // Still inside the turn; the live trace re-sizes after any claim.
    renderer?.releaseFilm();
    release();
    resume();
    wakeRestingTraces();
  }
}


/**
 * Claim the renderer for a job made of several renders, and hand back the function that ends it.
 *
 * `render()` claims its own span, which is the whole of a single picture; this is for the caller
 * that makes *many* in a row and does not want the live trace waking up in the gaps. A Styles walk
 * is the one that exists: `src/main.js` holds one of these for as long as the strip reports the
 * walk busy, so the trace parks once rather than rebuilding a scene per tile.
 */
export function claimRenderer() {
  const end = lock.suspend();
  return () => {
    end();
    wakeRestingTraces();
  };
}

async function traceOnce(request, job, { onStage, onProgress, onWarning }) {
  if (job.cancelled) {
    onStage('Cancelled', 'The trace was stopped.');
    return { cancelled: true };
  }
  const settings = request.render_settings ?? {};
  const width = settings.width ?? 1024;
  const height = settings.height ?? 1024;
  const samples = Math.max(1, settings.samples ?? 128);

  onStage('Starting the tracer', 'Asking for a WebGPU adapter.');
  const active = await ready();
  const scene = await prepare(active, request, onStage, { onWarning });
  active.resize(width, height);
  const unallocated = await active.allocation;
  if (unallocated) throw new Error(unallocated);

  onStage('Rendering', `Tracing ${samples} samples at ${width}x${height}.`);
  onProgress({ phase: 'final', samples_completed: 0, samples_total: samples, percent: 0 });

  /*
    **The dispatch, which is what the rest of the machine waits on.**

    A GPU switches between applications between dispatches and not inside one, so a whole-frame
    dispatch is how long the compositor, the browser and every other window queue behind this
    render -- once per sample, for its whole length. Measured on the 15 W laptop with a second
    browser process watching: at 1024 square, where a whole frame is ~330 ms, the watcher fell to
    **7 frames a second against 56 idle**; at 256 square, where a dispatch is 28 ms, it held 36.
    **No submit batch reaches this** -- a batch of 32 was no worse than a batch of 1, because the
    queued work was never what anybody was waiting on.

    So the sample is cut into bands, and the cost of cutting it is small until the bands get silly:
    at 1024 square, 0.6-1.9% anywhere from 512 rows down to 32, then 4.5% at 16 and 11.2% at 8.
    `TILE_FRAME_MS` sits above that knee. It cannot move a pixel -- every band computes the same
    film coordinate it would have as part of one dispatch, and that identity is held to the hash --
    seven cases at three band sizes, all identical to the untiled render.

    Nothing measured yet plans for the slow end of the audience rather than a whole frame: the
    first two batches are both unmeasured, and at 3840 square one whole-frame dispatch is seconds.
  */
  active.tileRows = tileRowsFor(plannedThroughput(), width, height);

  /*
    `queue.submit()` returns immediately, so a bare loop would queue every batch at once and then
    wait. Awaiting `onSubmittedWorkDone()` per batch bounds the queue, yields to the event loop so
    the status repaints, and gives Stop a place to be honoured.

    **The batch is what Stop and the progress readout wait on, and nothing else** -- responsiveness
    is the dispatch above. A flat batch of 8 is up to 2.5 s between pressing Stop and it being
    honoured on a 15 W laptop, for a product whose first rule about the trace is that the user is
    what stops it. Measured from the same number as everything else, floored at one.
  */
  const batchFor = () => Math.max(1, settledBatchFor(measuredThroughput, width * height));
  const started = performance.now();
  // The first batch builds its bind groups inside its own span -- `resize()` above dropped
  // `pipelinesReady`, and on a device's first build the shader modules compile there too -- so its
  // timing would tell the ladder this device is ten times slower than it is. The live loop's
  // `measurable` flag is the same guard for the same reason.
  let measurable = false;
  while (active.frames < samples) {
    if (job.cancelled) {
      onStage('Cancelled', 'The trace was stopped.');
      return { cancelled: true };
    }
    /*
      **A lost device is checked here, and it is a termination condition rather than a nicety.**
      `sample()` on a dead device raises no error of its own and advances no frame, so this loop's
      only exit -- `frames < samples` -- is never reached: the render spins, holds `render-lock.js`
      for the life of the page, and takes the live trace and every later render with it. Seen on the
      software adapter, where a canvas swap chain drops the device within four seconds; a driver
      reset is the same shape on real hardware. Failing releases the lock through `render()`'s own
      `finally` and reaches the user as a message rather than as a spinner.
    */
    if (active.lost) {
      throw new Error(`the WebGPU device was lost while rendering. ${RELOAD_ADVICE}`);
    }
    /*
      **And the failures that lose no device and raise nothing either**: a shader that did not
      compile, a pipeline that did not validate, a buffer the GPU refused. `renderer.fatal` carries
      the first of them. Without this check the loop runs to its sample target over a film nothing
      wrote and reports Complete -- measured: 32 samples, alpha 0 everywhere, "Complete" on the
      status line, and the whole account in `diagnostics`, which nothing on the page reads.
    */
    if (active.fatal) throw new Error(active.fatal);
    const batch = Math.min(batchFor(), samples - active.frames);
    const span = performance.now();
    /*
      Stop is bounded by draining the queue, not by reading a flag more often.

      The flag is read per band here too, but that is not what makes it work: `sample()` submits at
      CPU speed, so the loop is finished long before the GPU is and the wait is on work already
      queued. `bandsPerDrain()` is what bounds that wait, planned like the band above until the
      second batch has been measured.
    */
    await active.sampleDraining(batch, {
      until: () => job.cancelled,
      drainEvery: bandsPerDrain(plannedThroughput(), width, active.bandRows()),
    });
    await active.device.queue.onSubmittedWorkDone();
    if (job.cancelled) {
      onStage('Cancelled', 'The trace was stopped.');
      return { cancelled: true };
    }
    if (measurable) {
      measuredThroughput = blendThroughput(
        measuredThroughput, width * height * batch, performance.now() - span,
      );
      active.tileRows = tileRowsFor(measuredThroughput, width, height);
    }
    measurable = true;
    const elapsed = (performance.now() - started) / 1000;
    const rate = active.frames / Math.max(elapsed, 1e-6);
    onProgress({
      phase: 'final',
      samples_completed: active.frames,
      samples_total: samples,
      percent: (active.frames / samples) * 100,
      eta_seconds: (samples - active.frames) / Math.max(rate, 1e-6),
    });
  }

  onStage('Reading back', 'Copying the finished image off the GPU.');
  // Raised on the last batch, after the loop's own check: the flag is set from a promise.
  if (active.fatal) throw new Error(active.fatal);
  const { pixels } = await active.readPixels();
  /*
    **A render can succeed and still be blank, and this is the one thing that notices.**

    `setScene()` refuses a composition that produced no geometry, so by the time a render reaches
    here there is something in front of the camera and the film should carry a silhouette. Alpha
    reads 255 on a dropped dispatch exactly as it does on a traced one, `readPixels()` throws
    nothing and the exit code is clean, so a picture with no coverage at all is the only observable
    a failed trace leaves behind.

    **Refused rather than reported.** A transparent PNG in the tray labelled Complete is the
    failure this product class dies of; and the one honest way to render nothing -- pointing the
    camera away from the structure -- is named in the message rather than silently allowed, because
    a person who did that can see it in the preview and a person whose tracer failed cannot.
  */
  if (!anyCoverage(pixels)) {
    throw new Error('this render came back empty: every pixel is transparent, so nothing was drawn.'
      + ' Either the camera is pointing away from the structure, or the tracer produced nothing.');
  }
  const blob = await encodePng(width, height, pixels);
  await keepMaster(active, blob, active.frames);
  onStage('Complete', `Traced ${active.frames} samples on ${active.adapterInfo}.`);
  return {
    blob,
    adapter: active.adapterInfo,
    samples: active.frames,
    notes: scene.notes,
  };
}

/*
  The interaction quality ladder, and it is a **resolution** schedule rather than a second renderer.

  No second renderer: one path tracer produces the interactive frame and the final picture, and only
  resolution and sample count differ. A rasterised fast mode would rebuild the Preview/Result gap
  this product exists to close. So a moving camera gets fewer pixels of the same tracer, never a
  different one -- and the denoiser is the same filter at a different strength, which is what makes
  a seed offset of 0 and a strength of 0 bit-exact no-ops.

  **Both rungs of that ladder are measured on the device rather than fixed**, which is what
  `src/interactive-ladder.js` is: the constants, the control law and the argument, in a module a
  plain module test can load -- this file imports `pathtrace.wgsl?raw`, which is a Vite transform,
  so nothing that lives *here* can be tested by anything but a browser.

  **It is not re-exported from here, and that is deliberate rather than tidy.** `export { X } from
  '...'` forwards a name to consumers and creates no local binding, so re-exporting the ladder
  leaves the one use inside this file unbound -- a `ReferenceError` in `nudge()`. Every consumer
  imports the ladder from the ladder, which leaves exactly one place each name is spelled.
*/

/**
 * The live trace: the Live panel, which converges to its sample target and rests there while it is
 * on the stage.
 *
 * **`render_settings.live_sample_target` is a cap.** It is counted in samples rather than
 * in seconds, so it is the same bound on every device and the picture it stops at is the same
 * picture -- which is the whole of why a wall-clock backstop is refused. Nothing is disposed
 * when it is reached: the accumulator, the scene and the size all stay, and everything that resets
 * the picture starts the loop again from zero. A request that names no target is uncapped, which is
 * what a caller outside the shell gets. What the picture converged to travels with it, because a
 * render you can download is a render whose convergence you can state.
 *
 * The one thing that stops accumulation is a change: moving the camera or editing a control resets
 * the accumulator, drops to `INTERACTIVE_SCALE` and turns the denoiser to full, then climbs back
 * once the input settles.
 *
 * **`onError` is not optional decoration.** Two things can fail in here and without a channel both
 * are silent: a request that cannot be built into a scene -- a secondary-structure method that
 * answers for no residue is the reachable one, and `secondary-structure.js` writes a whole
 * sentence about what to choose instead -- and a lost device. `update()` only queues the request,
 * so `scheduleTraceUpdate()`'s own `try` never sees either; the throw lands in an unawaited
 * promise, the picture freezes at the last good frame and nothing on the page says why. A scene
 * that will not build reports and **keeps that last good
 * frame up**, which is the same judgement `scheduleTraceUpdate()` already makes about a half-typed
 * colour; a lost device reports and stops, because there is nothing left to sample.
 */
export function createLiveTrace({
  canvas, onFrame = () => {}, onError = () => {}, onWarning = () => {},
} = {}) {
  let active = null;
  let running = false;
  let disposed = false;
  /*
    **Paused means the stage is not showing this picture.** It is
    a different word from parked and they must not be confused: parking is this loop waiting its
    turn on a renderer somebody else is using, and it ends by itself; a pause ends only when the
    user comes back to the Live panel. Nothing here disposes -- the accumulator, the scene and the
    device all stay -- so `resume()` can go on adding samples to the picture that was already there.
  */
  let paused = false;
  let interacting = false;
  let settleTimer = 0;
  let stageWidth = 0;
  let stageHeight = 0;
  let request = null;
  let notes = [];
  let pending = null;
  // Set by `nudge()`, cleared by the loop. See `nudge()` for why the two are separated.
  let retarget = false;
  /*
    `lock.takeovers` as of the last moment the loop had the renderer to itself. One mark for every
    way back in -- a park, a rest, a pause -- because each is the same question, and three copies
    would drift. Taken where the loop starts using the renderer, never just
    before a park: `suspend()` has already counted a render by the time the loop sees it.
  */
  let ownedAt = -1;
  // Resting on the cap: out of the lock's sight, so a claim that ends has to wake it.
  let resting = false;
  // A prepare in flight, which `update()` must not short-circuit past: `request` is still the old one.
  let preparing = false;

  /*
    Pixels sampled per millisecond on this device, at this size, on this scene -- an exponential
    average over the iterations that measured cleanly, and 0 until one has.

    One number rather than a tier, because it is the only thing either half of the ladder needs and
    because it re-measures itself continuously: a scene that gets heavier, a window that gets
    bigger, a laptop that drops to its battery profile all move it without anything having to notice
    that they did.
  */
  /*
    Whether the next iteration's timing is worth believing.

    It is not, twice: right after a resize or a scene change, because `resize()` and `setScene()`
    both drop `pipelinesReady` and the next `sample()` therefore rebuilds every bind group inside the
    span being timed -- and a scene change pays a BVH build beside it. On a device's first build the
    three shader modules compile there as well: tens of milliseconds against a frame of five, so a
    single unguarded reading would tell the ladder the device is ten times slower than it is and it
    would take a dozen good frames to walk that back.
  */
  let measurable = false;

  const traced = () => {
    const scale = interacting
      ? interactiveScaleFor(measuredThroughput, stageWidth, stageHeight) : 1;
    return {
      width: Math.max(16, Math.round(stageWidth * scale)),
      height: Math.max(16, Math.round(stageHeight * scale)),
    };
  };

  /*
    One sample while the input is moving, always: the point there is to come back and look at the
    nudge flag, not to accumulate. Once settled, whatever fits in `SETTLED_FRAME_MS`.
  */
  const batchSize = () => (
    interacting ? 1 : settledBatchFor(measuredThroughput, active.width * active.height)
  );

  // The cap, or no cap for a request that names no target: `buildRenderRequest()` always writes
  // one, and a caller that does not gets an uncapped loop rather than a number it never chose.
  const sampleTarget = () => {
    const target = request?.render_settings?.live_sample_target;
    return Number.isFinite(target) && target > 0 ? target : Infinity;
  };

  /*
    Retarget the accumulator, and **resize only when the size actually changed.**

    `renderer.resize()` reallocates five buffers and drops `pipelinesReady`, so the next `sample()`
    rebuilds every bind group. That is the right cost when the stage really is a different size and
    it is entirely wasted when it is not -- and `nudge()` fires once per pointer event, so paying it
    there would put that rebuild in the middle of every drag, which is the one thing the interactive
    ladder exists to prevent.

    What a nudge actually needs is `reset()`: zero the accumulator and the guide, keep the buffers.
    `active.width` is 0 until the first real resize, so the first call always takes the resize
    branch and `reset()` is never reached before there is a buffer to zero.
  */
  function sizeTo(width, height) {
    if (active.width === width && active.height === height) active.reset();
    else active.resize(width, height);
  }

  /*
    The queued request, built -- and the settle window restarted **here, not at the click**.

    `nudge()` starts it when the control moves, and the rebuild outlasts `SETTLE_MS` on anything
    past a small protein, so the frame that finally carries the change would be drawn at full stage
    resolution while a drag (which restarts the window every pointer event) stays cheap.
    Re-nudging once the scene has landed gives an edit the rung a rotate gets. It cannot move a
    picture: the accumulator is a mean over samples, so a rung decides when frames appear.
  */
  async function applyPending() {
    if (!pending) return;
    const next = pending;
    pending = null;
    // `request` is null after a takeover whatever was queued (`forgetSceneIfTakenOver()`), so
    // somebody else's scene always gets the full prepare.
    const rebuild = !sameGeometry(request, next);
    preparing = true;
    let scene;
    try {
      scene = await prepare(active, next, undefined, { geometry: rebuild, onWarning });
    } finally {
      preparing = false;
    }
    if (scene) notes = scene.notes;
    request = next;
    retarget = true;
    // A new scene drops `pipelinesReady`, so the next iteration rebinds inside its own timing.
    // Off on the camera path too: re-measuring mid-drag is a change the ladder did not ask for.
    measurable = false;
    nudge();
  }

  /*
    **Coming back to a renderer somebody claimed is a change.** Without this, Create Image on the
    live stage leaves its own size and scene in the bind group and the loop goes on sampling a
    1024x1024 accumulator into a 976x686 canvas. `request` is dropped **whatever
    is queued**, because it is what `applyPending()` reads to keep the geometry: kept while an undo
    is queued, Live would trace the render's scene under controls that name another. A plain turn
    (`capture()`) counts no takeover and keeps the samples.
  */
  function forgetSceneIfTakenOver() {
    if (lock.takeovers === ownedAt) return;
    if (!pending && request) pending = request;
    request = null;
  }

  // Registered with `restingTraces` for the life of the trace.
  const wake = () => { if (resting) loop(); };

  async function loop() {
    if (running || disposed || paused || !active) return;
    resting = false;
    running = true;
    try {
      while (!disposed && !paused) {
        /*
          Park on a claim or a turn and re-check rather than proceed. `quiet()` before `held()`
          because a Styles walk is many turns with a free queue between them (`render-lock.js`).
        */
        const busy = lock.quiet() ?? lock.held();
        if (busy) {
          await busy;
          // One yield, so a finished render's pause lands before this rebuilds for a stage that left Live.
          await yieldBetweenIterations();
          continue;
        }
        forgetSceneIfTakenOver();
        ownedAt = lock.takeovers;
        if (pending) {
          /*
            The prepare is a turn, taken with nothing awaited since the check above, so a render
            pressed mid-build queues behind it rather than having this build's `setScene()`,
            `setCamera()` and `sizeTo()` land inside its own (which fails on `ImageData`, or traces
            the live scene when the sizes agree).
          */
          const release = await lock.take();
          try {
            await applyPending();
          } catch (error) {
            // The request could not be built into a scene. Say so once -- `pending` is already
            // cleared -- and keep whatever was up rather than blanking the picture.
            onError(error);
          } finally {
            release();
          }
          if (disposed || paused) break;
          // A claim that arrived during the prepare has not run yet: park for it at the top.
          if (lock.quiet() || lock.takeovers !== ownedAt) continue;
        }
        if (!request) break;
        if (active.lost) {
          onError(new Error(`the WebGPU device was lost, so the trace stopped. ${RELOAD_ADVICE}`));
          break;
        }
        // The same termination condition for the failures that lose nothing: see `renderer.fatal`.
        // Without it the count climbs to `live_sample_target` and rests there over a blank stage,
        // which is exactly what a converged picture looks like.
        if (active.fatal) {
          onError(new Error(active.fatal));
          break;
        }
        /*
          Everything a nudge asked for, applied here and only here -- and `retarget` is cleared
          rather than the size being reconciled every frame, because `sizeTo()` at an unchanged size
          *resets the accumulator*: that is what a nudge means. Doing it once per iteration would
          zero the trace every frame and the picture would never converge at all.
        */
        // `!active.width` is a failed allocation (`renderer.resize()`), which nothing may sample into.
        if (retarget || !active.width) {
          retarget = false;
          const size = traced();
          const allocation = active.allocation;
          sizeTo(size.width, size.height);
          if (active.allocation !== allocation) {
            // A resize rebuilds the pipelines inside the next timed span; a reset does not.
            measurable = false;
            // Out of memory is not a throw: unread, the count climbs over a blank canvas.
            const unallocated = await active.allocation;
            if (lock.takeovers !== ownedAt) continue;
            if (unallocated) {
              onError(new Error(unallocated));
              break;
            }
          }
        }
        /*
          The cap, read after `retarget` has been applied rather than before it, because a nudge
          zeroes the accumulator and the count this tests has to be the one it now holds -- that is
          what makes resting a state the picture comes out of by itself.

          It **breaks** rather than idling on a promise: `nudge()`, `update()`, `resume()` and the
          end of a claim (`wakeRestingTraces()`) each start the loop again.
        */
        const target = sampleTarget();
        if (active.frames >= target) {
          resting = true;
          break;
        }
        /*
          The timed span is the batch, the display pass and the wait for the GPU to finish both --
          which is what an iteration costs, and therefore the right thing to pace on. The rAF wait
          below is deliberately outside it: that is the time the loop gives *back*, and folding it
          in would have the ladder measure the display's refresh rate rather than the device.

          **Clamped to the cap**, so the trace lands on the target rather than wherever the settled
          batch happens to overshoot to -- which would be a different picture on every adapter, and
          would leave `traceReadout()`'s `samples < target` meaning something other than "still
          climbing". The same `Math.min` `render()` above makes, for the same reason.
        */
        const batch = Math.min(batchSize(), target - active.frames);
        /*
          **The display pass is skipped while the tab is hidden**, and it is not a small saving:
          `present()` runs the denoiser, which is seven full-screen compute dispatches, and then a
          render pass into a canvas no compositor is reading. Sampling is the only thing worth doing
          for a viewer who is not there.

          The picture is not lost by it. The accumulator is untouched -- `present()` only *reads* it
          -- so the first iteration after the tab comes back presents everything accumulated while
          it was away. What the viewer can see is at most one iteration of stale canvas on return,
          which is the same 100 ms the settled batch is sized to.
        */
        const showing = !(typeof document !== 'undefined' && document.hidden === true);
        // Set every iteration rather than on resize: the estimate moves under a heavier scene and a
        // slower battery profile, and this is one multiply. Planned rather than measured, because
        // 0 here is one whole-frame dispatch -- see `plannedThroughput()`.
        active.tileRows = tileRowsFor(plannedThroughput(), active.width, active.height);
        const started = performance.now();
        active.sample(batch);
        if (showing) active.present();
        await active.device.queue.onSubmittedWorkDone();
        // A render claimed during the wait may already have resized: neither its count nor the
        // timing is this picture's. The submitted work is safe (`retire()` waits it out).
        if (lock.takeovers !== ownedAt) continue;
        if (measurable) {
          measuredThroughput = blendThroughput(
            measuredThroughput, active.width * active.height * batch, performance.now() - started,
          );
        }
        measurable = true;
        onFrame({
          samples: active.frames,
          width: active.width,
          height: active.height,
          interacting,
          notes,
          adapter: active.adapterInfo,
        });
        await yieldBetweenIterations();
      }
    } catch (error) {
      // Sampling, presenting or the read-back itself failed. Nothing here can be retried into a
      // picture, so the loop ends -- but it ends out loud rather than in an unawaited promise.
      onError(error);
    } finally {
      running = false;
    }
  }

  /*
    A change the accumulator cannot keep: the camera moved, a control changed, the stage resized.
    Drop to the interactive resolution, and set a timer to climb back. Each call restarts the timer,
    so a drag is one settle rather than one per pointer event -- and `applyPending()` calls it again
    once the new scene exists, so a single edit's window is timed from the frame that carries it.

    **It raises a flag and touches no renderer state.** This is called from pointer handlers and
    from a `ResizeObserver`, which fire whenever the browser likes -- including in the middle of
    the loop's own `await`, and including while a one-shot render holds the tracer. Retargeting the renderer
    from here would therefore resize an accumulator somebody else is sampling into, which is the
    exact defect the lock above exists to prevent, reached by the one path that never asked for a
    turn. The loop applies it, after it has parked, at a moment when the renderer is nobody else's.

    The `loop()` calls are the wake for a trace resting on the cap, and they are why `resize()` and
    the settle timer need nothing of their own. Both return at once while the loop is running.
  */
  function nudge() {
    interacting = true;
    retarget = true;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      interacting = false;
      retarget = true;
      loop();
    }, SETTLE_MS);
    loop();
  }

  return {
    async start(initial) {
      active = await ready(canvas);
      if (!disposed) restingTraces.add(wake);
      pending = initial;
      loop();
    },
    /** A new request: same trace, new scene. The accumulator resets because the picture changed. */
    update(next) {
      // Width, height and samples reach the request from the Output card on every keystroke, and
      // resetting a converged picture over a change it cannot show is an accumulator thrown away.
      if (request && !pending && !preparing && sameValue(liveView(request), liveView(next))) {
        request = next;
        return;
      }
      pending = next;
      nudge();
      loop();
    },
    /*
      Stop sampling, keep everything.

      **This is the whole of "the app does not render when the stage is not showing the trace".**
      The product promises a converging picture in the Live panel, and a promise about a panel is not a
      promise about a tab being open: leaving it must stop the GPU, not hide it. The
      loop exits at its own next check rather than being torn down, so nothing is disposed and no
      sample is thrown away.
    */
    pause() {
      paused = true;
    },
    /*
      Come back, and **keep the samples if the renderer is still the one we left**.

      Convergence is the product, so re-entering the panel must not restart the picture that was
      already there -- a glance at Preview would otherwise cost every sample taken so far. Whether
      somebody else has had the renderer meanwhile is `forgetSceneIfTakenOver()`'s question, asked
      by the loop this starts.
    */
    resume() {
      if (!paused) return;
      paused = false;
      loop();
    },
    /** Whether the trace is stopped because the stage is showing something else. */
    paused: () => paused,
    resize(width, height) {
      stageWidth = width;
      stageHeight = height;
      nudge();
    },
    /*
      What the download gets: **the picture on screen, at this moment, at the size it is on screen.**

      That is the product's promise and this is where it is kept, so a capture taken
      while the stage is still moving is the interactive-resolution picture rather than a full-size
      one the viewer never saw. That is the promise rather than a shortfall of it; a caller that
      wants the full-size render should let the trace settle, or ask `render()` for its own.
    */
    async capture() {
      if (!active) throw new Error('Nothing has been traced yet');
      // A turn rather than a park: `readPixels()` runs the display pass, submits it and maps a
      // staging buffer, so it is a job with an end and it queues like one.
      const release = await lock.take();
      try {
        // Not this trace's picture yet: a claim left its own scene and size (a cancelled Create
        // Image under a resting trace), or the controls have moved past what is accumulated.
        if (pending || !request || lock.takeovers !== ownedAt) {
          throw new Error('The live trace is catching up. Press Quick Image again once it has a frame.');
        }
        // As render() refuses: a dead or failed tracer reads back a film nothing wrote.
        if (active.lost) throw new Error(`the WebGPU device was lost. ${RELOAD_ADVICE}`);
        if (active.fatal) throw new Error(active.fatal);
        const { width, height, pixels } = await active.readPixels();
        const blob = await encodePng(width, height, pixels);
        await keepMaster(active, blob, active.frames);
        return {
          blob,
          adapter: active.adapterInfo,
          samples: active.frames,
          notes,
        };
      } finally {
        release();
      }
    },
    dispose() {
      disposed = true;
      restingTraces.delete(wake);
      clearTimeout(settleTimer);
    },
  };
}

/**
 * The one place an object URL is made for a picture.
 *
 * The seam hands back bytes, so whichever caller needs a URL makes the only one -- and
 * `disposeEntryImages()` revokes it. Two URLs for one picture is how a sweep leaks one per tile.
 */
export function imageUrlFrom(result) {
  return result.blob ? URL.createObjectURL(result.blob) : undefined;
}
