const PLDDT_MARKER = /(?:\bPLDDT\b|PREDICTED[ _-]*LDDT|ALPHAFOLD)/i;
/*
  `ELECTRON MICROSCOPY` is the EXPDTA value single-particle cryo-EM uses, and its B-factor column
  carries refined B-factors like any other experimental method. Leaving it out meant cryo-EM
  structures were offered no metric colouring at all.
*/
const EXPERIMENTAL_METHOD = /(?:X-RAY DIFFRACTION|NEUTRON DIFFRACTION|ELECTRON (?:CRYSTALLOGRAPHY|DIFFRACTION|MICROSCOPY))/i;


function pdbHasNumericBFactor(text) {
  return text.split(/\r?\n/).some((line) => {
    if (!line.startsWith('ATOM  ') && !line.startsWith('HETATM')) return false;
    const value = Number(line.slice(60, 66).trim());
    return Number.isFinite(value);
  });
}


/*
  A file that declares an experimental method is experimental, whatever else it mentions. This is
  a veto rather than a preference because `PLDDT_MARKER` matches prose: a cryo-EM structure whose
  REMARK 3 reads "THE ALPHAFOLD MODEL WAS FLEXIBLY FITTED TO THE MAP" was being offered pLDDT
  colouring over a column holding refined B-factors. Fitting an AlphaFold model into a map is
  routine now, and the two scales mean opposite things -- high pLDDT is confident, high B-factor
  is mobile -- so the mislabelled render read as confidence data it did not contain.
*/
function declaresExperimentalMethod(source, extension) {
  if (extension === 'pdb') {
    return source.split(/\r?\n/).some(
      (line) => line.startsWith('EXPDTA') && EXPERIMENTAL_METHOD.test(line),
    );
  }
  return EXPERIMENTAL_METHOD.test(source);
}


/** Return the one semantically relevant structure-metric colour, if any. */
export function detectStructureMetric(text, filename = '') {
  const source = String(text ?? '');
  const extension = String(filename).toLowerCase().split('.').pop();
  const experimental = declaresExperimentalMethod(source, extension);

  if (extension === 'pdb') {
    if (!pdbHasNumericBFactor(source)) return undefined;
    if (experimental) return 'bfactor';
    return PLDDT_MARKER.test(source) ? 'plddt' : undefined;
  }
  if (extension === 'cif') {
    // ModelCIF names its confidence column outright, so it is evidence about the data rather
    // than about provenance -- but an experimental method still wins.
    const modelCifPlddt = /_ma_qa_metric_local\.metric_value/i.test(source)
      && /_ma_qa_metric\.(?:name|type|mode)/i.test(source)
      && PLDDT_MARKER.test(source);
    if (modelCifPlddt && !experimental) return 'plddt';
    if (experimental && /_atom_site\.B_iso_or_equiv/i.test(source)) return 'bfactor';
  }
  return undefined;
}
