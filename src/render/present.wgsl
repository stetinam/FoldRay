// Display transform.
//
// Blender's `Filmic` view with the `Very High Contrast` look reduces to one chain, because the
// look's inverse `filmic_to_0-70_1-03` cancels the view's own copy of it:
//   linear -> lg2 allocation -> filmic_desat_33 -> / 0.66 -> filmic_to_1.20_1-00 -> sRGB codes.
// The two LUTs ship as `public/assets/luts/filmic_desat33.bin.gz` (gzipped) and `filmic_vhc.bin`.

struct Present {
  dims: vec4u,        // width, height, accumulated frames, desat lut size
  // Zero. Improve image is `post-processing.js`'s alone; the layout is kept rather than repacked.
  reserved0: vec4f,
  reserved1: vec4f,
  adjust2: vec4f,     // _, backdrop (0 alpha / 1 white / 2 black / 3 premultiplied), _, unpremultiply
  log: vec4f,         // lg2 min, lg2 max, uniform allocation max, look lut length
  // `flags.y` is the view transform, as the index of `VIEW_TRANSFORMS` in `src/capabilities.js`.
  // That list is the enum: `renderer.js` takes the index out of it rather than keeping a copy of
  // the order here, so a row that moves there moves this dispatch with it.
  flags: vec4f,       // read the denoised buffer, view transform, _, _
};

@group(0) @binding(0) var<uniform> present: Present;
@group(0) @binding(1) var<storage, read> accum: array<vec4f>;
@group(0) @binding(2) var<storage, read> desat: array<f32>;
@group(0) @binding(3) var<storage, read> look: array<f32>;
// `denoise.wgsl` writes this already averaged and already unpremultiplied, so reading it skips
// both of those steps rather than doing them twice.
@group(0) @binding(4) var<storage, read> denoised: array<vec4f>;

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  var points = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(-1.0, 1.0), vec2f(3.0, 1.0));
  return vec4f(points[index], 0.0, 1.0);
}

fn desatLookup(rgb: vec3f) -> vec3f {
  let size = present.dims.w;
  let last = f32(size - 1u);
  let position = clamp(rgb, vec3f(0.0), vec3f(1.0)) * last;
  let base = vec3u(clamp(floor(position), vec3f(0.0), vec3f(last - 1.0)));
  let frac = position - vec3f(base);
  var result = vec3f(0.0);
  for (var corner = 0u; corner < 8u; corner = corner + 1u) {
    let offset = vec3u(corner & 1u, (corner >> 1u) & 1u, (corner >> 2u) & 1u);
    let index = base + offset;
    let flat = (index.x + index.y * size + index.z * size * size) * 3u;
    let weight = mix(1.0 - frac.x, frac.x, f32(offset.x))
      * mix(1.0 - frac.y, frac.y, f32(offset.y))
      * mix(1.0 - frac.z, frac.z, f32(offset.z));
    result = result + weight * vec3f(desat[flat], desat[flat + 1u], desat[flat + 2u]);
  }
  return result;
}

fn lookLookup(value: f32) -> f32 {
  let entries = u32(present.log.w);
  let position = clamp(value, 0.0, 1.0) * f32(entries - 1u);
  let index = min(u32(position), entries - 2u);
  let frac = position - f32(index);
  return mix(look[index], look[index + 1u], frac);
}

fn filmic(linear: vec3f) -> vec3f {
  let low = present.log.x;
  let high = present.log.y;
  let floorValue = exp2(low);
  let allocated = (log2(max(linear, vec3f(floorValue))) - vec3f(low)) / (high - low);
  let logged = desatLookup(allocated) / present.log.z;
  return vec3f(lookLookup(logged.x), lookLookup(logged.y), lookLookup(logged.z));
}

fn toSrgb(c: vec3f) -> vec3f {
  let v = max(c, vec3f(0.0));
  return select(1.055 * pow(v, vec3f(1.0 / 2.4)) - vec3f(0.055), v * 12.92, v <= vec3f(0.0031308));
}

/*
  ---------------------------------------------------------------- AgX

  Analytic AgX, which is the whole reason it is here rather than as a third and fourth `.bin`.

  Troy Sobotka's AgX as three.js ships it (`AgXToneMapping`, MIT, based on Filament's, Apache-2.0):
  EaryChow/AgX's inset matrix, three.js's inverse of Filament's outset matrix, Filament's log range and
  Benjamin Wrensch's sixth-order polynomial fitted to the sigmoid
  (<https://iolite-engine.com/blog_posts/minimal_agx_implementation>), with a mean squared error of 3.7e-6 against it. `docs/attributions.md` carries the notices.
  The analytic form was chosen over the LUT for exactly that -- no data files, no 464 KB, no
  provenance question -- and it is what Blender 4.x itself defaults to, so it reads as the current
  look rather than the old one.

  **The inset matrix is EaryChow/AgX's, as Filament and three.js carry it.** That configuration's
  `AgX Log` colourspace carries `0.856627153315983, 0.0951212405381588, 0.0482516061458583 / ...`, which is
  this matrix transposed -- the same rotation and the same [0.4, 0.22, 0.13] chroma inset. So the
  two are the same transform up to the sigmoid, where the configuration interpolates a 3D LUT and this
  evaluates a polynomial. **They are not held to each other and must not be**: this is an
  approximation of the same curve, not a copy of the same data.

  Two details worth keeping, because both are easy to get wrong and neither shows as an error:

  * **The log range is asymmetric.** The allocation runs [-12.47393, +4.026069] EV, not the
    [-12.47393, +12.526069] that `AgX Base Rec.2020`'s *forward* AllocationTransform states -- the
    latter is the input encoding and the former is what the sigmoid maps onto [0, 1]. Using the
    symmetric pair puts middle grey about two and a half stops too dark.
  * **The outset lands in a display encoding, not in light.** What comes out of the polynomial and
    the outset matrix is display-referred with a gamma on it, so it is linearised, converted from
    Rec.2020 to Rec.709 primaries and re-encoded -- because this function's contract, like
    `filmic()`'s, is to return sRGB *code values*. **The exponent is 2.4 and the published
    implementation's is 2.2**, which is the one number here that is deliberately not the source's:
    three.js linearises with 2.2 because it is approximating a display gamma before its own output
    pass re-encodes, while Blender's chain applies an `ExponentTransform` of exactly 2.4 to the
    same LUT's output. It is worth measuring rather than shrugging at -- scene-linear 0.18 lands at
    **0.1865 display-linear under 2.4 and 0.2145 under 2.2**, and middle grey a quarter of a stop
    bright is the kind of error that reads as a lighting choice.
*/
const AGX_MIN_EV = -12.47393;
const AGX_MAX_EV = 4.026069;

// Rec.2020 <-> Rec.709, ITU-R BT.2407. WGSL matrices are column-major, so each `vec3f` is a column.
const LINEAR_SRGB_TO_REC2020 = mat3x3<f32>(
  vec3f(0.6274, 0.0691, 0.0164),
  vec3f(0.3293, 0.9195, 0.0880),
  vec3f(0.0433, 0.0113, 0.8956));
const REC2020_TO_LINEAR_SRGB = mat3x3<f32>(
  vec3f(1.6605, -0.1246, -0.0182),
  vec3f(-0.5876, 1.1329, -0.1006),
  vec3f(-0.0728, -0.0083, 1.1187));

const AGX_INSET = mat3x3<f32>(
  vec3f(0.856627153315983, 0.137318972929847, 0.11189821299995),
  vec3f(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
  vec3f(0.0482516061458583, 0.101439036467562, 0.811302368396859));
const AGX_OUTSET = mat3x3<f32>(
  vec3f(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
  vec3f(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
  vec3f(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));

/** The sixth-order fit to AgX's sigmoid, on the [0, 1] log-allocated value. */
fn agxContrast(x: vec3f) -> vec3f {
  let x2 = x * x;
  let x4 = x2 * x2;
  return 15.5 * x4 * x2
    - 40.14 * x4 * x
    + 31.96 * x4
    - 6.868 * x2 * x
    + 0.4298 * x2
    + 0.1191 * x
    - 0.00232;
}

fn agx(linear: vec3f) -> vec3f {
  var colour = AGX_INSET * (LINEAR_SRGB_TO_REC2020 * max(linear, vec3f(0.0)));
  colour = log2(max(colour, vec3f(1e-10)));
  colour = clamp((colour - vec3f(AGX_MIN_EV)) / (AGX_MAX_EV - AGX_MIN_EV), vec3f(0.0), vec3f(1.0));
  colour = AGX_OUTSET * agxContrast(colour);
  // Out of the display encoding, into Rec.709 light, and back out through the sRGB curve.
  colour = REC2020_TO_LINEAR_SRGB * pow(max(colour, vec3f(0.0)), vec3f(2.4));
  return toSrgb(clamp(colour, vec3f(0.0), vec3f(1.0)));
}

/*
  The view transform, dispatched on `VIEW_TRANSFORMS`'s own index.

  `standard` is Blender's, and it is four lines because that is all it is: the linear scene-referred
  value clipped at 1.0 and encoded, with no tone curve at all -- so a highlight blows out rather
  than rolling off, which is the point of offering it. The clamp is `readPixel()`'s, applied to
  every branch alike.

  An index this does not know falls to `filmic`, which is the first row rather than the product's
  default. Nothing in the app can produce one -- `render-backend.js` resolves an unknown id before
  it gets here -- so this is the shader refusing to guess rather than a fallback anybody rides.
*/
fn viewTransform(linear: vec3f) -> vec3f {
  let mode = u32(present.flags.y);
  if (mode == 1u) { return agx(linear); }
  if (mode == 2u) { return toSrgb(linear); }
  // Raw: scene-linear written as display codes, no curve and no sRGB encoding, so it looks dark.
  if (mode == 3u) { return linear; }
  return filmic(linear);
}

struct Pixel { rgb: vec3f, alpha: f32 };

fn readPixel(x: i32, y: i32) -> Pixel {
  let width = i32(present.dims.x);
  let height = i32(present.dims.y);
  let cx = clamp(x, 0, width - 1);
  let cy = clamp(y, 0, height - 1);
  let index = u32(cy * width + cx);
  var alpha: f32;
  var linear: vec3f;
  if (present.flags.x > 0.5) {
    let filtered = denoised[index];
    alpha = clamp(filtered.w, 0.0, 1.0);
    linear = filtered.xyz;
  } else {
    let record = accum[index];
    let frames = max(f32(present.dims.z), 1.0);
    alpha = clamp(record.w / frames, 0.0, 1.0);
    linear = record.xyz / frames;
    if (present.adjust2.w > 0.5 && alpha > 1e-4) { linear = linear / alpha; }
  }
  var out: Pixel;
  out.rgb = clamp(viewTransform(linear), vec3f(0.0), vec3f(1.0));
  out.alpha = alpha;
  return out;
}

@fragment
fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let centre = readPixel(i32(position.x), i32(position.y));
  let rgb = centre.rgb;
  let backdrop = present.adjust2.y;
  // Backdrop 0 is the product's contract, not a canvas convenience: straight, un-premultiplied
  // RGBA, which is what a PNG stores.  The studio's Alpha backdrop is CSS behind the `img`, and
  // White and Black are composited in at download time by `saveRenderImage()` -- so a shader that
  // returns a hard 1.0 here takes both of those away.
  //
  // `rgb` is already the straight colour: `readPixel()` divides the accumulated radiance by the
  // coverage when `present.adjust2.w` -- the renderer's `unpremultiply` -- is set, and the
  // denoised buffer is written already unpremultiplied for the same reason.  `render-backend.js`
  // sets that flag on the studio path beside `backdrop = 0`, because pairing a premultiplied
  // `rgb` with a real alpha would premultiply it a second time on display.
  if (backdrop < 0.5) { return vec4f(rgb, centre.alpha); }
  // White and Black are an opaque composite: a way of *looking* at the picture rather than the file
  // the product hands over, and unaffected by the canvas's alpha mode because they return 1.0.
  // The scaffolding page sets `renderer.backdrop = 2` and so renders through Black.
  if (backdrop < 2.5) {
    var background = vec3f(0.0);
    if (backdrop < 1.5) { background = vec3f(1.0); }
    return vec4f(rgb * centre.alpha + background * (1.0 - centre.alpha), 1.0);
  }
  // Backdrop 3: the same picture backdrop 0 describes, premultiplied for a canvas.
  //
  // It is *not* a fourth thing the product offers -- `capabilities()` knows nothing about it and
  // no request can ask for it -- it is the display path for a WebGPU context configured
  // `alphaMode: 'premultiplied'`, which is the only transparent mode a canvas has. The studio's
  // Alpha backdrop is CSS behind the canvas, and straight alpha returned into an opaque context
  // shows through nothing at all.
  //
  // `rgb` is straight here for the reason above, so the multiply is the whole difference between
  // the two; `readPixels()` never takes this branch, so the bytes a download gets are untouched by
  // it.
  return vec4f(rgb * centre.alpha, centre.alpha);
}
