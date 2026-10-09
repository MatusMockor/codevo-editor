// @vitest-environment jsdom
import { REMOTE_RUNNER_REACHABLE } from "../../domain/remoteRunnerReachability";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentThreadSearchSurface,
  AgentThreadView,
  RemoteAgentThreadExecution,
} from "../../application/agentThreadPorts";
import type { AgentPendingInteraction } from "../../domain/agentPendingInteraction";
import type { AgentRailWorkingSection } from "../../domain/agentRailWorkingSection";
import type { AgentThread, AgentTurn, AgentTurnStatus } from "../../domain/agentThread";
import {
  AGENT_RAIL_WORKING_SECTION_STORAGE_KEY,
  BrowserAgentRailWorkingSectionPreference,
} from "../../infrastructure/browserAgentRailWorkingSectionPreference";
import type { KeyValueStorage } from "../../infrastructure/browserSettingsGateway";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { AgentClockProvider } from "./agentClock";
import type { AgentProjectGroup } from "./agentModePresentation";
import {
  THREAD_JUMP_HINT_SHOW_DELAY_MS,
  agentRailScopeEntries,
  type AgentThreadMenuCommand,
} from "./agentSidebarPresentation";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import { AgentThreadsSidebar, type AgentThreadsSidebarProps } from "./AgentThreadsSidebar";
import { useAgentRailProjectDisclosure } from "./useAgentRailProjectDisclosure";
import type { AgentRailWorkingSplit } from "./agentRailWorkingSection";
import { useAgentRailWorkingRail } from "./useAgentRailWorkingRail";

const APP = "/workspace/app";
const API = "/workspace/api";
const NOW = 1_700_000_600_000;
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

interface DragOutcome {
  readonly accepted: boolean;
  readonly dropEffect: string;
}

interface RecordedCommand {
  readonly threadId: string;
  readonly command: AgentThreadMenuCommand;
}

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

function turn(status: AgentTurnStatus, startedAtEpochMs: number): AgentTurn {
  const live = status.kind === "running" || status.kind === "pending";
  return {
    turnId: `turn-${startedAtEpochMs}`,
    prompt: "Continue",
    status,
    startedAtEpochMs,
    endedAtEpochMs: live ? null : startedAtEpochMs + 1,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
}

function idle(
  threadId: string,
  metadata: Partial<AgentThread> = {},
  rootKey: string = APP,
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

function busy(
  threadId: string,
  startedAtEpochMs: number,
  metadata: Partial<AgentThread> = {},
  rootKey: string = APP,
): AgentThreadView {
  const view = idle(
    threadId,
    { turns: [turn({ kind: "running" }, startedAtEpochMs)], ...metadata },
    rootKey,
  );
  return { ...view, lifecycle: "running" };
}

function ended(threadId: string, status: AgentTurnStatus): AgentThreadView {
  return idle(threadId, { turns: [turn(status, NOW - 120_000)], viewedAtEpochMs: null });
}

function remote(view: AgentThreadView): AgentThreadView {
  const execution: RemoteAgentThreadExecution = {
    kind: "remote",
    serverId: "srv-1",
    runnerId: "runner-1",
    projectId: "project-1",
    conversationId: `conversation-${view.thread.threadId}`,
    latestTaskId: `task-${view.thread.threadId}`,
    resume: null,
    reachability: REMOTE_RUNNER_REACHABLE,
  };
  return { ...view, execution };
}

function group(
  repositoryRoot: string,
  label: string,
  threads: ReadonlyArray<AgentThreadView>,
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

function sidebarProps(
  overrides: SidebarOverrides,
): Omit<AgentThreadsSidebarProps, "projectDisclosure" | "workingRail"> {
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

let latestSplit: AgentRailWorkingSplit | null = null;

function WorkingHarness({
  preference,
  ...props
}: Omit<AgentThreadsSidebarProps, "projectDisclosure" | "workingRail"> & {
  readonly preference: BrowserAgentRailWorkingSectionPreference;
}) {
  const projectDisclosure = useAgentRailProjectDisclosure(null);
  const working = useAgentRailWorkingRail(preference);
  latestSplit = working.latestSplit;
  return (
    <AgentThreadsSidebar
      {...props}
      projectDisclosure={projectDisclosure}
      workingRail={working.rail}
    />
  );
}

function TodayHarness(props: Omit<AgentThreadsSidebarProps, "projectDisclosure" | "workingRail">) {
  const projectDisclosure = useAgentRailProjectDisclosure(null);
  return <AgentThreadsSidebar {...props} projectDisclosure={projectDisclosure} />;
}

describe("AgentThreadsSidebar Working section", () => {
  let host: HTMLDivElement;
  let root: Root;
  let preference: BrowserAgentRailWorkingSectionPreference;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers({
      toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"],
    });
    vi.setSystemTime(NOW);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    preference = new BrowserAgentRailWorkingSectionPreference(memoryStorage("on"));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  function render(overrides: SidebarOverrides): void {
    act(() => {
      root.render(
        <AgentClockProvider nowTickMs={1000}>
          <WorkingHarness {...sidebarProps(overrides)} preference={preference} />
        </AgentClockProvider>,
      );
    });
  }

  function renderToday(overrides: SidebarOverrides): void {
    act(() => {
      root.render(
        <AgentClockProvider nowTickMs={1000}>
          <TodayHarness {...sidebarProps(overrides)} />
        </AgentClockProvider>,
      );
    });
  }

  function listMarkup(): string {
    const list = host.querySelector(".agent-list");
    expect(list).not.toBeNull();
    return list?.outerHTML ?? "";
  }

  function rowIds(): ReadonlyArray<string> {
    return [...host.querySelectorAll<HTMLElement>("[data-thread-id]")].map(
      (element) => element.dataset.threadId ?? "",
    );
  }

  function row(threadId: string): HTMLElement {
    const element = host.querySelector<HTMLElement>(`[data-thread-id="${threadId}"]`);
    expect(element).not.toBeNull();
    return element as HTMLElement;
  }

  function projectRowIds(label: string): ReadonlyArray<string> {
    const threads = host.querySelector(`[aria-label="${label} threads"]`);
    return [...(threads?.querySelectorAll<HTMLElement>("[data-thread-id]") ?? [])].map(
      (element) => element.dataset.threadId ?? "",
    );
  }

  function workingShelf(): HTMLButtonElement | null {
    return host.querySelector<HTMLButtonElement>('.cv-sb-shelf[data-shelf="working"]');
  }

  function switcherSignals(): ReadonlyArray<ReadonlyArray<string | null>> {
    const trigger = host.querySelector<HTMLButtonElement>(".cv-sb-switch");
    expect(trigger).not.toBeNull();
    act(() => trigger?.click());
    const options = document.querySelectorAll<HTMLElement>(
      '[role="dialog"][aria-label="Switch project"] [role="option"]',
    );
    const signals = [...options].flatMap((option) =>
      [...option.querySelectorAll<HTMLElement>(".cv-project-switch__signal")].map((dot) => [
        option.querySelector(".cv-project-switch__label")?.textContent ?? null,
        dot.getAttribute("data-tone"),
        dot.getAttribute("aria-label"),
      ]),
    );
    act(() => trigger?.click());
    return signals;
  }

  function toggleWorking(): void {
    const shelf = workingShelf();
    expect(shelf).not.toBeNull();
    act(() => shelf?.click());
  }

  function shelfOrder(): ReadonlyArray<string> {
    return [...host.querySelectorAll<HTMLElement>(".cv-sb-shelf")].map(
      (element) => element.dataset.shelf ?? "",
    );
  }

  function key(element: HTMLElement, keyName: string): void {
    act(() => {
      element.dispatchEvent(
        new KeyboardEvent("keydown", { key: keyName, bubbles: true, cancelable: true }),
      );
    });
  }

  function jumpLabels(): Readonly<Record<string, string | null>> {
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Control" }));
      vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS);
    });
    const labels = Object.fromEntries(
      [...host.querySelectorAll<HTMLElement>("[data-thread-id]")].map((element) => [
        element.dataset.threadId ?? "",
        element.querySelector(".cv-card-row__jump")?.textContent?.replace(/\D/g, "") ?? null,
      ]),
    );
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "Meta" }));
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "Control" }));
    });
    return labels;
  }

  function dragEvent(type: string, selector: string): DragOutcome {
    const element = host.querySelector(selector);
    expect(element).not.toBeNull();
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY: 0 });
    const dataTransfer = { setData: () => undefined, effectAllowed: "", dropEffect: "" };
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    act(() => {
      element?.dispatchEvent(event);
    });
    return { accepted: event.defaultPrevented, dropEffect: dataTransfer.dropEffect };
  }

  function dispatchDrag(type: string, selector: string): boolean {
    return dragEvent(type, selector).accepted;
  }

  function recorder(): {
    readonly commands: RecordedCommand[];
    readonly onThreadMenuCommand: AgentThreadsSidebarProps["onThreadMenuCommand"];
  } {
    const commands: RecordedCommand[] = [];
    return {
      commands,
      onThreadMenuCommand: (threadId, command) => {
        commands.push({ threadId, command });
      },
    };
  }

  const mixedThreads = (): ReadonlyArray<AgentThreadView> => [
    idle("app-idle", { sortOrder: 1 }),
    busy("app-busy", NOW - 30_000, { sortOrder: 2 }),
    busy("app-busier", NOW - 10_000, { sortOrder: 3 }),
    idle("app-pin", { pinned: true }),
    idle("app-snoozed", { snoozedUntil: NOW + 60_000 }),
    idle("app-settled", { settledAt: NOW - 1_000 }),
  ];

  it("renders exactly today's list while the preference is off", () => {
    const groups = [group(APP, "app", mixedThreads())];
    renderToday({ groups, selectedThreadId: "app-busy" });
    const today = listMarkup();
    const todayJumps = jumpLabels();
    act(() => root.unmount());
    root = createRoot(host);

    preference = new BrowserAgentRailWorkingSectionPreference(memoryStorage("off"));
    render({ groups, selectedThreadId: "app-busy" });

    expect(listMarkup()).toBe(today);
    expect(workingShelf()).toBeNull();
    expect(projectRowIds("app")).toEqual(["app-idle", "app-busy", "app-busier"]);
    expect(jumpLabels()).toEqual(todayJumps);
    expect(todayJumps).toEqual({
      "app-pin": "1",
      "app-idle": "2",
      "app-busy": "3",
      "app-busier": "4",
    });
  });

  it("moves working threads behind a counted Working shelf that starts collapsed", () => {
    render({ groups: [group(APP, "app", mixedThreads())] });

    const shelf = workingShelf();
    expect(shelf?.textContent).toContain("Working (2)");
    expect(shelf?.getAttribute("aria-expanded")).toBe("false");
    expect(projectRowIds("app")).toEqual(["app-idle"]);
    expect(rowIds()).toEqual(["app-pin", "app-idle"]);
    expect(shelfOrder()).toEqual(["working", "snoozed", "settled"]);
    const project = host.querySelector(".cv-sb-project");
    expect(
      (project?.compareDocumentPosition(shelf as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("expands to every working thread in manual order and collapses again", () => {
    render({ groups: [group(APP, "app", mixedThreads())] });

    toggleWorking();
    expect(workingShelf()?.getAttribute("aria-expanded")).toBe("true");
    expect(rowIds()).toEqual(["app-pin", "app-idle", "app-busy", "app-busier"]);
    expect(projectRowIds("app")).toEqual(["app-idle"]);
    expect(row("app-busy").classList.contains("is-grouped")).toBe(false);

    toggleWorking();
    expect(workingShelf()?.getAttribute("aria-expanded")).toBe("false");
    expect(rowIds()).toEqual(["app-pin", "app-idle"]);
  });

  it("keeps the selected working thread visible while the shelf is collapsed", () => {
    render({ groups: [group(APP, "app", mixedThreads())], selectedThreadId: "app-busy" });

    expect(workingShelf()?.getAttribute("aria-expanded")).toBe("false");
    expect(workingShelf()?.textContent).toContain("Working (2)");
    expect(rowIds()).toEqual(["app-pin", "app-idle", "app-busy"]);
    expect(row("app-busy").getAttribute("aria-current")).toBe("true");
    expect(projectRowIds("app")).toEqual(["app-idle"]);
  });

  it("shows no Working shelf while nothing is working", () => {
    render({ groups: [group(APP, "app", [idle("app-idle"), idle("app-pin", { pinned: true })])] });

    expect(workingShelf()).toBeNull();
    expect(shelfOrder()).toEqual(["settled"]);
  });

  it("never moves pinned, snoozed or settled threads even while they work", () => {
    render({
      groups: [
        group(APP, "app", [
          busy("pin-busy", NOW - 1_000, { pinned: true }),
          busy("snoozed-busy", NOW - 2_000, { snoozedUntil: NOW + 60_000 }),
          busy("settled-busy", NOW - 3_000, { settledAt: NOW - 500 }),
          idle("app-idle"),
        ]),
      ],
    });

    expect(workingShelf()).toBeNull();
    expect(rowIds()).toEqual(["pin-busy", "app-idle"]);
    expect(shelfOrder()).toEqual(["snoozed", "settled"]);
  });

  it("returns a thread to its project when it needs approval or an answer", () => {
    const groups = [group(APP, "app", mixedThreads())];
    render({ groups });
    expect(workingShelf()?.textContent).toContain("Working (2)");

    render({ groups, pendingInteractions: new Map([["app-busy", "approval"]]) });
    expect(workingShelf()?.textContent).toContain("Working (1)");
    expect(projectRowIds("app")).toEqual(["app-idle", "app-busy"]);

    render({
      groups,
      pendingInteractions: new Map<string, AgentPendingInteraction>([
        ["app-busy", "approval"],
        ["app-busier", "input"],
      ]),
    });
    expect(workingShelf()).toBeNull();
    expect(projectRowIds("app")).toEqual(["app-idle", "app-busy", "app-busier"]);

    render({ groups });
    expect(workingShelf()?.textContent).toContain("Working (2)");
    expect(projectRowIds("app")).toEqual(["app-idle"]);
  });

  it("returns a thread to its project when it finishes, fails or is stopped", () => {
    render({ groups: [group(APP, "app", [busy("a", NOW - 3_000), busy("b", NOW - 2_000)])] });
    expect(workingShelf()?.textContent).toContain("Working (2)");
    expect(projectRowIds("app")).toEqual([]);

    render({
      groups: [
        group(APP, "app", [
          ended("a", { kind: "exited", exitCode: 0 }),
          ended("b", { kind: "failed", message: "boom" }),
        ]),
      ],
    });
    expect(workingShelf()).toBeNull();
    expect([...projectRowIds("app")].sort()).toEqual(["a", "b"]);

    render({ groups: [group(APP, "app", [ended("a", { kind: "stopped" }), busy("b", NOW)])] });
    expect(workingShelf()?.textContent).toContain("Working (1)");
    expect(projectRowIds("app")).toEqual(["a"]);
  });

  it("treats remote threads like local ones", () => {
    const groups = [
      group(APP, "app", [
        remote(busy("remote-busy", NOW - 5_000, { sortOrder: 1 })),
        remote(idle("remote-idle", { sortOrder: 2 })),
      ]),
    ];
    render({ groups });
    expect(workingShelf()?.textContent).toContain("Working (1)");
    expect(projectRowIds("app")).toEqual(["remote-idle"]);

    toggleWorking();
    expect(rowIds()).toEqual(["remote-idle", "remote-busy"]);

    render({ groups, pendingInteractions: new Map([["remote-busy", "input"]]) });
    expect(workingShelf()).toBeNull();
    expect(projectRowIds("app")).toEqual(["remote-busy", "remote-idle"]);
  });

  it("tells a project whose only threads are working where they went", () => {
    render({
      groups: [
        group(APP, "app", [busy("app-busy", NOW - 1_000)]),
        group(API, "api", [idle("api-idle", {}, API)]),
      ],
    });

    const app = host.querySelector(`[data-project-root-key="${APP}"]`);
    expect(app?.querySelector(".cv-sb-project__empty")?.textContent).toBe("1 thread in Working");
    expect(workingShelf()?.textContent).toContain("Working (1)");

    act(() => app?.querySelector<HTMLButtonElement>(".cv-sb-project__toggle")?.click());
    const signal = host.querySelector(`[data-project-root-key="${APP}"] .cv-sb-project__signal`);
    expect(signal?.getAttribute("aria-label")).toBe("1 thread working");
    expect(signal?.getAttribute("data-tone")).toBe("working");
  });

  it("signals every project in the switcher whatever the rail focus and the Working preference", () => {
    const overrides: SidebarOverrides = {
      groups: [
        group(APP, "app", [busy("app-pin", NOW - 3_000, { pinned: true }), idle("app-idle")]),
        group(API, "api", [
          busy("api-asks", NOW - 2_000, {}, API),
          busy("api-busy", NOW - 1_000, {}, API),
        ]),
      ],
      projectFocus: "active",
      pendingInteractions: new Map([["api-asks", "approval"]]),
    };
    const expected = [
      ["app", "working", "1 thread working"],
      ["api", "attention", "1 thread waiting for you"],
    ];

    render(overrides);
    expect(host.querySelector(`[data-project-root-key="${API}"]`)).toBeNull();
    expect(workingShelf()).toBeNull();
    expect(switcherSignals()).toEqual(expected);

    renderToday(overrides);
    expect(host.querySelector(`[data-project-root-key="${API}"]`)).toBeNull();
    expect(switcherSignals()).toEqual(expected);

    renderToday({ ...overrides, pendingInteractions: NO_PENDING });
    expect(switcherSignals()).toEqual([
      ["app", "working", "1 thread working"],
      ["api", "working", "2 threads working"],
    ]);
  });

  it("gathers working threads from every project into one shelf", () => {
    render({
      groups: [
        group(APP, "app", [busy("app-busy", NOW - 2_000), idle("app-idle")]),
        group(API, "api", [busy("api-busy", NOW - 1_000, {}, API), idle("api-idle", {}, API)]),
      ],
    });
    toggleWorking();

    expect(workingShelf()?.textContent).toContain("Working (2)");
    expect(rowIds()).toEqual(["app-idle", "api-idle", "api-busy", "app-busy"]);
  });

  it("walks the keyboard through working rows only while they are visible", () => {
    render({ groups: [group(APP, "app", mixedThreads())] });
    act(() => row("app-pin").focus());
    key(row("app-pin"), "End");
    expect(document.activeElement).toBe(row("app-idle"));

    toggleWorking();
    act(() => row("app-pin").focus());
    key(row("app-pin"), "End");
    expect(document.activeElement).toBe(row("app-busier"));
    key(row("app-busier"), "ArrowUp");
    expect(document.activeElement).toBe(row("app-busy"));
    key(row("app-busy"), "ArrowUp");
    expect(document.activeElement).toBe(row("app-idle"));
  });

  it("numbers jump slots in rendered order with working rows after the project rows", () => {
    render({ groups: [group(APP, "app", mixedThreads())] });
    expect(jumpLabels()).toEqual({ "app-pin": "1", "app-idle": "2" });

    toggleWorking();
    expect(jumpLabels()).toEqual({
      "app-pin": "1",
      "app-idle": "2",
      "app-busy": "3",
      "app-busier": "4",
    });

    render({
      groups: [
        group(
          APP,
          "app",
          mixedThreads().map((view) =>
            view.thread.threadId === "app-busy" ? busy("app-busy", NOW, { sortOrder: 2 }) : view,
          ),
        ),
      ],
    });
    expect(jumpLabels()).toEqual({
      "app-pin": "1",
      "app-idle": "2",
      "app-busy": "3",
      "app-busier": "4",
    });

    toggleWorking();
    render({ groups: [group(APP, "app", mixedThreads())], selectedThreadId: "app-busy" });
    expect(jumpLabels()).toEqual({ "app-pin": "1", "app-idle": "2", "app-busy": "3" });
  });

  it("never accepts a drop on the Working shelf or on a working row", () => {
    const recorded = recorder();
    render({
      groups: [group(APP, "app", mixedThreads())],
      onThreadMenuCommand: recorded.onThreadMenuCommand,
    });
    toggleWorking();

    const shelfSlot = workingShelf()?.closest(".cv-sb-shelf-slot");
    expect(shelfSlot?.hasAttribute("data-thread-drop-section")).toBe(false);

    for (const source of ["app-idle", "app-pin", "app-busier"]) {
      dispatchDrag("dragstart", `[data-thread-id="${source}"]`);
      expect(dispatchDrag("dragover", '[data-thread-id="app-busy"]')).toBe(false);
      expect(row("app-busy").hasAttribute("data-drop-placement")).toBe(false);
      dispatchDrag("drop", '[data-thread-id="app-busy"]');
      dispatchDrag("dragstart", `[data-thread-id="${source}"]`);
      expect(dispatchDrag("dragover", '.cv-sb-shelf[data-shelf="working"]')).toBe(false);
      dispatchDrag("drop", '.cv-sb-shelf[data-shelf="working"]');
    }

    expect(recorded.commands).toEqual([]);
  });

  it("lets a working row be dragged out to Pinned but not reordered or settled", () => {
    const recorded = recorder();
    render({
      groups: [group(APP, "app", mixedThreads())],
      onThreadMenuCommand: recorded.onThreadMenuCommand,
    });
    toggleWorking();
    expect(row("app-busy").getAttribute("draggable")).toBe("true");

    for (const refused of [
      '[data-thread-id="app-idle"]',
      '[data-thread-drop-section="active"]',
      '[data-thread-drop-section="settled"]',
      '[data-thread-id="app-busier"]',
    ]) {
      dispatchDrag("dragstart", '[data-thread-id="app-busy"]');
      expect(dragEvent("dragover", refused)).toEqual({ accepted: false, dropEffect: "none" });
      dispatchDrag("drop", refused);
    }
    expect(recorded.commands).toEqual([]);

    dispatchDrag("dragstart", '[data-thread-id="app-busy"]');
    expect(dragEvent("dragover", '[data-thread-drop-section="pinned"]')).toEqual({
      accepted: true,
      dropEffect: "move",
    });
    dispatchDrag("dragend", '[data-thread-id="app-busy"]');

    dispatchDrag("dragstart", '[data-thread-id="app-idle"]');
    expect(dragEvent("dragover", '[data-thread-id="app-busy"]')).toEqual({
      accepted: false,
      dropEffect: "",
    });
    dispatchDrag("dragend", '[data-thread-id="app-idle"]');

    dispatchDrag("dragstart", '[data-thread-id="app-busy"]');
    dispatchDrag("drop", '[data-thread-id="app-pin"]');
    dispatchDrag("dragstart", '[data-thread-id="app-busy"]');
    dispatchDrag("drop", '[data-thread-drop-section="pinned"]');
    expect(recorded.commands).toEqual([
      {
        threadId: "app-busy",
        command: { kind: "moveBefore", targetThreadId: "app-pin", destination: "pinned" },
      },
      {
        threadId: "app-busy",
        command: { kind: "moveAfter", targetThreadId: "app-pin", destination: "pinned" },
      },
    ]);
  });

  it("keeps dragging between Pinned and the project list as it is today", () => {
    const recorded = recorder();
    render({
      groups: [
        group(APP, "app", [
          idle("one", { sortOrder: 1 }),
          idle("two", { sortOrder: 2 }),
          busy("busy", NOW - 1_000, { sortOrder: 3 }),
          idle("pin", { pinned: true }),
        ]),
      ],
      onThreadMenuCommand: recorded.onThreadMenuCommand,
    });

    dispatchDrag("dragstart", '[data-thread-id="two"]');
    dispatchDrag("drop", '[data-thread-id="one"]');
    dispatchDrag("dragstart", '[data-thread-id="pin"]');
    dispatchDrag("drop", '[data-thread-drop-section="active"]');

    expect(recorded.commands).toEqual([
      {
        threadId: "two",
        command: { kind: "moveBefore", targetThreadId: "one", destination: "active" },
      },
      {
        threadId: "pin",
        command: { kind: "moveAfter", targetThreadId: "two", destination: "active" },
      },
    ]);
  });

  it("hands keyboard commands the clock it organized its sections with", () => {
    render({
      groups: [group(APP, "app", [idle("app-idle"), idle("soon", { snoozedUntil: NOW + 1_000 })])],
    });
    expect(latestSplit?.now()).toBe(NOW);
    expect(rowIds()).toEqual(["app-idle"]);

    vi.setSystemTime(NOW + 500);
    expect(latestSplit?.now()).toBe(NOW);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(rowIds()).toEqual(["app-idle", "soon"]);
    expect(latestSplit?.now()).toBe(Date.now());

    const split = latestSplit;
    act(() => root.unmount());
    root = createRoot(host);
    vi.setSystemTime(NOW + 60_000);
    expect(split?.now()).toBe(NOW + 60_000);
  });

  it("offers no Move up or Move down between working rows", () => {
    render({ groups: [group(APP, "app", mixedThreads())] });
    toggleWorking();

    act(() => {
      row("app-busy").dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 4, clientY: 4 }),
      );
    });
    const labels = [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')].map(
      (item) => item.textContent ?? "",
    );

    expect(labels.some((label) => label.includes("Pin thread"))).toBe(true);
    expect(labels.some((label) => label.includes("Move up"))).toBe(false);
    expect(labels.some((label) => label.includes("Move down"))).toBe(false);
  });
});
