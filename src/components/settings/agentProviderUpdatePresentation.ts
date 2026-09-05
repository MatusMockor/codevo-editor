import type { AgentProviderManagementView } from "../../application/useAgentProviderManagement";
import {
  agentProviderSelfUpdateCommandLabel,
  type AgentProviderHealthState,
  type AgentProviderInstaller,
  type AgentProviderUpdateAvailability,
  type AgentProviderUpdateState,
} from "../../domain/agentProviderHealth";
import type { AgentCliKind } from "../../domain/agentSettings";
import { providerLabel, unsupportedProviderValue } from "./agentProviderCardPresentation";

export type AgentProviderAvailableUpdate = Extract<
  AgentProviderUpdateAvailability,
  { readonly kind: "available" }
>;

export interface AgentProviderResultPresentation {
  readonly tone: "neutral" | "success" | "danger";
  readonly role: "status" | "alert";
  readonly message: string;
  readonly outputTail: string;
  readonly outputTruncated: boolean;
}

export function availableUpdate(
  health: AgentProviderHealthState,
): AgentProviderAvailableUpdate | null {
  if (health.kind !== "ready") return null;
  if (health.update.kind !== "available") return null;

  return health.update;
}

export function providerUpdating(view: AgentProviderManagementView): boolean {
  return view.updateState.kind === "starting" || view.updateState.kind === "running";
}

export function providerUpdateAvailabilityMessage(health: AgentProviderHealthState): string | null {
  if (health.kind !== "ready") return null;

  switch (health.update.kind) {
    case "checksDisabled":
      return "Update checks are disabled in the current provider policy. Refresh the provider settings.";
    case "manualUpdateAvailable":
      return `Version ${health.update.availableVersion} is available (installed: ${health.update.installedVersion}). Update this CLI with its original installer, then Refresh. Automatic installation is not available for this installation.`;
    case "available":
      return `Update available: install v${health.update.availableVersion}.`;
    case "checking":
      return null;
    case "current":
      return "Up to date.";
    case "unavailable":
      return updateUnavailableMessage(health.update.reason);
    default:
      return unsupportedProviderValue(health.update, "provider update availability");
  }
}

export function providerUpdateBlockedReason(
  provider: AgentCliKind,
  view: AgentProviderManagementView,
  available: AgentProviderAvailableUpdate | null,
  enabled: boolean,
  signingIn: boolean,
): string | null {
  if (!enabled) return `Enable ${providerLabel(provider)} first.`;
  if (available === null) return "No update is available.";
  if (view.policy.kind !== "registered") return "Register the provider policy first.";
  if (view.liveTurnCount > 0) return `Stop running ${providerLabel(provider)} turns first.`;
  if (signingIn || view.signInActive === true) {
    return `Wait for ${providerLabel(provider)} sign-in to finish.`;
  }
  if (providerUpdating(view)) return "The provider is already updating.";

  return null;
}

export function providerManualUpdateCommand(installer: AgentProviderInstaller): string | null {
  switch (installer.kind) {
    case "npm":
      return `npm install -g ${installer.packageName}@latest`;
    case "homebrew":
      return `brew upgrade --cask ${installer.cask}`;
    case "selfUpdate":
      return agentProviderSelfUpdateCommandLabel(installer.command);
    case "unknown":
      return null;
    default:
      return unsupportedProviderValue(installer, "provider installer");
  }
}

export function providerUpdateResultPresentation(
  state: AgentProviderUpdateState,
  installer: AgentProviderInstaller | null,
): AgentProviderResultPresentation | null {
  switch (state.kind) {
    case "idle":
      return null;
    case "starting":
      return result("neutral", "status", "Preparing update…");
    case "running":
      return result(
        "neutral",
        "status",
        "Installing update…",
        state.outputTail,
        state.outputTruncated,
      );
    case "succeeded":
      return result(
        "success",
        "status",
        `Updated from ${state.previousVersion} to ${state.installedVersion}.`,
      );
    case "failed":
      return result(
        "danger",
        "alert",
        updateFailureLabel(state.reason, installer),
        state.outputTail,
        state.outputTruncated,
      );
    default:
      return unsupportedProviderValue(state, "provider update state");
  }
}

function updateUnavailableMessage(
  reason: Extract<AgentProviderUpdateAvailability, { readonly kind: "unavailable" }>["reason"],
): string {
  switch (reason) {
    case "unknownInstaller":
      return "Update check unavailable: installer could not be identified.";
    case "unsupportedProbe":
      return "Update check unavailable: provider does not support update checks.";
    case "invalidVersion":
      return "Update check unavailable: provider returned an invalid version.";
    case "probeFailed":
      return "Update check unavailable: update probe failed.";
    default:
      return unsupportedProviderValue(reason, "provider update unavailable reason");
  }
}

function updateFailureLabel(
  reason: Extract<AgentProviderUpdateState, { readonly kind: "failed" }>["reason"],
  installer: AgentProviderInstaller | null,
): string {
  switch (reason) {
    case "admissionRefused":
      return "The update was refused.";
    case "spawnFailed":
      return "The updater could not start.";
    case "timedOut":
      return "The update timed out.";
    case "outputLimitExceeded":
      return "The update exceeded its output limit.";
    case "exited":
      return "The updater exited before completing.";
    case "versionMismatch":
      return "The installed version did not match the requested update.";
    case "uncertain":
      return "The update result is uncertain. Refresh the provider status.";
    case "versionNotAdvanced":
      return `The updater finished but the installed version did not change. ${manualRetryHint(installer)}`;
    default:
      return unsupportedProviderValue(reason, "provider update failure");
  }
}

function manualRetryHint(installer: AgentProviderInstaller | null): string {
  if (installer === null || installer.kind !== "selfUpdate") {
    return "Try again or update this CLI with its original installer.";
  }

  return `Try again or update manually with ${agentProviderSelfUpdateCommandLabel(installer.command)}.`;
}

function result(
  tone: AgentProviderResultPresentation["tone"],
  role: AgentProviderResultPresentation["role"],
  message: string,
  outputTail = "",
  outputTruncated = false,
): AgentProviderResultPresentation {
  return { tone, role, message, outputTail, outputTruncated };
}
