import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentMcpServerManagement } from "../application/agentMcpServerManagementGateway";
import {
  AGENT_MCP_SERVER_MANAGEMENT_ERRORS,
  agentMcpServerManagementErrorKind,
  type AgentMcpServerChange,
} from "../domain/agentMcpServerManagement";
import { serverAgentMcpServersTarget } from "../domain/agentMcpServersTarget";
import type {
  RemoteRunnerMcpServerChangeRequest,
  RemoteRunnerMcpServerLoginCallbackRequest,
  RemoteRunnerMcpServerLoginRequest,
  RemoteRunnerMcpServerLoginStartRequest,
  RemoteRunnerMcpServersRequest,
} from "../domain/remoteRunner";
import { RemoteRunnerRequestRejectedError } from "../domain/remoteRunnerErrors";
import { validateRemoteRunnerValue } from "../domain/remoteRunnerValidation";
import { REMOTE_RUNNER_COMMANDS, TauriRemoteRunnerGateway } from "./tauriRemoteRunnerGateway";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const LOGIN_ID = "login-0123456789";
const AUTHORIZE = "https://auth.example.com/authorize?state=xyz";
const CALLBACK = "http://localhost:33418/callback?code=abc&state=xyz";
const codexTarget: RemoteRunnerMcpServersRequest = {
  serverId: "3f2b8c1e-5a47-4d09-9c3e-7b1a2d4e6f80",
  runnerId: "runner-home",
  projectId: "codevo-editor",
  provider: "codex",
};
const claudeTarget: RemoteRunnerMcpServersRequest = { ...codexTarget, provider: "claude" };
const addition: AgentMcpServerChange = {
  kind: "add",
  name: "files",
  scope: "user",
  launch: { kind: "stdio", command: "npx", args: ["-y", "my server"] },
};
const changeRequest: RemoteRunnerMcpServerChangeRequest = { ...codexTarget, change: addition };
const loginStartRequest: RemoteRunnerMcpServerLoginStartRequest = {
  ...claudeTarget,
  name: "claude.ai Linear",
  mode: "signInAgain",
};
const loginRequest: RemoteRunnerMcpServerLoginRequest = { ...codexTarget, loginId: LOGIN_ID };
const callbackRequest: RemoteRunnerMcpServerLoginCallbackRequest = {
  ...loginRequest,
  callbackUrl: CALLBACK,
};
const awaiting = {
  kind: "awaitingCallback",
  loginId: LOGIN_ID,
  authorizationUrl: AUTHORIZE,
  delivery: "paste",
};
const TARGET_KEYS = ["serverId", "runnerId", "projectId", "provider"];

const operations = [
  {
    operation: "changeMcpServer",
    command: "remote_runner_change_mcp_server",
    request: changeRequest,
    keys: [...TARGET_KEYS, "change"],
    answer: { version: 1 },
    run: (gateway: TauriRemoteRunnerGateway, request: unknown) =>
      gateway.changeMcpServer(request as RemoteRunnerMcpServerChangeRequest),
  },
  {
    operation: "startMcpServerLogin",
    command: "remote_runner_start_mcp_server_login",
    request: loginStartRequest,
    keys: [...TARGET_KEYS, "name", "mode"],
    answer: { version: 1, step: awaiting },
    run: (gateway: TauriRemoteRunnerGateway, request: unknown) =>
      gateway.startMcpServerLogin(request as RemoteRunnerMcpServerLoginStartRequest),
  },
  {
    operation: "getMcpServerLogin",
    command: "remote_runner_get_mcp_server_login",
    request: loginRequest,
    keys: [...TARGET_KEYS, "loginId"],
    answer: { version: 1, state: "pending" },
    run: (gateway: TauriRemoteRunnerGateway, request: unknown) =>
      gateway.getMcpServerLogin(request as RemoteRunnerMcpServerLoginRequest),
  },
  {
    operation: "submitMcpServerLoginCallback",
    command: "remote_runner_submit_mcp_server_login_callback",
    request: callbackRequest,
    keys: [...TARGET_KEYS, "loginId", "callbackUrl"],
    answer: { version: 1 },
    run: (gateway: TauriRemoteRunnerGateway, request: unknown) =>
      gateway.submitMcpServerLoginCallback(request as RemoteRunnerMcpServerLoginCallbackRequest),
  },
  {
    operation: "cancelMcpServerLogin",
    command: "remote_runner_cancel_mcp_server_login",
    request: loginRequest,
    keys: [...TARGET_KEYS, "loginId"],
    answer: { version: 1 },
    run: (gateway: TauriRemoteRunnerGateway, request: unknown) =>
      gateway.cancelMcpServerLogin(request as RemoteRunnerMcpServerLoginRequest),
  },
] as const;

const invalidRequests: ReadonlyArray<readonly [string, string, unknown]> = [
  ...operations.flatMap(({ operation, request }): Array<readonly [string, string, unknown]> => [
    [operation, "an unknown field", { ...request, repositoryRoot: "/srv/project" }],
    [operation, "the local provider name", { ...request, provider: "claudeCode" }],
    [operation, "a project id with a slash", { ...request, projectId: "a/b" }],
    [operation, "a project id that climbs", { ...request, projectId: "../runner" }],
    [operation, "a missing project id", { ...request, projectId: undefined }],
    [operation, "a server id with a path", { ...request, serverId: "a/b" }],
    [operation, "a control character in the runner id", { ...request, runnerId: "runner\u0000" }],
    [operation, "an over-long runner id", { ...request, runnerId: "r".repeat(129) }],
    [operation, "no request", undefined],
  ]),
  ["changeMcpServer", "a missing change", { ...codexTarget }],
  ["changeMcpServer", "an unknown change kind", { ...codexTarget, change: { kind: "rename" } }],
  [
    "changeMcpServer",
    "a name that starts with a dash",
    { ...codexTarget, change: { ...addition, name: "--scope" } },
  ],
  [
    "changeMcpServer",
    "a Codex server outside the user scope",
    { ...codexTarget, change: { ...addition, scope: "local" } },
  ],
  [
    "changeMcpServer",
    "a Codex SSE server",
    {
      ...codexTarget,
      change: { ...addition, launch: { kind: "sse", url: "https://docs.example/sse" } },
    },
  ],
  [
    "changeMcpServer",
    "a Claude Code project-scope addition",
    { ...claudeTarget, change: { ...addition, scope: "project" } },
  ],
  [
    "changeMcpServer",
    "a launch URL with credentials",
    {
      ...claudeTarget,
      change: { ...addition, launch: { kind: "http", url: "https://user:secret@docs.example/" } },
    },
  ],
  [
    "changeMcpServer",
    "an unknown launch field",
    {
      ...claudeTarget,
      change: { ...addition, launch: { kind: "http", url: "https://docs.example/", headers: {} } },
    },
  ],
  ["startMcpServerLogin", "an empty name", { ...loginStartRequest, name: "" }],
  ["startMcpServerLogin", "a name with a line break", { ...loginStartRequest, name: "do\ncs" }],
  ["startMcpServerLogin", "an unknown mode", { ...loginStartRequest, mode: "signOut" }],
  ["startMcpServerLogin", "a missing mode", { ...claudeTarget, name: "docs" }],
  ...(
    ["getMcpServerLogin", "cancelMcpServerLogin", "submitMcpServerLoginCallback"] as const
  ).flatMap((operation): Array<readonly [string, string, unknown]> => {
    const request = operation === "submitMcpServerLoginCallback" ? callbackRequest : loginRequest;
    return [
      [operation, "a short login id", { ...request, loginId: "short" }],
      [operation, "a login id that climbs", { ...request, loginId: "../../runner" }],
      [operation, "a login id with a slash", { ...request, loginId: `${LOGIN_ID}/callback` }],
      [operation, "a login id with a query", { ...request, loginId: `${LOGIN_ID}?x=1` }],
      [operation, "an over-long login id", { ...request, loginId: "a".repeat(65) }],
      [operation, "a missing login id", { ...request, loginId: undefined }],
    ];
  }),
  ["getMcpServerLogin", "a callback address", callbackRequest],
  ["cancelMcpServerLogin", "a callback address", callbackRequest],
  ["submitMcpServerLoginCallback", "a missing callback address", loginRequest],
  [
    "submitMcpServerLoginCallback",
    "a callback address on another host",
    { ...callbackRequest, callbackUrl: "http://example.com/callback?code=abc" },
  ],
  [
    "submitMcpServerLoginCallback",
    "an https callback address",
    { ...callbackRequest, callbackUrl: "https://localhost:33418/callback?code=abc" },
  ],
  [
    "submitMcpServerLoginCallback",
    "a callback address without a result",
    { ...callbackRequest, callbackUrl: "http://localhost:33418/callback?state=xyz" },
  ],
  [
    "submitMcpServerLoginCallback",
    "an untrimmed callback address",
    { ...callbackRequest, callbackUrl: ` ${CALLBACK}` },
  ],
  [
    "submitMcpServerLoginCallback",
    "an over-long callback address",
    { ...callbackRequest, callbackUrl: `http://localhost/callback?code=${"a".repeat(8192)}` },
  ],
];

const invalidAnswers: ReadonlyArray<readonly [string, string, unknown]> = [
  ...operations.flatMap(({ operation, answer }): Array<readonly [string, string, unknown]> => [
    [operation, "another version", { ...answer, version: 2 }],
    [operation, "an unknown field", { ...answer, extra: true }],
    [operation, "no version", { ...answer, version: undefined }],
    [operation, "null", null],
    [operation, "nothing", undefined],
    [operation, "a list", []],
    [operation, "text", "ok"],
  ]),
  ["changeMcpServer", "a login step", { version: 1, step: { kind: "completed" } }],
  ["startMcpServerLogin", "no step", { version: 1 }],
  ["startMcpServerLogin", "an unknown step", { version: 1, step: { kind: "pending" } }],
  [
    "startMcpServerLogin",
    "an unknown step field",
    { version: 1, step: { ...awaiting, callbackPort: 33418 } },
  ],
  [
    "startMcpServerLogin",
    "an unknown delivery",
    { version: 1, step: { ...awaiting, delivery: "email" } },
  ],
  [
    "startMcpServerLogin",
    "a hostile login id",
    { version: 1, step: { ...awaiting, loginId: "../../runner" } },
  ],
  [
    "startMcpServerLogin",
    "a plain http authorization address",
    { version: 1, step: { ...awaiting, authorizationUrl: "http://auth.example.com/authorize" } },
  ],
  [
    "startMcpServerLogin",
    "a script authorization address",
    { version: 1, step: { kind: "finishInBrowser", authorizationUrl: "javascript:alert(1)" } },
  ],
  ["getMcpServerLogin", "no state", { version: 1 }],
  ["getMcpServerLogin", "an unknown state", { version: 1, state: "cancelled" }],
];

function operationNamed(name: string) {
  const found = operations.find(({ operation }) => operation === name);
  expect(found).toBeDefined();
  return found ?? operations[0];
}

describe("remote runner MCP server management gateway", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("names the five tunnel commands", () => {
    expect(
      Object.fromEntries(
        operations.map(({ operation }) => [operation, REMOTE_RUNNER_COMMANDS[operation]]),
      ),
    ).toEqual({
      changeMcpServer: "remote_runner_change_mcp_server",
      startMcpServerLogin: "remote_runner_start_mcp_server_login",
      getMcpServerLogin: "remote_runner_get_mcp_server_login",
      submitMcpServerLoginCallback: "remote_runner_submit_mcp_server_login_callback",
      cancelMcpServerLogin: "remote_runner_cancel_mcp_server_login",
    });
  });

  it.each(operations)(
    "sends exactly the $operation request envelope once",
    async ({ command, request, keys, answer, run }) => {
      invoke.mockResolvedValue(answer);
      await run(new TauriRemoteRunnerGateway(), request);
      expect(invoke).toHaveBeenCalledExactlyOnceWith(command, { request });
      expect(Object.keys(invoke.mock.calls[0]?.[1].request)).toEqual(keys);
    },
  );

  it("acknowledges a change, a delivered callback and a cancellation with nothing", async () => {
    invoke.mockResolvedValue({ version: 1 });
    const gateway = new TauriRemoteRunnerGateway();
    await expect(gateway.changeMcpServer(changeRequest)).resolves.toBeUndefined();
    await expect(gateway.submitMcpServerLoginCallback(callbackRequest)).resolves.toBeUndefined();
    await expect(gateway.cancelMcpServerLogin(loginRequest)).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["remove", { ...codexTarget, change: { kind: "remove", name: "files", scope: "user" } }],
    ["signOut", { ...codexTarget, change: { kind: "signOut", name: "claude.ai Linear" } }],
    [
      "a Claude Code SSE addition",
      {
        ...claudeTarget,
        change: {
          kind: "add",
          name: "events",
          scope: "local",
          launch: { kind: "sse", url: "https://events.example/sse" },
        },
      },
    ],
    [
      "a Claude Code project-scope removal",
      { ...claudeTarget, change: { kind: "remove", name: "files", scope: "project" } },
    ],
  ])("sends the %s change unchanged", async (_name, request) => {
    invoke.mockResolvedValue({ version: 1 });
    await new TauriRemoteRunnerGateway().changeMcpServer(
      request as RemoteRunnerMcpServerChangeRequest,
    );
    expect(invoke).toHaveBeenCalledExactlyOnceWith("remote_runner_change_mcp_server", { request });
  });

  it.each([
    ["completed", { kind: "completed" }],
    ["finishInBrowser", { kind: "finishInBrowser", authorizationUrl: AUTHORIZE }],
    ["awaitingCallback with paste delivery", awaiting],
    [
      "awaitingCallback on a loopback address",
      { ...awaiting, authorizationUrl: "http://127.0.0.1:33418/authorize?state=xyz" },
    ],
  ])("returns the %s login step parsed into the closed shape", async (_name, step) => {
    invoke.mockResolvedValue({ version: 1, step });
    const parsed = await new TauriRemoteRunnerGateway().startMcpServerLogin(loginStartRequest);
    expect(parsed).toEqual(step);
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it.each(["pending", "succeeded", "failed"] as const)(
    "returns the %s login state",
    async (state) => {
      invoke.mockResolvedValue({ version: 1, state });
      await expect(new TauriRemoteRunnerGateway().getMcpServerLogin(loginRequest)).resolves.toBe(
        state,
      );
    },
  );

  it.each(
    operations.flatMap(({ operation }) =>
      Object.values(AGENT_MCP_SERVER_MANAGEMENT_ERRORS).map((message) => [operation, message]),
    ),
  )("passes the %s refusal %j through unchanged", async (name, message) => {
    const { run, request } = operationNamed(name);
    invoke.mockRejectedValue(message);
    await expect(run(new TauriRemoteRunnerGateway(), request)).rejects.toBe(message);
    expect(invoke).toHaveBeenCalledOnce();
  });

  it.each(invalidRequests)("rejects %s with %s before any IPC", async (name, _case, request) => {
    const { operation, run } = operationNamed(name);
    expect(() => validateRemoteRunnerValue(operation, "request", request)).toThrow(
      `Invalid remote runner ${operation} request.`,
    );
    await expect(run(new TauriRemoteRunnerGateway(), request)).rejects.toThrow(
      RemoteRunnerRequestRejectedError,
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each(invalidAnswers)("fails closed when %s answers with %s", async (name, _case, answer) => {
    const { operation, run, request } = operationNamed(name);
    invoke.mockResolvedValue(answer);
    await expect(run(new TauriRemoteRunnerGateway(), request)).rejects.toThrow(
      `Invalid remote runner ${operation} response.`,
    );
  });

  it.each([true, false, undefined])(
    "accepts a runner descriptor with management capability %s",
    (mcpServerManagement) => {
      expect(() =>
        validateRemoteRunnerValue("getRunner", "response", {
          protocolVersion: 1,
          runnerId: "runner-home",
          name: "Home",
          capabilities: {
            taskExecution: true,
            eventReplay: true,
            mcpServers: true,
            ...(mcpServerManagement === undefined ? {} : { mcpServerManagement }),
          },
        }),
      ).not.toThrow();
    },
  );

  it.each([null, "true", 1, {}, []])(
    "rejects the invalid management capability %j",
    (mcpServerManagement) => {
      expect(() =>
        validateRemoteRunnerValue("getRunner", "response", {
          protocolVersion: 1,
          runnerId: "runner-home",
          name: "Home",
          capabilities: { taskExecution: true, eventReplay: true, mcpServerManagement },
        }),
      ).toThrow("Invalid remote runner getRunner response.");
    },
  );

  it("makes management supported for a server project whose runner advertises it", async () => {
    const target = serverAgentMcpServersTarget(
      { serverId: codexTarget.serverId, runnerId: "runner-home", projectId: "codevo-editor" },
      "codex",
    );
    expect(target).not.toBeNull();
    if (target === null) return;
    const support = vi.fn().mockReturnValue("supported");
    const management = agentMcpServerManagement(null, new TauriRemoteRunnerGateway(), {
      managementSupport: support,
    });
    expect(management.support(target)).toBe("supported");
    support.mockReturnValue("unsupported");
    expect(management.support(target)).toBe("unsupported");
    support.mockReturnValue("supported");

    invoke.mockResolvedValueOnce({ version: 1 });
    await expect(management.change(target, addition)).resolves.toBeUndefined();
    expect(invoke).toHaveBeenLastCalledWith("remote_runner_change_mcp_server", {
      request: changeRequest,
    });
    invoke.mockResolvedValueOnce({ version: 1, step: awaiting });
    await expect(management.startLogin(target, "docs", "signIn")).resolves.toEqual(awaiting);
    expect(invoke).toHaveBeenLastCalledWith("remote_runner_start_mcp_server_login", {
      request: { ...codexTarget, name: "docs", mode: "signIn" },
    });
    invoke.mockResolvedValueOnce({ version: 1, state: "succeeded" });
    await expect(management.loginState(target, LOGIN_ID)).resolves.toBe("succeeded");
    expect(invoke).toHaveBeenLastCalledWith("remote_runner_get_mcp_server_login", {
      request: loginRequest,
    });
    invoke.mockResolvedValueOnce({ version: 1 });
    await expect(
      management.submitLoginCallback(target, LOGIN_ID, ` ${CALLBACK} `),
    ).resolves.toBeUndefined();
    expect(invoke).toHaveBeenLastCalledWith("remote_runner_submit_mcp_server_login_callback", {
      request: callbackRequest,
    });
    invoke.mockResolvedValueOnce({ version: 1 });
    await expect(management.cancelLogin(target, LOGIN_ID)).resolves.toBeUndefined();
    expect(invoke).toHaveBeenLastCalledWith("remote_runner_cancel_mcp_server_login", {
      request: loginRequest,
    });
    expect(invoke).toHaveBeenCalledTimes(5);
  });

  it("carries a runner refusal through the application layer as its closed kind", async () => {
    const target = serverAgentMcpServersTarget(
      { serverId: codexTarget.serverId, runnerId: "runner-home", projectId: "codevo-editor" },
      "codex",
    );
    expect(target).not.toBeNull();
    if (target === null) return;
    const management = agentMcpServerManagement(null, new TauriRemoteRunnerGateway(), {
      managementSupport: () => "supported",
    });
    invoke.mockRejectedValue(AGENT_MCP_SERVER_MANAGEMENT_ERRORS.callbackRejected);
    const refusal: unknown = await management.submitLoginCallback(target, LOGIN_ID, CALLBACK).then(
      () => null,
      (error: unknown) => error,
    );
    expect(agentMcpServerManagementErrorKind(refusal)).toBe("callbackRejected");
    expect(invoke).toHaveBeenCalledOnce();
  });
});
