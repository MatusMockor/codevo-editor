import { describe, expect, it } from "vitest";
import wireContract from "../../contracts/agent-mcp-servers-wire.json";
import { agentMcpServersErrorKind, parseAgentMcpServers } from "../domain/agentMcpServers";
import {
  localAgentMcpServersTarget,
  serverAgentMcpServersTarget,
  type AgentMcpServersTarget,
} from "../domain/agentMcpServersTarget";
import { TauriRemoteRunnerGateway } from "../infrastructure/tauriRemoteRunnerGateway";
import {
  DeferredAgentMcpServersGateway,
  DeferredRunnerTunnel,
  agentMcpServersFixture,
  mcpRunnerFixture,
} from "../test/agentMcpServersTestSupport";
import { AgentMcpServerProjectsStore } from "./agentMcpServerProjects";
import { agentMcpServersSource, type AgentMcpServersSource } from "./agentMcpServersGateway";

const LINUX = { id: "linux", name: "Linux box", connection: {} };
const PROJECT = { serverId: "linux", runnerId: "runner-home", projectId: "codevo-editor" };
const projects = [{ id: "codevo-editor", name: "Codevo Editor" }];
const claudeFromServer = parseAgentMcpServers(wireContract.responses[0].value);
const codexFromServer = parseAgentMcpServers(wireContract.responses[1].value);

function present<T>(value: T | null): T {
  expect(value).not.toBeNull();
  return value as T;
}

const LOCAL = present(localAgentMcpServersTarget("/work/app", "codex"));
const SERVER_CLAUDE = present(serverAgentMcpServersTarget(PROJECT, "claudeCode"));
const SERVER_CODEX = present(serverAgentMcpServersTarget(PROJECT, "codex"));

function setup() {
  const local = new DeferredAgentMcpServersGateway();
  const tunnel = new DeferredRunnerTunnel();
  const remote = new TauriRemoteRunnerGateway(tunnel.invoke);
  const runners = new AgentMcpServerProjectsStore(remote);
  const source = agentMcpServersSource(local, remote, runners);
  return { local, runners, source, tunnel };
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
}

async function connectRunner(
  { runners, tunnel }: Pick<ReturnType<typeof setup>, "runners" | "tunnel">,
  runner = mcpRunnerFixture("runner-home"),
): Promise<void> {
  runners.connect([LINUX]);
  runners.load();
  tunnel.serve("linux", runner, projects);
  await settle();
}

async function outcome(
  source: AgentMcpServersSource,
  target: AgentMcpServersTarget,
): Promise<unknown> {
  return source.check(target).then(
    (servers) => servers,
    (error: unknown) => agentMcpServersErrorKind(error),
  );
}

describe("agentMcpServersSource", () => {
  it("asks the local gateway for a local target and never the server", async () => {
    const scene = setup();
    await connectRunner(scene);
    const answer = agentMcpServersFixture("codex", [{ name: "docs" }]);
    const checked = scene.source.check(LOCAL);
    expect(scene.local.requests()).toEqual([{ repositoryRoot: "/work/app", provider: "codex" }]);
    scene.local.checks[0]?.resolve(answer);
    expect(await checked).toBe(answer);
    expect(scene.tunnel.checks()).toEqual([]);
  });

  it("asks the runner for a server target with the provider name the runner speaks", async () => {
    const scene = setup();
    await connectRunner(scene);
    const claude = scene.source.check(SERVER_CLAUDE);
    const codex = scene.source.check(SERVER_CODEX);
    await settle();
    expect(scene.tunnel.checks()).toEqual([
      { ...PROJECT, provider: "claude" },
      { ...PROJECT, provider: "codex" },
    ]);
    const [first, second] = scene.tunnel.pendingChecks("linux");
    first?.resolve(wireContract.responses[0].value);
    second?.resolve(wireContract.responses[1].value);
    expect(await claude).toEqual(claudeFromServer);
    expect(await codex).toEqual(codexFromServer);
    expect(scene.local.requests()).toEqual([]);
  });

  it("refuses a runner that does not announce the capability without calling it", async () => {
    for (const capability of [false, "absent"] as const) {
      const scene = setup();
      await connectRunner(scene, mcpRunnerFixture("runner-home", capability));
      const before = scene.tunnel.calls.length;
      expect(await outcome(scene.source, SERVER_CLAUDE)).toBe("unsupportedRunner");
      expect(scene.tunnel.checks()).toEqual([]);
      expect(scene.tunnel.calls).toHaveLength(before);
      expect(scene.local.requests()).toEqual([]);
    }
  });

  it("reports the server as unavailable when no remote gateway can check it", async () => {
    const scene = setup();
    await connectRunner(scene);
    const withoutGateway = agentMcpServersSource(scene.local, null, scene.runners);
    const withoutMethod = agentMcpServersSource(scene.local, {}, scene.runners);
    expect(await outcome(withoutGateway, SERVER_CLAUDE)).toBe("serverUnavailable");
    expect(await outcome(withoutMethod, SERVER_CODEX)).toBe("serverUnavailable");
    expect(scene.tunnel.checks()).toEqual([]);
  });

  it("reports the server as unavailable when it is not connected or is another runner", async () => {
    const scene = setup();
    expect(await outcome(scene.source, SERVER_CLAUDE)).toBe("serverUnavailable");
    await connectRunner(scene, mcpRunnerFixture("runner-replaced"));
    expect(await outcome(scene.source, SERVER_CLAUDE)).toBe("serverUnavailable");
    scene.runners.connect([]);
    expect(await outcome(scene.source, SERVER_CLAUDE)).toBe("serverUnavailable");
    expect(scene.tunnel.checks()).toEqual([]);
  });

  it("waits for a running read of the runner and decides from its fresh answer", async () => {
    const scene = setup();
    await connectRunner(scene, mcpRunnerFixture("runner-home", false));
    scene.runners.load();
    const checked = scene.source.check(SERVER_CODEX);
    await settle();
    expect(scene.tunnel.checks()).toEqual([]);

    scene.tunnel.serve("linux", mcpRunnerFixture("runner-home", true), projects);
    await settle();
    expect(scene.tunnel.checks()).toEqual([{ ...PROJECT, provider: "codex" }]);
    scene.tunnel.pendingChecks("linux")[0]?.resolve(wireContract.responses[1].value);
    expect(await checked).toEqual(codexFromServer);
  });

  it("drops an answer that arrives after the server disconnected", async () => {
    const scene = setup();
    await connectRunner(scene);
    const checked = outcome(scene.source, SERVER_CLAUDE);
    await settle();
    scene.runners.connect([]);
    scene.tunnel.pendingChecks("linux")[0]?.resolve(wireContract.responses[0].value);
    expect(await checked).toBe("serverUnavailable");
  });

  it("drops an answer that arrives after the server reconnected to another runner", async () => {
    const scene = setup();
    await connectRunner(scene);
    const checked = outcome(scene.source, SERVER_CLAUDE);
    await settle();
    const [late] = scene.tunnel.pendingChecks("linux");

    scene.runners.connect([]);
    await connectRunner(scene, mcpRunnerFixture("runner-replaced"));
    late?.resolve(wireContract.responses[0].value);
    expect(await checked).toBe("serverUnavailable");
    expect(scene.runners.support("linux", "runner-replaced")).toBe("supported");
  });

  it("passes the runner's own refusals and unreadable answers through to be classified", async () => {
    const scene = setup();
    await connectRunner(scene);
    const refused = outcome(scene.source, SERVER_CLAUDE);
    const foreign = outcome(scene.source, SERVER_CODEX);
    await settle();
    const [first, second] = scene.tunnel.pendingChecks("linux");
    first?.reject(wireContract.errors.unsupportedRunner);
    second?.resolve(wireContract.responses[0].value);
    expect(await refused).toBe("unsupportedRunner");
    expect(await foreign).toBe("unavailable");
  });

  it("captures the target when the check starts", async () => {
    const scene = setup();
    await connectRunner(scene);
    const target = { ...SERVER_CLAUDE };
    const checked = scene.source.check(target);
    Object.assign(target, { projectId: "other", runnerId: "runner-replaced" });
    await settle();
    expect(scene.tunnel.checks()).toEqual([{ ...PROJECT, provider: "claude" }]);
    scene.tunnel.pendingChecks("linux")[0]?.resolve(wireContract.responses[0].value);
    expect(await checked).toEqual(claudeFromServer);
  });
});
