// Radiance (.hdr) reader: enough of the format for the equirectangular environments in
// `public/assets/env/`, which are Poly Haven maps credited in `docs/attributions.md`.

export async function loadRadianceHdr(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}: ${response.status}`);
  let bytes = new Uint8Array(await response.arrayBuffer());
  // The maps ship gzipped. Tested by magic rather than by name: a host that answers `.gz` with
  // `Content-Encoding: gzip` (Vite's own server does) hands over the file already inflated.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const inflated = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(inflated).arrayBuffer());
  }

  let cursor = 0;
  const readLine = () => {
    let end = cursor;
    while (end < bytes.length && bytes[end] !== 0x0a) end += 1;
    const line = String.fromCharCode(...bytes.subarray(cursor, end));
    cursor = end + 1;
    return line;
  };

  const magic = readLine();
  if (!magic.startsWith('#?')) throw new Error('Not a Radiance file');
  let line = readLine();
  while (line.trim() !== '') line = readLine();
  const resolution = readLine().trim().split(/\s+/);
  if (resolution[0] !== '-Y' || resolution[2] !== '+X') {
    throw new Error(`Unsupported Radiance scanline order: ${resolution.join(' ')}`);
  }
  const height = Number.parseInt(resolution[1], 10);
  const width = Number.parseInt(resolution[3], 10);
  const data = new Float32Array(width * height * 4);

  const scanline = new Uint8Array(width * 4);
  for (let row = 0; row < height; row += 1) {
    if (width < 8 || width > 0x7fff
      || bytes[cursor] !== 2 || bytes[cursor + 1] !== 2
      || (bytes[cursor + 2] & 0x80) !== 0) {
      // Flat (unencoded) scanline.
      for (let column = 0; column < width; column += 1) {
        scanline[column * 4] = bytes[cursor];
        scanline[column * 4 + 1] = bytes[cursor + 1];
        scanline[column * 4 + 2] = bytes[cursor + 2];
        scanline[column * 4 + 3] = bytes[cursor + 3];
        cursor += 4;
      }
    } else {
      cursor += 4;
      for (let channel = 0; channel < 4; channel += 1) {
        let column = 0;
        while (column < width) {
          let count = bytes[cursor];
          cursor += 1;
          if (count > 128) {
            const value = bytes[cursor];
            cursor += 1;
            count -= 128;
            for (let repeat = 0; repeat < count; repeat += 1) {
              scanline[(column + repeat) * 4 + channel] = value;
            }
          } else {
            for (let index = 0; index < count; index += 1) {
              scanline[(column + index) * 4 + channel] = bytes[cursor + index];
            }
            cursor += count;
          }
          column += count;
        }
      }
    }
    for (let column = 0; column < width; column += 1) {
      const exponent = scanline[column * 4 + 3];
      const scale = exponent === 0 ? 0 : 2 ** (exponent - 136); // 2^(e-128) / 256
      const offset = (row * width + column) * 4;
      data[offset] = scanline[column * 4] * scale;
      data[offset + 1] = scanline[column * 4 + 1] * scale;
      data[offset + 2] = scanline[column * 4 + 2] * scale;
      data[offset + 3] = 1;
    }
  }
  return { width, height, data };
}

/**
 * Two-level CDF over an equirectangular map, weighted by the solid angle each texel covers.
 * Sampling it is what keeps a sun in the HDRI from taking thousands of samples to resolve.
 */
export function buildEnvironmentCdf(image) {
  const { width, height, data } = image;
  const conditional = new Float32Array(width * height);
  const marginal = new Float32Array(height);
  const rowIntegral = new Float32Array(height);
  for (let row = 0; row < height; row += 1) {
    const sinTheta = Math.sin((Math.PI * (row + 0.5)) / height);
    let total = 0;
    for (let column = 0; column < width; column += 1) {
      const offset = (row * width + column) * 4;
      const luminance = 0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2];
      total += luminance * sinTheta;
      conditional[row * width + column] = total;
    }
    rowIntegral[row] = total;
    if (total > 0) {
      for (let column = 0; column < width; column += 1) conditional[row * width + column] /= total;
    } else {
      for (let column = 0; column < width; column += 1) {
        conditional[row * width + column] = (column + 1) / width;
      }
    }
  }
  let running = 0;
  for (let row = 0; row < height; row += 1) {
    running += rowIntegral[row];
    marginal[row] = running;
  }
  const integral = running;
  if (integral > 0) for (let row = 0; row < height; row += 1) marginal[row] /= integral;
  else for (let row = 0; row < height; row += 1) marginal[row] = (row + 1) / height;
  return { conditional, marginal, integral: integral / (width * height) };
}
