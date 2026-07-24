const MONACO_EDITOR_SELECTOR = ".monaco-editor";
const MONACO_TEXT_INPUT_SELECTOR = "textarea.inputarea, [contenteditable='true'].inputarea";

/**
 * Resolves the exact Monaco text-input owner for a keyboard event. Keeping the
 * DOM knowledge behind this adapter lets the key-chord state machine remain a
 * pure domain service and prevents editor-scoped chords from leaking into
 * Monaco widgets or other workbench inputs.
 */
export function editorTextFocusOwner(event: Pick<KeyboardEvent, "target">): Element | null {
  if (!(event.target instanceof Element)) {
    return null;
  }

  const textInput = event.target.closest(MONACO_TEXT_INPUT_SELECTOR);
  if (textInput !== event.target) {
    return null;
  }

  return textInput.closest(MONACO_EDITOR_SELECTOR);
}
