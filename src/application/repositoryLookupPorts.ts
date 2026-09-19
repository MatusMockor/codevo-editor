import type {
  RepositoryHostsSnapshot,
  RepositoryLookupOutcome,
  RepositoryLookupRequest,
} from "../domain/repositoryLookup";

export interface RepositoryLookupGateway {
  listHosts(): Promise<RepositoryHostsSnapshot>;
  lookup(request: RepositoryLookupRequest): Promise<RepositoryLookupOutcome>;
}

export type RepositoryLookupGatewayRef = RepositoryLookupGateway | null;
