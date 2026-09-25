import { useEffect, type MutableRefObject } from "react";
import type * as Monaco from "monaco-editor";
import { monacoDefaultEditorCommandsForKeybinding } from "../../infrastructure/monacoWorkbenchPolicy";
import type { CommandExecutionRunner } from "../../application/commandRegistry";
import { requestRegisteredCommand, runRegisteredCommand } from "../../application/commandChain";
import {
  planEditorKeymapCommandBindings,
  type EditorKeymapCommandBinding,
} from "../../application/editorKeymapCommandBindings";
import type { HippieSession } from "../../domain/hippieCompletion";
import {
  defaultShortcutForCommand,
  detectKeymapPlatform,
  keymapCommandIdsForShortcut,
  shortcutForCommand,
  type KeymapCommandId,
  type KeymapPlatform,
  type KeymapSettings,
} from "../../domain/keymap";
import type { EditorDocument } from "../../domain/workspace";
import type { EditorPosition } from "../../domain/languageServerFeatures";
import { monacoKeybindingsForShortcut } from "../monacoKeybindings";
import {
  applyCompleteStatement,
  applyCyclicExpandWord,
  applyMoveStatement,
  expandEditorSelection,
  surroundWithRequestFromEditor,
  triggerEditorAction,
  triggerEditorSurfaceCommand,
  type SurroundWithRequest,
} from "./editorCommands";
import { configuredF12NeedsNativeDefinition } from "./useEditorDefinitionNavigation";

export interface EditorActionCommandPort {
  closeActiveTab(): void;
  goBack(): void;
  goForward(): void;
  goToDefinition(): void;
  goToImplementationAt(position: EditorPosition): void;
  goToSuperMethod(): void;
  openClass(): void;
  openFile(): void;
  openFileStructure(): void;
  toggleGitBlame?(): void;
}

export interface EditorKeymapActionOptions {
  readonly activeDocumentRef: { readonly current: EditorDocument | null | undefined };
  readonly columnSelectionEnabledRef: MutableRefObject<boolean>;
  readonly commandExecutionRunnerRef: { readonly current: CommandExecutionRunner | undefined };
  readonly customDefinitionNavigationEnabled: boolean;
  readonly defaultEditorCommandsForKeybinding: (
    keybinding: number,
    editor: Monaco.editor.IStandaloneCodeEditor,
  ) => readonly string[];
  readonly editor: Monaco.editor.IStandaloneCodeEditor;
  readonly editorActionCommandPortRef: { readonly current: EditorActionCommandPort };
  readonly hippieSessionRef: MutableRefObject<HippieSession | null>;
  readonly keymap: KeymapSettings;
  readonly keymapPlatform: KeymapPlatform;
  readonly managedJavaScriptTypeScriptDocumentActive: boolean;
  readonly monaco: typeof Monaco;
  readonly requestSurroundWith: (request: SurroundWithRequest) => void;
}

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

interface EditorContextMenuEntry {
  readonly actionId: string;
  readonly commandId: KeymapCommandId;
  readonly group: string;
  readonly keybindingContext?: string;
  readonly label: string;
  readonly order: number;
  readonly precondition: string;
}

export const EDITOR_CONTEXT_MENU_ENTRIES: readonly EditorContextMenuEntry[] = [
  {
    actionId: "mockor.goToDefinition",
    commandId: "editor.goToDefinition",
    group: "navigation",
    label: "Go to Definition",
    order: 1.1,
    precondition: "editorHasDefinitionProvider",
  },
  {
    actionId: "mockor.goToDeclaration",
    commandId: "editor.goToDeclaration",
    group: "navigation",
    label: "Go to Declaration",
    order: 1.3,
    precondition: "editorHasDeclarationProvider",
  },
  {
    actionId: "mockor.goToTypeDefinition",
    commandId: "editor.goToTypeDefinition",
    group: "navigation",
    label: "Go to Type Definition",
    order: 1.4,
    precondition: "editorHasTypeDefinitionProvider",
  },
  {
    actionId: "mockor.goToImplementation",
    commandId: "editor.goToImplementation",
    group: "navigation",
    label: "Go to Implementations",
    order: 1.45,
    precondition: "editorHasImplementationProvider",
  },
  {
    actionId: "mockor.findReferences",
    commandId: "editor.findReferences",
    group: "navigation",
    keybindingContext: "!referenceSearchVisible",
    label: "Find All References",
    order: 1.46,
    precondition: "editorHasReferenceProvider && !inReferenceSearchEditor",
  },
  {
    actionId: "mockor.rename",
    commandId: "editor.rename",
    group: "1_modification",
    label: "Rename Symbol",
    order: 1.1,
    precondition: "editorHasRenameProvider && !editorReadonly",
  },
  {
    actionId: "mockor.formatDocument",
    commandId: "editor.formatDocument",
    group: "1_modification",
    label: "Format Document",
    order: 1.3,
    precondition: "editorHasDocumentFormattingProvider && !editorReadonly",
  },
  {
    actionId: "mockor.refactor",
    commandId: "editor.action.refactor",
    group: "1_modification",
    label: "Refactor...",
    order: 2,
    precondition: "editorHasCodeActionsProvider && !editorReadonly",
  },
  {
    actionId: "mockor.sourceAction",
    commandId: "editor.action.sourceAction",
    group: "1_modification",
    label: "Source Action...",
    order: 2.1,
    precondition: "editorHasCodeActionsProvider && !editorReadonly",
  },
];

const F12_DISPATCH_SHORTCUT = "F12";
const EDITOR_TEXT_FOCUS = "editorTextFocus";

type EditorKeymapActionHookOptions = Omit<
  EditorKeymapActionOptions,
  "defaultEditorCommandsForKeybinding" | "editor" | "keymapPlatform" | "monaco"
> & {
  readonly editor: Monaco.editor.IStandaloneCodeEditor | null;
  readonly monaco: typeof Monaco | null;
};

export function useEditorKeymapActions({
  activeDocumentRef,
  columnSelectionEnabledRef,
  commandExecutionRunnerRef,
  customDefinitionNavigationEnabled,
  editor,
  editorActionCommandPortRef,
  hippieSessionRef,
  keymap,
  managedJavaScriptTypeScriptDocumentActive,
  monaco,
  requestSurroundWith,
}: EditorKeymapActionHookOptions): void {
  useEffect(() => {
    if (!editor || !monaco) {
      return;
    }

    const disposables = registerEditorKeymapActions({
      activeDocumentRef,
      columnSelectionEnabledRef,
      commandExecutionRunnerRef,
      customDefinitionNavigationEnabled,
      defaultEditorCommandsForKeybinding: monacoDefaultEditorCommandsForKeybinding,
      editor,
      editorActionCommandPortRef,
      hippieSessionRef,
      keymap,
      keymapPlatform: detectKeymapPlatform(),
      managedJavaScriptTypeScriptDocumentActive,
      monaco,
      requestSurroundWith,
    });

    return () => {
      disposables.forEach((disposable) => disposable?.dispose());
    };
  }, [
    activeDocumentRef,
    columnSelectionEnabledRef,
    commandExecutionRunnerRef,
    customDefinitionNavigationEnabled,
    editor,
    editorActionCommandPortRef,
    hippieSessionRef,
    keymap,
    managedJavaScriptTypeScriptDocumentActive,
    monaco,
    requestSurroundWith,
  ]);
}

export function registerEditorKeymapActions(
  options: EditorKeymapActionOptions,
): readonly Monaco.IDisposable[] {
  return [
    ...registerExplicitEditorActions(options),
    ...registerEditorContextMenuEntries(options),
    ...registerKeymapCommandBridge(options),
  ];
}

function registerExplicitEditorActions({
  activeDocumentRef,
  columnSelectionEnabledRef,
  commandExecutionRunnerRef,
  customDefinitionNavigationEnabled,
  editor,
  editorActionCommandPortRef,
  hippieSessionRef,
  keymap,
  keymapPlatform,
  managedJavaScriptTypeScriptDocumentActive,
  monaco,
  requestSurroundWith,
}: EditorKeymapActionOptions): readonly Monaco.IDisposable[] {
  const keybinding = (commandId: KeymapCommandId) =>
    monacoKeybindingsForShortcut(
      monaco,
      shortcutForCommand(keymap, commandId, keymapPlatform),
      keymapPlatform,
    ).filter((binding) => binding !== monaco.KeyCode.F12);
  const configuredF12CommandIds = keymapCommandIdsForShortcut(keymap, "F12", keymapPlatform);
  const definitionUsesDefaultShortcut =
    shortcutForCommand(keymap, "editor.goToDefinition", keymapPlatform) ===
    defaultShortcutForCommand("editor.goToDefinition", keymapPlatform);
  const disposables = [
    editor.addAction({
      id: "mockor.dispatchF12",
      label: "Dispatch F12",
      keybindings: [monaco.KeyCode.F12],
      run: () => {
        if (configuredF12CommandIds.length > 0) {
          if (
            configuredF12NeedsNativeDefinition({
              commandIds: configuredF12CommandIds,
              customNavigationEnabled: customDefinitionNavigationEnabled,
              runCommand: commandExecutionRunnerRef.current,
            })
          ) {
            triggerEditorAction(editor, "editor.action.revealDefinition");
          }
          return;
        }

        if (definitionUsesDefaultShortcut) {
          if (customDefinitionNavigationEnabled) {
            runRegisteredCommand(commandExecutionRunnerRef, "editor.goToDefinition", () =>
              editorActionCommandPortRef.current.goToDefinition(),
            );
          } else {
            triggerEditorAction(editor, "editor.action.revealDefinition");
          }
        }
      },
    }),
    editor.addAction({
      id: "mockor.goToDefinition",
      label: "Go to Definition",
      keybindings: keybinding("editor.goToDefinition"),
      run: () => {
        if (!customDefinitionNavigationEnabled) {
          triggerEditorAction(editor, "editor.action.revealDefinition");
          return;
        }

        runRegisteredCommand(commandExecutionRunnerRef, "editor.goToDefinition", () =>
          editorActionCommandPortRef.current.goToDefinition(),
        );
      },
    }),
    editor.addAction({
      id: "mockor.quickDefinition",
      label: "Quick Definition",
      keybindings: keybinding("editor.quickDefinition"),
      run: () => requestRegisteredCommand(commandExecutionRunnerRef, "editor.quickDefinition"),
    }),
    editor.addAction({
      id: "mockor.goToSourceDefinition",
      label: "Go to Source Definition",
      keybindings: keybinding("editor.goToSourceDefinition"),
      run: () =>
        runRegisteredCommand(
          commandExecutionRunnerRef,
          "editor.goToSourceDefinition",
          () => undefined,
        ),
    }),
    editor.addAction({
      id: "mockor.goToDeclaration",
      label: "Go to Declaration",
      keybindings: keybinding("editor.goToDeclaration"),
      run: () =>
        runRegisteredCommand(commandExecutionRunnerRef, "editor.goToDeclaration", () =>
          triggerEditorAction(editor, "editor.action.revealDeclaration"),
        ),
    }),
    editor.addAction({
      id: "mockor.goToTypeDefinition",
      label: "Go to Type Definition",
      keybindings: keybinding("editor.goToTypeDefinition"),
      run: () =>
        runRegisteredCommand(commandExecutionRunnerRef, "editor.goToTypeDefinition", () =>
          triggerEditorAction(editor, "editor.action.goToTypeDefinition"),
        ),
    }),
    editor.addAction({
      id: "mockor.goToImplementation",
      label: "Go to Implementation",
      keybindings: keybinding("editor.goToImplementation"),
      run: () => {
        runRegisteredCommand(commandExecutionRunnerRef, "editor.goToImplementation", () => {
          const position = editor.getPosition();

          if (!position) {
            return;
          }

          editorActionCommandPortRef.current.goToImplementationAt(position);
        });
      },
    }),
    editor.addAction({
      id: "mockor.goToSuperMethod",
      label: "Go to Super Method",
      keybindings: keybinding("editor.goToSuperMethod"),
      run: () =>
        runRegisteredCommand(commandExecutionRunnerRef, "editor.goToSuperMethod", () =>
          editorActionCommandPortRef.current.goToSuperMethod(),
        ),
    }),
    editor.addAction({
      id: "mockor.findReferences",
      label: "Find All References",
      keybindingContext: "!referenceSearchVisible && !inReferenceSearchEditor",
      keybindings: keybinding("editor.findReferences"),
      run: () => {
        if (managedJavaScriptTypeScriptDocumentActive) {
          requestRegisteredCommand(commandExecutionRunnerRef, "editor.findReferences");
          return;
        }

        runRegisteredCommand(commandExecutionRunnerRef, "editor.findReferences", () =>
          triggerEditorAction(editor, "editor.action.goToReferences"),
        );
      },
    }),
    editor.addAction({
      id: "mockor.findFileReferences",
      label: "Find File References",
      keybindings: keybinding("editor.findFileReferences"),
      run: () =>
        runRegisteredCommand(commandExecutionRunnerRef, "editor.findFileReferences", () =>
          triggerEditorAction(editor, "editor.action.peekImplementation"),
        ),
    }),
    editor.addAction({
      id: "mockor.openClass",
      label: "Open Class",
      keybindings: keybinding("class.quickOpen"),
      run: () =>
        runRegisteredCommand(commandExecutionRunnerRef, "class.quickOpen", () =>
          editorActionCommandPortRef.current.openClass(),
        ),
    }),
    editor.addAction({
      id: "mockor.openFile",
      label: "Open File",
      keybindings: keybinding("file.quickOpen"),
      run: () =>
        runRegisteredCommand(commandExecutionRunnerRef, "file.quickOpen", () =>
          editorActionCommandPortRef.current.openFile(),
        ),
    }),
    editor.addAction({
      id: "mockor.fileStructure",
      label: "File Structure",
      keybindings: keybinding("editor.fileStructure"),
      run: () =>
        runRegisteredCommand(commandExecutionRunnerRef, "editor.fileStructure", () =>
          editorActionCommandPortRef.current.openFileStructure(),
        ),
    }),
    editor.addAction({
      id: "mockor.gotoLine",
      label: "Go to Line/Column",
      keybindings: keybinding("editor.gotoLine"),
      run: () =>
        runRegisteredCommand(commandExecutionRunnerRef, "editor.gotoLine", () =>
          triggerEditorSurfaceCommand(editor, "editor.gotoLine"),
        ),
    }),
    editor.addAction({
      id: "mockor.rename",
      label: "Rename Symbol",
      keybindings: keybinding("editor.rename"),
      run: () =>
        runRegisteredCommand(commandExecutionRunnerRef, "editor.rename", () =>
          triggerEditorSurfaceCommand(editor, "editor.rename"),
        ),
    }),
    editor.addAction({
      id: "mockor.toggleGitBlame",
      label: "Annotate with Git Blame",
      keybindings: keybinding("editor.toggleGitBlame"),
      run: () =>
        runRegisteredCommand(commandExecutionRunnerRef, "editor.toggleGitBlame", () =>
          editorActionCommandPortRef.current.toggleGitBlame?.(),
        ),
    }),
    editor.addAction({
      id: "mockor.formatDocument",
      label: "Format Document",
      keybindings: keybinding("editor.formatDocument"),
      run: () =>
        runRegisteredCommand(commandExecutionRunnerRef, "editor.formatDocument", () =>
          triggerEditorSurfaceCommand(editor, "editor.formatDocument"),
        ),
    }),
    editor.addAction({
      id: "mockor.formatSelection",
      label: "Format Selection",
      keybindings: keybinding("editor.formatSelection"),
      run: () =>
        runRegisteredCommand(commandExecutionRunnerRef, "editor.formatSelection", () =>
          triggerEditorSurfaceCommand(editor, "editor.formatSelection"),
        ),
    }),
    editor.addAction({
      id: "mockor.quickFix",
      label: "Show Context Actions",
      keybindings: [
        ...keybinding("editor.quickFix"),
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.Period,
      ],
      run: () =>
        runRegisteredCommand(commandExecutionRunnerRef, "editor.quickFix", () =>
          triggerEditorSurfaceCommand(editor, "editor.quickFix"),
        ),
    }),
    editor.addAction({
      id: "mockor.extendSelection",
      label: "Extend Selection",
      keybindings: keybinding("editor.extendSelection"),
      run: () => {
        if (expandEditorSelection(monaco, editor)) {
          return;
        }

        editor.trigger("keyboard", "editor.action.smartSelect.expand", {});
      },
    }),
    editor.addAction({
      id: "mockor.shrinkSelection",
      label: "Shrink Selection",
      keybindings: keybinding("editor.shrinkSelection"),
      run: () => triggerEditorAction(editor, "editor.action.smartSelect.shrink"),
    }),
    editor.addAction({
      id: "mockor.insertCursorAbove",
      label: "Add Caret Above",
      keybindings: keybinding("editor.insertCursorAbove"),
      run: () => triggerEditorAction(editor, "editor.action.insertCursorAbove"),
    }),
    editor.addAction({
      id: "mockor.insertCursorBelow",
      label: "Add Caret Below",
      keybindings: keybinding("editor.insertCursorBelow"),
      run: () => triggerEditorAction(editor, "editor.action.insertCursorBelow"),
    }),
    editor.addAction({
      id: "mockor.selectAllOccurrences",
      label: "Select All Occurrences",
      keybindings: keybinding("editor.selectAllOccurrences"),
      run: () => triggerEditorAction(editor, "editor.action.selectHighlights"),
    }),
    editor.addAction({
      id: "mockor.toggleColumnSelection",
      label: "Toggle Column Selection Mode",
      keybindings: keybinding("editor.toggleColumnSelection"),
      run: () => {
        if (!editor.getModel()) {
          return;
        }

        columnSelectionEnabledRef.current = !columnSelectionEnabledRef.current;
        editor.updateOptions({
          columnSelection: columnSelectionEnabledRef.current,
        });
      },
    }),
    editor.addAction({
      id: "mockor.moveStatementUp",
      label: "Move Statement Up",
      keybindings: keybinding("editor.moveStatementUp"),
      run: () => {
        if (
          activeDocumentRef.current?.language === "php" &&
          applyMoveStatement(monaco, editor, "up")
        ) {
          return;
        }

        triggerEditorAction(editor, "editor.action.moveLinesUpAction");
      },
    }),
    editor.addAction({
      id: "mockor.moveStatementDown",
      label: "Move Statement Down",
      keybindings: keybinding("editor.moveStatementDown"),
      run: () => {
        if (
          activeDocumentRef.current?.language === "php" &&
          applyMoveStatement(monaco, editor, "down")
        ) {
          return;
        }

        triggerEditorAction(editor, "editor.action.moveLinesDownAction");
      },
    }),
    editor.addAction({
      id: "mockor.moveLineUp",
      label: "Move Line Up",
      keybindings: keybinding("editor.moveLineUp"),
      run: () => triggerEditorAction(editor, "editor.action.moveLinesUpAction"),
    }),
    editor.addAction({
      id: "mockor.moveLineDown",
      label: "Move Line Down",
      keybindings: keybinding("editor.moveLineDown"),
      run: () => triggerEditorAction(editor, "editor.action.moveLinesDownAction"),
    }),
    editor.addAction({
      id: "mockor.duplicateLine",
      label: "Duplicate Line or Selection",
      keybindings: keybinding("editor.duplicateLine"),
      run: () => triggerEditorAction(editor, "editor.action.copyLinesDownAction"),
    }),
    editor.addAction({
      id: "mockor.addSelectionToNextMatch",
      label: "Add Selection to Next Match",
      keybindings: keybinding("editor.addSelectionToNextMatch"),
      run: () => triggerEditorAction(editor, "editor.action.addSelectionToNextFindMatch"),
    }),
    editor.addAction({
      id: "mockor.deleteLine",
      label: "Delete Line",
      keybindings: keybinding("editor.deleteLine"),
      run: () => triggerEditorAction(editor, "editor.action.deleteLines"),
    }),
    editor.addAction({
      id: "mockor.joinLines",
      label: "Join Lines",
      keybindings: keybinding("editor.joinLines"),
      run: () => triggerEditorAction(editor, "editor.action.joinLines"),
    }),
    editor.addAction({
      id: "mockor.foldAll",
      label: "Fold All",
      keybindings: keybinding("editor.foldAll"),
      run: () => triggerEditorAction(editor, "editor.foldAll"),
    }),
    editor.addAction({
      id: "mockor.unfoldAll",
      label: "Unfold All",
      keybindings: keybinding("editor.unfoldAll"),
      run: () => triggerEditorAction(editor, "editor.unfoldAll"),
    }),
    editor.addAction({
      id: "mockor.foldRecursively",
      label: "Fold Recursively",
      keybindings: keybinding("editor.foldRecursively"),
      run: () => triggerEditorAction(editor, "editor.foldRecursively"),
    }),
    editor.addAction({
      id: "mockor.unfoldRecursively",
      label: "Unfold Recursively",
      keybindings: keybinding("editor.unfoldRecursively"),
      run: () => triggerEditorAction(editor, "editor.unfoldRecursively"),
    }),
    editor.addAction({
      id: "mockor.sortLinesAscending",
      label: "Sort Lines Ascending",
      keybindings: keybinding("editor.sortLinesAscending"),
      run: () => triggerEditorAction(editor, "editor.action.sortLinesAscending"),
    }),
    editor.addAction({
      id: "mockor.sortLinesDescending",
      label: "Sort Lines Descending",
      keybindings: keybinding("editor.sortLinesDescending"),
      run: () => triggerEditorAction(editor, "editor.action.sortLinesDescending"),
    }),
    editor.addAction({
      id: "mockor.toggleCase",
      label: "Toggle Case",
      keybindings: keybinding("editor.toggleCase"),
      run: () => triggerEditorAction(editor, "editor.action.transformToUppercase"),
    }),
    editor.addAction({
      id: "mockor.transformToLowercase",
      label: "Transform to Lowercase",
      keybindings: keybinding("editor.transformToLowercase"),
      run: () => triggerEditorAction(editor, "editor.action.transformToLowercase"),
    }),
    editor.addAction({
      id: "mockor.surroundWith",
      label: "Surround With",
      keybindings: keybinding("editor.surroundWith"),
      run: () => {
        const request = surroundWithRequestFromEditor(monaco, editor);

        if (!request) {
          return;
        }

        requestSurroundWith(request);
      },
    }),
    editor.addAction({
      id: "mockor.completeStatement",
      label: "Complete Current Statement",
      keybindings: keybinding("editor.completeStatement"),
      run: () => {
        if (activeDocumentRef.current?.language !== "php") {
          return;
        }

        applyCompleteStatement(monaco, editor);
      },
    }),
    editor.addAction({
      id: "mockor.cyclicExpandWord",
      label: "Cyclic Expand Word",
      keybindings: keybinding("editor.cyclicExpandWord"),
      run: () => {
        applyCyclicExpandWord(monaco, editor, hippieSessionRef);
      },
    }),
    editor.addAction({
      id: "mockor.closeTab",
      label: "Close Tab",
      keybindings: keybinding("editor.closeTab"),
      run: () =>
        runRegisteredCommand(commandExecutionRunnerRef, "editor.closeTab", () =>
          editorActionCommandPortRef.current.closeActiveTab(),
        ),
    }),
    editor.addAction({
      id: "mockor.goBack",
      label: "Go Back",
      keybindings: keybinding("navigation.back"),
      run: () =>
        runRegisteredCommand(commandExecutionRunnerRef, "navigation.back", () =>
          editorActionCommandPortRef.current.goBack(),
        ),
    }),
    editor.addAction({
      id: "mockor.goForward",
      label: "Go Forward",
      keybindings: keybinding("navigation.forward"),
      run: () =>
        runRegisteredCommand(commandExecutionRunnerRef, "navigation.forward", () =>
          editorActionCommandPortRef.current.goForward(),
        ),
    }),
    editor.addAction({
      id: "mockor.nextChange",
      label: "Go to Next Change",
      keybindings: keybinding("editor.nextChange"),
      run: () => requestRegisteredCommand(commandExecutionRunnerRef, "editor.nextChange"),
    }),
    editor.addAction({
      id: "mockor.previousChange",
      label: "Go to Previous Change",
      keybindings: keybinding("editor.previousChange"),
      run: () => requestRegisteredCommand(commandExecutionRunnerRef, "editor.previousChange"),
    }),
    editor.addAction({
      id: "mockor.refactor",
      label: "Refactor...",
      keybindings: keybinding("editor.action.refactor"),
      run: () =>
        runRegisteredCommand(commandExecutionRunnerRef, "editor.action.refactor", () =>
          triggerEditorSurfaceCommand(editor, "editor.action.refactor"),
        ),
    }),
    editor.addAction({
      id: "mockor.sourceAction",
      label: "Source Action...",
      keybindings: keybinding("editor.action.sourceAction"),
      run: () =>
        runRegisteredCommand(commandExecutionRunnerRef, "editor.action.sourceAction", () =>
          triggerEditorSurfaceCommand(editor, "editor.action.sourceAction"),
        ),
    }),
  ];

  return disposables;
}

function registerEditorContextMenuEntries({
  editor,
  keymap,
  keymapPlatform,
  monaco,
}: EditorKeymapActionOptions): readonly Monaco.IDisposable[] {
  return EDITOR_CONTEXT_MENU_ENTRIES.map((entry) =>
    editor.addAction({
      contextMenuGroupId: entry.group,
      contextMenuOrder: entry.order,
      id: `${entry.actionId}.contextMenu`,
      keybindingContext: entry.keybindingContext,
      keybindings: monacoKeybindingsForShortcut(
        monaco,
        shortcutForCommand(keymap, entry.commandId, keymapPlatform),
        keymapPlatform,
      ).filter((binding) => binding !== monaco.KeyCode.F12),
      label: entry.label,
      precondition: entry.precondition,
      run: () => editor.getAction(entry.actionId)?.run(),
    }),
  );
}

function registerKeymapCommandBridge({
  commandExecutionRunnerRef,
  defaultEditorCommandsForKeybinding,
  editor,
  keymap,
  keymapPlatform,
  monaco,
}: EditorKeymapActionOptions): readonly Monaco.IDisposable[] {
  const bindings = planEditorKeymapCommandBindings(
    keymap,
    keymapPlatform,
    EDITOR_SURFACE_OWNED_KEYMAP_COMMAND_IDS,
  );

  return bindings.flatMap((binding, index) => {
    if (binding.shortcut === F12_DISPATCH_SHORTCUT) return [];
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
          if (runKeymapBinding(commandExecutionRunnerRef.current, binding)) return;
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
