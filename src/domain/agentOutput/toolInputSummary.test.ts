import { describe, expect, it } from "vitest";
import { MAX_AGENT_TOOL_SUMMARY_BYTES } from "../agentThread";
import { summarizeToolInput, summarizeToolOutput } from "./toolInputSummary";
import { utf8ByteLength } from "./utf8Text";

describe("summarizeToolInput", () => {
  it("uses the file path for file tools", () => {
    for (const name of ["Read", "Edit", "Write", "MultiEdit"]) {
      expect(summarizeToolInput(name, { file_path: "/repo/a.txt", offset: 1 })).toBe("/repo/a.txt");
    }
  });

  it("uses the command for Bash and the pattern for search tools", () => {
    expect(summarizeToolInput("Bash", { command: "npm test", description: "run" })).toBe(
      "npm test",
    );
    expect(summarizeToolInput("Grep", { pattern: "TODO", path: "/repo" })).toBe("TODO");
    expect(summarizeToolInput("Glob", { pattern: "**/*.ts" })).toBe("**/*.ts");
  });

  it("falls back to JSON for unknown tools and unusable fields", () => {
    expect(summarizeToolInput("Task", { prompt: "go" })).toBe('{"prompt":"go"}');
    expect(summarizeToolInput("Bash", { command: 7 })).toBe('{"command":7}');
    expect(summarizeToolInput("Read", {})).toBe("{}");
    expect(summarizeToolInput("Read", undefined)).toBe("");
  });

  it("clips a long summary on a UTF-8 boundary", () => {
    const summary = summarizeToolInput("Bash", {
      command: "é".repeat(MAX_AGENT_TOOL_SUMMARY_BYTES),
    });

    expect(utf8ByteLength(summary)).toBe(MAX_AGENT_TOOL_SUMMARY_BYTES);
    expect(summary).toBe("é".repeat(MAX_AGENT_TOOL_SUMMARY_BYTES / 2));
  });

  it("drops NUL characters so the summary stays persistable", () => {
    expect(summarizeToolInput("Bash", { command: "echo \u0000 hi" })).toBe("echo  hi");
  });
});

describe("summarizeToolOutput", () => {
  it("keeps string content and joins text blocks", () => {
    expect(summarizeToolOutput("ok")).toBe("ok");
    expect(
      summarizeToolOutput([
        { type: "text", text: "first" },
        { type: "text", text: "second" },
      ]),
    ).toBe("first\nsecond");
  });

  it("falls back to JSON for other content shapes", () => {
    expect(summarizeToolOutput({ ok: true })).toBe('{"ok":true}');
    expect(summarizeToolOutput([{ type: "image" }])).toBe('[{"type":"image"}]');
    expect(summarizeToolOutput(undefined)).toBe("");
  });

  it("clips long output on a UTF-8 boundary", () => {
    const summary = summarizeToolOutput("𝄞".repeat(MAX_AGENT_TOOL_SUMMARY_BYTES));

    expect(utf8ByteLength(summary)).toBe(MAX_AGENT_TOOL_SUMMARY_BYTES);
    expect(summary).toBe("𝄞".repeat(MAX_AGENT_TOOL_SUMMARY_BYTES / 4));
  });
});
