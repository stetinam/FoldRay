import { responseBytesAtMost } from './bounded-read.js';

export const MAX_PDB_DOWNLOAD_BYTES = 64 * 1024 * 1024;

const PDB_ID_PATTERN = /^[0-9][A-Z0-9]{3}$/;
const PDB_DOWNLOAD_ROOT = 'https://files.rcsb.org/download';


export function normalizePdbId(value) {
  return String(value ?? '').trim().toUpperCase();
}


export function validatedPdbId(value) {
  const pdbId = normalizePdbId(value);
  if (!PDB_ID_PATTERN.test(pdbId)) {
    throw new Error('Enter a four-character PDB ID, such as 4HHB.');
  }
  return pdbId;
}


export function pdbDownloadUrl(value) {
  return `${PDB_DOWNLOAD_ROOT}/${validatedPdbId(value)}.cif`;
}


/** The ID of a file `downloadPdbStructure()` named, or `undefined` for any other name. */
export function pdbIdFromFilename(name) {
  const id = typeof name === 'string' && name.endsWith('.cif') ? name.slice(0, -'.cif'.length) : '';
  return PDB_ID_PATTERN.test(id) ? id : undefined;
}


function downloadSizeMessage(pdbId) {
  return `PDB entry ${pdbId} is larger than the ${MAX_PDB_DOWNLOAD_BYTES / (1024 * 1024)} MB structure limit.`;
}


export async function downloadPdbStructure(value, fetchImpl = fetch) {
  const pdbId = validatedPdbId(value);
  let response;
  try {
    response = await fetchImpl(pdbDownloadUrl(pdbId), {
      headers: { Accept: 'chemical/x-cif,text/plain;q=0.9,*/*;q=0.1' },
    });
  } catch (error) {
    throw new Error(`Could not reach RCSB PDB for ${pdbId}. Check the internet connection.`);
  }

  if (response.status === 404) {
    throw new Error(`PDB entry ${pdbId} was not found.`);
  }
  if (!response.ok) {
    throw new Error(`RCSB PDB could not download ${pdbId} (HTTP ${response.status}).`);
  }

  const data = await responseBytesAtMost(response, MAX_PDB_DOWNLOAD_BYTES, {
    tooLarge: () => new Error(downloadSizeMessage(pdbId)),
    unreadable: () => new Error(`The download for PDB entry ${pdbId} could not be read.`),
  });
  if (data.byteLength === 0) {
    throw new Error(`RCSB PDB returned an empty file for ${pdbId}.`);
  }

  return {
    data,
    filename: `${pdbId}.cif`,
    pdbId,
  };
}
