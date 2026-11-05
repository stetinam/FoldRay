/*
  The shared hover-and-focus enlargement for catalogue artwork.

  A tile's art is 22-104px on screen, which is not enough to judge a material or a lighting source
  by. One magnifier element is reused by every swatch picker grid and shows the tile under the
  pointer, or under the keyboard focus.

  Three facts here are load-bearing:

    * It is mounted on <body> and positioned `fixed` against the tile's viewport rect. `.rail`
      carries `contain: paint` on purpose (see the header of swatch-picker.js), so an enlargement
      rendered inside the picker popover would be clipped at the rail's edge -- which is most of it.
    * It is `pointer-events: none` and holds no controls. That keeps it invisible to the popover's
      outside-pointerdown close handler, and outside main.js's bulk render lock, which disables
      every button, input and select inside #style-controls.
    * It never paints artwork itself. `paintTileArt` has already decided the fallback chain --
      rendered thumbnail, else catalogue swatch, else hatched placeholder -- so this copies that
      node's painted output. A tile with no PNG therefore magnifies its swatch or its hatch instead
      of popping an empty frame, and a tile repainted under the enlargement is copied again.

  Focus parity matters as much as hover: a hover-only affordance is unreachable from the keyboard
  and from touch, and the picker's arrow keys move focus without committing, so following focus is
  what makes the grid browsable at a size worth browsing.

  A surface that answers the same hover reserves its rect through `keepTileMagnifierClearOf` and
  this steps aside. That direction is deliberate: this element holds no controls, so it is the
  cheap thing to move, while a menu has to be in the same place every time to be worth aiming at.
  Today the picker popover is the only reserver.

  A reserved rect can stand in either relation to the tile, so the escape cannot assume one axis.
  A rect that hangs *under* its tile is stepped over vertically: ~40px, and the enlargement stays
  in the tile's own column. The picker popover instead *contains* its tile -- the anchor is one
  swatch in the grid being reserved -- and is up to 488px tall, so stepping over that lands on the
  top bar or leaves the rail behind. `place` chooses by that relation, not by habit, and falls back
  to the other axis when the chosen one has no room. See `sidestep`.
*/

// Long enough that dragging the pointer across a grid does not strobe, short enough to feel like a
// response. The leave delay lets a move between two adjacent tiles swap the art instead of blinking.
const ENTER_MS = 140;
const LEAVE_MS = 90;
const GAP = 10;
const EDGE = 8;

let root;
let rootArt;
let rootLabel;
let rootNote;
let enterTimer;
let leaveTimer;
let pending;
let shown;
// The { art, label, note } the visible enlargement was built from, kept so `artWatcher` can copy
// the tile's art again if paintTileArt repaints it while the enlargement is still on screen.
let shownSource;
let artWatcher;
/*
  A viewport rect the enlargement must not cover, set by whoever owns the surface -- today the
  picker popover, whose grid the enlargement is summoned from. The enlargement is the thing that
  moves, because it is the thing with nothing to click: a menu that relocates depending on which
  tile you are pointing at is a menu you have to find again every time, and the popover is the grid
  being read.
*/
let avoid;


function build() {
  if (root || typeof document === 'undefined') return;
  root = document.createElement('div');
  root.id = 'tile-magnifier';
  root.className = 'tile-magnifier';
  // Presentational only: the tile it follows already carries the accessible name and state.
  root.setAttribute('aria-hidden', 'true');
  root.hidden = true;

  rootArt = document.createElement('span');
  rootArt.className = 'tile-magnifier-art';
  const caption = document.createElement('span');
  caption.className = 'tile-magnifier-caption';
  rootLabel = document.createElement('span');
  rootLabel.className = 'tile-magnifier-label';
  rootNote = document.createElement('span');
  rootNote.className = 'tile-magnifier-note';
  caption.append(rootLabel, rootNote);
  root.append(rootArt, caption);
  document.body.append(root);

  /*
    A repaint while the enlargement is open: a tile's art can be swapped under it after `present`
    has copied it once, and without this the enlargement goes on showing the artwork the tile had
    when the pointer arrived. Copying again -- rather than resolving anything -- keeps this
    single-sourced through paintTileArt.
  */
  if (typeof MutationObserver === 'function') {
    artWatcher = new MutationObserver(() => {
      if (shownSource) copyArt(shownSource);
    });
  }

  /*
    Scroll follows rather than dismisses, and captured because it is the rail and the popover's own
    grid that scroll, not the page. Dismissing here is not equivalent: moving focus with the arrow
    keys scrolls the grid to reveal the next tile, so the enlargement the keyboard user just asked
    for would be cancelled by their own keypress.

    `scrolledOutOfView` is the one exception, and it is strictly narrower than "the anchor moved":
    the anchor has to be *entirely* outside the box of the element that scrolled. Arrow-key
    browsing scrolls exactly enough to bring the next tile into view, so it never trips this;
    dragging the rail past the open popover does, which would otherwise leave the enlargement
    clamped at the top of the viewport, 67px over the top bar, covering the app title and the File
    menu with a picture of a tile that is no longer on screen.
  */
  window.addEventListener('resize', hideTileMagnifier);
  document.addEventListener('scroll', (event) => {
    if (!root || root.hidden) return;
    if (!shown?.isConnected || scrolledOutOfView(shown, event.target)) {
      hideTileMagnifier();
      return;
    }
    place(shown);
  }, true);
  document.addEventListener('keydown', (event) => {
    // No preventDefault: Escape still reaches the picker popover's own handler, and Enter/Space
    // still commit the focused tile.
    if (event.key === 'Escape') hideTileMagnifier();
  });
}


/*
  Has the anchor left the visible box of the thing that just scrolled? Only that -- not "is the
  anchor still where it was", which is every scroll, and not "is it in the viewport", which a
  `contain: paint` ancestor can already have clipped it out of. `container` is the scroll event's
  own target, so an unrelated scroll elsewhere in the page cannot dismiss anything, and a partially
  visible tile keeps its enlargement.
*/
function scrolledOutOfView(anchor, container) {
  if (!(container instanceof Element) || !container.contains(anchor)) return false;
  const box = anchor.getBoundingClientRect();
  const clip = container.getBoundingClientRect();
  return box.bottom <= clip.top || box.top >= clip.bottom
    || box.right <= clip.left || box.left >= clip.right;
}


/*
  The sideways escape from a reserved rect, and the left edge it lands on, or `undefined` when
  neither side has room for the whole element.

  It exists for the picker popover: ~268px wide and as much as 488px tall, with the anchor tile
  inside it, so the rect to clear is a column and the way past a column is around it. It is not
  what a short wide rect hanging under its tile wants -- one ~371px wide and 30px tall leaves no
  horizontal position both clear of it and still beside the tile it belongs to, which is why the
  vertical branch in `place` exists. Which of the two runs is decided in `place`, by whether the
  reserved rect contains the anchor, never by who reserved it.
*/
function sidestep(reserved, width, viewportWidth) {
  const roomLeft = reserved.left - GAP - EDGE;
  const roomRight = viewportWidth - EDGE - (reserved.right + GAP);
  if (roomRight >= roomLeft && roomRight >= width) return reserved.right + GAP;
  if (roomLeft >= width) return reserved.left - GAP - width;
  if (roomRight >= width) return reserved.right + GAP;
  return undefined;
}


function place(button) {
  const tile = button.getBoundingClientRect();
  const { width, height } = root.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // Beside the tile, flipped to whichever side has room, then clamped into the viewport so the
  // enlargement can never add scrollable overflow of its own.
  let left = tile.right + GAP;
  if (left + width > viewportWidth - EDGE) left = tile.left - GAP - width;
  if (left < EDGE) left = Math.max(EDGE, Math.min(tile.left, viewportWidth - width - EDGE));
  let top = Math.max(
    EDGE,
    Math.min(tile.top + (tile.height - height) / 2, viewportHeight - height - EDGE),
  );

  /*
    Step off the reserved rect. Which way is decided by where the anchor sits in it, because the
    whole point of the placement above is that the enlargement stays level with its own tile.

    A rect that hangs *under* its tile is cleared vertically: stepping over it is ~40px and leaves
    the enlargement in the tile's own column. Sideways would be wrong twice over for such a rect --
    ~371px wide against this element's 224, so no horizontal position is both clear of it and still
    beside the tile, and the sideways attempt ends up dropping the reserved surface below the whole
    enlargement instead. Above first, because the rect hangs below, so above is the side that keeps
    the enlargement level with the row it came from.

    The picker popover *contains* its tile -- the anchor is one swatch in the grid being reserved,
    which is why reserving the anchor alone is not enough. There is then no vertical position
    that clears the popover and is still level with the tile: over a popover low in the rail means
    landing on the top bar, and under a popover high in it means leaving the rail behind. So it
    goes round instead, and stays level.

    Either way falls back to the other axis when its own has no room, and neither gives up: this is
    z-index 55 and the surfaces that reserve sit below it, so an unresolved overlap would bury a
    menu under a picture.
  */
  if (avoid && left < avoid.right && left + width > avoid.left
    && top < avoid.bottom && top + height > avoid.top) {
    const roomAbove = avoid.top - GAP - EDGE;
    const roomBelow = viewportHeight - EDGE - (avoid.bottom + GAP);
    const anchorInside = tile.left >= avoid.left && tile.right <= avoid.right
      && tile.top >= avoid.top && tile.bottom <= avoid.bottom;
    const aside = anchorInside || (roomAbove < height && roomBelow < height)
      ? sidestep(avoid, width, viewportWidth)
      : undefined;
    if (aside !== undefined) left = aside;
    else if (roomAbove >= height) top = avoid.top - GAP - height;
    else if (roomBelow >= height) top = avoid.bottom + GAP;
    else if (roomAbove > roomBelow) top = EDGE;
    else top = Math.max(EDGE, viewportHeight - height - EDGE);
  }

  root.style.left = `${Math.round(left)}px`;
  root.style.top = `${Math.round(top)}px`;
}


// Copying the painted node is what keeps this single-sourced through paintTileArt.
function copyArt(source) {
  rootArt.style.background = source.art.style.background;
  rootArt.classList.toggle('is-placeholder', source.art.classList.contains('is-placeholder'));
}


function present(button, source) {
  if (!button.isConnected || button.disabled) return;
  shown = button;
  shownSource = source;
  copyArt(source);
  // Re-copied, not re-resolved, if the tile is repainted under it. `label` and `note` are
  // catalogue strings fixed for the life of the tile, so only the art can go stale.
  artWatcher?.disconnect();
  artWatcher?.observe(source.art, { attributes: true, attributeFilter: ['style', 'class'] });
  rootLabel.textContent = source.label ?? '';
  rootNote.textContent = source.note ?? '';
  rootNote.hidden = !source.note;
  root.hidden = false;
  place(button);
}


function reveal(button, source) {
  build();
  if (!root) return;
  window.clearTimeout(enterTimer);
  window.clearTimeout(leaveTimer);
  pending = undefined;
  // Already open: swap the art rather than blinking through hidden, which is what makes dragging
  // the pointer along a row read as one enlargement following it.
  if (!root.hidden) {
    present(button, source);
    return;
  }
  pending = button;
  enterTimer = window.setTimeout(() => {
    pending = undefined;
    present(button, source);
  }, ENTER_MS);
}


/*
  Both timers are keyed to the tile that armed them. Cancelling unconditionally is not equivalent: a
  tile losing focus would cancel a reveal another tile's hover had just armed.
*/
function dismiss(button) {
  if (button && pending === button) {
    window.clearTimeout(enterTimer);
    pending = undefined;
  }
  if (!root || root.hidden) return;
  if (button && shown !== button) return;
  window.clearTimeout(leaveTimer);
  leaveTimer = window.setTimeout(hideTileMagnifier, LEAVE_MS);
}


/*
  Reserve a viewport rect: the enlargement keeps clear of it from now until it is cleared with
  `undefined`. The direction is the point. A surface answering the same hover on the same tile and
  this element cannot both stay put, and it has to be this one that moves: a menu that lands under
  the tile for one column and 90px lower for another, or that squeezes itself to fit beside the
  enlargement, is a menu the user has to re-find on every tile. This has no controls, so moving it
  costs nothing but the motion.

  There is deliberately one slot and no owner key: the escape is chosen from the rect's shape in
  `place`, so a reserver says what it occupies and nothing about how to get round it. Reservers
  never overlap in time, because overlay-coordinator.js keeps the popovers mutually exclusive.

  Safe to call whether or not anything is shown; it re-places what is on screen and is remembered
  for whatever is revealed next.
*/
export function keepTileMagnifierClearOf(rect) {
  avoid = rect;
  if (root && !root.hidden && shown?.isConnected) place(shown);
}


export function hideTileMagnifier() {
  window.clearTimeout(enterTimer);
  window.clearTimeout(leaveTimer);
  pending = undefined;
  if (!root) return;
  root.hidden = true;
  shown = undefined;
  shownSource = undefined;
  artWatcher?.disconnect();
}


/*
  button: the tile. source: { art, label, note } -- `art` is the element paintTileArt painted, read
  at reveal time so a repaint is picked up without re-registering anything.
*/
export function magnifyTile(button, source) {
  if (!button || !source?.art) return;
  button.addEventListener('pointerenter', (event) => {
    // Touch is excluded deliberately: a touch that enters never leaves, so it would pin the
    // enlargement over the grid. Touch reaches the same art through the focus path below.
    if (event.pointerType === 'touch') return;
    reveal(button, source);
  });
  button.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'touch') return;
    dismiss(button);
  });
  button.addEventListener('focus', () => reveal(button, source));
  button.addEventListener('blur', () => dismiss(button));
  // Committing a tile can remove it from the DOM, and a removed tile never fires pointerleave.
  button.addEventListener('click', hideTileMagnifier);
}
