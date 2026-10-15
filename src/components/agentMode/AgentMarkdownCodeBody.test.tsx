// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  CodeHighlighter,
  CodeHighlightRequest,
} from "../../application/codeHighlight/codeHighlighter";
import { CodeHighlighterProvider } from "../../infrastructure/codeHighlight/CodeHighlighterProvider";
import { createInlineCodeHighlighter } from "../../infrastructure/codeHighlight/inlineCodeHighlighter";
import { AgentMarkdownCodeBody } from "./AgentMarkdownCodeBody";

const shared = createInlineCodeHighlighter();

function recording(): { readonly highlighter: CodeHighlighter; readonly requests: string[] } {
  const requests: string[] = [];
  return {
    requests,
    highlighter: {
      highlight(request: CodeHighlightRequest, signal?: AbortSignal) {
        requests.push(request.text);
        return shared.highlight(request, signal);
      },
    },
  };
}

function gated(): {
  readonly highlighter: CodeHighlighter;
  readonly pending: () => number;
  readonly release: () => Promise<void>;
} {
  const waiting: Array<() => void> = [];
  return {
    highlighter: {
      async highlight(request: CodeHighlightRequest, signal?: AbortSignal) {
        await new Promise<void>((resolve) => waiting.push(resolve));
        return shared.highlight(request, signal);
      },
    },
    pending: () => waiting.length,
    release: async () => {
      await waitFor(() => (waiting.length > 0 ? true : null));
      for (const resolve of waiting.splice(0)) resolve();
    },
  };
}

describe("AgentMarkdownCodeBody", () => {
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

  function render(node: ReactNode, highlighter: CodeHighlighter = shared): void {
    act(() =>
      root.render(
        <CodeHighlighterProvider highlighter={highlighter} theme="calm-dark">
          {node}
        </CodeHighlighterProvider>,
      ),
    );
  }

  function body(code: string, language: string | null, query = ""): ReactNode {
    return (
      <AgentMarkdownCodeBody
        code={code}
        current={null}
        indexOffset={0}
        language={language}
        query={query}
      />
    );
  }

  function colorized(): Promise<HTMLElement> {
    return waitFor(() => host.querySelector<HTMLElement>(".agent-md__code-colorized"));
  }

  function coloredSpans(): HTMLElement[] {
    return [...host.querySelectorAll<HTMLElement>(".agent-md__code-line span")].filter(
      (span) => span.style.color !== "",
    );
  }

  it.each([
    ["php", '<?php\nfunction greet(string $name): string { return "hi $name"; }'],
    ["json", '{\n  "name": "codevo",\n  "count": 2\n}'],
    ["html", '<div class="box">\n  <a href="/x">link</a>\n</div>'],
    ["css", ".box {\n  color: red;\n  margin: 0 auto;\n}"],
    [
      "ts",
      "const value: number = 1;\nexport function add(a: number): number { return a + value; }",
    ],
  ])("colors a fenced %s block with the shared highlighter", async (language, code) => {
    render(body(code, language));
    const block = await colorized();
    expect(block.textContent).toBe(code);
    expect(new Set(coloredSpans().map((span) => span.style.color)).size).toBeGreaterThan(1);
  });

  it("highlights blocks longer than the old 250 line cap", async () => {
    const code = Array.from({ length: 400 }, (_, index) => `const v${index} = ${index};`).join(
      "\n",
    );
    render(body(code, "typescript"));
    const block = await colorized();
    expect(block.querySelectorAll(".agent-md__code-line")).toHaveLength(400);
    expect(coloredSpans().length).toBeGreaterThan(400);
  });

  it("keeps unknown and plaintext fences plain", async () => {
    render(body("just words", "cobol"));
    await settle(250);
    expect(host.querySelector(".agent-md__code-colorized")).toBeNull();
    render(body("just words", "text"));
    await settle(250);
    expect(host.querySelector(".agent-md__code-colorized")).toBeNull();
    expect(host.textContent).toBe("just words");
  });

  it("debounces a streaming block and publishes only the latest text", async () => {
    const probe = recording();
    render(body("const a", "ts"), probe.highlighter);
    render(body("const a = 1", "ts"), probe.highlighter);
    render(body("const a = 1;\nconst b = 2;", "ts"), probe.highlighter);
    expect(host.querySelector(".agent-md__code-colorized")).toBeNull();
    expect(host.textContent).toBe("const a = 1;\nconst b = 2;");
    const block = await colorized();
    expect(block.textContent).toBe("const a = 1;\nconst b = 2;");
    expect(probe.requests).toEqual(["const a = 1;\nconst b = 2;"]);
  });

  it("keeps the unchanged prefix colored while a streamed append is pending", async () => {
    const gate = gated();
    render(body("const a = 1;", "ts"), gate.highlighter);
    await gate.release();
    await colorized();

    render(body("const a = 1;\nconst b", "ts"), gate.highlighter);
    await settle(200);
    expect(gate.pending()).toBe(1);
    const lines = [...host.querySelectorAll<HTMLElement>(".agent-md__code-line")];
    expect(lines.map((line) => line.textContent)).toEqual(["const a = 1;\n", "const b"]);
    expect(
      [...lines[0].querySelectorAll<HTMLElement>("span")].some((s) => s.style.color !== ""),
    ).toBe(true);
    expect(lines[1].querySelectorAll("span")).toHaveLength(1);
    expect(lines[1].querySelector("span")?.style.color).toBe("");

    render(body("let a = 1;\nconst b", "ts"), gate.highlighter);
    expect(host.querySelector(".agent-md__code-colorized")).toBeNull();
    expect(host.textContent).toBe("let a = 1;\nconst b");
    await settle(200);
    expect(gate.pending()).toBe(2);
    await gate.release();
    const block = await colorized();
    expect(block.textContent).toBe("let a = 1;\nconst b");
  });

  it("renders plain marked text while a find query is active", async () => {
    render(body("const a = 1;", "ts"));
    await colorized();
    render(body("const a = 1;", "ts", "const"));
    expect(host.querySelector(".agent-md__code-colorized")).toBeNull();
    expect(host.textContent).toBe("const a = 1;");
  });

  it("stays plain without a highlighter provider", async () => {
    act(() => root.render(body("const a = 1;", "ts")));
    await settle(250);
    expect(host.querySelector(".agent-md__code-colorized")).toBeNull();
    expect(host.textContent).toBe("const a = 1;");
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
  throw new Error("Timed out waiting for highlighted code.");
}
