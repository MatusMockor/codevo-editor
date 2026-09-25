import type { WorkspaceTrustGateway, WorkspaceTrustOrigin } from "../domain/trust";

export type AgentProjectTrustGrantResult = "granted" | "declined" | "refused" | "stale";

export async function confirmAndGrantAgentProjectTrust(
  input: Readonly<{
    rootPath: string;
    label: string;
    origin: WorkspaceTrustOrigin;
    gateway: Pick<WorkspaceTrustGateway, "confirmGrant" | "setTrust">;
    isCurrent: () => boolean;
  }>,
): Promise<AgentProjectTrustGrantResult> {
  const { gateway, isCurrent } = input;
  if (gateway.confirmGrant === undefined) return "declined";
  const confirmed = await gateway.confirmGrant({
    rootPath: input.rootPath,
    label: input.label,
    origin: input.origin,
  });
  if (!confirmed) return "declined";
  if (!isCurrent()) return "stale";
  const state = await gateway.setTrust(input.rootPath, true);
  if (!isCurrent()) return "stale";
  return state.trusted ? "granted" : "refused";
}
