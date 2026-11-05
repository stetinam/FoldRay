/*
  The notes pill over the picture. It shows when its text changes, fades after `NOTE_VISIBLE_MS`,
  and holds while the pointer is on it. The live loop repaints the same notes every frame, so an
  unchanged text restarts nothing: a note that has faded stays gone until the scene says something
  different.
*/
export const NOTE_VISIBLE_MS = 6000;
export const NOTE_LINGER_MS = 2500;
export const NOTE_FADE_MS = 1500;

export function createStageNotes(panel, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let shown = '';
  let timer = null;
  let hovered = false;

  const cancel = () => {
    clearTimer(timer);
    timer = null;
    panel.classList.remove('is-fading');
  };
  const later = (ms, fn) => {
    clearTimer(timer);
    timer = setTimer(fn, ms);
  };
  const fade = () => {
    panel.classList.add('is-fading');
    later(NOTE_FADE_MS, () => {
      timer = null;
      panel.hidden = true;
      panel.classList.remove('is-fading');
    });
  };

  // The CSS fade reads its length from here, so the class and the timer cannot drift apart.
  panel.style.setProperty('--notes-fade', `${NOTE_FADE_MS}ms`);

  // A fading pill still takes the pointer, which is what brings it back.
  panel.addEventListener('pointerenter', () => {
    hovered = true;
    if (!panel.hidden) cancel();
  });
  panel.addEventListener('pointerleave', () => {
    hovered = false;
    if (!panel.hidden) later(NOTE_LINGER_MS, fade);
  });

  return {
    show(text) {
      if (text === shown) return;
      shown = text;
      cancel();
      panel.textContent = text;
      panel.hidden = !text;
      // A hidden pill gets no `pointerleave`, so it forgets the pointer here.
      if (!text) hovered = false;
      else if (!hovered) later(NOTE_VISIBLE_MS, fade);
    },
  };
}
