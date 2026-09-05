import type { ReactNode } from "react";
import type { AppUpdaterSurface } from "../application/useAppUpdater";
import type { WorkbenchNotice } from "../application/workbenchNotice";
import { appUpdateToastGroupKey, type AppUpdateToastPresentation } from "../domain/appUpdater";
import { AppUpdateToast } from "./AppUpdateToast";
import type { NoticeToastRenderer } from "./NoticeToastHost";

export interface AppUpdateToastRendererContext {
  readonly presentation: AppUpdateToastPresentation | null;
  readonly updater: Pick<
    AppUpdaterSurface,
    "check" | "dismiss" | "download" | "installAndRestart" | "skipVersion"
  >;
}

export function appUpdateToastRenderer(
  context: AppUpdateToastRendererContext,
): [string, NoticeToastRenderer] | null {
  const presentation = context.presentation;
  if (!presentation) return null;

  const groupKey = appUpdateToastGroupKey(presentation);
  const updater = context.updater;

  return [
    groupKey,
    (notice: WorkbenchNotice): ReactNode => {
      if (notice.groupKey !== groupKey) return null;

      return (
        <AppUpdateToast
          onDismiss={updater.dismiss}
          onDownload={() => void updater.download()}
          onInstall={() => void updater.installAndRestart()}
          onRetry={() => void updater.check()}
          onSkipVersion={() => void updater.skipVersion()}
          presentation={presentation}
        />
      );
    },
  ];
}
