/*
  Small, browser-only image finishing pass for completed RGBA renders.

  The path tracer is authoritative for the render. This module receives its output as a texture,
  changes RGB in a short WebGL pipeline, and copies alpha through untouched except where Glow and
  Halo deliberately raise it (see below). Keeping the recipe separate from the render request is
  what lets an old session keep reproducing the same scene while still reapplying its finishing
  pass to the first new result.

  **This runs after the trace and never inside it.** "Alpha is coverage, and coverage is the
  silhouette" is about the film the tracer accumulates; Glow and Halo raise alpha in a finished
  image, which is a compositing choice on a picture that has already been made. Nothing here may be
  moved into the accumulation loop.
*/

export const POST_PROCESS_SCHEMA_VERSION = 1;

export const POST_PROCESS_CONTROLS = Object.freeze([
  { id: 'exposure', label: 'Exposure', min: -3, max: 3, step: 0.05, suffix: ' EV' },
  { id: 'highlights', label: 'Highlights', min: -100, max: 100, step: 1 },
  { id: 'shadows', label: 'Shadows', min: -100, max: 100, step: 1 },
  { id: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1 },
  { id: 'warmth', label: 'Warmth', min: -100, max: 100, step: 1 },
  { id: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1 },
  { id: 'brightness', label: 'Brightness', min: -100, max: 100, step: 1 },
  { id: 'sharpness', label: 'Sharpness', min: 0, max: 100, step: 1 },
  { id: 'tint', label: 'Tint', min: -100, max: 100, step: 1 },
  { id: 'glow', label: 'Glow', min: 0, max: 100, step: 1 },
  { id: 'halo', label: 'Halo', min: 0, max: 100, step: 1 },
]);

// Controls added after the first ship of this panel that must stay loadable from a session written
// before they existed. `validatePostProcessing` defaults these to 0 instead of throwing, the same
// tolerance `session-format.js` documents for additive `editor_state` fields, so
// adding one never needs a POST_PROCESS_SCHEMA_VERSION bump.
const ADDITIVE_CONTROL_IDS = new Set(['glow', 'halo']);

const CONTROL_BY_ID = new Map(POST_PROCESS_CONTROLS.map((control) => [control.id, control]));

// Tone-pass controls only; `glow` and `halo` are applied in the composite pass with their own
// uniforms and their own octave chains, not as per-pixel `tone()` adjustments. A control left in
// this list without a matching `u_<id>` in TONE_FRAGMENT_SOURCE silently gets no uniform location.
const COMPOSITE_CONTROL_IDS = new Set(['glow', 'halo']);
const TONE_CONTROLS = POST_PROCESS_CONTROLS.filter(({ id }) => !COMPOSITE_CONTROL_IDS.has(id));


export function defaultPostProcessing() {
  return {
    schema_version: POST_PROCESS_SCHEMA_VERSION,
    ...Object.fromEntries(POST_PROCESS_CONTROLS.map(({ id }) => [id, 0])),
  };
}


export function validatePostProcessing(value, path = 'post_processing') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  if (value.schema_version !== POST_PROCESS_SCHEMA_VERSION) {
    throw new Error(`${path}.schema_version must be ${POST_PROCESS_SCHEMA_VERSION}.`);
  }
  const normalized = defaultPostProcessing();
  POST_PROCESS_CONTROLS.forEach(({ id, min, max }) => {
    const item = value[id];
    if (item === undefined && ADDITIVE_CONTROL_IDS.has(id)) {
      normalized[id] = 0;
      return;
    }
    if (!Number.isFinite(item) || item < min || item > max) {
      throw new Error(`${path}.${id} must be between ${min} and ${max}.`);
    }
    normalized[id] = item;
  });
  return normalized;
}


export function normalizePostProcessing(value) {
  const normalized = defaultPostProcessing();
  POST_PROCESS_CONTROLS.forEach(({ id, min, max, step }) => {
    const number = Number(value?.[id]);
    if (!Number.isFinite(number)) return;
    const stepped = Math.round(number / step) * step;
    normalized[id] = Math.min(max, Math.max(min, Number(stepped.toFixed(6))));
  });
  return normalized;
}


export function isNeutralPostProcessing(value) {
  const normalized = normalizePostProcessing(value);
  return POST_PROCESS_CONTROLS.every(({ id }) => normalized[id] === 0);
}


export function postProcessingLabel(id, value) {
  const control = CONTROL_BY_ID.get(id);
  if (!control) return String(value);
  const number = Number(value);
  const signed = number > 0 ? `+${number}` : String(number);
  return `${signed}${control.suffix ?? ''}`;
}


function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'unknown shader error';
    gl.deleteShader(shader);
    throw new Error(`Image finishing shader failed: ${message}`);
  }
  return shader;
}


const QUAD_VERTEX_SOURCE = `
  attribute vec2 a_position;
  attribute vec2 a_uv;
  varying vec2 v_uv;
  void main() {
    v_uv = a_uv;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

// Shared by every fragment shader that needs to reason about brightness in linear light.
const COLOR_SPACE_FUNCTIONS = `
  vec3 toLinear(vec3 c) {
    vec3 low = c / 12.92;
    vec3 high = pow((c + 0.055) / 1.055, vec3(2.4));
    return mix(high, low, step(c, vec3(0.04045)));
  }

  vec3 toSrgb(vec3 c) {
    c = max(c, vec3(0.0));
    vec3 low = c * 12.92;
    vec3 high = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
    return mix(high, low, step(c, vec3(0.0031308)));
  }
`;

const TONE_FRAGMENT_SOURCE = `
  precision highp float;
  uniform sampler2D u_image;
  uniform vec2 u_texel;
  uniform float u_exposure;
  uniform float u_highlights;
  uniform float u_shadows;
  uniform float u_contrast;
  uniform float u_warmth;
  uniform float u_saturation;
  uniform float u_brightness;
  uniform float u_sharpness;
  uniform float u_tint;
  varying vec2 v_uv;

  ${COLOR_SPACE_FUNCTIONS}

  vec3 tone(vec3 encoded) {
    vec3 color = toLinear(encoded) * exp2(u_exposure);
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    float shadowMask = 1.0 - smoothstep(0.02, 0.55, luma);
    float highlightMask = smoothstep(0.35, 1.0, luma);
    color += u_shadows * shadowMask
      * (u_shadows >= 0.0 ? (vec3(1.0) - color) : color) * 0.45;
    color += u_highlights * highlightMask
      * (u_highlights >= 0.0 ? (vec3(1.0) - color) : color) * 0.45;
    color += vec3(u_brightness * 0.28);
    color = (color - vec3(0.18)) * exp2(u_contrast * 1.5) + vec3(0.18);
    color *= vec3(1.0 + u_warmth * 0.14, 1.0, 1.0 - u_warmth * 0.14);
    color *= vec3(1.0 + u_tint * 0.08, 1.0 - u_tint * 0.12, 1.0 + u_tint * 0.08);
    luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(vec3(luma), color, exp2(u_saturation));
    return color;
  }

  vec4 sampleTone(vec2 uv) {
    vec4 pixel = texture2D(u_image, clamp(uv, vec2(0.0), vec2(1.0)));
    return vec4(tone(pixel.rgb), pixel.a);
  }

  void main() {
    vec4 source = texture2D(u_image, v_uv);
    vec3 center = tone(source.rgb);
    vec4 left = sampleTone(v_uv - vec2(u_texel.x, 0.0));
    vec4 right = sampleTone(v_uv + vec2(u_texel.x, 0.0));
    vec4 down = sampleTone(v_uv - vec2(0.0, u_texel.y));
    vec4 up = sampleTone(v_uv + vec2(0.0, u_texel.y));
    float weight = left.a + right.a + down.a + up.a;
    vec3 blur = weight > 0.0001
      ? (left.rgb * left.a + right.rgb * right.a + down.rgb * down.a + up.rgb * up.a) / weight
      : center;
    vec3 sharpened = center + (center - blur) * u_sharpness * 1.4;
    gl_FragColor = vec4(clamp(toSrgb(sharpened), 0.0, 1.0), source.a);
  }
`;

// Extracts the part of the toned image bright enough to bloom, premultiplied by the source pixel's
// own alpha so the blur passes below spread both color and coverage together -- the same mechanism
// the offline picker-thumbnail glow uses to let a halo bleed out past an opaque edge into what was
// a fully transparent margin.
//
// A render through this app's authored view transforms never clips above 1.0 the way an HDR bloom
// source would, so a threshold tuned for that (e.g. ~0.8) caught nothing: a real
// `bioluminescent` render's brightest opaque pixel measured ~0.59 linear luma, and a plain
// `emission` render at the same default strength measured only ~0.47 -- dim enough that an
// 0.32-0.85 knee left it almost unaffected while bioluminescent bloomed clearly. The knee sits
// low enough that both read as comparably "glowing" at the same slider value, so ordinary
// specular highlights start to bloom softly and either emissive material blooms strongly.
const GLOW_BRIGHT_THRESHOLD_LOW = 0.2;
const GLOW_BRIGHT_THRESHOLD_HIGH = 0.75;
const BRIGHT_FRAGMENT_SOURCE = `
  precision highp float;
  uniform sampler2D u_image;
  varying vec2 v_uv;

  ${COLOR_SPACE_FUNCTIONS}

  void main() {
    vec4 pixel = texture2D(u_image, v_uv);
    vec3 linearColor = toLinear(pixel.rgb);
    float luma = dot(linearColor, vec3(0.2126, 0.7152, 0.0722));
    float weight = smoothstep(
      ${GLOW_BRIGHT_THRESHOLD_LOW.toFixed(4)}, ${GLOW_BRIGHT_THRESHOLD_HIGH.toFixed(4)}, luma
    ) * pixel.a;
    gl_FragColor = vec4(linearColor * weight, weight);
  }
`;

// Halo's source, and the one place it deliberately parts company with Glow above: no brightness
// knee at all, just the toned image premultiplied by its own alpha. The offline glow that gives the
// Bioluminescent style tile its look blurs the whole tile the same way, which is why a
// mid-brightness teal ribbon spreads a halo there and barely registers under Glow's 0.2-0.75
// smoothstep.
//
// Encoded sRGB throughout, also to match that bake: it blurs and adds 8-bit data, so moving it into
// linear light would re-encode a wider, brighter falloff than the tile it is copying.
const HALO_FRAGMENT_SOURCE = `
  precision highp float;
  uniform sampler2D u_image;
  varying vec2 v_uv;

  void main() {
    vec4 pixel = texture2D(u_image, v_uv);
    gl_FragColor = vec4(pixel.rgb * pixel.a, pixel.a);
  }
`;

// One direction of a 9-tap separable Gaussian, sampled in the source texture's own texel units so a
// smaller octave (see GLOW_OCTAVES below) naturally reads as a wider blur relative to the image.
const BLUR_FRAGMENT_SOURCE = `
  precision highp float;
  uniform sampler2D u_image;
  uniform vec2 u_step;
  varying vec2 v_uv;

  void main() {
    vec4 sum = texture2D(u_image, v_uv) * 0.2270270270;
    sum += texture2D(u_image, v_uv + u_step * 1.0) * 0.1945945946;
    sum += texture2D(u_image, v_uv - u_step * 1.0) * 0.1945945946;
    sum += texture2D(u_image, v_uv + u_step * 2.0) * 0.1216216216;
    sum += texture2D(u_image, v_uv - u_step * 2.0) * 0.1216216216;
    sum += texture2D(u_image, v_uv + u_step * 3.0) * 0.0540540541;
    sum += texture2D(u_image, v_uv - u_step * 3.0) * 0.0540540541;
    sum += texture2D(u_image, v_uv + u_step * 4.0) * 0.0162162162;
    sum += texture2D(u_image, v_uv - u_step * 4.0) * 0.0162162162;
    gl_FragColor = sum;
  }
`;

// Matches the weights the picker-thumbnail glow gives its three blur octaves, so this control
// reads as the same idea rather than a coincidentally similar one.
const GLOW_OCTAVE_WEIGHTS = [0.45, 0.35, 0.2];
const GLOW_OCTAVE_COUNT = GLOW_OCTAVE_WEIGHTS.length;
// The thumbnail bake can afford a strength of 3.0 because it only ever composites once, offline.
// This slider is 0-1 like every other 0-100 control, so it needs its own headroom to reach a
// comparably strong halo at full value.
const GLOW_MAX_STRENGTH = 2.5;

// Halo's octaves are those same three weights, taken further down the downsample chain. The two
// leading zeros are stages that exist only so each halving is properly filtered rather than
// point-sampled from full resolution; they are blurred and then not composited.
//
// Five stages, not three and not six, chosen by measuring the alpha falloff of a thumbnail-glow
// tile and matching it. Over four bands out from the silhouette that tile
// reads 0.61 / 0.13 / 0.024 / 0.004; five stages at Halo 80 give 0.65 / 0.23 / 0.09 / 0.04 --
// the same shape with a little more reach, and headroom left above it. Six stages ran to 0.81 /
// 0.49 / 0.28 / 0.17, which is not a halo but a wash over the whole frame. Glow's own three
// octaves stop around 0.4% of image width, which is why it reads as a fringe on the silhouette
// rather than as light falling away from it.
const HALO_OCTAVE_WEIGHTS = [0, 0, 0.45, 0.35, 0.2];
const HALO_OCTAVE_COUNT = HALO_OCTAVE_WEIGHTS.length;
// The indices HALO_OCTAVE_WEIGHTS gives a non-zero weight, in order, and those weights. The
// indices bind their octave targets to u_halo0..2; the weights are baked into the composite.
const HALO_COMPOSITED = HALO_OCTAVE_WEIGHTS
  .map((weight, index) => (weight > 0 ? index : -1))
  .filter((index) => index >= 0);
const HALO_COMPOSITED_WEIGHTS = HALO_COMPOSITED.map((index) => HALO_OCTAVE_WEIGHTS[index]);
// The thumbnail glow's own strength, and legitimate here for the reason it is there: the source is
// unthresholded, so the slider's full travel lands on the same halo the tile carries. Past roughly
// 5.0 the effect saturates into a neon outline.
const HALO_MAX_STRENGTH = 3.0;

const COMPOSITE_FRAGMENT_SOURCE = `
  precision highp float;
  uniform sampler2D u_tone;
  uniform sampler2D u_bloom0;
  uniform sampler2D u_bloom1;
  uniform sampler2D u_bloom2;
  uniform sampler2D u_halo0;
  uniform sampler2D u_halo1;
  uniform sampler2D u_halo2;
  uniform float u_glow;
  uniform float u_halo;
  varying vec2 v_uv;

  ${COLOR_SPACE_FUNCTIONS}

  void main() {
    vec4 toned = texture2D(u_tone, v_uv);
    vec4 bloom0 = texture2D(u_bloom0, v_uv);
    vec4 bloom1 = texture2D(u_bloom1, v_uv);
    vec4 bloom2 = texture2D(u_bloom2, v_uv);
    vec4 bloom = bloom0 * ${GLOW_OCTAVE_WEIGHTS[0].toFixed(4)}
      + bloom1 * ${GLOW_OCTAVE_WEIGHTS[1].toFixed(4)}
      + bloom2 * ${GLOW_OCTAVE_WEIGHTS[2].toFixed(4)};
    float strength = u_glow * ${GLOW_MAX_STRENGTH.toFixed(4)};
    float alpha = clamp(max(toned.a, bloom.a * strength), 0.0, 1.0);
    // Bloom is premultiplied; added straight, the margin stored rgb * alpha (a grey ring on White).
    // toned.a / alpha is exactly 1 unless glow adds coverage, so glow 0 is bit-identical.
    vec3 color = alpha > 0.0
      ? toLinear(toned.rgb) * (toned.a / alpha) + bloom.rgb * (strength / alpha)
      : vec3(0.0);
    vec3 lit = clamp(toSrgb(color), 0.0, 1.0);

    // Halo, in encoded sRGB and premultiplied, is the thumbnail glow's three lines:
    // lit = premultiplied + halo * strength * (1 - alpha), then unpremultiply, then clip. The
    // (1 - alpha) weight is the whole point -- it confines the halo to what the render left
    // transparent, so the structure itself comes through exactly as the tracer produced it however
    // far this slider is pushed. Glow cannot make that promise; it adds over the silhouette too.
    vec4 halo = texture2D(u_halo0, v_uv) * ${HALO_COMPOSITED_WEIGHTS[0].toFixed(4)}
      + texture2D(u_halo1, v_uv) * ${HALO_COMPOSITED_WEIGHTS[1].toFixed(4)}
      + texture2D(u_halo2, v_uv) * ${HALO_COMPOSITED_WEIGHTS[2].toFixed(4)};
    float haloStrength = u_halo * ${HALO_MAX_STRENGTH.toFixed(4)};
    float margin = 1.0 - alpha;
    vec3 premultiplied = lit * alpha + halo.rgb * haloStrength * margin;
    float outAlpha = clamp(alpha + halo.a * haloStrength * margin, 0.0, 1.0);
    vec3 straight = outAlpha > 0.0 ? premultiplied / outAlpha : vec3(0.0);

    gl_FragColor = vec4(clamp(straight, 0.0, 1.0), outAlpha);
  }
`;


function createProgram(gl, vertexSource, fragmentSource) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  // Fixed locations across every program in this module, so the one quad attribute setup below
  // stays valid no matter which program is bound.
  gl.bindAttribLocation(program, 0, 'a_position');
  gl.bindAttribLocation(program, 1, 'a_uv');
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'unknown link error';
    gl.deleteProgram(program);
    throw new Error(`Image finishing shader could not be linked: ${message}`);
  }
  return program;
}


function createRenderTarget(gl, width, height) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { texture, framebuffer, width, height };
}


function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The adjusted PNG could not be encoded.'))),
      'image/png',
    );
  });
}


export function loadPostProcessImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The original render could not be opened for editing.'));
    image.src = url;
  });
}


export function createPostProcessor(canvas) {
  /*
    Two surfaces, because the file and the screen want different alpha: asking one field both
    questions loses one of them. This is that rule one layer up from `renderer.canvasBackdrop`.

    `surface` is ours, never in the document, and `premultipliedAlpha: false` so the drawing buffer
    holds exactly the straight RGBA a PNG stores; `blob()` encodes it and nothing else reads it.
    `canvas` is the element on the stage, and it is 2D, whose backing store is premultiplied.

    Displaying the WebGL buffer directly is what produced the defect: the stage scales the picture
    to fit, the browser filters a straight-alpha layer in straight-alpha space, and the margin's
    RGB is exactly where that is worst -- the composite's `premultiplied / outAlpha` drives it to
    saturation wherever coverage is near zero, so a neighbourhood the premultiply would have
    cancelled to a faint wash survives the filter at full strength. Measured on identical bytes
    scaled by the same factor: a 2D canvas differs from the `<img>` in **0** pixels
    and the straight-alpha WebGL canvas in 750, up to 19 of 255 on a picture with a weak halo and
    far more with a strong one.
  */
  const presentation = canvas?.getContext('2d');
  if (!presentation) return undefined;
  const surface = document.createElement('canvas');
  const gl = surface.getContext('webgl', {
    alpha: true,
    antialias: false,
    depth: false,
    preserveDrawingBuffer: true,
    premultipliedAlpha: false,
  });
  if (!gl) return undefined;

  const toneProgram = createProgram(gl, QUAD_VERTEX_SOURCE, TONE_FRAGMENT_SOURCE);
  const brightProgram = createProgram(gl, QUAD_VERTEX_SOURCE, BRIGHT_FRAGMENT_SOURCE);
  const haloProgram = createProgram(gl, QUAD_VERTEX_SOURCE, HALO_FRAGMENT_SOURCE);
  const blurProgram = createProgram(gl, QUAD_VERTEX_SOURCE, BLUR_FRAGMENT_SOURCE);
  const compositeProgram = createProgram(gl, QUAD_VERTEX_SOURCE, COMPOSITE_FRAGMENT_SOURCE);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 0, 0,
    1, -1, 1, 0,
    -1, 1, 0, 1,
    -1, 1, 0, 1,
    1, -1, 1, 0,
    1, 1, 1, 1,
  ]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);

  const sourceTexture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const toneLocations = Object.fromEntries(TONE_CONTROLS.map(({ id }) => [
    id, gl.getUniformLocation(toneProgram, `u_${id}`),
  ]));
  const toneImageLocation = gl.getUniformLocation(toneProgram, 'u_image');
  const toneTexelLocation = gl.getUniformLocation(toneProgram, 'u_texel');
  const brightImageLocation = gl.getUniformLocation(brightProgram, 'u_image');
  const haloImageLocation = gl.getUniformLocation(haloProgram, 'u_image');
  const blurImageLocation = gl.getUniformLocation(blurProgram, 'u_image');
  const blurStepLocation = gl.getUniformLocation(blurProgram, 'u_step');
  const compositeLocations = {
    tone: gl.getUniformLocation(compositeProgram, 'u_tone'),
    bloom0: gl.getUniformLocation(compositeProgram, 'u_bloom0'),
    bloom1: gl.getUniformLocation(compositeProgram, 'u_bloom1'),
    bloom2: gl.getUniformLocation(compositeProgram, 'u_bloom2'),
    halo0: gl.getUniformLocation(compositeProgram, 'u_halo0'),
    halo1: gl.getUniformLocation(compositeProgram, 'u_halo1'),
    halo2: gl.getUniformLocation(compositeProgram, 'u_halo2'),
    glow: gl.getUniformLocation(compositeProgram, 'u_glow'),
    halo: gl.getUniformLocation(compositeProgram, 'u_halo'),
  };

  let source;
  let toneTarget;
  let brightTarget;
  let pingTargets = [];
  let octaveTargets = [];
  let haloSourceTarget;
  let haloPingTargets = [];
  let haloOctaveTargets = [];

  function disposeTargets() {
    [
      toneTarget, brightTarget, ...pingTargets, ...octaveTargets,
      haloSourceTarget, ...haloPingTargets, ...haloOctaveTargets,
    ].forEach((target) => {
      if (!target) return;
      gl.deleteTexture(target.texture);
      gl.deleteFramebuffer(target.framebuffer);
    });
  }

  function allocateTargets(width, height) {
    disposeTargets();
    toneTarget = createRenderTarget(gl, width, height);
    let octaveWidth = Math.max(1, Math.round(width / 2));
    let octaveHeight = Math.max(1, Math.round(height / 2));
    brightTarget = createRenderTarget(gl, octaveWidth, octaveHeight);
    pingTargets = [];
    octaveTargets = [];
    for (let i = 0; i < GLOW_OCTAVE_COUNT; i += 1) {
      pingTargets.push(createRenderTarget(gl, octaveWidth, octaveHeight));
      octaveTargets.push(createRenderTarget(gl, octaveWidth, octaveHeight));
      octaveWidth = Math.max(1, Math.round(octaveWidth / 2));
      octaveHeight = Math.max(1, Math.round(octaveHeight / 2));
    }

    // Halo's own chain. It cannot share Glow's: that one starts from a bright-pass and this one
    // from the whole premultiplied image, and the two go different distances down the pyramid.
    // Five RGBA8 pairs from half resolution down cost well under a megabyte at 1024x1024.
    let haloWidth = Math.max(1, Math.round(width / 2));
    let haloHeight = Math.max(1, Math.round(height / 2));
    haloSourceTarget = createRenderTarget(gl, haloWidth, haloHeight);
    haloPingTargets = [];
    haloOctaveTargets = [];
    for (let i = 0; i < HALO_OCTAVE_COUNT; i += 1) {
      haloPingTargets.push(createRenderTarget(gl, haloWidth, haloHeight));
      haloOctaveTargets.push(createRenderTarget(gl, haloWidth, haloHeight));
      haloWidth = Math.max(1, Math.round(haloWidth / 2));
      haloHeight = Math.max(1, Math.round(haloHeight / 2));
    }
  }

  function setSource(image) {
    if (source === image) return;
    source = image;
    // Both surfaces, or the presentation copy below scales the picture instead of carrying it.
    surface.width = image.naturalWidth || image.width;
    surface.height = image.naturalHeight || image.height;
    canvas.width = surface.width;
    canvas.height = surface.height;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    allocateTargets(surface.width, surface.height);
  }

  function drawQuad() {
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // A lost context draws nothing and encodes a transparent PNG, so it refuses instead.
  const contextLost = () => new Error('Improve image lost its graphics context when the GPU was reset. '
    + 'Download the TIFF or reset the adjustments, then reload the page.');

  function render(image, value) {
    if (gl.isContextLost()) throw contextLost();
    setSource(image);
    const adjustments = normalizePostProcessing(value);

    // Pass 1: tone-map the source into a full-resolution offscreen target.
    gl.bindFramebuffer(gl.FRAMEBUFFER, toneTarget.framebuffer);
    gl.viewport(0, 0, toneTarget.width, toneTarget.height);
    gl.useProgram(toneProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.uniform1i(toneImageLocation, 0);
    gl.uniform2f(toneTexelLocation, 1 / surface.width, 1 / surface.height);
    TONE_CONTROLS.forEach(({ id }) => {
      const scale = id === 'exposure' ? 1 : 100;
      gl.uniform1f(toneLocations[id], adjustments[id] / scale);
    });
    drawQuad();

    // Pass 2: extract a premultiplied bright-pass from the toned result at half resolution.
    gl.bindFramebuffer(gl.FRAMEBUFFER, brightTarget.framebuffer);
    gl.viewport(0, 0, brightTarget.width, brightTarget.height);
    gl.useProgram(brightProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, toneTarget.texture);
    gl.uniform1i(brightImageLocation, 0);
    drawQuad();

    // Pass 3: each octave downsamples-and-blurs the previous stage in one horizontal + one
    // vertical pass, so the blur widens relative to the image as the octaves shrink.
    let previousTexture = brightTarget.texture;
    let previousWidth = brightTarget.width;
    let previousHeight = brightTarget.height;
    gl.useProgram(blurProgram);
    gl.uniform1i(blurImageLocation, 0);
    for (let i = 0; i < GLOW_OCTAVE_COUNT; i += 1) {
      const ping = pingTargets[i];
      const octave = octaveTargets[i];

      gl.bindFramebuffer(gl.FRAMEBUFFER, ping.framebuffer);
      gl.viewport(0, 0, ping.width, ping.height);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, previousTexture);
      gl.uniform2f(blurStepLocation, 1 / previousWidth, 0);
      drawQuad();

      gl.bindFramebuffer(gl.FRAMEBUFFER, octave.framebuffer);
      gl.viewport(0, 0, octave.width, octave.height);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, ping.texture);
      gl.uniform2f(blurStepLocation, 0, 1 / ping.height);
      drawQuad();

      previousTexture = octave.texture;
      previousWidth = octave.width;
      previousHeight = octave.height;
    }
    void previousHeight;

    // Passes 3b and 3c: the halo chain, skipped entirely at 0 so dragging any other slider costs
    // nothing. Its octave targets keep whatever they last held, which the composite multiplies by
    // a zero u_halo.
    if (adjustments.halo > 0) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, haloSourceTarget.framebuffer);
      gl.viewport(0, 0, haloSourceTarget.width, haloSourceTarget.height);
      gl.useProgram(haloProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, toneTarget.texture);
      gl.uniform1i(haloImageLocation, 0);
      drawQuad();

      let haloTexture = haloSourceTarget.texture;
      let haloWidth = haloSourceTarget.width;
      gl.useProgram(blurProgram);
      gl.uniform1i(blurImageLocation, 0);
      for (let i = 0; i < HALO_OCTAVE_COUNT; i += 1) {
        const ping = haloPingTargets[i];
        const octave = haloOctaveTargets[i];

        gl.bindFramebuffer(gl.FRAMEBUFFER, ping.framebuffer);
        gl.viewport(0, 0, ping.width, ping.height);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, haloTexture);
        gl.uniform2f(blurStepLocation, 1 / haloWidth, 0);
        drawQuad();

        gl.bindFramebuffer(gl.FRAMEBUFFER, octave.framebuffer);
        gl.viewport(0, 0, octave.width, octave.height);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, ping.texture);
        gl.uniform2f(blurStepLocation, 0, 1 / ping.height);
        drawQuad();

        haloTexture = octave.texture;
        haloWidth = octave.width;
      }
    }

    // Pass 4: composite the toned image with the weighted, glow-scaled octave sum onto the surface.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, surface.width, surface.height);
    gl.useProgram(compositeProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, toneTarget.texture);
    gl.uniform1i(compositeLocations.tone, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, octaveTargets[0].texture);
    gl.uniform1i(compositeLocations.bloom0, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, octaveTargets[1].texture);
    gl.uniform1i(compositeLocations.bloom1, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, octaveTargets[2].texture);
    gl.uniform1i(compositeLocations.bloom2, 3);
    HALO_COMPOSITED.forEach((octaveIndex, slot) => {
      gl.activeTexture(gl[`TEXTURE${4 + slot}`]);
      gl.bindTexture(gl.TEXTURE_2D, haloOctaveTargets[octaveIndex].texture);
      gl.uniform1i(compositeLocations[`halo${slot}`], 4 + slot);
    });
    gl.uniform1f(compositeLocations.glow, adjustments.glow / 100);
    gl.uniform1f(compositeLocations.halo, adjustments.halo / 100);
    drawQuad();

    gl.finish();
    /*
      The straight picture is finished; this is the second question, and it is the whole fix.
      `clearRect` first because `drawImage` composites source-over and this canvas still holds the
      previous adjustment -- without it a picture whose margin is nearly transparent shows the one
      before it through its own halo.
    */
    presentation.clearRect(0, 0, canvas.width, canvas.height);
    presentation.drawImage(surface, 0, 0);
    return canvas;
  }

  // `surface`, never `canvas`: the blob is the file, so it is the straight-alpha drawing buffer
  // rather than the premultiplied copy the stage is looking at.
  return {
    render,
    blob: () => (gl.isContextLost() ? Promise.reject(contextLost()) : canvasBlob(surface)),
  };
}


export function automaticPostProcessing() {
  return normalizePostProcessing({
    exposure: 0,
    highlights: 3,
    shadows: -8,
    contrast: 10,
    warmth: 0,
    saturation: 5,
    brightness: 0,
    sharpness: 5,
    tint: 0,
    glow: 0,
    halo: 0,
  });
}
