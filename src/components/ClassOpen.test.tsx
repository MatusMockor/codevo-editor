// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ProjectSymbolKind,
  ProjectSymbolSearchResult,
} from "../domain/projectSymbols";
import { ClassOpen } from "./ClassOpen";

function symbol(
  name: string,
  kind: ProjectSymbolKind,
): ProjectSymbolSearchResult {
  return {
    column: 1,
    containerName: null,
    fullyQualifiedName: `App\\${name}`,
    kind,
    lineNumber: 10,
    name,
    path: `/workspace/app/${name}.php`,
    relativePath: `app/${name}.php`,
  };
}

describe("ClassOpen", () => {
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

  function render(
    props: Partial<Parameters<typeof ClassOpen>[0]> = {},
  ) {
    const onChangeQuery = vi.fn();
    const onClose = vi.fn();
    const onOpen = vi.fn();

    act(() => {
      root.render(
        <ClassOpen
          isOpen
          isLoading={false}
          query=""
          results={[
            symbol("User", "class"),
            symbol("Authenticatable", "interface"),
            symbol("HasFactory", "trait"),
            symbol("Status", "enum"),
          ]}
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

  it("renders a round kind icon coloured by symbol kind", () => {
    render();
    const icons = Array.from(host.querySelectorAll(".symbol-icon"));
    expect(icons).toHaveLength(4);
    expect(icons.map((icon) => icon.getAttribute("data-kind"))).toEqual([
      "class",
      "interface",
      "trait",
      "enum",
    ]);
  });

  it("marks the first result active by default", () => {
    render();
    const rows = host.querySelectorAll(".quick-open-result");
    expect(rows[0]?.className).toContain("active");
  });

  it("renders a footer hint row", () => {
    render();
    expect(host.querySelector(".palette-footer")).not.toBeNull();
  });

  it("opens a result on click", () => {
    const { onOpen } = render();
    const rows = host.querySelectorAll<HTMLButtonElement>(".quick-open-result");

    act(() => {
      rows[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].name).toBe("Authenticatable");
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
    expect(onOpen.mock.calls[0][0].name).toBe("Authenticatable");
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
