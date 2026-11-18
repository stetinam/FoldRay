/*
  The opening screen: what a visitor sees before they have a structure loaded.

  It is the entry: it opens on load, and there is no launcher modal behind it.

  Three rules:

    * NOT A MODAL. It never traps focus and never blocks the rest of the page: the wrapping layer
      is `pointer-events: none`, only the panel itself is `pointer-events: auto`, and there is no
      `aria-modal`. The rail and the top bar stay clickable underneath it from the first frame.
    * ONE-TIME. `src/main.js` shows it on the first load only (the studio's entry, or a scaffolding
      URL that failed to start), and nothing reopens it. The rail's Source panel is where a second structure is opened from, and it is the same
      four controls this screen writes into.
    * BUILT FROM WHAT ALREADY EXISTS, NOT A SECOND PATH. Loading a structure drives the *real*
      controls -- `#pdb-load-form`, `#alphafold-load-form`, `#structure-file` through the launcher's
      own `routeFile()` -- so validation, status text and error handling stay single-sourced. This
      screen owns one decision, *which structure*, and it renders nothing to make it.

  **Nothing here may start a Styles sweep.** A recommended row that walked Styles on the structure
  that has just arrived would be a scene build and a trace per Style before the user has asked for
  a picture at all -- a walk nobody pressed a button for. A walk is *user-initiated*, and the Styles
  gallery's own "Render selected styles" is the one place one is asked for. `styles` is
  deliberately not a parameter of this module. What happens on load instead is nothing:
  `onStructureLoaded()` closes this screen, and underneath is the Mol* preview with the structure
  in it.

  **Three ways in and no more**: a drop zone and two accession boxes, which is every decision this
  screen owns. The drop zone takes a saved session as well as a structure, because `routeFile()`
  always could -- see `src/launcher.js`. There is no close button: a press outside the panel
  closes it, as it does every other overlay here, and so does Escape. The heading names the decision
  the screen owns; it is deliberately not a pitch.

  Why this is not a descendant of `.stage`: `.app-shell` carries a capture-phase `change`/`input`
  listener (`src/main.js`, "Any change to any control puts the chosen file behind") that marks the
  session dirty and records a history step on *every* keystroke in *any* input under it. This
  screen needs two real text boxes, so it is mounted as a sibling of `.app-shell`. It writes the
  *real* `#pdb-id`/`#alphafold-id` only once, via `.value =` followed by `requestSubmit()`, which
  fires no `input`/`change` event; the user's own keystrokes land in this module's own boxes, never
  in the shell's tree. It is the Styles overlay's rule from the other side -- that surface may hold
  no `<input>` at all, and the accession box is why this screen is a sibling instead.

  **There is one answer to "can this browser render" and it is not made here.** `src/main.js`'s
  `refusal()` gives it -- two cases, no WebGPU at all, or a plain-HTTP origin where `navigator.gpu`
  is absent even in a browser that has it -- wired to
  `#unsupported`/`#unsupported-title`/`#unsupported-detail`. Two functions answering one question
  is how two answers come to disagree with nothing saying which is right, so the answer is **passed
  in** (`renderRefusal`) and the band itself is **moved here**: the same three elements, relocated
  out of the top bar into this panel, because someone has to be told they cannot render before they
  have invested ten minutes, beside the accession box. Moving a node adds no id; authoring a fourth
  element would.

  The small-screen case is stronger than a notice -- the shell's lowest breakpoint is 1120px and
  nothing below it is built for -- so it replaces the whole screen rather than sitting beside the
  accession box.
*/

import { APP_CHANNEL, APP_VERSION } from './version.js';

/*
  Chosen against the window they were measured in (1123 x 519): 1124 sits just above `styles.css`'s
  lowest breakpoint, so a window that has reflowed out of the three-pane layout always gets the
  notice, and 520 rather than 600, because 600 turns away a window somebody was working in.
*/
export const SMALL_SCREEN_MIN_WIDTH = 1124;

/*
  The website's hero in miniature, above the one decision: its logo, wordmark and line-up as flat
  pictures (made from the site's own files) and three ways
  to the site. Links, not buttons, and in this tab: nothing is loaded while this screen is open.
*/
const WORDMARK_URL = new URL('./opening/wordmark.svg', import.meta.url).href;
const LINEUP_URL = new URL('./opening/lineup.webp', import.meta.url).href;
const LOGO_URL = new URL('./opening/logo.webp', import.meta.url).href;
export const SITE_LINKS = [
  ['Home', '/home/'],
  ['Examples', '/home/#gallery'],
  ['Guide', '/home/#guide'],
];
export const SMALL_SCREEN_MIN_HEIGHT = 520;

export function isSmallScreen(view = (typeof window !== 'undefined' ? window : undefined)) {
  const width = view?.innerWidth;
  const height = view?.innerHeight;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  return width < SMALL_SCREEN_MIN_WIDTH || height < SMALL_SCREEN_MIN_HEIGHT;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function buildAccessionField({ caption, placeholder, buttonLabel, maxLength }) {
  const form = document.createElement('form');
  form.className = 'opening-screen-accession';
  const label = document.createElement('label');
  label.append(el('span', 'opening-screen-accession-caption', caption));
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.autocapitalize = 'characters';
  input.spellcheck = false;
  if (maxLength) input.maxLength = maxLength;
  label.append(input);
  const button = el('button', undefined, buttonLabel);
  button.type = 'submit';
  form.append(label, button);
  return { form, input, button };
}

/*
  `routeFile` and `isBusy` are hooks `src/launcher.js` and `src/main.js` already build: `routeFile`
  is `initLauncher(...).routeFile`, the same DataTransfer-to-`<input>` trick that keeps a dropped
  file and a browsed one landing on one path -- and it reports its own refusals, which is why this
  screen takes no `onReject`.

  `renderRefusal` is `src/main.js`'s own `refusal()` -- `{ title, detail }` or null -- and is the
  whole of this screen's knowledge about WebGPU. See the header for why it is passed rather than
  computed.
*/
export function initOpeningScreen({
  routeFile,
  isBusy = () => false,
  renderRefusal = () => null,
  document: doc = globalThis.document,
  window: win = globalThis.window,
} = {}) {
  const pdbForm = doc.querySelector('#pdb-load-form');
  const pdbInput = doc.querySelector('#pdb-id');
  const alphafoldForm = doc.querySelector('#alphafold-load-form');
  const alphafoldInput = doc.querySelector('#alphafold-id');
  const structureInput = doc.querySelector('#structure-file');
  if (!pdbForm || !pdbInput || !alphafoldForm || !alphafoldInput || !structureInput || !routeFile) {
    return {
      show() {}, hide() {}, isOpen: () => false, onStructureLoaded() {}, destroy() {},
    };
  }

  // ------------------------------------------------------------- the small-screen replacement
  const smallScreen = el('div', 'opening-screen opening-screen-small');
  smallScreen.id = 'opening-screen-small';
  smallScreen.hidden = true;
  const smallScreenPanel = el('div', 'opening-screen-panel opening-screen-small-panel');
  smallScreenPanel.append(
    el('h2', 'opening-screen-heading', 'This app needs a bigger tab or screen'),
    el(
      'p',
      'opening-screen-note',
      'FoldRay is a three-pane layout built for a mouse and a keyboard. Open it on a '
        + 'desktop, or make this window larger.',
    ),
  );
  smallScreen.append(smallScreenPanel);
  doc.body.append(smallScreen);

  // ---------------------------------------------------------------------------- the main panel
  const root = el('section', 'opening-screen');
  root.id = 'opening-screen';
  root.hidden = true;
  root.setAttribute('aria-label', 'Open a structure');

  const panel = el('div', 'opening-screen-panel');

  // No close button: a press anywhere outside the panel closes it (`src/main.js` registers it with
  // the overlay coordinator), and so does Escape.
  const header = el('div', 'opening-screen-header');
  const heading = el('h2', 'opening-screen-heading', 'Load a structure');
  header.append(heading);

  // ---- the one decision this screen owns: which structure. There is no second step.
  const sourceStep = el('div', 'opening-screen-step');

  /*
    The refusal band, **moved** out of the top bar rather than rebuilt. `src/main.js` writes both
    lines into these three ids and disables the source controls behind them; this only decides where
    they are read. It is styled by `.opening-screen-gpu-notice` in place, so the sheet needs nothing
    new either.

    The node is taken whether or not there is a refusal to show, because a refusal is discovered
    asynchronously -- `refusal()` runs inside `scaffoldingPage()` -- and a band that moved only when
    the answer was already known would be in two places depending on timing. `renderRefusal()` is
    consulted here as well so the notice is on screen at the first paint rather than one tick later.
  */
  const gpuNotice = doc.querySelector('#unsupported');
  if (gpuNotice) gpuNotice.classList.add('opening-screen-gpu-notice');
  const refused = renderRefusal();
  if (gpuNotice && refused) {
    gpuNotice.hidden = false;
    gpuNotice.querySelector('#unsupported-title').textContent = refused.title;
    gpuNotice.querySelector('#unsupported-detail').textContent = refused.detail;
  }

  const dropZone = el('div', 'opening-screen-drop');
  dropZone.id = 'opening-screen-drop';
  // A saved session is welcome here too: `routeFile()` hands one to `#session-file` and a
  // structure to `#structure-file`, so the drop zone and the browse button take either.
  const dropLabel = el(
    'p',
    'opening-screen-drop-label',
    'Drop a structure (.cif, .pdb, .cif.gz, .pdb.gz) or a saved session here',
  );
  const browseButton = el('button', 'opening-screen-browse', 'Browse files…');
  browseButton.type = 'button';
  dropZone.append(dropLabel, browseButton);

  const accessions = el('div', 'opening-screen-accessions');
  const pdbBox = buildAccessionField({
    caption: 'PDB ID', placeholder: '4HHB', buttonLabel: 'Load', maxLength: 4,
  });
  const alphafoldBox = buildAccessionField({
    caption: 'AlphaFold (UniProt ID)', placeholder: 'P69905', buttonLabel: 'Load',
  });
  accessions.append(pdbBox.form, alphafoldBox.form);

  if (gpuNotice) sourceStep.append(gpuNotice);
  sourceStep.append(dropZone, accessions);

  const hero = el('div', 'opening-screen-hero');
  const wordmarkLink = el('a', 'opening-screen-wordmark');
  wordmarkLink.href = SITE_LINKS[0][1];
  const logo = el('img', 'opening-screen-logo');
  logo.src = LOGO_URL;
  logo.alt = '';
  logo.width = 58;
  logo.height = 46;
  const wordmark = el('img');
  wordmark.src = WORDMARK_URL;
  wordmark.alt = 'FoldRay';
  wordmarkLink.append(logo, wordmark);
  // Sized in the markup, so the panel does not jump when the picture arrives.
  const lineup = el('img', 'opening-screen-lineup');
  lineup.src = LINEUP_URL;
  lineup.alt = '';
  lineup.width = 328;
  lineup.height = 120;
  const siteLinks = el('nav', 'opening-screen-site');
  siteLinks.setAttribute('aria-label', 'The FoldRay website');
  for (const [label, href] of SITE_LINKS) {
    const link = el('a', undefined, label);
    link.href = href;
    siteLinks.append(link);
  }
  // The wordmark and the release stand in the line-up's empty sky, as the wordmark does on the site.
  const brand = el('div', 'opening-screen-brand');
  brand.append(wordmarkLink, el('span', 'opening-screen-version', `${APP_CHANNEL} ${APP_VERSION}`));
  const art = el('div', 'opening-screen-art');
  art.append(lineup, brand);
  hero.append(art, siteLinks);

  panel.append(hero, header, sourceStep);
  root.append(panel);
  doc.body.append(root);

  // ---------------------------------------------------------------------------------- wiring
  let open = false;

  // Both layers are z-index 45 and `root` is appended later, so an open panel would cover the
  // notice.
  function syncVisibility() {
    const small = isSmallScreen(win);
    smallScreen.hidden = !small;
    root.hidden = !open || small;
  }
  syncVisibility();
  win?.addEventListener?.('resize', syncVisibility);

  function setOpen(next) {
    open = next;
    syncVisibility();
  }

  function showSourceStep() {
    sourceStep.hidden = false;
  }

  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setOpen(false);
  });

  browseButton.addEventListener('click', () => {
    if (!structureInput.disabled) structureInput.click();
  });

  // No drop listeners on the zone: `#window-drop-zone` (z-index 1000) is up before a drag reaches
  // it and `src/launcher.js` routes the drop.

  pdbBox.form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (isBusy()) return;
    pdbInput.value = pdbBox.input.value;
    pdbForm.requestSubmit();
  });
  alphafoldBox.form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (isBusy()) return;
    alphafoldInput.value = alphafoldBox.input.value;
    alphafoldForm.requestSubmit();
  });

  return {
    show() {
      showSourceStep();
      setOpen(true);
    },
    hide() {
      setOpen(false);
    },
    isOpen: () => open,
    // For the overlay coordinator: what counts as inside, and whether the panel is on screen at all
    // (a small window shows the notice instead, which a press elsewhere must not dismiss).
    contains: (target) => panel.contains(target),
    isShown: () => !root.hidden,
    /*
      Called once per successful `loadStructure()`, whether or not this screen is the surface that
      started it -- a structure loaded from the File menu while this screen happens to be open
      should not leave it standing over the studio. A no-op while closed, and a close and nothing
      else -- see the header on why nothing here may start a sweep.
    */
    onStructureLoaded() {
      // Its whole job: the one decision this screen owns has been made, so it gets out of the way
      // of the Mol* preview that has the structure in it. Nothing is rendered on the way out.
      setOpen(false);
    },
    destroy() {
      win?.removeEventListener?.('resize', syncVisibility);
      root.remove();
      smallScreen.remove();
    },
  };
}
