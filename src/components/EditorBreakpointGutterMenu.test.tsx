// @vitest-environment jsdom

import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type * as Monaco from "monaco-editor";
import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";
import type { Breakpoint, BreakpointCreationOwnership } from "../domain/debug";
import {
  EditorBreakpointGutterMutationDiscardError,
  type EditorBreakpointGutterActions,
} from "../application/useEditorBreakpointGutterMenu";
import { EditorBreakpointGutterMenu } from "./EditorBreakpointGutterMenu";

interface ModelStub {
  getLineCount(): number;
  getVersionId(): number;
}

interface EditorHarness {
  editor: Monaco.editor.IStandaloneCodeEditor;
  readonly focus: ReturnType<typeof vi.fn>;
  readonly keyDown: {
    current: ((event: Monaco.IKeyboardEvent) => void) | null;
  };
  model: ModelStub;
  readonly mouseDown: {
    current: ((event: Monaco.editor.IEditorMouseEvent) => void) | null;
  };
  position: Monaco.Position;
  readonly setPosition: ReturnType<typeof vi.fn>;
  version: number;
}

const rootPath = "/workspace";
const filePath = "/workspace/app.ts";
const mouseTypes = {
  CONTENT_TEXT: 6,
  GUTTER_GLYPH_MARGIN: 2,
  GUTTER_LINE_NUMBERS: 3,
};
const glyphLanes = { Center: 2, Left: 1, Right: 3 };

function createEditorHarness(): EditorHarness {
  const mouseDown = {
    current: null as ((event: Monaco.editor.IEditorMouseEvent) => void) | null,
  };
  const keyDown = {
    current: null as ((event: Monaco.IKeyboardEvent) => void) | null,
  };
  const focus = vi.fn();
  const setPosition = vi.fn();
  const harness: EditorHarness = {
    editor: null as unknown as Monaco.editor.IStandaloneCodeEditor,
    focus,
    keyDown,
    model: null as unknown as ModelStub,
    mouseDown,
    position: { column: 3, lineNumber: 7 } as Monaco.Position,
    setPosition,
    version: 1,
  };
  harness.model = {
    getLineCount: () => 40,
    getVersionId: () => harness.version,
  };
  harness.editor = {
    focus,
    getDomNode: () => ({
      getBoundingClientRect: () => ({ left: 20, top: 30 }),
    }),
    getModel: () => harness.model,
    getPosition: () => harness.position,
    getScrolledVisiblePosition: () => ({ height: 18, left: 12, top: 42 }),
    onDidChangeModel: () => ({ dispose: vi.fn() }),
    onKeyDown: (listener: (event: Monaco.IKeyboardEvent) => void) => {
      keyDown.current = listener;
      return { dispose: () => (keyDown.current = null) };
    },
    onMouseDown: (listener: (event: Monaco.editor.IEditorMouseEvent) => void) => {
      mouseDown.current = listener;
      return { dispose: () => (mouseDown.current = null) };
    },
    setPosition,
  } as unknown as Monaco.editor.IStandaloneCodeEditor;
  return harness;
}

function defaultActions(): EditorBreakpointGutterActions {
  return {
    removeBreakpoint: vi.fn(),
    setBreakpointCondition: vi.fn(),
    setBreakpointEnabled: vi.fn(),
    setBreakpointHitCondition: vi.fn(),
    setBreakpointLogMessage: vi.fn(),
    toggleBreakpoint: vi.fn(),
  };
}

function breakpoint(overrides: Partial<Breakpoint> = {}): Breakpoint {
  return {
    enabled: true,
    filePath,
    id: "breakpoint-1",
    lineNumber: 7,
    ...overrides,
  };
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("EditorBreakpointGutterMenu", () => {
  let host: HTMLDivElement;
  let root: Root;
  let harness: EditorHarness;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    harness = createEditorHarness();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  function render(
    overrides: Partial<React.ComponentProps<typeof EditorBreakpointGutterMenu>> = {},
    strict = false,
  ) {
    const actions = "actions" in overrides ? overrides.actions : defaultActions();
    const props: React.ComponentProps<typeof EditorBreakpointGutterMenu> = {
      actions,
      activeDocumentPath: filePath,
      breakpoints: [],
      editor: harness.editor,
      modelIdentity: harness.model as Monaco.editor.ITextModel,
      monaco: {
        editor: {
          GlyphMarginLane: glyphLanes,
          MouseTargetType: mouseTypes,
        },
      } as unknown as typeof Monaco,
      onMutationError: vi.fn(),
      workspaceRoot: rootPath,
      ...overrides,
    };
    const element = <EditorBreakpointGutterMenu {...props} />;
    act(() => root.render(strict ? <StrictMode>{element}</StrictMode> : element));
    return props;
  }

  function openFromKeyboard() {
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    act(() =>
      harness.keyDown.current?.({
        browserEvent: new KeyboardEvent("keydown", { key: "F10", shiftKey: true }),
        preventDefault,
        stopPropagation,
      } as unknown as Monaco.IKeyboardEvent),
    );
    return { preventDefault, stopPropagation };
  }

  function rightClick(type: number, position = { column: 1, lineNumber: 7 }, lane?: number) {
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    act(() =>
      harness.mouseDown.current?.({
        event: {
          posx: 44,
          posy: 66,
          preventDefault,
          rightButton: true,
          stopPropagation,
        },
        target: {
          detail: lane === undefined ? undefined : { glyphMarginLane: lane },
          position,
          type,
        },
      } as unknown as Monaco.editor.IEditorMouseEvent),
    );
    return { preventDefault, stopPropagation };
  }

  function menuItems(): HTMLButtonElement[] {
    return [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  }

  function item(label: string) {
    const button = menuItems().find((candidate) => candidate.textContent === label);
    assert(button, `Expected the ${label} menu item.`);
    return button;
  }

  function input(label: string) {
    const element = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
    assert(element, `Expected the ${label} input.`);
    return element;
  }

  it("uses the new menu as the single entry point for line numbers and exposes every creation action", () => {
    render();
    const event = rightClick(mouseTypes.GUTTER_LINE_NUMBERS);

    expect(menuItems().map((button) => button.textContent)).toEqual([
      "Add Breakpoint",
      "Add Conditional Breakpoint...",
      "Add Hit Count...",
      "Add Logpoint...",
    ]);
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });

  it("opens only for the left glyph-margin lane", () => {
    render();
    const rightLane = rightClick(
      mouseTypes.GUTTER_GLYPH_MARGIN,
      { column: 1, lineNumber: 7 },
      glyphLanes.Right,
    );

    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(rightLane.preventDefault).not.toHaveBeenCalled();

    const leftLane = rightClick(
      mouseTypes.GUTTER_GLYPH_MARGIN,
      { column: 1, lineNumber: 7 },
      glyphLanes.Left,
    );

    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(leftLane.preventDefault).toHaveBeenCalledOnce();
  });

  it("restores inline-breakpoint editing from an exact content-area right-click", async () => {
    const actions = defaultActions();
    const inline = breakpoint({ columnNumber: 11 });
    render({ actions, breakpoints: [inline] });

    rightClick(mouseTypes.CONTENT_TEXT, { column: 11, lineNumber: 7 });
    act(() => item("Add Conditional Breakpoint...").click());
    act(() => setInputValue(input("Condition"), "value > 2"));
    await act(async () => {
      input("Condition").dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
      );
      await Promise.resolve();
    });

    expect(actions.setBreakpointCondition).toHaveBeenCalledWith(inline.id, "value > 2");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("ignores content right-clicks that do not match an exact inline breakpoint", () => {
    render({ breakpoints: [breakpoint({ columnNumber: 11 })] });
    const event = rightClick(mouseTypes.CONTENT_TEXT, { column: 12, lineNumber: 7 });

    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("ports hit-count creation through ownership, reports stale ownership, and retries", async () => {
    const actions = defaultActions();
    const onMutationError = vi.fn();
    const staleOwnership = {
      breakpointId: "stale-breakpoint",
      filePath,
      isCurrent: vi.fn(() => false),
      lineNumber: 7,
      rollback: vi.fn(),
    };
    const ownership = {
      breakpointId: "created-breakpoint",
      filePath,
      isCurrent: vi.fn(() => true),
      lineNumber: 7,
      rollback: vi.fn(),
    };
    vi.mocked(actions.toggleBreakpoint)
      .mockResolvedValueOnce(staleOwnership)
      .mockResolvedValueOnce(ownership);
    render({ actions, onMutationError });
    openFromKeyboard();
    act(() => item("Add Hit Count...").click());
    act(() => setInputValue(input("Hit Count"), ">=5"));

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Save breakpoint"]')?.click();
      await Promise.resolve();
    });

    expect(staleOwnership.rollback).toHaveBeenCalledOnce();
    expect(onMutationError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "authorityLost" }),
    );

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Save breakpoint"]')?.click();
      await Promise.resolve();
    });

    expect(actions.toggleBreakpoint).toHaveBeenCalledWith(filePath, 7);
    expect(actions.setBreakpointHitCondition).toHaveBeenCalledWith("created-breakpoint", {
      count: 5,
      kind: "greaterOrEqual",
    });
    expect(ownership.rollback).not.toHaveBeenCalled();
  });

  it("ports hit-count editing and Remove Logpoint with truthful failure reporting", async () => {
    const actions = defaultActions();
    const onMutationError = vi.fn();
    const hitError = new Error("hit count failed");
    const logError = new Error("logpoint removal failed");
    vi.mocked(actions.setBreakpointHitCondition).mockRejectedValueOnce(hitError);
    vi.mocked(actions.setBreakpointLogMessage).mockRejectedValueOnce(logError);
    const existing = breakpoint({
      hitCondition: { count: 3, kind: "equals" },
      logMessage: "value={value}",
    });
    render({ actions, breakpoints: [existing], onMutationError });
    openFromKeyboard();

    expect(menuItems().map((button) => button.textContent)).toContain("Edit Hit Count...");
    expect(menuItems().map((button) => button.textContent)).toContain("Remove Logpoint");
    act(() => item("Edit Hit Count...").click());
    expect(input("Hit Count").value).toBe("3");
    act(() => setInputValue(input("Hit Count"), "0"));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("whole number from 1");
    expect(
      document.querySelector<HTMLButtonElement>('button[aria-label="Save breakpoint"]')?.disabled,
    ).toBe(true);
    expect(actions.setBreakpointHitCondition).not.toHaveBeenCalled();
    act(() => setInputValue(input("Hit Count"), ">=5"));
    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Save breakpoint"]')?.click();
      await Promise.resolve();
    });
    expect(onMutationError).toHaveBeenCalledWith(hitError);

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Save breakpoint"]')?.click();
      await Promise.resolve();
    });
    expect(actions.setBreakpointHitCondition).toHaveBeenLastCalledWith(existing.id, {
      count: 5,
      kind: "greaterOrEqual",
    });

    openFromKeyboard();
    act(() => item("Edit Hit Count...").click());
    act(() => setInputValue(input("Hit Count"), ""));
    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Save breakpoint"]')?.click();
      await Promise.resolve();
    });
    expect(actions.setBreakpointHitCondition).toHaveBeenLastCalledWith(existing.id, null);
    expect(actions.setBreakpointCondition).not.toHaveBeenCalled();

    openFromKeyboard();
    act(() => item("Remove Logpoint").click());
    await act(async () => Promise.resolve());

    expect(actions.setBreakpointLogMessage).toHaveBeenCalledWith(existing.id, null);
    expect(onMutationError).toHaveBeenCalledWith(logError);
  });

  it("requires a non-empty conditional value before Save is enabled", () => {
    const actions = defaultActions();
    render({ actions });
    openFromKeyboard();
    act(() => item("Add Conditional Breakpoint...").click());
    const condition = input("Condition");
    const save = document.querySelector<HTMLButtonElement>('button[aria-label="Save breakpoint"]');
    assert(save);

    expect(save.disabled).toBe(true);
    act(() => setInputValue(condition, "   "));
    expect(save.disabled).toBe(true);
    act(() => setInputValue(condition, "ready"));
    expect(save.disabled).toBe(false);
    expect(actions.setBreakpointCondition).not.toHaveBeenCalledWith(expect.anything(), "");
  });

  it("requires a non-empty hit count before creating a breakpoint", () => {
    const actions = defaultActions();
    render({ actions });
    openFromKeyboard();
    act(() => item("Add Hit Count...").click());
    const hitCount = input("Hit Count");
    const save = document.querySelector<HTMLButtonElement>('button[aria-label="Save breakpoint"]');
    assert(save);

    expect(save.disabled).toBe(true);
    act(() =>
      hitCount.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
      ),
    );
    expect(actions.toggleBreakpoint).not.toHaveBeenCalled();
    expect(actions.setBreakpointHitCondition).not.toHaveBeenCalled();
  });

  it("creates a trimmed condition and never writes an empty string", async () => {
    const actions = defaultActions();
    const ownership = {
      breakpointId: "created-conditional",
      filePath,
      isCurrent: vi.fn(() => true),
      lineNumber: 7,
      rollback: vi.fn(),
    };
    vi.mocked(actions.toggleBreakpoint).mockResolvedValue(ownership);
    render({ actions });
    openFromKeyboard();
    act(() => item("Add Conditional Breakpoint...").click());
    act(() => setInputValue(input("Condition"), "  ready  "));

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Save breakpoint"]')?.click();
      await Promise.resolve();
    });

    expect(actions.setBreakpointCondition).toHaveBeenCalledWith(ownership.breakpointId, "ready");
    expect(actions.setBreakpointCondition).not.toHaveBeenCalledWith(ownership.breakpointId, "");
  });

  it("clears an existing condition as null and never writes an empty string", async () => {
    const actions = defaultActions();
    const existing = breakpoint({ condition: "i === 5" });
    render({ actions, breakpoints: [existing] });
    openFromKeyboard();
    act(() => item("Edit Conditional Breakpoint...").click());
    const condition = input("Condition");
    const save = document.querySelector<HTMLButtonElement>('button[aria-label="Save breakpoint"]');
    assert(save);

    expect(condition.value).toBe("i === 5");
    act(() => setInputValue(condition, "   "));
    expect(save.disabled).toBe(false);
    await act(async () => {
      save.click();
      await Promise.resolve();
    });

    expect(actions.setBreakpointCondition).toHaveBeenCalledWith(existing.id, null);
    expect(actions.setBreakpointCondition).not.toHaveBeenCalledWith(existing.id, "");
  });

  it.each([
    ["NUL", "bad\0condition", "NUL character"],
    ["oversized", "é".repeat(2_049), "4096 UTF-8 bytes"],
  ])("blocks an accessible %s condition", (_label, value, message) => {
    const actions = defaultActions();
    render({ actions });
    openFromKeyboard();
    act(() => item("Add Conditional Breakpoint...").click());
    const condition = input("Condition");
    const save = document.querySelector<HTMLButtonElement>('button[aria-label="Save breakpoint"]');
    assert(save);

    act(() => setInputValue(condition, value));

    expect(condition.getAttribute("aria-invalid")).toBe("true");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(message);
    expect(save.disabled).toBe(true);
    expect(actions.setBreakpointCondition).not.toHaveBeenCalled();
  });

  it("submits the breakpoint editor with Enter", async () => {
    const actions = defaultActions();
    const existing = breakpoint();
    render({ actions, breakpoints: [existing] });
    openFromKeyboard();
    act(() => item("Add Conditional Breakpoint...").click());
    const condition = input("Condition");
    act(() => setInputValue(condition, "ready"));

    await act(async () => {
      condition.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
      );
      await Promise.resolve();
    });

    expect(actions.setBreakpointCondition).toHaveBeenCalledWith(existing.id, "ready");
  });

  it("uses roving menu tab stops and contains focus inside the modal editor", () => {
    render();
    openFromKeyboard();
    const items = menuItems();

    expect(items.map((button) => button.tabIndex)).toEqual([0, -1, -1, -1]);
    act(() =>
      items[0]?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowDown" }),
      ),
    );
    expect(document.activeElement).toBe(items[1]);
    expect(items.map((button) => button.tabIndex)).toEqual([-1, 0, -1, -1]);

    act(() => item("Add Conditional Breakpoint...").click());
    const condition = input("Condition");
    const cancel = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Cancel",
    );
    assert(cancel);
    act(() => cancel.focus());
    act(() =>
      cancel.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Tab" }),
      ),
    );
    expect(document.activeElement).toBe(condition);
    expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-modal")).toBe("true");
  });

  it("restores focus once on Escape under StrictMode", () => {
    render({}, true);
    openFromKeyboard();

    act(() =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
      ),
    );

    expect(harness.setPosition).toHaveBeenCalledOnce();
    expect(harness.focus).toHaveBeenCalledOnce();
  });

  it("dismisses on an outside pointer without stealing focus into the editor", () => {
    render();
    openFromKeyboard();

    act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));

    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(harness.setPosition).not.toHaveBeenCalled();
    expect(harness.focus).not.toHaveBeenCalled();
  });

  it("dismisses only when a pointerdown is outside its own popover instance", () => {
    const otherPopover = document.createElement("div");
    otherPopover.dataset.editorBreakpointGutterMenu = "other-instance";
    document.body.prepend(otherPopover);
    render();
    openFromKeyboard();
    const addBreakpoint = item("Add Breakpoint");

    act(() =>
      addBreakpoint.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true })),
    );

    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    act(() =>
      otherPopover.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true })),
    );
    expect(document.querySelector('[role="menu"]')).toBeNull();
    otherPopover.remove();
  });

  it("does not refocus or move the caret when a pending save was dismissed outside", async () => {
    const actions = defaultActions();
    const existing = breakpoint({ condition: "before" });
    const completeMutation = { current: null as (() => void) | null };
    vi.mocked(actions.setBreakpointCondition).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          completeMutation.current = resolve;
        }),
    );
    render({ actions, breakpoints: [existing] });
    openFromKeyboard();
    act(() => item("Edit Conditional Breakpoint...").click());
    act(() => setInputValue(input("Condition"), "after"));
    act(() =>
      document.querySelector<HTMLButtonElement>('button[aria-label="Save breakpoint"]')?.click(),
    );

    act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    const resolveMutation = completeMutation.current;
    assert(resolveMutation);
    await act(async () => {
      resolveMutation();
      await Promise.resolve();
    });

    expect(actions.setBreakpointCondition).toHaveBeenCalledWith(existing.id, "after");
    expect(harness.focus).not.toHaveBeenCalled();
    expect(harness.setPosition).not.toHaveBeenCalled();
  });

  it("keeps a newer line menu open when an older pending save resolves", async () => {
    const actions = defaultActions();
    const existing = breakpoint({ condition: "before" });
    const completeMutation = { current: null as (() => void) | null };
    vi.mocked(actions.setBreakpointCondition).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          completeMutation.current = resolve;
        }),
    );
    render({ actions, breakpoints: [existing] });
    openFromKeyboard();
    act(() => item("Edit Conditional Breakpoint...").click());
    act(() => setInputValue(input("Condition"), "after"));
    act(() =>
      document.querySelector<HTMLButtonElement>('button[aria-label="Save breakpoint"]')?.click(),
    );

    act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    rightClick(mouseTypes.GUTTER_LINE_NUMBERS, { column: 1, lineNumber: 20 });
    expect(document.querySelector('[role="menu"]')?.getAttribute("aria-label")).toBe(
      "Breakpoint actions for line 20",
    );
    const resolveMutation = completeMutation.current;
    assert(resolveMutation);
    await act(async () => {
      resolveMutation();
      await Promise.resolve();
    });

    expect(actions.setBreakpointCondition).toHaveBeenCalledWith(existing.id, "after");
    expect(document.querySelector('[role="menu"]')?.getAttribute("aria-label")).toBe(
      "Breakpoint actions for line 20",
    );
    expect(harness.focus).not.toHaveBeenCalled();
    expect(harness.setPosition).not.toHaveBeenCalled();
  });

  it("does not prevent Monaco context menus when breakpoint policy rejects the document", () => {
    render({ activeDocumentPath: "/workspace/settings.json" });
    const keyboard = openFromKeyboard();
    const mouse = rightClick(mouseTypes.GUTTER_LINE_NUMBERS);

    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(keyboard.preventDefault).not.toHaveBeenCalled();
    expect(keyboard.stopPropagation).not.toHaveBeenCalled();
    expect(mouse.preventDefault).not.toHaveBeenCalled();
    expect(mouse.stopPropagation).not.toHaveBeenCalled();
  });

  it("opens after actions transition from unavailable to available", () => {
    const props = render({ actions: undefined });
    openFromKeyboard();
    expect(document.querySelector('[role="menu"]')).toBeNull();

    render({ ...props, actions: defaultActions() });
    openFromKeyboard();

    expect(document.querySelector('[role="menu"]')).not.toBeNull();
  });

  it("preserves an open menu and typed editor input across actions container churn", () => {
    const actions = defaultActions();
    const props = render({ actions });
    openFromKeyboard();

    render({ ...props, actions: { ...actions } });

    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    act(() => item("Add Conditional Breakpoint...").click());
    act(() => setInputValue(input("Condition"), "count > 2"));

    render({ ...props, actions: { ...actions } });

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(input("Condition").value).toBe("count > 2");
  });

  it("reports a same-model version discard instead of silently dropping the action", async () => {
    const actions = defaultActions();
    const onMutationError = vi.fn();
    render({ actions, onMutationError });
    openFromKeyboard();
    harness.version = 2;

    act(() => item("Add Breakpoint").click());
    await act(async () => Promise.resolve());

    expect(actions.toggleBreakpoint).not.toHaveBeenCalled();
    expect(onMutationError).toHaveBeenCalledOnce();
    expect(onMutationError.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        code: "documentChanged",
        name: "EditorBreakpointGutterMutationDiscardError",
      }),
    );
    expect(onMutationError.mock.calls[0]?.[0]).toBeInstanceOf(
      EditorBreakpointGutterMutationDiscardError,
    );
  });

  it("rolls back and reports authority loss after asynchronous creation ownership goes stale", async () => {
    const actions = defaultActions();
    const onMutationError = vi.fn();
    type ToggleResolver = (ownership: {
      breakpointId: string;
      filePath: string;
      isCurrent(): boolean;
      lineNumber: number;
      rollback(): void;
    }) => void;
    const toggleResolver: { current: ToggleResolver | null } = { current: null };
    vi.mocked(actions.toggleBreakpoint).mockImplementation(
      () =>
        new Promise((resolve) => {
          toggleResolver.current = resolve;
        }),
    );
    render({ actions, onMutationError });
    openFromKeyboard();
    act(() => item("Add Conditional Breakpoint...").click());
    act(() => setInputValue(input("Condition"), "ready"));
    act(() =>
      document.querySelector<HTMLButtonElement>('button[aria-label="Save breakpoint"]')?.click(),
    );
    const ownership = {
      breakpointId: "created",
      filePath,
      isCurrent: () => false,
      lineNumber: 7,
      rollback: vi.fn(),
    };
    const completeToggle = toggleResolver.current;
    assert(completeToggle);

    await act(async () => {
      completeToggle(ownership);
      await Promise.resolve();
    });

    expect(ownership.rollback).toHaveBeenCalledOnce();
    expect(onMutationError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "authorityLost" }),
    );
  });

  it("discards a pending create after workspace-root replacement without writing values", async () => {
    const actions = defaultActions();
    const onMutationError = vi.fn();
    const completeToggle = {
      current: null as ((ownership: BreakpointCreationOwnership) => void) | null,
    };
    vi.mocked(actions.toggleBreakpoint).mockImplementation(
      () =>
        new Promise((resolve) => {
          completeToggle.current = resolve;
        }),
    );
    const props = render({ actions, onMutationError });
    openFromKeyboard();
    act(() => item("Add Conditional Breakpoint...").click());
    act(() => setInputValue(input("Condition"), "ready"));
    act(() =>
      document.querySelector<HTMLButtonElement>('button[aria-label="Save breakpoint"]')?.click(),
    );
    render({ ...props, workspaceRoot: "/replacement" });
    const ownership = {
      breakpointId: "created",
      filePath,
      isCurrent: vi.fn(() => true),
      lineNumber: 7,
      rollback: vi.fn(),
    };
    const resolveToggle = completeToggle.current;
    assert(resolveToggle);

    await act(async () => {
      resolveToggle(ownership);
      await Promise.resolve();
    });

    expect(ownership.rollback).toHaveBeenCalledOnce();
    expect(actions.setBreakpointCondition).not.toHaveBeenCalled();
    expect(onMutationError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "authorityLost",
        name: "EditorBreakpointGutterMutationDiscardError",
      }),
    );
    expect(onMutationError.mock.calls[0]?.[0]).toBeInstanceOf(
      EditorBreakpointGutterMutationDiscardError,
    );
  });

  it("discards a pending create after model-identity replacement without writing values", async () => {
    const actions = defaultActions();
    const onMutationError = vi.fn();
    const completeToggle = {
      current: null as ((ownership: BreakpointCreationOwnership) => void) | null,
    };
    vi.mocked(actions.toggleBreakpoint).mockImplementation(
      () =>
        new Promise((resolve) => {
          completeToggle.current = resolve;
        }),
    );
    const props = render({ actions, onMutationError });
    openFromKeyboard();
    act(() => item("Add Conditional Breakpoint...").click());
    act(() => setInputValue(input("Condition"), "ready"));
    act(() =>
      document.querySelector<HTMLButtonElement>('button[aria-label="Save breakpoint"]')?.click(),
    );
    const replacementModel = {
      getLineCount: () => 40,
      getVersionId: () => 1,
    } as Monaco.editor.ITextModel;
    harness.model = replacementModel;
    render({ ...props, modelIdentity: replacementModel });
    const ownership = {
      breakpointId: "created",
      filePath,
      isCurrent: vi.fn(() => true),
      lineNumber: 7,
      rollback: vi.fn(),
    };
    const resolveToggle = completeToggle.current;
    assert(resolveToggle);

    await act(async () => {
      resolveToggle(ownership);
      await Promise.resolve();
    });

    expect(ownership.rollback).toHaveBeenCalledOnce();
    expect(actions.setBreakpointCondition).not.toHaveBeenCalled();
    expect(onMutationError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "documentChanged",
        name: "EditorBreakpointGutterMutationDiscardError",
      }),
    );
    expect(onMutationError.mock.calls[0]?.[0]).toBeInstanceOf(
      EditorBreakpointGutterMutationDiscardError,
    );
  });

  it("validates an opened logpoint editor instead of making a vacuous DOM assertion", () => {
    const existing = breakpoint({ logMessage: "value={value}" });
    render({ breakpoints: [existing] });
    openFromKeyboard();
    act(() => item("Edit Logpoint...").click());
    const logMessage = input("Log message");

    act(() => setInputValue(logMessage, "value={"));

    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Use text and up to 32 expressions in {braces}; escape literal braces as {{ or }}.",
    );
  });
});
