// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logProject, logThread, logTurn } from "../test/agentTurnLogStoreHarness";
import type { AgentHistoryTurnPage } from "../domain/agentHistory";
import { useAgentThreadHistory, type AgentThreadHistorySurface } from "./useAgentThreadHistory";

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
});
function harness(read = vi.fn<() => Promise<AgentHistoryTurnPage>>()) {
  const thread = logThread({ turns: [logTurn({ turnId: "latest" })], turnsTruncated: true });
  const threads = new Map([[thread.threadId, thread]]);
  let project = logProject();
  const gateway = {
    readAgentHistoryTurns: read,
    loadAgentThreads: vi.fn(),
    saveAgentThread: vi.fn(),
    deleteAgentThread: vi.fn(),
  };
  let surface: AgentThreadHistorySurface;
  function Probe() {
    surface = useAgentThreadHistory({
      projects: [project],
      threads,
      gateway,
      currentState: () => ({ threads }),
      reportError: vi.fn(),
    });
    return null;
  }
  const host = document.createElement("div");
  root = createRoot(host);
  return {
    thread,
    threads,
    read,
    surface: () => surface!,
    render: async () => {
      await act(async () => root!.render(<Probe />));
    },
    replace: async () => {
      project = { ...project, generation: project.generation + 1 };
      await act(async () => root!.render(<Probe />));
    },
  };
}
describe("historical turn display pages", () => {
  it("replaces pages without replacing the authoritative latest tail", async () => {
    const h = harness();
    await h.render();
    h.read.mockResolvedValueOnce({
      turns: [logTurn({ turnId: "middle" })],
      revision: 1,
      hasEarlier: true,
      beforeTurnId: "middle",
    });
    await act(async () => h.surface().older(h.thread.threadId));
    expect(h.surface().page?.turns[0].turnId).toBe("middle");
    h.read.mockResolvedValueOnce({
      turns: [logTurn({ turnId: "oldest" })],
      revision: 1,
      hasEarlier: false,
      beforeTurnId: "oldest",
    });
    await act(async () => h.surface().older(h.thread.threadId));
    expect(h.surface().page?.turns.map((turn) => turn.turnId)).toEqual(["oldest"]);
    expect(h.threads.get(h.thread.threadId)?.turns[0].turnId).toBe("latest");
    h.read.mockResolvedValueOnce({
      revision: 1,
      turns: [logTurn({ turnId: "middle" })],
      hasEarlier: true,
      beforeTurnId: "middle",
    });
    await act(async () => h.surface().newer?.(h.thread.threadId));
    expect(h.surface().page?.turns[0].turnId).toBe("middle");
    expect(h.read.mock.calls.length).toBe(3);

    await act(async () => h.surface().latest());
    expect(h.surface().page).toBeNull();
  });
  it("rejects an old workspace generation and a late response after Back to latest", async () => {
    const h = harness();
    await h.render();
    let resolve!: (page: AgentHistoryTurnPage) => void;
    h.read.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    let pending!: Promise<void>;
    await act(async () => {
      pending = h.surface().older(h.thread.threadId);
    });
    await h.replace();
    await act(async () => {
      resolve({
        turns: [logTurn()],
        revision: 1,
        hasEarlier: false,
        beforeTurnId: logTurn().turnId,
      });
      await pending;
    });
    expect(h.surface().page).toBeNull();
    await act(async () => {
      pending = h.surface().older(h.thread.threadId);
    });
    await act(async () => h.surface().latest());
    await act(async () => {
      resolve({
        turns: [logTurn()],
        revision: 1,
        hasEarlier: false,
        beforeTurnId: logTurn().turnId,
      });
      await pending;
    });
    expect(h.surface().page).toBeNull();
  });
});
