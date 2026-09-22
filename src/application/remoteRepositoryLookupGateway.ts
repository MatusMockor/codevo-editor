import type { DirectoryListingGateway } from "../domain/directoryListing";
import { parseDirectoryListing } from "../domain/directoryListing";
import type { RemoteRunnerGateway } from "../domain/remoteRunner";
import { isRemoteProjectDirectories } from "../domain/remoteProjectManagement";
import type { RepositoryLookupGateway } from "./repositoryLookupPorts";

/** Captures the execution machine; no fallback to the desktop's credentials. */
export function createRemoteRepositoryLookupGateway(
  runner: RemoteRunnerGateway | null,
  serverId: string | null,
): RepositoryLookupGateway | null {
  if (!runner?.listRepositoryHosts || !runner.lookupRepository || serverId === null) return null;
  const listHosts = runner.listRepositoryHosts.bind(runner);
  const lookup = runner.lookupRepository.bind(runner);
  const search = runner.searchRepositories?.bind(runner);
  return {
    listHosts: () => listHosts({ serverId }),
    lookup: (request) => lookup({ serverId, request }),
    ...(search ? { search: (request) => search({ serverId, request }) } : {}),
  };
}

export function createRemoteProjectDirectoryGateway(
  runner: RemoteRunnerGateway | null,
  serverId: string | null,
): DirectoryListingGateway | null {
  if (!runner?.listProjectDirectories || serverId === null) return null;
  const list = runner.listProjectDirectories.bind(runner);
  return {
    async listDirectoryEntries({ path }) {
      const result = await list({ serverId, ...(path === null ? {} : { path }) });
      if (!isRemoteProjectDirectories(result)) throw new Error("Invalid server directory listing.");
      return parseDirectoryListing({
        path: result.path,
        parent: result.parentPath,
        entries: result.entries.map(({ name }) => ({
          name,
          kind: "directory",
          hidden: name.startsWith("."),
        })),
        truncated: result.truncated,
      });
    },
    async revealDirectory() {
      throw new Error("Server folders cannot be opened in Finder.");
    },
  };
}
