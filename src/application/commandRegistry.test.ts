import { describe, expect, it } from "vitest";
import { CommandRegistry, type CommandContext } from "./commandRegistry";

const context: CommandContext = {
  activeDocumentDirty: false,
  hasActiveDocument: false,
  hasWorkspace: false,
};

describe("CommandRegistry", () => {
  it("lists commands sorted by title", () => {
    const registry = new CommandRegistry();

    registry.register({
      id: "b",
      title: "Beta",
      category: "Test",
      isEnabled: () => true,
      run: () => undefined,
    });
    registry.register({
      id: "a",
      title: "Alpha",
      category: "Test",
      isEnabled: () => true,
      run: () => undefined,
    });

    expect(registry.list().map((command) => command.title)).toEqual([
      "Alpha",
      "Beta",
    ]);
  });

  it("rejects duplicate command ids", () => {
    const registry = new CommandRegistry();
    const command = {
      id: "workspace.open",
      title: "Open Workspace",
      category: "Workspace",
      isEnabled: () => true,
      run: () => undefined,
    };

    registry.register(command);

    expect(() => registry.register(command)).toThrow(
      "Command already registered: workspace.open",
    );
  });

  it("keeps command availability inside command implementations", () => {
    const registry = new CommandRegistry();

    registry.register({
      id: "editor.save",
      title: "Save File",
      category: "Editor",
      isEnabled: (currentContext) =>
        currentContext.hasActiveDocument && currentContext.activeDocumentDirty,
      run: () => undefined,
    });

    expect(registry.get("editor.save")?.isEnabled(context)).toBe(false);
    expect(
      registry.get("editor.save")?.isEnabled({
        ...context,
        activeDocumentDirty: true,
        hasActiveDocument: true,
      }),
    ).toBe(true);
  });
});
