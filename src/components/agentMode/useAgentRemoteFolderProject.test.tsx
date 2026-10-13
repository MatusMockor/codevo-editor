// @vitest-environment jsdom
import { act, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { remoteAgentProjectKey } from "../../application/remoteAgentProjection";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { RemoteProjectRegistration } from "../../domain/remoteProjectRegistration";
import type {
  RemoteRunnerGateway,
  RemoteRunnerRegisterProjectRequest,
} from "../../domain/remoteRunner";
import {
  RemoteRunnerContext,
  type RemoteRunnerContextValue,
} from "../remoteRunner/remoteRunnerContext";
import {
  useAgentRemoteFolderProject,
  type AgentRemoteFolderProject,
} from "./useAgentRemoteFolderProject";

const SELECTION = Object.freeze({});
const BILLING_PATH = "/srv/repos/billing";
const OTHER_PATH = "/srv/repos/other";
const REGISTERED: RemoteProjectRegistration = {
  status: "registered",
  project: { id: "billing", name: "billing" },
  created: true,
};

function descriptor(serverId: string): AgentProjectDescriptor {
  const rootKey = remoteAgentProjectKey(serverId, "runner", "billing");
  return {
    rootKey,
    rootPath: rootKey,
    label: "billing",
    ownerId: "owner",
    generation: 1,
    trust: "trusted",
    origin: "active-tab",
  } as AgentProjectDescriptor;
}

type Settlement = Readonly<{
  resolve(result: RemoteProjectRegistration): void;
  reject(error: unknown): void;
}>;

function gatewayFixture() {
  const pending: Settlement[] = [];
  const registerProject = vi.fn(
    (_request: RemoteRunnerRegisterProjectRequest) =>
      new Promise<RemoteProjectRegistration>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  );
  const gateway = {
    getRunner: async () => ({
      protocolVersion: 1,
      runnerId: "runner",
      name: "Runner",
      capabilities: { taskExecution: true, eventReplay: true, projectCloning: true },
    }),
    listProjectDirectories: async () => ({
      path: "/srv",
      parentPath: null,
      entries: [],
      truncated: false,
    }),
    registerProject,
  } as unknown as RemoteRunnerGateway;
  return { gateway, pending, registerProject };
}

describe("useAgentRemoteFolderProject under StrictMode", () => {
  let host: HTMLDivElement;
  let root: Root;
  let folder!: AgentRemoteFolderProject;
  let workspaceRoot: string | null;
  let fixture: ReturnType<typeof gatewayFixture>;
  let publish: (rows: readonly AgentProjectDescriptor[]) => void = () => undefined;
  let listed: readonly AgentProjectDescriptor[];
  const onProjectAdded = vi.fn<(project: AgentProjectDescriptor) => void>();
  const refreshProjects = vi.fn<() => Promise<void>>(async () => {
    await Promise.resolve();
    publish(listed);
  });

  function Harness({ workspace }: Readonly<{ workspace: string | null }>) {
    const [projects, setProjects] = useState<readonly AgentProjectDescriptor[]>([]);
    publish = setProjects;
    folder = useAgentRemoteFolderProject({
      projects,
      workspaceRoot: workspace,
      selectionIdentity: SELECTION,
      refreshProjects,
      onProjectAdded,
    });
    return null;
  }

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.clearAllMocks();
    workspaceRoot = "/a";
    fixture = gatewayFixture();
    listed = [descriptor("srv-a"), descriptor("srv-b")];
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function settled(): Promise<void> {
    await act(async () => {
      for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
    });
  }

  async function render(): Promise<void> {
    await act(async () =>
      root.render(
        <StrictMode>
          <RemoteRunnerContext.Provider
            value={{ gateway: fixture.gateway } as unknown as RemoteRunnerContextValue}
          >
            <Harness workspace={workspaceRoot} />
          </RemoteRunnerContext.Provider>
        </StrictMode>,
      ),
    );
    await settled();
  }

  async function run(action: (current: AgentRemoteFolderProject) => void): Promise<void> {
    await act(async () => action(folder));
    await settled();
  }

  async function submitFor(serverId: string, path: string): Promise<void> {
    await run((current) => current.openFor(serverId));
    expect(folder.folder).toEqual({ phase: "browsing", path: null });
    await run((current) => current.chooseFolder(path));
    await run((current) => current.submit());
  }

  async function settle(index: number, result: RemoteProjectRegistration): Promise<void> {
    expect(fixture.pending[index], `pending registration ${index}`).toBeDefined();
    await act(async () => fixture.pending[index]?.resolve(result));
    await settled();
  }

  it("registers once, selects once and closes", async () => {
    await render();
    expect(folder.open).toBe(false);
    await submitFor("srv-a", BILLING_PATH);
    expect(fixture.registerProject).toHaveBeenCalledExactlyOnceWith({
      serverId: "srv-a",
      path: BILLING_PATH,
      name: "billing",
    });
    await settle(0, REGISTERED);
    expect(refreshProjects).toHaveBeenCalledTimes(1);
    expect(onProjectAdded).toHaveBeenCalledExactlyOnceWith(descriptor("srv-a"));
    expect(folder.open).toBe(false);
  });

  it("drops a pending result across workspace A, B and A again, then submits cleanly", async () => {
    await render();
    await submitFor("srv-a", BILLING_PATH);
    expect(fixture.registerProject).toHaveBeenCalledTimes(1);

    workspaceRoot = "/b";
    await render();
    expect(folder.open).toBe(false);
    await run((current) => current.openFor("srv-b"));
    await run((current) => current.chooseFolder(OTHER_PATH));
    expect(folder.folder).toEqual({ phase: "ready", path: OTHER_PATH, name: "other" });

    workspaceRoot = "/a";
    await render();
    expect(folder.open).toBe(false);
    expect(folder.folder).toEqual({ phase: "browsing", path: null });

    await settle(0, REGISTERED);
    expect(refreshProjects).not.toHaveBeenCalled();
    expect(onProjectAdded).not.toHaveBeenCalled();
    expect(folder.open).toBe(false);

    await submitFor("srv-a", BILLING_PATH);
    expect(fixture.registerProject).toHaveBeenCalledTimes(2);
    expect(folder.folder).toMatchObject({ phase: "submitting", path: BILLING_PATH });
    await settle(1, { ...REGISTERED, created: false });
    expect(refreshProjects).toHaveBeenCalledTimes(1);
    expect(onProjectAdded).toHaveBeenCalledExactlyOnceWith(descriptor("srv-a"));
    expect(folder.open).toBe(false);
  });

  it("drops a pending result across server A, B and A again, then submits cleanly", async () => {
    await render();
    await submitFor("srv-a", BILLING_PATH);
    await submitFor("srv-b", OTHER_PATH);
    expect(fixture.registerProject).toHaveBeenLastCalledWith({
      serverId: "srv-b",
      path: OTHER_PATH,
      name: "other",
    });

    await settle(0, REGISTERED);
    expect(refreshProjects).not.toHaveBeenCalled();
    expect(onProjectAdded).not.toHaveBeenCalled();
    expect(folder.folder).toMatchObject({ phase: "submitting", path: OTHER_PATH });

    await submitFor("srv-a", BILLING_PATH);
    expect(fixture.registerProject).toHaveBeenCalledTimes(3);
    await settle(1, REGISTERED);
    expect(onProjectAdded).not.toHaveBeenCalled();
    expect(folder.folder).toMatchObject({ phase: "submitting", path: BILLING_PATH });

    await settle(2, REGISTERED);
    expect(onProjectAdded).toHaveBeenCalledExactlyOnceWith(descriptor("srv-a"));
    expect(folder.open).toBe(false);
  });

  it("closes when the runner gateway is replaced and drops its pending result", async () => {
    await render();
    await submitFor("srv-a", BILLING_PATH);
    const first = fixture;
    fixture = gatewayFixture();
    await render();
    expect(folder.open).toBe(false);
    await act(async () => first.pending[0]?.resolve(REGISTERED));
    await settled();
    expect(onProjectAdded).not.toHaveBeenCalled();

    await submitFor("srv-a", BILLING_PATH);
    expect(first.registerProject).toHaveBeenCalledTimes(1);
    expect(fixture.registerProject).toHaveBeenCalledTimes(1);
    await settle(0, REGISTERED);
    expect(onProjectAdded).toHaveBeenCalledExactlyOnceWith(descriptor("srv-a"));
  });
});
