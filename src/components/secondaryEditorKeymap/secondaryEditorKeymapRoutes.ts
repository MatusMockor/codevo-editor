import type { KeymapCommandId } from "../../domain/keymap";

export type EditorChangeNavigationTarget = "next" | "previous";

export type SecondaryEditorKeymapRoute =
  | { readonly kind: "editorAction"; readonly actionId: string }
  | { readonly kind: "workbenchCommand" }
  | { readonly kind: "changeNavigation"; readonly target: EditorChangeNavigationTarget }
  | { readonly kind: "closeSurface" }
  | { readonly kind: "unavailable" };

const UNAVAILABLE: SecondaryEditorKeymapRoute = Object.freeze({ kind: "unavailable" });
const WORKBENCH_COMMAND: SecondaryEditorKeymapRoute = Object.freeze({ kind: "workbenchCommand" });

const editorAction = (actionId: string): SecondaryEditorKeymapRoute =>
  Object.freeze({ actionId, kind: "editorAction" });

const SECONDARY_EDITOR_KEYMAP_ROUTES: ReadonlyMap<KeymapCommandId, SecondaryEditorKeymapRoute> =
  new Map<KeymapCommandId, SecondaryEditorKeymapRoute>([
    ["class.quickOpen", WORKBENCH_COMMAND],
    ["editor.addSelectionToNextMatch", editorAction("editor.action.addSelectionToNextFindMatch")],
    ["editor.closeTab", Object.freeze({ kind: "closeSurface" })],
    ["editor.deleteLine", editorAction("editor.action.deleteLines")],
    ["editor.duplicateLine", editorAction("editor.action.copyLinesDownAction")],
    ["editor.extendSelection", editorAction("editor.action.smartSelect.expand")],
    ["editor.foldAll", editorAction("editor.foldAll")],
    ["editor.foldRecursively", editorAction("editor.foldRecursively")],
    ["editor.gotoLine", editorAction("editor.action.gotoLine")],
    ["editor.insertCursorAbove", editorAction("editor.action.insertCursorAbove")],
    ["editor.insertCursorBelow", editorAction("editor.action.insertCursorBelow")],
    ["editor.joinLines", editorAction("editor.action.joinLines")],
    ["editor.moveLineDown", editorAction("editor.action.moveLinesDownAction")],
    ["editor.moveLineUp", editorAction("editor.action.moveLinesUpAction")],
    ["editor.moveStatementDown", editorAction("editor.action.moveLinesDownAction")],
    ["editor.moveStatementUp", editorAction("editor.action.moveLinesUpAction")],
    ["editor.nextChange", Object.freeze({ kind: "changeNavigation", target: "next" })],
    ["editor.previousChange", Object.freeze({ kind: "changeNavigation", target: "previous" })],
    ["editor.selectAllOccurrences", editorAction("editor.action.selectHighlights")],
    ["editor.shrinkSelection", editorAction("editor.action.smartSelect.shrink")],
    ["editor.sortLinesAscending", editorAction("editor.action.sortLinesAscending")],
    ["editor.sortLinesDescending", editorAction("editor.action.sortLinesDescending")],
    ["editor.toggleCase", editorAction("editor.action.transformToUppercase")],
    ["editor.transformToLowercase", editorAction("editor.action.transformToLowercase")],
    ["editor.unfoldAll", editorAction("editor.unfoldAll")],
    ["editor.unfoldRecursively", editorAction("editor.unfoldRecursively")],
    ["file.quickOpen", WORKBENCH_COMMAND],
    ["navigation.back", WORKBENCH_COMMAND],
    ["navigation.forward", WORKBENCH_COMMAND],
  ]);

export function secondaryEditorKeymapRoute(commandId: KeymapCommandId): SecondaryEditorKeymapRoute {
  return SECONDARY_EDITOR_KEYMAP_ROUTES.get(commandId) ?? UNAVAILABLE;
}
