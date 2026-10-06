export interface BoundedUtf8Text {
  readonly text: string;
  readonly clipped: boolean;
}

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8");
const UTF8_CONTINUATION_MASK = 0b1100_0000;
const UTF8_CONTINUATION_MARKER = 0b1000_0000;
const HIGH_SURROGATE_START = 0xd800;
const HIGH_SURROGATE_END = 0xdbff;
const LOW_SURROGATE_START = 0xdc00;
const LOW_SURROGATE_END = 0xdfff;

export function utf8ByteLength(text: string): number {
  let bytes = 0;
  let index = 0;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    index += 1;
    if (code < 0x80) {
      bytes += 1;
      continue;
    }
    if (code < 0x800) {
      bytes += 2;
      continue;
    }
    if (
      code >= HIGH_SURROGATE_START &&
      code <= HIGH_SURROGATE_END &&
      isLowSurrogateAt(text, index)
    ) {
      bytes += 4;
      index += 1;
      continue;
    }
    bytes += 3;
  }
  return bytes;
}

export function boundUtf8Text(text: string, maxBytes: number): BoundedUtf8Text {
  const safe = stripNulls(text);
  if (utf8ByteLength(safe) <= maxBytes) return { text: safe, clipped: false };
  const bytes = UTF8_ENCODER.encode(safe);
  let end = maxBytes;
  while (end > 0 && (bytes[end] & UTF8_CONTINUATION_MASK) === UTF8_CONTINUATION_MARKER) {
    end -= 1;
  }
  return { text: UTF8_DECODER.decode(bytes.subarray(0, end)), clipped: true };
}

export function boundedUtf8Text(text: string, maxBytes: number): string {
  return boundUtf8Text(text, maxBytes).text;
}

function isLowSurrogateAt(text: string, index: number): boolean {
  if (index >= text.length) return false;
  const code = text.charCodeAt(index);
  return code >= LOW_SURROGATE_START && code <= LOW_SURROGATE_END;
}

function stripNulls(text: string): string {
  if (!text.includes("\0")) return text;
  return text.split("\0").join("");
}
