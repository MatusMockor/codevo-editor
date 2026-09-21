// @vitest-environment jsdom

import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { remoteAgentProjectKey } from "../../application/remoteAgentProjection";
import type { AgentComposerProjectOption } from "./agentComposerTarget";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import { useAgentComposerRecovery, type AgentComposerRecovery } from "./useAgentComposerRecovery";

const PROJECT_KEY = remoteAgentProjectKey("server", "runner", "project");
const PROJECT: AgentComposerProjectOption = {
  projectRootKey: PROJECT_KEY,
  ownerId: PROJECT_KEY,
  rootPath: PROJECT_KEY,
  generation: 1,
  origin: "background-tab",
  label: "Remote project",
  repositories: [{ repositoryRoot: PROJECT_KEY, label: "Remote checkout" }],
};

function recoverable(): AgentThreadView {
  const base = surfaceThreadView();
  return {
    ...base,
    lifecycle: "settled",
    thread: {
      ...base.thread,
      owner: { rootKey: PROJECT_KEY, ownerId: PROJECT_KEY, repositoryRoot: PROJECT_KEY },
      provider: { kind: "codex", sessionId: null },
      turns: [
        {
          turnId: "task",
          prompt: "Original request",
          status: { kind: "stopped" },
          startedAtEpochMs: 1,
          endedAtEpochMs: 2,
          events: [],
          eventsTruncated: false,
          lastStatusSequence: 0,
          lastOutputSequence: 0,
          launch: null,
          cliVersion: null,
        },
      ],
    },
    execution: {
      kind: "remote",
      serverId: "server",
      runnerId: "runner",
      projectId: "project",
      conversationId: "conversation",
      latestTaskId: "task",
      pendingMessages: false,
      resume: { available: false, reason: "session_unavailable" },
    },
  };
}

describe("useAgentComposerRecovery", () => {
  let host: HTMLDivElement;
  let root: Root;
  let mounted: boolean;
  let captured: AgentComposerRecovery | null;
  const startNewThread = vi.fn();
  const selectEnvironment = vi.fn();

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    mounted = true;
    captured = null;
    startNewThread.mockReset();
    selectEnvironment.mockReset();
  });
  afterEach(() => {
    if (mounted) act(() => root.unmount());
    host.remove();
  });

  function Harness(props: {
    selectedThread: AgentThreadView | null;
    projects: readonly AgentComposerProjectOption[];
  }) {
    captured = useAgentComposerRecovery({ ...props, startNewThread, selectEnvironment });
    return null;
  }
  function render(
    selectedThread: AgentThreadView | null = recoverable(),
    projects: readonly AgentComposerProjectOption[] = [PROJECT],
  ) {
    act(() =>
      root.render(
        <StrictMode>
          <Harness selectedThread={selectedThread} projects={projects} />
        </StrictMode>,
      ),
    );
  }
  function recovery(): AgentComposerRecovery {
    expect(captured).not.toBeNull();
    return captured!;
  }

  it("recovers only once into the exact remote project and environment", () => {
    render();
    const action = recovery();
    expect(action.draftKey).toEqual(expect.any(String));
    act(() => expect(action.activate()).toBe(true));
    expect(selectEnvironment).toHaveBeenCalledExactlyOnceWith(PROJECT_KEY);
    expect(startNewThread).toHaveBeenCalledExactlyOnceWith(PROJECT_KEY, PROJECT_KEY);
    act(() => expect(action.activate()).toBe(false));
    expect(startNewThread).toHaveBeenCalledTimes(1);
  });

  it.each(["newer_turn_exists", "task_not_finished"] as const)(
    "does not offer recovery for %s",
    (reason) => {
      const view = recoverable();
      render({ ...view, execution: { ...view.execution!, resume: { available: false, reason } } });
      expect(captured).toBeNull();
    },
  );

  it.each([{ kind: "failed", message: "Provider failed" }, { kind: "interrupted" }] as const)(
    "does not recover a $kind turn with an unavailable session",
    (status) => {
      const view = recoverable();
      render({
        ...view,
        thread: {
          ...view.thread,
          turns: view.thread.turns.map((turn) => ({ ...turn, status })),
        },
      });
      expect(captured).toBeNull();
    },
  );

  it("does not offer recovery for a resumable, running, local, or missing thread", () => {
    const view = recoverable();
    render({
      ...view,
      execution: { ...view.execution!, resume: { available: true, reason: null } },
    });
    expect(captured).toBeNull();
    render({ ...view, lifecycle: "running" });
    expect(captured).toBeNull();
    render({ ...view, execution: undefined });
    expect(captured).toBeNull();
    render(null);
    expect(captured).toBeNull();
  });

  it("requires matching project owner, repository, and latest task", () => {
    const view = recoverable();
    render(view, []);
    expect(captured).toBeNull();
    render(view, [{ ...PROJECT, ownerId: "foreign-owner" }]);
    expect(captured).toBeNull();
    render({
      ...view,
      thread: { ...view.thread, owner: { ...view.thread.owner, repositoryRoot: "foreign" } },
    });
    expect(captured).toBeNull();
    render({ ...view, execution: { ...view.execution!, latestTaskId: "other-task" } });
    expect(captured).toBeNull();
  });

  it("rejects the old callback after A to B to A selection", () => {
    const view = recoverable();
    render(view);
    const stale = recovery();
    render(null);
    render(view);
    act(() => expect(stale.activate()).toBe(false));
    expect(startNewThread).not.toHaveBeenCalled();
    act(() => expect(recovery().activate()).toBe(true));
  });

  it("rejects an old project generation even after returning to that generation", () => {
    render();
    const stale = recovery();
    render(recoverable(), [{ ...PROJECT, generation: 2 }]);
    render();
    act(() => expect(stale.activate()).toBe(false));
    expect(startNewThread).not.toHaveBeenCalled();
    expect(selectEnvironment).not.toHaveBeenCalled();
  });

  it("rejects activation after unmount", () => {
    render();
    const stale = recovery();
    act(() => root.unmount());
    mounted = false;
    expect(stale.activate()).toBe(false);
    expect(startNewThread).not.toHaveBeenCalled();
    expect(selectEnvironment).not.toHaveBeenCalled();
  });
});
