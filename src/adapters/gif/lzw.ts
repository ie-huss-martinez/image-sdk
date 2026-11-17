import { invalid } from "../probe/bytes.js";

/** The most codes a GIF's LZW table holds: codes are at most 12 bits. */
const MAX_CODES = 4_096;

/**
 * Decodes a frame's LZW code stream into colour indexes (docs/adr/0011):
 * the stream must hold every one of the frame's `out.length` pixels, and
 * what follows them isn't read.
 *
 * - It stops at the frame's last pixel. Codes after it, an end code that
 *   never comes and anything else left in the data are ignored, as every
 *   browser ignores them: the frame is whole without them.
 * - A code that isn't defined yet, or data that ends before the frame is
 *   whole, is `INVALID_IMAGE`: a frame is never returned partly decoded.
 * - The table has at most 4,096 entries, and the output is the frame's
 *   rectangle: no allocation is sized by the code stream.
 * - It reads at most the bytes of the frame's own data sub-blocks, each
 *   checked against the file, so it always ends.
 *
 * @param bytes - The file.
 * @param data - Where the frame's first data sub-block starts.
 * @param codeSize - The frame's LZW minimum code size: 1 to 8.
 * @param out - One byte for each pixel of the frame's rectangle, in the
 *   order the file has them.
 */
export function decodeLzw(
  bytes: Uint8Array,
  data: number,
  codeSize: number,
  out: Uint8Array,
): void {
  const clear = 1 << codeSize;
  const end = clear + 1;
  // Each code is its last colour and the code before it: a chain back to a root.
  const prefix = new Uint16Array(MAX_CODES);
  const suffix = new Uint8Array(MAX_CODES);
  /** The first colour of each code's string. */
  const first = new Uint8Array(MAX_CODES);
  for (let code = 0; code < clear; code += 1) {
    suffix[code] = code;
    first[code] = code;
  }
  const stack = new Uint8Array(MAX_CODES);

  let width = codeSize + 1;
  let next = end + 1;
  let previous = -1;
  let written = 0;
  // The bits read and not yet used, low bits first.
  let buffer = 0;
  let bits = 0;
  let offset = data;
  let remaining = 0;
  let ended = false;

  for (;;) {
    // Fill the buffer from the sub-blocks until it holds a code.
    while (bits < width) {
      if (remaining === 0) {
        if (offset >= bytes.length)
          throw invalid("gif", "a frame's data ends past the end of the file");
        remaining = bytes[offset] as number;
        offset += 1;
        if (remaining === 0) {
          ended = true;
          break;
        }
        if (offset + remaining > bytes.length) {
          throw invalid("gif", "a frame's data ends past the end of the file");
        }
      }
      buffer |= (bytes[offset] as number) << bits;
      bits += 8;
      offset += 1;
      remaining -= 1;
    }
    if (ended) break;
    const code = buffer & ((1 << width) - 1);
    buffer >>>= width;
    bits -= width;

    if (code === clear) {
      width = codeSize + 1;
      next = end + 1;
      previous = -1;
      continue;
    }
    if (code === end) break;

    // The string for this code: a known one, or the previous with its own first colour again.
    let length = 0;
    let current = code;
    if (previous === -1) {
      // The first code after a clear is a colour.
      if (code >= clear)
        throw invalid("gif", "a frame's data starts with a code that isn't a colour");
    } else if (code > next) {
      throw invalid("gif", "a frame's data uses a code that isn't defined yet");
    } else if (code === next) {
      stack[length] = first[previous] as number;
      length += 1;
      current = previous;
    }
    while (current >= clear) {
      // A string is at most as long as the table. A defined code's chain
      // always ends at a colour; this holds even if a check above were
      // wrong, so the decoder can't loop on any input.
      if (length >= MAX_CODES - 1) throw invalid("gif", "a frame's data has a code with no end");
      stack[length] = suffix[current] as number;
      length += 1;
      current = prefix[current] as number;
    }
    stack[length] = current;
    length += 1;

    // The string, first colour first, as far as the frame has room for it.
    for (let index = length - 1; index >= 0 && written < out.length; index -= 1) {
      out[written] = stack[index] as number;
      written += 1;
    }
    // The frame is whole: nothing after its last pixel is read.
    if (written === out.length) return;

    // The previous string and this one's first colour become the next code.
    if (previous !== -1 && next < MAX_CODES) {
      prefix[next] = previous;
      suffix[next] = current;
      first[next] = first[previous] as number;
      next += 1;
    }
    // The code grows a bit when the table fills its width, up to 12 bits.
    // With a code size of 1 it's full from the start, so the first code
    // after a clear grows it, which is why this isn't only after an entry.
    if (next >= 1 << width && width < 12) width += 1;
    previous = code;
  }
  // The data ended, or said it had, before the frame's last pixel.
  throw invalid("gif", "a frame's data holds fewer pixels than the frame");
}
