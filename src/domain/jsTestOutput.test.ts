import { describe, expect, it } from "vitest";
import { MAX_JS_TEST_OUTPUT_STREAM_BYTES, type JsTestTaskOutput } from "./jsTestTask";
import {
  aggregateJsTestTaskOutputs,
  formatJsTestOutput,
  jsTestOutputSnapshot,
} from "./jsTestOutput";

describe("JavaScript test output", () => {
  it("creates a deeply frozen owner-bound snapshot without retaining mutable input", () => {
    const owner = { rootPath: "/workspace", workspaceId: "workspace-1" };
    const output = taskOutput("hello", "warning");
    const snapshot = jsTestOutputSnapshot(owner, 3, output);

    expect(snapshot).toEqual({ generation: 3, output, owner });
    expect(snapshot.owner).not.toBe(owner);
    expect(snapshot.output).not.toBe(output);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.owner)).toBe(true);
    expect(Object.isFrozen(snapshot.output)).toBe(true);
    expect(Object.isFrozen(snapshot.output.stdout)).toBe(true);
    expect(() => jsTestOutputSnapshot(owner, -1, output)).toThrow(/generation/);
  });

  it("aggregates streams independently in order and propagates child truncation", () => {
    const aggregate = aggregateJsTestTaskOutputs([
      taskOutput("first", "", true, false),
      taskOutput("", "warning"),
      taskOutput("second", "error"),
    ]);

    expect(aggregate).toEqual({
      stderr: { text: "warning\nerror", truncated: false },
      stdout: { text: "first\nsecond", truncated: true },
    });
    expect(Object.isFrozen(aggregate)).toBe(true);
    expect(Object.isFrozen(aggregate.stderr)).toBe(true);
    expect(Object.isFrozen(aggregate.stdout)).toBe(true);
  });

  it("keeps an exact UTF-8 tail at 64 KiB and never splits a multibyte character", () => {
    const prefix = "x".repeat(MAX_JS_TEST_OUTPUT_STREAM_BYTES - 1);
    const aggregate = aggregateJsTestTaskOutputs([
      taskOutput(prefix, ""),
      taskOutput("🙂tail", ""),
    ]);
    const bytes = new TextEncoder().encode(aggregate.stdout.text);

    expect(aggregate.stdout.truncated).toBe(true);
    expect(bytes.byteLength).toBeLessThanOrEqual(MAX_JS_TEST_OUTPUT_STREAM_BYTES);
    expect(aggregate.stdout.text).toMatch(/🙂tail$/u);
    expect(aggregate.stdout.text).not.toContain("�");
  });

  it("formats only present streams with explicit truthful truncation notices", () => {
    expect(formatJsTestOutput(taskOutput("pass", "fail", true, false))).toBe(
      "stdout\n[Earlier output was truncated.]\npass\n\nstderr\nfail",
    );
    expect(formatJsTestOutput(taskOutput("", "", false, true))).toBe(
      "stderr\n[Earlier output was truncated.]\n",
    );
    expect(formatJsTestOutput(taskOutput("", ""))).toBe("");
  });
});

function taskOutput(
  stdout: string,
  stderr: string,
  stdoutTruncated = false,
  stderrTruncated = false,
): JsTestTaskOutput {
  return {
    stderr: { text: stderr, truncated: stderrTruncated },
    stdout: { text: stdout, truncated: stdoutTruncated },
  };
}
