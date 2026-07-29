// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fileUriFromPath,
  languageServerDocumentSyncKey,
  languageServerUriSyncKey,
  type LanguageServerTextDocument,
} from "../domain/languageServerDocumentSync";
import { useLanguageServerDocumentSyncState } from "./useLanguageServerDocumentSyncState";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type DocumentSyncState = ReturnType<typeof useLanguageServerDocumentSyncState>;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderHook(options?: Parameters<typeof useLanguageServerDocumentSyncState>[0]) {
  let current: DocumentSyncState | null = null;

  function Harness() {
    current = useLanguageServerDocumentSyncState(options);
    return null;
  }

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  act(() => {
    root?.render(<Harness />);
  });

  return {
    get current(): DocumentSyncState {
      if (!current) {
        throw new Error("Hook did not render");
      }

      return current;
    },
    rerender() {
      act(() => {
        root?.render(<Harness />);
      });
    },
  };
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
  vi.restoreAllMocks();
});

describe("useLanguageServerDocumentSyncState", () => {
  it("resets PHP document-sync state", () => {
    const harness = renderHook();
    const state = harness.current;
    const rootPath = "/workspace";
    const path = "/workspace/app/User.php";
    const key = languageServerDocumentSyncKey(rootPath, path);
    const timerId = window.setTimeout(() => undefined, 1000);
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");

    expect(state.nextDocumentVersion(rootPath, path)).toBe(1);
    state.lastAppliedDiagnosticVersionByUriRef.current["uri-key"] = 1;
    state.syncedDocumentPathsRef.current.add(key);
    state.syncedDocumentContentRef.current[key] = "<?php";
    state.pendingDocumentChangesRef.current[key] = {
      languageId: "php",
      path,
      text: "<?php",
      version: 1,
    };
    state.pendingDocumentOpenSyncAttemptsRef.current[key] = 2;
    state.documentChangeTimersRef.current[key] = timerId;
    state.documentSyncQueuesRef.current[key] = Promise.resolve();
    state.nextDocumentLifecycleIdentityRef.current = 3;
    state.documentLifecycleIdentitiesRef.current[key] = 2;
    state.pendingDocumentLifecycleIdentitiesRef.current[key] = 3;
    state.documentSyncRuntimeSignatureRef.current = "runtime:1";
    state.phpLanguageServerIndexWarmedRootsRef.current.add(rootPath);

    state.resetLanguageServerDocuments();

    expect(state.documentSyncGenerationRef.current).toBe(1);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timerId);
    expect(state.documentChangeTimersRef.current).toEqual({});
    expect(state.documentSyncRuntimeSignatureRef.current).toBeNull();
    expect(state.syncedDocumentPathsRef.current.size).toBe(0);
    expect(state.syncedDocumentContentRef.current).toEqual({});
    expect(state.pendingDocumentChangesRef.current).toEqual({});
    expect(state.pendingDocumentOpenSyncAttemptsRef.current).toEqual({});
    expect(state.documentVersionsRef.current).toEqual({});
    expect(state.documentVersionsByUriRef.current).toEqual({});
    expect(state.lastAppliedDiagnosticVersionByUriRef.current).toEqual({});
    expect(state.documentSyncQueuesRef.current).toEqual({});
    expect(state.nextDocumentLifecycleIdentityRef.current).toBe(3);
    expect(state.documentLifecycleIdentitiesRef.current).toEqual({});
    expect(state.pendingDocumentLifecycleIdentitiesRef.current).toEqual({});
    expect(state.phpLanguageServerIndexWarmedRootsRef.current.size).toBe(0);
    expect(state.getPhpDocumentSyncVersion(rootPath, path)).toBeNull();
  });

  it("resets JavaScript/TypeScript document-sync state", () => {
    const harness = renderHook();
    const state = harness.current;
    const rootPath = "/workspace";
    const path = "/workspace/src/index.ts";
    const key = languageServerDocumentSyncKey(rootPath, path);
    const timerId = window.setTimeout(() => undefined, 1000);
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");

    expect(state.nextJavaScriptTypeScriptDocumentVersion(rootPath, path)).toBe(1);
    state.javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef.current["uri-key"] = 1;
    state.javaScriptTypeScriptSyncedDocumentPathsRef.current.add(key);
    state.javaScriptTypeScriptSyncedDocumentContentRef.current[key] = "const value = 1;";
    state.javaScriptTypeScriptPendingDocumentChangesRef.current[key] = {
      languageId: "typescript",
      path,
      text: "const value = 1;",
      version: 1,
    };
    state.javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef.current[key] = 2;
    state.javaScriptTypeScriptDocumentChangeTimersRef.current[key] = timerId;
    state.javaScriptTypeScriptDocumentSyncQueuesRef.current[key] = Promise.resolve();
    state.javaScriptTypeScriptDocumentSyncRuntimeSignatureRef.current = "runtime:1";

    state.resetJavaScriptTypeScriptLanguageServerDocuments();

    expect(state.javaScriptTypeScriptDocumentSyncGenerationRef.current).toBe(1);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timerId);
    expect(state.javaScriptTypeScriptDocumentChangeTimersRef.current).toEqual({});
    expect(state.javaScriptTypeScriptDocumentSyncRuntimeSignatureRef.current).toBeNull();
    expect(state.javaScriptTypeScriptSyncedDocumentPathsRef.current.size).toBe(0);
    expect(state.javaScriptTypeScriptSyncedDocumentContentRef.current).toEqual({});
    expect(state.javaScriptTypeScriptPendingDocumentChangesRef.current).toEqual({});
    expect(state.javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef.current).toEqual({});
    expect(state.javaScriptTypeScriptDocumentVersionsRef.current).toEqual({});
    expect(state.javaScriptTypeScriptDocumentVersionsByUriRef.current).toEqual({});
    expect(state.javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef.current).toEqual({});
    expect(state.javaScriptTypeScriptDocumentSyncQueuesRef.current).toEqual({});
  });

  it("keeps helper callback identities stable across rerenders", () => {
    const harness = renderHook();
    const initial = {
      clearDocumentChangeTimer: harness.current.clearDocumentChangeTimer,
      clearJavaScriptTypeScriptDocumentChangeTimer:
        harness.current.clearJavaScriptTypeScriptDocumentChangeTimer,
      enqueueDocumentSync: harness.current.enqueueDocumentSync,
      enqueueJavaScriptTypeScriptDocumentSync:
        harness.current.enqueueJavaScriptTypeScriptDocumentSync,
      getPhpDocumentSyncVersion: harness.current.getPhpDocumentSyncVersion,
      nextDocumentVersion: harness.current.nextDocumentVersion,
      nextJavaScriptTypeScriptDocumentVersion:
        harness.current.nextJavaScriptTypeScriptDocumentVersion,
      resetJavaScriptTypeScriptLanguageServerDocuments:
        harness.current.resetJavaScriptTypeScriptLanguageServerDocuments,
      resetLanguageServerDocuments: harness.current.resetLanguageServerDocuments,
    };

    harness.rerender();

    expect(harness.current.clearDocumentChangeTimer).toBe(initial.clearDocumentChangeTimer);
    expect(harness.current.clearJavaScriptTypeScriptDocumentChangeTimer).toBe(
      initial.clearJavaScriptTypeScriptDocumentChangeTimer,
    );
    expect(harness.current.enqueueDocumentSync).toBe(initial.enqueueDocumentSync);
    expect(harness.current.enqueueJavaScriptTypeScriptDocumentSync).toBe(
      initial.enqueueJavaScriptTypeScriptDocumentSync,
    );
    expect(harness.current.getPhpDocumentSyncVersion).toBe(initial.getPhpDocumentSyncVersion);
    expect(harness.current.nextDocumentVersion).toBe(initial.nextDocumentVersion);
    expect(harness.current.nextJavaScriptTypeScriptDocumentVersion).toBe(
      initial.nextJavaScriptTypeScriptDocumentVersion,
    );
    expect(harness.current.resetJavaScriptTypeScriptLanguageServerDocuments).toBe(
      initial.resetJavaScriptTypeScriptLanguageServerDocuments,
    );
    expect(harness.current.resetLanguageServerDocuments).toBe(initial.resetLanguageServerDocuments);
  });

  it("retires queued JS/TS change mailbox ownership on unmount", () => {
    const harness = renderHook();
    const clear = vi.spyOn(harness.current.javaScriptTypeScriptDocumentChangeMailbox, "clear");

    act(() => {
      root?.unmount();
    });
    root = null;

    expect(clear).toHaveBeenCalledOnce();
  });

  it("updates path-key and uri-key version maps", () => {
    const harness = renderHook();
    const state = harness.current;
    const rootPath = "/workspace";
    const phpPath = "/workspace/app/User.php";
    const tsPath = "/workspace/src/index.ts";

    expect(state.nextDocumentVersion(rootPath, phpPath)).toBe(1);
    expect(
      state.documentVersionsRef.current[languageServerDocumentSyncKey(rootPath, phpPath)],
    ).toBe(1);
    expect(
      state.documentVersionsByUriRef.current[
        languageServerUriSyncKey(rootPath, fileUriFromPath(phpPath))
      ],
    ).toBe(1);

    expect(state.nextJavaScriptTypeScriptDocumentVersion(rootPath, tsPath)).toBe(1);
    expect(
      state.javaScriptTypeScriptDocumentVersionsRef.current[
        languageServerDocumentSyncKey(rootPath, tsPath)
      ],
    ).toBe(1);
    expect(
      state.javaScriptTypeScriptDocumentVersionsByUriRef.current[
        languageServerUriSyncKey(rootPath, fileUriFromPath(tsPath))
      ],
    ).toBe(1);
  });

  it("serializes sync queues per key and removes the current queue entry", async () => {
    const harness = renderHook();
    const state = harness.current;
    const calls: string[] = [];
    const releaseFirst: { current: (() => void) | null } = { current: null };

    const first = state.enqueueDocumentSync("file.php", async () => {
      calls.push("php:first:start");
      await new Promise<void>((resolve) => {
        releaseFirst.current = resolve;
      });
      calls.push("php:first:end");
    });
    const second = state.enqueueDocumentSync("file.php", async () => {
      calls.push("php:second");
    });

    await Promise.resolve();
    expect(calls).toEqual(["php:first:start"]);
    releaseFirst.current?.();
    await Promise.all([first, second]);
    await Promise.resolve();
    expect(calls).toEqual(["php:first:start", "php:first:end", "php:second"]);
    expect(state.documentSyncQueuesRef.current).toEqual({});

    const jsCalls: string[] = [];
    await Promise.all([
      state.enqueueJavaScriptTypeScriptDocumentSync("file.ts", async () => {
        jsCalls.push("js:first");
      }),
      state.enqueueJavaScriptTypeScriptDocumentSync("file.ts", async () => {
        jsCalls.push("js:second");
      }),
    ]);
    await Promise.resolve();
    expect(jsCalls).toEqual(["js:first", "js:second"]);
    expect(state.javaScriptTypeScriptDocumentSyncQueuesRef.current).toEqual({});
  });

  it("times out a never-settled owner without overlapping its successor", async () => {
    vi.useFakeTimers();
    try {
      const harness = renderHook();
      const state = harness.current;
      let resolveLate!: () => void;
      const late = new Promise<void>((resolve) => {
        resolveLate = resolve;
      });
      const first = state.enqueueDocumentSync("file.php", () => late);
      const successor = vi.fn(async () => undefined);
      const second = state.enqueueDocumentSync("file.php", successor);

      await vi.advanceTimersByTimeAsync(5_000);
      await expect(first).rejects.toThrow("deadline");
      expect(successor).not.toHaveBeenCalled();
      expect(state.documentSyncQueuesRef.current["file.php"]).toBeDefined();

      resolveLate();
      await expect(second).resolves.toBeUndefined();
      expect(successor).toHaveBeenCalledOnce();
      expect(state.documentSyncQueuesRef.current).toEqual({});
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed when per-key queue count or UTF-8 key budgets are exhausted", async () => {
    const harness = renderHook({
      queueLimits: {
        maxKeyUtf8Bytes: 8,
        maxKeys: 1,
        maxQueuedPerKey: 2,
        maxTotalKeyUtf8Bytes: 8,
        operationTimeoutMs: 5_000,
      },
    });
    const state = harness.current;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = state.enqueueDocumentSync("12345678", () => blocked);
    const second = state.enqueueDocumentSync("12345678", async () => undefined);

    await expect(state.enqueueDocumentSync("12345678", async () => undefined)).rejects.toThrow(
      "capacity",
    );
    await expect(state.enqueueDocumentSync("ééééé", async () => undefined)).rejects.toThrow(
      "capacity",
    );
    void state.enqueueDocumentSync("12345678", async () => undefined);
    await Promise.resolve();

    release();
    await Promise.all([first, second]);
  });

  it("retains timed-out payload bytes until the underlying owner settles", async () => {
    vi.useFakeTimers();
    try {
      const harness = renderHook({
        queueLimits: {
          maxPayloadUtf8BytesPerKey: 4,
          maxPayloadUtf8BytesPerOperation: 4,
          maxPayloadUtf8BytesTotal: 4,
          operationTimeoutMs: 5_000,
        },
      });
      const state = harness.current;
      state.pendingDocumentChangesRef.current["file.php"] = {
        languageId: "php",
        path: "file.php",
        text: "éé",
        version: 1,
      };
      let release!: () => void;
      const first = state.enqueueDocumentSync(
        "file.php",
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
        ["éé"],
      );

      await vi.advanceTimersByTimeAsync(5_000);
      await expect(first).rejects.toThrow("deadline");
      await expect(
        state.enqueueDocumentSync("file.php", async () => undefined, ["éé"]),
      ).rejects.toThrow("capacity");
      await expect(
        state.enqueueDocumentSync("oversize.php", async () => undefined, ["ééé"]),
      ).rejects.toThrow("capacity");
      await expect(
        state.enqueueDocumentSync("other.php", async () => undefined, ["x"]),
      ).rejects.toThrow("capacity");

      release();
      await Promise.resolve();
      await expect(
        state.enqueueDocumentSync("file.php", async () => undefined, ["éé"]),
      ).resolves.toBe(undefined);
    } finally {
      vi.useRealTimers();
    }
  });

  it("atomically replaces one mailbox payload reservation without accumulating history", async () => {
    const harness = renderHook({
      queueLimits: {
        maxPayloadUtf8BytesPerKey: 4,
        maxPayloadUtf8BytesPerOperation: 4,
        maxPayloadUtf8BytesTotal: 4,
      },
    });
    const state = harness.current;
    let release!: () => void;
    const drained: string[] = [];
    const drain = async (document: LanguageServerTextDocument) => {
      drained.push(document.text);
      if (document.text === "a") {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
    };
    const first = state.javaScriptTypeScriptDocumentChangeMailbox.offer(
      "file.ts",
      { languageId: "typescript", path: "file.ts", text: "a", version: 1 },
      state.enqueueJavaScriptTypeScriptDocumentSync,
      drain,
      ["a"],
    );
    for (let version = 2; version <= 1_000; version += 1) {
      state.javaScriptTypeScriptDocumentChangeMailbox.offer(
        "file.ts",
        { languageId: "typescript", path: "file.ts", text: "é", version },
        state.enqueueJavaScriptTypeScriptDocumentSync,
        drain,
        ["é"],
      );
    }

    release();
    await expect(first.settlement).resolves.toBeUndefined();
    expect(drained).toEqual(["a", "é"]);
  });

  it("does not publish a mailbox replacement whose payload reservation is rejected", async () => {
    const harness = renderHook({
      queueLimits: {
        maxPayloadUtf8BytesPerKey: 4,
        maxPayloadUtf8BytesPerOperation: 4,
        maxPayloadUtf8BytesTotal: 4,
      },
    });
    const state = harness.current;
    let release!: () => void;
    const drained: string[] = [];
    const first = state.javaScriptTypeScriptDocumentChangeMailbox.offer(
      "file.ts",
      { languageId: "typescript", path: "file.ts", text: "a", version: 1 },
      state.enqueueJavaScriptTypeScriptDocumentSync,
      async (document) => {
        drained.push(document.text);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
      ["a"],
    );
    state.javaScriptTypeScriptDocumentChangeMailbox.offer(
      "file.ts",
      { languageId: "typescript", path: "file.ts", text: "ééé", version: 2 },
      state.enqueueJavaScriptTypeScriptDocumentSync,
      async (document) => {
        drained.push(document.text);
      },
      ["ééé"],
    );

    release();
    await expect(first.settlement).rejects.toThrow("capacity");
    expect(drained).toEqual(["a"]);
  });

  it("serializes new-A behind a retired old-A owner and ignores its late response", async () => {
    const harness = renderHook();
    const state = harness.current;
    let releaseOldA!: () => void;
    const oldA = state.enqueueJavaScriptTypeScriptDocumentSync(
      "A\0file.ts",
      () =>
        new Promise<void>((resolve) => {
          releaseOldA = resolve;
        }),
    );
    const oldASettlement = expect(oldA).resolves.toBeUndefined();
    await Promise.resolve();

    state.resetJavaScriptTypeScriptLanguageServerDocuments();
    const newAOperation = vi.fn(async () => undefined);
    const newA = state.enqueueJavaScriptTypeScriptDocumentSync("A\0file.ts", newAOperation);
    expect(newAOperation).not.toHaveBeenCalled();
    expect(state.javaScriptTypeScriptDocumentSyncQueuesRef.current["A\0file.ts"]).toBeDefined();

    releaseOldA();
    await oldASettlement;
    await expect(newA).resolves.toBeUndefined();
    expect(newAOperation).toHaveBeenCalledOnce();
    expect(state.javaScriptTypeScriptDocumentSyncQueuesRef.current).toEqual({});
  });

  it("internally handles a fire-and-forget owner retirement during reset", async () => {
    const harness = renderHook();
    const state = harness.current;
    let release!: () => void;
    void state.enqueueDocumentSync(
      "file.php",
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      ["content"],
    );
    await Promise.resolve();

    state.resetLanguageServerDocuments();
    release();
    await Promise.resolve();
  });
});
