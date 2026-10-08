import type {
  WorkspaceOpenedProjectIdentity,
  WorkspaceOpenedProjectRevocation,
  WorkspaceTrustConfirmation,
  WorkspaceTrustGateway,
  WorkspaceTrustState,
} from "../domain/trust";
import type { WorkspaceTrustPromptCoordinator } from "./workspaceTrustPrompt";

export class ConfirmingWorkspaceTrustGateway implements WorkspaceTrustGateway {
  readonly grantOpenedProject?: (
    identity: WorkspaceOpenedProjectIdentity,
  ) => Promise<WorkspaceTrustState>;

  readonly revokeOpenedProject?: (
    identity: WorkspaceOpenedProjectRevocation,
  ) => Promise<WorkspaceTrustState>;

  constructor(
    private readonly inner: WorkspaceTrustGateway,
    private readonly prompt: Pick<WorkspaceTrustPromptCoordinator, "request">,
  ) {
    const grant = inner.grantOpenedProject;
    if (grant !== undefined) this.grantOpenedProject = (identity) => grant.call(inner, identity);
    const revoke = inner.revokeOpenedProject;
    if (revoke !== undefined) this.revokeOpenedProject = (identity) => revoke.call(inner, identity);
  }

  getTrust(rootPath: string): Promise<WorkspaceTrustState> {
    return this.inner.getTrust(rootPath);
  }

  setTrust(rootPath: string, trusted: boolean): Promise<WorkspaceTrustState> {
    return this.inner.setTrust(rootPath, trusted);
  }

  async confirmGrant(request: WorkspaceTrustConfirmation): Promise<boolean> {
    return (await this.prompt.request(request)) === "trust";
  }
}
