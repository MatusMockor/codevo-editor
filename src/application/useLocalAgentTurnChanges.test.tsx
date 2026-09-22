// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { AgentThread, AgentTurn } from "../domain/agentThread";
import type { AgentProjectDescriptor } from "../domain/agentProject";
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
      expect((await h.surface.getTurnChanges("thread", "other")).state).toBe("unavailable");
      expect((await h.surface.getTurnChanges("foreign", "old")).state).toBe("unavailable");
      h.render({
        ...deps,
        historyPage: null,
        threads: new Map([
          [thread.threadId, { ...thread, turns: [{ ...turn, status: { kind: "running" } }] }],
        ]),
      });
      expect((await h.surface.getTurnChanges("thread", "old")).state).toBe("unavailable");
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
      await Promise.resolve();
      h.render({ ...deps, projects: [] });
      h.render(deps);
      finish(summary);
      expect((await pending).state).toBe("unavailable");
      const again = h.surface.getTurnChanges("thread", "old");
      await Promise.resolve();
      h.render({ ...deps, gateway: gateway() });
      finish(summary);
      expect((await again).state).toBe("unavailable");
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
      expect((await h.surface.getTurnChanges("thread", "old")).state).toBe("unavailable");
      expect(port.getSummary).not.toHaveBeenCalled();
    } finally {
      h.close();
    }
  });
});
