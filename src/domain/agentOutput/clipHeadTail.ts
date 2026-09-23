import { boundUtf8Text, utf8ByteLength, type BoundedUtf8Text } from "./utf8Text";

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8");
const UTF8_CONTINUATION_MASK = 0b1100_0000;
const UTF8_CONTINUATION_MARKER = 0b1000_0000;
const ELLIPSIS = "…";

export function headTailOmissionMarker(omittedBytes: number): string {
  return `\n${ELLIPSIS} ${omittedBytes} bytes omitted ${ELLIPSIS}\n`;
}

export function clipHeadTail(text: string, maxBytes: number): BoundedUtf8Text {
  const safe = text.includes("\0") ? text.split("\0").join("") : text;
  const nulStripped = safe.length !== text.length;
  const totalBytes = utf8ByteLength(safe);
  if (totalBytes <= maxBytes) return { text: safe, clipped: nulStripped };
  const reserved = utf8ByteLength(headTailOmissionMarker(totalBytes));
  if (reserved >= maxBytes) return { text: boundUtf8Text(safe, maxBytes).text, clipped: true };
  const bytes = UTF8_ENCODER.encode(safe);
  const available = maxBytes - reserved;
  const headEnd = floorBoundary(bytes, Math.floor(available / 2));
  const tailStart = ceilBoundary(bytes, bytes.length - (available - headEnd));
  const head = UTF8_DECODER.decode(bytes.subarray(0, headEnd));
  const tail = UTF8_DECODER.decode(bytes.subarray(tailStart));
  return {
    text: `${head}${headTailOmissionMarker(tailStart - headEnd)}${tail}`,
    clipped: true,
  };
}

function isContinuation(byte: number | undefined): boolean {
  return byte !== undefined && (byte & UTF8_CONTINUATION_MASK) === UTF8_CONTINUATION_MARKER;
}

function floorBoundary(bytes: Uint8Array, index: number): number {
  let end = Math.min(Math.max(index, 0), bytes.length);
  while (end > 0 && isContinuation(bytes[end])) end -= 1;
  return end;
}

function ceilBoundary(bytes: Uint8Array, index: number): number {
  let start = Math.min(Math.max(index, 0), bytes.length);
  while (start < bytes.length && isContinuation(bytes[start])) start += 1;
  return start;
}
