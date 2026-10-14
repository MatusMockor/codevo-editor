import { describe, expect, it } from "vitest";
import type { AgentMcpServer, AgentMcpServerStatus } from "../../../domain/agentMcpServers";
import { agentMcpServersFixture } from "../../../test/agentMcpServersTestSupport";
import {
  MCP_FROM_PLUGINS_TITLE,
  MCP_UNKNOWN_PLUGIN_LABEL,
  filterMcpServerLayout,
  mcpFromPluginsNote,
  mcpServerLayoutHasEntries,
  mcpServerLayout,
  type McpServerLayout,
  type McpServerSearchContext,
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

describe("filterMcpServerLayout", () => {
  function filter(
    provider: "claudeCode" | "codex",
    layout: McpServerLayout,
    query: string,
    context: McpServerSearchContext = { place: "local", management: "unsupported" },
  ): McpServerLayout {
    return filterMcpServerLayout(provider, layout, query, context);
  }

  const layout = mcpServerLayout(
    "claudeCode",
    servers([
      { name: "Café-files", scope: "project", transport: "stdio", toolCount: 14 },
      {
        name: "sentry",
        status: "failed",
        scope: "user",
        transport: "http",
        endpointOrigin: "https://mcp.sentry.dev",
        detail: "Connection closed",
      },
      plugin("plugin:Bravé:search", { transport: "sse" }),
      plugin("plugin:miro:boards", { transport: "http" }),
    ]),
  );

  it.each(["café", "CAFE", "cafe\u0301"])(
    "matches names without case or diacritics: %s",
    (query) => {
      expect(outline(filter("claudeCode", layout, query))).toEqual({
        own: ["Café-files"],
        plugins: [],
      });
    },
  );

  it.each(["SENTRY", "mcp.sentry.dev", "USER", "Connection CLOSED"])(
    "matches a row's visible fields: %s",
    (query) => {
      expect(outline(filter("claudeCode", layout, query))).toEqual({
        own: ["sentry"],
        plugins: [],
      });
    },
  );

  it.each(["project", "STDIO", "14 tools"])(
    "matches the displayed scope, transport and tool count: %s",
    (query) => {
      expect(outline(filter("claudeCode", layout, query))).toEqual({
        own: ["Café-files"],
        plugins: [],
      });
    },
  );

  it.each(["search", "plugin:brave:search", "BRAVE", "SSE"])(
    "matches a plugin server's title, identity or group: %s",
    (query) => {
      expect(outline(filter("claudeCode", layout, query))).toEqual({
        own: [],
        plugins: [["Bravé", ["search"]]],
      });
    },
  );

  it.each<readonly [AgentMcpServerStatus, string]>([
    ["failed", "FAILED"],
    ["needsAuth", "needs sign-in"],
    ["connected", "Connected"],
    ["connecting", "Connecting"],
    ["disabled", "Disabled"],
    ["unknown", "Status unknown"],
  ])("matches the displayed %s status", (status, query) => {
    const statuses = mcpServerLayout(
      "claudeCode",
      servers([
        { name: "own", status },
        plugin("plugin:apps:mail", { status }),
        { name: "other", status: status === "connected" ? "failed" : "connected" },
      ]),
    );
    expect(outline(filter("claudeCode", statuses, query))).toEqual({
      own: ["own"],
      plugins: [["apps", ["mail"]]],
    });
  });

  it.each(["claudeCode", "codex"] as const)(
    "matches the visible unmanaged sign-in hint for %s",
    (provider) => {
      const hinted = mcpServerLayout(
        provider,
        servers([
          { name: "needs-login", status: "needsAuth", transport: "http" },
          { name: "ready", status: "connected", transport: "http" },
          { name: "plugin:apps:mail", status: "needsAuth", scope: "plugin", transport: "http" },
        ]),
      );
      for (const query of ["MCP LOGIN", "To sign in, run"]) {
        expect(outline(filter(provider, hinted, query))).toEqual({
          own: ["needs-login"],
          plugins: [["apps", ["mail"]]],
        });
      }
      const remote = { place: "server", management: "unsupported" } as const;
      expect(outline(filter(provider, hinted, "On the server, run", remote))).toEqual({
        own: ["needs-login"],
        plugins: [["apps", ["mail"]]],
      });
      expect(mcpServerLayoutHasEntries(filter(provider, hinted, "To sign in, run", remote))).toBe(
        false,
      );
      expect(mcpServerLayoutHasEntries(filter(provider, hinted, "On the server, run"))).toBe(false);
      expect(
        mcpServerLayoutHasEntries(
          filter(provider, hinted, "MCP LOGIN", { place: "local", management: "supported" }),
        ),
      ).toBe(false);
    },
  );

  it("matches fallback hints even when management cannot offer a sign-in action", () => {
    const fallback = mcpServerLayout(
      "claudeCode",
      servers([
        { name: "stdio-auth", status: "needsAuth", transport: "stdio" },
        { name: "managed-auth", status: "needsAuth", scope: "managed", transport: "http" },
        { name: "remote-auth", status: "needsAuth", transport: "sse" },
      ]),
    );
    expect(
      outline(
        filter("claudeCode", fallback, "mcp login", { place: "local", management: "supported" }),
      ),
    ).toEqual({ own: ["managed-auth", "stdio-auth"], plugins: [] });
  });

  it("matches provider and plugin group labels", () => {
    expect(filter("claudeCode", layout, "CLAUDE CODE")).toEqual(layout);
    expect(mcpServerLayoutHasEntries(filter("claudeCode", layout, "codex"))).toBe(false);
    expect(outline(filter("claudeCode", layout, "from PLUGINS"))).toEqual({
      own: [],
      plugins: [
        ["Bravé", ["search"]],
        ["miro", ["boards"]],
      ],
    });
    const unnamed = mcpServerLayout("codex", servers([{ name: "apps", scope: "plugin" }]));
    expect(filter("codex", unnamed, "unknown plugin")).toEqual(unnamed);
  });

  it("matches transports across own and plugin groups without changing order or identity", () => {
    const filtered = filter("claudeCode", layout, "HTTP");
    expect(outline(filtered)).toEqual({ own: ["sentry"], plugins: [["miro", ["boards"]]] });
    expect(filtered.own[0]).toBe(layout.own.find((entry) => entry.server.name === "sentry"));
    expect(layout.own).toHaveLength(2);
    expect(layout.plugins).toHaveLength(2);
  });

  it("does not match secondary fields omitted from plugin rows", () => {
    const plugins = mcpServerLayout(
      "codex",
      servers([{ name: "apps", scope: "plugin", transport: "unknown" }]),
    );
    expect(filter("codex", plugins, "plugin")).toEqual(plugins);
    expect(filter("codex", plugins, "unknown")).toEqual(plugins);
    const named = mcpServerLayout(
      "codex",
      servers([{ name: "plugin:apps:mail", scope: "plugin", transport: "unknown" }]),
    );
    expect(mcpServerLayoutHasEntries(filter("codex", named, "unknown"))).toBe(false);
  });

  it("returns an empty layout and hides every plugin section for no matches", () => {
    const filtered = filter("claudeCode", layout, "missing-server");
    expect(filtered).toEqual({ own: [], plugins: [] });
    expect(mcpServerLayoutHasEntries(filtered)).toBe(false);
  });

  it.each(["", "   "])("returns the original layout for an empty query: %s", (query) => {
    expect(filter("claudeCode", layout, query)).toBe(layout);
  });
});
