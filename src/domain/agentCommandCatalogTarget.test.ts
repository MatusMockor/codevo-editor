import { describe, expect, it } from "vitest";
import wireContract from "../../contracts/agent-command-catalog-wire.json";
import {
  agentCommandCatalogTargetKey,
  agentCommandCatalogTargetOfKey,
  localAgentCommandCatalogTarget,
  remoteCommandCatalogRequest,
  serverAgentCommandCatalogTarget,
  type AgentCommandCatalogTarget,
} from "./agentCommandCatalogTarget";

const SERVER = "3f2b8c1e-5a47-4d09-9c3e-7b1a2d4e6f80";
const project = { serverId: SERVER, runnerId: "runner-home", projectId: "codevo-editor" };

function present<T>(value: T | null): T {
  expect(value).not.toBeNull();
  return value as T;
}

describe("agent command catalog targets", () => {
  it("builds a local target only for an absolute workspace root", () => {
    expect(localAgentCommandCatalogTarget("/work/app", "codex")).toEqual({
      kind: "local",
      repositoryRoot: "/work/app",
      provider: "codex",
    });
    expect(localAgentCommandCatalogTarget(null, "codex")).toBeNull();
    expect(localAgentCommandCatalogTarget("pending-clone", "codex")).toBeNull();
  });

  it("builds the server target that produces each remote contract request", () => {
    const targets = [
      serverAgentCommandCatalogTarget(project, "claudeCode"),
      serverAgentCommandCatalogTarget(project, "codex"),
    ].map(present);
    expect(targets.map(remoteCommandCatalogRequest)).toEqual(
      wireContract.remoteRequests.map(({ value }) => value),
    );
    expect(targets[0]).toEqual({ kind: "server", ...project, provider: "claudeCode" });
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
    expect(serverAgentCommandCatalogTarget(candidate, "codex")).toBeNull();
  });

  it("gives every distinct target a distinct key", () => {
    const targets: ReadonlyArray<AgentCommandCatalogTarget> = [
      localAgentCommandCatalogTarget("/work/app", "claudeCode"),
      localAgentCommandCatalogTarget("/work/app", "codex"),
      localAgentCommandCatalogTarget("/work/other", "claudeCode"),
      localAgentCommandCatalogTarget(`/${SERVER}/runner-home/codevo-editor`, "claudeCode"),
      localAgentCommandCatalogTarget('/a","b', "claudeCode"),
      localAgentCommandCatalogTarget("/a", "claudeCode"),
      serverAgentCommandCatalogTarget(project, "claudeCode"),
      serverAgentCommandCatalogTarget(project, "codex"),
      serverAgentCommandCatalogTarget({ ...project, serverId: "other-server" }, "claudeCode"),
      serverAgentCommandCatalogTarget({ ...project, runnerId: "runner-replaced" }, "claudeCode"),
      serverAgentCommandCatalogTarget({ ...project, projectId: "codevo-runner" }, "claudeCode"),
      serverAgentCommandCatalogTarget(
        { serverId: "a", runnerId: 'b","c', projectId: "d" },
        "claudeCode",
      ),
      serverAgentCommandCatalogTarget(
        { serverId: "a", runnerId: "b", projectId: "c" },
        "claudeCode",
      ),
    ].map(present);
    const keys = targets.map(agentCommandCatalogTargetKey);
    expect(new Set(keys).size).toBe(targets.length);
    expect(agentCommandCatalogTargetKey({ ...targets[0]! })).toBe(keys[0]);
  });

  it("restores exactly the target a key was made from", () => {
    const targets = [
      localAgentCommandCatalogTarget("/work/app", "codex"),
      localAgentCommandCatalogTarget('/we"ird,[path]', "claudeCode"),
      serverAgentCommandCatalogTarget(project, "claudeCode"),
      serverAgentCommandCatalogTarget({ ...project, runnerId: 'runner "home", 2' }, "codex"),
    ].map(present);
    for (const target of targets) {
      expect(agentCommandCatalogTargetOfKey(agentCommandCatalogTargetKey(target))).toEqual(target);
    }
  });

  it.each([
    "",
    "not json",
    "{}",
    "[]",
    '["local"]',
    '["local","claudeCode"]',
    '["local","gemini","/work/app"]',
    '["local","claudeCode","relative"]',
    '["local","claudeCode","/work/app","extra"]',
    '["local","claudeCode",7]',
    '["server","claudeCode","server","runner"]',
    '["server","claudeCode","server","runner","a/b"]',
    '["server","claudeCode","server","runner","project","extra"]',
    '["remote","claudeCode","server","runner","project"]',
  ])("refuses the malformed key %s", (key) => {
    expect(agentCommandCatalogTargetOfKey(key)).toBeNull();
  });
});
