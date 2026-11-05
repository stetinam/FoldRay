/*
  Presentation layer for the representation and type pickers.

  The option *values* are never declared here -- they come from the hidden
  <select> that stays the source of truth, so a picker can never offer something
  the request schema does not accept. The type lists are imported from
  selection-model.js rather than restated, so there is one place to edit when a
  type is added or dropped.

  A catalogue supplies only: tile caption (shorter than the option text, which
  becomes the tooltip), ordering, grouping, and artwork.
*/
import {
  ATOM_SCOPE_OPTIONS,
  CARTOON_TYPE_OPTIONS,
  RIBBON_TYPE_OPTIONS,
  SURFACE_DETAIL_OPTIONS,
} from '../selection-model.js';


// Ordering follows selection-model.js; only the caption is restated, and only
// where the full option text is too long for a tile.
function typeCatalog(options, captions = {}) {
  return {
    order: options.map(([value]) => value),
    entries: Object.fromEntries(
      options.map(([value]) => [value, { label: captions[value] }]),
    ),
  };
}


/*
  **No captions.** One thing with two names is one thing the user has to learn twice, and
  `tileFor()`'s `label: entry.label ?? option.label` is what makes an empty override the same string
  under the tile, on the closed picker and in a selection layer's select.

  A tile is narrow, so the *option text* is kept short enough to fit one: `CARTOON_TYPE_OPTIONS`
  says `Cylindrical`, `Railed tapered` and `Railed chonky`.
*/
export const CARTOON_TYPE_CATALOG = typeCatalog(CARTOON_TYPE_OPTIONS);

export const RIBBON_TYPE_CATALOG = typeCatalog(RIBBON_TYPE_OPTIONS);

export const SURFACE_DETAIL_CATALOG = typeCatalog(SURFACE_DETAIL_OPTIONS, {
  1: 'Level 1',
  2: 'Level 2',
  3: 'Level 3',
  4: 'Level 4',
});

export const ATOM_SCOPE_CATALOG = typeCatalog(ATOM_SCOPE_OPTIONS, {
  all: 'All atoms',
  sidechains: 'Side chains',
});

/*
  Which sub-control each protein representation reveals. main.js already decides
  visibility; this exists so the type row can be described without a switch
  statement per representation, and so a test can assert the two agree.
*/
export const PROTEIN_TYPE_CONTROLS = {
  cartoon: 'cartoon-type',
  ribbon: 'ribbon-type',
  surface: 'surface-detail',
  ball_and_stick_refined: 'atom-scope',
  sticks: 'atom-scope',
  spheres_refined: 'atom-scope',
};

// thumbRef borrows a type image when the representation has none of its own; a real
// src/thumbs/representation/<id>.webp always wins over the borrow (catalog/index.js' tileFor()).
// All six have their own tile, so nothing reads the borrow today -- it is kept because the
// fallback is what a picker shows the day a bake is incomplete, and a borrow pointing at the wrong
// sub-type would then advertise a picture the representation does not produce.
export const REPRESENTATION_CATALOG = {
  order: [
    'cartoon',
    'ribbon',
    'surface',
    'ball_and_stick_refined',
    'sticks',
    'spheres_refined',
  ],
  entries: {
    // The borrow points at the *default* type, which is what a borrow always means: show for the
    // representation the picture a fresh load would actually produce.
    cartoon: { label: 'Cartoon', thumbRef: 'cartoon-type/railed' },
    ribbon: { label: 'Ribbon', thumbRef: 'ribbon-type/standard' },
    // `surface-detail/1`, not `3`: `STYLE_BASELINE`'s `surface_detail` is '1' and it is the
    // select's first option, so 3 is not the default and borrowing it would contradict the rule
    // stated two lines above. The pixels agree -- `representation/surface` and `surface-detail/1`
    // hash to one picture.
    surface: { label: 'Surface', thumbRef: 'surface-detail/1' },
    ball_and_stick_refined: { label: 'Ball & stick' },
    sticks: { label: 'Sticks' },
    spheres_refined: { label: 'Spheres' },
  },
};

export const LIGAND_REPRESENTATION_CATALOG = {
  order: ['ligand_ball_and_stick', 'ligand_sticks', 'ligand_spheres'],
  entries: {
    ligand_ball_and_stick: { label: 'Ball & stick' },
    ligand_sticks: { label: 'Sticks' },
    ligand_spheres: { label: 'Spheres' },
  },
};

/*
  `nucleic_blocks` and `nucleic_rings` lead, because a duplex drawn as a backbone alone comes out
  hollow: they are `nucleic_cartoon` and `nucleic_ribbon` with a solid on each base's own ring plane
  and a stem to the spine. The two backbones keep their tiles -- a phosphodiester chain is a true
  picture of one thing, just not of DNA.

  These two, and `ion_octahedron` below, have a row in `src/capabilities.js`, a tile of their own
  and an `<option>` in the live select. Cataloguing an id before the select offers it is safe by
  construction: `resolveTiles()` drops a catalogue id the `<select>` does not carry, so a
  catalogued-but-unoffered id shows nothing rather than advertising a picture nobody can
  ask for. The defect worth naming is the reverse -- a capability row the picker offers and the
  tracer does not draw -- because it renders nothing and reports it only to an array nobody reads.
*/
export const NUCLEIC_REPRESENTATION_CATALOG = {
  order: [
    'nucleic_blocks',
    'nucleic_rings',
    'nucleic_cartoon',
    'nucleic_ribbon',
    'nucleic_ball_and_stick',
    'nucleic_sticks',
    'nucleic_spheres',
    'nucleic_surface',
  ],
  entries: {
    nucleic_blocks: { label: 'Blocks' },
    nucleic_rings: { label: 'Rings' },
    nucleic_cartoon: { label: 'Tape' },
    nucleic_ribbon: { label: 'Ribbon' },
    nucleic_ball_and_stick: { label: 'Ball & stick' },
    nucleic_sticks: { label: 'Sticks' },
    nucleic_spheres: { label: 'Spheres' },
    nucleic_surface: { label: 'Surface' },
  },
};

export const ION_REPRESENTATION_CATALOG = {
  order: ['ion_spheres', 'ion_faceted', 'ion_octahedron'],
  entries: {
    ion_spheres: { label: 'Smooth' },
    ion_faceted: { label: 'Faceted' },
    // A marker is inscribed in the sphere it replaces, so an octahedron's faces sit at 0.577 of
    // the radius and it reads *smaller* than the other two. That is the shape and not a size bug;
    // the caption should not promise otherwise.
    ion_octahedron: { label: 'Octahedral' },
  },
};
