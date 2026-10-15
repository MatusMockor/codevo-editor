// @vitest-environment jsdom
import { act, type JSX } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { waitForReact } from "../../test/reactTestLifecycle";
import { CodeHighlighterProvider } from "../../infrastructure/codeHighlight/CodeHighlighterProvider";
import { createInlineCodeHighlighter } from "../../infrastructure/codeHighlight/inlineCodeHighlighter";
import { useHighlightedCodeBatch, type CodeHighlightBatchState } from "./codeHighlightBatch";
import type {
  CodeHighlightBatchOutcome,
  CodeHighlightBatchRequest,
  CodeHighlighter,
  CodeHighlightOutcome,
  CodeHighlightRequest,
} from "./codeHighlighter";

interface BatchCall {
  readonly request: CodeHighlightBatchRequest;
  readonly signal: AbortSignal | undefined;
  readonly resolve: (outcome: CodeHighlightBatchOutcome) => void;
}

function controlledBatchHighlighter(): { highlighter: CodeHighlighter; calls: BatchCall[] } {
  const calls: BatchCall[] = [];
  return {
    calls,
    highlighter: {
      highlight: () => Promise.reject(new Error("single highlight is not used")),
      highlightBatch: (request, signal) =>
        new Promise<CodeHighlightBatchOutcome>((resolve) => {
          calls.push({ request, signal, resolve });
        }),
    },
  };
}

function batchFor(texts: readonly string[]): CodeHighlightBatchOutcome {
  return {
    kind: "highlighted",
    texts: texts.map((text) => [[{ text, color: "#ff0000", italic: false, bold: false }]]),
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const states: CodeHighlightBatchState[] = [];

function Probe(props: { readonly texts: readonly string[] }): JSX.Element {
  states.push(useHighlightedCodeBatch(props.texts, "json"));
  return <span />;
}

function render(highlighter: CodeHighlighter, texts: readonly string[]): void {
  if (container === null) {
    container = document.createElement("div");
    root = createRoot(container);
  }
  act(() => {
    root?.render(
      <CodeHighlighterProvider highlighter={highlighter} theme="dark-plus">
        <Probe texts={texts} />
      </CodeHighlighterProvider>,
    );
  });
}

function latest(): CodeHighlightBatchState | undefined {
  return states[states.length - 1];
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container = null;
  states.length = 0;
});

describe("useHighlightedCodeBatch", () => {
  it("sends one batch request and publishes its result", async () => {
    const { highlighter, calls } = controlledBatchHighlighter();
    const texts = ["[1]", "[2]"];
    render(highlighter, texts);
    expect(latest()).toEqual({ kind: "pending" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.request).toEqual({ texts, language: "json", theme: "dark-plus" });
    await act(async () => calls[0]?.resolve(batchFor(texts)));
    expect(latest()).toEqual(batchFor(texts));
  });

  it("aborts a superseded batch and never publishes it for new texts", async () => {
    const { highlighter, calls } = controlledBatchHighlighter();
    render(highlighter, ["[1]"]);
    render(highlighter, ["[2]"]);
    expect(calls[0]?.signal?.aborted).toBe(true);
    await act(async () => calls[0]?.resolve(batchFor(["[1]"])));
    expect(latest()).toEqual({ kind: "pending" });
    await act(async () => calls[1]?.resolve(batchFor(["[2]"])));
    expect(latest()).toEqual(batchFor(["[2]"]));
  });

  it("aborts the batch on unmount", () => {
    const { highlighter, calls } = controlledBatchHighlighter();
    render(highlighter, ["[1]"]);
    act(() => root?.unmount());
    root = null;
    container = null;
    expect(calls[0]?.signal?.aborted).toBe(true);
  });

  it("falls back to one request per text for highlighters without batch support", async () => {
    const requests: CodeHighlightRequest[] = [];
    const single: CodeHighlighter = {
      highlight: async (request): Promise<CodeHighlightOutcome> => {
        requests.push(request);
        return { kind: "highlighted", lines: [[]] };
      },
    };
    render(single, ["a", "b"]);
    await act(async () => {
      for (let index = 0; index < 5; index += 1) await Promise.resolve();
    });
    expect(requests.map((request) => request.text)).toEqual(["a", "b"]);
    expect(latest()).toEqual({ kind: "highlighted", texts: [[[]], [[]]] });
  });

  it("highlights texts independently with the real inline highlighter", async () => {
    render(createInlineCodeHighlighter(), ['{"a": 1}', "[true]"]);
    await waitForReact(() => expect(latest()?.kind).toBe("highlighted"));
    const state = latest();
    if (state?.kind !== "highlighted") throw new Error("expected highlighted");
    expect(state.texts).toHaveLength(2);
  });
});
