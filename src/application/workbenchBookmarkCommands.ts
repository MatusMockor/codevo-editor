import type { KeymapCommandId } from "../domain/keymap";
import type { Command } from "./commandRegistry";

interface WorkbenchBookmarkCommandsOptions {
  shortcut(commandId: KeymapCommandId): string;
  toggleBookmarkAtCursor: Command["run"];
  goToNextBookmark: () => Promise<boolean>;
  goToPreviousBookmark: () => Promise<boolean>;
  toggleBookmarksPanel: Command["run"];
}

export function workbenchBookmarkCommands({
  shortcut,
  toggleBookmarkAtCursor,
  goToNextBookmark,
  goToPreviousBookmark,
  toggleBookmarksPanel,
}: WorkbenchBookmarkCommandsOptions): Command[] {
  return [
    {
      id: "bookmark.toggle",
      title: "Toggle Bookmark",
      category: "Bookmarks",
      shortcut: shortcut("bookmark.toggle"),
      isEnabled: (context) => context.hasActiveDocument,
      run: toggleBookmarkAtCursor,
    },
    {
      id: "bookmark.next",
      title: "Next Bookmark",
      category: "Bookmarks",
      shortcut: shortcut("bookmark.next"),
      isEnabled: (context) => context.hasWorkspace,
      run: async () => {
        await goToNextBookmark();
      },
    },
    {
      id: "bookmark.previous",
      title: "Previous Bookmark",
      category: "Bookmarks",
      shortcut: shortcut("bookmark.previous"),
      isEnabled: (context) => context.hasWorkspace,
      run: async () => {
        await goToPreviousBookmark();
      },
    },
    {
      id: "bookmark.showPanel",
      title: "Show Bookmarks",
      category: "Bookmarks",
      shortcut: shortcut("bookmark.showPanel"),
      isEnabled: (context) => context.hasWorkspace,
      run: toggleBookmarksPanel,
    },
  ];
}
