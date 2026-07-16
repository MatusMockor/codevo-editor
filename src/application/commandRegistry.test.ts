import { describe, expect, it, vi } from "vitest";
import {
  CommandRegistry,
  executeCommand,
  executeCommandAndReport,
  executeCommandAndWait,
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

  it("passes the same invocation context to enablement and execution", () => {
    const registry = new CommandRegistry();
    const seenContexts: CommandContext[] = [];
    registry.register({
      id: "editor.goToDefinition",
      title: "Go to Definition",
      category: "Editor",
      isEnabled: (currentContext) => {
        seenContexts.push(currentContext);
        return true;
      },
      run: (currentContext) => {
        if (currentContext) {
          seenContexts.push(currentContext);
        }
      },
    });

    expect(executeCommand(registry, "editor.goToDefinition", context)).toBe(
      "executed",
    );
    expect(seenContexts).toEqual([context, context]);
    expect(seenContexts[0]).toBe(seenContexts[1]);
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

  describe("executeCommandAndReport", () => {
    it("returns missing without running or reporting", () => {
      const registry = new CommandRegistry();
      const reportError = vi.fn();

      expect(
        executeCommandAndReport(
          registry,
          "workspace.missing",
          context,
          reportError,
        ),
      ).toBe("missing");
      expect(reportError).not.toHaveBeenCalled();
    });

    it("returns disabled without running or reporting", () => {
      const registry = new CommandRegistry();
      const run = vi.fn();
      const reportError = vi.fn();
      registry.register({
        id: "editor.save",
        title: "Save File",
        category: "Editor",
        isEnabled: () => false,
        run,
      });

      expect(
        executeCommandAndReport(registry, "editor.save", context, reportError),
      ).toBe("disabled");
      expect(run).not.toHaveBeenCalled();
      expect(reportError).not.toHaveBeenCalled();
    });

    it("reports an availability failure as executed without running", () => {
      const registry = new CommandRegistry();
      const failure = new Error("availability failure");
      const run = vi.fn();
      const reportError = vi.fn();
      registry.register({
        id: "editor.save",
        title: "Save File",
        category: "Editor",
        isEnabled: () => {
          throw failure;
        },
        run,
      });

      expect(
        executeCommandAndReport(registry, "editor.save", context, reportError),
      ).toBe("executed");
      expect(run).not.toHaveBeenCalled();
      expect(reportError).toHaveBeenCalledTimes(1);
      expect(reportError).toHaveBeenCalledWith(failure);
    });

    it("contains reporter failures for availability errors", () => {
      const registry = new CommandRegistry();
      const run = vi.fn();
      const reportError = vi.fn(() => {
        throw new Error("reporter failure");
      });
      registry.register({
        id: "editor.save",
        title: "Save File",
        category: "Editor",
        isEnabled: () => {
          throw new Error("availability failure");
        },
        run,
      });

      expect(
        executeCommandAndReport(registry, "editor.save", context, reportError),
      ).toBe("executed");
      expect(run).not.toHaveBeenCalled();
      expect(reportError).toHaveBeenCalledTimes(1);
    });

    it("runs a synchronous command and returns executed without reporting", () => {
      const registry = new CommandRegistry();
      const run = vi.fn();
      const reportError = vi.fn();
      registry.register({
        id: "workspace.open",
        title: "Open Workspace",
        category: "Workspace",
        isEnabled: () => true,
        run,
      });

      expect(
        executeCommandAndReport(
          registry,
          "workspace.open",
          context,
          reportError,
        ),
      ).toBe("executed");
      expect(run).toHaveBeenCalledTimes(1);
      expect(reportError).not.toHaveBeenCalled();
    });

    it("starts an asynchronous command and returns executed immediately", () => {
      const registry = new CommandRegistry();
      let resolveRun: (() => void) | undefined;
      const run = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveRun = resolve;
          }),
      );
      const reportError = vi.fn();
      registry.register({
        id: "workspace.refresh",
        title: "Refresh Workspace",
        category: "Workspace",
        isEnabled: () => true,
        run,
      });

      expect(
        executeCommandAndReport(
          registry,
          "workspace.refresh",
          context,
          reportError,
        ),
      ).toBe("executed");
      expect(run).toHaveBeenCalledTimes(1);
      expect(resolveRun).toBeTypeOf("function");
      expect(reportError).not.toHaveBeenCalled();

      resolveRun?.();
    });

    it("reports a synchronous command failure once and still returns executed", () => {
      const registry = new CommandRegistry();
      const failure = new Error("sync failure");
      const reportError = vi.fn();
      registry.register({
        id: "workspace.fail",
        title: "Fail",
        category: "Workspace",
        isEnabled: () => true,
        run: () => {
          throw failure;
        },
      });

      expect(
        executeCommandAndReport(
          registry,
          "workspace.fail",
          context,
          reportError,
        ),
      ).toBe("executed");
      expect(reportError).toHaveBeenCalledTimes(1);
      expect(reportError).toHaveBeenCalledWith(failure);
    });

    it("reports an asynchronous command rejection once", async () => {
      const registry = new CommandRegistry();
      const failure = new Error("async failure");
      const reportError = vi.fn();
      registry.register({
        id: "workspace.fail-async",
        title: "Fail Async",
        category: "Workspace",
        isEnabled: () => true,
        run: () => Promise.reject(failure),
      });

      expect(
        executeCommandAndReport(
          registry,
          "workspace.fail-async",
          context,
          reportError,
        ),
      ).toBe("executed");

      await vi.waitFor(() => {
        expect(reportError).toHaveBeenCalledTimes(1);
      });
      expect(reportError).toHaveBeenCalledWith(failure);
    });

    it("contains reporter failures for synchronous command errors", () => {
      const registry = new CommandRegistry();
      const reportError = vi.fn(() => {
        throw new Error("reporter failure");
      });
      registry.register({
        id: "workspace.fail",
        title: "Fail",
        category: "Workspace",
        isEnabled: () => true,
        run: () => {
          throw new Error("command failure");
        },
      });

      expect(() =>
        executeCommandAndReport(
          registry,
          "workspace.fail",
          context,
          reportError,
        ),
      ).not.toThrow();
      expect(reportError).toHaveBeenCalledTimes(1);
    });

    it("contains reporter failures for asynchronous command errors", async () => {
      const registry = new CommandRegistry();
      const reportError = vi.fn(() => {
        throw new Error("reporter failure");
      });
      registry.register({
        id: "workspace.fail-async",
        title: "Fail Async",
        category: "Workspace",
        isEnabled: () => true,
        run: () => Promise.reject(new Error("command failure")),
      });

      expect(
        executeCommandAndReport(
          registry,
          "workspace.fail-async",
          context,
          reportError,
        ),
      ).toBe("executed");

      await vi.waitFor(() => {
        expect(reportError).toHaveBeenCalledTimes(1);
      });
    });
  });

  it("waits for asynchronous commands before reporting execution", async () => {
    let resolveRun: (() => void) | undefined;
    const command = {
      id: "workspace.refresh",
      title: "Refresh Workspace",
      category: "Workspace",
      isEnabled: () => true,
      run: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveRun = resolve;
          }),
      ),
    };
    const execution = executeCommandAndWait(command, context);
    let settled = false;
    void execution.then(() => {
      settled = true;
    });

    await Promise.resolve();

    expect(command.run).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    resolveRun?.();

    await expect(execution).resolves.toBe("executed");
  });

  it("rechecks availability and does not run a disabled command", async () => {
    const run = vi.fn();
    const command = {
      id: "editor.save",
      title: "Save File",
      category: "Editor",
      isEnabled: (currentContext: CommandContext) =>
        currentContext.hasActiveDocument,
      run,
    };

    await expect(executeCommandAndWait(command, context)).resolves.toBe(
      "disabled",
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects when a command throws synchronously", async () => {
    const command = {
      id: "workspace.fail",
      title: "Fail",
      category: "Workspace",
      isEnabled: () => true,
      run: () => {
        throw new Error("sync failure");
      },
    };

    await expect(executeCommandAndWait(command, context)).rejects.toThrow(
      "sync failure",
    );
  });

  it("rejects when an asynchronous command rejects", async () => {
    const command = {
      id: "workspace.fail-async",
      title: "Fail Async",
      category: "Workspace",
      isEnabled: () => true,
      run: async () => {
        throw new Error("async failure");
      },
    };

    await expect(executeCommandAndWait(command, context)).rejects.toThrow(
      "async failure",
    );
  });
});
