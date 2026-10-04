import { describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import { environmentComposerScope, groupedEnvironmentProjects } from "./agentEnvironmentProjects";
import { agentGitHistoryScope } from "./agentGitHistoryTarget";
import {
  DETACHED_AGENT_PROJECT_ROOT_KEY,
  agentProjectGroups,
  type AgentProjectGroup,
} from "./agentModePresentation";
import {
  agentProjectDisplayLabels,
  agentProjectGroupDisplayName,
  agentProjectGroupsWithDisplayLabels,
  agentProjectGroupsWithDisplayNames,
  agentProjectRenameConflict,
  agentProjectRenameTarget,
  agentProjectsWithDisplayLabels,
} from "./agentProjectDisplayNames";
import {
  agentProjectCloseLabel,
  agentProjectMenuEntries,
  agentProjectMenuTarget,
} from "./agentProjectMenuPresentation";
import { agentProjectBadgeMonogram, agentProjectMonogram } from "./agentProjectMonogram";
import {
  agentRailProjectLabels,
  agentRailScopeEntries,
  agentRailScopeEntryFor,
  agentRailScopeFromEntry,
  agentRailScopeLabel,
  agentRowProjectLabel,
} from "./agentSidebarPresentation";
import { agentSurfaceScopeFor } from "./agentSurfacePolicy";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import { agentThreadNotificationSubjects } from "./agentThreadNotificationSubjects";
import { fixtureRepository, projectFixture } from "./agentThreadsSurfaceTestFixtures";

const LOCAL = "/Users/dev/editor";
const SERVER = "remote:linux:runner:codevo-editor";
const BACKUP = "remote:backup:runner:codevo-editor";
const API = "/Users/dev/api";
const IDENTITY = "github.com/codevo/editor";

function project(rootKey: string, label: string, identity?: string): AgentProjectDescriptor {
  return projectFixture({
    rootKey,
    rootPath: rootKey,
    ownerId: `owner:${rootKey}`,
    label,
    repositories: [fixtureRepository(rootKey, "")],
    ...(identity === undefined ? {} : { repositoryIdentity: identity }),
  });
}

function threadIn(threadId: string, rootKey: string): AgentThreadView {
  const base = surfaceThreadView();
  return {
    ...base,
    repositoryLabel: "folder",
    thread: {
      ...base.thread,
      threadId,
      owner: { rootKey, ownerId: `owner:${rootKey}`, repositoryRoot: rootKey },
    },
  };
}

const projects = [
  project(SERVER, "codevo-editor", IDENTITY),
  project(LOCAL, "editor", IDENTITY),
  project(BACKUP, "codevo-editor", IDENTITY),
  project(API, "api"),
];
const views = [threadIn("local", LOCAL), threadIn("server", SERVER), threadIn("api", API)];

function mergedGroups(): ReadonlyArray<AgentProjectGroup> {
  return groupedEnvironmentProjects(agentProjectGroups(projects, views, []), projects, new Map());
}

describe("project display names over grouped projects", () => {
  it("returns the same groups when nothing was renamed", () => {
    const groups = mergedGroups();

    expect(agentProjectGroupsWithDisplayNames(groups, new Map())).toBe(groups);
    expect(agentProjectGroupsWithDisplayNames(groups, new Map([["/unrelated", "Other"]]))).toBe(
      groups,
    );
  });

  it("names a merged project once for every checkout and leaves other projects alone", () => {
    const groups = mergedGroups();
    const named = agentProjectGroupsWithDisplayNames(
      groups,
      new Map([
        [LOCAL, "Codevo"],
        [SERVER, "Codevo"],
        [BACKUP, "Codevo"],
      ]),
    );

    expect(groups.map((group) => group.label)).toEqual(["editor", "api"]);
    expect(named.map((group) => group.label)).toEqual(["Codevo", "api"]);
    expect(named[1]).toBe(groups[1]);
  });

  it("shows the name in the switcher entries, rail labels, monograms and thread locations", () => {
    const named = agentProjectGroupsWithDisplayNames(mergedGroups(), new Map([[LOCAL, "Codevo"]]));
    const entries = agentRailScopeEntries(named);
    const entry = entries[0]!;
    const labels = agentRailProjectLabels(named);

    expect(entries.map((candidate) => candidate.label)).toEqual(["Codevo", "api"]);
    expect(agentRailScopeLabel(agentRailScopeFromEntry(entry), entries)).toBe("Codevo");
    expect(agentProjectMonogram(entry.label)).toBe("C");
    expect(agentProjectBadgeMonogram(entry.label)).toBe("CO");
    expect(agentProjectCloseLabel(entry)).toBe("Close project Codevo");
    expect(agentRowProjectLabel(labels, views[0]!)).toBe("Codevo");
    expect(agentRowProjectLabel(labels, views[1]!)).toBe("Codevo");
    expect(agentRowProjectLabel(labels, views[2]!)).toBe("api");
  });

  it("never changes identity, membership, selection or execution scope", () => {
    const groups = mergedGroups();
    const named = agentProjectGroupsWithDisplayNames(groups, new Map([[SERVER, "Codevo"]]));
    const withoutLabels = (source: ReadonlyArray<AgentProjectGroup>) =>
      source.map((group) => ({ ...group, label: "", defaultLabel: "" }));
    const entry = agentRailScopeEntries(named)[0]!;
    const original = agentRailScopeEntries(groups)[0]!;
    const scope = {
      kind: "project" as const,
      projectRootKey: LOCAL,
      repositoryRoot: LOCAL,
      ownerId: `owner:${LOCAL}`,
      generation: 0,
    };

    expect(withoutLabels(named)).toEqual(withoutLabels(groups));
    expect({ ...entry, label: "", defaultLabel: "" }).toEqual({
      ...original,
      label: "",
      defaultLabel: "",
    });
    expect(entry.defaultLabel).toBe("editor");
    expect(original.defaultLabel).toBeUndefined();
    expect(agentProjectMenuTarget(entry)).toEqual(agentProjectMenuTarget(original));
    expect(agentRailScopeEntryFor(agentRailScopeEntries(named), SERVER)?.projectRootKey).toBe(
      LOCAL,
    );
    expect(environmentComposerScope(scope, named, projects, "linux")).toEqual(
      environmentComposerScope(scope, groups, projects, "linux"),
    );
    expect(environmentComposerScope(scope, named, projects, "linux")).toEqual({
      kind: "project",
      projectRootKey: SERVER,
      repositoryRoot: SERVER,
      ownerId: `owner:${SERVER}`,
      generation: 0,
    });
    expect(projects.map((candidate) => candidate.label)).toEqual([
      "codevo-editor",
      "editor",
      "codevo-editor",
      "api",
    ]);
  });

  it("resolves disagreeing checkouts by the local representative, then a stable member order", () => {
    const groups = mergedGroups();
    const merged = groups[0]!;

    expect(merged.projectRootKey).toBe(LOCAL);
    expect(
      agentProjectGroupDisplayName(
        merged,
        new Map([
          [SERVER, "Server name"],
          [LOCAL, "Local name"],
          [BACKUP, "Backup name"],
        ]),
      ),
    ).toBe("Local name");
    expect(
      agentProjectGroupDisplayName(
        merged,
        new Map([
          [SERVER, "Server name"],
          [BACKUP, "Backup name"],
        ]),
      ),
    ).toBe("Backup name");

    const reordered = [...projects].reverse();
    const reorderedGroups = groupedEnvironmentProjects(
      agentProjectGroups(reordered, views, []),
      reordered,
      new Map(),
    );
    expect(
      agentProjectGroupDisplayName(
        reorderedGroups.find((group) => group.projectRootKey === LOCAL)!,
        new Map([
          [SERVER, "Server name"],
          [BACKUP, "Backup name"],
        ]),
      ),
    ).toBe("Backup name");
  });

  it("targets every checkout of a merged project from any of its members", () => {
    const groups = mergedGroups();
    const names = new Map([[SERVER, "Codevo"]]);
    const expected = {
      projectRootKey: LOCAL,
      memberRootKeys: [LOCAL, BACKUP, SERVER],
      offlineRootKeys: [],
      displayedElsewhereRootKeys: [API],
      defaultLabel: "editor",
      displayName: "Codevo",
      otherProjectLabels: ["api"],
    };

    expect(agentProjectRenameTarget(groups, names, LOCAL)).toEqual({
      ...expected,
      requestedRootKey: LOCAL,
    });
    expect(agentProjectRenameTarget(groups, names, SERVER)).toEqual({
      ...expected,
      requestedRootKey: SERVER,
    });
    expect(agentProjectRenameTarget(groups, new Map(), API)).toEqual({
      requestedRootKey: API,
      projectRootKey: API,
      memberRootKeys: [API],
      offlineRootKeys: [],
      displayedElsewhereRootKeys: [LOCAL, SERVER, BACKUP],
      defaultLabel: "api",
      displayName: null,
      otherProjectLabels: ["editor"],
    });
  });

  it("offers rename for local, server and merged projects", () => {
    const separate = agentRailScopeEntries(agentProjectGroups(projects, views, []));
    const merged = agentRailScopeEntries(mergedGroups());

    for (const entry of [...separate, ...merged]) {
      expect(agentProjectMenuEntries(entry)).toContainEqual({
        id: "rename",
        label: "Rename project…",
        command: "rename",
        disabled: false,
      });
    }
    expect(separate.map((entry) => entry.projectRootKey)).toEqual([SERVER, LOCAL, BACKUP, API]);
  });

  it("has no rename target for an unknown project or the removed-projects bucket", () => {
    const orphanView = threadIn("gone", "/Users/dev/gone");
    const groups = agentProjectGroups(projects, [...views, orphanView], []);
    const detached = groups.find((group) => group.kind === "detached")!;
    const names = new Map([[DETACHED_AGENT_PROJECT_ROOT_KEY, "Renamed"]]);

    expect(detached.projectRootKey).toBe(DETACHED_AGENT_PROJECT_ROOT_KEY);
    expect(agentProjectRenameTarget(groups, names, DETACHED_AGENT_PROJECT_ROOT_KEY)).toBeNull();
    expect(agentProjectRenameTarget(groups, names, "/Users/dev/unknown")).toBeNull();
    expect(agentProjectGroupDisplayName(detached, names)).toBeNull();
    expect(agentProjectGroupsWithDisplayNames(groups, names)).toBe(groups);
  });

  it("counts linked checkouts that are offline and never ones displayed in another group", () => {
    const token = "aaaaaaaaaaaaaaaa";
    const entries = new Map([
      [LOCAL, { name: "Flagship", token }],
      [SERVER, { name: "Flagship", token }],
      [BACKUP, { name: "Flagship", token }],
      [API, { name: "Flagship", token: "bbbbbbbbbbbbbbbb" }],
    ]);
    const names = new Map([...entries].map(([rootKey, entry]) => [rootKey, entry.name]));
    const offline = projects.filter(
      (candidate) => candidate.rootKey === LOCAL || candidate.rootKey === API,
    );
    const groups = groupedEnvironmentProjects(
      agentProjectGroups(offline, views, []),
      offline,
      new Map(),
    );
    const split = projects.map((candidate) => ({ ...candidate, repositoryIdentity: undefined }));
    const splitGroups = groupedEnvironmentProjects(
      agentProjectGroups(split, views, []),
      split,
      new Map(),
    );

    const target = agentProjectRenameTarget(groups, names, LOCAL, entries);
    expect(target?.memberRootKeys).toEqual([LOCAL]);
    expect(target?.offlineRootKeys).toEqual([BACKUP, SERVER]);
    expect(target?.displayedElsewhereRootKeys).toEqual([API]);
    expect(target?.otherProjectLabels).toEqual(["Flagship"]);

    const separate = agentProjectRenameTarget(splitGroups, names, LOCAL, entries);
    expect(separate?.memberRootKeys).toEqual([LOCAL]);
    expect(separate?.offlineRootKeys).toEqual([]);
    expect(separate?.displayedElsewhereRootKeys).toEqual([SERVER, BACKUP, API]);
    expect(agentProjectRenameTarget(groups, names, LOCAL)?.offlineRootKeys).toEqual([]);
  });

  it("flags a name another displayed project already shows, by display name or folder name", () => {
    const groups = mergedGroups();
    const target = agentProjectRenameTarget(groups, new Map([[API, "Backend"]]), LOCAL)!;
    const unnamed = agentProjectRenameTarget(groups, new Map(), LOCAL)!;

    expect(target.otherProjectLabels).toEqual(["Backend"]);
    expect(agentProjectRenameConflict(target, "Backend")).toBe("Backend");
    expect(agentProjectRenameConflict(target, "backend")).toBe("Backend");
    expect(agentProjectRenameConflict(target, "api")).toBeNull();
    expect(agentProjectRenameConflict(target, "editor")).toBeNull();
    expect(agentProjectRenameConflict(unnamed, "API")).toBe("api");
  });

  it("resolves one display label per physical checkout for every other surface", () => {
    const groups = mergedGroups();
    const labels = agentProjectDisplayLabels(groups, new Map([[SERVER, "Flagship"]]));
    const executionGroups = agentProjectGroups(projects, views, []);
    const namedProjects = agentProjectsWithDisplayLabels(projects, labels);
    const namedExecution = agentProjectGroupsWithDisplayLabels(executionGroups, labels);

    expect([...labels]).toEqual([
      [LOCAL, "Flagship"],
      [SERVER, "Flagship"],
      [BACKUP, "Flagship"],
    ]);
    expect(namedProjects.map((candidate) => candidate.label)).toEqual([
      "Flagship",
      "Flagship",
      "Flagship",
      "api",
    ]);
    expect(namedProjects.map((candidate) => ({ ...candidate, label: "" }))).toEqual(
      projects.map((candidate) => ({ ...candidate, label: "" })),
    );
    expect(namedProjects[3]).toBe(projects[3]);
    expect(namedExecution.map((group) => [group.projectRootKey, group.label])).toEqual([
      [SERVER, "Flagship"],
      [LOCAL, "Flagship"],
      [BACKUP, "Flagship"],
      [API, "api"],
    ]);
    expect(namedExecution.map((group) => group.repos)).toEqual(
      executionGroups.map((group) => group.repos),
    );
  });

  it("returns the same inputs when no displayed project has a name", () => {
    const groups = mergedGroups();
    const labels = agentProjectDisplayLabels(groups, new Map([["/unrelated", "Other"]]));

    expect(labels.size).toBe(0);
    expect(agentProjectDisplayLabels(groups, new Map())).toBe(labels);
    expect(agentProjectsWithDisplayLabels(projects, labels)).toBe(projects);
    expect(agentProjectGroupsWithDisplayLabels(groups, labels)).toBe(groups);
    expect(agentProjectsWithDisplayLabels(projects, new Map([[API, "api"]]))).toBe(projects);
  });

  it("names the project in the files and Git history switch prompts without changing their scope", () => {
    const labels = agentProjectDisplayLabels(mergedGroups(), new Map([[LOCAL, "Flagship"]]));
    const namedProjects = agentProjectsWithDisplayLabels(projects, labels);
    const scope = {
      kind: "project" as const,
      projectRootKey: LOCAL,
      repositoryRoot: LOCAL,
      ownerId: `owner:${LOCAL}`,
      generation: 0,
    };
    const named = agentSurfaceScopeFor(scope, namedProjects, API);
    const original = agentSurfaceScopeFor(scope, projects, API);

    expect(named).toEqual({ ...original, label: "Flagship" });
    expect(original).toEqual({
      kind: "foreignRoot",
      projectRootKey: LOCAL,
      repositoryRoot: LOCAL,
      rootPath: LOCAL,
      label: "editor",
    });
    expect(agentGitHistoryScope(namedProjects, null, named, API, true, null)).toEqual({
      kind: "unavailable",
      reason: "Switch to Flagship to browse its Git history.",
    });
    expect(agentGitHistoryScope(namedProjects, views[0]!, named, API, true, null)).toEqual({
      kind: "unavailable",
      reason: "Switch to Flagship to browse its Git history.",
    });
    expect(agentSurfaceScopeFor(scope, namedProjects, LOCAL)).toEqual(
      agentSurfaceScopeFor(scope, projects, LOCAL),
    );
    expect(agentGitHistoryScope(namedProjects, views[0]!, named, LOCAL, true, null)).toEqual(
      agentGitHistoryScope(projects, views[0]!, original, LOCAL, true, null),
    );
  });

  it("labels thread notifications with the display name and keeps their owner keys", () => {
    const labels = agentProjectDisplayLabels(mergedGroups(), new Map([[SERVER, "Flagship"]]));
    const namedProjects = agentProjectsWithDisplayLabels(projects, labels);
    const named = agentThreadNotificationSubjects(views, new Map(), namedProjects);
    const original = agentThreadNotificationSubjects(views, new Map(), projects);

    expect(named.map((subject) => subject.projectLabel)).toEqual(["Flagship", "Flagship", "api"]);
    expect(original.map((subject) => subject.projectLabel)).toEqual([
      "editor",
      "codevo-editor",
      "api",
    ]);
    expect(named.map((subject) => ({ ...subject, projectLabel: "" }))).toEqual(
      original.map((subject) => ({ ...subject, projectLabel: "" })),
    );
  });
});
