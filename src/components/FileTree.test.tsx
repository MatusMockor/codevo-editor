// @vitest-environment jsdom

import { act, useState } from "react";
import type { ComponentProps } from "react";
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

  it("renders the file context menu and dispatches every entry action", () => {
    const onRenameEntry = vi.fn();
    const onRevealEntry = vi.fn();
    const onOpenEntryInTerminal = vi.fn();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderTree({ onOpenEntryInTerminal, onRenameEntry, onRevealEntry });

    const fileRow = rowByLabel("User.php");
    act(() => {
      fileRow.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 40,
          clientY: 60,
        }),
      );
    });

    expect(menuItems().map((item) => item.textContent)).toEqual([
      "Reveal in Finder",
      "Copy Path",
      "Copy Relative Path",
      "Open in Terminal",
      "Rename",
    ]);

    clickMenuItem("Reveal in Finder");
    expect(onRevealEntry).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/workspace/User.php" }),
    );

    openFileMenu();
    clickMenuItem("Copy Path");
    expect(writeText).toHaveBeenCalledWith("/workspace/User.php");

    openFileMenu();
    clickMenuItem("Copy Relative Path");
    expect(writeText).toHaveBeenCalledWith("User.php");

    openFileMenu();
    clickMenuItem("Open in Terminal");
    expect(onOpenEntryInTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/workspace/User.php" }),
    );

    openFileMenu();
    clickMenuItem("Rename");
    expect(onRenameEntry).toHaveBeenCalledTimes(1);
    expect(onRenameEntry.mock.calls[0][0]).toMatchObject({
      kind: "file",
      path: "/workspace/User.php",
    });
  });

  it("closes on Escape and navigates menu items with arrow keys", () => {
    renderTree({ onRenameEntry: vi.fn() });
    openFileMenu();

    const firstItem = menuItems()[0];
    act(() => firstItem.focus());
    act(() =>
      firstItem.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      ),
    );
    expect(document.activeElement).toBe(menuItems()[1]);

    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      ),
    );
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("does not throw when the clipboard API is absent", () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    renderTree();
    openFileMenu();

    expect(() => clickMenuItem("Copy Path")).not.toThrow();
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

  it("does not remeasure layout while scrolling the virtualized tree", () => {
    const animationFrame = installAnimationFrameMock();
    const viewport = mockElementViewportHeight(360);

    try {
      renderTree({
        entriesByDirectory: {
          "/workspace": phpFileEntries(120),
        },
      });
      act(() => {
        animationFrame.flush();
      });
      viewport.getBoundingClientRect.mockClear();

      const tree = host.querySelector<HTMLElement>(
        '[aria-label="Workspace files"]',
      );
      expect(tree).not.toBeNull();

      act(() => {
        if (!tree) {
          return;
        }

        tree.scrollTop = 128;
        tree.dispatchEvent(new Event("scroll", { bubbles: true }));
        animationFrame.flush();
      });

      act(() => {
        if (!tree) {
          return;
        }

        tree.scrollTop = 256;
        tree.dispatchEvent(new Event("scroll", { bubbles: true }));
        animationFrame.flush();
      });

      expect(viewport.getBoundingClientRect).not.toHaveBeenCalled();
    } finally {
      animationFrame.restore();
      viewport.restore();
    }
  });

  it("renders more virtual rows after measuring the real viewport height", () => {
    const animationFrame = installAnimationFrameMock();
    let measuredHeight = 0;
    const viewport = mockElementViewportHeight(() => measuredHeight);

    try {
      renderTree({
        entriesByDirectory: {
          "/workspace": phpFileEntries(80),
        },
      });

      expect(host.querySelectorAll(".tree-row")).toHaveLength(28);

      measuredHeight = 960;

      act(() => {
        animationFrame.flush();
      });

      expect(host.querySelectorAll(".tree-row")).toHaveLength(46);
    } finally {
      animationFrame.restore();
      viewport.restore();
    }
  });

  it("does not re-render when the parent re-renders with identical props", async () => {
    // The component calls `expandedDirectories.has(entry.path)` for every
    // rendered row, so spying on that method counts how often the memoized
    // tree renders. Diagnostics streaming re-renders the App with unchanged
    // FileTree props, and this guards that the tree no longer re-renders then.
    const expandedDirectories = new Set<string>();
    const hasSpy = vi.spyOn(expandedDirectories, "has");
    const stableProps: ComponentProps<typeof FileTree> = {
      rootPath: "/workspace",
      entriesByDirectory: {
        "/workspace": [
          fileEntry("/workspace/src", "src", "directory"),
          fileEntry("/workspace/User.php", "User.php", "file"),
        ],
      },
      expandedDirectories,
      loadingDirectories: new Set<string>(),
      activePath: null,
      revealActivePath: false,
      revealActivePathSignal: 0,
      onOpenFile: vi.fn(),
      onPreviewFile: vi.fn(),
      onToggleDirectory: vi.fn(),
      onPrefetchFile: vi.fn(),
      onCancelPrefetchFile: vi.fn(),
    };

    let forceParentRender: (value: number) => void = () => undefined;

    function Parent() {
      const [, setTick] = useState(0);
      forceParentRender = setTick;
      return <FileTree {...stableProps} />;
    }

    await act(async () => {
      root.render(<Parent />);
      await Promise.resolve();
    });

    const callsAfterMount = hasSpy.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThan(0);

    await act(async () => {
      forceParentRender(1);
      await Promise.resolve();
    });

    expect(hasSpy.mock.calls.length).toBe(callsAfterMount);

    hasSpy.mockRestore();
  });

  function rowByLabel(label: string): HTMLButtonElement {
    const rows = [...host.querySelectorAll<HTMLButtonElement>(".tree-row")];
    const match = rows.find((row) => row.textContent?.includes(label));

    if (!match) {
      throw new Error(`Tree row "${label}" was not found.`);
    }

    return match;
  }

  function openFileMenu() {
    act(() => {
      rowByLabel("User.php").dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
    });
  }

  function menuItems(): HTMLButtonElement[] {
    return [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  }

  function clickMenuItem(label: string) {
    const item = menuItems().find((candidate) => candidate.textContent === label);

    if (!item) {
      throw new Error(`Menu item "${label}" was not found.`);
    }

    act(() => item.click());
  }
});

function fileEntry(
  path: string,
  name: string,
  kind: "directory" | "file",
): FileEntry {
  return { kind, name, path };
}

function phpFileEntries(count: number): FileEntry[] {
  return Array.from({ length: count }, (_value, index) =>
    fileEntry(`/workspace/File${index}.php`, `File${index}.php`, "file"),
  );
}

function installAnimationFrameMock() {
  const originalRequestAnimationFrame = Object.getOwnPropertyDescriptor(
    globalThis,
    "requestAnimationFrame",
  );
  const originalCancelAnimationFrame = Object.getOwnPropertyDescriptor(
    globalThis,
    "cancelAnimationFrame",
  );
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextHandle = 1;

  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: vi.fn((callback: FrameRequestCallback) => {
      const handle = nextHandle;
      nextHandle += 1;
      callbacks.set(handle, callback);

      return handle;
    }),
    writable: true,
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    value: vi.fn((handle: number) => {
      callbacks.delete(handle);
    }),
    writable: true,
  });

  return {
    flush() {
      const pendingCallbacks = [...callbacks.values()];
      callbacks.clear();

      for (const callback of pendingCallbacks) {
        callback(0);
      }
    },
    restore() {
      callbacks.clear();
      restoreProperty(
        globalThis,
        "requestAnimationFrame",
        originalRequestAnimationFrame,
      );
      restoreProperty(
        globalThis,
        "cancelAnimationFrame",
        originalCancelAnimationFrame,
      );
    },
  };
}

function mockElementViewportHeight(height: number | (() => number)) {
  const originalGetBoundingClientRect = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "getBoundingClientRect",
  );
  const getBoundingClientRect = vi.fn(() => {
    const measuredHeight = typeof height === "function" ? height() : height;

    return {
      bottom: measuredHeight,
      height: measuredHeight,
      left: 0,
      right: 240,
      top: 0,
      width: 240,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  });

  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: getBoundingClientRect,
  });

  return {
    getBoundingClientRect,
    restore() {
      restoreProperty(
        HTMLElement.prototype,
        "getBoundingClientRect",
        originalGetBoundingClientRect,
      );
    },
  };
}

function restoreProperty(
  target: object,
  property: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor);
    return;
  }

  Reflect.deleteProperty(target, property);
}
