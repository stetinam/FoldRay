/*
  One material catalogue, shared by the protein, nucleic-acid, ligand, ion and water pickers.

  Sharing it is what keeps the five in parity: #material, #nucleic-material,
  #ligand-material, #ion-material and #water-material already offer the same twelve
  values but list them in two different orders, and the shared picker presents one
  order for all five without touching the selects.

  `swatch` is a CSS background, and it is now the *fallback*: every id here also
  has artwork at src/thumbs/material/<id>.webp, which paintTileArt() prefers.
  The swatches stay because they are what a tile falls back to when a render is
  missing, and because every material has to be visual without one. Materials
  describe a finish rather than a colour -- colour is its own control -- so every
  swatch uses the same neutral body and differs only in how it handles light.
  Keeping the paint here rather than in styles.css is what makes adding a
  material a one-file edit.

  **The artwork is this renderer's own.** The material grid renders twelve
  finishes on one shape under one light: a *surface at level 1* in the same mint,
  under `neutral_softbox`. Both halves were chosen by looking. A sphere pack was
  tried first and five of the finishes came back indistinguishable at 256px --
  six hundred small spheres give a highlight nowhere to land -- and they were
  *still* hard to tell apart on the app's default `autumn_meadow`, because a
  diffuse outdoor sky is the light that makes a specular lobe invisible. There is
  no compositing step: a tile is what the app produces and nothing else, so
  emission's and bioluminescent's halo is the render's own rather than pasted
  into the transparent margin afterwards.
*/
export const MATERIAL_CATALOG = {
  order: [
    'diffuse', 'ceramic', 'satin',
    'glossy', 'soft_glossy', 'chrome', 'metallic',
    'translucent_context', 'glass', 'jelly',
    'emission', 'bioluminescent',
  ],
  entries: {
    diffuse: {
      label: 'Diffuse',
      swatch: 'radial-gradient(circle at 35% 30%, #8e99ad, #596273 55%, #333a47)',
    },
    ceramic: {
      label: 'Ceramic',
      swatch: 'radial-gradient(circle at 32% 26%, #fff 0 4%, #d8dbe2 22%, #9aa2b2 62%, #4d5462)',
    },
    satin: {
      label: 'Satin',
      swatch: 'radial-gradient(ellipse 70% 26% at 40% 26%, #cfd6e2, transparent 70%),'
        + ' radial-gradient(circle at 50% 55%, #6e7889, #3b4351)',
    },
    glossy: {
      label: 'Glossy',
      swatch: 'radial-gradient(circle at 31% 25%, #fff 0 7%, transparent 26%),'
        + ' radial-gradient(circle at 55% 60%, #7b8698, #2b313c)',
    },
    soft_glossy: {
      label: 'Soft glossy',
      swatch: 'radial-gradient(circle at 33% 27%, #f2f5fa 0 3%, rgb(242 245 250 / 45%) 24%, transparent 46%),'
        + ' radial-gradient(circle at 55% 60%, #798496, #333a46)',
    },
    chrome: {
      label: 'Chrome',
      swatch: 'linear-gradient(#ffffff 0 12%, #aab6c8 13% 30%, #232833 31% 45%, #f1f4f9 46% 60%,'
        + ' #4c5566 61% 76%, #d7dee8 77% 88%, #1a1e26 89%)',
    },
    metallic: {
      label: 'Metal',
      swatch: 'linear-gradient(#e8edf5 0 18%, #96a0b1 19% 42%, #444d5d 43% 58%, #aab3c2 59% 78%, #2d333e 79%)',
    },
    translucent_context: {
      label: 'Translucent',
      swatch: 'radial-gradient(circle at 40% 32%, rgb(255 255 255 / 70%), rgb(150 168 196 / 45%) 55%,'
        + ' rgb(60 70 88 / 65%))',
    },
    glass: {
      label: 'Glass',
      swatch: 'radial-gradient(circle at 50% 50%, rgb(15 18 24 / 20%) 0 46%, #cfe0f2 52%, #71839c 62%, #1a1f28)',
    },
    jelly: {
      label: 'Jelly',
      swatch: 'radial-gradient(circle at 36% 28%, #fff 0 5%, #7fd4ff 24%, #2f7fd6 58%, #123a72)',
    },
    emission: {
      label: 'Emission',
      swatch: 'radial-gradient(circle at 50% 50%, #fff 0 34%, #ffe9a8 58%, #f0b429)',
    },
    bioluminescent: {
      label: 'Bioluminescent',
      swatch: 'radial-gradient(circle at 50% 50%, #e6fffb 0 20%, #3ad6bb 46%, #0d6b5e 72%, #05231d)',
    },
  },
};

// The materials whose strength the session sets. Here rather than in `src/materials.js` so the
// rail's strength sliders read the renderer's set without pulling that module into first paint.
export const EMISSION_TUNABLE = new Set(['emission', 'bioluminescent']);
