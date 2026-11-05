/*
  The catalogue registry, and the one function that turns a picker's live
  <option> list into tiles.

  resolveTiles is deliberately pure and DOM-free so it can be unit tested. It is
  also deliberately defensive in both directions:

    * an option the catalogue never mentions still renders, using the option's
      own text and a neutral placeholder, appended after the ordered ones;
    * a catalogue id the select does not offer is dropped, so a picker can never
      write a value the request schema would reject.

  That is what makes a half-authored catalogue entry harmless.
*/
import { LIGHTING_CATALOG } from './lighting.js';
import { MATERIAL_CATALOG } from './materials.js';
import {
  ATOM_SCOPE_CATALOG,
  CARTOON_TYPE_CATALOG,
  ION_REPRESENTATION_CATALOG,
  LIGAND_REPRESENTATION_CATALOG,
  NUCLEIC_REPRESENTATION_CATALOG,
  REPRESENTATION_CATALOG,
  RIBBON_TYPE_CATALOG,
  SURFACE_DETAIL_CATALOG,
} from './representations.js';
import { thumbUrl } from './thumbs.js';

export { PROTEIN_TYPE_CONTROLS } from './representations.js';

export const CATALOGS = {
  representation: REPRESENTATION_CATALOG,
  'cartoon-type': CARTOON_TYPE_CATALOG,
  'ribbon-type': RIBBON_TYPE_CATALOG,
  'surface-detail': SURFACE_DETAIL_CATALOG,
  'atom-scope': ATOM_SCOPE_CATALOG,
  material: MATERIAL_CATALOG,
  'ligand-representation': LIGAND_REPRESENTATION_CATALOG,
  'nucleic-representation': NUCLEIC_REPRESENTATION_CATALOG,
  'ion-representation': ION_REPRESENTATION_CATALOG,
  lighting: LIGHTING_CATALOG,
};


/*
  The one place a tile's artwork is painted, so the fallback chain is decided once: a rendered
  thumbnail, else the catalogue's CSS swatch, else a neutral placeholder the stylesheet hatches.
  `override` is the swept render in the Styles strip, which stands in for the reference image
  while it exists.

  This lived in three places before -- the swatch picker and two paths in the Styles strip -- and
  the strip's copies had already lost the swatch fallback, so a Style declaring one would have
  rendered as a blank placeholder.
*/
export function paintTileArt(node, tile, override) {
  const source = override ?? tile?.thumb;
  const paint = source
    ? `url("${source}") center / cover no-repeat`
    : (tile?.swatch ?? '');
  node.style.background = paint;
  node.classList.toggle('is-placeholder', paint === '');
}


function catalogOrder(catalog) {
  if (catalog.order) return catalog.order;
  if (catalog.groups) return catalog.groups.flatMap((group) => group.ids);
  return [];
}


function tileFor(kind, option, entry) {
  const referenced = entry.thumbRef ? thumbUrl(...entry.thumbRef.split('/')) : undefined;
  return {
    value: option.value,
    label: entry.label ?? option.label,
    title: option.label,
    thumb: thumbUrl(kind, option.value) ?? referenced,
    swatch: entry.swatch,
    // Carried straight off the live <option>. An option whose capability state is `not_yet` or
    // `missing` is disabled; where nothing disables one this is `undefined` and every consumer
    // treats it as falsy.
    disabled: option.disabled,
  };
}


/*
  options: [{ value, label, group }] read from the select, in document order.
  Returns [{ label, tiles }] -- one entry per group, or a single unlabelled
  group when neither the catalogue nor the select declares any.
*/
export function resolveTiles(kind, options) {
  const catalog = CATALOGS[kind] ?? {};
  const entries = catalog.entries ?? {};
  const byValue = new Map(options.map((option) => [option.value, option]));
  const claimed = new Set(catalogOrder(catalog).filter((value) => byValue.has(value)));
  const build = (values) => values
    .filter((value) => byValue.has(value))
    .map((value) => tileFor(kind, byValue.get(value), entries[value] ?? {}));

  const leftovers = options.filter((option) => !claimed.has(option.value));
  const groups = [];

  if (catalog.groups) {
    catalog.groups.forEach((group) => {
      const tiles = build(group.ids);
      if (tiles.length > 0) groups.push({ label: group.label, tiles });
    });
  } else {
    const ordered = build(catalogOrder(catalog));
    if (ordered.length > 0) groups.push({ label: undefined, tiles: ordered });
  }

  if (leftovers.length > 0) {
    // Grouped by the select's own optgroups, so an uncatalogued option keeps
    // whatever structure the markup already gave it.
    const byGroup = new Map();
    leftovers.forEach((option) => {
      if (!byGroup.has(option.group)) byGroup.set(option.group, []);
      byGroup.get(option.group).push(tileFor(kind, option, entries[option.value] ?? {}));
    });
    byGroup.forEach((tiles, label) => groups.push({ label, tiles }));
  }

  return groups;
}


/*
  The same tiles a picker shows, flattened to the [value, label] pairs a plain
  <select> is built from. The selection layers hold their controls as selects
  rather than pickers, and they used to clone the hidden rail select's options
  verbatim -- so a layer listed the materials in markup order (Ceramic last)
  while the rail listed them in catalogue order (Ceramic second). Reading both
  through resolveTiles is what keeps the two lists identical: same order, same
  captions, same treatment of an uncatalogued option.
*/
export function catalogOptions(kind, options) {
  return resolveTiles(kind, options)
    .flatMap((group) => group.tiles.map((tile) => [tile.value, tile.label]));
}
