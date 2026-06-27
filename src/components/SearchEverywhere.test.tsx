// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command, CommandContext } from "../application/commandRegistry";
import type { ProjectSymbolSearchResult } from "../domain/projectSymbols";
import {
  buildSearchEverywhereModel,
  type SearchEverywhereItem,
} from "../domain/searchEverywhere";
import type { FileSearchResult } from "../domain/workspace";
import { SearchEverywhere } from "./SearchEverywhere";

const context: CommandContext = {
  hasWorkspace: true,
  hasActiveDocument: true,
  activeDocumentDirty: false,
};

function fileResult(name: string): FileSearchResult {
  return { name, path: `/workspace/src/${name}`, relativePath: `src/${name}` };
}

function symbolResult(name: string): ProjectSymbolSearchResult {
  return {
    column: 1,
    containerName: null,
    fullyQualifiedName: `App\\${name}`,
    kind: "class",
    lineNumber: 10,
    name,
    path: `/workspace/app/${name}.php`,
    relativePath: `app/${name}.php`,
  };
}

function command(id: string, title: string): Command {
  return {
    id,
    title,
    category: "Editor",
    isEnabled: () => true,
    run: () => {},
  };
}

describe("SearchEverywhere", () => {
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

  function defaultModel() {
    return buildSearchEverywhereModel({
      query: "",
      files: [fileResult("User.ts")],
      symbols: [symbolResult("User")],
      commands: [command("editor.save", "Save File")],
      context,
    });
  }

  function render(
    props: Partial<Parameters<typeof SearchEverywhere>[0]> = {},
  ) {
    const onChangeQuery = vi.fn();
    const onClose = vi.fn();
    const onActivate = vi.fn<(item: SearchEverywhereItem) => void>();

    act(() => {
      root.render(
        <SearchEverywhere
          isOpen
          isLoading={false}
          query=""
          model={defaultModel()}
          onChangeQuery={onChangeQuery}
          onClose={onClose}
          onActivate={onActivate}
          {...props}
        />,
      );
    });

    return { onChangeQuery, onClose, onActivate };
  }

  function input() {
    return host.querySelector<HTMLInputElement>(".palette-search input");
  }

  function setReactInputValue(field: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;

    if (!setter) {
      throw new Error("native input value setter missing");
    }

    setter.call(field, value);
  }

  it("renders nothing when closed", () => {
    render({ isOpen: false });
    expect(host.querySelector(".search-everywhere")).toBeNull();
  });

  it("renders categorized section headers", () => {
    render();
    const headers = Array.from(
      host.querySelectorAll(".search-everywhere-section-label"),
    ).map((node) => node.textContent);
    expect(headers).toEqual(["Files", "Symbols", "Actions"]);
  });

  it("renders an item per result under its section", () => {
    render();
    const labels = Array.from(
      host.querySelectorAll(".search-everywhere-result strong"),
    ).map((node) => node.textContent);
    expect(labels).toEqual(["User.ts", "User", "Save File"]);
  });

  it("colours symbol rows with a kind icon", () => {
    render();
    const symbolRow = host.querySelectorAll(".search-everywhere-result")[1];
    const icon = symbolRow?.querySelector(".symbol-icon");
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("data-kind")).toBe("class");
  });

  it("renders a footer hint row", () => {
    render();
    expect(host.querySelector(".palette-footer")).not.toBeNull();
  });

  it("selects the first item by default", () => {
    render();
    const rows = host.querySelectorAll(".search-everywhere-result");
    expect(rows[0]?.className).toContain("active");
  });

  it("forwards typing to onChangeQuery", () => {
    const { onChangeQuery } = render();
    const field = input();

    if (field) {
      act(() => {
        setReactInputValue(field, "use");
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }

    expect(onChangeQuery).toHaveBeenCalledWith("use");
  });

  it("navigates across all sections with ArrowDown and activates on Enter", () => {
    const { onActivate } = render();
    const field = input();

    // Move from the file (index 0) to the symbol (index 1).
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

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate.mock.calls[0][0].kind).toBe("symbol");
  });

  it("activates a file result on Enter from the default selection", () => {
    const { onActivate } = render();
    const field = input();

    act(() => {
      field?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
    });

    const item = onActivate.mock.calls[0][0];
    expect(item.kind).toBe("file");
  });

  it("activates an action result when navigated to and clicked", () => {
    const { onActivate } = render();
    const rows = host.querySelectorAll<HTMLButtonElement>(
      ".search-everywhere-result",
    );

    act(() => {
      rows[2]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const item = onActivate.mock.calls[0][0];
    expect(item.kind).toBe("action");
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

  it("does not wrap past the last item on ArrowDown", () => {
    const { onActivate } = render();
    const field = input();

    // Three items: file, symbol, action. Press down 5 times -> stays on action.
    for (let press = 0; press < 5; press += 1) {
      act(() => {
        field?.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
        );
      });
    }
    act(() => {
      field?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
    });

    expect(onActivate.mock.calls[0][0].kind).toBe("action");
  });

  it("shows a loading state", () => {
    render({ isLoading: true, query: "user" });
    expect(host.querySelector(".search-everywhere-state")?.textContent).toContain(
      "Searching",
    );
  });

  it("shows an empty state when a query has no matches", () => {
    const emptyModel = buildSearchEverywhereModel({
      query: "zzz",
      files: [],
      symbols: [],
      commands: [],
      context,
    });
    render({ isLoading: false, query: "zzz", model: emptyModel });
    expect(host.querySelector(".search-everywhere-state")?.textContent).toContain(
      "No results",
    );
  });
});
