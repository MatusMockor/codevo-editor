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
      commands.map(({ id, title, category }) => ({ id, title, category })),
    ).toEqual([
      {
        id: "js.runTest",
        title: "Run Test Under Cursor",
        category: "JavaScript",
      },
      {
        id: "js.runTestFile",
        title: "Run All Tests in File",
        category: "JavaScript",
      },
      {
        id: "js.runTestsWithResultsPanel",
        title: "JavaScript: Run Tests with Results Panel",
        category: "JavaScript",
      },
    ]);
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
      expect(
        contexts.map((value) => command(enabledForJsTest, id).isEnabled(value)),
      ).toEqual([false, false, true]);
      expect(
        command(disabledForOther, id).isEnabled(contexts[2]),
      ).toBe(false);
    }
  });

  it("enables the results panel command only for a JS workspace", () => {
    const withWorkspace = createCommands({ hasJsWorkspace: true });
    const withoutWorkspace = createCommands({ hasJsWorkspace: false });
    const active = context({ hasWorkspace: true, hasActiveDocument: false });

    expect(
      command(withWorkspace, "js.runTestsWithResultsPanel").isEnabled(active),
    ).toBe(true);
    expect(
      command(withoutWorkspace, "js.runTestsWithResultsPanel").isEnabled(
        active,
      ),
    ).toBe(false);
  });

  it("wires the run callbacks", () => {
    const runTestForActiveDocument = vi.fn();
    const runAllTestsForActiveDocument = vi.fn();
    const openTestResultsPanel = vi.fn();
    const commands = workbenchJsTestCommands({
      hasJsWorkspace: true,
      isActiveDocumentJsTest: true,
      runTestForActiveDocument,
      runAllTestsForActiveDocument,
      openTestResultsPanel,
    });

    command(commands, "js.runTest").run();
    command(commands, "js.runTestFile").run();
    command(commands, "js.runTestsWithResultsPanel").run();

    expect(runTestForActiveDocument).toHaveBeenCalledTimes(1);
    expect(runAllTestsForActiveDocument).toHaveBeenCalledTimes(1);
    expect(openTestResultsPanel).toHaveBeenCalledTimes(1);
  });
});

function createCommands(
  overrides: Partial<Parameters<typeof workbenchJsTestCommands>[0]> = {},
): Command[] {
  return workbenchJsTestCommands({
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
