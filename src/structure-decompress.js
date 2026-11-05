import { readAtMost } from './bounded-read.js';

export const MAX_STRUCTURE_BYTES = 64 * 1024 * 1024;

export async function decompressStructure(file) {
  if (!file.name.toLowerCase().endsWith('.gz')) return file;
  const uncompressedName = file.name.replace(/\.gz$/i, '');
  // Sniffed as hdr.js does: a browser that honoured Content-Encoding saved it inflated under the .gz name.
  const magic = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (magic[0] !== 0x1f || magic[1] !== 0x8b) return new File([file], uncompressedName, { type: file.type });

  const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
  let chunks;
  try {
    ({ chunks } = await readAtMost(stream, MAX_STRUCTURE_BYTES, () => new Error(
      `The decompressed file exceeds the ${MAX_STRUCTURE_BYTES / (1024 * 1024)} MB limit.`,
    )));
  } catch (error) {
    // DecompressionStream's own TypeError has no message worth showing.
    if (error instanceof TypeError) throw new Error(`${file.name} is not a readable gzip file.`);
    throw error;
  }

  return new File(chunks, uncompressedName, { type: file.type });
}
