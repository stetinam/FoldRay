/*
  Preview / Result / Compare, the shared result collection, kept tray, A/B pinning and backdrop.

  One rule governs the whole module: **the Mol* canvas is never resized and never unmounted.**
  Result and Compare are overlays inside `.viewer-panel`, and the live view is hidden with
  `visibility: hidden` -- never `display: none`, and never the `hidden`
  attribute, both of which collapse the box so Mol* resizes to the new one. Camera, structure and
  selection state therefore survive a trip through Compare untouched. That is also why Compare shows
  static pictures only and never a live viewport.

  **The live trace is a panel of its own, and that is what makes four modes rather than three.**
  Folding it into Result as two states inside one mode -- `activeId === undefined` live, an id a
  still -- does not survive what the stage has to promise:

    preview   Mol*, for orbiting, picking and selecting. Nothing is sampled.
    live      the converging trace, on `#trace-canvas`. The only mode in which anything is sampled,
              and the camera the user orbits is still Mol*'s -- see the pointer note below.
    render    a finished picture from the tray. Still, zoomable, finishable, downloadable.
    compare   two of those, held against each other.

  **A mode is what the trace is started and stopped by**, so a state hidden inside one cannot be:
  were "the user is looking at a still" and "the user has left the picture" the same mode, a pause
  could not tell them apart. Four modes make it one word. `activeId` says *which* still is up and is
  defined exactly when `mode === 'render'`. There is no `data-result` beside it: a mode and an
  attribute saying the same thing in two files is exactly how the two come to disagree.

  **Live is the one mode whose pointer belongs to something else.** The stage layer is opaque and
  covers the Mol* canvas, but it does not take the pointer: `styles.css` gives `#stage` and the
  result surface `pointer-events: none` in this mode, so a drag, a wheel and a pinch land on the
  canvas underneath and Mol*'s own trackball moves the camera. That camera is the camera the request
  carries (`main.js`'s `cameraJson()`), so the trace follows the orbit with nothing here re-deriving
  a view -- one camera, one answer, and the interaction is Mol*'s rather than an imitation of it.

  **`#stage-render-image` is an `<img>` and the trace is a canvas, and neither can be the other.**
  `src/render-zoom.js` reads `naturalWidth`/`naturalHeight` off the image and `styles.css` matches
  it as `.stage-surface img`. A live trace has no intrinsic size to magnify -- the stage resizes and
  it re-traces -- and it must stay on one canvas for the life of the page, because
  `Renderer.create()` configures a WebGPU context on that canvas and `ready()` refuses a second. So
  pan and zoom belong to the still, and the trace stays where `readPixels()` and `renderExactly()`
  already drive it.

  **Every URL in this module is ours**, made by `imageUrlFrom()` from the bytes the seam hands back,
  so `disposeEntryImages()` revokes unconditionally rather than testing for `blob:` -- no URL here
  is ever somebody else's to keep.

  **`masterUrl` is the TIFF**, and the name says whose bytes they are. `src/tiff.js` writes the file
  and `readPixelsLinear()` supplies the samples, so it is this renderer's own second read-back of
  the picture the PNG is made from rather than anything a server left behind. It obeys every rule
  the PNG obeys: the same entry, the same backdrop, the same file name with one extension changed,
  and the same single revoke. It is 32-bit float and scene-linear -- before the view transform and
  unclamped, for editing elsewhere -- so the two files differ by the tone curve too.

  Most of this is *view* state. Image finishing is the narrow exception: its small numeric recipe is
  saved so a loaded session can apply it to its first new render. Its range inputs live outside
  `.app-shell`, keeping them out of composition Undo/Redo; this module announces their changes
  explicitly so the session dirty tracking still sees them.

  main.js talks to this module through document events rather than method calls. The stage needs
  three things from it -- "a render finished", "a structure is loading" and "the live trace is
  up" -- and an event seam keeps it that way. **The imports that are not events are
  `imageUrlFrom` and `takeMaster`**, and they are here rather than in `main.js` on purpose: the entry owns the URL's
  lifetime and `disposeEntryImages()` is what revokes it, so making it anywhere else would put the
  two halves of "revoke every object URL" in different files. It costs this module its importability
  outside the bundler -- `render-backend.js` pulls three `.wgsl?raw` modules only Vite resolves. The
  viewport Download and Apply buttons go back over the seam the same way, because acting on them
  needs things this module deliberately does not have: the structure bytes a settings file must
  embed, and any ability to read a picture off the renderer.
  What main.js gets in return is the small read/write API below -- `markSaved()` -- which is data
  access, not user action.

  Each entry in the strip is:

    id             monotonic integer, never reused. Pins hold these, never indexes.
    url            an object URL for this picture's bytes. Ours, and revoked when the entry goes.
    masterUrl      the same picture as a linear 32-bit float TIFF. Ours too, and revoked with the entry.
    label          'Render 3' -- what the user sees, and what a file saved from it is named after.
    settings       the src/session-format.js render snapshot: this render's settings *without*
                   the structure. Undefined only for an entry seeded by an event that carried none.
    savedImage     the user has downloaded this picture.
    savedSettings  the user has written these settings to disk, or they came from a file.

  A snapshot deliberately holds no structure; see createRenderSnapshot() for why that is the fact
  the whole feature rests on.
*/

import { announceOverlayOpen, coordinateOverlay } from './overlay-coordinator.js';
// The one place an object URL is made for a picture. `foldray:render-complete` carries bytes, and
// two URLs for one picture is how a sweep leaks one per tile.
import { imageUrlFrom, takeMaster } from './render-backend.js';
import { compositeOverLinear, decodeTiff, encodeTiffFloat } from './tiff.js';
import { sessionFilename } from './session-format.js';
import { triggerDownload } from './download.js';
import {
  automaticPostProcessing,
  createPostProcessor,
  defaultPostProcessing,
  isNeutralPostProcessing,
  loadPostProcessImage,
  normalizePostProcessing,
  POST_PROCESS_CONTROLS,
  postProcessingLabel,
} from './post-processing.js';

// The tray is a deliberately smaller projection of the result collection. Draft Style candidates
// stay available from their Style tiles without flooding this row; manual, full-quality and
// explicitly kept results enter it. It is session-scoped memory: a session file holds the current
// settings only, so nothing in this row is ever written to disk except by an explicit download.
const HISTORY_LIMIT = 24;
const CANDIDATE_LIMIT = 64;
const RESULT_LIMIT = 100;
export const TRAY_REMOVAL_LIMIT = 3;

const BACKDROPS = ['alpha', 'white', 'black'];

// How far a pointer travels before a press on a thumbnail becomes a reorder instead of a click.
const DRAG_THRESHOLD = 4;

// A wheel notch in "lines" mode, in pixels of the strip. Chrome reports pixels; Firefox reports
// lines, and 0 or 3px of scroll per notch would read as a dead scroll wheel.
const WHEEL_LINE_HEIGHT = 16;

/*
  A slot is a side of the screen, not a label, and the chips say so. "A" on its own left the user to
  work out which of the two pictures in front of them it named -- and the answer is not the same
  sentence in all three layouts, so the chip is where it has to be written down.
*/
const SLOT_SIDE = {
  a: 'It is the left side in Wipe and Split, and the back layer in Overlay.',
  b: 'It is the right side in Wipe and Split, and the front layer in Overlay.',
};

const LAYOUT_NAMES = { wipe: 'Wipe', split: 'Split', overlay: 'Overlay' };

/*
  The crop guide: what a non-square output will actually frame, drawn over the live canvas.

  Both surfaces preserve the *vertical* field of view, and only that. Mol*'s `camera.state.fov` is
  the vertical angle -- mol-canvas3d/camera.js builds the frustum as `top = near * tan(fov / 2)`
  and then `width = aspect * height` -- and `pathtrace.wgsl` puts the aspect term on X alone, which
  is the same statement about the same axis. The requested resolution
  never reaches the camera, so an aspect change moves the horizontal half-angle alone, in exact
  proportion to width / height.

  Relative to the live view, therefore, the render frames the middle

      (width / height) / (canvasWidth / canvasHeight)

  of what is on screen, centred, with the vertical framing identical. Below 1 the sides are lost,
  and the rules and dimmed margins say exactly where. At 1 or above nothing on screen is lost: the
  render reaches further out than the preview can show, so the margins collapse to nothing and the
  rules sit on the edges, which is the same statement with no crop in it.

  It is measured against the *canvas*, not against the panel and not against a square, and the
  stage here is responsive, so there is no fixed box to measure instead: the guide is sized and
  positioned to the canvas's own box on every refresh rather than to `inset: 0`. A pixel of drift is
  a lot in a rule that claims to say where the edge of the picture is. On a stage wider than it is
  tall a 1024x1024 render frames only the middle of what is on screen, and that is exactly why the
  guide does *not* gate on squareness. Gating on `width === height` would hide it for a square
  render, the one whose crop nobody expects. The condition is the crop.

  It is decoration, so the element tree is built here rather than authored in index.html: a new id
  in the page has to be argued for and this needs none. It is `aria-hidden`,
  `pointer-events: none`, holds no control and nothing focusable, and it writes no control -- so it
  can never reach the capture-phase change/input listener main.js uses for session dirty tracking.
  It adds no field to the render request; the request already carries width and height, and this
  reads them.
*/
function initCropGuide(viewerPanel) {
  const widthInput = document.querySelector('#render-width');
  const heightInput = document.querySelector('#render-height');
  if (!widthInput || !heightInput) return undefined;

  const guide = document.createElement('div');
  guide.className = 'crop-guide';
  guide.dataset.active = 'false';
  // Nothing here is content and nothing here is a control: the numbers it draws are already in the
  // Output card, where a screen reader can read them as text.
  guide.setAttribute('aria-hidden', 'true');
  ['left', 'right'].forEach((side) => {
    const dim = document.createElement('div');
    dim.className = `crop-guide-dim crop-guide-dim-${side}`;
    const rule = document.createElement('div');
    rule.className = `crop-guide-rule crop-guide-rule-${side}`;
    guide.append(dim, rule);
  });
  // Absolutely positioned inside the panel, so it is outside the stage's layout flow entirely and
  // the canvas is the same box with it shown and with it hidden.
  viewerPanel.append(guide);

  let scheduled;

  /*
    The live view's box, in the panel's own coordinates. Reading the canvas rather than the panel
    is what keeps the rules honest to the pixel: Mol*'s 1px border sits between the two. The panel
    is the fallback for the moment before Mol* has mounted a canvas -- which here is until the
    dynamic import of `preview-canvas.js` settles -- when there is nothing on screen for a rule to
    be wrong about anyway.
  */
  function liveBox() {
    const panel = viewerPanel.getBoundingClientRect();
    const canvas = viewerPanel.querySelector('#viewer canvas')?.getBoundingClientRect();
    const box = canvas && canvas.width > 0 && canvas.height > 0 ? canvas : panel;
    if (!(box.width > 0) || !(box.height > 0)) return undefined;
    return {
      left: box.left - panel.left, top: box.top - panel.top, width: box.width, height: box.height,
    };
  }

  /*
    Undefined means "nothing to draw": unreadable numbers, or an output that crops nothing.

    The test is the crop, not the shape. Squareness looks like the right condition and is not: the
    tracer's aspect term is on X alone and Mol*'s `fov` is vertical, so both sides fix the *vertical*
    field and scale horizontally by their own aspect, and what a render keeps is
    `(width / height) / (liveWidth / liveHeight)`. A stage wider than it is tall therefore loses the
    sides of a square output. Hiding the guide for square output would hide it in the one case that
    catches people out.

    A fraction of 1 or more crops nothing horizontally (the render reaches at least as wide as the
    preview can show), and that is the only case with nothing to say.
  */
  function fractionIn(box) {
    const width = Number(widthInput.value);
    const height = Number(heightInput.value);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined;
    if (width <= 0 || height <= 0) return undefined;
    if (!box) return undefined;
    const fraction = (width / height) / (box.width / box.height);
    // Sub-pixel slivers are noise, not information: below half a pixel of margin there is nothing
    // a 1px rule could honestly draw.
    if (Math.abs(1 - fraction) * box.width < 1) return undefined;
    return fraction;
  }

  function refresh() {
    const box = liveBox();
    const fraction = fractionIn(box);
    guide.dataset.active = String(fraction !== undefined);
    if (fraction === undefined) return;
    guide.dataset.extends = String(fraction >= 1);
    // Sized to the canvas, never to the panel. These four are the only geometry written here, and
    // they cannot reflow anything: the element is absolutely positioned and takes no space.
    guide.style.left = `${box.left}px`;
    guide.style.top = `${box.top}px`;
    guide.style.width = `${box.width}px`;
    guide.style.height = `${box.height}px`;
    // One custom property drives all four children, because the crop is centred: the margin lost
    // on the left is the margin lost on the right. Clamped at 0, which is what makes an output
    // wider than the live view collapse the margins instead of inverting them.
    const inset = Math.min(50, Math.max(0, ((1 - fraction) / 2) * 100));
    guide.style.setProperty('--crop-inset', `${inset.toFixed(3)}%`);
  }

  // Coalesced onto one frame, and always a frame *later* than whatever triggered it: a capture
  // listener runs before the target's own handler, and #render-quality-profile's handler is what
  // writes the two inputs for a profile change.
  function schedule() {
    if (scheduled !== undefined) return;
    if (typeof window.requestAnimationFrame !== 'function') {
      refresh();
      return;
    }
    scheduled = window.requestAnimationFrame(() => {
      scheduled = undefined;
      refresh();
    });
  }

  /*
    Listen-only, and deliberately broad. The two inputs are written silently by session restore,
    by undo/redo and by the quality profile, none of which announce it, so there is no one event
    to subscribe to. Re-reading two values after an interaction costs nothing and cannot go stale
    the way a timer or a single hook would. Nothing here dispatches an event.
  */
  ['change', 'input', 'click', 'keyup'].forEach((type) => {
    document.addEventListener(type, schedule, true);
  });
  ['foldray:render-restore', 'foldray:render-complete', 'foldray:structure-loading'].forEach((type) => {
    document.addEventListener(type, schedule);
  });
  // The kept fraction is measured against the live view's aspect, so a window resize changes it.
  // The guide cannot resize what it is measuring -- it is absolute and takes no space -- so this
  // cannot feed itself.
  if (typeof ResizeObserver === 'function') new ResizeObserver(schedule).observe(viewerPanel);

  refresh();
  return { refresh, element: guide };
}


export function initStageModes({ renderZoom } = {}) {
  const viewerPanel = document.querySelector('.viewer-panel');
  if (!viewerPanel) return undefined;

  const modeButtons = {
    preview: document.querySelector('#stage-preview'),
    live: document.querySelector('#stage-live'),
    render: document.querySelector('#stage-render'),
    compare: document.querySelector('#stage-compare'),
  };
  const previewCameraViewActions = document.querySelector('#preview-camera-view-actions');
  const previewCameraFraming = document.querySelector('#preview-camera-framing');
  const renderSurface = document.querySelector('#stage-render-surface');
  const renderImage = document.querySelector('#stage-render-image');
  const renderViewport = document.querySelector('#stage-render-viewport');
  const postProcessPreview = document.querySelector('#post-process-preview');
  const postProcessToggle = document.querySelector('#stage-post-process-toggle');
  const postProcessPanel = document.querySelector('#post-process-panel');
  const postProcessClose = document.querySelector('#post-process-close');
  const postProcessAuto = document.querySelector('#post-process-auto');
  const postProcessReset = document.querySelector('#post-process-reset');
  const postProcessStatus = document.querySelector('#post-process-status');
  const postProcessUndo = document.querySelector('#post-process-undo');
  const postProcessRedo = document.querySelector('#post-process-redo');
  const postProcessInputs = new Map(POST_PROCESS_CONTROLS.map(({ id }) => [
    id, postProcessPanel?.querySelector(`[data-post-process="${id}"]`),
  ]));
  let postProcessor;
  try {
    postProcessor = createPostProcessor(postProcessPreview);
  } catch {
    // Mol* already requires WebGL, but a second context can still be refused. Rendering, viewing,
    // comparison and downloads remain fully usable; only the optional finishing panel is disabled.
    postProcessor = undefined;
  }
  const applySettings = document.querySelector('#stage-apply-settings');
  const applyStyle = document.querySelector('#stage-apply-style');
  const downloadImage = document.querySelector('#stage-download-png');
  const downloadMaster = document.querySelector('#stage-download-tiff');
  const downloadSettings = document.querySelector('#stage-download-set');
  const quickImage = document.querySelector('#stage-quick-image');
  const compareSurface = document.querySelector('#stage-compare-surface');
  const compareFrame = document.querySelector('#compare-frame');
  const compareImageA = document.querySelector('#compare-image-a');
  const compareImageB = document.querySelector('#compare-image-b');
  const compareWipe = document.querySelector('#compare-wipe');
  const compareDownload = document.querySelector('#compare-download-png');
  const layoutButtons = {
    split: document.querySelector('#compare-layout-split'),
    wipe: document.querySelector('#compare-layout-wipe'),
    overlay: document.querySelector('#compare-layout-overlay'),
  };
  const backdropGroup = document.querySelector('#stage-backdrops');
  const historyList = document.querySelector('#render-history');
  const historyWarning = document.querySelector('#render-history-warning');
  const removalUndo = document.querySelector('#render-removal-undo');
  const removalStatus = document.querySelector('#render-removal-status');
  const removalUndoButton = document.querySelector('#render-removal-undo-button');

  // `results` owns every image/settings pair. `history` contains references to the subset shown in
  // the bottom tray; a Style tile and the tray therefore never make two copies of one result.
  let results = [];
  let history = [];
  // Tray deletion is view state, not composition state. Keep a separate, bounded LIFO so Ctrl+Z
  // and the settings-only variants go on meaning exactly what `history.js` promises.
  let removedTray = [];
  let counter = 0;
  let mode = 'preview';
  let activeId;
  /*
    Two finishing recipes waiting to be used, and they differ in who asked and how loudly it lands.

    `pendingPostProcessing` is *armed*: a loaded session's saved adjustments, or the Style options
    panel's Improve image. It is consumed by the next render only, and that render announces it and
    opens the panel, because the user has not seen these numbers on this picture yet.

    `stickyPostProcessing` is what the user last actually looked at -- whatever `setEntryAdjustments()`
    last wrote, from a slider drag, Auto improve, Reset or a step through the panel's own history. It
    is not consumed: every later render inherits it silently, so tuning an image once means the next
    render of the same composition comes back looking the same instead of jumping back to the raw
    trace output. Reset writes a neutral recipe, which clears it, and that is the way out.

    Both are session-only and neither reaches a sweep-draft candidate: `registerCandidate()` does not
    consult either, so browsing thirty Styles at draft quality never inherits a finishing pass.
  */
  let pendingPostProcessing;
  let stickyPostProcessing;
  let postProcessBusy = false;
  let postProcessRevision = 0;
  let postProcessCommitTimer;
  // Set while the panel's own back/forward is applying a remembered state, so the writes it makes
  // are not recorded as a fresh adjustment and the ring cannot walk itself.
  let postProcessStepping = false;
  // What the render surface is currently showing, so `paint()` can tell "same render, repainted
  // for a pin change" from "a different render is now on the stage".
  let shownId;
  // Pins hold entry ids, not indexes: eviction must drop a pin, never silently repoint it at a
  // different render.
  let pins = { a: undefined, b: undefined };
  // Set by the first hand-made pin and never cleared while the strip lives: after it, auto-pinning
  // stops for good, because overriding an explicit choice is worse than a stale default.
  let manualPins = false;
  let layout = 'wipe';
  let wipe = 50;
  let backdrop = 'alpha';

  /*
    Whether there is anything to trace. Live *is* the converging trace, so the mode is reachable
    the moment a structure is loaded and never waits for a finished picture --
    which is the one thing this module cannot work out for itself, hence the third event on the seam
    (`foldray:live-trace-available`, cleared again by `foldray:structure-loading`).

    **It says "can be traced", not "is being traced", and the two are different.** Nothing
    starts a trace until Live is on the stage and nothing keeps one running once it leaves
    (`src/main.js`'s `foldray:stage-mode` listener), so entering the mode is what begins the picture and
    this flag is what makes entering it possible.
  */
  let liveAvailable = false;

  // What `foldray:stage-mode` last said, so the announcement below fires on a change rather than on
  // every repaint -- `paint()` runs on tray edits, pins and post-processing as well.
  let announcedStage;

  const entryById = (id) => results.find((entry) => entry.id === id);
  /*
    The two modes' gates, and they are two questions rather than one.

    Live needs a structure and nothing else -- entering it is what starts the picture, so a gate on
    a running trace would be a deadlock. Result needs a *finished* picture, which is what it shows;
    a settings-only entry has no image, so it can be loaded and re-saved but not shown or compared.
  */
  const canLive = () => liveAvailable;
  // A render removed from the tray is waiting on Undo, not on Result, so neither gate offers it.
  const canShowResult = () => results.some((entry) => entry.url && (entry.kept || entry.origin === 'style'));
  /*
    What Result puts up when it is asked for without a picture already chosen.

    **The tray first, and only then the wider collection.** Both are newest-first, so either would
    give "the most recent render" -- but `results` also holds sweep-draft candidates, which are
    256 px tiles that were never put in the tray, and answering the Result button with one of those
    would show a picture the user cannot see the provenance of. The tray is what is on screen.
  */
  const newestResult = () => history.find((entry) => entry.url)
    ?? results.find((entry) => entry.url && entry.origin === 'style');
  // Compare is also the place where A/B choices are disclosed. Keep it reachable whenever there
  // are at least two candidates, even if the user has cleared one or both current slots.
  const canOpenCompare = () => history.filter((entry) => entry.url).length >= 2;
  const isSaved = (entry) => entry.savedImage || entry.savedSettings;
  const unsavedCount = () => history.filter((entry) => !isSaved(entry)).length;


  function entryAdjustments(entry) {
    entry.adjustments ??= defaultPostProcessing();
    return entry.adjustments;
  }


  function disposeProcessedImage(entry) {
    if (!entry?.processedUrl) return;
    URL.revokeObjectURL(entry.processedUrl);
    entry.processedUrl = undefined;
  }


  /*
    Everything an entry owns, for an entry that is going away.

    Separate from disposeProcessedImage() because that one runs *during* an entry's life -- Improve
    image revokes the previous processed picture on every commit and on Reset -- and the source must
    survive all of it. An evicted entry that is merely dropped from the array leaks its picture for
    the life of the page, and a long Styles sweep evicts a lot of them.

    **Unconditional, with no test for `blob:`.** Every URL in this module was made by
    `imageUrlFrom()` from bytes the seam handed over, so such a test could only ever be true -- and
    a test that is always true is a guard nobody would notice failing.
  */
  function disposeEntryImages(entry) {
    disposeProcessedImage(entry);
    if (entry?.sourceUrl) URL.revokeObjectURL(entry.sourceUrl);
    // The float master is a second object URL for the same picture and goes the same way.
    if (entry?.masterUrl) {
      URL.revokeObjectURL(entry.masterUrl);
      entry.masterUrl = undefined;
    }
  }


  /*
    Improve image's own back/forward.

    It is deliberately not `history.js`: that ring holds createRenderSnapshot() payloads and
    restores the Mol* camera with them, while these nine values finish one already-rendered PNG.
    The stack therefore hangs off the result entry rather than the module, so stepping back always
    walks *this* picture's adjustments even after the stage has shown three other renders in
    between, and a render that leaves the tray takes its stack with it.

    Seeded in openPostProcessing() rather than lazily on the first edit: the seed has to be the
    state before that edit, and by the time a change event arrives the entry already holds the new
    one. Opening the panel is the only route to every control that records here, so seeding there
    is enough -- and seeding on open rather than on creation is what makes a session's loaded
    adjustments the baseline instead of an unreachable neutral behind them.
  */
  const POST_PROCESS_HISTORY_LIMIT = 24;

  function seedAdjustHistory(entry) {
    if (!entry || entry.adjustHistory) return;
    entry.adjustHistory = { states: [{ ...entryAdjustments(entry) }], index: 0 };
  }

  function recordAdjustHistory(entry) {
    if (!entry || postProcessStepping) return;
    seedAdjustHistory(entry);
    const ring = entry.adjustHistory;
    const next = { ...entryAdjustments(entry) };
    // A change event that landed on the value already showing -- a drag returned to where it
    // started, or Reset pressed twice -- is not a step.
    if (POST_PROCESS_CONTROLS.every(({ id }) => ring.states[ring.index][id] === next[id])) return;
    // Recording after stepping back drops the forward states, which is the ordinary undo bargain.
    ring.states.length = ring.index + 1;
    ring.states.push(next);
    if (ring.states.length > POST_PROCESS_HISTORY_LIMIT) ring.states.shift();
    ring.index = ring.states.length - 1;
    paintAdjustHistory();
  }

  // The entry is passed in by paint(), which resolves the shown render the same way the rest of
  // the surface does -- `activeId` alone is undefined while the newest render is only the fallback.
  function paintAdjustHistory(entry = entryById(activeId)) {
    if (!postProcessUndo || !postProcessRedo) return;
    const ring = entry?.adjustHistory;
    const locked = postProcessBusy || !postProcessor;
    postProcessUndo.disabled = locked || !ring || ring.index <= 0;
    postProcessRedo.disabled = locked || !ring || ring.index >= ring.states.length - 1;
  }

  async function stepAdjustHistory(delta) {
    const entry = entryById(activeId);
    const ring = entry?.adjustHistory;
    if (!entry || !ring || postProcessBusy || postProcessStepping) return;
    const next = ring.index + delta;
    if (next < 0 || next >= ring.states.length) return;
    postProcessStepping = true;
    try {
      // A debounced commit from the edit being stepped over would otherwise land after this one
      // and put the value back.
      window.clearTimeout(postProcessCommitTimer);
      postProcessCommitTimer = undefined;
      ring.index = next;
      setEntryAdjustments(entry, ring.states[next]);
      await previewPostProcessing(entry);
      await commitPostProcessing(entry);
      postProcessStatus.textContent = delta < 0
        ? 'Stepped back one adjustment'
        : 'Stepped forward one adjustment';
    } finally {
      postProcessStepping = false;
      paintAdjustHistory();
    }
  }


  function closePostProcessing({ focus = false } = {}) {
    if (!postProcessPanel) return;
    postProcessPanel.removeAttribute('data-open');
    postProcessPanel.setAttribute('aria-hidden', 'true');
    postProcessPanel.inert = true;
    postProcessToggle?.setAttribute('aria-expanded', 'false');
    renderViewport?.removeAttribute('data-post-process-preview');
    if (focus) postProcessToggle?.focus();
  }


  function positionPostProcessing() {
    if (!postProcessPanel?.matches('[data-open="true"]') || !postProcessToggle) return;
    const anchor = postProcessToggle.getBoundingClientRect();
    const panel = postProcessPanel.getBoundingClientRect();
    const left = Math.min(
      window.innerWidth - panel.width - 8,
      Math.max(8, anchor.right - panel.width),
    );
    const below = anchor.bottom + 6;
    const top = below + panel.height <= window.innerHeight - 8
      ? below
      : Math.max(8, anchor.top - panel.height - 6);
    postProcessPanel.style.left = `${Math.round(left)}px`;
    postProcessPanel.style.top = `${Math.round(top)}px`;
  }


  function paintPostProcessingValues(entry) {
    const adjustments = entry ? entryAdjustments(entry) : defaultPostProcessing();
    POST_PROCESS_CONTROLS.forEach(({ id }) => {
      const input = postProcessInputs.get(id);
      if (!input) return;
      input.value = String(adjustments[id]);
      const output = postProcessPanel.querySelector(`output[for="${input.id}"]`);
      if (output) output.textContent = postProcessingLabel(id, adjustments[id]);
    });
  }


  function openPostProcessing({ focus = true } = {}) {
    const entry = entryById(activeId);
    if (!entry?.url || !postProcessor || postProcessBusy || mode !== 'render') return false;
    seedAdjustHistory(entry);
    paintAdjustHistory();
    paintPostProcessingValues(entry);
    postProcessPanel.dataset.open = 'true';
    postProcessPanel.setAttribute('aria-hidden', 'false');
    postProcessPanel.inert = false;
    postProcessToggle.setAttribute('aria-expanded', 'true');
    announceOverlayOpen('post-process');
    positionPostProcessing();
    if (focus) postProcessInputs.get('exposure')?.focus();
    return true;
  }


  function readPostProcessing() {
    return normalizePostProcessing(Object.fromEntries(
      [...postProcessInputs].map(([id, input]) => [id, input?.value]),
    ));
  }


  async function sourceImage(entry) {
    entry.sourceImagePromise ??= loadPostProcessImage(entry.sourceUrl);
    return entry.sourceImagePromise;
  }


  async function previewPostProcessing(entry) {
    if (!entry || !postProcessor) return false;
    const revision = ++postProcessRevision;
    try {
      const image = await sourceImage(entry);
      if (revision !== postProcessRevision || entry.id !== activeId) return false;
      postProcessor.render(image, entryAdjustments(entry));
      renderViewport.dataset.postProcessPreview = 'true';
      renderZoom?.refresh();
      return true;
    } catch (error) {
      postProcessStatus.textContent = error.message || String(error);
      return false;
    }
  }


  /*
    **True when `entry.url` is the picture to save.**

    It returns false four ways and only one of them is a failure: no entry, no finishing panel at
    all, a revision a later commit has already superseded, an entry pruned out of `results` while
    this one awaited, and the throw. So a caller reading a bare `false` as "the adjustment failed"
    refuses on a page whose panel never started -- `createPostProcessor()` fails closed, and that
    is the case where `entry.url` is most certainly right, because it is the raw render untouched.

    Asked as the question a caller actually has, the answers separate: with no processor, and on a
    superseded revision, `entry.url` is a picture of this entry and a save is right to go ahead;
    only the throw and the pruned entry leave it holding something else. `entry.adjustmentError`
    carries the throw's sentence, because a boolean cannot.
  */
  async function commitPostProcessing(entry, { inherited = false } = {}) {
    if (!entry) return false;
    // No panel means no adjustment to apply, so the raw render is already the picture to save.
    if (!postProcessor) return true;
    const adjustments = entryAdjustments(entry);
    const revision = ++postProcessRevision;
    // A fresh attempt supersedes the last verdict, so the old sentence must not outlive it.
    entry.adjustmentError = undefined;
    if (isNeutralPostProcessing(adjustments)) {
      disposeProcessedImage(entry);
      entry.url = entry.sourceUrl;
      if (entry.id === activeId) renderViewport.removeAttribute('data-post-process-preview');
      paint();
      return true;
    }
    postProcessBusy = true;
    postProcessStatus.textContent = 'Applying…';
    try {
      const image = await sourceImage(entry);
      // Superseded: a later commit owns `entry.url` now, and what it holds is still this entry's
      // picture. Nothing failed, so nothing is refused.
      if (revision !== postProcessRevision) return true;
      postProcessor.render(image, adjustments);
      const blob = await postProcessor.blob();
      if (revision !== postProcessRevision) return true;
      // A pruned entry is past disposeEntryImages(), so a URL minted for it now is never revoked
      // -- and the one it holds is revoked already, which is not a picture anybody can save.
      if (!results.includes(entry)) return false;
      const nextUrl = URL.createObjectURL(blob);
      disposeProcessedImage(entry);
      entry.processedUrl = nextUrl;
      entry.url = nextUrl;
      entry.savedImage = false;
      if (entry.id === activeId) renderViewport.removeAttribute('data-post-process-preview');
      postProcessStatus.textContent = inherited ? 'Loaded adjustments applied' : 'Applied';
      paint();
      return true;
    } catch (error) {
      entry.adjustmentError = error.message || String(error);
      postProcessStatus.textContent = entry.adjustmentError;
      return false;
    } finally {
      postProcessBusy = false;
      paint();
    }
  }


  function setEntryAdjustments(entry, adjustments, { notify = true } = {}) {
    if (!entry) return;
    entry.adjustments = normalizePostProcessing(adjustments);
    /*
      The single writer of a result's adjustments is also the single place the carry-forward recipe is
      set, so every route into the panel -- a slider, Auto improve, Reset, the panel's own back and
      forward arrows -- makes the same promise without any of them having to remember to. A neutral
      recipe carries nothing, which is what makes Reset the way to stop the carry.
    */
    stickyPostProcessing = isNeutralPostProcessing(entry.adjustments)
      ? undefined
      : { ...entry.adjustments };
    paintPostProcessingValues(entry);
    postProcessToggle.dataset.adjusted = String(!isNeutralPostProcessing(entry.adjustments));
    if (notify) document.dispatchEvent(new CustomEvent('foldray:post-process-change'));
  }


  function schedulePostProcessCommit(entry) {
    window.clearTimeout(postProcessCommitTimer);
    postProcessCommitTimer = window.setTimeout(() => {
      postProcessCommitTimer = undefined;
      void commitPostProcessing(entry);
    }, 180);
  }


  function setMode(next) {
    if (next === 'live' && !canLive()) return;
    if (next === 'render' && !canShowResult()) return;
    if (next === 'compare' && !canOpenCompare()) return;
    /*
      Re-derive the automatic pair on the way *in*, never while Compare is already open. autoPin()
      is frozen while this mode shows except where it is forced, and entering is one of those
      moments: not "underneath the user", but the moment they ask what the default is.
      A hand-made pair is untouched -- autoPin() still returns early on `manualPins`.
    */
    if (next === 'compare' && mode !== 'compare') autoPin({ force: true });
    mode = ['live', 'render', 'compare'].includes(next) ? next : 'preview';
    if (mode !== 'render') closePostProcessing();
    /*
      `activeId` is defined exactly when Result is the mode, which is what makes the announcement
      below one word rather than a pair. Leaving Result forgets which still was up -- otherwise a
      picture chosen once would be what Result showed for the rest of the session -- and entering it
      without one chosen puts up the newest, which is the picture the user has just made.
    */
    if (mode !== 'render') activeId = undefined;
    else if (activeId === undefined) activeId = newestResult()?.id;
    // A render taken off the tray while it was on the stage was protected only by being there.
    pruneResults();
    // The attribute is what the stylesheet keys the canvas's `visibility` off. Nothing here
    // touches layout, so the canvas box is identical in all four modes.
    viewerPanel.dataset.stageMode = mode;
    /*
      The result surface is Live's as well as Result's, and it carries one control in each: Quick
      Image keeps the live trace exactly as it stands (the picture on screen is the picture you
      download), and everything else on it acts on a finished render and is hidden in Live
      rather than shown disabled. In Live the surface is transparent and takes no pointer, so the
      orbit underneath reaches Mol*.
    */
    renderSurface.hidden = mode !== 'render' && mode !== 'live';
    compareSurface.hidden = mode !== 'compare';
    /*
      **The backdrop is offered in all four modes**, Preview included.

      It can only be offered in Preview because `preview-canvas.js` takes a backdrop
      (`transparentBackground` for Alpha, a clear colour for the other two). Mol* clears its canvas
      to a colour no CSS rule can reach, so without that the three buttons would be a control that
      reached nothing. With it the checker means the same thing in all four modes: this is where the
      film has no coverage.
    */
    backdropGroup.hidden = false;
    /*
      **The camera row belongs to Live as well as Preview.**

      Live's camera *is* Mol*'s -- the stage layer takes no pointer in this mode and the orbit lands
      on the canvas underneath -- so Fit visible structure, Save camera view and Go to saved view
      drive exactly the same thing here that they drive in Preview, and every one of them already
      retargets the trace through `scheduleTraceUpdate()`. Withholding them in the mode the picture
      is actually being framed in would be the odd half of the pair.

      CSS uses visibility so this overlay never changes the canvas box; `inert` and `aria-hidden`
      keep the controls out of keyboard and assistive-technology navigation in the two image modes,
      which show a finished PNG and have no live camera to move.
    */
    const liveCamera = mode === 'preview' || mode === 'live';
    previewCameraViewActions.inert = !liveCamera;
    previewCameraViewActions.setAttribute('aria-hidden', String(!liveCamera));
    previewCameraFraming.inert = !liveCamera;
    previewCameraFraming.setAttribute('aria-hidden', String(!liveCamera));
    Object.entries(modeButtons).forEach(([name, button]) => {
      button.setAttribute('aria-pressed', String(mode === name));
    });
    paint();
  }


  function setBackdrop(next) {
    if (!BACKDROPS.includes(next)) return;
    backdrop = next;
    viewerPanel.dataset.backdrop = backdrop;
    backdropGroup.querySelectorAll('button').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.backdrop === backdrop));
    });
    /*
      The one part of the backdrop that is not CSS. Result, Compare and Live are all a matte behind
      something with an alpha channel, so the attribute above is the whole of it; the Mol* canvas is
      opaque WebGL and its clear colour is a render property no rule can reach, so `main.js` hands
      this to `preview-canvas.js`. Announced rather than called, like the rest of this seam.
    */
    document.dispatchEvent(new CustomEvent('foldray:backdrop-change', { detail: { backdrop } }));
  }


  /*
    Three ways to hold two pictures against each other, and the divider belongs to exactly one of
    them. Split gives each render its own half-width matte; Wipe and Overlay stack both panes on the
    whole frame, so those two register pixel for pixel and differ only in what is clipped away.
  */
  function setLayout(next) {
    layout = ['split', 'overlay'].includes(next) ? next : 'wipe';
    compareFrame.dataset.layout = layout;
    compareWipe.hidden = layout !== 'wipe';
    Object.entries(layoutButtons).forEach(([name, button]) => {
      button.setAttribute('aria-pressed', String(layout === name));
    });
    // What a download would write changes with the layout, and the button's title says which.
    paintCompareDownload();
    // The layouts give the images different mattes; re-resolve normalized pan against them.
    renderZoom?.refresh();
  }


  function setWipe(percent) {
    wipe = Math.min(100, Math.max(0, Math.round(percent)));
    compareFrame.style.setProperty('--wipe', `${wipe}%`);
    compareWipe.style.left = `${wipe}%`;
    compareWipe.setAttribute('aria-valuenow', String(wipe));
  }


  /*
    An object URL can still stop resolving -- a revoked entry the tray is repainting, or a picture
    the browser refused to decode -- and the browser's own answer to that is a broken-image glyph
    and no words at all. Take the dead source away -- exactly what an unfilled slot already does --
    and say so once through the render status, which main.js owns.

    Attach before assigning `src`: a source that fails synchronously on assignment still reports.
  */
  function watchImageLoad(image, entry) {
    image.onerror = () => {
      image.removeAttribute('src');
      image.alt = '';
      document.dispatchEvent(new CustomEvent('foldray:render-unavailable', {
        detail: { id: entry?.id, label: entry?.label },
      }));
    };
  }


  function paint() {
    /*
      No fallback to "the newest thing in the tray" inside this function. Which still is up is
      `setMode()`'s decision and it is made once, on the way into
      Result: a fallback here would put a picture back on a stage the user had just left, on every
      repaint, from a mode that is not showing stills at all.
    */
    const active = activeId === undefined ? undefined : entryById(activeId);
    if (active?.url) {
      // Zoom follows the image, not the stage: staying at 400% while switching modes is useful,
      // but inheriting a previous render's pan when a different one is put up is disorienting.
      if (active.id !== shownId) renderZoom?.fit();
      shownId = active.id;
      watchImageLoad(renderImage, active);
      renderImage.src = active.url;
      renderImage.alt = `${active.label}, a finished trace of this structure`;
    } else {
      // The still goes away with its alt, for the reason paintComparePane() gives, and the
      // transparent surface below lets the converging trace through.
      shownId = undefined;
      renderImage.removeAttribute('src');
      renderImage.alt = '';
    }
    /*
      **What the stage is showing, announced once per change.** `src/main.js` starts the live trace
      on it, stops it on every other mode, and nothing else does either -- so this is the seam's
      fourth event and it is the one that turns a mode into a picture, or into no picture at all.

      `live` is carried beside the mode rather than left to be re-derived: it is the one bit the
      listener acts on, and a second reading of the mode name in `main.js` is a second answer to a
      question this module has already answered. Deduplicated, because everything else `paint()`
      answers to -- a pin, a tray reorder, an Improve image commit -- leaves the mode where it was,
      and re-announcing would pause and resume a trace that never went anywhere.
    */
    if (mode !== announcedStage) {
      announcedStage = mode;
      document.dispatchEvent(new CustomEvent('foldray:stage-mode', {
        detail: { mode, live: mode === 'live' },
      }));
    }
    /*
      One normalized inspection state follows Result into Compare and can be driven from either
      Compare pane. Both images receive it together, so they remain registered pixel for pixel.

      `render-zoom.js` maps anything that is not `render` or `compare` to `preview`, so Live needs
      no case of its own and gets the right one: zooming a live trace is not the operation -- the
      stage resizes and it re-traces, at the new size, which is better than magnifying pixels -- so
      its controls leave the screen with the still they act on.
    */
    renderZoom?.setMode(mode);
    downloadImage.disabled = !active?.url;
    downloadImage.title = 'Download the picture currently shown';
    /*
      **A master is a fact about the picture, not about the button.** Every render made by this
      renderer has one; an entry that does not is one whose float read-back failed, and saying so
      here is the only place that failure can reach a person -- the PNG was already made by then, so
      nothing else went wrong to report.
    */
    downloadMaster.disabled = !active?.masterUrl;
    /*
      **Improve image is 8-bit by construction and the master is what it was applied to**, so where
      a recipe is on the two downloads are honestly different pictures and the button says which one
      this is. Baking the recipe in would mean a third copy of its constants and would throw away
      the depth the file exists for.
    */
    const finished = Boolean(active) && !isNeutralPostProcessing(entryAdjustments(active));
    downloadMaster.title = active?.masterUrl
      ? (finished
        ? 'Download the 32-bit float linear TIFF: before the view transform and Improve image'
        : 'Download the 32-bit float linear TIFF: the render before the view transform')
      : (active?.masterError
        ? `No float master: ${active.masterError}`
        : 'This picture has no float master');
    /*
      **Live's own action.** Quick Image reads the trace back into the tray rather than straight to
      disk, so what is on screen is what you get, and it is also something you can compare and
      apply. The button lives only in Live (`styles.css`), so `liveAvailable` is the whole of its
      condition.
    */
    quickImage.disabled = mode !== 'live' || !liveAvailable;
    downloadSettings.disabled = !active?.settings;
    applySettings.disabled = !active?.settings;
    applyStyle.disabled = !active?.styleId;
    // What the two Apply buttons act on is *a result*, and a live trace is not one. Saying so beats
    // a disabled control with the enabled control's tooltip still on it.
    const applyTitle = active
      ? 'Apply the exact settings that produced the result currently shown'
      : 'Pick a finished render from the tray to apply its settings';
    applySettings.title = applyTitle;
    applyStyle.title = active
      ? 'Apply only the Style used by the result currently shown'
      : 'Pick a finished render from the tray to apply its Style';
    downloadSettings.title = active
      ? 'Download the complete settings for the render currently shown'
      : 'Pick a finished render from the tray, or use File to save the current session';
    postProcessToggle.disabled = !active?.url || !postProcessor || postProcessBusy;
    postProcessToggle.dataset.adjusted = String(
      Boolean(active) && !isNeutralPostProcessing(entryAdjustments(active)),
    );
    // Switching which render is on the stage switches which stack the arrows walk.
    paintAdjustHistory(active);
    paintComparePane(compareImageA, entryById(pins.a), 'A');
    paintComparePane(compareImageB, entryById(pins.b), 'B');
    paintCompareDownload();
    modeButtons.live.disabled = !canLive();
    modeButtons.render.disabled = !canShowResult();
    modeButtons.compare.disabled = !canOpenCompare();
    paintHistory();
    paintRemovalUndo();
    paintEvictionWarning();
  }


  /*
    An unfilled slot shows the matte and nothing else.

    Taking `src` away is not enough: an `<img>` with no source still draws its `alt` string, so
    clearing a pin would leave that text sitting in the middle of the stage where the picture should
    be. The alt goes with the source here, and
    `.compare-pane img:not([src])` takes the box away with it, so there is nothing left to draw.
    When a slot *is* filled the alt names the render, which is what a screen reader needs.
  */
  function paintComparePane(image, entry, slot) {
    if (entry?.url) {
      watchImageLoad(image, entry);
      image.src = entry.url;
      image.alt = `${entry.label}, pinned as ${slot}`;
      return;
    }
    image.removeAttribute('src');
    image.alt = '';
  }


  /*
    Result can write what is on its stage to disk; so can Compare, and it is the same question --
    the comparison is the thing being looked at, so the comparison is what a download should be. It
    needs both slots: half a comparison is a render, and Result already downloads one of those.

    Composing it needs a fetch, which this module deliberately does not have, so the click leaves
    here as an event the way every other download does. What travels is the two urls, the layout and
    the divider position: enough for main.js to reproduce exactly what is on the stage.
  */
  function paintCompareDownload() {
    const a = entryById(pins.a);
    const b = entryById(pins.b);
    const ready = Boolean(a?.url && b?.url);
    compareDownload.disabled = !ready;
    compareDownload.title = ready
      ? `Download ${a.label} against ${b.label} as one PNG, laid out the way ${LAYOUT_NAMES[layout]} shows it`
      : 'Pick a render for A and one for B to download the comparison';
  }


  function paintRemovalUndo() {
    const latest = removedTray[0];
    removalUndo.hidden = !latest;
    if (!latest) return;
    removalStatus.textContent = `Removed ${latest.entry.label}.`;
    removalUndoButton.textContent = removedTray.length === 1
      ? 'Undo remove'
      : `Undo remove · ${removedTray.length}`;
    removalUndoButton.title = `Restore ${latest.entry.label} to the render tray`;
    removalUndoButton.setAttribute('aria-label', removalUndoButton.title);
  }


  function discardRemoval(entryId) {
    removedTray = removedTray.filter((record) => record.entry.id !== entryId);
  }


  /*
    Warn, never gate. Eviction stays plain FIFO and the render still happens; an entry the user
    already wrote to disk is safe to lose from here, which is the whole point of the saved marker,
    so the count of *unsaved* entries is what makes the warning worth reading.
  */
  function paintEvictionWarning() {
    const full = history.length >= HISTORY_LIMIT;
    historyWarning.hidden = !full;
    if (!full) return;
    const oldest = history[history.length - 1];
    const unsaved = unsavedCount();
    historyWarning.textContent = unsaved === 0
      ? `Strip full at ${HISTORY_LIMIT}. The next render drops ${oldest.label}; all ${history.length} are saved.`
      : `Strip full at ${HISTORY_LIMIT}. The next render drops ${oldest.label}. ${unsaved} of ${history.length} are not saved.`;
  }


  // Downloads belong to what is being viewed, not to the thumbnail that was used to reach it.
  async function saveActive(kind) {
    const entry = entryById(activeId);
    if (
      !entry
      || (kind === 'image' && !entry.url)
      || (kind === 'settings' && !entry.settings)
    ) {
      return;
    }
    /*
      Refuse rather than write a file that is not the picture on the stage. The adjustment threw,
      so `entry.url` still holds the previous blob or the unadjusted source; saving it hands the
      user a picture they can see is not the one they were looking at, under a filename that says
      it is. The panel's own line is inside a panel that is usually shut, so the sentence goes to
      the page's status line, which main.js owns -- but only the throw has one to say. A pruned
      entry has nothing left to save and nothing to report.
    */
    if (kind === 'image' && !await commitPostProcessing(entry)) {
      if (entry.adjustmentError) {
        document.dispatchEvent(new CustomEvent('foldray:render-save-failed', {
          detail: { label: entry.label, reason: entry.adjustmentError },
        }));
      }
      return;
    }
    document.dispatchEvent(new CustomEvent(`foldray:render-save-${kind}`, {
      detail: {
        id: entry.id,
        label: entry.label,
        url: entry.url,
        settings: entry.settings,
        backdrop: kind === 'image' ? backdrop : undefined,
        postProcessing: isNeutralPostProcessing(entryAdjustments(entry))
          ? undefined
          : { ...entryAdjustments(entry) },
      },
    }));
  }


  /*
    The float master, written from this module rather than announced.

    Every other download leaves as an event because acting on it needs something this module does
    not have -- the structure bytes, or the renderer. This one needs neither: the entry already owns
    the TIFF and its own file name comes out of the settings it also owns. The name matches the
    PNG's exactly, one extension apart, because both go through `sessionFilename()` with the
    structure the request names and the entry's label.

    **The backdrop is composited here for the same reason the PNG's is composited at save time**:
    it is a way of looking at the picture rather than part of it, and it is the user's current
    choice rather than the one in force when the render finished. Straight linear RGBA over a
    linear level, in float -- where the PNG's goes through a canvas and is rounded to 8.
  */
  const BACKDROP_LEVELS = { white: 1, black: 0 };

  async function saveMaster() {
    const entry = entryById(activeId);
    if (!entry?.masterUrl) return;
    const name = `${sessionFilename(
      entry.settings?.render_request?.filename,
      entry.label,
    ).replace(/\.[^.]+$/, '')}.tiff`;
    try {
      const response = await fetch(entry.masterUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error(`the master could not be read back (${response.status}).`);
      let blob = await response.blob();
      const level = BACKDROP_LEVELS[backdrop];
      if (level !== undefined) {
        const master = decodeTiff(new Uint8Array(await blob.arrayBuffer()));
        blob = new Blob([encodeTiffFloat({
          ...master,
          pixels: compositeOverLinear(master.pixels, level),
        })], { type: 'image/tiff' });
      }
      triggerDownload(blob, name);
      entry.savedImage = true;
    } catch (error) {
      // `masterError` shows only when there is no master, so a failed save says so here.
      document.dispatchEvent(new CustomEvent('foldray:render-save-failed', {
        detail: { label: entry.label, reason: error.message || String(error) },
      }));
    }
    paint();
  }


  function applyActive(kind) {
    const entry = entryById(activeId);
    if (!entry) return;
    if (kind === 'settings' && entry.settings) {
      document.dispatchEvent(new CustomEvent('foldray:render-restore', {
        detail: { id: entry.id, label: entry.label, settings: entry.settings },
      }));
    }
    if (kind === 'style' && entry.styleId) {
      document.dispatchEvent(new CustomEvent('foldray:style-apply', {
        detail: { styleId: entry.styleId },
      }));
    }
  }


  /*
    Tray order is the user's. `history` is newest-first until they say otherwise, and moving an
    entry moves it in that one array -- the same array the A/B default and the eviction warning
    both read, so nothing has a second opinion about the order.
  */
  function moveRender(id, index) {
    const from = history.findIndex((entry) => entry.id === id);
    if (from < 0) return false;
    const to = Math.min(Math.max(0, Math.trunc(index)), history.length - 1);
    if (to === from) return false;
    const next = history.slice();
    const [entry] = next.splice(from, 1);
    next.splice(to, 0, entry);
    history = next;
    // Unforced on purpose: the automatic pair follows the tray's first two entries, but never
    // while Compare is the mode on screen. Reordering is not a reason to swap the two images
    // someone is in the middle of comparing.
    autoPin();
    paint();
    return true;
  }


  /*
    Dragging one thumbnail past another. Pointer events rather than HTML5 drag-and-drop: one code
    path then covers mouse, pen and touch, the drag cannot leave the strip for a drop target that
    does not exist, and it needs no drag image -- the thumbnail itself is the drag image.

    Geometry is measured once, at pointerdown. The items are moved with `transform` while the drag
    is live, so nothing reflows and the rectangles stay true for the whole gesture; the array is
    reordered once, on release. `moved` is what tells a drag from a click, so releasing without
    crossing the threshold still opens the render the way a plain click always has.
  */
  let drag;
  // The entry whose click must be ignored because the gesture that produced it was a drag.
  let suppressedClickId;

  function dragTargetIndex(pointerCentre) {
    let to = drag.from;
    drag.rects.forEach((rect, index) => {
      if (index === drag.from) return;
      const centre = rect.left + rect.width / 2;
      if (index < drag.from && pointerCentre < centre) to = Math.min(to, index);
      if (index > drag.from && pointerCentre > centre) to = Math.max(to, index);
    });
    return to;
  }

  function paintDrag() {
    drag.items.forEach((node, index) => {
      if (index === drag.from) return;
      let shift = 0;
      if (drag.to > drag.from && index > drag.from && index <= drag.to) shift = -drag.step;
      if (drag.to < drag.from && index >= drag.to && index < drag.from) shift = drag.step;
      node.style.transform = shift ? `translateX(${shift}px)` : '';
    });
  }

  // A release off the items reaches no item listener and would leave `drag` set for the next press.
  function releaseOutside(event) {
    if (event.pointerId === drag?.pointerId) endDrag(event.type === 'pointerup');
  }

  function endDrag(commit) {
    if (!drag) return;
    const finished = drag;
    drag = undefined;
    window.removeEventListener('pointerup', releaseOutside);
    window.removeEventListener('pointercancel', releaseOutside);
    if (finished.captured) {
      // paint() replaces these nodes; a capture left on a detached one is never released.
      finished.items[finished.from].releasePointerCapture?.(finished.pointerId);
    }
    finished.items.forEach((node) => {
      node.style.transform = '';
      node.classList.remove('is-dragging');
    });
    historyList.classList.remove('is-reordering');
    if (finished.moved) {
      suppressedClickId = finished.id;
      window.setTimeout(() => { suppressedClickId = undefined; }, 0);
    }
    if (commit && finished.moved && finished.to !== finished.from) {
      moveRender(finished.id, finished.to);
      const thumb = historyList.querySelector(
        `.render-history-thumb[data-render-id="${finished.id}"]`,
      );
      thumb?.focus();
    }
    return finished.moved;
  }

  function startDrag(event, entry) {
    suppressedClickId = undefined;
    if (drag || history.length < 2 || (event.button ?? 0) !== 0) return;
    const items = [...historyList.children];
    const from = items.findIndex((node) => node.dataset.renderId === String(entry.id));
    if (from < 0) return;
    const rects = items.map((node) => node.getBoundingClientRect());
    drag = {
      id: entry.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      from,
      to: from,
      items,
      rects,
      // One entry's pitch, gap included, so the items that make way move exactly one slot.
      step: rects.length > 1 ? rects[1].left - rects[0].left : rects[0].width,
      moved: false,
    };
    window.addEventListener('pointerup', releaseOutside);
    window.addEventListener('pointercancel', releaseOutside);
  }


  /*
    Capture is taken when the drag *starts*, never on the press that might become one.

    Capturing on pointerdown retargets pointerup -- and the mouse events under it -- to the element
    holding the capture, so the browser then fires `click` on the item rather than on the thumbnail
    inside it. The thumbnail's own listener would never run, and clicking a tray entry would stop
    putting that render on the stage at all. By the time this is called the gesture is a drag, and
    the click it ends with is one this module suppresses anyway.
  */
  function captureDragPointer() {
    try {
      drag.items[drag.from].setPointerCapture(drag.pointerId);
      drag.captured = true;
    } catch {
      // A synthetic pointer event has no active pointer to capture. The drag still works: every
      // listener is on the item, which is where a test driver dispatches.
    }
  }

  function continueDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    if (!drag.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return;
      drag.moved = true;
      captureDragPointer();
      drag.items[drag.from].classList.add('is-dragging');
      historyList.classList.add('is-reordering');
    }
    drag.items[drag.from].style.transform = `translateX(${dx}px)`;
    const rect = drag.rects[drag.from];
    drag.to = dragTargetIndex(rect.left + rect.width / 2 + dx);
    paintDrag();
  }


  function paintHistory() {
    // A repaint mid-drag (a render landing) replaces the nodes and indexes the drag was measured on.
    if (drag) endDrag(false);
    historyList.replaceChildren();
    historyList.hidden = history.length === 0;
    historyList.dataset.compareMode = String(mode === 'compare');
    history.forEach((entry) => {
      const item = document.createElement('div');
      item.className = 'render-history-item';
      item.dataset.renderId = String(entry.id);
      item.classList.toggle('is-active', entry.id === activeId);
      item.classList.toggle('is-saved', isSaved(entry));
      item.addEventListener('pointerdown', (event) => {
        // The × and the A/B chip are their own gestures; only the thumbnail drags the entry.
        if (event.target.closest('.render-history-thumb')) startDrag(event, entry);
      });
      item.addEventListener('pointermove', continueDrag);
      item.addEventListener('pointerup', () => endDrag(true));
      item.addEventListener('pointercancel', () => endDrag(false));

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'render-history-remove';
      remove.dataset.renderId = String(entry.id);
      remove.textContent = '×';
      remove.title = `Remove ${entry.label} from the render tray`;
      remove.setAttribute('aria-label', remove.title);
      remove.addEventListener('click', () => removeFromTray(entry.id));
      item.append(remove);

      if (entry.url) {
        const thumb = document.createElement('button');
        thumb.type = 'button';
        thumb.className = 'render-history-thumb';
        thumb.dataset.renderId = String(entry.id);
        thumb.title = `Show ${entry.label} on the stage. Drag it, or hold Alt and press the left or right arrow, to reorder the tray.`;
        thumb.setAttribute('aria-label', thumb.title);
        const image = document.createElement('img');
        watchImageLoad(image, entry);
        /*
          **Off the main thread, because a thumbnail is 86px of a picture that is not.** The tray
          holds up to `HISTORY_LIMIT` = 24 entries and each `src` is the object URL of a *full*
          render -- 2048x2048 on the `high` profile -- so the first paint of one of these is a
          multi-megapixel decode for an 86px box, and `paintHistory()` rebuilds every one of them
          on every `paint()`: a mode button, a pin, a Save, a post-processing commit. `async` does
          not make the decode smaller; it takes it off the thread that has to stay responsive to
          the click that caused it. Nothing reads a thumbnail's pixels; `#stage-render-image` is
          deliberately left synchronous, because that one *is* the picture and an automated driver
          waits on it having decoded.
        */
        image.decoding = 'async';
        image.src = entry.url;
        image.alt = entry.label;
        // The browser's own image drag would otherwise start instead of the reorder gesture.
        image.draggable = false;
        thumb.append(image);
        thumb.addEventListener('click', () => {
          // A drag that ended over another thumbnail still finishes with a click. Ordering the
          // tray is not a request to put that render on the stage.
          if (suppressedClickId === entry.id) return;
          activeId = entry.id;
          setMode('render');
        });
        // Reordering without a pointer: the same move, on the control that already has focus.
        thumb.addEventListener('keydown', (event) => {
          if (!event.altKey || event.ctrlKey || event.metaKey) return;
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          const from = history.findIndex((candidate) => candidate.id === entry.id);
          if (moveRender(entry.id, from + (event.key === 'ArrowLeft' ? -1 : 1))) {
            historyList
              .querySelector(`.render-history-thumb[data-render-id="${entry.id}"]`)
              ?.focus();
          }
        });
        item.append(thumb);
      } else {
        // Adopted from a saved session: the settings survived in the file, the PNG never did.
        const placeholder = document.createElement('div');
        placeholder.className = 'render-history-thumb render-history-thumb-empty';
        placeholder.textContent = entry.label;
        placeholder.title = `${entry.label}: settings only, from a saved session`;
        item.append(placeholder);
      }

      if (isSaved(entry)) {
        const saved = document.createElement('span');
        saved.className = 'render-history-saved';
        saved.textContent = '✓';
        saved.setAttribute('role', 'img');
        const what = [entry.savedImage && 'image', entry.savedSettings && 'settings']
          .filter(Boolean).join(' and ');
        saved.setAttribute('aria-label', `${entry.label}: ${what} saved to disk`);
        saved.title = `${entry.label}: ${what} saved to disk`;
        item.append(saved);
      }

      const pinOverlay = document.createElement('div');
      pinOverlay.className = 'render-history-pins';
      if (entry.url) {
        /*
          One control, and `data-pin` names the slot this entry actually holds rather than the
          slot a button would fill. That is what makes "both A and B on one render" unsayable:
          there is no second button to say it with.
        */
        const slot = pinSlot(entry);
        /*
          A slot the user has not chosen is drawn as an outline rather than a solid chip, so the
          default pair is legible *as* a default. Without it the two newest renders look exactly
          like a deliberate choice, and the first click -- on a chip that is already lit -- reads
          as "add this" while doing the opposite.
        */
        const auto = Boolean(slot) && !manualPins;
        const pin = document.createElement('button');
        pin.type = 'button';
        pin.className = 'render-history-pin';
        if (slot) pin.dataset.pin = slot;
        if (auto) pin.dataset.auto = 'true';
        pin.dataset.renderId = String(entry.id);
        pin.textContent = slot ? slot.toUpperCase() : 'A/B';
        if (auto) {
          pin.title = `${entry.label} is ${slot.toUpperCase()} by default, as one of the two newest renders. Pick any render to choose the pair yourself.`;
        } else if (slot) {
          pin.title = `${entry.label} is ${slot.toUpperCase()}. Click to drop it.`;
        } else {
          pin.title = `Add ${entry.label} to the comparison. First pick is A, second is B; a later pick replaces B.`;
        }
        // Which side of the screen the slot means, on every chip that holds one.
        if (slot) pin.title += ` ${SLOT_SIDE[slot]}`;
        pin.setAttribute('aria-pressed', String(Boolean(slot)));
        pin.setAttribute(
          'aria-label',
          slot
            ? `${entry.label} is ${auto ? 'automatically ' : ''}pinned as ${slot.toUpperCase()}`
            : `Add ${entry.label} to the A/B comparison`,
        );
        pin.addEventListener('click', () => pickForCompare(entry));
        pinOverlay.append(pin);
        item.append(pinOverlay);
      }

      historyList.append(item);
    });
  }


  /*
    Latest -> A, second-latest -> B, re-evaluated on every render, because the comparison wanted by
    default is "what I just changed" against "what it looked like before". `history` is newest-first.

    Frozen while Compare is the mode on screen. A render landing is not a reason to swap the two
    images the user is in the middle of comparing, and the swap would be silent: nothing announces
    that the pair under their eyes has changed underneath them.

    `force` lifts that freeze alone, never the `manualPins` one, and only for the two moments the
    user is themselves asking about the default: opening Compare, and adding or removing a tray
    entry while it is open. Without it a removal would strand the automatic pair half filled for
    the rest of the session.
  */
  function autoPin({ force = false } = {}) {
    if (manualPins || (mode === 'compare' && !force)) return;
    pins.a = history[0]?.id;
    pins.b = history[1]?.id;
  }


  /*
    A slot never holds an entry that has left the tray, and never the entry the other slot holds.

    Nothing here moves a render between slots, not even B into A when A comes free: a slot is a
    *side of the screen* -- A is left of the wipe, B is right of it -- so promoting B would teleport
    the render the user is still looking at from one side of the divider to the other, without a
    click on that render, and relabel its A/B chip in the tray at the same moment. An empty A is a
    legible state instead: its side of the seam
    shows the matte, its chip is free, and the next pick fills it.
  */
  function normalizePins() {
    if (!entryById(pins.a)) pins.a = undefined;
    if (!entryById(pins.b)) pins.b = undefined;
    // Belt and braces: pickForCompare() and undoTrayRemoval() cannot say this in the first place.
    if (pins.a !== undefined && pins.a === pins.b) pins.b = undefined;
  }


  /*
    One pick per entry, and the whole rule: a pick fills the empty slot, A before B; when both are
    full it replaces B; and picking a render that already holds a slot drops it from that slot,
    leaving the other one exactly where it is.

    B is what moves when both slots are full, so A stays the reference you are measuring
    everything against -- the common shape of this task is "how do these compare with that one",
    not "compare the last two things I touched".

    One control per entry rather than an A and a B button: a pair with no exclusion between them
    would let one render be pinned to both slots, and Compare would show it against itself.
  */
  function pickForCompare(entry) {
    if (pins.a === entry.id) pins.a = undefined;
    else if (pins.b === entry.id) pins.b = undefined;
    else if (pins.a === undefined) pins.a = entry.id;
    else pins.b = entry.id;
    normalizePins();
    /*
      The strip is the user's from the first pick until the structure changes, and dropping every
      pick leaves it empty rather than handing the default back.

      Refilling on empty is worse: the user clearing the pair to choose their own would watch
      auto-pin put the two newest renders straight back under them.
      An empty pair is also a legible state -- Compare greys out and says what to do.
    */
    manualPins = true;
    paint();
  }


  const isPinned = (entry) => pins.a === entry.id || pins.b === entry.id;
  const pinSlot = (entry) => {
    if (pins.a === entry.id) return 'a';
    if (pins.b === entry.id) return 'b';
    return undefined;
  };


  /*
    **An entry the undo stack still points at is not disposable.**

    `removeFromTray()` sets `kept = false`, pushes the entry onto `removedTray`, and then calls this
    -- so from this function's point of view the entry it has just made undoable looks exactly like
    an aged-out candidate. While the caps are slack nothing happens; once `CANDIDATE_LIMIT` or
    `RESULT_LIMIT` binds (remove a tray entry, then run a ninety-Style sweep) it reaches
    `disposeEntryImages()`, which revokes the object URL, and `undoTrayRemoval()` then puts the
    entry back and paints a dead `blob:` -- `watchImageLoad()`'s `onerror` fires and the render is
    announced as unreadable, having been undone successfully.

    Bounded by construction, so this cannot become a retention leak: `removedTray` is capped at
    `TRAY_REMOVAL_LIMIT` = 3, and a record that ages off that list stops protecting its entry at the
    very next prune. And a prune that can find nothing removable already breaks out of both loops,
    so at most three entries of slack over the cap is the same soft-cap behaviour `!kept`,
    `isPinned` and `activeId` already give it.
  */
  const awaitingUndo = (entry) => removedTray.some((record) => record.entry.id === entry.id);

  function pruneResults() {
    const removable = (predicate = () => true) => results
      .slice()
      .reverse()
      .find((entry) => predicate(entry)
        && !entry.kept && !entry.held && !isPinned(entry) && entry.id !== activeId
        && !awaitingUndo(entry));
    // A render off the tray and off the undo list is unreachable, and it holds a 16 B/px float master.
    for (let entry = removable((candidate) => candidate.origin !== 'style'); entry;
      entry = removable((candidate) => candidate.origin !== 'style')) {
      disposeEntryImages(entry);
      results = results.filter((candidate) => candidate.id !== entry.id);
    }
    while (results.filter((entry) => entry.origin === 'style' && !entry.kept).length
      > CANDIDATE_LIMIT) {
      const entry = removable((candidate) => candidate.origin === 'style');
      if (!entry) break;
      disposeEntryImages(entry);
      results = results.filter((candidate) => candidate.id !== entry.id);
    }
    while (results.length > RESULT_LIMIT) {
      const entry = removable();
      if (!entry) break;
      disposeEntryImages(entry);
      results = results.filter((candidate) => candidate.id !== entry.id);
    }
  }


  // The tray is a recent-results list. Pins survive its cap; every other item may age out.
  function putInTray(entry) {
    if (!entry) return false;
    const existing = history.find((candidate) => candidate.id === entry.id);
    if (existing) {
      existing.kept = true;
      discardRemoval(entry.id);
      return true;
    }
    if (history.length >= HISTORY_LIMIT) {
      const evict = history
        .slice()
        .reverse()
        .find((candidate) => !isPinned(candidate));
      if (!evict) return false;
      evict.kept = false;
      history = history.filter((candidate) => candidate.id !== evict.id);
    }
    entry.kept = true;
    discardRemoval(entry.id);
    history = [entry, ...history];
    return true;
  }


  function removeFromTray(id) {
    const entry = entryById(id);
    if (!entry || !history.some((candidate) => candidate.id === id)) return false;
    removedTray = [{
      entry,
      index: history.findIndex((candidate) => candidate.id === id),
      pins: { ...pins },
    }, ...removedTray.filter((record) => record.entry.id !== id)]
      .slice(0, TRAY_REMOVAL_LIMIT);
    entry.kept = false;
    history = history.filter((candidate) => candidate.id !== id);
    if (pins.a === id) pins.a = undefined;
    if (pins.b === id) pins.b = undefined;
    normalizePins();
    autoPin({ force: true });
    pruneResults();
    paint();
    return true;
  }


  function undoTrayRemoval() {
    const record = removedTray.shift();
    if (!record) return false;
    const { entry } = record;
    if (!results.some((candidate) => candidate.id === entry.id)) {
      results = [entry, ...results];
    }
    if (history.length >= HISTORY_LIMIT) {
      const evict = history
        .slice()
        .reverse()
        .find((candidate) => !isPinned(candidate) && candidate.id !== entry.id);
      if (!evict) {
        removedTray.unshift(record);
        paintRemovalUndo();
        return false;
      }
      evict.kept = false;
      history = history.filter((candidate) => candidate.id !== evict.id);
    }
    entry.kept = true;
    const index = Math.min(Math.max(0, record.index), history.length);
    history = [...history.slice(0, index), entry, ...history.slice(index)];
    if (manualPins) {
      ['a', 'b'].forEach((slot) => {
        if (pins[slot] === undefined && record.pins[slot] === entry.id) pins[slot] = entry.id;
      });
      normalizePins();
    } else {
      autoPin({ force: true });
    }
    pruneResults();
    paint();
    return true;
  }


  /*
    `result` is the seam's own -- bytes, not a URL -- and the URL is made **here**, for the reason
    the header gives: the entry owns its lifetime and `disposeEntryImages()` is what revokes it, so
    the two halves of "revoke every object URL" stay in one file. Taking a URL here instead means
    making a second one from the first and revoking only the second, which leaks one per swept
    tile.
  */
  function registerCandidate(result, settings, {
    styleId,
    label = 'Style candidate',
    quality = 'draft',
    // A draft the sweep's tile still paints: pruning it would revoke the URL under the tile.
    held = false,
  } = {}) {
    const url = imageUrlFrom(result ?? {});
    if (!url) return;
    const existing = results.find((entry) => entry.sourceUrl === url);
    if (existing) {
      if (held) existing.held = true;
      return existing;
    }
    counter += 1;
    const entry = {
      id: counter,
      url,
      sourceUrl: url,
      ...masterFields(takeMaster(result?.blob)),
      adjustments: defaultPostProcessing(),
      label: `${label} · ${quality === 'draft' ? 'Draft' : quality}`,
      settings,
      origin: 'style',
      styleId,
      quality,
      kept: false,
      held,
      savedImage: false,
      savedSettings: false,
    };
    results = [entry, ...results];
    pruneResults();
    return entry;
  }


  function releaseCandidates(entries) {
    entries.forEach((entry) => { entry.held = false; });
    pruneResults();
  }


  /*
    The float master's fields, made **only where the entry is**, so a picture that turns out to be
    one the tray already holds never mints a URL nobody would revoke. `takeMaster()` is keyed on the
    PNG blob, so a picture whose master failed -- or one the seam did not make, as a restored
    session's has not been -- simply has none, and the button says which.
  */
  function masterFields(master) {
    if (!master) return {};
    return master.tiff
      ? { masterUrl: URL.createObjectURL(master.tiff) }
      : { masterError: master.error };
  }


  function addRender(url, settings, {
    origin = 'manual',
    styleId,
    label,
    quality = 'current',
    master,
  } = {}) {
    if (!url) return;
    const existing = results.find((entry) => entry.sourceUrl === url);
    if (existing) {
      activeId = existing.id;
      setMode('render');
      return existing;
    }
    counter += 1;
    // A Style candidate supplies this explicitly, but an ordinary Render PNG is also a Style
    // render when its captured composition says so. `editor_state` is frozen at submission time,
    // making it the correct source rather than whichever Style happens to be active once the
    // render finishes. Without this fallback, Apply style only is disabled for the common "apply a
    // Style, then press Render PNG" path.
    const entryStyleId = styleId ?? settings?.editor_state?.style_id;
    /*
      An armed recipe wins over the carried one and is consumed here; the carried one is left in place,
      because it describes how the user wants their renders finished rather than one pending request.
      Only the armed case opens the panel below -- a silently carried recipe is the state the user
      already put the app in, and re-announcing it on every render would be noise.
    */
    const armedAdjustments = pendingPostProcessing;
    pendingPostProcessing = undefined;
    const inheritedAdjustments = armedAdjustments ?? stickyPostProcessing;
    if (armedAdjustments) stickyPostProcessing = { ...armedAdjustments };
    const entry = {
      id: counter,
      url,
      sourceUrl: url,
      ...masterFields(master),
      adjustments: inheritedAdjustments ?? defaultPostProcessing(),
      label: label || (styleId ? `${styleId} · Full quality` : `Render ${counter}`),
      settings,
      origin,
      styleId: entryStyleId,
      quality,
      kept: false,
      savedImage: false,
      savedSettings: false,
    };
    results = [entry, ...results];
    putInTray(entry);
    pruneResults();
    autoPin();

    activeId = entry.id;
    setMode('render');
    if (inheritedAdjustments && !isNeutralPostProcessing(inheritedAdjustments)) {
      void commitPostProcessing(entry, { inherited: true }).then((applied) => {
        if (applied && entry.id === activeId && armedAdjustments) {
          openPostProcessing({ focus: false });
        }
      });
    }
    return entry;
  }


  function reset() {
    postProcessRevision += 1;
    window.clearTimeout(postProcessCommitTimer);
    postProcessCommitTimer = undefined;
    // Every result is going away here, so the sweep-draft blobs go with them -- releasing only the
    // processed copy would leak one object URL per tile of the last structure's walk.
    results.forEach(disposeEntryImages);
    results = [];
    history = [];
    removedTray = [];
    counter = 0;
    activeId = undefined;
    pendingPostProcessing = undefined;
    // A new structure is a new picture; carrying the previous one's finishing pass into it would be
    // applying a decision made about something else.
    stickyPostProcessing = undefined;
    closePostProcessing();
    shownId = undefined;
    renderZoom?.fit();
    pins = { a: undefined, b: undefined };
    manualPins = false;
    // The alt goes with the source everywhere, for the reason paintComparePane() gives. paint()
    // does the same for the live state; this is the one path that runs with no paint after it.
    renderImage.removeAttribute('src');
    renderImage.alt = '';
    paintComparePane(compareImageA, undefined, 'A');
    paintComparePane(compareImageB, undefined, 'B');
    setMode('preview');
  }


  // --- wipe divider: pointer drag and arrow keys, no input element ---------
  function wipeFromPointer(event) {
    const rect = compareFrame.getBoundingClientRect();
    if (rect.width === 0) return;
    setWipe(((event.clientX - rect.left) / rect.width) * 100);
  }

  compareWipe.addEventListener('pointerdown', (event) => {
    compareWipe.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  compareWipe.addEventListener('pointermove', (event) => {
    if (compareWipe.hasPointerCapture(event.pointerId)) wipeFromPointer(event);
  });
  const endWipeDrag = (event) => {
    if (compareWipe.hasPointerCapture(event.pointerId)) {
      compareWipe.releasePointerCapture(event.pointerId);
    }
  };
  compareWipe.addEventListener('pointerup', endWipeDrag);
  // Without this a drag that the browser cancels -- a touch turned into a scroll, a pointer that
  // leaves the window -- keeps the capture and the divider follows the pointer with no button down.
  compareWipe.addEventListener('pointercancel', endWipeDrag);
  // Back to the middle without aiming: the one position worth a shortcut is the even split.
  compareWipe.addEventListener('dblclick', () => setWipe(50));
  compareWipe.addEventListener('keydown', (event) => {
    const step = { ArrowLeft: -2, ArrowRight: 2, Home: -100, End: 100 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    setWipe(Math.abs(step) === 100 ? (step < 0 ? 0 : 100) : wipe + step);
  });

  postProcessToggle.addEventListener('click', () => {
    if (postProcessPanel.matches('[data-open="true"]')) closePostProcessing({ focus: true });
    else openPostProcessing();
  });
  postProcessClose.addEventListener('click', () => closePostProcessing({ focus: true }));
  postProcessInputs.forEach((input) => {
    input.addEventListener('input', () => {
      const entry = entryById(activeId);
      if (!entry) return;
      setEntryAdjustments(entry, readPostProcessing());
      void previewPostProcessing(entry);
      schedulePostProcessCommit(entry);
    });
    /*
      `change`, not `input`, is where a step is recorded: a range fires it once when the drag is
      released, so one drag is one step back -- the same bargain COALESCE_MS makes for the
      composition ring, got for free from the event rather than from a timer.
    */
    input.addEventListener('change', () => {
      const entry = entryById(activeId);
      if (!entry) return;
      window.clearTimeout(postProcessCommitTimer);
      postProcessCommitTimer = undefined;
      recordAdjustHistory(entry);
      void commitPostProcessing(entry);
    });
  });
  postProcessUndo?.addEventListener('click', () => void stepAdjustHistory(-1));
  postProcessRedo?.addEventListener('click', () => void stepAdjustHistory(1));
  postProcessAuto.addEventListener('click', async () => {
    const entry = entryById(activeId);
    if (!entry || postProcessBusy) return;
    postProcessStatus.textContent = 'Applying preset…';
    setEntryAdjustments(entry, automaticPostProcessing());
    recordAdjustHistory(entry);
    await previewPostProcessing(entry);
    await commitPostProcessing(entry);
  });
  postProcessReset.addEventListener('click', () => {
    const entry = entryById(activeId);
    if (!entry) return;
    postProcessRevision += 1;
    setEntryAdjustments(entry, defaultPostProcessing());
    // Reset is a step like any other, so the arrows lead back out of it rather than Reset being
    // the one action in the panel that cannot be taken back.
    recordAdjustHistory(entry);
    disposeProcessedImage(entry);
    entry.url = entry.sourceUrl;
    entry.savedImage = false;
    renderViewport.removeAttribute('data-post-process-preview');
    postProcessStatus.textContent = 'Original restored';
    paint();
  });
  postProcessPanel.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closePostProcessing({ focus: true });
  });
  coordinateOverlay({
    owner: 'post-process',
    contains: (target) => postProcessPanel.contains(target) || postProcessToggle.contains(target),
    isOpen: () => postProcessPanel.matches('[data-open="true"]'),
    close: closePostProcessing,
  });
  window.addEventListener('resize', positionPostProcessing);

  /*
    Four buttons, one call, and the pill is idempotent.

    Live has its own button, `#stage-live`, rather than a second press on Result: authored rather
    than overloaded. It is the one place where "add no new id to the page" loses, because the
    trace is started and stopped by which mode is on the stage, so a mode nobody can name is a trace
    nobody can stop.
  */
  Object.entries(modeButtons).forEach(([name, button]) => {
    button.disabled = false;
    button.addEventListener('click', () => setMode(name));
  });
  backdropGroup.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => setBackdrop(button.dataset.backdrop));
  });
  Object.entries(layoutButtons).forEach(([name, button]) => {
    button.addEventListener('click', () => setLayout(name));
  });

  document.addEventListener('foldray:render-complete', (event) => {
    /*
      The seam hands back **bytes**, and this is where the one object URL for them is made.
      `imageUrlFrom()` is the single constructor and `disposeEntryImages()` the single revoke, which
      is the whole of "revoke every object URL" for this module.
    */
    addRender(
      imageUrlFrom(event.detail ?? {}),
      event.detail?.settings,
      { ...event.detail?.meta, master: takeMaster(event.detail?.blob) },
    );
  });
  document.addEventListener('foldray:structure-loading', () => {
    liveAvailable = false;
    reset();
  });
  document.addEventListener('foldray:live-trace-available', () => {
    liveAvailable = true;
    paint();
  });
  applySettings.addEventListener('click', () => applyActive('settings'));
  applyStyle.addEventListener('click', () => applyActive('style'));
  downloadImage.addEventListener('click', () => saveActive('image'));
  downloadMaster.addEventListener('click', () => void saveMaster());
  /*
    Nothing here has the renderer, so the read-back leaves as an event exactly the way every other
    download does. **No `backdrop` travels with it**, unlike a download: a matte is
    what a *file* is looked at on, and this picture is not becoming a file -- it goes into the tray,
    where the stage paints the same three backdrops behind it that it paints behind every other
    render. Compositing one in would bake a viewing choice into the picture and break the alpha
    every other tray entry carries.
  */
  quickImage.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('foldray:live-quick-image'));
  });
  downloadSettings.addEventListener('click', () => saveActive('settings'));
  compareDownload.addEventListener('click', () => {
    const a = entryById(pins.a);
    const b = entryById(pins.b);
    if (!a?.url || !b?.url) return;
    document.dispatchEvent(new CustomEvent('foldray:compare-save-image', {
      detail: {
        layout,
        wipe,
        backdrop,
        a: { id: a.id, label: a.label, url: a.url },
        b: { id: b.id, label: b.label, url: b.url },
      },
    }));
  });
  removalUndoButton.addEventListener('click', undoTrayRemoval);

  /*
    The strip is one row that scrolls sideways, and a mouse wheel only reports vertical movement
    over it. Mapping that movement to `scrollLeft` is what makes the wheel work at all here; the
    page behind it does not scroll, so nothing is being stolen from it. `passive: false` is
    required for preventDefault, and the default is only prevented when there is somewhere left to
    scroll -- otherwise a trackpad's horizontal fling would appear to stick at either end.
  */
  historyList.addEventListener('wheel', (event) => {
    if (event.ctrlKey) return;
    const limit = historyList.scrollWidth - historyList.clientWidth;
    if (limit <= 0) return;
    const scale = event.deltaMode === 1 ? WHEEL_LINE_HEIGHT : 1;
    const delta = (Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX)
      * scale;
    const next = Math.min(Math.max(0, historyList.scrollLeft + delta), limit);
    if (next === historyList.scrollLeft) return;
    historyList.scrollLeft = next;
    event.preventDefault();
  }, { passive: false });

  // 'alpha', not 'checker': this is what syncs the pressed state at startup, and a name
  // `BACKDROPS.includes()` does not carry fails silently -- index.html hard-codes
  // data-backdrop="alpha" and the buttons' aria-pressed with it, so the page would look right.
  setBackdrop('alpha');
  setLayout('wipe');
  setWipe(50);
  setMode('preview');
  initCropGuide(viewerPanel);

  return {
    mode: () => mode,
    // Which matte is up. Read-only, like `mode()` -- `main.js` needs it when the Mol* canvas
    // finally imports, long after the stage has settled on one.
    backdrop: () => backdrop,
    // Picking a depth-of-field focus point is a Mol* interaction, so it needs the Preview canvas
    // on screen -- called from main.js's beginFocusPicking() rather than clicking #stage-preview,
    // which would also work but couples the caller to a button existing and being enabled.
    viewPreview: () => setMode('preview'),
    registerCandidate,
    releaseCandidates,
    /*
      Arms a recipe for the next render, or disarms one. It deliberately does not touch the carried
      recipe: `armImproveImage(undefined)` runs on every Style apply with Improve image off, and a user
      who has hand-tuned their renders has not asked for that to be undone by applying a Style.
    */
    restorePostProcessing(value) {
      pendingPostProcessing = value === undefined
        ? undefined
        : normalizePostProcessing(value);
      closePostProcessing();
    },
    sessionPostProcessing() {
      const entry = entryById(activeId);
      const adjustments = entry?.url
        ? entryAdjustments(entry)
        : pendingPostProcessing ?? stickyPostProcessing;
      return adjustments && !isNeutralPostProcessing(adjustments)
        ? { ...adjustments }
        : undefined;
    },
    // What emptying the tray would lose.
    unsavedRenderCount: unsavedCount,
    markSaved(id, kind) {
      const entry = entryById(id);
      if (!entry) return;
      if (kind === 'image') entry.savedImage = true;
      if (kind === 'settings') entry.savedSettings = true;
      paint();
    },
  };
}
