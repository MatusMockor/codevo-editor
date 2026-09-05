import type {
  AgentProviderManagementSurface,
  AgentProviderManagementView,
  AgentProviderUpdateRefusal,
} from "../application/useAgentProviderManagement";
import { parseAgentCliVersion } from "../domain/agentCliVersion";
import type {
  AgentProviderInstaller,
  AgentProviderUpdateFailureReason,
} from "../domain/agentProviderHealth";
import type { AgentCliKind } from "../domain/agentSettings";
import { agentProviderLabel } from "./agentMode/agentSidebarPresentation";

declare const AGENT_PROVIDER_UPDATE_VERSION: unique symbol;

export type AgentProviderUpdateVersion = string & {
  readonly [AGENT_PROVIDER_UPDATE_VERSION]: "AgentProviderUpdateVersion";
};

export type AgentProviderUpdateInstallerKind = AgentProviderInstaller["kind"];

export interface AgentProviderUpdateToastDetails {
  readonly installedVersion: string | null;
  readonly installer: AgentProviderUpdateInstallerKind;
}

export interface AgentProviderUpdateToastView {
  readonly provider: AgentCliKind;
  readonly availableVersion: AgentProviderUpdateVersion;
  readonly manual?: true;
  readonly details?: AgentProviderUpdateToastDetails;
}

export type AgentProviderUpdateToastFailureReason =
  AgentProviderUpdateFailureReason | "versionMismatch";

export type AgentProviderUpdateToastPresentation =
  | { readonly kind: "available"; readonly view: AgentProviderUpdateToastView }
  | {
      readonly kind: "availableMany";
      readonly views: readonly [AgentProviderUpdateToastView, ...AgentProviderUpdateToastView[]];
    }
  | { readonly kind: "updating"; readonly provider: AgentCliKind; readonly operationId: string }
  | {
      readonly kind: "updated";
      readonly provider: AgentCliKind;
      readonly version: AgentProviderUpdateVersion;
    }
  | {
      readonly kind: "failed";
      readonly provider: AgentCliKind;
      readonly reason: AgentProviderUpdateToastFailureReason | null;
      readonly outputTail: string;
      readonly installedVersion: string | null;
      readonly retryVersion: AgentProviderUpdateVersion | null;
    }
  | {
      readonly kind: "refused";
      readonly provider: AgentCliKind;
      readonly version: AgentProviderUpdateVersion;
      readonly refusal: AgentProviderUpdateRefusal;
    };

export interface AgentProviderUpdateRefusalRecord {
  readonly provider: AgentCliKind;
  readonly version: AgentProviderUpdateVersion;
  readonly refusal: AgentProviderUpdateRefusal;
}

export type AgentProviderUpdateToastSource = Pick<
  AgentProviderManagementSurface,
  "authority" | "providers" | "toast"
>;

const PROVIDER_ORDER: readonly AgentCliKind[] = ["claudeCode", "codex"];

export const MAX_MERGED_PROVIDER_UPDATES = PROVIDER_ORDER.length;

export function createAgentProviderUpdateToastView(
  provider: AgentCliKind,
  availableVersion: unknown,
  manual?: true,
  details?: AgentProviderUpdateToastDetails,
): AgentProviderUpdateToastView | null {
  const parsedVersion = parseAgentCliVersion(availableVersion);

  if (!parsedVersion) return null;
  if (parsedVersion !== availableVersion) return null;

  return {
    availableVersion: parsedVersion as AgentProviderUpdateVersion,
    provider,
    ...(manual ? { manual } : {}),
    ...(details ? { details } : {}),
  };
}

export function agentProviderUpdateNoticeGroupKey(
  provider: AgentCliKind,
  availableVersion: string,
): string {
  return JSON.stringify(["agent-provider-update", provider, availableVersion]);
}

export function agentProviderUpdateToastGroupKey(
  presentation: AgentProviderUpdateToastPresentation,
): string {
  switch (presentation.kind) {
    case "available":
      return agentProviderUpdateNoticeGroupKey(
        presentation.view.provider,
        presentation.view.availableVersion,
      );
    case "availableMany":
      return JSON.stringify([
        "agent-provider-updates",
        ...presentation.views.map((view) => `${view.provider}@${view.availableVersion}`),
      ]);
    case "updating":
      return JSON.stringify([
        "agent-provider-updating",
        presentation.provider,
        presentation.operationId,
      ]);
    case "updated":
      return JSON.stringify([
        "agent-provider-updated",
        presentation.provider,
        presentation.version,
      ]);
    case "failed":
      return JSON.stringify(["agent-provider-update-failed", presentation.provider]);
    case "refused":
      return JSON.stringify([
        "agent-provider-update-refused",
        presentation.provider,
        presentation.version,
        presentation.refusal,
      ]);
    default:
      return unsupportedPresentation(presentation);
  }
}

export function agentProviderUpdateToastTitle(
  presentation: AgentProviderUpdateToastPresentation,
): string {
  switch (presentation.kind) {
    case "available":
      return `Update Available: ${agentProviderLabel(presentation.view.provider)} v${presentation.view.availableVersion}`;
    case "availableMany":
      return `Updates Available: ${presentation.views.length} providers`;
    case "updating":
      return "Updating provider";
    case "updated":
      return `${agentProviderLabel(presentation.provider)} updated: v${presentation.version}`;
    case "failed":
      return "Provider update failed";
    case "refused":
      return "Provider update not started";
    default:
      return unsupportedPresentation(presentation);
  }
}

export function presentAgentProviderUpdateToast(
  source: AgentProviderUpdateToastSource,
  refusal: AgentProviderUpdateRefusalRecord | null = null,
): AgentProviderUpdateToastPresentation | null {
  const updating = firstUpdatingProvider(source.providers);
  if (updating) return updating;
  if (refusal) return { kind: "refused", ...refusal };

  const toast = source.toast;
  if (!toast) return null;

  switch (toast.kind) {
    case "updateAvailable":
      return presentAvailable(source, toast.provider, toast.version, toast.manual);
    case "updateSucceeded": {
      const version = parseUpdateVersion(toast.version);
      if (!version) return null;
      return { kind: "updated", provider: toast.provider, version };
    }
    case "updateFailed":
      return presentFailed(source.providers[toast.provider], toast.provider);
    default:
      return unsupportedToast(toast);
  }
}

export function agentProviderUpdateFailureSentence(
  reason: AgentProviderUpdateToastFailureReason | null,
): string {
  switch (reason) {
    case null:
      return "Check provider settings for details.";
    case "admissionRefused":
      return "The update was refused by the provider policy.";
    case "spawnFailed":
      return "The installer could not be started.";
    case "timedOut":
      return "The installer timed out.";
    case "outputLimitExceeded":
      return "The installer produced too much output.";
    case "exited":
      return "The installer exited with an error.";
    case "uncertain":
      return "The installer result could not be verified.";
    case "versionNotAdvanced":
      return "The installed version did not change.";
    case "versionMismatch":
      return "The installed version does not match the offered update.";
    default:
      return unsupportedReason(reason);
  }
}

export function agentProviderUpdateRefusalSentence(refusal: AgentProviderUpdateRefusal): string {
  switch (refusal) {
    case "disabled":
      return "The provider is disabled.";
    case "notConfigured":
      return "The provider CLI path is not configured.";
    case "policyUnavailable":
      return "The provider policy is not registered yet.";
    case "noUpdateAvailable":
      return "The offered update is no longer available.";
    case "turnActive":
      return "A provider turn is running.";
    case "signInActive":
      return "A provider sign-in is running.";
    case "alreadyUpdating":
      return "A provider update is already running.";
    default:
      return unsupportedRefusal(refusal);
  }
}

export function agentProviderUpdateInstallerLabel(
  installer: AgentProviderUpdateInstallerKind,
): string {
  switch (installer) {
    case "npm":
      return "npm";
    case "homebrew":
      return "Homebrew";
    case "selfUpdate":
      return "built-in updater";
    case "unknown":
      return "unknown";
    default:
      return unsupportedInstaller(installer);
  }
}

function presentAvailable(
  source: AgentProviderUpdateToastSource,
  provider: AgentCliKind,
  version: string,
  manual: true | undefined,
): AgentProviderUpdateToastPresentation | null {
  const view = createAgentProviderUpdateToastView(
    provider,
    version,
    manual,
    detailsFor(source.providers[provider]),
  );
  if (!view) return null;
  if (manual) return { kind: "available", view };

  const others = PROVIDER_ORDER.filter((candidate) => candidate !== provider)
    .map((candidate) => pendingOneClickUpdate(source, candidate))
    .filter((candidate): candidate is AgentProviderUpdateToastView => candidate !== null);
  if (others.length === 0) return { kind: "available", view };

  return {
    kind: "availableMany",
    views: [view, ...others.slice(0, MAX_MERGED_PROVIDER_UPDATES - 1)],
  };
}

function pendingOneClickUpdate(
  source: AgentProviderUpdateToastSource,
  provider: AgentCliKind,
): AgentProviderUpdateToastView | null {
  const view = source.providers[provider];
  if (view.health.kind !== "ready") return null;
  if (view.health.update.kind !== "available") return null;
  if (view.updateState.kind !== "idle") return null;
  const authority = source.authority(provider);
  if (authority === null) return null;
  if (authority.preference.dismissedUpdateVersion === view.health.update.availableVersion) {
    return null;
  }
  return createAgentProviderUpdateToastView(
    provider,
    view.health.update.availableVersion,
    undefined,
    detailsFor(view),
  );
}

function presentFailed(
  view: AgentProviderManagementView,
  provider: AgentCliKind,
): AgentProviderUpdateToastPresentation {
  const failure = view.updateState.kind === "failed" ? view.updateState : null;
  return {
    kind: "failed",
    provider,
    reason: failure?.reason ?? null,
    outputTail: failure?.outputTail ?? "",
    installedVersion: view.health.kind === "ready" ? view.health.installedVersion : null,
    retryVersion: retryVersionFor(view),
  };
}

function retryVersionFor(view: AgentProviderManagementView): AgentProviderUpdateVersion | null {
  if (view.health.kind !== "ready") return null;
  if (view.health.update.kind !== "available") return null;
  return parseUpdateVersion(view.health.update.availableVersion);
}

function firstUpdatingProvider(
  providers: AgentProviderUpdateToastSource["providers"],
): AgentProviderUpdateToastPresentation | null {
  for (const provider of PROVIDER_ORDER) {
    const state = providers[provider].updateState;
    if (state.kind !== "starting" && state.kind !== "running") continue;
    return { kind: "updating", provider, operationId: state.operationId };
  }
  return null;
}

function detailsFor(view: AgentProviderManagementView): AgentProviderUpdateToastDetails {
  if (view.health.kind !== "ready") return { installedVersion: null, installer: "unknown" };
  return {
    installedVersion: view.health.installedVersion,
    installer:
      view.health.update.kind === "available" ? view.health.update.installer.kind : "unknown",
  };
}

function parseUpdateVersion(value: unknown): AgentProviderUpdateVersion | null {
  const parsed = parseAgentCliVersion(value);
  if (!parsed) return null;
  if (parsed !== value) return null;
  return parsed as AgentProviderUpdateVersion;
}

function unsupportedPresentation(presentation: never): never {
  throw new TypeError(`Unsupported update toast presentation: ${String(presentation)}.`);
}

function unsupportedToast(toast: never): never {
  throw new TypeError(`Unsupported provider toast: ${String(toast)}.`);
}

function unsupportedRefusal(refusal: never): never {
  throw new TypeError(`Unsupported update refusal: ${String(refusal)}.`);
}

function unsupportedReason(reason: never): never {
  throw new TypeError(`Unsupported update failure reason: ${String(reason)}.`);
}

function unsupportedInstaller(installer: never): never {
  throw new TypeError(`Unsupported installer: ${String(installer)}.`);
}
