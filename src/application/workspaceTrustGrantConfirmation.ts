import type { WorkspaceTrustGateway, WorkspaceTrustState } from "../domain/trust";
import { workspaceDisplayName } from "../domain/workspaceRootKey";

export async function confirmWorkspaceTrustGrant(
  gateway: Pick<WorkspaceTrustGateway, "confirmGrant">,
  rootPath: string,
  isCurrent: () => boolean,
): Promise<boolean> {
  if (gateway.confirmGrant === undefined) return true;
  const confirmed = await gateway.confirmGrant({
    rootPath,
    label: workspaceDisplayName(rootPath),
    origin: { kind: "local" },
  });
  return confirmed && isCurrent();
}

export function workspaceTrustChangeMessage(
  requestedTrusted: boolean,
  trust: WorkspaceTrustState,
): string {
  if (trust.trusted) return "Workspace trusted.";
  if (requestedTrusted) return "Trust was refused.";
  return "Workspace trust revoked.";
}
