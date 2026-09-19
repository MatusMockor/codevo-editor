import { describe, expect, it } from "vitest";
import wire from "../../contracts/agent-turn-log-wire.json";
import type { AgentTurnEvent } from "./agentThread";
import { MAX_AGENT_TASK_PROMPT_BYTES } from "./agentTask";
import { serializeTurnEvent } from "./agentThreadWire";
import {
  AGENT_TURN_LOG_ERRORS,
  AGENT_TURN_LOG_LIMITS,
  AgentTurnLogFailure,
  isAgentTurnLogBatchTooLarge,
} from "./agentTurnLog";
import {
  agentTurnLogFailureFrom,
  agentTurnLogOpBytes,
  agentTurnLogOpsBytes,
  parseAgentTurnDigest,
  parseAgentTurnLogLease,
  parseAgentTurnLogLoss,
  parseAgentTurnLogPage,
  parseAgentTurnLogScope,
  parseAgentTurnLogSummaries,
  parseAppendAgentTurnLogReceipt,
  parseDeleteAgentThreadLogResult,
  validateAppendAgentTurnLogRequest,
  validateDeleteAgentThreadLogRequest,
  validateOpenAgentTurnLogRequest,
  validateReadAgentTurnLogPageRequest,
  validateSummarizeAgentTurnLogsRequest,
} from "./agentTurnLogWire";

interface Rejected {
  readonly why: string;
  readonly value: unknown;
}

function rejects(cases: ReadonlyArray<Rejected>, parse: (value: unknown) => unknown): void {
  const accepted: string[] = [];
  for (const entry of cases) {
    let threw = false;
    try {
      parse(entry.value);
    } catch {
      threw = true;
    }
    if (!threw) accepted.push(entry.why);
  }
  expect(accepted).toEqual([]);
}

describe("agent turn log wire contract", () => {
  it("shares the limits both sides enforce", () => {
    expect(wire.schemaVersion).toBe(1);
    expect(wire.limits.appendOps).toBe(AGENT_TURN_LOG_LIMITS.appendOps);
    expect(wire.limits.appendBytes).toBe(AGENT_TURN_LOG_LIMITS.appendBytes);
    expect(wire.limits.pageEvents).toBe(AGENT_TURN_LOG_LIMITS.pageEvents);
    expect(wire.limits.pageBytes).toBe(AGENT_TURN_LOG_LIMITS.pageBytes);
    expect(wire.limits.digestBytes).toBe(AGENT_TURN_LOG_LIMITS.digestBytes);
    expect(wire.limits.summaries).toBe(AGENT_TURN_LOG_LIMITS.summaries);
    expect(wire.limits.promptBytes).toBe(AGENT_TURN_LOG_LIMITS.promptBytes);
    expect(wire.limits.promptBytes).toBe(MAX_AGENT_TASK_PROMPT_BYTES);
    expect(wire.limits.summaryPromptBytes).toBe(AGENT_TURN_LOG_LIMITS.summaryPromptBytes);
    expect(wire.limits.seqBase).toBe(1);
    expect(wire.errors).toEqual([...AGENT_TURN_LOG_ERRORS]);
  });

  it("accepts the shared scope and every loss variant", () => {
    expect(parseAgentTurnLogScope(wire.scope)).toEqual(wire.scope);
    for (const loss of wire.losses) expect(parseAgentTurnLogLoss(loss)).toEqual(loss);
  });

  it("rejects every rejected loss", () => {
    rejects(wire.rejectedLosses, (value) => parseAgentTurnLogLoss(value));
  });

  it("round-trips every digest and rejects the invalid ones", () => {
    for (const digest of wire.digests) expect(parseAgentTurnDigest(digest)).toEqual(digest);
    rejects(wire.rejectedDigests, (value) => parseAgentTurnDigest(value));
  });

  it("validates every outbound request shape", () => {
    for (const request of wire.requests.open)
      expect(validateOpenAgentTurnLogRequest(request as never)).toEqual(request);
    for (const request of wire.requests.append)
      expect(validateAppendAgentTurnLogRequest(request as never)).toEqual(request);
    for (const request of wire.requests.page)
      expect(validateReadAgentTurnLogPageRequest(request as never)).toEqual(request);
    for (const request of wire.requests.summarize)
      expect(validateSummarizeAgentTurnLogsRequest(request as never)).toEqual(request);
  });

  it("refuses every rejected request", () => {
    rejects(wire.rejectedRequests.open, (value) => validateOpenAgentTurnLogRequest(value as never));
    rejects(wire.rejectedRequests.append, (value) =>
      validateAppendAgentTurnLogRequest(value as never),
    );
    rejects(wire.rejectedRequests.page, (value) =>
      validateReadAgentTurnLogPageRequest(value as never),
    );
    rejects(wire.rejectedRequests.summarize, (value) =>
      validateSummarizeAgentTurnLogsRequest(value as never),
    );
  });

  it("parses every inbound response and refuses the invalid ones", () => {
    for (const lease of wire.leases) expect(parseAgentTurnLogLease(lease)).toEqual(lease);
    rejects(wire.rejectedLeases, parseAgentTurnLogLease);

    for (const receipt of wire.receipts)
      expect(parseAppendAgentTurnLogReceipt(receipt)).toEqual(receipt);
    rejects(wire.rejectedReceipts, parseAppendAgentTurnLogReceipt);

    for (const page of wire.pages) expect(parseAgentTurnLogPage(page)).toEqual(page);
    rejects(wire.rejectedPages, parseAgentTurnLogPage);

    for (const summaries of wire.summaries)
      expect(parseAgentTurnLogSummaries(summaries)).toEqual(summaries);
    rejects(wire.rejectedSummaries, parseAgentTurnLogSummaries);
  });

  it("maps only closed backend codes to a typed failure", () => {
    for (const code of wire.errors) {
      const failure = agentTurnLogFailureFrom(code);
      expect(failure).toBeInstanceOf(AgentTurnLogFailure);
      expect(failure?.code).toBe(code);
      expect(agentTurnLogFailureFrom(new Error(code))?.code).toBe(code);
    }
    for (const code of wire.rejectedErrors) expect(agentTurnLogFailureFrom(code)).toBeNull();
    expect(agentTurnLogFailureFrom({ code: "sealed" })).toBeNull();
  });

  it("keeps the retryable busy code in the closed error set", () => {
    expect(wire.errors).toContain("busy");
    expect(agentTurnLogFailureFrom("busy")?.code).toBe("busy");
  });

  it("round-trips the thread log deletion request and result", () => {
    for (const request of wire.requests.deleteThreadLog)
      expect(validateDeleteAgentThreadLogRequest(request as never)).toEqual(request);
    rejects(wire.rejectedRequests.deleteThreadLog, (value) =>
      validateDeleteAgentThreadLogRequest(value as never),
    );
    for (const result of wire.deleteThreadLogResults)
      expect(parseDeleteAgentThreadLogResult(result)).toEqual(result);
    rejects(wire.rejectedDeleteThreadLogResults, parseDeleteAgentThreadLogResult);
  });

  it("carries the log's own next sequence on a structured sequence gap", () => {
    for (const entry of wire.sequenceGapErrors) {
      const failure = agentTurnLogFailureFrom(entry.value);
      expect(failure?.code).toBe("sequenceGap");
      expect(failure?.nextSeq).toBe(entry.nextSeq);
      expect(agentTurnLogFailureFrom(new Error(entry.value))?.nextSeq).toBe(entry.nextSeq);
    }
  });

  it("leaves an unreconcilable sequence gap without a sequence", () => {
    for (const entry of wire.plainSequenceGapErrors) {
      const failure = agentTurnLogFailureFrom(entry.value);
      expect(failure?.code).toBe("sequenceGap");
      expect(failure?.nextSeq).toBeNull();
    }
  });

  it("measures an operation exactly as the append bound does", () => {
    const events: ReadonlyArray<AgentTurnEvent> = [
      { kind: "assistantText", text: 'line\nwith "quotes" and \\ escapes\n' },
      { kind: "reasoning", text: "\u0000\u001f tabs\t and emoji \u{1f600}" },
      { kind: "toolResult", toolId: "tool-1", outputSummary: "ok", isError: false },
    ];
    const ops = events.map((event, index) => ({ seq: index + 9, event }));
    for (const op of ops)
      expect(agentTurnLogOpBytes(op)).toBe(
        new TextEncoder().encode(
          JSON.stringify({ seq: op.seq, event: serializeTurnEvent(op.event) }),
        ).byteLength,
      );
    expect(agentTurnLogOpsBytes(ops)).toBe(
      new TextEncoder().encode(
        JSON.stringify(ops.map((op) => ({ seq: op.seq, event: serializeTurnEvent(op.event) }))),
      ).byteLength,
    );
    expect(agentTurnLogOpsBytes([])).toBe(2);
  });

  it("refuses an oversized batch with a typed failure the writer can shrink", () => {
    const ops = Array.from({ length: 200 }, (_, index) => ({
      seq: index + 1,
      event: { kind: "assistantText", text: "\n".repeat(8_000) },
    }));
    const thrown = (): unknown => {
      try {
        validateAppendAgentTurnLogRequest({
          scope: wire.scope,
          writerEpoch: 1,
          expectedNextSeq: 1,
          ops,
          digest: null,
          seal: false,
          loss: { kind: "none" },
        } as never);
        return null;
      } catch (error) {
        return error;
      }
    };
    expect(isAgentTurnLogBatchTooLarge(thrown())).toBe(true);
    expect(isAgentTurnLogBatchTooLarge(new TypeError("other"))).toBe(false);
  });
});

describe("agent turn log wire boundaries", () => {
  const scope = wire.scope;

  it("drops runtime-only event fields instead of refusing the append", () => {
    const request = {
      scope,
      writerEpoch: 1,
      expectedNextSeq: 1,
      ops: [{ seq: 1, event: { kind: "userMessage", text: "hello", remoteMessageId: "msg-1" } }],
      digest: null,
      seal: false,
      loss: { kind: "none" },
    };
    expect(validateAppendAgentTurnLogRequest(request as never).ops[0]?.event).toEqual({
      kind: "userMessage",
      text: "hello",
    });
  });

  it("refuses an append batch above the byte bound", () => {
    const ops = Array.from({ length: 200 }, (_, index) => ({
      seq: index + 1,
      event: { kind: "assistantText", text: "x".repeat(8_000) },
    }));
    expect(() =>
      validateAppendAgentTurnLogRequest({
        scope,
        writerEpoch: 1,
        expectedNextSeq: 1,
        ops,
        digest: null,
        seal: false,
        loss: { kind: "none" },
      } as never),
    ).toThrow(/at most 1048576 bytes/u);
  });

  it("refuses more operations than a batch may carry", () => {
    const ops = Array.from({ length: AGENT_TURN_LOG_LIMITS.appendOps + 1 }, (_, index) => ({
      seq: index + 1,
      event: { kind: "assistantText", text: "x" },
    }));
    expect(() =>
      validateAppendAgentTurnLogRequest({
        scope,
        writerEpoch: 1,
        expectedNextSeq: 1,
        ops,
        digest: null,
        seal: false,
        loss: { kind: "none" },
      } as never),
    ).toThrow(/at most 256 operations/u);
  });

  it("covers both prompt shapes and both prompt intents the fixture pins", () => {
    expect(wire.requests.open.map((request) => request.prompt)).toEqual([
      "Explain the failing test in src/app.ts.",
      null,
    ]);
    expect(wire.requests.summarize.map((request) => request.includePrompts)).toEqual([false, true]);
    expect(wire.rejectedRequests.open.map((entry) => entry.why)).toContain(
      "prompt carries a NUL byte",
    );
    expect(wire.rejectedRequests.open.map((entry) => entry.why)).toContain(
      "prompt is not a string",
    );
    expect(wire.rejectedRequests.summarize.map((entry) => entry.why)).toContain(
      "includePrompts is not a boolean",
    );
    expect(wire.rejectedSummaries.map((entry) => entry.why)).toContain(
      "a carried prompt contradicts promptOmitted",
    );
    expect(wire.rejectedSummaries.map((entry) => entry.why)).toContain("prompt is not a string");
    expect(wire.summaries.flat().some((summary) => typeof summary.prompt === "string")).toBe(true);
    expect(wire.summaries.flat().some((summary) => summary.promptOmitted)).toBe(true);
  });

  it("refuses an opening prompt above the prompt byte bound", () => {
    const open = (prompt: string): unknown =>
      validateOpenAgentTurnLogRequest({ scope, priorLoss: { kind: "none" }, prompt } as never);

    expect(() => open("a".repeat(AGENT_TURN_LOG_LIMITS.promptBytes))).not.toThrow();
    expect(() => open("a".repeat(AGENT_TURN_LOG_LIMITS.promptBytes + 1))).toThrow(
      /at most 32768 bytes/u,
    );
    expect(() => open("")).toThrow(/a non-empty prompt/u);
  });

  it("refuses a summary response whose carried prompts exceed the shared budget", () => {
    const prompt = "p".repeat(AGENT_TURN_LOG_LIMITS.promptBytes);
    const summaries = Array.from({ length: 17 }, (_unused, index) => ({
      turnId: `turn-0a1b2c${String(index).padStart(2, "0")}`,
      eventCount: 1,
      bytes: 1,
      loss: { kind: "none" },
      sealed: true,
      digest: null,
      prompt,
      promptOmitted: false,
    }));

    expect(() => parseAgentTurnLogSummaries(summaries.slice(0, 16))).not.toThrow();
    expect(() => parseAgentTurnLogSummaries(summaries)).toThrow(/at most 524288 prompt bytes/u);
  });

  it("refuses a scope whose owner id does not belong to the root key", () => {
    expect(() => parseAgentTurnLogScope({ ...scope, rootKey: "/projects/other" })).toThrow(
      /persistent agent root owner id/u,
    );
  });
});
