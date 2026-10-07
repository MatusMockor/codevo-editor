import type { AgentImageMime } from "./agentAttachment";

interface ImageSignature {
  readonly mime: AgentImageMime;
  readonly segments: ReadonlyArray<SignatureSegment>;
}

interface SignatureSegment {
  readonly offset: number;
  readonly bytes: ReadonlyArray<number>;
}

const IMAGE_SIGNATURES: ReadonlyArray<ImageSignature> = [
  {
    mime: "image/png",
    segments: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  },
  { mime: "image/jpeg", segments: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }] },
  { mime: "image/gif", segments: [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] }] },
  { mime: "image/gif", segments: [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] }] },
  {
    mime: "image/webp",
    segments: [
      { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
      { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
    ],
  },
];

export function agentImageMimeFromBytes(bytes: Uint8Array): AgentImageMime | null {
  for (const signature of IMAGE_SIGNATURES) {
    if (signature.segments.every((segment) => matchesSegment(bytes, segment))) {
      return signature.mime;
    }
  }
  return null;
}

function matchesSegment(bytes: Uint8Array, segment: SignatureSegment): boolean {
  if (bytes.byteLength < segment.offset + segment.bytes.length) return false;
  return segment.bytes.every((byte, index) => bytes[segment.offset + index] === byte);
}
