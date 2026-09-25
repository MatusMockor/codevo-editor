import { createContext, useLayoutEffect, useMemo, useRef } from "react";
import type { CommandExecutionRunner } from "../../application/commandRegistry";
import { createSecondaryEditorCommandRunner } from "../../application/secondaryEditorCommandRunner";
import type { KeymapSettings } from "../../domain/keymap";

export interface SecondaryEditorKeymapBinding {
  readonly keymap: KeymapSettings;
  readonly runCommand: CommandExecutionRunner;
}

export const SecondaryEditorKeymapContext = createContext<SecondaryEditorKeymapBinding | null>(
  null,
);

export function useSecondaryEditorKeymapBinding(
  keymap: KeymapSettings,
  runCommand: CommandExecutionRunner,
  hasWorkspace: boolean,
): SecondaryEditorKeymapBinding {
  const latestRef = useRef({ hasWorkspace, runCommand });
  useLayoutEffect(() => {
    latestRef.current = { hasWorkspace, runCommand };
  }, [hasWorkspace, runCommand]);

  return useMemo(
    () => ({
      keymap,
      runCommand: createSecondaryEditorCommandRunner(
        (commandId, context) => latestRef.current.runCommand(commandId, context),
        () => latestRef.current.hasWorkspace,
      ),
    }),
    [keymap],
  );
}
