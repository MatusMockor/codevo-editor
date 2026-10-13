import { describe, expect, it } from "vitest";
import wire from "../../../contracts/agent-runtime-request-wire.json";
import { AGENT_APPROVAL_DECISIONS, AGENT_APPROVAL_KINDS } from "../../domain/agentApproval";
import {
  AGENT_RUNTIME_REQUEST_BODY_KINDS,
  AGENT_RUNTIME_REQUEST_CLOSE_REASONS,
  AGENT_RUNTIME_REQUEST_STATUSES,
  parseAgentRuntimeRequest,
  type AgentRuntimeRequest,
  type AgentRuntimeRequestBodyKind,
  type AgentRuntimeRequestCloseReason,
  type AgentRuntimeRequestStatus,
} from "../../domain/agentRuntimeRequest";
import {
  isClosedAgentRuntimeRequest,
  type ClosedAgentRuntimeRequest,
} from "../../domain/agentTurnRequestRows";
import {
  AGENT_REQUEST_ROW_LIMITS,
  AGENT_REQUEST_TRUNCATION_MARKER,
  agentRuntimeRequestEnding,
  presentAgentRuntimeRequest,
  type AgentRuntimeRequestDetailView,
} from "./agentRuntimeRequestPresentation";

type Patch = Readonly<Record<string, unknown>>;
type QuestionDetail = Extract<AgentRuntimeRequestDetailView, { readonly kind: "question" }>;
type ApprovalDetail = Extract<AgentRuntimeRequestDetailView, { readonly kind: "approval" }>;

const IMAGE_ID = "0123456789abcdef0123456789abcdef";
const JARGON =
  /notResumable|responseCapability|turnEnded|providerCancelled|timedOut|deliveryFailed|appRestarted|answerUnconfirmed|runnerRestarted|runnerStopped|taskCancelled|unknown|undefined|null/;
const CLOSED_STATUSES = AGENT_RUNTIME_REQUEST_STATUSES.filter(
  (status) => status !== "pending" && status !== "submitting",
);
const BASES: Readonly<Record<AgentRuntimeRequestBodyKind, { open: string; resolved: string }>> = {
  question: { open: "expiredTurnEnded", resolved: "resolvedQuestion" },
  approval: { open: "expiredRunnerStopped", resolved: "resolvedApproval" },
};
const EXPIRED_QUESTION_ENDINGS: Readonly<Record<AgentRuntimeRequestCloseReason, string>> = {
  turnEnded: "The agent finished the turn before this was answered.",
  providerCancelled: "The agent withdrew this question before it was answered.",
  timedOut: "This closed because no answer arrived in time.",
  deliveryFailed: "Your answer could not be delivered to the agent.",
  appRestarted: "Codevo quit before this was answered.",
  answerUnconfirmed: "Your answer was sent, but Codevo could not confirm the agent received it.",
  runnerRestarted: "The runner restarted before this was answered.",
  runnerStopped: "The runner stopped before this was answered.",
  taskCancelled: "The run was stopped before this was answered.",
  unknown: "This question closed before it was answered.",
};
const EXPIRED_APPROVAL_ENDINGS: Readonly<Record<AgentRuntimeRequestCloseReason, string>> = {
  turnEnded: "The agent finished the turn before this was decided.",
  providerCancelled: "The agent withdrew this request before it was decided.",
  timedOut: "This closed because no decision arrived in time.",
  deliveryFailed: "Your decision could not be delivered to the agent.",
  appRestarted: "Codevo quit before this was decided.",
  answerUnconfirmed: "Your decision was sent, but Codevo could not confirm the agent received it.",
  runnerRestarted: "The runner restarted before this was decided.",
  runnerStopped: "The runner stopped before this was decided.",
  taskCancelled: "The run was stopped before this was decided.",
  unknown: "This request closed before it was decided.",
};

function wireValue(name: string): Patch {
  const found = wire.requests.valid.find((candidate) => candidate.name === name);
  expect(found, name).toBeDefined();
  return found?.value ?? {};
}

function closed(request: AgentRuntimeRequest): ClosedAgentRuntimeRequest {
  expect(isClosedAgentRuntimeRequest(request), request.id).toBe(true);
  return request as ClosedAgentRuntimeRequest;
}

function wireRequest(name: string, patch: Patch = {}): ClosedAgentRuntimeRequest {
  return closed(parseAgentRuntimeRequest({ ...wireValue(name), ...patch }));
}

function unparsed(name: string, patch: Patch): ClosedAgentRuntimeRequest {
  return { ...wireValue(name), ...patch } as unknown as ClosedAgentRuntimeRequest;
}

function closedAs(
  kind: AgentRuntimeRequestBodyKind,
  status: AgentRuntimeRequestStatus,
  reason: AgentRuntimeRequestCloseReason,
): ClosedAgentRuntimeRequest {
  const base = status === "resolved" ? BASES[kind].resolved : BASES[kind].open;
  return wireRequest(base, { status, responseCapability: { kind: "notResumable", reason } });
}

function questionDetail(request: ClosedAgentRuntimeRequest): QuestionDetail {
  const detail = presentAgentRuntimeRequest(request).detail;
  expect(detail.kind).toBe("question");
  return detail as QuestionDetail;
}

function approvalDetail(request: ClosedAgentRuntimeRequest): ApprovalDetail {
  const detail = presentAgentRuntimeRequest(request).detail;
  expect(detail.kind).toBe("approval");
  return detail as ApprovalDetail;
}

function question(patch: Patch): Patch {
  return {
    id: "q",
    header: "",
    prompt: "Pick",
    options: [],
    multiple: false,
    allowCustom: true,
    ...patch,
  };
}

function options(count: number): readonly Patch[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `o${index}`,
    label: `Option ${index}`,
    description: "",
  }));
}

describe("how a runtime request ended", () => {
  it("has one calm sentence for every closed status, close reason and body kind", () => {
    for (const kind of AGENT_RUNTIME_REQUEST_BODY_KINDS) {
      for (const status of CLOSED_STATUSES) {
        const sentences = AGENT_RUNTIME_REQUEST_CLOSE_REASONS.map((reason) => {
          const request = closedAs(kind, status, reason);
          const sentence = agentRuntimeRequestEnding(request);
          const label = `${kind} ${status} ${reason}`;
          expect(sentence, label).toMatch(/^[A-Z][^.!?]*\.$/);
          expect(sentence, label).not.toMatch(JARGON);
          expect(presentAgentRuntimeRequest(request).ending, label).toBe(sentence);
          return sentence;
        });
        const distinct = status === "resolved" ? 1 : AGENT_RUNTIME_REQUEST_CLOSE_REASONS.length;
        expect(new Set(sentences).size, `${kind} ${status}`).toBe(distinct);
      }
    }
  });

  it("says exactly why an unanswered question or approval closed", () => {
    for (const reason of AGENT_RUNTIME_REQUEST_CLOSE_REASONS) {
      expect(agentRuntimeRequestEnding(closedAs("question", "expired", reason)), reason).toBe(
        EXPIRED_QUESTION_ENDINGS[reason],
      );
      expect(agentRuntimeRequestEnding(closedAs("approval", "expired", reason)), reason).toBe(
        EXPIRED_APPROVAL_ENDINGS[reason],
      );
    }
  });

  it("falls back to what the status alone proves when no reason was recorded", () => {
    expect(agentRuntimeRequestEnding(closedAs("question", "cancelled", "unknown"))).toBe(
      "This question was cancelled before it was answered.",
    );
    expect(agentRuntimeRequestEnding(closedAs("approval", "timedOut", "unknown"))).toBe(
      "This request closed after waiting too long for the decision.",
    );
  });

  it("names the decision for every approval kind", () => {
    for (const approvalKind of AGENT_APPROVAL_KINDS) {
      const sentences = AGENT_APPROVAL_DECISIONS.map((decision) => {
        const base = wireValue("resolvedApproval");
        const request = wireRequest("resolvedApproval", {
          body: { ...(base.body as Patch), approvalKind, decisions: AGENT_APPROVAL_DECISIONS },
          resolution: { kind: "decision", decision },
        });
        const view = presentAgentRuntimeRequest(request);
        expect(view.ending, `${approvalKind} ${decision}`).toMatch(/^[A-Z][^.!?]*\.$/);
        expect(view.settled).toBe(true);
        expect(view.glyph).toBe(decision === "deny" ? "denied" : "approved");
        expect(view.label).not.toBe("Approval");
        return view.ending;
      });
      expect(new Set(sentences).size, approvalKind).toBeGreaterThanOrEqual(2);
    }
    expect(agentRuntimeRequestEnding(wireRequest("resolvedApproval"))).toBe(
      "This was allowed once.",
    );
    expect(
      agentRuntimeRequestEnding(
        wireRequest("expiredAnswerUnconfirmedWithDecision", {
          status: "resolved",
          responseCapability: { kind: "notResumable", reason: "unknown" },
          resolution: { kind: "decision", decision: "allowForSession" },
        }),
      ),
    ).toBe("This was allowed for the rest of the session.");
  });

  it("rejects a close reason, status or body kind it does not know", () => {
    expect(() =>
      agentRuntimeRequestEnding(
        unparsed("expiredTurnEnded", {
          responseCapability: { kind: "notResumable", reason: "solarFlare" },
        }),
      ),
    ).toThrow(TypeError);
    expect(() =>
      agentRuntimeRequestEnding(
        unparsed("expiredTurnEnded", {
          status: "paused",
          responseCapability: { kind: "notResumable", reason: "unknown" },
        }),
      ),
    ).toThrow(TypeError);
    expect(() =>
      presentAgentRuntimeRequest(unparsed("expiredTurnEnded", { body: { kind: "survey" } })),
    ).toThrow(TypeError);
  });
});

describe("presentAgentRuntimeRequest", () => {
  it("shows an answered question with the selected options and the typed text", () => {
    const view = presentAgentRuntimeRequest(wireRequest("resolvedQuestion"));
    const detail = questionDetail(wireRequest("resolvedQuestion"));

    expect(view).toMatchObject({
      id: "req-0005",
      glyph: "question",
      settled: true,
      label: "Answered",
      title: "Which packages should be updated?",
      summary: "API, Web, Also the docs.",
      ending: "This question was answered.",
    });
    expect(detail.questions.map((item) => item.prompt.full)).toEqual([
      "Which packages should be updated?",
      "Anything else to consider?",
    ]);
    expect(detail.questions[0]).toMatchObject({
      selected: ["API", "Web"],
      notChosen: [],
      emptyNote: null,
    });
    expect(detail.questions[0]?.text?.full).toBe("Also the docs.");
    expect(detail.questions[1]?.selected).toEqual([]);
    expect(detail.questions[1]?.text?.full).toBe("Keep the public API stable.");
  });

  it("shows an unanswered question with the options that were offered", () => {
    const request = wireRequest("cancelledByProvider");
    const view = presentAgentRuntimeRequest(request);
    const detail = questionDetail(request);

    expect(view).toMatchObject({ settled: false, label: "Question", summary: null });
    expect(view.ending).toBe("The agent withdrew this question before it was answered.");
    expect(detail.questions[0]?.selected).toEqual([]);
    expect(detail.questions[0]?.emptyNote).toBe("No answer");
    expect(detail.questions[0]?.notChosen.length).toBeGreaterThan(0);
    expect(detail.questions[0]?.notChosen.length).toBe(
      detail.questions[0]?.notChosen.filter((label) => label !== "").length,
    );
  });

  it("keeps what the user sent when the agent never confirmed it", () => {
    const sent = presentAgentRuntimeRequest(wireRequest("expiredAnswerUnconfirmedWithAnswers"));
    const lost = questionDetail(wireRequest("expiredAnswerUnconfirmedWithoutResolution"));
    const failed = questionDetail(wireRequest("expiredDeliveryFailed"));

    expect(sent.settled).toBe(false);
    expect(sent.label).toBe("Question");
    expect(sent.summary).not.toBeNull();
    expect(sent.ending).toBe(EXPIRED_QUESTION_ENDINGS.answerUnconfirmed);
    expect(lost.questions[0]?.emptyNote).toBe("Answer not recorded");
    expect(failed.questions[0]?.emptyNote).toBe("Answer not recorded");
  });

  it("shows an approval with its title, detail, facts and decision", () => {
    const request = wireRequest("resolvedApproval");
    const view = presentAgentRuntimeRequest(request);
    const detail = approvalDetail(request);
    const body = request.body.kind === "approval" ? request.body : null;

    expect(view).toMatchObject({
      glyph: "approved",
      settled: true,
      label: "Approved",
      title: body?.title,
      summary: "Allowed once",
    });
    expect(detail.heading.full).toBe(body?.title);
    expect(detail.detail?.full).toBe(body?.detail);
    expect(detail.facts.map((fact) => [fact.label, fact.value.full])).toEqual(
      body?.facts.map((fact) => [fact.label, fact.value]),
    );
    expect(detail.truncatedNote).toBeNull();
  });

  it("shows an undecided approval and a decision that was sent but not confirmed", () => {
    const orphan = presentAgentRuntimeRequest(wireRequest("expiredAppRestarted"));
    const sent = presentAgentRuntimeRequest(wireRequest("expiredAnswerUnconfirmedWithDecision"));

    expect(orphan).toMatchObject({
      glyph: "approval",
      settled: false,
      label: "Approval",
      summary: null,
      ending: "Codevo quit before this was decided.",
    });
    expect(sent.glyph).toBe("approval");
    expect(sent.label).toBe("Approval");
    expect(sent.summary).toMatch(/^Sent: /);
    expect(sent.ending).toBe(EXPIRED_APPROVAL_ENDINGS.answerUnconfirmed);
  });

  it("says when the saved approval detail was already shortened", () => {
    const base = wireValue("timedOutApproval");
    const detail = approvalDetail(
      wireRequest("timedOutApproval", {
        body: { ...(base.body as Patch), detailTruncated: true },
      }),
    );

    expect(detail.truncatedNote).toBe("Shortened for display.");
  });
});

describe("runtime request bounds", () => {
  it("clamps a long prompt and a long answer and marks the cut", () => {
    const prompt = "Why? ".repeat(1_500);
    const answer = `${"line\n".repeat(40)}end`;
    const request = wireRequest("resolvedQuestion", {
      body: { kind: "question", questions: [question({ prompt })] },
      resolution: { kind: "answers", answers: [{ questionId: "q", optionIds: [], text: answer }] },
    });
    const view = presentAgentRuntimeRequest(request);
    const item = questionDetail(request).questions[0];

    expect(view.title.length).toBeLessThanOrEqual(AGENT_REQUEST_ROW_LIMITS.titleChars + 1);
    expect(view.title.endsWith(AGENT_REQUEST_TRUNCATION_MARKER)).toBe(true);
    expect(item?.prompt.clamped).toBe(true);
    expect(item?.prompt.preview.length).toBeLessThanOrEqual(AGENT_REQUEST_ROW_LIMITS.promptChars);
    expect(item?.prompt.full).toBe(prompt.trimEnd());
    expect(item?.text?.clamped).toBe(true);
    expect(item?.text?.preview.split("\n").length).toBe(AGENT_REQUEST_ROW_LIMITS.answerLines);
    expect(item?.text?.full).toBe(answer);
    expect(view.summary).toBe("line");
  });

  it("counts carriage-return line breaks toward the line limit", () => {
    const base = wireValue("timedOutApproval");
    for (const breakText of ["\r", "\r\n", "\n"]) {
      const lines = `x${breakText}`.repeat(240);
      const label = JSON.stringify(breakText);
      const prompt = questionDetail(
        wireRequest("resolvedQuestion", {
          body: { kind: "question", questions: [question({ prompt: lines })] },
          resolution: {
            kind: "answers",
            answers: [{ questionId: "q", optionIds: [], text: lines }],
          },
        }),
      ).questions[0];
      const approval = approvalDetail(
        wireRequest("timedOutApproval", {
          body: {
            ...(base.body as Patch),
            detail: lines,
            facts: [{ label: "Fact", value: lines }],
          },
        }),
      );

      expect(prompt?.prompt.clamped, label).toBe(true);
      expect(prompt?.prompt.preview.split("\n").length, label).toBe(
        AGENT_REQUEST_ROW_LIMITS.promptLines,
      );
      expect(prompt?.prompt.preview, label).not.toContain("\r");
      expect(prompt?.text?.clamped, label).toBe(true);
      expect(prompt?.text?.preview.split("\n").length, label).toBe(
        AGENT_REQUEST_ROW_LIMITS.answerLines,
      );
      expect(approval.detail?.clamped, label).toBe(true);
      expect(approval.detail?.preview.split("\n").length, label).toBe(
        AGENT_REQUEST_ROW_LIMITS.detailLines,
      );
      expect(approval.facts[0]?.value.clamped, label).toBe(true);
      expect(approval.facts[0]?.value.preview.split("\n").length, label).toBe(
        AGENT_REQUEST_ROW_LIMITS.factValueLines,
      );
    }
  });

  it("leaves short text untouched", () => {
    const item = questionDetail(wireRequest("resolvedQuestion")).questions[0];

    expect(item?.prompt).toEqual({
      preview: "Which packages should be updated?",
      full: "Which packages should be updated?",
      clamped: false,
    });
  });

  it("never cuts a surrogate pair in half", () => {
    const prompt = `${"a".repeat(AGENT_REQUEST_ROW_LIMITS.titleChars - 1)}😀 tail`;
    const view = presentAgentRuntimeRequest(
      wireRequest("resolvedQuestion", {
        body: { kind: "question", questions: [question({ prompt })] },
        resolution: { kind: "answers", answers: [{ questionId: "q", optionIds: [], text: "x" }] },
      }),
    );

    expect(view.title).toBe(
      `${"a".repeat(AGENT_REQUEST_ROW_LIMITS.titleChars - 1)}${AGENT_REQUEST_TRUNCATION_MARKER}`,
    );
  });

  it("renders twelve options of a multi-select question and shortens long labels", () => {
    const offered = options(12).map((option, index) =>
      index === 0 ? { ...option, label: "L".repeat(500) } : option,
    );
    const request = wireRequest("resolvedQuestion", {
      body: {
        kind: "question",
        questions: [question({ options: offered, multiple: true, allowCustom: false })],
      },
      resolution: {
        kind: "answers",
        answers: [{ questionId: "q", optionIds: ["o0", "o3", "o11"], text: "" }],
      },
    });
    const item = questionDetail(request).questions[0];

    expect(item?.selected).toEqual([
      `${"L".repeat(AGENT_REQUEST_ROW_LIMITS.optionChars)}${AGENT_REQUEST_TRUNCATION_MARKER}`,
      "Option 3",
      "Option 11",
    ]);
    expect(item?.notChosen.length).toBe(9);
    expect(item?.omittedOptions).toBe(0);
    expect(item?.emptyNote).toBeNull();
  });

  it("counts options, questions and facts beyond the contract instead of dropping them silently", () => {
    const crowded = unparsed("expiredTurnEnded", {
      body: {
        kind: "question",
        questions: Array.from({ length: 6 }, (_, index) =>
          question({ id: `q${index}`, options: options(15) }),
        ),
      },
    });
    const detail = questionDetail(crowded);
    const base = wireValue("timedOutApproval");
    const facts = Array.from({ length: 11 }, (_, index) => ({ label: `F${index}`, value: "v" }));
    const approval = approvalDetail(
      unparsed("timedOutApproval", { body: { ...(base.body as Patch), facts } }),
    );

    expect(detail.questions.length).toBe(AGENT_REQUEST_ROW_LIMITS.questions);
    expect(detail.omittedQuestions).toBe(2);
    expect(detail.questions[0]?.notChosen.length).toBe(AGENT_REQUEST_ROW_LIMITS.options);
    expect(detail.questions[0]?.omittedOptions).toBe(3);
    expect(approval.facts.length).toBe(AGENT_REQUEST_ROW_LIMITS.facts);
    expect(approval.omittedFacts).toBe(3);
  });

  it("clamps a 16 KiB approval detail and long fact values", () => {
    const base = wireValue("timedOutApproval");
    const detailText = "x".repeat(16 * 1024);
    const facts = Array.from({ length: 8 }, (_, index) => ({
      label: `Fact ${index}`,
      value: "v".repeat(2_048),
    }));
    const detail = approvalDetail(
      wireRequest("timedOutApproval", {
        body: { ...(base.body as Patch), detail: detailText, facts },
      }),
    );

    expect(detail.detail?.clamped).toBe(true);
    expect(detail.detail?.preview.length).toBe(AGENT_REQUEST_ROW_LIMITS.detailChars);
    expect(detail.detail?.full).toBe(detailText);
    expect(detail.facts.length).toBe(8);
    for (const fact of detail.facts) {
      expect(fact.value.clamped).toBe(true);
      expect(fact.value.preview.length).toBe(AGENT_REQUEST_ROW_LIMITS.factValueChars);
    }
  });

  it("turns attachment lines into attachments and never shows their local paths", () => {
    const text = [
      "It overlaps.",
      "",
      `[Attached image "screen.png" is saved at: /data/agent-attachments/threads/t/${IMAGE_ID}.png]`,
      '[Attached image "odd.png" is saved at: /data/elsewhere/not-an-id.png]',
      '[Attached file "notes.txt" is saved at: /data/agent-attachments/threads/t/notes.txt]',
    ].join("\n");
    const request = wireRequest("resolvedQuestion", {
      body: { kind: "question", questions: [question({})] },
      resolution: { kind: "answers", answers: [{ questionId: "q", optionIds: [], text }] },
    });
    const item = questionDetail(request).questions[0];

    expect(item?.text?.full).toBe("It overlaps.");
    expect(item?.attachments).toEqual([
      { kind: "image", key: "0:0", name: "screen.png", attachmentId: IMAGE_ID, mime: "image/png" },
      { kind: "chip", key: "0:1", name: "odd.png", glyph: "image" },
      { kind: "chip", key: "0:2", name: "notes.txt", glyph: "file" },
    ]);
    expect(JSON.stringify(presentAgentRuntimeRequest(request))).not.toContain("/data/");
  });

  it("recognizes attachment lines whatever line break follows them", () => {
    const image = `[Attached image "screen.png" is saved at: /data/t/${IMAGE_ID}.png]`;
    const file = '[Attached file "notes.txt" is saved at: /data/t/notes.txt]';
    for (const text of [
      `It overlaps.\r\n\r\n${image}\r\n${file}\r\n`,
      `It overlaps.\r\r${image}\r${file}\r`,
      `It overlaps.\n\n${image}  \n${file}\r\n`,
      `${image}\r\n`,
    ]) {
      const request = wireRequest("resolvedQuestion", {
        body: { kind: "question", questions: [question({})] },
        resolution: { kind: "answers", answers: [{ questionId: "q", optionIds: [], text }] },
      });
      const view = presentAgentRuntimeRequest(request);
      const label = JSON.stringify(text);

      expect(JSON.stringify(view), label).not.toContain("/data/");
      expect(JSON.stringify(view), label).not.toContain("saved at");
      expect(view.summary, label).not.toBeNull();
      expect(questionDetail(request).questions[0]?.attachments[0]?.kind, label).toBe("image");
    }
  });

  it("turns referenced files and folders into named attachments without their paths", () => {
    const lines = [
      '[Attached file "payroll.csv" is at: /Users/alice/private/payroll.csv]',
      '[Attached folder "src" is at: /Users/alice/project/src]',
    ];
    for (const breakText of ["\n", "\r\n"]) {
      const request = wireRequest("resolvedQuestion", {
        body: { kind: "question", questions: [question({})] },
        resolution: {
          kind: "answers",
          answers: [{ questionId: "q", optionIds: [], text: lines.join(breakText) }],
        },
      });
      const view = presentAgentRuntimeRequest(request);
      const item = questionDetail(request).questions[0];
      const label = JSON.stringify(breakText);

      expect(item?.text, label).toBeNull();
      expect(item?.attachments, label).toEqual([
        { kind: "chip", key: "0:0", name: "payroll.csv", glyph: "reference" },
        { kind: "chip", key: "0:1", name: "src", glyph: "reference" },
      ]);
      expect(view.summary, label).toBe("2 attachments");
      expect(JSON.stringify(view), label).not.toContain("/Users/");
      expect(JSON.stringify(view), label).not.toContain("alice");
    }
  });

  it("shows only the last segment of an attachment name that looks like a path", () => {
    const request = wireRequest("resolvedQuestion", {
      body: { kind: "question", questions: [question({})] },
      resolution: {
        kind: "answers",
        answers: [
          {
            questionId: "q",
            optionIds: [],
            text: '[Attached file "/etc/secret/passwd" is at: /etc/secret/passwd]',
          },
        ],
      },
    });

    expect(questionDetail(request).questions[0]?.attachments).toEqual([
      { kind: "chip", key: "0:0", name: "passwd", glyph: "reference" },
    ]);
    expect(JSON.stringify(presentAgentRuntimeRequest(request))).not.toContain("/etc/");
  });

  it("summarizes an answer that is only attachments", () => {
    const text = `\n\n[Attached image "screen.png" is saved at: /data/t/${IMAGE_ID}.png]`;
    const view = presentAgentRuntimeRequest(
      wireRequest("resolvedQuestion", {
        body: { kind: "question", questions: [question({})] },
        resolution: { kind: "answers", answers: [{ questionId: "q", optionIds: [], text }] },
      }),
    );

    expect(view.summary).toBe("1 attachment");
  });
});
