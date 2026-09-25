import type { KeyboardEvent } from "react";

const EDITOR_INPUT_SELECTOR = "textarea.inputarea, [contenteditable='true'].inputarea";

export function isDrawerEscape(event: KeyboardEvent<HTMLElement>): boolean {
  if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) {
    return false;
  }
  return !isEditableTarget(event.target);
}

export function activeEditorFocusRestorer(drawer: Element): () => void {
  const panel = drawer.closest(".cv-editor-panel");
  const editor = panel?.querySelector<HTMLElement>(".editor-group.active .editor-panel");
  if (!editor) return noop;
  const input = editor.querySelector<HTMLElement>(EDITOR_INPUT_SELECTOR);
  return () => {
    if (input?.isConnected) {
      input.focus();
      return;
    }
    if (!editor.isConnected) return;
    editor.tabIndex = -1;
    editor.focus();
  };
}

function noop(): void {}

function isEditableTarget(target: EventTarget): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}
