import { useMemo } from "react";
import type { DirtyCloseDecisionPort } from "./dirtyCloseDecisionPort";
import type { WorkbenchPrompter } from "./workbenchPrompter";

export function useWorkbenchDirtyCloseDecisionPort(
  prompter: WorkbenchPrompter,
): DirtyCloseDecisionPort {
  return useMemo(
    () => ({
      decideDirtyClose: ({ documentNames, scope }) => {
        const message =
          scope === "workspace"
            ? "Close workspace and discard unsaved changes?"
            : scope === "quit"
              ? "Quit and discard unsaved changes?"
              : documentNames.length === 1
                ? "Discard changes?"
                : `Discard changes in ${documentNames.length} files?`;
        let confirmation: Promise<boolean> | boolean;
        try {
          confirmation = prompter.confirm(message);
        } catch {
          return Promise.resolve("cancel" as const);
        }
        if (typeof confirmation === "boolean") {
          return Promise.resolve(confirmation === true ? "discard" : "cancel");
        }
        return Promise.resolve(confirmation)
          .then((confirmed) => (confirmed === true ? "discard" : "cancel"))
          .catch(() => "cancel" as const);
      },
    }),
    [prompter],
  );
}
