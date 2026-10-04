// @vitest-environment jsdom

import { StrictMode, act, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTasksNotice } from "../../application/agentThreadPorts";
import {
  useAgentThreadUndo,
  type AgentThreadUndoPorts,
  type AgentThreadUndoSurface,
} from "../../application/useAgentThreadUndo";
import { useAgentThreads, type AgentThreadsHookSurface } from "../../application/useAgentThreads";
import type { AgentThread } from "../../domain/agentThread";
import { agentThreadBulkOwnerKey } from "../../domain/agentThreadBulkAction";
import {
  AGENT_THREAD_UNDO_CONFIRM_MS,
  AGENT_THREAD_UNDO_VISIBLE_MS,
} from "../../domain/agentThreadUndo";
import { waitForReact } from "../../test/reactTestLifecycle";
import { AgentThreadUndoNotice } from "./AgentThreadUndoNotice";
import { agentProjectGroups } from "./agentModePresentation";
import { agentRailSections } from "./agentSidebarPresentation";
import {
  UNDO_FIXTURE_PROJECTS,
  undoStoredThread as storedThread,
  undoThreadDependencies,
  undoThreadGateways,
  type UndoThreadGateways,
} from "../../test/agentThreadUndoFixtures";
import {
  useAgentThreadMenuCommands,
  type AgentThreadMenuCommands,
} from "./useAgentThreadMenuCommands";
import { useAgentThreadUndoShortcut } from "./useAgentThreadUndoShortcut";

const HOUR_MS = 3_600_000;

interface Captured {
  readonly agents: AgentThreadsHookSurface;
  readonly menu: AgentThreadMenuCommands;
  readonly undo: AgentThreadUndoSurface;
  readonly selectedThreadId: string | null;
  select(threadId: string | null): void;
}

type UnarchiveResult = "reported" | "discarded" | "ignored";

function undoPorts(agents: AgentThreadsHookSurface, result: UnarchiveResult): AgentThreadUndoPorts {
  if (result === "reported") return agents;
  const unarchive = (threadId: string): void => {
    if (result === "ignored") return;
    agents.unarchive(threadId);
  };
  return {
    togglePin: agents.togglePin,
    updateThreadOrganization: agents.updateThreadOrganization,
    batchThreadMutations: agents.batchThreadMutations,
    unarchive,
  };
}

describe("thread action undo on local threads", () => {
  let host: HTMLDivElement;
  let outside: HTMLButtonElement;
  let root: Root;
  let captured: Captured | null;
  let notices: AgentTasksNotice[];
  let ownerKey: string;
  let gateways: UndoThreadGateways;
  let strict: boolean;
  let unarchiveResult: UnarchiveResult;

  function Harness() {
    const agents = useAgentThreads(undoThreadDependencies(gateways));
    const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
    const groups = useMemo(
      () => agentProjectGroups(UNDO_FIXTURE_PROJECTS, agents.threads, agents.orphanedWorktrees),
      [agents.orphanedWorktrees, agents.threads],
    );
    const undo = useAgentThreadUndo({
      ownerKey,
      threads: agents.threads,
      ports: undoPorts(agents, unarchiveResult),
      selectedThreadId,
      selectThread: setSelectedThreadId,
      reportNotice: (notice) => notices.push(notice),
    });
    const menu = useAgentThreadMenuCommands({
      agents,
      groups,
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
    const surfaceRef = useRef<HTMLElement | null>(null);
    useAgentThreadUndoShortcut(surfaceRef, undo.notification === null ? null : undo.undo, "linux");
    captured = { agents, menu, undo, selectedThreadId, select: setSelectedThreadId };
    return (
      <section ref={surfaceRef}>
        <button data-testid="row" type="button">
          Row
        </button>
        <input data-testid="input" />
        <textarea data-testid="textarea" />
        <div contentEditable data-testid="editable" suppressContentEditableWarning tabIndex={0} />
        <div className="monaco-editor">
          <button data-testid="editor" type="button">
            Editor
          </button>
        </div>
        <div className="xterm">
          <button data-testid="terminal" type="button">
            Terminal
          </button>
        </div>
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

  function tree() {
    if (!strict) return <Harness />;
    return (
      <StrictMode>
        <Harness />
      </StrictMode>
    );
  }

  function render(): void {
    act(() => root.render(tree()));
  }

  async function mount(storedThreads: ReadonlyArray<AgentThread>): Promise<void> {
    gateways = undoThreadGateways(storedThreads);
    render();
    await waitForReact(() => expect(current().agents.threads).toHaveLength(storedThreads.length));
    vi.useFakeTimers();
  }

  function thread(threadId: string): AgentThread {
    const view = current().agents.threads.find(
      (candidate) => candidate.thread.threadId === threadId,
    );
    expect(view).toBeDefined();
    return (view as { readonly thread: AgentThread }).thread;
  }

  function pinnedOrder(): ReadonlyArray<string> {
    return agentRailSections(current().agents.threads, Date.now()).pinned.map(
      (view) => view.thread.threadId,
    );
  }

  function activeOrder(): ReadonlyArray<string> {
    return agentRailSections(current().agents.threads, Date.now()).active.map(
      (view) => view.thread.threadId,
    );
  }

  function noticeText(): string | null {
    const region = host.querySelector('[data-slot="agent-thread-undo"]');
    expect(region).not.toBeNull();
    return region?.querySelector(".agent-notice > span")?.textContent ?? null;
  }

  function undoButton(): HTMLButtonElement {
    const button = [...host.querySelectorAll<HTMLButtonElement>(".agent-notice button")].find(
      (candidate) => candidate.textContent === "Undo",
    );
    expect(button).toBeDefined();
    return button as HTMLButtonElement;
  }

  async function settle(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
    });
  }

  async function clickUndo(): Promise<void> {
    await act(async () => {
      undoButton().click();
      await Promise.resolve();
    });
  }

  function pressUndo(target: Element, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    if (target instanceof HTMLElement) target.focus();
    act(() => {
      target.dispatchEvent(event);
    });
    return event;
  }

  function pointerDown(target: Element): void {
    act(() => {
      target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    });
  }

  function notice(): HTMLElement {
    const element = host.querySelector<HTMLElement>(".agent-notice");
    expect(element).not.toBeNull();
    return element as HTMLElement;
  }

  function hover(target: Element, entering: boolean): void {
    act(() => {
      target.dispatchEvent(
        new MouseEvent(entering ? "pointerover" : "pointerout", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
    });
  }

  function control(testId: string): HTMLElement {
    const element = host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    expect(element).not.toBeNull();
    return element as HTMLElement;
  }

  beforeEach(() => {
    host = document.createElement("div");
    outside = document.createElement("button");
    document.body.append(host, outside);
    root = createRoot(host);
    captured = null;
    notices = [];
    ownerKey = "/workspace/a";
    strict = false;
    unarchiveResult = "reported";
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    outside.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("restores an unpinned thread to its exact pinned position", async () => {
    await mount([
      storedThread("agt-a", { pinned: true, sortOrder: 0 }),
      storedThread("agt-b", { pinned: true, sortOrder: 1 }),
      storedThread("agt-c", { pinned: true, sortOrder: 2 }),
      storedThread("agt-d", { sortOrder: 0 }),
    ]);
    const before = thread("agt-b");
    expect(pinnedOrder()).toEqual(["agt-a", "agt-b", "agt-c"]);

    act(() => current().menu.handleThreadMenuCommand("agt-b", { kind: "togglePin" }));
    expect(pinnedOrder()).toEqual(["agt-a", "agt-c"]);
    expect(noticeText()).toBe("Thread unpinned");

    await clickUndo();
    expect(pinnedOrder()).toEqual(["agt-a", "agt-b", "agt-c"]);
    expect(thread("agt-b")).toEqual(before);
    expect(noticeText()).toBeNull();
    expect(notices).toEqual([]);
  });

  it("restores a settled thread to its active position and prior wake time", async () => {
    await mount([
      storedThread("agt-a", { sortOrder: 0 }),
      storedThread("agt-b", { sortOrder: 1, snoozedUntil: 1_000 }),
      storedThread("agt-c", { sortOrder: 2 }),
    ]);
    const before = thread("agt-b");
    expect(activeOrder()).toEqual(["agt-a", "agt-b", "agt-c"]);

    act(() => current().menu.handleThreadMenuCommand("agt-b", { kind: "settle" }));
    expect(thread("agt-b").settledAt).toEqual(expect.any(Number));
    expect(thread("agt-b").snoozedUntil).toBeNull();
    expect(activeOrder()).toEqual(["agt-a", "agt-c"]);
    expect(noticeText()).toBe("Thread settled");

    await clickUndo();
    expect(thread("agt-b")).toEqual({ ...before, settledAt: null });
    expect(activeOrder()).toEqual(["agt-a", "agt-b", "agt-c"]);
    expect(noticeText()).toBeNull();
  });

  it("restores a snoozed pinned thread to its pinned position without a wake time", async () => {
    await mount([
      storedThread("agt-a", { pinned: true, sortOrder: 0 }),
      storedThread("agt-b", { pinned: true, sortOrder: 1 }),
    ]);
    const before = thread("agt-a");
    const until = Date.now() + HOUR_MS;

    act(() => current().menu.handleThreadMenuCommand("agt-a", { kind: "snooze", until }));
    expect(thread("agt-a").snoozedUntil).toBe(until);
    expect(pinnedOrder()).toEqual(["agt-b"]);
    expect(noticeText()).toBe("Thread snoozed");

    await clickUndo();
    expect(thread("agt-a").snoozedUntil ?? null).toBeNull();
    expect(thread("agt-a").pinned).toBe(before.pinned);
    expect(thread("agt-a").sortOrder).toBe(before.sortOrder);
    expect(pinnedOrder()).toEqual(["agt-a", "agt-b"]);
  });

  it("restores the prior settled state when a settled thread was snoozed", async () => {
    await mount([storedThread("agt-a", { settledAt: 5_000 })]);
    const until = Date.now() + HOUR_MS;

    act(() => current().menu.handleThreadMenuCommand("agt-a", { kind: "snooze", until }));
    expect(thread("agt-a").settledAt ?? null).toBeNull();
    expect(noticeText()).toBe("Thread snoozed");

    await clickUndo();
    expect(thread("agt-a").settledAt).toBe(5_000);
    expect(thread("agt-a").snoozedUntil ?? null).toBeNull();
  });

  it("unarchives a thread and reselects it when it was being viewed", async () => {
    await mount([storedThread("agt-a", { pinned: true, sortOrder: 4 }), storedThread("agt-b")]);
    const before = thread("agt-a");
    act(() => current().select("agt-a"));

    act(() => current().menu.handleThreadMenuCommand("agt-a", { kind: "archive" }));
    expect(thread("agt-a").archived).toBe(true);
    expect(noticeText()).toBe("Thread archived");
    act(() => current().select("agt-b"));

    await clickUndo();
    expect(thread("agt-a")).toEqual(before);
    expect(pinnedOrder()).toEqual(["agt-a"]);
    expect(current().selectedThreadId).toBe("agt-a");
    expect(notices).toEqual([]);
  });

  it("leaves the selection alone when the archived thread was not being viewed", async () => {
    await mount([storedThread("agt-a"), storedThread("agt-b")]);
    act(() => current().select("agt-b"));
    act(() => current().menu.handleThreadMenuCommand("agt-a", { kind: "archive" }));

    await clickUndo();
    expect(thread("agt-a").archived).toBe(false);
    expect(current().selectedThreadId).toBe("agt-b");
  });

  it("undoes a bulk archive for every archived thread with a plural notice", async () => {
    await mount([storedThread("agt-a"), storedThread("agt-b"), storedThread("agt-c")]);
    const ownerKeys = new Map(
      ["agt-a", "agt-b"].map((threadId) => [
        threadId,
        agentThreadBulkOwnerKey(thread(threadId).owner),
      ]),
    );

    await act(async () => {
      current().menu.handleThreadBulkCommand({
        kind: "apply",
        request: { action: "archive", threadIds: ["agt-a", "agt-b"], missingIds: [], ownerKeys },
      });
      await Promise.resolve();
    });
    await settle();
    expect(thread("agt-a").archived).toBe(true);
    expect(thread("agt-b").archived).toBe(true);
    expect(noticeText()).toBe("2 threads archived");
    expect(notices).toEqual([]);

    await clickUndo();
    await settle();
    expect(thread("agt-a").archived).toBe(false);
    expect(thread("agt-b").archived).toBe(false);
    expect(thread("agt-c").archived).toBe(false);
    expect(noticeText()).toBeNull();
  });

  it("offers no undo for pin, restore, wake, reorder, or delete", async () => {
    await mount([
      storedThread("agt-a", { sortOrder: 0 }),
      storedThread("agt-b", { sortOrder: 1, settledAt: 5_000 }),
      storedThread("agt-c", { sortOrder: 2, snoozedUntil: Date.now() + HOUR_MS }),
      storedThread("agt-d", { sortOrder: 3 }),
    ]);

    act(() => current().menu.handleThreadMenuCommand("agt-a", { kind: "togglePin" }));
    expect(thread("agt-a").pinned).toBe(true);
    expect(noticeText()).toBeNull();
    act(() => current().menu.handleThreadMenuCommand("agt-b", { kind: "restore" }));
    expect(thread("agt-b").settledAt ?? null).toBeNull();
    expect(noticeText()).toBeNull();
    act(() => current().menu.handleThreadMenuCommand("agt-c", { kind: "unsnooze" }));
    expect(thread("agt-c").snoozedUntil ?? null).toBeNull();
    expect(noticeText()).toBeNull();
    act(() =>
      current().menu.handleThreadMenuCommand("agt-d", {
        kind: "moveBefore",
        targetThreadId: "agt-b",
      }),
    );
    expect(noticeText()).toBeNull();
    await act(async () => {
      current().menu.handleThreadMenuCommand("agt-d", { kind: "delete" });
      await Promise.resolve();
    });
    expect(current().agents.threads).toHaveLength(3);
    expect(noticeText()).toBeNull();
  });

  it("offers undo for a section move that only unpins or only settles", async () => {
    await mount([storedThread("agt-a", { pinned: true }), storedThread("agt-b")]);

    act(() =>
      current().menu.handleThreadMenuCommand("agt-a", { kind: "moveToSection", section: "active" }),
    );
    expect(noticeText()).toBe("Thread unpinned");
    act(() =>
      current().menu.handleThreadMenuCommand("agt-b", {
        kind: "moveToSection",
        section: "settled",
      }),
    );
    expect(noticeText()).toBe("Thread settled");

    await clickUndo();
    expect(thread("agt-b").settledAt ?? null).toBeNull();
    expect(thread("agt-a").pinned).toBe(false);
  });

  it("offers no undo for a section move that needs two writes", async () => {
    await mount([storedThread("agt-a", { pinned: true })]);

    act(() =>
      current().menu.handleThreadMenuCommand("agt-a", {
        kind: "moveToSection",
        section: "settled",
      }),
    );
    expect(thread("agt-a").pinned).toBe(false);
    expect(thread("agt-a").settledAt).toEqual(expect.any(Number));
    expect(noticeText()).toBeNull();
  });

  it("expires the offer after five seconds", async () => {
    await mount([storedThread("agt-a")]);
    act(() => current().menu.handleThreadMenuCommand("agt-a", { kind: "archive" }));
    expect(noticeText()).toBe("Thread archived");

    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_UNDO_VISIBLE_MS - 1);
    });
    expect(noticeText()).toBe("Thread archived");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(noticeText()).toBeNull();

    await act(async () => {
      current().undo.undo();
      await Promise.resolve();
    });
    pressUndo(control("row"));
    expect(thread("agt-a").archived).toBe(true);
  });

  it("dismisses the offer on explicit close", async () => {
    await mount([storedThread("agt-a")]);
    act(() => current().menu.handleThreadMenuCommand("agt-a", { kind: "archive" }));
    const close = host.querySelector<HTMLButtonElement>('button[aria-label="Dismiss undo notice"]');
    expect(close).not.toBeNull();

    act(() => close?.click());
    expect(noticeText()).toBeNull();
    await act(async () => {
      current().undo.undo();
      await Promise.resolve();
    });
    expect(thread("agt-a").archived).toBe(true);
  });

  it("replaces the previous offer with the newest action", async () => {
    await mount([storedThread("agt-a"), storedThread("agt-b")]);
    act(() => current().menu.handleThreadMenuCommand("agt-a", { kind: "archive" }));
    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_UNDO_VISIBLE_MS - 1_000);
    });
    act(() => current().menu.handleThreadMenuCommand("agt-b", { kind: "settle" }));
    expect(noticeText()).toBe("Thread settled");

    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_UNDO_VISIBLE_MS - 1_000);
    });
    expect(noticeText()).toBe("Thread settled");

    await clickUndo();
    expect(thread("agt-b").settledAt ?? null).toBeNull();
    expect(thread("agt-a").archived).toBe(true);
    expect(noticeText()).toBeNull();
  });

  it("applies an undo only once", async () => {
    await mount([storedThread("agt-a", { pinned: true })]);
    act(() => current().menu.handleThreadMenuCommand("agt-a", { kind: "togglePin" }));
    expect(thread("agt-a").pinned).toBe(false);

    await act(async () => {
      current().undo.undo();
      current().undo.undo();
      await Promise.resolve();
    });
    expect(thread("agt-a").pinned).toBe(true);
    await act(async () => {
      current().undo.undo();
      await Promise.resolve();
    });
    pressUndo(control("row"));
    expect(thread("agt-a").pinned).toBe(true);
  });

  it("drops the pending undo when the owning workspace changes, including A to B to A", async () => {
    await mount([storedThread("agt-a")]);
    act(() => current().menu.handleThreadMenuCommand("agt-a", { kind: "archive" }));
    expect(noticeText()).toBe("Thread archived");

    ownerKey = "/workspace/b";
    render();
    expect(noticeText()).toBeNull();
    ownerKey = "/workspace/a";
    render();
    expect(noticeText()).toBeNull();

    await act(async () => {
      current().undo.undo();
      await Promise.resolve();
    });
    pressUndo(control("row"));
    expect(thread("agt-a").archived).toBe(true);
    expect(notices).toEqual([]);
  });

  it("drops a capture taken under a previous workspace owner", async () => {
    await mount([storedThread("agt-a")]);
    const stale = current().undo.recorder.capture(["agt-a"]);
    ownerKey = "/workspace/b";
    render();
    ownerKey = "/workspace/a";
    render();

    act(() => {
      current().agents.archive("agt-a");
      current().undo.recorder.offer({ kind: "archive" }, stale);
    });
    expect(thread("agt-a").archived).toBe(true);
    expect(noticeText()).toBeNull();
  });

  it("fails closed when the thread changed after the action", async () => {
    await mount([storedThread("agt-a")]);
    act(() => current().menu.handleThreadMenuCommand("agt-a", { kind: "settle" }));
    expect(noticeText()).toBe("Thread settled");

    act(() => current().agents.togglePin("agt-a"));
    expect(noticeText()).toBeNull();
    await act(async () => {
      current().undo.undo();
      await Promise.resolve();
    });
    expect(thread("agt-a").settledAt).toEqual(expect.any(Number));
    expect(thread("agt-a").pinned).toBe(true);
    expect(notices).toEqual([]);
  });

  it("fails closed when the thread was deleted after the action", async () => {
    await mount([storedThread("agt-a"), storedThread("agt-b")]);
    act(() => current().menu.handleThreadMenuCommand("agt-a", { kind: "archive" }));
    expect(noticeText()).toBe("Thread archived");

    await act(async () => {
      expect(current().agents.remove("agt-a")).toBe(true);
      await Promise.resolve();
    });
    expect(noticeText()).toBeNull();
    await act(async () => {
      current().undo.undo();
      await Promise.resolve();
    });
    expect(current().agents.threads.map((view) => view.thread.threadId)).toEqual(["agt-b"]);
    expect(notices).toEqual([]);
  });

  it("never shows an offer for an action that did not take effect", async () => {
    await mount([storedThread("agt-a")]);
    const captureBefore = current().undo.recorder.capture(["agt-a"]);

    act(() => current().undo.recorder.offer({ kind: "archive" }, captureBefore));
    expect(noticeText()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_UNDO_CONFIRM_MS);
    });
    act(() => {
      current().agents.archive("agt-a");
    });
    expect(thread("agt-a").archived).toBe(true);
    expect(noticeText()).toBeNull();
  });

  it("undoes with Ctrl+Z from the thread surface and consumes the key", async () => {
    await mount([storedThread("agt-a")]);
    act(() => current().menu.handleThreadMenuCommand("agt-a", { kind: "archive" }));

    const event = pressUndo(control("row"));
    await settle();
    expect(event.defaultPrevented).toBe(true);
    expect(thread("agt-a").archived).toBe(false);
    expect(noticeText()).toBeNull();
  });

  it("undoes with Ctrl+Z from an unfocused page when the last interaction was in the thread surface", async () => {
    await mount([storedThread("agt-a")]);
    pointerDown(control("row"));
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.append(menu);
    pointerDown(menu);
    menu.remove();
    act(() => current().menu.handleThreadMenuCommand("agt-a", { kind: "archive" }));
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    const event = pressUndo(document.body);
    await settle();
    expect(event.defaultPrevented).toBe(true);
    expect(thread("agt-a").archived).toBe(false);
  });

  it("leaves Ctrl+Z alone on an unfocused page when the last interaction was outside the thread surface", async () => {
    await mount([storedThread("agt-a")]);
    pointerDown(control("row"));
    act(() => current().menu.handleThreadMenuCommand("agt-a", { kind: "archive" }));
    pointerDown(outside);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    const event = pressUndo(document.body);
    await settle();
    expect(event.defaultPrevented).toBe(false);
    expect(thread("agt-a").archived).toBe(true);
    expect(noticeText()).toBe("Thread archived");
  });

  it("leaves Ctrl+Z alone on an unfocused page before any interaction with the thread surface", async () => {
    await mount([storedThread("agt-a")]);
    act(() => current().menu.handleThreadMenuCommand("agt-a", { kind: "archive" }));
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    expect(pressUndo(document.body).defaultPrevented).toBe(false);
    expect(thread("agt-a").archived).toBe(true);
  });

  it.each(["input", "textarea", "editable", "editor", "terminal"])(
    "leaves Ctrl+Z to a focused %s",
    async (testId) => {
      await mount([storedThread("agt-a")]);
      act(() => current().menu.handleThreadMenuCommand("agt-a", { kind: "archive" }));

      const event = pressUndo(control(testId));
      await settle();
      expect(event.defaultPrevented).toBe(false);
      expect(thread("agt-a").archived).toBe(true);
      expect(noticeText()).toBe("Thread archived");
    },
  );

  it("ignores Ctrl+Z outside the thread surface, with other modifiers, and while a dialog is open", async () => {
    await mount([storedThread("agt-a")]);
    act(() => current().menu.handleThreadMenuCommand("agt-a", { kind: "archive" }));

    expect(pressUndo(outside).defaultPrevented).toBe(false);
    expect(pressUndo(control("row"), { shiftKey: true }).defaultPrevented).toBe(false);
    expect(pressUndo(control("row"), { altKey: true }).defaultPrevented).toBe(false);
    expect(pressUndo(control("row"), { ctrlKey: false, metaKey: true }).defaultPrevented).toBe(
      false,
    );
    expect(pressUndo(control("row"), { key: "y" }).defaultPrevented).toBe(false);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.append(dialog);
    expect(pressUndo(control("row")).defaultPrevented).toBe(false);
    dialog.remove();
    await settle();
    expect(thread("agt-a").archived).toBe(true);
    expect(noticeText()).toBe("Thread archived");
  });

  it("does not claim Ctrl+Z when no undo is pending", async () => {
    await mount([storedThread("agt-a")]);
    expect(pressUndo(control("row")).defaultPrevented).toBe(false);
  });

  it("keeps the live offer when a later action is refused", async () => {
    await mount([storedThread("agt-a"), storedThread("agt-b")]);
    act(() => current().menu.handleThreadMenuCommand("agt-a", { kind: "archive" }));
    expect(noticeText()).toBe("Thread archived");

    act(() => current().menu.handleThreadMenuCommand("agt-b", { kind: "snooze", until: -5 }));
    expect(thread("agt-b").snoozedUntil ?? null).toBeNull();
    expect(noticeText()).toBe("Thread archived");
    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_UNDO_VISIBLE_MS - 1);
    });
    expect(noticeText()).toBe("Thread archived");

    await clickUndo();
    expect(thread("agt-a").archived).toBe(false);
    expect(thread("agt-b").snoozedUntil ?? null).toBeNull();
    expect(notices).toEqual([]);
  });

  it("keeps the live offer when a later action does not change the thread", async () => {
    await mount([storedThread("agt-a"), storedThread("agt-b", { settledAt: 5_000 })]);
    act(() => current().menu.handleThreadMenuCommand("agt-a", { kind: "archive" }));

    act(() => current().menu.handleThreadMenuCommand("agt-b", { kind: "settle" }));
    act(() => current().menu.handleThreadMenuCommand("agt-b", { kind: "togglePin" }));
    expect(thread("agt-b").pinned).toBe(true);
    expect(noticeText()).toBe("Thread archived");

    await clickUndo();
    expect(thread("agt-a").archived).toBe(false);
    expect(thread("agt-b").pinned).toBe(true);
  });

  it("restores the exact pinned slot after other threads were reordered and pinned", async () => {
    await mount([
      storedThread("agt-a", { pinned: true, sortOrder: 0 }),
      storedThread("agt-b", { pinned: true, sortOrder: 1 }),
      storedThread("agt-c", { pinned: true, sortOrder: 2 }),
      storedThread("agt-d", { sortOrder: 3 }),
    ]);
    const before = thread("agt-b");
    act(() => current().menu.handleThreadMenuCommand("agt-b", { kind: "togglePin" }));
    expect(noticeText()).toBe("Thread unpinned");

    act(() =>
      current().menu.handleThreadMenuCommand("agt-c", {
        kind: "moveBefore",
        targetThreadId: "agt-a",
      }),
    );
    act(() => current().menu.handleThreadMenuCommand("agt-d", { kind: "togglePin" }));
    expect(pinnedOrder()).toEqual(["agt-c", "agt-a", "agt-d"]);
    expect(noticeText()).toBe("Thread unpinned");

    await clickUndo();
    expect(thread("agt-b")).toEqual(before);
    expect(pinnedOrder()).toEqual(["agt-c", "agt-a", "agt-b", "agt-d"]);
    expect(notices).toEqual([]);
  });

  it("keeps the bulk report when it says more than the undo notice", async () => {
    await mount([storedThread("agt-a"), storedThread("agt-b")]);
    const ownerKeys = new Map([["agt-a", agentThreadBulkOwnerKey(thread("agt-a").owner)]]);

    await act(async () => {
      current().menu.handleThreadBulkCommand({
        kind: "apply",
        request: { action: "archive", threadIds: ["agt-a"], missingIds: ["agt-gone"], ownerKeys },
      });
      await Promise.resolve();
    });
    await settle();
    expect(noticeText()).toBe("Thread archived");
    expect(notices).toEqual([
      {
        kind: "info",
        message: "Archived 1 thread. Skipped 1: 1 no longer in this list.",
        action: null,
      },
    ]);
  });

  it("pauses the five second window while the notice is hovered", async () => {
    await mount([storedThread("agt-a")]);
    act(() => current().menu.handleThreadMenuCommand("agt-a", { kind: "archive" }));
    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_UNDO_VISIBLE_MS - 1_000);
    });

    hover(notice(), true);
    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_UNDO_VISIBLE_MS * 4);
    });
    expect(noticeText()).toBe("Thread archived");

    hover(notice(), false);
    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_UNDO_VISIBLE_MS - 1);
    });
    expect(noticeText()).toBe("Thread archived");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(noticeText()).toBeNull();
    expect(thread("agt-a").archived).toBe(true);
  });

  it("pauses the five second window while focus is inside the notice", async () => {
    await mount([storedThread("agt-a")]);
    act(() => current().menu.handleThreadMenuCommand("agt-a", { kind: "archive" }));
    const close = host.querySelector<HTMLButtonElement>('button[aria-label="Dismiss undo notice"]');
    expect(close).not.toBeNull();

    act(() => undoButton().focus());
    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_UNDO_VISIBLE_MS * 4);
    });
    expect(noticeText()).toBe("Thread archived");
    act(() => close?.focus());
    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_UNDO_VISIBLE_MS * 4);
    });
    expect(noticeText()).toBe("Thread archived");

    act(() => control("row").focus());
    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_UNDO_VISIBLE_MS - 1);
    });
    expect(noticeText()).toBe("Thread archived");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(noticeText()).toBeNull();
  });

  it("keeps the pause when the hovered offer is replaced by a newer one", async () => {
    await mount([storedThread("agt-a"), storedThread("agt-b")]);
    act(() => current().menu.handleThreadMenuCommand("agt-a", { kind: "archive" }));
    hover(notice(), true);
    act(() => current().menu.handleThreadMenuCommand("agt-b", { kind: "settle" }));
    expect(noticeText()).toBe("Thread settled");

    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_UNDO_VISIBLE_MS * 4);
    });
    expect(noticeText()).toBe("Thread settled");
    hover(notice(), false);
    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_UNDO_VISIBLE_MS - 1);
    });
    expect(noticeText()).toBe("Thread settled");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(noticeText()).toBeNull();
  });

  it("does not leave a pause behind for an offer that appears after the hovered one went away", async () => {
    await mount([storedThread("agt-a"), storedThread("agt-b")]);
    act(() => current().menu.handleThreadMenuCommand("agt-a", { kind: "archive" }));
    hover(notice(), true);
    act(() => current().undo.dismiss());
    expect(noticeText()).toBeNull();

    act(() => current().menu.handleThreadMenuCommand("agt-b", { kind: "settle" }));
    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_UNDO_VISIBLE_MS);
    });
    expect(noticeText()).toBeNull();
  });

  it("does not reselect when the owner changes in the same commit that shows the restore", async () => {
    unarchiveResult = "discarded";
    await mount([storedThread("agt-a"), storedThread("agt-b")]);
    act(() => current().select("agt-a"));
    act(() => current().menu.handleThreadMenuCommand("agt-a", { kind: "archive" }));
    act(() => current().select("agt-b"));

    await act(async () => {
      ownerKey = "/workspace/b";
      current().undo.undo();
      root.render(tree());
      await Promise.resolve();
    });
    expect(thread("agt-a").archived).toBe(false);
    expect(current().selectedThreadId).toBe("agt-b");
    expect(noticeText()).toBeNull();
    expect(notices).toEqual([]);
  });

  it("confirms a restore by observation when the port returns no result", async () => {
    unarchiveResult = "discarded";
    await mount([storedThread("agt-a"), storedThread("agt-b")]);
    act(() => current().select("agt-a"));
    act(() => current().menu.handleThreadMenuCommand("agt-a", { kind: "archive" }));
    act(() => current().select("agt-b"));

    await clickUndo();
    expect(thread("agt-a").archived).toBe(false);
    expect(current().selectedThreadId).toBe("agt-a");
    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_UNDO_CONFIRM_MS);
    });
    expect(notices).toEqual([]);
  });

  it("reports a failed undo when a port without a result never restores the thread", async () => {
    unarchiveResult = "ignored";
    await mount([storedThread("agt-a")]);
    act(() => current().menu.handleThreadMenuCommand("agt-a", { kind: "archive" }));

    await clickUndo();
    expect(thread("agt-a").archived).toBe(true);
    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_UNDO_CONFIRM_MS - 1);
    });
    expect(notices).toEqual([]);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(notices).toEqual([
      { kind: "warning", message: "Undo failed. The thread was not restored.", action: null },
    ]);
  });

  it("behaves the same under StrictMode double mounting", async () => {
    strict = true;
    await mount([storedThread("agt-a", { pinned: true }), storedThread("agt-b")]);

    act(() => current().menu.handleThreadMenuCommand("agt-a", { kind: "togglePin" }));
    expect(noticeText()).toBe("Thread unpinned");
    await clickUndo();
    expect(thread("agt-a").pinned).toBe(true);
    expect(noticeText()).toBeNull();

    act(() => current().menu.handleThreadMenuCommand("agt-b", { kind: "archive" }));
    expect(noticeText()).toBe("Thread archived");
    pressUndo(control("row"));
    await settle();
    expect(thread("agt-b").archived).toBe(false);

    act(() => current().menu.handleThreadMenuCommand("agt-b", { kind: "archive" }));
    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_UNDO_VISIBLE_MS);
    });
    expect(noticeText()).toBeNull();
    expect(thread("agt-b").archived).toBe(true);
    expect(notices).toEqual([]);
  });

  it("clears its timers on unmount and never fires afterwards", async () => {
    await mount([storedThread("agt-a")]);
    const scheduled = vi.spyOn(globalThis, "setTimeout");
    const cleared = vi.spyOn(globalThis, "clearTimeout");
    act(() => current().menu.handleThreadMenuCommand("agt-a", { kind: "archive" }));
    expect(noticeText()).toBe("Thread archived");
    const undoSurface = current().undo;
    const agents = current().agents;
    const offerTimers = scheduled.mock.results
      .filter((_result, index) => scheduled.mock.calls[index]?.[1] === AGENT_THREAD_UNDO_VISIBLE_MS)
      .map((result) => result.value as unknown);
    expect(offerTimers).toHaveLength(1);

    act(() => root.unmount());
    const clearedTimers = cleared.mock.calls.map((call) => call[0] as unknown);
    expect(clearedTimers).toEqual(expect.arrayContaining(offerTimers));

    const saves = gateways.agentThreadStoreGateway.saveAgentThread.mock.calls.length;
    vi.advanceTimersByTime(AGENT_THREAD_UNDO_CONFIRM_MS * 2);
    undoSurface.undo();
    await Promise.resolve();
    expect(agents.threads.find((view) => view.thread.threadId === "agt-a")?.thread.archived).toBe(
      true,
    );
    expect(gateways.agentThreadStoreGateway.saveAgentThread.mock.calls.length).toBe(saves);
    expect(notices).toEqual([]);
    root = createRoot(host);
  });
});
