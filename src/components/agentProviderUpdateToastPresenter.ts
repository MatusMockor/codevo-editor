import type {
  AgentProviderManagementSurface,
  AgentProviderManagementView,
  AgentProviderUpdateRefusal,
} from "../application/useAgentProviderManagement";
import { compareAgentCliVersions, parseAgentCliVersion } from "../domain/agentCliVersion";
import type {
  AgentProviderHealthState,
  AgentProviderUpdateFailureReason,
} from "../domain/agentProviderHealth";
import type { AgentCliKind } from "../domain/agentSettings";
import { agentProviderLabel } from "./agentMode/agentSidebarPresentation";

declare const AGENT_PROVIDER_UPDATE_VERSION: unique symbol;

export type AgentProviderUpdateVersion = string & {
  readonly [AGENT_PROVIDER_UPDATE_VERSION]: "AgentProviderUpdateVersion";
};

export interface AgentProviderUpdateToastView {
  readonly provider: AgentCliKind;
  readonly availableVersion: AgentProviderUpdateVersion;
  readonly installedVersion?: AgentProviderUpdateVersion;
  readonly manual?: true;
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
      readonly kind: "alreadyCurrent";
      readonly provider: AgentCliKind;
      readonly installedVersion: AgentProviderUpdateVersion;
      readonly offeredVersion: AgentProviderUpdateVersion | null;
    }
  | {
      readonly kind: "failed";
      readonly provider: AgentCliKind;
      readonly reason: AgentProviderUpdateToastFailureReason | null;
      readonly outputTail: string;
      readonly installedVersion: string | null;
      readonly offeredVersion: AgentProviderUpdateVersion | null;
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
  installedVersion?: unknown,
): AgentProviderUpdateToastView | null {
  const available = parseUpdateVersion(availableVersion);
  if (!available) return null;
  const view = { availableVersion: available, provider, ...(manual ? { manual } : {}) };
  if (installedVersion === undefined || installedVersion === null) return view;

  const installed = parseUpdateVersion(installedVersion);
  if (!installed) return null;
  if (compareAgentCliVersions(installed, available) !== -1) return null;
  return { ...view, installedVersion: installed };
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
    case "alreadyCurrent":
      return JSON.stringify([
        "agent-provider-update-already-current",
        presentation.provider,
        presentation.installedVersion,
        presentation.offeredVersion,
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
      return "Update available";
    case "availableMany":
      return `${presentation.views.length} provider updates`;
    case "updating":
      return "Updating provider";
    case "updated":
      return `${agentProviderLabel(presentation.provider)} updated: v${presentation.version}`;
    case "alreadyCurrent":
      return `${agentProviderLabel(presentation.provider)} did not change version`;
    case "failed":
      return "Provider update failed";
    case "refused":
      return "Provider update not started";
    default:
      return unsupportedPresentation(presentation);
  }
}

export function agentProviderUpdateVersionTransition(view: AgentProviderUpdateToastView): {
  readonly from: string | null;
  readonly to: string;
} {
  const to = `v${view.availableVersion}`;
  if (view.installedVersion === undefined) return { from: null, to };
  return { from: `v${view.installedVersion}`, to };
}

export function agentProviderUpdateNoticeMessage(
  presentation: AgentProviderUpdateToastPresentation,
): string {
  switch (presentation.kind) {
    case "available":
      return `Update available: ${offeredUpdateLabel(presentation.view)}`;
    case "availableMany":
      return `${agentProviderUpdateToastTitle(presentation)}: ${presentation.views.map(offeredUpdateLabel).join(", ")}`;
    default:
      return agentProviderUpdateToastTitle(presentation);
  }
}

function offeredUpdateLabel(view: AgentProviderUpdateToastView): string {
  return `${agentProviderLabel(view.provider)} v${view.availableVersion}`;
}

export function oneClickAgentProviderUpdates(
  views: readonly AgentProviderUpdateToastView[],
): readonly AgentProviderUpdateToastView[] {
  return views.filter((view) => view.manual !== true);
}

export function agentProviderUpdateAllLabel(
  views: readonly AgentProviderUpdateToastView[],
): string | null {
  const oneClick = oneClickAgentProviderUpdates(views);
  if (oneClick.length === 0) return null;
  if (oneClick.length === views.length) return "Update all";
  if (oneClick.length === 1) return `Update ${agentProviderLabel(oneClick[0]!.provider)}`;
  return `Update ${oneClick.length}`;
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
    case "updateAlreadyCurrent":
      return presentAlreadyCurrent(source.providers[toast.provider], toast.provider, toast.version);
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
    case "operationSuperseded":
      return "Another provider update replaced this one.";
    case "authorityChanged":
      return "Provider settings changed while the update was starting.";
    case "executableChanged":
      return "The provider executable changed while the update was starting.";
    case "installerUnsupported":
      return "The detected installer cannot run this update.";
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
    case "statusUnknown":
      return "The provider status could not be refreshed.";
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

function presentAvailable(
  source: AgentProviderUpdateToastSource,
  provider: AgentCliKind,
  version: string,
  manual: true | undefined,
): AgentProviderUpdateToastPresentation | null {
  const offered = offeredUpdateView(provider, source.providers[provider].health, manual);
  const confirmed = offered?.availableVersion === version ? [offered] : [];
  const others = PROVIDER_ORDER.filter((candidate) => candidate !== provider)
    .map((candidate) => pendingUpdate(source, candidate))
    .filter((candidate): candidate is AgentProviderUpdateToastView => candidate !== null);
  const [first, ...rest] = [...confirmed, ...others].slice(0, MAX_MERGED_PROVIDER_UPDATES);
  if (first === undefined) return null;
  if (rest.length === 0) return { kind: "available", view: first };
  return { kind: "availableMany", views: [first, ...rest] };
}

function pendingUpdate(
  source: AgentProviderUpdateToastSource,
  provider: AgentCliKind,
): AgentProviderUpdateToastView | null {
  const view = source.providers[provider];
  if (view.updateState.kind !== "idle") return null;
  const authority = source.authority(provider);
  if (authority === null) return null;
  const offer = offeredUpdateView(provider, view.health, undefined);
  if (offer === null) return null;
  if (authority.preference.dismissedUpdateVersion === offer.availableVersion) return null;
  return offer;
}

function offeredUpdateView(
  provider: AgentCliKind,
  health: AgentProviderHealthState,
  manual: true | undefined,
): AgentProviderUpdateToastView | null {
  if (health.kind !== "ready") return null;
  const update = health.update;
  if (update.kind !== "available" && update.kind !== "manualUpdateAvailable") return null;
  const requiresManualUpdate = manual === true || update.kind === "manualUpdateAvailable";
  return createAgentProviderUpdateToastView(
    provider,
    update.availableVersion,
    requiresManualUpdate ? true : undefined,
    health.installedVersion,
  );
}

function presentAlreadyCurrent(
  view: AgentProviderManagementView,
  provider: AgentCliKind,
  version: string,
): AgentProviderUpdateToastPresentation | null {
  const installedVersion = parseUpdateVersion(version);
  if (!installedVersion) return null;
  const settled = view.updateState.kind === "alreadyCurrent" ? view.updateState : null;
  return {
    kind: "alreadyCurrent",
    provider,
    installedVersion,
    offeredVersion: parseUpdateVersion(settled?.offeredVersion ?? null),
  };
}

function presentFailed(
  view: AgentProviderManagementView,
  provider: AgentCliKind,
): AgentProviderUpdateToastPresentation {
  const failure = view.updateState.kind === "failed" ? view.updateState : null;
  const retryVersion = retryVersionFor(view);
  const attempted = parseUpdateVersion(failure?.attemptedVersion ?? null);
  return {
    kind: "failed",
    provider,
    reason: failure?.reason ?? null,
    outputTail: failure?.outputTail ?? "",
    installedVersion: view.health.kind === "ready" ? view.health.installedVersion : null,
    offeredVersion: attempted ?? retryVersion,
    retryVersion,
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
