import { useMemo, type CSSProperties, type ReactNode } from "react";
import type { CommandExecutionRunner } from "../application/commandRegistry";
import type { KeymapSettings } from "../domain/keymap";
import { appShellClassName } from "./appShellClassName";
import { appShellTypeScaleStyle } from "./appShellTypeScale";
import {
  SecondaryEditorKeymapContext,
  useSecondaryEditorKeymapBinding,
} from "./secondaryEditorKeymap/secondaryEditorKeymapContext";

interface AppShellRootWorkbench {
  readonly agentModeActive: boolean;
  readonly appSettings: {
    readonly agentThreadFontSize: unknown;
    readonly keymap: KeymapSettings;
  };
  readonly runCommand: CommandExecutionRunner;
  readonly settingsOpen: boolean;
  readonly workspaceRoot: string | null;
}

interface AppShellRootProps {
  readonly children: ReactNode;
  readonly colorScheme: string;
  readonly shellStyle: CSSProperties;
  readonly workbench: AppShellRootWorkbench;
}

export function AppShellRoot({ children, colorScheme, shellStyle, workbench }: AppShellRootProps) {
  const { agentThreadFontSize, keymap } = workbench.appSettings;
  const style = useMemo(
    () => appShellTypeScaleStyle(agentThreadFontSize, shellStyle),
    [agentThreadFontSize, shellStyle],
  );
  const secondaryEditorKeymap = useSecondaryEditorKeymapBinding(
    keymap,
    workbench.runCommand,
    Boolean(workbench.workspaceRoot),
  );

  return (
    <main
      className={appShellClassName(workbench.agentModeActive, workbench.settingsOpen)}
      data-theme={colorScheme}
      style={style}
    >
      <SecondaryEditorKeymapContext.Provider value={secondaryEditorKeymap}>
        {children}
      </SecondaryEditorKeymapContext.Provider>
    </main>
  );
}
