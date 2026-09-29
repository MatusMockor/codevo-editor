import { compareAgentCliVersions } from "../domain/agentCliVersion";
import type { AgentProviderUpdateAvailability } from "../domain/agentProviderHealth";
import type { AgentCliKind } from "../domain/agentTask";
import type { AgentProviderManagementToast } from "./useAgentProviderManagement";

const PROVIDER_ORDER: readonly AgentCliKind[] = ["claudeCode", "codex"];

export function updateOfferToast(
  provider: AgentCliKind,
  update: AgentProviderUpdateAvailability,
  dismissedUpdateVersion: string | null | undefined,
): AgentProviderManagementToast | null {
  if (update.kind !== "available" && update.kind !== "manualUpdateAvailable") return null;
  if (dismissedUpdateVersion === update.availableVersion) return null;
  return {
    kind: "updateAvailable",
    provider,
    version: update.availableVersion,
    ...(update.kind === "manualUpdateAvailable" ? { manual: true as const } : {}),
  };
}

export function withoutSatisfiedUpdateOffer(
  toast: AgentProviderManagementToast | null,
  provider: AgentCliKind,
  installedVersion: string | null,
  pendingOffer: (provider: AgentCliKind) => AgentProviderManagementToast | null,
): AgentProviderManagementToast | null {
  if (toast?.kind !== "updateAvailable" || toast.provider !== provider) return toast;
  if (!installedVersionSatisfiesOffer(installedVersion, toast.version)) return toast;
  for (const other of PROVIDER_ORDER) {
    if (other === provider) continue;
    const offer = pendingOffer(other);
    if (offer !== null) return offer;
  }
  return null;
}

function installedVersionSatisfiesOffer(
  installedVersion: string | null,
  offeredVersion: string,
): boolean {
  if (installedVersion === null) return false;
  const order = compareAgentCliVersions(installedVersion, offeredVersion);
  return order === 0 || order === 1;
}
