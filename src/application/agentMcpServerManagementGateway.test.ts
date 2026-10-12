import { describe, expect, it } from "vitest";
import {
  AGENT_MCP_SERVER_MANAGEMENT_ERRORS,
  type AgentMcpServerChange,
  type AgentMcpServerLoginStep,
} from "../domain/agentMcpServerManagement";
import {
  localAgentMcpServersTarget,
  serverAgentMcpServersTarget,
} from "../domain/agentMcpServersTarget";
import {
  DeferredAgentMcpServerManagementGateway,
  DeferredRemoteAgentMcpServerManagementGateway,
  settleMicrotasks,
} from "../test/agentMcpServerManagementTestSupport";
import {
  agentMcpServerManagement,
  type AgentMcpServerManagementRunners,
  type RemoteAgentMcpServerManagementGateway,
} from "./agentMcpServerManagementGateway";
import type { AgentMcpRunnerSupport } from "./agentMcpServersGateway";

const ROOT = "/work/app";
const LOGIN_ID = "login-0123456789";
const AUTHORIZE = "https://auth.example.com/authorize?state=xyz";
const CALLBACK = "http://localhost:53682/callback?code=abc&state=xyz";
const REMOTE_BASE = {
  serverId: "linux",
  runnerId: "runner-home",
  projectId: "codevo-editor",
  provider: "claude",
};
const add: AgentMcpServerChange = {
  kind: "add",
  name: "linear",
  scope: "user",
  launch: { kind: "http", url: "https://mcp.linear.app/mcp" },
};

function present<T>(value: T | null): T {
  expect(value).not.toBeNull();
  return value as T;
}

const LOCAL = present(localAgentMcpServersTarget(ROOT, "codex"));
const SERVER = present(
  serverAgentMcpServersTarget(
    { serverId: "linux", runnerId: "runner-home", projectId: "codevo-editor" },
    "claudeCode",
  ),
);

function runnersWith(support: AgentMcpRunnerSupport) {
  const asked: Array<ReadonlyArray<string>> = [];
  const runners: AgentMcpServerManagementRunners = {
    managementSupport(serverId, runnerId) {
      asked.push([serverId, runnerId]);
      return support;
    },
  };
  return { asked, runners };
}

function setup(support: AgentMcpRunnerSupport = "supported") {
  const local = new DeferredAgentMcpServerManagementGateway();
  const remote = new DeferredRemoteAgentMcpServerManagementGateway();
  const { asked, runners } = runnersWith(support);
  return { asked, local, remote, management: agentMcpServerManagement(local, remote, runners) };
}

async function refusal(work: Promise<unknown>): Promise<unknown> {
  return work.then(
    () => "resolved",
    (error: unknown) => (error instanceof Error ? error.message : error),
  );
}

function awaiting(delivery: "automatic" | "paste"): AgentMcpServerLoginStep {
  return { kind: "awaitingCallback", loginId: LOGIN_ID, authorizationUrl: AUTHORIZE, delivery };
}

describe("agentMcpServerManagement support", () => {
  it("supports a local project whenever a local gateway is wired", () => {
    const { runners } = runnersWith("unavailable");
    expect(agentMcpServerManagement(null, null, runners).support(LOCAL)).toBe("unsupported");
    expect(setup().management.support(LOCAL)).toBe("supported");
  });

  it("supports a server project only with a complete gateway and the runner capability", () => {
    const supported = setup();
    expect(supported.management.support(SERVER)).toBe("supported");
    expect(supported.asked).toEqual([["linux", "runner-home"]]);
    expect(setup("unsupported").management.support(SERVER)).toBe("unsupported");
    expect(setup("unavailable").management.support(SERVER)).toBe("unsupported");
    const { runners } = runnersWith("supported");
    expect(agentMcpServerManagement(null, null, runners).support(SERVER)).toBe("unsupported");
    expect(agentMcpServerManagement(null, {}, runners).support(SERVER)).toBe("unsupported");
  });

  it.each([
    "changeMcpServer",
    "startMcpServerLogin",
    "getMcpServerLogin",
    "submitMcpServerLoginCallback",
    "cancelMcpServerLogin",
  ] as const)("is unsupported on a server whose gateway lacks %s", async (missing) => {
    const complete = new DeferredRemoteAgentMcpServerManagementGateway();
    const partial: RemoteAgentMcpServerManagementGateway = {
      changeMcpServer: (request) => complete.changeMcpServer(request),
      startMcpServerLogin: (request) => complete.startMcpServerLogin(request),
      getMcpServerLogin: (request) => complete.getMcpServerLogin(request),
      submitMcpServerLoginCallback: (request) => complete.submitMcpServerLoginCallback(request),
      cancelMcpServerLogin: (request) => complete.cancelMcpServerLogin(request),
      [missing]: undefined,
    };
    const management = agentMcpServerManagement(null, partial, runnersWith("supported").runners);
    expect(management.support(SERVER)).toBe("unsupported");
    expect(await refusal(management.change(SERVER, add))).toBe(
      AGENT_MCP_SERVER_MANAGEMENT_ERRORS.unsupportedRunner,
    );
    expect(complete.changes.calls).toEqual([]);
  });
});

describe("agentMcpServerManagement on this device", () => {
  it("routes every operation to the local gateway with the exact workspace", async () => {
    const { local, management, remote } = setup();
    const changed = management.change(LOCAL, add);
    const started = management.startLogin(LOCAL, "linear", "signInAgain");
    const state = management.loginState(LOCAL, LOGIN_ID);
    const cancelled = management.cancelLogin(LOCAL, LOGIN_ID);
    await settleMicrotasks();
    expect(local.changes.requests()).toEqual([
      { repositoryRoot: ROOT, provider: "codex", change: add },
    ]);
    expect(local.starts.requests()).toEqual([
      { repositoryRoot: ROOT, provider: "codex", name: "linear", mode: "signInAgain" },
    ]);
    expect(local.states.requests()).toEqual([{ loginId: LOGIN_ID }]);
    expect(local.cancels.requests()).toEqual([{ loginId: LOGIN_ID }]);
    local.changes.latest()?.resolve();
    local.starts.latest()?.resolve(awaiting("automatic"));
    local.states.latest()?.resolve("pending");
    local.cancels.latest()?.resolve();
    expect(await changed).toBeUndefined();
    expect(await started).toEqual(awaiting("automatic"));
    expect(await state).toBe("pending");
    expect(await cancelled).toBeUndefined();
    expect(remote.changes.calls).toEqual([]);
  });

  it("refuses a pasted callback because delivery is automatic", async () => {
    const { local, management, remote } = setup();
    expect(await refusal(management.submitLoginCallback(LOCAL, LOGIN_ID, CALLBACK))).toBe(
      AGENT_MCP_SERVER_MANAGEMENT_ERRORS.callbackRejected,
    );
    expect(local.states.calls).toEqual([]);
    expect(remote.callbacks.calls).toEqual([]);
  });

  it("passes backend refusals through unchanged", async () => {
    const { local, management } = setup();
    const changed = refusal(management.change(LOCAL, add));
    await settleMicrotasks();
    local.changes.latest()?.reject(AGENT_MCP_SERVER_MANAGEMENT_ERRORS.serverExists);
    expect(await changed).toBe(AGENT_MCP_SERVER_MANAGEMENT_ERRORS.serverExists);
  });

  it("is unavailable without a local gateway", async () => {
    const management = agentMcpServerManagement(null, null, runnersWith("supported").runners);
    for (const work of [
      management.change(LOCAL, add),
      management.startLogin(LOCAL, "linear", "signIn"),
      management.loginState(LOCAL, LOGIN_ID),
      management.cancelLogin(LOCAL, LOGIN_ID),
    ])
      expect(await refusal(work)).toBe(AGENT_MCP_SERVER_MANAGEMENT_ERRORS.unavailable);
  });

  it("refuses values the contract forbids before reaching the gateway", async () => {
    const { local, management } = setup();
    expect(await refusal(management.change(LOCAL, { ...add, scope: "local" }))).toBe(
      AGENT_MCP_SERVER_MANAGEMENT_ERRORS.invalidRequest,
    );
    expect(
      await refusal(
        management.change(LOCAL, { ...add, launch: { kind: "sse", url: "https://x.example" } }),
      ),
    ).toBe(AGENT_MCP_SERVER_MANAGEMENT_ERRORS.invalidRequest);
    expect(await refusal(management.startLogin(LOCAL, " padded ", "signIn"))).toBe(
      AGENT_MCP_SERVER_MANAGEMENT_ERRORS.invalidRequest,
    );
    expect(await refusal(management.loginState(LOCAL, "../../etc"))).toBe(
      AGENT_MCP_SERVER_MANAGEMENT_ERRORS.loginInactive,
    );
    expect(await refusal(management.cancelLogin(LOCAL, ""))).toBe(
      AGENT_MCP_SERVER_MANAGEMENT_ERRORS.loginInactive,
    );
    expect(local.changes.calls).toEqual([]);
    expect(local.starts.calls).toEqual([]);
    expect(local.states.calls).toEqual([]);
    expect(local.cancels.calls).toEqual([]);
  });

  it("fails closed and cancels when a local login asks for a pasted callback", async () => {
    const { local, management } = setup();
    const started = refusal(management.startLogin(LOCAL, "linear", "signIn"));
    await settleMicrotasks();
    local.starts.latest()?.resolve(awaiting("paste"));
    expect(await started).toBe(AGENT_MCP_SERVER_MANAGEMENT_ERRORS.unavailable);
    expect(local.cancels.requests()).toEqual([{ loginId: LOGIN_ID }]);
    local.cancels.latest()?.reject("gone");
    await settleMicrotasks();
  });

  it.each([
    { kind: "finishInBrowser", authorizationUrl: "javascript:alert(1)" },
    { kind: "awaitingCallback", loginId: "bad id", authorizationUrl: "http://evil.example/a" },
    { kind: "completed", extra: true },
    null,
  ])("treats the malformed login step %j as unavailable", async (step) => {
    const { local, management } = setup();
    const started = refusal(management.startLogin(LOCAL, "linear", "signIn"));
    await settleMicrotasks();
    local.starts.latest()?.resolve(step as AgentMcpServerLoginStep);
    expect(await started).toBe(AGENT_MCP_SERVER_MANAGEMENT_ERRORS.unavailable);
    expect(local.cancels.calls).toEqual([]);
  });

  it.each([
    { kind: "awaitingCallback", loginId: LOGIN_ID, authorizationUrl: "http://evil.example/a" },
    { ...awaiting("automatic"), state: "secret-state" },
    { kind: "completed", loginId: LOGIN_ID },
  ])("cancels the login a malformed step %j still names", async (step) => {
    const { local, management } = setup();
    const started = refusal(management.startLogin(LOCAL, "linear", "signIn"));
    await settleMicrotasks();
    local.starts.latest()?.resolve(step as AgentMcpServerLoginStep);
    expect(await started).toBe(AGENT_MCP_SERVER_MANAGEMENT_ERRORS.unavailable);
    expect(local.cancels.requests()).toEqual([{ loginId: LOGIN_ID }]);
  });

  it("treats an unknown login state as unavailable", async () => {
    const { local, management } = setup();
    const state = refusal(management.loginState(LOCAL, LOGIN_ID));
    await settleMicrotasks();
    local.states.latest()?.resolve("cancelled" as "failed");
    expect(await state).toBe(AGENT_MCP_SERVER_MANAGEMENT_ERRORS.unavailable);
  });
});

describe("agentMcpServerManagement on a server", () => {
  it("routes every operation to the runner of the exact project", async () => {
    const { local, management, remote } = setup();
    const changed = management.change(SERVER, add);
    const started = management.startLogin(SERVER, "linear", "signIn");
    const state = management.loginState(SERVER, LOGIN_ID);
    const submitted = management.submitLoginCallback(SERVER, LOGIN_ID, `  ${CALLBACK}\n`);
    const cancelled = management.cancelLogin(SERVER, LOGIN_ID);
    await settleMicrotasks();
    expect(remote.changes.requests()).toEqual([{ ...REMOTE_BASE, change: add }]);
    expect(remote.starts.requests()).toEqual([{ ...REMOTE_BASE, name: "linear", mode: "signIn" }]);
    expect(remote.states.requests()).toEqual([{ ...REMOTE_BASE, loginId: LOGIN_ID }]);
    expect(remote.callbacks.requests()).toEqual([
      { ...REMOTE_BASE, loginId: LOGIN_ID, callbackUrl: CALLBACK },
    ]);
    expect(remote.cancels.requests()).toEqual([{ ...REMOTE_BASE, loginId: LOGIN_ID }]);
    remote.changes.latest()?.resolve();
    remote.starts.latest()?.resolve(awaiting("paste"));
    remote.states.latest()?.resolve("succeeded");
    remote.callbacks.latest()?.resolve();
    remote.cancels.latest()?.resolve();
    expect(await changed).toBeUndefined();
    expect(await started).toEqual(awaiting("paste"));
    expect(await state).toBe("succeeded");
    expect(await submitted).toBeUndefined();
    expect(await cancelled).toBeUndefined();
    expect(local.changes.calls).toEqual([]);
  });

  it("refuses a pasted address that is not a loopback callback", async () => {
    const { management, remote } = setup();
    for (const address of ["https://evil.example/callback?code=abc", "", "http://localhost/cb"])
      expect(await refusal(management.submitLoginCallback(SERVER, LOGIN_ID, address))).toBe(
        AGENT_MCP_SERVER_MANAGEMENT_ERRORS.callbackRejected,
      );
    expect(remote.callbacks.calls).toEqual([]);
  });

  it("fails closed and cancels when a server login claims automatic delivery", async () => {
    const { management, remote } = setup();
    const started = refusal(management.startLogin(SERVER, "linear", "signIn"));
    await settleMicrotasks();
    remote.starts.latest()?.resolve(awaiting("automatic"));
    expect(await started).toBe(AGENT_MCP_SERVER_MANAGEMENT_ERRORS.unavailable);
    expect(remote.cancels.requests()).toEqual([{ ...REMOTE_BASE, loginId: LOGIN_ID }]);
  });

  it.each([
    ["unsupported", "unsupportedRunner"],
    ["unavailable", "serverUnavailable"],
  ] as const)("refuses every operation while the runner is %s", async (support, kind) => {
    const { management, remote } = setup(support);
    for (const work of [
      management.change(SERVER, add),
      management.startLogin(SERVER, "linear", "signIn"),
      management.loginState(SERVER, LOGIN_ID),
      management.submitLoginCallback(SERVER, LOGIN_ID, CALLBACK),
      management.cancelLogin(SERVER, LOGIN_ID),
    ])
      expect(await refusal(work)).toBe(AGENT_MCP_SERVER_MANAGEMENT_ERRORS[kind]);
    expect(remote.changes.calls).toEqual([]);
    expect(remote.starts.calls).toEqual([]);
    expect(remote.states.calls).toEqual([]);
    expect(remote.callbacks.calls).toEqual([]);
    expect(remote.cancels.calls).toEqual([]);
  });

  it("validates a change against the server project's provider", async () => {
    const { management, remote } = setup();
    expect(
      await refusal(management.change(SERVER, { kind: "remove", name: "-x", scope: "user" })),
    ).toBe(AGENT_MCP_SERVER_MANAGEMENT_ERRORS.invalidRequest);
    const removed = management.change(SERVER, { kind: "remove", name: "x", scope: "project" });
    await settleMicrotasks();
    expect(remote.changes.requests()).toEqual([
      { ...REMOTE_BASE, change: { kind: "remove", name: "x", scope: "project" } },
    ]);
    remote.changes.latest()?.resolve();
    await removed;
  });
});
