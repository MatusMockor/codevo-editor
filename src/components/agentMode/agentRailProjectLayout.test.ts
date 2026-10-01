import { describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentThread } from "../../domain/agentThread";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import {
  AGENT_RAIL_PROJECT_PREVIEW_COUNT,
  ALL_PROJECTS_EXPANDED,
  agentRailOwnedViews,
  agentRailProjectSections,
  agentRailThreadOrder,
  type AgentRailProjectDisclosureState,
} from "./agentRailProjectLayout";
import { agentRailSections, type AgentRailScopeEntry } from "./agentSidebarPresentation";

const APP = "/workspace/app";
const API = "/workspace/api";
const REMOTE_API = "remote:srv:/srv/api";
const NOW = 1_700_000_600_000;

function entry(projectRootKey: string, label: string, members?: string[]): AgentRailScopeEntry {
  return {
    memberProjectRootKeys: members,
    value: projectRootKey,
    label,
    projectRootKey,
    repositoryRoot: projectRootKey,
    trust: "trusted",
    origin: "active-tab",
    rootPath: projectRootKey,
    repositoryCount: 1,
  };
}

function thread(threadId: string, rootKey: string, metadata: Partial<AgentThread> = {}) {
  const base = surfaceThreadView().thread;
  return surfaceThreadView({
    thread: {
      ...base,
      threadId,
      owner: { rootKey, ownerId: `agent-root:${rootKey}`, repositoryRoot: rootKey },
      updatedAtEpochMs: NOW,
      ...metadata,
    },
  });
}

function disclosure(
  collapsed: ReadonlyArray<string> = [],
  showingAll: ReadonlyArray<string> = [],
): AgentRailProjectDisclosureState {
  return { collapsed: new Set(collapsed), showingAll: new Set(showingAll) };
}

function ids(views: ReadonlyArray<AgentThreadView>): ReadonlyArray<string> {
  return views.map((view) => view.thread.threadId);
}

function ordered(count: number, rootKey: string, prefix: string): AgentThreadView[] {
  return Array.from({ length: count }, (_, index) =>
    thread(`${prefix}-${index}`, rootKey, { sortOrder: index }),
  );
}

describe("agent rail project layout", () => {
  const entries = [entry(APP, "app"), entry(API, "api", [API, REMOTE_API])];

  it("nests each project's unpinned threads under it in project order and keeps pins out", () => {
    const views = [
      thread("api-1", API, { sortOrder: 1 }),
      thread("app-1", APP, { sortOrder: 1 }),
      thread("pin", APP, { pinned: true }),
      thread("remote-1", REMOTE_API, { sortOrder: 2 }),
      thread("detached", "/workspace/gone"),
    ];
    const sections = agentRailSections(agentRailOwnedViews(views, entries), NOW);
    const projects = agentRailProjectSections(sections, entries, ALL_PROJECTS_EXPANDED, null);

    expect(projects.map((project) => project.entry.label)).toEqual(["app", "api"]);
    expect(ids(projects[0]!.rows)).toEqual(["app-1"]);
    expect(ids(projects[1]!.rows)).toEqual(["api-1", "remote-1"]);
    expect(ids(sections.pinned)).toEqual(["pin"]);
    expect(agentRailOwnedViews(views, entries).map((view) => view.thread.threadId)).not.toContain(
      "detached",
    );
  });

  it("lists a project without threads as an empty group", () => {
    const sections = agentRailSections([], NOW);
    const projects = agentRailProjectSections(sections, entries, ALL_PROJECTS_EXPANDED, null);

    expect(projects.map((project) => [project.entry.label, project.rows.length])).toEqual([
      ["app", 0],
      ["api", 0],
    ]);
    expect(projects[0]!.overflow).toEqual({ kind: "none" });
  });

  it("counts a project's pinned, snoozed and settled threads apart from its active rows", () => {
    const views = [
      thread("pin", APP, { pinned: true }),
      thread("done", APP, { settledAt: NOW }),
      thread("api-1", API),
    ];
    const sections = agentRailSections(views, NOW);
    const projects = agentRailProjectSections(sections, entries, ALL_PROJECTS_EXPANDED, null);

    expect(projects.map((project) => [project.threads.length, project.shelved])).toEqual([
      [0, 2],
      [1, 0],
    ]);
  });

  it("hides a collapsed project's rows except the selected thread", () => {
    const sections = agentRailSections(ordered(3, APP, "app"), NOW);

    const hidden = agentRailProjectSections(sections, entries, disclosure([APP]), null);
    expect(hidden[0]!.collapsed).toBe(true);
    expect(hidden[0]!.rows).toEqual([]);
    expect(hidden[0]!.threads).toHaveLength(3);

    const selected = agentRailProjectSections(sections, entries, disclosure([APP]), "app-2");
    expect(ids(selected[0]!.rows)).toEqual(["app-2"]);
  });

  it("previews the first rows, keeps the selected one visible and offers Show more and Show less", () => {
    const total = AGENT_RAIL_PROJECT_PREVIEW_COUNT + 3;
    const sections = agentRailSections(ordered(total, APP, "app"), NOW);

    const preview = agentRailProjectSections(sections, entries, disclosure(), null)[0]!;
    expect(preview.rows).toHaveLength(AGENT_RAIL_PROJECT_PREVIEW_COUNT);
    expect(preview.overflow).toEqual({ kind: "more", hidden: 3 });

    const selectedId = `app-${total - 1}`;
    const withSelected = agentRailProjectSections(sections, entries, disclosure(), selectedId)[0]!;
    expect(ids(withSelected.rows)[withSelected.rows.length - 1]).toBe(selectedId);
    expect(withSelected.overflow).toEqual({ kind: "more", hidden: 2 });

    const all = agentRailProjectSections(sections, entries, disclosure([], [APP]), null)[0]!;
    expect(all.rows).toHaveLength(total);
    expect(all.overflow).toEqual({ kind: "less" });
  });

  it("orders keyboard navigation as pins, then each project's visible rows, skipping collapsed ones", () => {
    const views = [
      thread("pin", API, { pinned: true }),
      ...ordered(2, APP, "app"),
      ...ordered(2, API, "api"),
    ];

    expect(agentRailThreadOrder(views, entries, disclosure(), null, NOW)).toEqual([
      "pin",
      "app-0",
      "app-1",
      "api-0",
      "api-1",
    ]);
    expect(agentRailThreadOrder(views, entries, disclosure([APP]), null, NOW)).toEqual([
      "pin",
      "api-0",
      "api-1",
    ]);
    expect(agentRailThreadOrder(views, entries, disclosure([APP]), "app-1", NOW)).toEqual([
      "pin",
      "app-1",
      "api-0",
      "api-1",
    ]);
  });

  it("leaves snoozed, settled and archived threads out of the project groups", () => {
    const views = [
      thread("live", APP),
      thread("snoozed", APP, { snoozedUntil: NOW + 60_000 }),
      thread("settled", APP, { settledAt: NOW }),
      thread("archived", APP, { archived: true }),
    ];

    expect(agentRailThreadOrder(views, entries, disclosure(), null, NOW)).toEqual(["live"]);
  });
});
