/*
  The shared visual picker.

  One popover serves every swatch grid -- protein, nucleic acid, ligand and ion
  representations, all five material fields, the four contextual type rows and
  the illumination sources. Each field keeps its original <select>, which stays
  the source of truth: a tile click writes select.value and dispatches a
  bubbling 'change', so main.js needs no rewiring and the select and the grid
  cannot disagree about what is picked.

  Two placement facts drive the layout, both load-bearing:

    * The popover is mounted inside #style-controls, because main.js disables a
      render's worth of controls by scoping querySelectorAll('button, input,
      select') to that element. A popover appended to <body> would stay live
      mid-render.
    * .rail carries `contain: paint`, which both clips the popover to the rail
      and makes #style-controls the containing block for it. So the popover is
      sized to the rail and flips above the trigger when there is no room below,
      rather than trying to escape.

  Neither the popover nor the trigger touches the stage, so the Mol* canvas
  cannot be displaced by opening one.

  The hover/focus enlargement is the one thing here that cannot live inside the
  popover: `contain: paint` would clip it to the rail. ./tile-magnifier.js
  mounts it on <body> instead and positions it against the tile's own rect. It is
  inert -- no controls, no pointer events -- so it stays outside both the bulk
  render lock and the outside-pointerdown handler at the bottom of this file.

  Being positioned against the *tile* is why `openPopover` reserves the whole
  popover rect. The enlargement's default is `tile.right + 10`, and every tile
  outside the last column has more of this same grid to its right: opening
  Representation put a 224px panel over four of its six tiles, and Material over
  four of twelve. Illumination escaped only because its default value happens to
  sit in the right-hand column. The tile is inside the rect it has to clear, so
  the anchor alone was never enough to reserve -- it is the grid the user came to
  read, not the one swatch they came in on.
*/
import { paintTileArt, resolveTiles } from './catalog/index.js';
import { hideTileMagnifier, keepTileMagnifierClearOf, magnifyTile } from './tile-magnifier.js';
import { announceOverlayOpen, coordinateOverlay } from './overlay-coordinator.js';

const pickers = [];
let popover;
let popoverTitle;
let popoverGroups;
let host;
let rail;
let openPicker;
let tiles = [];
const disabledObserver = typeof MutationObserver === 'function'
  ? new MutationObserver(() => scheduleSync())
  : undefined;


function optionsOf(select) {
  return [...select.options].map((option) => ({
    value: option.value,
    label: option.textContent.trim(),
    group: option.parentElement instanceof HTMLOptGroupElement
      ? option.parentElement.label
      : undefined,
    disabled: option.disabled,
  }));
}




function currentTile(picker) {
  const flat = resolveTiles(picker.kind, optionsOf(picker.select))
    .flatMap((group) => group.tiles);
  return flat.find((tile) => tile.value === picker.select.value);
}


function syncTrigger(picker) {
  const tile = currentTile(picker);
  const selected = picker.select.selectedOptions[0];
  picker.value.textContent = tile?.title ?? selected?.textContent.trim() ?? '—';
  picker.trigger.disabled = picker.select.disabled;
  paintTileArt(picker.art, tile);
}


/*
  Every re-sync goes through one microtask, because the callers arrive in bursts.

  A single trigger sync is cheap; the shape that is not is a *batch*. `applyStyleWrites()`
  dispatches forty-five `change` events in one synchronous loop and twenty-three of them land inside
  `#style-controls`, and a session restore calls `refreshSwatchPickers()` once per `setSelectValue()`
  -- so both paths ran `syncAll()` twenty-odd times, and each run rebuilds *every* picker's whole
  tile list through `resolveTiles()` to read one tile out of it. Thirteen pickers of ~11 options is
  ~140 tile objects and 13 Maps a run, so a Style apply was allocating some 3,300 of them to paint
  thirteen 26px trigger swatches once.

  A **microtask** rather than a frame, deliberately. It still collapses a synchronous burst into one
  run, and it lands before the current task yields -- so nothing can paint, lay out or observe a
  trigger in between, and `refreshSwatchPickers()` keeps meaning "this is true before anything
  happens next" rather than "this will be true next frame".
*/
let syncScheduled = false;

function scheduleSync() {
  // No microtask queue is not a case in a browser; it is the case in a bare unit-test global, where
  // running now is both correct and what a synchronous caller would have got before.
  if (typeof queueMicrotask !== 'function') {
    syncAll();
    return;
  }
  if (syncScheduled) return;
  syncScheduled = true;
  queueMicrotask(() => {
    syncScheduled = false;
    syncAll();
  });
}


export function refreshSwatchPickers() {
  scheduleSync();
}


function syncAll() {
  pickers.forEach(syncTrigger);
  if (openPicker) {
    if (openPicker.select.disabled) closePopover();
    else markChecked(openPicker.select.value);
  }
}


function markChecked(value) {
  tiles.forEach((tile) => {
    const checked = tile.dataset.value === value;
    tile.setAttribute('aria-checked', String(checked));
    /*
      Roving tabindex: only the checked tile is a tab stop, so the grid is one stop in the
      sequence and the arrow keys do the rest. A disabled tile is excluded even when it is the
      checked one -- a browser drops a disabled element from the tab order regardless of its
      tabIndex, and the fallback below is what keeps the grid reachable when the value the page
      loaded with is one `capabilities()` reports as `not_yet` or `missing`.
    */
    tile.tabIndex = (checked && !tile.disabled) ? 0 : -1;
  });
  if (!tiles.some((tile) => tile.tabIndex === 0)) {
    const fallback = tiles.find((tile) => !tile.disabled) ?? tiles[0];
    if (fallback) fallback.tabIndex = 0;
  }
}


function commit(picker, value) {
  if (picker.select.disabled) return;
  if (picker.select.value !== value) {
    picker.select.value = value;
    picker.select.dispatchEvent(new Event('change', { bubbles: true }));
  }
  closePopover(true);
}


function buildGrid(picker) {
  // The grid is rebuilt on every open, so anything following a tile from the last one is stale.
  hideTileMagnifier();
  popoverGroups.replaceChildren();
  tiles = [];
  resolveTiles(picker.kind, optionsOf(picker.select)).forEach((group) => {
    const section = document.createElement('div');
    section.className = 'picker-group';
    if (group.label) {
      const caption = document.createElement('span');
      caption.className = 'picker-group-label';
      caption.textContent = group.label;
      section.append(caption);
    }
    const grid = document.createElement('div');
    grid.className = 'picker-grid';
    group.tiles.forEach((tile) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'swatch';
      button.dataset.value = tile.value;
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', 'false');
      /*
        An option nothing can draw is greyed out, never merely rendered, and this is the one place
        a person actually picks a representation. `tile.disabled` is true exactly for an id
        `capabilities()` reports as `not_yet` or `missing`. Disabled rather than removed, so the
        option stays visible and named; a vanished tile reads as a bug, a greyed one reads as a
        promise.
      */
      button.disabled = Boolean(tile.disabled);
      // Says no and stops there: there is no capability report on the page to send anyone to, and
      // a tooltip pointing at a control that is not there is worse than one that simply says no.
      button.title = tile.disabled
        ? `${tile.title} — not available in this browser build yet.`
        : tile.title;

      const art = document.createElement('span');
      art.className = 'swatch-art';
      paintTileArt(art, tile);

      const label = document.createElement('span');
      label.className = 'swatch-label';
      label.textContent = tile.label;

      button.append(art, label);
      button.addEventListener('click', () => commit(picker, tile.value));
      // Follows focus as well as hover, which is what the arrow keys move. Browsing the grid still
      // commits nothing: the magnifier binds no keys.
      magnifyTile(button, { art, label: tile.title });
      grid.append(button);
      tiles.push(button);
    });
    section.append(grid);
    popoverGroups.append(section);
  });
}


function position(picker) {
  const hostRect = host.getBoundingClientRect();
  const railRect = rail.getBoundingClientRect();
  const triggerRect = picker.trigger.getBoundingClientRect();

  // Measure unconstrained first to learn the grid's natural height, then commit
  // to a side and re-measure, because flipping upward needs the *final* height.
  popover.style.maxHeight = `${Math.max(160, railRect.height - 24)}px`;
  const natural = popover.getBoundingClientRect().height;
  const below = railRect.bottom - triggerRect.bottom - 10;
  const above = triggerRect.top - railRect.top - 10;
  const placeBelow = natural <= below || below >= above;
  popover.style.maxHeight = `${Math.max(160, Math.floor(placeBelow ? below : above))}px`;

  const { height, width } = popover.getBoundingClientRect();
  const left = Math.min(
    Math.max(triggerRect.left - hostRect.left, 6),
    Math.max(hostRect.width - width - 6, 6),
  );
  popover.style.left = `${left}px`;
  popover.style.top = `${placeBelow
    ? triggerRect.bottom - hostRect.top + 6
    : triggerRect.top - hostRect.top - height - 6}px`;
}


function openPopover(picker) {
  if (picker.select.disabled) return;
  announceOverlayOpen('picker');
  openPicker = picker;
  popoverTitle.textContent = picker.caption;
  popover.hidden = false;
  buildGrid(picker);
  markChecked(picker.select.value);
  position(picker);
  // Measured after `position` has committed a side and a height, not predicted from it, and before
  // the focus below reveals the enlargement against it.
  keepTileMagnifierClearOf(popover.getBoundingClientRect());
  picker.trigger.setAttribute('aria-expanded', 'true');
  (tiles.find((tile) => tile.tabIndex === 0) ?? tiles[0])?.focus();
}


function closePopover(restoreFocus = false) {
  if (!openPicker) return;
  const previous = openPicker;
  openPicker = undefined;
  popover.hidden = true;
  hideTileMagnifier();
  // Released with the grid, or the Styles tiers would go on dodging a popover that is not there.
  keepTileMagnifierClearOf(undefined);
  popoverGroups.replaceChildren();
  tiles = [];
  previous.trigger.setAttribute('aria-expanded', 'false');
  if (restoreFocus && !previous.trigger.disabled) previous.trigger.focus();
}


/*
  Arrows move focus only; Enter, Space or a click commits. A radiogroup normally
  selects on arrow, but every commit here runs main.js's change handler -- and
  for the Cartoon type row that reloads the authored geometry values, discarding
  anything typed under Advanced settings. Browsing the grid must not do that.
*/
function onPopoverKeydown(event) {
  if (!openPicker) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closePopover(true);
    return;
  }
  const index = tiles.indexOf(document.activeElement);
  if (index < 0) return;
  if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
    event.preventDefault();
    commit(openPicker, tiles[index].dataset.value);
    return;
  }
  const columns = Number.parseInt(
    getComputedStyle(popover).getPropertyValue('--picker-columns'),
    10,
  ) || 3;
  const steps = {
    ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns,
  };
  let next;
  let direction = 1;
  if (event.key in steps) {
    next = index + steps[event.key];
    direction = steps[event.key] < 0 ? -1 : 1;
  } else if (event.key === 'Home') {
    next = 0;
  } else if (event.key === 'End') {
    next = tiles.length - 1;
    direction = -1;
  } else return;

  event.preventDefault();
  // An ungated id reaches this grid as a `disabled` tile (`not_yet`/`missing`), and a
  // disabled button neither receives focus nor fires click -- so a bare index walk can land
  // squarely on one and leave focus stuck where it was. Step past it in the same direction rather
  // than clamping onto it; a picker with nothing enabled at all (every tile in this kind) walks
  // clean off the array and does nothing, same as an empty grid always did.
  next = nextFocusableIndex(next, direction);
  if (next < 0 || next >= tiles.length) return;
  tiles[next]?.focus();
}


function nextFocusableIndex(start, direction) {
  let index = start;
  while (index >= 0 && index < tiles.length && tiles[index]?.disabled) index += direction;
  return index;
}


function buildPopover() {
  popover = document.createElement('div');
  popover.className = 'picker-popover';
  popover.id = 'picker-popover';
  popover.hidden = true;

  const head = document.createElement('div');
  head.className = 'picker-popover-head';
  popoverTitle = document.createElement('span');
  popoverTitle.className = 'picker-popover-title';
  popoverTitle.id = 'picker-popover-title';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'picker-popover-close';
  close.setAttribute('aria-label', 'Close picker');
  close.textContent = '×';
  close.addEventListener('click', () => closePopover(true));
  head.append(popoverTitle, close);

  popoverGroups = document.createElement('div');
  popoverGroups.className = 'picker-groups';
  popoverGroups.setAttribute('role', 'radiogroup');
  popoverGroups.setAttribute('aria-labelledby', popoverTitle.id);

  popover.append(head, popoverGroups);
  popover.addEventListener('keydown', onPopoverKeydown);
  host.append(popover);
}


function mount(field) {
  const kind = field.dataset.picker;
  const select = field.querySelector('select');
  const caption = field.querySelector('.picker-caption');
  if (!kind || !select || !caption) return;

  caption.id = caption.id || `${select.id}-caption`;

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'picker-trigger';
  trigger.id = `${select.id}-picker`;
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', popover.id);

  const art = document.createElement('span');
  art.className = 'picker-trigger-art';
  const value = document.createElement('span');
  value.className = 'picker-trigger-value';
  value.id = `${select.id}-picker-value`;
  trigger.setAttribute('aria-labelledby', `${caption.id} ${value.id}`);
  trigger.append(art, value);

  const picker = {
    kind, select, trigger, art, value, caption: caption.textContent.trim(),
  };
  trigger.addEventListener('click', () => {
    if (openPicker === picker) closePopover(true);
    else openPopover(picker);
  });

  field.append(trigger);
  pickers.push(picker);
  // main.js flips these selects between enabled and disabled from two places --
  // the bulk render lock and updateStyleControls() -- so the trigger follows the
  // select's own state rather than trying to model either of them.
  disabledObserver?.observe(select, { attributes: true, attributeFilter: ['disabled'] });
  syncTrigger(picker);
}


export function initSwatchPickers() {
  host = document.getElementById('style-controls');
  rail = host?.closest('.rail');
  if (!host || !rail) return;

  buildPopover();
  host.querySelectorAll('[data-picker]').forEach(mount);

  // Delegated, so a change dispatched by a tile, by the user on a still-reachable
  // control, or by any other main.js path keeps every trigger truthful.
  host.addEventListener('change', () => scheduleSync());
  coordinateOverlay({
    owner: 'picker',
    contains: (target) => popover.contains(target) || Boolean(openPicker?.trigger.contains(target)),
    isOpen: () => Boolean(openPicker),
    close: () => closePopover(),
  });
  window.addEventListener('resize', () => closePopover());
  syncAll();
}
