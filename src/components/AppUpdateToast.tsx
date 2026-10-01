import type { ReactElement } from "react";
import { appUpdateNotesSpanSummary } from "../domain/appUpdateNotes";
import { appUpdateToastTitle, type AppUpdateToastPresentation } from "../domain/appUpdater";
import { ToastMark, ToastNotification, type ToastNotificationAction } from "./ToastNotification";

const APP_ICON_URL = `${import.meta.env.BASE_URL}app-icon.png`;

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
            { id: "download", label: "Update", onClick: onDownload, tone: "primary" },
          ]}
          description="Download and prepare the update now. You can restart later."
          icon={
            <ToastMark badge="update">
              <AppMark />
            </ToastMark>
          }
          meta={[
            `Installed v${presentation.currentVersion}`,
            presentation.date ? `Released ${presentation.date}` : null,
            appUpdateNotesSpanSummary(presentation.notesSpan),
          ]}
          onClose={onDismiss}
          template="info"
          title={appUpdateToastTitle(presentation)}
        />
      );
    case "downloading":
      return (
        <ToastNotification
          description={`Downloading and preparing Codevo v${presentation.version}.`}
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
    case "readyToRestart":
      return (
        <ToastNotification
          actions={[
            laterAction(onDismiss),
            { id: "restart", label: "Restart", onClick: onInstall, tone: "primary" },
          ]}
          description={`Update ${presentation.version} installed. Restart now or use it next time you open Codevo.`}
          icon={
            <ToastMark badge="check">
              <AppMark />
            </ToastMark>
          }
          meta={["Any running tasks will be interrupted if you restart now."]}
          onClose={onDismiss}
          template="success"
          title={appUpdateToastTitle(presentation)}
        />
      );
    case "readyToRestartOutdated":
      return (
        <ToastNotification
          actions={[
            laterAction(onDismiss),
            { id: "restart", label: "Restart", onClick: onInstall, tone: "primary" },
          ]}
          description={`Update ${presentation.version} is installed and applies on restart. Codevo v${presentation.supersededBy.version} is newer and is offered once you have restarted.`}
          icon={
            <ToastMark badge="update">
              <AppMark />
            </ToastMark>
          }
          meta={[
            `Codevo v${presentation.supersededBy.version} is the newest release`,
            presentation.supersededBy.date ? `Released ${presentation.supersededBy.date}` : null,
          ]}
          onClose={onDismiss}
          template="info"
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
    <img
      alt=""
      className="toast-notification__app-icon"
      draggable={false}
      height={16}
      src={APP_ICON_URL}
      width={16}
    />
  );
}

function unsupportedPresentation(presentation: never): never {
  throw new TypeError(`Unsupported application update toast: ${String(presentation)}.`);
}
