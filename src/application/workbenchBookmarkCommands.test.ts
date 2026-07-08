import { describe, expect, it, vi } from "vitest";
import type { CommandContext } from "./commandRegistry";
import { workbenchBookmarkCommands } from "./workbenchBookmarkCommands";

const disabledContext: CommandContext = {
  activeDocumentDirty: false,
  hasActiveDocument: false,
  hasWorkspace: false,
};

const enabledContext: CommandContext = {
  activeDocumentDirty: true,
  hasActiveDocument: true,
  hasWorkspace: true,
};

describe("workbenchBookmarkCommands", () => {
  it("returns bookmark commands in registry order with metadata", () => {
    const commands = workbenchBookmarkCommands({
      shortcut: (commandId) => `shortcut:${commandId}`,
      toggleBookmarkAtCursor: vi.fn(),
      goToNextBookmark: vi.fn(),
      goToPreviousBookmark: vi.fn(),
      toggleBookmarksPanel: vi.fn(),
    });

    expect(
      commands.map(({ id, title, category, shortcut }) => ({
        id,
        title,
        category,
        shortcut,
      })),
    ).toEqual([
      {
        id: "bookmark.toggle",
        title: "Toggle Bookmark",
        category: "Bookmarks",
        shortcut: "shortcut:bookmark.toggle",
      },
      {
        id: "bookmark.next",
        title: "Next Bookmark",
        category: "Bookmarks",
        shortcut: "shortcut:bookmark.next",
      },
      {
        id: "bookmark.previous",
        title: "Previous Bookmark",
        category: "Bookmarks",
        shortcut: "shortcut:bookmark.previous",
      },
      {
        id: "bookmark.showPanel",
        title: "Show Bookmarks",
        category: "Bookmarks",
        shortcut: "shortcut:bookmark.showPanel",
      },
    ]);
  });

  it("passes bookmark command ids to the shortcut resolver", () => {
    const shortcut = vi.fn((commandId: string) => `shortcut:${commandId}`);

    workbenchBookmarkCommands({
      shortcut,
      toggleBookmarkAtCursor: vi.fn(),
      goToNextBookmark: vi.fn(),
      goToPreviousBookmark: vi.fn(),
      toggleBookmarksPanel: vi.fn(),
    });

    expect(shortcut).toHaveBeenCalledTimes(4);
    expect(shortcut.mock.calls.map(([commandId]) => commandId)).toEqual([
      "bookmark.toggle",
      "bookmark.next",
      "bookmark.previous",
      "bookmark.showPanel",
    ]);
  });

  it("enables only commands with satisfied context requirements", () => {
    const commands = workbenchBookmarkCommands({
      shortcut: () => "",
      toggleBookmarkAtCursor: vi.fn(),
      goToNextBookmark: vi.fn(),
      goToPreviousBookmark: vi.fn(),
      toggleBookmarksPanel: vi.fn(),
    });

    expect(commands.map((command) => command.isEnabled(disabledContext))).toEqual(
      [false, false, false, false],
    );
    expect(commands.map((command) => command.isEnabled(enabledContext))).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(
      commands.map((command) =>
        command.isEnabled({
          activeDocumentDirty: false,
          hasActiveDocument: true,
          hasWorkspace: false,
        }),
      ),
    ).toEqual([true, false, false, false]);
  });

  it("invokes the injected callbacks", async () => {
    const toggleBookmarkAtCursor = vi.fn();
    const goToNextBookmark = vi.fn(async () => true);
    const goToPreviousBookmark = vi.fn(async () => true);
    const toggleBookmarksPanel = vi.fn();
    const commands = workbenchBookmarkCommands({
      shortcut: () => "",
      toggleBookmarkAtCursor,
      goToNextBookmark,
      goToPreviousBookmark,
      toggleBookmarksPanel,
    });

    for (const command of commands) {
      await command.run();
    }

    expect(toggleBookmarkAtCursor).toHaveBeenCalledTimes(1);
    expect(goToNextBookmark).toHaveBeenCalledTimes(1);
    expect(goToPreviousBookmark).toHaveBeenCalledTimes(1);
    expect(toggleBookmarksPanel).toHaveBeenCalledTimes(1);
  });

  it("does not await next or previous bookmark navigation from the command body", () => {
    const goToNextBookmark = vi.fn(
      () => new Promise<boolean>(() => undefined),
    );
    const goToPreviousBookmark = vi.fn(
      () => new Promise<boolean>(() => undefined),
    );
    const commands = workbenchBookmarkCommands({
      shortcut: () => "",
      toggleBookmarkAtCursor: vi.fn(),
      goToNextBookmark,
      goToPreviousBookmark,
      toggleBookmarksPanel: vi.fn(),
    });
    const nextCommand = commands.find((command) => command.id === "bookmark.next");
    const previousCommand = commands.find(
      (command) => command.id === "bookmark.previous",
    );

    expect(nextCommand?.run()).toBeUndefined();
    expect(previousCommand?.run()).toBeUndefined();
    expect(goToNextBookmark).toHaveBeenCalledTimes(1);
    expect(goToPreviousBookmark).toHaveBeenCalledTimes(1);
  });
});
