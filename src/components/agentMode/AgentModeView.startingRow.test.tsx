// @vitest-environment jsdom
import { Profiler, act, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveAgentProjectGroupingMode } from "../../application/agentProjectGroupingPreference";
import type {
  AgentThreadStartRequest,
  AgentThreadStartResult,
  AgentThreadView,
} from "../../application/agentThreadPorts";
import { workbenchAgentPaletteProvider } from "../../application/commandPalette/commandPaletteProvider";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { AgentTurn } from "../../domain/agentThread";
import { agentThreadAutoTitle } from "../../domain/agentThreadAutoTitle";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { AgentModeView, type AgentModeViewProps } from "./AgentModeView";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import {
  fixtureRepository,
  projectFixture,
  threadsSurfaceFixture,
} from "./agentThreadsSurfaceTestFixtures";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";

const APP = "/workspace/app";
const DOCS = "/workspace/docs";
const PROMPT = "Add a health check endpoint";
const TITLE = agentThreadAutoTitle(PROMPT);
const NEW_THREAD_ID = "agt-new";

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

interface PendingStart {
  readonly request: AgentThreadStartRequest;
  readonly settled: Deferred<AgentThreadStartResult | null>;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function project(rootKey: string, label: string, generation = 0): AgentProjectDescriptor {
  return projectFixture({
    rootKey,
    rootPath: rootKey,
    ownerId: `agent-root:${label}`,
    label,
    generation,
    repositories: [fixtureRepository(rootKey, "")],
  });
}

function runningTurn(): AgentTurn {
  return {
    turnId: "turn-new",
    prompt: PROMPT,
    status: { kind: "running" },
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

function threadIn(
  threadId: string,
  rootKey: string,
  label: string,
  title: string,
  turns: ReadonlyArray<AgentTurn> = [],
): AgentThreadView {
  const base = surfaceThreadView().thread;
  return surfaceThreadView({
    repositoryLabel: label,
    lifecycle: turns.length === 0 ? "settled" : "running",
    thread: {
      ...base,
      threadId,
      title,
      target: { isolation: "in-place", worktreePath: null },
      owner: { rootKey, ownerId: `agent-root:${label}`, repositoryRoot: rootKey },
      turns,
    },
  });
}

const PROJECTS: ReadonlyArray<AgentProjectDescriptor> = [
  project(APP, "app"),
  project(DOCS, "docs"),
];
const INITIAL_THREADS: ReadonlyArray<AgentThreadView> = [
  threadIn("a1", APP, "app", "Thread a1"),
  threadIn("d1", DOCS, "docs", "Thread d1"),
];
const REPOSITORIES = PROJECTS.map((entry) => fixtureRepository(entry.rootKey, ""));
const PROVIDER_MANAGEMENT = unconfiguredAgentProviderManagement();
const CHROME = chromeFixture();
const STATIC_PROPS: Omit<AgentModeViewProps, "agents" | "projects"> = {
  workspaceRoot: APP,
  overflowRootPaths: [],
  providerEnabled: { claudeCode: true, codex: true },
  chrome: CHROME,
  onTrustProject: () => undefined,
  onReleaseProject: () => undefined,
};

describe("agent rail starting row in the agent view", () => {
  let host: HTMLDivElement;
  let root: Root;
  let pending: PendingStart | null;
  let publishThreads: ((threads: ReadonlyArray<AgentThreadView>) => void) | null;
  let publishProjects: ((projects: ReadonlyArray<AgentProjectDescriptor>) => void) | null;
  let titleRowsPerCommit: number[];
  let identifyOnStart: boolean;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.clear();
    saveAgentProjectGroupingMode("separate");
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    pending = null;
    publishThreads = null;
    publishProjects = null;
    titleRowsPerCommit = [];
    identifyOnStart = true;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    localStorage.clear();
  });

  function startThread(request: AgentThreadStartRequest): Promise<AgentThreadStartResult | null> {
    const settled = deferred<AgentThreadStartResult | null>();
    pending = { request, settled };
    if (identifyOnStart) request.onThreadIdentified?.(NEW_THREAD_ID);
    return settled.promise;
  }

  function View() {
    const [threads, setThreads] = useState(INITIAL_THREADS);
    const [projects, setProjects] = useState(PROJECTS);
    publishThreads = setThreads;
    publishProjects = setProjects;
    const agents = useMemo(
      () => ({
        ...threadsSurfaceFixture({ startThread, threads, repositories: REPOSITORIES }),
        providerManagement: PROVIDER_MANAGEMENT,
      }),
      [threads],
    );
    return (
      <Profiler id="agent-view" onRender={() => titleRowsPerCommit.push(titleRows().length)}>
        <AgentModeView {...STATIC_PROPS} agents={agents} projects={projects} />
      </Profiler>
    );
  }

  function titleRows(): ReadonlyArray<HTMLElement> {
    return [...host.querySelectorAll<HTMLElement>(".agent-rail .cv-card-row")].filter(
      (row) => row.querySelector(".cv-card-row__title")?.textContent === TITLE,
    );
  }

  function projectGroup(rootKey: string): HTMLElement {
    const group = host.querySelector<HTMLElement>(
      `.agent-rail .cv-sb-project[data-project-root-key="${rootKey}"]`,
    );
    expect(group).not.toBeNull();
    return group as HTMLElement;
  }

  function startingRows(scope: ParentNode = host): ReadonlyArray<HTMLElement> {
    return [...scope.querySelectorAll<HTMLElement>(".agent-rail [data-starting-thread]")];
  }

  function threadRow(threadId: string): HTMLElement | null {
    return host.querySelector<HTMLElement>(`.agent-rail [data-thread-id="${threadId}"]`);
  }

  function pendingMessage(): HTMLElement | null {
    return host.querySelector<HTMLElement>("[data-pending-send]");
  }

  function openComposerIn(rootKey: string): void {
    let opened = false;
    act(() => {
      opened = workbenchAgentPaletteProvider.current()?.newThreadIn(rootKey) ?? false;
    });
    expect(opened).toBe(true);
  }

  async function submitPrompt(prompt: string): Promise<void> {
    const field = host.querySelector<HTMLTextAreaElement>("textarea#agent-prompt");
    expect(field).not.toBeNull();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        field,
        prompt,
      );
      field?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const form = host.querySelector("form");
    expect(form).not.toBeNull();
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
  }

  async function sendFirstMessageIn(rootKey: string): Promise<PendingStart> {
    act(() => root.render(<View />));
    openComposerIn(rootKey);
    await submitPrompt(PROMPT);
    expect(pending).not.toBeNull();
    return pending as PendingStart;
  }

  function registerThread(): void {
    act(() => {
      publishThreads?.([
        ...INITIAL_THREADS,
        threadIn(NEW_THREAD_ID, DOCS, "docs", TITLE, [runningTurn()]),
      ]);
    });
  }

  async function settleStart(
    start: PendingStart,
    result: AgentThreadStartResult | null,
  ): Promise<void> {
    await act(async () => {
      start.settled.resolve(result);
      await start.settled.promise;
    });
  }

  it("shows the starting row in its project while the start is still pending", async () => {
    const start = await sendFirstMessageIn(DOCS);

    expect(start.request.projectRootKey).toBe(DOCS);
    expect(pendingMessage()?.dataset.pendingSend).toBe("sending");
    const rows = startingRows(projectGroup(DOCS));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute("aria-busy")).toBe("true");
    expect(rows[0]?.getAttribute("aria-current")).toBe("true");
    expect(rows[0]?.getAttribute("aria-label")).toBe(`Starting thread: ${TITLE}`);
    expect(rows[0]?.querySelector(".cv-card-row__title")?.textContent).toBe(TITLE);
    expect(startingRows(projectGroup(APP))).toEqual([]);
    expect(startingRows()).toHaveLength(1);
    expect(titleRows()).toHaveLength(1);

    await settleStart(start, null);
  });

  it("swaps to the real thread row when the thread is registered, in a commit of its own", async () => {
    const start = await sendFirstMessageIn(DOCS);
    expect(titleRows()).toEqual(startingRows());
    expect(titleRows()).toHaveLength(1);
    titleRowsPerCommit = [];

    registerThread();

    expect(startingRows()).toEqual([]);
    expect(titleRows()).toEqual([threadRow(NEW_THREAD_ID)]);
    expect(projectGroup(DOCS).contains(threadRow(NEW_THREAD_ID))).toBe(true);
    expect(pendingMessage()?.dataset.pendingSend).toBe("sending");
    expect(titleRowsPerCommit.length).toBeGreaterThan(0);

    await settleStart(start, { threadId: NEW_THREAD_ID });

    expect(startingRows()).toEqual([]);
    expect(titleRows()).toEqual([threadRow(NEW_THREAD_ID)]);
    expect(threadRow(NEW_THREAD_ID)?.getAttribute("aria-current")).toBe("true");
    expect(pendingMessage()).toBeNull();
    expect(new Set(titleRowsPerCommit)).toEqual(new Set([1]));
  });

  it("keeps the starting row when an unrelated thread appears during the start", async () => {
    const start = await sendFirstMessageIn(DOCS);

    act(() => {
      publishThreads?.([...INITIAL_THREADS, threadIn("agt-unrelated", DOCS, "docs", "Unrelated")]);
    });

    expect(startingRows(projectGroup(DOCS))).toHaveLength(1);
    expect(threadRow("agt-unrelated")).not.toBeNull();
    expect(titleRows()).toHaveLength(1);

    await settleStart(start, null);
  });

  it("removes the starting row when the start fails before a thread is registered", async () => {
    const start = await sendFirstMessageIn(DOCS);
    expect(startingRows()).toHaveLength(1);

    await settleStart(start, null);

    expect(startingRows()).toEqual([]);
    expect(titleRows()).toEqual([]);
    expect(threadRow(NEW_THREAD_ID)).toBeNull();
    expect(pendingMessage()?.dataset.pendingSend).toBe("failed");
  });

  it("keeps the starting row while another thread is selected during the start", async () => {
    const start = await sendFirstMessageIn(DOCS);
    titleRowsPerCommit = [];

    act(() => threadRow("a1")?.click());

    expect(threadRow("a1")?.getAttribute("aria-current")).toBe("true");
    const rows = startingRows(projectGroup(DOCS));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute("aria-current")).toBeNull();
    expect(startingRows(projectGroup(APP))).toEqual([]);
    expect(pendingMessage()).toBeNull();

    registerThread();

    expect(startingRows()).toEqual([]);
    expect(titleRows()).toEqual([threadRow(NEW_THREAD_ID)]);

    await settleStart(start, { threadId: NEW_THREAD_ID });

    expect(titleRows()).toEqual([threadRow(NEW_THREAD_ID)]);
    expect(threadRow("a1")?.getAttribute("aria-current")).toBe("true");
    expect(new Set(titleRowsPerCommit)).toEqual(new Set([1]));
  });

  it("shows no row under a project re-added with the same root key during the start", async () => {
    const start = await sendFirstMessageIn(DOCS);
    expect(startingRows(projectGroup(DOCS))).toHaveLength(1);

    act(() => publishProjects?.([project(APP, "app")]));

    expect(startingRows()).toEqual([]);
    expect(host.querySelector(`.cv-sb-project[data-project-root-key="${DOCS}"]`)).toBeNull();

    act(() => publishProjects?.([project(APP, "app"), project(DOCS, "docs", 1)]));

    expect(projectGroup(DOCS)).not.toBeNull();
    expect(startingRows()).toEqual([]);
    expect(titleRows()).toEqual([]);

    await settleStart(start, null);

    expect(startingRows()).toEqual([]);
  });

  it("keeps the row while the same project owner is published again unchanged", async () => {
    const start = await sendFirstMessageIn(DOCS);

    act(() => publishProjects?.([project(APP, "app"), project(DOCS, "docs")]));

    const rows = startingRows(projectGroup(DOCS));
    expect(rows).toHaveLength(1);
    expect(titleRows()).toEqual(rows);

    await settleStart(start, null);
  });

  it("drops the starting row at settle when the start reported no thread id", async () => {
    identifyOnStart = false;
    const start = await sendFirstMessageIn(DOCS);
    expect(startingRows()).toHaveLength(1);

    await act(async () => {
      publishThreads?.([
        ...INITIAL_THREADS,
        threadIn(NEW_THREAD_ID, DOCS, "docs", TITLE, [runningTurn()]),
      ]);
      start.settled.resolve({ threadId: NEW_THREAD_ID });
      await start.settled.promise;
    });

    expect(startingRows()).toEqual([]);
    expect(titleRows()).toEqual([threadRow(NEW_THREAD_ID)]);
  });

  it("ignores an identification reported after the start already settled", async () => {
    identifyOnStart = false;
    const start = await sendFirstMessageIn(DOCS);
    await settleStart(start, null);
    expect(pendingMessage()?.dataset.pendingSend).toBe("failed");

    act(() => start.request.onThreadIdentified?.(NEW_THREAD_ID));

    expect(startingRows()).toEqual([]);
    expect(pendingMessage()?.dataset.pendingSend).toBe("failed");
  });
});
