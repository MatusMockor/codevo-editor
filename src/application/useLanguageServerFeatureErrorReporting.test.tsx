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
import {
  createWorkbenchNotice,
  type WorkbenchNotice,
} from "./workbenchNotice";

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

  it("suppresses a cancelled textDocument/codeAction while the workspace remains active", () => {
    const harness = renderHook();

    act(() => {
      harness.api.reportLanguageServerError(
        "Language server request `textDocument/codeAction` was cancelled.",
      );
    });

    expect(harness.currentWorkspaceRootRef.current).toBe(ROOT);
    expect(harness.message.value).toBeNull();
    expect(harness.lastLanguageServerCrashRef.current).toBeNull();
    expect(harness.notices.value).toEqual([]);

    act(() => {
      harness.root.unmount();
    });
  });

  it("suppresses a structured ServerCancelled code-action response", () => {
    const harness = renderHook();

    act(() => {
      harness.api.reportLanguageServerError({
        code: -32802,
        message: "Server cancelled obsolete code action",
      });
    });

    expect(harness.message.value).toBeNull();
    expect(harness.lastLanguageServerCrashRef.current).toBeNull();
    expect(harness.notices.value).toEqual([]);

    act(() => {
      harness.root.unmount();
    });
  });

  it.each([
    "Language server request `textDocument/codeAction` timed out.",
    "Internal error: code action failed",
  ])("reports request failures separately from runtime crashes", (error) => {
    const harness = renderHook();

    act(() => {
      harness.api.reportLanguageServerError(error);
    });

    expect(harness.message.value).toBe(error);
    expect(harness.lastLanguageServerCrashRef.current).toBeNull();
    expect(harness.notices.value[0]).toMatchObject({
      groupKey: "language-server-request-error:/workspace",
      message: error,
      severity: "error",
      source: "Language Server",
    });

    act(() => {
      harness.root.unmount();
    });
  });

  it("reports a structured non-cancellation response with its server message", () => {
    const harness = renderHook();

    act(() => {
      harness.api.reportLanguageServerError({
        code: -32603,
        message: "PHPactor code action failed",
      });
    });

    expect(harness.message.value).toBe("PHPactor code action failed");
    expect(harness.notices.value[0]).toMatchObject({
      groupKey: "language-server-request-error:/workspace",
      message: "PHPactor code action failed",
      severity: "error",
    });

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

  it("suppresses a structured UnknownDocument only for an unsynced document", () => {
    const harness = renderHook();

    act(() => {
      harness.api.reportLanguageServerError({
        code: -32603,
        message: unknownDocumentError(),
      });
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
      groupKey: "language-server-request-error:/workspace",
      message: error,
      severity: "error",
      source: "Language Server",
    });

    act(() => {
      harness.root.unmount();
    });
  });

  it("reports a structured UnknownDocument for a synced document as a request failure", () => {
    const harness = renderHook();
    const error = unknownDocumentError();
    harness.syncedDocumentPathsRef.current.add(
      languageServerDocumentSyncKey(ROOT, PATH),
    );

    act(() => {
      harness.api.reportLanguageServerError({ code: -32603, message: error });
    });

    expect(harness.lastLanguageServerCrashRef.current).toBeNull();
    expect(harness.notices.value[0]).toMatchObject({
      groupKey: "language-server-request-error:/workspace",
      message: error,
      severity: "error",
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

  it("replaces the grouped request notice without marking the runtime as crashed", () => {
    const harness = renderHook();
    const error = "Internal error: completion crashed";

    act(() => {
      harness.api.reportLanguageServerError(error);
      harness.api.reportLanguageServerError(error);
    });

    expect(harness.message.value).toBe(error);
    expect(harness.lastLanguageServerCrashRef.current).toBeNull();
    expect(harness.notices.value).toHaveLength(1);
    expect(harness.notices.value[0]).toMatchObject({
      groupKey: "language-server-request-error:/workspace",
      message: error,
      source: "Language Server",
      toastDismissKey: JSON.stringify([
        "language-server-request-error",
        "/workspace",
        error,
      ]),
    });

    act(() => {
      harness.root.unmount();
    });
  });

  it("groups and deduplicates actual runtime crashes separately", () => {
    const harness = renderHook();
    const error = "Language server exited unexpectedly.";

    act(() => {
      harness.api.reportLanguageServerCrash(error);
      harness.api.reportLanguageServerCrash(error);
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

  it("replaces only the current workspace crash group with the latest message", () => {
    const harness = renderHook();
    const otherWorkspaceCrash = createWorkbenchNotice(
      "error",
      "Language Server",
      "Other workspace crashed.",
      "language-server-crash:/other-workspace",
    );
    const unrelatedNotice = createWorkbenchNotice(
      "warning",
      "Git",
      "Repository has uncommitted changes.",
      "git-status",
    );
    harness.notices.set([otherWorkspaceCrash, unrelatedNotice]);

    act(() => {
      harness.api.reportLanguageServerCrash("First workspace crash.");
      harness.api.reportLanguageServerCrash("Second workspace crash.");
    });

    expect(harness.message.value).toBe("Second workspace crash.");
    expect(harness.lastLanguageServerCrashRef.current).toBe(
      "Second workspace crash.",
    );
    expect(harness.notices.value).toHaveLength(3);
    expect(harness.notices.value[0]).toMatchObject({
      groupKey: "language-server-crash:/workspace",
      message: "Second workspace crash.",
    });
    expect(harness.notices.value).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: "First workspace crash." }),
      ]),
    );
    expect(harness.notices.value).toContain(otherWorkspaceCrash);
    expect(harness.notices.value).toContain(unrelatedNotice);

    act(() => {
      harness.root.unmount();
    });
  });

  it("continues appending differently worded crashes without a workspace root", () => {
    const harness = renderHook();
    harness.currentWorkspaceRootRef.current = null;

    act(() => {
      harness.api.reportLanguageServerCrash("First unscoped crash.");
      harness.api.reportLanguageServerCrash("Second unscoped crash.");
    });

    expect(harness.notices.value.map(({ groupKey, message }) => ({
      groupKey,
      message,
    }))).toEqual([
      { groupKey: undefined, message: "Second unscoped crash." },
      { groupKey: undefined, message: "First unscoped crash." },
    ]);

    act(() => {
      harness.root.unmount();
    });
  });
});
