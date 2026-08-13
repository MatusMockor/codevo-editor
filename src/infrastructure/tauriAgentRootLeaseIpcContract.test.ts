import { describe, expect, it, vi } from "vitest";
import {
  ACQUIRE_AGENT_ROOT_LEASE_IPC_COMMAND,
  invokeAcquireAgentRootLeaseIpc,
  invokeReleaseAgentRootLeaseIpc,
  RELEASE_AGENT_ROOT_LEASE_IPC_COMMAND,
  type InvokeAgentRootLeaseCommand,
} from "./tauriAgentRootLeaseIpcContract";

describe("agent root lease IPC command names", () => {
  it("pins the snake_case commands", () => {
    expect(ACQUIRE_AGENT_ROOT_LEASE_IPC_COMMAND).toBe("acquire_agent_root_lease");
    expect(RELEASE_AGENT_ROOT_LEASE_IPC_COMMAND).toBe("release_agent_root_lease");
  });
});

describe("invokeAcquireAgentRootLeaseIpc", () => {
  it("sends the validated request and parses the receipt", async () => {
    const invokeCommand = vi.fn<InvokeAgentRootLeaseCommand>().mockResolvedValue({ leaseToken: 7 });

    await expect(
      invokeAcquireAgentRootLeaseIpc(invokeCommand, { rootPath: "/repo" }),
    ).resolves.toEqual({ leaseToken: 7 });
    expect(invokeCommand).toHaveBeenCalledWith("acquire_agent_root_lease", {
      request: { rootPath: "/repo" },
    });
  });

  it("rejects malformed requests before touching the transport", async () => {
    const invokeCommand = vi.fn<InvokeAgentRootLeaseCommand>();
    const rejected: readonly unknown[] = [
      {},
      { rootPath: 1 },
      { rootPath: "" },
      { rootPath: "/repo", extra: true },
    ];

    for (const request of rejected) {
      await expect(
        invokeAcquireAgentRootLeaseIpc(invokeCommand, request as { readonly rootPath: string }),
      ).rejects.toThrow(TypeError);
    }
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("rejects malformed receipts", async () => {
    const rejected: readonly unknown[] = [
      null,
      {},
      { leaseToken: -1 },
      { leaseToken: 1.5 },
      { leaseToken: "1" },
      { leaseToken: 1, extra: true },
    ];

    for (const receipt of rejected) {
      const invokeCommand = vi.fn<InvokeAgentRootLeaseCommand>().mockResolvedValue(receipt);
      await expect(
        invokeAcquireAgentRootLeaseIpc(invokeCommand, { rootPath: "/repo" }),
      ).rejects.toThrow(TypeError);
    }
  });
});

describe("invokeReleaseAgentRootLeaseIpc", () => {
  it("sends the validated request and accepts a null unit result", async () => {
    const invokeCommand = vi.fn<InvokeAgentRootLeaseCommand>().mockResolvedValue(null);

    await expect(
      invokeReleaseAgentRootLeaseIpc(invokeCommand, { rootPath: "/repo", leaseToken: 7 }),
    ).resolves.toBeUndefined();
    expect(invokeCommand).toHaveBeenCalledWith("release_agent_root_lease", {
      request: { rootPath: "/repo", leaseToken: 7 },
    });
  });

  it("rejects malformed requests before touching the transport", async () => {
    const invokeCommand = vi.fn<InvokeAgentRootLeaseCommand>();
    const rejected: readonly unknown[] = [
      { rootPath: "/repo" },
      { rootPath: 1, leaseToken: 7 },
      { rootPath: "/repo", leaseToken: -1 },
      { rootPath: "/repo", leaseToken: "7" },
      { rootPath: "/repo", leaseToken: 7, extra: true },
    ];

    for (const request of rejected) {
      await expect(
        invokeReleaseAgentRootLeaseIpc(
          invokeCommand,
          request as { readonly rootPath: string; readonly leaseToken: number },
        ),
      ).rejects.toThrow(TypeError);
    }
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("rejects a non-null unit result", async () => {
    const invokeCommand = vi.fn<InvokeAgentRootLeaseCommand>().mockResolvedValue({});

    await expect(
      invokeReleaseAgentRootLeaseIpc(invokeCommand, { rootPath: "/repo", leaseToken: 7 }),
    ).rejects.toThrow("expected null");
  });
});
