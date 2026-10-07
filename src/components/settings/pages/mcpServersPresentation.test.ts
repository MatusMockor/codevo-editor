import { describe, expect, it } from "vitest";
import type { AgentMcpServersState } from "../../../application/agentMcpServersStore";
import {
  AGENT_MCP_SERVERS_ERROR_KINDS,
  AGENT_MCP_SERVER_STATUSES,
  type AgentMcpServer,
} from "../../../domain/agentMcpServers";
import { agentMcpServersFixture } from "../../../test/agentMcpServersTestSupport";
import {
  mcpAddServerLead,
  mcpCheckNotice,
  mcpCheckedLabel,
  mcpCopySignInLabel,
  mcpErrorMessage,
  mcpProviderSummary,
  mcpServerNeedsAttention,
  mcpServerSecondaryText,
  mcpServerStatusLabel,
  mcpServerStatusTone,
  mcpSignInLead,
  orderedMcpServers,
} from "./mcpServersPresentation";

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
      "This server's runner does not support MCP checks yet. Update the runner on the server.",
      "Could not reach the server. Check the connection, then check again.",
    ]);
    expect(mcpErrorMessage("unsupportedRunner", "claudeCode")).toBe(
      mcpErrorMessage("unsupportedRunner", "codex"),
    );
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

  it("says where a command has to be run for a local and for a server project", () => {
    expect(mcpSignInLead("local")).toBe("To sign in, run");
    expect(mcpSignInLead("server")).toBe("On the server, run");
    expect(mcpAddServerLead("local")).toBe("Add one with");
    expect(mcpAddServerLead("server")).toBe("On the server, add one with");
  });

  it("is honest that a check starts the configured servers, and where", () => {
    expect(mcpCheckNotice("local")).toBe(
      "Checking starts each configured server once, the same way an agent session does.",
    );
    expect(mcpCheckNotice("server")).toBe(
      "Checking starts each configured server once on the server, the same way an agent session does.",
    );
  });

  it("names the server in the copy action", () => {
    expect(mcpCopySignInLabel("claude.ai Gmail")).toBe("Copy sign-in command for claude.ai Gmail");
  });
});
