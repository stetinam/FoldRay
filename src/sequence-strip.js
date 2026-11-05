/*
  The sequence strip: one chip per residue, in the drawer the toggle opens.

  **This is not Mol*'s `SequenceView`, and could not be.** That one is `mol-plugin-ui` and
  therefore React, which the whole preview is arranged against for a reason that has nothing to do
  with the sequence -- a Viewer app parses its own second `Structure`. Losing the panel is a
  consequence, and the consequence has to be answered rather than glossed: `#sequence-drawer-toggle`
  is a real control, `--sequence-drawer-height` is authored in `styles.css`, and a drawer that opens
  on nothing is a button that does nothing.

  So it is drawn from **our** residue list, which is a projection of the one `Structure` the tracer
  reads. That is the same argument `collectStructureResidues()` makes one card over: a second walk
  of Mol*'s hierarchy would be a second answer to "which residues are there", and there is nothing
  here that the list we already have cannot say.

  The one-letter codes are Mol*'s own tables (`mol-model/sequence/constants.js`, MIT, already in the
  bundle) rather than a table of ours: when Mol* already has it, that is the answer, and this is
  squarely one of those cases.

  **What it is not.** It is not a picking surface of its own: every gesture here ends as a call back
  into `main.js`, which turns a residue list into a `StructureElement.Loci` and hands it to Mol*'s
  selection manager. There is one selection in this app and it lives in the plugin; this strip
  mirrors it and writes to it, and never keeps a second copy. `setSelected()` is that mirror, and it
  is driven by the plugin's own `selection.events.changed`, so a click in the 3D view repaints the
  strip with nothing here subscribing to anything.
*/

import {
  getProteinOneLetterCode, getRnaOneLetterCode, getDnaOneLetterCode,
} from 'molstar/lib/mol-model/sequence/constants.js';
// Mol*'s own enum, never a copy of its numbers. A wrong constant here is silent: the residue takes
// the wrong code table, `DC`/`DG`/`DT` come back `X`, and the duplex draws a row of `·` where its
// bases belong.
import { MoleculeType } from 'molstar/lib/mol-model/structure/model/types.js';

/*
  The one number in this file, and it is a refusal rather than a truncation.

  A chip is a DOM element in a grid that wraps, and a ribosome is tens of thousands of residues.
  Drawing half a structure would be a strip that lies about what is in the file; saying so and
  drawing none is the honest answer, and the 3D view still selects everything the strip would have.

  **The cap is a ceiling on the repaint loops, not on the node count, and it is unmeasured.** A
  chip is one `<button>` -- the gestures are delegated to the host -- so the node count is not what
  binds. What is per chip is per *event*: `setSelected()`, `setHovered()` and `setFocused()` each
  walk the whole map, and the hover one runs on every crossing from one chip to the next,
  round-tripping through Mol*'s `lociHighlights`. The number this ought to be is whatever keeps a
  hover smooth at the cap on a real large structure; nobody has measured it. If it is too high, key
  the three loops to the chips whose state changed rather than lowering it.
*/
const MAX_CHIPS = 20000;

/*
  Mol*'s tables, chosen by what our own classifier already decided the residue is.

  **`X` is drawn as `·`, and that is a decision rather than a fallback.** Mol* has a one-letter code
  for the standard residues and for `SEC`/`PYL` (`U` and `O`, which are IUPAC's) and returns `X` for
  every modified one -- `KCX`, `MSE`, `SEP`, `TPO`, `PTR`, `PCA` and the rest. 1FWJ's three `KCX`
  217 sit in chain C's polymer row, with a `·` between `L` 216 and `I` 218. Three answers were on
  the table:

  - **the parent residue's letter** (`K` for `KCX`) is not available and would not be true. Mol*
    does not read `_chem_comp.mon_nstd_parent_comp_id` into the model at all, no file in the corpus
    carries the column -- 1FWJ's own `chem_comp` block has seven columns and that is not one of
    them -- so it would mean shipping or fetching the CCD, which is the name table this whole
    change deletes. It is also a list (`ASX` -> `ASP,ASN`, a crosslink -> two parents), so there is
    often no single letter to write. And `KCX` is not lysine: in 1FWJ the carboxylation is the
    catalytic feature, so `K` would say the chain is unmodified.
  - **the three-letter name** is Mol*'s own answer in its sequence view
    (`mol-model/sequence/sequence.js`: `labels[i] = codes[i] === 'X' ? compIds[i] : codes[i]`), and
    it cannot be this strip's. Mol*'s is a flowing text run; **every polymer chip here is 15px**, so
    the track is a fixed-pitch grid and vertical position is position along the chain. A three-wide
    cell trades that away.
  - **`·`**, which keeps the pitch and is what the nucleic half draws -- 1EHZ renders exactly 14 of
    them, one per modified base. A strip that dotted its bases and spelled its amino acids would be
    two answers on adjacent rows.

  Nothing is lost by it: `title` and `aria-label` carry `KCX C217` either way, which is where the
  chip's identity has always lived. What `·` costs is that it does not *say* "modified" -- it reads
  the same as any residue Mol* has no letter for. Distinguishing the two is a class on the chip and
  a rule in `styles.css`, and is deliberately not done here rather than added as an attribute no
  stylesheet reads.
*/
function oneLetterCode(residue) {
  if (residue.component === 'protein') {
    const code = getProteinOneLetterCode(residue.name);
    return code === 'X' ? '·' : code;
  }
  if (residue.component === 'nucleic') {
    // The DNA table is what knows that DT is T rather than an unknown.
    const code = residue.moleculeType === MoleculeType.DNA
      ? getDnaOneLetterCode(residue.name)
      : getRnaOneLetterCode(residue.name);
    return code === 'X' ? '·' : code;
  }
  return undefined;
}

/*
  How often a residue number is written over the track, and it is a **sequence id** rather than a
  position in the strip.

  Ten is Mol*'s own period for a sequence longer than ten (`mol-plugin-ui/sequence/sequence.js`'s
  `sequenceNumberPeriod`), and numbering by id rather than by index is what makes the marks worth
  reading: somebody looking for residue 145 finds 140 and counts five. Numbering every tenth *chip*
  would write 3, 13, 23 for a chain that starts at 3, which is a ruler measured in the wrong unit.

  A chain whose ids skip past a multiple of ten simply gets no mark there. That is the honest
  answer -- the mark says "this residue is 140", and inventing one for a residue that is not in the
  file would be a ruler that lies.
*/
const SEQUENCE_NUMBER_PERIOD = 10;

/*
  How close the chain's own first number may come to the next one, **in chips rather than in ids**,
  because chips are what decide whether two numbers overlap.

  A polymer chip is 15px on a 1px gap, so marks `n` chips apart are 16n apart; a four-digit number
  at this size is about 19px wide and centred. Two chips clear it, one does not -- and a chain that
  skips ids has fewer chips between two ids than the difference suggests, which is exactly the case
  measuring in ids would get wrong.
*/
const MIN_NUMBER_GAP = 2;

// `main.js`'s own `residueKey()` shape, byte for byte: the strip mirrors the plugin's selection
// through it, so a second key format here would be a mirror that never lit.
const chipKey = (residue) => `${residue.chainId}\u0000${residue.residueId}\u0000${residue.insertionCode}`;

/**
 * Build the strip inside `host`.
 *
 * `onSelect(residues, { mode })`, `onFocus(residues)` and `onHover(residues | undefined)` are the
 * only ways anything leaves here. `mode` is Mol*'s own vocabulary -- `set`, `add`, `remove` --
 * because the caller hands it straight to `selection.fromLoci()`, and inventing a third word for
 * the same three things is how two tables start disagreeing. The gesture words are the app's own
 * two, for the same reason.
 */
export function createSequenceStrip({
  host, onSelect = () => {}, onFocus = () => {}, onHover = () => {},
} = {}) {
  if (!host) return undefined;

  // Every chip currently drawn, keyed the way `main.js` keys a residue, so `setSelected()` is a
  // lookup rather than a scan.
  let chips = new Map();
  // The strip's own flat order, which is what a shift-click range is measured in.
  let order = [];
  /*
    Where each key sits in `order`, so a range is a lookup rather than a scan.

    `residuesBetween()` ran two `findIndex` over `order` and it is called once per chip crossed
    during a drag, so at the cap a slow drag down a chain was two key comparisons a chip per
    pointer event on top of the repaint below. The map is built in the same pass that builds the
    chips, so it costs nothing to keep and cannot drift: both are cleared and refilled together.
  */
  let positions = new Map();
  let anchorKey;
  let enabled = false;
  /*
    **What a chip press means, and it is the interaction mode's word rather than a third one.**
    In `select` a press picks residues, which is everything below; in `inspect` a press zooms the
    camera onto the one residue it landed on and changes no selection at all -- which is exactly
    what a press on that residue in the 3D view does, because Mol*'s `FocusLoci` reads
    `plugin.selectionMode` off the same mode. Two surfaces, one answer. Disabling the strip outside
    Select would leave a residue reachable only by finding it in the 3D view, which is the thing a
    sequence is for.
  */
  let gesture = 'select';
  let drag;

  /*
    **Nothing is written where nothing changed.** `extendDrag()` and `setSelected()` both repaint
    *every* chip, because either can move any of them and neither knows which -- and a repaint that
    always writes is two DOM binding crossings a chip, so a drag on a large structure wrote two a
    chip per pointer event to move one or two. Reading the class first is the same
    question the write answers, asked once, on the node itself rather than against a remembered
    set -- so an external repaint (the plugin's own selection changing mid-gesture) cannot make this
    stale the way a diff against a cached set could.
  */
  function paintChip(key, selected) {
    const chip = chips.get(key);
    if (!chip) return;
    if (chip.classList.contains('is-selected') === selected) return;
    chip.classList.toggle('is-selected', selected);
    chip.setAttribute('aria-pressed', String(selected));
  }

  /*
    The two marks that are not the selection, painted the same read-before-write way and for the
    same reason -- either can move any chip, so both walk all of them.

    **They are deliberately classes rather than `aria-pressed` states.** `aria-pressed` is what this
    chip's *press* did and there is one of those; hovered and focused are what the pointer and the
    camera are doing to the residue, which a screen reader gets from the 3D view's own labels. A
    second ARIA state on one button would claim the press had three outcomes.
  */
  function paintMark(key, mark, on) {
    const chip = chips.get(key);
    if (!chip || chip.classList.contains(mark) === on) return;
    chip.classList.toggle(mark, on);
  }

  function residuesBetween(fromKey, toKey) {
    const from = positions.get(fromKey);
    const to = positions.get(toKey);
    if (from === undefined || to === undefined) return [];
    const [low, high] = from <= to ? [from, to] : [to, from];
    return order.slice(low, high + 1);
  }

  const payload = (entries) => entries.map((entry) => ({
    chain_id: entry.chain_id,
    sequence_id: entry.sequence_id,
    insertion_code: entry.insertion_code,
  }));

  /*
    **A click adds, and clicking a selected residue takes it back.**

    Never `set`: replacing the whole selection with one residue puts a modifier between the user and
    the ordinary case -- selecting a few residues is what this strip is *for* -- and makes the strip
    disagree with the 3D view beside it, where Mol*'s own select mode accumulates. `remove` on an
    already-selected chip is what replaces the modifier: the gesture that adds is the gesture that
    takes away, and Clear in the selection panel is what empties it.

    Ctrl/Cmd is kept and now does exactly what a plain click does. It is redundant rather than
    wrong, and a user who learned it should not find it broken.
  */
  function pick(entry, event) {
    if (!enabled) return;
    // Before the shift branch: Inspect has no range gesture, so a modifier is still one residue.
    // `anchorKey` is left alone, or a trip through Inspect would move Select's range anchor.
    if (gesture === 'inspect') {
      onFocus(payload([entry]));
      return;
    }
    if (event.shiftKey && anchorKey) {
      onSelect(payload(residuesBetween(anchorKey, entry.key)), { mode: 'add' });
      return;
    }
    anchorKey = entry.key;
    const selected = chips.get(entry.key)?.classList.contains('is-selected');
    onSelect(payload([entry]), { mode: selected ? 'remove' : 'add' });
  }

  /*
    A drag paints a range as it goes, and it commits once on release.

    Committing per chip would be one `fromLoci()` per residue crossed, which re-derives the
    selection and repaints the 3D view on every pointer move; the strip's own `is-selected` class
    is what gives the gesture its feedback in the meantime, and the plugin's `changed` event
    overwrites it with the truth the moment the commit lands.

    **The direction is the chip the press lands on**, which is exactly what `pick()` decides for
    one chip: starting on a selected residue `remove`s the range, starting on an unselected one
    `add`s it. Neither is `set` -- a drag that always added would make unpicking twenty residues
    twenty clicks, and the answer to that is the gesture the strip already has, not a mode.
  */
  function beginDrag(entry, event) {
    if (!enabled || gesture !== 'select' || (event.button ?? 0) !== 0 || event.shiftKey) return;
    /*
      **What was already selected, kept.** The commit is `add` or `remove` rather than `set`, so the
      preview it paints has to keep everything outside the range too -- painting the range alone
      would blank every chip outside it for the length of the gesture and then bring them all back
      on release, which reads as the drag having destroyed the selection.
    */
    const held = new Set();
    chips.forEach((chip, key) => { if (chip.classList.contains('is-selected')) held.add(key); });
    drag = {
      fromKey: entry.key, toKey: entry.key, moved: false, held, removing: held.has(entry.key),
    };
  }

  // The paint is what the commit will do, not what it would have done if it added: a removing drag
  // shows its range going away.
  function extendDrag(entry) {
    if (!drag || drag.toKey === entry.key) return;
    drag.toKey = entry.key;
    drag.moved = true;
    const inRange = new Set(residuesBetween(drag.fromKey, drag.toKey).map((one) => one.key));
    chips.forEach((_, key) => paintChip(key, drag.removing
      ? drag.held.has(key) && !inRange.has(key)
      : inRange.has(key) || drag.held.has(key)));
  }

  /*
    **A committed drag, waiting for the `click` that follows it.** Cleared by the next `pointerdown`.

    `endDrag()`'s own return value cannot serve this. The gesture ends on `pointerup`, which
    *bubbles to the host* -- where `endDrag()` already runs -- and only then does the browser
    dispatch `click`, by which time `drag` is `undefined` and `endDrag()` returns false. `pick()`
    would then run on the last chip crossed, find it selected (the commit had just painted it) and
    send `remove`: **a drag that selects its range and immediately deselects the chip it ends
    on.**

    A flag rather than keeping `drag` alive past the commit, because the two questions are
    different: `drag` is "a gesture is in progress", this is "the gesture that just finished was a
    range, so the click it ends with has already been answered". Clearing it on `pointerdown` is
    what stops it leaking into a later click -- a drag released off the strip ends in
    `pointerleave` with no click behind it, and without the reset the *next* plain click on a chip
    would be swallowed instead.
  */
  let committedDrag = false;

  function endDrag() {
    if (!drag) return false;
    const finished = drag;
    drag = undefined;
    if (!finished.moved) return false;
    anchorKey = finished.fromKey;
    // A range is a bigger version of the click, so it answers the same way the click does. Never
    // `set`: that would make dragging the one destructive action in the strip.
    onSelect(
      payload(residuesBetween(finished.fromKey, finished.toKey)),
      { mode: finished.removing ? 'remove' : 'add' },
    );
    committedDrag = true;
    return true;
  }

  host.addEventListener('pointerup', () => endDrag());
  host.addEventListener('pointerleave', () => {
    endDrag();
    onHover(undefined);
  });

  /*
    The three chip gestures, delegated.

    They were three listeners *per chip*, which at the cap is three registrations and three closures
    a residue, each holding its own `entry` -- built one at a time inside the loop that also
    creates the buttons, and thrown away wholesale on the next structure. Delegation makes it three
    for the whole strip and takes about a third off the per-chip build, which is the one moment this
    module blocks the main thread.

    `pointerover` is the delegable form of `pointerenter`: `pointerenter` does not bubble, and a
    chip has no element children, so the two fire on exactly the same crossings. Order is unchanged
    -- these are on the same node as the `pointerup` above, and a pointer event's sequence, not the
    registration order, is what decides which runs first.
  */
  function chipEntry(target) {
    const chip = target instanceof Element ? target.closest('.sequence-chip') : undefined;
    if (!chip || !host.contains(chip)) return undefined;
    const index = positions.get(chip.dataset.residueKey);
    return index === undefined ? undefined : order[index];
  }

  host.addEventListener('pointerdown', (event) => {
    // Unconditionally, and before anything else: a press is a new gesture, so whatever the previous
    // one committed is spent whether this one lands on a chip or not.
    committedDrag = false;
    const entry = chipEntry(event.target);
    if (entry) beginDrag(entry, event);
  });
  /*
    **A hover leaves here as a residue and comes back as a mark**, rather than painting itself.

    `main.js` turns it into a Mol* highlight, Mol* tells everything that is highlighted, and
    `setHovered()` is what paints this chip -- so the chip under the pointer and the residue lit in
    the 3D view are the *same* answer arriving by the same road, and a chip could never light for a
    residue the picture did not. Painting the class here and pushing the loci separately would be
    two answers to one question.

    **Nothing is offered mid-drag.** A drag already paints its range in the strip, and a highlight
    per chip crossed would repaint the 3D view on every pointer move for a preview the range is
    already giving.
  */
  host.addEventListener('pointerover', (event) => {
    const entry = chipEntry(event.target);
    if (!entry) return;
    extendDrag(entry);
    if (!drag && enabled) onHover(payload([entry]));
  });
  /*
    Leaving a chip without entering another one -- the gaps between chips, the row labels, the space
    past the end of a row. `pointerout` rather than the host's own `pointerleave`, which only fires
    at the edge of the whole strip: crossing from a chip into the 1px gap beside it is a leave the
    strip never sees, so the mark would stand until the pointer happened to find another chip.
  */
  host.addEventListener('pointerout', (event) => {
    if (!chipEntry(event.target) || chipEntry(event.relatedTarget)) return;
    onHover(undefined);
  });
  /*
    A drag ends in `pointerup`, and the `click` that follows it must not also fire a pick -- that
    would take the range's last chip straight back out of the selection it had just been put in.

    Both halves are load-bearing and they answer different arrivals. `endDrag()` is for a `click`
    that reaches here with a drag still open, which is what a driver dispatching a bare `click` with
    no pointer sequence behind it produces; `committedDrag` is for the real browser, where the
    host's own `pointerup` listener has already ended the drag one event earlier.
  */
  host.addEventListener('click', (event) => {
    const entry = chipEntry(event.target);
    if (!entry) return;
    if (endDrag() || committedDrag) {
      committedDrag = false;
      return;
    }
    pick(entry, event);
  });

  /*
    Which chips carry a number, decided per row so a chain can be read as a ruler.

    **Every multiple of ten, plus the chain's own first residue** -- the first because a chain
    starting at 3, or at 401, has no anchor at all until the first multiple, and "where does this
    chain begin" is the question the reader has before any other. Dropped again when it is within
    `MIN_NUMBER_GAP` chips of the next mark, or the two numbers sit on top of each other.

    **Polymer rows only.** A ligand or ion chip already carries its three-letter name and is one of
    a handful; a ruler along five hetero residues at 401, 402, 601 measures nothing.
  */
  function numberedKeys(entries, polymer) {
    const marked = new Set();
    if (!polymer || entries.length === 0) return marked;
    // The first chip of an id only: 1IGT's 100H-100K are four chips, and four "100"s overlap.
    entries.forEach((entry, index) => {
      if (entry.sequence_id % SEQUENCE_NUMBER_PERIOD !== 0) return;
      if (index > 0 && entries[index - 1].sequence_id === entry.sequence_id) return;
      marked.add(entry.key);
    });
    const firstMark = entries.findIndex((entry) => marked.has(entry.key));
    if (firstMark !== 0 && (firstMark < 0 || firstMark >= MIN_NUMBER_GAP)) {
      marked.add(entries[0].key);
    }
    return marked;
  }

  function buildRow(title, entries, polymer) {
    const row = document.createElement('div');
    row.className = 'sequence-row';
    const label = document.createElement('span');
    label.className = 'sequence-row-label';
    label.textContent = title;
    const track = document.createElement('div');
    track.className = 'sequence-row-track';
    const numbered = numberedKeys(entries, polymer);
    // Both, and for different halves of the same gap: the track spaces its wrapped lines, the row
    // makes room over the first one and keeps the label level with it.
    track.dataset.numbered = String(numbered.size > 0);
    row.dataset.numbered = track.dataset.numbered;
    entries.forEach((entry) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `sequence-chip sequence-chip-${entry.component}`;
      chip.dataset.residueKey = entry.key;
      // The number is CSS's, out of `content: attr(data-sequence-number)`: it is a mark over the
      // track rather than part of the chip, so it can never be read as the chip's own label and
      // costs no node per residue at the cap.
      if (numbered.has(entry.key)) chip.dataset.sequenceNumber = String(entry.sequence_id);
      chip.textContent = entry.label;
      chip.title = entry.title;
      chip.setAttribute('aria-pressed', 'false');
      chip.setAttribute('aria-label', entry.title);
      // `setEnabled()` only reaches chips that exist, so a strip drawn after it would come up live.
      chip.disabled = !enabled;
      chips.set(entry.key, chip);
      positions.set(entry.key, order.length);
      order.push(entry);
      track.append(chip);
    });
    row.append(label, track);
    return row;
  }

  return {
    /**
     * Draw the strip for a residue list, or say why it is not drawn.
     *
     * `residues` is `groupResidues()`'s own output. **Water is dropped, and the reason is size
     * rather than reachability** -- a water can reach a layer. The refusal below is whole-strip —
     * one chain past `MAX_CHIPS` and nothing is drawn at all — so a hydrated structure's few
     * thousand waters would take the polymer sequence down with them, to offer chips nobody picks
     * a water by. One water is reached by clicking it in the 3D view, where it is visible exactly
     * when it is drawn.
     */
    setResidues(residues = []) {
      chips = new Map();
      order = [];
      positions = new Map();
      anchorKey = undefined;
      host.replaceChildren();
      // One chip per residue a selection can name. An assembly's copies share chain, id and
      // insertion code, so a chip per copy lit only the last copy and counted every copy against the
      // cap (10EC: 5,472 chips for 456 residues).
      const seen = new Set();
      const drawable = residues.filter((residue) => {
        if (residue.component === 'water') return false;
        const key = chipKey(residue);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (drawable.length === 0) {
        host.dataset.state = 'empty';
        return 0;
      }
      if (drawable.length > MAX_CHIPS) {
        host.dataset.state = 'refused';
        const note = document.createElement('p');
        note.className = 'sequence-note';
        note.textContent = `${drawable.length} residues is past this strip's ${MAX_CHIPS} limit, `
          + 'so it is not drawn. Select in the 3D view, or use the chain shortcuts.';
        host.append(note);
        return 0;
      }
      host.dataset.state = 'drawn';
      // Chains in first-seen order, which is the file's own; the polymer rows come first because a
      // ligand row is a handful of chips and a polymer row is the thing being read.
      const byChain = new Map();
      drawable.forEach((residue) => {
        const polymer = residue.component === 'protein' || residue.component === 'nucleic';
        const chain = polymer ? residue.chainId : `${residue.chainId} · other`;
        if (!byChain.has(chain)) byChain.set(chain, { polymer, entries: [] });
        const code = oneLetterCode(residue);
        byChain.get(chain).entries.push({
          key: chipKey(residue),
          chain_id: residue.chainId,
          sequence_id: residue.residueId,
          insertion_code: residue.insertionCode,
          component: residue.component,
          label: code ?? residue.name,
          title: `${residue.name} ${residue.chainId || '(blank)'}`
            + `${residue.residueId}${residue.insertionCode || ''}`,
        });
      });
      const rows = [...byChain.entries()].sort(
        ([, left], [, right]) => Number(right.polymer) - Number(left.polymer),
      );
      rows.forEach(([chain, { polymer, entries }]) => {
        host.append(buildRow(chain || '(blank)', entries, polymer));
      });
      return order.length;
    },

    /** Mirror the plugin's selection. `keys` is a `Set` of `main.js`'s own residue keys. */
    setSelected(keys) {
      chips.forEach((_, key) => paintChip(key, keys.has(key)));
    },

    /*
      Mirror what Mol* is highlighting, wherever the pointer that raised it is.

      Driven by the plugin's own highlight providers, so this is the 3D view's answer rather than
      the strip's guess -- a hover over the picture lights the chip, and a hover over a chip lights
      it through the same call, because the chip's hover goes out as a highlight and comes back
      here. One road, both directions.
    */
    setHovered(keys) {
      chips.forEach((_, key) => paintMark(key, 'is-hovered', keys.has(key)));
    },

    /*
      Mirror Mol*'s focus -- the residue an Inspect press is looking at, from either surface.

      It is *not* the selection and must not read as one: a focus is "this is the one on screen"
      and survives until something else is focused, where a selection is what a layer would be
      made of.
    */
    setFocused(keys) {
      chips.forEach((_, key) => paintMark(key, 'is-focused', keys.has(key)));
    },

    setEnabled(next) {
      enabled = Boolean(next);
      host.dataset.enabled = String(enabled);
      chips.forEach((chip) => { chip.disabled = !enabled; });
    },

    /** `select` or `inspect`; anything else is `select`, which is what this strip was built for. */
    setGesture(next) {
      gesture = next === 'inspect' ? 'inspect' : 'select';
      host.dataset.gesture = gesture;
    },

    size: () => order.length,
    clear() {
      chips = new Map();
      order = [];
      positions = new Map();
      anchorKey = undefined;
      host.dataset.state = 'empty';
      host.replaceChildren();
    },
  };
}
