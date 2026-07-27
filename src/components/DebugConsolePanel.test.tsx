// @vitest-environment jsdom

import { act } from "react";
import type { ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UseDebugConsoleResult } from "../application/useDebugConsole";
import type { DebugCopyValueCandidate } from "../application/debugCopyValue";
import { useDebugCopyValueComposition } from "../application/useDebugCopyValueComposition";
import {
  createDebugConsoleState,
  reduceDebugConsoleState,
  type DebugConsoleState,
} from "../domain/debugConsoleState";
import type { DebugVariable } from "../domain/debug";
import {
  createDebugVariablePagesState,
  reduceDebugVariablePages,
  type DebugVariablePagesState,
} from "../domain/debugVariablePages";
import {
  DebugConsolePanel,
  type DebugConsoleCompletionModel,
  type DebugConsoleCompletionReplacement,
} from "./DebugConsolePanel";
import type { DebugCopyDisplayedValueSurface } from "./debugCopyValueSurface";

const ITEMS: DebugConsoleCompletionModel["items"] = [
  { id: "console", label: "console", detail: "Console API" },
  { id: "count", label: "count", detail: "number" },
  { id: "continue", label: "continue" },
];

function consoleResult(state: DebugConsoleState = createDebugConsoleState(OWNER)) {
  const resultOwner = state.entries.find((entry) => entry.kind === "result")?.resultOwner ?? null;
  return {
    clear: vi.fn(),
    resultOwner,
    state,
    submit: vi.fn().mockResolvedValue(undefined),
  } satisfies UseDebugConsoleResult;
}

function completion(
  overrides: Partial<DebugConsoleCompletionModel> = {},
): DebugConsoleCompletionModel {
  return {
    incomplete: false,
    items: ITEMS,
    pending: false,
    unavailable: null,
    ...overrides,
  };
}

function setInputValue(input: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const OWNER = { pauseGeneration: 1, sessionId: 7 };
const INSPECTION_OWNER = {
  ...OWNER,
  frameId: 11,
  rootKey: "/workspace",
};

function settledConsole(
  value = "captured-value",
  variablesReference = 0,
  evaluateName?: string,
): UseDebugConsoleResult {
  let state = createDebugConsoleState(OWNER);
  state = reduceDebugConsoleState(state, {
    expression: "sideEffecting()",
    owner: OWNER,
    requestId: "request-1",
    resultOwner: { ...INSPECTION_OWNER, epoch: 1, workspaceOwnerKey: "workspace-owner" },
    type: "evaluation-pending",
  });
  state = reduceDebugConsoleState(state, {
    owner: OWNER,
    requestId: "request-1",
    result: {
      status: "ok",
      value,
      variablesReference,
      ...(evaluateName === undefined ? {} : { evaluateName }),
    },
    type: "evaluation-settled",
  });
  return consoleResult(state);
}

function settledConsoleResults(
  results: readonly {
    readonly requestId: string;
    readonly value: string;
    readonly variablesReference: number;
  }[],
): UseDebugConsoleResult {
  let state = createDebugConsoleState(OWNER);
  for (const result of results) {
    state = reduceDebugConsoleState(state, {
      expression: result.requestId,
      owner: OWNER,
      requestId: result.requestId,
      resultOwner: { ...INSPECTION_OWNER, epoch: 1, workspaceOwnerKey: "workspace-owner" },
      type: "evaluation-pending",
    });
    state = reduceDebugConsoleState(state, {
      owner: OWNER,
      requestId: result.requestId,
      result: {
        status: "ok",
        value: result.value,
        variablesReference: result.variablesReference,
      },
      type: "evaluation-settled",
    });
  }
  return consoleResult(state);
}

function displayedValueSurface() {
  let candidate: DebugCopyValueCandidate | null = null;
  let candidateAcceptance = true;
  let evaluatePathEnabled = true;
  const copyDisplayedValue = vi.fn(async () => candidate !== null);
  const copyDisplayedValueFromMenu = vi.fn(async () => candidate !== null);
  const copyEvaluatePath = vi.fn(async () => candidate?.adapterEvaluateName !== undefined);
  const copyEvaluatePathFromMenu = vi.fn(async () => candidate?.adapterEvaluateName !== undefined);
  const surface: DebugCopyDisplayedValueSurface = {
    source: "console",
    workspaceOwnerKey: "workspace-owner",
    generation: 1,
    epoch: 1,
    isOwnerCurrent: (owner) =>
      owner.rootKey === INSPECTION_OWNER.rootKey &&
      owner.sessionId === INSPECTION_OWNER.sessionId &&
      owner.pauseGeneration === INSPECTION_OWNER.pauseGeneration &&
      owner.frameId === INSPECTION_OWNER.frameId,
    onCandidateChange: vi.fn((next) => {
      if (!candidateAcceptance) return false;
      candidate = next;
      return true;
    }),
    canCopyDisplayedValue: () => candidate !== null,
    canCopyEvaluatePath: () => evaluatePathEnabled && candidate?.adapterEvaluateName !== undefined,
    copyDisplayedValue,
    copyDisplayedValueFromMenu,
    copyEvaluatePath,
    copyEvaluatePathFromMenu,
  };
  return {
    copyDisplayedValue,
    copyDisplayedValueFromMenu,
    copyEvaluatePathFromMenu,
    read: () => candidate,
    setCandidateAcceptance: (accepted: boolean) => {
      candidateAcceptance = accepted;
    },
    setEvaluatePathEnabled: (enabled: boolean) => {
      evaluatePathEnabled = enabled;
    },
    surface,
  };
}

function resolvedVariablePages(
  variablesReference: number,
  variables: readonly DebugVariable[],
  nextStart: number | null = null,
): DebugVariablePagesState {
  let state = createDebugVariablePagesState(INSPECTION_OWNER);
  state = reduceDebugVariablePages(state, {
    type: "request",
    owner: INSPECTION_OWNER,
    variablesReference,
    start: 0,
    requestId: "resolved-page",
  });
  return reduceDebugVariablePages(state, {
    type: "resolve",
    owner: INSPECTION_OWNER,
    variablesReference,
    start: 0,
    requestId: "resolved-page",
    result: { variablesReference, start: 0, variables, nextStart },
  });
}

describe("DebugConsolePanel completions", () => {
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

  function render({
    completionModel = completion(),
    console = consoleResult(),
    copyDisplayedValueSurface,
    inspectionOwner,
    onLoadVariablePage,
    onAccept = vi.fn<
      (
        ...parameters: Parameters<NonNullable<ComponentProps<typeof DebugConsolePanel>["onAccept"]>>
      ) => DebugConsoleCompletionReplacement | null
    >(() => null),
    onDismiss = vi.fn(),
    onInputChanged = vi.fn(),
    onRequest = vi.fn(),
    variablePages,
  }: {
    completionModel?: DebugConsoleCompletionModel | null;
    console?: UseDebugConsoleResult;
    copyDisplayedValueSurface?: DebugCopyDisplayedValueSurface;
    inspectionOwner?: ComponentProps<typeof DebugConsolePanel>["inspectionOwner"];
    onLoadVariablePage?: ComponentProps<typeof DebugConsolePanel>["onLoadVariablePage"];
    onAccept?: NonNullable<ComponentProps<typeof DebugConsolePanel>["onAccept"]>;
    onDismiss?: () => void;
    onInputChanged?: NonNullable<ComponentProps<typeof DebugConsolePanel>["onInputChanged"]>;
    onRequest?: NonNullable<ComponentProps<typeof DebugConsolePanel>["onRequest"]> | null;
    variablePages?: DebugVariablePagesState;
  } = {}) {
    act(() => {
      root.render(
        <DebugConsolePanel
          completion={completionModel}
          console={console}
          copyDisplayedValueSurface={copyDisplayedValueSurface}
          enabled
          inspectionOwner={inspectionOwner}
          onLoadVariablePage={onLoadVariablePage}
          onAccept={onAccept}
          onDismiss={onDismiss}
          onInputChanged={onInputChanged}
          onRequest={onRequest ?? undefined}
          variablePages={variablePages}
          workspaceOwnerKey="workspace-owner"
        />,
      );
    });
    return { console, onAccept, onDismiss, onInputChanged, onRequest };
  }

  function input(): HTMLTextAreaElement {
    return host.querySelector<HTMLTextAreaElement>('[aria-label="Debug expression"]')!;
  }

  function contextMenuLabels(): string[] {
    return Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[role="menu"][aria-label="Debug console value actions"] [role="menuitem"]',
      ),
      (item) => item.textContent ?? "",
    );
  }

  it("copies only the immutable console result through keyboard and accessible context actions", () => {
    const copy = displayedValueSurface();
    render({
      console: settledConsole(),
      copyDisplayedValueSurface: copy.surface,
      inspectionOwner: INSPECTION_OWNER,
    });
    const result = host.querySelector<HTMLElement>('[data-kind="result"]')!;
    expect(result.tabIndex).toBe(0);
    expect(result.getAttribute("aria-haspopup")).toBe("menu");

    act(() => {
      result.focus();
      result.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: "c",
        }),
      );
    });
    expect(copy.copyDisplayedValue).toHaveBeenCalledOnce();
    expect(copy.read()?.displayedValue).toBe("captured-value");
    expect(copy.read()?.evaluateName).toBeUndefined();

    act(() =>
      result.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "F10",
          shiftKey: true,
        }),
      ),
    );
    const menu = document.querySelector<HTMLElement>(
      '[role="menu"][aria-label="Debug console value actions"]',
    );
    expect(menu).not.toBeNull();
    act(() =>
      Array.from(menu!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
        .find((item) => item.textContent === "Copy Value")
        ?.click(),
    );
    expect(copy.copyDisplayedValueFromMenu).toHaveBeenCalledOnce();
  });

  it("offers and copies the adapter evaluate name only when a console result has one", () => {
    const copy = displayedValueSurface();
    const rendered = render({
      console: settledConsole("User", 0, 'root["user"]'),
      copyDisplayedValueSurface: copy.surface,
      inspectionOwner: INSPECTION_OWNER,
    });
    const result = host.querySelector<HTMLElement>('[data-kind="result"]')!;

    act(() =>
      result.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 20,
        }),
      ),
    );
    let menuItems = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[role="menu"][aria-label="Debug console value actions"] [role="menuitem"]',
      ),
    );
    expect(menuItems.map((item) => item.textContent)).toEqual(["Copy Value", "Copy as Expression"]);

    act(() => menuItems[1]?.click());

    expect(copy.copyEvaluatePathFromMenu).toHaveBeenCalledOnce();
    expect(copy.read()?.adapterEvaluateName).toBe('root["user"]');

    rendered.console.state = settledConsole("User").state;
    render({
      ...rendered,
      copyDisplayedValueSurface: copy.surface,
      inspectionOwner: INSPECTION_OWNER,
    });
    act(() =>
      host
        .querySelector<HTMLElement>('[data-kind="result"]')!
        .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    menuItems = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[role="menu"][aria-label="Debug console value actions"] [role="menuitem"]',
      ),
    );
    expect(menuItems.map((item) => item.textContent)).toEqual(["Copy Value"]);
  });

  it("does not copy a retained row when the selected menu candidate activation is rejected", () => {
    const copy = displayedValueSurface();
    render({
      console: settledConsole("selected-row"),
      copyDisplayedValueSurface: copy.surface,
      inspectionOwner: INSPECTION_OWNER,
    });
    const result = host.querySelector<HTMLElement>('[data-kind="result"]')!;
    act(() => result.focus());
    expect(copy.read()?.displayedValue).toBe("selected-row");

    copy.setCandidateAcceptance(false);
    act(() =>
      result.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    act(() => {
      document
        .querySelector<HTMLButtonElement>(
          '[role="menu"][aria-label="Debug console value actions"] [role="menuitem"]',
        )
        ?.click();
    });
    expect(copy.copyDisplayedValueFromMenu).not.toHaveBeenCalled();
    expect(copy.read()?.displayedValue).toBe("selected-row");

    copy.setCandidateAcceptance(true);
    act(() =>
      result.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    act(() =>
      document
        .querySelector<HTMLButtonElement>(
          '[role="menu"][aria-label="Debug console value actions"] [role="menuitem"]',
        )
        ?.click(),
    );
    expect(copy.copyDisplayedValueFromMenu).toHaveBeenCalledOnce();
  });

  it("shows and executes Copy as Expression only while the exact live capability remains", () => {
    const copy = displayedValueSurface();
    render({
      console: settledConsole("User", 0, 'root["user"]'),
      copyDisplayedValueSurface: copy.surface,
      inspectionOwner: INSPECTION_OWNER,
    });
    const result = host.querySelector<HTMLElement>('[data-kind="result"]')!;
    act(() =>
      result.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    const expressionAction = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[role="menu"][aria-label="Debug console value actions"] [role="menuitem"]',
      ),
    ).find((item) => item.textContent === "Copy as Expression")!;

    copy.setEvaluatePathEnabled(false);
    act(() => expressionAction.click());

    expect(copy.copyEvaluatePathFromMenu).not.toHaveBeenCalled();
    act(() =>
      result.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    expect(contextMenuLabels()).toEqual(["Copy Value"]);
  });

  it("lazily expands paged result children, nested references, and load-more rows", () => {
    const onLoadVariablePage = vi.fn();
    let variablePages = createDebugVariablePagesState(INSPECTION_OWNER);
    const rendered = render({
      console: settledConsole("Object", 41),
      inspectionOwner: INSPECTION_OWNER,
      onLoadVariablePage,
      variablePages,
    });
    const result = host.querySelector<HTMLElement>('[data-kind="result"]')!;
    const disclosure = host.querySelector<HTMLButtonElement>(
      '[aria-label="Expand debug console result"]',
    )!;

    act(() => disclosure.click());

    expect(onLoadVariablePage).toHaveBeenCalledExactlyOnceWith(INSPECTION_OWNER, 41, 0);
    expect(result.getAttribute("aria-expanded")).toBe("true");
    expect(host.textContent).toContain("Loading…");

    variablePages = reduceDebugVariablePages(variablePages, {
      type: "request",
      owner: INSPECTION_OWNER,
      variablesReference: 41,
      start: 0,
      requestId: "page-1",
    });
    variablePages = reduceDebugVariablePages(variablePages, {
      type: "resolve",
      owner: INSPECTION_OWNER,
      variablesReference: 41,
      start: 0,
      requestId: "page-1",
      result: {
        variablesReference: 41,
        start: 0,
        variables: [
          { name: "nested", value: "Object", type: "object", variablesReference: 42 },
          { name: "count", value: "2", type: "number", variablesReference: 0 },
        ],
        nextStart: 2,
      },
    });
    render({ ...rendered, inspectionOwner: INSPECTION_OWNER, onLoadVariablePage, variablePages });

    expect(host.querySelector('[data-testid="debug-console-variable"]')?.textContent).toContain(
      "nested",
    );
    act(() =>
      host
        .querySelector<HTMLButtonElement>('[aria-label="Collapse debug console result"]')!
        .click(),
    );
    expect(host.querySelector('[data-testid="debug-console-variable"]')).toBeNull();
    act(() =>
      host.querySelector<HTMLButtonElement>('[aria-label="Expand debug console result"]')!.click(),
    );
    expect(onLoadVariablePage.mock.calls.filter(([, reference]) => reference === 41)).toHaveLength(
      1,
    );
    act(() =>
      host
        .querySelector<HTMLButtonElement>('[aria-label="Expand debug console variable nested"]')!
        .click(),
    );
    expect(onLoadVariablePage).toHaveBeenLastCalledWith(INSPECTION_OWNER, 42, 0);

    act(() => {
      const loadMore = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent === "Load more",
      );
      loadMore?.click();
    });
    expect(onLoadVariablePage).toHaveBeenLastCalledWith(INSPECTION_OWNER, 41, 2);
  });

  it("inherits copy-value and adapter-path actions on expanded result child rows", () => {
    const copy = displayedValueSurface();
    const onLoadVariablePage = vi.fn();
    let variablePages = createDebugVariablePagesState(INSPECTION_OWNER);
    variablePages = reduceDebugVariablePages(variablePages, {
      type: "request",
      owner: INSPECTION_OWNER,
      variablesReference: 41,
      start: 0,
      requestId: "page-1",
    });
    variablePages = reduceDebugVariablePages(variablePages, {
      type: "resolve",
      owner: INSPECTION_OWNER,
      variablesReference: 41,
      start: 0,
      requestId: "page-1",
      result: {
        variablesReference: 41,
        start: 0,
        variables: [
          {
            name: "named",
            value: "1",
            evaluateName: "result.named",
            variablesReference: 0,
          },
          { name: "unnamed", value: "2", variablesReference: 0 },
        ],
        nextStart: null,
      },
    });
    render({
      console: settledConsole("Object", 41),
      copyDisplayedValueSurface: copy.surface,
      inspectionOwner: INSPECTION_OWNER,
      onLoadVariablePage,
      variablePages,
    });
    act(() =>
      host.querySelector<HTMLButtonElement>('[aria-label="Expand debug console result"]')!.click(),
    );
    const rows = host.querySelectorAll<HTMLElement>('[data-testid="debug-console-variable"]');

    act(() => {
      rows[0]?.focus();
      rows[0]?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: "c",
        }),
      );
    });
    expect(copy.copyDisplayedValue).toHaveBeenCalledOnce();
    expect(copy.read()?.displayedValue).toBe("1");

    act(() =>
      rows[0]?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    let menuItems = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[role="menu"][aria-label="Debug console value actions"] [role="menuitem"]',
      ),
    );
    expect(menuItems.map((item) => item.textContent)).toEqual(["Copy Value", "Copy as Expression"]);
    act(() => menuItems[1]?.click());
    expect(copy.copyEvaluatePathFromMenu).toHaveBeenCalledOnce();
    expect(copy.read()?.adapterEvaluateName).toBe("result.named");

    act(() =>
      rows[1]?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    menuItems = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[role="menu"][aria-label="Debug console value actions"] [role="menuitem"]',
      ),
    );
    expect(menuItems.map((item) => item.textContent)).toEqual(["Copy Value"]);
  });

  it("offers exact multiline adapter expressions for nested object and property rows", () => {
    const copy = displayedValueSurface();
    const onLoadVariablePage = vi.fn();
    let variablePages = createDebugVariablePagesState(INSPECTION_OWNER);
    for (const page of [
      {
        reference: 41,
        requestId: "root-page",
        variables: [
          {
            name: "nested",
            value: "Object",
            evaluateName: "(\n  root\n).nested",
            variablesReference: 42,
          },
        ],
      },
      {
        reference: 42,
        requestId: "nested-page",
        variables: [
          {
            name: "b",
            value: "1",
            evaluateName: "(\n  root\n).nested.b",
            variablesReference: 0,
          },
        ],
      },
    ]) {
      variablePages = reduceDebugVariablePages(variablePages, {
        type: "request",
        owner: INSPECTION_OWNER,
        variablesReference: page.reference,
        start: 0,
        requestId: page.requestId,
      });
      variablePages = reduceDebugVariablePages(variablePages, {
        type: "resolve",
        owner: INSPECTION_OWNER,
        variablesReference: page.reference,
        start: 0,
        requestId: page.requestId,
        result: {
          variablesReference: page.reference,
          start: 0,
          variables: page.variables,
          nextStart: null,
        },
      });
    }
    render({
      console: settledConsole("Object", 41, "(\n  root\n)"),
      copyDisplayedValueSurface: copy.surface,
      inspectionOwner: INSPECTION_OWNER,
      onLoadVariablePage,
      variablePages,
    });
    act(() =>
      host.querySelector<HTMLButtonElement>('[aria-label="Expand debug console result"]')!.click(),
    );
    const nested = host.querySelector<HTMLElement>('[data-testid="debug-console-variable"]')!;
    act(() =>
      nested.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    let expressionAction = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[role="menu"][aria-label="Debug console value actions"] [role="menuitem"]',
      ),
    ).find((item) => item.textContent === "Copy as Expression");
    expect(expressionAction).toBeDefined();
    act(() => expressionAction?.click());
    expect(copy.read()?.adapterEvaluateName).toBe("(\n  root\n).nested");

    act(() =>
      host
        .querySelector<HTMLButtonElement>('[aria-label="Expand debug console variable nested"]')!
        .click(),
    );
    const property = Array.from(
      host.querySelectorAll<HTMLElement>('[data-testid="debug-console-variable"]'),
    ).find((row) => row.textContent?.includes("b:"))!;
    act(() =>
      property.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    expressionAction = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[role="menu"][aria-label="Debug console value actions"] [role="menuitem"]',
      ),
    ).find((item) => item.textContent === "Copy as Expression");
    expect(expressionAction).toBeDefined();
    act(() => expressionAction?.click());
    expect(copy.read()?.adapterEvaluateName).toBe("(\n  root\n).nested.b");
    expect(copy.copyEvaluatePathFromMenu).toHaveBeenCalledTimes(2);
  });

  it("fails closed and clears expanded result children when the pause owner changes", () => {
    const onLoadVariablePage = vi.fn();
    let variablePages = createDebugVariablePagesState(INSPECTION_OWNER);
    variablePages = reduceDebugVariablePages(variablePages, {
      type: "request",
      owner: INSPECTION_OWNER,
      variablesReference: 41,
      start: 0,
      requestId: "page-1",
    });
    variablePages = reduceDebugVariablePages(variablePages, {
      type: "resolve",
      owner: INSPECTION_OWNER,
      variablesReference: 41,
      start: 0,
      requestId: "page-1",
      result: {
        variablesReference: 41,
        start: 0,
        variables: [{ name: "old", value: "1", variablesReference: 0 }],
        nextStart: null,
      },
    });
    const debugConsole = settledConsole("Object", 41);
    render({
      console: debugConsole,
      inspectionOwner: INSPECTION_OWNER,
      onLoadVariablePage,
      variablePages,
    });
    act(() =>
      host.querySelector<HTMLButtonElement>('[aria-label="Expand debug console result"]')!.click(),
    );
    expect(host.textContent).toContain("old");

    const nextOwner = { ...INSPECTION_OWNER, pauseGeneration: 2 };
    render({
      console: debugConsole,
      inspectionOwner: nextOwner,
      onLoadVariablePage,
      variablePages: createDebugVariablePagesState(nextOwner),
    });

    expect(host.querySelector('[aria-label="Expand debug console result"]')).toBeNull();
    expect(host.querySelector('[data-testid="debug-console-variable"]')).toBeNull();
    expect(onLoadVariablePage).not.toHaveBeenCalled();
  });

  it("mirrors variable-tree keyboard expansion without breaking local Copy Value", () => {
    const copy = displayedValueSurface();
    const onLoadVariablePage = vi.fn();
    render({
      console: settledConsole("Object", 41),
      copyDisplayedValueSurface: copy.surface,
      inspectionOwner: INSPECTION_OWNER,
      onLoadVariablePage,
      variablePages: createDebugVariablePagesState(INSPECTION_OWNER),
    });
    const result = host.querySelector<HTMLElement>('[data-kind="result"]')!;

    act(() => {
      result.focus();
      result.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "ArrowRight",
        }),
      );
    });
    expect(onLoadVariablePage).toHaveBeenCalledExactlyOnceWith(INSPECTION_OWNER, 41, 0);
    expect(result.getAttribute("aria-expanded")).toBe("true");

    act(() =>
      result.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: "c",
        }),
      ),
    );
    expect(copy.copyDisplayedValue).toHaveBeenCalledOnce();
  });

  it("uses one roving tree tab stop and preserves focus across duplicate and removed rows", () => {
    const debugConsole = settledConsole("Object", 41);
    const variables = [
      { name: "duplicate", value: "first", variablesReference: 0 },
      { name: "duplicate", value: "second", variablesReference: 0 },
      { name: "last", value: "third", variablesReference: 0 },
    ];
    render({
      console: debugConsole,
      inspectionOwner: INSPECTION_OWNER,
      onLoadVariablePage: vi.fn(),
      variablePages: resolvedVariablePages(41, variables),
    });
    act(() =>
      host.querySelector<HTMLButtonElement>('[aria-label="Expand debug console result"]')!.click(),
    );
    let rows = Array.from(
      host.querySelectorAll<HTMLElement>('[data-testid="debug-console-variable"]'),
    );
    expect(rows.map((row) => row.tabIndex)).toEqual([0, -1, -1]);

    act(() => {
      rows[0]!.focus();
      rows[0]!.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowDown" }),
      );
    });
    rows = Array.from(host.querySelectorAll<HTMLElement>('[data-testid="debug-console-variable"]'));
    expect(document.activeElement).toBe(rows[1]);
    expect(rows.map((row) => row.tabIndex)).toEqual([-1, 0, -1]);

    act(() =>
      rows[1]!.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "End" }),
      ),
    );
    expect(document.activeElement).toBe(rows[2]);
    act(() =>
      rows[2]!.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Home" }),
      ),
    );
    expect(document.activeElement).toBe(rows[0]);

    act(() => {
      rows[1]!.focus();
    });
    render({
      console: debugConsole,
      inspectionOwner: INSPECTION_OWNER,
      onLoadVariablePage: vi.fn(),
      variablePages: resolvedVariablePages(41, variables.slice(0, 1)),
    });
    rows = Array.from(host.querySelectorAll<HTMLElement>('[data-testid="debug-console-variable"]'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tabIndex).toBe(0);
    expect(document.activeElement).toBe(rows[0]);
  });

  it("owns one independent roving tab stop for every expanded result tree", () => {
    let variablePages = resolvedVariablePages(41, [
      { name: "first-child", value: "1", variablesReference: 0 },
    ]);
    variablePages = reduceDebugVariablePages(variablePages, {
      type: "request",
      owner: INSPECTION_OWNER,
      variablesReference: 42,
      start: 0,
      requestId: "second-page",
    });
    variablePages = reduceDebugVariablePages(variablePages, {
      type: "resolve",
      owner: INSPECTION_OWNER,
      variablesReference: 42,
      start: 0,
      requestId: "second-page",
      result: {
        variablesReference: 42,
        start: 0,
        variables: [{ name: "second-child", value: "2", variablesReference: 0 }],
        nextStart: null,
      },
    });
    render({
      console: settledConsoleResults([
        { requestId: "first", value: "First", variablesReference: 41 },
        { requestId: "second", value: "Second", variablesReference: 42 },
      ]),
      inspectionOwner: INSPECTION_OWNER,
      onLoadVariablePage: vi.fn(),
      variablePages,
    });
    act(() => {
      for (const button of host.querySelectorAll<HTMLButtonElement>(
        '[aria-label="Expand debug console result"]',
      )) {
        button.click();
      }
    });

    const trees = Array.from(host.querySelectorAll<HTMLElement>('[role="tree"]'));
    expect(trees).toHaveLength(2);
    expect(
      trees.map(
        (tree) =>
          Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]')).filter(
            (row) => row.tabIndex === 0,
          ).length,
      ),
    ).toEqual([1, 1]);
  });

  it("releases a focused Load more row before later layouts can restore stale focus", async () => {
    const debugConsole = settledConsole("Object", 41);
    const variables = [{ name: "first", value: "1", variablesReference: 0 }];
    const renderPanel = () =>
      render({
        console: debugConsole,
        inspectionOwner: INSPECTION_OWNER,
        onLoadVariablePage: vi.fn(),
        variablePages: resolvedVariablePages(41, variables, 1),
      });
    renderPanel();
    act(() =>
      host.querySelector<HTMLButtonElement>('[aria-label="Expand debug console result"]')!.click(),
    );
    const loadRow = Array.from(host.querySelectorAll<HTMLElement>('[role="treeitem"]')).find(
      (row) => row.textContent === "Load more",
    )!;
    const outside = document.createElement("button");
    document.body.append(outside);

    await act(async () => {
      loadRow.focus();
      outside.focus();
      await Promise.resolve();
    });
    outside.remove();
    renderPanel();

    expect(document.activeElement).toBe(document.body);
    expect(document.activeElement).not.toBe(
      Array.from(host.querySelectorAll<HTMLElement>('[role="treeitem"]')).find(
        (row) => row.textContent === "Load more",
      ),
    );
  });

  it("keeps duplicate entry and tree focus ownership inside the originating panel", async () => {
    const debugConsole = settledConsole("Object", 41);
    const variablePages = resolvedVariablePages(41, [
      { name: "child", value: "1", variablesReference: 0 },
    ]);
    act(() => {
      root.render(
        <>
          {(["first", "second"] as const).map((panel) => (
            <section data-panel={panel} key={panel}>
              <DebugConsolePanel
                console={debugConsole}
                enabled
                inspectionOwner={INSPECTION_OWNER}
                onLoadVariablePage={vi.fn()}
                variablePages={variablePages}
                workspaceOwnerKey="workspace-owner"
              />
            </section>
          ))}
        </>,
      );
    });
    act(() => {
      for (const button of host.querySelectorAll<HTMLButtonElement>(
        '[aria-label="Expand debug console result"]',
      )) {
        button.click();
      }
    });
    const secondPanel = host.querySelector<HTMLElement>('[data-panel="second"]')!;
    const firstPanel = host.querySelector<HTMLElement>('[data-panel="first"]')!;
    const firstChild = firstPanel.querySelector<HTMLElement>(
      '[data-testid="debug-console-variable"]',
    )!;
    const secondChild = secondPanel.querySelector<HTMLElement>(
      '[data-testid="debug-console-variable"]',
    )!;

    act(() => {
      secondChild.focus();
      secondChild.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowLeft" }),
      );
    });

    expect(document.activeElement).toBe(
      secondPanel.querySelector<HTMLElement>('[data-kind="result"]'),
    );
    expect(document.activeElement).not.toBe(
      host.querySelector<HTMLElement>('[data-panel="first"] [data-kind="result"]'),
    );

    await act(async () => {
      firstChild.focus();
      secondChild.focus();
      await Promise.resolve();
    });
    act(() => {
      root.render(
        <>
          <section data-panel="first" key="first">
            <DebugConsolePanel
              console={debugConsole}
              enabled
              inspectionOwner={INSPECTION_OWNER}
              onLoadVariablePage={vi.fn()}
              variablePages={resolvedVariablePages(41, [
                { name: "child", value: "1", variablesReference: 0 },
              ])}
              workspaceOwnerKey="workspace-owner"
            />
          </section>
          <section data-panel="second" key="second" />
        </>,
      );
    });

    expect(document.activeElement).toBe(document.body);
    expect(document.activeElement).not.toBe(
      host.querySelector<HTMLElement>(
        '[data-panel="first"] [data-testid="debug-console-variable"]',
      ),
    );
  });

  it("preserves the roving item while Left and Right toggle a nested variable", () => {
    let variablePages = resolvedVariablePages(41, [
      { name: "nested", value: "Object", variablesReference: 42 },
    ]);
    variablePages = reduceDebugVariablePages(variablePages, {
      type: "request",
      owner: INSPECTION_OWNER,
      variablesReference: 42,
      start: 0,
      requestId: "nested-page",
    });
    variablePages = reduceDebugVariablePages(variablePages, {
      type: "resolve",
      owner: INSPECTION_OWNER,
      variablesReference: 42,
      start: 0,
      requestId: "nested-page",
      result: {
        variablesReference: 42,
        start: 0,
        variables: [{ name: "child", value: "1", variablesReference: 0 }],
        nextStart: null,
      },
    });
    render({
      console: settledConsole("Object", 41),
      inspectionOwner: INSPECTION_OWNER,
      onLoadVariablePage: vi.fn(),
      variablePages,
    });
    act(() =>
      host.querySelector<HTMLButtonElement>('[aria-label="Expand debug console result"]')!.click(),
    );
    const nested = host.querySelector<HTMLElement>('[data-testid="debug-console-variable"]')!;
    act(() => {
      nested.focus();
      nested.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowRight" }),
      );
    });
    expect(document.activeElement).toBe(nested);
    expect(host.textContent).toContain("child:");
    expect(
      Array.from(
        host.querySelectorAll<HTMLElement>('[data-testid="debug-console-variable"]'),
      ).filter((row) => row.tabIndex === 0),
    ).toEqual([nested]);

    act(() =>
      nested.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowRight" }),
      ),
    );
    const child = Array.from(
      host.querySelectorAll<HTMLElement>('[data-testid="debug-console-variable"]'),
    ).find((row) => row.textContent?.includes("child:"))!;
    expect(document.activeElement).toBe(child);

    act(() =>
      child.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowLeft" }),
      ),
    );
    expect(document.activeElement).toBe(nested);

    act(() =>
      nested.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowLeft" }),
      ),
    );
    expect(document.activeElement).toBe(nested);
    expect(host.textContent).not.toContain("child:");

    act(() =>
      nested.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowLeft" }),
      ),
    );
    expect(document.activeElement).toBe(host.querySelector('[data-kind="result"]'));
  });

  it("does not move Right into a later sibling subtree when an expanded node is empty", () => {
    let variablePages = resolvedVariablePages(41, [
      { name: "empty", value: "Object", variablesReference: 42 },
      { name: "sibling", value: "Object", variablesReference: 43 },
    ]);
    for (const [variablesReference, variables] of [
      [42, []],
      [43, [{ name: "sibling-child", value: "1", variablesReference: 0 }]],
    ] as const) {
      const requestId = `page-${variablesReference}`;
      variablePages = reduceDebugVariablePages(variablePages, {
        type: "request",
        owner: INSPECTION_OWNER,
        variablesReference,
        start: 0,
        requestId,
      });
      variablePages = reduceDebugVariablePages(variablePages, {
        type: "resolve",
        owner: INSPECTION_OWNER,
        variablesReference,
        start: 0,
        requestId,
        result: {
          variablesReference,
          start: 0,
          variables,
          nextStart: null,
        },
      });
    }
    render({
      console: settledConsole("Object", 41),
      inspectionOwner: INSPECTION_OWNER,
      onLoadVariablePage: vi.fn(),
      variablePages,
    });
    act(() =>
      host.querySelector<HTMLButtonElement>('[aria-label="Expand debug console result"]')!.click(),
    );
    act(() => {
      host
        .querySelector<HTMLButtonElement>('[aria-label="Expand debug console variable empty"]')
        ?.click();
      host
        .querySelector<HTMLButtonElement>('[aria-label="Expand debug console variable sibling"]')
        ?.click();
    });
    const empty = Array.from(
      host.querySelectorAll<HTMLElement>('[data-testid="debug-console-variable"]'),
    ).find((row) => row.textContent?.includes("empty:"))!;
    expect(host.textContent).toContain("sibling-child:");

    act(() => {
      empty.focus();
      empty.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowRight" }),
      );
    });

    expect(document.activeElement).toBe(empty);
  });

  it.each(["mouse", "keyboard"] as const)(
    "copies through the real composition from the %s context path without evaluation",
    async (path) => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      const evaluateClipboard = vi.fn();
      const state = settledConsole();
      function Harness() {
        const composition = useDebugCopyValueComposition({
          clipboard: { canWriteText: () => true, writeText },
          evaluateClipboard,
          owner: {
            ...INSPECTION_OWNER,
            workspaceOwnerKey: "workspace-owner",
          },
        });
        return (
          <DebugConsolePanel
            completion={null}
            console={state}
            copyDisplayedValueSurface={composition.console}
            enabled
            inspectionOwner={INSPECTION_OWNER}
            workspaceOwnerKey="workspace-owner"
          />
        );
      }
      act(() => root.render(<Harness />));
      const result = host.querySelector<HTMLElement>('[data-kind="result"]')!;

      if (path === "mouse") {
        act(() =>
          result.dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
              clientX: 4,
              clientY: 8,
            }),
          ),
        );
      } else {
        act(() => {
          result.focus();
          result.dispatchEvent(
            new KeyboardEvent("keydown", {
              bubbles: true,
              cancelable: true,
              key: "F10",
              shiftKey: true,
            }),
          );
        });
      }
      const menuItem = document.querySelector<HTMLButtonElement>(
        '[role="menu"][aria-label="Debug console value actions"] [role="menuitem"]',
      )!;
      await act(async () => {
        if (path === "keyboard") {
          menuItem.focus();
          const enter = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Enter",
          });
          menuItem.dispatchEvent(enter);
          if (!enter.defaultPrevented) menuItem.click();
        } else {
          menuItem.click();
        }
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(writeText).toHaveBeenCalledExactlyOnceWith("captured-value");
      expect(evaluateClipboard).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(result);
    },
  );

  it("keeps Copy Value after Continue but removes live Copy as Expression", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const state = settledConsole("captured-value", 0, 'root["user"]');
    function Harness({ paused }: { readonly paused: boolean }) {
      const composition = useDebugCopyValueComposition({
        clipboard: { canWriteText: () => true, writeText },
        evaluateClipboard: vi.fn(),
        owner: paused
          ? {
              ...INSPECTION_OWNER,
              workspaceOwnerKey: "workspace-owner",
            }
          : null,
      });
      return (
        <DebugConsolePanel
          console={state}
          copyDisplayedValueSurface={composition.console}
          enabled={paused}
          inspectionOwner={paused ? INSPECTION_OWNER : null}
          workspaceOwnerKey="workspace-owner"
        />
      );
    }
    act(() => root.render(<Harness paused />));
    const result = host.querySelector<HTMLElement>('[data-kind="result"]')!;
    act(() =>
      result.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    expect(contextMenuLabels()).toEqual(["Copy Value", "Copy as Expression"]);

    act(() => root.render(<Harness paused={false} />));

    expect(contextMenuLabels()).toEqual(["Copy Value"]);
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '[role="menu"][aria-label="Debug console value actions"] [role="menuitem"]',
        )
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledExactlyOnceWith("captured-value");
  });

  it("clears the exact displayed-value candidate when workspace ownership changes", () => {
    const copy = displayedValueSurface();
    const state = settledConsole();
    const renderForWorkspace = (workspaceOwnerKey: string) => {
      act(() =>
        root.render(
          <DebugConsolePanel
            console={state}
            copyDisplayedValueSurface={copy.surface}
            enabled
            inspectionOwner={INSPECTION_OWNER}
            workspaceOwnerKey={workspaceOwnerKey}
          />,
        ),
      );
    };

    renderForWorkspace("workspace-owner");
    const result = host.querySelector<HTMLElement>('[data-kind="result"]')!;
    act(() => result.focus());
    expect(copy.read()).toMatchObject({
      displayedValue: "captured-value",
      identity: "console-2",
    });

    renderForWorkspace("replacement-workspace-owner");

    expect(copy.read()).toBeNull();
    expect(host.querySelector<HTMLElement>('[data-kind="result"]')?.hasAttribute("tabindex")).toBe(
      false,
    );
    expect(
      host.querySelector<HTMLElement>('[data-kind="result"]')?.getAttribute("aria-haspopup"),
    ).toBeNull();
  });

  it("leaves selected text native and retains only immutable copy after the live frame changes", () => {
    const copy = displayedValueSurface();
    const state = settledConsole();
    render({
      console: state,
      copyDisplayedValueSurface: copy.surface,
      inspectionOwner: INSPECTION_OWNER,
    });
    const result = host.querySelector<HTMLElement>('[data-kind="result"]')!;
    act(() => result.focus());
    expect(copy.read()).not.toBeNull();

    const selection = vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: false,
    } as Selection);
    const nativeCopy = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: "c",
    });
    act(() => result.dispatchEvent(nativeCopy));
    expect(nativeCopy.defaultPrevented).toBe(false);
    expect(copy.copyDisplayedValue).not.toHaveBeenCalled();
    selection.mockRestore();

    render({
      console: state,
      copyDisplayedValueSurface: copy.surface,
      inspectionOwner: { ...INSPECTION_OWNER, frameId: INSPECTION_OWNER.frameId + 1 },
    });
    expect(copy.read()).toMatchObject({
      displayedValue: "captured-value",
      identity: "console-2",
    });
    expect(copy.read()?.adapterEvaluateName).toBeUndefined();
    expect(host.querySelector<HTMLElement>('[data-kind="result"]')?.tabIndex).toBe(0);

    render({
      console: consoleResult(reduceDebugConsoleState(state.state, { type: "clear", owner: OWNER })),
      copyDisplayedValueSurface: copy.surface,
      inspectionOwner: INSPECTION_OWNER,
    });
    expect(host.querySelector('[data-kind="result"]')).toBeNull();
    expect(copy.read()).toBeNull();
  });

  function key(
    key: string,
    options: Pick<
      KeyboardEventInit,
      "altKey" | "code" | "ctrlKey" | "isComposing" | "metaKey" | "shiftKey"
    > = {},
  ): KeyboardEvent {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key,
      ...options,
    });
    act(() => input().dispatchEvent(event));
    return event;
  }

  it("requests completions with the exact expression and cursor using Ctrl+Space", () => {
    const onRequest = vi.fn();
    render({ completionModel: completion({ items: [], pending: true }), onRequest });
    act(() => {
      setInputValue(input(), "object.member");
      input().setSelectionRange(6, 6);
    });

    const event = key(" ", { code: "Space", ctrlKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(onRequest).toHaveBeenCalledWith({ cursor: 6, expression: "object.member" });
    expect(input().getAttribute("role")).toBe("combobox");
    expect(input().getAttribute("aria-expanded")).toBe("true");
    expect(input().getAttribute("aria-busy")).toBe("true");
    expect(input().getAttribute("aria-controls")).toBe(host.querySelector('[role="listbox"]')?.id);
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Loading suggestions…");
  });

  it("forwards changed input and caret for debounced automatic completion", () => {
    const onInputChanged = vi.fn();
    render({ onInputChanged });
    act(() => {
      setInputValue(input(), "object.na");
      input().setSelectionRange(9, 9);
    });

    expect(onInputChanged).toHaveBeenLastCalledWith({
      cursor: 9,
      expression: "object.na",
    });
  });

  it("does not intercept Ctrl+Space when the optional completion surface is absent", () => {
    render({ completionModel: null, onRequest: null });

    const event = key(" ", { code: "Space", ctrlKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(input().getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });

  it("navigates the popup and accepts with Enter without evaluating", async () => {
    const debugConsole = consoleResult();
    const onAccept = vi.fn((_item, request) => ({
      cursor: 13,
      expression: `${request.expression.slice(0, request.cursor)}count`,
    }));
    render({ console: debugConsole, onAccept });
    act(() => {
      setInputValue(input(), "value.");
      input().setSelectionRange(6, 6);
      input().focus();
    });
    key(" ", { code: "Space", ctrlKey: true });
    key("ArrowDown");
    expect(input().getAttribute("aria-activedescendant")).toContain("-option-1");

    const event = key("Enter");
    await act(async () => Promise.resolve());

    expect(event.defaultPrevented).toBe(true);
    expect(onAccept).toHaveBeenCalledWith(ITEMS[1], {
      cursor: 6,
      expression: "value.",
    });
    expect(input().value).toBe("value.count");
    expect(input().selectionStart).toBe(11);
    expect(input().getAttribute("aria-expanded")).toBe("false");
    expect(debugConsole.submit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input());
  });

  it("accepts with Tab and keeps an open empty popup from evaluating", () => {
    const debugConsole = consoleResult();
    const onAccept = vi.fn(() => ({ cursor: 7, expression: "console" }));
    const rendered = render({ console: debugConsole, onAccept });
    key(" ", { code: "Space", ctrlKey: true });
    key("Tab");
    expect(onAccept).toHaveBeenCalledWith(ITEMS[0], { cursor: 0, expression: "" });
    expect(debugConsole.submit).not.toHaveBeenCalled();

    render({
      completionModel: completion({ items: [], unavailable: "Adapter has no completions" }),
      console: debugConsole,
      onAccept,
      onDismiss: rendered.onDismiss,
      onRequest: rendered.onRequest,
    });
    key(" ", { code: "Space", ctrlKey: true });
    const enter = key("Enter");
    expect(enter.defaultPrevented).toBe(true);
    expect(debugConsole.submit).not.toHaveBeenCalled();
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Adapter has no completions");
  });

  it("leaves modified completion keys to native text navigation", () => {
    const debugConsole = consoleResult();
    const onAccept = vi.fn(() => ({ cursor: 7, expression: "console" }));
    render({ console: debugConsole, onAccept });
    act(() => setInputValue(input(), "draft"));
    key(" ", { code: "Space", ctrlKey: true });

    for (const [pressedKey, modifiers] of [
      ["ArrowUp", { shiftKey: true }],
      ["ArrowDown", { altKey: true }],
      ["Tab", { shiftKey: true }],
      ["Enter", { ctrlKey: true }],
      ["Enter", { metaKey: true }],
    ] as const) {
      expect(key(pressedKey, modifiers).defaultPrevented).toBe(false);
    }

    expect(onAccept).not.toHaveBeenCalled();
    expect(debugConsole.submit).not.toHaveBeenCalled();
    expect(input().getAttribute("aria-expanded")).toBe("true");
  });

  it("dismisses first on Escape without clearing input, then preserves existing Escape semantics", () => {
    const onDismiss = vi.fn();
    render({ onDismiss });
    act(() => setInputValue(input(), "temporary"));
    key(" ", { code: "Space", ctrlKey: true });

    key("Escape");
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(input().value).toBe("temporary");
    expect(input().getAttribute("aria-expanded")).toBe("false");

    key("Escape");
    expect(input().value).toBe("");
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("leaves closed-popup history routing intact", () => {
    let state = createDebugConsoleState(OWNER);
    state = reduceDebugConsoleState(state, {
      expression: "first",
      owner: OWNER,
      requestId: "request-1",
      type: "evaluation-pending",
    });
    render({ console: consoleResult(state) });

    key("ArrowUp");
    expect(input().value).toBe("first");
    key("ArrowDown");
    expect(input().value).toBe("");
  });

  it("inserts a newline with Shift+Enter instead of submitting", () => {
    const debugConsole = consoleResult();
    render({ console: debugConsole });
    act(() => {
      setInputValue(input(), "first");
      input().setSelectionRange(5, 5);
    });

    const event = key("Enter", { shiftKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(input().value).toBe("first\n");
    expect(debugConsole.submit).not.toHaveBeenCalled();
  });

  it.each([completion(), completion({ items: [], pending: true })])(
    "keeps Shift+Enter multiline ahead of an open completion popup",
    (completionModel) => {
      const debugConsole = consoleResult();
      const onAccept = vi.fn(() => ({ cursor: 5, expression: "count" }));
      const onDismiss = vi.fn();
      const onInputChanged = vi.fn();
      render({
        completionModel,
        console: debugConsole,
        onAccept,
        onDismiss,
        onInputChanged,
      });
      act(() => {
        setInputValue(input(), "first");
        input().setSelectionRange(5, 5);
      });
      key(" ", { code: "Space", ctrlKey: true });

      const event = key("Enter", { shiftKey: true });

      expect(event.defaultPrevented).toBe(true);
      expect(input().value).toBe("first\n");
      expect(input().getAttribute("aria-expanded")).toBe("false");
      expect(onInputChanged).toHaveBeenLastCalledWith({ cursor: 6, expression: "first\n" });
      expect(onAccept).not.toHaveBeenCalled();
      expect(debugConsole.submit).not.toHaveBeenCalled();
      expect(onDismiss).toHaveBeenCalled();
    },
  );

  it("supports repeated Shift+Enter without submitting a partial expression", () => {
    const debugConsole = consoleResult();
    render({ console: debugConsole });
    act(() => {
      setInputValue(input(), "first");
      input().setSelectionRange(5, 5);
    });

    key("Enter", { shiftKey: true });
    act(() => input().setSelectionRange(input().value.length, input().value.length));
    key("Enter", { shiftKey: true });

    expect(input().value).toBe("first\n\n");
    expect(debugConsole.submit).not.toHaveBeenCalled();
  });

  it("submits multiline text with only leading and trailing blank lines removed", () => {
    const debugConsole = consoleResult();
    render({ console: debugConsole });
    act(() => setInputValue(input(), "\n \nfirst\n  second  \n\n"));

    const event = key("Enter");

    expect(event.defaultPrevented).toBe(true);
    expect(debugConsole.submit).toHaveBeenCalledWith("first\n  second  ");
    expect(input().value).toBe("");
  });

  it("preserves input without submitting when Enter confirms an IME composition", () => {
    const debugConsole = consoleResult();
    render({ console: debugConsole });
    act(() => setInputValue(input(), "日本語"));

    const event = key("Enter", { isComposing: true });

    expect(event.defaultPrevented).toBe(false);
    expect(debugConsole.submit).not.toHaveBeenCalled();
    expect(input().value).toBe("日本語");
  });

  it("does not navigate history with arrow keys during IME composition", () => {
    let state = createDebugConsoleState(OWNER);
    state = reduceDebugConsoleState(state, {
      expression: "historical",
      owner: OWNER,
      requestId: "request-1",
      type: "evaluation-pending",
    });
    render({ console: consoleResult(state) });
    act(() => setInputValue(input(), "日本語"));

    expect(key("ArrowUp", { isComposing: true }).defaultPrevented).toBe(false);
    expect(input().value).toBe("日本語");
    expect(key("ArrowDown", { isComposing: true }).defaultPrevented).toBe(false);
    expect(input().value).toBe("日本語");
  });

  it("navigates history only from the first and last line caret boundaries", () => {
    let state = createDebugConsoleState(OWNER);
    state = reduceDebugConsoleState(state, {
      expression: "historical\nentry",
      owner: OWNER,
      requestId: "request-1",
      type: "evaluation-pending",
    });
    render({ console: consoleResult(state) });
    act(() => {
      setInputValue(input(), "first\nmiddle\nlast");
      input().setSelectionRange(8, 8);
    });

    expect(key("ArrowUp").defaultPrevented).toBe(false);
    expect(input().value).toBe("first\nmiddle\nlast");
    expect(key("ArrowDown").defaultPrevented).toBe(false);
    expect(input().value).toBe("first\nmiddle\nlast");

    act(() => input().setSelectionRange(2, 2));
    expect(key("ArrowUp").defaultPrevented).toBe(true);
    expect(input().value).toBe("historical\nentry");

    act(() => {
      input().setSelectionRange(2, 2);
    });
    expect(key("ArrowDown").defaultPrevented).toBe(false);
    expect(input().value).toBe("historical\nentry");

    act(() => input().setSelectionRange(input().value.length, input().value.length));
    expect(key("ArrowDown").defaultPrevented).toBe(true);
    expect(input().value).toBe("first\nmiddle\nlast");
  });

  it("restores the pre-history draft and leaves modified arrows to text editing", () => {
    let state = createDebugConsoleState(OWNER);
    state = reduceDebugConsoleState(state, {
      expression: "historical",
      owner: OWNER,
      requestId: "request-1",
      type: "evaluation-pending",
    });
    render({ console: consoleResult(state) });
    act(() => {
      setInputValue(input(), "draft");
      input().setSelectionRange(0, 0);
    });

    for (const modifiers of [
      { shiftKey: true },
      { altKey: true },
      { ctrlKey: true },
      { metaKey: true },
    ]) {
      expect(key("ArrowUp", modifiers).defaultPrevented).toBe(false);
      expect(input().value).toBe("draft");
    }

    expect(key("ArrowUp").defaultPrevented).toBe(true);
    expect(input().value).toBe("historical");
    act(() => input().setSelectionRange(input().value.length, input().value.length));

    for (const modifiers of [
      { shiftKey: true },
      { altKey: true },
      { ctrlKey: true },
      { metaKey: true },
    ]) {
      expect(key("ArrowDown", modifiers).defaultPrevented).toBe(false);
      expect(input().value).toBe("historical");
    }

    expect(key("ArrowDown").defaultPrevented).toBe(true);
    expect(input().value).toBe("draft");
  });

  it("leaves multiline selections to normal arrow-key movement", () => {
    let state = createDebugConsoleState(OWNER);
    state = reduceDebugConsoleState(state, {
      expression: "historical\nentry",
      owner: OWNER,
      requestId: "request-1",
      type: "evaluation-pending",
    });
    render({ console: consoleResult(state) });
    act(() => {
      setInputValue(input(), "first\nlast");
      input().setSelectionRange(0, 3);
    });

    expect(key("ArrowUp").defaultPrevented).toBe(false);
    expect(input().value).toBe("first\nlast");

    act(() => input().setSelectionRange(2, 2));
    key("ArrowUp");
    act(() => input().setSelectionRange(12, 15));
    expect(key("ArrowDown").defaultPrevented).toBe(false);
    expect(input().value).toBe("historical\nentry");
  });

  it("keeps completion navigation and acceptance ahead of multiline history and submit", () => {
    let state = createDebugConsoleState(OWNER);
    state = reduceDebugConsoleState(state, {
      expression: "historical",
      owner: OWNER,
      requestId: "request-1",
      type: "evaluation-pending",
    });
    const debugConsole = consoleResult(state);
    const onAccept = vi.fn(() => ({ cursor: 5, expression: "count" }));
    render({ console: debugConsole, onAccept });
    act(() => setInputValue(input(), "first\nlast"));
    key(" ", { code: "Space", ctrlKey: true });

    expect(key("ArrowUp").defaultPrevented).toBe(true);
    expect(input().value).toBe("first\nlast");
    expect(key("ArrowDown").defaultPrevented).toBe(true);
    expect(input().value).toBe("first\nlast");
    expect(key("Enter").defaultPrevented).toBe(true);
    expect(onAccept).toHaveBeenCalledOnce();
    expect(debugConsole.submit).not.toHaveBeenCalled();
  });

  it("accepts a mouse choice without moving focus away from the input", async () => {
    const onAccept = vi.fn(() => ({ cursor: 5, expression: "count" }));
    render({ onAccept });
    act(() => input().focus());
    key(" ", { code: "Space", ctrlKey: true });
    const option = host.querySelectorAll<HTMLElement>('[role="option"]')[1]!;

    act(() => {
      option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      option.click();
    });
    await act(async () => Promise.resolve());

    expect(onAccept).toHaveBeenCalledWith(ITEMS[1], { cursor: 0, expression: "" });
    expect(input().value).toBe("count");
    expect(document.activeElement).toBe(input());
  });

  it("caps rendered options at one hundred while retaining model order", () => {
    const items = Array.from({ length: 140 }, (_, index) => ({
      id: `item-${index}`,
      label: `item ${index}`,
    }));
    render({ completionModel: completion({ items }) });
    key(" ", { code: "Space", ctrlKey: true });

    const options = host.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(100);
    expect(options[0]?.textContent).toBe("item 0");
    expect(options[99]?.textContent).toBe("item 99");
    expect(host.textContent).not.toContain("item 100");
  });

  it("announces incomplete capped suggestions without rendering beyond the cap", () => {
    const items = Array.from({ length: 100 }, (_, index) => ({
      id: `item-${index}`,
      label: `item ${index}`,
    }));
    render({ completionModel: completion({ incomplete: true, items }) });
    key(" ", { code: "Space", ctrlKey: true });

    expect(host.querySelectorAll('[role="option"]')).toHaveLength(100);
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "More suggestions available — keep typing.",
    );
  });

  it.each(["ArrowLeft", "ArrowRight", "Home", "End"])(
    "dismisses stale suggestions when %s moves the caret",
    (caretKey) => {
      const onDismiss = vi.fn();
      render({ onDismiss });
      key(" ", { code: "Space", ctrlKey: true });

      const event = key(caretKey);

      expect(event.defaultPrevented).toBe(false);
      expect(onDismiss).toHaveBeenCalledOnce();
      expect(input().getAttribute("aria-expanded")).toBe("false");
    },
  );

  it("invalidates a pending closed-popup request when the caret moves", () => {
    const onDismiss = vi.fn();
    render({
      completionModel: completion({ items: [], pending: false }),
      onDismiss,
    });

    key("ArrowLeft");
    act(() => input().dispatchEvent(new MouseEvent("mouseup", { bubbles: true })));

    expect(onDismiss).toHaveBeenCalledTimes(2);
    expect(input().getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps completion status outside the listbox ownership tree", () => {
    render({ completionModel: completion({ incomplete: true }) });
    key(" ", { code: "Space", ctrlKey: true });

    const status = host.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.parentElement?.getAttribute("role")).not.toBe("listbox");
    expect(input().getAttribute("aria-describedby")).toContain(status?.id);
  });

  it("dismisses when acceptance rejects a stale replacement", () => {
    const onAccept = vi.fn(() => null);
    const onDismiss = vi.fn();
    render({ onAccept, onDismiss });
    key(" ", { code: "Space", ctrlKey: true });

    const event = key("Enter");

    expect(event.defaultPrevented).toBe(true);
    expect(onAccept).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(input().getAttribute("aria-expanded")).toBe("false");
  });
});
