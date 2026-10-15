import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_PROJECT_GROUPING_SETTINGS,
  type AgentProjectGroupingMode,
  type AgentProjectGroupingSettings,
} from "../../domain/agentProjectGrouping";
import { agentProjectGroups } from "./agentModePresentation";
import { agentRailOwnedViews } from "./agentRailProjectLayout";
import { agentRailScopeEntries, agentRailSections } from "./agentSidebarPresentation";
import {
  environmentComposerScope,
  groupedEnvironmentProjects,
  missingServerCounterpart,
  newThreadEnvironmentProjectRootKey,
} from "./agentEnvironmentProjects";
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
  it("resets a new draft in the exact selected environment of a linked display project", () => {
    const groups = groupedEnvironmentProjects(source, projects, links);
    expect(newThreadEnvironmentProjectRootKey(local.rootKey, groups, projects, "linux")).toBe(
      remoteKey,
    );
    expect(newThreadEnvironmentProjectRootKey(remoteKey, groups, projects, null)).toBe(remoteKey);
    expect(newThreadEnvironmentProjectRootKey(local.rootKey, groups, projects, "other")).toBeNull();
    expect(newThreadEnvironmentProjectRootKey(null, groups, projects, "linux")).toBeNull();
  });

  it("keeps unlinked new-thread destinations because they select their own environment", () => {
    expect(newThreadEnvironmentProjectRootKey(local.rootKey, source, projects, "linux")).toBe(
      local.rootKey,
    );
    expect(newThreadEnvironmentProjectRootKey(remoteKey, source, projects, null)).toBe(remoteKey);
  });

  it("refuses ambiguous linked draft destinations", () => {
    const second = { ...remote, rootKey: "remote:linux:runner:other" };
    const groups = [
      { ...source[0]!, memberProjectRootKeys: [local.rootKey, remoteKey, second.rootKey] },
    ];
    expect(
      newThreadEnvironmentProjectRootKey(local.rootKey, groups, [...projects, second], "linux"),
    ).toBeNull();
    const explicit = {
      ...scope,
      kind: "repository" as const,
      projectRootKey: remoteKey,
      repositoryRoot: remote.rootPath,
      ownerId: remote.ownerId,
      generation: remote.generation,
    };
    expect(
      newThreadEnvironmentProjectRootKey(
        local.rootKey,
        groups,
        [...projects, second],
        "linux",
        explicit,
      ),
    ).toBe(remoteKey);
    expect(
      newThreadEnvironmentProjectRootKey(local.rootKey, groups, [...projects, second], "linux", {
        ...explicit,
        generation: 99,
      }),
    ).toBeNull();
  });

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

  it("routes a separately displayed project to the only checkout of its repository and back", () => {
    const known = new Map(projects.map((project) => [project.rootKey, identity]));
    const separate = groupedEnvironmentProjects(
      source,
      projects,
      none,
      known,
      grouping("separate"),
    );
    expect(membersOf(separate)).toEqual([[local.rootKey], [remoteKey]]);
    expect(environmentComposerScope(scope, separate, projects, "linux", known)).toEqual({
      kind: "project",
      projectRootKey: remoteKey,
      repositoryRoot: remote.rootPath,
      ownerId: remote.ownerId,
      generation: remote.generation,
    });
    expect(environmentComposerScope(scope, separate, projects, null, known)).toBe(scope);
    const serverScope = {
      kind: "project" as const,
      projectRootKey: remoteKey,
      repositoryRoot: remote.rootPath,
      ownerId: remote.ownerId,
      generation: remote.generation,
    };
    expect(environmentComposerScope(serverScope, separate, projects, "linux", known)).toBe(
      serverScope,
    );
    expect(environmentComposerScope(serverScope, separate, projects, null, known)).toEqual(scope);
    expect(environmentComposerScope(scope, separate, projects, "other", known)?.kind).toBe(
      "missing",
    );
  });

  it("never routes by label when a repository identity is unknown or different", () => {
    const sameLabel = { ...remote, label: local.label };
    const labelled = [local, sameLabel];
    const labelledSource = agentProjectGroups(labelled, views, []);
    const fixtures = [
      new Map([[local.rootKey, identity]]),
      new Map([[remoteKey, identity]]),
      new Map([
        [local.rootKey, identity],
        [remoteKey, "gitlab.com/acme/editor"],
      ]),
      none,
    ];
    for (const known of fixtures) {
      for (const settings of [grouping("separate"), grouping("repository")]) {
        const groups = groupedEnvironmentProjects(labelledSource, labelled, none, known, settings);
        expect(environmentComposerScope(scope, groups, labelled, "linux", known)?.kind).toBe(
          "missing",
        );
      }
    }
  });

  it("requires an explicit choice between several checkouts of the repository on one server", () => {
    const separate = groupedEnvironmentProjects(
      inventorySource,
      inventory,
      none,
      identities,
      grouping("separate"),
    );
    expect(environmentComposerScope(scope, separate, inventory, "linux", identities)?.kind).toBe(
      "missing",
    );
    const chosen = {
      kind: "repository" as const,
      projectRootKey: otherKey,
      repositoryRoot: other.rootPath,
      ownerId: other.ownerId,
      generation: other.generation,
    };
    expect(environmentComposerScope(chosen, separate, inventory, "linux", identities)).toBe(chosen);
  });

  it("prefers the displayed member over another checkout of the same repository", () => {
    const overridden = groupedEnvironmentProjects(
      inventorySource,
      inventory,
      none,
      identities,
      grouping("repository", [[remoteKey, "separate"]]),
    );
    expect(
      environmentComposerScope(scope, overridden, inventory, "linux", identities),
    ).toMatchObject({ kind: "project", projectRootKey: otherKey, ownerId: otherKey });
  });

  it("never routes to a checkout that an explicit connection binds to another project", () => {
    const elsewhereRoot = "/workspace/elsewhere";
    const elsewhere = projectFixture({
      rootKey: elsewhereRoot,
      rootPath: elsewhereRoot,
      ownerId: "agent-root:elsewhere",
      label: "elsewhere",
      repositories: [fixtureRepository(elsewhereRoot, "")],
    });
    const elsewhereScope = {
      kind: "project" as const,
      projectRootKey: elsewhere.rootKey,
      repositoryRoot: elsewhere.rootPath,
      ownerId: elsewhere.ownerId,
      generation: elsewhere.generation,
    };
    const bound = new Map([[remoteKey, elsewhere.rootKey]]);
    const locals = new Map([
      [local.rootKey, identity],
      [elsewhere.rootKey, "github.com/acme/elsewhere"],
    ]);
    const fixtures = [
      { listed: [local, elsewhere, remote], known: new Map([...locals, [remoteKey, identity]]) },
      { listed: [local, elsewhere, { ...remote, repositoryIdentity: identity }], known: locals },
    ];
    for (const { listed, known } of fixtures) {
      for (const settings of [grouping("separate"), grouping("repository")]) {
        const groups = groupedEnvironmentProjects(
          agentProjectGroups(listed, views, []),
          listed,
          bound,
          known,
          settings,
        );
        expect(membersOf(groups)).toEqual([[local.rootKey], [elsewhere.rootKey, remoteKey]]);
        expect(environmentComposerScope(scope, groups, listed, "linux", known, bound)?.kind).toBe(
          "missing",
        );
        expect(
          environmentComposerScope(elsewhereScope, groups, listed, "linux", known, bound),
        ).toMatchObject({ kind: "project", projectRootKey: remoteKey });
        const free = [...listed, other];
        const freeKnown = new Map([...known, [otherKey, identity]]);
        const freeGroups = groupedEnvironmentProjects(
          agentProjectGroups(free, views, []),
          free,
          bound,
          freeKnown,
          grouping("separate"),
        );
        expect(
          environmentComposerScope(scope, freeGroups, free, "linux", freeKnown, bound),
        ).toMatchObject({ kind: "project", projectRootKey: otherKey });
      }
    }
    const known = new Map(projects.map((project) => [project.rootKey, identity]));
    const stale = new Map([[remoteKey, "/gone"]]);
    const separate = groupedEnvironmentProjects(
      source,
      projects,
      stale,
      known,
      grouping("separate"),
    );
    expect(
      environmentComposerScope(scope, separate, projects, "linux", known, stale),
    ).toMatchObject({ kind: "project", projectRootKey: remoteKey });
  });

  it("anchors repository routing to the scoped project inside a mixed-identity group", () => {
    const fork = "github.com/me/editor";
    const forkKey = "remote:second:runner:fork";
    const forkCheckout = { ...remote, rootKey: forkKey, rootPath: forkKey, ownerId: forkKey };
    const ownKey = "remote:second:runner:own";
    const ownCheckout = { ...remote, rootKey: ownKey, rootPath: ownKey, ownerId: ownKey };
    const listed = [local, remote, forkCheckout];
    const known = new Map([
      [local.rootKey, identity],
      [remoteKey, fork],
      [forkKey, fork],
    ]);
    for (const settings of [grouping("separate"), grouping("repository")]) {
      const groups = groupedEnvironmentProjects(
        agentProjectGroups(listed, views, []),
        listed,
        links,
        known,
        settings,
      );
      expect(membersOf(groups)).toEqual([[local.rootKey, remoteKey], [forkKey]]);
      expect(environmentComposerScope(scope, groups, listed, "linux", known, links)).toMatchObject({
        kind: "project",
        projectRootKey: remoteKey,
      });
      expect(environmentComposerScope(scope, groups, listed, "second", known, links)?.kind).toBe(
        "missing",
      );
      const anonymous = new Map([...known].filter(([rootKey]) => rootKey !== local.rootKey));
      expect(
        environmentComposerScope(scope, groups, listed, "second", anonymous, links)?.kind,
      ).toBe("missing");
    }
    const withOwn = [...listed, ownCheckout];
    const ownKnown = new Map([...known, [ownKey, identity]]);
    const ownGroups = groupedEnvironmentProjects(
      agentProjectGroups(withOwn, views, []),
      withOwn,
      links,
      ownKnown,
      grouping("separate"),
    );
    expect(
      environmentComposerScope(scope, ownGroups, withOwn, "second", ownKnown, links),
    ).toMatchObject({ kind: "project", projectRootKey: ownKey });
  });

  it("never routes to a repository checkout that cannot accept a draft", () => {
    const known = new Map(projects.map((project) => [project.rootKey, identity]));
    const refused = [
      { ...remote, trust: "untrusted" as const },
      { ...remote, origin: "closed-tab-live-tasks" as const },
    ];
    for (const checkout of refused) {
      const listed = [local, checkout];
      const separate = groupedEnvironmentProjects(
        agentProjectGroups(listed, views, []),
        listed,
        none,
        known,
        grouping("separate"),
      );
      expect(environmentComposerScope(scope, separate, listed, "linux", known)?.kind).toBe(
        "missing",
      );
    }
  });

  it("routes to the only checkout that accepts a draft next to one that cannot", () => {
    const duplicateRoot = "/workspace/duplicate";
    const duplicate = projectFixture({
      rootKey: duplicateRoot,
      rootPath: duplicateRoot,
      ownerId: "agent-root:duplicate",
      label: "duplicate",
      repositories: [fixtureRepository(duplicateRoot, "")],
    });
    const serverScope = {
      kind: "project" as const,
      projectRootKey: remoteKey,
      repositoryRoot: remote.rootPath,
      ownerId: remote.ownerId,
      generation: remote.generation,
    };
    const refusals = [
      { trust: "untrusted" as const },
      { origin: "closed-tab-live-tasks" as const },
    ];
    for (const refusal of refusals) {
      const onServer = [local, remote, { ...other, ...refusal }];
      const serverGroups = groupedEnvironmentProjects(
        agentProjectGroups(onServer, views, []),
        onServer,
        none,
        identities,
        grouping("separate"),
      );
      expect(
        environmentComposerScope(scope, serverGroups, onServer, "linux", identities),
      ).toMatchObject({ kind: "project", projectRootKey: remoteKey, ownerId: remoteKey });

      const known = new Map([...identities, [duplicate.rootKey, identity]]);
      const onComputer = [local, { ...duplicate, ...refusal }, remote];
      const computerGroups = groupedEnvironmentProjects(
        agentProjectGroups(onComputer, views, []),
        onComputer,
        none,
        known,
        grouping("separate"),
      );
      expect(
        environmentComposerScope(serverScope, computerGroups, onComputer, null, known),
      ).toEqual(scope);

      const refusedOnly = [{ ...duplicate, ...refusal }, remote];
      const refusedGroups = groupedEnvironmentProjects(
        agentProjectGroups(refusedOnly, views, []),
        refusedOnly,
        none,
        known,
        grouping("separate"),
      );
      expect(
        environmentComposerScope(serverScope, refusedGroups, refusedOnly, null, known)?.kind,
      ).toBe("missing");
    }
    const eligible = [local, duplicate, remote];
    const known = new Map([...identities, [duplicate.rootKey, identity]]);
    const eligibleGroups = groupedEnvironmentProjects(
      agentProjectGroups(eligible, views, []),
      eligible,
      none,
      known,
      grouping("separate"),
    );
    expect(environmentComposerScope(serverScope, eligibleGroups, eligible, null, known)?.kind).toBe(
      "missing",
    );
  });
});

describe("local project missing on the selected server", () => {
  const folder = projectFixture({
    rootKey: "/workspace/playablemaker",
    rootPath: "/workspace/playablemaker",
    ownerId: "agent-root:playablemaker",
    label: "playablemaker",
    repositories: [fixtureRepository("/workspace/playablemaker/pa-ai-be", "pa-ai-be")],
  });
  const folderScope = {
    kind: "project" as const,
    projectRootKey: folder.rootKey,
    repositoryRoot: folder.rootPath,
    ownerId: folder.ownerId,
    generation: folder.generation,
  };
  const serverProject = (name: string, label = name) => {
    const rootKey = `remote:linux:runner:${name}`;
    return projectFixture({ rootKey, rootPath: rootKey, ownerId: rootKey, label });
  };

  function counterpart(
    inventory: ReturnType<typeof projectFixture>[],
    serverId: string | null,
    projectLinks: ReadonlyMap<string, string> = new Map(),
  ) {
    const groups = groupedEnvironmentProjects(
      agentProjectGroups(inventory, [], []),
      inventory,
      projectLinks,
    );
    return missingServerCounterpart(
      folderScope,
      groups,
      inventory,
      serverId,
      new Map(),
      projectLinks,
    );
  }

  it("offers the selected local project when the server has no counterpart", () => {
    expect(counterpart([folder, serverProject("codevo-editor")], "linux")).toBe(folder);
  });

  it("offers nothing locally, on a linked server, or next to a same-named server project", () => {
    const added = serverProject("playablemaker");
    expect(counterpart([folder, added], null)).toBeNull();
    expect(
      counterpart([folder, added], "linux", new Map([[added.rootKey, folder.rootKey]])),
    ).toBeNull();
    expect(counterpart([folder, added], "linux")).toBeNull();
  });

  it("never offers an untrusted local project or a scope that already failed", () => {
    const untrusted = { ...folder, trust: "untrusted" as const };
    expect(counterpart([untrusted], "linux")).toBeNull();
    expect(
      missingServerCounterpart(
        { kind: "missing", projectRootKey: folder.rootKey, repositoryRoot: folder.rootPath },
        [],
        [folder],
        "linux",
      ),
    ).toBeNull();
  });
});
