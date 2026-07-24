// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BreakpointEditorPopover } from "./BreakpointEditorPopover";

describe("BreakpointEditorPopover", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

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

  it("offers contextual add and remove actions with keyboard focus", () => {
    const onEdit = vi.fn();
    const onRemove = vi.fn();
    act(() =>
      root.render(
        <BreakpointEditorPopover
          onCancel={vi.fn()}
          onEdit={onEdit}
          onRemove={onRemove}
          onRemoveLogpoint={vi.fn()}
          onSave={vi.fn(async () => true)}
          request={{
            anchor: { x: 12, y: 24 },
            breakpoint: {
              enabled: true,
              filePath: "/workspace/app.ts",
              id: "bp",
              lineNumber: 3,
            },
            filePath: "/workspace/app.ts",
            editKind: "condition",
            hitConditionSupported: true,
            logMessageSupported: true,
            kind: "menu",
            lineNumber: 3,
            operationToken: 1,
          }}
        />,
      ),
    );
    const add = host.querySelector<HTMLButtonElement>('[role="menuitem"]');
    expect(add?.textContent).toBe("Add Conditional Breakpoint");
    expect(document.activeElement).toBe(add);
    act(() => add?.click());
    expect(onEdit).toHaveBeenCalledWith("condition");
    act(() => host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[1]?.click());
    expect(onEdit).toHaveBeenCalledWith("hitCondition");
    act(() => host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[2]?.click());
    expect(onEdit).toHaveBeenCalledWith("logMessage");
    act(() => host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[3]?.click());
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("offers dedicated edit and remove actions for an existing logpoint", () => {
    const onEdit = vi.fn();
    const onRemoveLogpoint = vi.fn();
    act(() =>
      root.render(
        <BreakpointEditorPopover
          onCancel={vi.fn()}
          onEdit={onEdit}
          onRemove={vi.fn()}
          onRemoveLogpoint={onRemoveLogpoint}
          onSave={vi.fn(async () => true)}
          request={{
            anchor: { x: 1, y: 1 },
            breakpoint: {
              enabled: true,
              filePath: "/workspace/app.ts",
              id: "log",
              lineNumber: 4,
              logMessage: "value={value}",
            },
            editKind: "condition",
            filePath: "/workspace/app.ts",
            hitConditionSupported: true,
            kind: "menu",
            lineNumber: 4,
            logMessageSupported: true,
            operationToken: 1,
          }}
        />,
      ),
    );
    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    act(() => buttons.find((button) => button.textContent === "Edit Logpoint")?.click());
    expect(onEdit).toHaveBeenCalledWith("logMessage");
    act(() => buttons.find((button) => button.textContent === "Remove Logpoint")?.click());
    expect(onRemoveLogpoint).toHaveBeenCalledOnce();
  });

  it("prefills and validates logpoint templates accessibly", () => {
    const onSave = vi.fn(async () => true);
    act(() =>
      root.render(
        <BreakpointEditorPopover
          onCancel={vi.fn()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onRemoveLogpoint={vi.fn()}
          onSave={onSave}
          request={{
            anchor: { x: 1, y: 1 },
            breakpoint: {
              enabled: true,
              filePath: "/workspace/app.ts",
              id: "log",
              lineNumber: 4,
              logMessage: "value={value}",
            },
            editKind: "logMessage",
            filePath: "/workspace/app.ts",
            hitConditionSupported: true,
            kind: "editor",
            lineNumber: 4,
            logMessageSupported: true,
            operationToken: 1,
          }}
        />,
      ),
    );
    const input = host.querySelector<HTMLInputElement>("input")!;
    expect(input.value).toBe("value={value}");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "broken={");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("{braces}");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("prefills edit input, saves on Enter and cancels on Escape or outside click", () => {
    const onCancel = vi.fn();
    const onSave = vi.fn(async () => true);
    act(() =>
      root.render(
        <BreakpointEditorPopover
          onCancel={onCancel}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onRemoveLogpoint={vi.fn()}
          onSave={onSave}
          request={{
            anchor: { x: 12, y: 24 },
            breakpoint: {
              condition: "count > 2",
              enabled: true,
              filePath: "/workspace/app.ts",
              id: "bp",
              lineNumber: 3,
            },
            filePath: "/workspace/app.ts",
            editKind: "condition",
            hitConditionSupported: true,
            logMessageSupported: true,
            kind: "editor",
            lineNumber: 3,
            operationToken: 1,
          }}
        />,
      ),
    );
    const input = host.querySelector<HTMLInputElement>("input");
    expect(input?.value).toBe("count > 2");
    expect(document.activeElement).toBe(input);
    act(() => input?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })));
    expect(onSave).toHaveBeenCalledWith("count > 2");
    act(() => input?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })));
    expect(onCancel).toHaveBeenCalledOnce();
    act(() => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["NUL", "bad\0condition", "NUL character"],
    ["oversized", "é".repeat(2_049), "4096 UTF-8 bytes"],
  ])("blocks an accessible %s condition", (_label, value, message) => {
    const onSave = vi.fn(async () => true);
    act(() =>
      root.render(
        <BreakpointEditorPopover
          onCancel={vi.fn()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onRemoveLogpoint={vi.fn()}
          onSave={onSave}
          request={{
            anchor: { x: 0, y: 0 },
            breakpoint: null,
            filePath: "/workspace/app.ts",
            editKind: "condition",
            hitConditionSupported: true,
            logMessageSupported: true,
            kind: "editor",
            lineNumber: 1,
            operationToken: 1,
          }}
        />,
      ),
    );
    const input = host.querySelector<HTMLInputElement>("input")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(message);
    expect(
      host.querySelector<HTMLButtonElement>(".breakpoint-editor-actions button")?.disabled,
    ).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("edits and validates a typed hit count accessibly", () => {
    const onSave = vi.fn(async () => true);
    act(() =>
      root.render(
        <BreakpointEditorPopover
          onCancel={vi.fn()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onRemoveLogpoint={vi.fn()}
          onSave={onSave}
          request={{
            anchor: { x: 0, y: 0 },
            breakpoint: {
              enabled: true,
              filePath: "/workspace/app.ts",
              hitCondition: { count: 5, kind: "greaterOrEqual" },
              id: "bp",
              lineNumber: 1,
            },
            editKind: "hitCondition",
            filePath: "/workspace/app.ts",
            hitConditionSupported: true,
            logMessageSupported: true,
            kind: "editor",
            lineNumber: 1,
            operationToken: 1,
          }}
        />,
      ),
    );
    const input = host.querySelector<HTMLInputElement>("input")!;
    expect(input.value).toBe(">=5");
    expect(input.getAttribute("placeholder")).toContain("%5");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "five");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("N, >=N, or %N");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("omits hit-count actions when the adapter does not support them", () => {
    act(() =>
      root.render(
        <BreakpointEditorPopover
          onCancel={vi.fn()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onRemoveLogpoint={vi.fn()}
          onSave={vi.fn(async () => true)}
          request={{
            anchor: { x: 0, y: 0 },
            breakpoint: null,
            editKind: "condition",
            filePath: "/workspace/app.php",
            hitConditionSupported: false,
            logMessageSupported: false,
            kind: "menu",
            lineNumber: 1,
            operationToken: 1,
          }}
        />,
      ),
    );
    expect(host.textContent).not.toContain("Hit Count");
    expect(host.textContent).not.toContain("Logpoint");
  });
});
