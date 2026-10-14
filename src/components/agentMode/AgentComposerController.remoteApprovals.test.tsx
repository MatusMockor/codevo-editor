// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  AGENT_REQUEST_NOT_ANSWERABLE,
  AGENT_REQUEST_NOT_DELIVERED,
  AGENT_REQUEST_NOT_SENT,
} from "../../application/agentThreadRequestDeliveryTransitions";
import {
  createRemoteAgentThreadRequestFeed,
  type RemoteAgentThreadRequestFeed,
} from "../../application/remoteAgentThreadRequestFeed";
import { RemoteAgentThreadRequestNotSentError } from "../../application/remoteAgentThreadRequestPorts";
import {
  createUnifiedAgentThreadRequestFeed,
  type UnifiedAgentThreadRequestFeed,
} from "../../application/unifiedAgentThreadRequestFeed";
import type { AgentApprovalDecision } from "../../domain/agentApproval";
import type { AgentRuntimeRequest } from "../../domain/agentRuntimeRequest";
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
  COMPOSER_REQUEST_SERVER as SERVER,
  COMPOSER_REQUEST_TURN as TURN,
  composerApprovalPanel,
  composerButton,
  localAnswerGatewayFake,
  remoteComposerExecution,
  remoteComposerThread,
} from "./agentComposerRequestTestFixtures";
import { ComposerWithRequests } from "./ComposerWithRequests";

const TARGET = { serverId: SERVER, threadId: CONVERSATION };
const MAX_SETTLE_ROUNDS = 400;
const REQUEST_ID = "req-0002";
const UNCERTAIN = "Tunnel closed after the request was sent.";

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

function pendingApproval(decisions?: readonly AgentApprovalDecision[]): AgentRuntimeRequest {
  const base = agentRuntimeRequestOf("pendingApproval", { turnId: TURN });
  if (decisions === undefined) return base;
  return agentRuntimeRequestOf("pendingApproval", {
    turnId: TURN,
    body: { ...base.body, decisions },
  });
}

function settledApproval(decision: AgentApprovalDecision): AgentRuntimeRequest {
  return agentRuntimeRequestOf("resolvedApproval", {
    id: REQUEST_ID,
    turnId: TURN,
    provider: "claudeCode",
    body: pendingApproval().body,
    version: 3,
    createdAtEpochMs: 1_760_000_001_000,
    resolvedAtEpochMs: 1_760_000_002_000,
    resolution: { kind: "decision", decision },
  });
}

function timedOutApproval(): AgentRuntimeRequest {
  return agentRuntimeRequestOf("timedOutApproval", {
    id: REQUEST_ID,
    turnId: TURN,
    version: 3,
    createdAtEpochMs: 1_760_000_001_000,
    resolvedAtEpochMs: 1_760_000_601_000,
  });
}

function view(sequence = 1): AgentThreadView {
  return remoteComposerThread(
    remoteComposerExecution({
      requests: {
        source: "snapshot",
        approvals: true,
        sequences: { [TURN]: sequence },
        awaitingApproval: [],
      },
    }),
  );
}

function moreOptions(host: HTMLElement): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>('button[aria-label="More approval options"]');
}

function menuItem(name: string): HTMLButtonElement | null {
  return (
    [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (candidate) => candidate.textContent === name,
    ) ?? null
  );
}

describe("composer approval cards of a remote thread", () => {
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

  async function shownApproval(request: AgentRuntimeRequest = pendingApproval()): Promise<void> {
    gateway.record(TARGET, [request]);
    render(view());
    await waitForReact(() => expect(composerButton(host, "Approve")?.disabled).toBe(false));
  }

  function press(decision: AgentApprovalDecision): void {
    switch (decision) {
      case "allowOnce":
        composerButton(host, "Approve")?.click();
        return;
      case "deny":
        composerButton(host, "Decline")?.click();
        return;
      case "allowForSession":
        menuItem("Approve for this turn")?.click();
        return;
      default: {
        const exhaustive: never = decision;
        return exhaustive;
      }
    }
  }

  async function decide(decision: AgentApprovalDecision): Promise<void> {
    if (decision === "allowForSession") act(() => moreOptions(host)?.click());
    await act(async () => {
      press(decision);
      press(decision);
    });
  }

  it.each<AgentApprovalDecision>(["allowOnce", "allowForSession", "deny"])(
    "sends the offered decision %s once through the feed and clears the card when the projection settles it",
    async (decision) => {
      await shownApproval();
      gateway.respond.mockImplementationOnce(async () => {
        gateway.record(TARGET, [settledApproval(decision)]);
        return { outcome: "answered", message: null };
      });

      await decide(decision);

      await waitForReact(() => expect(composerApprovalPanel(host)).toBeNull());
      expect(gateway.respond).toHaveBeenCalledTimes(1);
      expect(gateway.respond.mock.calls[0]?.[0]).toEqual({
        serverId: SERVER,
        runnerId: "runner-1",
        threadId: CONVERSATION,
        turn: {
          turnId: TURN,
          startedAtEpochMs: 1_760_000_000_000,
          interactionSequence: 1,
          terminal: false,
        },
        requestId: REQUEST_ID,
        response: { kind: "approval", decision },
      });
    },
  );

  it("says that the wider grant lasts for this turn", async () => {
    await shownApproval();

    act(() => moreOptions(host)?.click());

    expect(menuItem("Approve for this turn")).not.toBeNull();
    expect(document.body.textContent).not.toContain("for this session");
    expect(gateway.respond).not.toHaveBeenCalled();
  });

  it("offers only the decisions the request carries", async () => {
    await shownApproval(pendingApproval(["allowOnce", "deny"]));

    expect(composerButton(host, "Decline")?.disabled).toBe(false);
    expect(moreOptions(host)).toBeNull();
    expect(gateway.respond).not.toHaveBeenCalled();
  });

  it("keeps a decided card busy until the projection settles it", async () => {
    await shownApproval();
    gateway.respond.mockResolvedValueOnce({ outcome: "answered", message: null });

    await decide("allowOnce");
    await waitForReact(() => expect(gateway.respond).toHaveBeenCalledTimes(1));
    await waitForReact(() => expect(gateway.threadRequests.mock.calls.length).toBeGreaterThan(1));

    expect(composerApprovalPanel(host)?.getAttribute("aria-busy")).toBe("true");
    expect(composerButton(host, "Approve")?.disabled).toBe(true);
    expect(gateway.respond).toHaveBeenCalledTimes(1);
  });

  it("shows an approval the server will no longer accept as not answerable", async () => {
    await shownApproval();
    gateway.respond.mockResolvedValueOnce({ outcome: "notAnswerable", message: null });

    await decide("deny");

    await waitForReact(() => expect(host.textContent).toContain(AGENT_REQUEST_NOT_ANSWERABLE));
    expect(composerButton(host, "Approve")).toBeNull();
    expect(composerButton(host, "Decline")).toBeNull();
    expect(gateway.respond).toHaveBeenCalledTimes(1);
  });

  it("re-enables the card when the decision was not sent", async () => {
    await shownApproval();
    gateway.respond.mockRejectedValueOnce(new RemoteAgentThreadRequestNotSentError("Offline."));

    await decide("allowOnce");

    await waitForReact(() => expect(host.textContent).toContain(AGENT_REQUEST_NOT_SENT));
    expect(composerButton(host, "Approve")?.disabled).toBe(false);
    expect(gateway.respond).toHaveBeenCalledTimes(1);
  });

  it("asks again after an uncertain delivery that the next read shows was not delivered", async () => {
    await shownApproval();
    gateway.respond.mockRejectedValueOnce(new Error(UNCERTAIN));

    await decide("allowOnce");

    await waitForReact(() => expect(host.textContent).toContain(AGENT_REQUEST_NOT_DELIVERED));
    expect(composerButton(host, "Approve")?.disabled).toBe(false);
    expect(gateway.respond).toHaveBeenCalledTimes(1);
  });

  it("clears the card after an uncertain delivery that the next read shows was settled", async () => {
    await shownApproval();
    gateway.respond.mockImplementationOnce(async () => {
      gateway.record(TARGET, [settledApproval("deny")]);
      return Promise.reject(new Error(UNCERTAIN));
    });

    await decide("deny");

    await waitForReact(() => expect(composerApprovalPanel(host)).toBeNull());
    expect(host.textContent).not.toContain(AGENT_REQUEST_NOT_DELIVERED);
    expect(gateway.respond).toHaveBeenCalledTimes(1);
  });

  it("drops the card when the runner times the approval out, without a client timer", async () => {
    await shownApproval();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000);
    });
    expect(composerButton(host, "Approve")?.disabled).toBe(false);

    gateway.record(TARGET, [timedOutApproval()]);
    render(view(2));

    await waitForReact(() => expect(composerApprovalPanel(host)).toBeNull());
    expect(gateway.respond).not.toHaveBeenCalled();
  });
});
