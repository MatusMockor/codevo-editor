import type * as Monaco from "monaco-editor";

export function dismissTransientEditorWidgets(
  editor: Monaco.editor.IStandaloneCodeEditor,
  source: string,
): void {
  dismissNow(editor, source);
  window.setTimeout(() => dismissNow(editor, source), 0);
}

function dismissNow(editor: Monaco.editor.IStandaloneCodeEditor, source: string): void {
  if (!editor.getModel()) {
    return;
  }
  editor.trigger(source, "editor.action.hideHover", {});
  editor.trigger(source, "closeFindWidget", {});
  editor.trigger(source, "hideSuggestWidget", {});
  const domNode = editor.getDomNode();
  if (!domNode) {
    return;
  }
  const root = domNode.ownerDocument ?? document;
  root
    .querySelectorAll<HTMLElement>(".monaco-aria-container, .monaco-status")
    .forEach((element) => {
      element.textContent = "";
    });
}
