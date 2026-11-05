import { assetUrl } from './asset-base.js';
// The numbers are the authored templates' own, so the shader renders each material as it was
// designed rather than a second opinion about what "ceramic" means.
//
// All twelve the browser offers are listed, and a missing entry is not a missing picture:
// `loadMaterial` falls through to the generic Principled fallback, so an absent row renders as a
// mid-rough dielectric and reads as a shading bug rather than as a missing table row.

import { EMISSION_TUNABLE } from './catalog/materials.js';

const FILES = {
  bioluminescent: 'bioluminescent',
  ceramic: 'ceramic',
  chrome: 'chrome',
  diffuse: 'diffuse',
  emission: 'emission',
  glass: 'glass',
  glossy: 'glossy',
  jelly: 'jelly',
  metallic: 'metallic',
  satin: 'satin',
  soft_glossy: 'soft_glossy',
  translucent_context: 'translucent_context',
};

/*
  Blender units to Angstroms.

  The tracer works in Angstroms -- `renderer.js`'s ray offset is documented in them and a vdW
  radius is ~2 -- while a `.blend` template's distances are in Blender units. One number in the
  authored graphs needs the conversion: `satin`'s ambient-occlusion Distance, which is `0.05` under
  the label "Mild local contact shading (5 A)". The label is the template's own statement of the
  scale, so this constant is read off it rather than assumed.
*/
const ANGSTROMS_PER_BLENDER_UNIT = 100;

const FALLBACK = {
  roughness: 0.5, metallic: 0.0, ior: 1.45, specularIorLevel: 0.5,
  coatWeight: 0.0, coatRoughness: 0.03, coatIor: 1.5,
  subsurfaceWeight: 0.0, transmissionWeight: 0.0, alpha: 1.0,
  // Contact shading, in Angstroms, from a `ShaderNodeAmbientOcclusion` between the template's
  // colour node and the Principled's Base Color. 0 means the graph has none, which is eleven of
  // the twelve. `satin` is the one that does: this is a node, not a lobe.
  aoDistance: 0.0,
  /*
    A ray-type-dependent Transparent BSDF mix, as `glass` carries one.

    `transparency = clamp(base + step * (isShadowRay + isDiffuseRay), 0, 1)`, which is the whole of
    that template's `Light Path -> Math(ADD) -> Mix -> Mix Shader` chain. `step` of 0 means the
    material has no such chain and the pair costs nothing.
  */
  rayTransparencyBase: 0.0, rayTransparencyStep: 0.0,
  /*
    A view-angle opacity ramp, as `translucent_context` carries one: `Layer Weight (Facing) ->
    Map Range -> Mix Shader` against a Transparent BSDF.

    `opacity = mix(centre, edge, 1 - |N.V| ** blend)`, with `blend` already through Blender's own
    remap of the Layer Weight `Blend` input. `blend` of 0 means the material has no ramp.
  */
  edgeOpacityBlend: 0.0, edgeOpacityCentre: 1.0, edgeOpacityEdge: 1.0,
  // `emissionFromBase` is the interesting one: both emissive templates drive their emission
  // colour from the template's own RGB node, which the worker rewrites per render, so the tint
  // is the picture's colour rather than anything the dump can state.
  emissionStrength: 0.0, emissionColor: [1, 1, 1], emissionFromBase: false,
  // 1 when the template has a reflecting BSDF.  `emission` is a bare Emission node with no
  // closure to scatter with, and Cycles ends a path that reaches one.
  surfaceWeight: 1.0,
};

function socketOf(node, name) {
  const entry = Object.entries(node.inputs ?? {}).find(([key]) => key.split(':')[1] === name);
  return entry ? entry[1] : null;
}

function scalar(node, name, fallback) {
  const socket = socketOf(node, name);
  if (!socket || socket.value === null || socket.linked) return fallback;
  return Array.isArray(socket.value) ? socket.value[0] : socket.value;
}

function colour(node, name, fallback) {
  const socket = socketOf(node, name);
  if (!socket || !Array.isArray(socket.value)) return fallback;
  return socket.value.slice(0, 3);
}

/** True when this input is driven by the template's one `ShaderNodeRGB` -- `SPR User Color`, the
 *  node tagged `simple_renderer_user_color` that the worker replaces with the runtime colour. */
function fromUserColour(tree, node, name) {
  if (!socketOf(node, name)?.linked) return false;
  return tree.links.some((link) => link.to_node === node.name && link.to_socket === name
    && tree.nodes.some((from) => from.name === link.from_node && from.type === 'ShaderNodeRGB'));
}

/*
  The value of the socket paired with `node`'s linked `A`, on a `ShaderNodeMix`.

  A Mix node dumps *every* data type's sockets -- float `A`/`B` at 2/3, vector at 4/5, colour at
  6/7 -- and only one pair is live. `socketOf()` takes the first match by name, which is the float
  pair and is 0.0 on a node whose colour pair is the one wired up. So the live pair is found by
  which `A` carries the link, and `B` is read at the next index rather than by name.
*/
function pairedMixConstant(node) {
  const entries = Object.entries(node?.inputs ?? {});
  const linked = entries.find(([key, socket]) => key.split(':')[1] === 'A' && socket.linked);
  if (!linked) return null;
  const next = entries.find(([key]) => Number(key.split(':')[0]) === Number(linked[0].split(':')[0]) + 1
    && key.split(':')[1] === 'B');
  const value = next?.[1]?.value;
  if (value === null || value === undefined) return null;
  return Array.isArray(value) ? value[0] : value;
}

/** Every link into `node`'s named input, as the nodes on the other end. */
function sources(tree, node, name) {
  return (tree.links ?? [])
    .filter((link) => link.to_node === node?.name && link.to_socket === name)
    .map((link) => (tree.nodes ?? []).find((from) => from.name === link.from_node))
    .filter(Boolean);
}

/*
  `satin`'s contact shading: a `ShaderNodeAmbientOcclusion` between the colour node and Base Color.

  Read from whatever tree it is given rather than keyed by id, so a second template that grows one
  is shaded without an edit here. Returns 0 -- meaning no AO -- when the Base Color is not driven
  through one, which is the other eleven.

  `Distance` is the only input the tracer needs: `Color` is the base colour it already has in hand,
  `only_local` and `inside` are both off in this template, and `samples` is a Cycles-side
  convergence setting rather than a description of the surface -- one ray per shading event
  integrates to the same factor over a progressive render.
*/
function readAmbientOcclusion(tree, principled) {
  const node = sources(tree, principled, 'Base Color')
    .find((from) => from.type === 'ShaderNodeAmbientOcclusion');
  if (!node) return FALLBACK.aoDistance;
  return scalar(node, 'Distance', 0) * ANGSTROMS_PER_BLENDER_UNIT;
}

/**
 * The one `ShaderNodeMixShader` that mixes a `ShaderNodeBsdfTransparent` against the rest.
 *
 * Returns the transparent node and the Fac source, or null. Both templates that carry one wire it
 * the same way -- two shader links into one Mix Shader, one of them a Transparent BSDF -- and the
 * dump records the links in creation order rather than in socket order, so **which of the two
 * inputs the transparent branch occupies cannot be read out of it**. Each caller below decides
 * that from the expression driving `Fac`, and both decisions are checked against the Cycles render
 * of the material's own picker thumbnail; the numbers are in the comments.
 */
function transparentMix(tree) {
  for (const node of tree.nodes ?? []) {
    if (node.type !== 'ShaderNodeMixShader') continue;
    const shaders = sources(tree, node, 'Shader');
    const transparent = shaders.find((from) => from.type === 'ShaderNodeBsdfTransparent');
    const fac = sources(tree, node, 'Fac')[0];
    if (transparent && shaders.length === 2 && fac) return { node, transparent, fac };
  }
  return null;
}

/*
  `glass`'s ray-type transparency, which is what stops it casting a solid black shadow.

  The chain is `Light Path (Is Shadow Ray, Is Diffuse Ray) -> Math(ADD) -> Mix(A = that, B = k)
  -> Mix Shader Fac`, so with the Mix node's own factor `f`:

      Fac = (1 - f) * (isShadowRay + isDiffuseRay) + f * k

  which is `base + step * (isShadowRay + isDiffuseRay)` with `base = f * k` and `step = 1 - f`.
  On the authored template f = 0.307 and k = 0.5, giving **base 0.1535 and step 0.693**.

  **`Fac` is the transparent branch's weight, not the Principled's**, and that is the half the dump
  cannot say. The evidence is the material's own Cycles thumbnail: a glass sphere there reads
  alpha 254/255 right across it, which is `1 - 0.1535 ** 3` for the three surfaces a refracted
  camera ray crosses. Read the other way round it would be `1 - 0.8465 ** 3` = 100/255, and the
  render is not remotely that. So a camera ray takes the Principled with probability 0.8465 and a
  shadow ray -- or any ray past a diffuse bounce -- passes straight through with probability
  0.8465 instead.
*/
function readRayTransparency(tree) {
  const mix = transparentMix(tree);
  if (!mix || mix.fac.type !== 'ShaderNodeMix') return {};
  const [driven] = sources(tree, mix.fac, 'A');
  if (driven?.type !== 'ShaderNodeMath' || driven.properties?.operation !== 'ADD') return {};
  const paths = sources(tree, driven, 'Value');
  if (!paths.length || paths.some((from) => from.type !== 'ShaderNodeLightPath')) return {};
  const factor = scalar(mix.fac, 'Factor', 0);
  const constant = pairedMixConstant(mix.fac);
  if (constant === null) return {};
  return { rayTransparencyBase: factor * constant, rayTransparencyStep: 1 - factor };
}

/*
  `translucent_context`'s view-angle opacity: `Layer Weight (Facing) -> Map Range -> Mix Shader`.

  Blender's Layer Weight `Facing` is `1 - |N.V| ** b`, where `b` is its `Blend` input through the
  node's own remap (`2 * blend` below 0.5, `0.5 / (1 - blend)` above) -- 0 looking straight at the
  surface, 1 at a grazing angle. The Map Range then takes that to [To Min, To Max] with clamping,
  which on the authored template is **0.78 head-on and 0.22 at the silhouette**.

  **That value is the opacity**, so this material is solid in the middle and fades at its edges --
  the opposite of the node's own label, which reads "Edge 0.78 / centre 0.22". Where a label and a
  graph disagree the render decides, and it does here: on the picker thumbnail
  the sphere's alpha is 245/255 at its centre and 198 at 0.95 of its radius, and a ray crossing two
  surfaces of a shape with opacity `a` leaves `1 - (1 - a) ** 2` -- which is 0.95 for a = 0.78 at
  the centre, and 0.78 for the 0.555 this ramp gives at that radius. Read the other way round the
  centre would be 100/255.
*/
function readEdgeOpacity(tree) {
  const mix = transparentMix(tree);
  if (!mix || mix.fac.type !== 'ShaderNodeMapRange') return {};
  const [weight] = sources(tree, mix.fac, 'Value');
  if (weight?.type !== 'ShaderNodeLayerWeight') return {};
  const authored = scalar(weight, 'Blend', 0.5);
  const clamped = Math.min(Math.max(authored, 0), 1 - 1e-5);
  // The Map Range's own input domain is [From Min, From Max] and the authored one is [0, 1], which
  // is exactly Facing's range -- so To Min is the head-on opacity and To Max the grazing one with
  // nothing to rescale. A template that narrowed the domain would need the rescale, and this
  // returns the ramp unread rather than guessing at one.
  if (scalar(mix.fac, 'From Min', 0) !== 0 || scalar(mix.fac, 'From Max', 1) !== 1) return {};
  return {
    edgeOpacityBlend: clamped < 0.5 ? 2 * clamped : 0.5 / (1 - clamped),
    edgeOpacityCentre: scalar(mix.fac, 'To Min', 1),
    edgeOpacityEdge: scalar(mix.fac, 'To Max', 1),
  };
}

function readSurface(tree) {
  const principled = tree.nodes.find((node) => node.type === 'ShaderNodeBsdfPrincipled');
  if (principled) {
    return {
      ...FALLBACK,
      aoDistance: readAmbientOcclusion(tree, principled),
      ...readRayTransparency(tree),
      ...readEdgeOpacity(tree),
      roughness: scalar(principled, 'Roughness', FALLBACK.roughness),
      metallic: scalar(principled, 'Metallic', FALLBACK.metallic),
      ior: scalar(principled, 'IOR', FALLBACK.ior),
      specularIorLevel: scalar(principled, 'Specular IOR Level', FALLBACK.specularIorLevel),
      coatWeight: scalar(principled, 'Coat Weight', FALLBACK.coatWeight),
      coatRoughness: scalar(principled, 'Coat Roughness', FALLBACK.coatRoughness),
      coatIor: scalar(principled, 'Coat IOR', FALLBACK.coatIor),
      subsurfaceWeight: scalar(principled, 'Subsurface Weight', FALLBACK.subsurfaceWeight),
      transmissionWeight: scalar(principled, 'Transmission Weight', FALLBACK.transmissionWeight),
      alpha: scalar(principled, 'Alpha', FALLBACK.alpha),
      emissionStrength: scalar(principled, 'Emission Strength', FALLBACK.emissionStrength),
      emissionColor: colour(principled, 'Emission Color', FALLBACK.emissionColor),
      emissionFromBase: fromUserColour(tree, principled, 'Emission Color'),
      surfaceWeight: 1.0,
    };
  }
  const emission = tree.nodes.find((node) => node.type === 'ShaderNodeEmission');
  if (!emission) return null;
  return {
    ...FALLBACK,
    emissionStrength: scalar(emission, 'Strength', FALLBACK.emissionStrength),
    emissionColor: colour(emission, 'Color', FALLBACK.emissionColor),
    emissionFromBase: fromUserColour(tree, emission, 'Color'),
    surfaceWeight: 0.0,
  };
}

const cache = new Map();

async function loadAuthored(id) {
  if (cache.has(id)) return cache.get(id);
  const file = FILES[id];
  let parameters = { ...FALLBACK, id };
  if (file) {
    let dump;
    try {
      const response = await fetch(assetUrl(`materials/${file}.json`));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      dump = await response.json();
    } catch (error) {
      // Refused rather than drawn as the fallback, and not cached, so the next build retries.
      throw new Error(`the ${id} material could not be downloaded (${error.message}); `
        + 'check the connection and try again');
    }
    const material = Object.values(dump.materials)[0];
    const tree = Object.values(material.trees)[0];
    const read = readSurface(tree);
    if (read) parameters = { ...read, id };
  } else {
    console.warn(`No exported material dump for "${id}" -- using the generic Principled fallback`);
  }
  cache.set(id, parameters);
  return parameters;
}

/** The session's own emission strength, validated the way the worker validates it. */
function tunedStrength(style, authored) {
  const raw = style?.emission_strength ?? style?.fluorescence_strength ?? 3.5;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 20) return authored;
  return raw;
}

/**
 * The session's own opacity, folded into the template's authored `Alpha`.
 *
 * The *whole* authored shader is wrapped in a Mix Shader against a Transparent BSDF with the factor
 * set to `opacity`, so the two compose rather than one replacing the other -- hence the multiply. All twelve authored templates carry `Alpha = 1.0`, so the product is just the
 * session's number; the multiply is what keeps that true if one ever does not.
 *
 * Validated as the same request field is validated everywhere -- a finite number in [0, 1].
 * Anything else, and an absent key, means fully opaque: this is the third of the three runtime
 * style tunables and its default is 1.0 everywhere.
 */
function tunedAlpha(style, authored) {
  const raw = style?.opacity;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 1) return authored;
  return authored * raw;
}

export async function loadMaterial(id, style = null) {
  const authored = await loadAuthored(id);
  const alpha = tunedAlpha(style, authored.alpha);
  // The session's own strength overwrites these materials' authored one, so the template's 3.0 is
  // never what Cycles renders.
  const emissionStrength = EMISSION_TUNABLE.has(id)
    ? tunedStrength(style, authored.emissionStrength)
    : authored.emissionStrength;
  if (alpha === authored.alpha && emissionStrength === authored.emissionStrength) return authored;
  return { ...authored, alpha, emissionStrength };
}
