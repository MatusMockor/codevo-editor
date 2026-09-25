import { describe, expect, it, vi } from "vitest";
import type { CommandContext, CommandExecutionOutcome } from "./commandRegistry";
import {
  createSecondaryEditorCommandRunner,
  secondaryEditorCommandContext,
} from "./secondaryEditorCommandRunner";

describe("secondary editor command runner", () => {
  it("runs workbench commands without claiming the main editor document", () => {
    const runCommand = vi.fn<(id: string, context?: CommandContext) => CommandExecutionOutcome>(
      () => "executed",
    );
    const run = createSecondaryEditorCommandRunner(runCommand, () => true);

    expect(run("editor.recentFiles")).toBe("executed");
    expect(runCommand).toHaveBeenCalledWith("editor.recentFiles", {
      activeDocumentDirty: false,
      hasActiveDocument: false,
      hasWorkspace: true,
    });
  });

  it("never exposes the main editor surface scope to a secondary editor", () => {
    const context = secondaryEditorCommandContext(true);

    expect(context.editorSurfaceScope).toBeUndefined();
    expect(context.npmRunSelectedScriptCapture).toBeUndefined();
    expect(Object.isFrozen(context)).toBe(true);
  });

  it("reads the workspace state at dispatch time", () => {
    const runCommand = vi.fn<(id: string, context?: CommandContext) => CommandExecutionOutcome>(
      () => "disabled",
    );
    let hasWorkspace = false;
    const run = createSecondaryEditorCommandRunner(runCommand, () => hasWorkspace);

    run("file.quickOpen");
    hasWorkspace = true;
    run("file.quickOpen");

    expect(runCommand.mock.calls.map(([, context]) => context?.hasWorkspace)).toEqual([
      false,
      true,
    ]);
  });

  it.each([
    "bookmark.toggle",
    "debug.runToCursor",
    "debug.toggleBreakpoint",
    "editor.debug.action.toggleInlineBreakpoint",
    "testing.debugAtCursor",
    "testing.runAtCursor",
    "testing.runCurrentFile",
  ])("disables the main-editor cursor command %s without running it", (commandId) => {
    const runCommand = vi.fn<(id: string, context?: CommandContext) => CommandExecutionOutcome>(
      () => "executed",
    );
    const run = createSecondaryEditorCommandRunner(runCommand, () => true);

    expect(run(commandId)).toBe("disabled");
    expect(runCommand).not.toHaveBeenCalled();
  });
});
