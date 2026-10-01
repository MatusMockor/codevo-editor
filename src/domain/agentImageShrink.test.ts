import { describe, expect, it, vi } from "vitest";
import { AGENT_IMAGE_MAX_MODEL_BYTES, MAX_AGENT_IMAGE_BYTES } from "./agentAttachment";
import { MAX_AGENT_IMAGE_SOURCE_BYTES } from "./agentAttachmentIntake";
import {
  AGENT_IMAGE_LOSSLESS_MAX_BYTES,
  AGENT_IMAGE_MAX_EDGE,
  agentImageFitBox,
  agentShrunkAttachmentName,
  shrinkAgentImageToFit,
  type AgentImageEncodeMime,
  type AgentImageSource,
  type AgentImageSurfacePort,
  type AgentImageOutputPolicy,
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
  const policy: AgentImageOutputPolicy = {
    maxBytes: 5 * 1024 * 1024,
    maxDimension: 8192,
    acceptedMimes: ["image/png", "image/jpeg"],
    encodeMime: "image/jpeg",
  };

  it.each([5 * 1024 * 1024 + 1, MAX_AGENT_IMAGE_BYTES + 1])(
    "uses the target byte budget and encoder for a %i-byte image",
    async (size) => {
      const { calls, port } = surface();
      const probe = vi.spyOn(port, "encodeMime");
      const outcome = await shrinkAgentImageToFit(
        { name: "shot.jpg", mime: "image/jpeg", bytes: bytes(size) },
        port,
        policy,
      );
      expect(outcome).toMatchObject({ kind: "ready", mime: "image/jpeg", name: "shot.jpg" });
      expect(calls[0]?.mime).toBe("image/jpeg");
      expect(probe).not.toHaveBeenCalled();
    },
  );

  it("keeps encoding when an image fits the default budget but exceeds the target budget", async () => {
    const { calls, port } = surface({
      encodedBytes: (quality) => (quality > 0.85 ? policy.maxBytes + 1 : 1024),
    });
    const outcome = await shrinkAgentImageToFit(
      { name: "shot.png", mime: "image/png", bytes: bytes(policy.maxBytes + 1) },
      port,
      policy,
    );
    expect(outcome).toMatchObject({ kind: "ready", mime: "image/jpeg" });
    expect(calls.map((call) => call.mime)).toEqual(["image/png", "image/jpeg", "image/jpeg"]);
  });

  it("reencodes unsupported target formats and dimensions even below its byte budget", async () => {
    for (const [mime, width, encoded] of [
      ["image/webp", 800, "image/png"],
      ["image/jpeg", 9000, "image/jpeg"],
    ] as const) {
      const { port } = surface({ width });
      expect(
        await shrinkAgentImageToFit({ name: "shot", mime, bytes: bytes(1024) }, port, policy),
      ).toMatchObject({ kind: "ready", mime: encoded, reencoded: true });
    }
  });

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

  it("re-encodes an oversized image down the quality ladder at the model edge", async () => {
    const { calls, port } = surface({
      width: 4_096,
      height: 2_048,
      encodedBytes: (quality) => (quality > 0.85 ? MAX_AGENT_IMAGE_BYTES + 1 : 512),
    });

    const outcome = await shrinkAgentImageToFit(
      { name: "shot.jpg", mime: "image/jpeg", bytes: bytes(MAX_AGENT_IMAGE_BYTES + 1) },
      port,
    );

    expect(outcome).toMatchObject({
      kind: "ready",
      name: "shot.webp",
      mime: "image/webp",
      width: AGENT_IMAGE_MAX_EDGE,
      height: 784,
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

    expect(outcome).toMatchObject({ kind: "ready", width: 1_176, height: 588, reencoded: true });
    expect(calls.map((call) => call.width)).toEqual([1_568, 1_568, 1_568, 1_568, 1_176]);
  });

  it("downscales a retina screenshot that fits every byte budget to the model edge as png", async () => {
    const { calls, port } = surface({ width: 2_742, height: 1_416 });

    const outcome = await shrinkAgentImageToFit(
      { name: "shot.png", mime: "image/png", bytes: bytes(424_097) },
      port,
    );

    expect(outcome).toMatchObject({
      kind: "ready",
      name: "shot.png",
      mime: "image/png",
      width: 1_568,
      height: 810,
      reencoded: true,
    });
    expect(calls).toEqual([{ width: 1_568, height: 810, mime: "image/png", quality: 1 }]);
  });

  it("downscales a portrait retina screenshot along its long edge", async () => {
    const { port } = surface({ width: 1_626, height: 2_544 });

    expect(
      await shrinkAgentImageToFit(
        { name: "tall.png", mime: "image/png", bytes: bytes(322_528) },
        port,
      ),
    ).toMatchObject({ kind: "ready", width: 1_002, height: 1_568, mime: "image/png" });
  });

  it("keeps an image at exactly the model edge untouched", async () => {
    const { calls, port } = surface({ width: AGENT_IMAGE_MAX_EDGE, height: 900 });

    expect(
      await shrinkAgentImageToFit(
        { name: "edge.png", mime: "image/png", bytes: bytes(2_048) },
        port,
      ),
    ).toMatchObject({ kind: "ready", reencoded: false, width: AGENT_IMAGE_MAX_EDGE });
    expect(calls).toHaveLength(0);
  });

  it("re-encodes a small image whose bytes exceed the model byte budget", async () => {
    const { calls, port } = surface({ width: 800, height: 600 });

    const outcome = await shrinkAgentImageToFit(
      { name: "noisy.png", mime: "image/png", bytes: bytes(AGENT_IMAGE_MAX_MODEL_BYTES + 1) },
      port,
    );

    expect(outcome).toMatchObject({ kind: "ready", mime: "image/png", width: 800, height: 600 });
    expect(calls).toHaveLength(1);
  });

  it("falls back to the lossy encoder when the png re-encode exceeds the byte budget", async () => {
    const { calls, port } = surface({
      width: 2_742,
      height: 1_416,
      encodedBytes: (quality) => (quality === 1 ? AGENT_IMAGE_MAX_MODEL_BYTES + 1 : 900_000),
    });

    const outcome = await shrinkAgentImageToFit(
      { name: "photo.png", mime: "image/png", bytes: bytes(8_000_000) },
      port,
    );

    expect(outcome).toMatchObject({ kind: "ready", mime: "image/webp", name: "photo.webp" });
    expect(calls.map((call) => call.mime)).toEqual(["image/png", "image/webp"]);
    expect(outcome.kind === "ready" && outcome.bytes.byteLength).toBeLessThanOrEqual(
      AGENT_IMAGE_MAX_MODEL_BYTES,
    );
  });

  it("never returns more bytes than the model budget and bounds the encode attempts", async () => {
    const { calls, port } = surface({
      width: 2_742,
      height: 1_416,
      encodedBytes: () => AGENT_IMAGE_MAX_MODEL_BYTES + 1,
    });

    expect(
      await shrinkAgentImageToFit(
        { name: "shot.png", mime: "image/png", bytes: bytes(424_097) },
        port,
      ),
    ).toEqual({ kind: "refused", reason: "too-large" });
    expect(calls).toHaveLength(13);
    expect(Math.max(...calls.map((call) => Math.max(call.width, call.height)))).toBe(
      AGENT_IMAGE_MAX_EDGE,
    );
  });

  it("rejects a lossless png pass above the lossless budget and uses the lossy ladder", async () => {
    const { calls, port } = surface({
      width: 2_742,
      height: 1_416,
      encodedBytes: (quality) => (quality === 1 ? AGENT_IMAGE_LOSSLESS_MAX_BYTES + 1 : 400_000),
    });

    const outcome = await shrinkAgentImageToFit(
      { name: "photo.png", mime: "image/png", bytes: bytes(424_097) },
      port,
    );

    expect(AGENT_IMAGE_LOSSLESS_MAX_BYTES).toBeLessThan(AGENT_IMAGE_MAX_MODEL_BYTES);
    expect(outcome).toMatchObject({ kind: "ready", mime: "image/webp", width: 1_568 });
    expect(calls.map((call) => call.mime)).toEqual(["image/png", "image/webp"]);
  });

  it.each([
    ["anim.gif", "image/gif"],
    ["capture.webp", "image/webp"],
  ])("re-encodes an oversized %s losslessly as png", async (name, mime) => {
    const { calls, port } = surface({ width: 2_544, height: 1_626 });

    const outcome = await shrinkAgentImageToFit({ name, mime, bytes: bytes(322_528) }, port);

    expect(outcome).toMatchObject({
      kind: "ready",
      mime: "image/png",
      width: 1_568,
      height: 1_002,
      reencoded: true,
    });
    expect(outcome.kind === "ready" && outcome.name.endsWith(".png")).toBe(true);
    expect(calls).toEqual([{ width: 1_568, height: 1_002, mime: "image/png", quality: 1 }]);
  });

  it("keeps the model edge even when a policy allows larger dimensions", async () => {
    const { port } = surface({ width: 2_544, height: 1_626 });

    expect(
      await shrinkAgentImageToFit(
        { name: "shot.png", mime: "image/png", bytes: bytes(322_528) },
        port,
        policy,
      ),
    ).toMatchObject({ kind: "ready", mime: "image/png", width: 1_568, height: 1_002 });
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

  it("refuses dimensions above the supported range as oversized", async () => {
    const { calls, port } = surface({ width: 20_000, height: 10 });

    expect(
      await shrinkAgentImageToFit({ name: "wide.png", mime: "image/png", bytes: bytes(16) }, port),
    ).toEqual({ kind: "refused", reason: "oversized" });
    expect(calls).toHaveLength(0);
  });

  it("refuses an empty decoded dimension as undecodable", async () => {
    const { port } = surface({ width: 0, height: 10 });

    expect(
      await shrinkAgentImageToFit({ name: "empty.png", mime: "image/png", bytes: bytes(16) }, port),
    ).toEqual({ kind: "refused", reason: "unreadable" });
  });

  it("pins the model limits Codevo sends to Claude and Codex", () => {
    expect(AGENT_IMAGE_MAX_EDGE).toBe(1_568);
    expect(AGENT_IMAGE_MAX_MODEL_BYTES).toBe(3_750_000);
    expect(AGENT_IMAGE_LOSSLESS_MAX_BYTES).toBe(1_500_000);
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
        { name: "shot.jpg", mime: "image/jpeg", bytes: bytes(MAX_AGENT_IMAGE_BYTES + 1) },
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
