// @vitest-environment jsdom

import { defaultAgentLaunchOptions } from "../../domain/agentLaunch";
import { agentThreadAttention, agentThreadUnread } from "../../domain/agentThread";
import { act, memo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentProjectDescriptor, AgentProjectOrigin } from "../../domain/agentProject";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import type { AgentCliKind, AgentTaskIsolation } from "../../domain/agentTask";
import type { AgentThreadScriptRunner } from "../../application/useAgentThreadScripts";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import { defaultAgentCliDiscoveryResult } from "../../domain/agentSettings";
import type { AgentShipState } from "../../domain/agentShip";
import type { AgentThread, AgentTurn, AgentTurnStatus } from "../../domain/agentThread";
import type { DirectoryListingGateway } from "../../domain/directoryListing";
import type { GitChangedFile } from "../../domain/git";
import type { ResolvedGitRepository } from "../../domain/gitRepositoryMapping";
import type { AgentTurnEvent } from "../../domain/agentThread";
import { createAgentViewCommandBridge } from "../../application/agentViewCommandBridge";
import { workbenchAgentCommands } from "../../application/workbenchAgentCommands";
import { AgentModeView, type AgentModeViewProps } from "./AgentModeView";
import { WorkbenchFrameResponsiveContext } from "../workbenchFrameResponsiveContext";
import type { ResponsivePanelRestore } from "../../domain/agentWorkbenchResponsiveLayout";
import {
  chromeFixture,
  recordedLayoutState,
  reduceRecordedLayout,
} from "./agentWorkbenchChromeTestFixtures";
import { waitForReact } from "../../test/reactTestLifecycle";
import { agentCompactTimeLabel, agentRailScopeValue } from "./agentSidebarPresentation";
import { externalSessionsSurfaceFixture } from "./agentThreadsSurfaceTestFixtures";
import type { ExternalAgentSessionView } from "../../domain/externalAgentSession";
import { AGENT_THREAD_FIND_DEBOUNCE_MS } from "./useAgentThreadFind";
import type { AgentThreadRevealRequest } from "./agentSidebarPresentation";

const ROOT = "/workspace/app";
const NESTED = "/workspace/app/packages/api";
const OTHER_ROOT = "/workspace/api-service";
const NOW_TICK_MS = 3_600_000;
const ADD_PROJECT_HOME = "/Users/dev";
const NOW = 1_700_000_600_000;

const columnRenders = vi.hoisted(() => ({
  composer: 0,
  diff: 0,
  files: 0,
  header: 0,
  session: 0,
  sidebar: 0,
  surface: 0,
  terminal: 0,
}));
const sessionReveals = vi.hoisted((): Array<AgentThreadRevealRequest | null> => []);

vi.mock("./AgentSurfaceDiff", () => ({
  AgentSurfaceDiff: (props: {
    readonly thread: { readonly thread: { readonly threadId: string } };
    readonly summary: { readonly files: ReadonlyArray<unknown> } | null;
    onOpenChangedFile(threadId: string, change: unknown): void;
    onOpenChangedFileDiff(threadId: string, change: unknown): void;
  }) => {
    columnRenders.diff += 1;
    const threadId = props.thread.thread.threadId;
    const change = props.summary?.files[0];
    return (
      <div data-mock-diff={threadId}>
        <button
          data-open-file
          onClick={() => props.onOpenChangedFile(threadId, change)}
          type="button"
        />
        <button
          data-open-diff
          onClick={() => props.onOpenChangedFileDiff(threadId, change)}
          type="button"
        />
      </div>
    );
  },
}));

vi.mock("./AgentSurfaceFileTree", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./AgentSurfaceFileTree")>();
  return {
    ...actual,
    AgentSurfaceFileTree: memo((props: Parameters<typeof actual.AgentSurfaceFileTree>[0]) => {
      columnRenders.files += 1;
      return <actual.AgentSurfaceFileTree {...props} />;
    }),
  };
});

vi.mock("./AgentSurfaceTerminal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./AgentSurfaceTerminal")>();
  return {
    ...actual,
    AgentSurfaceTerminal: memo((props: Parameters<typeof actual.AgentSurfaceTerminal>[0]) => {
      columnRenders.terminal += 1;
      return <actual.AgentSurfaceTerminal {...props} />;
    }),
  };
});

vi.mock("./AgentThreadSession", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./AgentThreadSession")>();
  return {
    ...actual,
    AgentThreadSession: memo((props: Parameters<typeof actual.AgentThreadSession>[0]) => {
      columnRenders.session += 1;
      sessionReveals.push(props.reveal ?? null);
      return <actual.AgentThreadSession {...props} />;
    }),
  };
});

vi.mock("./AgentComposer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./AgentComposer")>();
  return {
    ...actual,
    AgentComposer: (props: Parameters<typeof actual.AgentComposer>[0]) => {
      columnRenders.composer += 1;
      return <actual.AgentComposer {...props} />;
    },
  };
});

vi.mock("./AgentThreadHeader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./AgentThreadHeader")>();
  return {
    ...actual,
    AgentThreadHeader: memo((props: Parameters<typeof actual.AgentThreadHeader>[0]) => {
      columnRenders.header += 1;
      return <actual.AgentThreadHeader {...props} />;
    }),
  };
});

vi.mock("./AgentThreadsSidebar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./AgentThreadsSidebar")>();
  return {
    ...actual,
    AgentThreadsSidebar: memo((props: Parameters<typeof actual.AgentThreadsSidebar>[0]) => {
      columnRenders.sidebar += 1;
      return <actual.AgentThreadsSidebar {...props} />;
    }),
  };
});

vi.mock("./AgentSurfaceHost", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./AgentSurfaceHost")>();
  return {
    ...actual,
    AgentSurfaceHost: memo((props: Parameters<typeof actual.AgentSurfaceHost>[0]) => {
      columnRenders.surface += 1;
      return <actual.AgentSurfaceHost {...props} />;
    }),
  };
});

describe("AgentModeView", () => {
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
    sessionReveals.length = 0;
    document.querySelectorAll('[role="menu"]').forEach((menu) => menu.remove());
  });

  it("renders the three columns of the threads layout", () => {
    render();

    expect(host.querySelector('section[aria-label="Agent mode"]')).not.toBeNull();
    expect(host.querySelector('aside[aria-label="Agent threads"]')).not.toBeNull();
    expect(host.querySelector('section[aria-label="New agent thread"]')).not.toBeNull();
    expect(host.querySelector("[data-agent-thread-head]")).not.toBeNull();
    expect(host.querySelector(".agent-info")).toBeNull();
    expect(host.querySelector('form[aria-label="New agent thread"]')).not.toBeNull();
  });

  it("surfaces the agent CLI notice with a settings deep link and a dismiss action", () => {
    const configureAgentCli = vi.fn();
    const dismissNotice = vi.fn();
    render({
      agents: surface({
        configureAgentCli,
        dismissNotice,
        notice: {
          kind: "error",
          message: "Set the agent CLI path in Settings.",
          action: "configure-agent-cli",
        },
      }),
    });

    expect(host.textContent).toContain("Set the agent CLI path in Settings.");
    click('[aria-label="Open agent settings"]');
    click('[aria-label="Dismiss agent notice"]');

    expect(configureAgentCli).toHaveBeenCalledTimes(1);
    expect(dismissNotice).toHaveBeenCalledTimes(1);
  });

  it("routes rail settings and source control through their real workbench actions", () => {
    const configureAgentCli = vi.fn();
    const onOpenSourceControl = vi.fn();
    render({
      agents: surface({ configureAgentCli }),
      onOpenSourceControl,
    });

    click('button[aria-label="Open provider settings"]');
    click('button[aria-label="Open Source Control"]');

    expect(configureAgentCli).toHaveBeenCalledTimes(1);
    expect(onOpenSourceControl).toHaveBeenCalledTimes(1);
  });

  it("routes an available provider update toast through exact management actions", async () => {
    const management = providerManagement();
    const update = vi.fn(async () => null);
    const dismissUpdate = vi.fn(async () => true);
    const withToast: AgentProviderManagementSurface = {
      ...management,
      toast: { kind: "updateAvailable", provider: "codex", version: "0.150.1" },
      dismissUpdate,
      update,
    };
    render({ agents: surface({ providerManagement: withToast }) });

    expect(host.textContent).toContain("Update available: Codex v0.150.1");
    await act(async () => {
      buttonWithText("Update").click();
      await Promise.resolve();
    });
    expect(update).toHaveBeenCalledWith("codex", "0.150.1");

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="Dismiss notification"]')?.click();
      await Promise.resolve();
    });
    expect(dismissUpdate).toHaveBeenCalledWith("codex", "0.150.1");
  });

  it("keeps a notice without a settings action free of the deep link", () => {
    render({
      agents: surface({
        notice: { kind: "warning", message: "The agent limit is reached.", action: null },
      }),
    });

    expect(host.textContent).toContain("The agent limit is reached.");
    expect(host.querySelector('[aria-label="Open agent settings"]')).toBeNull();
  });

  it("blocks the dispatch until the prompt has content", () => {
    render();

    expect(submitButton().disabled).toBe(true);

    typePrompt("Fix the parser");

    expect(submitButton().disabled).toBe(false);
  });

  it("starts a thread with the recommended isolation of the selected repository", () => {
    const startThread = vi.fn(async () => ({ threadId: "agt-new" }));
    render({
      agents: surface({
        startThread,
        isolationPreview: (repositoryRoot: string) => ({
          repositoryRoot,
          recommended: { kind: "worktree", reason: "dirty-tree" },
          inPlaceGuard: { kind: "unsafe", reasons: ["dirty-tree"] },
          inPlaceAllowed: true,
          confirmationKey: "dirty-preview-key",
        }),
      }),
    });

    expect(host.textContent).toContain("The working tree has uncommitted changes.");

    typePrompt("Fix the parser");
    submitForm();

    expect(startThread).toHaveBeenCalledWith({
      projectRootKey: ROOT,
      repositoryRoot: ROOT,
      prompt: "Fix the parser",
      isolation: "worktree",
      unsafeInPlaceConfirmationKey: null,
      launch: defaultAgentLaunchOptions("claudeCode"),
      dangerousLaunchConfirmed: false,
    });
  });

  it("blocks an unsafe in-place start until it is confirmed", () => {
    const startThread = vi.fn(async () => ({ threadId: "agt-new" }));
    render({
      agents: surface({
        startThread,
        isolationPreview: (repositoryRoot: string) => ({
          repositoryRoot,
          recommended: { kind: "worktree", reason: "dirty-tree" },
          inPlaceGuard: { kind: "unsafe", reasons: ["dirty-tree"] },
          inPlaceAllowed: true,
          confirmationKey: "dirty-preview-key",
        }),
      }),
    });

    typePrompt("Fix the parser");
    pickOption("agent-checkout", "in-place");

    expect(submitButton().disabled).toBe(true);

    toggleCheckbox("agent-unsafe-confirm", true);

    expect(submitButton().disabled).toBe(false);

    submitForm();

    expect(startThread).toHaveBeenCalledWith({
      projectRootKey: ROOT,
      repositoryRoot: ROOT,
      prompt: "Fix the parser",
      isolation: "in-place",
      unsafeInPlaceConfirmationKey: "dirty-preview-key",
      launch: defaultAgentLaunchOptions("claudeCode"),
      dangerousLaunchConfirmed: false,
    });
  });

  it("starts a thread in the repository chosen in the composer", () => {
    const startThread = vi.fn(async () => ({ threadId: "agt-new" }));
    render({ agents: surface({ startThread }) });

    pickOption("agent-repository", NESTED);
    typePrompt("Update the router");
    submitForm();

    expect(startThread).toHaveBeenCalledWith({
      projectRootKey: ROOT,
      repositoryRoot: NESTED,
      prompt: "Update the router",
      isolation: "in-place",
      unsafeInPlaceConfirmationKey: null,
      launch: defaultAgentLaunchOptions("claudeCode"),
      dangerousLaunchConfirmed: false,
    });
  });

  it("clears the prompt and opens the created thread after a start", async () => {
    const startThread = vi.fn(async () => ({ threadId: "agt-1" }));
    render({ agents: surface({ startThread }) });

    typePrompt("Fix the parser");
    await submitFormAsync();

    expect(promptField().value).toBe("");

    render({ agents: surface({ startThread, threads: [threadView({ threadId: "agt-1" })] }) });

    expect(host.querySelector('section[aria-label="Agent thread agt-1"]')).not.toBeNull();
    expect(host.querySelector('[aria-current="true"]')).not.toBeNull();
  });

  it("keeps the prompt when the start is refused", async () => {
    const startThread = vi.fn(async () => null);
    render({ agents: surface({ startThread }) });

    typePrompt("Fix the parser");
    await submitFormAsync();

    expect(promptField().value).toBe("Fix the parser");
  });

  it("opens only the exact started thread when another unknown thread arrives concurrently", async () => {
    let resolveStart: ((result: { readonly threadId: string }) => void) | null = null;
    const startThread = vi.fn(
      () =>
        new Promise<{ readonly threadId: string } | null>((resolve) => {
          resolveStart = resolve;
        }),
    );
    render({
      agents: surface({ startThread, threads: [threadView({ threadId: "agt-existing" })] }),
    });

    typePrompt("Fix the parser");
    submitForm();
    render({
      agents: surface({
        startThread,
        threads: [
          threadView({ threadId: "agt-existing" }),
          threadView({ threadId: "agt-recovered-foreign" }),
          threadView({ threadId: "agt-started" }),
        ],
      }),
    });

    await act(async () => {
      resolveStart?.({ threadId: "agt-started" });
      await Promise.resolve();
    });

    expect(host.querySelector('section[aria-label="Agent thread agt-started"]')).not.toBeNull();
    expect(
      host.querySelector('section[aria-label="Agent thread agt-recovered-foreign"]'),
    ).toBeNull();
  });

  it("reads the branch status once for a selected thread whose status is unread", () => {
    const refreshShipStatus = vi.fn(async () => undefined);
    render({
      agents: surface({ refreshShipStatus, threads: [threadView({ threadId: "agt-1" })] }),
    });

    expect(refreshShipStatus).not.toHaveBeenCalled();

    clickText("Refactor the parser");
    typePrompt("Also update the tests");

    expect(refreshShipStatus).toHaveBeenCalledTimes(1);
    expect(refreshShipStatus).toHaveBeenCalledWith("agt-1");
  });

  it("leaves a selected thread with a loaded status and a gone worktree alone", () => {
    const refreshShipStatus = vi.fn(async () => undefined);
    render({
      agents: surface({
        refreshShipStatus,
        threads: [threadView({ threadId: "agt-1", ship: loadedShip() })],
      }),
    });
    clickText("Refactor the parser");
    expect(refreshShipStatus).not.toHaveBeenCalled();

    render({
      agents: surface({
        refreshShipStatus,
        threads: [
          threadView({ threadId: "agt-2", title: "Rename the lexer", worktreeMissing: true }),
        ],
      }),
    });
    clickText("Rename the lexer");
    expect(refreshShipStatus).not.toHaveBeenCalled();
  });

  it("puts the composer in follow-up mode for the selected thread", () => {
    render({ agents: surface({ threads: [threadView({ threadId: "agt-1" })] }) });

    clickText("Refactor the parser");

    expect(host.querySelector('form[aria-label="Follow up on agent thread"]')).not.toBeNull();
    expect(host.querySelector("button#agent-repository")).toBeNull();
    expect(host.querySelector("button#agent-checkout")).toBeNull();
    expect(submitButton().textContent).toContain("Send");
  });

  it("sends a follow-up into the selected thread and clears the prompt", async () => {
    const sendFollowUp = vi.fn(async () => true);
    render({ agents: surface({ sendFollowUp, threads: [threadView({ threadId: "agt-1" })] }) });

    clickText("Refactor the parser");
    typePrompt("Also update the tests");
    await submitFormAsync();

    expect(sendFollowUp).toHaveBeenCalledWith({
      threadId: "agt-1",
      prompt: "Also update the tests",
      launch: defaultAgentLaunchOptions("claudeCode"),
      dangerousLaunchConfirmed: false,
    });
    expect(promptField().value).toBe("");
  });

  it("keeps the prompt when the follow-up is refused", async () => {
    const sendFollowUp = vi.fn(async () => false);
    render({ agents: surface({ sendFollowUp, threads: [threadView({ threadId: "agt-1" })] }) });

    clickText("Refactor the parser");
    typePrompt("Also update the tests");
    await submitFormAsync();

    expect(promptField().value).toBe("Also update the tests");
  });

  it("blocks a follow-up into a thread without a resumable session", () => {
    render({
      agents: surface({
        threads: [threadView({ threadId: "agt-1", sessionId: null })],
      }),
    });

    clickText("Refactor the parser");
    typePrompt("Also update the tests");

    expect(host.textContent).toContain("This thread has no resumable session");
    expect(submitButton().disabled).toBe(true);
  });

  it("blocks a follow-up while the thread is still running", () => {
    render({
      agents: surface({
        threads: [threadView({ threadId: "agt-1", status: { kind: "running" } })],
      }),
    });

    clickText("Refactor the parser");
    typePrompt("Also update the tests");

    expect(host.textContent).toContain("This thread is still running");
    expect(submitButton().disabled).toBe(true);
  });

  it("blocks a follow-up when the worktree is gone", () => {
    render({
      agents: surface({
        threads: [threadView({ threadId: "agt-1", worktreeMissing: true })],
      }),
    });

    clickText("Refactor the parser");

    expect(host.textContent).toContain("The worktree for this thread no longer exists.");
    expect(submitButton().disabled).toBe(true);
  });

  it("keeps a follow-up bound to its original provider after the default changes", () => {
    render({
      agents: surface({
        agentCliKind: "codex",
        threads: [threadView({ threadId: "agt-1", providerKind: "claudeCode" })],
      }),
    });

    clickText("Refactor the parser");
    typePrompt("Also update the tests");

    expect(host.textContent).not.toContain("This thread was started with Claude Code");
    expect(submitButton().disabled).toBe(false);
  });

  it("blocks a follow-up while the concurrent agent limit is reached", () => {
    render({
      agents: surface({
        liveTaskCount: 2,
        maxConcurrentAgentTasks: 2,
        threads: [threadView({ threadId: "agt-1" })],
      }),
    });

    clickText("Refactor the parser");
    typePrompt("Also update the tests");

    expect(host.textContent).toContain("The concurrent agent limit is reached");
    expect(submitButton().disabled).toBe(true);
  });

  it("escapes back to a new thread from the composer", () => {
    render({ agents: surface({ threads: [threadView({ threadId: "agt-1" })] }) });

    clickText("Refactor the parser");
    click(".agent-composer__new");

    expect(host.querySelector('form[aria-label="New agent thread"]')).not.toBeNull();
    expect(host.querySelector('section[aria-label="New agent thread"]')).not.toBeNull();
  });

  it("reports orphaned worktrees as a single muted note under the scope menu", () => {
    render({
      agents: surface({
        orphanedWorktrees: [
          {
            repositoryRoot: ROOT,
            worktreePath: `${ROOT}/.worktrees/agt-9`,
            branch: "agent/agt-9",
            prunable: false,
            removing: false,
          },
        ],
      }),
    });

    expect(host.querySelector(".agent-rail__note")?.textContent).toBe("1 orphaned worktree");
    expect(host.querySelector("[data-thread-id]")).toBeNull();
  });

  it("routes stop, archive and remove through the thread title menu", () => {
    const stop = vi.fn(async () => undefined);
    const archive = vi.fn();
    const remove = vi.fn();
    render({
      agents: surface({
        archive,
        remove,
        stop,
        threads: [threadView({ threadId: "agt-1", status: { kind: "running" } })],
      }),
    });

    clickText("Refactor the parser");
    click('[aria-label="Thread actions for Refactor the parser"]');
    clickMenuItem("Stop");

    expect(stop).toHaveBeenCalledWith("agt-1");

    render({ agents: surface({ archive, remove, stop, threads: [threadView({})] }) });

    clickText("Refactor the parser");
    click('[aria-label="Thread actions for Refactor the parser"]');
    clickMenuItem("Archive");
    click('[aria-label="Thread actions for Refactor the parser"]');
    clickMenuItem("Delete");

    expect(archive).toHaveBeenCalledWith("agt-1");
    expect(remove).toHaveBeenCalledWith("agt-1");
  });

  it("routes every ship action of the selected thread to the surface", () => {
    const refreshShipStatus = vi.fn(async () => undefined);
    const commitThreadChanges = vi.fn(async () => undefined);
    const pushThreadBranch = vi.fn(async () => undefined);
    const removeThreadWorktree = vi.fn(async () => undefined);
    const removeWorktree = vi.fn(async () => undefined);
    const resetThreadShip = vi.fn();
    render({
      agents: surface({
        commitThreadChanges,
        pushThreadBranch,
        refreshShipStatus,
        removeThreadWorktree,
        removeWorktree,
        resetThreadShip,
        threads: [threadView({ threadId: "agt-1" })],
      }),
    });

    clickText("Refactor the parser");
    click('button[aria-label="Ship options"]');
    click('[aria-label="Refresh the branch status of agent agt-1"]');
    click('[aria-label="Commit changes"]');
    click('[aria-label="Push branch"]');
    click('[aria-label="Remove worktree"]');
    click('[aria-label="Discard the worktree of agent agt-1"]');

    expect(refreshShipStatus).toHaveBeenCalledWith("agt-1");
    expect(commitThreadChanges).toHaveBeenCalledWith("agt-1", "Refactor the parser");
    expect(pushThreadBranch).toHaveBeenCalledWith("agt-1");
    expect(removeThreadWorktree).toHaveBeenCalledWith("agt-1", { deleteBranch: false });
    expect(removeWorktree).toHaveBeenCalledWith("agt-1");
  });

  it("toggles the right panel from the header with and without a thread", () => {
    const layout = recordedLayoutState();
    render({
      chrome: chromeFixture({ layout }),
      agents: surface({ threads: [threadView({ threadId: "agt-1" })] }),
    });

    const toggle = host.querySelector<HTMLButtonElement>(
      '[data-agent-thread-head] button[aria-label^="Toggle right panel"]',
    );
    expect(toggle).not.toBeNull();
    expect(toggle?.disabled).toBe(false);
    act(() => toggle?.click());
    clickText("Refactor the parser");
    click('[data-agent-thread-head] button[aria-label^="Toggle right panel"]');

    expect(layout.actions).toEqual([{ kind: "toggleRightPanel" }, { kind: "toggleRightPanel" }]);
    expect(reduceRecordedLayout(layout)).toMatchObject({
      rightPanel: "closed",
      openSurfaces: [],
      activeSurface: null,
    });
  });

  it("drives the surface tabs: open, add by command, switch, close and maximize", async () => {
    const threads = [threadView({ threadId: "agt-1" })];
    let layout = recordedLayoutState();
    const rerender = (): void => {
      layout = recordedLayoutState(reduceRecordedLayout(layout));
      render({ chrome: chromeFixture({ layout }), agents: surface({ threads }) });
    };
    render({ chrome: chromeFixture({ layout }), agents: surface({ threads }) });

    clickText("Refactor the parser");
    click('[data-agent-thread-head] button[aria-label^="Toggle right panel"]');
    rerender();
    expect(host.querySelector(".agent-surface-empty__title")?.textContent).toBe("Open a surface");
    expect(host.querySelectorAll(".agent-surface-card")).toHaveLength(3);
    expect(host.querySelector('[aria-label^="Expand to editor"]')).toBeNull();

    click('[aria-label="Open Files surface"]');
    rerender();
    expect(surfaceTabs()).toEqual(["Files"]);
    expect(activeSurfaceTab()).toBe("Files");

    expect(host.querySelector('.agent-surface [aria-label="Add surface"]')).toBeNull();

    act(() => layout.dispatch({ kind: "openSurface", surface: "diff" }));
    rerender();
    await waitForReact(() => expect(host.querySelector("[data-mock-diff]")).not.toBeNull());
    expect(surfaceTabs()).toEqual(["Files", "Diff"]);
    expect(activeSurfaceTab()).toBe("Diff");

    click("#agent-surface-tab-files");
    rerender();
    expect(activeSurfaceTab()).toBe("Files");
    expect(host.querySelector("[data-mock-diff]")).not.toBeNull();
    expect(host.querySelector('[data-surface-panel="diff"]')?.hasAttribute("hidden")).toBe(true);

    click('[aria-label="Close Diff tab"]');
    rerender();
    expect(surfaceTabs()).toEqual(["Files"]);
    expect(activeSurfaceTab()).toBe("Files");
    expect(host.querySelector("[data-mock-diff]")).toBeNull();

    click('.agent-surface [aria-label="Maximize panel"]');
    rerender();
    expect(reduceRecordedLayout(layout).rightPanelMaximized).toBe(true);
    expect(agentModeSection()?.hasAttribute("data-right-panel")).toBe(false);
    expect(host.querySelector('.agent-surface [aria-label="Restore panel"]')).not.toBeNull();

    click('.agent-surface [aria-label="Restore panel"]');
    rerender();
    expect(reduceRecordedLayout(layout).rightPanelMaximized).toBe(false);

    click('[aria-label="Close Files tab"]');
    rerender();
    expect(surfaceTabs()).toEqual([]);
    expect(host.querySelector(".agent-surface-empty__title")?.textContent).toBe("Open a surface");
    expect(host.querySelector('.agent-surface [aria-label="Close panel"]')).toBeNull();
  });

  it.each([
    { responsivePanelRestore: "collapseRail", expectedKind: "toggleRail" },
    { responsivePanelRestore: "closePanel", expectedKind: "toggleRightPanel" },
  ] as const)(
    "makes a responsive maximized panel restore through $expectedKind",
    ({ expectedKind, responsivePanelRestore }) => {
      const layout = recordedLayoutState({
        rightPanel: "open",
        openSurfaces: ["files"],
        activeSurface: "files",
      });
      render({ chrome: chromeFixture({ layout }) }, responsivePanelRestore);

      click('.agent-surface [aria-label="Restore panel"]');

      expect(layout.actions).toContainEqual({ kind: expectedKind });
      expect(layout.actions).not.toContainEqual({ kind: "toggleMaximized" });
    },
  );

  it("clears a persisted maximize preference while restoring a responsive panel", () => {
    const layout = recordedLayoutState({
      rightPanel: "open",
      rightPanelMaximized: true,
      openSurfaces: ["files"],
      activeSurface: "files",
    });
    render({ chrome: chromeFixture({ layout }) }, "collapseRail");

    click('.agent-surface [aria-label="Restore panel"]');

    expect(layout.actions).toEqual([{ kind: "toggleMaximized" }, { kind: "toggleRail" }]);
  });

  it("toggles the panel from the PanelRight control and preserves its surface tabs", async () => {
    const threads = [threadView({ threadId: "agt-1" })];
    let layout = recordedLayoutState({
      rightPanel: "open",
      openSurfaces: ["files", "diff"],
      activeSurface: "diff",
    });
    const rerender = (): void => {
      layout = recordedLayoutState(reduceRecordedLayout(layout));
      render({ chrome: chromeFixture({ layout }), agents: surface({ threads }) });
    };
    render({ chrome: chromeFixture({ layout }), agents: surface({ threads }) });
    clickText("Refactor the parser");
    await waitForReact(() => expect(host.querySelector("[data-mock-diff]")).not.toBeNull());

    expect(host.querySelector('.agent-surface [aria-label="Close panel"]')).toBeNull();
    click('.agent-surface button[aria-label^="Toggle right panel"]');
    expect(layout.actions).toEqual([{ kind: "toggleRightPanel" }]);
    rerender();

    expect(reduceRecordedLayout(layout)).toMatchObject({
      rightPanel: "closed",
      openSurfaces: ["files", "diff"],
      activeSurface: "diff",
      rightPanelMaximized: false,
    });
    expect(host.querySelector('[data-slot="surface"]')?.hasAttribute("hidden")).toBe(true);
    expect(host.querySelector("[data-mock-diff]")).not.toBeNull();

    click('[data-agent-thread-head] button[aria-label^="Toggle right panel"]');
    expect(layout.actions).toEqual([{ kind: "toggleRightPanel" }]);
    rerender();

    expect(host.querySelector('[data-slot="surface"]')?.hasAttribute("hidden")).toBe(false);
    expect(surfaceTabs()).toEqual(["Files", "Diff"]);
    expect(activeSurfaceTab()).toBe("Diff");
  });

  it("places the surface host from the effective layout, not the reducer layout", () => {
    const docked = recordedLayoutState({
      rightPanel: "open",
      openSurfaces: ["diff"],
      activeSurface: "diff",
    });
    render({
      agents: surface({ threads: [threadView({ threadId: "agt-1" })] }),
      chrome: chromeFixture({ layout: docked }),
    });
    expect(host.querySelector('[data-slot="surface"]')).not.toBeNull();

    const forcedEditor = recordedLayoutState(
      { rightPanel: "open", openSurfaces: ["diff"], activeSurface: "diff" },
      false,
      "editor-expanded",
    );
    render({
      agents: surface({ threads: [threadView({ threadId: "agt-1" })] }),
      chrome: chromeFixture({ layout: forcedEditor }),
    });

    expect(host.querySelector('[data-slot="surface"]')).toBeNull();
  });

  it("hands the rail state to the layout so the shell frame owns the rail track", () => {
    const layout = recordedLayoutState();
    render({
      agents: surface({ threads: [threadView({ threadId: "agt-1" })] }),
      chrome: chromeFixture({ layout }),
    });

    expect(agentModeSection()?.hasAttribute("data-rail")).toBe(false);
    expect(
      agentModeSection()?.querySelector(".agent-mode__grid")?.getAttribute("style"),
    ).toBeNull();

    click('[aria-label="Collapse sidebar"]');

    expect(layout.actions).toEqual([{ kind: "toggleRail" }]);
    expect(reduceRecordedLayout(layout).rail).toBe("collapsed");
  });

  it("routes the right panel command to the plain layout action", async () => {
    const bridge = createAgentViewCommandBridge();
    const layout = recordedLayoutState();
    render({
      chrome: chromeFixture({ layout }),
      agents: surface({ threads: [threadView({ threadId: "agt-1" })] }),
      viewCommands: bridge,
    });
    const commands = workbenchAgentCommands({ agentLayout: layout, viewCommands: bridge });
    const toggleCommand = commands.find((command) => command.id === "agent.toggleRightPanel");

    await toggleCommand?.run();
    clickText("Refactor the parser");
    await toggleCommand?.run();

    expect(layout.actions).toEqual([{ kind: "toggleRightPanel" }, { kind: "toggleRightPanel" }]);
  });

  it("renders the empty surface panel with only Files enabled while no thread is selected", () => {
    const layout = recordedLayoutState({ rightPanel: "open" });
    render({
      chrome: chromeFixture({ layout }),
      agents: surface({ threads: [threadView({ threadId: "agt-1" })] }),
    });

    expect(host.querySelector(".agent-surface-empty__title")?.textContent).toBe("Open a surface");
    expect(host.querySelector("[data-agent-thread-head] [data-panel-layout-controls]")).toBeNull();
    const files = host.querySelector<HTMLButtonElement>('[aria-label="Open Files surface"]');
    const diff = host.querySelector<HTMLButtonElement>('[aria-label="Open Diff surface"]');
    const terminal = host.querySelector<HTMLButtonElement>('[aria-label="Open Terminal surface"]');
    expect(files?.disabled).toBe(false);
    expect(diff?.disabled).toBe(true);
    expect(terminal?.disabled).toBe(true);
    expect(host.textContent).toContain("Select a thread first");

    click('[aria-label="Open Files surface"]');
    expect(layout.actions).toEqual([{ kind: "openSurface", surface: "files" }]);

    click('.agent-surface [aria-label^="Toggle right panel"]');
    expect(layout.actions).toEqual([
      { kind: "openSurface", surface: "files" },
      { kind: "toggleRightPanel" },
    ]);
  });

  it("offers the changed files as a review cue that opens the Diff surface", () => {
    const showChanges = vi.fn(async () => undefined);
    const layout = recordedLayoutState();
    const view = threadView({ threadId: "agt-1" });
    render({
      chrome: chromeFixture({ layout }),
      agents: surface({
        showChanges,
        threads: [
          {
            ...view,
            changeSummary: {
              loading: false,
              error: null,
              files: [changedFile("a.ts")],
              truncated: false,
              removing: false,
              diff: null,
            },
          },
        ],
      }),
    });

    clickText("Refactor the parser");
    expect(host.querySelector(".agent-changes")).toBeNull();
    clickText("Review in Diff");

    expect(showChanges).toHaveBeenCalledWith("agt-1");
    expect(layout.actions).toEqual([{ kind: "openSurface", surface: "diff" }]);
  });

  it("opens a changed file and its diff document through the Diff surface", async () => {
    const openChangedFile = vi.fn(async () => undefined);
    const openChangedFileDiff = vi.fn(async () => undefined);
    const file = changedFile("a.ts");
    const view = threadView({ threadId: "agt-1" });
    render({
      chrome: chromeFixture({
        layout: recordedLayoutState({
          rightPanel: "open",
          openSurfaces: ["diff"],
          activeSurface: "diff",
        }),
      }),
      agents: surface({
        openChangedFile,
        openChangedFileDiff,
        threads: [
          {
            ...view,
            changeSummary: {
              loading: false,
              error: null,
              files: [file],
              truncated: false,
              removing: false,
              diff: null,
            },
          },
        ],
      }),
    });

    clickText("Refactor the parser");
    await waitForReact(() => expect(host.querySelector("[data-mock-diff]")).not.toBeNull());
    click("[data-mock-diff] [data-open-file]");
    click("[data-mock-diff] [data-open-diff]");

    expect(openChangedFile).toHaveBeenCalledWith("agt-1", file);
    expect(openChangedFileDiff).toHaveBeenCalledWith("agt-1", file);
  });

  it("drops the selection when the thread disappears from the surface", () => {
    render({ agents: surface({ threads: [threadView({ threadId: "agt-1" })] }) });

    clickText("Refactor the parser");
    render({ agents: surface({ threads: [] }) });

    expect(host.querySelector('section[aria-label="Agent thread agt-1"]')).toBeNull();
    expect(host.querySelector('section[aria-label="New agent thread"]')).not.toBeNull();
  });

  it("routes the pin toggle to the surface and orders pinned threads first", () => {
    const togglePin = vi.fn();
    render({
      agents: surface({
        togglePin,
        threads: [
          threadView({ threadId: "agt-1" }),
          threadView({ threadId: "agt-2" }),
          threadView({ threadId: "agt-3", repositoryRoot: NESTED }),
        ],
      }),
    });

    expect(threadOrder()).toEqual(["agt-1", "agt-2", "agt-3"]);

    openRowMenu("agt-2");
    clickMenuItem("Pin");

    expect(togglePin).toHaveBeenCalledWith("agt-2");

    render({
      agents: surface({
        togglePin,
        threads: [
          threadView({ threadId: "agt-1" }),
          threadView({ threadId: "agt-2", pinned: true }),
          threadView({ threadId: "agt-3", repositoryRoot: NESTED }),
        ],
      }),
    });

    expect(threadOrder()).toEqual(["agt-2", "agt-1", "agt-3"]);
  });

  it("hides archived threads behind the collapsed Archived shelf", () => {
    render({
      agents: surface({
        threads: [
          threadView({ threadId: "agt-1" }),
          threadView({ threadId: "agt-2", archived: true, title: "Archived work" }),
        ],
      }),
    });

    expect(host.textContent).not.toContain("Archived work");
    expect(host.querySelector(".agent-shelf")?.textContent).toContain("Archived (1)");

    click(".agent-shelf");

    expect(host.textContent).toContain("Archived work");
  });

  it("lists every registered root in the scope picker with the active tab first", () => {
    render({ projects: [activeProject(), backgroundProject()] });

    expect(host.querySelector('section[aria-label^="Project "]')).toBeNull();
    expect(scopeOptionLabels()).toEqual(["All projects", "app", "api-service"]);
    click("button#agent-rail-scope");
    expect(
      [...host.querySelectorAll("#agent-rail-scope-list .agent-menu__detail")].map(
        (element) => element.textContent,
      ),
    ).toEqual(["Background"]);
  });

  it("starts in the project chosen in the composer and forces its worktree rule", async () => {
    const startThread = vi.fn(async () => ({ threadId: "agt-new" }));
    render({ agents: surface({ startThread }), projects: [activeProject(), backgroundProject()] });

    chooseScope(OTHER_ROOT, OTHER_ROOT);

    expect(pickerTrigger("agent-checkout").disabled).toBe(true);
    expect(host.textContent).toContain("not the active tab");

    typePrompt("Fix the parser");
    await submitFormAsync();

    expect(startThread).toHaveBeenCalledWith({
      projectRootKey: OTHER_ROOT,
      repositoryRoot: OTHER_ROOT,
      prompt: "Fix the parser",
      isolation: "worktree",
      unsafeInPlaceConfirmationKey: null,
      launch: defaultAgentLaunchOptions("claudeCode"),
      dangerousLaunchConfirmed: false,
    });
  });

  it("keeps a scoped background project authoritative through a global fresh thread", async () => {
    const startThread = vi.fn(async () => ({ threadId: "agt-new" }));
    const bridge = createAgentViewCommandBridge();
    render({
      agents: surface({ startThread }),
      projects: [activeProject(), backgroundProject()],
      viewCommands: bridge,
    });

    click('button[aria-label="New thread in app"]');
    chooseScope(OTHER_ROOT, OTHER_ROOT);

    expect(host.querySelector('button[aria-label="New thread in api-service"]')).not.toBeNull();

    act(() => bridge.run("agent.newThread"));
    typePrompt("Fix the parser");
    await submitFormAsync();

    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({ projectRootKey: OTHER_ROOT, repositoryRoot: OTHER_ROOT }),
    );
  });

  it("starts in the active project without a project-level picker", async () => {
    const startThread = vi.fn(async () => ({ threadId: "agt-new" }));
    render({ agents: surface({ startThread }), projects: [activeProject()] });

    expect(host.querySelector("select#agent-project")).toBeNull();

    typePrompt("Fix the parser");
    await submitFormAsync();

    expect(startThread).toHaveBeenCalledWith({
      projectRootKey: ROOT,
      repositoryRoot: ROOT,
      prompt: "Fix the parser",
      isolation: "in-place",
      unsafeInPlaceConfirmationKey: null,
      launch: defaultAgentLaunchOptions("claudeCode"),
      dangerousLaunchConfirmed: false,
    });
  });

  it("keeps an untrusted project out of the composer and routes its trust action", () => {
    const onTrustProject = vi.fn();
    render({
      onTrustProject,
      projects: [{ ...backgroundProject(), trust: "untrusted" }],
    });

    expect(host.textContent).toContain("Choose a project in the rail to start a thread.");
    expect(submitButton().disabled).toBe(true);
    expect(host.textContent).not.toContain("Untrusted");

    chooseScope(OTHER_ROOT, OTHER_ROOT);

    expect(host.querySelector(".agent-scope__state-label")?.textContent).toBe("Untrusted");

    click('[aria-label="Trust project api-service"]');

    expect(onTrustProject).toHaveBeenCalledWith(OTHER_ROOT);
  });

  it("runs the project actions from the gear of a rail project row", () => {
    const onTrustProject = vi.fn();
    const revealPath = vi.fn(async () => undefined);
    const writeText = vi.fn(async () => undefined);
    render({
      chrome: chromeFixture({ revealPath }),
      onTrustProject,
      projects: [activeProject(), { ...backgroundProject(), trust: "untrusted" }],
    });

    openProjectMenu("api-service");
    expect(projectMenuLabels()).toEqual([
      "Trust project",
      "Filter to this project",
      "Terminal sessions…",
      "Reveal in Finder",
      "Copy path",
    ]);

    clickMenuItem("Trust project");
    expect(onTrustProject).toHaveBeenCalledWith(OTHER_ROOT);

    openProjectMenu("api-service");
    withClipboard({ writeText }, () => clickMenuItem("Copy path"));
    expect(writeText).toHaveBeenCalledWith(OTHER_ROOT);

    openProjectMenu("api-service");
    clickMenuItem("Reveal in Finder");
    expect(revealPath).toHaveBeenCalledWith(OTHER_ROOT);

    openProjectMenu("api-service");
    clickMenuItem("Filter to this project");

    expect(pickerTrigger("agent-rail-scope").textContent).toContain("api-service");
    expect(host.querySelector(".agent-scope__state-label")?.textContent).toBe("Untrusted");
  });

  it("offers no trust or release action for a trusted active project", () => {
    render({ projects: [activeProject(), backgroundProject()] });

    openProjectMenu("app");

    expect(projectMenuLabels()).toEqual([
      "Filter to this project",
      "Terminal sessions…",
      "Reveal in Finder",
      "Copy path",
    ]);
  });

  it("keeps a closed-tab draining project out of the composer picker", () => {
    render({
      projects: [activeProject(), { ...backgroundProject(), origin: "closed-tab-live-tasks" }],
    });

    expect(host.querySelector("select#agent-project")).toBeNull();
    expect(scopeOptionLabels()).toEqual(["All projects", "app", "api-service"]);
  });

  it("shows no start target when only a closed-tab draining project remains", () => {
    render({ projects: [{ ...backgroundProject(), origin: "closed-tab-live-tasks" }] });

    expect(host.textContent).toContain("Choose a project in the rail to start a thread.");
    expect(submitButton().disabled).toBe(true);
  });

  it("never starts a thread in a background project while the rail shows all projects", () => {
    render({ projects: [backgroundProject()] });

    expect(host.textContent).toContain("Choose a project in the rail to start a thread.");
    expect(submitButton().disabled).toBe(true);

    chooseScope(OTHER_ROOT, OTHER_ROOT);

    expect(host.textContent).not.toContain("Choose a project in the rail to start a thread.");
  });

  it("prefers the active-tab project over a background project for a new thread", async () => {
    const startThread = vi.fn(async () => ({ threadId: "agt-new" }));
    render({
      agents: surface({ startThread }),
      projects: [backgroundProject(), activeProject()],
    });

    typePrompt("Fix the parser");
    await submitFormAsync();

    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({ projectRootKey: ROOT, repositoryRoot: ROOT }),
    );
  });

  it("releases a closed-tab project through the surface callback", () => {
    const onReleaseProject = vi.fn();
    render({
      onReleaseProject,
      projects: [{ ...backgroundProject(), origin: "closed-tab-live-tasks" }],
    });

    chooseScope(OTHER_ROOT, OTHER_ROOT);

    expect(host.querySelector(".agent-scope__state-label")?.textContent).toBe("Tab closed");

    click('[aria-label="Release project api-service"]');

    expect(onReleaseProject).toHaveBeenCalledWith(OTHER_ROOT);
  });

  it("reports the roots beyond the project limit truthfully", () => {
    render({ overflowRootPaths: ["/workspace/nine"] });

    expect(host.querySelector(".agent-rail__overflow")?.textContent).toBe(
      "1 more project is not shown (limit 8)",
    );
  });

  it("seeds the composer launch from the last used launch of the target project", () => {
    render({
      agents: surface({
        lastUsedLaunch: (projectRootKey: string) =>
          projectRootKey === ROOT
            ? { provider: "claudeCode", model: "opus", mode: "acceptEdits", effort: "default" }
            : null,
      }),
    });

    expect(launchSelect("agent-launch-model").value).toBe("opus");
    expect(launchSelect("agent-launch-mode").value).toBe("acceptEdits");
  });

  it("falls back to the provider default when the root has no remembered launch", () => {
    render({ agents: surface({ agentCliKind: "codex" }) });

    expect(launchSelect("agent-launch-model").value).toBe("default");
    expect(launchSelect("agent-launch-mode").value).toBe("default");
    expect(host.textContent).toContain("Default sandbox");
  });

  it("drops a launch chosen for another project when the composer target changes", () => {
    render({
      agents: surface({
        lastUsedLaunch: (projectRootKey: string) =>
          projectRootKey === OTHER_ROOT
            ? { provider: "claudeCode", model: "sonnet", mode: "plan", effort: "default" }
            : null,
      }),
      projects: [activeProject(), backgroundProject()],
    });

    chooseLaunch("agent-launch-model", "fable");

    expect(launchSelect("agent-launch-model").value).toBe("fable");

    chooseScope(OTHER_ROOT, OTHER_ROOT);

    expect(launchSelect("agent-launch-model").value).toBe("sonnet");
    expect(launchSelect("agent-launch-mode").value).toBe("plan");
  });

  it("ignores a remembered launch that belongs to another provider", () => {
    render({
      agents: surface({
        agentCliKind: "codex",
        lastUsedLaunch: () => ({
          provider: "claudeCode",
          model: "opus",
          mode: "plan",
          effort: "default",
        }),
      }),
    });

    expect(launchSelect("agent-launch-model").value).toBe("default");
  });

  it("carries the launch and its confirmation into the start and forgets the confirmation", async () => {
    const startThread = vi.fn(async () => ({ threadId: "agt-new" }));
    render({ agents: surface({ startThread }) });

    chooseLaunch("agent-launch-mode", "bypassPermissions");
    typePrompt("Fix the parser");

    expect(submitButton().disabled).toBe(true);

    toggleCheckbox("agent-launch-danger-confirm", true);

    expect(submitButton().disabled).toBe(false);

    await submitFormAsync();

    expect(startThread).toHaveBeenCalledWith({
      projectRootKey: ROOT,
      repositoryRoot: ROOT,
      prompt: "Fix the parser",
      isolation: "in-place",
      unsafeInPlaceConfirmationKey: null,
      launch: {
        provider: "claudeCode",
        model: "default",
        mode: "bypassPermissions",
        effort: "default",
      },
      dangerousLaunchConfirmed: true,
    });
    expect(checkbox("agent-launch-danger-confirm").checked).toBe(false);
    expect(submitButton().disabled).toBe(true);
  });

  it("forgets the dangerous confirmation as soon as the launch changes", () => {
    render();

    chooseLaunch("agent-launch-mode", "bypassPermissions");
    toggleCheckbox("agent-launch-danger-confirm", true);

    expect(checkbox("agent-launch-danger-confirm").checked).toBe(true);

    chooseLaunch("agent-launch-model", "opus");

    expect(checkbox("agent-launch-danger-confirm").checked).toBe(false);
  });

  it("carries the launch into a follow-up turn", async () => {
    const sendFollowUp = vi.fn(async () => true);
    render({ agents: surface({ sendFollowUp, threads: [threadView({ threadId: "agt-1" })] }) });

    click('[data-thread-id="agt-1"]');
    chooseLaunch("agent-launch-model", "sonnet");
    typePrompt("Also update the docs");
    await submitFormAsync();

    expect(sendFollowUp).toHaveBeenCalledWith({
      threadId: "agt-1",
      prompt: "Also update the docs",
      launch: { provider: "claudeCode", model: "sonnet", mode: "default", effort: "default" },
      dangerousLaunchConfirmed: false,
    });
  });

  it("marks the selected thread viewed and again when its turn settles", () => {
    const markThreadViewed = vi.fn();
    render({
      agents: surface({
        markThreadViewed,
        threads: [threadView({ threadId: "agt-1", status: { kind: "running" } })],
      }),
    });

    expect(markThreadViewed).not.toHaveBeenCalled();

    click('[data-thread-id="agt-1"]');

    expect(markThreadViewed).toHaveBeenCalledWith("agt-1");
    expect(markThreadViewed).toHaveBeenCalledTimes(1);

    render({
      agents: surface({
        markThreadViewed,
        threads: [threadView({ threadId: "agt-1", status: { kind: "exited", exitCode: 0 } })],
      }),
    });

    expect(markThreadViewed).toHaveBeenCalledTimes(2);
    expect(markThreadViewed).toHaveBeenLastCalledWith("agt-1");
  });

  it("seeds a follow-up launch from the selected thread's project, not the composer target", () => {
    render({
      agents: surface({
        lastUsedLaunch: (projectRootKey: string) =>
          projectRootKey === OTHER_ROOT
            ? { provider: "claudeCode", model: "opus", mode: "acceptEdits", effort: "default" }
            : { provider: "claudeCode", model: "sonnet", mode: "plan", effort: "default" },
        threads: [threadView({ threadId: "agt-b", rootKey: OTHER_ROOT })],
      }),
      projects: [activeProject(), backgroundProject()],
    });

    expect(launchSelect("agent-launch-model").value).toBe("sonnet");

    click('[data-thread-id="agt-b"]');

    expect(launchSelect("agent-launch-model").value).toBe("opus");
    expect(launchSelect("agent-launch-mode").value).toBe("acceptEdits");
  });

  it("seeds a follow-up launch from the thread's last turn before the remembered launch", () => {
    render({
      agents: surface({
        lastUsedLaunch: () => ({
          provider: "claudeCode",
          model: "opus",
          mode: "acceptEdits",
          effort: "default",
        }),
        threads: [
          threadView({
            threadId: "agt-1",
            launch: { provider: "claudeCode", model: "fable", mode: "plan", effort: "default" },
          }),
        ],
      }),
    });

    click('[data-thread-id="agt-1"]');

    expect(launchSelect("agent-launch-model").value).toBe("fable");
    expect(launchSelect("agent-launch-mode").value).toBe("plan");
  });

  it("honours a launch change for a thread whose project is not a composer option", async () => {
    const sendFollowUp = vi.fn(async () => true);
    render({
      agents: surface({
        sendFollowUp,
        threads: [threadView({ threadId: "agt-b", rootKey: OTHER_ROOT })],
      }),
      projects: [activeProject(), { ...backgroundProject(), trust: "untrusted" }],
    });

    expect(host.querySelector("select#agent-project")).toBeNull();

    click('[data-thread-id="agt-b"]');
    chooseLaunch("agent-launch-model", "sonnet");
    expect(launchSelect("agent-launch-model").value).toBe("sonnet");

    typePrompt("Also update the docs");
    await submitFormAsync();

    expect(sendFollowUp).toHaveBeenCalledWith({
      threadId: "agt-b",
      prompt: "Also update the docs",
      launch: { provider: "claudeCode", model: "sonnet", mode: "default", effort: "default" },
      dangerousLaunchConfirmed: false,
    });
  });

  it("forgets the dangerous confirmation when the selected thread changes", () => {
    render({
      agents: surface({
        threads: [
          threadView({
            threadId: "agt-1",
            launch: {
              provider: "claudeCode",
              model: "default",
              mode: "bypassPermissions",
              effort: "default",
            },
          }),
          threadView({
            threadId: "agt-2",
            launch: {
              provider: "claudeCode",
              model: "default",
              mode: "bypassPermissions",
              effort: "default",
            },
          }),
        ],
      }),
    });

    click('[data-thread-id="agt-1"]');
    toggleCheckbox("agent-launch-danger-confirm", true);
    expect(checkbox("agent-launch-danger-confirm").checked).toBe(true);

    click('[data-thread-id="agt-2"]');

    expect(launchSelect("agent-launch-mode").value).toBe("bypassPermissions");
    expect(checkbox("agent-launch-danger-confirm").checked).toBe(false);
  });

  it("forgets the dangerous confirmation when the composer project changes", () => {
    render({
      agents: surface({
        lastUsedLaunch: () => ({
          provider: "claudeCode",
          model: "default",
          mode: "bypassPermissions",
          effort: "default",
        }),
      }),
      projects: [activeProject(), backgroundProject()],
    });

    toggleCheckbox("agent-launch-danger-confirm", true);
    expect(checkbox("agent-launch-danger-confirm").checked).toBe(true);

    chooseScope(OTHER_ROOT, OTHER_ROOT);

    expect(launchSelect("agent-launch-mode").value).toBe("bypassPermissions");
    expect(checkbox("agent-launch-danger-confirm").checked).toBe(false);
  });

  it("advances session timestamps on clock ticks without rerendering the column", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(NOW);
    try {
      render({
        agents: surface({ threads: [threadView({ threadId: "agt-1" })] }),
        nowTickMs: 1_000,
      });
      click('[data-thread-id="agt-1"]');

      expect(host.querySelector(".agent-prompt__meta")?.textContent).toContain("10 minutes ago");
      const sessionRenders = columnRenders.session;
      expect(sessionRenders).toBeGreaterThan(0);

      for (const minutes of [50, 110, 170]) {
        act(() => {
          vi.setSystemTime(NOW + minutes * 60_000);
          vi.advanceTimersByTime(1_000);
        });
      }

      expect(host.querySelector(".agent-prompt__meta")?.textContent).toContain("3 hours ago");
      expect(columnRenders.session).toBe(sessionRenders);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps prompt typing inside the composer render boundary with a loaded workbench", () => {
    const selected = threadView({ threadId: "agt-0" });
    const loadedSelected = {
      ...selected,
      thread: {
        ...selected.thread,
        turns: Array.from({ length: 64 }, (_, index) =>
          turn("agt-0", `Turn ${index + 1}`, { kind: "exited", exitCode: 0 }),
        ),
      },
    };
    const threads = [
      loadedSelected,
      ...Array.from({ length: 127 }, (_, index) =>
        threadView({ threadId: `agt-${index + 1}`, title: `Thread ${index + 1}` }),
      ),
    ];
    const layout = recordedLayoutState({
      activeSurface: "diff",
      openSurfaces: ["diff"],
      rightPanel: "open",
    });
    render({ agents: surface({ threads }), chrome: chromeFixture({ layout }) });
    click('[data-thread-id="agt-0"]');

    for (const key of Object.keys(columnRenders) as Array<keyof typeof columnRenders>) {
      columnRenders[key] = 0;
    }
    for (let index = 0; index < 20; index += 1) {
      typePrompt(`Prompt revision ${index + 1}`);
    }

    expect(columnRenders.composer).toBe(20);
    expect(columnRenders.header).toBe(0);
    expect(columnRenders.session).toBe(0);
    expect(columnRenders.sidebar).toBe(0);
    expect(columnRenders.surface).toBe(0);
    expect(promptField().value).toBe("Prompt revision 20");
  });

  it("contains streamed event renders within the active turn across a loaded workbench", async () => {
    const settledTurns = Array.from({ length: 63 }, (_, index) => ({
      ...turn("agt-0", `Turn ${index + 1}`, { kind: "exited", exitCode: 0 }),
      turnId: `agt-0-t${index + 1}`,
    }));
    const activeTurn = {
      ...turn("agt-0", "Stream this result", { kind: "running" }),
      turnId: "agt-0-t64",
    };
    const selected = threadView({ threadId: "agt-0", status: { kind: "running" } });
    const loadedSelected: AgentThreadView = {
      ...selected,
      thread: { ...selected.thread, turns: [...settledTurns, activeTurn] },
    };
    const otherThreads = Array.from({ length: 127 }, (_, index) => {
      const view = threadView({
        threadId: `agt-${index + 1}`,
        title: `Thread ${index + 1}`,
        status: index === 0 ? { kind: "running" } : { kind: "exited", exitCode: 0 },
      });
      if (index !== 0) return view;
      return {
        ...view,
        thread: { ...view.thread, updatedAtEpochMs: view.thread.updatedAtEpochMs + 60 },
      };
    });
    const layout = recordedLayoutState({
      activeSurface: "diff",
      openSurfaces: ["files", "diff", "terminal"],
      rightPanel: "open",
    });
    const bridge = createAgentViewCommandBridge();
    const revealPath = vi.fn(async () => undefined);
    const common = {
      chrome: chromeFixture({ layout, revealPath }),
      onReleaseProject: () => undefined,
      onTrustProject: () => undefined,
      nowTickMs: 1_000_000_000,
      overflowRootPaths: [] as ReadonlyArray<string>,
      providerEnabled: { claudeCode: true, codex: true },
      projects: [defaultActiveProject()],
      viewCommands: bridge,
    };
    const baseAgents = surface({ threads: [loadedSelected, ...otherThreads] });
    render({ ...common, agents: baseAgents });
    click('[data-thread-id="agt-0"]');
    await waitForReact(() => {
      expect(host.querySelector('[data-mock-diff="agt-0"]')).not.toBeNull();
    });

    resetColumnRenders();
    let streamed = loadedSelected;
    for (let index = 1; index <= 120; index += 1) {
      const nextActiveTurn: AgentTurn = {
        ...activeTurn,
        events: [{ kind: "assistantText", text: `Stream chunk ${index}` }],
        lastOutputSequence: index,
      };
      streamed = {
        ...streamed,
        thread: {
          ...streamed.thread,
          updatedAtEpochMs: streamed.thread.updatedAtEpochMs + 1,
          turns: [...settledTurns, nextActiveTurn],
        },
      };
      render({
        ...common,
        agents: { ...baseAgents, threads: [streamed, ...otherThreads] },
        onReleaseProject: () => undefined,
        onTrustProject: () => undefined,
      });
    }

    expect(host.textContent).toContain("Stream chunk 120");
    expect(columnRenders.session).toBe(120);
    expect(columnRenders.sidebar).toBe(0);
    expect(columnRenders.header).toBe(0);
    expect(columnRenders.composer).toBe(0);
    expect(columnRenders.surface).toBe(0);
    expect(columnRenders.files).toBe(0);
    expect(columnRenders.diff).toBe(0);
    expect(columnRenders.terminal).toBe(0);
    expect(threadOrder()[0]).toBe("agt-1");
    act(() => bridge.run("agent.jumpToThread.1"));
    expect(selectedSessionId()).toBe("agt-1");
    click('[data-thread-id="agt-0"]');

    act(() => bridge.run("agent.findInThread"));
    typeInto(findField(), "Stream chunk 120");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, AGENT_THREAD_FIND_DEBOUNCE_MS + 10));
    });
    expect(host.querySelector(".agent-find__count")?.textContent).toBe("1 of 1");
    click('[aria-label="Close find bar"]');

    typeSearch("Stream chunk 120");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 160));
    });
    expect(searchResultTitles().join(" ")).toContain("Stream chunk 120");
    typeSearch("");

    resetColumnRenders();
    const settled: AgentThreadView = {
      ...streamed,
      lifecycle: "settled",
      attention: "settled",
      thread: {
        ...streamed.thread,
        turns: [
          ...settledTurns,
          { ...activeTurn, status: { kind: "exited", exitCode: 0 }, endedAtEpochMs: NOW },
        ],
      },
    };
    render({ ...common, agents: { ...baseAgents, threads: [settled, ...otherThreads] } });
    expect(columnRenders.sidebar).toBe(1);
    expect(columnRenders.header).toBe(1);
    expect(columnRenders.composer).toBe(1);
    expect(columnRenders.surface).toBe(0);

    resetColumnRenders();
    const changed: AgentThreadView = {
      ...settled,
      changeSummary: {
        loading: false,
        error: null,
        files: [changedFile("src/stream.ts")],
        truncated: false,
        removing: false,
        diff: null,
      },
    };
    render({ ...common, agents: { ...baseAgents, threads: [changed, ...otherThreads] } });
    expect(columnRenders.sidebar).toBe(1);
    expect(columnRenders.surface).toBe(1);
    expect(columnRenders.composer).toBe(0);

    resetColumnRenders();
    const replacedRoot: AgentThreadView = {
      ...changed,
      thread: {
        ...changed.thread,
        owner: {
          rootKey: `${ROOT}:replacement`,
          ownerId: "agent-root:replacement",
          repositoryRoot: OTHER_ROOT,
        },
        target: { isolation: "in-place", worktreePath: null },
      },
    };
    render({ ...common, agents: { ...baseAgents, threads: [replacedRoot, ...otherThreads] } });
    expect(columnRenders.sidebar).toBe(1);
    expect(columnRenders.header).toBe(1);
    expect(columnRenders.composer).toBe(1);
    expect(columnRenders.surface).toBe(1);
    click('[aria-label="Open options"]');
    clickMenuItem("Reveal in Finder");
    expect(revealPath).toHaveBeenLastCalledWith(OTHER_ROOT);

    resetColumnRenders();
    render({
      ...common,
      agents: { ...baseAgents, threads: [changed, ...otherThreads] },
      onReleaseProject: () => undefined,
      onTrustProject: () => undefined,
    });
    expect(columnRenders.sidebar).toBe(1);
    expect(columnRenders.header).toBe(1);
    expect(columnRenders.composer).toBe(1);
    expect(columnRenders.surface).toBe(1);
    click('[aria-label="Open options"]');
    clickMenuItem("Reveal in Finder");
    expect(revealPath).toHaveBeenLastCalledWith(`${ROOT}/.worktrees/agt-0`);
  });

  it("renders rail timestamps through the agent clock instead of a now prop", () => {
    render({ agents: surface({ threads: [threadView({ threadId: "agt-1" })] }) });

    expect(host.querySelector(".agent-row__time")?.textContent).toBe(
      agentCompactTimeLabel(1_700_000_000_000, Date.now()),
    );
  });

  it("passes a search reveal to the session once and opens the find bar on the hit", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      render({
        agents: surface({
          threads: [
            threadView({ threadId: "agt-1", prompt: "Please tighten the lexer first" }),
            threadView({ threadId: "agt-2", title: "Unrelated work" }),
          ],
        }),
      });

      typeSearch("lexer");
      await act(async () => {
        vi.advanceTimersByTime(150);
        await Promise.resolve();
      });

      const options = [...host.querySelectorAll('#agent-rail-search-results [role="option"]')];
      expect(options).toHaveLength(1);
      expect(options[0]?.textContent).toContain("You:");
      act(() => (options[0] as HTMLElement).click());
      settleFind();

      expect(host.querySelector('section[aria-label="Agent thread agt-1"]')).not.toBeNull();
      expect(searchField().value).toBe("");
      expect(findField().value).toBe("lexer");
      expect(host.querySelector(".agent-find__count")?.textContent).toBe("1 of 1");
      const delivered = sessionReveals.filter((reveal) => reveal !== null);
      expect(delivered.map((reveal) => reveal?.turnId)).toEqual(["agt-1-t1"]);
      expect(sessionReveals[sessionReveals.length - 1]).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens the palette from the view command and keeps archived threads out of it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const bridge = createAgentViewCommandBridge();
    try {
      render({
        agents: surface({
          threads: [
            threadView({ threadId: "agt-1" }),
            threadView({ threadId: "agt-2", archived: true, title: "Archived parser work" }),
          ],
        }),
        viewCommands: bridge,
      });

      expect(host.querySelector(".agent-thread-palette")).toBeNull();
      act(() => bridge.run("agent.searchThreads"));
      const palette = host.querySelector<HTMLElement>(".agent-thread-palette");
      expect(palette).not.toBeNull();

      typeInto(palette?.querySelector("input") ?? null, "parser");
      await act(async () => {
        vi.advanceTimersByTime(150);
        await Promise.resolve();
      });

      const options = [...(palette?.querySelectorAll('[role="option"]') ?? [])];
      expect(options.map((option) => option.textContent)).toEqual(["Refactor the parser"]);

      act(() => (options[0] as HTMLElement).click());

      expect(host.querySelector(".agent-thread-palette")).toBeNull();
      expect(host.querySelector('section[aria-label="Agent thread agt-1"]')).not.toBeNull();
      expect(host.querySelector(".agent-find")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts find hits N of M and wraps in both directions", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const bridge = createAgentViewCommandBridge();
    render({
      agents: surface({
        threads: [
          threadView({
            threadId: "agt-1",
            prompt: "Fix token parsing",
            events: [{ kind: "assistantText", text: "token one, token two" }],
          }),
        ],
      }),
      viewCommands: bridge,
    });

    expect(bridge.threadSelected()).toBe(false);
    act(() => bridge.run("agent.findInThread"));
    expect(host.querySelector(".agent-find")).toBeNull();

    click('[data-thread-id="agt-1"]');
    expect(bridge.threadSelected()).toBe(true);
    act(() => bridge.run("agent.findInThread"));
    typeInto(findField(), "token");
    expect(host.querySelector(".agent-find__count")?.textContent).toBe("No results");
    settleFind();

    expect(host.querySelector(".agent-find__count")?.textContent).toBe("1 of 3");
    expect(host.querySelectorAll(".agent-find__hit")).toHaveLength(3);

    click('[aria-label="Next match"]');
    click('[aria-label="Next match"]');
    expect(host.querySelector(".agent-find__count")?.textContent).toBe("3 of 3");

    click('[aria-label="Next match"]');
    expect(host.querySelector(".agent-find__count")?.textContent).toBe("1 of 3");

    click('[aria-label="Previous match"]');
    expect(host.querySelector(".agent-find__count")?.textContent).toBe("3 of 3");

    click('[aria-label="Close find bar"]');
    expect(host.querySelector(".agent-find")).toBeNull();
    expect(host.querySelectorAll(".agent-find__hit")).toHaveLength(0);
    vi.useRealTimers();
  });

  it("closes the find bar when another thread is selected", () => {
    const bridge = createAgentViewCommandBridge();
    render({
      agents: surface({
        threads: [threadView({ threadId: "agt-1" }), threadView({ threadId: "agt-2" })],
      }),
      viewCommands: bridge,
    });

    click('[data-thread-id="agt-1"]');
    act(() => bridge.run("agent.findInThread"));
    expect(host.querySelector(".agent-find")).not.toBeNull();

    click('[data-thread-id="agt-2"]');

    expect(host.querySelector(".agent-find")).toBeNull();
  });

  it("copies thread details through the clipboard and reports a missing clipboard", async () => {
    const writeText = vi.fn(async () => undefined);
    const threadCopyDetail = vi.fn((threadId: string, detail: string) => `${detail}:${threadId}`);
    render({
      agents: surface({ threadCopyDetail, threads: [threadView({ threadId: "agt-1" })] }),
    });

    withClipboard({ writeText }, () => {
      openRowMenu("agt-1");
      clickMenuItem("Copy path");
    });
    expect(threadCopyDetail).toHaveBeenCalledWith("agt-1", "path");
    expect(writeText).toHaveBeenCalledWith("path:agt-1");
    expect(host.querySelector(".agent-notice")).toBeNull();

    withClipboard(undefined, () => {
      openRowMenu("agt-1");
      clickMenuItem("Copy branch");
    });
    expect(threadCopyDetail).toHaveBeenCalledWith("agt-1", "branch");
    expect(host.querySelector(".agent-notice")?.textContent).toContain(
      "The clipboard is not available",
    );

    click('[aria-label="Dismiss agent notice"]');
    expect(host.querySelector(".agent-notice")).toBeNull();

    openRowMenu("agt-1");
    clickMenuItem("Copy thread ID");
    await act(async () => {
      await Promise.resolve();
    });
    expect(threadCopyDetail).toHaveBeenLastCalledWith("agt-1", "threadId");
  });

  it("routes rename and mark unread from the row menu to the surface", () => {
    const renameThread = vi.fn();
    const markThreadUnread = vi.fn();
    render({
      agents: surface({
        markThreadUnread,
        renameThread,
        threads: [threadView({ threadId: "agt-1" })],
      }),
    });

    openRowMenu("agt-1");
    clickMenuItem("Mark unread");
    expect(markThreadUnread).toHaveBeenCalledWith("agt-1");

    openRowMenu("agt-1");
    clickMenuItem("Rename");
    const rename = host.querySelector<HTMLInputElement>('input[aria-label="Rename thread"]');
    expect(rename).not.toBeNull();
    typeInto(rename, "Parser rewrite");
    act(() => {
      rename?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(renameThread).toHaveBeenCalledWith("agt-1", "Parser rewrite");
  });

  it("jumps, advances and rewinds the selection through the view commands", () => {
    const bridge = createAgentViewCommandBridge();
    render({
      agents: surface({
        threads: [
          threadView({ threadId: "agt-1" }),
          threadView({ threadId: "agt-2" }),
          threadView({ threadId: "agt-3", archived: true }),
        ],
      }),
      viewCommands: bridge,
    });

    act(() => bridge.run("agent.jumpToThread.2"));
    expect(selectedSessionId()).toBe("agt-2");

    act(() => bridge.run("agent.nextThread"));
    expect(selectedSessionId()).toBe("agt-1");

    act(() => bridge.run("agent.previousThread"));
    expect(selectedSessionId()).toBe("agt-2");

    act(() => bridge.run("agent.jumpToThread.3"));
    expect(selectedSessionId()).toBe("agt-2");

    act(() => bridge.run("agent.newThread"));
    expect(selectedSessionId()).toBeNull();
    expect(host.querySelector('form[aria-label="New agent thread"]')).not.toBeNull();
  });

  it("runs the preferred script of the selected thread from the view command", () => {
    const bridge = createAgentViewCommandBridge();
    const run = vi.fn(() => true);
    const onShowTerminalPanel = vi.fn();
    render({
      agents: surface({ threads: [threadView({ threadId: "agt-1", isolation: "in-place" })] }),
      chrome: chromeFixture({ onShowTerminalPanel, scripts: scriptRunner(run) }),
      viewCommands: bridge,
    });

    act(() => bridge.run("agent.runPreferredScript"));
    expect(run).not.toHaveBeenCalled();

    clickText("Refactor the parser");
    act(() => bridge.run("agent.runPreferredScript"));

    expect(onShowTerminalPanel).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ scriptName: "dev" }),
      { kind: "workspaceRoot" },
      ROOT,
    );
  });

  it("runs a nested repository script through the selected worktree target", () => {
    const bridge = createAgentViewCommandBridge();
    const run = vi.fn<AgentThreadScriptRunner["run"]>(() => true);
    render({
      agents: surface({
        threads: [threadView({ threadId: "agt-1", isolation: "worktree", repositoryRoot: NESTED })],
      }),
      chrome: chromeFixture({ scripts: scriptRunner(run, "packages/api") }),
      viewCommands: bridge,
    });

    clickText("Refactor the parser");
    act(() => bridge.run("agent.runPreferredScript"));

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        manifestRelativePath: "packages/api/package.json",
        scriptName: "dev",
      }),
      { kind: "agentWorktree", threadId: "agt-1" },
      NESTED,
    );
  });

  it("opens the ship popover of the selected thread from the view command", () => {
    const bridge = createAgentViewCommandBridge();
    render({
      agents: surface({ threads: [threadView({ threadId: "agt-1" })] }),
      viewCommands: bridge,
    });

    act(() => bridge.run("agent.openCommitMenu"));
    expect(host.querySelector('[aria-label="Ship Refactor the parser"]')).toBeNull();

    clickText("Refactor the parser");
    expect(host.querySelector('[aria-label="Ship Refactor the parser"]')).toBeNull();

    act(() => bridge.run("agent.openCommitMenu"));

    const popover = host.querySelector('[aria-label="Ship Refactor the parser"]');
    expect(popover).not.toBeNull();
    expect(popover?.getAttribute("role")).toBe("dialog");
    expect(
      host.querySelector<HTMLButtonElement>('button[aria-label="Ship options"]')?.ariaExpanded,
    ).toBe("true");
  });

  it("keeps the script and commit commands disabled until a thread is selected", () => {
    const bridge = createAgentViewCommandBridge();
    render({
      agents: surface({ threads: [threadView({ threadId: "agt-1" })] }),
      viewCommands: bridge,
    });
    const commands = workbenchAgentCommands({ viewCommands: bridge }).filter(
      (command) =>
        command.id === "agent.runPreferredScript" || command.id === "agent.openCommitMenu",
    );
    const context = { hasWorkspace: true } as Parameters<
      NonNullable<(typeof commands)[number]["isEnabled"]>
    >[0];

    expect(commands.map((command) => command.isEnabled?.(context))).toEqual([false, false]);

    clickText("Refactor the parser");

    expect(commands.map((command) => command.isEnabled?.(context))).toEqual([true, true]);
  });

  it("unbinds the view commands on unmount", () => {
    const bridge = createAgentViewCommandBridge();
    render({ viewCommands: bridge });
    expect(bridge.bound()).toBe(true);

    act(() => root.unmount());
    root = createRoot(host);

    expect(bridge.bound()).toBe(false);
  });

  it("collapses the rail behind a slim expand affordance", () => {
    const threads = [threadView({ threadId: "agt-1" })];
    let layout = recordedLayoutState();
    render({ agents: surface({ threads }), chrome: chromeFixture({ layout }) });

    click('[aria-label="Collapse sidebar"]');
    layout = recordedLayoutState(reduceRecordedLayout(layout));
    render({ agents: surface({ threads }), chrome: chromeFixture({ layout }) });

    expect(host.querySelector('aside[aria-label="Agent threads"]')).toBeNull();
    expect(host.querySelector("[data-thread-id]")).toBeNull();

    click('[aria-label="Expand sidebar"]');
    layout = recordedLayoutState(reduceRecordedLayout(layout));
    render({ agents: surface({ threads }), chrome: chromeFixture({ layout }) });

    expect(host.querySelector('aside[aria-label="Agent threads"]')).not.toBeNull();
    expect(host.querySelector('[data-thread-id="agt-1"]')).not.toBeNull();
  });

  it("scopes the rail and the search to the chosen repository", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      render({
        agents: surface({
          threads: [
            threadView({ threadId: "agt-1" }),
            threadView({ threadId: "agt-3", repositoryRoot: NESTED, title: "Nested parser" }),
          ],
        }),
      });

      expect(threadOrder()).toEqual(["agt-1", "agt-3"]);

      chooseScope(ROOT, NESTED);

      expect(threadOrder()).toEqual(["agt-3"]);

      typeSearch("parser");
      await act(async () => {
        vi.advanceTimersByTime(150);
        await Promise.resolve();
      });

      expect(
        [...host.querySelectorAll('#agent-rail-search-results [role="option"]')].map(
          (option) => option.textContent,
        ),
      ).toEqual(["Nested parser"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never publishes search results of a previous owner after an A to B to A switch", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const viewsA = [threadView({ threadId: "agt-a", title: "Parser in A" })];
      const viewsB = [threadView({ threadId: "agt-b", rootKey: OTHER_ROOT, title: "Parser in B" })];
      render({ agents: surface({ threads: viewsA }) });

      typeSearch("parser");
      render({ agents: surface({ threads: viewsB }), projects: [backgroundProject()] });
      await act(async () => {
        vi.advanceTimersByTime(150);
        await Promise.resolve();
      });

      expect(searchResultTitles()).toEqual(["Parser in B"]);

      render({ agents: surface({ threads: viewsA }), projects: [defaultActiveProject()] });
      expect(searchResultTitles()).not.toContain("Parser in B");
      await act(async () => {
        vi.advanceTimersByTime(150);
        await Promise.resolve();
      });

      expect(searchResultTitles()).toEqual(["Parser in A"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("adds the highlighted home directory from the rail add-project dialog", async () => {
    const addProject = vi.fn(async () => undefined);
    render({
      chrome: chromeFixture({ addProject: { gateway: addProjectGateway(), addProject } }),
    });

    click('button[aria-label="Add project"]');
    await waitForReact(() => {
      expect(host.querySelector(".agent-add-project")).not.toBeNull();
    });

    const input = host.querySelector<HTMLInputElement>('.agent-add-project input[role="combobox"]');
    expect(input).not.toBeNull();
    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter", metaKey: true }),
      );
    });

    expect(addProject).toHaveBeenCalledWith(ADD_PROJECT_HOME);
    expect(host.querySelector(".agent-add-project")).toBeNull();
  });

  it("keeps the rail add-project button disabled without add-project chrome", () => {
    render();

    const button = host.querySelector<HTMLButtonElement>('button[aria-label="Add project"]');
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(true);
  });

  it("opens the terminal sessions palette from the project gear menu and closes it", () => {
    const externalSessions = externalSessionsSurfaceFixture({
      state: "ready",
      target: { rootKey: ROOT, repositoryRoot: ROOT },
      sessions: [externalSessionView()],
      open: vi.fn(async () => undefined),
      close: vi.fn(),
      loadPreview: vi.fn(async () => undefined),
    });
    render({ agents: surface({ externalSessions }), projects: [activeProject()] });

    openProjectMenu("app");
    clickMenuItem("Terminal sessions…");

    expect(host.querySelector(".agent-terminal-sessions")).not.toBeNull();
    expect(externalSessions.open).toHaveBeenCalledWith({ rootKey: ROOT, repositoryRoot: ROOT });

    const filter = host.querySelector<HTMLInputElement>(
      'input[aria-label="Filter terminal sessions"]',
    );
    expect(filter).not.toBeNull();
    act(() => {
      filter?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });

    expect(host.querySelector(".agent-terminal-sessions")).toBeNull();
    expect(externalSessions.close).toHaveBeenCalledTimes(1);
  });

  it("opens the terminal sessions palette from the empty rail import action", () => {
    const externalSessions = externalSessionsSurfaceFixture({ open: vi.fn(async () => undefined) });
    render({ agents: surface({ externalSessions }) });

    act(() => buttonWithText("Import a terminal session…").click());

    expect(host.querySelector(".agent-terminal-sessions")).not.toBeNull();
    expect(externalSessions.open).toHaveBeenCalledWith({ rootKey: ROOT, repositoryRoot: ROOT });
  });

  it("hides the empty rail import action when no project can receive the import", () => {
    const externalSessions = externalSessionsSurfaceFixture({ open: vi.fn(async () => undefined) });
    render({
      agents: surface({ externalSessions }),
      projects: [{ ...activeProject(), trust: "untrusted" }],
    });

    expect(host.querySelector(".agent-rail__empty-state")).not.toBeNull();
    const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent?.trim() === "Import a terminal session…",
    );
    expect(button).toBeUndefined();
    expect(externalSessions.open).not.toHaveBeenCalled();
  });

  it("hides the empty rail import action without an external sessions surface", () => {
    render();

    const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent?.trim() === "Import a terminal session…",
    );
    expect(button).toBeUndefined();
  });

  it("imports a session from the palette, selects the thread, and closes the palette", async () => {
    const importExternalSession = vi.fn(async () => ({
      threadId: "agt-1",
      alreadyImported: false,
    }));
    const externalSessions = externalSessionsSurfaceFixture({
      state: "ready",
      target: { rootKey: ROOT, repositoryRoot: ROOT },
      sessions: [externalSessionView()],
      close: vi.fn(),
    });
    render({
      agents: surface({
        externalSessions,
        importExternalSession,
        threads: [threadView({ threadId: "agt-1" })],
      }),
      projects: [activeProject()],
    });

    openProjectMenu("app");
    clickMenuItem("Terminal sessions…");
    act(() => buttonWithText("Continue in Codevo").click());

    expect(importExternalSession).toHaveBeenCalledWith({
      projectRootKey: ROOT,
      repositoryRoot: ROOT,
      provider: "claudeCode",
      sessionId: "34fbe185-9c1d-4e6a-8b21-7f3a5d90c412",
      title: "Security review session",
      firstPrompt: "remember plum",
    });
    await waitForReact(() => expect(host.querySelector(".agent-terminal-sessions")).toBeNull());
    expect(externalSessions.close).toHaveBeenCalledTimes(1);
    expect(selectedSessionId()).toBe("agt-1");
  });

  it("imports a nested terminal session into the repository recorded by that session", () => {
    const importExternalSession = vi.fn(async () => null);
    const externalSessions = externalSessionsSurfaceFixture({
      state: "ready",
      target: { rootKey: ROOT, repositoryRoot: ROOT },
      sessions: [externalSessionView({ cwd: NESTED })],
    });
    render({
      agents: surface({ externalSessions, importExternalSession }),
      projects: [activeProject()],
    });

    openProjectMenu("app");
    clickMenuItem("Terminal sessions…");
    act(() => buttonWithText("Continue in Codevo").click());

    expect(importExternalSession).toHaveBeenCalledWith(
      expect.objectContaining({ projectRootKey: ROOT, repositoryRoot: NESTED }),
    );
  });

  it("selects the existing thread for an already imported session without importing again", () => {
    const importExternalSession = vi.fn(async () => null);
    const externalSessions = externalSessionsSurfaceFixture({
      state: "ready",
      target: { rootKey: ROOT, repositoryRoot: ROOT },
      sessions: [externalSessionView({ alreadyImportedThreadId: "agt-1" })],
      close: vi.fn(),
    });
    render({
      agents: surface({
        externalSessions,
        importExternalSession,
        threads: [threadView({ threadId: "agt-1" })],
      }),
      projects: [activeProject()],
    });

    openProjectMenu("app");
    clickMenuItem("Terminal sessions…");
    act(() => buttonWithText("Open imported thread").click());

    expect(importExternalSession).not.toHaveBeenCalled();
    expect(host.querySelector(".agent-terminal-sessions")).toBeNull();
    expect(externalSessions.close).toHaveBeenCalledTimes(1);
    expect(selectedSessionId()).toBe("agt-1");
  });

  function render(
    overrides: Partial<AgentModeViewProps> = {},
    responsiveRestore: ResponsivePanelRestore = "none",
  ): void {
    act(() =>
      root.render(
        <WorkbenchFrameResponsiveContext.Provider value={responsiveRestore}>
          <AgentModeView {...defaultProps()} {...overrides} />
        </WorkbenchFrameResponsiveContext.Provider>,
      ),
    );
  }

  function resetColumnRenders(): void {
    for (const key of Object.keys(columnRenders) as Array<keyof typeof columnRenders>) {
      columnRenders[key] = 0;
    }
  }

  function surfaceTabs(): string[] {
    return Array.from(host.querySelectorAll('.agent-surface__tabs [role="tab"]')).map(
      (tab) => tab.textContent ?? "",
    );
  }

  function agentModeSection(): HTMLElement | null {
    return host.querySelector('section[aria-label="Agent mode"]');
  }

  function activeSurfaceTab(): string {
    return (
      host.querySelector('.agent-surface__tabs [role="tab"][aria-selected="true"]')?.textContent ??
      ""
    );
  }

  function checkbox(id: string): HTMLInputElement {
    const element = host.querySelector<HTMLInputElement>(`input#${id}`);
    expect(element).not.toBeNull();
    return element ?? document.createElement("input");
  }

  function pickerTrigger(id: string): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>(`button#${id}`);
    expect(element).not.toBeNull();
    return element ?? document.createElement("button");
  }

  function pickOption(id: string, value: string): void {
    act(() => pickerTrigger(id).click());
    const option = host.querySelector<HTMLElement>(
      `#${id}-list [role="option"][data-value="${value}"]`,
    );
    expect(option).not.toBeNull();
    act(() => option?.click());
  }

  function threadOrder(): readonly string[] {
    return [...host.querySelectorAll<HTMLElement>("[data-thread-id]")].map(
      (element) => element.dataset.threadId ?? "",
    );
  }

  function selectedSessionId(): string | null {
    const section = host.querySelector('section[aria-label^="Agent thread "]');
    return section?.getAttribute("aria-label")?.replace("Agent thread ", "") ?? null;
  }

  function searchField(): HTMLInputElement {
    const element = host.querySelector<HTMLInputElement>(
      '.agent-rail input[aria-label="Search threads"]',
    );
    expect(element).not.toBeNull();
    return element ?? document.createElement("input");
  }

  function settleFind(): void {
    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_FIND_DEBOUNCE_MS);
    });
  }

  function findField(): HTMLInputElement {
    const element = host.querySelector<HTMLInputElement>('input[aria-label="Find in thread"]');
    expect(element).not.toBeNull();
    return element ?? document.createElement("input");
  }

  function searchResultTitles(): readonly string[] {
    return [...host.querySelectorAll('#agent-rail-search-results [role="option"]')].map(
      (option) => option.textContent ?? "",
    );
  }

  function typeInto(element: HTMLInputElement | null, value: string): void {
    expect(element).not.toBeNull();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        element,
        value,
      );
      element?.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function typeSearch(value: string): void {
    typeInto(searchField(), value);
  }

  function openRowMenu(threadId: string): void {
    const row = host.querySelector<HTMLElement>(`[data-thread-id="${threadId}"]`);
    expect(row).not.toBeNull();
    act(() => {
      row?.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 8, clientY: 8 }),
      );
    });
  }

  function openProjectMenu(label: string): void {
    if (host.querySelector("#agent-rail-scope-list") === null) {
      click("button#agent-rail-scope");
    }
    click(`[aria-label="Project actions for ${label}"]`);
  }

  function projectMenuLabels(): readonly string[] {
    return [...host.querySelectorAll<HTMLButtonElement>('.agent-menu__item[role="menuitem"]')].map(
      (item) => item.textContent ?? "",
    );
  }

  function clickMenuItem(label: string): void {
    const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (candidate) => candidate.textContent === label,
    );
    expect(item).toBeDefined();
    act(() => item?.click());
  }

  function buttonWithText(label: string): HTMLButtonElement {
    const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (button === undefined) throw new Error(`Button not found: ${label}`);
    return button;
  }

  function scopeOptionLabels(): readonly string[] {
    click("button#agent-rail-scope");
    const labels = [
      ...host.querySelectorAll('#agent-rail-scope-list [role="menuitemradio"] .agent-menu__label'),
    ].map((element) => element.textContent ?? "");
    click("button#agent-rail-scope");
    return labels;
  }

  function chooseScope(projectRootKey: string, repositoryRoot: string): void {
    click("button#agent-rail-scope");
    click(
      `#agent-rail-scope-list [role="menuitemradio"][data-value="${agentRailScopeValue(
        projectRootKey,
        repositoryRoot,
      )}"]`,
    );
  }

  function restoreClipboard(descriptor: PropertyDescriptor | undefined): void {
    if (descriptor === undefined) {
      Reflect.deleteProperty(navigator, "clipboard");
      return;
    }
    Object.defineProperty(navigator, "clipboard", descriptor);
  }

  function withClipboard(
    clipboard: { readonly writeText: (text: string) => Promise<void> } | undefined,
    run: () => void,
  ): void {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });
    try {
      run();
    } finally {
      restoreClipboard(descriptor);
    }
  }

  function promptField(): HTMLTextAreaElement {
    const element = host.querySelector<HTMLTextAreaElement>("textarea#agent-prompt");
    expect(element).not.toBeNull();
    return element ?? document.createElement("textarea");
  }

  function submitButton(): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(element).not.toBeNull();
    return element ?? document.createElement("button");
  }

  function typePrompt(value: string): void {
    const element = promptField();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        element,
        value,
      );
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function launchSelect(id: string): { readonly value: string } {
    const element = host.querySelector<HTMLButtonElement>(`button#${id}`);
    expect(element).not.toBeNull();
    return { value: element?.dataset.value ?? "" };
  }

  function chooseLaunch(id: string, value: string): void {
    const trigger = host.querySelector<HTMLButtonElement>(`button#${id}`);
    expect(trigger).not.toBeNull();
    act(() => trigger?.click());
    const option = host.querySelector<HTMLElement>(
      `#${id}-list [role="option"][data-value="${value}"]`,
    );
    expect(option).not.toBeNull();
    act(() => option?.click());
  }

  function toggleCheckbox(id: string, checked: boolean): void {
    const element = host.querySelector<HTMLInputElement>(`input#${id}`);
    expect(element).not.toBeNull();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set?.call(
        element,
        checked,
      );
      element?.dispatchEvent(new Event("click", { bubbles: true }));
    });
  }

  function submitForm(): void {
    const form = host.querySelector("form");
    expect(form).not.toBeNull();
    act(() => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  }

  async function submitFormAsync(): Promise<void> {
    const form = host.querySelector("form");
    expect(form).not.toBeNull();
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
  }

  function click(selector: string): void {
    const element = host.querySelector<HTMLElement>(selector);
    expect(element).not.toBeNull();
    act(() => element?.click());
  }

  function clickText(text: string): void {
    const element = [...host.querySelectorAll<HTMLElement>('button, [role="button"]')].find(
      (candidate) => (candidate.textContent ?? "").includes(text),
    );
    expect(element).toBeDefined();
    act(() => element?.click());
  }
});

function addProjectGateway(): DirectoryListingGateway {
  return {
    listDirectoryEntries: async () => ({
      path: ADD_PROJECT_HOME,
      parent: "/Users",
      entries: [{ name: "Developer", kind: "directory", hidden: false }],
      truncated: false,
    }),
    revealDirectory: async () => undefined,
  };
}

function scriptRunner(
  run: AgentThreadScriptRunner["run"],
  packageRootRelativePath = "",
): AgentThreadScriptRunner {
  return {
    scripts: [
      {
        key: "package.json:dev",
        manifestRelativePath:
          packageRootRelativePath === ""
            ? "package.json"
            : `${packageRootRelativePath}/package.json`,
        packageName: "app",
        packageManager: "npm",
        packageRootRelativePath,
        scriptName: "dev",
      },
    ],
    truncated: false,
    available: true,
    unavailableReason: null,
    active: null,
    run,
    stop: () => undefined,
  };
}

function changedFile(relativePath: string): GitChangedFile {
  return {
    isStaged: false,
    isUnversioned: false,
    oldPath: null,
    oldRelativePath: null,
    path: `${ROOT}/.worktrees/agt-1/${relativePath}`,
    relativePath,
    status: "modified",
  };
}

function defaultProps(): AgentModeViewProps {
  return {
    agents: surface({}),
    onReleaseProject: () => undefined,
    onTrustProject: () => undefined,
    overflowRootPaths: [],
    providerEnabled: { claudeCode: true, codex: true },
    projects: [defaultActiveProject()],
    workspaceRoot: ROOT,
    nowTickMs: NOW_TICK_MS,
    chrome: chromeFixture(),
  };
}

function defaultActiveProject(): AgentProjectDescriptor {
  return {
    rootKey: ROOT,
    rootPath: ROOT,
    ownerId: "agent-root:app",
    label: "app",
    generation: 0,
    trust: "trusted",
    origin: "active-tab",
    repositories: [repository(ROOT, ""), repository(NESTED, "packages/api")],
    isolationPolicy: "auto",
    leaseToken: null,
  };
}

function activeProject(): AgentProjectDescriptor {
  return {
    rootKey: ROOT,
    rootPath: ROOT,
    ownerId: "agent-root:app",
    label: "app",
    generation: 0,
    trust: "trusted",
    origin: "active-tab",
    repositories: [repository(ROOT, "")],
    isolationPolicy: "auto",
    leaseToken: null,
  };
}

function backgroundProject(): AgentProjectDescriptor {
  return {
    rootKey: OTHER_ROOT,
    rootPath: OTHER_ROOT,
    ownerId: "agent-root:api-service",
    label: "api-service",
    generation: 0,
    trust: "trusted",
    origin: "background-tab",
    repositories: [repository(OTHER_ROOT, "")],
    isolationPolicy: "auto",
    leaseToken: 7,
  };
}

function externalSessionView(
  overrides: Partial<ExternalAgentSessionView> = {},
): ExternalAgentSessionView {
  return {
    provider: "claudeCode",
    sessionId: "34fbe185-9c1d-4e6a-8b21-7f3a5d90c412",
    cwd: ROOT,
    title: "Security review session",
    firstPrompt: "remember plum",
    startedAtEpochMs: 1_700_000_000_000,
    lastActivityEpochMs: 1_700_000_100_000,
    turnCount: 3,
    turnCountExact: true,
    fileBytes: 1_024,
    alreadyImportedThreadId: null,
    ...overrides,
  };
}

function surface(overrides: Partial<AgentModeViewProps["agents"]>): AgentModeViewProps["agents"] {
  return {
    threads: [],
    repositories: [repository(ROOT, ""), repository(NESTED, "packages/api")],
    orphanedWorktrees: [],
    notice: null,
    dispatching: false,
    agentCliConfigured: true,
    agentCliKind: "claudeCode",
    agentCliVersion: null,
    liveTaskCount: 0,
    maxConcurrentAgentTasks: 4,
    pendingTurnCount: () => 0,
    isolationPreview: (repositoryRoot: string) => ({
      repositoryRoot,
      recommended: { kind: "in-place" },
      inPlaceGuard: { kind: "safe" },
      inPlaceAllowed: true,
      confirmationKey: null,
    }),
    refreshIsolationStatus: async () => undefined,
    startThread: async () => ({ threadId: "agt-default" }),
    sendFollowUp: async () => true,
    importExternalSession: async () => null,
    stop: async () => undefined,
    togglePin: () => undefined,
    archive: () => undefined,
    remove: () => undefined,
    hasLiveTasksForOwner: () => false,
    stopProjectTasks: async () => undefined,
    releaseProjectTasks: () => undefined,
    removeOrphanedWorktree: async () => undefined,
    pruneOrphanedWorktrees: async () => undefined,
    showChanges: async () => undefined,
    hideChanges: () => undefined,
    showFileDiff: async () => undefined,
    hideFileDiff: () => undefined,
    removeWorktree: async () => undefined,
    refreshShipStatus: async () => undefined,
    commitThreadChanges: async () => undefined,
    pushThreadBranch: async () => undefined,
    openThreadCompareUrl: async () => undefined,
    integrateThreadBranch: async () => undefined,
    removeThreadWorktree: async () => undefined,
    resetThreadShip: () => undefined,
    openChangedFile: async () => undefined,
    openChangedFileDiff: async () => undefined,
    configureAgentCli: () => undefined,
    dismissNotice: () => undefined,
    markThreadViewed: () => undefined,
    markThreadUnread: () => undefined,
    renameThread: () => undefined,
    threadCopyDetail: () => null,
    lastUsedLaunch: () => null,
    providerManagement: providerManagement(),
    ...overrides,
  };
}

function providerManagement(): AgentProviderManagementSurface {
  const preference = {
    enabled: true,
    healthCheckIntervalSeconds: 300,
    checkForUpdates: false,
    dismissedUpdateVersion: null,
  };
  return {
    cliDiscovery: defaultAgentCliDiscoveryResult(),
    providers: {
      claudeCode: {
        executable: {
          kind: "notFound",
          installCommand: "npm i -g @anthropic-ai/claude-code",
        },
        health: { kind: "notConfigured" },
        policy: { kind: "registered", settingsRevision: 1, providerGeneration: 1 },
        updateState: { kind: "idle" },
        liveTurnCount: 0,
      },
      codex: {
        executable: { kind: "notFound", installCommand: "npm i -g @openai/codex" },
        health: { kind: "notConfigured" },
        policy: { kind: "registered", settingsRevision: 1, providerGeneration: 1 },
        updateState: { kind: "idle" },
        liveTurnCount: 0,
      },
    },
    selectedProviderAuthority: { settingsRevision: 1, provider: "claudeCode" },
    toast: null,
    admissionAuthority: (provider) => ({
      provider,
      revision: 1,
      disposition: { kind: "ready" },
      cliPath: provider === "claudeCode" ? "/usr/bin/claude" : "/usr/bin/codex",
      providerGeneration: 1,
    }),
    authority: (provider) => ({
      provider,
      settingsRevision: 1,
      preference,
      cliPath: provider === "claudeCode" ? "/usr/bin/claude" : "/usr/bin/codex",
    }),
    dismissToast: () => undefined,
    dismissUpdate: async () => true,
    refresh: async () => undefined,
    retryRegistration: async () => undefined,
    save: async () => true,
    saveWithOutcome: async () => ({ kind: "persisted", policyRegistered: true }),
    update: async () => null,
  };
}

function repository(repositoryRoot: string, rootRelativePath: string): ResolvedGitRepository {
  return { mapping: { rootRelativePath }, repositoryRoot, repositoryRelativePath: "" };
}

interface ThreadViewOptions {
  readonly threadId?: string;
  readonly repositoryRoot?: string;
  readonly rootKey?: string;
  readonly launch?: AgentLaunchOptions | null;
  readonly status?: AgentTurnStatus;
  readonly pinned?: boolean;
  readonly archived?: boolean;
  readonly providerKind?: AgentCliKind;
  readonly projectOrigin?: AgentProjectOrigin;
  readonly sessionId?: string | null;
  readonly title?: string;
  readonly prompt?: string;
  readonly events?: ReadonlyArray<AgentTurnEvent>;
  readonly worktreeMissing?: boolean;
  readonly ship?: AgentShipState;
  readonly isolation?: AgentTaskIsolation;
}

function threadView({
  archived = false,
  events = [],
  isolation = "worktree",
  launch = null,
  prompt,
  ship = { kind: "idle", status: null, loadingStatus: false },
  pinned = false,
  projectOrigin = "active-tab",
  providerKind = "claudeCode",
  rootKey = ROOT,
  repositoryRoot = rootKey,
  sessionId = "session-abcdefgh",
  status = { kind: "exited", exitCode: 0 },
  threadId = "agt-1",
  title = "Refactor the parser",
  worktreeMissing = false,
}: ThreadViewOptions): AgentThreadView {
  const running = status.kind === "pending" || status.kind === "running";
  const thread: AgentThread = {
    threadId,
    owner: { rootKey, ownerId: ownerIdFor(rootKey), repositoryRoot },
    target: {
      isolation,
      worktreePath: isolation === "worktree" ? `${repositoryRoot}/.worktrees/${threadId}` : null,
    },
    provider: { kind: providerKind, sessionId },
    title,
    pinned,
    archived,
    createdAtEpochMs: 1_700_000_000_000,
    updatedAtEpochMs: 1_700_000_000_000,
    turns: [{ ...turn(threadId, prompt ?? title, status), events, launch }],
    turnsTruncated: false,
    viewedAtEpochMs: null,
    externalOrigin: null,
    integration: null,
  };

  return {
    ship,
    editorAvailability: { kind: "available" },
    attention: agentThreadAttention(thread),
    unread: agentThreadUnread(thread),
    thread,
    lifecycle: archived ? "archived" : running ? "running" : "settled",
    repositoryLabel: "app",
    projectOrigin,
    worktreeRemoved: false,
    worktreeMissing,
    changeSummary: null,
  };
}

function ownerIdFor(rootKey: string): string {
  return rootKey === OTHER_ROOT ? "agent-root:api-service" : "agent-root:app";
}

function loadedShip(): AgentShipState {
  return {
    kind: "idle",
    loadingStatus: false,
    status: {
      worktree: { branch: "agent/agt-1", head: "a".repeat(40), dirty: true, changeCount: 2 },
      primary: { branch: "main", head: "b".repeat(40), dirty: false },
      relation: { aheadOfPrimary: 1, behindPrimary: 0, fastForwardable: true },
      remote: null,
    },
  };
}

function turn(threadId: string, prompt: string, status: AgentTurnStatus): AgentTurn {
  return {
    turnId: `${threadId}-t1`,
    prompt,
    status,
    startedAtEpochMs: 1_700_000_000_000,
    endedAtEpochMs: null,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
}
