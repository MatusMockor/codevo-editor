import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentImageEncodeMime } from "../domain/agentImageShrink";
import { WebviewAgentImageSurface } from "./webviewAgentImageSurface";

interface CanvasCall {
  readonly fills: number;
  readonly mime: string;
}

class FakeBitmap {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
  close(): void {}
}

function installCanvas(calls: CanvasCall[]): void {
  class FakeOffscreenCanvas {
    private fills = 0;
    constructor(
      readonly width: number,
      readonly height: number,
    ) {}
    getContext() {
      return {
        fillStyle: "",
        fillRect: () => {
          this.fills += 1;
        },
        drawImage: () => undefined,
      };
    }
    async convertToBlob(options: { type: string }) {
      calls.push({ fills: this.fills, mime: options.type });
      return new Blob([new Uint8Array(4)], { type: options.type });
    }
  }
  vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
  vi.stubGlobal("ImageBitmap", FakeBitmap);
}

describe("WebviewAgentImageSurface", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each<[AgentImageEncodeMime, number]>([
    ["image/png", 0],
    ["image/webp", 0],
    ["image/jpeg", 1],
  ])(
    "encodes %s with %i matte fills so transparency survives lossless output",
    async (mime, fills) => {
      const calls: CanvasCall[] = [];
      installCanvas(calls);
      const surface = new WebviewAgentImageSurface();

      const bytes = await surface.encode(new FakeBitmap(2_742, 1_416), 1_568, 810, mime, 1);

      expect(bytes.byteLength).toBe(4);
      expect(calls).toEqual([{ fills, mime }]);
    },
  );
});
