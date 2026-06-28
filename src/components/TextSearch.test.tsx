// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultTextSearchOptions,
  type TextSearchOptions,
  type TextSearchResult,
} from "../domain/workspace";
import { splitMatchHighlight, TextSearch } from "./TextSearch";

describe("TextSearch", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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
    expect(
      host.querySelector('[aria-label="Use regular expression"]'),
    ).not.toBeNull();
    expect(host.querySelector('[aria-label="File mask"]')).not.toBeNull();
  });

  it("toggles case sensitivity through onChangeOptions", () => {
    const onChangeOptions = vi.fn();
    renderTextSearch({ onChangeOptions });

    act(() => {
      caseToggle().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onChangeOptions).toHaveBeenCalledWith(
      expect.objectContaining({ caseSensitive: true }),
    );
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

    const mask = host.querySelector<HTMLInputElement>(
      '[aria-label="File mask"]',
    );

    if (!mask) {
      throw new Error("file mask input missing");
    }

    act(() => {
      setReactInputValue(mask, "*.php");
      mask.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onChangeOptions).toHaveBeenCalledWith(
      expect.objectContaining({ fileMask: "*.php" }),
    );
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

  it("closes when pressing Escape", () => {
    const onClose = vi.fn();
    renderTextSearch({ onClose });

    pressKey("Escape");

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders the replace input and Replace All button", () => {
    renderTextSearch();

    expect(host.querySelector('[aria-label="Replace with"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Replace all"]')).not.toBeNull();
  });

  it("emits replacement changes through onChangeReplacement", () => {
    const onChangeReplacement = vi.fn();
    renderTextSearch({ onChangeReplacement });

    const input = host.querySelector<HTMLInputElement>(
      '[aria-label="Replace with"]',
    );

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

    const replaceAll = host.querySelector<HTMLButtonElement>(
      '[aria-label="Replace all"]',
    );

    expect(replaceAll?.disabled).toBe(true);
  });

  it("triggers Replace All when there are results", () => {
    const onReplaceAll = vi.fn();
    renderTextSearch({
      onReplaceAll,
      results: [result({ relativePath: "a.php" })],
    });

    const replaceAll = host.querySelector<HTMLButtonElement>(
      '[aria-label="Replace all"]',
    );

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

    const replaceFileButtons = host.querySelectorAll(
      ".text-search-replace-file",
    );

    // Two distinct files -> two per-file replace buttons (not one per match).
    expect(replaceFileButtons.length).toBe(2);
  });

  it("triggers Replace-in-file with the file path", () => {
    const onReplaceInFile = vi.fn();
    renderTextSearch({
      onReplaceInFile,
      results: [
        result({ path: "/workspace/a.php", relativePath: "a.php" }),
      ],
    });

    act(() => {
      host
        .querySelector<HTMLButtonElement>(".text-search-replace-file")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onReplaceInFile).toHaveBeenCalledWith("/workspace/a.php");
  });

  function renderTextSearch(
    overrides: Partial<Parameters<typeof TextSearch>[0]> = {},
  ) {
    act(() => {
      root.render(
        <TextSearch
          isLoading={false}
          isOpen
          onChangeOptions={vi.fn()}
          onChangeQuery={vi.fn()}
          onChangeReplacement={vi.fn()}
          onClose={vi.fn()}
          onOpen={vi.fn()}
          onReplaceAll={vi.fn()}
          onReplaceInFile={vi.fn()}
          options={defaultTextSearchOptions()}
          query="query"
          replaceBusy={false}
          replacement=""
          results={[]}
          {...overrides}
        />,
      );
    });
  }

  // React installs its own value setter on the input element, so assigning
  // `.value` directly does not register as a change. Calling the prototype's
  // native setter is the supported way to drive a controlled input from tests.
  function setReactInputValue(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;

    if (!setter) {
      throw new Error("native input value setter missing");
    }

    setter.call(input, value);
  }

  function caseToggle(): HTMLButtonElement {
    const toggle = host.querySelector<HTMLButtonElement>(
      '[aria-label="Match case"]',
    );

    if (!toggle) {
      throw new Error("case toggle missing");
    }

    return toggle;
  }

  function pressKey(key: string) {
    const input = host.querySelector('[aria-label="Search text"]');

    if (!input) {
      throw new Error("search input missing");
    }

    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
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
    const parts = splitMatchHighlight(
      base({ lineText: "no span", matchStart: 0, matchEnd: 0 }),
    );

    expect(parts).toEqual({ before: "no span", match: "", after: "" });
  });

  it("handles multi-byte characters by char offset", () => {
    const parts = splitMatchHighlight(
      base({ lineText: "café needle", matchStart: 5, matchEnd: 11 }),
    );

    expect(parts.match).toBe("needle");
  });

  it("clamps out-of-range offsets without throwing", () => {
    const parts = splitMatchHighlight(
      base({ lineText: "short", matchStart: 2, matchEnd: 999 }),
    );

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
      fileMask: "",
    });
  });
});
