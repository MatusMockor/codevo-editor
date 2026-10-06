import { boundUtf8Text, utf8ByteLength, type BoundedUtf8Text } from "./utf8Text.js";

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8");
const UTF8_CONTINUATION_MASK = 0b1100_0000;
const UTF8_CONTINUATION_MARKER = 0b1000_0000;
const ELLIPSIS = "…";

export function headTailOmissionMarker(omittedBytes: number): string {
  return `\n${ELLIPSIS} ${omittedBytes} bytes omitted ${ELLIPSIS}\n`;
}

const ELIDED_PATTERN = /(?:\n|\\n)… (\d{1,15}) bytes omitted …(?:\n|\\n)/gu;

interface Elision {
  readonly start: number;
  readonly end: number;
  readonly omittedBytes: number;
}

type ElisionFinder = (text: string) => ReadonlyArray<Elision>;

export function clipHeadTail(text: string, maxBytes: number): BoundedUtf8Text {
  return clipAccountingFor(text, maxBytes, () => []);
}

export function clipHeadTailCountingElisions(text: string, maxBytes: number): BoundedUtf8Text {
  return clipAccountingFor(text, maxBytes, elisions);
}

function clipAccountingFor(
  text: string,
  maxBytes: number,
  findElisions: ElisionFinder,
): BoundedUtf8Text {
  const safe = text.includes("\0") ? text.split("\0").join("") : text;
  const nulStripped = safe.length !== text.length;
  const totalBytes = utf8ByteLength(safe);
  if (totalBytes <= maxBytes) return { text: safe, clipped: nulStripped };
  const found = findElisions(safe);
  const elided = found.reduce((sum, elision) => sum + hiddenBytes(elision, 0, totalBytes), 0);
  const reserved = utf8ByteLength(headTailOmissionMarker(totalBytes + elided));
  if (reserved >= maxBytes) return { text: boundUtf8Text(safe, maxBytes).text, clipped: true };
  const bytes = UTF8_ENCODER.encode(safe);
  const available = maxBytes - reserved;
  const headEnd = floorBoundary(bytes, Math.floor(available / 2));
  const tailStart = ceilBoundary(bytes, bytes.length - (available - headEnd));
  const head = UTF8_DECODER.decode(bytes.subarray(0, headEnd));
  const tail = UTF8_DECODER.decode(bytes.subarray(tailStart));
  const omitted = found.reduce(
    (sum, elision) => sum + hiddenBytes(elision, headEnd, tailStart),
    tailStart - headEnd,
  );
  return {
    text: `${head}${headTailOmissionMarker(omitted)}${tail}`,
    clipped: true,
  };
}

function elisions(text: string): ReadonlyArray<Elision> {
  const found: Elision[] = [];
  let cursor = 0;
  let offset = 0;
  for (const match of text.matchAll(ELIDED_PATTERN)) {
    offset += utf8ByteLength(text.slice(cursor, match.index));
    const markerBytes = utf8ByteLength(match[0]);
    found.push({ start: offset, end: offset + markerBytes, omittedBytes: Number(match[1]) });
    offset += markerBytes;
    cursor = match.index + match[0].length;
  }
  return found;
}

function hiddenBytes(elision: Elision, start: number, end: number): number {
  const overlap = Math.min(elision.end, end) - Math.max(elision.start, start);
  if (overlap <= 0) return 0;
  return elision.omittedBytes - overlap;
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
