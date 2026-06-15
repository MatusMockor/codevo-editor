export interface WorkspaceTrustState {
  rootPath: string;
  trusted: boolean;
}

export interface WorkspaceTrustGateway {
  getTrust(rootPath: string): Promise<WorkspaceTrustState>;
  setTrust(rootPath: string, trusted: boolean): Promise<WorkspaceTrustState>;
}
