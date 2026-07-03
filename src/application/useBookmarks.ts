import {
  useCallback,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  nextBookmark,
  previousBookmark,
  toggleBookmark,
  type Bookmark,
} from "../domain/bookmarks";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { EditorDocument } from "../domain/workspace";

// Extracts the trimmed text of a 1-based line from document content, used as a
// bookmark's preview. Out-of-range lines (e.g. a bookmark on a line that no
// longer exists after edits) yield an empty preview rather than throwing.
function linePreviewFromContent(content: string, lineNumber: number): string {
  const lines = content.split("\n");
  const line = lines[lineNumber - 1];

  return line ? line.trim() : "";
}

/**
 * Collaborators the Bookmarks (PhpStorm parity) feature needs from the
 * workbench shell. The bookmark LIST itself (`bookmarks`/`setBookmarks`) stays
 * shell-owned — the same seam shape as `gitStatus`/`applyGitOperationStatus`
 * for `useGitWorkspace` — because it is part of the per-tab cached workbench
 * state (captured/restored by the shell's cache lifecycle alongside
 * documents/openPaths/recentFiles) and is mutated directly by the file
 * rename/delete flows that live outside this hook's boundary. Everything
 * else — the bookmarks-panel-open toggle and every navigation handler — is
 * owned by this hook.
 */
export interface BookmarksDependencies {
  bookmarks: Bookmark[];
  setBookmarks: Dispatch<SetStateAction<Bookmark[]>>;
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  activeEditorPositionRef: MutableRefObject<EditorPosition | null>;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  openNavigationTarget: (
    path: string,
    position: EditorPosition,
    label: string,
  ) => Promise<boolean>;
}

export interface Bookmarks {
  bookmarksPanelOpen: boolean;
  toggleBookmarkAtLine: (lineNumber: number) => void;
  toggleBookmarkAtCursor: () => void;
  openBookmark: (bookmark: Bookmark) => Promise<boolean>;
  goToNextBookmark: () => Promise<boolean>;
  goToPreviousBookmark: () => Promise<boolean>;
  openBookmarksPanel: () => void;
  closeBookmarksPanel: () => void;
  toggleBookmarksPanel: () => void;
}

/**
 * Bookmarks (PhpStorm parity): the user marks a line in a file, jumps between
 * marks, and browses them in a panel. Owns the bookmarks-panel-open toggle and
 * every navigation handler; the bookmark list itself is injected (see
 * {@link BookmarksDependencies}).
 */
export function useBookmarks(dependencies: BookmarksDependencies): Bookmarks {
  const {
    bookmarks,
    setBookmarks,
    activeDocumentRef,
    activeEditorPositionRef,
    currentWorkspaceRootRef,
    openNavigationTarget,
  } = dependencies;

  const [bookmarksPanelOpen, setBookmarksPanelOpen] = useState(false);

  // Toggles a bookmark on a specific line of the active document. The line
  // preview text is captured from the document content at toggle time so the
  // panel can render it without re-reading the file. Conservative line tracking:
  // the bookmark holds the line number captured here (it can drift if the file
  // is edited above it, which is acceptable for runtime-only marks).
  const toggleBookmarkAtLine = useCallback((lineNumber: number) => {
    const document = activeDocumentRef.current;

    if (!document) {
      return;
    }

    const preview = linePreviewFromContent(document.content, lineNumber);

    setBookmarks((current) =>
      toggleBookmark(current, { lineNumber, path: document.path, preview }),
    );
  }, []);

  // Toggles a bookmark on the active document's current cursor line (keymap /
  // command entry point — the gutter click uses toggleBookmarkAtLine directly).
  const toggleBookmarkAtCursor = useCallback(() => {
    const lineNumber = activeEditorPositionRef.current?.lineNumber ?? 1;
    toggleBookmarkAtLine(lineNumber);
  }, [toggleBookmarkAtLine]);

  // The cursor anchor for next/previous bookmark navigation. Uses the active
  // document plus the live editor position so navigation steps relative to where
  // the user is, not an arbitrary start.
  const currentBookmarkLocation = useCallback(() => {
    const path = activeDocumentRef.current?.path;

    if (!path) {
      return null;
    }

    return {
      lineNumber: activeEditorPositionRef.current?.lineNumber ?? 1,
      path,
    };
  }, []);

  const openBookmark = useCallback(
    (bookmark: Bookmark): Promise<boolean> => {
      return openNavigationTarget(
        bookmark.path,
        { column: 1, lineNumber: bookmark.lineNumber },
        "bookmark",
      );
    },
    [openNavigationTarget],
  );

  const goToNextBookmark = useCallback(async (): Promise<boolean> => {
    const target = nextBookmark(bookmarks, currentBookmarkLocation());

    if (!target) {
      return false;
    }

    return openBookmark(target);
  }, [bookmarks, currentBookmarkLocation, openBookmark]);

  const goToPreviousBookmark = useCallback(async (): Promise<boolean> => {
    const target = previousBookmark(bookmarks, currentBookmarkLocation());

    if (!target) {
      return false;
    }

    return openBookmark(target);
  }, [bookmarks, currentBookmarkLocation, openBookmark]);

  const openBookmarksPanel = useCallback(() => {
    if (!currentWorkspaceRootRef.current) {
      return;
    }

    setBookmarksPanelOpen(true);
  }, []);

  const closeBookmarksPanel = useCallback(() => {
    setBookmarksPanelOpen(false);
  }, []);

  const toggleBookmarksPanel = useCallback(() => {
    if (!currentWorkspaceRootRef.current) {
      return;
    }

    setBookmarksPanelOpen((open) => !open);
  }, []);

  return {
    bookmarksPanelOpen,
    toggleBookmarkAtLine,
    toggleBookmarkAtCursor,
    openBookmark,
    goToNextBookmark,
    goToPreviousBookmark,
    openBookmarksPanel,
    closeBookmarksPanel,
    toggleBookmarksPanel,
  };
}
