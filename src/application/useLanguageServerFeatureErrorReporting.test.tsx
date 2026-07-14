// @vitest-environment jsdom

import { act, type Dispatch, type SetStateAction } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fileUriFromPath,
  languageServerDocumentSyncKey,
} from "../domain/languageServerDocumentSync";
import {
  useLanguageServerFeatureErrorReporting,
  type LanguageServerFeatureErrorReporting,
  type LanguageServerFeatureErrorReportingDependencies,
} from "./useLanguageServerFeatureErrorReporting";
import type { WorkbenchNotice } from "./workbenchNotice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ROOT = "/workspace";
const OTHER_ROOT = "/other-workspace";
const PATH = "/workspace/app/Models/User.php";

type MutableRef<T> = { current: T };

interface StateHolder<T> {
  set: Dispatch<SetStateAction<T>>;
  value: T;
}

interface Harness {
  api: LanguageServerFeatureErrorReporting;
  currentWorkspaceRootRef: MutableRef<string | null>;
  javaScriptTypeScriptSyncedDocumentPathsRef: MutableRef<Set<string>>;
  lastLanguageServerCrashRef: MutableRef<string | null>;
  message: StateHolder<string | null>;
  notices: StateHolder<WorkbenchNotice[]>;
  root: Root;
  syncedDocumentPathsRef: MutableRef<Set<string>>;
}

function ref<T>(value: T): MutableRef<T> {
  return { current: value };
}

function stateHolder<T>(initial: T): StateHolder<T> {
  const holder: StateHolder<T> = {
    set: (update) => {
      holder.value =
        typeof update === "function"
          ? (update as (previous: T) => T)(holder.value)
          : update;
    },
    value: initial,
  };

  return holder;
}

function unknownDocumentError(path: string = PATH): string {
  return `UnknownDocument: Unknown text document "${fileUriFromPath(path)}"`;
}

function renderHook(): Harness {
  const currentWorkspaceRootRef = ref<string | null>(ROOT);
  const syncedDocumentPathsRef = ref(new Set<string>());
  const javaScriptTypeScriptSyncedDocumentPathsRef = ref(new Set<string>());
  const lastLanguageServerCrashRef = ref<string | null>(null);
  const message = stateHolder<string | null>(null);
  const notices = stateHolder<WorkbenchNotice[]>([]);
  const host = document.createElement("div");
  const root = createRoot(host);
  const harness = {} as Harness;

  function TestComponent() {
    const api = useLanguageServerFeatureErrorReporting({
      currentWorkspaceRootRef,
      javaScriptTypeScriptSyncedDocumentPathsRef,
      lastLanguageServerCrashRef,
      setMessage: message.set,
      setNotices: notices.set,
      syncedDocumentPathsRef,
    } satisfies LanguageServerFeatureErrorReportingDependencies);

    harness.api = api;
    return null;
  }

  act(() => {
    root.render(<TestComponent />);
  });

  Object.assign(harness, {
    currentWorkspaceRootRef,
    javaScriptTypeScriptSyncedDocumentPathsRef,
    lastLanguageServerCrashRef,
    message,
    notices,
    root,
    syncedDocumentPathsRef,
  });

  return harness;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useLanguageServerFeatureErrorReporting", () => {
  it("suppresses benign errors before updating message or notices", () => {
    const harness = renderHook();
    const cancellation = new Error("request superseded");
    cancellation.name = "CanceledError";

    act(() => {
      harness.api.reportLanguageServerError(cancellation);
    });

    expect(harness.message.value).toBeNull();
    expect(harness.notices.value).toEqual([]);

    act(() => {
      harness.root.unmount();
    });
  });

  it("suppresses UnknownDocument only when neither synced set contains the document", () => {
    const harness = renderHook();

    act(() => {
      harness.api.reportLanguageServerError(unknownDocumentError());
    });

    expect(harness.message.value).toBeNull();
    expect(harness.notices.value).toEqual([]);

    act(() => {
      harness.root.unmount();
    });
  });

  it("reports UnknownDocument when the PHP synced set contains the document", () => {
    const harness = renderHook();
    const error = unknownDocumentError();
    harness.syncedDocumentPathsRef.current.add(
      languageServerDocumentSyncKey(ROOT, PATH),
    );

    act(() => {
      harness.api.reportLanguageServerError(error);
    });

    expect(harness.message.value).toBe(error);
    expect(harness.notices.value[0]).toMatchObject({
      groupKey: "language-server-crash:/workspace",
      message: error,
      severity: "error",
      source: "Language Server",
    });

    act(() => {
      harness.root.unmount();
    });
  });

  it("reports UnknownDocument when the JavaScript/TypeScript synced set contains the document", () => {
    const harness = renderHook();
    const error = unknownDocumentError();
    harness.javaScriptTypeScriptSyncedDocumentPathsRef.current.add(
      languageServerDocumentSyncKey(ROOT, PATH),
    );

    act(() => {
      harness.api.reportLanguageServerError(error);
    });

    expect(harness.message.value).toBe(error);
    expect(harness.notices.value[0]?.message).toBe(error);

    act(() => {
      harness.root.unmount();
    });
  });

  it("ignores root-scoped reports for stale workspace roots before reporting", () => {
    const harness = renderHook();

    act(() => {
      harness.api.reportLanguageServerErrorForActiveWorkspaceRoot(
        OTHER_ROOT,
        "Internal error: hover crashed",
      );
    });

    expect(harness.message.value).toBeNull();
    expect(harness.notices.value).toEqual([]);

    act(() => {
      harness.root.unmount();
    });
  });

  it("deduplicates repeated crash notices while preserving the latest message", () => {
    const harness = renderHook();
    const error = "Internal error: completion crashed";

    act(() => {
      harness.api.reportLanguageServerError(error);
      harness.api.reportLanguageServerError(error);
    });

    expect(harness.message.value).toBe(error);
    expect(harness.lastLanguageServerCrashRef.current).toBe(error);
    expect(harness.notices.value).toHaveLength(1);
    expect(harness.notices.value[0]).toMatchObject({
      groupKey: "language-server-crash:/workspace",
      message: error,
      source: "Language Server",
    });

    act(() => {
      harness.root.unmount();
    });
  });
});
