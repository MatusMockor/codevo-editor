// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceTodo } from "../domain/workspaceTodo";
import { TodoPanel } from "./TodoPanel";

describe("TodoPanel", () => {
  let host: HTMLDivElement;
  let root: Root;
  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("renders nothing while closed", async () => {
    await renderTodoPanel({ isOpen: false });

    expect(host.querySelector('[aria-label="TODO comments"]')).toBeNull();
  });

  it("lists the aggregated TODO comments grouped by file", async () => {
    await renderTodoPanel();

    const rows = todoRows();

    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("wire the controller");
    expect(rows[1].textContent).toContain("drop the legacy path");
    expect(host.textContent).toContain("UserController.php");
    expect(host.textContent).toContain("legacy.ts");
  });

  it("navigates to the file at the comment line when a row is clicked", async () => {
    const onOpenTodo = vi.fn();
    await renderTodoPanel({ onOpenTodo });

    await act(async () => {
      todoRows()[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpenTodo).toHaveBeenCalledOnce();
    expect(onOpenTodo).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: "/workspace/app/UserController.php",
        line: 12,
        column: 5,
        tag: "TODO",
      }),
    );
  });

  it("shows an empty state when there are no TODO comments", async () => {
    await renderTodoPanel({ todos: [] });

    expect(todoRows()).toHaveLength(0);
    expect(host.textContent).toContain("No TODO comments");
  });

  it("closes when Escape is pressed", async () => {
    const onClose = vi.fn();
    await renderTodoPanel({ onClose });

    await act(async () => {
      panelDialog().dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      );
    });

    expect(onClose).toHaveBeenCalledOnce();
  });

  async function renderTodoPanel(
    overrides: Partial<{
      isOpen: boolean;
      isLoading: boolean;
      onClose: () => void;
      onOpenTodo: (todo: WorkspaceTodo) => void;
      onRefresh: () => void;
      todos: WorkspaceTodo[];
    }> = {},
  ) {
    await act(async () => {
      root.render(
        <TodoPanel
          isLoading={overrides.isLoading ?? false}
          isOpen={overrides.isOpen ?? true}
          onClose={overrides.onClose ?? vi.fn()}
          onOpenTodo={overrides.onOpenTodo ?? vi.fn()}
          onRefresh={overrides.onRefresh ?? vi.fn()}
          todos={overrides.todos ?? todos()}
        />,
      );
      await Promise.resolve();
    });
  }

  function todoRows(): HTMLButtonElement[] {
    return Array.from(host.querySelectorAll<HTMLButtonElement>('[role="option"]'));
  }

  function panelDialog(): HTMLElement {
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]');

    if (!dialog) {
      throw new Error("TODO panel dialog was not rendered.");
    }

    return dialog;
  }
});

function todos(): WorkspaceTodo[] {
  return [
    {
      column: 5,
      filePath: "/workspace/app/UserController.php",
      line: 12,
      relativePath: "app/UserController.php",
      tag: "TODO",
      text: "wire the controller",
    },
    {
      column: 3,
      filePath: "/workspace/src/legacy.ts",
      line: 40,
      relativePath: "src/legacy.ts",
      tag: "FIXME",
      text: "drop the legacy path",
    },
  ];
}
