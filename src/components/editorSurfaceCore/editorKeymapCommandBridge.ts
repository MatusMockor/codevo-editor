import type * as Monaco from "monaco-editor";
import type { CommandExecutionRunner } from "../../application/commandRegistry";
import {
  planEditorKeymapCommandBindings,
  type EditorKeymapCommandBinding,
} from "../../application/editorKeymapCommandBindings";
import type { KeymapCommandId, KeymapPlatform, KeymapSettings } from "../../domain/keymap";
import { monacoKeybindingsForShortcut } from "../monacoKeybindings";

export type DefaultEditorCommandsForKeybinding = (
  keybinding: number,
  editor: Monaco.editor.IStandaloneCodeEditor,
) => readonly string[];

export interface CommandExecutionRunnerRef {
  readonly current: CommandExecutionRunner | undefined;
}

export interface EditorKeymapCommandBridgeOptions {
  readonly commandRunnerRef: CommandExecutionRunnerRef;
  readonly defaultEditorCommandsForKeybinding: DefaultEditorCommandsForKeybinding;
  readonly editor: Monaco.editor.IStandaloneCodeEditor;
  readonly keymap: KeymapSettings;
  readonly keymapPlatform: KeymapPlatform;
  readonly monaco: typeof Monaco;
  readonly reservedShortcuts: ReadonlySet<string>;
}

export const EDITOR_TEXT_FOCUS = "editorTextFocus";

export const EDITOR_SURFACE_OWNED_KEYMAP_COMMAND_IDS: ReadonlySet<KeymapCommandId> = new Set([
  "class.quickOpen",
  "editor.action.refactor",
  "editor.action.sourceAction",
  "editor.addSelectionToNextMatch",
  "editor.closeTab",
  "editor.completeStatement",
  "editor.cyclicExpandWord",
  "editor.deleteLine",
  "editor.duplicateLine",
  "editor.extendSelection",
  "editor.fileStructure",
  "editor.findFileReferences",
  "editor.findReferences",
  "editor.foldAll",
  "editor.foldRecursively",
  "editor.formatDocument",
  "editor.formatSelection",
  "editor.goToDeclaration",
  "editor.goToDefinition",
  "editor.goToImplementation",
  "editor.goToSourceDefinition",
  "editor.goToSuperMethod",
  "editor.goToTypeDefinition",
  "editor.gotoLine",
  "editor.insertCursorAbove",
  "editor.insertCursorBelow",
  "editor.joinLines",
  "editor.moveLineDown",
  "editor.moveLineUp",
  "editor.moveStatementDown",
  "editor.moveStatementUp",
  "editor.nextChange",
  "editor.previousChange",
  "editor.quickDefinition",
  "editor.quickFix",
  "editor.rename",
  "editor.selectAllOccurrences",
  "editor.shrinkSelection",
  "editor.sortLinesAscending",
  "editor.sortLinesDescending",
  "editor.surroundWith",
  "editor.toggleCase",
  "editor.toggleColumnSelection",
  "editor.toggleGitBlame",
  "editor.transformToLowercase",
  "editor.unfoldAll",
  "editor.unfoldRecursively",
  "file.quickOpen",
  "navigation.back",
  "navigation.forward",
  "npm.runSelectedScript",
]);

export function registerKeymapCommandBridge({
  commandRunnerRef,
  defaultEditorCommandsForKeybinding,
  editor,
  keymap,
  keymapPlatform,
  monaco,
  reservedShortcuts,
}: EditorKeymapCommandBridgeOptions): readonly Monaco.IDisposable[] {
  const bindings = planEditorKeymapCommandBindings(
    keymap,
    keymapPlatform,
    EDITOR_SURFACE_OWNED_KEYMAP_COMMAND_IDS,
  );

  return bindings.flatMap((binding, index) => {
    if (reservedShortcuts.has(binding.shortcut)) return [];
    const keybindings = monacoKeybindingsForShortcut(monaco, binding.shortcut, keymapPlatform);
    const keybinding = keybindings[0];
    if (keybinding === undefined) return [];

    return [
      editor.addAction({
        id: `mockor.keymap.${index}`,
        keybindingContext: EDITOR_TEXT_FOCUS,
        keybindings,
        label: binding.shortcut,
        run: () => {
          if (runKeymapBinding(commandRunnerRef.current, binding)) return;
          runMonacoDefault(editor, defaultEditorCommandsForKeybinding(keybinding, editor));
        },
      }),
    ];
  });
}

function runKeymapBinding(
  runCommand: CommandExecutionRunner | undefined,
  binding: EditorKeymapCommandBinding,
): boolean {
  if (!runCommand) return false;
  return binding.commandIds.some((commandId) => runCommand(commandId) === "executed");
}

function runMonacoDefault(
  editor: Monaco.editor.IStandaloneCodeEditor,
  commandIds: readonly string[],
): void {
  for (const commandId of commandIds) {
    const action = editor.getAction(commandId);
    if (!action?.isSupported()) continue;
    void action.run();
    return;
  }
}
