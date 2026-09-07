export interface WorkspaceOpenedProjectIdentity {
  readonly workspaceId: string;
  readonly admissionToken?: number;
  readonly selectedPath: string;
  readonly canonicalRoot: string;
}

export interface WorkspaceTrustState {
  rootPath: string;
  trusted: boolean;
}

export interface WorkspaceTrustGateway {
  grantOpenedProject?(identity: WorkspaceOpenedProjectIdentity): Promise<WorkspaceTrustState>;
  getTrust(rootPath: string): Promise<WorkspaceTrustState>;
  setTrust(rootPath: string, trusted: boolean): Promise<WorkspaceTrustState>;
}
