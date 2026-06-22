// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileTree } from "./FileTree";
import type { FileEntry } from "../domain/workspace";

describe("FileTree", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function renderTree(overrides: Partial<Parameters<typeof FileTree>[0]> = {}) {
    const props = {
      rootPath: "/workspace",
      entriesByDirectory: {
        "/workspace": [
          fileEntry("/workspace/src", "src", "directory"),
          fileEntry("/workspace/User.php", "User.php", "file"),
        ] as FileEntry[],
      } as Record<string, FileEntry[]>,
      expandedDirectories: new Set<string>(),
      loadingDirectories: new Set<string>(),
      activePath: null,
      revealActivePath: false,
      revealActivePathSignal: 0,
      onOpenFile: vi.fn(),
      onPreviewFile: vi.fn(),
      onToggleDirectory: vi.fn(),
      onPrefetchFile: vi.fn(),
      onCancelPrefetchFile: vi.fn(),
      ...overrides,
    };

    act(() => {
      root.render(<FileTree {...props} />);
    });

    return props;
  }

  it("prefetches a file when the pointer enters its row", () => {
    const onPrefetchFile = vi.fn();
    renderTree({ onPrefetchFile });

    const fileRow = rowByLabel("User.php");
    act(() => {
      fileRow.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });

    expect(onPrefetchFile).toHaveBeenCalledTimes(1);
    expect(onPrefetchFile.mock.calls[0][0]).toMatchObject({
      path: "/workspace/User.php",
    });
  });

  it("does not prefetch when the pointer enters a directory row", () => {
    const onPrefetchFile = vi.fn();
    renderTree({ onPrefetchFile });

    const directoryRow = rowByLabel("src");
    act(() => {
      directoryRow.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });

    expect(onPrefetchFile).not.toHaveBeenCalled();
  });

  it("cancels a pending prefetch when the pointer leaves a file row", () => {
    const onCancelPrefetchFile = vi.fn();
    renderTree({ onCancelPrefetchFile });

    const fileRow = rowByLabel("User.php");
    act(() => {
      fileRow.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });

    expect(onCancelPrefetchFile).toHaveBeenCalledTimes(1);
    expect(onCancelPrefetchFile.mock.calls[0][0]).toMatchObject({
      path: "/workspace/User.php",
    });
  });

  function rowByLabel(label: string): HTMLButtonElement {
    const rows = [...host.querySelectorAll<HTMLButtonElement>(".tree-row")];
    const match = rows.find((row) => row.textContent?.includes(label));

    if (!match) {
      throw new Error(`Tree row "${label}" was not found.`);
    }

    return match;
  }
});

function fileEntry(
  path: string,
  name: string,
  kind: "directory" | "file",
): FileEntry {
  return { kind, name, path };
}
