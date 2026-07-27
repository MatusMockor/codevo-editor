// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { DebugEvaluationResult } from "../domain/debugEvaluationPolicy";
import type { TextClipboardGateway } from "../domain/textClipboard";
import {
  useDebugCopyValueComposition,
  type DebugCopyValueComposition,
  type DebugCopyValueOwner,
} from "./useDebugCopyValueComposition";

const owner: DebugCopyValueOwner = {
  rootKey: "/workspace",
  workspaceOwnerKey: "owner-a",
  sessionId: 7,
  pauseGeneration: 3,
  frameId: 11,
};
const focused = {
  source: "variables",
  identity: "variable:scope:user",
  evaluateName: 'root["user"]',
  adapterEvaluateName: 'root["user"]',
  displayedValue: "User {…}",
} as const;

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function renderHook({
  clipboard,
  evaluateClipboard,
  initialOwner = owner,
}: {
  clipboard: TextClipboardGateway;
  evaluateClipboard(expression: string): Promise<DebugEvaluationResult | null>;
  initialOwner?: DebugCopyValueOwner | null;
}) {
  const host = document.createElement("div");
  const root = createRoot(host);
  let currentOwner = initialOwner;
  let commands: DebugCopyValueComposition | null = null;
  function Harness() {
    commands = useDebugCopyValueComposition({ clipboard, evaluateClipboard, owner: currentOwner });
    return null;
  }
  const render = () => act(() => root.render(<Harness />));
  render();
  return {
    hook: () => commands as unknown as DebugCopyValueComposition,
    setOwner: (next: DebugCopyValueOwner | null) => {
      currentOwner = next;
      render();
    },
    unmount: () => act(() => root.unmount()),
  };
}

describe("useDebugCopyValueComposition", () => {
  it("copies an immutable console result without evaluation and fences frame and owner ABA", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const evaluateClipboard = vi.fn();
    const ui = renderHook({
      clipboard: { canWriteText: () => true, writeText },
      evaluateClipboard,
    });
    const publish = (identity: string, displayedValue: string) =>
      act(() =>
        ui.hook().console.onCandidateChange({
          source: "console",
          identity,
          ...owner,
          generation: ui.hook().console.generation,
          epoch: ui.hook().console.epoch,
          displayedValue,
        }),
      );

    publish("console-1", "captured-value");
    await act(async () => {
      await expect(ui.hook().console.copyDisplayedValue()).resolves.toBe(true);
    });
    expect(writeText).toHaveBeenCalledExactlyOnceWith("captured-value");
    expect(evaluateClipboard).not.toHaveBeenCalled();

    publish("console-2", "stale-frame-value");
    const staleFrame = ui.hook().console.copyDisplayedValue();
    ui.setOwner({ ...owner, frameId: owner.frameId + 1 });
    await expect(staleFrame).resolves.toBe(false);
    expect(writeText).toHaveBeenCalledTimes(1);

    ui.setOwner(owner);
    publish("console-3", "stale-aba-value");
    const staleAba = ui.hook().console.copyDisplayedValue();
    ui.setOwner({ ...owner, workspaceOwnerKey: "owner-b" });
    ui.setOwner(owner);
    await expect(staleAba).resolves.toBe(false);
    expect(writeText).toHaveBeenCalledTimes(1);

    publish("console-4", "cleared-value");
    act(() => ui.hook().console.onCandidateChange(null));
    expect(ui.hook().console.canCopyDisplayedValue()).toBe(false);
    await expect(ui.hook().console.copyDisplayedValue()).resolves.toBe(false);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(evaluateClipboard).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("copies an exact multiline console expression and fences owner A-B-A", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const ui = renderHook({
      clipboard: { canWriteText: () => true, writeText },
      evaluateClipboard: vi.fn(),
    });
    const publish = () =>
      act(() =>
        ui.hook().console.onCandidateChange({
          source: "console",
          identity: "console-multiline",
          ...owner,
          generation: ui.hook().console.generation,
          epoch: ui.hook().console.epoch,
          adapterEvaluateName: "(\n  root\n).nested.b",
          displayedValue: "1",
        }),
      );

    publish();
    await expect(ui.hook().console.copyEvaluatePathFromMenu()).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledExactlyOnceWith("(\n  root\n).nested.b");

    publish();
    const stale = ui.hook().console.copyEvaluatePathFromMenu();
    ui.setOwner({ ...owner, workspaceOwnerKey: "owner-b" });
    ui.setOwner(owner);
    await expect(stale).resolves.toBe(false);
    expect(writeText).toHaveBeenCalledOnce();
    ui.unmount();
  });

  it("adapts the active owner to source-scoped Variables and Watch surfaces", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const ui = renderHook({
      clipboard: { canWriteText: () => true, writeText },
      evaluateClipboard: vi.fn().mockResolvedValue({ status: "ok", value: "resolved" }),
    });
    const variables = ui.hook().variables;
    const watch = ui.hook().watch;

    expect(variables.source).toBe("variables");
    expect(watch.source).toBe("watch");
    expect(variables.workspaceOwnerKey).toBe(owner.workspaceOwnerKey);
    expect(variables.isOwnerCurrent(owner)).toBe(true);
    expect(variables.isOwnerCurrent({ ...owner, frameId: owner.frameId + 1 })).toBe(false);

    const candidate = {
      ...focused,
      ...owner,
      generation: variables.generation,
      epoch: variables.epoch,
    };
    act(() => variables.onCandidateChange(candidate));
    expect(ui.hook().canCopyValue()).toBe(true);
    act(() =>
      watch.onCandidateChange({
        ...candidate,
        source: "variables",
      }),
    );
    expect(ui.hook().canCopyValue()).toBe(true);
    await act(async () => {
      await expect(watch.copyValue()).resolves.toBe(true);
    });
    expect(writeText).toHaveBeenCalledExactlyOnceWith("resolved");

    act(() => variables.onCandidateChange(null));
    expect(ui.hook().canCopyValue()).toBe(false);
    ui.unmount();
  });

  it("exposes narrow live focus callbacks over the injected clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const evaluateClipboard = vi.fn().mockResolvedValue({ status: "ok", value: "resolved" });
    const clipboard = { canWriteText: () => true, writeText };
    const ui = renderHook({ clipboard, evaluateClipboard });

    expect(ui.hook().canCopyValue()).toBe(false);
    act(() => ui.hook().setFocusedCandidate(focused));
    expect(ui.hook().canCopyValue()).toBe(true);
    await act(async () => {
      await expect(ui.hook().copyValue()).resolves.toBe(true);
    });
    expect(evaluateClipboard).toHaveBeenCalledExactlyOnceWith('root["user"]');
    expect(writeText).toHaveBeenCalledExactlyOnceWith("resolved");
    act(() => ui.hook().clearFocusedCandidate());
    expect(ui.hook().canCopyValue()).toBe(false);
    ui.unmount();
  });

  it("keeps a menu candidate current through the async copy and clears it after completion", async () => {
    const evaluation = deferred<DebugEvaluationResult | null>();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const ui = renderHook({
      clipboard: { canWriteText: () => true, writeText },
      evaluateClipboard: () => evaluation.promise,
    });
    act(() =>
      ui.hook().variables.onCandidateChange({
        ...focused,
        ...owner,
        generation: ui.hook().variables.generation,
        epoch: ui.hook().variables.epoch,
      }),
    );

    const invocation = ui.hook().variables.copyValueFromMenu();
    expect(ui.hook().canCopyValue()).toBe(false);
    evaluation.resolve({ status: "ok", value: "menu-value" });

    await expect(invocation).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledExactlyOnceWith("menu-value");
    expect(ui.hook().canCopyValue()).toBe(false);
    ui.unmount();
  });

  it("does not let a completed menu copy clear a replacement candidate", async () => {
    const evaluation = deferred<DebugEvaluationResult | null>();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const ui = renderHook({
      clipboard: { canWriteText: () => true, writeText },
      evaluateClipboard: () => evaluation.promise,
    });
    act(() => ui.hook().setFocusedCandidate(focused));
    const invocation = ui.hook().variables.copyValueFromMenu();
    act(() =>
      ui.hook().setFocusedCandidate({
        ...focused,
        identity: "variable:scope:replacement",
        evaluateName: "replacement",
      }),
    );
    evaluation.resolve({ status: "ok", value: "stale" });

    await expect(invocation).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
    expect(ui.hook().canCopyValue()).toBe(true);
    ui.unmount();
  });

  it("does not let an old menu invocation clear a new candidate after owner A to B to A", async () => {
    const evaluation = deferred<DebugEvaluationResult | null>();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const ui = renderHook({
      clipboard: { canWriteText: () => true, writeText },
      evaluateClipboard: () => evaluation.promise,
    });
    act(() => ui.hook().setFocusedCandidate(focused));
    const invocation = ui.hook().variables.copyValueFromMenu();

    ui.setOwner({ ...owner, workspaceOwnerKey: "owner-b" });
    ui.setOwner(owner);
    act(() =>
      ui.hook().setFocusedCandidate({
        ...focused,
        identity: "variable:new-owner-epoch",
        evaluateName: "fresh",
      }),
    );
    evaluation.resolve({ status: "ok", value: "stale" });

    await expect(invocation).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
    expect(ui.hook().canCopyValue()).toBe(true);
    ui.unmount();
  });

  it("invalidates an in-flight copy across exact-owner A to B to A", async () => {
    const evaluation = deferred<DebugEvaluationResult | null>();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const ui = renderHook({
      clipboard: { canWriteText: () => true, writeText },
      evaluateClipboard: () => evaluation.promise,
    });
    act(() => ui.hook().setFocusedCandidate(focused));
    const invocation = ui.hook().copyValue();

    ui.setOwner({ ...owner, workspaceOwnerKey: "owner-b" });
    ui.setOwner(owner);
    evaluation.resolve({ status: "ok", value: "stale" });

    await expect(invocation).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
    expect(ui.hook().canCopyValue()).toBe(false);
    ui.unmount();
  });

  it("keeps retained focus and copy callbacks inert after unmount", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const evaluateClipboard = vi.fn().mockResolvedValue({ status: "ok", value: "resolved" });
    const ui = renderHook({
      clipboard: { canWriteText: () => true, writeText },
      evaluateClipboard,
    });
    const retained = ui.hook();
    ui.unmount();

    retained.setFocusedCandidate(focused);
    retained.clearFocusedCandidate();
    expect(retained.canCopyValue()).toBe(false);
    await expect(retained.copyValue()).resolves.toBe(false);
    expect(evaluateClipboard).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies only the proven adapter path and rejects a Watch-root expression", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const evaluateClipboard = vi.fn();
    const ui = renderHook({
      clipboard: { canWriteText: () => true, writeText },
      evaluateClipboard,
    });
    act(() => ui.hook().setFocusedCandidate(focused));
    expect(ui.hook().canCopyEvaluatePath()).toBe(true);
    await act(async () => {
      await expect(ui.hook().copyEvaluatePath()).resolves.toBe(true);
    });
    expect(writeText).toHaveBeenCalledExactlyOnceWith('root["user"]');
    expect(evaluateClipboard).not.toHaveBeenCalled();

    act(() =>
      ui.hook().setFocusedCandidate({
        ...focused,
        source: "watch",
        adapterEvaluateName: undefined,
        evaluateName: "definition.expression",
      }),
    );
    expect(ui.hook().canCopyEvaluatePath()).toBe(false);
    await expect(ui.hook().copyEvaluatePath()).resolves.toBe(false);
    expect(writeText).toHaveBeenCalledOnce();
    ui.unmount();
  });

  it("shares one flight when Copy Value wins and allows expression retry", async () => {
    const evaluation = deferred<DebugEvaluationResult | null>();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const ui = renderHook({
      clipboard: { canWriteText: () => true, writeText },
      evaluateClipboard: () => evaluation.promise,
    });
    act(() => ui.hook().setFocusedCandidate(focused));
    const value = ui.hook().copyValue();
    expect(ui.hook().canCopyEvaluatePath()).toBe(false);
    await expect(ui.hook().copyEvaluatePath()).resolves.toBe(false);
    evaluation.resolve({ status: "ok", value: "resolved" });
    await expect(value).resolves.toBe(true);
    await expect(ui.hook().copyEvaluatePath()).resolves.toBe(true);
    expect(writeText).toHaveBeenNthCalledWith(1, "resolved");
    expect(writeText).toHaveBeenNthCalledWith(2, 'root["user"]');
    ui.unmount();
  });

  it("shares one flight when Copy as Expression wins and allows value retry", async () => {
    const writing = deferred<void>();
    const writeText = vi
      .fn()
      .mockImplementationOnce(() => writing.promise)
      .mockResolvedValue(undefined);
    const evaluateClipboard = vi.fn().mockResolvedValue({ status: "ok", value: "resolved" });
    const ui = renderHook({
      clipboard: { canWriteText: () => true, writeText },
      evaluateClipboard,
    });
    act(() => ui.hook().setFocusedCandidate(focused));
    const expression = ui.hook().copyEvaluatePath();
    await act(async () => void (await Promise.resolve()));
    expect(ui.hook().canCopyValue()).toBe(false);
    await expect(ui.hook().copyValue()).resolves.toBe(false);
    expect(evaluateClipboard).not.toHaveBeenCalled();
    writing.resolve();
    await expect(expression).resolves.toBe(true);
    await expect(ui.hook().copyValue()).resolves.toBe(true);
    expect(evaluateClipboard).toHaveBeenCalledExactlyOnceWith('root["user"]');
    ui.unmount();
  });

  it("conditionally clears an expression menu target without clearing its replacement", async () => {
    const writing = deferred<void>();
    const writeText = vi.fn(() => writing.promise);
    const ui = renderHook({
      clipboard: { canWriteText: () => true, writeText },
      evaluateClipboard: vi.fn(),
    });
    act(() => ui.hook().setFocusedCandidate(focused));
    const invocation = ui.hook().variables.copyEvaluatePathFromMenu();
    await act(async () => void (await Promise.resolve()));
    act(() =>
      ui.hook().setFocusedCandidate({
        ...focused,
        identity: "variable:replacement",
        adapterEvaluateName: "replacement.path",
      }),
    );
    writing.resolve();
    await expect(invocation).resolves.toBe(false);
    expect(ui.hook().canCopyEvaluatePath()).toBe(true);

    await expect(ui.hook().variables.copyEvaluatePathFromMenu()).resolves.toBe(true);
    expect(ui.hook().canCopyEvaluatePath()).toBe(false);
    ui.unmount();
  });

  it("invalidates direct expression copying on A to B to A and unmount", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const ui = renderHook({
      clipboard: { canWriteText: () => true, writeText },
      evaluateClipboard: vi.fn(),
    });
    act(() => ui.hook().setFocusedCandidate(focused));
    const replaced = ui.hook().copyEvaluatePath();
    ui.setOwner({ ...owner, workspaceOwnerKey: "owner-b" });
    ui.setOwner(owner);
    await expect(replaced).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();

    act(() => ui.hook().setFocusedCandidate(focused));
    const unmounted = ui.hook().copyEvaluatePath();
    ui.unmount();
    await expect(unmounted).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("shares the tree clipboard flight with a hover one-shot without changing focus", async () => {
    const writing = deferred<void>();
    const writeText = vi
      .fn()
      .mockImplementationOnce(() => writing.promise)
      .mockResolvedValue(undefined);
    const ui = renderHook({
      clipboard: { canWriteText: () => true, writeText },
      evaluateClipboard: vi.fn(),
    });
    act(() => ui.hook().setFocusedCandidate(focused));
    const hover = ui.hook().copyEvaluatePathOnce({
      owner,
      evaluateName: "hover.exact.path",
      isCurrent: () => true,
    });
    await act(async () => void (await Promise.resolve()));
    await expect(ui.hook().copyEvaluatePath()).resolves.toBe(false);
    writing.resolve();
    await expect(hover).resolves.toBe(true);
    await expect(ui.hook().copyEvaluatePath()).resolves.toBe(true);
    expect(writeText).toHaveBeenNthCalledWith(1, "hover.exact.path");
    expect(writeText).toHaveBeenNthCalledWith(2, 'root["user"]');
    ui.unmount();
  });
});
