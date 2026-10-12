import { describe, expect, it } from "vitest";
import {
  NO_AGENT_MCP_SERVER_ACTIONS,
  agentMcpServerActions,
  agentMcpServerOffersMenu,
} from "./agentMcpServerActions";
import {
  AGENT_MCP_SERVER_STATUSES,
  AGENT_MCP_SERVER_TRANSPORTS,
  type AgentMcpServerScope,
  type AgentMcpServerStatus,
  type AgentMcpServerTransport,
} from "./agentMcpServers";

function server(
  status: AgentMcpServerStatus,
  scope: AgentMcpServerScope,
  transport: AgentMcpServerTransport,
  name = "linear",
) {
  return { name, status, scope, transport };
}

describe("agentMcpServerActions", () => {
  it("offers sign-in for a remote server that needs it", () => {
    expect(agentMcpServerActions("claudeCode", server("needsAuth", "local", "http"))).toEqual({
      signIn: true,
      signInAgain: false,
      signOut: false,
      removeFrom: "local",
    });
    expect(agentMcpServerActions("codex", server("needsAuth", "user", "http"))).toEqual({
      signIn: true,
      signInAgain: false,
      signOut: false,
      removeFrom: "user",
    });
  });

  it.each(["connected", "failed"] as const)(
    "offers sign in again and sign out for a %s HTTP or SSE server",
    (status) => {
      for (const transport of ["http", "sse"] as const)
        expect(agentMcpServerActions("claudeCode", server(status, "project", transport))).toEqual({
          signIn: false,
          signInAgain: true,
          signOut: true,
          removeFrom: "project",
        });
    },
  );

  it("only removes a command server", () => {
    for (const status of AGENT_MCP_SERVER_STATUSES)
      expect(agentMcpServerActions("claudeCode", server(status, "user", "stdio"))).toEqual({
        signIn: false,
        signInAgain: false,
        signOut: false,
        removeFrom: "user",
      });
  });

  it("offers no sign-in actions while a server is connecting, disabled, or unknown", () => {
    for (const status of ["connecting", "disabled", "unknown"] as const)
      expect(agentMcpServerActions("claudeCode", server(status, "local", "http"))).toEqual({
        signIn: false,
        signInAgain: false,
        signOut: false,
        removeFrom: "local",
      });
  });

  it("signs in to account connectors without removing or signing them out", () => {
    expect(
      agentMcpServerActions(
        "claudeCode",
        server("needsAuth", "account", "unknown", "claude.ai Linear"),
      ),
    ).toEqual({ signIn: true, signInAgain: false, signOut: false, removeFrom: null });
    expect(
      agentMcpServerActions(
        "claudeCode",
        server("connected", "account", "http", "claude.ai Linear"),
      ),
    ).toEqual({ signIn: false, signInAgain: true, signOut: false, removeFrom: null });
  });

  it("removes only from the Codex user configuration", () => {
    expect(agentMcpServerActions("codex", server("connected", "user", "stdio")).removeFrom).toBe(
      "user",
    );
    for (const scope of ["project", "local"] as const) {
      expect(agentMcpServerActions("codex", server("connected", scope, "http"))).toEqual({
        signIn: false,
        signInAgain: true,
        signOut: true,
        removeFrom: null,
      });
      expect(
        agentMcpServerActions("claudeCode", server("connected", scope, "http")).removeFrom,
      ).toBe(scope);
    }
  });

  it("offers nothing for plugin, managed, or unknown scope", () => {
    for (const scope of ["plugin", "managed", "unknown"] as const)
      for (const status of AGENT_MCP_SERVER_STATUSES)
        for (const transport of AGENT_MCP_SERVER_TRANSPORTS)
          for (const provider of ["claudeCode", "codex"] as const)
            expect(agentMcpServerActions(provider, server(status, scope, transport))).toBe(
              NO_AGENT_MCP_SERVER_ACTIONS,
            );
  });

  it("does not offer removal for a name the configuration commands cannot take", () => {
    for (const name of ["-rf", "two words", "plugin:linear", "a".repeat(65)])
      expect(
        agentMcpServerActions("claudeCode", server("connected", "user", "http", name)),
      ).toEqual({ signIn: false, signInAgain: true, signOut: true, removeFrom: null });
  });

  it("offers a menu only when it would contain something", () => {
    expect(agentMcpServerOffersMenu(NO_AGENT_MCP_SERVER_ACTIONS)).toBe(false);
    expect(
      agentMcpServerOffersMenu(
        agentMcpServerActions("claudeCode", server("needsAuth", "account", "http", "claude.ai X")),
      ),
    ).toBe(false);
    expect(
      agentMcpServerOffersMenu(
        agentMcpServerActions("codex", server("connected", "user", "stdio")),
      ),
    ).toBe(true);
    expect(
      agentMcpServerOffersMenu(
        agentMcpServerActions("codex", server("connected", "project", "http")),
      ),
    ).toBe(true);
  });

  it("returns frozen actions", () => {
    expect(Object.isFrozen(NO_AGENT_MCP_SERVER_ACTIONS)).toBe(true);
    expect(
      Object.isFrozen(agentMcpServerActions("codex", server("connected", "user", "http"))),
    ).toBe(true);
  });
});
