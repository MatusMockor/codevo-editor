import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel } from "@tauri-apps/api/core";
import { watchRemoteRunnerInventory } from "./watchRemoteRunnerInventory";
import type { InvokeRemoteRunnerCommand } from "./tauriRemoteRunnerGateway";

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: (value: unknown) => void = () => {};
  },
}));

describe("remote inventory subscription", () => {
  let channel: Channel<unknown>;
  const invoke = vi.fn<InvokeRemoteRunnerCommand>();
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation(async (_command, args) => {
      if (args?.onEvent) channel = args.onEvent;
    });
  });

  it("delivers only while owned and unsubscribes exactly once", async () => {
    const listener = vi.fn();
    const dispose = await watchRemoteRunnerInventory(invoke, { serverId: "linux" }, listener);
    channel.onmessage({ type: "connected" });
    channel.onmessage({ type: "changed" });
    const subscription = invoke.mock.calls[0]?.[1]?.request as { subscriptionId: string };
    expect(subscription.subscriptionId).toMatch(/^[a-f0-9-]{36}$/);
    dispose();
    dispose();
    channel.onmessage({ type: "changed" });
    expect(listener.mock.calls).toEqual([[{ type: "connected" }], [{ type: "changed" }]]);
    expect(invoke).toHaveBeenLastCalledWith("remote_runner_unsubscribe_changes", {
      request: { subscriptionId: subscription.subscriptionId },
    });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it.each([null, [], { type: "connected", token: "private" }, { type: "unknown" }])(
    "closes malformed event %j without forwarding it",
    async (value) => {
      const listener = vi.fn();
      await watchRemoteRunnerInventory(invoke, { serverId: "linux" }, listener);
      channel.onmessage(value);
      channel.onmessage({ type: "changed" });
      expect(listener).toHaveBeenCalledExactlyOnceWith({ type: "disconnected" });
      expect(invoke).toHaveBeenCalledTimes(2);
    },
  );

  it("cleans up uncertain subscription failure and rejects", async () => {
    invoke.mockRejectedValueOnce(new Error("lost acknowledgement"));
    await expect(
      watchRemoteRunnerInventory(invoke, { serverId: "linux" }, vi.fn()),
    ).rejects.toThrow("lost acknowledgement");
    expect(invoke.mock.calls[1]?.[0]).toBe("remote_runner_unsubscribe_changes");
  });

  it("rejects invalid owner before IPC", async () => {
    await expect(
      watchRemoteRunnerInventory(invoke, { serverId: "../other" }, vi.fn()),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
});
