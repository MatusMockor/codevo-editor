import type { ReactElement } from "react";
import { appUpdateToastTitle, type AppUpdateToastPresentation } from "../domain/appUpdater";
import { ToastMark, ToastNotification, type ToastNotificationAction } from "./ToastNotification";

export interface AppUpdateToastProps {
  readonly onDismiss: () => void;
  readonly onDownload: () => void;
  readonly onInstall: () => void;
  readonly onRetry: () => void;
  readonly onSkipVersion: () => void;
  readonly presentation: AppUpdateToastPresentation;
}

export function AppUpdateToast({
  onDismiss,
  onDownload,
  onInstall,
  onRetry,
  onSkipVersion,
  presentation,
}: AppUpdateToastProps): ReactElement {
  switch (presentation.kind) {
    case "available":
      return (
        <ToastNotification
          actions={[
            {
              id: "skip",
              label: "Skip version",
              onClick: onSkipVersion,
              placement: "leading",
              tone: "ghost",
            },
            laterAction(onDismiss),
            { id: "download", label: "Download", onClick: onDownload, tone: "primary" },
          ]}
          description="Download the update now or review it later in Settings."
          icon={
            <ToastMark badge="update">
              <AppMark />
            </ToastMark>
          }
          meta={[
            `Installed v${presentation.currentVersion}`,
            presentation.date ? `Released ${presentation.date}` : null,
          ]}
          onClose={onDismiss}
          template="info"
          title={appUpdateToastTitle(presentation)}
        />
      );
    case "downloading":
      return (
        <ToastNotification
          description={`Downloading Codevo v${presentation.version}.`}
          template="loading"
          title={appUpdateToastTitle(presentation)}
        />
      );
    case "readyToInstall":
      return (
        <ToastNotification
          actions={[
            laterAction(onDismiss),
            { id: "restart", label: "Restart", onClick: onInstall, tone: "primary" },
          ]}
          description={`Update ${presentation.version} downloaded. Click to restart and install.`}
          icon={
            <ToastMark badge="check">
              <AppMark />
            </ToastMark>
          }
          meta={["Any running tasks will be interrupted."]}
          onClose={onDismiss}
          template="success"
          title={appUpdateToastTitle(presentation)}
        />
      );
    case "installing":
      return (
        <ToastNotification
          description={`Codevo will restart to finish installing v${presentation.version}.`}
          template="loading"
          title={appUpdateToastTitle(presentation)}
        />
      );
    case "failed":
      return (
        <ToastNotification
          actions={[{ id: "retry", label: "Retry", onClick: onRetry, tone: "primary" }]}
          description={presentation.message}
          meta={[`Codevo v${presentation.version}`]}
          onClose={onDismiss}
          template="error"
          title={appUpdateToastTitle(presentation)}
        />
      );
    default:
      return unsupportedPresentation(presentation);
  }
}

function laterAction(onDismiss: () => void): ToastNotificationAction {
  return { id: "later", label: "Later", onClick: onDismiss, tone: "secondary" };
}

function AppMark(): ReactElement {
  return (
    <svg aria-hidden="true" height={16} viewBox="0 0 16 16" width={16}>
      <rect
        fill="none"
        height="13.2"
        rx="3.6"
        stroke="var(--toast-brand, currentColor)"
        strokeWidth="1.5"
        width="13.2"
        x="1.4"
        y="1.4"
      />
      <rect fill="currentColor" height="7.6" opacity="0.65" rx="0.5" width="1.8" x="4" y="4.2" />
      <path
        d="M8.4 4.9 10.6 8l-2.2 3.1"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function unsupportedPresentation(presentation: never): never {
  throw new TypeError(`Unsupported application update toast: ${String(presentation)}.`);
}
