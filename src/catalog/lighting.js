/*
  Presentation for the illumination picker.

  The nine ids are the scenes #lighting-source offers; nothing here can add a
  tenth, because the tiles are filtered against that select. They are
  one ungrouped run in `order`, led by autumn_meadow, the source the app opens
  on. They are not grouped by source or licence: that says nothing about how a
  scene looks, which is the only question the grid is answering.

  `swatch` approximates each environment's sky/ground split so the grid reads at
  a glance. It is a cue, not a render of the HDRI.
*/
export const LIGHTING_CATALOG = {
  order: [
    'autumn_meadow',
    'blue_studio',
    'dark_studio',
    'neutral_softbox',
    'overcast_sky',
    'clear_sky',
    'cool_night',
    'fluorescence_darkfield',
    'glass_studio',
  ],
  entries: {
    autumn_meadow: {
      label: 'Autumn meadow',
      swatch: 'linear-gradient(#cfe0f0 0 34%, #d8a860 34% 52%, #7f7a3a 52% 72%, #3f4622)',
    },
    blue_studio: {
      label: 'Blue studio',
      swatch: 'linear-gradient(#dbeafe, #6aa6e8 42%, #24486f 72%, #101d2e)',
    },
    dark_studio: {
      label: 'Dark studio',
      swatch: 'radial-gradient(ellipse 60% 40% at 50% 12%, #6b7382, #232833 55%, #0c0e13)',
    },
    neutral_softbox: {
      label: 'Neutral softbox',
      swatch: 'linear-gradient(#f4f5f7 0 30%, #b9bcc4 30% 60%, #6f747e 60%, #3a3e47)',
    },
    overcast_sky: {
      label: 'Soft overcast',
      swatch: 'linear-gradient(#e6eaef, #c3cad3 55%, #8b939e)',
    },
    clear_sky: {
      label: 'Clear directional',
      swatch: 'radial-gradient(circle at 74% 20%, #fff8d8 0 9%, transparent 22%),'
        + ' linear-gradient(#59a6ea 0 62%, #b08a5e 62%, #5c4a30)',
    },
    cool_night: {
      label: 'Cool night',
      swatch: 'radial-gradient(circle at 30% 22%, #93b6e0 0 5%, transparent 18%),'
        + ' linear-gradient(#16264a, #0d1730 60%, #060a14)',
    },
    fluorescence_darkfield: {
      label: 'Fluorescence',
      swatch: 'radial-gradient(circle at 50% 50%, #05070b 0 40%, #1f8f7d 62%, #7b3ad6 82%, #05070b)',
    },
    glass_studio: {
      label: 'Glass studio',
      swatch: 'linear-gradient(#fff 0 22%, #171a21 22% 38%, #fff 38% 58%, #171a21 58% 74%, #cfd4dd 74%)',
    },
  },
};
