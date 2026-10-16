// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentComposerDraftStore } from "../../application/agentComposerDrafts";
import {
  createAgentViewCommandBridge,
  type AgentViewCommandBridge,
} from "../../application/agentViewCommandBridge";
import type {
  RemoteRunnerCreateTaskRequest,
  RemoteRunnerGateway,
  RemoteRunnerTask,
} from "../../domain/remoteRunner";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { waitForReact } from "../../test/reactTestLifecycle";
import { RemoteRunnerProvider } from "../remoteRunner/RemoteRunnerProvider";
import { AgentModeView } from "./AgentModeView";
import {
  fixtureRepository,
  projectFixture,
  threadsSurfaceFixture,
} from "./agentThreadsSurfaceTestFixtures";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  invoke: tauri.invoke,
}));

const LOCAL_ROOT = "/Users/dev/Developer/playablemaker";
const PROMPT = "Rename the asset loader";

function runner() {
  let created: RemoteRunnerTask | null = null;
  const syncDeviceMcpServers = vi.fn().mockResolvedValue({
    version: 1,
    results: [{ name: "files", transport: "stdio", outcome: "added", hints: [] }],
    omitted: 0,
  });
  const createTask = vi.fn(async (request: RemoteRunnerCreateTaskRequest) => {
    created = {
      id: "new",
      runnerId: "runner",
      sequence: 1,
      provider: request.provider,
      launch: request.launch,
      ...(request.isolation ? { isolation: request.isolation } : {}),
      status: "draft",
      parts: request.parts,
      createdAt: "2026-10-16T00:00:00Z",
    };
    return { task: created, created: true };
  });
  const startTask = vi.fn(async () => ({
    ...created!,
    projectId: "playablemaker",
    status: "queued" as const,
  }));
  const gateway = {
    collectInstructions: vi.fn().mockResolvedValue({ version: 1, files: [] }),
    syncDeviceMcpServers,
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
        taskIsolation: true,
        folderProjects: true,
        mcpDeviceSync: true,
      },
    }),
    listProjects: vi.fn(async () => ({
      items: [
        { id: "codevo-editor", name: "codevo-editor" },
        { id: "playablemaker", name: "playablemaker", kind: "folder" },
      ],
    })),
    cloneProject: vi.fn(),
    getProjectClone: vi.fn(),
    cancelProjectClone: vi.fn(),
    listTasks: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    createTask,
    startTask,
    getTask: vi.fn(async () => ({ ...created!, projectId: "playablemaker", status: "queued" })),
    getTaskResume: vi.fn().mockResolvedValue({ available: true, reason: null }),
    continueTask: vi.fn(),
    cancelTask: vi.fn(),
    listEvents: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    getDiff: vi.fn().mockResolvedValue({ diff: "", truncated: false }),
    uploadAttachment: vi.fn(),
    getAttachment: vi.fn(),
    readAttachment: vi.fn(),
  } as unknown as RemoteRunnerGateway;
  return { gateway, syncDeviceMcpServers, createTask };
}

describe("MCP device sync from the agent workbench", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.clear();
    agentComposerDraftStore.reset();
    tauri.invoke.mockReset();
    tauri.invoke.mockImplementation(() => Promise.reject(new Error("unavailable")));
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    agentComposerDraftStore.reset();
    localStorage.clear();
  });

  async function mount(gateway: RemoteRunnerGateway): Promise<AgentViewCommandBridge> {
    const commands = createAgentViewCommandBridge();
    const local = projectFixture({
      rootKey: LOCAL_ROOT,
      rootPath: LOCAL_ROOT,
      ownerId: "agent-root:playablemaker",
      label: "playablemaker",
      repositoryDiscovery: "settled",
      repositories: [fixtureRepository(`${LOCAL_ROOT}/pa-ai-be`, "pa-ai-be")],
    });
    await act(async () =>
      root.render(
        <RemoteRunnerProvider gateway={gateway}>
          <AgentModeView
            agents={{
              ...threadsSurfaceFixture({ agentCliKind: "codex" }),
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
            projects={[local]}
            workspaceRoot={LOCAL_ROOT}
            overflowRootPaths={[]}
            providerEnabled={{ claudeCode: true, codex: true }}
            chrome={chromeFixture()}
            viewCommands={commands}
            onTrustProject={() => undefined}
            onReleaseProject={() => undefined}
            onOpenEnvironmentSettings={() => undefined}
          />
        </RemoteRunnerProvider>,
      ),
    );
    await waitForReact(() =>
      expect(host.querySelector('[aria-label="Run on: This computer"]')).not.toBeNull(),
    );
    await waitForReact(() =>
      expect(
        [...host.querySelectorAll(".agent-rail .cv-sb-project")].filter((row) =>
          row.textContent?.includes("playablemaker"),
        ),
      ).toHaveLength(1),
    );
    return commands;
  }

  function click(element: Element | null | undefined): void {
    expect(element ?? null).not.toBeNull();
    act(() => {
      element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  function typePrompt(text: string): void {
    const field = host.querySelector<HTMLTextAreaElement>(".agent-composer textarea");
    expect(field).not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    act(() => {
      setter?.call(field, text);
      field?.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("syncs the paired local folder's MCP servers before starting a Claude server thread", async () => {
    const server = runner();
    const commands = await mount(server.gateway);
    act(() => commands.run("agent.newThread"));
    click(host.querySelector("#agent-launch-model"));
    click(host.querySelector('[role="dialog"] button[data-provider="claudeCode"]'));
    click(host.querySelector('[role="option"][data-value="claude-opus-5"]'));
    click(host.querySelector('[aria-label="Run on: This computer"]'));
    click(
      [...document.querySelectorAll('[role="menuitemradio"]')].find((entry) =>
        entry.textContent?.includes("Linux server"),
      ),
    );
    await waitForReact(() =>
      expect(host.querySelector('[aria-label="Run on: Linux server"]')).not.toBeNull(),
    );
    typePrompt(PROMPT);
    const submit = host.querySelector<HTMLButtonElement>('.agent-composer button[type="submit"]');
    await waitForReact(() => expect(submit?.disabled).toBe(false));
    click(submit);

    await waitForReact(() => expect(server.createTask).toHaveBeenCalledOnce());
    expect(server.syncDeviceMcpServers).toHaveBeenCalledExactlyOnceWith({
      serverId: "linux",
      runnerId: "runner",
      projectId: "playablemaker",
      rootPath: LOCAL_ROOT,
      projectKind: "folder",
    });
    expect(server.syncDeviceMcpServers.mock.invocationCallOrder[0]).toBeLessThan(
      server.createTask.mock.invocationCallOrder[0]!,
    );
    expect(server.createTask.mock.calls[0]?.[0].provider).toBe("claude");
  });
});
