import type { AgentCliKind } from "../domain/agentTask";

export type AgentProviderAdmissionDisposition =
  | { readonly kind: "ready" }
  | { readonly kind: "disabled" }
  | { readonly kind: "updating" }
  | {
      readonly kind: "policyUnavailable";
      readonly reason: "notConfigured" | "unregistered" | "registrationFailed";
    };

export type AgentProviderAdmissionAuthority =
  | {
      readonly provider: AgentCliKind;
      readonly revision: number;
      readonly disposition: { readonly kind: "ready" };
      readonly cliPath: string;
      readonly providerGeneration: number;
    }
  | {
      readonly provider: AgentCliKind;
      readonly revision: number;
      readonly disposition: { readonly kind: "disabled" };
    }
  | {
      readonly provider: AgentCliKind;
      readonly revision: number;
      readonly disposition: { readonly kind: "updating" };
      readonly cliPath: string;
      readonly providerGeneration: number;
    }
  | {
      readonly provider: AgentCliKind;
      readonly revision: number;
      readonly disposition: {
        readonly kind: "policyUnavailable";
        readonly reason: "notConfigured" | "unregistered" | "registrationFailed";
      };
    };

export type ReadyAgentProviderAdmissionAuthority = Extract<
  AgentProviderAdmissionAuthority,
  { readonly disposition: { readonly kind: "ready" } }
>;

export type AgentProviderAdmissionAuthorityReader = (
  provider: AgentCliKind,
) => AgentProviderAdmissionAuthority;

export type AgentProviderAdmissionDecision =
  | {
      readonly kind: "admitted";
      readonly authority: ReadyAgentProviderAdmissionAuthority;
    }
  | {
      readonly kind: "rejected";
      readonly reason:
        "disabled" | "updating" | "notConfigured" | "unregistered" | "registrationFailed";
      readonly message: string;
    };

export const AGENT_PROVIDER_DISABLED_NOTICE =
  "Enable this provider in Settings before starting a turn.";
export const AGENT_PROVIDER_UPDATING_NOTICE =
  "This provider is updating. Wait for the update to finish.";
export const AGENT_PROVIDER_UNREGISTERED_NOTICE =
  "Provider settings are not registered yet. Retry provider setup.";
export const AGENT_PROVIDER_NOT_CONFIGURED_NOTICE =
  "Configure this provider's CLI path in Settings before starting a turn.";
export const AGENT_PROVIDER_REGISTRATION_FAILED_NOTICE =
  "Provider settings could not be registered. Retry in Settings.";

export function decideAgentProviderAdmission(
  authority: AgentProviderAdmissionAuthority,
): AgentProviderAdmissionDecision {
  switch (authority.disposition.kind) {
    case "ready":
      if (!isReadyAuthority(authority)) return malformedAuthority(authority);
      return { kind: "admitted", authority };
    case "disabled":
      return {
        kind: "rejected",
        reason: "disabled",
        message: AGENT_PROVIDER_DISABLED_NOTICE,
      };
    case "updating":
      return {
        kind: "rejected",
        reason: "updating",
        message: AGENT_PROVIDER_UPDATING_NOTICE,
      };
    case "policyUnavailable":
      return unavailableDecision(authority.disposition.reason);
    default:
      return unsupportedDisposition(authority.disposition);
  }
}

export function isCurrentAgentProviderAdmissionAuthority(
  read: AgentProviderAdmissionAuthorityReader,
  captured: AgentProviderAdmissionAuthority,
): boolean {
  if (!isReadyAuthority(captured)) return false;
  const current = read(captured.provider);
  if (current.provider !== captured.provider) return false;
  if (current.revision !== captured.revision) return false;
  if (!isReadyAuthority(current)) return false;
  if (current.cliPath !== captured.cliPath) return false;
  return current.providerGeneration === captured.providerGeneration;
}

function isReadyAuthority(
  authority: AgentProviderAdmissionAuthority,
): authority is ReadyAgentProviderAdmissionAuthority {
  if (authority.disposition.kind !== "ready") return false;
  return "cliPath" in authority && "providerGeneration" in authority;
}

function malformedAuthority(authority: AgentProviderAdmissionAuthority): never {
  throw new TypeError(`Malformed provider admission authority: ${JSON.stringify(authority)}.`);
}

function unavailableDecision(
  reason: "notConfigured" | "unregistered" | "registrationFailed",
): AgentProviderAdmissionDecision {
  switch (reason) {
    case "notConfigured":
      return {
        kind: "rejected",
        reason,
        message: AGENT_PROVIDER_NOT_CONFIGURED_NOTICE,
      };
    case "unregistered":
      return {
        kind: "rejected",
        reason,
        message: AGENT_PROVIDER_UNREGISTERED_NOTICE,
      };
    case "registrationFailed":
      return {
        kind: "rejected",
        reason,
        message: AGENT_PROVIDER_REGISTRATION_FAILED_NOTICE,
      };
    default:
      return unsupportedPolicyUnavailableReason(reason);
  }
}

function unsupportedDisposition(disposition: never): never {
  throw new TypeError(`Unsupported provider admission disposition: ${String(disposition)}.`);
}

function unsupportedPolicyUnavailableReason(reason: never): never {
  throw new TypeError(`Unsupported provider policy unavailable reason: ${String(reason)}.`);
}
