// @vitest-environment jsdom
import {
  saveRemoteProjectLink,
  removeRemoteProjectLink,
} from "../../application/remoteProjectLinks";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteRunnerGateway, RemoteRunnerTask } from "../../domain/remoteRunner";
import { remoteAgentThreadKey } from "../../application/remoteAgentProjection";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { waitForReact } from "../../test/reactTestLifecycle";
import { RemoteRunnerProvider } from "../remoteRunner/RemoteRunnerProvider";
import { AgentModeView } from "./AgentModeView";
import { surfaceThreadView, SURFACE_FIXTURE_ROOT } from "./agentSurfaceTestFixtures";
import { projectFixture, threadsSurfaceFixture } from "./agentThreadsSurfaceTestFixtures";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";

const launch = { provider: "codex", model: "gpt-5.6-sol", mode: "dangerFullAccess" } as const;
const remoteThreadId = remoteAgentThreadKey("linux", "runner", "first");
function task(overrides: Partial<RemoteRunnerTask> = {}): RemoteRunnerTask {
  return {
    id: "first",
    runnerId: "runner",
    sequence: 1,
    provider: "codex",
    launch,
    projectId: "project",
    status: "succeeded",
    parts: [{ type: "text", text: "First remote prompt" }],
    createdAt: "2026-09-13T00:00:00Z",
    ...overrides,
  };
}
function gatewayFixture() {
  const tasks = [task({ status: "running" })];
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
        pendingMessages: true,
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
    createTask: vi.fn(),
    startTask: vi.fn(),
    getTask: vi
      .fn()
      .mockImplementation(async ({ taskId }: { taskId: string }) =>
        tasks.find((entry) => entry.id === taskId),
      ),
    getTaskResume: vi.fn().mockResolvedValue({ available: true, reason: null }),
    continueTask: vi.fn(),
    listPendingMessages: vi.fn().mockResolvedValue({ items: [], paused: false }),
    cancelTask: vi.fn().mockImplementation(async () => {
      tasks[0] = { ...tasks[0]!, status: "cancelled" };
      return tasks[0];
    }),
    listEvents: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    getDiff: vi.fn().mockResolvedValue({ diff: "", truncated: false }),
    uploadAttachment: vi.fn(),
  } satisfies RemoteRunnerGateway;
  return gateway;
}

describe("Escape in an actual server conversation composer", () => {
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
    removeRemoteProjectLink("remote:linux:runner:project");
    vi.restoreAllMocks();
  });
  async function mount() {
    saveRemoteProjectLink("remote:linux:runner:project", SURFACE_FIXTURE_ROOT);
    const gateway = gatewayFixture();
    const local = threadsSurfaceFixture({
      threads: [surfaceThreadView()],
      stop: vi.fn(),
      sendFollowUp: vi.fn(),
      startThread: vi.fn(),
    });
    await act(async () =>
      root.render(
        <RemoteRunnerProvider gateway={gateway}>
          <AgentModeView
            agents={{ ...local, providerManagement: unconfiguredAgentProviderManagement() }}
            projects={[projectFixture()]}
            workspaceRoot={SURFACE_FIXTURE_ROOT}
            overflowRootPaths={[]}
            nowTickMs={3_600_000}
            providerEnabled={{ claudeCode: true, codex: true }}
            chrome={chromeFixture()}
            onTrustProject={() => undefined}
            onReleaseProject={() => undefined}
            onOpenEnvironmentSettings={() => undefined}
          />
        </RemoteRunnerProvider>,
      ),
    );
    act(() =>
      host.querySelector<HTMLButtonElement>('[aria-label="Run on: This computer"]')!.click(),
    );
    const serverOption = Array.from(
      host.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    ).find((entry) => entry.textContent?.includes("Linux server"))!;
    act(() => serverOption.click());
    await waitForReact(() =>
      expect(host.querySelector(`[data-thread-id="${remoteThreadId}"]`)).not.toBeNull(),
    );
    act(() => (host.querySelector(`[data-thread-id="${remoteThreadId}"]`) as HTMLElement).click());
    await waitForReact(() => expect(host.querySelector(".agent-composer__stop")).not.toBeNull());
    const textarea = host.querySelector<HTMLTextAreaElement>(".agent-composer textarea")!;
    act(() => textarea.focus());
    return { gateway, local, textarea };
  }
  function escape(textarea: HTMLTextAreaElement) {
    act(() =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      ),
    );
  }
  it("cancels the exact server task, keeps its thread, and never dispatches a local stop or follow-up", async () => {
    const { gateway, local, textarea } = await mount();
    escape(textarea);
    await waitForReact(() =>
      expect(gateway.cancelTask).toHaveBeenCalledExactlyOnceWith({
        serverId: "linux",
        taskId: "first",
      }),
    );
    await waitForReact(() => expect(host.querySelector(".agent-composer__stop")).toBeNull());
    expect(host.querySelector(`[data-thread-id="${remoteThreadId}"]`)).not.toBeNull();
    expect(host.querySelector(".agent-environment__locked")?.textContent).toBe("Linux server");
    expect(host.textContent).toContain("First remote prompt");
    expect(local.stop).not.toHaveBeenCalled();
    expect(local.sendFollowUp).not.toHaveBeenCalled();
    expect(local.startThread).not.toHaveBeenCalled();
    expect(gateway.continueTask).not.toHaveBeenCalled();
    expect(gateway.createTask).not.toHaveBeenCalled();
    escape(textarea);
    expect(gateway.cancelTask).toHaveBeenCalledTimes(1);
  });
  it("dismisses the slash-command menu before Escape can stop the running task", async () => {
    const { gateway, textarea } = await mount();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        textarea,
        "/",
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await waitForReact(() =>
      expect(document.querySelector('[aria-label="Composer commands"]')).not.toBeNull(),
    );
    escape(textarea);
    expect(document.querySelector('[aria-label="Composer commands"]')).toBeNull();
    expect(gateway.cancelTask).not.toHaveBeenCalled();
    escape(textarea);
    await waitForReact(() => expect(gateway.cancelTask).toHaveBeenCalledTimes(1));
  });
});
