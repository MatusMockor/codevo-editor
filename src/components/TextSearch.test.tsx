// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultTextSearchOptions,
  type TextSearchOptions,
  type TextSearchResult,
} from "../domain/workspace";
import { searchQueryHistorySession } from "../domain/searchQueryHistory";
import { splitMatchHighlight } from "../domain/textSearchHighlight";
import { TextSearch } from "./TextSearch";

describe("TextSearch", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    searchQueryHistorySession.clear();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("does not render anything while closed", () => {
    renderTextSearch({ isOpen: false });

    expect(host.querySelector(".text-search")).toBeNull();
  });

  it("renders the filter toggles and file mask input", () => {
    renderTextSearch();

    expect(host.querySelector('[aria-label="Match case"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Match whole word"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Use regular expression"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="File mask"]')).not.toBeNull();
  });

  it("toggles case sensitivity through onChangeOptions", () => {
    const onChangeOptions = vi.fn();
    renderTextSearch({ onChangeOptions });

    act(() => {
      caseToggle().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onChangeOptions).toHaveBeenCalledWith(expect.objectContaining({ caseSensitive: true }));
  });

  it("toggles preserve case and applies it to the inline preview", () => {
    const onChangeOptions = vi.fn();
    renderTextSearch({
      onChangeOptions,
      query: "foo",
      replacement: "next",
      results: [result({ lineText: "FOO", matchStart: 0, matchEnd: 3 })],
    });

    const toggle = host.querySelector<HTMLButtonElement>('[aria-label="Preserve case"]');

    expect(toggle?.getAttribute("aria-pressed")).toBe("false");

    act(() => {
      toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onChangeOptions).toHaveBeenCalledWith(expect.objectContaining({ preserveCase: true }));

    renderTextSearch({
      options: { ...defaultTextSearchOptions(), preserveCase: true },
      query: "foo",
      replacement: "next",
      results: [result({ lineText: "FOO", matchStart: 0, matchEnd: 3 })],
    });

    expect(host.querySelector('[aria-label="Preserve case"]')?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(host.querySelector(".text-search-replacement")?.textContent).toBe("NEXT");
  });

  it("reflects the pressed state of an enabled toggle", () => {
    renderTextSearch({
      options: { ...defaultTextSearchOptions(), isRegex: true },
    });

    const regexToggle = host.querySelector<HTMLButtonElement>(
      '[aria-label="Use regular expression"]',
    );

    expect(regexToggle?.getAttribute("aria-pressed")).toBe("true");
    expect(regexToggle?.className).toContain("active");
  });

  it("emits file mask changes through onChangeOptions", () => {
    const onChangeOptions = vi.fn();
    renderTextSearch({ onChangeOptions });

    const mask = host.querySelector<HTMLInputElement>('[aria-label="File mask"]');

    if (!mask) {
      throw new Error("file mask input missing");
    }

    act(() => {
      setReactInputValue(mask, "*.php");
      mask.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onChangeOptions).toHaveBeenCalledWith(expect.objectContaining({ fileMask: "*.php" }));
  });

  it("highlights the matched span inside the preview line", () => {
    renderTextSearch({
      results: [
        result({
          lineText: "final class UserService",
          matchStart: 12,
          matchEnd: 23,
        }),
      ],
    });

    const mark = host.querySelector("mark.text-search-match");

    expect(mark?.textContent).toBe("UserService");
  });

  it.each([
    [{ previewTruncated: true }, "Preview clipped", "a.php, line 1, column 1, preview clipped"],
    [
      { matchTruncated: true, previewTruncated: true },
      "Match and preview clipped",
      "a.php, line 1, column 1, match and preview clipped",
    ],
  ])("surfaces bounded backend preview truthfully", (truncation, marker, accessibleName) => {
    renderTextSearch({ results: [result(truncation)] });

    expect(host.querySelector(".text-search-preview-truncation")?.textContent).toContain(marker);
    expect(host.querySelector(`[aria-label="${accessibleName}"]`)).not.toBeNull();
  });

  it("renders a struck-through match followed by its replacement preview", () => {
    renderTextSearch({
      query: "query",
      replacement: "answer",
      results: [
        result({
          lineText: "before query after",
          matchStart: 7,
          matchEnd: 12,
        }),
      ],
    });

    expect(host.querySelector(".text-search-replaced-match")?.textContent).toBe("query");
    expect(host.querySelector(".text-search-replacement")?.textContent).toBe("answer");
  });

  it("updates the inline preview as the replacement input changes", () => {
    renderStatefulTextSearch({
      query: "query",
      replacement: "first",
      results: [result({ lineText: "query", matchStart: 0, matchEnd: 5 })],
    });

    const input = host.querySelector<HTMLInputElement>('[aria-label="Replace with"]');

    if (!input) {
      throw new Error("replace input missing");
    }

    act(() => {
      setReactInputValue(input, "second");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(host.querySelector(".text-search-replacement")?.textContent).toBe("second");
  });

  it("keeps the existing match highlight when replacement is empty", () => {
    renderTextSearch({
      query: "query",
      replacement: "",
      results: [result({ lineText: "query", matchStart: 0, matchEnd: 5 })],
    });

    expect(host.querySelector("mark.text-search-match")?.textContent).toBe("query");
    expect(host.querySelector(".text-search-replaced-match")).toBeNull();
    expect(host.querySelector(".text-search-replacement")).toBeNull();
  });

  it("shows the plain match when a replacement preview cannot be computed", () => {
    renderTextSearch({
      options: { ...defaultTextSearchOptions(), isRegex: true },
      query: "\\p{Greek}+",
      replacement: "letter",
      results: [result({ lineText: "α", matchStart: 0, matchEnd: 1 })],
    });

    expect(host.querySelector("mark.text-search-match")?.textContent).toBe("α");
    expect(host.querySelector(".text-search-replaced-match")).toBeNull();
    expect(host.querySelector(".text-search-replacement")).toBeNull();
  });

  it("opens a result when it is clicked", () => {
    const onOpen = vi.fn();
    const results = [result({ relativePath: "a.php" })];
    renderTextSearch({ onOpen, results });

    act(() => {
      host
        .querySelector<HTMLButtonElement>(".text-search-result")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpen).toHaveBeenCalledWith(results[0]);
  });

  it("opens the active result when pressing Enter", () => {
    const onOpen = vi.fn();
    const results = [result({ relativePath: "a.php" })];
    renderTextSearch({ onOpen, results });

    pressKey("Enter");

    expect(onOpen).toHaveBeenCalledWith(results[0]);
  });

  it("keeps the active selection and results rendered after opening a result", () => {
    const onOpen = vi.fn();
    const results = [
      result({ path: "/workspace/a.php", relativePath: "a.php" }),
      result({ path: "/workspace/b.php", relativePath: "b.php" }),
    ];
    renderTextSearch({ onOpen, results });

    pressKey("ArrowDown");
    pressKey("Enter");

    expect(onOpen).toHaveBeenCalledWith(results[1]);
    expect(host.querySelectorAll(".text-search-result")).toHaveLength(2);
    expect(host.querySelector(".text-search-result.active strong")?.textContent).toContain("b.php");
  });

  it("returns focus to the editor without closing the result list on Escape", () => {
    const onClose = vi.fn();
    const onReturnFocus = vi.fn();
    renderTextSearch({
      onClose,
      onReturnFocus,
      results: [result({ relativePath: "a.php" })],
    });

    pressKey("Escape");

    expect(onReturnFocus).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(host.querySelectorAll(".text-search-result")).toHaveLength(1);
  });

  it("recalls search history with Alt+Arrow keys while plain arrows navigate results", () => {
    searchQueryHistorySession.push("/workspace", "newest");
    searchQueryHistorySession.push("/workspace", "older");
    searchQueryHistorySession.push("/workspace", "newest");
    searchQueryHistorySession.activate("/workspace");
    renderStatefulQueryTextSearch("draft");

    pressKey("ArrowUp", { altKey: true });
    expect(searchInput().value).toBe("newest");
    pressKey("ArrowUp", { altKey: true });
    expect(searchInput().value).toBe("older");
    pressKey("ArrowDown", { altKey: true });
    expect(searchInput().value).toBe("newest");
    pressKey("ArrowDown", { altKey: true });
    expect(searchInput().value).toBe("draft");
  });

  it("resets recall navigation after editing and leaves empty history unchanged", () => {
    searchQueryHistorySession.activate("/workspace");
    renderStatefulQueryTextSearch("draft");
    pressKey("ArrowUp", { altKey: true });
    expect(searchInput().value).toBe("draft");

    searchQueryHistorySession.push("/workspace", "first");
    searchQueryHistorySession.push("/workspace", "second");
    pressKey("ArrowUp", { altKey: true });
    expect(searchInput().value).toBe("second");

    act(() => {
      setReactInputValue(searchInput(), "edited");
      searchInput().dispatchEvent(new Event("input", { bubbles: true }));
    });
    pressKey("ArrowUp", { altKey: true });
    expect(searchInput().value).toBe("second");
  });

  it("renders the replace input and Replace All button", () => {
    renderTextSearch();

    expect(host.querySelector('[aria-label="Replace with"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Replace all"]')).not.toBeNull();
  });

  it("emits replacement changes through onChangeReplacement", () => {
    const onChangeReplacement = vi.fn();
    renderTextSearch({ onChangeReplacement });

    const input = host.querySelector<HTMLInputElement>('[aria-label="Replace with"]');

    if (!input) {
      throw new Error("replace input missing");
    }

    act(() => {
      setReactInputValue(input, "thread");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onChangeReplacement).toHaveBeenCalledWith("thread");
  });

  it("disables Replace All when there are no results", () => {
    renderTextSearch({ results: [] });

    const replaceAll = host.querySelector<HTMLButtonElement>('[aria-label="Replace all"]');

    expect(replaceAll?.disabled).toBe(true);
  });

  it("disables all replace controls while the current search snapshot is loading", () => {
    renderTextSearch({
      isLoading: true,
      results: [result({ path: "/workspace/a.php", relativePath: "a.php" })],
    });

    expect(host.querySelector<HTMLButtonElement>('[aria-label="Replace all"]')?.disabled).toBe(
      true,
    );
    expect(host.querySelector<HTMLButtonElement>(".text-search-replace-file")?.disabled).toBe(true);
  });

  it("triggers Replace All when there are results", () => {
    const onReplaceAll = vi.fn();
    renderTextSearch({
      onReplaceAll,
      results: [result({ relativePath: "a.php" })],
    });

    const replaceAll = host.querySelector<HTMLButtonElement>('[aria-label="Replace all"]');

    expect(replaceAll?.disabled).toBe(false);

    act(() => {
      replaceAll?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onReplaceAll).toHaveBeenCalledTimes(1);
  });

  it("renders a single Replace-in-file button per distinct file", () => {
    renderTextSearch({
      results: [
        result({ path: "/workspace/a.php", relativePath: "a.php", lineNumber: 1 }),
        result({ path: "/workspace/a.php", relativePath: "a.php", lineNumber: 5 }),
        result({ path: "/workspace/b.php", relativePath: "b.php", lineNumber: 2 }),
      ],
    });

    const replaceFileButtons = host.querySelectorAll(".text-search-replace-file");

    // Two distinct files -> two per-file replace buttons (not one per match).
    expect(replaceFileButtons.length).toBe(2);
  });

  it("collapses and expands file groups with correct match counts", () => {
    renderTextSearch({
      results: [
        result({ path: "/workspace/a.php", relativePath: "a.php", lineNumber: 1 }),
        result({ path: "/workspace/a.php", relativePath: "a.php", lineNumber: 5 }),
        result({ path: "/workspace/b.php", relativePath: "b.php", lineNumber: 2 }),
      ],
    });

    const group = host.querySelector<HTMLButtonElement>('[aria-label="Collapse a.php, 2 matches"]');

    expect(group?.textContent).toContain("2");
    expect(host.querySelectorAll(".text-search-result")).toHaveLength(3);

    act(() => group?.click());

    expect(host.querySelector('[aria-label="Expand a.php, 2 matches"]')).not.toBeNull();
    expect(host.querySelectorAll(".text-search-result")).toHaveLength(1);

    act(() =>
      host.querySelector<HTMLButtonElement>('[aria-label="Expand a.php, 2 matches"]')?.click(),
    );

    expect(host.querySelectorAll(".text-search-result")).toHaveLength(3);
  });

  it("navigates group and match tree rows with Left and Right arrows", () => {
    renderTextSearch({
      results: [
        result({ path: "/workspace/a.php", relativePath: "a.php", lineNumber: 1 }),
        result({ path: "/workspace/a.php", relativePath: "a.php", lineNumber: 5 }),
        result({ path: "/workspace/b.php", relativePath: "b.php", lineNumber: 2 }),
      ],
    });

    const firstGroup = host.querySelector<HTMLButtonElement>(
      '[aria-label="Collapse a.php, 2 matches"]',
    );
    act(() => firstGroup?.focus());
    pressKeyOn(firstGroup, "ArrowLeft");
    expect(host.querySelector('[aria-label="Expand a.php, 2 matches"]')).not.toBeNull();

    const collapsedGroup = host.querySelector<HTMLButtonElement>(
      '[aria-label="Expand a.php, 2 matches"]',
    );
    pressKeyOn(collapsedGroup, "ArrowRight");
    const expandedGroup = host.querySelector<HTMLButtonElement>(
      '[aria-label="Collapse a.php, 2 matches"]',
    );
    pressKeyOn(expandedGroup, "ArrowRight");

    expect(document.activeElement?.classList.contains("text-search-result")).toBe(true);
    pressKeyOn(document.activeElement, "ArrowLeft");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Collapse a.php, 2 matches");
  });

  it("shows truthful paging status and loads more results", () => {
    const onLoadMore = vi.fn();
    renderTextSearch({
      hasMoreResults: true,
      onLoadMore,
      resultCountLowerBound: 101,
      results: Array.from({ length: 100 }, (_, index) =>
        result({
          lineNumber: index + 1,
          path: `/workspace/${index}.ts`,
          relativePath: `${index}.ts`,
        }),
      ),
    });

    expect(host.textContent).toContain("Showing 100 of at least 101 matches");

    act(() =>
      host.querySelector<HTMLButtonElement>('[aria-label="Load more search results"]')?.click(),
    );

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("keeps the backend ceiling explicitly truncated", () => {
    renderTextSearch({
      resultCountLowerBound: 500,
      results: Array.from({ length: 500 }, (_, index) =>
        result({
          lineNumber: index + 1,
          path: "/workspace/a.ts",
          relativePath: "a.ts",
        }),
      ),
      resultsTruncated: true,
    });

    expect(host.textContent).toContain("Showing 500 of at least 500 matches");
    expect(host.querySelector('[aria-label="Load more search results"]')).toBeNull();
  });

  it("windows a large result fixture", () => {
    renderTextSearch({
      results: Array.from({ length: 400 }, (_, index) =>
        result({
          lineNumber: index + 1,
          path: "/workspace/a.ts",
          relativePath: "a.ts",
        }),
      ),
    });

    expect(host.querySelectorAll(".text-search-result").length).toBeLessThan(100);
    expect(host.querySelector(".text-search-window")?.getAttribute("style")).toContain("height");
  });

  it("triggers Replace-in-file with the file path", () => {
    const onReplaceInFile = vi.fn();
    renderTextSearch({
      onReplaceInFile,
      results: [result({ path: "/workspace/a.php", relativePath: "a.php" })],
    });

    act(() => {
      host
        .querySelector<HTMLButtonElement>(".text-search-replace-file")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onReplaceInFile).toHaveBeenCalledWith("/workspace/a.php");
  });

  it("dismisses a file group with an accessible keyboard-operable button", () => {
    const onDismissFile = vi.fn();
    renderTextSearch({
      onDismissFile,
      results: [
        result({ path: "/workspace/a.php", relativePath: "a.php" }),
        result({ path: "/workspace/b.php", relativePath: "b.php" }),
      ],
    });

    const dismiss = host.querySelector<HTMLButtonElement>(
      '[aria-label="Dismiss a.php from Replace All"]',
    );

    expect(dismiss?.type).toBe("button");
    act(() => dismiss?.click());
    expect(onDismissFile).toHaveBeenCalledWith("/workspace/a.php");
  });

  it("hides dismissed groups and updates the visible result summary", () => {
    renderTextSearch({
      dismissedPaths: new Set(["/workspace/a.php"]),
      results: [
        result({ path: "/workspace/a.php", relativePath: "a.php", lineNumber: 1 }),
        result({ path: "/workspace/a.php", relativePath: "a.php", lineNumber: 2 }),
        result({ path: "/workspace/b.php", relativePath: "b.php" }),
      ],
    });

    expect(host.textContent).not.toContain("a.php:");
    expect(host.textContent).toContain("b.php:");
    expect(host.querySelector(".text-search-summary")?.textContent).toBe("1 occurrence in 1 file");
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Replace all"]')?.disabled).toBe(
      false,
    );
  });

  it("hides the restore affordance when no files are dismissed", () => {
    renderTextSearch({
      results: [result({ path: "/workspace/a.php", relativePath: "a.php" })],
    });

    expect(host.querySelector('[aria-label="Restore dismissed search files"]')).toBeNull();
  });

  it("restores all dismissed files and updates the result summary", () => {
    const results = [
      result({ path: "/workspace/a.php", relativePath: "a.php", lineNumber: 1 }),
      result({ path: "/workspace/a.php", relativePath: "a.php", lineNumber: 2 }),
      result({ path: "/workspace/b.php", relativePath: "b.php" }),
      result({ path: "/workspace/c.php", relativePath: "c.php" }),
    ];
    renderRestorableTextSearch(results);

    const restore = host.querySelector<HTMLButtonElement>(
      '[aria-label="Restore dismissed search files"]',
    );

    expect(restore?.type).toBe("button");
    expect(restore?.textContent).toBe("2 dismissed - Restore");
    expect(host.querySelector(".text-search-summary")?.textContent).toBe("1 occurrence in 1 file");

    act(() => restore?.click());

    expect(host.querySelector('[aria-label="Restore dismissed search files"]')).toBeNull();
    expect(host.textContent).toContain("a.php:");
    expect(host.textContent).toContain("b.php:");
    expect(host.querySelector(".text-search-summary")?.textContent).toBe(
      "4 occurrences in 3 files",
    );
  });

  it("qualifies summary counts only when truncation is reported", () => {
    const results = Array.from({ length: 100 }, (_, index) =>
      result({
        path: index < 50 ? "/workspace/a.php" : "/workspace/b.php",
        relativePath: index < 50 ? "a.php" : "b.php",
        lineNumber: index + 1,
      }),
    );
    renderTextSearch({ results });

    expect(host.querySelector(".text-search-summary")?.textContent).toBe(
      "100 occurrences in 2 files",
    );

    renderTextSearch({ results, resultsTruncated: true });

    expect(host.querySelector(".text-search-summary")?.textContent).toBe(
      "at least 100 occurrences in at least 2 files",
    );
  });

  it("clamps the active result when dismissing the active file", () => {
    const onOpen = vi.fn();
    const options = defaultTextSearchOptions();
    const results = [
      result({ path: "/workspace/a.php", relativePath: "a.php" }),
      result({ path: "/workspace/b.php", relativePath: "b.php" }),
      result({ path: "/workspace/c.php", relativePath: "c.php" }),
    ];
    renderTextSearch({ onOpen, options, results });
    pressKey("ArrowDown");
    pressKey("ArrowDown");

    renderTextSearch({
      dismissedPaths: new Set(["/workspace/c.php"]),
      onOpen,
      options,
      results,
    });
    pressKey("Enter");

    expect(onOpen).toHaveBeenCalledWith(results[1]);
    expect(host.querySelector(".text-search-result.active strong")?.textContent).toContain("b.php");
  });

  function renderTextSearch(overrides: Partial<Parameters<typeof TextSearch>[0]> = {}) {
    act(() => {
      root.render(
        <TextSearch
          isLoading={false}
          isOpen
          onChangeOptions={vi.fn()}
          onChangeQuery={vi.fn()}
          onChangeReplacement={vi.fn()}
          onClose={vi.fn()}
          onDismissFile={vi.fn()}
          onLoadMore={vi.fn()}
          onOpen={vi.fn()}
          onReplaceAll={vi.fn()}
          onReplaceInFile={vi.fn()}
          onRestoreDismissedFiles={vi.fn()}
          options={defaultTextSearchOptions()}
          query="query"
          replaceBusy={false}
          replacement=""
          results={[]}
          dismissedPaths={new Set()}
          {...overrides}
        />,
      );
    });
  }

  function renderStatefulTextSearch(overrides: Partial<Parameters<typeof TextSearch>[0]> = {}) {
    function StatefulTextSearch() {
      const [replacement, setReplacement] = useState(overrides.replacement ?? "");

      return (
        <TextSearch
          isLoading={false}
          isOpen
          onChangeOptions={vi.fn()}
          onChangeQuery={vi.fn()}
          onChangeReplacement={setReplacement}
          onClose={vi.fn()}
          onDismissFile={vi.fn()}
          onLoadMore={vi.fn()}
          onOpen={vi.fn()}
          onReplaceAll={vi.fn()}
          onReplaceInFile={vi.fn()}
          onRestoreDismissedFiles={vi.fn()}
          options={defaultTextSearchOptions()}
          query="query"
          replaceBusy={false}
          results={[]}
          dismissedPaths={new Set()}
          {...overrides}
          replacement={replacement}
        />
      );
    }

    act(() => root.render(<StatefulTextSearch />));
  }

  function renderStatefulQueryTextSearch(initialQuery: string) {
    function StatefulQueryTextSearch() {
      const [query, setQuery] = useState(initialQuery);

      return (
        <TextSearch
          dismissedPaths={new Set()}
          isLoading={false}
          isOpen
          onChangeOptions={vi.fn()}
          onChangeQuery={setQuery}
          onChangeReplacement={vi.fn()}
          onClose={vi.fn()}
          onDismissFile={vi.fn()}
          onLoadMore={vi.fn()}
          onOpen={vi.fn()}
          onReplaceAll={vi.fn()}
          onReplaceInFile={vi.fn()}
          onRestoreDismissedFiles={vi.fn()}
          options={defaultTextSearchOptions()}
          query={query}
          replaceBusy={false}
          replacement=""
          results={[]}
        />
      );
    }

    act(() => root.render(<StatefulQueryTextSearch />));
  }

  function renderRestorableTextSearch(results: TextSearchResult[]) {
    function RestorableTextSearch() {
      const [dismissedPaths, setDismissedPaths] = useState<ReadonlySet<string>>(
        new Set(["/workspace/a.php", "/workspace/b.php"]),
      );

      return (
        <TextSearch
          dismissedPaths={dismissedPaths}
          isLoading={false}
          isOpen
          onChangeOptions={vi.fn()}
          onChangeQuery={vi.fn()}
          onChangeReplacement={vi.fn()}
          onClose={vi.fn()}
          onDismissFile={vi.fn()}
          onLoadMore={vi.fn()}
          onOpen={vi.fn()}
          onReplaceAll={vi.fn()}
          onReplaceInFile={vi.fn()}
          onRestoreDismissedFiles={() => setDismissedPaths(new Set())}
          options={defaultTextSearchOptions()}
          query="query"
          replaceBusy={false}
          replacement=""
          results={results}
        />
      );
    }

    act(() => root.render(<RestorableTextSearch />));
  }

  // React installs its own value setter on the input element, so assigning
  // `.value` directly does not register as a change. Calling the prototype's
  // native setter is the supported way to drive a controlled input from tests.
  function setReactInputValue(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;

    if (!setter) {
      throw new Error("native input value setter missing");
    }

    setter.call(input, value);
  }

  function caseToggle(): HTMLButtonElement {
    const toggle = host.querySelector<HTMLButtonElement>('[aria-label="Match case"]');

    if (!toggle) {
      throw new Error("case toggle missing");
    }

    return toggle;
  }

  function searchInput(): HTMLInputElement {
    const input = host.querySelector<HTMLInputElement>('[aria-label="Search text"]');

    if (!input) {
      throw new Error("search input missing");
    }

    return input;
  }

  function pressKey(key: string, init: KeyboardEventInit = {}) {
    const input = host.querySelector('[aria-label="Search text"]');

    if (!input) {
      throw new Error("search input missing");
    }

    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key, ...init }));
    });
  }

  function pressKeyOn(target: Element | null, key: string, init: KeyboardEventInit = {}) {
    if (!target) {
      throw new Error("keyboard target missing");
    }

    act(() => {
      target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key, ...init }));
    });
  }

  function result(overrides: Partial<TextSearchResult> = {}): TextSearchResult {
    return {
      column: 1,
      lineNumber: 1,
      lineText: "match here",
      matchEnd: 5,
      matchStart: 0,
      path: "/workspace/a.php",
      relativePath: "a.php",
      ...overrides,
    };
  }
});

describe("splitMatchHighlight", () => {
  function base(overrides: Partial<TextSearchResult>): TextSearchResult {
    return {
      column: 1,
      lineNumber: 1,
      lineText: "",
      matchEnd: 0,
      matchStart: 0,
      path: "/p",
      relativePath: "p",
      ...overrides,
    };
  }

  it("splits a line into before / match / after", () => {
    const parts = splitMatchHighlight(
      base({ lineText: "final class User", matchStart: 12, matchEnd: 16 }),
    );

    expect(parts).toEqual({
      before: "final class ",
      match: "User",
      after: "",
    });
  });

  it("returns the whole line as before when there is no span", () => {
    const parts = splitMatchHighlight(base({ lineText: "no span", matchStart: 0, matchEnd: 0 }));

    expect(parts).toEqual({ before: "no span", match: "", after: "" });
  });

  it("handles multi-byte characters by char offset", () => {
    const parts = splitMatchHighlight(
      base({ lineText: "café needle", matchStart: 5, matchEnd: 11 }),
    );

    expect(parts.match).toBe("needle");
  });

  it("clamps out-of-range offsets without throwing", () => {
    const parts = splitMatchHighlight(base({ lineText: "short", matchStart: 2, matchEnd: 999 }));

    expect(parts).toEqual({ before: "sh", match: "ort", after: "" });
  });
});

describe("defaultTextSearchOptions", () => {
  it("returns a literal case-insensitive unfiltered baseline", () => {
    const options: TextSearchOptions = defaultTextSearchOptions();

    expect(options).toEqual({
      caseSensitive: false,
      wholeWord: false,
      isRegex: false,
      preserveCase: false,
      fileMask: "",
    });
  });
});
