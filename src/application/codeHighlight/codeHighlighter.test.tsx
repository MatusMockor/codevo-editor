// @vitest-environment jsdom
import { act, type JSX } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { CodeLanguageId } from "../../domain/codeHighlight/codeLanguage";
import type { CodeTheme } from "../../domain/settings";
import { CodeHighlighterProvider } from "../../infrastructure/codeHighlight/CodeHighlighterProvider";
import { createInlineCodeHighlighter } from "../../infrastructure/codeHighlight/inlineCodeHighlighter";
import {
  useHighlightedCode,
  type CodeHighlighter,
  type CodeHighlightOutcome,
  type CodeHighlightRequest,
  type CodeHighlightState,
  type UseHighlightedCodeOptions,
} from "./codeHighlighter";

interface Call {
  readonly request: CodeHighlightRequest;
  readonly signal: AbortSignal | undefined;
  readonly resolve: (outcome: CodeHighlightOutcome) => void;
}

function controlledHighlighter(): { highlighter: CodeHighlighter; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    highlighter: {
      highlight: (request, signal) =>
        new Promise<CodeHighlightOutcome>((resolve) => {
          calls.push({ request, signal, resolve });
        }),
    },
  };
}

function outcomeFor(text: string): CodeHighlightOutcome {
  return { kind: "highlighted", lines: [[{ text, color: "#ff0000", italic: false, bold: false }]] };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const states: CodeHighlightState[] = [];

function Probe(props: {
  readonly text: string;
  readonly language: CodeLanguageId;
  readonly options?: UseHighlightedCodeOptions;
}): JSX.Element {
  const state = useHighlightedCode(props.text, props.language, props.options);
  states.push(state);
  return <span data-kind={state.kind} />;
}

async function render(element: JSX.Element): Promise<void> {
  container ??= document.body.appendChild(document.createElement("div"));
  root ??= createRoot(container);
  await act(async () => {
    root?.render(element);
  });
}

function latest(): CodeHighlightState | undefined {
  return states[states.length - 1];
}

function tree(
  highlighter: CodeHighlighter,
  text: string,
  options?: UseHighlightedCodeOptions,
  theme: CodeTheme = "dark-plus",
): JSX.Element {
  return (
    <CodeHighlighterProvider theme={theme} highlighter={highlighter}>
      <Probe text={text} language="json" options={options} />
    </CodeHighlighterProvider>
  );
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  states.length = 0;
});

describe("useHighlightedCode", () => {
  it("is unavailable without a provider", async () => {
    await render(<Probe text="{}" language="json" />);
    expect(latest()).toEqual({ kind: "plain", reason: "unavailable" });
  });

  it("publishes only the latest text when earlier results settle late", async () => {
    const { highlighter, calls } = controlledHighlighter();
    await render(tree(highlighter, "a"));
    await render(tree(highlighter, "ab"));
    await render(tree(highlighter, "abc"));
    expect(calls.map((call) => call.request.text)).toEqual(["a", "ab", "abc"]);
    expect(calls[0]?.signal?.aborted).toBe(true);
    expect(calls[1]?.signal?.aborted).toBe(true);
    await act(async () => {
      calls[2]?.resolve(outcomeFor("abc"));
      calls[0]?.resolve(outcomeFor("a"));
      calls[1]?.resolve(outcomeFor("ab"));
    });
    expect(latest()).toEqual(outcomeFor("abc"));
    expect(states).not.toContainEqual(outcomeFor("a"));
    expect(states).not.toContainEqual(outcomeFor("ab"));
  });

  it("never reports a result for previous text while the next request is pending", async () => {
    const { highlighter, calls } = controlledHighlighter();
    await render(tree(highlighter, "a"));
    await act(async () => calls[0]?.resolve(outcomeFor("a")));
    expect(latest()).toEqual(outcomeFor("a"));
    await render(tree(highlighter, "b"));
    expect(latest()).toEqual({ kind: "pending" });
  });

  it("re-highlights when the theme changes", async () => {
    const { highlighter, calls } = controlledHighlighter();
    await render(tree(highlighter, "a", undefined, "dark-plus"));
    await render(tree(highlighter, "a", undefined, "dracula"));
    expect(calls.map((call) => call.request.theme)).toEqual(["dark-plus", "dracula"]);
    await act(async () => calls[0]?.resolve(outcomeFor("old-theme")));
    expect(latest()).toEqual({ kind: "pending" });
  });

  it("debounces rapid changes when a delay is requested", async () => {
    const { highlighter, calls } = controlledHighlighter();
    await render(tree(highlighter, "a", { delayMs: 30 }));
    await render(tree(highlighter, "ab", { delayMs: 30 }));
    await render(tree(highlighter, "abc", { delayMs: 30 }));
    expect(calls).toHaveLength(0);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 60)));
    expect(calls.map((call) => call.request.text)).toEqual(["abc"]);
  });

  it("does not highlight while disabled", async () => {
    const { highlighter, calls } = controlledHighlighter();
    await render(tree(highlighter, "a", { enabled: false }));
    expect(calls).toHaveLength(0);
    expect(latest()).toEqual({ kind: "pending" });
  });

  it("reports a failed highlighter as unavailable", async () => {
    const failing: CodeHighlighter = { highlight: () => Promise.reject(new Error("boom")) };
    await render(tree(failing, "a"));
    expect(latest()).toEqual({ kind: "plain", reason: "unavailable" });
  });

  it("highlights with the real inline highlighter", async () => {
    await render(tree(createInlineCodeHighlighter(), '{"a": 1}'));
    for (let attempt = 0; attempt < 50 && latest()?.kind === "pending"; attempt += 1) {
      await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    }
    expect(latest()?.kind).toBe("highlighted");
  });

  it("owns a default highlighter that falls back to inline Shiki where Worker is missing", async () => {
    await render(
      <CodeHighlighterProvider theme="dark-plus">
        <Probe text={'{"a": 1}'} language="json" />
      </CodeHighlighterProvider>,
    );
    for (let attempt = 0; attempt < 50 && latest()?.kind === "pending"; attempt += 1) {
      await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    }
    expect(latest()?.kind).toBe("highlighted");
  });
});
