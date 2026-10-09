import { describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  agentHistoryCatalogRailThreadIds,
  agentHistoryCatalogScope,
  agentHistoryCatalogScopeIncludes,
  type AgentHistoryCatalogRail,
} from "./agentHistoryCatalogScope";
import type { AgentRailScopeEntry } from "./agentSidebarPresentation";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";

const A = { rootKey: "/workspace/a", label: "a" };
const B = { rootKey: "/workspace/b", label: "b" };
const REMOTE = "remote:server:/workspace/b";

function allProjects(currentProjectRootKey: string | null): AgentHistoryCatalogRail {
  return {
    focus: "all",
    visibleEntries: [{ projectRootKey: A.rootKey }, { projectRootKey: B.rootKey }],
    currentProjectRootKey,
  };
}

function focusedOn(
  projectRootKey: string,
  memberProjectRootKeys?: ReadonlyArray<string>,
): AgentHistoryCatalogRail {
  return {
    focus: "active",
    visibleEntries: [{ projectRootKey, memberProjectRootKeys }],
    currentProjectRootKey: projectRootKey,
  };
}

function entry(projectRootKey: string): AgentRailScopeEntry {
  return {
    value: projectRootKey,
    label: projectRootKey,
    projectRootKey,
    repositoryRoot: projectRootKey,
    trust: "trusted",
    origin: "active-tab",
    rootPath: projectRootKey,
    repositoryCount: 1,
    serverPresence: { local: true, remoteServerIds: [] },
  };
}

function view(threadId: string, rootKey: string, archived = false): AgentThreadView {
  const base = surfaceThreadView().thread;
  return surfaceThreadView({
    thread: {
      ...base,
      threadId,
      archived,
      owner: { rootKey, ownerId: `agent-root:${rootKey}`, repositoryRoot: rootKey },
    },
  });
}

describe("saved conversations scope", () => {
  it("offers only the focused project and opens on it", () => {
    expect(agentHistoryCatalogScope([A, B], focusedOn(B.rootKey))).toEqual({
      kind: "available",
      projects: [B],
      defaultRootKey: B.rootKey,
    });
  });

  it("offers every catalog project on all projects and opens on the current one", () => {
    expect(agentHistoryCatalogScope([A, B], allProjects(B.rootKey))).toEqual({
      kind: "available",
      projects: [A, B],
      defaultRootKey: B.rootKey,
    });
  });

  it("opens on the first catalog project when the current one is not in the catalog", () => {
    expect(agentHistoryCatalogScope([A, B], allProjects(REMOTE)).kind).toBe("available");
    expect(agentHistoryCatalogScope([A, B], allProjects(REMOTE))).toMatchObject({
      projects: [A, B],
      defaultRootKey: A.rootKey,
    });
    expect(agentHistoryCatalogScope([A, B], allProjects(null))).toMatchObject({
      defaultRootKey: A.rootKey,
    });
  });

  it("is not available when the focused project is absent from the catalog", () => {
    expect(agentHistoryCatalogScope([A, B], focusedOn(REMOTE))).toEqual({ kind: "unavailable" });
  });

  it("is not available without catalog projects", () => {
    expect(agentHistoryCatalogScope([], allProjects(null))).toEqual({ kind: "unavailable" });
    expect(agentHistoryCatalogScope([], focusedOn(B.rootKey))).toEqual({ kind: "unavailable" });
  });

  it("keeps every catalog project while an active focus has no current project", () => {
    expect(
      agentHistoryCatalogScope([A, B], {
        focus: "active",
        visibleEntries: [{ projectRootKey: B.rootKey }],
        currentProjectRootKey: null,
      }),
    ).toEqual({ kind: "available", projects: [A, B], defaultRootKey: A.rootKey });
  });

  it("serves the catalog members of a focused grouped project in catalog order", () => {
    expect(agentHistoryCatalogScope([A, B], focusedOn(B.rootKey, [B.rootKey, REMOTE]))).toEqual({
      kind: "available",
      projects: [B],
      defaultRootKey: B.rootKey,
    });
    expect(agentHistoryCatalogScope([A, B], focusedOn(B.rootKey, [B.rootKey, A.rootKey]))).toEqual({
      kind: "available",
      projects: [A, B],
      defaultRootKey: B.rootKey,
    });
    expect(agentHistoryCatalogScope([A, B], focusedOn(REMOTE, [REMOTE, B.rootKey]))).toEqual({
      kind: "available",
      projects: [B],
      defaultRootKey: B.rootKey,
    });
  });

  it("tells whether a project is in scope", () => {
    const scope = agentHistoryCatalogScope([A, B], focusedOn(B.rootKey));
    expect(agentHistoryCatalogScopeIncludes(scope, B.rootKey)).toBe(true);
    expect(agentHistoryCatalogScopeIncludes(scope, A.rootKey)).toBe(false);
    expect(agentHistoryCatalogScopeIncludes(scope, null)).toBe(false);
    expect(agentHistoryCatalogScopeIncludes({ kind: "unavailable" }, B.rootKey)).toBe(false);
  });
});

describe("saved conversations rail thread ids", () => {
  const entries = [entry(A.rootKey), entry(B.rootKey)];
  const views = [
    view("a-live", A.rootKey),
    view("a-archived", A.rootKey, true),
    view("b-live", B.rootKey),
    view("x-live", "/workspace/unlisted"),
  ];

  it("counts the live threads of the catalog project whatever the rail is focused on", () => {
    expect([...agentHistoryCatalogRailThreadIds(views, entries, A.rootKey)]).toEqual(["a-live"]);
    expect([...agentHistoryCatalogRailThreadIds(views, entries, B.rootKey)]).toEqual(["b-live"]);
  });

  it("counts nothing without a catalog page or for a project the rail does not list", () => {
    expect(agentHistoryCatalogRailThreadIds(views, entries, null).size).toBe(0);
    expect(agentHistoryCatalogRailThreadIds(views, entries, "/workspace/unlisted").size).toBe(0);
  });
});
