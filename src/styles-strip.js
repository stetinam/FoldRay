/*
  The Styles strip: two tiers of disclosure over one catalogue.

    1. The resting bar (`.stage-styles`) shows the recommended few as small inline art, plus the
       active-Style label and `#styles-doorway` -- the bar's own `Styles` tag, which is the button
       that reaches tier 2. It is a *preview and a doorway* and
       nothing else: a mini is not a Style you can pick, it is the picture that tells you the
       gallery is worth opening, so clicking one opens the gallery exactly as hovering the bar does.
    2. Hovering the bar -- or moving focus into it, or clicking anything in it -- opens
       `#styles-panel`: every Style, labelled, on its eleven shelves, under a head that carries the
       sweep controls -- choosing what to render is a decision about the tiles, so it sits above
       them and stays on screen while they scroll, rather than in a footer below all eleven. Hover is
       delayed at both ends so crossing the bar does not strobe. Hovering away from it closes it, a
       press outside it closes it, Escape closes it, and `#styles-close` at its top right closes it
       -- four routes out, because a surface that covers the canvas must never need a hunt to leave.

  THERE IS NO MIDDLE TIER. A few tiles hung off the bar with the gallery a click behind them would
  be two overlays answering the same question, one a strict subset of the other: the hover opens
  the answer.

  A tile *hover* opens the Style card (`#style-options-panel`, built and documented further down)
  and a tile *click* pins it open. The card is one element and one title: the enlargement of the
  tile's own artwork, the Style's name and blurb, and the two questions -- Improve image, colour
  scheme -- above its own Cancel/Apply style. The picture and the decisions about it are one box, so
  they cannot disagree about which Style they are describing and cannot be placed on top of each
  other.

  The first apply of a browsing session banks the composition it replaced, so `Restore my settings`
  in the resting bar always leads back out; undo covers it as well.

  A tile has four states and they are deliberately different weights. A *clicked* tile -- one whose
  options panel is open, nothing applied yet -- takes a low-key neutral ring
  (`is-configuring-style`), because it reports a question rather than an outcome; the applied Style
  takes an amber one, and a tile that is both reads as applied. That ordering is in the CSS rule
  order, not in a condition here.

  The Recommended row leads with the current Style when there is one: `#styles-current-lead-gallery`,
  one tile behind a divider, captioned `Current style` while the composition still matches it and
  `Previous style` once an owned control has been edited away from it. With nothing applied this
  session the segment is absent and the row is just the recommendation, which is the state the app
  opens in.

  Sweep membership is a *mode* rather than a second control per tile. `#styles-sweep-mode` flips the
  panel into choosing, where the same tile click toggles membership and the blue rim reports it.
  One control per tile, one meaning at a time, and no duplicate of that control in the action bar.

  The other three are distinct treatments that can coexist: the amber ring for the applied Style, a
  blue rim for sweep membership, and a `Draft` chip once the user's own structure has been rendered
  through it.

  THERE IS NO PER-DRAFT ACTION ROW. The draft is the tile's own artwork, and what to do about it is
  the card's Apply; anything more would restate what the stage or the card already offers. Drafts
  are registered as candidates, and the render tray is where a render is kept.

  `#styles-restore` and `#styles-restore-hint` live in tier 1, the resting bar, and that placement
  is the whole point of them. The gallery hangs *below* `--styles-bar-height`, so the bar is the one
  surface on screen in every state: a Style applied from the gallery is reversible from a button
  that is still there once the gallery has closed. In the gallery's own footer the way back out
  would exist only while the surface just used to apply happened to still be open, which is exactly
  when it is least likely to be looked for.

  The hint says once, after the fact, that there is something to go back to. Not a modal before the
  first apply, which is far too heavy for the weight of the action: applying a Style is reversible,
  and interrupting a click on a picture to explain that is worse than saying it afterwards, next to
  the control that does the reversing. It is a complete sentence rather than one that runs into the
  button ("...click" + `Restore my settings`), because it is announced through `role="status"` as
  well as read, and an announcement that depends on the reader's eye
  landing on the next element is not one. It retires itself after HINT_LINGER_MS; the button it
  explains does not, so the affordance outlives the explanation instead of parking a sentence in a
  32px bar for the rest of the session.

  The gallery and the Style card are both absolutely positioned inside `.stage`, and that is
  structural rather than careful. `.stage` is a flex column of the bar, `.viewer-panel`
  (`flex: 1 1 0`) and the renders strip, so anything here that took a flex row would shrink the
  panel -- and here that means *re-tracing*, because the stage is responsive and the live trace
  follows its box (`src/main.js`'s ResizeObserver). A bar that changes the stage's height throws
  away the accumulator behind it. The bar's own height is `--styles-bar-height` on `.stage`;
  see the comment on it in `styles.css` before trading canvas height for a taller bar.

  Applying a Style writes the real controls and dispatches their real events, exactly as the rail's
  pickers drive their hidden <select> elements. `src/main.js`'s handlers then run normally, the
  pickers resync, and the shell's capture-phase dirty tracking fires on its own. Nothing here writes
  a render-request field.

  Nothing here is an <input>, a <select> or a <textarea>, and that is load-bearing rather than
  stylistic: main.js marks the session unsaved from a capture-phase `change`/`input` listener on
  `.app-shell`, so a checkbox per Style would mark the document dirty merely by choosing what to
  render -- and which Styles to sweep is not part of the document at all.
*/
import {
  STYLE_CATALOG,
  STYLE_FIELDS,
  STYLE_ROWS,
  resolvedStyleWrites,
  styleWrittenComponents,
  stylesInRow,
} from './catalog/styles.js';
import { overlayComponents } from './style-overlays.js';
import { thumbUrl } from './catalog/thumbs.js';
import { paintTileArt } from './catalog/index.js';
/*
  The shared `#tile-magnifier` is deliberately *not* imported. It is what every swatch picker uses,
  and the right thing there: a picker tile has no decisions attached to it, so a picture that
  follows the pointer is the whole answer. A Style tile does have decisions attached to it, and the
  Style card below carries its own enlargement so the picture and the decisions are one box, with no
  placement to negotiate between two surfaces.
*/
import { announceOverlayOpen, coordinateOverlay } from './overlay-coordinator.js';
import {
  createStyleSweep,
  SWEEP_DONE,
  SWEEP_FAILED,
} from './style-sweep.js';
import {
  colorSchemeById,
  EXTRA_COLOR_GROUP,
  EXTRA_COLOR_GROUP_LABEL,
  SCHEME_GROUP,
  schemesInGroup,
  styleColorSchemes,
  styleWithScheme,
} from './style-color-schemes.js';
import { improveForStyle } from './catalog/style-improve.js';
import { RECOMMENDED_LIMIT } from './style-recommendations.js';

// The controls a Style owns. Editing any of them means the Style no longer describes the scene.
// A hex field's wheel is owned too: it writes the hex without dispatching on it.
const OWNED_CONTROL_IDS = new Set(
  Object.values(STYLE_FIELDS).flatMap(({ control }) => (
    control.endsWith('-hex') ? [control, control.replace(/-hex$/, '-wheel')] : [control]
  )),
);

/*
  How many Styles tier 1 draws as inline art.

  Never every one: 32px of art plus its gap is 36px, so the whole catalogue is over three thousand
  pixels of a stage that measures under a thousand -- an output of the responsive layout rather than
  a pinned size, and narrower on a narrower window. The bar shows the recommended few, which is a
  better bar anyway: a row of pictures chosen for what is loaded says more than the first eight
  entries of a list.
*/
const RAIL_COUNT = 8;
// The gallery's own hover timing. Asymmetric on purpose: entering is quick enough to feel like a
// response, and leaving is slow enough that the pointer can cross from the bar down into the
// gallery -- and out of the gallery onto the Style card, which is a sibling of both -- without the
// whole thing collapsing behind it.
const HOVER_ENTER_MS = 120;
const HOVER_LEAVE_MS = 240;

/*
  The widest a multi-colour scheme row may get. Seven pills and their gaps in the card's 224px
  content box leave about 27px each, which is where two or more colours stop being countable at a
  glance; the row's actual column count is the largest divisor of its entry count at or below this,
  so every row of the group holds the same number of swatches.
*/
const MULTI_SWATCH_MAX_COLUMNS = 7;

// Clear of the tile's own edge without floating free of it.
const CARD_GAP = 10;
const CARD_MARGIN = 8;
/*
  The Style card's hover timing. One box answers the hover, so there is one pair of these. Short
  enough to feel like a response, long enough
  that dragging the pointer across a shelf of tiles does not strobe;
  the leave delay is what lets the pointer cross CARD_GAP onto the card itself without it retracting.
*/
const CARD_ENTER_MS = 170;
const CARD_LEAVE_MS = 220;

/*
  What the lead segment of the Recommended row is called in its two states. `Current style` is a
  claim about the composition on screen; once an owned control has been edited the Style no longer
  describes it, so the same tile is relabelled rather than removed -- the way back to it is exactly
  what the user wants at that moment.
*/
const LEAD_CURRENT_LABEL = 'Current style';
const LEAD_PREVIOUS_LABEL = 'Previous style';

/*
  Said once, when it first becomes true, and self-contained: it has to survive being announced on
  its own by a screen reader, and being read in a bar whose next element is a button that says what
  it does anyway. A sentence ending in "click" depends on the button sitting immediately after it,
  which makes the sentence a layout constraint.
*/
const RESTORE_HINT_TEXT = 'Style applied — your previous settings are saved.';
/*
  Long enough to read a nine-word sentence that was also announced, short enough that the bar goes
  back to being a bar. Only the explanation expires; `#styles-restore` stays until it is used or
  the structure changes, so nothing that can still be done stops being offered.
*/
const HINT_LINGER_MS = 12000;

/*
  What the sweep button says with nothing chosen -- the name the action is called everywhere else
  -- and what it says once there is a subset to name. A count is the honest half of "what am
  I committing to": it is known before the walk starts, and it is the same number `#styles-sweep-
  count` reports, taken from the same snapshot rather than counted again here. A *duration* is not,
  and must not appear on this button: the sweep's estimate is measured by the first completed
  render, so a time on the control that starts the walk could only be a guess.
*/
const SWEEP_START_LABEL = 'Render selected styles';
// Not offered, and kept for later: false hides the whole sweep row, and with `Choose styles to
// sample` gone nothing can enter the mode or start a walk. Flip to restore.
const SWEEP_OFFERED = false;
const sweepStartLabel = (chosen) => {
  if (!chosen) return SWEEP_START_LABEL;
  return chosen === 1 ? 'Render 1 style' : `Render ${chosen} styles`;
};


export function initStyles({
  applyWrites,
  /*
    The second write path, and the only one that is not a control. A Style's overlay passes are a
    JS list, not DOM, so they cannot be applied by setting a value and dispatching an event the way
    every other Style field is -- main.js turns each pass into a real selection layer instead. It is
    awaited because the sweep submits a render the moment `apply` resolves, and a job that went out
    before the layers landed would render the previous tile's picture under this tile's name.
  */
  applyOverlays = async () => {},
  renderOne,
  registerResult = (result) => result,
  releaseResults = () => {},
  captureMySettings = async () => undefined,
  restoreMySettings = async () => {},
  captureBaseline = async () => undefined,
  restoreBaseline = async () => {},
  isBusy = () => false,
  onApplied = () => {},
  onBusyChange = () => {},
  /*
    The Style options panel's callbacks into main.js. Both talk to a mechanism that already exists
    outside this module -- see the panel's own comment below for why each is shaped the way it is.
  */
  armImproveImage = () => {},
  /*
    The third write path, and the reason a by-chain Style can have colour schemes at all. The other
    two are controls (`applyWrites`) and selection layers (`applyOverlays`); this one is the
    per-category colour table, which is neither: `styleColorOverrides` in main.js is plain JS state
    that reaches the request as `color_overrides`. It is called on *every* apply, with the scheme or
    with nothing, because its first job is the reset -- a Style owns its whole colour state, and a
    palette the user edited under the previous Style must not survive into this one.
  */
  applyColorScheme = () => {},
  getNucleicPresent = () => false,
  getUnchosenSwitches = () => new Set(),
  /*
    Where a failure inside this module goes.

    Three of the four things a click here starts are `async` functions nobody awaits -- the tile
    card's Apply (`void applyWithOptions(...)`), `foldray:style-apply`'s `void styles?.applyFromUi(...)`
    and the sweep buttons' bare `walk(...)` -- and every one of them reaches
    `captureMySettings()`/`captureBaseline()`, which is `buildRenderRequest()` and therefore refuses
    a half-typed control. Unreported, a Style tile clicked with the Samples box empty does *nothing
    at all*: no status line, no announcement, an unhandled rejection on the console and a gallery
    that closes on a composition that has not changed.

    A callback rather than a surface of this module's own, for the reason every other hook here is
    one: main.js already has the line that speaks about the composition, and a second error strip in
    the Styles bar would be a second place to look.
  */
  reportFailure = () => {},
} = {}) {
  const strip = document.querySelector('.stage-styles');
  const stage = strip?.closest('.stage');
  if (!strip || !stage) return undefined;

  let activeStyleId;
  /*
    The last Style applied to this structure, which is *not* `activeStyleId`: that one is cleared the
    moment an owned control is edited, because the amber ring claims "this Style is the composition"
    and that claim stops being true. What survives the edit is that the user chose this look and may
    want back to it, which is what the lead segment reports as `Previous style`.
  */
  let appliedStyleId;
  /*
    Which colour scheme the composition on screen was applied with, as `{ styleId, schemeId }`.

    A scheme is part of the applied Style, not a per-open preference: once a user has applied
    `sticks_trace` in its third scheme, that scheme *is* what the picture is coloured as, so
    re-opening that Style's card and finding the authored swatch framed misreports the composition
    and puts the user one wrong click from undoing their own colour choice. Written by `apply()` for
    every non-sweep apply -- including the ones with no scheme, which record `authored`, so a plain
    apply cannot leave a previous scheme's frame standing.

    Deliberately *not* written by a sweep: a walk applies every chosen Style in turn with the
    authored scheme and restores the pre-sweep composition on the way out, so recording those would
    overwrite the answer for a composition the walk is about to put back.

    Read only when `activeStyleId` still names the same Style -- the edit that clears the amber ring
    is exactly the edit that makes this claim stop being true, so the two are cleared by one act.
    Cleared outright with the structure.
  */
  let appliedScheme;
  let sweepMode = false;
  let applying = false;
  let expanded = false;
  // Escape dismisses the gallery for the visit it was pressed during; leaving the bar re-arms hover.
  let hoverDismissed = false;
  let hoverTimer;
  // Hover reveal for the Style card, keyed to the tile that armed it so leaving one tile cannot
  // cancel the reveal an adjacent tile just asked for -- the same discipline tile-magnifier.js uses.
  let cardTimer;
  let cardPending;
  /*
    Once per structure rather than once per page session. The bank is discarded when the structure
    changes, so the next apply creates a new one and the sentence becomes true again about something
    the user has never been told about -- and a user who loads a second protein has usually stopped
    thinking about a note that went by during the first.
  */
  let restoreHintSeen = false;
  let hintTimer;
  let mySettingsCheckpoint;
  /*
    What the recommender last said, and the whole of this module's structure-awareness. It arrives
    from main.js rather than being computed here, because the facts behind it -- chain counts,
    components, whether the file carries pLDDT -- belong to the structure walk and not to a strip of
    pictures. Empty until a structure is loaded, and the fallbacks below are what the bar shows then.
  */
  let recommendation = { ids: [], facts: [], resample: undefined };
  /*
    Set around the parts of a walk that are not a render but must still count as busy -- capturing
    the pre-sweep baseline and restoring it afterwards. The sweep's own state machine reports busy
    only while it is rendering, so without this the gap either side of a walk is a window in which
    another job could start.
  */
  let submitting = false;
  /*
    The Style options panel's own state. Nothing here is committed until Apply, without exception --
    which is what it costs to be a preview rather than a set of live controls, and what the panel's
    buttons-only rule protects.
  */
  let optionsStyle;
  let optionsAnchor;
  // The scheme list for the Style being configured, and which of them is chosen. Always at least one
  // entry -- the authored scheme -- so `optionsSchemeId` is never a dangling reference.
  let optionsSchemes = [];
  let optionsSchemeId = 'authored';
  /*
    Improve image starts **on**, and every open of the card resets it to that rather than to the last
    answer: the panel is a preview of one apply, not a settings page, so it is `IMPROVE_DEFAULT`
    exactly like `optionsSchemeId` is the authored scheme.

    On by default because a raw traced frame wants a finishing pass and the Style is a picture the
    user picked by eye -- the tile they clicked was rendered finished, through the very recipe this
    arms. Turning it off is one click, and it is not a trap either way: `armImproveImage()` is
    called on every apply, so switching it off arms nothing, and Reset in the Improve image panel
    clears the carry.

    What it arms is the Style's own recipe, not one value for the whole catalogue -- see
    `improveForStyle()` in `src/catalog/style-improve.js` and `applyWithOptions()` below. Auto
    improve is the fallback for the fifty Styles that have none of their own.
  */
  const IMPROVE_DEFAULT = true;
  let optionsImprove = IMPROVE_DEFAULT;
  // The tile's painted art node, copied into the card's own enlargement. Kept so a repaint (a sweep
  // draft landing) can be copied again while the card is still on screen.
  let optionsArt;
  /*
    Hovered open, or clicked open. A hovered card follows the pointer from tile to tile and retracts
    when the pointer leaves; a clicked one is *pinned* -- it stays put while the user reads it and
    decides, and only Cancel, Apply, Escape, a press on the gallery's own empty space or a press
    outside the Styles surfaces closes it. The distinction is the whole reason a hover can open a
    card with buttons in it without those buttons being unreachable.
  */
  let optionsPinnedOpen = false;
  // The lead segment's current contents, so `renderStyleLead()` can leave a matching one alone
  // instead of rebuilding two tiles on every repaint.
  let leadStyleId;
  let leadKind;

  strip.querySelector('.stage-strip-note')?.remove();

  const rail = document.createElement('div');
  rail.id = 'styles-rail';
  rail.className = 'styles-rail';
  rail.setAttribute('role', 'group');
  rail.setAttribute('aria-label', 'Styles');

  const activeLabel = document.createElement('span');
  activeLabel.id = 'styles-active';
  activeLabel.className = 'stage-strip-note';
  activeLabel.textContent = 'No style applied';

  /*
    The doorway, and it is the bar's own `Styles` tag rather than a second button beside it. The
    bar already opens the gallery on hover; what a button adds is the *explicit* route -- a name a
    reader hears, and a target Enter or Space can reach. Both are here: a real button carrying the
    count as its accessible name, in the position the tag holds, so nothing extra is on the bar.

    "Styles", never "looks": `look` is a request field naming one of the lighting scenes, and the
    two names are kept apart in the UI.
  */
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.id = 'styles-doorway';
  toggle.className = 'stage-strip-tag';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.textContent = 'Styles';
  toggle.setAttribute('aria-label', `Browse all ${STYLE_CATALOG.length} styles`);
  toggle.title = `Browse all ${STYLE_CATALOG.length} styles`;

  /*
    The way back out of browsing, in the bar that is on screen in every tier rather than in the
    footer of the one tier that has to be open to be seen. Anywhere else, the control that reverses
    an apply would be reachable only from a surface the user may never have opened, while the apply
    itself is reachable from every tier. Hidden until the first click banks something, so it never
    offers a restore that has no composition behind it.
  */
  const restoreAction = document.createElement('button');
  restoreAction.type = 'button';
  restoreAction.id = 'styles-restore';
  restoreAction.className = 'stage-strip-toggle styles-restore';
  restoreAction.textContent = 'Restore my settings';
  restoreAction.title = 'Restore the unrendered settings you had before applying a Style.';
  restoreAction.hidden = true;
  /*
    Not a control: text beside a button, so it cannot reach main.js's capture-phase dirty tracking
    and cannot break the buttons-only rule this surface answers to. `role="status"` is what makes it
    reach a reader at all -- the bank is created by a click somewhere else entirely, so without a
    live region the only notice of it would be a sentence appearing in a bar nobody is looking at.
  */
  const restoreHint = document.createElement('span');
  restoreHint.id = 'styles-restore-hint';
  restoreHint.className = 'styles-restore-hint';
  restoreHint.setAttribute('role', 'status');
  restoreHint.setAttribute('aria-live', 'polite');
  restoreHint.hidden = true;

  // The doorway leads: it is the bar's `Styles` tag.
  strip.append(toggle, rail, activeLabel, restoreHint, restoreAction);

  /*
    The lead segment of the Recommended row: one tile for the Style the composition came from, behind
    a divider, in first position.

    First position rather than a row of its own, because it is not a category -- it is the answer to
    "what am I looking at", and the two questions a user brings to this row ("what is on screen" and
    "what should be") belong side by side.
  */
  function buildLeadGroup(id) {
    const root = document.createElement('div');
    root.id = id;
    root.className = 'styles-lead';
    root.hidden = true;
    const title = document.createElement('span');
    title.className = 'styles-lead-title';
    const slot = document.createElement('div');
    slot.className = 'styles-lead-slot';
    root.append(title, slot);
    return { root, title, slot };
  }

  const galleryLead = buildLeadGroup('styles-current-lead-gallery');

  const panel = document.createElement('div');
  panel.id = 'styles-panel';
  panel.className = 'styles-panel';
  panel.hidden = true;
  toggle.setAttribute('aria-controls', panel.id);

  /*
    The gallery's own head: what a click does, and the way out.

    `#styles-close` is deliberately redundant. Hovering away from the gallery closes it, a press
    outside it closes it and Escape closes it -- but an overlay that covers most of the canvas and
    offers no visible way to dismiss it makes the user guess which of those it answers to, and a
    guess about a surface sitting on top of your work is a bad thing to have to make. One glyph in
    the corner is cheaper than the doubt.
  */
  const panelHead = document.createElement('div');
  panelHead.className = 'styles-panel-head';

  /*
    The gallery names itself. The bar above it says `STYLES` beside `RAIL_COUNT` thumbnails, and
    once the panel is open that bar is the only thing left saying what the surface below it is:
    without a heading the panel opens straight onto `Current style` / `Recommended`, two captions
    that describe rows rather than the whole. The heading is one line and it carries the one
    sentence a first-time reader needs: a tile is a whole look, and clicking it applies that look.
  */
  const panelTitle = document.createElement('p');
  panelTitle.id = 'styles-panel-title';
  panelTitle.className = 'styles-panel-title';
  const panelTitleName = document.createElement('span');
  panelTitleName.className = 'styles-panel-title-name';
  panelTitleName.textContent = 'STYLES:';
  const panelTitleBlurb = document.createElement('span');
  panelTitleBlurb.className = 'styles-panel-title-blurb';
  panelTitleBlurb.textContent = 'Curated colour, material and lighting, applied in one click';
  panelTitle.append(panelTitleName, panelTitleBlurb);

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.id = 'styles-close';
  closeButton.className = 'styles-close';
  closeButton.textContent = '×';
  closeButton.title = 'Close styles';
  closeButton.setAttribute('aria-label', 'Close styles');
  /*
    The head is the row the sweep controls live in. `.styles-sweep` is inserted before the close
    glyph once it is built, a few dozen lines down -- it cannot be appended here because it does not
    exist yet, and moving its construction above the head would put the sweep row's whole apparatus
    in front of the gallery it belongs to.
  */
  panelHead.append(panelTitle, closeButton);

  /*
    One shelf of the gallery: a heading, a sentence saying what it is for, and a grid of tiles.

    The heading is what turns ninety tiles from a wall into a set of answers to different questions.
    `.styles-grid` is reused as the grid's class rather than given a per-row one, so the sizing rule
    that stops a percentage-sized tile collapsing in its track keeps applying to every row without
    that rule having to know how many rows there are.
  */
  function buildRowSection(id, label) {
    const section = document.createElement('section');
    section.className = 'styles-row';
    section.dataset.row = id;

    const heading = document.createElement('h3');
    heading.className = 'styles-row-title';
    heading.textContent = label;
    heading.id = `styles-row-${id}-title`;

    /*
      The note is built but not placed. A row's catalogue blurb is not drawn -- the heading says
      what the shelf is and the tiles say the rest, and a sentence per shelf costs a line of height
      on every one of them. Recommended needs one line of prose for its empty state,
      so the element is returned for that row to place above the row itself.
    */
    const note = document.createElement('p');
    note.className = 'styles-row-blurb';

    const rowGrid = document.createElement('div');
    rowGrid.className = 'styles-grid';
    rowGrid.setAttribute('role', 'group');
    rowGrid.setAttribute('aria-labelledby', heading.id);

    section.append(heading, rowGrid);
    return { section, heading, note, grid: rowGrid };
  }

  /*
    The Recommended row leads the gallery, and it is the only one whose membership changes. Its
    heading carries the `Why these?` button, the only one.
  */
  const recommended = buildRowSection('recommended', 'Recommended');
  recommended.grid.id = 'styles-grid';
  const whyGallery = document.createElement('button');
  whyGallery.type = 'button';
  whyGallery.id = 'styles-why-gallery';
  whyGallery.className = 'styles-why-toggle';
  whyGallery.textContent = 'Why these?';
  whyGallery.setAttribute('aria-expanded', 'false');
  whyGallery.setAttribute('aria-controls', 'styles-why-panel');
  /*
    The tenth slot of the Recommended row.

    The recommendation is a weighted sample of what suits the loaded structure, so there is always
    more than one right answer and this is how the other ones are reached. It sits *in* the grid, as
    the last cell, because the offer belongs to the set of tiles it would replace -- a button above
    the row would read as a setting, and an eleventh cell would change the row's width.

    A button, like everything else on this surface: nothing in the Styles overlay may be an input,
    or `.app-shell`'s capture-phase listener would mark the session dirty from a value nobody
    applied.
  */
  const resampleAction = document.createElement('button');
  resampleAction.type = 'button';
  resampleAction.id = 'styles-resample';
  resampleAction.className = 'styles-resample';
  const resampleTop = document.createElement('span');
  resampleTop.className = 'styles-resample-line';
  resampleTop.textContent = 'Randomize';
  const resampleBottom = document.createElement('span');
  resampleBottom.className = 'styles-resample-line';
  resampleBottom.textContent = 'styles';
  resampleAction.append(resampleTop, resampleBottom);
  resampleAction.title = 'Sample another set of styles that suit this structure';
  const grid = recommended.grid;

  /*
    The Recommended row is two columns -- the current-Style lead, then the recommendations -- and each
    column carries its own caption over its own tiles.

    That is what aligns them, structurally rather than by a nudge. A heading above the *whole* row
    would leave the lead's `Current style` caption as the only thing between the heading and a
    picture: the lead's tile would start one caption-height lower than every tile in the grid beside
    it, and the row would read as if the current Style had been demoted. `Recommended` captions the
    grid at the same height `Current style` captions the lead, both column heads are pinned to one
    height in styles.css, and the two rows of pictures start on the same line.

    It also has to hold when the lead is **absent**, which is the state the app opens in and the state
    it returns to on every new structure. The grid's caption is a child of the grid's own column, so
    nothing about the layout depends on the lead existing -- the row simply loses its first column.
  */
  const recommendedHead = document.createElement('div');
  recommendedHead.className = 'styles-recommended-head';
  recommendedHead.append(recommended.heading, whyGallery);

  const recommendedMain = document.createElement('div');
  recommendedMain.className = 'styles-recommended-main';
  recommendedMain.append(recommendedHead, grid);

  const recommendedBody = document.createElement('div');
  recommendedBody.className = 'styles-recommended-body';
  recommendedBody.append(galleryLead.root, recommendedMain);
  // `buildRowSection` laid the heading and the grid out as siblings; both have moved, so the
  // section is rebuilt from the body rather than having the leftovers picked out of it.
  recommended.section.replaceChildren(recommendedBody);

  /*
    The sweep controls, in the gallery's head rather than in a footer under eleven shelves of tiles.

    As the last row of a scrolling panel they would put the one control that changes what a tile
    click *means* below everything it changes -- reachable only after scrolling past the tiles, and
    off screen again the moment you scroll back up to click one. In the head they sit in the empty
    half of the row beside the close glyph, on screen for every tile in every shelf.
  */
  const sweepBar = document.createElement('div');
  sweepBar.className = 'styles-sweep';

  /*
    The one control that turns tile clicks from "apply this" into "include this". A mode rather
    than a button under every tile: a per-tile control and a copy of it in the action bar would be
    the same state offered twice, and the tile itself is a broad target that already carries the
    blue rim. It is a button with `aria-pressed`, so choosing what to render cannot reach
    main.js's capture-phase `change`/`input` listener and mark the document unsaved.
  */
  const sweepModeButton = document.createElement('button');
  sweepModeButton.type = 'button';
  sweepModeButton.id = 'styles-sweep-mode';
  sweepModeButton.className = 'styles-sweep-mode';
  sweepModeButton.setAttribute('aria-pressed', 'false');
  sweepModeButton.setAttribute('aria-controls', 'styles-grid');

  // Which Styles the next walk covers, kept beside the button that starts it so the count and the
  // action read as one sentence.
  const sweepPicks = document.createElement('div');
  sweepPicks.className = 'styles-sweep-picks';
  /*
    Every Style in the catalogue, with no cap in front of it, so the button does what it says.
  */
  const sweepAll = document.createElement('button');
  sweepAll.type = 'button';
  sweepAll.id = 'styles-sweep-all';
  sweepAll.textContent = 'Select all';
  sweepAll.title = `Choose all ${STYLE_CATALOG.length} styles`;
  const sweepNone = document.createElement('button');
  sweepNone.type = 'button';
  sweepNone.id = 'styles-sweep-none';
  sweepNone.textContent = 'None';
  sweepNone.title = 'Clear the chosen styles';
  /*
    The default membership, offered as a control.

    A prefix is no good on a catalogue ordered by structure class, where the first twelve are one or
    two whole rows and none of the others. So the default is the recommended subset, and this button
    is how to get back to it after picking by hand.
  */
  const sweepRecommended = document.createElement('button');
  sweepRecommended.type = 'button';
  sweepRecommended.id = 'styles-sweep-recommended';
  sweepRecommended.textContent = 'Recommended';
  sweepRecommended.title = 'Choose the styles recommended for this structure';
  const sweepCount = document.createElement('span');
  sweepCount.id = 'styles-sweep-count';
  sweepCount.className = 'stage-strip-note';
  sweepPicks.append(sweepRecommended, sweepAll, sweepNone, sweepCount);

  /*
    The point of the mode, and the only primary in the sweep row. Solid accent here (the shell's own
    `.primary`) outweighs the mode button's `aria-pressed` tint, so the emphasis is on the thing the
    mode exists to set up rather than on leaving the mode, and the tint reports only that choosing
    is on.

    Its label is written by renderSweepState, from the chosen subset.
  */
  const sweepStart = document.createElement('button');
  sweepStart.type = 'button';
  sweepStart.id = 'styles-sweep-start';
  sweepStart.className = 'primary';
  sweepStart.textContent = SWEEP_START_LABEL;
  const sweepContinue = document.createElement('button');
  sweepContinue.type = 'button';
  sweepContinue.id = 'styles-sweep-continue';
  sweepContinue.textContent = 'Continue';
  sweepContinue.hidden = true;
  const sweepStop = document.createElement('button');
  sweepStop.type = 'button';
  sweepStop.id = 'styles-sweep-stop';
  sweepStop.className = 'danger';
  sweepStop.textContent = 'Stop';
  sweepStop.hidden = true;
  const sweepStatus = document.createElement('p');
  sweepStatus.id = 'styles-sweep-status';
  sweepStatus.className = 'range-help';
  sweepStatus.setAttribute('role', 'status');
  sweepStatus.setAttribute('aria-live', 'polite');
  sweepBar.append(
    sweepModeButton,
    sweepPicks,
    sweepStart,
    sweepContinue,
    sweepStop,
    sweepStatus,
  );

  sweepBar.hidden = !SWEEP_OFFERED;
  panelHead.insertBefore(sweepBar, closeButton);

  // Recommended leads, then the eleven shelves in catalogue order. The sweep controls are in the head.
  const rowSections = STYLE_ROWS.map((row) => ({
    row,
    ...buildRowSection(row.id, row.label),
  }));
  panel.append(
    panelHead,
    recommended.section,
    ...rowSections.map(({ section }) => section),
  );
  stage.append(panel);

  /*
    The explanation, and the reason the Recommended row is a recommendation rather than a mood.

    It reports the facts it read *before* the sentences it drew from them, and it reports absences
    too -- "No ligands or ions" -- because a rule that did not fire is as much a part of the answer
    as one that did, and a silent absence reads as an oversight. Naming the facts is what makes the
    row auditable: a user who disagrees can see exactly which reading produced it.

    A `div` of text, not a dialog: it explains a row of pictures, and interrupting a browse to
    explain a browse would weigh more than the thing it explains -- the same judgement that makes
    `#styles-restore-hint` a sentence rather than a modal.
  */
  const whyPanel = document.createElement('div');
  whyPanel.id = 'styles-why-panel';
  whyPanel.className = 'styles-why-panel';
  whyPanel.hidden = true;
  whyPanel.setAttribute('role', 'group');
  whyPanel.setAttribute('aria-label', 'Why these styles are recommended');
  const whyHead = document.createElement('p');
  whyHead.className = 'styles-why-head';
  const whyFacts = document.createElement('ul');
  whyFacts.id = 'styles-why-facts';
  whyFacts.className = 'styles-why-facts';
  whyPanel.append(whyHead, whyFacts);
  stage.append(whyPanel);

  /*
    The Style card: one element, one title, everything about one Style.

    From the top: the enlargement of the tile's own artwork, the Style's name, then the two
    questions to decide before committing -- whether to finish the render with Improve image, and
    which colour scheme -- ending in an explicit Cancel or Apply style. No prose: the card is a
    picture and a set of decisions, and every sentence would be a line of height in front of the
    Apply button.

    THE ENLARGEMENT LIVES HERE rather than in the shared `#tile-magnifier`. As two absolutely
    positioned surfaces, the picture and the decisions about it would each have to find room beside
    the other; as one box there is one title and nothing to co-ordinate, and the name over the
    picture and the name over the Apply button cannot describe different Styles.

    It is painted by copying the tile's own art node, exactly as tile-magnifier.js does: `paintTileArt`
    has already decided the fallback chain (swept draft, else reference thumbnail, else catalogue
    swatch, else hatch), so copying keeps that single-sourced and a tile showing a sweep draft
    enlarges the draft.

    Hover opens it, a click pins it open, and it is registered with the `coordinateOverlay` contract
    just below so it also dismisses on Escape and on a press outside.

    Every control here is a button with `aria-pressed`, for the same reason nothing else in this
    module is an `<input>`: `.stage` is inside `.app-shell`, whose capture-phase `change`/`input`
    listener in main.js marks the session dirty and enters a history step from any raw input --
    which an unapplied preview value in this panel must never do.

    DEPTH OF FIELD IS NOT ASKED ABOUT HERE, deliberately. Picking a focus point is a real preview
    interaction gated on the real `#depth-of-field-enabled` checkbox, so it would have to be live
    before Apply in a card where nothing else is, all to re-offer controls the Camera card already
    has. Depth of field is still applied -- every Style authors `depth_of_field_enabled` and
    `styleWrites()` writes it. Changing it afterwards is the Camera card's job, which is where the
    f-stop and the focus picker live anyway.
  */
  const optionsPanel = document.createElement('div');
  optionsPanel.id = 'style-options-panel';
  optionsPanel.className = 'style-options-panel';
  optionsPanel.hidden = true;
  optionsPanel.setAttribute('role', 'group');
  optionsPanel.setAttribute('aria-label', 'Style options');

  /*
    Presentational: the tile it was opened from carries the accessible name, and the title right
    under this says it again in text. A picture with no alternative text is the correct thing here --
    it is a *preview of a rendering*, and there is nothing true to say about it that the label below
    does not already say.
  */
  const optionsArtNode = document.createElement('span');
  optionsArtNode.id = 'style-options-art';
  optionsArtNode.className = 'style-options-art';
  optionsArtNode.setAttribute('aria-hidden', 'true');

  const optionsTitle = document.createElement('p');
  optionsTitle.id = 'style-options-title';
  optionsTitle.className = 'style-options-title';
  /*
    Improve image, as one switch.

    Not `Apply to next render`, which is four words of mechanism on a narrow card and wrong about
    the mechanism as well: the finishing recipe carries forward to every render after it, not just
    the next one, until it is Reset. So the button is a switch -- `On`/`Off`, the same shape as
    every other `aria-pressed` control in this module -- with its title attribute carrying what it
    does.
  */
  const optionsImproveSection = document.createElement('div');
  optionsImproveSection.className = 'style-options-section';
  const optionsImproveRow = document.createElement('div');
  optionsImproveRow.className = 'style-options-row';
  const optionsImproveLabel = document.createElement('span');
  optionsImproveLabel.className = 'style-options-row-label';
  optionsImproveLabel.textContent = 'Improve image';
  const optionsImproveButton = document.createElement('button');
  optionsImproveButton.type = 'button';
  optionsImproveButton.id = 'style-options-improve';
  optionsImproveButton.className = 'style-options-switch';
  optionsImproveButton.setAttribute('aria-pressed', String(IMPROVE_DEFAULT));
  optionsImproveButton.title = 'Finish renders with this Style\'s own Improve image recipe.';
  optionsImproveRow.append(optionsImproveLabel, optionsImproveButton);
  optionsImproveSection.append(optionsImproveRow);

  /*
    The colour scheme. Every Style has one, whatever colour mode it is in -- see
    `src/style-color-schemes.js` for the family behind each of the eight modes. Each scheme's name
    is on its own swatch as the accessible name and the tooltip, rather than on a line under the
    row: a name that only describes the swatch the pointer is already on does not need permanent
    height.
  */
  const optionsColorSection = document.createElement('div');
  optionsColorSection.className = 'style-options-section';
  const optionsColorLabel = document.createElement('span');
  optionsColorLabel.className = 'style-options-row-label';
  optionsColorLabel.textContent = 'Colour scheme';
  const optionsColorGrid = document.createElement('div');
  optionsColorGrid.id = 'style-options-colors';
  optionsColorGrid.className = 'style-options-swatches';
  optionsColorGrid.setAttribute('role', 'group');
  optionsColorGrid.setAttribute('aria-label', 'Colour scheme');
  /*
    The second group, under the first and hidden unless the Style states `extra_colors`. It is one
    more swatch row and not a second kind of control: the entries in it are ordinary schemes, chosen
    by the same click into the same `optionsSchemeId`, so the name line below belongs to both rows
    and there is still exactly one chosen swatch across the two.
  */
  const optionsExtraLabel = document.createElement('span');
  optionsExtraLabel.className = 'style-options-row-label';
  optionsExtraLabel.textContent = EXTRA_COLOR_GROUP_LABEL;
  const optionsExtraGrid = document.createElement('div');
  optionsExtraGrid.id = 'style-options-extra-colors';
  optionsExtraGrid.className = 'style-options-swatches';
  optionsExtraGrid.setAttribute('role', 'group');
  optionsExtraGrid.setAttribute('aria-label', EXTRA_COLOR_GROUP_LABEL);
  optionsColorSection.append(
    optionsColorLabel,
    optionsColorGrid,
    optionsExtraLabel,
    optionsExtraGrid,
  );

  const optionsFooter = document.createElement('div');
  optionsFooter.className = 'style-options-footer';
  const optionsCancel = document.createElement('button');
  optionsCancel.type = 'button';
  optionsCancel.id = 'style-options-cancel';
  optionsCancel.textContent = 'Cancel';
  const optionsApply = document.createElement('button');
  optionsApply.type = 'button';
  optionsApply.id = 'style-options-apply';
  optionsApply.className = 'primary';
  optionsApply.textContent = 'Apply style';
  optionsFooter.append(optionsCancel, optionsApply);

  optionsPanel.append(
    optionsArtNode,
    optionsTitle,
    optionsImproveSection,
    optionsColorSection,
    optionsFooter,
  );
  stage.append(optionsPanel);


  /*
    One swatch fill for all three scheme shapes, so a uniform hex, a two-colour gradient and a
    five-colour palette read as the same kind of control. One colour keeps `--swatch-color`, which is
    the picker's own variable and the reason a single-colour swatch here looks identical to one in the
    Protein card; more than one is painted as hard stops, because a palette is a set of distinct
    colours and blending them would misdescribe it. A two-colour gradient is the exception and stays
    smooth, since that is literally what it renders as.
  */
  function paintSchemeSwatch(swatch, entry) {
    const colors = entry.swatch ?? [];
    swatch.dataset.multi = String(colors.length > 1);
    if (colors.length <= 1) {
      swatch.style.removeProperty('background');
      swatch.style.setProperty('--swatch-color', colors[0] ?? 'transparent');
      return;
    }
    if (entry.kind === 'gradient') {
      swatch.style.background = `linear-gradient(90deg, ${colors[0]}, ${colors.at(-1)})`;
      return;
    }
    const step = 100 / colors.length;
    const stops = colors
      .map((hex, index) => `${hex} ${index * step}% ${(index + 1) * step}%`)
      .join(', ');
    swatch.style.background = `linear-gradient(90deg, ${stops})`;
  }


  /*
    The card's enlargement, copied from the tile rather than resolved again. `paintTileArt` owns the
    fallback chain, so copying is what keeps a Style's picture single-sourced -- and it is why a tile
    that has just been repainted with a sweep draft enlarges the draft and not the reference thumb.
  */
  function paintOptionsArt() {
    if (!optionsArt) {
      optionsArtNode.hidden = true;
      return;
    }
    optionsArtNode.hidden = false;
    optionsArtNode.style.background = optionsArt.style.background;
    optionsArtNode.classList.toggle(
      'is-placeholder',
      optionsArt.classList.contains('is-placeholder'),
    );
  }


  function paintOptionsPanel() {
    if (!optionsStyle) return;
    paintOptionsArt();
    optionsTitle.textContent = optionsStyle.label;

    optionsImproveButton.setAttribute('aria-pressed', String(optionsImprove));
    optionsImproveButton.textContent = optionsImprove ? 'On' : 'Off';

    // One entry means there is exactly one way to colour this Style, so there is nothing to choose
    // and a grid of one swatch would only ask a question with a single answer.
    optionsColorSection.hidden = optionsSchemes.length < 2;
    const schemeSwatch = (entry) => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'color-swatch';
      swatch.dataset.scheme = entry.id;
      paintSchemeSwatch(swatch, entry);
      swatch.setAttribute('aria-pressed', String(entry.id === optionsSchemeId));
      swatch.setAttribute('aria-label', entry.label);
      swatch.title = entry.label;
      swatch.addEventListener('click', () => {
        optionsSchemeId = entry.id;
        paintOptionsPanel();
      });
      return swatch;
    };
    const primary = schemesInGroup(optionsSchemes, SCHEME_GROUP);
    const extra = schemesInGroup(optionsSchemes, EXTRA_COLOR_GROUP);
    optionsColorGrid.replaceChildren(...primary.map(schemeSwatch));
    optionsExtraGrid.replaceChildren(...extra.map(schemeSwatch));
    optionsExtraLabel.hidden = extra.length === 0;
    optionsExtraGrid.hidden = extra.length === 0;
    /*
      Six per row, always, for the single-colour families. The row is a wrapping flexbox in a 224px
      box, which fits seven 24px swatches and then breaks -- so the twelve named presets would draw
      7 + 5 and read as a row with a remainder rather than as a set.

      A palette, gradient or duo swatch is a pill rather than a circle, and left to the flow those
      wrap the same way: at the pill's natural 42px four fit a row, so the eighteen duo pairs would
      draw 4 + 4 + 4 + 4 + 2 and a seven-entry menu 4 + 3. So the column count is chosen from the
      entry count instead of from the pill's width: the largest divisor of the count that still
      leaves a legible swatch, with the tracks sharing the box, so the last row always holds as many
      swatches as the rows above it. Eighteen draws 3x6, eight draws 2x4, seven draws one row of
      seven.
    */
    const singleColour = (entries) => entries.length > 0
      && entries.every((entry) => (entry.swatch ?? []).length <= 1);
    /*
      The ceiling is a width, not a taste: MULTI_SWATCH_MAX_COLUMNS tracks plus their gaps leave
      about 27px per pill in the card's 224px content box, which is the point below which two or
      more colours stop being countable. 1 always divides, so the loop always returns.
    */
    const evenColumns = (count) => {
      for (let columns = MULTI_SWATCH_MAX_COLUMNS; columns > 1; columns -= 1) {
        if (count % columns === 0) return columns;
      }
      return 1;
    };
    const layoutSwatches = (grid, entries) => {
      if (singleColour(entries)) {
        grid.dataset.columns = '6';
        grid.style.removeProperty('--swatch-columns');
        return;
      }
      grid.dataset.columns = entries.length > 0 ? 'even' : 'flow';
      grid.style.setProperty('--swatch-columns', String(evenColumns(entries.length)));
    };
    layoutSwatches(optionsColorGrid, primary);
    layoutSwatches(optionsExtraGrid, extra);
  }


  /*
    Beside the tile it belongs to, and nothing else is consulted.

    This is the whole placement: right of the tile if the card fits there, left of it otherwise,
    top-aligned with the tile's own top, then clamped inside `.stage` -- the same idiom as
    `placeWhyPanel`.

    Top-aligned rather than centred on the tile, because the card is much taller than a tile: a
    centred card over a tile on the top shelf would clamp to the stage's top edge and stop being
    beside anything.
  */
  function placeOptionsPanel(anchor) {
    const host = stage.getBoundingClientRect();
    const size = optionsPanel.getBoundingClientRect();
    let left = CARD_MARGIN;
    let top = CARD_MARGIN;
    if (anchor?.isConnected) {
      const box = anchor.getBoundingClientRect();
      const rightOf = box.right - host.left + CARD_GAP;
      const leftOf = box.left - host.left - size.width - CARD_GAP;
      left = rightOf + size.width <= host.width - CARD_MARGIN || leftOf < CARD_MARGIN
        ? rightOf
        : leftOf;
      top = box.top - host.top;
    }
    left = Math.min(
      Math.max(left, CARD_MARGIN),
      Math.max(CARD_MARGIN, host.width - size.width - CARD_MARGIN),
    );
    top = Math.min(
      Math.max(top, CARD_MARGIN),
      Math.max(CARD_MARGIN, host.height - size.height - CARD_MARGIN),
    );
    optionsPanel.style.left = `${Math.round(left)}px`;
    optionsPanel.style.top = `${Math.round(top)}px`;
  }


  /*
    Which scheme the card comes up on. The authored one, wherever in the row it sits, so the picker
    always has something framed -- unless this Style *is* the composition and was applied in one of the others,
    in which case the frame reports what is on screen rather than resetting the user's own choice.

    Both guards are load-bearing. `activeStyleId` is what a click on an owned control clears, so an
    edit away from the Style drops the memory with the amber ring; and a scheme id is only offered
    when this Style's own list still contains it, since the families are per colour mode and a
    remembered id from another mode would be a dangling reference.
  */
  function openingSchemeId(style, schemes) {
    // The Style's own swatch, wherever it sits: a stated `color_schemes` list is the whole menu in
    // the catalogue's order, so `As designed` is not always the first entry.
    const fallback = schemes.some((entry) => entry.id === 'authored')
      ? 'authored'
      : schemes[0]?.id ?? 'authored';
    if (!style || style.id !== activeStyleId) return fallback;
    if (appliedScheme?.styleId !== style.id) return fallback;
    return schemes.some((entry) => entry.id === appliedScheme.schemeId)
      ? appliedScheme.schemeId
      : fallback;
  }


  /*
    `art` is the tile's painted artwork node, which the card copies for its own enlargement. Tier 1's
    minis have none and never open this: a mini is a preview of the set and a doorway into it, so it
    opens the gallery instead.

    `pinned` is the click. A hovered card follows the pointer to the next tile and retracts when the
    pointer leaves the tile and the card; a pinned one holds still until it is dismissed explicitly.
    A pinned card is never replaced by a hover, which is what lets the user move the pointer off the
    tile and into the card without the card they were reading being swapped for a neighbour's.
  */
  function openOptionsPanel(style, anchor, art, { pinned = false } = {}) {
    if (!style) return;
    if (optionsPinnedOpen && !pinned) return;
    optionsStyle = style;
    optionsAnchor = anchor;
    optionsArt = art;
    optionsSchemes = styleColorSchemes(style);
    optionsSchemeId = openingSchemeId(style, optionsSchemes);
    optionsImprove = IMPROVE_DEFAULT;
    optionsPinnedOpen = pinned;
    optionsPanel.hidden = false;
    announceOverlayOpen('styles');
    paintOptionsPanel();
    placeOptionsPanel(anchor);
    syncConfiguring();
  }


  function closeOptionsPanel() {
    window.clearTimeout(cardTimer);
    cardPending = undefined;
    optionsPinnedOpen = false;
    if (optionsPanel.hidden) return;
    optionsPanel.hidden = true;
    optionsStyle = undefined;
    optionsAnchor = undefined;
    optionsArt = undefined;
    optionsSchemes = [];
    syncConfiguring();
  }


  /*
    The low-key ring on the tile whose Style card is open -- hovered or clicked, nothing applied yet.

    Its own writer rather than a branch inside `setActive`, because it answers a different question
    and can be true at the same time as any of the other three states: the applied Style's amber
    ring, sweep membership's blue rim, and the `Draft` chip. Which one *wins* visually is decided by
    CSS rule order in styles.css -- amber after neutral -- not here.
  */
  function syncConfiguring() {
    const id = optionsPanel.hidden ? undefined : optionsStyle?.id;
    tiles.forEach((tile, styleId) => {
      allNodes(styleId).forEach(({ button }) => {
        // Tiles only: the ring says "this is the tile the open card is about", and a mini can never
        // be that -- a mini opens the gallery, it does not open a card.
        if (!button.classList.contains('style-mini')) {
          button.classList.toggle('is-configuring-style', styleId === id);
        }
      });
    });
  }


  /*
    The panel's Apply: the Style as the chosen scheme renders it -- `styleWithScheme()` lays the
    scheme's writes over the authored ones and brings any overlay pass that was a copy of the base
    along with them -- rather than teaching the allowlist reader about per-call overrides. `apply()`
    still does the actual writing, so a configured apply and a plain `applyFromUi()` apply go through
    exactly one path from there on.

    Applying then closes the gallery. The gesture is finished: the point of the gallery is choosing,
    and leaving a wall of pictures over the canvas after a Style has landed hides the thing the click
    was for. `setExpanded(false)` takes the card with it, so nothing is left pointing at a tile that
    is no longer on screen.
  */
  async function applyWithOptions(style, options) {
    if (!style || busy()) return;
    const scheme = colorSchemeById(style, options.schemeId);
    await rememberMySettings();
    await apply(styleWithScheme(style, scheme), { scheme });
    /*
      Armed unconditionally, not only when checked, so a previous Apply's arm cannot leak onto a
      render this one never asked to improve.

      `improveForStyle()` and not `automaticPostProcessing()`: forty Styles are composed under a
      finishing pass of their own -- the glass and glow entries most of all -- and arming Auto
      improve for all ninety would render those flat beside the tile that was clicked. See
      `src/catalog/style-improve.js`; a Style with no recipe of its own still gets Auto improve
      from there.
    */
    armImproveImage(options.improveImage ? improveForStyle(style.id) : undefined);
    setExpanded(false);
  }


  optionsImproveButton.addEventListener('click', () => {
    optionsImprove = !optionsImprove;
    paintOptionsPanel();
  });
  optionsCancel.addEventListener('click', () => closeOptionsPanel());

  optionsApply.addEventListener('click', () => {
    const style = optionsStyle;
    const options = { schemeId: optionsSchemeId, improveImage: optionsImprove };
    closeOptionsPanel();
    // Not `void`: `applyWithOptions()` banks the composition through `buildRenderRequest()`, which
    // refuses a control the user has left mid-edit, and a rejection under `void` would reach
    // nothing.
    applyWithOptions(style, options).catch(reportStyleFailure);
  });


  /*
    Every draft registered as held, released once the sweep stops referencing it. The candidate cap
    would otherwise revoke the oldest tiles' URLs partway through a walk the sweep does not cap.
  */
  const heldResults = new Set();
  function releaseDroppedResults(snapshot) {
    const referenced = new Set(snapshot.results.values());
    const dropped = [...heldResults].filter((entry) => !referenced.has(entry));
    if (dropped.length === 0) return;
    dropped.forEach((entry) => heldResults.delete(entry));
    releaseResults(dropped);
  }

  const sweep = createStyleSweep({
    styles: STYLE_CATALOG,
    renderOne: async (id) => {
      const style = STYLE_CATALOG.find((candidate) => candidate.id === id);
      await apply(style, { fromSweep: true });
      const result = await renderOne();
      const entry = result
        ? registerResult(result, {
          origin: 'style',
          styleId: style.id,
          label: style.label,
          quality: 'draft',
          held: true,
        })
        : undefined;
      if (entry) heldResults.add(entry);
      return entry;
    },
    onChange: (snapshot) => {
      releaseDroppedResults(snapshot);
      renderSweepState(snapshot);
    },
  });

  const tiles = new Map();

  // Every path that submits work checks this, so a walk cannot start while another is outstanding,
  // and none can start while main.js has a render of its own running.
  const busy = () => submitting || sweep.isBusy() || isBusy();


  /*
    Tier 1's art. A mini is a *preview of the set and the way into it*, never a Style you pick: at
    32px there is not enough picture to choose from, and choosing from eight of ninety would be
    choosing from the wrong list anyway. So it does what hovering the bar does -- it opens the
    gallery, where the same Style is a tile you can actually see.

    It stays a `<button>` rather than becoming decoration, because the bar has to be reachable from
    the keyboard and a focusable control is what makes that true. `aria-label` says what the click
    does and names the picture, so the promise the tooltip makes to the pointer is the one a reader
    hears.
  */
  function buildMini(style) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'style-mini';
    button.dataset.style = style.id;
    button.setAttribute('aria-label', `Browse styles — ${style.label}`);
    button.title = `${style.label}. Click to browse all styles.`;

    const art = document.createElement('span');
    art.className = 'style-mini-art';
    button.append(art);
    button.addEventListener('click', () => setExpanded(true));
    return { button, art };
  }


  // The labelled tile: the gallery's shelves and the Recommended row's lead segment share it, so one
  // hover treatment and one artwork path serve both.
  function buildTile(style) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'style-tile';
    button.dataset.style = style.id;
    button.setAttribute('aria-pressed', 'false');
    button.title = style.label;

    const art = document.createElement('span');
    art.className = 'style-tile-art';

    const label = document.createElement('span');
    label.className = 'style-tile-label';
    label.textContent = style.label;

    button.append(art, label);
    button.addEventListener('click', () => choose(style, button, art));
    /*
      Hover and focus both open the Style card: an affordance only the pointer can reach is not an
      affordance for the keyboard or for touch. Touch is excluded from the pointer path alone,
      because a touch that enters never leaves and would hold a card open over the canvas -- the
      focus a tap gives the button is what opens it there, and the tap's click pins it.
    */
    button.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'touch') return;
      scheduleCard(style, button, art, true);
    });
    button.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'touch') return;
      scheduleCard(style, button, art, false);
    });
    button.addEventListener('focus', () => scheduleCard(style, button, art, true));
    button.addEventListener('blur', () => scheduleCard(style, button, art, false));
    return { button, art };
  }


  /*
    A Style appears in up to four places at once -- the bar, the lead tile, the Recommended row
    and its own category row -- and three of those four change when the structure does. So the nodes are
    split by lifetime rather than kept in one list per Style: the category rows are built once and
    never rebuilt, and the rest are torn down and rebuilt whenever the recommendation changes.

    Everything downstream reads `allNodes(id)`, so a repaint, a pressed state or an active ring
    still reaches every copy of a Style without knowing which tier any of them is in.
  */
  const staticNodes = new Map();
  const dynamicNodes = new Map();
  /*
    A third lifetime, because the lead segment changes on a different event from the other two: the
    category rows never change, the bar and Recommended tiles change when the *structure* does, and
    the lead tile changes when a Style is applied or edited away from. Keeping it in its own map means
    `renderStyleLead()` can rebuild two tiles without `rebuildDynamicTiers()` having to run, and
    `rebuildDynamicTiers()` can clear its own map without taking the lead with it.
  */
  const leadNodes = new Map();
  const allNodes = (styleId) => [
    ...(staticNodes.get(styleId) ?? []),
    ...(dynamicNodes.get(styleId) ?? []),
    ...(leadNodes.get(styleId) ?? []),
  ];
  const styleFor = (id) => STYLE_CATALOG.find((style) => style.id === id);

  STYLE_CATALOG.forEach((style) => {
    // `swatch` is carried so every repaint below has the same inputs as the initial paint. No Style
    // declares one today; the point is that the two paths cannot disagree if one does.
    tiles.set(style.id, {
      label: style.label,
      reference: thumbUrl('style', style.id),
      swatch: style.swatch,
    });
  });

  function trackNode(store, styleId, node) {
    store.set(styleId, [...(store.get(styleId) ?? []), node]);
    const tile = tiles.get(styleId);
    paintTileArt(node.art, { thumb: tile.reference, swatch: tile.swatch });
  }

  // The eleven shelves. Built once, in catalogue order within each row, and never rebuilt: a
  // gallery whose tiles moved when the structure changed would be unlearnable.
  rowSections.forEach(({ row, grid: rowGrid }) => {
    stylesInRow(row.id).forEach((style) => {
      // Straight into the grid track. The tile carries every state itself, so there is nothing for
      // a wrapper to hold.
      const panelTile = buildTile(style);
      rowGrid.append(panelTile.button);
      trackNode(staticNodes, style.id, panelTile);
    });
  });


  /*
    What the bar and the Recommended row show.

    Before a structure is loaded there is nothing to recommend, and the honest fallback is one Style
    from each row rather than the head of the list -- the first eight of a catalogue ordered by
    structure class are the whole of "Small & detailed" and none of the other ten, which would open
    the app on a bar that misrepresents the set.
  */
  function recommendedIds() {
    if (recommendation.ids.length > 0) return recommendation.ids;
    // Eleven shelves into ten tracks wraps the row; there is no resample cell to share them with.
    return STYLE_ROWS.map((row) => stylesInRow(row.id)[0]?.id).filter(Boolean)
      .slice(0, RECOMMENDED_LIMIT);
  }


  /*
    The lead segment, in both tiers.

    Absent until a Style has been applied to this structure -- with nothing applied there is nothing
    to lead with and the row is simply the recommendation, which is the state the app opens in. Once
    something has been applied the tile stays, and only its caption changes: `Current style` while the
    composition still matches, `Previous style` after an owned control has been edited away from it.
    The tile itself is a live tile, so the way back is a click on the picture rather than a separate
    "reapply" control.

    A no-op when nothing has changed. It is called from `setActive()`, which runs on every apply and
    every clearing edit, and rebuilding two tiles on each of those would throw away the artwork
    `paintTileArt` had just put on them.
  */
  function renderStyleLead() {
    const id = activeStyleId ?? appliedStyleId;
    const kind = activeStyleId ? 'current' : 'previous';
    if (id === leadStyleId && kind === leadKind) return;
    leadStyleId = id;
    leadKind = kind;
    leadNodes.clear();
    const style = styleFor(id);
    galleryLead.root.hidden = !style;
    galleryLead.slot.replaceChildren();
    if (style) {
      galleryLead.title.textContent = kind === 'current' ? LEAD_CURRENT_LABEL : LEAD_PREVIOUS_LABEL;
      const leadTile = buildTile(style);
      galleryLead.slot.append(leadTile.button);
      trackNode(leadNodes, style.id, leadTile);
      renderSweepState(sweep.snapshot());
    }
  }


  /*
    Another draw from the same pools. It replaces the row and the sweep's default membership
    together, because the two have to agree about what "recommended" means -- and `setSelectedIds()`
    refuses while a walk is running, which is the same door `renderSweepState()` closes on the
    button itself.
  */
  function resampleRecommendations() {
    const next = recommendation.resample?.();
    if (!next || next.length === 0) return;
    recommendation = { ...recommendation, ids: next };
    rebuildDynamicTiers();
    sweep.setSelectedIds(next);
  }


  function rebuildDynamicTiers() {
    rail.replaceChildren();
    recommended.grid.replaceChildren();
    dynamicNodes.clear();

    const ids = recommendedIds();
    ids.slice(0, RAIL_COUNT).forEach((id) => {
      const style = styleFor(id);
      if (!style) return;
      const mini = buildMini(style);
      rail.append(mini.button);
      trackNode(dynamicNodes, id, mini);
    });
    ids.forEach((id) => {
      const style = styleFor(id);
      if (!style) return;
      const recommendedTile = buildTile(style);
      recommended.grid.append(recommendedTile.button);
      trackNode(dynamicNodes, id, recommendedTile);
    });
    // Last cell, and only once there is a sample to take another of. Before a structure is walked
    // the row is one Style per shelf rather than an answer, and there is nothing to resample. A
    // structure the recommender has no answer for is the same case, or the cell does nothing.
    if (recommendation.resample && recommendation.ids.length > 0) {
      recommended.grid.append(resampleAction);
    }

    /*
      The column caption is the constant `Recommended` in both states, so nothing in the row moves
      when a structure loads.
    */
    const answered = recommendation.ids.length > 0;
    // Nothing to explain until something has been read, so the affordance is not offered.
    whyGallery.hidden = !answered;
    if (!answered) setWhyOpen(false);
    renderSweepState(sweep.snapshot());
  }


  // Shown under the `Why these?` button in the Recommended row's heading, the only one.
  function setWhyOpen(open, anchor) {
    whyPanel.hidden = !open;
    whyGallery.setAttribute('aria-expanded', String(open && anchor === whyGallery));
    if (!open) return;
    whyHead.textContent = 'Chosen from what this structure contains:';
    whyFacts.replaceChildren(...recommendation.facts.map((fact) => {
      const item = document.createElement('li');
      item.textContent = fact;
      return item;
    }));
    placeWhyPanel(anchor);
  }


  function placeWhyPanel(anchor) {
    if (!anchor?.isConnected) return;
    const host = stage.getBoundingClientRect();
    const box = anchor.getBoundingClientRect();
    const size = whyPanel.getBoundingClientRect();
    const left = Math.min(
      Math.max(box.left - host.left, CARD_MARGIN),
      Math.max(CARD_MARGIN, host.width - size.width - CARD_MARGIN),
    );
    const top = Math.min(
      box.bottom - host.top + CARD_GAP,
      Math.max(CARD_MARGIN, host.height - size.height - CARD_MARGIN),
    );
    whyPanel.style.left = `${Math.round(left)}px`;
    whyPanel.style.top = `${Math.round(top)}px`;
  }


  whyGallery.addEventListener('click', () => setWhyOpen(whyPanel.hidden, whyGallery));

  /*
    The explanation is the innermost layer, so it dismisses on a press anywhere but itself and its
    own button -- including elsewhere in the gallery, which `coordinateOverlay` counts as inside the
    Styles surface and would leave it standing over. Same peel order as Escape. The toggle is
    excluded so its own click still closes rather than closing and reopening.
  */
  document.addEventListener('pointerdown', (event) => {
    if (whyPanel.hidden) return;
    if (whyPanel.contains(event.target) || whyGallery.contains(event.target)) return;
    setWhyOpen(false);
  });
  resampleAction.addEventListener('click', resampleRecommendations);


  /*
    Tier 1's minis are deliberately skipped by `syncPressed()` below. A mini does not pick a Style
    -- it opens the gallery -- so `aria-pressed` on one would be a toggle state on a control that
    toggles nothing, and would claim to a reader that the doorway is the thing that is selected. The
    mini still takes the amber `is-active-style` ring, which is a *report* about the picture rather
    than a claim about the button, and is the reason the bar is worth looking at at rest.
  */
  const isTile = (button) => !button.classList.contains('style-mini');

  /*
    One writer for `aria-pressed`, because what a pressed tile means depends on the mode: while
    choosing, it is sweep membership; otherwise it is the applied Style. Two writers would race,
    and a screen reader would hear whichever ran last. On a tile it is also the only per-tile
    selection state there is: the click applies the Style, so "this tile is on" and "this Style is
    the composition" are the same fact.
  */
  function syncPressed() {
    tiles.forEach((tile, styleId) => {
      const pressed = sweepMode ? sweep.isSelected(styleId) : styleId === activeStyleId;
      allNodes(styleId).forEach(({ button }) => {
        if (isTile(button)) button.setAttribute('aria-pressed', String(pressed));
      });
    });
  }


  /*
    `transient` is the sweep. A walk applies every chosen Style in turn and restores the pre-sweep
    composition when it ends, so those applies must not touch the lead segment: it would name each
    tile "Current style" as the walk passed over it, and -- because the lead tile is the first tile in
    the gallery -- it would reorder the gallery under a user watching results land in it. The pre-sweep
    composition is what the lead should go on reporting throughout, and `restoreSweepBaseline()` in
    main.js sets it again from the banked `style_id` on the way out.
  */
  function setActive(id, { transient = false } = {}) {
    activeStyleId = id;
    if (id && !transient) appliedStyleId = id;
    // Before the class pass, so the lead tile it may create is one of the nodes that pass reaches.
    if (!transient) renderStyleLead();
    tiles.forEach((tile, styleId) => {
      allNodes(styleId).forEach(({ button }) => {
        button.classList.toggle('is-active-style', styleId === id);
        if (styleId === id) button.setAttribute('aria-current', 'true');
        else button.removeAttribute('aria-current');
      });
    });
    syncPressed();
    syncConfiguring();
    const style = styleFor(id);
    const applied = styleFor(appliedStyleId);
    /*
      Three states, not two. "No style applied" is only true before the first apply of a structure;
      after an owned control has been edited the honest report is that a Style was applied and no
      longer describes what is on screen, which is the same fact the lead segment relabels itself for.
    */
    if (style) activeLabel.textContent = style.label;
    else if (applied) activeLabel.textContent = `${applied.label} · edited`;
    else activeLabel.textContent = 'No style applied';
  }


  /*
    The component groups this apply owns, and therefore replaces outright. Everything else is left
    exactly as the previous Style (or the user) left it -- see STYLE_COMPONENT_GROUPS in
    catalog/styles.js for the rule and why the groups are the unit rather than the field.

    Two sources, unioned, because a Style can state a component two ways: `writes` (the ion is drawn
    like *this*) and an overlay pass (there is an extra ion pass). A Style whose only ligand opinion
    is a pass still owns the ligand group -- otherwise its pass would land over a ligand base the
    previous Style set, which is the half-and-half picture the group rule exists to prevent.

    A colour scheme adds nothing here: a scheme paints a component the Style already writes, and the
    card cannot offer one for a component the Style is silent about.
  */
  function replacedComponents(style) {
    const groups = styleWrittenComponents(style);
    overlayComponents(style).forEach((component) => groups.add(component));
    return groups;
  }

  async function apply(style, { fromSweep = false, scheme } = {}) {
    if (!style) return;
    if (!fromSweep && busy()) return;
    /*
      A sweep replaces everything, every time. Stacking is a reading of what the *user* asked for by
      clicking two tiles in turn; a walk is one pass over a fixed list, and each tile has to come
      back as its own whole picture or the results stop matching the thumbnails that chose them.
      `undefined` is the full replace.
    */
    const components = fromSweep ? undefined : replacedComponents(style);
    // The writes dispatch the controls' real events, which would otherwise trip the listener below
    // and immediately clear the Style that is being applied.
    applying = true;
    try {
      applyWrites(
        resolvedStyleWrites(style, { nucleicPresent: getNucleicPresent(), components, unchosen: getUnchosenSwitches() }),
        { transient: fromSweep, components },
      );
      /*
        The per-category colours, after the writes because the colour *mode* has to have landed
        before the table for that mode can be filled in. Called even with no scheme -- from the sweep,
        or from `applyFromUi()` -- because its first job is to clear the previous Style's palette: a
        Style owns its whole colour state, and a chain colour the user hand-edited leaking into the
        next Style is the same class of bug the full replace above exists to prevent.
      */
      applyColorScheme(scheme ?? colorSchemeById(style, 'authored'), { transient: fromSweep, components });
      /*
        After the writes, never before: an overlay pass written `from: 'base'` mirrors the live
        controls, so it has to read them once this Style has finished setting them. The flag stays
        raised across it, because building a layer touches the same shell the edit listener watches.
      */
      await applyOverlays(style, { transient: fromSweep, components });
    } finally {
      applying = false;
    }
    setActive(style.id, { transient: fromSweep });
    if (!fromSweep) {
      // Unconditional, and with `authored` for the schemeless paths: a Style applied from
      // `applyFromUi()` really is in its authored colours, so leaving the
      // previous apply's answer standing would frame a scheme the picture is not in.
      appliedScheme = { styleId: style.id, schemeId: scheme?.id ?? 'authored' };
      onApplied(style.id);
    }
  }


  /*
    Applying from the UI: the tile click and the bar's own `Apply` are the same path, so the
    banked composition and the hint that points at it cannot end up on only one of them.

    The bank is taken before the write, so `Restore my settings` always points at the composition
    the user actually had rather than at the Style that replaced it.
  */
  async function applyFromUi(style) {
    if (!style || busy()) return;
    await rememberMySettings();
    await apply(style);
  }


  /*
    One sentence for both apply paths, because they fail for one reason: the bank they take first is
    `buildRenderRequest()`, so what the user has to fix is a control, and the message the builder
    throws already names which one and what it will accept.
  */
  function reportStyleFailure(error) {
    reportFailure(`The Style could not be applied: ${error.message || error}`);
  }


  /*
    Tile clicks have one meaning per mode, and the same meaning wherever the tile appears.

    While choosing, a click is sweep membership and nothing else -- it must not apply a Style, or
    picking a dozen tiles to render would leave the composition wearing the last one.

    Otherwise a click *pins* the Style card the hover already opened, rather than applying directly:
    Improve image and the colour scheme both get a chance to be set before anything is written. The
    hover is what makes the card cheap to look at; the click is what makes it safe to reach into.
    Applying itself is the card's own explicit Apply, or the other `applyFromUi()` path,
    `foldray:style-apply`.
  */
  async function choose(style, anchor, art) {
    if (busy()) return;
    if (sweepMode) {
      sweep.setSelected(style.id, !sweep.isSelected(style.id));
      return;
    }
    // A second click on the tile whose card is already pinned closes it, so the gesture that opened
    // the card is also one of the ways back out of it.
    if (optionsPinnedOpen && optionsStyle?.id === style.id) {
      closeOptionsPanel();
      return;
    }
    optionsPinnedOpen = false;
    openOptionsPanel(style, anchor, art, { pinned: true });
  }


  /*
    Reveal on hover, keyed to the tile that armed the timer. Cancelling unconditionally on leave
    is not equivalent: moving the pointer from one tile straight onto its neighbour
    fires leave on the first *after* enter on the second, so the neighbour's reveal would be
    cancelled by the tile the pointer had already left.

    Suppressed while choosing -- the card is all about applying and inspecting one Style, which is
    not what a click means in that mode -- and while anything is rendering. A pinned card is left
    alone in both directions: hovering elsewhere must not replace what the user clicked to read, and
    the pointer leaving must not retract it.
  */
  function scheduleCard(style, anchor, art, open) {
    if (open) {
      if (sweepMode || busy() || optionsPinnedOpen) return;
      window.clearTimeout(cardTimer);
      cardPending = anchor;
      cardTimer = window.setTimeout(() => {
        cardPending = undefined;
        if (!anchor.isConnected || sweepMode || busy() || optionsPinnedOpen) return;
        openOptionsPanel(style, anchor, art);
      }, CARD_ENTER_MS);
      return;
    }
    if (cardPending === anchor) {
      window.clearTimeout(cardTimer);
      cardPending = undefined;
    }
    window.clearTimeout(cardTimer);
    cardTimer = window.setTimeout(() => {
      if (optionsPinnedOpen) return;
      // The pointer may have crossed CARD_GAP onto the card itself, which is the only reason an
      // unpinned card has controls worth reaching.
      if (optionsPanel.matches(':hover') || optionsPanel.contains(document.activeElement)) return;
      closeOptionsPanel();
    }, CARD_LEAVE_MS);
  }


  /*
    Crossing the gap onto an unpinned card keeps it open, and the pointer leaving the card retracts
    it. Without the first half the card would be a picture you can look at and never touch; without
    the second it would be a picture that never goes away.
  */
  optionsPanel.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'touch') return;
    window.clearTimeout(cardTimer);
    cardPending = undefined;
  });
  /*
    Reaching into the card pins it, the same as clicking the tile did. Capture phase, so it lands
    before the button's own handler and before `closeOptionsPanel` can run on Cancel.

    Without this, choosing a colour scheme and then letting the pointer stray out of the box would
    throw the choice away -- and the user would have no way to know that the card they were setting
    up was still the provisional one a hover had opened. Touching a control is an unambiguous
    statement that this is the Style being configured.
  */
  optionsPanel.addEventListener('pointerdown', () => { optionsPinnedOpen = true; }, true);
  optionsPanel.addEventListener('focusin', () => { optionsPinnedOpen = true; });
  optionsPanel.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'touch') return;
    if (optionsPinnedOpen) return;
    window.clearTimeout(cardTimer);
    cardTimer = window.setTimeout(() => {
      if (optionsPinnedOpen || optionsPanel.matches(':hover')) return;
      closeOptionsPanel();
    }, CARD_LEAVE_MS);
  });


  function renderSweepState(snapshot) {
    sweepStatus.textContent = snapshot.message;
    const running = snapshot.state === 'measuring' || snapshot.state === 'running';
    const locked = running || submitting;
    // Stage camera controls live outside the three bulk-disabled editor containers. Let main.js
    // mirror every Styles path's lock rather than leaving them live during baseline capture or the
    // short gaps between sequential sweep renders.
    onBusyChange(locked);
    sweepCount.textContent = `${snapshot.total} of ${STYLE_CATALOG.length} chosen`;
    // Same `snapshot.total` the line above reports, so the count beside the button and the count on
    // it cannot disagree -- and neither is ever `STYLE_CATALOG.length`, which is the catalogue and
    // not the list the walk covers.
    sweepStart.textContent = sweepStartLabel(snapshot.total);
    /*
      The whole choosing apparatus is disclosed by the mode, not just enabled by it. A running walk
      keeps it on screen regardless, because Stop and the progress it reports belong to the same
      row and hiding them mid-walk would strand the only way to cancel.
    */
    const choosing = sweepMode || running;
    sweepModeButton.textContent = choosing ? 'Done choosing' : 'Choose styles to sample';
    sweepModeButton.setAttribute('aria-pressed', String(choosing));
    sweepModeButton.title = choosing
      ? 'Go back to applying a Style by clicking its tile'
      : 'Click tiles to choose which Styles the next batch samples';
    sweepModeButton.disabled = locked;
    sweepPicks.hidden = !choosing;
    sweepStart.hidden = !choosing || running || snapshot.state === SWEEP_DONE
      || snapshot.state === SWEEP_FAILED || snapshot.canResume;
    sweepContinue.hidden = !choosing
      || !(snapshot.canResume && snapshot.completed < snapshot.total);
    sweepStop.hidden = !running;
    sweepStart.disabled = locked || snapshot.total === 0;
    sweepContinue.disabled = locked;
    sweepAll.disabled = locked;
    sweepNone.disabled = locked;
    sweepRecommended.disabled = locked || recommendation.ids.length === 0;
    // A walk covers a list that was fixed when it started, so resampling under it would change the
    // row without changing what is being rendered.
    resampleAction.disabled = locked || sweepMode;
    // Visible throughout a walk, because it lives in the bar; not usable during one, because the
    // walk restores the pre-sweep composition itself when it ends.
    restoreAction.disabled = locked;
    sweepStatus.classList.toggle('error', snapshot.state === SWEEP_FAILED);
    panel.dataset.sweepMode = choosing ? 'on' : 'off';
    // A swept tile shows the user's own structure; everything else keeps its reference render. Every
    // tier of a Style repaints together, so tier 1's art can never disagree with the gallery's.
    tiles.forEach((tile, id) => {
      const swept = snapshot.results.get(id);
      const chosen = snapshot.chosen.has(id);
      allNodes(id).forEach(({ button, art }) => {
        paintTileArt(art, { thumb: tile.reference, swatch: tile.swatch }, swept?.url);
        button.classList.toggle('has-style-result', Boolean(swept?.url));
        /*
          Only while choosing. Membership defaults to the recommendation (or the first twelve), so
          at rest the rim would sit on tiles with nothing on screen saying what it meant -- "these
          are selected" over a gallery where selection means something else entirely. It is a
          property of the mode that manages it, and it appears with that mode.
        */
        button.classList.toggle('is-sweep-selected', choosing && chosen);
        // The mini's name says what its click does and is never about membership -- a mini is not in
        // the sweep's list, it is the way to the gallery where that list is chosen.
        if (isTile(button)) {
          button.setAttribute(
            'aria-label',
            choosing
              ? `${chosen ? 'Chosen' : 'Not chosen'} for the next sweep: ${tile.label}`
              : tile.label,
          );
        }
      });
    });
    syncPressed();
    // The card's enlargement is a copy of a tile's art, so a repaint that lands while it is open has
    // to be copied again or it goes on showing the reference thumbnail under a finished draft.
    if (!optionsPanel.hidden) paintOptionsPanel();
    if (snapshot.state === SWEEP_DONE) sweepStart.hidden = true;
    // A run in progress owns the stage; a card pointing at a tile that is about to repaint would be
    // pointing at the wrong picture by the time it was read.
    if (running) closeOptionsPanel();
  }


  /*
    Leaving the mode is refused mid-walk for the same reason choosing is: the list the walk is
    passing over must not change underneath it, and the mode is what exposes the controls that
    would change it.
  */
  function setSweepMode(next) {
    if (next === sweepMode || sweep.isBusy()) return;
    sweepMode = next;
    // Membership and the applied Style are different pressed states; leave neither stale.
    if (next) closeOptionsPanel();
    renderSweepState(sweep.snapshot());
  }


  /*
    The Styles surfaces the hover gesture treats as one region: the bar, the gallery it opens, the
    Style card that hangs off a tile in it, and the explanation. They are separate absolutely
    positioned elements -- the card and the explanation are children of `.stage`, not of the gallery
    -- so moving the pointer from a tile onto the card fires `pointerleave` on the gallery. Without
    all four in the group, reaching for the card's Apply button would close the gallery underneath it.
  */
  const hoverZones = [strip, panel, optionsPanel, whyPanel];

  function holdsFocus() {
    const active = document.activeElement;
    return hoverZones.some((zone) => zone.contains(active));
  }


  function hoveringStyles() {
    return hoverZones.some((zone) => zone.matches(':hover'));
  }


  /*
    Hovering the bar opens the gallery, and hovering away from every Styles surface closes it again.

    Refused while a sweep is choosing or running: the sweep row in the gallery head is the only place
    Stop and Continue live, and a walk whose gallery retracted because the pointer wandered would strand the
    only way to cancel it. Also refused while a card is pinned -- the user clicked that card, and
    closing the gallery would take it with them.
  */
  function scheduleExpand(open, wait) {
    window.clearTimeout(hoverTimer);
    if (open && hoverDismissed) return;
    if (!open && (sweepMode || sweep.isBusy() || optionsPinnedOpen)) return;
    hoverTimer = window.setTimeout(() => {
      if (!open && (hoveringStyles() || holdsFocus() || optionsPinnedOpen)) return;
      setExpanded(open);
    }, wait);
  }


  hoverZones.forEach((zone) => {
    zone.addEventListener('pointerenter', (event) => {
      // Touch is excluded on purpose: a touch that enters never leaves, so it would hold the gallery
      // open over the canvas. On touch the focus path below is what opens it.
      if (event.pointerType === 'touch') return;
      window.clearTimeout(hoverTimer);
      if (zone === strip) scheduleExpand(true, HOVER_ENTER_MS);
    });
    zone.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'touch') return;
      // Leaving re-arms hover: Escape only dismisses the visit it was pressed during.
      hoverDismissed = false;
      scheduleExpand(false, HOVER_LEAVE_MS);
    });
  });

  /*
    Focus, not hover, is what makes the gallery reachable without a mouse -- from the keyboard, and
    from a tap, which focuses the button it lands on.

    `suppressFocusOpen` is what makes closing possible at all. Every route out of the gallery has to
    move focus off the control it is about to hide, and `#styles-doorway` in the bar is the right
    place to put it -- but the bar is exactly the region this handler watches, so `toggle.focus()`
    fires `focusin` synchronously and would reopen the gallery in the same tick that closed it,
    before the frame is painted.
  */
  let suppressFocusOpen = false;

  function focusToggleQuietly() {
    suppressFocusOpen = true;
    try {
      toggle.focus();
    } finally {
      suppressFocusOpen = false;
    }
  }

  /*
    **The doorway is exempt, or the keyboard route contradicts itself.** Were tabbing onto
    `#styles-doorway` to open the gallery by arrival, the Enter that follows would find it expanded
    and close it -- the one explicit control for this surface doing the opposite of what it says.
    Focus landing on any other control in the bar opens, which is what makes
    the bar reachable by keyboard and by tap; focus landing on the button whose own press opens it
    does not.
  */
  strip.addEventListener('focusin', (event) => {
    if (suppressFocusOpen) return;
    hoverDismissed = false;
    if (event.target === toggle) return;
    setExpanded(true);
  });
  panel.addEventListener('focusin', () => window.clearTimeout(hoverTimer));
  optionsPanel.addEventListener('focusin', () => window.clearTimeout(hoverTimer));

  /*
    Escape peels one layer at a time, innermost first: the explanation, then the Style card, then the
    gallery. Peeling rather than clearing everything is what makes it usable -- Escape out of a card
    should leave the user in the gallery they were browsing, not back at the canvas.

    The gallery is left alone while a sweep is choosing or running, which is the same rule the hover
    close follows: the sweep row in the gallery head holds Stop and Continue, and a stray Escape must not hide a run
    in progress.
  */
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!whyPanel.hidden) {
      setWhyOpen(false);
      return;
    }
    if (!optionsPanel.hidden) {
      const anchor = optionsAnchor;
      closeOptionsPanel();
      if (anchor?.isConnected && optionsPanel.contains(document.activeElement)) anchor.focus();
      return;
    }
    if (!expanded || sweepMode || sweep.isBusy()) return;
    hoverDismissed = true;
    const returning = panel.contains(document.activeElement);
    setExpanded(false);
    if (returning) focusToggleQuietly();
  }, true);

  // The card is anchored to a tile in a box that scrolls, so it goes rather than hanging over an
  // unrelated tile. A pinned card is no exception: the tile it names has moved out from under it.
  panel.addEventListener('scroll', closeOptionsPanel);

  /*
    A press on the gallery's own empty space closes the Style card, and nothing else.

    This is the way out of a card that the click into it creates the need for: having clicked a tile
    and read the card, the natural gesture for "never mind" is to click the grey between the tiles --
    and that press lands on the gallery, which is inside the Styles region, so the outside-press
    coordinator ignores it. The gallery deliberately stays open:
    the press was inside it, and dismissing the surface the user is still browsing would answer a
    question they did not ask.

    `.style-options-panel` is checked even though it is not a descendant of the gallery, because a
    press on the card must never count: it is exempt here by identity, not by position.
  */
  panel.addEventListener('pointerdown', (event) => {
    if (optionsPanel.hidden) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('button, [data-style], .style-options-panel')) return;
    closeOptionsPanel();
  });


  function setExpanded(next) {
    window.clearTimeout(hoverTimer);
    if (next === expanded) return;
    if (next) announceOverlayOpen('styles');
    expanded = next;
    panel.hidden = !next;
    toggle.setAttribute('aria-expanded', String(next));
    if (!next) {
      setWhyOpen(false);
      // The card is anchored to a tile in this gallery, so closing the gallery has to take it with
      // it -- otherwise it floats over the canvas pointing at a picture that is no longer there.
      closeOptionsPanel();
      // Choosing is a state of the open gallery. Left latched, it would still be on the next time
      // the gallery opened, with nothing on screen saying so.
      setSweepMode(false);
    }
  }

  coordinateOverlay({
    owner: 'styles',
    contains: (target) => strip.contains(target)
      || panel.contains(target)
      || whyPanel.contains(target)
      || optionsPanel.contains(target),
    isOpen: () => expanded || !whyPanel.hidden || !optionsPanel.hidden,
    close: () => {
      setWhyOpen(false);
      setExpanded(false);
      closeOptionsPanel();
    },
  });

  /*
    The explicit doorway. It closes as well as opens, and closing through it sets
    `hoverDismissed` -- unlike the X, which does not: this button is *in the bar*, so the pointer is
    left sitting on the very surface whose hover reopens what it just closed. The X is below the bar
    and leaves the pointer over the canvas, where the next hover is a real request.
  */
  toggle.addEventListener('click', () => {
    if (expanded) hoverDismissed = true;
    setExpanded(!expanded);
  });
  /*
    The X does exactly what a press out on the canvas does -- close the explanation, the card and the
    gallery -- and deliberately nothing more. It does *not* set `hoverDismissed`: the glyph sits below
    the bar, so the pointer is left over the canvas rather than over the surface whose hover reopens
    the gallery, and suppressing the next hover would make the bar feel broken instead. Focus goes
    back to the toggle quietly (see `focusToggleQuietly`) only when it was inside the panel being
    hidden, so a keyboard user is not dropped onto `<body>`.
  */
  closeButton.addEventListener('click', () => {
    if (sweep.isBusy()) return;
    const returning = panel.contains(document.activeElement);
    setWhyOpen(false);
    closeOptionsPanel();
    setExpanded(false);
    if (returning) focusToggleQuietly();
  });
  async function walk(method) {
    if (busy()) return;
    submitting = true;
    renderSweepState(sweep.snapshot());
    let baseline;
    try {
      baseline = await captureBaseline();
      submitting = false;
      await sweep[method]();
    } finally {
      submitting = true;
      /*
        **The restore is what may throw here; the three statements under it are what must run
        anyway.**

        In one `finally` block, a rejecting `restoreBaseline()` would leave `submitting` raised for
        the life of the page -- no apply, no sweep, no way to close the gallery -- and, worse, skip
        `renderSweepState()`, which is the only caller of `onBusyChange(false)`. That is main.js's
        `sweepClaim`: unreleased, `render-lock.js`'s `suspend()` count never reaches zero, and
        `createLiveTrace()`'s loop parks on `quiet()` for ever. One failed restore, and the studio
        stops rendering with nothing said.

        So the restore gets its own `try`, and everything that puts the interface back is in its
        `finally`, where it cannot be jumped over.
      */
      try {
        if (baseline) await restoreBaseline(baseline);
      } finally {
        submitting = false;
        /*
          A finished walk has nothing left to choose, and what the user wants next is to click the
          results. Stop and failure deliberately stay in the mode: Continue lives in the sweep row the
          mode discloses, and hiding it would strand a half-finished walk.
        */
        if (sweep.snapshot().state === SWEEP_DONE) sweepMode = false;
        renderSweepState(sweep.snapshot());
      }
    }
  }

  /*
    The walk's own status line is where a walk's failure belongs, and it has to be written *after*
    `walk()` has unwound: the `finally` above ends with `renderSweepState()`, which sets
    `sweepStatus` from the sweep's own snapshot and would otherwise overwrite this.

    Deliberately not "could not start". Two different failures reach here -- `captureBaseline()`
    refusing before the first tile, and `restoreBaseline()` refusing after the last -- and a walk
    that ran twenty-four renders and then failed to put the composition back is not one that failed
    to start. The builder's own message is what distinguishes them, so it is what is shown.
  */
  function walkAndReport(method) {
    walk(method).catch((error) => {
      sweepStatus.textContent = `The batch did not finish: ${error.message || error}`;
      sweepStatus.classList.add('error');
    });
  }

  sweepModeButton.addEventListener('click', () => setSweepMode(!sweepMode));
  sweepStart.addEventListener('click', () => walkAndReport('start'));
  sweepContinue.addEventListener('click', () => walkAndReport('resume'));
  sweepStop.addEventListener('click', () => sweep.stop());
  sweepAll.addEventListener('click', () => sweep.setAllSelected(true));
  sweepNone.addEventListener('click', () => sweep.setAllSelected(false));
  sweepRecommended.addEventListener('click', () => sweep.setSelectedIds(recommendation.ids));
  /*
    The text is written here rather than at construction so the live region has a content change to
    announce; a region that is merely unhidden with its text already in it is not reliably read.
  */
  function showRestoreHint() {
    window.clearTimeout(hintTimer);
    restoreHint.textContent = RESTORE_HINT_TEXT;
    restoreHint.hidden = false;
    hintTimer = window.setTimeout(hideRestoreHint, HINT_LINGER_MS);
  }

  function hideRestoreHint() {
    window.clearTimeout(hintTimer);
    restoreHint.hidden = true;
    restoreHint.textContent = '';
  }

  async function rememberMySettings() {
    if (!mySettingsCheckpoint) mySettingsCheckpoint = await captureMySettings();
    restoreAction.hidden = !mySettingsCheckpoint;
    /*
      The moment the sentence becomes true, and not before: with nothing banked there is no button
      to restore anything, and a notice pointing at a control that is not there would be worse than
      saying nothing. Armed once per structure, so a user who has read it does not keep being told
      about the same bank.
    */
    if (!restoreHintSeen && mySettingsCheckpoint) {
      restoreHintSeen = true;
      showRestoreHint();
    }
  }
  restoreAction.addEventListener('click', async () => {
    /*
      Refused while anything is rendering: a walk restores the pre-sweep composition itself when it
      ends, so putting the bank back underneath a run in progress would have two writers for one
      composition. The bar is on screen throughout a sweep, so this is reachable at exactly the
      moment it must not fire.
    */
    if (!mySettingsCheckpoint || busy()) return;
    const checkpoint = mySettingsCheckpoint;
    const restored = await restoreMySettings(checkpoint);
    // A failed restore keeps the bank, so the button can be pressed again.
    if (restored === false) return;
    mySettingsCheckpoint = undefined;
    restoreAction.hidden = true;
    // The hint explained this button; once it has been used, it has nothing left to explain.
    hideRestoreHint();
  });
  /*
    "Last applied", cleared on the first edit to a control the Style owns. A Style names a whole
    look; once one of its fields has moved, the strip claiming that Style is active would be a lie.
    Capture phase for the same reason main.js uses it -- a control that stops propagation would
    otherwise leave a stale name on screen.
  */
  document.querySelector('.app-shell')?.addEventListener('change', clearOnEdit, true);
  document.querySelector('.app-shell')?.addEventListener('input', clearOnEdit, true);

  function clearOnEdit(event) {
    if (applying || !activeStyleId) return;
    // `appliedStyleId` survives this on purpose: the composition has stopped matching the Style, but
    // the user still chose it, and the lead segment's `Previous style` is the way back.
    if (OWNED_CONTROL_IDS.has(event.target?.id)) setActive(undefined);
  }

  rebuildDynamicTiers();

  return {
    /*
      Reported here rather than at the call site: `foldray:style-apply` is a document event and its
      listener in main.js has no idea what this promise can refuse. The catch is inside the module
      that knows, and it resolves rather than rethrowing, so the caller's `void` is honest.
    */
    applyFromUi: (id) => applyFromUi(STYLE_CATALOG.find((style) => style.id === id))
      .catch(reportStyleFailure),
    activeStyleId: () => activeStyleId,
    /*
      The restore paths -- a loaded session, Restore my settings, an undo step, the sweep's baseline
      -- name the Style a composition was built with, but no snapshot carries the colour scheme it
      was applied in. So the memory is kept only while it is still about that Style and dropped
      otherwise: a restore that lands on the same Style keeps the frame (the sweep walk and an undo
      back onto the styled state are exactly that case), and one that lands anywhere else falls back
      to the authored swatch rather than framing a scheme the restored picture may not be in.
    */
    setActive: (id, options) => {
      if (appliedScheme && appliedScheme.styleId !== id) appliedScheme = undefined;
      setActive(id, options);
    },
    /*
      What the loaded structure turned out to be, and which Styles that argues for. Pushed in rather
      than pulled, because the facts come from main.js's structure walk -- a strip of pictures has no
      business reaching into Mol*.

      Setting it also re-seeds the sweep, which is the honest default: a prefix of a catalogue
      ordered by structure class is two rows and none of the rest.
    */
    setRecommendations: ({ ids = [], facts = [], resample } = {}) => {
      recommendation = { ids, facts, resample };
      rebuildDynamicTiers();
      if (ids.length > 0) sweep.setSelectedIds(ids);
    },
    setStructure: (key) => {
      setWhyOpen(false);
      closeOptionsPanel();
      /*
        The lead segment is about this structure's history, so it goes with the structure -- a
        `Previous style` tile pointing at settings for a protein that is no longer loaded would be
        offering to restore something that no longer exists. Cleared before `rebuildDynamicTiers()`,
        which repaints what is left.
      */
      appliedStyleId = undefined;
      // The remembered scheme described the previous structure's composition.
      appliedScheme = undefined;
      // Not a bare `activeStyleId = undefined`: the shelf tiles are never rebuilt, so only
      // setActive() takes the ring and aria-current off the old Style's tile.
      setActive(undefined);
      // The banked composition belonged to the previous structure; offering to restore it over a
      // new one would put back settings for a protein that is no longer loaded.
      mySettingsCheckpoint = undefined;
      restoreAction.hidden = true;
      hideRestoreHint();
      // A new structure banks a new composition, so the note is true again about something else.
      restoreHintSeen = false;
      // Cleared here rather than left standing: until the new structure has been walked, the old
      // recommendation is an answer about a protein that is no longer loaded.
      recommendation = { ids: [], facts: [], resample: undefined };
      rebuildDynamicTiers();
      // A fresh key per load: a file name does not identify a molecule (an assembly change reloads
      // the same file, and two predictions can share one name).
      sweep.useStructure(Symbol(key));
    },
    isSweeping: () => sweep.isBusy() || submitting,
    /*
      **And nothing that starts or watches a walk from outside.** There is deliberately no
      `recommendedIds`, `startSweep`, `sweepResult` or `onSweepChange` here: a walk is asked for on
      the gallery's own button, because a sweep is *user-initiated* and nothing else may reach past
      that.
    */
  };
}
