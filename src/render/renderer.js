import { assetUrl } from '../asset-base.js';
import { VIEW_TRANSFORMS, DEFAULT_VIEW_TRANSFORM } from '../capabilities.js';
import pathtraceSource from './pathtrace.wgsl?raw';
import presentSource from './present.wgsl?raw';
import denoiseSource from './denoise.wgsl?raw';
import { prepareSceneGeometry } from './scene-geometry.js';
import { BvhCache, geometrySignature } from './bvh-cache.js';
import { loadRadianceHdr, buildEnvironmentCdf } from './hdr.js';

const multiply3 = (a, b) => {
  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      out[row][column] = a[row][0] * b[0][column] + a[row][1] * b[1][column] + a[row][2] * b[2][column];
    }
  }
  return out;
};
const rotationZ = (angle) => [
  [Math.cos(angle), -Math.sin(angle), 0],
  [Math.sin(angle), Math.cos(angle), 0],
  [0, 0, 1],
];
const rotationX = (angle) => [
  [1, 0, 0],
  [0, Math.cos(angle), -Math.sin(angle)],
  [0, Math.sin(angle), Math.cos(angle)],
];

/**
 * The material table's shape, shared with `pathtrace.wgsl`'s `Params.materials`, which declares
 * `array<vec4f, MATERIAL_SLOTS * MATERIAL_VECTORS>`.  Move the two together.
 *
 * A slot is a (material, emission strength, opacity) key and one is taken per style `buildScene()`
 * builds, so 21 is the most a request can name: the protein base, `MAX_SELECTION_LAYERS` (16) and
 * the four other component styles. A slot past the table would read out of bounds as alpha 0 --
 * invisible to the camera, still casting shadows -- so `setScene()` refuses.
 */
const MATERIAL_SLOTS = 21;
const MATERIAL_VECTORS = 6;          // vec4s per material
const MATERIAL_FLOATS = MATERIAL_VECTORS * 4;
const MATERIAL_BASE = 60;            // float index the table starts at, after the scene header
const UNIFORM_BYTES = (MATERIAL_BASE + MATERIAL_SLOTS * MATERIAL_FLOATS) * 4;

/**
 * Five a-trous iterations at strides 1, 2, 4, 8, 16 reach a 65-pixel support, which is what it
 * takes to clear low-frequency blotching without a temporal history to lean on.  The count is
 * fixed rather than tunable because the ping-pong parity below is written for it.
 */
const DENOISE_ITERATIONS = 5;
// The largest per-pixel buffer `resize()` makes: the denoiser's guide, two vec4f.
const GUIDE_BYTES_PER_PIXEL = 32;
const mebibytes = (bytes) => `${Math.round(bytes / 2 ** 20)} MiB`;

/**
 * How many levels of BVH `pathtrace.wgsl` can descend, which is the size of the `array<u32, N>` in
 * both `trace()` and `anyHit()`.
 *
 * **Restated here rather than derived, and the two must move together** -- a shader constant is not
 * reachable from JavaScript and a `?raw` import is text. It is here so that a tree too deep for the
 * tracer becomes a scene note instead of geometry quietly missing from the picture; `setScene()`
 * is where that test lives.
 */
const TRAVERSAL_STACK = 40;
const FLOAT32_EXACT_INTEGERS = 2 ** 24;

const DENOISE_DEFAULTS = {
  // Colour tolerance at one sample, divided by sqrt(samples) in the shader.
  colourSigma: 1.0,
  /*
    How many local standard deviations a pixel may stand above its eight neighbours before the
    prepare pass pulls it back.  `denoise.wgsl`'s `clampOutlier()` carries the argument; this is
    the number, and 0 turns it off without turning the filter off.

    **Two, chosen from a measured sweep rather than picked.**  The sweep renders 3RGK through the
    whole delivered chain -- the filter at its scheduled strength, Filmic, 8-bit -- at 1.0, 1.5, 2,
    3 and 4, and counts a *speckle*: a covered pixel more than 12/255 above the brightest of its
    four neighbours.  On the viewport case (`spheres_refined`, 16 samples) 2.0 takes speckles from
    **1419 to 1075** and the worst single excess from **152.8 to 84.7**, while the median moves
    145.7 -> 145.5 and the p99 239.5 -> 239.4.  On the two firefly-heavy cases it
    is 4883 -> 4143 (`chrome`, 128 samples) and 5542 -> 4029 (`glass`, 64).

    The sweep is monotone, so the choice is where the cost starts.  **1.0 removes 55% of `glass`'s
    speckles and takes its p99 down 6.2/255 with the median down 0.8** -- real caustic light being
    clipped rather than noise -- and 3.0 removes 8%.  At 2.0 the largest median shift over all five
    scenes is 0.2/255, under the 2/255 run-to-run floor pictures are measured against, so the claim
    is that it takes speckles out and leaves the picture alone.
  */
  outlierSigmas: 2.0,
  // Exponent on max(dot(n0, n1), 0).  64 keeps a 10-degree normal difference at about half
  // weight, which separates neighbouring ribbon strands without hardening smooth curvature.
  normalExponent: 64.0,
  albedoSigma: 0.15,
  // The sample count 'auto' holds full strength up to. `min(1, sqrt(64 / samples))` is 1.0 at and
  // below 64 and falls from there -- 0.71 at 128, 0.25 at 1024. It approaches 0 and never arrives,
  // so `off` is the only thing that makes the filter a no-op.
  referenceSamples: 64,
};

export class Renderer {
  constructor(device, canvas, context, format) {
    this.device = device;
    this.canvas = canvas;
    this.context = context;
    this.format = format;
    this.frames = 0;
    this.width = 0;
    this.height = 0;
    /**
     * Bytes handed back by `retire()`, to read from a console while chasing memory. Nothing in the
     * product reads it and nothing may decide on it -- a texture has no `size`, so it counts
     * buffers only and is a floor rather than a total.
     */
    this.retiredBytes = 0;
    /**
     * How many rows of film one dispatch covers. 0 is the whole frame, which is what every
     * recorded hash was rendered with. `interactive-ladder.js`'s
     * `tileRowsFor()` is the one place a measurement becomes this number.
     */
    this.tileRows = 0;
    /*
      Which display transform `present.wgsl` applies, by id.

      A string rather than an index, because `capabilities.js` owns the order and this file is the
      one place that turns one into the other. Unknown ids resolve to the product's default rather
      than to the shader's first row -- `render-backend.js` is where a request's id arrives and
      `capabilities().viewTransforms` is what it is checked against.
    */
    this.viewTransform = DEFAULT_VIEW_TRANSFORM;
    this.backdrop = 2;
    /*
      **What the *canvas* composites with, which is a different question from what a download gets.**

      `backdrop` is the product's contract and `readPixels()` is what reads it: 0 is straight,
      un-premultiplied RGBA, the bytes a PNG stores. The canvas is a second consumer of the same
      display pass and it composites -- so straight alpha is exactly the wrong pair for it. Sharing
      one value between the two means the canvas has to be configured `alphaMode: 'opaque'`, and
      then the live trace's Alpha backdrop is a checkerboard painted behind a canvas that never
      lets anything through: it shows while nothing is traced and turns black the moment a frame
      lands. Three buttons that reach the CSS and not the picture, and no gate can see it -- only
      a render, looked at.

      `undefined` means "whatever `backdrop` says", so the scaffolding page (which sets `backdrop`
      to 2 for a canvas that should look like a page) is untouched.
    */
    this.canvasBackdrop = undefined;
    this.unpremultiply = true;
    this.diagnostics = [];
    // The scene-build Worker, created on the first `setScene()` and kept. `sceneWorkerFailed` is
    // sticky: a host that cannot start one will not start one on the next scene either, and
    // retrying per build would pay the failure again on every representation edit.
    this.sceneBuildWorker = null;
    this.sceneWorkerFailed = false;
    this.sceneBuildPending = new Map();
    this.sceneBuildId = 0;
    /*
      Built trees, kept by geometry signature (`render/bvh-cache.js`).

      One per renderer rather than one per module: the buffers it holds are uploaded to *this*
      device, and a page with two renderers on it would otherwise share a cache whose lifetime
      belongs to neither. It is cleared with nothing else -- there is no invalidation, because a
      signature that stops matching is simply a different key.
    */
    this.bvhCache = new BvhCache();
    // 'off' | 'auto'.  See `denoiseStrength()` for what 'auto' schedules.
    // Off by default, and promoted into the *product* at the one call site that is the product --
    // `src/render-backend.js`.  A comparison harness should still default to the raw tracer,
    // because a filter between a shading bug and the number that would reveal it is exactly what
    // must not be in the way, so every other caller either leaves this alone or sets it itself.
    this.denoiseMode = 'off';
    this.denoiseSigma = DENOISE_DEFAULTS.colourSigma;
    this.denoiseOutlierSigmas = DENOISE_DEFAULTS.outlierSigmas;
    this.denoiseNormalExponent = DENOISE_DEFAULTS.normalExponent;
    this.denoiseAlbedoSigma = DENOISE_DEFAULTS.albedoSigma;
    this.denoiseReference = DENOISE_DEFAULTS.referenceSamples;
    this.denoisedFrames = -1;
    // Whether the accumulator and the guide are known to hold zero. See `reset()`.
    this.zeroed = false;
    /*
      A failure that makes every later sample meaningless, and the one thing on this object a
      caller must read.

      A shader that did not compile, a pipeline that did not validate and an error the device
      raised outside a scope all have the same shape: **the work is dropped and nothing throws**.
      The frame count climbs, `readPixels()` succeeds, alpha reads 0 and the render reports
      Complete over a film nothing ever wrote -- measured, with the whole account in
      `diagnostics`, which no reader who is a person has. `lost` is checked once per batch by both
      samplers; this is checked in the same places for the same reason.

      Sticky and first-wins: the first failure is the one that explains the rest, and one invalid
      pipeline raises an uncaptured error per band for as long as the loop runs.
    */
    this.fatal = null;
  }

  async reportCompilation(module, label) {
    const info = await module.getCompilationInfo();
    for (const message of info.messages) {
      if (message.type === 'error') {
        const sentence = `${label}:${message.lineNum}:${message.linePos} ${message.message}`;
        this.diagnostics.push(sentence);
        // A module that did not compile makes an invalid pipeline, whose dispatches the driver
        // drops without raising anything the sampler can see. See `fatal`.
        this.fatal ??= `the ${label} shader did not compile: ${sentence}`;
      }
    }
  }

  static async create(canvas) {
    if (!navigator.gpu) throw new Error('This browser has no WebGPU.');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter is available');
    // The defaults cap one buffer at 128 MiB, which the 32-byte guide buffer reaches at exactly
    // 2048 x 2048; above that every render comes back transparent and reports success.
    // The texture side has the same failure past its default 8192: `readPixels()`'s target.
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
        maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
      },
    });
    const context = canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();
    /*
      **`premultiplied`, which is the canvas half of `canvasBackdrop` above.**

      `opaque` tells the compositor to ignore the alpha channel, so under it a transparent film
      comes out black instead of showing the page behind it. `premultiplied` is what WebGPU offers
      instead -- there is no straight-alpha canvas mode -- so `present.wgsl`'s backdrop 3 returns
      `rgb * alpha` for this path and only for this path. `readPixels()` renders into its own
      offscreen `rgba8unorm` target and never through here, so the bench, the download and every
      recorded hash are untouched by this line.
    */
    context.configure({ device, format, alphaMode: 'premultiplied' });
    const renderer = new Renderer(device, canvas, context, format);
    const info = adapter.info ?? {};
    renderer.adapterInfo = `${info.vendor ?? '?'}/${info.architecture ?? '?'} ${info.description ?? ''}`.trim();
    device.addEventListener('uncapturederror', (event) => {
      renderer.diagnostics.push(`WebGPU error: ${event.error.message}`);
      console.error(event.error.message);
      // Every command this renderer issues is a dispatch, a submit or a buffer write, and an
      // uncaptured error means the one that raised it was dropped. There is no benign one here.
      renderer.fatal ??= `the GPU rejected work this render submitted: ${event.error.message}`;
    });
    device.lost.then((info) => {
      renderer.lost = true;
      renderer.diagnostics.push(
        `WebGPU device lost after ${renderer.frames} samples, ${Math.round(performance.now())} ms: ${info.reason} ${info.message}`,
      );
    });
    return renderer;
  }

  async loadEnvironment(url) {
    const image = await loadRadianceHdr(url);
    const cdf = buildEnvironmentCdf(image);
    const { device } = this;
    this.envIntegral = cdf.integral;
    this.envWidth = image.width;
    this.envHeight = image.height;

    // One `rgba32float` map plus its two CDFs, replaced every time the lighting scene changes.
    this.retire(this.envTexture, this.envConditional, this.envMarginal);
    this.envTexture = device.createTexture({
      size: [image.width, image.height],
      format: 'rgba32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture: this.envTexture }, image.data,
      { bytesPerRow: image.width * 16 }, [image.width, image.height],
    );
    this.envConditional = device.createTexture({
      size: [image.width, image.height],
      format: 'r32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture: this.envConditional }, cdf.conditional,
      { bytesPerRow: image.width * 4 }, [image.width, image.height],
    );
    this.envMarginal = device.createTexture({
      size: [image.height, 1],
      format: 'r32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture: this.envMarginal }, cdf.marginal,
      { bytesPerRow: image.height * 4 }, [image.height, 1],
    );
    // The trace bind group names the three views retired above, so it may not be set again.
    // Load-bearing: `prepare()`'s camera path reloads the environment on a Live lighting change
    // without `setScene()`, so this flag is the only thing that rebinds.
    this.pipelinesReady = false;
  }

  /*
    Defaults to the shared asset base rather than a relative `assets/luts`.

    A relative path resolves against the page that loads this renderer, so two pages at different
    depths silently fetch from two different places and the deeper one 404s. It reports that as
    "Could not start WebGPU: Unexpected token 'f'", because a 404 body is parsed as JSON.
    `assetUrl()` is the one answer for every page.
  */
  async loadLuts(base = assetUrl('luts')) {
    const get = async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not load ${url} (HTTP ${response.status})`);
      return response;
    };
    // Sized before use: a host that answers a missing file with its index page says 200.
    const floats = async (file, count) => {
      let bytes = await (await get(`${base}/${file}`)).arrayBuffer();
      // The cube ships gzipped (431 KiB -> 81); by magic, as hdr.js, since a host may inflate it first.
      const head = new Uint8Array(bytes, 0, 2);
      if (head[0] === 0x1f && head[1] === 0x8b) {
        const inflated = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        bytes = await new Response(inflated).arrayBuffer();
      }
      if (bytes.byteLength !== count * 4) {
        throw new Error(`${base}/${file} is not the colour table this page ships`);
      }
      return new Float32Array(bytes);
    };
    const meta = await (await get(`${base}/luts.json`)).json();
    const desat = await floats(meta.desat.file, meta.desat.size ** 3 * 3);
    const look = await floats(meta.look_very_high_contrast.file, meta.look_very_high_contrast.length);
    this.lutMeta = meta;
    this.desatBuffer = this.createStorage(desat);
    this.lookBuffer = this.createStorage(look);
    this.lookLength = look.length;
    this.desatSize = meta.desat.size;
  }

  /*
    Hand back what these buffers and textures hold, once the work that still names them has landed.

    **Dropping the reference is not releasing the memory.** A `GPUBuffer` is a few bytes of JS in
    front of 96 bytes a pixel, so the collector has no reason to hurry -- and `resize()` and
    `setScene()` replace their whole set on every render, every Style and every scene edit.
    `destroy()` is the only thing that says *now*.

    Deferred rather than immediate because a submitted dispatch still reads the old accumulator.
    `onSubmittedWorkDone()` is what says that work has landed -- work submitted *after* this call is
    not waited for, which is exactly right because it is already reading the new set.

    **That last clause is the caller's obligation, and it is a use-after-destroy if it is missed.**
    A bind group naming a retired resource must never be set again, so every call site either drops
    `pipelinesReady` (`resize()`, `setScene()`, `loadEnvironment()`) or rebuilds its own groups on
    the spot (`buildDenoisePipeline()`). A lost device rejects it and has freed everything anyway.
  */
  retire(...resources) {
    const doomed = resources.filter(Boolean);
    if (!doomed.length) return;
    this.retiredBytes += doomed.reduce((sum, one) => sum + (one.size ?? 0), 0);
    this.device.queue.onSubmittedWorkDone()
      .then(() => { doomed.forEach((one) => one.destroy()); })
      .catch(() => { /* the device is gone; so is the memory */ });
  }

  createStorage(data) {
    const buffer = this.device.createBuffer({
      size: Math.max(data.byteLength, 16),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  }

  /*
    The Worker that builds the scene, created on first use and kept for the page's lifetime.

    Kept rather than spawned per scene for the same reason the device is: the live viewport
    rebuilds the scene on every representation edit, and a module Worker costs tens of milliseconds
    to start. One spawn on the first build is a cost the page pays once; one per Style in a sweep
    is not.

    A `null` return is not an error. `setScene()` falls back to building on the main thread, so a
    host without module Workers renders the same picture slowly rather than not at all.
  */
  sceneWorker() {
    if (this.sceneWorkerFailed) return null;
    if (!this.sceneBuildWorker) {
      try {
        this.sceneBuildWorker = new Worker(
          new URL('./scene-build-worker.js', import.meta.url),
          { type: 'module' },
        );
        // A Worker that fails to *load* reports it here rather than on any pending message, so
        // without this a bad chunk URL would hang `setScene()` forever instead of falling back.
        this.sceneBuildWorker.onerror = (event) => {
          this.sceneWorkerFailed = true;
          this.diagnostics.push(`scene worker failed to start: ${event.message ?? 'unknown'}`);
          const pending = [...this.sceneBuildPending.values()];
          this.sceneBuildPending.clear();
          for (const settle of pending) settle(null);
        };
        this.sceneBuildWorker.onmessage = (event) => {
          const settle = this.sceneBuildPending.get(event.data.id);
          if (!settle) return;
          this.sceneBuildPending.delete(event.data.id);
          settle(event.data);
        };
      } catch (error) {
        this.sceneWorkerFailed = true;
        this.diagnostics.push(`scene worker unavailable: ${error.message}`);
        return null;
      }
    }
    return this.sceneBuildWorker;
  }

  /*
    Interleave, bound and build the BVH -- in the Worker if there is one, on this thread if not.

    **The geometry is cloned into the Worker rather than transferred, and that is deliberate.**
    Transferring detaches the arrays on this thread, and three things still need them after the
    build: `createStorage()` uploads `vertices` and `triangles` to the GPU below, the fallback path
    here needs them if the Worker turns out not to work, and a scene's own primitive counts are
    read off it for the geometry baseline. Transferring and then transferring the same buffers back
    would recover the copy, at the price of a window in which the scene object is detached and any
    of those three reads is a `TypeError` -- and of a Worker failure taking the geometry with it,
    so there would be nothing left to fall back to.

    The one copy is the accepted cost of not requiring COOP/COEP, so it is spent where it buys the
    most: the inputs are cloned, and the four *outputs* are transferred back, which is where the
    volume is anyway -- the cartoon's BVH is 5.3 MB of nodes and 0.9 MB of order against 8.7 MB of
    input.
  */
  async prepareGeometry(scene) {
    const geometry = {
      spheres: scene.spheres,
      sphereAttributes: scene.sphereAttributes,
      cylinders: scene.cylinders,
      cylinderAttributes: scene.cylinderAttributes,
      vertices: scene.vertices,
      triangles: scene.triangles,
    };
    /*
      The cache comes first, before the Worker rather than inside it.

      A hit costs one hash of the geometry and skips the round trip, the structured clone of the
      inputs and the build itself; putting the cache in the Worker would keep the 8.7 MB clone and
      the message latency for a scene whose tree is already in hand. It also means the Worker only
      ever receives geometry it is going to build, so nothing it transfers back is aliased by the
      cache.
    */
    const signature = geometrySignature(geometry);
    const cached = this.bvhCache.get(signature);
    if (cached) {
      return prepareSceneGeometry(geometry, cached);
    }

    const worker = this.sceneWorker();
    if (worker) {
      const id = this.sceneBuildId;
      this.sceneBuildId += 1;
      const reply = await new Promise((settle) => {
        this.sceneBuildPending.set(id, settle);
        worker.postMessage({ id, geometry });
      });
      if (reply && reply.prepared) {
        this.keepBvh(signature, reply.prepared);
        return reply.prepared;
      }
      // An error message from the Worker is the *scene's* fault, not the Worker's -- it is what
      // `prepareSceneGeometry()` threw -- so re-raise it rather than quietly rebuilding it here.
      if (reply && reply.error) throw new Error(reply.error);
    }
    const prepared = prepareSceneGeometry(geometry);
    this.keepBvh(signature, prepared);
    return prepared;
  }

  /**
   * Keep the tree a build just produced.
   *
   * Only the two buffers that are a pure function of the geometry go in. `spheres` and `cylinders`
   * carry colours and material indices and are rebuilt on every scene, which is what lets a Style
   * that changed only a colour hit this at all.
   */
  keepBvh(signature, prepared) {
    this.bvhCache.set(signature, {
      nodes: prepared.nodes,
      order: prepared.order,
      nodeCount: prepared.counts.nodes,
      // Carried with the tree, because it is a property of the tree and a cache hit still has to be
      // able to answer `TRAVERSAL_STACK`'s question below.
      maxDepth: prepared.counts.maxDepth,
    });
  }

  /*
    Asynchronous because the geometry preparation above runs in a Worker, and every call site
    awaits it -- `src/render-backend.js`'s `prepare()` and `src/main.js`'s scaffolding among them.
  */
  async setScene(scene) {
    const sphereCount = scene.spheres.length / 4;
    const cylinderCount = scene.cylinders.length / 8;
    const triangleCount = scene.triangles.length / 4;
    const total = sphereCount + cylinderCount + triangleCount;
    if (total === 0) throw new Error('This composition produced no geometry to draw.');
    if (scene.materials.length > MATERIAL_SLOTS) {
      throw new Error(`This scene names ${scene.materials.length} distinct materials and the tracer `
        + `holds ${MATERIAL_SLOTS}; the styles past that would not be drawn.`);
    }

    const prepared = await this.prepareGeometry(scene);
    // Both reach `#notes` and the result: `prepare()` reads `scene.notes` after this returns.
    const report = (sentence) => {
      this.diagnostics.push(sentence);
      if (Array.isArray(scene.notes)) scene.notes.push(sentence);
    };
    /*
      **A tree deeper than the tracer's stack loses geometry silently, so it is said out loud here.**

      `pathtrace.wgsl`'s `trace()` and `anyHit()` each carry a fixed `array<u32, 40>` and simply
      decline to push past it -- there is no throw available in a compute shader and no channel to
      raise one on, so a subtree past the limit is absent from the picture with nothing anywhere
      reporting it.

      It is not close today: the deepest tree measured is **28** levels, on 1AON's 3,010,480-triangle
      cartoon, against 20 on 3RGK's and 27 on 10EC's. Depth grows with the logarithm of the
      primitive count, so the headroom is large -- but "large" is a measurement of the structures
      that have been tried, and this is a renderer people point at their own files.
    */
    // `>=`: a node at level L leaves L siblings pending, so a leaf at depth 40 is already dropped.
    if (prepared.counts.maxDepth >= TRAVERSAL_STACK) {
      // The fix is `TRAVERSAL_STACK` and the two `array<u32, N>` stacks in pathtrace.wgsl, together.
      report(
        `some geometry is not drawn: the scene's BVH is ${prepared.counts.maxDepth} levels deep`
        + ` and the tracer handles ${TRAVERSAL_STACK - 1}`,
      );
    }
    // A node's leaf start and child index are float32 in `bvh.js`, exact only up to 2^24.
    if (Math.max(total, prepared.counts.nodes) > FLOAT32_EXACT_INTEGERS) {
      report(
        `some geometry is not drawn: ${total} primitives in ${prepared.counts.nodes} BVH nodes,`
        + ` and the tracer handles ${FLOAT32_EXACT_INTEGERS}`,
      );
    }

    /*
      **The six storage buffers, held to the device's limit the way `resize()` holds its five.**

      A buffer past `min(maxStorageBufferBindingSize, maxBufferSize)` is a validation error rather
      than a throw: the `createBuffer()` returns an invalid handle, the `writeBuffer()` and every
      dispatch naming it are dropped, and the tracer renders the scene minus one whole array --
      every sphere, or the BVH the traversal walks. A plausible picture with the geometry missing,
      which is the failure this product class dies of. Refused here from the arithmetic, so the
      message can say which buffer and by how much; the error scope below is what catches the
      failures arithmetic cannot predict.

      Thrown **before** `retire()` and before the first field is written, so a scene this device
      cannot hold leaves the last one drawable rather than destroying it on the way out. A throw is
      the right channel: the two refusals above are throws, and `prepare()` keeps the picture that
      is up and says so on the status line.
    */
    const sources = {
      bvh: prepared.nodes,
      order: prepared.order,
      spheres: prepared.spheres,
      cylinders: prepared.cylinders,
      vertices: scene.vertices.length ? scene.vertices : new Float32Array(12),
      triangles: scene.triangles.length ? scene.triangles : new Uint32Array(4),
    };
    const { maxStorageBufferBindingSize, maxBufferSize } = this.device.limits;
    const limit = Math.min(maxStorageBufferBindingSize, maxBufferSize);
    for (const [name, data] of Object.entries(sources)) {
      // The size `createStorage()` will ask for, its 16-byte floor included.
      const size = Math.max(data.byteLength, 16);
      if (size > limit) {
        throw new Error(`This scene is too large for this GPU: its ${total} primitives need a `
          + `${mebibytes(size)} ${name} buffer and the device allows ${mebibytes(limit)}.`);
      }
    }

    /*
      **Under the limit is not the same as allocatable**, which is the other half of the refusal
      above and the half no check could make from arithmetic: an integrated GPU with the headroom
      on paper can still be out of memory. An allocation that fails is not a throw -- the handle
      comes back invalid, the `writeBuffer()` and every dispatch naming it are dropped, and the
      tracer renders the scene minus one whole array. `resize()` allocates under the same two
      scopes for the same reason.

      **Allocated first and checked before anything is retired**, so a scene this device cannot
      hold leaves the last one drawable: on the refusal path no field here has moved, the old
      buffers are still bound and `pipelinesReady` is still true. Awaited inside rather than left
      on a field the way `resize()` leaves `allocation`, because the decision this makes is which
      set of buffers the object keeps, and that cannot be deferred past the assignment.
    */
    this.device.pushErrorScope('out-of-memory');
    this.device.pushErrorScope('validation');
    const buffers = {
      bvh: this.createStorage(sources.bvh),
      order: this.createStorage(sources.order),
      spheres: this.createStorage(sources.spheres),
      cylinders: this.createStorage(sources.cylinders),
      vertices: this.createStorage(sources.vertices),
      triangles: this.createStorage(sources.triangles),
    };
    const uniform = this.device.createBuffer({
      size: UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const presentUniform = this.device.createBuffer({
      size: 96,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const invalid = await this.device.popErrorScope();
    const exhausted = await this.device.popErrorScope();
    const refused = invalid ?? exhausted;
    if (refused) {
      // Retired rather than destroyed on the spot: `createStorage()` has already queued a
      // `writeBuffer()` against each of these. Nothing else ever named them.
      this.retire(...Object.values(buffers), uniform, presentUniform);
      const wanted = Object.values(sources).reduce((sum, data) => sum + Math.max(data.byteLength, 16), 0);
      throw new Error(`The GPU could not hold this scene: its ${total} primitives need `
        + `${mebibytes(wanted)} of buffers (${refused.message || 'out of memory'}).`);
    }

    this.counts = prepared.counts;
    this.materials = scene.materials;
    this.retire(...Object.values(this.buffers ?? {}), this.uniform, this.presentUniform);
    this.buffers = buffers;
    this.uniform = uniform;
    this.presentUniform = presentUniform;
    this.pipelinesReady = false;
  }

  resize(width, height) {
    if (!Number.isFinite(width) || width < 1 || !Number.isFinite(height) || height < 1) {
      throw new Error(`Refusing a ${width}x${height} render target`);
    }
    const { maxStorageBufferBindingSize, maxBufferSize, maxTextureDimension2D } = this.device.limits;
    if (width > maxTextureDimension2D || height > maxTextureDimension2D) {
      throw new Error(
        `${width}x${height} is too large for this GPU: neither side may exceed ${maxTextureDimension2D} px.`,
      );
    }
    const largest = width * height * GUIDE_BYTES_PER_PIXEL;
    const limit = Math.min(maxStorageBufferBindingSize, maxBufferSize);
    if (largest > limit) {
      const side = Math.floor(Math.sqrt(limit / GUIDE_BYTES_PER_PIXEL));
      throw new Error(
        `${width}x${height} is too large for this GPU: it needs a ${mebibytes(largest)} buffer and`
        + ` the device allows ${mebibytes(limit)}. The largest square it can render is about ${side}x${side}.`,
      );
    }
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    // Retired rather than dropped: a dispatch already submitted still references these, so the
    // free waits for the queue -- but it does have to happen. See `retire()`.
    this.retire(this.accum, this.guide, this.ping, this.pong, this.denoised);
    // Under the limit is not the same as allocatable: an integrated GPU can still be out of memory.
    this.device.pushErrorScope('out-of-memory');
    this.device.pushErrorScope('validation');
    this.accum = this.device.createBuffer({
      size: width * height * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    // Two vec4f a pixel: GUIDE_BYTES_PER_PIXEL, the buffer the size check above is against.
    this.guide = this.device.createBuffer({
      size: width * height * 32,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const filtered = () => this.device.createBuffer({
      size: width * height * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.ping = filtered();
    this.pong = filtered();
    // COPY_SRC as well: `readPixelsLinear()` reads the filtered picture straight back.
    this.denoised = this.device.createBuffer({
      size: width * height * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    const validation = this.device.popErrorScope();
    const memory = this.device.popErrorScope();
    const allocation = Promise.all([validation, memory]).then(([invalid, exhausted]) => {
      const error = invalid ?? exhausted;
      if (!error) return null;
      // A failed allocation holds no size, so the next resize to this one allocates rather than
      // letting `reset()` zero buffers that do not exist.
      if (this.allocation === allocation) {
        this.width = 0;
        this.height = 0;
      }
      return `the GPU could not allocate a ${width}x${height} render (${error.message || 'out of memory'}).`;
    });
    this.allocation = allocation;
    this.frames = 0;
    this.denoisedFrames = -1;
    // WebGPU zero-initialises a new buffer, so `reset()` has nothing to do until a band lands.
    this.zeroed = true;
    this.pipelinesReady = false;
  }

  // Frees a final render's film (1.3 GiB at 3840²) once it is read back; the next resize() allocates.
  releaseFilm() {
    this.retire(this.accum, this.guide, this.ping, this.pong, this.denoised);
    this.accum = this.guide = this.ping = this.pong = this.denoised = null;
    this.width = 0;
    this.height = 0;
    this.frames = 0;
    this.zeroed = true;
    this.pipelinesReady = false;
  }

  /*
    Compiled once per device, rebound on every call: only the bind groups name buffers `resize()`
    and `setScene()` replace. Recompiling all three modules and every pipeline beside them costs
    tens of milliseconds against a frame of five (`render-backend.js`).
  */
  buildPipelines() {
    const { device } = this;
    device.pushErrorScope('validation');
    if (!this.tracePipeline) this.compilePipelines();

    this.traceBindGroup = device.createBindGroup({
      layout: this.tracePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniform } },
        { binding: 1, resource: { buffer: this.buffers.bvh } },
        { binding: 2, resource: { buffer: this.buffers.order } },
        { binding: 3, resource: { buffer: this.buffers.spheres } },
        { binding: 4, resource: { buffer: this.buffers.cylinders } },
        { binding: 5, resource: { buffer: this.buffers.vertices } },
        { binding: 6, resource: { buffer: this.buffers.triangles } },
        { binding: 7, resource: { buffer: this.accum } },
        { binding: 8, resource: this.envTexture.createView() },
        { binding: 9, resource: this.envConditional.createView() },
        { binding: 10, resource: this.envMarginal.createView() },
        { binding: 11, resource: { buffer: this.guide } },
      ],
    });

    // Its groups name buffers a resize replaces; the pipeline inside it builds once.
    this.buildDenoisePipeline(this.denoiseModule);

    // `layout: 'auto'` mints a fresh layout object per pipeline, and a bind group is only valid
    // against the one it was made from -- structurally identical is not the same object.  So the
    // readback pipeline gets its own bind group over the same five resources.
    const presentBindGroupFor = (pipeline) => device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.presentUniform } },
        { binding: 1, resource: { buffer: this.accum } },
        { binding: 2, resource: { buffer: this.desatBuffer } },
        { binding: 3, resource: { buffer: this.lookBuffer } },
        { binding: 4, resource: { buffer: this.denoised } },
      ],
    });
    this.presentBindGroup = presentBindGroupFor(this.presentPipeline);
    this.readbackBindGroup = this.readbackPipeline === this.presentPipeline
      ? this.presentBindGroup
      : presentBindGroupFor(this.readbackPipeline);
    device.popErrorScope().then((error) => {
      if (!error) return;
      this.diagnostics.push(`pipeline validation: ${error.message}`);
      this.fatal ??= `the tracer's pipelines did not validate: ${error.message}`;
    });
    this.pipelinesReady = true;
  }

  /** The compile half. Nothing here may name a buffer a resize replaces -- see `retire()`. */
  compilePipelines() {
    const { device } = this;
    const traceModule = device.createShaderModule({ code: pathtraceSource, label: 'pathtrace' });
    const presentModule = device.createShaderModule({ code: presentSource, label: 'present' });
    this.denoiseModule = device.createShaderModule({ code: denoiseSource, label: 'denoise' });

    this.reportCompilation(traceModule, 'pathtrace.wgsl');
    this.reportCompilation(presentModule, 'present.wgsl');
    this.reportCompilation(this.denoiseModule, 'denoise.wgsl');

    this.tracePipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: traceModule, entryPoint: 'main' },
    });
    const presentPipelineFor = (format) => device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: presentModule, entryPoint: 'vertexMain' },
      fragment: { module: presentModule, entryPoint: 'fragmentMain', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    this.presentPipeline = presentPipelineFor(this.format);
    // `readPixels()` renders into an `rgba8unorm` texture so the bytes it copies back are already
    // in PNG order.  `getPreferredCanvasFormat()` is `bgra8unorm` on Windows and `rgba8unorm` on
    // a software adapter, so reusing the canvas pipeline for the readback validates on one and
    // fails on every real Windows GPU -- the readback silently produces nothing while the trace
    // itself is fine.  One shader module, two attachment formats.
    this.readbackPipeline = this.format === 'rgba8unorm'
      ? this.presentPipeline
      : presentPipelineFor('rgba8unorm');
    this.diagnostics.push(`pipelines built at ${Math.round(performance.now())} ms`);
  }

  buildDenoisePipeline(module) {
    const { device } = this;
    this.retire(this.denoiseUniform);
    this.denoiseUniform = device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Compiled once; only the groups below name buffers a resize replaces.
    this.denoisePipeline ??= device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    });
    const bindGroup = (src, dst) => device.createBindGroup({
      layout: this.denoisePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.denoiseUniform } },
        { binding: 1, resource: { buffer: this.accum } },
        { binding: 2, resource: { buffer: this.guide } },
        { binding: 3, resource: { buffer: src } },
        { binding: 4, resource: { buffer: dst } },
      ],
    });
    // Five iterations starting in `ping` end in `pong`, which is why `finish` reads `pong`.
    // `prepare` ignores its source, so it reuses the pong -> ping group.
    this.denoiseGroups = {
      pingToPong: bindGroup(this.ping, this.pong),
      pongToPing: bindGroup(this.pong, this.ping),
      finish: bindGroup(this.pong, this.denoised),
    };
  }

  /**
   * How much of the filtered picture to keep.  'auto' falls as 1/sqrt(samples) past the
   * reference count, so a 16-sample interactive frame is fully filtered, 64 samples is the
   * crossover, and by 1024 the filter contributes an eighth -- on top of the colour tolerance
   * inside the shader, which has already narrowed by 4x over the same range.
   */
  denoiseStrength() {
    if (this.denoiseMode === 'off') return 0;
    return Math.min(1, Math.sqrt(this.denoiseReference / Math.max(this.frames, 1)));
  }

  denoiseActive() {
    return this.denoiseMode !== 'off' && this.frames > 0 && !this.debugStage;
  }

  writeDenoiseUniform(mode, stride) {
    const data = new ArrayBuffer(48);
    const floats = new Float32Array(data);
    const uints = new Uint32Array(data);
    uints.set([this.width, this.height, Math.max(this.frames, 1), mode], 0);
    floats.set([
      stride, this.denoiseSigma, this.denoiseNormalExponent, this.denoiseAlbedoSigma,
    ], 4);
    floats.set([
      this.denoiseStrength(), this.unpremultiply ? 1 : 0, this.denoiseOutlierSigmas, 0,
    ], 8);
    this.device.queue.writeBuffer(this.denoiseUniform, 0, data);
  }

  /**
   * Run the filter over whatever the accumulator holds now.  Called from `present()` rather than
   * from the sampling loop, so it costs one pass per displayed frame rather than one per sample,
   * and it is skipped entirely when the accumulator has not moved.
   */
  denoise() {
    if (!this.pipelinesReady || !this.denoiseActive()) return;
    if (this.denoisedFrames === this.frames) return;
    const { device } = this;
    const groups = this.denoiseGroups;
    const workgroups = [Math.ceil(this.width / 8), Math.ceil(this.height / 8)];
    const dispatch = (mode, stride, group) => {
      this.writeDenoiseUniform(mode, stride);
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.denoisePipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(workgroups[0], workgroups[1]);
      pass.end();
      device.queue.submit([encoder.finish()]);
    };
    // One submit per pass, because every pass rewrites the same uniform buffer and a single
    // command buffer would see only the last value written.
    dispatch(0, 0, groups.pongToPing);
    for (let iteration = 0; iteration < DENOISE_ITERATIONS; iteration += 1) {
      const group = iteration % 2 === 0 ? groups.pingToPong : groups.pongToPing;
      dispatch(1, 2 ** iteration, group);
    }
    dispatch(2, 0, groups.finish);
    this.denoisedFrames = this.frames;
  }

  setCamera(camera, lighting, maxBounces = 8) {
    this.camera = camera;
    this.lighting = lighting;
    this.maxBounces = maxBounces;
    this.frames = 0;
  }

  writeUniform(tileX = 0, tileY = 0) {
    const { camera, lighting } = this;
    const data = new ArrayBuffer(UNIFORM_BYTES);
    const floats = new Float32Array(data);
    const uints = new Uint32Array(data);

    const matrix = multiply3(
      multiply3(rotationZ(lighting.azimuth), rotationX(lighting.elevation)),
      rotationZ(lighting.authoredRotation),
    );
    // The split reflection branch's multiplier, the user's Strength already in it. `[0, 0, 0]` is
    // the unsplit environment, where nothing reads it.
    const reflectionScale = lighting.reflectionScale ?? [0, 0, 0];

    floats.set([...camera.position, Math.tan(camera.fov / 2)], 0);
    floats.set([...camera.right, camera.apertureRadius], 4);
    floats.set([...camera.up, camera.focusDistance], 8);
    floats.set([...camera.forward, lighting.strength], 12);
    floats.set([...matrix[0], reflectionScale[0]], 16);
    floats.set([...matrix[1], reflectionScale[1]], 20);
    floats.set([...matrix[2], reflectionScale[2]], 24);
    uints.set([this.width, this.height, this.frames, this.envWidth], 28);
    uints.set([this.envHeight, this.counts.sphereCount, this.counts.cylinderCount, this.counts.triangleCount], 32);
    floats.set([
      /*
        The reflection environment, as `resolveLighting()`'s own enum rather than a boolean.

        0 and 1 are the two values a "use reflection colour" boolean would carry, so `source` and
        `color` are byte for byte the two environments a boolean could express.
      */
      lighting.reflectionMode ?? (lighting.reflectionScale ? 1 : 0),
      this.envIntegral,
      lighting.anchor === 'camera' ? 1 : 0,
      this.maxBounces,
    ], 36);
    // `debug.w` is the sampler seed offset, which `render_settings.seed` writes and a saved
    // session carries.  0 is the product's value and a bit-exact no-op in the shader, so every
    // recorded baseline stays valid; a non-zero value draws an independent realisation of the
    // same estimator.
    floats.set([this.debugStage ?? 0, this.rayOffset ?? 1e-3, this.clampIndirect ?? 10,
      this.seed ?? 0], 40);
    // Two of the nine authored Worlds are more than "HDRI times a strength": fluorescence
    // dark-field tints the map and adds a side rim, and glass studio shows glossy and
    // transmission rays its own softbox panels.  Both are described by `resolveLighting`.
    const rim = lighting.rim ?? { from: 0, to: 1, color: [0, 0, 0] };
    floats.set([lighting.worldMode ?? 0, lighting.panelStrength ?? 0, rim.from, rim.to], 44);
    /*
      `worldTint.w` is the scene-level "something here is translucent" flag.

      It exists so `occluded()` in `pathtrace.wgsl` can stay a single trace on a scene with nothing
      below alpha 1 -- the ordinary case -- rather than reading a material per shadow hit. It also
      keeps the sampler stream identical on those scenes: the transparent test draws a `random()`,
      and a draw that only sometimes happens would shift every subsequent sample and move renders
      that have nothing to do with opacity.
    */
    /*
      Three ways a hit can be less than fully opaque, and the flag is true for any of them: the
      session's own `opacity`, `glass`'s ray-type Transparent mix, and `translucent_context`'s
      view-angle one. Transmission is deliberately **not** here -- a transmissive surface is opaque
      to a shadow ray in Cycles, which is what stops glass from lighting the room through itself,
      so a scene whose only translucency is a transmission weight still takes the single trace.
    */
    const anyTranslucent = this.materials.some((entry) => (entry.alpha ?? 1) < 1
      || (entry.rayTransparencyBase ?? 0) > 0 || (entry.rayTransparencyStep ?? 0) > 0
      || (entry.edgeOpacityBlend ?? 0) > 0);
    floats.set([...(lighting.worldTint ?? [1, 1, 1]), anyTranslucent ? 1 : 0], 48);
    /*
      `rimColour.w` is the authored World's own Z rotation, and it is here for the same kind of
      reason `worldTint.w` is: it is one float that belongs to the world, and a whole `vec4` for one
      float is a header row nobody would keep straight.

      What needs it is the reflection vector. `envRow0..2` is
      `Rz(azimuth) Rx(elevation) Rz(authored)` -- the illumination's mapping *and* the user's
      orientation -- while the reflection vector is the ray direction rotated by the user's
      orientation **alone**, the reflection graph having no Mapping node of its own.
      Handing the shader this angle lets it undo the trailing term rather than being sent a second
      three-row matrix that differs from the first in one factor.
    */
    floats.set([...rim.color, lighting.authoredRotation ?? 0], 52);
    // The band's origin in film coordinates. (0, 0) with a whole-frame dispatch is what every
    // recorded hash was rendered with, and `sample()` passes exactly that when tiling is off.
    // x is always 0: a band is full width. The shader takes an origin rather than a row because
    // **shape was measured and does not matter** -- at one dispatch budget of area, a 224 square
    // and a 48-row band are within 0.1% of each other, and only the degenerate 24-px-wide column
    // is worse (4.8% at 2048). Length is the whole effect, so the cheaper axis count wins.
    uints.set([tileX, tileY, 0, 0], 56);
    for (let index = 0; index < Math.min(this.materials.length, MATERIAL_SLOTS); index += 1) {
      const material = this.materials[index];
      const at = MATERIAL_BASE + index * MATERIAL_FLOATS;
      floats.set([material.roughness, material.metallic, material.ior, material.specularIorLevel], at);
      floats.set([material.coatWeight, material.coatRoughness, material.coatIor, material.subsurfaceWeight], at + 4);
      // Emission: the authored tint and strength, plus the flag that says the tint is really the
      // per-atom colour the shader already has in hand.
      floats.set([...(material.emissionColor ?? [1, 1, 1]), material.emissionStrength ?? 0], at + 8);
      // `alpha` is the runtime `opacity` tunable -- the third beside uniform colour and emission
      // strength -- folded into the template's authored Alpha by `loadMaterial()`.
      floats.set([material.surfaceWeight ?? 1, material.emissionFromBase ? 1 : 0,
        material.alpha ?? 1, material.transmissionWeight ?? 0], at + 12);
      /*
        The three things the authored graphs carry *beside* the Principled, all read by
        `materials.js` off the graph rather than keyed by id here.

        They are what takes the stride to six vec4s. `transmissionWeight` fits in the float
        opacity left spare; the other five do not, and a table that packed them into a bit field
        would be a table nobody could read against the authored graph.
      */
      floats.set([material.aoDistance ?? 0, material.rayTransparencyBase ?? 0,
        material.rayTransparencyStep ?? 0, material.edgeOpacityBlend ?? 0], at + 16);
      floats.set([material.edgeOpacityCentre ?? 1, material.edgeOpacityEdge ?? 1, 0, 0], at + 20);
    }
    this.device.queue.writeBuffer(this.uniform, 0, data);
  }

  /*
    `backdrop` defaults to the product's, and `present()` passes the canvas's instead. Both callers
    write the whole buffer immediately before their own pass, so there is no state to restore.
  */
  writePresentUniform(backdrop = this.backdrop) {
    const data = new ArrayBuffer(96);
    const floats = new Float32Array(data);
    const uints = new Uint32Array(data);
    uints.set([this.width, this.height, Math.max(this.frames, 1), this.desatSize], 0);
    // Floats 4-12 stay zero: Improve image is `post-processing.js`'s alone.
    floats.set([0, backdrop, 0, this.unpremultiply ? 1 : 0], 12);
    floats.set([
      this.lutMeta.log_allocation.min,
      this.lutMeta.log_allocation.max,
      this.lutMeta.uniform_allocation.max,
      this.lookLength,
    ], 16);
    const transform = Math.max(0, VIEW_TRANSFORMS.indexOf(
      VIEW_TRANSFORMS.includes(this.viewTransform) ? this.viewTransform : DEFAULT_VIEW_TRANSFORM,
    ));
    floats.set([this.denoiseActive() ? 1 : 0, transform, 0, 0], 20);
    this.device.queue.writeBuffer(this.presentUniform, 0, data);
  }

  /*
    Zero the accumulator and the guide, unless a `resize()` has just allocated them zero.

    Skipped rather than always paid because `resize()` drops `pipelinesReady`, so the next
    `sample()` resets over buffers nothing has written -- 38 ms of main thread at 1024 square and
    79 at 2048, and `renderExactly()` pays it twice. `setScene()` and `loadEnvironment()` drop the
    same flag and reallocate nothing, so theirs is not redundant and must not be swallowed.
  */
  reset() {
    this.frames = 0;
    this.denoisedFrames = -1;
    if (this.zeroed) return;
    // GPU-side, so no `new Float32Array(width * height * 4)` and nothing uploaded. Both buffers
    // carry COPY_DST, and a submit is ordered against the bands that read it like any queue write.
    const encoder = this.device.createCommandEncoder();
    encoder.clearBuffer(this.accum);
    encoder.clearBuffer(this.guide);
    this.device.queue.submit([encoder.finish()]);
    this.zeroed = true;
  }

  /*
    One sample is one dispatch, unless `tileRows` says to cut it into bands.

    **The band is how long everything else on the machine waits.** A GPU switches between
    applications at a dispatch boundary and not inside one, so a whole-frame dispatch at 1024
    square -- 313 ms measured -- is 313 ms that the compositor, the browser and every other window
    queue behind, once per sample for the length of the render. Measured with a second process
    watching: 7 fps against 56 idle, and **the submit batch does not reach it** (a batch of 32 is
    no worse than a batch of 1). The dispatch is the only lever.

    Bands rather than a grid: a row band is contiguous in the accumulator and in the film, it needs
    no second axis to schedule, and `interactive-ladder.js` sizes it from one number the app is
    already measuring. Nothing is awaited between bands -- they cost a submit each (~26 us of CPU)
    and no round trip, which is why the split is close to free.
  */
  /**
   * How many rows one dispatch covers, given `tileRows` and this target.
   *
   * **A band must be whole 8-row workgroups or rows are sampled twice**: a dispatch is rounded up
   * to a workgroup, so a band of 5 covers rows 0-7 while the next band starts at row 5, and the
   * overlap renders a picture that is wrong and looks right -- measured at 64 px, tiles 5 and 12
   * each hash differently from the whole frame at the same 24 frames and the same alpha.
   * `tileRowsFor()` floors to a multiple of 8, and `renderExactly()` refuses anything else, so
   * there is no way for a band that is not whole workgroups to reach here.
   */
  bandRows() {
    return this.tileRows > 0 ? Math.min(this.tileRows, this.height) : this.height;
  }

  /** One band of one sample, submitted. `writeUniform` carries the origin; nothing is awaited. */
  submitBand(y, band) {
    // Written before each band and read by that band alone: queue operations are ordered, so the
    // upload and the dispatch that reads it cannot cross.
    this.writeUniform(0, y);
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.tracePipeline);
    pass.setBindGroup(0, this.traceBindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.width / 8), Math.ceil(band / 8));
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    // The one thing that writes the accumulator, so the one thing that unmakes `reset()`'s skip.
    this.zeroed = false;
  }

  sample(count = 1) {
    if (!this.pipelinesReady) { this.buildPipelines(); this.reset(); }
    const rows = this.bandRows();
    for (let index = 0; index < count; index += 1) {
      for (let y = 0; y < this.height; y += rows) {
        this.submitBand(y, Math.min(rows, this.height - y));
      }
      this.frames += 1;
    }
    return this.frames;
  }

  /*
    The final render's sampler: the same bands, with the queue drained every `drainEvery` of them.

    **This exists because a cancel flag checked at CPU speed is not a cancel.** `sample()` submits a
    whole batch without awaiting, so the CPU races through it in a few milliseconds and what Stop
    then waits for is the GPU draining work already queued -- which WebGPU cannot recall. Measured
    without the drain: **1.1 s to honour Stop on a 1.18 s sample and 7.3 s on a 10 s one**, which
    is one whole sample in each case, exactly as that explanation predicts.

    So the queue is bounded in *time* instead. `bandsPerDrain()` sizes the group from the same
    throughput estimate everything else here uses, and each drain costs one round trip -- a
    measured 2.5-5 ms bubble -- against `STOP_LATENCY_MS` of work.

    `until` abandons the sample rather than finishing it, which is only safe because the caller
    throws the picture away: a frame the accumulator holds for some bands and not others divides by
    one count across all of them, and that is a horizontal seam. `traceOnce()` returns
    `{ cancelled: true }` and the trace behind it re-prepares.
  */
  async sampleDraining(count = 1, { until, drainEvery = 0 } = {}) {
    if (!this.pipelinesReady) { this.buildPipelines(); this.reset(); }
    const rows = this.bandRows();
    for (let index = 0; index < count; index += 1) {
      if (until && until()) return this.frames;
      let since = 0;
      for (let y = 0; y < this.height; y += rows) {
        if (until && until()) return this.frames;
        this.submitBand(y, Math.min(rows, this.height - y));
        since += 1;
        if (drainEvery > 0 && since >= drainEvery) {
          since = 0;
          // eslint-disable-next-line no-await-in-loop
          await this.device.queue.onSubmittedWorkDone();
        }
      }
      this.frames += 1;
    }
    return this.frames;
  }

  present() {
    if (!this.pipelinesReady) return;
    this.denoise();
    this.writePresentUniform(this.canvasBackdrop ?? this.backdrop);
    const encoder = this.device.createCommandEncoder();
    this.encodePresent(encoder, this.context.getCurrentTexture().createView());
    this.device.queue.submit([encoder.finish()]);
  }

  encodePresent(encoder, view, pipeline = this.presentPipeline, bindGroup = this.presentBindGroup) {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  /**
   * Run the display pass into an offscreen target and copy it back.  This is what a download
   * reads, rather than the canvas: a WebGPU canvas image is only guaranteed until the next
   * `getCurrentTexture`, and headless browsers do not composite one at all.
   */
  async readPixels() {
    if (!this.pipelinesReady) throw new Error('Nothing has been rendered yet');
    const { width, height } = this;
    this.denoise();
    this.writePresentUniform();
    // An invalid pass still maps a valid, never-written staging buffer: zeros that read as success.
    // Out-of-memory is scoped too, or it reaches `uncapturederror` and sets the sticky `fatal`.
    this.device.pushErrorScope('out-of-memory');
    this.device.pushErrorScope('validation');
    const target = this.device.createTexture({
      size: [width, height], format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    /*
      **The row stride is padded and the rows are cropped back out.**

      `copyTextureToBuffer` requires a 256-byte aligned row -- a multiple of 64 pixels -- which is
      a WebGPU rule and not a property of the picture. The product promises that *the picture on
      screen is the picture you download*, and a responsive stage cannot keep that promise while
      the download refuses 1000 px and accepts 1024.

      So the buffer is allocated at the padded stride, the copy is told about it, and the packed
      image is rebuilt row by row. A width that is already aligned pads by zero and takes a single
      `slice()`, so the bench's 512 px readback is untouched.
    */
    const packedRow = width * 4;
    const paddedRow = Math.ceil(packedRow / 256) * 256;
    const staging = this.device.createBuffer({
      size: paddedRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = this.device.createCommandEncoder();
    this.encodePresent(encoder, target.createView(), this.readbackPipeline, this.readbackBindGroup);
    encoder.copyTextureToBuffer(
      { texture: target }, { buffer: staging, bytesPerRow: paddedRow, rowsPerImage: height },
      [width, height],
    );
    this.device.queue.submit([encoder.finish()]);
    const [invalid, exhausted] = await Promise.all([this.device.popErrorScope(), this.device.popErrorScope()]);
    const refused = invalid ?? exhausted;
    if (refused) {
      staging.destroy();
      target.destroy();
      throw new Error(`The ${width}x${height} picture could not be read back: ${refused.message || 'out of memory'}`);
    }
    await staging.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(staging.getMappedRange());
    let pixels;
    if (paddedRow === packedRow) {
      pixels = mapped.slice();
    } else {
      pixels = new Uint8Array(packedRow * height);
      for (let row = 0; row < height; row += 1) {
        pixels.set(mapped.subarray(row * paddedRow, row * paddedRow + packedRow), row * packedRow);
      }
    }
    staging.unmap();
    staging.destroy();
    target.destroy();
    return { width, height, pixels };
  }

  /**
   * The picture before the view transform: scene-linear, unclamped, straight alpha, as float32 RGBA.
   * The download's master. Read off the same buffer `present.wgsl`'s `readPixel()` reads, with
   * the same arithmetic, so it is that picture one step earlier rather than a second one.
   */
  async readPixelsLinear() {
    if (!this.pipelinesReady) throw new Error('Nothing has been rendered yet');
    const { width, height, device } = this;
    this.denoise();
    const denoised = this.denoiseActive();
    const source = denoised ? this.denoised : this.accum;
    // Scoped as readPixels() is: a refused master fails this read, not the renderer.
    device.pushErrorScope('out-of-memory');
    device.pushErrorScope('validation');
    const staging = device.createBuffer({
      size: width * height * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(source, 0, staging, 0, width * height * 16);
    device.queue.submit([encoder.finish()]);
    const [invalid, exhausted] = await Promise.all([device.popErrorScope(), device.popErrorScope()]);
    const refused = invalid ?? exhausted;
    if (refused) {
      staging.destroy();
      throw new Error(`The ${width}x${height} master could not be read back: ${refused.message || 'out of memory'}`);
    }
    await staging.mapAsync(GPUMapMode.READ);
    const pixels = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();
    const frames = Math.max(this.frames, 1);
    const finite = (value) => (value > -3.4e38 && value < 3.4e38 ? value : 0);
    for (let at = 0; at < pixels.length; at += 4) {
      let r = pixels[at];
      let g = pixels[at + 1];
      let b = pixels[at + 2];
      let alpha;
      if (denoised) {
        alpha = Math.min(Math.max(pixels[at + 3], 0), 1);
      } else {
        alpha = Math.min(Math.max(pixels[at + 3] / frames, 0), 1);
        r /= frames;
        g /= frames;
        b /= frames;
        if (this.unpremultiply && alpha > 1e-4) {
          r /= alpha;
          g /= alpha;
          b /= alpha;
        }
      }
      pixels[at] = finite(r);
      pixels[at + 1] = finite(g);
      pixels[at + 2] = finite(b);
      pixels[at + 3] = finite(alpha);
    }
    return { width, height, pixels };
  }
}
