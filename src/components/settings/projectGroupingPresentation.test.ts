import { describe, expect, it } from "vitest";
import type { RemoteProjectInventory } from "../../application/useRemoteProjectInventories";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { AgentProjectGroupingMode } from "../../domain/agentProjectGrouping";
import { projectFixture } from "../agentMode/agentThreadsSurfaceTestFixtures";
import {
  MAX_PROJECT_GROUPING_ROWS,
  projectGroupingList,
  projectGroupingModeLabel,
  projectGroupingSelection,
  projectGroupingWriteMessage,
  type ProjectGroupingListInput,
  type ProjectGroupingServer,
} from "./projectGroupingPresentation";

const server: ProjectGroupingServer = { id: "my server", name: "Linux", connected: true };
const WEB_KEY = "remote:my%20server:runner:web";
const API_KEY = "remote:my%20server:runner:api%2Fv2";
const app = localProject("/local/app", "app");

function localProject(
  rootKey: string,
  label: string,
  origin: AgentProjectDescriptor["origin"] = "active-tab",
): AgentProjectDescriptor {
  return projectFixture({ rootKey, rootPath: rootKey, label, origin });
}

function ready(...projects: ReadonlyArray<string>): RemoteProjectInventory {
  return {
    kind: "ready",
    runnerId: "runner",
    projects: projects.map((id) => ({ id, name: id.toUpperCase() })),
  };
}

function input(
  overrides: ReadonlyArray<readonly [string, AgentProjectGroupingMode]>,
  partial: Partial<ProjectGroupingListInput> = {},
): ProjectGroupingListInput {
  return {
    projects: [app],
    servers: [],
    inventories: new Map(),
    settings: { mode: "repository", overrides: new Map(overrides) },
    links: new Map(),
    displayNames: new Map(),
    ...partial,
  };
}

function summary(list: ReturnType<typeof projectGroupingList>) {
  return list.rows.map((row) => [row.rootKey, row.label, row.detail, row.availability]);
}

describe("project grouping presentation", () => {
  it("labels every mode in plain English", () => {
    expect(projectGroupingModeLabel("repository")).toBe("Group by repository");
    expect(projectGroupingModeLabel("separate")).toBe("Keep separate");
  });

  it("parses select values into a closed selection", () => {
    expect(projectGroupingSelection("")).toEqual({ kind: "selected", mode: null });
    expect(projectGroupingSelection("separate")).toEqual({ kind: "selected", mode: "separate" });
    expect(projectGroupingSelection("repository_path")).toEqual({ kind: "unsupported" });
  });

  it("explains every rejected save with an action the user can take", () => {
    expect(projectGroupingWriteMessage("tooManyOverrides")).toContain(
      "Set a listed project to Use default",
    );
    expect(projectGroupingWriteMessage("storageCorrupt")).toContain("Reset grouping settings");
    expect(projectGroupingWriteMessage("storageUnavailable")).toContain("Could not save");
    expect(projectGroupingWriteMessage("invalidProject")).toBe(
      projectGroupingWriteMessage("invalidMode"),
    );
  });

  it("lists open local projects, labels closed tabs and marks closed projects unavailable", () => {
    const list = projectGroupingList(
      input(
        [
          ["/closed/site/", "separate"],
          ["/local/app", "separate"],
        ],
        { projects: [app, localProject("/local/tasks", "tasks", "closed-tab-live-tasks")] },
      ),
    );
    expect(summary(list)).toEqual([
      ["/local/app", "app", "/local/app", "available"],
      ["/local/tasks", "tasks", "/local/tasks, tab closed", "available"],
      ["/closed/site/", "site", "/closed/site/, not open", "unavailable"],
    ]);
    expect(list.rows.map((row) => row.override)).toEqual(["separate", null, "separate"]);
    expect(list.unavailableRootKeys).toEqual(["/closed/site/"]);
    expect(list.total).toBe(3);
  });

  it("uses exact encoded server project keys and marks missing saved projects unavailable", () => {
    const list = projectGroupingList(
      input([[API_KEY, "separate"]], {
        projects: [],
        servers: [server],
        inventories: new Map([[server.id, ready("web")]]),
      }),
    );
    expect(summary(list)).toEqual([
      [WEB_KEY, "WEB", "Linux", "available"],
      [API_KEY, "api/v2", "Linux, not available", "unavailable"],
    ]);
    expect(list.unavailableRootKeys).toEqual([API_KEY]);
  });

  it.each<readonly [string, ProjectGroupingServer, RemoteProjectInventory | null, string]>([
    ["a pending load", server, { kind: "loading" }, "Linux, loading"],
    ["a slow load", server, { kind: "slow" }, "Linux, loading"],
    ["a failed load", server, { kind: "failed" }, "Linux, not loaded"],
    ["a server beyond the load limit", server, null, "Linux, not loaded"],
    [
      "a disconnected server",
      { ...server, connected: false },
      ready("api/v2"),
      "Linux, not connected",
    ],
  ])(
    "keeps saved overrides for %s out of the unavailable reset",
    (_name, target, inventory, detail) => {
      const list = projectGroupingList(
        input([[API_KEY, "separate"]], {
          projects: [],
          servers: [target],
          inventories: new Map(inventory === null ? [] : [[target.id, inventory]]),
        }),
      );
      expect(summary(list)).toEqual([[API_KEY, "api/v2", detail, "unknown"]]);
      expect(list.unavailableRootKeys).toEqual([]);
    },
  );

  it("marks overrides for unknown servers and malformed server keys unavailable", () => {
    const list = projectGroupingList(
      input(
        [
          [API_KEY, "separate"],
          ["remote:other:runner:web", "separate"],
          ["remote:broken", "repository"],
          ["remote:other:runner:a%2Fb", "separate"],
          ["remote:other:runner:%61pi", "separate"],
          ["remote:other:runner:", "separate"],
        ],
        { projects: [], servers: [{ ...server, connected: false }] },
      ),
    );
    expect(summary(list)).toEqual([
      [API_KEY, "api/v2", "Linux, not connected", "unknown"],
      ["remote:other:runner:web", "web", "server not found", "unavailable"],
      ["remote:broken", "remote:broken", "server not found", "unavailable"],
      ["remote:other:runner:a%2Fb", "a/b", "server not found", "unavailable"],
      ["remote:other:runner:%61pi", "remote:other:runner:%61pi", "server not found", "unavailable"],
      ["remote:other:runner:", "remote:other:runner:", "server not found", "unavailable"],
    ]);
    expect(list.unavailableRootKeys).toEqual([
      "remote:other:runner:web",
      "remote:broken",
      "remote:other:runner:a%2Fb",
      "remote:other:runner:%61pi",
      "remote:other:runner:",
    ]);
  });

  it("locks a server project that follows an open connected local project", () => {
    const base = {
      servers: [server],
      inventories: new Map([[server.id, ready("web", "docs")]]),
      links: new Map([
        [WEB_KEY, "/local/app"],
        ["remote:my%20server:runner:docs", "/closed/docs"],
      ]),
    };
    const list = projectGroupingList(input([[WEB_KEY, "separate"]], base));
    expect(list.rows.map((row) => [row.rootKey, row.detail, row.control, row.override])).toEqual([
      ["/local/app", "/local/app", "editable", null],
      [WEB_KEY, "Linux, follows app", "followsConnection", "separate"],
      ["remote:my%20server:runner:docs", "Linux", "editable", null],
    ]);
    expect(list.unavailableRootKeys).toEqual([]);
    const renamed = projectGroupingList(
      input([], { ...base, displayNames: new Map([["/local/app", "Storefront"]]) }),
    );
    expect(renamed.rows[1]?.detail).toBe("Linux, follows Storefront");
  });

  it("prefers a user-set display name for exactly that project", () => {
    const list = projectGroupingList(
      input([["/closed/site", "separate"]], {
        servers: [server],
        inventories: new Map([[server.id, ready("web", "api/v2")]]),
        displayNames: new Map([
          ["/local/app", "Storefront"],
          [WEB_KEY, "Storefront (server)"],
          ["/closed/site", "Marketing"],
        ]),
      }),
    );
    expect(list.rows.map((row) => row.label)).toEqual([
      "Storefront",
      "Marketing",
      "Storefront (server)",
      "API/V2",
    ]);
  });

  it("keeps every overridden project reachable when the list is bounded", () => {
    const projects = Array.from({ length: MAX_PROJECT_GROUPING_ROWS + 6 }, (_, index) =>
      localProject(`/local/p${index}`, `p${index}`),
    );
    const last = `/local/p${MAX_PROJECT_GROUPING_ROWS + 5}`;
    const list = projectGroupingList(
      input(
        [
          [last, "separate"],
          ["/closed/site", "separate"],
        ],
        { projects },
      ),
    );
    expect(list.total).toBe(MAX_PROJECT_GROUPING_ROWS + 7);
    expect(list.rows).toHaveLength(MAX_PROJECT_GROUPING_ROWS);
    expect(list.rows.slice(0, 2).map((row) => row.rootKey)).toEqual(["/local/p0", "/local/p1"]);
    expect(list.rows.slice(-2).map((row) => row.rootKey)).toEqual([last, "/closed/site"]);
    expect(list.unavailableRootKeys).toEqual(["/closed/site"]);
  });

  it("reports every unavailable override even when its row is beyond the limit", () => {
    const saved = Array.from(
      { length: MAX_PROJECT_GROUPING_ROWS + 20 },
      (_, index): readonly [string, AgentProjectGroupingMode] => [`/closed/p${index}`, "separate"],
    );
    const list = projectGroupingList(input(saved));
    expect(list.rows).toHaveLength(MAX_PROJECT_GROUPING_ROWS);
    expect(list.rows.every((row) => row.override === "separate")).toBe(true);
    expect(list.rows.some((row) => row.rootKey === "/local/app")).toBe(false);
    expect(list.unavailableRootKeys).toEqual(saved.map(([rootKey]) => rootKey));
  });

  it("lists a project once when the inventory repeats it", () => {
    const list = projectGroupingList(
      input([[WEB_KEY, "separate"]], {
        projects: [app, app],
        servers: [server],
        inventories: new Map([[server.id, ready("web", "web")]]),
      }),
    );
    expect(list.rows.map((row) => row.rootKey)).toEqual(["/local/app", WEB_KEY]);
    expect(list.unavailableRootKeys).toEqual([]);
  });
});
