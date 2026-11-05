/*
  Binned-SAH BVH over mixed analytic primitives and ribbon triangles.
  Nodes are two vec4s: (min.xyz, leftOrFirst) and (max.xyz, countOrZero).

  **This build is the app's largest single stall and the code is written for that**, so it reads
  flatter than the arithmetic it does. The tree is rebuilt on every representation edit, every
  structure load and every Style apply, because the viewport is live -- and a big cartoon is
  millions of triangles.

  Four things are deliberate and none of them changes a node:

  * **A node's boxes come from its parent's bins, so only the root is ever scanned for them.** The
    bins already hold the union of every primitive that falls in them, and a child is a contiguous
    run of bins, so the prefix/suffix sweep that chooses the split has *also* computed both of the
    child's boxes by the time it is pushed. That takes the build from two passes over every range to
    one. The centroid box is binned alongside the geometric one for the same reason -- it is what
    sizes the next level's bins.
  * **The SAH sweep is a prefix/suffix pair rather than `BINS` re-scans.** Twelve bins were being
    re-accumulated eleven times for every node in the tree.
  * **The bin a primitive fell in is remembered rather than recomputed** for the partition, which is
    the only other place it is needed.
  * **Nothing per node is allocated.** The nodes are a growable `Float32Array` in their final GPU
    layout, the stack is flat, and the bin accumulators are scratch reused down the whole build --
    in place of an object per node, an object per stack entry and ten small arrays per split.

  **Every one of those is exact rather than nearly exact**, which is what lets the picture baseline
  go on comparing bytes:
  `Math.min`/`Math.max` are exact operations, so a bound accumulated in a different order -- or
  accumulated once in a parent instead of twice in its children -- is the same float; the split loop
  visits the same splits in the same order, so a cost tie breaks the same way; and the partition is
  the same swap loop over the same `order` array. The awkward inputs are one primitive, coincident
  centroids, and a range that will not partition.
*/

const BINS = 12;

// Two vec4s a node, which is the layout `pathtrace.wgsl` reads.
const NODE_STRIDE = 8;
// Primitives at or below this in a range become a leaf rather than being split.
const LEAF_SIZE = 4;

/*
  Scratch reused across every node of every build: twelve bins of count, geometric box and centroid
  box, and the sweeps the split search runs over them. Sized by `BINS` alone, so one allocation
  serves a structure of any size.

  The centroid box is binned because it is what the *child* needs to size its own bins with, and
  binning it here is what saves the child a pass over its own range.
*/
const binCounts = new Uint32Array(BINS);
const binMin = new Float64Array(BINS * 3);
const binMax = new Float64Array(BINS * 3);
const binCentroidMin = new Float64Array(BINS * 3);
const binCentroidMax = new Float64Array(BINS * 3);
// `suffixArea[split]` is the surface area of bins `split..BINS-1`, and `suffixCount` their count.
const suffixArea = new Float64Array(BINS + 1);
const suffixCount = new Float64Array(BINS + 1);
// The right-hand child's two boxes at each split, so the winning split's are in hand without a
// second sweep. Six floats of geometric box then six of centroid box, per split.
const suffixBoxes = new Float64Array((BINS + 1) * 12);
// One box pair, in the same twelve-float layout, handed between the sweep and the stack.
const box = new Float64Array(12);

function surface(minX, minY, minZ, maxX, maxY, maxZ) {
  const dx = maxX > minX ? maxX - minX : 0;
  const dy = maxY > minY ? maxY - minY : 0;
  const dz = maxZ > minZ ? maxZ - minZ : 0;
  return 2 * (dx * dy + dy * dz + dz * dx);
}

export function buildBvh(bounds, count) {
  const centroids = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const at = index * 6;
    centroids[index * 3] = 0.5 * (bounds[at] + bounds[at + 3]);
    centroids[index * 3 + 1] = 0.5 * (bounds[at + 1] + bounds[at + 4]);
    centroids[index * 3 + 2] = 0.5 * (bounds[at + 2] + bounds[at + 5]);
  }
  const order = new Uint32Array(count);
  for (let index = 0; index < count; index += 1) order[index] = index;
  // Which bin each primitive fell in, by primitive rather than by position -- the partition swaps
  // positions, so it is the primitive that has to carry it. Written by the binning pass and read by
  // the partition, which is the only other place the answer is wanted.
  const binOf = new Uint8Array(count);

  /*
    The nodes, in their final GPU layout, grown by doubling.

    A binary tree over `n` primitives with leaves of four has at most `2 * ceil(n / 4) - 1` nodes,
    so the first guess is right for almost every scene and the doubling is the safety net rather
    than the plan.
  */
  let capacity = Math.max(8, Math.min(count * 2 + 1, 2 * Math.ceil(count / LEAF_SIZE) + 1));
  let nodes = new Float32Array(capacity * NODE_STRIDE);
  let nodeCount = 0;
  const reserve = () => {
    if (nodeCount === capacity) {
      capacity *= 2;
      const grown = new Float32Array(capacity * NODE_STRIDE);
      grown.set(nodes);
      nodes = grown;
    }
    nodeCount += 1;
    return nodeCount - 1;
  };

  /*
    (node, start, end) triples, with the node's two boxes beside them.

    Carrying twelve floats per entry is what buys the whole second pass: a child's geometric box and
    centroid box are both unions of its parent's bins, so the parent knows them and nothing has to
    read the range again. A node is only pushed once, so the stack never holds more than the tree is
    deep -- 64 levels is far past what a doubling split reaches on any real scene, and it grows if
    it ever does.
  */
  let stack = new Int32Array(4 * 64);
  let stackBoxes = new Float64Array(12 * 64);
  let stackSize = 0;
  /*
    How deep the deepest leaf is, carried out with the tree.

    `pathtrace.wgsl`'s traversal keeps a fixed 40-entry stack and **silently declines to descend**
    past it -- no throw, no note, a subtree of geometry simply absent from the picture. Geometry
    silently missing from the picture is the worst failure shape here, so this is the number that
    reports it: `prepareSceneGeometry()` hands it up, and `renderer.js` turns a tree as deep as
    the shader's stack into a scene note.

    It is nowhere near today and the measurement is why the guard is worth having rather than worth
    panicking about: 20 on 3RGK's cartoon, 27 on 10EC's, **28 on 1AON's 3,010,480 triangles**, and
    depth grows with the logarithm of the primitive count. Twelve levels of headroom is not a reason
    to stop counting.
  */
  let maxDepth = 0;
  const pushRange = (node, start, end, boxes, from, depth) => {
    if (stackSize + 4 > stack.length) {
      const grown = new Int32Array(stack.length * 2);
      grown.set(stack);
      stack = grown;
      const grownBoxes = new Float64Array(stackBoxes.length * 2);
      grownBoxes.set(stackBoxes);
      stackBoxes = grownBoxes;
    }
    stack[stackSize] = node;
    stack[stackSize + 1] = start;
    stack[stackSize + 2] = end;
    stack[stackSize + 3] = depth;
    for (let slot = 0; slot < 12; slot += 1) stackBoxes[(stackSize / 4) * 12 + slot] = boxes[from + slot];
    stackSize += 4;
  };

  // The root is the one range that is scanned for its boxes, because it has no parent to have
  // binned them.
  box.fill(Infinity, 0, 6);
  box.fill(-Infinity, 6, 12);
  for (let index = 0; index < count; index += 1) {
    const b = index * 6;
    if (bounds[b] < box[0]) box[0] = bounds[b];
    if (bounds[b + 1] < box[1]) box[1] = bounds[b + 1];
    if (bounds[b + 2] < box[2]) box[2] = bounds[b + 2];
    if (bounds[b + 3] > box[6]) box[6] = bounds[b + 3];
    if (bounds[b + 4] > box[7]) box[7] = bounds[b + 4];
    if (bounds[b + 5] > box[8]) box[8] = bounds[b + 5];
    const c = index * 3;
    if (centroids[c] < box[3]) box[3] = centroids[c];
    if (centroids[c + 1] < box[4]) box[4] = centroids[c + 1];
    if (centroids[c + 2] < box[5]) box[5] = centroids[c + 2];
    if (centroids[c] > box[9]) box[9] = centroids[c];
    if (centroids[c + 1] > box[10]) box[10] = centroids[c + 1];
    if (centroids[c + 2] > box[11]) box[11] = centroids[c + 2];
  }
  const root = reserve();
  pushRange(root, 0, count, box, 0, 0);

  while (stackSize > 0) {
    stackSize -= 4;
    const node = stack[stackSize];
    const start = stack[stackSize + 1];
    const end = stack[stackSize + 2];
    const depth = stack[stackSize + 3];
    if (depth > maxDepth) maxDepth = depth;
    const boxAt = (stackSize / 4) * 12;
    const at = node * NODE_STRIDE;

    // Both boxes came down with the range: the geometric one goes straight into the node's record,
    // and the centroid one decides the split axis and the bin scale below.
    const minX = stackBoxes[boxAt]; const minY = stackBoxes[boxAt + 1];
    const minZ = stackBoxes[boxAt + 2];
    const cminX = stackBoxes[boxAt + 3]; const cminY = stackBoxes[boxAt + 4];
    const cminZ = stackBoxes[boxAt + 5];
    const maxX = stackBoxes[boxAt + 6]; const maxY = stackBoxes[boxAt + 7];
    const maxZ = stackBoxes[boxAt + 8];
    const cmaxX = stackBoxes[boxAt + 9]; const cmaxY = stackBoxes[boxAt + 10];
    const cmaxZ = stackBoxes[boxAt + 11];
    nodes[at] = minX; nodes[at + 1] = minY; nodes[at + 2] = minZ;
    nodes[at + 4] = maxX; nodes[at + 5] = maxY; nodes[at + 6] = maxZ;

    const total = end - start;
    if (total <= LEAF_SIZE) {
      nodes[at + 3] = start;
      nodes[at + 7] = total;
      continue;
    }

    // Split along the widest centroid axis, first axis winning a tie -- which is what a strict
    // `>` over 0, 1, 2 does.
    let axis = 0;
    let widest = cmaxX - cminX;
    const spanY = cmaxY - cminY;
    const spanZ = cmaxZ - cminZ;
    if (spanY > widest) { widest = spanY; axis = 1; }
    if (spanZ > widest) { widest = spanZ; axis = 2; }
    if (widest < 1e-9) {
      nodes[at + 3] = start;
      nodes[at + 7] = total;
      continue;
    }
    const axisMin = axis === 0 ? cminX : axis === 1 ? cminY : cminZ;
    const binScale = BINS / widest;

    binCounts.fill(0);
    binMin.fill(Infinity);
    binMax.fill(-Infinity);
    binCentroidMin.fill(Infinity);
    binCentroidMax.fill(-Infinity);
    for (let index = start; index < end; index += 1) {
      const primitive = order[index];
      const c = primitive * 3;
      const cx = centroids[c]; const cy = centroids[c + 1]; const cz = centroids[c + 2];
      const along = axis === 0 ? cx : axis === 1 ? cy : cz;
      const raw = Math.floor((along - axisMin) * binScale);
      const bin = raw < BINS - 1 ? raw : BINS - 1;
      binCounts[bin] += 1;
      binOf[primitive] = bin;
      const b = primitive * 6;
      const slot = bin * 3;
      if (bounds[b] < binMin[slot]) binMin[slot] = bounds[b];
      if (bounds[b + 1] < binMin[slot + 1]) binMin[slot + 1] = bounds[b + 1];
      if (bounds[b + 2] < binMin[slot + 2]) binMin[slot + 2] = bounds[b + 2];
      if (bounds[b + 3] > binMax[slot]) binMax[slot] = bounds[b + 3];
      if (bounds[b + 4] > binMax[slot + 1]) binMax[slot + 1] = bounds[b + 4];
      if (bounds[b + 5] > binMax[slot + 2]) binMax[slot + 2] = bounds[b + 5];
      if (cx < binCentroidMin[slot]) binCentroidMin[slot] = cx;
      if (cy < binCentroidMin[slot + 1]) binCentroidMin[slot + 1] = cy;
      if (cz < binCentroidMin[slot + 2]) binCentroidMin[slot + 2] = cz;
      if (cx > binCentroidMax[slot]) binCentroidMax[slot] = cx;
      if (cy > binCentroidMax[slot + 1]) binCentroidMax[slot + 1] = cy;
      if (cz > binCentroidMax[slot + 2]) binCentroidMax[slot + 2] = cz;
    }

    /*
      The SAH sweep, right to left then left to right.

      The costs are exactly the ones the eleven-scan version computed -- `Math.min`/`Math.max` are
      exact, so a box accumulated by sweeping is the same box, and the splits are visited in the
      same ascending order, so an equal cost still leaves the earlier split standing.

      The right-hand sweep keeps its running boxes per split as well as their area, because the
      winning split's pair is the right child's two boxes and re-deriving them afterwards would put
      the pass back that this exists to remove.
    */
    suffixArea[BINS] = 0;
    suffixCount[BINS] = 0;
    let rMinX = Infinity; let rMinY = Infinity; let rMinZ = Infinity;
    let rMaxX = -Infinity; let rMaxY = -Infinity; let rMaxZ = -Infinity;
    let rcMinX = Infinity; let rcMinY = Infinity; let rcMinZ = Infinity;
    let rcMaxX = -Infinity; let rcMaxY = -Infinity; let rcMaxZ = -Infinity;
    let rCount = 0;
    for (let bin = BINS - 1; bin >= 1; bin -= 1) {
      if (binCounts[bin] > 0) {
        const slot = bin * 3;
        if (binMin[slot] < rMinX) rMinX = binMin[slot];
        if (binMin[slot + 1] < rMinY) rMinY = binMin[slot + 1];
        if (binMin[slot + 2] < rMinZ) rMinZ = binMin[slot + 2];
        if (binMax[slot] > rMaxX) rMaxX = binMax[slot];
        if (binMax[slot + 1] > rMaxY) rMaxY = binMax[slot + 1];
        if (binMax[slot + 2] > rMaxZ) rMaxZ = binMax[slot + 2];
        if (binCentroidMin[slot] < rcMinX) rcMinX = binCentroidMin[slot];
        if (binCentroidMin[slot + 1] < rcMinY) rcMinY = binCentroidMin[slot + 1];
        if (binCentroidMin[slot + 2] < rcMinZ) rcMinZ = binCentroidMin[slot + 2];
        if (binCentroidMax[slot] > rcMaxX) rcMaxX = binCentroidMax[slot];
        if (binCentroidMax[slot + 1] > rcMaxY) rcMaxY = binCentroidMax[slot + 1];
        if (binCentroidMax[slot + 2] > rcMaxZ) rcMaxZ = binCentroidMax[slot + 2];
        rCount += binCounts[bin];
      }
      suffixArea[bin] = rCount > 0 ? surface(rMinX, rMinY, rMinZ, rMaxX, rMaxY, rMaxZ) : 0;
      suffixCount[bin] = rCount;
      const keep = bin * 12;
      suffixBoxes[keep] = rMinX; suffixBoxes[keep + 1] = rMinY; suffixBoxes[keep + 2] = rMinZ;
      suffixBoxes[keep + 3] = rcMinX; suffixBoxes[keep + 4] = rcMinY; suffixBoxes[keep + 5] = rcMinZ;
      suffixBoxes[keep + 6] = rMaxX; suffixBoxes[keep + 7] = rMaxY; suffixBoxes[keep + 8] = rMaxZ;
      suffixBoxes[keep + 9] = rcMaxX; suffixBoxes[keep + 10] = rcMaxY; suffixBoxes[keep + 11] = rcMaxZ;
    }

    let bestCost = Infinity;
    let bestSplit = -1;
    let lMinX = Infinity; let lMinY = Infinity; let lMinZ = Infinity;
    let lMaxX = -Infinity; let lMaxY = -Infinity; let lMaxZ = -Infinity;
    let lcMinX = Infinity; let lcMinY = Infinity; let lcMinZ = Infinity;
    let lcMaxX = -Infinity; let lcMaxY = -Infinity; let lcMaxZ = -Infinity;
    let lCount = 0;
    for (let split = 1; split < BINS; split += 1) {
      const bin = split - 1;
      if (binCounts[bin] > 0) {
        const slot = bin * 3;
        if (binMin[slot] < lMinX) lMinX = binMin[slot];
        if (binMin[slot + 1] < lMinY) lMinY = binMin[slot + 1];
        if (binMin[slot + 2] < lMinZ) lMinZ = binMin[slot + 2];
        if (binMax[slot] > lMaxX) lMaxX = binMax[slot];
        if (binMax[slot + 1] > lMaxY) lMaxY = binMax[slot + 1];
        if (binMax[slot + 2] > lMaxZ) lMaxZ = binMax[slot + 2];
        if (binCentroidMin[slot] < lcMinX) lcMinX = binCentroidMin[slot];
        if (binCentroidMin[slot + 1] < lcMinY) lcMinY = binCentroidMin[slot + 1];
        if (binCentroidMin[slot + 2] < lcMinZ) lcMinZ = binCentroidMin[slot + 2];
        if (binCentroidMax[slot] > lcMaxX) lcMaxX = binCentroidMax[slot];
        if (binCentroidMax[slot + 1] > lcMaxY) lcMaxY = binCentroidMax[slot + 1];
        if (binCentroidMax[slot + 2] > lcMaxZ) lcMaxZ = binCentroidMax[slot + 2];
        lCount += binCounts[bin];
      }
      const rightCount = suffixCount[split];
      if (lCount === 0 || rightCount === 0) continue;
      const cost = lCount * surface(lMinX, lMinY, lMinZ, lMaxX, lMaxY, lMaxZ)
        + rightCount * suffixArea[split];
      if (cost < bestCost) {
        bestCost = cost;
        bestSplit = split;
        box[0] = lMinX; box[1] = lMinY; box[2] = lMinZ;
        box[3] = lcMinX; box[4] = lcMinY; box[5] = lcMinZ;
        box[6] = lMaxX; box[7] = lMaxY; box[8] = lMaxZ;
        box[9] = lcMaxX; box[10] = lcMaxY; box[11] = lcMaxZ;
      }
    }
    if (bestSplit < 0) {
      nodes[at + 3] = start;
      nodes[at + 7] = total;
      continue;
    }

    let low = start;
    let high = end - 1;
    while (low <= high) {
      const primitive = order[low];
      if (binOf[primitive] < bestSplit) { low += 1; } else {
        order[low] = order[high];
        order[high] = primitive;
        high -= 1;
      }
    }
    const middle = low;
    if (middle === start || middle === end) {
      nodes[at + 3] = start;
      nodes[at + 7] = total;
      continue;
    }
    const left = reserve();
    const right = reserve();
    nodes[node * NODE_STRIDE + 3] = left;
    nodes[node * NODE_STRIDE + 7] = 0;
    /*
      Right first, so the left child is the next range popped -- the order the node indices were
      handed out in, and the order every recorded node count was built with.

      The right child's boxes are the suffix the winning split names; the left child's are in `box`,
      which the search wrote at the moment it accepted that split. Pushing the right one first also
      means `box` is read before the next iteration can overwrite it.
    */
    pushRange(right, middle, end, suffixBoxes, bestSplit * 12, depth + 1);
    pushRange(left, start, middle, box, 0, depth + 1);
  }

  return {
    nodes: nodes.length === nodeCount * NODE_STRIDE
      ? nodes
      : nodes.subarray(0, nodeCount * NODE_STRIDE).slice(),
    order,
    nodeCount,
    maxDepth,
  };
}
