// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  useBookmarks,
  type Bookmarks,
} from "./useBookmarks";
import type { Bookmark } from "../domain/bookmarks";
import type { EditorDocument } from "../domain/workspace";
import type { EditorPosition } from "../domain/languageServerFeatures";

const ROOT = "/workspace";

function editorDocument(path: string, content: string): EditorDocument {
  return { content, language: "typescript", name: path, path, savedContent: content };
}

interface Harness {
  hook: () => Bookmarks;
  bookmarks: () => Bookmark[];
  activeDocumentRef: { current: EditorDocument | null };
  activeEditorPositionRef: { current: EditorPosition | null };
  currentWorkspaceRootRef: { current: string | null };
  openNavigationTarget: ReturnType<typeof vi.fn>;
  unmount: () => void;
}

/**
 * Mounts useBookmarks with a live `bookmarks` state so the harness behaves
 * like the real shell: `bookmarks`/`setBookmarks` stay shell-owned per the
 * hook's own dependency contract (mirroring gitStatus/applyGitOperationStatus
 * for useGitWorkspace), so the harness's wrapper component owns that state and
 * passes it in, exactly like the shell does.
 */
function renderBookmarks(initialBookmarks: Bookmark[] = []): Harness {
  const container = window.document.createElement("div");
  const root = createRoot(container);
  const captured: { hook: Bookmarks | null; bookmarks: Bookmark[] } = {
    hook: null,
    bookmarks: initialBookmarks,
  };

  const activeDocumentRef: { current: EditorDocument | null } = { current: null };
  const activeEditorPositionRef: { current: EditorPosition | null } = {
    current: null,
  };
  const currentWorkspaceRootRef: { current: string | null } = { current: ROOT };
  const openNavigationTarget = vi.fn(
    async (_path: string, _position: EditorPosition, _label: string) => true,
  );

  function Harness() {
    const [bookmarks, setBookmarks] = useState<Bookmark[]>(initialBookmarks);
    captured.bookmarks = bookmarks;

    captured.hook = useBookmarks({
      bookmarks,
      setBookmarks,
      activeDocumentRef,
      activeEditorPositionRef,
      currentWorkspaceRootRef,
      openNavigationTarget,
    });
    return null;
  }

  act(() => {
    root.render(<Harness />);
  });

  return {
    hook: () => {
      if (!captured.hook) {
        throw new Error("hook not mounted");
      }
      return captured.hook;
    },
    bookmarks: () => captured.bookmarks,
    activeDocumentRef,
    activeEditorPositionRef,
    currentWorkspaceRootRef,
    openNavigationTarget,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("useBookmarks", () => {
  it("toggles a bookmark on the active document's line, capturing a trimmed preview", () => {
    const harness = renderBookmarks();
    harness.activeDocumentRef.current = editorDocument(
      `${ROOT}/a.ts`,
      "const a = 1;\n  const b = 2;\n",
    );

    act(() => {
      harness.hook().toggleBookmarkAtLine(2);
    });

    expect(harness.bookmarks()).toEqual([
      { lineNumber: 2, path: `${ROOT}/a.ts`, preview: "const b = 2;" },
    ]);

    // Toggling the same line again removes it (PhpStorm F11 toggle semantics).
    act(() => {
      harness.hook().toggleBookmarkAtLine(2);
    });

    expect(harness.bookmarks()).toEqual([]);

    harness.unmount();
  });

  it("toggles a bookmark at the cursor using the live editor position", () => {
    const harness = renderBookmarks();
    harness.activeDocumentRef.current = editorDocument(
      `${ROOT}/a.ts`,
      "one\ntwo\nthree\n",
    );
    harness.activeEditorPositionRef.current = { column: 1, lineNumber: 3 };

    act(() => {
      harness.hook().toggleBookmarkAtCursor();
    });

    expect(harness.bookmarks()).toEqual([
      { lineNumber: 3, path: `${ROOT}/a.ts`, preview: "three" },
    ]);

    harness.unmount();
  });

  it("does nothing when there is no active document", () => {
    const harness = renderBookmarks();

    act(() => {
      harness.hook().toggleBookmarkAtLine(1);
    });

    expect(harness.bookmarks()).toEqual([]);

    harness.unmount();
  });

  it("opens a bookmark through openNavigationTarget at column 1", async () => {
    const harness = renderBookmarks();

    await act(async () => {
      await harness.hook().openBookmark({
        lineNumber: 5,
        path: `${ROOT}/a.ts`,
        preview: "const a = 1;",
      });
    });

    expect(harness.openNavigationTarget).toHaveBeenCalledWith(
      `${ROOT}/a.ts`,
      { column: 1, lineNumber: 5 },
      "bookmark",
    );

    harness.unmount();
  });

  it("navigates to the next bookmark across files in sorted order, wrapping around", async () => {
    const harness = renderBookmarks([
      { lineNumber: 5, path: `${ROOT}/a.ts`, preview: "a5" },
      { lineNumber: 1, path: `${ROOT}/b.ts`, preview: "b1" },
    ]);
    harness.activeDocumentRef.current = editorDocument(`${ROOT}/a.ts`, "");
    harness.activeEditorPositionRef.current = { column: 1, lineNumber: 5 };

    const opened = await act(async () => harness.hook().goToNextBookmark());

    expect(opened).toBe(true);
    expect(harness.openNavigationTarget).toHaveBeenCalledWith(
      `${ROOT}/b.ts`,
      { column: 1, lineNumber: 1 },
      "bookmark",
    );

    harness.unmount();
  });

  it("navigates to the previous bookmark, wrapping to the last one", async () => {
    const harness = renderBookmarks([
      { lineNumber: 5, path: `${ROOT}/a.ts`, preview: "a5" },
      { lineNumber: 1, path: `${ROOT}/b.ts`, preview: "b1" },
    ]);
    harness.activeDocumentRef.current = editorDocument(`${ROOT}/a.ts`, "");
    harness.activeEditorPositionRef.current = { column: 1, lineNumber: 5 };

    const opened = await act(async () => harness.hook().goToPreviousBookmark());

    expect(opened).toBe(true);
    expect(harness.openNavigationTarget).toHaveBeenCalledWith(
      `${ROOT}/b.ts`,
      { column: 1, lineNumber: 1 },
      "bookmark",
    );

    harness.unmount();
  });

  it("returns false navigating next/previous with no bookmarks and never opens", async () => {
    const harness = renderBookmarks();

    const nextOpened = await act(async () => harness.hook().goToNextBookmark());
    const previousOpened = await act(async () =>
      harness.hook().goToPreviousBookmark(),
    );

    expect(nextOpened).toBe(false);
    expect(previousOpened).toBe(false);
    expect(harness.openNavigationTarget).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("opens, closes, and toggles the bookmarks panel, gated on an active workspace", () => {
    const harness = renderBookmarks();

    act(() => {
      harness.hook().openBookmarksPanel();
    });
    expect(harness.hook().bookmarksPanelOpen).toBe(true);

    act(() => {
      harness.hook().closeBookmarksPanel();
    });
    expect(harness.hook().bookmarksPanelOpen).toBe(false);

    act(() => {
      harness.hook().toggleBookmarksPanel();
    });
    expect(harness.hook().bookmarksPanelOpen).toBe(true);

    act(() => {
      harness.hook().toggleBookmarksPanel();
    });
    expect(harness.hook().bookmarksPanelOpen).toBe(false);

    harness.unmount();
  });

  it("never opens the bookmarks panel without an active workspace", () => {
    const harness = renderBookmarks();
    harness.currentWorkspaceRootRef.current = null;

    act(() => {
      harness.hook().openBookmarksPanel();
    });
    expect(harness.hook().bookmarksPanelOpen).toBe(false);

    act(() => {
      harness.hook().toggleBookmarksPanel();
    });
    expect(harness.hook().bookmarksPanelOpen).toBe(false);

    harness.unmount();
  });
});
