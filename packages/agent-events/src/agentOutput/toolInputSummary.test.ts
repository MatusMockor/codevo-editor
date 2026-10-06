import { describe, expect, it } from "vitest";
import { MAX_AGENT_TOOL_SUMMARY_BYTES } from "../agentTurnEventLimits.js";
import { summarizeToolInput, summarizeToolOutput } from "./toolInputSummary.js";
import { utf8ByteLength } from "./utf8Text.js";

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
    expect(summarizeToolInput("Grep", { pattern: "TODO", path: "/repo" })).toBe("TODO in /repo");
    expect(summarizeToolInput("Grep", { pattern: "TODO", output_mode: "content" })).toBe("TODO");
    expect(summarizeToolInput("Glob", { pattern: "**/*.ts" })).toBe("**/*.ts");
  });

  it("uses the meaningful argument for notebook and web tools", () => {
    expect(
      summarizeToolInput("NotebookEdit", { notebook_path: "/repo/a.ipynb", new_source: "x" }),
    ).toBe("/repo/a.ipynb");
    expect(summarizeToolInput("WebFetch", { url: "https://example.com", prompt: "sum" })).toBe(
      "https://example.com",
    );
    expect(summarizeToolInput("WebSearch", { query: "vitest act", allowed_domains: [] })).toBe(
      "vitest act",
    );
    expect(
      summarizeToolInput("MultiEdit", { file_path: "/repo/b.ts", edits: [{ old_string: "a" }] }),
    ).toBe("/repo/b.ts");
  });

  it("summarizes TodoWrite as a readable status list", () => {
    expect(
      summarizeToolInput("TodoWrite", {
        todos: [
          { content: "Read spec", status: "completed", activeForm: "Reading spec" },
          { content: "Write  code\n now", status: "in_progress", activeForm: "Writing" },
          { content: "Run tests", status: "pending", activeForm: "Running" },
          { content: "Odd", status: "blocked" },
          { status: "pending" },
        ],
      }),
    ).toBe("5 todos: ✓ Read spec, → Write code now, ○ Run tests, • Odd");
    expect(summarizeToolInput("TodoWrite", { todos: [] })).toBe("0 todos");
    expect(summarizeToolInput("TodoWrite", { todos: [{ content: "x", status: "pending" }] })).toBe(
      "1 todo: ○ x",
    );
    expect(summarizeToolInput("TodoWrite", { todos: "nope" })).toBe('{"todos":"nope"}');
  });

  it("bounds TodoWrite summaries with ellipsis markers", () => {
    const todos = Array.from({ length: 500 }, (_, index) => ({
      content: `${"long task ".repeat(30)}${index}`,
      status: "pending",
    }));
    const summary = summarizeToolInput("TodoWrite", { todos });

    expect(summary.startsWith("500 todos: ○ long task")).toBe(true);
    expect(summary.endsWith("…")).toBe(true);
    expect(summary).toContain("…, ○");
    expect(utf8ByteLength(summary)).toBeLessThanOrEqual(MAX_AGENT_TOOL_SUMMARY_BYTES);
  });

  it("uses the description for subagent spawn tools instead of the whole prompt", () => {
    for (const name of ["Agent", "Task"]) {
      expect(
        summarizeToolInput(name, {
          description: "Review UI",
          prompt: "a".repeat(MAX_AGENT_TOOL_SUMMARY_BYTES * 4),
          subagent_type: "general-purpose",
        }),
      ).toBe("Review UI");
    }
  });

  it("falls back to JSON for unknown tools and unusable fields", () => {
    expect(summarizeToolInput("Task", { prompt: "go" })).toBe('{"prompt":"go"}');
    expect(summarizeToolInput("Bash", { command: 7 })).toBe('{"command":7}');
    expect(summarizeToolInput("Read", {})).toBe("{}");
    expect(summarizeToolInput("Read", undefined)).toBe("");
  });

  it("clips a long summary head-only on a UTF-8 boundary with an ellipsis", () => {
    const summary = summarizeToolInput("Bash", {
      command: "é".repeat(MAX_AGENT_TOOL_SUMMARY_BYTES),
    });

    expect(utf8ByteLength(summary)).toBe(MAX_AGENT_TOOL_SUMMARY_BYTES - 1);
    expect(summary).toBe(`${"é".repeat(254)}…`);
  });

  it("keeps a summary that exactly fits the budget unmarked", () => {
    const command = "a".repeat(MAX_AGENT_TOOL_SUMMARY_BYTES);
    expect(summarizeToolInput("Bash", { command })).toBe(command);
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

  it("clips long output to its head and tail on UTF-8 boundaries", () => {
    const summary = summarizeToolOutput("𝄞".repeat(MAX_AGENT_TOOL_SUMMARY_BYTES));

    expect(utf8ByteLength(summary)).toBeLessThanOrEqual(MAX_AGENT_TOOL_SUMMARY_BYTES);
    expect(summary).toMatch(/^(?:𝄞)+\n… \d+ bytes omitted …\n(?:𝄞)+$/u);
  });

  it("keeps the tail of long output where failures are usually reported", () => {
    const summary = summarizeToolOutput(`start\n${"noise\n".repeat(400)}FAIL src/a.test.ts`);

    expect(summary.startsWith("start\n")).toBe(true);
    expect(summary.endsWith("FAIL src/a.test.ts")).toBe(true);
    expect(summary).toMatch(/\n… \d+ bytes omitted …\n/u);
  });

  it("counts the bytes the supervisor already elided so a compacted output reads like the original", () => {
    const original = `start\n${"noise line\n".repeat(4_000)}FAIL src/a.test.ts`;
    const compacted = supervisorCompacted(original);
    const image = [{ type: "image", source: { type: "base64", data: "iVBOR".repeat(40_000) } }];
    const compactedImage = [
      {
        type: "image",
        source: { type: "base64", data: supervisorCompacted(image[0].source.data) },
      },
    ];

    expect(utf8ByteLength(compacted)).toBeLessThan(utf8ByteLength(original) / 10);
    expect(summarizeToolOutput(compacted)).toBe(summarizeToolOutput(original));
    expect(summarizeToolOutput([{ type: "text", text: compacted }])).toBe(
      summarizeToolOutput([{ type: "text", text: original }]),
    );
    expect(summarizeToolOutput(compactedImage)).toBe(summarizeToolOutput(image));
    expect(summarizeToolOutput(compacted)).toContain(
      `… ${utf8ByteLength(original) - utf8ByteLength(summarizeToolOutput(original)) + omissionMarkerBytes(summarizeToolOutput(original))} bytes omitted …`,
    );
  });

  it("keeps a short output that mentions an omission verbatim", () => {
    const short = "kept\n… 900000 bytes omitted …\nkept";

    expect(summarizeToolOutput(short)).toBe(short);
  });
});

const SUPERVISOR_EDGE_BYTES = 512;

function supervisorCompacted(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const decoder = new TextDecoder();
  const head = decoder.decode(bytes.subarray(0, SUPERVISOR_EDGE_BYTES));
  const tail = decoder.decode(bytes.subarray(bytes.length - SUPERVISOR_EDGE_BYTES));
  return `${head}\n… ${bytes.length - 2 * SUPERVISOR_EDGE_BYTES} bytes omitted …\n${tail}`;
}

function omissionMarkerBytes(summary: string): number {
  const marker = /\n… \d+ bytes omitted …\n/u.exec(summary)?.[0] ?? "";
  return utf8ByteLength(marker);
}
