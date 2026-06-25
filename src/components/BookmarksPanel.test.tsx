// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bookmark } from "../domain/bookmarks";
import { BookmarksPanel } from "./BookmarksPanel";

describe("BookmarksPanel", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("renders nothing while closed", async () => {
    await renderPanel({ isOpen: false });

    expect(host.querySelector('[aria-label="Bookmarks"]')).toBeNull();
  });

  it("lists bookmarks grouped by file with line and preview", async () => {
    await renderPanel();

    const rows = bookmarkRows();

    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("const total = sum(items);");
    expect(rows[0].textContent).toContain("Invoice.php:12");
    expect(host.textContent).toContain("Invoice.php");
    expect(host.textContent).toContain("legacy.ts");
  });

  it("navigates to the bookmark when a row is clicked", async () => {
    const onOpenBookmark = vi.fn();
    await renderPanel({ onOpenBookmark });

    await act(async () => {
      bookmarkRows()[0].dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(onOpenBookmark).toHaveBeenCalledOnce();
    expect(onOpenBookmark).toHaveBeenCalledWith(
      expect.objectContaining({
        lineNumber: 12,
        path: "/workspace/app/Invoice.php",
      }),
    );
  });

  it("shows an empty state when there are no bookmarks", async () => {
    await renderPanel({ bookmarks: [] });

    expect(bookmarkRows()).toHaveLength(0);
    expect(host.textContent).toContain("No bookmarks");
  });

  it("closes when Escape is pressed", async () => {
    const onClose = vi.fn();
    await renderPanel({ onClose });

    await act(async () => {
      panelDialog().dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      );
    });

    expect(onClose).toHaveBeenCalledOnce();
  });

  async function renderPanel(
    overrides: Partial<{
      bookmarks: Bookmark[];
      isOpen: boolean;
      onClose: () => void;
      onOpenBookmark: (bookmark: Bookmark) => void;
    }> = {},
  ) {
    await act(async () => {
      root.render(
        <BookmarksPanel
          bookmarks={overrides.bookmarks ?? bookmarks()}
          isOpen={overrides.isOpen ?? true}
          onClose={overrides.onClose ?? vi.fn()}
          onOpenBookmark={overrides.onOpenBookmark ?? vi.fn()}
          workspaceRoot="/workspace"
        />,
      );
      await Promise.resolve();
    });
  }

  function bookmarkRows(): HTMLButtonElement[] {
    return Array.from(
      host.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    );
  }

  function panelDialog(): HTMLElement {
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]');

    if (!dialog) {
      throw new Error("Bookmarks panel dialog was not rendered.");
    }

    return dialog;
  }
});

function bookmarks(): Bookmark[] {
  return [
    {
      lineNumber: 12,
      path: "/workspace/app/Invoice.php",
      preview: "const total = sum(items);",
    },
    {
      lineNumber: 40,
      path: "/workspace/src/legacy.ts",
      preview: "deprecated();",
    },
  ];
}
