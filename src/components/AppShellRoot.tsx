import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { CommandExecutionRunner } from "../application/commandRegistry";
import type { KeymapSettings } from "../domain/keymap";
import { appShellClassName } from "./appShellClassName";
import { appShellTypeScaleStyle } from "./appShellTypeScale";
import {
  SecondaryEditorKeymapContext,
  useSecondaryEditorKeymapBinding,
} from "./secondaryEditorKeymap/secondaryEditorKeymapContext";
import { ToastStackPortalContext } from "./toastStackPortal";

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
  const [toastStack, setToastStack] = useState<HTMLDivElement | null>(null);
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
        <ToastStackPortalContext.Provider value={toastStack}>
          {children}
        </ToastStackPortalContext.Provider>
      </SecondaryEditorKeymapContext.Provider>
      <div className="toast-stack" ref={setToastStack} />
    </main>
  );
}
