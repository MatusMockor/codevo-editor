import { describe, expect, it } from "vitest";
import { agentMcpServerOrigin } from "./agentMcpServerOrigin";
import { AGENT_MCP_SERVER_SCOPES, type AgentMcpServerScope } from "./agentMcpServers";

const PROVIDERS = ["claudeCode", "codex"] as const;
const OWN = { kind: "own" };

function server(name: string, scope: AgentMcpServerScope) {
  return { name, scope };
}

describe("agentMcpServerOrigin", () => {
  it("names the plugin of a Claude server that follows the plugin naming", () => {
    expect(
      agentMcpServerOrigin("claudeCode", server("plugin:cloudflare:cloudflare-api", "unknown")),
    ).toEqual({ kind: "plugin", plugin: "cloudflare", shortName: "cloudflare-api" });
    expect(agentMcpServerOrigin("claudeCode", server("plugin:miro:miro", "unknown"))).toEqual({
      kind: "plugin",
      plugin: "miro",
      shortName: "miro",
    });
  });

  it("names the plugin of a server reported with the plugin scope when the name allows it", () => {
    for (const provider of PROVIDERS)
      expect(agentMcpServerOrigin(provider, server("plugin:docs:search", "plugin"))).toEqual({
        kind: "plugin",
        plugin: "docs",
        shortName: "search",
      });
  });

  it("keeps a plugin server whose name does not follow the naming under an unknown plugin", () => {
    for (const provider of PROVIDERS)
      for (const name of ["search", "plugin:docs", "plugin::search", "docs:search"])
        expect(agentMcpServerOrigin(provider, server(name, "plugin"))).toEqual({
          kind: "plugin",
          plugin: null,
          shortName: name,
        });
  });

  it("treats a Codex server of unknown scope as the user's own whatever its name", () => {
    for (const name of ["computer-use", "plugin:cloudflare:cloudflare-api"])
      expect(agentMcpServerOrigin("codex", server(name, "unknown"))).toEqual(OWN);
  });

  it("accepts only the exact three-part plugin name", () => {
    const rejected = [
      "plugin",
      "plugin:",
      "plugin:cloudflare",
      "plugin:cloudflare:",
      "plugin::cloudflare-api",
      "plugin: :cloudflare-api",
      "plugin:cloudflare: api",
      "plugin:cloudflare:api ",
      "plugin:cloudflare:api:extra",
      "Plugin:cloudflare:api",
      "plugins:cloudflare:api",
      " plugin:cloudflare:api",
      "cloudflare:plugin:api",
      "cloudflare-api",
    ];
    for (const name of rejected)
      expect(agentMcpServerOrigin("claudeCode", server(name, "unknown")), name).toEqual(OWN);
  });

  it("trusts a reported configuration scope over the name", () => {
    for (const provider of PROVIDERS)
      for (const scope of AGENT_MCP_SERVER_SCOPES) {
        const origin = agentMcpServerOrigin(provider, server("plugin:cloudflare:api", scope));
        const plugin = scope === "plugin" || (scope === "unknown" && provider === "claudeCode");
        expect(origin.kind, `${provider} ${scope}`).toBe(plugin ? "plugin" : "own");
      }
  });

  it("returns frozen origins", () => {
    expect(Object.isFrozen(agentMcpServerOrigin("codex", server("files", "user")))).toBe(true);
    expect(Object.isFrozen(agentMcpServerOrigin("codex", server("files", "plugin")))).toBe(true);
    expect(
      Object.isFrozen(agentMcpServerOrigin("claudeCode", server("plugin:a:b", "unknown"))),
    ).toBe(true);
  });
});
