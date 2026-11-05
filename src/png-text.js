/*
  A PNG with `tEXt` chunks added after IHDR. `canvas.toBlob()` offers no metadata, so a downloaded
  picture would otherwise not say what made it. Only the header chunk moves; the pixels are
  untouched, and nothing that gets hashed passes through here -- a recorded picture is read back
  through `readPixels()`, not through a PNG.
*/
const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

let crcTable;

function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function latin1(text) {
  return Uint8Array.from(text, (char) => {
    const code = char.charCodeAt(0);
    return code < 256 ? code : 0x3f;
  });
}

function textChunk(keyword, text) {
  const data = new Uint8Array([...latin1(keyword), 0, ...latin1(text)]);
  const body = new Uint8Array(4 + data.length);
  body.set(latin1('tEXt'), 0);
  body.set(data, 4);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(body, 4);
  view.setUint32(8 + data.length, crc32(body));
  return chunk;
}

/** `bytes` with one `tEXt` chunk per entry of `fields`, inserted after IHDR. Refuses a non-PNG. */
export function withPngTextBytes(bytes, fields) {
  if (bytes.length < 33 || SIGNATURE.some((value, index) => bytes[index] !== value)) {
    throw new Error('not a PNG: no signature');
  }
  const ihdrEnd = 8 + 12 + new DataView(bytes.buffer, bytes.byteOffset).getUint32(8);
  const chunks = Object.entries(fields).map(([keyword, text]) => textChunk(keyword, text));
  const out = new Uint8Array(bytes.length + chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  out.set(bytes.subarray(0, ihdrEnd), 0);
  let at = ihdrEnd;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  out.set(bytes.subarray(ihdrEnd), at);
  return out;
}

/** The `tEXt` chunks of a PNG, keyword to text. */
export function readPngText(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fields = {};
  for (let at = 8; at + 12 <= bytes.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (type === 'tEXt') {
      const data = bytes.subarray(at + 8, at + 8 + length);
      const split = data.indexOf(0);
      fields[String.fromCharCode(...data.subarray(0, split))] = String.fromCharCode(...data.subarray(split + 1));
    }
    if (type === 'IEND') break;
    at += 12 + length;
  }
  return fields;
}

export async function withPngText(blob, fields) {
  const bytes = withPngTextBytes(new Uint8Array(await blob.arrayBuffer()), fields);
  return new Blob([bytes], { type: 'image/png' });
}
