import { describe, expect, it, vi } from "vitest";
import { createChunkLoader } from "./chunkLoader";

describe("createChunkLoader", () => {
  it("imports a chunk once for repeated preloads and loads", async () => {
    const module = { name: "terminal" };
    const importChunk = vi.fn(async () => module);
    const loader = createChunkLoader(importChunk);

    loader.preload();
    loader.preload();
    await expect(loader.load()).resolves.toBe(module);

    expect(importChunk).toHaveBeenCalledTimes(1);
  });

  it("retries the import after a failed load and swallows preload failures", async () => {
    const module = { name: "terminal" };
    const importChunk = vi
      .fn<() => Promise<typeof module>>()
      .mockRejectedValueOnce(new Error("chunk offline"))
      .mockResolvedValueOnce(module);
    const loader = createChunkLoader(importChunk);

    loader.preload();
    await Promise.resolve();
    await Promise.resolve();
    await expect(loader.load()).resolves.toBe(module);

    expect(importChunk).toHaveBeenCalledTimes(2);
  });

  it("rejects a direct load with the import error", async () => {
    const loader = createChunkLoader(async () => {
      throw new Error("chunk offline");
    });

    await expect(loader.load()).rejects.toThrow("chunk offline");
  });
});
