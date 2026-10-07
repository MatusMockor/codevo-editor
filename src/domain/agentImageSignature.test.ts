import { describe, expect, it } from "vitest";
import { agentImageMimeFromBytes } from "./agentImageSignature";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const GIF87 = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const GIF89 = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];

function sniff(bytes: ReadonlyArray<number>) {
  return agentImageMimeFromBytes(new Uint8Array(bytes));
}

describe("agentImageMimeFromBytes", () => {
  it.each([
    ["image/png", PNG],
    ["image/jpeg", JPEG],
    ["image/gif", GIF87],
    ["image/gif", GIF89],
    ["image/webp", WEBP],
  ] as const)("recognises %s by its signature", (mime, signature) => {
    expect(sniff(signature)).toBe(mime);
    expect(sniff([...signature, 0x00, 0x01, 0x02])).toBe(mime);
  });

  it.each([
    ["png", PNG],
    ["jpeg", JPEG.slice(0, 3)],
    ["gif", GIF89],
    ["webp", WEBP],
  ] as const)("rejects every truncated %s signature", (_name, signature) => {
    for (let length = 0; length < signature.length; length += 1) {
      expect(sniff(signature.slice(0, length))).toBeNull();
    }
  });

  it("rejects a RIFF container that is not WebP", () => {
    expect(sniff([...WEBP.slice(0, 8), 0x57, 0x41, 0x56, 0x45])).toBeNull();
    expect(sniff([...WEBP.slice(0, 8), 0x41, 0x56, 0x49, 0x20])).toBeNull();
    expect(sniff([0x52, 0x49, 0x46, 0x58, ...WEBP.slice(4)])).toBeNull();
  });

  it("rejects unknown GIF versions and unrelated content", () => {
    expect(sniff([0x47, 0x49, 0x46, 0x38, 0x38, 0x61])).toBeNull();
    expect(sniff([0x3c, 0x73, 0x76, 0x67, 0x20, 0x78, 0x6d, 0x6c])).toBeNull();
    expect(sniff([0x25, 0x50, 0x44, 0x46, 0x2d])).toBeNull();
    expect(sniff([])).toBeNull();
  });

  it("reads the signature at the start of a view, not of its backing buffer", () => {
    const backing = new Uint8Array([0x00, 0x00, ...PNG]);
    expect(agentImageMimeFromBytes(backing)).toBeNull();
    expect(agentImageMimeFromBytes(backing.subarray(2))).toBe("image/png");
  });
});
