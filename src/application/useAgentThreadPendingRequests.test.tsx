// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRuntimeRequest } from "../domain/agentRuntimeRequest";
import { agentRuntimeRequestOf } from "../test/agentThreadRequestFeedFake";
import { remoteAgentThreadRequestScopeOf } from "../test/remoteAgentThreadRequestGatewayFake";
import {
  AGENT_REMOTE_APPROVAL_READ_ONLY,
  localAgentThreadRequestResponder,
  remoteAgentThreadRequestResponder,
  type AgentThreadRequestResponder,
} from "./agentThreadRequestResponders";
import type {
  RemoteAgentThreadRequestConfirmation,
  RemoteAgentThreadRequestRespondOutcome,
} from "./remoteAgentThreadRequestFeed";
import type { RemoteAgentThreadRequestControl } from "./unifiedAgentThreadRequestFeed";
import { AgentThreadRequestDeliveryLedger } from "./agentThreadRequestDeliveryLedger";
import { AGENT_THREAD_REQUEST_RECONFIRM_MS } from "./useAgentThreadRequestReconfirmation";
import {
  AGENT_REQUEST_NOT_ANSWERABLE,
  AGENT_REQUEST_NOT_DELIVERED,
  AGENT_REQUEST_NOT_SENT,
} from "./agentThreadRequestDeliveryTransitions";
import {
  AGENT_REQUEST_NOT_LIVE,
  useAgentThreadPendingRequests,
  type AgentThreadPendingRequests,
  type AgentThreadPendingRequestsInput,
} from "./useAgentThreadPendingRequests";

const TURN = "agt-turn-0001";
const KEY = `${TURN}/req-0001`;
const SCOPE = remoteAgentThreadRequestScopeOf("srv-a", "0b8f0f5e-1c2d-4e3f-8a9b-000000000001");
const ANSWER = {
  kind: "question",
  answers: [{ questionId: "scope", optionIds: ["narrow"], text: "" }],
} as const;

function question(version = 1): AgentRuntimeRequest {
  return agentRuntimeRequestOf("pendingQuestion", { turnId: TURN, version });
}

interface ControlFake extends RemoteAgentThreadRequestControl {
  readonly respond: ReturnType<typeof vi.fn<RemoteAgentThreadRequestControl["respond"]>>;
  readonly confirm: ReturnType<typeof vi.fn<RemoteAgentThreadRequestControl["confirm"]>>;
}

const COVERED: ReadonlySet<string> = new Set([TURN]);
const UNCOVERED: ReadonlySet<string> = new Set();

function controlFake(): ControlFake {
  return {
    describe: vi.fn(() => ({ kind: "tracked" }) as const),
    release: vi.fn(),
    reconnected: vi.fn(),
    respond: vi.fn<RemoteAgentThreadRequestControl["respond"]>(),
    confirm: vi.fn<RemoteAgentThreadRequestControl["confirm"]>(() =>
      Promise.resolve("unconfirmed"),
    ),
  };
}

describe("useAgentThreadPendingRequests", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: AgentThreadPendingRequests | null;
  let ledger: AgentThreadRequestDeliveryLedger;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    latest = null;
    ledger = new AgentThreadRequestDeliveryLedger();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function Probe(props: AgentThreadPendingRequestsInput) {
    latest = useAgentThreadPendingRequests(props);
    return null;
  }

  function render(
    input: Partial<AgentThreadPendingRequestsInput> & {
      readonly responder: AgentThreadRequestResponder | null;
    },
  ): void {
    act(() =>
      root.render(
        <Probe
          covered={COVERED}
          ledger={ledger}
          ownerKey="owner-a"
          open={[question()]}
          reachable
          {...input}
        />,
      ),
    );
  }

  function current(): AgentThreadPendingRequests {
    expect(latest).not.toBeNull();
    return latest ?? { items: [], respond: () => Promise.resolve() };
  }

  function first() {
    return current().items[0];
  }

  async function answer(): Promise<{ readonly settled: () => string }> {
    let outcome = "pending";
    await act(async () => {
      void current()
        .respond(KEY, ANSWER)
        .then(
          () => {
            outcome = "resolved";
          },
          (error: Error) => {
            outcome = `rejected: ${error.message}`;
          },
        );
    });
    await act(async () => Promise.resolve());
    return { settled: () => outcome };
  }

  it("keeps identities stable while nothing changes", () => {
    const open = [question()];
    const responder = remoteAgentThreadRequestResponder(controlFake(), SCOPE);
    render({ open, responder });
    const before = current();

    render({ open, responder });

    expect(current()).toBe(before);
    expect(first()?.state).toEqual({ kind: "answerable" });
  });

  it.each<{
    readonly name: string;
    readonly outcome: RemoteAgentThreadRequestRespondOutcome;
    readonly state: string;
    readonly error: string | null;
    readonly settled: string;
  }>([
    {
      name: "answered",
      outcome: { kind: "answered" },
      state: "sending",
      error: null,
      settled: "pending",
    },
    {
      name: "notAnswerable",
      outcome: { kind: "notAnswerable" },
      state: "readOnly",
      error: null,
      settled: `rejected: ${AGENT_REQUEST_NOT_ANSWERABLE}`,
    },
    {
      name: "notSent/refused",
      outcome: { kind: "notSent", reason: "refused" },
      state: "answerable",
      error: AGENT_REQUEST_NOT_SENT,
      settled: `rejected: ${AGENT_REQUEST_NOT_SENT}`,
    },
    {
      name: "notSent/busy",
      outcome: { kind: "notSent", reason: "busy" },
      state: "answerable",
      error: AGENT_REQUEST_NOT_SENT,
      settled: `rejected: ${AGENT_REQUEST_NOT_SENT}`,
    },
    {
      name: "notSent/notDescribed",
      outcome: { kind: "notSent", reason: "notDescribed" },
      state: "answerable",
      error: AGENT_REQUEST_NOT_SENT,
      settled: `rejected: ${AGENT_REQUEST_NOT_SENT}`,
    },
    {
      name: "notSent/unreachable",
      outcome: { kind: "notSent", reason: "unreachable" },
      state: "answerable",
      error: null,
      settled: `rejected: ${AGENT_REQUEST_NOT_SENT}`,
    },
    {
      name: "notSent/alreadySending",
      outcome: { kind: "notSent", reason: "alreadySending" },
      state: "checking",
      error: null,
      settled: "pending",
    },
  ])("maps the remote outcome $name", async ({ outcome, state, error, settled }) => {
    const control = controlFake();
    control.respond.mockResolvedValue(outcome);
    render({ responder: remoteAgentThreadRequestResponder(control, SCOPE) });

    const sent = await answer();

    expect(control.respond).toHaveBeenCalledWith(SCOPE, TURN, "req-0001", ANSWER);
    expect(first()?.state.kind).toBe(state);
    expect(first()?.error).toBe(error);
    expect(sent.settled()).toBe(settled);
  });

  it.each<{
    readonly confirmation: RemoteAgentThreadRequestConfirmation;
    readonly state: string;
    readonly error: string | null;
    readonly settled: string;
  }>([
    {
      confirmation: "pending",
      state: "answerable",
      error: AGENT_REQUEST_NOT_DELIVERED,
      settled: `rejected: ${AGENT_REQUEST_NOT_DELIVERED}`,
    },
    { confirmation: "settled", state: "sending", error: null, settled: "pending" },
    { confirmation: "unconfirmed", state: "checking", error: null, settled: "pending" },
  ])(
    "checks an uncertain delivery whose confirmation is $confirmation",
    async ({ confirmation, state, error, settled }) => {
      const control = controlFake();
      let confirm: (value: RemoteAgentThreadRequestConfirmation) => void = () => undefined;
      control.respond.mockResolvedValue({
        kind: "deliveryUncertain",
        confirmation: new Promise((resolve) => {
          confirm = resolve;
        }),
      });
      render({ responder: remoteAgentThreadRequestResponder(control, SCOPE) });
      const sent = await answer();
      expect(first()?.state.kind).toBe("checking");

      await act(async () => confirm(confirmation));

      expect(first()?.state.kind).toBe(state);
      expect(first()?.error).toBe(error);
      expect(sent.settled()).toBe(settled);
    },
  );

  it("settles a waiting send only from the projection: closed resolves, a newer pending version asks again", async () => {
    const control = controlFake();
    control.respond.mockResolvedValue({ kind: "answered" });
    const responder = remoteAgentThreadRequestResponder(control, SCOPE);
    render({ responder });
    const closed = await answer();
    render({ responder, open: [] });
    await act(async () => Promise.resolve());
    expect(closed.settled()).toBe("resolved");

    render({ responder, open: [question()] });
    const superseded = await answer();
    expect(first()?.state.kind).toBe("sending");
    render({ responder, open: [question(3)] });
    await act(async () => Promise.resolve());

    expect(superseded.settled()).toBe(`rejected: ${AGENT_REQUEST_NOT_DELIVERED}`);
    expect(first()?.state.kind).toBe("answerable");
    expect(first()?.error).toBe(AGENT_REQUEST_NOT_DELIVERED);
  });

  it("never lets a request be sent twice while a send may be in flight", async () => {
    const control = controlFake();
    control.respond.mockReturnValue(new Promise(() => undefined));
    render({ responder: remoteAgentThreadRequestResponder(control, SCOPE) });

    const sent = await answer();
    let second = "pending";
    await act(async () => {
      await current()
        .respond(KEY, ANSWER)
        .catch(() => {
          second = "rejected";
        });
    });

    expect(control.respond).toHaveBeenCalledTimes(1);
    expect(sent.settled()).toBe("pending");
    expect(second).toBe("rejected");
    expect(first()?.state.kind).toBe("sending");
  });

  it("disables answerable requests while the server is unreachable and shows non-live and remote approval requests read-only", () => {
    const responder = remoteAgentThreadRequestResponder(controlFake(), SCOPE);
    render({ responder, reachable: false });
    expect(first()?.state).toEqual({ kind: "disabled" });

    render({
      responder,
      open: [
        agentRuntimeRequestOf("submittingQuestionWithAnswers", { turnId: TURN }),
        agentRuntimeRequestOf("pendingApproval", { turnId: TURN }),
      ],
    });

    expect(current().items.map((item) => item.state)).toEqual([
      { kind: "readOnly", reason: AGENT_REQUEST_NOT_LIVE },
      { kind: "readOnly", reason: AGENT_REMOTE_APPROVAL_READ_ONLY },
    ]);
  });

  it("answers local requests through the local commands and forgets deliveries of another owner", async () => {
    const gateway = {
      answer: vi.fn(() => Promise.reject(new Error("gone"))),
      answerApproval: vi.fn(),
    };
    const responder = localAgentThreadRequestResponder(gateway, "agent-root:app");
    render({ responder });

    const sent = await answer();

    expect(gateway.answer).toHaveBeenCalledWith(
      { kind: "local", workspaceId: "agent-root:app", taskId: TURN },
      "req-0001",
      { answers: ANSWER.answers },
    );
    expect(sent.settled()).toBe(`rejected: ${AGENT_REQUEST_NOT_SENT}`);
    expect(first()?.state.kind).toBe("answerable");

    let finish: (failure: Error) => void = () => undefined;
    gateway.answer.mockReturnValue(
      new Promise((_resolve, reject) => {
        finish = reject;
      }),
    );
    await answer();
    expect(first()?.state.kind).toBe("sending");
    render({ responder, ownerKey: "owner-b" });

    expect(first()?.state.kind).toBe("answerable");
    expect(first()?.error).toBeNull();

    act(() => root.unmount());
    root = createRoot(host);
    render({ responder, ownerKey: "owner-a" });
    expect(first()?.state.kind).toBe("sending");
    let again = "pending";
    await act(async () => {
      await current()
        .respond(KEY, ANSWER)
        .catch(() => {
          again = "rejected";
        });
    });
    expect(again).toBe("rejected");
    expect(gateway.answer).toHaveBeenCalledTimes(2);

    await act(async () => finish(new Error("gone")));
    await act(async () => Promise.resolve());
    expect(first()?.state.kind).toBe("answerable");
  });

  it("keeps an uncertain delivery locked when a newer pending version arrives until the feed gives up confirming it", async () => {
    const control = controlFake();
    let confirm: (value: RemoteAgentThreadRequestConfirmation) => void = () => undefined;
    control.respond.mockResolvedValue({
      kind: "deliveryUncertain",
      confirmation: new Promise((resolve) => {
        confirm = resolve;
      }),
    });
    const responder = remoteAgentThreadRequestResponder(control, SCOPE);
    render({ responder });
    const sent = await answer();

    render({ responder, open: [question(3)] });
    await act(async () => Promise.resolve());
    expect(first()?.state.kind).toBe("checking");
    expect(sent.settled()).toBe("pending");

    await act(async () => confirm("unconfirmed"));
    render({ responder, open: [question(5)] });
    await act(async () => Promise.resolve());

    expect(first()?.state.kind).toBe("answerable");
    expect(first()?.error).toBe(AGENT_REQUEST_NOT_DELIVERED);
    expect(sent.settled()).toBe(`rejected: ${AGENT_REQUEST_NOT_DELIVERED}`);
  });

  it("keeps a delivery lock while the request's turn is not yet observed and clears it only on proof of closure", async () => {
    const control = controlFake();
    control.respond.mockResolvedValue({ kind: "answered" });
    const responder = remoteAgentThreadRequestResponder(control, SCOPE);
    render({ responder });
    const sent = await answer();
    expect(first()?.state.kind).toBe("sending");

    render({ responder, open: [], covered: UNCOVERED });
    await act(async () => Promise.resolve());
    render({ responder, open: [question()], covered: UNCOVERED });
    expect(first()?.state.kind).toBe("sending");
    expect(sent.settled()).toBe("pending");

    render({ responder, open: [], covered: COVERED });
    await act(async () => Promise.resolve());
    expect(sent.settled()).toBe("resolved");
    render({ responder });
    expect(first()?.state.kind).toBe("answerable");
  });

  it("re-asks the feed about an abandoned uncertain delivery and re-enables the card once a later read shows it still pending", async () => {
    vi.useFakeTimers();
    try {
      const control = controlFake();
      control.respond.mockResolvedValue({
        kind: "deliveryUncertain",
        confirmation: Promise.resolve("unconfirmed"),
      });
      const responder = remoteAgentThreadRequestResponder(control, SCOPE);
      render({ responder });
      const sent = await answer();
      render({ responder, reachable: false });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3 * AGENT_THREAD_REQUEST_RECONFIRM_MS);
      });
      expect(first()?.state.kind).toBe("checking");
      expect(control.confirm).not.toHaveBeenCalled();

      render({ responder });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(control.confirm).toHaveBeenCalledWith(SCOPE, TURN, "req-0001");
      expect(first()?.state.kind).toBe("checking");

      control.confirm.mockResolvedValue("pending");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(AGENT_THREAD_REQUEST_RECONFIRM_MS);
      });

      expect(first()?.state.kind).toBe("answerable");
      expect(first()?.error).toBe(AGENT_REQUEST_NOT_DELIVERED);
      expect(sent.settled()).toBe(`rejected: ${AGENT_REQUEST_NOT_DELIVERED}`);
    } finally {
      vi.useRealTimers();
    }
  });
});
