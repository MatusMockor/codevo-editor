import { MAX_AGENT_PROJECT_ROOTS } from "../domain/agentProject";
import type { WorkspaceTrustGateway, WorkspaceTrustState } from "../domain/trust";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { WorkspaceIdentityDescriptor } from "./workspaceIdentityGatewayPort";

export class AgentOpenedProjectAdmission {
  private readonly observed = new Map<string, { readonly admission: string }>();

  async authorize(
    identity: WorkspaceIdentityDescriptor,
    trust: WorkspaceTrustState,
    gateway: WorkspaceTrustGateway,
    isCurrent: () => boolean,
  ): Promise<WorkspaceTrustState | null> {
    if (!isCurrent() || identity.admissionToken === undefined) return null;
    const key = identity.canonicalRoot;
    const admission = `${identity.workspaceId}:${identity.admissionToken}`;
    if (this.observed.get(key)?.admission === admission) return null;
    if (!this.observed.has(key) && this.observed.size >= MAX_AGENT_PROJECT_ROOTS) return null;
    const authority = { admission };
    this.observed.set(key, authority);
    if (trust.trusted || gateway.grantOpenedProject === undefined) return null;
    const granted = await gateway.grantOpenedProject(identity);
    if (this.observed.get(key) !== authority) return null;
    if (!isCurrent()) {
      this.observed.delete(key);
      return null;
    }
    if (
      !granted.trusted ||
      (!workspaceRootKeysEqual(granted.rootPath, identity.selectedPath) &&
        !workspaceRootKeysEqual(granted.rootPath, identity.canonicalRoot))
    ) {
      throw new Error("Project admission returned a mismatched workspace.");
    }
    return granted;
  }

  revoke(identity: WorkspaceIdentityDescriptor): void {
    if (identity.admissionToken === undefined) return;
    if (!this.observed.has(identity.canonicalRoot) && this.observed.size >= MAX_AGENT_PROJECT_ROOTS)
      return;
    this.observed.set(identity.canonicalRoot, {
      admission: `${identity.workspaceId}:${identity.admissionToken}`,
    });
  }

  retain(roots: ReadonlyArray<string>): void {
    const retained = new Set(roots);
    for (const root of this.observed.keys()) {
      if (!retained.has(root)) this.observed.delete(root);
    }
  }
}
