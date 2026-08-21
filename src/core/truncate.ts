/**
 * UTF-8 byte-budget truncation, used to cap captured bodies/values/payloads
 * before they are queued for the database. Avoids `Buffer`/`TextEncoder`
 * so it runs everywhere Hermes does.
 */

export interface TruncationResult {
  text: string;
  truncated: boolean;
  byteLength: number;
}

function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate: a full code point is 4 UTF-8 bytes; skip its low surrogate.
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/**
 * Truncate `input` so its UTF-8 encoding does not exceed `maxBytes`. Returns the
 * (possibly shortened) text, whether it was cut, and the original byte length.
 */
export function truncateToBytes(
  input: string,
  maxBytes: number
): TruncationResult {
  const byteLength = utf8ByteLength(input);
  if (byteLength <= maxBytes) {
    return { text: input, truncated: false, byteLength };
  }

  let bytes = 0;
  let cutIndex = input.length;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    let charBytes: number;
    let isSurrogatePair = false;
    if (code < 0x80) {
      charBytes = 1;
    } else if (code < 0x800) {
      charBytes = 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      charBytes = 4;
      isSurrogatePair = true;
    } else {
      charBytes = 3;
    }
    if (bytes + charBytes > maxBytes) {
      cutIndex = index;
      break;
    }
    bytes += charBytes;
    if (isSurrogatePair) {
      index += 1;
    }
  }

  return { text: input.slice(0, cutIndex), truncated: true, byteLength };
}
