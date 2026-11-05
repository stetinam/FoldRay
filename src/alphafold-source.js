import { responseBytesAtMost } from './bounded-read.js';
import { MAX_PDB_DOWNLOAD_BYTES } from './pdb-source.js';

const UNIPROT_PATTERN = /^(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})$/i;
const ALPHAFOLD_API_ROOT = 'https://alphafold.ebi.ac.uk/api/prediction';
const ALPHAFOLD_FILES_ROOT = 'https://alphafold.ebi.ac.uk/files/';
// `AF-P42212-F1-model_v6.cif`. No leading zeros, so a name and its numbers map one to one.
const ALPHAFOLD_FILENAME_PATTERN = /^AF-([A-Z0-9-]+)-F([1-9][0-9]*)-model_v([1-9][0-9]*)\.cif$/;


export function normalizeUniProtAccession(value) {
  return String(value ?? '').trim().toUpperCase();
}


export function validatedUniProtAccession(value) {
  const accession = normalizeUniProtAccession(value);
  if (!UNIPROT_PATTERN.test(accession)) {
    throw new Error('Enter a UniProt accession, such as P69905.');
  }
  return accession;
}


/**
 * `{ accession, fragment, version }` for a model file AlphaFold DB names, or `undefined` for any
 * other name. An isoform's file (`AF-P05067-2-F1-…`) is `undefined`: its accession does not validate.
 */
export function alphaFoldAccessionFromFilename(name) {
  const match = typeof name === 'string' ? ALPHAFOLD_FILENAME_PATTERN.exec(name) : null;
  if (!match) return undefined;
  const [, accession, fragment, version] = match;
  try {
    if (validatedUniProtAccession(accession) !== accession) return undefined;
  } catch {
    return undefined;
  }
  const numbers = { fragment: Number(fragment), version: Number(version) };
  if (!Number.isSafeInteger(numbers.fragment) || !Number.isSafeInteger(numbers.version)) return undefined;
  return { accession, ...numbers };
}


function downloadSizeMessage(accession) {
  return `AlphaFold DB entry ${accession} is larger than the ${MAX_PDB_DOWNLOAD_BYTES / (1024 * 1024)} MB structure limit.`;
}


/*
  The model file the API names for exactly this accession, as `{ url, filename }`.

  The model version climbs and varies per entry (P05067 is on v6, many others still v4), so the URL
  is looked up rather than guessed. The API lists every isoform under the accession's prefix: no
  exact match is a refusal, never another entry's model. The URL is the server's answer, so it is
  held to the one shape the archive serves.
*/
async function resolveAlphaFoldCif(accession, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(`${ALPHAFOLD_API_ROOT}/${accession}`, {
      headers: { Accept: 'application/json' },
    });
  } catch (error) {
    throw new Error(`Could not reach AlphaFold DB for ${accession}. Check the internet connection.`);
  }

  if (response.status === 404) {
    throw new Error(`AlphaFold DB entry ${accession} was not found.`);
  }
  if (!response.ok) {
    throw new Error(`AlphaFold DB could not look up ${accession} (HTTP ${response.status}).`);
  }

  let entries;
  try {
    entries = await response.json();
  } catch (error) {
    throw new Error(`AlphaFold DB returned an unreadable response for ${accession}.`);
  }

  const entry = Array.isArray(entries)
    ? entries.find((item) => normalizeUniProtAccession(item?.uniprotAccession) === accession)
    : undefined;
  if (!entry?.cifUrl) {
    throw new Error(`AlphaFold DB entry ${accession} was not found.`);
  }

  let href = '';
  try {
    if (typeof entry.cifUrl === 'string') href = new URL(entry.cifUrl).href;
  } catch {
    // Not a URL at all: refused below with the rest.
  }
  // On the serialised URL, a prefix rules out another scheme, host, port or credentials, and the
  // anchored name a query, a fragment or a deeper path.
  const filename = href.startsWith(ALPHAFOLD_FILES_ROOT) ? href.slice(ALPHAFOLD_FILES_ROOT.length) : '';
  if (alphaFoldAccessionFromFilename(filename)?.accession !== accession) {
    throw new Error(`AlphaFold DB named a model file for ${accession} that is not one of its own.`);
  }
  return { url: href, filename };
}


export async function downloadAlphaFoldStructure(value, fetchImpl = fetch) {
  const accession = validatedUniProtAccession(value);
  const cif = await resolveAlphaFoldCif(accession, fetchImpl);

  let response;
  try {
    response = await fetchImpl(cif.url, {
      headers: { Accept: 'chemical/x-cif,text/plain;q=0.9,*/*;q=0.1' },
    });
  } catch (error) {
    throw new Error(`Could not reach AlphaFold DB for ${accession}. Check the internet connection.`);
  }

  if (response.status === 404) {
    throw new Error(`AlphaFold DB entry ${accession} was not found.`);
  }
  if (!response.ok) {
    throw new Error(`AlphaFold DB could not download ${accession} (HTTP ${response.status}).`);
  }

  const data = await responseBytesAtMost(response, MAX_PDB_DOWNLOAD_BYTES, {
    tooLarge: () => new Error(downloadSizeMessage(accession)),
    unreadable: () => new Error(`The download for AlphaFold DB entry ${accession} could not be read.`),
  });
  if (data.byteLength === 0) {
    throw new Error(`AlphaFold DB returned an empty file for ${accession}.`);
  }

  return {
    data,
    filename: cif.filename,
    accession,
  };
}
