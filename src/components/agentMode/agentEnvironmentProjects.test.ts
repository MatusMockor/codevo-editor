import { describe, expect, it } from "vitest";
import { agentProjectGroups } from "./agentModePresentation";
import {
  agentRailScopeEntries,
  agentRailScopeFromEntry,
  agentRailSections,
} from "./agentSidebarPresentation";
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
    const sections = agentRailSections(views, agentRailScopeFromEntry(entry), false, 0);
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
