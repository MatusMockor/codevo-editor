import type {
  RepositoryHostsSnapshot,
  RepositorySearchRequest,
  RepositorySearchOutcome,
  RepositoryLookupOutcome,
  RepositoryLookupRequest,
} from "../domain/repositoryLookup";

export interface RepositoryLookupGateway {
  search?(request: RepositorySearchRequest): Promise<RepositorySearchOutcome>;
  listHosts(): Promise<RepositoryHostsSnapshot>;
  lookup(request: RepositoryLookupRequest): Promise<RepositoryLookupOutcome>;
}

export type RepositoryLookupGatewayRef = RepositoryLookupGateway | null;
