/** A grouping hint; execution remains bound to the exact remote project. */
export type RemoteRepositoryIdentityRequest = Readonly<{
  serverId: string;
  runnerId: string;
  projectId: string;
}>;
export interface RemoteRepositoryIdentityGateway {
  discover(request: RemoteRepositoryIdentityRequest): Promise<string | null>;
}
