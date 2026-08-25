// @vitest-environment jsdom

import { agentThreadAttention, agentThreadUnread } from "../../domain/agentThread";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentShipFailure, AgentShipState } from "../../domain/agentShip";
import type { AgentThread } from "../../domain/agentThread";
import type { AgentTaskIsolation } from "../../domain/agentTask";
import type { GitShipStatus } from "../../domain/gitIntegration";
import { AgentShipPanel, type AgentShipActions, type AgentShipPanelProps } from "./AgentShipPanel";

const ROOT = "/workspace/app";
const WORKTREE = `${ROOT}/.worktrees/agt-1`;
const NOW = 1_700_000_600_000;
const SHA = "a".repeat(40);
const MERGE_SHA = "b".repeat(40);

describe("AgentShipPanel", () => {
  let host: HTMLDivElement;
  let root: Root;
  let actions: MockedShipActions;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    actions = mockedShipActions();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("states the branch, its relation to the main checkout and the remote", () => {
    render({ ship: idle(status({ aheadOfPrimary: 3, behindPrimary: 1 })) });

    expect(host.textContent).toContain("agent/agt-1");
    expect(host.textContent).toContain("3 ahead · 1 behind main");
    expect(host.textContent).toContain("origin · 0 ahead · 2 behind");
  });

  it("names a missing remote instead of pretending one exists", () => {
    render({ ship: idle(status({ remote: null })) });

    expect(host.textContent).toContain("No remote");
    expect(blockedReasons()).toContain("No remote is configured for this repository.");
    expect(button("Push branch")?.disabled).toBe(true);
  });

  it("warns about a dirty and a detached main checkout", () => {
    render({ ship: idle(status({ primaryDirty: true })) });
    expect(host.textContent).toContain("The main checkout has uncommitted changes.");

    render({ ship: idle(status({ primaryBranch: null })) });
    expect(host.textContent).toContain("The main checkout is detached.");
  });

  it("prefills the commit message from the thread title and counts its bytes", () => {
    render({ ship: idle(status({})) });

    expect(messageField().value).toBe("Refactor the parser");
    expect(host.textContent).toContain("19 / 4096 bytes");
  });

  it("commits the edited message for the thread it belongs to", () => {
    render({ ship: idle(status({})) });

    type("Rewrite the tokenizer");
    click("Commit 2 files");

    expect(actions.onCommit).toHaveBeenCalledWith("agt-1", "Rewrite the tokenizer");
  });

  it("refuses to commit a blank message or a clean worktree", () => {
    render({ ship: idle(status({})) });
    type("   ");

    expect(button("Commit 2 files")?.disabled).toBe(true);
    expect(blockedReasons()).toContain("Write a commit message first.");

    render({ ship: idle(status({ dirty: false, changeCount: 0 })) });

    expect(button("Commit 0 files")?.disabled).toBe(true);
    expect(blockedReasons()).toContain("Nothing to commit.");
  });

  it("blocks every step while the agent is still running", () => {
    render({ lifecycle: "running", ship: idle(status({})) });

    expect(blockedReasons()).toContain("Stop the agent first.");
    expect(button("Push branch")?.disabled).toBe(true);
  });

  it("reports the running step and disables the actions while a step is in flight", () => {
    render({
      ship: {
        kind: "pushing",
        status: status({}),
        commitSha: SHA,
        resumeFrom: "committed",
      },
    });

    expect(host.querySelector('[role="status"]')?.textContent).toContain("Pushing the branch…");
    expect(button("Push branch")?.disabled).toBe(true);
    expect(button("Commit 2 files")?.disabled).toBe(true);
  });

  it("shows the commit receipt and then the push receipt with its compare page", () => {
    render({ ship: { kind: "committed", status: status({}), commitSha: SHA } });
    expect(host.textContent).toContain("Committed aaaaaaaa.");

    render({
      ship: {
        kind: "pushed",
        status: status({}),
        receipt: {
          remote: "origin",
          branch: "agent/agt-1",
          compareUrl: "https://github.com/acme/app/compare/main...agent/agt-1?expand=1",
        },
      },
    });

    expect(host.textContent).toContain("Pushed agent/agt-1 to origin.");
    clickSelector('[aria-label="Open the compare page for agent/agt-1"]');
    expect(host.textContent).toContain("Open compare page on GitHub");
    expect(actions.onOpenCompareUrl).toHaveBeenCalledWith("agt-1");
  });

  it("offers no compare page when the hosting site is unknown", () => {
    render({
      ship: {
        kind: "pushed",
        status: status({}),
        receipt: { remote: "origin", branch: "agent/agt-1", compareUrl: null },
      },
    });

    expect(host.querySelector('[aria-label="Open the compare page for agent/agt-1"]')).toBeNull();
    expect(host.textContent).toContain("Open a pull request for this branch on your hosting site.");
  });

  it("preselects fast-forward when the branch fast-forwards and merge otherwise", () => {
    render({ ship: idle(status({ fastForwardable: true })) });
    expect(radio("fastForward").checked).toBe(true);

    render({ ship: idle(status({ fastForwardable: false })) });
    expect(radio("merge").checked).toBe(true);
    expect(button("Integrate into main")?.disabled).toBe(false);
  });

  it("blocks fast-forward with its reason and integrates with the chosen mode", () => {
    render({ ship: idle(status({ fastForwardable: false })) });

    act(() => radio("fastForward").click());

    expect(button("Integrate into main")?.disabled).toBe(true);
    expect(blockedReasons()).toContain(
      "The branch is behind the main checkout; use Merge instead of Fast-forward.",
    );

    act(() => radio("merge").click());
    click("Integrate into main");

    expect(actions.onIntegrate).toHaveBeenCalledWith("agt-1", "merge");
  });

  it("blocks integration while the main checkout is dirty or detached", () => {
    render({ ship: idle(status({ primaryDirty: true })) });
    expect(blockedReasons()).toContain("The main checkout has uncommitted changes.");

    render({ ship: idle(status({ primaryBranch: null })) });
    expect(blockedReasons()).toContain("The main checkout is detached.");
  });

  it("hides integration and clean up for an in-place thread", () => {
    render({ isolation: "in-place", ship: idle(status({})) });

    expect(button("Integrate into main")).toBeUndefined();
    expect(button("Remove worktree")).toBeUndefined();
    expect(button("Commit 2 files")).toBeDefined();
  });

  it("allows deleting the branch only after the branch was integrated", () => {
    render({ ship: idle(status({})) });

    expect(deleteBranchBox().disabled).toBe(true);
    expect(deleteBranchBox().checked).toBe(false);
    expect(host.textContent).toContain("Integrate the branch before deleting it.");

    click("Remove worktree");
    expect(actions.onRemoveWorktree).toHaveBeenCalledWith("agt-1", { deleteBranch: false });

    render({
      ship: { kind: "integrated", status: status({}), mergeSha: MERGE_SHA, intoBranch: "main" },
    });

    expect(host.textContent).toContain("Merged bbbbbbbb into main.");
    expect(deleteBranchBox().disabled).toBe(false);
    expect(deleteBranchBox().checked).toBe(true);

    act(() => deleteBranchBox().click());
    click("Remove worktree");

    expect(actions.onRemoveWorktree).toHaveBeenLastCalledWith("agt-1", { deleteBranch: false });
  });

  it("discards the worktree without integrating through its own action", () => {
    render({ ship: idle(status({})) });

    clickSelector('[aria-label="Discard the worktree of agent agt-1"]');

    expect(actions.onDiscardWorktree).toHaveBeenCalledWith("agt-1");
  });

  it("refreshes the branch status on request", () => {
    render({ ship: idle(status({})) });

    clickSelector('[aria-label="Refresh the branch status of agent agt-1"]');

    expect(actions.onRefreshShipStatus).toHaveBeenCalledWith("agt-1");
  });

  it("says the status was never read instead of inventing one", () => {
    render({ ship: { kind: "idle", status: null, loadingStatus: false } });

    expect(host.textContent).toContain("The branch status has not been read yet.");
    expect(button("Commit changes")?.disabled).toBe(false);
  });

  it("resumes a failed commit from the commit step", () => {
    render({ ship: failed({ step: "commit", reason: "gitError", message: "index.lock exists" }) });

    expect(host.textContent).toContain("commit failed");
    expect(host.textContent).toContain("index.lock exists");

    type("Rewrite the tokenizer");
    click("Retry commit for agent agt-1");

    expect(actions.onCommit).toHaveBeenCalledWith("agt-1", "Rewrite the tokenizer");
    expect(actions.onPush).not.toHaveBeenCalled();
  });

  it("resumes a failed push from the push step and explains the rejection", () => {
    render({ ship: failed({ step: "push", reason: "rejected", message: "non fast forward" }) });

    expect(host.textContent).toContain(
      "The remote branch has newer commits. Pull them in the Git panel, then retry.",
    );

    click("Retry push for agent agt-1");

    expect(actions.onPush).toHaveBeenCalledWith("agt-1");
    expect(actions.onCommit).not.toHaveBeenCalled();
  });

  it("resumes a failed integration with the selected mode", () => {
    render({ ship: failed({ step: "integrate", outcome: { kind: "notFastForward" } }) });

    expect(host.textContent).toContain("A fast-forward is no longer possible.");

    act(() => radio("merge").click());
    click("Retry integrate for agent agt-1");

    expect(actions.onIntegrate).toHaveBeenCalledWith("agt-1", "merge");
  });

  it("resumes a failed removal with the current branch choice", () => {
    render({
      ship: failed(
        { step: "removeWorktree", reason: "gitError", message: "worktree is locked" },
        "integrated",
      ),
    });

    expect(host.textContent).toContain("worktree is locked");

    click("Retry removal for agent agt-1");

    expect(actions.onRemoveWorktree).toHaveBeenCalledWith("agt-1", { deleteBranch: false });
  });

  it("offers no removal retry once the worktree is gone and the branch was kept", () => {
    render({
      ship: failed(
        { step: "removeWorktree", reason: "branchNotMerged", message: "not merged" },
        "integrated",
      ),
    });

    expect(host.textContent).toContain("The branch was not merged, so it was kept.");
    expect(host.textContent).toContain(
      "The worktree is already removed. Delete the branch in the Git panel if you no longer need it.",
    );
    expect(button("Retry removal for agent agt-1")).toBeUndefined();

    click("Dismiss the ship failure of agent agt-1");
    expect(actions.onRemoveWorktree).not.toHaveBeenCalled();
    expect(actions.onDismissFailure).toHaveBeenCalledWith("agt-1");
  });

  it("offers no integration retry while the main checkout is stuck in a conflicted merge", () => {
    render({
      ship: failed({
        step: "integrate",
        outcome: { kind: "abortFailed", message: "could not abort the merge" },
      }),
    });

    expect(host.textContent).toContain("The main checkout is in a conflicted merge.");
    expect(host.textContent).toContain(
      "Resolve the merge in the Git panel, then refresh the branch status.",
    );
    expect(button("Retry integrate for agent agt-1")).toBeUndefined();
    expect(actions.onIntegrate).not.toHaveBeenCalled();
  });

  it("bounds the conflicted file list and counts the rest", () => {
    const files = Array.from({ length: 20 }, (_unused, index) => `src/file-${index}.ts`);
    render({
      ship: failed({ step: "integrate", outcome: { kind: "conflicted", files, truncated: true } }),
    });

    expect(host.textContent).toContain(
      "The merge conflicted and was aborted. The main checkout is unchanged.",
    );
    expect(host.querySelectorAll('[aria-label="Conflicted files"] li')).toHaveLength(12);
    expect(host.textContent).toContain("+8 more conflicted files");
    expect(host.textContent).toContain("More conflicted files exist than git reported.");
  });

  it("reports a lost owner without blaming git", () => {
    render({ ship: failed({ step: "push", reason: "authorityLost" }) });

    expect(host.textContent).toContain(
      "The project changed while the step was running, so nothing was published.",
    );
  });

  it("dismisses a failure through the surface", () => {
    render({ ship: failed({ step: "push", reason: "authRequired", message: "auth" }) });

    click("Dismiss the ship failure of agent agt-1");

    expect(actions.onDismissFailure).toHaveBeenCalledWith("agt-1");
  });

  it("blocks every step once the worktree is gone", () => {
    render({ ship: { kind: "worktreeRemoved", branchDeleted: true } });

    expect(blockedReasons()).toContain("The worktree no longer exists.");
    expect(button("Push branch")?.disabled).toBe(true);
  });

  function render(overrides: ThreadViewOptions = {}): void {
    act(() => root.render(<AgentShipPanel {...props(overrides)} />));
  }

  function props(overrides: ThreadViewOptions): AgentShipPanelProps {
    return { actions, thread: threadView(overrides) };
  }

  function messageField(): HTMLTextAreaElement {
    const field = host.querySelector<HTMLTextAreaElement>("textarea.agent-ship__message");
    expect(field).not.toBeNull();
    return field as HTMLTextAreaElement;
  }

  function type(text: string): void {
    const field = messageField();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set as (
      value: string,
    ) => void;
    act(() => {
      setter.call(field, text);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function radio(value: string): HTMLInputElement {
    const input = host.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`);
    expect(input).not.toBeNull();
    return input as HTMLInputElement;
  }

  function deleteBranchBox(): HTMLInputElement {
    const input = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(input).not.toBeNull();
    return input as HTMLInputElement;
  }

  function button(label: string): HTMLButtonElement | undefined {
    return [...host.querySelectorAll("button")].find(
      (candidate) => candidate.getAttribute("aria-label") === label,
    );
  }

  function click(label: string): void {
    const element = button(label);
    expect(element, `Missing button ${label}`).toBeDefined();
    act(() => element?.click());
  }

  function clickSelector(selector: string): void {
    const element = host.querySelector<HTMLElement>(selector);
    expect(element, `Missing element ${selector}`).not.toBeNull();
    act(() => element?.click());
  }

  function blockedReasons(): ReadonlyArray<string> {
    return [...host.querySelectorAll(".agent-ship__reason")].map(
      (element) => element.textContent ?? "",
    );
  }
});

type MockedShipActions = ReturnType<typeof mockedShipActions>;

function mockedShipActions() {
  return {
    onRefreshShipStatus: vi.fn<AgentShipActions["onRefreshShipStatus"]>(),
    onCommit: vi.fn<AgentShipActions["onCommit"]>(),
    onPush: vi.fn<AgentShipActions["onPush"]>(),
    onOpenCompareUrl: vi.fn<AgentShipActions["onOpenCompareUrl"]>(),
    onIntegrate: vi.fn<AgentShipActions["onIntegrate"]>(),
    onRemoveWorktree: vi.fn<AgentShipActions["onRemoveWorktree"]>(),
    onDiscardWorktree: vi.fn<AgentShipActions["onDiscardWorktree"]>(),
    onDismissFailure: vi.fn<AgentShipActions["onDismissFailure"]>(),
  };
}

interface StatusOptions {
  readonly branch?: string;
  readonly dirty?: boolean;
  readonly changeCount?: number;
  readonly primaryBranch?: string | null;
  readonly primaryDirty?: boolean;
  readonly aheadOfPrimary?: number;
  readonly behindPrimary?: number;
  readonly fastForwardable?: boolean;
  readonly remote?: GitShipStatus["remote"];
}

function status(overrides: StatusOptions): GitShipStatus {
  return {
    worktree: {
      branch: overrides.branch ?? "agent/agt-1",
      head: SHA,
      dirty: overrides.dirty ?? true,
      changeCount: overrides.changeCount ?? 2,
    },
    primary: {
      branch: overrides.primaryBranch === undefined ? "main" : overrides.primaryBranch,
      head: MERGE_SHA,
      dirty: overrides.primaryDirty ?? false,
    },
    relation: {
      aheadOfPrimary: overrides.aheadOfPrimary ?? 1,
      behindPrimary: overrides.behindPrimary ?? 0,
      fastForwardable: overrides.fastForwardable ?? true,
    },
    remote:
      overrides.remote === undefined
        ? { name: "origin", upstream: { ahead: 0, behind: 2 }, compareUrl: null }
        : overrides.remote,
  };
}

function idle(value: GitShipStatus): AgentShipState {
  return { kind: "idle", status: value, loadingStatus: false };
}

function failed(
  failure: AgentShipFailure,
  resumeFrom: "idle" | "committed" | "pushed" | "integrated" = "idle",
): AgentShipState {
  return { kind: "failed", status: status({}), failure, resumeFrom };
}

interface ThreadViewOptions {
  readonly ship?: AgentShipState;
  readonly isolation?: AgentTaskIsolation;
  readonly lifecycle?: AgentThreadView["lifecycle"];
}

function threadView(overrides: ThreadViewOptions): AgentThreadView {
  const isolation = overrides.isolation ?? "worktree";
  const thread: AgentThread = {
    threadId: "agt-1",
    owner: { rootKey: ROOT, ownerId: "agent-root:app", repositoryRoot: ROOT },
    target: { isolation, worktreePath: isolation === "worktree" ? WORKTREE : null },
    provider: { kind: "claudeCode", sessionId: "session-abcdefgh" },
    title: "Refactor the parser",
    pinned: false,
    archived: false,
    createdAtEpochMs: NOW - 5 * 60_000,
    updatedAtEpochMs: NOW - 5 * 60_000,
    turns: [],
    turnsTruncated: false,
    viewedAtEpochMs: null,
    integration: null,
  };

  return {
    ship: overrides.ship ?? { kind: "idle", status: null, loadingStatus: false },
    editorAvailability: { kind: "available" },
    attention: agentThreadAttention(thread),
    unread: agentThreadUnread(thread),
    thread,
    lifecycle: overrides.lifecycle ?? "settled",
    repositoryLabel: "app",
    projectOrigin: "active-tab",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
  };
}
