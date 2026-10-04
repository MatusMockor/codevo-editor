// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAgentThreadNotificationCenter,
  type AgentAppFocusPort,
  type AgentSystemAttentionPort,
  type AgentSystemNotification,
} from "../../application/agentThreadNotificationCenter";
import { workbenchAgentPaletteProvider } from "../../application/commandPalette/commandPaletteProvider";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { PROJECT_DISPLAY_NAMES_STORAGE_KEY } from "../../application/projectDisplayNames";
import type { AgentHistoryCatalogSurface } from "../../application/useAgentHistoryCatalog";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { AgentTurn, AgentTurnStatus } from "../../domain/agentThread";
import type { RemoteRunnerGateway } from "../../domain/remoteRunner";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { waitForReact } from "../../test/reactTestLifecycle";
import { RemoteRunnerProvider } from "../remoteRunner/RemoteRunnerProvider";
import { AgentModeView, type AgentModeViewProps } from "./AgentModeView";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import {
  fixtureRepository,
  projectFixture,
  threadsSurfaceFixture,
} from "./agentThreadsSurfaceTestFixtures";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";

const LOCAL = "/workspace/editor";
const SERVER = "remote:linux:runner:codevo-editor";
const NESTED = `${LOCAL}/packages/api`;
const API = "/workspace/api-service";
const IDENTITY = "github.com/codevo/editor";
const RUNNING = { kind: "running" } as const;
const DONE = { kind: "exited", exitCode: 0 } as const;

class WindowFocus implements AgentAppFocusPort {
  isFocused(): boolean {
    return true;
  }
  subscribe(): () => void {
    return () => undefined;
  }
}

class SystemAttention implements AgentSystemAttentionPort {
  readonly notifications: AgentSystemNotification[] = [];
  async notify(notification: AgentSystemNotification) {
    this.notifications.push(notification);
    return "delivered" as const;
  }
  async setBadgeCount(): Promise<void> {}
  recheckPermission(): void {}
}

function project(rootKey: string, label: string, identity?: string): AgentProjectDescriptor {
  return projectFixture({
    rootKey,
    rootPath: rootKey,
    ownerId: `agent-root:${rootKey}`,
    label,
    origin: rootKey === LOCAL ? "active-tab" : "background-tab",
    repositories:
      rootKey === LOCAL
        ? [fixtureRepository(LOCAL, ""), fixtureRepository(NESTED, "packages/api")]
        : [fixtureRepository(rootKey, "")],
    ...(identity === undefined ? {} : { repositoryIdentity: identity }),
  });
}

function turn(status: AgentTurnStatus, turnId: string): AgentTurn {
  const live = status.kind === "running";
  return {
    turnId,
    prompt: "Do the work",
    status,
    startedAtEpochMs: 1_700_000_000_000,
    endedAtEpochMs: live ? null : 1_700_000_100_000,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 1,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
}

function threadIn(threadId: string, rootKey: string, status: AgentTurnStatus): AgentThreadView {
  const base = surfaceThreadView().thread;
  return surfaceThreadView({
    repositoryLabel: "folder",
    lifecycle: status.kind === "running" ? "running" : "settled",
    thread: {
      ...base,
      threadId,
      title: `Thread ${threadId}`,
      target: { isolation: "in-place", worktreePath: null },
      owner: { rootKey, ownerId: `agent-root:${rootKey}`, repositoryRoot: rootKey },
      turns: [turn(status, `${threadId}-turn`)],
    },
  });
}

function catalogFixture(): AgentHistoryCatalogSurface {
  return {
    projects: [
      { rootKey: LOCAL, label: "editor" },
      { rootKey: API, label: "api-service" },
    ],
    page: {
      rootKey: LOCAL,
      threads: [],
      hasEarlier: false,
      beforeThreadId: null,
      loading: false,
      deletingThreadId: null,
      error: null,
      notice: null,
    },
    rows: [],
    choose: async () => undefined,
    older: async () => undefined,
    latest: async () => undefined,
    close: () => undefined,
    open: async () => true,
    rename: async () => true,
    setArchived: async () => true,
    remove: async () => true,
  };
}

function serverGateway() {
  return {
    collectInstructions: vi.fn().mockResolvedValue({ version: 1, files: [] }),
    listServers: vi.fn().mockResolvedValue([
      {
        id: "linux",
        name: "Linux server",
        host: "linux",
        username: "codex",
        port: 22,
        connected: true,
      },
    ]),
    connectServer: vi.fn(),
    disconnectServer: vi.fn(),
    removeServer: vi.fn(),
    getRunner: vi.fn().mockResolvedValue({
      protocolVersion: 1,
      runnerId: "runner",
      name: "Linux server",
      capabilities: { taskExecution: true, eventReplay: true, projectCloning: true },
    }),
    listProjects: vi.fn(async () => ({
      items: [
        { id: "codevo-editor", name: "codevo-editor" },
        { id: "docs", name: "docs" },
        { id: "docs-copy", name: "docs" },
      ],
    })),
    cloneProject: vi.fn(),
    getProjectClone: vi.fn(),
    cancelProjectClone: vi.fn(),
    listTasks: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    createTask: vi.fn(),
    startTask: vi.fn(),
    getTask: vi.fn(),
    getTaskResume: vi.fn().mockResolvedValue({ available: true, reason: null }),
    continueTask: vi.fn(),
    cancelTask: vi.fn(),
    listEvents: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    getDiff: vi.fn().mockResolvedValue({ diff: "", truncated: false }),
    uploadAttachment: vi.fn(),
  } satisfies RemoteRunnerGateway;
}

describe("project display names across agent mode surfaces", () => {
  let host: HTMLDivElement;
  let root: Root;
  const selectWorkspace = vi.fn<(project: AgentProjectDescriptor | null) => void>();

  beforeEach(() => {
    localStorage.clear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    selectWorkspace.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function storeNames(names: ReadonlyArray<readonly [string, string]>): void {
    localStorage.setItem(
      PROJECT_DISPLAY_NAMES_STORAGE_KEY,
      JSON.stringify(
        names.map(([rootKey, name], index) => [
          rootKey,
          name,
          index.toString(16).padStart(16, "0"),
        ]),
      ),
    );
  }

  function props(overrides: Partial<AgentModeViewProps> = {}): AgentModeViewProps {
    return {
      agents: {
        ...threadsSurfaceFixture({
          threads: [
            threadIn("local-1", LOCAL, DONE),
            threadIn("server-1", SERVER, DONE),
            threadIn("api-1", API, RUNNING),
          ],
          repositories: [
            fixtureRepository(LOCAL, ""),
            fixtureRepository(NESTED, "packages/api"),
            fixtureRepository(API, ""),
          ],
        }),
        providerManagement: unconfiguredAgentProviderManagement(),
      },
      projects: [
        project(SERVER, "codevo-editor", IDENTITY),
        project(LOCAL, "editor", IDENTITY),
        project(API, "api-service"),
      ],
      workspaceRoot: LOCAL,
      overflowRootPaths: [],
      providerEnabled: { claudeCode: true, codex: true },
      chrome: chromeFixture({
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
    act(() => root.render(node));
  }

  function composerPickerValues(): ReadonlyArray<string> {
    return [...host.querySelectorAll(".agent-picker__value")].map((node) => node.textContent ?? "");
  }

  function identitySnapshot() {
    const palette = workbenchAgentPaletteProvider.current();
    return {
      activeProjectKey: palette?.activeProjectKey ?? null,
      projects: palette?.projects.map(({ key, path, current }) => ({ key, path, current })) ?? [],
      threads: palette?.threads.map(({ id, current }) => ({ id, current })) ?? [],
      railKeys: [...host.querySelectorAll<HTMLElement>(".agent-rail .cv-sb-project")].map(
        (node) => node.dataset.projectRootKey ?? "",
      ),
      workspace: selectWorkspace.mock.calls.map(([selected]) =>
        selected === null ? null : [selected.rootKey, selected.ownerId, selected.label],
      ),
    };
  }

  it("shows the display name in the command palette, composer picker and empty-thread title", () => {
    render(<AgentModeView {...props()} />);
    const before = identitySnapshot();
    expect(workbenchAgentPaletteProvider.current()?.projects.map((entry) => entry.label)).toEqual([
      "codevo-editor",
      "editor",
      "api-service",
    ]);
    expect(host.querySelector(".agent-empty__project")?.textContent).toBe("editor");
    expect(composerPickerValues()).toContain("editor");

    act(() => {
      storeNames([
        [LOCAL, "Flagship"],
        [API, "Backend"],
      ]);
      window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_DISPLAY_NAMES_STORAGE_KEY }));
    });

    const palette = workbenchAgentPaletteProvider.current();
    expect(palette?.projects.map((entry) => entry.label)).toEqual([
      "Flagship",
      "Flagship",
      "Backend",
    ]);
    expect(palette?.threads.map((entry) => [entry.id, entry.projectLabel])).toEqual(
      expect.arrayContaining([
        ["local-1", "Flagship"],
        ["server-1", "Flagship"],
        ["api-1", "Backend"],
      ]),
    );
    expect(host.querySelector(".agent-empty__project")?.textContent).toBe("Flagship");
    expect(composerPickerValues()).toContain("Flagship");
    expect(composerPickerValues()).not.toContain("editor");
    expect(
      host.querySelector('[aria-label="Thread breadcrumb"] button')?.getAttribute("aria-label"),
    ).toBe("New thread in Flagship");
    expect(identitySnapshot()).toEqual(before);
    expect(before.workspace[before.workspace.length - 1]).toEqual([
      LOCAL,
      `agent-root:${LOCAL}`,
      "editor",
    ]);
  });

  it("shows the display name in the saved conversations project list and keeps its root keys", () => {
    storeNames([
      [LOCAL, "Flagship"],
      [API, "Backend"],
    ]);
    const catalog = catalogFixture();
    const choose = vi.spyOn(catalog, "choose");
    const base = props();
    render(<AgentModeView {...base} agents={{ ...base.agents, catalog }} />);

    const select = host.querySelector<HTMLSelectElement>(
      'select[aria-label="Saved conversation project"]',
    );
    expect([...(select?.options ?? [])].map((option) => [option.value, option.text])).toEqual([
      [LOCAL, "Flagship"],
      [API, "Backend"],
    ]);
    expect(host.querySelector(".agent-history-catalog__header .cv-favicon")?.textContent).toBe("F");

    act(() => {
      if (select !== null) select.value = API;
      select?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(choose).toHaveBeenCalledExactlyOnceWith(API);
    expect(catalog.projects.map((entry) => entry.label)).toEqual(["editor", "api-service"]);
  });

  it("names the project by its display name in a thread notification and opens the same thread", () => {
    storeNames([[API, "Backend"]]);
    const center = createAgentThreadNotificationCenter({
      focus: new WindowFocus(),
      system: new SystemAttention(),
      now: () => Date.now(),
    });
    const stopCenter = center.start();
    const view = (apiStatus: AgentTurnStatus) => {
      const base = props({ threadNotifications: center });
      return (
        <AgentModeView
          {...base}
          agents={{
            ...base.agents,
            threads: [threadIn("local-1", LOCAL, RUNNING), threadIn("api-1", API, apiStatus)],
          }}
          threadNotificationsVisible
        />
      );
    };
    render(view(RUNNING));
    const row = host.querySelector<HTMLElement>('.agent-rail [data-thread-id="local-1"]');
    act(() => row?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    render(view(DONE));

    const toast = document.querySelector<HTMLElement>(
      ".toast-region--agent-threads .toast-notification",
    );
    expect(
      [".toast-notification__title", ".toast-notification-message", ".toast-notification__meta"]
        .map((selector) => toast?.querySelector(selector)?.textContent)
        .join(" | "),
    ).toBe("Thread finished | Thread api-1 | Backend");
    selectWorkspace.mockClear();
    const open = [...(toast?.querySelectorAll("button") ?? [])].find(
      (candidate) => candidate.textContent === "Open",
    );
    act(() => open?.click());

    expect(
      host.querySelector('section[aria-label^="Agent thread "]')?.getAttribute("aria-label"),
    ).toBe("Agent thread api-1");
    expect(selectWorkspace).toHaveBeenLastCalledWith(
      expect.objectContaining({ rootKey: API, ownerId: `agent-root:${API}`, label: "api-service" }),
    );
    act(() => root.render(null));
    stopCenter();
  });

  it("shows display names in the server draft project chooser and still tells duplicates apart", async () => {
    storeNames([
      ["remote:linux:runner:codevo-editor", "Flagship"],
      ["remote:linux:runner:docs", "Handbook"],
      ["remote:linux:runner:docs-copy", "Handbook"],
    ]);
    const gateway = serverGateway();
    await act(async () =>
      root.render(
        <RemoteRunnerProvider gateway={gateway}>
          <AgentModeView {...props({ projects: [project(LOCAL, "editor")] })} />
        </RemoteRunnerProvider>,
      ),
    );
    const runOn = host.querySelector<HTMLElement>('[aria-label="Run on: This computer"]');
    expect(runOn).not.toBeNull();
    act(() => runOn?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await waitForReact(() =>
      expect(document.querySelector('[role="menuitemradio"]')?.textContent).toContain(
        "This computer",
      ),
    );
    const server = [...document.querySelectorAll('[role="menuitemradio"]')].find((entry) =>
      entry.textContent?.includes("Linux server"),
    );
    act(() => server?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await waitForReact(() =>
      expect(
        host.querySelectorAll('section[aria-label="Choose server project"] option'),
      ).toHaveLength(4),
    );

    const options = [
      ...host.querySelectorAll<HTMLOptionElement>(
        'section[aria-label="Choose server project"] option',
      ),
    ];
    expect(options.map((option) => [option.value, option.text])).toEqual([
      ["", "Choose a project…"],
      ["remote:linux:runner:codevo-editor", "Flagship"],
      ["remote:linux:runner:docs", "Handbook · remote:linux:runner:docs"],
      ["remote:linux:runner:docs-copy", "Handbook · remote:linux:runner:docs-copy"],
    ]);
  });
});
