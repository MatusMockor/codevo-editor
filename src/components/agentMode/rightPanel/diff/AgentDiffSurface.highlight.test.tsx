// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CodeHighlightBatchRequest,
  CodeHighlighter,
} from "../../../../application/codeHighlight/codeHighlighter";
import { MAX_HIGHLIGHTED_HUNKS_PER_FILE } from "../../../../domain/diffView/diffSideText";
import type {
  AgentDiffFile,
  AgentDiffSides,
  AgentDiffSource,
} from "../../../../application/rightPanel/agentDiffSources";
import { CodeHighlighterProvider } from "../../../../infrastructure/codeHighlight/CodeHighlighterProvider";
import { createInlineCodeHighlighter } from "../../../../infrastructure/codeHighlight/inlineCodeHighlighter";
import { inlineDiffViewGateway } from "../../../../infrastructure/inlineDiffViewGateway";
import { waitForReact } from "../../../../test/reactTestLifecycle";
import { click, mountUi, type MountedUi } from "../../../../ui/foundation/foundationTestSupport";
import { AgentDiffSurface, type AgentDiffSurfaceProps } from "./AgentDiffSurface";
import { DIFF_LAYOUT_STORAGE_KEY, DIFF_WRAP_STORAGE_KEY } from "./useAgentDiffViewPreferences";

let ui: MountedUi | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
  window.localStorage.clear();
});

const SIDES: Readonly<Record<string, readonly [string, string]>> = {
  "config.json": ['{\n  "name": "a",\n  "port": 1\n}\n', '{\n  "name": "b",\n  "port": 1\n}\n'],
  "src/Order.php": [
    "<?php\nfunction total() {\n  return 1;\n}\n",
    "<?php\nfunction total() {\n  return 2;\n}\n",
  ],
  "styles.css": [".a {\n  color: red;\n}\n", ".a {\n  color: blue;\n}\n"],
  "src/orders.ts": [
    "const value: number = 1;\nexport default value;\n",
    'const value: string = "x";\nexport default value;\n',
  ],
};

function file(displayPath: string): AgentDiffFile {
  return {
    repositoryRoot: "/repo",
    relativePath: displayPath,
    displayPath,
    oldRelativePath: null,
    status: "modified",
    added: 1,
    deleted: 1,
  };
}

function sourceFor(paths: ReadonlyArray<string>): AgentDiffSource {
  return {
    key: paths.join(","),
    identity: paths.join(","),
    listFiles: async () => ({
      files: paths.map(file),
      truncated: false,
      statsPartial: false,
      unavailableReason: null,
    }),
    readSides: async (entry): Promise<AgentDiffSides> => {
      const [original, modified] = SIDES[entry.relativePath] ?? ["", ""];
      return { original, modified, truncated: false, unavailableReason: null };
    },
  };
}

function props(source: AgentDiffSource): AgentDiffSurfaceProps {
  return {
    scope: { kind: "latestTurn" },
    scopeLabel: "Latest turn",
    choices: { turns: [], workingTree: true, branch: null },
    source,
    computation: inlineDiffViewGateway,
    emptyReason: null,
    warning: null,
    reveal: null,
    replacementBody: null,
    onScopeChange: vi.fn(),
    onOpenFile: vi.fn(),
    onRefresh: vi.fn(),
  };
}

function mount(source: AgentDiffSource, highlighter: CodeHighlighter): HTMLElement {
  ui = mountUi();
  ui.render(
    <CodeHighlighterProvider highlighter={highlighter} theme="calm-dark">
      <AgentDiffSurface {...props(source)} />
    </CodeHighlighterProvider>,
  );
  return ui.host;
}

async function expandAll(host: HTMLElement, count: number): Promise<void> {
  await waitForReact(() => expect(host.querySelectorAll(".cv-diff-file__row")).toHaveLength(count));
  for (const row of host.querySelectorAll('.cv-diff-file__row[aria-expanded="false"]')) click(row);
}

function sectionFor(host: HTMLElement, path: string): HTMLElement {
  const group = host.querySelector<HTMLElement>(`[aria-label="${path} diff"]`);
  if (group === null) throw new Error(`missing diff for ${path}`);
  return group;
}

function coloredSpans(cell: Element): number {
  return [...cell.querySelectorAll<HTMLElement>("span[style]")].filter(
    (span) => span.style.color !== "",
  ).length;
}

function expectColoredRows(group: HTMLElement): void {
  for (const kind of ["add", "del", "context"]) {
    const cells = [...group.querySelectorAll(`.cv-diff-code--${kind}`)];
    expect(cells.length, kind).toBeGreaterThan(0);
    expect(
      cells.some((cell) => coloredSpans(cell) > 0),
      kind,
    ).toBe(true);
  }
}

const PATHS = Object.keys(SIDES);

describe("AgentDiffSurface syntax highlighting", () => {
  it("colors JSON, PHP, CSS and TS rows in the unified layout", async () => {
    const host = mount(sourceFor(PATHS), createInlineCodeHighlighter());
    await expandAll(host, PATHS.length);
    await waitForReact(() => {
      for (const path of PATHS) expectColoredRows(sectionFor(host, path));
    });
    const added = sectionFor(host, "src/orders.ts").querySelector(".cv-diff-code--add");
    expect(added?.textContent).toBe('const value: string = "x";');
    expect(added?.classList).toContain("cv-diff-cell--add");
  });

  it("colors both sides in the split layout", async () => {
    const host = mount(sourceFor(PATHS), createInlineCodeHighlighter());
    await expandAll(host, PATHS.length);
    await waitForReact(() => expect(host.querySelector(".cv-diff-grid--unified")).not.toBeNull());
    click(host.querySelector('[aria-label="Split diff view"]') as Element);
    await waitForReact(() => {
      for (const path of PATHS) {
        const group = sectionFor(host, path);
        expect(group.querySelector(".cv-diff-grid--split")).not.toBeNull();
        expectColoredRows(group);
      }
    });
    const removed = sectionFor(host, "src/Order.php").querySelector(".cv-diff-code--del");
    expect(removed?.textContent).toBe("  return 1;");
  });

  it("renders plain text while highlighting is pending and cancels it on collapse", async () => {
    const signals: AbortSignal[] = [];
    const never: CodeHighlighter = {
      highlight: () => Promise.reject(new Error("the diff uses batch requests")),
      highlightBatch: (_request: CodeHighlightBatchRequest, signal?: AbortSignal) => {
        if (signal !== undefined) signals.push(signal);
        return new Promise(() => undefined);
      },
    };
    const host = mount(sourceFor(["src/orders.ts"]), never);
    await waitForReact(() => expect(signals.length).toBe(2));
    const group = sectionFor(host, "src/orders.ts");
    expect(group.querySelector(".cv-diff-code--add")?.textContent).toBe(
      'const value: string = "x";',
    );
    expect(coloredSpans(group)).toBe(0);

    click(host.querySelector(".cv-diff-file__row") as Element);

    await waitForReact(() => expect(signals.every((signal) => signal.aborted)).toBe(true));
    expect(host.querySelector('[aria-label="src/orders.ts diff"]')).toBeNull();
  });

  it("tokenizes each hunk on its own so an open comment does not leak across a gap", async () => {
    const body = Array.from({ length: 30 }, (_, index) => `const line${index} = ${index};`);
    body[1] = "/* this comment opens here";
    for (let index = 2; index < 15; index += 1) body[index] = ` * note ${index}`;
    body[15] = "*/";
    const original = [...body];
    const modified = [...body];
    original[0] = "const head = 1;";
    modified[0] = "const head = 2;";
    original[25] = "const tail = 1;";
    modified[25] = "const tail = 2;";
    const source: AgentDiffSource = {
      ...sourceFor(["src/gap.ts"]),
      readSides: async () => ({
        original: `${original.join("\n")}\n`,
        modified: `${modified.join("\n")}\n`,
        truncated: false,
        unavailableReason: null,
      }),
    };
    const host = mount(source, createInlineCodeHighlighter());
    await waitForReact(() => {
      const group = sectionFor(host, "src/gap.ts");
      expect(group.querySelectorAll(".cv-diff-grid")).toHaveLength(2);
      const tail = [...group.querySelectorAll(".cv-diff-code--add")].find(
        (cell) => cell.textContent === "const tail = 2;",
      );
      expect(tail).toBeDefined();
      const colors = new Set(
        [...(tail?.querySelectorAll<HTMLElement>("span[style]") ?? [])].map(
          (span) => span.style.color,
        ),
      );
      expect(colors.size).toBeGreaterThan(1);
    });
  });

  it("keeps unsupported languages plain without asking the highlighter", async () => {
    const requests: unknown[] = [];
    const recording = recordingHighlighter(requests);
    const source: AgentDiffSource = {
      ...sourceFor(["notes.unknownext"]),
      readSides: async () => ({
        original: "a\n",
        modified: "b\n",
        truncated: false,
        unavailableReason: null,
      }),
    };
    const host = mount(source, recording);
    await waitForReact(() =>
      expect(
        sectionFor(host, "notes.unknownext").querySelector(".cv-diff-code--add"),
      ).not.toBeNull(),
    );
    expect(requests).toEqual([]);
    expect(coloredSpans(sectionFor(host, "notes.unknownext"))).toBe(0);
  });
});

describe("AgentDiffSurface batch highlighting", () => {
  it("sends one batch per side for a file with many hunks and notes the hunk limit", async () => {
    const hunkCount = MAX_HIGHLIGHTED_HUNKS_PER_FILE + 5;
    const original = Array.from({ length: hunkCount * 10 }, (_, index) => `"k${index}": ${index},`);
    const modified = original.map((line, index) => (index % 10 === 0 ? `${line} ` : line));
    const source: AgentDiffSource = {
      ...sourceFor(["many.json"]),
      readSides: async () => ({
        original: `${original.join("\n")}\n`,
        modified: `${modified.join("\n")}\n`,
        truncated: false,
        unavailableReason: null,
      }),
    };
    const batches: unknown[] = [];
    const host = mount(source, recordingHighlighter(batches));
    await waitForReact(() => {
      const group = sectionFor(host, "many.json");
      expect(group.querySelectorAll(".cv-diff-grid").length).toBeGreaterThan(
        MAX_HIGHLIGHTED_HUNKS_PER_FILE,
      );
      expect(coloredSpans(group)).toBeGreaterThan(0);
    });
    expect(batches).toHaveLength(2);
    expect(host.textContent).toContain(
      `Highlighting is limited to the first ${MAX_HIGHLIGHTED_HUNKS_PER_FILE} hunks of this file.`,
    );
    const grids = [...sectionFor(host, "many.json").querySelectorAll(".cv-diff-grid")];
    expect(coloredSpans(grids[MAX_HIGHLIGHTED_HUNKS_PER_FILE - 1] as Element)).toBeGreaterThan(0);
    expect(coloredSpans(grids[MAX_HIGHLIGHTED_HUNKS_PER_FILE] as Element)).toBe(0);
  });
});

function recordingHighlighter(requests: unknown[]): CodeHighlighter {
  const inline = createInlineCodeHighlighter();
  return {
    highlight: (request, signal) => {
      requests.push(request);
      return inline.highlight(request, signal);
    },
    highlightBatch: (request, signal) => {
      requests.push(request);
      if (inline.highlightBatch === undefined) throw new Error("inline batch missing");
      return inline.highlightBatch(request, signal);
    },
  };
}

describe("AgentDiffSurface view preferences", () => {
  it("restores the persisted layout and wrap after a remount", async () => {
    const source = sourceFor(["src/orders.ts"]);
    let host = mount(source, createInlineCodeHighlighter());
    await waitForReact(() => expect(host.querySelector(".cv-diff-grid--unified")).not.toBeNull());
    click(host.querySelector('[aria-label="Split diff view"]') as Element);
    click(host.querySelector('[aria-label="Enable diff line wrapping"]') as Element);
    expect(window.localStorage.getItem(DIFF_LAYOUT_STORAGE_KEY)).toBe("split");
    expect(window.localStorage.getItem(DIFF_WRAP_STORAGE_KEY)).toBe("true");
    ui?.unmount();

    host = mount(source, createInlineCodeHighlighter());
    const surface = host.querySelector(".cv-diff");
    expect(surface?.getAttribute("data-layout")).toBe("split");
    expect(surface?.getAttribute("data-wrap")).toBe("true");
    await waitForReact(() => expect(host.querySelector(".cv-diff-grid--split")).not.toBeNull());
  });

  it("ignores invalid stored values", () => {
    window.localStorage.setItem(DIFF_LAYOUT_STORAGE_KEY, "sideways");
    window.localStorage.setItem(DIFF_WRAP_STORAGE_KEY, "yes");
    const host = mount(sourceFor(["src/orders.ts"]), createInlineCodeHighlighter());
    const surface = host.querySelector(".cv-diff");
    expect(surface?.getAttribute("data-layout")).toBe("unified");
    expect(surface?.getAttribute("data-wrap")).toBe("false");
  });
});
