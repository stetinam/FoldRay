export const CAMERA_FRAME_PADDING_FRACTION = 0.15;
export const CAMERA_FRAME_MIN_RADIUS = 1;


export function paddedCameraFrameRadius(
  radius,
  paddingFraction = CAMERA_FRAME_PADDING_FRACTION,
  minimumRadius = CAMERA_FRAME_MIN_RADIUS,
) {
  if (!Number.isFinite(radius) || radius < 0) {
    throw new Error('Camera framing radius must be finite and non-negative.');
  }
  if (!Number.isFinite(paddingFraction) || paddingFraction < 0) {
    throw new Error('Camera framing padding must be finite and non-negative.');
  }
  if (!Number.isFinite(minimumRadius) || minimumRadius <= 0) {
    throw new Error('Camera framing minimum radius must be finite and positive.');
  }
  return Math.max(radius, minimumRadius) * (1 + paddingFraction);
}


/*
  The lens.

  The authored camera convention is `sensor_fit = "VERTICAL"` with Blender's default 24mm sensor
  height, which nothing overrides, and the lens follows from the request's vertical field of view
  as `lens = sensor_height / (2 * tan(fov / 2))`. The two functions below are that formula and its
  exact inverse, so a focal length chosen in the browser is the focal length Cycles renders with.

  This matters beyond naming a number. Mol*'s own default field of view is 45 degrees -- a ~29mm
  lens -- so every browser render was made at that whatever the authored camera said, and no
  control could change it. Nothing new goes on the wire: the lens *is*
  `camera.vertical_fov_degrees`, which the camera schema has always carried.
*/
export const CAMERA_SENSOR_HEIGHT_MM = 24;
/*
  Mol*'s own default, `Camera.createDefaultSnapshot()`'s `fov: Math.PI / 4` in
  mol-canvas3d/camera.js, and the `Field of View` Canvas3D parameter's default of 45. Nothing in
  this app changed it before #focal-length existed, so this is the lens every browser render was
  made at, whatever the authored camera said -- 28.9706mm, which the slider rests at and reads as
  29. Loading a structure deliberately writes **no** lens, so that resting state is Mol*'s own
  camera untouched rather than a value this app dollied to.
*/
export const MOLSTAR_DEFAULT_FOV_DEGREES = 45;
export const DEFAULT_FOCAL_LENGTH_MM = 29;
/*
  The slider's range, in whole millimetres. Both ends are chosen so the resulting angle stays
  comfortably inside the contract's `1 < camera.vertical_fov_degrees < 179`: 8mm is 113 degrees and
  300mm is 4.6. The long end is worth having rather than trimming to something photographic -- a
  300mm lens is nearly orthographic, which is a projection structural figures often want.
*/
export const FOCAL_LENGTH_MIN_MM = 8;
export const FOCAL_LENGTH_MAX_MM = 300;
export const FOCAL_LENGTH_STEP_MM = 1;


function assertPositiveFocalLength(millimetres) {
  if (!Number.isFinite(millimetres) || millimetres <= 0) {
    throw new Error('Focal length must be finite and positive.');
  }
}


export function fovRadiansForFocalLength(millimetres) {
  assertPositiveFocalLength(millimetres);
  return 2 * Math.atan(CAMERA_SENSOR_HEIGHT_MM / (2 * millimetres));
}


export function focalLengthForFovRadians(fov) {
  if (!Number.isFinite(fov) || fov <= 0 || fov >= Math.PI) {
    throw new Error('Field of view must be finite and between 0 and 180 degrees.');
  }
  return CAMERA_SENSOR_HEIGHT_MM / (2 * Math.tan(fov / 2));
}


/*
  A slider position, held inside the range the contract can carry. Anything that is not a number at
  all returns `undefined`, so the caller can put the control back to the live camera rather than
  guess at a lens.
*/
export function clampFocalLength(millimetres) {
  if (!Number.isFinite(millimetres) || millimetres <= 0) return undefined;
  return Math.min(FOCAL_LENGTH_MAX_MM, Math.max(FOCAL_LENGTH_MIN_MM, millimetres));
}


/*
  What the slider and its readout show for a live camera. The slider steps in whole millimetres, so
  a field of view that is between two stops -- Mol*'s own 45-degree default is 28.9706mm, and a
  session saved at any angle is whatever it is -- rounds to the nearest one for display. The camera
  is left where it is: rounding the *readout* is honest, rounding the camera to match would move a
  loaded composition for the sake of a label.
*/
export function focalLengthSliderPosition(millimetres) {
  return String(clampFocalLength(Math.round(millimetres)) ?? FOCAL_LENGTH_MIN_MM);
}


/*
  How far the camera has to move along its own view axis for the subject to stay the size it was
  when the lens changes.

  A real camera crops when you zoom in from one spot, and a control that did only that would make
  every lens change a framing accident to be undone by hand. The reason to reach for 24mm or 135mm
  here is perspective -- how much the near end of the molecule looms over the far end -- and that
  is only legible if the framing holds still while it changes. A subject subtends the same angle
  at distance proportional to `tan(fov / 2)`, so this ratio is that distance, exactly.
*/
export function focalLengthDollyScale(fromFov, toFov) {
  if (!Number.isFinite(fromFov) || !Number.isFinite(toFov)
      || fromFov <= 0 || toFov <= 0 || fromFov >= Math.PI || toFov >= Math.PI) {
    throw new Error('Field of view must be finite and between 0 and 180 degrees.');
  }
  return Math.tan(fromFov / 2) / Math.tan(toFov / 2);
}


/*
  Mol*'s trackball distance limits (`autoAdjustMinMaxDistance`'s params), moved by the same dolly
  that holds the framing for `fov`: `src/preview-canvas.js` has why. Unchanged at Mol*'s own lens.
*/
export function lensScaledOrbitLimits(params, fov) {
  const scale = focalLengthDollyScale((MOLSTAR_DEFAULT_FOV_DEGREES * Math.PI) / 180, fov);
  return {
    minDistanceFactor: params.minDistanceFactor * scale,
    minDistancePadding: params.minDistancePadding * scale,
    maxDistanceFactor: params.maxDistanceFactor * scale,
    maxDistanceMin: params.maxDistanceMin * scale,
  };
}
