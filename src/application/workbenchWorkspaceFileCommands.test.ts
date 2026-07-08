import { describe, expect, it, vi } from "vitest";
import type { Command, CommandContext } from "./commandRegistry";
import { workbenchWorkspaceFileCommands } from "./workbenchWorkspaceFileCommands";

describe("workbenchWorkspaceFileCommands", () => {
  it("returns workspace and file commands in registry order with metadata", () => {
    const commands = createCommands({ isWorkspaceTrusted: false });

    expect(commands.map(({ id, title, category }) => ({ id, title, category })))
      .toEqual([
        {
          id: "workspace.open",
          title: "Open Workspace",
          category: "Workspace",
        },
        {
          id: "workspace.refresh",
          title: "Refresh Workspace",
          category: "Workspace",
        },
        {
          id: "workspace.trust",
          title: "Trust Workspace",
          category: "Workspace",
        },
        {
          id: "file.new",
          title: "New File",
          category: "File",
        },
        {
          id: "folder.new",
          title: "New Folder",
          category: "File",
        },
        {
          id: "file.rename",
          title: "Rename Active File",
          category: "File",
        },
        {
          id: "file.delete",
          title: "Delete Active File",
          category: "File",
        },
      ]);
  });

  it("uses the revoke trust title when the workspace is already trusted", () => {
    const trustCommand = createCommands({ isWorkspaceTrusted: true })[2];

    expect(trustCommand.title).toBe("Revoke Workspace Trust");
  });

  it("enables workspace-scoped commands only with a workspace", () => {
    const commands = createCommands({ isWorkspaceTrusted: false }).slice(1, 5);

    expect(
      commands.map((command) => command.isEnabled(context({ hasWorkspace: false }))),
    ).toEqual([false, false, false, false]);
    expect(
      commands.map((command) => command.isEnabled(context({ hasWorkspace: true }))),
    ).toEqual([true, true, true, true]);
  });

  it("always enables the open workspace command", () => {
    const openWorkspace = createCommands({ isWorkspaceTrusted: false })[0];

    expect(openWorkspace.isEnabled(context({ hasWorkspace: false }))).toBe(true);
    expect(openWorkspace.isEnabled(context({ hasWorkspace: true }))).toBe(true);
  });

  it("enables file document commands only with an active document", () => {
    const documentCommands = createCommands({ isWorkspaceTrusted: false }).slice(5);

    expect(
      documentCommands.map((command) =>
        command.isEnabled(context({ hasActiveDocument: false })),
      ),
    ).toEqual([false, false]);
    expect(
      documentCommands.map((command) =>
        command.isEnabled(context({ hasActiveDocument: true })),
      ),
    ).toEqual([true, true]);
  });

  it("invokes the exact injected callbacks and returns their values directly", () => {
    const results = Array.from({ length: 7 }, () => Promise.resolve());
    const callbacks = results.map((result) => vi.fn(() => result));
    const commands = workbenchWorkspaceFileCommands({
      isWorkspaceTrusted: false,
      openWorkspace: callbacks[0],
      refreshWorkspace: callbacks[1],
      toggleWorkspaceTrust: callbacks[2],
      createFile: callbacks[3],
      createDirectory: callbacks[4],
      renameActiveDocument: callbacks[5],
      deleteActiveDocument: callbacks[6],
    });

    commands.forEach((command, index) => {
      expect(command.run()).toBe(results[index]);
      expect(callbacks[index]).toHaveBeenCalledTimes(1);
    });
  });
});

function createCommands({
  isWorkspaceTrusted,
}: {
  isWorkspaceTrusted: boolean | undefined;
}): Command[] {
  return workbenchWorkspaceFileCommands({
    isWorkspaceTrusted,
    openWorkspace: vi.fn(),
    refreshWorkspace: vi.fn(),
    toggleWorkspaceTrust: vi.fn(),
    createFile: vi.fn(),
    createDirectory: vi.fn(),
    renameActiveDocument: vi.fn(),
    deleteActiveDocument: vi.fn(),
  });
}

function context({
  hasWorkspace = false,
  hasActiveDocument = false,
}: Partial<CommandContext>): CommandContext {
  return {
    activeDocumentDirty: false,
    hasActiveDocument,
    hasWorkspace,
  };
}
