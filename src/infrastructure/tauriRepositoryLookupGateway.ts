import { invoke } from "@tauri-apps/api/core";
import type { RepositoryLookupGateway } from "../application/repositoryLookupPorts";
import type {
  RepositoryHostsSnapshot,
  RepositorySearchRequest,
  RepositorySearchOutcome,
  RepositoryLookupOutcome,
  RepositoryLookupRequest,
} from "../domain/repositoryLookup";
import {
  parseRepositoryHostsSnapshot,
  parseRepositorySearchOutcome,
  validateRepositorySearchRequest,
  parseRepositoryLookupOutcome,
  validateRepositoryLookupRequest,
} from "../domain/repositoryLookupValidation";

export type InvokeRepositoryLookupCommand = (
  command: string,
  args?: Readonly<{ request: RepositoryLookupRequest | RepositorySearchRequest }>,
) => Promise<unknown>;

export const REPOSITORY_LOOKUP_COMMANDS = {
  listHosts: "repository_lookup_hosts",
  search: "repository_search",
  lookup: "repository_lookup",
} as const;

export class TauriRepositoryLookupGateway implements RepositoryLookupGateway {
  constructor(private readonly invokeCommand: InvokeRepositoryLookupCommand = invoke) {}

  async search(request: RepositorySearchRequest): Promise<RepositorySearchOutcome> {
    const validated = validateRepositorySearchRequest(request);
    return parseRepositorySearchOutcome(
      await this.invokeCommand(REPOSITORY_LOOKUP_COMMANDS.search, { request: validated }),
    );
  }

  async listHosts(): Promise<RepositoryHostsSnapshot> {
    const result = await this.invokeCommand(REPOSITORY_LOOKUP_COMMANDS.listHosts);
    return parseRepositoryHostsSnapshot(result);
  }

  async lookup(request: RepositoryLookupRequest): Promise<RepositoryLookupOutcome> {
    const validated = validateRepositoryLookupRequest(request);
    const result = await this.invokeCommand(REPOSITORY_LOOKUP_COMMANDS.lookup, {
      request: validated,
    });
    return parseRepositoryLookupOutcome(result);
  }
}
