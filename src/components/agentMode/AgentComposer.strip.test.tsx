// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentThreadBranchMemoryPort } from "../../application/agentThreadBranchMemoryPort";
import { useAgentThreadBranchMemory } from "../../application/useAgentThreadBranchMemory";
import { useAgentThreadBranchRecorder } from "../../application/useAgentThreadBranchRecorder";
import type { ComposerBranchGateway } from "../../application/useComposerBranchPicker";
import {
  EMPTY_AGENT_THREAD_BRANCH_MEMORY,
  agentThreadBranchOf,
  rememberAgentThreadBranch,
  type AgentThreadBranchIdentity,
  type AgentThreadBranchMemory,
} from "../../domain/agentThreadBranchMemory";
import type { GitBranches } from "../../domain/git";
import type { GitShipStatus } from "../../domain/gitIntegration";
import { TauriRemoteRunnerGateway } from "../../infrastructure/tauriRemoteRunnerGateway";
import type { RemoteRunnerServer } from "../../domain/remoteRunner";
import { RemoteRunnerContext } from "../remoteRunner/remoteRunnerContext";
import { AgentComposer, type AgentComposerProps } from "./AgentComposer";
import type { AgentComposerPreviousWorktreeChoice } from "./agentComposerPreviousWorktree";
import { agentComposerThreadLocation } from "./agentComposerThreadLocation";
import type { AgentLiveCheckoutBranches } from "./agentLiveCheckoutBranch";
import {
  SURFACE_FIXTURE_ROOT,
  SURFACE_FIXTURE_WORKTREE,
  surfaceThreadView,
} from "./agentSurfaceTestFixtures";
import { useAgentComposerDrawerExtras } from "./useAgentComposerDrawerExtras";

const ROOT = SURFACE_FIXTURE_ROOT;
const NO_THREADS: ReadonlyArray<AgentThreadView> = [];
const THREAD_A: AgentThreadBranchIdentity = {
  threadId: "agt-1",
  rootKey: ROOT,
  ownerId: "agent-root:app",
};
const THREAD_B: AgentThreadBranchIdentity = { ...THREAD_A, threadId: "agt-2" };
const LINUX: RemoteRunnerServer = {
  id: "linux",
  name: "Linux server",
  host: "192.168.1.110",
  username: "codex",
  port: 22,
  connected: true,
};
const OFFLINE: RemoteRunnerServer = { ...LINUX, id: "offline", name: "Offline", connected: false };

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function branches(current: string): GitBranches {
  return { current, local: ["main", "feat/a", "feature/x"], remotes: {} };
}

function gitGateway(initial = "main") {
  let current = initial;
  const git = {
    checkoutRemoteBranch: vi.fn(async () => []),
    createBranch: vi.fn(async () => undefined),
    getBranches: vi.fn(async () => branches(current)),
    switchBranch: vi.fn(async (_root: string, name: string) => {
      current = name;
    }),
  } satisfies ComposerBranchGateway;
  return {
    git,
    setCurrent(next: string) {
      current = next;
    },
  };
}

interface RecordingMemoryPort extends AgentThreadBranchMemoryPort {
  readonly saved: AgentThreadBranchMemory;
}

function memoryPort(
  initial: AgentThreadBranchMemory = EMPTY_AGENT_THREAD_BRANCH_MEMORY,
): RecordingMemoryPort {
  let saved = initial;
  return {
    get saved() {
      return saved;
    },
    load: () => saved,
    save: (memory: AgentThreadBranchMemory) => {
      saved = memory;
    },
  };
}

function inPlaceView(
  threadId = "agt-1",
  lifecycle: AgentThreadView["lifecycle"] = "settled",
): AgentThreadView {
  return surfaceThreadView({
    lifecycle,
    thread: {
      ...surfaceThreadView().thread,
      threadId,
      target: { isolation: "in-place", worktreePath: null },
    },
  });
}

function worktreeView(worktreePath: string | null = SURFACE_FIXTURE_WORKTREE): AgentThreadView {
  const status: GitShipStatus = {
    worktree: { branch: "agent/agt-1", head: "abc", dirty: false, changeCount: 0 },
    primary: { branch: "main", head: "def", dirty: false },
    relation: { aheadOfPrimary: 2, behindPrimary: 0, fastForwardable: true },
    remote: null,
  };
  return surfaceThreadView({
    ship: { kind: "idle", status: worktreePath === null ? null : status, loadingStatus: false },
    thread: {
      ...surfaceThreadView().thread,
      target: { isolation: "worktree", worktreePath },
    },
  });
}

function remoteView(): AgentThreadView {
  return surfaceThreadView({
    execution: {
      kind: "remote",
      serverId: "linux",
      runnerId: "runner",
      projectId: "project",
      conversationId: "c-1",
      latestTaskId: "task-1",
      resume: null,
    },
    thread: inPlaceView().thread,
  });
}

function composerProps(overrides: Partial<AgentComposerProps> = {}): AgentComposerProps {
  return {
    target: {
      projectLabel: "app",
      projectRoot: ROOT,
      repositoryOptions: [],
      selectedRepositoryRoot: ROOT,
    },
    prompt: "",
    promptBytes: 0,
    isolation: "in-place",
    isolationReason: null,
    worktreeAvailable: true,
    worktreeOnly: false,
    worktreeOnlyReason: null,
    guard: { kind: "safe" },
    launch: { provider: "claudeCode", model: "default", mode: "default", effort: "default" },
    launchProvider: "claudeCode",
    dispatching: false,
    submitBlocked: false,
    providerEnabled: { claudeCode: true, codex: true },
    mode: { kind: "new" },
    onSelectRepository: () => undefined,
    onPromptChange: () => undefined,
    onIsolationChange: () => undefined,
    onLaunchChange: () => undefined,
    onNewThread: () => undefined,
    onOpenProviderSettings: () => undefined,
    onSubmit: () => undefined,
    ...overrides,
  };
}

function started(view: AgentThreadView, live: AgentLiveCheckoutBranches, servers = [LINUX]) {
  return composerProps({
    isolation: view.thread.target.isolation,
    mode: { kind: "followUp", blockedReason: null },
    executionServerId: view.execution?.kind === "remote" ? view.execution.serverId : null,
    threadLocation: agentComposerThreadLocation(view, servers, live),
  });
}

interface HarnessProps {
  readonly composer: AgentComposerProps;
  readonly thread: AgentThreadView | null;
  readonly checkout: {
    readonly gateway: ComposerBranchGateway;
    readonly guard: () => string | null;
  } | null;
  readonly port: AgentThreadBranchMemoryPort;
  readonly live: AgentLiveCheckoutBranches;
}

function Harness({ checkout, composer, live, port, thread }: HarnessProps) {
  const branchMemory = useAgentThreadBranchMemory(port);
  useAgentThreadBranchRecorder(thread === null ? NO_THREADS : [thread], live, branchMemory);
  const extras = useAgentComposerDrawerExtras(checkout, undefined, {
    thread,
    branchMemory,
    liveCheckoutBranches: live,
  });
  return (
    <AgentComposer
      {...composer}
      banners={extras.banners}
      renderDrawerEnd={extras.renderDrawerEnd}
    />
  );
}

describe("AgentComposer workspace strip", () => {
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

  async function render(props: HarnessProps, servers: ReadonlyArray<RemoteRunnerServer> | null) {
    const selectServer = vi.fn();
    const tree =
      servers === null ? (
        <Harness {...props} />
      ) : (
        <RemoteRunnerContext.Provider
          value={{
            gateway: new TauriRemoteRunnerGateway(vi.fn()),
            servers,
            status: "ready",
            error: null,
            selectedServerId: props.composer.executionServerId ?? null,
            selectServer,
            refresh: vi.fn(),
            connect: vi.fn(),
            disconnect: vi.fn(),
            remove: vi.fn(),
          }}
        >
          <Harness {...props} />
        </RemoteRunnerContext.Provider>
      );
    await act(async () => root.render(tree));
    return { selectServer };
  }

  function footer(): HTMLElement {
    const element = host.querySelector<HTMLElement>(".agent-composer__footer");
    expect(element).not.toBeNull();
    return element ?? document.createElement("div");
  }

  function button(selector: string): HTMLButtonElement | null {
    return host.querySelector<HTMLButtonElement>(selector);
  }

  function menuRows(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitemradio"]')];
  }

  function menuRow(label: string): HTMLElement | undefined {
    return menuRows().find((row) => rowLabel(row) === label);
  }

  function rowLabel(row: HTMLElement): string | null | undefined {
    return row.querySelector(".cv-menu__text")?.firstChild?.textContent;
  }

  function locks(): string[] {
    return [...host.querySelectorAll(".agent-composer__lock")].map(
      (node) => node.textContent ?? "",
    );
  }

  function branchTrigger(): HTMLButtonElement | null {
    return button('button[aria-label^="Branch: "]');
  }

  function base(overrides: Partial<HarnessProps> = {}): HarnessProps {
    return {
      composer: composerProps(),
      thread: null,
      checkout: { gateway: gitGateway().git, guard: () => null },
      port: memoryPort(),
      live: new Map([[ROOT, "main"]]),
      ...overrides,
    };
  }

  it("shows only the checkout picker and the branch for a new draft without servers", async () => {
    await render(base(), null);
    expect(button("#agent-run-on")).toBeNull();
    const checkout = button("#agent-checkout");
    expect(checkout?.textContent).toBe("Local checkout");
    expect(checkout?.getAttribute("aria-label")).toBe("Workspace: Local checkout");
    expect(branchTrigger()?.textContent).toBe("main");
    expect(footer().textContent).not.toMatch(/in place/iu);
  });

  it("offers Run on for a new draft once a server is configured", async () => {
    const { selectServer } = await render(base(), [LINUX, OFFLINE]);
    const runOn = button("#agent-run-on");
    expect(runOn?.textContent).toBe("This computer");
    expect(runOn?.getAttribute("aria-label")).toBe("Run on: This computer");
    act(() => runOn?.click());
    expect(menuRows().map((row) => rowLabel(row))).toEqual([
      "This computer",
      "Linux server",
      "Offline",
    ]);
    expect(menuRow("Offline")?.getAttribute("aria-disabled")).toBe("true");
    expect(menuRow("Offline")?.textContent).toContain("Connect in settings");
    act(() => menuRow("Linux server")?.click());
    expect(selectServer).toHaveBeenCalledExactlyOnceWith("linux");
    expect(button("#agent-checkout")?.textContent).toBe("Local checkout");
  });

  it("names the selected server and its server checkout before the first message", async () => {
    await render(base({ composer: composerProps({ executionServerId: "linux" }) }), [LINUX]);
    expect(button("#agent-run-on")?.textContent).toBe("Linux server");
    expect(button("#agent-checkout")?.textContent).toBe("Server checkout");
    expect(branchTrigger()).toBeNull();
  });

  it("locks a started local checkout and keeps its branch picker live", async () => {
    const view = inPlaceView();
    const live = new Map([[ROOT, "main"]]);
    await render(base({ composer: started(view, live), thread: view, live }), [LINUX]);
    expect(button("#agent-checkout")).toBeNull();
    expect(button("#agent-run-on")).toBeNull();
    expect(locks()).toEqual(["Checkout:Local checkout"]);
    expect(branchTrigger()?.textContent).toBe("main");
    expect(branchTrigger()?.disabled).toBe(false);
  });

  it("shows Worktree with its read-only branch, and New worktree only while it is created", async () => {
    const view = worktreeView();
    const live = new Map([[ROOT, "main"]]);
    await render(base({ composer: started(view, live), thread: view, live }), null);
    expect(locks()).toEqual(["Checkout:Worktree"]);
    expect(branchTrigger()).toBeNull();
    const branch = host.querySelector(".agent-composer__branch-label");
    expect(branch?.textContent).toBe("Branch:agent/agt-1· 2 ahead of main");
    expect(branch?.querySelector("button")).toBeNull();
    const creating = worktreeView(null);
    await render(base({ composer: started(creating, live), thread: creating, live }), null);
    expect(locks()).toEqual(["Checkout:New worktree"]);
    expect(host.querySelector(".agent-composer__branch-label")).toBeNull();
  });

  it("names the server and its checkout for a remote thread and shows no branch", async () => {
    const view = remoteView();
    const live = new Map([[ROOT, "main"]]);
    await render(base({ composer: started(view, live), thread: view, live }), [LINUX]);
    expect(locks()).toEqual(["Runs on:Linux server", "Checkout:Server checkout"]);
    expect(branchTrigger()).toBeNull();
    expect(host.querySelector(".agent-composer__branch-label")).toBeNull();
  });

  it("offers the previous worktree with its branch and reads Worktree once chosen", async () => {
    const onSelect = vi.fn();
    const choice = (selected: boolean): AgentComposerPreviousWorktreeChoice => ({
      available: { threadId: "agt-9", worktreePath: "/wt/agt-9", branch: "agent/retry-banner" },
      selected,
      onSelect,
    });
    await render(base({ composer: composerProps({ previousWorktree: choice(false) }) }), null);
    act(() => button("#agent-checkout")?.click());
    const row = menuRow("Previous worktree (agent/retry-banner)");
    expect(row?.querySelector(".cv-menu__description")).toBeNull();
    act(() => row?.click());
    expect(onSelect).toHaveBeenCalledOnce();
    await render(
      base({
        composer: composerProps({ isolation: "worktree", previousWorktree: choice(true) }),
      }),
      null,
    );
    expect(button("#agent-checkout")?.textContent).toBe("Worktree");
    expect(branchTrigger()).toBeNull();
    expect(host.querySelector(".agent-composer__branch-label")?.textContent).toBe(
      "Branch:agent/retry-banner",
    );
    act(() => button("#agent-checkout")?.click());
    expect(menuRow("Previous worktree (agent/retry-banner)")?.getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(menuRow("New worktree")?.getAttribute("aria-checked")).toBe("false");
  });

  describe("started local checkout branch", () => {
    async function openBranches(): Promise<void> {
      await act(async () => branchTrigger()?.click());
    }

    function option(name: string): HTMLElement | undefined {
      return [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (node) => node.querySelector(".agent-branch-picker__name")?.textContent === name,
      );
    }

    it("switches through the typed gateway and remembers the user's own switch", async () => {
      const view = inPlaceView();
      const live = new Map([[ROOT, "main"]]);
      const git = gitGateway();
      const port = memoryPort();
      const checkout = { gateway: git.git, guard: () => null };
      await render(
        base({ composer: started(view, live), thread: view, live, port, checkout }),
        null,
      );
      await openBranches();
      await act(async () => option("feat/a")?.click());
      expect(git.git.switchBranch).toHaveBeenCalledExactlyOnceWith(ROOT, "feat/a");
      expect(agentThreadBranchOf(port.saved, THREAD_A)).toBe("feat/a");
      expect(branchTrigger()?.textContent).toBe("feat/a");
      expect(host.textContent).not.toContain("Branch changed");
    });

    it("refuses the switch with the guard's reason", async () => {
      const view = inPlaceView();
      const live = new Map([[ROOT, "main"]]);
      const git = gitGateway();
      const checkout = { gateway: git.git, guard: () => "A thread is running in this checkout." };
      await render(base({ composer: started(view, live), thread: view, live, checkout }), null);
      await openBranches();
      await act(async () => option("feat/a")?.click());
      expect(git.git.switchBranch).not.toHaveBeenCalled();
      expect(document.querySelector('[role="alert"]')?.textContent).toBe(
        "A thread is running in this checkout.",
      );
    });

    it("warns that the branch changed and restores it through the same command", async () => {
      const view = inPlaceView();
      const live = new Map([[ROOT, "feature/x"]]);
      const git = gitGateway("feature/x");
      const pending = deferred<void>();
      git.git.switchBranch.mockImplementationOnce(async (_root: string, name: string) => {
        await pending.promise;
        git.setCurrent(name);
      });
      const port = memoryPort(
        rememberAgentThreadBranch(EMPTY_AGENT_THREAD_BRANCH_MEMORY, THREAD_A, "main"),
      );
      const checkout = { gateway: git.git, guard: () => null };
      await render(
        base({ composer: started(view, live), thread: view, live, port, checkout }),
        null,
      );
      const notice = host.querySelector(".agent-branch-changed");
      expect(notice?.textContent).toBe("Branch changed — was main");
      expect(notice?.querySelector("code")?.textContent).toBe("main");
      expect(notice?.getAttribute("title")).toBe(
        "This thread last ran on main. Sending will continue on feature/x.",
      );
      const restore = [...host.querySelectorAll("button")].find(
        (node) => node.textContent === "Restore branch",
      );
      act(() => restore?.click());
      await act(async () => undefined);
      expect(git.git.switchBranch).toHaveBeenCalledExactlyOnceWith(ROOT, "main");
      const restoring = [...host.querySelectorAll("button")].find(
        (node) => node.textContent === "Restoring...",
      );
      expect(restoring?.disabled).toBe(true);
      await act(async () => pending.resolve());
      expect(host.querySelector(".agent-branch-changed")).toBeNull();
    });

    it("dismisses the notice for this thread and branch pair only", async () => {
      const view = inPlaceView();
      const live = new Map([[ROOT, "feature/x"]]);
      const git = gitGateway("feature/x");
      const port = memoryPort(
        rememberAgentThreadBranch(EMPTY_AGENT_THREAD_BRANCH_MEMORY, THREAD_A, "main"),
      );
      const props = base({
        composer: started(view, live),
        thread: view,
        live,
        port,
        checkout: { gateway: git.git, guard: () => null },
      });
      await render(props, null);
      act(() =>
        host
          .querySelector<HTMLButtonElement>('[aria-label="Dismiss branch change notice"]')
          ?.click(),
      );
      expect(host.querySelector(".agent-branch-changed")).toBeNull();
      git.setCurrent("feat/a");
      const moved = new Map([[ROOT, "feat/a"]]);
      await render({ ...props, live: moved, composer: started(view, moved) }, null);
      expect(host.querySelector(".agent-branch-changed")?.textContent).toBe(
        "Branch changed — was main",
      );
    });

    it("keeps the strip picker's error out of the branch changed notice", async () => {
      const view = inPlaceView();
      const live = new Map([[ROOT, "feature/x"]]);
      const git = gitGateway("feature/x");
      const port = memoryPort(
        rememberAgentThreadBranch(EMPTY_AGENT_THREAD_BRANCH_MEMORY, THREAD_A, "main"),
      );
      const checkout = { gateway: git.git, guard: () => "Save or discard your changes first." };
      await render(
        base({ composer: started(view, live), thread: view, live, port, checkout }),
        null,
      );
      await openBranches();
      await act(async () => option("feat/a")?.click());
      expect(document.querySelector('.agent-branch-picker [role="alert"]')?.textContent).toBe(
        "Save or discard your changes first.",
      );
      expect(host.querySelector(".agent-branch-changed")).not.toBeNull();
      expect(host.querySelector(".agent-branch-changed__error")).toBeNull();
    });

    it("surfaces the guard reason when restoring is blocked", async () => {
      const view = inPlaceView();
      const live = new Map([[ROOT, "feature/x"]]);
      const git = gitGateway("feature/x");
      const port = memoryPort(
        rememberAgentThreadBranch(EMPTY_AGENT_THREAD_BRANCH_MEMORY, THREAD_A, "main"),
      );
      const checkout = { gateway: git.git, guard: () => "Save or discard your changes first." };
      await render(
        base({ composer: started(view, live), thread: view, live, port, checkout }),
        null,
      );
      const restore = [...host.querySelectorAll("button")].find(
        (node) => node.textContent === "Restore branch",
      );
      await act(async () => restore?.click());
      expect(git.git.switchBranch).not.toHaveBeenCalled();
      expect(host.querySelector(".agent-branch-changed__error")?.textContent).toBe(
        "Save or discard your changes first.",
      );
    });

    it("drops a restore that settles after another thread was selected", async () => {
      const viewA = inPlaceView("agt-1");
      const viewB = inPlaceView("agt-2");
      const live = new Map([[ROOT, "feature/x"]]);
      const git = gitGateway("feature/x");
      const pending = deferred<void>();
      git.git.switchBranch.mockImplementationOnce(async (_root: string, name: string) => {
        await pending.promise;
        git.setCurrent(name);
      });
      const port = memoryPort(
        rememberAgentThreadBranch(EMPTY_AGENT_THREAD_BRANCH_MEMORY, THREAD_A, "main"),
      );
      const checkout = { gateway: git.git, guard: () => null };
      const props = base({ composer: started(viewA, live), thread: viewA, live, port, checkout });
      await render(props, null);
      const restore = [...host.querySelectorAll("button")].find(
        (node) => node.textContent === "Restore branch",
      );
      act(() => restore?.click());
      await act(async () => undefined);
      await render({ ...props, composer: started(viewB, live), thread: viewB }, null);
      const loadsBefore = git.git.getBranches.mock.calls.length;
      await act(async () => pending.resolve());
      expect(git.git.getBranches.mock.calls.length).toBe(loadsBefore);
      expect(agentThreadBranchOf(port.saved, THREAD_B)).toBeNull();
      expect(agentThreadBranchOf(port.saved, THREAD_A)).toBe("main");
      expect(branchTrigger()?.textContent).toBe("feature/x");
    });

    it("remembers the branch a running turn uses", async () => {
      const view = inPlaceView("agt-1", "running");
      const live = new Map([[ROOT, "feature/x"]]);
      const port = memoryPort();
      await render(
        base({
          composer: started(view, live),
          thread: view,
          live,
          port,
          checkout: { gateway: gitGateway("feature/x").git, guard: () => null },
        }),
        null,
      );
      expect(agentThreadBranchOf(port.saved, THREAD_A)).toBe("feature/x");
      expect(host.querySelector(".agent-branch-changed")).toBeNull();
    });
  });
});
