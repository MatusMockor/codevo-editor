import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import type { AppUpdaterSurface } from "../../application/useAppUpdater";
import { presentAppUpdateToast } from "../../domain/appUpdater";
import type { SystemFontGateway } from "../../domain/systemFonts";
import type { WorkbenchNotice } from "../../domain/workbenchNotice";
import {
  presentAgentProviderUpdateToast,
  type AgentProviderUpdateRefusalRecord,
} from "../agentProviderUpdateToastPresenter";
import { writeClipboardText } from "../clipboardText";
import { NoticeToastHost } from "../NoticeToastHost";
import { composeToastNotices } from "../updateToastNotices";
import { useNoticeToastRenderers } from "../useNoticeToastRenderers";
import { AgentSettingsHost, type AgentSettingsModel } from "./AgentSettingsHost";

export interface AgentOverlayDialogsHostProps {
  readonly appUpdater: AppUpdaterSurface;
  readonly notices: readonly WorkbenchNotice[];
  readonly onOpenAgentSettings: () => void;
  readonly providerManagement: AgentProviderManagementSurface;
  readonly settings: AgentSettingsModel;
  readonly settingsContainer: HTMLElement | null;
  readonly systemFontGateway: SystemFontGateway;
}

export function AgentOverlayDialogsHost({
  appUpdater,
  notices: workbenchNotices,
  onOpenAgentSettings,
  providerManagement,
  settings,
  settingsContainer,
  systemFontGateway,
}: AgentOverlayDialogsHostProps) {
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
  const appUpdate = useMemo(() => presentAppUpdateToast(appUpdater.state), [appUpdater.state]);
  const notices = useMemo(
    () => composeToastNotices({ app: appUpdate, provider: providerUpdate }, workbenchNotices),
    [appUpdate, providerUpdate, workbenchNotices],
  );
  const renderNotice = useNoticeToastRenderers({
    appUpdate,
    appUpdater,
    copyText: writeClipboardText,
    onDismissUpdateRefusal: dismissUpdateRefusal,
    onOpenAgentSettings,
    onUpdateRefused: setUpdateRefusal,
    providerManagement,
    providerUpdate,
  });
  return (
    <>
      <NoticeToastHost notices={notices} renderNotice={renderNotice} />
      <AgentSettingsHost
        appUpdater={appUpdater}
        container={settingsContainer}
        model={settings}
        providerManagement={providerManagement}
        systemFontGateway={systemFontGateway}
      />
    </>
  );
}
