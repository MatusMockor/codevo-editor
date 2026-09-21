export interface RepositoryIdentityGateway {
  discover(rootPath: string): Promise<string | null>;
}
