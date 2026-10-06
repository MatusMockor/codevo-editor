// @vitest-environment jsdom

import { act, useCallback, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTasksNotice, AgentThreadView } from "../../application/agentThreadPorts";
import { emptyRemoteInventory } from "../../application/remoteAgentInventoryLoad";
import {
  projectRemoteAgentThreads,
  remoteAgentThreadKey,
} from "../../application/remoteAgentProjection";
import { remoteAgentThreadActions } from "../../application/remoteAgentSurface";
import {
  useAgentThreadUndo,
  type AgentThreadUndoSurface,
} from "../../application/useAgentThreadUndo";
import { useRemoteAgentStableSurface } from "../../application/useRemoteAgentStableSurface";
import { useServerThreadMetadata } from "../../application/useServerThreadMetadata";
import {
  AGENT_THREAD_UNDO_CONFIRM_MS,
  AGENT_THREAD_UNDO_VISIBLE_MS,
} from "../../domain/agentThreadUndo";
import type { RemoteRunnerGateway } from "../../domain/remoteRunner";
import { agentThreadBulkOwnerKey } from "../../domain/agentThreadBulkAction";
import type {
  RemoteThreadMetadata,
  RemoteThreadMetadataPatch,
} from "../../domain/remoteThreadMetadata";
import { AGENT_THREAD_UNDO_BUSY_TITLE, AgentThreadUndoNotice } from "./AgentThreadUndoNotice";
import { agentRailSections } from "./agentSidebarPresentation";
import { threadsSurfaceFixture } from "./agentThreadsSurfaceTestFixtures";
import {
  useAgentThreadMenuCommands,
  type AgentThreadMenuCommands,
} from "./useAgentThreadMenuCommands";
import { useAgentThreadUndoShortcut } from "./useAgentThreadUndoShortcut";

const SERVER = "s";
const RUNNER = "r";
const TASK_IDS = ["t1", "t2"] as const;
const TASKS = TASK_IDS.map((id, index) => ({
  id,
  runnerId: RUNNER,
  projectId: "p",
  sequence: index + 1,
  provider: "codex" as const,
  status: "succeeded" as const,
  parts: [{ type: "text" as const, text: `Task ${id}` }],
  createdAt: "2026-09-13T00:00:00Z",
}));
const BASE_VIEWS = projectRemoteAgentThreads({
  serverId: SERVER,
  runnerId: RUNNER,
  projects: [{ id: "p", name: "Project" }],
  tasks: TASKS,
  replays: new Map(),
  resumes: new Map(),
});
const FIRST = remoteAgentThreadKey(SERVER, RUNNER, "t1");
const SECOND = remoteAgentThreadKey(SERVER, RUNNER, "t2");
const LOCAL = threadsSurfaceFixture();
const OWNER = {};
const SAVE_FAILED =
  "The conversation change could not be saved on the server. Refresh and try again.";

function record(taskId: string, change: Partial<RemoteThreadMetadata> = {}): RemoteThreadMetadata {
  return {
    taskId,
    revision: 1,
    title: null,
    pinned: false,
    archived: false,
    removed: false,
    viewedAtEpochMs: null,
    snoozedUntil: null,
    settledAt: null,
    sortOrder: null,
    ...change,
  };
}

const CONNECT_FIRST = "Connect to the server to change this conversation.";

function runner(initial: ReadonlyArray<RemoteThreadMetadata>) {
  const stored = new Map(initial.map((entry) => [entry.taskId, entry]));
  const gate = {
    failing: new Set<string>(),
    hold: new Map<string, Promise<void>>(),
  };
  const getThreadMetadata = vi.fn<NonNullable<RemoteRunnerGateway["getThreadMetadata"]>>(
    async (request) => {
      const current = stored.get(request.taskId);
      if (current === undefined) return Promise.reject(new Error("unknown task"));
      return current;
    },
  );
  const updateThreadMetadata = vi.fn<NonNullable<RemoteRunnerGateway["updateThreadMetadata"]>>(
    async (request) => {
      const held = gate.hold.get(request.taskId);
      if (held !== undefined) await held;
      const current = stored.get(request.taskId);
      if (gate.failing.has(request.taskId) || current === undefined) {
        return Promise.reject(new Error("save refused"));
      }
      if (current.revision !== request.patch.expectedRevision) {
        return Promise.reject(new Error("revision conflict"));
      }
      const { expectedRevision: _expected, ...change } = request.patch;
      const next = { ...current, ...change, revision: current.revision + 1 };
      stored.set(request.taskId, next);
      return next;
    },
  );
  const gateway = {
    getThreadMetadata,
    updateThreadMetadata,
    reorderThread: vi.fn<NonNullable<RemoteRunnerGateway["reorderThread"]>>(async () => ({
      items: [],
    })),
    listServers: vi.fn(),
    connectServer: vi.fn(),
    disconnectServer: vi.fn(),
    removeServer: vi.fn(),
    getRunner: vi.fn(),
    listProjects: vi.fn(),
    cloneProject: vi.fn(),
    getProjectClone: vi.fn(),
    cancelProjectClone: vi.fn(),
    listTasks: vi.fn(),
    createTask: vi.fn(),
    startTask: vi.fn(),
    getTask: vi.fn(),
    getTaskResume: vi.fn(),
    continueTask: vi.fn(),
    cancelTask: vi.fn(),
    listEvents: vi.fn(),
    getDiff: vi.fn(),
    uploadAttachment: vi.fn(),
  } satisfies RemoteRunnerGateway;
  const changeElsewhere = (taskId: string, change: Partial<RemoteThreadMetadata>): void => {
    const current = stored.get(taskId);
    if (current === undefined) return;
    stored.set(taskId, { ...current, ...change, revision: current.revision + 1 });
  };
  return { gate, stored, updateThreadMetadata, gateway, changeElsewhere };
}

function inventory(stored: ReadonlyMap<string, RemoteThreadMetadata>, connected: boolean) {
  return {
    ...emptyRemoteInventory(SERVER, connected),
    descriptor: {
      protocolVersion: 1 as const,
      runnerId: RUNNER,
      name: "Runner",
      capabilities: { taskExecution: true, eventReplay: true, threadManagement: true },
    },
    tasks: TASKS,
    threadMetadata: new Map(stored),
  };
}

interface Captured {
  readonly views: ReadonlyArray<AgentThreadView>;
  refresh(): Promise<void>;
  setConnected(connected: boolean): void;
  readonly menu: AgentThreadMenuCommands;
  readonly undo: AgentThreadUndoSurface;
  readonly selectedThreadId: string | null;
  select(threadId: string | null): void;
}

describe("thread action undo on server threads", () => {
  let host: HTMLDivElement;
  let root: Root;
  let captured: Captured | null;
  let notices: AgentTasksNotice[];
  let reports: string[];
  let server: ReturnType<typeof runner>;
  let ownerKey: string;
  let staleRefresh: boolean;

  function Harness() {
    const [snapshots, setSnapshots] = useState(() => [inventory(server.stored, true)]);
    const connection = useRef(true);
    const refresh = useCallback(async () => {
      if (staleRefresh) return;
      setSnapshots([inventory(server.stored, connection.current)]);
    }, []);
    const publishThreadMetadata = useCallback((_serverId: string, saved: RemoteThreadMetadata) => {
      if (staleRefresh) return false;
      setSnapshots((current) =>
        current.map((snapshot) => ({
          ...snapshot,
          threadMetadata: new Map(snapshot.threadMetadata).set(saved.taskId, saved),
        })),
      );
      return true;
    }, []);
    const setConnected = useCallback((connected: boolean) => {
      connection.current = connected;
      setSnapshots([inventory(server.stored, connected)]);
    }, []);
    const report = useCallback((message: string) => {
      reports.push(message);
    }, []);
    const valid = useCallback((candidate: object) => candidate === OWNER, []);
    const metadata = useServerThreadMetadata({
      gateway: server.gateway,
      snapshots,
      owner: OWNER,
      valid,
      report,
      refresh,
      publishThreadMetadata,
    });
    const project = metadata.project;
    const views = useMemo(
      () =>
        BASE_VIEWS.map((view) => project(view)).filter(
          (view): view is AgentThreadView => view !== null,
        ),
      [project],
    );
    const actions = remoteAgentThreadActions({
      local: LOCAL,
      threads: views,
      report,
      update: metadata.update,
      batch: metadata.batch,
      stop: async () => undefined,
    });
    const agents = useRemoteAgentStableSurface({ ...LOCAL, ...actions, threads: views });
    const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
    const undo = useAgentThreadUndo({
      ownerKey,
      threads: agents.threads,
      ports: agents,
      selectedThreadId,
      selectThread: setSelectedThreadId,
      reportNotice: (notice) => notices.push(notice),
    });
    const menu = useAgentThreadMenuCommands({
      agents,
      groups: [],
      revealPath: async () => undefined,
      reportNotice: (notice) => notices.push(notice),
      onTrustProject: () => undefined,
      onCloseProject: () => undefined,
      onReleaseProject: () => undefined,
      onRenameProject: () => undefined,
      onThreadRemoved: () => undefined,
      onOpenTerminalSessions: () => undefined,
      startNewThread: () => undefined,
      undo: undo.recorder,
    });
    captured = {
      views,
      menu,
      undo,
      selectedThreadId,
      select: setSelectedThreadId,
      refresh,
      setConnected,
    };
    const surfaceRef = useRef<HTMLElement | null>(null);
    useAgentThreadUndoShortcut(surfaceRef, undo.notification === null ? null : undo.undo, "linux");
    return (
      <section ref={surfaceRef}>
        <button data-testid="row" type="button">
          Row
        </button>
        <AgentThreadUndoNotice
          notification={undo.notification}
          onDismiss={undo.dismiss}
          onPausedChange={undo.setPaused}
          onUndo={undo.undo}
        />
      </section>
    );
  }

  function current(): Captured {
    expect(captured).not.toBeNull();
    return captured as Captured;
  }

  async function settle(): Promise<void> {
    await act(async () => {
      for (let index = 0; index < 20; index += 1) await Promise.resolve();
    });
  }

  async function mount(initial: ReadonlyArray<RemoteThreadMetadata>): Promise<void> {
    server = runner(initial);
    act(() => root.render(<Harness />));
    await settle();
    server.updateThreadMetadata.mockClear();
  }

  async function command(
    threadId: string,
    menuCommand: Parameters<AgentThreadMenuCommands["handleThreadMenuCommand"]>[1],
  ): Promise<void> {
    act(() => current().menu.handleThreadMenuCommand(threadId, menuCommand));
    await settle();
  }

  async function undo(): Promise<void> {
    act(() => current().undo.undo());
    await settle();
  }

  function thread(threadId: string) {
    const view = current().views.find((candidate) => candidate.thread.threadId === threadId);
    expect(view).toBeDefined();
    return (view as AgentThreadView).thread;
  }

  function patches(): ReadonlyArray<RemoteThreadMetadataPatch> {
    return server.updateThreadMetadata.mock.calls.map(([request]) => request.patch);
  }

  function noticeText(): string | null {
    return host.querySelector(".agent-notice > span")?.textContent ?? null;
  }

  function undoButton(): HTMLButtonElement {
    const button = [...host.querySelectorAll<HTMLButtonElement>(".agent-notice button")].find(
      (candidate) => candidate.textContent === "Undo",
    );
    expect(button).toBeDefined();
    return button as HTMLButtonElement;
  }

  async function pressUndo(): Promise<KeyboardEvent> {
    const row = host.querySelector<HTMLElement>('[data-testid="row"]');
    expect(row).not.toBeNull();
    const event = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    row?.focus();
    act(() => {
      row?.dispatchEvent(event);
    });
    await settle();
    return event;
  }

  function held(taskId: string): () => void {
    let release = (): void => undefined;
    server.gate.hold.set(
      taskId,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    return () => {
      server.gate.hold.delete(taskId);
      release();
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    captured = null;
    notices = [];
    reports = [];
    ownerKey = "/workspace/a";
    staleRefresh = false;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("settles and restores a server thread through the runner metadata port", async () => {
    await mount([record("t1", { snoozedUntil: 1_000 }), record("t2")]);
    expect(thread(FIRST).snoozedUntil).toBe(1_000);

    await command(FIRST, { kind: "settle" });
    expect(patches()).toEqual([
      { settledAt: expect.any(Number), snoozedUntil: null, expectedRevision: 1 },
    ]);
    expect(thread(FIRST).settledAt).toEqual(expect.any(Number));
    expect(noticeText()).toBe("Thread settled");

    await undo();
    expect(patches()[1]).toEqual({ settledAt: null, snoozedUntil: 1_000, expectedRevision: 2 });
    expect(thread(FIRST).settledAt).toBeNull();
    expect(thread(FIRST).snoozedUntil).toBe(1_000);
    expect(noticeText()).toBeNull();
    expect(notices).toEqual([]);
    expect(reports).toEqual([]);
  });

  it("offers undo only once the server confirmed the action", async () => {
    await mount([record("t1"), record("t2")]);
    let release = (): void => undefined;
    server.gate.hold.set(
      "t1",
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );

    await command(FIRST, { kind: "snooze", until: Date.now() + 3_600_000 });
    expect(server.updateThreadMetadata).toHaveBeenCalledTimes(1);
    expect(noticeText()).toBeNull();
    await undo();
    expect(server.updateThreadMetadata).toHaveBeenCalledTimes(1);

    server.gate.hold.delete("t1");
    release();
    await settle();
    expect(noticeText()).toBe("Thread snoozed");
  });

  it("restores an unpinned server thread to its pinned position", async () => {
    await mount([
      record("t1", { pinned: true, sortOrder: 1 }),
      record("t2", { pinned: true, sortOrder: 0 }),
    ]);
    const pinnedOrder = () =>
      agentRailSections(current().views, Date.now()).pinned.map((view) => view.thread.threadId);
    expect(pinnedOrder()).toEqual([SECOND, FIRST]);

    await command(SECOND, { kind: "togglePin" });
    expect(pinnedOrder()).toEqual([FIRST]);
    expect(noticeText()).toBe("Thread unpinned");

    await undo();
    expect(patches()).toEqual([
      { pinned: false, expectedRevision: 1 },
      { pinned: true, expectedRevision: 2 },
    ]);
    expect(pinnedOrder()).toEqual([SECOND, FIRST]);
    expect(thread(SECOND).sortOrder).toBe(0);
  });

  it("unarchives a viewed server thread and reselects it", async () => {
    await mount([record("t1"), record("t2")]);
    act(() => current().select(FIRST));

    await command(FIRST, { kind: "archive" });
    expect(thread(FIRST).archived).toBe(true);
    expect(noticeText()).toBe("Thread archived");
    act(() => current().select(SECOND));

    await undo();
    expect(patches()[1]).toEqual({ archived: false, expectedRevision: 2 });
    expect(thread(FIRST).archived).toBe(false);
    expect(current().selectedThreadId).toBe(FIRST);
    expect(notices).toEqual([]);
  });

  it("offers no undo when the server refused the action", async () => {
    await mount([record("t1"), record("t2")]);
    server.gate.failing.add("t1");

    await command(FIRST, { kind: "archive" });
    expect(thread(FIRST).archived).toBe(false);
    expect(reports).toEqual([SAVE_FAILED]);
    expect(noticeText()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_UNDO_CONFIRM_MS);
    });
    expect(noticeText()).toBeNull();
    expect(notices).toEqual([]);
  });

  it("reports a refused unarchive truthfully and does not reselect", async () => {
    await mount([record("t1"), record("t2")]);
    act(() => current().select(FIRST));
    await command(FIRST, { kind: "archive" });
    act(() => current().select(SECOND));
    server.gate.failing.add("t1");

    await undo();
    expect(thread(FIRST).archived).toBe(true);
    expect(current().selectedThreadId).toBe(SECOND);
    expect(noticeText()).toBeNull();
    expect(notices).toEqual([
      { kind: "warning", message: "Undo failed. The thread was not restored.", action: null },
    ]);

    await undo();
    expect(server.updateThreadMetadata).toHaveBeenCalledTimes(2);
  });

  it("reports a refused restore of a settled thread as soon as the server refuses it", async () => {
    await mount([record("t1"), record("t2")]);
    await command(FIRST, { kind: "settle" });
    server.gate.failing.add("t1");

    await undo();
    expect(reports).toEqual([SAVE_FAILED]);
    expect(thread(FIRST).settledAt).toEqual(expect.any(Number));
    expect(notices).toEqual([
      { kind: "warning", message: "Undo failed. The thread was not restored.", action: null },
    ]);
    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_UNDO_CONFIRM_MS);
    });
    expect(notices).toHaveLength(1);
  });

  it("does not report a failure while the server is still saving and reports the refusal when it arrives", async () => {
    await mount([record("t1"), record("t2")]);
    await command(FIRST, { kind: "settle" });
    const release = held("t1");
    server.gate.failing.add("t1");

    await undo();
    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_UNDO_CONFIRM_MS);
    });
    expect(notices).toEqual([]);

    release();
    await settle();
    expect(thread(FIRST).settledAt).toEqual(expect.any(Number));
    expect(notices).toEqual([
      { kind: "warning", message: "Undo failed. The thread was not restored.", action: null },
    ]);
  });

  it("finishes a restore the server confirms after the confirmation window without taking the selection", async () => {
    await mount([record("t1"), record("t2")]);
    act(() => current().select(FIRST));
    await command(FIRST, { kind: "archive" });
    act(() => current().select(SECOND));
    const release = held("t1");

    await undo();
    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_UNDO_CONFIRM_MS);
    });
    expect(notices).toEqual([]);
    expect(current().selectedThreadId).toBe(SECOND);

    release();
    await settle();
    expect(thread(FIRST).archived).toBe(false);
    expect(current().selectedThreadId).toBe(SECOND);
    expect(notices).toEqual([]);
  });

  it("does not report a failure when the server confirmed the restore but the refresh is slow", async () => {
    await mount([record("t1"), record("t2")]);
    act(() => current().select(FIRST));
    await command(FIRST, { kind: "archive" });
    act(() => current().select(SECOND));
    staleRefresh = true;

    await undo();
    expect(server.stored.get("t1")?.archived).toBe(false);
    expect(thread(FIRST).archived).toBe(true);
    expect(current().selectedThreadId).toBe(FIRST);
    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_UNDO_CONFIRM_MS * 2);
    });
    expect(notices).toEqual([]);

    staleRefresh = false;
    await act(async () => current().refresh());
    expect(thread(FIRST).archived).toBe(false);
    expect(notices).toEqual([]);
  });

  it("disables Undo while a restore is in flight and gives the newer offer its full window afterwards", async () => {
    await mount([record("t1"), record("t2")]);
    await command(FIRST, { kind: "archive" });
    const release = held("t1");
    await undo();
    expect(server.updateThreadMetadata).toHaveBeenCalledTimes(2);

    await command(SECOND, { kind: "settle" });
    expect(noticeText()).toBe("Thread settled");
    expect(undoButton().disabled).toBe(true);
    expect(undoButton().getAttribute("aria-busy")).toBe("true");
    expect(undoButton().title).toBe(AGENT_THREAD_UNDO_BUSY_TITLE);
    act(() => undoButton().click());
    const pressed = await pressUndo();
    expect(pressed.defaultPrevented).toBe(true);
    expect(server.updateThreadMetadata).toHaveBeenCalledTimes(3);
    expect(thread(SECOND).settledAt).toEqual(expect.any(Number));

    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_UNDO_VISIBLE_MS + 1_000);
    });
    expect(noticeText()).toBe("Thread settled");
    expect(undoButton().disabled).toBe(true);

    release();
    await settle();
    expect(thread(FIRST).archived).toBe(false);
    expect(undoButton().disabled).toBe(false);
    expect(undoButton().getAttribute("aria-busy")).toBe("false");
    expect(undoButton().title).toBe("");
    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_UNDO_VISIBLE_MS - 1);
    });
    expect(noticeText()).toBe("Thread settled");

    await pressUndo();
    expect(server.updateThreadMetadata).toHaveBeenCalledTimes(4);
    expect(thread(SECOND).settledAt).toBeNull();
    expect(noticeText()).toBeNull();
    expect(notices).toEqual([]);
  });

  it("expires the newer offer five seconds after the in-flight restore settles", async () => {
    await mount([record("t1"), record("t2")]);
    await command(FIRST, { kind: "archive" });
    const release = held("t1");
    await undo();
    await command(SECOND, { kind: "settle" });

    release();
    await settle();
    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_UNDO_VISIBLE_MS - 1);
    });
    expect(noticeText()).toBe("Thread settled");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(noticeText()).toBeNull();
  });

  it("re-enables Undo when the in-flight restore outlives the confirmation window", async () => {
    await mount([record("t1"), record("t2")]);
    await command(FIRST, { kind: "archive" });
    held("t1");
    await undo();
    await command(SECOND, { kind: "settle" });
    expect(undoButton().disabled).toBe(true);

    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_UNDO_CONFIRM_MS);
    });
    expect(noticeText()).toBe("Thread settled");
    expect(undoButton().disabled).toBe(false);
    await undo();
    expect(thread(SECOND).settledAt).toBeNull();
    expect(notices).toEqual([]);
  });

  it("offers no undo for an action taken while the view still shows the state before a confirmed restore", async () => {
    await mount([record("t1"), record("t2")]);
    await command(FIRST, { kind: "settle" });
    staleRefresh = true;
    await undo();
    expect(server.stored.get("t1")?.settledAt).toBeNull();
    expect(thread(FIRST).settledAt).toEqual(expect.any(Number));
    expect(notices).toEqual([]);

    staleRefresh = false;
    const until = Date.now() + 3_600_000;
    await command(FIRST, { kind: "snooze", until });
    expect(thread(FIRST).snoozedUntil).toBe(until);
    expect(thread(FIRST).settledAt).toBeNull();
    expect(noticeText()).toBeNull();
    await undo();
    expect(server.updateThreadMetadata).toHaveBeenCalledTimes(3);
    expect(server.stored.get("t1")?.settledAt).toBeNull();
    expect(server.stored.get("t1")?.snoozedUntil).toBe(until);

    await command(FIRST, { kind: "settle" });
    expect(noticeText()).toBe("Thread settled");
    await undo();
    expect(server.stored.get("t1")?.settledAt).toBeNull();
    expect(server.stored.get("t1")?.snoozedUntil).toBe(until);
    expect(notices).toEqual([]);
  });

  it("stops guarding a restored thread once the view shows the restore or the bounded wait is over", async () => {
    await mount([record("t1"), record("t2")]);
    await command(FIRST, { kind: "settle" });
    staleRefresh = true;
    await undo();
    expect(current().undo.recorder.capture([FIRST]).blocked).toBe(true);

    staleRefresh = false;
    await act(async () => current().refresh());
    expect(thread(FIRST).settledAt).toBeNull();
    expect(current().undo.recorder.capture([FIRST]).blocked).toBe(false);

    await command(SECOND, { kind: "settle" });
    staleRefresh = true;
    await undo();
    expect(current().undo.recorder.capture([SECOND]).blocked).toBe(true);
    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_UNDO_CONFIRM_MS);
    });
    expect(current().undo.recorder.capture([SECOND]).blocked).toBe(false);
  });

  it("stops guarding restored threads when the owner changes", async () => {
    await mount([record("t1"), record("t2")]);
    await command(FIRST, { kind: "settle" });
    staleRefresh = true;
    await undo();
    expect(current().undo.recorder.capture([FIRST]).blocked).toBe(true);

    ownerKey = "/workspace/b";
    act(() => root.render(<Harness />));
    expect(current().undo.recorder.capture([FIRST]).blocked).toBe(false);
  });

  it("refuses a bulk offer that includes a thread whose restore the view has not shown yet", async () => {
    await mount([record("t1"), record("t2")]);
    const ownerKeys = new Map(
      [FIRST, SECOND].map((threadId) => [
        threadId,
        agentThreadBulkOwnerKey(thread(threadId).owner),
      ]),
    );
    const archiveBoth = (): void =>
      current().menu.handleThreadBulkCommand({
        kind: "apply",
        request: { action: "archive", threadIds: [FIRST, SECOND], missingIds: [], ownerKeys },
      });
    act(archiveBoth);
    await settle();
    expect(noticeText()).toBe("2 threads archived");
    staleRefresh = true;
    await undo();
    expect(server.stored.get("t1")?.archived).toBe(false);
    expect(server.stored.get("t2")?.archived).toBe(false);
    expect(thread(FIRST).archived).toBe(true);
    expect(notices).toEqual([]);
    const writes = server.updateThreadMetadata.mock.calls.length;

    const stale = current().undo.recorder.capture([FIRST, SECOND]);
    expect(stale.blocked).toBe(true);
    expect(current().undo.recorder.offer({ kind: "archive" }, stale)).toBe(false);
    act(archiveBoth);
    await settle();
    expect(server.updateThreadMetadata.mock.calls.length).toBe(writes);
    expect(noticeText()).toBeNull();

    staleRefresh = false;
    await act(async () => current().refresh());
    expect(thread(FIRST).archived).toBe(false);
    expect(thread(SECOND).archived).toBe(false);
    expect(current().undo.recorder.capture([FIRST, SECOND]).blocked).toBe(false);
    act(archiveBoth);
    await settle();
    expect(noticeText()).toBe("2 threads archived");
    await undo();
    expect(thread(FIRST).archived).toBe(false);
    expect(thread(SECOND).archived).toBe(false);
  });

  it("refuses the whole offer when only one of several threads is still shown before its restore", async () => {
    await mount([record("t1"), record("t2")]);
    await command(FIRST, { kind: "archive" });
    staleRefresh = true;
    await undo();

    const mixed = current().undo.recorder.capture([FIRST, SECOND]);
    expect(mixed.subjects).toHaveLength(2);
    expect(mixed.blocked).toBe(true);
    expect(current().undo.recorder.offer({ kind: "archive" }, mixed, [SECOND])).toBe(false);
    expect(current().undo.recorder.capture([SECOND]).blocked).toBe(false);
  });

  it("lets a released restore report its late failure without disturbing a newer restore", async () => {
    await mount([record("t1"), record("t2")]);
    act(() => current().select(FIRST));
    await command(FIRST, { kind: "archive" });
    act(() => current().select(SECOND));
    const releaseFirst = held("t1");
    server.gate.failing.add("t1");
    await undo();
    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_UNDO_CONFIRM_MS);
    });

    await command(SECOND, { kind: "settle" });
    const releaseSecond = held("t2");
    await undo();
    expect(server.updateThreadMetadata).toHaveBeenCalledTimes(4);

    releaseFirst();
    await settle();
    expect(thread(FIRST).archived).toBe(true);
    expect(current().selectedThreadId).toBe(SECOND);
    expect(notices).toEqual([
      { kind: "warning", message: "Undo failed. The thread was not restored.", action: null },
    ]);
    expect(thread(SECOND).settledAt).toEqual(expect.any(Number));

    releaseSecond();
    await settle();
    expect(thread(SECOND).settledAt).toBeNull();
    expect(notices).toHaveLength(1);
  });

  it("never reselects from a released restore that succeeds after a newer restore started", async () => {
    await mount([record("t1"), record("t2")]);
    act(() => current().select(FIRST));
    await command(FIRST, { kind: "archive" });
    act(() => current().select(SECOND));
    const releaseFirst = held("t1");
    await undo();
    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_UNDO_CONFIRM_MS);
    });

    await command(SECOND, { kind: "settle" });
    const releaseSecond = held("t2");
    await undo();

    releaseFirst();
    await settle();
    expect(thread(FIRST).archived).toBe(false);
    expect(current().selectedThreadId).toBe(SECOND);
    expect(notices).toEqual([]);

    releaseSecond();
    await settle();
    expect(thread(SECOND).settledAt).toBeNull();
    expect(current().selectedThreadId).toBe(SECOND);
    expect(notices).toEqual([]);
  });

  it("stays silent when a released restore settles after the owner changed", async () => {
    await mount([record("t1"), record("t2")]);
    await command(FIRST, { kind: "archive" });
    const release = held("t1");
    server.gate.failing.add("t1");
    await undo();
    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_UNDO_CONFIRM_MS);
    });

    ownerKey = "/workspace/b";
    act(() => root.render(<Harness />));
    ownerKey = "/workspace/a";
    act(() => root.render(<Harness />));
    release();
    await settle();
    expect(notices).toEqual([]);
  });

  it("stays silent when a released restore settles after unmount", async () => {
    await mount([record("t1"), record("t2")]);
    act(() => current().select(FIRST));
    await command(FIRST, { kind: "archive" });
    act(() => current().select(SECOND));
    const release = held("t1");
    server.gate.failing.add("t1");
    await undo();
    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_UNDO_CONFIRM_MS);
    });

    act(() => root.unmount());
    release();
    await settle();
    vi.advanceTimersByTime(AGENT_THREAD_UNDO_CONFIRM_MS);
    expect(server.updateThreadMetadata).toHaveBeenCalledTimes(2);
    expect(notices).toEqual([]);
    root = createRoot(host);
  });

  it("drops the reselect and the report when the owner changes during a restore", async () => {
    await mount([record("t1"), record("t2")]);
    act(() => current().select(FIRST));
    await command(FIRST, { kind: "archive" });
    act(() => current().select(SECOND));
    const release = held("t1");
    server.gate.failing.add("t1");
    await undo();

    ownerKey = "/workspace/b";
    act(() => root.render(<Harness />));
    release();
    await settle();
    expect(current().selectedThreadId).toBe(SECOND);
    expect(notices).toEqual([]);
    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_UNDO_CONFIRM_MS);
    });
    expect(notices).toEqual([]);
  });

  it("keeps the live offer when the server refuses a later action", async () => {
    await mount([record("t1"), record("t2")]);
    await command(FIRST, { kind: "archive" });
    expect(noticeText()).toBe("Thread archived");
    server.gate.failing.add("t2");

    await command(SECOND, { kind: "settle" });
    expect(thread(SECOND).settledAt).toBeNull();
    expect(reports).toEqual([SAVE_FAILED]);
    expect(noticeText()).toBe("Thread archived");

    await undo();
    expect(thread(FIRST).archived).toBe(false);
    expect(notices).toEqual([]);
  });

  it("does not attribute another device's change to a refused action", async () => {
    await mount([record("t1", { pinned: true }), record("t2")]);
    server.gate.failing.add("t1");
    await command(FIRST, { kind: "togglePin" });
    expect(thread(FIRST).pinned).toBe(true);
    expect(reports).toEqual([SAVE_FAILED]);

    server.changeElsewhere("t1", { pinned: false });
    await act(async () => current().refresh());
    await settle();
    expect(thread(FIRST).pinned).toBe(false);
    expect(noticeText()).toBeNull();
    await undo();
    expect(server.updateThreadMetadata).toHaveBeenCalledTimes(1);
    expect(thread(FIRST).pinned).toBe(false);
  });

  it("drops the pending action when another device changes the thread before it lands", async () => {
    await mount([record("t1", { pinned: true }), record("t2")]);
    let release = (): void => undefined;
    server.gate.hold.set(
      "t1",
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    await command(FIRST, { kind: "settle" });
    server.changeElsewhere("t1", { pinned: false });
    await act(async () => current().refresh());
    await settle();
    expect(noticeText()).toBeNull();

    server.gate.hold.delete("t1");
    release();
    await settle();
    expect(noticeText()).toBeNull();
    expect(notices).toEqual([]);
  });

  it("refuses a second undo while a restore is in flight and still reports the first failure", async () => {
    await mount([record("t1"), record("t2")]);
    await command(FIRST, { kind: "archive" });
    let release = (): void => undefined;
    server.gate.hold.set(
      "t1",
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    server.gate.failing.add("t1");
    await undo();
    expect(server.updateThreadMetadata).toHaveBeenCalledTimes(2);
    expect(notices).toEqual([]);

    await command(SECOND, { kind: "settle" });
    expect(noticeText()).toBe("Thread settled");
    await undo();
    expect(server.updateThreadMetadata).toHaveBeenCalledTimes(3);
    expect(thread(SECOND).settledAt).toEqual(expect.any(Number));
    expect(noticeText()).toBe("Thread settled");

    server.gate.hold.delete("t1");
    release();
    await settle();
    expect(thread(FIRST).archived).toBe(true);
    expect(notices).toEqual([
      { kind: "warning", message: "Undo failed. The thread was not restored.", action: null },
    ]);

    await undo();
    expect(server.updateThreadMetadata).toHaveBeenCalledTimes(4);
    expect(thread(SECOND).settledAt).toBeNull();
    expect(noticeText()).toBeNull();
    expect(notices).toHaveLength(1);
  });

  it("reports how many threads a bulk undo left archived and reselects the restored one", async () => {
    await mount([record("t1"), record("t2")]);
    act(() => current().select(FIRST));
    const ownerKeys = new Map(
      [FIRST, SECOND].map((threadId) => [
        threadId,
        agentThreadBulkOwnerKey(thread(threadId).owner),
      ]),
    );
    act(() =>
      current().menu.handleThreadBulkCommand({
        kind: "apply",
        request: { action: "archive", threadIds: [FIRST, SECOND], missingIds: [], ownerKeys },
      }),
    );
    await settle();
    expect(thread(FIRST).archived).toBe(true);
    expect(thread(SECOND).archived).toBe(true);
    expect(noticeText()).toBe("2 threads archived");
    expect(notices).toEqual([]);
    act(() => current().select(null));
    server.gate.failing.add("t2");

    await undo();
    expect(thread(FIRST).archived).toBe(false);
    expect(thread(SECOND).archived).toBe(true);
    expect(current().selectedThreadId).toBe(FIRST);
    expect(notices).toEqual([
      {
        kind: "warning",
        message: "Undo failed. 1 of 2 threads were not restored.",
        action: null,
      },
    ]);
  });

  it("reports a failed undo when the server disconnected before it", async () => {
    await mount([record("t1", { pinned: true }), record("t2")]);
    await command(FIRST, { kind: "togglePin" });
    expect(noticeText()).toBe("Thread unpinned");

    act(() => current().setConnected(false));
    expect(noticeText()).toBe("Thread unpinned");
    await undo();
    expect(server.updateThreadMetadata).toHaveBeenCalledTimes(1);
    expect(thread(FIRST).pinned).toBe(false);
    expect(reports).toEqual([CONNECT_FIRST]);
    expect(notices).toEqual([
      { kind: "warning", message: "Undo failed. The thread was not restored.", action: null },
    ]);
  });

  it("undoes a section move on a server thread", async () => {
    await mount([record("t1", { pinned: true, sortOrder: 2 }), record("t2")]);

    await command(FIRST, { kind: "moveToSection", section: "active" });
    expect(thread(FIRST).pinned).toBe(false);
    expect(noticeText()).toBe("Thread unpinned");
    await undo();
    expect(thread(FIRST).pinned).toBe(true);
    expect(thread(FIRST).sortOrder).toBe(2);

    await command(SECOND, { kind: "moveToSection", section: "settled" });
    expect(thread(SECOND).settledAt).toEqual(expect.any(Number));
    expect(noticeText()).toBe("Thread settled");
    await undo();
    expect(thread(SECOND).settledAt).toBeNull();
    expect(noticeText()).toBeNull();
    expect(notices).toEqual([]);
  });

  it("fails closed when the server thread changed after the action", async () => {
    await mount([record("t1"), record("t2")]);
    await command(FIRST, { kind: "settle" });
    expect(noticeText()).toBe("Thread settled");

    await command(FIRST, { kind: "togglePin" });
    expect(thread(FIRST).pinned).toBe(true);
    expect(noticeText()).toBeNull();
    await undo();
    expect(server.updateThreadMetadata).toHaveBeenCalledTimes(2);
    expect(thread(FIRST).settledAt).toEqual(expect.any(Number));
    expect(notices).toEqual([]);
  });
});
