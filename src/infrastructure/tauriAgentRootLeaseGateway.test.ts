import { describe, expect, it, vi } from "vitest";
import {
  TauriAgentRootLeaseGateway,
  type AgentRootLeaseRuntimeDetector,
} from "./tauriAgentRootLeaseGateway";
import type { InvokeAgentRootLeaseCommand } from "./tauriAgentRootLeaseIpcContract";

const available: AgentRootLeaseRuntimeDetector = () => true;
const unavailable: AgentRootLeaseRuntimeDetector = () => false;

describe("TauriAgentRootLeaseGateway", () => {
  it("forwards typed acquire and release requests", async () => {
    const invokeCommand = vi
      .fn<InvokeAgentRootLeaseCommand>()
      .mockResolvedValueOnce({ leaseToken: 7, workspaceId: "ws-agent-root" })
      .mockResolvedValueOnce({ kind: "released", leaseToken: 7 });
    const gateway = new TauriAgentRootLeaseGateway(invokeCommand, available);

    await expect(gateway.acquireAgentRootLease({ rootPath: "/repo" })).resolves.toEqual({
      leaseToken: 7,
      workspaceId: "ws-agent-root",
    });
    await expect(
      gateway.releaseAgentRootLease({ rootPath: "/repo", leaseToken: 7 }),
    ).resolves.toEqual({ kind: "released", leaseToken: 7 });

    expect(invokeCommand.mock.calls).toEqual([
      ["acquire_agent_root_lease", { request: { rootPath: "/repo" } }],
      ["release_agent_root_lease", { request: { rootPath: "/repo", leaseToken: 7 } }],
    ]);
  });

  it("throws for both operations without the native runtime", async () => {
    const invokeCommand = vi.fn<InvokeAgentRootLeaseCommand>();
    const gateway = new TauriAgentRootLeaseGateway(invokeCommand, unavailable);

    await expect(gateway.acquireAgentRootLease({ rootPath: "/repo" })).rejects.toThrow(
      "Agent root leases require the native runtime.",
    );
    await expect(
      gateway.releaseAgentRootLease({ rootPath: "/repo", leaseToken: 7 }),
    ).rejects.toThrow("Agent root leases require the native runtime.");
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("rejects invalid acquire and release requests before reaching the transport", async () => {
    const invokeCommand = vi.fn<InvokeAgentRootLeaseCommand>();
    const gateway = new TauriAgentRootLeaseGateway(invokeCommand, available);

    await expect(gateway.acquireAgentRootLease({ rootPath: "" })).rejects.toThrow(TypeError);
    await expect(
      gateway.releaseAgentRootLease({ rootPath: "/repo", leaseToken: -1 }),
    ).rejects.toThrow(TypeError);
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("rejects malformed transport results", async () => {
    const acquireInvoke = vi.fn<InvokeAgentRootLeaseCommand>().mockResolvedValue({});
    const releaseInvoke = vi.fn<InvokeAgentRootLeaseCommand>().mockResolvedValue({
      kind: "released",
      leaseToken: 8,
    });

    await expect(
      new TauriAgentRootLeaseGateway(acquireInvoke, available).acquireAgentRootLease({
        rootPath: "/repo",
      }),
    ).rejects.toThrow(TypeError);
    await expect(
      new TauriAgentRootLeaseGateway(releaseInvoke, available).releaseAgentRootLease({
        rootPath: "/repo",
        leaseToken: 7,
      }),
    ).rejects.toThrow(TypeError);
  });
});
