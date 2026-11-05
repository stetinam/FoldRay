// Edge-avoiding a-trous wavelet denoiser, guided by the albedo and normal the tracer writes for
// the primary hit.  This is the browser's stand-in for what Cycles gets from OpenImageDenoise,
// and it is deliberately a different algorithm: OIDN is a trained network shipping tens of
// megabytes, and this is five separable passes of a 5x5 b3-spline kernel with edge stopping.
// Dammertz et al., "Edge-Avoiding A-Trous Wavelet Transform for Fast Global Illumination
// Filtering" (2010), with SVGF's normal and albedo weights.
//
// Two things make it honest about how much it is doing:
//
//   * The colour tolerance is divided by sqrt(samples).  Monte Carlo noise falls as 1/sqrt(N),
//     so the filter's idea of "these two pixels differ only because of noise" shrinks at the
//     same rate.  A converged image has almost no pixel pairs inside the tolerance, so almost
//     nothing is merged.
//   * `finish` blends the filtered result back over the raw one by `strength`, which the app
//     schedules against the sample count.  At strength 0 the output is bit-identical to the
//     undenoised path, which is what makes the comparison fair.
//
// **The prepare pass clamps outliers, and it is the one thing the a-trous part provably cannot
// do.**  Measured at 256 spp: the filter takes 33-40% of the grain out and moves the p99, the
// p99.9 and the maximum by 0.1, 0.0 and 0.0 of 255.  That is by construction rather than by
// accident -- the colour edge-stopping term exists to preserve a pixel that differs sharply from
// its neighbours, and a firefly is exactly that.  It also gets
// *perceptually* worse, because smoothing the surrounding grain leaves the speckles standing alone.
// So the clamp runs before any of it, and `clampOutlier()` below says how.
//
// Alpha is never filtered.  It is coverage, and coverage is the silhouette: blurring it would
// eat exactly the edge quality the analytic primitives exist to give.  Colour is filtered
// unpremultiplied, so a half-covered edge pixel carries the colour of the geometry rather than
// a value darkened towards the transparent film.

struct Denoise {
  dims: vec4u,      // width, height, accumulated frames, mode (0 prepare, 1 a-trous, 2 finish)
  params: vec4f,    // stride, colour sigma at 1 spp, normal exponent, albedo sigma
  control: vec4f,   // strength, unpremultiply, outlier sigmas, _
};

@group(0) @binding(0) var<uniform> dn: Denoise;
@group(0) @binding(1) var<storage, read> accum: array<vec4f>;
@group(0) @binding(2) var<storage, read> guide: array<vec4f>;
@group(0) @binding(3) var<storage, read> src: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> dst: array<vec4f>;

/** The raw picture as `present.wgsl` would read it: averaged, and unpremultiplied on request. */
fn rawPixel(index: u32) -> vec4f {
  let frames = max(f32(dn.dims.z), 1.0);
  let record = accum[index];
  let alpha = clamp(record.w / frames, 0.0, 1.0);
  var linear = record.xyz / frames;
  if (dn.control.y > 0.5 && alpha > 1e-4) { linear = linear / alpha; }
  return vec4f(linear, alpha);
}

fn guideAlbedo(index: u32) -> vec3f {
  let record = guide[index * 2u];
  return record.xyz / max(record.w, 1.0);
}

fn guideNormal(index: u32) -> vec3f {
  let record = guide[index * 2u + 1u];
  let length2 = dot(record.xyz, record.xyz);
  if (length2 < 1e-12) { return vec3f(0.0, 0.0, 0.0); }
  return record.xyz * inverseSqrt(length2);
}

/** b3-spline [1, 4, 6, 4, 1] / 16, which is the kernel the a-trous scheme dilates. */
fn kernelWeight(offset: i32) -> f32 {
  let distance = abs(offset);
  if (distance == 0) { return 0.375; }
  if (distance == 1) { return 0.25; }
  return 0.0625;
}

// ITU-R BT.709 luma weights.
const LUMA = vec3f(0.2126, 0.7152, 0.0722);

/*
  Neighbourhood variance clipping, over the eight neighbours and never the pixel itself.

  Salvi, "An Excursion in Temporal Supersampling" (GDC 2016), which put a mean-and-deviation box in
  place of Karis's colour-extent clip ("High Quality Temporal Supersampling", SIGGRAPH 2014
  Advances in Real-Time Rendering); both bound a reprojected history against the current frame's
  local statistics.  The arithmetic is the same and the thing being bounded is different: here it
  is *this* pixel's accumulated mean against what its neighbours accumulated -- a local median
  with a statistic that says how wide "local" is instead of assuming it.

  **The centre is excluded from the mean and the deviation**, which the temporal-AA form does not
  do and which matters here: a lone firefly is the sample being tested, so letting it into its own
  bound is how it survives.  Nine taps, eight of them counted.

  Two properties make this safe on a real picture rather than merely effective on noise:

  * **A neighbourhood with real detail in it clamps nothing.**  A specular glint running across
    several pixels carries a large `sigma`, so the bound sits far above the centre; a spike in a
    smooth region carries a small one.  A fixed ratio against the median cannot tell those apart,
    which is why the deviation is measured rather than assumed.
  * **It tightens as the picture converges, which is where the tail is.**  A single huge sample
    contributes `L / N` to the accumulated mean, so its excess over the neighbourhood falls as
    `1 / N` while the neighbourhood's own noise falls as `1 / sqrt(N)`.  At 1 spp everything is an
    outlier and `sigma` is enormous, so this does nothing and the a-trous passes do the work; by
    256 the background has converged and a firefly stands alone, which is exactly the regime the
    percentiles above were measured in.

  The scale is applied to the whole `rgb`, so it takes energy out and leaves the chromaticity
  alone -- a clamped firefly keeps the colour of whatever it was reflecting.
*/
fn clampOutlier(x: i32, y: i32, centre: vec4f) -> vec3f {
  let sigmas = dn.control.z;
  if (sigmas <= 0.0) { return centre.xyz; }
  let width = i32(dn.dims.x);
  let height = i32(dn.dims.y);
  var sum = 0.0;
  var sumSquares = 0.0;
  var count = 0.0;
  for (var dy = -1; dy <= 1; dy = dy + 1) {
    for (var dx = -1; dx <= 1; dx = dx + 1) {
      if (dx == 0 && dy == 0) { continue; }
      let sx = x + dx;
      let sy = y + dy;
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) { continue; }
      let neighbour = rawPixel(u32(sy * width + sx));
      // The transparent film is not a dark neighbour.  Counting an uncovered pixel as luminance 0
      // would pull the bound down all along a silhouette and clamp the edge of every bright
      // object, which is the one place this must not touch.
      if (neighbour.w <= 1e-4) { continue; }
      let luma = dot(neighbour.xyz, LUMA);
      sum = sum + luma;
      sumSquares = sumSquares + luma * luma;
      count = count + 1.0;
    }
  }
  // Fewer than three covered neighbours is not a neighbourhood -- a lone speck or a corner -- and
  // a deviation taken from one or two samples is noise about noise.
  if (count < 3.0) { return centre.xyz; }
  let mean = sum / count;
  let deviation = sqrt(max(sumSquares / count - mean * mean, 0.0));
  let limit = mean + sigmas * deviation;
  let luma = dot(centre.xyz, LUMA);
  if (luma <= limit || luma <= 1e-6) { return centre.xyz; }
  return centre.xyz * (limit / luma);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let width = i32(dn.dims.x);
  let height = i32(dn.dims.y);
  if (i32(id.x) >= width || i32(id.y) >= height) { return; }
  let x = i32(id.x);
  let y = i32(id.y);
  let pixel = u32(y * width + x);
  let mode = dn.dims.w;

  if (mode == 0u) {
    let raw = rawPixel(pixel);
    // Uncovered pixels carry no radiance and have nothing to clamp.  Alpha is passed through
    // untouched here as it is everywhere else: it is coverage, and coverage is the silhouette.
    if (raw.w <= 1e-4) {
      dst[pixel] = raw;
      return;
    }
    dst[pixel] = vec4f(clampOutlier(x, y, raw), raw.w);
    return;
  }

  if (mode == 2u) {
    let raw = rawPixel(pixel);
    let filtered = src[pixel];
    dst[pixel] = vec4f(mix(raw.xyz, filtered.xyz, dn.control.x), raw.w);
    return;
  }

  let centre = src[pixel];
  // Uncovered pixels are the transparent film.  They carry no radiance and no guide, and
  // pulling them into the average is what would bleed the backdrop into the silhouette.
  if (centre.w <= 1e-4) {
    dst[pixel] = centre;
    return;
  }

  let stride = i32(dn.params.x);
  let colourSigma = dn.params.y * inverseSqrt(max(f32(dn.dims.z), 1.0));
  let colourDenominator = colourSigma * colourSigma + 1e-8;
  let albedoDenominator = dn.params.w * dn.params.w + 1e-8;
  let centreNormal = guideNormal(pixel);
  let centreAlbedo = guideAlbedo(pixel);

  var sum = vec3f(0.0);
  var weightSum = 0.0;
  for (var dy = -2; dy <= 2; dy = dy + 1) {
    for (var dx = -2; dx <= 2; dx = dx + 1) {
      let sx = clamp(x + dx * stride, 0, width - 1);
      let sy = clamp(y + dy * stride, 0, height - 1);
      let neighbour = u32(sy * width + sx);
      let sample = src[neighbour];
      if (sample.w <= 1e-4) { continue; }

      let colourDelta = centre.xyz - sample.xyz;
      let colourWeight = exp(-dot(colourDelta, colourDelta) / colourDenominator);
      let normalWeight = pow(max(dot(centreNormal, guideNormal(neighbour)), 0.0), dn.params.z);
      let albedoDelta = centreAlbedo - guideAlbedo(neighbour);
      let albedoWeight = exp(-dot(albedoDelta, albedoDelta) / albedoDenominator);

      let weight = kernelWeight(dx) * kernelWeight(dy) * colourWeight * normalWeight * albedoWeight;
      sum = sum + sample.xyz * weight;
      weightSum = weightSum + weight;
    }
  }

  // weightSum always includes the centre tap at full kernel weight, so the fallback is only
  // reached if every weight underflows.
  if (weightSum > 1e-8) {
    dst[pixel] = vec4f(sum / weightSum, centre.w);
  } else {
    dst[pixel] = centre;
  }
}
