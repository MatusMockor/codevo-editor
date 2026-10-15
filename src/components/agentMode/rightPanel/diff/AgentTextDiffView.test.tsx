// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DiffViewComputationGateway,
  DiffViewComputationInput,
} from "../../../../application/diffViewComputation";
import { computeLineDiff, type LineDiffResult } from "../../../../domain/diffView/lineDiff";
import { CodeHighlighterProvider } from "../../../../infrastructure/codeHighlight/CodeHighlighterProvider";
import { createInlineCodeHighlighter } from "../../../../infrastructure/codeHighlight/inlineCodeHighlighter";
import { inlineDiffViewGateway } from "../../../../infrastructure/inlineDiffViewGateway";
import { waitForReact } from "../../../../test/reactTestLifecycle";
import { mountUi, type MountedUi } from "../../../../ui/foundation/foundationTestSupport";
import {
  MAX_TEXT_DIFF_INPUT_CHARS,
  boundDiffText,
} from "../../../../domain/diffView/diffTextBounds";
import { AgentTextDiffView, type AgentTextDiffViewProps } from "./AgentTextDiffView";

let ui: MountedUi | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
});

function mount(node: ReactNode): HTMLElement {
  ui = mountUi();
  ui.render(node);
  return ui.host;
}

function view(props: Partial<AgentTextDiffViewProps> = {}): ReactNode {
  return (
    <AgentTextDiffView
      computation={inlineDiffViewGateway}
      modified=""
      original=""
      path="src/orders.ts"
      {...props}
    />
  );
}

function cells(host: HTMLElement, kind: "add" | "del" | "context"): string[] {
  return [...host.querySelectorAll(`.cv-diff-code--${kind}`)].map((cell) => cell.textContent ?? "");
}

describe("AgentTextDiffView", () => {
  it("reports identical texts as unchanged", async () => {
    const host = mount(view({ original: "a\nb\n", modified: "a\nb\n" }));
    await waitForReact(() => expect(host.textContent).toContain("No changes."));
    expect(host.querySelector(".cv-diff-hunk")).toBeNull();
  });

  it("renders inserted, deleted and modified lines", async () => {
    const host = mount(
      view({ original: "keep\nremove\nold\ntail\n", modified: "keep\nnew\ntail\nadded\n" }),
    );
    await waitForReact(() => expect(host.querySelector(".cv-diff-hunk")).not.toBeNull());
    expect(cells(host, "del")).toEqual(["remove", "old"]);
    expect(cells(host, "add")).toEqual(["new", "added"]);
    expect(cells(host, "context")).toEqual(["keep", "tail"]);
    expect(host.querySelector('[aria-label="src/orders.ts diff"]')).not.toBeNull();
  });

  it("renders a deleted file as removed lines only", async () => {
    const host = mount(view({ original: "one\ntwo\n", modified: "" }));
    await waitForReact(() => expect(cells(host, "del")).toEqual(["one", "two"]));
    expect(cells(host, "add")).toEqual([]);
  });

  it("shows comparison labels and the split layout", async () => {
    const host = mount(
      view({
        original: "a\n",
        modified: "b\n",
        labels: { original: "Parent", modified: "abc1234" },
        layout: "split",
      }),
    );
    await waitForReact(() => expect(host.querySelector(".cv-diff-grid--split")).not.toBeNull());
    expect(host.querySelector('[aria-label="Comparing Parent with abc1234"]')?.textContent).toBe(
      "Parent ↔ abc1234",
    );
  });

  it("shows a loading state without computing", async () => {
    const compute = vi.fn(inlineDiffViewGateway.compute);
    const host = mount(view({ loading: true, computation: { compute } }));
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Loading diff"]')).not.toBeNull();
    expect(compute).not.toHaveBeenCalled();
  });

  it("shows a visible truncation banner for oversized input", async () => {
    const original = "x\n".repeat(MAX_TEXT_DIFF_INPUT_CHARS);
    const compute = vi.fn(inlineDiffViewGateway.compute);
    const host = mount(view({ original, modified: "y\n", computation: { compute } }));
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "only the beginning is compared",
    );
    await waitForReact(() => expect(compute).toHaveBeenCalledOnce());
    const sent = compute.mock.calls[0]?.[0];
    expect(sent?.original.length).toBeLessThanOrEqual(MAX_TEXT_DIFF_INPUT_CHARS);
    await waitForReact(() =>
      expect(host.textContent).toContain("The diff is too large to display."),
    );
  });

  it("bounds text at a line break", () => {
    expect(boundDiffText("short")).toEqual({ text: "short", truncated: false });
    expect(boundDiffText("ab\ncd\nef", 7)).toEqual({ text: "ab\ncd\n", truncated: true });
    expect(boundDiffText("abcdefgh", 4)).toEqual({ text: "abcd", truncated: true });
    expect(boundDiffText("abc\ndef", 3)).toEqual({ text: "abc", truncated: true });
    expect(boundDiffText("\nabcdef", 3)).toEqual({ text: "\n", truncated: true });
  });

  it("drops a late result computed for superseded input", async () => {
    const pending: Array<{
      readonly input: DiffViewComputationInput;
      readonly resolve: (result: LineDiffResult) => void;
    }> = [];
    const computation: DiffViewComputationGateway = {
      compute: (input) =>
        new Promise<LineDiffResult>((resolve) => pending.push({ input, resolve })),
    };
    const host = mount(view({ computation, original: "a\n", modified: "stale\n" }));
    ui?.render(view({ computation, original: "a\n", modified: "fresh\n" }));
    expect(pending).toHaveLength(2);
    const [stale, fresh] = pending;
    await waitForReact(() =>
      expect(host.querySelector('[aria-label="Computing diff"]')).not.toBeNull(),
    );
    await act(async () =>
      stale?.resolve(computeLineDiff(stale.input.original, stale.input.modified, opts)),
    );
    expect(host.querySelector(".cv-diff-hunk")).toBeNull();
    await act(async () =>
      fresh?.resolve(computeLineDiff(fresh.input.original, fresh.input.modified, opts)),
    );
    await waitForReact(() => expect(cells(host, "add")).toEqual(["fresh"]));
    expect(host.textContent).not.toContain("stale");
  });

  it("reports a failed computation", async () => {
    const computation: DiffViewComputationGateway = {
      compute: () => Promise.reject(new Error("Too many diff calculations are pending.")),
    };
    const host = mount(view({ computation, original: "a\n", modified: "b\n" }));
    await waitForReact(() =>
      expect(host.querySelector('[role="alert"]')?.textContent).toBe(
        "Too many diff calculations are pending.",
      ),
    );
  });

  it("colors both sides once highlighting arrives", async () => {
    const host = mount(
      <CodeHighlighterProvider highlighter={createInlineCodeHighlighter()} theme="dark-plus">
        {view({
          original: "const value: number = 1;\nexport default value;\n",
          modified: 'const value: string = "x";\nexport default value;\n',
        })}
      </CodeHighlighterProvider>,
    );
    await waitForReact(() => {
      for (const kind of ["add", "del", "context"] as const) {
        const colored = [...host.querySelectorAll(`.cv-diff-code--${kind} span[style]`)].filter(
          (span) => (span as HTMLElement).style.color !== "",
        );
        expect(colored.length, kind).toBeGreaterThan(0);
      }
    });
    expect(cells(host, "add")).toEqual(['const value: string = "x";']);
  });
});

const opts = { ignoreWhitespace: false } as const;
