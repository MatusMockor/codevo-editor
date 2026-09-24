// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileSearchResult } from "../domain/workspace";
import { parseQuickOpenQuery } from "../domain/quickOpenQuery";
import { CommandSurface } from "../ui/foundation/CommandList";
import { QuickOpen } from "./QuickOpen";

const PAGE_PROPS = {
  canGoBack: false,
  groupLabel: "orders-api",
  onBack: () => undefined,
  onLocalShortcut: () => false,
} as const;

function surface(node: ReactNode, onClose: () => void = () => undefined) {
  return (
    <CommandSurface label="Command palette" onClose={onClose}>
      {node}
    </CommandSurface>
  );
}

function fileResult(name: string): FileSearchResult {
  return { name, path: `/workspace/src/${name}`, relativePath: `src/${name}` };
}

describe("QuickOpen", () => {
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
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  function render(props: Partial<Parameters<typeof QuickOpen>[0]> = {}) {
    const onChangeQuery = vi.fn();
    const onClose = vi.fn();
    const onOpen = vi.fn();
    const onOpenCurrentFileLocation = vi.fn();
    const query = props.query ?? "";

    act(() => {
      root.render(
        surface(
          <QuickOpen
            {...PAGE_PROPS}
            isOpen
            isLoading={false}
            isTruncated={false}
            query={query}
            request={parseQuickOpenQuery(query)}
            results={[fileResult("User.ts"), fileResult("Post.ts")]}
            onChangeQuery={onChangeQuery}
            onClose={onClose}
            onOpen={onOpen}
            onOpenCurrentFileLocation={onOpenCurrentFileLocation}
            {...props}
          />,
          props.onClose ?? onClose,
        ),
      );
    });

    return { onChangeQuery, onClose, onOpen, onOpenCurrentFileLocation };
  }

  function input() {
    return document.querySelector<HTMLInputElement>(".cv-command-field input");
  }

  it("marks the first result active by default", () => {
    render();
    const rows = document.querySelectorAll('[role="option"]');
    expect(rows[0]?.getAttribute("aria-selected")).toBe("true");
  });

  it("renders a footer hint row", () => {
    render();
    const footer = document.querySelector(".cv-command-footer")?.textContent ?? "";
    expect(footer).toContain("Navigate");
    expect(footer).toContain("Open file");
    expect(footer).toContain("Close");
  });

  it("focuses the search field when opened and reclaims focus after an editor steals it back", () => {
    vi.useFakeTimers();
    const editor = document.createElement("textarea");
    document.body.append(editor);
    editor.focus();

    act(() => {
      root.render(
        surface(
          <QuickOpen
            {...PAGE_PROPS}
            isOpen={false}
            isLoading={false}
            isTruncated={false}
            query=""
            request={parseQuickOpenQuery("")}
            results={[fileResult("User.ts")]}
            onChangeQuery={vi.fn()}
            onClose={vi.fn()}
            onOpen={vi.fn()}
            onOpenCurrentFileLocation={vi.fn()}
          />,
        ),
      );
    });

    act(() => {
      root.render(
        surface(
          <QuickOpen
            {...PAGE_PROPS}
            isOpen
            isLoading={false}
            isTruncated={false}
            query=""
            request={parseQuickOpenQuery("")}
            results={[fileResult("User.ts")]}
            onChangeQuery={vi.fn()}
            onClose={vi.fn()}
            onOpen={vi.fn()}
            onOpenCurrentFileLocation={vi.fn()}
          />,
        ),
      );
    });

    const field = input();
    expect(document.activeElement).toBe(field);

    editor.focus();
    expect(document.activeElement).toBe(editor);

    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(document.activeElement).toBe(field);
    editor.remove();
  });

  it("routes printable editor keystrokes into the search query while open", () => {
    const editor = document.createElement("textarea");
    document.body.append(editor);
    const { onChangeQuery } = render();

    editor.focus();

    act(() => {
      editor.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a" }));
    });

    expect(onChangeQuery).toHaveBeenCalledTimes(1);
    expect(onChangeQuery.mock.calls[0][0]("")).toBe("a");
    expect(editor.value).toBe("");
    editor.remove();
  });

  it("waits for an IME composition to finish before forwarding the completed query", () => {
    const { onChangeQuery } = render();
    const field = input();
    expect(field).not.toBeNull();

    act(() => {
      field?.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      if (field) {
        field.value = "@method";
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });

    expect(onChangeQuery).not.toHaveBeenCalled();

    act(() => {
      field?.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "@method" }),
      );
    });

    expect(onChangeQuery).toHaveBeenCalledTimes(1);
    expect(onChangeQuery).toHaveBeenCalledWith("@method");
  });

  it("routes editor navigation keys into the active quick-open result", () => {
    const editor = document.createElement("textarea");
    document.body.append(editor);
    const { onOpen } = render();

    editor.focus();

    act(() => {
      editor.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    });

    act(() => {
      editor.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].name).toBe("Post.ts");
    editor.remove();
  });

  it("opens a file on click", () => {
    const { onOpen } = render();
    const rows = document.querySelectorAll<HTMLElement>('[role="option"]');

    act(() => {
      rows[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].name).toBe("Post.ts");
  });

  it("opens a path at its parsed line", () => {
    const { onOpen } = render({
      query: "src/User.ts:42",
      results: [fileResult("User.ts")],
    });

    act(() => {
      document
        .querySelector<HTMLElement>('[role="option"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpen).toHaveBeenCalledWith(fileResult("User.ts"), {
      column: null,
      line: 42,
    });
  });

  it("opens a path at its parsed line and column", () => {
    const { onOpen } = render({
      query: "src/User.ts:42:7",
      results: [fileResult("User.ts")],
    });

    act(() => {
      document
        .querySelector<HTMLElement>('[role="option"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpen).toHaveBeenCalledWith(fileResult("User.ts"), {
      column: 7,
      line: 42,
    });
  });

  it("renders a bare current-file location as a confirmable row", () => {
    const { onClose, onOpenCurrentFileLocation } = render({
      query: ":42",
      request: parseQuickOpenQuery(":42"),
      results: [],
    });

    expect(document.body.textContent).toContain("Go to line 42");
    expect(onOpenCurrentFileLocation).not.toHaveBeenCalled();

    act(() => {
      input()?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });

    expect(onOpenCurrentFileLocation).toHaveBeenCalledWith({
      column: null,
      line: 42,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps listing file results under the go-to-line row", () => {
    const { onOpen, onOpenCurrentFileLocation } = render({
      query: ":42",
      request: parseQuickOpenQuery(":42"),
    });

    const options = [...document.querySelectorAll('[role="option"]')];
    expect(options.map((option) => option.textContent)).toEqual([
      "Go to line 42",
      "User.tssrc/User.ts",
      "Post.tssrc/Post.ts",
    ]);
    expect(new Set(options.map((option) => option.id)).size).toBe(3);

    act(() => {
      input()?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });
    expect(onOpenCurrentFileLocation).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("announces the result count politely and ignores Enter during IME composition", () => {
    const { onOpen } = render({ query: "s" });

    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe("2 results");
    act(() => {
      input()?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter", isComposing: true }),
      );
    });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("allows a bare current-file location to be typed before confirmation", () => {
    const { onOpenCurrentFileLocation } = render({
      query: ":4",
      request: parseQuickOpenQuery(":4"),
      results: [],
    });

    render({
      query: ":42",
      request: parseQuickOpenQuery(":42"),
      results: [],
      onOpenCurrentFileLocation,
    });

    expect(document.body.textContent).toContain("Go to line 42");
    expect(onOpenCurrentFileLocation).not.toHaveBeenCalled();
  });

  it("opens an exact path containing a numeric colon as a file", () => {
    const exactColonPath = {
      name: "generated:42",
      path: "/workspace/src/generated:42",
      relativePath: "src/generated:42",
    };
    const { onOpen } = render({
      query: "src/generated:42",
      results: [exactColonPath],
    });

    act(() => {
      document
        .querySelector<HTMLElement>('[role="option"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpen).toHaveBeenCalledWith(exactColonPath);
  });

  it("navigates with ArrowDown and opens on Enter", () => {
    const { onOpen } = render();
    const field = input();

    act(() => {
      field?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    });
    act(() => {
      field?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].name).toBe("Post.ts");
  });

  it("opens the visible result when async search results shrink", () => {
    const onChangeQuery = vi.fn();
    const onClose = vi.fn();
    const onOpen = vi.fn();

    act(() => {
      root.render(
        surface(
          <QuickOpen
            {...PAGE_PROPS}
            isOpen
            isLoading={false}
            isTruncated={false}
            query="initial"
            request={parseQuickOpenQuery("initial")}
            results={[fileResult("User.ts"), fileResult("Post.ts")]}
            onChangeQuery={onChangeQuery}
            onClose={onClose}
            onOpen={onOpen}
            onOpenCurrentFileLocation={vi.fn()}
          />,
        ),
      );
    });

    const field = input();
    act(() => {
      field?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    });

    act(() => {
      root.render(
        surface(
          <QuickOpen
            {...PAGE_PROPS}
            isOpen
            isLoading={false}
            isTruncated={false}
            query="post"
            request={parseQuickOpenQuery("post")}
            results={[fileResult("Post.ts")]}
            onChangeQuery={onChangeQuery}
            onClose={onClose}
            onOpen={onOpen}
            onOpenCurrentFileLocation={vi.fn()}
          />,
        ),
      );
    });

    act(() => {
      input()?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].name).toBe("Post.ts");
  });

  it("closes on Escape", () => {
    const { onClose } = render();
    const field = input();

    act(() => {
      field?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("highlights the matched substring in the file name", () => {
    render({
      query: "user",
      results: [fileResult("User.ts"), fileResult("Post.ts")],
    });

    const marks = document.querySelectorAll(".cv-command-item__title mark");
    expect(marks).toHaveLength(1);
    expect(marks[0]?.textContent).toBe("User");
  });

  it("highlights the matched substring in the relative path when it falls outside the name", () => {
    render({
      query: "src",
      results: [fileResult("User.ts")],
    });

    const mark = document.querySelector(".cv-command-item__description mark");
    expect(mark?.textContent).toBe("src");
  });

  it("renders result names without a mark element when the query is empty", () => {
    render({ query: "" });
    expect(document.querySelector('[role="option"] mark')).toBeNull();
  });

  it("does not infer truncation from an exactly full frontend page", () => {
    render({
      results: Array.from({ length: 80 }, (_, index) => fileResult(`File${index}.ts`)),
    });

    expect(document.body.textContent).not.toContain("Results truncated");
  });

  it("surfaces truncation when the backend walk cap is hit below the frontend cap", () => {
    render({
      isTruncated: true,
      results: [fileResult("OnlyVisibleResult.ts")],
    });

    expect(document.body.textContent).toContain("Results truncated");
  });

  it("surfaces truncation without inventing a file result when traversal finds no matches", () => {
    render({ isTruncated: true, results: [] });

    expect(document.body.textContent).toContain("Results truncated");
    expect(document.body.textContent).not.toContain("No matching files.");
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
  });

  it("shows an accessible compact syntax hint", () => {
    render();

    expect(
      document.querySelector(
        '.cv-command-footer__end [aria-label*="greater-than commands"][aria-label*="path colon line and optional column"]',
      )?.textContent,
    ).toBe("> commands · @ file symbols · # workspace symbols · path:line");
  });

  it("shows a back lead and goes back on Backspace with an empty query when nested", () => {
    const onBack = vi.fn();
    render({ canGoBack: true, onBack, query: "" });
    act(() => {
      input()?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Backspace" }),
      );
    });
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(document.querySelector('button[aria-label="Back"]')).not.toBeNull();
  });

  it("labels the result group with the workspace name", () => {
    render({ groupLabel: "orders-api" });
    expect(document.querySelector(".cv-command-group__label")?.textContent).toBe("orders-api");
  });
});
