/*
  Overlay passes: the selection layers a Style may write, and the fence that keeps them bounded.

  The layers that make a *look* -- a glass shell over a cartoon, side chains over a backbone, a
  ribbon under ball-and-stick -- name no residue subset at all: each is one range covering a whole
  chain, an extra rendering pass over *everything*, differing only in representation, material,
  colour and alpha. That is a look, and a look is what a Style is.

  What is genuinely a selection stays out: six catalytic residues, or chain B's 1-118 and 133-241,
  describe one specific protein and can never be a preset. So the rule is:

      A pass is scoped to a whole component -- 'protein', 'nucleic', 'ligand' or 'ion' -- and to
      nothing else. A Style may never name a chain, a residue, a range, or an atom.

  There is no selection language here, no predicate and no query: a pass names one of four
  constants. That is what keeps this inside the app's "no atom or spatial selection languages" rule
  instead of being a breach of it, and `assertNoSelection` below turns any attempt to smuggle one in
  into a loud failure rather than a silently narrower picture.

  ---

  THE MASKING TRAP, and why `from: 'base'` exists.

  A layer's atoms are removed from all four component bases. A pass covering the whole protein
  therefore *deletes the protein base* -- the base cartoon renders nothing at all.

  This is not theoretical: a glass-shell look has to carry a second pass duplicating its own base
  cartoon settings exactly, because the shell masked the base away and the cartoon has to be
  re-added as a layer to appear at all.

  Authoring that duplicate by hand in the catalogue would give the base look two sources that drift.
  So a pass may instead be written `{ component: 'protein', from: 'base' }`, meaning "mirror
  whatever the base controls say". It is deliberately *not* resolved here: this module is pure and
  has no DOM, and the right value is whatever the controls hold after the Style's own writes have
  landed. A pass makes its component a replaced group, so a field the Style is silent on mirrors
  STYLE_BASELINE, never the user's value. main.js's `applyStyleOverlays()` fills it in from the live
  controls.

  A pass list is therefore the *complete* list of passes for the components it mentions, not a set
  of additions to an implied base. A Style that wants a cartoon under its glass says so.
*/

// The whole vocabulary. A pass targets one of these and there is no fifth option and no operator.
export const OVERLAY_COMPONENTS = ['protein', 'nucleic', 'ligand', 'ion'];

/*
  THE SECOND AXIS, and why it is still not a selection language.

  An interface picture is two proteins meeting, drawn differently so the meeting is visible: a
  receptor as spheres with a Fab as cartoon over it, a surface with a helix laid into its groove.
  Every one of those needs a pass to cover *one side of the interface* rather than the whole
  protein, and a hand-made session can only do that by naming chains: chain C against chains A and
  B, chain A against chain P.

  A chain id is exactly what a Style may never carry. `1N8Z`'s big subunit is chain C; the same
  receptor deposited elsewhere is chain A, and a Style hard-coding `C` renders the wrong half of
  somebody else's file, or nothing at all. So the pass names a **rule** instead -- two pairs of
  them, because the two halves of the Interfaces row pick their partner differently:

      scope: 'largest_chain'   -- the protein chain with the most residues
      scope: 'other_chains'    -- every other protein chain, however many there are
      scope: 'larger_chains'   -- every protein chain but the smallest
      scope: 'smallest_chain'  -- the one protein chain with the fewest residues

  The first pair is a domain interface, whose partner is a polymer and may be several chains: a Fab
  is two. The second is a peptide interface, whose partner is drawn atom by atom and must therefore
  be one small chain -- on a three-chain file `other_chains` puts that look on two subunits at once,
  which is the whole reason `smallest_chain` exists.

  There is no predicate, no count, no threshold and no chain id: `resolveOverlayScope()` below reads
  the residue lists the structure walk already produced and
  groups them by chain, so the answer comes from the file rather than from the catalogue. That is
  the same discipline `component` follows -- a pass names a constant, and the structure supplies the
  atoms -- which is what keeps it inside the "no atom or spatial selection languages" rule.

  Each pair partitions the protein, so a Style carrying both of one covers all of it and masks the
  base away exactly as an unscoped whole-protein pass does. A single-chain structure is no interface
  at all: the host scope takes the whole protein and the partner scope matches nothing, which
  `applyStyleOverlays()` drops -- a monomer drawn in the interface Style's "big side" look, which is
  the reasonable reading of that file rather than an error.

  Protein only. The rule is about telling two binding partners apart, and there is no such thing as
  the largest ligand chain.
*/
// Which half of the interface each scope names. One table: main.js resolves the single-chain case
// off it, and `styleWithScheme()` paints duo[0] on the host side and duo[1] on the partner.
export const OVERLAY_SCOPE_SIDES = {
  largest_chain: 'host',
  other_chains: 'partner',
  larger_chains: 'host',
  smallest_chain: 'partner',
};

export const OVERLAY_SCOPES = Object.keys(OVERLAY_SCOPE_SIDES);

const NAMES_ONE_CHAIN = new Set(['largest_chain', 'smallest_chain']);

/*
  Which residues a scope covers, given the residue list the structure walk already produced.

  Here rather than in main.js because it is the one half of a pass that is pure: `from: 'base'`
  needs the live controls, `scope` needs nothing but `chain_id`, and a rule the whole feature turns
  on should be testable by handing it rows. Grouping is one pass over data already in memory -- no
  second walk over the structure, and no Mol* query.

  Ties break on the chain id, ascending, so a homodimer whose two chains have exactly the same
  residue count resolves the same way every time it is loaded rather than following whatever order
  the file happened to list them in. Which of two identical chains is "the big one" does not matter;
  that the answer is stable does, because the two sides render differently. The same rule picks the
  smallest, so the lowest chain id wins either question.

  One chain is no interface, and the pair degrades rather than half-rendering: the host scope takes
  the whole protein and the partner scope matches nothing, which `applyStyleOverlays()` drops.

  Returns the *whole* list for an unscoped pass.
*/
export function resolveOverlayScope(residues, scope) {
  if (!scope) return residues;
  const byChain = new Map();
  residues.forEach((residue) => {
    const chain = residue.chain_id ?? '';
    if (!byChain.has(chain)) byChain.set(chain, []);
    byChain.get(chain).push(residue);
  });
  if (byChain.size === 0) return [];
  if (byChain.size === 1) return OVERLAY_SCOPE_SIDES[scope] === 'host' ? residues : [];
  const wantsBiggest = scope === 'largest_chain' || scope === 'other_chains';
  let picked;
  [...byChain.keys()]
    .sort((left, right) => String(left).localeCompare(String(right)))
    .forEach((chain) => {
      if (picked === undefined) {
        picked = chain;
        return;
      }
      const size = byChain.get(chain).length;
      const best = byChain.get(picked).length;
      if (wantsBiggest ? size > best : size < best) picked = chain;
    });
  if (NAMES_ONE_CHAIN.has(scope)) return byChain.get(picked);
  return residues.filter((residue) => (residue.chain_id ?? '') !== picked);
}

/*
  Everything a pass may carry, and the reason each one is allowed: it is a property of how the
  atoms are *drawn*, never of which atoms they are. `representation` uses the resolved vocabulary --
  `cartoon_railed`, `side_chain_sticks`, `ribbon_slender`, `surface` -- which is the same string a
  saved session's layer carries, so a pass and a hand-made layer are the same kind of thing.
*/
export const OVERLAY_FIELDS = new Set([
  'component',
  'scope',
  'from',
  'name',
  'representation',
  'representation_settings',
  'material',
  'color_mode',
  'color',
  'gradient_start',
  'gradient_end',
  'opacity',
  'emission_strength',
]);

/*
  Named individually rather than caught by the allowlist above, so the error says which rule was
  broken instead of "unknown field". These are the keys a real selection layer carries in a session
  document, which is exactly the shape someone would reach for when trying to pin a pass to part of
  a structure -- and the point at which a Style would stop being a preset and start being a saved
  selection for one specific protein.
*/
const SELECTION_KEYS = [
  'residues',
  'residue_ranges',
  'residue_count',
  'chains',
  'chain_id',
  'items',
  'auth_asym_id',
  'loci',
  'snapshot',
  'selection',
];


function assertNoSelection(styleId, pass) {
  for (const key of SELECTION_KEYS) {
    if (key in pass) {
      throw new Error(
        `Style ${styleId} overlay names ${JSON.stringify(key)}. An overlay pass is scoped to a `
        + 'whole component and may never name a chain, a residue, a range, or an atom.',
      );
    }
  }
}


/*
  Validate and normalise a Style's passes. Pure, so the rule above can be tested without a DOM and
  without Mol* -- the same seam styleWrites() uses.

  Returns the passes in author order, which is the order they become layers. Order is not cosmetic:
  it is the order the right rail lists them in and the order Mol*'s last-layer-wins colour preview
  reads, so a shell authored after the cartoon it covers previews as the shell.
*/
export function styleOverlays(style) {
  const passes = style?.overlays ?? [];
  if (!Array.isArray(passes)) {
    throw new Error(`Style ${style?.id} declares overlays that are not a list.`);
  }
  return passes.map((pass, index) => {
    const where = `${style?.id} overlay ${index + 1}`;
    if (!pass || typeof pass !== 'object' || Array.isArray(pass)) {
      throw new Error(`Style ${where} is not an overlay pass.`);
    }
    assertNoSelection(style?.id, pass);
    for (const key of Object.keys(pass)) {
      if (!OVERLAY_FIELDS.has(key)) {
        throw new Error(`Style ${where} writes unsupported field ${JSON.stringify(key)}.`);
      }
    }
    if (!OVERLAY_COMPONENTS.includes(pass.component)) {
      throw new Error(
        `Style ${where} targets ${JSON.stringify(pass.component)}; `
        + `an overlay pass targets one of ${OVERLAY_COMPONENTS.join(', ')}.`,
      );
    }
    if (pass.from !== undefined && pass.from !== 'base') {
      throw new Error(`Style ${where} sets from=${JSON.stringify(pass.from)}; only 'base' exists.`);
    }
    /*
      The scope axis, checked as narrowly as the component one. Four named values, protein only, and
      never on a mirror: `from: 'base'` means "whatever the base controls say", and a base has no
      side of an interface to be on.
    */
    if (pass.scope !== undefined) {
      if (!OVERLAY_SCOPES.includes(pass.scope)) {
        throw new Error(
          `Style ${where} scopes to ${JSON.stringify(pass.scope)}; `
          + `an overlay pass scopes to one of ${OVERLAY_SCOPES.join(', ')}, or to the whole component.`,
        );
      }
      if (pass.component !== 'protein') {
        throw new Error(
          `Style ${where} scopes a ${pass.component} pass to ${JSON.stringify(pass.scope)}. `
          + 'Chain scopes are protein-only: they exist to tell two binding partners apart.',
        );
      }
      if (pass.from === 'base') {
        throw new Error(
          `Style ${where} mirrors the base and also scopes to ${JSON.stringify(pass.scope)}. `
          + 'A from:"base" pass carries the base look over the whole component.',
        );
      }
    }
    /*
      A `from: 'base'` pass is a reference, not a description. Letting it also carry a material or a
      colour would make it half a mirror -- and leave the reader guessing which half won.
    */
    if (pass.from === 'base') {
      const extra = Object.keys(pass).filter((key) => !['component', 'from', 'name'].includes(key));
      if (extra.length > 0) {
        throw new Error(
          `Style ${where} mirrors the base and also sets ${extra.join(', ')}. `
          + 'A from:"base" pass carries no appearance of its own.',
        );
      }
    }
    return { ...pass };
  });
}


/*
  Which components a Style's passes touch. `applyStyleOverlays()` uses this to skip a Style's
  nucleic passes on a structure that has no nucleic acid, rather than building an empty layer: a
  layer matching nothing is a row in the right rail that renders nothing and cannot be explained.
*/
export function overlayComponents(style) {
  return [...new Set(styleOverlays(style).map((pass) => pass.component))];
}


/*
  The trap in the header, as a check the catalogue can be held to.

  A Style whose protein passes do not include a `from: 'base'` mirror renders no protein base at
  all, because the passes mask it away. That is legitimate when the passes *are* the whole picture
  (a lone bright ligand over a ghost), and a mistake when the Style also describes a base
  appearance it expects to see -- which is the case that looks plausible in a thumbnail and is
  wrong in the render.
*/
/*
  A scoped pass counts here exactly as an unscoped one does, and that is deliberate rather than an
  oversight. Each scope pair partitions the protein, so the interface Styles -- which carry one host
  pass and one partner pass -- really do mask their base away and really must state no base
  appearance. A Style carrying only one scope would leave the other side of the structure on the
  base, but no such Style ships and reporting "masked" for it is the conservative answer: it forbids
  base writes the reader cannot see on the half the pass covers.
*/
export function overlayMasksBase(style, component) {
  return styleOverlays(style).some((pass) => pass.component === component)
    && !styleOverlays(style).some((pass) => pass.component === component && pass.from === 'base');
}
