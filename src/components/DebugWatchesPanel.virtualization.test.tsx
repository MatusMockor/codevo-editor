// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DebugWatchEvaluation } from "../application/useDebugWatchExpressions";
import type { DebugVariable } from "../domain/debug";
import type { DebugWatchDefinition } from "../domain/debugWatchExpressions";
import type { DebugInspectionOwner, DebugVariablePagesState } from "../domain/debugVariablePages";
import { DEBUG_VARIABLE_TREE_ROW_HEIGHT, MAX_DEBUG_VARIABLE_TREE_ROWS } from "./DebugVariableTree";
import { DebugWatchesPanel, type DebugWatchesPanelProps } from "./DebugWatchesPanel";

const owner: DebugInspectionOwner = {
  rootKey: "/workspace",
  sessionId: 7,
  pauseGeneration: 3,
  frameId: 11,
};
const watch: DebugWatchDefinition = {
  id: "watch-1",
  expression: "value",
  enabled: true,
  revision: 1,
};

describe("DebugWatchesPanel virtualization", () => {
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

  it("mounts only the visible window of a large watch value tree", () => {
    renderPanel(pages({ 99: variables(700) }));
    expandWatch();

    const mountedRows = treeRows();
    expect(mountedRows.length).toBeGreaterThan(0);
    expect(mountedRows.length).toBeLessThan(100);
    expect(group().style.height).toBe(
      `${(MAX_DEBUG_VARIABLE_TREE_ROWS - 1) * DEBUG_VARIABLE_TREE_ROW_HEIGHT}px`,
    );
    expect(valueTree().parentElement?.style.maxHeight).toBe("360px");
    expect(valueTree().textContent).not.toContain("value250");
  });

  it("reaches and focuses rows beyond the window with End, Home, and arrow keys", () => {
    renderPanel(pages({ 99: variables(100) }));
    const watchRoot = expandWatch();
    act(() => watchRoot.focus());

    press(watchRoot, "End");
    const last = rowByLabel("value99, 99");
    expect(document.activeElement).toBe(last);
    expect(valueTree().scrollTop).toBeGreaterThan(0);

    press(last, "ArrowUp");
    expect(document.activeElement).toBe(rowByLabel("value98, 98"));

    press(document.activeElement as HTMLElement, "Home");
    const remountedRoot = rowByLabel("Collapse value");
    expect(document.activeElement).toBe(remountedRoot);

    press(remountedRoot, "ArrowDown");
    expect(document.activeElement).toBe(rowByLabel("value0, 0"));
  });

  it("expands a node inside a watch tree and windows the appended children", () => {
    const parent: DebugVariable = {
      name: "parent",
      value: "Object",
      variablesReference: 100,
    };
    renderPanel(
      pages({
        99: [parent, ...variables(60)],
        100: variables(80, "child"),
      }),
    );
    expandWatch();

    act(() => rowByLabel("Expand parent").click());

    expect(treeRows().length).toBeLessThan(142);
    expect(valueTree().textContent).toContain("child0");
    expect(valueTree().textContent).not.toContain("child60");

    scrollTree(55 * DEBUG_VARIABLE_TREE_ROW_HEIGHT);
    expect(valueTree().textContent).toContain("child55");
    expect(valueTree().textContent).not.toContain("child0");
  });

  it("keeps the focused watch value row mounted while scrolled out of the window", () => {
    renderPanel(pages({ 99: variables(200) }));
    expandWatch();
    const first = rowByLabel("value0, 0");
    act(() => first.focus());

    scrollTree(180 * DEBUG_VARIABLE_TREE_ROW_HEIGHT);

    expect(rowByLabel("value0, 0")).toBe(first);
    expect(document.activeElement).toBe(first);
    press(first, "ArrowDown");
    expect(document.activeElement).toBe(rowByLabel("value1, 1"));

    const outside = document.createElement("button");
    document.body.append(outside);
    act(() => outside.focus());
    scrollTree(180 * DEBUG_VARIABLE_TREE_ROW_HEIGHT);
    const tabStops = treeRows().filter((row) => row.tabIndex === 0);
    outside.remove();
    expect(tabStops).toHaveLength(1);
  });

  function renderPanel(variablePages: DebugVariablePagesState) {
    const evaluation: DebugWatchEvaluation = {
      owner,
      definitionRevision: 1,
      frameId: 11,
      result: {
        status: "ok",
        value: "Object",
        type: "object",
        variablesReference: 99,
      },
    };
    const props: DebugWatchesPanelProps = {
      debugAdapterKind: "node",
      definitions: [watch],
      evaluations: { [watch.id]: evaluation },
      pendingIds: [],
      sessionState: "stopped",
      workspaceRoot: "/workspace",
      workspaceTrusted: true,
      variablePages,
      onAdd: vi.fn(),
      onClear: vi.fn(),
      onRemove: vi.fn(),
      onSetEnabled: vi.fn(),
      onUpdate: vi.fn(),
    };
    act(() => {
      root.render(<DebugWatchesPanel {...props} />);
      geometry.flushAnimationFrames();
    });
  }

  function expandWatch(): HTMLElement {
    const watchRoot = rowByLabel("Expand value");
    act(() => {
      watchRoot.click();
      geometry.flushAnimationFrames();
    });
    return watchRoot;
  }

  function valueTree(): HTMLElement {
    return host.querySelector<HTMLElement>('[role="tree"][aria-label="value value"]')!;
  }

  function group(): HTMLElement {
    return valueTree().querySelector<HTMLElement>(':scope > [role="group"]')!;
  }

  function treeRows(): HTMLElement[] {
    return [...valueTree().querySelectorAll<HTMLElement>('[role="treeitem"]')];
  }

  function rowByLabel(label: string): HTMLElement {
    const row = treeRows().find((candidate) => candidate.getAttribute("aria-label") === label);
    if (!row) throw new Error(`Tree row "${label}" was not found.`);
    return row;
  }

  function scrollTree(scrollTop: number) {
    act(() => {
      valueTree().scrollTop = scrollTop;
      valueTree().dispatchEvent(new Event("scroll", { bubbles: true }));
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

function press(element: Element, key: string) {
  act(() =>
    element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key })),
  );
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
      get: () => DEBUG_VARIABLE_TREE_ROW_HEIGHT,
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
