import type { KeymapCommandId } from "../domain/keymap";
import type { Command } from "./commandRegistry";

interface WorkbenchProblemNavigationCommandsOptions {
  shortcut(commandId: KeymapCommandId): string;
  goToNextProblem: () => unknown;
  goToPreviousProblem: () => unknown;
}

export function workbenchProblemNavigationCommands({
  shortcut,
  goToNextProblem,
  goToPreviousProblem,
}: WorkbenchProblemNavigationCommandsOptions): Command[] {
  return [
    {
      id: "editor.nextProblem",
      title: "Go to Next Problem",
      category: "Editor",
      shortcut: shortcut("editor.nextProblem"),
      isEnabled: () => true,
      run: fireAndForget(goToNextProblem),
    },
    {
      id: "editor.previousProblem",
      title: "Go to Previous Problem",
      category: "Editor",
      shortcut: shortcut("editor.previousProblem"),
      isEnabled: () => true,
      run: fireAndForget(goToPreviousProblem),
    },
  ];
}

function fireAndForget(run: () => unknown): Command["run"] {
  return () => {
    void run();
  };
}
