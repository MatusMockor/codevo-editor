// @vitest-environment jsdom
import { act, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentThreadsReducer,
  type AgentThread,
  type AgentThreadsAction,
  type AgentThreadsState,
} from "../domain/agentThread";
import type { AgentProjectDescriptor } from "../domain/agentProject";
import type { ExternalAgentSessionHistory } from "../domain/externalAgentSession";
import { surfaceThreadView } from "../components/agentMode/agentSurfaceTestFixtures";
import { projectFixture } from "../components/agentMode/agentThreadsSurfaceTestFixtures";
import { useImportedThreadHistory } from "./useImportedThreadHistory";

const SESSION = "b79ff607-9d00-4290-98db-f12ff5c950ff";
const history: ExternalAgentSessionHistory = {
  provider: "claudeCode",
  sessionId: SESSION,
  exchanges: [
    { role: "user", text: "hello" },
    { role: "assistant", text: "hi" },
  ],
  exchangesTruncated: false,
  totalPreviewBytes: 7,
};
function imported(): AgentThread {
  return {
    ...surfaceThreadView().thread,
    provider: { kind: "claudeCode", sessionId: SESSION },
    externalOrigin: { provider: "claudeCode", sessionId: SESSION, importedAtEpochMs: 1000 },
  };
}
function deferred() {
  let resolve!: (value: ExternalAgentSessionHistory) => void;
  const promise = new Promise<ExternalAgentSessionHistory>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("useImportedThreadHistory", () => {
  let root: Root;
  let host: HTMLDivElement;
  let state: AgentThreadsState;
  let projects: ReadonlyArray<AgentProjectDescriptor>;
  let current: ReturnType<typeof useImportedThreadHistory>;
  let read: ReturnType<typeof vi.fn<(request: unknown) => Promise<ExternalAgentSessionHistory>>>;
  let actions: AgentThreadsAction[];
  const reportError = vi.fn();
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    root = createRoot(host);
    state = { threads: new Map([["agt-1", imported()]]) };
    projects = [projectFixture()];
    actions = [];
    reportError.mockClear();
    read = vi.fn(async () => history);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  function Selection() {
    const ensure = current.ensure;
    useEffect(() => {
      void ensure("agt-1");
    }, [ensure]);
    return null;
  }
  function Harness({ select = false }: { select?: boolean }) {
    current = useImportedThreadHistory({
      projects,
      threads: state.threads,
      gateway: {
        listExternalSessions: vi.fn(),
        previewExternalSession: vi.fn(),
        readExternalSessionHistory: read,
      },
      currentState: () => state,
      dispatchAction: (action) => {
        actions.push(action);
        state = agentThreadsReducer(state, action);
      },
      reportError,
    });
    return select ? <Selection /> : null;
  }
  function render() {
    act(() => root.render(<Harness />));
  }

  it("hydrates a restored selection triggered by a child effect in StrictMode", async () => {
    await act(async () =>
      root.render(
        <StrictMode>
          <Harness select />
        </StrictMode>,
      ),
    );
    expect(read).toHaveBeenCalledTimes(1);
    expect(state.threads.get("agt-1")?.externalOrigin?.history).toEqual(history);
    expect(current.states.get("agt-1")).toBe("ready");
  });

  it("hydrates an existing imported root session with nested repos and keeps it across reload", async () => {
    projects = [projectFixture({ repositories: [projectFixture().repositories[1]!] })];
    render();
    await act(async () => current.ensure("agt-1"));
    expect(read).toHaveBeenCalledExactlyOnceWith({
      provider: "claudeCode",
      sessionId: SESSION,
      projectRoot: "/workspace/app",
      repositoryRoot: "/workspace/app",
      beforeEpochMs: 1000,
    });
    expect(state.threads.get("agt-1")?.externalOrigin?.history).toEqual(history);
    render();
    await act(async () => current.load("agt-1"));
    expect(read).toHaveBeenCalledTimes(1);
    expect(actions).toHaveLength(1);
  });

  it("deduplicates concurrent loads and retains newer thread changes", async () => {
    const pending = deferred();
    read.mockReturnValue(pending.promise);
    render();
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = current.ensure("agt-1");
      second = current.ensure("agt-1");
    });
    expect(first).toBe(second);
    const previous = state.threads.get("agt-1")!;
    state = { threads: new Map([["agt-1", { ...previous, title: "New title" }]]) };
    await act(async () => {
      pending.resolve(history);
      await first;
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(state.threads.get("agt-1")?.title).toBe("New title");
    expect(state.threads.get("agt-1")?.externalOrigin?.history).toEqual(history);
  });

  it("drops late results after project A to B to A even with reused identities", async () => {
    const pending = deferred();
    read.mockReturnValue(pending.promise);
    render();
    let load!: Promise<void>;
    await act(async () => {
      load = current.ensure("agt-1");
      await Promise.resolve();
    });
    projects = [];
    render();
    projects = [projectFixture()];
    render();
    await act(async () => {
      pending.resolve(history);
      await load;
    });
    expect(actions).toHaveLength(0);
  });

  it("rejects foreign snapshots and retries only on request", async () => {
    read.mockResolvedValueOnce({ ...history, sessionId: "11111111-1111-4111-8111-111111111111" });
    render();
    await act(async () => current.ensure("agt-1"));
    expect(actions).toHaveLength(0);
    expect(current.states.get("agt-1")).toBe("failed");
    await act(async () => current.ensure("agt-1"));
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => current.load("agt-1"));
    expect(read).toHaveBeenCalledTimes(2);
    expect(actions).toHaveLength(1);
  });

  it("rejects reads from untrusted projects and refuses deleted-thread late responses", async () => {
    projects = [projectFixture({ trust: "untrusted" })];
    render();
    await act(async () => current.ensure("agt-1"));
    expect(read).not.toHaveBeenCalled();
    projects = [projectFixture()];
    render();
    const pending = deferred();
    read.mockReturnValue(pending.promise);
    let load!: Promise<void>;
    await act(async () => {
      load = current.ensure("agt-1");
      await Promise.resolve();
    });
    state = { threads: new Map() };
    render();
    await act(async () => {
      pending.resolve(history);
      await load;
    });
    expect(actions).toHaveLength(0);
  });
});
