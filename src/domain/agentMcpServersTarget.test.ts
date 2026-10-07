import { describe, expect, it } from "vitest";
import wireContract from "../../contracts/agent-mcp-servers-wire.json";
import {
  AGENT_MCP_SERVERS_RUNNER_CAPABILITY,
  agentMcpServersProjectKey,
  agentMcpServersProjectOfKey,
  agentMcpServersTarget,
  agentMcpServersTargetKey,
  localAgentMcpServersProject,
  localAgentMcpServersTarget,
  remoteMcpServersRequest,
  serverAgentMcpServersProject,
  serverAgentMcpServersTarget,
  type AgentMcpServersProject,
  type AgentMcpServersTarget,
} from "./agentMcpServersTarget";
import { remoteRunnerChecks } from "./remoteRunnerValidation";

const SERVER = "3f2b8c1e-5a47-4d09-9c3e-7b1a2d4e6f80";
const project = { serverId: SERVER, runnerId: "runner-home", projectId: "codevo-editor" };

function present<T>(value: T | null): T {
  expect(value).not.toBeNull();
  return value as T;
}

describe("agent MCP servers runner contract", () => {
  it("names the capability and providers the shared contract declares", () => {
    expect(AGENT_MCP_SERVERS_RUNNER_CAPABILITY).toBe(wireContract.remoteRunnerCapability);
    const providers = (["claudeCode", "codex"] as const).map((provider) => [
      provider,
      remoteMcpServersRequest(present(serverAgentMcpServersTarget(project, provider))).provider,
    ]);
    expect(Object.fromEntries(providers)).toEqual(wireContract.remoteRunnerProviders);
  });

  it.each(wireContract.remoteRequests)("accepts the $name remote request", ({ value }) => {
    expect(remoteRunnerChecks.getMcpServers.request(value)).toBe(true);
  });

  it.each(wireContract.rejectedRemoteRequests)("rejects the $name remote request", ({ value }) => {
    expect(remoteRunnerChecks.getMcpServers.request(value)).toBe(false);
  });
});

describe("agent MCP servers targets", () => {
  it("builds a local target only for an absolute repository root", () => {
    expect(localAgentMcpServersTarget("/work/app", "codex")).toEqual({
      kind: "local",
      repositoryRoot: "/work/app",
      provider: "codex",
    });
    expect(Object.isFrozen(localAgentMcpServersTarget("/work/app", "codex"))).toBe(true);
    expect(localAgentMcpServersTarget(null, "codex")).toBeNull();
    expect(localAgentMcpServersTarget("", "codex")).toBeNull();
    expect(localAgentMcpServersTarget("relative/root", "codex")).toBeNull();
    expect(localAgentMcpServersTarget("remote:server:runner:project", "codex")).toBeNull();
    expect(localAgentMcpServersTarget("/work/a\nb", "claudeCode")).toBeNull();
  });

  it("builds the server target that produces each remote contract request", () => {
    const targets = [
      serverAgentMcpServersTarget(project, "claudeCode"),
      serverAgentMcpServersTarget(project, "codex"),
    ].map(present);
    expect(targets.map(remoteMcpServersRequest)).toEqual(
      wireContract.remoteRequests.map(({ value }) => value),
    );
    expect(targets[0]).toEqual({ kind: "server", ...project, provider: "claudeCode" });
    expect(Object.isFrozen(targets[0])).toBe(true);
    expect(Object.keys(remoteMcpServersRequest(present(targets[0])))).toEqual([
      "serverId",
      "runnerId",
      "projectId",
      "provider",
    ]);
  });

  it.each([
    ["no resolved project", null],
    ["an empty project id", { ...project, projectId: "" }],
    ["a project id with a slash", { ...project, projectId: "a/b" }],
    ["an over-long project id", { ...project, projectId: "a".repeat(65) }],
    ["an empty runner id", { ...project, runnerId: "" }],
    ["a runner id with a control character", { ...project, runnerId: "runner\u0000" }],
    ["an over-long runner id", { ...project, runnerId: "r".repeat(129) }],
    ["an empty server id", { ...project, serverId: "" }],
    ["a placeholder server id", { ...project, serverId: "not available" }],
  ])("refuses a server target with %s", (_name, candidate) => {
    expect(serverAgentMcpServersTarget(candidate, "codex")).toBeNull();
    expect(serverAgentMcpServersProject(candidate)).toBeNull();
  });

  it("builds a project of either kind and turns it into that kind of target", () => {
    const local = present(localAgentMcpServersProject("/work/app"));
    const noisy = { ...project, token: "never-copied" };
    const server = present(serverAgentMcpServersProject(noisy));
    expect(local).toEqual({ kind: "local", repositoryRoot: "/work/app" });
    expect(server).toEqual({ kind: "server", ...project });
    expect(Object.isFrozen(local) && Object.isFrozen(server)).toBe(true);
    expect(localAgentMcpServersProject("relative")).toBeNull();
    expect(localAgentMcpServersProject(null)).toBeNull();

    expect(agentMcpServersTarget(local, "codex")).toEqual(
      localAgentMcpServersTarget("/work/app", "codex"),
    );
    expect(agentMcpServersTarget(server, "claudeCode")).toEqual(
      serverAgentMcpServersTarget(project, "claudeCode"),
    );
    expect(agentMcpServersTarget(null, "codex")).toBeNull();
    expect(
      agentMcpServersTarget({ kind: "local", repositoryRoot: "relative" }, "codex"),
    ).toBeNull();
    expect(
      agentMcpServersTarget({ kind: "server", ...project, projectId: "a/b" }, "codex"),
    ).toBeNull();
  });

  it("gives every distinct target a distinct key", () => {
    const targets: ReadonlyArray<AgentMcpServersTarget> = [
      localAgentMcpServersTarget("/work/app", "claudeCode"),
      localAgentMcpServersTarget("/work/app", "codex"),
      localAgentMcpServersTarget("/work/app/", "claudeCode"),
      localAgentMcpServersTarget("/work/other", "claudeCode"),
      localAgentMcpServersTarget(`/${SERVER}/runner-home/codevo-editor`, "claudeCode"),
      localAgentMcpServersTarget('/a","b', "claudeCode"),
      localAgentMcpServersTarget("/a", "claudeCode"),
      serverAgentMcpServersTarget(project, "claudeCode"),
      serverAgentMcpServersTarget(project, "codex"),
      serverAgentMcpServersTarget({ ...project, serverId: "other-server" }, "claudeCode"),
      serverAgentMcpServersTarget({ ...project, runnerId: "runner-replaced" }, "claudeCode"),
      serverAgentMcpServersTarget({ ...project, projectId: "codevo-runner" }, "claudeCode"),
      serverAgentMcpServersTarget({ serverId: "a", runnerId: 'b","c', projectId: "d" }, "codex"),
      serverAgentMcpServersTarget({ serverId: "a", runnerId: "b", projectId: "c" }, "codex"),
    ].map(present);
    const keys = targets.map(agentMcpServersTargetKey);
    expect(new Set(keys).size).toBe(targets.length);
    expect(agentMcpServersTargetKey({ ...present(targets[0]) })).toBe(keys[0]);
    expect(agentMcpServersTargetKey({ ...present(targets[7]) })).toBe(keys[7]);
  });

  it("never lets a local key and a server key collide", () => {
    const server = present(serverAgentMcpServersTarget(project, "codex"));
    const lookalike = present(
      localAgentMcpServersTarget(`/${project.serverId}","${project.runnerId}`, "codex"),
    );
    expect(agentMcpServersTargetKey(server).startsWith('["server",')).toBe(true);
    expect(agentMcpServersTargetKey(lookalike).startsWith('["local",')).toBe(true);
    expect(agentMcpServersTargetKey(lookalike)).not.toBe(agentMcpServersTargetKey(server));
  });

  it("keys a project by its kind and exact identity", () => {
    const projects: ReadonlyArray<AgentMcpServersProject> = [
      localAgentMcpServersProject("/work/app"),
      localAgentMcpServersProject("/work/api"),
      localAgentMcpServersProject(`/${SERVER}`),
      serverAgentMcpServersProject(project),
      serverAgentMcpServersProject({ ...project, runnerId: "runner-replaced" }),
      serverAgentMcpServersProject({ ...project, serverId: "other-server" }),
      serverAgentMcpServersProject({ ...project, projectId: "codevo-runner" }),
    ].map(present);
    const keys = projects.map(agentMcpServersProjectKey);
    expect(new Set(keys).size).toBe(projects.length);
    expect(agentMcpServersProjectKey({ ...present(projects[3]) })).toBe(keys[3]);
  });

  it("restores exactly the project a key was made from", () => {
    const projects = [
      localAgentMcpServersProject("/work/app"),
      localAgentMcpServersProject('/we"ird,[path]'),
      serverAgentMcpServersProject(project),
      serverAgentMcpServersProject({ ...project, runnerId: 'runner "home", 2' }),
    ].map(present);
    for (const item of projects) {
      const restored = agentMcpServersProjectOfKey(agentMcpServersProjectKey(item));
      expect(restored).toEqual(item);
      expect(Object.isFrozen(restored)).toBe(true);
    }
  });

  it.each([
    "",
    "not json",
    "{}",
    "[]",
    '["local"]',
    '["local","relative"]',
    '["local","/work/app","extra"]',
    '["local",7]',
    '["server","server","runner"]',
    '["server","server","runner","a/b"]',
    '["server","server","runner","project","extra"]',
    '["remote","server","runner","project"]',
  ])("refuses the malformed project key %s", (key) => {
    expect(agentMcpServersProjectOfKey(key)).toBeNull();
  });
});
