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
      run: normalizeCompletion(goToNextProblem),
    },
    {
      id: "editor.previousProblem",
      title: "Go to Previous Problem",
      category: "Editor",
      shortcut: shortcut("editor.previousProblem"),
      isEnabled: () => true,
      run: normalizeCompletion(goToPreviousProblem),
    },
  ];
}

function normalizeCompletion(run: () => unknown): Command["run"] {
  return async () => {
    await run();
  };
}
