// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileSearchResult } from "../domain/workspace";
import { QuickOpen } from "./QuickOpen";

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
    vi.useRealTimers();
  });

  function render(props: Partial<Parameters<typeof QuickOpen>[0]> = {}) {
    const onChangeQuery = vi.fn();
    const onClose = vi.fn();
    const onOpen = vi.fn();

    act(() => {
      root.render(
        <QuickOpen
          isOpen
          isLoading={false}
          query=""
          results={[fileResult("User.ts"), fileResult("Post.ts")]}
          onChangeQuery={onChangeQuery}
          onClose={onClose}
          onOpen={onOpen}
          {...props}
        />,
      );
    });

    return { onChangeQuery, onClose, onOpen };
  }

  function input() {
    return host.querySelector<HTMLInputElement>(".palette-search input");
  }

  it("marks the first result active by default", () => {
    render();
    const rows = host.querySelectorAll(".quick-open-result");
    expect(rows[0]?.className).toContain("active");
  });

  it("renders a footer hint row", () => {
    render();
    expect(host.querySelector(".palette-footer")).not.toBeNull();
  });

  it("focuses the search field when opened and reclaims focus after an editor steals it back", () => {
    vi.useFakeTimers();
    const editor = document.createElement("textarea");
    document.body.append(editor);
    editor.focus();

    act(() => {
      root.render(
        <QuickOpen
          isOpen={false}
          isLoading={false}
          query=""
          results={[fileResult("User.ts")]}
          onChangeQuery={vi.fn()}
          onClose={vi.fn()}
          onOpen={vi.fn()}
        />,
      );
    });

    act(() => {
      root.render(
        <QuickOpen
          isOpen
          isLoading={false}
          query=""
          results={[fileResult("User.ts")]}
          onChangeQuery={vi.fn()}
          onClose={vi.fn()}
          onOpen={vi.fn()}
        />,
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
      editor.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "a" }),
      );
    });

    expect(onChangeQuery).toHaveBeenCalledTimes(1);
    expect(onChangeQuery.mock.calls[0][0]("")).toBe("a");
    expect(editor.value).toBe("");
    editor.remove();
  });

  it("routes editor navigation keys into the active quick-open result", () => {
    const editor = document.createElement("textarea");
    document.body.append(editor);
    const { onOpen } = render();

    editor.focus();

    act(() => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      );
    });

    act(() => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
    });

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].name).toBe("Post.ts");
    editor.remove();
  });

  it("opens a file on click", () => {
    const { onOpen } = render();
    const rows = host.querySelectorAll<HTMLButtonElement>(".quick-open-result");

    act(() => {
      rows[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].name).toBe("Post.ts");
  });

  it("navigates with ArrowDown and opens on Enter", () => {
    const { onOpen } = render();
    const field = input();

    act(() => {
      field?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      );
    });
    act(() => {
      field?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
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
        <QuickOpen
          isOpen
          isLoading={false}
          query="initial"
          results={[fileResult("User.ts"), fileResult("Post.ts")]}
          onChangeQuery={onChangeQuery}
          onClose={onClose}
          onOpen={onOpen}
        />,
      );
    });

    const field = input();
    act(() => {
      field?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      );
    });

    act(() => {
      root.render(
        <QuickOpen
          isOpen
          isLoading={false}
          query="post"
          results={[fileResult("Post.ts")]}
          onChangeQuery={onChangeQuery}
          onClose={onClose}
          onOpen={onOpen}
        />,
      );
    });

    act(() => {
      input()?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
    });

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].name).toBe("Post.ts");
  });

  it("closes on Escape", () => {
    const { onClose } = render();
    const field = input();

    act(() => {
      field?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      );
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("highlights the matched substring in the file name", () => {
    render({
      query: "user",
      results: [fileResult("User.ts"), fileResult("Post.ts")],
    });

    const marks = host.querySelectorAll(".quick-open-result strong mark");
    expect(marks).toHaveLength(1);
    expect(marks[0]?.textContent).toBe("User");
  });

  it("highlights the matched substring in the relative path when it falls outside the name", () => {
    render({
      query: "src",
      results: [fileResult("User.ts")],
    });

    const mark = host.querySelector(".quick-open-result small mark");
    expect(mark?.textContent).toBe("src");
  });

  it("renders result names without a mark element when the query is empty", () => {
    render({ query: "" });
    expect(host.querySelector(".quick-open-result mark")).toBeNull();
  });
});
