import { describe, expect, it, vi } from "vitest";
import { initialIndexProgress, type IndexProgressState } from "../domain/indexProgress";
import type { CommandContext } from "./commandRegistry";
import { workbenchIndexCommands } from "./workbenchIndexCommands";

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

describe("workbenchIndexCommands", () => {
  it("returns manual index commands in registry order with metadata", () => {
    const commands = workbenchIndexCommands({
      indexProgress: indexProgress(),
      intelligenceMode: "fullSmart",
      startHardReindex: vi.fn(),
      startIndexScan: vi.fn(),
      startPhpReindex: vi.fn(),
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
        id: "index.reindexSoft",
        title: "Soft Reindex Workspace",
        category: "Index",
        shortcut: undefined,
      },
      {
        id: "index.reindexPhp",
        title: "Reindex PHP Symbols",
        category: "Index",
        shortcut: undefined,
      },
      {
        id: "index.reindexHard",
        title: "Hard Rebuild Index",
        category: "Index",
        shortcut: undefined,
      },
    ]);
  });

  it("disables every command when there is no workspace", () => {
    const commands = workbenchIndexCommands({
      indexProgress: indexProgress(),
      intelligenceMode: "fullSmart",
      startHardReindex: vi.fn(),
      startIndexScan: vi.fn(),
      startPhpReindex: vi.fn(),
    });

    expect(commands.map((command) => command.isEnabled(disabledContext))).toEqual(
      [false, false, false],
    );
  });

  it("disables every command while indexing is scanning", () => {
    const commands = workbenchIndexCommands({
      indexProgress: indexProgress({ status: "scanning" }),
      intelligenceMode: "fullSmart",
      startHardReindex: vi.fn(),
      startIndexScan: vi.fn(),
      startPhpReindex: vi.fn(),
    });

    expect(commands.map((command) => command.isEnabled(enabledContext))).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("disables every command when the workspace should not be indexed", () => {
    const commands = workbenchIndexCommands({
      indexProgress: indexProgress(),
      intelligenceMode: "basic",
      startHardReindex: vi.fn(),
      startIndexScan: vi.fn(),
      startPhpReindex: vi.fn(),
    });

    expect(commands.map((command) => command.isEnabled(enabledContext))).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("enables every command for an indexable non-scanning workspace", () => {
    const commands = workbenchIndexCommands({
      indexProgress: indexProgress(),
      intelligenceMode: "fullSmart",
      startHardReindex: vi.fn(),
      startIndexScan: vi.fn(),
      startPhpReindex: vi.fn(),
    });

    expect(commands.map((command) => command.isEnabled(enabledContext))).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("invokes the injected callbacks", async () => {
    const startHardReindex = vi.fn();
    const startIndexScan = vi.fn();
    const startPhpReindex = vi.fn();
    const commands = workbenchIndexCommands({
      indexProgress: indexProgress(),
      intelligenceMode: "fullSmart",
      startHardReindex,
      startIndexScan,
      startPhpReindex,
    });

    for (const command of commands) {
      await command.run();
    }

    expect(startIndexScan).toHaveBeenCalledTimes(1);
    expect(startPhpReindex).toHaveBeenCalledTimes(1);
    expect(startHardReindex).toHaveBeenCalledTimes(1);
  });
});

function indexProgress(
  overrides: Partial<IndexProgressState> = {},
): IndexProgressState {
  return {
    ...initialIndexProgress(),
    ...overrides,
  };
}
