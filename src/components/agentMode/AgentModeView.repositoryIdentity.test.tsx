// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { remoteAgentThreadKey } from "../../application/remoteAgentProjection";
import { MAX_REMOTE_REPOSITORY_IDENTITY_CONCURRENCY } from "../../application/remoteRepositoryIdentityCoordinator";
import type {
  RemoteRunnerGateway,
  RemoteRunnerServer,
  RemoteRunnerTask,
} from "../../domain/remoteRunner";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { deferred } from "../../test/repositoryIdentityTestSupport";
import { RemoteProjectLinksSettings } from "../remoteRunner/RemoteProjectLinksSettings";
import {
  RemoteRunnerContext,
  type RemoteRunnerContextValue,
} from "../remoteRunner/remoteRunnerContext";
import { SHARED_REMOTE_REPOSITORY_IDENTITY } from "../remoteRunner/sharedRemoteRepositoryIdentity";
import { AgentModeView } from "./AgentModeView";
import { projectFixture, threadsSurfaceFixture } from "./agentThreadsSurfaceTestFixtures";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";
import { NO_SCOPE_STATE, type AgentNavigationSession } from "./useAgentThreadNavigation";

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  invoke: tauri.invoke,
}));

const IDENTITY_COMMAND = "remote_runner_repository_identity";
const REPOSITORY = "github.com/acme/app";
const PROJECT_IDS = Array.from({ length: 5 }, (_, index) => `project${index}`);
const SELECTED_PROJECT = PROJECT_IDS[0]!;
const server: RemoteRunnerServer = {
  id: "server",
  name: "Linux",
  host: "linux",
  username: "user",
  port: 22,
  connected: true,
};
const task: RemoteRunnerTask = {
  id: "root",
  runnerId: "runner",
  sequence: 1,
  provider: "codex",
  launch: { provider: "codex", model: "default", mode: "default" },
  projectId: SELECTED_PROJECT,
  status: "succeeded",
  parts: [{ type: "text", text: "First prompt" }],
  createdAt: "2026-09-13T00:00:00Z",
};
const selectedThreadId = remoteAgentThreadKey(server.id, "runner", task.id);

function runnerGateway() {
  return {
    collectInstructions: vi.fn().mockResolvedValue({ version: 1, files: [] }),
    listServers: vi.fn(),
    connectServer: vi.fn(),
    disconnectServer: vi.fn(),
    removeServer: vi.fn(),
    getRunner: vi.fn().mockResolvedValue({
      protocolVersion: 1,
      runnerId: "runner",
      name: "Linux",
      capabilities: {
        taskExecution: true,
        instructionSync: true,
        eventReplay: true,
        taskContinuation: true,
        taskLaunchOptions: true,
        gitSync: true,
      },
    }),
    listProjects: vi
      .fn()
      .mockResolvedValue({ items: PROJECT_IDS.map((id) => ({ id, name: `App ${id}` })) }),
    cloneProject: vi.fn(),
    getProjectClone: vi.fn(),
    cancelProjectClone: vi.fn(),
    listTasks: vi.fn().mockImplementation(async ({ after }: { after: number }) => ({
      items: after === 0 ? [task] : [],
      nextCursor: null,
    })),
    createTask: vi.fn(),
    startTask: vi.fn(),
    getTask: vi.fn().mockResolvedValue(task),
    getTaskResume: vi.fn().mockResolvedValue({ available: true, reason: null }),
    continueTask: vi.fn(),
    cancelTask: vi.fn(),
    listEvents: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    getDiff: vi.fn(),
    uploadAttachment: vi.fn(),
  } satisfies RemoteRunnerGateway;
}

function identityBridge() {
  const held: ReturnType<typeof deferred<{ repositoryKey: string }>>[] = [];
  const sent: string[] = [];
  let active = 0;
  let peak = 0;
  const read = async (projectId: string) => {
    sent.push(projectId);
    active += 1;
    peak = Math.max(peak, active);
    const hold = deferred<{ repositoryKey: string }>();
    held.push(hold);
    try {
      return await hold.promise;
    } finally {
      active -= 1;
    }
  };
  tauri.invoke.mockImplementation((command: string, args?: { request?: { projectId?: string } }) =>
    command === IDENTITY_COMMAND
      ? read(args?.request?.projectId ?? "")
      : Promise.reject(new Error("unavailable")),
  );
  return {
    sent,
    peak: () => peak,
    pending: () => held.length,
    releaseAll: () => held.splice(0).forEach((hold) => hold.resolve({ repositoryKey: REPOSITORY })),
  };
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  tauri.invoke.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

async function flush() {
  await act(async () => {
    await new Promise((done) => setTimeout(done, 0));
  });
}

it("sends every remote identity lookup of the view, ship and settings through one coordinator", async () => {
  const bridge = identityBridge();
  const asked = vi.spyOn(SHARED_REMOTE_REPOSITORY_IDENTITY, "discover");
  const gateway = runnerGateway();
  const context: RemoteRunnerContextValue = {
    gateway,
    servers: [server],
    status: "ready",
    error: null,
    refresh: async () => undefined,
    connect: async () => null,
    disconnect: async () => undefined,
    remove: async () => undefined,
    selectedServerId: null,
    selectServer: () => undefined,
  };
  const session: AgentNavigationSession = {
    current: { selectedThreadId, selectedThreadOwnerKey: "pending", scopeState: NO_SCOPE_STATE },
  };
  const local = projectFixture();
  await act(async () => {
    root.render(
      <RemoteRunnerContext.Provider value={context}>
        <AgentModeView
          agents={{
            ...threadsSurfaceFixture(),
            providerManagement: unconfiguredAgentProviderManagement(),
          }}
          projects={[local]}
          workspaceRoot={local.rootKey}
          overflowRootPaths={[]}
          providerEnabled={{ claudeCode: true, codex: true }}
          chrome={chromeFixture()}
          navigationSession={session}
          onTrustProject={() => undefined}
          onReleaseProject={() => undefined}
        />
        <RemoteProjectLinksSettings
          gateway={gateway}
          serverId={server.id}
          connected
          projects={[local]}
        />
      </RemoteRunnerContext.Provider>,
    );
  });
  await act(async () => {
    const details = [...host.querySelectorAll("details")].find(
      (candidate) => candidate.querySelector("summary")?.textContent === "Project connections",
    )!;
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
  for (let round = 0; round < 12; round += 1) {
    await flush();
    expect(bridge.pending()).toBeLessThanOrEqual(MAX_REMOTE_REPOSITORY_IDENTITY_CONCURRENCY);
    await act(async () => bridge.releaseAll());
  }

  const askedFor = (projectId: string) =>
    asked.mock.calls.filter(([request]) => request.projectId === projectId).length;
  const unselected = PROJECT_IDS.slice(1).map(askedFor);
  expect(Math.min(...unselected)).toBeGreaterThanOrEqual(2);
  expect(askedFor(SELECTED_PROJECT)).toBeGreaterThan(Math.max(...unselected));
  expect([...bridge.sent].sort()).toEqual(PROJECT_IDS);
  expect(bridge.peak()).toBe(MAX_REMOTE_REPOSITORY_IDENTITY_CONCURRENCY);
  expect(host.textContent).not.toContain("Could not read this project's repository");
});
