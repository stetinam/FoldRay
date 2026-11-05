/*
  The left rail's five disclosure cards, as one accordion.

  The rail is a single scroll container holding Protein, Components, Lighting, Camera and Output,
  and Components carries three sub-cards of its own. With three of them open by default the rail
  was several screens tall, and the headers you steer by were the first thing to scroll away. Two
  changes fix that together, and neither works alone:

  - `.rail-card > summary` is sticky in styles.css, so the open card's header stays on screen
    while its body scrolls under it and collapsing it is always one click away.
  - opening a card here closes its siblings, so the rail fits on one screen again.

  Deliberately a *click* behaviour and never hover. The rail is the route to the stage and the top
  bar, so the pointer crosses it constantly; and because opening a card changes the height of every
  card below it, a hover trigger moves the row out from under the cursor and opens a card nobody
  pointed at. Alt-click or Shift-click keeps the others open for the comparisons that need two
  cards at once.

  Native `<details>`/`<summary>` is left in place: summary activation from Enter or Space dispatches
  a click, so the keyboard walks this same path, and the open state stays where assistive
  technology already reads it. The modifier is only legible on the click -- `toggle` carries none --
  which is why this closes the siblings itself instead of reacting to the state change.

  Which cards are open is view state, like stage mode and zoom: in memory only, never in the
  session document and never in browser storage.
*/

// Set on each card's summary from here rather than in index.html: a card is found by scanning for
// a bare `<summary>`, and an attribute written into the markup would hide every card from that.
export const KEEP_OPEN_HINT = 'Alt-click to keep the other sections open';


export function initRailCards(rail) {
  if (!rail) return;
  const cards = [...rail.querySelectorAll('.rail-card')];
  for (const card of cards) {
    const summary = card.querySelector(':scope > summary');
    if (summary) summary.title = KEEP_OPEN_HINT;
  }

  rail.addEventListener('click', (event) => {
    const summary = event.target.closest('summary');
    if (!summary) return;
    // A card's own "Advanced settings" disclosure is a <details> too and stays independent.
    const card = summary.parentElement;
    if (!cards.includes(card)) return;
    // Collapsing a card is always just that, and a modifier asks for the old behaviour. Both fall
    // through to the summary's own activation behaviour, which is all they need.
    if (card.open || event.altKey || event.shiftKey) return;

    /*
      Opening the card here rather than letting the click's default action do it afterwards, so
      that the scroll below measures the layout the user will actually see. Closing first and
      measuring second would read a rail that has lost the old card's body and not yet gained the
      new one, which is not a state that is ever painted.
    */
    event.preventDefault();
    for (const other of cards) {
      if (other !== card) other.open = false;
    }
    card.open = true;

    /*
      Opening a card can leave the rail scrolled past it: where the rail still overflows once the
      others have collapsed -- a tall card, a short window -- the old scroll offset survives and
      the sticky header pins at the top over the middle of the new body. Whatever else moved, the
      card you opened starts at the top. Only ever scrolls up, so where the collapsed rail no
      longer overflows this is a no-op and the browser's own clamping does the same job.
    */
    const railTop = rail.getBoundingClientRect().top;
    const cardTop = card.getBoundingClientRect().top;
    if (cardTop < railTop) rail.scrollTop -= railTop - cardTop;
  });
}
