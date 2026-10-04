import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_PROJECT_GROUPING_SETTINGS,
  type AgentProjectGroupingMode,
  type AgentProjectGroupingSettings,
} from "../../domain/agentProjectGrouping";
import { agentProjectGroups } from "./agentModePresentation";
import { agentRailOwnedViews } from "./agentRailProjectLayout";
import { agentRailScopeEntries, agentRailSections } from "./agentSidebarPresentation";
import { environmentComposerScope, groupedEnvironmentProjects } from "./agentEnvironmentProjects";
import { projectFixture, fixtureRepository } from "./agentThreadsSurfaceTestFixtures";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";

const local = projectFixture();
const remoteKey = "remote:linux:runner:project";
const remote = projectFixture({
  rootKey: remoteKey,
  rootPath: remoteKey,
  ownerId: remoteKey,
  label: "Runner",
  repositories: [fixtureRepository(remoteKey, "")],
});
const localView = surfaceThreadView();
const remoteView = {
  ...localView,
  thread: {
    ...localView.thread,
    threadId: "remote-thread:linux:runner:task",
    owner: {
      ...localView.thread.owner,
      rootKey: remoteKey,
      ownerId: remoteKey,
      repositoryRoot: remoteKey,
    },
  },
};
const projects = [local, remote];
const views = [localView, remoteView];
const source = agentProjectGroups(projects, views, []);
const links = new Map([[remoteKey, local.rootKey]]);
const scope = {
  kind: "project" as const,
  projectRootKey: local.rootKey,
  repositoryRoot: local.rootPath,
  ownerId: local.ownerId,
  generation: local.generation,
};

describe("project display across environments", () => {
  it("merges only explicit links, includes both inventories, and preserves exact thread owners", () => {
    const groups = groupedEnvironmentProjects(source, projects, links);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe(local.label);
    const entry = agentRailScopeEntries(groups)[0]!;
    const sections = agentRailSections(agentRailOwnedViews(views, [entry]));
    expect(sections.active.map((view) => view.thread.threadId)).toEqual(
      expect.arrayContaining(views.map((view) => view.thread.threadId)),
    );
    expect(sections.active.find((view) => view === remoteView)?.thread.owner.rootKey).toBe(
      remoteKey,
    );
    expect(groupedEnvironmentProjects(source, projects, new Map())).toHaveLength(2);
    expect(
      groupedEnvironmentProjects(source, projects, new Map([[remoteKey, "/gone"]])),
    ).toHaveLength(2);
  });
  it("automatically groups canonical identities without changing physical thread owners", () => {
    const identities = new Map(
      projects.map((project) => [project.rootKey, "github.com/acme/editor"]),
    );
    const groups = groupedEnvironmentProjects(source, projects, new Map(), identities);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.memberProjectRootKeys).toEqual([local.rootKey, remoteKey]);
    expect(groups[0]?.repos).toEqual(source.flatMap((group) => group.repos));
    expect(environmentComposerScope(scope, groups, projects, "linux")).toMatchObject({
      projectRootKey: remoteKey,
      ownerId: remoteKey,
    });
    expect(remoteView.thread.owner.rootKey).toBe(remoteKey);
  });
  it("keeps same-name unrelated repositories and undiscovered projects separate", () => {
    const identities = new Map([
      [local.rootKey, "github.com/acme/editor"],
      [remoteKey, "gitlab.com/acme/editor"],
    ]);
    expect(groupedEnvironmentProjects(source, projects, new Map(), identities)).toHaveLength(2);
    expect(
      groupedEnvironmentProjects(
        source,
        projects,
        new Map(),
        new Map([[remoteKey, "github.com/acme/editor"]]),
      ),
    ).toHaveLength(2);
  });
  it("preserves explicit connections that deliberately connect forks", () => {
    const identities = new Map([
      [local.rootKey, "github.com/acme/editor"],
      [remoteKey, "github.com/me/editor"],
    ]);
    expect(groupedEnvironmentProjects(source, projects, links, identities)).toHaveLength(1);
  });
  it("groups server-only copies but refuses ambiguous environment routing", () => {
    const second = {
      ...remote,
      rootKey: "remote:linux:runner:other",
      ownerId: "other",
      rootPath: "remote:linux:runner:other",
    };
    const inventory = [...projects, second];
    const identities = new Map(
      inventory.map((project) => [project.rootKey, "github.com/acme/editor"]),
    );
    const groups = groupedEnvironmentProjects(
      agentProjectGroups(inventory, views, []),
      inventory,
      new Map(),
      identities,
    );
    expect(groups).toHaveLength(1);
    expect(environmentComposerScope(scope, groups, inventory, "linux")?.kind).toBe("missing");
  });
  it("resolves selected server to an exact linked project and refuses an unrelated or ambiguous target", () => {
    const groups = groupedEnvironmentProjects(source, projects, links);
    expect(environmentComposerScope(scope, groups, projects, "linux")).toMatchObject({
      projectRootKey: remoteKey,
      ownerId: remoteKey,
    });
    expect(environmentComposerScope(scope, groups, projects, null)).toBe(scope);
    expect(environmentComposerScope(scope, groups, projects, "other")?.kind).toBe("missing");
    expect(environmentComposerScope(scope, source, projects, "linux")?.kind).toBe("missing");
    const second = {
      ...remote,
      rootKey: "remote:linux:runner:other",
      rootPath: "remote:linux:runner:other",
    };
    const ambiguous = [
      { ...groups[0]!, memberProjectRootKeys: [local.rootKey, remoteKey, second.rootKey] },
    ];
    expect(environmentComposerScope(scope, ambiguous, [...projects, second], "linux")?.kind).toBe(
      "missing",
    );
  });
  it("preserves an explicitly chosen physical member in an ambiguous linked group", () => {
    const second = { ...remote, rootKey: "remote:linux:runner:second" };
    const inventory = [...projects, second];
    const groups = [
      { ...source[0]!, memberProjectRootKeys: inventory.map((project) => project.rootKey) },
    ];
    const explicit = {
      ...scope,
      kind: "repository" as const,
      projectRootKey: remote.rootKey,
      repositoryRoot: remote.rootPath,
      ownerId: remote.ownerId,
      generation: remote.generation,
    };
    expect(environmentComposerScope(explicit, groups, inventory, "linux")).toBe(explicit);
    expect(
      environmentComposerScope({ ...explicit, generation: 99 }, groups, inventory, "linux")?.kind,
    ).toBe("missing");
    expect(environmentComposerScope(explicit, groups, inventory, "other")?.kind).toBe("missing");
  });
});

describe("project grouping modes", () => {
  const identity = "github.com/acme/editor";
  const otherKey = "remote:linux:runner:other";
  const other = { ...remote, rootKey: otherKey, rootPath: otherKey, ownerId: otherKey };
  const inventory = [local, remote, other];
  const inventorySource = agentProjectGroups(inventory, views, []);
  const identities = new Map(inventory.map((project) => [project.rootKey, identity]));
  const none = new Map<string, string>();
  const grouping = (
    mode: AgentProjectGroupingMode,
    overrides: ReadonlyArray<readonly [string, AgentProjectGroupingMode]> = [],
  ): AgentProjectGroupingSettings => ({ mode, overrides: new Map(overrides) });
  const membersOf = (groups: ReturnType<typeof groupedEnvironmentProjects>) =>
    groups.map((group) => group.memberProjectRootKeys ?? [group.projectRootKey]);

  it("makes explicit repository settings equal the default for every existing fixture", () => {
    const fixtures = [
      { links, identities: undefined },
      { links: none, identities: undefined },
      { links: new Map([[remoteKey, "/gone"]]), identities: undefined },
      { links: none, identities: new Map(projects.map((project) => [project.rootKey, identity])) },
      {
        links: none,
        identities: new Map([
          [local.rootKey, identity],
          [remoteKey, "gitlab.com/acme/editor"],
        ]),
      },
      { links: none, identities: new Map([[remoteKey, identity]]) },
      {
        links,
        identities: new Map([
          [local.rootKey, identity],
          [remoteKey, "github.com/me/editor"],
        ]),
      },
    ];
    for (const fixture of fixtures) {
      const today = groupedEnvironmentProjects(source, projects, fixture.links, fixture.identities);
      for (const settings of [DEFAULT_AGENT_PROJECT_GROUPING_SETTINGS, grouping("repository")]) {
        const next = groupedEnvironmentProjects(
          source,
          projects,
          fixture.links,
          fixture.identities,
          settings,
        );
        expect(next).toEqual(today);
        expect(next.map((group) => source.indexOf(group))).toEqual(
          today.map((group) => source.indexOf(group)),
        );
      }
    }
    expect(groupedEnvironmentProjects(source, projects, links, undefined, undefined)).toEqual(
      groupedEnvironmentProjects(source, projects, links),
    );
  });

  it("splits identity groups into unchanged physical projects when kept separate", () => {
    const groups = groupedEnvironmentProjects(
      inventorySource,
      inventory,
      none,
      identities,
      grouping("separate"),
    );
    expect(groups).toHaveLength(3);
    expect(groups.map((group, index) => group === inventorySource[index])).toEqual([
      true,
      true,
      true,
    ]);
    expect(groups.every((group) => group.memberProjectRootKeys === undefined)).toBe(true);
  });

  it("keeps an explicit connection together when projects are kept separate", () => {
    const groups = groupedEnvironmentProjects(
      inventorySource,
      inventory,
      links,
      identities,
      grouping("separate"),
    );
    expect(membersOf(groups)).toEqual([[local.rootKey, remoteKey], [otherKey]]);
    expect(groups[0]?.label).toBe(local.label);
    expect(groups[0]?.repos).toEqual([...inventorySource[0]!.repos, ...inventorySource[1]!.repos]);
    expect(groups[0]?.liveCount).toBe(
      inventorySource[0]!.liveCount + inventorySource[1]!.liveCount,
    );
    expect(groups[1]).toBe(inventorySource[2]);
    const overridden = groupedEnvironmentProjects(
      inventorySource,
      inventory,
      links,
      identities,
      grouping("repository", [
        [local.rootKey, "separate"],
        [remoteKey, "separate"],
      ]),
    );
    expect(membersOf(overridden)).toEqual([[local.rootKey, remoteKey], [otherKey]]);
  });

  it("lets a linked member follow its local project even when it is overridden to separate", () => {
    const groups = groupedEnvironmentProjects(
      inventorySource,
      inventory,
      links,
      identities,
      grouping("repository", [[remoteKey, "separate"]]),
    );
    expect(membersOf(groups)).toEqual([[local.rootKey, remoteKey, otherKey]]);
    expect(groups[0]?.label).toBe(local.label);
    const unlinked = groupedEnvironmentProjects(
      inventorySource,
      inventory,
      none,
      identities,
      grouping("repository", [[remoteKey, "separate"]]),
    );
    expect(membersOf(unlinked)).toEqual([[local.rootKey, otherKey], [remoteKey]]);
  });

  it("removes only the overridden member from its identity group", () => {
    const groups = groupedEnvironmentProjects(
      inventorySource,
      inventory,
      none,
      identities,
      grouping("repository", [[remoteKey, "separate"]]),
    );
    expect(membersOf(groups)).toEqual([[local.rootKey, otherKey], [remoteKey]]);
    expect(groups[1]).toBe(inventorySource[1]);
    expect(groups[0]?.repos).toEqual([...inventorySource[0]!.repos, ...inventorySource[2]!.repos]);
  });

  it("groups only the overridden members when the default keeps projects separate", () => {
    const groups = groupedEnvironmentProjects(
      inventorySource,
      inventory,
      none,
      identities,
      grouping("separate", [
        [local.rootKey, "repository"],
        [otherKey, "repository"],
      ]),
    );
    expect(membersOf(groups)).toEqual([[local.rootKey, otherKey], [remoteKey]]);
  });

  it("routes the composer to exact members under every grouping mode", () => {
    const separate = groupedEnvironmentProjects(
      source,
      projects,
      none,
      identities,
      grouping("separate"),
    );
    expect(environmentComposerScope(scope, separate, projects, null)).toBe(scope);
    expect(environmentComposerScope(scope, separate, projects, "linux")?.kind).toBe("missing");
    const linked = groupedEnvironmentProjects(
      source,
      projects,
      links,
      identities,
      grouping("separate"),
    );
    expect(environmentComposerScope(scope, linked, projects, "linux")).toMatchObject({
      kind: "project",
      projectRootKey: remoteKey,
      ownerId: remoteKey,
    });
    const overridden = groupedEnvironmentProjects(
      inventorySource,
      inventory,
      none,
      identities,
      grouping("repository", [[remoteKey, "separate"]]),
    );
    expect(environmentComposerScope(scope, overridden, inventory, "linux")).toMatchObject({
      kind: "project",
      projectRootKey: otherKey,
      ownerId: otherKey,
    });
    expect(remoteView.thread.owner.rootKey).toBe(remoteKey);
  });
});
