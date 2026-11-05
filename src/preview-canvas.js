/*
  The preview canvas: Mol* drawing the `Structure` this tree already built.

  **The obvious way to draw this is the one thing that must not happen here.** `Viewer.create()`
  from `molstar/lib/apps/viewer/app` plus `viewer.loadStructureFromData(text, 'mmcif')` parses the
  file into Mol*'s own plugin state, and is therefore a **second** `Structure` from the same bytes.
  In a separate process that is harmless; in one page it is a direct collision with this app's
  hardest invariant -- one `Structure`, one answer.

  **So the plugin adopts rather than loads.** Three transformers put the `Trajectory`, the `Model`
  and the `Structure` `src/structure.js` produced into the plugin's own state tree, unchanged and
  by reference. Every question the preview answers -- which residues are helical, which atoms a
  layer selects, which assembly this is -- is then answered by the same object the tracer reads,
  because it *is* the same object.

  **`PluginContext`, not the Viewer app, and the invariant-preserving option is also the cheap one.**
  `mol-plugin/context.js` and `mol-plugin/spec.js` pull 931 files and **zero React**;
  `apps/viewer/app.js` pulls `mol-plugin-ui/react18.js`, and with it `react` and `react-dom` (Mol*
  declares both as peer dependencies and this tree installs neither) plus a SCSS skin. The measured
  cost of this file is +1,685 KiB minified, and it is behind a dynamic `import()` from `main.js` --
  the opening screen, the Result trace and the download need no plugin at all.

  **What the plugin gives us and what it does not.** Everything reached through
  `plugin.managers.*` -- selection, hierarchy, interactivity, components, camera -- is on a bare
  `PluginContext`, which is why `plugin` is exported raw rather than wrapped: a wrapper would have
  to grow a method per manager. What does **not** come across is Mol*'s own React interface, and
  two pieces of it are worth naming:

  * **The sequence panel** (`layoutShowSequence`), which is `mol-plugin-ui`'s `SequenceView`.
    `src/sequence-strip.js` is this app's answer and is drawn from our own residue list.
  * **The selection toolbar** (`msp-selection-viewport-controls`), which carries the picking-level
    menu and four set operations. Neither is lost as a *gesture*: Mol*'s own
    `DefaultSelectLociBindings` already make a primary click a toggle, a shift-click an extend
    along the polymer, and a click on nothing a deselect-all. The picking level is three buttons in
    the selection panel (`index.html`'s `#picking-level`), narrowed to the three of Mol*'s ten a
    selection layer can actually store; the set operations are not offered, and the chain shortcuts
    and the sequence strip are what stand in for them.

  **Nothing here may dispose what it adopted.** Mol*'s own `model-from-trajectory` ends with
  `dispose({ b }) { b.data.customProperties.dispose() }`, which is correct for an object the plugin
  built and wrong for one it was handed: the secondary-structure attachment on our `Structure` is
  the assignment the sweep reads, and tearing it down on `plugin.clear()` would leave the tracer
  drawing every residue as a loop with nothing saying so. The three transformers below define no
  `dispose` for exactly that reason.
*/

import { PluginContext } from 'molstar/lib/mol-plugin/context.js';
import { DefaultPluginSpec } from 'molstar/lib/mol-plugin/spec.js';
import { FocusLoci } from 'molstar/lib/mol-plugin/behavior/dynamic/camera.js';
// Re-exported for main.js, which would otherwise put Mol*'s GL layer on the first paint.
export { EmptyLoci, Loci } from 'molstar/lib/mol-model/loci.js';
/*
  **Mol*'s own numbers, read rather than copied.** A press on a residue in the 3D view goes through
  `PluginBehaviors.Camera.FocusLoci`, which `DefaultPluginSpec()` registers with these defaults
  (`minRadius` 8, `extraRadius` 4, `durationMs` 250). Reading them is what makes "a chip zooms the
  way the viewport does" a fact rather than two tables that agree today.
*/
export const FOCUS_LOCI_OPTIONS = FocusLoci.createDefaultParams(undefined, undefined);
import {
  PluginStateObject as SO, PluginStateTransform,
} from 'molstar/lib/mol-plugin-state/objects.js';
import { ArrayTrajectory } from 'molstar/lib/mol-model/structure/trajectory.js';
import {
  Queries, QueryContext, Structure, StructureSelection,
} from 'molstar/lib/mol-model/structure.js';
// The one thing `onHighlight()` below cannot read off the object it is handed: which of the two
// directions a mark is going in. Mol*'s own enum rather than the numbers behind it.
import { MarkerAction } from 'molstar/lib/mol-util/marker-action.js';
import { ParamDefinition as PD } from 'molstar/lib/mol-util/param-definition.js';
import { Color } from 'molstar/lib/mol-util/color/color.js';
import { lensScaledOrbitLimits } from './camera-framing.js';
/*
  The two state helpers the studio's selection layers are painted with. They are `mol-plugin-state`
  rather than `mol-plugin-ui`, so they carry no React -- the same line this canvas is drawn on --
  but they *are* the plugin, and that is why they are imported here rather than in `main.js`: this
  module is behind a dynamic `import()` and `main.js` is the entry chunk. See
  `paintSelectionLayers()` for the measurement.
*/
import {
  clearStructureOverpaint, setStructureOverpaint,
} from 'molstar/lib/mol-plugin-state/helpers/structure-overpaint.js';
import {
  clearStructureTransparency, setStructureTransparency,
} from 'molstar/lib/mol-plugin-state/helpers/structure-transparency.js';

/*
  The canvas background. `$default-background` from `molstar/lib/mol-plugin-ui/skin/dark.scss`, which
  is a published constant of a stylesheet this tree does not load -- the WebGL clear colour is a
  render property and no rule can reach it, so the panel and the viewport read as one surface only
  if this matches `styles.css`'s own panel colour.
*/
export const PREVIEW_BACKGROUND = Color(0x111318);

/*
  The three backdrops, as Mol* canvas props.

  `stage-modes.js` owns the choice and paints Result, Compare and Live with CSS alone -- all three
  are a matte behind something that carries alpha. Mol* is the one surface that cannot be reached
  that way: `renderer.backgroundColor` is a WebGL clear colour, so the checkerboard behind `#viewer`
  is invisible until the canvas stops clearing over it. `transparentBackground` is what stops it,
  and it is a published Mol* prop rather than anything of ours.

  White and black clear to that colour *and* turn transparency back off, so the two opaque backdrops
  are one statement rather than a colour behind a hole.
*/
const PREVIEW_BACKDROPS = {
  alpha: { transparentBackground: true, backgroundColor: PREVIEW_BACKGROUND },
  white: { transparentBackground: false, backgroundColor: Color(0xffffff) },
  black: { transparentBackground: false, backgroundColor: Color(0x000000) },
};

/*
  Adoption, in the three steps Mol*'s hierarchy manager wants.

  `mol-plugin-state/manager/structure/hierarchy-state.js` builds its `TrajectoryRef → ModelRef →
  StructureRef` chain by matching cell *types*, so the shape has to be a chain of three rather than
  one transformer producing a `Structure` at the root. That is the whole reason there are three of
  these; each is otherwise a one-line hand-over.

  `PD.Value` is the parameter kind for an arbitrary object. These params are therefore not
  serialisable, which is a true statement about them: an adopted `Structure` is an object in this
  page's memory and cannot be written into a Mol* state snapshot. This tree's own session document
  (`src/session-format.js`) is what persists a composition, and it carries the structure's bytes.
*/
const AdoptTrajectory = PluginStateTransform.BuiltIn({
  name: 'foldray-adopt-trajectory',
  display: { name: 'Adopted trajectory' },
  from: SO.Root,
  to: SO.Molecule.Trajectory,
  params: {
    trajectory: PD.Value(undefined, { isHidden: true }),
    label: PD.Value('Structure', { isHidden: true }),
  },
})({
  apply({ params }) {
    return new SO.Molecule.Trajectory(params.trajectory, { label: params.label });
  },
});

const AdoptModel = PluginStateTransform.BuiltIn({
  name: 'foldray-adopt-model',
  display: { name: 'Adopted model' },
  from: SO.Molecule.Trajectory,
  to: SO.Molecule.Model,
  params: { model: PD.Value(undefined, { isHidden: true }) },
})({
  apply({ params }) {
    return new SO.Molecule.Model(params.model, { label: 'Model 1' });
  },
});

const AdoptStructure = PluginStateTransform.BuiltIn({
  name: 'foldray-adopt-structure',
  display: { name: 'Adopted structure' },
  from: SO.Molecule.Model,
  to: SO.Molecule.Structure,
  params: {
    structure: PD.Value(undefined, { isHidden: true }),
    label: PD.Value('Structure', { isHidden: true }),
    description: PD.Value(undefined, { isHidden: true }),
  },
})({
  apply({ params }) {
    return new SO.Molecule.Structure(params.structure, {
      label: params.label,
      description: params.description,
    });
  },
});

// The query Mol*'s static `water` component is built from, so "has water" and "gets one" agree.
function hasWater(structure) {
  return !StructureSelection.isEmpty(Queries.internal.water()(new QueryContext(structure)));
}

/*
  `auto`, except where it would pick Atomic Detail for a structure with water: that preset draws
  water inside its one `all` component, where `setWaterVisible()` cannot hide it. Polymer & Ligand
  is what `auto` gives an ordinary Medium structure. Mirrors `auto`'s switch in Mol* 5.4.2's
  `representation-preset.js`; the plugin spec sets no size thresholds, so the defaults are Mol*'s.
*/
function previewPreset(structure, water) {
  if (!water) return 'auto';
  const size = Structure.getSize(structure);
  const gapFraction = structure.polymerResidueCount / structure.polymerGapCount;
  const atomicDetail = size === Structure.Size.Small
    || (size === Structure.Size.Medium && !(gapFraction > 3));
  return atomicDetail ? 'polymer-and-ligand' : 'auto';
}

/*
  **Mol*'s orbit limits are distances tuned at its own 45-degree lens, and they must scale with ours.**

  The trackball clamps the eye to `maxDistance` (10x the visible radius) on every draw. The
  focal-length slider keeps the framing by dollying, so a long lens puts the eye far past that --
  from 110-115 mm on a freshly framed 3RGK, sooner after a scroll out -- and the clamp then pulls it
  back: every view and render after is zoomed in, and nothing says why. Scaled by the dolly, a limit
  keeps the framing it had at 45 degrees. Refit on every `setState()`, Mol*'s resets included, since
  a reset re-derives the limits from these params.
*/
function fitOrbitLimitsToLens(canvas3d) {
  const authored = canvas3d?.props.trackball.autoAdjustMinMaxDistance;
  if (authored?.name !== 'on') return;
  const base = { ...authored.params };
  canvas3d.camera.stateChanged.subscribe((snapshot) => {
    const fov = snapshot.fov ?? canvas3d.camera.state.fov;
    if (!(fov > 0 && fov < Math.PI)) return;
    const params = lensScaledOrbitLimits(base, fov);
    // Mol*'s own formula, as `resolveCameraReset()` applies it: the params reach a reset, these the next draw.
    const { radius } = canvas3d.boundingSphereVisible;
    canvas3d.setProps({
      trackball: {
        autoAdjustMinMaxDistance: { name: 'on', params },
        ...(radius > 0 ? {
          minDistance: params.minDistanceFactor * radius + params.minDistancePadding,
          maxDistance: Math.max(params.maxDistanceFactor * radius, params.maxDistanceMin),
        } : {}),
      },
    }, true);
  });
}

/**
 * Build the preview canvas inside `container`, and hand back the plugin plus the calls the studio
 * makes on it.
 *
 * Async because `PluginContext.init()` is, and because mounting creates the WebGL context. A
 * machine that refuses a second WebGL context (the finishing panel already takes one) throws here
 * rather than returning a half-built plugin -- `main.js` says so in the load status and leaves
 * Preview unavailable, which is "refuse rather than substitute" at module scope.
 */
export async function createPreviewCanvas({ container }) {
  if (!container) throw new Error('the preview canvas has no container to mount in');

  const plugin = new PluginContext({
    ...DefaultPluginSpec(),
    /*
      Mol*'s own layout state still exists in a bare context -- `mol-plugin/layout.js` is not React
      -- and `_initViewer()` reads `spec.layout.initial` on the way in. Everything is off: there is
      no interface to lay out, and the only thing the flags would otherwise reach is a region this
      tree draws itself.
    */
    layout: { initial: { isExpanded: false, showControls: false } },
  });
  await plugin.init();
  if (!(await plugin.mountAsync(container))) {
    throw new Error('Mol* could not create a WebGL context for the preview canvas');
  }
  plugin.canvas3d?.setProps({
    // Perspective, always. The render request's camera is a perspective camera with a vertical
    // field of view, and an orthographic preview would frame something the trace cannot reproduce.
    camera: { mode: 'perspective' },
    renderer: { backgroundColor: PREVIEW_BACKGROUND },
  });
  fitOrbitLimitsToLens(plugin.canvas3d);
  // The picking level a plugin with nothing loaded is at. `main.js` owns it from here --
  // `applyPickingGranularity()` writes it on every mode and level change -- and this is the value
  // both that function and the control default to, so the two agree before anything is selected.
  plugin.managers.interactivity.setProps({ granularity: 'residue' });

  let structureRef;
  let structureHasWater = false;
  // Large and Huge structures get no water component from `auto`; one is built on first need.
  let waterComponentBuild;

  /**
   * Put a parsed structure into the plugin's state tree, by reference.
   *
   * `model` and `structure` are the objects `sceneInputsFromRequest()` memoises and the tracer
   * reads. The trajectory is `new ArrayTrajectory([model])` rather than the file's own: this tree
   * draws frame 0 and nothing else (`src/structure.js`'s `getFrameAtIndex(0)` is the model filter),
   * so a preview offering the other frames would offer what no render can produce.
   */
  async function adopt({ model, structure, label = 'Structure', description }) {
    await plugin.clear();
    structureRef = undefined;
    waterComponentBuild = undefined;
    structureHasWater = hasWater(structure);
    const built = await plugin.build()
      .toRoot()
      .apply(AdoptTrajectory, { trajectory: new ArrayTrajectory([model]), label })
      .apply(AdoptModel, { model })
      .apply(AdoptStructure, { structure, label, description })
      .commit();
    structureRef = built;
    /*
      `auto` is Mol*'s own choice of preset and is what `Viewer.loadStructureFromData` ends with, so
      the preview looks the way a Mol* user expects a structure to look. It is deliberately not this
      tree's own look: the preview is for orbiting, picking and selecting, and the picture is the
      trace: Mol* is the preview and is never the picture.
    */
    await plugin.builders.structure.representation.applyPreset(
      built, previewPreset(structure, structureHasWater),
    );
    return built;
  }

  /*
    Every component of every structure the plugin currently holds.

    The overpaint and transparency helpers below take a component list rather than a structure, so
    this is the argument both of them want and neither of them derives.
  */
  function currentComponents() {
    return plugin.managers.structure.hierarchy.current.structures
      .flatMap((structure) => structure.components);
  }

  /**
   * Paint the studio's selection layers onto the preview.
   *
   * **This lives here because of what it imports, and that is a measurement rather than a
   * preference.** `mol-plugin-state/helpers/structure-{overpaint,transparency}.js` reach the
   * plugin's state tree, so a static import of either pulls the plugin graph into whatever chunk
   * asks for it. Imported from `main.js`, they put 1,062 KiB into the entry chunk that
   * `ensurePreview()`'s dynamic `import()` exists to defer -- eager JS measured 2,164 KiB with them
   * there and 1,102 KiB with them here, on one build of one revision. This module is already the
   * lazy half; the painting belongs on this side of the boundary with the plugin it
   * paints.
   *
   * `lociFor(layer, structure)` is the caller's, because which residues a layer names is the
   * studio's question and not the preview's -- `main.js` answers it against the one `Structure`
   * both halves read.
   */
  async function paintSelectionLayers(layers, lociFor) {
    const components = currentComponents();
    await clearStructureOverpaint(plugin, components);
    await clearStructureTransparency(plugin, components);
    /*
      Visible layers first, hidden ones after, rather than in list order.

      Hiding beats every other layer, and this is how that is true *here*. A Style is what exposes it:
      a Style's overlay passes cover a *whole component* and are appended after the user's own layers,
      so a whole-protein pass lands on top of a hidden layer and would paint the region the user had
      hidden.

      **`src/scene.js` reaches the same result by a different route, and it has to.** This loop paints
      the topmost answer, so ordering settles it; the tracer *draws* every layer rather than the
      topmost one, so ordering settles nothing there and it subtracts a hidden layer's residues from
      the visible layers instead (`hiddenResidues`). Subtracting from the four base styles alone
      is the trap: the preview then hides the overlap and the trace draws it, and the preview is the
      one being looked at while a gallery is browsed.
    */
    const ordered = [
      ...layers.filter((layer) => !layer.hidden),
      ...layers.filter((layer) => layer.hidden),
    ];
    for (const layer of ordered) {
      /*
        A hidden layer is fully transparent here and is not drawn at all by `buildScene()`, so the
        preview and the trace agree about what is gone. It is deliberately not also overpainted: a
        colour on atoms that are not drawn is only a chance for the two to disagree.
      */
      if (layer.hidden) {
        await setStructureTransparency(
          plugin,
          components,
          1,
          async (structure) => lociFor(layer, structure),
        );
        continue;
      }
      if (layer.color_mode === 'element') continue;
      await setStructureOverpaint(
        plugin,
        components,
        Color.fromHexStyle(layer.color),
        async (structure) => lociFor(layer, structure),
      );
    }
  }

  return {
    /*
      The plugin, raw. `main.js` reaches the managers directly; a wrapper would have to grow a
      method per manager, and there are dozens of call sites.
    */
    plugin,
    adopt,
    paintSelectionLayers,
    /*
      Rebuild what reads the secondary-structure attachment after it was recomputed in place. Mol*'s
      cartoon compares the attachment's version only inside a representation update, and
      `setParams()`'s shallow compare skips an update whose params are the same objects -- hence the
      fresh `type`. Geometry is rebuilt only where the version actually moved.
    */
    refreshRepresentations: async () => {
      const build = plugin.build();
      for (const component of currentComponents()) {
        for (const representation of component.representations) {
          const params = representation.cell.transform.params;
          if (!params?.type) continue;
          build.to(representation.cell.transform.ref).update({
            ...params,
            type: { ...params.type, params: { ...params.type.params } },
          });
        }
      }
      await build.commit();
    },
    /*
      The highlight seam: what is under the pointer, in whichever surface the pointer is in.

      **`applyGranularity: false`, and that is the strip's own rule rather than an omission.** A
      canvas hover is granularity's business -- it previews what a click there would take, so at
      `chain` it lights the chain. A chip is one residue and `selectStripResidues()` commits it with
      `applyGranularity: false`, so a chip hover that widened to the chain would preview a click
      nobody can make from this strip.

      `clearHighlights()` is Mol*'s own and needs no loci: the manager remembers what it marked.
    */
    highlight: (loci) => {
      plugin.managers.interactivity.lociHighlights.highlightOnly({ loci }, false);
    },
    clearHighlight: () => plugin.managers.interactivity.lociHighlights.clearHighlights(),
    /*
      Every highlight, whatever raised it -- a canvas hover, a chip hover, anything later.

      A *provider* rather than a subscription on `interaction.hover`, because the hover behavior is
      only one of the doors: `HighlightLoci` normalises what arrives there, and a second reader of
      the raw event would have to re-derive that normalisation and would then be a second opinion
      about what is highlighted. This is where Mol* itself tells the world, and `MarkerAction` is
      what says whether the mark is going on or coming off.
    */
    onHighlight: (handler) => {
      plugin.managers.interactivity.lociHighlights.addProvider((interactionLoci, action) => {
        handler(interactionLoci.loci, action === MarkerAction.Highlight);
      });
    },
    /*
      Mol*'s own highlight colour, as a CSS colour, so a surface outside the canvas can paint the
      same signal. **Read rather than copied**: it is `renderer.highlightColor`, the value the
      canvas actually marks with, so the strip and the picture cannot drift apart on a Mol* default.
    */
    highlightColor: () => {
      const color = plugin.canvas3d?.props.renderer.highlightColor;
      return color === undefined ? undefined : Color.toStyle(color);
    },
    /*
      The backdrop, applied to the canvas rather than to a box behind it.

      `main.js` calls this from `foldray:backdrop-change`, so the one control the user presses moves all
      four modes at once. An id this does not know is ignored rather than substituted -- the button
      group is a three-entry allowlist upstream, so an unknown value here means somebody has written
      the attribute by hand and the honest answer is to leave the canvas as it is.
    */
    setBackdrop: (kind) => {
      const props = PREVIEW_BACKDROPS[kind];
      if (!props) return;
      plugin.canvas3d?.setProps({
        transparentBackground: props.transparentBackground,
        renderer: { backgroundColor: props.backgroundColor },
      });
    },
    /*
      Water's visibility in the preview, **set rather than toggled, and on the representations as
      well as the component**.

      `main.js` decides whether this picture has water in it; this puts that answer on the plugin.
      Three measured things are each a reason this is not the obvious call:

      * **A toggle is not idempotent.** Three callers run during a load -- the adopt, the hierarchy
        subscription and the layer repaint -- and two that look before either lands both flip a
        visible component, which is where it started.
      * **A toggle marks the component and not what draws.** One that runs before the
        representation exists leaves the cell saying `isHidden: true` while the canvas goes on
        drawing the water: the state is right and the picture is wrong, which is the hardest kind of
        wrong to see.
      * **`setSubtreeVisibility()` from `mol-plugin/behavior/static/state.js` is the function for
        this and importing it breaks `npm run dev`.** Unbundled, that deep import evaluates a
        `mol-plugin` module ahead of what it depends on and the app dies on
        `Cannot read properties of undefined (reading 'registerDefault')` -- while the *bundled*
        build, where Rollup settles the order, is fine. So the walk is done here over the hierarchy
        this file already holds, with `updateCellState`, and no new import at all.

      Identify the component by its transform parameter rather than by its display label, which is
      presentation and not contract.

      Async only for the Large/Huge case, where the first visible call builds the component; the set
      itself runs before the first `await`, and the new component's hierarchy event calls back in.
    */
    setWaterVisible: async (visible) => {
      const { structures } = plugin.managers.structure.hierarchy.current;
      const waters = structures
        .flatMap((entry) => entry.components)
        .filter((component) => {
          const type = component.cell.transform.params?.type;
          return type?.name === 'static' && type.params === 'water';
        });
      for (const component of waters) {
        const refs = [
          component.cell.transform.ref,
          ...component.representations.map((representation) => representation.cell.transform.ref),
        ];
        for (const ref of refs) plugin.state.data.updateCellState(ref, { isHidden: !visible });
      }
      if (!waters.length && visible && structureHasWater && structureRef && !waterComponentBuild) {
        const ref = structureRef;
        waterComponentBuild = (async () => {
          const component = await plugin.builders.structure.tryCreateComponentStatic(ref, 'water');
          if (!component || structureRef !== ref) return;
          // Polymer & Ligand's own water look.
          await plugin.builders.structure.representation.addRepresentation(component, {
            type: 'ball-and-stick', typeParams: { alpha: 0.6 }, color: 'element-symbol',
          });
        })();
        await waterComponentBuild;
      }
      return waters.length;
    },
    structure: () => structureRef,
    handleResize: () => plugin.handleResize(),
  };
}
