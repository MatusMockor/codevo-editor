// @vitest-environment jsdom

import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { TextClipboardGateway } from "../domain/textClipboard";
import type { DebugCopyValueCandidate, DebugCopyValueCandidateReader } from "./debugCopyValue";
import {
  useDebugCopyEvaluatePath,
  type DebugCopyEvaluatePathCommands,
} from "./useDebugCopyEvaluatePath";

type Options = Parameters<typeof useDebugCopyEvaluatePath>[0];

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
  evaluateName: "sourceLevelAlias",
  adapterEvaluateName: 'root["user"]',
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

function renderHook(overrides: Partial<Options> = {}, strictMode = false) {
  const host = document.createElement("div");
  const root = createRoot(host);
  let currentCandidate: unknown = candidate;
  const candidateReader: DebugCopyValueCandidateReader = {
    readDebugCopyValueCandidate: vi.fn(() => currentCandidate),
  };
  const writeText = vi.fn().mockResolvedValue(undefined);
  const clipboard: TextClipboardGateway = { canWriteText: () => true, writeText };
  const isCandidateCurrent = vi.fn(() => true);
  let props: Options = { candidateReader, clipboard, isCandidateCurrent, ...overrides };
  let commands: DebugCopyEvaluatePathCommands | null = null;

  function Harness() {
    commands = useDebugCopyEvaluatePath(props);
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
    hook: () => commands as unknown as DebugCopyEvaluatePathCommands,
    isCandidateCurrent,
    setCandidate: (value: unknown) => {
      currentCandidate = value;
    },
    setOptions: (next: Partial<Options>) => {
      props = { ...props, ...next };
      render();
    },
    unmount: () => act(() => root.unmount()),
    writeText,
  };
}

describe("useDebugCopyEvaluatePath", () => {
  it("writes the exact adapter evaluate name directly", async () => {
    const ui = renderHook();

    expect(ui.hook().canCopyEvaluatePath()).toBe(true);
    await act(async () => {
      await expect(ui.hook().copyEvaluatePath()).resolves.toBe(true);
    });

    expect(ui.writeText).toHaveBeenCalledExactlyOnceWith('root["user"]');
    expect(ui.candidateReader.readDebugCopyValueCandidate).toHaveBeenCalledTimes(7);
    ui.unmount();
  });

  it("requires adapterEvaluateName and never falls back to evaluateName or displayedValue", async () => {
    for (const ineligible of [
      { ...candidate, adapterEvaluateName: undefined },
      { ...candidate, adapterEvaluateName: undefined, evaluateName: undefined },
    ]) {
      const ui = renderHook();
      ui.setCandidate(ineligible);

      expect(ui.hook().canCopyEvaluatePath()).toBe(false);
      await expect(ui.hook().copyEvaluatePath()).resolves.toBe(false);
      expect(ui.writeText).not.toHaveBeenCalled();
      ui.unmount();
    }
  });

  it("rejects every field drift across the initial double capture", async () => {
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
      { ...candidate, evaluateName: "otherAlias" },
      { ...candidate, adapterEvaluateName: "root.other" },
      { ...candidate, displayedValue: "changed" },
    ];

    for (const variant of variants) {
      const captures = [candidate, variant];
      const writeText = vi.fn();
      const ui = renderHook({
        candidateReader: {
          readDebugCopyValueCandidate: () => captures.shift() ?? candidate,
        },
        clipboard: { canWriteText: () => true, writeText },
      });

      await expect(ui.hook().copyEvaluatePath()).resolves.toBe(false);
      expect(writeText).not.toHaveBeenCalled();
      ui.unmount();
    }
  });

  it("enforces owner currentness before and after the clipboard write", async () => {
    const rejected = renderHook({ isCandidateCurrent: () => false });
    expect(rejected.hook().canCopyEvaluatePath()).toBe(false);
    await expect(rejected.hook().copyEvaluatePath()).resolves.toBe(false);
    expect(rejected.writeText).not.toHaveBeenCalled();
    rejected.unmount();

    let current = true;
    const writing = deferred<void>();
    const writeText = vi.fn(() => writing.promise);
    const ui = renderHook({
      clipboard: { canWriteText: () => true, writeText },
      isCandidateCurrent: () => current,
    });
    const invocation = ui.hook().copyEvaluatePath();
    await act(async () => void (await Promise.resolve()));
    expect(writeText).toHaveBeenCalledExactlyOnceWith('root["user"]');

    current = false;
    writing.resolve();
    await act(async () => {
      await expect(invocation).resolves.toBe(false);
    });
    expect(ui.hook().canCopyEvaluatePath()).toBe(false);
    ui.unmount();

    const hostile = renderHook({
      isCandidateCurrent: () => {
        throw new Error("owner lookup failed");
      },
    });
    expect(hostile.hook().canCopyEvaluatePath()).toBe(false);
    await expect(hostile.hook().copyEvaluatePath()).resolves.toBe(false);
    hostile.unmount();
  });

  it("rechecks clipboard identity and capability immediately before writing", async () => {
    for (const drift of ["identity", "capability"] as const) {
      let available = true;
      const originalWrite = vi.fn().mockResolvedValue(undefined);
      const replacementWrite = vi.fn().mockResolvedValue(undefined);
      const ui = renderHook({
        clipboard: { canWriteText: () => available, writeText: originalWrite },
      });

      const invocation = ui.hook().copyEvaluatePath();
      if (drift === "identity") {
        ui.setOptions({
          clipboard: { canWriteText: () => true, writeText: replacementWrite },
        });
      } else {
        available = false;
      }

      await act(async () => {
        await expect(invocation).resolves.toBe(false);
      });
      expect(originalWrite).not.toHaveBeenCalled();
      expect(replacementWrite).not.toHaveBeenCalled();
      ui.unmount();
    }
  });

  it("rechecks candidate, clipboard identity, and capability after an in-flight write", async () => {
    for (const drift of ["candidate", "identity", "capability"] as const) {
      const writing = deferred<void>();
      let available = true;
      const writeText = vi.fn(() => writing.promise);
      const replacementWrite = vi.fn().mockResolvedValue(undefined);
      const ui = renderHook({
        clipboard: { canWriteText: () => available, writeText },
      });

      const invocation = ui.hook().copyEvaluatePath();
      await act(async () => void (await Promise.resolve()));
      expect(writeText).toHaveBeenCalledExactlyOnceWith('root["user"]');

      if (drift === "candidate") ui.setCandidate({ ...candidate, epoch: 10 });
      if (drift === "identity") {
        ui.setOptions({
          clipboard: { canWriteText: () => true, writeText: replacementWrite },
        });
      }
      if (drift === "capability") available = false;
      writing.resolve();

      await act(async () => {
        await expect(invocation).resolves.toBe(false);
      });
      expect(replacementWrite).not.toHaveBeenCalled();
      ui.unmount();
    }
  });

  it("does not write when unmounted before the async strategy continuation", async () => {
    const ui = renderHook();
    const invocation = ui.hook().copyEvaluatePath();

    ui.unmount();

    await expect(invocation).resolves.toBe(false);
    expect(ui.writeText).not.toHaveBeenCalled();
    await expect(ui.hook().copyEvaluatePath()).resolves.toBe(false);
  });

  it("settles false without post-unmount checks when unmounted during writing", async () => {
    const writing = deferred<void>();
    const canWriteText = vi.fn(() => true);
    const writeText = vi.fn(() => writing.promise);
    const ui = renderHook({ clipboard: { canWriteText, writeText } });
    const invocation = ui.hook().copyEvaluatePath();
    await act(async () => void (await Promise.resolve()));
    expect(writeText).toHaveBeenCalledExactlyOnceWith('root["user"]');
    const checksBeforeUnmount = canWriteText.mock.calls.length;

    ui.unmount();
    writing.resolve();

    await expect(invocation).resolves.toBe(false);
    expect(canWriteText).toHaveBeenCalledTimes(checksBeforeUnmount);
    expect(writeText).toHaveBeenCalledOnce();
  });

  it("releases the flight after synchronous and asynchronous clipboard errors", async () => {
    const synchronousWrite = vi.fn(() => {
      throw new Error("sync denied");
    });
    const synchronous = renderHook({
      clipboard: { canWriteText: () => true, writeText: synchronousWrite },
    });
    await expect(synchronous.hook().copyEvaluatePath()).resolves.toBe(false);
    await expect(synchronous.hook().copyEvaluatePath()).resolves.toBe(false);
    expect(synchronousWrite).toHaveBeenCalledTimes(2);
    synchronous.setOptions({
      clipboard: { canWriteText: () => true, writeText: vi.fn().mockResolvedValue(undefined) },
    });
    await expect(synchronous.hook().copyEvaluatePath()).resolves.toBe(true);
    synchronous.unmount();

    const asynchronousWrite = vi.fn().mockRejectedValue(new Error("async denied"));
    const asynchronous = renderHook({
      clipboard: { canWriteText: () => true, writeText: asynchronousWrite },
    });
    await expect(asynchronous.hook().copyEvaluatePath()).resolves.toBe(false);
    await expect(asynchronous.hook().copyEvaluatePath()).resolves.toBe(false);
    expect(asynchronousWrite).toHaveBeenCalledTimes(2);
    asynchronous.setOptions({
      clipboard: { canWriteText: () => true, writeText: vi.fn().mockResolvedValue(undefined) },
    });
    await expect(asynchronous.hook().copyEvaluatePath()).resolves.toBe(true);
    asynchronous.unmount();
  });

  it("retries after synchronous capability errors", async () => {
    let hostile = true;
    const writeText = vi.fn().mockResolvedValue(undefined);
    const ui = renderHook({
      clipboard: {
        canWriteText: () => {
          if (hostile) throw new Error("capability failed");
          return true;
        },
        writeText,
      },
    });

    expect(ui.hook().canCopyEvaluatePath()).toBe(false);
    await expect(ui.hook().copyEvaluatePath()).resolves.toBe(false);
    hostile = false;
    expect(ui.hook().canCopyEvaluatePath()).toBe(true);
    await expect(ui.hook().copyEvaluatePath()).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledOnce();
    ui.unmount();
  });

  it("keeps retained callbacks live across rerenders and inert after StrictMode unmount", async () => {
    const ui = renderHook({}, true);
    const retainedCanCopy = ui.hook().canCopyEvaluatePath;
    const retainedCopy = ui.hook().copyEvaluatePath;
    const replacementWrite = vi.fn().mockResolvedValue(undefined);
    ui.setOptions({
      clipboard: { canWriteText: () => true, writeText: replacementWrite },
    });

    expect(retainedCanCopy()).toBe(true);
    await expect(retainedCopy()).resolves.toBe(true);
    expect(replacementWrite).toHaveBeenCalledExactlyOnceWith('root["user"]');

    ui.unmount();
    expect(retainedCanCopy()).toBe(false);
    await expect(retainedCopy()).resolves.toBe(false);
    expect(replacementWrite).toHaveBeenCalledOnce();
  });
});
