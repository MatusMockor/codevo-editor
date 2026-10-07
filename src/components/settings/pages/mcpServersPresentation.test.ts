import { describe, expect, it } from "vitest";
import type { AgentMcpServersState } from "../../../application/agentMcpServersStore";
import {
  AGENT_MCP_SERVERS_ERROR_KINDS,
  AGENT_MCP_SERVER_STATUSES,
  type AgentMcpServer,
} from "../../../domain/agentMcpServers";
import { MAX_AGENT_PROJECT_ROOTS } from "../../../domain/agentProject";
import { agentMcpServersFixture } from "../../../test/agentMcpServersTestSupport";
import {
  MAX_MCP_PROJECT_OPTIONS,
  mcpCheckedLabel,
  mcpCopySignInLabel,
  mcpErrorMessage,
  mcpProjectOptions,
  mcpProviderSummary,
  mcpServerNeedsAttention,
  mcpServerSecondaryText,
  mcpServerStatusLabel,
  mcpServerStatusTone,
  orderedMcpServers,
  selectedMcpProjectRoot,
} from "./mcpServersPresentation";

function project(rootPath: string, label: string) {
  return { rootPath, label };
}

function server(overrides: Partial<AgentMcpServer> & { readonly name: string }): AgentMcpServer {
  const [parsed] = agentMcpServersFixture("claudeCode", [overrides]).servers;
  expect(parsed).toBeDefined();
  return parsed as AgentMcpServer;
}

function loaded(servers: ReadonlyArray<Partial<AgentMcpServer> & { readonly name: string }>) {
  return {
    kind: "loaded",
    snapshot: { result: agentMcpServersFixture("claudeCode", servers), checkedAtMs: 0 },
  } satisfies AgentMcpServersState;
}

describe("MCP project options", () => {
  it("puts the open workspace first and then the other local projects", () => {
    expect(
      mcpProjectOptions("/work/app", [project("/work/api", "api"), project("/work/app", "App")]),
    ).toEqual([
      { repositoryRoot: "/work/app", label: "App" },
      { repositoryRoot: "/work/api", label: "api" },
    ]);
  });

  it("names a workspace that is not an agent project after its folder", () => {
    expect(mcpProjectOptions("/work/solo/", [])).toEqual([
      { repositoryRoot: "/work/solo/", label: "solo" },
    ]);
  });

  it("lists projects in their given order without a workspace", () => {
    const options = mcpProjectOptions(null, [project("/work/b", "b"), project("/work/a", "a")]);
    expect(options.map((option) => option.repositoryRoot)).toEqual(["/work/b", "/work/a"]);
  });

  it("drops duplicate roots, including a trailing-separator alias", () => {
    const options = mcpProjectOptions("/work/app", [
      project("/work/app/", "App"),
      project("/work/api", "api"),
      project("/work/api", "api again"),
    ]);
    expect(options.map((option) => option.repositoryRoot)).toEqual(["/work/app", "/work/api"]);
  });

  it("excludes roots the backend contract cannot address", () => {
    const options = mcpProjectOptions("relative/root", [
      project("", "empty"),
      project("remote:linux:runner:project", "server project"),
      project("/work/a\nb", "control"),
      project("/work/ok", "ok"),
    ]);
    expect(options).toEqual([{ repositoryRoot: "/work/ok", label: "ok" }]);
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
  });

  it("bounds the options at the workspace plus every possible agent project", () => {
    const projects = Array.from({ length: MAX_AGENT_PROJECT_ROOTS + 20 }, (_, index) =>
      project(`/work/project-${index}`, `project-${index}`),
    );
    const options = mcpProjectOptions("/work/app", projects);
    expect(MAX_MCP_PROJECT_OPTIONS).toBe(MAX_AGENT_PROJECT_ROOTS + 1);
    expect(options).toHaveLength(MAX_MCP_PROJECT_OPTIONS);
    expect(options[0]?.repositoryRoot).toBe("/work/app");
    expect(options[options.length - 1]?.repositoryRoot).toBe(
      `/work/project-${MAX_AGENT_PROJECT_ROOTS - 1}`,
    );
  });

  it("selects the choice when it is still offered, else the first option, else nothing", () => {
    const options = mcpProjectOptions("/work/app", [project("/work/api", "api")]);
    expect(selectedMcpProjectRoot(options, "/work/api")).toBe("/work/api");
    expect(selectedMcpProjectRoot(options, "/work/gone")).toBe("/work/app");
    expect(selectedMcpProjectRoot(options, null)).toBe("/work/app");
    expect(selectedMcpProjectRoot([], "/work/api")).toBeNull();
  });
});

describe("MCP server ordering and labels", () => {
  it("lists servers needing attention first, then by status, then by name", () => {
    const servers = [
      server({ name: "zeta" }),
      server({ name: "unknown-one", status: "unknown" }),
      server({ name: "off", status: "disabled" }),
      server({ name: "Alpha" }),
      server({ name: "slow", status: "connecting" }),
      server({ name: "login-b", status: "needsAuth" }),
      server({ name: "broken", status: "failed" }),
      server({ name: "login-a", status: "needsAuth" }),
      server({ name: "alpha" }),
    ];
    expect(orderedMcpServers(servers).map((item) => item.name)).toEqual([
      "broken",
      "login-a",
      "login-b",
      "slow",
      "Alpha",
      "alpha",
      "zeta",
      "off",
      "unknown-one",
    ]);
    expect(servers[0]?.name).toBe("zeta");
  });

  it("orders the same servers identically regardless of their input order", () => {
    const servers = AGENT_MCP_SERVER_STATUSES.flatMap((status) => [
      server({ name: `b-${status}`, status }),
      server({ name: `a-${status}`, status }),
    ]);
    expect(orderedMcpServers([...servers].reverse())).toEqual(orderedMcpServers(servers));
  });

  it("words every status and pairs it with a tone", () => {
    expect(AGENT_MCP_SERVER_STATUSES.map(mcpServerStatusLabel)).toEqual([
      "Connected",
      "Connecting",
      "Needs sign-in",
      "Failed",
      "Disabled",
      "Status unknown",
    ]);
    expect(AGENT_MCP_SERVER_STATUSES.map(mcpServerStatusTone)).toEqual([
      "ok",
      "pending",
      "attention",
      "danger",
      "muted",
      "muted",
    ]);
    expect(AGENT_MCP_SERVER_STATUSES.filter(mcpServerNeedsAttention)).toEqual([
      "needsAuth",
      "failed",
    ]);
  });

  it("builds the secondary text from the known parts only", () => {
    expect(
      mcpServerSecondaryText(
        server({
          name: "sentry",
          scope: "user",
          transport: "http",
          endpointOrigin: "https://mcp.sentry.dev",
          toolCount: 14,
        }),
      ),
    ).toBe("User · HTTP · https://mcp.sentry.dev · 14 tools");
    expect(
      mcpServerSecondaryText(server({ name: "fs", scope: "project", transport: "stdio" })),
    ).toBe("Project · stdio");
    expect(
      mcpServerSecondaryText(
        server({ name: "one", scope: "unknown", transport: "unknown", toolCount: 1 }),
      ),
    ).toBe("1 tool");
    expect(
      mcpServerSecondaryText(
        server({ name: "none", scope: "unknown", transport: "sse", toolCount: 0 }),
      ),
    ).toBe("SSE · 0 tools");
  });

  it("prints nothing rather than the word unknown when nothing is known", () => {
    expect(
      mcpServerSecondaryText(server({ name: "bare", scope: "unknown", transport: "unknown" })),
    ).toBeNull();
    for (const scope of ["local", "account", "plugin", "managed"] as const) {
      expect(mcpServerSecondaryText(server({ name: "scoped", scope }))).not.toContain("unknown");
    }
  });
});

describe("MCP provider summary", () => {
  it("has one distinct message per error kind, naming the provider where it matters", () => {
    const messages = AGENT_MCP_SERVERS_ERROR_KINDS.map((kind) => mcpErrorMessage(kind, "codex"));
    expect(new Set(messages).size).toBe(AGENT_MCP_SERVERS_ERROR_KINDS.length);
    expect(messages).toEqual([
      "This project is not open in Codevo. Open it, then check again.",
      "This project is not trusted. Trust it to check its MCP servers.",
      "Codex is turned off in Providers settings.",
      "A check is already running for this project. Try again in a moment.",
      "Codex did not answer in time. Check again.",
      "Could not read MCP servers from Codex.",
    ]);
    expect(mcpErrorMessage("providerDisabled", "claudeCode")).toBe(
      "Claude Code is turned off in Providers settings.",
    );
  });

  it("summarizes each state truthfully", () => {
    expect(mcpProviderSummary({ kind: "idle" }, "codex")).toEqual({
      text: "Not checked yet.",
      tone: "neutral",
      hintCommand: null,
    });
    expect(mcpProviderSummary({ kind: "loading", previous: null }, "codex").text).toBe(
      "Checking MCP servers…",
    );
    expect(
      mcpProviderSummary({ kind: "failed", error: "timedOut", previous: null }, "claudeCode"),
    ).toEqual({
      text: "Claude Code did not answer in time. Check again.",
      tone: "problem",
      hintCommand: null,
    });
  });

  it("explains an empty list and how to add a server for that provider", () => {
    expect(mcpProviderSummary(loaded([]), "claudeCode")).toEqual({
      text: "No MCP servers are configured for Claude Code in this project.",
      tone: "neutral",
      hintCommand: "claude mcp add",
    });
    expect(mcpProviderSummary(loaded([]), "codex")).toEqual({
      text: "No MCP servers are configured for Codex in this project.",
      tone: "neutral",
      hintCommand: "codex mcp add",
    });
  });

  it("counts servers and those needing attention", () => {
    expect(mcpProviderSummary(loaded([{ name: "a" }]), "codex").text).toBe("1 server");
    expect(mcpProviderSummary(loaded([{ name: "a" }, { name: "b" }]), "codex").text).toBe(
      "2 servers",
    );
    expect(
      mcpProviderSummary(loaded([{ name: "a" }, { name: "b", status: "failed" }]), "codex").text,
    ).toBe("2 servers, 1 needs attention");
    expect(
      mcpProviderSummary(
        loaded([
          { name: "a", status: "needsAuth" },
          { name: "b", status: "failed" },
          { name: "c", status: "disabled" },
        ]),
        "codex",
      ).text,
    ).toBe("3 servers, 2 need attention");
  });
});

describe("MCP labels", () => {
  it("words the age of a check like the usage page words its updates", () => {
    expect(mcpCheckedLabel(1_000, 1_000)).toBe("Checked just now");
    expect(mcpCheckedLabel(0, 5 * 60_000)).toBe("Checked 5m ago");
    expect(mcpCheckedLabel(0, 3 * 3_600_000)).toBe("Checked 3h ago");
    expect(mcpCheckedLabel(0, 2 * 86_400_000)).toBe("Checked 2d ago");
    expect(mcpCheckedLabel(9_000, 1_000)).toBe("Checked just now");
  });

  it("names the server in the copy action", () => {
    expect(mcpCopySignInLabel("claude.ai Gmail")).toBe("Copy sign-in command for claude.ai Gmail");
  });
});
