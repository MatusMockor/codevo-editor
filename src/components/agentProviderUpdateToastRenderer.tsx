import type { ReactNode } from "react";
import type { WorkbenchNotice } from "../application/workbenchNotice";
import { parseAgentCliVersion } from "../domain/agentCliVersion";
import type { AgentCliKind } from "../domain/agentSettings";
import { AgentProviderUpdateToast } from "./AgentProviderUpdateToast";
import type { NoticeToastRenderer } from "./NoticeToastHost";

declare const AGENT_PROVIDER_UPDATE_VERSION: unique symbol;

export type AgentProviderUpdateVersion = string & {
  readonly [AGENT_PROVIDER_UPDATE_VERSION]: "AgentProviderUpdateVersion";
};

export interface AgentProviderUpdateToastView {
  readonly provider: AgentCliKind;
  readonly availableVersion: AgentProviderUpdateVersion;
}

export interface AgentProviderUpdateToastCallbacks {
  readonly onDismiss: (
    provider: AgentCliKind,
    availableVersion: AgentProviderUpdateVersion,
  ) => Promise<boolean>;
  readonly onOpenSettings: () => void;
  readonly onUpdate: (
    provider: AgentCliKind,
    availableVersion: AgentProviderUpdateVersion,
  ) => Promise<boolean>;
}

export interface AgentProviderUpdateToastRendererContext {
  readonly callbacks: AgentProviderUpdateToastCallbacks;
  readonly view: AgentProviderUpdateToastView | null;
}

export type AgentProviderUpdateToastRendererFactoryResult = [string, NoticeToastRenderer];

export function createAgentProviderUpdateToastView(
  provider: AgentCliKind,
  availableVersion: unknown,
): AgentProviderUpdateToastView | null {
  const parsedVersion = parseAgentCliVersion(availableVersion);

  if (!parsedVersion) return null;
  if (parsedVersion !== availableVersion) return null;

  return {
    availableVersion: parsedVersion as AgentProviderUpdateVersion,
    provider,
  };
}

export function agentProviderUpdateNoticeGroupKey(
  provider: AgentCliKind,
  availableVersion: string,
): string {
  return JSON.stringify(["agent-provider-update", provider, availableVersion]);
}

export function agentProviderUpdateToastRenderer(
  context: AgentProviderUpdateToastRendererContext,
): AgentProviderUpdateToastRendererFactoryResult | null {
  const view = context.view;

  if (!view) return null;

  const groupKey = agentProviderUpdateNoticeGroupKey(view.provider, view.availableVersion);

  return [
    groupKey,
    (notice: WorkbenchNotice, actions): ReactNode => {
      if (notice.groupKey !== groupKey) return null;

      return (
        <AgentProviderUpdateToast
          onDismiss={() => {
            dismissAfterSuccessfulAction(
              () => context.callbacks.onDismiss(view.provider, view.availableVersion),
              actions.dismiss,
            );
          }}
          onOpenSettings={() => {
            context.callbacks.onOpenSettings();
            actions.dismiss();
          }}
          onUpdate={() => {
            dismissAfterSuccessfulAction(
              () => context.callbacks.onUpdate(view.provider, view.availableVersion),
              actions.dismiss,
            );
          }}
          view={view}
        />
      );
    },
  ];
}

function dismissAfterSuccessfulAction(action: () => Promise<boolean>, dismiss: () => void): void {
  void action()
    .then((succeeded) => {
      if (!succeeded) return;
      dismiss();
    })
    .catch(() => undefined);
}
