import {
  matchesShortcut,
  shortcutForCommand,
  type KeymapCommandId,
  type KeymapSettings,
} from "../domain/keymap";

type ShortcutAction = () => unknown;

interface WorkbenchManualShortcutActions {
  saveActiveDocument: ShortcutAction;
  closeActiveSurface: ShortcutAction;
  openFileStructure: ShortcutAction;
  toggleBookmarkAtCursor: ShortcutAction;
  toggleGitBlame: ShortcutAction;
  openFileHistory: ShortcutAction;
  openLocalHistory: ShortcutAction;
  goToDefinition: ShortcutAction;
  goToSourceDefinition: ShortcutAction;
  goToDeclaration: ShortcutAction;
  goToTypeDefinition: ShortcutAction;
  goToImplementation: ShortcutAction;
  goToSuperMethod: ShortcutAction;
  goToTestForActiveDocument: ShortcutAction;
  runTestForActiveDocument: ShortcutAction;
  openReferencesPanel: ShortcutAction;
  openFileReferencesPanel: ShortcutAction;
}

interface HandleWorkbenchManualShortcutOptions {
  actions: WorkbenchManualShortcutActions;
  event: KeyboardEvent;
  keymap: KeymapSettings;
  workspaceRoot: string | null;
}

export function handleWorkbenchManualShortcut({
  actions,
  event,
  keymap,
  workspaceRoot,
}: HandleWorkbenchManualShortcutOptions): boolean {
  const matches = (commandId: KeymapCommandId) =>
    matchesShortcut(event, shortcutForCommand(keymap, commandId));

  // Keep these shortcuts local until their command-palette enablement exactly
  // matches the legacy keyboard behavior. The registry dispatcher consumes
  // disabled shortcuts, so moving a command too early can turn a
  // no-op-but-handled key into a skipped action.
  if (matches("editor.save")) {
    return consume(event, actions.saveActiveDocument);
  }

  if (matches("editor.closeTab")) {
    return consume(event, actions.closeActiveSurface);
  }

  if (matches("editor.fileStructure")) {
    return consume(event, actions.openFileStructure);
  }

  if (matches("bookmark.toggle")) {
    return consume(event, actions.toggleBookmarkAtCursor);
  }

  if (matches("editor.toggleGitBlame")) {
    return consumeWhenWorkspacePresent(
      event,
      workspaceRoot,
      actions.toggleGitBlame,
    );
  }

  if (matches("editor.showFileHistory")) {
    return consumeWhenWorkspacePresent(
      event,
      workspaceRoot,
      actions.openFileHistory,
    );
  }

  if (matches("editor.showLocalHistory")) {
    return consumeWhenWorkspacePresent(
      event,
      workspaceRoot,
      actions.openLocalHistory,
    );
  }

  if (matches("editor.goToDefinition")) {
    return consume(event, actions.goToDefinition);
  }

  if (matches("editor.goToSourceDefinition")) {
    return consume(event, actions.goToSourceDefinition);
  }

  if (matches("editor.goToDeclaration")) {
    return consume(event, actions.goToDeclaration);
  }

  if (matches("editor.goToTypeDefinition")) {
    return consume(event, actions.goToTypeDefinition);
  }

  if (matches("editor.goToImplementation")) {
    return consume(event, actions.goToImplementation);
  }

  if (matches("editor.goToSuperMethod")) {
    return consume(event, actions.goToSuperMethod);
  }

  if (matches("php.goToTest")) {
    return consume(event, actions.goToTestForActiveDocument);
  }

  if (matches("php.runTest")) {
    return consume(event, actions.runTestForActiveDocument);
  }

  if (matches("editor.findReferences")) {
    return consume(event, actions.openReferencesPanel);
  }

  if (matches("editor.findFileReferences")) {
    return consume(event, actions.openFileReferencesPanel);
  }

  return false;
}

function consume(event: KeyboardEvent, action: ShortcutAction): true {
  event.preventDefault();
  void action();
  return true;
}

function consumeWhenWorkspacePresent(
  event: KeyboardEvent,
  workspaceRoot: string | null,
  action: ShortcutAction,
): true {
  event.preventDefault();

  if (workspaceRoot) {
    void action();
  }

  return true;
}
