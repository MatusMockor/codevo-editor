// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { agentRootOwnerId, type AgentProjectDescriptor } from "../domain/agentProject";
import type { AgentThread } from "../domain/agentThread";
import type {
  ExternalAgentSessionPreview,
  ExternalAgentSessionSummary,
  ExternalSessionListSnapshot,
  ExternalSessionPreviewRequest,
} from "../domain/externalAgentSession";
import type { ResolvedGitRepository } from "../domain/gitRepositoryMapping";
import { resolveInReactAct } from "../test/reactTestLifecycle";
import type { ExternalSessionGateway, ExternalSessionsSurface } from "./agentThreadPorts";
import {
  EXTERNAL_SESSIONS_LIST_FAILED_NOTICE,
  EXTERNAL_SESSIONS_OWNER_LOST_NOTICE,
  EXTERNAL_SESSION_PREVIEW_FAILED_NOTICE,
  MAX_EXTERNAL_SESSION_PREVIEW_CACHE,
  useExternalSessions,
  type ExternalSessionsDependencies,
} from "./useExternalSessions";

const ROOT_KEY = "/workspace/app";
const OTHER_ROOT_KEY = "/workspace/other";
const OWNER_ID = agentRootOwnerId(ROOT_KEY);
const OTHER_OWNER_ID = agentRootOwnerId(OTHER_ROOT_KEY);
const REPOSITORY_ROOT = "/workspace/app";
const OTHER_REPOSITORY_ROOT = "/workspace/other";

const SESSION_A = "987b95ad-c9bc-4d08-ae49-9b431efc8f87";
const SESSION_B = "01a038a1-c2ee-7642-98e4-c94d7a479e0c";

function repository(repositoryRoot: string): ResolvedGitRepository {
  return { mapping: { rootRelativePath: "" }, repositoryRoot, repositoryRelativePath: "" };
}

function project(overrides: Partial<AgentProjectDescriptor> = {}): AgentProjectDescriptor {
  return {
    rootKey: ROOT_KEY,
    rootPath: ROOT_KEY,
    ownerId: OWNER_ID,
    label: "app",
    generation: 1,
    trust: "trusted",
    origin: "active-tab",
    repositories: [repository(REPOSITORY_ROOT)],
    isolationPolicy: "auto",
    leaseToken: null,
    ...overrides,
  };
}

function otherProject(): AgentProjectDescriptor {
  return project({
    rootKey: OTHER_ROOT_KEY,
    rootPath: OTHER_ROOT_KEY,
    ownerId: OTHER_OWNER_ID,
    label: "other",
    repositories: [repository(OTHER_REPOSITORY_ROOT)],
  });
}

function summary(
  overrides: Partial<ExternalAgentSessionSummary> = {},
): ExternalAgentSessionSummary {
  return {
    provider: "claudeCode",
    sessionId: SESSION_A,
    cwd: REPOSITORY_ROOT,
    title: "Terminal session",
    firstPrompt: "do the thing",
    startedAtEpochMs: 1_000,
    lastActivityEpochMs: 2_000,
    turnCount: 6,
    turnCountExact: false,
    fileBytes: 4_096,
    ...overrides,
  };
}

function snapshot(
  sessions: ReadonlyArray<ExternalAgentSessionSummary>,
  overrides: Partial<ExternalSessionListSnapshot> = {},
): ExternalSessionListSnapshot {
  return { sessions, skipped: 0, truncated: false, ...overrides };
}

function preview(sessionId: string, text: string): ExternalAgentSessionPreview {
  return {
    provider: "claudeCode",
    sessionId,
    exchanges: [{ role: "user", text }],
    exchangesTruncated: false,
    totalPreviewBytes: 32,
  };
}

function thread(overrides: Partial<AgentThread> = {}): AgentThread {
  return {
    threadId: "agt-1-0a1b",
    owner: { rootKey: ROOT_KEY, ownerId: OWNER_ID, repositoryRoot: REPOSITORY_ROOT },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: null },
    title: "Fix the parser",
    pinned: false,
    archived: false,
    createdAtEpochMs: 10,
    updatedAtEpochMs: 10,
    turns: [],
    turnsTruncated: false,
    viewedAtEpochMs: null,
    externalOrigin: null,
    integration: null,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

interface Environment {
  projects: ReadonlyArray<AgentProjectDescriptor>;
  threads: ReadonlyMap<string, AgentThread>;
}

function renderExternalSessions(overrides: Partial<Environment> = {}) {
  const environment: Environment = {
    projects: [project()],
    threads: new Map(),
    ...overrides,
  };

  const listResults: Array<() => Promise<ExternalSessionListSnapshot>> = [];
  const previewResults = new Map<string, () => Promise<ExternalAgentSessionPreview>>();

  const gateway: ExternalSessionGateway = {
    listExternalSessions: vi.fn(async () => {
      const next = listResults.shift();
      if (next !== undefined) return await next();
      return snapshot([summary()]);
    }),
    previewExternalSession: vi.fn(async (request: ExternalSessionPreviewRequest) => {
      const next = previewResults.get(request.sessionId);
      if (next !== undefined) return await next();
      return preview(request.sessionId, `preview ${request.sessionId}`);
    }),
  };

  const reportError = vi.fn();
  const setNotice = vi.fn();

  const dependencies = (): ExternalSessionsDependencies => ({
    externalSessionGateway: gateway,
    threads: environment.threads,
    projects: environment.projects,
    reportError,
    setNotice,
  });

  const host = document.createElement("div");
  const root = createRoot(host);
  const captured: { value: ExternalSessionsSurface | null } = { value: null };

  function Harness(props: { readonly dependencies: ExternalSessionsDependencies }) {
    captured.value = useExternalSessions(props.dependencies);
    return null;
  }

  const render = () => act(() => root.render(<Harness dependencies={dependencies()} />));
  render();

  return {
    gateway,
    listResults,
    previewResults,
    reportError,
    setNotice,
    hook: () => captured.value as ExternalSessionsSurface,
    set: (next: Partial<Environment>) => {
      Object.assign(environment, next);
      render();
    },
    unmount: () => act(() => root.unmount()),
  };
}

const TARGET = { rootKey: ROOT_KEY, repositoryRoot: REPOSITORY_ROOT };
const OTHER_TARGET = { rootKey: OTHER_ROOT_KEY, repositoryRoot: OTHER_REPOSITORY_ROOT };

describe("useExternalSessions", () => {
  it("starts closed and loads a target exactly once without polling", async () => {
    const harness = renderExternalSessions();
    expect(harness.hook().state).toBe("closed");
    expect(harness.hook().target).toBeNull();

    await resolveInReactAct(() => harness.hook().open(TARGET));

    expect(harness.hook().state).toBe("ready");
    expect(harness.hook().target).toEqual(TARGET);
    expect(harness.hook().sessions.map((session) => session.sessionId)).toEqual([SESSION_A]);
    expect(harness.gateway.listExternalSessions).toHaveBeenCalledTimes(1);

    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
    });
    expect(harness.gateway.listExternalSessions).toHaveBeenCalledTimes(1);

    harness.unmount();
  });

  it("publishes a loading state while the list is in flight", async () => {
    const harness = renderExternalSessions();
    const pending = deferred<ExternalSessionListSnapshot>();
    harness.listResults.push(() => pending.promise);

    let opened!: Promise<void>;
    await act(async () => {
      opened = harness.hook().open(TARGET);
    });
    expect(harness.hook().state).toBe("loading");

    pending.resolve(snapshot([summary()], { skipped: 4, truncated: true }));
    await resolveInReactAct(() => opened);

    expect(harness.hook().state).toBe("ready");
    expect(harness.hook().skipped).toBe(4);
    expect(harness.hook().truncated).toBe(true);

    harness.unmount();
  });

  it("reloads on demand and never leaves a stale snapshot", async () => {
    const harness = renderExternalSessions();
    await resolveInReactAct(() => harness.hook().open(TARGET));
    harness.listResults.push(() => Promise.resolve(snapshot([summary({ sessionId: SESSION_B })])));

    await resolveInReactAct(() => harness.hook().reload());

    expect(harness.gateway.listExternalSessions).toHaveBeenCalledTimes(2);
    expect(harness.hook().sessions.map((session) => session.sessionId)).toEqual([SESSION_B]);

    harness.unmount();
  });

  it("reports a bounded failure notice and fails closed when the gateway rejects", async () => {
    const harness = renderExternalSessions();
    harness.listResults.push(() => Promise.reject(new Error("backend exploded")));

    await resolveInReactAct(() => harness.hook().open(TARGET));

    expect(harness.hook().state).toBe("failed");
    expect(harness.hook().sessions).toEqual([]);
    expect(harness.setNotice).toHaveBeenCalledWith({
      kind: "warning",
      message: EXTERNAL_SESSIONS_LIST_FAILED_NOTICE,
      action: null,
    });
    expect(harness.reportError).toHaveBeenCalledTimes(1);

    harness.unmount();
  });

  it("refuses to load a target that no current project owns", async () => {
    const harness = renderExternalSessions({ projects: [otherProject()] });

    await resolveInReactAct(() => harness.hook().open(TARGET));

    expect(harness.hook().state).toBe("failed");
    expect(harness.gateway.listExternalSessions).not.toHaveBeenCalled();
    expect(harness.setNotice).toHaveBeenCalledWith({
      kind: "warning",
      message: EXTERNAL_SESSIONS_OWNER_LOST_NOTICE,
      action: null,
    });

    harness.unmount();
  });

  it("drops a late result when the target switches A -> B -> A", async () => {
    const harness = renderExternalSessions({ projects: [project(), otherProject()] });
    const first = deferred<ExternalSessionListSnapshot>();
    harness.listResults.push(() => first.promise);

    let openA!: Promise<void>;
    await act(async () => {
      openA = harness.hook().open(TARGET);
    });

    harness.listResults.push(() =>
      Promise.resolve(snapshot([summary({ cwd: OTHER_REPOSITORY_ROOT, sessionId: SESSION_B })])),
    );
    await resolveInReactAct(() => harness.hook().open(OTHER_TARGET));

    harness.listResults.push(() => Promise.resolve(snapshot([summary({ title: "third load" })])));
    await resolveInReactAct(() => harness.hook().open(TARGET));

    first.resolve(snapshot([summary({ title: "stale first load" })]));
    await resolveInReactAct(() => openA);

    expect(harness.hook().state).toBe("ready");
    expect(harness.hook().target).toEqual(TARGET);
    expect(harness.hook().sessions.map((session) => session.title)).toEqual(["third load"]);

    harness.unmount();
  });

  it("fails closed when the owning project generation changes mid-flight", async () => {
    const harness = renderExternalSessions();
    const pending = deferred<ExternalSessionListSnapshot>();
    harness.listResults.push(() => pending.promise);

    let opened!: Promise<void>;
    await act(async () => {
      opened = harness.hook().open(TARGET);
    });
    harness.set({ projects: [project({ generation: 2 })] });

    pending.resolve(snapshot([summary()]));
    await resolveInReactAct(() => opened);

    expect(harness.hook().state).toBe("failed");
    expect(harness.hook().sessions).toEqual([]);
    expect(harness.setNotice).toHaveBeenCalledWith({
      kind: "warning",
      message: EXTERNAL_SESSIONS_OWNER_LOST_NOTICE,
      action: null,
    });

    harness.unmount();
  });

  it("marks sessions already imported through externalOrigin or a captured session id", async () => {
    const imported = thread({
      threadId: "agt-imported",
      externalOrigin: { provider: "claudeCode", sessionId: SESSION_A, importedAtEpochMs: 50 },
    });
    const captured = thread({
      threadId: "agt-captured",
      provider: { kind: "claudeCode", sessionId: SESSION_B },
    });
    const foreign = thread({
      threadId: "agt-foreign",
      owner: { rootKey: ROOT_KEY, ownerId: OWNER_ID, repositoryRoot: OTHER_REPOSITORY_ROOT },
      externalOrigin: { provider: "codex", sessionId: SESSION_B, importedAtEpochMs: 50 },
    });
    const harness = renderExternalSessions({
      threads: new Map([
        [imported.threadId, imported],
        [captured.threadId, captured],
        [foreign.threadId, foreign],
      ]),
    });
    harness.listResults.push(() =>
      Promise.resolve(
        snapshot([
          summary(),
          summary({ sessionId: SESSION_B }),
          summary({ sessionId: SESSION_B, provider: "codex" }),
        ]),
      ),
    );

    await resolveInReactAct(() => harness.hook().open(TARGET));

    expect(
      harness.hook().sessions.map((session) => [session.provider, session.alreadyImportedThreadId]),
    ).toEqual([
      ["claudeCode", "agt-imported"],
      ["claudeCode", "agt-captured"],
      ["codex", null],
    ]);

    harness.unmount();
  });

  it("loads a preview once per session and serves the cached copy afterwards", async () => {
    const harness = renderExternalSessions();
    harness.listResults.push(() =>
      Promise.resolve(snapshot([summary(), summary({ sessionId: SESSION_B })])),
    );
    await resolveInReactAct(() => harness.hook().open(TARGET));

    await resolveInReactAct(() => harness.hook().loadPreview(SESSION_A));
    expect(harness.hook().preview?.exchanges[0]?.text).toBe(`preview ${SESSION_A}`);
    expect(harness.hook().previewPending).toBe(false);

    await resolveInReactAct(() => harness.hook().loadPreview(SESSION_B));
    expect(harness.hook().preview?.sessionId).toBe(SESSION_B);

    await resolveInReactAct(() => harness.hook().loadPreview(SESSION_A));
    expect(harness.hook().preview?.sessionId).toBe(SESSION_A);
    expect(harness.gateway.previewExternalSession).toHaveBeenCalledTimes(2);

    harness.unmount();
  });

  it("ignores a preview request for an unlisted or malformed session id", async () => {
    const harness = renderExternalSessions();
    await resolveInReactAct(() => harness.hook().open(TARGET));

    await resolveInReactAct(() => harness.hook().loadPreview(SESSION_B));
    await resolveInReactAct(() => harness.hook().loadPreview("not-a-session"));

    expect(harness.gateway.previewExternalSession).not.toHaveBeenCalled();
    expect(harness.hook().preview).toBeNull();

    harness.unmount();
  });

  it("evicts the oldest preview beyond the cache bound", async () => {
    const sessionIds = Array.from({ length: MAX_EXTERNAL_SESSION_PREVIEW_CACHE + 1 }, (_, index) =>
      SESSION_A.replace(/.{4}$/, String(index + 1_000).padStart(4, "0")),
    );
    const harness = renderExternalSessions();
    harness.listResults.push(() =>
      Promise.resolve(snapshot(sessionIds.map((sessionId) => summary({ sessionId })))),
    );
    await resolveInReactAct(() => harness.hook().open(TARGET));

    for (const sessionId of sessionIds) {
      await resolveInReactAct(() => harness.hook().loadPreview(sessionId));
    }
    expect(harness.gateway.previewExternalSession).toHaveBeenCalledTimes(sessionIds.length);

    const evicted = sessionIds[0] as string;
    await resolveInReactAct(() => harness.hook().loadPreview(evicted));

    expect(harness.gateway.previewExternalSession).toHaveBeenCalledTimes(sessionIds.length + 1);
    expect(harness.hook().preview?.sessionId).toBe(evicted);

    harness.unmount();
  });

  it("keys the preview cache by provider and session id", async () => {
    const harness = renderExternalSessions();
    await resolveInReactAct(() => harness.hook().open(TARGET));
    await resolveInReactAct(() => harness.hook().loadPreview(SESSION_A));

    expect(harness.gateway.previewExternalSession).toHaveBeenCalledTimes(1);
    expect(harness.gateway.previewExternalSession).toHaveBeenLastCalledWith({
      provider: "claudeCode",
      sessionId: SESSION_A,
      repositoryRoot: REPOSITORY_ROOT,
    });
    expect(harness.hook().preview?.sessionId).toBe(SESSION_A);

    harness.listResults.push(() =>
      Promise.resolve(snapshot([summary({ provider: "codex", sessionId: SESSION_A })])),
    );
    await resolveInReactAct(() => harness.hook().reload());
    expect(harness.hook().preview).toBeNull();

    await resolveInReactAct(() => harness.hook().loadPreview(SESSION_A));

    expect(harness.gateway.previewExternalSession).toHaveBeenCalledTimes(2);
    expect(harness.gateway.previewExternalSession).toHaveBeenLastCalledWith({
      provider: "codex",
      sessionId: SESSION_A,
      repositoryRoot: REPOSITORY_ROOT,
    });

    harness.unmount();
  });

  it("reports a preview failure without clobbering the loaded list", async () => {
    const harness = renderExternalSessions();
    harness.previewResults.set(SESSION_A, () => Promise.reject(new Error("unreadable")));
    await resolveInReactAct(() => harness.hook().open(TARGET));

    await resolveInReactAct(() => harness.hook().loadPreview(SESSION_A));

    expect(harness.hook().state).toBe("ready");
    expect(harness.hook().sessions).toHaveLength(1);
    expect(harness.hook().preview).toBeNull();
    expect(harness.hook().previewPending).toBe(false);
    expect(harness.setNotice).toHaveBeenCalledWith({
      kind: "warning",
      message: EXTERNAL_SESSION_PREVIEW_FAILED_NOTICE,
      action: null,
    });

    harness.unmount();
  });

  it("clears the list and preview on close", async () => {
    const harness = renderExternalSessions();
    await resolveInReactAct(() => harness.hook().open(TARGET));
    await resolveInReactAct(() => harness.hook().loadPreview(SESSION_A));

    await act(async () => harness.hook().close());

    expect(harness.hook().state).toBe("closed");
    expect(harness.hook().target).toBeNull();
    expect(harness.hook().sessions).toEqual([]);
    expect(harness.hook().preview).toBeNull();

    await resolveInReactAct(() => harness.hook().reload());
    expect(harness.gateway.listExternalSessions).toHaveBeenCalledTimes(1);

    harness.unmount();
  });

  it("publishes nothing after unmount", async () => {
    const harness = renderExternalSessions();
    const pending = deferred<ExternalSessionListSnapshot>();
    harness.listResults.push(() => pending.promise);

    let opened!: Promise<void>;
    await act(async () => {
      opened = harness.hook().open(TARGET);
    });
    harness.unmount();

    pending.resolve(snapshot([summary()]));
    await act(async () => {
      await opened;
    });

    expect(harness.hook().state).toBe("loading");
    expect(harness.hook().sessions).toEqual([]);
  });
});
