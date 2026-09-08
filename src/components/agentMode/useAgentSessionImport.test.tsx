// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExternalSessionImportResult } from "../../application/agentThreadPorts";
import type { ExternalAgentSessionView } from "../../domain/externalAgentSession";
import { useAgentSessionImport, type AgentSessionImportOptions } from "./useAgentSessionImport";

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));
const session = (sessionId: string): ExternalAgentSessionView => ({
  sessionId,
  provider: "claudeCode",
  cwd: "/app",
  title: sessionId,
  firstPrompt: "hello",
  startedAtEpochMs: 1,
  lastActivityEpochMs: 2,
  turnCount: 1,
  turnCountExact: true,
  fileBytes: 20,
  alreadyImportedThreadId: null,
});
const a = session("00000000-0000-0000-0000-000000000001");
const b = session("00000000-0000-0000-0000-000000000002");
function harness() {
  const importSession = vi
    .fn<AgentSessionImportOptions["importSession"]>()
    .mockResolvedValue({ threadId: "thread", alreadyImported: false });
  const onComplete = vi.fn();
  let options: AgentSessionImportOptions = {
    open: true,
    target: { projectRootKey: "/app", repositoryRoot: "/app" },
    projects: [
      {
        rootKey: "/app",
        rootPath: "/app",
        ownerId: "owner",
        generation: 1,
        label: "app",
        trust: "trusted",
        origin: "active-tab",
        repositories: [],
        isolationPolicy: "auto",
        leaseToken: null,
      },
    ],
    surface: {
      state: "ready",
      target: { rootKey: "/app", repositoryRoot: "/app" },
      sessions: [a, b],
      skipped: 0,
      truncated: false,
      preview: null,
      previewPending: false,
      importPending: false,
      open: vi.fn(),
      reload: vi.fn(),
      close: vi.fn(),
      loadPreview: vi.fn(),
    },
    importSession,
    onComplete,
  };
  let result: ReturnType<typeof useAgentSessionImport> | null = null;
  let renders = 0;
  function Probe() {
    renders += 1;
    result = useAgentSessionImport(options);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe />));
  const unmount = () => act(() => root.unmount());
  cleanups.push(unmount);
  return {
    importSession,
    onComplete,
    renderCount: () => renders,
    hook: () => {
      if (result === null) throw new Error("missing hook");
      return result;
    },
    update: (patch: Partial<AgentSessionImportOptions>) => {
      options = { ...options, ...patch };
      act(() => root.render(<Probe />));
    },
    options: () => options,
    unmount: () => {
      cleanups.splice(cleanups.indexOf(unmount), 1);
      unmount();
    },
  };
}
function deferred() {
  let resolve: (value: ExternalSessionImportResult | null) => void = () => undefined;
  const promise = new Promise<ExternalSessionImportResult | null>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("session batch import", () => {
  it("does not rerender the agent workbench when an idle import is cancelled", () => {
    const h = harness();
    expect(h.renderCount()).toBe(1);
    act(() => h.hook().cancel());
    expect(h.renderCount()).toBe(1);
  });
  it("deduplicates selections and navigates once after sequential imports", async () => {
    const h = harness();
    const first = deferred();
    h.importSession.mockReturnValueOnce(first.promise);
    let work: Promise<void> | undefined;
    act(() => {
      work = h.hook().importMany([a, a, b]);
    });
    expect(h.importSession).toHaveBeenCalledTimes(1);
    expect(h.hook().surface?.importPending).toBe(true);
    await act(async () => {
      first.resolve({ threadId: "first", alreadyImported: false });
      await work;
    });
    expect(h.importSession).toHaveBeenCalledTimes(2);
    expect(h.onComplete).toHaveBeenCalledExactlyOnceWith("first");
  });
  it("rejects a second submission while pending", async () => {
    const h = harness();
    const first = deferred();
    h.importSession.mockReturnValueOnce(first.promise);
    let work: Promise<void> | undefined;
    act(() => {
      work = h.hook().importMany([a]);
    });
    await act(() => h.hook().importMany([b]));
    expect(h.importSession).toHaveBeenCalledTimes(1);
    await act(async () => {
      first.resolve(null);
      await work;
    });
  });
  it("keeps successes on partial failure and retries only failures even before list updates", async () => {
    const h = harness();
    h.importSession
      .mockResolvedValueOnce({ threadId: "first", alreadyImported: false })
      .mockRejectedValueOnce(new Error("failed"));
    await act(() => h.hook().importMany([a, b]));
    expect(h.onComplete).not.toHaveBeenCalled();
    expect(h.hook().importNotice).toContain("1 of 2");
    await act(() => h.hook().importMany([a, b]));
    expect(h.importSession).toHaveBeenCalledTimes(3);
    expect(h.onComplete).toHaveBeenCalledExactlyOnceWith("first");
  });
  it.each(["cancel", "owner", "close", "unmount"] as const)(
    "ignores stale result after %s",
    async (change) => {
      const h = harness();
      const first = deferred();
      h.importSession.mockReturnValueOnce(first.promise);
      let work: Promise<void> | undefined;
      act(() => {
        work = h.hook().importMany([a, b]);
      });
      switch (change) {
        case "cancel":
          act(() => h.hook().cancel());
          break;
        case "owner": {
          const projects = h.options().projects;
          h.update({ projects: projects.map((p) => ({ ...p, generation: 2 })) });
          h.update({ projects });
          break;
        }
        case "close":
          h.update({ open: false });
          h.update({ open: true });
          break;
        case "unmount":
          h.unmount();
          break;
      }
      await act(async () => {
        first.resolve({ threadId: "stale", alreadyImported: false });
        await work;
      });
      expect(h.importSession).toHaveBeenCalledTimes(1);
      expect(h.onComplete).not.toHaveBeenCalled();
    },
  );
  it("does not let an old completion clear a reopened batch", async () => {
    const h = harness();
    const old = deferred();
    const fresh = deferred();
    h.importSession.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    let oldWork: Promise<void> | undefined;
    let freshWork: Promise<void> | undefined;
    act(() => {
      oldWork = h.hook().importMany([a, b]);
    });
    act(() => h.hook().cancel());
    act(() => {
      freshWork = h.hook().importMany([b]);
    });
    await act(async () => {
      old.resolve({ threadId: "old", alreadyImported: false });
      await oldWork;
    });
    expect(h.hook().surface?.importPending).toBe(true);
    expect(h.onComplete).not.toHaveBeenCalled();
    await act(async () => {
      fresh.resolve({ threadId: "fresh", alreadyImported: false });
      await freshWork;
    });
    expect(h.onComplete).toHaveBeenCalledExactlyOnceWith("fresh");
  });
  it("validates each remaining session against the current list and repository owner", async () => {
    const h = harness();
    const first = deferred();
    h.importSession.mockReturnValueOnce(first.promise);
    let work: Promise<void> | undefined;
    act(() => {
      work = h.hook().importMany([a, b]);
    });
    const surface = h.options().surface;
    if (surface === null) throw new Error("missing surface");
    h.update({ surface: { ...surface, sessions: [a, { ...b, cwd: "/foreign" }] } });
    await act(async () => {
      first.resolve({ threadId: "first", alreadyImported: false });
      await work;
    });
    expect(h.importSession).toHaveBeenCalledTimes(1);
    expect(h.hook().importNotice).toContain("1 of 2");
  });
  it("rejects oversized and foreign selections and honors already imported sessions", async () => {
    const h = harness();
    await act(() => h.hook().importMany(Array.from({ length: 51 }, () => a)));
    expect(h.hook().importNotice).toContain("up to 50");
    await act(() => h.hook().importMany([{ ...a, sessionId: "foreign" }]));
    expect(h.importSession).not.toHaveBeenCalled();
    const surface = h.options().surface;
    if (surface === null) throw new Error("missing surface");
    h.update({
      surface: { ...surface, sessions: [{ ...a, alreadyImportedThreadId: "existing" }] },
    });
    await act(() => h.hook().importMany([a]));
    expect(h.onComplete).toHaveBeenCalledExactlyOnceWith("existing");
    expect(h.importSession).not.toHaveBeenCalled();
  });
});
