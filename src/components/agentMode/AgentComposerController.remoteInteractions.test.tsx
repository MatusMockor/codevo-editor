// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { AGENT_REMOTE_APPROVAL_READ_ONLY } from "../../application/agentThreadRequestResponders";
import {
  REMOTE_AGENT_THREAD_REQUEST_RESPOND_DEADLINE_MS,
  REMOTE_AGENT_THREAD_REQUEST_RESPOND_SETTLEMENT_MS,
  createRemoteAgentThreadRequestFeed,
  type RemoteAgentThreadRequestFeed,
} from "../../application/remoteAgentThreadRequestFeed";
import { AGENT_THREAD_REQUEST_RECONFIRM_MS } from "../../application/useAgentThreadRequestReconfirmation";
import { RemoteAgentThreadRequestNotSentError } from "../../application/remoteAgentThreadRequestPorts";
import {
  createUnifiedAgentThreadRequestFeed,
  type UnifiedAgentThreadRequestFeed,
} from "../../application/unifiedAgentThreadRequestFeed";
import {
  AGENT_REQUEST_NOT_ANSWERABLE,
  AGENT_REQUEST_NOT_DELIVERED,
  AGENT_REQUEST_NOT_SENT,
} from "../../application/agentThreadRequestDeliveryTransitions";
import type { AgentRuntimeRequest } from "../../domain/agentRuntimeRequest";
import type { RemoteRunnerReachability } from "../../domain/remoteRunnerReachability";
import {
  agentRuntimeRequestOf,
  agentThreadRequestFeedFake,
} from "../../test/agentThreadRequestFeedFake";
import {
  remoteAgentThreadRequestGatewayFake,
  type RemoteAgentThreadRequestGatewayFake,
} from "../../test/remoteAgentThreadRequestGatewayFake";
import {
  COMPOSER_REQUEST_CONVERSATION as CONVERSATION,
  COMPOSER_REQUEST_QUESTION_PROMPT as PROMPT,
  COMPOSER_REQUEST_SERVER as SERVER,
  COMPOSER_REQUEST_TURN as TURN,
  chooseComposerOption,
  composerApprovalPanel,
  composerButton,
  composerQuestionCard,
  localAnswerGatewayFake,
  remoteComposerExecution,
  remoteComposerThread,
} from "./agentComposerRequestTestFixtures";
import { ComposerWithRequests } from "./ComposerWithRequests";
import { AGENT_REQUEST_CHECKING } from "./composer/agentComposerInteraction";

const TARGET = { serverId: SERVER, threadId: CONVERSATION };
const RECONNECTING: RemoteRunnerReachability = { kind: "reconnecting" };
const MAX_SETTLE_ROUNDS = 400;
const OTHER_CONVERSATION = "0b8f0f5e-1c2d-4e3f-8a9b-000000000002";

async function elapse(milliseconds: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

async function waitForReact(assertion: () => void): Promise<void> {
  let failure: unknown = null;
  for (let round = 0; round < MAX_SETTLE_ROUNDS; round += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    try {
      assertion();
      return;
    } catch (error) {
      failure = error;
    }
  }
  expect(failure).toBeNull();
}

function question(): AgentRuntimeRequest {
  return agentRuntimeRequestOf("pendingQuestion", { turnId: TURN });
}

function resolvedQuestion(): AgentRuntimeRequest {
  return agentRuntimeRequestOf("resolvedQuestion", { id: "req-0001", turnId: TURN, version: 3 });
}

function view(
  reachability: RemoteRunnerReachability = { kind: "reachable" },
  sequence = 1,
): AgentThreadView {
  return remoteComposerThread(
    remoteComposerExecution(
      {
        requests: {
          source: "snapshot",
          approvals: true,
          sequences: { [TURN]: sequence },
          awaitingApproval: [],
        },
      },
      reachability,
    ),
  );
}

describe("composer cards of a remote thread from the thread request projection", () => {
  let host: HTMLDivElement;
  let root: Root;
  let gateway: RemoteAgentThreadRequestGatewayFake;
  let remote: RemoteAgentThreadRequestFeed;
  let feed: UnifiedAgentThreadRequestFeed;
  let consoleError: MockInstance<typeof console.error>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    gateway = remoteAgentThreadRequestGatewayFake();
    remote = createRemoteAgentThreadRequestFeed(gateway);
    feed = createUnifiedAgentThreadRequestFeed({ local: agentThreadRequestFeedFake(), remote });
    consoleError = vi.spyOn(console, "error");
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    expect(
      consoleError.mock.calls.filter((args) =>
        /Maximum update depth|Too many re-renders|not wrapped in act/.test(args.join(" ")),
      ),
    ).toEqual([]);
    host.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function render(thread: AgentThreadView): void {
    act(() =>
      root.render(
        <ComposerWithRequests feed={feed} gateway={localAnswerGatewayFake()} thread={thread} />,
      ),
    );
  }

  async function shownQuestion(): Promise<void> {
    gateway.record(TARGET, [question()]);
    render(view());
    await waitForReact(() => expect(host.textContent).toContain(PROMPT));
  }

  async function sendAnswer(): Promise<void> {
    act(() => chooseComposerOption(host, "Narrow"));
    await act(async () => composerButton(host, "Send answer")?.click());
  }

  it("answers a remote question through the feed and clears it when the projection settles it", async () => {
    await shownQuestion();
    gateway.respond.mockImplementationOnce(async () => {
      gateway.record(TARGET, [resolvedQuestion()]);
      return { outcome: "answered", message: null };
    });

    await sendAnswer();

    await waitForReact(() => expect(composerQuestionCard(host)).toBeNull());
    expect(gateway.respond).toHaveBeenCalledTimes(1);
    expect(gateway.respond.mock.calls[0]?.[0]).toMatchObject({
      serverId: SERVER,
      runnerId: "runner-1",
      threadId: CONVERSATION,
      requestId: "req-0001",
      turn: { turnId: TURN, interactionSequence: 1, terminal: false },
      response: {
        kind: "question",
        answers: [{ questionId: "scope", optionIds: ["narrow"], text: "" }],
      },
    });
  });

  it("keeps an answered card busy until the projection settles it", async () => {
    await shownQuestion();
    gateway.respond.mockResolvedValueOnce({ outcome: "answered", message: null });

    await sendAnswer();
    await waitForReact(() => expect(gateway.respond).toHaveBeenCalledTimes(1));
    await waitForReact(() => expect(gateway.threadRequests.mock.calls.length).toBeGreaterThan(1));

    expect(composerQuestionCard(host)?.getAttribute("aria-busy")).toBe("true");
    expect(composerButton(host, "Send answer")).toBeNull();
  });

  it("shows a question the server will no longer accept as not answerable", async () => {
    await shownQuestion();
    gateway.respond.mockResolvedValueOnce({ outcome: "notAnswerable", message: null });

    await sendAnswer();

    await waitForReact(() => expect(host.textContent).toContain(AGENT_REQUEST_NOT_ANSWERABLE));
    expect(composerQuestionCard(host)?.querySelector("fieldset")?.disabled).toBe(true);
    expect(gateway.respond).toHaveBeenCalledTimes(1);
  });

  it("re-enables the card when the server refused the answer before it was sent", async () => {
    await shownQuestion();
    gateway.respond.mockRejectedValueOnce(new RemoteAgentThreadRequestNotSentError("Offline."));

    await sendAnswer();

    await waitForReact(() => expect(host.textContent).toContain(AGENT_REQUEST_NOT_SENT));
    expect(composerButton(host, "Send answer")?.disabled).toBe(false);
  });

  it("asks again after an uncertain delivery that the next read shows was not delivered", async () => {
    await shownQuestion();
    gateway.respond.mockRejectedValueOnce(new Error("Tunnel closed after the request was sent."));

    await sendAnswer();

    await waitForReact(() => expect(host.textContent).toContain(AGENT_REQUEST_NOT_DELIVERED));
    expect(composerButton(host, "Send answer")?.disabled).toBe(false);
    expect(gateway.respond).toHaveBeenCalledTimes(1);
  });

  it("clears the card after an uncertain delivery that the next read shows was settled", async () => {
    await shownQuestion();
    gateway.respond.mockImplementationOnce(async () => {
      gateway.record(TARGET, [resolvedQuestion()]);
      throw new Error("Tunnel closed after the request was sent.");
    });

    await sendAnswer();

    await waitForReact(() => expect(composerQuestionCard(host)).toBeNull());
    expect(host.textContent).not.toContain(AGENT_REQUEST_NOT_DELIVERED);
  });

  it("re-enables a card whose uncertain delivery could not be confirmed once a read after reconnect shows it still pending", async () => {
    await shownQuestion();
    const reopen = gateway.holdReads();
    gateway.respond.mockRejectedValueOnce(new Error("Tunnel closed after the request was sent."));

    await sendAnswer();
    await waitForReact(() => expect(gateway.respond).toHaveBeenCalledTimes(1));
    await waitForReact(() => expect(host.textContent).toContain(AGENT_REQUEST_CHECKING));

    render(view(RECONNECTING));
    await act(async () => reopen());
    expect(host.textContent).toContain(AGENT_REQUEST_CHECKING);
    render(view());

    await waitForReact(() => expect(host.textContent).toContain(AGENT_REQUEST_NOT_DELIVERED));
    expect(host.textContent).not.toContain(AGENT_REQUEST_CHECKING);
    act(() => chooseComposerOption(host, "Narrow"));
    expect(composerButton(host, "Send answer")?.disabled).toBe(false);
    expect(gateway.respond).toHaveBeenCalledTimes(1);
  });

  it("keeps an uncertain card locked while its send may still execute and releases it after the backend ceiling", async () => {
    await shownQuestion();
    gateway.respond.mockReturnValueOnce(new Promise(() => undefined));

    await sendAnswer();
    await elapse(REMOTE_AGENT_THREAD_REQUEST_RESPOND_DEADLINE_MS);
    await waitForReact(() => expect(host.textContent).toContain(AGENT_REQUEST_CHECKING));
    await elapse(REMOTE_AGENT_THREAD_REQUEST_RESPOND_SETTLEMENT_MS / 2);
    expect(host.textContent).toContain(AGENT_REQUEST_CHECKING);
    expect(composerButton(host, "Send answer")).toBeNull();

    await elapse(REMOTE_AGENT_THREAD_REQUEST_RESPOND_SETTLEMENT_MS);

    await waitForReact(() => expect(host.textContent).toContain(AGENT_REQUEST_NOT_DELIVERED));
    expect(gateway.respond).toHaveBeenCalledTimes(1);
  });

  it("keeps the delivery lock across a switch to another remote thread and back", async () => {
    await shownQuestion();
    gateway.respond.mockReturnValueOnce(new Promise(() => undefined));
    await sendAnswer();
    await elapse(REMOTE_AGENT_THREAD_REQUEST_RESPOND_DEADLINE_MS);
    await waitForReact(() => expect(host.textContent).toContain(AGENT_REQUEST_CHECKING));

    render(remoteComposerThread(remoteComposerExecution({ conversationId: OTHER_CONVERSATION })));
    expect(host.textContent).not.toContain(PROMPT);
    await waitForReact(() =>
      expect(
        gateway.readsOf({ serverId: SERVER, threadId: OTHER_CONVERSATION }).length,
      ).toBeGreaterThan(0),
    );
    const readsBefore = gateway.readsOf(TARGET).length;
    render(view());
    await waitForReact(() => expect(gateway.readsOf(TARGET).length).toBeGreaterThan(readsBefore));
    await waitForReact(() => expect(host.textContent).toContain(PROMPT));
    await elapse(AGENT_THREAD_REQUEST_RECONFIRM_MS);

    expect(host.textContent).toContain(AGENT_REQUEST_CHECKING);
    expect(composerButton(host, "Send answer")).toBeNull();
    expect(gateway.respond).toHaveBeenCalledTimes(1);
  });

  it("puts an answerable remote question before a read-only remote approval", async () => {
    gateway.record(TARGET, [
      agentRuntimeRequestOf("pendingApproval", { turnId: TURN }),
      question(),
    ]);

    render(view());

    await waitForReact(() => expect(host.textContent).toContain(PROMPT));
    expect(composerApprovalPanel(host)).toBeNull();
    act(() => chooseComposerOption(host, "Narrow"));
    expect(composerButton(host, "Send answer")?.disabled).toBe(false);
  });

  it("keeps cards visible with disabled controls and no extra notice while the server is unreachable", async () => {
    await shownQuestion();
    const before = host.textContent ?? "";

    render(view(RECONNECTING));

    expect(host.textContent).toContain(PROMPT);
    expect(composerQuestionCard(host)?.querySelector("fieldset")?.disabled).toBe(true);
    expect(composerButton(host, "Send answer")?.disabled).toBe(true);
    expect(composerQuestionCard(host)?.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).not.toContain("could not be refreshed");
    expect(host.textContent?.length).toBe(before.length);
    expect(gateway.respond).not.toHaveBeenCalled();

    render(view());
    act(() => chooseComposerOption(host, "Narrow"));
    expect(composerButton(host, "Send answer")?.disabled).toBe(false);
  });

  it("renders a remote approval card read-only with a truthful sentence", async () => {
    gateway.record(TARGET, [agentRuntimeRequestOf("pendingApproval", { turnId: TURN })]);

    render(view());

    await waitForReact(() => expect(composerApprovalPanel(host)).not.toBeNull());
    expect(host.textContent).toContain("Run the test suite");
    expect(host.textContent).toContain(AGENT_REMOTE_APPROVAL_READ_ONLY);
    expect(composerButton(host, "Approve")).toBeNull();
    expect(composerButton(host, "Decline")).toBeNull();
    expect(gateway.respond).not.toHaveBeenCalled();
  });

  it("describes the open thread, releases it on unmount and tells the feed when its server is back", async () => {
    const describe = vi.spyOn(remote, "describe");
    const release = vi.spyOn(remote, "release");
    const reconnected = vi.spyOn(remote, "reconnected");
    const lastDescription = () => describe.mock.calls[describe.mock.calls.length - 1]?.[1];
    await shownQuestion();
    expect(describe.mock.calls[0]?.[1]).toEqual({
      source: "snapshot",
      reachable: true,
      turns: [
        {
          turnId: TURN,
          startedAtEpochMs: 1_760_000_000_000,
          interactionSequence: 1,
          terminal: false,
        },
      ],
      awaiting: [],
    });

    render(view(RECONNECTING));
    expect(lastDescription()).toMatchObject({ reachable: false });
    expect(reconnected).not.toHaveBeenCalled();
    render(view({ kind: "reachable" }, 2));
    expect(lastDescription()).toMatchObject({
      reachable: true,
      turns: [{ turnId: TURN, interactionSequence: 2 }],
    });
    expect(reconnected).toHaveBeenCalledWith(SERVER);
    expect(release).not.toHaveBeenCalled();

    act(() => root.unmount());
    root = createRoot(host);
    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.calls[0]?.[0]).toEqual(describe.mock.calls[0]?.[0]);
  });
});
