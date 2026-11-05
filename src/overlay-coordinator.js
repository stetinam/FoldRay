/*
  Coordination for the app's non-modal popovers.

  File, Styles and the shared visual picker live in different modules and different stacking
  contexts, but they are one interaction class: opening one dismisses the others, and a pointer
  press outside closes the open surface. Modal overlays such as Save As scope are intentionally not
  registered here; they own the whole window and have explicit actions.
*/

const OVERLAY_OPEN_EVENT = 'foldray:overlay-open';


export function announceOverlayOpen(owner) {
  document.dispatchEvent(new CustomEvent(OVERLAY_OPEN_EVENT, { detail: { owner } }));
}


export function coordinateOverlay({
  owner,
  contains,
  isOpen,
  close,
  /*
    Whether another overlay opening dismisses this one. True for the popovers, which compete for the
    same attention; false for a surface that only answers to a press outside it. The sequence drawer
    is the second kind: it sits directly under the Styles bar, which opens its gallery on hover, so
    reaching for the drawer's own toggle would have closed the drawer on the way.
  */
  dismissOnOverlayOpen = true,
}) {
  if (dismissOnOverlayOpen) {
    document.addEventListener(OVERLAY_OPEN_EVENT, (event) => {
      if (event.detail?.owner !== owner && isOpen()) close();
    });
  }
  document.addEventListener('pointerdown', (event) => {
    if (isOpen() && !contains(event.target)) close();
  });
}
