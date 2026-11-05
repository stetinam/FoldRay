const ATOMISTIC_REPRESENTATION = /(?:ball\s*(?:&|and)\s*stick|element sphere|bond cylinder|atomic (?:bond|element)|spacefill|licorice|point|cross)/i;


export function focusGranularityForPick(representationLabel, lociKind) {
  if (lociKind === 'bond-loci' || ATOMISTIC_REPRESENTATION.test(representationLabel ?? '')) {
    return 'atom';
  }
  return 'residue';
}


function finitePoint(point) {
  return Array.isArray(point)
    && point.length === 3
    && point.every((value) => Number.isFinite(Number(value)));
}


export function focusPointFromPositions(positions, atomAccurate, pickPosition) {
  if (!Array.isArray(positions) || positions.length === 0 || !positions.every(finitePoint)) {
    throw new Error('The picked molecular element has no finite atom coordinates.');
  }
  const points = positions.map((point) => point.map(Number));
  if (atomAccurate) {
    let pickedIndex = 0;
    if (finitePoint(pickPosition)) {
      const picked = pickPosition.map(Number);
      let nearestDistance = Number.POSITIVE_INFINITY;
      points.forEach((point, index) => {
        const distance = point.reduce(
          (sum, value, axis) => sum + (value - picked[axis]) ** 2,
          0,
        );
        if (distance < nearestDistance) {
          nearestDistance = distance;
          pickedIndex = index;
        }
      });
    }
    return { position: points[pickedIndex], pickedIndex };
  }
  return {
    position: [0, 1, 2].map(
      (axis) => points.reduce((sum, point) => sum + point[axis], 0) / points.length,
    ),
    pickedIndex: undefined,
  };
}
