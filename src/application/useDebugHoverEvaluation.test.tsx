// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { DebugEvaluationResult } from "../domain/debugEvaluationPolicy";
import type { DebugInspectionOwner } from "../domain/debugVariablePages";
import type { DebugCopyEvaluatePathTarget } from "./useDebugCopyValueComposition";
import {
  useDebugHoverEvaluation,
  type DebugHoverEvaluationPort,
  type UseDebugHoverEvaluationOptions,
} from "./useDebugHoverEvaluation";

const owner: DebugInspectionOwner = {
  rootKey: "/workspace",
  sessionId: 4,
  pauseGeneration: 2,
  frameId: 11,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, deny) => {
    resolve = accept;
    reject = deny;
  });
  return { promise, reject, resolve };
}

function renderHook(initialOptions: UseDebugHoverEvaluationOptions) {
  const host = document.createElement("div");
  const root = createRoot(host);
  const captured: { value: DebugHoverEvaluationPort | null } = { value: null };
  let options = initialOptions;

  function Harness() {
    captured.value = useDebugHoverEvaluation(options);
    return null;
  }

  const render = () => act(() => root.render(<Harness />));
  render();
  return {
    port: () => captured.value as DebugHoverEvaluationPort,
    set: (next: Partial<UseDebugHoverEvaluationOptions>) => {
      options = { ...options, ...next };
      render();
    },
    unmount: () => act(() => root.unmount()),
  };
}

describe("useDebugHoverEvaluation", () => {
  it("delegates an exact owned request to the canonical Watch evaluator", async () => {
    const expected: DebugEvaluationResult = {
      status: "ok",
      value: "  bounded upstream  ",
      type: "string",
      variablesReference: 9,
    };
    const evaluateWatch = vi.fn().mockResolvedValue(expected);
    const ui = renderHook({
      debugAdapterKind: "node",
      evaluateWatch,
      inspectionOwner: owner,
    });

    const port = ui.port();
    expect(port.getOwner()).toEqual(owner);
    expect(port.getOwnerEpoch()).toBe(1);
    await expect(port.evaluate(owner, "  value.member  ")).resolves.toBe(expected);
    expect(evaluateWatch).toHaveBeenCalledWith("  value.member  ");
    ui.unmount();
  });

  it("keeps one stable port identity across option updates", () => {
    const ui = renderHook({
      debugAdapterKind: "node",
      evaluateWatch: vi.fn(),
      inspectionOwner: owner,
    });
    const port = ui.port();
    ui.set({ evaluateWatch: vi.fn(), inspectionOwner: { ...owner } });
    expect(ui.port()).toBe(port);
    expect(port.getOwner()).toEqual(owner);
    ui.unmount();
  });

  it("exposes a monotonic activation epoch across an owner A-B-A transition", () => {
    const ui = renderHook({
      debugAdapterKind: "node",
      evaluateWatch: vi.fn(),
      inspectionOwner: owner,
    });
    const port = ui.port();
    const firstEpoch = port.getOwnerEpoch();
    ui.set({ inspectionOwner: { ...owner, sessionId: 5 } });
    const secondEpoch = port.getOwnerEpoch();
    ui.set({ inspectionOwner: owner });

    expect(secondEpoch).toBeGreaterThan(firstEpoch);
    expect(port.getOwnerEpoch()).toBeGreaterThan(secondEpoch);
    ui.unmount();
    expect(port.getOwnerEpoch()).toBe(-1);
  });

  it("forwards an AbortSignal to the physical evaluator", async () => {
    const pending = deferred<DebugEvaluationResult | null>();
    const evaluateWatch = vi.fn().mockReturnValue(pending.promise);
    const ui = renderHook({
      debugAdapterKind: "node",
      evaluateWatch,
      inspectionOwner: owner,
    });
    const cancellation = new AbortController();

    const evaluation = ui.port().evaluate(owner, "value", cancellation.signal);
    await Promise.resolve();
    cancellation.abort();

    expect(evaluateWatch).toHaveBeenCalledWith("value", cancellation.signal);
    pending.resolve({ status: "ok", value: "late" });
    await expect(evaluation).resolves.toBeNull();
    ui.unmount();
  });

  it("drops trust and adapter A-null-A results with the same inspection owner", async () => {
    let trusted = true;
    const trustPending = deferred<DebugEvaluationResult | null>();
    const adapterPending = deferred<DebugEvaluationResult | null>();
    const evaluateWatch = vi
      .fn()
      .mockReturnValueOnce(trustPending.promise)
      .mockReturnValueOnce(adapterPending.promise);
    const ui = renderHook({
      debugAdapterKind: "node",
      evaluateWatch,
      inspectionOwner: owner,
      isWorkspaceTrusted: () => trusted,
    });

    const trustEvaluation = ui.port().evaluate(owner, "trust");
    trusted = false;
    ui.set({});
    trusted = true;
    ui.set({});
    trustPending.resolve({ status: "ok", value: "stale" });
    await expect(trustEvaluation).resolves.toBeNull();

    const adapterEvaluation = ui.port().evaluate(owner, "adapter");
    ui.set({ debugAdapterKind: "php" });
    ui.set({ debugAdapterKind: "node" });
    adapterPending.resolve({ status: "ok", value: "stale" });
    await expect(adapterEvaluation).resolves.toBeNull();
    ui.unmount();
  });

  it.each([
    ["root", { rootKey: "/other" }],
    ["session", { sessionId: 5 }],
    ["pause", { pauseGeneration: 3 }],
    ["frame", { frameId: 12 }],
  ])("does not evaluate a request with a stale %s owner", async (_label, ownerChange) => {
    const evaluateWatch = vi.fn();
    const ui = renderHook({
      debugAdapterKind: "node",
      evaluateWatch,
      inspectionOwner: { ...owner, ...ownerChange },
    });

    await expect(ui.port().evaluate(owner, "value")).resolves.toBeNull();
    expect(evaluateWatch).not.toHaveBeenCalled();
    ui.unmount();
  });

  it.each([
    ["root", { rootKey: "/other" }],
    ["session", { sessionId: 5 }],
    ["pause", { pauseGeneration: 3 }],
    ["frame", { frameId: 12 }],
  ])("drops a late result after the %s owner changes", async (_label, ownerChange) => {
    const pending = deferred<DebugEvaluationResult | null>();
    const evaluateWatch = vi.fn().mockReturnValue(pending.promise);
    const ui = renderHook({
      debugAdapterKind: "node",
      evaluateWatch,
      inspectionOwner: owner,
    });
    const evaluation = ui.port().evaluate(owner, "value");

    ui.set({ inspectionOwner: { ...owner, ...ownerChange } });
    pending.resolve({ status: "ok", value: "stale" });

    await expect(evaluation).resolves.toBeNull();
    ui.unmount();
  });

  it("rejects evaluation after resume, trust loss, or on a PHP adapter", async () => {
    const evaluateWatch = vi.fn().mockResolvedValue({ status: "ok", value: "unexpected" });
    let trusted = true;
    const ui = renderHook({
      debugAdapterKind: "node",
      evaluateWatch,
      inspectionOwner: owner,
      isWorkspaceTrusted: () => trusted,
    });

    ui.set({ inspectionOwner: null });
    await expect(ui.port().evaluate(owner, "onResume")).resolves.toBeNull();
    ui.set({ inspectionOwner: owner });
    trusted = false;
    await expect(ui.port().evaluate(owner, "afterTrustLoss")).resolves.toBeNull();
    trusted = true;
    ui.set({ debugAdapterKind: "php" });
    await expect(ui.port().evaluate(owner, "onPhp")).resolves.toBeNull();

    expect(evaluateWatch).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("drops an aborted or unmounted late result", async () => {
    const pending = deferred<DebugEvaluationResult | null>();
    const evaluateWatch = vi.fn().mockReturnValue(pending.promise);
    const ui = renderHook({
      debugAdapterKind: "node",
      evaluateWatch,
      inspectionOwner: owner,
    });
    const cancellation = new AbortController();
    cancellation.abort();
    await expect(ui.port().evaluate(owner, "cancelled", cancellation.signal)).resolves.toBeNull();

    const evaluation = ui.port().evaluate(owner, "late");
    ui.unmount();
    pending.resolve({ status: "ok", value: "stale" });
    await expect(evaluation).resolves.toBeNull();
    expect(evaluateWatch).toHaveBeenCalledOnce();
  });

  it("suppresses stale failures but preserves current evaluator failures", async () => {
    const pending = deferred<DebugEvaluationResult | null>();
    const evaluateWatch = vi.fn().mockReturnValueOnce(pending.promise);
    const ui = renderHook({
      debugAdapterKind: "node",
      evaluateWatch,
      inspectionOwner: owner,
    });
    const staleEvaluation = ui.port().evaluate(owner, "stale");
    ui.set({ inspectionOwner: null });
    pending.reject(new Error("late failure"));
    await expect(staleEvaluation).resolves.toBeNull();

    const failure = new Error("canonical failure");
    evaluateWatch.mockRejectedValueOnce(failure);
    ui.set({ inspectionOwner: owner });
    await expect(ui.port().evaluate(owner, "current")).rejects.toBe(failure);
    ui.unmount();
  });

  it("drops pending results after cancellation, trust loss, adapter change, or evaluator swap", async () => {
    let trusted = true;
    const pending = Array.from({ length: 4 }, () => deferred<DebugEvaluationResult | null>());
    const evaluateWatch = vi.fn();
    pending.forEach((request) => evaluateWatch.mockReturnValueOnce(request.promise));
    const ui = renderHook({
      debugAdapterKind: "node",
      evaluateWatch,
      inspectionOwner: owner,
      isWorkspaceTrusted: () => trusted,
    });

    const token = { isCancellationRequested: false };
    const cancelled = ui.port().evaluate(owner, "cancelled", token);
    token.isCancellationRequested = true;
    pending[0]!.resolve({ status: "ok", value: "stale" });
    await expect(cancelled).resolves.toBeNull();

    const untrusted = ui.port().evaluate(owner, "untrusted");
    trusted = false;
    pending[1]!.resolve({ status: "ok", value: "stale" });
    await expect(untrusted).resolves.toBeNull();
    trusted = true;

    const wrongAdapter = ui.port().evaluate(owner, "adapter");
    ui.set({ debugAdapterKind: "php" });
    pending[2]!.resolve({ status: "ok", value: "stale" });
    await expect(wrongAdapter).resolves.toBeNull();
    ui.set({ debugAdapterKind: "node" });

    const replaced = ui.port().evaluate(owner, "replacement");
    ui.set({ evaluateWatch: vi.fn() });
    pending[3]!.resolve({ status: "ok", value: "stale" });
    await expect(replaced).resolves.toBeNull();
    ui.unmount();
  });

  it("uses opaque one-shot copy tokens and forwards only the immutable official path", async () => {
    const copyEvaluatePathOnce = vi.fn<(target: DebugCopyEvaluatePathTarget) => Promise<boolean>>(
      async () => true,
    );
    const result = { status: "ok", value: "Ada", evaluateName: "users[0].name" } as const;
    const ui = renderHook({
      copyEvaluatePathOnce,
      debugAdapterKind: "node",
      evaluateWatch: vi.fn(async () => result),
      inspectionOwner: owner,
    });
    const isCurrent = vi.fn(() => true);
    expect(
      ui
        .port()
        .registerCopyEvaluatePath(
          owner,
          { status: "ok", value: "forged", evaluateName: "forged.path" },
          isCurrent,
        ),
    ).toBeNull();
    const official = await ui.port().evaluate(owner, "user.name");
    const token = ui.port().registerCopyEvaluatePath(owner, official!, isCurrent);

    expect(token).toMatch(/^[0-9a-f]{36}$/u);
    await expect(ui.port().copyEvaluatePath("forged")).resolves.toBe(false);
    await expect(ui.port().copyEvaluatePath(token)).resolves.toBe(true);
    await expect(ui.port().copyEvaluatePath(token)).resolves.toBe(false);
    expect(copyEvaluatePathOnce).toHaveBeenCalledOnce();
    expect(copyEvaluatePathOnce.mock.calls[0]![0]).toMatchObject({
      evaluateName: "users[0].name",
      owner,
    });
    expect(copyEvaluatePathOnce.mock.calls[0]![0].isCurrent).toBe(isCurrent);
    ui.unmount();
  });

  it("invalidates tokens across owner A to B to A, stale model predicates, and disposal", async () => {
    const copyEvaluatePathOnce = vi.fn(async () => true);
    const results = ["owner.path", "model.path", "disposed.path"].map(
      (evaluateName) => ({ status: "ok", value: "value", evaluateName }) as const,
    );
    const evaluateWatch = vi.fn();
    results.forEach((result) => evaluateWatch.mockResolvedValueOnce(result));
    const ui = renderHook({
      copyEvaluatePathOnce,
      debugAdapterKind: "node",
      evaluateWatch,
      inspectionOwner: owner,
    });
    const ownerResult = await ui.port().evaluate(owner, "owner");
    const ownerToken = ui.port().registerCopyEvaluatePath(owner, ownerResult!, () => true);
    ui.set({ inspectionOwner: { ...owner, frameId: 12 } });
    ui.set({ inspectionOwner: owner });
    await expect(ui.port().copyEvaluatePath(ownerToken)).resolves.toBe(false);

    const modelResult = await ui.port().evaluate(owner, "model");
    const modelToken = ui.port().registerCopyEvaluatePath(owner, modelResult!, () => false);
    expect(modelToken).toBeNull();
    const disposedResult = await ui.port().evaluate(owner, "disposed");
    const disposedToken = ui.port().registerCopyEvaluatePath(owner, disposedResult!, () => true);
    const retained = ui.port();
    ui.unmount();
    await expect(retained.copyEvaluatePath(disposedToken)).resolves.toBe(false);
    expect(copyEvaluatePathOnce).not.toHaveBeenCalled();
  });

  it("consumes a failed token but permits a fresh-token retry", async () => {
    const copyEvaluatePathOnce = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const evaluateWatch = vi.fn(async () => ({
      status: "ok" as const,
      value: "value",
      evaluateName: "exact.path",
    }));
    const ui = renderHook({
      copyEvaluatePathOnce,
      debugAdapterKind: "node",
      evaluateWatch,
      inspectionOwner: owner,
    });
    const firstResult = await ui.port().evaluate(owner, "first");
    const first = ui.port().registerCopyEvaluatePath(owner, firstResult!, () => true);
    await expect(ui.port().copyEvaluatePath(first)).resolves.toBe(false);
    await expect(ui.port().copyEvaluatePath(first)).resolves.toBe(false);
    const retryResult = await ui.port().evaluate(owner, "retry");
    const retry = ui.port().registerCopyEvaluatePath(owner, retryResult!, () => true);
    await expect(ui.port().copyEvaluatePath(retry)).resolves.toBe(true);
    expect(copyEvaluatePathOnce).toHaveBeenCalledTimes(2);
    ui.unmount();
  });
});
