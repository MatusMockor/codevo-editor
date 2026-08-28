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
  const domNode = editor.getDomNode();
  if (!domNode) {
    return;
  }
  triggerWhenWidgetExists(editor, source, domNode, ".monaco-hover", "editor.action.hideHover");
  triggerWhenWidgetExists(editor, source, domNode, ".find-widget", "closeFindWidget");
  triggerWhenWidgetExists(editor, source, domNode, ".suggest-widget", "hideSuggestWidget");
  const root = domNode.ownerDocument ?? document;
  root
    .querySelectorAll<HTMLElement>(".monaco-aria-container, .monaco-status")
    .forEach((element) => {
      element.textContent = "";
    });
}

function triggerWhenWidgetExists(
  editor: Monaco.editor.IStandaloneCodeEditor,
  source: string,
  domNode: HTMLElement,
  selector: string,
  command: string,
): void {
  if (!domNode.querySelector(selector)) {
    return;
  }

  try {
    editor.trigger(source, command, {});
  } catch {
    // Monaco contributions are loaded lazily, so a best-effort dismissal command
    // can be absent while an editor model is restored behind another surface.
  }
}
