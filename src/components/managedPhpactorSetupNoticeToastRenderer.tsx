import type { ReactNode } from "react";
import { shouldStartLanguageServer } from "../domain/intelligence";
import { ManagedPhpactorSetupNotice } from "./ManagedPhpactorSetupNotice";
import type { NoticeToastRendererFactory } from "./useNoticeToastRenderers";

export const managedPhpactorSetupNoticeToastRenderer: NoticeToastRendererFactory = (context) => {
  const noticeGroupKey = managedPhpactorSetupNoticeGroupKey(context.workspaceRoot);

  if (
    !noticeGroupKey ||
    !context.workspaceTrusted ||
    !shouldStartLanguageServer(context.intelligenceMode)
  ) {
    return null;
  }

  return [
    noticeGroupKey,
    (_notice, actions): ReactNode => (
      <ManagedPhpactorSetupNotice
        onDismiss={actions.dismiss}
        onInstallNow={() => {
          window.setTimeout(() => context.onInstallManagedPhpactor(), 0);
        }}
        onOpenManualSetup={() => {
          actions.dismiss();
          context.onOpenLanguageServerSetup();
        }}
        isInstalling={context.isInstallingManagedPhpactor}
      />
    ),
  ];
};

export function managedPhpactorSetupNoticeGroupKey(workspaceRoot: string | null): string | null {
  return workspaceRoot ? `phpactor-setup:${workspaceRoot}` : null;
}
