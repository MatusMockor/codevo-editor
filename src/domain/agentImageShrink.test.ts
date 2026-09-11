import { describe, expect, it, vi } from "vitest";
import { MAX_AGENT_IMAGE_BYTES } from "./agentAttachment";
import { MAX_AGENT_IMAGE_SOURCE_BYTES } from "./agentAttachmentIntake";
import {
  AGENT_IMAGE_MAX_EDGE,
  agentImageFitBox,
  agentShrunkAttachmentName,
  shrinkAgentImageToFit,
  type AgentImageEncodeMime,
  type AgentImageSource,
  type AgentImageSurfacePort,
} from "./agentImageShrink";

interface SurfaceOptions {
  readonly width?: number;
  readonly height?: number;
  readonly encodeMime?: AgentImageEncodeMime;
  readonly decode?: () => Promise<AgentImageSource>;
  readonly encodedBytes?: (quality: number, width: number) => number | "throw";
}

interface EncodeCall {
  readonly width: number;
  readonly height: number;
  readonly mime: AgentImageEncodeMime;
  readonly quality: number;
}

function surface(options: SurfaceOptions = {}) {
  const calls: EncodeCall[] = [];
  const released: AgentImageSource[] = [];
  const port: AgentImageSurfacePort = {
    decode:
      options.decode ??
      (async () => ({ width: options.width ?? 4_096, height: options.height ?? 2_048 })),
    encodeMime: async () => options.encodeMime ?? "image/webp",
    encode: async (_source, width, height, mime, quality) => {
      calls.push({ width, height, mime, quality });
      const size = options.encodedBytes?.(quality, width) ?? 1_024;
      if (size === "throw") throw new Error("encode refused");
      return new ArrayBuffer(size);
    },
    release: (source) => {
      released.push(source);
    },
  };
  return { calls, port, released };
}

function bytes(length: number): ArrayBuffer {
  return new ArrayBuffer(length);
}

describe("shrinkAgentImageToFit", () => {
  it("passes a supported image within budget through unchanged", async () => {
    const { calls, port, released } = surface({ width: 800, height: 600 });
    const source = bytes(1_024);

    const outcome = await shrinkAgentImageToFit(
      { name: "shot.png", mime: "image/png", bytes: source },
      port,
    );

    expect(outcome).toEqual({
      kind: "ready",
      name: "shot.png",
      mime: "image/png",
      bytes: source,
      width: 800,
      height: 600,
      reencoded: false,
    });
    expect(calls).toHaveLength(0);
    expect(released).toHaveLength(1);
  });

  it("re-encodes an oversized image down the quality ladder at the 2048 edge", async () => {
    const { calls, port } = surface({
      width: 4_096,
      height: 2_048,
      encodedBytes: (quality) => (quality > 0.85 ? MAX_AGENT_IMAGE_BYTES + 1 : 512),
    });

    const outcome = await shrinkAgentImageToFit(
      { name: "shot.png", mime: "image/png", bytes: bytes(MAX_AGENT_IMAGE_BYTES + 1) },
      port,
    );

    expect(outcome).toMatchObject({
      kind: "ready",
      name: "shot.webp",
      mime: "image/webp",
      width: AGENT_IMAGE_MAX_EDGE,
      height: 1_024,
      reencoded: true,
    });
    expect(calls.map((call) => call.quality)).toEqual([0.92, 0.85]);
  });

  it("falls back to the scale ladder when every quality overflows", async () => {
    const { calls, port } = surface({
      width: 4_096,
      height: 2_048,
      encodedBytes: (_quality, width) =>
        width === AGENT_IMAGE_MAX_EDGE ? MAX_AGENT_IMAGE_BYTES + 1 : 256,
    });

    const outcome = await shrinkAgentImageToFit(
      { name: "shot.heic", mime: "image/heic", bytes: bytes(MAX_AGENT_IMAGE_BYTES + 1) },
      port,
    );

    expect(outcome).toMatchObject({ kind: "ready", width: 1_536, height: 768, reencoded: true });
    expect(calls.map((call) => call.width)).toEqual([2_048, 2_048, 2_048, 2_048, 1_536]);
  });

  it("reports too-large when every pass overflows", async () => {
    const { port } = surface({ encodedBytes: () => MAX_AGENT_IMAGE_BYTES + 1 });

    expect(
      await shrinkAgentImageToFit(
        { name: "shot.png", mime: "image/png", bytes: bytes(MAX_AGENT_IMAGE_BYTES + 1) },
        port,
      ),
    ).toEqual({ kind: "refused", reason: "too-large" });
  });

  it("reports unreadable when decoding throws", async () => {
    const { port } = surface({
      decode: () => Promise.reject(new Error("undecodable")),
    });

    expect(
      await shrinkAgentImageToFit(
        { name: "photo.heic", mime: "image/heic", bytes: bytes(4_096) },
        port,
      ),
    ).toEqual({ kind: "refused", reason: "unreadable" });
  });

  it("reports unreadable when every encode throws", async () => {
    const { port } = surface({ encodedBytes: () => "throw" });

    expect(
      await shrinkAgentImageToFit(
        { name: "shot.png", mime: "image/png", bytes: bytes(MAX_AGENT_IMAGE_BYTES + 1) },
        port,
      ),
    ).toEqual({ kind: "refused", reason: "unreadable" });
  });

  it("refuses dimensions outside the supported range as undecodable", async () => {
    const { port } = surface({ width: 20_000, height: 10 });

    expect(
      await shrinkAgentImageToFit({ name: "wide.png", mime: "image/png", bytes: bytes(16) }, port),
    ).toEqual({ kind: "refused", reason: "unreadable" });
  });

  it("refuses above the decode guard without decoding", async () => {
    const decode = vi.fn(async () => ({ width: 10, height: 10 }));
    const { port } = surface({ decode });

    expect(
      await shrinkAgentImageToFit(
        { name: "huge.png", mime: "image/png", bytes: bytes(MAX_AGENT_IMAGE_SOURCE_BYTES + 1) },
        port,
      ),
    ).toEqual({ kind: "refused", reason: "too-large" });
    expect(decode).not.toHaveBeenCalled();
  });

  it("uses jpeg when webp encoding is unavailable", async () => {
    const { calls, port } = surface({ encodeMime: "image/jpeg" });

    expect(
      await shrinkAgentImageToFit(
        { name: "shot.png", mime: "image/png", bytes: bytes(MAX_AGENT_IMAGE_BYTES + 1) },
        port,
      ),
    ).toMatchObject({ kind: "ready", name: "shot.jpg", mime: "image/jpeg" });
    expect(calls[0]?.mime).toBe("image/jpeg");
  });
});

describe("agentImageFitBox and shrunk names", () => {
  it("keeps a small image and bounds the longest edge", () => {
    expect(agentImageFitBox(800, 600, 2_048)).toEqual({ width: 800, height: 600 });
    expect(agentImageFitBox(4_096, 1_024, 2_048)).toEqual({ width: 2_048, height: 512 });
    expect(agentImageFitBox(10, 100_000, 2_048)).toEqual({ width: 1, height: 2_048 });
  });

  it("swaps the extension for the encoded mime", () => {
    expect(agentShrunkAttachmentName("photo.heic", "image/webp")).toBe("photo.webp");
    expect(agentShrunkAttachmentName("photo", "image/jpeg")).toBe("photo.jpg");
    expect(agentShrunkAttachmentName(".hidden", "image/webp")).toBe(".hidden.webp");
  });
});
