// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentTurnChangeSummary,
  AgentTurnChangedFile,
} from "../../../domain/agentTurnChanges";
import { MAX_TURN_CHANGED_FILES } from "../../../domain/agentTurnChanges";
import { AgentTranscriptFollowController } from "../agentTranscriptFollowController";
import {
  AgentTurnChangesRow,
  MAX_CHANGES_INITIALLY_EXPANDED_ROWS,
  MAX_CHANGES_VISIBLE_ROWS,
} from "./AgentTurnChangesRow";

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
  vi.restoreAllMocks();
});

const LARGE_ROOT_FILES = ["CHANGELOG.md", "LICENSE", "package.json", "README.md", "tsconfig.json"];
const LARGE_TOP_LEVEL_FOLDERS = ["apps", "docs", "packages", "scripts", "src"];

function file(
  relativePath: string,
  addedLines: number | null,
  deletedLines: number | null,
): AgentTurnChangedFile {
  return { relativePath, oldRelativePath: null, status: "modified", addedLines, deletedLines };
}

function files(count: number, pathOf: (index: number) => string): AgentTurnChangedFile[] {
  return Array.from({ length: count }, (_, index) => file(pathOf(index + 1), 1, 0));
}

function summary(patch: Partial<AgentTurnChangeSummary> = {}): AgentTurnChangeSummary {
  return {
    turnId: "turn-1",
    state: "ready",
    files: [
      file("src/routes/orders.ts", 4, 1),
      file("src/middleware/idempotency.ts", 29, 0),
      file("test/orders.test.ts", 9, 6),
    ],
    truncated: false,
    reason: null,
    ...patch,
  };
}

function renderRow(
  changes: AgentTurnChangeSummary,
  onOpenDiff: (relativePath?: string) => void = () => undefined,
  active = false,
): void {
  act(() =>
    root.render(<AgentTurnChangesRow active={active} onOpenDiff={onOpenDiff} summary={changes} />),
  );
}

function rows(): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>("button.cv-changes__row")];
}

function rowNames(): (string | null | undefined)[] {
  return rows().map((row) => row.querySelector(".cv-changes__name")?.textContent);
}

function fileRows(): HTMLButtonElement[] {
  return rows().filter((row) => !row.hasAttribute("aria-expanded"));
}

function folderRow(name: string): HTMLButtonElement {
  const row = rows().find(
    (candidate) =>
      candidate.hasAttribute("aria-expanded") &&
      candidate.querySelector(".cv-changes__name")?.textContent === name,
  );
  if (row === undefined) throw new Error(`Missing folder row ${name}`);
  return row;
}

function foldAllButton(): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>("button.cv-changes__fold");
}

function openDiffButton(): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>("button.cv-changes__open");
}

function required<T>(value: T | null): T {
  if (value === null) throw new Error("Missing control");
  return value;
}

function ancestorsWithinCard(element: Element): number {
  const card = required(host.querySelector(".cv-changes"));
  let count = 0;
  let parent = element.parentElement;
  while (parent !== null && parent !== card) {
    count += 1;
    parent = parent.parentElement;
  }
  if (parent === null) throw new Error("Row is outside the card");
  return count;
}

function branchingSummary(levels: number): AgentTurnChangeSummary {
  return summary({
    files: files(
      levels,
      (level) =>
        `${Array.from({ length: level }, (_, index) => `level-${index + 1}`).join("/")}/leaf.ts`,
    ),
  });
}

function largeSummary(): AgentTurnChangeSummary {
  return summary({
    files: [
      ...files(60, (index) => `apps/file-${index}.ts`),
      ...files(40, (index) => `docs/file-${index}.md`),
      ...files(70, (index) => `packages/file-${index}.ts`),
      ...files(30, (index) => `scripts/file-${index}.sh`),
      ...files(25, (index) => `src/components/file-${index}.tsx`),
      ...files(25, (index) => `src/domain/file-${index}.ts`),
      ...LARGE_ROOT_FILES.map((path) => file(path, 1, 0)),
    ],
  });
}

function twoFolderSummary(firstFiles: number, secondFiles: number): AgentTurnChangeSummary {
  return summary({
    files: [
      ...files(firstFiles, (index) => `a/file-${index}.ts`),
      ...files(secondFiles, (index) => `b/file-${index}.ts`),
    ],
  });
}

function rowLevels(): (string | null | undefined)[] {
  return rows().map((row) => row.parentElement?.getAttribute("aria-level"));
}

function moreLine(): string | null {
  return host.querySelector(".cv-changes__more")?.textContent ?? null;
}

describe("AgentTurnChangesRow", () => {
  it("summarizes the turn in the card header and opens the whole turn diff", () => {
    const open = vi.fn();
    renderRow(summary(), open);

    const card = host.querySelector<HTMLElement>(".cv-changes");
    const header = host.querySelector<HTMLElement>(".cv-changes__header");
    expect(header?.textContent).toBe("3 changed files+42−7Open diff");
    expect(card?.dataset.active).toBe("false");
    expect(openDiffButton()?.textContent).toBe("Open diff");
    expect(openDiffButton()?.getAttribute("aria-label")).toBe(
      "3 changed files, 42 lines added, 7 removed. Open diff",
    );
    act(() => openDiffButton()?.click());
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith();
  });

  it("keeps the header free of nested interactive elements", () => {
    renderRow(summary());

    const header = host.querySelector<HTMLElement>(".cv-changes__header");
    expect(header?.tagName).toBe("DIV");
    expect(header?.closest("button")).toBeNull();
    expect(host.querySelector("button button")).toBeNull();
    expect([...(header?.querySelectorAll("button") ?? [])]).toEqual([
      foldAllButton(),
      openDiffButton(),
    ]);
  });

  it("shows the changed files as an expanded tree without a show or hide toggle", () => {
    renderRow(summary());

    expect(host.textContent).not.toContain("Show files");
    expect(host.textContent).not.toContain("Hide files");
    expect(host.querySelector('ul[aria-label="Changed files"]')).not.toBeNull();
    expect(rowNames()).toEqual([
      "src",
      "middleware",
      "idempotency.ts",
      "routes",
      "orders.ts",
      "test",
      "orders.test.ts",
    ]);
    expect(folderRow("src").querySelector(".cv-changes__stat")?.textContent).toBe("+33−1");
    expect(fileRows().map((row) => row.querySelector(".cv-changes__stat")?.textContent)).toEqual([
      "+29−0",
      "+4−1",
      "+9−6",
    ]);
    expect(fileRows().map((row) => row.title)).toEqual([
      "src/middleware/idempotency.ts",
      "src/routes/orders.ts",
      "test/orders.test.ts",
    ]);
  });

  it("collapses and expands a single folder", () => {
    renderRow(summary());

    expect(folderRow("src").getAttribute("aria-expanded")).toBe("true");
    act(() => folderRow("src").click());
    expect(folderRow("src").getAttribute("aria-expanded")).toBe("false");
    expect(rowNames()).toEqual(["src", "test", "orders.test.ts"]);

    act(() => folderRow("src").click());
    expect(folderRow("src").getAttribute("aria-expanded")).toBe("true");
    expect(rowNames()).toHaveLength(7);
  });

  it("collapses and expands every folder from the header", () => {
    renderRow(summary());

    expect(foldAllButton()?.getAttribute("aria-label")).toBe("Collapse all folders");
    expect(foldAllButton()?.getAttribute("aria-expanded")).toBe("true");
    act(() => foldAllButton()?.click());
    expect(rowNames()).toEqual(["src", "test"]);
    expect(foldAllButton()?.getAttribute("aria-label")).toBe("Expand all folders");
    expect(foldAllButton()?.getAttribute("aria-expanded")).toBe("false");

    act(() => foldAllButton()?.click());
    expect(rowNames()).toHaveLength(7);
    expect(foldAllButton()?.getAttribute("aria-label")).toBe("Collapse all folders");
  });

  it("offers to collapse again as soon as one folder is expanded", () => {
    renderRow(summary());

    act(() => foldAllButton()?.click());
    act(() => folderRow("test").click());
    expect(rowNames()).toEqual(["src", "test", "orders.test.ts"]);
    expect(foldAllButton()?.getAttribute("aria-label")).toBe("Collapse all folders");

    act(() => foldAllButton()?.click());
    expect(rowNames()).toEqual(["src", "test"]);
  });

  it("offers to expand everything once every root folder was collapsed by hand", () => {
    renderRow(summary());

    act(() => folderRow("src").click());
    act(() => folderRow("test").click());
    expect(rowNames()).toEqual(["src", "test"]);
    expect(foldAllButton()?.getAttribute("aria-label")).toBe("Expand all folders");
    expect(foldAllButton()?.getAttribute("aria-expanded")).toBe("false");

    act(() => foldAllButton()?.click());
    expect(rowNames()).toHaveLength(7);
    expect(foldAllButton()?.getAttribute("aria-label")).toBe("Collapse all folders");
    expect(foldAllButton()?.getAttribute("aria-expanded")).toBe("true");
  });

  it("restores nested folders as they were when their parent reopens", () => {
    renderRow(summary());

    act(() => folderRow("middleware").click());
    act(() => folderRow("src").click());
    expect(rowNames()).toEqual(["src", "test", "orders.test.ts"]);

    act(() => folderRow("src").click());
    expect(folderRow("middleware").getAttribute("aria-expanded")).toBe("false");
    expect(folderRow("routes").getAttribute("aria-expanded")).toBe("true");
    expect(rowNames()).toEqual([
      "src",
      "middleware",
      "routes",
      "orders.ts",
      "test",
      "orders.test.ts",
    ]);
  });

  it("renders every row in one flat list at a constant depth and exposes the level", () => {
    renderRow(branchingSummary(9));
    expect(rowNames()).toEqual(["level-1"]);
    act(() => foldAllButton()?.click());

    const deepest = folderRow("level-9");
    const top = folderRow("level-1");
    expect(host.querySelectorAll(".cv-changes ul")).toHaveLength(1);
    expect(ancestorsWithinCard(top)).toBe(2);
    expect(ancestorsWithinCard(deepest)).toBe(ancestorsWithinCard(top));
    expect(rows().map((row) => ancestorsWithinCard(row))).toEqual(Array(18).fill(2));
    expect(top.parentElement?.getAttribute("aria-level")).toBe("1");
    expect(deepest.parentElement?.getAttribute("aria-level")).toBe("9");
    expect(fileRows().map((row) => row.parentElement?.getAttribute("aria-level"))).toEqual([
      "10",
      "9",
      "8",
      "7",
      "6",
      "5",
      "4",
      "3",
      "2",
    ]);
  });

  it("compacts a single-child folder chain and opens a file by its recorded path", () => {
    const open = vi.fn();
    renderRow(
      summary({ files: [file("src\\win\\legacy.ts", 2, 3), file("src/win/modern.ts", 5, 0)] }),
      open,
    );

    expect(rowNames()).toEqual(["src/win", "legacy.ts", "modern.ts"]);
    act(() => fileRows()[0]?.click());
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("src\\win\\legacy.ts");
  });

  it("uses the singular, marks the active turn and hides unknown counts", () => {
    renderRow(summary({ files: [file("assets/logo.png", null, null)] }), () => undefined, true);

    expect(host.querySelector(".cv-changes__header")?.textContent).toBe("1 changed fileOpen diff");
    expect(openDiffButton()?.getAttribute("aria-label")).toBe("1 changed file. Open diff");
    expect(host.querySelector<HTMLElement>(".cv-changes")?.dataset.active).toBe("true");
    expect(host.querySelector(".cv-changes__stat")).toBeNull();
  });

  it("shows no folder control or folder alignment for a flat change set", () => {
    renderRow(summary({ files: [file("README.md", 1, 0), file("package.json", 2, 2)] }));

    expect(foldAllButton()).toBeNull();
    expect(host.querySelector("[aria-expanded]")).toBeNull();
    expect(host.querySelector(".cv-changes__chevron")).toBeNull();
    expect(rowNames()).toEqual(["package.json", "README.md"]);
  });

  it("starts a large change set collapsed to its top-level folders and root files", () => {
    renderRow(largeSummary());

    expect(host.querySelector(".cv-changes__count")?.textContent).toBe("255 changed files");
    expect(rowNames()).toEqual([...LARGE_TOP_LEVEL_FOLDERS, ...LARGE_ROOT_FILES]);
    expect(rowLevels()).toEqual(Array(10).fill("1"));
    expect(
      LARGE_TOP_LEVEL_FOLDERS.map((name) => folderRow(name).getAttribute("aria-expanded")),
    ).toEqual(Array(5).fill("false"));
    expect(folderRow("apps").querySelector(".cv-changes__stat")?.textContent).toBe("+60−0");
    expect(folderRow("src").querySelector(".cv-changes__stat")?.textContent).toBe("+50−0");
    expect(moreLine()).toBeNull();
    expect(foldAllButton()?.getAttribute("aria-label")).toBe("Expand all folders");
    expect(foldAllButton()?.getAttribute("aria-expanded")).toBe("false");
  });

  it("drills into one folder of a large change set without a remainder", () => {
    renderRow(largeSummary());

    act(() => folderRow("src").click());
    expect(rowNames()).toEqual([
      "apps",
      "docs",
      "packages",
      "scripts",
      "src",
      "components",
      "domain",
      ...LARGE_ROOT_FILES,
    ]);
    expect(folderRow("components").getAttribute("aria-expanded")).toBe("false");
    expect(moreLine()).toBeNull();
    expect(foldAllButton()?.getAttribute("aria-label")).toBe("Collapse all folders");
  });

  it("caps the visible rows and keeps the remainder exact as folders fold", () => {
    renderRow(largeSummary());

    act(() => foldAllButton()?.click());
    expect(rows()).toHaveLength(MAX_CHANGES_VISIBLE_ROWS);
    expect(rowNames()[0]).toBe("apps");
    expect(rowNames()[61]).toBe("docs");
    expect(rows()[MAX_CHANGES_VISIBLE_ROWS - 1]?.title).toBe("docs/file-38.md");
    expect(moreLine()).toBe("157 more in the diff");

    act(() => folderRow("apps").click());
    expect(rows()).toHaveLength(MAX_CHANGES_VISIBLE_ROWS);
    expect(rowNames().slice(0, 2)).toEqual(["apps", "docs"]);
    expect(rowNames()[42]).toBe("packages");
    expect(rows()[MAX_CHANGES_VISIBLE_ROWS - 1]?.title).toBe("packages/file-57.ts");
    expect(moreLine()).toBe("98 more in the diff");

    expect(foldAllButton()?.getAttribute("aria-label")).toBe("Collapse all folders");
    act(() => foldAllButton()?.click());
    expect(rowNames()).toEqual([...LARGE_TOP_LEVEL_FOLDERS, ...LARGE_ROOT_FILES]);
    expect(moreLine()).toBeNull();
  });

  it("counts the files under an expanded folder whose rows were cut", () => {
    renderRow(twoFolderSummary(MAX_CHANGES_VISIBLE_ROWS - 2, 5));

    act(() => foldAllButton()?.click());
    expect(rows()).toHaveLength(MAX_CHANGES_VISIBLE_ROWS);
    expect(rows()[MAX_CHANGES_VISIBLE_ROWS - 1]).toBe(folderRow("b"));
    expect(folderRow("b").getAttribute("aria-expanded")).toBe("true");
    expect(moreLine()).toBe("5 more in the diff");

    act(() => folderRow("b").click());
    expect(rows()).toHaveLength(MAX_CHANGES_VISIBLE_ROWS);
    expect(moreLine()).toBeNull();
  });

  it("lists exactly the row cap without a remainder line and counts one row past it", () => {
    renderRow(summary({ files: files(MAX_CHANGES_VISIBLE_ROWS, (index) => `file-${index}.ts`) }));
    expect(fileRows()).toHaveLength(MAX_CHANGES_VISIBLE_ROWS);
    expect(moreLine()).toBeNull();

    renderRow(
      summary({ files: files(MAX_CHANGES_VISIBLE_ROWS + 1, (index) => `file-${index}.ts`) }),
    );
    expect(fileRows()).toHaveLength(MAX_CHANGES_VISIBLE_ROWS);
    expect(moreLine()).toBe("1 more in the diff");
  });

  it("starts expanded while the whole tree fits the initial row allowance", () => {
    renderRow(twoFolderSummary(5, MAX_CHANGES_INITIALLY_EXPANDED_ROWS - 7));

    expect(rows()).toHaveLength(MAX_CHANGES_INITIALLY_EXPANDED_ROWS);
    expect(fileRows()).toHaveLength(MAX_CHANGES_INITIALLY_EXPANDED_ROWS - 2);
    expect(foldAllButton()?.getAttribute("aria-label")).toBe("Collapse all folders");
    expect(foldAllButton()?.getAttribute("aria-expanded")).toBe("true");
    expect(moreLine()).toBeNull();
  });

  it("starts collapsed one row past the initial row allowance", () => {
    renderRow(twoFolderSummary(5, MAX_CHANGES_INITIALLY_EXPANDED_ROWS - 6));

    expect(rowNames()).toEqual(["a", "b"]);
    expect(foldAllButton()?.getAttribute("aria-label")).toBe("Expand all folders");
    expect(foldAllButton()?.getAttribute("aria-expanded")).toBe("false");
    expect(moreLine()).toBeNull();

    act(() => foldAllButton()?.click());
    expect(rows()).toHaveLength(MAX_CHANGES_INITIALLY_EXPANDED_ROWS + 1);
  });

  it("says when only part of the turn was recorded", () => {
    renderRow(summary({ truncated: true }));

    expect(host.querySelector(".cv-changes__count")?.textContent).toBe("At least 3 changed files");
    expect(openDiffButton()?.getAttribute("aria-label")).toBe(
      "At least 3 changed files, 42 lines added, 7 removed. Open diff",
    );
    expect(moreLine()).toBeNull();
  });

  it("never presents a capped partial list as complete", () => {
    renderRow(summary({ files: files(MAX_TURN_CHANGED_FILES + 1, (index) => `file-${index}.ts`) }));

    expect(host.querySelector(".cv-changes__count")?.textContent).toBe(
      `At least ${MAX_TURN_CHANGED_FILES} changed files`,
    );
    expect(fileRows()).toHaveLength(MAX_CHANGES_VISIBLE_ROWS);
    expect(moreLine()).toBe(
      `At least ${MAX_TURN_CHANGED_FILES - MAX_CHANGES_VISIBLE_ROWS} more in the diff`,
    );
  });

  it("keeps the partial wording on the remainder of a folded large change set", () => {
    renderRow({ ...largeSummary(), truncated: true });
    expect(host.querySelector(".cv-changes__count")?.textContent).toBe(
      "At least 255 changed files",
    );
    expect(moreLine()).toBeNull();

    act(() => foldAllButton()?.click());
    expect(moreLine()).toBe("At least 157 more in the diff");
  });

  it("keeps the open diff control when a partial turn lists no file", () => {
    renderRow(summary({ files: [], truncated: true }));

    expect(host.querySelector(".cv-changes__count")?.textContent).toBe("At least 0 changed files");
    expect(openDiffButton()).not.toBeNull();
    expect(host.querySelector(".cv-changes__tree")).toBeNull();
  });

  it("keeps folder state for the same folders and resets it when the folders change", () => {
    renderRow(summary());
    act(() => folderRow("src").click());
    expect(rowNames()).toEqual(["src", "test", "orders.test.ts"]);

    renderRow(summary({ files: [...summary().files] }));
    expect(rowNames()).toEqual(["src", "test", "orders.test.ts"]);

    renderRow(summary({ files: [...summary().files, file("docs/guide.md", 3, 0)] }));
    expect(folderRow("src").getAttribute("aria-expanded")).toBe("true");
    expect(rowNames()).toHaveLength(9);
    expect(foldAllButton()?.getAttribute("aria-label")).toBe("Collapse all folders");
  });

  it("resets to collapsed when the same folders grow past the initial row allowance", () => {
    renderRow(summary());
    expect(rowNames()).toHaveLength(7);

    renderRow(
      summary({
        files: [...summary().files, ...files(20, (index) => `src/routes/file-${index}.ts`)],
      }),
    );
    expect(rowNames()).toEqual(["src", "test"]);
    expect(foldAllButton()?.getAttribute("aria-label")).toBe("Expand all folders");
    expect(moreLine()).toBeNull();
  });

  it("resets to expanded when a large change set is replaced by a small one", () => {
    renderRow(largeSummary());
    act(() => foldAllButton()?.click());
    expect(rows()).toHaveLength(MAX_CHANGES_VISIBLE_ROWS);

    renderRow(summary());
    expect(rowNames()).toHaveLength(7);
    expect(foldAllButton()?.getAttribute("aria-label")).toBe("Collapse all folders");
    expect(moreLine()).toBeNull();

    renderRow(largeSummary());
    expect(rowNames()).toEqual([...LARGE_TOP_LEVEL_FOLDERS, ...LARGE_ROOT_FILES]);
    expect(foldAllButton()?.getAttribute("aria-label")).toBe("Expand all folders");
  });

  it("keeps every control a keyboard-reachable native button", () => {
    renderRow(summary());

    const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons).toEqual([foldAllButton(), openDiffButton(), ...rows()]);
    expect(rows()).toHaveLength(7);
    expect(host.querySelector('[tabindex], [role="button"], [role="treeitem"]')).toBeNull();
    for (const button of buttons) {
      expect(button.type).toBe("button");
      expect(button.tabIndex).toBe(0);
      expect(button.disabled).toBe(false);
    }
  });

  it("renders the unavailable reason as a quiet note and nothing for an empty turn", () => {
    renderRow(
      summary({
        state: "unavailable",
        files: [],
        reason: "Recorded changes cannot be read in this session.",
      }),
    );
    expect(host.querySelector("button")).toBeNull();
    expect(host.querySelector('.cv-changes-note[role="note"]')?.textContent).toBe(
      "Recorded changes cannot be read in this session.",
    );

    renderRow(summary({ state: "unavailable", files: [], reason: null }));
    expect(host.querySelector(".cv-changes-note")?.textContent).toBe(
      "Changes for this turn are unavailable.",
    );

    renderRow(summary({ files: [] }));
    expect(host.innerHTML).toBe("");
  });

  it("renders nothing for an unsupported turn even when files are present", () => {
    renderRow(summary({ state: "unsupported" }));

    expect(host.innerHTML).toBe("");
  });
});

describe("AgentTurnChangesRow render isolation", () => {
  interface RenderReads {
    card: number;
    rows: number;
  }

  function probedSummary(reads: RenderReads): AgentTurnChangeSummary {
    const orders: AgentTurnChangedFile = {
      oldRelativePath: null,
      status: "modified",
      addedLines: 4,
      deletedLines: 1,
      get relativePath() {
        reads.rows += 1;
        return "src/routes/orders.ts";
      },
    };
    return {
      turnId: "turn-1",
      state: "ready",
      files: [orders, file("test/orders.test.ts", 9, 6)],
      reason: null,
      get truncated() {
        reads.card += 1;
        return false;
      },
    };
  }

  it("does not re-render the card or its rows when only the open-diff callback changes", () => {
    const reads: RenderReads = { card: 0, rows: 0 };
    const changes = probedSummary(reads);
    renderRow(changes, () => undefined);
    const mounted = { ...reads };
    expect(rowNames()).toEqual(["src/routes", "orders.ts", "test", "orders.test.ts"]);
    expect(mounted.card).toBeGreaterThan(0);
    expect(mounted.rows).toBeGreaterThan(0);

    renderRow(changes, () => undefined);
    renderRow(changes, () => undefined);
    expect(reads).toEqual(mounted);
  });

  it("re-renders the card but not the rows when only the active turn changes", () => {
    const reads: RenderReads = { card: 0, rows: 0 };
    const changes = probedSummary(reads);
    renderRow(changes, () => undefined);
    const mounted = { ...reads };

    renderRow(changes, () => undefined, true);
    expect(host.querySelector<HTMLElement>(".cv-changes")?.dataset.active).toBe("true");
    expect(reads.card).toBeGreaterThan(mounted.card);
    expect(reads.rows).toBe(mounted.rows);

    act(() => folderRow("test").click());
    expect(reads.rows).toBeGreaterThan(mounted.rows);
  });

  it("calls the latest open-diff callback from the header and from a file row", () => {
    const first = vi.fn();
    const second = vi.fn();
    const changes = summary();
    renderRow(changes, first);
    renderRow(changes, second);

    act(() => openDiffButton()?.click());
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenLastCalledWith();

    act(() => fileRows()[0]?.click());
    expect(second).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenLastCalledWith("src/middleware/idempotency.ts");
    expect(first).not.toHaveBeenCalled();
  });

  it("still updates the card when the active turn or the summary changes", () => {
    const open = vi.fn();
    const changes = summary();
    renderRow(changes, open);
    expect(host.querySelector<HTMLElement>(".cv-changes")?.dataset.active).toBe("false");

    renderRow(changes, open, true);
    expect(host.querySelector<HTMLElement>(".cv-changes")?.dataset.active).toBe("true");

    renderRow(summary({ files: [file("README.md", 1, 0)] }), open, true);
    expect(host.querySelector(".cv-changes__count")?.textContent).toBe("1 changed file");
    expect(rowNames()).toEqual(["README.md"]);
    expect(foldAllButton()).toBeNull();
  });
});

describe("AgentTurnChangesRow in a followed transcript", () => {
  let container: HTMLDivElement;
  let scrollHeight: number;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    container.append(host);
    scrollHeight = 2_000;
    Object.defineProperties(container, {
      clientHeight: { configurable: true, get: () => 400 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      scrollTop: { configurable: true, writable: true, value: 1_600 },
    });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 320,
      bottom: 26,
      width: 320,
      height: 26,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    container.remove();
  });

  function followedTranscript(): AgentTranscriptFollowController {
    return new AgentTranscriptFollowController(
      container,
      true,
      () => undefined,
      () => 0,
    );
  }

  function clickAndGrow(controller: AgentTranscriptFollowController, control: HTMLElement): void {
    controller.handleClick(control);
    act(() => control.click());
    scrollHeight = 2_400;
    controller.handleLayout();
  }

  it("follows to the latest when a plain control changes the transcript height", () => {
    renderRow(summary());
    const controller = followedTranscript();

    clickAndGrow(controller, required(openDiffButton()));

    expect(controller.isFollowing).toBe(true);
    expect(container.scrollTop).toBe(2_400);
  });

  it("holds the transcript in place when a folder row expands the card", () => {
    renderRow(summary());
    act(() => folderRow("src").click());
    const controller = followedTranscript();

    clickAndGrow(controller, folderRow("src"));

    expect(rowNames()).toHaveLength(7);
    expect(controller.isFollowing).toBe(false);
    expect(container.scrollTop).toBe(1_600);
  });

  it("holds the transcript in place when the header expands every folder", () => {
    renderRow(summary());
    act(() => foldAllButton()?.click());
    const controller = followedTranscript();

    clickAndGrow(controller, required(foldAllButton()));

    expect(rowNames()).toHaveLength(7);
    expect(controller.isFollowing).toBe(false);
    expect(container.scrollTop).toBe(1_600);
  });

  it("holds the transcript in place when a deeply nested folder row expands the card", () => {
    renderRow(branchingSummary(9));
    act(() => foldAllButton()?.click());
    act(() => folderRow("level-9").click());
    const controller = followedTranscript();

    clickAndGrow(controller, folderRow("level-9"));

    expect(folderRow("level-9").getAttribute("aria-expanded")).toBe("true");
    expect(controller.isFollowing).toBe(false);
    expect(container.scrollTop).toBe(1_600);
  });
});
