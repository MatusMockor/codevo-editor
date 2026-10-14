import { describe, expect, it } from "vitest";
import { agentRootOwnerId } from "./agentProject";
import {
  MAX_REMOTE_AGENT_THREAD_REQUEST_PROJECT_ID_CHARS,
  MAX_REMOTE_AGENT_THREAD_REQUEST_RUNNER_ID_CHARS,
  agentThreadRequestScopeRoute,
  isRemoteAgentThreadRequestWireId,
  remoteAgentThreadRequestIdentity,
  remoteAgentThreadRequestScope,
  type AgentThreadRequestScopeIdentity,
  type RemoteAgentThreadRequestIdentity,
} from "./remoteAgentThreadRequestScope";

const CONVERSATION = "0b8f0f5e-1c2d-4e3f-8a9b-000000000001";
const IDENTITY: RemoteAgentThreadRequestIdentity = {
  serverId: "srv-a",
  runnerId: "runner-1",
  projectId: "project-1",
  conversationId: CONVERSATION,
};
const REMOTE: AgentThreadRequestScopeIdentity = {
  rootKey: "remote:srv-a:runner-1:project-1",
  ownerId: "remote:srv-a:runner-1:project-1",
  threadId: CONVERSATION,
  workspaceId: "srv-a",
};

function localScope(rootKey: string): AgentThreadRequestScopeIdentity {
  return {
    rootKey,
    ownerId: agentRootOwnerId(rootKey),
    threadId: "agt-thread-0001",
    workspaceId: "workspace-1",
  };
}

describe("remoteAgentThreadRequestScope", () => {
  it("builds the store scope of a remote thread from its execution identity", () => {
    expect(remoteAgentThreadRequestScope(IDENTITY)).toEqual(REMOTE);
  });

  it("encodes the project key parts the way the remote projection does", () => {
    const scope = remoteAgentThreadRequestScope({
      ...IDENTITY,
      runnerId: "runner one/β",
      projectId: "team:app",
    });
    expect(scope?.rootKey).toBe("remote:srv-a:runner%20one%2F%CE%B2:team%3Aapp");
    expect(scope?.ownerId).toBe(scope?.rootKey);
  });

  it("keeps an empty project id, which the projection uses for a task without a project", () => {
    const scope = remoteAgentThreadRequestScope({ ...IDENTITY, projectId: "" });
    expect(scope?.rootKey).toBe("remote:srv-a:runner-1:");
    expect(scope === null ? null : remoteAgentThreadRequestIdentity(scope)).toEqual({
      ...IDENTITY,
      projectId: "",
    });
  });

  it.each([
    ["a conversation id outside the wire grammar", { conversationId: "remote-thread%3Aabc" }],
    ["a conversation id longer than a wire id", { conversationId: "c".repeat(129) }],
    ["an empty conversation id", { conversationId: "" }],
    ["a server id outside the wire grammar", { serverId: "srv a" }],
    ["an empty server id", { serverId: "" }],
    ["an empty runner id", { runnerId: "" }],
    ["a runner id with a control character", { runnerId: "runner\u0007" }],
    [
      "an oversized runner id",
      { runnerId: "r".repeat(MAX_REMOTE_AGENT_THREAD_REQUEST_RUNNER_ID_CHARS + 1) },
    ],
    [
      "an oversized project id",
      { projectId: "p".repeat(MAX_REMOTE_AGENT_THREAD_REQUEST_PROJECT_ID_CHARS + 1) },
    ],
    ["a runner id with a lone surrogate", { runnerId: "runner\ud800" }],
  ])("refuses %s", (_name, overrides) => {
    expect(remoteAgentThreadRequestScope({ ...IDENTITY, ...overrides })).toBeNull();
  });

  it("recovers the gateway identity from a scope it built", () => {
    const identity = { ...IDENTITY, runnerId: "runner one/β", projectId: "team:app" };
    const scope = remoteAgentThreadRequestScope(identity);
    expect(scope).not.toBeNull();
    expect(scope === null ? null : remoteAgentThreadRequestIdentity(scope)).toEqual(identity);
  });

  it.each([
    ["an owner that differs from the root", { ownerId: "remote:srv-a:runner-1:project-2" }],
    ["a local owner on a remote root", { ownerId: agentRootOwnerId(REMOTE.rootKey) }],
    ["no workspace", { workspaceId: null }],
    ["a workspace that is another server", { workspaceId: "srv-b" }],
    ["a thread id outside the wire grammar", { threadId: "remote-thread:srv-a:runner-1:c%20d" }],
    [
      "a key with too few parts",
      { rootKey: "remote:srv-a:runner-1", ownerId: "remote:srv-a:runner-1" },
    ],
    [
      "a key with too many parts",
      { rootKey: "remote:srv-a:runner-1:p:q", ownerId: "remote:srv-a:runner-1:p:q" },
    ],
    [
      "a key in another namespace",
      { rootKey: "local:srv-a:runner-1:project-1", ownerId: "local:srv-a:runner-1:project-1" },
    ],
    [
      "a key that is not canonically encoded",
      {
        rootKey: "remote:srv-a:runner%2D1:project-1",
        ownerId: "remote:srv-a:runner%2D1:project-1",
      },
    ],
    [
      "a key that cannot be decoded",
      { rootKey: "remote:srv-a:runner%:project-1", ownerId: "remote:srv-a:runner%:project-1" },
    ],
    ["a key without a server", { rootKey: "remote::runner-1:p", ownerId: "remote::runner-1:p" }],
  ])("recognises no gateway identity in a scope with %s", (_name, overrides) => {
    expect(remoteAgentThreadRequestIdentity({ ...REMOTE, ...overrides })).toBeNull();
  });

  it("routes a scope built for a remote thread to the remote feed", () => {
    expect(agentThreadRequestScopeRoute(REMOTE)).toBe("remote");
  });

  it.each(["/Users/dev/app", "C:\\work\\app", "relative/app", "remote", "/remote:srv-a"])(
    "routes the local scope of project %s to the local feed",
    (rootKey) => {
      expect(agentThreadRequestScopeRoute(localScope(rootKey))).toBe("local");
    },
  );

  it("never produces a local owner id inside the remote namespace", () => {
    for (const rootKey of ["remote:srv-a:runner-1:project-1", "remote:", "", "/repo"]) {
      expect(agentRootOwnerId(rootKey)).toMatch(/^agent-root:[0-9a-f]{16}$/);
      expect(agentRootOwnerId(rootKey).startsWith("remote:")).toBe(false);
    }
  });

  it.each([
    ["a remote owner with a foreign root", { rootKey: "/repo/app" }],
    ["a remote root under a local owner", { ownerId: agentRootOwnerId(REMOTE.rootKey) }],
    ["a remote owner without a workspace", { workspaceId: null }],
    ["a malformed remote owner", { rootKey: "remote:broken", ownerId: "remote:broken" }],
    ["an empty remote namespace", { rootKey: "remote:", ownerId: "remote:" }],
    [
      "a remote thread key on a local owner",
      {
        rootKey: "/repo/app",
        ownerId: agentRootOwnerId("/repo/app"),
        threadId: "remote-thread:srv-a:runner-1:conversation",
      },
    ],
  ])("keeps %s away from the local feed", (_name, overrides) => {
    expect(agentThreadRequestScopeRoute({ ...REMOTE, ...overrides })).toBe("remote");
  });

  it("recognises wire ids", () => {
    expect(isRemoteAgentThreadRequestWireId(CONVERSATION)).toBe(true);
    expect(isRemoteAgentThreadRequestWireId("a".repeat(128))).toBe(true);
    expect(isRemoteAgentThreadRequestWireId("a".repeat(129))).toBe(false);
    expect(isRemoteAgentThreadRequestWireId("-leading")).toBe(false);
    expect(isRemoteAgentThreadRequestWireId("with space")).toBe(false);
    expect(isRemoteAgentThreadRequestWireId(7)).toBe(false);
  });
});
