import { describe, expect, it } from "vitest";
import { AGENT_MCP_SERVER_MANAGEMENT_ERRORS } from "../domain/agentMcpServerManagement";
import {
  localAgentMcpServersTarget,
  serverAgentMcpServersTarget,
} from "../domain/agentMcpServersTarget";
import { TauriRemoteRunnerGateway } from "../infrastructure/tauriRemoteRunnerGateway";
import {
  DeferredAgentMcpServerManagementGateway,
  DeferredRemoteAgentMcpServerManagementGateway,
  ManualScheduler,
  RecordingUrlOpener,
  settleMicrotasks,
} from "../test/agentMcpServerManagementTestSupport";
import {
  DeferredAgentMcpServersGateway,
  DeferredRunnerTunnel,
  mcpRunnerFixture,
} from "../test/agentMcpServersTestSupport";
import { UNSUPPORTED_AGENT_MCP_SERVER_MANAGEMENT } from "./agentMcpServerManagementStore";
import {
  createAgentMcpServersSurface,
  type AgentMcpServersRemoteGateway,
} from "./agentMcpServersSurface";

const LINUX = { id: "linux", name: "Linux box", connection: {} };
const PROJECT = { serverId: "linux", runnerId: "runner-home", projectId: "codevo-editor" };

function present<T>(value: T | null): T {
  expect(value).not.toBeNull();
  return value as T;
}

const LOCAL = present(localAgentMcpServersTarget("/work/app", "claudeCode"));
const SERVER = present(serverAgentMcpServersTarget(PROJECT, "codex"));

function wiring() {
  const gateway = new DeferredAgentMcpServerManagementGateway();
  return { gateway, urlOpener: new RecordingUrlOpener(), scheduler: new ManualScheduler() };
}

function managingRemote(tunnel: DeferredRunnerTunnel) {
  const runner = new TauriRemoteRunnerGateway(tunnel.invoke);
  const management = new DeferredRemoteAgentMcpServerManagementGateway();
  const remote: AgentMcpServersRemoteGateway = {
    getRunner: (request) => runner.getRunner(request),
    listProjects: (request) => runner.listProjects(request),
    getMcpServers: (request) => runner.getMcpServers(request),
    changeMcpServer: (request) => management.changeMcpServer(request),
    startMcpServerLogin: (request) => management.startMcpServerLogin(request),
    getMcpServerLogin: (request) => management.getMcpServerLogin(request),
    submitMcpServerLoginCallback: (request) => management.submitMcpServerLoginCallback(request),
    cancelMcpServerLogin: (request) => management.cancelMcpServerLogin(request),
  };
  return { management, remote };
}

describe("createAgentMcpServersSurface management", () => {
  it("manages nothing until a management gateway is wired", () => {
    const surface = createAgentMcpServersSurface(new DeferredAgentMcpServersGateway());
    expect(surface.management).toBe(UNSUPPORTED_AGENT_MCP_SERVER_MANAGEMENT);
    expect(surface.management.support(LOCAL)).toBe("unsupported");
    expect(Object.isFrozen(surface)).toBe(true);
  });

  it("manages local projects through the wired gateway and refreshes their status", async () => {
    const checks = new DeferredAgentMcpServersGateway();
    const ports = wiring();
    const surface = createAgentMcpServersSurface(checks, null, ports);
    expect(surface.management.support(LOCAL)).toBe("supported");
    expect(surface.management.support(SERVER)).toBe("unsupported");

    expect(surface.management.change(LOCAL, { kind: "signOut", name: "linear" })).toBe("started");
    await settleMicrotasks();
    expect(ports.gateway.changes.requests()).toEqual([
      {
        repositoryRoot: "/work/app",
        provider: "claudeCode",
        change: { kind: "signOut", name: "linear" },
      },
    ]);
    ports.gateway.changes.latest()?.resolve();
    await settleMicrotasks();
    expect(checks.requests()).toEqual([{ repositoryRoot: "/work/app", provider: "claudeCode" }]);
    expect(surface.store.state(LOCAL).kind).toBe("loading");
  });

  it("manages a server project only once its runner advertises the capability", async () => {
    const tunnel = new DeferredRunnerTunnel();
    const { management, remote } = managingRemote(tunnel);
    const surface = createAgentMcpServersSurface(
      new DeferredAgentMcpServersGateway(),
      remote,
      wiring(),
    );
    expect(surface.management.support(SERVER)).toBe("unsupported");
    surface.serverProjects.connect([LINUX]);
    surface.serverProjects.load();
    tunnel.serve("linux", mcpRunnerFixture("runner-home", true, true), []);
    await settleMicrotasks();
    expect(surface.management.support(SERVER)).toBe("supported");

    surface.management.signIn(SERVER, "linear", "signIn");
    await settleMicrotasks();
    expect(management.starts.requests()).toEqual([
      { ...PROJECT, provider: "codex", name: "linear", mode: "signIn" },
    ]);

    surface.serverProjects.load();
    tunnel.serve("linux", mcpRunnerFixture("runner-home", true), []);
    await settleMicrotasks();
    expect(surface.management.support(SERVER)).toBe("unsupported");
    management.starts.latest()?.reject(AGENT_MCP_SERVER_MANAGEMENT_ERRORS.unsupportedRunner);
    await settleMicrotasks();
    expect(surface.management.activity(SERVER, "linear")).toEqual({
      kind: "failed",
      action: "signIn",
      error: "unsupportedRunner",
    });
    surface.management.dispose();
  });

  it("manages server projects through the runner gateway once the runner advertises it", async () => {
    const tunnel = new DeferredRunnerTunnel();
    const surface = createAgentMcpServersSurface(
      new DeferredAgentMcpServersGateway(),
      new TauriRemoteRunnerGateway(tunnel.invoke),
      wiring(),
    );
    surface.serverProjects.connect([LINUX]);
    surface.serverProjects.load();
    tunnel.serve("linux", mcpRunnerFixture("runner-home", true, true), []);
    await settleMicrotasks();
    expect(surface.serverProjects.state().hosts[0]?.inventory).toMatchObject({ management: true });
    expect(surface.management.support(SERVER)).toBe("supported");
  });
});
