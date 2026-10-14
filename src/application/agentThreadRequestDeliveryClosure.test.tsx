// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentApprovalGateway } from "./agentApprovalPorts";
import type { AgentQuestionGateway } from "./agentQuestionPorts";
import { AgentThreadRequestDeliveryLedger } from "./agentThreadRequestDeliveryLedger";
import type { AgentThreadRequestScope } from "./agentThreadRequestPorts";
import {
  localAgentThreadRequestResponder,
  type AgentThreadRequestResponder,
} from "./agentThreadRequestResponders";
import {
  agentThreadPendingRequestKey,
  useAgentThreadPendingRequests,
  type AgentThreadPendingRequests,
} from "./useAgentThreadPendingRequests";
import {
  useAgentThreadRuntimeRequests,
  type AgentThreadRuntimeRequests,
} from "./useAgentThreadRuntimeRequests";
import { parseAgentQuestionRequest } from "../domain/agentQuestion";
import {
  MAX_AGENT_THREAD_REQUESTS_PER_MESSAGE,
  MAX_AGENT_THREAD_REQUESTS_RETAINED,
  type AgentRuntimeRequest,
} from "../domain/agentRuntimeRequest";
import {
  agentRuntimeRequestOf,
  agentThreadRequestFeedFake,
  agentThreadRequestsOf,
  type AgentThreadRequestFeedFake,
} from "../test/agentThreadRequestFeedFake";

const WORKSPACE = "agent-root:app";
const TURN = "agt-turn-0001";
const OWNER = "owner-a";
const SCOPE: AgentThreadRequestScope = {
  rootKey: "/workspace/app",
  ownerId: WORKSPACE,
  threadId: "agt-thread-0001",
  workspaceId: WORKSPACE,
};
const TURNS: readonly string[] = [TURN];
const ANSWER = {
  kind: "question",
  answers: [{ questionId: "scope", optionIds: ["narrow"], text: "" }],
} as const;
const MAX_SETTLE_ROUNDS = 50;

function answered() {
  return parseAgentQuestionRequest({
    id: "req-0001",
    taskId: TURN,
    provider: "codex",
    status: "answered",
    questions: [
      {
        id: "scope",
        header: "",
        prompt: "Which?",
        multiple: false,
        allowCustom: true,
        options: [{ id: "narrow", label: "Narrow", description: "" }],
      },
    ],
    answers: ANSWER.answers,
  });
}

function asked(): AgentRuntimeRequest {
  return agentRuntimeRequestOf("pendingQuestion", { turnId: TURN, order: 0 });
}

function newerQuestions(from: number, count: number): readonly AgentRuntimeRequest[] {
  return Array.from({ length: count }, (_unused, index) =>
    agentRuntimeRequestOf("pendingQuestion", {
      id: `req-${String(from + index).padStart(5, "0")}`,
      turnId: TURN,
      order: from + index,
      createdAtEpochMs: 1_760_000_000_000 + from + index,
    }),
  );
}

describe("delivery locks against the thread request projection", () => {
  let host: HTMLDivElement;
  let root: Root;
  let feed: AgentThreadRequestFeedFake;
  let ledger: AgentThreadRequestDeliveryLedger;
  let requests: AgentThreadRuntimeRequests | null;
  let pending: AgentThreadPendingRequests | null;
  let gateway: AgentQuestionGateway & AgentApprovalGateway;
  let responder: AgentThreadRequestResponder;

  beforeEach(() => {
    gateway = {
      answer: vi.fn<AgentQuestionGateway["answer"]>(() => Promise.resolve(answered())),
      answerApproval: vi.fn<AgentApprovalGateway["answerApproval"]>(),
    };
    responder = localAgentThreadRequestResponder(gateway, WORKSPACE);
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    feed = agentThreadRequestFeedFake();
    ledger = new AgentThreadRequestDeliveryLedger();
    requests = null;
    pending = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function Probe() {
    const observed = useAgentThreadRuntimeRequests(feed, SCOPE, TURNS);
    requests = observed;
    pending = useAgentThreadPendingRequests({
      ledger,
      ownerKey: OWNER,
      open: observed.open,
      closure: observed.closure,
      responder,
      reachable: true,
    });
    return null;
  }

  async function settle(assertion: () => void): Promise<void> {
    let failure: unknown = null;
    for (let round = 0; round < MAX_SETTLE_ROUNDS; round += 1) {
      await act(async () => {
        await Promise.resolve();
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

  function openIds(): readonly string[] {
    return (requests?.open ?? []).map((request) => request.id);
  }

  function lock(): string | null {
    return ledger.record(OWNER, agentThreadPendingRequestKey(asked()))?.kind ?? null;
  }

  async function answeredAndAwaiting(): Promise<{ readonly settled: () => string }> {
    feed.record(agentThreadRequestsOf(SCOPE, [asked()]));
    act(() => root.render(<Probe />));
    await settle(() => expect(openIds()).toEqual(["req-0001"]));
    let outcome = "pending";
    await act(async () => {
      void pending?.respond(agentThreadPendingRequestKey(asked()), ANSWER).then(
        () => {
          outcome = "resolved";
        },
        (error: Error) => {
          outcome = `rejected: ${error.message}`;
        },
      );
    });
    await settle(() => expect(lock()).toBe("awaiting"));
    return { settled: () => outcome };
  }

  it("keeps the lock when retention evicts the open request from a covered turn", async () => {
    const sent = await answeredAndAwaiting();
    const batches = MAX_AGENT_THREAD_REQUESTS_RETAINED / MAX_AGENT_THREAD_REQUESTS_PER_MESSAGE;

    for (let batch = 0; batch < batches; batch += 1) {
      const from = 1 + batch * MAX_AGENT_THREAD_REQUESTS_PER_MESSAGE;
      act(() =>
        feed.push(
          agentThreadRequestsOf(SCOPE, newerQuestions(from, MAX_AGENT_THREAD_REQUESTS_PER_MESSAGE)),
        ),
      );
    }
    await settle(() => expect(openIds()).not.toContain("req-0001"));

    expect(requests?.coveredTurnIds.has(TURN)).toBe(true);
    expect(requests?.gaps.incomplete).toBe(true);
    expect(lock()).toBe("awaiting");
    expect(sent.settled()).toBe("pending");
    expect(gateway.answer).toHaveBeenCalledTimes(1);
  });

  it("keeps the lock when an epoch reset is followed by a truncated read that omits the request", async () => {
    const sent = await answeredAndAwaiting();

    feed.record(agentThreadRequestsOf(SCOPE, [], { epoch: "boot-0002", truncated: true }));
    act(() => feed.invalidate("boot-0002"));
    await settle(() => expect(feed.currentThreadRequests.mock.calls.length).toBeGreaterThan(1));
    await settle(() => expect(requests?.coveredTurnIds.has(TURN)).toBe(true));

    expect(openIds()).toEqual([]);
    expect(lock()).toBe("awaiting");
    expect(sent.settled()).toBe("pending");

    feed.record(agentThreadRequestsOf(SCOPE, [], { epoch: "boot-0003" }));
    act(() => feed.invalidate("boot-0003"));

    await settle(() => expect(lock()).toBeNull());
    expect(sent.settled()).toBe("resolved");
  });

  it("clears the lock on an explicit terminal record of the request", async () => {
    const sent = await answeredAndAwaiting();
    const resolved = agentRuntimeRequestOf("resolvedQuestion", {
      id: "req-0001",
      turnId: TURN,
      version: 3,
    });

    act(() => feed.push(agentThreadRequestsOf(SCOPE, [resolved], { truncated: true })));

    await settle(() => expect(lock()).toBeNull());
    expect(sent.settled()).toBe("resolved");
  });
});
