/*
  A baseline TIFF writer, and the reader that holds it to the specification.

  TIFF Revision 6.0 (Adobe, 3 June 1992): §2 for the 8-byte header, the IFD and the field types,
  §8 for the baseline RGB tags, §18 for ExtraSamples. Written from that document; no encoder was
  read and none is vendored.

  What it writes is deliberately the dullest file in the format: little-endian, uncompressed, one
  strip, chunky RGBA -- at 32-bit IEEE float samples (SampleFormat 3, TIFF 6.0 §19), because the
  master is scene-linear and unclamped, which no integer sample format can hold.

  **ExtraSamples is 2, unassociated**, which is the product's contract said in TIFF's vocabulary:
  the alpha is straight, exactly the bytes a PNG stores and exactly what `readPixelsLinear()` returns.
  Declaring 1 (associated) would tell an editor to divide the colour out a second time.
*/

const INTEL = 0x4949;
const MOTOROLA = 0x4d4d;
const MAGIC = 42;

// Field types, by their §2 numbers.
const ASCII = 2;
const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;

const TAG = {
  imageDescription: 270,
  imageWidth: 256,
  imageLength: 257,
  bitsPerSample: 258,
  compression: 259,
  photometric: 262,
  stripOffsets: 273,
  orientation: 274,
  samplesPerPixel: 277,
  rowsPerStrip: 278,
  stripByteCounts: 279,
  xResolution: 282,
  yResolution: 283,
  planarConfiguration: 284,
  resolutionUnit: 296,
  software: 305,
  extraSamples: 338,
  sampleFormat: 339,
};

export const SAMPLES = 4;
export const BITS_PER_SAMPLE = 32;
export const IEEE_FLOAT = 3;
export const UNASSOCIATED_ALPHA = 2;

const HEADER_BYTES = 8;
const ENTRY_BYTES = 12;

// Set once: the fast path below writes the strip through a Float32Array only where that is already
// little-endian, and falls back to a DataView everywhere else.
const HOST_IS_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

const even = (value) => value + (value % 2);

function asciiBytes(text) {
  // A field is NUL-terminated (§2), and anything outside 7-bit ASCII is not this field's to carry.
  const clean = String(text).replace(/[^\x20-\x7e]/g, ' ');
  const bytes = new Uint8Array(clean.length + 1);
  for (let index = 0; index < clean.length; index += 1) bytes[index] = clean.charCodeAt(index);
  return bytes;
}

function fieldCount(field) {
  if (field.type === ASCII) return field.bytes.length;
  if (field.type === RATIONAL) return field.data.length / 2;
  return field.data.length;
}

function fieldBytes(field) {
  if (field.type === ASCII) return field.bytes.length;
  if (field.type === RATIONAL) return field.data.length * 4;
  return field.data.length * (field.type === SHORT ? 2 : 4);
}

function writeField(view, offset, field) {
  const put = (index, value) => {
    if (field.type === SHORT) view.setUint16(offset + index * 2, value, true);
    else view.setUint32(offset + index * 4, value, true);
  };
  if (field.type === ASCII) {
    field.bytes.forEach((byte, index) => view.setUint8(offset + index, byte));
    return;
  }
  field.data.forEach((value, index) => put(index, value));
}

/**
 * A float RGBA TIFF of `pixels`, which is width*height*4 float32 samples, straight alpha.
 */
export function encodeTiffFloat({ width, height, pixels, description, software }) {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new Error(`Refusing a ${width}x${height} TIFF`);
  }
  const expected = width * height * SAMPLES;
  if (!(pixels instanceof Float32Array) || pixels.length !== expected) {
    throw new Error(`A ${width}x${height} TIFF wants ${expected} float32 samples`);
  }
  const strip = expected * 4;
  const fields = [
    { tag: TAG.imageWidth, type: LONG, data: [width] },
    { tag: TAG.imageLength, type: LONG, data: [height] },
    { tag: TAG.bitsPerSample, type: SHORT, data: Array(SAMPLES).fill(BITS_PER_SAMPLE) },
    { tag: TAG.compression, type: SHORT, data: [1] },
    { tag: TAG.photometric, type: SHORT, data: [2] },
    { tag: TAG.stripOffsets, type: LONG, data: [0] },
    { tag: TAG.orientation, type: SHORT, data: [1] },
    { tag: TAG.samplesPerPixel, type: SHORT, data: [SAMPLES] },
    { tag: TAG.rowsPerStrip, type: LONG, data: [height] },
    { tag: TAG.stripByteCounts, type: LONG, data: [strip] },
    { tag: TAG.xResolution, type: RATIONAL, data: [72, 1] },
    { tag: TAG.yResolution, type: RATIONAL, data: [72, 1] },
    { tag: TAG.planarConfiguration, type: SHORT, data: [1] },
    { tag: TAG.resolutionUnit, type: SHORT, data: [2] },
    { tag: TAG.extraSamples, type: SHORT, data: [UNASSOCIATED_ALPHA] },
    { tag: TAG.sampleFormat, type: SHORT, data: Array(SAMPLES).fill(IEEE_FLOAT) },
  ];
  if (description) {
    fields.push({ tag: TAG.imageDescription, type: ASCII, bytes: asciiBytes(description) });
  }
  if (software) {
    fields.push({ tag: TAG.software, type: ASCII, bytes: asciiBytes(software) });
  }
  // §2: the entries must be in ascending tag order, and a reader is allowed to rely on it.
  fields.sort((a, b) => a.tag - b.tag);

  const ifd = HEADER_BYTES;
  const ifdBytes = 2 + fields.length * ENTRY_BYTES + 4;
  let spill = ifd + ifdBytes;
  fields.forEach((field) => {
    const size = fieldBytes(field);
    if (size <= 4) return;
    // §2: a value that does not fit in the entry lives elsewhere and begins on a word boundary.
    field.offset = even(spill);
    spill = field.offset + size;
  });
  // On a multiple of four, which is a word boundary too, so the strip can be viewed as float32.
  const stripOffset = spill + ((4 - (spill % 4)) % 4);
  const bytes = new Uint8Array(stripOffset + strip);
  const view = new DataView(bytes.buffer);

  view.setUint16(0, INTEL, true);
  view.setUint16(2, MAGIC, true);
  view.setUint32(4, ifd, true);
  view.setUint16(ifd, fields.length, true);
  fields.forEach((field, index) => {
    const at = ifd + 2 + index * ENTRY_BYTES;
    view.setUint16(at, field.tag, true);
    view.setUint16(at + 2, field.type, true);
    view.setUint32(at + 4, fieldCount(field), true);
    if (field.tag === TAG.stripOffsets) view.setUint32(at + 8, stripOffset, true);
    else if (field.offset === undefined) writeField(view, at + 8, field);
    else {
      view.setUint32(at + 8, field.offset, true);
      writeField(view, field.offset, field);
    }
  });

  if (HOST_IS_LITTLE_ENDIAN) new Float32Array(bytes.buffer, stripOffset, expected).set(pixels);
  else for (let i = 0; i < expected; i += 1) view.setFloat32(stripOffset + i * 4, pixels[i], true);
  return bytes;
}

/**
 * Read back a TIFF of the shape `encodeTiffFloat()` writes.  Anything else is refused by name.
 */
export function decodeTiff(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const order = view.getUint16(0, false);
  if (order !== INTEL && order !== MOTOROLA) throw new Error('not a TIFF: no byte-order mark');
  const little = order === INTEL;
  if (view.getUint16(2, little) !== MAGIC) throw new Error('not a TIFF: bad version');

  const ifd = view.getUint32(4, little);
  const entries = view.getUint16(ifd, little);
  const fields = new Map();
  for (let index = 0; index < entries; index += 1) {
    const at = ifd + 2 + index * ENTRY_BYTES;
    const tag = view.getUint16(at, little);
    const type = view.getUint16(at + 2, little);
    const count = view.getUint32(at + 4, little);
    const unit = { [ASCII]: 1, [SHORT]: 2, [LONG]: 4, [RATIONAL]: 8 }[type] ?? 0;
    if (!unit) throw new Error(`tag ${tag} has field type ${type}, which is not read here`);
    const size = count * unit;
    const base = size <= 4 ? at + 8 : view.getUint32(at + 8, little);
    if (type === ASCII) {
      let text = '';
      for (let i = 0; i < count && view.getUint8(base + i); i += 1) {
        text += String.fromCharCode(view.getUint8(base + i));
      }
      fields.set(tag, text);
      continue;
    }
    const values = [];
    for (let i = 0; i < count; i += 1) {
      if (type === SHORT) values.push(view.getUint16(base + i * 2, little));
      else if (type === LONG) values.push(view.getUint32(base + i * 4, little));
      else {
        const at8 = base + i * 8;
        values.push(view.getUint32(at8, little) / view.getUint32(at8 + 4, little));
      }
    }
    fields.set(tag, values);
  }

  const one = (tag) => fields.get(tag)?.[0];
  const width = one(TAG.imageWidth);
  const height = one(TAG.imageLength);
  const samplesPerPixel = one(TAG.samplesPerPixel);
  const bitsPerSample = fields.get(TAG.bitsPerSample) ?? [];
  if (one(TAG.compression) !== 1) throw new Error('compressed TIFFs are not read here');
  if ((one(TAG.planarConfiguration) ?? 1) !== 1) throw new Error('planar TIFFs are not read here');
  if (one(TAG.rowsPerStrip) !== height) throw new Error('multi-strip TIFFs are not read here');
  // The length is checked as well as the values: an absent BitsPerSample defaults to 1 bit (§8),
  // and `[].every()` is true, so the values alone would let a bilevel file through as float.
  if (bitsPerSample.length !== samplesPerPixel
      || !bitsPerSample.every((bits) => bits === BITS_PER_SAMPLE)
      || !(fields.get(TAG.sampleFormat) ?? []).every((format) => format === IEEE_FLOAT)
      || (fields.get(TAG.sampleFormat) ?? []).length !== samplesPerPixel) {
    throw new Error(`only ${BITS_PER_SAMPLE}-bit float samples are read here`);
  }
  const stripOffset = one(TAG.stripOffsets);
  const count = width * height * samplesPerPixel;
  const pixels = new Float32Array(count);
  for (let i = 0; i < count; i += 1) pixels[i] = view.getFloat32(stripOffset + i * 4, little);
  return {
    width,
    height,
    samplesPerPixel,
    bitsPerSample,
    photometric: one(TAG.photometric),
    compression: one(TAG.compression),
    planarConfiguration: one(TAG.planarConfiguration),
    orientation: one(TAG.orientation),
    sampleFormat: fields.get(TAG.sampleFormat),
    extraSamples: fields.get(TAG.extraSamples),
    resolutionUnit: one(TAG.resolutionUnit),
    description: fields.get(TAG.imageDescription),
    software: fields.get(TAG.software),
    stripOffset,
    stripByteCounts: one(TAG.stripByteCounts),
    littleEndian: little,
    pixels,
  };
}

/**
 * Straight linear RGBA over an opaque linear `level` (1 white, 0 black), in place. White is 1.0 in
 * both sRGB and linear, so the matte is the same one the PNG gets.
 */
export function compositeOverLinear(pixels, level) {
  for (let i = 0; i < pixels.length; i += SAMPLES) {
    const alpha = pixels[i + 3];
    pixels[i] = pixels[i] * alpha + level * (1 - alpha);
    pixels[i + 1] = pixels[i + 1] * alpha + level * (1 - alpha);
    pixels[i + 2] = pixels[i + 2] * alpha + level * (1 - alpha);
    pixels[i + 3] = 1;
  }
  return pixels;
}
