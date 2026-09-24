import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import type { AgentCliKind } from "../../domain/agentTask";

export function providerIsEnabled(
  enabled: Readonly<Record<AgentCliKind, boolean>> | null,
  provider: AgentCliKind,
): boolean {
  if (enabled === null) return true;
  return enabled[provider];
}

export function configuredProviderModel(
  management: AgentProviderManagementSurface | null,
  provider: AgentCliKind,
): string | null {
  const state = management?.cliDiscovery[provider];
  return state?.kind === "detected" ? (state.configuredModel ?? null) : null;
}

export function configuredProviderVersion(
  management: AgentProviderManagementSurface | null,
  provider: AgentCliKind,
): string | null {
  const state = management?.cliDiscovery[provider];
  return state?.kind === "detected" ? state.version : null;
}

export function providerAvailabilityReason(
  management: AgentProviderManagementSurface | null,
  provider: AgentCliKind,
  enabled: boolean,
): string | null {
  if (!enabled) return "Enable this provider in settings";
  if (management === null) return null;
  const disposition = management.admissionAuthority(provider).disposition;
  switch (disposition.kind) {
    case "ready":
      return null;
    case "disabled":
      return "This provider is disabled";
    case "initializing":
      return "This provider is initializing";
    case "updating":
      return "This provider is updating";
    case "policyUnavailable":
      return disposition.reason === "unregistered"
        ? "Provider policy is not registered"
        : "Provider policy registration failed";
    default:
      return unsupportedAdmissionDisposition(disposition);
  }
}

function unsupportedAdmissionDisposition(disposition: never): never {
  throw new TypeError(`Unsupported provider disposition: ${String(disposition)}`);
}
