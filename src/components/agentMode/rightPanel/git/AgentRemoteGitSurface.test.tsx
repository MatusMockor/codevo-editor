// @vitest-environment jsdom
import { REMOTE_RUNNER_REACHABLE } from "../../../../domain/remoteRunnerReachability";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import wireContract from "../../../../../contracts/remote-git-sync-wire.json";
import type { AgentThreadView } from "../../../../application/agentThreadPorts";
import type { AgentShipState } from "../../../../domain/agentShip";
import type { AgentTaskIsolation } from "../../../../domain/agentTask";
import {
  remoteThreadShipStatus,
  type RemoteThreadGitStatus,
} from "../../../../domain/remoteGitSync";
import { mountUi, type MountedUi } from "../../../../ui/foundation/foundationTestSupport";
import { surfaceThreadView } from "../../agentSurfaceTestFixtures";
import { AGENT_SHIP_BLOCKED_COMMIT_FIRST } from "../../agentModePresentation";
import { SURFACE_REMOTE_UNAVAILABLE_REASON } from "../../agentSurfacePolicy";
import type { AgentShipActions } from "../../useAgentShipActions";
import { AgentRightPanelSurfaceBody } from "../AgentRightPanelSurfaceBody";
import {
  REMOTE_SHIP_DIVERGED,
  REMOTE_SHIP_REJECTED_IN_PLACE,
  REMOTE_SHIP_REJECTED_IN_PLACE_BEHIND,
  REMOTE_SHIP_REJECTED_WORKTREE,
  remoteShipNothingAheadOfBase,
} from "./agentRemoteShipPresentation";
import { WithRightPanelContext, rightPanelTestContext } from "../agentRightPanelTestSupport";

type Contract = Readonly<{
  sections: Readonly<
    Record<string, Readonly<{ accepted: readonly { name: string; value: unknown }[] }>>
  >;
}>;
const contract = wireContract as unknown as Contract;
const fixture = (name: string): RemoteThreadGitStatus =>
  contract.sections.threadGitStatus!.accepted.find((entry) => entry.name === name)!
    .value as RemoteThreadGitStatus;

const THREAD_ID = "remote-thread:linux:linux-runner:7389088c";
const REPOSITORY = "github.com/acme/app";

let ui: MountedUi | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
});

function actions(): AgentShipActions {
  return {
    onRefreshShipStatus: vi.fn(),
    onCommit: vi.fn(async () => ({ kind: "succeeded" as const })),
    onPush: vi.fn(async () => ({ kind: "succeeded" as const })),
    onOpenCompareUrl: vi.fn(),
    onIntegrate: vi.fn(),
    onRemoveWorktree: vi.fn(),
    onDiscardWorktree: vi.fn(),
    onDismissFailure: vi.fn(),
  };
}

function serverThread(
  ship: AgentShipState,
  gitShip = true,
  isolation: AgentTaskIsolation = "worktree",
): AgentThreadView {
  const base = surfaceThreadView();
  return surfaceThreadView({
    ship,
    thread: {
      ...base.thread,
      threadId: THREAD_ID,
      target: { isolation, worktreePath: null },
    },
    execution: {
      kind: "remote",
      serverId: "linux",
      runnerId: "linux-runner",
      projectId: "app",
      conversationId: "7389088c-0000-4000-8000-000000000000",
      latestTaskId: "7389088c-0000-4000-8000-000000000000",
      resume: null,
      reachability: REMOTE_RUNNER_REACHABLE,
      ...(gitShip ? { gitShip: true } : {}),
    },
  });
}

function idle(status: RemoteThreadGitStatus): AgentShipState {
  return {
    kind: "idle",
    status: remoteThreadShipStatus(status, "7389088c-0000-4000-8000-000000000000", REPOSITORY),
    loadingStatus: false,
  };
}

function render(thread: AgentThreadView, shipActions: AgentShipActions | null = actions()) {
  ui = mountUi();
  ui.render(
    <WithRightPanelContext value={rightPanelTestContext({ thread, shipActions })}>
      <AgentRightPanelSurfaceBody
        active
        agentsPanel={null}
        fileTree={null}
        history={null}
        kind="git"
        scope={{ kind: "none" }}
        terminal={null}
        terminalLayoutRevision={0}
        thread={thread}
        treeShown={false}
        workspaceRoot="/repo"
        workspaceTrusted
      />
    </WithRightPanelContext>,
  );
  return ui.host;
}

function button(host: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
}

function type(textarea: HTMLTextAreaElement | null, value: string): void {
  if (textarea === null) return;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("server thread Git panel", () => {
  it("shows the thread branch, its origin base and ahead/behind", () => {
    const host = render(serverThread(idle(fixture("worktreeFromOrigin"))));
    expect(host.querySelector(".cv-git-remote__name")?.textContent).toBe("codevo/7389088c");
    expect(host.textContent).toContain("from origin/main");
    const sync = host.querySelector(".cv-git-sync");
    expect(sync?.textContent).toBe("↑2 ↓0");
    expect(sync?.getAttribute("title")).toBe("2 ahead, 0 behind origin/main");
    expect(host.textContent).toContain("No uncommitted changes");
    expect(host.textContent).toContain("codevo/7389088c: 1 not pushed");
  });

  it("commits every server change with the entered message", async () => {
    const shipActions = actions();
    const status = {
      ...fixture("worktreeFromOrigin"),
      dirty: { tracked: 2, untracked: 1, truncated: false },
    };
    const host = render(serverThread(idle(status)), shipActions);
    expect(host.textContent).toContain("3 uncommitted changes");
    const commit = button(host, "Commit");
    expect(commit?.disabled).toBe(true);
    type(host.querySelector("textarea"), "Ship the parser");
    expect(button(host, "Commit")?.disabled).toBe(false);
    await act(async () => {
      button(host, "Commit")?.click();
    });
    expect(shipActions.onCommit).toHaveBeenCalledWith(THREAD_ID, "Ship the parser");
    expect(host.querySelector("textarea")?.value).toBe("");
    expect(host.textContent).toContain("Committed on the server.");
  });

  it("asks to commit before pushing and pushes once there is something to publish", async () => {
    const shipActions = actions();
    const dirty = { ...fixture("inPlace"), dirty: { tracked: 1, untracked: 0, truncated: false } };
    let host = render(serverThread(idle(dirty)), shipActions);
    expect(button(host, "Push")?.disabled).toBe(true);
    expect(button(host, "Push")?.title).toBe(AGENT_SHIP_BLOCKED_COMMIT_FIRST);
    ui?.unmount();
    host = render(serverThread(idle(fixture("worktreeFromOrigin"))), shipActions);
    await act(async () => {
      button(host, "Push")?.click();
    });
    expect(shipActions.onPush).toHaveBeenCalledWith(THREAD_ID);
    expect(host.textContent).toContain("Pushed to origin.");
  });

  it("offers the compare page after a push and never offers integrate", () => {
    const shipActions = actions();
    const status = remoteThreadShipStatus(
      fixture("worktreeFromOrigin"),
      "7389088c-0000-4000-8000-000000000000",
      REPOSITORY,
    );
    const host = render(
      serverThread({
        kind: "pushed",
        status,
        receipt: {
          remote: "origin",
          branch: "codevo/7389088c",
          compareUrl: "https://github.com/acme/app/compare/main...codevo/7389088c?expand=1",
        },
      }),
      shipActions,
    );
    const compare = button(host, "Open compare page on GitHub");
    expect(compare).toBeDefined();
    act(() => compare?.click());
    expect(shipActions.onOpenCompareUrl).toHaveBeenCalledWith(THREAD_ID);
    expect(host.textContent).not.toMatch(/Integrate|Remove worktree|Discard worktree/u);
  });

  it("shows a push failure with retry and dismiss", () => {
    const shipActions = actions();
    const host = render(
      serverThread({
        kind: "failed",
        status: null,
        resumeFrom: "idle",
        failure: {
          step: "push",
          reason: "rejected",
          message:
            "Origin has newer commits on this branch. The push was rejected and nothing was overwritten.",
        },
      }),
      shipActions,
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("push failed");
    act(() => button(host, "Retry push")?.click());
    act(() => button(host, "Dismiss")?.click());
    expect(shipActions.onPush).toHaveBeenCalledWith(THREAD_ID);
    expect(shipActions.onDismissFailure).toHaveBeenCalledWith(THREAD_ID);
  });

  function rejected(status: RemoteThreadGitStatus | null): AgentShipState {
    return {
      kind: "failed",
      status:
        status === null
          ? null
          : remoteThreadShipStatus(status, "7389088c-0000-4000-8000-000000000000", REPOSITORY),
      resumeFrom: "idle",
      failure: { step: "push", reason: "rejected", message: "rejected" },
    };
  }

  it.each([
    ["worktree" as const, null, REMOTE_SHIP_REJECTED_WORKTREE],
    ["in-place" as const, null, REMOTE_SHIP_REJECTED_IN_PLACE],
    [
      "in-place" as const,
      { ref: "origin/main", ahead: 1, behind: 2 },
      REMOTE_SHIP_REJECTED_IN_PLACE,
    ],
    [
      "in-place" as const,
      { ref: "origin/main", ahead: 0, behind: 2 },
      REMOTE_SHIP_REJECTED_IN_PLACE_BEHIND,
    ],
  ])(
    "explains a rejected push on a %s server thread (origin %o) without a local pull",
    (isolation, published, copy) => {
      const status = published === null ? null : { ...fixture("inPlace"), published };
      const host = render(serverThread(rejected(status), true, isolation));
      const alert = host.querySelector('[role="alert"]')?.textContent ?? "";
      expect(alert).toContain(copy);
      expect(alert).not.toContain("Pull them in the Git panel");
    },
  );

  it("disables Retry push with the reason while the branch and origin have diverged", () => {
    const shipActions = actions();
    const diverged = {
      ...fixture("worktreeFromOrigin"),
      published: { ref: "origin/codevo/7389088c", ahead: 1, behind: 2 },
    };
    const host = render(serverThread(rejected(diverged)), shipActions);
    const retry = button(host, "Retry push");
    expect(retry?.disabled).toBe(true);
    expect(retry?.title).toBe(REMOTE_SHIP_DIVERGED);
    act(() => retry?.click());
    expect(shipActions.onPush).not.toHaveBeenCalled();
  });

  it("disables push when the branch and origin have diverged", () => {
    const status = {
      ...fixture("worktreeFromOrigin"),
      published: { ref: "origin/codevo/7389088c", ahead: 1, behind: 2 },
    };
    const host = render(serverThread(idle(status)));
    expect(button(host, "Push")?.disabled).toBe(true);
    expect(button(host, "Push")?.title).toBe(REMOTE_SHIP_DIVERGED);
  });

  it("disables push for an unpublished branch with nothing ahead of its base", () => {
    const base = fixture("worktreeFromOrigin");
    const empty = {
      ...base,
      base: { ...base.base!, ahead: 0 },
      published: null,
    };
    let host = render(serverThread(idle(empty)));
    expect(button(host, "Push")?.disabled).toBe(true);
    expect(button(host, "Push")?.title).toBe(
      remoteShipNothingAheadOfBase("codevo/7389088c", "origin/main"),
    );
    ui?.unmount();
    host = render(
      serverThread(idle({ ...empty, dirty: { tracked: 1, untracked: 0, truncated: false } })),
    );
    expect(button(host, "Push")?.title).toBe(AGENT_SHIP_BLOCKED_COMMIT_FIRST);
    ui?.unmount();
    host = render(serverThread(idle({ ...base, published: null })));
    expect(button(host, "Push")?.disabled).toBe(false);
  });

  it("stays blocked for a server thread whose runner lacks Git sync", () => {
    const host = render(serverThread(idle(fixture("worktreeFromOrigin")), false));
    expect(host.textContent).toBe(SURFACE_REMOTE_UNAVAILABLE_REASON);
    expect(host.querySelector("textarea")).toBeNull();
  });
});
