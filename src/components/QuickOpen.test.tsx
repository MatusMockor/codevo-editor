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
});
