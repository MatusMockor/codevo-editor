// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import { CodeHighlighterProvider } from "../../infrastructure/codeHighlight/CodeHighlighterProvider";
import { createInlineCodeHighlighter } from "../../infrastructure/codeHighlight/inlineCodeHighlighter";
import type { AgentTurnItem } from "./agentModePresentation";
import { AgentToolRow } from "./AgentToolRow";
import { MAX_TOOL_OUTPUT_JSON_BYTES } from "./agentToolRowOutputFormat";

type ToolItem = Extract<AgentTurnItem, { kind: "tool" }>;

const highlighter = createInlineCodeHighlighter();

function tool(output: string, patch: Partial<ToolItem> = {}): ToolItem {
  return {
    kind: "tool",
    key: "tool-1",
    toolId: "toolu_1",
    name: "mcp__db__query",
    inputSummary: "select 1",
    outcome: { outputSummary: output, isError: false },
    rowKind: "other",
    status: "ok",
    label: "Called mcp__db__query",
    argument: null,
    command: null,
    output,
    ...patch,
  };
}

describe("AgentToolRow output", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(item: ToolItem, textClipboard?: TextClipboardGateway | null): void {
    act(() =>
      root.render(
        <CodeHighlighterProvider highlighter={highlighter} theme="calm-dark">
          <AgentToolRow item={item} textClipboard={textClipboard} />
        </CodeHighlighterProvider>,
      ),
    );
    act(() => host.querySelector<HTMLButtonElement>(".agent-tool-row")?.click());
  }

  function output(): HTMLElement {
    const element = host.querySelector<HTMLElement>(".agent-tool-row__output");
    if (element === null) throw new Error("Tool output is not rendered.");
    return element;
  }

  it("pretty-prints and highlights JSON output", async () => {
    render(tool('{"rows":[{"id":1,"name":"a"}],"ok":true}'));
    const pretty =
      '{\n  "rows": [\n    {\n      "id": 1,\n      "name": "a"\n    }\n  ],\n  "ok": true\n}';
    expect(output().textContent).toBe(pretty);
    expect(output().dataset.language).toBe("json");
    await waitFor(() => output().querySelector(".agent-md__code-colorized"));
    expect(output().textContent).toBe(pretty);
    const colors = [...output().querySelectorAll<HTMLElement>(".agent-md__code-line span")]
      .map((span) => span.style.color)
      .filter((color) => color !== "");
    expect(new Set(colors).size).toBeGreaterThan(1);
  });

  it("keeps invalid JSON plain", async () => {
    render(tool('{"rows": [1, 2'));
    await settle(200);
    expect(output().querySelector(".agent-md__code-colorized")).toBeNull();
    expect(output().textContent).toBe('{"rows": [1, 2');
    expect(output().dataset.language).toBeUndefined();
  });

  it("keeps huge output plain", async () => {
    const huge = `[${Array.from({ length: MAX_TOOL_OUTPUT_JSON_BYTES / 2 + 8 }, () => "1").join(",")}]`;
    render(tool(huge));
    await settle(200);
    expect(output().querySelector(".agent-md__code-colorized")).toBeNull();
    expect(output().textContent).toBe(huge);
  });

  it("copies the raw output, not the reformatted text", async () => {
    const written: string[] = [];
    const clipboard: TextClipboardGateway = {
      canWriteText: () => true,
      writeText: async (text) => {
        written.push(text);
      },
    };
    const raw = '{"id":12345678901234567890,"id":2}';
    render(tool(raw), clipboard);
    expect(output().textContent).toBe('{\n  "id": 12345678901234567890,\n  "id": 2\n}');
    const copy = host.querySelector<HTMLButtonElement>('button[aria-label="Copy tool output"]');
    expect(copy).not.toBeNull();
    await act(async () => copy?.click());
    expect(written).toEqual([raw]);
  });

  it("renders no copy button without clipboard wiring", () => {
    render(tool("plain text"));
    expect(host.querySelector('button[aria-label="Copy tool output"]')).toBeNull();
    expect(output().textContent).toBe("plain text");
  });
});

async function settle(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function waitFor<T>(find: () => T | null): Promise<T> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const found = find();
    if (found !== null) return found;
    await settle(25);
  }
  throw new Error("Timed out waiting for highlighted output.");
}
