import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_MCP_SERVER_MANAGEMENT_ERRORS,
  type AgentMcpServerChangeRequest,
  type AgentMcpServerLoginRequest,
} from "../domain/agentMcpServerManagement";
import {
  AGENT_MCP_SERVER_MANAGEMENT_IPC_COMMANDS,
  TauriAgentMcpServerManagementGateway,
} from "./tauriAgentMcpServerManagementGateway";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const ROOT = "/Users/dev/project";
const LOGIN_ID = "login-0123456789";
const AUTHORIZE = "https://auth.example.com/authorize?state=xyz";
const changeRequest: AgentMcpServerChangeRequest = {
  repositoryRoot: ROOT,
  provider: "claudeCode",
  change: {
    kind: "add",
    name: "files",
    scope: "local",
    launch: { kind: "stdio", command: "npx", args: ["-y", "my server"] },
  },
};
const loginRequest: AgentMcpServerLoginRequest = {
  repositoryRoot: ROOT,
  provider: "codex",
  name: "linear",
  mode: "signIn",
};
const awaiting = {
  kind: "awaitingCallback",
  loginId: LOGIN_ID,
  authorizationUrl: AUTHORIZE,
  delivery: "automatic",
};

describe("TauriAgentMcpServerManagementGateway", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("names the four IPC commands of the shared contract", () => {
    expect(AGENT_MCP_SERVER_MANAGEMENT_IPC_COMMANDS).toEqual({
      change: "change_agent_mcp_server",
      startLogin: "start_agent_mcp_server_login",
      loginState: "get_agent_mcp_server_login",
      cancelLogin: "cancel_agent_mcp_server_login",
    });
  });

  it("sends exactly the change request envelope", async () => {
    invoke.mockResolvedValue({ version: 1 });
    await expect(
      new TauriAgentMcpServerManagementGateway().change(changeRequest),
    ).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledExactlyOnceWith("change_agent_mcp_server", {
      request: changeRequest,
    });
    const sent = invoke.mock.calls[0]?.[1].request;
    expect(Object.keys(sent)).toEqual(["repositoryRoot", "provider", "change"]);
    expect(Object.keys(sent.change)).toEqual(["kind", "name", "scope", "launch"]);
    expect(Object.keys(sent.change.launch)).toEqual(["kind", "command", "args"]);
  });

  it.each([
    { kind: "remove", name: "linear", scope: "project" },
    { kind: "signOut", name: "claude.ai Linear" },
    { kind: "add", name: "linear", scope: "user", launch: { kind: "sse", url: "https://x.dev/s" } },
  ] as const)("sends the %j change unchanged", async (change) => {
    invoke.mockResolvedValue({ version: 1 });
    await new TauriAgentMcpServerManagementGateway().change({ ...changeRequest, change });
    expect(invoke).toHaveBeenCalledExactlyOnceWith("change_agent_mcp_server", {
      request: { repositoryRoot: ROOT, provider: "claudeCode", change },
    });
  });

  it.each([
    { ...changeRequest, repositoryRoot: "relative" },
    { ...changeRequest, provider: "gemini" },
    { ...changeRequest, force: true },
    { ...changeRequest, change: { ...changeRequest.change, scope: "project" } },
    { ...changeRequest, change: { ...changeRequest.change, name: "-x" } },
    { ...changeRequest, change: { ...changeRequest.change, env: { TOKEN: "x" } } },
    {
      ...changeRequest,
      change: { ...changeRequest.change, launch: { kind: "stdio", command: "sh\n", args: [] } },
    },
    {
      ...changeRequest,
      provider: "codex",
      change: { kind: "remove", name: "linear", scope: "local" },
    },
  ])("refuses the change request %j before any IPC", async (request) => {
    await expect(
      new TauriAgentMcpServerManagementGateway().change(request as AgentMcpServerChangeRequest),
    ).rejects.toThrow(TypeError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([null, undefined, {}, { version: 2 }, { version: 1, name: "files" }, "ok", []])(
    "fails closed for the change receipt %j",
    async (receipt) => {
      invoke.mockResolvedValue(receipt);
      await expect(
        new TauriAgentMcpServerManagementGateway().change(changeRequest),
      ).rejects.toThrow(TypeError);
    },
  );

  it("starts a login with exactly the login request envelope", async () => {
    invoke.mockResolvedValue({ version: 1, step: awaiting });
    const step = await new TauriAgentMcpServerManagementGateway().startLogin(loginRequest);
    expect(step).toEqual(awaiting);
    expect(Object.isFrozen(step)).toBe(true);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("start_agent_mcp_server_login", {
      request: loginRequest,
    });
    expect(Object.keys(invoke.mock.calls[0]?.[1].request)).toEqual([
      "repositoryRoot",
      "provider",
      "name",
      "mode",
    ]);
  });

  it.each([
    { kind: "completed" },
    { kind: "finishInBrowser", authorizationUrl: "https://claude.ai/settings/connectors" },
  ])("returns the %j login step", async (step) => {
    invoke.mockResolvedValue({ version: 1, step });
    await expect(
      new TauriAgentMcpServerManagementGateway().startLogin(loginRequest),
    ).resolves.toEqual(step);
  });

  it.each([
    null,
    awaiting,
    { version: 1 },
    { version: 2, step: awaiting },
    { version: 1, step: awaiting, token: "secret" },
    { version: 1, step: { ...awaiting, delivery: "push" } },
    { version: 1, step: { ...awaiting, loginId: "x" } },
    { version: 1, step: { ...awaiting, authorizationUrl: "http://auth.example.com/authorize" } },
    { version: 1, step: { ...awaiting, authorizationUrl: "file:///etc/passwd" } },
    {
      version: 1,
      step: { ...awaiting, authorizationUrl: `https://a.example/${"a".repeat(4096)}` },
    },
    { version: 1, step: { ...awaiting, state: "xyz" } },
    { version: 1, step: { kind: "finishInBrowser" } },
  ])("fails closed for the login answer %j", async (answer) => {
    invoke.mockResolvedValue(answer);
    await expect(
      new TauriAgentMcpServerManagementGateway().startLogin(loginRequest),
    ).rejects.toThrow(TypeError);
  });

  it.each([
    { version: 1, step: { ...awaiting, authorizationUrl: "http://auth.example.com/authorize" } },
    { version: 1, step: { ...awaiting, authorizationUrl: "javascript:alert('secret-url')" } },
    { version: 1, step: { ...awaiting, state: "xyz" } },
    { version: 1, step: { ...awaiting, delivery: "push" } },
    { version: 1, step: awaiting, token: "secret" },
    { version: 2, step: awaiting },
    { version: 1, step: { kind: "completed", loginId: LOGIN_ID } },
    awaiting,
  ])("cancels the retained login of the malformed answer %j", async (answer) => {
    invoke.mockImplementation(async (command: string) =>
      command === "start_agent_mcp_server_login" ? answer : { version: 1 },
    );
    const failure = await new TauriAgentMcpServerManagementGateway().startLogin(loginRequest).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(TypeError);
    expect(String(failure)).not.toContain("auth.example.com");
    expect(String(failure)).not.toContain("secret");
    expect(invoke.mock.calls.map(([command, args]) => [command, args])).toEqual([
      ["start_agent_mcp_server_login", { request: loginRequest }],
      ["cancel_agent_mcp_server_login", { request: { loginId: LOGIN_ID } }],
    ]);
  });

  it("still rejects with the validation failure when that cancel fails", async () => {
    invoke.mockImplementation(async (command: string) =>
      command === "start_agent_mcp_server_login"
        ? { version: 1, step: { ...awaiting, state: "xyz" } }
        : Promise.reject(new Error("backend gone")),
    );
    await expect(
      new TauriAgentMcpServerManagementGateway().startLogin(loginRequest),
    ).rejects.toThrow(TypeError);
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it.each([
    null,
    { version: 1 },
    { version: 1, step: { kind: "finishInBrowser" } },
    { version: 1, step: { ...awaiting, loginId: "x" } },
    { version: 1, step: { ...awaiting, loginId: "../../etc/passwd" } },
    { version: 1, step: { ...awaiting, loginId: 12345678 } },
  ])("sends no cancel when the malformed answer %j names no usable login", async (answer) => {
    invoke.mockResolvedValue(answer);
    await expect(
      new TauriAgentMcpServerManagementGateway().startLogin(loginRequest),
    ).rejects.toThrow(TypeError);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...loginRequest, name: "" },
    { ...loginRequest, name: "a".repeat(129) },
    { ...loginRequest, mode: "signUp" },
    { ...loginRequest, repositoryRoot: "" },
    { ...loginRequest, timeoutSecs: 1 },
  ])("refuses the login request %j before any IPC", async (request) => {
    await expect(
      new TauriAgentMcpServerManagementGateway().startLogin(request as AgentMcpServerLoginRequest),
    ).rejects.toThrow(TypeError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each(["pending", "succeeded", "failed"] as const)(
    "reads the %s login state",
    async (state) => {
      invoke.mockResolvedValue({ version: 1, state });
      await expect(
        new TauriAgentMcpServerManagementGateway().loginState({ loginId: LOGIN_ID }),
      ).resolves.toBe(state);
      expect(invoke).toHaveBeenCalledExactlyOnceWith("get_agent_mcp_server_login", {
        request: { loginId: LOGIN_ID },
      });
    },
  );

  it.each([
    null,
    "pending",
    { version: 1 },
    { version: 1, state: "cancelled" },
    { state: "failed" },
  ])("fails closed for the login state answer %j", async (answer) => {
    invoke.mockResolvedValue(answer);
    await expect(
      new TauriAgentMcpServerManagementGateway().loginState({ loginId: LOGIN_ID }),
    ).rejects.toThrow(TypeError);
  });

  it("cancels a login by id", async () => {
    invoke.mockResolvedValue({ version: 1 });
    await expect(
      new TauriAgentMcpServerManagementGateway().cancelLogin({ loginId: LOGIN_ID }),
    ).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledExactlyOnceWith("cancel_agent_mcp_server_login", {
      request: { loginId: LOGIN_ID },
    });
    invoke.mockResolvedValue({ version: 1, cancelled: true });
    await expect(
      new TauriAgentMcpServerManagementGateway().cancelLogin({ loginId: LOGIN_ID }),
    ).rejects.toThrow(TypeError);
  });

  it.each([
    { loginId: "short" },
    { loginId: "../../etc/passwd" },
    { loginId: LOGIN_ID, name: "x" },
  ])("refuses the login id request %j before any IPC", async (request) => {
    const gateway = new TauriAgentMcpServerManagementGateway();
    await expect(gateway.loginState(request)).rejects.toThrow(TypeError);
    await expect(gateway.cancelLogin(request)).rejects.toThrow(TypeError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each(Object.values(AGENT_MCP_SERVER_MANAGEMENT_ERRORS))(
    "passes the backend refusal %j through unchanged",
    async (refusal) => {
      invoke.mockRejectedValue(refusal);
      const gateway = new TauriAgentMcpServerManagementGateway();
      await expect(gateway.change(changeRequest)).rejects.toBe(refusal);
      await expect(gateway.startLogin(loginRequest)).rejects.toBe(refusal);
      await expect(gateway.loginState({ loginId: LOGIN_ID })).rejects.toBe(refusal);
      await expect(gateway.cancelLogin({ loginId: LOGIN_ID })).rejects.toBe(refusal);
    },
  );
});
