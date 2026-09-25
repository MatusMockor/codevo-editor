import type { KeymapCommandId } from "../domain/keymap";
import type { CommandContext, CommandExecutionRunner } from "./commandRegistry";

const MAIN_EDITOR_CURSOR_COMMAND_IDS: ReadonlySet<string> = new Set([
  "bookmark.toggle",
  "debug.runToCursor",
  "debug.toggleBreakpoint",
  "editor.debug.action.toggleInlineBreakpoint",
  "testing.debugAtCursor",
  "testing.runAtCursor",
  "testing.runCurrentFile",
] satisfies readonly KeymapCommandId[]);

export function secondaryEditorCommandContext(hasWorkspace: boolean): CommandContext {
  return Object.freeze({ activeDocumentDirty: false, hasActiveDocument: false, hasWorkspace });
}

export function createSecondaryEditorCommandRunner(
  runCommand: CommandExecutionRunner,
  hasWorkspace: () => boolean,
): CommandExecutionRunner {
  return (commandId) => {
    if (MAIN_EDITOR_CURSOR_COMMAND_IDS.has(commandId)) return "disabled";
    return runCommand(commandId, secondaryEditorCommandContext(hasWorkspace()));
  };
}
