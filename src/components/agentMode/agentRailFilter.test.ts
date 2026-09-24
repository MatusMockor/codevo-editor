import { describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  ALL_PROJECTS_FILTER,
  agentProjectMonogram,
  agentRailFilterFollowingProject,
  agentRailFilterKey,
  agentRailFilterLabel,
  agentThreadsInFilter,
  reconcileAgentRailFilter,
  type AgentRailFilter,
} from "./agentRailFilter";
import type { AgentRailScopeEntry } from "./agentSidebarPresentation";

function entry(
  projectRootKey: string,
  label: string,
  members?: ReadonlyArray<string>,
): AgentRailScopeEntry {
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

function view(threadId: string, rootKey: string): AgentThreadView {
  return {
    thread: { threadId, owner: { rootKey, ownerId: "w", repositoryRoot: rootKey } },
  } as unknown as AgentThreadView;
}

const entries = [
  entry("/orders", "orders-api"),
  entry("/web", "web-dashboard", ["/web", "/web/packages/ui"]),
];
const views = [view("a", "/orders"), view("b", "/web/packages/ui"), view("c", "/gone")];
const orders: AgentRailFilter = { kind: "project", projectRootKey: "/orders" };

describe("agentRailFilter", () => {
  it("lists every thread of every open project for All projects and hides detached ones", () => {
    expect(
      agentThreadsInFilter(views, ALL_PROJECTS_FILTER, entries).map((v) => v.thread.threadId),
    ).toEqual(["a", "b"]);
  });

  it("narrows to one project including grouped member roots", () => {
    expect(agentThreadsInFilter(views, orders, entries).map((v) => v.thread.threadId)).toEqual([
      "a",
    ]);
    expect(
      agentThreadsInFilter(views, { kind: "project", projectRootKey: "/web" }, entries).map(
        (v) => v.thread.threadId,
      ),
    ).toEqual(["b"]);
  });

  it("falls back to All projects when the filtered project disappears", () => {
    expect(reconcileAgentRailFilter(orders, entries)).toBe(orders);
    expect(reconcileAgentRailFilter(orders, [entry("/web", "web-dashboard")])).toBe(
      ALL_PROJECTS_FILTER,
    );
  });

  it("follows the active project only when a single project is filtered", () => {
    expect(agentRailFilterFollowingProject(ALL_PROJECTS_FILTER, "/web", entries)).toBe(
      ALL_PROJECTS_FILTER,
    );
    expect(agentRailFilterFollowingProject(orders, "/web/packages/ui", entries)).toEqual({
      kind: "project",
      projectRootKey: "/web",
    });
    expect(agentRailFilterFollowingProject(orders, "/orders", entries)).toBe(orders);
    expect(agentRailFilterFollowingProject(orders, "/unknown", entries)).toBe(orders);
  });

  it("labels, keys and monograms", () => {
    expect(agentRailFilterLabel(ALL_PROJECTS_FILTER, entries)).toBe("All projects");
    expect(agentRailFilterLabel(orders, entries)).toBe("orders-api");
    expect(agentRailFilterKey(orders)).toBe("project:/orders");
    expect(agentRailFilterKey(ALL_PROJECTS_FILTER)).toBe("all");
    expect(agentProjectMonogram("orders-api")).toBe("O");
    expect(agentProjectMonogram("  .9lives")).toBe("9");
    expect(agentProjectMonogram("---")).toBe("?");
  });
});
