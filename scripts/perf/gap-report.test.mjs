import { describe, expect, it, vi } from "vitest";
import { MAX_CAPTURE_JSON_BYTES, PERF_CAPTURE_CONTRACT_METADATA } from "./perfCaptureContract.mjs";
import { readCaptureFile } from "./gap-report.mjs";

function fakeOpen(raw, size = Buffer.byteLength(raw, "utf8")) {
  const close = vi.fn(async () => {});
  const bytes = Buffer.from(raw, "utf8");
  let offset = 0;
  const openFile = vi.fn(async () => ({
    stat: async () => ({ size }),
    read: async (buffer) => {
      const bytesRead = Math.min(buffer.length, bytes.length - offset);
      bytes.copy(buffer, 0, offset, offset + bytesRead);
      offset += bytesRead;
      return { bytesRead, buffer };
    },
    close,
  }));
  return { openFile, close };
}

describe("perf gap-report capture ingestion", () => {
  it("rejects an oversized file from descriptor metadata before reading it", async () => {
    const harness = fakeOpen("{}", MAX_CAPTURE_JSON_BYTES + 1);
    await expect(readCaptureFile("huge.json", "codevo", harness.openFile)).rejects.toThrow(
      /above the 8388608 byte bound/,
    );
    expect(harness.close).toHaveBeenCalledOnce();
  });

  it("stops at MAX+1 when a file grows after descriptor metadata was read", async () => {
    const raw = "x".repeat(MAX_CAPTURE_JSON_BYTES + 1);
    const harness = fakeOpen(raw, 2);
    await expect(readCaptureFile("grew.json", "codevo", harness.openFile)).rejects.toThrow(
      /grew above the 8388608 byte bound/,
    );
    expect(harness.close).toHaveBeenCalledOnce();
  });

  it("rejects duplicate keys before they can be collapsed by JSON.parse", async () => {
    const raw = '{"captureContract":{"version":"x","version":"y"}}';
    const harness = fakeOpen(raw);
    await expect(readCaptureFile("duplicate.json", "codevo", harness.openFile)).rejects.toThrow(
      /duplicate object key "version"/,
    );
    expect(harness.close).toHaveBeenCalledOnce();
  });

  it("does not accept a tiny object merely because it is bounded JSON", async () => {
    const raw = JSON.stringify({ captureContract: PERF_CAPTURE_CONTRACT_METADATA });
    const harness = fakeOpen(raw);
    await expect(readCaptureFile("incomplete.json", "codevo", harness.openFile)).rejects.toThrow(
      /violates the canonical contract/,
    );
    expect(harness.close).toHaveBeenCalledOnce();
  });
});
