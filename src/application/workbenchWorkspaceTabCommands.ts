import type { KeymapCommandId } from "../domain/keymap";
import type { Command } from "./commandRegistry";

interface WorkbenchWorkspaceTabCommandsOptions {
  activateWorkspaceTab: (root: string) => unknown;
  activeWorkspaceRoot: string | null;
  shortcut(commandId: KeymapCommandId): string;
  workspaceTabs: readonly string[];
}

export function nextWorkspaceRoot(
  tabs: readonly string[],
  activeRoot: string | null,
): string | null {
  if (tabs.length === 0) {
    return null;
  }

  const activeIndex = activeRoot === null ? -1 : tabs.indexOf(activeRoot);

  if (activeIndex === -1) {
    return tabs[0];
  }

  return tabs[(activeIndex + 1) % tabs.length];
}

export function previousWorkspaceRoot(
  tabs: readonly string[],
  activeRoot: string | null,
): string | null {
  if (tabs.length === 0) {
    return null;
  }

  const activeIndex = activeRoot === null ? -1 : tabs.indexOf(activeRoot);

  if (activeIndex === -1) {
    return tabs[0];
  }

  return tabs[(activeIndex - 1 + tabs.length) % tabs.length];
}

export function workbenchWorkspaceTabCommands({
  activateWorkspaceTab,
  activeWorkspaceRoot,
  shortcut,
  workspaceTabs,
}: WorkbenchWorkspaceTabCommandsOptions): Command[] {
  const canCycleWorkspaceTabs = workspaceTabs.length >= 2;

  const activateRoot = (root: string | null) => {
    if (!canCycleWorkspaceTabs || root === null) {
      return;
    }

    void activateWorkspaceTab(root);
  };

  return [
    {
      id: "workspace.nextTab",
      title: "Next Workspace Tab",
      category: "Workspace",
      shortcut: shortcut("workspace.nextTab"),
      isEnabled: () => canCycleWorkspaceTabs,
      run: () =>
        activateRoot(nextWorkspaceRoot(workspaceTabs, activeWorkspaceRoot)),
    },
    {
      id: "workspace.previousTab",
      title: "Previous Workspace Tab",
      category: "Workspace",
      shortcut: shortcut("workspace.previousTab"),
      isEnabled: () => canCycleWorkspaceTabs,
      run: () =>
        activateRoot(previousWorkspaceRoot(workspaceTabs, activeWorkspaceRoot)),
    },
  ];
}
