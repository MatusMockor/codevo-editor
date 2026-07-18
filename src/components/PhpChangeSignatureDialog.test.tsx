// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhpChangeSignatureDialog } from "./PhpChangeSignatureDialog";

describe("PhpChangeSignatureDialog", () => {
  let host: HTMLDivElement;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    HTMLDialogElement.prototype.showModal = vi.fn(function (
      this: HTMLDialogElement,
    ) {
      this.setAttribute("open", "");
    });
    HTMLDialogElement.prototype.close = vi.fn(function (
      this: HTMLDialogElement,
    ) {
      this.removeAttribute("open");
    });
  });
  afterEach(() => host.remove());

  it("renders an accessible parameter table and preview", async () => {
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <PhpChangeSignatureDialog
          onAdd={vi.fn()}
          onApply={vi.fn()}
          onClose={vi.fn()}
          onRowsChange={vi.fn()}
          state={{
            affectedFiles: ["/workspace/Service.php"],
            error: null,
            isApplying: false,
            isLoading: false,
            isOpen: true,
            preview: {
              edits: [],
              filesChanged: 1,
              referencesChanged: 2,
              signature: "(int $count)",
            },
            rows: [
              {
                byReference: false,
                callArgument: "",
                defaultValue: "",
                id: "count",
                modifiers: "",
                name: "count",
                sourceName: "count",
                type: "int",
                variadic: false,
              },
            ],
          }}
        />,
      ),
    );
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(
      host.querySelector('input[aria-label="Type for count"]'),
    ).not.toBeNull();
    expect(host.textContent).toContain("2 call sites");
    expect(host.textContent).toContain("/workspace/Service.php");
    await act(async () => root.unmount());
  });

  it("cancels with Escape and applies with Cmd+Enter only when valid", async () => {
    const onClose = vi.fn();
    const onApply = vi.fn();
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <PhpChangeSignatureDialog
          onAdd={vi.fn()}
          onApply={onApply}
          onClose={onClose}
          onRowsChange={vi.fn()}
          state={{
            affectedFiles: [],
            error: null,
            isApplying: false,
            isLoading: false,
            isOpen: true,
            preview: {
              edits: [],
              filesChanged: 0,
              referencesChanged: 0,
              signature: "()",
            },
            rows: [],
          }}
        />,
      ),
    );
    const dialog = host.querySelector("dialog")!;
    dialog.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: "Enter",
        metaKey: true,
      }),
    );
    dialog.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
    );
    expect(onApply).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });

  it("focuses the first field after asynchronous loading finishes", async () => {
    const root = createRoot(host);
    const baseState = {
      affectedFiles: [],
      error: null,
      invalidRowId: null,
      isApplying: false,
      isOpen: true,
      preview: null,
      rows: [],
    };
    const props = {
      onAdd: vi.fn(),
      onApply: vi.fn(),
      onClose: vi.fn(),
      onRowsChange: vi.fn(),
    };
    await act(async () =>
      root.render(
        <PhpChangeSignatureDialog
          {...props}
          state={{ ...baseState, isLoading: true }}
        />,
      ),
    );
    expect(document.activeElement?.tagName).not.toBe("INPUT");
    await act(async () =>
      root.render(
        <PhpChangeSignatureDialog
          {...props}
          state={{
            ...baseState,
            isLoading: false,
            rows: [row("count")],
          }}
        />,
      ),
    );
    expect(document.activeElement).toBe(
      host.querySelector('input[aria-label="Type for count"]'),
    );
    await act(async () => root.unmount());
  });

  it("identifies the invalid row and blocks cancellation while applying", async () => {
    const onClose = vi.fn();
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <PhpChangeSignatureDialog
          onAdd={vi.fn()}
          onApply={vi.fn()}
          onClose={onClose}
          onRowsChange={vi.fn()}
          state={{
            affectedFiles: [],
            error: "Enter a valid PHP parameter name.",
            invalidRowId: "row-count",
            isApplying: true,
            isLoading: false,
            isOpen: true,
            preview: null,
            rows: [row("count")],
          }}
        />,
      ),
    );
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="Parameter name 1"]',
    )!;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBeTruthy();
    host
      .querySelector("dialog")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      );
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("surfaces a completeness rejection and keeps Apply disabled", async () => {
    const onApply = vi.fn();
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <PhpChangeSignatureDialog
          onAdd={vi.fn()}
          onApply={onApply}
          onClose={vi.fn()}
          onRowsChange={vi.fn()}
          state={{
            affectedFiles: [],
            error:
              "Change Signature needs a completed, error-free workspace index.",
            isApplying: false,
            isLoading: false,
            isOpen: true,
            preview: null,
            rows: [],
          }}
        />,
      ),
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "completed, error-free workspace index",
    );
    const apply = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Apply",
    );
    expect(apply?.disabled).toBe(true);
    apply?.click();
    expect(onApply).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("edits, reorders, adds, and removes parameters without applying", async () => {
    const onAdd = vi.fn();
    const onApply = vi.fn();
    const onClose = vi.fn();
    const onRowsChange = vi.fn();
    const root = createRoot(host);
    const rows = [row("first"), row("second")];
    await act(async () =>
      root.render(
        <PhpChangeSignatureDialog
          onAdd={onAdd}
          onApply={onApply}
          onClose={onClose}
          onRowsChange={onRowsChange}
          state={{
            affectedFiles: ["/workspace/Service.php"],
            error: null,
            isApplying: false,
            isLoading: false,
            isOpen: true,
            preview: {
              edits: [],
              filesChanged: 1,
              referencesChanged: 0,
              signature: "(int $first, int $second)",
            },
            rows,
          }}
        />,
      ),
    );

    changeInput(host, "Type for first", "string");
    expect(onRowsChange).toHaveBeenLastCalledWith([
      { ...rows[0], type: "string" },
      rows[1],
    ]);
    changeInput(host, "Parameter name 1", "renamed");
    expect(onRowsChange).toHaveBeenLastCalledWith([
      { ...rows[0], name: "renamed" },
      rows[1],
    ]);
    changeInput(host, "Default for first", "null");
    expect(onRowsChange).toHaveBeenLastCalledWith([
      { ...rows[0], defaultValue: "null" },
      rows[1],
    ]);
    click(host, "Move first down");
    expect(onRowsChange).toHaveBeenLastCalledWith([rows[1], rows[0]]);
    click(host, "Remove second");
    expect(onRowsChange).toHaveBeenLastCalledWith([rows[0]]);
    clickText(host, "Add parameter");
    expect(onAdd).toHaveBeenCalledOnce();
    clickText(host, "Cancel");
    expect(onClose).toHaveBeenCalledOnce();
    expect(onApply).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});

function row(name: string) {
  return {
    byReference: false,
    callArgument: "",
    defaultValue: "",
    id: `row-${name}`,
    modifiers: "",
    name,
    sourceName: name,
    type: "int",
    variadic: false,
  };
}

function changeInput(host: HTMLElement, label: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`,
  )!;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function click(host: HTMLElement, label: string) {
  act(() =>
    host
      .querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
      .click(),
  );
}

function clickText(host: HTMLElement, text: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === text,
  )!;
  act(() => button.click());
}
