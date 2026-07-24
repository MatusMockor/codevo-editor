import { describe, expect, it, vi } from "vitest";
import type { Command, CommandContext } from "./commandRegistry";
import { workbenchJsTestCommands } from "./workbenchJsTestCommands";

describe("workbenchJsTestCommands", () => {
  it("returns JavaScript test commands with metadata", () => {
    const commands = workbenchJsTestCommands({
      hasJsWorkspace: true,
      isActiveDocumentJsTest: true,
      runTestForActiveDocument: vi.fn(),
      runAllTestsForActiveDocument: vi.fn(),
      openTestResultsPanel: vi.fn(),
    });

    expect(
      commands.map(({ id, title, category, visibleInCommandPalette }) => ({
        id,
        title,
        category,
        visibleInCommandPalette,
      })),
    ).toEqual([
      {
        id: "testing.runAtCursor",
        title: "Run Test at Cursor",
        category: "Test",
        visibleInCommandPalette: true,
      },
      {
        id: "testing.debugAtCursor",
        title: "Debug Test at Cursor",
        category: "Test",
        visibleInCommandPalette: undefined,
      },
      {
        id: "testing.runCurrentFile",
        title: "Run Tests in Current File",
        category: "Test",
        visibleInCommandPalette: true,
      },
      {
        id: "testing.reRunFailTests",
        title: "Rerun Failed Tests",
        category: "Test",
        visibleInCommandPalette: true,
      },
      {
        id: "testing.reRunLastRun",
        title: "Rerun Last Run",
        category: "Test",
        visibleInCommandPalette: true,
      },
      {
        id: "testing.cancelRun",
        title: "Cancel Test Run",
        category: "Test",
        visibleInCommandPalette: false,
      },
      {
        id: "js.runTest",
        title: "Run Test Under Cursor",
        category: "JavaScript",
        visibleInCommandPalette: undefined,
      },
      {
        id: "js.runTestFile",
        title: "Run All Tests in File",
        category: "JavaScript",
        visibleInCommandPalette: undefined,
      },
      {
        id: "js.runTestsWithResultsPanel",
        title: "JavaScript: Run Tests with Results Panel",
        category: "JavaScript",
        visibleInCommandPalette: undefined,
      },
    ]);
  });

  it("publishes official run shortcuts through injected keymap metadata", () => {
    const shortcut = vi.fn((id: string) => `shortcut:${id}`);
    const commands = createCommands({ shortcut });

    expect(command(commands, "testing.runAtCursor").shortcut).toBe("shortcut:testing.runAtCursor");
    expect(command(commands, "testing.runCurrentFile").shortcut).toBe(
      "shortcut:testing.runCurrentFile",
    );
    expect(command(commands, "testing.reRunFailTests").shortcut).toBe(
      "shortcut:testing.reRunFailTests",
    );
    expect(command(commands, "testing.reRunLastRun").shortcut).toBe(
      "shortcut:testing.reRunLastRun",
    );
    expect(command(commands, "testing.cancelRun").shortcut).toBe("shortcut:testing.cancelRun");
    expect(shortcut).toHaveBeenCalledWith("testing.runAtCursor");
    expect(shortcut).toHaveBeenCalledWith("testing.runCurrentFile");
    expect(shortcut).toHaveBeenCalledWith("testing.reRunFailTests");
    expect(shortcut).toHaveBeenCalledWith("testing.reRunLastRun");
    expect(shortcut).toHaveBeenCalledWith("testing.cancelRun");
  });

  it("enables Rerun Failed Tests from its live workspace capability without an active document", () => {
    let available = true;
    const commands = createCommands({ canRerunFailedTests: () => available });
    const rerun = command(commands, "testing.reRunFailTests");

    expect(rerun.isEnabled(context({ hasActiveDocument: false, hasWorkspace: true }))).toBe(true);
    expect(rerun.isEnabled(context({ hasActiveDocument: true, hasWorkspace: false }))).toBe(false);
    expect(
      command(
        createCommands({ canRerunFailedTests: () => true, hasJsWorkspace: false }),
        "testing.reRunFailTests",
      ).isEnabled(context({ hasWorkspace: true })),
    ).toBe(false);

    available = false;
    expect(rerun.isEnabled(context({ hasActiveDocument: false, hasWorkspace: true }))).toBe(false);
  });

  it("enables the hidden global Cancel Test Run action only from its live capability", () => {
    let available = true;
    const cancel = command(
      createCommands({ canCancelTestRun: () => available, hasJsWorkspace: false }),
      "testing.cancelRun",
    );

    expect(cancel.isEnabled(context({ hasActiveDocument: false, hasWorkspace: false }))).toBe(true);
    available = false;
    expect(cancel.isEnabled(context({ hasActiveDocument: true, hasWorkspace: true }))).toBe(false);
  });

  it("keeps omitted failed-rerun and cancellation options fail-closed", async () => {
    const commands = workbenchJsTestCommands({
      hasJsWorkspace: true,
      isActiveDocumentJsTest: true,
      runTestForActiveDocument: vi.fn(),
      runAllTestsForActiveDocument: vi.fn(),
      openTestResultsPanel: vi.fn(),
    });

    expect(
      command(commands, "testing.reRunFailTests").isEnabled(context({ hasWorkspace: true })),
    ).toBe(false);
    expect(command(commands, "testing.cancelRun").isEnabled(context({ hasWorkspace: true }))).toBe(
      false,
    );
    await expect(command(commands, "testing.reRunFailTests").run()).resolves.toBeUndefined();
    await expect(command(commands, "testing.cancelRun").run()).resolves.toBeUndefined();
  });

  it("enables Rerun Last Run from its live workspace capability without an active document", () => {
    let available = true;
    const commands = createCommands({ canRerunLastRun: () => available });
    const rerun = command(commands, "testing.reRunLastRun");

    expect(rerun.isEnabled(context({ hasActiveDocument: false, hasWorkspace: true }))).toBe(true);
    expect(rerun.isEnabled(context({ hasActiveDocument: true, hasWorkspace: false }))).toBe(false);
    expect(
      command(
        createCommands({ canRerunLastRun: () => true, hasJsWorkspace: false }),
        "testing.reRunLastRun",
      ).isEnabled(context({ hasWorkspace: true })),
    ).toBe(false);

    available = false;
    expect(rerun.isEnabled(context({ hasActiveDocument: false, hasWorkspace: true }))).toBe(false);
  });

  it("enables debug at cursor only for a clean active JS test and live coordinator", () => {
    const enabled = createCommands({ canDebugAtCursor: () => true });
    const disabledCoordinator = createCommands({ canDebugAtCursor: () => false });
    const dirty = context({
      activeDocumentDirty: true,
      hasActiveDocument: true,
      hasWorkspace: true,
    });
    const ready = context({
      activeDocumentDirty: false,
      hasActiveDocument: true,
      hasWorkspace: true,
    });

    expect(command(enabled, "testing.debugAtCursor").isEnabled(ready)).toBe(true);
    expect(command(enabled, "testing.debugAtCursor").isEnabled(dirty)).toBe(false);
    expect(command(disabledCoordinator, "testing.debugAtCursor").isEnabled(ready)).toBe(false);
    expect(
      command(createCommands({ hasJsWorkspace: false }), "testing.debugAtCursor").isEnabled(ready),
    ).toBe(false);
    expect(
      command(createCommands({ isActiveDocumentJsTest: false }), "testing.debugAtCursor").isEnabled(
        ready,
      ),
    ).toBe(false);
    expect(
      command(enabled, "testing.debugAtCursor").isEnabled(
        context({ hasActiveDocument: false, hasWorkspace: true }),
      ),
    ).toBe(false);
    expect(
      command(enabled, "testing.debugAtCursor").isEnabled(
        context({ hasActiveDocument: true, hasWorkspace: false }),
      ),
    ).toBe(false);
  });

  it("reads debug-at-cursor capability live without rebuilding the command list", () => {
    let available = true;
    const commands = createCommands({ canDebugAtCursor: () => available });
    const ready = context({ hasActiveDocument: true, hasWorkspace: true });

    expect(command(commands, "testing.debugAtCursor").isEnabled(ready)).toBe(true);
    available = false;
    expect(command(commands, "testing.debugAtCursor").isEnabled(ready)).toBe(false);
  });

  it.each(["testing.runAtCursor", "testing.runCurrentFile"])(
    "enables %s only for a clean active JS test and live coordinator",
    (id) => {
      const ready = context({ hasActiveDocument: true, hasWorkspace: true });
      const dirty = context({
        activeDocumentDirty: true,
        hasActiveDocument: true,
        hasWorkspace: true,
      });
      const capability = id === "testing.runAtCursor" ? "canRunAtCursor" : "canRunCurrentFile";

      expect(command(createCommands(), id).isEnabled(ready)).toBe(true);
      expect(command(createCommands({ [capability]: () => false }), id).isEnabled(ready)).toBe(
        false,
      );
      expect(command(createCommands(), id).isEnabled(dirty)).toBe(false);
      expect(command(createCommands({ hasJsWorkspace: false }), id).isEnabled(ready)).toBe(false);
      expect(command(createCommands({ isActiveDocumentJsTest: false }), id).isEnabled(ready)).toBe(
        false,
      );
      expect(
        command(createCommands(), id).isEnabled(
          context({ hasActiveDocument: false, hasWorkspace: true }),
        ),
      ).toBe(false);
      expect(
        command(createCommands(), id).isEnabled(
          context({ hasActiveDocument: true, hasWorkspace: false }),
        ),
      ).toBe(false);
    },
  );

  it("reads official run capabilities live without rebuilding the command list", () => {
    let available = true;
    const commands = createCommands({
      canRunAtCursor: () => available,
      canRunCurrentFile: () => available,
    });
    const ready = context({ hasActiveDocument: true, hasWorkspace: true });

    expect(command(commands, "testing.runAtCursor").isEnabled(ready)).toBe(true);
    expect(command(commands, "testing.runCurrentFile").isEnabled(ready)).toBe(true);
    available = false;
    expect(command(commands, "testing.runAtCursor").isEnabled(ready)).toBe(false);
    expect(command(commands, "testing.runCurrentFile").isEnabled(ready)).toBe(false);
  });

  it("enables the run commands only with a workspace, active document, and JS test document", () => {
    const contexts: CommandContext[] = [
      context({ hasWorkspace: false, hasActiveDocument: true }),
      context({ hasWorkspace: true, hasActiveDocument: false }),
      context({ hasWorkspace: true, hasActiveDocument: true }),
    ];

    const enabledForJsTest = createCommands({ isActiveDocumentJsTest: true });
    const disabledForOther = createCommands({ isActiveDocumentJsTest: false });

    for (const id of ["js.runTest", "js.runTestFile"]) {
      expect(contexts.map((value) => command(enabledForJsTest, id).isEnabled(value))).toEqual([
        false,
        false,
        true,
      ]);
      expect(command(disabledForOther, id).isEnabled(contexts[2])).toBe(false);
    }
  });

  it("enables the results panel command only for a JS workspace", () => {
    const withWorkspace = createCommands({ hasJsWorkspace: true });
    const withoutWorkspace = createCommands({ hasJsWorkspace: false });
    const active = context({ hasWorkspace: true, hasActiveDocument: false });

    expect(command(withWorkspace, "js.runTestsWithResultsPanel").isEnabled(active)).toBe(true);
    expect(command(withoutWorkspace, "js.runTestsWithResultsPanel").isEnabled(active)).toBe(false);
  });

  it("wires the run callbacks", () => {
    const debugAtCursor = vi.fn();
    const cancelTestRun = vi.fn(async () => true);
    const rerunFailedTests = vi.fn(async () => true);
    const runAtCursor = vi.fn();
    const runCurrentFile = vi.fn();
    const rerunLastRun = vi.fn();
    const runTestForActiveDocument = vi.fn();
    const runAllTestsForActiveDocument = vi.fn();
    const openTestResultsPanel = vi.fn();
    const commands = workbenchJsTestCommands({
      canDebugAtCursor: () => true,
      canCancelTestRun: () => true,
      canRerunFailedTests: () => true,
      canRunAtCursor: () => true,
      canRunCurrentFile: () => true,
      canRerunLastRun: () => true,
      cancelTestRun,
      debugAtCursor,
      hasJsWorkspace: true,
      isActiveDocumentJsTest: true,
      runTestForActiveDocument,
      runAllTestsForActiveDocument,
      openTestResultsPanel,
      runAtCursor,
      runCurrentFile,
      rerunFailedTests,
      rerunLastRun,
    });

    command(commands, "testing.runAtCursor").run();
    command(commands, "testing.debugAtCursor").run();
    command(commands, "testing.runCurrentFile").run();
    command(commands, "testing.reRunFailTests").run();
    command(commands, "testing.reRunLastRun").run();
    command(commands, "testing.cancelRun").run();
    command(commands, "js.runTest").run();
    command(commands, "js.runTestFile").run();
    command(commands, "js.runTestsWithResultsPanel").run();

    expect(debugAtCursor).toHaveBeenCalledTimes(1);
    expect(runAtCursor).toHaveBeenCalledTimes(1);
    expect(runCurrentFile).toHaveBeenCalledTimes(1);
    expect(rerunFailedTests).toHaveBeenCalledTimes(1);
    expect(rerunLastRun).toHaveBeenCalledTimes(1);
    expect(cancelTestRun).toHaveBeenCalledTimes(1);
    expect(runTestForActiveDocument).toHaveBeenCalledTimes(1);
    expect(runAllTestsForActiveDocument).toHaveBeenCalledTimes(1);
    expect(openTestResultsPanel).toHaveBeenCalledTimes(1);
  });
});

function createCommands(
  overrides: Partial<Parameters<typeof workbenchJsTestCommands>[0]> = {},
): Command[] {
  return workbenchJsTestCommands({
    canCancelTestRun: () => true,
    canDebugAtCursor: () => true,
    canRerunFailedTests: () => true,
    canRunAtCursor: () => true,
    canRunCurrentFile: () => true,
    debugAtCursor: vi.fn(),
    hasJsWorkspace: true,
    isActiveDocumentJsTest: true,
    runTestForActiveDocument: vi.fn(),
    runAllTestsForActiveDocument: vi.fn(),
    openTestResultsPanel: vi.fn(),
    ...overrides,
  });
}

function command(commands: Command[], id: string): Command {
  const found = commands.find((entry) => entry.id === id);

  expect(found).toBeDefined();

  return found as Command;
}

function context(overrides: Partial<CommandContext>): CommandContext {
  return {
    activeDocumentDirty: false,
    hasActiveDocument: false,
    hasWorkspace: false,
    ...overrides,
  };
}
