import { describe, expect, it } from "vitest";
import {
  AGENT_MCP_SERVER_MANAGEMENT_ERRORS,
  AGENT_MCP_SERVER_MANAGEMENT_ERROR_KINDS,
  AGENT_MCP_SERVER_MANAGEMENT_LIMITS,
  agentMcpServerCallbackUrl,
  agentMcpServerCallbackUrlIssue,
  agentMcpServerConfigNameIssue,
  agentMcpServerLaunchUrlIssue,
  agentMcpServerManagementError,
  agentMcpServerManagementErrorKind,
  agentMcpServerRetainedLoginId,
  agentMcpServerSignInHost,
  isAgentMcpServerArgument,
  isAgentMcpServerAuthorizationUrl,
  isAgentMcpServerCommand,
  isAgentMcpServerLoginId,
  parseAgentMcpServerChange,
  parseAgentMcpServerChangeReceipt,
  parseAgentMcpServerChangeRequest,
  parseAgentMcpServerLoginIdRequest,
  parseAgentMcpServerLoginRequest,
  parseAgentMcpServerLoginStarted,
  parseAgentMcpServerLoginStatus,
  parseAgentMcpServerLoginStep,
} from "./agentMcpServerManagement";
import { AGENT_MCP_SERVERS_ERRORS, AGENT_MCP_SERVERS_ERROR_KINDS } from "./agentMcpServers";

const ROOT = "/Users/dev/project";
const LOGIN_ID = "login-0123456789";
const AUTHORIZE = "https://auth.example.com/authorize?client_id=abc&state=xyz";
const httpAdd = {
  kind: "add",
  name: "linear",
  scope: "user",
  launch: { kind: "http", url: "https://mcp.linear.app/mcp" },
};
const stdioAdd = {
  kind: "add",
  name: "files",
  scope: "user",
  launch: { kind: "stdio", command: "npx", args: ["-y", "@scope/server", "--root", "/tmp/a b"] },
};

describe("agent MCP server management errors", () => {
  it("uses the exact contract strings for the new error kinds", () => {
    expect({
      invalidRequest: AGENT_MCP_SERVER_MANAGEMENT_ERRORS.invalidRequest,
      serverExists: AGENT_MCP_SERVER_MANAGEMENT_ERRORS.serverExists,
      serverNotFound: AGENT_MCP_SERVER_MANAGEMENT_ERRORS.serverNotFound,
      changeUnsupported: AGENT_MCP_SERVER_MANAGEMENT_ERRORS.changeUnsupported,
      loginUnsupported: AGENT_MCP_SERVER_MANAGEMENT_ERRORS.loginUnsupported,
      loginInactive: AGENT_MCP_SERVER_MANAGEMENT_ERRORS.loginInactive,
      callbackRejected: AGENT_MCP_SERVER_MANAGEMENT_ERRORS.callbackRejected,
    }).toEqual({
      invalidRequest: "Agent MCP server request is invalid.",
      serverExists: "An MCP server with this name is already configured.",
      serverNotFound: "The MCP server is not configured.",
      changeUnsupported: "This MCP server cannot be changed from Codevo.",
      loginUnsupported: "This MCP server does not support sign-in.",
      loginInactive: "The MCP server sign-in is no longer active.",
      callbackRejected: "The MCP server sign-in did not accept this address.",
    });
  });

  it("reuses the eight status error strings unchanged", () => {
    for (const kind of AGENT_MCP_SERVERS_ERROR_KINDS)
      expect(AGENT_MCP_SERVER_MANAGEMENT_ERRORS[kind]).toBe(AGENT_MCP_SERVERS_ERRORS[kind]);
    expect(AGENT_MCP_SERVER_MANAGEMENT_ERROR_KINDS).toHaveLength(15);
    expect(new Set(Object.values(AGENT_MCP_SERVER_MANAGEMENT_ERRORS)).size).toBe(15);
  });

  it.each(AGENT_MCP_SERVER_MANAGEMENT_ERROR_KINDS)("maps the %s string to its kind", (kind) => {
    const text = AGENT_MCP_SERVER_MANAGEMENT_ERRORS[kind];
    expect(agentMcpServerManagementErrorKind(text)).toBe(kind);
    expect(agentMcpServerManagementErrorKind(new Error(` ${text} `))).toBe(kind);
    expect(agentMcpServerManagementErrorKind(agentMcpServerManagementError(kind))).toBe(kind);
  });

  it.each([null, undefined, 7, {}, "", "The MCP server is not configured", "anything else"])(
    "treats the unknown failure %j as unavailable",
    (failure) => {
      expect(agentMcpServerManagementErrorKind(failure)).toBe("unavailable");
    },
  );
});

describe("agent MCP server management values", () => {
  it.each(["a", "_private", "linear", "my-server_2", "A".repeat(64), "0day"])(
    "accepts the config name %j",
    (name) => {
      expect(agentMcpServerConfigNameIssue(name)).toBeNull();
    },
  );

  it.each([
    ["", "empty"],
    ["A".repeat(65), "tooLong"],
    ["-rf", "invalid"],
    ["two words", "invalid"],
    ["dot.name", "invalid"],
    ["ünï", "invalid"],
    ["name\n", "invalid"],
    ["a/b", "invalid"],
  ])("rejects the config name %j as %s", (name, issue) => {
    expect(agentMcpServerConfigNameIssue(name)).toBe(issue);
  });

  it.each([
    "https://mcp.linear.app/mcp",
    "http://localhost:3000/sse",
    "HTTPS://Example.com/path?query=1#frag",
    "http://127.0.0.1:8080",
    "https://[::1]:8443/mcp",
  ])("accepts the launch URL %j", (url) => {
    expect(agentMcpServerLaunchUrlIssue(url)).toBeNull();
  });

  it.each([
    ["", "empty"],
    [`https://example.com/${"a".repeat(2048)}`, "tooLong"],
    ["https://example.com/a b", "whitespace"],
    ["https://example.com/\u0000", "whitespace"],
    [" https://example.com", "whitespace"],
    ["https://example.com/ ", "whitespace"],
    ["ftp://example.com/mcp", "notHttp"],
    ["file:///etc/passwd", "notHttp"],
    ["javascript:alert(1)", "notHttp"],
    ["localhost:3000/mcp", "notHttp"],
    ["example.com/mcp", "invalid"],
    ["https:example.com", "invalid"],
    ["https:/example.com", "invalid"],
    ["http://", "invalid"],
    ["https://user@example.com/mcp", "credentials"],
    ["https://user:secret@example.com/mcp", "credentials"],
    ["https://@example.com/mcp", "credentials"],
    ["https://:@example.com/mcp", "credentials"],
  ])("rejects the launch URL %j as %s", (url, issue) => {
    expect(agentMcpServerLaunchUrlIssue(url)).toBe(issue);
  });

  it("measures the launch URL limit in bytes", () => {
    const base = "https://example.com/";
    const limit = AGENT_MCP_SERVER_MANAGEMENT_LIMITS.maxLaunchUrlBytes;
    expect(agentMcpServerLaunchUrlIssue(base + "a".repeat(limit - base.length))).toBeNull();
    expect(agentMcpServerLaunchUrlIssue(base + "é".repeat((limit - base.length) / 2 + 1))).toBe(
      "tooLong",
    );
  });

  it("bounds commands and arguments and refuses control characters", () => {
    expect(isAgentMcpServerCommand("npx")).toBe(true);
    expect(isAgentMcpServerCommand("/opt/My Tools/server")).toBe(true);
    expect(isAgentMcpServerCommand("a".repeat(1024))).toBe(true);
    expect(isAgentMcpServerCommand("a".repeat(1025))).toBe(false);
    expect(isAgentMcpServerCommand("é".repeat(513))).toBe(false);
    expect(isAgentMcpServerCommand("")).toBe(false);
    expect(isAgentMcpServerCommand("np\nx")).toBe(false);
    expect(isAgentMcpServerCommand(7)).toBe(false);
    expect(isAgentMcpServerArgument("")).toBe(true);
    expect(isAgentMcpServerArgument("--flag=value with spaces")).toBe(true);
    expect(isAgentMcpServerArgument("a".repeat(1024))).toBe(true);
    expect(isAgentMcpServerArgument("a".repeat(1025))).toBe(false);
    expect(isAgentMcpServerArgument("a\u0000b")).toBe(false);
    expect(isAgentMcpServerArgument("a\tb")).toBe(false);
    expect(isAgentMcpServerArgument("a\u007fb")).toBe(false);
    expect(isAgentMcpServerArgument(null)).toBe(false);
  });

  it.each([
    AUTHORIZE,
    "https://claude.ai/settings/connectors",
    "http://localhost:53682/authorize?x=1",
    "http://127.0.0.1:1455/auth",
    "http://localhost/",
  ])("accepts the authorization URL %j", (url) => {
    expect(isAgentMcpServerAuthorizationUrl(url)).toBe(true);
  });

  it.each([
    "",
    "http://auth.example.com/authorize",
    "http://localhost.evil.example/authorize",
    "http://localhost@evil.example/authorize",
    "http://127.0.0.1.evil.example/",
    "http://[::1]:8080/",
    "HTTPS://auth.example.com/",
    "https://user@auth.example.com/authorize",
    "https://user:secret@auth.example.com/authorize",
    "http://user@localhost:53682/authorize",
    "https:auth.example.com",
    "//auth.example.com/authorize",
    "ftp://auth.example.com/",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "codevo://callback",
    "https://auth.example.com/a b",
    "https://auth.example.com/\n",
    " https://auth.example.com/",
    "https://",
    `https://auth.example.com/${"a".repeat(4096)}`,
    7,
    null,
    undefined,
    {},
  ])("refuses the authorization URL %j", (url) => {
    expect(isAgentMcpServerAuthorizationUrl(url)).toBe(false);
    expect(agentMcpServerSignInHost(String(url))).toBeNull();
  });

  it("shows only the host of the sign-in page", () => {
    expect(agentMcpServerSignInHost(AUTHORIZE)).toBe("auth.example.com");
    expect(agentMcpServerSignInHost("https://auth.example.com:8443/a?b=c")).toBe(
      "auth.example.com:8443",
    );
    expect(agentMcpServerSignInHost("https://trusted.example@evil.example:8443/a?b=c")).toBeNull();
    expect(agentMcpServerSignInHost("http://localhost:53682/authorize")).toBe("localhost:53682");
  });

  it("reads a retained login id out of an answer that otherwise failed validation", () => {
    const step = { kind: "awaitingCallback", loginId: LOGIN_ID, authorizationUrl: "x://bad" };
    expect(agentMcpServerRetainedLoginId(step)).toBe(LOGIN_ID);
    expect(agentMcpServerRetainedLoginId({ version: 1, step })).toBe(LOGIN_ID);
    expect(agentMcpServerRetainedLoginId({ version: 9, step, extra: true })).toBe(LOGIN_ID);
    for (const answer of [
      null,
      undefined,
      LOGIN_ID,
      [LOGIN_ID],
      {},
      { step: null },
      { step: [{ loginId: LOGIN_ID }] },
      { loginId: "short" },
      { step: { loginId: "../../etc/passwd" } },
      { step: { loginId: 12345678 } },
      Object.create({ loginId: LOGIN_ID }),
    ])
      expect(agentMcpServerRetainedLoginId(answer)).toBeNull();
  });

  it("accepts only opaque backend login ids", () => {
    expect(isAgentMcpServerLoginId("abcdefgh")).toBe(true);
    expect(isAgentMcpServerLoginId("0b9f6c1e-6f0c-4c59-9a55-3f1f3c0b8a55")).toBe(true);
    expect(isAgentMcpServerLoginId("a".repeat(64))).toBe(true);
    expect(isAgentMcpServerLoginId("a".repeat(65))).toBe(false);
    expect(isAgentMcpServerLoginId("short")).toBe(false);
    expect(isAgentMcpServerLoginId("abcdefgh/../x")).toBe(false);
    expect(isAgentMcpServerLoginId("abcdefgh\n")).toBe(false);
    expect(isAgentMcpServerLoginId("abcdefgh?x=1")).toBe(false);
    expect(isAgentMcpServerLoginId(12345678)).toBe(false);
  });

  it.each([
    "http://localhost:53682/callback?code=abc&state=xyz",
    "http://127.0.0.1:1455/auth/callback?code=abc",
    "http://localhost/callback?error=access_denied",
    "  http://localhost:8080/callback?code=abc\n",
  ])("accepts the pasted callback address %j", (text) => {
    expect(agentMcpServerCallbackUrlIssue(text)).toBeNull();
    expect(agentMcpServerCallbackUrl(text)).toBe(text.trim());
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    [`http://localhost/callback?code=${"a".repeat(8192)}`, "tooLong"],
    ["not an address", "invalid"],
    ["localhost:53682/callback?code=abc", "notLoopback"],
    ["http://localhost:53682/callback?code=a b", "invalid"],
    ["http:localhost/callback?code=abc", "invalid"],
    ["https://localhost:53682/callback?code=abc", "notLoopback"],
    ["http://example.com/callback?code=abc", "notLoopback"],
    ["http://localhost.evil.example/callback?code=abc", "notLoopback"],
    ["http://localhost@evil.example/callback?code=abc", "notLoopback"],
    ["http://[::1]:8080/callback?code=abc", "notLoopback"],
    ["http://localhost:53682/callback", "missingResult"],
    ["http://localhost:53682/callback?state=xyz", "missingResult"],
    ["http://localhost:53682/callback#code=abc", "missingResult"],
  ])("refuses the pasted callback address %j as %s", (text, issue) => {
    expect(agentMcpServerCallbackUrlIssue(text)).toBe(issue);
    expect(agentMcpServerCallbackUrl(text)).toBeNull();
  });

  it("refuses a callback address that is not text", () => {
    expect(agentMcpServerCallbackUrl(7)).toBeNull();
    expect(agentMcpServerCallbackUrl(null)).toBeNull();
  });
});

describe("parseAgentMcpServerChange", () => {
  it("returns frozen copies of valid changes", () => {
    const parsed = parseAgentMcpServerChange(stdioAdd, "claudeCode");
    expect(parsed).toEqual(stdioAdd);
    expect(parsed).not.toBe(stdioAdd);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(parsed.kind === "add" && Object.isFrozen(parsed.launch)).toBe(true);
    expect(
      parsed.kind === "add" &&
        parsed.launch.kind === "stdio" &&
        Object.isFrozen(parsed.launch.args),
    ).toBe(true);
  });

  it.each([
    ["claudeCode", httpAdd],
    ["claudeCode", { ...httpAdd, scope: "local" }],
    ["claudeCode", { ...httpAdd, launch: { kind: "sse", url: "https://example.com/sse" } }],
    ["claudeCode", stdioAdd],
    ["claudeCode", { kind: "remove", name: "linear", scope: "project" }],
    ["claudeCode", { kind: "remove", name: "linear", scope: "local" }],
    ["claudeCode", { kind: "signOut", name: "claude.ai Linear" }],
    ["codex", httpAdd],
    ["codex", stdioAdd],
    ["codex", { ...stdioAdd, launch: { kind: "stdio", command: "server", args: [] } }],
    ["codex", { kind: "remove", name: "linear", scope: "user" }],
    ["codex", { kind: "signOut", name: "linear" }],
  ] as const)("accepts for %s the change %j", (provider, change) => {
    expect(parseAgentMcpServerChange(change, provider)).toEqual(change);
  });

  it.each([
    ["claudeCode", null],
    ["claudeCode", []],
    ["claudeCode", "add"],
    ["claudeCode", {}],
    ["claudeCode", { ...httpAdd, kind: "rename" }],
    ["claudeCode", { ...httpAdd, extra: true }],
    ["claudeCode", { kind: "add", name: "linear", scope: "user" }],
    ["claudeCode", { ...httpAdd, scope: "project" }],
    ["claudeCode", { ...httpAdd, scope: "account" }],
    ["claudeCode", { ...httpAdd, name: "-linear" }],
    ["claudeCode", { ...httpAdd, name: "a".repeat(65) }],
    ["claudeCode", { ...httpAdd, name: 7 }],
    ["claudeCode", { ...httpAdd, launch: { kind: "http", url: "ftp://example.com" } }],
    ["claudeCode", { ...httpAdd, launch: { kind: "http", url: "https://u:p@example.com" } }],
    ["claudeCode", { ...httpAdd, launch: { kind: "http", url: "https://example.com", args: [] } }],
    ["claudeCode", { ...httpAdd, launch: { kind: "websocket", url: "https://example.com" } }],
    ["claudeCode", { ...httpAdd, launch: null }],
    ["claudeCode", { ...stdioAdd, launch: { kind: "stdio", command: "npx" } }],
    ["claudeCode", { ...stdioAdd, launch: { kind: "stdio", command: "", args: [] } }],
    [
      "claudeCode",
      { ...stdioAdd, launch: { kind: "stdio", command: "npx -y server" + "\n", args: [] } },
    ],
    ["claudeCode", { ...stdioAdd, launch: { kind: "stdio", command: "npx", args: "-y" } }],
    ["claudeCode", { ...stdioAdd, launch: { kind: "stdio", command: "npx", args: [7] } }],
    ["claudeCode", { ...stdioAdd, launch: { kind: "stdio", command: "npx", args: ["a\u0000"] } }],
    [
      "claudeCode",
      { ...stdioAdd, launch: { kind: "stdio", command: "npx", args: ["a".repeat(1025)] } },
    ],
    [
      "claudeCode",
      { ...stdioAdd, launch: { kind: "stdio", command: "npx", args: Array(33).fill("a") } },
    ],
    ["claudeCode", { ...stdioAdd, launch: { kind: "stdio", command: "npx", args: [], url: "x" } }],
    ["claudeCode", { kind: "remove", name: "linear" }],
    ["claudeCode", { kind: "remove", name: "linear", scope: "plugin" }],
    ["claudeCode", { kind: "remove", name: "claude.ai Linear", scope: "user" }],
    ["claudeCode", { kind: "remove", name: "linear", scope: "user", launch: httpAdd.launch }],
    ["claudeCode", { kind: "signOut", name: "" }],
    ["claudeCode", { kind: "signOut", name: " linear" }],
    ["claudeCode", { kind: "signOut", name: "lin\near" }],
    ["claudeCode", { kind: "signOut", name: "a".repeat(129) }],
    ["claudeCode", { kind: "signOut", name: "linear", scope: "user" }],
    ["codex", { ...httpAdd, scope: "local" }],
    ["codex", { ...httpAdd, scope: "project" }],
    ["codex", { ...httpAdd, launch: { kind: "sse", url: "https://example.com/sse" } }],
    ["codex", { kind: "remove", name: "linear", scope: "project" }],
    ["codex", { kind: "remove", name: "linear", scope: "local" }],
  ] as const)("refuses for %s the change %j", (provider, change) => {
    expect(() => parseAgentMcpServerChange(change, provider)).toThrow(TypeError);
  });

  it("accepts exactly the argument count and size limits", () => {
    const launch = {
      kind: "stdio",
      command: "c".repeat(1024),
      args: Array<string>(32).fill("a".repeat(1024)),
    };
    expect(parseAgentMcpServerChange({ ...stdioAdd, launch }, "codex")).toEqual({
      ...stdioAdd,
      launch,
    });
  });
});

describe("agent MCP server management requests", () => {
  it("parses a change request and validates the change for its provider", () => {
    const request = { repositoryRoot: ROOT, provider: "codex", change: httpAdd };
    expect(parseAgentMcpServerChangeRequest(request)).toEqual(request);
    expect(Object.keys(parseAgentMcpServerChangeRequest(request))).toEqual([
      "repositoryRoot",
      "provider",
      "change",
    ]);
    expect(() =>
      parseAgentMcpServerChangeRequest({ ...request, change: { ...httpAdd, scope: "local" } }),
    ).toThrow(TypeError);
  });

  it.each([
    null,
    { repositoryRoot: ROOT, provider: "codex" },
    { repositoryRoot: ROOT, provider: "codex", change: httpAdd, force: true },
    { repositoryRoot: "relative/root", provider: "codex", change: httpAdd },
    { repositoryRoot: ROOT, provider: "gemini", change: httpAdd },
    { repositoryRoot: ROOT, provider: "claude", change: httpAdd },
  ])("refuses the change request %j", (request) => {
    expect(() => parseAgentMcpServerChangeRequest(request)).toThrow(TypeError);
  });

  it("parses a login request", () => {
    const request = {
      repositoryRoot: ROOT,
      provider: "claudeCode",
      name: "claude.ai Linear",
      mode: "signInAgain",
    };
    expect(parseAgentMcpServerLoginRequest(request)).toEqual(request);
    expect(Object.isFrozen(parseAgentMcpServerLoginRequest(request))).toBe(true);
  });

  it.each([
    undefined,
    { repositoryRoot: ROOT, provider: "claudeCode", name: "linear" },
    { repositoryRoot: ROOT, provider: "claudeCode", name: "linear", mode: "signUp" },
    { repositoryRoot: ROOT, provider: "claudeCode", name: "", mode: "signIn" },
    { repositoryRoot: ROOT, provider: "claudeCode", name: "a\u0000", mode: "signIn" },
    { repositoryRoot: "", provider: "claudeCode", name: "linear", mode: "signIn" },
    { repositoryRoot: ROOT, provider: "claudeCode", name: "linear", mode: "signIn", timeout: 1 },
  ])("refuses the login request %j", (request) => {
    expect(() => parseAgentMcpServerLoginRequest(request)).toThrow(TypeError);
  });

  it("parses a login id request and nothing else", () => {
    expect(parseAgentMcpServerLoginIdRequest({ loginId: LOGIN_ID })).toEqual({ loginId: LOGIN_ID });
    for (const request of [{}, { loginId: "short" }, { loginId: LOGIN_ID, name: "x" }, LOGIN_ID])
      expect(() => parseAgentMcpServerLoginIdRequest(request)).toThrow(TypeError);
  });
});

describe("agent MCP server management responses", () => {
  it("accepts only the versioned change receipt", () => {
    expect(parseAgentMcpServerChangeReceipt({ version: 1 })).toBeUndefined();
    for (const receipt of [
      null,
      {},
      { version: 2 },
      { version: "1" },
      { version: 1, ok: true },
      [],
    ])
      expect(() => parseAgentMcpServerChangeReceipt(receipt)).toThrow(TypeError);
  });

  it.each([
    { kind: "completed" },
    { kind: "finishInBrowser", authorizationUrl: "https://claude.ai/settings/connectors" },
    {
      kind: "awaitingCallback",
      loginId: LOGIN_ID,
      authorizationUrl: AUTHORIZE,
      delivery: "automatic",
    },
    {
      kind: "awaitingCallback",
      loginId: LOGIN_ID,
      authorizationUrl: "http://localhost:53682/start",
      delivery: "paste",
    },
  ])("parses the login step %j", (step) => {
    const parsed = parseAgentMcpServerLoginStarted({ version: 1, step });
    expect(parsed).toEqual(step);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(parseAgentMcpServerLoginStep(step)).toEqual(step);
  });

  it.each([
    null,
    "completed",
    {},
    { kind: "pending" },
    { kind: "completed", authorizationUrl: AUTHORIZE },
    { kind: "finishInBrowser" },
    { kind: "finishInBrowser", authorizationUrl: "http://auth.example.com/authorize" },
    { kind: "finishInBrowser", authorizationUrl: AUTHORIZE, loginId: LOGIN_ID },
    { kind: "awaitingCallback", loginId: LOGIN_ID, authorizationUrl: AUTHORIZE },
    { kind: "awaitingCallback", loginId: LOGIN_ID, authorizationUrl: AUTHORIZE, delivery: "push" },
    { kind: "awaitingCallback", loginId: "bad id", authorizationUrl: AUTHORIZE, delivery: "paste" },
    {
      kind: "awaitingCallback",
      loginId: LOGIN_ID,
      authorizationUrl: "javascript:alert(1)",
      delivery: "paste",
    },
    {
      kind: "awaitingCallback",
      loginId: LOGIN_ID,
      authorizationUrl: AUTHORIZE,
      delivery: "paste",
      state: "xyz",
    },
  ])("fails closed for the login step %j", (step) => {
    expect(() => parseAgentMcpServerLoginStep(step)).toThrow(TypeError);
    expect(() => parseAgentMcpServerLoginStarted({ version: 1, step })).toThrow(TypeError);
  });

  it("requires the versioned envelope around a login step", () => {
    const step = { kind: "completed" };
    for (const started of [step, { step }, { version: 2, step }, { version: 1, step, extra: 1 }])
      expect(() => parseAgentMcpServerLoginStarted(started)).toThrow(TypeError);
  });

  it("parses the three login states and nothing else", () => {
    for (const state of ["pending", "succeeded", "failed"])
      expect(parseAgentMcpServerLoginStatus({ version: 1, state })).toBe(state);
    for (const status of [
      null,
      "pending",
      { state: "pending" },
      { version: 1 },
      { version: 1, state: "cancelled" },
      { version: 1, state: "pending", error: "x" },
      { version: 2, state: "pending" },
    ])
      expect(() => parseAgentMcpServerLoginStatus(status)).toThrow(TypeError);
  });
});
