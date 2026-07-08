import { shouldIndexWorkspace } from "../domain/intelligence";
import type { IndexProgressState } from "../domain/indexProgress";
import type { IntelligenceMode } from "../domain/workspace";
import type { Command } from "./commandRegistry";

interface WorkbenchIndexCommandsOptions {
  indexProgress: IndexProgressState;
  intelligenceMode: IntelligenceMode;
  startHardReindex: Command["run"];
  startIndexScan: Command["run"];
  startPhpReindex: Command["run"];
}

export function workbenchIndexCommands({
  indexProgress,
  intelligenceMode,
  startHardReindex,
  startIndexScan,
  startPhpReindex,
}: WorkbenchIndexCommandsOptions): Command[] {
  return [
    {
      id: "index.reindexSoft",
      title: "Soft Reindex Workspace",
      category: "Index",
      isEnabled: (context) =>
        context.hasWorkspace &&
        shouldIndexWorkspace(intelligenceMode) &&
        indexProgress.status !== "scanning",
      run: startIndexScan,
    },
    {
      id: "index.reindexPhp",
      title: "Reindex PHP Symbols",
      category: "Index",
      isEnabled: (context) =>
        context.hasWorkspace &&
        shouldIndexWorkspace(intelligenceMode) &&
        indexProgress.status !== "scanning",
      run: startPhpReindex,
    },
    {
      id: "index.reindexHard",
      title: "Hard Rebuild Index",
      category: "Index",
      isEnabled: (context) =>
        context.hasWorkspace &&
        shouldIndexWorkspace(intelligenceMode) &&
        indexProgress.status !== "scanning",
      run: startHardReindex,
    },
  ];
}
