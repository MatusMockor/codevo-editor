// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentThread } from "../../domain/agentThread";
import type { AgentTurnEvent } from "../../domain/agentThread";
import { agentThreadAttention, agentThreadUnread } from "../../domain/agentThread";
import { AgentClockProvider } from "./agentClock";
import type { AgentPendingInteraction } from "../../domain/agentPendingInteraction";
import { AgentThreadRow, type AgentThreadRowProps } from "./AgentThreadRow";
import { AgentThreadBranchMemoryContext } from "./agentThreadBranchMemoryContext";
import {
  EMPTY_AGENT_THREAD_BRANCH_MEMORY,
  rememberAgentThreadBranch,
  type AgentThreadBranchMemory,
} from "../../domain/agentThreadBranchMemory";
import { AgentRowServerNamesContext } from "./agentRowServerNamesContext";
import { AGENT_FOREGROUND_QUIESCENCE_MS } from "./useAgentBackgroundActivity";

const ROOT = "/workspace/app";
const NOW = 1_700_000_600_000;
const SESSION_ID = "34fbe185-1a2b-4c3d-8e4f-5a6b7c8d9e0f";

describe("AgentThreadRow", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers({
      toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"],
    });
    vi.setSystemTime(NOW);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  const render = (
    view: AgentThreadView,
    pending: AgentPendingInteraction | null = null,
    onMenuCommand: AgentThreadRowProps["onMenuCommand"] = () => undefined,
    focused = false,
  ): void => {
    act(() => {
      root.render(
        <AgentClockProvider>
          <ul role="listbox">
            <AgentThreadRow
              focused={focused}
              jumpLabel={null}
              on={false}
              onMenuCommand={onMenuCommand}
              onSelect={() => undefined}
              pending={pending}
              projectLabel="app"
              selected={false}
              view={view}
            />
          </ul>
        </AgentClockProvider>,
      );
    });
  };

  const menuItem = (label: string): HTMLButtonElement => {
    const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (candidate) => candidate.textContent === label,
    );
    expect(item).toBeDefined();
    return item as HTMLButtonElement;
  };

  const openContextMenu = (): void => {
    act(() => {
      host.querySelector(".cv-card-row")?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 5,
          clientY: 5,
        }),
      );
    });
  };

  it("opens the context menu from the keyboard and returns focus to the row", async () => {
    render(viewedDone(), null, () => undefined, true);
    const row = host.querySelector<HTMLElement>(".cv-card-row");
    expect(row).not.toBeNull();
    act(() => row?.focus());
    act(() => {
      row?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "F10",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    const menu = document.querySelector<HTMLElement>('[role="menu"][aria-label="Thread actions"]');
    expect(menu).not.toBeNull();
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(row);
    act(() => {
      row?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true, cancelable: true }),
      );
    });
    expect(document.querySelector('[role="menu"][aria-label="Thread actions"]')).not.toBeNull();
  });

  it("asks for confirmation before deleting", () => {
    const onMenuCommand = vi.fn();
    render(viewedDone(), null, onMenuCommand);
    openContextMenu();
    act(() => menuItem("Delete").click());
    expect(onMenuCommand).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Delete thread?");
    const confirm = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Delete thread",
    );
    act(() => confirm?.click());
    expect(onMenuCommand).toHaveBeenCalledWith("agt-1", { kind: "delete" });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("snoozes until a custom date from the dialog", () => {
    const onMenuCommand = vi.fn();
    render(viewedDone(), null, onMenuCommand);
    openContextMenu();
    act(() => menuItem("Snooze").click());
    act(() => menuItem("Choose date and time…").click());
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Snooze until"]');
    expect(input).not.toBeNull();
    const snooze = (): HTMLButtonElement | undefined =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
        (button) => button.textContent === "Snooze",
      );
    expect(snooze()?.disabled).toBe(true);
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "2099-01-02T03:04");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(snooze()?.disabled).toBe(false);
    act(() => snooze()?.click());
    expect(onMenuCommand).toHaveBeenCalledWith("agt-1", {
      kind: "snooze",
      until: new Date("2099-01-02T03:04").getTime(),
    });
  });

  it("moves the thread to a section from Move to", () => {
    const onMenuCommand = vi.fn();
    render(viewedDone(), null, onMenuCommand);
    openContextMenu();
    act(() => menuItem("Move to").click());
    const settled = [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find(
      (item) => item.textContent === "Settled",
    );
    act(() => settled?.click());
    expect(onMenuCommand).toHaveBeenCalledWith("agt-1", {
      kind: "moveToSection",
      section: "settled",
    });
  });

  it("offers ending the Claude session for an idle local Claude thread", () => {
    const onMenuCommand = vi.fn();
    render(viewedDone(), null, onMenuCommand);
    openContextMenu();
    act(() => menuItem("End Claude session").click());
    expect(onMenuCommand).toHaveBeenCalledWith("agt-1", { kind: "endSession" });
  });

  it("never offers ending a Claude session for a server or Codex thread", () => {
    const local = viewedDone();
    const labels = (): ReadonlyArray<string> =>
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map(
        (item) => item.textContent ?? "",
      );
    render({
      ...local,
      execution: {
        kind: "remote",
        serverId: "server-1",
        runnerId: "runner-1",
        projectId: "project-1",
        conversationId: "conversation-1",
        latestTaskId: "task-1",
        resume: null,
      },
    });
    openContextMenu();
    expect(labels()).toContain("Rename thread");
    expect(labels()).not.toContain("End Claude session");
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    render({
      ...local,
      thread: { ...local.thread, provider: { kind: "codex", sessionId: null } },
    });
    openContextMenu();
    expect(labels()).toContain("Rename thread");
    expect(labels()).not.toContain("End Claude session");
  });

  const line1 = (): HTMLElement => {
    const element = host.querySelector<HTMLElement>(".cv-card-row__l1");
    expect(element).not.toBeNull();
    return element as HTMLElement;
  };

  it("adds only a server indicator to the existing thread row", () => {
    const local = pinnedDone();
    render(local);
    const title = host.querySelector(".cv-card-row__title")?.textContent;
    expect(host.querySelector('[aria-label="Runs on server"]')).toBeNull();
    render({
      ...local,
      execution: {
        kind: "remote",
        serverId: "server-1",
        runnerId: "runner-1",
        projectId: "project-1",
        conversationId: "conversation-1",
        latestTaskId: "task-1",
        resume: null,
      },
    });
    expect(host.querySelector('[role="img"][aria-label="Runs on server"]')).not.toBeNull();
    expect(host.querySelector(".cv-card-row__title")?.textContent).toBe(title);
    expect(line1().querySelector('.cv-card-row__status[data-tone="ok"]')).not.toBeNull();
  });

  it("keeps background monitoring stoppable and unarchivable until the process exits", () => {
    const base = pinnedDone();
    const turn = base.thread.turns[0]!;
    render({
      ...base,
      thread: {
        ...base.thread,
        turns: [
          {
            ...turn,
            status: { kind: "running" },
            endedAtEpochMs: null,
            events: [
              {
                kind: "backgroundTask",
                taskId: "monitor-1",
                taskType: "monitor",
                status: "starting",
              },
              { kind: "result", text: "Watching pipeline", isError: false, usage: null },
            ],
          },
        ],
      },
    });
    expect(host.querySelector(".cv-card-row__status-label")?.textContent).toBe("Monitoring");
    const row = host.querySelector<HTMLElement>('[role="option"]')!;
    expect(row.classList.contains("is-live")).toBe(true);
    expect(host.querySelector('[aria-label="Settle thread"]')).toBeNull();
    act(() => row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })));
    expect(menuItem("Stop agent")).toBeDefined();
    expect(menuItem("Archive thread").getAttribute("aria-disabled")).toBe("true");
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    render(base);
    expect(host.querySelector(".cv-card-row__status-label")?.textContent).toBe("Done");
    expect(host.querySelector('[role="option"]')?.classList.contains("is-live")).toBe(false);
  });

  it("puts the pin glyph before the Done status on a pinned unread thread", () => {
    render(pinnedDone());

    const pin = line1().querySelector(".cv-card-row__pin");
    const status = line1().querySelector('.cv-card-row__status[data-tone="ok"]');
    expect(pin).not.toBeNull();
    expect(status).not.toBeNull();
    if (pin === null || status === null) return;
    expect(status.textContent).toBe("Done");
    expect(pin.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("shows the relative time instead of Done once the thread has been viewed", () => {
    render(viewedDone());

    expect(host.querySelector(".cv-card-row__status")).toBeNull();
    expect(line1().querySelector(".cv-card-row__when")?.textContent).toBe("2m");
  });

  it("marks an imported thread on the card, archived or not, and leaves plain threads unbadged", () => {
    render(pinnedDone());
    expect(host.querySelector(".agent-microlabel")).toBeNull();

    render(importedView({ archived: false }));
    const line3 = host.querySelector<HTMLElement>(".cv-card-row__l3");
    const badge = line3?.querySelector<HTMLElement>(".agent-microlabel") ?? null;
    expect(badge?.textContent).toBe("Imported");
    expect(badge?.title).toBe("Imported terminal session");

    render(importedView({ archived: true }));
    expect(host.querySelector(".agent-row--slim")).toBeNull();
    expect(host.querySelector(".cv-card-row__l3 .agent-microlabel")?.textContent).toBe("Imported");
  });

  it("leads line three with the checkout glyph and then the branch, without a provider glyph", () => {
    render(pinnedDone());

    const line3 = host.querySelector<HTMLElement>(".cv-card-row__l3");
    expect(line3?.firstElementChild?.classList.contains("cv-card-row__glyph")).toBe(true);
    expect(line3?.children[1]?.classList.contains("cv-card-row__branch")).toBe(true);
    expect(line3?.querySelector('[aria-label="Claude Code"]')).toBeNull();
  });

  const renderLocated = (
    view: AgentThreadView,
    options: {
      readonly memory?: AgentThreadBranchMemory;
      readonly servers?: ReadonlyArray<{ readonly id: string; readonly name: string }>;
    } = {},
  ): void => {
    const row = (
      <AgentThreadBranchMemoryContext.Provider
        value={options.memory ?? EMPTY_AGENT_THREAD_BRANCH_MEMORY}
      >
        <AgentClockProvider>
          <ul role="listbox">
            <AgentThreadRow
              focused={false}
              jumpLabel={null}
              on={false}
              onMenuCommand={() => undefined}
              onSelect={() => undefined}
              pending={null}
              projectLabel="app"
              selected={false}
              view={view}
            />
          </ul>
        </AgentClockProvider>
      </AgentThreadBranchMemoryContext.Provider>
    );
    const servers = options.servers;
    act(() => {
      root.render(
        servers === undefined ? (
          row
        ) : (
          <AgentRowServerNamesContext.Provider
            value={new Map(servers.map((server) => [server.id, server.name]))}
          >
            {row}
          </AgentRowServerNamesContext.Provider>
        ),
      );
    });
  };

  const token = (): { readonly glyph: string | null; readonly label: string | null } => {
    const line3 = host.querySelector<HTMLElement>(".cv-card-row__l3");
    return {
      glyph: line3?.querySelector(".cv-card-row__glyph")?.getAttribute("data-glyph") ?? null,
      label: line3?.querySelector(".cv-card-row__branch")?.textContent ?? null,
    };
  };

  it("labels an in-place thread by its remembered branch, else Local checkout", () => {
    const base = viewedDone();
    const view: AgentThreadView = {
      ...base,
      thread: { ...base.thread, target: { isolation: "in-place", worktreePath: null } },
    };
    renderLocated(view);
    expect(token()).toEqual({ glyph: "localCheckout", label: "Local checkout" });

    const memory = rememberAgentThreadBranch(
      EMPTY_AGENT_THREAD_BRANCH_MEMORY,
      { threadId: "agt-1", rootKey: ROOT, ownerId: `agent-root:${ROOT}` },
      "feature/invoices",
    );
    renderLocated(view, { memory });
    expect(token()).toEqual({ glyph: "localCheckout", label: "feature/invoices" });
    expect(host.querySelector(".cv-card-row__l3")?.getAttribute("title")).toBe(
      "Local checkout · feature/invoices",
    );

    const foreignOwner = rememberAgentThreadBranch(
      EMPTY_AGENT_THREAD_BRANCH_MEMORY,
      { threadId: "agt-1", rootKey: ROOT, ownerId: "agent-root:other" },
      "feature/other",
    );
    renderLocated(view, { memory: foreignOwner });
    expect(token()).toEqual({ glyph: "localCheckout", label: "Local checkout" });
  });

  it("labels a worktree thread by its worktree branch, else Worktree", () => {
    renderLocated(viewedDone());
    expect(token()).toEqual({ glyph: "worktree", label: "Worktree" });
    renderLocated({
      ...viewedDone(),
      ship: {
        kind: "idle",
        loadingStatus: false,
        status: {
          worktree: { branch: "agent/agt-1", head: "a".repeat(40), dirty: false, changeCount: 0 },
          primary: { branch: "main", head: "b".repeat(40), dirty: false },
          relation: { aheadOfPrimary: 1, behindPrimary: 0, fastForwardable: true },
          remote: null,
        },
      },
    });
    expect(token()).toEqual({ glyph: "worktree", label: "agent/agt-1" });
  });

  it("names the server on line one and the server checkout on line three of a remote thread", () => {
    const base = viewedDone();
    const view: AgentThreadView = {
      ...base,
      thread: { ...base.thread, target: { isolation: "in-place", worktreePath: null } },
      execution: {
        kind: "remote",
        serverId: "server-1",
        runnerId: "runner-1",
        projectId: "project-1",
        conversationId: "conversation-1",
        latestTaskId: "task-1",
        resume: null,
      },
    };
    renderLocated(view, { servers: [{ id: "server-1", name: "build-box" }] });
    expect(line1().querySelector(".cv-card-row__project")?.textContent).toBe("build-box · app");
    expect(token()).toEqual({ glyph: "server", label: "Server checkout" });
    expect(
      host.querySelector('[role="img"][aria-label="Runs on server"]')?.getAttribute("title"),
    ).toBe("Runs on build-box");

    renderLocated(view);
    expect(line1().querySelector(".cv-card-row__project")?.textContent).toBe("Server · app");
    expect(host.textContent?.toLowerCase()).not.toContain("in place");
  });

  it("renders the mockup card: monogram, project, title, branch, relative time and a hover Settle action", () => {
    const onMenuCommand = vi.fn();
    render(viewedDone(), null, onMenuCommand);
    const row = host.querySelector(".cv-card-row");
    expect(row?.querySelector(".cv-favicon")?.textContent).toBe("A");
    expect(row?.querySelector(".cv-card-row__project")?.textContent).toBe("app");
    expect(row?.querySelector(".cv-card-row__title")?.textContent).toBe(
      "Extract the invoice totals",
    );
    expect(row?.querySelector(".cv-card-row__branch")?.textContent).toBe("Worktree");
    const settle = host.querySelector<HTMLButtonElement>('button[aria-label="Settle thread"]');
    expect(settle).not.toBeNull();
    act(() => settle?.click());
    expect(onMenuCommand).toHaveBeenCalledWith("agt-1", { kind: "settle" });
  });

  it("shows Approval and Input for a running thread waiting on the user", () => {
    render(runningWith([]), "approval");
    const status = host.querySelector(".cv-card-row__status");
    expect(status?.textContent).toContain("Approval");
    expect(status?.getAttribute("data-tone")).toBe("warn");
    expect(status?.getAttribute("title")).toBe("Waiting for your approval");
    render(runningWith([]), "input");
    expect(host.querySelector(".cv-card-row__status")?.textContent).toContain("Input");
  });

  it("ticks the working time as a coarse t3code duration", () => {
    render(runningWith([]));
    expect(host.querySelector(".cv-card-row__tick")?.textContent).toBe("10m");
    act(() => vi.advanceTimersByTime(59_000));
    expect(host.querySelector(".cv-card-row__tick")?.textContent).toBe("10m");
    act(() => vi.advanceTimersByTime(1_000));
    expect(host.querySelector(".cv-card-row__tick")?.textContent).toBe("11m");
  });

  it("counts the running subagents of the running turn", () => {
    const base = runningWith([]);
    const turn = base.thread.turns[0]!;
    render({
      ...base,
      thread: {
        ...base.thread,
        turns: [
          {
            ...turn,
            subagentLifecycle: {
              truncated: false,
              entries: [
                { id: "thread:a", name: "a", description: "", state: "running" },
                { id: "thread:b", name: "b", description: "", state: "running" },
                { id: "thread:c", name: "c", description: "", state: "completed" },
              ],
            },
          },
        ],
      },
    });
    const status = host.querySelector(".cv-card-row__status");
    expect(status?.querySelector(".cv-card-row__status-label")?.textContent).toBe(
      "2 agents running",
    );
    expect(status?.querySelector(".cv-card-row__tick")?.textContent).toBe("10m");
    expect(status?.getAttribute("title")).toBe("Working with 2 agents");
  });

  it("keeps a settled thread running with a ticking timer while its resumed agent works", () => {
    const settled = viewedDone();
    render({
      ...settled,
      sessionBackground: {
        ownerId: settled.thread.owner.ownerId,
        total: 1,
        agents: 1,
        tasks: [
          {
            taskId: "a4b355dcf6056a875",
            taskType: "agent",
            description: "Live Codex model catalog like Claude",
          },
        ],
        sinceEpochMs: NOW - 90_000,
        taskSinceEpochMs: new Map(),
      },
    });
    const status = host.querySelector(".cv-card-row__status");
    expect(status?.querySelector(".cv-card-row__status-label")?.textContent).toBe(
      "1 agent running",
    );
    expect(status?.querySelector(".cv-card-row__tick")?.textContent).toBe("1m");
    expect(status?.getAttribute("title")).toBe("Waiting for 1 agent");
    act(() => vi.advanceTimersByTime(30_000));
    expect(status?.querySelector(".cv-card-row__tick")?.textContent).toBe("2m");
    render(settled);
    expect(host.querySelector(".cv-card-row__tick")).toBeNull();
  });

  const renameInput = (): HTMLInputElement => {
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Rename thread"]');
    expect(input).not.toBeNull();
    return input as HTMLInputElement;
  };

  const pressInRename = (key: string): void => {
    act(() => {
      renameInput().dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    });
  };

  it("returns focus to the row when a menu-started rename is committed with Enter", async () => {
    const commands: unknown[] = [];
    render(viewedDone(), null, (_id, command) => commands.push(command), true);
    const row = host.querySelector<HTMLElement>(".cv-card-row");
    openContextMenu();
    act(() => menuItem("Rename thread").click());
    await act(async () => {
      await Promise.resolve();
    });
    const input = renameInput();
    expect(document.activeElement).toBe(input);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "Renamed",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    pressInRename("Enter");
    expect(host.querySelector('input[aria-label="Rename thread"]')).toBeNull();
    expect(document.activeElement).toBe(row);
    expect(commands).toContainEqual({ kind: "rename", title: "Renamed" });
  });

  it("returns focus to the row when a double-click rename is cancelled with Escape", () => {
    render(viewedDone(), null, () => undefined, true);
    const row = host.querySelector<HTMLElement>(".cv-card-row");
    act(() => {
      row?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(document.activeElement).toBe(renameInput());
    pressInRename("Escape");
    expect(host.querySelector('input[aria-label="Rename thread"]')).toBeNull();
    expect(document.activeElement).toBe(row);
  });

  it("returns focus to the row when a rename is committed by blur without a new focus target", () => {
    render(viewedDone(), null, () => undefined, true);
    const row = host.querySelector<HTMLElement>(".cv-card-row");
    act(() => {
      row?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    act(() => renameInput().blur());
    expect(host.querySelector('input[aria-label="Rename thread"]')).toBeNull();
    expect(document.activeElement).toBe(row);
  });

  it("does not steal focus back when a rename blurs into another control", () => {
    render(viewedDone(), null, () => undefined, true);
    const outside = document.createElement("button");
    document.body.append(outside);
    act(() => {
      host
        .querySelector(".cv-card-row")
        ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    act(() => outside.focus());
    expect(host.querySelector('input[aria-label="Rename thread"]')).toBeNull();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("starts inline rename on double-click", () => {
    render(viewedDone());
    act(() => {
      host
        .querySelector(".cv-card-row")
        ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(host.querySelector('input[aria-label="Rename thread"]')).not.toBeNull();
  });

  const spawn: AgentTurnEvent = {
    kind: "backgroundTask",
    taskId: "agent-1",
    taskType: "agent",
    status: "starting",
  };
  const answer: AgentTurnEvent = {
    kind: "assistantText",
    text: "The reviewer runs in the background.",
  };
  const runningWith = (
    events: ReadonlyArray<AgentTurnEvent>,
    turnId = "agt-1-t1",
    provider: AgentThread["provider"]["kind"] = "claudeCode",
  ): AgentThreadView => {
    const base = pinnedDone();
    const turn = base.thread.turns[0]!;
    return {
      ...base,
      thread: {
        ...base.thread,
        provider: { kind: provider, sessionId: null },
        turns: [
          {
            ...turn,
            turnId,
            status: { kind: "running" },
            endedAtEpochMs: null,
            events: [...events],
          },
        ],
      },
    };
  };
  const statusLabel = (): string | null | undefined =>
    host.querySelector(".cv-card-row__status-label")?.textContent;

  it("shows background work only after the shared quiescence window", () => {
    render(runningWith([spawn, answer]));
    expect(statusLabel()).toBe("Working");
    act(() => vi.advanceTimersByTime(AGENT_FOREGROUND_QUIESCENCE_MS - 1));
    expect(statusLabel()).toBe("Working");
    act(() => vi.advanceTimersByTime(1));
    expect(statusLabel()).toBe("1 agent running");
    expect(host.querySelector(".cv-card-row__status")?.getAttribute("title")).toBe(
      "Waiting for 1 agent",
    );
    expect(host.querySelector(".cv-card-row__tick")?.textContent).not.toBe("");
    render(runningWith([spawn, answer, { kind: "assistantText", text: "Still checking." }]));
    expect(statusLabel()).toBe("Working");
    act(() => vi.advanceTimersByTime(AGENT_FOREGROUND_QUIESCENCE_MS));
    expect(statusLabel()).toBe("1 agent running");
    render({
      ...runningWith([spawn, answer]),
      thread: {
        ...runningWith([spawn, answer]).thread,
        turns: [
          {
            ...runningWith([spawn, answer]).thread.turns[0]!,
            status: { kind: "interrupted" },
          },
        ],
      },
    });
    expect(statusLabel()).not.toBe("1 agent running");
    expect(host.querySelector(".cv-card-row__tick")).toBeNull();
  });

  it("restarts the quiescence window when a new turn produces the same anchor", () => {
    render(runningWith([spawn, answer]));
    act(() => vi.advanceTimersByTime(AGENT_FOREGROUND_QUIESCENCE_MS));
    expect(statusLabel()).toBe("1 agent running");
    render(runningWith([spawn, answer], "agt-1-t2"));
    expect(statusLabel()).toBe("Working");
    act(() => vi.advanceTimersByTime(AGENT_FOREGROUND_QUIESCENCE_MS));
    expect(statusLabel()).toBe("1 agent running");
  });

  it("never schedules background resolution for a Codex row", () => {
    render(runningWith([spawn, answer], "agt-1-t1", "codex"));
    act(() => vi.advanceTimersByTime(AGENT_FOREGROUND_QUIESCENCE_MS * 2));
    expect(statusLabel()).toBe("Working");
  });
});

function pinnedDone(): AgentThreadView {
  return threadView({ pinned: true, viewedAtEpochMs: null });
}

function viewedDone(): AgentThreadView {
  return threadView({ pinned: false, viewedAtEpochMs: NOW });
}

function importedView({ archived }: { readonly archived: boolean }): AgentThreadView {
  const view = threadView({ pinned: false, viewedAtEpochMs: NOW });
  return {
    ...view,
    thread: {
      ...view.thread,
      archived,
      provider: { kind: "claudeCode", sessionId: SESSION_ID },
      externalOrigin: {
        provider: "claudeCode",
        sessionId: SESSION_ID,
        importedAtEpochMs: NOW - 60_000,
      },
    },
  };
}

function threadView({
  pinned,
  viewedAtEpochMs,
}: {
  readonly pinned: boolean;
  readonly viewedAtEpochMs: number | null;
}): AgentThreadView {
  const thread: AgentThread = {
    threadId: "agt-1",
    owner: { rootKey: ROOT, ownerId: `agent-root:${ROOT}`, repositoryRoot: ROOT },
    target: { isolation: "worktree", worktreePath: `${ROOT}/.worktrees/agt-1` },
    provider: { kind: "claudeCode", sessionId: null },
    title: "Extract the invoice totals",
    pinned,
    archived: false,
    createdAtEpochMs: NOW - 10 * 60_000,
    updatedAtEpochMs: NOW - 2 * 60_000,
    turns: [
      {
        turnId: "agt-1-t1",
        prompt: "Extract the invoice totals",
        status: { kind: "exited", exitCode: 0 },
        startedAtEpochMs: NOW - 10 * 60_000,
        endedAtEpochMs: NOW - 2 * 60_000,
        events: [],
        eventsTruncated: false,
        lastStatusSequence: 0,
        lastOutputSequence: 0,
        launch: null,
        cliVersion: null,
      },
    ],
    turnsTruncated: false,
    viewedAtEpochMs,
    externalOrigin: null,
    integration: null,
  };

  return {
    thread,
    lifecycle: "settled",
    projectOrigin: "active-tab",
    repositoryLabel: "app",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
    ship: { kind: "idle", status: null, loadingStatus: false },
    editorAvailability: { kind: "available" },
    attention: agentThreadAttention(thread),
    unread: agentThreadUnread(thread),
  };
}
