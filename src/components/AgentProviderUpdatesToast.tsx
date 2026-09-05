import { Copy } from "lucide-react";
import { useEffect, useRef, type ReactElement } from "react";
import type { AgentCliKind } from "../domain/agentSettings";
import { AgentProviderGlyph } from "./agentMode/AgentProviderGlyph";
import { agentProviderLabel } from "./agentMode/agentSidebarPresentation";
import {
  agentProviderUpdateFailureSentence,
  agentProviderUpdateInstallerLabel,
  agentProviderUpdateRefusalSentence,
  agentProviderUpdateToastGroupKey,
  agentProviderUpdateToastTitle,
  type AgentProviderUpdateToastPresentation,
  type AgentProviderUpdateToastView,
  type AgentProviderUpdateVersion,
} from "./agentProviderUpdateToastPresenter";
import { ToastMark, ToastNotification, type ToastNotificationAction } from "./ToastNotification";

export const AGENT_PROVIDER_UPDATED_TOAST_VISIBLE_MS = 8_000;

export type AgentProviderUpdatesToastPresentation = Exclude<
  AgentProviderUpdateToastPresentation,
  { readonly kind: "available" }
>;

export interface AgentProviderUpdatesToastProps {
  readonly onCopyError: (text: string) => void;
  readonly onDismiss: () => void;
  readonly onOpenSettings: () => void;
  readonly onRetry: (provider: AgentCliKind, version: AgentProviderUpdateVersion) => void;
  readonly onUpdateAll: (views: readonly AgentProviderUpdateToastView[]) => void;
  readonly presentation: AgentProviderUpdatesToastPresentation;
}

export function AgentProviderUpdatesToast({
  onCopyError,
  onDismiss,
  onOpenSettings,
  onRetry,
  onUpdateAll,
  presentation,
}: AgentProviderUpdatesToastProps): ReactElement {
  const autoHideKey =
    presentation.kind === "updated" ? agentProviderUpdateToastGroupKey(presentation) : null;
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (autoHideKey === null) return;
    const timer = window.setTimeout(
      () => onDismissRef.current(),
      AGENT_PROVIDER_UPDATED_TOAST_VISIBLE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [autoHideKey]);

  switch (presentation.kind) {
    case "availableMany":
      return (
        <ToastNotification
          actions={[
            { id: "settings", label: "Settings", onClick: onOpenSettings, tone: "secondary" },
            {
              id: "update-all",
              label: "Update all",
              onClick: () => onUpdateAll(presentation.views),
              tone: "primary",
            },
          ]}
          description="Install the updates now or review provider settings."
          icon={
            <ToastMark badge="update">
              <AgentProviderGlyph decorative kind={presentation.views[0].provider} />
            </ToastMark>
          }
          meta={presentation.views.map((view) => (
            <span key={view.provider}>
              {agentProviderLabel(view.provider)} v{view.availableVersion}
              {view.details ? (
                <>
                  {" "}
                  <code>{agentProviderUpdateInstallerLabel(view.details.installer)}</code>
                </>
              ) : null}
            </span>
          ))}
          onClose={onDismiss}
          template="info"
          title={agentProviderUpdateToastTitle(presentation)}
        />
      );
    case "updating":
      return (
        <ToastNotification
          description="Running provider update command."
          meta={[agentProviderLabel(presentation.provider)]}
          onClose={onDismiss}
          template="loading"
          title={agentProviderUpdateToastTitle(presentation)}
        />
      );
    case "updated":
      return (
        <ToastNotification
          description="New sessions will use the updated provider."
          icon={
            <ToastMark badge="check">
              <AgentProviderGlyph decorative kind={presentation.provider} />
            </ToastMark>
          }
          onClose={onDismiss}
          template="success"
          title={agentProviderUpdateToastTitle(presentation)}
        />
      );
    case "failed":
      return (
        <ToastNotification
          actions={failedActions(presentation, { onCopyError, onOpenSettings, onRetry })}
          description={`${agentProviderLabel(presentation.provider)} failed to update. Check provider settings for details.`}
          meta={[
            agentProviderUpdateFailureSentence(presentation.reason),
            presentation.installedVersion ? `still on v${presentation.installedVersion}` : null,
          ]}
          onClose={onDismiss}
          template="error"
          title={agentProviderUpdateToastTitle(presentation)}
        />
      );
    case "refused":
      return (
        <ToastNotification
          actions={[
            { id: "settings", label: "Settings", onClick: onOpenSettings, tone: "secondary" },
          ]}
          description={`${agentProviderLabel(presentation.provider)} v${presentation.version} was not updated. ${agentProviderUpdateRefusalSentence(presentation.refusal)}`}
          onClose={onDismiss}
          template="warning"
          title={agentProviderUpdateToastTitle(presentation)}
        />
      );
    default:
      return unsupportedPresentation(presentation);
  }
}

function failedActions(
  presentation: Extract<AgentProviderUpdatesToastPresentation, { readonly kind: "failed" }>,
  handlers: Pick<AgentProviderUpdatesToastProps, "onCopyError" | "onOpenSettings" | "onRetry">,
): ToastNotificationAction[] {
  const actions: ToastNotificationAction[] = [];
  const errorText = failureClipboardText(presentation);
  if (errorText.length > 0) {
    actions.push({
      icon: <Copy aria-hidden="true" size={14} />,
      id: "copy-error",
      label: "Copy error",
      onClick: () => handlers.onCopyError(errorText),
      placement: "leading",
      tone: "ghost",
    });
  }
  actions.push({
    id: "settings",
    label: "Settings",
    onClick: handlers.onOpenSettings,
    tone: "secondary",
  });
  const retryVersion = presentation.retryVersion;
  if (retryVersion !== null) {
    actions.push({
      id: "retry",
      label: "Retry",
      onClick: () => handlers.onRetry(presentation.provider, retryVersion),
      tone: "primary",
    });
  }
  return actions;
}

function failureClipboardText(
  presentation: Extract<AgentProviderUpdatesToastPresentation, { readonly kind: "failed" }>,
): string {
  const lines = [
    `${agentProviderLabel(presentation.provider)} update failed: ${agentProviderUpdateFailureSentence(presentation.reason)}`,
  ];
  if (presentation.outputTail.length > 0) lines.push(presentation.outputTail);
  return lines.join("\n");
}

function unsupportedPresentation(presentation: never): never {
  throw new TypeError(`Unsupported provider update toast: ${String(presentation)}.`);
}
