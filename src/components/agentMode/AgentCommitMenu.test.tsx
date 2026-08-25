// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentShipState } from "../../domain/agentShip";
import {
  agentThreadAttention,
  agentThreadUnread,
  type AgentThread,
} from "../../domain/agentThread";
import type { AgentTaskIsolation } from "../../domain/agentTask";
import type { GitShipStatus } from "../../domain/gitIntegration";
import { AgentCommitMenu } from "./AgentCommitMenu";
import { AGENT_SHIP_NOTHING_LABEL, agentShipQuickAction } from "./agentThreadHeaderPresentation";
import type { AgentShipActions } from "./AgentShipPanel";

const ROOT = "/workspace/app";
const SHA = "a".repeat(40);

describe("agentShipQuickAction", () => {
  it("offers commit while the worktree has changes", () => {
    const quick = agentShipQuickAction(threadView({ ship: idle(status({ changeCount: 3 })) }));
    expect(quick).toEqual({
      kind: "commit",
      label: "Commit 3 files",
      availability: { kind: "available" },
    });
    expect(agentShipQuickAction(threadView({ ship: idle(status({ changeCount: 1 })) })).label).toBe(
      "Commit 1 file",
    );
  });

  it("offers push once the tree is clean and the branch is ahead of its upstream", () => {
    const quick = agentShipQuickAction(
      threadView({
        ship: idle(status({ changeCount: 0, dirty: false, upstream: { ahead: 2, behind: 0 } })),
      }),
    );
    expect(quick.kind).toBe("push");
    expect(quick.label).toBe("Push branch");
  });

  it("offers integrate for a clean pushed worktree and nothing for an in-place thread", () => {
    const clean = status({ changeCount: 0, dirty: false, upstream: { ahead: 0, behind: 0 } });
    expect(agentShipQuickAction(threadView({ ship: idle(clean) })).kind).toBe("integrate");
    const inPlace = agentShipQuickAction(threadView({ ship: idle(clean), isolation: "in-place" }));
    expect(inPlace.kind).toBe("none");
    expect(inPlace.label).toBe(AGENT_SHIP_NOTHING_LABEL);
    expect(inPlace.availability.kind).toBe("blocked");
  });

  it("falls back to a plain Commit label before the status is read", () => {
    expect(agentShipQuickAction(threadView({})).label).toBe("Commit");
  });
});

describe("AgentCommitMenu", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("commits with the default message from the primary button", () => {
    const actions = mockedShipActions();
    render(threadView({ ship: idle(status({ changeCount: 2 })) }), actions);

    act(() => button("Commit 2 files").click());

    expect(actions.onCommit).toHaveBeenCalledWith("agt-1", expect.stringContaining("Refactor"));
  });

  it("disables the primary with the blocked reason as its tooltip", () => {
    const actions = mockedShipActions();
    render(
      threadView({ ship: idle(status({ changeCount: 0, dirty: false })), isolation: "in-place" }),
      actions,
    );

    const primary = button(AGENT_SHIP_NOTHING_LABEL);
    expect(primary.disabled).toBe(true);
    expect(primary.title).not.toBe("");
    expect(button("Ship options").disabled).toBe(false);
  });

  it("opens a dialog hosting the ship panel and closes it on Escape", async () => {
    const actions = mockedShipActions();
    render(threadView({ ship: idle(status({ changeCount: 2 })) }), actions);

    act(() => button("Ship options").click());
    await act(async () => {});

    const dialog = host.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.querySelector(".agent-ship")).not.toBeNull();
    expect(dialog?.contains(document.activeElement)).toBe(true);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(button("Ship options"));
  });

  it("closes the popover when the thread changes", () => {
    const actions = mockedShipActions();
    render(threadView({ ship: idle(status({ changeCount: 2 })) }), actions);
    act(() => button("Ship options").click());
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();

    render(threadView({ ship: idle(status({ changeCount: 2 })), threadId: "agt-2" }), actions);

    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps the commit draft per thread across close and reopen", () => {
    const actions = mockedShipActions();
    const first = threadView({ ship: idle(status({ changeCount: 2 })) });
    const second = threadView({ ship: idle(status({ changeCount: 2 })), threadId: "agt-2" });
    render(first, actions);

    act(() => button("Ship options").click());
    typeMessage("Ship the parser fix");
    act(() => button("Ship options").click());
    expect(host.querySelector('[role="dialog"]')).toBeNull();

    act(() => button("Ship options").click());
    expect(message().value).toBe("Ship the parser fix");

    render(second, actions);
    act(() => button("Ship options").click());
    expect(message().value).not.toBe("Ship the parser fix");

    render(first, actions);
    act(() => button("Ship options").click());
    expect(message().value).toBe("Ship the parser fix");

    act(() => button("Commit 2 files").click());
    expect(actions.onCommit).toHaveBeenCalledWith("agt-1", "Ship the parser fix");
  });

  it("keeps the popover open while a ship step completes", () => {
    const actions = mockedShipActions();
    const view = threadView({ ship: idle(status({ changeCount: 2 })) });
    render(view, actions);
    act(() => button("Ship options").click());

    render(
      { ...view, ship: { kind: "committed", status: status({ changeCount: 0 }), commitSha: SHA } },
      actions,
    );

    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("Committed");
  });

  function render(thread: AgentThreadView, actions: AgentShipActions): void {
    act(() => {
      root.render(<AgentCommitMenu actions={actions} thread={thread} />);
    });
  }

  function button(label: string): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    expect(element, `Missing button ${label}`).not.toBeNull();
    return element as HTMLButtonElement;
  }

  function message(): HTMLTextAreaElement {
    const element = host.querySelector<HTMLTextAreaElement>("textarea.agent-ship__message");
    expect(element, "Missing commit message field").not.toBeNull();
    return element as HTMLTextAreaElement;
  }

  function typeMessage(value: string): void {
    const field = message();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    act(() => {
      setter?.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
});

function mockedShipActions(): AgentShipActions {
  return {
    onRefreshShipStatus: vi.fn(),
    onCommit: vi.fn(),
    onPush: vi.fn(),
    onOpenCompareUrl: vi.fn(),
    onIntegrate: vi.fn(),
    onRemoveWorktree: vi.fn(),
    onDiscardWorktree: vi.fn(),
    onDismissFailure: vi.fn(),
  };
}

interface StatusOptions {
  readonly changeCount?: number;
  readonly dirty?: boolean;
  readonly upstream?: { readonly ahead: number; readonly behind: number } | null;
}

function status(overrides: StatusOptions): GitShipStatus {
  return {
    worktree: {
      branch: "agent/agt-1",
      head: SHA,
      dirty: overrides.dirty ?? true,
      changeCount: overrides.changeCount ?? 2,
    },
    primary: { branch: "main", head: "b".repeat(40), dirty: false },
    relation: { aheadOfPrimary: 1, behindPrimary: 0, fastForwardable: true },
    remote: {
      name: "origin",
      upstream: overrides.upstream === undefined ? { ahead: 0, behind: 0 } : overrides.upstream,
      compareUrl: null,
    },
  };
}

function idle(value: GitShipStatus): AgentShipState {
  return { kind: "idle", status: value, loadingStatus: false };
}

function threadView(overrides: {
  readonly ship?: AgentShipState;
  readonly isolation?: AgentTaskIsolation;
  readonly threadId?: string;
}): AgentThreadView {
  const isolation = overrides.isolation ?? "worktree";
  const threadId = overrides.threadId ?? "agt-1";
  const thread: AgentThread = {
    threadId,
    owner: { rootKey: ROOT, ownerId: "agent-root:app", repositoryRoot: ROOT },
    target: {
      isolation,
      worktreePath: isolation === "worktree" ? `${ROOT}/.worktrees/${threadId}` : null,
    },
    provider: { kind: "claudeCode", sessionId: null },
    title: "Refactor the parser",
    pinned: false,
    archived: false,
    createdAtEpochMs: 1_700_000_000_000,
    updatedAtEpochMs: 1_700_000_000_000,
    turns: [],
    turnsTruncated: false,
    viewedAtEpochMs: null,
    integration: null,
  };
  return {
    thread,
    ship: overrides.ship ?? { kind: "idle", status: null, loadingStatus: false },
    editorAvailability: { kind: "available" },
    attention: agentThreadAttention(thread),
    unread: agentThreadUnread(thread),
    lifecycle: "settled",
    repositoryLabel: "app",
    projectOrigin: "active-tab",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
  };
}
