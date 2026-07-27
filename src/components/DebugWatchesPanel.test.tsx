// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DebugWatchDefinition } from "../domain/debugWatchExpressions";
import type { DebugCopyValueCandidate } from "../application/debugCopyValue";
import type {
  DebugVariableMutationRows,
  DebugVariableRowMutation,
  DebugWatchExpressionMutation,
  DebugWatchExpressionMutations,
} from "../application/debugSessionContracts";
import type { DebugVariable } from "../domain/debug";
import type { DebugInspectionOwner } from "../domain/debugVariablePages";
import { DEBUG_VARIABLE_TREE_ROW_HEIGHT } from "./DebugVariableTree";
import { DebugWatchesPanel, type DebugWatchesPanelProps } from "./DebugWatchesPanel";
import type { DebugCopyValueSurface } from "./debugCopyValueSurface";
import type {
  DebugSetVariableFocusedRow,
  DebugSetVariableSurface,
} from "./debugSetVariableSurface";

const watches: DebugWatchDefinition[] = [
  { id: "watch-1", expression: "count", enabled: true, revision: 1 },
  { id: "watch-2", expression: "user.name", enabled: false, revision: 2 },
];
const evaluationOwner = {
  rootKey: "/workspace",
  sessionId: 4,
  pauseGeneration: 2,
  frameId: 11,
} as const;

function defaults(): DebugWatchesPanelProps {
  return {
    debugAdapterKind: "node",
    definitions: watches,
    evaluations: {},
    pendingIds: [],
    sessionState: "stopped",
    workspaceRoot: "/workspace",
    workspaceTrusted: true,
    onAdd: vi.fn(),
    onClear: vi.fn(),
    onRemove: vi.fn(),
    onSetEnabled: vi.fn(),
    onUpdate: vi.fn(),
  };
}

describe("DebugWatchesPanel", () => {
  let host: HTMLDivElement;
  let root: Root;
  let props: DebugWatchesPanelProps;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    props = defaults();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const render = (overrides: Partial<DebugWatchesPanelProps> = {}) => {
    props = { ...props, ...overrides };
    act(() => root.render(<DebugWatchesPanel {...props} />));
  };
  const button = (label: string) =>
    host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) as HTMLButtonElement;
  const treeItem = (label: string) =>
    host.querySelector<HTMLElement>(`[role="treeitem"][aria-label="${label}"]`) as HTMLElement;
  const press = (element: Element, key: string) =>
    act(() => element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key })));
  const change = (input: HTMLInputElement, value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const copySurface = (overrides: Partial<DebugCopyValueSurface> = {}): DebugCopyValueSurface => {
    const copyValue = overrides.copyValue ?? vi.fn().mockResolvedValue(true);
    const copyEvaluatePath = overrides.copyEvaluatePath ?? vi.fn().mockResolvedValue(true);
    return {
      source: "watch",
      workspaceOwnerKey: "/workspace",
      generation: 5,
      epoch: 6,
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
  const successfulEvaluation = {
    owner: evaluationOwner,
    definitionRevision: 1,
    frameId: 11,
    result: { status: "ok" as const, value: "3", type: "number" },
  };
  const expandableEvaluation = {
    ...successfulEvaluation,
    result: { status: "ok" as const, value: "Object", variablesReference: 99 },
  };
  const nestedPages = (
    variables: readonly {
      readonly name: string;
      readonly value: string;
      readonly evaluateName?: string;
      readonly variablesReference: number;
      readonly canSetValue?: true;
    }[],
    owner: DebugInspectionOwner = evaluationOwner,
  ) => ({
    owner,
    references: {
      99: {
        pages: { 0: { start: 0, variables, nextStart: null } },
        pending: {},
        errors: {},
        limit: null,
      },
    },
    pendingCount: 0,
    totalVariables: variables.length,
    totalBytes: 0,
  });
  const mutationRowsFor = (
    variables: readonly DebugVariable[],
    commit: DebugVariableRowMutation["commit"],
  ): DebugVariableMutationRows => ({
    forRow: vi.fn((owner, parentVariablesReference, pageStart, index) => {
      const variable = variables[index];
      if (
        !variable?.canSetValue ||
        owner !== evaluationOwner ||
        parentVariablesReference !== 99 ||
        pageStart !== 0
      )
        return null;
      return Object.freeze({ currentValue: variable.value, commit });
    }),
  });
  const watchMutation = (
    setValue = vi.fn<DebugWatchExpressionMutation["setValue"]>().mockResolvedValue({
      status: "ok",
      value: "4",
    }),
  ) => {
    const identity = Object.freeze({
      definitionId: "watch-1",
      definitionRevision: 1,
      expression: "count",
    });
    const mutation = Object.freeze({ identity, currentValue: "3", setValue });
    let current: DebugWatchExpressionMutation | null = mutation;
    const provider: DebugWatchExpressionMutations = {
      forWatch: vi.fn(() => current),
    };
    return {
      mutation,
      provider,
      setCurrent(next: DebugWatchExpressionMutation | null) {
        current = next;
      },
      setValue,
    };
  };

  it("renders an accessible watch tree and contextual runtime guidance", () => {
    render();
    expect(host.querySelector('[role="tree"][aria-label="Watch expressions"]')).not.toBeNull();
    expect(
      host.querySelector('[role="tree"][aria-label="Watch expressions"] > [role="group"]'),
    ).not.toBeNull();
    expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(2);

    render({ sessionState: "running" });
    expect(host.querySelector('[data-testid="debug-watch-context"]')?.textContent).toContain(
      "refresh automatically",
    );
    render({ debugAdapterKind: "php", sessionState: "stopped" });
    expect(host.querySelector('[data-testid="debug-watch-context"]')?.textContent).toContain(
      "not supported for PHP",
    );
    render({ debugAdapterKind: "node", workspaceTrusted: false });
    expect(host.querySelector('[data-testid="debug-watch-context"]')?.textContent).toContain(
      "Trust this workspace",
    );
    render({ workspaceRoot: null });
    expect(button("Add watch").disabled).toBe(true);
  });

  it("exposes one accessible refresh action and preserves toolbar focus", () => {
    const onRefresh = vi.fn();
    render({ canRefresh: true, onRefresh });
    const refresh = button("Refresh watches");
    expect(refresh.disabled).toBe(false);
    expect(refresh.title).toBe("Refresh watch expressions");
    expect(refresh.getAttribute("aria-busy")).toBeNull();

    refresh.focus();
    act(() => refresh.click());
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(refresh);

    render({ canRefresh: true, onRefresh, refreshPending: true });
    const pendingRefresh = button("Refresh watches");
    expect(pendingRefresh.disabled).toBe(true);
    expect(pendingRefresh.getAttribute("aria-busy")).toBe("true");
    act(() => pendingRefresh.click());
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("keeps refresh disabled without a live application command", () => {
    render({ canRefresh: true, onRefresh: undefined });
    expect(button("Refresh watches").disabled).toBe(true);
  });

  it("shows loading, values, errors, disabled, and running states", () => {
    render({ pendingIds: ["watch-1"] });
    expect(host.textContent).toContain("Loading…");
    expect(host.textContent).toContain("Disabled");

    render({
      evaluations: {
        "watch-1": {
          owner: evaluationOwner,
          definitionRevision: 1,
          frameId: 11,
          result: { status: "ok", value: "3", type: "number" },
        },
      },
      pendingIds: [],
    });
    expect(host.textContent).toContain("3 (number)");

    render({
      evaluations: {
        "watch-1": {
          owner: evaluationOwner,
          definitionRevision: 1,
          frameId: 11,
          result: { status: "error", kind: "side-effect", message: "Side effects are blocked." },
        },
      },
    });
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Side effects");

    render({ evaluations: {}, sessionState: "running" });
    expect(host.textContent).toContain("Running");
  });

  it("expands owner-bound watch values and loads the exact next page", () => {
    const onLoadVariablePage = vi.fn();
    render({
      definitions: [watches[0] as DebugWatchDefinition],
      evaluations: {
        "watch-1": {
          owner: evaluationOwner,
          definitionRevision: 1,
          frameId: 11,
          result: { status: "ok", value: "Object", type: "object", variablesReference: 99 },
        },
      },
      onLoadVariablePage,
      variablePages: {
        owner: evaluationOwner,
        references: {
          99: {
            pages: {
              0: {
                start: 0,
                variables: [{ name: "name", value: "Ada", variablesReference: 0 }],
                nextStart: 100,
              },
            },
            pending: {},
            errors: {},
            limit: null,
          },
        },
        pendingCount: 0,
        totalVariables: 1,
        totalBytes: 0,
      },
    });

    const valueRoot = treeItem("Expand count");
    act(() => valueRoot.click());
    expect(host.querySelector('[aria-label="name, Ada"]')).not.toBeNull();
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Load more"]')?.click());
    expect(onLoadVariablePage).toHaveBeenCalledWith(evaluationOwner, 99, 100, "named");

    act(() => valueRoot.focus());
    render({
      variablePages: {
        owner: { ...evaluationOwner, pauseGeneration: 3 },
        references: {},
        pendingCount: 0,
        totalVariables: 0,
        totalBytes: 0,
      },
    });
    expect(host.textContent).toContain("No longer available");
    expect(document.activeElement?.getAttribute("role")).toBe("treeitem");
  });

  it("shares one truthful 500-treeitem budget across all Watch value trees", () => {
    const definitions: DebugWatchDefinition[] = [
      { id: "watch-a", expression: "a", enabled: true, revision: 1 },
      { id: "watch-b", expression: "b", enabled: true, revision: 1 },
    ];
    const manyVariables = (prefix: string) =>
      Array.from({ length: 600 }, (_, index) => ({
        name: `${prefix}${index}`,
        value: String(index),
        variablesReference: 0,
      }));
    render({
      definitions,
      evaluations: {
        "watch-a": {
          owner: evaluationOwner,
          definitionRevision: 1,
          frameId: 11,
          result: { status: "ok", value: "Object", variablesReference: 99 },
        },
        "watch-b": {
          owner: evaluationOwner,
          definitionRevision: 1,
          frameId: 11,
          result: { status: "ok", value: "Object", variablesReference: 100 },
        },
      },
      onLoadVariablePage: vi.fn(),
      variablePages: {
        owner: evaluationOwner,
        references: {
          99: {
            pages: { 0: { start: 0, variables: manyVariables("a"), nextStart: null } },
            pending: {},
            errors: {},
            limit: null,
          },
          100: {
            pages: { 0: { start: 0, variables: manyVariables("b"), nextStart: null } },
            pending: {},
            errors: {},
            limit: null,
          },
        },
        pendingCount: 0,
        totalVariables: 1_200,
        totalBytes: 0,
      },
    });
    act(() => treeItem("Expand a").click());
    act(() => treeItem("Expand b").click());
    const valueTrees = [
      ...host.querySelectorAll<HTMLElement>('[role="tree"][aria-label$=" value"]'),
    ];
    const modeledRows = valueTrees.reduce((total, tree) => {
      const group = tree.querySelector<HTMLElement>(':scope > [role="group"]');
      return total + Number.parseFloat(group?.style.height ?? "0") / DEBUG_VARIABLE_TREE_ROW_HEIGHT;
    }, definitions.length);
    expect(modeledRows).toBe(500);
    for (const tree of valueTrees) {
      const rootRow = tree.querySelector<HTMLElement>('[role="treeitem"]');
      act(() =>
        rootRow?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" })),
      );
      expect(tree.querySelector('[aria-label="Display limit reached"]')).not.toBeNull();
    }

    act(() => button("Edit watch a").click());
    expect(host.querySelector('[role="tree"][aria-label="a value"]')).toBeNull();
    const remainingTree = host.querySelector<HTMLElement>('[role="tree"][aria-label="b value"]');
    const remainingGroup = remainingTree?.querySelector<HTMLElement>(':scope > [role="group"]');
    expect(
      definitions.length +
        Number.parseFloat(remainingGroup?.style.height ?? "0") / DEBUG_VARIABLE_TREE_ROW_HEIGHT,
    ).toBe(500);
    const remainingRoot = remainingTree?.querySelector<HTMLElement>('[role="treeitem"]');
    act(() =>
      remainingRoot?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" })),
    );
    expect(remainingTree?.querySelector('[aria-label="Display limit reached"]')).not.toBeNull();
  });

  it("adds with Enter, validates input, and restores focus after Escape", () => {
    render({ definitions: [] });
    act(() => button("Add watch").click());
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Watch expression"]');
    expect(document.activeElement).toBe(input);
    expect(button("Save watch").disabled).toBe(true);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Enter a watch");

    change(input as HTMLInputElement, "count");
    press(input as HTMLInputElement, "Enter");
    expect(props.onAdd).toHaveBeenCalledWith("count");

    render({ definitions: [] });
    act(() => button("Add watch").click());
    press(host.querySelector('input[aria-label="Watch expression"]') as Element, "Escape");
    expect(document.activeElement).toBe(button("Add watch"));
  });

  it("supports F2, Enter, Escape, Delete, toggles, and deterministic row focus", () => {
    render();
    const rows = host.querySelectorAll<HTMLElement>('[role="treeitem"]');
    rows[0]?.focus();
    press(rows[0] as Element, "F2");
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Watch expression"]');
    expect(document.activeElement).toBe(input);
    change(input as HTMLInputElement, "total");
    press(input as HTMLInputElement, "Enter");
    expect(props.onUpdate).toHaveBeenCalledWith("watch-1", "total");
    expect(props.onUpdate).toHaveBeenCalledTimes(1);
    expect(host.querySelector('input[aria-label="Watch expression"]')).toBeNull();

    render();
    const refreshedFirst = host.querySelector<HTMLElement>('[role="treeitem"]');
    press(refreshedFirst as Element, "Enter");
    press(host.querySelector('input[aria-label="Watch expression"]') as Element, "Escape");
    expect(document.activeElement).toBe(refreshedFirst);

    const checkbox = host.querySelector<HTMLInputElement>('input[aria-label="Enable watch count"]');
    act(() => checkbox?.click());
    expect(props.onSetEnabled).toHaveBeenCalledWith("watch-1", false);

    press(refreshedFirst as Element, "Delete");
    expect(props.onRemove).toHaveBeenCalledWith("watch-1");
    render({ definitions: [watches[1] as DebugWatchDefinition] });
    expect(document.activeElement).toBe(host.querySelector('[role="treeitem"]'));
  });

  it("uses one roving watch tab stop and supports Home, End, and Space", () => {
    render();
    const rows = host.querySelectorAll<HTMLElement>('[data-testid="debug-watch-row"]');
    expect(rows[0]?.tabIndex).toBe(0);
    expect(rows[1]?.tabIndex).toBe(-1);
    rows[0]?.focus();
    press(rows[0] as Element, "End");
    expect(document.activeElement).toBe(rows[1]);
    press(rows[1] as Element, "Home");
    expect(document.activeElement).toBe(rows[0]);
    press(rows[0] as Element, " ");
    expect(document.activeElement).toBe(
      host.querySelector<HTMLInputElement>('input[aria-label="Watch expression"]'),
    );
  });

  it("does not apply row keyboard shortcuts to nested controls", () => {
    render();
    const checkbox = host.querySelector<HTMLInputElement>('input[aria-label="Enable watch count"]');
    const edit = button("Edit watch count");
    const remove = button("Remove watch count");

    for (const control of [checkbox, edit, remove]) {
      for (const key of ["Enter", " ", "Delete", "ArrowUp", "ArrowDown"]) {
        press(control as Element, key);
      }
    }

    expect(props.onRemove).not.toHaveBeenCalled();
    expect(props.onSetEnabled).not.toHaveBeenCalled();
    expect(host.querySelector('input[aria-label="Watch expression"]')).toBeNull();
  });

  it("does not steal row focus when automatic evaluation results refresh", () => {
    render();
    const first = host.querySelector<HTMLElement>('[role="treeitem"]') as HTMLElement;
    first.focus();
    render({
      evaluations: {
        "watch-1": {
          owner: { ...evaluationOwner, pauseGeneration: 3 },
          definitionRevision: 1,
          frameId: 11,
          result: { status: "ok", value: "4" },
        },
      },
    });
    expect(document.activeElement).toBe(first);
  });

  it("publishes and copies only an enabled current successful root watch", () => {
    const onCandidateChange = vi.fn<(candidate: DebugCopyValueCandidate | null) => void>();
    const copyValue = vi.fn().mockResolvedValue(true);
    render({
      copyValueSurface: copySurface({ onCandidateChange, copyValue }),
      evaluations: { "watch-1": successfulEvaluation },
    });
    const row = host.querySelector<HTMLElement>('[data-testid="debug-watch-row"]')!;
    act(() => row.focus());
    expect(onCandidateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        source: "watch",
        identity: "watch:watch-1:1",
        evaluateName: "count",
        displayedValue: "3",
        rootKey: evaluationOwner.rootKey,
        pauseGeneration: evaluationOwner.pauseGeneration,
      }),
    );
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      metaKey: true,
      key: "c",
    });
    act(() => row.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(copyValue).toHaveBeenCalledTimes(1);

    act(() =>
      row.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 4, clientY: 8 }),
      ),
    );
    const menu = document.querySelector<HTMLElement>(
      '[role="menu"][aria-label="Watch value actions"]',
    );
    expect(menu?.querySelector('[role="menuitem"]')?.textContent).toBe("Copy Value");
    act(() => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(document.querySelector('[aria-label="Watch value actions"]')).toBeNull();
    expect(onCandidateChange).toHaveBeenLastCalledWith(null);
    expect(document.activeElement).toBe(row);
  });

  it("reactively revokes a focused root candidate when watch eligibility changes", () => {
    let current: DebugCopyValueCandidate | null = null;
    const copyValue = vi.fn().mockResolvedValue(true);
    const onCandidateChange = vi.fn((candidate: DebugCopyValueCandidate | null) => {
      current = candidate;
    });
    const surface = copySurface({ onCandidateChange, copyValue });
    const focusSuccess = () => {
      render({
        copyValueSurface: surface,
        definitions: [watches[0]!],
        evaluations: { "watch-1": successfulEvaluation },
        pendingIds: [],
      });
      const row = host.querySelector<HTMLElement>('[data-testid="debug-watch-row"]')!;
      act(() => row.focus());
      expect(current).not.toBeNull();
      return row;
    };

    focusSuccess();
    render({ pendingIds: ["watch-1"] });
    expect(current).toBeNull();

    focusSuccess();
    render({
      evaluations: {
        "watch-1": {
          ...successfulEvaluation,
          result: { status: "error", kind: "exception", message: "failed" },
        },
      },
    });
    expect(current).toBeNull();

    focusSuccess();
    render({ definitions: [{ ...watches[0]!, enabled: false }] });
    expect(current).toBeNull();

    focusSuccess();
    render({ evaluations: { "watch-1": { ...successfulEvaluation, definitionRevision: 0 } } });
    expect(current).toBeNull();

    const row = focusSuccess();
    act(() => button("Edit watch count").click());
    expect(current).toBeNull();
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: "c",
    });
    act(() => row.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    expect(copyValue).not.toHaveBeenCalled();
  });

  it("keeps the exact watch menu candidate through settlement and restores nested focus", async () => {
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
      evaluations: { "watch-1": successfulEvaluation },
    });
    const row = host.querySelector<HTMLElement>('[data-testid="debug-watch-row"]')!;
    act(() =>
      row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    const item = document.querySelector<HTMLButtonElement>(
      '[aria-label="Watch value actions"] [role="menuitem"]',
    )!;
    act(() => item.click());
    expect(copyValueFromMenu).toHaveBeenCalledOnce();
    expect(current).toEqual(expect.objectContaining({ identity: "watch:watch-1:1" }));
    expect(document.activeElement).toBe(row);
    await act(async () => resolveCopy(true));
    expect(current).toBeNull();
  });

  it("fails closed for pending, error, disabled, revision-stale, and owner-stale watches", () => {
    const onCandidateChange = vi.fn();
    const copyValue = vi.fn().mockResolvedValue(true);
    const surface = copySurface({ onCandidateChange, copyValue });
    const cases: Partial<DebugWatchesPanelProps>[] = [
      { evaluations: { "watch-1": successfulEvaluation }, pendingIds: ["watch-1"] },
      {
        evaluations: {
          "watch-1": {
            ...successfulEvaluation,
            result: { status: "error", kind: "exception", message: "failed" },
          },
        },
      },
      {
        definitions: [{ ...watches[0]!, enabled: false }],
        evaluations: { "watch-1": successfulEvaluation },
      },
      {
        evaluations: {
          "watch-1": { ...successfulEvaluation, definitionRevision: 0 },
        },
      },
      {
        evaluations: {
          "watch-1": { ...successfulEvaluation, frameId: 12 },
        },
      },
    ];
    for (const state of cases) {
      render({ ...state, copyValueSurface: surface });
      const row = host.querySelector<HTMLElement>('[data-testid="debug-watch-row"]')!;
      act(() => row.focus());
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: "c",
      });
      act(() => row.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(false);
    }
    render({
      copyValueSurface: copySurface({
        onCandidateChange,
        copyValue,
        isOwnerCurrent: () => false,
      }),
      definitions: [watches[0]!],
      evaluations: { "watch-1": successfulEvaluation },
      pendingIds: [],
    });
    const stale = host.querySelector<HTMLElement>('[data-testid="debug-watch-row"]')!;
    act(() => stale.focus());
    act(() =>
      stale.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    expect(document.querySelector('[aria-label="Watch value actions"]')).toBeNull();
    expect(copyValue).not.toHaveBeenCalled();
  });

  it("leaves native copy in the edit input untouched and uses backend nested evaluateName", () => {
    const onCandidateChange = vi.fn();
    const copyValue = vi.fn().mockResolvedValue(true);
    const surface = copySurface({ onCandidateChange, copyValue });
    render({
      copyValueSurface: surface,
      definitions: [watches[0]!],
      evaluations: {
        "watch-1": {
          ...successfulEvaluation,
          result: { status: "ok", value: "Object", variablesReference: 99 },
        },
      },
      variablePages: {
        owner: evaluationOwner,
        references: {
          99: {
            pages: {
              0: {
                start: 0,
                variables: [
                  {
                    name: "name",
                    value: "Ada",
                    evaluateName: "user.profile.name",
                    variablesReference: 0,
                  },
                ],
                nextStart: null,
              },
            },
            pending: {},
            errors: {},
            limit: null,
          },
        },
        pendingCount: 0,
        totalVariables: 1,
        totalBytes: 0,
      },
    });
    act(() => treeItem("Expand count").click());
    const nested = host.querySelector<HTMLButtonElement>('[aria-label="name, Ada"]')!;
    act(() => nested.focus());
    expect(onCandidateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ evaluateName: "user.profile.name", displayedValue: "Ada" }),
    );
    act(() =>
      nested.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    expect(document.querySelector('[aria-label="Variable actions"]')).not.toBeNull();
    act(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })),
    );
    expect(document.activeElement).toBe(nested);

    act(() => button("Edit watch count").click());
    const input = host.querySelector<HTMLInputElement>('[aria-label="Watch expression"]')!;
    const nativeCopy = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: "c",
    });
    act(() => input.dispatchEvent(nativeCopy));
    expect(nativeCopy.defaultPrevented).toBe(false);
    expect(copyValue).not.toHaveBeenCalled();
  });

  it("does not treat a watch definition expression as an adapter-provided copy path", () => {
    const copyValue = vi.fn().mockResolvedValue(true);
    const copyEvaluatePath = vi.fn().mockResolvedValue(true);
    const copyEvaluatePathFromMenu = vi.fn().mockResolvedValue(true);
    render({
      copyValueSurface: copySurface({
        copyValue,
        copyEvaluatePath,
        copyEvaluatePathFromMenu,
      }),
      definitions: [watches[0]!],
      evaluations: { "watch-1": successfulEvaluation },
    });
    const row = host.querySelector<HTMLElement>('[data-testid="debug-watch-row"]')!;
    act(() => row.focus());
    act(() =>
      row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    expect(
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '[aria-label="Watch value actions"] [role="menuitem"]',
        ),
        (item) => item.textContent,
      ),
    ).toEqual(["Copy Value"]);
    act(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })),
    );

    const localCopy = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: "c",
    });
    act(() => row.dispatchEvent(localCopy));
    expect(localCopy.defaultPrevented).toBe(true);
    expect(copyValue).toHaveBeenCalledOnce();
    expect(copyEvaluatePath).not.toHaveBeenCalled();
    expect(copyEvaluatePathFromMenu).not.toHaveBeenCalled();
  });

  it("offers ordered nested copy actions only for a backend evaluateName and invokes the exact one", () => {
    const onCandidateChange = vi.fn();
    const copyValueFromMenu = vi.fn().mockResolvedValue(true);
    const copyEvaluatePathFromMenu = vi.fn().mockResolvedValue(true);
    render({
      copyValueSurface: copySurface({
        onCandidateChange,
        copyValueFromMenu,
        copyEvaluatePathFromMenu,
      }),
      definitions: [watches[0]!],
      evaluations: { "watch-1": expandableEvaluation },
      variablePages: nestedPages([
        {
          name: "name",
          value: "Ada",
          evaluateName: "user.profile.name",
          variablesReference: 0,
        },
      ]),
    });
    act(() => treeItem("Expand count").click());
    const nested = host.querySelector<HTMLButtonElement>('[aria-label="name, Ada"]')!;
    act(() =>
      nested.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    const items = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[aria-label="Variable actions"] [role="menuitem"]',
      ),
    );
    expect(items.map((item) => item.textContent)).toEqual(["Copy Value", "Copy as Expression"]);
    expect(onCandidateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        evaluateName: "user.profile.name",
        adapterEvaluateName: "user.profile.name",
      }),
    );
    act(() => items[1]?.click());
    expect(copyEvaluatePathFromMenu).toHaveBeenCalledOnce();
    expect(copyValueFromMenu).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(nested);
  });

  it("omits Copy as Expression without a backend path and exposes no target for ineligible controls", () => {
    const copyEvaluatePathFromMenu = vi.fn().mockResolvedValue(true);
    const surface = copySurface({ copyEvaluatePathFromMenu });
    render({
      copyValueSurface: surface,
      definitions: [watches[0]!],
      evaluations: { "watch-1": expandableEvaluation },
      variablePages: nestedPages([{ name: "name", value: "Ada", variablesReference: 0 }]),
    });
    act(() => treeItem("Expand count").click());
    const nested = host.querySelector<HTMLButtonElement>('[aria-label="name, Ada"]')!;
    act(() =>
      nested.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    expect(
      Array.from(
        document.querySelectorAll<HTMLElement>('[aria-label="Variable actions"] [role="menuitem"]'),
        (item) => item.textContent,
      ),
    ).toEqual(["Copy Value"]);
    act(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })),
    );

    for (const overrides of [
      { evaluations: { "watch-1": successfulEvaluation }, pendingIds: ["watch-1"] },
      {
        evaluations: {
          "watch-1": {
            ...successfulEvaluation,
            result: { status: "error" as const, kind: "exception" as const, message: "failed" },
          },
        },
      },
      {
        definitions: [{ ...watches[0]!, enabled: false }],
        evaluations: { "watch-1": successfulEvaluation },
      },
    ]) {
      render({
        copyValueSurface: surface,
        definitions: [watches[0]!],
        pendingIds: [],
        ...overrides,
      });
      const row = host.querySelector<HTMLElement>('[data-testid="debug-watch-row"]')!;
      act(() =>
        row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
      );
      expect(document.querySelector('[aria-label="Watch value actions"]')).toBeNull();
    }

    render({
      copyValueSurface: surface,
      definitions: [watches[0]!],
      evaluations: { "watch-1": successfulEvaluation },
    });
    for (const control of [button("Edit watch count"), button("Remove watch count")]) {
      act(() =>
        control.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
      );
      expect(document.querySelector('[aria-label="Watch value actions"]')).toBeNull();
    }
    act(() => button("Edit watch count").click());
    const input = host.querySelector<HTMLInputElement>('[aria-label="Watch expression"]')!;
    act(() =>
      input.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    expect(document.querySelector('[aria-label="Watch value actions"]')).toBeNull();
    expect(copyEvaluatePathFromMenu).not.toHaveBeenCalled();
  });

  it("keeps the exact nested expression target through deferred copy and revokes stale menus", async () => {
    let current: DebugCopyValueCandidate | null = null;
    let resolveCopy!: (value: boolean) => void;
    const deferred = new Promise<boolean>((resolve) => {
      resolveCopy = resolve;
    });
    const onCandidateChange = vi.fn((candidate: DebugCopyValueCandidate | null) => {
      current = candidate;
    });
    const currentCandidate = (): DebugCopyValueCandidate | null => current;
    const copyEvaluatePathFromMenu = vi.fn(async () => {
      const result = await deferred;
      onCandidateChange(null);
      return result;
    });
    const surface = copySurface({
      canCopyEvaluatePath: () => currentCandidate()?.adapterEvaluateName !== undefined,
      copyEvaluatePathFromMenu,
      onCandidateChange,
    });
    const variables = [
      { name: "a", value: "1", evaluateName: "model.a", variablesReference: 0 },
      { name: "b", value: "2", evaluateName: "model.b", variablesReference: 0 },
    ];
    render({
      copyValueSurface: surface,
      definitions: [watches[0]!],
      evaluations: { "watch-1": expandableEvaluation },
      variablePages: nestedPages(variables),
    });
    act(() => treeItem("Expand count").click());
    const a = host.querySelector<HTMLButtonElement>('[aria-label="a, 1"]')!;
    const b = host.querySelector<HTMLButtonElement>('[aria-label="b, 2"]')!;

    for (const target of [a, b, a]) {
      act(() =>
        target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
      );
      expect(currentCandidate()?.adapterEvaluateName).toBe(target === b ? "model.b" : "model.a");
    }
    const expressionItem = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[aria-label="Variable actions"] [role="menuitem"]',
      ),
    ).find((item) => item.textContent === "Copy as Expression")!;
    act(() => expressionItem.click());
    expect(copyEvaluatePathFromMenu).toHaveBeenCalledOnce();
    expect(currentCandidate()?.adapterEvaluateName).toBe("model.a");
    expect(document.activeElement).toBe(a);
    await act(async () => resolveCopy(true));
    expect(current).toBeNull();

    act(() => b.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    render({ variablePages: nestedPages(variables, { ...evaluationOwner, pauseGeneration: 3 }) });
    expect(document.querySelector('[aria-label="Variable actions"]')).toBeNull();
    expect(currentCandidate()?.adapterEvaluateName).toBeUndefined();
    expect(surface.canCopyEvaluatePath()).toBe(false);
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "count, Object, No longer available",
    );
  });

  it("opens official root Set Value without a clipboard surface and preserves rename shortcuts", () => {
    const { provider } = watchMutation();
    render({
      definitions: [watches[0]!],
      evaluations: { "watch-1": successfulEvaluation },
      expressionMutations: provider,
    });
    const row = treeItem("count");
    act(() =>
      row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    expect(
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '[aria-label="Watch value actions"] [role="menuitem"]',
        ),
        (item) => item.textContent,
      ),
    ).toEqual(["Set Value"]);
    act(() =>
      document
        .querySelector<HTMLButtonElement>('[aria-label="Watch value actions"] button')!
        .click(),
    );
    const input = host.querySelector<HTMLInputElement>('[aria-label="Set value for count"]')!;
    expect(input.value).toBe("3");
    expect(document.activeElement).toBe(input);
    expect(host.querySelector('[aria-label="Watch expression"]')).toBeNull();

    press(input, "Escape");
    expect(host.querySelector('[aria-label="Set value for count"]')).toBeNull();
    expect(document.activeElement).toBe(row);
    press(row, "F2");
    expect(host.querySelector<HTMLInputElement>('[aria-label="Watch expression"]')?.value).toBe(
      "count",
    );
  });

  it("orders root Set Value before truthful adapter-backed copy actions", () => {
    const { provider } = watchMutation();
    render({
      copyValueSurface: copySurface(),
      definitions: [watches[0]!],
      evaluations: {
        "watch-1": {
          ...successfulEvaluation,
          result: {
            ...successfulEvaluation.result,
            evaluateName: "adapter.count",
          },
        },
      },
      expressionMutations: provider,
    });
    const row = treeItem("count");
    act(() => row.focus());
    const calls = (props.copyValueSurface?.onCandidateChange as ReturnType<typeof vi.fn>).mock
      .calls;
    const published = calls[calls.length - 1]?.[0] as DebugCopyValueCandidate;
    expect(published).toMatchObject({
      adapterEvaluateName: "adapter.count",
      evaluateName: "count",
    });
    act(() =>
      row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    expect(
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '[aria-label="Watch value actions"] [role="menuitem"]',
        ),
        (item) => item.textContent,
      ),
    ).toEqual(["Set Value", "Copy Value", "Copy as Expression"]);
  });

  it("does not dispatch unchanged or empty root value drafts", () => {
    const { provider, setValue } = watchMutation();
    render({
      definitions: [watches[0]!],
      evaluations: { "watch-1": successfulEvaluation },
      expressionMutations: provider,
    });
    const row = treeItem("count");
    const open = () => {
      act(() =>
        row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
      );
      act(() =>
        document
          .querySelector<HTMLButtonElement>('[aria-label="Watch value actions"] button')!
          .click(),
      );
      return host.querySelector<HTMLInputElement>('[aria-label="Set value for count"]')!;
    };

    press(open(), "Enter");
    expect(setValue).not.toHaveBeenCalled();
    const input = open();
    change(input, "");
    press(input, "Enter");
    expect(setValue).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="Set value for count"]')).not.toBeNull();
    press(input, "Escape");
    expect(document.activeElement).toBe(row);
  });

  it("commits one root value, blocks duplicate settlement input, and restores row focus", async () => {
    let resolve!: (value: { status: "ok"; value: string }) => void;
    const operation = new Promise<{ status: "ok"; value: string }>((settle) => {
      resolve = settle;
    });
    const setValue = vi.fn<DebugWatchExpressionMutation["setValue"]>().mockReturnValue(operation);
    const { provider } = watchMutation(setValue);
    render({
      definitions: [watches[0]!],
      evaluations: { "watch-1": successfulEvaluation },
      expressionMutations: provider,
    });
    const row = treeItem("count");
    act(() =>
      row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    act(() =>
      document
        .querySelector<HTMLButtonElement>('[aria-label="Watch value actions"] button')!
        .click(),
    );
    const input = host.querySelector<HTMLInputElement>('[aria-label="Set value for count"]')!;
    change(input, "4");
    press(input, "Enter");
    expect(input.readOnly).toBe(true);
    press(input, "Enter");
    press(input, "Escape");
    expect(setValue).toHaveBeenCalledExactlyOnceWith("4");
    expect(host.querySelector('[aria-label="Set value for count"]')).not.toBeNull();

    await act(async () => resolve({ status: "ok", value: "4" }));
    expect(host.querySelector('[aria-label="Set value for count"]')).toBeNull();
    expect(document.activeElement).toBe(row);
  });

  it("keeps root value errors and null results editable without treating them as success", async () => {
    const setValue = vi
      .fn<DebugWatchExpressionMutation["setValue"]>()
      .mockRejectedValueOnce(new Error("Rejected watch value"))
      .mockResolvedValueOnce(null);
    const { provider } = watchMutation(setValue);
    render({
      definitions: [watches[0]!],
      evaluations: { "watch-1": successfulEvaluation },
      expressionMutations: provider,
    });
    const open = () => {
      const row = treeItem("count");
      act(() =>
        row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
      );
      act(() =>
        document
          .querySelector<HTMLButtonElement>('[aria-label="Watch value actions"] button')!
          .click(),
      );
      return host.querySelector<HTMLInputElement>('[aria-label="Set value for count"]')!;
    };

    let input = open();
    change(input, "bad");
    press(input, "Enter");
    await act(async () => Promise.resolve());
    input = host.querySelector<HTMLInputElement>('[aria-label="Set value for count"]')!;
    expect(input.value).toBe("bad");
    expect(input.readOnly).toBe(false);
    expect(document.activeElement).toBe(input);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Rejected watch value");

    press(input, "Escape");
    input = open();
    change(input, "blocked");
    press(input, "Enter");
    await act(async () => Promise.resolve());
    expect(host.querySelector<HTMLInputElement>('[aria-label="Set value for count"]')?.value).toBe(
      "blocked",
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("current debug context");
  });

  it("rechecks the exact root mutation identity before opening and before commit", () => {
    const first = watchMutation();
    const replacementSetValue = vi
      .fn<DebugWatchExpressionMutation["setValue"]>()
      .mockResolvedValue({ status: "ok", value: "5" });
    const replacement: DebugWatchExpressionMutation = Object.freeze({
      identity: Object.freeze({
        definitionId: "watch-1",
        definitionRevision: 1,
        expression: "count",
      }),
      currentValue: "3",
      setValue: replacementSetValue,
    });
    render({
      definitions: [watches[0]!],
      evaluations: { "watch-1": successfulEvaluation },
      expressionMutations: first.provider,
    });
    const row = treeItem("count");
    act(() =>
      row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    first.setCurrent(replacement);
    act(() =>
      document
        .querySelector<HTMLButtonElement>('[aria-label="Watch value actions"] button')!
        .click(),
    );
    expect(host.querySelector('[aria-label="Set value for count"]')).toBeNull();
    expect(first.setValue).not.toHaveBeenCalled();
    expect(replacementSetValue).not.toHaveBeenCalled();

    first.setCurrent(first.mutation);
    act(() =>
      row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    act(() =>
      document
        .querySelector<HTMLButtonElement>('[aria-label="Watch value actions"] button')!
        .click(),
    );
    const input = host.querySelector<HTMLInputElement>('[aria-label="Set value for count"]')!;
    change(input, "4");
    first.setCurrent(null);
    press(input, "Enter");
    expect(first.setValue).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="Set value for count"]')).toBeNull();
  });

  it("fails closed for every ineligible root Watch mutation authority", () => {
    const cases: Partial<DebugWatchesPanelProps>[] = [
      { pendingIds: ["watch-1"] },
      { definitions: [{ ...watches[0]!, enabled: false }] },
      { debugAdapterKind: "php" },
      { sessionState: "running" },
      { workspaceTrusted: false },
      { workspaceRoot: "/other" },
      { evaluations: { "watch-1": { ...successfulEvaluation, definitionRevision: 2 } } },
      { evaluations: { "watch-1": { ...successfulEvaluation, frameId: 12 } } },
      {
        evaluations: {
          "watch-1": {
            ...successfulEvaluation,
            result: { status: "error", kind: "exception", message: "failed" },
          },
        },
      },
    ];
    for (const authority of cases) {
      const { provider } = watchMutation();
      render({
        debugAdapterKind: "node",
        definitions: [watches[0]!],
        evaluations: { "watch-1": successfulEvaluation },
        expressionMutations: provider,
        pendingIds: [],
        sessionState: "stopped",
        workspaceRoot: "/workspace",
        workspaceTrusted: true,
        ...authority,
      });
      const row = host.querySelector<HTMLElement>('[data-testid="debug-watch-row"]')!;
      act(() =>
        row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
      );
      expect(document.querySelector('[aria-label="Watch value actions"]')).toBeNull();
    }
  });

  it("offers Set Value only for writable nested rows when no root expression provider exists", () => {
    const commit = vi.fn<DebugVariableRowMutation["commit"]>().mockResolvedValue(null);
    const variables = [
      { name: "writable", value: "1", variablesReference: 0, canSetValue: true },
      { name: "readonly", value: "2", variablesReference: 0 },
    ] as const;
    let focused: DebugSetVariableFocusedRow | null = null;
    const setVariableSurface: DebugSetVariableSurface = {
      setFocusedCapability(candidate) {
        focused = candidate;
        return () => {
          if (focused === candidate) focused = null;
        };
      },
    };
    render({
      definitions: [watches[0]!],
      evaluations: { "watch-1": expandableEvaluation },
      setVariableSurface,
      variableMutationRows: mutationRowsFor(variables, commit),
      variablePages: nestedPages(variables),
    });

    const rootValue = treeItem("Expand count");
    act(() => rootValue.focus());
    expect(focused).toBeNull();
    press(rootValue, "F2");
    expect(host.querySelector('[aria-label="Watch expression"]')).toBeNull();
    expect(host.querySelector('[aria-label="Set value for count"]')).toBeNull();
    act(() => rootValue.click());

    const readonly = treeItem("readonly, 2");
    act(() =>
      readonly.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    expect(document.querySelector('[aria-label="Variable actions"]')).toBeNull();
    press(readonly, "F2");
    expect(host.querySelector('[aria-label="Set value for readonly"]')).toBeNull();

    const writable = treeItem("writable, 1");
    act(() => writable.focus());
    expect(focused).not.toBeNull();
    act(() =>
      writable.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    expect(
      Array.from(
        document.querySelectorAll<HTMLElement>('[aria-label="Variable actions"] [role="menuitem"]'),
        (item) => item.textContent,
      ),
    ).toEqual(["Set Value"]);
  });

  it("commits a nested Watch value once, adopts the refreshed cache, and retains current errors", async () => {
    let reject!: (error: Error) => void;
    const failed = new Promise<DebugVariable | null>((_resolve, rejectPromise) => {
      reject = rejectPromise;
    });
    const commit = vi
      .fn<DebugVariableRowMutation["commit"]>()
      .mockResolvedValueOnce({
        name: "writable",
        value: "2",
        variablesReference: 0,
        canSetValue: true,
      })
      .mockReturnValueOnce(failed);
    const original = [
      { name: "writable", value: "1", variablesReference: 0, canSetValue: true },
    ] as const;
    const provider = mutationRowsFor(original, commit);
    render({
      definitions: [watches[0]!],
      evaluations: { "watch-1": expandableEvaluation },
      variableMutationRows: provider,
      variablePages: nestedPages(original),
    });
    act(() => treeItem("Expand count").click());
    let row = treeItem("writable, 1");
    const value = row.querySelector<HTMLElement>("[data-debug-variable-value]")!;
    act(() => value.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true })));
    let input = host.querySelector<HTMLInputElement>('[aria-label="Set value for writable"]')!;
    change(input, "2");
    press(input, "Enter");
    await act(async () => Promise.resolve());
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenLastCalledWith("2");
    expect(host.querySelector('[aria-label="Set value for writable"]')).toBeNull();

    const refreshed = [
      { name: "writable", value: "2", variablesReference: 0, canSetValue: true },
    ] as const;
    render({
      variableMutationRows: mutationRowsFor(refreshed, commit),
      variablePages: nestedPages(refreshed),
    });
    row = treeItem("writable, 2");
    act(() =>
      row
        .querySelector<HTMLElement>("[data-debug-variable-value]")!
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true })),
    );
    input = host.querySelector<HTMLInputElement>('[aria-label="Set value for writable"]')!;
    change(input, "bad");
    press(input, "Enter");
    expect(input.readOnly).toBe(true);
    press(input, "Enter");
    expect(commit).toHaveBeenCalledTimes(2);
    await act(async () => reject(new Error("Rejected nested value")));
    input = host.querySelector<HTMLInputElement>('[aria-label="Set value for writable"]')!;
    expect(input.value).toBe("bad");
    expect(input.readOnly).toBe(false);
    expect(document.activeElement).toBe(input);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Rejected nested value");
  });

  it("fails closed for retained results outside the exact writable Watch authority", () => {
    const commit = vi.fn<DebugVariableRowMutation["commit"]>().mockResolvedValue(null);
    const variables = [
      { name: "writable", value: "1", variablesReference: 0, canSetValue: true },
    ] as const;
    const base = {
      definitions: [watches[0]!],
      evaluations: { "watch-1": expandableEvaluation },
      variableMutationRows: mutationRowsFor(variables, commit),
      variablePages: nestedPages(variables),
    };
    render(base);
    act(() => treeItem("Expand count").click());

    const cases: Partial<DebugWatchesPanelProps>[] = [
      { definitions: [{ ...watches[0]!, enabled: false }] },
      { pendingIds: ["watch-1"] },
      { sessionState: "running" },
      { debugAdapterKind: "php" },
      { workspaceTrusted: false },
      { workspaceRoot: "/other-workspace" },
      {
        evaluations: {
          "watch-1": { ...expandableEvaluation, definitionRevision: 99 },
        },
      },
      {
        evaluations: {
          "watch-1": { ...expandableEvaluation, frameId: 12 },
        },
      },
    ];
    for (const authorityDrift of cases) {
      render({
        ...base,
        debugAdapterKind: "node",
        pendingIds: [],
        sessionState: "stopped",
        workspaceTrusted: true,
        ...authorityDrift,
      });
      const row = treeItem("writable, 1");
      act(() => row.focus());
      press(row, "F2");
      expect(host.querySelector('[aria-label="Set value for writable"]')).toBeNull();
      act(() =>
        row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
      );
      expect(document.querySelector('[aria-label="Variable actions"]')).toBeNull();
    }

    render({
      ...base,
      variablePages: nestedPages(variables, { ...evaluationOwner, pauseGeneration: 3 }),
    });
    expect(treeItem("writable, 1")).toBeNull();
    expect(commit).not.toHaveBeenCalled();
  });

  it("never retargets an A to B to A focused nested Watch capability after row reorder", () => {
    const aCommit = vi.fn<DebugVariableRowMutation["commit"]>().mockResolvedValue(null);
    const bCommit = vi.fn<DebugVariableRowMutation["commit"]>().mockResolvedValue(null);
    const a = { name: "a", value: "1", variablesReference: 0, canSetValue: true } as const;
    const b = { name: "b", value: "2", variablesReference: 0, canSetValue: true } as const;
    let focused: DebugSetVariableFocusedRow | null = null;
    const setVariableSurface: DebugSetVariableSurface = {
      setFocusedCapability(candidate) {
        focused = candidate;
        return () => {
          if (focused === candidate) focused = null;
        };
      },
    };
    const provider = (rows: readonly DebugVariable[]): DebugVariableMutationRows => ({
      forRow: (_owner, _reference, _start, index) => {
        const variable = rows[index];
        if (!variable?.canSetValue) return null;
        return {
          currentValue: variable.value,
          commit: variable === a ? aCommit : bCommit,
        };
      },
    });
    render({
      definitions: [watches[0]!],
      evaluations: { "watch-1": expandableEvaluation },
      setVariableSurface,
      variableMutationRows: provider([a, b]),
      variablePages: nestedPages([a, b]),
    });
    act(() => treeItem("Expand count").click());
    for (const label of ["a, 1", "b, 2", "a, 1"]) act(() => treeItem(label).focus());
    const retainedA = focused as DebugSetVariableFocusedRow | null;
    expect(retainedA).not.toBeNull();

    render({
      variableMutationRows: provider([b, a]),
      variablePages: nestedPages([b, a]),
    });
    expect(retainedA?.isCurrent()).toBe(false);
    expect(retainedA?.beginEdit()).toBe(false);
    expect(aCommit).not.toHaveBeenCalled();
    expect(bCommit).not.toHaveBeenCalled();
  });
});
