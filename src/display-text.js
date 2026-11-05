/*
  What a document may put on screen.

  A session file or a share link is written by someone else, and the status line is the page's own
  voice, so a value quoted into a message is shown only when it looks like an id. Free text a person
  typed -- a layer name, a focus label -- is kept, but without the control and direction-override
  characters that would let it read as something other than what it is.
*/

const QUOTABLE = /^[A-Za-z0-9_.+-]{1,40}$/;

/** A document value inside a message: quoted when it is id-shaped, otherwise not repeated. */
export function quotedValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  const text = typeof value === 'string' ? value : '';
  return QUOTABLE.test(text) ? `"${text}"` : 'a value it does not recognise';
}

// C0 and C1 controls, and the bidirectional marks, embeddings, overrides and isolates.
const HIDDEN_CHARACTERS = /[\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/g;

/** Free text from a document, as the page will show and save it; `fallback` when nothing is left. */
export function displayText(value, maxLength, fallback) {
  if (typeof value !== 'string') return fallback;
  const text = value.replace(HIDDEN_CHARACTERS, '').trim().slice(0, maxLength).trim();
  return text || fallback;
}
