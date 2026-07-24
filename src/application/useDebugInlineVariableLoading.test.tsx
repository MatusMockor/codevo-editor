// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { DebugScope } from "../domain/debug";
import {
  createDebugVariablePagesState,
  reduceDebugVariablePages,
  type DebugInspectionOwner,
  type DebugVariablePagesState,
} from "../domain/debugVariablePages";
import {
  planDebugInlineVariableLoading,
  useDebugInlineVariableLoading,
  type DebugInlineVariableLoadingOptions,
} from "./useDebugInlineVariableLoading";

const owner: DebugInspectionOwner = {
  rootKey: "/workspace",
  sessionId: 4,
  pauseGeneration: 2,
  frameId: 11,
};

const scopes: DebugScope[] = [
  { name: "Locals", variablesReference: 21, expensive: false },
  { name: "Duplicate locals", variablesReference: 21, expensive: false },
  { name: "Globals", variablesReference: 22, expensive: false },
  { name: "Closure", variablesReference: 23, expensive: false },
  { name: "Expensive", variablesReference: 24, expensive: true },
];

function options(
  overrides: Partial<DebugInlineVariableLoadingOptions> = {},
): DebugInlineVariableLoadingOptions {
  return {
    debugAdapterKind: "node",
    inspectionOwner: owner,
    isWorkspaceTrusted: true,
    loadVariablePage: vi.fn(async () => undefined),
    scopes,
    selectedFrameId: owner.frameId,
    selectFrame: vi.fn(async () => undefined),
    variablePages: createDebugVariablePagesState(owner),
    ...overrides,
  };
}

function renderHook(initial: DebugInlineVariableLoadingOptions) {
  const host = document.createElement("div");
  const root = createRoot(host);
  let props = initial;
  function Harness() {
    useDebugInlineVariableLoading(props);
    return null;
  }
  const render = () => act(() => root.render(<Harness />));
  render();
  return {
    set(next: Partial<DebugInlineVariableLoadingOptions>) {
      props = { ...props, ...next };
      render();
    },
    unmount() {
      act(() => root.unmount());
    },
  };
}

function withPageState(
  pageOwner: DebugInspectionOwner,
  cachedReference: number,
  pendingReference: number,
): DebugVariablePagesState {
  let state = createDebugVariablePagesState(pageOwner);
  state = reduceDebugVariablePages(state, {
    type: "request",
    owner: pageOwner,
    variablesReference: cachedReference,
    start: 0,
    requestId: "cached-request",
  });
  state = reduceDebugVariablePages(state, {
    type: "resolve",
    owner: pageOwner,
    variablesReference: cachedReference,
    start: 0,
    requestId: "cached-request",
    result: {
      variablesReference: cachedReference,
      start: 0,
      variables: [{ name: "value", value: "1", variablesReference: 0 }],
      nextStart: null,
    },
  });
  return reduceDebugVariablePages(state, {
    type: "request",
    owner: pageOwner,
    variablesReference: pendingReference,
    start: 0,
    requestId: "pending-request",
  });
}

describe("planDebugInlineVariableLoading", () => {
  it("selects the exact paused frame before planning root page loads", () => {
    expect(
      planDebugInlineVariableLoading({
        ...options(),
        enabled: true,
        selectedFrameId: null,
      }),
    ).toEqual({ kind: "select-frame", frameId: 11 });
  });

  it("bounds loading to the first two distinct non-expensive root scopes", () => {
    expect(planDebugInlineVariableLoading({ ...options(), enabled: true })).toEqual({
      kind: "load-page-zero",
      variableReferences: [21, 22],
    });
  });

  it("skips cached and pending roots without substituting a third scope", () => {
    expect(
      planDebugInlineVariableLoading({
        ...options({ variablePages: withPageState(owner, 21, 22) }),
        enabled: true,
      }),
    ).toEqual({ kind: "ready" });
  });

  it("fails closed for non-Node, untrusted, ownerless, and stale page state", () => {
    expect(
      planDebugInlineVariableLoading({ ...options({ debugAdapterKind: "php" }), enabled: true }),
    ).toEqual({ kind: "disabled" });
    expect(planDebugInlineVariableLoading({ ...options(), enabled: false })).toEqual({
      kind: "disabled",
    });
    expect(
      planDebugInlineVariableLoading({ ...options({ inspectionOwner: null }), enabled: true }),
    ).toEqual({ kind: "disabled" });
    expect(
      planDebugInlineVariableLoading({
        ...options({ variablePages: createDebugVariablePagesState({ ...owner, sessionId: 5 }) }),
        enabled: true,
      }),
    ).toEqual({ kind: "ready" });
  });
});

describe("useDebugInlineVariableLoading", () => {
  it("selects once per owner, then loads page zero for at most two roots once", () => {
    const selectFrame = vi.fn(async () => undefined);
    const loadVariablePage = vi.fn(async () => undefined);
    const ui = renderHook(options({ selectFrame, loadVariablePage, selectedFrameId: null }));

    expect(selectFrame).toHaveBeenCalledTimes(1);
    expect(selectFrame).toHaveBeenCalledWith(11);
    ui.set({ selectedFrameId: null, scopes: [...scopes] });
    expect(selectFrame).toHaveBeenCalledTimes(1);

    ui.set({ selectedFrameId: 11 });
    expect(loadVariablePage.mock.calls).toEqual([
      [owner, 21, 0],
      [owner, 22, 0],
    ]);
    ui.set({ scopes: [...scopes] });
    expect(loadVariablePage).toHaveBeenCalledTimes(2);
    ui.unmount();
  });

  it("resets its bounded requests for a new exact pause owner", () => {
    const loadVariablePage = vi.fn(async () => undefined);
    const ui = renderHook(options({ loadVariablePage }));
    const nextOwner = { ...owner, pauseGeneration: 3 };

    ui.set({
      inspectionOwner: nextOwner,
      selectedFrameId: nextOwner.frameId,
      variablePages: createDebugVariablePagesState(nextOwner),
    });

    expect(loadVariablePage.mock.calls).toEqual([
      [owner, 21, 0],
      [owner, 22, 0],
      [nextOwner, 21, 0],
      [nextOwner, 22, 0],
    ]);
    ui.unmount();
  });

  it("does not invoke gateways when adapter, trust, or ownership guards fail", () => {
    const loadVariablePage = vi.fn(async () => undefined);
    const selectFrame = vi.fn(async () => undefined);
    const ui = renderHook(
      options({
        isWorkspaceTrusted: false,
        loadVariablePage,
        selectFrame,
      }),
    );
    expect(loadVariablePage).not.toHaveBeenCalled();
    expect(selectFrame).not.toHaveBeenCalled();

    ui.set({ isWorkspaceTrusted: true, debugAdapterKind: "php" });
    expect(loadVariablePage).not.toHaveBeenCalled();
    ui.set({
      debugAdapterKind: "node",
      variablePages: createDebugVariablePagesState({ ...owner, frameId: 12 }),
    });
    expect(loadVariablePage).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("starts loading when trust is restored for the same pause owner", () => {
    const loadVariablePage = vi.fn(async () => undefined);
    const ui = renderHook(options({ isWorkspaceTrusted: false, loadVariablePage }));
    expect(loadVariablePage).not.toHaveBeenCalled();

    ui.set({ isWorkspaceTrusted: true });

    expect(loadVariablePage.mock.calls).toEqual([
      [owner, 21, 0],
      [owner, 22, 0],
    ]);
    ui.unmount();
  });

  it("retries a global-cap no-op with delay and a strict attempt bound", async () => {
    vi.useFakeTimers();
    const loadVariablePage = vi.fn(async () => undefined);
    const ui = renderHook(options({ loadVariablePage }));
    expect(loadVariablePage).toHaveBeenCalledTimes(2);
    await act(async () => Promise.resolve());

    await act(async () => vi.advanceTimersByTimeAsync(49));
    expect(loadVariablePage).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(loadVariablePage).toHaveBeenCalledTimes(4);
    await act(async () => vi.advanceTimersByTimeAsync(50));
    expect(loadVariablePage).toHaveBeenCalledTimes(6);
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(loadVariablePage).toHaveBeenCalledTimes(6);
    ui.unmount();
    vi.useRealTimers();
  });

  it("cancels delayed no-op retries on unmount", async () => {
    vi.useFakeTimers();
    const loadVariablePage = vi.fn(async () => undefined);
    const ui = renderHook(options({ loadVariablePage }));
    await act(async () => Promise.resolve());
    ui.unmount();

    await vi.advanceTimersByTimeAsync(1_000);

    expect(loadVariablePage).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
