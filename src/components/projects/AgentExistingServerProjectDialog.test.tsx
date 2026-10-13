// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentExistingServerProjectDialog,
  MAX_EXISTING_SERVER_PROJECT_ROWS,
  type AgentExistingServerProjectDialogProps,
} from "./AgentExistingServerProjectDialog";

const DIALOG = '[role="dialog"][aria-label="Open server project"]';
const PROJECTS = [
  { key: "remote:srv:runner:api", label: "storefront-api" },
  { key: "remote:srv:runner:web", label: "storefront-web" },
  { key: "remote:srv:runner:billing", label: "billing" },
];

function manyProjects(count: number) {
  return Array.from({ length: count }, (_unused, index) => ({
    key: `remote:srv:runner:project-${index}`,
    label: `project-${String(index).padStart(3, "0")}`,
  }));
}

describe("AgentExistingServerProjectDialog", () => {
  let host: HTMLDivElement;
  let root: Root;
  const onClose = vi.fn<() => void>();
  const onSelect = vi.fn<(key: string) => void>();

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    onClose.mockClear();
    onSelect.mockClear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(props: Partial<AgentExistingServerProjectDialogProps> = {}) {
    act(() =>
      root.render(
        <AgentExistingServerProjectDialog
          onClose={onClose}
          onSelect={onSelect}
          projects={PROJECTS}
          {...props}
        />,
      ),
    );
  }

  function dialog(): HTMLElement {
    const found = document.querySelector<HTMLElement>(DIALOG);
    expect(found).toBeInstanceOf(HTMLElement);
    return found as HTMLElement;
  }

  function input(): HTMLInputElement {
    const found = dialog().querySelector<HTMLInputElement>('input[role="combobox"]');
    expect(found).toBeInstanceOf(HTMLInputElement);
    return found as HTMLInputElement;
  }

  function options(): HTMLElement[] {
    return [...dialog().querySelectorAll<HTMLElement>('[role="option"]')];
  }

  function press(key: string) {
    act(() => {
      input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
  }

  function type(value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input(), value);
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("is a modal command surface with the projects in a listbox and the filter focused", () => {
    render();
    expect(dialog().getAttribute("aria-modal")).toBe("true");
    expect(dialog().querySelector('[role="listbox"]')?.getAttribute("aria-label")).toBe(
      "Server projects",
    );
    expect(options().map((row) => row.textContent)).toEqual([
      "storefront-api",
      "storefront-web",
      "billing",
    ]);
    expect(document.activeElement).toBe(input());
    expect(input().getAttribute("aria-label")).toBe("Filter server projects");
    expect(input().getAttribute("aria-activedescendant")).toBe(options()[0]?.id);
  });

  it("has the standard keyboard footer and no stray Close control", () => {
    render();
    const footer = dialog().querySelector(".cv-command-footer");
    expect(footer?.textContent).toBe("↑↓NavigateEnterOpenEscClose");
    expect(dialog().querySelector(".agent-linkbutton")).toBeNull();
    expect(dialog().querySelectorAll("button")).toHaveLength(0);
    expect(document.querySelector(".agent-project-source")).toBeNull();
  });

  it("closes with Escape", () => {
    render();
    press("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("closes when the backdrop is pressed but not when the dialog is", () => {
    render();
    act(() => {
      dialog().dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
    const viewport = document.querySelector<HTMLElement>(".cv-command-viewport");
    expect(viewport).toBeInstanceOf(HTMLElement);
    act(() => {
      viewport?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens the clicked project", () => {
    render();
    act(() => options()[1]?.click());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("remote:srv:runner:web");
  });

  it("moves the active option with the arrow keys, wraps and opens it with Enter", () => {
    render();
    press("ArrowDown");
    press("ArrowDown");
    expect(options()[2]?.getAttribute("aria-selected")).toBe("true");
    expect(input().getAttribute("aria-activedescendant")).toBe(options()[2]?.id);
    press("ArrowDown");
    expect(options()[0]?.getAttribute("aria-selected")).toBe("true");
    press("ArrowUp");
    press("Enter");
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("remote:srv:runner:billing");
  });

  it("filters by name and says when nothing matches", () => {
    render();
    type("WEB");
    expect(options().map((row) => row.textContent)).toEqual(["storefront-web"]);
    press("Enter");
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("remote:srv:runner:web");
    type("nothing-like-this");
    expect(options()).toHaveLength(0);
    expect(dialog().textContent).toContain("No matching project on this server.");
    press("Enter");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("explains an empty server", () => {
    render({ projects: [] });
    expect(options()).toHaveLength(0);
    expect(dialog().textContent).toContain(
      "No projects available on this server. Check its connection, clone a repository or add an existing folder.",
    );
    expect(dialog().textContent).not.toContain("more not shown");
  });

  it("caps the rendered rows and states how many are hidden", () => {
    render({ projects: manyProjects(MAX_EXISTING_SERVER_PROJECT_ROWS + 6) });
    expect(options()).toHaveLength(MAX_EXISTING_SERVER_PROJECT_ROWS);
    expect(dialog().querySelector(".cv-projects-notice")?.textContent).toBe(
      "6 more not shown, refine the filter",
    );
    type("project-069");
    expect(options().map((row) => row.textContent)).toEqual(["project-069"]);
    expect(dialog().querySelector(".cv-projects-notice")).toBeNull();
  });

  it("shows no note at exactly the cap", () => {
    render({ projects: manyProjects(MAX_EXISTING_SERVER_PROJECT_ROWS) });
    expect(options()).toHaveLength(MAX_EXISTING_SERVER_PROJECT_ROWS);
    expect(dialog().querySelector(".cv-projects-notice")).toBeNull();
  });

  it("returns focus to the invoker when it closes", () => {
    const invoker = document.createElement("button");
    document.body.append(invoker);
    const returnFocusRef = createRef<HTMLElement | null>();
    returnFocusRef.current = invoker;
    render({ returnFocusRef });
    expect(document.activeElement).toBe(input());
    act(() => root.render(null));
    expect(document.activeElement).toBe(invoker);
    invoker.remove();
  });
});
