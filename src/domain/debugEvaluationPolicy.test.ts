import { describe, expect, it } from "vitest";
import {
  DEBUG_CLIPBOARD_EVALUATION_POLICY,
  DEBUG_REPL_EVALUATION_POLICY,
  DEBUG_WATCH_EVALUATION_POLICY,
  MAX_DEBUG_EVALUATION_EXPRESSION_BYTES,
  debugEvaluationOwnersEqual,
  debugEvaluationPolicyForContext,
  debugUtf8ByteLength,
  isDebugEvaluationOwner,
  isDebugEvaluationPolicy,
  isBoundedDebugEvaluateName,
  validateDebugExpression,
} from "./debugEvaluationPolicy";

describe("debug evaluation policy", () => {
  it("keeps clipboard and repl explicit while watches remain read-only", () => {
    expect(DEBUG_CLIPBOARD_EVALUATION_POLICY).toEqual({
      context: "clipboard",
      allowSideEffects: true,
    });
    expect(DEBUG_REPL_EVALUATION_POLICY).toEqual({ context: "repl", allowSideEffects: true });
    expect(DEBUG_WATCH_EVALUATION_POLICY).toEqual({ context: "watch", allowSideEffects: false });
    expect(debugEvaluationPolicyForContext("clipboard")).toBe(DEBUG_CLIPBOARD_EVALUATION_POLICY);
    expect(debugEvaluationPolicyForContext("repl")).toBe(DEBUG_REPL_EVALUATION_POLICY);
    expect(debugEvaluationPolicyForContext("watch")).toBe(DEBUG_WATCH_EVALUATION_POLICY);
    expect(isDebugEvaluationPolicy(DEBUG_CLIPBOARD_EVALUATION_POLICY)).toBe(true);
    expect(isDebugEvaluationPolicy(DEBUG_REPL_EVALUATION_POLICY)).toBe(true);
    expect(isDebugEvaluationPolicy({ context: "clipboard", allowSideEffects: false })).toBe(false);
    expect(isDebugEvaluationPolicy({ context: "repl", allowSideEffects: false })).toBe(false);
    expect(isDebugEvaluationPolicy({ context: "watch", allowSideEffects: true })).toBe(false);
    expect(isDebugEvaluationPolicy({ ...DEBUG_REPL_EVALUATION_POLICY, extra: true })).toBe(false);
  });

  it("validates exact UTF-8 byte limits without rewriting expressions", () => {
    const exact = "ž".repeat(MAX_DEBUG_EVALUATION_EXPRESSION_BYTES / 2);
    expect(debugUtf8ByteLength(exact)).toBe(MAX_DEBUG_EVALUATION_EXPRESSION_BYTES);
    expect(validateDebugExpression(exact)).toEqual({ ok: true, expression: exact });
    expect(validateDebugExpression(`${exact}ž`)).toEqual({ ok: false, reason: "too-large" });
    expect(validateDebugExpression("  count + 1  ")).toEqual({
      ok: true,
      expression: "  count + 1  ",
    });
    expect(validateDebugExpression("count\t+ 1")).toEqual({
      ok: true,
      expression: "count\t+ 1",
    });
  });

  it("accepts only bounded adapter evaluate names with exact valid line endings", () => {
    const exact = "(\n  root\n).nested.b";
    expect(isBoundedDebugEvaluateName(exact)).toBe(true);
    expect(isBoundedDebugEvaluateName("root\r\n.nested")).toBe(true);
    for (const malformed of ["", "   ", "root\r.nested", "root\u000b.nested", "x".repeat(4_097)]) {
      expect(isBoundedDebugEvaluateName(malformed)).toBe(false);
    }
  });

  it.each([
    [null, "type"],
    [" \t ", "empty"],
    ["", "empty"],
    ["value\nnext", "control"],
    ["value\0next", "control"],
    ["value\u0085next", "control"],
  ])("rejects invalid expression %j", (value, reason) => {
    expect(validateDebugExpression(value)).toEqual({ ok: false, reason });
  });

  it("requires exact positive owner fields and compares both generations", () => {
    const owner = { sessionId: 7, pauseGeneration: 3 };
    expect(isDebugEvaluationOwner(owner)).toBe(true);
    expect(isDebugEvaluationOwner({ ...owner, extra: true })).toBe(false);
    expect(isDebugEvaluationOwner({ sessionId: -1, pauseGeneration: 3 })).toBe(false);
    expect(isDebugEvaluationOwner({ sessionId: 0, pauseGeneration: 3 })).toBe(false);
    expect(isDebugEvaluationOwner({ sessionId: 7, pauseGeneration: 0 })).toBe(false);
    expect(debugEvaluationOwnersEqual(owner, { ...owner })).toBe(true);
    expect(debugEvaluationOwnersEqual(owner, { ...owner, pauseGeneration: 4 })).toBe(false);
    expect(debugEvaluationOwnersEqual(null, null)).toBe(true);
  });
});
