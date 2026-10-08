export interface WorkspaceOpenedProjectIdentity {
  readonly workspaceId: string;
  readonly admissionToken?: number;
  readonly selectedPath: string;
  readonly canonicalRoot: string;
}

export interface WorkspaceOpenedProjectRevocation {
  readonly workspaceId: string;
  readonly admissionToken: number;
  readonly canonicalRoot: string;
}

export interface WorkspaceTrustState {
  rootPath: string;
  trusted: boolean;
}

export interface WorkspaceTrustGateway {
  grantOpenedProject?(identity: WorkspaceOpenedProjectIdentity): Promise<WorkspaceTrustState>;
  revokeOpenedProject?(identity: WorkspaceOpenedProjectRevocation): Promise<WorkspaceTrustState>;
  getTrust(rootPath: string): Promise<WorkspaceTrustState>;
  setTrust(rootPath: string, trusted: boolean): Promise<WorkspaceTrustState>;
  confirmGrant?(request: WorkspaceTrustConfirmation): Promise<boolean>;
}

export type WorkspaceTrustOrigin =
  Readonly<{ kind: "local" }> | Readonly<{ kind: "clone"; host: string; path: string }>;

export interface WorkspaceTrustConfirmation {
  readonly rootPath: string;
  readonly label: string;
  readonly origin: WorkspaceTrustOrigin;
}

export const WORKSPACE_TRUST_REVOKED_REFUSAL = "workspace trust was revoked";

export function isWorkspaceTrustRevokedRefusal(error: unknown): boolean {
  if (typeof error === "string") return error === WORKSPACE_TRUST_REVOKED_REFUSAL;
  return error instanceof Error && error.message === WORKSPACE_TRUST_REVOKED_REFUSAL;
}
