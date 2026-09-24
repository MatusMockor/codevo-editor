// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inlineDiffViewGateway } from "../../../../infrastructure/inlineDiffViewGateway";
import { waitForReact } from "../../../../test/reactTestLifecycle";
import { click, mountUi, type MountedUi } from "../../../../ui/foundation/foundationTestSupport";
import type {
  AgentDiffFile,
  AgentDiffSource,
} from "../../../../application/rightPanel/agentDiffSources";
import { MAX_AGENT_DIFF_FILES } from "../../../../application/rightPanel/agentDiffSources";
import {
  AGENT_DIFF_SPLIT_MIN_WIDTH,
  AgentDiffSurface,
  type AgentDiffSurfaceProps,
} from "./AgentDiffSurface";

let ui: MountedUi | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
});

const LONG_LINE = `const reallyLongIdentifier = "${"x".repeat(600)}";`;

function file(displayPath: string, added = 1, deleted = 1): AgentDiffFile {
  return {
    repositoryRoot: "/repo",
    relativePath: displayPath,
    displayPath,
    oldRelativePath: null,
    status: "modified",
    added,
    deleted,
  };
}

const source: AgentDiffSource = {
  key: "turn-2",
  identity: "turn-2",
  listFiles: async () => ({
    files: [
      file("src/routes/orders.ts", 4, 1),
      file("src/middleware/very/deep/path/idempotency.ts", 29, 0),
    ],
    truncated: false,
    statsPartial: false,
    unavailableReason: null,
  }),
  readSides: async () => ({
    original: "a\nb\n",
    modified: `a\n${LONG_LINE}\n`,
    truncated: false,
    unavailableReason: null,
  }),
};

function resizeWindow(width: number): void {
  act(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    window.dispatchEvent(new Event("resize"));
  });
}

function truncatedSource(count: number): AgentDiffSource {
  return {
    ...source,
    key: `truncated-${count}`,
    identity: `truncated-${count}`,
    listFiles: async () => ({
      files: Array.from({ length: count }, (_, index) => file(`f${index}.ts`)),
      truncated: true,
      statsPartial: false,
      unavailableReason: null,
    }),
  };
}

function props(overrides: Partial<AgentDiffSurfaceProps> = {}): AgentDiffSurfaceProps {
  return {
    scope: { kind: "latestTurn" },
    scopeLabel: "Latest turn",
    choices: {
      turns: [
        { turnId: "t2", label: "Turn 2", endedAtEpochMs: 2 },
        { turnId: "t1", label: "Turn 1", endedAtEpochMs: 1 },
      ],
      workingTree: true,
      branch: { head: "feat/idempotency-keys", bases: ["main", "develop"], defaultBase: "main" },
    },
    source,
    computation: inlineDiffViewGateway,
    emptyReason: null,
    warning: null,
    reveal: null,
    replacementBody: null,
    onScopeChange: vi.fn(),
    onOpenFile: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides,
  };
}

function mount(value: AgentDiffSurfaceProps): HTMLElement {
  ui = mountUi();
  ui.render(<AgentDiffSurface {...value} />);
  return ui.host;
}

describe("AgentDiffSurface", () => {
  it("renders file rows with totals and full paths available", async () => {
    const host = mount(props());
    await waitForReact(() => expect(host.querySelectorAll(".cv-diff-file__row")).toHaveLength(2));
    const rows = [...host.querySelectorAll<HTMLElement>(".cv-diff-file__row")];

    expect(rows[1]?.title).toBe("src/middleware/very/deep/path/idempotency.ts");
    expect(rows[1]?.querySelector(".cv-diff-file__name")?.textContent).toBe("idempotency.ts");
    expect(host.querySelector(".cv-diff-toolbar .cv-rp-stat")?.textContent).toBe("+33−1");
  });

  it("never truncates code text and switches between scroll and wrap (B4)", async () => {
    const host = mount(props());
    await waitForReact(() => expect(host.querySelector(".cv-diff-code--add")).not.toBeNull());
    const code = [...host.querySelectorAll(".cv-diff-code")].map((node) => node.textContent);

    expect(code).toContain(LONG_LINE);
    expect(host.querySelector(".cv-diff")?.getAttribute("data-wrap")).toBe("false");
    click(host.querySelector('[aria-label="Enable diff line wrapping"]') as Element);
    expect(host.querySelector(".cv-diff")?.getAttribute("data-wrap")).toBe("true");
  });

  it("renders a split grid with both sides in split layout", async () => {
    const host = mount(props());
    await waitForReact(() => expect(host.querySelector(".cv-diff-grid--unified")).not.toBeNull());
    click(host.querySelector('[aria-label="Split diff view"]') as Element);
    await waitForReact(() => expect(host.querySelector(".cv-diff-grid--split")).not.toBeNull());
    expect(host.querySelectorAll(".cv-diff-grid--split .cv-diff-code--del").length).toBeGreaterThan(
      0,
    );
  });

  it("shows a truthful stacked diff without the tree in a narrow panel", async () => {
    const wide = window.innerWidth;
    try {
      const host = mount(props());
      await waitForReact(() => expect(host.querySelector(".cv-diff-grid--unified")).not.toBeNull());
      click(host.querySelector('[aria-label="Split diff view"]') as Element);
      click(host.querySelector('[aria-label="Show file tree"]') as Element);
      await waitForReact(() => expect(host.querySelector(".cv-diff-grid--split")).not.toBeNull());

      resizeWindow(AGENT_DIFF_SPLIT_MIN_WIDTH - 160);

      const surface = host.querySelector(".cv-diff");
      expect(surface?.getAttribute("data-layout")).toBe("unified");
      expect(surface?.getAttribute("data-narrow")).toBe("true");
      expect(host.querySelector(".cv-diff-grid--split")).toBeNull();
      expect(host.querySelector(".cv-diff-grid--unified")).not.toBeNull();
      expect(host.querySelector('[aria-label="Split diff view"]')).toBeNull();
      expect(host.querySelector('[aria-label="Changed files"]')).toBeNull();
      expect(host.querySelector('[aria-label="Hide file tree"]')).toBeNull();

      resizeWindow(wide);

      expect(host.querySelector(".cv-diff")?.getAttribute("data-layout")).toBe("split");
      expect(host.querySelector('[aria-label="Changed files"]')).not.toBeNull();
    } finally {
      resizeWindow(wide);
    }
  });

  it("changes scope from the scope menu", async () => {
    const value = props();
    const host = mount(value);
    click(host.querySelector('[aria-label="Diff scope: Latest turn"]') as Element);
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')];
    expect(items.map((item) => item.textContent?.replace(/\d{1,2}:\d{2}.*$/, "").trim())).toEqual([
      "Working tree",
      "Branch changes",
      "Latest turn",
      "Turn 2",
      "Turn 1",
    ]);
    click(items[1] as Element);
    expect(value.onScopeChange).toHaveBeenCalledWith({ kind: "branch", baseRef: "main" });
  });

  it("shows the file tree and reveals a file from it", async () => {
    const host = mount(props());
    await waitForReact(() => expect(host.querySelectorAll(".cv-diff-file__row")).toHaveLength(2));
    click(host.querySelector('[aria-label="Show file tree"]') as Element);
    expect(host.querySelector('[aria-label="Changed files"]')).not.toBeNull();
  });

  it("shows the empty reason when there is no source", () => {
    const host = mount(
      props({ source: null, emptyReason: "This thread has no finished turns yet." }),
    );
    expect(host.textContent).toContain("This thread has no finished turns yet.");
  });

  it("marks totals as partial when some line counts are unknown", async () => {
    const partial: AgentDiffSource = {
      ...source,
      key: "partial",
      identity: "partial",
      listFiles: async () => ({
        files: [file("a.ts", 2, 1)],
        truncated: false,
        statsPartial: true,
        unavailableReason: null,
      }),
    };
    const host = mount(props({ source: partial }));
    await waitForReact(() =>
      expect(host.querySelector(".cv-diff-toolbar__partial")?.textContent).toBe("partial"),
    );
  });

  it("shows the unreadable repositories warning", () => {
    const host = mount(props({ warning: "Some repositories could not be read." }));
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "Some repositories could not be read.",
    );
  });

  it("keeps only the scope control for a replacement body", () => {
    const host = mount(props({ replacementBody: <p>legacy diff</p> }));
    expect(host.querySelector(".cv-diff")?.getAttribute("data-mode")).toBe("replacement");
    expect(host.querySelector('[aria-label="Diff scope: Latest turn"]')).not.toBeNull();
    for (const label of [
      "Refresh diff",
      "Collapse all files",
      "Enable diff line wrapping",
      "Hide whitespace changes",
      "Show file tree",
    ]) {
      expect(host.querySelector(`[aria-label="${label}"]`), label).toBeNull();
    }
    expect(host.textContent).toContain("legacy diff");
    expect(host.querySelector(".cv-diff__files")?.classList).toContain(
      "cv-diff__files--replacement",
    );
  });

  it("keeps the expanded files visible and shows the error after a failed refresh", async () => {
    let fail = false;
    const flaky: AgentDiffSource = {
      ...source,
      key: "flaky",
      identity: "flaky",
      listFiles: () => (fail ? Promise.reject(new Error("git status failed")) : source.listFiles()),
    };
    const host = mount(props({ source: flaky }));
    await waitForReact(() => expect(host.querySelector(".cv-diff-code--add")).not.toBeNull());
    fail = true;
    click(host.querySelector('[aria-label="Refresh diff"]') as Element);

    await waitForReact(() =>
      expect(host.querySelector('[role="alert"]')?.textContent).toContain("git status failed"),
    );
    expect(host.querySelector(".cv-diff-code--add")).not.toBeNull();
    expect(
      [...host.querySelectorAll(".cv-diff-file__row")].map((row) =>
        row.getAttribute("aria-expanded"),
      ),
    ).toEqual(["true", "true"]);
  });

  it("names the file count limit when the list stops at the file cap", async () => {
    const host = mount(props({ source: truncatedSource(MAX_AGENT_DIFF_FILES) }));
    await vi.waitFor(
      async () => {
        await act(async () => Promise.resolve());
        expect(host.textContent).toContain(
          `Showing the first ${MAX_AGENT_DIFF_FILES} changed files.`,
        );
      },
      { timeout: 10_000 },
    );
    expect(host.textContent).not.toContain("too large");
  });

  it("names the size limit when the list stops before the file cap", async () => {
    const host = mount(props({ source: truncatedSource(3) }));
    await waitForReact(() =>
      expect(host.textContent).toContain(
        "Showing the first 3 changed files. The full change list is too large to read.",
      ),
    );
    expect(host.textContent).not.toContain(`first ${MAX_AGENT_DIFF_FILES}`);
  });

  it("scrolls a requested file into view once the list is ready", async () => {
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled.push(this.querySelector(".cv-diff-file__row")?.getAttribute("title") ?? "");
    };
    try {
      const host = mount(
        props({ reveal: { relativePath: "src/middleware/very/deep/path/idempotency.ts" } }),
      );
      await waitForReact(() =>
        expect(scrolled).toEqual(["src/middleware/very/deep/path/idempotency.ts"]),
      );
      const rows = [...host.querySelectorAll(".cv-diff-file__row")];
      expect(rows[1]?.getAttribute("aria-expanded")).toBe("true");
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("disables Open for a file without a checkout root", async () => {
    const detached: AgentDiffSource = {
      ...source,
      key: "detached",
      identity: "detached",
      listFiles: async () => ({
        files: [{ ...file("a.ts"), repositoryRoot: null }],
        truncated: false,
        statsPartial: false,
        unavailableReason: null,
      }),
    };
    const host = mount(props({ source: detached }));
    await waitForReact(() =>
      expect(
        host.querySelector<HTMLButtonElement>('[aria-label="Open a.ts in editor"]')?.disabled,
      ).toBe(true),
    );
  });
});
