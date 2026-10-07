import { describe, expect, it } from "vitest";
import type {
  AgentMcpServerHost,
  AgentMcpServerHosts,
} from "../../../application/agentMcpServerProjects";
import type { AgentMcpServersProject } from "../../../domain/agentMcpServersTarget";
import { MAX_AGENT_PROJECT_ROOTS } from "../../../domain/agentProject";
import {
  MAX_MCP_PROJECT_OPTIONS,
  MAX_MCP_SERVER_PROJECT_OPTIONS,
  mcpProjectNotes,
  mcpProjectOptions,
  mcpProjectSelection,
  selectedMcpProjectKey,
  type McpProjectOption,
} from "./mcpProjectOptions";

function project(rootPath: string, label: string) {
  return { rootPath, label };
}

function local(repositoryRoot: string): AgentMcpServersProject {
  return { kind: "local", repositoryRoot };
}

function onServer(serverId: string, runnerId: string, projectId: string): AgentMcpServersProject {
  return { kind: "server", serverId, runnerId, projectId };
}

function ready(
  id: string,
  name: string,
  runnerId: string,
  projects: ReadonlyArray<{ readonly id: string; readonly name: string }>,
  truncated = false,
  stale = false,
): AgentMcpServerHost {
  return {
    server: { id, name },
    inventory: { kind: "ready", runnerId, supported: true, projects, truncated, stale },
  };
}

function selected(
  options: ReadonlyArray<McpProjectOption>,
  chosen: AgentMcpServersProject | null,
  servers?: AgentMcpServerHosts,
): AgentMcpServersProject | null {
  const selection = mcpProjectSelection(options, chosen, servers);
  if (selection.kind !== "selected") return null;
  return selection.option.project;
}

function hosts(...list: ReadonlyArray<AgentMcpServerHost>): AgentMcpServerHosts {
  return { hosts: list, truncated: false };
}

const LINUX = ready("linux", "Linux box", "runner-home", [
  { id: "codevo-editor", name: "Codevo Editor" },
  { id: "api", name: "api" },
]);

describe("MCP local project options", () => {
  it("puts the open workspace first and then the other local projects", () => {
    expect(
      mcpProjectOptions("/work/app", [project("/work/api", "api"), project("/work/app", "App")]),
    ).toEqual([
      {
        key: '["local","/work/app"]',
        project: local("/work/app"),
        label: "App",
        name: "App",
        location: "/work/app",
      },
      {
        key: '["local","/work/api"]',
        project: local("/work/api"),
        label: "api",
        name: "api",
        location: "/work/api",
      },
    ]);
  });

  it("names a workspace that is not an agent project after its folder", () => {
    expect(
      mcpProjectOptions("/work/solo/", []).map((option) => [option.name, option.location]),
    ).toEqual([["solo", "/work/solo/"]]);
  });

  it("lists projects in their given order without a workspace", () => {
    const options = mcpProjectOptions(null, [project("/work/b", "b"), project("/work/a", "a")]);
    expect(options.map((option) => option.location)).toEqual(["/work/b", "/work/a"]);
  });

  it("drops duplicate roots, including a trailing-separator alias", () => {
    const options = mcpProjectOptions("/work/app", [
      project("/work/app/", "App"),
      project("/work/api", "api"),
      project("/work/api", "api again"),
    ]);
    expect(options.map((option) => option.location)).toEqual(["/work/app", "/work/api"]);
  });

  it("excludes roots the backend contract cannot address", () => {
    const options = mcpProjectOptions("relative/root", [
      project("", "empty"),
      project("remote:linux:runner:project", "server project"),
      project("/work/a\nb", "control"),
      project("/work/ok", "ok"),
    ]);
    expect(options.map((option) => option.project)).toEqual([local("/work/ok")]);
  });

  it("tells same-named projects apart by their path", () => {
    const options = mcpProjectOptions(null, [
      project("/work/one/api", "api"),
      project("/work/two/api", "api"),
      project("/work/web", "web"),
    ]);
    expect(options.map((option) => option.label)).toEqual([
      "api (/work/one/api)",
      "api (/work/two/api)",
      "web",
    ]);
    expect(options.map((option) => option.name)).toEqual(["api", "api", "web"]);
  });

  it("bounds the options at the workspace plus every possible agent project", () => {
    const projects = Array.from({ length: MAX_AGENT_PROJECT_ROOTS + 20 }, (_, index) =>
      project(`/work/project-${index}`, `project-${index}`),
    );
    const options = mcpProjectOptions("/work/app", projects);
    expect(MAX_MCP_PROJECT_OPTIONS).toBe(MAX_AGENT_PROJECT_ROOTS + 1);
    expect(options).toHaveLength(MAX_MCP_PROJECT_OPTIONS);
    expect(options[0]?.location).toBe("/work/app");
    expect(options[options.length - 1]?.location).toBe(
      `/work/project-${MAX_AGENT_PROJECT_ROOTS - 1}`,
    );
  });
});

describe("MCP server project options", () => {
  it("lists server projects after the local ones, labelled with their server", () => {
    const options = mcpProjectOptions("/work/app", [project("/work/api", "api")], hosts(LINUX));
    expect(options.map((option) => option.label)).toEqual([
      "app",
      "api",
      "Codevo Editor — Linux box",
      "api — Linux box",
    ]);
    expect(options[2]).toEqual({
      key: '["server","linux","runner-home","codevo-editor"]',
      project: onServer("linux", "runner-home", "codevo-editor"),
      label: "Codevo Editor — Linux box",
      name: "Codevo Editor",
      location: "Linux box · Server checkout",
    });
  });

  it("lists every connected server in its given order and nothing for one that is not ready", () => {
    const options = mcpProjectOptions(
      null,
      [],
      hosts(
        { server: { id: "idle", name: "Idle" }, inventory: { kind: "idle" } },
        ready("mac", "Mac mini", "runner-mac", [{ id: "web", name: "web" }]),
        { server: { id: "slow", name: "Slow" }, inventory: { kind: "loading" } },
        { server: { id: "down", name: "Down" }, inventory: { kind: "failed" } },
        LINUX,
      ),
    );
    expect(options.map((option) => option.label)).toEqual([
      "web — Mac mini",
      "Codevo Editor — Linux box",
      "api — Linux box",
    ]);
  });

  it("lists a project of a runner that cannot check yet, so the page can say so", () => {
    const old: AgentMcpServerHost = {
      server: { id: "old", name: "Old box" },
      inventory: {
        kind: "ready",
        runnerId: "runner-old",
        supported: false,
        projects: [{ id: "legacy", name: "legacy" }],
        truncated: false,
        stale: false,
      },
    };
    expect(mcpProjectOptions(null, [], hosts(old)).map((option) => option.project)).toEqual([
      onServer("old", "runner-old", "legacy"),
    ]);
  });

  it("keeps a local project and a server project with the same name apart", () => {
    const options = mcpProjectOptions(null, [project("/work/api", "api")], hosts(LINUX));
    expect(options.map((option) => option.label)).toEqual([
      "api",
      "Codevo Editor — Linux box",
      "api — Linux box",
    ]);
    expect(new Set(options.map((option) => option.key)).size).toBe(3);
  });

  it("tells same-named projects on one server apart by their id", () => {
    const options = mcpProjectOptions(
      null,
      [],
      hosts(
        ready("linux", "Linux box", "runner-home", [
          { id: "api", name: "api" },
          { id: "api-2", name: "api" },
        ]),
      ),
    );
    expect(options.map((option) => option.label)).toEqual([
      "api — Linux box (api)",
      "api — Linux box (api-2)",
    ]);
  });

  it("skips a server project the runner contract cannot address", () => {
    const options = mcpProjectOptions(
      null,
      [],
      hosts(
        ready("linux", "Linux box", "runner\u0000", [{ id: "api", name: "api" }]),
        ready("mac", "Mac mini", "runner-mac", [
          { id: "a/b", name: "slash" },
          { id: "web", name: "web" },
        ]),
      ),
    );
    expect(options.map((option) => option.label)).toEqual(["web — Mac mini"]);
  });

  it("bounds the server options and says that some are not listed", () => {
    const many = ready(
      "linux",
      "Linux box",
      "runner-home",
      Array.from({ length: MAX_MCP_SERVER_PROJECT_OPTIONS }, (_, index) => ({
        id: `project-${index}`,
        name: `project-${index}`,
      })),
    );
    const more = ready("mac", "Mac mini", "runner-mac", [{ id: "web", name: "web" }]);
    const options = mcpProjectOptions("/work/app", [], hosts(many, more));
    expect(options).toHaveLength(1 + MAX_MCP_SERVER_PROJECT_OPTIONS);
    expect(options.some((option) => option.label === "web — Mac mini")).toBe(false);
    expect(mcpProjectNotes(hosts(many, more))).toEqual([
      { serverId: null, text: "Some server projects are not listed.", tone: "neutral" },
    ]);
    expect(mcpProjectNotes(hosts(many))).toEqual([]);
  });
});

describe("MCP servers that share a display name", () => {
  const first = ready("linux-a", "Linux box", "runner-a", [{ id: "api", name: "api" }]);
  const second = ready("linux-b", "Linux box", "runner-b", [{ id: "api", name: "api" }]);
  const other = ready("mac", "Mac mini", "runner-mac", [{ id: "api", name: "api" }]);

  it("tells them apart by their server id, and only them", () => {
    const options = mcpProjectOptions(null, [], hosts(first, other, second));
    expect(options.map((option) => option.label)).toEqual([
      "api — Linux box (linux-a)",
      "api — Mac mini",
      "api — Linux box (linux-b)",
    ]);
    expect(options.map((option) => option.location)).toEqual([
      "Linux box (linux-a) · Server checkout",
      "Mac mini · Server checkout",
      "Linux box (linux-b) · Server checkout",
    ]);
    expect(new Set(options.map((option) => option.label)).size).toBe(3);
  });

  it("names them the same way regardless of the order they are listed in", () => {
    const forward = mcpProjectOptions(null, [], hosts(first, second));
    const backward = mcpProjectOptions(null, [], hosts(second, first));
    expect(backward.map((option) => option.label)).toEqual(
      [...forward].reverse().map((option) => option.label),
    );
  });

  it("keeps the plain form when the names differ", () => {
    expect(mcpProjectOptions(null, [], hosts(first, other)).map((option) => option.label)).toEqual([
      "api — Linux box",
      "api — Mac mini",
    ]);
  });

  it("gives each of their notes its own server id and wording", () => {
    const notes = mcpProjectNotes(
      hosts(
        { server: { id: "linux-a", name: "Linux box" }, inventory: { kind: "loading" } },
        { server: { id: "linux-b", name: "Linux box" }, inventory: { kind: "loading" } },
      ),
    );
    expect(notes).toEqual([
      { serverId: "linux-a", text: "Loading projects on Linux box (linux-a)…", tone: "neutral" },
      { serverId: "linux-b", text: "Loading projects on Linux box (linux-b)…", tone: "neutral" },
    ]);
  });
});

describe("MCP project notes", () => {
  it("says which server is still loading and which could not be read", () => {
    expect(
      mcpProjectNotes(
        hosts(
          { server: { id: "idle", name: "Idle" }, inventory: { kind: "idle" } },
          { server: { id: "slow", name: "Slow" }, inventory: { kind: "loading" } },
          { server: { id: "down", name: "Down" }, inventory: { kind: "failed" } },
          LINUX,
        ),
      ),
    ).toEqual([
      { serverId: "slow", text: "Loading projects on Slow…", tone: "neutral" },
      {
        serverId: "down",
        text: "Could not load projects on Down. Check again to retry.",
        tone: "problem",
      },
    ]);
  });

  it("says that a known list could not be refreshed and still offers its projects", () => {
    const stale = hosts(
      ready("linux", "Linux box", "runner-home", [{ id: "api", name: "api" }], false, true),
    );
    expect(mcpProjectNotes(stale)).toEqual([
      {
        serverId: "linux",
        text: "Could not refresh projects on Linux box. Check again to retry.",
        tone: "problem",
      },
    ]);
    expect(mcpProjectOptions(null, [], stale).map((option) => option.label)).toEqual([
      "api — Linux box",
    ]);
  });

  it("says once that the list is cut when a server or the server list was cut", () => {
    const cut = [{ serverId: null, text: "Some server projects are not listed.", tone: "neutral" }];
    expect(mcpProjectNotes({ hosts: [LINUX], truncated: true })).toEqual(cut);
    expect(
      mcpProjectNotes(
        hosts(ready("linux", "Linux box", "runner-home", [{ id: "api", name: "api" }], true)),
      ),
    ).toEqual(cut);
    expect(mcpProjectNotes(hosts(LINUX))).toEqual([]);
  });
});

describe("MCP project selection", () => {
  const servers = hosts(LINUX);
  const options = mcpProjectOptions("/work/app", [project("/work/api", "api")], servers);
  const chosenOnServer = onServer("linux", "runner-home", "api");

  it("selects the choice when it is still offered", () => {
    expect(selected(options, local("/work/api"), servers)).toEqual(local("/work/api"));
    expect(selected(options, chosenOnServer, servers)).toEqual(chosenOnServer);
    expect(selectedMcpProjectKey(mcpProjectSelection(options, chosenOnServer, servers))).toBe(
      '["server","linux","runner-home","api"]',
    );
  });

  it("returns the offered option itself so an unchanged choice keeps its key", () => {
    const selection = mcpProjectSelection(options, chosenOnServer, servers);
    expect(selection).toEqual({ kind: "selected", option: options[3] });
    expect(selection.kind === "selected" ? selection.option : null).toBe(options[3]);
  });

  it("falls back to the open workspace, then the first local, then the first server project", () => {
    expect(selected(options, null, servers)).toEqual(local("/work/app"));
    expect(selected(options, local("/work/gone"), servers)).toEqual(local("/work/app"));
    expect(selected(options, onServer("linux", "runner-replaced", "api"), servers)).toEqual(
      local("/work/app"),
    );
    expect(
      selected(mcpProjectOptions(null, [project("/work/api", "api")], servers), null, servers),
    ).toEqual(local("/work/api"));
    expect(selected(mcpProjectOptions(null, [], servers), null, servers)).toEqual(
      onServer("linux", "runner-home", "codevo-editor"),
    );
    expect(mcpProjectSelection([], local("/work/api"))).toEqual({ kind: "none" });
    expect(selectedMcpProjectKey(mcpProjectSelection([], null))).toBeNull();
  });

  it("never mistakes a local path for a server project with the same parts", () => {
    expect(selected(options, local("/linux/runner-home/api"), servers)).toEqual(local("/work/app"));
  });

  it.each(["idle", "loading"] as const)(
    "waits instead of falling back while the chosen server's list is %s",
    (kind) => {
      const reading = hosts({ server: { id: "linux", name: "Linux box" }, inventory: { kind } });
      const localOnly = mcpProjectOptions("/work/app", [], reading);
      expect(mcpProjectSelection(localOnly, chosenOnServer, reading)).toEqual({ kind: "waiting" });
      expect(
        selectedMcpProjectKey(mcpProjectSelection(localOnly, chosenOnServer, reading)),
      ).toBeNull();
    },
  );

  it("does not wait for another server, a failed read, or a server that is gone", () => {
    const localOnly = mcpProjectOptions("/work/app", []);
    const otherLoading = hosts({
      server: { id: "mac", name: "Mac mini" },
      inventory: { kind: "loading" },
    });
    const failed = hosts({
      server: { id: "linux", name: "Linux box" },
      inventory: { kind: "failed" },
    });
    expect(selected(localOnly, chosenOnServer, otherLoading)).toEqual(local("/work/app"));
    expect(selected(localOnly, chosenOnServer, failed)).toEqual(local("/work/app"));
    expect(selected(localOnly, chosenOnServer, hosts())).toEqual(local("/work/app"));
    expect(selected(localOnly, local("/work/gone"), otherLoading)).toEqual(local("/work/app"));
  });

  it("falls back once the chosen server answers as a different runner", () => {
    const replaced = hosts(
      ready("linux", "Linux box", "runner-replaced", [{ id: "api", name: "api" }]),
    );
    expect(
      selected(mcpProjectOptions("/work/app", [], replaced), chosenOnServer, replaced),
    ).toEqual(local("/work/app"));
  });
});
