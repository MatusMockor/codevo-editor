// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fileUriFromPath,
  languageServerDocumentSyncKey,
  languageServerUriSyncKey,
} from "../domain/languageServerDocumentSync";
import { useLanguageServerDocumentSyncState } from "./useLanguageServerDocumentSyncState";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type DocumentSyncState = ReturnType<typeof useLanguageServerDocumentSyncState>;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderHook() {
  let current: DocumentSyncState | null = null;

  function Harness() {
    current = useLanguageServerDocumentSyncState();
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
    state.javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef.current[
      "uri-key"
    ] = 1;
    state.javaScriptTypeScriptSyncedDocumentPathsRef.current.add(key);
    state.javaScriptTypeScriptSyncedDocumentContentRef.current[key] =
      "const value = 1;";
    state.javaScriptTypeScriptPendingDocumentChangesRef.current[key] = {
      languageId: "typescript",
      path,
      text: "const value = 1;",
      version: 1,
    };
    state.javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef.current[key] = 2;
    state.javaScriptTypeScriptDocumentChangeTimersRef.current[key] = timerId;
    state.javaScriptTypeScriptDocumentSyncQueuesRef.current[key] =
      Promise.resolve();
    state.javaScriptTypeScriptDocumentSyncRuntimeSignatureRef.current =
      "runtime:1";

    state.resetJavaScriptTypeScriptLanguageServerDocuments();

    expect(state.javaScriptTypeScriptDocumentSyncGenerationRef.current).toBe(1);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timerId);
    expect(state.javaScriptTypeScriptDocumentChangeTimersRef.current).toEqual({});
    expect(state.javaScriptTypeScriptDocumentSyncRuntimeSignatureRef.current).toBeNull();
    expect(state.javaScriptTypeScriptSyncedDocumentPathsRef.current.size).toBe(0);
    expect(state.javaScriptTypeScriptSyncedDocumentContentRef.current).toEqual({});
    expect(state.javaScriptTypeScriptPendingDocumentChangesRef.current).toEqual({});
    expect(
      state.javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef.current,
    ).toEqual({});
    expect(state.javaScriptTypeScriptDocumentVersionsRef.current).toEqual({});
    expect(state.javaScriptTypeScriptDocumentVersionsByUriRef.current).toEqual({});
    expect(
      state.javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef.current,
    ).toEqual({});
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

    expect(harness.current.clearDocumentChangeTimer).toBe(
      initial.clearDocumentChangeTimer,
    );
    expect(harness.current.clearJavaScriptTypeScriptDocumentChangeTimer).toBe(
      initial.clearJavaScriptTypeScriptDocumentChangeTimer,
    );
    expect(harness.current.enqueueDocumentSync).toBe(initial.enqueueDocumentSync);
    expect(harness.current.enqueueJavaScriptTypeScriptDocumentSync).toBe(
      initial.enqueueJavaScriptTypeScriptDocumentSync,
    );
    expect(harness.current.getPhpDocumentSyncVersion).toBe(
      initial.getPhpDocumentSyncVersion,
    );
    expect(harness.current.nextDocumentVersion).toBe(initial.nextDocumentVersion);
    expect(harness.current.nextJavaScriptTypeScriptDocumentVersion).toBe(
      initial.nextJavaScriptTypeScriptDocumentVersion,
    );
    expect(
      harness.current.resetJavaScriptTypeScriptLanguageServerDocuments,
    ).toBe(initial.resetJavaScriptTypeScriptLanguageServerDocuments);
    expect(harness.current.resetLanguageServerDocuments).toBe(
      initial.resetLanguageServerDocuments,
    );
  });

  it("updates path-key and uri-key version maps", () => {
    const harness = renderHook();
    const state = harness.current;
    const rootPath = "/workspace";
    const phpPath = "/workspace/app/User.php";
    const tsPath = "/workspace/src/index.ts";

    expect(state.nextDocumentVersion(rootPath, phpPath)).toBe(1);
    expect(
      state.documentVersionsRef.current[
        languageServerDocumentSyncKey(rootPath, phpPath)
      ],
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
});
