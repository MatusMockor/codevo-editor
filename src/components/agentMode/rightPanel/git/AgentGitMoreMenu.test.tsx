// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentShipState } from "../../../../domain/agentShip";
import type { GitShipStatus } from "../../../../domain/gitIntegration";
import { click, mountUi, type MountedUi } from "../../../../ui/foundation/foundationTestSupport";
import { surfaceThreadView } from "../../agentSurfaceTestFixtures";
import type { AgentShipActions } from "../../useAgentShipActions";
import { AgentGitMoreMenu } from "./AgentGitMoreMenu";
import { AgentGitShipBanner } from "./AgentGitShipBanner";

let ui: MountedUi | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
});

const COMPARE_URL = "https://github.com/acme/orders/compare/main...agent/x?expand=1";

function status(overrides: Partial<GitShipStatus> = {}): GitShipStatus {
  return {
    worktree: { branch: "agent/x", head: "a".repeat(40), dirty: false, changeCount: 0 },
    primary: { branch: "main", head: "b".repeat(40), dirty: false },
    relation: { aheadOfPrimary: 2, behindPrimary: 0, fastForwardable: true },
    remote: { name: "origin", upstream: null, compareUrl: COMPARE_URL },
    ...overrides,
  };
}

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

function menuItem(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (item) => item.textContent?.trim() === text,
  );
  expect(found, text).toBeDefined();
  return found as HTMLButtonElement;
}

function menuTexts(): string[] {
  return [...document.querySelectorAll('[role="menuitem"]')].map(
    (item) => item.textContent?.trim() ?? "",
  );
}

function openMenu(host: HTMLElement): void {
  const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="More Git actions"]');
  expect(trigger).not.toBeNull();
  click(trigger as HTMLButtonElement);
}

describe("AgentGitMoreMenu", () => {
  it("keeps every ship action of a worktree thread", () => {
    const ship: AgentShipState = {
      kind: "pushed",
      status: status(),
      receipt: { remote: "origin", branch: "agent/x", compareUrl: COMPARE_URL },
    };
    const thread = surfaceThreadView({ ship });
    const handlers = actions();
    const onRefresh = vi.fn();
    const onShowHistory = vi.fn();
    ui = mountUi();
    ui.render(
      <AgentGitMoreMenu
        actions={handlers}
        onRefresh={onRefresh}
        onShowHistory={onShowHistory}
        thread={thread}
      />,
    );

    openMenu(ui.host);
    expect(menuTexts()).toEqual([
      "Push branch",
      "Open compare page on GitHub",
      "Integrate into main (fast-forward)",
      "Integrate into main (merge commit)",
      "Remove worktree",
      "Remove worktree and branch",
      "Discard worktree",
      "Refresh status",
      "Show history",
    ]);
    click(menuItem("Push branch"));
    openMenu(ui.host);
    click(menuItem("Open compare page on GitHub"));
    openMenu(ui.host);
    click(menuItem("Integrate into main (fast-forward)"));
    openMenu(ui.host);
    click(menuItem("Integrate into main (merge commit)"));
    openMenu(ui.host);
    click(menuItem("Remove worktree"));
    openMenu(ui.host);
    click(menuItem("Discard worktree"));
    openMenu(ui.host);
    click(menuItem("Refresh status"));
    openMenu(ui.host);
    click(menuItem("Show history"));

    expect(handlers.onPush).toHaveBeenCalledWith("agt-1");
    expect(handlers.onOpenCompareUrl).toHaveBeenCalledWith("agt-1");
    expect(handlers.onIntegrate).toHaveBeenNthCalledWith(1, "agt-1", "fastForward");
    expect(handlers.onIntegrate).toHaveBeenNthCalledWith(2, "agt-1", "merge");
    expect(handlers.onRemoveWorktree).toHaveBeenCalledWith("agt-1", { deleteBranch: false });
    expect(handlers.onDiscardWorktree).toHaveBeenCalledWith("agt-1");
    expect(handlers.onRefreshShipStatus).toHaveBeenCalledWith("agt-1");
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onShowHistory).toHaveBeenCalledTimes(1);
  });

  it("removes the worktree and branch only after integration", () => {
    const ship: AgentShipState = {
      kind: "integrated",
      status: status(),
      mergeSha: "c".repeat(40),
      intoBranch: "main",
    };
    const handlers = actions();
    ui = mountUi();
    ui.render(
      <AgentGitMoreMenu
        actions={handlers}
        onRefresh={vi.fn()}
        onShowHistory={vi.fn()}
        thread={surfaceThreadView({ ship })}
      />,
    );

    openMenu(ui.host);
    click(menuItem("Remove worktree and branch"));

    expect(handlers.onRemoveWorktree).toHaveBeenCalledWith("agt-1", { deleteBranch: true });
  });

  it("blocks a branch removal before integration and explains why", () => {
    const handlers = actions();
    ui = mountUi();
    ui.render(
      <AgentGitMoreMenu
        actions={handlers}
        onRefresh={vi.fn()}
        onShowHistory={vi.fn()}
        thread={surfaceThreadView({
          ship: { kind: "idle", status: status(), loadingStatus: false },
        })}
      />,
    );

    openMenu(ui.host);
    const item = menuItem("Remove worktree and branch");
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(item.closest("[title]")?.getAttribute("title")).not.toBe("");
    click(item);
    expect(handlers.onRemoveWorktree).not.toHaveBeenCalled();
  });

  it("offers only refresh and history for a project or an in-place thread", () => {
    ui = mountUi();
    ui.render(
      <AgentGitMoreMenu actions={null} onRefresh={vi.fn()} onShowHistory={vi.fn()} thread={null} />,
    );
    openMenu(ui.host);
    expect(menuTexts()).toEqual(["Refresh status", "Show history"]);
    ui.unmount();

    ui = mountUi();
    const local = surfaceThreadView({
      thread: {
        ...surfaceThreadView().thread,
        target: { isolation: "in-place", worktreePath: null },
      },
    });
    ui.render(
      <AgentGitMoreMenu
        actions={actions()}
        onRefresh={vi.fn()}
        onShowHistory={vi.fn()}
        thread={local}
      />,
    );
    openMenu(ui.host);
    expect(menuTexts()).toEqual(["Push branch", "Refresh status", "Show history"]);
  });
});

describe("AgentGitShipBanner", () => {
  it("shows a conflicted integration with its files and retries or dismisses it", () => {
    const ship: AgentShipState = {
      kind: "failed",
      status: status(),
      resumeFrom: "pushed",
      failure: {
        step: "integrate",
        outcome: { kind: "conflicted", files: ["src/a.ts", "src/b.ts"], truncated: false },
      },
    };
    const handlers = actions();
    ui = mountUi();
    ui.render(<AgentGitShipBanner actions={handlers} thread={surfaceThreadView({ ship })} />);

    const alert = ui.host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("integration failed");
    expect(alert?.textContent).toContain("src/a.ts");
    click(ui.host.querySelector('button[aria-label="Retry integrate"]') as HTMLButtonElement);
    click(ui.host.querySelector('button[aria-label="Dismiss"]') as HTMLButtonElement);

    expect(handlers.onIntegrate).toHaveBeenCalledWith("agt-1", "fastForward");
    expect(handlers.onDismissFailure).toHaveBeenCalledWith("agt-1");
  });

  it("retries a failed push", () => {
    const ship: AgentShipState = {
      kind: "failed",
      status: status(),
      resumeFrom: "committed",
      failure: { step: "push", reason: "authRequired", message: "denied" },
    };
    const handlers = actions();
    ui = mountUi();
    ui.render(<AgentGitShipBanner actions={handlers} thread={surfaceThreadView({ ship })} />);

    click(ui.host.querySelector('button[aria-label="Retry push"]') as HTMLButtonElement);
    expect(handlers.onPush).toHaveBeenCalledWith("agt-1");
  });

  it("shows the running step and the branch relation", () => {
    ui = mountUi();
    ui.render(
      <AgentGitShipBanner
        actions={actions()}
        thread={surfaceThreadView({
          ship: { kind: "pushing", status: status(), commitSha: null, resumeFrom: "committed" },
        })}
      />,
    );
    expect(ui.host.textContent).toContain("Pushing the branch…");
    expect(ui.host.textContent).toContain("2 ahead · 0 behind main");
  });

  it("leaves commit failures to the commit box notice", () => {
    ui = mountUi();
    ui.render(
      <AgentGitShipBanner
        actions={actions()}
        thread={surfaceThreadView({
          ship: {
            kind: "failed",
            status: null,
            resumeFrom: "idle",
            failure: { step: "commit", reason: "staleSelection", message: "changed" },
          },
        })}
      />,
    );
    expect(ui.host.querySelector('[role="alert"]')).toBeNull();
  });
});
