import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentProviderManagementSurface } from "../application/useAgentProviderManagement";
import {
  useWorkbenchAppUpdaterComposition,
  type WorkbenchAppUpdaterComposition,
} from "../application/workbenchController/useWorkbenchAppUpdaterComposition";
import type { WorkbenchNotice } from "../application/workbenchNotice";
import { presentAppUpdateToast } from "../domain/appUpdater";
import type { SystemFontGateway } from "../domain/systemFonts";
import type { IntelligenceMode } from "../domain/workspace";
import {
  presentAgentProviderUpdateToast,
  type AgentProviderUpdateRefusalRecord,
} from "./agentProviderUpdateToastPresenter";
import { LazySurfaceHost, LazyWorkbenchSettingsDialogHost } from "./appLazySurfaces";
import { writeClipboardText } from "./clipboardText";
import { NoticeToastHost } from "./NoticeToastHost";
import { composeToastNotices } from "./updateToastNotices";
import { useNoticeToastRenderers } from "./useNoticeToastRenderers";
import type { WorkbenchSettingsModel } from "./WorkbenchSettingsDialogHost";
import type { NodeLaunchConfigurationFileGateway } from "./useNodeLaunchConfigurationsDialogController";

export interface WorkbenchAppUpdaterHostProps {
  readonly composition: WorkbenchAppUpdaterComposition;
  readonly onOpenAgentSettings: () => void;
  readonly onOpenRuntimePanel: () => void;
  readonly providerManagement: AgentProviderManagementSurface;
  readonly systemFontGateway: SystemFontGateway;
  readonly workbench: WorkbenchSettingsModel & {
    readonly installManagedPhpactor: () => Promise<void> | void;
    readonly installingManagedPhpactor: boolean;
    readonly intelligenceMode: IntelligenceMode;
    readonly notices: WorkbenchNotice[];
    readonly persistAppUpdaterSkippedVersion: (version: string) => Promise<void>;
    readonly setLanguageServerSetupOpen: (open: boolean) => void;
  };
  readonly workspaceFiles: NodeLaunchConfigurationFileGateway;
  readonly workspaceTrusted: boolean;
}

export function WorkbenchAppUpdaterHost({
  composition,
  onOpenAgentSettings,
  onOpenRuntimePanel,
  providerManagement,
  systemFontGateway,
  workbench,
  workspaceFiles,
  workspaceTrusted,
}: WorkbenchAppUpdaterHostProps) {
  const updater = useWorkbenchAppUpdaterComposition(
    composition,
    workbench.persistAppUpdaterSkippedVersion,
  );
  const { authority, providers, toast } = providerManagement;
  const [updateRefusal, setUpdateRefusal] = useState<AgentProviderUpdateRefusalRecord | null>(null);
  useEffect(() => {
    setUpdateRefusal(null);
  }, [toast]);
  const dismissUpdateRefusal = useCallback(() => setUpdateRefusal(null), []);
  const providerUpdate = useMemo(
    () => presentAgentProviderUpdateToast({ authority, providers, toast }, updateRefusal),
    [authority, providers, toast, updateRefusal],
  );
  const appUpdate = useMemo(() => presentAppUpdateToast(updater.state), [updater.state]);
  const notices = useMemo(
    () => composeToastNotices({ app: appUpdate, provider: providerUpdate }, workbench.notices),
    [appUpdate, providerUpdate, workbench.notices],
  );
  const { setLanguageServerSetupOpen } = workbench;
  const openLanguageServerSetup = useCallback(
    () => setLanguageServerSetupOpen(true),
    [setLanguageServerSetupOpen],
  );
  const renderNotice = useNoticeToastRenderers({
    appUpdate,
    appUpdater: updater,
    copyText: writeClipboardText,
    intelligenceMode: workbench.intelligenceMode,
    isInstallingManagedPhpactor: workbench.installingManagedPhpactor,
    onDismissUpdateRefusal: dismissUpdateRefusal,
    onInstallManagedPhpactor: workbench.installManagedPhpactor,
    onOpenAgentSettings,
    onOpenLanguageServerSetup: openLanguageServerSetup,
    onOpenRuntimePanel,
    onUpdateRefused: setUpdateRefusal,
    providerManagement,
    providerUpdate,
    workspaceRoot: workbench.workspaceRoot,
    workspaceTrusted,
  });
  return (
    <>
      <NoticeToastHost notices={notices} renderNotice={renderNotice} />
      <LazySurfaceHost
        active={workbench.settingsOpen || workbench.nodeLaunchConfigurationsOpen}
        label="settings"
      >
        <LazyWorkbenchSettingsDialogHost
          appUpdater={updater}
          providerManagement={providerManagement}
          systemFontGateway={systemFontGateway}
          workbench={workbench}
          workspaceFiles={workspaceFiles}
        />
      </LazySurfaceHost>
    </>
  );
}
