import { describe, expect, it } from "vitest";
import wire from "../../contracts/agent-runtime-request-wire.json";
import {
  AGENT_RUNTIME_REQUEST_STATUSES,
  AGENT_RUNTIME_REQUEST_TRANSITIONS,
  parseAgentRuntimeRequest,
  type AgentRuntimeRequest,
} from "./agentRuntimeRequest";
import {
  NO_AGENT_TURN_REQUEST_ROWS,
  agentTurnQuestionToolIds,
  agentTurnRequestAnchors,
  agentTurnRequestRows,
  isClosedAgentRuntimeRequest,
  type AgentTurnRequestAnchorTool,
  type AgentTurnRequestRowsSource,
  type AgentTurnRequestSlot,
} from "./agentTurnRequestRows";

const TURN = "agt-turn-0100";
const ASK = "toolu_01Ask";
const ASK_AGAIN = "toolu_02Ask";
const BASH = "toolu_01Bash";

function wireRequest(
  name: string,
  patch: Readonly<Record<string, unknown>> = {},
): AgentRuntimeRequest {
  const found = wire.requests.valid.find((candidate) => candidate.name === name);
  expect(found, name).toBeDefined();
  return parseAgentRuntimeRequest({ ...found?.value, turnId: TURN, ...patch });
}

interface SourcePatch extends Partial<Omit<AgentTurnRequestRowsSource, "anchors">> {
  readonly anchors?: ReadonlyArray<AgentTurnRequestAnchorTool>;
  readonly work?: ReadonlyArray<AgentTurnRequestAnchorTool> | null;
}

function anchor(key: string, toolId: string): AgentTurnRequestAnchorTool {
  return { key, toolId };
}

function source(patch: SourcePatch): AgentTurnRequestRowsSource {
  return {
    turnId: TURN,
    requests: [],
    questionToolIds: null,
    held: new Map(),
    ...patch,
    anchors: agentTurnRequestAnchors(patch.work ?? null, patch.anchors ?? []),
  };
}

function ids(requests: readonly AgentRuntimeRequest[] | undefined): readonly string[] {
  return (requests ?? []).map((request) => request.id);
}

describe("agentTurnRequestRows", () => {
  it("anchors a closed record to the mounted tool row named by its anchor", () => {
    const question = wireRequest("resolvedQuestion");
    const approval = wireRequest("expiredAnswerUnconfirmedWithDecision");
    const rows = agentTurnRequestRows(
      source({
        requests: [approval, question],
        anchors: [anchor("a", BASH), anchor("b", ASK)],
      }),
    );

    expect(ids(rows.byAnchor.get("b"))).toEqual([question.id]);
    expect(ids(rows.byAnchor.get("a"))).toEqual([approval.id]);
    expect([...rows.questionToolIds]).toEqual([ASK]);
    expect(rows.unanchored).toEqual([]);
  });

  it("orders several records on one tool row by their order", () => {
    const later = wireRequest("resolvedQuestion", { id: "req-b", order: 5 });
    const earlier = wireRequest("resolvedQuestion", { id: "req-a", order: 2 });
    const rows = agentTurnRequestRows(
      source({ requests: [later, earlier], anchors: [anchor("a", ASK)] }),
    );

    expect(ids(rows.byAnchor.get("a"))).toEqual(["req-a", "req-b"]);
  });

  it("floats a record whose tool row is not mounted and still hides the provider question", () => {
    const approval = wireRequest("expiredAppRestarted");
    const question = wireRequest("resolvedQuestion");
    const rows = agentTurnRequestRows(
      source({ requests: [approval, question], anchors: [anchor("a", BASH)] }),
    );

    expect(rows.byAnchor.size).toBe(0);
    expect(ids(rows.unanchored)).toEqual([question.id, approval.id]);
    expect(rows.questionToolIds.has(ASK)).toBe(true);
  });

  it("renders a record at exactly one row when a tool id is mounted more than once", () => {
    const approval = wireRequest("expiredAnswerUnconfirmedWithDecision");
    const rows = agentTurnRequestRows(
      source({
        requests: [approval],
        anchors: [anchor("first", BASH), anchor("second", BASH)],
      }),
    );

    expect(ids(rows.byAnchor.get("first"))).toEqual([approval.id]);
    expect(rows.byAnchor.has("second")).toBe(false);
    expect(rows.unanchored).toEqual([]);
  });

  it("puts a resolved record in the work list and an abnormal one outside it", () => {
    const resolved = wireRequest("resolvedApproval", { anchorToolId: BASH });
    const orphan = wireRequest("expiredAppRestarted", { anchorToolId: BASH, order: 4 });
    const loose = wireRequest("resolvedApproval", { id: "req-loose", order: 6 });
    const requests = [resolved, orphan, loose];
    const beside = agentTurnRequestRows(source({ requests, work: [anchor("in-work", BASH)] }));
    const grouped = agentTurnRequestRows(source({ requests, work: [] }));
    const visible = agentTurnRequestRows(
      source({ requests, work: [anchor("in-work", BASH)], anchors: [anchor("open", BASH)] }),
    );
    const foldless = agentTurnRequestRows(source({ requests }));

    expect(ids(beside.byAnchor.get("in-work"))).toEqual([resolved.id]);
    expect(ids(beside.work)).toEqual(["req-loose"]);
    expect(ids(beside.unanchored)).toEqual([orphan.id]);
    expect(grouped.byAnchor.size).toBe(0);
    expect(ids(grouped.work)).toEqual([resolved.id, "req-loose"]);
    expect(ids(grouped.unanchored)).toEqual([orphan.id]);
    expect(ids(visible.byAnchor.get("in-work"))).toEqual([resolved.id]);
    expect(ids(visible.byAnchor.get("open"))).toEqual([orphan.id]);
    expect(visible.unanchored).toEqual([]);
    expect(foldless.work).toEqual([]);
    expect(ids(foldless.unanchored)).toEqual([resolved.id, orphan.id, "req-loose"]);
  });

  it("keeps a held record where it is until the hold is released", () => {
    const question = wireRequest("resolvedQuestion");
    const approval = wireRequest("timedOutApproval");
    const anchors = [anchor("a", ASK), anchor("b", BASH)];
    const free = agentTurnRequestRows(source({ requests: [question, approval], anchors }));
    const heldAway = agentTurnRequestRows(
      source({
        requests: [question, approval],
        anchors,
        work: [],
        held: new Map<string, AgentTurnRequestSlot>([
          [question.id, { kind: "unanchored" }],
          [approval.id, { kind: "anchor", key: "b" }],
        ]),
      }),
    );
    const heldInWork = agentTurnRequestRows(
      source({
        requests: [question, approval],
        anchors,
        work: [],
        held: new Map<string, AgentTurnRequestSlot>([[question.id, { kind: "work" }]]),
      }),
    );
    const heldAtMissingSlot = agentTurnRequestRows(
      source({
        requests: [question, approval],
        anchors,
        held: new Map<string, AgentTurnRequestSlot>([
          [question.id, { kind: "anchor", key: "gone" }],
          [approval.id, { kind: "work" }],
        ]),
      }),
    );

    expect(ids(free.byAnchor.get("a"))).toEqual([question.id]);
    expect(ids(free.unanchored)).toEqual([approval.id]);
    expect(ids(heldAway.unanchored)).toEqual([question.id]);
    expect(ids(heldAway.byAnchor.get("b"))).toEqual([approval.id]);
    expect(heldAway.questionToolIds.has(ASK)).toBe(true);
    expect(ids(heldInWork.work)).toEqual([question.id]);
    expect(ids(heldAtMissingSlot.byAnchor.get("a"))).toEqual([question.id]);
    expect(ids(heldAtMissingSlot.unanchored)).toEqual([approval.id]);
  });

  it("indexes each tool id and each row key once, work rows first", () => {
    const anchors = agentTurnRequestAnchors(
      [anchor("first", BASH), anchor("second", BASH)],
      [anchor("first", ASK), anchor("third", ASK), anchor("fourth", BASH)],
    );

    expect([...anchors.keyByToolId]).toEqual([
      [BASH, "first"],
      [ASK, "third"],
    ]);
    expect([...anchors.visibleKeyByToolId]).toEqual([
      [ASK, "third"],
      [BASH, "fourth"],
    ]);
    expect([...anchors.toolIdByKey]).toEqual([
      ["first", BASH],
      ["third", ASK],
      ["fourth", BASH],
    ]);
    expect(anchors.hasWork).toBe(true);
    expect(agentTurnRequestAnchors(null, []).hasWork).toBe(false);
  });

  it("orders unanchored records by order, then creation time, then id", () => {
    const requests = [
      wireRequest("resolvedApproval", { id: "req-d", order: 3, createdAtEpochMs: 10 }),
      wireRequest("timedOutApproval", { id: "req-c", order: 1, createdAtEpochMs: 30 }),
      wireRequest("cancelledWithTask", { id: "req-b", order: 1, createdAtEpochMs: 20 }),
      wireRequest("expiredRunnerStopped", { id: "req-a", order: 1, createdAtEpochMs: 20 }),
    ];
    const expected = ["req-a", "req-b", "req-c", "req-d"];

    expect(ids(agentTurnRequestRows(source({ requests })).unanchored)).toEqual(expected);
    expect(
      ids(agentTurnRequestRows(source({ requests: [...requests].reverse() })).unanchored),
    ).toEqual(expected);
  });

  it("leaves pending and submitting records to the composer", () => {
    const pendingQuestion = wireRequest("pendingQuestion", { anchorToolId: ASK });
    const pendingApproval = wireRequest("pendingApproval");
    const submitting = wireRequest("submittingApprovalWithoutResolution", {
      anchorToolId: BASH,
    });
    const rows = agentTurnRequestRows(
      source({
        requests: [pendingQuestion, pendingApproval, submitting],
        anchors: [anchor("a", ASK), anchor("b", BASH)],
      }),
    );

    expect(rows.unanchored).toEqual([]);
    expect(rows.byAnchor.size).toBe(0);
    expect([...rows.questionToolIds]).toEqual([ASK]);
  });

  it("treats exactly the statuses without a next transition as closed", () => {
    for (const status of AGENT_RUNTIME_REQUEST_STATUSES) {
      const request = { status } as AgentRuntimeRequest;
      expect(isClosedAgentRuntimeRequest(request), status).toBe(
        AGENT_RUNTIME_REQUEST_TRANSITIONS[status].length === 0,
      );
    }
    expect(() =>
      isClosedAgentRuntimeRequest({ status: "paused" } as unknown as AgentRuntimeRequest),
    ).toThrow(TypeError);
  });

  it("drops records that belong to another turn", () => {
    const foreign = wireRequest("resolvedQuestion", { turnId: "agt-turn-0999" });
    const rows = agentTurnRequestRows(
      source({ requests: [foreign], anchors: [anchor("a", ASK)], questionToolIds: [ASK] }),
    );

    expect(rows).toBe(NO_AGENT_TURN_REQUEST_ROWS);
  });

  it("pairs unanchored questions with the turn's complete question tools in order", () => {
    const first = wireRequest("expiredDeliveryFailed", { id: "req-1", order: 0 });
    const second = wireRequest("expiredTurnEnded", { id: "req-2", order: 1 });
    const approval = wireRequest("timedOutApproval", { id: "req-3", order: 2 });
    const rows = agentTurnRequestRows(
      source({
        requests: [approval, second, first],
        anchors: [anchor("a", ASK), anchor("b", BASH), anchor("c", ASK_AGAIN)],
        questionToolIds: [ASK, ASK_AGAIN, ASK],
      }),
    );

    expect(ids(rows.byAnchor.get("a"))).toEqual(["req-1"]);
    expect(ids(rows.byAnchor.get("c"))).toEqual(["req-2"]);
    expect([...rows.questionToolIds].sort()).toEqual([ASK, ASK_AGAIN]);
    expect(ids(rows.unanchored)).toEqual(["req-3"]);
  });

  it("does not attach a hidden question's record to the only visible question tool", () => {
    const hiddenQuestionRecord = wireRequest("expiredDeliveryFailed");
    const rows = agentTurnRequestRows(
      source({
        requests: [hiddenQuestionRecord],
        anchors: [anchor("visible", ASK_AGAIN)],
        questionToolIds: [ASK, ASK_AGAIN],
      }),
    );

    expect(rows.byAnchor.size).toBe(0);
    expect(rows.questionToolIds.size).toBe(0);
    expect(ids(rows.unanchored)).toEqual([hiddenQuestionRecord.id]);
  });

  it("pairs with a question tool that is not mounted without touching the mounted one", () => {
    const first = wireRequest("expiredDeliveryFailed", { id: "req-1", order: 0 });
    const second = wireRequest("resolvedQuestion", {
      id: "req-2",
      order: 1,
      anchorToolId: ASK_AGAIN,
    });
    const rows = agentTurnRequestRows(
      source({
        requests: [first, second],
        anchors: [anchor("visible", ASK_AGAIN)],
        questionToolIds: [ASK, ASK_AGAIN],
      }),
    );

    expect(ids(rows.byAnchor.get("visible"))).toEqual(["req-2"]);
    expect(ids(rows.unanchored)).toEqual(["req-1"]);
    expect([...rows.questionToolIds].sort()).toEqual([ASK, ASK_AGAIN]);
  });

  it("skips pairing entirely when the turn's events are incomplete", () => {
    const only = wireRequest("expiredDeliveryFailed");
    const rows = agentTurnRequestRows(
      source({ requests: [only], anchors: [anchor("a", ASK)], questionToolIds: null }),
    );

    expect(rows.byAnchor.size).toBe(0);
    expect(rows.questionToolIds.size).toBe(0);
    expect(ids(rows.unanchored)).toEqual([only.id]);
  });

  it("does not pair an unanchored question with a question tool that already has one", () => {
    const anchored = wireRequest("resolvedQuestion", { id: "req-1" });
    const loose = wireRequest("expiredDeliveryFailed", { id: "req-2", order: 1 });
    const rows = agentTurnRequestRows(
      source({
        requests: [anchored, loose],
        anchors: [anchor("a", ASK)],
        questionToolIds: [ASK],
      }),
    );

    expect(ids(rows.byAnchor.get("a"))).toEqual(["req-1"]);
    expect(ids(rows.unanchored)).toEqual(["req-2"]);
  });

  it("lists the turn's question tool calls once each, in order", () => {
    expect(
      agentTurnQuestionToolIds([
        { kind: "assistantText" },
        { kind: "toolCall", toolId: BASH, name: "Bash" },
        { kind: "toolCall", toolId: ASK_AGAIN, name: "AskUserQuestion" },
        { kind: "toolResult", toolId: ASK_AGAIN },
        { kind: "toolCall", toolId: ASK, name: "AskUserQuestion" },
        { kind: "toolCall", toolId: ASK_AGAIN, name: "AskUserQuestion" },
      ]),
    ).toEqual([ASK_AGAIN, ASK]);
  });

  it("returns the previous rows for unchanged input and shares what did not change", () => {
    const question = wireRequest("resolvedQuestion");
    const approval = wireRequest("timedOutApproval");
    const anchors = [anchor("a", ASK), anchor("b", BASH)];
    const rows = agentTurnRequestRows(source({ requests: [question, approval], anchors }));
    const again = agentTurnRequestRows(
      source({ requests: [question, approval], anchors: [...anchors] }),
      rows,
    );
    const grown = agentTurnRequestRows(
      source({
        requests: [
          question,
          approval,
          wireRequest("resolvedApproval", { id: "req-new", order: 9, anchorToolId: BASH }),
        ],
        anchors,
      }),
      rows,
    );

    expect(again).toBe(rows);
    expect(grown).not.toBe(rows);
    expect(grown.byAnchor.get("a")).toBe(rows.byAnchor.get("a"));
    expect(grown.unanchored).toBe(rows.unanchored);
    expect(grown.questionToolIds).toBe(rows.questionToolIds);
    expect(ids(grown.byAnchor.get("b"))).toEqual(["req-new"]);
  });

  it("returns the shared empty rows when there is nothing to show", () => {
    expect(agentTurnRequestRows(source({ anchors: [anchor("a", ASK)] }))).toBe(
      NO_AGENT_TURN_REQUEST_ROWS,
    );
    expect(agentTurnRequestRows(source({ requests: [wireRequest("pendingApproval")] }))).toBe(
      NO_AGENT_TURN_REQUEST_ROWS,
    );
  });

  it("keeps the record objects themselves so memoized rows stay stable", () => {
    const question = wireRequest("resolvedQuestion");
    const approval = wireRequest("timedOutApproval");
    const rows = agentTurnRequestRows(
      source({ requests: [question, approval], anchors: [anchor("a", ASK)] }),
    );

    expect(rows.byAnchor.get("a")?.[0]).toBe(question);
    expect(rows.unanchored[0]).toBe(approval);
  });
});
