// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitChangedFile, GitStatus } from "../../../../domain/git";
import type { AgentShipState, AgentShipStepResult } from "../../../../domain/agentShip";
import { waitForReact } from "../../../../test/reactTestLifecycle";
import { click, mountUi, type MountedUi } from "../../../../ui/foundation/foundationTestSupport";
import { surfaceThreadView } from "../../agentSurfaceTestFixtures";
import type { AgentShipActions } from "../../useAgentShipActions";
import type { AgentRightPanelGateways } from "../agentRightPanelGateways";
import { WithRightPanelContext, rightPanelTestContext } from "../agentRightPanelTestSupport";
import { AgentGitSurfaceContainer } from "./AgentGitSurfaceContainer";

let ui: MountedUi | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
});

function change(relativePath: string): GitChangedFile {
  return {
    isStaged: false,
    isUnversioned: false,
    oldPath: null,
    oldRelativePath: null,
    path: `/repo/${relativePath}`,
    relativePath,
    status: "modified",
  };
}

function memoryGit(changes: GitChangedFile[]) {
  const calls: string[] = [];
  const status = (): GitStatus => ({
    branch: "main",
    changes,
    isRepository: true,
    rootPath: "/repo",
  });
  const git: AgentRightPanelGateways["git"] = {
    getStatus: async (root) => {
      calls.push(`status:${root}`);
      return status();
    },
    getDiff: () => Promise.reject(new Error("unused")),
    stageFiles: async (_root, files) => {
      calls.push(`stage:${files.map((file) => file.relativePath).join(",")}`);
      return status();
    },
    commit: async (_root, message, files) => {
      calls.push(`commit:${message}:${files.map((file) => file.relativePath).join(",")}`);
      return status();
    },
    push: async () => status(),
    fetch: async () => status(),
    createBranch: async () => undefined,
    switchBranch: async () => undefined,
  };
  return { calls, git };
}

function button(host: HTMLElement, name: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) =>
      candidate.getAttribute("aria-label") === name || candidate.textContent?.trim() === name,
  );
  expect(found, name).toBeDefined();
  return found as HTMLButtonElement;
}

function shipActions(): AgentShipActions {
  return {
    onRefreshShipStatus: vi.fn(),
    onCommit: vi.fn(async (): Promise<AgentShipStepResult> => ({ kind: "succeeded" })),
    onPush: vi.fn(async (): Promise<AgentShipStepResult> => ({ kind: "succeeded" })),
    onOpenCompareUrl: vi.fn(),
    onIntegrate: vi.fn(),
    onRemoveWorktree: vi.fn(),
    onDiscardWorktree: vi.fn(),
    onDismissFailure: vi.fn(),
  };
}

describe("AgentGitSurfaceContainer", () => {
  it("commits exactly the included project files through the git gateway", async () => {
    const memory = memoryGit([change("a.ts"), change("b.ts")]);
    const refresh = vi.fn();
    const value = rightPanelTestContext(
      { gitStatus: { load: { kind: "idle" }, refresh } },
      { git: memory.git },
    );
    ui = mountUi();
    ui.render(
      <WithRightPanelContext value={value}>
        <AgentGitSurfaceContainer />
      </WithRightPanelContext>,
    );
    await waitForReact(() => expect(ui?.host.querySelectorAll(".cv-git-row")).toHaveLength(2));

    click(button(ui.host, "Include b.ts"));
    click(button(ui.host, "Commit"));

    await waitForReact(() => expect(ui?.host.textContent).toContain("Committed."));
    expect(memory.calls).toContain("stage:a.ts");
    expect(memory.calls).toContain("commit:fix(a): update a.ts:a.ts");
    expect(refresh).toHaveBeenCalled();
  });

  it("reloads the change list when the shared status revision changes", async () => {
    const changes = [change("greet.ts")];
    const memory = memoryGit(changes);
    const base = rightPanelTestContext({}, { git: memory.git });
    const withRevision = (statusRevision: number) =>
      base.chrome === null ? base : { ...base, chrome: { ...base.chrome, statusRevision } };
    ui = mountUi();
    const mounted = ui;
    const renderAt = (statusRevision: number) =>
      mounted.render(
        <WithRightPanelContext value={withRevision(statusRevision)}>
          <AgentGitSurfaceContainer />
        </WithRightPanelContext>,
      );
    renderAt(0);
    await waitForReact(() => expect(mounted.host.querySelectorAll(".cv-git-row")).toHaveLength(1));

    changes.push(change("retest.ts"));
    renderAt(1);

    await waitForReact(() => expect(mounted.host.querySelectorAll(".cv-git-row")).toHaveLength(2));
  });

  it("routes a thread commit through the ship actions with the exact selection", async () => {
    const memory = memoryGit([change("a.ts"), change("b.ts")]);
    const actions = shipActions();
    const idle: AgentShipState = { kind: "idle", status: null, loadingStatus: false };
    const value = rightPanelTestContext(
      {
        thread: surfaceThreadView({ ship: idle }),
        shipActions: actions,
        checkoutRoot: "/repo/.worktrees/agt-1",
      },
      { git: memory.git },
    );
    ui = mountUi();
    ui.render(
      <WithRightPanelContext value={value}>
        <AgentGitSurfaceContainer />
      </WithRightPanelContext>,
    );
    await waitForReact(() => expect(ui?.host.querySelectorAll(".cv-git-row")).toHaveLength(2));

    click(button(ui.host, "Include a.ts"));
    click(button(ui.host, "Commit"));

    await waitForReact(() =>
      expect(actions.onCommit).toHaveBeenCalledWith("agt-1", "fix(b): refactor the parser", {
        kind: "paths",
        relativePaths: ["b.ts"],
      }),
    );
    expect(memory.calls).toContain("status:/repo/.worktrees/agt-1");
    expect(memory.calls.some((call) => call.startsWith("commit:"))).toBe(false);
  });

  it("reports an in-place thread commit from the ship result and refreshes list and status", async () => {
    const memory = memoryGit([change("orders.ts"), change("notes.ts")]);
    const actions = shipActions();
    const refresh = vi.fn();
    const base = surfaceThreadView();
    const value = rightPanelTestContext(
      {
        thread: surfaceThreadView({
          thread: { ...base.thread, target: { isolation: "in-place", worktreePath: null } },
        }),
        shipActions: actions,
        checkoutRoot: "/repo",
        gitStatus: { load: { kind: "idle" }, refresh },
      },
      { git: memory.git },
    );
    ui = mountUi();
    ui.render(
      <WithRightPanelContext value={value}>
        <AgentGitSurfaceContainer />
      </WithRightPanelContext>,
    );
    await waitForReact(() => expect(ui?.host.querySelectorAll(".cv-git-row")).toHaveLength(2));
    const statusLoads = memory.calls.filter((call) => call === "status:/repo").length;

    click(button(ui.host, "Include notes.ts"));
    click(button(ui.host, "Commit"));

    await waitForReact(() => expect(ui?.host.textContent).toContain("Committed."));
    expect(actions.onCommit).toHaveBeenCalledWith("agt-1", "fix(orders): refactor the parser", {
      kind: "paths",
      relativePaths: ["orders.ts"],
    });
    expect(refresh).toHaveBeenCalled();
    await waitForReact(() =>
      expect(memory.calls.filter((call) => call === "status:/repo").length).toBeGreaterThan(
        statusLoads,
      ),
    );
  });

  it("shows the real push failure reason after a thread commit", async () => {
    const memory = memoryGit([change("a.ts")]);
    const actions = shipActions();
    actions.onPush = vi.fn(async (): Promise<AgentShipStepResult> => ({
      kind: "failed",
      failure: { step: "push", reason: "gitError", message: "No upstream is configured." },
    }));
    const value = rightPanelTestContext(
      { thread: surfaceThreadView(), shipActions: actions, checkoutRoot: "/repo" },
      { git: memory.git },
    );
    ui = mountUi();
    ui.render(
      <WithRightPanelContext value={value}>
        <AgentGitSurfaceContainer />
      </WithRightPanelContext>,
    );
    await waitForReact(() => expect(ui?.host.querySelectorAll(".cv-git-row")).toHaveLength(1));

    click(button(ui.host, "Commit & push"));

    await waitForReact(() =>
      expect(ui?.host.textContent).toContain(
        "Committed, but the push failed: No upstream is configured.",
      ),
    );
  });

  it("opens the pull request and history surfaces", async () => {
    const memory = memoryGit([change("a.ts")]);
    const openSurface = vi.fn();
    const value = rightPanelTestContext(
      {
        openSurface,
        gitStatus: {
          load: {
            kind: "ready",
            status: {
              branch: "feat/x",
              defaultBase: "main",
              hasRemote: true,
              upstream: { name: "origin/feat/x", ahead: 1, behind: 0 },
              unpushed: [],
              unpushedTruncated: false,
              lineStats: [{ relativePath: "a.ts", added: 3, deleted: 1 }],
              lineStatsTruncated: false,
              localBranches: ["feat/x", "main"],
              remoteBranches: [],
              worktreeBranches: [],
              branchesTruncated: false,
            },
          },
          refresh: () => undefined,
        },
      },
      { git: memory.git },
    );
    ui = mountUi();
    ui.render(
      <WithRightPanelContext value={value}>
        <AgentGitSurfaceContainer />
      </WithRightPanelContext>,
    );
    await waitForReact(() => expect(ui?.host.querySelectorAll(".cv-git-row")).toHaveLength(1));
    expect(ui.host.querySelector(".cv-git-row .cv-rp-stat")?.textContent).toBe("+3−1");

    click(button(ui.host, "Create pull request"));
    click(button(ui.host, "More Git actions"));
    const history = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (item) => item.textContent === "Show history",
    );
    click(history as HTMLButtonElement);

    expect(openSurface).toHaveBeenCalledWith("pullRequest");
    expect(openSurface).toHaveBeenCalledWith("history");
  });

  it("creates a branch in a new worktree from the picker and copies its path", async () => {
    const memory = memoryGit([]);
    const copied: string[] = [];
    const requests: string[] = [];
    const value = rightPanelTestContext(
      {
        copyText: async (text) => {
          copied.push(text);
        },
        gitStatus: { load: { kind: "ready", status: readyStatus() }, refresh: () => undefined },
      },
      {
        git: memory.git,
        worktrees: {
          addBranchWorktree: async (request) => {
            requests.push(`${request.repositoryRoot}:${request.branch}:${request.startPoint}`);
            return {
              worktreePath: "/repo/.worktrees/feat-y",
              branch: request.branch,
              trusted: true,
            };
          },
        },
      },
    );
    ui = mountUi();
    ui.render(
      <WithRightPanelContext value={value}>
        <AgentGitSurfaceContainer />
      </WithRightPanelContext>,
    );

    click(button(ui.host, "Branch: feat/x"));
    const name = document.querySelector<HTMLInputElement>('input[aria-label="New branch name"]');
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(name, "feat/y");
      name?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    click(document.querySelector('[role="switch"]') as HTMLElement);
    click(
      [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
        (candidate) => candidate.textContent === "Create",
      ) as HTMLButtonElement,
    );

    await waitForReact(() =>
      expect(ui?.host.textContent).toContain("Created a worktree at /repo/.worktrees/feat-y"),
    );
    expect(requests).toEqual(["/repo:feat/y:feat/x"]);
    click(button(ui.host, "Copy path"));
    await waitForReact(() => expect(copied).toEqual(["/repo/.worktrees/feat-y"]));
  });

  it("keeps a worktree thread on its own branch", async () => {
    const memory = memoryGit([]);
    const value = rightPanelTestContext(
      {
        thread: surfaceThreadView(),
        shipActions: shipActions(),
        gitStatus: { load: { kind: "ready", status: readyStatus() }, refresh: () => undefined },
      },
      { git: memory.git },
    );
    ui = mountUi();
    ui.render(
      <WithRightPanelContext value={value}>
        <AgentGitSurfaceContainer />
      </WithRightPanelContext>,
    );

    click(button(ui.host, "Branch: feat/x"));

    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((option) => option.getAttribute("aria-disabled") === "true")).toBe(true);
    const worktreeSwitch = document.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Check out in a new worktree"]',
    );
    expect(worktreeSwitch?.getAttribute("aria-checked")).toBe("true");
    expect(worktreeSwitch?.disabled).toBe(true);
  });
});

function readyStatus() {
  return {
    branch: "feat/x",
    defaultBase: "main",
    hasRemote: true,
    upstream: null,
    unpushed: [],
    unpushedTruncated: false,
    lineStats: [],
    lineStatsTruncated: false,
    localBranches: ["feat/x", "main"],
    remoteBranches: [],
    worktreeBranches: [],
    branchesTruncated: false,
  };
}
