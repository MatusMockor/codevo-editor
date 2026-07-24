import { useMemo } from "react";
import type { DirtyCloseDecisionPort } from "./dirtyCloseDecisionPort";
import type { WorkbenchPrompter } from "./workbenchPrompter";

export function useWorkbenchDirtyCloseDecisionPort(
  prompter: WorkbenchPrompter,
): DirtyCloseDecisionPort {
  return useMemo(
    () => ({
      decideDirtyClose: async ({ documentNames, scope }) =>
        prompter.confirm(
          scope === "workspace"
            ? "Close workspace and discard unsaved changes?"
            : scope === "quit"
              ? "Quit and discard unsaved changes?"
              : documentNames.length === 1
                ? "Discard changes?"
                : `Discard changes in ${documentNames.length} files?`,
        )
          ? "discard"
          : "cancel",
    }),
    [prompter],
  );
}
