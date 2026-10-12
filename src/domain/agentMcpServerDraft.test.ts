import { describe, expect, it } from "vitest";
import {
  agentMcpServerDraftLaunchKinds,
  agentMcpServerDraftOutcome,
  agentMcpServerDraftScopes,
  emptyAgentMcpServerDraft,
  type AgentMcpServerDraft,
} from "./agentMcpServerDraft";
import { parseAgentMcpServerChange } from "./agentMcpServerManagement";

const http: AgentMcpServerDraft = {
  name: "linear",
  launch: "http",
  target: "https://mcp.linear.app/mcp",
  scope: "local",
};

describe("agent MCP server draft", () => {
  it("offers each provider only the types and scopes it can add", () => {
    expect(agentMcpServerDraftLaunchKinds("claudeCode")).toEqual(["http", "sse", "stdio"]);
    expect(agentMcpServerDraftLaunchKinds("codex")).toEqual(["http", "stdio"]);
    expect(agentMcpServerDraftScopes("claudeCode")).toEqual(["local", "user"]);
    expect(agentMcpServerDraftScopes("codex")).toEqual(["user"]);
    expect(emptyAgentMcpServerDraft("claudeCode")).toEqual({
      name: "",
      launch: "http",
      target: "",
      scope: "local",
    });
    expect(emptyAgentMcpServerDraft("codex").scope).toBe("user");
  });

  it("reports an untouched draft as invalid without anything to complain about yet", () => {
    expect(agentMcpServerDraftOutcome("codex", emptyAgentMcpServerDraft("codex"), [])).toEqual({
      kind: "invalid",
      name: "empty",
      target: { kind: "url", issue: "empty" },
    });
  });

  it("builds an add change the provider accepts", () => {
    const outcome = agentMcpServerDraftOutcome("claudeCode", http, ["other"]);
    expect(outcome).toEqual({
      kind: "valid",
      change: {
        kind: "add",
        name: "linear",
        scope: "local",
        launch: { kind: "http", url: "https://mcp.linear.app/mcp" },
      },
    });
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(
      outcome.kind === "valid" && parseAgentMcpServerChange(outcome.change, "claudeCode"),
    ).toEqual(outcome.kind === "valid" && outcome.change);
  });

  it("trims a pasted URL and keeps SSE for Claude", () => {
    expect(
      agentMcpServerDraftOutcome(
        "claudeCode",
        { ...http, launch: "sse", target: "  https://example.com/sse\n", scope: "user" },
        [],
      ),
    ).toMatchObject({
      kind: "valid",
      change: { scope: "user", launch: { kind: "sse", url: "https://example.com/sse" } },
    });
  });

  it("parses the command into a program and arguments", () => {
    const outcome = agentMcpServerDraftOutcome(
      "codex",
      { name: "files", launch: "stdio", target: "npx -y 'my server' $HOME", scope: "user" },
      [],
    );
    expect(outcome).toEqual({
      kind: "valid",
      change: {
        kind: "add",
        name: "files",
        scope: "user",
        launch: { kind: "stdio", command: "npx", args: ["-y", "my server", "$HOME"] },
      },
    });
    expect(
      outcome.kind === "valid" && parseAgentMcpServerChange(outcome.change, "codex"),
    ).toBeTruthy();
  });

  it("always adds Codex servers for all projects", () => {
    expect(agentMcpServerDraftOutcome("codex", { ...http, scope: "local" }, [])).toMatchObject({
      kind: "valid",
      change: { scope: "user" },
    });
    expect(
      agentMcpServerDraftOutcome("claudeCode", { ...http, scope: "project" }, []),
    ).toMatchObject({ kind: "valid", change: { scope: "local" } });
  });

  it("refuses SSE for Codex", () => {
    expect(agentMcpServerDraftOutcome("codex", { ...http, launch: "sse" }, [])).toEqual({
      kind: "invalid",
      name: null,
      target: { kind: "launch", issue: "unsupported" },
    });
  });

  it.each([
    [{ ...http, name: "-x" }, "invalid", null],
    [{ ...http, name: "a".repeat(65) }, "tooLong", null],
    [{ ...http, name: "taken" }, "taken", null],
    [{ ...http, target: "ftp://example.com" }, null, { kind: "url", issue: "notHttp" }],
    [{ ...http, target: "https://u:p@example.com" }, null, { kind: "url", issue: "credentials" }],
    [
      { ...http, launch: "stdio", target: "npx 'open" },
      null,
      { kind: "command", issue: "unbalancedQuote" },
    ],
    [
      { ...http, name: "", launch: "stdio", target: "" },
      "empty",
      { kind: "command", issue: "empty" },
    ],
  ] as const)("reports what is wrong with %j", (draft, name, target) => {
    expect(agentMcpServerDraftOutcome("claudeCode", draft, ["taken"])).toEqual({
      kind: "invalid",
      name,
      target,
    });
  });
});
