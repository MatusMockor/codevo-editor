import type { AgentProviderManagementSurface } from "../application/useAgentProviderManagement";
import type { AgentCliKind } from "../domain/agentSettings";
import type {
  AgentProviderUpdateRefusalRecord,
  AgentProviderUpdateToastView,
  AgentProviderUpdateVersion,
} from "./agentProviderUpdateToastPresenter";

export type AgentProviderUpdateToastPort = Pick<
  AgentProviderManagementSurface,
  "authority" | "dismissToast" | "dismissUpdate" | "providers" | "save" | "update"
>;

export interface AgentProviderUpdateToastCallbackDependencies {
  readonly copyText: (text: string) => void;
  readonly onOpenAgentSettings: () => void;
  readonly onUpdateRefused: (refusal: AgentProviderUpdateRefusalRecord) => void;
  readonly readManagement: () => AgentProviderUpdateToastPort;
}

export interface AgentProviderUpdateNoticeToastCallbacks {
  readonly onCopyError: (text: string) => void;
  readonly onDismiss: (
    provider: AgentCliKind,
    availableVersion: AgentProviderUpdateVersion,
  ) => Promise<boolean>;
  readonly onDismissAll: (views: readonly AgentProviderUpdateToastView[]) => Promise<boolean>;
  readonly onDismissToast: () => void;
  readonly onOpenSettings: () => void;
  readonly onUpdate: (
    provider: AgentCliKind,
    availableVersion: AgentProviderUpdateVersion,
  ) => Promise<boolean>;
  readonly onUpdateAll: (views: readonly AgentProviderUpdateToastView[]) => Promise<void>;
}

export function createAgentProviderUpdateToastCallbacks(
  dependencies: AgentProviderUpdateToastCallbackDependencies,
): AgentProviderUpdateNoticeToastCallbacks {
  const management = dependencies.readManagement;

  const update = async (
    provider: AgentCliKind,
    version: AgentProviderUpdateVersion,
  ): Promise<boolean> => {
    const refusal = await management().update(provider, version);
    if (refusal === null) return true;
    dependencies.onUpdateRefused({ provider, version, refusal });
    return false;
  };

  const persistDismissal = async (view: AgentProviderUpdateToastView): Promise<boolean> => {
    const port = management();
    if (await port.dismissUpdate(view.provider, view.availableVersion)) return true;
    const authority = port.authority(view.provider);
    if (authority === null) return false;
    if (authority.preference.dismissedUpdateVersion === view.availableVersion) return true;
    return port.save({
      provider: view.provider,
      preference: { ...authority.preference, dismissedUpdateVersion: view.availableVersion },
    });
  };

  return {
    onCopyError: dependencies.copyText,
    onDismiss: (provider, version) => management().dismissUpdate(provider, version),
    onDismissAll: async (views) => {
      let persisted = false;
      for (const view of views) {
        const succeeded = await persistDismissal(view).catch(() => false);
        persisted = persisted || succeeded;
      }
      if (!persisted) management().dismissToast();
      return true;
    },
    onDismissToast: () => management().dismissToast(),
    onOpenSettings: () => {
      management().dismissToast();
      dependencies.onOpenAgentSettings();
    },
    onUpdate: update,
    onUpdateAll: async (views) => {
      for (const view of views) {
        const started = await update(view.provider, view.availableVersion);
        if (!started) return;
        const outcome = management().providers[view.provider].updateState;
        if (outcome.kind !== "succeeded") return;
      }
    },
  };
}
