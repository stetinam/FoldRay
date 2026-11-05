/*
  Shared pan and zoom for Render and Compare.

  One normalized inspection state drives the single Render image and both Compare images. Zoom is
  a multiple of each image's fitted size; pan is stored as a fraction of that fitted size. That
  makes a detail selected in Render remain the selected detail in Compare even though Wipe, Split
  and Render have different matte dimensions. Either Compare pane may drive the shared state, so
  the two images can never drift apart.

  Transforms never participate in layout, Fit removes them completely, and every control remains a
  button. Those are what keep the stage's own size a matter for the responsive layout rather than
  for the zoom, and inspection state out of saved sessions.
*/

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const STEP = 1.5;
const KEY_PAN = 40;


export function initRenderZoom() {
  const group = document.querySelector('#stage-zoom');
  const targets = [
    {
      mode: 'render',
      viewport: document.querySelector('#stage-render-viewport'),
      image: document.querySelector('#stage-render-image'),
      overlay: document.querySelector('#post-process-preview'),
    },
    {
      mode: 'compare',
      viewport: document.querySelector('#compare-viewport-a'),
      image: document.querySelector('#compare-image-a'),
    },
    {
      mode: 'compare',
      viewport: document.querySelector('#compare-viewport-b'),
      image: document.querySelector('#compare-image-b'),
    },
  ].filter(({ viewport, image }) => viewport && image);
  if (!group || targets.length === 0) return undefined;

  const readout = document.querySelector('#stage-zoom-level');
  const zoomIn = document.querySelector('#stage-zoom-in');
  const zoomOut = document.querySelector('#stage-zoom-out');
  const fitButton = document.querySelector('#stage-zoom-fit');
  const actualButton = document.querySelector('#stage-zoom-actual');

  let mode = 'preview';
  let zoom = 1;
  // Fractions of the fitted image dimensions, not pixels in one particular matte.
  let panX = 0;
  let panY = 0;
  let dragging;

  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const activeTarget = () => targets.find((target) => target.mode === mode) ?? targets[0];


  function fitted(target) {
    const style = getComputedStyle(target.viewport);
    const boxWidth = target.viewport.clientWidth
      - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const boxHeight = target.viewport.clientHeight
      - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const naturalWidth = target.image.naturalWidth;
    const naturalHeight = target.image.naturalHeight;
    if (!naturalWidth || !naturalHeight || boxWidth <= 0 || boxHeight <= 0) {
      return {
        width: 0,
        height: 0,
        boxWidth,
        boxHeight,
        naturalWidth,
        naturalHeight,
      };
    }
    const scale = Math.min(1, boxWidth / naturalWidth, boxHeight / naturalHeight);
    return {
      width: naturalWidth * scale,
      height: naturalHeight * scale,
      boxWidth,
      boxHeight,
      naturalWidth,
      naturalHeight,
    };
  }


  function clampPixels(box, candidateX, candidateY, atZoom = zoom) {
    const slackX = Math.max(0, (box.width * atZoom - box.boxWidth) / 2);
    const slackY = Math.max(0, (box.height * atZoom - box.boxHeight) / 2);
    return {
      x: clamp(candidateX, -slackX, slackX),
      y: clamp(candidateY, -slackY, slackY),
    };
  }


  function pixelsFor(target, atZoom = zoom) {
    const box = fitted(target);
    return {
      box,
      ...clampPixels(box, panX * box.width, panY * box.height, atZoom),
    };
  }


  function rememberPixels(box, x, y) {
    panX = box.width > 0 ? x / box.width : 0;
    panY = box.height > 0 ? y / box.height : 0;
  }


  function applyTarget(target) {
    const zoomed = zoom > 1;
    const media = [target.image, target.overlay].filter(Boolean);
    if (zoomed) {
      const { x, y } = pixelsFor(target);
      media.forEach((element) => {
        element.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
      });
    } else media.forEach((element) => element.style.removeProperty('transform'));
    target.viewport.dataset.zoomed = String(zoomed);
  }


  function apply() {
    targets.forEach(applyTarget);
    const reference = activeTarget();
    const box = fitted(reference);
    const actual = box.width > 0 ? box.naturalWidth / box.width : 1;
    const zoomed = zoom > 1;
    const atActual = Math.abs(zoom - actual) < 0.005;
    readout.textContent = zoomed ? `${Math.round(zoom * 100)}%` : 'Fit';
    fitButton.setAttribute('aria-pressed', String(!zoomed));
    actualButton.setAttribute('aria-pressed', String(atActual));
    zoomIn.disabled = zoom >= MAX_ZOOM - 0.0001;
    zoomOut.disabled = zoom <= MIN_ZOOM + 0.0001;
    actualButton.disabled = actual <= 1.0001;
  }


  function zoomTo(next, clientX, clientY, target = activeTarget()) {
    const box = fitted(target);
    const nextZoom = clamp(next, MIN_ZOOM, MAX_ZOOM);
    if (nextZoom === zoom || box.width <= 0) return;
    const rect = target.viewport.getBoundingClientRect();
    const anchorX = clientX ?? rect.left + rect.width / 2;
    const anchorY = clientY ?? rect.top + rect.height / 2;
    const centreX = rect.left + rect.width / 2;
    const centreY = rect.top + rect.height / 2;
    const current = pixelsFor(target);
    const ratio = nextZoom / zoom;
    const candidateX = anchorX - centreX - ratio * (anchorX - centreX - current.x);
    const candidateY = anchorY - centreY - ratio * (anchorY - centreY - current.y);
    const clamped = clampPixels(box, candidateX, candidateY, nextZoom);
    zoom = nextZoom;
    rememberPixels(box, clamped.x, clamped.y);
    apply();
  }


  function fit() {
    zoom = 1;
    panX = 0;
    panY = 0;
    apply();
  }


  function actualSize(target = activeTarget()) {
    const box = fitted(target);
    if (box.width <= 0) return;
    zoomTo(box.naturalWidth / box.width, undefined, undefined, target);
  }


  function panBy(target, dx, dy) {
    if (zoom <= 1) return;
    const current = pixelsFor(target);
    const clamped = clampPixels(current.box, current.x + dx, current.y + dy);
    rememberPixels(current.box, clamped.x, clamped.y);
    apply();
  }


  function interactive(target) {
    return !group.hidden && target.mode === mode;
  }


  targets.forEach((target) => {
    const { viewport } = target;
    viewport.addEventListener('wheel', (event) => {
      if (!interactive(target)) return;
      event.preventDefault();
      const magnitude = Math.min(1, Math.abs(event.deltaY) / 100);
      const factor = event.deltaY < 0 ? STEP ** magnitude : STEP ** -magnitude;
      zoomTo(zoom * factor, event.clientX, event.clientY, target);
    }, { passive: false });

    viewport.addEventListener('pointerdown', (event) => {
      if (!interactive(target) || zoom <= 1 || event.button !== 0) return;
      dragging = {
        target,
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      viewport.setPointerCapture(event.pointerId);
      viewport.dataset.panning = 'true';
      event.preventDefault();
    });
    viewport.addEventListener('pointermove', (event) => {
      if (dragging?.target !== target || dragging.id !== event.pointerId) return;
      panBy(target, event.clientX - dragging.x, event.clientY - dragging.y);
      dragging.x = event.clientX;
      dragging.y = event.clientY;
    });
    const endDrag = (event) => {
      if (dragging?.target !== target || dragging.id !== event.pointerId) return;
      dragging = undefined;
      delete viewport.dataset.panning;
      if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    };
    viewport.addEventListener('pointerup', endDrag);
    viewport.addEventListener('pointercancel', endDrag);

    viewport.addEventListener('dblclick', (event) => {
      if (!interactive(target)) return;
      event.preventDefault();
      if (zoom > 1) fit();
      else actualSize(target);
    });

    viewport.addEventListener('keydown', (event) => {
      if (!interactive(target) || event.altKey || event.ctrlKey || event.metaKey) return;
      const pan = {
        ArrowLeft: [KEY_PAN, 0],
        ArrowRight: [-KEY_PAN, 0],
        ArrowUp: [0, KEY_PAN],
        ArrowDown: [0, -KEY_PAN],
      }[event.key];
      if (pan) {
        if (zoom <= 1) return;
        event.preventDefault();
        panBy(target, pan[0], pan[1]);
        return;
      }
      if (event.key === '+' || event.key === '=') zoomTo(zoom * STEP, undefined, undefined, target);
      else if (event.key === '-' || event.key === '_') zoomTo(zoom / STEP, undefined, undefined, target);
      else if (event.key === '0') fit();
      else if (event.key === '1') actualSize(target);
      else return;
      event.preventDefault();
    });

    target.image.addEventListener('load', apply);
  });

  zoomIn.addEventListener('click', () => zoomTo(zoom * STEP));
  zoomOut.addEventListener('click', () => zoomTo(zoom / STEP));
  fitButton.addEventListener('click', fit);
  actualButton.addEventListener('click', () => actualSize());
  window.addEventListener('resize', apply);

  apply();

  return {
    setMode(next) {
      mode = ['render', 'compare'].includes(next) ? next : 'preview';
      group.hidden = mode === 'preview';
      apply();
    },
    fit,
    refresh: apply,
    zoom: () => zoom,
    pan: () => {
      const { x, y } = pixelsFor(activeTarget());
      return { x, y };
    },
  };
}
