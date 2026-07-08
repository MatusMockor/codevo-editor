import { describe, expect, it, vi } from "vitest";
import type { KeymapCommandId } from "../domain/keymap";
import type { Command, CommandContext } from "./commandRegistry";
import { workbenchPhpTestCommands } from "./workbenchPhpTestCommands";

describe("workbenchPhpTestCommands", () => {
  it("returns PHP test commands in registry order with metadata and shortcuts", () => {
    const shortcut = vi.fn(
      (commandId: KeymapCommandId) => `shortcut:${commandId}`,
    );
    const commands = workbenchPhpTestCommands({
      shortcut,
      isActiveDocumentPhp: true,
      isActiveDocumentPhpTest: true,
      generateTestForActiveDocument: vi.fn(),
      goToTestForActiveDocument: vi.fn(),
      runTestForActiveDocument: vi.fn(),
      runAllTestsForActiveDocument: vi.fn(),
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
        id: "php.generateTest",
        title: "Generate Test",
        category: "PHP",
        shortcut: undefined,
      },
      {
        id: "php.goToTest",
        title: "Go to Test / Test Subject",
        category: "PHP",
        shortcut: "shortcut:php.goToTest",
      },
      {
        id: "php.runTest",
        title: "Run Test Under Cursor",
        category: "PHP",
        shortcut: "shortcut:php.runTest",
      },
      {
        id: "php.runTestFile",
        title: "Run All Tests in File",
        category: "PHP",
        shortcut: "shortcut:php.runTestFile",
      },
    ]);
    expect(shortcut).toHaveBeenNthCalledWith(1, "php.goToTest");
    expect(shortcut).toHaveBeenNthCalledWith(2, "php.runTest");
    expect(shortcut).toHaveBeenNthCalledWith(3, "php.runTestFile");
    expect(shortcut).toHaveBeenCalledTimes(3);
  });

  it("enables the first three commands only with a workspace, active document, and PHP document", () => {
    const contexts: CommandContext[] = [
      context({ hasWorkspace: false, hasActiveDocument: false }),
      context({ hasWorkspace: false, hasActiveDocument: true }),
      context({ hasWorkspace: true, hasActiveDocument: false }),
      context({ hasWorkspace: true, hasActiveDocument: true }),
    ];

    const phpCommands = createCommands({
      isActiveDocumentPhp: true,
      isActiveDocumentPhpTest: false,
    }).slice(0, 3);
    const nonPhpCommands = createCommands({
      isActiveDocumentPhp: false,
      isActiveDocumentPhpTest: false,
    }).slice(0, 3);

    expect(
      contexts.map((commandContext) =>
        phpCommands.map((command) => command.isEnabled(commandContext)),
      ),
    ).toEqual([
      [false, false, false],
      [false, false, false],
      [false, false, false],
      [true, true, true],
    ]);
    expect(
      contexts.map((commandContext) =>
        nonPhpCommands.map((command) => command.isEnabled(commandContext)),
      ),
    ).toEqual([
      [false, false, false],
      [false, false, false],
      [false, false, false],
      [false, false, false],
    ]);
  });

  it("enables the run test file command only with a workspace and active PHP test document", () => {
    const contexts: CommandContext[] = [
      context({ hasWorkspace: false, hasActiveDocument: false }),
      context({ hasWorkspace: false, hasActiveDocument: true }),
      context({ hasWorkspace: true, hasActiveDocument: false }),
      context({ hasWorkspace: true, hasActiveDocument: true }),
    ];

    const phpTestCommand = createCommands({
      isActiveDocumentPhp: false,
      isActiveDocumentPhpTest: true,
    })[3];
    const nonPhpTestCommand = createCommands({
      isActiveDocumentPhp: true,
      isActiveDocumentPhpTest: false,
    })[3];

    expect(
      contexts.map((commandContext) =>
        phpTestCommand.isEnabled(commandContext),
      ),
    ).toEqual([false, false, false, true]);
    expect(
      contexts.map((commandContext) =>
        nonPhpTestCommand.isEnabled(commandContext),
      ),
    ).toEqual([false, false, false, false]);
  });

  it("invokes the exact injected callbacks and returns their values directly", () => {
    const generateResult = Promise.resolve();
    const goToResult = Promise.resolve();
    const runTestResult = Promise.resolve();
    const runAllResult = Promise.resolve();
    const generateTestForActiveDocument = vi.fn(() => generateResult);
    const goToTestForActiveDocument = vi.fn(() => goToResult);
    const runTestForActiveDocument = vi.fn(() => runTestResult);
    const runAllTestsForActiveDocument = vi.fn(() => runAllResult);
    const commands = workbenchPhpTestCommands({
      shortcut: (commandId) => commandId,
      isActiveDocumentPhp: true,
      isActiveDocumentPhpTest: true,
      generateTestForActiveDocument,
      goToTestForActiveDocument,
      runTestForActiveDocument,
      runAllTestsForActiveDocument,
    });

    expect(commands[0].run()).toBe(generateResult);
    expect(commands[1].run()).toBe(goToResult);
    expect(commands[2].run()).toBe(runTestResult);
    expect(commands[3].run()).toBe(runAllResult);
    expect(generateTestForActiveDocument).toHaveBeenCalledTimes(1);
    expect(goToTestForActiveDocument).toHaveBeenCalledTimes(1);
    expect(runTestForActiveDocument).toHaveBeenCalledTimes(1);
    expect(runAllTestsForActiveDocument).toHaveBeenCalledTimes(1);
  });
});

function createCommands({
  isActiveDocumentPhp,
  isActiveDocumentPhpTest,
}: {
  isActiveDocumentPhp: boolean;
  isActiveDocumentPhpTest: boolean;
}): Command[] {
  return workbenchPhpTestCommands({
    shortcut: (commandId) => commandId,
    isActiveDocumentPhp,
    isActiveDocumentPhpTest,
    generateTestForActiveDocument: vi.fn(),
    goToTestForActiveDocument: vi.fn(),
    runTestForActiveDocument: vi.fn(),
    runAllTestsForActiveDocument: vi.fn(),
  });
}

function context({
  hasWorkspace,
  hasActiveDocument,
}: {
  hasWorkspace: boolean;
  hasActiveDocument: boolean;
}): CommandContext {
  return {
    activeDocumentDirty: false,
    hasActiveDocument,
    hasWorkspace,
  };
}
