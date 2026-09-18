// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteRunnerSurfacesGateway } from "../../domain/remoteRunnerSurfaces";
import type { RemoteRunnerGateway, RemoteRunnerTask } from "../../domain/remoteRunner";
import {
  saveRemoteProjectLink,
  removeRemoteProjectLink,
} from "../../application/remoteProjectLinks";
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
  const tasks = [
    task(),
    task({
      id: "second",
      sequence: 2,
      conversationId: "first",
      parentTaskId: "first",
      parts: [{ type: "text", text: "Second remote prompt" }],
    }),
  ];
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
    createTask: vi.fn(),
    startTask: vi.fn(),
    getTask: vi
      .fn()
      .mockImplementation(async ({ taskId }: { taskId: string }) =>
        tasks.find((entry) => entry.id === taskId),
      ),
    getTaskResume: vi.fn().mockResolvedValue({ available: true, reason: null }),
    continueTask: vi.fn().mockImplementation(async () => {
      const next = task({
        id: "third",
        sequence: 3,
        conversationId: "first",
        parentTaskId: "second",
        parts: [{ type: "text", text: "Third remote prompt" }],
      });
      tasks.push(next);
      return { task: next, created: true };
    }),
    cancelTask: vi.fn(),
    listEvents: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    getDiff: vi.fn().mockResolvedValue({ diff: "", truncated: false }),
    uploadAttachment: vi.fn(),
  } satisfies RemoteRunnerGateway;
  return gateway;
}

describe("original agent workbench with remote execution", () => {
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
    vi.unstubAllGlobals();
  });

  it.each(["codex", "claude"] as const)(
    "requires an explicit server project then accepts %s clipboard images",
    async (provider) => {
      const gateway = gatewayFixture();
      gateway.listTasks.mockImplementation(async () => ({ items: [], nextCursor: null }));
      vi.stubGlobal(
        "URL",
        class extends URL {
          static createObjectURL = () => "blob:chooser";
          static revokeObjectURL = vi.fn();
        },
      );
      const imageSurface = {
        decode: vi.fn(async () => ({ width: 64, height: 64 })),
        encodeMime: vi.fn(async () => "image/jpeg" as const),
        encode: vi.fn(async () => new ArrayBuffer(16)),
        release: vi.fn(),
      };
      await act(async () =>
        root.render(
          <RemoteRunnerProvider gateway={gateway}>
            <AgentModeView
              imageSurface={imageSurface}
              agents={{
                ...threadsSurfaceFixture(),
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
          </RemoteRunnerProvider>,
        ),
      );
      if (provider === "claude") {
        click(host.querySelector("#agent-launch-model")!);
        click(host.querySelector('[role="dialog"] button[data-provider="claudeCode"]')!);
        click(host.querySelector('[role="option"][data-value="claude-opus-5"]')!);
      }
      click(host.querySelector('[aria-label="Run on: This computer"]')!);
      click(
        [...host.querySelectorAll('[role="menuitemradio"]')].find((entry) =>
          entry.textContent?.includes("Linux server"),
        )!,
      );
      await waitForReact(() =>
        expect(host.querySelector('[aria-label="Choose server project"] select')).not.toBeNull(),
      );
      expect(host.textContent).not.toContain("No Git repository");
      expect(host.querySelector<HTMLTextAreaElement>(".agent-composer textarea")?.disabled).toBe(
        true,
      );
      const select = host.querySelector<HTMLSelectElement>(
        '[aria-label="Choose server project"] select',
      )!;
      act(() => {
        select.value = "remote:linux:runner:project";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await waitForReact(() =>
        expect(host.querySelector<HTMLTextAreaElement>(".agent-composer textarea")?.disabled).toBe(
          false,
        ),
      );
      expect(host.querySelector('[aria-label="Choose server project"]')).toBeNull();
      const file = new File([new Uint8Array(16)], "clipboard.png", { type: "image/png" });
      Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(16) });
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: { files: [file], getData: () => "" },
      });
      act(() => host.querySelector(".agent-composer textarea")!.dispatchEvent(event));
      await waitForReact(() =>
        expect(host.querySelector('[data-agent-attachment-state="ready"]')).not.toBeNull(),
      );
      expect(gateway.uploadAttachment).not.toHaveBeenCalled();
      expect(gateway.createTask).not.toHaveBeenCalled();
    },
  );

  it("keeps explicit project navigation authoritative after a failed server turn", async () => {
    const gateway = gatewayFixture();
    gateway.listTasks.mockImplementation(async () => ({
      items: [task({ status: "failed" })],
      nextCursor: null,
    }));
    const selectWorkspace = vi.fn();
    act(() =>
      root.render(
        <RemoteRunnerProvider gateway={gateway}>
          <AgentModeView
            agents={{
              ...threadsSurfaceFixture(),
              providerManagement: unconfiguredAgentProviderManagement(),
            }}
            projects={[projectFixture()]}
            workspaceRoot={SURFACE_FIXTURE_ROOT}
            overflowRootPaths={[]}
            providerEnabled={{ claudeCode: true, codex: true }}
            chrome={chromeFixture({
              workspaceActivation: {
                select: selectWorkspace,
                state: { kind: "none", rootPath: null },
                retry: () => undefined,
              },
            })}
            onTrustProject={() => undefined}
            onReleaseProject={() => undefined}
            onOpenEnvironmentSettings={() => undefined}
          />
        </RemoteRunnerProvider>,
      ),
    );
    await waitForReact(() => expect(gateway.listProjects).toHaveBeenCalled());
    const chooseProject = (name: string) => {
      click(host.querySelector("button#agent-rail-scope")!);
      const row = [...host.querySelectorAll('#agent-rail-scope-list [role="menuitemradio"]')].find(
        (entry) => entry.textContent?.includes(name),
      );
      expect(row).toBeDefined();
      click(row!);
    };
    chooseProject("Server app");
    await waitForReact(() =>
      expect(host.querySelector('[aria-label="Run on: Linux server"]')).not.toBeNull(),
    );
    click(host.querySelector(`[data-thread-id="${remoteThreadId}"]`)!);
    await waitForReact(() => expect(host.textContent).toContain("First remote prompt"));
    chooseProject("app");
    await waitForReact(() =>
      expect(host.querySelector('[aria-label="Run on: This computer"]')).not.toBeNull(),
    );
    expect(host.querySelector("button#agent-rail-scope")?.textContent).toContain("app");
    expect(host.querySelector("button#agent-rail-scope")?.textContent).not.toContain("Server app");
    expect(selectWorkspace).toHaveBeenLastCalledWith(
      expect.objectContaining({ rootKey: SURFACE_FIXTURE_ROOT }),
    );
    chooseProject("Server app");
    await waitForReact(() =>
      expect(
        host.querySelector(`section[aria-label="Agent thread ${remoteThreadId}"]`),
      ).not.toBeNull(),
    );
    expect(host.querySelector("button#agent-rail-scope")?.textContent).toContain("Server app");
    expect(gateway.createTask).not.toHaveBeenCalled();
  });

  it("keeps linked local and remote threads together while switching launch targets and continuing exact conversations", async () => {
    saveRemoteProjectLink("remote:linux:runner:project", SURFACE_FIXTURE_ROOT);
    const gateway = gatewayFixture();
    const surfacesGateway = surfaceGatewayFixture();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = () => "blob:remote-composer-test";
        static revokeObjectURL = vi.fn();
      },
    );
    const imageSurface = {
      decode: vi.fn(async () => ({ width: 64, height: 64 })),
      encodeMime: vi.fn(async () => "image/jpeg" as const),
      encode: vi.fn(async () => new ArrayBuffer(16)),
      release: vi.fn(),
    };
    const startThread = vi.fn();
    const sendFollowUp = vi.fn();
    const revealPath = vi.fn();
    const selectWorkspace = vi.fn();
    const refreshShipStatus = vi.fn();
    const local = threadsSurfaceFixture({
      threads: [surfaceThreadView()],
      startThread,
      sendFollowUp,
      refreshShipStatus,
    });
    act(() =>
      root.render(
        <RemoteRunnerProvider gateway={gateway} surfacesGateway={surfacesGateway}>
          <AgentModeView
            imageSurface={imageSurface}
            agents={{ ...local, providerManagement: unconfiguredAgentProviderManagement() }}
            projects={[projectFixture()]}
            workspaceRoot={SURFACE_FIXTURE_ROOT}
            overflowRootPaths={[]}
            providerEnabled={{ claudeCode: true, codex: true }}
            chrome={chromeFixture({
              revealPath,
              workspaceActivation: {
                select: selectWorkspace,
                state: { kind: "none", rootPath: null },
                retry: () => undefined,
              },
            })}
            onTrustProject={() => undefined}
            onReleaseProject={() => undefined}
            onOpenEnvironmentSettings={() => undefined}
          />
        </RemoteRunnerProvider>,
      ),
    );
    const originalSidebar = host.querySelector('aside[aria-label="Agent threads"]');
    const originalComposer = host.querySelector(".agent-composer");
    expect(originalSidebar).not.toBeNull();
    expect(host.querySelector('[data-thread-id="agt-1"]')).not.toBeNull();
    click(host.querySelector('[aria-label="Run on: This computer"]')!);
    await waitForReact(() =>
      expect(host.querySelector('[role="menuitemradio"]')?.textContent).toContain("This computer"),
    );
    click(
      Array.from(host.querySelectorAll('[role="menuitemradio"]')).find((entry) =>
        entry.textContent?.includes("Linux server"),
      )!,
    );
    await waitForReact(() =>
      expect(host.querySelector(`[data-thread-id="${remoteThreadId}"]`)).not.toBeNull(),
    );
    await waitForReact(() =>
      expect(surfacesGateway.capabilities).toHaveBeenCalledWith({
        serverId: "linux",
        runnerId: "runner",
        projectId: "project",
      }),
    );
    expect(host.querySelectorAll(`[data-thread-id="${remoteThreadId}"]`)).toHaveLength(1);
    expect(host.querySelector('[data-thread-id="agt-1"]')).not.toBeNull();
    expect(host.querySelector("button#agent-rail-scope")?.textContent).toContain("app");
    expect(host.querySelector('[aria-label="Remote tasks"]')).toBeNull();
    const pasteImage = async () => {
      const file = new File([new Uint8Array(16)], "clipboard.png", { type: "image/png" });
      Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(16) });
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: { files: [file], getData: () => "" },
      });
      act(() => host.querySelector(".agent-composer textarea")!.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(true);
      await waitForReact(() =>
        expect(host.querySelector('[data-agent-attachment-state="ready"]')).not.toBeNull(),
      );
      expect(host.querySelector('[aria-label="Preview clipboard.png"]')).not.toBeNull();
      expect(gateway.uploadAttachment).not.toHaveBeenCalled();
      click(host.querySelector('[aria-label="Remove clipboard.png"]')!);
      await waitForReact(() =>
        expect(host.querySelector('[data-agent-attachment-state="ready"]')).toBeNull(),
      );
    };
    await pasteImage();
    selectWorkspace.mockClear();
    refreshShipStatus.mockClear();
    click(host.querySelector(`[data-thread-id="${remoteThreadId}"]`)!);
    await waitForReact(() => expect(host.querySelectorAll("[data-agent-turn]")).toHaveLength(2));
    expect(host.querySelector(".agent-composer")).toBe(originalComposer);
    expect(host.querySelector('aside[aria-label="Agent threads"]')).toBe(originalSidebar);
    expect(host.textContent).toContain("First remote prompt");
    expect(host.textContent).toContain("Second remote prompt");
    await waitForReact(() =>
      expect(surfacesGateway.capabilities).toHaveBeenCalledWith({
        serverId: "linux",
        runnerId: "runner",
        projectId: "project",
        taskId: "second",
      }),
    );
    expect(host.querySelector('[aria-label="Runs on server"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Local instruction source"]')).toBeNull();
    expect(host.querySelector(".agent-environment__locked")?.textContent).toBe("Linux server");
    await pasteImage();
    const textarea = host.querySelector<HTMLTextAreaElement>(".agent-composer textarea")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        textarea,
        "Third remote prompt",
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submit = host.querySelector<HTMLButtonElement>('.agent-composer button[type="submit"]')!;
    await waitForReact(() => expect(submit.disabled).toBe(false));
    click(submit);
    await waitForReact(() => expect(gateway.continueTask).toHaveBeenCalledTimes(1));
    expect(gateway.continueTask).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: "linux",
        taskId: "second",
        parts: [{ type: "text", text: "Third remote prompt" }],
        launch,
      }),
    );
    await waitForReact(() => expect(host.querySelectorAll("[data-agent-turn]")).toHaveLength(3));
    expect(host.querySelectorAll(`[data-thread-id="${remoteThreadId}"]`)).toHaveLength(1);
    expect(host.querySelector('[data-thread-id="agt-1"]')).not.toBeNull();
    expect(host.querySelector("button#agent-rail-scope")?.textContent).toContain("app");
    await waitForReact(() =>
      expect(surfacesGateway.capabilities).toHaveBeenLastCalledWith({
        serverId: "linux",
        runnerId: "runner",
        projectId: "project",
        taskId: "third",
      }),
    );
    expect(startThread).not.toHaveBeenCalled();
    expect(sendFollowUp).not.toHaveBeenCalled();
    expect(revealPath).not.toHaveBeenCalled();
    expect(refreshShipStatus).not.toHaveBeenCalled();
    expect(
      selectWorkspace.mock.calls.every(
        ([project]) => project === null || !project.rootKey.startsWith("remote:"),
      ),
    ).toBe(true);
    click(host.querySelector('[aria-label="New thread in app"]')!);
    click(host.querySelector('[aria-label="Run on: Linux server"]')!);
    click(
      Array.from(host.querySelectorAll('[role="menuitemradio"]')).find((entry) =>
        entry.textContent?.includes("This computer"),
      )!,
    );
    await waitForReact(() => expect(host.querySelector('[data-thread-id="agt-1"]')).not.toBeNull());
    expect(host.querySelector('aside[aria-label="Agent threads"]')).toBe(originalSidebar);
    expect(host.querySelector(".agent-composer")).toBe(originalComposer);
    expect(gateway.createTask).not.toHaveBeenCalled();
  });
  it.each(["codex", "claude"] as const)(
    "starts a %s server conversation through the linked project without replacing the sidebar",
    async (provider) => {
      saveRemoteProjectLink("remote:linux:runner:project", SURFACE_FIXTURE_ROOT);
      const gateway = gatewayFixture();
      const expectedLaunch =
        provider === "codex"
          ? launch
          : ({
              provider: "claudeCode",
              model: "claude-opus-5",
              mode: "bypassPermissions",
              effort: "high",
              context: "1m",
              fastMode: false,
              thinkingMode: false,
            } as const);
      const draft = task({
        provider,
        launch: expectedLaunch,
        id: "new",
        sequence: 3,
        status: "draft",
        projectId: undefined,
        parts: [{ type: "text", text: "New remote prompt" }],
      });
      const started = { ...draft, projectId: "project", status: "queued" as const };
      gateway.createTask.mockResolvedValue({ task: draft, created: true });
      gateway.startTask.mockResolvedValue(started);
      gateway.getTask.mockImplementation(async ({ taskId }: { taskId: string }) =>
        taskId === "new" ? started : task({ id: taskId }),
      );
      const startThread = vi.fn();
      const sendFollowUp = vi.fn();
      const revealPath = vi.fn();
      const local = threadsSurfaceFixture({
        threads: [surfaceThreadView()],
        agentCliKind: "codex",
        startThread,
        sendFollowUp,
      });
      await act(async () =>
        root.render(
          <RemoteRunnerProvider gateway={gateway}>
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
              chrome={chromeFixture({ revealPath })}
              onTrustProject={() => undefined}
              onReleaseProject={() => undefined}
              onOpenEnvironmentSettings={() => undefined}
            />
          </RemoteRunnerProvider>,
        ),
      );
      const sidebar = host.querySelector('aside[aria-label="Agent threads"]');
      const composer = host.querySelector(".agent-composer");
      if (provider === "claude") {
        click(host.querySelector("#agent-launch-model")!);
        click(host.querySelector('[role="dialog"] button[data-provider="claudeCode"]')!);
        click(host.querySelector('[role="option"][data-value="claude-opus-5"]')!);
        expect(host.querySelector<HTMLElement>("#agent-launch-model")?.dataset.value).toBe(
          "claude-opus-5",
        );
      }
      click(host.querySelector('[aria-label="Run on: This computer"]')!);
      click(
        Array.from(host.querySelectorAll('[role="menuitemradio"]')).find((entry) =>
          entry.textContent?.includes("Linux server"),
        )!,
      );
      await waitForReact(() =>
        expect(host.querySelector('[aria-label="New thread in app"]')).not.toBeNull(),
      );
      expect(host.textContent).toContain("What should we build in app?");
      const textarea = host.querySelector<HTMLTextAreaElement>(".agent-composer textarea")!;
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
          textarea,
          "New remote prompt",
        );
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const submit = host.querySelector<HTMLButtonElement>(
        '.agent-composer button[type="submit"]',
      )!;
      await waitForReact(() => expect(submit.disabled).toBe(false));
      click(submit);
      await waitForReact(() => expect(gateway.startTask).toHaveBeenCalledTimes(1));
      expect(gateway.createTask).toHaveBeenCalledExactlyOnceWith({
        serverId: "linux",
        idempotencyKey: expect.any(String),
        provider,
        launch: expectedLaunch,
        ...(provider === "claude" ? { instructions: { version: 1, files: [] } } : {}),
        parts: [{ type: "text", text: "New remote prompt" }],
      });
      expect(gateway.startTask).toHaveBeenCalledExactlyOnceWith({
        serverId: "linux",
        taskId: "new",
        projectId: "project",
      });
      const newThreadId = remoteAgentThreadKey("linux", "runner", "new");
      await waitForReact(() =>
        expect(
          host.querySelector(`section[aria-label="Agent thread ${newThreadId}"]`),
        ).not.toBeNull(),
      );
      expect(host.querySelectorAll(`[data-thread-id="${newThreadId}"]`)).toHaveLength(1);
      expect(host.querySelector('aside[aria-label="Agent threads"]')).toBe(sidebar);
      expect(host.querySelector(".agent-composer")).toBe(composer);
      expect(host.querySelector(".agent-environment__locked")?.textContent).toBe("Linux server");
      expect(startThread).not.toHaveBeenCalled();
      expect(sendFollowUp).not.toHaveBeenCalled();
      expect(revealPath).not.toHaveBeenCalled();
      expect(gateway.continueTask).not.toHaveBeenCalled();
    },
  );
  it("keeps an empty local composer unbound when connected server projects arrive", async () => {
    const gateway = gatewayFixture();
    const startThread = vi.fn();
    await act(async () =>
      root.render(
        <RemoteRunnerProvider gateway={gateway}>
          <AgentModeView
            agents={{
              ...threadsSurfaceFixture({ startThread }),
              providerManagement: unconfiguredAgentProviderManagement(),
            }}
            projects={[]}
            workspaceRoot={null}
            overflowRootPaths={[]}
            providerEnabled={{ claudeCode: true, codex: true }}
            chrome={chromeFixture()}
            onTrustProject={() => undefined}
            onReleaseProject={() => undefined}
            onOpenEnvironmentSettings={() => undefined}
          />
        </RemoteRunnerProvider>,
      ),
    );
    await waitForReact(() => expect(gateway.listProjects).toHaveBeenCalled());
    expect(host.querySelector('[aria-label="Run on: This computer"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="New thread in Server app"]')).toBeNull();
    expect(host.querySelector(".agent-composer")?.textContent).not.toContain(
      "Server threads run in an isolated worktree.",
    );
    const textarea = host.querySelector<HTMLTextAreaElement>(".agent-composer textarea")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        textarea,
        "Stay on this computer",
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(
      host.querySelector<HTMLButtonElement>('.agent-composer button[type="submit"]')?.disabled,
    ).toBe(true);
    expect(gateway.createTask).not.toHaveBeenCalled();
    expect(startThread).not.toHaveBeenCalled();
    click(host.querySelector('[aria-label="Run on: This computer"]')!);
    click(
      Array.from(host.querySelectorAll('[role="menuitemradio"]')).find((entry) =>
        entry.textContent?.includes("Linux server"),
      )!,
    );
    await waitForReact(() =>
      expect(host.querySelector('[aria-label="New thread in Server app"]')).not.toBeNull(),
    );
    expect(host.querySelector('[aria-label="Run on: Linux server"]')).not.toBeNull();
    expect(
      host.querySelector<HTMLButtonElement>('.agent-composer button[type="submit"]')?.disabled,
    ).toBe(false);
  });
});
function click(element: Element) {
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function surfaceGatewayFixture(): RemoteRunnerSurfacesGateway {
  return {
    capabilities: vi.fn().mockResolvedValue({ files: true, history: true, terminal: true }),
    listDirectory: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    history: vi.fn(),
    commitFiles: vi.fn(),
    commitDiff: vi.fn(),
    openTerminal: vi.fn(),
    pollTerminal: vi.fn(),
    writeTerminal: vi.fn(),
    resizeTerminal: vi.fn(),
    closeTerminal: vi.fn(),
  };
}
