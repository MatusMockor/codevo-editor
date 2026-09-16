import { describe, expect, it, vi } from "vitest";
import { TauriAgentArtifactGateway } from "./tauriAgentArtifactGateway";
import type { AgentArtifactOwner } from "../application/agentArtifactPorts";
const id = "7389088c-29b8-4cec-9a15-e825e1fb2f66";
const local: AgentArtifactOwner = {
  kind: "local",
  ownerId: "agent-root:abc",
  rootKey: "/workspace",
  repositoryRoot: "/workspace",
  threadId: "thread",
  turnId: "turn",
};
const remote: AgentArtifactOwner = {
  kind: "remote",
  serverId: "linux",
  runnerId: "runner-id",
  taskId: id,
};
function info(owner: AgentArtifactOwner) {
  return {
    id: owner.kind === "local" ? "b".repeat(64) : id,
    taskId: owner.kind === "local" ? owner.turnId : owner.taskId,
    name: "design.html",
    mediaType: "text/html",
    sizeBytes: 8,
    sha256: "a".repeat(64),
  };
}
describe("generated artifact gateway", () => {
  it.each([local, remote])(
    "routes metadata through native exact owner authority: $kind",
    async (owner) => {
      const invoke = vi.fn().mockResolvedValue(info(owner));
      const gateway = new TauriAgentArtifactGateway(invoke);
      await expect(gateway.resolve(owner, "/workspace/design.html")).resolves.toEqual(info(owner));
      expect(invoke).toHaveBeenCalledWith(
        owner.kind === "local" ? "resolve_agent_output_artifact" : "resolve_remote_agent_artifact",
        {
          request:
            owner.kind === "local"
              ? {
                  workspaceId: local.ownerId,
                  threadId: "thread",
                  turnId: "turn",
                  path: "/workspace/design.html",
                }
              : {
                  serverId: "linux",
                  runnerId: "runner-id",
                  taskId: id,
                  path: "/workspace/design.html",
                },
        },
      );
    },
  );
  it.each([local, remote])(
    "reads bounded binary without browser credentials: $kind",
    async (owner) => {
      const bytes = new ArrayBuffer(8);
      const invoke = vi.fn().mockResolvedValue(bytes);
      await expect(new TauriAgentArtifactGateway(invoke).read(owner, info(owner).id)).resolves.toBe(
        bytes,
      );
      expect(invoke.mock.calls[0]?.[0]).toBe(
        owner.kind === "local" ? "read_agent_output_artifact" : "read_remote_agent_artifact",
      );
    },
  );
  it.each(["../private.png", "https://example.test/x.png", "x.svg", "x.html#hash", "x\0.png"])(
    "rejects unsafe path %s before IPC",
    async (path) => {
      const invoke = vi.fn();
      await expect(new TauriAgentArtifactGateway(invoke).resolve(local, path)).rejects.toThrow();
      expect(invoke).not.toHaveBeenCalled();
    },
  );
  it("preserves literal percent paths without double decoding", async () => {
    const invoke = vi.fn().mockResolvedValue(info(local));
    await new TauriAgentArtifactGateway(invoke).resolve(local, "100%25 design.html");
    expect(invoke.mock.calls[0]?.[1].request.path).toBe("100%25 design.html");
  });
  it.each([
    { taskId: "foreign" },
    { token: "secret" },
    { sizeBytes: 2 * 1024 * 1024 + 1 },
    { mediaType: "image/svg+xml" },
    { sha256: "invalid" },
    { id: "../x" },
    { name: "../x.html" },
  ])("rejects malformed or foreign metadata %j", async (mutation) => {
    const invoke = vi.fn().mockResolvedValue({ ...info(remote), ...mutation });
    await expect(new TauriAgentArtifactGateway(invoke).resolve(remote, "x.html")).rejects.toThrow();
  });
  it.each([new ArrayBuffer(0), new ArrayBuffer(8 * 1024 * 1024 + 1), [1, 2, 3], "secret"])(
    "rejects invalid binary responses",
    async (value) => {
      await expect(
        new TauriAgentArtifactGateway(vi.fn().mockResolvedValue(value)).read(remote, id),
      ).rejects.toThrow();
    },
  );
  it("rejects invalid remote IDs before IPC", async () => {
    const invoke = vi.fn();
    await expect(
      new TauriAgentArtifactGateway(invoke).read(
        { kind: "remote", serverId: "../evil", runnerId: "runner-id", taskId: id },
        id,
      ),
    ).rejects.toThrow();
    await expect(
      new TauriAgentArtifactGateway(invoke).read(remote, "../artifact"),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
});
