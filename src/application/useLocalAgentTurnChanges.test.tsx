// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { AgentThread, AgentTurn } from "../domain/agentThread";
import { agentRootOwnerId, type AgentProjectDescriptor } from "../domain/agentProject";
import type { AgentTurnChangeSummary, AgentTurnChangesGateway } from "../domain/agentTurnChanges";
import {
  useLocalAgentTurnChanges,
  type LocalAgentTurnChangesDependencies,
} from "./useLocalAgentTurnChanges";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const project: AgentProjectDescriptor = {
  rootKey: "/repo",
  rootPath: "/repo",
  ownerId: "owner",
  label: "Repo",
  generation: 1,
  trust: "trusted",
  origin: "active-tab",
  repositories: [],
  isolationPolicy: "auto",
  leaseToken: null,
};
const turn: AgentTurn = {
  turnId: "old",
  prompt: "change",
  status: { kind: "exited", exitCode: 0 },
  startedAtEpochMs: 1,
  endedAtEpochMs: 2,
  events: [],
  eventsTruncated: false,
  lastStatusSequence: 1,
  lastOutputSequence: 0,
  launch: null,
  cliVersion: null,
};
const thread: AgentThread = {
  threadId: "thread",
  owner: { rootKey: "/repo", ownerId: "owner", repositoryRoot: "/repo" },
  target: { isolation: "worktree", worktreePath: "/worktrees/one" },
  provider: { kind: "codex", sessionId: null },
  title: "Title",
  pinned: false,
  archived: false,
  createdAtEpochMs: 1,
  updatedAtEpochMs: 2,
  turns: [turn],
  turnsTruncated: false,
  viewedAtEpochMs: null,
  externalOrigin: null,
  integration: null,
};
const summary: AgentTurnChangeSummary = {
  turnId: "old",
  state: "ready",
  files: [],
  truncated: false,
  reason: null,
};
const notes: AgentTurnChangeSummary = {
  ...summary,
  files: [
    {
      relativePath: "notes.md",
      oldRelativePath: null,
      status: "added",
      addedLines: 1,
      deletedLines: 0,
    },
  ],
};
const gitProject: AgentProjectDescriptor = {
  ...project,
  ownerId: "workspace-1",
  runtimeOwnerIds: ["workspace-1"],
  repositories: [
    {
      mapping: { rootRelativePath: "" },
      repositoryRoot: "/repo",
      repositoryRelativePath: "",
    },
  ],
};
const rootOwnedThread: AgentThread = {
  ...thread,
  owner: { rootKey: "/repo", ownerId: agentRootOwnerId("/repo"), repositoryRoot: "/repo" },
  target: { isolation: "in-place", worktreePath: null },
};
const deniedDeps = (
  projectValue: AgentProjectDescriptor,
  threadValue: AgentThread,
  port: AgentTurnChangesGateway | null,
): LocalAgentTurnChangesDependencies => ({
  gateway: port,
  projects: [projectValue],
  threads: new Map([[threadValue.threadId, threadValue]]),
  historyPage: null,
});
function gateway(): AgentTurnChangesGateway {
  return {
    getSummary: vi.fn(async () => summary),
    getFileDiff: vi.fn(async () => {
      throw Error("not requested");
    }),
  };
}
function harness(initial: LocalAgentTurnChangesDependencies) {
  const host = document.createElement("div");
  const root = createRoot(host);
  let surface!: ReturnType<typeof useLocalAgentTurnChanges>;
  function Probe({ value }: { value: LocalAgentTurnChangesDependencies }) {
    surface = useLocalAgentTurnChanges(value);
    return null;
  }
  const render = (value: LocalAgentTurnChangesDependencies) =>
    act(() => root.render(<Probe value={value} />));
  render(initial);
  return {
    get surface() {
      return surface;
    },
    render,
    close: () => act(() => root.unmount()),
  };
}
describe("local recorded turn changes authority", () => {
  it("routes recorded historical pages to the exact worktree and rejects foreign/running turns", async () => {
    const port = gateway();
    const deps = {
      gateway: port,
      projects: [project],
      threads: new Map([[thread.threadId, { ...thread, turns: [] }]]),
      historyPage: {
        threadId: "thread",
        turns: [turn],
        hasEarlier: false,
        loading: false,
        error: null,
      },
    };
    const h = harness(deps);
    try {
      expect((await h.surface.getTurnChanges("thread", "old")).state).toBe("ready");
      expect(port.getSummary).toHaveBeenCalledExactlyOnceWith("/worktrees/one", "old");
      expect((await h.surface.getTurnChanges("thread", "other")).state).toBe("unsupported");
      expect((await h.surface.getTurnChanges("foreign", "old")).state).toBe("unsupported");
      h.render({
        ...deps,
        historyPage: null,
        threads: new Map([
          [thread.threadId, { ...thread, turns: [{ ...turn, status: { kind: "running" } }] }],
        ]),
      });
      expect((await h.surface.getTurnChanges("thread", "old")).state).toBe("unsupported");
      expect(port.getSummary).toHaveBeenCalledTimes(1);
    } finally {
      h.close();
    }
  });
  it("rejects a late result after project A-B-A and gateway replacement", async () => {
    let finish!: (value: AgentTurnChangeSummary) => void;
    const port = {
      ...gateway(),
      getSummary: vi.fn(
        () =>
          new Promise<AgentTurnChangeSummary>((resolve) => {
            finish = resolve;
          }),
      ),
    };
    const deps = {
      gateway: port,
      projects: [project],
      threads: new Map([[thread.threadId, thread]]),
      historyPage: null,
    };
    const h = harness(deps);
    try {
      const pending = h.surface.getTurnChanges("thread", "old");
      await vi.waitFor(() => expect(port.getSummary).toHaveBeenCalledTimes(1));
      h.render({ ...deps, projects: [] });
      h.render(deps);
      finish(summary);
      expect((await pending).state).toBe("unsupported");
      const again = h.surface.getTurnChanges("thread", "old");
      await vi.waitFor(() => expect(port.getSummary).toHaveBeenCalledTimes(2));
      h.render({ ...deps, gateway: gateway() });
      finish(summary);
      expect((await again).state).toBe("unsupported");
    } finally {
      h.close();
    }
  });
  it("invalidates displayed results on trust revocation and A-B-A without churn on equivalent inventory", async () => {
    const port = gateway();
    const deps = {
      gateway: port,
      projects: [project],
      threads: new Map([[thread.threadId, thread]]),
      historyPage: null,
    };
    const h = harness(deps);
    try {
      await h.surface.getTurnChanges("thread", "old");
      const initial = h.surface.turnChangesRevision;
      h.render({ ...deps, projects: [{ ...project }] });
      expect(h.surface.turnChangesRevision).toBe(initial);
      h.render({ ...deps, projects: [{ ...project, trust: "untrusted" }] });
      const revoked = h.surface.turnChangesRevision;
      expect(revoked).not.toBe(initial);
      h.render(deps);
      expect(h.surface.turnChangesRevision).not.toBe(initial);
      expect(h.surface.turnChangesRevision).not.toBe(revoked);
    } finally {
      h.close();
    }
  });
  it("ignores project ordering but invalidates replaced native project leases", async () => {
    const port = gateway();
    const first = { ...project, leaseToken: 1, runtimeOwnerIds: ["a", "b"] };
    const second = { ...project, rootKey: "/other", rootPath: "/other", ownerId: "other" };
    const deps = {
      gateway: port,
      projects: [first, second],
      threads: new Map([[thread.threadId, thread]]),
      historyPage: null,
    };
    const h = harness(deps);
    try {
      await h.surface.getTurnChanges("thread", "old");
      const initial = h.surface.turnChangesRevision;
      h.render({ ...deps, projects: [second, { ...first, runtimeOwnerIds: ["b", "a"] }] });
      expect(h.surface.turnChangesRevision).toBe(initial);
      h.render({ ...deps, projects: [{ ...first, leaseToken: null }, second] });
      expect(h.surface.turnChangesRevision).not.toBe(initial);
      await h.surface.getTurnChanges("thread", "old");
      expect(port.getSummary).toHaveBeenCalledTimes(2);
    } finally {
      h.close();
    }
  });
  it("keeps a thread display stable when another project or thread changes and revokes its own authority", () => {
    const other = { ...project, rootKey: "/other", rootPath: "/other", ownerId: "other" };
    const deps = {
      gateway: gateway(),
      projects: [project, other],
      threads: new Map([[thread.threadId, thread]]),
      historyPage: null,
    };
    const h = harness(deps);
    try {
      const initial = h.surface.getTurnChangesRevision("thread");
      h.render({
        ...deps,
        projects: [project, { ...other, trust: "untrusted" }],
        threads: new Map([
          [thread.threadId, thread],
          ["other", { ...thread, threadId: "other", turns: [{ ...turn, turnId: "new" }] }],
        ]),
      });
      expect(h.surface.getTurnChangesRevision("thread")).toBe(initial);
      h.render({ ...deps, projects: [{ ...project, trust: "untrusted" }, other] });
      h.render(deps);
      expect(h.surface.getTurnChangesRevision("thread")).not.toBe(initial);
      const restored = h.surface.getTurnChangesRevision("thread");
      h.render({ ...deps, threads: new Map() });
      expect(h.surface.getTurnChangesRevision("thread")).not.toBe(restored);
    } finally {
      h.close();
    }
  });
  it("reads a finished in-place turn whose thread kept the agent-root owner after the workspace id replaced it", async () => {
    const port = { ...gateway(), getSummary: vi.fn(async () => notes) };
    const h = harness({
      gateway: port,
      projects: [gitProject],
      threads: new Map([[rootOwnedThread.threadId, rootOwnedThread]]),
      historyPage: null,
    });
    try {
      const result = await h.surface.getTurnChanges("thread", "old");
      expect(port.getSummary).toHaveBeenCalledExactlyOnceWith("/repo", "old");
      expect(result.state).toBe("ready");
      expect(result.files.map((file) => file.relativePath)).toEqual(["notes.md"]);
    } finally {
      h.close();
    }
  });
  it.each([
    [
      "a foreign workspace owner",
      gitProject,
      { ...rootOwnedThread, owner: { ...rootOwnedThread.owner, ownerId: "workspace-2" } },
      "Recorded changes belong to a project session that is no longer open.",
    ],
    [
      "an agent-root owner derived from a different root",
      gitProject,
      {
        ...rootOwnedThread,
        owner: { ...rootOwnedThread.owner, ownerId: agentRootOwnerId("/other") },
      },
      "Recorded changes belong to a project session that is no longer open.",
    ],
    [
      "an untrusted git project",
      { ...gitProject, trust: "untrusted" as const },
      rootOwnedThread,
      "Trust this project to view recorded changes.",
    ],
    [
      "a launch root outside the project repositories",
      gitProject,
      { ...rootOwnedThread, owner: { ...rootOwnedThread.owner, repositoryRoot: "/elsewhere" } },
      "Recorded changes are outside this project's repositories.",
    ],
  ])("reports %s as a muted unavailable line without reading", async (_, p, t, reason) => {
    const port = gateway();
    const h = harness(deniedDeps(p, t, port));
    try {
      const result = await h.surface.getTurnChanges("thread", "old");
      expect(result).toEqual({
        turnId: "old",
        state: "unavailable",
        files: [],
        truncated: false,
        reason,
      });
      expect(port.getSummary).not.toHaveBeenCalled();
    } finally {
      h.close();
    }
  });
  it("reports a missing gateway in a git project and hides non-git or unfinished turns", async () => {
    const missing = harness(deniedDeps(gitProject, rootOwnedThread, null));
    try {
      expect((await missing.surface.getTurnChanges("thread", "old")).reason).toBe(
        "Recorded changes cannot be read in this session.",
      );
    } finally {
      missing.close();
    }
    const port = gateway();
    const running = {
      ...rootOwnedThread,
      turns: [{ ...turn, status: { kind: "running" as const } }],
    };
    const h = harness(deniedDeps({ ...gitProject, trust: "untrusted" }, running, port));
    try {
      expect((await h.surface.getTurnChanges("thread", "old")).state).toBe("unsupported");
      expect((await h.surface.getTurnChanges("missing", "old")).state).toBe("unsupported");
      h.render(
        deniedDeps({ ...gitProject, repositories: [], trust: "untrusted" }, rootOwnedThread, port),
      );
      expect((await h.surface.getTurnChanges("thread", "old")).state).toBe("unsupported");
      expect(port.getSummary).not.toHaveBeenCalled();
    } finally {
      h.close();
    }
  });
  it("revokes an agent-root thread read across project A-B-A and never reads the replaced owner", async () => {
    let finish!: (value: AgentTurnChangeSummary) => void;
    const port = {
      ...gateway(),
      getSummary: vi.fn(
        () =>
          new Promise<AgentTurnChangeSummary>((resolve) => {
            finish = resolve;
          }),
      ),
    };
    const deps = deniedDeps(gitProject, rootOwnedThread, port);
    const h = harness(deps);
    try {
      const pending = h.surface.getTurnChanges("thread", "old");
      await vi.waitFor(() => expect(port.getSummary).toHaveBeenCalledTimes(1));
      const other = {
        ...gitProject,
        rootKey: "/other",
        rootPath: "/other",
        ownerId: "workspace-2",
      };
      h.render({ ...deps, projects: [other] });
      expect((await h.surface.getTurnChanges("thread", "old")).state).toBe("unsupported");
      h.render({ ...deps, projects: [{ ...gitProject, generation: 2 }] });
      finish(notes);
      expect((await pending).state).toBe("unsupported");
      const again = h.surface.getTurnChanges("thread", "old");
      await vi.waitFor(() => expect(port.getSummary).toHaveBeenCalledTimes(2));
      finish(notes);
      expect((await again).files.map((file) => file.relativePath)).toEqual(["notes.md"]);
    } finally {
      h.close();
    }
  });
  it("never reads an untrusted or foreign project owner", async () => {
    const port = gateway();
    const deps = {
      gateway: port,
      projects: [{ ...project, trust: "untrusted" as const }],
      threads: new Map([[thread.threadId, thread]]),
      historyPage: null,
    };
    const h = harness(deps);
    try {
      expect((await h.surface.getTurnChanges("thread", "old")).state).toBe("unsupported");
      expect(port.getSummary).not.toHaveBeenCalled();
    } finally {
      h.close();
    }
  });
});

it("retains authority for a full burst of completed turns while reads queue", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const port = {
    ...gateway(),
    getSummary: vi.fn(async (_root: string, turnId: string) => {
      await gate;
      return { ...summary, turnId };
    }),
  };
  const turns = Array.from({ length: 100 }, (_, i) => ({ ...turn, turnId: String(i) }));
  const h = harness({
    gateway: port,
    projects: [project],
    threads: new Map([[thread.threadId, { ...thread, turns }]]),
    historyPage: null,
  });
  try {
    const jobs = turns.map((value) => h.surface.getTurnChanges("thread", value.turnId));
    await vi.waitFor(() => expect(port.getSummary).toHaveBeenCalledTimes(4));
    release();
    expect((await Promise.all(jobs)).every((value) => value.state === "ready")).toBe(true);
    expect(port.getSummary).toHaveBeenCalledTimes(100);
  } finally {
    release();
    h.close();
  }
});
it("settles queued work on unmount before active backend work finishes", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const port = {
    ...gateway(),
    getSummary: vi.fn(async (_root: string, turnId: string) => {
      await gate;
      return { ...summary, turnId };
    }),
  };
  const turns = Array.from({ length: 8 }, (_, i) => ({ ...turn, turnId: String(i) }));
  const h = harness({
    gateway: port,
    projects: [project],
    threads: new Map([[thread.threadId, { ...thread, turns }]]),
    historyPage: null,
  });
  const jobs = turns.map((value) => h.surface.getTurnChanges("thread", value.turnId));
  await vi.waitFor(() => expect(port.getSummary).toHaveBeenCalledTimes(4));
  h.close();
  expect((await Promise.all(jobs.slice(4))).every((value) => value.state === "unsupported")).toBe(
    true,
  );
  release();
  expect((await Promise.all(jobs)).every((value) => value.state === "unsupported")).toBe(true);
  expect(port.getSummary).toHaveBeenCalledTimes(4);
});
