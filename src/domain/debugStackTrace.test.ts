import { describe, expect, it } from "vitest";
import type { StackFrame } from "./debug";
import {
  DEBUG_STACK_TRACE_TRUNCATION_MARKER,
  formatDebugStackTrace,
  MAX_DEBUG_STACK_TRACE_FRAMES,
} from "./debugStackTrace";

const frame: StackFrame = {
  frameId: 1,
  name: "main",
  filePath: "/workspace/src/index.ts",
  lineNumber: 12,
  column: 37,
};

describe("formatDebugStackTrace", () => {
  it("matches official filesystem and fileless StackFrame.toString shapes", () => {
    expect(
      formatDebugStackTrace([
        frame,
        { ...frame, frameId: 2, name: "nativeCall", filePath: null, lineNumber: 0, column: 0 },
      ]),
    ).toBe("main (/workspace/src/index.ts:12)\nnativeCall");
  });

  it("uses the full path and line while intentionally ignoring column", () => {
    expect(formatDebugStackTrace([{ ...frame, column: 999 }])).toBe(
      "main (/workspace/src/index.ts:12)",
    );
  });

  it("marks a bounded partial stack explicitly when copied", () => {
    expect(formatDebugStackTrace([frame], true)).toBe(
      `main (/workspace/src/index.ts:12)\n${DEBUG_STACK_TRACE_TRUNCATION_MARKER}`,
    );
  });

  it("fails closed for empty, malformed, injected, or unbounded frames without mutation", () => {
    const original = [{ ...frame }];
    expect(formatDebugStackTrace([])).toBeNull();
    expect(formatDebugStackTrace([{ ...frame, name: "bad\nframe" }])).toBeNull();
    expect(formatDebugStackTrace([{ ...frame, lineNumber: 0 }])).toBeNull();
    expect(
      formatDebugStackTrace(
        Array.from({ length: MAX_DEBUG_STACK_TRACE_FRAMES + 1 }, (_, index) => ({
          ...frame,
          frameId: index + 1,
        })),
      ),
    ).toBeNull();
    expect(formatDebugStackTrace(original)).not.toBeNull();
    expect(original).toEqual([{ ...frame }]);
  });
});
