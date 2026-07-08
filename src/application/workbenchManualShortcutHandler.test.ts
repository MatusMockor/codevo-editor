import { describe, expect, it, vi } from "vitest";
import { defaultKeymapSettings } from "../domain/keymap";
import { handleWorkbenchManualShortcut } from "./workbenchManualShortcutHandler";

describe("handleWorkbenchManualShortcut", () => {
  it("runs the matched manual shortcut action", () => {
    const actions = createActions();
    const event = keyboardEvent({ key: "F11" });

    const handled = handleWorkbenchManualShortcut({
      actions,
      event,
      keymap: defaultKeymapSettings("mac"),
      workspaceRoot: "/workspace",
    });

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(actions.toggleBookmarkAtCursor).toHaveBeenCalledTimes(1);
  });

  it("does not consume unmatched shortcuts", () => {
    const actions = createActions();
    const event = keyboardEvent({ key: "x", metaKey: true });

    const handled = handleWorkbenchManualShortcut({
      actions,
      event,
      keymap: defaultKeymapSettings("mac"),
      workspaceRoot: "/workspace",
    });

    expect(handled).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(actions.toggleBookmarkAtCursor).not.toHaveBeenCalled();
  });

  it("preserves workspace-gated git history shortcut consumption", () => {
    const actions = createActions();
    const event = keyboardEvent({ key: "h", metaKey: true, shiftKey: true });
    const keymap = {
      ...defaultKeymapSettings("mac"),
      "editor.showFileHistory": "Cmd+Shift+H",
    };

    const handled = handleWorkbenchManualShortcut({
      actions,
      event,
      keymap,
      workspaceRoot: null,
    });

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(actions.openFileHistory).not.toHaveBeenCalled();
  });

  it("runs language navigation shortcuts without registry feature gating", () => {
    const actions = createActions();
    const event = keyboardEvent({ key: "b", metaKey: true });

    const handled = handleWorkbenchManualShortcut({
      actions,
      event,
      keymap: defaultKeymapSettings("mac"),
      workspaceRoot: "/workspace",
    });

    expect(handled).toBe(true);
    expect(actions.goToDefinition).toHaveBeenCalledTimes(1);
  });
});

function createActions() {
  return {
    goToDeclaration: vi.fn(),
    goToDefinition: vi.fn(),
    goToImplementation: vi.fn(),
    goToSourceDefinition: vi.fn(),
    goToSuperMethod: vi.fn(),
    goToTestForActiveDocument: vi.fn(),
    goToTypeDefinition: vi.fn(),
    openFileHistory: vi.fn(),
    openFileReferencesPanel: vi.fn(),
    openLocalHistory: vi.fn(),
    openReferencesPanel: vi.fn(),
    runTestForActiveDocument: vi.fn(),
    toggleBookmarkAtCursor: vi.fn(),
    toggleGitBlame: vi.fn(),
  };
}

function keyboardEvent({
  altKey = false,
  ctrlKey = false,
  key,
  metaKey = false,
  shiftKey = false,
}: {
  altKey?: boolean;
  ctrlKey?: boolean;
  key: string;
  metaKey?: boolean;
  shiftKey?: boolean;
}): KeyboardEvent {
  return {
    altKey,
    ctrlKey,
    key,
    metaKey,
    preventDefault: vi.fn(),
    shiftKey,
  } as unknown as KeyboardEvent;
}
