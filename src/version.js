/*
  The release this page is. `package.json`'s `version` is the other copy and the two are pinned
  equal: this one exists because `src/` is imported without Vite in places, and a JSON import would
  ship the whole package manifest to the page.

  **Not a compatibility gate.** `SESSION_SCHEMA_VERSION` decides what opens; this says which
  release wrote a file, for whoever is reading it later. Bump it for a release, never to refuse one.
*/
export const APP_NAME = 'FoldRay';
export const APP_VERSION = '0.1.0';
export const APP_CHANNEL = 'beta';
export const APP_SIGNATURE = `${APP_NAME} ${APP_VERSION}`;
