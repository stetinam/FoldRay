// Progressive path tracer for one FoldRay session.
//
// It follows Cycles' conventions:
//   * analytic spheres and capped cylinders for ball-and-stick, triangles for the ribbon;
//   * a Principled-style dielectric or conductor with a coat layer, a rough-dielectric
//     transmission lobe, and the emission the two glowing templates carry, all read from the
//     authored material graphs in `public/assets/materials/`;
//   * the split world -- diffuse paths see the HDRI, glossy and transmission paths see the
//     chosen reflection environment (source, colour, studio panels or grid) -- reproduced
//     through the path's own glossy flag, the way `Light Path > Is Glossy Ray` does;
//   * a thin-lens camera whose aperture is Cycles' (lens_mm / 1000) / (2 * fstop);
//   * transparent film, so a camera ray that escapes contributes no colour and no alpha.

struct Params {
  camPos: vec4f,     // xyz position, w tan(fov/2)
  camRight: vec4f,   // xyz right,    w aperture radius
  camUp: vec4f,      // xyz up,       w focus distance
  camForward: vec4f, // xyz forward,  w environment strength
  // The three `w` are the split reflection branch's own multiplier, which `resolveLighting()`
  // builds: the user's Strength alone for `studio` and `grid`, and for `color` that times the
  // colour, because there the environment *is* a constant colour.
  envRow0: vec4f,    // env rotation row 0, w reflection scale r
  envRow1: vec4f,    // env rotation row 1, w reflection scale g
  envRow2: vec4f,    // env rotation row 2, w reflection scale b
  dims: vec4u,       // width, height, frame, env width
  counts: vec4u,     // env height, spheres, cylinders, triangles
  // `flags.x` is the reflection environment as a small enum -- 0 source, 1 colour, 2 studio,
  // 3 grid.
  flags: vec4f,      // reflection mode, env integral, camera anchor, max bounces
  debug: vec4f,      // debug stage, ray offset in angstroms, indirect clamp, sampler seed
  world: vec4f,      // world mode, panel strength, rim from, rim to
  // w is the scene-level "some material is below alpha 1" flag, which is what lets
  // `occluded()` stay a single trace on a scene with nothing translucent.  It rides here because
  // it is a property of the whole scene rather than of one hit, and because `debug.w` is spoken
  // for.
  worldTint: vec4f,  // xyz multiply on the HDRI colour, w any material translucent
  // `rimColour.w` is the authored World's own Z rotation, riding a spare float the way
  // `worldTint.w` does.  `reflectionVector()` is what needs it: `envRow0..2` carries the
  // illumination's mapping *and* the user's orientation, and the reflection graph takes the second
  // alone -- so the shader undoes the trailing term rather than being sent a second matrix that
  // differs from the first in one factor.
  rimColour: vec4f,  // xyz added rim colour, w authored world rotation
  // The patch of film this dispatch covers, so one sample can be several short dispatches instead
  // of one long one.  A GPU switches to another application *between* dispatches and not inside
  // one, so the length of a single dispatch is how long everything else on the machine waits --
  // measured, 313 ms at 1024 square, and another process dropped to 7 fps for the whole render.
  // A whole-frame dispatch passes (0, 0).
  tile: vec4u,       // origin x, origin y, unused, unused
  // Six vec4s per material, 21 slots.  `MATERIAL_SLOTS` / `MATERIAL_VECTORS` in
  // `renderer.js` write it; move the two together.
  //   0: roughness, metallic, ior, specular level
  //   1: coat weight, coat roughness, coat ior, subsurface weight
  //   2: emission colour rgb, emission strength
  //   3: surface weight, emission-tint-is-the-base-colour, alpha, transmission weight
  //   4: ao distance, ray transparency base, ray transparency step, edge opacity blend
  //   5: edge opacity at the centre, edge opacity at the silhouette, unused, unused
  materials: array<vec4f, 126>,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> bvhNodes: array<vec4f>;
@group(0) @binding(2) var<storage, read> primOrder: array<u32>;
@group(0) @binding(3) var<storage, read> spheres: array<vec4f>;     // stride 2: (centre, radius), (colour, material)
@group(0) @binding(4) var<storage, read> cylinders: array<vec4f>;   // stride 3: (p0, radiusA), (p1, radiusB), (colour, material)
@group(0) @binding(5) var<storage, read> vertices: array<vec4f>;    // stride 3: position, normal, colour
@group(0) @binding(6) var<storage, read> triangles: array<vec4u>;   // i0, i1, i2, material
@group(0) @binding(7) var<storage, read_write> accum: array<vec4f>;
@group(0) @binding(8) var envMap: texture_2d<f32>;
@group(0) @binding(9) var envConditional: texture_2d<f32>;
@group(0) @binding(10) var envMarginal: texture_2d<f32>;
// Denoiser guides, stride 2 per pixel: (albedo sum, covered-sample count) and (normal sum, _).
// Both are summed over covered samples only, so dividing by the count gives the mean over the
// samples that actually hit something.  Written for the primary hit alone -- a guide describes
// what the eye sees at this pixel, not where the path went afterwards.
@group(0) @binding(11) var<storage, read_write> guide: array<vec4f>;

const PI = 3.14159265358979;
const INV_PI = 0.3183098861837907;
const EPSILON = 1e-4;

// Cycles counts a pass through a transparent surface on its own budget -- Light Paths >
// Transparent > Max Bounces, whose default is 8 and which nothing here overrides -- and not
// against the diffuse and glossy limit `params.flags.w` carries.  Sharing one budget would
// truncate every path through a dense model at half alpha and render it too dark, which is a
// plausible picture rather than a visible failure.
const MAX_TRANSPARENT_BOUNCES = 8u;

// ---------------------------------------------------------------- random numbers

var<private> rngState: u32;

// PCG (O'Neill, pcg-random.org) in the one-round hash form of Jarzynski & Olano, "Hash Functions
// for GPU Rendering" (JCGT 9(3), 2020).
fn pcg(state: ptr<private, u32>) -> u32 {
  *state = *state * 747796405u + 2891336453u;
  let word = ((*state >> ((*state >> 28u) + 4u)) ^ *state) * 277803737u;
  return (word >> 22u) ^ word;
}
fn random() -> f32 { return f32(pcg(&rngState)) * 2.3283064365386963e-10; }

// ---------------------------------------------------------------- intersection

struct Hit {
  t: f32,
  normal: vec3f,
  colour: vec3f,
  material: u32,
  hit: bool,
  /*
    Where the *smooth* surface is, relative to where the flat triangle is.

    A swept panel is triangles carrying interpolated vertex normals, so it shades as though it were
    curved while it self-shadows as though it were flat.  At grazing light every facet's neighbour
    stands proud of its own plane, blocks the shadow ray, and lays one dark tooth per row along the
    terminator -- the comb down a helix or an arrowhead that no amount of sampling removes, because
    it is not noise.  Zero for the analytic primitives, which have no facets to disagree with.

    `smoothOffset()` fills it and says how.
  */
  offset: vec3f,
  // Whether a triangle was hit from the side its vertex normals face, decided by the face and not
  // the shading normal, which turns away from the ray at a silhouette that was still hit outside.
  outside: bool,
};

fn intersectSphere(origin: vec3f, direction: vec3f, tMax: f32, index: u32, hit: ptr<function, Hit>) {
  let record = spheres[index * 2u];
  let centre = record.xyz;
  let radius = record.w;
  let oc = origin - centre;
  /*
    Haines et al., "Precision Improvements for Ray/Sphere Intersection", Ray Tracing Gems ch. 7.
    From a camera 1000 A away, `b * b - c` cancels two numbers near 1e6 whose float32 step is 0.06 A,
    and a float32 `normalize()` is not unit length: the hit lands up to tenths of an angstrom inside
    its sphere, past the ray offset, so its own shadow ray is occluded -- concentric dark rings, one
    per depth band, on a large assembly. The discriminant from the perpendicular and the near root
    as `c / q` hold it to ~1e-4 A.
  */
  let a = dot(direction, direction);
  let b = dot(oc, direction);
  let c = dot(oc, oc) - radius * radius;
  let perp = oc - (b / a) * direction;
  let discriminant = a * (radius * radius - dot(perp, perp));
  if (discriminant < 0.0) { return; }
  let q = -b - select(1.0, -1.0, b < 0.0) * sqrt(discriminant);
  if (q == 0.0) { return; }
  let r0 = c / q;
  let r1 = q / a;
  var t = min(r0, r1);
  if (t < EPSILON) { t = max(r0, r1); }
  if (t < EPSILON || t > tMax) { return; }
  let attributes = spheres[index * 2u + 1u];
  (*hit).t = t;
  (*hit).normal = normalize(oc + direction * t);
  (*hit).colour = attributes.xyz;
  (*hit).material = u32(attributes.w);
  (*hit).hit = true;
  // Exact, so its shading normal is its surface. Cleared rather than left, or a triangle this
  // sphere is in front of would hand it an offset belonging to a facet somewhere else.
  (*hit).offset = vec3f(0.0);
}

/**
 * A flat-capped tube whose radius runs **linearly** from `first.w` at `a` to `second.w` at `b`.
 *
 * Equal radii is a plain cylinder, and every line below is written so that it is
 * *bit*-identical there rather than merely equivalent: `taper` is then exactly `0.0`, so
 * `radiusAt - taper * hD` is `radiusAt`, `qa - taper*taper*hD*hD` is `qa` (subtracting a true zero),
 * and the normal's `- taper * w` term is the zero vector. Every stick, base stem, rim and helix rod
 * in the app therefore renders to the same bytes; only a rail whose cord tapers can move.
 *
 * The second radius exists for `geom/rails.js`'s `pushRod()`, which needs the cone *tangent* to two
 * joint spheres of different sizes -- a chord between their centres is tangent to neither, and the
 * ledge that leaves is a ring of light at every joint down a tapering cord. It costs no memory: the
 * record's eighth float is otherwise padding.
 *
 * The routine is the standard quadratic for a cone of revolution -- substitute the ray into
 * `|p - w (p.w)|^2 = r(h)^2` with `r` affine in `h` -- and the normal is that surface's own
 * gradient.
 */
fn intersectCylinder(origin: vec3f, direction: vec3f, tMax: f32, index: u32, hit: ptr<function, Hit>) {
  let first = cylinders[index * 3u];
  let second = cylinders[index * 3u + 1u];
  let a = first.xyz;
  let radius = first.w;
  let radiusB = second.w;
  let b = second.xyz;
  let axis = b - a;
  let axisLength = length(axis);
  if (axisLength < 1e-8) { return; }
  let w = axis / axisLength;
  // How fast the radius grows per unit of axis, negated: `r(h) = radius - taper * h`. The sign is
  // the one the normal wants, so it is carried this way round rather than flipped twice.
  let taper = (radius - radiusB) / axisLength;
  let oc = origin - a;
  let hD = dot(direction, w);
  let hO = dot(oc, w);
  let dPerp = direction - w * hD;
  let ocPerp = oc - w * hO;
  // The radius at the ray's own origin height, so the quadratic is in `t` alone.
  let radiusAt = radius - taper * hO;
  let radiusRate = -taper * hD;
  let qa = dot(dPerp, dPerp) - radiusRate * radiusRate;
  let qb = 2.0 * dot(dPerp, ocPerp) - 2.0 * radiusAt * radiusRate;
  let qc = dot(ocPerp, ocPerp) - radiusAt * radiusAt;
  var best = tMax;
  var bestNormal = vec3f(0.0);
  var found = false;
  if (abs(qa) > 1e-12) {
    let discriminant = qb * qb - 4.0 * qa * qc;
    if (discriminant >= 0.0) {
      let root = sqrt(discriminant);
      for (var side = 0; side < 2; side = side + 1) {
        let t = select((-qb + root) / (2.0 * qa), (-qb - root) / (2.0 * qa), side == 0);
        if (t > EPSILON && t < best) {
          // `dot(oc + direction * t, w)` and not `hO + hD * t`: the two agree to within a rounding
          // step, and a rounding step here is a byte-identity baseline moving on every cylinder in
          // the app for no reason. The same care is why the normal below is not a double normalize.
          let height = dot(oc + direction * t, w);
          if (height >= 0.0 && height <= axisLength) {
            let radiusHere = radius - taper * height;
            let point = oc + direction * t;
            let perp = point - w * height;
            // A cone's own sheet only: the mirror sheet past the apex solves the same quadratic
            // with a negative radius, and taking it would draw a tube where there is none. The
            // height test cannot see that, so the radius is tested directly.
            if (radiusHere >= 0.0) {
              best = t;
              // The surface's own gradient. `|perp|` is `radiusHere` on the surface, so the axial
              // term is `radiusHere * taper` and no second square root is needed -- and with
              // `taper` a true zero it is the zero vector, leaving `normalize(perp)` untouched.
              bestNormal = normalize(perp + (radiusHere * taper) * w);
              found = true;
            }
          }
        }
      }
    }
  }
  // Flat caps, so a bond that pokes out of its atom sphere still closes. Each takes its own end's
  // radius, which is the whole of the difference a cone makes here.
  let denominator = hD;
  if (abs(denominator) > 1e-9) {
    for (var cap = 0; cap < 2; cap = cap + 1) {
      let planePoint = select(b, a, cap == 0);
      let capRadius = select(radiusB, radius, cap == 0);
      let t = dot(planePoint - origin, w) / denominator;
      if (t > EPSILON && t < best) {
        let offset = origin + direction * t - planePoint;
        if (dot(offset, offset) <= capRadius * capRadius) {
          best = t;
          bestNormal = select(w, -w, cap == 0);
          found = true;
        }
      }
    }
  }
  if (!found) { return; }
  let attributes = cylinders[index * 3u + 2u];
  (*hit).t = best;
  (*hit).normal = bestNormal;
  (*hit).colour = attributes.xyz;
  (*hit).material = u32(attributes.w);
  (*hit).hit = true;
  (*hit).offset = vec3f(0.0);
}

/**
 * Where the smooth surface is, for a point on a triangle that claims to be curved.
 *
 * **The shadow terminator, and the whole of the fix for it.**  A vertex normal says the surface
 * through that vertex is the plane perpendicular to it; the triangle is a chord *under* that
 * surface everywhere except at the vertices.  So a shading point sits below the curved surface it
 * is being shaded as, and a shadow ray leaving it at a grazing angle runs into the neighbouring
 * facet, which stands proud.  The result is one dark tooth per row -- a comb along every helix and
 * every arrowhead, at exactly the sweep's own spacing, and it converges rather than averages out.
 *
 * Lifting the ray origin onto the surface the shading normal describes removes it.  For each
 * vertex, `p` is pushed back up to that vertex's own tangent plane if it is below it -- never down,
 * so a concave corner is left alone and no light leaks through anything -- and the three answers
 * are blended on the same barycentric weights the normal was.  The offset is bounded by the local
 * sagitta, which on this geometry is hundredths of an Angstrom against a ribbon half an Angstrom
 * thick, so nothing moves that a picture can see and nothing thin is escaped through.
 *
 * Johannes Hanika, "Hacking the Shadow Terminator", *Ray Tracing Gems II* ch. 4 (2021).  Cycles
 * ships a related parabolic variant as its Shadow Terminator Geometry Offset.
 *
 * It costs three dots, three mins and three mads on a triangle hit: no extra ray, no extra
 * triangle, no extra binding, and nothing at all for the spheres and cylinders.
 */
fn smoothOffset(p: vec3f, v0: vec3f, v1: vec3f, v2: vec3f,
                n0: vec3f, n1: vec3f, n2: vec3f, w: f32, u: f32, v: f32) -> vec3f {
  let d0 = min(dot(p - v0, n0), 0.0);
  let d1 = min(dot(p - v1, n1), 0.0);
  let d2 = min(dot(p - v2, n2), 0.0);
  return -(w * d0 * n0 + u * d1 * n1 + v * d2 * n2);
}

// Möller & Trumbore, "Fast, Minimum Storage Ray-Triangle Intersection" (JGT 2(1), 1997).
fn intersectTriangle(origin: vec3f, direction: vec3f, tMax: f32, index: u32, hit: ptr<function, Hit>) {
  let record = triangles[index];
  let v0 = vertices[record.x * 3u].xyz;
  let v1 = vertices[record.y * 3u].xyz;
  let v2 = vertices[record.z * 3u].xyz;
  let edge1 = v1 - v0;
  let edge2 = v2 - v0;
  let pvec = cross(direction, edge2);
  let determinant = dot(edge1, pvec);
  if (abs(determinant) < 1e-12) { return; }
  let inverse = 1.0 / determinant;
  let tvec = origin - v0;
  let u = dot(tvec, pvec) * inverse;
  if (u < 0.0 || u > 1.0) { return; }
  let qvec = cross(tvec, edge1);
  let v = dot(direction, qvec) * inverse;
  if (v < 0.0 || u + v > 1.0) { return; }
  let t = dot(edge2, qvec) * inverse;
  if (t < EPSILON || t > tMax) { return; }
  let w = 1.0 - u - v;
  let n0 = vertices[record.x * 3u + 1u].xyz;
  let n1 = vertices[record.y * 3u + 1u].xyz;
  let n2 = vertices[record.z * 3u + 1u].xyz;
  let normal = normalize(n0 * w + n1 * u + n2 * v);
  let colour = vertices[record.x * 3u + 2u].xyz * w
    + vertices[record.y * 3u + 2u].xyz * u
    + vertices[record.z * 3u + 2u].xyz * v;
  (*hit).t = t;
  (*hit).normal = normal;
  (*hit).colour = colour;
  (*hit).material = record.w;
  (*hit).hit = true;
  (*hit).offset = smoothOffset(origin + direction * t, v0, v1, v2, n0, n1, n2, w, u, v);
  let face = cross(edge1, edge2);
  (*hit).outside = dot(face, direction) * dot(face, n0 + n1 + n2) < 0.0;
}

fn intersectPrimitive(origin: vec3f, direction: vec3f, tMax: f32, primitive: u32, hit: ptr<function, Hit>) {
  let sphereCount = params.counts.y;
  let cylinderCount = params.counts.z;
  if (primitive < sphereCount) {
    intersectSphere(origin, direction, tMax, primitive, hit);
  } else if (primitive < sphereCount + cylinderCount) {
    intersectCylinder(origin, direction, tMax, primitive - sphereCount, hit);
  } else {
    intersectTriangle(origin, direction, tMax, primitive - sphereCount - cylinderCount, hit);
  }
}

fn slab(origin: vec3f, inverseDirection: vec3f, low: vec3f, high: vec3f, tMax: f32) -> f32 {
  let a = (low - origin) * inverseDirection;
  let b = (high - origin) * inverseDirection;
  let near = min(a, b);
  let far = max(a, b);
  let enter = max(max(near.x, near.y), max(near.z, EPSILON));
  let exit = min(min(far.x, far.y), min(far.z, tMax));
  return select(-1.0, enter, enter <= exit);
}

/*
  ============================ THE NEAR CHILD IS VISITED FIRST ============================

  Both children are tested at the parent, and the *nearer* one is pushed last so it is popped
  first. Pushing both unconditionally and in a fixed order costs twice over:

  * **A missed child is still visited.** It is pushed, popped, its two `vec4`s fetched and its
    slab tested, and only then discarded. Testing it at the parent instead reads exactly the same
    two `vec4`s and skips the push -- so a child that misses costs *no more* than it did, and one
    less stack slot.
  * **The far half of the tree is often searched before the near half.** `hit.t` is what prunes
    everything below, and it only shrinks when something is actually hit, so entering the far
    subtree first means the whole near subtree is then searched against a `t` far larger than it
    needed to be. Depth-first with the near child first is the standard answer and the reason is
    entirely this: it makes `hit.t` small as early as possible.

  The four child `vec4`s are `left * 2 .. left * 2 + 3` -- **contiguous**, because a split hands
  out the two children's indices together, so the pair is one 64-byte line rather than two fetches
  into unrelated parts of a 60 MB buffer.

  **The pop still re-tests, and that is not redundant.** A node's own two `vec4`s have to be read
  at the pop anyway -- they carry `count` and the child pointer -- so testing the slab again with
  whatever `hit.t` has become in the meantime is free, and it is the test that the ordering exists
  to make succeed.

  **The result cannot move except on an exact tie**, and that is worth stating rather than
  assuming: the closest hit is a property of the ray and the scene, not of the order they are
  found in. `intersectSphere` and its siblings accept on `t <= tMax`, so where two surfaces meet a
  ray at bit-identical `t` the *last* one tested wins, and which one that is does change here.
  Coincident geometry does exist in this product -- `geom/sweep.js` records the two flat caps that
  land on one plane at a rod's end. The byte-identity bench is what settles it, and it reads every
  case bit-identical either way.

  What it buys over a fixed push order, measured at 128 samples and 512 px on a discrete NVIDIA
  GPU, median of five timed repeats after a discarded warm-up, 1-6% spread. This ordering and the
  `anyHit()` below were measured together, so the column is the two of them:

  | | before | after | |
  | --- | --- | --- | --- |
  | `cartoon` (61,142 triangles) | 593 ms | 387 ms | **1.53x** |
  | `cartoon_railed` (32,936 t, 31,356 s, 31,388 c) | 916 ms | 582 ms | **1.57x** |
  | `ball_and_stick` (1,217 s, 1,872 c) | 540 ms | 357 ms | **1.51x** |
  | `spheres_refined` (1,217 s) | 509 ms | 317 ms | **1.61x** |
  | `surface` (24,120 triangles) | 544 ms | 324 ms | **1.68x** |
  | `cartoon` in `glass` | 735 ms | 357 ms | **2.06x** |

  The glass row is the largest and it is **entirely the ordering**, not `anyHit()`: a translucent
  scene sets `worldTint.w`, so `occluded()` takes the walking branch and goes on calling `trace()`
  once per transparent surface it steps through. It gains most because it traverses most.
*/
fn trace(origin: vec3f, direction: vec3f, tMax: f32) -> Hit {
  var hit: Hit;
  hit.t = tMax;
  hit.hit = false;
  hit.normal = vec3f(0.0, 0.0, 1.0);
  hit.colour = vec3f(0.0);
  hit.material = 0u;
  hit.offset = vec3f(0.0);
  hit.outside = true;
  let inverseDirection = 1.0 / direction;

  var stack: array<u32, 40>;
  var depth = 1;
  stack[0] = 0u;
  while (depth > 0) {
    depth = depth - 1;
    let node = stack[depth];
    let low = bvhNodes[node * 2u];
    let high = bvhNodes[node * 2u + 1u];
    if (slab(origin, inverseDirection, low.xyz, high.xyz, hit.t) < 0.0) { continue; }
    let count = u32(high.w);
    if (count > 0u) {
      let first = u32(low.w);
      for (var index = 0u; index < count; index = index + 1u) {
        intersectPrimitive(origin, direction, hit.t, primOrder[first + index], &hit);
      }
    } else {
      let left = u32(low.w);
      let nearEnter = slab(
        origin, inverseDirection,
        bvhNodes[left * 2u].xyz, bvhNodes[left * 2u + 1u].xyz, hit.t);
      let farEnter = slab(
        origin, inverseDirection,
        bvhNodes[(left + 1u) * 2u].xyz, bvhNodes[(left + 1u) * 2u + 1u].xyz, hit.t);
      if (nearEnter >= 0.0 && farEnter >= 0.0) {
        // Both: the farther one goes on first so the nearer one comes off first.
        if (depth + 2 <= 40) {
          if (nearEnter <= farEnter) {
            stack[depth] = left + 1u;
            stack[depth + 1] = left;
          } else {
            stack[depth] = left;
            stack[depth + 1] = left + 1u;
          }
          depth = depth + 2;
        }
      } else if (nearEnter >= 0.0) {
        if (depth < 40) { stack[depth] = left; depth = depth + 1; }
      } else if (farEnter >= 0.0) {
        if (depth < 40) { stack[depth] = left + 1u; depth = depth + 1; }
      }
    }
  }
  return hit;
}

/*
  ==================== A SHADOW RAY ASKS A SMALLER QUESTION ====================

  "Is anything in the way" is not "what is the nearest thing in the way", and answering the second
  to get the first means calling `trace()`, which searches the **whole** tree because it cannot
  know that the thing it just found is the closest until it has ruled out everything nearer. This
  one returns on the first primitive it meets.

  **The answer is identical by construction rather than by measurement.** `trace(...).hit` is
  "some primitive was intersected in `[EPSILON, tMax]`", and so is this; which one, and how far,
  are questions the caller in this branch never asks. Nothing here draws a `random()`, so the
  sampler stream is untouched too -- which is the other half of what byte-identity needs.

  It is deliberately **not** ordered the way `trace()` is. Ordering exists to shrink `hit.t` early
  and there is no `hit.t` here: any hit ends the search, so a nearer one is worth nothing and the
  four extra child fetches would be paid for nothing.

  The `Hit` is reused across primitives rather than declared inside the loop because
  `intersectPrimitive` writes through a pointer; only `.hit` and `.t` are read back.
*/
fn anyHit(origin: vec3f, direction: vec3f, tMax: f32) -> bool {
  let inverseDirection = 1.0 / direction;
  var probe: Hit;
  var stack: array<u32, 40>;
  var depth = 1;
  stack[0] = 0u;
  while (depth > 0) {
    depth = depth - 1;
    let node = stack[depth];
    let low = bvhNodes[node * 2u];
    let high = bvhNodes[node * 2u + 1u];
    if (slab(origin, inverseDirection, low.xyz, high.xyz, tMax) < 0.0) { continue; }
    let count = u32(high.w);
    if (count > 0u) {
      let first = u32(low.w);
      for (var index = 0u; index < count; index = index + 1u) {
        probe.t = tMax;
        probe.hit = false;
        intersectPrimitive(origin, direction, tMax, primOrder[first + index], &probe);
        if (probe.hit) { return true; }
      }
    } else {
      let left = u32(low.w);
      if (depth + 2 <= 40) {
        stack[depth] = left + 1u;
        stack[depth + 1] = left;
        depth = depth + 2;
      }
    }
  }
  return false;
}

// `occluded()` is below `readMaterial`, which it needs: a shadow ray has to be able to pass
// through a transparent surface, and WGSL wants the declaration first.

// ---------------------------------------------------------------- environment

fn envRotate(direction: vec3f) -> vec3f {
  var local = direction;
  if (params.flags.z > 0.5) {
    // Texture Coordinate > Camera on a background shader is the ray direction in *Cycles*
    // camera space.  Blender's camera object looks down its own -Z, but `blender_camera_matrix`
    // multiplies that matrix by scale(1, 1, -1) before Cycles ever sees it, so a forward ray
    // comes out as +Z here.  Getting this sign wrong lights the subject with the half of the
    // environment behind it -- warm ground instead of sky, and about 1.7x too little of it.
    local = vec3f(
      dot(direction, params.camRight.xyz),
      dot(direction, params.camUp.xyz),
      dot(direction, params.camForward.xyz));
  }
  return vec3f(
    dot(params.envRow0.xyz, local),
    dot(params.envRow1.xyz, local),
    dot(params.envRow2.xyz, local));
}

fn localTexel(rotated: vec3f) -> vec2u {
  let u = 0.5 - atan2(rotated.y, rotated.x) / (2.0 * PI);
  let v = acos(clamp(rotated.z, -1.0, 1.0)) / PI;
  let width = params.dims.w;
  let height = params.counts.x;
  let column = min(width - 1u, u32(fract(u) * f32(width)));
  let row = min(height - 1u, u32(clamp(v, 0.0, 0.9999) * f32(height)));
  return vec2u(column, row);
}

fn envTexel(direction: vec3f) -> vec2u { return localTexel(envRotate(direction)); }

// Blender's EASE colour-ramp interpolation, which both authored World ramps use.
fn ease(x: f32) -> f32 {
  let t = clamp(x, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

/**
 * `SPR Glass Studio Panels`: broad softbox panels along the mapped direction's X, which glass
 * studio shows to glossy and transmission rays instead of the HDRI.  Ten ramp stops, but only
 * two colours, so the whole ramp is one dark/light blend factor.
 */
fn glassPanels(local: vec3f) -> vec3f {
  let t = clamp(local.x * 0.5 + 0.5, 0.0, 1.0);
  var factor = 0.0;
  if (t < 0.18) { factor = ease((t - 0.10) / 0.08); }
  else if (t < 0.34) { factor = 1.0; }
  else if (t < 0.42) { factor = 1.0 - ease((t - 0.34) / 0.08); }
  else if (t < 0.58) { factor = 0.0; }
  else if (t < 0.66) { factor = ease((t - 0.58) / 0.08); }
  else if (t < 0.82) { factor = 1.0; }
  else if (t < 0.90) { factor = 1.0 - ease((t - 0.82) / 0.08); }
  return mix(vec3f(0.002, 0.004, 0.008), vec3f(0.82, 0.92, 1.0), factor);
}

/*
  The direction the two split reflection environments are read along.

  `Texture Coordinate > Reflection` on a background shader is the ray direction itself, and the
  reflection graph rotates it by `EULER_XYZ (elevation, 0, azimuth)` -- the user's own lighting
  orientation and **nothing else**.  Two things it deliberately does not
  take, both of which belong to the illumination branch: the authored World's Mapping rotation,
  which is why the trailing `Rz` is undone here rather than a second matrix being uploaded, and the
  camera anchor, because the anchor swaps the illumination to `Texture Coordinate > Camera` while
  the reflection graph keeps its own `Reflection` input.

  `envRow0..2` is `Rz(azimuth) Rx(elevation) Rz(authored)`, so this is that matrix applied to
  `Rz(-authored) * direction`.
*/
fn reflectionVector(direction: vec3f) -> vec3f {
  let c = cos(params.rimColour.w);
  let s = sin(params.rimColour.w);
  let unmapped = vec3f(
    direction.x * c + direction.y * s,
    -direction.x * s + direction.y * c,
    direction.z);
  return vec3f(
    dot(params.envRow0.xyz, unmapped),
    dot(params.envRow1.xyz, unmapped),
    dot(params.envRow2.xyz, unmapped));
}

/*
  The studio-softbox environment: two broad panels along the reflection vector's X.

  A ten-stop `EASE` colour ramp with two colours in it, so the whole ramp is one dark/light factor
  -- the same shape `glassPanels()` above has and a different set of stops, because they are two
  different authored graphs and the resemblance is not a shared implementation.  The authored
  stops are 0.13/0.20/0.32/0.39 and 0.66/0.73/0.86/0.92 against a Map Range from [-1, 1] to
  [0, 1].

  **The strength is here rather than in `resolveLighting()`, and that is the rule for this pair**:
  the colours and the Background strength are one authored environment, and splitting it across
  two files is how the numbers in it drift apart.  `color` is the other way round for the
  other half of that rule -- its colour is the user's, so only its authored 0.8 has anywhere else
  to live.  The *user's* Strength multiplier is a third thing and is neither: it arrives as
  `reflectionRadiance()`'s `scale` and multiplies whatever this returns.
*/
fn studioPanels(local: vec3f) -> vec3f {
  let t = clamp(local.x * 0.5 + 0.5, 0.0, 1.0);
  var factor = 0.0;
  if (t < 0.13) { factor = 0.0; }
  else if (t < 0.20) { factor = ease((t - 0.13) / 0.07); }
  else if (t < 0.32) { factor = 1.0; }
  else if (t < 0.39) { factor = 1.0 - ease((t - 0.32) / 0.07); }
  else if (t < 0.66) { factor = 0.0; }
  else if (t < 0.73) { factor = ease((t - 0.66) / 0.07); }
  else if (t < 0.86) { factor = 1.0; }
  else if (t < 0.92) { factor = 1.0 - ease((t - 0.86) / 0.06); }
  return mix(vec3f(0.008, 0.015, 0.025), vec3f(0.72, 0.86, 1.0), factor) * 0.9;
}

/*
  The reflection-grid environment: a checker texture on the reflection vector.

  `Mapping` first -- scale 7, then a 35-degree Z rotation, which is the POINT order Blender's
  Mapping node applies -- and then Cycles' own `svm_checker` (Blender Foundation, Apache-2.0),
  epsilon and all.  The nudge is not decoration: a unit reflection vector lands on an exact integer
  along every axis often enough to matter, and `floor()` of an exact integer is the cell below it,
  so without it the pattern carries seams down the three great circles.
*/
fn reflectionGrid(local: vec3f) -> vec3f {
  let scaled = local * 7.0;
  let c = cos(0.6108652381980153);   // 35 degrees
  let sn = sin(0.6108652381980153);
  let p = vec3f(scaled.x * c - scaled.y * sn, scaled.x * sn + scaled.y * c, scaled.z)
    * vec3f(0.999999) + vec3f(0.000001 * 0.999999);
  let cell = vec3i(abs(floor(p)));
  let check = ((cell.x % 2 == cell.y % 2) == (cell.z % 2 == 0));
  return select(vec3f(0.16, 0.34, 0.42), vec3f(0.006, 0.014, 0.026), check) * 0.65;
}

/*
  What a glossy or transmission ray sees when the reflection environment is not the source.

  Never called for mode 0, which is the HDRI and is what `envIllumination()` already answers.

  `scale` is the user's Strength, and it arrives separately from `camForward.w` rather than as it:
  that one carries the *HDRI's* own EV as well, and the HDRI is the branch this one replaces.  The
  0.9 and the 0.65 above stay where they are -- they are these environments' authored Background
  strengths.  For `color` the scale is the whole answer, that environment being a constant colour
  with no pattern to multiply.
*/
fn reflectionRadiance(direction: vec3f) -> vec3f {
  let mode = u32(params.flags.x);
  let scale = vec3f(params.envRow0.w, params.envRow1.w, params.envRow2.w);
  if (mode == 1u) { return scale; }
  let local = reflectionVector(direction);
  if (mode == 2u) { return studioPanels(local) * scale; }
  return reflectionGrid(local) * scale;
}

/** The illumination the World shows a non-glossy ray, for a direction already mapped and rotated. */
fn envIllumination(local: vec3f) -> vec3f {
  let texel = localTexel(local);
  var colour = textureLoad(envMap, vec2i(texel), 0).rgb;
  if (u32(params.world.x) == 1u) {
    // Fluorescence dark-field: a dim cool tint on the HDRI plus an added cyan side rim.
    let band = ease((abs(local.x) - params.world.z) / max(params.world.w - params.world.z, 1e-6));
    colour = colour * params.worldTint.xyz + params.rimColour.xyz * band;
  }
  return colour * params.camForward.w;
}

fn envLookup(direction: vec3f) -> vec3f {
  return envIllumination(envRotate(direction));
}

/*
  What one ray sees, given whether the path has turned glossy or transmissive.

  Two splits, and they are different things that happen to look alike.  `params.flags.x` is the
  *user's* reflection environment, chosen in the Lighting card and written by four Styles; world
  mode 2 is the `glass_studio` **World's** own authored panels, which are a property of that
  lighting source rather than of anything the user picked.  A scene can have both, and the user's
  choice wins because it is the one somebody made.
*/
fn worldEmitted(local: vec3f, illumination: vec3f, direction: vec3f, glossy: bool) -> vec3f {
  if (glossy && params.flags.x > 0.5) { return reflectionRadiance(direction); }
  if (glossy && u32(params.world.x) == 2u) { return glassPanels(local) * params.world.y; }
  return illumination;
}

fn envLuminance(colour: vec3f) -> f32 {
  return dot(colour, vec3f(0.2126, 0.7152, 0.0722));
}

/** Solid-angle pdf of the environment light for `direction`; sin(theta) cancels out. */
fn envPdf(direction: vec3f) -> f32 {
  let texel = envTexel(direction);
  let radiance = textureLoad(envMap, vec2i(texel), 0).rgb;
  return envLuminance(radiance) / max(params.flags.y * 2.0 * PI * PI, 1e-9);
}

struct EnvSample { direction: vec3f, local: vec3f, radiance: vec3f, pdf: f32 };

fn sampleEnvironment() -> EnvSample {
  var result: EnvSample;
  let width = params.dims.w;
  let height = params.counts.x;
  let rowTarget = random();
  var low = 0u;
  var high = height - 1u;
  while (low < high) {
    let middle = (low + high) / 2u;
    if (textureLoad(envMarginal, vec2i(i32(middle), 0), 0).r < rowTarget) { low = middle + 1u; } else { high = middle; }
  }
  let row = low;
  let columnTarget = random();
  var columnLow = 0u;
  var columnHigh = width - 1u;
  while (columnLow < columnHigh) {
    let middle = (columnLow + columnHigh) / 2u;
    if (textureLoad(envConditional, vec2i(i32(middle), i32(row)), 0).r < columnTarget) {
      columnLow = middle + 1u;
    } else {
      columnHigh = middle;
    }
  }
  let column = columnLow;
  let u = (f32(column) + random()) / f32(width);
  let v = (f32(row) + random()) / f32(height);
  // Invert the equirectangular mapping, then undo the world rotation.
  let phi = (0.5 - u) * 2.0 * PI;
  let theta = v * PI;
  let local = vec3f(cos(phi) * sin(theta), sin(phi) * sin(theta), cos(theta));
  // envRotate is a rotation, so its inverse is its transpose; the camera anchor is a rotation too.
  var world = vec3f(
    params.envRow0.x * local.x + params.envRow1.x * local.y + params.envRow2.x * local.z,
    params.envRow0.y * local.x + params.envRow1.y * local.y + params.envRow2.y * local.z,
    params.envRow0.z * local.x + params.envRow1.z * local.y + params.envRow2.z * local.z);
  if (params.flags.z > 0.5) {
    world = params.camRight.xyz * world.x + params.camUp.xyz * world.y + params.camForward.xyz * world.z;
  }
  let radiance = textureLoad(envMap, vec2i(i32(column), i32(row)), 0).rgb;
  result.direction = normalize(world);
  result.local = local;
  result.radiance = envIllumination(local);
  // The pdf stays the raw HDRI's: it describes the distribution the texel was drawn from, which
  // no tint or added rim changes.  Only the radiance those extras alter is theirs to alter.
  result.pdf = envLuminance(radiance) / max(params.flags.y * 2.0 * PI * PI, 1e-9);
  return result;
}

/** The world as one ray sees it: `Is Glossy Ray` picks the styled reflection colour. */
fn worldRadiance(direction: vec3f, glossyPath: bool) -> vec3f {
  let local = envRotate(direction);
  return worldEmitted(local, envIllumination(local), direction, glossyPath);
}

// ---------------------------------------------------------------- shading

struct Material {
  roughness: f32,
  metallic: f32,
  ior: f32,
  specularLevel: f32,
  coatWeight: f32,
  coatRoughness: f32,
  coatIor: f32,
  subsurface: f32,
  emissionColour: vec3f,
  emissionStrength: f32,
  // 1 when the template has a reflecting BSDF.  The `emission` template is a bare Emission node
  // with no closure to scatter with, so Cycles ends a path that reaches one.
  surfaceWeight: f32,
  // 1 when the emission tint is driven by the template's colour node rather than a constant, so
  // the tint is the per-atom colour this hit already carries.
  emissionFromBase: f32,
  // The session's `opacity` folded into the template's authored Alpha.  The authored graph is a
  // Mix Shader with `Fac = opacity` between a Transparent BSDF and the whole shader, so the ray
  // takes the shader with probability `alpha` and passes straight through with probability
  // `1 - alpha`.
  alpha: f32,
  // The Principled's Transmission Weight: the fraction of the surface that is a rough dielectric
  // rather than a specular-over-diffuse opaque one.  1.0 on `glass`, 0.82 on
  // `translucent_context`, 0.55 on `jelly` and 0 on the other nine.
  transmission: f32,
  // Contact shading distance in Angstroms, from the authored `ShaderNodeAmbientOcclusion` that
  // sits between the colour node and Base Color.  5.0 on `satin`, 0 everywhere else.
  aoDistance: f32,
  // `glass`'s ray-type Transparent mix, as `materials.js` reads it off the graph:
  //   transparency = clamp(base + step * (isShadowRay + isDiffuseRay), 0, 1)
  rayTransparencyBase: f32,
  rayTransparencyStep: f32,
  // `translucent_context`'s view-angle opacity, Blender's Layer Weight `Facing` through a Map
  // Range: `mix(centre, edge, 1 - |N.V| ** blend)`.  `blend` of 0 means the graph has no ramp.
  edgeBlend: f32,
  edgeCentre: f32,
  edgeEdge: f32,
};

fn readMaterial(index: u32) -> Material {
  let a = params.materials[index * 6u];
  let b = params.materials[index * 6u + 1u];
  let c = params.materials[index * 6u + 2u];
  let d = params.materials[index * 6u + 3u];
  let e = params.materials[index * 6u + 4u];
  let f = params.materials[index * 6u + 5u];
  var material: Material;
  material.roughness = clamp(a.x, 0.015, 1.0);
  material.metallic = clamp(a.y, 0.0, 1.0);
  material.ior = a.z;
  material.specularLevel = a.w;
  material.coatWeight = b.x;
  material.coatRoughness = clamp(b.y, 0.015, 1.0);
  material.coatIor = b.z;
  material.subsurface = b.w;
  material.emissionColour = c.xyz;
  material.emissionStrength = c.w;
  material.surfaceWeight = d.x;
  material.emissionFromBase = d.y;
  material.alpha = clamp(d.z, 0.0, 1.0);
  material.transmission = clamp(d.w, 0.0, 1.0);
  material.aoDistance = e.x;
  material.rayTransparencyBase = e.y;
  material.rayTransparencyStep = e.z;
  material.edgeBlend = e.w;
  material.edgeCentre = f.x;
  material.edgeEdge = f.y;
  return material;
}

/*
  How opaque this hit is, which on three of the twelve materials is not a constant.

  **The fast path is the nine that carry none of these**: `material.alpha` returned with no
  arithmetic and no branch taken.  That matters beyond speed -- the caller tests `< 1.0` before
  drawing a `random()`, so an opaque scene's sampler stream is untouched.

  The three shapes compose by multiplication rather than replacing each other, for the reason
  `tunedAlpha()` in `materials.js` multiplies too: the session's opacity wraps the *whole*
  authored shader in its own Mix against a Transparent BSDF, so it and the template's own
  transparency are two layers rather than two opinions.

  * `rayTransparency*` is `glass`'s `Light Path -> Math(ADD) -> Mix -> Mix Shader` chain.  `rays`
    is `isShadowRay + isDiffuseRay` -- 0, 1 or 2 -- and the clamp is the Mix Shader's own, which is
    what the authored graph relies on: its Math node has `use_clamp` off and reaches 1.54.
  * `edge*` is `translucent_context`'s `Layer Weight (Facing) -> Map Range`.  Blender's Facing is
    `1 - |N.V| ** blend`: 0 looking straight at the surface, 1 at a grazing angle.
*/
fn hitAlpha(material: Material, normal: vec3f, wo: vec3f, rays: f32) -> f32 {
  var alpha = material.alpha;
  if (material.rayTransparencyBase > 0.0 || material.rayTransparencyStep > 0.0) {
    alpha = alpha * (1.0 - clamp(
      material.rayTransparencyBase + material.rayTransparencyStep * rays, 0.0, 1.0));
  }
  if (material.edgeBlend > 0.0) {
    let facing = 1.0 - pow(clamp(abs(dot(normal, wo)), 0.0, 1.0), material.edgeBlend);
    alpha = alpha * mix(material.edgeCentre, material.edgeEdge, facing);
  }
  return alpha;
}

/*
  Is the light blocked between `origin` and `tMax`?

  A transparent surface does not cast a shadow.  Cycles mixes the authored shader against a
  Transparent BSDF, and a shadow ray takes the transparent branch with probability `1 - alpha`
  exactly as a camera ray does, so a half-opaque object casts a half shadow.  Treating every hit as
  opaque gives a solid shadow under a translucent model, and that reads as a lighting mistake
  rather than as a missing feature.

  **The fast path is the point of `params.worldTint.w`.**  On a scene with nothing below alpha 1 --
  every bench case but one, and most real compositions -- this is a single trace, and in
  particular it draws no `random()`.  A draw that only sometimes happens would shift the
  sampler stream and change renders that have nothing to do with opacity.

  **`budget` is what is left of the path's transparent allowance, not a fresh one.**  Blender
  exposes a single Light Paths > Transparent > Max Bounces for the whole path, and a shadow ray
  spawned four crossings deep gets the remaining four rather than another eight.  Handing every
  shadow ray a full budget lets light through where Cycles blocks it, and the picture comes out
  brighter -- measurably: on `shading-opacity-0.5` a fresh budget per shadow ray is +0.29/255 of
  luma, which sharing the path's budget takes to -0.04.  It is small because a shadow ray that
  survives seven crossings at alpha 0.5 was unlikely to reach the light anyway; it is worth
  getting right because it is the one term in that case that is the renderer's own rather than
  the scene's.
*/
fn occluded(origin: vec3f, direction: vec3f, tMax: f32, budget: u32, rays: f32) -> bool {
  /*
    The ordinary scene -- nothing in it below alpha 1 -- asks only whether the light is blocked, so
    it takes `anyHit()` and stops at the first thing it meets. The translucent walk below cannot:
    it steps *through* each surface in turn, so it needs the nearest hit and its material, and it
    goes on calling `trace()`.
  */
  if (params.worldTint.w < 0.5) { return anyHit(origin, direction, tMax); }
  // `from` is a reserved word in WGSL; naming it that compiles nothing and renders a blank
  // picture.
  var at = origin;
  var remaining = tMax;
  for (var step = 0u; step <= budget; step = step + 1u) {
    let hit = trace(at, direction, remaining);
    if (!hit.hit) { return false; }
    let material = readMaterial(hit.material);
    // `rays` already counts this ray's own `Is Shadow Ray`, so `glass` blocks about a sixth of
    // what an opaque surface would rather than all of it -- which is the whole reason its
    // authored graph has a Light Path node in it.
    let alpha = hitAlpha(material, hit.normal, -direction, rays);
    if (alpha >= 1.0 || random() < alpha) { return true; }
    at = at + direction * (hit.t + params.debug.y);
    remaining = remaining - hit.t - params.debug.y;
    if (remaining <= 0.0) { return false; }
  }
  // Out of transparent bounces -- the path's, shared with the camera ray that spawned this.
  // Cycles stops tracing here too, and the conservative answer is "blocked": the alternative
  // brightens a deep interior that was never actually lit.
  return true;
}

/** Cycles' Emission node, and the Principled's own emission input: the authored tint times the
 *  strength, with the tint replaced by the picture's own colour when the template drives it from
 *  `SPR User Color`.  The strength is the session's, not the template's -- one of the three
 *  runtime style tunables. */
fn emittedRadiance(material: Material, baseColour: vec3f) -> vec3f {
  if (material.emissionStrength <= 0.0) { return vec3f(0.0); }
  let tint = select(material.emissionColour, baseColour, material.emissionFromBase > 0.5);
  return tint * material.emissionStrength;
}

fn schlick(f0: vec3f, cosine: f32) -> vec3f {
  let m = clamp(1.0 - cosine, 0.0, 1.0);
  return f0 + (vec3f(1.0) - f0) * (m * m * m * m * m);
}

/**
 * Directional albedo of one GGX lobe with a Schlick Fresnel: the fraction of the light arriving
 * from `nDotV` that the lobe sends back over the whole hemisphere.  Karis's fit of the split-sum
 * environment BRDF ("Physically Based Shading on Mobile", 2014, after Lazarov 2013), as three.js
 * shipped it in `DFGApprox` up to r180 (MIT): `f0 * A + B` with A and B fitted in roughness and nDotV.
 *
 * **This is what a layer owes the layer beneath it, and using `1 - F(vDotH)` instead is worth
 * up to 60% of created energy.**  `F(vDotH)` is the Fresnel of one *pair* of directions, so it is
 * a fair account of the coat only where `wi` is near the mirror direction.  A diffuse lobe is
 * spread over the hemisphere, where `vDotH` stays near the middle of its range and `F` stays near
 * `f0` -- so at grazing incidence, where a dielectric really does reflect most of what reaches it,
 * that would charge the base about 4% when the true albedo is 60%, keeping light the surface has
 * already sent away.  A white-furnace integral of the whole layered BSDF reads **1.60 at nDotV 0.1
 * and 1.048 averaged over a sphere** that way; with this it reads 1.00 to within 0.6%.
 *
 * The fit is within about 20% of this shader's own single-scatter lobe, and the residual is what
 * separates 1.000 from 0.999-1.005 in that furnace.  It costs no texture and no binding.
 */
fn lobeAlbedo(roughness: f32, f0: f32, nDotV: f32) -> f32 {
  let c0 = vec4f(-1.0, -0.0275, -0.572, 0.022);
  let c1 = vec4f(1.0, 0.0425, 1.04, -0.04);
  let r = roughness * c0 + c1;
  let a004 = min(r.x * r.x, exp2(-9.28 * nDotV)) * r.x + r.y;
  return clamp(f0 * (-1.04 * a004 + r.z) + (1.04 * a004 + r.w), 0.0, 1.0);
}

fn ggxD(alpha: f32, nDotH: f32) -> f32 {
  let a2 = alpha * alpha;
  let denominator = nDotH * nDotH * (a2 - 1.0) + 1.0;
  return a2 / max(PI * denominator * denominator, 1e-9);
}
fn smithG(alpha: f32, nDotV: f32, nDotL: f32) -> f32 {
  let a2 = alpha * alpha;
  let v = nDotV + sqrt(a2 + (1.0 - a2) * nDotV * nDotV);
  let l = nDotL + sqrt(a2 + (1.0 - a2) * nDotL * nDotL);
  return 4.0 * nDotV * nDotL / max(v * l, 1e-9);
}

fn basis(normal: vec3f) -> mat3x3<f32> {
  let up = select(vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0), abs(normal.z) > 0.9);
  let tangent = normalize(cross(up, normal));
  return mat3x3<f32>(tangent, cross(normal, tangent), normal);
}

fn sampleGgxHalf(alpha: f32, normal: vec3f) -> vec3f {
  let u1 = random();
  let u2 = random();
  let theta = atan(alpha * sqrt(u1) / sqrt(max(1.0 - u1, 1e-6)));
  let phi = 2.0 * PI * u2;
  let local = vec3f(sin(theta) * cos(phi), sin(theta) * sin(phi), cos(theta));
  return basis(normal) * local;
}

fn cosineDirection(normal: vec3f) -> vec3f {
  let u1 = random();
  let u2 = random();
  let r = sqrt(u1);
  let phi = 2.0 * PI * u2;
  let local = vec3f(r * cos(phi), r * sin(phi), sqrt(max(0.0, 1.0 - u1)));
  return basis(normal) * local;
}

/*
  Blender's Ambient Occlusion node, one ray per shading event.

  `satin` is the only authored template with one: a node between `SPR User Color` and the
  Principled's Base Color darkens the albedo wherever geometry crowds it, and a reader that takes
  the Principled and nothing else drops it silently.

  **One ray, not the node's sixteen.**  Cycles traces `samples` rays per shading evaluation because
  a rasteriser-shaped shader graph has one evaluation to work with; a progressive path tracer has
  as many as the user leaves it running, so one cosine-weighted ray per event is the unbiased
  estimator of the same integral and converges with everything else in the picture.  The albedo
  guide is captured *before* this, so the denoiser is guided by the colour the surface is rather
  than by a binary sample of its occlusion.

  `only_local` and `inside` are both off in the authored node, which is this: rays leave along the
  outward normal and anything in the scene stops them.
*/
fn ambientOcclusion(point: vec3f, normal: vec3f, distance: f32) -> f32 {
  let direction = cosineDirection(normal);
  return select(1.0, 0.0, anyHit(point, direction, distance));
}

/*
  Fresnel reflectance of a smooth dielectric interface, unpolarised, with `eta` the transmitted
  index over the incident one.

  The exact equations rather than the Schlick approximation the reflective lobes use.  Schlick is
  fitted to the *external* curve and has no critical angle at all, while a ray inside a dense
  medium meets total internal reflection on most of its bounces -- a hard step at 42.6 degrees for
  `glass`'s 1.48 -- and a curve that walks straight through it loses the light that makes a solid
  read as solid.  Born & Wolf, *Principles of Optics*, section 1.5.
*/
fn fresnelDielectric(cosThetaI: f32, eta: f32) -> f32 {
  let ci = clamp(cosThetaI, -1.0, 1.0);
  let sin2t = (1.0 - ci * ci) / (eta * eta);
  if (sin2t >= 1.0) { return 1.0; }
  let ct = sqrt(max(1.0 - sin2t, 0.0));
  let rParallel = (eta * ci - ct) / (eta * ci + ct);
  let rPerpendicular = (ci - eta * ct) / (ci + eta * ct);
  return 0.5 * (rParallel * rParallel + rPerpendicular * rPerpendicular);
}

struct Lobes { diffuse: f32, specular: f32, coat: f32 };

fn lobeWeights(material: Material, baseColour: vec3f, nDotV: f32) -> Lobes {
  var lobes: Lobes;
  let coatF0 = pow((material.coatIor - 1.0) / (material.coatIor + 1.0), 2.0);
  let dielectricF0 = pow((material.ior - 1.0) / (material.ior + 1.0), 2.0) * 2.0 * material.specularLevel;
  // A metal's F0 is its base colour, which is far higher than a dielectric's ~0.04, so the mix
  // has to reach the sampling weights too -- otherwise chrome spends most of its samples on a
  // diffuse lobe it does not have.
  let specularF0 = mix(dielectricF0, envLuminance(baseColour), material.metallic);
  lobes.coat = material.coatWeight * (coatF0 + (1.0 - coatF0) * pow(1.0 - nDotV, 5.0));
  let remaining = 1.0 - lobes.coat;
  lobes.specular = remaining * (specularF0 + (1.0 - specularF0) * pow(1.0 - nDotV, 5.0));
  lobes.diffuse = max(remaining - lobes.specular, 0.02) * max(envLuminance(baseColour), 0.05)
    * (1.0 - material.metallic);
  let total = lobes.diffuse + lobes.specular + lobes.coat;
  lobes.diffuse = lobes.diffuse / total;
  lobes.specular = lobes.specular / total;
  lobes.coat = lobes.coat / total;
  return lobes;
}

/** Evaluate the layered BSDF and its sampling pdf together. */
fn evaluate(material: Material, baseColour: vec3f, normal: vec3f, wo: vec3f, wi: vec3f,
            value: ptr<function, vec3f>, pdf: ptr<function, f32>) {
  let nDotL = dot(normal, wi);
  let nDotV = dot(normal, wo);
  *value = vec3f(0.0);
  *pdf = 0.0;
  if (nDotL <= 0.0 || nDotV <= 0.0) { return; }
  let halfway = normalize(wo + wi);
  let nDotH = max(dot(normal, halfway), 0.0);
  let vDotH = max(dot(wo, halfway), 1e-5);

  let coatF0 = vec3f(pow((material.coatIor - 1.0) / (material.coatIor + 1.0), 2.0));
  let specularF0 = vec3f(pow((material.ior - 1.0) / (material.ior + 1.0), 2.0) * 2.0 * material.specularLevel);

  let coatAlpha = material.coatRoughness * material.coatRoughness;
  let specularAlpha = material.roughness * material.roughness;

  let coatFresnel = schlick(coatF0, vDotH) * material.coatWeight;
  let coatSpecular = ggxD(coatAlpha, nDotH) * smithG(coatAlpha, nDotV, nDotL) / (4.0 * nDotV * nDotL) * coatFresnel;
  // What the coat owes the layer beneath is its *albedo* over the whole hemisphere, not the
  // Fresnel of the one direction pair being evaluated -- see `lobeAlbedo`.
  let transmit = vec3f(1.0 - material.coatWeight * lobeAlbedo(material.coatRoughness, coatF0.x, nDotV));

  let microfacet = ggxD(specularAlpha, nDotH) * smithG(specularAlpha, nDotV, nDotL) / (4.0 * nDotV * nDotL);

  let specularFresnel = schlick(specularF0, vDotH);
  let baseSpecular = microfacet * specularFresnel;
  // Likewise for the dielectric specular over the diffuse: the diffuse keeps what the specular
  // lobe does not reflect, and that is one number per view direction rather than a per-`wi` one.
  let diffuse = baseColour * INV_PI * (1.0 - lobeAlbedo(material.roughness, specularF0.x, nDotV));

  // The metallic layer: a conductor GGX with no diffuse under it, tinted by the base colour.
  // Blender 4.x drives it with the F82-tint model, whose correction term is
  //   b = Schlick(F0, 1/7) * (7 / ((6/7)^6)) * (1 - specular_tint)
  // -- exactly zero when Specular Tint is white, which it is in both authored metals.  So this
  // *is* the curve Cycles evaluates, not an approximation of it.  A tinted Specular Tint would
  // need the correction term, and neither template has one.
  let metalSpecular = microfacet * schlick(baseColour, vDotH);

  *value = coatSpecular + transmit * mix(baseSpecular + diffuse, metalSpecular, material.metallic);

  let lobes = lobeWeights(material, baseColour, nDotV);
  let coatPdf = ggxD(coatAlpha, nDotH) * nDotH / (4.0 * vDotH);
  let specularPdf = ggxD(specularAlpha, nDotH) * nDotH / (4.0 * vDotH);
  *pdf = lobes.diffuse * nDotL * INV_PI + lobes.specular * specularPdf + lobes.coat * coatPdf;
}

struct BsdfSample { direction: vec3f, weight: vec3f, pdf: f32, glossy: bool, valid: bool };

fn sampleBsdf(material: Material, baseColour: vec3f, normal: vec3f, wo: vec3f) -> BsdfSample {
  var result: BsdfSample;
  result.valid = false;
  result.glossy = false;
  let nDotV = dot(normal, wo);
  if (nDotV <= 0.0) { return result; }
  let lobes = lobeWeights(material, baseColour, nDotV);
  let pick = random();
  var direction: vec3f;
  if (pick < lobes.diffuse) {
    direction = cosineDirection(normal);
  } else if (pick < lobes.diffuse + lobes.specular) {
    let halfway = sampleGgxHalf(material.roughness * material.roughness, normal);
    direction = reflect(-wo, halfway);
    result.glossy = true;
  } else {
    let halfway = sampleGgxHalf(material.coatRoughness * material.coatRoughness, normal);
    direction = reflect(-wo, halfway);
    result.glossy = true;
  }
  if (dot(direction, normal) <= 0.0) { return result; }
  var value: vec3f;
  var pdf: f32;
  evaluate(material, baseColour, normal, wo, direction, &value, &pdf);
  if (pdf <= 1e-9) { return result; }
  result.direction = direction;
  result.pdf = pdf;
  result.weight = value * dot(normal, direction) / pdf;
  result.valid = true;
  return result;
}

struct DielectricSample { direction: vec3f, weight: vec3f, valid: bool, transmitted: bool };

/*
  One scatter off a rough dielectric interface -- the transmission half of the Principled BSDF.

  Walter et al., "Microfacet Models for Refraction through Rough Surfaces" (EGSR 2007), sampled the
  way the reflective lobes above are: draw a half vector from the GGX distribution, then reflect or
  refract about it with probability `F` and `1 - F`.

  **The weight is the part worth reading rather than skimming.**  With `m` drawn from `D(m)|n.m|`,
  the reflection carries a Jacobian of `1 / (4|wo.m|)` and the refraction one of
  `eta^2 |wi.m| / (wo.m + eta (wi.m))^2` -- and once each lobe's own value is divided by its own
  pdf, *both* collapse to the same expression:

      weight = G(wo, wi, m) * |wo.m| / (|n.wo| * |n.m|)

  differing only by the `F` and `1 - F` that choosing the branch with those probabilities then
  cancels.  So a rough dielectric costs one `random()` more than a mirror and no arithmetic that
  has to know which branch it took.  It is also why this lobe does not go through `evaluate()`:
  there is no ratio left to form.

  **The refracted branch is tinted by the square root of the base colour** and the reflected one is
  white.  That is Blender 4.x's Principled v2 and it is a statement about solids rather than about
  surfaces: light crosses two interfaces on its way through one, so the square root at each is what
  makes an object come out the colour the user picked instead of that colour squared.

  `eta` is the transmitted index over the incident one, so the caller inverts it on the way out of
  a solid.  Total internal reflection arrives here as `F = 1`, and again as `refract()` returning
  the zero vector; both are handled, because the first is the physics and the second is the
  floating point.
*/
fn sampleDielectric(material: Material, baseColour: vec3f, normal: vec3f, wo: vec3f,
                    eta: f32) -> DielectricSample {
  var result: DielectricSample;
  result.valid = false;
  result.transmitted = false;
  let alpha = material.roughness * material.roughness;
  let m = sampleGgxHalf(alpha, normal);
  let cosMO = dot(wo, m);
  if (cosMO <= 0.0) { return result; }
  let fresnel = fresnelDielectric(cosMO, eta);
  var direction: vec3f;
  var tint = vec3f(1.0);
  if (random() < fresnel) {
    direction = reflect(-wo, m);
    if (dot(direction, normal) <= 0.0) { return result; }
  } else {
    // WGSL's `refract(incident, normal, ratio)` takes the incident index over the transmitted one.
    direction = refract(-wo, m, 1.0 / eta);
    if (dot(direction, direction) < 1e-8 || dot(direction, normal) >= 0.0) { return result; }
    tint = sqrt(clamp(baseColour, vec3f(0.0), vec3f(1.0)));
    result.transmitted = true;
  }
  let nDotV = abs(dot(normal, wo));
  let nDotL = abs(dot(normal, direction));
  let nDotM = abs(dot(normal, m));
  if (nDotV < 1e-6 || nDotM < 1e-6) { return result; }
  let shadowing = smithG(alpha, nDotV, nDotL);
  result.direction = direction;
  result.weight = tint * shadowing * cosMO / (nDotV * nDotM);
  result.valid = true;
  return result;
}

/*
  Nothing non-finite may reach a buffer that accumulates: `accum[pixel] + NaN` is NaN for the rest
  of the render, so one bad sample in 904 is a permanent black dot the other 903 cannot repair --
  an isolated *opaque* `rgb(0, 0, 0)` in a smooth surface, which is what this is read by.
  Measured on `spheres_refined` + `jelly` at 640 square and 512 samples: one dead pixel at seed 1
  and none at seeds 0, 2 and 3, on identical geometry and camera, so the source is the sampler
  stream rather than a primitive or an unlit pocket.

  **A range test rather than a NaN test.**  WGSL removed `isNan`, `isInf`, `isFinite` and
  `isNormal` (gpuweb#2270) because a backend may assume fast math and fold them away even on a
  value loaded straight from memory; two ordinary comparisons cannot be folded.  A NaN fails both,
  `+inf` fails the upper and `-inf` the lower, and every real radiance passes through **unchanged**
  -- so a finite path is bit-identical and only a pixel that was already black can move.  Cycles
  answers the same question by bit pattern (`isfinite_safe`, `util/math_base.h`) for the reason.

  Per component, as Cycles' `ensure_finite` is, so a bad red channel does not discard green.
*/
fn ensureFinite(value: vec3f) -> vec3f {
  // Just inside f32's 3.4028235e38. Nothing this renderer can legitimately produce is out here.
  let finite = (value > vec3f(-3.0e38)) & (value < vec3f(3.0e38));
  return select(vec3f(0.0), value, finite);
}

/** Cycles clamps every sample past the first bounce (Light Paths > Clamp Indirect, 10 by
 *  default).  Without it a 78,000 nit sun in the HDRI throws fireflies that a compressive view
 *  transform turns into a *darker* mean, not just a noisier one. */
fn clampIndirect(contribution: vec3f, bounce: u32) -> vec3f {
  /*
    The finite step is **before** the clamp, which is `film_clamp_light()`'s order in Cycles and is
    what stops this function manufacturing the defect it is named for: `peak` of an `inf`
    contribution is `inf`, `limit / inf` is 0, and `inf * 0` is NaN. Clamped first, every overflow
    anywhere in the path would arrive at the film already converted into the one form that cannot
    be recovered from.

    It is also why the guard is here rather than only at the film write: a NaN at bounce 2 would
    otherwise poison `radiance` for the whole sample, and the chokepoint would then discard the
    bounces that were fine. Cycles clamps per contribution for the same reason.
  */
  let value = ensureFinite(contribution);
  let limit = params.debug.z;
  if (bounce == 0u || limit <= 0.0) { return value; }
  let peak = max(value.r, max(value.g, value.b));
  if (peak <= limit) { return value; }
  return value * (limit / peak);
}

// The power heuristic with exponent 2: Veach & Guibas, "Optimally Combining Sampling Techniques
// for Monte Carlo Rendering" (SIGGRAPH 1995).
fn misWeight(a: f32, b: f32) -> f32 {
  let a2 = a * a;
  return a2 / max(a2 + b * b, 1e-9);
}

// ---------------------------------------------------------------- main

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let width = params.dims.x;
  let height = params.dims.y;
  // The pixel, not the invocation: everything below is written in film coordinates, so a tiled
  // dispatch and a whole-frame one compute the same thing for the same pixel -- same seed, same
  // jitter, same accumulator slot.  That is what makes the split bit-identical rather than close.
  let px = id.x + params.tile.x;
  let py = id.y + params.tile.y;
  if (px >= width || py >= height) { return; }
  let frame = params.dims.z;
  let pixel = py * width + px;
  // Hash the pixel and the sample index separately: a plain weighted sum collides between
  // neighbouring pixels and frames, and correlated seeds show up as structured noise.
  rngState = pixel * 2654435761u + 1u;
  // `debug.w` carries the sampler seed offset `render_settings.seed` writes.  0 is the product's
  // value and every recorded baseline's, and 0 adds exactly nothing here, so the default stream
  // is untouched.  A non-zero seed draws an independent realisation of
  // the same estimator: the renderer is otherwise fully deterministic, so two runs of one
  // revision differ by nothing at all.
  rngState = pcg(&rngState) + frame * 2246822519u + u32(params.debug.w) * 2891336453u;
  rngState = pcg(&rngState);

  /*
    Camera ray, jittered inside the pixel for antialiasing.

    **The field of view is vertical and the aspect term is on X alone.** Multiplying both axes by
    the same `tanHalfFov` is only right on a square target: anything wider renders the same
    angular extent across more pixels and squashes the picture horizontally. The live trace fills
    a stage that resizes with the window, so a non-square target is the ordinary case.

    Vertical is the convention the rest of the product already uses -- `camera-framing.js` derives
    the lens from the vertical FOV against a 24 mm sensor height, which is `sensor_fit = "VERTICAL"`
    -- so a window that gets wider shows *more*, and one that gets taller does not silently rescale
    the composition the user framed.

    `aspect` is written as a ratio of the two dimensions rather than passed in, and at `width ==
    height` it is exactly 1.0 -- IEEE 754 division of equal values is exact, and multiplying by
    exactly 1.0 is exact -- so every square render, which is every recorded bench case, is
    bit-identical to the un-aspected form. That is the property being protected, not merely a
    hope: the term is on X only so that Y's expression is untouched at the token level too.
  */
  let jitterX = (f32(px) + random()) / f32(width) * 2.0 - 1.0;
  let jitterY = 1.0 - (f32(py) + random()) / f32(height) * 2.0;
  let tanHalfFov = params.camPos.w;
  let aspect = f32(width) / f32(height);
  var origin = params.camPos.xyz;
  var direction = normalize(
    params.camForward.xyz
    + params.camRight.xyz * jitterX * tanHalfFov * aspect
    + params.camUp.xyz * jitterY * tanHalfFov);
  let aperture = params.camRight.w;
  if (aperture > 0.0) {
    let focusPoint = origin + direction * (params.camUp.w / dot(direction, params.camForward.xyz));
    let angle = 2.0 * PI * random();
    let radius = aperture * sqrt(random());
    origin = origin + params.camRight.xyz * cos(angle) * radius + params.camUp.xyz * sin(angle) * radius;
    direction = normalize(focusPoint - origin);
  }

  // Staged debug modes, so a hang can be bisected without editing the shader.
  let stage = u32(params.debug.x);
  if (stage == 1u) {
    accum[pixel] = accum[pixel] + vec4f(f32(px) / f32(width), f32(py) / f32(height), 0.25, 1.0);
    return;
  }
  if (stage == 5u) {
    // The world as the camera sees it, so orientation and brightness can be judged directly.
    accum[pixel] = accum[pixel] + vec4f(envLookup(direction), 1.0);
    return;
  }
  if (stage == 6u) {
    // Analytic check: a white Lambertian facing the camera, lit by one environment sample with
    // no shadowing and no MIS.  Every covered pixel must converge to the same HDRI's
    // irradiance / pi.
    let probe = trace(origin, direction, 1e30);
    if (!probe.hit) { accum[pixel] = accum[pixel] + vec4f(0.0); return; }
    let facing = -params.camForward.xyz;
    let light = sampleEnvironment();
    let cosine = max(dot(facing, light.direction), 0.0);
    accum[pixel] = accum[pixel] + vec4f(light.radiance * cosine * INV_PI / max(light.pdf, 1e-9), 1.0);
    return;
  }
  if (stage == 2u || stage == 3u || stage == 4u) {
    let probe = trace(origin, direction, 1e30);
    if (!probe.hit) { accum[pixel] = accum[pixel] + vec4f(0.0); return; }
    var shade = abs(probe.normal);
    if (stage == 3u) { shade = envLookup(reflect(direction, probe.normal)); }
    if (stage == 4u) {
      let light = sampleEnvironment();
      shade = light.radiance * max(dot(probe.normal, light.direction), 0.0) / max(light.pdf, 1e-6) * probe.colour;
    }
    accum[pixel] = accum[pixel] + vec4f(shade, 1.0);
    return;
  }

  var throughput = vec3f(1.0);
  var radiance = vec3f(0.0);
  var alpha = 0.0;
  var guideAlbedo = vec3f(0.0);
  var guideNormal = vec3f(0.0);
  var glossyPath = false;
  /*
    `Is Transmission Ray` and `Is Diffuse Ray`, which two authored graphs ask about by name.

    The split environment shows its panels to `max(Is Glossy Ray, Is Transmission Ray)`, and the
    glass studio World does the same -- so a refracted ray is not a glossy one and both still
    leave the HDRI behind.  And
    `glass`'s own transparency rises for a ray that has been diffusely scattered, which is what
    keeps a glass model from darkening everything it stands in front of.
  */
  var transmissionPath = false;
  var diffusePath = false;
  var lastPdf = 0.0;
  var specularBounce = true;
  let maxBounces = u32(params.flags.w);

  /*
    An explicit `loop` rather than a `for`, because a pass through a transparent surface must not
    spend a scatter bounce.  `bounce` is incremented at the bottom and the transparent branch
    `continue`s above it, which keeps every use of `bounce` -- the coverage test, the guide
    capture, `clampIndirect`'s depth and the Russian-roulette threshold -- counting scatter
    bounces alone.
  */
  var bounce = 0u;
  var transparentBounces = 0u;
  loop {
    if (bounce >= maxBounces) { break; }
    let hit = trace(origin, direction, 1e30);
    if (!hit.hit) {
      if (bounce == 0u) { break; } // Transparent film: no background, no coverage.
      let escaped = worldRadiance(direction, glossyPath || transmissionPath);
      var weight = 1.0;
      if (!specularBounce) { weight = misWeight(lastPdf, envPdf(direction)); }
      radiance = radiance + clampIndirect(throughput * escaped * weight, bounce - 1u);
      break;
    }
    let material = readMaterial(hit.material);

    /*
      Principled Alpha, the way Cycles mixes it: with probability `1 - alpha` the ray carries on
      undeflected, unshaded, and -- this is the part that matters for the film -- **without
      counting as coverage**.  A camera ray that passes through everything and escapes leaves
      `bounce` at 0 and `alpha` at 0, which is the transparent film it already had.

      `&&` short-circuits, so an opaque material never draws a `random()` and the sampler stream on
      an opaque scene is untouched by it.  That is what lets the bench move by exactly the
      cases that carry an opacity below 1.

      This branch is not transmission: no refraction, no IOR, no coloured absorption.  That lobe
      is the Transmission Weight split below.
    */
    let hitOpacity = hitAlpha(material, hit.normal, -direction, select(0.0, 1.0, diffusePath));
    if (hitOpacity < 1.0 && random() >= hitOpacity) {
      if (transparentBounces >= MAX_TRANSPARENT_BOUNCES) { break; }
      transparentBounces = transparentBounces + 1u;
      // Step past the surface along the ray, not along the normal: the ray is not turning.
      origin = origin + direction * (hit.t + params.debug.y);
      continue;
    }
    if (bounce == 0u) { alpha = 1.0; }

    var normal = hit.normal;
    if (dot(normal, direction) > 0.0) { normal = -normal; }
    /*
      `hit.offset` puts the origin on the surface the shading normal describes rather than on the
      chord under it, which is what stops a facet's neighbour from shadowing it -- `smoothOffset()`
      above.  It is applied to the *ray origin* only: the shading point, the hit distance and the
      guide normal are all untouched, so this changes what the surface can see and never where the
      surface is.  Both rays that leave here take it, the shadow ray and the scattered one; the
      indirect term has the same terminator and it is the same fix.

      Not on a face met from inside by a path that crossed a surface with opacity below one: it
      scatters back inward, and lifted it starts every ray on the far side of its own face.  An
      opaque path meets a face from inside only where a silhouette's flipped normal led it under the
      surface; it keeps the lift, so no opaque path is touched.
    */
    let lift = select(vec3f(0.0), hit.offset, hit.outside || transparentBounces == 0u);
    let point = origin + direction * hit.t + lift + normal * params.debug.y;
    let wo = -direction;
    // `material.subsurface` is not shaded: `ceramic`'s radius is tiny enough to read as diffuse
    // at this scale, and `jelly`'s weight of 0.5 at a 5 A mean free path is dropped outright.
    var baseColour = hit.colour;
    if (bounce == 0u) { guideAlbedo = baseColour; guideNormal = normal; }
    // `satin`'s authored contact shading, and the only place in this shader where a *node* rather
    // than a lobe reaches the picture.  Guarded, so the other eleven draw no `random()` here.
    if (material.aoDistance > 0.0) {
      baseColour = baseColour * ambientOcclusion(point, normal, material.aoDistance);
    }

    // Emission is collected on every hit, not only the camera's.  Nothing here samples emissive
    // geometry as a light, so a scattered ray landing on a glowing surface is the only way its
    // light reaches the picture; Cycles does sample it, which makes its version quieter rather
    // than different.  No double counting either way -- next-event estimation below is against
    // the world alone.
    radiance = radiance + clampIndirect(throughput * emittedRadiance(material, baseColour), bounce);
    // A bare Emission node has no closure to scatter with.  Stopping here is not an optimisation:
    // shading it as a dielectric as well would add a reflection Cycles does not render.
    if (material.surfaceWeight <= 0.0) { break; }

    /*
      The Principled's Transmission Weight, as a one-sample split rather than a fourth lobe.

      `f = (1 - T) * opaque + T * dielectric`, and this draws which of the two this scatter is
      from rather than evaluating both: the `T` cancels against the branch probability, so each
      branch is estimated by its own sampler at full weight.  Doing it here rather than inside
      `sampleBsdf()` is what keeps the nine materials with `T = 0` bit-for-bit clear of it -- the
      `&&` short-circuits before the `random()`, so their sampler
      stream never sees this line at all.

      **The dielectric branch is not combined with next-event estimation, and that is a decision
      rather than an omission.**  A refraction leaves through the far side of the surface, where
      `evaluate()` is zero and sampling the environment can never produce the direction; a
      reflection off something this smooth is the one case where BSDF sampling is already the
      better of the two strategies.  So the branch runs unshadowed by NEE and marks the path
      `specularBounce`, which is what gives the escape term its full weight instead of a MIS
      weight against a strategy that never covered it.

      A transmission bounce spends a scatter bounce, not one of `MAX_TRANSPARENT_BOUNCES`: the ray
      turns, which is exactly the distinction that budget exists to draw.
    */
    if (material.transmission > 0.0 && random() < material.transmission) {
      // Which side of the interface the ray is on, read before the shading normal was flipped.
      let entering = dot(hit.normal, direction) < 0.0;
      let eta = select(1.0 / material.ior, material.ior, entering);
      let glass = sampleDielectric(material, baseColour, normal, wo, eta);
      if (!glass.valid) { break; }
      throughput = throughput * glass.weight;
      if (glass.transmitted) { transmissionPath = true; } else { glossyPath = true; }
      specularBounce = true;
      lastPdf = 0.0;
      // A refracted ray leaves on the *other* side of the surface, so the offset that keeps a
      // scattered ray off its own geometry has to follow it there.
      let side = select(-1.0, 1.0, dot(glass.direction, normal) > 0.0);
      // `hit.offset` lifts toward the vertex normals only; kept, it restarts an inward ray above
      // its own flat face and refracts there again (52% of rays on `cartoon`, 93% on `ribbon`).
      let lifted = select(vec3f(0.0), hit.offset, dot(glass.direction, hit.normal) > 0.0);
      origin = origin + direction * hit.t + lifted + normal * (side * params.debug.y);
      direction = glass.direction;
    } else {
      // Next event estimation against the world light.  Cycles evaluates the world for a shadow
      // ray with the path's own flags, so a first-bounce shadow ray still sees the HDRI.
      let light = sampleEnvironment();
      if (light.pdf > 0.0 && dot(light.direction, normal) > 0.0) {
        var value: vec3f;
        var pdf: f32;
        evaluate(material, baseColour, normal, wo, light.direction, &value, &pdf);
        if (pdf > 0.0) {
          // The shadow ray inherits what is left of the path's transparent budget, never a fresh
          // one: `transparentBounces` can only reach MAX_TRANSPARENT_BOUNCES, so this cannot wrap.
          let shadowBudget = MAX_TRANSPARENT_BOUNCES - transparentBounces;
          // A shadow ray is a shadow ray, and it is a diffuse one too when the path already was.
          if (!occluded(point, light.direction, 1e30, shadowBudget,
                        1.0 + select(0.0, 1.0, diffusePath))) {
            /*
              A shadow ray carries the path's own flags in Cycles, so one leaving a glossy or
              transmissive path sees what the escape term sees -- the split reflection environment
              or `glass_studio`'s panels -- rather than the HDRI.

              **The pdf stays the HDRI's**, for the reason `sampleEnvironment()` gives about the
              tint and the rim: it describes the distribution the direction was drawn from, which
              the substitution does not change. That makes this a poorly matched estimator of a
              studio panel rather than a wrong one -- and the BSDF-sampled escape term is
              MIS-weighted against the same pdf, so the two still combine.
            */
            let emitted = worldEmitted(light.local, light.radiance, light.direction,
                                       glossyPath || transmissionPath);
            radiance = radiance + clampIndirect(
              throughput * value * dot(normal, light.direction) * emitted / light.pdf
                * misWeight(light.pdf, pdf),
              bounce);
          }
        }
      }

      let next = sampleBsdf(material, baseColour, normal, wo);
      if (!next.valid) { break; }
      throughput = throughput * next.weight;
      glossyPath = glossyPath || next.glossy;
      diffusePath = diffusePath || !next.glossy;
      specularBounce = false;
      lastPdf = next.pdf;
      origin = point;
      direction = next.direction;
    }

    if (bounce >= 3u) {
      let survival = clamp(max(throughput.r, max(throughput.g, throughput.b)), 0.05, 1.0);
      if (random() > survival) { break; }
      throughput = throughput / survival;
    }
    bounce = bounce + 1u;
  }

  /*
    The chokepoint, and it is one because it does not depend on having enumerated the ways a
    sample can go bad. Every contribution above is already clamped per contribution, so this is
    the backstop for the sum and for whatever is added next -- Cycles guards all five of its film
    writes rather than the arithmetic behind them (`kernel/film/light_passes.h`), and pbrt tests
    the same thing one line before `AddSample` (`cpu/integrators.cpp`).

    `alpha` is not guarded and must not be: it is written as a literal 0.0 or 1.0, and it is
    coverage.
  */
  let previous = accum[pixel];
  accum[pixel] = previous + vec4f(ensureFinite(radiance), alpha);
  let slot = pixel * 2u;
  // The guides accumulate too, with the same stickiness and a quieter symptom: a NaN normal off a
  // degenerate primitive reaches the denoiser's weights rather than the picture, and `guideNormal`
  // is `normalize()`d geometry.
  guide[slot] = guide[slot] + vec4f(ensureFinite(guideAlbedo) * alpha, alpha);
  guide[slot + 1u] = guide[slot + 1u] + vec4f(ensureFinite(guideNormal) * alpha, 0.0);
}
