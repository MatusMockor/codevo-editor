// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectSymbolSearchResult } from "../domain/projectSymbols";
import { WorkspaceSymbols } from "./WorkspaceSymbols";

describe("WorkspaceSymbols", () => {
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
    renderWorkspaceSymbols({ isOpen: false });

    expect(host.querySelector(".quick-open")).toBeNull();
  });

  it("renders every symbol result including functions and methods", () => {
    renderWorkspaceSymbols({
      results: [
        symbol({ kind: "class", name: "UserService" }),
        symbol({ kind: "method", name: "loadUser" }),
        symbol({ kind: "function", name: "createUser" }),
      ],
    });

    const options = symbolOptions();

    expect(options).toHaveLength(3);
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining("UserService"),
      expect.stringContaining("loadUser"),
      expect.stringContaining("createUser"),
    ]);
  });

  it("moves the active result with arrow keys", () => {
    renderWorkspaceSymbols({
      results: [
        symbol({ name: "First" }),
        symbol({ name: "Second" }),
        symbol({ name: "Third" }),
      ],
    });

    pressKey("ArrowDown");
    pressKey("ArrowDown");

    expect(symbolOptions()[2].className).toContain("active");

    pressKey("ArrowUp");

    expect(symbolOptions()[1].className).toContain("active");
  });

  it("opens the active result when pressing Enter", () => {
    const onOpen = vi.fn();
    const results = [symbol({ name: "First" }), symbol({ name: "Second" })];
    renderWorkspaceSymbols({ onOpen, results });

    pressKey("ArrowDown");
    pressKey("Enter");

    expect(onOpen).toHaveBeenCalledWith(results[1]);
  });

  it("opens a result when it is clicked", () => {
    const onOpen = vi.fn();
    const results = [symbol({ name: "First" }), symbol({ name: "Second" })];
    renderWorkspaceSymbols({ onOpen, results });

    act(() => {
      symbolOptions()[1].dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(onOpen).toHaveBeenCalledWith(results[1]);
  });

  it("closes when pressing Escape", () => {
    const onClose = vi.fn();
    renderWorkspaceSymbols({ onClose, results: [symbol({ name: "First" })] });

    pressKey("Escape");

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  function renderWorkspaceSymbols(
    overrides: Partial<Parameters<typeof WorkspaceSymbols>[0]> = {},
  ) {
    act(() => {
      root.render(
        <WorkspaceSymbols
          isLoading={false}
          isOpen
          onChangeQuery={vi.fn()}
          onClose={vi.fn()}
          onOpen={vi.fn()}
          query="query"
          results={[]}
          {...overrides}
        />,
      );
    });
  }

  function symbolOptions(): HTMLButtonElement[] {
    return Array.from(host.querySelectorAll<HTMLButtonElement>(
      ".quick-open-result",
    ));
  }

  function pressKey(key: string) {
    const input = host.querySelector("input");

    if (!input) {
      throw new Error("Workspace symbols search input is missing.");
    }

    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
    });
  }

  function symbol(
    overrides: Partial<ProjectSymbolSearchResult> = {},
  ): ProjectSymbolSearchResult {
    const name = overrides.name ?? "Symbol";

    return {
      column: 1,
      containerName: null,
      fullyQualifiedName: name,
      kind: "class",
      lineNumber: 1,
      name,
      path: `/workspace/src/${name}.ts`,
      relativePath: `src/${name}.ts`,
      ...overrides,
    };
  }
});
