// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  fixtureRepository,
  projectFixture,
} from "../components/agentMode/agentThreadsSurfaceTestFixtures";
import type { AgentProjectDescriptor } from "../domain/agentProject";
import { withFolderProjectIdentities } from "./folderProjectIdentities";
import type { RepositoryIdentityOutcomes } from "./projectRepositoryIdentityDiscovery";
import {
  createRemoteDeviceMcpSources,
  resolveRemoteDeviceMcpSource,
  type RemoteDeviceMcpProjects,
} from "./remoteDeviceMcpSource";
import { saveRemoteInstructionRoot } from "./remoteInstructionSources";

const LOCAL_ROOT = "/Users/dev/Developer/playablemaker";
const target = { serverId: "linux", runnerId: "runner", projectId: "playablemaker" } as const;
const folderTarget = { ...target, projectKind: "folder" } as const;

function localFolder(root = LOCAL_ROOT, overrides: Partial<AgentProjectDescriptor> = {}) {
  return projectFixture({
    rootKey: root,
    rootPath: root,
    ownerId: `agent-root:${root}`,
    label: root.slice(root.lastIndexOf("/") + 1),
    repositories: [fixtureRepository(`${root}/pa-ai-be`, "pa-ai-be")],
    repositoryDiscovery: "settled",
    ...overrides,
  });
}

function serverFolder(name: string, overrides: Partial<AgentProjectDescriptor> = {}) {
  const rootKey = `remote:linux:runner:${name}`;
  return projectFixture({
    rootKey,
    rootPath: rootKey,
    ownerId: rootKey,
    label: name,
    repositories: [fixtureRepository(rootKey, "")],
    remoteProjectKind: "folder",
    ...overrides,
  });
}

function snapshot(...projects: AgentProjectDescriptor[]): RemoteDeviceMcpProjects {
  const outcomes: RepositoryIdentityOutcomes = new Map(
    projects
      .filter((project) => !project.rootKey.startsWith("remote:"))
      .map((project) => [project.rootKey, { kind: "none" } as const]),
  );
  return { projects, identities: withFolderProjectIdentities(projects, outcomes) };
}

describe("remote device MCP source", () => {
  beforeEach(() => localStorage.clear());

  it("prefers the explicit instruction source and keeps the remote project kind", () => {
    saveRemoteInstructionRoot("linux", "runner", "playablemaker", "/Users/dev/explicit");
    const paired = snapshot(localFolder(), serverFolder("playablemaker"));
    expect(resolveRemoteDeviceMcpSource(folderTarget, paired)).toEqual({
      rootPath: "/Users/dev/explicit",
      projectKind: "folder",
    });
    expect(resolveRemoteDeviceMcpSource(target, null)).toEqual({
      rootPath: "/Users/dev/explicit",
      projectKind: "git",
    });
  });

  it("falls back to the trusted unique folder pairing", () => {
    const paired = snapshot(localFolder(), serverFolder("playablemaker"));
    expect(resolveRemoteDeviceMcpSource(folderTarget, paired)).toEqual({
      rootPath: LOCAL_ROOT,
      projectKind: "folder",
    });
  });

  it("returns null without a mapping or a pairing", () => {
    expect(resolveRemoteDeviceMcpSource(folderTarget, null)).toBeNull();
    expect(
      resolveRemoteDeviceMcpSource(folderTarget, snapshot(serverFolder("playablemaker"))),
    ).toBeNull();
    expect(
      resolveRemoteDeviceMcpSource(
        { ...folderTarget, projectId: "other" },
        snapshot(localFolder(), serverFolder("playablemaker")),
      ),
    ).toBeNull();
  });

  it("refuses untrusted, ambiguous, or non-folder pairings", () => {
    expect(
      resolveRemoteDeviceMcpSource(
        folderTarget,
        snapshot(localFolder(LOCAL_ROOT, { trust: "untrusted" }), serverFolder("playablemaker")),
      ),
    ).toBeNull();
    expect(
      resolveRemoteDeviceMcpSource(
        folderTarget,
        snapshot(
          localFolder(),
          localFolder("/Users/dev/Other/playablemaker"),
          serverFolder("playablemaker"),
        ),
      ),
    ).toBeNull();
    const paired = snapshot(localFolder(), serverFolder("playablemaker"));
    const asRepository = {
      ...paired,
      projects: paired.projects.map((project) =>
        project.rootKey.startsWith("remote:")
          ? { ...project, remoteProjectKind: "repository" as const }
          : project,
      ),
    };
    expect(resolveRemoteDeviceMcpSource(folderTarget, asRepository)).toBeNull();
    const forgedIdentity = {
      ...paired,
      identities: new Map([...paired.identities].map(([key]) => [key, "github.com/acme/x"])),
    };
    expect(resolveRemoteDeviceMcpSource(folderTarget, forgedIdentity)).toBeNull();
  });

  it("fails closed when the instruction source preferences cannot be read", () => {
    localStorage.setItem("codevo.remote-instruction-sources.v1", "{not json");
    expect(
      resolveRemoteDeviceMcpSource(
        folderTarget,
        snapshot(localFolder(), serverFolder("playablemaker")),
      ),
    ).toBeNull();
  });

  it("resolves through the latest published project snapshot only", () => {
    const sources = createRemoteDeviceMcpSources();
    expect(sources.resolve(folderTarget)).toBeNull();
    sources.publish(snapshot(localFolder(), serverFolder("playablemaker")));
    expect(sources.resolve(folderTarget)?.rootPath).toBe(LOCAL_ROOT);
    sources.publish(null);
    expect(sources.resolve(folderTarget)).toBeNull();
  });
});
