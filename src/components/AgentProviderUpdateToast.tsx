import { Copy } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { agentCliInstallCommand } from "../domain/agentSettings";
import { AgentProviderGlyph } from "./agentMode/AgentProviderGlyph";
import { agentProviderLabel } from "./agentMode/agentSidebarPresentation";
import { writeClipboardText } from "./clipboardText";
import {
  agentProviderUpdateInstallerLabel,
  type AgentProviderUpdateToastDetails,
  type AgentProviderUpdateToastView,
} from "./agentProviderUpdateToastPresenter";
import { ToastMark, ToastNotification, type ToastNotificationAction } from "./ToastNotification";

interface AgentProviderUpdateToastProps {
  readonly onDismiss: () => void;
  readonly onOpenSettings: () => void;
  readonly onUpdate: () => void;
  readonly view: AgentProviderUpdateToastView;
}

export function AgentProviderUpdateToast({
  onDismiss,
  onOpenSettings,
  onUpdate,
  view,
}: AgentProviderUpdateToastProps): ReactElement {
  const provider = agentProviderLabel(view.provider);
  return (
    <ToastNotification
      actions={toastActions(view, { onOpenSettings, onUpdate })}
      description={view.manual ? `${provider} can be updated from provider settings.` : undefined}
      icon={
        <ToastMark badge={view.manual ? "manual" : "update"}>
          <AgentProviderGlyph decorative kind={view.provider} />
        </ToastMark>
      }
      meta={updateMeta(view.details)}
      onClose={onDismiss}
      template="info"
      title={`Update Available: ${provider} v${view.availableVersion}`}
    />
  );
}

function toastActions(
  view: AgentProviderUpdateToastView,
  handlers: Pick<AgentProviderUpdateToastProps, "onOpenSettings" | "onUpdate">,
): ToastNotificationAction[] {
  const settingsAction: ToastNotificationAction = {
    id: "settings",
    label: "Settings",
    onClick: handlers.onOpenSettings,
    tone: view.manual ? "primary" : "secondary",
  };
  if (!view.manual) {
    return [
      settingsAction,
      { id: "update", label: "Update", onClick: handlers.onUpdate, tone: "primary" },
    ];
  }
  return [
    {
      icon: <Copy aria-hidden="true" size={14} />,
      id: "copy-command",
      label: "Copy command",
      onClick: () => writeClipboardText(agentCliInstallCommand(view.provider)),
      placement: "leading",
      tone: "ghost",
    },
    settingsAction,
  ];
}

function updateMeta(details: AgentProviderUpdateToastDetails | undefined): readonly ReactNode[] {
  if (details === undefined) return [];
  return [
    details.installedVersion === null ? null : `Installed v${details.installedVersion}`,
    `via ${agentProviderUpdateInstallerLabel(details.installer)}`,
  ];
}
