import { describe, expect, it } from "vitest";
import {
  breakpointLogMessageError,
  isBreakpointLogMessage,
  MAX_DEBUG_LOG_EXPRESSION_BYTES,
  MAX_DEBUG_LOG_EXPRESSIONS,
  MAX_DEBUG_LOG_MESSAGE_BYTES,
  parseDebugLogMessage,
} from "./debugBreakpointLogMessage";

describe("debug breakpoint log messages", () => {
  it("parses expressions and escaped braces like the Rust contract", () => {
    expect(parseDebugLogMessage("count={{ { count } }}")).toEqual({
      segments: [
        { kind: "literal", value: "count={ " },
        { kind: "expression", value: "count" },
        { kind: "literal", value: " }" },
      ],
    });
    expect(isBreakpointLogMessage("user={user.id}")).toBe(true);
  });

  it.each(["", "   ", "{", "}", "{}", "{a{b}}", "hello\0world"])(
    "rejects malformed message %j",
    (message) => expect(parseDebugLogMessage(message)).toBeNull(),
  );

  it("enforces the Rust UTF-8 byte and expression-count limits", () => {
    expect(parseDebugLogMessage("ž".repeat(MAX_DEBUG_LOG_MESSAGE_BYTES / 2))).not.toBeNull();
    expect(parseDebugLogMessage(`${"x".repeat(MAX_DEBUG_LOG_MESSAGE_BYTES)}x`)).toBeNull();
    expect(parseDebugLogMessage(`{${"x".repeat(MAX_DEBUG_LOG_EXPRESSION_BYTES + 1)}}`)).toBeNull();
    expect(parseDebugLogMessage("{x}".repeat(MAX_DEBUG_LOG_EXPRESSIONS + 1))).toBeNull();
  });

  it("keeps blank editor input clearable while explaining invalid nonblank input", () => {
    expect(breakpointLogMessageError("  ")).toBeNull();
    expect(breakpointLogMessageError("value={x}")).toBeNull();
    expect(breakpointLogMessageError("value={")).toMatch(/expressions/i);
  });

  it("matches Rust whitespace semantics and rejects non-scalar UTF-16", () => {
    expect(parseDebugLogMessage("\u0085")).toBeNull();
    expect(parseDebugLogMessage("{\u0085}")).toBeNull();
    expect(parseDebugLogMessage("\ufeff")).toEqual({
      segments: [{ kind: "literal", value: "\ufeff" }],
    });
    expect(parseDebugLogMessage("{\ufeff}")).toEqual({
      segments: [{ kind: "expression", value: "\ufeff" }],
    });
    for (const malformed of ["\ud800", "\udc00", "a\ud800b", "{\udc00}"]) {
      expect(parseDebugLogMessage(malformed)).toBeNull();
      expect(breakpointLogMessageError(malformed)).toMatch(/Unicode/);
    }
  });
});
