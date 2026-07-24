import type * as Monaco from "monaco-editor";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { EditorDocument } from "../domain/workspace";

export function shouldTriggerLatteMemberSuggest(
  language: EditorDocument["language"],
  model: Monaco.editor.ITextModel,
  position: EditorPosition,
  changes: readonly { text: string }[],
): boolean {
  if (language !== "latte" || !changes.some((change) => /[\w>-]/.test(change.text))) {
    return false;
  }

  const linePrefix = model
    .getLineContent(position.lineNumber)
    .slice(0, Math.max(0, position.column - 1));
  const lastOpenBrace = linePrefix.lastIndexOf("{");
  const lastCloseBrace = linePrefix.lastIndexOf("}");

  return (
    lastOpenBrace > lastCloseBrace &&
    /\$[A-Za-z_]\w*(?:\[[^\]]+\]|->[A-Za-z_]\w*)*->\w*$/.test(linePrefix.slice(lastOpenBrace + 1))
  );
}
