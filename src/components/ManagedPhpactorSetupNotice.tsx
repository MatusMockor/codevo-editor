import type { ReactElement } from "react";
import type { ReactNode } from "react";
import { ToastNotification } from "./ToastNotification";
import { shouldStartLanguageServer } from "../domain/intelligence";
import type {
  NoticeToastRendererFactory,
} from "../application/useNoticeToastRenderers";

export const managedPhpactorSetupNoticeToastRenderer: NoticeToastRendererFactory = (
  context,
) => {
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
          window.setTimeout(() => {
            context.onInstallManagedPhpactor();
          }, 0);
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

export function managedPhpactorSetupNoticeGroupKey(
  workspaceRoot: string | null,
): string | null {
  return workspaceRoot ? `phpactor-setup:${workspaceRoot}` : null;
}

interface ManagedPhpactorSetupNoticeProps {
  onDismiss: () => void;
  onInstallNow: () => void;
  onOpenManualSetup: () => void;
  isInstalling: boolean;
}

export function ManagedPhpactorSetupNotice({
  onDismiss,
  onInstallNow,
  onOpenManualSetup,
  isInstalling,
}: ManagedPhpactorSetupNoticeProps): ReactElement {
  return (
    <ToastNotification
      actions={[
        {
          id: "manual-install",
          label: "Manual install",
          onClick: onOpenManualSetup,
          tone: "secondary",
        },
        {
          id: "install-now",
          disabled: isInstalling,
          isBusy: isInstalling,
          label: isInstalling ? "Installing..." : "Install now",
          onClick: onInstallNow,
          tone: "primary",
        },
      ]}
      description={
        <>
          Install the managed PHP IDE engine (one-click user-profile bootstrap, not
          bundled) to enable hover,
          <br />
          completion, definition, and implementation support.
          {isInstalling ? (
            <>
              <br />
              <span className="toast-install-progress-note">
                Installing now; keep this open to monitor progress.
              </span>
            </>
          ) : null}
        </>
      }
      onClose={onDismiss}
      template="warning"
      title="PHP IDE Engine missing"
    />
  );
}
