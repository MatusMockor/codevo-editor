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
      { openPinnedFile, previewFile: vi.fn(async () => undefined) },
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

  it("loads a preview in the background without ever revealing the editor", async () => {
    const reveal = vi.fn();
    const previewFile = vi.fn(async () => undefined);
    const openers = revealingFileOpeners(
      { openPinnedFile: vi.fn(async () => true), previewFile },
      reveal,
    );

    openers.onPreviewFile(ENTRY);
    await settle();
    await settle();

    expect(previewFile).toHaveBeenCalledWith(ENTRY);
    expect(reveal).not.toHaveBeenCalled();
  });
});
