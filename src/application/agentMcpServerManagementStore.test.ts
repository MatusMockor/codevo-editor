import { describe, expect, it, vi } from "vitest";
import {
  AGENT_MCP_SERVER_MANAGEMENT_ERRORS,
  AGENT_MCP_SERVER_MANAGEMENT_LIMITS,
  type AgentMcpServerLoginStep,
} from "../domain/agentMcpServerManagement";
import {
  localAgentMcpServersTarget,
  serverAgentMcpServersTarget,
  type AgentMcpServersTarget,
} from "../domain/agentMcpServersTarget";
import {
  DeferredAgentMcpServerManagement,
  ManualScheduler,
  RecordingUrlOpener,
  settleMicrotasks,
} from "../test/agentMcpServerManagementTestSupport";
import {
  DeferredAgentMcpServersGateway,
  agentMcpServersFixture,
} from "../test/agentMcpServersTestSupport";
import {
  AGENT_MCP_SERVER_LOGIN_POLL_MS,
  AgentMcpServerManagementCoordinator,
  IDLE_AGENT_MCP_SERVER_ACTIVITY,
  UNSUPPORTED_AGENT_MCP_SERVER_MANAGEMENT,
  agentMcpServerActivityIsBusy,
  type AgentMcpServerActivity,
} from "./agentMcpServerManagementStore";
import { agentMcpServersSource } from "./agentMcpServersGateway";
import { AgentMcpServersStatusStore } from "./agentMcpServersStore";

const LOGIN_ID = "login-0123456789";
const OTHER_LOGIN_ID = "login-abcdefghij";
const SECRET_PATH = "/authorize?client_id=abc&state=secret-state";
const AUTHORIZE = `https://auth.example.com${SECRET_PATH}`;
const CALLBACK = "http://localhost:53682/callback?code=secret-code&state=secret-state";
const DEADLINE_MS = AGENT_MCP_SERVER_MANAGEMENT_LIMITS.loginDeadlineMs;

function present<T>(value: T | null): T {
  expect(value).not.toBeNull();
  return value as T;
}

const APP = present(localAgentMcpServersTarget("/work/app", "claudeCode"));
const API = present(localAgentMcpServersTarget("/work/api", "claudeCode"));
const SERVER = present(
  serverAgentMcpServersTarget(
    { serverId: "linux", runnerId: "runner-home", projectId: "codevo-editor" },
    "codex",
  ),
);

function awaiting(
  delivery: "automatic" | "paste" = "automatic",
  loginId = LOGIN_ID,
): AgentMcpServerLoginStep {
  return { kind: "awaitingCallback", loginId, authorizationUrl: AUTHORIZE, delivery };
}

function setup(maxActivities?: number) {
  const management = new DeferredAgentMcpServerManagement();
  const checks = new DeferredAgentMcpServersGateway();
  const statuses = new AgentMcpServersStatusStore(
    agentMcpServersSource(checks, null, {
      confirm: async () => "unavailable",
      support: () => "unavailable",
    }),
  );
  const scheduler = new ManualScheduler();
  const urlOpener = new RecordingUrlOpener();
  const coordinator = new AgentMcpServerManagementCoordinator(
    { management, statuses, urlOpener, scheduler },
    maxActivities,
  );
  const seen: Array<AgentMcpServerActivity> = [];
  const published = vi.fn();
  coordinator.subscribe(published);
  const watch = (target: AgentMcpServersTarget, name: string): void => {
    coordinator.subscribe(() => seen.push(coordinator.activity(target, name)));
  };
  const kind = (target: AgentMcpServersTarget, name: string) =>
    coordinator.activity(target, name).kind;
  return {
    checks,
    scheduler,
    coordinator,
    kind,
    management,
    published,
    seen,
    statuses,
    urlOpener,
    watch,
  };
}

type Scene = ReturnType<typeof setup>;

async function startWaiting(
  scene: Scene,
  target: AgentMcpServersTarget = APP,
  step: AgentMcpServerLoginStep = awaiting(),
  name = "linear",
): Promise<void> {
  scene.coordinator.signIn(target, name, "signIn");
  await settleMicrotasks();
  scene.management.starts.latest()?.resolve(step);
  await settleMicrotasks();
}

async function tick(scene: Scene, state: "pending" | "succeeded" | "failed"): Promise<void> {
  scene.scheduler.advance(AGENT_MCP_SERVER_LOGIN_POLL_MS);
  await settleMicrotasks();
  scene.management.states.latest()?.resolve(state);
  await settleMicrotasks();
}

async function answerCheck(scene: Scene, provider: "claudeCode" | "codex" = "claudeCode") {
  scene.checks.checks[scene.checks.checks.length - 1]?.resolve(
    agentMcpServersFixture(provider, []),
  );
  await settleMicrotasks();
}

describe("AgentMcpServerManagementCoordinator sign-in", () => {
  it("opens the sign-in page, polls about every 1.5 s, and refreshes the status on success", async () => {
    const scene = setup();
    const { scheduler, coordinator, management, urlOpener } = scene;
    scene.watch(APP, "linear");
    coordinator.signIn(APP, "linear", "signIn");
    expect(coordinator.activity(APP, "linear")).toEqual({ kind: "starting", mode: "signIn" });
    await settleMicrotasks();
    expect(management.starts.requests()).toEqual([{ target: APP, name: "linear", mode: "signIn" }]);
    expect(urlOpener.opened.calls).toEqual([]);

    management.starts.latest()?.resolve(awaiting());
    await settleMicrotasks();
    expect(coordinator.activity(APP, "linear")).toEqual({
      kind: "waitingForBrowser",
      mode: "signIn",
      delivery: "automatic",
      signInHost: "auth.example.com",
      page: "opening",
      callbackError: null,
    });
    expect(urlOpener.opened.requests()).toEqual([AUTHORIZE]);
    urlOpener.opened.latest()?.resolve();
    await settleMicrotasks();
    expect(coordinator.activity(APP, "linear")).toMatchObject({ page: "opened" });

    scheduler.advance(AGENT_MCP_SERVER_LOGIN_POLL_MS - 1);
    await settleMicrotasks();
    expect(management.states.calls).toEqual([]);
    scheduler.advance(1);
    await settleMicrotasks();
    expect(management.states.requests()).toEqual([{ target: APP, loginId: LOGIN_ID }]);
    scheduler.advance(10 * AGENT_MCP_SERVER_LOGIN_POLL_MS);
    await settleMicrotasks();
    expect(management.states.calls).toHaveLength(1);

    management.states.latest()?.resolve("pending");
    await settleMicrotasks();
    await tick(scene, "succeeded");
    expect(management.states.calls).toHaveLength(2);
    expect(coordinator.activity(APP, "linear")).toEqual({ kind: "succeeded", action: "signIn" });
    expect(scene.checks.requests()).toEqual([
      { repositoryRoot: "/work/app", provider: "claudeCode" },
    ]);

    await answerCheck(scene);
    expect(coordinator.activity(APP, "linear")).toBe(IDLE_AGENT_MCP_SERVER_ACTIVITY);
    expect(scene.statuses.state(APP).kind).toBe("loaded");
    scheduler.advance(DEADLINE_MS);
    await settleMicrotasks();
    expect(management.states.calls).toHaveLength(2);
    expect(management.cancels).toEqual([]);
    expect(scheduler.pending()).toBe(0);
    expect(scene.seen.every((activity) => Object.isFrozen(activity))).toBe(true);
  });

  it("never publishes the login id, the authorization URL, or the pasted callback", async () => {
    const scene = setup();
    scene.watch(SERVER, "linear");
    await startWaiting(scene, SERVER, awaiting("paste"));
    scene.urlOpener.opened.latest()?.resolve();
    await settleMicrotasks();
    scene.coordinator.submitCallback(SERVER, "linear", CALLBACK);
    await settleMicrotasks();
    scene.management.callbacks
      .latest()
      ?.reject(AGENT_MCP_SERVER_MANAGEMENT_ERRORS.callbackRejected);
    await settleMicrotasks();
    scene.coordinator.submitCallback(SERVER, "linear", CALLBACK);
    await settleMicrotasks();
    scene.management.callbacks.latest()?.resolve();
    await tick(scene, "succeeded");

    const published = JSON.stringify(scene.seen);
    expect(scene.seen.length).toBeGreaterThan(4);
    expect(published).toContain("auth.example.com");
    for (const secret of [
      LOGIN_ID,
      SECRET_PATH,
      "secret-state",
      "secret-code",
      "https://",
      "53682",
    ])
      expect(published).not.toContain(secret);
  });

  it("finishes at once when there is nothing for the user to do", async () => {
    const scene = setup();
    await startWaiting(scene, APP, { kind: "completed" });
    expect(scene.coordinator.activity(APP, "linear")).toEqual({
      kind: "succeeded",
      action: "signIn",
    });
    expect(scene.urlOpener.opened.calls).toEqual([]);
    expect(scene.checks.checks).toHaveLength(1);
    await answerCheck(scene);
    expect(scene.kind(APP, "linear")).toBe("idle");
    expect(scene.scheduler.pending()).toBe(0);
  });

  it("reports why sign-in could not start and lets the user try again", async () => {
    const scene = setup();
    scene.coordinator.signIn(APP, "files", "signIn");
    await settleMicrotasks();
    scene.management.starts.latest()?.reject(AGENT_MCP_SERVER_MANAGEMENT_ERRORS.loginUnsupported);
    await settleMicrotasks();
    expect(scene.coordinator.activity(APP, "files")).toEqual({
      kind: "failed",
      action: "signIn",
      error: "loginUnsupported",
    });
    expect(scene.scheduler.pending()).toBe(0);
    expect(scene.checks.checks).toEqual([]);

    scene.coordinator.signIn(APP, "files", "signIn");
    expect(scene.kind(APP, "files")).toBe("starting");
    expect(scene.management.starts.calls).toHaveLength(2);
    scene.coordinator.cancel(APP, "files");
    expect(scene.kind(APP, "files")).toBe("idle");
  });

  it("fails when the backend reports the sign-in failed", async () => {
    const scene = setup();
    await startWaiting(scene);
    await tick(scene, "failed");
    expect(scene.coordinator.activity(APP, "linear")).toEqual({
      kind: "failed",
      action: "signIn",
      error: "loginFailed",
    });
    expect(scene.management.cancels).toEqual([]);
    expect(scene.scheduler.pending()).toBe(0);
    scene.coordinator.cancel(APP, "linear");
    expect(scene.kind(APP, "linear")).toBe("idle");
  });

  it("cancels the backend login when the user cancels and drops the late poll", async () => {
    const scene = setup();
    await startWaiting(scene);
    scene.scheduler.advance(AGENT_MCP_SERVER_LOGIN_POLL_MS);
    await settleMicrotasks();
    scene.coordinator.cancel(APP, "linear");
    expect(scene.kind(APP, "linear")).toBe("idle");
    expect(scene.management.cancels).toEqual([{ target: APP, loginId: LOGIN_ID }]);

    scene.management.states.latest()?.resolve("succeeded");
    await settleMicrotasks();
    expect(scene.kind(APP, "linear")).toBe("idle");
    expect(scene.checks.checks).toEqual([]);
    scene.scheduler.advance(DEADLINE_MS);
    await settleMicrotasks();
    expect(scene.management.states.calls).toHaveLength(1);
    expect(scene.management.cancels).toHaveLength(1);
    expect(scene.scheduler.pending()).toBe(0);
  });

  it("cancels a login whose start answers after the user already cancelled", async () => {
    const scene = setup();
    scene.coordinator.signIn(APP, "linear", "signIn");
    await settleMicrotasks();
    scene.coordinator.cancel(APP, "linear");
    expect(scene.kind(APP, "linear")).toBe("idle");
    expect(scene.management.cancels).toEqual([]);

    scene.management.starts.latest()?.resolve(awaiting());
    await settleMicrotasks();
    expect(scene.management.cancels).toEqual([{ target: APP, loginId: LOGIN_ID }]);
    expect(scene.kind(APP, "linear")).toBe("idle");
    expect(scene.urlOpener.opened.calls).toEqual([]);
    expect(scene.scheduler.pending()).toBe(0);
  });

  it("replaces the active login when a second one starts", async () => {
    const scene = setup();
    await startWaiting(scene, APP, awaiting(), "linear");
    scene.scheduler.advance(AGENT_MCP_SERVER_LOGIN_POLL_MS);
    await settleMicrotasks();

    scene.coordinator.signIn(APP, "sentry", "signIn");
    expect(scene.kind(APP, "linear")).toBe("idle");
    expect(scene.kind(APP, "sentry")).toBe("starting");
    expect(scene.management.cancels).toEqual([{ target: APP, loginId: LOGIN_ID }]);

    scene.management.states.calls[0]?.resolve("succeeded");
    await settleMicrotasks();
    expect(scene.kind(APP, "linear")).toBe("idle");
    expect(scene.checks.checks).toEqual([]);

    scene.management.starts.latest()?.resolve(awaiting("automatic", OTHER_LOGIN_ID));
    await settleMicrotasks();
    await tick(scene, "succeeded");
    expect(scene.management.states.latest()?.request).toEqual({
      target: APP,
      loginId: OTHER_LOGIN_ID,
    });
    expect(scene.coordinator.activity(APP, "sentry")).toEqual({
      kind: "succeeded",
      action: "signIn",
    });
    expect(scene.kind(APP, "linear")).toBe("idle");
  });

  it("drops results of an earlier login after project A, then B, then A again", async () => {
    const scene = setup();
    scene.coordinator.signIn(APP, "linear", "signIn");
    scene.coordinator.signIn(API, "linear", "signIn");
    expect(scene.kind(APP, "linear")).toBe("idle");
    scene.coordinator.signIn(APP, "linear", "signIn");
    expect(scene.kind(API, "linear")).toBe("idle");
    expect(scene.kind(APP, "linear")).toBe("starting");
    await settleMicrotasks();
    expect(scene.management.starts.requests().map((request) => request.target)).toEqual([
      APP,
      API,
      APP,
    ]);

    scene.management.starts.calls[0]?.resolve(awaiting("automatic", "login-first-000"));
    scene.management.starts.calls[1]?.reject(AGENT_MCP_SERVER_MANAGEMENT_ERRORS.loginUnsupported);
    await settleMicrotasks();
    expect(scene.management.cancels).toEqual([{ target: APP, loginId: "login-first-000" }]);
    expect(scene.kind(APP, "linear")).toBe("starting");
    expect(scene.kind(API, "linear")).toBe("idle");
    expect(scene.urlOpener.opened.calls).toEqual([]);

    scene.management.starts.calls[2]?.resolve(awaiting("automatic", OTHER_LOGIN_ID));
    await settleMicrotasks();
    expect(scene.kind(APP, "linear")).toBe("waitingForBrowser");
    await tick(scene, "succeeded");
    expect(scene.management.states.requests()).toEqual([{ target: APP, loginId: OTHER_LOGIN_ID }]);
    expect(scene.checks.requests()).toEqual([
      { repositoryRoot: "/work/app", provider: "claudeCode" },
    ]);
  });

  it("gives up at the five minute deadline and drops the poll that answers afterwards", async () => {
    const scene = setup();
    await startWaiting(scene);
    await tick(scene, "pending");
    scene.scheduler.advance(AGENT_MCP_SERVER_LOGIN_POLL_MS);
    await settleMicrotasks();
    expect(scene.management.states.calls).toHaveLength(2);

    scene.scheduler.advance(DEADLINE_MS - 2 * AGENT_MCP_SERVER_LOGIN_POLL_MS - 1);
    await settleMicrotasks();
    expect(scene.kind(APP, "linear")).toBe("waitingForBrowser");
    scene.scheduler.advance(1);
    await settleMicrotasks();
    expect(scene.coordinator.activity(APP, "linear")).toEqual({
      kind: "failed",
      action: "signIn",
      error: "loginExpired",
    });
    expect(scene.management.cancels).toEqual([{ target: APP, loginId: LOGIN_ID }]);

    scene.management.states.latest()?.resolve("succeeded");
    await settleMicrotasks();
    expect(scene.kind(APP, "linear")).toBe("failed");
    expect(scene.checks.checks).toEqual([]);
    expect(scene.scheduler.pending()).toBe(0);
  });

  it("gives up on a start that never answers and cancels it when it finally does", async () => {
    const scene = setup();
    scene.coordinator.signIn(APP, "linear", "signIn");
    scene.scheduler.advance(DEADLINE_MS);
    await settleMicrotasks();
    expect(scene.coordinator.activity(APP, "linear")).toMatchObject({
      kind: "failed",
      error: "loginExpired",
    });
    expect(scene.management.cancels).toEqual([]);
    scene.management.starts.latest()?.resolve(awaiting());
    await settleMicrotasks();
    expect(scene.management.cancels).toEqual([{ target: APP, loginId: LOGIN_ID }]);
    expect(scene.kind(APP, "linear")).toBe("failed");
  });

  it("keeps polling through brief failures and stops after three in a row", async () => {
    const scene = setup();
    await startWaiting(scene);
    const fail = async (reason: string): Promise<void> => {
      scene.scheduler.advance(AGENT_MCP_SERVER_LOGIN_POLL_MS);
      await settleMicrotasks();
      scene.management.states.latest()?.reject(reason);
      await settleMicrotasks();
    };
    await fail(AGENT_MCP_SERVER_MANAGEMENT_ERRORS.serverUnavailable);
    await fail("socket closed");
    expect(scene.kind(APP, "linear")).toBe("waitingForBrowser");
    await tick(scene, "pending");
    await fail(AGENT_MCP_SERVER_MANAGEMENT_ERRORS.busy);
    await fail(AGENT_MCP_SERVER_MANAGEMENT_ERRORS.busy);
    expect(scene.kind(APP, "linear")).toBe("waitingForBrowser");
    await fail(AGENT_MCP_SERVER_MANAGEMENT_ERRORS.serverUnavailable);
    expect(scene.coordinator.activity(APP, "linear")).toEqual({
      kind: "failed",
      action: "signIn",
      error: "serverUnavailable",
    });
    expect(scene.management.cancels).toEqual([{ target: APP, loginId: LOGIN_ID }]);
    expect(scene.management.states.calls).toHaveLength(6);
    expect(scene.scheduler.pending()).toBe(0);
  });

  it("stops at once when the backend no longer knows the login", async () => {
    const scene = setup();
    await startWaiting(scene);
    scene.scheduler.advance(AGENT_MCP_SERVER_LOGIN_POLL_MS);
    await settleMicrotasks();
    scene.management.states.latest()?.reject(AGENT_MCP_SERVER_MANAGEMENT_ERRORS.loginInactive);
    await settleMicrotasks();
    expect(scene.coordinator.activity(APP, "linear")).toMatchObject({
      kind: "failed",
      error: "loginInactive",
    });
    expect(scene.management.cancels).toEqual([]);
  });

  it("opens the page again on request and reports a page that did not open", async () => {
    const scene = setup();
    await startWaiting(scene);
    scene.urlOpener.opened.latest()?.reject(new Error(`cannot open ${AUTHORIZE}`));
    await settleMicrotasks();
    expect(scene.coordinator.activity(APP, "linear")).toMatchObject({ page: "blocked" });

    scene.coordinator.openSignInPage(APP, "linear");
    expect(scene.coordinator.activity(APP, "linear")).toMatchObject({ page: "opening" });
    await settleMicrotasks();
    expect(scene.urlOpener.opened.requests()).toEqual([AUTHORIZE, AUTHORIZE]);
    scene.urlOpener.opened.latest()?.resolve();
    await settleMicrotasks();
    expect(scene.coordinator.activity(APP, "linear")).toMatchObject({ page: "opened" });

    scene.coordinator.openSignInPage(APP, "sentry");
    scene.coordinator.openSignInPage(API, "linear");
    await settleMicrotasks();
    expect(scene.urlOpener.opened.calls).toHaveLength(2);
    scene.coordinator.cancel(APP, "linear");
    scene.coordinator.openSignInPage(APP, "linear");
    await settleMicrotasks();
    expect(scene.urlOpener.opened.calls).toHaveLength(2);
  });

  it("refreshes the status when a sign in again ends without signing in", async () => {
    const scene = setup();
    scene.coordinator.signIn(APP, "linear", "signInAgain");
    await settleMicrotasks();
    expect(scene.management.starts.latest()?.request.mode).toBe("signInAgain");
    scene.management.starts.latest()?.resolve(awaiting());
    await settleMicrotasks();
    scene.coordinator.cancel(APP, "linear");
    expect(scene.checks.checks).toHaveLength(1);
    await answerCheck(scene);

    scene.coordinator.signIn(APP, "linear", "signInAgain");
    await settleMicrotasks();
    scene.management.starts.latest()?.reject(AGENT_MCP_SERVER_MANAGEMENT_ERRORS.timedOut);
    await settleMicrotasks();
    expect(scene.coordinator.activity(APP, "linear")).toEqual({
      kind: "failed",
      action: "signInAgain",
      error: "timedOut",
    });
    expect(scene.checks.checks).toHaveLength(2);
  });
});

describe("AgentMcpServerManagementCoordinator pasted callback", () => {
  it("submits the pasted address, keeps polling, and succeeds", async () => {
    const scene = setup();
    scene.watch(SERVER, "linear");
    await startWaiting(scene, SERVER, awaiting("paste"));
    expect(scene.coordinator.activity(SERVER, "linear")).toMatchObject({
      kind: "waitingForBrowser",
      delivery: "paste",
    });

    scene.coordinator.submitCallback(SERVER, "linear", `  ${CALLBACK}  `);
    expect(scene.coordinator.activity(SERVER, "linear")).toEqual({
      kind: "submittingCallback",
      mode: "signIn",
      signInHost: "auth.example.com",
    });
    scene.coordinator.submitCallback(SERVER, "linear", CALLBACK);
    await settleMicrotasks();
    expect(scene.management.callbacks.requests()).toEqual([
      { target: SERVER, loginId: LOGIN_ID, callbackUrl: CALLBACK },
    ]);
    scene.management.callbacks.latest()?.resolve();
    await settleMicrotasks();
    expect(scene.kind(SERVER, "linear")).toBe("submittingCallback");

    await tick(scene, "pending");
    expect(scene.kind(SERVER, "linear")).toBe("submittingCallback");
    await tick(scene, "succeeded");
    expect(scene.seen.slice(-2)).toEqual([
      { kind: "succeeded", action: "signIn" },
      IDLE_AGENT_MCP_SERVER_ACTIVITY,
    ]);
    expect(scene.statuses.state(SERVER).kind).toBe("failed");
  });

  it("refuses an address that is not a loopback callback without asking the backend", async () => {
    const scene = setup();
    await startWaiting(scene, SERVER, awaiting("paste"));
    scene.coordinator.submitCallback(SERVER, "linear", "https://evil.example/callback?code=abc");
    await settleMicrotasks();
    expect(scene.coordinator.activity(SERVER, "linear")).toMatchObject({
      kind: "waitingForBrowser",
      callbackError: "callbackRejected",
    });
    expect(scene.management.callbacks.calls).toEqual([]);
  });

  it("lets the user paste again when the backend rejects the address", async () => {
    const scene = setup();
    await startWaiting(scene, SERVER, awaiting("paste"));
    scene.coordinator.submitCallback(SERVER, "linear", CALLBACK);
    await settleMicrotasks();
    scene.management.callbacks
      .latest()
      ?.reject(AGENT_MCP_SERVER_MANAGEMENT_ERRORS.callbackRejected);
    await settleMicrotasks();
    expect(scene.coordinator.activity(SERVER, "linear")).toEqual({
      kind: "waitingForBrowser",
      mode: "signIn",
      delivery: "paste",
      signInHost: "auth.example.com",
      page: "opened",
      callbackError: "callbackRejected",
    });

    scene.coordinator.submitCallback(SERVER, "linear", CALLBACK);
    await settleMicrotasks();
    expect(scene.management.callbacks.calls).toHaveLength(2);
    scene.management.callbacks.latest()?.reject(AGENT_MCP_SERVER_MANAGEMENT_ERRORS.loginInactive);
    await settleMicrotasks();
    expect(scene.coordinator.activity(SERVER, "linear")).toEqual({
      kind: "failed",
      action: "signIn",
      error: "loginInactive",
    });
  });

  it("drops a callback answer that arrives after the login already finished", async () => {
    const scene = setup();
    await startWaiting(scene, APP, awaiting("paste"));
    scene.coordinator.submitCallback(APP, "linear", CALLBACK);
    await tick(scene, "succeeded");
    expect(scene.kind(APP, "linear")).toBe("succeeded");
    scene.management.callbacks
      .latest()
      ?.reject(AGENT_MCP_SERVER_MANAGEMENT_ERRORS.callbackRejected);
    await settleMicrotasks();
    expect(scene.kind(APP, "linear")).toBe("succeeded");
    expect(scene.checks.checks).toHaveLength(1);
  });

  it("ignores a pasted address while delivery is automatic or nothing is waiting", async () => {
    const scene = setup();
    scene.coordinator.submitCallback(APP, "linear", CALLBACK);
    await startWaiting(scene);
    scene.coordinator.submitCallback(APP, "linear", CALLBACK);
    scene.coordinator.submitCallback(APP, "sentry", CALLBACK);
    await settleMicrotasks();
    expect(scene.kind(APP, "linear")).toBe("waitingForBrowser");
    expect(scene.management.callbacks.calls).toEqual([]);
  });
});

describe("AgentMcpServerManagementCoordinator finish in browser", () => {
  const step: AgentMcpServerLoginStep = {
    kind: "finishInBrowser",
    authorizationUrl: "https://claude.ai/settings/connectors?server=secret",
  };

  it("opens the page, does not poll, and checks the status again on request", async () => {
    const scene = setup();
    await startWaiting(scene, APP, step, "claude.ai Linear");
    expect(scene.coordinator.activity(APP, "claude.ai Linear")).toEqual({
      kind: "finishInBrowser",
      mode: "signIn",
      signInHost: "claude.ai",
      page: "opening",
      checking: false,
    });
    expect(scene.urlOpener.opened.requests()).toEqual([step.authorizationUrl]);
    scene.scheduler.advance(10 * AGENT_MCP_SERVER_LOGIN_POLL_MS);
    await settleMicrotasks();
    expect(scene.management.states.calls).toEqual([]);

    scene.coordinator.checkAgain(APP, "claude.ai Linear");
    scene.coordinator.checkAgain(APP, "claude.ai Linear");
    expect(scene.coordinator.activity(APP, "claude.ai Linear")).toMatchObject({ checking: true });
    expect(scene.checks.checks).toHaveLength(1);
    scene.coordinator.cancel(APP, "claude.ai Linear");
    expect(scene.kind(APP, "claude.ai Linear")).toBe("finishInBrowser");
    await answerCheck(scene);
    expect(scene.kind(APP, "claude.ai Linear")).toBe("idle");
    expect(scene.management.cancels).toEqual([]);
    expect(scene.scheduler.pending()).toBe(0);
  });

  it("cancels without a backend call because nothing is retained there", async () => {
    const scene = setup();
    await startWaiting(scene, APP, step, "claude.ai Linear");
    scene.coordinator.cancel(APP, "claude.ai Linear");
    expect(scene.kind(APP, "claude.ai Linear")).toBe("idle");
    expect(scene.management.cancels).toEqual([]);
    expect(scene.checks.checks).toEqual([]);
    expect(scene.scheduler.pending()).toBe(0);
  });

  it("checks the status by itself when the deadline passes", async () => {
    const scene = setup();
    await startWaiting(scene, APP, step, "claude.ai Linear");
    scene.scheduler.advance(DEADLINE_MS);
    await settleMicrotasks();
    expect(scene.coordinator.activity(APP, "claude.ai Linear")).toMatchObject({ checking: true });
    await answerCheck(scene);
    expect(scene.kind(APP, "claude.ai Linear")).toBe("idle");
  });
});

describe("AgentMcpServerManagementCoordinator changes", () => {
  const remove = { kind: "remove", name: "linear", scope: "local" } as const;
  const add = {
    kind: "add",
    name: "sentry",
    scope: "user",
    launch: { kind: "http", url: "https://mcp.sentry.dev/mcp" },
  } as const;

  it("applies a change and refreshes the status of that target", async () => {
    const scene = setup();
    expect(scene.coordinator.change(APP, remove)).toBe("started");
    expect(scene.coordinator.activity(APP, "linear")).toEqual({
      kind: "changing",
      change: "remove",
    });
    expect(scene.coordinator.change(APP, remove)).toBe("busy");
    await settleMicrotasks();
    expect(scene.management.changes.requests()).toEqual([{ target: APP, change: remove }]);

    scene.management.changes.latest()?.resolve();
    await settleMicrotasks();
    expect(scene.coordinator.activity(APP, "linear")).toEqual({
      kind: "succeeded",
      action: "remove",
    });
    expect(scene.checks.requests()).toEqual([
      { repositoryRoot: "/work/app", provider: "claudeCode" },
    ]);
    await answerCheck(scene);
    expect(scene.kind(APP, "linear")).toBe("idle");
  });

  it("keeps the failure until it is dismissed or tried again", async () => {
    const scene = setup();
    scene.coordinator.change(APP, add);
    await settleMicrotasks();
    scene.management.changes.latest()?.reject(AGENT_MCP_SERVER_MANAGEMENT_ERRORS.serverExists);
    await settleMicrotasks();
    expect(scene.coordinator.activity(APP, "sentry")).toEqual({
      kind: "failed",
      action: "add",
      error: "serverExists",
    });
    expect(scene.checks.checks).toEqual([]);

    expect(scene.coordinator.change(APP, add)).toBe("started");
    await settleMicrotasks();
    scene.management.changes.latest()?.reject("boom");
    await settleMicrotasks();
    expect(scene.coordinator.activity(APP, "sentry")).toMatchObject({ error: "unavailable" });
    scene.coordinator.cancel(APP, "sentry");
    expect(scene.kind(APP, "sentry")).toBe("idle");
  });

  it("waits for a check that was already running, then checks once more", async () => {
    const scene = setup();
    scene.statuses.refresh(APP);
    scene.coordinator.change(APP, { kind: "signOut", name: "linear" });
    await settleMicrotasks();
    scene.management.changes.latest()?.resolve();
    await settleMicrotasks();
    expect(scene.checks.checks).toHaveLength(1);
    expect(scene.kind(APP, "linear")).toBe("succeeded");

    await answerCheck(scene);
    expect(scene.checks.checks).toHaveLength(2);
    expect(scene.kind(APP, "linear")).toBe("succeeded");
    await answerCheck(scene);
    expect(scene.kind(APP, "linear")).toBe("idle");
    expect(scene.checks.checks).toHaveLength(2);
  });

  it("returns to idle even when the status check after a change fails", async () => {
    const scene = setup();
    scene.coordinator.change(APP, remove);
    await settleMicrotasks();
    scene.management.changes.latest()?.resolve();
    await settleMicrotasks();
    scene.checks.checks[0]?.reject("unreachable");
    await settleMicrotasks();
    expect(scene.kind(APP, "linear")).toBe("idle");
    expect(scene.statuses.state(APP).kind).toBe("failed");
  });

  it("does not start a change or a sign-in over one another for the same server", async () => {
    const scene = setup();
    await startWaiting(scene);
    expect(scene.coordinator.change(APP, remove)).toBe("busy");
    expect(scene.management.changes.calls).toEqual([]);
    expect(scene.coordinator.change(APP, add)).toBe("started");

    scene.coordinator.signIn(APP, "sentry", "signIn");
    expect(scene.kind(APP, "sentry")).toBe("changing");
    expect(scene.kind(APP, "linear")).toBe("waitingForBrowser");
    expect(scene.management.starts.calls).toHaveLength(1);
    expect(scene.management.cancels).toEqual([]);
  });

  it("keeps changes on different targets and names apart", async () => {
    const scene = setup();
    scene.coordinator.change(APP, remove);
    scene.coordinator.change(API, remove);
    scene.coordinator.change(APP, { kind: "signOut", name: "sentry" });
    await settleMicrotasks();
    scene.management.changes.calls[1]?.reject(AGENT_MCP_SERVER_MANAGEMENT_ERRORS.serverNotFound);
    await settleMicrotasks();
    expect(scene.kind(APP, "linear")).toBe("changing");
    expect(scene.coordinator.activity(API, "linear")).toMatchObject({ error: "serverNotFound" });
    expect(scene.kind(APP, "sentry")).toBe("changing");
  });

  it("evicts the oldest failure once too many are retained", async () => {
    const scene = setup(2);
    for (const name of ["a", "b", "c"]) {
      scene.coordinator.change(APP, { kind: "signOut", name });
      await settleMicrotasks();
      scene.management.changes.latest()?.reject("boom");
      await settleMicrotasks();
    }
    expect([scene.kind(APP, "a"), scene.kind(APP, "b"), scene.kind(APP, "c")]).toEqual([
      "idle",
      "failed",
      "failed",
    ]);
    scene.coordinator.change(APP, { kind: "signOut", name: "d" });
    expect([scene.kind(APP, "a"), scene.kind(APP, "b"), scene.kind(APP, "c")]).toEqual([
      "idle",
      "idle",
      "failed",
    ]);
    expect(scene.kind(APP, "d")).toBe("changing");
  });
});

describe("AgentMcpServerManagementCoordinator re-entrant listeners", () => {
  function when(
    scene: Scene,
    matches: (activity: AgentMcpServerActivity) => boolean,
    react: () => void,
    target: AgentMcpServersTarget = APP,
    name = "linear",
  ): void {
    let reacted = false;
    scene.coordinator.subscribe(() => {
      if (reacted || !matches(scene.coordinator.activity(target, name))) return;
      reacted = true;
      react();
    });
  }

  const reactions = [
    ["cancels", (scene: Scene) => scene.coordinator.cancel(APP, "linear")],
    ["disposes", (scene: Scene) => scene.coordinator.dispose()],
  ] as const;

  it.each(reactions)(
    "never asks the backend when a listener %s during the starting notification",
    async (_label, react) => {
      const scene = setup();
      when(
        scene,
        (activity) => activity.kind === "starting",
        () => react(scene),
      );
      expect(scene.coordinator.signIn(APP, "linear", "signIn")).toBe("started");
      await settleMicrotasks();
      expect(scene.management.starts.calls).toEqual([]);
      expect(scene.management.cancels).toEqual([]);
      expect(scene.kind(APP, "linear")).toBe("idle");
      expect(scene.scheduler.pending()).toBe(0);
    },
  );

  it.each(reactions)(
    "neither polls nor opens the page when a listener %s as the browser step is published",
    async (_label, react) => {
      const scene = setup();
      when(
        scene,
        (activity) => activity.kind === "waitingForBrowser",
        () => react(scene),
      );
      await startWaiting(scene);
      expect(scene.management.cancels).toEqual([{ target: APP, loginId: LOGIN_ID }]);
      expect(scene.urlOpener.opened.calls).toEqual([]);
      expect(scene.scheduler.pending()).toBe(0);
      scene.scheduler.advance(DEADLINE_MS);
      await settleMicrotasks();
      expect(scene.management.states.calls).toEqual([]);
      expect(scene.kind(APP, "linear")).toBe("idle");
    },
  );

  it("does not open the page when a listener cancels a finish-in-browser step", async () => {
    const scene = setup();
    when(
      scene,
      (activity) => activity.kind === "finishInBrowser",
      () => scene.coordinator.cancel(APP, "linear"),
    );
    await startWaiting(scene, APP, {
      kind: "finishInBrowser",
      authorizationUrl: "https://claude.ai/settings/connectors",
    });
    expect(scene.urlOpener.opened.calls).toEqual([]);
    expect(scene.scheduler.pending()).toBe(0);
    expect(scene.kind(APP, "linear")).toBe("idle");
  });

  it("does not start a replacement that a listener cancels while it replaces a login", async () => {
    const scene = setup();
    await startWaiting(scene);
    when(
      scene,
      (activity) => activity.kind === "starting",
      () => scene.coordinator.cancel(APP, "sentry"),
      APP,
      "sentry",
    );
    scene.coordinator.signIn(APP, "sentry", "signIn");
    await settleMicrotasks();
    expect(scene.management.starts.calls).toHaveLength(1);
    expect(scene.management.cancels).toEqual([{ target: APP, loginId: LOGIN_ID }]);
    expect([scene.kind(APP, "linear"), scene.kind(APP, "sentry")]).toEqual(["idle", "idle"]);
    expect(scene.scheduler.pending()).toBe(0);
  });

  it("does not open the page again when a listener cancels during the reopen notification", async () => {
    const scene = setup();
    await startWaiting(scene);
    scene.urlOpener.opened.latest()?.resolve();
    await settleMicrotasks();
    when(
      scene,
      (activity) => activity.kind === "waitingForBrowser" && activity.page === "opening",
      () => scene.coordinator.cancel(APP, "linear"),
    );
    scene.coordinator.openSignInPage(APP, "linear");
    await settleMicrotasks();
    expect(scene.urlOpener.opened.calls).toHaveLength(1);
    expect(scene.management.cancels).toHaveLength(1);
  });

  it("does not submit the callback when a listener cancels as submitting is published", async () => {
    const scene = setup();
    await startWaiting(scene, SERVER, awaiting("paste"));
    when(
      scene,
      (activity) => activity.kind === "submittingCallback",
      () => scene.coordinator.cancel(SERVER, "linear"),
      SERVER,
    );
    scene.coordinator.submitCallback(SERVER, "linear", CALLBACK);
    await settleMicrotasks();
    expect(scene.management.callbacks.calls).toEqual([]);
    expect(scene.management.cancels).toEqual([{ target: SERVER, loginId: LOGIN_ID }]);
    expect(scene.kind(SERVER, "linear")).toBe("idle");
  });

  function countingStatusWatches(scene: Scene) {
    const counts = { subscribed: 0, unsubscribed: 0 };
    const subscribe = scene.statuses.subscribe.bind(scene.statuses);
    vi.spyOn(scene.statuses, "subscribe").mockImplementation((target, listener) => {
      counts.subscribed += 1;
      const unsubscribe = subscribe(target, listener);
      return () => {
        counts.unsubscribed += 1;
        unsubscribe();
      };
    });
    return counts;
  }

  it("leaves no status watch behind when a listener disposes during the success notification", async () => {
    const scene = setup();
    const watches = countingStatusWatches(scene);
    when(
      scene,
      (activity) => activity.kind === "succeeded",
      () => scene.coordinator.dispose(),
    );
    await startWaiting(scene);
    await tick(scene, "succeeded");
    expect(scene.kind(APP, "linear")).toBe("idle");
    expect(watches).toEqual({ subscribed: 1, unsubscribed: 1 });
    expect(scene.management.cancels).toEqual([]);
    expect(scene.checks.checks).toHaveLength(1);

    when(
      scene,
      (activity) => activity.kind === "succeeded",
      () => scene.coordinator.dispose(),
      APP,
      "files",
    );
    scene.coordinator.change(APP, { kind: "signOut", name: "files" });
    await settleMicrotasks();
    scene.management.changes.latest()?.resolve();
    await settleMicrotasks();
    expect(scene.kind(APP, "files")).toBe("idle");
    expect(watches).toEqual({ subscribed: 2, unsubscribed: 2 });
    await answerCheck(scene);
    expect(scene.checks.checks).toHaveLength(1);
    expect(watches).toEqual({ subscribed: 2, unsubscribed: 2 });
  });

  it("refuses an operation a listener starts on the same server during its success notification", async () => {
    const scene = setup();
    const started: Array<string> = [];
    when(
      scene,
      (activity) => activity.kind === "succeeded",
      () => {
        started.push(scene.coordinator.signIn(APP, "linear", "signIn"));
        started.push(scene.coordinator.change(APP, { kind: "signOut", name: "linear" }));
      },
    );
    await startWaiting(scene);
    await tick(scene, "succeeded");
    expect(started).toEqual(["busy", "busy"]);
    expect(scene.kind(APP, "linear")).toBe("succeeded");
    expect(scene.management.starts.calls).toHaveLength(1);
    expect(scene.management.changes.calls).toEqual([]);
    expect(scene.checks.checks).toHaveLength(1);
    await answerCheck(scene);
    expect(scene.kind(APP, "linear")).toBe("idle");
  });

  it("asks for the status before publishing a failed sign in again, whatever a listener does", async () => {
    const scene = setup();
    const checksWhenPublished: Array<number> = [];
    when(
      scene,
      (activity) => activity.kind === "failed",
      () => {
        checksWhenPublished.push(scene.checks.checks.length);
        scene.coordinator.cancel(APP, "linear");
      },
    );
    scene.coordinator.signIn(APP, "linear", "signInAgain");
    await settleMicrotasks();
    scene.management.starts.latest()?.reject(AGENT_MCP_SERVER_MANAGEMENT_ERRORS.timedOut);
    await settleMicrotasks();
    expect(checksWhenPublished).toEqual([1]);
    expect(scene.kind(APP, "linear")).toBe("idle");
    expect(scene.checks.checks).toHaveLength(1);
  });

  it("does not apply a change when a listener disposes during the changing notification", async () => {
    const scene = setup();
    when(
      scene,
      (activity) => activity.kind === "changing",
      () => scene.coordinator.dispose(),
    );
    scene.coordinator.change(APP, { kind: "remove", name: "linear", scope: "local" });
    await settleMicrotasks();
    expect(scene.management.changes.calls).toEqual([]);
    expect(scene.kind(APP, "linear")).toBe("idle");
  });

  it("survives a status listener that disposes while the refresh after success starts", async () => {
    const scene = setup();
    scene.statuses.subscribe(APP, () => scene.coordinator.dispose());
    scene.coordinator.change(APP, { kind: "signOut", name: "linear" });
    await settleMicrotasks();
    scene.management.changes.latest()?.resolve();
    await settleMicrotasks();
    expect(scene.kind(APP, "linear")).toBe("idle");
    expect(scene.checks.checks).toHaveLength(1);
    await answerCheck(scene);
    expect(scene.kind(APP, "linear")).toBe("idle");
    expect(scene.checks.checks).toHaveLength(1);
  });
});

describe("AgentMcpServerManagementCoordinator capacity", () => {
  const signOut = (name: string) => ({ kind: "signOut", name }) as const;

  it("refuses a new distinct operation at capacity without touching what was admitted", async () => {
    const scene = setup(2);
    expect(scene.coordinator.change(APP, signOut("a"))).toBe("started");
    expect(scene.coordinator.change(API, signOut("a"))).toBe("started");
    const notified = scene.published.mock.calls.length;

    expect(scene.coordinator.change(APP, signOut("c"))).toBe("full");
    expect(scene.coordinator.signIn(APP, "c", "signIn")).toBe("full");
    await settleMicrotasks();
    expect(scene.kind(APP, "c")).toBe("idle");
    expect(scene.management.changes.calls).toHaveLength(2);
    expect(scene.management.starts.calls).toEqual([]);
    expect(scene.scheduler.pending()).toBe(0);
    expect(scene.published.mock.calls.length).toBe(notified);
    expect([scene.kind(APP, "a"), scene.kind(API, "a")]).toEqual(["changing", "changing"]);
  });

  it("counts an operation until its status refresh settles, with one watch for it", async () => {
    const scene = setup(2);
    const subscribed = vi.spyOn(scene.statuses, "subscribe");
    scene.coordinator.change(APP, signOut("a"));
    scene.coordinator.change(APP, signOut("b"));
    await settleMicrotasks();
    scene.management.changes.calls[0]?.resolve();
    await settleMicrotasks();
    expect(scene.kind(APP, "a")).toBe("succeeded");
    expect(subscribed).toHaveBeenCalledTimes(1);

    expect(scene.coordinator.change(APP, signOut("c"))).toBe("full");
    expect(scene.coordinator.change(APP, signOut("a"))).toBe("busy");
    expect(scene.coordinator.signIn(APP, "a", "signIn")).toBe("busy");
    await settleMicrotasks();
    expect(scene.management.changes.calls).toHaveLength(2);
    expect(scene.management.starts.calls).toEqual([]);
    expect(subscribed).toHaveBeenCalledTimes(1);
    expect(scene.kind(APP, "a")).toBe("succeeded");

    await answerCheck(scene);
    expect(scene.kind(APP, "a")).toBe("idle");
    expect(scene.coordinator.change(APP, signOut("c"))).toBe("started");
    expect(scene.coordinator.change(APP, signOut("d"))).toBe("full");
  });

  it("makes room by evicting a failure, never something still in flight", async () => {
    const scene = setup(2);
    scene.coordinator.change(APP, signOut("a"));
    scene.coordinator.change(APP, signOut("b"));
    await settleMicrotasks();
    scene.management.changes.calls[0]?.reject("boom");
    await settleMicrotasks();
    expect(scene.kind(APP, "a")).toBe("failed");
    expect(scene.coordinator.signIn(APP, "c", "signIn")).toBe("started");
    expect([scene.kind(APP, "a"), scene.kind(APP, "b"), scene.kind(APP, "c")]).toEqual([
      "idle",
      "changing",
      "starting",
    ]);
    expect(scene.coordinator.change(APP, signOut("d"))).toBe("full");
    expect(scene.coordinator.change(APP, signOut("b"))).toBe("busy");
  });

  it("lets a sign-in take the place of the login it replaces and keeps a refused one intact", async () => {
    const scene = setup(2);
    await startWaiting(scene);
    scene.coordinator.change(APP, signOut("b"));
    expect(scene.coordinator.change(APP, signOut("c"))).toBe("full");
    expect(scene.management.cancels).toEqual([]);
    expect(scene.kind(APP, "linear")).toBe("waitingForBrowser");

    expect(scene.coordinator.signIn(APP, "c", "signIn")).toBe("started");
    expect(scene.management.cancels).toEqual([{ target: APP, loginId: LOGIN_ID }]);
    expect([scene.kind(APP, "linear"), scene.kind(APP, "b"), scene.kind(APP, "c")]).toEqual([
      "idle",
      "changing",
      "starting",
    ]);
    expect(scene.coordinator.signIn(APP, "c", "signIn")).toBe("started");
    expect(scene.coordinator.signIn(APP, "b", "signIn")).toBe("busy");
  });

  it("keeps cleanup authority for everything admitted when it is disposed at capacity", async () => {
    const scene = setup(2);
    const unsubscribed = vi.fn();
    const subscribe = scene.statuses.subscribe.bind(scene.statuses);
    vi.spyOn(scene.statuses, "subscribe").mockImplementation((target, listener) => {
      const unsubscribe = subscribe(target, listener);
      return () => {
        unsubscribed();
        unsubscribe();
      };
    });
    await startWaiting(scene);
    scene.coordinator.change(APP, signOut("b"));
    await settleMicrotasks();
    scene.management.changes.latest()?.resolve();
    await settleMicrotasks();
    expect(scene.kind(APP, "b")).toBe("succeeded");

    scene.coordinator.dispose();
    expect(scene.management.cancels).toEqual([{ target: APP, loginId: LOGIN_ID }]);
    expect(unsubscribed).toHaveBeenCalledTimes(1);
    expect(scene.scheduler.pending()).toBe(0);
    expect(scene.coordinator.change(APP, signOut("c"))).toBe("started");
    expect(scene.coordinator.change(APP, signOut("d"))).toBe("started");
    expect(scene.coordinator.change(APP, signOut("e"))).toBe("full");
  });
});

describe("AgentMcpServerManagementCoordinator project isolation", () => {
  it("publishes nothing under project B while a login of project A runs to success", async () => {
    const scene = setup();
    const underB: Array<AgentMcpServerActivity> = [];
    scene.coordinator.subscribe(() => underB.push(scene.coordinator.activity(API, "linear")));
    scene.statuses.refresh(API);
    await answerCheck(scene);
    const checkedB = scene.checks.requests().length;

    scene.coordinator.signIn(APP, "linear", "signIn");
    await settleMicrotasks();
    expect(scene.coordinator.activity(API, "linear")).toBe(IDLE_AGENT_MCP_SERVER_ACTIVITY);

    scene.management.starts.latest()?.resolve(awaiting());
    await settleMicrotasks();
    scene.urlOpener.opened.latest()?.resolve();
    await tick(scene, "pending");
    expect(scene.kind(APP, "linear")).toBe("waitingForBrowser");
    await tick(scene, "succeeded");
    expect(scene.coordinator.activity(APP, "linear")).toEqual({
      kind: "succeeded",
      action: "signIn",
    });
    expect(scene.management.states.requests().map((request) => request.target)).toEqual([APP, APP]);
    expect(scene.checks.requests().slice(checkedB)).toEqual([
      { repositoryRoot: "/work/app", provider: "claudeCode" },
    ]);
    expect(scene.statuses.state(API).kind).toBe("loaded");

    await answerCheck(scene);
    expect(scene.kind(APP, "linear")).toBe("idle");
    expect(underB.length).toBeGreaterThan(4);
    expect(underB.every((activity) => activity === IDLE_AGENT_MCP_SERVER_ACTIVITY)).toBe(true);
    expect(scene.management.cancels).toEqual([]);
  });

  it("keeps a failure of project A out of project B and shows it on return to A", async () => {
    const scene = setup();
    scene.watch(API, "linear");
    await startWaiting(scene);
    await tick(scene, "failed");
    expect(scene.coordinator.activity(APP, "linear")).toEqual({
      kind: "failed",
      action: "signIn",
      error: "loginFailed",
    });
    expect(scene.seen.every((activity) => activity === IDLE_AGENT_MCP_SERVER_ACTIVITY)).toBe(true);
    expect(scene.checks.checks).toEqual([]);

    scene.coordinator.cancel(API, "linear");
    scene.coordinator.checkAgain(API, "linear");
    scene.coordinator.openSignInPage(API, "linear");
    scene.coordinator.submitCallback(API, "linear", CALLBACK);
    expect(scene.kind(APP, "linear")).toBe("failed");
  });
});

describe("AgentMcpServerManagementCoordinator dispose", () => {
  it("cancels a pending login, forgets everything, and drops late results", async () => {
    const scene = setup();
    await startWaiting(scene);
    scene.scheduler.advance(AGENT_MCP_SERVER_LOGIN_POLL_MS);
    await settleMicrotasks();
    scene.coordinator.change(APP, { kind: "signOut", name: "sentry" });
    scene.coordinator.change(API, { kind: "signOut", name: "done" });
    await settleMicrotasks();
    scene.management.changes.calls[1]?.resolve();
    await settleMicrotasks();
    expect(scene.kind(API, "done")).toBe("succeeded");
    const notified = scene.published.mock.calls.length;

    scene.coordinator.dispose();
    expect(scene.management.cancels).toEqual([{ target: APP, loginId: LOGIN_ID }]);
    expect([scene.kind(APP, "linear"), scene.kind(APP, "sentry"), scene.kind(API, "done")]).toEqual(
      ["idle", "idle", "idle"],
    );
    expect(scene.published.mock.calls.length).toBe(notified + 1);
    expect(scene.scheduler.pending()).toBe(0);

    scene.management.states.latest()?.resolve("succeeded");
    scene.management.changes.calls[0]?.resolve();
    scene.checks.checks[0]?.resolve(agentMcpServersFixture("claudeCode", []));
    await settleMicrotasks();
    expect([scene.kind(APP, "linear"), scene.kind(APP, "sentry"), scene.kind(API, "done")]).toEqual(
      ["idle", "idle", "idle"],
    );
    expect(scene.checks.checks).toHaveLength(1);
    expect(scene.published.mock.calls.length).toBe(notified + 1);
  });

  it("cancels a login whose start answers after dispose and stays usable", async () => {
    const scene = setup();
    scene.coordinator.signIn(APP, "linear", "signIn");
    await settleMicrotasks();
    scene.coordinator.dispose();
    scene.coordinator.dispose();
    scene.management.starts.latest()?.resolve(awaiting());
    await settleMicrotasks();
    expect(scene.management.cancels).toEqual([{ target: APP, loginId: LOGIN_ID }]);
    expect(scene.kind(APP, "linear")).toBe("idle");

    await startWaiting(scene, APP, awaiting("automatic", OTHER_LOGIN_ID));
    await tick(scene, "succeeded");
    expect(scene.kind(APP, "linear")).toBe("succeeded");
  });

  it("stops notifying a listener that unsubscribed", () => {
    const scene = setup();
    const listener = vi.fn();
    const unsubscribe = scene.coordinator.subscribe(listener);
    scene.coordinator.change(APP, { kind: "signOut", name: "linear" });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    scene.coordinator.dispose();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("agent MCP server management support and activity helpers", () => {
  it("asks the management port whether a target is supported", () => {
    const scene = setup();
    expect(scene.coordinator.support(APP)).toBe("supported");
    scene.management.supported = "unsupported";
    expect(scene.coordinator.support(APP)).toBe("unsupported");
  });

  it("offers a management that supports nothing and does nothing", () => {
    const management = UNSUPPORTED_AGENT_MCP_SERVER_MANAGEMENT;
    const listener = vi.fn();
    const unsubscribe = management.subscribe(listener);
    management.signIn(APP, "linear", "signIn");
    management.cancel(APP, "linear");
    management.dispose();
    unsubscribe();
    expect(management.support(APP)).toBe("unsupported");
    expect(management.change(APP, { kind: "signOut", name: "linear" })).toBe("busy");
    expect(management.activity(APP, "linear")).toBe(IDLE_AGENT_MCP_SERVER_ACTIVITY);
    expect(listener).not.toHaveBeenCalled();
  });

  it("knows which activities are still in flight", () => {
    const busy: ReadonlyArray<AgentMcpServerActivity> = [
      { kind: "starting", mode: "signIn" },
      { kind: "changing", change: "add" },
      { kind: "submittingCallback", mode: "signIn", signInHost: "a.example" },
    ];
    const settled: ReadonlyArray<AgentMcpServerActivity> = [
      IDLE_AGENT_MCP_SERVER_ACTIVITY,
      { kind: "succeeded", action: "remove" },
      { kind: "failed", action: "signOut", error: "busy" },
    ];
    expect(busy.map(agentMcpServerActivityIsBusy)).toEqual([true, true, true]);
    expect(settled.map(agentMcpServerActivityIsBusy)).toEqual([false, false, false]);
  });
});
