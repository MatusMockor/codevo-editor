import { useCallback, useMemo, useRef } from "react";
import type { AppUpdaterSurface } from "../application/useAppUpdater";
import type { WorkbenchNotice } from "../application/workbenchNotice";
import type { AppUpdateToastPresentation } from "../domain/appUpdater";
import type { IntelligenceMode } from "../domain/workspace";
import {
  createAgentProviderUpdateToastCallbacks,
  type AgentProviderUpdateToastPort,
} from "./agentProviderUpdateToastCallbacks";
import type {
  AgentProviderUpdateRefusalRecord,
  AgentProviderUpdateToastPresentation,
} from "./agentProviderUpdateToastPresenter";
import { agentProviderUpdateNoticeToastRenderer } from "./agentProviderUpdateToastRenderer";
import { appUpdateToastRenderer } from "./appUpdateToastRenderer";
import {
  languageServerCrashNoticeToastRenderer,
  languageServerRequestErrorNoticeToastRenderer,
} from "./LanguageServerCrashNotice";
import { managedPhpactorSetupNoticeToastRenderer } from "./managedPhpactorSetupNoticeToastRenderer";
import type { NoticeToastRenderer } from "./NoticeToastHost";

export interface NoticeToastRendererContext {
  intelligenceMode: IntelligenceMode;
  onInstallManagedPhpactor: () => Promise<void> | void;
  isInstallingManagedPhpactor: boolean;
  onOpenLanguageServerSetup: () => void;
  onOpenRuntimePanel: () => void;
  workspaceRoot: string | null;
  workspaceTrusted: boolean;
  appUpdate: AppUpdateToastPresentation | null;
  appUpdater: Pick<
    AppUpdaterSurface,
    "check" | "dismiss" | "download" | "installAndRestart" | "skipVersion"
  >;
  copyText: (text: string) => void;
  onDismissUpdateRefusal: () => void;
  onOpenAgentSettings: () => void;
  onUpdateRefused: (refusal: AgentProviderUpdateRefusalRecord) => void;
  providerManagement: AgentProviderUpdateToastPort;
  providerUpdate: AgentProviderUpdateToastPresentation | null;
}

export interface NoticeToastRendererFactoryContext extends NoticeToastRendererContext {
  readonly readProviderManagement: () => AgentProviderUpdateToastPort;
}

export type NoticeToastRendererFactoryResult = [string, NoticeToastRenderer];

export type NoticeToastRendererFactory = (
  context: NoticeToastRendererFactoryContext,
) => NoticeToastRendererFactoryResult | null;

const noticeToastRendererFactories: NoticeToastRendererFactory[] = [
  managedPhpactorSetupNoticeToastRenderer,
  (context) =>
    languageServerCrashNoticeToastRenderer({
      onOpenRuntimePanel: context.onOpenRuntimePanel,
      workspaceRoot: context.workspaceRoot,
    }),
  (context) =>
    languageServerRequestErrorNoticeToastRenderer({
      workspaceRoot: context.workspaceRoot,
    }),
  (context) =>
    agentProviderUpdateNoticeToastRenderer({
      callbacks: createAgentProviderUpdateToastCallbacks({
        copyText: context.copyText,
        onOpenAgentSettings: context.onOpenAgentSettings,
        onUpdateRefused: context.onUpdateRefused,
        readManagement: context.readProviderManagement,
      }),
      onDismissRefusal: context.onDismissUpdateRefusal,
      presentation: context.providerUpdate,
    }),
  (context) =>
    appUpdateToastRenderer({ presentation: context.appUpdate, updater: context.appUpdater }),
];

export function useNoticeToastRenderers(context: NoticeToastRendererContext): NoticeToastRenderer {
  const {
    intelligenceMode,
    onInstallManagedPhpactor,
    isInstallingManagedPhpactor,
    onOpenLanguageServerSetup,
    onOpenRuntimePanel,
    workspaceRoot,
    workspaceTrusted,
    appUpdate,
    appUpdater,
    copyText,
    onDismissUpdateRefusal,
    onOpenAgentSettings,
    onUpdateRefused,
    providerManagement,
    providerUpdate,
  } = context;
  const providerManagementRef = useRef(providerManagement);
  providerManagementRef.current = providerManagement;
  const readProviderManagement = useCallback(() => providerManagementRef.current, []);

  const noticeRenderers = useMemo(() => {
    const factoryContext: NoticeToastRendererFactoryContext = {
      intelligenceMode,
      onInstallManagedPhpactor,
      isInstallingManagedPhpactor,
      onOpenLanguageServerSetup,
      onOpenRuntimePanel,
      workspaceRoot,
      workspaceTrusted,
      appUpdate,
      appUpdater,
      copyText,
      onDismissUpdateRefusal,
      onOpenAgentSettings,
      onUpdateRefused,
      providerManagement,
      providerUpdate,
      readProviderManagement,
    };

    const map = new Map<string, NoticeToastRenderer>();

    for (const factory of noticeToastRendererFactories) {
      const entry = factory(factoryContext);

      if (!entry) continue;

      const [groupKey, renderer] = entry;
      map.set(groupKey, renderer);
    }

    return map;
  }, [
    intelligenceMode,
    onInstallManagedPhpactor,
    isInstallingManagedPhpactor,
    onOpenLanguageServerSetup,
    onOpenRuntimePanel,
    workspaceRoot,
    workspaceTrusted,
    appUpdate,
    appUpdater,
    copyText,
    onDismissUpdateRefusal,
    onOpenAgentSettings,
    onUpdateRefused,
    providerManagement,
    providerUpdate,
    readProviderManagement,
  ]);

  return useCallback(
    (notice: WorkbenchNotice, actions) => {
      if (!notice.groupKey) return null;
      return noticeRenderers.get(notice.groupKey)?.(notice, actions) ?? null;
    },
    [noticeRenderers],
  );
}
