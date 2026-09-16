import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentOutputAcknowledgement } from "./agentOutputAcknowledgement";

const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

afterEach(() => vi.useRealTimers());

describe("agent output acknowledgement", () => {
  it("coalesces bursts, keeps one invocation in flight and catches up cumulatively", async () => {
    let release!: () => void;
    const acknowledge = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const ack = createAgentOutputAcknowledgement({
      taskId: "agt-1",
      workspaceId: "ws-1",
      isCurrent: () => true,
      acknowledge,
      onFailure: vi.fn(),
    });
    for (let sequence = 1; sequence <= 64; sequence++) ack.consumed(sequence);
    await settle();
    expect(acknowledge).toHaveBeenCalledTimes(1);
    expect(acknowledge).toHaveBeenLastCalledWith({
      taskId: "agt-1",
      workspaceId: "ws-1",
      sequence: 64,
    });
    ack.consumed(128);
    await settle();
    expect(acknowledge).toHaveBeenCalledTimes(1);
    release();
    await settle();
    expect(acknowledge).toHaveBeenLastCalledWith({
      taskId: "agt-1",
      workspaceId: "ws-1",
      sequence: 128,
    });
    ack.consumed(1);
    await settle();
    expect(acknowledge).toHaveBeenCalledTimes(2);
  });

  it("never acknowledges queued output after exact owner replacement", async () => {
    let current = true;
    const acknowledge = vi.fn();
    const ack = createAgentOutputAcknowledgement({
      taskId: "agt-1",
      workspaceId: "ws-1",
      isCurrent: () => current,
      acknowledge,
      onFailure: vi.fn(),
    });
    ack.consumed(1);
    current = false;
    await settle();
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it("retries a transient failure with latest consumed sequence", async () => {
    vi.useFakeTimers();
    const acknowledge = vi
      .fn()
      .mockRejectedValueOnce(new Error("disconnected"))
      .mockResolvedValue(undefined);
    const onFailure = vi.fn();
    const ack = createAgentOutputAcknowledgement({
      taskId: "agt-1",
      workspaceId: "ws-1",
      isCurrent: () => true,
      acknowledge,
      onFailure,
    });
    ack.consumed(1);
    await settle();
    ack.consumed(2);
    await vi.runAllTimersAsync();
    expect(acknowledge).toHaveBeenLastCalledWith({
      taskId: "agt-1",
      workspaceId: "ws-1",
      sequence: 2,
    });
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("bounds failed retries and reports interrupted delivery once", async () => {
    vi.useFakeTimers();
    const acknowledge = vi.fn().mockRejectedValue(new Error("disconnected"));
    const onFailure = vi.fn();
    const ack = createAgentOutputAcknowledgement({
      taskId: "agt-1",
      workspaceId: "ws-1",
      isCurrent: () => true,
      acknowledge,
      onFailure,
    });
    ack.consumed(1);
    await vi.runAllTimersAsync();
    ack.consumed(2);
    await settle();
    expect(acknowledge).toHaveBeenCalledTimes(3);
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it("revalidates ownership after a failed invocation before retry or notice", async () => {
    vi.useFakeTimers();
    let current = true;
    const acknowledge = vi.fn().mockRejectedValue(new Error("disconnected"));
    const onFailure = vi.fn();
    const ack = createAgentOutputAcknowledgement({
      taskId: "agt-1",
      workspaceId: "ws-1",
      isCurrent: () => current,
      acknowledge,
      onFailure,
    });
    ack.consumed(1);
    await settle();
    current = false;
    await vi.runAllTimersAsync();
    expect(acknowledge).toHaveBeenCalledTimes(1);
    expect(onFailure).not.toHaveBeenCalled();
  });
});
