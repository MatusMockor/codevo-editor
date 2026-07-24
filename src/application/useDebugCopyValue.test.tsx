// @vitest-environment jsdom

import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { DebugEvaluationResult } from "../domain/debugEvaluationPolicy";
import type { TextClipboardGateway } from "../domain/textClipboard";
import type { DebugCopyValueCandidate, DebugCopyValueCandidateReader } from "./debugCopyValue";
import {
  useDebugCopyValue,
  type DebugCopyValueCommands,
  type UseDebugCopyValueOptions,
} from "./useDebugCopyValue";

const candidate: DebugCopyValueCandidate = {
  source: "variables",
  identity: "variable:scope-1:user",
  rootKey: "/workspace",
  workspaceOwnerKey: "owner-a",
  sessionId: 7,
  pauseGeneration: 3,
  frameId: 11,
  generation: 5,
  epoch: 9,
  evaluateName: 'root["user"]',
  displayedValue: "User {…}",
};

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, reject, resolve };
}

function renderHook(overrides: Partial<UseDebugCopyValueOptions> = {}, strictMode = false) {
  const host = document.createElement("div");
  const root = createRoot(host);
  let currentCandidate: unknown = candidate;
  const candidateReader: DebugCopyValueCandidateReader = {
    readDebugCopyValueCandidate: vi.fn(() => currentCandidate),
  };
  const writeText = vi.fn().mockResolvedValue(undefined);
  const clipboard: TextClipboardGateway = { canWriteText: () => true, writeText };
  const evaluateClipboard = vi.fn().mockResolvedValue({ status: "ok", value: "resolved" });
  const isCandidateCurrent = vi.fn(() => true);
  let props: UseDebugCopyValueOptions = {
    candidateReader,
    clipboard,
    evaluateClipboard,
    isCandidateCurrent,
    ...overrides,
  };
  let commands: DebugCopyValueCommands | null = null;
  function Harness() {
    commands = useDebugCopyValue(props);
    return null;
  }
  const render = () =>
    act(() =>
      root.render(
        strictMode ? (
          <StrictMode>
            <Harness />
          </StrictMode>
        ) : (
          <Harness />
        ),
      ),
    );
  render();
  return {
    candidateReader,
    clipboard,
    evaluateClipboard,
    hook: () => commands as unknown as DebugCopyValueCommands,
    isCandidateCurrent,
    setCandidate: (value: unknown) => {
      currentCandidate = value;
    },
    setOptions: (next: Partial<UseDebugCopyValueOptions>) => {
      props = { ...props, ...next };
      render();
    },
    unmount: () => act(() => root.unmount()),
    writeText,
  };
}

describe("useDebugCopyValue", () => {
  it("double-captures and evaluates the exact evaluateName before copying the returned value", async () => {
    const ui = renderHook();
    await act(async () => {
      await expect(ui.hook().copyValue()).resolves.toBe(true);
    });
    expect(ui.evaluateClipboard).toHaveBeenCalledExactlyOnceWith('root["user"]');
    expect(ui.writeText).toHaveBeenCalledExactlyOnceWith("resolved");
    expect(ui.candidateReader.readDebugCopyValueCandidate).toHaveBeenCalledTimes(6);
    ui.unmount();
  });

  it("uses the displayed value as the exact expression when evaluateName is omitted", async () => {
    const ui = renderHook();
    ui.setCandidate({ ...candidate, evaluateName: undefined, displayedValue: "  raw value  " });
    await act(async () => void (await ui.hook().copyValue()));
    expect(ui.evaluateClipboard).toHaveBeenCalledWith("  raw value  ");
    expect(ui.writeText).toHaveBeenCalledWith("resolved");
    ui.unmount();
  });

  it("copies the immutable displayed fallback only for a structured adapter error", async () => {
    const ui = renderHook({
      evaluateClipboard: vi.fn().mockResolvedValue({
        status: "error",
        kind: "exception",
        message: "Getter failed.",
      }),
    });
    const invocation = ui.hook().copyValue();
    ui.setCandidate({ ...candidate, displayedValue: "mutated after capture" });
    await act(async () => {
      await expect(invocation).resolves.toBe(false);
    });
    expect(ui.writeText).not.toHaveBeenCalled();

    ui.setCandidate(candidate);
    await act(async () => {
      await expect(ui.hook().copyValue()).resolves.toBe(true);
    });
    expect(ui.writeText).toHaveBeenCalledExactlyOnceWith("User {…}");
    ui.unmount();
  });

  it("fails closed for null/stale evaluation without falling back", async () => {
    const evaluateClipboard = vi.fn().mockResolvedValue(null);
    const ui = renderHook({ evaluateClipboard });
    await act(async () => {
      await expect(ui.hook().copyValue()).resolves.toBe(false);
    });
    expect(ui.writeText).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("rejects every initial owner, identity, generation, epoch, expression, and value drift", async () => {
    const variants: DebugCopyValueCandidate[] = [
      { ...candidate, source: "watch" },
      { ...candidate, identity: "watch:user" },
      { ...candidate, rootKey: "/other" },
      { ...candidate, workspaceOwnerKey: "owner-b" },
      { ...candidate, sessionId: 8 },
      { ...candidate, pauseGeneration: 4 },
      { ...candidate, frameId: 12 },
      { ...candidate, generation: 6 },
      { ...candidate, epoch: 10 },
      { ...candidate, evaluateName: "user" },
      { ...candidate, displayedValue: "changed" },
    ];
    for (const variant of variants) {
      const captures = [candidate, variant];
      const ui = renderHook({
        candidateReader: {
          readDebugCopyValueCandidate: () => captures.shift() ?? candidate,
        },
      });
      await expect(ui.hook().copyValue()).resolves.toBe(false);
      expect(ui.evaluateClipboard).not.toHaveBeenCalled();
      expect(ui.writeText).not.toHaveBeenCalled();
      ui.unmount();
    }
  });

  it("rejects candidate drift and A to B to A owner epochs after evaluation", async () => {
    for (const changed of [
      { ...candidate, identity: "variable:other" },
      { ...candidate, workspaceOwnerKey: "owner-a", epoch: 11 },
    ]) {
      const evaluation = deferred<DebugEvaluationResult | null>();
      const ui = renderHook({ evaluateClipboard: () => evaluation.promise });
      const invocation = ui.hook().copyValue();
      ui.setCandidate({ ...candidate, workspaceOwnerKey: "owner-b", epoch: 10 });
      ui.setCandidate(changed);
      await act(async () => {
        evaluation.resolve({ status: "ok", value: "resolved" });
        await expect(invocation).resolves.toBe(false);
      });
      expect(ui.writeText).not.toHaveBeenCalled();
      ui.unmount();
    }
  });

  it("rechecks external owner admission before and after evaluation", async () => {
    let current = true;
    const evaluation = deferred<DebugEvaluationResult | null>();
    const ui = renderHook({
      evaluateClipboard: () => evaluation.promise,
      isCandidateCurrent: () => current,
    });
    expect(ui.hook().canCopyValue()).toBe(true);
    const invocation = ui.hook().copyValue();
    current = false;
    await act(async () => {
      evaluation.resolve({ status: "error", kind: "exception", message: "failed" });
      await expect(invocation).resolves.toBe(false);
    });
    expect(ui.writeText).not.toHaveBeenCalled();
    expect(ui.hook().canCopyValue()).toBe(false);
    ui.unmount();
  });

  it("fails closed when the injected evaluator or clipboard changes mid-flight", async () => {
    const evaluation = deferred<DebugEvaluationResult | null>();
    const ui = renderHook({ evaluateClipboard: () => evaluation.promise });
    const invocation = ui.hook().copyValue();
    const replacementWrite = vi.fn().mockResolvedValue(undefined);
    ui.setOptions({
      clipboard: { canWriteText: () => true, writeText: replacementWrite },
      evaluateClipboard: vi.fn().mockResolvedValue({ status: "ok", value: "replacement" }),
    });
    await act(async () => {
      evaluation.resolve({ status: "ok", value: "stale" });
      await expect(invocation).resolves.toBe(false);
    });
    expect(ui.writeText).not.toHaveBeenCalled();
    expect(replacementWrite).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("keeps one global flight through evaluation and clipboard completion", async () => {
    const evaluation = deferred<DebugEvaluationResult | null>();
    const writing = deferred<void>();
    const ui = renderHook({
      evaluateClipboard: () => evaluation.promise,
      clipboard: { canWriteText: () => true, writeText: () => writing.promise },
    });
    const first = ui.hook().copyValue();
    await expect(ui.hook().copyValue()).resolves.toBe(false);
    expect(ui.hook().canCopyValue()).toBe(false);
    evaluation.resolve({ status: "ok", value: "resolved" });
    await act(async () => void (await Promise.resolve()));
    expect(ui.hook().canCopyValue()).toBe(false);
    writing.resolve();
    await act(async () => {
      await expect(first).resolves.toBe(true);
    });
    expect(ui.hook().canCopyValue()).toBe(true);
    ui.unmount();
  });

  it("rechecks candidate and capability around an in-flight clipboard write", async () => {
    const writing = deferred<void>();
    let capability = true;
    const writeText = vi.fn(() => writing.promise);
    const ui = renderHook({
      clipboard: { canWriteText: () => capability, writeText },
    });
    const invocation = ui.hook().copyValue();
    await act(async () => void (await Promise.resolve()));
    expect(writeText).toHaveBeenCalledOnce();
    ui.setCandidate({ ...candidate, generation: 6 });
    capability = false;
    writing.resolve();
    await act(async () => {
      await expect(invocation).resolves.toBe(false);
    });
    expect(ui.hook().canCopyValue()).toBe(false);
    ui.unmount();
  });

  it("does not write when unmounted before evaluation settles", async () => {
    const evaluation = deferred<DebugEvaluationResult | null>();
    const ui = renderHook({ evaluateClipboard: () => evaluation.promise });
    const invocation = ui.hook().copyValue();

    ui.unmount();
    evaluation.resolve({ status: "ok", value: "resolved" });

    await expect(invocation).resolves.toBe(false);
    expect(ui.writeText).not.toHaveBeenCalled();
    await expect(ui.hook().copyValue()).resolves.toBe(false);
  });

  it("settles false without further work when unmounted during the clipboard write", async () => {
    const writing = deferred<void>();
    const canWriteText = vi.fn(() => true);
    const writeText = vi.fn(() => writing.promise);
    const ui = renderHook({ clipboard: { canWriteText, writeText } });
    const invocation = ui.hook().copyValue();
    await act(async () => void (await Promise.resolve()));
    expect(writeText).toHaveBeenCalledExactlyOnceWith("resolved");
    const capabilityChecksBeforeUnmount = canWriteText.mock.calls.length;

    ui.unmount();
    writing.resolve();

    await expect(invocation).resolves.toBe(false);
    expect(writeText).toHaveBeenCalledOnce();
    expect(canWriteText).toHaveBeenCalledTimes(capabilityChecksBeforeUnmount);
    await expect(ui.hook().copyValue()).resolves.toBe(false);
  });

  it("stops immediately when capability, reader, or currentness synchronously unmounts", async () => {
    let disposeCapability: () => void = () => undefined;
    const capabilityReader = vi.fn(() => candidate);
    const capabilityEvaluator = vi.fn();
    const capability = renderHook({
      candidateReader: { readDebugCopyValueCandidate: capabilityReader },
      clipboard: {
        canWriteText: () => {
          disposeCapability();
          return true;
        },
        writeText: vi.fn(),
      },
      evaluateClipboard: capabilityEvaluator,
    });
    disposeCapability = capability.unmount;
    await expect(capability.hook().copyValue()).resolves.toBe(false);
    expect(capabilityReader).not.toHaveBeenCalled();
    expect(capabilityEvaluator).not.toHaveBeenCalled();

    let disposeReader: () => void = () => undefined;
    const readerCurrent = vi.fn(() => true);
    const readerEvaluator = vi.fn();
    const reader = renderHook({
      candidateReader: {
        readDebugCopyValueCandidate: () => {
          disposeReader();
          return candidate;
        },
      },
      evaluateClipboard: readerEvaluator,
      isCandidateCurrent: readerCurrent,
    });
    disposeReader = reader.unmount;
    await expect(reader.hook().copyValue()).resolves.toBe(false);
    expect(readerCurrent).not.toHaveBeenCalled();
    expect(readerEvaluator).not.toHaveBeenCalled();

    let disposeCurrent: () => void = () => undefined;
    const currentEvaluator = vi.fn();
    const current = renderHook({
      evaluateClipboard: currentEvaluator,
      isCandidateCurrent: () => {
        disposeCurrent();
        return true;
      },
    });
    disposeCurrent = current.unmount;
    await expect(current.hook().copyValue()).resolves.toBe(false);
    expect(currentEvaluator).not.toHaveBeenCalled();
  });

  it("does not evaluate when the final pre-evaluation reader synchronously unmounts", async () => {
    let dispose: () => void = () => undefined;
    let reads = 0;
    const evaluateClipboard = vi.fn();
    const ui = renderHook({
      candidateReader: {
        readDebugCopyValueCandidate: () => {
          reads += 1;
          if (reads === 3) dispose();
          return candidate;
        },
      },
      evaluateClipboard,
    });
    dispose = ui.unmount;

    await expect(ui.hook().copyValue()).resolves.toBe(false);
    expect(reads).toBe(3);
    expect(evaluateClipboard).not.toHaveBeenCalled();
  });

  it("does no later external work when evaluation or write synchronously unmounts", async () => {
    let disposeEvaluation: () => void = () => undefined;
    const evaluationWrite = vi.fn();
    const evaluation = renderHook({
      clipboard: { canWriteText: () => true, writeText: evaluationWrite },
      evaluateClipboard: () => {
        disposeEvaluation();
        return Promise.resolve({ status: "ok", value: "resolved" });
      },
    });
    disposeEvaluation = evaluation.unmount;
    await expect(evaluation.hook().copyValue()).resolves.toBe(false);
    expect(evaluationWrite).not.toHaveBeenCalled();

    let disposeWrite: () => void = () => undefined;
    const currentness = vi.fn(() => true);
    const reader = vi.fn(() => candidate);
    const write = renderHook({
      candidateReader: { readDebugCopyValueCandidate: reader },
      clipboard: {
        canWriteText: () => true,
        writeText: () => {
          disposeWrite();
          return Promise.resolve();
        },
      },
      isCandidateCurrent: currentness,
    });
    disposeWrite = write.unmount;
    await expect(write.hook().copyValue()).resolves.toBe(false);
    expect(reader).toHaveBeenCalledTimes(5);
    expect(currentness).toHaveBeenCalledTimes(5);
  });

  it("keeps retained callbacks inert after StrictMode cleanup and final unmount", async () => {
    const ui = renderHook({}, true);
    const retainedCanCopy = ui.hook().canCopyValue;
    const retainedCopy = ui.hook().copyValue;
    expect(retainedCanCopy()).toBe(true);
    ui.unmount();

    expect(retainedCanCopy()).toBe(false);
    await expect(retainedCopy()).resolves.toBe(false);
    expect(ui.evaluateClipboard).not.toHaveBeenCalled();
    expect(ui.writeText).not.toHaveBeenCalled();
  });

  it("fails closed for unavailable, throwing, replaced, and rejected clipboard capabilities", async () => {
    for (const clipboard of [
      null,
      {
        canWriteText: () => {
          throw new Error("capability");
        },
        writeText: vi.fn(),
      },
      {
        canWriteText: () => false,
        writeText: vi.fn(),
      },
    ]) {
      const ui = renderHook({ clipboard });
      expect(ui.hook().canCopyValue()).toBe(false);
      await expect(ui.hook().copyValue()).resolves.toBe(false);
      ui.unmount();
    }

    const ui = renderHook({
      clipboard: {
        canWriteText: () => true,
        writeText: () => Promise.reject(new Error("denied")),
      },
    });
    await expect(ui.hook().copyValue()).resolves.toBe(false);
    ui.setOptions({
      clipboard: { canWriteText: () => true, writeText: () => Promise.resolve() },
    });
    await expect(ui.hook().copyValue()).resolves.toBe(true);
    ui.unmount();

    const hostileOwner = renderHook({
      isCandidateCurrent: () => {
        throw new Error("owner lookup failed");
      },
    });
    expect(hostileOwner.hook().canCopyValue()).toBe(false);
    await expect(hostileOwner.hook().copyValue()).resolves.toBe(false);
    hostileOwner.unmount();
  });

  it("releases pending after synchronous evaluator and clipboard failures", async () => {
    const evaluator = renderHook({
      evaluateClipboard: () => {
        throw new Error("sync evaluator");
      },
    });
    await expect(evaluator.hook().copyValue()).resolves.toBe(false);
    await expect(evaluator.hook().copyValue()).resolves.toBe(false);
    evaluator.unmount();

    const clipboard = renderHook({
      clipboard: {
        canWriteText: () => true,
        writeText: () => {
          throw new Error("sync clipboard");
        },
      },
    });
    await expect(clipboard.hook().copyValue()).resolves.toBe(false);
    await expect(clipboard.hook().copyValue()).resolves.toBe(false);
    clipboard.unmount();
  });
});
