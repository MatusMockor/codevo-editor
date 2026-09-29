import { describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../../domain/workspace";
import { revealingFileOpeners } from "./revealingFileOpeners";

const ENTRY: FileEntry = { kind: "file", name: "orders.ts", path: "/w/src/orders.ts" };

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("revealingFileOpeners", () => {
  it("reveals the editor after a pinned open succeeds and never after it fails", async () => {
    const reveal = vi.fn();
    const openPinnedFile = vi.fn(async () => true);
    const openers = revealingFileOpeners(
      { openPinnedFile, previewFile: vi.fn(async () => true) },
      reveal,
    );

    openers.onOpenFile(ENTRY);
    await settle();
    expect(openPinnedFile).toHaveBeenCalledWith(ENTRY);
    expect(reveal).toHaveBeenCalledTimes(1);

    openPinnedFile.mockResolvedValueOnce(false);
    openers.onOpenFile(ENTRY);
    await settle();
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it("loads a preview without revealing and leaves the reveal to the caller", async () => {
    const reveal = vi.fn();
    const previewFile = vi.fn(async () => true);
    const openers = revealingFileOpeners(
      { openPinnedFile: vi.fn(async () => true), previewFile },
      reveal,
    );

    await expect(openers.onPreviewFile(ENTRY)).resolves.toBe(true);
    expect(previewFile).toHaveBeenCalledWith(ENTRY);
    expect(reveal).not.toHaveBeenCalled();

    openers.revealEditor();
    expect(reveal).toHaveBeenCalledOnce();
  });
});
