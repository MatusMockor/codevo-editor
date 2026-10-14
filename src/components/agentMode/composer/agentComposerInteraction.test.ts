import { describe, expect, it, vi } from "vitest";
import type {
  AgentThreadPendingRequest,
  AgentThreadPendingRequestState,
} from "../../../application/useAgentThreadPendingRequests";
import type { AgentRuntimeRequest } from "../../../domain/agentRuntimeRequest";
import { agentRuntimeRequestOf } from "../../../test/agentThreadRequestFeedFake";
import { AGENT_REQUEST_CHECKING, pickAgentComposerInteraction } from "./agentComposerInteraction";

const NO_ATTACHMENTS = { kind: "unavailable", reason: "No attachments." } as const;
const ANSWERABLE: AgentThreadPendingRequestState = { kind: "answerable" };

function item(
  request: AgentRuntimeRequest,
  state: AgentThreadPendingRequestState = ANSWERABLE,
  error: string | null = null,
): AgentThreadPendingRequest {
  return { key: `${request.turnId}/${request.id}`, request, state, error };
}

const approval = agentRuntimeRequestOf("pendingApproval", { turnId: "turn" });
const question = agentRuntimeRequestOf("pendingQuestion", { turnId: "turn" });

function pick(requests: readonly AgentThreadPendingRequest[], respond = vi.fn()) {
  return pickAgentComposerInteraction({ requests, attachments: NO_ATTACHMENTS, respond });
}

describe("pickAgentComposerInteraction", () => {
  it("puts the first pending approval in the slab and counts the rest", () => {
    const second = agentRuntimeRequestOf("pendingApproval", { turnId: "turn", id: "req-0009" });
    const picked = pick([item(question), item(approval, { kind: "sending" }), item(second)]);

    expect(picked?.kind).toBe("approval");
    expect(picked?.kind === "approval" && picked.pendingCount).toBe(2);
    expect(picked?.kind === "approval" && picked.sending).toBe(true);
    expect(picked?.key).toBe("approval:turn:req-0002");
  });

  it("routes a decision and an answer to the picked request only", async () => {
    const respond = vi.fn().mockResolvedValue(undefined);
    const decided = pick([item(approval)], respond);
    if (decided?.kind === "approval") await decided.decide("deny");
    const answered = pick([item(question)], respond);
    const answers = [{ questionId: "scope", optionIds: ["narrow"], text: "" }];
    if (answered?.kind === "question") await answered.answer({ answers });

    expect(respond.mock.calls).toEqual([
      ["turn/req-0002", { kind: "approval", decision: "deny" }],
      ["turn/req-0001", { kind: "question", answers }],
    ]);
  });

  it("falls back to a pending question, then nothing", () => {
    const picked = pick([item(question, ANSWERABLE, "Your answer was not sent. Send it again.")]);

    expect(picked).toMatchObject({
      kind: "question",
      key: "question:turn:req-0001",
      sending: false,
      disabled: false,
      note: null,
      error: "Your answer was not sent. Send it again.",
      request: { id: "req-0001", taskId: "turn", status: "pending" },
    });
    expect(pick([])).toBeNull();
  });

  it("presents checking, disabled and read-only requests without answer controls", () => {
    expect(pick([item(question, { kind: "checking" })])).toMatchObject({
      sending: true,
      pendingLabel: AGENT_REQUEST_CHECKING,
    });
    expect(pick([item(question, { kind: "disabled" })])).toMatchObject({
      sending: false,
      disabled: true,
      note: null,
    });
    const readOnly = pick([item(approval, { kind: "readOnly", reason: "Not here." })]);
    expect(readOnly).toMatchObject({ disabled: true, note: "Not here." });
    expect(readOnly?.kind === "approval" && readOnly.view.actions).toEqual([]);
  });

  it("prefers actionable requests and shows a read-only request only when nothing actionable is pending", () => {
    const readOnly = item(approval, { kind: "readOnly", reason: "Not here." });
    const second = agentRuntimeRequestOf("pendingApproval", { turnId: "turn", id: "req-0009" });

    expect(pick([readOnly, item(question)])?.key).toBe("question:turn:req-0001");
    expect(pick([readOnly, item(question), item(second)])).toMatchObject({
      key: "approval:turn:req-0009",
      pendingCount: 1,
    });
    expect(pick([readOnly, item(question, { kind: "disabled" })])?.kind).toBe("question");
    expect(pick([readOnly])?.key).toBe("approval:turn:req-0002");
  });
});
