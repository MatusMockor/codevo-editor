import { Copy } from "lucide-react";
import type { ReactElement } from "react";
import { agentCliInstallCommand } from "../domain/agentSettings";
import { AgentProviderGlyph } from "./agentMode/AgentProviderGlyph";
import { agentProviderLabel } from "./agentMode/agentSidebarPresentation";
import { AgentProviderUpdateRows } from "./AgentProviderUpdateRows";
import { writeClipboardText } from "./clipboardText";
import {
  agentProviderUpdateToastTitle,
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
  return (
    <ToastNotification
      actions={toastActions(view, { onOpenSettings, onUpdate })}
      body={<AgentProviderUpdateRows views={[view]} />}
      description={
        view.manual
          ? `${agentProviderLabel(view.provider)} can be updated from provider settings.`
          : undefined
      }
      icon={
        <ToastMark badge={view.manual ? "manual" : "update"}>
          <AgentProviderGlyph decorative kind={view.provider} />
        </ToastMark>
      }
      onClose={onDismiss}
      template="info"
      title={agentProviderUpdateToastTitle({ kind: "available", view })}
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
