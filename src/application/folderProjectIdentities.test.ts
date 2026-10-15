import { describe, expect, it } from "vitest";
import { agentProjectGroups } from "../components/agentMode/agentModePresentation";
import {
  environmentComposerScope,
  groupedEnvironmentProjects,
} from "../components/agentMode/agentEnvironmentProjects";
import {
  fixtureRepository,
  projectFixture,
} from "../components/agentMode/agentThreadsSurfaceTestFixtures";
import type { AgentProjectDescriptor } from "../domain/agentProject";
import { withFolderProjectIdentities } from "./folderProjectIdentities";
import type {
  RepositoryIdentityOutcome,
  RepositoryIdentityOutcomes,
} from "./projectRepositoryIdentityDiscovery";

const LOCAL_ROOT = "/Users/dev/Developer/playablemaker";
const NONE: RepositoryIdentityOutcome = { kind: "none" };

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

function serverProject(
  name: string,
  overrides: Partial<AgentProjectDescriptor> = {},
  server = "linux",
): AgentProjectDescriptor {
  const rootKey = `remote:${server}:runner:${name}`;
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

function settled(...projects: AgentProjectDescriptor[]): RepositoryIdentityOutcomes {
  return new Map(
    projects
      .filter((project) => !project.rootKey.startsWith("remote:"))
      .map((p) => [p.rootKey, NONE]),
  );
}

function paired(projects: AgentProjectDescriptor[], outcomes = settled(...projects)) {
  return [...withFolderProjectIdentities(projects, outcomes).values()].filter((identity) =>
    identity.startsWith("folder:"),
  ).length;
}

describe("folder project identity across environments", () => {
  it("pairs a settled non-Git local folder with the same-named server folder project", () => {
    const local = localFolder();
    const remote = serverProject("playablemaker");
    const inventory = [local, remote];
    const identities = withFolderProjectIdentities(inventory, settled(local));
    expect(identities.get(local.rootKey)).toBe("folder:playablemaker");
    expect(identities.get(remote.rootKey)).toBe("folder:playablemaker");

    const groups = groupedEnvironmentProjects(
      agentProjectGroups(inventory, [], []),
      inventory,
      new Map(),
      identities,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.memberProjectRootKeys).toEqual([local.rootKey, remote.rootKey]);
    const scope = environmentComposerScope(
      {
        kind: "project",
        projectRootKey: local.rootKey,
        repositoryRoot: local.rootPath,
        ownerId: local.ownerId,
        generation: local.generation,
      },
      groups,
      inventory,
      "linux",
      identities,
    );
    expect(scope?.projectRootKey).toBe(remote.rootKey);
  });

  it("keeps Git identities from settled lookups and pairs one folder per server", () => {
    const local = localFolder();
    const git = projectFixture({ rootKey: "/workspace/app", rootPath: "/workspace/app" });
    const second = serverProject("playablemaker", {}, "staging");
    const outcomes: RepositoryIdentityOutcomes = new Map<string, RepositoryIdentityOutcome>([
      [local.rootKey, NONE],
      [git.rootKey, { kind: "identity", identity: "github.com/acme/app" }],
    ]);
    const identities = withFolderProjectIdentities(
      [local, git, serverProject("playablemaker"), second],
      outcomes,
    );
    expect(identities.get(git.rootKey)).toBe("github.com/acme/app");
    expect(identities.get(second.rootKey)).toBe("folder:playablemaker");
  });

  it("waits for authoritative repository and identity discovery before pairing", () => {
    const remote = serverProject("app");
    const checkout = localFolder("/work/app", { repositories: [], repositoryDiscovery: "pending" });
    expect(paired([checkout, remote], new Map())).toBe(0);
    expect(paired([checkout, remote])).toBe(0);
    expect(paired([{ ...checkout, repositoryDiscovery: "settled" }, remote], new Map())).toBe(0);
    for (const outcome of [
      { kind: "unavailable" },
      { kind: "failed", retrying: true },
      { kind: "identity", identity: "github.com/acme/app" },
    ] as const)
      expect(
        paired(
          [{ ...checkout, repositoryDiscovery: "settled" }, remote],
          new Map([[checkout.rootKey, outcome]]),
        ),
      ).toBe(0);
    expect(paired([{ ...checkout, repositoryDiscovery: "settled" }, remote])).toBe(2);
  });

  it("never pairs Git roots, repository projects, or untrusted projects", () => {
    const remote = serverProject("playablemaker");
    const gitRoot = localFolder(LOCAL_ROOT, { repositories: [fixtureRepository(LOCAL_ROOT, "")] });
    const identified = localFolder(LOCAL_ROOT, { repositoryIdentity: "github.com/acme/pm" });
    expect(paired([gitRoot, remote])).toBe(0);
    expect(paired([identified, remote])).toBe(0);
    expect(paired([localFolder(LOCAL_ROOT, { trust: "untrusted" }), remote])).toBe(0);
    expect(paired([localFolder(), serverProject("playablemaker", { trust: "untrusted" })])).toBe(0);
    expect(
      paired([localFolder(), serverProject("playablemaker", { remoteProjectKind: "repository" })]),
    ).toBe(0);
  });

  it("refuses names shared with any other project on the same side, eligible or not", () => {
    const remote = serverProject("app");
    const work = localFolder("/work/app");
    const namesakes: AgentProjectDescriptor[] = [
      localFolder("/archive/app", { trust: "untrusted" }),
      localFolder("/archive/app", { repositoryDiscovery: "pending" }),
      localFolder("/archive/app", { repositories: [fixtureRepository("/archive/app", "")] }),
      localFolder("/archive/app", { origin: "closed-tab-live-tasks" }),
    ];
    for (const namesake of namesakes) expect(paired([work, namesake, remote])).toBe(0);

    const remoteNamesakes: AgentProjectDescriptor[] = [
      serverProject("app-untrusted", { label: "app", trust: "untrusted" }),
      serverProject("app-repository", { label: "app", remoteProjectKind: "repository" }),
      serverProject("app-plain", { label: "app" }),
    ];
    for (const namesake of remoteNamesakes) expect(paired([work, remote, namesake])).toBe(0);

    expect(paired([work, remote, serverProject("app-other", { label: "app" }, "staging")])).toBe(3);
  });
});
