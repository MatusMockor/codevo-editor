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

  it.each([
    ["bookmark.next", "next"],
    ["bookmark.previous", "previous"],
  ] as const)(
    "propagates deferred %s navigation and normalizes success to void",
    async (commandId, direction) => {
      let resolveNavigation!: (value: boolean) => void;
      const navigation = new Promise<boolean>((resolve) => {
        resolveNavigation = resolve;
      });
      const goToNextBookmark = vi.fn(() => navigation);
      const goToPreviousBookmark = vi.fn(() => navigation);
      const commands = workbenchBookmarkCommands({
        shortcut: () => "",
        toggleBookmarkAtCursor: vi.fn(),
        goToNextBookmark,
        goToPreviousBookmark,
        toggleBookmarksPanel: vi.fn(),
      });
      const command = commands.find((candidate) => candidate.id === commandId);
      const runPromise = command?.run();
      let completed = false;
      void runPromise?.then(() => {
        completed = true;
      });

      await Promise.resolve();
      expect(completed).toBe(false);

      resolveNavigation(true);

      await expect(runPromise).resolves.toBeUndefined();
      expect(
        direction === "next" ? goToNextBookmark : goToPreviousBookmark,
      ).toHaveBeenCalledTimes(1);
      expect(
        direction === "next" ? goToPreviousBookmark : goToNextBookmark,
      ).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["bookmark.next", "next"],
    ["bookmark.previous", "previous"],
  ] as const)(
    "propagates %s navigation rejection",
    async (commandId, direction) => {
      const rejection = new Error(`${direction} failed`);
      const goToNextBookmark = vi.fn(() => Promise.reject(rejection));
      const goToPreviousBookmark = vi.fn(() => Promise.reject(rejection));
      const commands = workbenchBookmarkCommands({
        shortcut: () => "",
        toggleBookmarkAtCursor: vi.fn(),
        goToNextBookmark,
        goToPreviousBookmark,
        toggleBookmarksPanel: vi.fn(),
      });
      const command = commands.find((candidate) => candidate.id === commandId);

      await expect(command?.run()).rejects.toBe(rejection);
      expect(
        direction === "next" ? goToNextBookmark : goToPreviousBookmark,
      ).toHaveBeenCalledTimes(1);
      expect(
        direction === "next" ? goToPreviousBookmark : goToNextBookmark,
      ).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["bookmark.next", "next"],
    ["bookmark.previous", "previous"],
  ] as const)(
    "converts synchronous %s navigation throws to promise rejections",
    async (commandId, direction) => {
      const rejection = new Error(`${direction} threw`);
      const throwSynchronously = vi.fn(() => {
        throw rejection;
      });
      const resolveNavigation = vi.fn(async () => true);
      const goToNextBookmark =
        direction === "next" ? throwSynchronously : resolveNavigation;
      const goToPreviousBookmark =
        direction === "previous" ? throwSynchronously : resolveNavigation;
      const commands = workbenchBookmarkCommands({
        shortcut: () => "",
        toggleBookmarkAtCursor: vi.fn(),
        goToNextBookmark,
        goToPreviousBookmark,
        toggleBookmarksPanel: vi.fn(),
      });
      const command = commands.find((candidate) => candidate.id === commandId);
      const runPromise = command?.run();

      await expect(runPromise).rejects.toBe(rejection);
      expect(throwSynchronously).toHaveBeenCalledTimes(1);
      expect(resolveNavigation).not.toHaveBeenCalled();
    },
  );
});
