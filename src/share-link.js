/*
  A share link: a session document without its structure, carried in the URL fragment.

  The fragment is never sent to the host that serves the page, so a link needs no server and tells
  it nothing. The structure is fetched from the public database its filename names, which is why
  only a structure opened by PDB ID or UniProt accession can be shared this way.

  **The payload is raw DEFLATE against a preset dictionary** -- a typical session document, so a
  link stores what differs from it (measured on nineteen real sessions: a median of ~790 characters
  against ~2,100 without one). `DecompressionStream` takes no dictionary, so the decoder hands it the
  dictionary as a leading stored block and drops those bytes from the output: the untrusted half is
  the browser's own inflater. The encoder is the small one below, since `CompressionStream` takes no
  dictionary either; it only ever sees the user's own document, and every link is decoded and
  compared before it is handed out.

  **Link format 1 and `SHARE_DICTIONARY_1` are one fact.** A link decodes against the dictionary it
  was made with, so that dictionary never changes; a better one is format 2, beside it.
*/
import { readAtMost } from './bounded-read.js';
import { pdbIdFromFilename } from './pdb-source.js';
import { alphaFoldAccessionFromFilename } from './alphafold-source.js';

export const SHARE_LINK_FORMAT = '1';
// Loaded on first use, so a page that neither makes nor opens a link never fetches one.
const DICTIONARY_MODULES = {
  1: () => import('./share-link-dictionary.js').then((module) => module.SHARE_DICTIONARY_1),
};
const dictionaries = new Map();

async function dictionaryFor(format) {
  if (!Object.hasOwn(DICTIONARY_MODULES, format)) return undefined;
  if (!dictionaries.has(format)) {
    dictionaries.set(format, DICTIONARY_MODULES[format]().then((text) => new TextEncoder().encode(text)));
  }
  return dictionaries.get(format);
}

/*
  The site's public address once it has one; a release build then names it in every link, wherever
  the page that made the link was served from -- a preview or per-build address included. Until
  then, and in development, a link names the origin that made it. Always the root: the site is
  served from one, and a host that answers every path with the app would otherwise put whatever
  path the page was reached by into every link made there.
*/
export const PUBLIC_ORIGIN = 'https://www.foldray.org';

export function shareLinkBase(location, { development = false } = {}) {
  if (PUBLIC_ORIGIN && !development) return `${PUBLIC_ORIGIN}/`;
  return `${location.origin}/`;
}

// Refused before decoding. Nineteen real sessions made links of 1.2-3.1 k characters.
export const MAX_SHARE_FRAGMENT_LENGTH = 64 * 1024;
// Counted while inflating, never after: 49 MiB of whitespace deflates to 50 kB. The largest real
// session document is under 20 kB.
export const MAX_SHARE_DOCUMENT_BYTES = 256 * 1024;

const FRAGMENT = /^#(\d{1,3})\.([A-Za-z0-9_-]+)$/;


export function toBase64Url(bytes) {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}


function fromBase64Url(text) {
  if (text.length % 4 === 1) throw new Error('damaged');
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}


/*
  DEFLATE with fixed Huffman codes (RFC 1951 §3.2.6) over a greedy LZ77 whose window starts inside
  the dictionary. Fixed codes cost ~15% against dynamic ones on these documents and need no tables.
*/
const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83,
  99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5,
  5, 0];
const DISTANCE_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769,
  1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DISTANCE_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11,
  11, 12, 12, 13, 13];
const WINDOW = 32768;
const MAX_MATCH = 258;
const CHAIN_LIMIT = 512;

function lastIndexAtMost(table, value) {
  let index = table.length - 1;
  while (table[index] > value) index -= 1;
  return index;
}

export function deflateWithDictionary(data, dictionary) {
  const buffer = new Uint8Array(dictionary.length + data.length);
  buffer.set(dictionary);
  buffer.set(data, dictionary.length);
  const out = [];
  let pending = 0;
  let pendingBits = 0;
  const write = (value, count) => {
    pending |= value << pendingBits;
    pendingBits += count;
    while (pendingBits >= 8) {
      out.push(pending & 255);
      pending >>>= 8;
      pendingBits -= 8;
    }
  };
  // Huffman codes are packed most significant bit first; everything else least significant first.
  const writeCode = (code, count) => {
    let reversed = 0;
    for (let bit = 0; bit < count; bit += 1) reversed |= ((code >> bit) & 1) << (count - 1 - bit);
    write(reversed, count);
  };
  const writeSymbol = (symbol) => {
    if (symbol < 144) writeCode(0x30 + symbol, 8);
    else if (symbol < 256) writeCode(0x190 + symbol - 144, 9);
    else if (symbol < 280) writeCode(symbol - 256, 7);
    else writeCode(0xc0 + symbol - 280, 8);
  };

  const head = new Map();
  const previous = new Int32Array(buffer.length).fill(-1);
  const insert = (at) => {
    if (at + 2 >= buffer.length) return;
    const key = buffer[at] | (buffer[at + 1] << 8) | (buffer[at + 2] << 16);
    previous[at] = head.get(key) ?? -1;
    head.set(key, at);
  };
  for (let at = 0; at < dictionary.length; at += 1) insert(at);

  write(1, 1); // BFINAL: one block
  write(1, 2); // BTYPE 01: fixed codes
  let at = dictionary.length;
  while (at < buffer.length) {
    let length = 0;
    let distance = 0;
    if (at + 2 < buffer.length) {
      const key = buffer[at] | (buffer[at + 1] << 8) | (buffer[at + 2] << 16);
      let candidate = head.get(key) ?? -1;
      for (let tries = CHAIN_LIMIT; candidate >= 0 && at - candidate <= WINDOW && tries > 0; tries -= 1) {
        let run = 0;
        while (run < MAX_MATCH && at + run < buffer.length && buffer[candidate + run] === buffer[at + run]) {
          run += 1;
        }
        if (run > length) {
          length = run;
          distance = at - candidate;
          if (run === MAX_MATCH) break;
        }
        candidate = previous[candidate];
      }
    }
    if (length >= 3) {
      const lengthCode = lastIndexAtMost(LENGTH_BASE, length);
      writeSymbol(257 + lengthCode);
      if (LENGTH_EXTRA[lengthCode]) write(length - LENGTH_BASE[lengthCode], LENGTH_EXTRA[lengthCode]);
      const distanceCode = lastIndexAtMost(DISTANCE_BASE, distance);
      writeCode(distanceCode, 5);
      if (DISTANCE_EXTRA[distanceCode]) {
        write(distance - DISTANCE_BASE[distanceCode], DISTANCE_EXTRA[distanceCode]);
      }
      for (let step = 0; step < length; step += 1) insert(at + step);
      at += length;
    } else {
      writeSymbol(buffer[at]);
      insert(at);
      at += 1;
    }
  }
  writeSymbol(256);
  if (pendingBits > 0) out.push(pending & 255);
  return Uint8Array.from(out);
}


class ShareLinkTooLarge extends Error {}

/*
  The dictionary goes in as a stored block (BFINAL 0, byte-aligned by construction), so the payload's
  first block starts on a byte boundary with the dictionary in its window -- exactly what a zlib
  preset dictionary means. The stream is counted as it arrives and cancelled at the cap.
*/
export async function inflateWithDictionary(payload, dictionary, limit) {
  const size = dictionary.length;
  const header = Uint8Array.of(0, size & 255, size >> 8, ~size & 255, (~size >> 8) & 255);
  const stream = new Blob([header, dictionary, payload]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  const { chunks, byteLength } = await readAtMost(stream, size + limit, () => new ShareLinkTooLarge());
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.length;
  });
  return bytes.subarray(size);
}


/** The fragment, `#1.<payload>`, for one link document. Round-tripped before it is returned. */
export async function encodeShareFragment(document) {
  const text = JSON.stringify(document);
  const data = new TextEncoder().encode(text);
  if (data.length > MAX_SHARE_DOCUMENT_BYTES) {
    throw new Error('This session is too large to fit in a link. Save it as a session file instead.');
  }
  const dictionary = await dictionaryFor(SHARE_LINK_FORMAT);
  const fragment = `#${SHARE_LINK_FORMAT}.${toBase64Url(deflateWithDictionary(data, dictionary))}`;
  if (fragment.length > MAX_SHARE_FRAGMENT_LENGTH) {
    throw new Error('This session is too large to fit in a link. Save it as a session file instead.');
  }
  const decoded = await decodeShareFragment(fragment);
  if (JSON.stringify(decoded) !== text) throw new Error('The link could not be built from this session.');
  return fragment;
}


/** Whether a fragment is meant as a share link at all; anything else is left alone. */
export function isShareFragment(hash) {
  return /^#\d{1,3}\./.test(hash);
}


/** The parsed JSON a share fragment carries, or a refusal a person can act on. */
export async function decodeShareFragment(hash) {
  if (hash.length > MAX_SHARE_FRAGMENT_LENGTH) throw new Error('This link is too long to be a FoldRay link.');
  const match = FRAGMENT.exec(hash);
  if (!match) throw new Error('This link is damaged: it is not in a form FoldRay reads.');
  const dictionary = await dictionaryFor(match[1]);
  if (!dictionary) throw new Error('This link was made in a format this version of FoldRay does not read.');
  let bytes;
  try {
    bytes = await inflateWithDictionary(fromBase64Url(match[2]), dictionary, MAX_SHARE_DOCUMENT_BYTES);
  } catch (error) {
    if (error instanceof ShareLinkTooLarge) throw new Error('This link holds more than a session can.');
    throw new Error('This link is incomplete or damaged. It may have been cut short when it was copied.');
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('This link is incomplete or damaged. It may have been cut short when it was copied.');
  }
}


/*
  The first 96 bits of SHA-256, over the bytes a session embeds. It says whether the database still
  serves the file the link was made from; whoever makes a link chooses it, so it is never a proof.
*/
export async function structureDigest(bytes) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return toBase64Url(hash.subarray(0, 12));
}


/** Which database a structure's filename came from, or `undefined` when it cannot be shared. */
export function structureSource(filename) {
  const pdbId = pdbIdFromFilename(filename);
  if (pdbId) return { database: 'pdb', id: pdbId, name: `${pdbId} from RCSB PDB` };
  const prediction = alphaFoldAccessionFromFilename(filename);
  // The prediction API names only fragment 1, so no other could be downloaded again.
  if (prediction?.fragment === 1) {
    return {
      database: 'alphafold',
      id: prediction.accession,
      version: prediction.version,
      name: `${prediction.accession} from AlphaFold DB`,
    };
  }
  return undefined;
}
