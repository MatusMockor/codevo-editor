import { MAX_AGENT_PROJECT_ROOTS } from "../domain/agentProject";
import {
  isWorkspaceTrustRevokedRefusal,
  type WorkspaceTrustGateway,
  type WorkspaceTrustState,
} from "../domain/trust";
import { normalizedWorkspaceRootKey, workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { WorkspaceIdentityDescriptor } from "./workspaceIdentityGatewayPort";

const MAX_DEFERRED_TRUST_ROOTS = 16;

export class AgentOpenedProjectAdmission {
  private readonly observed = new Map<string, { readonly admission: string }>();
  private readonly deferred: Array<{ readonly key: string }> = [];

  deferTrust(rootPath: string): () => void {
    const key = normalizedWorkspaceRootKey(rootPath);
    const existing = this.deferred.findIndex((entry) => entry.key === key);
    if (existing >= 0) this.deferred.splice(existing, 1);
    const entry = { key };
    this.deferred.push(entry);
    if (this.deferred.length > MAX_DEFERRED_TRUST_ROOTS) this.deferred.shift();
    return () => {
      const index = this.deferred.indexOf(entry);
      if (index >= 0) this.deferred.splice(index, 1);
    };
  }

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
    const deferred = this.consumeDeferral(identity);
    if (trust.trusted || gateway.grantOpenedProject === undefined || deferred) return null;
    let granted: WorkspaceTrustState;
    try {
      granted = await gateway.grantOpenedProject(identity);
    } catch (error) {
      if (isWorkspaceTrustRevokedRefusal(error)) return null;
      throw error;
    }
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

  private consumeDeferral(identity: WorkspaceIdentityDescriptor): boolean {
    const keys = [identity.selectedPath, identity.canonicalRoot].map((path) =>
      normalizedWorkspaceRootKey(path),
    );
    const index = this.deferred.findIndex((entry) => keys.includes(entry.key));
    if (index < 0) return false;
    this.deferred.splice(index, 1);
    return true;
  }

  retain(roots: ReadonlyArray<string>): void {
    const retained = new Set(roots);
    for (const root of this.observed.keys()) {
      if (!retained.has(root)) this.observed.delete(root);
    }
  }
}
