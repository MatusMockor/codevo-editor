// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadSearchSurface, AgentThreadView } from "../../application/agentThreadPorts";
import { remoteAgentProjectKey } from "../../application/remoteAgentProjection";
import type { AgentPendingInteraction } from "../../domain/agentPendingInteraction";
import type { AgentRailWorkingSection } from "../../domain/agentRailWorkingSection";
import type { AgentThread, AgentTurn } from "../../domain/agentThread";
import {
  AGENT_RAIL_WORKING_SECTION_STORAGE_KEY,
  BrowserAgentRailWorkingSectionPreference,
} from "../../infrastructure/browserAgentRailWorkingSectionPreference";
import type { KeyValueStorage } from "../../infrastructure/browserSettingsGateway";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { AgentClockProvider } from "./agentClock";
import type { AgentProjectGroup } from "./agentModePresentation";
import { THREAD_JUMP_HINT_SHOW_DELAY_MS, agentRailScopeEntries } from "./agentSidebarPresentation";
import type { AgentStartingThread } from "./agentStartingThreads";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import { AgentThreadsSidebar, type AgentThreadsSidebarProps } from "./AgentThreadsSidebar";
import { useAgentRailProjectDisclosure } from "./useAgentRailProjectDisclosure";
import { useAgentRailWorkingRail } from "./useAgentRailWorkingRail";

const APP = "/workspace/app";
const API = "/workspace/api";
const REMOTE_APP = remoteAgentProjectKey("srv-1", "runner-1", "project-1");
const NOW = 1_700_000_600_000;
const TITLE = "Add a health check";
const PROVIDER_MANAGEMENT = unconfiguredAgentProviderManagement();
const NO_PENDING: ReadonlyMap<string, AgentPendingInteraction> = new Map();
const SEARCH: AgentThreadSearchSurface = {
  query: "",
  active: false,
  result: null,
  pending: false,
  setQuery: () => undefined,
  clear: () => undefined,
};

type SidebarOverrides = Partial<AgentThreadsSidebarProps>;
type HarnessProps = Omit<AgentThreadsSidebarProps, "projectDisclosure" | "workingRail">;

function memoryStorage(workingSection: AgentRailWorkingSection): KeyValueStorage {
  const values = new Map<string, string>(
    workingSection === "on" ? [[AGENT_RAIL_WORKING_SECTION_STORAGE_KEY, "on"]] : [],
  );
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

function runningTurn(startedAtEpochMs: number): AgentTurn {
  return {
    turnId: `turn-${startedAtEpochMs}`,
    prompt: TITLE,
    status: { kind: "running" },
    startedAtEpochMs,
    endedAtEpochMs: null,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
}

function thread(
  threadId: string,
  rootKey: string,
  metadata: Partial<AgentThread> = {},
): AgentThreadView {
  const base = surfaceThreadView().thread;
  return surfaceThreadView({
    thread: {
      ...base,
      threadId,
      title: threadId,
      owner: { rootKey, ownerId: `agent-root:${rootKey}`, repositoryRoot: rootKey },
      updatedAtEpochMs: NOW - 60_000,
      viewedAtEpochMs: NOW,
      ...metadata,
    },
  });
}

function startedThread(
  threadId: string,
  rootKey: string,
  metadata: Partial<AgentThread> = {},
): AgentThreadView {
  const view = thread(threadId, rootKey, {
    title: TITLE,
    turns: [runningTurn(NOW)],
    updatedAtEpochMs: NOW,
    ...metadata,
  });
  return { ...view, lifecycle: "running" };
}

function group(
  repositoryRoot: string,
  label: string,
  threads: ReadonlyArray<AgentThreadView>,
  memberProjectRootKeys?: ReadonlyArray<string>,
): AgentProjectGroup {
  const liveCount = threads.filter((view) => view.lifecycle === "running").length;
  return {
    projectRootKey: repositoryRoot,
    kind: "project",
    label,
    rootPath: repositoryRoot,
    trust: "trusted",
    origin: "active-tab",
    singleRepo: true,
    ...(memberProjectRootKeys === undefined ? {} : { memberProjectRootKeys }),
    repos: [
      {
        repositoryRoot,
        label,
        repositoryResolved: true,
        threads: threads.filter((view) => !view.thread.archived),
        archived: threads.filter((view) => view.thread.archived),
        orphans: [],
        liveCount,
      },
    ],
    liveCount,
  };
}

function starting(
  projectRootKey: string,
  patch: Partial<AgentStartingThread> = {},
): AgentStartingThread {
  return {
    key: "starting:1",
    projectRootKey,
    owner: { ownerId: `agent-root:${projectRootKey}`, generation: 1 },
    provider: "claudeCode",
    threadId: null,
    title: TITLE,
    sentAtEpochMs: NOW,
    current: false,
    ...patch,
  };
}

function sidebarProps(overrides: SidebarOverrides): HarnessProps {
  const groups = overrides.groups ?? [];
  return {
    addProjectAvailable: true,
    groups,
    search: SEARCH,
    scope: { projectRootKey: APP, repositoryRoot: APP },
    scopeEntries: agentRailScopeEntries(groups),
    overflowRootPaths: [],
    selectedThreadId: null,
    providerManagement: PROVIDER_MANAGEMENT,
    providerEnabled: { claudeCode: true, codex: true },
    onOpenProviderSettings: () => undefined,
    onOpenSourceControl: () => undefined,
    onSelectThread: () => undefined,
    onTogglePin: () => undefined,
    onThreadMenuCommand: () => undefined,
    onNewThread: () => undefined,
    onAddProject: () => undefined,
    onProjectCommand: () => undefined,
    onNewThreadInProject: () => undefined,
    onSwitchProject: () => undefined,
    onFocusProject: () => undefined,
    onShowAllProjects: () => undefined,
    projectFocus: "all",
    collapseShortcut: "Cmd+B",
    pendingInteractions: NO_PENDING,
    ...overrides,
  };
}

function Harness(props: HarnessProps) {
  const projectDisclosure = useAgentRailProjectDisclosure(null);
  return <AgentThreadsSidebar {...props} projectDisclosure={projectDisclosure} />;
}

function WorkingHarness({
  preference,
  ...props
}: HarnessProps & { readonly preference: BrowserAgentRailWorkingSectionPreference }) {
  const projectDisclosure = useAgentRailProjectDisclosure(null);
  const working = useAgentRailWorkingRail(preference);
  return (
    <AgentThreadsSidebar
      {...props}
      projectDisclosure={projectDisclosure}
      workingRail={working.rail}
    />
  );
}

describe("AgentThreadsSidebar starting row", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers({
      toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"],
    });
    vi.setSystemTime(NOW);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  function renderProps(props: HarnessProps): void {
    act(() => {
      root.render(
        <AgentClockProvider nowTickMs={1000}>
          <Harness {...props} />
        </AgentClockProvider>,
      );
    });
  }

  function render(overrides: SidebarOverrides): void {
    renderProps(sidebarProps(overrides));
  }

  function projectList(label: string): HTMLElement | null {
    return host.querySelector<HTMLElement>(`[aria-label="${label} threads"]`);
  }

  function startingRows(scope: ParentNode = host): ReadonlyArray<HTMLElement> {
    return [...scope.querySelectorAll<HTMLElement>("[data-starting-thread]")];
  }

  function titles(scope: ParentNode = host): ReadonlyArray<string> {
    return [...scope.querySelectorAll<HTMLElement>(".cv-card-row__title")].map(
      (element) => element.textContent ?? "",
    );
  }

  function threadRowIds(): ReadonlyArray<string> {
    return [...host.querySelectorAll<HTMLElement>("[data-thread-id]")].map(
      (element) => element.dataset.threadId ?? "",
    );
  }

  function emptyLabel(label: string): string | null {
    return projectList(label)?.querySelector(".cv-sb-project__empty")?.textContent ?? null;
  }

  const twoProjects = (appThreads: ReadonlyArray<AgentThreadView> = []) => [
    group(APP, "app", appThreads),
    group(API, "api", []),
  ];

  it("shows a busy starting row at the top of its own project only", () => {
    render({
      groups: twoProjects([thread("app-old", APP)]),
      startingThreads: [starting(APP)],
    });

    const app = projectList("app");
    expect(app).not.toBeNull();
    const rows = startingRows();
    expect(rows).toHaveLength(1);
    const row = rows[0] as HTMLElement;
    expect(app?.contains(row)).toBe(true);
    expect(app?.firstElementChild?.contains(row)).toBe(true);
    expect(titles(app as HTMLElement)).toEqual([TITLE, "app-old"]);
    expect(row.getAttribute("role")).toBe("option");
    expect(row.getAttribute("aria-busy")).toBe("true");
    expect(row.getAttribute("aria-disabled")).toBe("true");
    expect(row.getAttribute("aria-selected")).toBe("false");
    expect(row.getAttribute("aria-label")).toBe(`Starting thread: ${TITLE}`);
    expect(row.getAttribute("aria-current")).toBeNull();
    expect(row.querySelector(".cv-card-row__status")?.getAttribute("data-tone")).toBe("work");
    expect(row.querySelector(".cv-card-row__status-label")?.textContent).toBe("Starting");
    expect(row.querySelector(".cv-card-row__runtime")?.getAttribute("aria-label")).toBe(
      "Claude Code, local",
    );
    expect(startingRows(projectList("api") as HTMLElement)).toEqual([]);
  });

  it("hides the project's empty label next to a starting row and keeps it elsewhere", () => {
    render({ groups: twoProjects(), startingThreads: [starting(APP)] });

    expect(emptyLabel("app")).toBeNull();
    expect(emptyLabel("api")).toBe("No threads yet");

    render({ groups: twoProjects() });

    expect(emptyLabel("app")).toBe("No threads yet");
  });

  it("marks the row current while its draft is the view being shown", () => {
    render({ groups: twoProjects(), startingThreads: [starting(APP, { current: true })] });

    const row = startingRows()[0] as HTMLElement;
    expect(row.getAttribute("aria-current")).toBe("true");
    expect(row.classList.contains("is-current")).toBe(true);

    render({ groups: twoProjects(), startingThreads: [starting(APP)] });

    expect(startingRows()[0]?.classList.contains("is-current")).toBe(false);
  });

  it("is not a thread: no selection, menu, drag, focus stop or jump hint", () => {
    const onSelectThread = vi.fn();
    const onNewThreadInProject = vi.fn();
    const onSwitchProject = vi.fn();
    const onThreadMenuCommand = vi.fn();
    render({
      groups: twoProjects([thread("app-old", APP), thread("app-older", APP, { sortOrder: 1 })]),
      startingThreads: [starting(APP)],
      onSelectThread,
      onNewThreadInProject,
      onSwitchProject,
      onThreadMenuCommand,
    });
    const row = startingRows()[0] as HTMLElement;

    act(() => row.click());
    act(() => {
      row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
      row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });

    expect(onSelectThread).not.toHaveBeenCalled();
    expect(onNewThreadInProject).not.toHaveBeenCalled();
    expect(onSwitchProject).not.toHaveBeenCalled();
    expect(onThreadMenuCommand).not.toHaveBeenCalled();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(host.querySelector('[aria-label="Rename thread"]')).toBeNull();
    expect(row.hasAttribute("data-thread-id")).toBe(false);
    expect(row.hasAttribute("tabindex")).toBe(false);
    expect(row.draggable).toBe(false);
    expect(row.parentElement?.querySelector(".cv-card-row__act")).toBeNull();
    expect(threadRowIds()).toEqual(["app-old", "app-older"]);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Control" }));
      vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS);
    });
    expect(row.querySelector(".cv-card-row__jump")).toBeNull();
    expect(
      [...host.querySelectorAll(".cv-card-row__jump")].map((label) =>
        label.textContent?.replace(/\D/g, ""),
      ),
    ).toEqual(["1", "2"]);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "Meta" }));
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "Control" }));
    });
  });

  it("keeps the roving keyboard order on real threads", () => {
    render({
      groups: twoProjects([thread("app-a", APP), thread("app-b", APP, { sortOrder: 1 })]),
      startingThreads: [starting(APP)],
    });
    const first = host.querySelector<HTMLElement>('[data-thread-id="app-a"]');
    expect(first?.tabIndex).toBe(0);

    act(() => {
      first?.focus();
      first?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }),
      );
    });

    expect((document.activeElement as HTMLElement | null)?.dataset.threadId).toBe("app-a");
  });

  it("hides the row while its project is collapsed and restores it when expanded", () => {
    render({
      groups: twoProjects([thread("app-old", APP)]),
      startingThreads: [starting(APP, { current: true })],
    });
    expect(startingRows()).toHaveLength(1);

    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Collapse app"]')?.click());

    expect(startingRows()).toEqual([]);
    expect(projectList("app")).toBeNull();

    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Expand app"]')?.click());

    expect(startingRows()).toHaveLength(1);
  });

  it("follows the focused-project filter like a thread of that project would", () => {
    const groups = twoProjects();
    render({ groups, projectFocus: "active", startingThreads: [starting(API)] });

    expect(projectList("api")).toBeNull();
    expect(startingRows()).toEqual([]);

    render({ groups, projectFocus: "all", startingThreads: [starting(API)] });

    expect(startingRows(projectList("api") as HTMLElement)).toHaveLength(1);
    expect(startingRows(projectList("app") as HTMLElement)).toEqual([]);
  });

  it("shows no starting row in search results", () => {
    render({
      groups: twoProjects(),
      startingThreads: [starting(APP)],
      search: { ...SEARCH, active: true, query: "health" },
    });

    expect(startingRows()).toEqual([]);
  });

  it("places an environment member's starting row under the group that owns the member", () => {
    render({
      groups: [group(APP, "app", [], [APP, REMOTE_APP]), group(API, "api", [])],
      startingThreads: [starting(REMOTE_APP, { provider: "codex" })],
    });

    const rows = startingRows(projectList("app") as HTMLElement);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.querySelector(".cv-card-row__runtime")?.getAttribute("aria-label")).toBe(
      "Codex, on server",
    );
    expect(startingRows(projectList("api") as HTMLElement)).toEqual([]);
  });

  it("gives way to the real thread row as soon as a thread with its id exists", () => {
    const startingThreads = [starting(APP, { threadId: "agt-new" })];
    render({ groups: twoProjects([thread("app-old", APP)]), startingThreads });
    expect(titles(projectList("app") as HTMLElement)).toEqual([TITLE, "app-old"]);
    expect(startingRows()).toHaveLength(1);

    render({
      groups: twoProjects([thread("app-old", APP), startedThread("agt-new", APP)]),
      startingThreads,
    });

    expect(startingRows()).toEqual([]);
    expect(titles(projectList("app") as HTMLElement)).toEqual([TITLE, "app-old"]);
    expect(threadRowIds()).toEqual(["agt-new", "app-old"]);
  });

  it("keeps the starting row while only other threads exist", () => {
    const startingThreads = [starting(APP, { threadId: "agt-new" })];
    render({
      groups: twoProjects([startedThread("agt-other", APP, { title: "Another thread" })]),
      startingThreads,
    });

    expect(startingRows()).toHaveLength(1);
    expect(titles(projectList("app") as HTMLElement)).toEqual([TITLE, "Another thread"]);
  });

  it.each([
    ["archived", { archived: true }],
    ["settled", { settledAt: NOW - 1_000 }],
    ["snoozed", { snoozedUntil: NOW + 60_000 }],
    ["pinned", { pinned: true }],
  ] as const)("retires the starting row when the real thread exists but is %s", (_, metadata) => {
    render({
      groups: twoProjects([startedThread("agt-new", APP, metadata)]),
      startingThreads: [starting(APP, { threadId: "agt-new" })],
    });

    expect(startingRows()).toEqual([]);
    expect(projectList("app")?.querySelector('[data-thread-id="agt-new"]') ?? null).toBeNull();
  });

  it("retires the starting row when the real thread sits in a collapsed project", () => {
    const groups = twoProjects([startedThread("agt-new", APP)]);
    const startingThreads = [starting(APP, { threadId: "agt-new" })];
    render({ groups, startingThreads });
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Collapse app"]')?.click());
    expect(threadRowIds()).toEqual([]);
    expect(startingRows()).toEqual([]);

    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Expand app"]')?.click());

    expect(startingRows()).toEqual([]);
    expect(threadRowIds()).toEqual(["agt-new"]);
  });

  it("retires the starting row when the real thread belongs to a project hidden by focus", () => {
    const groups = [group(APP, "app", []), group(API, "api", [startedThread("agt-new", API)])];
    const startingThreads = [starting(API, { threadId: "agt-new" })];
    render({ groups, projectFocus: "active", startingThreads });
    expect(projectList("api")).toBeNull();
    expect(startingRows()).toEqual([]);

    render({ groups, projectFocus: "all", startingThreads });

    expect(startingRows()).toEqual([]);
    expect(titles(projectList("api") as HTMLElement)).toEqual([TITLE]);
  });

  it("moves to the Working shelf without a second row when the Working section is on", () => {
    const preference = new BrowserAgentRailWorkingSectionPreference(memoryStorage("on"));
    const startingThreads = [starting(APP, { threadId: "agt-new" })];
    const renderWorking = (groups: ReadonlyArray<AgentProjectGroup>): void => {
      act(() => {
        root.render(
          <AgentClockProvider nowTickMs={1000}>
            <WorkingHarness
              {...sidebarProps({ groups, startingThreads })}
              preference={preference}
            />
          </AgentClockProvider>,
        );
      });
    };
    renderWorking(twoProjects());
    expect(startingRows(projectList("app") as HTMLElement)).toHaveLength(1);

    renderWorking(twoProjects([startedThread("agt-new", APP)]));

    expect(startingRows()).toEqual([]);
    expect(titles()).toEqual([]);
    expect(host.querySelector('.cv-sb-shelf[data-shelf="working"]')?.textContent).toContain(
      "Working (1)",
    );
    expect(emptyLabel("app")).toBe("1 thread in Working");
  });

  it("keeps the row in its project group while the Working section is on", () => {
    const preference = new BrowserAgentRailWorkingSectionPreference(memoryStorage("on"));
    act(() => {
      root.render(
        <AgentClockProvider nowTickMs={1000}>
          <WorkingHarness
            {...sidebarProps({ groups: twoProjects(), startingThreads: [starting(APP)] })}
            preference={preference}
          />
        </AgentClockProvider>,
      );
    });

    expect(startingRows(projectList("app") as HTMLElement)).toHaveLength(1);
    expect(host.querySelector('.cv-sb-shelf[data-shelf="working"]')).toBeNull();
    expect(emptyLabel("app")).toBeNull();
  });

  it("does not rerender the rail while the starting list keeps its reference", () => {
    let renders = 0;
    const search: AgentThreadSearchSurface = {
      ...SEARCH,
      get active() {
        renders += 1;
        return false;
      },
    };
    const props = sidebarProps({
      groups: twoProjects(),
      startingThreads: [starting(APP)],
      search,
    });
    renderProps(props);
    renders = 0;

    renderProps({ ...props });

    expect(renders).toBe(0);
    expect(startingRows()).toHaveLength(1);

    renderProps({ ...props, startingThreads: [starting(APP)] });

    expect(renders).toBeGreaterThan(0);
    expect(startingRows()).toHaveLength(1);
  });
});
