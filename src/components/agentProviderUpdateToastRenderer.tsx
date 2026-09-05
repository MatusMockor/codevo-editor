import type { ReactNode } from "react";
import type { WorkbenchNotice } from "../application/workbenchNotice";
import type { AgentCliKind } from "../domain/agentSettings";
import { AgentProviderUpdateToast } from "./AgentProviderUpdateToast";
import type { AgentProviderUpdateNoticeToastCallbacks } from "./agentProviderUpdateToastCallbacks";
import {
  agentProviderUpdateNoticeGroupKey,
  agentProviderUpdateToastGroupKey,
  type AgentProviderUpdateToastPresentation,
  type AgentProviderUpdateToastView,
  type AgentProviderUpdateVersion,
} from "./agentProviderUpdateToastPresenter";
import { AgentProviderUpdatesToast } from "./AgentProviderUpdatesToast";
import type { NoticeToastRenderer } from "./NoticeToastHost";

export type {
  AgentProviderUpdateToastView,
  AgentProviderUpdateVersion,
} from "./agentProviderUpdateToastPresenter";
export type { AgentProviderUpdateNoticeToastCallbacks } from "./agentProviderUpdateToastCallbacks";

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

export interface AgentProviderUpdateNoticeToastRendererContext {
  readonly callbacks: AgentProviderUpdateNoticeToastCallbacks;
  readonly onDismissRefusal: () => void;
  readonly presentation: AgentProviderUpdateToastPresentation | null;
}

export type AgentProviderUpdateToastRendererFactoryResult = [string, NoticeToastRenderer];

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

export function agentProviderUpdateNoticeToastRenderer(
  context: AgentProviderUpdateNoticeToastRendererContext,
): AgentProviderUpdateToastRendererFactoryResult | null {
  const presentation = context.presentation;
  if (!presentation) return null;
  if (presentation.kind === "available") {
    return agentProviderUpdateToastRenderer({
      callbacks: context.callbacks,
      view: presentation.view,
    });
  }

  const groupKey = agentProviderUpdateToastGroupKey(presentation);
  const callbacks = context.callbacks;

  return [
    groupKey,
    (notice: WorkbenchNotice, actions): ReactNode => {
      if (notice.groupKey !== groupKey) return null;

      return (
        <AgentProviderUpdatesToast
          onCopyError={callbacks.onCopyError}
          onDismiss={() => dismissPresentation(presentation, context, actions.dismiss)}
          onOpenSettings={() => {
            callbacks.onOpenSettings();
            actions.dismiss();
          }}
          onRetry={(provider, version) => {
            void callbacks.onUpdate(provider, version).catch(() => undefined);
          }}
          onUpdateAll={(views) => {
            void callbacks.onUpdateAll(views).catch(() => undefined);
          }}
          presentation={presentation}
        />
      );
    },
  ];
}

function dismissPresentation(
  presentation: Exclude<AgentProviderUpdateToastPresentation, { readonly kind: "available" }>,
  context: AgentProviderUpdateNoticeToastRendererContext,
  dismiss: () => void,
): void {
  switch (presentation.kind) {
    case "availableMany":
      dismissAfterSuccessfulAction(
        () => context.callbacks.onDismissAll(presentation.views),
        dismiss,
      );
      return;
    case "updating":
      dismiss();
      return;
    case "refused":
      context.onDismissRefusal();
      dismiss();
      return;
    case "updated":
    case "failed":
      context.callbacks.onDismissToast();
      dismiss();
      return;
    default:
      unsupportedPresentation(presentation);
  }
}

function dismissAfterSuccessfulAction(action: () => Promise<boolean>, dismiss: () => void): void {
  void action()
    .then((succeeded) => {
      if (!succeeded) return;
      dismiss();
    })
    .catch(() => undefined);
}

function unsupportedPresentation(presentation: never): never {
  throw new TypeError(`Unsupported provider update toast: ${String(presentation)}.`);
}
