// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DebugCopyValueCandidate } from "../application/debugCopyValue";
import type {
  DebugVariableMutationRows,
  DebugVariableRowMutation,
} from "../application/debugSessionContracts";
import type { DebugVariable } from "../domain/debug";
import type { DebugInspectionOwner, DebugVariablePagesState } from "../domain/debugVariablePages";
import {
  DEBUG_VARIABLE_TREE_ROW_HEIGHT,
  DebugVariableTree,
  MAX_DEBUG_VARIABLE_TREE_ROWS,
  type DebugVariableTreeProps,
} from "./DebugVariableTree";
import type { DebugCopyValueSurface } from "./debugCopyValueSurface";

const owner: DebugInspectionOwner = {
  rootKey: "/workspace",
  sessionId: 7,
  pauseGeneration: 3,
  frameId: 11,
};

describe("DebugVariableTree virtualization", () => {
  let geometry: ReturnType<typeof installGeometry>;
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    geometry = installGeometry();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    geometry.restore();
    vi.restoreAllMocks();
  });

  it("mounts only the visible window of a 500-row tree", () => {
    renderTree(variables(700));
    expandRoot();

    const mountedRows = treeRows();
    expect(mountedRows.length).toBeGreaterThan(0);
    expect(mountedRows.length).toBeLessThan(100);
    expect(group().style.height).toBe(
      `${MAX_DEBUG_VARIABLE_TREE_ROWS * DEBUG_VARIABLE_TREE_ROW_HEIGHT}px`,
    );
    expect(host.textContent).not.toContain("value250");
  });

  it("reaches and focuses rows beyond the window with End, Home, and arrow keys", () => {
    renderTree(variables(100));
    const scope = expandRoot();
    act(() => scope.focus());

    press(scope, "End");
    const last = rowByLabel("value99, 99");
    expect(document.activeElement).toBe(last);
    expect(tree().scrollTop).toBeGreaterThan(0);

    press(last, "ArrowUp");
    expect(document.activeElement).toBe(rowByLabel("value98, 98"));

    press(document.activeElement as HTMLElement, "Home");
    const remountedScope = rowByLabel("Collapse Local");
    expect(document.activeElement).toBe(remountedScope);

    press(remountedScope, "ArrowDown");
    expect(document.activeElement).toBe(rowByLabel("value0, 0"));
  });

  it("expands a node inside the window and windows the appended children", () => {
    const parent: DebugVariable = {
      name: "parent",
      value: "Object",
      variablesReference: 20,
    };
    renderTree([parent, ...variables(60)], {
      variablePages: pages({
        10: [parent, ...variables(60)],
        20: variables(80, "child"),
      }),
    });
    expandRoot();

    act(() => rowByLabel("Expand parent").click());

    expect(treeRows().length).toBeLessThan(142);
    expect(host.textContent).toContain("child0");
    expect(host.textContent).not.toContain("child60");

    scrollTree(55 * DEBUG_VARIABLE_TREE_ROW_HEIGHT);
    expect(host.textContent).toContain("child55");
    expect(host.textContent).not.toContain("child0");
  });

  it("keeps the focused row mounted and interactive while scrolled out of the window", () => {
    const copy = copySurface();
    renderTree(variables(200), { copyValueSurface: copy.surface });
    expandRoot();
    const first = rowByLabel("value0, 0");
    act(() => first.focus());

    scrollTree(180 * DEBUG_VARIABLE_TREE_ROW_HEIGHT);

    const pinnedFirst = rowByLabel("value0, 0");
    expect(pinnedFirst).toBe(first);
    press(pinnedFirst, "c", { ctrlKey: true });
    expect(copy.copyValue).toHaveBeenCalledOnce();
  });

  it("keeps one rendered tab stop when the unfocused active row scrolls out", () => {
    renderTree(variables(200));
    expandRoot();
    const first = rowByLabel("value0, 0");
    const outside = document.createElement("button");
    document.body.append(outside);
    act(() => first.focus());
    act(() => outside.focus());

    scrollTree(180 * DEBUG_VARIABLE_TREE_ROW_HEIGHT);

    const activeElement = document.activeElement;
    const tabStops = treeRows().filter((row) => row.tabIndex === 0);
    outside.remove();
    expect(activeElement).toBe(outside);
    expect(tabStops).toHaveLength(1);
  });

  it("restores row height and subsequent offsets after closing an errored editor", async () => {
    let rejectCommit!: (error: Error) => void;
    const commitResult = new Promise<DebugVariable | null>((_resolve, reject) => {
      rejectCommit = reject;
    });
    const commit = vi.fn<DebugVariableRowMutation["commit"]>().mockReturnValue(commitResult);
    const writable = {
      name: "value0",
      value: "0",
      variablesReference: 0,
      canSetValue: true,
    } as const;
    const allVariables = [writable, ...variables(199, "other")];
    renderTree(allVariables, {
      variableMutationRows: mutationRows(commit, allVariables),
    });
    expandRoot();
    const value = rowByLabel("value0, 0").querySelector<HTMLElement>(
      "[data-debug-variable-value]",
    )!;
    act(() => value.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true })));
    const input = host.querySelector<HTMLInputElement>('[aria-label="Set value for value0"]')!;
    expect(document.activeElement).toBe(input);
    const initialHeight = Number.parseFloat(group().style.height);

    scrollTree(180 * DEBUG_VARIABLE_TREE_ROW_HEIGHT);
    expect(host.contains(input)).toBe(true);
    expect(document.activeElement).toBe(input);

    setInputValue(input, "next");
    press(input, "Enter");
    await act(async () => rejectCommit(new Error("Adapter rejected value")));
    await vi.waitFor(() => {
      expect(host.querySelector('[role="alert"]')?.textContent).toBe("Adapter rejected value");
      expect(document.activeElement).toBe(input);
    });
    expect(Number.parseFloat(group().style.height)).toBe(
      initialHeight + DEBUG_VARIABLE_TREE_ROW_HEIGHT,
    );

    press(input, "Escape");
    await act(async () => Promise.resolve());
    scrollTree(0);
    const nextRow = rowByLabel("other0, 0");
    act(() => nextRow.focus());
    scrollTree(180 * DEBUG_VARIABLE_TREE_ROW_HEIGHT);

    expect(Number.parseFloat(group().style.height)).toBe(initialHeight);
    expect(nextRow.style.top).toBe(`${2 * DEBUG_VARIABLE_TREE_ROW_HEIGHT}px`);
  });

  it("keeps the context-menu invoker mounted and restores focus on close", () => {
    renderTree(variables(200), { copyValueSurface: copySurface().surface });
    expandRoot();
    const invoker = rowByLabel("value0, 0");
    act(() => invoker.focus());
    act(() =>
      invoker.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    expect(document.querySelector('[aria-label="Variable actions"]')).not.toBeNull();

    scrollTree(180 * DEBUG_VARIABLE_TREE_ROW_HEIGHT);
    expect(host.contains(invoker)).toBe(true);

    press(document.querySelector('[aria-label="Variable actions"]')!, "Escape");
    expect(document.querySelector('[aria-label="Variable actions"]')).toBeNull();
    expect(document.activeElement).toBe(invoker);
  });

  it("reaches the display-limit marker at the 500-row cap with End", () => {
    renderTree(variables(700));
    const scope = expandRoot();
    act(() => scope.focus());

    press(scope, "End");

    const marker = rowByLabel("Display limit reached");
    expect(document.activeElement).toBe(marker);
    expect(treeRows().length).toBeLessThan(100);
    expect(tree().scrollTop).toBeGreaterThan(0);
    expect(group().style.height).toBe(
      `${MAX_DEBUG_VARIABLE_TREE_ROWS * DEBUG_VARIABLE_TREE_ROW_HEIGHT}px`,
    );
  });

  function renderTree(
    treeVariables: readonly DebugVariable[],
    overrides: Partial<DebugVariableTreeProps> = {},
  ) {
    act(() => {
      root.render(
        <DebugVariableTree
          ariaLabel="Variables"
          onLoadPage={vi.fn()}
          roots={[
            {
              id: "local",
              label: "Local",
              owner,
              testId: "debug-scope",
              variablesReference: 10,
            },
          ]}
          variablePages={pages({ 10: treeVariables })}
          virtualizeRows
          {...overrides}
        />,
      );
      geometry.flushAnimationFrames();
    });
  }

  function expandRoot(): HTMLElement {
    const scope = host.querySelector<HTMLElement>('[data-testid="debug-scope"]')!;
    act(() => {
      scope.click();
      geometry.flushAnimationFrames();
    });
    return scope;
  }

  function tree(): HTMLElement {
    return host.querySelector<HTMLElement>('[role="tree"]')!;
  }

  function group(): HTMLElement {
    return host.querySelector<HTMLElement>('[role="tree"] > [role="group"]')!;
  }

  function treeRows(): HTMLElement[] {
    return [...host.querySelectorAll<HTMLElement>('[role="treeitem"]')];
  }

  function rowByLabel(label: string): HTMLElement {
    const row = treeRows().find((candidate) => candidate.getAttribute("aria-label") === label);
    if (!row) throw new Error(`Tree row "${label}" was not found.`);
    return row;
  }

  function scrollTree(scrollTop: number) {
    act(() => {
      tree().scrollTop = scrollTop;
      tree().dispatchEvent(new Event("scroll", { bubbles: true }));
      geometry.flushAnimationFrames();
    });
  }
});

function variables(count: number, prefix = "value"): DebugVariable[] {
  return Array.from({ length: count }, (_value, index) => ({
    name: `${prefix}${index}`,
    value: String(index),
    variablesReference: 0,
  }));
}

function pages(
  references: Readonly<Record<number, readonly DebugVariable[]>>,
): DebugVariablePagesState {
  return {
    owner,
    references: Object.fromEntries(
      Object.entries(references).map(([variablesReference, pageVariables]) => [
        variablesReference,
        {
          pages: { 0: { start: 0, variables: pageVariables, nextStart: null } },
          pending: {},
          errors: {},
          limit: null,
        },
      ]),
    ),
    pendingCount: 0,
    totalVariables: Object.values(references).reduce(
      (total, pageVariables) => total + pageVariables.length,
      0,
    ),
    totalBytes: 0,
  };
}

function mutationRows(
  commit: DebugVariableRowMutation["commit"],
  treeVariables: readonly DebugVariable[],
): DebugVariableMutationRows {
  return {
    forRow: (_owner, _reference, _pageStart, index) => {
      const variable = treeVariables[index];
      if (variable?.canSetValue !== true) return null;
      return Object.freeze({ currentValue: variable.value, commit });
    },
  };
}

function copySurface() {
  let candidate: DebugCopyValueCandidate | null = null;
  const copyValue = vi.fn(async () => candidate !== null);
  const surface: DebugCopyValueSurface = {
    source: "variables",
    workspaceOwnerKey: "/workspace",
    generation: 8,
    epoch: 9,
    isOwnerCurrent: () => true,
    canCopyValue: () => candidate !== null,
    copyValue,
    copyValueFromMenu: copyValue,
    canCopyEvaluatePath: () => candidate !== null,
    copyEvaluatePath: vi.fn(async () => candidate !== null),
    copyEvaluatePathFromMenu: vi.fn(async () => candidate !== null),
    onCandidateChange: (next) => {
      candidate = next;
    },
  };
  return { copyValue, surface };
}

function press(
  element: Element,
  key: string,
  init: Pick<KeyboardEventInit, "ctrlKey" | "metaKey"> = {},
) {
  act(() =>
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key,
        ...init,
      }),
    ),
  );
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function installGeometry() {
  const descriptors = {
    cancelAnimationFrame: Object.getOwnPropertyDescriptor(globalThis, "cancelAnimationFrame"),
    clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight"),
    clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth"),
    offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight"),
    requestAnimationFrame: Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame"),
    scrollHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight"),
  };
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextHandle = 1;
  Object.defineProperties(HTMLElement.prototype, {
    clientHeight: { configurable: true, get: () => 110 },
    clientWidth: { configurable: true, get: () => 400 },
    offsetHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return this.matches('[role="treeitem"]') && this.querySelector('[role="alert"]')
          ? 2 * DEBUG_VARIABLE_TREE_ROW_HEIGHT
          : DEBUG_VARIABLE_TREE_ROW_HEIGHT;
      },
    },
    scrollHeight: {
      configurable: true,
      get(this: HTMLElement) {
        const spacer = this.querySelector<HTMLElement>(':scope > [role="group"]');
        return spacer ? Number.parseFloat(spacer.style.height) : 0;
      },
    },
  });
  Object.defineProperties(globalThis, {
    cancelAnimationFrame: {
      configurable: true,
      value: (handle: number) => callbacks.delete(handle),
    },
    requestAnimationFrame: {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        const handle = nextHandle;
        nextHandle += 1;
        callbacks.set(handle, callback);
        return handle;
      },
    },
  });
  return {
    flushAnimationFrames() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback(0));
    },
    restore() {
      for (const [property, descriptor] of Object.entries(descriptors)) {
        const target =
          property === "requestAnimationFrame" || property === "cancelAnimationFrame"
            ? globalThis
            : HTMLElement.prototype;
        if (descriptor) Object.defineProperty(target, property, descriptor);
        else Reflect.deleteProperty(target, property);
      }
    },
  };
}
