/*
  Bodies read with their size counted as they arrive. RCSB answers gzip-encoded with no
  Content-Length, so a check after `arrayBuffer()` runs only once the whole inflated body is held
  (3J3Q: ~50 MB fetched and ~240 MB in memory before the refusal).
*/

/** The stream's chunks, or `tooLarge()` thrown the moment their total passes `maxBytes`. */
export async function readAtMost(stream, maxBytes, tooLarge) {
  const reader = stream.getReader();
  const chunks = [];
  let byteLength = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return { chunks, byteLength };
      byteLength += value.byteLength;
      if (byteLength > maxBytes) throw tooLarge();
      chunks.push(value);
    }
  } catch (error) {
    reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}


/** A response's body as an `ArrayBuffer`, refused past `maxBytes` without reading the rest. */
export async function responseBytesAtMost(response, maxBytes, { tooLarge, unreadable }) {
  // The encoded size when the body is compressed, so it can only undercount.
  const declared = Number(response.headers?.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();

  if (!response.body) {
    let data;
    try {
      data = await response.arrayBuffer();
    } catch {
      throw unreadable();
    }
    if (data.byteLength > maxBytes) throw tooLarge();
    return data;
  }

  let refusal;
  let read;
  try {
    read = await readAtMost(response.body, maxBytes, () => (refusal = tooLarge()));
  } catch (error) {
    if (refusal !== undefined && error === refusal) throw error;
    throw unreadable();
  }
  const bytes = new Uint8Array(read.byteLength);
  let at = 0;
  for (const chunk of read.chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes.buffer;
}
