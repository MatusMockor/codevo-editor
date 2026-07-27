// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { TextClipboardGateway } from "../domain/textClipboard";
import {
  useDebugCopyStackTrace,
  type DebugCopyStackTraceCommands,
  type DebugCopyStackTraceContext,
} from "./useDebugCopyStackTrace";

const context: DebugCopyStackTraceContext = {
  framesTruncated: false,
  rootKey: "/workspace",
  sessionId: 7,
  pauseGeneration: 3,
  workspaceOwnerKey: "workspace-owner-a",
  frames: [
    {
      frameId: 11,
      name: "main",
      filePath: "/workspace/src/index.ts",
      lineNumber: 12,
      column: 4,
    },
  ],
};

function deferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, reject, resolve };
}

function renderHook({
  clipboard,
  getContext = () => context,
}: {
  clipboard: TextClipboardGateway | null;
  getContext?: () => DebugCopyStackTraceContext | null;
}) {
  const host = document.createElement("div");
  const root = createRoot(host);
  let value: DebugCopyStackTraceCommands | null = null;
  function Harness() {
    value = useDebugCopyStackTrace({ clipboard, getContext });
    return null;
  }
  act(() => root.render(<Harness />));
  return {
    hook: () => value as unknown as DebugCopyStackTraceCommands,
    unmount: () => root.unmount(),
  };
}

describe("useDebugCopyStackTrace", () => {
  it("double-captures exact owner and frames before one asynchronous write", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const getContext = vi.fn(() => context);
    const harness = renderHook({
      clipboard: { canWriteText: () => true, writeText },
      getContext,
    });
    expect(harness.hook().copyStackTrace()).toBe(true);
    expect(getContext).toHaveBeenCalledTimes(2);
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith("main (/workspace/src/index.ts:12)");
    harness.unmount();
  });

  it("rejects session, pause, root, order, and private frame drift before writing", () => {
    const variants: DebugCopyStackTraceContext[] = [
      { ...context, sessionId: 8 },
      { ...context, pauseGeneration: 4 },
      { ...context, rootKey: "/other" },
      { ...context, workspaceOwnerKey: "workspace-owner-b" },
      { ...context, framesTruncated: true },
      { ...context, frames: [{ ...context.frames[0]!, frameId: 12 }] },
      { ...context, frames: [{ ...context.frames[0]!, name: "renamed" }] },
      { ...context, frames: [{ ...context.frames[0]!, filePath: "/workspace/src/other.ts" }] },
      { ...context, frames: [{ ...context.frames[0]!, lineNumber: 13 }] },
      { ...context, frames: [{ ...context.frames[0]!, column: 5 }] },
      { ...context, frames: [...context.frames, { ...context.frames[0]!, frameId: 12 }] },
    ];
    for (const changed of variants) {
      const writeText = vi.fn().mockResolvedValue(undefined);
      let calls = 0;
      const harness = renderHook({
        clipboard: { canWriteText: () => true, writeText },
        getContext: () => (calls++ === 0 ? context : changed),
      });
      expect(harness.hook().copyStackTrace()).toBe(false);
      expect(writeText).not.toHaveBeenCalled();
      harness.unmount();
    }
  });

  it("copies a deterministic marker when the authoritative stack is truncated", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const harness = renderHook({
      clipboard: { canWriteText: () => true, writeText },
      getContext: () => ({ ...context, framesTruncated: true }),
    });

    expect(harness.hook().copyStackTrace()).toBe(true);
    expect(writeText).toHaveBeenCalledWith(
      "main (/workspace/src/index.ts:12)\n[Stack trace truncated to the inspectable frame limit]",
    );
    harness.unmount();
  });

  it("rejects unavailable, empty, unowned, and malformed contexts before writing", () => {
    for (const unavailable of [
      null,
      { ...context, frames: [] },
      { ...context, sessionId: 0 },
      { ...context, pauseGeneration: 0 },
      { ...context, rootKey: "" },
      { ...context, workspaceOwnerKey: "" },
    ]) {
      const writeText = vi.fn().mockResolvedValue(undefined);
      const harness = renderHook({
        clipboard: { canWriteText: () => true, writeText },
        getContext: () => unavailable,
      });
      expect(harness.hook().canCopyStackTrace()).toBe(false);
      expect(harness.hook().copyStackTrace()).toBe(false);
      expect(writeText).not.toHaveBeenCalled();
      harness.unmount();
    }
  });

  it("fails closed when malformed or hostile frame projections throw", () => {
    const hostileContext = Object.defineProperty({ ...context }, "frames", {
      get: () => {
        throw new Error("stale frame projection");
      },
    }) as DebugCopyStackTraceContext;
    for (const malformed of [
      { ...context, frames: null as never },
      hostileContext,
      { ...context, frames: [{ ...context.frames[0], name: null as never }] },
    ]) {
      const writeText = vi.fn().mockResolvedValue(undefined);
      const harness = renderHook({
        clipboard: { canWriteText: () => true, writeText },
        getContext: () => malformed,
      });
      expect(harness.hook().canCopyStackTrace()).toBe(false);
      expect(harness.hook().copyStackTrace()).toBe(false);
      expect(writeText).not.toHaveBeenCalled();
      harness.unmount();
    }
  });

  it("rejects A to B drift even when a later capture returns to A", () => {
    const sameRootOwnerB = {
      ...context,
      sessionId: 8,
      workspaceOwnerKey: "workspace-owner-b",
    };
    const captures = [context, sameRootOwnerB, context, context];
    const writeText = vi.fn().mockResolvedValue(undefined);
    let index = 0;
    const harness = renderHook({
      clipboard: { canWriteText: () => true, writeText },
      getContext: () => captures[index++] ?? context,
    });
    expect(harness.hook().copyStackTrace()).toBe(false);
    expect(harness.hook().copyStackTrace()).toBe(true);
    expect(writeText).toHaveBeenCalledOnce();
    harness.unmount();
  });

  it("fails closed when clipboard capability is false or throws", () => {
    for (const canWriteText of [
      () => false,
      () => {
        throw new Error("capability failure");
      },
    ]) {
      const writeText = vi.fn().mockResolvedValue(undefined);
      const harness = renderHook({ clipboard: { canWriteText, writeText } });
      expect(harness.hook().canCopyStackTrace()).toBe(false);
      expect(harness.hook().copyStackTrace()).toBe(false);
      expect(writeText).not.toHaveBeenCalled();
      harness.unmount();
    }
  });

  it("does not require or project adapter, trust, arguments, environment, or variables", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const harness = renderHook({ clipboard: { canWriteText: () => true, writeText } });

    expect(Object.keys(context).sort()).toEqual([
      "frames",
      "framesTruncated",
      "pauseGeneration",
      "rootKey",
      "sessionId",
      "workspaceOwnerKey",
    ]);
    expect(harness.hook().copyStackTrace()).toBe(true);
    expect(writeText).toHaveBeenCalledWith("main (/workspace/src/index.ts:12)");
    expect(writeText.mock.calls[0]).toHaveLength(1);
    harness.unmount();
  });

  it("uses one global flight and releases it after success or failure", async () => {
    const pending = deferred();
    const writeText = vi.fn(() => pending.promise);
    const harness = renderHook({ clipboard: { canWriteText: () => true, writeText } });
    expect(harness.hook().copyStackTrace()).toBe(true);
    expect(harness.hook().copyStackTrace()).toBe(false);
    expect(harness.hook().canCopyStackTrace()).toBe(false);
    pending.reject(new Error("denied"));
    await act(async () => void (await Promise.resolve()));
    expect(harness.hook().copyStackTrace()).toBe(true);
    expect(writeText).toHaveBeenCalledTimes(2);
    harness.unmount();
  });

  it("fails closed and remains retryable for absent, throwing, and rejected capabilities", async () => {
    expect(renderHook({ clipboard: null }).hook().copyStackTrace()).toBe(false);
    const throwing = renderHook({
      clipboard: {
        canWriteText: () => true,
        writeText: () => {
          throw new Error("sync");
        },
      },
    });
    expect(throwing.hook().copyStackTrace()).toBe(false);
    expect(throwing.hook().copyStackTrace()).toBe(false);
    throwing.unmount();
  });
});
