import { MenuId, MenuRegistry } from "monaco-editor/esm/vs/platform/actions/common/actions.js";
import {
  decodeKeybinding,
  type MonacoKeybinding,
} from "monaco-editor/esm/vs/base/common/keybindings.js";
import type * as Monaco from "monaco-editor";
import {
  ContextKeyExpr,
  type ContextKeyExpression,
} from "monaco-editor/esm/vs/platform/contextkey/common/contextkey.js";
import { KeybindingsRegistry } from "monaco-editor/esm/vs/platform/keybinding/common/keybindingsRegistry.js";
import { OS } from "monaco-editor/esm/vs/base/common/platform.js";

export const CODEVO_OWNED_MONACO_CONTEXT_MENU_COMMAND_IDS: ReadonlySet<string> = new Set([
  "editor.action.formatDocument",
  "editor.action.goToImplementation",
  "editor.action.goToReferences",
  "editor.action.goToTypeDefinition",
  "editor.action.quickCommand",
  "editor.action.refactor",
  "editor.action.rename",
  "editor.action.revealDeclaration",
  "editor.action.revealDefinition",
  "editor.action.sourceAction",
]);

export const UNBOUND_MONACO_KEYBINDING_COMMAND_IDS: ReadonlySet<string> = new Set([
  "editor.action.quickCommand",
]);

export function applyMonacoWorkbenchPolicy(): void {
  for (const item of MenuRegistry.getMenuItems(MenuId.EditorContext)) {
    if (!item.command || !CODEVO_OWNED_MONACO_CONTEXT_MENU_COMMAND_IDS.has(item.command.id)) {
      continue;
    }
    item.when = ContextKeyExpr.false();
  }

  for (const item of KeybindingsRegistry.getDefaultKeybindings()) {
    if (!item.command || !UNBOUND_MONACO_KEYBINDING_COMMAND_IDS.has(item.command)) continue;
    item.when = ContextKeyExpr.false();
  }
}

export function monacoDefaultEditorCommandsForKeybinding(
  keybinding: number,
  editor: Monaco.editor.IStandaloneCodeEditor,
): readonly string[] {
  const target = decodeKeybinding(keybinding, OS);
  const contextKeys = editorContextKeys(editor);
  if (!target || !contextKeys) return [];

  return KeybindingsRegistry.getDefaultKeybindings()
    .filter((item) => item.command && item.keybinding && keybindingsEqual(item.keybinding, target))
    .filter((item) => !item.when || contextKeys.contextMatchesRules(item.when))
    .map((item) => item.command as string)
    .reverse();
}

interface EditorContextKeys {
  contextMatchesRules(rules: ContextKeyExpression): boolean;
}

function editorContextKeys(editor: Monaco.editor.IStandaloneCodeEditor): EditorContextKeys | null {
  const contextKeys = (editor as unknown as { _contextKeyService?: Partial<EditorContextKeys> })
    ._contextKeyService;
  if (typeof contextKeys?.contextMatchesRules !== "function") return null;
  return contextKeys as EditorContextKeys;
}

function keybindingsEqual(left: MonacoKeybinding, right: MonacoKeybinding): boolean {
  return (
    left.chords.length === right.chords.length &&
    left.chords.every((chord, index) => {
      const other = right.chords[index];
      return other !== undefined && chord.equals(other);
    })
  );
}
