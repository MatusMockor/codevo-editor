import { describe, expect, it } from "vitest";
import type { AgentMcpServer } from "../../../domain/agentMcpServers";
import { agentMcpServersFixture } from "../../../test/agentMcpServersTestSupport";
import {
  MCP_FROM_PLUGINS_TITLE,
  MCP_UNKNOWN_PLUGIN_LABEL,
  mcpFromPluginsNote,
  mcpServerLayout,
  type McpServerLayout,
} from "./mcpServerGroupsPresentation";

type Listed = Partial<AgentMcpServer> & { readonly name: string };

function servers(listed: ReadonlyArray<Listed>): ReadonlyArray<AgentMcpServer> {
  return agentMcpServersFixture("claudeCode", listed).servers;
}

function plugin(name: string, overrides: Partial<AgentMcpServer> = {}): Listed {
  return { name, scope: "unknown", transport: "http", ...overrides };
}

function outline(layout: McpServerLayout) {
  return {
    own: layout.own.map((entry) => entry.title),
    plugins: layout.plugins.map((section) => [
      section.label,
      section.entries.map((entry) => entry.title),
    ]),
  };
}

describe("mcpServerLayout", () => {
  it("lists own servers first and plugin servers under their plugin", () => {
    const layout = mcpServerLayout(
      "claudeCode",
      servers([
        plugin("plugin:miro:miro", { status: "needsAuth" }),
        plugin("plugin:cloudflare:cloudflare-docs"),
        { name: "sentry" },
        plugin("plugin:cloudflare:cloudflare-builds", { status: "needsAuth" }),
        plugin("plugin:cloudflare:cloudflare-api", { status: "needsAuth" }),
        { name: "atlassian", status: "failed", transport: "http" },
        plugin("plugin:Brave:search"),
      ]),
    );
    expect(outline(layout)).toEqual({
      own: ["atlassian", "sentry"],
      plugins: [
        ["Brave", ["search"]],
        ["cloudflare", ["cloudflare-api", "cloudflare-builds", "cloudflare-docs"]],
        ["miro", ["miro"]],
      ],
    });
  });

  it("keeps the full name as the identity of every entry", () => {
    const layout = mcpServerLayout(
      "claudeCode",
      servers([plugin("plugin:cloudflare:cloudflare-api"), { name: "sentry" }]),
    );
    expect(layout.own.map((entry) => entry.server.name)).toEqual(["sentry"]);
    expect(
      layout.plugins.map((section) => section.entries.map((entry) => entry.server.name)),
    ).toEqual([["plugin:cloudflare:cloudflare-api"]]);
  });

  it("puts servers of a plugin that is not named last under a neutral label", () => {
    const layout = mcpServerLayout(
      "codex",
      servers([
        { name: "zeta", scope: "plugin" },
        { name: "plugin:apps:mail", scope: "plugin" },
        { name: "alpha", scope: "plugin", status: "needsAuth", transport: "http" },
        { name: "computer-use", scope: "unknown" },
        { name: "plugin:not:own", scope: "unknown" },
      ]),
    );
    expect(outline(layout)).toEqual({
      own: ["computer-use", "plugin:not:own"],
      plugins: [
        ["apps", ["mail"]],
        [MCP_UNKNOWN_PLUGIN_LABEL, ["alpha", "zeta"]],
      ],
    });
  });

  it("gives every plugin section a distinct key, also for a plugin named like the label", () => {
    const layout = mcpServerLayout(
      "codex",
      servers([
        { name: "loose", scope: "plugin" },
        { name: "plugin:unnamed:one", scope: "plugin" },
        { name: `plugin:${MCP_UNKNOWN_PLUGIN_LABEL}:two`, scope: "plugin" },
      ]),
    );
    const keys = layout.plugins.map((section) => section.key);
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
  });

  it("drops the scope from a plugin server's secondary text and keeps it for own servers", () => {
    const layout = mcpServerLayout(
      "codex",
      servers([
        {
          name: "apps",
          scope: "plugin",
          transport: "http",
          endpointOrigin: "https://apps.example.com",
          toolCount: 37,
        },
        { name: "bare", scope: "plugin", transport: "unknown" },
        { name: "mine", scope: "user", transport: "stdio", toolCount: 1 },
      ]),
    );
    expect(layout.plugins[0]?.entries.map((entry) => entry.secondary)).toEqual([
      "HTTP · https://apps.example.com · 37 tools",
      null,
    ]);
    expect(layout.own.map((entry) => entry.secondary)).toEqual(["User · stdio · 1 tool"]);
  });

  it("has no plugin sections when every server is the user's own", () => {
    expect(mcpServerLayout("claudeCode", servers([{ name: "sentry" }])).plugins).toEqual([]);
    expect(mcpServerLayout("claudeCode", [])).toEqual({ own: [], plugins: [] });
  });

  it("orders the same servers identically regardless of their input order", () => {
    const listed = servers([
      plugin("plugin:b:two"),
      plugin("plugin:a:one", { status: "needsAuth" }),
      { name: "own" },
      plugin("plugin:b:one"),
    ]);
    expect(outline(mcpServerLayout("claudeCode", [...listed].reverse()))).toEqual(
      outline(mcpServerLayout("claudeCode", listed)),
    );
  });
});

describe("plugin section wording", () => {
  it("offers sign-in only where the servers can be managed", () => {
    expect(MCP_FROM_PLUGINS_TITLE).toBe("From plugins");
    expect(MCP_UNKNOWN_PLUGIN_LABEL).toBe("Unknown plugin");
    expect(mcpFromPluginsNote("supported")).toBe(
      "These servers are installed by plugins. Sign in to them here; to remove one, remove its plugin.",
    );
    expect(mcpFromPluginsNote("unsupported")).toBe(
      "These servers are installed by plugins. To remove one, remove its plugin.",
    );
  });
});
