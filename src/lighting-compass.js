const DEG_TO_RAD = Math.PI / 180;


function wrapLightingAngle(value) {
  const wrapped = ((value + 180) % 360 + 360) % 360 - 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}


// Reference vectors are measured in each trusted World's Environment Texture
// coordinates. Directional sources use the dominant bright cluster; broad and
// diffuse sources use the solid-angle-weighted radiance moment. Hybrid rigs use
// the explicit procedural axis authored in their World graph.
/**
 * The source every session opens on, and the one the picker tiles are lit by.
 *
 * Named here rather than spelled `'autumn_meadow'` at each of its readers -- `scene.js`'s
 * `lightingScene()` falls back to it and `main.js` warms its environment while the opening screen
 * is up, and a default that two files spell independently is a default that can differ.
 */
export const DEFAULT_LIGHTING_SOURCE = 'autumn_meadow';

/*
  **`scene` is the authored environment each source opens, and it is here so that it is here only
  once.** It was a second table in `src/scene.js` (`LIGHTING_SCENES`), which now derives itself from
  this one. The lighting defaults must not live in two files, and two of the nine are not named
  after their source (blue studio is `base_scene`, dark studio is `dark_scene`), which is exactly
  the shape of fact that drifts when it is written twice.

  Loading one environment for all nine is the largest thing this can get wrong, so the mapping is
  worth keeping close to the profiles rather than far from them.

  `image` is the photograph under `assets/env/`, named for it; three pairs of scenes share one, and
  what tells a pair apart is each scene's `.json` (strength, rotation, tint), not its pixels.
*/
export const LIGHTING_SOURCE_PROFILES = Object.freeze({
  blue_studio: Object.freeze({
    scene: 'base_scene',
    image: 'studio_small_01',
    kind: 'broad',
    kindLabel: 'Broad studio',
    referenceVector: Object.freeze([0.437579586, -0.255240841, 0.862192681]),
  }),
  dark_studio: Object.freeze({
    scene: 'dark_scene',
    image: 'studio_small_01',
    kind: 'broad',
    kindLabel: 'Broad studio',
    referenceVector: Object.freeze([0.437579586, -0.255240841, 0.862192681]),
    authoredAzimuth: 125,
  }),
  autumn_meadow: Object.freeze({
    scene: 'autumn_meadow_scene',
    image: 'autumn_meadow',
    kind: 'directional',
    kindLabel: 'Sunlit environment',
    referenceVector: Object.freeze([0.745433816, -0.541359258, 0.388919760]),
    // Autumn meadow's World is an HDRI-handler node group whose Mapping rotation is *driven*
    // (Combine XYZ <- Math), not a literal, so it does not read as an authored rotation the way
    // dark_studio's plain [0, 0, 125] does. Its group input Rotation is -304.2 degrees, and a
    // measured render recovers +55.5 in both anchors. Without it the marker sits ~55 degrees away
    // in azimuth from where the render puts the sun.
    // This is drawing only: the request is built from #hdri-elevation / #hdri-azimuth.
    authoredAzimuth: -304.2,
    // Autumn meadow is the source #lighting-source loads with, so this is the orientation the app
    // opens on and the one the picker tiles under src/thumbs/ are lit by -- every one except the
    // material grid, which is lit by `neutral_softbox`, because a diffuse outdoor sky is exactly the
    // light that makes a specular lobe invisible. It is a *starting* orientation, not the authored
    // one: Home still returns to 0/0. The values are mirrored into #lighting-anchor,
    // #hdri-elevation and #hdri-azimuth in index.html and into STYLE_BASELINE; nothing in src/ reads
    // them, and all four copies move together or not at all.
    defaultAnchor: 'camera',
    defaultElevation: -168.5,
    defaultAzimuth: 21.1,
  }),
  neutral_softbox: Object.freeze({
    scene: 'neutral_softbox_scene',
    image: 'studio_small_08',
    kind: 'broad',
    kindLabel: 'Softbox environment',
    referenceVector: Object.freeze([-0.180480925, -0.972487321, 0.147292385]),
  }),
  overcast_sky: Object.freeze({
    scene: 'overcast_sky_scene',
    image: 'kloofendal_overcast_puresky',
    kind: 'diffuse',
    kindLabel: 'Diffuse sky',
    referenceVector: Object.freeze([0.275361407, -0.529570736, 0.802328444]),
  }),
  clear_sky: Object.freeze({
    scene: 'clear_sky_scene',
    image: 'drakensberg_solitary_mountain_puresky',
    kind: 'directional',
    kindLabel: 'Directional sky',
    referenceVector: Object.freeze([0.674081828, -0.491602336, 0.551308292]),
  }),
  cool_night: Object.freeze({
    scene: 'cool_night_scene',
    image: 'blue_lagoon_night',
    kind: 'broad',
    kindLabel: 'Night environment',
    referenceVector: Object.freeze([0.438862707, -0.646405755, 0.624146717]),
  }),
  fluorescence_darkfield: Object.freeze({
    scene: 'fluorescence_darkfield_scene',
    image: 'blue_lagoon_night',
    kind: 'axial',
    kindLabel: 'Two-sided rim',
    referenceVector: Object.freeze([1, 0, 0]),
  }),
  glass_studio: Object.freeze({
    scene: 'glass_studio_scene',
    image: 'studio_small_08',
    kind: 'panels',
    kindLabel: 'Reflection panels',
    referenceVector: Object.freeze([1, 0, 0]),
  }),
});

const FALLBACK_SOURCE_PROFILE = Object.freeze({
  kind: 'broad',
  kindLabel: 'Environment',
});


/** The asset path of the map one authored scene (a profile's `scene`) is lit by. */
export function environmentImagePath(scene) {
  const profile = Object.values(LIGHTING_SOURCE_PROFILES).find((one) => one.scene === scene);
  if (!profile) throw new Error(`No environment map for the lighting scene "${scene}"`);
  return `env/${profile.image}.hdr.gz`;
}


export function lightingSourceProfile(source) {
  return LIGHTING_SOURCE_PROFILES[source] ?? FALLBACK_SOURCE_PROFILE;
}


export function clampLightingAngles(elevation, azimuth) {
  const numericElevation = Number(elevation);
  const numericAzimuth = Number(azimuth);
  if (!Number.isFinite(numericElevation) || !Number.isFinite(numericAzimuth)) {
    throw new TypeError('Lighting elevation and azimuth must be finite numbers.');
  }
  return {
    // Both inputs drive periodic Blender Euler rotations. Keeping their UI
    // representation canonical avoids a dead end after one complete turn.
    elevation: wrapLightingAngle(numericElevation),
    azimuth: wrapLightingAngle(numericAzimuth),
  };
}


export function lightingCompassProjection(
  elevation,
  azimuth,
  referenceVector = [0, 1, 0],
  anchor = 'world',
  authoredAzimuth = 0,
) {
  const angles = clampLightingAngles(elevation, azimuth);
  if (!['camera', 'world'].includes(anchor)) {
    throw new TypeError('Lighting compass anchor must be camera or world.');
  }
  if (!Number.isFinite(authoredAzimuth)) {
    throw new TypeError('Lighting compass authored azimuth must be finite.');
  }
  if (!Array.isArray(referenceVector)
    || referenceVector.length !== 3
    || !referenceVector.every(Number.isFinite)) {
    throw new TypeError('Lighting compass reference vector must contain three finite numbers.');
  }
  const referenceLength = Math.hypot(...referenceVector);
  if (referenceLength <= 1.0e-12) {
    throw new TypeError('Lighting compass reference vector must not be zero.');
  }
  const [referenceX, referenceY, referenceZ] = referenceVector.map(
    (component) => component / referenceLength,
  );
  const elevationRadians = angles.elevation * DEG_TO_RAD;
  const azimuthRadians = angles.azimuth * DEG_TO_RAD;
  const cosElevation = Math.cos(elevationRadians);
  const sinElevation = Math.sin(elevationRadians);
  const cosAzimuth = Math.cos(azimuthRadians);
  const sinAzimuth = Math.sin(azimuthRadians);

  // Blender rotates the coordinates fed into the Environment Texture. A
  // feature painted at referenceVector therefore appears at R^-1 * reference,
  // where R is Euler XYZ(elevation, 0, azimuth). This inverse is what makes the
  // draggable marker follow the visible source rather than the input vectors.
  const afterInverseAzimuth = {
    x: (cosAzimuth * referenceX) + (sinAzimuth * referenceY),
    y: (-sinAzimuth * referenceX) + (cosAzimuth * referenceY),
    z: referenceZ,
  };
  const afterRuntimeRotation = {
    x: afterInverseAzimuth.x,
    y: (cosElevation * afterInverseAzimuth.y) + (sinElevation * afterInverseAzimuth.z),
    z: (-sinElevation * afterInverseAzimuth.y) + (cosElevation * afterInverseAzimuth.z),
  };
  // Runtime rotation is inserted after the trusted Mapping node. Undo any
  // authored Z rotation last so the marker remains faithful to that World.
  const authoredRadians = authoredAzimuth * DEG_TO_RAD;
  const cosAuthored = Math.cos(authoredRadians);
  const sinAuthored = Math.sin(authoredRadians);
  const visibleVector = {
    x: (cosAuthored * afterRuntimeRotation.x) + (sinAuthored * afterRuntimeRotation.y),
    y: (-sinAuthored * afterRuntimeRotation.x) + (cosAuthored * afterRuntimeRotation.y),
    z: afterRuntimeRotation.z,
  };
  if (anchor === 'camera') {
    return {
      // Blender's World Texture Coordinate Camera output is +X screen-right,
      // +Y screen-up, and +Z on the far side for illumination rays. A source
      // at -Z is on the camera side and front-lights the subject. CSS screen Y
      // grows downward, hence the screen-axis negation.
      x: visibleVector.x,
      y: -visibleVector.y,
      depth: -visibleVector.z,
      visibleVector,
    };
  }
  return {
    // The trusted authoring camera is a +Y side view: screen right is -X and
    // screen up is +Z.
    x: -visibleVector.x,
    y: -visibleVector.z,
    depth: visibleVector.y,
    visibleVector,
  };
}


export function lightingAnglesFromDrag(
  startElevation,
  startAzimuth,
  deltaX,
  deltaY,
  width,
  height,
) {
  const start = clampLightingAngles(startElevation, startAzimuth);
  if (![deltaX, deltaY, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new TypeError('Lighting compass drag dimensions must be positive finite numbers.');
  }
  return clampLightingAngles(
    start.elevation + ((deltaY / height) * 180),
    start.azimuth - ((deltaX / width) * 360),
  );
}


export function lightingAnglesFromKey(elevation, azimuth, key, fine = false) {
  const angles = clampLightingAngles(elevation, azimuth);
  const step = fine ? 1 : 5;
  if (key === 'Home') return { elevation: 0, azimuth: 0 };
  if (key === 'ArrowUp') return clampLightingAngles(angles.elevation - step, angles.azimuth);
  if (key === 'ArrowDown') return clampLightingAngles(angles.elevation + step, angles.azimuth);
  if (key === 'ArrowLeft') return clampLightingAngles(angles.elevation, angles.azimuth + step);
  if (key === 'ArrowRight') return clampLightingAngles(angles.elevation, angles.azimuth - step);
  return undefined;
}


export function formatLightingDegrees(value) {
  const numeric = Object.is(Number(value), -0) ? 0 : Number(value);
  const rounded = Math.round(numeric * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${String(rounded).replace('-', '−')}°`;
}
