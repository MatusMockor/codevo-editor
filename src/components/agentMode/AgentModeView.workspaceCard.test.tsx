// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentNewThreadPicker } from "../../application/agentNewThreadPicker";
import type { AgentRailFilterPreferencePort } from "../../application/agentRailFilterPreferencePort";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { AgentRailFilter } from "../../domain/agentRailFilter";
import type { GitShipStatus } from "../../domain/gitIntegration";
import type { RemoteRunnerGateway } from "../../domain/remoteRunner";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import {
  RemoteRunnerContext,
  type RemoteRunnerContextValue,
} from "../remoteRunner/remoteRunnerContext";
import { AgentModeView, type AgentModeViewProps } from "./AgentModeView";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import {
  fixtureRepository,
  projectFixture,
  threadsSurfaceFixture,
} from "./agentThreadsSurfaceTestFixtures";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";

const APP = "/workspace/app";
const API = "/workspace/api-service";
const APP_WORKTREE = `${APP}/.worktrees/agt-7ede`;
const WT_BRANCH = "agent/agt-mue1wenj-7ede";

function project(rootKey: string, label: string): AgentProjectDescriptor {
  return projectFixture({
    rootKey,
    rootPath: rootKey,
    ownerId: `agent-root:${label}`,
    label,
    repositories: [fixtureRepository(rootKey, "")],
  });
}

function threadIn(
  threadId: string,
  rootKey: string,
  label: string,
  overrides: Partial<AgentThreadView> = {},
): AgentThreadView {
  const base = surfaceThreadView().thread;
  return surfaceThreadView({
    repositoryLabel: label,
    ...overrides,
    thread: {
      ...base,
      threadId,
      title: `Thread ${threadId}`,
      target: { isolation: "in-place", worktreePath: null },
      owner: { rootKey, ownerId: `agent-root:${label}`, repositoryRoot: rootKey },
      ...overrides.thread,
    },
  });
}

function shipStatus(): GitShipStatus {
  return {
    worktree: { branch: WT_BRANCH, head: "abc", dirty: false, changeCount: 0 },
    primary: { branch: "main", head: "def", dirty: false },
    relation: { aheadOfPrimary: 2, behindPrimary: 0, fastForwardable: true },
    remote: null,
  };
}

function worktreeThread(): AgentThreadView {
  const base = threadIn("w1", APP, "app");
  return threadIn("w1", APP, "app", {
    ship: { kind: "idle", status: shipStatus(), loadingStatus: false },
    thread: { ...base.thread, target: { isolation: "worktree", worktreePath: APP_WORKTREE } },
  });
}

function serverThread(): AgentThreadView {
  return threadIn("s1", API, "api-service", {
    execution: {
      kind: "remote",
      serverId: "build",
      runnerId: "runner",
      projectId: "orders",
      conversationId: "c-1",
      latestTaskId: "task-1",
      resume: null,
    },
  });
}

class MemoryRailFilterPreference implements AgentRailFilterPreferencePort {
  readonly saved: AgentRailFilter[] = [];
  constructor(private stored: AgentRailFilter = { kind: "all" }) {}

  load(): AgentRailFilter {
    return this.stored;
  }

  save(filter: AgentRailFilter): void {
    this.stored = filter;
    this.saved.push(filter);
  }
}

function remoteContext(): RemoteRunnerContextValue {
  return {
    gateway: {} as RemoteRunnerGateway,
    servers: [
      {
        id: "build",
        name: "build-box",
        host: "build",
        username: "codex",
        port: 22,
        connected: true,
      },
    ],
    status: "ready",
    error: null,
    refresh: async () => undefined,
    connect: async () => null,
    disconnect: async () => undefined,
    remove: async () => undefined,
    selectedServerId: null,
    selectServer: () => undefined,
  };
}

describe("agent sidebar workspace card", () => {
  let host: HTMLDivElement;
  let root: Root;
  const selectWorkspace = vi.fn<(project: AgentProjectDescriptor | null) => void>();
  const revealPath = vi.fn<(path: string) => Promise<void>>(async () => undefined);

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    selectWorkspace.mockReset();
    revealPath.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function props(overrides: Partial<AgentModeViewProps> = {}): AgentModeViewProps {
    return {
      agents: {
        ...threadsSurfaceFixture({
          threads: [
            threadIn("a1", APP, "app"),
            worktreeThread(),
            threadIn("b1", API, "api-service"),
          ],
          repositories: [fixtureRepository(APP, ""), fixtureRepository(API, "")],
        }),
        providerManagement: unconfiguredAgentProviderManagement(),
      },
      projects: [project(APP, "app"), project(API, "api-service")],
      workspaceRoot: APP,
      overflowRootPaths: [],
      providerEnabled: { claudeCode: true, codex: true },
      chrome: chromeFixture({
        liveCheckoutBranches: new Map([
          [APP, "main"],
          [API, "develop"],
        ]),
        revealPath,
        workspaceActivation: {
          select: selectWorkspace,
          state: { kind: "none", rootPath: null },
          retry: () => undefined,
        },
      }),
      onTrustProject: () => undefined,
      onReleaseProject: () => undefined,
      ...overrides,
    };
  }

  function render(node: ReactNode): void {
    act(() =>
      root.render(
        <RemoteRunnerContext.Provider value={remoteContext()}>{node}</RemoteRunnerContext.Provider>,
      ),
    );
  }

  function card(): HTMLButtonElement {
    const button = host.querySelector<HTMLButtonElement>(".agent-rail button.cv-sb-ws");
    expect(button).not.toBeNull();
    return button as HTMLButtonElement;
  }

  function cardText(): string {
    return [
      card().querySelector(".cv-sb-ws__project")?.textContent ?? "",
      card().querySelector(".cv-sb-ws__loc")?.textContent ?? "",
    ].join(" | ");
  }

  function clickRow(threadId: string): void {
    const row = host.querySelector<HTMLElement>(`.agent-rail [data-thread-id="${threadId}"]`);
    expect(row).not.toBeNull();
    act(() => row?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  }

  function selectedSession(): string | null {
    const section = host.querySelector<HTMLElement>('section[aria-label^="Agent thread "]');
    return section?.getAttribute("aria-label")?.replace("Agent thread ", "") ?? null;
  }

  function filterTrigger(): HTMLButtonElement {
    const trigger = host.querySelector<HTMLButtonElement>(
      'button[aria-label^="Filter threads by project"]',
    );
    expect(trigger).not.toBeNull();
    return trigger as HTMLButtonElement;
  }

  function menu(): HTMLElement {
    const dialog = document.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Workspace details"]',
    );
    expect(dialog).not.toBeNull();
    return dialog as HTMLElement;
  }

  function menuButton(label: string): HTMLButtonElement {
    const button = [...menu().querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent?.includes(label) === true,
    );
    expect(button).toBeDefined();
    return button as HTMLButtonElement;
  }

  it("shows a local checkout draft before any thread is selected", () => {
    render(<AgentModeView {...props()} />);

    expect(selectedSession()).toBeNull();
    expect(cardText()).toBe("app | Local checkout· main");
    expect(card().getAttribute("aria-label")).toBe("Workspace: app, Local checkout, main");
    expect(card().dataset.state).toBe("draft");
  });

  it("mirrors a local checkout thread", () => {
    render(<AgentModeView {...props()} />);
    clickRow("a1");

    expect(card().getAttribute("aria-label")).toBe("Workspace: app, Local checkout, main");
    expect(card().dataset.state).toBe("thread");
  });

  it("mirrors a worktree thread with its branch", () => {
    render(<AgentModeView {...props()} />);
    clickRow("w1");

    expect(cardText()).toBe(`app | Worktree· ${WT_BRANCH}`);
    expect(card().getAttribute("aria-label")).toBe(`Workspace: app, Worktree, ${WT_BRANCH}`);
  });

  it("names the server for a server thread", () => {
    render(
      <AgentModeView
        {...props({
          agents: {
            ...threadsSurfaceFixture({
              threads: [threadIn("a1", APP, "app"), serverThread()],
              repositories: [fixtureRepository(APP, ""), fixtureRepository(API, "")],
            }),
            providerManagement: unconfiguredAgentProviderManagement(),
          },
        })}
      />,
    );
    clickRow("s1");

    expect(cardText()).toBe("api-service | build-box· Server checkout");
    expect(card().getAttribute("aria-label")).toBe(
      "Workspace: api-service, build-box, Server checkout",
    );
  });

  it("follows the selection from one project to another", () => {
    render(<AgentModeView {...props()} />);
    clickRow("a1");
    expect(card().getAttribute("aria-label")).toBe("Workspace: app, Local checkout, main");

    clickRow("b1");
    expect(card().getAttribute("aria-label")).toBe(
      "Workspace: api-service, Local checkout, develop",
    );

    clickRow("w1");
    expect(card().getAttribute("aria-label")).toBe(`Workspace: app, Worktree, ${WT_BRANCH}`);
  });

  it("never changes the filter, the selection or the workspace when clicked", () => {
    const preference = new MemoryRailFilterPreference({ kind: "project", projectRootKey: API });
    render(<AgentModeView {...props({ railFilterPreference: preference })} />);
    expect(filterTrigger().getAttribute("aria-label")).toBe(
      "Filter threads by project: api-service",
    );
    clickRow("b1");
    selectWorkspace.mockClear();

    act(() => card().click());
    expect(card().getAttribute("aria-expanded")).toBe("true");
    act(() => card().click());

    expect(selectedSession()).toBe("b1");
    expect(preference.saved).toEqual([]);
    expect(filterTrigger().getAttribute("aria-label")).toBe(
      "Filter threads by project: api-service",
    );
    expect(selectWorkspace).not.toHaveBeenCalled();
  });

  it("opens New thread in… from the card menu without touching the selection", () => {
    const picker: AgentNewThreadPicker = { open: vi.fn(() => true) };
    render(<AgentModeView {...props({ newThreadPicker: picker })} />);
    clickRow("a1");

    act(() => card().click());
    expect(menuButton("New thread in…").textContent).toContain("⇧⌘N");
    act(() => menuButton("New thread in…").click());

    expect(picker.open).toHaveBeenCalledTimes(1);
    expect(selectedSession()).toBe("a1");
    expect(document.querySelector('[aria-label="Workspace details"]')).toBeNull();
  });

  it("lists the location details and reveals the worktree folder", () => {
    render(<AgentModeView {...props()} />);
    clickRow("w1");

    act(() => card().click());
    const details = menu().querySelector("dl")?.textContent ?? "";
    expect(details).toContain("This computer");
    expect(details).toContain("Worktree");
    expect(details).toContain(WT_BRANCH);
    expect(details).toContain("2 ahead · 0 behind main");
    expect(details).toContain(APP_WORKTREE);

    act(() => menuButton("Reveal").click());
    expect(revealPath).toHaveBeenCalledWith(APP_WORKTREE);
    expect(selectedSession()).toBe("w1");
  });

  it("offers no reveal action for a server thread", () => {
    render(
      <AgentModeView
        {...props({
          agents: {
            ...threadsSurfaceFixture({
              threads: [serverThread()],
              repositories: [fixtureRepository(APP, ""), fixtureRepository(API, "")],
            }),
            providerManagement: unconfiguredAgentProviderManagement(),
          },
        })}
      />,
    );
    clickRow("s1");

    act(() => card().click());
    expect(menu().textContent).toContain("build-box");
    expect(
      [...menu().querySelectorAll("button")].some((button) =>
        button.textContent?.includes("Reveal"),
      ),
    ).toBe(false);
  });
});
