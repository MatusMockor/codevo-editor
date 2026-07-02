import { useCallback, useMemo } from "react";
import type { WorkbenchNotice } from "./workbenchNotice";
import type { IntelligenceMode } from "../domain/workspace";
import { languageServerCrashNoticeToastRenderer } from "../components/LanguageServerCrashNotice";
import { managedPhpactorSetupNoticeToastRenderer } from "../components/ManagedPhpactorSetupNotice";
import type { NoticeToastRenderer } from "../components/NoticeToastHost";

export interface NoticeToastRendererContext {
  intelligenceMode: IntelligenceMode;
  onInstallManagedPhpactor: () => Promise<void> | void;
  isInstallingManagedPhpactor: boolean;
  onOpenLanguageServerSetup: () => void;
  onOpenRuntimePanel: () => void;
  workspaceRoot: string | null;
  workspaceTrusted: boolean;
}

export type NoticeToastRendererFactoryResult = [string, NoticeToastRenderer];

export type NoticeToastRendererFactory = (
  context: NoticeToastRendererContext,
) => NoticeToastRendererFactoryResult | null;

const noticeToastRendererFactories: NoticeToastRendererFactory[] = [
  managedPhpactorSetupNoticeToastRenderer,
  (context) =>
    languageServerCrashNoticeToastRenderer({
      onOpenRuntimePanel: context.onOpenRuntimePanel,
      workspaceRoot: context.workspaceRoot,
    }),
];

export function useNoticeToastRenderers({
  intelligenceMode,
  onInstallManagedPhpactor,
  isInstallingManagedPhpactor,
  onOpenLanguageServerSetup,
  onOpenRuntimePanel,
  workspaceRoot,
  workspaceTrusted,
}: NoticeToastRendererContext): NoticeToastRenderer {
  const noticeRenderers = useMemo(() => {
    const context: NoticeToastRendererContext = {
      intelligenceMode,
      onInstallManagedPhpactor,
      isInstallingManagedPhpactor,
      onOpenLanguageServerSetup,
      onOpenRuntimePanel,
      workspaceRoot,
      workspaceTrusted,
    };

    const map = new Map<string, NoticeToastRenderer>();

    for (const factory of noticeToastRendererFactories) {
      const entry = factory(context);

      if (!entry) {
        continue;
      }

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
  ]);

  return useCallback(
    (notice: WorkbenchNotice, actions) => {
      if (!notice.groupKey) {
        return null;
      }

      return noticeRenderers.get(notice.groupKey)?.(notice, actions) ?? null;
    },
    [noticeRenderers],
  );
}
