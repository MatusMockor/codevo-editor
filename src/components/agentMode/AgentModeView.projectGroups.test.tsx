// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentNewThreadPicker } from "../../application/agentNewThreadPicker";
import type { AgentRailProjectCollapsePreferencePort } from "../../application/agentRailProjectCollapsePreferencePort";
import type { AgentRailProjectFocusPreferencePort } from "../../application/agentRailProjectFocusPreferencePort";
import type { AgentRailProjectFocus } from "../../domain/agentRailProjectFocus";
import { createAgentViewCommandBridge } from "../../application/agentViewCommandBridge";
import { workbenchAgentPaletteProvider } from "../../application/commandPalette/commandPaletteProvider";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
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
const DOCS = "/workspace/docs";

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

class MemoryCollapsePreference implements AgentRailProjectCollapsePreferencePort {
  readonly saved: Array<ReadonlyArray<string>> = [];
  constructor(private stored: ReadonlyArray<string> = []) {}

  load(): ReadonlyArray<string> {
    return this.stored;
  }

  save(collapsed: ReadonlyArray<string>): void {
    this.stored = collapsed;
    this.saved.push(collapsed);
  }
}

class MemoryFocusPreference implements AgentRailProjectFocusPreferencePort {
  readonly saved: AgentRailProjectFocus[] = [];
  constructor(private stored: AgentRailProjectFocus = "all") {}

  load(): AgentRailProjectFocus {
    return this.stored;
  }

  save(focus: AgentRailProjectFocus): void {
    this.stored = focus;
    this.saved.push(focus);
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

describe("agent sidebar project groups and New thread picker", () => {
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

  function projectGroup(label: string): HTMLElement {
    const group = [...host.querySelectorAll<HTMLElement>(".agent-rail .cv-sb-project")].find(
      (candidate) => candidate.querySelector(".cv-sb-project__name")?.textContent === label,
    );
    expect(group).toBeDefined();
    return group as HTMLElement;
  }

  function projectToggle(label: string): HTMLButtonElement {
    const toggle = projectGroup(label).querySelector<HTMLButtonElement>(".cv-sb-project__toggle");
    expect(toggle).not.toBeNull();
    return toggle as HTMLButtonElement;
  }

  function projectThreadIds(label: string): ReadonlyArray<string> {
    return [...projectGroup(label).querySelectorAll<HTMLElement>("[data-thread-id]")].map(
      (row) => row.dataset.threadId ?? "",
    );
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

  function lastSelectedWorkspaceRoot(): string | null | undefined {
    const roots = selectedWorkspaceRoots();
    return roots[roots.length - 1];
  }

  function threeProjects(overrides: Partial<AgentModeViewProps> = {}): AgentModeViewProps {
    return props({
      projects: [project(APP, "app"), project(API, "api-service"), project(DOCS, "docs")],
      ...overrides,
    });
  }

  function projectNames(): ReadonlyArray<string> {
    return [...host.querySelectorAll(".agent-rail .cv-sb-project__name")].map(
      (node) => node.textContent ?? "",
    );
  }

  function switcher(): HTMLButtonElement {
    const button = host.querySelector<HTMLButtonElement>(".agent-rail .cv-sb-switch");
    expect(button).not.toBeNull();
    return button as HTMLButtonElement;
  }

  function switcherOptions(): ReadonlyArray<HTMLElement> {
    return [
      ...document.querySelectorAll<HTMLElement>(
        '[role="dialog"][aria-label="Switch project"] [role="option"]',
      ),
    ];
  }

  function chooseInSwitcher(label: string): void {
    act(() => switcher().click());
    const option = switcherOptions().find(
      (candidate) => candidate.querySelector(".cv-switch__label")?.textContent === label,
    );
    expect(option).toBeDefined();
    act(() => option?.click());
  }

  function projectNameButton(label: string): HTMLButtonElement {
    const button = projectGroup(label).querySelector<HTMLButtonElement>(".cv-sb-project__select");
    expect(button).not.toBeNull();
    return button as HTMLButtonElement;
  }

  function activeProjectLabel(): string {
    const palette = workbenchAgentPaletteProvider.current();
    return palette?.projects.find((candidate) => candidate.current)?.label ?? "";
  }

  it("shows every open project as a group without a filter or a workspace card", () => {
    render(<AgentModeView {...props()} />);

    expect(
      [...host.querySelectorAll(".agent-rail .cv-sb-project__name")].map(
        (node) => node.textContent,
      ),
    ).toEqual(["app", "api-service"]);
    expect(projectThreadIds("app")).toEqual(["a1"]);
    expect(projectThreadIds("api-service")).toEqual(["b1"]);
    expect(host.querySelector('button[aria-label^="Filter threads by project"]')).toBeNull();
    expect(host.querySelector(".cv-sb-ws")).toBeNull();
  });

  it("switches the active project and workspace when a row from another project opens", () => {
    render(<AgentModeView {...props()} />);
    clickRow("a1");
    expect(selectedSession()).toBe("a1");
    selectWorkspace.mockClear();

    clickRow("b1");

    expect(selectedSession()).toBe("b1");
    expect(new Set(selectedWorkspaceRoots())).toEqual(new Set([API]));
    expect(selectServer).not.toHaveBeenCalled();
    expect(railThreadIds()).toEqual(["a1", "b1"]);
    expect(projectGroup("api-service").dataset.current).toBe("true");
    expect(projectGroup("app").dataset.current).toBeUndefined();
  });

  it("persists a collapsed project and restores it after a remount", () => {
    const preference = new MemoryCollapsePreference();
    render(<AgentModeView {...props({ projectCollapsePreference: preference })} />);

    act(() => projectToggle("api-service").click());
    expect(projectThreadIds("api-service")).toEqual([]);
    expect(preference.saved).toEqual([[API]]);

    act(() => root.unmount());
    root = createRoot(host);
    render(<AgentModeView {...props({ projectCollapsePreference: preference })} />);

    expect(projectToggle("api-service").getAttribute("aria-expanded")).toBe("false");
    expect(railThreadIds()).toEqual(["a1"]);
  });

  it("keeps the selected thread's collapsed project collapsed across a remount", () => {
    const preference = new MemoryCollapsePreference();
    render(<AgentModeView {...props({ projectCollapsePreference: preference })} />);
    clickRow("b1");
    act(() => projectToggle("api-service").click());
    expect(projectThreadIds("api-service")).toEqual(["b1"]);

    act(() => root.unmount());
    root = createRoot(host);
    render(<AgentModeView {...props({ projectCollapsePreference: preference })} />);

    expect(projectToggle("api-service").getAttribute("aria-expanded")).toBe("false");
    expect(preference.load()).toEqual([API]);
  });

  it("expands the project of a thread selected from elsewhere", () => {
    const preference = new MemoryCollapsePreference([API]);
    render(<AgentModeView {...props({ projectCollapsePreference: preference })} />);
    expect(projectToggle("api-service").getAttribute("aria-expanded")).toBe("false");

    act(() => {
      workbenchAgentPaletteProvider.current()?.openThread("b1");
    });

    expect(selectedSession()).toBe("b1");
    expect(projectToggle("api-service").getAttribute("aria-expanded")).toBe("true");
    expect(preference.saved).toEqual([[]]);
  });

  it("starts a thread in a project from its hover button without touching the other project", () => {
    const picker: AgentNewThreadPicker = { open: vi.fn(() => true) };
    render(<AgentModeView {...props({ newThreadPicker: picker })} />);
    clickRow("a1");

    const button = host.querySelector<HTMLButtonElement>(
      '.agent-rail button[aria-label="Create new thread in api-service"]',
    );
    expect(button).not.toBeNull();
    expect(host.querySelector('[aria-label="New thread in api-service"]')).toBeNull();
    act(() => button?.click());

    expect(picker.open).not.toHaveBeenCalled();
    expect(selectedSession()).toBeNull();
    expect(host.querySelector('[aria-label="New thread in api-service"]')).not.toBeNull();
    expect(projectGroup("api-service").dataset.current).toBe("true");
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
  it("switches to a project without threads from the top-bar switcher and focuses on it", () => {
    const focusPreference = new MemoryFocusPreference();
    render(<AgentModeView {...threeProjects({ projectFocusPreference: focusPreference })} />);
    clickRow("a1");
    expect(switcher().textContent).toBe("AP");
    expect(switcher().title).toBe("app");
    selectWorkspace.mockClear();

    act(() => switcher().click());
    expect(
      switcherOptions().map(
        (option) => option.querySelector(".cv-switch__label")?.textContent ?? "",
      ),
    ).toEqual(["All projects", "app", "api-service", "docs"]);
    expect(switcherOptions()[0]?.getAttribute("aria-selected")).toBe("true");
    const docs = switcherOptions().find((option) => option.dataset.value === DOCS);
    act(() => docs?.click());

    expect(selectedSession()).toBeNull();
    expect(lastSelectedWorkspaceRoot()).toBe(DOCS);
    expect(activeProjectLabel()).toBe("docs");
    expect(projectNames()).toEqual(["docs"]);
    expect(railThreadIds()).toEqual([]);
    expect(projectGroup("docs").dataset.current).toBe("true");
    expect(switcher().textContent).toBe("DS");
    expect(switcher().getAttribute("aria-label")).toBe("Switch project: docs");
    expect(focusPreference.saved).toEqual(["active"]);
  });

  it("shows every project again from All projects without switching the workspace", () => {
    const focusPreference = new MemoryFocusPreference();
    render(<AgentModeView {...threeProjects({ projectFocusPreference: focusPreference })} />);
    chooseInSwitcher("api-service");
    expect(projectNames()).toEqual(["api-service"]);
    expect(lastSelectedWorkspaceRoot()).toBe(API);
    selectWorkspace.mockClear();

    chooseInSwitcher("All projects");

    expect(projectNames()).toEqual(["app", "api-service", "docs"]);
    expect(railThreadIds()).toEqual(["a1", "b1"]);
    expect(activeProjectLabel()).toBe("api-service");
    expect(selectedWorkspaceRoots().every((root) => root === API)).toBe(true);
    expect(focusPreference.saved).toEqual(["active", "all"]);
  });

  it("restores the focus mode on the active project after a remount", () => {
    const focusPreference = new MemoryFocusPreference();
    render(<AgentModeView {...threeProjects({ projectFocusPreference: focusPreference })} />);
    chooseInSwitcher("docs");

    act(() => root.unmount());
    root = createRoot(host);
    render(<AgentModeView {...threeProjects({ projectFocusPreference: focusPreference })} />);

    expect(projectNames()).toHaveLength(1);
    expect(projectNames()).toEqual([activeProjectLabel()]);
    expect(focusPreference.load()).toBe("active");
  });

  it("picks a project from the switcher with the keyboard", () => {
    render(<AgentModeView {...threeProjects()} />);
    clickRow("a1");
    act(() => switcher().click());
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search projects"]');
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "do");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(switcherOptions().map((option) => option.dataset.value)).toEqual([DOCS]);

    act(() => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });

    expect(switcherOptions()).toEqual([]);
    expect(lastSelectedWorkspaceRoot()).toBe(DOCS);
    expect(activeProjectLabel()).toBe("docs");
    expect(document.activeElement).toBe(switcher());
  });

  it("activates a project from its name while the chevron only collapses it", () => {
    render(<AgentModeView {...threeProjects()} />);
    clickRow("a1");
    selectWorkspace.mockClear();

    act(() => projectNameButton("docs").click());

    expect(selectedSession()).toBeNull();
    expect(lastSelectedWorkspaceRoot()).toBe(DOCS);
    expect(activeProjectLabel()).toBe("docs");
    expect(projectGroup("docs").dataset.current).toBe("true");
    expect(projectNames()).toEqual(["app", "api-service", "docs"]);

    selectWorkspace.mockClear();
    act(() => projectToggle("api-service").click());

    expect(projectToggle("api-service").getAttribute("aria-expanded")).toBe("false");
    expect(projectThreadIds("api-service")).toEqual([]);
    expect(activeProjectLabel()).toBe("docs");
    expect(selectedWorkspaceRoots()).not.toContain(API);
    expect(projectGroup("api-service").dataset.current).toBeUndefined();
  });

  it("keeps each project's own selection when switching A to B and back to A by name", () => {
    render(<AgentModeView {...props()} />);
    clickRow("a1");
    selectWorkspace.mockClear();

    act(() => projectNameButton("api-service").click());
    expect(selectedSession()).toBeNull();
    expect(lastSelectedWorkspaceRoot()).toBe(API);
    expect(activeProjectLabel()).toBe("api-service");

    act(() => projectNameButton("app").click());
    expect(selectedSession()).toBe("a1");
    expect(lastSelectedWorkspaceRoot()).toBe(APP);
    expect(activeProjectLabel()).toBe("app");
    expect(selectServer).not.toHaveBeenCalledWith(expect.any(String));
  });

  it("leaves the open thread alone when the current project's name is clicked", () => {
    render(<AgentModeView {...props()} />);
    clickRow("b1");

    act(() => projectNameButton("api-service").click());

    expect(selectedSession()).toBe("b1");
    expect(activeProjectLabel()).toBe("api-service");
  });

  it("expands a collapsed project when its name activates it", () => {
    const preference = new MemoryCollapsePreference([API]);
    render(<AgentModeView {...props({ projectCollapsePreference: preference })} />);
    clickRow("a1");
    expect(projectToggle("api-service").getAttribute("aria-expanded")).toBe("false");

    act(() => projectNameButton("api-service").click());

    expect(lastSelectedWorkspaceRoot()).toBe(API);
    expect(projectToggle("api-service").getAttribute("aria-expanded")).toBe("true");
    expect(projectThreadIds("api-service")).toEqual(["b1"]);
  });
});
