import { expect, it, vi } from "vitest";
import type { RemoteRunnerGateway } from "../domain/remoteRunner";
import {
  createRemoteProjectDirectoryGateway,
  createRemoteRepositoryLookupGateway,
} from "./remoteRepositoryLookupGateway";

it("captures the selected machine for every account, lookup and search operation", async () => {
  const listRepositoryHosts = vi.fn();
  const lookupRepository = vi.fn();
  const searchRepositories = vi.fn();
  const runner = {
    listRepositoryHosts,
    lookupRepository,
    searchRepositories,
  } as unknown as RemoteRunnerGateway;
  const a = createRemoteRepositoryLookupGateway(runner, "server-a")!;
  const b = createRemoteRepositoryLookupGateway(runner, "server-b")!;
  const request = { provider: "github", host: "github.com", query: "crm", page: 1 } as const;
  await a.listHosts();
  await b.listHosts();
  await a.lookup({ provider: "github", host: "github.com", path: "team/crm" });
  await b.search!(request);
  expect(listRepositoryHosts.mock.calls).toEqual([
    [{ serverId: "server-a" }],
    [{ serverId: "server-b" }],
  ]);
  expect(lookupRepository).toHaveBeenCalledWith({
    serverId: "server-a",
    request: { provider: "github", host: "github.com", path: "team/crm" },
  });
  expect(searchRepositories).toHaveBeenCalledWith({ serverId: "server-b", request });
});

it("does not fall back to a local account when server operations are unavailable", () => {
  expect(createRemoteRepositoryLookupGateway(null, "a")).toBeNull();
  expect(createRemoteRepositoryLookupGateway({} as RemoteRunnerGateway, "a")).toBeNull();
  expect(createRemoteProjectDirectoryGateway({} as RemoteRunnerGateway, "a")).toBeNull();
});

it("maps server directories and preserves truncated state without exposing files or local reveal", async () => {
  const listProjectDirectories = vi.fn(async () => ({
    path: "/srv/projects",
    parentPath: "/srv",
    entries: [{ name: ".hidden", path: "/srv/projects/.hidden" }],
    truncated: true,
  }));
  const gateway = createRemoteProjectDirectoryGateway(
    { listProjectDirectories } as unknown as RemoteRunnerGateway,
    "server-a",
  )!;
  expect(await gateway.listDirectoryEntries({ path: null, includeFiles: false })).toEqual({
    path: "/srv/projects",
    parent: "/srv",
    entries: [{ name: ".hidden", kind: "directory", hidden: true }],
    truncated: true,
  });
  expect(listProjectDirectories).toHaveBeenCalledWith({ serverId: "server-a" });
  await expect(gateway.revealDirectory("/srv")).rejects.toThrow("cannot be opened in Finder");
  listProjectDirectories.mockResolvedValueOnce({
    path: "/srv/projects",
    parentPath: "/srv",
    entries: [{ name: "escape", path: "/etc" }],
    truncated: false,
  });
  await expect(
    gateway.listDirectoryEntries({ path: "/srv/projects", includeFiles: false }),
  ).rejects.toThrow("Invalid server");
});
