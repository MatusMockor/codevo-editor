// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentNewThreadPicker } from "../../application/agentNewThreadPicker";
import type { AgentRailFilterPreferencePort } from "../../application/agentRailFilterPreferencePort";
import { createAgentViewCommandBridge } from "../../application/agentViewCommandBridge";
import { workbenchAgentPaletteProvider } from "../../application/commandPalette/commandPaletteProvider";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { AgentRailFilter } from "../../domain/agentRailFilter";
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

function project(rootKey: string, label: string): AgentProjectDescriptor {
  return projectFixture({
    rootKey,
    rootPath: rootKey,
    ownerId: `agent-root:${label}`,
    label,
    repositories: [fixtureRepository(rootKey, "")],
  });
}

function threadIn(threadId: string, rootKey: string, label: string): AgentThreadView {
  const base = surfaceThreadView().thread;
  return surfaceThreadView({
    repositoryLabel: label,
    thread: {
      ...base,
      threadId,
      title: `Thread ${threadId}`,
      target: { isolation: "in-place", worktreePath: null },
      owner: { rootKey, ownerId: `agent-root:${label}`, repositoryRoot: rootKey },
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

function remoteContext(selectServer: (serverId: string | null) => void): RemoteRunnerContextValue {
  return {
    gateway: {} as RemoteRunnerGateway,
    servers: [],
    status: "ready",
    error: null,
    refresh: async () => undefined,
    connect: async () => null,
    disconnect: async () => undefined,
    remove: async () => undefined,
    selectedServerId: null,
    selectServer,
  };
}

describe("agent sidebar project filter and New thread picker", () => {
  let host: HTMLDivElement;
  let root: Root;
  const selectWorkspace = vi.fn<(project: AgentProjectDescriptor | null) => void>();
  const selectServer = vi.fn<(serverId: string | null) => void>();

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    selectWorkspace.mockReset();
    selectServer.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function props(overrides: Partial<AgentModeViewProps> = {}): AgentModeViewProps {
    return {
      agents: {
        ...threadsSurfaceFixture({
          threads: [threadIn("a1", APP, "app"), threadIn("b1", API, "api-service")],
          repositories: [fixtureRepository(APP, ""), fixtureRepository(API, "")],
        }),
        providerManagement: unconfiguredAgentProviderManagement(),
      },
      projects: [project(APP, "app"), project(API, "api-service")],
      workspaceRoot: APP,
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
    act(() =>
      root.render(
        <RemoteRunnerContext.Provider value={remoteContext(selectServer)}>
          {node}
        </RemoteRunnerContext.Provider>,
      ),
    );
  }

  function filterTrigger(): HTMLButtonElement {
    const trigger = host.querySelector<HTMLButtonElement>(
      'button[aria-label^="Filter threads by project"]',
    );
    expect(trigger).not.toBeNull();
    return trigger as HTMLButtonElement;
  }

  function chooseFilter(label: string): void {
    act(() => filterTrigger().click());
    const option = [...document.querySelectorAll<HTMLElement>('.cv-filter [role="option"]')].find(
      (candidate) => candidate.querySelector(".cv-filter__label")?.textContent === label,
    );
    expect(option).toBeDefined();
    act(() => option?.click());
  }

  function railThreadIds(): ReadonlyArray<string> {
    return [...host.querySelectorAll<HTMLElement>(".agent-rail [data-thread-id]")].map(
      (row) => row.dataset.threadId ?? "",
    );
  }

  function selectedSession(): string | null {
    const section = host.querySelector<HTMLElement>('section[aria-label^="Agent thread "]');
    return section?.getAttribute("aria-label")?.replace("Agent thread ", "") ?? null;
  }

  function clickRow(threadId: string): void {
    const row = host.querySelector<HTMLElement>(`.agent-rail [data-thread-id="${threadId}"]`);
    expect(row).not.toBeNull();
    act(() => row?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  }

  function newThreadButton(): HTMLButtonElement {
    const button = host.querySelector<HTMLButtonElement>(
      '.agent-rail button[aria-label="New thread"]',
    );
    expect(button).not.toBeNull();
    return button as HTMLButtonElement;
  }

  function selectedWorkspaceRoots(): ReadonlyArray<string | null> {
    return selectWorkspace.mock.calls.map(([selected]) => selected?.rootKey ?? null);
  }

  it("filters rows only: it keeps the selected thread, the workspace and the server", () => {
    const preference = new MemoryRailFilterPreference();
    render(<AgentModeView {...props({ railFilterPreference: preference })} />);
    expect(filterTrigger().textContent).toContain("All projects");
    expect(filterTrigger().getAttribute("aria-label")).toBe("Filter threads by project");

    clickRow("a1");
    expect(selectedSession()).toBe("a1");
    selectWorkspace.mockClear();
    selectServer.mockClear();

    chooseFilter("api-service");

    expect(railThreadIds()).toEqual(["b1"]);
    expect(selectedSession()).toBe("a1");
    expect(selectedWorkspaceRoots()).not.toContain(API);
    expect(selectServer).not.toHaveBeenCalled();
    expect(filterTrigger().getAttribute("aria-label")).toBe(
      "Filter threads by project: api-service",
    );
    expect(filterTrigger().textContent).toContain("api-service");
    expect(preference.saved).toEqual([{ kind: "project", projectRootKey: API }]);
  });

  it("never follows a thread selected from another project", () => {
    render(
      <AgentModeView
        {...props({
          railFilterPreference: new MemoryRailFilterPreference({
            kind: "project",
            projectRootKey: API,
          }),
        })}
      />,
    );
    expect(railThreadIds()).toEqual(["b1"]);

    act(() => {
      workbenchAgentPaletteProvider.current()?.openThread("a1");
    });

    expect(selectedSession()).toBe("a1");
    expect(railThreadIds()).toEqual(["b1"]);
    expect(filterTrigger().getAttribute("aria-label")).toBe(
      "Filter threads by project: api-service",
    );
  });

  it("keeps the palette Switch project from moving the filter", () => {
    render(
      <AgentModeView {...props({ railFilterPreference: new MemoryRailFilterPreference() })} />,
    );
    act(() => {
      workbenchAgentPaletteProvider.current()?.switchProject(API);
    });
    expect(filterTrigger().getAttribute("aria-label")).toBe("Filter threads by project");
    expect(railThreadIds()).toEqual(expect.arrayContaining(["a1", "b1"]));
  });

  it("restores the filter from the persisted preference after a remount", () => {
    const preference = new MemoryRailFilterPreference();
    render(<AgentModeView {...props({ railFilterPreference: preference })} />);
    chooseFilter("api-service");
    act(() => root.unmount());
    root = createRoot(host);

    render(<AgentModeView {...props({ railFilterPreference: preference })} />);

    expect(filterTrigger().getAttribute("aria-label")).toBe(
      "Filter threads by project: api-service",
    );
    expect(railThreadIds()).toEqual(["b1"]);
  });

  it("falls back from a vanished project to All projects only once projects have loaded", () => {
    const preference = new MemoryRailFilterPreference({
      kind: "project",
      projectRootKey: "/workspace/gone",
    });
    render(
      <AgentModeView
        {...props({ railFilterPreference: preference, projects: [], projectsLoaded: false })}
      />,
    );
    render(
      <AgentModeView {...props({ railFilterPreference: preference, projectsLoaded: false })} />,
    );
    expect(filterTrigger().getAttribute("aria-label")).toBe("Filter threads by project");
    expect(preference.saved).toEqual([]);
    expect(preference.load()).toEqual({ kind: "project", projectRootKey: "/workspace/gone" });

    render(
      <AgentModeView {...props({ railFilterPreference: preference, projectsLoaded: true })} />,
    );

    expect(preference.saved).toEqual([{ kind: "all" }]);
    expect(filterTrigger().getAttribute("aria-label")).toBe("Filter threads by project");
  });

  it("creates directly in the active project from the button and Shift+Cmd+N with several projects", () => {
    const picker: AgentNewThreadPicker = { open: vi.fn(() => true) };
    const bridge = createAgentViewCommandBridge();
    render(<AgentModeView {...props({ newThreadPicker: picker, viewCommands: bridge })} />);
    clickRow("a1");

    expect(newThreadButton().title).toBe("New thread in app (⇧⌘N) · ⌘N: choose project");
    act(() => newThreadButton().click());
    expect(picker.open).not.toHaveBeenCalled();
    expect(selectedSession()).toBeNull();
    expect(host.querySelector('[aria-label="New thread in app"]')).not.toBeNull();

    clickRow("b1");
    act(() => bridge.run("agent.newThread"));
    expect(picker.open).not.toHaveBeenCalled();
    expect(selectedSession()).toBeNull();
    expect(host.querySelector('[aria-label="New thread in api-service"]')).not.toBeNull();
  });

  it("opens the New thread in picker on shift-click and Cmd+N", () => {
    const picker: AgentNewThreadPicker = { open: vi.fn(() => true) };
    const bridge = createAgentViewCommandBridge();
    render(<AgentModeView {...props({ newThreadPicker: picker, viewCommands: bridge })} />);
    clickRow("b1");
    selectServer.mockClear();

    act(() =>
      newThreadButton().dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })),
    );
    expect(picker.open).toHaveBeenCalledTimes(1);
    expect(selectedSession()).toBe("b1");

    act(() => bridge.run("agent.newThreadIn"));
    expect(picker.open).toHaveBeenCalledTimes(2);
    expect(selectedSession()).toBe("b1");
    expect(selectServer).not.toHaveBeenCalled();
  });

  it("creates directly when there is only one project", () => {
    const picker: AgentNewThreadPicker = { open: vi.fn(() => true) };
    const bridge = createAgentViewCommandBridge();
    render(
      <AgentModeView
        {...props({
          newThreadPicker: picker,
          viewCommands: bridge,
          projects: [project(APP, "app")],
        })}
      />,
    );
    clickRow("a1");
    expect(newThreadButton().title).toBe("New thread in app (⇧⌘N)");

    act(() =>
      newThreadButton().dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })),
    );
    expect(selectedSession()).toBeNull();
    clickRow("a1");
    act(() => bridge.run("agent.newThread"));
    expect(selectedSession()).toBeNull();
    expect(picker.open).not.toHaveBeenCalled();
  });

  it("falls back to creating directly when the picker cannot open", () => {
    const picker: AgentNewThreadPicker = { open: vi.fn(() => false) };
    const bridge = createAgentViewCommandBridge();
    render(<AgentModeView {...props({ newThreadPicker: picker, viewCommands: bridge })} />);
    clickRow("a1");

    act(() => bridge.run("agent.newThreadIn"));

    expect(picker.open).toHaveBeenCalledTimes(1);
    expect(selectedSession()).toBeNull();
  });

  it("creates directly in the project picked from the palette page", () => {
    const picker: AgentNewThreadPicker = { open: vi.fn(() => true) };
    render(<AgentModeView {...props({ newThreadPicker: picker })} />);
    clickRow("a1");

    let started = false;
    act(() => {
      started = workbenchAgentPaletteProvider.current()?.newThreadIn(API) ?? false;
    });

    expect(started).toBe(true);
    expect(picker.open).not.toHaveBeenCalled();
    expect(selectedSession()).toBeNull();
    expect(host.querySelector('[aria-label="New thread in api-service"]')).not.toBeNull();
  });
});
