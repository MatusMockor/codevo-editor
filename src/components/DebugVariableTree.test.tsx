// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DebugVariable } from "../domain/debug";
import type { DebugCopyValueCandidate } from "../application/debugCopyValue";
import type { DebugInspectionOwner, DebugVariablePagesState } from "../domain/debugVariablePages";
import {
  DebugVariableTree,
  MAX_DEBUG_VARIABLE_TREE_ROWS,
  type DebugVariableTreeProps,
} from "./DebugVariableTree";
import type { DebugCopyValueSurface } from "./debugCopyValueSurface";
import type {
  DebugVariableMutationRows,
  DebugVariableRowMutation,
} from "../application/debugSessionContracts";
import type {
  DebugSetVariableFocusedRow,
  DebugSetVariableSurface,
} from "./debugSetVariableSurface";
import type { DebugAddToWatchFocusedCandidate } from "../application/useDebugAddToWatchComposition";
import type { DebugAddToWatchVariableSurface } from "./debugAddToWatchSurface";
import { createLatencyTracker } from "../domain/latencyTracker";

const owner: DebugInspectionOwner = {
  rootKey: "/workspace",
  sessionId: 7,
  pauseGeneration: 3,
  frameId: 11,
};

function pages(
  variables: readonly DebugVariable[],
  nextStart: number | null = null,
  errors: Readonly<Record<number, string>> = {},
): DebugVariablePagesState {
  return {
    owner,
    references: {
      10: {
        pages: { 0: { start: 0, variables, nextStart } },
        pending: {},
        errors,
        limit: null,
      },
    },
    pendingCount: 0,
    totalVariables: variables.length,
    totalBytes: 0,
  };
}

describe("DebugVariableTree", () => {
  let host: HTMLDivElement;
  let root: Root;
  let props: DebugVariableTreeProps;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    props = {
      ariaLabel: "Variables",
      roots: [
        { id: "local", label: "Local", owner, variablesReference: 10, testId: "debug-scope" },
      ],
      variablePages: pages([
        { name: "user", value: "Object", variablesReference: 11 },
        { name: "count", value: "3", type: "number", variablesReference: 0 },
      ]),
      onLoadPage: vi.fn(),
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  const render = (overrides: Partial<DebugVariableTreeProps> = {}) => {
    props = { ...props, ...overrides };
    act(() => root.render(<DebugVariableTree {...props} />));
  };
  const press = (element: Element, key: string) =>
    act(() => element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key })));

  const copySurface = (overrides: Partial<DebugCopyValueSurface> = {}): DebugCopyValueSurface => {
    const copyValue = overrides.copyValue ?? vi.fn().mockResolvedValue(true);
    const copyEvaluatePath = overrides.copyEvaluatePath ?? vi.fn().mockResolvedValue(true);
    return {
      source: "variables",
      workspaceOwnerKey: "/workspace",
      generation: 8,
      epoch: 9,
      isOwnerCurrent: () => true,
      canCopyValue: () => true,
      copyValue,
      copyValueFromMenu: overrides.copyValueFromMenu ?? copyValue,
      canCopyEvaluatePath: () => true,
      copyEvaluatePath,
      copyEvaluatePathFromMenu: overrides.copyEvaluatePathFromMenu ?? copyEvaluatePath,
      onCandidateChange: vi.fn(),
      ...overrides,
    };
  };

  const mutationRows = (commit: DebugVariableRowMutation["commit"]): DebugVariableMutationRows => ({
    forRow: (_owner, parentVariablesReference, pageStart, index) => {
      const variable =
        props.variablePages?.references[parentVariablesReference]?.pages[pageStart]?.variables[
          index
        ];
      if (!variable || variable.canSetValue !== true) return null;
      return Object.freeze({ currentValue: variable.value, commit });
    },
  });

  const setInputValue = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("uses roving focus and the complete tree keyboard contract", () => {
    render();
    expect(host.querySelector('[role="tree"] > [role="group"]')).not.toBeNull();
    const scope = host.querySelector<HTMLButtonElement>('[data-testid="debug-scope"]')!;
    expect(scope.tabIndex).toBe(0);
    expect(scope.getAttribute("aria-level")).toBe("1");

    press(scope, "ArrowRight");
    expect(scope.getAttribute("aria-expanded")).toBe("true");
    expect(scope.getAttribute("aria-label")).toBe("Collapse Local");
    const rows = host.querySelectorAll<HTMLButtonElement>('[role="treeitem"]');
    expect(rows).toHaveLength(3);

    press(scope, "ArrowDown");
    expect(document.activeElement).toBe(rows[1]);
    expect(scope.tabIndex).toBe(-1);
    press(rows[1]!, "Enter");
    expect(props.onLoadPage).toHaveBeenCalledWith(owner, 11, 0);
    press(rows[1]!, "ArrowUp");
    expect(document.activeElement).toBe(scope);
    press(scope, "ArrowDown");
    press(rows[1]!, "End");
    expect(document.activeElement).toBe(rows[2]);
    press(rows[2]!, "Home");
    expect(document.activeElement).toBe(scope);
    press(scope, "ArrowLeft");
    expect(scope.getAttribute("aria-expanded")).toBe("false");
    press(scope, " ");
    expect(scope.getAttribute("aria-expanded")).toBe("true");
  });

  it("records latency only when the render model recomputes", () => {
    const tracker = createLatencyTracker();
    let now = 0;
    const latencyClock = () => {
      now += 4;
      return now;
    };

    render({ latencyClock, latencyTracker: tracker });
    const initialCount = tracker.statsFor("debug-variables-render")?.count ?? 0;
    expect(initialCount).toBeGreaterThan(0);
    expect(tracker.statsFor("debug-variables-render")?.last).toBe(4);

    const replacementTracker = createLatencyTracker();
    render({ latencyTracker: replacementTracker });
    expect(tracker.statsFor("debug-variables-render")?.count).toBe(initialCount);
    expect(replacementTracker.statsFor("debug-variables-render")).toBeNull();

    render({
      variablePages: pages([
        { name: "user", value: "Object", variablesReference: 11 },
        { name: "count", value: "4", type: "number", variablesReference: 0 },
      ]),
    });

    expect(tracker.statsFor("debug-variables-render")?.count).toBe(initialCount);
    expect(replacementTracker.statsFor("debug-variables-render")).toMatchObject({
      count: 1,
      last: 4,
    });
  });

  it("renders without latency instrumentation by default", () => {
    const latencyClock = vi.fn(() => 0);

    expect(() => render({ latencyClock })).not.toThrow();
    expect(host.querySelector('[role="tree"]')).not.toBeNull();
    expect(latencyClock).not.toHaveBeenCalled();
  });

  it("loads and retries exact owner-bound pages without duplicate UI requests", () => {
    render({ variablePages: pages([], 100, { 100: "Temporary failure" }) });
    const scope = host.querySelector<HTMLButtonElement>('[data-testid="debug-scope"]')!;
    act(() => scope.click());
    const retry = host.querySelector<HTMLButtonElement>('[aria-label^="Retry:"]')!;
    press(retry, "Enter");
    expect(props.onLoadPage).toHaveBeenCalledWith(owner, 10, 100);

    render({ variablePages: { ...pages([]), references: {} } });
    act(() => scope.click()); // collapse
    act(() => scope.click()); // expand and request the first page
    expect(props.onLoadPage).toHaveBeenLastCalledWith(owner, 10, 0);
  });

  it("fails closed in paged mode when the root has no inspection owner", () => {
    const onLoadVariables = vi.fn();
    render({
      roots: [{ id: "local", label: "Local", owner: null, variablesReference: 10 }],
      onLoadPage: undefined,
      variablesByReference: {
        10: [{ name: "legacy", value: "unsafe", variablesReference: 0 }],
      },
      onLoadVariables,
    });
    const row = host.querySelector<HTMLButtonElement>('[role="treeitem"]')!;
    expect(row.textContent).toContain("No longer available");
    expect(row.getAttribute("aria-expanded")).toBeNull();
    act(() => row.click());
    expect(onLoadVariables).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("unsafe");
    expect(host.textContent).not.toContain("Loading");
  });

  it("moves disappearing action focus to appended content or its replacement state", () => {
    const first = { name: "first", value: "1", variablesReference: 0 } as const;
    const second = { name: "second", value: "2", variablesReference: 0 } as const;
    render({ variablePages: pages([first], 100) });
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="debug-scope"]')?.click());
    const loadMore = host.querySelector<HTMLButtonElement>('[aria-label="Load more"]')!;
    act(() => loadMore.focus());
    render({
      variablePages: {
        ...pages([first], 100),
        references: {
          10: {
            pages: {
              0: { start: 0, variables: [first], nextStart: 100 },
              100: { start: 100, variables: [second], nextStart: null },
            },
            pending: {},
            errors: {},
            limit: null,
          },
        },
        totalVariables: 2,
      },
    });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("second, 2");

    const firstRow = host.querySelector<HTMLButtonElement>('[aria-label="first, 1"]')!;
    act(() => firstRow.focus());
    render({
      variablePages: {
        ...pages([first], 100),
        references: {
          10: {
            pages: { 0: { start: 0, variables: [first], nextStart: 100 } },
            pending: { 100: "request-2" },
            errors: {},
            limit: null,
          },
        },
        pendingCount: 1,
      },
    });
    expect(document.activeElement).toBe(firstRow);

    const loading = host.querySelector<HTMLButtonElement>('[aria-label="Loading…"]')!;
    act(() => loading.focus());
    render({ variablePages: pages([first], 100, { 100: "Temporary failure" }) });
    expect(document.activeElement?.getAttribute("aria-label")).toContain("Retry:");
    render({
      variablePages: {
        ...pages([first], 100),
        references: {
          10: {
            pages: { 0: { start: 0, variables: [first], nextStart: 100 } },
            pending: { 100: "request-3" },
            errors: {},
            limit: null,
          },
        },
        pendingCount: 1,
      },
    });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Loading…");
  });

  it("renders focusable circular and depth/limit information safely", () => {
    render({ variablePages: pages([{ name: "self", value: "Object", variablesReference: 10 }]) });
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="debug-scope"]')?.click());
    const self = host.querySelector<HTMLButtonElement>('[aria-label*="Circular reference"]')!;
    expect(self.textContent).toContain("Circular reference");
    expect(self.getAttribute("aria-expanded")).toBeNull();
    expect(self.getAttribute("aria-level")).toBe("2");
    expect(host.querySelector('[aria-label="Expand self"]')).toBeNull();

    render({
      variablePages: {
        ...pages([]),
        references: {
          10: { pages: {}, pending: {}, errors: {}, limit: "variables" },
        },
      },
    });
    const limited = host.querySelector<HTMLButtonElement>(
      '[aria-label*="Limit reached: variables"]',
    )!;
    expect(limited.getAttribute("aria-expanded")).toBeNull();
    expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(1);

    render({ variablePages: { ...pages([]), owner: { ...owner, pauseGeneration: 4 } } });
    const stale = host.querySelector<HTMLButtonElement>('[aria-label*="No longer available"]')!;
    expect(stale.getAttribute("aria-expanded")).toBeNull();
    expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(1);
  });

  it("reports loading truthfully on both the expanded parent and tree", () => {
    render({
      variablePages: {
        ...pages([]),
        references: {
          10: { pages: {}, pending: { 0: "request-1" }, errors: {}, limit: null },
        },
        pendingCount: 1,
      },
    });
    const scope = host.querySelector<HTMLButtonElement>('[data-testid="debug-scope"]')!;
    act(() => scope.click());
    expect(scope.getAttribute("aria-busy")).toBe("true");
    expect(host.querySelector('[role="tree"]')?.getAttribute("aria-busy")).toBe("true");
  });

  it("hard-caps the mounted tree rows at 500", () => {
    const variables = Array.from({ length: 700 }, (_, index) => ({
      name: `value${index}`,
      value: String(index),
      variablesReference: 0,
    }));
    render({ variablePages: pages(variables) });
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="debug-scope"]')?.click());
    expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(MAX_DEBUG_VARIABLE_TREE_ROWS);
    expect(host.textContent).toContain("Display limit reached");
  });

  it("shows the cap marker only for real overflow", () => {
    const variables = Array.from({ length: MAX_DEBUG_VARIABLE_TREE_ROWS - 1 }, (_, index) => ({
      name: `value${index}`,
      value: String(index),
      variablesReference: 0,
    }));
    render({ variablePages: pages(variables) });
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="debug-scope"]')?.click());
    expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(MAX_DEBUG_VARIABLE_TREE_ROWS);
    expect(host.textContent).not.toContain("Display limit reached");
  });

  it("publishes only real value nodes, preserves exact evaluateName, and clears on blur", () => {
    const onCandidateChange = vi.fn<(candidate: DebugCopyValueCandidate | null) => void>();
    const surface = copySurface({ onCandidateChange });
    render({
      copyValueSurface: surface,
      variablePages: pages([
        {
          name: "count",
          value: "3",
          type: "number",
          evaluateName: "locals.count",
          variablesReference: 0,
        },
      ]),
    });
    const scope = host.querySelector<HTMLButtonElement>('[data-testid="debug-scope"]')!;
    act(() => scope.click());
    act(() => scope.focus());
    expect(onCandidateChange).toHaveBeenLastCalledWith(null);

    const count = host.querySelector<HTMLButtonElement>('[aria-label^="count, 3"]')!;
    act(() => count.focus());
    expect(onCandidateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        source: "variables",
        identity: "root:local/0:count",
        evaluateName: "locals.count",
        adapterEvaluateName: "locals.count",
        displayedValue: "3",
        rootKey: owner.rootKey,
        sessionId: owner.sessionId,
        pauseGeneration: owner.pauseGeneration,
        frameId: owner.frameId,
      }),
    );
    const outside = document.createElement("button");
    document.body.append(outside);
    act(() => outside.focus());
    expect(onCandidateChange).toHaveBeenLastCalledWith(null);
    outside.remove();

    render({ copyValueSurface: surface, variablePages: pages([], 100) });
    const loadMore = host.querySelector<HTMLButtonElement>('[aria-label="Load more"]')!;
    act(() => loadMore.focus());
    expect(onCandidateChange).toHaveBeenLastCalledWith(null);

    render({
      copyValueSurface: surface,
      variablePages: {
        ...pages([]),
        references: {
          10: { pages: {}, pending: { 0: "request-1" }, errors: {}, limit: null },
        },
        pendingCount: 1,
      },
    });
    const loading = host.querySelector<HTMLButtonElement>('[aria-label="Loading…"]')!;
    act(() => loading.focus());
    expect(onCandidateChange).toHaveBeenLastCalledWith(null);
  });

  it("handles local copy only when accepted and leaves selected text untouched", () => {
    const copyValue = vi.fn().mockResolvedValue(true);
    const copyEvaluatePath = vi.fn().mockResolvedValue(true);
    const surface = copySurface({ copyEvaluatePath, copyValue });
    render({ copyValueSurface: surface });
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="debug-scope"]')?.click());
    const count = host.querySelector<HTMLButtonElement>('[aria-label^="count, 3"]')!;
    act(() => count.focus());
    const accepted = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: "c",
    });
    act(() => count.dispatchEvent(accepted));
    expect(accepted.defaultPrevented).toBe(true);
    expect(copyValue).toHaveBeenCalledTimes(1);
    expect(copyEvaluatePath).not.toHaveBeenCalled();

    render({ copyValueSurface: copySurface({ canCopyValue: () => false, copyValue }) });
    const refreshed = host.querySelector<HTMLButtonElement>('[aria-label^="count, 3"]')!;
    const rejected = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      metaKey: true,
      key: "c",
    });
    act(() => refreshed.dispatchEvent(rejected));
    expect(rejected.defaultPrevented).toBe(false);
    expect(copyValue).toHaveBeenCalledTimes(1);

    const selection = vi
      .spyOn(window, "getSelection")
      .mockReturnValue({ isCollapsed: false } as Selection);
    const selected = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: "c",
    });
    act(() => refreshed.dispatchEvent(selected));
    expect(selected.defaultPrevented).toBe(false);
    expect(copyValue).toHaveBeenCalledTimes(1);
    selection.mockRestore();
  });

  it("opens an accessible exact-target Copy Value menu and closes it with Escape", () => {
    const copyValue = vi.fn().mockResolvedValue(true);
    const onCandidateChange = vi.fn();
    render({ copyValueSurface: copySurface({ copyValue, onCandidateChange }) });
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="debug-scope"]')?.click());
    const count = host.querySelector<HTMLButtonElement>('[aria-label^="count, 3"]')!;
    act(() =>
      count.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 12,
          clientY: 14,
        }),
      ),
    );
    const menu = document.querySelector<HTMLElement>(
      '[role="menu"][aria-label="Variable actions"]',
    );
    const item = menu?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    expect(item?.textContent).toBe("Copy Value");
    expect(document.activeElement).toBe(item);
    act(() => item?.click());
    expect(copyValue).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(count);
    expect(onCandidateChange).toHaveBeenCalledWith(
      expect.objectContaining({ identity: "root:local/1:count", displayedValue: "3" }),
    );

    act(() =>
      count.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    act(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })),
    );
    expect(document.querySelector('[aria-label="Variable actions"]')).toBeNull();
    expect(document.activeElement).toBe(count);
  });

  it("keeps the exact menu candidate until menu-copy settlement and clears plain cancellation", async () => {
    let current: DebugCopyValueCandidate | null = null;
    let resolveCopy!: (value: boolean) => void;
    const copy = new Promise<boolean>((resolve) => {
      resolveCopy = resolve;
    });
    const onCandidateChange = vi.fn((candidate: DebugCopyValueCandidate | null) => {
      current = candidate;
    });
    const copyValueFromMenu = vi.fn(async () => {
      const result = await copy;
      onCandidateChange(null);
      return result;
    });
    render({
      copyValueSurface: copySurface({
        canCopyValue: () => current !== null,
        copyValueFromMenu,
        onCandidateChange,
      }),
    });
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="debug-scope"]')?.click());
    const count = host.querySelector<HTMLButtonElement>('[aria-label^="count, 3"]')!;
    act(() =>
      count.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    const item = document.querySelector<HTMLButtonElement>(
      '[aria-label="Variable actions"] [role="menuitem"]',
    )!;
    act(() => item.click());
    expect(copyValueFromMenu).toHaveBeenCalledOnce();
    expect(current).toEqual(expect.objectContaining({ displayedValue: "3" }));
    await act(async () => resolveCopy(true));
    expect(current).toBeNull();

    act(() =>
      count.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    expect(current).not.toBeNull();
    act(() => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(current).toBeNull();
    expect(document.activeElement).toBe(count);
  });

  it("orders Copy as Expression after Copy Value only for an exact backend path", () => {
    const copyValueFromMenu = vi.fn().mockResolvedValue(true);
    const copyEvaluatePathFromMenu = vi.fn().mockResolvedValue(true);
    const onCandidateChange = vi.fn();
    render({
      copyValueSurface: copySurface({
        copyEvaluatePathFromMenu,
        copyValueFromMenu,
        onCandidateChange,
      }),
      variablePages: pages([
        {
          name: "count",
          value: "3",
          evaluateName: "locals.count",
          variablesReference: 0,
        },
        { name: "displayOnly", value: "4", variablesReference: 0 },
      ]),
    });
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="debug-scope"]')?.click());
    const count = host.querySelector<HTMLButtonElement>('[aria-label="count, 3"]')!;
    act(() =>
      count.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    const items = document.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Variable actions"] [role="menuitem"]',
    );
    expect([...items].map((item) => item.textContent)).toEqual([
      "Copy Value",
      "Copy as Expression",
    ]);
    act(() =>
      items[0]?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" })),
    );
    expect(document.activeElement).toBe(items[1]);
    act(() => items[1]?.click());
    expect(copyEvaluatePathFromMenu).toHaveBeenCalledOnce();
    expect(copyValueFromMenu).not.toHaveBeenCalled();
    expect(onCandidateChange).toHaveBeenCalledWith(
      expect.objectContaining({
        adapterEvaluateName: "locals.count",
        identity: "root:local/0:count",
      }),
    );
    expect(document.activeElement).toBe(count);

    const displayOnly = host.querySelector<HTMLButtonElement>('[aria-label="displayOnly, 4"]')!;
    act(() =>
      displayOnly.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    expect(
      [...document.querySelectorAll('[aria-label="Variable actions"] [role="menuitem"]')].map(
        (item) => item.textContent,
      ),
    ).toEqual(["Copy Value"]);
  });

  it("omits a proven-path item when live capability rejects it", () => {
    let expressionAvailable = true;
    render({
      copyValueSurface: copySurface({ canCopyEvaluatePath: () => expressionAvailable }),
      roots: [
        {
          id: "result",
          label: "Result",
          owner,
          value: "3",
          evaluateName: "count",
          adapterEvaluateName: "count",
          variablesReference: 0,
        },
      ],
    });
    const result = host.querySelector<HTMLButtonElement>('[aria-label="Result, 3"]')!;
    act(() =>
      result.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    expect(
      [...document.querySelectorAll('[aria-label="Variable actions"] [role="menuitem"]')].map(
        (item) => item.textContent,
      ),
    ).toEqual(["Copy Value", "Copy as Expression"]);
    act(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })),
    );

    expressionAvailable = false;
    render();
    act(() =>
      result.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    expect(document.querySelector('[aria-label="Variable actions"]')?.textContent).toBe(
      "Copy Value",
    );
  });

  it("keeps an expression menu candidate through settlement and closes on provenance drift", async () => {
    let current: DebugCopyValueCandidate | null = null;
    let resolveCopy!: (value: boolean) => void;
    const copy = new Promise<boolean>((resolve) => {
      resolveCopy = resolve;
    });
    const onCandidateChange = vi.fn((candidate: DebugCopyValueCandidate | null) => {
      current = candidate;
    });
    const copyEvaluatePathFromMenu = vi.fn(async () => {
      const result = await copy;
      onCandidateChange(null);
      return result;
    });
    const surface = copySurface({
      canCopyEvaluatePath: () => current?.adapterEvaluateName !== undefined,
      copyEvaluatePathFromMenu,
      onCandidateChange,
    });
    render({
      copyValueSurface: surface,
      variablePages: pages([
        { name: "count", value: "3", evaluateName: "locals.count", variablesReference: 0 },
      ]),
    });
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="debug-scope"]')?.click());
    const count = host.querySelector<HTMLButtonElement>('[aria-label="count, 3"]')!;
    act(() =>
      count.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    const expression = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (item) => item.textContent === "Copy as Expression",
    )!;
    act(() => expression.click());
    expect(current).toEqual(expect.objectContaining({ adapterEvaluateName: "locals.count" }));
    await act(async () => resolveCopy(true));
    expect(current).toBeNull();

    render({
      variablePages: pages([
        { name: "count", value: "3", evaluateName: "locals.count", variablesReference: 0 },
      ]),
    });
    act(() =>
      count.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    render({
      variablePages: pages([
        { name: "count", value: "3", evaluateName: "locals.total", variablesReference: 0 },
      ]),
    });
    expect(document.querySelector('[aria-label="Variable actions"]')).toBeNull();
    expect(current).toBeNull();
    expect(document.activeElement).toBe(count);
  });

  it("offers Set Value after copy actions and keeps the editor out of a button", () => {
    const commit = vi.fn<DebugVariableRowMutation["commit"]>().mockResolvedValue(null);
    const variables = [
      {
        name: "count",
        value: "3",
        evaluateName: "locals.count",
        variablesReference: 0,
        canSetValue: true,
      },
    ] as const;
    render({
      copyValueSurface: copySurface(),
      variablePages: pages(variables),
      variableMutationRows: mutationRows(commit),
    });
    act(() => host.querySelector<HTMLElement>('[data-testid="debug-scope"]')?.click());
    const count = host.querySelector<HTMLElement>('[aria-label="count, 3"]')!;
    act(() =>
      count.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    expect(items.map((item) => item.textContent)).toEqual([
      "Copy Value",
      "Copy as Expression",
      "Set Value",
    ]);
    act(() => items[2]?.click());
    const input = host.querySelector<HTMLInputElement>('[aria-label="Set value for count"]')!;
    expect(input).not.toBeNull();
    expect(input.closest("button")).toBeNull();
    expect(count.tagName).toBe("DIV");
    press(input, "Enter");
    expect(commit).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="Set value for count"]')).toBeNull();
  });

  it("offers Add to Watch last for an exact Variables value row and restores focus on Escape", () => {
    let current: DebugAddToWatchFocusedCandidate | null = null;
    const canAddToWatch = vi.fn(() => current?.isCurrent() === true);
    const addToWatch = vi.fn(() => true);
    const addToWatchSurface: DebugAddToWatchVariableSurface = {
      setFocusedCandidate(candidate) {
        current = candidate;
        return () => {
          if (current === candidate) current = null;
        };
      },
      canAddToWatch,
      addToWatch,
    };
    const commit = vi.fn<DebugVariableRowMutation["commit"]>().mockResolvedValue(null);
    render({
      addToWatchSurface,
      copyValueSurface: copySurface(),
      variablePages: pages([
        {
          name: "count",
          value: "3",
          evaluateName: "locals.count",
          variablesReference: 0,
          canSetValue: true,
        },
      ]),
      variableMutationRows: mutationRows(commit),
    });
    act(() => host.querySelector<HTMLElement>('[data-testid="debug-scope"]')?.click());
    const count = host.querySelector<HTMLElement>('[aria-label="count, 3"]')!;
    act(() => count.focus());
    act(() =>
      count.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    expect(items.map((item) => item.textContent)).toEqual([
      "Copy Value",
      "Copy as Expression",
      "Set Value",
      "Add to Watch",
    ]);
    expect(document.activeElement).toBe(items[0]);
    expect(canAddToWatch).toHaveBeenCalledOnce();

    press(document.querySelector('[aria-label="Variable actions"]')!, "Escape");
    expect(document.querySelector('[aria-label="Variable actions"]')).toBeNull();
    expect(document.activeElement).toBe(count);
    expect(addToWatch).not.toHaveBeenCalled();

    act(() =>
      count.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    const add = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (item) => item.textContent === "Add to Watch",
    )!;
    act(() => add.click());
    expect(canAddToWatch).toHaveBeenCalledTimes(2);
    expect(addToWatch).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(count);
  });

  it("does not publish scopes, display-only rows, or rows without a backend expression", () => {
    const setFocusedCandidate = vi.fn(() => () => undefined);
    const addToWatchSurface: DebugAddToWatchVariableSurface = {
      setFocusedCandidate,
      canAddToWatch: () => false,
      addToWatch: () => false,
    };
    render({ addToWatchSurface });
    const scope = host.querySelector<HTMLElement>('[data-testid="debug-scope"]')!;
    act(() =>
      scope.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    expect(document.querySelector('[aria-label="Variable actions"]')).toBeNull();
    expect(setFocusedCandidate).not.toHaveBeenCalledWith(expect.objectContaining({ owner }));

    act(() => scope.click());
    const count = host.querySelector<HTMLElement>('[aria-label="count, 3, number"]')!;
    act(() => count.focus());
    expect(setFocusedCandidate).not.toHaveBeenCalledWith(expect.objectContaining({ owner }));
  });

  it("stops an accepted local Set Value shortcut before the window command bridge", () => {
    const commit = vi.fn<DebugVariableRowMutation["commit"]>().mockResolvedValue(null);
    const platform = vi.spyOn(window.navigator, "platform", "get").mockReturnValue("Win32");
    const windowKeydown = vi.fn();
    window.addEventListener("keydown", windowKeydown);
    render({
      variablePages: pages([
        { name: "count", value: "3", variablesReference: 0, canSetValue: true },
      ]),
      variableMutationRows: mutationRows(commit),
    });
    act(() => host.querySelector<HTMLElement>('[data-testid="debug-scope"]')?.click());
    const count = host.querySelector<HTMLElement>('[aria-label="count, 3"]')!;
    act(() => count.focus());

    press(count, "F2");
    expect(host.querySelector('[aria-label="Set value for count"]')).not.toBeNull();
    expect(windowKeydown).not.toHaveBeenCalled();

    window.removeEventListener("keydown", windowKeydown);
    platform.mockRestore();
  });

  it("serializes commits, retains a failed draft for retry, and silently closes stale results", async () => {
    let rejectFirst!: (error: Error) => void;
    let resolveSecond!: (value: DebugVariable | null) => void;
    const first = new Promise<DebugVariable | null>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const second = new Promise<DebugVariable | null>((resolve) => {
      resolveSecond = resolve;
    });
    const commit = vi
      .fn<DebugVariableRowMutation["commit"]>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const variables = [
      { name: "count", value: "3", variablesReference: 0, canSetValue: true },
    ] as const;
    render({ variablePages: pages(variables), variableMutationRows: mutationRows(commit) });
    act(() => host.querySelector<HTMLElement>('[data-testid="debug-scope"]')?.click());
    const value = host.querySelector<HTMLElement>("[data-debug-variable-value]")!;
    act(() => value.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true })));
    let input = host.querySelector<HTMLInputElement>('[aria-label="Set value for count"]')!;
    setInputValue(input, "4");
    press(input, "Enter");
    input = host.querySelector<HTMLInputElement>('[aria-label="Set value for count"]')!;
    expect(input.disabled).toBe(false);
    expect(input.readOnly).toBe(true);
    expect(input.getAttribute("aria-disabled")).toBe("true");
    const outside = document.createElement("button");
    document.body.append(outside);
    act(() => outside.focus());
    expect(host.querySelector('[aria-label="Set value for count"]')).not.toBeNull();
    press(input, "Enter");
    expect(commit).toHaveBeenCalledTimes(1);

    await act(async () => rejectFirst(new Error("Adapter rejected value")));
    input = host.querySelector<HTMLInputElement>('[aria-label="Set value for count"]')!;
    expect(input.value).toBe("4");
    expect(input.disabled).toBe(false);
    expect(document.activeElement).toBe(input);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Adapter rejected value");

    press(input, "Enter");
    expect(commit).toHaveBeenCalledTimes(2);
    await act(async () => resolveSecond(null));
    expect(host.querySelector('[aria-label="Set value for count"]')).toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    outside.remove();
  });

  it("closes a writable context menu instead of retargeting after duplicate-row reorder", () => {
    const firstCommit = vi.fn<DebugVariableRowMutation["commit"]>().mockResolvedValue(null);
    const secondCommit = vi.fn<DebugVariableRowMutation["commit"]>().mockResolvedValue(null);
    const first = {
      name: "duplicate",
      value: "same",
      variablesReference: 0,
      canSetValue: true,
    } as const;
    const second = { ...first };
    const rowsFor = () => ({
      forRow: vi.fn((_owner, _reference, _pageStart, index) => ({
        currentValue: "same",
        commit: index === 0 ? firstCommit : secondCommit,
      })),
    });
    render({
      copyValueSurface: copySurface(),
      variablePages: pages([first, second]),
      variableMutationRows: rowsFor(),
    });
    act(() => host.querySelector<HTMLElement>('[data-testid="debug-scope"]')?.click());
    const duplicates = host.querySelectorAll<HTMLElement>('[aria-label="duplicate, same"]');
    act(() =>
      duplicates[0]?.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      ),
    );
    expect(document.querySelector('[aria-label="Variable actions"]')).not.toBeNull();

    render({
      copyValueSurface: copySurface(),
      variablePages: pages([second, first]),
      variableMutationRows: rowsFor(),
    });
    expect(document.querySelector('[aria-label="Variable actions"]')).toBeNull();
    expect(firstCommit).not.toHaveBeenCalled();
    expect(secondCommit).not.toHaveBeenCalled();
  });

  it("closes Set Value when the exact capability changes at the same row identity and value", () => {
    const variable = {
      name: "count",
      value: "3",
      variablesReference: 0,
      canSetValue: true,
    } as const;
    const variablePages = pages([variable]);
    const provider = (commit: DebugVariableRowMutation["commit"]): DebugVariableMutationRows => ({
      forRow: () => Object.freeze({ currentValue: "3", commit }),
    });
    const firstCommit = vi.fn<DebugVariableRowMutation["commit"]>().mockResolvedValue(null);
    render({
      copyValueSurface: copySurface(),
      variablePages,
      variableMutationRows: provider(firstCommit),
    });
    act(() => host.querySelector<HTMLElement>('[data-testid="debug-scope"]')?.click());
    const count = host.querySelector<HTMLElement>('[aria-label="count, 3"]')!;
    act(() =>
      count.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    expect(document.querySelector('[aria-label="Variable actions"]')).not.toBeNull();

    render({
      variablePages,
      variableMutationRows: provider(
        vi.fn<DebugVariableRowMutation["commit"]>().mockResolvedValue(null),
      ),
    });
    expect(document.querySelector('[aria-label="Variable actions"]')).toBeNull();
    expect(firstCommit).not.toHaveBeenCalled();
  });

  it("publishes only a live focused writable row and cancels edits on drift", async () => {
    let current: DebugSetVariableFocusedRow | null = null;
    const setFocusedCapability = vi.fn((candidate: DebugSetVariableFocusedRow | null) => {
      current = candidate;
      return () => {
        if (current === candidate) current = null;
      };
    });
    const surface: DebugSetVariableSurface = { setFocusedCapability };
    const commit = vi.fn<DebugVariableRowMutation["commit"]>().mockResolvedValue(null);
    const writable = {
      name: "user",
      value: "Object",
      variablesReference: 11,
      canSetValue: true,
    } as const;
    render({
      setVariableSurface: surface,
      variablePages: pages([writable]),
      variableMutationRows: mutationRows(commit),
    });
    const scope = host.querySelector<HTMLElement>('[data-testid="debug-scope"]')!;
    act(() => scope.click());
    const user = host.querySelector<HTMLElement>('[aria-label="Expand user"]')!;
    act(() => user.focus());
    const focusedCapability = current as DebugSetVariableFocusedRow | null;
    expect(focusedCapability).not.toBeNull();
    if (!focusedCapability) throw new Error("Writable row did not publish its capability.");
    expect(typeof focusedCapability.identity).toBe("object");
    expect(Object.isFrozen(focusedCapability.identity)).toBe(true);
    expect(focusedCapability.isCurrent()).toBe(true);
    let beganEditing = false;
    act(() => {
      beganEditing = focusedCapability.beginEdit();
    });
    expect(beganEditing).toBe(true);
    expect(host.querySelector('[aria-label="Set value for user"]')).not.toBeNull();
    expect(user.getAttribute("aria-expanded")).toBe("false");

    render({
      variablePages: pages([{ name: "inserted", value: "0", variablesReference: 0 }, writable]),
    });
    expect(host.querySelector('[aria-label="Set value for user"]')).toBeNull();
    expect(focusedCapability.isCurrent()).toBe(false);

    const refreshed = host.querySelector<HTMLElement>('[aria-label="Expand user"]')!;
    const value = refreshed.querySelector<HTMLElement>("[data-debug-variable-value]")!;
    act(() => value.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true })));
    const input = host.querySelector<HTMLInputElement>('[aria-label="Set value for user"]')!;
    setInputValue(input, "next");
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
      await Promise.resolve();
    });
    expect(commit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(refreshed);

    act(() => value.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true })));
    const outside = document.createElement("button");
    document.body.append(outside);
    act(() => outside.focus());
    expect(host.querySelector('[aria-label="Set value for user"]')).toBeNull();
    expect(current).toBeNull();
    outside.remove();
  });
});
