// @vitest-environment jsdom
import { Profiler, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { remoteAgentThreadKey } from "../../application/remoteAgentProjection";
import {
  removeRemoteProjectLink,
  saveRemoteProjectLink,
} from "../../application/remoteProjectLinks";
import type {
  RemoteRunnerGateway,
  RemoteRunnerInventoryEvent,
  RemoteRunnerTask,
} from "../../domain/remoteRunner";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { RemoteRunnerProvider } from "../remoteRunner/RemoteRunnerProvider";
import { AgentModeView } from "./AgentModeView";
import { SURFACE_FIXTURE_ROOT, surfaceThreadView } from "./agentSurfaceTestFixtures";
import { projectFixture, threadsSurfaceFixture } from "./agentThreadsSurfaceTestFixtures";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";

const REMOTE_PROJECT = "remote:linux:runner:project";
const PROMPT = "New remote prompt";
const NEW_THREAD_ID = remoteAgentThreadKey("linux", "runner", "new");
const WAIT = { timeout: 4_000, interval: 25 } as const;

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function remoteGateway() {
  const tasks: RemoteRunnerTask[] = [];
  const listeners = new Set<(event: RemoteRunnerInventoryEvent) => void>();
  const created = deferred<{ task: RemoteRunnerTask; created: boolean }>();
  const started = deferred<RemoteRunnerTask>();
  const drafts: RemoteRunnerTask[] = [];
  const gateway = {
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
      capabilities: {
        taskExecution: true,
        instructionSync: true,
        eventReplay: true,
        taskContinuation: true,
        taskLaunchOptions: true,
      },
    }),
    listProjects: vi.fn().mockResolvedValue({ items: [{ id: "project", name: "Server app" }] }),
    cloneProject: vi.fn(),
    getProjectClone: vi.fn(),
    cancelProjectClone: vi.fn(),
    listTasks: vi.fn().mockImplementation(async ({ after }: { after: number }) => ({
      items: tasks.filter((entry) => entry.sequence > after),
      nextCursor: null,
    })),
    createTask: vi
      .fn()
      .mockImplementation(async (wire: Parameters<RemoteRunnerGateway["createTask"]>[0]) => {
        drafts.push({
          id: "new",
          runnerId: "runner",
          sequence: 1,
          provider: wire.provider,
          launch: wire.launch,
          status: "draft",
          parts: wire.parts,
          createdAt: "2026-09-13T00:00:00Z",
        });
        return created.promise;
      }),
    startTask: vi.fn().mockImplementation(async () => started.promise),
    getTask: vi
      .fn()
      .mockImplementation(async ({ taskId }: { taskId: string }) =>
        tasks.find((entry) => entry.id === taskId),
      ),
    getTaskResume: vi.fn().mockResolvedValue({ available: false, reason: "task_not_finished" }),
    continueTask: vi.fn(),
    cancelTask: vi.fn(),
    listEvents: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    getDiff: vi.fn().mockResolvedValue({ diff: "", truncated: false }),
    uploadAttachment: vi.fn(),
    watchInventory: vi
      .fn()
      .mockImplementation(
        async (_request: unknown, listener: (event: RemoteRunnerInventoryEvent) => void) => {
          listeners.add(listener);
          listener({ type: "connected" });
          return () => {
            listeners.delete(listener);
          };
        },
      ),
  } satisfies RemoteRunnerGateway;
  return {
    gateway,
    created,
    started,
    draft(): RemoteRunnerTask {
      const draft = drafts[0];
      expect(draft).toBeDefined();
      return draft as RemoteRunnerTask;
    },
    serverHolds(task: RemoteRunnerTask): void {
      const index = tasks.findIndex((entry) => entry.id === task.id);
      if (index === -1) {
        tasks.push(task);
        return;
      }
      tasks[index] = task;
    },
    announceChange(): void {
      for (const listener of listeners) listener({ type: "changed" });
    },
  };
}

describe("agent rail starting row for a server conversation", () => {
  let host: HTMLDivElement;
  let root: Root;
  let titleRowsPerCommit: number[];

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.clear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    titleRowsPerCommit = [];
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    removeRemoteProjectLink(REMOTE_PROJECT);
    localStorage.clear();
    vi.restoreAllMocks();
  });

  function click(element: Element | null | undefined): void {
    expect(element).not.toBeNull();
    expect(element).toBeDefined();
    act(() => element?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  }

  async function waitFor(assertion: () => void): Promise<void> {
    await vi.waitFor(async () => {
      await act(async () => Promise.resolve());
      assertion();
    }, WAIT);
  }

  async function settleInventory(): Promise<void> {
    for (let turn = 0; turn < 3; turn += 1) {
      await act(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });
    }
  }

  function titleRows(): ReadonlyArray<HTMLElement> {
    return [...host.querySelectorAll<HTMLElement>(".agent-rail .cv-card-row")].filter(
      (row) => row.querySelector(".cv-card-row__title")?.textContent === PROMPT,
    );
  }

  function startingRows(): ReadonlyArray<HTMLElement> {
    return [...host.querySelectorAll<HTMLElement>(".agent-rail [data-starting-thread]")];
  }

  function realRow(): HTMLElement | null {
    return host.querySelector<HTMLElement>(`.agent-rail [data-thread-id="${NEW_THREAD_ID}"]`);
  }

  async function sendFirstServerMessage(remote: ReturnType<typeof remoteGateway>): Promise<void> {
    saveRemoteProjectLink(REMOTE_PROJECT, SURFACE_FIXTURE_ROOT);
    const local = threadsSurfaceFixture({ threads: [surfaceThreadView()], agentCliKind: "codex" });
    await act(async () =>
      root.render(
        <RemoteRunnerProvider gateway={remote.gateway}>
          <Profiler id="agent-view" onRender={() => titleRowsPerCommit.push(titleRows().length)}>
            <AgentModeView
              agents={{
                ...local,
                providerManagement: {
                  ...unconfiguredAgentProviderManagement(),
                  admissionAuthority: (provider) => ({
                    provider,
                    revision: 0,
                    providerGeneration: 1,
                    disposition: { kind: "ready" },
                  }),
                },
              }}
              projects={[projectFixture()]}
              workspaceRoot={SURFACE_FIXTURE_ROOT}
              overflowRootPaths={[]}
              providerEnabled={{ claudeCode: true, codex: true }}
              chrome={chromeFixture()}
              onTrustProject={() => undefined}
              onReleaseProject={() => undefined}
              onOpenEnvironmentSettings={() => undefined}
            />
          </Profiler>
        </RemoteRunnerProvider>,
      ),
    );
    click(host.querySelector('[aria-label="Run on: This computer"]'));
    click(
      Array.from(document.querySelectorAll('[role="menuitemradio"]')).find((entry) =>
        entry.textContent?.includes("Linux server"),
      ),
    );
    await waitFor(() =>
      expect(host.querySelector('[aria-label="New thread in app"]')).not.toBeNull(),
    );
    const textarea = host.querySelector<HTMLTextAreaElement>(".agent-composer textarea");
    expect(textarea).not.toBeNull();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        textarea,
        PROMPT,
      );
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submit = host.querySelector<HTMLButtonElement>('.agent-composer button[type="submit"]');
    await waitFor(() => expect(submit?.disabled).toBe(false));
    click(submit);
    await waitFor(() => expect(remote.gateway.createTask).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(startingRows()).toHaveLength(1));
  }

  it("shows exactly one row while the inventory surfaces the task before each start response", async () => {
    const remote = remoteGateway();
    await sendFirstServerMessage(remote);
    expect(titleRows()).toEqual(startingRows());
    expect(
      startingRows()[0]?.querySelector(".cv-card-row__runtime")?.getAttribute("aria-label"),
    ).toBe("Codex, on Linux server");
    titleRowsPerCommit = [];

    const draft = remote.draft();
    const polls = remote.gateway.getTask.mock.calls.length;
    remote.serverHolds(draft);
    remote.announceChange();
    await waitFor(() => expect(remote.gateway.getTask.mock.calls.length).toBeGreaterThan(polls));
    await settleInventory();

    expect(remote.gateway.startTask).not.toHaveBeenCalled();
    expect(titleRows()).toEqual(startingRows());
    expect(titleRows()).toHaveLength(1);
    expect(realRow()).toBeNull();

    await act(async () => {
      remote.created.resolve({ task: draft, created: true });
      await remote.created.promise;
    });
    await waitFor(() => expect(remote.gateway.startTask).toHaveBeenCalledTimes(1));

    expect(titleRows()).toEqual(startingRows());
    expect(titleRows()).toHaveLength(1);

    const queued: RemoteRunnerTask = { ...draft, projectId: "project", status: "queued" };
    remote.serverHolds(queued);
    remote.announceChange();
    await waitFor(() => expect(realRow()).not.toBeNull());

    expect(startingRows()).toEqual([]);
    expect(titleRows()).toEqual([realRow()]);
    expect(host.querySelector('[data-pending-send="sending"]')).not.toBeNull();

    await act(async () => {
      remote.started.resolve(queued);
      await remote.started.promise;
    });
    await waitFor(() =>
      expect(
        host.querySelector(`section[aria-label="Agent thread ${NEW_THREAD_ID}"]`),
      ).not.toBeNull(),
    );

    expect(startingRows()).toEqual([]);
    expect(titleRows()).toEqual([realRow()]);
    expect(host.querySelector("[data-pending-send]")).toBeNull();
    expect(titleRowsPerCommit.length).toBeGreaterThan(0);
    expect(new Set(titleRowsPerCommit)).toEqual(new Set([1]));
  });

  it("swaps to the published row when only the start response delivers the task", async () => {
    const remote = remoteGateway();
    await sendFirstServerMessage(remote);
    titleRowsPerCommit = [];
    const draft = remote.draft();
    const queued: RemoteRunnerTask = { ...draft, projectId: "project", status: "queued" };

    await act(async () => {
      remote.created.resolve({ task: draft, created: true });
      await remote.created.promise;
    });
    await waitFor(() => expect(remote.gateway.startTask).toHaveBeenCalledTimes(1));
    expect(titleRows()).toEqual(startingRows());

    remote.serverHolds(queued);
    await act(async () => {
      remote.started.resolve(queued);
      await remote.started.promise;
    });
    await waitFor(() => expect(realRow()).not.toBeNull());

    expect(startingRows()).toEqual([]);
    expect(titleRows()).toEqual([realRow()]);
    expect(new Set(titleRowsPerCommit)).toEqual(new Set([1]));
  });
});
