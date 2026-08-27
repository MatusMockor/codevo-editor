import type { ReactElement } from "react";
import type { AgentCliKind } from "../domain/agentSettings";
import type { AgentProviderUpdateToastView } from "./agentProviderUpdateToastRenderer";
import { ToastNotification } from "./ToastNotification";

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
      actions={[
        {
          id: "settings",
          label: "Settings",
          onClick: onOpenSettings,
          tone: "secondary",
        },
        {
          id: "update",
          label: "Update",
          onClick: onUpdate,
          tone: "primary",
        },
      ]}
      onClose={onDismiss}
      template="info"
      title={`Update available: ${providerLabel(view.provider)} v${view.availableVersion}`}
    />
  );
}

function providerLabel(provider: AgentCliKind): string {
  switch (provider) {
    case "claudeCode":
      return "Claude Code";
    case "codex":
      return "Codex";
    default: {
      const exhaustiveProvider: never = provider;
      return exhaustiveProvider;
    }
  }
}
