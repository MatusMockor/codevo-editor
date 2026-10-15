import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { appShellClassName } from "./appShellClassName";
import { appShellTypeScaleStyle } from "./appShellTypeScale";
import { ToastStackPortalContext } from "./toastStackPortal";

interface AppShellRootWorkbench {
  readonly appSettings: {
    readonly agentThreadFontSize: unknown;
  };
  readonly settingsOpen: boolean;
}

interface AppShellRootProps {
  readonly children: ReactNode;
  readonly colorScheme: string;
  readonly shellStyle: CSSProperties;
  readonly workbench: AppShellRootWorkbench;
}

export function AppShellRoot({ children, colorScheme, shellStyle, workbench }: AppShellRootProps) {
  const { agentThreadFontSize } = workbench.appSettings;
  const [toastStack, setToastStack] = useState<HTMLDivElement | null>(null);
  const style = useMemo(
    () => appShellTypeScaleStyle(agentThreadFontSize, shellStyle),
    [agentThreadFontSize, shellStyle],
  );

  return (
    <main
      className={appShellClassName(workbench.settingsOpen)}
      data-theme={colorScheme}
      style={style}
    >
      <ToastStackPortalContext.Provider value={toastStack}>
        {children}
      </ToastStackPortalContext.Provider>
      <div className="toast-stack" ref={setToastStack} />
    </main>
  );
}
