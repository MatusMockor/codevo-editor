// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTurnRetryReadyPlan } from "../domain/agentTurnRetry";
import type { AgentFollowUpRequest, AgentThreadView } from "./agentThreadPorts";
import {
  RETRY_FAILED_MESSAGE,
  RETRY_NOT_STARTED_MESSAGE,
  useAgentTurnRetry,
  type AgentTurnRetrySurface,
} from "./useAgentTurnRetry";

type SendFollowUp = (request: AgentFollowUpRequest) => Promise<boolean>;

function failedView(
  turnIds: ReadonlyArray<string>,
  options: { readonly running?: boolean; readonly archived?: boolean } = {},
): AgentThreadView {
  return {
    thread: {
      threadId: "agt-1",
      archived: options.archived ?? false,
      provider: { kind: "claudeCode" },
      turns: turnIds.map((turnId, index) => ({
        turnId,
        prompt: "p",
        status:
          options.running === true && index === turnIds.length - 1
            ? { kind: "running" }
            : { kind: "failed", message: "boom" },
      })),
    },
  } as unknown as AgentThreadView;
}

const plan = {
  kind: "ready",
  threadId: "agt-1",
  failedTurnId: "t1",
  prompt: "p",
  launch: { provider: "claudeCode" },
  source: "stored",
  dangerous: false,
} as unknown as AgentTurnRetryReadyPlan;
const dangerousPlan = { ...plan, dangerous: true } as AgentTurnRetryReadyPlan;

let host: HTMLDivElement;
let root: Root;
let latest: AgentTurnRetrySurface | null = null;

function Probe({
  sendFollowUp,
  threads,
}: {
  readonly sendFollowUp: SendFollowUp;
  readonly threads: ReadonlyArray<AgentThreadView>;
}) {
  latest = useAgentTurnRetry({ threads, sendFollowUp });
  return null;
}

function surface(): AgentTurnRetrySurface {
  expect(latest).not.toBeNull();
  return latest as AgentTurnRetrySurface;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  root = createRoot(host);
  latest = null;
});

afterEach(() => act(() => root.unmount()));

describe("useAgentTurnRetry", () => {
  it("sends exactly once even when pressed twice", async () => {
    let resolve: (value: boolean) => void = () => undefined;
    const sendFollowUp = vi.fn<SendFollowUp>(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    );
    act(() => root.render(<Probe sendFollowUp={sendFollowUp} threads={[failedView(["t1"])]} />));
    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = surface().retry(plan);
      void surface().retry(plan);
    });
    expect(surface().pendingTurnId).toBe("t1");
    await act(async () => {
      resolve(true);
      await first;
    });
    expect(sendFollowUp).toHaveBeenCalledTimes(1);
    expect(sendFollowUp).toHaveBeenCalledWith({
      threadId: "agt-1",
      prompt: "p",
      launch: { provider: "claudeCode" },
    });
    expect(surface().pendingTurnId).toBeNull();
  });

  it("does not resend a failed turn that was already retried before the store caught up", async () => {
    const sendFollowUp = vi.fn<SendFollowUp>(async () => true);
    act(() => root.render(<Probe sendFollowUp={sendFollowUp} threads={[failedView(["t1"])]} />));
    await act(() => surface().retry(plan));
    await act(() => surface().retry(plan));
    expect(sendFollowUp).toHaveBeenCalledTimes(1);
  });

  it("allows another attempt when the send was refused or threw", async () => {
    const sendFollowUp = vi
      .fn<SendFollowUp>()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("ipc"))
      .mockResolvedValueOnce(true);
    act(() => root.render(<Probe sendFollowUp={sendFollowUp} threads={[failedView(["t1"])]} />));
    await act(() => surface().retry(plan));
    await act(() => surface().retry(plan));
    expect(surface().pendingTurnId).toBeNull();
    await act(() => surface().retry(plan));
    expect(sendFollowUp).toHaveBeenCalledTimes(3);
  });

  it("never sends a dangerous plan without explicit confirmation and forwards it once given", async () => {
    const sendFollowUp = vi.fn<SendFollowUp>(async () => true);
    act(() => root.render(<Probe sendFollowUp={sendFollowUp} threads={[failedView(["t1"])]} />));
    await act(() => surface().retry(dangerousPlan));
    expect(sendFollowUp).not.toHaveBeenCalled();
    await act(() => surface().retry(dangerousPlan, true));
    expect(sendFollowUp).toHaveBeenCalledWith({
      threadId: "agt-1",
      prompt: "p",
      launch: { provider: "claudeCode" },
      dangerousLaunchConfirmed: true,
    });
  });

  it("reports a visible failure when the send throws or is refused and clears it on success", async () => {
    const sendFollowUp = vi
      .fn<SendFollowUp>()
      .mockRejectedValueOnce(new Error("ipc"))
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    act(() => root.render(<Probe sendFollowUp={sendFollowUp} threads={[failedView(["t1"])]} />));
    expect(surface().failure).toBeNull();
    await act(() => surface().retry(plan));
    expect(surface().failure).toEqual({ failedTurnId: "t1", message: RETRY_FAILED_MESSAGE });
    await act(() => surface().retry(plan));
    expect(surface().failure).toEqual({ failedTurnId: "t1", message: RETRY_NOT_STARTED_MESSAGE });
    await act(() => surface().retry(plan));
    expect(surface().failure).toBeNull();
  });

  it("does not send when a newer turn exists, the thread is running, archived or gone", async () => {
    const sendFollowUp = vi.fn<SendFollowUp>(async () => true);
    act(() =>
      root.render(<Probe sendFollowUp={sendFollowUp} threads={[failedView(["t1", "t2"])]} />),
    );
    await act(() => surface().retry(plan));
    act(() =>
      root.render(
        <Probe sendFollowUp={sendFollowUp} threads={[failedView(["t1"], { running: true })]} />,
      ),
    );
    await act(() => surface().retry(plan));
    act(() =>
      root.render(
        <Probe
          sendFollowUp={sendFollowUp}
          threads={[failedView(["t1", "t2"], { running: true })]}
        />,
      ),
    );
    await act(() => surface().retry(plan));
    act(() =>
      root.render(
        <Probe sendFollowUp={sendFollowUp} threads={[failedView(["t1"], { archived: true })]} />,
      ),
    );
    await act(() => surface().retry(plan));
    act(() => root.render(<Probe sendFollowUp={sendFollowUp} threads={[]} />));
    await act(() => surface().retry(plan));
    expect(sendFollowUp).not.toHaveBeenCalled();
    expect(surface().pendingTurnId).toBeNull();
  });
});
