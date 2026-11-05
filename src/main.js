/*
  The studio: the control surface, wired.

  **The scaffolding page is kept separate from the studio's own path, and that separation is
  load-bearing.** A page carrying `?structure=` is the scaffolding page: it loads a sample straight
  into the tracer and traces one pinned request, byte for byte, with no studio around it. A
  structure loaded through the File menu is the studio's, and from that moment the trace is built
  from the controls. The two never run together and the handover is one-way.
*/
import { assetUrl } from './asset-base.js';
import { ensureScenePipeline } from './scene-pipeline.js';
import {
  ready, render, cancel as cancelTrace, capabilities, claimRenderer, createLiveTrace,
} from './render-backend.js';
// The interaction ladder's two constants, from the module that owns them rather than through the
// render seam -- the scaffolding page's `ResizeObserver` below schedules the same way the live
// trace does, and one spelling of each is what keeps that true.
import { INTERACTIVE_SCALE, SETTLE_MS } from './interactive-ladder.js';
import {
  REPRESENTATIONS, COLOR_MODES, NOT_BUILT, DEFAULT_VIEW_TRANSFORM, GRADIENT_COLOR_MODES,
} from './capabilities.js';

import {
  allAtomRepresentation,
  ATOM_SCOPE_OPTIONS,
  atomScopeForRepresentation,
  CARTOON_TYPE_OPTIONS,
  cartoonTypeForRepresentation,
  componentTypeSummary,
  constrainedRepresentationSetting,
  DEFAULT_CARTOON_TYPE,
  isBooleanRepresentationSetting,
  MAX_SELECTION_LAYERS,
  narrowedRepresentationSettings,
  polymerChainSelectionSchema,
  polymerChainShortcuts,
  repairedRepresentationSettings,
  representationForAtomScope,
  representationForCartoonType,
  representationForRibbonType,
  representationForSurfaceDetail,
  representationSettingControls,
  representationSettingValue,
  representationOptionsForComponents,
  representationSettingsForRepresentation,
  representationSupportsAtomColors,
  RIBBON_TYPE_OPTIONS,
  ribbonTypeForRepresentation,
  compressResidues,
  normalizeResidues,
  selectionSummary,
  SURFACE_DETAIL_OPTIONS,
  surfaceDetailForRepresentation,
  validatedRepresentationSettings,
} from './selection-model.js';
import {
  CAMERA_FRAME_PADDING_FRACTION,
  clampFocalLength,
  focalLengthDollyScale,
  focalLengthForFovRadians,
  focalLengthSliderPosition,
  fovRadiansForFocalLength,
  paddedCameraFrameRadius,
} from './camera-framing.js';
import { moveItem, moveItemBeside } from './layer-order.js';
import { catalogOptions } from './catalog/index.js';
import { EMISSION_TUNABLE, MATERIAL_CATALOG } from './catalog/materials.js';
import { initSwatchPickers, refreshSwatchPickers } from './swatch-picker.js';
import { detectStructureMetric } from './structure-metrics.js';
import {
  base64ToBytes,
  createLinkDocument,
  createRenderSnapshot,
  createSessionDocument,
  defaultWaterStyle,
  desktopImportRefusal,
  importDesktopSession,
  validateCamera,
  LEGACY_SESSION_FORMAT,
  parseLinkDocument,
  parseSessionDocument,
  sessionFilename,
  SESSION_FILE_EXTENSION,
} from './session-format.js';
import { createHistory } from './history.js';
import { initLauncher } from './launcher.js';
import { initRailCards } from './rail-cards.js';
import { announceOverlayOpen, coordinateOverlay } from './overlay-coordinator.js';
import {
  createSessionLifecycle,
  supportsFileSystemAccess,
} from './session-lifecycle.js';
import {
  clampLightingAngles,
  DEFAULT_LIGHTING_SOURCE,
  environmentImagePath,
  formatLightingDegrees,
  lightingAnglesFromDrag,
  lightingAnglesFromKey,
  lightingCompassProjection,
  LIGHTING_SOURCE_PROFILES,
  lightingSourceProfile,
} from './lighting-compass.js';
import { downloadPdbStructure, validatedPdbId } from './pdb-source.js';
import { downloadAlphaFoldStructure, validatedUniProtAccession } from './alphafold-source.js';
import { decompressStructure, MAX_STRUCTURE_BYTES } from './structure-decompress.js';
import {
  decodeShareFragment, encodeShareFragment, isShareFragment, shareLinkBase, structureDigest,
  structureSource,
} from './share-link.js';
import { triggerDownload } from './download.js';
import { withPngText } from './png-text.js';
import { APP_CHANNEL, APP_SIGNATURE, APP_VERSION } from './version.js';
import { renderProgressPresentation } from './render-progress.js';
import {
  COMPONENT_COLOR_DEFAULTS,
  defaultCategoryColor,
  metricColorStopLabels,
  normalizeElementSymbol,
  suggestGradientColor,
  UNIFORM_COLOR_PRESETS,
} from './color-defaults.js';
import {
  DEFAULT_SECONDARY_STRUCTURE_METHOD,
  SECONDARY_STRUCTURE_AUTO_LABEL,
  SECONDARY_STRUCTURE_AUTO_LABELS,
} from './secondary-structure.js';
import { nucleicBaseLabel } from './color.js';
import { initStyles } from './styles-strip.js';
import { initOpeningScreen } from './opening-screen.js';
import { STYLE_BASELINE, STYLE_CATALOG, styleById } from './catalog/styles.js';
import { displayText, quotedValue } from './display-text.js';
import { resolveOverlayScope, styleOverlays } from './style-overlays.js';
import { structureProfile, profileFacts } from './structure-profile.js';
import { recommendStyles } from './style-recommendations.js';
import { initStageModes } from './stage-modes.js';
import { initRenderZoom } from './render-zoom.js';
import { createSequenceStrip } from './sequence-strip.js';
import { createStageNotes } from './stage-notes.js';
import { focusGranularityForPick, focusPointFromPositions } from './focus-target.js';
/*
  Mol* itself, for the half of this file that talks to the preview canvas.

  **These are the `mol-model` half and they are the only Mol* this file may import.** A static
  import of anything under `mol-plugin-state` pulls the plugin's own graph into the entry chunk,
  which is exactly what `ensurePreview()`'s dynamic `import()` exists to keep out of it -- and a
  lazy import deferring a graph a sibling import pays for eagerly is a failure a dynamic `import()`
  cannot report. Measured on one build: **2,114 KiB of eager JS (600 KiB gzipped) with two such
  helpers imported here, against 1,530 KiB (449 KiB) without them.**

  So: `mol-model` here, `mol-plugin*` only inside `./preview-canvas.js`. Selection painting is
  `preview.paintSelectionLayers()`, and `Color` lives there with it. `mol-model/loci.js` pulls
  Mol*'s GL layer, so `Loci` comes through that import too.
*/
import {
  Structure, StructureElement, StructureProperties,
} from 'molstar/lib/mol-model/structure.js';
import { MolScriptBuilder as MS } from 'molstar/lib/mol-script/language/builder.js';
// Bound by ensurePreview(); every reader runs after the preview has loaded.
let EmptyLoci;
let Loci;
let FOCUS_LOCI_OPTIONS;

// The stage's own box. Everything over the live view is absolutely positioned inside it, and the
// live trace follows it -- so nothing here may ever change its size.
const viewerPanel = document.querySelector('.viewer-panel');
/*
  The stage element itself, which this file touches for exactly one thing: `data-tracing`.

  Named `stageRoot` because `stage` is already `initStageModes()`'s controller, and the two are
  different kinds of object -- the node, and the module that paints into it.
*/
const stageRoot = document.querySelector('.stage');
const previewHost = document.querySelector('#viewer');
// Class only, no id: the sequence region adds none to `index.html`.
const sequenceRegion = document.querySelector('.sequence-region');
const fileInput = document.querySelector('#structure-file');
// The visible half of #structure-file. The input itself is hidden and still owns every load,
// validation and error path -- this only opens it.
const fileBrowseButton = document.querySelector('#structure-file-browse');
const pdbLoadForm = document.querySelector('#pdb-load-form');
const pdbIdInput = document.querySelector('#pdb-id');
const pdbLoadButton = document.querySelector('#load-pdb');
const alphafoldLoadForm = document.querySelector('#alphafold-load-form');
const alphafoldIdInput = document.querySelector('#alphafold-id');
const alphafoldLoadButton = document.querySelector('#load-alphafold');
const sessionFileInput = document.querySelector('#session-file');
const loadSessionButton = document.querySelector('#load-session');
const saveSessionButton = document.querySelector('#save-session');
const copyShareLinkButton = document.querySelector('#copy-share-link');
const newSessionButton = document.querySelector('#new-session');
const fileMenu = document.querySelector('details.menu');
const sessionNameLabel = document.querySelector('#session-name');
const sessionStateLabel = document.querySelector('#session-state');
const historyUndoButton = document.querySelector('#history-undo');
const historyRedoButton = document.querySelector('#history-redo');
const historySettingsUndoButton = document.querySelector('#history-undo-settings');
const historySettingsRedoButton = document.querySelector('#history-redo-settings');
const fitVisibleButton = document.querySelector('#fit-visible-structure');
const saveCameraViewButton = document.querySelector('#save-camera-view');
const goToSavedCameraViewButton = document.querySelector('#go-to-saved-camera-view');
const renderButton = document.querySelector('#render');
const cancelButton = document.querySelector('#cancel-render');
const loadStatus = document.querySelector('#load-status');
const loadStatusHolder = loadStatus.closest('.topbar-status');
const renderStatus = document.querySelector('#render-status');
const renderProgressRegion = document.querySelector('#render-progress-region');
const renderProgress = document.querySelector('#render-progress');
const renderProgressDetail = document.querySelector('#render-progress-detail');
const sequenceDrawerToggle = document.querySelector('#sequence-drawer-toggle');
const sequenceDrawerBar = document.querySelector('.sequence-drawer-bar');
const selectionPanel = document.querySelector('#selection-panel');
const selectionCount = document.querySelector('#selection-count');
const currentSelectionStatus = document.querySelector('#current-selection-status');
const addSelectionButton = document.querySelector('#add-selection-layer');
const hideSelectionButton = document.querySelector('#hide-current-selection');
const clearSelectionButton = document.querySelector('#clear-current-selection');
const chainPicker = document.querySelector('#chain-picker');
const chainShortcuts = document.querySelector('#chain-shortcuts');
const emptyLayersMessage = document.querySelector('#empty-selection-layers');
const selectionLayersElement = document.querySelector('#selection-layers');
const selectionOrderStatus = document.querySelector('#selection-order-status');
const inspectModeButton = document.querySelector('#inspect-mode');
const selectModeButton = document.querySelector('#select-mode');
const pickingLevelGroup = document.querySelector('#picking-level');
const pickingLevelButtons = [...document.querySelectorAll('[data-picking-level]')];
const interactionModeStatus = document.querySelector('#interaction-mode-status');
const styleControls = document.querySelector('#style-controls');
const representationInput = document.querySelector('#representation');
const cartoonTypeControl = document.querySelector('#cartoon-type-control');
const cartoonTypeInput = document.querySelector('#cartoon-type');
const secondaryStructureControl = document.querySelector('#secondary-structure-control');
const secondaryStructureMethodInput = document.querySelector('#secondary-structure-method');
const secondaryStructureAutoOption = secondaryStructureMethodInput.querySelector('option[value="auto"]');
const assemblyInput = document.querySelector('#structure-assembly');
const proteinRepresentationSettings = document.querySelector('#protein-representation-settings');
const proteinRepresentationSettingsGrid = document.querySelector('#protein-representation-settings-grid');
const proteinRepresentationSettingsHelp = document.querySelector('#protein-representation-settings-help');
const ribbonTypeControl = document.querySelector('#ribbon-type-control');
const ribbonTypeInput = document.querySelector('#ribbon-type');
const atomScopeControl = document.querySelector('#atom-scope-control');
const atomScopeInput = document.querySelector('#atom-scope');
const surfaceDetailControl = document.querySelector('#surface-detail-control');
const surfaceDetailInput = document.querySelector('#surface-detail');
const materialInput = document.querySelector('#material');
const lightingSource = document.querySelector('#lighting-source');
const lightingStrength = document.querySelector('#lighting-strength');
const lightingStrengthValue = document.querySelector('#lighting-strength-value');
const lightingAnchor = document.querySelector('#lighting-anchor');
const lightingAngleControl = document.querySelector('#lighting-angle-control');
const hdriElevation = document.querySelector('#hdri-elevation');
const hdriAzimuth = document.querySelector('#hdri-azimuth');
const lightingCompass = document.querySelector('#lighting-compass');
const lightingCompassHeading = document.querySelector('#lighting-compass-heading');
const lightingCompassKind = document.querySelector('#lighting-compass-kind');
const lightingCompassLine = document.querySelector('#lighting-compass-line');
const lightingCompassMarker = document.querySelector('#lighting-compass-marker');
const lightingCompassValues = document.querySelector('#lighting-compass-values');
const reflectionEnvironment = document.querySelector('#reflection-environment');
const reflectionColorControl = document.querySelector('#reflection-color-control');
const reflectionColorWheel = document.querySelector('#reflection-color-wheel');
const reflectionColorHex = document.querySelector('#reflection-color-hex');
const colorPresets = document.querySelector('#color-presets');
const colorWheel = document.querySelector('#color-wheel');
const colorHex = document.querySelector('#color-hex');
const proteinColorMode = document.querySelector('#protein-color-mode');
const proteinColorCapability = document.querySelector('#protein-color-capability');
const colorControl = document.querySelector('#color-control');
const proteinGradientControl = document.querySelector('#protein-gradient-control');
const proteinGradientStartWheel = document.querySelector('#protein-gradient-start-wheel');
const proteinGradientStartHex = document.querySelector('#protein-gradient-start-hex');
const proteinGradientEndWheel = document.querySelector('#protein-gradient-end-wheel');
const proteinGradientEndHex = document.querySelector('#protein-gradient-end-hex');
const proteinGradientMidpointsElement = document.querySelector('#protein-gradient-midpoints');
const proteinGradientAddColor = document.querySelector('#protein-gradient-add-color');
const proteinGradientCount = document.querySelector('#protein-gradient-count');
const proteinOpacity = document.querySelector('#protein-opacity');
const proteinOpacityValue = document.querySelector('#protein-opacity-value');
const proteinEmissionControl = document.querySelector('#protein-emission-control');
const proteinEmissionStrength = document.querySelector('#protein-emission-strength');
const proteinEmissionValue = document.querySelector('#protein-emission-value');
const proteinCategoryColors = document.querySelector('#protein-category-colors');
const nucleicStyleControl = document.querySelector('#nucleic-style-control');
const nucleicEnabled = document.querySelector('#nucleic-enabled');
const nucleicKindStatus = document.querySelector('#nucleic-kind');
const nucleicRepresentation = document.querySelector('#nucleic-representation');
const nucleicMaterial = document.querySelector('#nucleic-material');
const nucleicColorMode = document.querySelector('#nucleic-color-mode');
const nucleicColorWheel = document.querySelector('#nucleic-color-wheel');
const nucleicColorHex = document.querySelector('#nucleic-color-hex');
const nucleicGradientStartWheel = document.querySelector('#nucleic-gradient-start-wheel');
const nucleicGradientStartHex = document.querySelector('#nucleic-gradient-start-hex');
const nucleicGradientEndWheel = document.querySelector('#nucleic-gradient-end-wheel');
const nucleicGradientEndHex = document.querySelector('#nucleic-gradient-end-hex');
const nucleicGradientMidpointsElement = document.querySelector('#nucleic-gradient-midpoints');
const nucleicGradientAddColor = document.querySelector('#nucleic-gradient-add-color');
const nucleicGradientCount = document.querySelector('#nucleic-gradient-count');
const nucleicGradientStartLabel = document.querySelector('#nucleic-gradient-start-label');
const nucleicGradientEndLabel = document.querySelector('#nucleic-gradient-end-label');
const nucleicGradientHelp = document.querySelector('#nucleic-gradient-help');
const nucleicCategoryColors = document.querySelector('#nucleic-category-colors');
const nucleicBaseShapeControl = document.querySelector('#nucleic-base-shape-control');
const nucleicBaseShape = document.querySelector('#nucleic-base-shape');
const nucleicRepresentationSettings = document.querySelector('#nucleic-representation-settings');
const nucleicRepresentationSettingsGrid = document.querySelector('#nucleic-representation-settings-grid');
const nucleicRepresentationSettingsHelp = document.querySelector('#nucleic-representation-settings-help');
const nucleicEmissionControl = document.querySelector('#nucleic-emission-control');
const nucleicEmissionStrength = document.querySelector('#nucleic-emission-strength');
const nucleicEmissionValue = document.querySelector('#nucleic-emission-value');
const nucleicOpacity = document.querySelector('#nucleic-opacity');
const nucleicOpacityValue = document.querySelector('#nucleic-opacity-value');
const ligandStyleControl = document.querySelector('#ligand-style-control');
const ligandEnabled = document.querySelector('#ligand-enabled');
const ligandHidePolyatomicIons = document.querySelector('#ligand-hide-polyatomic-ions');
const ligandRepresentation = document.querySelector('#ligand-representation');
const ligandMaterial = document.querySelector('#ligand-material');
const ligandColorMode = document.querySelector('#ligand-color-mode');
const ligandColorWheel = document.querySelector('#ligand-color-wheel');
const ligandColorHex = document.querySelector('#ligand-color-hex');
const ligandGradientStartWheel = document.querySelector('#ligand-gradient-start-wheel');
const ligandGradientStartHex = document.querySelector('#ligand-gradient-start-hex');
const ligandGradientEndWheel = document.querySelector('#ligand-gradient-end-wheel');
const ligandGradientEndHex = document.querySelector('#ligand-gradient-end-hex');
const ligandGradientMidpointsElement = document.querySelector('#ligand-gradient-midpoints');
const ligandGradientAddColor = document.querySelector('#ligand-gradient-add-color');
const ligandGradientCount = document.querySelector('#ligand-gradient-count');
const ligandOpacity = document.querySelector('#ligand-opacity');
const ligandOpacityValue = document.querySelector('#ligand-opacity-value');
const ligandEmissionControl = document.querySelector('#ligand-emission-control');
const ligandEmissionStrength = document.querySelector('#ligand-emission-strength');
const ligandEmissionValue = document.querySelector('#ligand-emission-value');
const ligandCategoryColors = document.querySelector('#ligand-category-colors');
const ionCategoryColors = document.querySelector('#ion-category-colors');
const ligandRepresentationSettings = document.querySelector('#ligand-representation-settings');
const ligandRepresentationSettingsGrid = document.querySelector('#ligand-representation-settings-grid');
const ligandRepresentationSettingsHelp = document.querySelector('#ligand-representation-settings-help');
const ionStyleControl = document.querySelector('#ion-style-control');
const ionEnabled = document.querySelector('#ion-enabled');
/*
  Ligands and ions are drawn on a fresh page, but that default is nobody's choice: until the user, a
  Style or a document sets a switch, it follows the structure, and a Style silent about the component
  turns it off -- as when the page started with both off, which is how the tiles were baked.
*/
const unchosenComponentSwitches = new Set(['ligands', 'ions']);
const ionRepresentation = document.querySelector('#ion-representation');
const ionMaterial = document.querySelector('#ion-material');
const ionColorMode = document.querySelector('#ion-color-mode');
const ionColorWheel = document.querySelector('#ion-color-wheel');
const ionColorHex = document.querySelector('#ion-color-hex');
const ionFluorescenceControl = document.querySelector('#ion-fluorescence-control');
const ionFluorescence = document.querySelector('#ion-fluorescence');
const ionFluorescenceValue = document.querySelector('#ion-fluorescence-value');
const ionOpacity = document.querySelector('#ion-opacity');
const ionOpacityValue = document.querySelector('#ion-opacity-value');
const ionRepresentationSettings = document.querySelector('#ion-representation-settings');
const ionRepresentationSettingsGrid = document.querySelector('#ion-representation-settings-grid');
const ionRepresentationSettingsHelp = document.querySelector('#ion-representation-settings-help');
const waterStyleControl = document.querySelector('#water-style-control');
const waterEnabled = document.querySelector('#water-enabled');
const waterMaterial = document.querySelector('#water-material');
/*
  Water has one look and one colour mode, so neither is a control -- and a field with no control is
  not the same thing as a field nobody writes, which is the rule `render_settings.seed` and the live
  sample target already stand on. Both are still in the request, still saved, still restored, and
  still stepped through undo; they simply have one value.

  `waterColorMode` is the shape the shared component reader asks for rather than a select, because
  `updateComponentStyleControl()` and `colorModesForComponents()` both read `.value` off whatever
  they are handed.
*/
const WATER_REPRESENTATION = 'water_dots';
const waterColorMode = Object.freeze({ value: 'uniform' });
const waterColorWheel = document.querySelector('#water-color-wheel');
const waterColorHex = document.querySelector('#water-color-hex');
const waterEmissionControl = document.querySelector('#water-emission-control');
const waterEmissionStrength = document.querySelector('#water-emission-strength');
const waterEmissionValue = document.querySelector('#water-emission-value');
const waterOpacity = document.querySelector('#water-opacity');
const waterOpacityValue = document.querySelector('#water-opacity-value');
const waterRepresentationSettings = document.querySelector('#water-representation-settings');
const waterRepresentationSettingsGrid = document.querySelector('#water-representation-settings-grid');
const waterRepresentationSettingsHelp = document.querySelector('#water-representation-settings-help');
const componentPicker = document.querySelector('#component-picker');
const componentShortcuts = document.querySelector('#component-shortcuts');
const cameraRenderSettings = document.querySelector('#camera-render-settings');
const renderWidth = document.querySelector('#render-width');
const renderHeight = document.querySelector('#render-height');
const renderSamples = document.querySelector('#render-samples');
const renderDenoising = document.querySelector('#render-denoising');
/*
  The live target and the sampler seed: request fields with **no control**.

  A field with no control is not the same thing as a field nobody writes. `live_sample_target` is
  the cap the live loop rests on and the number `traceReadout()` shows while the trace is below it;
  `seed` is the sampler offset whose 0 is the product's own value and a bit-exact no-op. Holding
  them here rather than in an `<input>` keeps a saved session round-tripping exactly --
  `restoreBaseAndComponentStyles()` writes these two the way it writes every other control, so a
  document that carries a different target or a different seed opens with it and saves it back, and
  undo and redo step through them with everything else.
*/
const DEFAULT_LIVE_SAMPLE_TARGET = 128;
let liveSampleTargetValue = DEFAULT_LIVE_SAMPLE_TARGET;
let renderSeedValue = 0;
const renderQualityProfile = document.querySelector('#render-quality-profile');
const renderAspect = document.querySelector('#render-aspect');
const outputAdvanced = document.querySelector('#output-advanced');
const viewTransform = document.querySelector('#view-transform');
const depthOfFieldEnabled = document.querySelector('#depth-of-field-enabled');
const depthOfFieldDetail = document.querySelector('#depth-of-field-detail');
const fStop = document.querySelector('#f-stop');
const fStopValue = document.querySelector('#f-stop-value');
const focusSelectionStatus = document.querySelector('#focus-selection-status');
const pickDepthOfFieldFocus = document.querySelector('#pick-depth-of-field-focus');
const autoDepthOfFieldFocus = document.querySelector('#auto-depth-of-field-focus');
const styleFocusPrompt = document.querySelector('#style-focus-prompt');
const styleFocusPromptFStop = document.querySelector('#style-focus-prompt-f-stop');
const styleFocusPromptFStopValue = document.querySelector('#style-focus-prompt-f-stop-value');
const styleFocusPromptPick = document.querySelector('#style-focus-prompt-pick');
const styleFocusPromptTitle = document.querySelector('#style-focus-prompt-title-text');
const styleFocusPromptNote = document.querySelector('#style-focus-prompt-note');
const styleFocusPromptDismiss = document.querySelector('#style-focus-prompt-dismiss');
const styleFocusPromptMute = document.querySelector('#style-focus-prompt-mute');
const focalLength = document.querySelector('#focal-length');
const focalLengthValue = document.querySelector('#focal-length-value');

const canvas = document.getElementById('trace-canvas');
const readout = document.getElementById('readout');
const stageNotes = createStageNotes(document.getElementById('notes'));
const stageBusy = document.getElementById('stage-busy');
const unsupported = document.getElementById('unsupported');
const unsupportedTitle = document.getElementById('unsupported-title');
const unsupportedDetail = document.getElementById('unsupported-detail');

const LIGHTING_PRESET = 'base_hdri';

const NUCLEIC_COLOR_MODES = new Set(['nucleic_base', 'nucleic_part', 'nucleic_duplex']);
const METRIC_COLOR_LABELS = {
  plddt: 'pLDDT confidence',
  bfactor: 'B-factor',
};
const BASE_COLOR_MODES = ['uniform', 'element', 'chain', 'sequence', 'x_axis', 'y_axis', 'z_axis'];
const SESSION_COLOR_MODES = new Set([
  ...BASE_COLOR_MODES,
  ...NUCLEIC_COLOR_MODES,
  ...Object.keys(METRIC_COLOR_LABELS),
]);
const MAX_GRADIENT_COLORS = 5;
/*
  The named output profiles, and the only values #render-quality-profile can carry besides
  `custom`. There is deliberately no `current` entry: it named whatever the three size fields
  happened to hold rather than a profile, and stopped being true as soon as one was edited.
*/
const QUALITY_PROFILES = {
  default: { width: 1024, height: 1024, samples: 128 },
  draft: { width: 512, height: 512, samples: 32 },
  review: { width: 1024, height: 1024, samples: 64 },
  high: { width: 2048, height: 2048, samples: 256 },
  // 3840 so 16:9 is UHD. ~1.4 GiB of buffers square; `resize()` refuses a GPU that cannot hold it.
  ultra: { width: 3840, height: 3840, samples: 512 },
};
const COLORS = UNIFORM_COLOR_PRESETS;
// How long "Saved ✓" stays on #save-camera-view. Long enough to read, short enough that the button
// is back to naming its action before anyone reaches for it again.
const CAMERA_VIEW_CONFIRMATION_MS = 1600;
const representationInputLastValues = new WeakMap();

/*
  The subject, and everything that is a projection of it.

  `structureFile` is the studio's subject; `loadedInputs` is the one `sceneInputsFromRequest()`
  answer for it -- the same `Structure`, atoms, residues and secondary structure the trace draws,
  because `request-scene.js` memoises the parse on the bytes. **One `Structure`, one answer**: two
  independent answers to which residues are helical render a plausible picture and report nothing,
  and here that is a property of the memo rather than of a promise made in this file.
*/
let structureFile;
// The file this page downloaded from its database, which a share link needs no second look at.
let downloadedStructureName;
let loadedInputs;
let restoredCameraBaseline;
let historyStepping = false;
let renderInFlight = false;
let availablePolymerChains = [];
// chain id -> the residue keys that chain holds, so a chain shortcut can report how much of
// itself is selected without walking the structure again.
let polymerChainResidueKeys = new Map();
let componentResidues = { protein: [], nucleic: [], ligand: [], ion: [], water: [] };
let componentResidueKeys = new Map();
// Optimistic until a structure is walked: before then nothing is loaded and the card is inert
// anyway, and assuming absence would flash "none in this structure" during every load.
let availableComponents = { nucleic: true, ligand: true, ion: true, water: true };
let representationSettingsContractEnabled = true;
let activeProteinRepresentationSettings;
let proteinRepresentationEditor;
let nucleicRepresentationEditor;
let ligandRepresentationEditor;
let ionRepresentationEditor;
let waterRepresentationEditor;
let proteinGradientEditor;
let nucleicGradientEditor;
let ligandGradientEditor;
let focusTarget;
/*
  "Don't show again" lasts the browser session, so sessionStorage; the module flag is the answer
  when storage throws, and then it lasts the page.
*/
const STYLE_FOCUS_PROMPT_MUTED_KEY = 'foldray.styleFocusPromptMuted';
let styleFocusPromptMuted = false;
try {
  styleFocusPromptMuted = sessionStorage.getItem(STYLE_FOCUS_PROMPT_MUTED_KEY) === '1';
} catch {}
// Armed when the answer is yes but the stage is showing a still; `foldray:stage-mode` spends it.
let styleFocusPromptPending = false;
/*
  The selection layers, and the two pieces of transient state the editor holds over them.

  `selectionLayerEdit` is one open "Edit selection" -- the layer, the Mol* snapshot to put back if
  it is cancelled, and the interaction mode to return to. `selectionLayerDrag` is one pointer drag
  on a card's handle. Both are cleared by `resetSelectionLayers()` with the structure, because a
  layer names residues of the file that is open and nothing else.
*/
let selectionLayers = [];
let selectionLayerEdit;
let selectionLayerDrag;
/*
  True while a Styles walk is capturing or restoring its baseline -- the two parts of a sweep that
  are not a render but must still count as busy. `src/style-sweep.js` reports busy only while it is
  rendering, so without this the gap either side of a walk is a window in which another job could
  start.
*/
let stylesActionsBusy = false;
/*
  The Styles walk's claim on the renderer while it runs, or undefined. `render-lock.js`'s
  `suspend()` is reference counted, so this nests with the claim each tile's own `render()` takes
  and the live trace stays parked across the gaps between them.
*/
let sweepClaim;
/*
  The preview repaint queue. `refreshSelectionPreview()` awaits four Mol* state updates per layer,
  and a colour drag fires one call per pointer event, so they are chained rather than raced -- two
  overlapping passes leave whichever finished last painting over the other's clear.
*/
let previewQueue = Promise.resolve();

// The preview canvas, the stage, and everything that only means anything once there is somewhere
// to click in the picture.
// The `createPreviewCanvas()` handle, or undefined until the dynamic import settles -- and for
// good if the machine refuses a second WebGL context. Every read of it is optional-chained for
// that reason, and never as a nicety: an app whose Result trace works and whose Preview does not
// is a worse app than one that crashes, but it is still the app.
let preview;
let stage;
let sequenceStrip;
// `inspect`, `select` or `focus`.
let interactionMode = 'inspect';
/*
  What a click in the 3D view picks up, which is Mol*'s own `Picking Level`. Three of its ten rows
  are offered (`index.html` carries why the other seven are not) and this is the chosen one, not
  necessarily the one the plugin is set to -- see `applyPickingGranularity()`.
*/
let pickingLevel = 'residue';
/*
  What Mol* is currently highlighting, in this file's keys, so the sequence strip can be told the
  whole answer rather than a difference.

  **Kept rather than rebuilt, because `highlightOnly()` clears before it marks** and the two halves
  arrive as separate provider calls; painting the clear on its own would be a chip that blinks off
  and on under a moving pointer. **Emptied when the strip is**: a key held across a structure change
  is a key that can collide with a residue of the *new* file -- same chain, same number -- and light
  a chip nothing is hovering, for good.
*/
const highlightedResidueKeys = new Set();
let focusPickReturnMode = 'inspect';
let focusPickSelectionSnapshot;
// One session-only camera bookmark for the open structure, and the confirmation on its button.
let savedCameraView;
let cameraViewMoving = false;
let cameraViewConfirmationTimer;
// The camera as of the last draw that moved it, so `observeCameraMovement()` can tell a real move
// from a redraw. `cameraJson()`'s own value, so the comparison is against the thing that is saved.
let lastObservedCamera;
/*
  Residue key -> component, over **every** residue, water included.

  One lookup into the same residue list the Components card and the geometry are built from, never a
  classification made on the spot from a Mol* location -- a second answer is how "is this residue a
  water" comes back differently here than it does in the sweep.
*/
let residueComponentTypes = new Map();
let structureMetric;
let lightingCompassDrag;
let detectedColorLabels = {
  protein: { chain: [], element: [] },
  nucleic: { chain: [], element: [], nucleic_base: [], nucleic_part: [] },
  ligand: { chain: [], element: [] },
  ion: { chain: [], element: [] },
  water: { chain: [], element: [] },
};
const styleColorOverrides = {
  protein: {}, nucleic: {}, ligand: {}, ion: {}, water: {},
};


function normalizeColor(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toUpperCase() : undefined;
}


function opacityNumber(value, label = 'Opacity') {
  const opacity = Number(value);
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    throw new Error(`${label} must be between 0 and 1.`);
  }
  return opacity;
}


function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}


function resolvedRepresentationForControls(
  representation,
  cartoonType,
  ribbonType,
  surfaceDetail,
  atomScope,
) {
  return representationForAtomScope(
    representationForRibbonType(
      representationForCartoonType(
        representationForSurfaceDetail(representation, surfaceDetail),
        cartoonType,
      ),
      ribbonType,
    ),
    atomScope,
  );
}


function selectedProteinRepresentation() {
  return resolvedRepresentationForControls(
    representationInput.value,
    cartoonTypeInput.value,
    ribbonTypeInput.value,
    surfaceDetailInput.value,
    atomScopeInput.value,
  );
}


/*
  A numeric setting is a box and a slider, and they are one control: the box carries the value
  (`inputs[field]` is what `values()` reads and what `aria-invalid` lands on) and the slider is a
  second grip on it. They mirror by **assignment only** -- `.app-shell`'s capture-phase
  `change`/`input` listener hears the range's own native event, so a synthetic one dispatched from
  here would record a second history step and retrace a second time for one drag.
*/
function createRepresentationSettingsEditor(wrapper, grid, help, labelPrefix) {
  let representation;
  let settings;
  let inputs = {};
  let sliders = {};
  let labels = {};
  // What the repair is holding: each field it moved, the value it had before that, and the value
  // it has now.
  let held = {};

  /*
    Some fields cannot be set alone, and a control that has just been moved must not produce a
    refusal: `repairedRepresentationSettings()` answers which *other* field has to move with it and
    to what, and both of that field's grips are written -- by assignment, for the reason the header
    gives.

    **Recomputed from what it is holding rather than accumulated.** Typing the `0` of `0.5` is a
    refusal on the way through, and a repair that only ever moved fields would leave the partner
    moved after the number was finished, with nothing to put it back. So each pass restores what it
    holds and then asks again, and a field the user edits themselves is theirs again -- its record
    is dropped.

    **A box is rewritten under the cursor when what it holds is a value the rule cannot take.** That
    is the corner where `w`, `h` and `r` are all 0 and the field being typed in is the one that has
    to hold: leaving it alone there leaves the box disagreeing with its own slider and with the
    request until it is blurred. A box that is **mid-edit** -- empty, or not yet a number -- is
    still never touched, which is the rule that keeps an emptied "3" from snapping back to 3.
  */
  const repair = (changedField) => {
    delete held[changedField];
    const before = held;
    Object.entries(before).forEach(([field, { was }]) => { settings[field] = was; });
    const moved = repairedRepresentationSettings(representation, settings, changedField);
    held = {};
    Object.entries(moved).forEach(([field, value]) => {
      held[field] = { was: settings[field], now: value };
      settings[field] = value;
    });
    new Set([...Object.keys(before), ...Object.keys(held)]).forEach((field) => {
      const input = inputs[field];
      const midEdit = input === document.activeElement
        && representationSettingValue(representation, field, input.value) === undefined;
      if (input) {
        // Outside the `midEdit` test on purpose: this is the fallback an unusable box falls back
        // *to*, so leaving it at a value the repair has moved away from restores a stale number.
        representationInputLastValues.set(input, settings[field]);
        if (!midEdit) {
          input.value = String(settings[field]);
          input.removeAttribute('aria-invalid');
        }
      }
      if (sliders[field]) sliders[field].value = String(settings[field]);
    });
    // Only what this pass changed, or a drag through the refused region says the same line once a
    // frame and a field that has not moved since gets re-announced beside one that has.
    const fresh = Object.entries(held).filter(([field, { now }]) => before[field]?.now !== now);
    const putBack = Object.entries(before).filter(([field, { now }]) => held[field]?.now !== now);
    const listed = (entries, key, joiner) => entries
      .map(([field, value]) => `${labels[field].toLowerCase()} ${joiner} ${value[key]}`)
      .join(' and ');
    if (fresh.length > 0) {
      setLoadStatus(`Moved ${listed(fresh, 'now', 'to')}: the cross-section could not be built without it.`);
    } else if (putBack.length > 0) {
      setLoadStatus(`Put ${listed(putBack, 'was', 'back to')}.`);
    }
  };

  const setRepresentation = (nextRepresentation, nextSettings) => {
    representation = nextRepresentation;
    const controls = representationSettingControls(representation);
    wrapper.hidden = controls.length === 0;
    grid.replaceChildren();
    inputs = {};
    sliders = {};
    labels = {};
    // A new look's fields are not the ones the repair was holding.
    held = {};
    if (controls.length === 0) {
      settings = undefined;
      help.textContent = '';
      return undefined;
    }
    settings = validatedRepresentationSettings(
      representation,
      nextSettings ?? representationSettingsForRepresentation(representation),
    );
    controls.forEach((definition) => {
      const [field, label, minimum, maximum, step, integer] = definition;
      const control = document.createElement('label');
      const caption = document.createElement('span');
      caption.textContent = label;
      labels[field] = label;
      if (isBooleanRepresentationSetting(definition)) {
        const toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.checked = settings[field];
        toggle.setAttribute('aria-label', `${labelPrefix} ${label.toLowerCase()}`);
        toggle.addEventListener('change', () => {
          settings[field] = toggle.checked;
          representationSettingsContractEnabled = true;
        });
        inputs[field] = toggle;
        control.className = 'representation-setting-toggle';
        control.append(toggle, caption);
        grid.append(control);
        return;
      }
      const input = document.createElement('input');
      input.type = 'number';
      input.min = String(minimum);
      input.max = String(maximum);
      input.step = String(step);
      input.value = String(settings[field]);
      input.setAttribute('aria-label', `${labelPrefix} ${label.toLowerCase()}`);
      representationInputLastValues.set(input, settings[field]);
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = String(minimum);
      slider.max = String(maximum);
      slider.step = String(step);
      slider.value = String(settings[field]);
      // Its own label, or a screen reader meets the same name twice on one setting.
      slider.setAttribute('aria-label', `${labelPrefix} ${label.toLowerCase()} slider`);
      sliders[field] = slider;
      slider.addEventListener('input', () => {
        // Constrained rather than validated: a range's own value is always in range, and the clamp
        // is what keeps a step the browser rounded from falling out of it.
        const value = constrainedRepresentationSetting(
          representation, field, slider.value, settings[field],
        );
        settings[field] = integer ? Math.round(value) : value;
        input.value = String(settings[field]);
        input.removeAttribute('aria-invalid');
        representationInputLastValues.set(input, settings[field]);
        representationSettingsContractEnabled = true;
        repair(field);
      });
      input.addEventListener('input', () => {
        const value = representationSettingValue(representation, field, input.value);
        input.toggleAttribute('aria-invalid', value === undefined);
        if (value !== undefined) {
          settings[field] = value;
          slider.value = String(value);
          representationInputLastValues.set(input, value);
          repair(field);
        }
        representationSettingsContractEnabled = true;
      });
      // `change` is leaving the box (or Enter), and it is the only place a typed value is corrected.
      input.addEventListener('change', () => {
        const typed = input.value.trim();
        const valid = representationSettingValue(representation, field, typed) !== undefined;
        const value = constrainedRepresentationSetting(
          representation,
          field,
          input.value,
          representationInputLastValues.get(input)
            ?? representationSettingsForRepresentation(representation)[field],
        );
        settings[field] = integer ? Math.round(value) : value;
        input.value = String(settings[field]);
        slider.value = String(settings[field]);
        input.removeAttribute('aria-invalid');
        representationInputLastValues.set(input, settings[field]);
        representationSettingsContractEnabled = true;
        if (!valid) {
          const range = `${integer ? 'a whole number ' : ''}between ${minimum} and ${maximum}`;
          setLoadStatus(typed === ''
            ? `${label} needs a value ${range}; kept ${settings[field]}.`
            : `${label} must be ${range}; ${typed} was set to ${settings[field]}.`, true);
        }
        // Last, so a field that moved on its own is what the line ends up saying: it is the more
        // surprising of the two.
        repair(field);
      });
      inputs[field] = input;
      // The name on its own row and both grips on the next, the box at the right end where this
      // page puts a range's value. A rail half column is 113px and the name and the box do not fit
      // on one line in it (`styles.css`).
      caption.className = 'range-caption';
      const grips = document.createElement('span');
      grips.className = 'representation-setting-grips';
      grips.append(slider, input);
      control.className = 'representation-setting';
      control.append(caption, grips);
      grid.append(control);
    });
    help.textContent = `${controls
      .filter((definition) => !isBooleanRepresentationSetting(definition))
      .map(([, label, minimum, maximum]) => `${label}: ${minimum}–${maximum}`)
      .join('; ')}. Out-of-range values are clamped when you leave the box.`;
    return settings;
  };

  const values = () => {
    if (!settings) return undefined;
    Object.entries(inputs).forEach(([field, input]) => {
      if (input.type === 'checkbox') {
        settings[field] = input.checked;
        return;
      }
      // The history capture and the live trace read this on every keystroke; rewriting a box that is
      // still being typed in snapped an emptied "3" straight back to 3. `settings` already holds the
      // last valid value, and `change` corrects the box when it is left.
      if (input === document.activeElement) return;
      const value = constrainedRepresentationSetting(
        representation,
        field,
        input.value,
        representationInputLastValues.get(input) ?? settings[field],
      );
      settings[field] = Number(input.step) === 1 ? Math.round(value) : value;
      input.value = String(settings[field]);
      if (sliders[field]) sliders[field].value = String(settings[field]);
      input.removeAttribute('aria-invalid');
      representationInputLastValues.set(input, settings[field]);
    });
    return validatedRepresentationSettings(representation, settings);
  };

  const setDisabled = (disabled) => {
    Object.values(inputs).forEach((input) => { input.disabled = disabled; });
    Object.values(sliders).forEach((slider) => { slider.disabled = disabled; });
  };

  return { wrapper, setRepresentation, setDisabled, values };
}


function resetProteinRepresentationSettings(settings, enableContract = true) {
  const representation = selectedProteinRepresentation();
  activeProteinRepresentationSettings = proteinRepresentationEditor.setRepresentation(
    representation,
    settings ?? representationSettingsForRepresentation(representation),
  );
  if (enableContract) representationSettingsContractEnabled = true;
}


function resetComponentRepresentationSettings(editor, representation, settings, enableContract) {
  editor.setRepresentation(
    representation,
    settings ?? representationSettingsForRepresentation(representation),
  );
  if (enableContract) representationSettingsContractEnabled = true;
}


function resetNucleicRepresentationSettings(settings, enableContract = true) {
  resetComponentRepresentationSettings(
    nucleicRepresentationEditor, nucleicRepresentation.value, settings, enableContract,
  );
}


function resetLigandRepresentationSettings(settings, enableContract = true) {
  resetComponentRepresentationSettings(
    ligandRepresentationEditor, ligandRepresentation.value, settings, enableContract,
  );
}


function resetIonRepresentationSettings(settings, enableContract = true) {
  resetComponentRepresentationSettings(
    ionRepresentationEditor, ionRepresentation.value, settings, enableContract,
  );
}


function resetWaterRepresentationSettings(settings, enableContract = true) {
  resetComponentRepresentationSettings(
    waterRepresentationEditor, WATER_REPRESENTATION, settings, enableContract,
  );
}


function updateOpacityOutput(input, output) {
  output.value = String(Number(input.value));
}


function setColor(value) {
  const normalized = normalizeColor(value);
  if (!normalized) return false;
  colorWheel.value = normalized.toLowerCase();
  colorHex.value = normalized;
  colorHex.removeAttribute('aria-invalid');
  colorPresets.querySelectorAll('button').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.color === normalized));
  });
  return true;
}


/*
  Seeded from `COMPONENT_COLOR_DEFAULTS`, never from the first swatch in the row. That is what keeps
  the markup, the picker artwork and the request in step: `COLORS[0][1]` would overwrite the
  authored default the moment the module initialises, and a check that reads only the markup cannot
  see it.
*/
function initializeColorControls() {
  COLORS.forEach(([name, color]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'color-swatch';
    button.dataset.color = color;
    button.style.setProperty('--swatch-color', color);
    button.title = `${name} ${color}`;
    button.setAttribute('aria-label', `${name} ${color}`);
    /*
      A preset *writes* the pair rather than being typed into, so neither input fires on its own and
      the shell's blanket retrace would never hear it -- the wheel would recolour the live picture at
      once and the twelve swatches beside it only the next time something else moved. `swatch-picker
      .js`'s `commit()` is the shape: write the field the value lives in, then dispatch on that
      field, and only when the value actually moved, so the dirty flag, the history key and the trace
      all see the same control the wheel gives them.
    */
    button.addEventListener('click', () => {
      const moved = colorHex.value !== color;
      if (!setColor(color) || !moved) return;
      colorHex.dispatchEvent(new Event('change', { bubbles: true }));
    });
    colorPresets.append(button);
  });
  setColor(COMPONENT_COLOR_DEFAULTS.protein.uniform);
}


function bindColorPair(wheel, hex, onValid = () => {}) {
  const setPair = (value) => {
    const normalized = normalizeColor(value);
    hex.toggleAttribute('aria-invalid', !normalized);
    if (!normalized) return false;
    wheel.value = normalized.toLowerCase();
    hex.value = normalized;
    onValid(normalized);
    return true;
  };
  wheel.addEventListener('input', () => setPair(wheel.value));
  hex.addEventListener('input', () => setPair(hex.value));
  setPair(hex.value);
}


function createColorPair(value, label, onValid) {
  const wrapper = document.createElement('span');
  wrapper.className = 'component-color-inputs';
  const wheel = document.createElement('input');
  wheel.type = 'color';
  wheel.value = value.toLowerCase();
  wheel.setAttribute('aria-label', `${label} picker`);
  const hex = document.createElement('input');
  hex.type = 'text';
  hex.value = value.toUpperCase();
  hex.maxLength = 7;
  hex.spellcheck = false;
  hex.setAttribute('aria-label', `${label} hex value`);
  wrapper.append(wheel, hex);
  // bindColorPair normalizes once while wiring. That initial synchronization is presentation, not
  // a user edit, so nothing downstream may run until an input actually fires.
  let bound = false;
  bindColorPair(wheel, hex, (normalized) => {
    if (bound) onValid(normalized);
  });
  bound = true;
  return {
    wrapper,
    wheel,
    hex,
    setDisabled(disabled) {
      wheel.disabled = disabled;
      hex.disabled = disabled;
    },
  };
}


function setColorPairValue(wheel, hex, value, path) {
  const normalized = normalizeColor(value);
  if (!normalized) throw new Error(`${path} must be a six-digit colour.`);
  wheel.value = normalized.toLowerCase();
  hex.value = normalized;
  hex.removeAttribute('aria-invalid');
}


function createGradientColorEditor({
  container,
  addButton,
  count,
  startHex,
  endHex,
  label,
  defaultColors = COMPONENT_COLOR_DEFAULTS.protein.gradient,
  onColorsChanged = () => {},
}) {
  let colors = [
    normalizeColor(startHex.value) ?? defaultColors[0],
    normalizeColor(endHex.value) ?? defaultColors[1],
  ];
  let disabled = false;

  const syncEndpointSources = () => {
    setColorPairValue(startHex.previousElementSibling, startHex, colors[0], `${label} first colour`);
    setColorPairValue(endHex.previousElementSibling, endHex, colors.at(-1), `${label} last colour`);
  };

  const notifyStructureChange = () => {
    onColorsChanged([...colors]);
    // Add/remove is a composition edit even though its native gesture is a button click. Reuse the
    // shell's change path so the dirty tracking and the bounded composition history see it.
    addButton.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const paint = () => {
    container.replaceChildren();
    colors.forEach((value, index) => {
      const row = document.createElement('div');
      row.className = 'gradient-color-row';
      const colorLabel = document.createElement('label');
      const caption = document.createElement('span');
      caption.textContent = `Colour ${index + 1}`;
      const pair = createColorPair(
        value,
        `${label} colour ${index + 1}`,
        (normalized) => {
          colors[index] = normalized;
          syncEndpointSources();
          onColorsChanged([...colors]);
        },
      );
      pair.setDisabled(disabled);
      colorLabel.append(caption, pair.wrapper);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'gradient-remove-color';
      remove.textContent = '×';
      remove.title = colors.length <= 2 ? 'A gradient needs at least two colours' : 'Remove colour';
      remove.setAttribute('aria-label', `Remove ${label} colour ${index + 1}`);
      remove.disabled = disabled || colors.length <= 2;
      remove.addEventListener('click', () => {
        if (colors.length <= 2) return;
        colors.splice(index, 1);
        syncEndpointSources();
        paint();
        notifyStructureChange();
      });
      row.append(colorLabel, remove);
      container.append(row);
    });
    const limitReached = colors.length >= MAX_GRADIENT_COLORS;
    addButton.dataset.gradientLimit = String(limitReached);
    addButton.disabled = disabled || limitReached;
    addButton.title = limitReached
      ? `A gradient can contain at most ${MAX_GRADIENT_COLORS} colours`
      : 'Append a harmony-aware colour suggestion; current colours stay unchanged';
    count.textContent = `${colors.length} of ${MAX_GRADIENT_COLORS} colours`;
  };

  addButton.addEventListener('click', () => {
    if (disabled || colors.length >= MAX_GRADIENT_COLORS) return;
    // The recommendation is a new final stop only. Existing values remain byte-for-byte intact.
    colors.push(suggestGradientColor(colors));
    syncEndpointSources();
    paint();
    notifyStructureChange();
  });
  paint();

  return {
    colors: () => [...colors],
    values: () => colors.slice(1, -1),
    setValues(rawValues, path = `${label} middle colours`) {
      if (!Array.isArray(rawValues) || rawValues.length > MAX_GRADIENT_COLORS - 2) {
        throw new Error(`${path} must contain at most ${MAX_GRADIENT_COLORS - 2} colours.`);
      }
      const midpoints = rawValues.map((value, index) => {
        const normalized = normalizeColor(value);
        if (!normalized) throw new Error(`${path}[${index}] must be a six-digit colour.`);
        return normalized;
      });
      colors = [
        normalizeColor(startHex.value) ?? defaultColors[0],
        ...midpoints,
        normalizeColor(endHex.value) ?? defaultColors[1],
      ];
      syncEndpointSources();
      onColorsChanged([...colors]);
      paint();
    },
    setDisabled(value) {
      disabled = Boolean(value);
      paint();
    },
  };
}


function updateProteinColorControl() {
  const elementOption = proteinColorMode.querySelector('option[value="element"]');
  const atomColorsAvailable = representationSupportsAtomColors(representationInput.value);
  elementOption.hidden = !atomColorsAvailable;
  elementOption.disabled = !atomColorsAvailable;
  if (!atomColorsAvailable && proteinColorMode.value === 'element') {
    proteinColorMode.value = 'uniform';
  }
  const uniformColor = proteinColorMode.value === 'uniform';
  const gradientColor = GRADIENT_COLOR_MODES.has(proteinColorMode.value);
  colorControl.hidden = !uniformColor;
  colorControl.disabled = !uniformColor || renderInFlight;
  proteinGradientControl.hidden = !gradientColor;
  proteinGradientControl.disabled = !gradientColor || renderInFlight;
  renderCategoryColors(proteinCategoryColors, 'protein', proteinColorMode.value, styleColorOverrides.protein);
}


function updateNucleicColorModeAvailability() {
  const atomColorsAvailable = representationSupportsAtomColors(nucleicRepresentation.value);
  ['nucleic_part', 'element'].forEach((mode) => {
    const option = nucleicColorMode.querySelector(`option[value="${mode}"]`);
    option.hidden = !atomColorsAvailable;
    option.disabled = !atomColorsAvailable;
  });
  if (!atomColorsAvailable && ['nucleic_part', 'element'].includes(nucleicColorMode.value)) {
    nucleicColorMode.value = 'nucleic_base';
  }
  const duplexGradient = nucleicColorMode.value === 'nucleic_duplex';
  nucleicGradientStartLabel.textContent = duplexGradient ? 'One end' : '5′ end';
  nucleicGradientEndLabel.textContent = duplexGradient ? 'Other end' : '3′ end';
  nucleicGradientHelp.textContent = duplexGradient
    ? 'Both strands share one end-to-end gradient.'
    : 'Each strand runs from 5′ to 3′ independently.';
}


/*
  What each grid was last built from, so an `updateStyleControls()` that changes nothing about a
  component's colours does not rebuild that component's swatches.

  **This is a rebuild count, not a paint optimisation.** `updateStyleControls()` runs from eighteen
  of the forty-five `change` events a Style apply dispatches (`STYLE_FIELDS`), and each run rebuilds
  all four grids -- so without the skip one apply tears down and recreates every category swatch
  **nineteen times**. A swatch is five elements and three closures, two of the elements being
  `<input>` and one of those `type="color"`, which is the most expensive input a browser builds. On
  a structure coloured by chain that is 21 labels on 1AON: ~105 elements per protein-grid rebuild,
  ~1,900 elements and ~380 colour inputs created and destroyed for one click on a tile, with nothing
  on screen having moved.

  The signature is the whole of what a rebuild would produce -- the mode, the label list and each
  label's colour -- so a skip can only ever happen where the DOM already shows exactly what the
  rebuild would have drawn.

  **The `overrides` object's identity is in the key rather than in the signature, and it is
  load-bearing.** Each swatch's `onValid` closure captures the `overrides` object it was built
  with; `applyStyleColorScheme()` replaces `styleColorOverrides[component]` with a *fresh* object,
  and a grid kept across that would go on writing the user's edits into the table nobody reads any
  more. Comparing values alone would have missed it, because a scheme that lands on the same
  colours has the same signature.
*/
const categoryColorGrids = new WeakMap();

function renderCategoryColors(container, component, mode, overrides) {
  /*
    **A component with no per-category grid is a clean no-op**, the way `updateComponentStyleControl()`
    already treats a component with no gradient endpoints. Water is the first one: it offers a single
    uniform colour, so there is no grid on its card and nothing to seed. Without the guard the
    `WeakMap` below is handed `undefined` and the whole page fails to boot on "Invalid value used as
    weak map key".
  */
  if (!container) return;
  /*
    The two metric ramps reuse this grid, one swatch per fixed stop, because their stops are
    labelled values exactly like a chain or an element is. Their labels come from the ramp and are
    deliberately not sorted: the order *is* the ramp, and pLDDT's labels are numbers, which sort as
    0, 100, 50, 70, 90.
  */
  const metricStops = metricColorStopLabels(mode);
  const detected = ['chain', 'element', 'nucleic_base', 'nucleic_part'].includes(mode)
    ? (detectedColorLabels[component]?.[mode] ?? [])
    : [];
  const labels = metricStops.length > 0 ? metricStops : detected;
  /*
    Seeding the table is not part of the comparison and must happen either way: it is where a label
    the structure has just grown gets its authored default, and `defaultCategoryColor()` is the one
    place that decision is made. It writes only what is missing, so running it before the skip below
    is idempotent.
  */
  labels.forEach((label, index) => {
    overrides[mode] ??= {};
    overrides[mode][label] ??= defaultCategoryColor(component, mode, label, index);
  });
  const signatureNow = () => `${mode}\u0000${labels
    .map((label) => `${label}\u0001${overrides[mode]?.[label]}`)
    .join('\u0000')}`;
  const signature = signatureNow();
  const built = categoryColorGrids.get(container);
  if (built && built.overrides === overrides && built.signature === signature) return;
  categoryColorGrids.set(container, { overrides, signature });
  container.replaceChildren();
  container.hidden = labels.length === 0;
  labels.forEach((label) => {
    const control = document.createElement('label');
    control.className = 'category-color';
    const caption = document.createElement('span');
    caption.textContent = label || '(blank)';
    const pair = createColorPair(
      overrides[mode][label],
      `${component} ${mode} ${label || 'blank'} colour`,
      // The swatch now shows `value`, so the signature must too, or an undo restoring the built
      // table in place matches it and skips the rebuild.
      (value) => {
        overrides[mode][label] = value;
        categoryColorGrids.set(container, { overrides, signature: signatureNow() });
      },
    );
    control.append(caption, pair.wrapper);
    container.append(control);
  });
}


/*
  **A request is a snapshot.** Every field in it is copied out of the control that owns it.

  The swatch above writes `styleColorOverrides[component][mode][label]` in place -- and a layer's
  own grid writes `layer.color_overrides[mode][label]` the same way -- so handing the live table to
  the request would move the *previous* request's copy with it. `render-backend.js`'s `update()`
  compares the two and `sameValue()` returns at `a === b`, so the edit would reach the request and
  stop there: a `chain`, `element`, `nucleic_base`, `nucleic_part` or metric-ramp colour would change
  its swatch and leave the live picture alone. **An orbit does not land it either** --
  `sameGeometry()` skips the camera and finds the rest unchanged, so the scene is not rebuilt --
  while Create Image is right either way, because `render()` always prepares the geometry. That
  disagreement is the whole hazard: the picture on screen stops being the picture you download.

  The seeding in `renderCategoryColors()` is the same hazard one step quieter: `??=` on a label the
  structure has just grown writes into whatever request is holding the table.
*/
function colorOverridesSnapshot(table, mode) {
  return { ...(table?.[mode] ?? {}) };
}


// Per-mode tables for editor state, minus the empty ones: every reader is `?? {}`, and a restore
// deletes an empty table, so keeping one here makes capture -> restore -> capture differ.
function nonEmptyColorTables(tables) {
  return Object.fromEntries(
    Object.entries(tables ?? {})
      .filter(([, table]) => Object.keys(table ?? {}).length > 0)
      .map(([mode, table]) => [mode, { ...table }]),
  );
}


function setStructureMetric(metric) {
  structureMetric = metric;
  proteinColorMode.querySelectorAll('[data-structure-metric]').forEach((option) => option.remove());
  if (metric) {
    const option = document.createElement('option');
    option.value = metric;
    option.textContent = METRIC_COLOR_LABELS[metric];
    option.dataset.structureMetric = 'true';
    proteinColorMode.append(option);
  }
  if (![...proteinColorMode.options].some((option) => option.value === proteinColorMode.value)) {
    proteinColorMode.value = 'uniform';
  }
  proteinColorCapability.hidden = !metric;
  proteinColorCapability.textContent = metric
    ? `${METRIC_COLOR_LABELS[metric]} colouring is available for this structure.`
    : '';
  updateProteinColorControl();
}


function updateComponentStyleControl(fieldset, enabledInput, colorModeSelect, component) {
  /*
    A component the structure does not contain cannot be included. The toggle stays visible and
    disabled rather than disappearing, so the answer to "where are the ligands?" is on screen
    instead of being an absence the user has to interpret.
  */
  const present = availableComponents[component] !== false;
  enabledInput.disabled = !present || renderInFlight;
  const absence = fieldset.querySelector('.component-absent');
  if (absence) absence.hidden = present;

  const enabled = enabledInput.checked && present;
  fieldset.querySelectorAll('[data-component-detail]').forEach((detail) => {
    detail.hidden = !enabled;
  });
  fieldset.querySelectorAll('[data-component-detail] input, [data-component-detail] select')
    .forEach((control) => { control.disabled = !enabled || renderInFlight; });
  const uniformColor = fieldset.querySelector('.component-uniform-color');
  const useUniformColor = colorModeSelect.value === 'uniform';
  uniformColor.hidden = !useUniformColor;
  uniformColor.querySelectorAll('input').forEach((control) => {
    control.disabled = !enabled || !useUniformColor || renderInFlight;
  });
  /*
    Ions offer element and uniform colour only, so their card ships neither gradient endpoints nor
    a category container. Both lookups are optional, and a component without them is a clean no-op.
  */
  const gradientColor = fieldset.querySelector('.component-gradient-control');
  if (gradientColor) {
    const useGradientColor = GRADIENT_COLOR_MODES.has(colorModeSelect.value);
    gradientColor.hidden = !useGradientColor;
    gradientColor.querySelectorAll('input, button').forEach((control) => {
      control.disabled = !enabled || !useGradientColor || renderInFlight;
    });
  }
  const categoryContainer = {
    nucleic: nucleicCategoryColors,
    ligand: ligandCategoryColors,
    ion: ionCategoryColors,
  }[component];
  renderCategoryColors(
    categoryContainer,
    component,
    colorModeSelect.value,
    styleColorOverrides[component],
  );
}


function updateIonFluorescenceControl() {
  const visible = ionEnabled.checked && EMISSION_TUNABLE.has(ionMaterial.value);
  ionFluorescenceControl.hidden = !visible;
  ionFluorescence.disabled = !visible || renderInFlight;
}


function updateEmissionControls() {
  const proteinVisible = EMISSION_TUNABLE.has(materialInput.value);
  proteinEmissionControl.hidden = !proteinVisible;
  proteinEmissionStrength.disabled = !proteinVisible || renderInFlight;
  const nucleicVisible = nucleicEnabled.checked
    && EMISSION_TUNABLE.has(nucleicMaterial.value);
  nucleicEmissionControl.hidden = !nucleicVisible;
  nucleicEmissionStrength.disabled = !nucleicVisible || renderInFlight;
  const ligandVisible = ligandEnabled.checked && EMISSION_TUNABLE.has(ligandMaterial.value);
  ligandEmissionControl.hidden = !ligandVisible;
  ligandEmissionStrength.disabled = !ligandVisible || renderInFlight;
  const waterVisible = waterEnabled.checked && EMISSION_TUNABLE.has(waterMaterial.value);
  waterEmissionControl.hidden = !waterVisible;
  waterEmissionStrength.disabled = !waterVisible || renderInFlight;
}


function currentLightingAngles() {
  if (hdriElevation.value.trim() === '' || hdriAzimuth.value.trim() === '') return undefined;
  const elevation = Number(hdriElevation.value);
  const azimuth = Number(hdriAzimuth.value);
  if (!Number.isFinite(elevation) || !Number.isFinite(azimuth)) return undefined;
  if (elevation < -180 || elevation > 180 || azimuth < -360 || azimuth > 360) return undefined;
  return clampLightingAngles(elevation, azimuth);
}


function lightingCompassTitle(kind) {
  if (kind === 'directional') return 'Lighting direction';
  if (kind === 'axial') return 'Rim orientation';
  if (kind === 'panels') return 'Panel orientation';
  return 'Environment orientation';
}


function updateLightingCompass() {
  const profile = lightingSourceProfile(lightingSource.value);
  const anchorLabel = lightingAnchor.value === 'camera' ? 'Camera-relative' : 'World-relative';
  lightingCompassHeading.textContent = lightingCompassTitle(profile.kind);
  lightingCompassKind.textContent = profile.kindLabel;
  lightingCompassMarker.dataset.kind = profile.kind;

  const angles = currentLightingAngles();
  if (!angles) {
    lightingCompassValues.textContent = `${anchorLabel} · enter valid angles`;
    lightingCompass.setAttribute(
      'aria-label',
      `${profile.kindLabel} orientation. Enter valid elevation and azimuth values.`,
    );
    return;
  }

  const projection = lightingCompassProjection(
    angles.elevation,
    angles.azimuth,
    profile.referenceVector,
    lightingAnchor.value,
    profile.authoredAzimuth,
  );
  const markerX = 111.5 + (projection.x * 62);
  const markerY = 111.5 + (projection.y * 62);
  lightingCompassLine.setAttribute('x2', String(markerX));
  lightingCompassLine.setAttribute('y2', String(markerY));
  lightingCompassMarker.style.left = `${(markerX / 240) * 100}%`;
  lightingCompassMarker.style.top = `${(markerY / 210) * 100}%`;
  lightingCompassMarker.style.setProperty(
    '--lighting-marker-scale',
    String(0.82 + (((projection.depth + 1) / 2) * 0.18)),
  );
  lightingCompassMarker.style.setProperty(
    '--lighting-marker-opacity',
    String(0.58 + (((projection.depth + 1) / 2) * 0.42)),
  );
  lightingCompass.classList.toggle('is-behind', projection.depth < 0);

  const sideLabel = projection.depth >= 0
    ? (lightingAnchor.value === 'camera' ? 'camera side' : 'authored-camera side')
    : 'far side';
  const values = `${anchorLabel} · ${sideLabel} · elev ${formatLightingDegrees(angles.elevation)} · az ${formatLightingDegrees(angles.azimuth)}`;
  lightingCompassValues.textContent = values;
  lightingCompass.setAttribute(
    'aria-label',
    `${profile.kindLabel} orientation. ${values}. Drag to rotate, use arrow keys, or press Home to restore the authored orientation.`,
  );
}


function setLightingAngles(elevation, azimuth) {
  const angles = clampLightingAngles(elevation, azimuth);
  hdriElevation.value = String(Math.round(angles.elevation * 10) / 10);
  hdriAzimuth.value = String(Math.round(angles.azimuth * 10) / 10);
  /*
    The compass is another editor for these exact numeric controls, not separate view state.
    Bubbling input events make a drag, an arrow-key move or an Authored reset follow the same dirty
    and history path as typing the angles.
  */
  hdriElevation.dispatchEvent(new Event('input', { bubbles: true }));
  hdriAzimuth.dispatchEvent(new Event('input', { bubbles: true }));
}


function updateLightingControls() {
  lightingAngleControl.querySelectorAll('input, select').forEach((control) => {
    control.disabled = renderInFlight;
  });
  const sourceLabel = lightingSource.options[lightingSource.selectedIndex]?.textContent
    || 'illumination';
  reflectionEnvironment.options[0].textContent = `Same as ${sourceLabel}`;
  const colorVisible = reflectionEnvironment.value === 'color';
  reflectionColorControl.hidden = !colorVisible;
  reflectionColorControl.querySelectorAll('input').forEach((control) => {
    control.disabled = !colorVisible || renderInFlight;
  });
  lightingStrengthValue.value = String(Number(lightingStrength.value));
  updateLightingCompass();
}


function beginLightingCompassDrag(event) {
  if (lightingCompass.disabled || event.button !== 0) return;
  const angles = currentLightingAngles();
  if (!angles) return;
  const bounds = lightingCompass.getBoundingClientRect();
  lightingCompassDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    elevation: angles.elevation,
    azimuth: angles.azimuth,
    width: bounds.width,
    height: bounds.height,
  };
  lightingCompass.setPointerCapture(event.pointerId);
  lightingCompass.classList.add('is-dragging');
  event.preventDefault();
}


function moveLightingCompass(event) {
  if (!lightingCompassDrag || lightingCompassDrag.pointerId !== event.pointerId) return;
  const angles = lightingAnglesFromDrag(
    lightingCompassDrag.elevation,
    lightingCompassDrag.azimuth,
    event.clientX - lightingCompassDrag.startX,
    event.clientY - lightingCompassDrag.startY,
    lightingCompassDrag.width,
    lightingCompassDrag.height,
  );
  setLightingAngles(angles.elevation, angles.azimuth);
  event.preventDefault();
}


function endLightingCompassDrag(event) {
  if (!lightingCompassDrag || lightingCompassDrag.pointerId !== event.pointerId) return;
  lightingCompassDrag = undefined;
  lightingCompass.classList.remove('is-dragging');
  if (lightingCompass.hasPointerCapture(event.pointerId)) {
    lightingCompass.releasePointerCapture(event.pointerId);
  }
}


function rotateLightingCompassWithKeyboard(event) {
  if (lightingCompass.disabled) return;
  const angles = currentLightingAngles();
  if (!angles) return;
  const next = lightingAnglesFromKey(angles.elevation, angles.azimuth, event.key, event.shiftKey);
  if (!next) return;
  setLightingAngles(next.elevation, next.azimuth);
  event.preventDefault();
}


/*
  Width, height, samples, the view transform and denoising live behind the Output card's Advanced
  settings disclosure. Reveal them for `custom`, the one shortcut entry that names no numbers -- and
  only ever open, never close: a user who opened the disclosure to reach the view transform must not
  have it shut under them by their next shortcut choice.
*/
function revealOutputAdvancedForCustom() {
  if (renderQualityProfile.value === 'custom') outputAdvanced.open = true;
}


function applyQualityProfile() {
  revealOutputAdvancedForCustom();
  const profile = QUALITY_PROFILES[renderQualityProfile.value];
  if (!profile) return;
  renderWidth.value = String(profile.width);
  renderHeight.value = String(profile.height);
  renderSamples.value = String(profile.samples);
  applyRenderAspect();
}


function applyRenderAspect() {
  if (renderAspect.value === 'custom') {
    outputAdvanced.open = true;
    return;
  }
  const size = aspectSize(
    Number(renderWidth.value) || 1024,
    Number(renderHeight.value) || 1024,
    renderAspect.value,
  );
  renderWidth.value = String(size.width);
  renderHeight.value = String(size.height);
}


function aspectSize(width, height, aspect) {
  const [wRatio, hRatio] = aspect.split(':').map(Number);
  const longEdge = Math.max(width, height);
  return wRatio >= hRatio
    ? { width: Math.round(longEdge), height: Math.round(longEdge * (hRatio / wRatio)) }
    : { width: Math.round(longEdge * (wRatio / hRatio)), height: Math.round(longEdge) };
}


// A named profile keeps its name at any offered aspect, because that is what applyQualityProfile()
// leaves it holding; a restore that compared the square size alone read 2048x1152 High as custom.
function sizeIsQualityProfile(profile, width, height, samples) {
  if (!profile || profile.samples !== samples) return false;
  return [...renderAspect.options].some(({ value }) => {
    const size = value === 'custom'
      ? { width: profile.width, height: profile.height }
      : aspectSize(profile.width, profile.height, value);
    return size.width === width && size.height === height;
  });
}


function syncAspectFromSize() {
  const width = Number(renderWidth.value);
  const height = Number(renderHeight.value);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    renderAspect.value = 'custom';
    return;
  }
  const knownRatios = ['1:1', '4:3', '3:2', '16:9', '3:4', '2:3', '9:16'];
  const matched = knownRatios.find((ratio) => {
    const [rw, rh] = ratio.split(':').map(Number);
    return Math.abs((width / height) - (rw / rh)) < 0.01;
  });
  renderAspect.value = matched || 'custom';
}


function markQualityProfileCustom() {
  renderQualityProfile.value = 'custom';
}


/*
  Which of `auto`'s three methods answered, in the option's own text.

  **Presentation, and not a control.** Writing an option's text fires no `input` or `change`, the
  value stays `auto` -- which is what `buildRenderRequest()` sends and what a session names -- and
  nothing reads this text back. Neutral before a structure, and neutral again when one goes.
*/
function updateSecondaryStructureAutoLabel() {
  const branch = structureFile ? loadedInputs?.secondaryStructureAutoBranch : undefined;
  secondaryStructureAutoOption.textContent = SECONDARY_STRUCTURE_AUTO_LABELS[branch]
    ?? SECONDARY_STRUCTURE_AUTO_LABEL;
}


function updateStyleControls() {
  const cartoonVisible = representationInput.value === 'cartoon';
  cartoonTypeControl.hidden = !cartoonVisible;
  cartoonTypeInput.disabled = !cartoonVisible || renderInFlight;
  /*
    **Shown whenever a structure is loaded, not only when the file carries no helix/sheet records.**
    The method reaches the picture on *every* structure -- `auto` takes the file's records and `dssp`
    computes from the coordinates, and the two disagree -- and `secondary-structure.js`'s
    `unassignable()` message ends by telling the user to choose `dssp`, which is advice they can only
    take if the control is on screen.
  */
  secondaryStructureControl.hidden = !structureFile;
  secondaryStructureMethodInput.disabled = !structureFile || renderInFlight;
  updateSecondaryStructureAutoLabel();
  // Offered only where there is a choice: one row means the file's single assembly and the
  // asymmetric unit, which on every such file so far are the same molecule.
  assemblyInput.disabled = !structureFile || renderInFlight
    || (loadedInputs?.assemblies?.length ?? 0) === 0;
  proteinRepresentationEditor?.setDisabled(renderInFlight);
  nucleicRepresentationEditor?.setDisabled(!nucleicEnabled.checked || renderInFlight);
  ligandRepresentationEditor?.setDisabled(!ligandEnabled.checked || renderInFlight);
  ionRepresentationEditor?.setDisabled(!ionEnabled.checked || renderInFlight);
  waterRepresentationEditor?.setDisabled(!waterEnabled.checked || renderInFlight);
  const ribbonVisible = representationInput.value === 'ribbon';
  ribbonTypeControl.hidden = !ribbonVisible;
  ribbonTypeInput.disabled = !ribbonVisible || renderInFlight;
  const atomScopeVisible = atomScopeForRepresentation(representationInput.value) !== undefined;
  atomScopeControl.hidden = !atomScopeVisible;
  atomScopeInput.disabled = !atomScopeVisible || renderInFlight;
  const surfaceVisible = representationInput.value === 'surface';
  surfaceDetailControl.hidden = !surfaceVisible;
  surfaceDetailInput.disabled = !surfaceVisible || renderInFlight;
  updateProteinColorControl();
  updateNucleicColorModeAvailability();
  updateComponentStyleControl(nucleicStyleControl, nucleicEnabled, nucleicColorMode, 'nucleic');
  updateComponentStyleControl(ligandStyleControl, ligandEnabled, ligandColorMode, 'ligand');
  updateComponentStyleControl(ionStyleControl, ionEnabled, ionColorMode, 'ion');
  updateComponentStyleControl(waterStyleControl, waterEnabled, waterColorMode, 'water');
  proteinGradientEditor?.setDisabled(renderInFlight);
  nucleicGradientEditor?.setDisabled(
    !nucleicEnabled.checked
      || !GRADIENT_COLOR_MODES.has(nucleicColorMode.value)
      || renderInFlight,
  );
  ligandGradientEditor?.setDisabled(
    !ligandEnabled.checked
      || !GRADIENT_COLOR_MODES.has(ligandColorMode.value)
      || renderInFlight,
  );
  /*
    **The nucleic base-shape control is hidden for good, and this is the one place that says so.**

    `rectangle`, `cylinder` and `purine_pyrimidine` mean nothing here: **a base's shape is the
    look**, and the look is what names it -- `nucleic_blocks` puts a slab on each base's own ring
    plane and `nucleic_rings` puts the ring itself (`src/geom/bases.js`). Nothing in `src/geom/` or
    `src/scene.js` reads `base_shape` at all, so this select reaches no geometry. The markup stays;
    no Style writes it, and `buildRenderRequest()` sends no `base_shape`.
  */
  nucleicBaseShapeControl.hidden = true;
  nucleicBaseShape.disabled = true;
  updateIonFluorescenceControl();
  updateEmissionControls();
  updateLightingControls();
}


function updateFocusSelectionStatus() {
  focusSelectionStatus.textContent = focusTarget
    ? `${focusTarget.label} · ${componentTypeSummary([focusTarget.component_type])}`
    : 'Auto · centre of frame';
  autoDepthOfFieldFocus.hidden = !focusTarget;
}


function updateDepthOfFieldControls() {
  const enabled = depthOfFieldEnabled.checked;
  depthOfFieldDetail.hidden = !enabled;
  depthOfFieldDetail.querySelectorAll('input, button').forEach((control) => {
    control.disabled = !enabled || renderInFlight;
  });
  /*
    Picking a point needs somewhere to click. Both buttons are re-asserted here, because this runs
    at the end of every path that re-enables the Camera card or the callout, and both refuse for the
    one reason that survives: no preview canvas at all.
  */
  const pickable = enabled && Boolean(preview) && Boolean(structureFile) && !renderInFlight;
  /*
    Three reasons a pick is unavailable and they are three different sentences. "No preview canvas"
    is only true once the import has been *tried* -- `ensurePreview()` runs on the first structure
    load -- so saying it before then would blame the machine for something nobody has attempted.
  */
  const why = () => {
    if (!structureFile) return 'Load a structure first.';
    if (!preview) return 'Picking a focus point needs the preview canvas, which could not be built.';
    return 'Click an atom or a residue in the preview to set the focus point';
  };
  const reason = why();
  [pickDepthOfFieldFocus, styleFocusPromptPick].forEach((control) => {
    control.disabled = !pickable;
    control.title = reason;
  });
  fStopValue.value = String(Number(fStop.value));
  syncStyleFocusPromptFStop();
  if (!enabled) closeStyleFocusPrompt();
  updateFocusSelectionStatus();
}


/*
  The callout's f-stop slider is a second face for #f-stop, never a second value: it is mirrored
  from that control whenever anything moves it, and its own drag writes back through it.
*/
function syncStyleFocusPromptFStop() {
  const value = String(Number(fStop.value));
  styleFocusPromptFStopValue.value = value;
  if (document.activeElement !== styleFocusPromptFStop) styleFocusPromptFStop.value = fStop.value;
}


function closeStyleFocusPrompt() {
  // The arm goes with it: every caller is a reason the question has stopped being live.
  styleFocusPromptPending = false;
  styleFocusPrompt.hidden = true;
}


function muteStyleFocusPrompt() {
  styleFocusPromptMuted = true;
  try {
    sessionStorage.setItem(STYLE_FOCUS_PROMPT_MUTED_KEY, '1');
  } catch {}
  closeStyleFocusPrompt();
}


// The two stage modes `.preview-focus-prompt` is visible in (styles.css). One table, so a third
// mode learning to paint it cannot leave this behind.
const FOCUS_PROMPT_STAGE_MODES = new Set(['preview', 'live']);


/*
  Shown on every apply that leaves depth of field on, until the user mutes it. A picked point does
  not suppress it -- that would make it a once-a-page box for anyone who had picked -- so the copy
  says which of the two it is focusing on.
*/
function maybeShowStyleFocusPrompt() {
  if (styleFocusPromptMuted) return;
  if (!structureFile) return;
  if (!depthOfFieldEnabled.checked) return;
  /*
    Preview and Live are the two modes the stylesheet paints it in; Result and Compare are stills
    over the same box, so unhiding there is a showing nobody sees. The answer is kept for the next
    mode that can paint it.
  */
  if (!FOCUS_PROMPT_STAGE_MODES.has(stage?.mode())) {
    styleFocusPromptPending = true;
    return;
  }
  styleFocusPromptPending = false;
  const title = focusTarget ? `Focus point: ${focusTarget.label}` : 'Focus point not selected';
  styleFocusPromptTitle.textContent = title;
  styleFocusPrompt.setAttribute('aria-label', title);
  styleFocusPromptNote.textContent = focusTarget
    ? 'This style uses depth of field. It is focusing on the point you picked.'
    : 'This style uses depth of field. It is focusing on whatever is at the centre of the frame until you pick a point.';
  styleFocusPromptPick.textContent = focusTarget ? 'Pick another point' : 'Pick focus point';
  syncStyleFocusPromptFStop();
  styleFocusPrompt.hidden = false;
}


/*
  The status line lives in the top bar and is one line wide, so a long message is clipped with an
  ellipsis and the whole of it is offered on hover.

  **The hover box is offered only when the line is actually clipped**, and clipped is *measured*
  rather than guessed from the length: `scrollWidth` against `clientWidth` is the browser's own
  answer and it accounts for the font, the window width and whatever else is in the row that day.
  A tooltip that repeats a line already fully on screen is a tooltip people learn to ignore.

  `data-full` carries the message for `content: attr(data-full)` in the stylesheet, so the text has
  one home and there is no second node to fall out of step with this one.
*/
function setLoadStatus(message, isError = false) {
  loadStatus.textContent = message;
  loadStatus.classList.toggle('error', isError);
  if (loadStatusHolder) loadStatusHolder.dataset.full = message ?? '';
  measureLoadStatus();
}


function measureLoadStatus() {
  if (!loadStatusHolder) return;
  loadStatusHolder.classList.toggle('is-clipped', loadStatus.scrollWidth > loadStatus.clientWidth + 1);
}


/*
  The window changing width changes whether the line is clipped, and nothing else on the page asks
  this question, so the listener is here rather than in a shared resize handler.
*/
window.addEventListener('resize', measureLoadStatus);


// True only while the line is a live-trace refusal, so the retarget that recovers can take it back.
let traceRefusalShown = false;

function setRenderStatus(stage, message, isError = false) {
  traceRefusalShown = stage === 'Not traced';
  renderStatus.textContent = message && message !== stage ? `${stage} — ${message}` : stage;
  renderStatus.classList.toggle('error', isError);
}


function setRenderProgress(value) {
  const presentation = renderProgressPresentation(value);
  renderProgressRegion.hidden = !presentation;
  if (!presentation) {
    renderProgress.value = 0;
    renderProgressDetail.textContent = '';
    return;
  }
  renderProgress.value = presentation.percent;
  renderProgressDetail.textContent = presentation.detail;
}


/*
  ------------------------------------------------------------------------------------------------
  The subject: loading a structure, and what every other card reads off it.
  ------------------------------------------------------------------------------------------------
*/

/** `btoa` takes a binary string, and a 64 MB one built by `+=` is a bad idea. */
function toBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}


/*
  Put the molecule in the frame.

  **This file's own eight lines rather than `camera-framing.js`'s answer**, because the product's
  camera is the *view*: `cameraJson()` reads the Mol\* camera the user has been orbiting, and this
  framing is the fallback while no preview camera exists. `camera-framing.js` is imported for the
  two halves that are decidable without one -- the padding fraction, and the lens, which is a real
  control here because `vertical_fov_degrees` is the one camera field a slider can own with nothing
  to orbit.

  A bounding sphere over the molecule: water is excluded, or a thousand waters set the radius and
  the protein renders small in the middle of them. **Excluded even though water can be drawn** --
  what the camera is aimed at is a different question from what is in the picture, and the framing
  is decided at load, before anything has asked for water.
*/
function frameStructureCamera(residues, verticalFovDegrees) {
  const { centre, radius, position } = orbitFrame(
    residues, verticalFovDegrees, paddedCameraFrameRadius,
  );
  return {
    schema_version: 1,
    coordinate_system: 'molstar-model',
    mode: 'perspective',
    position,
    target: centre,
    up: [0, 0, 1],
    vertical_fov_degrees: verticalFovDegrees,
    // Floored as the live branch is: one atom is radius 0, which `validateCamera()` refuses.
    scene_radius: Math.max(radius, 0.01),
  };
}


// The bounding sphere and the 25/15 degree orbit both framings share; each keeps its own padding.
function orbitFrame(residues, verticalFovDegrees, paddedRadius) {
  const molecule = residues.filter((residue) => residue.component !== 'water')
    .flatMap((residue) => residue.atoms);
  // A file that is nothing but water frames the water, as `scene.js`'s `buildColorSource()` does.
  const atoms = molecule.length > 0 ? molecule : residues.flatMap((residue) => residue.atoms);
  if (!atoms.length) throw new Error('the structure has nothing to draw');
  const centre = [0, 1, 2].map((axis) => {
    const key = 'xyz'[axis];
    return atoms.reduce((total, atom) => total + atom[key], 0) / atoms.length;
  });
  // A loop, not `Math.max(...spread)`: past ~125k atoms the spread overflows the argument list.
  let radius = 0;
  for (const atom of atoms) {
    const reach = Math.hypot(atom.x - centre[0], atom.y - centre[1], atom.z - centre[2]);
    if (reach > radius) radius = reach;
  }
  const fov = (verticalFovDegrees * Math.PI) / 180;
  const distance = paddedRadius(radius) / Math.sin(fov / 2);
  const azimuth = (25 * Math.PI) / 180;
  const elevation = (15 * Math.PI) / 180;
  const offset = [
    Math.sin(azimuth) * Math.cos(elevation),
    -Math.cos(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
  ];
  return { centre, radius, position: centre.map((value, axis) => value + offset[axis] * distance) };
}


/** The lens the Camera card is showing, in degrees of vertical field of view. */
function verticalFovDegrees() {
  const millimetres = clampFocalLength(Number(focalLength.value)) ?? Number(focalLength.value);
  return (fovRadiansForFocalLength(millimetres) * 180) / Math.PI;
}


/*
  The camera the request carries, and **it is the view**.

  The camera is whatever the user has orbited the preview to, read off Mol*'s own camera.
  `restoredCameraBaseline` is the exception and it is a narrow one -- a restored session's camera
  wins until the live camera has actually moved off it, which `cameraMatchesJson()` is the test for.

  **The fallback is not decoration.** The plugin arrives through a dynamic `import()` and may not
  arrive at all, and the scaffolding page never builds one -- so with no camera this is the eight
  lines above over the drawn atoms at the lens the slider shows. That is the request a pinned,
  reproducible render depends on, which is why the order matters: the baseline first, the live
  camera second, the framing last.
*/
function cameraJson() {
  const camera = previewCamera();
  if (!camera) {
    if (restoredCameraBaseline) return jsonClone(restoredCameraBaseline);
    return frameStructureCamera(loadedInputs.residues, verticalFovDegrees());
  }
  const snapshot = camera.getSnapshot();
  if (snapshot.mode !== 'perspective') throw new Error('The preview camera is not perspective.');
  if (restoredCameraBaseline && cameraMatchesJson(snapshot, restoredCameraBaseline)) {
    return cloneCameraJson(restoredCameraBaseline);
  }
  return {
    schema_version: 1,
    coordinate_system: 'molstar-model',
    mode: 'perspective',
    position: Array.from(snapshot.position),
    target: Array.from(snapshot.target),
    up: Array.from(snapshot.up),
    vertical_fov_degrees: (snapshot.fov * 180) / Math.PI,
    scene_radius: Math.max(snapshot.radius, 0.01),
  };
}


function applyFocalLength() {
  const millimetres = clampFocalLength(Number(focalLength.value));
  if (millimetres !== undefined) focalLength.value = focalLengthSliderPosition(millimetres);
  // A lens the user has chosen replaces a restored session's camera, and says so by dropping the
  // baseline: the alternative is a slider that moves and a picture that does not.
  if (restoredCameraBaseline) restoredCameraBaseline = undefined;
  /*
    With a preview camera the lens is a *dolly* on it and the readout follows from the camera; with
    none it is a field-of-view number the request carries and the readout follows from the slider.
    Both routes end in the same two lines, which is what keeps the control one control.
  */
  if (millimetres !== undefined) setFocalLength(millimetres);
  syncFocalLengthFromCamera();
  if (structureFile) scheduleTraceUpdate();
}


function syncFocalLengthReadout() {
  const millimetres = clampFocalLength(Number(focalLength.value)) ?? Number(focalLength.value);
  const fov = restoredCameraBaseline
    ? (restoredCameraBaseline.vertical_fov_degrees * Math.PI) / 180
    : fovRadiansForFocalLength(millimetres);
  const shown = restoredCameraBaseline ? focalLengthForFovRadians(fov) : millimetres;
  if (document.activeElement !== focalLength) {
    focalLength.value = focalLengthSliderPosition(shown);
  }
  focalLengthValue.value = `${Math.round(shown)} mm · ${Math.round((fov * 180) / Math.PI)}°`;
}


/*
  Every label, chain and component the cards read, from **our** residue list rather than from a
  second walk of Mol\*'s hierarchy.

  `loadedInputs.residues` is a projection of the same one `Structure` the trace draws
  (`src/structure.js`), so the Components card and the geometry cannot disagree about whether there
  is a ligand: **one `Structure`, one answer**, reached by construction rather than by two walks
  happening to agree.
*/
function collectStructureResidues() {
  const chainInstances = [];
  const nucleicKinds = new Set();
  /*
    Every residue, water included, keyed the way a Mol* location is keyed. This is the one answer
    to "which component is this residue" that `residueComponentType()` reads, so the selection and
    the geometry cannot classify the same residue differently -- a modified nucleotide classified as
    a ligand here and as nucleic there is a layer that selects what the picture does not draw.
  */
  const componentByKey = new Map();
  const residuesByComponent = {
    protein: [], nucleic: [], ligand: [], ion: [], water: [],
  };
  const labels = {
    protein: { chain: new Set(), element: new Set() },
    nucleic: {
      chain: new Set(), element: new Set(), nucleic_base: new Set(), nucleic_part: new Set(),
    },
    ligand: { chain: new Set(), element: new Set() },
    ion: { chain: new Set(), element: new Set() },
    water: { chain: new Set(), element: new Set() },
  };
  for (const residue of loadedInputs.residues) {
    const component = residue.component;
    componentByKey.set(
      residueKey({
        chain_id: residue.chainId,
        sequence_id: residue.residueId,
        insertion_code: residue.insertionCode,
      }),
      component,
    );
    // Water gets the same bucket every other component has: it is drawable, layerable and
    // pickable, and this is the list the water card, the All water shortcut and a water layer read.
    labels[component].chain.add(residue.chainId);
    for (const atom of residue.atoms) {
      labels[component].element.add(normalizeElementSymbol(atom.element));
    }
    if (component === 'nucleic') {
      labels.nucleic.nucleic_base.add(nucleicBaseLabel(residue.name));
      nucleicKinds.add(residue.moleculeType === 3 ? 'DNA' : (residue.moleculeType === 4 ? 'RNA' : 'Nucleic acid'));
    }
    chainInstances.push({
      chain_id: residue.chainId,
      entity_id: residue.atoms[0]?.entityId,
      entity_type: residue.atoms[0]?.entityType,
    });
    /*
      **`residueIdentifier()`'s own shape.** This list is what a Style's overlay pass compresses into
      a layer (`applyStyleOverlays()`), and `compressResidues()` reads `sequence_id`/`insertion_code`
      -- a second spelling such as `seq_id`/`ins_code` makes `Number(undefined)` of every residue and
      hands every overlay pass an empty selection. One vocabulary: the same triple `residueKey()`
      hashes and the sequence strip mirrors.
    */
    residuesByComponent[component].push({
      chain_id: residue.chainId,
      sequence_id: residue.residueId,
      insertion_code: residue.insertionCode,
    });
  }
  if (labels.nucleic.element.size > 0) {
    ['Phosphate', 'Sugar', 'Base'].forEach((label) => labels.nucleic.nucleic_part.add(label));
  }
  const categoryOrder = {
    nucleic_base: ['A', 'C', 'G', 'T', 'U', 'Other'],
    nucleic_part: ['Phosphate', 'Sugar', 'Base'],
  };
  detectedColorLabels = Object.fromEntries(Object.entries(labels).map(([component, modes]) => [
    component,
    Object.fromEntries(Object.entries(modes).map(([mode, values]) => [mode, [...values].sort(
      (left, right) => (categoryOrder[mode]?.indexOf(left) ?? 999)
        - (categoryOrder[mode]?.indexOf(right) ?? 999)
        || String(left).localeCompare(String(right)),
    )])),
  ]));
  availablePolymerChains = polymerChainShortcuts(chainInstances);
  // Built in the pass that already has the list. Protein and nucleic together, because a chain
  // shortcut selects a polymer chain and both are polymer.
  polymerChainResidueKeys = new Map();
  [...residuesByComponent.protein, ...residuesByComponent.nucleic].forEach((residue) => {
    const keys = polymerChainResidueKeys.get(residue.chain_id) ?? new Set();
    keys.add(residueKey(residue));
    polymerChainResidueKeys.set(residue.chain_id, keys);
  });
  residueComponentTypes = componentByKey;
  componentResidues = residuesByComponent;
  componentResidueKeys = new Map(Object.entries(residuesByComponent).map(
    ([component, list]) => [component, new Set(list.map(residueKey))],
  ));
  availableComponents = {
    nucleic: labels.nucleic.element.size > 0,
    ligand: labels.ligand.element.size > 0,
    ion: labels.ion.element.size > 0,
    water: labels.water.element.size > 0,
  };
  nucleicEnabled.checked = availableComponents.nucleic;
  const orderedKinds = ['DNA', 'RNA', 'Nucleic acid'].filter((kind) => nucleicKinds.has(kind));
  nucleicKindStatus.hidden = !availableComponents.nucleic;
  nucleicKindStatus.textContent = orderedKinds.length > 0
    ? `${orderedKinds.join(' + ')} detected automatically.`
    : '';
  // A component that is gone cannot stay switched on; an unchosen switch follows the structure.
  ligandEnabled.checked = availableComponents.ligand
    && (unchosenComponentSwitches.has('ligands') || ligandEnabled.checked);
  ionEnabled.checked = availableComponents.ion && (unchosenComponentSwitches.has('ions') || ionEnabled.checked);
  if (!availableComponents.water) waterEnabled.checked = false;
  updateStyleControls();
}


/*
  ------------------------------------------------------------------------------------------------
  The preview canvas, and everything that needed somewhere to click.
  ------------------------------------------------------------------------------------------------

  `src/preview-canvas.js` is the module: a bare `PluginContext` with no interface, **adopting** the
  `Structure` this file already has rather than loading the file a second time. The wrapper is
  `preview` and the object under it is that `PluginContext`.

  **Behind a dynamic `import()`, and the ordering that follows from it.** The plugin is +1,685 KiB
  and neither the opening screen, the Result trace nor a download needs it, so it is not in the
  first bundle. The consequence is that there is a window at startup with no preview and no camera,
  and every reader of one is written for that window rather than assuming it away: `cameraJson()`
  falls back to the framing above, the mode buttons stay disabled, and the load status says what is
  happening.
*/

let previewImport;

/**
 * Build the preview canvas, once, on first need.
 *
 * **Lazy rather than eager, and that is a decision rather than a nicety.** The plugin (+1,685 KiB,
 * above) sits behind a dynamic `import()` that runs on the first structure load, and the page that
 * never loads one through the studio is not hypothetical: the scaffolding page loads a sample
 * straight into the tracer with no studio around it. Building a Mol* WebGL context beside the
 * WebGPU one there would put a second GPU consumer next to the thing being measured, for a canvas
 * nobody looks at.
 */
function ensurePreview() {
  previewImport ??= (async () => {
    if (!previewHost) return undefined;
    try {
      const previewModule = await import('./preview-canvas.js');
      ({ EmptyLoci, Loci, FOCUS_LOCI_OPTIONS } = previewModule);
      const created = await previewModule.createPreviewCanvas({ container: previewHost });
      /*
        Two subscriptions, and both are why the preview is worth having rather than decoration.

        The selection is part of the composition, so moving it is a step to remember -- and a click
        in the 3D view or the sequence strip changes no form control, so the capture-phase listener
        on `.app-shell` never sees it. `recordHistory()` goes here rather than inside
        `updateCurrentSelectionStatus()`, which is also called whenever the controls are unlocked:
        recording there made every render and every history step look like a fresh edit.
      */
      created.plugin.managers.structure.selection.events.changed.subscribe(() => {
        updateCurrentSelectionStatus();
        recordHistory('selection');
      });
      /*
        **Water's visibility is re-applied whenever the hierarchy changes.** Mol* builds its
        components asynchronously, so the call after the adopt runs before the water component and
        its representation exist -- and a visibility set that reached nothing is a picture
        with water in it. Cheap to repeat, because it sets rather than toggles.

        The hierarchy's own behavior rather than `state.data.events.changed`: `hierarchy.current` is
        a snapshot the manager refreshes on its own schedule, so a state-change subscription fires
        fifteen times during a load and every one of them reads a hierarchy with no water in it yet.
      */
      created.plugin.managers.structure.hierarchy.behaviors.selection.subscribe(() => {
        /*
          Caught, because this runs inside somebody else's event loop. An exception here does not
          merely lose the hide: it propagates back into the hierarchy sync that emitted it, which
          can leave the plugin without its components -- **an empty preview caused by a water
          rule**. A water setting that cannot be applied is worth a line in the status; it is not
          worth the picture.
        */
        try {
          syncPreviewWaterVisibility();
        } catch (error) {
          setLoadStatus(`The preview could not apply the water setting: ${error.message || error}`, true);
        }
      });
      /*
        **The link between the picture and the sequence, and it is one subscription each way round.**

        `onHighlight` is every mark Mol* makes, whatever raised it -- a hover over the canvas, a
        hover over a chip, anything later -- so the strip lights the residue the *picture* lit
        rather than one it worked out for itself. The set is kept here rather than rebuilt, because
        `highlightOnly()` clears before it marks and both halves arrive as separate calls; painting
        the clear alone would be a chip that blinks off and on under a moving pointer.

        The focus is the other half of an Inspect press, from either surface, and Mol* holds exactly
        one -- so the strip is told the whole answer each time rather than a difference.
      */
      created.onHighlight((loci, on) => {
        residueKeysInLoci(loci).forEach(
          (key) => (on ? highlightedResidueKeys.add(key) : highlightedResidueKeys.delete(key)),
        );
        sequenceStrip?.setHovered(highlightedResidueKeys);
      });
      created.plugin.managers.structure.focus.behaviors.current.subscribe((entry) => {
        sequenceStrip?.setFocused(residueKeysInLoci(entry?.loci));
      });
      /*
        Mol*'s own highlight colour, handed to the stylesheet once the canvas exists, so a hovered
        chip and the residue it names are the same colour rather than two palettes that agree today.
      */
      const highlightColor = created.highlightColor();
      if (highlightColor) {
        document.documentElement.style.setProperty('--molstar-highlight', highlightColor);
      }
      created.plugin.behaviors.interaction.click.subscribe(handleFocusPick);
      created.plugin.canvas3d?.didDraw.subscribe(observeCameraMovement);
      /*
        The canvas is created long after the stage has settled on a backdrop -- the plugin is a
        dynamic import behind the opening screen -- so it takes the current one on arrival rather
        than waiting for the next press. Without this, a preview built while Black was selected
        would come up on the Mol* default and the button group would be lying about the picture
        until somebody pressed a different one.
      */
      created.setBackdrop(stage?.backdrop() ?? 'alpha');
      return created;
    } catch (error) {
      /*
        A machine that refuses the WebGL context, or a Mol* upgrade that moves the seam. Neither is a
        reason to take the tracer away: Result, the controls, the request and the download are all
        independent of the plugin. Say which half is missing and leave the rest working -- and say it
        in the load status, which is the line that already speaks about the subject.
      */
      setLoadStatus(`The preview canvas is unavailable: ${error.message || error}. `
        + 'Result still traces, and every control still reaches the picture.', true);
      return undefined;
    }
  })().then((created) => {
    // Assigned here rather than at the call site, so every later reader sees it whether it awaited
    // the import or not -- and exactly once, because the promise is memoised.
    preview = created;
    if (created) {
      updateSelectionPanelState();
      renderChainShortcuts();
      renderComponentShortcuts();
    }
    return created;
  });
  return previewImport;
}


/**
 * Draw the structure in the preview canvas, by adopting the one `Structure` we already built.
 *
 * Awaited by `loadStructure()` rather than left to settle on its own: the camera the request
 * carries is this plugin's camera from the moment it exists, and a trace started before the adopt
 * would frame the molecule from `frameStructureCamera()` and then jump when the preview caught up.
 */
async function showStructureInPreview(file) {
  await ensurePreview();
  if (!preview) return;
  await preview.adopt({
    model: loadedInputs.model,
    structure: loadedInputs.structure,
    label: file.name,
    description: loadedInputs.assembly ? `assembly ${loadedInputs.assembly}` : undefined,
  });
  syncPreviewWaterVisibility();
  /*
    Mol* frames the structure on its own when the representation lands, and that camera is the one
    the request carries from here on. Reading the lens back off it -- rather than writing one -- is
    what keeps `#focal-length` honest: a structure arrives at Mol*'s 45-degree default, which is the
    ~29 mm the slider rests at, so nothing about the default picture changes by having the control.
  */
  syncFocalLengthFromCamera();
  lastObservedCamera = undefined;
}


/*
  Whether this render contains water at all, which is two questions and not one: the component's own
  switch, and any visible layer that names water. The second half is what makes "water off, one
  water in a layer" a picture with water in it -- `scene.js` builds a layer without ever reading
  `enabled`.
*/
function waterIsDrawn() {
  if (waterEnabled.checked && availableComponents.water !== false) return true;
  // `component_types`, the editor layer's field; the singular is only on the request payload.
  return selectionLayers.some((layer) => layer.component_types?.length === 1
    && layer.component_types[0] === 'water'
    && !layer.hidden);
}


/*
  The preview's water follows the render's. An unconditional hide would be the preview and the trace
  disagreeing about what is in the picture -- which is the one thing the adopted `Structure` exists
  to prevent.

  **Visible is also what makes a water pickable**, and picking is how a single water reaches a
  layer: there is no water in the sequence strip (thousands of chips would take the whole strip past
  its limit) and no shortcut narrower than the component.

  The plugin call is `preview-canvas.js`'s, which is the module boundary rather than a wrapper: a
  `mol-plugin` import here would put the plugin's graph in the eager entry chunk, and that file's
  header carries the 2,114 KiB against 1,530 that cost. It is a *set*, so calling it twice is the
  same as calling it once and there is nothing to serialise.
*/
function syncPreviewWaterVisibility() {
  // Async since it can build a Large structure's water component; the rejection is reported here.
  preview?.setWaterVisible(waterIsDrawn()).catch((error) => setLoadStatus(
    `The preview could not apply the water setting: ${error.message || error}`,
    true,
  ));
}


/*
  ------------------------------------------------------------------------------------------------
  The sequence drawer.
  ------------------------------------------------------------------------------------------------
*/

// The data attribute is the single source of truth: it is what `--sequence-drawer-height` keys off,
// so reading the toggle's `aria-expanded` instead would let the two drift apart silently.
function sequenceDrawerExpanded() {
  return viewerPanel.dataset.sequenceDrawer === 'expanded';
}


// The drawer overlays the canvas, so this changes only how much of the canvas is covered. The
// canvas keeps its size, which is what makes the preview frame the same thing the render does.
function setSequenceDrawerExpanded(expanded) {
  viewerPanel.dataset.sequenceDrawer = expanded ? 'expanded' : 'collapsed';
  sequenceDrawerToggle.setAttribute('aria-expanded', String(expanded));
  preview?.handleResize();
}


/*
  ------------------------------------------------------------------------------------------------
  Inspect, Select, and picking a focus point: the three modes of one canvas.
  ------------------------------------------------------------------------------------------------
*/

const PICKING_LEVELS = ['residue', 'chain', 'entity'];


/*
  The picking level, handed to Mol* -- and only while the mode is Select.

  **`Representation.FocusLoci` sets a structure focus only at `residue` or `element` granularity**,
  and returns early otherwise. So leaving `chain` or `entity` set on the way into Inspect drops half
  of what an Inspect click means: the camera still moves, and the residue-and-surroundings the focus
  representation draws never appears -- one control quietly switching another off. The level is a
  fact about *selecting*, so Inspect and focus picking get `residue` back while the pressed button
  goes on saying what Select will do.
*/
function applyPickingGranularity() {
  /*
    **The group says whether it is the one in force, which is not the same as which of the three is
    pressed.** Left at full weight in Inspect it reads as though `Entity` were governing the click
    that is about to land, while the plugin is back at `residue` -- a control describing a state the
    app is not in. It stays pressable, because a press is the way into the mode where it is true.
  */
  pickingLevelGroup.dataset.inForce = String(interactionMode === 'select');
  if (!preview) return;
  preview.plugin.managers.interactivity.setProps({
    granularity: interactionMode === 'select' ? pickingLevel : 'residue',
  });
}


/*
  What a press does, in this mode and at this level.

  **The level is read back off Mol* rather than off `pickingLevel`**, which is the rule
  `FOCUS_LOCI_OPTIONS` keeps two functions down: this line is the only place on the page a picking
  level is observable at all, so describing it from our own copy would let a level that never
  reached the plugin report itself as though it had. The sequence is named separately because it
  genuinely is separate -- `selectStripResidues()` and `selectChain()` pass `applyGranularity:
  false`, so a chip is one residue and a chain button is one chain at every level.
*/
function interactionModeStatusText() {
  if (interactionMode === 'focus') return 'Click an atom or a residue to set the camera focus.';
  if (interactionMode !== 'select') {
    return 'Click the structure, or a residue in the sequence, to focus and inspect it.';
  }
  const granularity = preview?.plugin.managers.interactivity.props.granularity ?? pickingLevel;
  const picks = {
    chain: 'A click in the 3D view takes the whole chain; the sequence still picks one residue.',
    entity: 'A click in the 3D view takes the whole entity: every chain and every copy; the sequence '
      + 'still picks one residue.',
  }[granularity] ?? 'Click residues in the sequence or the 3D view.';
  return picks;
}


/*
  One press in the picking level.

  **It puts the app in Select, and that is what stops it being a control that reaches nothing.**
  The level means nothing in Inspect (above), so pressing `Chain` there would set a value with no
  effect anywhere and no way to see it. Asking for chains is asking to select chains, so it moves
  the mode with it, which is the move `selectChain()` and the component shortcuts already make.
*/
function setPickingLevel(level) {
  if (!PICKING_LEVELS.includes(level)) return;
  pickingLevel = level;
  pickingLevelButtons.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.pickingLevel === pickingLevel));
  });
  setInteractionMode('select');
}


function setInteractionMode(mode) {
  interactionMode = ['select', 'focus'].includes(mode) ? mode : 'inspect';
  if (preview) preview.plugin.selectionMode = interactionMode !== 'inspect';
  applyPickingGranularity();
  /*
    **The strip is live in Inspect too, and what a press means follows the mode.** Disabled outside
    Select, a residue could only be zoomed to by finding it in the 3D view, which is the thing a
    sequence is for. Focus picking is the one mode that switches it off: a press there is meant to
    land on the canvas, and a chip that set a lens focus point would be a third meaning for one
    gesture.
  */
  sequenceStrip?.setEnabled(interactionMode !== 'focus');
  sequenceStrip?.setGesture(interactionMode === 'select' ? 'select' : 'inspect');
  inspectModeButton.setAttribute('aria-pressed', String(interactionMode === 'inspect'));
  selectModeButton.setAttribute('aria-pressed', String(interactionMode === 'select'));
  pickDepthOfFieldFocus.setAttribute('aria-pressed', String(interactionMode === 'focus'));
  pickDepthOfFieldFocus.textContent = interactionMode === 'focus'
    ? 'Cancel focus picking'
    : 'Pick focus in the preview';
  viewerPanel.classList.toggle('focus-picking', interactionMode === 'focus');
  interactionModeStatus.textContent = interactionModeStatusText();
}


function setInteractionModeDisabled(disabled) {
  inspectModeButton.disabled = disabled;
  selectModeButton.disabled = disabled;
}


function restoreSelectionSnapshot(snapshot) {
  if (!preview || !snapshot) return;
  preview.plugin.managers.interactivity.lociSelects.deselectAll();
  preview.plugin.managers.structure.selection.setSnapshot(snapshot);
}


function finishFocusPicking(nextMode = focusPickReturnMode) {
  restoreSelectionSnapshot(focusPickSelectionSnapshot);
  focusPickSelectionSnapshot = undefined;
  focusPickReturnMode = 'inspect';
  setInteractionMode(nextMode);
}


function beginFocusPicking() {
  if (interactionMode === 'focus') {
    finishFocusPicking();
    return;
  }
  if (!preview || !structureFile || !depthOfFieldEnabled.checked) return;
  focusPickReturnMode = interactionMode;
  focusPickSelectionSnapshot = preview.plugin.managers.structure.selection.getSnapshot();
  setInteractionMode('focus');
  // Picking happens in the live view, whichever surface asked for it -- the Camera card or the
  // Style options panel. Live is the trace and Compare is two stills, so a pick started from
  // either would have nothing to click.
  stage?.viewPreview();
  setLoadStatus('Focus picking active. Click an atom or a residue in the preview.');
}


function locationFocusLabel(location, kind) {
  const atomName = StructureProperties.atom.auth_atom_id(location)
    || StructureProperties.atom.label_atom_id(location);
  const residueName = StructureProperties.atom.label_comp_id(location);
  const chainId = locationChainId(location) || '(blank)';
  const insertionCode = StructureProperties.residue.pdbx_PDB_ins_code(location) || '';
  const residueId = `${StructureProperties.residue.auth_seq_id(location)}${insertionCode}`;
  return kind === 'atom'
    ? `Atom ${atomName} · ${residueName} ${residueId} · Chain ${chainId}`
    : `Residue ${residueName} ${residueId} · Chain ${chainId}`;
}


function focusTargetFromInteraction(current, pickPosition) {
  const kind = focusGranularityForPick(current.repr?.label, current.loci.kind);
  const loci = Loci.normalize(current.loci, kind === 'atom' ? 'element' : 'residue', true);
  if (!StructureElement.Loci.is(loci) || StructureElement.Loci.isEmpty(loci)) {
    throw new Error('Click a molecular atom or residue to set camera focus.');
  }
  const locations = [];
  StructureElement.Loci.forEachLocation(loci, (location) => {
    // A water that is not in the picture would aim depth of field at empty space; one that is
    // drawn is an ordinary focus target, and the active site's water is a reasonable thing to
    // focus on.
    if (residueComponentType(location) === 'water' && !waterIsDrawn()) return;
    const position = StructureElement.Location.position([0, 0, 0], location);
    locations.push({
      position: Array.from(position),
      label: locationFocusLabel(location, kind),
      component_type: residueComponentType(location),
    });
  });
  if (locations.length === 0) {
    throw new Error(
      'This water is not in the render. Switch on Water in the Components card, or click a protein, '
      + 'nucleic acid, ligand or ion to set camera focus.',
    );
  }
  const point = focusPointFromPositions(
    locations.map((location) => location.position),
    kind === 'atom',
    pickPosition ? Array.from(pickPosition) : undefined,
  );
  const labelLocation = locations[point.pickedIndex ?? 0];
  return {
    position: point.position,
    kind,
    label: labelLocation.label,
    component_type: labelLocation.component_type,
  };
}


function handleFocusPick({ current, position }) {
  if (interactionMode !== 'focus') return;
  if (Loci.isEmpty(current.loci)) {
    restoreSelectionSnapshot(focusPickSelectionSnapshot);
    setLoadStatus('No molecular element was picked. Focus picking is still active.', true);
    return;
  }
  try {
    focusTarget = focusTargetFromInteraction(current, position);
    finishFocusPicking();
    // The callout asked for exactly this, so it has nothing left to say.
    closeStyleFocusPrompt();
    updateFocusSelectionStatus();
    updateCurrentSelectionStatus();
    setLoadStatus(`Depth of field will focus on ${focusTarget.label}.`);
    scheduleTraceUpdate();
    markSessionDirty();
    recordHistory('focus-target');
  } catch (error) {
    restoreSelectionSnapshot(focusPickSelectionSnapshot);
    setLoadStatus(error.message || String(error), true);
  }
}


// The one way back from a picked point, shared by the button and the bake's driver door.
function useAutoFocus() {
  const moved = focusTarget !== undefined;
  focusTarget = undefined;
  updateDepthOfFieldControls();
  scheduleTraceUpdate();
  // A button, so the shell's change/input listener never marks or records it.
  if (moved) {
    markSessionDirty();
    recordHistory('focus-target');
  }
}


/*
  With nothing picked, depth of field focuses on the surface at the centre of the frame: Mol*'s ray
  pick along the view axis, so it follows the camera. A miss, or no preview, leaves the camera target.

  It rides on `camera` because that is what an orbit retargets without rebuilding the scene
  (`render-backend.js`'s AIM_FIELDS), and it is added only on the way to the tracer, so a session,
  a snapshot and history say "auto" rather than carrying a point every camera move rewrites.
*/
function withAutoFocus(request) {
  const canvas3d = preview?.plugin.canvas3d;
  const { enabled, focus_target: picked } = request.render_settings.depth_of_field;
  if (!enabled || picked || !canvas3d) return request;
  const { position, target } = request.camera;
  const hit = canvas3d.identify({
    origin: position,
    direction: [0, 1, 2].map((axis) => target[axis] - position[axis]),
  });
  if (!hit) return request;
  return { ...request, camera: { ...request.camera, auto_focus_point: Array.from(hit.position) } };
}


/*
  ------------------------------------------------------------------------------------------------
  What is selected, read back into this tree's own vocabulary.
  ------------------------------------------------------------------------------------------------
*/

/*
  The chain id, with `src/structure.js`'s own fallback applied.

  Load-bearing rather than defensive: that file reads `auth_asym_id || label_asym_id || 'A'`, so a
  key built here from `auth_asym_id` alone would not match the residue list for any file where the
  author chain is blank -- and the mirror between the plugin's selection and the sequence strip is
  exactly a comparison of those keys.
*/
function locationChainId(location) {
  return StructureProperties.chain.auth_asym_id(location)
    || StructureProperties.chain.label_asym_id(location)
    || 'A';
}


function residueIdentifier(location) {
  return {
    chain_id: locationChainId(location),
    sequence_id: StructureProperties.residue.auth_seq_id(location),
    insertion_code: StructureProperties.residue.pdbx_PDB_ins_code(location) || '',
  };
}


function residueKey(residue) {
  // Separated by NUL, so a chain id or an insertion code can never make one key read as
  // another. `src/sequence-strip.js` builds the same key, which is what makes the strip a
  // mirror of the plugin's selection rather than a second opinion about it.
  return `${residue.chain_id}\u0000${residue.sequence_id}\u0000${residue.insertion_code}`;
}


/*
  Which component a residue belongs to -- **looked up, never re-decided**.

  Classifying the Mol* location here would be a second answer to a question `residues.js` already
  answers, and the two disagree about ions and about modified bases. This is one lookup into the
  same list the geometry is built from, so a disagreement is not possible rather than merely
  unlikely.
*/
function residueComponentType(location) {
  return residueComponentTypes.get(residueKey(residueIdentifier(location))) ?? 'protein';
}


/*
  **Water is an ordinary member of this list.** A layer naming water is how one water gets drawn, so
  counting it and dropping it here would be the app refusing the workflow the component exists for.
  It needs no counter of its own: `componentTypeSummary()` says "Water" from the one component
  table.
*/
function collectCurrentSelection() {
  if (!preview) return { residues: [] };
  const residues = [];
  preview.plugin.managers.structure.selection.entries.forEach((entry) => {
    if (!entry.structure) return;
    Structure.eachAtomicHierarchyElement(entry.structure, {
      residue: (location) => {
        residues.push(residueIdentifier(location));
      },
    });
  });
  return { residues: normalizeResidues(residues) };
}


function currentSelectionResidues() {
  return collectCurrentSelection().residues;
}


function componentTypesForResidues(residues) {
  const selected = new Set(
    residues.map((residue) => residueComponentTypes.get(residueKey(residue)) ?? 'protein'),
  );
  return ['protein', 'nucleic', 'ligand', 'ion', 'water'].filter((type) => selected.has(type));
}


function clearCurrentSelection() {
  preview?.plugin.managers.interactivity.lociSelects.deselectAll();
}


/*
  One polymer chain, selected.

  **A modifier adds rather than replaces**, which is the rule the sequence strip keeps and the rule
  Mol*'s own select mode keeps in the 3D view: the plain click is `set`, and Ctrl, Shift or Meta
  makes it `add`. Without it a two-chain selection could only be built by picking one chain here and
  the rest in the viewport, and the panel would disagree with the two surfaces beside it about what
  a click means. `mode` is Mol*'s own word, passed straight through, exactly as
  `selectStripResidues()` passes it.
*/
function selectChain(shortcut, { mode = 'set' } = {}) {
  if (!preview || !availablePolymerChains.includes(shortcut)) return;
  const root = preview.structure()?.data;
  if (!root) return;
  setInteractionMode('select');
  const loci = StructureElement.Loci.fromSchema(root, polymerChainSelectionSchema(shortcut));
  if (StructureElement.Loci.isEmpty(loci)) {
    setLoadStatus(`Chain ${shortcut.chain_id || '(blank)'} selected nothing.`, true);
    return;
  }
  preview.plugin.managers.structure.selection.fromLoci(mode, loci, false);
}


// Which of the two the pointer asked for. Meta is here because it is Ctrl's opposite number on a
// Mac and every other multi-select gesture in this app already answers to both.
const addsToSelection = (event) => Boolean(event.ctrlKey || event.shiftKey || event.metaKey);


/*
  The residues a sequence-strip gesture names, turned into a Mol* selection.

  The strip hands back `{ chain_id, sequence_id, insertion_code }` and `compactSelectionLoci()` turns
  that into a Mol\* loci -- so there is one selection in this app and the strip never keeps a second
  copy of it. `mode` is Mol*'s own word, passed straight through.

  Through a layer's own compact form: an absent insertion code matches every code (chip 82 took
  82A-82C on 1IGT), and an item per residue per symmetry copy made All protein a 2.2 s query on 10EC.
*/
function stripResiduesLoci(residues) {
  if (!preview || residues.length === 0) return undefined;
  const root = preview.structure()?.data;
  if (!root) return undefined;
  const loci = compactSelectionLoci(root, compressResidues(residues), 'The selection');
  return !loci || StructureElement.Loci.isEmpty(loci) ? undefined : loci;
}


function selectStripResidues(residues, { mode = 'set' } = {}) {
  const loci = stripResiduesLoci(residues);
  if (!loci) return;
  preview.plugin.managers.structure.selection.fromLoci(mode, loci, false);
}


/*
  A residue named in the sequence strip, zoomed to **and marked**.

  It changes no selection: Inspect is the mode where a press looks at a residue and nothing else.
  `observeCameraMovement()` is already subscribed to `didDraw`, so the move re-traces and steps
  through undo with every other camera move, and needs nothing here.

  **Two calls, because a click in the 3D view is two behaviours and this is the same gesture.**
  Mol* answers an Inspect click with `Representation.FocusLoci` (which sets the focus, and is what
  `StructureFocusRepresentation` draws the residue and its surroundings from) *and* with
  `Camera.FocusLoci` (which moves the camera). The camera move alone flies at a residue and leaves
  the reader to work out which of the things now filling the viewport it was aimed at; the focus is
  what says *which*.

  **It does not toggle, where the canvas does.** `FocusLoci` clears a focus that is pressed twice,
  because in the 3D view a click is also how a focus is dismissed; in the strip a second press on
  the chip you are reading would blank the thing you pressed it to see, and moving on is pressing
  another chip.
*/
function focusStripResidues(residues) {
  const loci = stripResiduesLoci(residues);
  if (!loci || !preview.plugin.canvas3d) return;
  preview.plugin.managers.structure.focus.setFromLoci(loci);
  preview.plugin.managers.camera.focusLoci(loci, FOCUS_LOCI_OPTIONS);
}


/*
  A residue under the pointer in the sequence strip, lit in the picture.

  **In both modes**: a hover says "this is the one your pointer is on", which is true whether the
  next press would select it or look at it, and it writes nothing -- Mol*'s highlight is a mark on the canvas, not a state a session carries. The strip's
  own chip lights from the *reply* rather than from here (`preview.onHighlight` below), so the two
  surfaces cannot disagree about what is hovered.
*/
function hoverStripResidues(residues) {
  if (!preview) return;
  const loci = residues && stripResiduesLoci(residues);
  if (loci) preview.highlight(loci);
  else preview.clearHighlight();
}


/*
  Which residues a Mol* loci covers, in this file's own keys.

  **Per residue rather than per atom, and the skip is what makes it cheap enough for a hover.**
  `forEachLocation` walks every atom, and a highlight at `entity` granularity is every atom of every
  copy; `unit.residueIndex` is Mol*'s own element-to-residue map, so the four property reads behind
  a key happen once per residue instead of once per atom. A loci's indices are sorted within a unit,
  so a residue's atoms are adjacent and remembering the last one is the whole test.
*/
function residueKeysInLoci(loci) {
  const keys = new Set();
  if (!StructureElement.Loci.is(loci) || StructureElement.Loci.isEmpty(loci)) return keys;
  let lastUnit;
  let lastResidue = -1;
  StructureElement.Loci.forEachLocation(loci, (location) => {
    const residue = location.unit.residueIndex?.[location.element];
    if (location.unit === lastUnit && residue === lastResidue) return;
    lastUnit = location.unit;
    lastResidue = residue;
    keys.add(residueKey(residueIdentifier(location)));
  });
  return keys;
}


/*
  The chain shortcuts. They replace the current selection with one polymer chain -- or add to it,
  held with Ctrl or Shift, which is the rule the sequence strip and Mol*'s own select mode keep.
*/
function renderChainShortcuts() {
  chainShortcuts.replaceChildren();
  chainPicker.hidden = availablePolymerChains.length === 0;
  availablePolymerChains.forEach((shortcut) => {
    const chainId = shortcut.chain_id;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chain-shortcut';
    button.dataset.chain = chainId;
    button.setAttribute('aria-pressed', 'false');
    button.textContent = chainId || '(blank)';
    button.disabled = !preview || !structureFile;
    button.title = `Replace the current selection with polymer chain ${chainId || '(blank)'}`
      + '. Hold Ctrl or Shift to add it to what is already selected.';
    button.addEventListener('click', (event) => selectChain(
      shortcut,
      { mode: addsToSelection(event) ? 'add' : 'set' },
    ));
    chainShortcuts.append(button);
  });
}


/*
  Whether each chain shortcut is in the selection, repainted from the one selection every time it
  changes -- the strip, a drag, a click in the 3D view, Clear, a layer.

  Three states rather than two, and the middle one is `aria-pressed="mixed"`: a chain the selection
  holds only part of is neither. Reporting a part-selected chain as plain unselected would say the
  button had done nothing, and reporting it as selected would claim residues that are not there.
*/
function pressedState(keys, selectedKeys) {
  if (!keys || keys.size === 0) return 'false';
  let held = 0;
  keys.forEach((key) => { if (selectedKeys.has(key)) held += 1; });
  return held === 0 ? 'false' : (held === keys.size ? 'true' : 'mixed');
}


function paintChainShortcuts(selectedKeys) {
  chainShortcuts.querySelectorAll('.chain-shortcut').forEach((button) => {
    button.setAttribute(
      'aria-pressed',
      pressedState(polymerChainResidueKeys.get(button.dataset.chain), selectedKeys),
    );
  });
}


/*
  The component shortcuts: the chain shortcut at the granularity above it.

  The chain buttons above can only name a **polymer** chain -- `polymerChainShortcuts()` filters on
  `entity_type` -- so without these every non-polymer has to be found in the 3D view one click at a
  time, and "hide all the water" has no control at all short of clicking a few thousand of them.

  The labels are the component table's (`componentTypeSummary()`), so a component cannot be called
  one thing here and another in the layer it makes. Only the components this structure has get a
  button: a row that selects nothing is a control that reaches nothing.
*/
const COMPONENT_SHORTCUTS = ['protein', 'nucleic', 'ligand', 'ion', 'water'];

/*
  The five components as a sentence, for the one message that has to list them. The labels are the
  component table's — only the joining is here — because a hand-written list goes stale the moment a
  component is added and then reads as though that component were not allowed.
*/
const COMPONENT_PROSE = COMPONENT_SHORTCUTS
  .map((component) => componentTypeSummary([component]).toLowerCase())
  .reduce((prose, label, index, all) => (
    index === 0 ? label : `${prose}${index === all.length - 1 ? ' or ' : ', '}${label}`
  ), '');


function selectComponent(component, { mode = 'set' } = {}) {
  const residues = componentResidues[component] ?? [];
  if (!preview || residues.length === 0) return;
  setInteractionMode('select');
  selectStripResidues(residues, { mode });
}


function renderComponentShortcuts() {
  componentShortcuts.replaceChildren();
  const present = COMPONENT_SHORTCUTS.filter(
    (component) => (componentResidues[component]?.length ?? 0) > 0,
  );
  componentPicker.hidden = present.length === 0;
  present.forEach((component) => {
    const label = componentTypeSummary([component]);
    // Grammar, not a second vocabulary: the component table's label is singular and a button that
    // selects every one of them is not. Two entries, and the title below still reads the table.
    const plural = { ligand: 'ligands', ion: 'ions' }[component] ?? label.toLowerCase();
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chain-shortcut';
    button.dataset.component = component;
    button.setAttribute('aria-pressed', 'false');
    button.textContent = `All ${plural}`;
    button.disabled = !preview || !structureFile;
    button.title = `Replace the current selection with every ${label.toLowerCase()} residue`
      + '. Hold Ctrl or Shift to add it to what is already selected.';
    button.addEventListener('click', (event) => selectComponent(
      component,
      { mode: addsToSelection(event) ? 'add' : 'set' },
    ));
    componentShortcuts.append(button);
  });
}


// The chain buttons' three states, for the same reason: a component the selection holds part of is
// neither pressed nor unpressed, and `false` on a half-selected one says the button did nothing.
function paintComponentShortcuts(selectedKeys) {
  componentShortcuts.querySelectorAll('.chain-shortcut').forEach((button) => {
    button.setAttribute(
      'aria-pressed',
      pressedState(componentResidueKeys.get(button.dataset.component), selectedKeys),
    );
  });
}


function selectionFitsLayer(layer, residues = currentSelectionResidues()) {
  const selectedTypes = componentTypesForResidues(residues);
  return selectedTypes.length === 1
    && layer.component_types.length === 1
    && selectedTypes[0] === layer.component_types[0];
}


function updateCurrentSelectionStatus() {
  const { residues } = collectCurrentSelection();
  const selectedTypes = componentTypesForResidues(residues);
  if (!structureFile) {
    currentSelectionStatus.textContent = 'Load a structure to begin selecting.';
  } else if (!preview) {
    currentSelectionStatus.textContent = 'The preview canvas is unavailable, so there is nowhere to select.';
  } else if (selectionLayerEdit && residues.length === 0) {
    currentSelectionStatus.textContent = `Editing ${selectionLayerEdit.layer.name}: add at least one rendered residue before saving.`;
  } else if (selectedTypes.length > 1) {
    currentSelectionStatus.textContent = `${componentTypeSummary(selectedTypes)} selected. One layer holds a single component (${COMPONENT_PROSE}) — remove the other types.`;
  } else if (selectionLayerEdit && !selectionFitsLayer(selectionLayerEdit.layer, residues)) {
    currentSelectionStatus.textContent = `Editing a ${componentTypeSummary(selectionLayerEdit.layer.component_types)} layer, but the current selection is ${componentTypeSummary(selectedTypes)}. Select only the layer's original component type.`;
  } else if (selectionLayerEdit) {
    const compact = compressResidues(residues);
    currentSelectionStatus.textContent = `${selectionSummary(compact)} · ${componentTypeSummary(selectedTypes)}. Editing ${selectionLayerEdit.layer.name} — add or remove, then Save selection.`;
  } else if (residues.length === 0) {
    currentSelectionStatus.textContent = 'Nothing selected.';
  } else {
    const compact = compressResidues(residues);
    currentSelectionStatus.textContent = `${selectionSummary(compact)} · ${componentTypeSummary(selectedTypes)}`;
  }
  // Both mirror whatever the plugin says is selected, whether the click landed in the strip, in
  // the chain picker or in the 3D view. One selection, one paint.
  const selectedKeys = new Set(residues.map(residueKey));
  sequenceStrip?.setSelected(selectedKeys);
  paintChainShortcuts(selectedKeys);
  paintComponentShortcuts(selectedKeys);
  /*
    **Handed down rather than asked for again.** Left to walk the plugin's selection themselves,
    these two turn one `selection.events.changed` into three runs of `collectCurrentSelection()` --
    three passes of `Structure.eachAtomicHierarchyElement`, each allocating one identifier object
    per residue out of four Mol* property reads. Selecting a chain of 574 residues (4HHB) is ~1,700
    objects and ~6,900 accessor calls where one pass answers all three; on a chain-sized selection
    in a large assembly it is several times that, and Mol* notifies **synchronously**, so it lands
    inside the gesture rather than after it.

    Nothing between here and them can move the selection -- what runs is `textContent` writes and
    the strip's own repaint -- so the list is the same list either way. Both keep their own default,
    which is what makes every other caller of them unchanged.
  */
  updateSelectionPanelState(residues);
  updateSelectionLayerEditControls(renderInFlight, residues);
}


/*
  What the selection panel offers.

  A layer is made from a selection, so Create layer and Hide selection are live exactly when there
  is one that fits in a layer. `updateCurrentSelectionStatus()` is where that is decided, because it
  is the function that already knows what is selected.
*/
function updateSelectionPanelState(knownResidues) {
  const usable = Boolean(structureFile && preview) && !renderInFlight;
  setInteractionModeDisabled(!usable);
  sequenceDrawerToggle.disabled = !preview;
  fitVisibleButton.disabled = !usable;
  chainShortcuts.querySelectorAll('button').forEach((button) => { button.disabled = !usable; });
  pickingLevelButtons.forEach((button) => { button.disabled = !usable; });
  updateSavedCameraViewControls();
  // The caller's own walk when it has one; its own otherwise, so every other caller of this
  // function is unchanged.
  const residues = knownResidues ?? collectCurrentSelection().residues;
  const selectedTypes = componentTypesForResidues(residues);
  addSelectionButton.disabled = !usable
    || residues.length === 0
    || selectedTypes.length !== 1
    || selectionLayers.length >= MAX_SELECTION_LAYERS
    || Boolean(selectionLayerEdit);
  // Hide selection creates a layer, so it is live under exactly the same conditions.
  hideSelectionButton.disabled = addSelectionButton.disabled;
  clearSelectionButton.disabled = !usable || residues.length === 0;
  emptyLayersMessage.hidden = selectionLayers.length !== 0;
  selectionCount.textContent = `${selectionLayers.length} / ${MAX_SELECTION_LAYERS}`;
}


/*
  ------------------------------------------------------------------------------------------------
  The selection layers: a styled region of the structure, and the card that edits one.
  ------------------------------------------------------------------------------------------------

  Three rules hold this section together.

  1. **One vocabulary for a representation id.** There is no prefixed-in-the-picker, bare-in-a-layer
     spelling and no table resolving between the two: a layer's Representation select is built from
     `representationOptionsForComponents()` and its settings are resolved by
     `representationSettingControls()` off the same id the request carries.
  2. **`moveItem`/`moveItemBeside` are `src/layer-order.js`'s**, imported rather than restated, so
     the pointer drag and the two arrow buttons cannot order a list two ways.
  3. **Every read of `preview` is optional-chained**: the plugin is a dynamic import that a machine
     short of a second WebGL context may refuse, and a studio whose Result trace works and whose
     Preview does not is still the studio.
*/

function remapLayerLoci(layer, structure) {
  let combined;
  layer.loci.forEach((loci) => {
    if (loci.structure.root !== structure.root) return;
    const remapped = StructureElement.Loci.remap(loci, structure);
    combined = combined ? StructureElement.Loci.union(combined, remapped) : remapped;
  });
  return combined ?? EmptyLoci;
}


/*
  The layers, painted on the preview.

  **The painting loop is `preview-canvas.js`'s, and the split is the module boundary rather than a
  tidy-up.** All of it is calls into `mol-plugin-state`, and importing that here puts the plugin's
  whole graph in the entry chunk while `ensurePreview()` is busy keeping it out -- 2,114 KiB of
  eager JS against 1,530. What stays on this side is the part that is about *our* layers: which
  structure a layer's loci belong to (`remapLayerLoci`, which is `mol-model` and not the plugin),
  and the list itself.
*/
async function refreshSelectionPreview() {
  if (!preview || !structureFile) return;
  /*
    A water layer is one of the two things that put water in the picture, so the preview's water has
    to be re-decided whenever the layers move -- created, hidden, shown, removed. Idempotent: it
    sets the water's visibility rather than toggling it.
  */
  syncPreviewWaterVisibility();
  await preview.paintSelectionLayers(selectionLayers, remapLayerLoci);
}


/*
  A layer changed, so **both** surfaces re-read the layers.

  Every selection-layer mutation is a *button* -- Create layer, Hide, the eye toggle, Remove, the
  ordering arrows, Update selection -- and the shell's blanket retrace listens on `change` and
  `input`, which a button never fires. Without the trace half the preview goes transparent the
  instant Hide is pressed and Live goes on tracing the old picture until something else happens to
  touch a control, step history, move the camera or leave and re-enter the panel: intermittent, and
  invisible to anything that reads source, because a live trace a few seconds stale looks exactly
  like one that is converging.

  It belongs here rather than at the eight call sites because **the preview and the trace must agree
  about what is drawn**, and a mutation that told only one of them is the whole shape of that
  defect. `scheduleTraceUpdate()` coalesces to one rebuild a frame and returns immediately when
  there is no trace, so the sites that already retrace through the capture-phase listener (a layer's
  own colour wheel, its colour mode) pay nothing.
*/
function queueSelectionRepaint() {
  previewQueue = previewQueue
    .catch(() => undefined)
    .then(refreshSelectionPreview)
    .catch((error) => setLoadStatus(`Preview overpaint failed: ${error.message || error}`, true));
  scheduleTraceUpdate();
}


function optionSelect(options, value, label) {
  const wrapper = document.createElement('label');
  const caption = document.createElement('span');
  caption.textContent = label;
  const select = document.createElement('select');
  options.forEach(([optionValue, optionLabel, notBuilt]) => {
    const option = document.createElement('option');
    option.value = optionValue;
    option.textContent = optionLabel;
    option.disabled = Boolean(notBuilt);
    select.append(option);
  });
  // Assignment selects a disabled option -- `disabled` refuses the user's choice, not the code's.
  // Measured in Chromium on 2026-09-22: `selectedIndex` lands on it, fresh and after a rebuild.
  // It is what lets a card show a value a saved document holds and the pickers no longer offer.
  select.value = value;
  wrapper.append(caption, select);
  return { wrapper, select };
}


/*
  A select's options as `[value, label, notBuilt]` triples.

  A layer card's colour select is rebuilt from these, and a rebuilt `<option>` comes back enabled --
  so `applyFidelityGating()` reached the rail's own pickers and stopped at every layer, which could
  be pointed at a mode the tracer has no code for.

  **Marked, never dropped**, which is the gate's own rule one level down: a greyed option reads as a
  promise, a vanished one reads as a bug -- and, less cosmetically, a mode a saved document already
  carries has to stay representable. Drop it from the list and the layer card cannot show the value
  its layer holds, so the reconciliation below rewrites the layer instead, silently. Disabling
  refuses the *choice* and leaves the value alone, which is exactly what the rail does and what
  `setSelectValue()` does for a base component.

  **It is the mark rather than `disabled`, because `disabled` means two things on these selects.**
  `updateProteinColorControl()` and `updateNucleicColorModeAvailability()` also disable `element`
  and `nucleic_part`, but transiently, for the *base* card's representation, and with `hidden`
  beside it. `colorModesForComponents()` asks that same question again for the layer's own look, so
  reading a bare `disabled` would hand a layer the base card's answer instead: a sphere layer under
  a cartoon base would lose `element`, which it can perfectly well be coloured by.
*/
function selectOptions(select) {
  return [...select.options]
    .map((option) => [option.value, option.textContent.trim(), option.dataset.notBuilt === 'true']);
}


function pickerOptions(select) {
  return [...select.options].map((option) => ({
    value: option.value,
    label: option.textContent.trim(),
    group: option.parentElement instanceof HTMLOptGroupElement
      ? option.parentElement.label
      : undefined,
  }));
}


/*
  A layer's Material select offers exactly what the rail's material picker offers, in the same order
  and with the same captions: the five hidden selects list the same twelve values in two different
  markup orders, and the picker already reorders them through the catalogue. Reading the layer list
  through the catalogue too is what stops Ceramic sitting second on the left and last in a layer.
*/
function materialOptionsForComponent(componentType) {
  const source = {
    protein: materialInput,
    nucleic: nucleicMaterial,
    ligand: ligandMaterial,
    ion: ionMaterial,
    water: waterMaterial,
  }[componentType] ?? materialInput;
  return catalogOptions('material', pickerOptions(source));
}


function replaceSelectOptions(select, options, preferredValue, fallbackValue) {
  select.replaceChildren(...options.map(([value, label, notBuilt]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.disabled = Boolean(notBuilt);
    return option;
  }));
  const allowed = new Set(options.map(([value]) => value));
  select.value = allowed.has(preferredValue)
    ? preferredValue
    : (allowed.has(fallbackValue) ? fallbackValue : options[0]?.[0] ?? '');
}


function optionText(options, value) {
  return options.find(([optionValue]) => optionValue === value)?.[1] ?? value;
}


/*
  Which colour modes a layer of these components may take.

  Read off the rail's own hidden `<select>` for that component rather than from a table here, which
  is the same discipline `materialOptionsForComponent()` follows: one list, in one place, so a mode
  added to the markup reaches a layer with nothing edited. `nucleic_part` and `element` are dropped
  for a look that cannot be coloured per atom -- a cartoon takes one colour per residue at its alpha
  carbon, so `element` would paint every ribbon carbon grey.
*/
function colorModesForComponents(componentTypes, representation) {
  const atomColorsAvailable = representationSupportsAtomColors(representation);
  const component = componentTypes.length === 1 ? componentTypes[0] : '';
  // Water is the one component with no colour-mode select to read, because it has one mode. Named
  // here rather than given a hidden select nobody would ever change.
  if (component === 'water') return [['uniform', 'Uniform']];
  const source = {
    protein: proteinColorMode,
    nucleic: nucleicColorMode,
    ligand: ligandColorMode,
    ion: ionColorMode,
  }[component];
  if (!source) return [];
  return selectOptions(source)
    .filter(([mode]) => atomColorsAvailable || !['nucleic_part', 'element'].includes(mode));
}


// Enough movement to tell a reorder from a click on the handle, matching the render tray.
const SELECTION_DRAG_THRESHOLD = 4;


function clearSelectionLayerDragState() {
  if (selectionLayerDrag?.captured) {
    // renderSelectionLayers() replaces these nodes; a capture left on a detached one is never
    // released, and the pointer stays hostage for the rest of the session.
    selectionLayerDrag.handle.releasePointerCapture?.(selectionLayerDrag.pointerId);
  }
  selectionLayerDrag = undefined;
  selectionLayersElement.querySelectorAll('.selection-layer').forEach((card) => {
    card.style.transform = '';
    card.classList.remove('is-dragging', 'drop-before', 'drop-after');
  });
}


/*
  Where would a drop at this pointer position put the dragged layer?

  Returns the target card index and the side of it, or undefined when the drop would leave the
  order unchanged -- which is also what suppresses the indicator line for a no-op gesture.
*/
function selectionLayerDropTarget(pointerY) {
  const { rects, from } = selectionLayerDrag;
  let index = 0;
  rects.forEach((rect, candidate) => {
    if (pointerY >= rect.top) index = candidate;
  });
  const rect = rects[index];
  const placement = pointerY < rect.top + rect.height / 2 ? 'before' : 'after';
  if (index === from) return undefined;
  if (index === from - 1 && placement === 'after') return undefined;
  if (index === from + 1 && placement === 'before') return undefined;
  return { index, placement };
}


function updateSelectionLayerOrderControls(disabled = renderInFlight) {
  [...selectionLayersElement.querySelectorAll('.selection-layer')].forEach((card, index, cards) => {
    const handle = card.querySelector('.selection-drag-handle');
    handle.disabled = disabled;
    card.querySelector('.selection-move-up').disabled = disabled || index === 0;
    card.querySelector('.selection-move-down').disabled = disabled || index === cards.length - 1;
  });
  if (disabled) clearSelectionLayerDragState();
}


function updateSelectionLayerEditControls(disabled = renderInFlight, knownResidues) {
  // As in `updateSelectionPanelState()`: the caller's walk when it has one, its own otherwise.
  const selectedResidues = knownResidues ?? (preview ? currentSelectionResidues() : []);
  /*
    This pairs a DOM card with `selectionLayers[index]`, which only holds while the two are the same
    length -- and they are not, for as long as it takes a caller that changes the layers to re-render
    them. Applying a Style's overlay passes reaches into that window: each pass writes a Mol*
    selection, and Mol* notifies its subscribers *synchronously*, so this function runs from inside
    the loop that is still building the list. `applyStyleOverlays()` keeps `selectionLayers` whole
    until it has the finished list, which closes the window; the guard is the second lock, because a
    crash here unwinds an unrelated Mol* subscription and the stack points nowhere near whatever
    moved the layers.
  */
  [...selectionLayersElement.querySelectorAll('.selection-layer')].forEach((card, index) => {
    if (!selectionLayers[index]) return;
    const layer = selectionLayers[index];
    const isEditing = selectionLayerEdit?.layer === layer;
    const edit = card.querySelector('.selection-edit-button');
    const cancel = card.querySelector('.selection-cancel-edit');
    const remove = card.querySelector('.danger');
    edit.disabled = disabled
      || (Boolean(selectionLayerEdit) && !isEditing)
      || (isEditing && !selectionFitsLayer(layer, selectedResidues));
    cancel.disabled = disabled;
    remove.disabled = disabled || isEditing;
  });
}


function beginSelectionLayerEdit(layer) {
  if (!preview || renderInFlight || selectionLayerEdit) return;
  if (interactionMode === 'focus') finishFocusPicking('inspect');
  selectionLayerEdit = {
    layer,
    previousSnapshot: preview.plugin.managers.structure.selection.getSnapshot(),
    previousMode: interactionMode,
  };
  restoreSelectionSnapshot(layer.snapshot);
  setInteractionMode('select');
  layer.expanded = true;
  renderSelectionLayers();
  selectionOrderStatus.textContent = `${layer.name} is open for selection editing.`;
  requestAnimationFrame(() => {
    const index = selectionLayers.indexOf(layer);
    selectionLayersElement.children[index]
      ?.querySelector('.selection-edit-button')?.focus();
  });
}


function cancelSelectionLayerEdit() {
  if (!selectionLayerEdit) return;
  const { layer, previousSnapshot, previousMode } = selectionLayerEdit;
  selectionLayerEdit = undefined;
  restoreSelectionSnapshot(previousSnapshot);
  setInteractionMode(previousMode === 'focus' ? 'inspect' : previousMode);
  renderSelectionLayers();
  selectionOrderStatus.textContent = `${layer.name} selection edit cancelled.`;
}


function saveSelectionLayerEdit(layer) {
  if (selectionLayerEdit?.layer !== layer) return;
  const index = selectionLayers.indexOf(layer);
  if (index < 0) {
    selectionLayerEdit = undefined;
    renderSelectionLayers();
    return;
  }
  replaceLayerResidues(index, { finishEdit: true });
}


function finishSelectionLayerMove(result, focusClass) {
  if (!result) return;
  const movedName = result.item.name.trim() || `Layer ${result.toIndex + 1}`;
  clearSelectionLayerDragState();
  renderSelectionLayers();
  queueSelectionRepaint();
  markSessionDirty();
  recordHistory('selection-layer-order');
  selectionOrderStatus.textContent = `${movedName} moved to position ${result.toIndex + 1}.`;
  if (focusClass) {
    requestAnimationFrame(() => {
      selectionLayersElement.children[result.toIndex]
        ?.querySelector(`.${focusClass}`)?.focus();
    });
  }
}


function moveSelectionLayerBy(index, offset, focusClass) {
  if (renderInFlight) return;
  finishSelectionLayerMove(
    moveItem(selectionLayers, index, index + offset),
    focusClass,
  );
}


function renderSelectionLayers() {
  if (selectionLayerEdit && !selectionLayers.includes(selectionLayerEdit.layer)) {
    selectionLayerEdit = undefined;
  }
  selectionLayersElement.replaceChildren();
  emptyLayersMessage.hidden = selectionLayers.length !== 0;
  selectionCount.textContent = `${selectionLayers.length} / ${MAX_SELECTION_LAYERS}`;
  selectionLayers.forEach((layer, index) => {
    /*
      A layer restored from a document, or built by a Style, carries the *resolved* representation
      id -- `cartoon_railed`, `side_chain_sticks`, `surface_open_cavities`. The card splits that
      back into the picker plus its one refining control, once, so the two selects below are always
      a decomposition of the id the request will carry rather than a second opinion about it.
    */
    const storedCartoonType = cartoonTypeForRepresentation(layer.representation);
    if (storedCartoonType !== undefined) {
      layer.cartoon_type ??= storedCartoonType;
      layer.representation = 'cartoon';
    }
    const storedRibbonType = ribbonTypeForRepresentation(layer.representation);
    if (storedRibbonType !== undefined) {
      layer.ribbon_type ??= storedRibbonType;
      layer.representation = 'ribbon';
    }
    const storedAtomScope = atomScopeForRepresentation(layer.representation);
    if (storedAtomScope !== undefined) {
      layer.stick_scope ??= storedAtomScope;
      layer.representation = allAtomRepresentation(layer.representation);
    }
    const storedSurfaceDetail = surfaceDetailForRepresentation(layer.representation);
    if (storedSurfaceDetail !== undefined) {
      layer.surface_detail ??= storedSurfaceDetail;
      layer.representation = 'surface';
    }
    layer.expanded ??= index === 0;
    layer.hidden ??= false;
    const card = document.createElement('article');
    card.className = 'selection-layer';
    card.classList.toggle('is-hidden-layer', layer.hidden);
    card.dataset.layerPosition = String(index + 1);

    const header = document.createElement('div');
    header.className = 'selection-layer-header';
    const dragHandle = document.createElement('button');
    dragHandle.type = 'button';
    dragHandle.className = 'selection-drag-handle';
    dragHandle.disabled = renderInFlight;
    dragHandle.textContent = '⠿';
    dragHandle.title = 'Drag to reorder this layer';
    dragHandle.setAttribute('aria-label', `Drag layer ${index + 1} to reorder`);
    const layerNumber = document.createElement('span');
    layerNumber.className = 'selection-index';
    layerNumber.textContent = String(index + 1);
    const name = document.createElement('input');
    name.type = 'text';
    name.maxLength = 80;
    name.value = layer.name;
    name.setAttribute('aria-label', `Selection layer ${index + 1} name`);
    name.addEventListener('input', () => { layer.name = name.value; });
    const orderActions = document.createElement('div');
    orderActions.className = 'selection-order-actions';
    const moveUp = document.createElement('button');
    moveUp.type = 'button';
    moveUp.className = 'selection-move-up';
    moveUp.textContent = '↑';
    moveUp.title = 'Move layer up';
    moveUp.setAttribute('aria-label', `Move ${layer.name} up`);
    moveUp.disabled = index === 0 || renderInFlight;
    moveUp.addEventListener('click', () => moveSelectionLayerBy(index, -1, 'selection-drag-handle'));
    const moveDown = document.createElement('button');
    moveDown.type = 'button';
    moveDown.className = 'selection-move-down';
    moveDown.textContent = '↓';
    moveDown.title = 'Move layer down';
    moveDown.setAttribute('aria-label', `Move ${layer.name} down`);
    moveDown.disabled = index === selectionLayers.length - 1 || renderInFlight;
    moveDown.addEventListener('click', () => moveSelectionLayerBy(index, 1, 'selection-drag-handle'));
    /*
      Hiding is a property of the layer, not a mode of the app: the layer keeps its name, its place
      in the order and its whole appearance while hidden, so unhiding restores exactly the picture
      that was there. A button rather than a checkbox, like every other layer control -- the
      capture-phase change/input listener on `.app-shell` is the unsaved marker, and this handler
      does that bookkeeping itself.
    */
    const visibility = document.createElement('button');
    visibility.type = 'button';
    visibility.className = 'selection-layer-visibility';
    visibility.textContent = '\u{1F441}';
    visibility.setAttribute('aria-pressed', String(layer.hidden));
    visibility.title = layer.hidden
      ? 'Show this layer in the render and the preview'
      : 'Hide this layer in the render and the preview';
    visibility.setAttribute('aria-label', `${layer.hidden ? 'Show' : 'Hide'} ${layer.name}`);
    visibility.addEventListener('click', () => {
      layer.hidden = !layer.hidden;
      const layerName = layer.name.trim() || `Layer ${index + 1}`;
      renderSelectionLayers();
      queueSelectionRepaint();
      markSessionDirty();
      recordHistory('selection-layer-visibility');
      selectionOrderStatus.textContent = layer.hidden
        ? `${layerName} hidden.`
        : `${layerName} shown.`;
      requestAnimationFrame(() => {
        selectionLayersElement.children[index]
          ?.querySelector('.selection-layer-visibility')?.focus();
      });
    });
    const expand = document.createElement('button');
    expand.type = 'button';
    expand.className = 'selection-layer-toggle';
    expand.setAttribute('aria-controls', `selection-layer-body-${index}`);
    orderActions.append(visibility, moveUp, moveDown, expand);
    header.append(dragHandle, layerNumber, name, orderActions);

    const summary = document.createElement('p');
    summary.className = 'selection-summary';
    const selectionDescription = document.createElement('span');
    selectionDescription.textContent = `${selectionSummary(layer)} · ${componentTypeSummary(layer.component_types)}`;
    const appearanceDescription = document.createElement('span');
    appearanceDescription.className = 'selection-appearance-summary';
    const colorCue = document.createElement('span');
    colorCue.className = 'selection-color-cue';
    colorCue.style.background = GRADIENT_COLOR_MODES.has(layer.color_mode)
      ? `linear-gradient(90deg, ${layer.gradient_start}, ${layer.gradient_end})`
      : (normalizeColor(layer.color) ?? '#999999');
    colorCue.setAttribute('aria-hidden', 'true');
    const appearanceText = document.createElement('span');
    appearanceText.textContent = `${optionText(
      representationOptionsForComponents(layer.component_types),
      layer.representation,
    )} · ${optionText(materialOptionsForComponent(layer.component_types[0]), layer.material)}`;
    appearanceDescription.append(colorCue, appearanceText);
    summary.append(selectionDescription, appearanceDescription);
    if (layer.hidden) {
      // The state has to read from the row itself: the eye button carries one glyph in both states,
      // and a dimmed card alone is what a disabled control looks like too.
      const hiddenTag = document.createElement('span');
      hiddenTag.className = 'selection-hidden-tag';
      hiddenTag.textContent = 'Hidden — not rendered';
      summary.append(hiddenTag);
    }

    const fields = document.createElement('div');
    fields.className = 'selection-layer-fields';
    const representation = optionSelect(
      representationOptionsForComponents(layer.component_types),
      layer.representation,
      'Representation',
    );
    representation.select.addEventListener('change', () => {
      layer.representation = representation.select.value;
      resetLayerRepresentationSettings();
      updateCartoonTypeControl();
      updateRibbonTypeControl();
      updateSurfaceDetailControl();
      updateAtomScopeControl();
      updateLayerColorModeOptions();
    });
    const cartoonType = optionSelect(
      CARTOON_TYPE_OPTIONS,
      layer.cartoon_type ?? DEFAULT_CARTOON_TYPE,
      'Type',
    );
    cartoonType.select.addEventListener('change', () => {
      layer.cartoon_type = cartoonType.select.value;
      resetLayerRepresentationSettings();
    });
    const updateCartoonTypeControl = () => {
      const visible = layer.component_types.includes('protein')
        && representation.select.value === 'cartoon';
      cartoonType.wrapper.hidden = !visible;
      cartoonType.select.disabled = !visible || renderInFlight;
    };
    const ribbonType = optionSelect(
      RIBBON_TYPE_OPTIONS,
      layer.ribbon_type ?? 'standard',
      'Type',
    );
    ribbonType.select.addEventListener('change', () => {
      layer.ribbon_type = ribbonType.select.value;
      resetLayerRepresentationSettings();
    });
    const updateRibbonTypeControl = () => {
      const visible = layer.component_types.includes('protein')
        && representation.select.value === 'ribbon';
      ribbonType.wrapper.hidden = !visible;
      ribbonType.select.disabled = !visible || renderInFlight;
    };
    const atomScope = optionSelect(
      ATOM_SCOPE_OPTIONS,
      layer.stick_scope ?? 'all',
      'Atoms',
    );
    atomScope.select.addEventListener('change', () => {
      layer.stick_scope = atomScope.select.value;
    });
    const updateAtomScopeControl = () => {
      const proteinOnly = layer.component_types.length === 1
        && layer.component_types[0] === 'protein';
      const visible = proteinOnly
        && atomScopeForRepresentation(representation.select.value) !== undefined;
      atomScope.wrapper.hidden = !visible;
      atomScope.select.disabled = !visible || renderInFlight;
    };
    const surfaceDetail = optionSelect(
      SURFACE_DETAIL_OPTIONS,
      String(layer.surface_detail ?? 1),
      'Level of detail',
    );
    surfaceDetail.select.addEventListener('change', () => {
      layer.surface_detail = Number(surfaceDetail.select.value);
      resetLayerRepresentationSettings();
    });
    const updateSurfaceDetailControl = () => {
      const visible = layer.component_types.includes('protein')
        && representation.select.value === 'surface';
      surfaceDetail.wrapper.hidden = !visible;
      surfaceDetail.select.disabled = !visible || renderInFlight;
    };
    const representationGeometry = document.createElement('fieldset');
    representationGeometry.className = 'cartoon-settings representation-settings';
    const representationGeometryLegend = document.createElement('legend');
    representationGeometryLegend.textContent = 'Representation geometry';
    const representationGeometryGrid = document.createElement('div');
    representationGeometryGrid.className = 'cartoon-settings-grid';
    const representationGeometryHelp = document.createElement('span');
    representationGeometryHelp.className = 'range-help';
    representationGeometry.append(
      representationGeometryLegend,
      representationGeometryGrid,
      representationGeometryHelp,
    );
    const representationGeometryEditor = createRepresentationSettingsEditor(
      representationGeometry,
      representationGeometryGrid,
      representationGeometryHelp,
      `Selection layer ${index + 1}`,
    );
    /*
      The layer's representation as one id -- **the same id the request carries**, with nothing
      mapping it into a second spelling on the way to the settings table.

      `COMPONENT_REPRESENTATIONS` names the prefixed id, so there is no ligand-layer `spheres` to
      turn into `ligand_spheres` and `representationSettingControls()` reads the id directly.
    */
    const selectedLayerRepresentation = () => {
      if (layer.component_types.length !== 1) return undefined;
      return layer.component_types[0] === 'protein'
        ? resolvedRepresentationForControls(
          representation.select.value,
          cartoonType.select.value,
          ribbonType.select.value,
          surfaceDetail.select.value,
          atomScope.select.value,
        )
        : representation.select.value;
    };
    const resetLayerRepresentationSettings = (settings, enableContract = true) => {
      const selectedRepresentation = selectedLayerRepresentation();
      layer.representation_settings = representationGeometryEditor.setRepresentation(
        selectedRepresentation,
        settings ?? representationSettingsForRepresentation(selectedRepresentation),
      );
      representationGeometryEditor.setDisabled(renderInFlight);
      if (enableContract) representationSettingsContractEnabled = true;
    };
    resetLayerRepresentationSettings(layer.representation_settings, false);
    // No base-shape select: a base's shape is the look, and nothing in `src/geom/` reads
    // `base_shape`. `updateStyleControls()` carries the argument.
    const material = optionSelect(
      materialOptionsForComponent(layer.component_types[0]),
      layer.material,
      'Material',
    );
    material.select.addEventListener('change', () => { layer.material = material.select.value; });
    const nucleicOnly = layer.component_types.length === 1
      && layer.component_types[0] === 'nucleic';
    const layerColorModes = colorModesForComponents(
      layer.component_types,
      representation.select.value,
    );
    if (!layerColorModes.some(([mode]) => mode === layer.color_mode)) {
      layer.color_mode = nucleicOnly ? 'nucleic_base' : 'uniform';
    }
    const colorMode = optionSelect(
      layerColorModes,
      layer.color_mode,
      'Colour',
    );
    const colorLabel = document.createElement('label');
    colorLabel.className = 'layer-uniform-color';
    const colorCaption = document.createElement('span');
    colorCaption.textContent = 'Uniform colour';
    const color = createColorPair(layer.color, `${layer.name} uniform colour`, (value) => {
      layer.color = value;
      queueSelectionRepaint();
    });
    const gradientStart = createColorPair(
      layer.gradient_start,
      `${layer.name} gradient start`,
      (value) => { layer.gradient_start = value; },
    );
    const gradientEnd = createColorPair(
      layer.gradient_end,
      `${layer.name} gradient end`,
      (value) => { layer.gradient_end = value; },
    );
    const gradientMidpoints = document.createElement('div');
    gradientMidpoints.className = 'gradient-colors';
    const gradientAddColor = document.createElement('button');
    gradientAddColor.type = 'button';
    gradientAddColor.className = 'gradient-add-color';
    gradientAddColor.textContent = '+ Add colour';
    const gradientCount = document.createElement('p');
    gradientCount.className = 'range-help gradient-count';
    const gradientFooter = document.createElement('div');
    gradientFooter.className = 'gradient-footer';
    gradientFooter.append(gradientAddColor, gradientCount);
    const gradientEditor = createGradientColorEditor({
      container: gradientMidpoints,
      addButton: gradientAddColor,
      count: gradientCount,
      startHex: gradientStart.hex,
      endHex: gradientEnd.hex,
      label: `${layer.name} gradient`,
      defaultColors: COMPONENT_COLOR_DEFAULTS[layer.component_types[0]]?.gradient,
      onColorsChanged: (values) => {
        layer.gradient_start = values[0];
        layer.gradient_end = values.at(-1);
        layer.gradient_midpoints = values.slice(1, -1);
      },
    });
    gradientEditor.setValues(layer.gradient_midpoints ?? []);
    const updateLayerColorControl = () => {
      const uniformColor = colorMode.select.value === 'uniform';
      const gradientColor = GRADIENT_COLOR_MODES.has(colorMode.select.value);
      color.setDisabled(!uniformColor || renderInFlight);
      colorLabel.hidden = !uniformColor;
      gradientEditor.setDisabled(!gradientColor || renderInFlight);
      gradientMidpoints.hidden = !gradientColor;
      gradientFooter.hidden = !gradientColor;
      // As in the left rail, a metric ramp's stops are per-label colours in this same grid, and
      // they arrive in ramp order rather than being detected from the structure or sorted.
      const metricStops = metricColorStopLabels(colorMode.select.value);
      const detectedMode = ['chain', 'element', 'nucleic_base', 'nucleic_part']
        .includes(colorMode.select.value);
      const categoryMode = metricStops.length > 0 || detectedMode
        ? colorMode.select.value
        : undefined;
      const labels = metricStops.length > 0 ? metricStops
        : detectedMode
          ? [...new Set(layer.component_types.flatMap(
            (component) => detectedColorLabels[component]?.[categoryMode] ?? [],
          ))].sort()
          : [];
      categoryColors.replaceChildren();
      categoryColors.hidden = labels.length === 0;
      labels.forEach((label, labelIndex) => {
        layer.color_overrides[categoryMode] ??= {};
        layer.color_overrides[categoryMode][label] ??= defaultCategoryColor(
          layer.component_types[0],
          categoryMode,
          label,
          labelIndex,
        );
        const item = document.createElement('label');
        item.className = 'category-color';
        const caption = document.createElement('span');
        caption.textContent = label || '(blank)';
        const pair = createColorPair(
          layer.color_overrides[categoryMode][label],
          `${layer.name} ${categoryMode} ${label || 'blank'} colour`,
          (value) => { layer.color_overrides[categoryMode][label] = value; },
        );
        pair.setDisabled(renderInFlight);
        item.append(caption, pair.wrapper);
        categoryColors.append(item);
      });
    };
    const updateLayerColorModeOptions = () => {
      const modes = colorModesForComponents(
        layer.component_types,
        representation.select.value,
      );
      replaceSelectOptions(
        colorMode.select,
        modes,
        layer.color_mode,
        nucleicOnly ? 'nucleic_base' : 'uniform',
      );
      layer.color_mode = colorMode.select.value;
      updateLayerColorControl();
    };
    colorMode.select.addEventListener('change', () => {
      layer.color_mode = colorMode.select.value;
      updateLayerColorControl();
      queueSelectionRepaint();
    });
    colorLabel.append(colorCaption, color.wrapper);
    const categoryColors = document.createElement('div');
    categoryColors.className = 'category-colors';
    const opacityLabel = document.createElement('label');
    opacityLabel.className = 'selection-opacity-control';
    const opacityCaption = document.createElement('span');
    opacityCaption.className = 'range-caption';
    const opacityName = document.createElement('span');
    opacityName.textContent = 'Opacity';
    const opacityOutput = document.createElement('output');
    opacityOutput.value = String(layer.opacity);
    const opacity = document.createElement('input');
    opacity.type = 'range';
    opacity.min = '0';
    opacity.max = '1';
    opacity.step = '0.05';
    opacity.value = String(layer.opacity);
    opacity.setAttribute('aria-label', `${layer.name} material opacity`);
    opacity.addEventListener('input', () => {
      layer.opacity = opacityNumber(opacity.value, 'Selection layer opacity');
      updateOpacityOutput(opacity, opacityOutput);
    });
    opacityCaption.append(opacityName, opacityOutput);
    opacityLabel.append(opacityCaption, opacity);
    const emissionLabel = document.createElement('label');
    emissionLabel.className = 'emission-strength-control';
    const emissionCaption = document.createElement('span');
    emissionCaption.className = 'range-caption';
    emissionCaption.textContent = 'Emission strength';
    const emission = document.createElement('input');
    emission.type = 'range';
    emission.min = '0';
    emission.max = '20';
    emission.step = '0.5';
    emission.value = String(layer.emission_strength);
    emission.addEventListener('input', () => { layer.emission_strength = Number(emission.value); });
    emissionLabel.append(emissionCaption, emission);
    const advanced = document.createElement('details');
    advanced.className = 'advanced-options component-advanced-options';
    const advancedSummary = document.createElement('summary');
    advancedSummary.textContent = 'Advanced settings';
    advanced.append(
      advancedSummary,
      representationGeometry,
      emissionLabel,
      opacityLabel,
    );
    const updateLayerMaterialControls = () => {
      const visible = EMISSION_TUNABLE.has(material.select.value);
      emissionLabel.hidden = !visible;
      emission.disabled = !visible || renderInFlight;
    };
    material.select.addEventListener('change', updateLayerMaterialControls);
    fields.append(
      representation.wrapper,
      cartoonType.wrapper,
      ribbonType.wrapper,
      atomScope.wrapper,
      surfaceDetail.wrapper,
      material.wrapper,
      colorMode.wrapper,
      colorLabel,
      gradientMidpoints,
      gradientFooter,
      categoryColors,
      advanced,
    );
    updateCartoonTypeControl();
    updateRibbonTypeControl();
    updateSurfaceDetailControl();
    updateAtomScopeControl();
    updateLayerColorControl();
    updateLayerMaterialControls();

    const actions = document.createElement('div');
    actions.className = 'selection-layer-actions';
    const isEditingSelection = selectionLayerEdit?.layer === layer;
    card.classList.toggle('is-selection-editing', isEditingSelection);
    const editSelection = document.createElement('button');
    editSelection.type = 'button';
    editSelection.className = 'selection-edit-button';
    editSelection.classList.toggle('primary', isEditingSelection);
    editSelection.textContent = isEditingSelection ? 'Save selection' : 'Edit selection';
    editSelection.title = isEditingSelection
      ? 'Save the current selection back into this layer'
      : 'Load this layer into the preview so residues can be added or removed';
    editSelection.addEventListener('click', () => {
      if (isEditingSelection) saveSelectionLayerEdit(layer);
      else beginSelectionLayerEdit(layer);
    });
    const cancelEdit = document.createElement('button');
    cancelEdit.type = 'button';
    cancelEdit.className = 'selection-cancel-edit';
    cancelEdit.textContent = 'Cancel';
    cancelEdit.hidden = !isEditingSelection;
    cancelEdit.addEventListener('click', cancelSelectionLayerEdit);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'danger';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      const removedName = layer.name.trim() || `Layer ${index + 1}`;
      selectionLayers.splice(index, 1);
      renderSelectionLayers();
      queueSelectionRepaint();
      markSessionDirty();
      recordHistory('selection-layer-remove');
      selectionOrderStatus.textContent = `${removedName} removed.`;
      updateCurrentSelectionStatus();
    });
    actions.append(editSelection, cancelEdit, remove);

    const body = document.createElement('div');
    body.id = `selection-layer-body-${index}`;
    body.className = 'selection-layer-body';
    body.append(fields, actions);
    const updateExpanded = () => {
      body.hidden = !layer.expanded;
      card.classList.toggle('is-expanded', layer.expanded);
      expand.textContent = layer.expanded ? 'Done' : 'Edit';
      expand.setAttribute('aria-expanded', String(layer.expanded));
      expand.setAttribute('aria-label', `${layer.expanded ? 'Close' : 'Edit'} ${layer.name}`);
    };
    expand.addEventListener('click', () => {
      layer.expanded = !layer.expanded;
      updateExpanded();
      // Closing is the moment the compact appearance summary becomes visible again. Repainting it
      // here makes it reflect edits made inside the full form without wiring every field twice.
      if (!layer.expanded) {
        renderSelectionLayers();
        requestAnimationFrame(() => {
          selectionLayersElement.children[index]
            ?.querySelector('.selection-layer-toggle')?.focus();
        });
      }
    });
    updateExpanded();

    dragHandle.addEventListener('pointerdown', (event) => {
      if (renderInFlight || selectionLayers.length < 2 || (event.button ?? 0) !== 0) return;
      const cards = [...selectionLayersElement.children];
      const from = cards.indexOf(card);
      if (from < 0) return;
      selectionLayerDrag = {
        layer,
        handle: dragHandle,
        pointerId: event.pointerId,
        startY: event.clientY,
        from,
        cards,
        rects: cards.map((node) => node.getBoundingClientRect()),
        moved: false,
      };
      /*
        Capture on the press, not on the first move past the threshold: a quick drag leaves the
        24px handle before its second pointermove, and without the capture that move -- and the
        pointerup after it -- would go to whatever is under the cursor instead. The handle has no
        click handler of its own, so the retargeted click this causes lands nowhere.
      */
      try {
        dragHandle.setPointerCapture(event.pointerId);
        selectionLayerDrag.captured = true;
      } catch {
        // A synthetic pointer event has no active pointer to capture. The drag still works: every
        // listener is on the handle, which is where a test driver dispatches.
      }
    });
    dragHandle.addEventListener('pointermove', (event) => {
      const drag = selectionLayerDrag;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dy = event.clientY - drag.startY;
      if (!drag.moved) {
        if (Math.abs(dy) < SELECTION_DRAG_THRESHOLD) return;
        drag.moved = true;
        drag.cards[drag.from].classList.add('is-dragging');
      }
      drag.cards[drag.from].style.transform = `translateY(${dy}px)`;
      const rect = drag.rects[drag.from];
      drag.target = selectionLayerDropTarget(rect.top + rect.height / 2 + dy);
      drag.cards.forEach((node, cardIndex) => {
        node.classList.toggle(
          'drop-before',
          Boolean(drag.target) && cardIndex === drag.target.index && drag.target.placement === 'before',
        );
        node.classList.toggle(
          'drop-after',
          Boolean(drag.target) && cardIndex === drag.target.index && drag.target.placement === 'after',
        );
      });
    });
    dragHandle.addEventListener('pointerup', () => {
      const drag = selectionLayerDrag;
      if (!drag) return;
      const target = drag.moved ? drag.target : undefined;
      if (!target) {
        clearSelectionLayerDragState();
        return;
      }
      const targetLayer = selectionLayers[target.index];
      finishSelectionLayerMove(
        moveItemBeside(selectionLayers, drag.layer, targetLayer, target.placement),
        'selection-drag-handle',
      );
    });
    dragHandle.addEventListener('pointercancel', clearSelectionLayerDragState);

    card.append(header, summary, body);
    selectionLayersElement.append(card);
  });
  updateCurrentSelectionStatus();
}


function captureSelectionLayer(existing) {
  const residues = currentSelectionResidues();
  if (residues.length === 0) {
    throw new Error('Select at least one residue, nucleotide, ligand, ion or water first.');
  }
  const compact = compressResidues(residues);
  const componentTypes = componentTypesForResidues(residues);
  if (componentTypes.length !== 1) {
    throw new Error(
      `One layer can contain only one component type. Split ${componentTypeSummary(componentTypes)} into separate layers.`,
    );
  }
  if (existing?.component_types?.length === 1
      && existing.component_types[0] !== componentTypes[0]) {
    throw new Error(
      `This is a ${componentTypeSummary(existing.component_types)} layer. Its edited selection must stay within that component type.`,
    );
  }
  const componentType = componentTypes[0];
  const representationOptions = representationOptionsForComponents(componentTypes);
  const previousControls = existing
    ? baseRepresentationControls(existing.representation)
    : {};
  const previousRepresentation = previousControls.representation;
  const representation = representationOptions.some(
    ([value]) => value === previousRepresentation,
  ) ? previousRepresentation : representationOptions[0][0];
  const cartoonType = existing?.cartoon_type
    ?? previousControls.cartoon_type
    ?? cartoonTypeInput.value;
  const ribbonType = existing?.ribbon_type
    ?? previousControls.ribbon_type
    ?? ribbonTypeInput.value;
  const surfaceDetail = existing?.surface_detail
    ?? previousControls.surface_detail
    ?? Number(surfaceDetailInput.value);
  const atomScope = existing?.stick_scope
    ?? previousControls.stick_scope
    ?? atomScopeInput.value;
  // One vocabulary: the id a protein layer resolves to is the id the request carries, and every
  // other component's picker already holds its own prefixed id.
  const resolvedRepresentation = componentType === 'protein'
    ? resolvedRepresentationForControls(
      representation,
      cartoonType,
      ribbonType,
      surfaceDetail,
      atomScope,
    )
    : representation;
  // Built from the residues rather than the pick: the trace matches author ids in every symmetry
  // copy, and a click selects one copy.
  const root = preview.structure()?.data;
  const layerLoci = root && compactSelectionLoci(root, compact, 'The selection');
  const loci = layerLoci && !StructureElement.Loci.isEmpty(layerLoci) ? [layerLoci] : [];
  const componentDefaults = {
    protein: {
      material: materialInput.value,
      color_mode: proteinColorMode.value,
      color: normalizeColor(colorHex.value),
      gradient_start: normalizeColor(proteinGradientStartHex.value),
      gradient_end: normalizeColor(proteinGradientEndHex.value),
      gradient_midpoints: proteinGradientEditor?.values() ?? [],
      opacity: opacityNumber(proteinOpacity.value, 'Protein opacity'),
      emission_strength: Number(proteinEmissionStrength.value),
    },
    nucleic: {
      material: nucleicMaterial.value,
      color_mode: nucleicColorMode.value,
      color: normalizeColor(nucleicColorHex.value),
      gradient_start: normalizeColor(nucleicGradientStartHex.value),
      gradient_end: normalizeColor(nucleicGradientEndHex.value),
      gradient_midpoints: nucleicGradientEditor?.values() ?? [],
      opacity: opacityNumber(nucleicOpacity.value, 'Nucleic acid opacity'),
      emission_strength: Number(nucleicEmissionStrength.value),
    },
    ligand: {
      material: ligandMaterial.value,
      color_mode: ligandColorMode.value,
      color: normalizeColor(ligandColorHex.value),
      gradient_start: normalizeColor(ligandGradientStartHex.value),
      gradient_end: normalizeColor(ligandGradientEndHex.value),
      gradient_midpoints: ligandGradientEditor?.values() ?? [],
      opacity: opacityNumber(ligandOpacity.value, 'Ligand opacity'),
      emission_strength: Number(ligandEmissionStrength.value),
    },
    ion: {
      material: ionMaterial.value,
      color_mode: ionColorMode.value,
      color: normalizeColor(ionColorHex.value),
      gradient_start: COMPONENT_COLOR_DEFAULTS.ion.gradient[0],
      gradient_end: COMPONENT_COLOR_DEFAULTS.ion.gradient[1],
      gradient_midpoints: [],
      opacity: opacityNumber(ionOpacity.value, 'Ion opacity'),
      emission_strength: Number(ionFluorescence.value),
    },
    water: {
      material: waterMaterial.value,
      color_mode: waterColorMode.value,
      color: normalizeColor(waterColorHex.value),
      gradient_start: COMPONENT_COLOR_DEFAULTS.water.gradient[0],
      gradient_end: COMPONENT_COLOR_DEFAULTS.water.gradient[1],
      gradient_midpoints: [],
      opacity: opacityNumber(waterOpacity.value, 'Water opacity'),
      emission_strength: Number(waterEmissionStrength.value),
    },
  }[componentType];
  return {
    ...compact,
    component_types: componentTypes,
    name: existing?.name ?? `Selection ${selectionLayers.length + 1}`,
    representation,
    cartoon_type: cartoonType,
    ribbon_type: ribbonType,
    surface_detail: surfaceDetail,
    stick_scope: atomScope,
    /*
      **Narrowed against the id this layer resolves to, never taken whole.**

      A layer's settings and its representation are decided in two different places -- a Style's
      overlay pass declares one and the pickers above resolve the other -- and the block that
      arrives may name fields this look does not have. Taking such a block whole is a validator
      walking fields that do not exist, and refusing the Style; so it is narrowed field by field,
      never taken whole and never dropped whole.
    */
    representation_settings: narrowedRepresentationSettings(
      resolvedRepresentation,
      existing?.representation_settings,
    ),
    material: existing?.material ?? componentDefaults.material,
    color_mode: existing?.color_mode ?? componentDefaults.color_mode,
    color_overrides: existing?.color_overrides ?? {},
    color: existing?.color
      ?? componentDefaults.color
      ?? UNIFORM_COLOR_PRESETS[(selectionLayers.length + 2) % UNIFORM_COLOR_PRESETS.length][1],
    gradient_start: existing?.gradient_start
      ?? componentDefaults.gradient_start
      ?? COMPONENT_COLOR_DEFAULTS.protein.gradient[0],
    gradient_end: existing?.gradient_end
      ?? componentDefaults.gradient_end
      ?? COMPONENT_COLOR_DEFAULTS.protein.gradient[1],
    gradient_midpoints: [...(existing?.gradient_midpoints ?? componentDefaults.gradient_midpoints)],
    opacity: existing?.opacity ?? componentDefaults.opacity,
    emission_strength: existing?.emission_strength ?? componentDefaults.emission_strength,
    hidden: existing?.hidden ?? false,
    expanded: existing ? existing.expanded : true,
    /*
      Carried rather than re-derived. This is the one constructor both the session-restore path and
      the Style-overlay path go through, so tagging here is what makes a restored Style layer come
      back owned by the Style instead of silently becoming the user's own.
    */
    ...(existing?.origin ? { origin: existing.origin } : {}),
    snapshot: preview.plugin.managers.structure.selection.getSnapshot(),
    loci,
  };
}


/*
  Hiding is a layer that renders nothing, so Hide selection is Create layer with the flag already
  set: one gesture for the common case, and the same layer afterwards -- reorderable, editable, and
  restored by its own eye button. It is called through a wrapper rather than bound directly, so a
  click event can never arrive where the options object belongs.
*/
function addSelectionLayer({ hidden = false } = {}) {
  try {
    if (selectionLayers.length >= MAX_SELECTION_LAYERS) {
      throw new Error(`At most ${MAX_SELECTION_LAYERS} selection layers are supported.`);
    }
    const layer = captureSelectionLayer();
    if (hidden) {
      layer.hidden = true;
      layer.name = `Hidden ${selectionLayers.length + 1}`;
      // Nothing in the editor applies to a layer that draws nothing, so it opens closed.
      layer.expanded = false;
    }
    selectionLayers.push(layer);
    clearCurrentSelection();
    renderSelectionLayers();
    queueSelectionRepaint();
    markSessionDirty();
    recordHistory('selection-layer-create');
    selectionOrderStatus.textContent = hidden
      ? `Layer ${selectionLayers.length} created and hidden.`
      : `Layer ${selectionLayers.length} created and ready to edit.`;
  } catch (error) {
    setLoadStatus(error.message || String(error), true);
  }
}


function replaceLayerResidues(index, { finishEdit = false } = {}) {
  try {
    const updatedLayer = captureSelectionLayer(selectionLayers[index]);
    selectionLayers[index] = updatedLayer;
    if (finishEdit) selectionLayerEdit = undefined;
    clearCurrentSelection();
    renderSelectionLayers();
    queueSelectionRepaint();
    markSessionDirty();
    recordHistory('selection-layer-replace');
    selectionOrderStatus.textContent = `${selectionLayers[index].name} selection updated.`;
    return true;
  } catch (error) {
    setLoadStatus(error.message || String(error), true);
    return false;
  }
}


function resetSelectionLayers() {
  selectionLayers = [];
  selectionLayerEdit = undefined;
  clearSelectionLayerDragState();
  selectionOrderStatus.textContent = '';
  renderSelectionLayers();
}


/*
  A layer's compact residue selection, as a Mol* selection schema.

  `residue_ranges` are whole runs of one chain and `residues` is the awkward remainder -- the ones
  carrying an insertion code, which have no arithmetic between them. Both halves are named because
  a range that swallowed an insertion code would silently select more than the document says.
*/
function selectionSchema(compact, path) {
  if (!Array.isArray(compact.residue_ranges) || !Array.isArray(compact.residues)) {
    throw new Error(`${path} does not contain a valid residue selection.`);
  }
  const items = compact.residue_ranges.map((range) => ({
    auth_asym_id: String(range.chain_id ?? ''),
    beg_auth_seq_id: Number(range.start),
    end_auth_seq_id: Number(range.end),
    pdbx_PDB_ins_code: '',
  }));
  compact.residues.forEach((residue) => {
    items.push({
      auth_asym_id: String(residue.chain_id ?? ''),
      auth_seq_id: Number(residue.sequence_id),
      pdbx_PDB_ins_code: String(residue.insertion_code ?? ''),
    });
  });
  if (items.some((item) => Object.values(item).some(
    (value) => typeof value === 'number' && !Number.isInteger(value),
  ))) {
    throw new Error(`${path} contains an invalid residue number.`);
  }
  return { items };
}


/*
  A compact residue selection as one Mol\* loci: a single `atomGroups` whose residue test looks the
  residue's chain, number and insertion code up in a set, once per residue. `Loci.fromSchema()` runs a
  query over every unit per item -- ~5 ms each on 1OHF's first assembly -- and a selection of every
  other residue is an item per residue: a five-layer session there took 80 s to open. The same
  properties the schema tests, so the same atoms. Every selection in the app is built here: the
  strip, a layer and a restore.
*/
const MAX_SELECTION_SEQUENCE_IDS = 5_000_000;

function compactSelectionLoci(root, compact, path) {
  const { items } = selectionSchema(compact, path);
  const chains = new Set();
  const keys = new Set();
  const add = (chain, insertionCode, first, last) => {
    if (keys.size + last - first + 1 > MAX_SELECTION_SEQUENCE_IDS) {
      throw new Error(`${path} names more residues than a structure can hold.`);
    }
    chains.add(chain);
    for (let id = first; id <= last; id += 1) keys.add(`${chain}\u0000${id}\u0000${insertionCode}`);
  };
  items.forEach((item) => {
    if (item.auth_seq_id !== undefined) {
      add(item.auth_asym_id, item.pdbx_PDB_ins_code, item.auth_seq_id, item.auth_seq_id);
    } else if (item.beg_auth_seq_id <= item.end_auth_seq_id) {
      // A range never takes an insertion-coded residue, as in the schema's own range item.
      add(item.auth_asym_id, '', item.beg_auth_seq_id, item.end_auth_seq_id);
    }
  });
  if (keys.size === 0) return undefined;
  const { macromolecular } = MS.struct.atomProperty;
  return StructureElement.Loci.fromExpression(root, MS.struct.generator.atomGroups({
    'chain-test': MS.core.set.has([MS.core.type.set([...chains]), macromolecular.auth_asym_id()]),
    'residue-test': MS.core.set.has([MS.core.type.set([...keys]), MS.core.str.concat([
      macromolecular.auth_asym_id(), '\u0000', macromolecular.auth_seq_id(), '\u0000',
      macromolecular.pdbx_PDB_ins_code(),
    ])]),
  }));
}


/*
  A document's residue selection, re-expressed as the compact form `compressResidues()` writes for
  this structure's own residues.

  Mol\* runs one query per schema item (~2.8 ms each on 1AYM), and a document can list any number of
  overlapping or absent items -- 40,000 of them fit in an 18 k-character link. Answered against the
  structure first, the query costs what a session holding that selection would.
*/
function canonicalCompactSelection(compact, path) {
  const { items } = selectionSchema(compact, path);
  const ranges = new Map();
  const singles = new Set();
  items.forEach((item) => {
    if (item.auth_seq_id !== undefined) {
      singles.add(residueKey({
        chain_id: item.auth_asym_id, sequence_id: item.auth_seq_id, insertion_code: item.pdbx_PDB_ins_code,
      }));
    } else if (item.beg_auth_seq_id <= item.end_auth_seq_id) {
      const chain = ranges.get(item.auth_asym_id) ?? [];
      chain.push([item.beg_auth_seq_id, item.end_auth_seq_id]);
      ranges.set(item.auth_asym_id, chain);
    }
  });
  // Sorted and merged, so each residue is one binary search however many ranges were listed.
  ranges.forEach((chain, chainId) => {
    chain.sort((left, right) => left[0] - right[0]);
    const merged = [];
    chain.forEach(([start, end]) => {
      const last = merged.at(-1);
      if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
      else merged.push([start, end]);
    });
    ranges.set(chainId, merged);
  });
  const inRanges = (chain, sequenceId) => {
    let low = 0;
    let high = chain.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (sequenceId < chain[middle][0]) high = middle - 1;
      else if (sequenceId > chain[middle][1]) low = middle + 1;
      else return true;
    }
    return false;
  };
  const residues = [];
  residueComponentTypes.forEach((type, key) => {
    const [chainId, sequence, insertionCode] = key.split('\u0000');
    const sequenceId = Number(sequence);
    // A range never takes an insertion-coded residue, as in Mol*'s own range schema.
    const chain = insertionCode === '' ? ranges.get(chainId) : undefined;
    if (singles.has(key) || (chain && inRanges(chain, sequenceId))) {
      residues.push({ chain_id: chainId, sequence_id: sequenceId, insertion_code: insertionCode });
    }
  });
  return { compact: compressResidues(residues), listed: items.length };
}


function selectCompactResidues(compact, path, allowEmpty = false) {
  clearCurrentSelection();
  const root = preview?.structure()?.data;
  if (!root) throw new Error('The loaded structure is unavailable in the preview.');
  const canonical = canonicalCompactSelection(compact, path);
  if (canonical.listed === 0) {
    if (allowEmpty) return false;
    throw new Error(`${path} is empty.`);
  }
  const loci = compactSelectionLoci(root, canonical.compact, path);
  if (!loci || StructureElement.Loci.isEmpty(loci)) {
    if (allowEmpty) return false;
    throw new Error(`${path} does not match the embedded structure.`);
  }
  preview.plugin.managers.structure.selection.fromLoci('set', loci, false);
  return true;
}


/*
  One layer's payload, as the request carries it.

  A protein layer resolves its picker plus its refining control into one id here, which is the same
  composition `selectedProteinRepresentation()` makes for the base -- so a layer and a base under
  the same settings name the same look. Every other component's picker already holds the resolved
  id, and there is no second spelling to map.
*/
function selectionLayerPayload(layer) {
  const name = layer.name.trim();
  if (!name) throw new Error('Every selection layer needs a name.');
  const componentOnly = layer.component_types.length === 1
    ? layer.component_types[0]
    : undefined;
  const representation = componentOnly === 'protein'
    ? resolvedRepresentationForControls(
      layer.representation,
      layer.cartoon_type,
      layer.ribbon_type,
      layer.surface_detail,
      layer.stick_scope,
    )
    : layer.representation;
  const payload = {
    name,
    component_type: componentOnly,
    representation,
    material: layer.material,
    color_mode: layer.color_mode,
    color: layer.color,
    color_overrides: colorOverridesSnapshot(layer.color_overrides, layer.color_mode),
    gradient_start: layer.gradient_start,
    gradient_end: layer.gradient_end,
    ...(layer.gradient_midpoints.length > 0
      ? { gradient_midpoints: [...layer.gradient_midpoints] }
      : {}),
    opacity: opacityNumber(layer.opacity, 'Selection layer opacity'),
    emission_strength: Number(layer.emission_strength),
    residue_ranges: layer.residue_ranges,
    residues: layer.residues,
    // Sent only when set, so a request for a composition with nothing hidden is unchanged.
    ...(layer.hidden ? { hidden: true } : {}),
  };
  // The editor's own test for whether this look has settings at all. A hand-kept family list
  // instead would omit the sweep looks and drop every cartoon layer's geometry edit.
  if (representationSettingsContractEnabled
      && representationSettingControls(representation).length > 0
      && layer.representation_settings) {
    payload.representation_settings = validatedRepresentationSettings(
      representation,
      layer.representation_settings,
    );
  }
  return payload;
}


/*
  One saved layer, as the editor's own state. The request carries the picture and the editor state
  carries what the pickers were showing; where the two disagree the request wins, because it is what
  produced the render.
*/
function restoredLayerState(payload, editorLayer, index) {
  const path = `render_request.selection_layers[${index}]`;
  // The base cards' rule (`setColorPairValue()`): these reach a CSS gradient string on the layer
  // card, so a string that is not a colour is refused. Absent is a document saying nothing, and
  // `captureSelectionLayer()` fills the component's default.
  const savedColor = (value, field) => {
    if (value === undefined) return undefined;
    const normalized = normalizeColor(value);
    if (!normalized) throw new Error(`${path}.${field} must be a six-digit colour.`);
    return normalized;
  };
  const midpoints = payload.gradient_midpoints ?? [];
  if (!Array.isArray(midpoints) || midpoints.length > MAX_GRADIENT_COLORS - 2) {
    throw new Error(
      `${path}.gradient_midpoints must contain at most ${MAX_GRADIENT_COLORS - 2} colours.`,
    );
  }
  /*
    Held to what the base cards hold theirs to: the layer card prints these, the tracer reads them,
    and the layer saves them back. Absent is a document saying nothing, and the component's default
    fills it.
  */
  if (payload.material !== undefined && !MATERIAL_CATALOG.order.includes(payload.material)) {
    throw new Error(`Selection layer ${index + 1} uses a material this version does not have.`);
  }
  if (payload.color_mode !== undefined && !SESSION_COLOR_MODES.has(payload.color_mode)) {
    throw new Error(`Selection layer ${index + 1} uses a colour mode this version does not have.`);
  }
  if (payload.emission_strength !== undefined
      && !(Number.isFinite(payload.emission_strength) && payload.emission_strength >= 0)) {
    throw new Error(`Selection layer ${index + 1} emission strength must be a number of at least 0.`);
  }
  const opacity = payload.opacity === undefined
    ? undefined
    : opacityNumber(payload.opacity, `Selection layer ${index + 1} opacity`);
  const controls = baseRepresentationControls(payload.representation);
  const savedOverrides = editorLayer?.color_overrides;
  const colorOverrides = {};
  if (savedOverrides && typeof savedOverrides === 'object' && !Array.isArray(savedOverrides)) {
    Object.entries(savedOverrides).forEach(([mode, overrides]) => {
      if (!SESSION_COLOR_MODES.has(mode)) {
        throw new Error(`Selection layer ${index + 1} uses an unsupported saved colour mode.`);
      }
      colorOverrides[mode] = normalizedColorOverrides(
        overrides,
        `editor_state.selection_layers[${index}].color_overrides.${mode}`,
      );
    });
  }
  const layerOverrides = normalizedColorOverrides(
    payload.color_overrides,
    `render_request.selection_layers[${index}].color_overrides`,
  );
  // The request's table wins for its mode, and an empty one is deleted, as the base's is
  // (`restoreStyleColorOverrides()`).
  if (SESSION_COLOR_MODES.has(payload.color_mode)) {
    if (Object.keys(layerOverrides).length === 0) delete colorOverrides[payload.color_mode];
    else colorOverrides[payload.color_mode] = layerOverrides;
  }
  // What a picker held for a look the layer is not showing, kept only if the layer card offers it:
  // the layer saves it back, and a document is written by someone else.
  const offered = (options, value, fallback) => (
    options.some(([option]) => option === String(value)) ? value : fallback
  );
  return {
    name: displayText(payload.name, 80, `Layer ${index + 1}`),
    representation: controls.representation,
    cartoon_type: controls.representation === 'cartoon'
      ? controls.cartoon_type
      : offered(CARTOON_TYPE_OPTIONS, editorLayer?.cartoon_type, controls.cartoon_type),
    ribbon_type: controls.representation === 'ribbon'
      ? controls.ribbon_type
      : offered(RIBBON_TYPE_OPTIONS, editorLayer?.ribbon_type, controls.ribbon_type),
    surface_detail: controls.representation === 'surface'
      ? controls.surface_detail
      : offered(SURFACE_DETAIL_OPTIONS, editorLayer?.surface_detail, controls.surface_detail),
    stick_scope: atomScopeForRepresentation(controls.representation) !== undefined
      ? controls.stick_scope
      : offered(ATOM_SCOPE_OPTIONS, editorLayer?.stick_scope, controls.stick_scope),
    representation_settings: payload.representation_settings
      ?? editorLayer?.representation_settings
      ?? representationSettingsForRepresentation(payload.representation),
    material: payload.material,
    color_mode: payload.color_mode,
    color_overrides: colorOverrides,
    color: savedColor(payload.color, 'color'),
    gradient_start: savedColor(payload.gradient_start, 'gradient_start'),
    gradient_end: savedColor(payload.gradient_end, 'gradient_end'),
    gradient_midpoints: midpoints.map(
      (value, at) => savedColor(value ?? null, `gradient_midpoints[${at}]`),
    ),
    opacity,
    emission_strength: payload.emission_strength,
    hidden: payload.hidden === true,
    // Restored from editor state alone: an older session has none, and its layers are then the
    // user's own -- which is the safe reading, since the only thing the tag licenses is deletion.
    ...(editorLayer?.origin === 'style' ? { origin: 'style' } : {}),
  };
}


async function restoreSelectionState(request, editorState) {
  const layers = request.selection_layers ?? [];
  /*
    **A document with layers needs a preview to restore them into**, and that is a refusal rather
    than a silent drop: `selectCompactResidues()` writes a Mol* selection and `captureSelectionLayer()`
    reads a layer back out of it, which is the one route that builds a layer with no live gesture
    behind it. With no plugin there is nowhere for either to happen, and opening the picture with its
    layers missing would open a saved picture as a different picture: **refuse rather than
    substitute**.
  */
  if (layers.length > 0 && !preview) {
    throw new Error(
      `This session carries ${layers.length} selection layer(s) and the preview canvas is`
      + ' unavailable, so there is nowhere to restore them. The composition is otherwise intact.',
    );
  }
  // Built aside and swapped once, as `applyStyleOverlays()` does: a throw part way through would
  // leave layers the trace draws with no card and no overpaint.
  const previous = selectionLayers;
  const next = [];
  try {
    layers.forEach((payload, index) => {
      selectCompactResidues(payload, `Selection layer ${index + 1}`);
      const restored = restoredLayerState(payload, editorState.selection_layers?.[index], index);
      const residues = currentSelectionResidues();
      const componentTypes = componentTypesForResidues(residues);
      componentTypes.forEach((componentType) => {
        if (next.length >= MAX_SELECTION_LAYERS) {
          throw new Error(
            `Splitting legacy mixed selection layers would exceed ${MAX_SELECTION_LAYERS} layers.`,
          );
        }
        const componentTypeResidues = residues.filter(
          (residue) => residueComponentTypes.get(residueKey(residue)) === componentType,
        );
        const compact = compressResidues(componentTypeResidues);
        selectCompactResidues(
          compact,
          `Selection layer ${index + 1} ${componentType} section`,
        );
        const suffix = componentTypes.length > 1
          ? ` — ${componentTypeSummary([componentType])}`
          : '';
        next.push(captureSelectionLayer({
          ...restored,
          name: `${restored.name.slice(0, 80 - suffix.length)}${suffix}`,
        }));
      });
    });
    selectionLayers = next;
    const currentSelection = editorState.current_selection;
    if (!preview) {
      // Nothing to select into, and nothing was restored above either: leave the list empty rather
      // than reaching for a plugin that is not there.
    } else if (!currentSelection
        || !selectCompactResidues(currentSelection, 'Current selection', true)) {
      clearCurrentSelection();
    }
  } catch (error) {
    selectionLayers = previous;
    clearCurrentSelection();
    renderSelectionLayers();
    await refreshSelectionPreview().catch(() => undefined);
    throw error;
  }
  renderSelectionLayers();
  await refreshSelectionPreview();
}



/*
  ------------------------------------------------------------------------------------------------
  The camera, which is the view.
  ------------------------------------------------------------------------------------------------
*/

function numbersMatch(left, right) {
  return Math.abs(left - right) <= 1e-12 * Math.max(1, Math.abs(left), Math.abs(right));
}


function cameraMatchesJson(snapshot, camera) {
  const vectorMatches = (actual, expected) => expected.every(
    (value, index) => numbersMatch(actual[index], value),
  );
  return snapshot.mode === 'perspective'
    && vectorMatches(snapshot.position, camera.position)
    && vectorMatches(snapshot.target, camera.target)
    && vectorMatches(snapshot.up, camera.up)
    && numbersMatch(snapshot.fov, (camera.vertical_fov_degrees * Math.PI) / 180)
    && numbersMatch(Math.max(snapshot.radius, 0.01), camera.scene_radius);
}


// The fields `cameraJson()` writes and no others: a document's extra keys would ride along into
// every save and link made from it.
function cloneCameraJson(camera) {
  return {
    schema_version: camera.schema_version,
    coordinate_system: camera.coordinate_system,
    mode: camera.mode,
    position: [...camera.position],
    target: [...camera.target],
    up: [...camera.up],
    vertical_fov_degrees: camera.vertical_fov_degrees,
    scene_radius: camera.scene_radius,
  };
}


function previewCamera() {
  return preview?.plugin.canvas3d?.camera;
}


// `radiusMax` travels with `radius`, or Mol* clamps the restored radius to the 0 an uncommitted
// scene carries and `shouldResetCamera()` asks for a re-frame. Floored at what is being restored:
// `Fit visible structure` sets a padded radius larger than the scene's own.
function restoreCamera(camera) {
  const molstarCamera = previewCamera();
  if (!molstarCamera) throw new Error('The preview camera is unavailable.');
  const radiusMax = Math.max(
    camera.scene_radius,
    preview?.plugin.canvas3d?.boundingSphere?.radius ?? 0,
    molstarCamera.state.radiusMax ?? 0,
  );
  const snapshot = {
    mode: 'perspective',
    position: camera.position,
    target: camera.target,
    up: camera.up,
    fov: (camera.vertical_fov_degrees * Math.PI) / 180,
    radius: camera.scene_radius,
    radiusMax,
  };
  molstarCamera.setState(snapshot, 0);
  // Setting the camera does not cancel a re-frame the layer repaint has already queued, and that
  // one lands an animation frame later. `requestCameraReset({ snapshot })` makes it land here.
  preview.plugin.canvas3d.requestCameraReset({ durationMs: 0, snapshot });
  preview.plugin.canvas3d.requestDraw();
  restoredCameraBaseline = cloneCameraJson(camera);
  // Its own draw is not a move: undo, redo and a restore are not new steps and not new edits.
  lastObservedCamera = cloneCameraJson(camera);
  // The lens is part of the camera, so every path that restores one -- undo, redo, a loaded
  // session, the saved-view bookmark -- moves #focal-length with it. Reading it back off the camera
  // here is what keeps the control honest without adding a field to any snapshot.
  syncFocalLengthFromCamera();
}


/*
  Changing the lens keeps the subject the size it already was: the eye dollies along the view axis
  by `focalLengthDollyScale()`, so what changes on screen is the perspective and not the framing.
  `src/camera-framing.js` says why, and against which sensor. The target, the up vector and Mol*'s
  scene radius are left alone; only the eye moves.
*/
function setFocalLength(millimetres) {
  const camera = previewCamera();
  if (!camera) return;
  const snapshot = camera.getSnapshot();
  if (snapshot.mode !== 'perspective') return;
  const fov = fovRadiansForFocalLength(millimetres);
  const scale = focalLengthDollyScale(snapshot.fov, fov);
  const position = [0, 1, 2].map(
    (axis) => snapshot.target[axis] + (snapshot.position[axis] - snapshot.target[axis]) * scale,
  );
  camera.setState({ fov, position }, 0);
  preview.plugin.canvas3d.requestDraw();
}


/*
  The slider is derived from the live camera, never the other way round, so undo, redo, a restored
  session and Mol*'s own reset all move it without knowing it exists.

  The readout is the truth and the slider position is a rounding of it: the camera can sit between
  two whole-millimetre stops -- Mol*'s untouched 45-degree default is 28.9706 mm -- and snapping the
  *camera* to the nearest stop to make the control tidy would move a composition nobody asked to
  move. With no camera yet it falls through to this tree's own readout, which reads the slider.
*/
function syncFocalLengthFromCamera() {
  const camera = previewCamera();
  if (!camera) {
    syncFocalLengthReadout();
    return;
  }
  const snapshot = camera.getSnapshot();
  if (snapshot.mode !== 'perspective') return;
  const millimetres = focalLengthForFovRadians(snapshot.fov);
  // Skipped while the slider has focus: this runs on every draw that moved the camera, and
  // rewriting the value under a drag or an arrow key would fight the gesture that caused it.
  if (document.activeElement !== focalLength) {
    focalLength.value = focalLengthSliderPosition(millimetres);
  }
  focalLengthValue.value = `${Math.round(millimetres)} mm · ${
    Math.round((snapshot.fov * 180) / Math.PI)}°`;
}


function observeCameraMovement() {
  const molstarCamera = previewCamera();
  if (!molstarCamera) return;
  const snapshot = molstarCamera.getSnapshot();
  if (snapshot.mode !== 'perspective') return;
  if (lastObservedCamera && cameraMatchesJson(snapshot, lastObservedCamera)) return;
  // Unset only by a load: the first draw after one is the camera the structure arrived at. An empty
  // scene has not arrived anywhere: it draws at Mol*'s default, before the framing.
  const arrived = !lastObservedCamera;
  if (arrived && !(preview?.plugin.canvas3d?.boundingSphere?.radius > 0)) return;
  lastObservedCamera = cameraJson();
  /*
    Guarded on `structureFile` for the same reason `recordHistory()` is: this subscription is live
    from the moment the plugin mounts, and an empty scene draws at Mol*'s 45-degree default. Without
    the guard the resting app would report a ~29 mm lens for a camera with nothing in front of it.
  */
  if (!structureFile) return;
  syncFocalLengthFromCamera();
  // The trace follows the view. That is the whole of Live as far as the camera is concerned, and
  // it is one line because the coalescer is already written.
  scheduleTraceUpdate();
  /*
    Mol* frames the structure a frame after the load has committed its history, so the framing is
    the baseline rather than a step: undoing it would show the unframed default camera. A restore
    commits its own baseline.
  */
  if (arrived) {
    if (!sessionRestoring) history.rebaseline();
    return;
  }
  // The camera is in the saved document; an orbit, a fit or a chip zoom reaches no control.
  markSessionDirty();
  recordHistory('camera');
}


function frameSphere(sphere, label) {
  if (!preview?.plugin.canvas3d || !sphere || !Number.isFinite(sphere.radius)) {
    setLoadStatus(`Could not frame ${label.toLowerCase()}.`, true);
    return;
  }
  const radius = paddedCameraFrameRadius(sphere.radius);
  preview.plugin.managers.camera.focusSphere(sphere, {
    extraRadius: radius - sphere.radius,
    minRadius: radius,
    durationMs: 250,
  });
  setLoadStatus(
    `${label} framed with ${Math.round(CAMERA_FRAME_PADDING_FRACTION * 100)}% padding.`,
  );
}


function fitVisibleStructure() {
  frameSphere(preview?.plugin.canvas3d?.boundingSphereVisible, 'Visible structure');
}


function updateSavedCameraViewControls(forceDisabled = false) {
  const locked = forceDisabled || renderInFlight || stylesActionsBusy || cameraViewMoving;
  const usable = Boolean(structureFile && preview);
  saveCameraViewButton.disabled = !usable || locked;
  goToSavedCameraViewButton.disabled = !usable || !savedCameraView || locked;
  goToSavedCameraViewButton.title = savedCameraView
    ? 'Return to the camera position saved for this structure'
    : 'Save a camera view first';
}


function clearSavedCameraViewConfirmation() {
  window.clearTimeout(cameraViewConfirmationTimer);
  cameraViewConfirmationTimer = undefined;
  saveCameraViewButton.textContent = 'Save camera view';
  delete saveCameraViewButton.dataset.confirmed;
}


function confirmSavedCameraView() {
  clearSavedCameraViewConfirmation();
  saveCameraViewButton.textContent = 'Saved ✓';
  saveCameraViewButton.dataset.confirmed = 'true';
  cameraViewConfirmationTimer = window.setTimeout(
    clearSavedCameraViewConfirmation,
    CAMERA_VIEW_CONFIRMATION_MS,
  );
}


function saveCurrentCameraView() {
  if (!structureFile || renderInFlight || cameraViewMoving) return;
  try {
    savedCameraView = cloneCameraJson(cameraJson());
    updateSavedCameraViewControls();
    confirmSavedCameraView();
    // The bookmark is in the saved document, so making one is unsaved work.
    markSessionDirty();
    // And in every history entry, or an unrecorded save is cleared by the next undo or redo.
    recordHistory('saved-camera-view');
    setLoadStatus('Camera view saved for this structure.');
  } catch (error) {
    setLoadStatus(`Could not save the camera view: ${error.message || error}`, true);
  }
}


async function goToSavedCameraView() {
  if (!structureFile || !savedCameraView || renderInFlight || cameraViewMoving) return;
  if (interactionMode === 'focus') finishFocusPicking('inspect');
  cameraViewMoving = true;
  updateSavedCameraViewControls();
  try {
    // Close a just-finished trackball gesture first, so Undo returns to the view this click
    // replaced instead of coalescing the drag and the explicit return into one history entry.
    await history.commit();
    restoreCamera(savedCameraView);
    markSessionDirty();
    await history.commit();
    scheduleTraceUpdate();
    setLoadStatus('Returned to the saved camera view.');
  } catch (error) {
    setLoadStatus(`Could not restore the saved camera view: ${error.message || error}`, true);
  } finally {
    cameraViewMoving = false;
    updateSavedCameraViewControls();
  }
}


/*
  ------------------------------------------------------------------------------------------------
  The request the studio renders.
  ------------------------------------------------------------------------------------------------
*/

function boundedRenderInteger(input, label, minimum, maximum) {
  const value = Number(input.value);
  const tooSmall = !Number.isInteger(value) || value < minimum;
  const tooLarge = maximum !== undefined && value > maximum;
  if (tooSmall || tooLarge) {
    throw new Error(
      maximum === undefined
        ? `${label} must be a whole number of at least ${minimum}.`
        : `${label} must be a whole number between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}


function renderSettingsPayload(quality) {
  const fStopNumber = Number(fStop.value);
  if (!Number.isFinite(fStopNumber) || fStopNumber < 0.1 || fStopNumber > 16) {
    throw new Error('F-stop must be between 0.1 and 16.');
  }
  const depthOfField = { enabled: depthOfFieldEnabled.checked, f_stop: fStopNumber };
  if (focusTarget) {
    depthOfField.focus_target = {
      coordinate_system: 'molstar-model',
      position: focusTarget.position,
    };
  }
  /*
    An override replaces the three controls it covers and nothing else -- denoising, the view
    transform and depth of field still come from what the user set. The controls are not read at all
    in that case, deliberately: validating a field whose value the request will not carry would fail
    a sweep over a number it is not going to use.
  */
  const size = quality ?? {
    // The boxes' own `max`, which a restore holds a document to: a request past it saves a
    // session that will not open.
    width: boundedRenderInteger(renderWidth, 'Render width', 64, Number(renderWidth.max) || undefined),
    height: boundedRenderInteger(renderHeight, 'Render height', 64, Number(renderHeight.max) || undefined),
    samples: boundedRenderInteger(renderSamples, 'Samples', 1, Number(renderSamples.max) || undefined),
  };
  return {
    width: size.width,
    height: size.height,
    samples: size.samples,
    denoising: renderDenoising.checked,
    denoiser: 'current',
    view_transform: viewTransform.value,
    /*
      **The cap the live trace rests on.** It travels with the picture, so a saved session's target
      is the one its trace stops at. A bound in *samples* rather than in seconds is the whole point:
      it stops every device at the same picture, where a wall-clock backstop stops each one wherever
      its own clock had got to. `traceReadout()` is the other reader and shows it only while the
      trace is below it.
    */
    live_sample_target: liveSampleTargetValue,
    // 0 is the product's own value and a bit-exact no-op.
    seed: renderSeedValue,
    depth_of_field: depthOfField,
  };
}


/*
  The composition, as one document.

  **`secondary_structure` carries the method and never an answer** -- `src/request-scene.js`
  computes the assignment from the `Structure` in this process, and `session-format.js` *rejects* a
  document that carries per-residue answers, because a second answer to "which residues are
  helical" opens a saved picture as a different picture.

  `embedStructure: false` builds the same request with the one expensive field left out. Encoding
  the file is up to 64 MB (85 MB of base64) per call, which is fine once per render and impossible once per
  edit -- and the undo ring drops the bytes again immediately anyway.
*/
function buildRenderRequest(file = structureFile, quality, { embedStructure = true } = {}) {
  if (!file) throw new Error('Load a structure before saving or rendering.');
  const color = normalizeColor(colorHex.value);
  if (!color) {
    throw new Error(`Enter a six-digit colour such as ${COMPONENT_COLOR_DEFAULTS.protein.uniform}.`);
  }
  const nucleicColor = normalizeColor(nucleicColorHex.value);
  const ligandColor = normalizeColor(ligandColorHex.value);
  const ionColor = normalizeColor(ionColorHex.value);
  const waterColor = normalizeColor(waterColorHex.value);
  if (!nucleicColor || !ligandColor || !ionColor || !waterColor) {
    throw new Error('Every component colour must be a six-digit colour.');
  }
  const proteinGradientStart = normalizeColor(proteinGradientStartHex.value);
  const proteinGradientEnd = normalizeColor(proteinGradientEndHex.value);
  const nucleicGradientStart = normalizeColor(nucleicGradientStartHex.value);
  const nucleicGradientEnd = normalizeColor(nucleicGradientEndHex.value);
  const ligandGradientStart = normalizeColor(ligandGradientStartHex.value);
  const ligandGradientEnd = normalizeColor(ligandGradientEndHex.value);
  // No ion or water gradient endpoints: both cards offer element and uniform colour only.
  if (!proteinGradientStart || !proteinGradientEnd
    || !nucleicGradientStart || !nucleicGradientEnd
    || !ligandGradientStart || !ligandGradientEnd) {
    throw new Error(
      `Gradient endpoints must be six-digit colours such as ${COMPONENT_COLOR_DEFAULTS.protein.gradient[0]}.`,
    );
  }
  const proteinRepresentation = selectedProteinRepresentation();
  activeProteinRepresentationSettings = proteinRepresentationEditor.values();
  const nucleicRepresentationSettingsValue = nucleicRepresentationEditor.values();
  const ligandRepresentationSettingsValue = ligandRepresentationEditor.values();
  const ionRepresentationSettingsValue = ionRepresentationEditor.values();
  const waterRepresentationSettingsValue = waterRepresentationEditor.values();
  const request = {
    filename: file.name,
    ...(embedStructure ? { structure_base64: loadedStructureBase64 } : {}),
    camera: cameraJson(),
    representation: proteinRepresentation,
    material: materialInput.value,
    color_mode: proteinColorMode.value,
    color,
    color_overrides: colorOverridesSnapshot(styleColorOverrides.protein, proteinColorMode.value),
    color_schema_version: 1,
    gradient_start: proteinGradientStart,
    gradient_end: proteinGradientEnd,
    ...(proteinGradientEditor.values().length > 0
      ? { gradient_midpoints: proteinGradientEditor.values() }
      : {}),
    opacity: opacityNumber(proteinOpacity.value, 'Protein opacity'),
    emission_strength: Number(proteinEmissionStrength.value),
    // Which molecule, stated rather than assumed. `null` is the asymmetric unit and a string names
    // a biological assembly; the field is always written, so a saved picture never depends on what
    // this app version happens to default to (`src/structure.js`).
    assembly: assemblyChoice(),
    // Pinned, not defaulted. Passing the method is what stops a Mol*
    // upgrade from moving every cartoon in the app with nothing failing.
    secondary_structure: { method: secondaryStructureMethodInput.value },
    ...(representationSettingsContractEnabled ? { representation_style_schema_version: 1 } : {}),
    ...(representationSettingsContractEnabled && activeProteinRepresentationSettings
      ? { representation_settings: activeProteinRepresentationSettings }
      : {}),
    lighting: LIGHTING_PRESET,
    look: lightingSource.value,
    lighting_setup_schema_version: 2,
    lighting_setup: {
      source: lightingSource.value,
      anchor: lightingAnchor.value,
      elevation: Number(hdriElevation.value),
      azimuth: Number(hdriAzimuth.value),
      strength: Number(lightingStrength.value),
      reflection_environment: reflectionEnvironment.value,
      reflection_color: normalizeColor(reflectionColorHex.value),
    },
    // 3 is the version carrying `water_style`. A document written at 2 has no water block and
    // `session-format.js` fills the disabled default into it, which is the picture it was saved as.
    component_style_schema_version: 3,
    nucleic_style: {
      enabled: nucleicEnabled.checked,
      representation: nucleicRepresentation.value,
      material: nucleicMaterial.value,
      color_mode: nucleicColorMode.value,
      color: nucleicColor,
      color_overrides: colorOverridesSnapshot(styleColorOverrides.nucleic, nucleicColorMode.value),
      gradient_start: nucleicGradientStart,
      gradient_end: nucleicGradientEnd,
      ...(nucleicGradientEditor.values().length > 0
        ? { gradient_midpoints: nucleicGradientEditor.values() }
        : {}),
      opacity: opacityNumber(nucleicOpacity.value, 'Nucleic-acid opacity'),
      emission_strength: Number(nucleicEmissionStrength.value),
      ...(representationSettingsContractEnabled && nucleicRepresentationSettingsValue
        ? { representation_settings: nucleicRepresentationSettingsValue }
        : {}),
    },
    ligand_style: {
      enabled: ligandEnabled.checked,
      // Always written, never conditional: a saved picture must not depend on what a version
      // happens to default to.
      hide_polyatomic_ions: ligandHidePolyatomicIons.checked,
      representation: ligandRepresentation.value,
      material: ligandMaterial.value,
      color_mode: ligandColorMode.value,
      color: ligandColor,
      color_overrides: colorOverridesSnapshot(styleColorOverrides.ligand, ligandColorMode.value),
      gradient_start: ligandGradientStart,
      gradient_end: ligandGradientEnd,
      ...(ligandGradientEditor.values().length > 0
        ? { gradient_midpoints: ligandGradientEditor.values() }
        : {}),
      opacity: opacityNumber(ligandOpacity.value, 'Ligand opacity'),
      emission_strength: Number(ligandEmissionStrength.value),
      ...(representationSettingsContractEnabled && ligandRepresentationSettingsValue
        ? { representation_settings: ligandRepresentationSettingsValue }
        : {}),
    },
    ion_style: {
      enabled: ionEnabled.checked,
      representation: ionRepresentation.value,
      material: ionMaterial.value,
      color_mode: ionColorMode.value,
      color: ionColor,
      color_overrides: colorOverridesSnapshot(styleColorOverrides.ion, ionColorMode.value),
      opacity: opacityNumber(ionOpacity.value, 'Ion opacity'),
      fluorescence_strength: Number(ionFluorescence.value),
      emission_strength: Number(ionFluorescence.value),
      ...(representationSettingsContractEnabled && ionRepresentationSettingsValue
        ? { representation_settings: ionRepresentationSettingsValue }
        : {}),
    },
    /*
      Always written like every other component block, so a saved picture never depends on what a
      version happens to default to. `enabled` is the "hide all water" switch and it ships false.
    */
    water_style: {
      enabled: waterEnabled.checked,
      representation: WATER_REPRESENTATION,
      material: waterMaterial.value,
      color_mode: waterColorMode.value,
      color: waterColor,
      color_overrides: colorOverridesSnapshot(styleColorOverrides.water, waterColorMode.value),
      opacity: opacityNumber(waterOpacity.value, 'Water opacity'),
      emission_strength: Number(waterEmissionStrength.value),
      ...(representationSettingsContractEnabled && waterRepresentationSettingsValue
        ? { representation_settings: waterRepresentationSettingsValue }
        : {}),
    },
    selection_schema_version: 1,
    selection_layers: selectionLayers.map(selectionLayerPayload),
    render_settings_schema_version: 2,
    render_settings: renderSettingsPayload(quality),
  };
  if (!request.lighting_setup.reflection_color) {
    throw new Error('Reflection colour must be a six-digit colour such as #182533.');
  }
  const { elevation, azimuth, strength } = request.lighting_setup;
  if (!Number.isFinite(elevation) || elevation < -180 || elevation > 180) {
    throw new Error('Lighting elevation must be between −180 and 180 degrees.');
  }
  if (!Number.isFinite(azimuth) || azimuth < -360 || azimuth > 360) {
    throw new Error('Lighting azimuth must be between −360 and 360 degrees.');
  }
  if (!Number.isFinite(strength) || strength < 0 || strength > 4) {
    throw new Error('Lighting strength must be between 0 and 4.');
  }
  return request;
}


function editorStyleColorOverrides() {
  return Object.fromEntries(
    Object.entries(styleColorOverrides).map(([component, tables]) => [
      component,
      nonEmptyColorTables(tables),
    ]),
  );
}


function editorLayerState(layer) {
  return {
    representation: layer.representation,
    cartoon_type: layer.cartoon_type,
    ribbon_type: layer.ribbon_type,
    surface_detail: Number(layer.surface_detail),
    stick_scope: layer.stick_scope,
    representation_settings: layer.representation_settings
      ? { ...layer.representation_settings }
      : undefined,
    color_overrides: nonEmptyColorTables(layer.color_overrides),
    ...(layer.origin === 'style' ? { origin: 'style' } : {}),
  };
}


function editorStatePayload(quality) {
  const selection = preview ? compressResidues(currentSelectionResidues()) : undefined;
  return {
    interaction_mode: interactionMode === 'select' ? 'select' : 'inspect',
    // Beside the mode because it is the same kind of fact and is read back the same way: what the
    // pointer was doing when this was saved. Optional and additive, so the schema does not move.
    picking_level: pickingLevel,
    /*
      What is selected, as the document's own compact form. It is *state a session restores*, not a
      layer: a layer is a styled region, while this is where the user's cursor was when they saved.
      `undefined` before the preview exists is written as the empty pair.
    */
    current_selection: selection ?? { residue_ranges: [], residues: [] },
    /*
      Optional and additive, so no schema bump: a reader tolerates a field it does not know, while a
      *bumped* version is refused outright. Undefined when no Style is active, and `JSON.stringify`
      drops it.
    */
    style_id: styles?.activeStyleId(),
    /*
      The `Save camera view` bookmark. Optional and additive on the same terms as `style_id`, and
      restored through `validateCamera()`.
    */
    saved_camera_view: savedCameraView ? cloneCameraJson(savedCameraView) : undefined,
    style_color_overrides: editorStyleColorOverrides(),
    protein_controls: {
      representation: representationInput.value,
      cartoon_type: cartoonTypeInput.value,
      ribbon_type: ribbonTypeInput.value,
      surface_detail: Number(surfaceDetailInput.value),
      stick_scope: atomScopeInput.value,
      representation_settings: activeProteinRepresentationSettings
        ? { ...activeProteinRepresentationSettings }
        : undefined,
    },
    /*
      What the *pickers* were showing for each layer, beside the resolved id the request carries.

      A layer's `representation` here is the un-resolved picker value (`cartoon`, not
      `cartoon_railed`), and `cartoon_type`/`ribbon_type`/`surface_detail`/`stick_scope` are the
      refining controls beside it -- so re-opening a session restores the two selects the user was
      looking at rather than only the id they composed. `origin` is written only when true, so a
      session with no Style-applied layers is byte-identical to one without the field, and
      it lives in free-form editor state rather than in the request.
    */
    selection_layers: selectionLayers.map(editorLayerState),
    /*
      The profile that names the dimensions this snapshot actually carries. A quality override
      changes those dimensions without touching #render-quality-profile, so reading the control here
      would archive a snapshot whose own settings contradict its label.
    */
    render_quality_profile: quality?.profile ?? renderQualityProfile.value,
    focus_target: focusTarget ? jsonClone(focusTarget) : null,
  };
}


/*
  ------------------------------------------------------------------------------------------------
  The live trace: the Live panel, on the canvas the panel already has.
  ------------------------------------------------------------------------------------------------

  **One canvas carries the trace.** `#trace-canvas` carries it in every mode, `#stage` is the layer
  it fills, and `stage-modes.js` shows that layer in Result and hides it in Preview and Compare.
  `#stage-render-image` is an `<img>` and shows a *finished* picture from the tray, because a WebGPU
  context belongs to one canvas for the life of the page.

  `render-backend.js`'s `createLiveTrace()` is the whole of the accumulator, the interactive
  resolution ladder and the settle timer; nothing of that is re-implemented here. What this owns is
  *when* to hand it a new request -- which is every time a control changes, coalesced to one frame
  so a drag does not rebuild the scene per pointer event.
*/
let loadedStructureBase64;
let liveTrace;
let liveTraceUpdatePending = false;
let liveTraceObserver;
/*
  Whether a traced frame has ever landed on the canvas. The stage indicator below is about the
  *blank* stage and nothing else, and this is the one bit that says the stage is still blank -- set
  once, in `traceReadout()`, so neither it nor the indicator is written per frame.
*/
let liveFrameSeen = false;

/*
  The readout, and it is **one short line**: the sample count, the traced size, and whether the
  ladder is at interactive resolution.

  The count and the size are kept because the product promises the picture on screen is the picture
  you download, and a reader can only check that with the size in front of them. The atom, bond and
  residue counts, the secondary-structure method and the adapter string were shown here once and
  are dropped rather than moved: they are facts about the *structure*, not about this frame.

  `showNotes()` is the other half: a refusal lands on the stage, beside the picture it is about.
*/
function traceReadout({ samples, width, height, interacting, notes }) {
  showNotes(notes ?? []);
  // The first frame is what the indicator was waiting for, and it happens once: the flag is what
  // keeps this off the per-frame path.
  if (!liveFrameSeen) {
    liveFrameSeen = true;
    setStageBusy(false);
  }
  say(readoutLine({ samples, width, height, interacting }));
}


/*
  The pill's one line, in one place because two writers make it.

  The target is shown only while it is still ahead. Past it the second number has stopped being
  information -- the trace goes on accumulating either way -- so it goes, which is what keeps a
  one-line pill one line.
*/
function readoutLine({ samples, width, height, interacting = false }) {
  const target = liveSampleTargetValue;
  const marker = Number.isFinite(target) && samples < target ? ` / ${target}` : '';
  return `<strong>${samples}</strong>${marker} · ${width}x${height}${interacting ? ' · interactive' : ''}`;
}


/*
  The same line at zero, so the corner reads as a count from the first moment it is on screen rather
  than as a sentence a count later replaces.

  **The size is the one the trace is about to use**: Live traces the stage's box, never the Output
  card's (`liveView()`), and `#stage` is hidden with `visibility` rather than `display` in the other
  three modes, so `stageTraceSize()` answers in every one of them.
*/
function sayZeroSamples() {
  say(readoutLine({ samples: 0, ...stageTraceSize() }));
}


// The size Live traces, asked in one place: the readout quotes it before a frame exists and
// `startLiveTrace()`'s observer is what applies it.
function stageTraceSize() {
  const box = canvas.getBoundingClientRect();
  return { width: Math.max(16, Math.round(box.width)), height: Math.max(16, Math.round(box.height)) };
}


/*
  Something is happening, for the gap between entering Live and the first traced frame.

  **Set once on the way in and cleared once by whatever ends the wait** -- the first frame, a
  refusal, a lost device, or the stage leaving Live -- which is `setStageTracing()`'s shape, for the
  same reason: an indicator that outlives the thing it describes is worse than no indicator. Never
  touched per frame.
*/
function setStageBusy(busy) {
  if (stageBusy) stageBusy.hidden = !busy;
}


/*
  One rebuild per frame, however many controls moved.

  A colour wheel drag fires `input` continuously and each one is a legitimate reason to re-trace, so
  the coalescing is what keeps a drag from queueing a scene build per event. `createLiveTrace()`
  then drops to the interactive resolution for the duration by itself.
*/
function scheduleTraceUpdate() {
  if (!liveTrace || !structureFile || liveTraceUpdatePending) return;
  liveTraceUpdatePending = true;
  requestAnimationFrame(() => {
    liveTraceUpdatePending = false;
    if (!liveTrace || !structureFile) return;
    try {
      const request = withAutoFocus(buildRenderRequest());
      clearTraceRefusal();
      liveTrace.update(request);
    } catch (error) {
      // A half-typed hex value is not a failure of the tracer, and blanking the picture over one
      // would be worse than leaving the last good frame up. The control says so through
      // `aria-invalid`; this says so once, in the status line.
      setRenderStatus('Not traced', error.message || String(error), true);
    }
  });
}


// Once a request builds, and before it is handed over, so a refusal the loop reports for it stands.
// Not on a frame: after a refused build the last good request goes on sampling.
function clearTraceRefusal() {
  if (traceRefusalShown) setRenderStatus('Ready to render.');
}


/**
 * Start the live trace on the loaded structure, or retarget it if it is already running.
 *
 * The stage is responsive and the trace follows it: the picture on screen is the picture you
 * download, and a target sized once at startup keeps neither half.
 *
 * **One caller: the Live panel appearing on the stage.** Nothing else may start a trace -- not
 * loading a structure, not restoring a session, not applying a Style -- because "always
 * converging" is a promise about a panel the user has asked for rather than about the page being
 * open. Everything else calls `scheduleTraceUpdate()`, which retargets a running trace and starts
 * none.
 *
 * **And on the second visit there is a trace to un-pause, which is a different call from a
 * retarget.** Leaving Live pauses the loop; `update()` only queues a request and returns, because a
 * paused loop is not running to pick it up. Without the `resume()` below, going Live -> Result ->
 * Live puts the mode back, puts the right request in the queue, and samples nothing at all -- a
 * frozen picture that looks exactly like a converged one. Any check for this has to measure the
 * count *moving*, not the count being no lower than it was.
 */
async function startLiveTrace() {
  if (!liveTrace) {
    liveTrace = createLiveTrace({
      canvas,
      onFrame: traceReadout,
      onWarning: showBuildWarning,
      /*
        The other half of `scheduleTraceUpdate()`'s `try`. `update()` only queues the request, so a
        scene that will not build throws inside the loop rather than at the call -- and the one a
        user can actually reach is a secondary-structure method that answers for no residue, whose
        message ends by naming the method to choose instead. Without a channel here it would be said
        to an unawaited promise.
      */
      onError: (error) => {
        // A lost device is one of these, and there is no frame coming after it: the indicator goes
        // down with the announcement rather than spinning over a stage nothing will reach.
        setStageBusy(false);
        setRenderStatus('Not traced', error.message || String(error), true);
        // And on `#notes`, the page's only refusal channel, because this is a refusal about the
        // picture on the stage. A failure the trace does not come back from keeps it; a scene that
        // would not build keeps its last good frame, whose next `onFrame` clears it.
        showNotes([error.message || String(error)]);
      },
    });
    // Optional-chained because the failure path below clears the handle: a `ResizeObserver`
    // callback already queued when that happens would otherwise throw into nobody's catch.
    const follow = () => {
      const size = stageTraceSize();
      liveTrace?.resize(size.width, size.height);
    };
    if (typeof ResizeObserver === 'function') {
      liveTraceObserver = new ResizeObserver(follow);
      liveTraceObserver.observe(canvas);
    }
    follow();
    /*
      **A failed start must not leave a handle behind, or the trace is dead for the life of the
      page.**

      `createLiveTrace()` is assigned above and `buildRenderRequest()` is evaluated as the argument
      *below*, so anything the request builder refuses -- an empty Samples box (`Number('')` is 0
      and `boundedRenderInteger()` throws), a half-typed hex, an f-stop off its range, a width under
      64 -- throws before `start()` runs. `ready(canvas)` rejecting inside `start()` does the same.
      Either way `active` in `render-backend.js` stays null while `liveTrace` is non-null, and
      `liveTrace` is assigned in exactly one place: here. Every later entry into Live then takes the
      branch below, where `paused()` is true after the first exit, so it calls `resume()` -- which
      un-pauses and enters a loop whose first line is `if (... || !active) return`. Silently. The
      user fixes the Samples box, presses Live, and gets a black stage with nothing said, for ever.

      Clearing the handle is what makes the next press a *fresh* start: it rebuilds the trace and
      either works or reports the same refusal again, which is the honest outcome either way. The
      observer goes with it, because `follow()` closes over this variable and would throw on the
      next resize otherwise.
    */
    try {
      const request = withAutoFocus(buildRenderRequest());
      clearTraceRefusal();
      await liveTrace.start(request);
    } catch (error) {
      liveTraceObserver?.disconnect();
      liveTraceObserver = undefined;
      liveTrace = undefined;
      throw error;
    }
    return;
  }
  /*
    **A resume is not a retarget, and building a request here would throw the picture away.**

    `update()` re-prepares the scene, which resets the accumulator -- that is what it is for, and it
    is exactly wrong on the way back into a panel whose picture is still there. Everything that
    *should* reset the picture already queues its own request through `scheduleTraceUpdate()`, and
    it does so whether the trace is paused or running, so a pause holds every change made while the
    user was elsewhere. What is left for `resume()` to decide is the one thing only it can see:
    whether somebody else has claimed the renderer since, in which case it re-queues. Measured at
    286 samples kept across a trip to Preview and back, against 92 when this line built a request.
  */
  if (liveTrace.paused()) {
    liveTrace.resume();
    return;
  }
  const request = withAutoFocus(buildRenderRequest());
  clearTraceRefusal();
  liveTrace.update(request);
}


/*
  ------------------------------------------------------------------------------------------------
  Loading a structure.
  ------------------------------------------------------------------------------------------------
*/

/*
  Everything that can refuse a file, before anything is reset: a file that will not open leaves the
  previous structure, its renders, layers and history standing. Callers reset between this and
  `loadStructure()`.
*/
async function readStructure(file, { assembly } = {}) {
  file = await decompressStructure(file);
  const extension = file.name.toLowerCase().split('.').pop();
  if (!['cif', 'pdb'].includes(extension)) {
    throw new Error('Choose a local .cif or .pdb structure file.');
  }
  // `decompressStructure()` checks only a .gz; past this, Save session refuses the file later.
  if (file.size > MAX_STRUCTURE_BYTES) {
    throw new Error(`${file.name} is larger than the ${MAX_STRUCTURE_BYTES / (1024 * 1024)} MB structure limit.`);
  }
  setLoadStatus(`Loading structure: ${file.name}`);
  const text = await file.text();
  const structureBase64 = toBase64(new TextEncoder().encode(text));

  /*
    **One parse, and the studio and the trace share it.**

    `sceneInputsFromRequest()` memoises on the bytes, the filename and the assembly -- never the
    method, which would make a second `Structure` -- so the `Structure` this walk reads is the same
    object `createLiveTrace()` draws from: **one `Structure`, one answer**, as a property of the code
    rather than of a promise. The camera needs the atoms, so this happens before the request is
    complete; the probe request below carries only the three fields the parse reads.
  */
  const { sceneInputsFromRequest } = await ensureScenePipeline();
  const inputs = await sceneInputsFromRequest({
    filename: file.name,
    structure_base64: structureBase64,
    secondary_structure: { method: secondaryStructureMethodInput.value },
    // Absent for a file arriving fresh, which is what asks `structure.js` for the molecule the
    // file means; a session and the assembly control both name one, and a named one is built.
    ...(assembly !== undefined ? { assembly } : {}),
  }, { fresh: assembly === undefined });
  return { file, text, structureBase64, inputs };
}


/*
  Where a structure starts to be slow everywhere at once: 7CGO (336k atoms) takes ~5 s to parse and
  its cartoon ~6 s to build, near the tracer's primitive limit; 1AON (58k) is quick throughout.
*/
const LARGE_STRUCTURE_ATOMS = 200_000;

function largeStructureWarning(name, atoms) {
  if (!(atoms >= LARGE_STRUCTURE_ATOMS)) return undefined;
  return `${name} loaded: ${atoms.toLocaleString('en-US')} atoms, so building and tracing it may be slow.`;
}


async function loadStructure({ file, text, structureBase64, inputs }, { sameDocument = false } = {}) {
  // A new protein is a fresh build, so the indicator is owed again: the flag is per structure, not
  // per page, or only the first molecule of a session ever shows one.
  liveFrameSeen = false;
  restoredCameraBaseline = undefined;
  lastObservedCamera = undefined;
  clearSavedCameraViewConfirmation();
  savedCameraView = undefined;
  updateSavedCameraViewControls(true);
  // Nothing about the previous protein is a state this one can be stepped back to.
  history.reset();
  setStructureMetric(detectStructureMetric(text, file.name));
  loadedStructureBase64 = structureBase64;
  loadedInputs = inputs;
  structureFile = file;
  // Before anything reads the residues: the control has to say which molecule they came from, and
  // `buildRenderRequest()` reads it back out of the control on the very next edit.
  showAssemblyChoices();
  collectStructureResidues();
  /*
    The gallery learns what was loaded here rather than inside the walk, because this is the moment
    all of it is true at once -- a recommendation computed a line earlier would be about the previous
    protein. `setStructure()` first: it clears the previous structure's banked composition and its
    lead tile before `setRecommendations()` seeds the new one.
  */
  styles?.setStructure(file.name);
  publishStructureRecommendations();
  /*
    The preview adopts the `Structure` this walk just read, and it is **awaited** before the trace
    starts. Both halves matter: adopting is what makes the canvas and the tracer draw the same
    object, and awaiting is what stops the first frame being traced from `frameStructureCamera()`
    and then jumping when Mol* frames its own.
  */
  await showStructureInPreview(file);
  highlightedResidueKeys.clear();
  sequenceStrip?.setResidues(loadedInputs.residues);
  setInteractionMode('inspect');
  renderChainShortcuts();
  renderComponentShortcuts();
  updateCurrentSelectionStatus();
  // A session restore enables these itself, once its layers and camera are applied.
  if (!sessionRestoring) {
    setRenderActionsDisabled(false);
    setSessionSaveDisabled(false);
    newSessionButton.disabled = false;
  }
  sessionLifecycle.markLoaded(file.name, { sameDocument });
  setLoadStatus(largeStructureWarning(file.name, inputs.elementCount) ?? (preview
    ? `${file.name} loaded. Orbit it in Preview or in Live, which traces what you are looking at.`
    : `${file.name} loaded. Live traces what the controls say.`));
  setRenderStatus('Ready to render.');
  stopScaffoldingTrace();
  /*
    **Loading a structure starts no picture.** `await startLiveTrace()` here would begin an endless
    trace on a canvas the stage is not showing -- the studio opens on Preview, which is Mol\*. The
    trace belongs to the Live panel and starts when that panel is asked for, which is the
    `foldray:stage-mode` listener at the foot of this file and the only thing in the app that starts
    it or stops it.

    `scheduleTraceUpdate()` rather than nothing, because a trace already running from an earlier
    visit to Live is a trace of the *previous* structure: it retargets one that exists and starts
    none that does not, which is exactly the guard it already carries.
  */
  scheduleTraceUpdate();
  // The stage cannot know there is anything to trace until something says so, and this is the
  // seam's third event (`src/stage-modes.js`). It says a structure is loaded and Live can trace
  // it -- not that a trace is running, which it is not.
  document.dispatchEvent(new CustomEvent('foldray:live-trace-available'));
  // A no-op while the screen is closed; while it is open this is what closes it, onto the Mol*
  // preview holding the structure that just arrived.
  openingScreen?.onStructureLoaded();
  // Awaited so the ordering is not a matter of luck: restoreSession() resets the ring again once
  // it has finished writing the saved settings over the top of these defaults. A baseline rather
  // than a commit, because Mol*'s framing may already have landed one.
  await history.rebaseline();
}


/*
  The one control that changes the *answer* rather than the picture, and the walk that has to follow
  it.

  `loadedInputs` is what `readStructure()` parsed; `sceneInputsFromRequest()` recomputes on the same
  `Structure` (`src/request-scene.js`), so this is that recompute rather than a second answer to it.
  `updateSecondaryStructureAutoLabel()` is what then says which method `auto` took, and it is the
  one place on the page that answer is readable.

  **It reports its own failure rather than leaving it to the trace.** The trace runs only while the
  Live panel is on the stage, and `#secondary-structure-method` is in the composition rail, which is
  reachable from Preview -- where a structure lands. So the common case is choosing `dssp` on a file
  it can answer for nobody, in a mode where there is no trace to say so.
*/
/**
 * What this file offers, and which of it is on screen.
 *
 * The options are the file's own `pdbx_struct_assembly` rows plus the asymmetric unit, which is
 * always last and always offered: it is the one molecule every file has. A file that declares no
 * assembly gets the control disabled rather than hidden -- the question "which molecule is this"
 * has an answer for that file too, and a control that vanishes reads as a feature that broke.
 */
function showAssemblyChoices() {
  const offered = loadedInputs?.assemblies ?? [];
  const built = loadedInputs?.assembly ?? null;
  assemblyInput.replaceChildren(
    ...offered.map((one) => {
      const option = document.createElement('option');
      option.value = one.id;
      const detail = [one.details, one.oligomericCount ? `${one.oligomericCount} chains` : '']
        .filter(Boolean).join(' · ');
      option.textContent = `Biological assembly ${one.id}${detail ? ` — ${detail}` : ''}`;
      return option;
    }),
    (() => {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Asymmetric unit — everything the file deposits';
      return option;
    })(),
  );
  assemblyInput.value = built ?? '';
  updateStyleControls();
}


/** `null` is the asymmetric unit asked for, never an absent answer. See `src/structure.js`. */
function assemblyChoice() {
  return assemblyInput.value === '' ? null : assemblyInput.value;
}


/*
  A different assembly is a different molecule, so this is a load and not a refresh.

  `refreshSecondaryStructure()` below can be a recompute on the same `Structure` because a method
  changes the *answer* about residues that all still exist. An assembly changes which atoms there
  are -- 1AYM goes from one protomer to sixty of them -- so the residue map, the sequence strip, the
  chain shortcuts, the selection layers, the preview's adopted `Structure` and Mol\*'s framing all
  have to be rebuilt, which is exactly the list `loadStructure()` already owns. Reusing it is also
  what keeps `history.reset()` in one place: nothing about the previous protein is a state this one
  can be stepped back to, and that is as true of sixty copies of it as of a different file.
*/
async function reloadForAssembly() {
  // Disabled means a load is underway: nobody changed it, and a second read would race the first.
  if (!structureFile || renderInFlight || assemblyInput.disabled) return;
  const file = structureFile;
  const wanted = assemblyChoice();
  const previous = loadedInputs?.assembly ?? null;
  // The control names the built molecule until another is built: a retrace queued by this change
  // would otherwise parse `wanted` beside the read below, a second `Structure`.
  assemblyInput.value = previous ?? '';
  const status = loadStatusSnapshot();
  setSourceControlsDisabled(true);
  setRenderActionsDisabled(true);
  structureLoading = true;
  let replacing = false;
  try {
    const read = await readUnlessDeclined(
      'Build a different molecule?',
      () => readStructure(file, { assembly: wanted }),
      status,
    );
    if (!read) return;
    replacing = true;
    prepareForStructureLoad();
    await loadStructure(read, { sameDocument: true });
  } catch (error) {
    const reason = error.message || error;
    // Past the reset the old molecule is gone, so it is loaded again rather than only named:
    // otherwise nothing is loaded while the preview still draws it. Its layers and history are not
    // recovered, as on any load.
    if (replacing) {
      try {
        await loadStructure(await readStructure(file, { assembly: previous }), { sameDocument: true });
      } catch {
        // The refusal below is still the whole story.
      }
    }
    setLoadStatus(`Could not build that molecule: ${reason}`, true);
    setRenderStatus('Failed', 'The structure was not rebuilt.', true);
    assemblyInput.value = loadedInputs?.assembly ?? '';
  } finally {
    structureLoading = false;
    setSourceControlsDisabled(false);
    setRenderActionsDisabled(!structureFile);
    updateHistoryControls();
  }
}


/*
  The one door a headless driver has into the studio's *view*.

  Setting a camera or a focus point otherwise means restoring a whole session -- `restoreCamera()`
  is reached from a session restore, from undo and from the saved-view bookmark, and all three carry
  a composition with them -- while a focus point is otherwise only ever *picked* in the preview. A
  driver that wants a Style's composition at somebody else's view needs this and nothing wider.

  **It is a driver surface and it is named as one**, like `window.foldRay` -- which is the
  scaffolding page's, deliberately separate from the studio's path, and so cannot serve. Three
  properties keep it honest:

  * **It validates**, through the same `validateCamera()` a session goes through. A camera with a
    zero radius or a NaN fov renders a blank picture that looks exactly like a converged one.
  * **It moves the view and nothing else.** `restoreCamera()` already sets `restoredCameraBaseline`
    and syncs `#focal-length`, so the request built after it carries this camera and the lens
    readout agrees with it. The focus point goes through `renderSettingsPayload()`'s own field for
    the same reason.
  * **It reports back what it set**, so a caller can assert the camera took rather than assume it.

  It does not exist when nothing is loaded, and it never starts a trace: `scheduleTraceUpdate()`
  retargets one that is running and starts none that is not, which is the rule every other camera
  path in this file follows.
*/
window.foldRayView = {
  camera: (camera) => {
    if (!structureFile) throw new Error('No structure is loaded.');
    const checked = validateCamera(camera, 'camera');
    restoreCamera(checked);
    scheduleTraceUpdate();
    return cameraJson();
  },
  /*
    The point the picture is sharp at, which is a **second** thing a session decided and the camera
    does not carry.

    79 of the 90 Styles turn depth of field on, and with nothing picked the app focuses on whatever
    the camera happens to point at (`maybeShowStyleFocusPrompt()` says so in as many words). A
    composed view picks one -- an atom or a residue, up to 335 A from the camera target -- so a
    picture reproduced without it is the right shot with the wrong plane in focus, on most of the
    catalogue. It is set here rather than by picking in the preview because a pick needs a canvas
    hit test and a driver has a coordinate.

    Shaped like `restoreSessionSettings()`'s own reconstruction, and narrowed the same way: `kind`
    and `component_type` are taken from a fixed set rather than trusted, because everything else in
    the app treats them as one.
  */
  focus: (target) => {
    if (!structureFile) throw new Error('No structure is loaded.');
    if (target === null) {
      useAutoFocus();
      return null;
    }
    const position = target?.position;
    if (!Array.isArray(position) || position.length !== 3
      || !position.every((value) => Number.isFinite(value))) {
      throw new Error('A focus point needs three finite coordinates.');
    }
    focusTarget = {
      position: [...position],
      label: displayText(target.label, 80, 'Baked focus point'),
      kind: target.kind === 'atom' ? 'atom' : 'residue',
      component_type: ['protein', 'nucleic', 'ligand', 'ion', 'water'].includes(target.component_type)
        ? target.component_type
        : 'protein',
    };
    updateDepthOfFieldControls();
    scheduleTraceUpdate();
    return jsonClone(focusTarget);
  },
  /*
    A hidden selection layer from residue ranges, which is the third thing a session decided and
    the one a Style is forbidden to carry.

    **A Style may never name a chain, a residue, a range or an atom.** That fence is right and is
    not being moved -- it is about what a *Style* may say, and this is a driver speaking as a user
    would. Hiding a receptor's extracellular domain is the case it exists for: on 7LCK, with chain R
    28-128 drawn, no camera shows the agonist at all -- the best of 400 view directions exposes 8 of
    its 41 atoms -- so a picture of that pocket is a picture of nothing until the domain is hidden.

    It goes through the product's own two steps in the product's own order:
    `selectCompactResidues()` is what a restored session uses to turn `residue_ranges` into a Mol\*
    selection, and `addSelectionLayer({ hidden: true })` is what the Hide selection button does. So
    the layer is an ordinary hand-made one, and it survives a Style apply because it is *hidden*
    (`applyStyleOverlays()` keeps every hidden layer; `origin` plays no part), which is what lets a
    driver hide first and apply afterwards.
  */
  hide: (ranges) => {
    if (!structureFile) throw new Error('No structure is loaded.');
    if (!Array.isArray(ranges) || ranges.length === 0) {
      throw new Error('A hidden layer needs at least one residue range.');
    }
    const before = selectionLayers.length;
    selectCompactResidues({ residue_ranges: ranges, residues: [] }, 'baked hidden selection');
    addSelectionLayer({ hidden: true });
    if (selectionLayers.length !== before + 1) throw new Error('The hidden layer was not created.');
    return selectionLayers.length;
  },
  get: () => (structureFile
    ? {
      camera: cameraJson(),
      focus: focusTarget ? jsonClone(focusTarget) : null,
      layers: selectionLayers.map((layer) => ({ name: layer.name, hidden: Boolean(layer.hidden) })),
    }
    : undefined),
  // What Copy link would carry, without the clipboard, so a driver can open it in a fresh page.
  shareLink: async () => {
    if (!structureFile) throw new Error('No structure is loaded.');
    const document = createLinkDocument(await buildSessionDocument(), await loadedStructureDigest());
    return { document, fragment: await encodeShareFragment(document) };
  },
};


async function refreshSecondaryStructure() {
  if (!structureFile) return;
  try {
    const { sceneInputsFromRequest } = await ensureScenePipeline();
    const previousMethod = loadedInputs?.secondaryStructureMethod;
    loadedInputs = await sceneInputsFromRequest({
      filename: structureFile.name,
      structure_base64: loadedStructureBase64,
      secondary_structure: { method: secondaryStructureMethodInput.value },
    });
    // The recompute is on the adopted `Structure`, but Mol*'s cartoon only re-reads it in an update.
    if (loadedInputs.secondaryStructureMethod !== previousMethod) {
      await preview?.refreshRepresentations().catch((error) => setLoadStatus(
        `The preview could not redraw the new secondary structure: ${error.message || error}`,
        true,
      ));
    }
    // The `auto` label moves with the answer, or it goes on naming the branch the previous method
    // took while the trace draws this one's helices.
    updateSecondaryStructureAutoLabel();
  } catch (error) {
    /*
      The one failure a user can actually reach here is a method that answers for no residue, whose
      message ends by naming the method to choose instead -- which is advice nobody can take from a
      status line that was never written. `setLoadStatus` rather than `setRenderStatus`, because
      this is a fact about the *structure*'s assignment rather than about a picture, and because in
      Preview there is no picture for a render status to be about.
    */
    setLoadStatus(
      `The secondary-structure method could not be changed: ${error.message || error}`,
      true,
    );
  }
}


function setSourceControlsDisabled(disabled) {
  fileInput.disabled = disabled;
  fileBrowseButton.disabled = disabled;
  pdbIdInput.disabled = disabled;
  pdbLoadButton.disabled = disabled;
  alphafoldIdInput.disabled = disabled;
  alphafoldLoadButton.disabled = disabled;
  sessionFileInput.disabled = disabled;
  loadSessionButton.disabled = disabled;
  assemblyInput.disabled = disabled || !structureFile
    || (loadedInputs?.assemblies?.length ?? 0) === 0;
}


function setRenderActionsDisabled(disabled) {
  renderButton.disabled = disabled;
}


function setRenderControlsDisabled(disabled) {
  setSourceControlsDisabled(disabled);
  setSessionSaveDisabled(disabled || !structureFile);
  // The history arrows and #new-session sit in the top bar, outside the three containers the bulk
  // disable below scopes to, so they only lock if they are named here.
  newSessionButton.disabled = disabled || !structureFile;
  historyUndoButton.disabled = true;
  historyRedoButton.disabled = true;
  historySettingsUndoButton.disabled = true;
  historySettingsRedoButton.disabled = true;
  styleFocusPrompt.querySelectorAll('button, input').forEach((control) => {
    control.disabled = disabled;
  });
  styleControls.querySelectorAll('button, input, select').forEach((control) => {
    control.disabled = disabled;
  });
  selectionPanel.querySelectorAll('button, input, select').forEach((control) => {
    control.disabled = disabled;
  });
  cameraRenderSettings.querySelectorAll('button, input, select').forEach((control) => {
    control.disabled = disabled;
  });
  if (!disabled) {
    updateStyleControls();
    updateDepthOfFieldControls();
    updateHistoryControls();
  }
  // Bulk enabling cannot know that the first/last ordering arrows have a boundary of their own.
  // Reapply those states here, and make the drag handles inert for the whole render lock.
  updateSelectionLayerOrderControls(disabled);
  updateSelectionLayerEditControls(disabled);
  // Re-asserted last in both directions: the bulk pass above reaches every control in the three
  // containers, and the selection panel's own state is a function of more than `disabled` -- there
  // has to be a preview to select in and a selection that fits in a layer.
  updateSelectionPanelState();
}


function prepareForStructureLoad() {
  setSourceControlsDisabled(true);
  newSessionButton.disabled = true;
  structureFile = undefined;
  downloadedStructureName = undefined;
  updateSecondaryStructureAutoLabel();
  restoredCameraBaseline = undefined;
  if (interactionMode === 'focus') finishFocusPicking('inspect');
  /*
    A layer names residues of the file that is open and a focus point is a position in its
    coordinate frame, so nothing about either survives a new one. **`focusTarget` has to be cleared
    here**: `finishFocusPicking()` ends the *mode* and leaves the point standing, so the previous
    protein's focus would reach `render_settings.depth_of_field.focus_target` on the next one and
    put the plane somewhere nobody had clicked.
  */
  resetSelectionLayers();
  focusTarget = undefined;
  updateFocusSelectionStatus();
  highlightedResidueKeys.clear();
  sequenceStrip?.clear();
  history.reset();
  setSessionSaveDisabled(true);
  setRenderActionsDisabled(true);
  setRenderProgress(undefined);
  // A new structure invalidates every render in the strip, so the stage returns to Preview.
  document.dispatchEvent(new CustomEvent('foldray:structure-loading'));
}


/*
  ------------------------------------------------------------------------------------------------
  One render, to a sample target.
  ------------------------------------------------------------------------------------------------

  The live trace is endless and this is the finite one: `render-backend.js`'s `render()` takes a
  turn on the shared renderer through `src/render-lock.js` while the live trace parks. What comes
  back is **bytes**, and no object URL is made for them here -- `imageUrlFrom()` is the single place
  one is created and the stage that displays the picture is what will call it. Announced on
  `foldray:render-complete`, so what happens next is a listener rather than a call.
*/
async function renderStructure(quality) {
  if (!structureFile || renderInFlight) return;
  const file = structureFile;
  renderInFlight = true;
  setRenderActionsDisabled(true);
  setRenderControlsDisabled(true);
  setRenderProgress(undefined);
  cancelButton.disabled = false;
  try {
    const request = buildRenderRequest(file, quality);
    /*
      Captured at submit time rather than when the picture lands, and the reason survives the
      transport: the controls stay live while the trace runs, so reading them on completion could
      record settings that did not produce the picture.
    */
    const settings = tabSnapshot(request, editorStatePayload(quality));
    const result = await render(withAutoFocus(request), {
      onStage: (stage, message) => setRenderStatus(stage, message),
      onWarning: showBuildWarning,
      onProgress: (progress) => setRenderProgress(progress),
    });
    if (!result.cancelled) {
      document.dispatchEvent(new CustomEvent('foldray:render-complete', {
        detail: {
          blob: result.blob,
          settings: { ...settings, samples: result.samples },
          meta: { adapter: result.adapter, samples: result.samples },
        },
      }));
    }
  } catch (error) {
    setRenderStatus('Failed', error.message || String(error), true);
  } finally {
    renderInFlight = false;
    cancelButton.disabled = true;
    setRenderControlsDisabled(false);
    setRenderActionsDisabled(!structureFile);
  }
}


function cancelRender() {
  if (!renderInFlight) return;
  cancelButton.disabled = true;
  setRenderStatus('Cancelling', 'Stopping the trace.');
  cancelTrace();
}


/*
  ------------------------------------------------------------------------------------------------
  The session document, and the bounded composition history that shares its shape.
  ------------------------------------------------------------------------------------------------
*/

const fileSystemAccess = supportsFileSystemAccess();

// What Save session as… writes, and what a share link carries less the structure.
const buildSessionDocument = async () => createSessionDocument(
  buildRenderRequest(),
  editorStatePayload(),
  new Date().toISOString(),
  /*
    Improve image's recipe, which is the one piece of *view* state a session carries. Its range
    inputs live outside `.app-shell` and it finishes an already-rendered PNG rather than describing
    the trace, so it is not in the render request -- and leaving it out of here is a session saved
    with a finished picture that opens with the finishing thrown away.
  */
  stage?.sessionPostProcessing(),
);

const sessionLifecycle = createSessionLifecycle({
  supported: fileSystemAccess,
  suggestName: () => sessionFilename(structureFile?.name),
  buildDocument: buildSessionDocument,
  pickSaveFile: (suggestedName) => window.showSaveFilePicker({
    suggestedName,
    startIn: 'downloads',
    types: [{
      description: 'FoldRay session',
      accept: { 'application/json': [SESSION_FILE_EXTENSION] },
    }],
  }),
  writeHandle: async (handle, text) => {
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
  },
  download: (text, filename) => triggerDownload(
    new Blob([text], { type: 'application/json' }),
    filename,
  ),
  onChange: (snapshot) => renderSessionState(snapshot),
});


function renderSessionState({ name, label, status }) {
  sessionNameLabel.textContent = name;
  sessionStateLabel.textContent = label;
  sessionStateLabel.classList.toggle('is-error', status === 'error');
  sessionStateLabel.classList.toggle('is-dirty', status === 'dirty');
}


/*
  Every control change is a reason the chosen file is now behind. `sessionRestoring` only keeps a
  restore's own control writes from adding dirty marks: an opened file still reads "not saved"
  (`markLoaded()`), because no handle to it is kept. Choosing something to open is not an edit:
  `markLoaded()` answers for what arrives, and the prompt before it asks about the edits before it.
*/
let sessionRestoring = false;
// A structure or session is being read: undo, a tray Apply or a Style then would re-enable the loads.
let structureLoading = false;
const SOURCE_CONTROLS = new Set([fileInput, sessionFileInput, assemblyInput, pdbIdInput, alphafoldIdInput]);

function markSessionDirty(event) {
  if (sessionRestoring || SOURCE_CONTROLS.has(event?.target)) return;
  sessionLifecycle.markDirty();
}


/*
  One history entry: exactly what a session document holds, minus the structure.

  `createRenderSnapshot()` strips the bytes and `validateRenderSnapshot()` refuses a snapshot that
  still carries them; `embedStructure: false` is what keeps them from being produced at all.
*/
function captureHistoryState() {
  if (!structureFile) return undefined;
  return tabSnapshot(buildRenderRequest(structureFile, undefined, { embedStructure: false }), editorStatePayload());
}


// A snapshot held in this tab also says which switches were unchosen; a document never does.
function tabSnapshot(request, editorState) {
  return { ...createRenderSnapshot(request, editorState), unchosen_switches: [...unchosenComponentSwitches] };
}


const history = createHistory({
  capture: captureHistoryState,
  // Deliberately not the whole snapshot: `rendered_at` is a fresh timestamp every time, so
  // including it would make every capture look like a change.
  serialize: (state) => JSON.stringify([state.render_request, state.editor_state]),
  // `camera` is the only view state in a request, so dropping just that field is what lets the
  // settings-only step walk past a re-frame instead of landing on an entry that applies nothing.
  serializeSettings: (state) => {
    const { camera, ...settings } = state.render_request;
    void camera;
    return JSON.stringify([settings, state.editor_state]);
  },
  onChange: () => updateHistoryControls(),
});


function historyBusy() {
  return renderInFlight || structureLoading || Boolean(styles?.isSweeping());
}


function updateHistoryControls() {
  const state = history.snapshot();
  const locked = historyBusy();
  historyUndoButton.disabled = !state.canUndo || locked;
  // Not `canUndo`: with only view changes behind the cursor there is no earlier *setting* to step
  // back to, and a live button that does nothing is worse than one that says so.
  historySettingsUndoButton.disabled = !state.canUndoSettings || locked;
  historyRedoButton.disabled = !state.canRedo || locked;
  historySettingsRedoButton.disabled = !state.canRedoSettings || locked;
}


function recordHistory(key) {
  if (!structureFile || sessionRestoring) return;
  history.record(key);
}


async function saveSessionAs() {
  if (!structureFile || renderInFlight) return;
  setSessionSaveDisabled(true);
  try {
    const result = await sessionLifecycle.saveAs(structureFile.name);
    if (result.ok && result.downloaded) {
      setLoadStatus(`Session downloaded with the embedded ${structureFile.name} structure.`);
    } else if (result.ok) {
      setLoadStatus('Session saved. Later changes need another Save session as…');
    } else if (result.reason !== 'cancelled') {
      setLoadStatus(sessionLifecycle.snapshot().message ?? 'Session save failed.', true);
    }
  } finally {
    setSessionSaveDisabled(!structureFile || renderInFlight);
  }
}


/*
  What replacing the session loses: edits since the last load, restore or save, and the tray, which
  is not part of a session. A structure merely open is neither; it can be opened again.
*/
function confirmDiscard(question) {
  const renders = stage?.unsavedRenderCount() ?? 0;
  const unsaved = [
    sessionLifecycle.hasUnsavedEdits() && 'The current session has unsaved changes.',
    renders === 1 && 'The unsaved render in the tray will be lost.',
    renders > 1 && `The ${renders} unsaved renders in the tray will be lost.`,
  ].filter(Boolean);
  return unsaved.length === 0 || window.confirm([question, ...unsaved].join(' '));
}


/*
  Asked after the read and before the reset, so a file that will not open is refused without a
  question and a decline leaves everything as it was. The read replaced the one cached parse, so a
  decline puts the previous one back, and the status line the read overwrote.
*/
async function readUnlessDeclined(question, read, status) {
  const { heldParse, restoreHeldParse } = await ensureScenePipeline();
  const held = heldParse();
  const result = await read();
  if (confirmDiscard(question)) return result;
  restoreHeldParse(held);
  setLoadStatus(status.message, status.isError);
  return undefined;
}


function loadStatusSnapshot() {
  return { message: loadStatus.textContent, isError: loadStatus.classList.contains('error') };
}


function newSession() {
  if (renderInFlight) return;
  if (!confirmDiscard('Discard the current session?')) return;
  // Asked already; the reload would ask again about the renders.
  window.removeEventListener('beforeunload', warnBeforeUnload);
  sessionLifecycle.reset();
  window.location.reload();
}


function setSelectValue(select, value, path) {
  const normalized = String(value);
  if (![...select.options].some((option) => option.value === normalized)) {
    throw new Error(`${path} uses unsupported value ${quotedValue(normalized)}.`);
  }
  select.value = normalized;
  // The only path that writes a select without dispatching 'change', so it is also the only place
  // the visual pickers cannot learn about on their own.
  refreshSwatchPickers();
}


/*
  `setFiniteInput()` for a request field with no input behind it: the same refusal, the same
  message shape, and the bounds stated by the caller because there is no `min`/`max` attribute to
  read them off. Used only by the two request fields that have no control.
*/
function setBoundedValue(value, minimum, maximum, path) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new Error(`${path} is outside the supported range.`);
  }
  return number;
}


function setFiniteInput(input, value, path) {
  const number = Number(value);
  const minimum = input.min === '' ? -Infinity : Number(input.min);
  const maximum = input.max === '' ? Infinity : Number(input.max);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new Error(`${path} is outside the supported range.`);
  }
  input.value = String(number);
}


function normalizedColorOverrides(value, path) {
  const normalized = Object.create(null);
  if (value === undefined || value === null) return normalized;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  // One label per chain: a capsid has 180.
  if (Object.keys(value).length > 16384) throw new Error(`${path} contains too many colours.`);
  Object.entries(value).forEach(([label, color]) => {
    if (label.length > 32 || [...label].some((character) => character.charCodeAt(0) < 32)) {
      throw new Error(`${path} contains an invalid label.`);
    }
    const normalizedColor = normalizeColor(color);
    if (!normalizedColor) throw new Error(`${path} ${quotedValue(label)} must be a six-digit colour.`);
    normalized[label] = normalizedColor;
  });
  return normalized;
}


function nucleicStyleFromRequest(request) {
  return request.nucleic_style ?? {
    enabled: availableComponents.nucleic,
    representation: 'nucleic_cartoon',
    material: 'diffuse',
    color_mode: 'nucleic_base',
    color: COMPONENT_COLOR_DEFAULTS.nucleic.uniform,
    color_overrides: {},
    gradient_start: COMPONENT_COLOR_DEFAULTS.nucleic.gradient[0],
    gradient_end: COMPONENT_COLOR_DEFAULTS.nucleic.gradient[1],
    gradient_midpoints: [],
    opacity: 1,
    emission_strength: 3.5,
  };
}


function waterStyleFromRequest(request) {
  return request.water_style ?? defaultWaterStyle();
}


function restoreStyleColorOverrides(editorOverrides, request) {
  ['protein', 'nucleic', 'ligand', 'ion', 'water'].forEach((component) => {
    const target = styleColorOverrides[component];
    Object.keys(target).forEach((key) => delete target[key]);
    const savedComponent = editorOverrides?.[component];
    if (savedComponent && typeof savedComponent === 'object' && !Array.isArray(savedComponent)) {
      Object.entries(savedComponent).forEach(([mode, overrides]) => {
        if (!SESSION_COLOR_MODES.has(mode)) {
          throw new Error(`editor_state.style_color_overrides.${component} uses an unsupported mode.`);
        }
        target[mode] = normalizedColorOverrides(
          overrides,
          `editor_state.style_color_overrides.${component}.${mode}`,
        );
      });
    }
  });
  const activeStyles = {
    protein: request,
    nucleic: nucleicStyleFromRequest(request),
    ligand: request.ligand_style,
    ion: request.ion_style,
    water: waterStyleFromRequest(request),
  };
  // The request's table wins for the mode it is in, but an empty one is deleted rather than
  // written: every reader is `?? {}` or `?.[mode]`, and only writing it grows the file on each
  // open-and-re-save. The call still runs, because refusing a malformed table is what it is for.
  Object.entries(activeStyles).forEach(([component, style]) => {
    const overrides = normalizedColorOverrides(
      style.color_overrides,
      `render_request.${component}.color_overrides`,
    );
    // An unknown mode is refused by its select later; as a key here, `__proto__` would be a write.
    if (!SESSION_COLOR_MODES.has(style.color_mode)) return;
    if (Object.keys(overrides).length === 0) delete styleColorOverrides[component][style.color_mode];
    else styleColorOverrides[component][style.color_mode] = overrides;
  });
}


function baseRepresentationControls(representation) {
  const defaults = {
    representation,
    cartoon_type: DEFAULT_CARTOON_TYPE,
    ribbon_type: 'standard',
    surface_detail: 1,
    stick_scope: 'all',
  };
  const cartoonType = cartoonTypeForRepresentation(representation);
  if (cartoonType !== undefined) {
    return { ...defaults, representation: 'cartoon', cartoon_type: cartoonType };
  }
  const ribbonType = ribbonTypeForRepresentation(representation);
  if (ribbonType !== undefined) {
    return { ...defaults, representation: 'ribbon', ribbon_type: ribbonType };
  }
  const surfaceDetail = surfaceDetailForRepresentation(representation);
  if (surfaceDetail !== undefined) {
    return { ...defaults, representation: 'surface', surface_detail: surfaceDetail };
  }
  const atomScope = atomScopeForRepresentation(representation);
  if (atomScope !== undefined) {
    return { ...defaults, representation: allAtomRepresentation(representation), stick_scope: atomScope };
  }
  return defaults;
}


function restoreBaseAndComponentStyles(request, editorState) {
  const proteinControls = baseRepresentationControls(request.representation);
  const savedProteinControls = editorState.protein_controls ?? {};
  setSelectValue(
    secondaryStructureMethodInput,
    request.secondary_structure?.method ?? DEFAULT_SECONDARY_STRUCTURE_METHOD,
    'Secondary-structure method',
  );
  setSelectValue(representationInput, proteinControls.representation, 'Protein representation');
  setSelectValue(
    cartoonTypeInput,
    proteinControls.representation === 'cartoon'
      ? proteinControls.cartoon_type
      : (savedProteinControls.cartoon_type ?? proteinControls.cartoon_type),
    'Protein cartoon type',
  );
  setSelectValue(
    ribbonTypeInput,
    proteinControls.representation === 'ribbon'
      ? proteinControls.ribbon_type
      : (savedProteinControls.ribbon_type ?? proteinControls.ribbon_type),
    'Protein ribbon type',
  );
  setSelectValue(
    surfaceDetailInput,
    proteinControls.representation === 'surface'
      ? proteinControls.surface_detail
      : (savedProteinControls.surface_detail ?? proteinControls.surface_detail),
    'Protein surface detail',
  );
  setSelectValue(
    atomScopeInput,
    atomScopeForRepresentation(proteinControls.representation) !== undefined
      ? proteinControls.stick_scope
      : (savedProteinControls.stick_scope ?? proteinControls.stick_scope),
    'Protein atom scope',
  );
  resetProteinRepresentationSettings(
    request.representation_settings
      ?? savedProteinControls.representation_settings
      ?? representationSettingsForRepresentation(selectedProteinRepresentation()),
    false,
  );
  setSelectValue(materialInput, request.material, 'Protein material');
  setSelectValue(proteinColorMode, request.color_mode, 'Protein colour mode');
  if (!setColor(request.color)) throw new Error('Protein colour is invalid.');
  setColorPairValue(proteinGradientStartWheel, proteinGradientStartHex, request.gradient_start, 'Protein gradient start');
  setColorPairValue(proteinGradientEndWheel, proteinGradientEndHex, request.gradient_end, 'Protein gradient end');
  proteinGradientEditor.setValues(request.gradient_midpoints ?? [], 'Protein gradient middle colours');
  setFiniteInput(proteinOpacity, request.opacity, 'Protein opacity');
  setFiniteInput(proteinEmissionStrength, request.emission_strength, 'Protein emission strength');

  const nucleicStyle = nucleicStyleFromRequest(request);
  nucleicEnabled.checked = Boolean(nucleicStyle.enabled);
  setSelectValue(nucleicRepresentation, nucleicStyle.representation, 'Nucleic-acid representation');
  resetNucleicRepresentationSettings(
    nucleicStyle.representation_settings
      ?? representationSettingsForRepresentation(nucleicRepresentation.value),
    false,
  );
  setSelectValue(nucleicMaterial, nucleicStyle.material, 'Nucleic-acid material');
  setSelectValue(nucleicColorMode, nucleicStyle.color_mode, 'Nucleic-acid colour mode');
  setColorPairValue(nucleicColorWheel, nucleicColorHex, nucleicStyle.color, 'Nucleic-acid colour');
  setColorPairValue(nucleicGradientStartWheel, nucleicGradientStartHex, nucleicStyle.gradient_start, 'Nucleic-acid 5-prime colour');
  setColorPairValue(nucleicGradientEndWheel, nucleicGradientEndHex, nucleicStyle.gradient_end, 'Nucleic-acid 3-prime colour');
  nucleicGradientEditor.setValues(nucleicStyle.gradient_midpoints ?? [], 'Nucleic-acid gradient middle colours');
  setFiniteInput(nucleicOpacity, nucleicStyle.opacity, 'Nucleic-acid opacity');
  setFiniteInput(nucleicEmissionStrength, nucleicStyle.emission_strength, 'Nucleic-acid emission strength');

  ligandEnabled.checked = Boolean(request.ligand_style.enabled);
  // An older document carries no such field, and `false` is what it meant: the picture it was saved
  // as drew its sulfates.
  ligandHidePolyatomicIons.checked = request.ligand_style.hide_polyatomic_ions === true;
  setSelectValue(ligandRepresentation, request.ligand_style.representation, 'Ligand representation');
  resetLigandRepresentationSettings(
    request.ligand_style.representation_settings
      ?? representationSettingsForRepresentation(ligandRepresentation.value),
    false,
  );
  setSelectValue(ligandMaterial, request.ligand_style.material, 'Ligand material');
  setSelectValue(ligandColorMode, request.ligand_style.color_mode, 'Ligand colour mode');
  setColorPairValue(ligandColorWheel, ligandColorHex, request.ligand_style.color, 'Ligand colour');
  setColorPairValue(ligandGradientStartWheel, ligandGradientStartHex, request.ligand_style.gradient_start, 'Ligand gradient start');
  setColorPairValue(ligandGradientEndWheel, ligandGradientEndHex, request.ligand_style.gradient_end, 'Ligand gradient end');
  ligandGradientEditor.setValues(request.ligand_style.gradient_midpoints ?? [], 'Ligand gradient middle colours');
  setFiniteInput(ligandOpacity, request.ligand_style.opacity, 'Ligand opacity');
  setFiniteInput(ligandEmissionStrength, request.ligand_style.emission_strength, 'Ligand emission strength');

  ionEnabled.checked = Boolean(request.ion_style.enabled);
  setSelectValue(ionRepresentation, request.ion_style.representation, 'Ion representation');
  resetIonRepresentationSettings(
    request.ion_style.representation_settings
      ?? representationSettingsForRepresentation(ionRepresentation.value),
    false,
  );
  setSelectValue(ionMaterial, request.ion_style.material, 'Ion material');
  setSelectValue(ionColorMode, request.ion_style.color_mode, 'Ion colour mode');
  setColorPairValue(ionColorWheel, ionColorHex, request.ion_style.color, 'Ion colour');
  // `gradient_start` / `gradient_end` are deliberately not read back: the ion card has no gradient
  // controls to restore them into.
  setFiniteInput(ionOpacity, request.ion_style.opacity, 'Ion opacity');
  setFiniteInput(
    ionFluorescence,
    request.ion_style.fluorescence_strength ?? request.ion_style.emission_strength,
    'Ion fluorescence strength',
  );

  // A document with no water block gets `defaultWaterStyle()`, which is off: a version that could
  // not draw water drew none.
  const waterStyle = waterStyleFromRequest(request);
  waterEnabled.checked = Boolean(waterStyle.enabled);
  resetWaterRepresentationSettings(
    waterStyle.representation_settings
      ?? representationSettingsForRepresentation(WATER_REPRESENTATION),
    false,
  );
  setSelectValue(waterMaterial, waterStyle.material, 'Water material');
  setColorPairValue(waterColorWheel, waterColorHex, waterStyle.color, 'Water colour');
  setFiniteInput(waterOpacity, waterStyle.opacity, 'Water opacity');
  setFiniteInput(waterEmissionStrength, waterStyle.emission_strength, 'Water emission strength');
  // Written rather than clicked, so the listener that normally carries this to Mol* never fired.
  syncPreviewWaterVisibility();

  const lighting = request.lighting_setup;
  setSelectValue(lightingSource, lighting.source, 'Lighting source');
  setSelectValue(lightingAnchor, lighting.anchor, 'Lighting anchor');
  setFiniteInput(lightingStrength, lighting.strength, 'Lighting strength');
  setFiniteInput(hdriElevation, lighting.elevation, 'Lighting elevation');
  setFiniteInput(hdriAzimuth, lighting.azimuth, 'Lighting azimuth');
  setSelectValue(reflectionEnvironment, lighting.reflection_environment, 'Reflection environment');
  setColorPairValue(reflectionColorWheel, reflectionColorHex, lighting.reflection_color, 'Reflection colour');

  const renderSettings = request.render_settings;
  setFiniteInput(renderWidth, renderSettings.width, 'Render width');
  setFiniteInput(renderHeight, renderSettings.height, 'Render height');
  setFiniteInput(renderSamples, renderSettings.samples, 'Samples');
  renderDenoising.checked = Boolean(renderSettings.denoising);
  // Absent in an older document, and the shipped defaults are what those pictures were made with --
  // so `??` rather than a validation failure. Neither has a control, so `setBoundedValue()` stands
  // in for `setFiniteInput()`: a document out of range still refuses rather than being clamped.
  liveSampleTargetValue = setBoundedValue(
    renderSettings.live_sample_target ?? DEFAULT_LIVE_SAMPLE_TARGET, 16, 4096, 'Live target',
  );
  renderSeedValue = setBoundedValue(renderSettings.seed ?? 0, 0, 65535, 'Seed');
  setSelectValue(viewTransform, renderSettings.view_transform, 'View transform');
  depthOfFieldEnabled.checked = Boolean(renderSettings.depth_of_field.enabled);
  setFiniteInput(fStop, renderSettings.depth_of_field.f_stop, 'F-stop');
  const savedQualityProfile = editorState.render_quality_profile;
  const quality = QUALITY_PROFILES[savedQualityProfile];
  renderQualityProfile.value = sizeIsQualityProfile(
    quality,
    Number(renderSettings.width),
    Number(renderSettings.height),
    Number(renderSettings.samples),
  ) ? savedQualityProfile : 'custom';
  revealOutputAdvancedForCustom();
  syncAspectFromSize();

  const savedFocus = editorState.focus_target;
  const focus = renderSettings.depth_of_field.focus_target;
  focusTarget = focus ? {
    position: [...focus.position],
    label: displayText(savedFocus?.label, 80, 'Saved focus point'),
    kind: savedFocus?.kind === 'atom' ? 'atom' : 'residue',
    component_type: ['protein', 'nucleic', 'ligand', 'ion', 'water'].includes(savedFocus?.component_type)
      ? savedFocus.component_type
      : 'protein',
  } : undefined;

  updateOpacityOutput(proteinOpacity, proteinOpacityValue);
  updateOpacityOutput(nucleicOpacity, nucleicOpacityValue);
  updateOpacityOutput(ligandOpacity, ligandOpacityValue);
  updateOpacityOutput(ionOpacity, ionOpacityValue);
  updateOpacityOutput(waterOpacity, waterOpacityValue);
  proteinEmissionValue.value = String(Number(proteinEmissionStrength.value));
  nucleicEmissionValue.value = String(Number(nucleicEmissionStrength.value));
  ligandEmissionValue.value = String(Number(ligandEmissionStrength.value));
  ionFluorescenceValue.value = String(Number(ionFluorescence.value));
  waterEmissionValue.value = String(Number(waterEmissionStrength.value));
  fStopValue.value = String(Number(fStop.value));
  updateStyleControls();
  updateDepthOfFieldControls();
}


function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}


/*
  Everything a session restores except the structure.

  A document carrying layers is restored rather than refused. `restoreSelectionState()` keeps the
  one honest refusal: a page whose preview canvas could not be built has nowhere to put a layer.
*/
async function restoreSessionSettings(request, editorState, { camera = true, unchosen = [] } = {}) {
  representationSettingsContractEnabled = request.representation_style_schema_version === 1;
  restoreStyleColorOverrides(editorState.style_color_overrides, request);
  restoreBaseAndComponentStyles(request, editorState);
  // A document chose its switches; a snapshot from this tab (`tabSnapshot()`) says which it did not.
  unchosenComponentSwitches.clear();
  unchosen.forEach((key) => unchosenComponentSwitches.add(key));
  // `setSelectValue()` writes the method without dispatching `change`, so the walk this file keeps
  // has to be told: a restored session naming `dssp` would otherwise report `auto` under the frame.
  await refreshSecondaryStructure();
  await restoreSelectionState(request, editorState);
  /*
    The level first, because `setPickingLevel()` ends in Select and the stored mode is what decides
    that -- restored the other way round, every document carrying a level would open in Select
    whatever it actually said. A document from before the control, or one naming a level this
    version does not offer, leaves the default standing rather than being refused: it is where the
    pointer was, not part of the picture.
  */
  if (PICKING_LEVELS.includes(editorState.picking_level)) {
    setPickingLevel(editorState.picking_level);
  }
  setInteractionMode(editorState.interaction_mode === 'select' ? 'select' : 'inspect');
  // A stored view rather than the view, so it is restored on the settings-only step too, where
  // `camera: false` leaves the camera alone. A document without one clears it.
  savedCameraView = editorState.saved_camera_view
    ? cloneCameraJson(validateCamera(editorState.saved_camera_view, 'editor_state.saved_camera_view'))
    : undefined;
  clearSavedCameraViewConfirmation();
  updateSavedCameraViewControls();
  /*
    `camera: false` is the whole of the settings-only undo. `restoreCamera()` is what moves the
    preview camera *and* what sets `restoredCameraBaseline`, the value `cameraJson()` reports back
    while the live camera still matches it -- so not calling it leaves both the view and that
    baseline exactly as the user left them, and the next render still carries the camera they are
    looking through. With no preview canvas the baseline is all there is, and it is still written.
  */
  if (!camera) return;
  if (preview?.plugin.canvas3d) restoreCamera(request.camera);
  else {
    restoredCameraBaseline = jsonClone(request.camera);
    syncFocalLengthReadout();
  }
}


/*
  `exact` is the reconstruction check and it is skipped for exactly one kind of document.

  This app's own session is held to *byte* reconstruction: rebuilding the request from the restored
  controls must produce the document that was saved, or the app says so rather than opening a saved
  picture as a nearly-saved one. A **legacy `.sprsession` cannot meet that** and must not be held to
  it -- `importDesktopSession()` has already dropped what this renderer does not have and named each
  one, so the honest report is that list rather than a bare "could not reconstruct".

  **It is a report, never a refusal.** `reconstructionDifferences()` names the fields and the
  session opens either way; nothing below this line may be made conditional on it.
*/
/*
  `file` is a share link's downloaded structure, which a link carries in place of the embedded bytes,
  and `link` says how to report it: `warning(read)` compares what arrived with what the link was made
  from, and a mismatch opens with the warning rather than refusing (the databases revise files).
*/
async function restoreSession(session, {
  exact = true, imported = false, dropped = [], question, status, file, link,
}) {
  const request = session.render_request;
  const extension = request.filename.toLowerCase().endsWith('.pdb') ? 'chemical/x-pdb' : 'chemical/x-cif';
  const embeddedFile = file ?? new File(
    [base64ToBytes(request.structure_base64)],
    request.filename,
    { type: extension },
  );
  /*
    The molecule first, not after. Passing it here builds the assembly the document was made from
    in the one parse `readStructure()` does; setting the control afterwards would parse the wrong
    molecule, adopt it into the preview, and then parse again -- two `Structure`s from one restore.
    An imported `.sprsession` carries no such field, and `undefined` is exactly right for it: it
    means the molecule the file means, which is Mol*'s first biological assembly.
  */
  const read = await readUnlessDeclined(
    question,
    () => readStructure(embeddedFile, { assembly: request.assembly }),
    status,
  );
  if (!read) return false;
  const linkWarning = link ? await link.warning(read) : undefined;
  // A restore writes every control; this keeps those writes from each marking the session dirty.
  sessionRestoring = true;
  // The file path's reset, so a restore that throws part-way leaves no layer or focus point of the
  // previous protein on this one. After the parse, so a document that will not open clears nothing.
  prepareForStructureLoad();
  let restored = false;
  try {
    await loadStructure(read);
    await restoreSessionSettings(request, session.editor_state);
    restored = true;
  } finally {
    // As the structure path does: a half-restored session is not one to save, render or trace.
    if (!restored) {
      structureFile = undefined;
      document.dispatchEvent(new CustomEvent('foldray:structure-loading'));
    }
  }
  structureFile = embeddedFile;

  // Caught, not thrown: a request that will not build is a real finding and still not a reason to
  // leave the session half-restored.
  let missed = [];
  if (exact) {
    try {
      missed = reconstructionDifferences(buildRenderRequest(embeddedFile), request);
    } catch (error) {
      missed = [`the render request (${error.message || error})`];
    }
  }
  // The saved recipe, armed for whichever render lands next -- `stage-modes.js` carries it forward
  // from there. The same mechanism a Style's Improve image uses, which is why there is one call.
  stage?.restorePostProcessing(session.post_processing);
  // Retarget, never start: a restored session is a saved composition, not a request for a picture,
  // and the same rule loadStructure() follows applies to the document that carries one.
  scheduleTraceUpdate();
  // After the controls, not before: restoring them fires the change events that clear the Style.
  // A catalogue id or none, since the value is saved back as it stands.
  const savedStyle = styleById(session.editor_state.style_id)?.id;
  styles?.setActive(savedStyle);
  // The restored session is the baseline, not a step forward from the defaults loadStructure()
  // recorded on the way in.
  history.reset();
  await history.commit();
  sessionLifecycle.markSettled();
  if (link) {
    const rebuilt = missed.length
      ? ` This app version rebuilt ${missed.join(', ')} differently from the link.`
      : '';
    setLoadStatus(
      `${linkWarning ? `${linkWarning} ` : ''}Opened a shared link: ${link.name}.${rebuilt}`,
      Boolean(linkWarning || missed.length),
    );
    setRenderStatus('Ready', 'The shared camera and settings are ready to render.');
    return true;
  }
  if (missed.length) {
    setLoadStatus(
      `${displayText(request.filename, 80, 'The structure')} was restored, but this app version rebuilt `
      + `${missed.join(', ')} differently from the saved document.`,
      true,
    );
    setRenderStatus('Ready', `Restored with ${missed.length} field(s) rebuilt differently.`);
    return true;
  }
  setLoadStatus(imported
    ? `${displayText(request.filename, 80, 'The structure')} was imported from a desktop session.${importReport(dropped)}`
    : `${displayText(request.filename, 80, 'The structure')} and its complete render session were restored exactly.`);
  setRenderStatus('Ready', 'The restored camera and settings are ready to render.');
  return true;
}


/*
  Which fields this app version rebuilt differently, named -- and the one it does not compare.

  `camera.scene_radius` is Mol*'s bookkeeping, not the picture: `resolveCamera()` never reads it and
  Mol* re-derives it on every scene commit, so a mismatch there can only ever be a false alarm.
  Everything else, camera included, is still compared byte for byte.
*/
function reconstructionDifferences(rebuilt, saved) {
  const withoutSceneRadius = (request) => {
    const { scene_radius: radius, ...camera } = request.camera ?? {};
    void radius;
    return { ...request, camera };
  };
  const left = withoutSceneRadius(rebuilt);
  const right = withoutSceneRadius(saved);
  // A share link carries no bytes: the structure is the download, and the digest speaks for it.
  if (!Object.hasOwn(right, 'structure_base64')) delete left.structure_base64;
  if (canonicalJson(left) === canonicalJson(right)) return [];
  // Named from the rebuilt request only: a document's own key names would reach the status line.
  const differing = Object.keys(left).sort()
    .filter((key) => canonicalJson(left[key]) !== canonicalJson(right[key]));
  const unknown = Object.keys(right).filter((key) => !Object.hasOwn(left, key)).length;
  return unknown > 0 ? [...differing, `${unknown} field(s) this version does not write`] : differing;
}


/*
  What did not come across, said in full.

  `dropped` is `importDesktopSession()`'s own report: a field, its value and a sentence about why
  this renderer has nothing to put it on. It is listed rather than counted, because "some settings
  could not be imported" is the message that makes a person re-check everything.
*/
function importReport(dropped) {
  if (!dropped?.length) return ' Everything in it came across.';
  return ` ${dropped.length} setting(s) did not come across — `
    + `${dropped.map((entry) => `${entry.field}: ${entry.why}`).join(' · ')}`;
}


/*
  Which format the chosen file is in, and the one case where the answer is the legacy one.

  `src/launcher.js` routes a `.sprsession` to the same input as our own `.foldray`, and
  `parseSessionDocument()` refuses it by name with the sentence "import it instead" -- advice
  nobody can take unless this function is reachable from the file picker. It is one way, and the
  report of what did not come across is the point.
*/
function sessionFromFileText(text) {
  let head;
  try {
    head = JSON.parse(text);
  } catch {
    // Not JSON at all. `parseSessionDocument()` owns that sentence, so let it say it.
    head = undefined;
  }
  if (head?.format !== LEGACY_SESSION_FORMAT) {
    return { session: parseSessionDocument(text), imported: false, dropped: [] };
  }
  const { request, editorState, postProcessing, dropped } = importDesktopSession(text);
  const refusal = desktopImportRefusal({ request, dropped });
  if (refusal) throw new Error(refusal);
  return {
    session: {
      render_request: request,
      editor_state: editorState,
      ...(postProcessing !== undefined ? { post_processing: postProcessing } : {}),
    },
    imported: true,
    dropped,
  };
}


async function loadSessionFile(file) {
  if (renderInFlight) return;
  const status = loadStatusSnapshot();
  setRenderControlsDisabled(true);
  setRenderActionsDisabled(true);
  setLoadStatus(`Loading session: ${file.name}`);
  structureLoading = true;
  // No `foldray:structure-loading` here: it empties the tray and turns Live off, so it waits for
  // `restoreSession()`, past the parse -- a dropped `.json` that is not a session touches neither.
  try {
    const { session, imported, dropped } = sessionFromFileText(await file.text());
    await restoreSession(session, { exact: !imported, imported, dropped, question: `Open ${file.name}?`, status });
  } catch (error) {
    setLoadStatus(`Session load failed: ${error.message || error}`, true);
    setRenderStatus('Failed', 'The saved session was not restored.', true);
  } finally {
    sessionRestoring = false;
    structureLoading = false;
    sessionFileInput.value = '';
    setRenderControlsDisabled(false);
    setSessionSaveDisabled(!structureFile);
    setRenderActionsDisabled(!structureFile);
  }
}


async function applyHistoryState(state, { camera }) {
  setRenderControlsDisabled(true);
  history.pause();
  sessionRestoring = true;
  try {
    await restoreSessionSettings(state.render_request, state.editor_state, { camera, unchosen: state.unchosen_switches });
    styles?.setActive(state.editor_state.style_id);
    return true;
  } catch (error) {
    setLoadStatus(`Could not step through history: ${error.message || error}`, true);
    return false;
  } finally {
    sessionRestoring = false;
    history.resume();
    setRenderControlsDisabled(false);
    markSessionDirty();
    scheduleTraceUpdate();
  }
}


async function stepHistory(direction, { camera = true } = {}) {
  if (!structureFile || historyStepping || historyBusy()) return;
  historyStepping = true;
  try {
    let state;
    if (direction === 'redo' && !camera) state = await history.redoSettings();
    else if (direction === 'redo') state = await history.redo();
    else if (camera) state = await history.undo();
    else state = await history.undoSettings();
    if (!state) {
      if (direction === 'undo' && !camera && history.snapshot().canUndo) {
        setLoadStatus('Nothing earlier to step back to but the framing, which this leaves alone.');
      }
      return;
    }
    if (!await applyHistoryState(state, { camera })) return;
    setLoadStatus(direction === 'redo'
      ? `Stepped forward one change${camera ? ', framing included' : ' in the settings'}.`
      : `Stepped back one change${camera ? ', framing included' : ' in the settings'}.`);
  } finally {
    historyStepping = false;
    updateHistoryControls();
  }
}




/*
  ------------------------------------------------------------------------------------------------
  The Styles: the three write paths a picture clicked in the gallery has.
  ------------------------------------------------------------------------------------------------

  `src/styles-strip.js` is the gallery, the sweep and the Style card; it writes no request field and
  knows nothing about a structure. What it needs from here is three ways to reach the composition,
  and each is a different kind of thing rather than three flavours of one:

    1. **The controls** (`applyStyleWrites`) -- an id, an event and a value, written into the real
       control so this file's own handlers run and nothing in the catalogue has to know what a
       representation change implies.
    2. **The selection layers** (`applyStyleOverlays`) -- a JS list, not DOM, so it cannot be
       applied by setting a value. Each pass becomes a real layer through the same
       `captureSelectionLayer()` a hand-made one goes through.
    3. **The per-category colour table** (`applyStyleColorScheme`) -- `styleColorOverrides`, which
       is plain state that reaches the request as `color_overrides` and has no control at all.

  All three are per **component group**: Styles stack across component groups, so an apply replaces
  the groups the incoming Style has an opinion about and leaves every other group exactly as it was.
  The sweep passes no group set and full-replaces all four, or a walked tile inherits the tile
  before it and stops matching the thumbnail that chose it.
*/

/*
  Applies a Style by writing the real controls and dispatching their real events, so this file's own
  handlers run. A value the control does not offer is skipped rather than written: assigning an
  unknown value to a `<select>` silently blanks it, which would be worse than ignoring a stale
  catalogue entry.
*/
function applyStyleWrites(writes, { transient = false, components } = {}) {
  const wasRestoring = sessionRestoring;
  if (transient) sessionRestoring = true;
  // Fields whose value this structure cannot offer, named so the line below can say which.
  const unavailable = [];
  try {
    writes.forEach(({ control, event, kind, field, value }) => {
      const element = document.querySelector(`#${control}`);
      if (!element) return;
      if (kind === 'checkbox') {
        element.checked = Boolean(value);
      } else if (element instanceof HTMLSelectElement) {
        /*
          **A value this select does not offer falls back to the baseline; it must never fall
          through.**

          The only fields this can fire on are the two metric colour modes.
          `detectStructureMetric()` yields at most *one* of `plddt`/`bfactor` per file and
          `setStructureMetric()` injects that one option, so on an X-ray structure the four
          Confidence Styles ask for `plddt`, on a predicted model the four Disorder Styles ask for
          `bfactor`, and on a file carrying neither all eight do.

          Returning here would skip the write *and* the event, so `color_mode` would keep whatever
          the previous apply had set -- `rainbow_ribbon` then `Confidence cartoon` rendering a
          sequence rainbow under a tile showing a confidence ramp, with nothing said. **Every
          allowlisted field is baselined and full-replaced within the component group the Style
          owns**, and `resolvedStyleWrites()` emits one write per field, so there is no second write
          behind this one to catch it. Falling back to `STYLE_BASELINE` is therefore restoring the
          stated contract rather than inventing a policy: a colour mode is a setting the user can
          see and change, so it is named rather than refused.
        */
        const offered = (candidate) => [...element.options]
          .some((option) => option.value === String(candidate));
        if (!offered(value)) {
          const fallback = STYLE_BASELINE[field];
          // A baseline the select does not offer either would be a catalogue fault rather than a
          // property of this file, and there is nothing safe to write for it.
          if (fallback === undefined || !offered(fallback)) return;
          unavailable.push({ field, value });
          element.value = String(fallback);
        } else {
          element.value = String(value);
        }
      } else {
        element.value = String(value);
      }
      element.dispatchEvent(new Event(event, { bubbles: true }));
    });
    hideHydrogensForStyle(components);
  } finally {
    sessionRestoring = wasRestoring;
  }
  /*
    Said once per apply, and not at all during a walk: a sweep applies two dozen Styles in a row and
    restores the pre-sweep composition on the way out, so a line per tile would be two dozen
    statements about a composition the user never asked to keep. The *fallback* still happens there
    -- a swept tile inheriting the tile before it is the defect the full replace exists to prevent.
  */
  if (!transient && unavailable.length > 0) {
    // `METRIC_COLOR_LABELS` because the two metric colour modes are the only values that can reach
    // here, and it is the same table the injected option and the capability line are named from --
    // so the sentence cannot call a mode something the picker does not.
    setLoadStatus(`This structure carries no ${
      unavailable.map(({ value }) => METRIC_COLOR_LABELS[value] ?? value).join(' or ')
    } data, so ${
      unavailable.map(({ field }) => field.replace(/_/g, ' ')).join(' and ')
    } fell back to this Style's default instead of the one the tile was rendered with.`);
  }
}


/*
  Every Style renders with hydrogens hidden, on every component that offers the setting.

  `show_hydrogens` is the one member of `representation_settings` that is not a geometry number. Its
  authored default is off in every family, so this catches two cases: a **Style** that names
  `show_hydrogens: true` in its own block, and a user who ticked the box by hand before clicking a
  tile. Either way a Style is a picture chosen by eye from a tile, every tile was rendered without
  hydrogens, and a ball-and-stick Style landing on a structure that carries them renders a fog of
  small spheres the tile never showed.

  It cannot ride on `STYLE_FIELDS` with the others: those are `#id` plus an event, and the
  representation settings are generated per representation with no stable ids at all. Reading each
  editor's own values and handing them back is the supported way in, and it is why this is a
  function here rather than a row in the catalogue's allowlist. It runs inside `applyStyleWrites()`,
  after the writes, because the representation has to have landed before its settings mean anything.

  `components`, when given, is the set of groups this apply replaces. A group the incoming Style
  says nothing about keeps its own representation settings, hydrogens included: the whole point of
  stacking is that the previous Style's ligand is left exactly as it rendered, and reaching into its
  editor here would be the one write that leaked out of the rule.
*/
function hideHydrogensForStyle(components) {
  const off = (component, editor, reset) => {
    if (components && !components.has(component)) return;
    const settings = editor?.values();
    if (!settings || settings.show_hydrogens !== true) return;
    // Contract enabled, deliberately: `representation_settings` only reaches the request while it
    // is, so leaving it alone would drop the very field this function exists to state.
    reset({ ...settings, show_hydrogens: false });
  };
  off('protein', proteinRepresentationEditor, resetProteinRepresentationSettings);
  off('nucleic', nucleicRepresentationEditor, resetNucleicRepresentationSettings);
  off('ligand', ligandRepresentationEditor, resetLigandRepresentationSettings);
  off('ion', ionRepresentationEditor, resetIonRepresentationSettings);
  // **Water is deliberately not in this list.** No Style can write water (`OVERLAY_COMPONENTS`), so
  // reaching into its editor here would be a Style silently changing a component it has no opinion about.
}


/*
  A Style's colour scheme: the per-category colour table, and the reset that has to come with it.

  Six colour modes paint from no control at all. `chain`, `element`, `nucleic_base`,
  `nucleic_part` and both metric ramps paint from `styleColorOverrides`, a plain table keyed on
  labels the *structure* supplies, which reaches the tracer as `color_overrides`.

  Two jobs, in this order:

    1. RESET. Every replaced component's table is cleared and its gradient cut back to its two
       endpoints, so applying a Style is a full replace of the whole colour state rather than a merge
       into whatever the last one left. Without it a hand-edited by-chain palette survives into the
       next Style, and a hand-built five-colour gradient into every later one -- both cases where the
       rail and the render agree with each other and disagree with the Style whose name is on the
       bar. Clearing is enough to restore the defaults: `renderCategoryColors()` re-seeds every label
       it draws from `defaultCategoryColor()`.
    2. WRITE the chosen scheme over the cleared table. Keyed schemes name their labels; the
       positional one (`chain`) is mapped onto the labels the grid actually detected, in that grid's
       order, exactly as `defaultCategoryColor()` walks the categorical palette.

  Called after `applyStyleWrites()` and never before: the colour *mode* has to have landed before
  the table for that mode means anything, and the gradient reset reads the endpoints just written.

  The reset is per component group for the same reason the writes are. Clearing all four tables
  under a protein Style would take the previous ion Style's element colours with it and leave its
  ions drawn in the app's defaults -- they would survive, which is what the user asked for, and
  would not survive *looking like anything they chose*, which is the half that matters.
*/
function applyStyleColorScheme(scheme, { transient = false, components } = {}) {
  const wasRestoring = sessionRestoring;
  if (transient) sessionRestoring = true;
  const replaces = (component) => !components || components.has(component);
  try {
    Object.keys(styleColorOverrides).forEach((component) => {
      if (replaces(component)) styleColorOverrides[component] = {};
    });
    // A Style always writes both gradient endpoints (`STYLE_BASELINE` covers the ones it omits) but
    // has no way to say how many colours are between them, so a hand-built five-stop ramp would
    // otherwise keep its middle three under every Style that followed.
    if (replaces('protein')) proteinGradientEditor?.setValues([]);
    if (replaces('nucleic')) nucleicGradientEditor?.setValues([]);
    if (replaces('ligand')) ligandGradientEditor?.setValues([]);
    if (scheme?.target && scheme?.mode) {
      const overrides = styleColorOverrides[scheme.target] ?? {};
      styleColorOverrides[scheme.target] = overrides;
      const table = overrides[scheme.mode] ?? {};
      overrides[scheme.mode] = table;
      Object.entries(scheme.labels ?? {}).forEach(([label, hex]) => { table[label] = hex; });
      if (scheme.palette?.length) {
        (detectedColorLabels[scheme.target]?.[scheme.mode] ?? []).forEach((label, index) => {
          table[label] = scheme.palette[index % scheme.palette.length];
        });
      }
    }
    // Repaints all four category grids, which is also what re-seeds every label the scheme left
    // alone.
    updateStyleControls();
  } finally {
    sessionRestoring = wasRestoring;
  }
}


/*
  The per-category table a mirrored base has to bring with it.

  A layer stores `color_overrides` keyed by mode, exactly as the base does, and a `from: 'base'`
  pass that copied the base's *mode* without its table would fall back to `defaultCategoryColor()`
  -- so a Style with a by-chain palette and a mirrored base rendered the base in the scheme's
  colours and the mirror in the defaults. Cloned rather than shared: a layer's table is editable on
  its own card.
*/
function componentBaseColorOverrides(component, mode) {
  const table = styleColorOverrides[component]?.[mode];
  return table ? { [mode]: { ...table } } : {};
}


/*
  What a component's base looks like *right now*, as the layer state `captureSelectionLayer()` takes.

  This is the whole of `from: 'base'`, and reading the live controls is the point rather than a
  shortcut. It runs after the Style's own writes have landed, so it mirrors the Style: a pass puts
  its component in `replacedComponents()`, so a silent field is STYLE_BASELINE's by the time this
  reads it, not the user's.

  **There is no picker-to-layer map, and there must not be one.** Two spellings of one look --
  prefixed in a picker, bare in a layer -- would mean stripping the prefix back off here.
  `COMPONENT_REPRESENTATIONS` carries the prefixed id, so the picker's value *is* the layer's value.
*/
function componentBaseLayerState(component) {
  // Only what `captureSelectionLayer()`'s `componentDefaults` cannot supply: it already reads the
  // same controls for every other appearance field, and a second copy of that read had drifted.
  const controls = {
    protein: { representation: selectedProteinRepresentation(), color_mode: proteinColorMode.value },
    nucleic: { representation: nucleicRepresentation.value, color_mode: nucleicColorMode.value },
    ligand: { representation: ligandRepresentation.value, color_mode: ligandColorMode.value },
    ion: { representation: ionRepresentation.value, color_mode: ionColorMode.value },
    water: { representation: WATER_REPRESENTATION, color_mode: waterColorMode.value },
  }[component];
  return {
    ...controls,
    color_overrides: componentBaseColorOverrides(component, controls.color_mode),
  };
}


/*
  One overlay pass, as the `existing` layer state `captureSelectionLayer()` merges over its defaults.
  `from: 'base'` is resolved here and nowhere else -- `src/style-overlays.js` is pure and has no
  controls to read, which is also what keeps its rule testable without a DOM.
*/
function styleOverlayLayerState(pass) {
  if (pass.from === 'base') {
    return { name: pass.name ?? 'Style base', ...componentBaseLayerState(pass.component) };
  }
  const declared = { ...pass };
  delete declared.component;
  delete declared.from;
  // `scope` says which atoms the pass covers, and `resolveOverlayScope()` has already answered it by
  // the time this runs. Leaving it on would carry a catalogue-only word into the layer, and from
  // there into editor state and the saved session, describing a rule the layer no longer follows.
  delete declared.scope;
  /*
    **`representation_settings` is kept and is deliberately not a deletion here.**

    `cartoon_settings` and `base_shape` name controls this tree does not have at all, and
    `OVERLAY_FIELDS` admits neither. This one names a control it *does* have: `sphere_radius`,
    `bond_radius`, `stick_radius` and `show_hydrogens` are ours and are the Style's art direction,
    so deleting the field would throw away the whole of what a pass can say here. A pass's block
    and its representation are still decided in two places, so `captureSelectionLayer()` narrows it
    against the id the layer resolves to rather than taking it whole.
  */
  /*
    The per-category table, for a pass painting from one.

    `OVERLAY_FIELDS` carries no `color_overrides` and deliberately should not: a pass stating its own
    per-label colours would be a second, per-pass colour-scheme system beside the real one. But a
    pass in one of the table-painting modes has to get the table from *somewhere*, and with nothing
    here it gets `{}` -- `defaultCategoryColor()` for every label. That is invisible while a Style
    rests on `As designed`, because the default table is what "as designed" means; the moment a user
    picks any other scheme the base moves onto it and the pass stays behind, and the render comes
    back half recoloured.

    Uniform and gradient modes are excluded because they read no table at all; for them the pass's
    own `color` and endpoints are the whole answer.
  */
  const paintsFromTable = declared.color_mode
    && !GRADIENT_COLOR_MODES.has(declared.color_mode)
    && declared.color_mode !== 'uniform';
  return {
    name: pass.name ?? 'Style overlay',
    ...declared,
    ...(paintsFromTable
      ? { color_overrides: componentBaseColorOverrides(pass.component, declared.color_mode) }
      : {}),
  };
}


/*
  Turn a Style's overlay passes into real selection layers.

  Every pass covers a whole component, so the selection is "all of it": `compressResidues()` over the
  residue list collected at load, then the *session-restore* path -- `selectCompactResidues()` to put
  those ranges into the plugin, `captureSelectionLayer()` to read a layer back out. That is the one
  existing route that builds a layer with no live gesture behind it, and reusing it is what keeps a
  Style-applied layer indistinguishable from a hand-made one everywhere afterwards: same editor card,
  same reordering, same session round-trip, same request payload.

  **A Style overrules the layers, and the one exception is hiding.** A hand-made layer that survived
  an apply would go on painting over the Style that had just been chosen, so the picture would not
  match the tile that chose it and nothing would say why -- a layer is a whole styled region, and one
  left over from a previous idea is not a highlight on top of the new one, it is the new one covered
  up. The replacement rule therefore reaches every layer regardless of where it came from.

  **Hidden layers are kept, and they are kept unconditionally.** A hidden layer is not an
  appearance the Style could be overruling; it is a statement about what the picture is *of*, which
  no Style has an opinion about. It is also load-bearing: `window.foldRayView.hide()` hides a
  region and applies a Style afterwards, which is how a driver composes a picture of a buried
  pocket.

  Style layers are still tagged `origin: 'style'`, which is what `Apply style only` and the session
  document read. The tag rides in editor state, which is free-form, so the render request never
  carries it.

  `components` is the set of groups this apply replaces, and it is what keeps "Styles stack across
  component groups" true of layers as well as controls: a layer whose single component this Style
  has no opinion about is left exactly where it is, hand-made or not. An ion Style's extra ion pass
  is as much of "the ions stay as they were" as the ion base controls are, and dropping it would
  leave the ion group half-inherited. The sweep passes no group set at all, so a walked tile keeps
  nothing but the hidden layers -- which is the same full replacement it already does to the
  controls, and for the same reason.

  **A page with no preview canvas skips the passes and says so once.** Every route into a layer goes
  through the plugin's selection manager, so with no plugin there is nothing to build one out of --
  and a Style whose overlays are a highlight over a shell would otherwise apply as the shell alone,
  silently, which is a Style rendering as a different Style.
*/
async function applyStyleOverlays(style, { transient = false, components } = {}) {
  const passes = styleOverlays(style);
  const previous = selectionLayers.length;
  const keepsLayer = (layer) => Boolean(components)
    && layer.component_types?.length === 1
    && !components.has(layer.component_types[0]);
  const kept = selectionLayers.filter(
    (layer) => layer.hidden === true || keepsLayer(layer),
  );
  // Nothing to do and nothing to undo: leave the layers, the preview and the history alone rather
  // than rebuilding an identical list on every Style click.
  if (passes.length === 0 && kept.length === previous) return;
  if (!preview) {
    if (passes.length > 0) {
      setLoadStatus(
        `${style.label} draws ${passes.length} of its own layer(s), and the preview canvas is`
        + ' unavailable, so there is nowhere to build them. The rest of the style is applied.',
        true,
      );
    }
    return;
  }

  const wasRestoring = sessionRestoring;
  if (transient) sessionRestoring = true;
  // The user's live selection is a workspace, not a setting. Applying a Style borrows it to resolve
  // each pass and has to give it back.
  const liveSelection = preview.plugin.managers.structure.selection.getSnapshot();
  try {
    /*
      Built into a local list and swapped in once, rather than mutated in place.

      `selectCompactResidues()` writes a Mol* selection and Mol* notifies its subscribers
      *synchronously*, so `updateCurrentSelectionStatus()` runs inside this loop -- and
      `updateSelectionLayerEditControls()` pairs each rendered `.selection-layer` card with
      `selectionLayers[index]`. Assigning the shorter list here and pushing to it would leave the
      array and the DOM disagreeing for the length of the loop, and the first notification would read
      past the end of the array and throw from inside an unrelated Mol* subscription. Keeping the
      live list whole until it is finished means every observer that runs mid-build sees the state
      from before, which is a state that has always been consistent.
    */
    const next = [...kept];
    let dropped = 0;
    passes.forEach((pass, index) => {
      const residues = resolveOverlayScope(componentResidues[pass.component] ?? [], pass.scope);
      /*
        A nucleic pass on a structure with no nucleic acid: skip it rather than build a layer
        matching nothing, which would be a row in the right rail that renders nothing and cannot be
        explained.

        The same line is what makes an interface Style work on a monomer: the partner scope resolves
        to nothing there, so the Style is its host pass alone, over the whole protein.
      */
      if (residues.length === 0) return;
      if (next.length >= MAX_SELECTION_LAYERS) {
        dropped += 1;
        return;
      }
      const compact = compressResidues(residues);
      selectCompactResidues(compact, `${style.label} overlay ${index + 1}`);
      const layer = captureSelectionLayer({
        ...styleOverlayLayerState(pass),
        origin: 'style',
        // Closed: these are the Style's business, and opening four cards would push the user's own
        // layers off the rail every time a tile was clicked.
        expanded: false,
      });
      // The same rule the base components get in `hideHydrogensForStyle()`: a Style renders without
      // hydrogens, and a pass is as much of the Style's picture as the base is.
      if (layer.representation_settings?.show_hydrogens === true) {
        layer.representation_settings = { ...layer.representation_settings, show_hydrogens: false };
      }
      next.push(layer);
    });
    selectionLayers = next;
    renderSelectionLayers();
    if (dropped > 0) {
      setLoadStatus(
        `${dropped} of this style's layers were not added: ${MAX_SELECTION_LAYERS} selection `
        + 'layers is the maximum. Remove a layer of your own to see the whole style.',
        true,
      );
    }
  } finally {
    if (liveSelection) restoreSelectionSnapshot(liveSelection);
    else clearCurrentSelection();
    sessionRestoring = wasRestoring;
  }
  queueSelectionRepaint();
  if (!transient) {
    markSessionDirty();
    // Coalesced with the control writes that came with it, so applying a Style is one undo step.
    recordHistory('style-overlays');
  }
}


/*
  One swept tile: a finite render at the tile's own quality, through the same lock and the same
  seam every other render goes through.

  It does **not** set `renderInFlight`. That flag is the shell's render lock -- it disables the whole
  control surface and the layer cards -- and a sweep is a walk of applies, each of which writes those
  same controls. The sweep's own single-worker rule is what stops two tiles overlapping
  (`src/style-sweep.js`), and `render()` takes `src/render-lock.js` so the live trace parks.
*/
const SWEEP_TILE_QUALITY = { profile: 'custom', width: 256, height: 256, samples: 16 };

async function renderStyleTile(quality) {
  if (!structureFile || renderInFlight) return undefined;
  const file = structureFile;
  setRenderActionsDisabled(true);
  setRenderProgress(undefined);
  setRenderStatus(
    'Rendering style',
    `Rendering this style at ${quality.width}px and ${quality.samples} samples.`,
  );
  try {
    const request = buildRenderRequest(file, quality);
    const settings = tabSnapshot(request, editorStatePayload(quality));
    const result = await render(withAutoFocus(request), {
      onStage: (stage, message) => setRenderStatus(stage, message),
      onWarning: showBuildWarning,
      onProgress: (progress) => setRenderProgress(progress),
    });
    // A cancelled trace has no image. The sweep reads `undefined` as "stood down", not "crashed".
    if (result.cancelled) return undefined;
    return { ...result, settings };
  } finally {
    setRenderActionsDisabled(!structureFile);
  }
}


/*
  What puts the sweep's baseline back. The baseline is `captureHistoryState()`, the whole
  composition, because a walk is **non-destructive**: the exact pre-sweep composition is restored
  after completion, Stop, cancellation or failure.
*/
async function restoreSweepBaseline(snapshot) {
  if (!snapshot) return;
  history.pause();
  sessionRestoring = true;
  try {
    await restoreSessionSettings(snapshot.render_request, snapshot.editor_state, { unchosen: snapshot.unchosen_switches });
    styles?.setActive(snapshot.editor_state.style_id);
  } finally {
    sessionRestoring = false;
    history.resume();
  }
}


/*
  One residue count per protein chain, from the list the overlay passes already walk. It is what
  tells a bound peptide apart from a second copy of the protein, and it uses the same `chain_id` key
  `resolveOverlayScope()` groups by, so the profile's "partner" is the partner a scoped Style paints.
*/
function proteinChainResidueCounts() {
  const byChain = new Map();
  componentResidues.protein.forEach((residue) => {
    const chain = residue.chain_id ?? '';
    byChain.set(chain, (byChain.get(chain) ?? 0) + 1);
  });
  return [...byChain.values()];
}


/*
  The one place the gallery learns what was loaded.

  Everything it needs was already counted by `collectStructureResidues()`, so this adds no pass over
  the structure: chain counts come from the per-component chain label sets, residue counts from the
  per-component residue lists the overlay passes use, and the metric from `detectStructureMetric()`,
  which ran when the file was read.

  The recommendation is a sample, so `Randomize styles` needs a way to take another one. The
  closure is handed to the strip rather than the profile: the strip stays the surface that knows
  nothing about structures, and the previous sample -- which the next one is drawn against -- lives
  in the one place that produced it.
*/
function publishStructureRecommendations() {
  const profile = structureProfile({
    proteinChains: detectedColorLabels.protein?.chain.length ?? 0,
    nucleicChains: detectedColorLabels.nucleic?.chain.length ?? 0,
    proteinResidues: componentResidues.protein.length,
    nucleicResidues: componentResidues.nucleic.length,
    ligandResidues: componentResidues.ligand.length,
    ionResidues: componentResidues.ion.length,
    proteinChainResidues: proteinChainResidueCounts(),
    metric: structureMetric,
  });
  let shown = [];
  const resample = () => {
    shown = recommendStyles(profile, STYLE_CATALOG, { recent: shown });
    return shown;
  };
  styles?.setRecommendations({ ids: resample(), facts: profileFacts(profile), resample });
}


/*
  Unbuilt looks and colour modes, greyed out at the one place a person actually picks one. Options
  are **disabled, never removed**: a vanished tile reads as a bug, a greyed one reads as a promise.
  The value a session or the defaults already carry is left alone -- disabling an option does not
  change `select.value` -- so only *choosing* one of these is refused.

  A no-op while `capabilities()`'s `NOT_BUILT` bucket is empty, which it is for representations; the
  one unimplemented colour mode is `nucleic_duplex`.
*/
function applyFidelityGating(declared) {
  const disabledRepresentations = new Set(declared?.representations?.[NOT_BUILT] ?? []);
  const disabledColorModes = new Set(declared?.colorModes?.[NOT_BUILT] ?? []);
  if (disabledRepresentations.size === 0 && disabledColorModes.size === 0) return;
  // The mark says *why* this one is disabled, which `selectOptions()` needs and `disabled` cannot
  // say: two other functions disable options on these same selects for a reason that is transient
  // and belongs to the base card's representation.
  const gate = (select, unbuilt) => {
    [...(select?.options ?? [])].forEach((option) => {
      if (!unbuilt.has(option.value)) return;
      option.disabled = true;
      option.dataset.notBuilt = 'true';
    });
  };
  [representationInput, nucleicRepresentation, ligandRepresentation, ionRepresentation]
    .forEach((select) => gate(select, disabledRepresentations));
  [proteinColorMode, nucleicColorMode, ligandColorMode, ionColorMode]
    .forEach((select) => gate(select, disabledColorModes));
  refreshSwatchPickers();
}


/*
  ------------------------------------------------------------------------------------------------
  Wiring.
  ------------------------------------------------------------------------------------------------
*/

function say(message) {
  readout.innerHTML = message;
}


/**
 * What the scene could not draw, said out loud.
 *
 * The one place on the page a refusal is stated, and it is over the picture, which is where a
 * refusal about *this* picture belongs.
 */
function showNotes(notes) {
  stageNotes.show(notes.join('\n'));
}

/*
  A build the scene budget expects to be heavy, said before it starts: on the status line and over
  the picture. An empty list is the build over, and takes both back down; the next frame repaints
  the notes.
*/
let buildWarningShown = false;
function showBuildWarning(warnings) {
  if (!warnings.length) {
    if (buildWarningShown) {
      setRenderStatus('Ready to render.');
      showNotes([]);
    }
    buildWarningShown = false;
    return;
  }
  buildWarningShown = true;
  setRenderStatus('Building', warnings.join('; '));
  stageNotes.show(warnings.join('\n'));
}


fileBrowseButton.addEventListener('click', () => {
  if (!fileInput.disabled) fileInput.click();
});
fileInput.addEventListener('change', async () => {
  const [file] = fileInput.files;
  if (!file) return;
  /*
    A saved session is welcome in this picker too, and `routeFile()` is the one place that knows
    which extension belongs to which input: it hands a session to `#session-file` and answers this
    input for a structure, which is the only case this handler is the loader for. A file it refuses
    has already said so through the launcher's own `onReject`.
  */
  if (launcher.routeFile(file) !== fileInput) {
    fileInput.value = '';
    return;
  }
  const status = loadStatusSnapshot();
  setSourceControlsDisabled(true);
  setRenderActionsDisabled(true);
  structureLoading = true;
  let replacing = false;
  try {
    const read = await readUnlessDeclined(`Load ${file.name}?`, () => readStructure(file), status);
    if (!read) return;
    replacing = true;
    prepareForStructureLoad();
    await loadStructure(read);
  } catch (error) {
    // `loadStructure()` names the file before its last awaits, so a late throw leaves it named.
    if (replacing) structureFile = undefined;
    if (!structureFile) setStructureMetric(undefined);
    setLoadStatus(`Loading failed: ${error.message || error}`, true);
    setRenderStatus(
      structureFile ? 'Ready' : 'Failed',
      structureFile ? 'The previously loaded structure is unchanged.' : 'The structure was not loaded.',
      !structureFile,
    );
  } finally {
    // An input still holding the file fires no `change` when the same file is chosen again.
    fileInput.value = '';
    structureLoading = false;
    setSourceControlsDisabled(false);
    setRenderActionsDisabled(!structureFile);
    updateHistoryControls();
  }
});

function wireAccessionLoad({ form, input, validate, download, source, failure }) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (renderInFlight) return;
    let id;
    try {
      id = validate(input.value);
    } catch (error) {
      input.setAttribute('aria-invalid', 'true');
      setLoadStatus(error.message || String(error), true);
      return;
    }
    input.value = id;
    input.removeAttribute('aria-invalid');
    const status = loadStatusSnapshot();
    setRenderControlsDisabled(true);
    setRenderActionsDisabled(true);
    setLoadStatus(`Downloading ${id} from ${source}…`);
    structureLoading = true;
    // Only a file that downloads and opens lets the previous structure go.
    let replacing = false;
    try {
      const read = await readUnlessDeclined(`Load ${id}?`, async () => {
        const downloaded = await download(id);
        return readStructure(new File([downloaded.data], downloaded.filename, { type: 'chemical/x-cif' }));
      }, status);
      if (!read) return;
      replacing = true;
      prepareForStructureLoad();
      await loadStructure(read);
      downloadedStructureName = structureFile?.name;
    } catch (error) {
      if (replacing) structureFile = undefined;
      if (!structureFile) setStructureMetric(undefined);
      setLoadStatus(`${failure} load failed: ${error.message || error}`, true);
      setRenderStatus(
        structureFile ? 'Ready' : 'Failed',
        structureFile ? 'The previously loaded structure is unchanged.' : 'The structure was not loaded.',
        !structureFile,
      );
    } finally {
      structureLoading = false;
      setRenderControlsDisabled(false);
      setRenderActionsDisabled(!structureFile);
    }
  });
  input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
}

wireAccessionLoad({
  form: pdbLoadForm,
  input: pdbIdInput,
  validate: validatedPdbId,
  download: downloadPdbStructure,
  source: 'RCSB PDB',
  failure: 'PDB',
});
wireAccessionLoad({
  form: alphafoldLoadForm,
  input: alphafoldIdInput,
  validate: validatedUniProtAccession,
  download: downloadAlphaFoldStructure,
  source: 'AlphaFold DB',
  failure: 'AlphaFold DB',
});


/*
  ------------------------------------------------------------------------------------------------
  Share links.
  ------------------------------------------------------------------------------------------------

  A link is this session less its structure, which the recipient's page downloads from the database
  the filename names (`src/share-link.js`). Opening one is a session restore with a downloaded file
  in place of the embedded one, so it passes every check a session file does.
*/

const DATABASE_NAMES = { pdb: 'RCSB PDB', alphafold: 'AlphaFold DB' };

function setSessionSaveDisabled(disabled) {
  saveSessionButton.disabled = disabled;
  updateShareLinkButton(disabled);
}


function updateShareLinkButton(disabled = saveSessionButton.disabled) {
  if (!copyShareLinkButton) return;
  const source = structureFile ? structureSource(structureFile.name) : undefined;
  copyShareLinkButton.disabled = disabled || !source;
  copyShareLinkButton.title = structureFile && !source
    ? 'Only a structure opened by PDB ID or UniProt accession can be shared as a link.'
    : 'Copy a link that opens this structure with this session.';
}


function downloadFromDatabase(source) {
  return source.database === 'pdb'
    ? downloadPdbStructure(source.id)
    : downloadAlphaFoldStructure(source.id);
}


const structureDigests = new WeakMap();

async function loadedStructureDigest() {
  const file = structureFile;
  if (!structureDigests.has(file)) {
    structureDigests.set(file, structureDigest(base64ToBytes(loadedStructureBase64)));
  }
  return structureDigests.get(file);
}


async function buildShareLink() {
  const digest = await loadedStructureDigest();
  const linkDocument = createLinkDocument(await buildSessionDocument(), digest);
  // The recipient's own check, made here: a link that would be refused is never handed out.
  parseLinkDocument(jsonClone(linkDocument));
  const fragment = await encodeShareFragment(linkDocument);
  return { digest, url: `${shareLinkBase(window.location, { development: import.meta.env?.DEV })}${fragment}` };
}


async function copyShareLink() {
  const file = structureFile;
  const source = file ? structureSource(file.name) : undefined;
  if (!source || renderInFlight) return;
  let url;
  let digest;
  try {
    const built = buildShareLink();
    /*
      Handed to the clipboard as a promise, inside the click: Safari refuses a write made after an
      await, and Firefox's allowance runs out while a large structure is being hashed.
    */
    if (typeof ClipboardItem === 'function' && navigator.clipboard.write) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': built.then((link) => new Blob([link.url], { type: 'text/plain' })),
      })]);
    } else {
      await navigator.clipboard.writeText((await built).url);
    }
    ({ url, digest } = await built);
  } catch (error) {
    setLoadStatus(`No link was copied: ${error.message || error}`, true);
    return;
  }
  const local = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url)
    ? ' It names this computer, so it opens only here.'
    : '';
  setLoadStatus(`Link copied (${url.length.toLocaleString('en-US')} characters). It opens ${source.name} with this session.${local}`);
  if (file.name === downloadedStructureName) return;
  /*
    A reopened session or a local file named like an accession: whether the database still serves
    these bytes is only known by asking it, after the copy, which must happen inside the click.
  */
  try {
    const downloaded = await downloadFromDatabase(source);
    const current = await structureDigest(new TextEncoder().encode(await new Blob([downloaded.data]).text()));
    if (structureFile !== file) return;
    const same = current === digest && downloaded.filename === file.name;
    setLoadStatus(same
      ? `Link copied. ${DATABASE_NAMES[source.database]} still serves the ${source.id} file this session holds.`
      : `Link copied, but ${DATABASE_NAMES[source.database]} now serves a different ${source.id} file than this`
        + ' session holds, so the link will open with a warning that the picture may differ.', !same);
  } catch (error) {
    if (structureFile === file) {
      setLoadStatus(`Link copied, but ${DATABASE_NAMES[source.database]} could not be asked whether it still`
        + ` serves this ${source.id} file: ${error.message || error}`, true);
    }
  }
}


/*
  Read once, at page load, and only in the top frame: a page that frames this one could otherwise
  dress up what a link shows. Nothing listens for `hashchange`, so no other page can replace an open
  session by changing the fragment.
*/
async function openShareLink(fragment) {
  const status = loadStatusSnapshot();
  setRenderControlsDisabled(true);
  setRenderActionsDisabled(true);
  structureLoading = true;
  setLoadStatus('Opening a shared link…');
  try {
    const session = parseLinkDocument(await decodeShareFragment(fragment));
    const request = session.render_request;
    const source = structureSource(request.filename);
    if (!source) throw new Error('it does not name a structure from RCSB PDB or AlphaFold DB.');
    const database = DATABASE_NAMES[source.database];
    setLoadStatus(`Downloading ${source.id} from ${database} for a shared link…`);
    const downloaded = await downloadFromDatabase(source);
    const file = new File([downloaded.data], downloaded.filename, { type: 'chemical/x-cif' });
    let replaced;
    if (downloaded.filename !== request.filename) {
      // AlphaFold DB serves only a prediction's latest version, so the link's is gone.
      replaced = `AlphaFold DB has replaced this prediction (v${source.version} → `
        + `v${structureSource(downloaded.filename)?.version}) since the link was made, so the picture may differ.`;
      request.filename = downloaded.filename;
    }
    const opened = await restoreSession(session, {
      question: 'Open this shared link?',
      status,
      file,
      link: {
        name: `${source.name}, with its session`,
        warning: async (read) => {
          if (replaced) return replaced;
          const digest = await structureDigest(new TextEncoder().encode(read.text));
          return digest === session.structure_digest
            ? undefined
            : `${database} has revised ${source.id} since this link was made, so the picture may differ.`;
        },
      },
    });
    if (opened) {
      downloadedStructureName = file.name;
      // Said, because nothing else would say it before Create Image had been pressed.
      const { width, height, samples } = request.render_settings;
      const ultra = QUALITY_PROFILES.ultra;
      if (width * height * samples > ultra.width * ultra.height * ultra.samples) {
        setLoadStatus(`${loadStatus.textContent} Its Output card asks for ${width} × ${height} px at`
          + ` ${samples.toLocaleString('en-US')} samples, beyond Ultra.`, true);
      }
    }
  } catch (error) {
    setLoadStatus(`The shared link was not opened: ${error.message || error}`, true);
    setRenderStatus('Failed', 'The shared link was not opened.', true);
    // Still the first load: the screen the link stood in for.
    openingScreen.show();
  } finally {
    sessionRestoring = false;
    structureLoading = false;
    setRenderControlsDisabled(false);
    setRenderActionsDisabled(!structureFile);
  }
}

copyShareLinkButton?.addEventListener('click', () => void copyShareLink());

loadSessionButton.addEventListener('click', () => sessionFileInput.click());
sessionFileInput.addEventListener('change', async () => {
  const [file] = sessionFileInput.files;
  if (file) await loadSessionFile(file);
});
// Called straight from the click so the picker keeps its user gesture.
saveSessionButton.addEventListener('click', saveSessionAs);
newSessionButton.addEventListener('click', newSession);
/*
  `input`, like every other range in the app, so the framing changes under the drag rather than on
  release -- which is the whole reason this is a slider. The history ring's coalescing makes the
  drag one undo step, and `scheduleTraceUpdate()`'s own coalescing makes it one scene build a frame.
*/
focalLength.addEventListener('input', applyFocalLength);
// Wrapped, not passed directly: renderStructure() takes a quality override, and a bare reference
// would hand it the click event as one.
renderButton.addEventListener('click', () => renderStructure());
cancelButton.addEventListener('click', cancelRender);
colorWheel.addEventListener('input', () => setColor(colorWheel.value));
colorHex.addEventListener('input', () => {
  const color = normalizeColor(colorHex.value);
  colorHex.toggleAttribute('aria-invalid', !color);
  if (color) setColor(color);
});
proteinColorMode.addEventListener('change', updateProteinColorControl);
representationInput.addEventListener('change', () => {
  resetProteinRepresentationSettings();
  updateStyleControls();
});
cartoonTypeInput.addEventListener('change', () => {
  resetProteinRepresentationSettings();
  updateStyleControls();
});
secondaryStructureMethodInput.addEventListener('change', () => {
  updateStyleControls();
  void refreshSecondaryStructure();
});
assemblyInput.addEventListener('change', () => {
  void reloadForAssembly();
});
ribbonTypeInput.addEventListener('change', () => {
  resetProteinRepresentationSettings();
  updateStyleControls();
});
surfaceDetailInput.addEventListener('change', () => {
  resetProteinRepresentationSettings();
  updateStyleControls();
});
atomScopeInput.addEventListener('change', () => {
  resetProteinRepresentationSettings();
  updateStyleControls();
});
materialInput.addEventListener('change', updateStyleControls);
nucleicEnabled.addEventListener('change', updateStyleControls);
nucleicRepresentation.addEventListener('change', () => {
  resetNucleicRepresentationSettings();
  updateStyleControls();
});
nucleicColorMode.addEventListener('change', updateStyleControls);
nucleicMaterial.addEventListener('change', updateStyleControls);
ligandEnabled.addEventListener('change', () => {
  unchosenComponentSwitches.delete('ligands');
  updateStyleControls();
});
ligandRepresentation.addEventListener('change', () => {
  resetLigandRepresentationSettings();
  updateStyleControls();
});
ligandColorMode.addEventListener('change', updateStyleControls);
ligandMaterial.addEventListener('change', updateStyleControls);
ionEnabled.addEventListener('change', () => {
  unchosenComponentSwitches.delete('ions');
  updateStyleControls();
});
ionRepresentation.addEventListener('change', () => {
  resetIonRepresentationSettings();
  updateStyleControls();
});
ionMaterial.addEventListener('change', updateStyleControls);
ionColorMode.addEventListener('change', updateStyleControls);
/*
  The water switch reaches the Mol* panel as well as the render, which no other component toggle
  has to do: the preview draws its own water and the two must agree about whether this picture has
  water in it. It is also what makes a water clickable at the moment it becomes drawable.
*/
waterEnabled.addEventListener('change', () => {
  updateStyleControls();
  syncPreviewWaterVisibility();
});
waterMaterial.addEventListener('change', updateStyleControls);
lightingSource.addEventListener('change', updateLightingControls);
lightingAnchor.addEventListener('change', updateLightingControls);
reflectionEnvironment.addEventListener('change', updateLightingControls);
lightingStrength.addEventListener('input', updateLightingControls);
hdriElevation.addEventListener('input', updateLightingCompass);
hdriAzimuth.addEventListener('input', updateLightingCompass);
lightingCompass.addEventListener('pointerdown', beginLightingCompassDrag);
lightingCompass.addEventListener('pointermove', moveLightingCompass);
lightingCompass.addEventListener('pointerup', endLightingCompassDrag);
lightingCompass.addEventListener('pointercancel', endLightingCompassDrag);
lightingCompass.addEventListener('lostpointercapture', endLightingCompassDrag);
lightingCompass.addEventListener('keydown', rotateLightingCompassWithKeyboard);
renderQualityProfile.addEventListener('change', applyQualityProfile);
renderAspect.addEventListener('change', applyRenderAspect);
[renderWidth, renderHeight, renderSamples].forEach((control) => {
  control.addEventListener('input', markQualityProfileCustom);
});
[renderWidth, renderHeight].forEach((control) => {
  control.addEventListener('input', syncAspectFromSize);
});
ionFluorescence.addEventListener('input', () => {
  ionFluorescenceValue.value = String(Number(ionFluorescence.value));
});
proteinEmissionStrength.addEventListener('input', () => {
  proteinEmissionValue.value = String(Number(proteinEmissionStrength.value));
});
nucleicEmissionStrength.addEventListener('input', () => {
  nucleicEmissionValue.value = String(Number(nucleicEmissionStrength.value));
});
ligandEmissionStrength.addEventListener('input', () => {
  ligandEmissionValue.value = String(Number(ligandEmissionStrength.value));
});
proteinOpacity.addEventListener('input', () => updateOpacityOutput(proteinOpacity, proteinOpacityValue));
nucleicOpacity.addEventListener('input', () => updateOpacityOutput(nucleicOpacity, nucleicOpacityValue));
ligandOpacity.addEventListener('input', () => updateOpacityOutput(ligandOpacity, ligandOpacityValue));
ionOpacity.addEventListener('input', () => updateOpacityOutput(ionOpacity, ionOpacityValue));
waterOpacity.addEventListener('input', () => updateOpacityOutput(waterOpacity, waterOpacityValue));
waterEmissionStrength.addEventListener('input', () => {
  waterEmissionValue.value = String(Number(waterEmissionStrength.value));
});
depthOfFieldEnabled.addEventListener('change', updateDepthOfFieldControls);
fStop.addEventListener('input', () => {
  fStopValue.value = String(Number(fStop.value));
  syncStyleFocusPromptFStop();
});
/*
  The callout's own slider writes #f-stop and dispatches its real `input`, so the Camera card's
  readout, the dirty flag, the history coalescing and the request all follow exactly as if the
  Camera card's own slider had been dragged.
*/
styleFocusPromptFStop.addEventListener('input', () => {
  fStop.value = styleFocusPromptFStop.value;
  fStop.dispatchEvent(new Event('input', { bubbles: true }));
});
styleFocusPromptDismiss.addEventListener('click', closeStyleFocusPrompt);
styleFocusPromptMute.addEventListener('click', muteStyleFocusPrompt);


initializeColorControls();
bindColorPair(nucleicColorWheel, nucleicColorHex);
bindColorPair(ligandColorWheel, ligandColorHex);
bindColorPair(ionColorWheel, ionColorHex);
bindColorPair(waterColorWheel, waterColorHex);
bindColorPair(proteinGradientStartWheel, proteinGradientStartHex);
bindColorPair(proteinGradientEndWheel, proteinGradientEndHex);
bindColorPair(nucleicGradientStartWheel, nucleicGradientStartHex);
bindColorPair(nucleicGradientEndWheel, nucleicGradientEndHex);
bindColorPair(ligandGradientStartWheel, ligandGradientStartHex);
bindColorPair(ligandGradientEndWheel, ligandGradientEndHex);
bindColorPair(reflectionColorWheel, reflectionColorHex);
proteinGradientEditor = createGradientColorEditor({
  container: proteinGradientMidpointsElement,
  addButton: proteinGradientAddColor,
  count: proteinGradientCount,
  startHex: proteinGradientStartHex,
  endHex: proteinGradientEndHex,
  label: 'Protein gradient',
  defaultColors: COMPONENT_COLOR_DEFAULTS.protein.gradient,
});
nucleicGradientEditor = createGradientColorEditor({
  container: nucleicGradientMidpointsElement,
  addButton: nucleicGradientAddColor,
  count: nucleicGradientCount,
  startHex: nucleicGradientStartHex,
  endHex: nucleicGradientEndHex,
  label: 'Nucleic-acid gradient',
  defaultColors: COMPONENT_COLOR_DEFAULTS.nucleic.gradient,
});
ligandGradientEditor = createGradientColorEditor({
  container: ligandGradientMidpointsElement,
  addButton: ligandGradientAddColor,
  count: ligandGradientCount,
  startHex: ligandGradientStartHex,
  endHex: ligandGradientEndHex,
  label: 'Ligand gradient',
  defaultColors: COMPONENT_COLOR_DEFAULTS.ligand.gradient,
});
proteinRepresentationEditor = createRepresentationSettingsEditor(
  proteinRepresentationSettings,
  proteinRepresentationSettingsGrid,
  proteinRepresentationSettingsHelp,
  'Protein',
);
nucleicRepresentationEditor = createRepresentationSettingsEditor(
  nucleicRepresentationSettings,
  nucleicRepresentationSettingsGrid,
  nucleicRepresentationSettingsHelp,
  'Nucleic acid',
);
ligandRepresentationEditor = createRepresentationSettingsEditor(
  ligandRepresentationSettings,
  ligandRepresentationSettingsGrid,
  ligandRepresentationSettingsHelp,
  'Ligand',
);
ionRepresentationEditor = createRepresentationSettingsEditor(
  ionRepresentationSettings,
  ionRepresentationSettingsGrid,
  ionRepresentationSettingsHelp,
  'Ion',
);
waterRepresentationEditor = createRepresentationSettingsEditor(
  waterRepresentationSettings,
  waterRepresentationSettingsGrid,
  waterRepresentationSettingsHelp,
  'Water',
);
setSelectValue(cartoonTypeInput, DEFAULT_CARTOON_TYPE, 'Default protein cartoon type');
resetProteinRepresentationSettings(undefined, false);
resetNucleicRepresentationSettings(undefined, false);
resetLigandRepresentationSettings(undefined, false);
resetIonRepresentationSettings(undefined, false);
resetWaterRepresentationSettings(undefined, false);
updateOpacityOutput(proteinOpacity, proteinOpacityValue);
updateOpacityOutput(nucleicOpacity, nucleicOpacityValue);
updateOpacityOutput(ligandOpacity, ligandOpacityValue);
updateOpacityOutput(ionOpacity, ionOpacityValue);
updateOpacityOutput(waterOpacity, waterOpacityValue);
initSwatchPickers();
initRailCards(document.querySelector('.rail'));
updateStyleControls();
updateSelectionPanelState();
updateDepthOfFieldControls();
syncFocalLengthReadout();

/*
  Any change to any control puts the chosen file behind, and is a step the user can come back from.
  Listening on the shell in the capture phase catches controls that stop propagation, and covers
  controls added by later passes without anyone having to remember these lines.

  The three listeners differ in when they act, not in what they hear. Marking the session dirty is
  true the moment the event fires; a history entry is the state *after* this file's own handlers
  have run, so `recordHistory()` only arms the coalescing window; and the trace follows on the next
  frame, which is what makes a control edit visible in the picture rather than only in the request.
*/
['change', 'input'].forEach((type) => {
  const shell = document.querySelector('.app-shell');
  shell.addEventListener(type, markSessionDirty, true);
  shell.addEventListener(type, (event) => {
    recordHistory(event.target?.id || type);
    scheduleTraceUpdate();
  }, true);
});

/*
  ------------------------------------------------------------------------------------------------
  The stage, and what leaves it as a file.
  ------------------------------------------------------------------------------------------------

  `src/stage-modes.js` owns Preview / Result / Compare, the tray, the pins, the backdrop and Improve
  image, and it talks to this file through document events in both directions. The stage needs
  exactly two things this file has and it does not: the structure bytes a settings file must embed,
  and the renderer a live picture is read off. What comes back the other way is `markSaved()`.
*/

const BACKDROP_FILLS = { white: '#ffffff', black: '#000000' };

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('the canvas could not be read.'))),
      'image/png',
    );
  });
}


/*
  Composite a transparent picture onto the matte it was being looked at against.

  The Alpha backdrop paints nothing, so the render's own transparency survives: **alpha is coverage**,
  all the way to the file. White and Black are baked in, so a downloaded PNG matches what the stage
  showed rather than always carrying transparency regardless of backdrop.
*/
async function pictureOnBackdrop(blob, backdrop) {
  if (!backdrop || !BACKDROP_FILLS[backdrop]) return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  context.fillStyle = BACKDROP_FILLS[backdrop];
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  return canvasToBlob(canvas);
}


// The PNG says which release made it; the TIFF master carries the same in its Software tag.
function signedPng(blob) {
  return withPngText(blob, { Software: APP_SIGNATURE });
}


async function saveRenderImage({ id, label, url, backdrop }) {
  if (!url) return;
  const filename = `${sessionFilename(structureFile?.name, label).replace(/\.[^.]+$/, '')}.png`;
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`the render could not be read back (${response.status}).`);
    triggerDownload(await signedPng(await pictureOnBackdrop(await response.blob(), backdrop)), filename);
    stage?.markSaved(id, 'image');
    setLoadStatus(`${label} saved as ${filename}.`);
  } catch (error) {
    setLoadStatus(`Could not save ${label}: ${error.message || error}`, true);
  }
}


/*
  The live trace, kept exactly as it stands -- `renderStructure()` minus the render.

  *The picture on screen at any moment is the picture the download gives you*, and this is where that
  promise is kept. `capture()` takes a turn on the shared renderer (`src/render-lock.js`) and reads
  the accumulator back, so what lands is the frame the user is looking at, at the size it is on
  screen -- including, deliberately, the interactive resolution if the stage is still moving. It
  goes to the tray rather than to disk, so the same picture can be compared, applied and downloaded
  like every other render.

  **It announces `foldray:render-complete` rather than a second event, and that is the whole design.**
  One event means one `addRender()`, one object URL made by `imageUrlFrom()` and revoked by
  `disposeEntryImages()`, and one Apply -- so a kept trace is a tray entry in every way a rendered
  one is, with nothing downstream needing to know which it was.

  Two things it does **not** do. It does not composite the backdrop: a matte is what a *file* is
  looked at on, and this picture is going to the stage, which paints the same three behind every
  render. And it does not take `renderInFlight`: this is not a render and claims nothing -- but it
  refuses while one is running, because the settings it captures are the ones on screen and a
  render in flight is about to put a different picture up beside them.

  The **achieved sample count travels with the picture**, in the snapshot exactly where a finished
  render puts it: a render you can download is a render whose convergence you can state.
*/
async function quickImageFromLiveTrace() {
  if (!liveTrace || !structureFile) return;
  if (renderInFlight) {
    setRenderStatus('Rendering', 'Wait for the render to finish before keeping the live trace.', true);
    return;
  }
  try {
    setRenderStatus('Keeping', 'Reading the trace back off the renderer…');
    /*
      Captured before the read-back, for the reason `renderStructure()` gives: the controls stay
      live, so reading them afterwards could record settings that did not produce the picture.
    */
    const settings = tabSnapshot(
      // `embedStructure: false` because a snapshot never keeps the bytes -- `createRenderSnapshot()`
      // strips them and `validateRenderSnapshot()` refuses one that still carries them -- and this
      // is the only request builder here whose product is a snapshot and nothing else. Up to 64 MB
      // of base64 per press, for a field that is discarded on the next line.
      buildRenderRequest(structureFile, undefined, { embedStructure: false }),
      editorStatePayload(),
    );
    const picture = await liveTrace.capture();
    document.dispatchEvent(new CustomEvent('foldray:render-complete', {
      detail: {
        blob: picture.blob,
        settings: { ...settings, samples: picture.samples },
        meta: { adapter: picture.adapter, samples: picture.samples },
      },
    }));
    setRenderStatus('Kept', `The live trace was kept at ${picture.samples} samples.`);
  } catch (error) {
    setRenderStatus('Failed', error.message || String(error), true);
  }
}


/*
  The comparison, written the way it is shown.

  Compare puts two transparent RGBA pictures on the stage in one of three arrangements, and this
  reproduces the arrangement rather than the screen: the canvas is sized from the pictures, so a
  1024px pair downloads at 1024px whatever the stage happens to measure.

  Each image is placed the way `object-fit: contain` with `max-width/max-height: 100%` places it on
  screen: centred in its half, scaled down to fit and never scaled up. A 512px draft compared with a
  1024px render is therefore smaller in the file exactly as it is smaller on the stage.
*/
async function loadRenderBitmap(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`a render could not be read back (${response.status}).`);
  return createImageBitmap(await response.blob());
}


function drawContained(context, bitmap, x, y, width, height) {
  const scale = Math.min(1, width / bitmap.width, height / bitmap.height);
  const drawWidth = bitmap.width * scale;
  const drawHeight = bitmap.height * scale;
  context.drawImage(
    bitmap,
    x + (width - drawWidth) / 2,
    y + (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}


function composeComparison(layout, wipe, backdrop, bitmapA, bitmapB) {
  const paneWidth = Math.max(bitmapA.width, bitmapB.width);
  const paneHeight = Math.max(bitmapA.height, bitmapB.height);
  const canvas = document.createElement('canvas');
  canvas.width = layout === 'split' ? paneWidth * 2 : paneWidth;
  canvas.height = paneHeight;
  const context = canvas.getContext('2d');

  if (backdrop && BACKDROP_FILLS[backdrop]) {
    context.fillStyle = BACKDROP_FILLS[backdrop];
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  if (layout === 'split') {
    drawContained(context, bitmapA, 0, 0, paneWidth, paneHeight);
    drawContained(context, bitmapB, paneWidth, 0, paneWidth, paneHeight);
    return canvas;
  }
  if (layout === 'overlay') {
    drawContained(context, bitmapA, 0, 0, paneWidth, paneHeight);
    drawContained(context, bitmapB, 0, 0, paneWidth, paneHeight);
    return canvas;
  }

  /*
    Wipe. Each side is clipped to its own half before it is drawn, for the reason the stylesheet
    gives: an unclipped B under a transparent A shows through it everywhere, which is the
    combination Overlay is now for. The divider is drawn as the same 85% white the CSS line uses,
    scaled so it reads at the file's resolution rather than at the stage's -- and the grab handle is
    not drawn at all, because it is a control, not part of the picture.
  */
  const cut = Math.round((Math.min(100, Math.max(0, wipe)) / 100) * paneWidth);
  const half = (x, width) => {
    context.save();
    context.beginPath();
    context.rect(x, 0, width, paneHeight);
    context.clip();
    return () => context.restore();
  };
  const doneA = half(0, cut);
  drawContained(context, bitmapA, 0, 0, paneWidth, paneHeight);
  doneA();
  const doneB = half(cut, paneWidth - cut);
  drawContained(context, bitmapB, 0, 0, paneWidth, paneHeight);
  doneB();
  const rule = Math.max(2, Math.round(paneWidth / 512));
  // Written in the legacy comma form on purpose: this string is parsed by the canvas, not by CSS.
  context.fillStyle = 'rgba(255, 255, 255, 0.85)';
  context.fillRect(cut - rule / 2, 0, rule, paneHeight);
  return canvas;
}


async function saveCompareImage({ layout, wipe, backdrop, a, b }) {
  if (!a?.url || !b?.url) return;
  const name = `${a.label} vs ${b.label} ${layout}`;
  const filename = `${sessionFilename(structureFile?.name, name).replace(/\.[^.]+$/, '')}.png`;
  try {
    const [bitmapA, bitmapB] = await Promise.all([
      loadRenderBitmap(a.url),
      loadRenderBitmap(b.url),
    ]);
    const blob = await canvasToBlob(composeComparison(layout, wipe, backdrop, bitmapA, bitmapB));
    triggerDownload(await signedPng(blob), filename);
    setLoadStatus(`${a.label} against ${b.label} saved as ${filename}.`);
  } catch (error) {
    setLoadStatus(`Could not save the comparison: ${error.message || error}`, true);
  }
}


async function saveRenderSettings({ id, label, settings, postProcessing }) {
  if (!settings || !structureFile) return;
  const filename = sessionFilename(structureFile.name, label);
  try {
    /*
      The structure is re-attached here, as the text the load parsed and Save As embeds -- a re-read
      of the file differs wherever `file.text()` replaced a byte. That is what makes a snapshot's
      download a session this app can load back, and it is the trade the strip is built on: one copy
      of the bytes in the tab, not one per remembered render.
    */
    const sessionDocument = createSessionDocument(
      {
        ...settings.render_request,
        structure_base64: loadedStructureBase64,
      },
      settings.editor_state,
      settings.rendered_at,
      postProcessing,
    );
    triggerDownload(
      new Blob([`${JSON.stringify(sessionDocument, null, 2)}\n`], { type: 'application/json' }),
      filename,
    );
    stage?.markSaved(id, 'settings');
    setLoadStatus(`${label} settings saved as ${filename}.`);
  } catch (error) {
    setLoadStatus(`Could not save ${label} settings: ${error.message || error}`, true);
  }
}


/*
  Apply: the exact settings that produced a picture in the tray, put back on the controls.

  It goes through `restoreSessionSettings()` -- the single path a session load and a history step
  already use -- rather than a second writer of its own, so a control added there is applied without
  anyone having to remember this function exists.
*/
async function restoreRenderSnapshot({ label, settings }) {
  if (!structureFile || renderInFlight || structureLoading || !settings) return false;
  if (interactionMode === 'focus') finishFocusPicking('inspect');
  setRenderControlsDisabled(true);
  // A capture armed just before this click would otherwise close mid-restore and remember half a
  // snapshot; pausing discards it, and the commit below records the settled result instead.
  history.pause();
  // The same flag a session load sets, for the same reason: writing every control would otherwise
  // register as dozens of separate user edits.
  sessionRestoring = true;
  let restoreError;
  try {
    await restoreSessionSettings(settings.render_request, settings.editor_state, { unchosen: settings.unchosen_switches });
    // A snapshot carries no post_processing, so this only disarms a pending Improve image.
    stage?.restorePostProcessing(undefined);
    // After the controls, not before: restoring them fires the change events that clear the Style.
    styles?.setActive(settings.editor_state.style_id);
  } catch (error) {
    restoreError = error;
  } finally {
    sessionRestoring = false;
    history.resume();
    setRenderControlsDisabled(false);
    markSessionDirty();
    // Loading an archived render's settings is a state change like any other, so it is a place the
    // user can step back to and from.
    await history.commit();
  }
  // Announced only after the history commit: otherwise a quick next edit can interleave with the
  // still-running restore even though the interface already says it is safe to continue.
  if (restoreError) {
    setLoadStatus(`Could not load ${label}: ${restoreError.message || restoreError}`, true);
    return false;
  }
  scheduleTraceUpdate();
  // Two sentences, because there may be no trace to follow anything: the update is a retarget of
  // one that is running and starts none. Saying "the trace is following them" to
  // somebody who has not been to Result yet is a status line describing a picture that is not there.
  setLoadStatus(liveTrace
    ? `Settings from ${label} loaded. The trace is following them.`
    : `Settings from ${label} loaded. Live will trace them.`);
  setRenderStatus('Ready', `The settings that produced ${label} are loaded.`);
  return true;
}


historyUndoButton.addEventListener('click', () => stepHistory('undo'));
historyRedoButton.addEventListener('click', () => stepHistory('redo'));
historySettingsUndoButton.addEventListener('click', () => stepHistory('undo', { camera: false }));
historySettingsRedoButton.addEventListener('click', () => stepHistory('redo', { camera: false }));

fileMenu.addEventListener('toggle', () => {
  if (fileMenu.open) announceOverlayOpen('file');
});
coordinateOverlay({
  owner: 'file',
  contains: (target) => fileMenu.contains(target),
  isOpen: () => fileMenu.open,
  close: () => { fileMenu.open = false; },
});

/*
  Ctrl+Z inside a text field belongs to the browser. `#color-hex`, `#pdb-id` and every numeric input
  are real text entry, and rewinding the whole composition when someone meant to take back a
  keystroke would be a bug. Ranges, colour wheels and checkboxes are not text entry and have no
  native undo of their own, so they do not.
*/
const TEXT_ENTRY_INPUT_TYPES = new Set([
  'text', 'search', 'url', 'tel', 'email', 'password', 'number',
]);

function isTextEntry(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === 'TEXTAREA') return true;
  if (target.tagName !== 'INPUT') return false;
  return TEXT_ENTRY_INPUT_TYPES.has((target.type || 'text').toLowerCase());
}

document.addEventListener('keydown', (event) => {
  if (!event.ctrlKey && !event.metaKey) return;
  const key = event.key?.toLowerCase();
  if (key !== 'z' && key !== 'y') return;
  if (isTextEntry(event.target)) return;
  event.preventDefault();
  // Ctrl+Y and Ctrl+Shift+Z are the two spellings of redo people arrive with; Alt is free in both
  // the browser and this app, so it is what asks for the settings-only step.
  if (key === 'y' || event.shiftKey) stepHistory('redo', { camera: !event.altKey });
  else stepHistory('undo', { camera: !event.altKey });
});

const launcher = initLauncher({
  onReject: (message) => setLoadStatus(message, true),
  isBusy: () => renderInFlight || fileInput.disabled,
});

function warnBeforeUnload(event) {
  // A render in flight is not in the tray yet, and may be hours of tracing.
  if (!renderInFlight && !sessionLifecycle.hasUnsavedEdits() && !stage?.unsavedRenderCount()) return;
  event.preventDefault();
  // Chrome ignores the string and shows its own wording, but returnValue is still what arms it.
  event.returnValue = '';
}
window.addEventListener('beforeunload', warnBeforeUnload);

renderSessionState(sessionLifecycle.snapshot());

/*
  The source controls open here rather than after a viewer initialises, because there is no viewer
  to wait for: `src/structure.js` parses in this process. `scaffoldingPage()` closes them again if
  this browser cannot trace at all -- **tell someone they cannot render before they have invested
  ten minutes**, rather than offering a file picker to a page that will refuse the picture.
*/
setSourceControlsDisabled(false);
setLoadStatus('Enter a PDB ID or a UniProt accession, or choose a local .cif or .pdb file.');
setRenderStatus('Load a structure to begin.');


/*
  ------------------------------------------------------------------------------------------------
  The scaffolding page, which is a harness's page rather than the studio's.
  ------------------------------------------------------------------------------------------------

  Everything below is kept **byte for byte in behaviour**, because recorded renders depend on it. A
  URL carrying `?structure=` (or any of the other `SCAFFOLDING_PARAMETERS`) loads one shipped sample
  and traces one pinned request; `window.foldRay` is the surface a headless driver reads it through.

  It is deliberately **not** the studio's subject. `structureFile` stays undefined, so the Render
  button, Save As and the history are in their "nothing loaded" state and no control edit rebuilds
  this picture -- which is what keeps a recorded render from depending on a control's authored
  default.
  Loading a structure through the File menu stops this loop for good (`stopScaffoldingTrace()`) and
  hands the canvas to `createLiveTrace()`. The handover is one-way and the two never run together.
*/
const SAMPLES = {
  '3RGK': { url: '/samples/3RGK.cif', filename: '3RGK.cif' },
  '1BNA': { url: '/samples/1BNA.cif', filename: '1BNA.cif' },
  // Ours, and the only structure here that is not a deposited one: two ideal antiparallel strands,
  // so the beta arrow can be looked at without fetching a megabyte.
  BETA: { url: '/samples/beta-sheet.cif', filename: 'beta-sheet.cif' },
  // Ours too: neither deposited sample here has a monoatomic ion in it, so the marker looks would
  // have nothing to be pointed at.
  IONS: { url: '/samples/ions.cif', filename: 'ions.cif' },
  // Ours, and the third instance of the same argument: a ten-residue RNA carrying `5MC` and `1MA`,
  // which is the only unconditional exercise of the component router here. Generated, not
  // hand-edited.
  MODRNA: { url: '/samples/modified-rna.cif', filename: 'modified-rna.cif' },
};
const DEFAULT_SAMPLE = '3RGK';
/*
  What makes a URL this page: every parameter `chosen()` and `targetSize()` read, plus `scaffold`,
  which a driver can send and nothing parses. Any other query -- `?fbclid=`, `?utm_source=` on a
  shared link -- is the studio, or it opens on an endless trace of 3RGK nobody asked for.
*/
const SCAFFOLDING_PARAMETERS = [
  'scaffold', 'structure', 'representation', 'nucleic', 'ligand', 'ion', 'water', 'material',
  'ion_material', 'reflection', 'hide_ions', 'view_transform', 'color', 'nucleic_color', 'width',
  'height',
];

function chosen() {
  const query = new URLSearchParams(window.location.search);
  const sample = (query.get('structure') ?? DEFAULT_SAMPLE).toUpperCase();
  if (!SAMPLES[sample]) {
    throw new Error(
      `${quotedValue(sample)} is not one of the structures this page ships.`
      + ` Choose one of: ${Object.keys(SAMPLES).join(', ')}.`,
    );
  }
  return {
    sample: SAMPLES[sample],
    protein: representationOr(query.get('representation'), 'ball_and_stick'),
    nucleic: representationOr(query.get('nucleic'), 'nucleic_ball_and_stick'),
    ligand: representationOr(query.get('ligand'), 'ligand_ball_and_stick'),
    ion: representationOr(query.get('ion'), 'ion_spheres'),
    /*
      Water, and it is **off unless the query names a look** -- `water=` is what turns the component
      on, so a URL that does not name it renders exactly what it rendered before water existed.
    */
    water: query.get('water') ? representationOr(query.get('water'), 'water_dots') : undefined,
    material: materialOr(query.get('material')),
    /*
      The ion component's material, separately, and **nullable for the same reason `color` is**:
      absent, it is `'glossy'`, so every existing URL and every recorded hash is untouched.

      It exists because `ions.cif` is the only thing this page can draw that is **nine separated
      spheres** -- 9 A apart, one per element -- and a material whose authored graph varies across a
      *single* surface has nowhere else to be measured. `translucent_context`'s view-angle opacity
      ramp is the case: on a protein every atom overlaps its neighbours, so a ray crosses an unknown
      number of surfaces and the alpha at any pixel says nothing about the ramp. On one ion it
      crosses exactly two, and `1 - (1 - a)^2` is checkable against a reference render of the same
      material.
    */
    ionMaterial: materialOr(query.get('ion_material')),
    /*
      The reflection environment, checked against `capabilities.js` and refused by name rather than
      passed through -- the same rule `?representation=` and `?color=` follow.

      `source` is the default and is what every existing URL and every recorded hash was taken
      through. It exists because `studio` and `grid` are otherwise reachable only by hand through
      the Lighting card, and **a control that no harness can ask for is a control the next change
      breaks silently**.
    */
    reflection: reflectionEnvironmentOr(query.get('reflection')),
    /*
      Whether the ligand component drops its polyatomic ions, and it is here for the reason the two
      parameters above it are: **a hash gate cannot see a control it never sets.**

      `ligand_style.hide_polyatomic_ions` is a filter over which residues a component has, and the
      only structure on this page with anything for it to remove is 3RGK -- one heme and three
      sulfates. With no parameter nothing could ask for it, and the day it stopped filtering every
      run would still be clean. `=== '1'` rather than a truthy test so a typo is `false` rather than
      a picture nobody asked for; absent is `false`, which is what every recorded hash was taken
      through.
    */
    hideIons: query.get('hide_ions') === '1',
    /*
      The display transform, checked against `capabilities.js` the same way, and defaulting to the
      product's own so a bare URL renders what the studio renders.

      It exists because a transform that is not the default otherwise has **no case at all** --
      `filmic` ships 464 KB of LUTs and would be exercised by nothing. Same hole `?reflection=`
      closes one control over: a declared list with no way to ask for most of it.
    */
    viewTransform: viewTransformOr(query.get('view_transform')),
    // Deliberately nullable rather than defaulted: absent, the representation still decides, which
    // keeps every existing URL and every existing shot byte-identical.
    color: colorModeOr(query.get('color')),
    /*
      Colour for the nucleic component, separately, and **only** the nucleic component. The three
      nucleic modes are the ones no other component can express, so they need somewhere else to
      land. Without it, three named colour modes pin the same picture.
    */
    nucleicColor: colorModeOr(query.get('nucleic_color')),
  };
}

/*
  A material id, refused by name rather than passed through.

  A parameter that took whatever it was given would hit the failure every other `*Or()` here exists
  to stop: `loadMaterial()` warns about an id it has no template for and falls through to the
  **generic fallback**, so a typo renders a mid-rough dielectric that looks like a shading bug
  rather than like a misspelling -- and a recorded baseline for a material nobody rendered.

  `catalog/materials.js` is the list and anything accepting a material id must **equal** it rather
  than merely contain it, so this reads `MATERIAL_CATALOG.order` and never a second table. `glossy`
  is the default both parameters always had, so no recorded hash moves.
*/
function materialOr(requested) {
  if (!requested) return 'glossy';
  if (!MATERIAL_CATALOG.order.includes(requested)) {
    throw new Error(
      `${quotedValue(requested)} is not a material this product offers.`
      + ` \`catalog/materials.js\` is the list: ${MATERIAL_CATALOG.order.join(', ')}.`,
    );
  }
  return requested;
}

function viewTransformOr(requested) {
  if (!requested) return DEFAULT_VIEW_TRANSFORM;
  const offered = capabilities().viewTransforms;
  if (!offered.includes(requested)) {
    throw new Error(
      `${quotedValue(requested)} is not a view transform this renderer applies.`
      + ` \`capabilities.js\` is the list: ${offered.join(', ')}.`,
    );
  }
  return requested;
}

function reflectionEnvironmentOr(requested) {
  if (!requested) return 'source';
  const offered = capabilities().reflectionEnvironments;
  if (!offered.includes(requested)) {
    throw new Error(
      `${quotedValue(requested)} is not a reflection environment this renderer declares.`
      + ` \`capabilities.js\` is the list: ${offered.join(', ')}.`,
    );
  }
  return requested;
}

function colorModeOr(requested) {
  if (!requested) return null;
  if (!(requested in COLOR_MODES)) {
    throw new Error(
      `${quotedValue(requested)} is not a colour mode this renderer declares.`
      + ' `capabilities.js` is the list, and it has no row for that id.',
    );
  }
  return requested;
}

function representationOr(requested, fallback) {
  if (!requested) return fallback;
  if (!(requested in REPRESENTATIONS)) {
    throw new Error(
      `${quotedValue(requested)} is not a representation this renderer declares.`
      + ' `capabilities.js` is the list, and it has no row for that id.',
    );
  }
  return requested;
}

/** Whether an id is drawn by the polymer sweep, asked of the one table rather than of a list. */
function representationIsSweep(id) {
  return REPRESENTATIONS[id]?.family === 'sweep';
}

function baseRequest(structureBase64, choice) {
  return {
    filename: choice.sample.filename,
    structure_base64: structureBase64,
    representation: choice.protein,
    material: choice.material,
    // A cartoon has one colour per residue read at its alpha carbon, so `element` would paint every
    // ribbon carbon grey. The sweep looks are coloured by chain, which is what a cartoon is for.
    color_mode: choice.color ?? (representationIsSweep(choice.protein) ? 'chain' : 'element'),
    color: COMPONENT_COLOR_DEFAULTS.protein.uniform,
    opacity: 1,
    secondary_structure: { method: 'auto' },
    nucleic_style: {
      enabled: true, representation: choice.nucleic, material: 'glossy',
      color_mode: choice.nucleicColor ?? 'chain', color: COMPONENT_COLOR_DEFAULTS.nucleic.uniform,
    },
    ligand_style: {
      enabled: true, representation: choice.ligand, material: 'glossy',
      color_mode: 'element', color: COMPONENT_COLOR_DEFAULTS.ligand.uniform,
      hide_polyatomic_ions: choice.hideIons,
    },
    ion_style: {
      enabled: true, representation: choice.ion, material: choice.ionMaterial,
      color_mode: 'element', color: COMPONENT_COLOR_DEFAULTS.ion.uniform,
    },
    water_style: {
      enabled: choice.water !== undefined,
      representation: choice.water ?? 'water_dots',
      material: 'glossy',
      // Uniform, like the card: water has one colour mode, and a solid that stands for a molecule
      // has no element to be coloured by.
      color_mode: 'uniform',
      color: COMPONENT_COLOR_DEFAULTS.water.uniform,
    },
    lighting_setup: {
      source: 'autumn_meadow', strength: 1, anchor: 'world', elevation: 0, azimuth: 0,
      reflection_environment: choice.reflection,
      // Only read when the environment is `color`, and stated rather than defaulted so a URL that
      // names one renders a fixed picture instead of `resolveLighting()`'s fallback.
      reflection_color: '#182533',
    },
  };
}

/*
  The scaffolding page's framing: `frameStructureCamera()`'s orbit, but **not** its numbers.

  Its numbers are the pinned ones -- 40 degrees, 1.15 of the bounding radius with no 1 Å floor, no
  camera schema fields -- because every recorded hash was taken through them. The studio's camera
  reads the lens off the Camera card; this one cannot, because no control on the page is bound to
  this picture.
*/
function frameStructure(residues, verticalFovDegrees = 40) {
  const { centre, position } = orbitFrame(residues, verticalFovDegrees, (radius) => radius * 1.15);
  return {
    mode: 'perspective',
    position,
    target: centre,
    up: [0, 0, 1],
    vertical_fov_degrees: verticalFovDegrees,
  };
}

/**
 * Why this browser cannot trace, or `null` if it can.
 *
 * Two causes look identical from `navigator.gpu` and need different advice, so they are separated
 * before anything else runs: **tell someone they cannot render before they have invested ten
 * minutes**, and do not blame the browser for what is the origin's fault.
 */
function refusal() {
  if (navigator.gpu) return null;
  if (!window.isSecureContext) {
    return {
      title: 'This page is not on a secure origin',
      detail: `WebGPU is only available in a secure context, so \`navigator.gpu\` is missing here even `
        + `in a browser that supports it. This page was served from ${window.location.origin}. Open `
        + `it over HTTPS.`,
    };
  }
  return {
    title: 'This browser has no WebGPU',
    detail: 'Chrome or Edge 113+ on Windows or macOS, Safari 26 on macOS 26, or Firefox 141+ on '
      + 'Windows (147+ on an Apple-silicon Mac) works; FoldRay is tested in Chrome on Windows. On '
      + 'Linux, support depends on the browser and the GPU. Nothing on this page will render until '
      + 'then.',
  };
}

/*
  The render target.

  With neither `?width=` nor `?height=` given the target is square, clamped to [256, 1024] and
  rounded to a multiple of 64, which is the path every recorded render takes.
*/
function targetSize() {
  const query = new URLSearchParams(window.location.search);
  const asked = (name) => {
    const raw = query.get(name);
    if (raw === null) return null;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 16 || value > 4096) {
      throw new Error(`${quotedValue(raw)} is not a whole number of ${name} pixels between 16 and 4096.`);
    }
    return value;
  };
  const width = asked('width');
  const height = asked('height');
  if (width !== null || height !== null) {
    const given = width ?? height;
    // `pinned` is what stops the resize observer from taking the target back: a driven page and a
    // looked-at page want opposite things from a box that moves.
    return { width: width ?? given, height: height ?? given, pinned: true };
  }
  const box = canvas.getBoundingClientRect();
  const css = Math.max(256, Math.min(1024, Math.round(box.width || 768)));
  const square = Math.max(256, Math.round(css / 64) * 64);
  return { width: square, height: square, pinned: false };
}

/*
  Set by `renderExactly()` and read by the animation loop and the resize observer.

  A byte-identity render needs a counted number of samples, and **this page's loop has no stop
  condition of its own**: it runs until it is paused. The driver pauses it rather than the loop
  learning to stop, so nothing about what the page traces depends on who is watching.
*/
let paused = false;

/*
  Set when the responsive stage is wired up; called by `renderExactly()`.

  A driven page and a looked-at page want opposite things from a box that moves, and `paused` alone
  is a guard rather than a decision. Disconnecting says the thing plainly: while a driver holds the
  renderer, nothing else may size it.
*/
let stopFollowingTheBox = () => {};

/** Set when a structure is loaded through the shell: the scaffolding loop stops for good. */
let scaffoldingHandedOver = false;

function stopScaffoldingTrace() {
  scaffoldingHandedOver = true;
  stopFollowingTheBox();
}

async function scaffoldingPage({ trace = true } = {}) {
  const refused = refusal();
  if (refused) {
    unsupported.hidden = false;
    unsupportedTitle.textContent = refused.title;
    unsupportedDetail.textContent = refused.detail;
    setSourceControlsDisabled(true);
    // The band leaves with a dismissed opening screen and `#readout` is hidden in Preview.
    setLoadStatus(`${refused.title}. ${refused.detail}`, true);
    say('Not tracing.');
    return;
  }

  /*
    **The tracer comes from the seam, not from `Renderer.create()` directly.** `Renderer.create()`
    calls `canvas.getContext('webgpu')` and `configure()`s it, so a second one on this canvas takes
    the context away from the first -- and `ready()` is what lets the live trace and a download be
    the same picture. `ready()` loads the LUTs as part of being ready.
  */
  say('Asking for a WebGPU adapter…');
  const renderer = await ready(canvas).catch((error) => {
    /*
      **The one startup failure that means the page cannot render at all, said where a refusal
      belongs.** `refusal()` above answers *is there a WebGPU API here*; this answers *is there a
      GPU behind it*, which is a different question with the same consequence and no synchronous
      answer -- `requestAdapter()` can return null in a browser whose `navigator.gpu` is present:
      graphics acceleration switched off, a remote session, a Linux browser with no driver under it.

      It is written into the **same band** the opening screen carries beside the accession box, for
      the same reason: tell someone they cannot render before they have invested ten minutes.
      Nothing renders until Live, so without this the first thing to ask for an adapter would be
      whichever button the user pressed after picking a protein -- exactly ten minutes too late.

      **The source controls are left enabled, unlike `refusal()`'s two cases**, and the difference is
      real rather than an oversight: a browser with no WebGPU will not render here whatever anyone
      does, while a missing adapter is usually a setting or a driver. The Mol* preview is WebGL and
      still works, so a structure is still worth opening -- and `ready()` caches its rejection for
      the life of the page, so the detail says to reload rather than to try again.
    */
    unsupported.hidden = false;
    if (error.assetFailure) {
      unsupportedTitle.textContent = 'The renderer could not finish loading';
      unsupportedDetail.textContent = `${error.message}. Check the connection, then reload the page. `
        + `The preview does not need it and still works.`;
      throw error;
    }
    unsupportedTitle.textContent = 'No GPU is available to this browser';
    unsupportedDetail.textContent = `${error.message}. WebGPU is present in this browser but no adapter `
      + `came back, so nothing here can be traced. Check that graphics acceleration is on (chrome://gpu `
      + `in Chrome or Edge, about:support in Firefox) then reload the page. The preview does not need `
      + `WebGPU and still works.`;
    throw error;
  });

  /*
    **The studio's own entry stops here.**

    Everything above is the WebGPU refusal and the adapter, which every load owes the user however
    it arrived -- tell someone they cannot render before they have invested ten minutes, in the band
    the opening screen carries. Everything below is a *picture*: one shipped sample fetched, parsed,
    framed, built into a scene, and then an endless accumulator on it.

    On a URL carrying scaffolding parameters that is exactly right: the page has been told which
    picture to make. On a bare URL it would be **the studio**, with the opening screen open on top
    of it -- 3RGK fetched and traced, plus a 1.59 MB environment map, before the user had asked for
    anything at all. `trace: false` is the studio saying so, and it is the same condition
    `openingScreen.show()` reads, passed in rather than asked twice.
  */
  if (!trace) {
    // The pill is a count from here on, never a sentence: nothing has been traced, and the size is
    // the stage's own. `#readout` is hidden in Preview, so the first time this is read is Live.
    sayZeroSamples();
    return;
  }

  const choice = chosen();
  say(`Reading ${choice.sample.filename}…`);
  const response = await fetch(choice.sample.url);
  if (!response.ok) throw new Error(`${choice.sample.url} could not be fetched (${response.status})`);
  const request = baseRequest(toBase64(new Uint8Array(await response.arrayBuffer())), choice);

  say('Building the structure…');
  const {
    sceneInputsFromRequest, buildScene, lightingScene, resolveCamera, resolveLighting,
  } = await ensureScenePipeline();
  const inputs = await sceneInputsFromRequest(request);
  // The camera needs the atoms, so framing happens after the parse and before the scene is built.
  request.camera = frameStructure(inputs.residues);

  say('Building the scene…');
  const scene = await buildScene(inputs);

  const environment = lightingScene(request);
  say('Loading the environment…');
  await renderer.loadEnvironment(assetUrl(environmentImagePath(environment)));
  renderer.environmentScene = environment;
  const worldDump = await (await fetch(assetUrl(`env/${environment}.json`))).json();

  if (scaffoldingHandedOver) return;
  await renderer.setScene(scene);
  /*
    Checked again, because `setScene()` is an await and the handover can land inside it. Everything
    below writes the *shared* renderer -- the camera, the size, the backdrop -- so a scaffolding run
    that carried on past a handover would leave the live trace sampling this sample's scene at this
    sample's size, converging perfectly on a structure the user did not open.
  */
  if (scaffoldingHandedOver) return;
  renderer.setCamera(resolveCamera(request), resolveLighting(request, worldDump, environment), 8);
  renderer.denoiseMode = 'auto';
  // Composite onto black for the canvas (a `premultiplied` context). The picture the product hands
  // over is straight RGBA on backdrop 0; `readPixels()` below reads that one.
  renderer.backdrop = 2;
  renderer.viewTransform = choice.viewTransform;
  const target = targetSize();
  renderer.resize(target.width, target.height);
  /*
    **The stage is responsive, and the trace follows it.** The ladder is resolution and sample count,
    never a second renderer, and the two constants are `render-backend.js`'s so the page and the
    live-trace session schedule the same way. **A pinned size is left alone**: `?width=`/`?height=`
    and the byte-identity driver need a target that does not move under them.
  */
  if (!target.pinned && typeof ResizeObserver === 'function') {
    let settling = 0;
    let interacting = false;
    const applySize = () => {
      /*
        **Both the observer and its settle timer check `paused`, and the timer is the one that
        matters.** `renderer.resize()` allocates a fresh accumulator, so a resize landing in the
        middle of a counted run discards the samples already taken. Guarding only the observer
        callback is not enough: the initial observation fires at load and schedules a settle
        `SETTLE_MS` later, which is squarely inside the window a driver's first run begins in.
      */
      if (paused) return;
      const box = canvas.getBoundingClientRect();
      const scale = interacting ? INTERACTIVE_SCALE : 1;
      const width = Math.max(16, Math.round(box.width * scale));
      const height = Math.max(16, Math.round(box.height * scale));
      if (width === renderer.width && height === renderer.height) return;
      renderer.resize(width, height);
    };
    stopFollowingTheBox = () => {
      observer.disconnect();
      clearTimeout(settling);
    };
    const observer = new ResizeObserver(() => {
      if (paused) return;
      interacting = true;
      applySize();
      clearTimeout(settling);
      settling = setTimeout(() => {
        interacting = false;
        applySize();
      }, SETTLE_MS);
    });
    observer.observe(canvas);
  }

  showNotes(scene.notes);
  // The dropped conformers are named rather than left as a number that quietly disagrees with the
  // file's own atom count. One conformer per residue is drawn: highest occupancy, ties by file order.
  const conformers = inputs.alternatesDropped
    ? ` · ${inputs.alternatesDropped} alternate conformers not shown` : '';
  const subject = `${inputs.atoms.length} atoms · ${inputs.bonds.count} bonds · `
    + `${inputs.residues.length} residues · ${inputs.secondaryStructure.size} assigned `
    + `(${inputs.secondaryStructureMethod})${conformers}`;

  /*
    A handle for the headless drivers, and the reason it is `readPixels` rather than a screenshot.
    A screenshot is composited, opaque and browser-encoded -- a picture to look at, not a picture to
    hash -- and on the software adapter a canvas swap chain destroys the device outright.
  */
  window.foldRay = {
    version: APP_VERSION,
    /*
      The canvas is composited onto black (`backdrop = 2`) so the page
      looks like a page. The *picture* is straight RGBA on backdrop 0 -- transparent film, coverage
      in the alpha channel -- and that is the one a download hands over.
    */
    readPixels: async () => {
      const previous = renderer.backdrop;
      renderer.backdrop = 0;
      try {
        return await renderer.readPixels();
      } finally {
        renderer.backdrop = previous;
      }
    },
    state: () => ({
      structure: choice.sample.filename,
      representation: choice.protein,
      nucleicRepresentation: choice.nucleic,
      ligandRepresentation: choice.ligand,
      ionRepresentation: choice.ion,
      waterRepresentation: choice.water,
      frames: renderer.frames,
      lost: renderer.lost,
      adapter: renderer.adapterInfo,
      atoms: inputs.atoms.length,
      elements: inputs.elementCount,
      alternatesDropped: inputs.alternatesDropped,
      bonds: inputs.bonds.count,
      bondsPerceived: inputs.bonds.total,
      residues: inputs.residues.length,
      assigned: inputs.secondaryStructure.size,
      method: inputs.secondaryStructureMethod,
      notes: scene.notes,
      spheres: scene.spheres.length / 4,
      cylinders: scene.cylinders.length / 8,
      triangles: scene.triangles.length / 4,
    }),

    /*
      Render exactly `count` samples and read them back: the entry point for a byte-identity render.

      **The page's own loop cannot serve this and should not be made to.** It never stops, so a
      driver watching it breaks on the first check at or past a target and its achieved count
      overshoots and varies run to run on an unchanged build (342, 338 and 294 on three runs,
      measured). That is exactly right for a picture to look at and useless for a picture to hash.
      So this pauses the loop and counts instead.

      Three settings are this entry point's rather than the page's, and all three are fixed here
      rather than asked for in the query, because a case that differed in one would be scored
      against a baseline recorded under the other:

      * **`denoise = 'off'`** -- the filter's strength is a function of the frame count, so leaving
        it on would make every case's bytes depend on the schedule as well as on the scene.
      * **`backdrop = 0`** -- straight RGBA: the picture a download hands over, alpha as coverage.
      * **`seed`** -- 0 is the product's own value and a bit-exact no-op.

      Samples go in chunks with the queue drained between them: `sample()` submits one command
      buffer per frame and never awaits, so asking for 256 in one call queues 256 dispatches at once
      and can trip the driver's watchdog.
    */
    renderExactly: async (count, { seed = 0, size = null, chunk = 16, tileRows = 0, drainEvery = 0, readback = true } = {}) => {
      paused = true;
      stopFollowingTheBox();
      if (size) renderer.resize(size, size);
      // A driver hook, like `seed`: 0 is the product's own whole-frame dispatch and what every
      // recorded hash was rendered with. It is here so a tiled render can be hashed against an
      // untiled one, because byte-identity across the two is the whole claim.
      /*
        **Refused rather than rounded, because a band that is not whole workgroups renders a
        different picture and says nothing.** A dispatch is rounded up to the 8-row workgroup, so a
        band of 5 covers rows 0-7 while the next band starts at row 5 and three rows take two
        samples. Measured at 64 px: tile 0 and tile 8 hash the same, tile 5 and tile 12 each hash
        differently, all at 24 frames and full alpha -- a wrong picture that looks right.
        `tileRowsFor()` floors to a multiple of 8; a hand-written driver has nothing to floor it.
      */
      if (tileRows % 8 !== 0 || tileRows < 0) {
        throw new Error(`tileRows must be a non-negative multiple of 8, not ${tileRows}`);
      }
      renderer.tileRows = tileRows;
      renderer.denoiseMode = 'off';
      renderer.backdrop = 0;
      renderer.seed = seed;
      renderer.reset();
      for (let done = 0; done < count; done += chunk) {
        // `drainEvery` is the driver hook for the final render's queue bound; 0 is `sample()`
        // itself, which is what every recorded hash was rendered with.
        // eslint-disable-next-line no-await-in-loop
        if (drainEvery > 0) await renderer.sampleDraining(Math.min(chunk, count - done), { drainEvery });
        else renderer.sample(Math.min(chunk, count - done));
        // eslint-disable-next-line no-await-in-loop
        await renderer.device.queue.onSubmittedWorkDone();
      }
      if (renderer.lost) throw new Error('the WebGPU device was lost while sampling');
      /*
        **Timing runs ask for no picture, and that is not a shortcut.** The readback runs the
        display pass, maps a staging buffer and then turns the bytes into a plain `Array` -- 16.7
        million boxed numbers at 2048 square. A probe rendering one case fifty times to find a 1%
        difference pays that fifty times, which is the largest constant inside the number it is
        trying to measure, and the memory pressure to match.
      */
      if (!readback) {
        return { frames: renderer.frames, diagnostics: renderer.diagnostics ?? [] };
      }
      const picture = await renderer.readPixels();
      return {
        width: picture.width,
        height: picture.height,
        pixels: Array.from(picture.pixels),
        frames: renderer.frames,
        // What the shader compiler said, so a case that "finished" with a pipeline that never
        // built is a failure rather than a uniformly black picture with a clean exit code.
        diagnostics: renderer.diagnostics ?? [],
      };
    },
  };

  /*
    The accumulation loop. Nothing stops it: 128 is named in the readout as the point where noise
    falls below the systematic floor, and the trace keeps going past it.
  */
  const marker = 128;
  const started = performance.now();
  const step = () => {
    // The driver has taken the renderer. Stop presenting rather than fighting it for the queue.
    if (paused) return;
    // A structure was loaded through the shell and `createLiveTrace()` owns the canvas now.
    if (scaffoldingHandedOver) return;
    if (renderer.lost) {
      say('<strong>The WebGPU device was lost.</strong> Reload the page.');
      return;
    }
    renderer.sample(2);
    renderer.present();
    const elapsed = (performance.now() - started) / 1000;
    const rate = renderer.frames / Math.max(elapsed, 1e-6);
    const state = renderer.frames < marker
      ? `converging, ${marker} is where noise falls below the systematic floor`
      : 'past the noise floor and still accumulating';
    say(`<strong>${renderer.frames}</strong> samples · ${rate.toFixed(1)}/s · `
      + `${renderer.width}x${renderer.height} · ${state}`
      + `<br /><span class="subject">${subject}</span>`);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/*
  ------------------------------------------------------------------------------------------------
  Listeners: the stage, the sequence drawer, the camera and the three modes.
  ------------------------------------------------------------------------------------------------
*/

// One shared pan and zoom for Result's still and both Compare panes, built before the stage that
// drives it. It returns undefined if the markup it needs is absent, which the stage then honours.
stage = initStageModes({ renderZoom: initRenderZoom() });

sequenceStrip = createSequenceStrip({
  host: sequenceRegion,
  onSelect: (residues, options) => selectStripResidues(residues, options),
  onFocus: (residues) => focusStripResidues(residues),
  onHover: (residues) => hoverStripResidues(residues),
});

sequenceDrawerToggle.addEventListener('click', () => {
  setSequenceDrawerExpanded(!sequenceDrawerExpanded());
});
/*
  The drawer covers the canvas it is read against, so a press anywhere else closes it -- through the
  same coordinator the Styles gallery and the File menu use, rather than a second document listener
  that would have to be kept in step with it.

  The bar is inside the region for this purpose, which is what keeps the toggle a toggle: a press on
  it is a press inside, so nothing closes the drawer before its own click reopens it.

  `dismissOnOverlayOpen: false` is the one thing it does not take from the popovers. The Styles bar
  sits directly above this one and opens its gallery on hover, so reaching for the toggle would
  otherwise close the drawer on the way past.
*/
coordinateOverlay({
  owner: 'sequence',
  contains: (target) => sequenceRegion.contains(target) || sequenceDrawerBar.contains(target),
  isOpen: sequenceDrawerExpanded,
  close: () => setSequenceDrawerExpanded(false),
  dismissOnOverlayOpen: false,
});
// Escape closes it as well, unconditionally: the drawer overlays the canvas, so the key that means
// "give me the picture back" has to reach it wherever focus happens to be.
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && sequenceDrawerExpanded()) setSequenceDrawerExpanded(false);
});

inspectModeButton.addEventListener('click', () => setInteractionMode('inspect'));
selectModeButton.addEventListener('click', () => setInteractionMode('select'));
pickingLevelButtons.forEach((button) => {
  button.addEventListener('click', () => setPickingLevel(button.dataset.pickingLevel));
});
clearSelectionButton.addEventListener('click', () => clearCurrentSelection());
/*
  Both wrapped rather than bound directly, so a `click` event can never arrive where the options
  object belongs -- `addSelectionLayer(event)` would read `event.hidden` as undefined and work, and
  `addSelectionLayer` bound to the hide button would silently make a visible layer.
*/
addSelectionButton.addEventListener('click', () => addSelectionLayer());
hideSelectionButton.addEventListener('click', () => addSelectionLayer({ hidden: true }));

fitVisibleButton.addEventListener('click', fitVisibleStructure);
saveCameraViewButton.addEventListener('click', saveCurrentCameraView);
goToSavedCameraViewButton.addEventListener('click', () => void goToSavedCameraView());

pickDepthOfFieldFocus.addEventListener('click', beginFocusPicking);
autoDepthOfFieldFocus.addEventListener('click', () => {
  useAutoFocus();
  setLoadStatus('Depth of field will focus on the centre of the frame.');
});
styleFocusPromptPick.addEventListener('click', beginFocusPicking);

/*
  What the stage sends back. Each one needs something this file has and that module deliberately
  does not: the structure bytes a settings file embeds, the fetch a comparison needs, and the
  renderer a live picture is read off.
*/
/*
  The Styles gallery, and the four ways it reaches the composition.

  `src/styles-strip.js` builds the bar, the gallery, the Style card and the sweep; everything below
  is this file's half of that seam. Nothing here is a second implementation of anything -- each hook
  hands the strip a mechanism that already exists, which is what keeps a Style-applied composition
  indistinguishable from a hand-made one afterwards.
*/
const styles = initStyles({
  applyWrites: applyStyleWrites,
  applyOverlays: applyStyleOverlays,
  renderOne: () => renderStyleTile(SWEEP_TILE_QUALITY),
  registerResult: (result, meta) => stage?.registerCandidate(result, result.settings, meta),
  releaseResults: (entries) => stage?.releaseCandidates(entries),
  /*
    The whole composition, unconditionally. What Restore promises is the composition from before the
    Styles detour, and that exists from the moment a structure is loaded -- so banking only what the
    latest render does not already hold (the right question for a save prompt) offered no way back
    on a freshly loaded structure, and nothing to say about it.
  */
  captureMySettings: captureHistoryState,
  restoreMySettings: (snapshot) => restoreRenderSnapshot({
    label: 'your settings from before the Style',
    settings: snapshot,
  }),
  captureBaseline: captureHistoryState,
  restoreBaseline: restoreSweepBaseline,
  // A Style applied mid-render would fight the trace that is already running.
  isBusy: () => renderInFlight || structureLoading,
  onBusyChange: (busy) => {
    stylesActionsBusy = busy;
    /*
      **The walk claims the renderer for the whole walk**, which is a longer span than any of its
      tiles. `render()` claims its own, so tiles never overlap the live trace; what they would do
      without this is release between each other, and the loop would wake in every gap to rebuild a
      scene it was about to be parked out of again -- a BVH build per tile, reading as a sweep that
      got slower for no reason. This is the one call site that knows where a walk begins and ends:
      `styles-strip.js` reports busy from before the baseline capture to after the restore.
    */
    if (busy) sweepClaim ??= claimRenderer();
    else { sweepClaim?.(); sweepClaim = undefined; }
    updateSavedCameraViewControls();
  },
  // Reuses the exact mechanism a loaded session's pending post-processing already relies on:
  // `stage-modes.js` applies it to whichever render lands next and carries it forward from there,
  // and never to a sweep-draft candidate (`registerCandidate()` does not consult it).
  armImproveImage: (value) => stage?.restorePostProcessing(value),
  applyColorScheme: applyStyleColorScheme,
  getNucleicPresent: () => availableComponents.nucleic,
  getUnchosenSwitches: () => new Set(unchosenComponentSwitches),
  /*
    Every Style authors `depth_of_field_enabled`, so the ones that turn it on hand the user a soft
    picture focused on wherever the camera happened to point. `maybeShowStyleFocusPrompt()` says so
    on every such apply until muted, on the live view, and does nothing for the Styles that leave it off -- it
    reads the control the writes have just landed on rather than the Style, so a Style whose depth
    of field the user has since switched off cannot re-raise it. Non-sweep applies only, because
    `onApplied` is: a walk applies two dozen Styles in a row and restores the pre-sweep composition
    on the way out, so the question is not the user's yet.
  */
  onApplied: () => maybeShowStyleFocusPrompt(),
  /*
    The strip's failures land on the line that already speaks about the composition. Everything it
    can refuse comes out of `buildRenderRequest()`, whose messages name the control and the range it
    wants -- which is only useful to somebody who is looking at the controls, which is where this
    line is.
  */
  reportFailure: (message) => setLoadStatus(message, true),
});

document.addEventListener('foldray:style-apply', (event) => {
  void styles?.applyFromUi(event.detail?.styleId);
});

/*
  The opening screen (`src/opening-screen.js`).

  **Eager rather than dynamically imported.** There is one build, so a dynamic import would only
  move a few kilobytes behind a promise -- and it would put a race on the first paint: the import
  and Mol*'s async init would start together, and if the import lost, the very first frame would
  show the studio with nothing over it. The plugin is the thing worth deferring (`ensurePreview()`);
  this is not.

  `launcher.routeFile` is what the drop zone and the browse button drive, so the File menu and this
  screen share one routing implementation rather than two -- and it is why both take a saved session
  as well as a structure. `refusal()` is passed in because it is the page's one answer about WebGPU
  -- see the module's own header.

  **No Styles are passed, and the screen renders nothing.** A screen that walked Styles on the
  structure that had just loaded would make arriving at a protein start a sweep nobody pressed a
  button for. It holds one decision.
*/
const appVersionBadge = document.querySelector('#app-version');
if (appVersionBadge) {
  appVersionBadge.textContent = `${APP_CHANNEL} ${APP_VERSION}`;
  appVersionBadge.title = APP_SIGNATURE;
}
// The two forms record which release a report or a render came from.
for (const link of document.querySelectorAll('#feedback-link, #submit-link')) {
  const url = new URL(link.href);
  url.searchParams.set('v', APP_VERSION);
  link.href = url.href;
}

const openingScreen = initOpeningScreen({
  routeFile: launcher.routeFile,
  isBusy: () => renderInFlight || fileInput.disabled,
  renderRefusal: refusal,
});
// It has no close button: a press outside it closes it, as it closes File and the Styles gallery.
// Not on another overlay opening, though: the Styles bar opens its gallery on hover, and passing
// over it would close this screen before anybody chose anything.
coordinateOverlay({
  owner: 'opening-screen',
  contains: openingScreen.contains,
  isOpen: openingScreen.isShown,
  close: openingScreen.hide,
  dismissOnOverlayOpen: false,
});

/*
  ================== WARM THE FIRST TRACE WHILE SOMEBODY IS READING THE SCREEN ==================

  The first trace fetches **1,382 KiB that no host compresses for it**: the two Filmic LUTs
  (`filmic_desat33.bin.gz`, 81 KiB gzipped) and the default environment's map, stored gzipped,
  at 1,279 KiB. Neither is a type on any host's default compression list, so this is nearly four
  times the whole compressed page and it is paid at the moment the user first presses Live -- the
  one moment they are watching for something to happen.

  None of it depends on the structure, on the request or on anything the opening screen decides, so
  none of it has to wait. `requestIdleCallback` puts the fetches in the gaps while somebody is
  typing an accession or reading the sample list, and the HTTP cache is what `loadLuts()` and
  `loadEnvironment()` then hit.

  Four things make this safe rather than merely eager:

  * **It warms a cache and holds nothing.** The responses are read to completion and dropped; the
    renderer still does its own fetch, parse and upload when it is ready to. Nothing here can hand
    the tracer a half-read buffer.
  * **A failure is silent on purpose**, and it is the one place in this file where that is right: a
    prefetch that fails costs exactly the fetch the trace was going to make anyway. `loadLuts()` and
    `loadEnvironment()` are still the reporters.
  * **`priority: 'low'`** where the browser honours it, so this cannot compete with the structure
    the user is about to ask for.
  * **The default environment only.** `lightingScene(request)` can name any of nine and a session
    can carry one, so prefetching all six maps would download 5.6 MB to be right about 1.3. Guessing
    the default is right for the overwhelming majority and wrong at no cost beyond one wasted map.

  `requestIdleCallback` is absent on Safari before 17.4; the `setTimeout` fallback is not a
  correctness path, it is the same warm-up a beat later.
*/
{
  /*
    The environment the app opens on, read off `lighting-compass.js`'s own profile table rather
    than spelled here. That table is the single copy of the source-to-scene mapping (`scene.js`
    derives its `LIGHTING_SCENES` from it too), so this cannot warm a file the trace will not ask
    for.
  */
  const defaultScene = LIGHTING_SOURCE_PROFILES[DEFAULT_LIGHTING_SOURCE].scene;
  const warm = () => {
    const paths = [
      'luts/luts.json', 'luts/filmic_desat33.bin.gz', 'luts/filmic_vhc.bin',
      `env/${defaultScene}.json`, environmentImagePath(defaultScene),
    ];
    for (const path of paths) {
      fetch(assetUrl(path), { priority: 'low' })
        .then((response) => response.arrayBuffer())
        .catch(() => {});
    }
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(warm, { timeout: 3000 });
  else setTimeout(warm, 1200);
}

/*
  **The opening screen is the first load and nothing else**: `show()` runs at most once, from the
  `studioEntry` line at the bottom of this file or for a scaffolding URL that failed to start.
  Nothing is unreachable without a reopen button -- the rail's Source panel carries all four ways
  in (`#pdb-id`, `#alphafold-id`, `#structure-file`, `#session-file`), which is where a second structure is opened from once the studio is up.
*/

/*
  Improve image's own controls are the one part of the composition outside `.app-shell`, so the
  shell's capture-phase `change`/`input` listener never sees them. `stage-modes.js` announces them
  instead, and this is the line that makes an edit to them mark the session unsaved -- without it a
  finished picture could be adjusted, saved and reopened plain, with nothing having said so.
*/
document.addEventListener('foldray:post-process-change', markSessionDirty);

/*
  **The one thing in the app that starts a trace, and the one thing that stops one.**

  Live *is* the trace, so a panel nobody is looking at is a picture nobody is looking at: loading a
  structure lands on Preview -- the Mol\* canvas, with the structure in it -- nothing is sampled
  until Live is on the stage, and leaving it stops the GPU rather than hiding it. Without the second
  half a trace begun in Live goes on accumulating behind Preview, a still and both Compare panes,
  at full GPU, for the life of the page.

  `foldray:stage-mode` carries `live` beside the mode so this reads one bit rather than re-deriving
  the stage's own answer. **Pausing is not stopping**: `pause()` disposes nothing and keeps every
  sample, so coming back to Live continues the picture that was there rather than starting it again
  -- see `createLiveTrace().resume()`, which re-queues only when something else has had the
  renderer.

  It is idempotent by construction -- `startLiveTrace()` retargets an existing trace rather than
  building a second one -- and it catches, because a refused adapter reaching an unhandled rejection
  is a failure that reports nowhere.
*/
/*
  The one backdrop control, reaching the one surface CSS cannot.

  `stage-modes.js` paints Live, Result and Compare from `data-backdrop` alone, because all three are
  a matte behind a picture that carries alpha. Mol* clears its own canvas, so the checkerboard behind
  `#viewer` is invisible until the plugin is told to stop -- `preview-canvas.js`'s `setBackdrop()`.
  Here rather than there because the stage talks to this file through events and never by import.
*/
document.addEventListener('foldray:backdrop-change', (event) => {
  preview?.setBackdrop(event.detail?.backdrop);
});

/*
  Whether the stage is accumulating right now, as one attribute on one node.

  **It exists to switch the stage chrome's `backdrop-filter` blurs off while the picture underneath
  is moving** (`styles.css`, ".stage[data-tracing]"). A backdrop filter is re-evaluated whenever its
  backdrop repaints, and the backdrop of every pill on this stage is the canvas. Twelve selectors
  carry one and seven are actually painted in Live -- measured rather than counted off the list:
  `#readout`, `.stage-quick-image`, `.stage-modes`, `.stage-backdrops`, `.compare-bar` and the two
  `.preview-camera-*` bars, plus `.preview-focus-prompt` for as long as the callout is up. The rest
  are Result- or Compare-only and therefore `display: none` and unpainted. Without the switch the
  compositor re-runs a separable blur for each of them *per traced frame*, on the same GPU that is
  path-tracing, for chrome nobody is reading while they watch a picture converge.

  **Set once and cleared once, never per frame.** The two call sites below are the whole of it, and
  they are the same two the trace itself starts and pauses on -- so the attribute cannot churn, and
  it cannot disagree with whether there is a trace. `traceReadout()` deliberately does not touch it:
  a class written 60 times a second to save nine blurs would be the trade backwards.
*/
function setStageTracing(tracing) {
  if (stageRoot) stageRoot.dataset.tracing = tracing ? 'on' : 'off';
}

document.addEventListener('foldray:stage-mode', (event) => {
  // A Style applied over a still asked the question where nothing could be drawn; this is the
  // first moment it can be.
  if (styleFocusPromptPending) maybeShowStyleFocusPrompt();
  /*
    Cleared on *every* announcement and set again only by a start that resolved, which is what makes
    the attribute unable to lie. Leaving Live clears it because there is no longer a trace; entering
    it clears it too, because there is not one *yet* -- `startLiveTrace()` can still refuse the
    request or the adapter, and an attribute claiming a moving picture would take the blur off a
    stage that is standing still. `foldray:stage-mode` is deduplicated on the sending side
    (`stage-modes.js`, `if (mode !== announcedStage)`), so this runs on a real mode change and never
    on a repaint.
  */
  setStageTracing(false);
  // And the indicator with it, on every announcement and for the same reason: leaving Live has
  // nothing left to wait for, and entering it has not started waiting yet.
  setStageBusy(false);
  if (!event.detail?.live) {
    liveTrace?.pause();
    return;
  }
  if (!structureFile) return;
  /*
    Select and focus picking are gestures on the *Preview*, and Live shows none of their feedback:
    the selection outline, the focus visual and the highlight are all Mol\*'s, on a canvas this mode
    covers. A click that silently toggled a residue would reach the render through a selection
    layer, which is the worst shape a hidden gesture can have -- so entering Live puts the canvas
    back in Inspect, visibly, on the buttons the user chose it with.
  */
  if (interactionMode === 'focus') finishFocusPicking('inspect');
  else setInteractionMode('inspect');
  /*
    **The blank stage, and only the blank one.** A first Live on a large structure is the adapter,
    the LUTs, the geometry and the BVH with nothing on screen at all; a trace that has already put a
    frame up is showing that picture while it retargets, so there is nothing for an indicator to
    say. The count goes to zero with it, because that is what the canvas is about to hold.
  */
  if (!liveFrameSeen) {
    sayZeroSamples();
    setStageBusy(true);
  }
  startLiveTrace().then(
    // The only place the attribute goes on, and after the start has resolved rather than before it.
    // The failure arm leaves it off because the line above already turned it off. A first start
    // waits on the adapter and the LUTs, and the stage can have left Live in that time.
    () => setStageTracing(stage?.mode() === 'live' && !liveTrace?.paused()),
    (error) => {
      // A refused start: no frame is coming, so the indicator cannot be left to the first one.
      setStageBusy(false);
      setRenderStatus('Not traced', error.message || String(error), true);
      // A refused fresh start leaves Live, so the next press on Live is a change and retries.
      if (!liveTrace && stage?.mode() === 'live') stage.viewPreview();
    },
  );
});

document.addEventListener('foldray:render-save-image', (event) => void saveRenderImage(event.detail));
document.addEventListener('foldray:render-save-settings', (event) => void saveRenderSettings(event.detail));
document.addEventListener('foldray:compare-save-image', (event) => void saveCompareImage(event.detail));
document.addEventListener('foldray:live-quick-image', () => void quickImageFromLiveTrace());
document.addEventListener('foldray:render-restore', (event) => void restoreRenderSnapshot(event.detail));
// The same sentence `saveRenderImage()` writes when the save itself fails, because to the reader
// it is the same fact: the file they pressed for was not written.
document.addEventListener('foldray:render-save-failed', (event) => {
  setLoadStatus(
    `Could not save ${event.detail?.label ?? 'that render'}: ${event.detail?.reason}`,
    true,
  );
});
document.addEventListener('foldray:render-unavailable', (event) => {
  setRenderStatus(
    'Unavailable',
    `${event.detail?.label ?? 'That render'} could not be read back and has been cleared.`,
    true,
  );
});

/*
  The preview canvas follows the panel, and the panel is responsive.

  `plugin.handleResize()` reads the canvas's own box, so this is the Mol* half of exactly what
  `startLiveTrace()`'s observer does for the tracer -- and neither one may ever change a box, which
  is why both hang off an observer rather than off a layout write.
*/
if (typeof ResizeObserver === 'function' && viewerPanel) {
  new ResizeObserver(() => preview?.handleResize()).observe(viewerPanel);
}

/*
  The mode buttons start disabled and `loadStructure()` turns them on, because the import that builds
  the preview is asynchronous and only runs when a structure arrives through the studio. Everything
  else in the app is usable while it settles, and the scaffolding page never asks for it at all.
*/
setInteractionModeDisabled(true);
updateSelectionPanelState();

/*
  **The opening screen is the entry, and it steps aside for a page that was asked for a picture.**

  A bare URL is the studio with nothing loaded, which is exactly what this screen is for. A URL
  carrying a scaffolding parameter is the *scaffolding* page: a driver navigates to
  `/?structure=...` and `chosen()` reads those parameters into one pinned request. That page has
  already been told which picture to make, so opening a screen that asks is answering a question
  nobody put.

  It changes nothing about a measured render even when it does open: a driver reads the
  `readPixels()` readback rather than a composite, and `renderExactly()` drives the accumulator with
  no DOM involved. The separation is here for the same reason the two request builders are -- a page
  under measurement should not be a page with a decision on it.
*/
/*
  Which of this file's two pages this load is, asked **once**.

  A URL carrying a scaffolding parameter is the scaffolding page under measurement; any other is the
  studio. Read separately -- the opening screen from `window.location.search`, the trace from
  nothing at all -- a bare load is both: the screen asking what to open, over a trace of 3RGK nobody
  asked for.
*/
const entryQuery = new URLSearchParams(window.location.search);
const studioEntry = !SCAFFOLDING_PARAMETERS.some((name) => entryQuery.has(name));
/*
  A share link is taken off the address bar before anything is fetched or parsed, so a tab the
  browser restores, or a reload, cannot replay it -- and so the address never goes on naming a
  picture the user has since changed.
*/
const shareFragment = studioEntry && window.top === window && isShareFragment(window.location.hash)
  ? window.location.hash
  : undefined;
if (shareFragment) {
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
  void openShareLink(shareFragment);
} else if (studioEntry) {
  openingScreen.show();
}
// A link pasted into this tab changes only the fragment, which reloads nothing. It is said, and never
// opened: opening it would replace the session without the question a reload asks.
window.addEventListener('hashchange', () => {
  if (studioEntry && isShareFragment(window.location.hash)) {
    setLoadStatus('That is a share link. Reload the page to open it here, which replaces what is open,'
      + ' or open it in a new tab.');
  }
});

scaffoldingPage({ trace: !studioEntry }).catch((error) => {
  // A failure here is a real one and must not read as an empty page. `diagnostics` carries the
  // shader compilation errors, which are otherwise only on the console.
  console.error(error);
  // As text: the validators quote the raw query value, and `say()` writes HTML.
  const heading = document.createElement('strong');
  heading.textContent = 'Could not start the tracer.';
  readout.replaceChildren(heading, ` ${error.message}`);
  // The readout is hidden outside Live, so a URL that is not a working scaffold falls back to the studio.
  if (!studioEntry) {
    openingScreen.show();
    setLoadStatus(`Could not start the tracer: ${error.message}`, true);
  }
});

/*
  The capability gating, last, and never on the critical path of the trace: it greys out options,
  it renders nothing, so a failure here must not take the studio with it.
*/
try {
  applyFidelityGating(capabilities());
} catch (error) {
  console.error('The unbuilt options could not be greyed out.', error);
}
