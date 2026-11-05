/*
  The session document: its own format, its own extension, a fresh schema version.

  Beside it, at the bottom of this file, is a **one-way `.sprsession` importer** for the earlier
  format that reports what it could not carry. It costs little, it makes years of saved work
  openable, and it is honest in a way that claiming portability would not be.

  **Why a fresh schema rather than a continuation of the older numbering.** The two documents no
  longer describe the same picture -- the looks are re-authored, the older cartoon geometry settings
  have no counterpart, and a selection layer names a representation differently -- so a shared
  version number would be a promise of interchange that neither side keeps. Refusing to continue
  the older numbering is what makes the importer's report meaningful.

  **`SESSION_FORMAT` describes the document rather than naming an application.** It is what
  `parseSessionDocument()` gates on, so changing it is precisely what makes every file already on
  disk unopenable.

  **A document states the secondary-structure *method*, never a per-residue answer.** The assignment
  is computed in-process here from the one `Structure`, so a saved document and a live canvas cannot
  disagree about which residues are helical. An incoming document that carries per-residue
  assignments has them dropped and re-derived.

  **The importer walks the editor state as well as the request**, and that is the larger half of
  the two. Remapping the request field by field while handing `editor_state` -- which is what the
  studio restores every *control* from -- back raw means a `.sprsession` naming a retired look
  opens with the request's field correctly dropped and the picker still set to `ridged`, and a
  `<select>` set to a value no option carries falls back to its first one. That is the silent
  substitution this whole file is arranged against, reached through the fields nobody was watching:
  `cartoon_type` and `ribbon_type`, neither of which names a representation.
*/
import { validatePostProcessing } from './post-processing.js';
import { SECONDARY_STRUCTURE_METHODS } from './secondary-structure.js';
import { REPRESENTATIONS, COLOR_MODES } from './capabilities.js';
import {
  MAX_SELECTION_LAYERS, cartoonTypeForRepresentation, representationSettingControls,
  representationSettingsForRepresentation, ribbonTypeForRepresentation,
} from './selection-model.js';
// For the water default below, rather than a second copy of the colour: the component colours must
// never be written twice.
import { COMPONENT_COLOR_DEFAULTS } from './color-defaults.js';
import { APP_VERSION } from './version.js';
import { quotedValue } from './display-text.js';

export const SESSION_FORMAT = 'protein-render-session';
/*
  **Schema 1, and an optional editor-state field does not move it.** `parseSessionDocument()`
  refuses any other version outright, so a bump is what makes every older file unopenable -- the
  right price for a *changed* field, the wrong one for an added optional field a reader tolerates
  and a writer omits. The camera bookmark is one such field. What `editor_state` holds
  is deliberately not enumerated here, and that ignorance is asserted.
*/
export const SESSION_SCHEMA_VERSION = 1;
/*
  `app_version` is the release that wrote the file, and it is provenance rather than a gate: a
  document without one (everything before 0.1.0) opens, and so does one from a later release, so
  long as its schema is this one.
*/
export const SESSION_FILE_EXTENSION = '.foldray';
/*
  What `.foldray` was called before the name was chosen. Read, never written -- a suffix is not what a
  reader gates on, so a file saved under it opens unchanged and only its name is out of date.
*/
export const SUPERSEDED_SESSION_FILE_EXTENSION = '.rendersession';

/** What a `.sprsession` says it is. Read only by the importer; never written. */
export const LEGACY_SESSION_FORMAT = 'simple-protein-renderer-session';
export const LEGACY_SESSION_FILE_EXTENSION = '.sprsession';

/*
  The water block for a document that has none, shaped as `buildRenderRequest()` writes the untouched
  card: restore reads every field, and anything short of it is a refusal or a reconstruction report.
*/
export function defaultWaterStyle({ withSettings = false } = {}) {
  return {
    enabled: false,
    representation: 'water_dots',
    material: 'glossy',
    color_mode: 'uniform',
    color: COMPONENT_COLOR_DEFAULTS.water.uniform,
    color_overrides: {},
    opacity: 1,
    emission_strength: 3.5,
    ...(withSettings ? { representation_settings: representationSettingsForRepresentation('water_dots') } : {}),
  };
}

const MAX_STRUCTURE_BYTES = 64 * 1024 * 1024;
const MAX_STRUCTURE_BASE64_LENGTH = Math.ceil(MAX_STRUCTURE_BYTES / 3) * 4;
const MAX_SNAPSHOT_LABEL_LENGTH = 60;


function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}


function requireRecord(value, path) {
  if (!isRecord(value)) throw new Error(`${path} must be an object.`);
  return value;
}


function requireFiniteVector(value, path) {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => !Number.isFinite(item))) {
    throw new Error(`${path} must contain three finite numbers.`);
  }
}


function decodedBase64Length(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('render_request.structure_base64 must contain the embedded structure.');
  }
  if (value.length > MAX_STRUCTURE_BASE64_LENGTH || value.length % 4 !== 0) {
    throw new Error('The embedded structure is too large or is not valid base64.');
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.slice(0, -2).includes('=')) {
    throw new Error('render_request.structure_base64 is not valid base64.');
  }
  const padding = value.endsWith('==') ? 2 : (value.endsWith('=') ? 1 : 0);
  return value.length / 4 * 3 - padding;
}


/**
 * One camera, checked field by field.
 *
 * **Exported because there is more than one door a camera comes through.** It arrives inside a
 * saved session as `render_request.camera`, through `window.foldRayView.camera()`, and as the
 * optional `editor_state.saved_camera_view` -- the `Save camera view` bookmark. Three doors and one
 * gate: a camera that reached the Mol\* plugin unchecked would set `fov: NaN` or a zero radius and
 * render a blank picture that looks exactly like a converged one, which is why this is a function
 * rather than a block inside the session validator. **`importDesktopSession()` does not call it**:
 * an imported `.sprsession`'s camera reaches the plugin as the file states it.
 */
export function validateCamera(value, path = 'camera') {
  const camera = requireRecord(value, path);
  if (camera.schema_version !== 1
      || camera.coordinate_system !== 'molstar-model'
      || camera.mode !== 'perspective') {
    throw new Error('The session camera contract is not supported by this app version.');
  }
  requireFiniteVector(camera.position, `${path}.position`);
  requireFiniteVector(camera.target, `${path}.target`);
  requireFiniteVector(camera.up, `${path}.up`);
  if (!Number.isFinite(camera.vertical_fov_degrees)
      || camera.vertical_fov_degrees <= 0
      || camera.vertical_fov_degrees >= 180) {
    throw new Error(`${path}.vertical_fov_degrees is invalid.`);
  }
  if (!Number.isFinite(camera.scene_radius) || camera.scene_radius <= 0) {
    throw new Error(`${path}.scene_radius must be positive.`);
  }
  return camera;
}


function validateRenderRequest(request, path = 'render_request', { embeddedStructure = true } = {}) {
  requireRecord(request, path);
  // No control or direction-override characters, and no longer than a file system allows: the name
  // is shown and written back.
  if (typeof request.filename !== 'string'
      || request.filename.length > 255
      || /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(request.filename)
      || !/^[^/\\]+\.(?:cif|pdb)$/i.test(request.filename)) {
    throw new Error(`${path}.filename must be a local .cif or .pdb filename.`);
  }
  if (embeddedStructure) {
    const structureBytes = decodedBase64Length(request.structure_base64);
    if (structureBytes <= 0 || structureBytes > MAX_STRUCTURE_BYTES) {
      throw new Error(`The embedded structure must be between 1 byte and ${MAX_STRUCTURE_BYTES} bytes.`);
    }
  } else if (request.structure_base64 !== undefined) {
    // Rejected, not merely optional: a snapshot that carried the bytes would be the memory problem
    // `createRenderSnapshot()` exists to avoid, once per entry in the tray.
    throw new Error(`${path} must not embed the structure; a render snapshot holds settings only.`);
  }

  /*
    Which molecule, and `null` is a value rather than an absence.

    A string names a biological assembly the file declares; `null` is the asymmetric unit asked for.
    The field may be missing -- a legacy `.sprsession` has none, and `importDesktopSession()` leaves
    it missing on purpose so the import resolves to the first assembly, which is what those
    documents were written against. What is refused is a number or an object, because `String(1)` would quietly work
    in `buildStructure()` and a document that meant something else would render as assembly "1".
  */
  if (request.assembly !== undefined
      && request.assembly !== null
      && typeof request.assembly !== 'string') {
    throw new Error(`${path}.assembly must be an assembly id or null for the asymmetric unit.`);
  }

  validateCamera(request.camera, `${path}.camera`);

  if (!Array.isArray(request.selection_layers)
      || request.selection_layers.length > MAX_SELECTION_LAYERS) {
    throw new Error(`${path}.selection_layers must contain at most ${MAX_SELECTION_LAYERS} layers.`);
  }
  requireRecord(request.render_settings, `${path}.render_settings`);
  // The one point the tracer divides by: a non-finite one blanks the picture with no note.
  const focusTarget = request.render_settings.depth_of_field?.focus_target;
  if (focusTarget) {
    requireFiniteVector(focusTarget.position, `${path}.render_settings.depth_of_field.focus_target.position`);
  }
  requireRecord(request.lighting_setup, `${path}.lighting_setup`);
  requireRecord(request.ligand_style, `${path}.ligand_style`);
  requireRecord(request.ion_style, `${path}.ion_style`);
  /*
    **Water is filled in rather than required, and that is what lets a document written before it
    existed open at all.** `component_style_schema_version` 2 has no `water_style`, and a version
    that could not draw water drew none -- so the disabled default *is* the picture that document
    was saved as, and `parseSessionDocument()` can go on refusing an unknown schema outright rather
    than every session anybody has saved so far.

    Required once it is there: a block that exists and is malformed is a document saying something
    wrong, which is a different thing from a document saying nothing.
  */
  if (request.water_style === undefined) {
    request.water_style = defaultWaterStyle({
      withSettings: request.representation_style_schema_version === 1,
    });
  }
  requireRecord(request.water_style, `${path}.water_style`);
  /*
    The method, and only the method. A document that carried per-residue assignments would be a
    second answer to "which residues are helical", which the live canvas would then have to be
    reconciled against -- and this tree's whole geometry layer is arranged so that question has
    one answer. `assignments` is therefore rejected rather than ignored: silently dropping it would
    open a saved picture as a different one and say nothing.
  */
  if (request.secondary_structure !== undefined) {
    const secondary = requireRecord(request.secondary_structure, `${path}.secondary_structure`);
    if (!SECONDARY_STRUCTURE_METHODS.includes(secondary.method)) {
      throw new Error(
        `${path}.secondary_structure.method must be one of: ${SECONDARY_STRUCTURE_METHODS.join(', ')}.`,
      );
    }
    if (secondary.assignments !== undefined) {
      throw new Error(
        `${path}.secondary_structure must not carry assignments; this renderer computes them from`
        + ' the structure it draws, so a document states the method only.',
      );
    }
  }
  return request;
}


/*
  A render snapshot: everything a session document holds except the structure.

  This is the load-bearing fact of the render tray. A request base64-encodes the whole structure
  file, up to 64 MB, so twenty-four snapshots that each kept a copy would be hundreds of megabytes
  of strings held live in the tab. They do not need one -- the tray is emptied whenever a structure
  loads, so every snapshot in it belongs to the single structure that is open, and the bytes are
  re-attached from the open structure's when one is written to disk. `validateRenderRequest()` rejects a
  snapshot that carries them, so the shortcut cannot quietly come back.
*/
export function createRenderSnapshot(renderRequest, editorState, renderedAt = new Date().toISOString()) {
  const { structure_base64: bytes, ...settings } = requireRecord(renderRequest, 'render_request');
  void bytes;
  return validateRenderSnapshot({
    rendered_at: renderedAt,
    render_request: settings,
    editor_state: editorState,
  });
}


export function validateRenderSnapshot(snapshot, path = 'render_snapshot') {
  requireRecord(snapshot, path);
  if (typeof snapshot.rendered_at !== 'string' || snapshot.rendered_at.length === 0) {
    throw new Error(`${path}.rendered_at must be a timestamp string.`);
  }
  if (snapshot.label !== undefined
      && (typeof snapshot.label !== 'string'
        || snapshot.label.length === 0
        || snapshot.label.length > MAX_SNAPSHOT_LABEL_LENGTH)) {
    throw new Error(`${path}.label must be a short non-empty string.`);
  }
  validateRenderRequest(snapshot.render_request, `${path}.render_request`, { embeddedStructure: false });
  requireRecord(snapshot.editor_state, `${path}.editor_state`);
  /*
    The achieved sample count travels with the picture. Optional because a snapshot can
    be made before a trace has converged to anything, and a number nobody can state is worse than an
    absent field -- but when it is there it is a fact about this picture, not a target.
  */
  if (snapshot.samples !== undefined
      && (!Number.isInteger(snapshot.samples) || snapshot.samples < 0)) {
    throw new Error(`${path}.samples must be the whole number of samples the picture reached.`);
  }
  if (snapshot.post_processing !== undefined) {
    snapshot.post_processing = validatePostProcessing(snapshot.post_processing, `${path}.post_processing`);
  }
  return snapshot;
}


export function createSessionDocument(
  renderRequest,
  editorState,
  savedAt = new Date().toISOString(),
  postProcessing,
) {
  validateRenderRequest(renderRequest);
  requireRecord(editorState, 'editor_state');
  return {
    format: SESSION_FORMAT,
    schema_version: SESSION_SCHEMA_VERSION,
    app_version: APP_VERSION,
    saved_at: savedAt,
    render_request: renderRequest,
    editor_state: editorState,
    ...(postProcessing !== undefined ? { post_processing: validatePostProcessing(postProcessing) } : {}),
  };
}


export function parseSessionDocument(text) {
  let session;
  try {
    session = JSON.parse(text);
  } catch {
    throw new Error('The selected session file is not valid JSON.');
  }
  requireRecord(session, 'Session');
  /*
    A `.sprsession` is named rather than merely rejected. "This is not a session file" would be
    wrong and unhelpful about the one other file the user plausibly has, and the importer exists
    precisely so the answer can be "that is the legacy format -- here is what came across".
  */
  if (session.format === LEGACY_SESSION_FORMAT) {
    throw new Error(
      'That is an earlier desktop session. Import it instead: it can be read one way,'
      + ' and the report will say what could not be carried.',
    );
  }
  if (session.format !== SESSION_FORMAT) {
    throw new Error('The selected file is not a session this app wrote.');
  }
  validateSessionHeader(session);
  validateRenderRequest(session.render_request);
  requireRecord(session.editor_state, 'editor_state');
  if (session.post_processing !== undefined) {
    session.post_processing = validatePostProcessing(session.post_processing);
  }
  return session;
}


function validateSessionHeader(session) {
  if (session.schema_version !== SESSION_SCHEMA_VERSION) {
    throw new Error(
      `Session schema ${quotedValue(session.schema_version)} is not supported; expected ${SESSION_SCHEMA_VERSION}.`,
    );
  }
  if (session.app_version !== undefined
      && (typeof session.app_version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(session.app_version))) {
    throw new Error('app_version must be the semantic version of the release that wrote the file.');
  }
}


/*
  A share link's document: what a session file holds, less the structure (the link names the
  database instead), the save time and the in-progress selection, plus the structure's digest.
*/
export function createLinkDocument(sessionDocument, structureDigest) {
  const { saved_at: savedAt, render_request: request, editor_state: editorState, ...rest } = sessionDocument;
  const { structure_base64: bytes, ...settings } = request;
  const { current_selection: selection, ...editor } = editorState;
  void savedAt;
  void bytes;
  void selection;
  return { ...rest, render_request: settings, editor_state: editor, structure_digest: structureDigest };
}


/*
  The one reader of a link's document, and deliberately not `parseSessionDocument()`: a link holds
  this format and nothing else -- never the desktop importer, which skips the camera and request
  checks -- and it may not embed a structure.
*/
export function parseLinkDocument(value) {
  const session = requireRecord(value, 'The link');
  if (session.format !== SESSION_FORMAT) throw new Error('This link does not hold a FoldRay session.');
  validateSessionHeader(session);
  validateRenderRequest(session.render_request, 'render_request', { embeddedStructure: false });
  requireRecord(session.editor_state, 'editor_state');
  if (typeof session.structure_digest !== 'string' || !/^[A-Za-z0-9_-]{16}$/.test(session.structure_digest)) {
    throw new Error('This link does not say which structure file it was made from.');
  }
  if (session.post_processing !== undefined) {
    session.post_processing = validatePostProcessing(session.post_processing);
  }
  delete session.editor_state.current_selection;
  return session;
}


/*
  What a `.sprsession` names that this renderer does not have, and what to do about each.

  **A rename is carried and a retirement is not**, and the difference is the whole design of these
  two tables. Five departed looks are the same look under a new name and open as the picture
  they described; two have no counterpart and are reported rather than swapped for
  the nearest thing, which is "refuse rather than substitute" at document scale.

  **The line between them is the look, not the spelling.** `ribbon_fine` is the narrow ribbon,
  which is `ribbon_slender` here. `ribbon_bold` has nothing here near it. **The ids in these tables are the legacy
  vocabulary's, not this tree's**, and an incoming document is judged against that spelling alone.

  **`cartoon_ridged` is the one place the catalogue and the importer part company, and deliberately.**
  The catalogue's railed Styles use `cartoon_railed` because a Style is an *authored design* and the
  rails are what a raised edge reaches for -- a design decision, made once, by us, over 90 things we
  wrote. A `.sprsession` is a record of *a picture somebody made*,
  and no measurement says the railed cord is the ridged bevel: `r > h` is a bevel and cannot raise
  an edge at all, so there is no radius that makes the two the same look.
  Carrying it would open a saved picture as a different picture and say nothing. So the catalogue
  decides and the importer reports, and that asymmetry is the rule rather than an oversight.
*/
/*
  **`cartoon_refined` lands on `cartoon`, and that is a one-line consequence rather than a second
  decision.** `cartoon` carries the slender cross-section (`geom/profiles-catalog.js`), so pointing
  the rename at it is what keeps an incoming document opening as the picture it was made with.
  `cartoon_slender` is here too because a document may carry that id.

  The legacy `slender` cartoon *type* follows with nothing else edited, which is the property the
  note on the type tables below claims: `slender` -> `cartoon_refined` -> here ->
  `cartoonTypeForRepresentation('cartoon')` -> `classic`.
*/
const IMPORT_RENAMES = {
  cartoon_refined: 'cartoon',
  cartoon_slender: 'cartoon',
  cartoon_cylindrical: 'cartoon_geometric',
  ribbon_fine: 'ribbon_slender',
  // Level 1 number for number (`geom/surface-levels.js`' `aliasOf`), and no picker offers the alias.
  surface_refined: 'surface',
};

const IMPORT_RETIREMENTS = {
  cartoon_ridged: 'the ridged cartoon was authored on an edge radius deeper than the face is thick,'
    + ' which is a bevel and cannot raise an edge. The railed looks are what it was reaching for,'
    + ' and choosing one for you would open your picture as a different picture.',
  ribbon_bold: 'the bold ribbon has no counterpart here; the ribbons offered are ribbon and'
    + ' ribbon_slender.',
};

/** The legacy unprefixed layer vocabulary, per component. */
const LAYER_PREFIXES = { nucleic: 'nucleic_', ligand: 'ligand_', ion: 'ion_' };
const ION_LAYER_NAMES = { faceted: 'ion_faceted', spheres: 'ion_spheres' };

// A document's string is looked up among a table's own keys only, never `toString` or `__proto__`.
const own = (table, key) => (Object.hasOwn(table, key) ? table[key] : undefined);

function resolveRepresentation(id, component, report, field = 'representation') {
  if (typeof id !== 'string') return undefined;
  if (own(IMPORT_RETIREMENTS, id)) {
    report.push({ field, value: id, why: own(IMPORT_RETIREMENTS, id) });
    return undefined;
  }
  const renamed = own(IMPORT_RENAMES, id);
  if (renamed) return renamed;
  /*
    The second vocabulary: a layer said `spheres` where a picker said `ligand_spheres`, and the
    legacy format resolved it through an alias table before anything rendered. One vocabulary here, so it
    resolves at the seam that reads the document.

    **The component's own prefix is tried first, and the order is the whole point.** Measured: of
    the fifteen ids the four layer namespaces offer, fourteen resolve
    against our table **by coincidence** -- a ligand layer's `spheres` lands on the *protein* row of
    that name and happens to carry the right family, so the picture is right for a reason that is
    not a rule. Checking the bare id first reproduces exactly that, and it draws a plausible
    picture, which is why the order is stated here rather than left to fall out.
  */
  const prefixed = component === 'ion'
    ? own(ION_LAYER_NAMES, id)
    : `${LAYER_PREFIXES[component] ?? ''}${id}`;
  if (prefixed && Object.hasOwn(REPRESENTATIONS, prefixed)) return prefixed;
  if (Object.hasOwn(REPRESENTATIONS, id)) return id;
  report.push({
    field,
    value: id,
    why: `${quotedValue(id)} is not a representation this renderer has.`,
  });
  return undefined;
}


/*
  The legacy `cartoon_type` and `ribbon_type`, which say the same thing as a representation id
  one grain finer -- and which pass through the same two tables above rather than a third one.

  These two maps are a fact about that older vocabulary and nothing else: they are how its
  pickers composed `cartoon` + `ridged` into `cartoon_ridged`. Routing a type through its own id and
  back out through **our** `cartoonTypeForRepresentation()` is what makes one decision serve both
  grains: renaming a look or retiring one moves `IMPORT_RENAMES` or `IMPORT_RETIREMENTS` and the
  type follows with nothing edited here. A separate table of type renames would be a second copy,
  and it would drift the first time a look moved.

  It matters more than the field count suggests: **many incoming documents name a `cartoon_type`
  and none of them names a representation**, so a document that lost only this field
  would open with its whole look silently replaced by whatever the picker's first option is.
*/
const DESKTOP_CARTOON_TYPE_REPRESENTATIONS = {
  classic: 'cartoon',
  slender: 'cartoon_refined',
  cylindrical: 'cartoon_cylindrical',
  ridged: 'cartoon_ridged',
};

const DESKTOP_RIBBON_TYPE_REPRESENTATIONS = {
  standard: 'ribbon',
  fine: 'ribbon_fine',
  bold: 'ribbon_bold',
};

function resolveLookType(type, desktopIds, ourTypeFor, field, report) {
  if (typeof type !== 'string') return undefined;
  const desktopId = own(desktopIds, type);
  if (!desktopId) {
    report.push({ field, value: type, why: `${quotedValue(type)} is not a look this renderer offers.` });
    return undefined;
  }
  if (own(IMPORT_RETIREMENTS, desktopId)) {
    // The value the document actually held, not the id it was resolved through -- a report that
    // named `cartoon_ridged` for a field spelled `ridged` sends the reader looking for the wrong
    // thing.
    report.push({ field, value: type, why: IMPORT_RETIREMENTS[desktopId] });
    return undefined;
  }
  return ourTypeFor(own(IMPORT_RENAMES, desktopId) ?? desktopId);
}

/*
  The geometry settings the legacy format carried that have no meaning here, and the atom radii that
  survive beside them.

  One list, read by the render request and by every saved control block in the editor state, because
  a second copy is how the two halves of one document start disagreeing about what came across.
*/
const GONE_SETTINGS = ['scale_radius', 'probe_size', 'relaxation_steps', 'backbone_radius',
  'backbone_smoothing', 'nucleic_width', 'nucleic_thickness', 'nucleic_radius',
  'nucleic_backbone_radius', 'base_width', 'base_thickness', 'base_length'];

const GONE_SETTINGS_WHY =
  'the surface and backbone geometry numbers are authored here rather than exposed.';

const CARTOON_SETTINGS_WHY =
  'a cartoon\u2019s width, thickness and loop radius are authored per look here rather than being'
  + ' controls, so there is nothing for these four numbers to adjust.';

function withoutGoneSettings(settings, path, report) {
  if (!isRecord(settings)) return undefined;
  const kept = { ...settings };
  for (const field of GONE_SETTINGS) {
    if (kept[field] === undefined) continue;
    report.push({ field: `${path}.${field}`, value: kept[field], why: GONE_SETTINGS_WHY });
    delete kept[field];
  }
  return kept;
}


const UNKNOWN_SETTING_WHY = (representation) =>
  `${representation} offers no such control here, so there is nothing for the number to adjust.`;


/*
  A legacy settings block, narrowed to the fields the representation it resolved to actually has.

  **The list above is not enough on its own.** `GONE_SETTINGS` names the fields and gives each one
  its sentence, which is the half worth keeping. What it cannot do is leave a block the studio can
  restore: strip a surface's three and `{}` is what is left, a settings object with no
  `grid_resolution` in it, which `validatedRepresentationSettings()` refuses because the panel is
  derived from the rung. Without this, a legacy session whose protein is a surface, a ribbon or a
  nucleic backbone does not open at all.

  Narrowing rather than stripping also reaches every block, not only the protein's own: the three
  component styles and every selection layer.

  `undefined` when nothing survives, so the studio falls back to the look's authored numbers -- and
  **only when the representation resolved**: an id this renderer does not have answers `[]` here for
  the same reason an unknown one does, and dropping a block on that basis would report a field as
  missing when what is missing is the look.
*/
function importedSettings(settings, representation, path, report) {
  const kept = withoutGoneSettings(settings, path, report);
  if (!kept) return undefined;
  // `[]` for an unresolved id, which is the *keep it all* case rather than the drop-it-all one.
  const offered = representation
    ? representationSettingControls(representation).map(([field]) => field)
    : [];
  const narrowed = {};
  for (const [field, value] of Object.entries(kept)) {
    if (offered.length === 0 || offered.includes(field)) narrowed[field] = value;
    // The report is printed, so a key that is not id-shaped is not repeated.
    else report.push({ field: `${path}.${/^[a-z0-9_]{1,40}$/.test(field) ? field : '(an unrecognised field)'}`, value, why: UNKNOWN_SETTING_WHY(representation) });
  }
  return Object.keys(narrowed).length > 0 ? narrowed : undefined;
}


/*
  One saved control block -- `protein_controls`, or one selection layer's -- carried across.

  **This is the half of the document the studio restores its controls from.** Handing it back
  untouched while the request is remapped field by field opens a session naming a retired look with
  the request's field correctly dropped and the *picker* still saying `ridged`. A control set to a
  value no option carries falls back to the first option, which is the silent substitution the
  whole importer exists to prevent.

  A layer's own component comes from the request's layer at the same index: the editor state's
  layers carry no `component_type` of their own -- they are positional companions to the request's,
  which is the incoming document's arrangement and not something to correct on the way in.
*/
function importControls(controls, component, path, report) {
  const next = { ...controls };

  if (controls.representation !== undefined) {
    const resolved = resolveRepresentation(
      controls.representation, component, report, `${path}.representation`,
    );
    if (resolved) next.representation = resolved;
    else delete next.representation;
  }

  for (const [field, desktopIds, ourTypeFor] of [
    ['cartoon_type', DESKTOP_CARTOON_TYPE_REPRESENTATIONS, cartoonTypeForRepresentation],
    ['ribbon_type', DESKTOP_RIBBON_TYPE_REPRESENTATIONS, ribbonTypeForRepresentation],
  ]) {
    if (controls[field] === undefined) continue;
    const resolved = resolveLookType(
      controls[field], desktopIds, ourTypeFor, `${path}.${field}`, report,
    );
    if (resolved) next[field] = resolved;
    else delete next[field];
  }

  if (controls.cartoon_settings !== undefined) {
    report.push({
      field: `${path}.cartoon_settings`, value: controls.cartoon_settings, why: CARTOON_SETTINGS_WHY,
    });
    delete next.cartoon_settings;
  }

  const settings = importedSettings(
    controls.representation_settings, next.representation, `${path}.representation_settings`, report,
  );
  if (settings) next.representation_settings = settings;
  else delete next.representation_settings;

  return next;
}


/*
  The editor state, walked through the same rules as the request.

  Everything this does not name is carried verbatim, which is deliberate: the editor state is
  free-form by that format's own design, and a document is not made more honest by dropping fields
  nobody has established a meaning for. What is named here is exactly the vocabulary that moved.
*/
function importEditorState(state, requestLayers, report) {
  if (!isRecord(state)) return {};
  const next = { ...state };
  if (isRecord(state.protein_controls)) {
    next.protein_controls = importControls(
      state.protein_controls, 'protein', 'editor_state.protein_controls', report,
    );
  }
  if (Array.isArray(state.selection_layers)) {
    next.selection_layers = state.selection_layers.map((layer, index) => (
      isRecord(layer)
        ? importControls(
          layer,
          requestLayers[index]?.component_type ?? 'protein',
          `editor_state.selection_layers[${index}]`,
          report,
        )
        : layer
    ));
  }
  return next;
}


/**
 * Read a legacy `.sprsession`, best-effort, and say what could not be carried.
 *
 * **One way, and deliberately so.** Nothing here writes a `.sprsession` back: this is an importer
 * rather than a portability claim, and a round trip would be a promise that the two renderers draw
 * the same picture.
 *
 * Returns `{ request, editorState, postProcessing, dropped }`. `dropped` is the report and it is
 * never empty of meaning: an entry names the field, the value and the reason, because "some
 * settings could not be imported" is the message that makes a user re-check everything.
 */
export function importDesktopSession(text) {
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }
  requireRecord(document, 'Session');
  if (document.format !== LEGACY_SESSION_FORMAT) {
    throw new Error('The selected file is not an earlier desktop session.');
  }
  const saved = requireRecord(document.render_request, 'render_request');
  const dropped = [];

  const request = { ...saved };

  // The cartoon geometry settings the legacy format carried. A look *is* its numbers here, so there
  // is nothing for these to modulate.
  if (saved.cartoon_settings !== undefined) {
    delete request.cartoon_settings;
    dropped.push({
      field: 'cartoon_settings', value: saved.cartoon_settings, why: CARTOON_SETTINGS_WHY,
    });
  }

  if (saved.secondary_structure !== undefined) {
    const source = saved.secondary_structure.source;
    const method = { 'molstar-auto': 'auto', 'molstar-zhang-skolnick': 'zhang-skolnick' }[source];
    if (method) {
      request.secondary_structure = { method };
    } else {
      delete request.secondary_structure;
      dropped.push({
        field: 'secondary_structure.source',
        value: source,
        why: 'that assignment method is not one this renderer offers. The structure is re-assigned'
          + ' with the default method.',
      });
    }
  }

  for (const [key, component] of [
    ['representation', 'protein'], ['nucleic_style', 'nucleic'],
    ['ligand_style', 'ligand'], ['ion_style', 'ion'], ['water_style', 'water'],
  ]) {
    if (key === 'representation') {
      const resolved = resolveRepresentation(saved.representation, 'protein', dropped);
      if (resolved) request.representation = resolved;
      else delete request.representation;
      continue;
    }
    // No legacy session carries water, and restore reads the block like any other.
    if (key === 'water_style' && saved[key] === undefined) {
      request[key] = defaultWaterStyle();
      continue;
    }
    if (!isRecord(saved[key])) continue;
    const resolved = resolveRepresentation(
      saved[key].representation, component, dropped, `${key}.representation`,
    );
    request[key] = { ...saved[key] };
    if (resolved) request[key].representation = resolved;
    else delete request[key].representation;
  }

  /*
    The settings blocks, after the loop above and never before it: which fields survive is a
    question about the id each block will be drawn as, and that id is what the loop resolves.
    Every block is narrowed, including the three component styles and every layer --
    `importedSettings()` carries why narrowing only the protein's is not survivable.
  */
  for (const [block, settingsPath] of [
    [request, 'representation_settings'],
    [request.nucleic_style, 'nucleic_style.representation_settings'],
    [request.ligand_style, 'ligand_style.representation_settings'],
    [request.ion_style, 'ion_style.representation_settings'],
    [request.water_style, 'water_style.representation_settings'],
  ]) {
    if (!isRecord(block)) continue;
    const settings = importedSettings(
      block.representation_settings, block.representation, settingsPath, dropped,
    );
    if (settings) block.representation_settings = settings;
    else delete block.representation_settings;
  }

  const layers = Array.isArray(saved.selection_layers) ? saved.selection_layers : [];
  request.selection_layers = layers.map((layer, index) => {
    if (!isRecord(layer)) return layer;
    // `component_type` is the legacy format's name for this field and this tree's too.
    const resolved = resolveRepresentation(
      layer.representation, layer.component_type, dropped,
      `selection_layers[${index}].representation`,
    );
    const next = { ...layer };
    if (resolved) next.representation = resolved;
    else delete next.representation;
    const settings = importedSettings(
      layer.representation_settings,
      resolved,
      `selection_layers[${index}].representation_settings`,
      dropped,
    );
    if (settings) next.representation_settings = settings;
    else delete next.representation_settings;
    return next;
  });

  if (saved.color_mode && !Object.hasOwn(COLOR_MODES, saved.color_mode)) {
    dropped.push({
      field: 'color_mode',
      value: saved.color_mode,
      why: `${quotedValue(saved.color_mode)} is not a colour mode this renderer has.`,
    });
    delete request.color_mode;
  }

  let postProcessing;
  if (document.post_processing !== undefined) {
    try {
      postProcessing = validatePostProcessing(document.post_processing);
    } catch (error) {
      dropped.push({
        field: 'post_processing',
        value: document.post_processing,
        why: error.message,
      });
    }
  }

  return {
    request,
    editorState: importEditorState(document.editor_state, layers, dropped),
    postProcessing,
    dropped,
  };
}


/*
  Why an imported request cannot be opened, or `undefined`. A representation that did not resolve
  leaves restore either throwing on `undefined` or putting a picker's first option in its place, so
  the refusal is made here, before anything is cleared, and carries the report's own sentence.
*/
export function desktopImportRefusal({ request, dropped = [] }) {
  const missing = [];
  if (request.representation === undefined) missing.push('representation');
  for (const key of ['nucleic_style', 'ligand_style', 'ion_style', 'water_style']) {
    if (isRecord(request[key]) && request[key].representation === undefined) {
      missing.push(`${key}.representation`);
    }
  }
  (Array.isArray(request.selection_layers) ? request.selection_layers : []).forEach((layer, index) => {
    if (isRecord(layer) && layer.representation === undefined) {
      missing.push(`selection_layers[${index}].representation`);
    }
  });
  if (missing.length === 0) return undefined;
  const reasons = missing.map((field) => {
    const entry = dropped.find((item) => item.field === field);
    return entry ? `${field} ${quotedValue(entry.value)}: ${entry.why}` : `${field}: the document names none.`;
  });
  return 'This earlier session was not imported, because it draws something as a look this renderer'
    + ` does not have — ${reasons.join(' · ')}`;
}


export function base64ToBytes(value) {
  decodedBase64Length(value);
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}


/*
  `suffix` names one render inside the structure's session, e.g. `sessionFilename('3RGK.cif',
  'Render 3')`. One place decides what characters are safe in a written filename, so the per-render
  image download derives its name from this too rather than sanitising a second way.
*/
export function sessionFilename(structureFilename, suffix = '') {
  const safe = (value) => String(value)
    .replace(/^.*[/\\]/, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const basename = safe(String(structureFilename || 'protein').replace(/\.(?:cif|pdb)$/i, '')) || 'protein';
  const tail = safe(suffix);
  return `${basename}${tail ? `-${tail}` : ''}${SESSION_FILE_EXTENSION}`;
}
