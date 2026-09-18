import { describe, expect, it, vi } from "vitest";
import type { AgentProjectDescriptor } from "../domain/agentProject";
import type { AgentLaunchOptions } from "../domain/agentLaunch";
import { MAX_AGENT_STEERS_PER_TURN } from "../domain/agentTask";
import {
  MAX_AGENT_EVENTS_PER_TURN,
  MAX_AGENT_EVENT_BYTES_PER_TURN,
  type AgentThread,
  type AgentThreadsState,
  type AgentTurn,
  type AgentTurnEvent,
} from "../domain/agentThread";
import {
  AGENT_THREAD_RUNNING_NOTICE,
  AGENT_THREAD_STARTING_NOTICE,
  AGENT_THREAD_STEER_LIMIT_NOTICE,
  admitSteer,
  agentThreadIsSteerable,
  type AgentTurnAdmissionDependencies,
} from "./agentTurnAdmission";
import type { AgentSteerRequest, AgentTasksNotice } from "./agentThreadPorts";

const CLAUDE_LAUNCH: AgentLaunchOptions = {
  provider: "claudeCode",
  model: "sonnet",
  mode: "default",
  effort: "default",
};
const CODEX_LAUNCH: AgentLaunchOptions = { provider: "codex", model: "default", mode: "default" };

const OWNER = { rootKey: "/workspace", ownerId: "ws-1", repositoryRoot: "/repo" } as const;

function turn(overrides: Partial<AgentTurn> = {}): AgentTurn {
  return {
    turnId: "agt-1-0a1b",
    prompt: "do the thing",
    status: { kind: "running" },
    startedAtEpochMs: 1_000,
    endedAtEpochMs: null,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 1,
    lastOutputSequence: 1,
    streamMetrics: null,
    launch: CLAUDE_LAUNCH,
    cliVersion: null,
    ...overrides,
  };
}

function thread(overrides: Partial<AgentThread> = {}): AgentThread {
  return {
    threadId: "agt-t1-0001",
    owner: OWNER,
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: null },
    title: "do the thing",
    pinned: false,
    archived: false,
    createdAtEpochMs: 1_000,
    updatedAtEpochMs: 1_000,
    turns: [turn()],
    turnsTruncated: false,
    viewedAtEpochMs: null,
    externalOrigin: null,
    integration: null,
    ...overrides,
  };
}

function project(overrides: Partial<AgentProjectDescriptor> = {}): AgentProjectDescriptor {
  return {
    rootKey: "/workspace",
    rootPath: "/workspace",
    ownerId: "ws-1",
    label: "workspace",
    generation: 3,
    trust: "trusted",
    origin: "active-tab",
    repositories: [
      { repositoryRoot: "/repo", repositoryRelativePath: "", mapping: { rootRelativePath: "" } },
    ],
    isolationPolicy: "auto",
    leaseToken: null,
    ...overrides,
  };
}

function stateWith(target: AgentThread): AgentThreadsState {
  return { threads: new Map([[target.threadId, target]]) };
}

interface Harness {
  readonly deps: AgentTurnAdmissionDependencies;
  readonly notices: Array<AgentTasksNotice | null>;
}

function harness(
  target: AgentThread,
  projects = [project()],
  launchIdentity: { readonly workspaceId: string; readonly generation: number } | null = {
    workspaceId: "ws-1",
    generation: 3,
  },
): Harness {
  const notices: Array<AgentTasksNotice | null> = [];
  const state = stateWith(target);
  const deps: AgentTurnAdmissionDependencies = {
    projects,
    store: {
      state,
      loadedRootKeys: new Set(),
      currentState: () => state,
      dispatchAction: vi.fn(),
      togglePin: vi.fn(),
      archive: vi.fn(),
      remove: vi.fn(),
      markUnread: vi.fn(),
      rename: vi.fn(),
    },
    getAgentCliKind: () => "claudeCode",
    getAgentProviderAdmissionAuthority: (provider) => ({
      provider,
      revision: 1,
      disposition: { kind: "ready" },
      providerGeneration: 1,
    }),
    getMaxConcurrentAgentTasks: () => 4,
    isWorktreeMissing: () => false,
    launchIdentityForProject: () => launchIdentity,
    reportError: vi.fn(),
    setNotice: (notice) => notices.push(notice),
  };
  return { deps, notices };
}

function steerRequest(overrides: Partial<AgentSteerRequest> = {}): AgentSteerRequest {
  return { threadId: "agt-t1-0001", prompt: "also run the tests", ...overrides };
}

function userMessages(count: number): ReadonlyArray<AgentTurnEvent> {
  return Array.from({ length: count }, (_, index) => ({
    kind: "userMessage" as const,
    text: `steer ${index}`,
  }));
}

describe("agentThreadIsSteerable", () => {
  it("admits only a running local claude turn", () => {
    expect(agentThreadIsSteerable(thread())).toBe(true);
    expect(agentThreadIsSteerable(thread({ turns: [turn({ launch: CODEX_LAUNCH })] }))).toBe(false);
    expect(agentThreadIsSteerable(thread({ turns: [turn({ launch: null })] }))).toBe(false);
    expect(
      agentThreadIsSteerable(
        thread({ turns: [turn({ status: { kind: "exited", exitCode: 0 }, endedAtEpochMs: 2 })] }),
      ),
    ).toBe(false);
    expect(
      agentThreadIsSteerable(thread({ threadId: "remote-thread:server:runner:conversation" })),
    ).toBe(false);
  });
});

describe("admitSteer", () => {
  it("admits a running local claude turn and returns the captured authority", () => {
    const running = thread();
    const { deps, notices } = harness(running);

    const admitted = admitSteer(deps, steerRequest(), new Set());

    expect(admitted).not.toBeNull();
    expect(admitted?.thread.threadId).toBe("agt-t1-0001");
    expect(admitted?.turn.turnId).toBe("agt-1-0a1b");
    expect(admitted?.prompt).toBe("also run the tests");
    expect(admitted?.authority).toEqual({
      rootKey: "/workspace",
      ownerId: "ws-1",
      generation: 3,
      workspaceId: "ws-1",
      workspaceGeneration: 3,
    });
    expect(notices).toEqual([]);
  });

  it("refuses a codex turn and a server thread with the running notice", () => {
    for (const target of [
      thread({ turns: [turn({ launch: CODEX_LAUNCH })] }),
      thread({ threadId: "remote-thread:s:r:c" }),
    ]) {
      const { deps, notices } = harness(target);

      expect(admitSteer(deps, steerRequest({ threadId: target.threadId }), new Set())).toBeNull();
      expect(notices[notices.length - 1]?.message).toBe(AGENT_THREAD_RUNNING_NOTICE);
    }
  });

  it("refuses an unknown, archived, settled, or already-steering thread", () => {
    const settled = thread({
      turns: [turn({ status: { kind: "exited", exitCode: 0 }, endedAtEpochMs: 2_000 })],
    });
    const cases: ReadonlyArray<{ target: AgentThread; inFlight: ReadonlySet<string> }> = [
      { target: thread({ archived: true }), inFlight: new Set() },
      { target: settled, inFlight: new Set() },
      { target: thread(), inFlight: new Set(["agt-t1-0001"]) },
    ];
    for (const { target, inFlight } of cases) {
      const { deps, notices } = harness(target);

      expect(admitSteer(deps, steerRequest(), inFlight)).toBeNull();
      expect(notices).toHaveLength(1);
    }

    const missing = harness(thread());
    expect(
      admitSteer(missing.deps, steerRequest({ threadId: "agt-t9-0009" }), new Set()),
    ).toBeNull();
    expect(missing.notices).toHaveLength(1);
  });

  it("refuses a blank or oversized prompt", () => {
    const { deps, notices } = harness(thread());

    expect(admitSteer(deps, steerRequest({ prompt: "   " }), new Set())).toBeNull();
    expect(admitSteer(deps, steerRequest({ prompt: "x".repeat(32 * 1_024 + 1) }), new Set())).toBe(
      null,
    );
    expect(notices).toHaveLength(2);
  });

  it("refuses a steer once the per-turn bound is reached", () => {
    const filled = thread({
      turns: [turn({ events: userMessages(MAX_AGENT_STEERS_PER_TURN) })],
    });
    const { deps, notices } = harness(filled);

    expect(admitSteer(deps, steerRequest(), new Set())).toBeNull();
    expect(notices[notices.length - 1]?.message).toBe(AGENT_THREAD_STEER_LIMIT_NOTICE);
  });

  it("refuses a thread whose project or launch identity no longer matches the running owner", () => {
    const released = harness(thread(), [project({ origin: "closed-tab-live-tasks" })]);
    expect(admitSteer(released.deps, steerRequest(), new Set())).toBeNull();
    expect(released.notices).toHaveLength(1);

    const rebound = harness(thread(), [project()], { workspaceId: "ws-2", generation: 3 });
    expect(admitSteer(rebound.deps, steerRequest(), new Set())).toBeNull();
    expect(rebound.notices).toHaveLength(1);

    const gone = harness(thread(), []);
    expect(admitSteer(gone.deps, steerRequest(), new Set())).toBeNull();
    expect(gone.notices).toHaveLength(1);
  });

  it("refuses a turn that is still pending in the spawn window", () => {
    const starting = thread({ turns: [turn({ status: { kind: "pending" } })] });
    const { deps, notices } = harness(starting);

    expect(admitSteer(deps, steerRequest(), new Set())).toBeNull();
    expect(notices[notices.length - 1]?.message).toBe(AGENT_THREAD_STARTING_NOTICE);
  });

  it("admits steering when only retained output is full or truncated", () => {
    const full: ReadonlyArray<AgentTurn> = [
      turn({ eventsTruncated: true }),
      turn({
        events: Array.from({ length: MAX_AGENT_EVENTS_PER_TURN }, (_, index) => ({
          kind: "toolCall" as const,
          toolId: `t${index}`,
          name: "Read",
          inputSummary: "file",
        })),
      }),
      turn({
        events: [
          {
            kind: "assistantText",
            text: "x".repeat(MAX_AGENT_EVENT_BYTES_PER_TURN - 4),
          },
        ],
      }),
    ];
    for (const running of full) {
      const { deps, notices } = harness(thread({ turns: [running] }));

      expect(admitSteer(deps, steerRequest({ prompt: "12345" }), new Set())).not.toBeNull();
      expect(notices).toEqual([]);
    }
  });

  it("counts attachment identities against the remaining turn byte budget", () => {
    const running = thread({
      turns: [turn({ events: [{ kind: "assistantText", text: "x".repeat(1_000) }] })],
    });
    const { deps } = harness(running);

    expect(
      admitSteer(
        deps,
        steerRequest({
          prompt: "look",
          attachments: [
            { kind: "reference", name: "clip.mp4", path: "/Movies/clip.mp4", bytes: 0 },
          ],
        }),
        new Set(),
      ),
    ).not.toBeNull();
  });

  it("accepts an empty prompt when the steer carries attachments", () => {
    const { deps } = harness(thread());

    const admitted = admitSteer(
      deps,
      steerRequest({
        prompt: "",
        attachments: [{ kind: "reference", name: "clip.mp4", path: "/Movies/clip.mp4", bytes: 0 }],
      }),
      new Set(),
    );

    expect(admitted?.prompt).toBe("");
  });
});

describe("Codex transport steering admission", () => {
  it.each(["appServer", "exec"] as const)(
    "uses the running turn snapshot for %s",
    (codexTransport) => {
      const target = thread({
        provider: { kind: "codex", sessionId: null },
        turns: [turn({ launch: CODEX_LAUNCH, codexTransport })],
      });
      const { deps } = harness(target);
      expect(agentThreadIsSteerable(target)).toBe(codexTransport === "appServer");
      expect(
        admitSteer(deps, { threadId: target.threadId, prompt: "continue here" }, new Set()) !==
          null,
      ).toBe(codexTransport === "appServer");
    },
  );
});
