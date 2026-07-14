import { describe, expect, it, vi } from "vitest";
import {
  CommandRegistry,
  executeCommand,
  type CommandContext,
} from "./commandRegistry";

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

  it("returns a stable list reference until commands change", () => {
    const registry = new CommandRegistry();

    registry.register({
      id: "a",
      title: "Alpha",
      category: "Test",
      isEnabled: () => true,
      run: () => undefined,
    });

    const first = registry.list();
    const second = registry.list();

    expect(second).toBe(first);

    registry.register({
      id: "b",
      title: "Beta",
      category: "Test",
      isEnabled: () => true,
      run: () => undefined,
    });

    const third = registry.list();

    expect(third).not.toBe(first);
    expect(registry.list()).toBe(third);
    expect(third.map((command) => command.title)).toEqual(["Alpha", "Beta"]);
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

  it("returns explicit outcomes for missing, disabled, and executed commands", () => {
    const registry = new CommandRegistry();
    const run = vi.fn();
    registry.register({
      id: "editor.save",
      title: "Save File",
      category: "Editor",
      isEnabled: (currentContext) => currentContext.hasActiveDocument,
      run,
    });

    expect(executeCommand(registry, "editor.missing", context)).toBe("missing");
    expect(executeCommand(registry, "editor.save", context)).toBe("disabled");
    expect(
      executeCommand(registry, "editor.save", {
        ...context,
        hasActiveDocument: true,
      }),
    ).toBe("executed");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("starts asynchronous commands without waiting for completion", () => {
    const registry = new CommandRegistry();
    let resolveRun: (() => void) | undefined;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRun = resolve;
        }),
    );
    registry.register({
      id: "workspace.refresh",
      title: "Refresh Workspace",
      category: "Workspace",
      isEnabled: () => true,
      run,
    });

    expect(executeCommand(registry, "workspace.refresh", context)).toBe(
      "executed",
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(resolveRun).toBeTypeOf("function");

    resolveRun?.();
  });

  it("does not swallow synchronous command errors", () => {
    const registry = new CommandRegistry();
    registry.register({
      id: "workspace.fail",
      title: "Fail",
      category: "Workspace",
      isEnabled: () => true,
      run: () => {
        throw new Error("command failed");
      },
    });

    expect(() => executeCommand(registry, "workspace.fail", context)).toThrow(
      "command failed",
    );
  });
});
