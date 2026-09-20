import { describe, expect, it, vi } from "vitest";
import { importSavedSessionHistory } from "./importSavedSessionHistory";
import type { ExternalSessionImportGateway } from "../domain/externalSessionImport";
const request = { rootKey: "/repo", ownerId: "owner", threadId: "thread" };
function gateway(): ExternalSessionImportGateway {
  return { importSessionHistory: vi.fn(), readImportedHistory: vi.fn() };
}
describe("durable imported session coordinator", () => {
  it("waits for durable completion across steps and returns omission status", async () => {
    const port = gateway();
    vi.mocked(port.importSessionHistory)
      .mockResolvedValueOnce({ complete: false, importedCount: 64, truncated: false })
      .mockResolvedValueOnce({ complete: true, importedCount: 70, truncated: true });
    await expect(importSavedSessionHistory(port, request, () => true)).resolves.toEqual({
      complete: true,
      importedCount: 70,
      truncated: true,
    });
    expect(port.importSessionHistory).toHaveBeenCalledTimes(2);
  });
  it("stops before another step after workspace authority changes", async () => {
    const port = gateway();
    let current = true;
    vi.mocked(port.importSessionHistory).mockImplementation(async () => {
      current = false;
      return { complete: false, importedCount: 64, truncated: false };
    });
    await expect(importSavedSessionHistory(port, request, () => current)).rejects.toThrow(
      "project changed",
    );
    expect(port.importSessionHistory).toHaveBeenCalledTimes(1);
  });
  it("does not run work after cancellation and leaves retry state on failure", async () => {
    const port = gateway();
    await expect(importSavedSessionHistory(port, request, () => false)).rejects.toThrow(
      "project changed",
    );
    expect(port.importSessionHistory).not.toHaveBeenCalled();
    vi.mocked(port.importSessionHistory).mockRejectedValue(new Error("source changed"));
    await expect(importSavedSessionHistory(port, request, () => true)).rejects.toThrow(
      "source changed",
    );
  });
  it("bounds a backend that never completes", async () => {
    const port = gateway();
    vi.mocked(port.importSessionHistory).mockResolvedValue({
      complete: false,
      importedCount: 0,
      truncated: false,
    });
    await expect(importSavedSessionHistory(port, request, () => true)).rejects.toThrow(
      "checkpoint was saved",
    );
    expect(port.importSessionHistory).toHaveBeenCalledTimes(16_384);
  });
});
