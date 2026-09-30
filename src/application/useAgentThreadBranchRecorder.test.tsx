// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SURFACE_FIXTURE_ROOT,
  SURFACE_FIXTURE_WORKTREE,
  surfaceThreadView,
} from "../components/agentMode/agentSurfaceTestFixtures";
import {
  EMPTY_AGENT_THREAD_BRANCH_MEMORY,
  agentThreadBranchOf,
  type AgentThreadBranchIdentity,
  type AgentThreadBranchMemory,
} from "../domain/agentThreadBranchMemory";
import type { AgentThreadBranchMemoryPort } from "./agentThreadBranchMemoryPort";
import type { AgentThreadView } from "./agentThreadPorts";
import { useAgentThreadBranchMemory } from "./useAgentThreadBranchMemory";
import { useAgentThreadBranchRecorder } from "./useAgentThreadBranchRecorder";

const OTHER_ROOT = "/workspace/api";

interface CountingPort extends AgentThreadBranchMemoryPort {
  readonly saved: AgentThreadBranchMemory;
  readonly saves: number;
}

function countingPort(): CountingPort {
  let saved = EMPTY_AGENT_THREAD_BRANCH_MEMORY;
  let saves = 0;
  return {
    get saved() {
      return saved;
    },
    get saves() {
      return saves;
    },
    load: () => saved,
    save: (memory: AgentThreadBranchMemory) => {
      saved = memory;
      saves += 1;
    },
  };
}

function localThread(
  threadId: string,
  lifecycle: AgentThreadView["lifecycle"],
  options: { readonly ownerId?: string; readonly root?: string } = {},
): AgentThreadView {
  const root = options.root ?? SURFACE_FIXTURE_ROOT;
  return surfaceThreadView({
    lifecycle,
    thread: {
      ...surfaceThreadView().thread,
      threadId,
      owner: { rootKey: root, ownerId: options.ownerId ?? "agent-root:app", repositoryRoot: root },
      target: { isolation: "in-place", worktreePath: null },
    },
  });
}

function identity(
  threadId: string,
  ownerId = "agent-root:app",
  root = SURFACE_FIXTURE_ROOT,
): AgentThreadBranchIdentity {
  return { threadId, rootKey: root, ownerId };
}

describe("useAgentThreadBranchRecorder", () => {
  let host: HTMLDivElement;
  let root: Root;
  let port: CountingPort;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    port = countingPort();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function Harness(props: {
    readonly threads: ReadonlyArray<AgentThreadView>;
    readonly live: ReadonlyMap<string, string | null>;
  }) {
    const memory = useAgentThreadBranchMemory(port);
    useAgentThreadBranchRecorder(props.threads, props.live, memory);
    return null;
  }

  function render(
    threads: ReadonlyArray<AgentThreadView>,
    live: ReadonlyMap<string, string | null>,
  ) {
    act(() => root.render(<Harness live={live} threads={threads} />));
  }

  it("records every running local checkout thread, selected or not", () => {
    const live = new Map<string, string | null>([
      [SURFACE_FIXTURE_ROOT, "main"],
      [OTHER_ROOT, "feature/api"],
    ]);
    render(
      [
        localThread("a", "running"),
        localThread("b", "running", { root: OTHER_ROOT }),
        localThread("c", "settled"),
      ],
      live,
    );
    expect(agentThreadBranchOf(port.saved, identity("a"))).toBe("main");
    expect(agentThreadBranchOf(port.saved, identity("b", "agent-root:app", OTHER_ROOT))).toBe(
      "feature/api",
    );
    expect(agentThreadBranchOf(port.saved, identity("c"))).toBeNull();
  });

  it("records the branch observed when a turn settles and nothing after", () => {
    render([localThread("a", "running")], new Map([[SURFACE_FIXTURE_ROOT, null]]));
    expect(agentThreadBranchOf(port.saved, identity("a"))).toBeNull();
    render([localThread("a", "settled")], new Map([[SURFACE_FIXTURE_ROOT, "feature/x"]]));
    expect(agentThreadBranchOf(port.saved, identity("a"))).toBe("feature/x");
    render([localThread("a", "settled")], new Map([[SURFACE_FIXTURE_ROOT, "hotfix"]]));
    expect(agentThreadBranchOf(port.saved, identity("a"))).toBe("feature/x");
  });

  it("never records worktree or server threads", () => {
    const worktree = surfaceThreadView({
      lifecycle: "running",
      thread: {
        ...surfaceThreadView().thread,
        threadId: "wt",
        target: { isolation: "worktree", worktreePath: SURFACE_FIXTURE_WORKTREE },
      },
    });
    const remote = surfaceThreadView({
      lifecycle: "running",
      execution: {
        kind: "remote",
        serverId: "linux",
        runnerId: "runner",
        projectId: "project",
        conversationId: "c-1",
        latestTaskId: "task-1",
        resume: null,
      },
      thread: localThread("remote", "running").thread,
    });
    render([worktree, remote], new Map([[SURFACE_FIXTURE_ROOT, "main"]]));
    expect(port.saved.size).toBe(0);
  });

  it("never carries a running state across owners of the same thread id", () => {
    render(
      [localThread("a", "running", { ownerId: "owner-1" })],
      new Map([[SURFACE_FIXTURE_ROOT, "main"]]),
    );
    render(
      [localThread("a", "settled", { ownerId: "owner-2" })],
      new Map([[SURFACE_FIXTURE_ROOT, "develop"]]),
    );
    expect(agentThreadBranchOf(port.saved, identity("a", "owner-1"))).toBe("main");
    expect(agentThreadBranchOf(port.saved, identity("a", "owner-2"))).toBeNull();
  });

  it("writes storage only when a thread's branch actually changes", () => {
    const live = new Map([[SURFACE_FIXTURE_ROOT, "main"]]);
    const threads = [localThread("a", "running"), localThread("b", "running")];
    render(threads, live);
    const saves = port.saves;
    render([...threads], new Map(live));
    render([...threads], new Map(live));
    expect(port.saves).toBe(saves);
  });
});
