import { describe, expect, it } from "vitest";
import {
  NO_AGENT_MCP_SERVER_ACTIONS,
  agentMcpServerActions,
  agentMcpServerOffersMenu,
} from "./agentMcpServerActions";
import {
  AGENT_MCP_SERVER_SCOPES,
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

const PROVIDERS = ["claudeCode", "codex"] as const;
const NOTHING = { signIn: false, signInAgain: false, signOut: false, removeFrom: null };

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

  it("signs in to a Claude server of unknown scope without offering to remove it", () => {
    const name = "plugin:cloudflare:cloudflare-api";
    expect(
      agentMcpServerActions("claudeCode", server("needsAuth", "unknown", "http", name)),
    ).toEqual({ signIn: true, signInAgain: false, signOut: false, removeFrom: null });
    expect(agentMcpServerActions("claudeCode", server("needsAuth", "unknown", "http"))).toEqual({
      signIn: true,
      signInAgain: false,
      signOut: false,
      removeFrom: null,
    });
    for (const status of ["connected", "failed"] as const)
      for (const transport of ["http", "sse"] as const)
        expect(agentMcpServerActions("claudeCode", server(status, "unknown", transport))).toEqual({
          signIn: false,
          signInAgain: true,
          signOut: true,
          removeFrom: null,
        });
    for (const status of AGENT_MCP_SERVER_STATUSES)
      expect(agentMcpServerActions("claudeCode", server(status, "unknown", "stdio"))).toEqual(
        NOTHING,
      );
  });

  it("removes a Codex server of unknown scope from the user configuration", () => {
    for (const status of AGENT_MCP_SERVER_STATUSES)
      expect(agentMcpServerActions("codex", server(status, "unknown", "stdio"))).toEqual({
        signIn: false,
        signInAgain: false,
        signOut: false,
        removeFrom: "user",
      });
    expect(agentMcpServerActions("codex", server("needsAuth", "unknown", "http"))).toEqual({
      signIn: true,
      signInAgain: false,
      signOut: false,
      removeFrom: "user",
    });
    expect(agentMcpServerActions("codex", server("connected", "unknown", "http"))).toEqual({
      signIn: false,
      signInAgain: true,
      signOut: true,
      removeFrom: "user",
    });
  });

  it("signs in to and out of plugin servers without removing them", () => {
    for (const provider of PROVIDERS) {
      expect(agentMcpServerActions(provider, server("needsAuth", "plugin", "http"))).toEqual({
        signIn: true,
        signInAgain: false,
        signOut: false,
        removeFrom: null,
      });
      expect(agentMcpServerActions(provider, server("connected", "plugin", "sse"))).toEqual({
        signIn: false,
        signInAgain: true,
        signOut: true,
        removeFrom: null,
      });
      for (const status of AGENT_MCP_SERVER_STATUSES)
        expect(agentMcpServerActions(provider, server(status, "plugin", "stdio"))).toEqual(NOTHING);
    }
  });

  it("offers nothing for a managed server", () => {
    for (const status of AGENT_MCP_SERVER_STATUSES)
      for (const transport of AGENT_MCP_SERVER_TRANSPORTS)
        for (const provider of PROVIDERS) {
          const actions = agentMcpServerActions(provider, server(status, "managed", transport));
          expect(actions).toEqual(NO_AGENT_MCP_SERVER_ACTIONS);
          expect(agentMcpServerOffersMenu(actions)).toBe(false);
        }
  });

  it("offers sign-in actions only to servers that sign in remotely", () => {
    for (const provider of PROVIDERS)
      for (const scope of AGENT_MCP_SERVER_SCOPES)
        for (const transport of AGENT_MCP_SERVER_TRANSPORTS)
          for (const status of AGENT_MCP_SERVER_STATUSES) {
            const actions = agentMcpServerActions(provider, server(status, scope, transport));
            const remote = scope === "account" || transport === "http" || transport === "sse";
            const reachable = remote && scope !== "managed";
            const settled = status === "connected" || status === "failed";
            const where = `${provider} ${scope} ${transport} ${status}`;
            expect(actions.signIn, where).toBe(reachable && status === "needsAuth");
            expect(actions.signInAgain, where).toBe(reachable && settled);
            expect(actions.signOut, where).toBe(reachable && settled && scope !== "account");
          }
  });

  it("removes only from a configuration the provider lets Codevo change", () => {
    const removable: Readonly<
      Record<(typeof PROVIDERS)[number], Readonly<Record<AgentMcpServerScope, string | null>>>
    > = {
      claudeCode: {
        user: "user",
        project: "project",
        local: "local",
        account: null,
        plugin: null,
        managed: null,
        unknown: null,
      },
      codex: {
        user: "user",
        project: null,
        local: null,
        account: null,
        plugin: null,
        managed: null,
        unknown: "user",
      },
    };
    for (const provider of PROVIDERS)
      for (const scope of AGENT_MCP_SERVER_SCOPES)
        for (const transport of AGENT_MCP_SERVER_TRANSPORTS)
          for (const status of AGENT_MCP_SERVER_STATUSES)
            expect(
              agentMcpServerActions(provider, server(status, scope, transport)).removeFrom,
              `${provider} ${scope} ${transport} ${status}`,
            ).toBe(removable[provider][scope]);
  });

  it("does not offer removal for a name the configuration commands cannot take", () => {
    for (const name of ["-rf", "two words", "plugin:linear", "a".repeat(65)]) {
      expect(
        agentMcpServerActions("claudeCode", server("connected", "user", "http", name)),
      ).toEqual({ signIn: false, signInAgain: true, signOut: true, removeFrom: null });
      expect(agentMcpServerActions("codex", server("disabled", "unknown", "stdio", name))).toEqual(
        NOTHING,
      );
    }
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
    expect(
      agentMcpServerOffersMenu(
        agentMcpServerActions("claudeCode", server("needsAuth", "unknown", "http")),
      ),
    ).toBe(false);
    expect(
      agentMcpServerOffersMenu(
        agentMcpServerActions("claudeCode", server("connected", "unknown", "http")),
      ),
    ).toBe(true);
    expect(
      agentMcpServerOffersMenu(
        agentMcpServerActions("codex", server("disabled", "unknown", "stdio")),
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
