// @vitest-environment jsdom

import { act, type MutableRefObject } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectSymbolSearchResult } from "../domain/projectSymbols";
import {
  emptyLanguageServerCapabilities,
  type LanguageServerRuntimeStatus,
} from "../domain/languageServerRuntime";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import {
  INDEXED_PROJECT_SYMBOL_SEARCH_TIMEOUT_MS,
  useWorkbenchClassOpen,
  type WorkbenchClassOpen,
  type WorkbenchClassOpenDependencies,
} from "./useWorkbenchClassOpen";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
  vi.useRealTimers();
});

describe("useWorkbenchClassOpen indexed search lifecycle", () => {
  it("aborts indexed backend work at the bounded request deadline", async () => {
    vi.useFakeTimers();
    let receivedSignal: AbortSignal | undefined;
    const harness = renderClassOpen(
      dependencies({
        projectSymbolSearch: {
          searchProjectSymbols: vi.fn((_root, _query, _limit, signal) => {
            receivedSignal = signal;
            return new Promise<ProjectSymbolSearchResult[]>((_resolve, reject) => {
              signal?.addEventListener(
                "abort",
                () => reject(new DOMException("cancelled", "AbortError")),
                { once: true },
              );
            });
          }),
        },
      }),
    );

    const request = harness.value().searchClassOpenSymbols("User", 120);
    const rejected = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INDEXED_PROJECT_SYMBOL_SEARCH_TIMEOUT_MS);
    });

    await rejected;
    expect(receivedSignal?.aborted).toBe(true);
    harness.unmount();
  });

  it("drops a late indexed result across a same-root A-B-A owner transition", async () => {
    const pending = deferred<ReturnType<typeof symbol>[]>();
    const ownerA = owner("owner-a");
    const ownerB = owner("owner-b");
    const ownerA2 = owner("owner-a2");
    let currentOwner = ownerA;
    const harness = renderClassOpen(
      dependencies({
        projectSymbolSearch: {
          searchProjectSymbols: vi.fn(() => pending.promise),
        },
        resolveWorkspaceRuntimeOwner: () => currentOwner,
        workspaceOwner: ownerA,
      }),
    );

    const request = harness.value().searchClassOpenSymbols("User", 120);
    currentOwner = ownerB;
    currentOwner = ownerA2;
    pending.resolve([symbol()]);

    await expect(request).resolves.toEqual([]);
    harness.unmount();
  });

  it("settles at the deadline when a legacy workspace-symbol provider hangs", async () => {
    vi.useFakeTimers();
    const status = runningWorkspaceSymbolStatus();
    const harness = renderClassOpen(
      dependencies({
        languageServerFeaturesGateway: {
          workspaceSymbols: vi.fn(() => new Promise(() => undefined)),
        } as never,
        languageServerRuntimeStatus: status,
        languageServerRuntimeStatusByRootRef: mutableRef({ "/project": status }),
        languageServerRuntimeStatusRef: mutableRef(status),
        languageServerRuntimeStatusRoot: "/project",
        languageServerRuntimeStatusRootRef: mutableRef("/project"),
      }),
    );

    const request = harness.value().searchClassOpenSymbols("User", 120);
    const rejected = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INDEXED_PROJECT_SYMBOL_SEARCH_TIMEOUT_MS);
    });

    await rejected;
    harness.unmount();
  });

  it("proactively aborts indexed work on same-root owner replacement", async () => {
    vi.useFakeTimers();
    let currentOwner = owner("owner-a");
    let indexedSignal: AbortSignal | undefined;
    const deps = dependencies({
      projectSymbolSearch: {
        searchProjectSymbols: vi.fn((_root, _query, _limit, signal) => {
          indexedSignal = signal;
          return new Promise<ProjectSymbolSearchResult[]>(() => undefined);
        }),
      },
      resolveWorkspaceRuntimeOwner: () => currentOwner,
      workspaceOwner: currentOwner,
    });
    const harness = renderClassOpen(deps);
    act(() => {
      harness.value().setClassOpenOpen(true);
      harness.value().setClassOpenQuery("User");
    });
    await act(async () => vi.advanceTimersByTimeAsync(120));

    currentOwner = owner("owner-b");
    harness.rerender();

    expect(indexedSignal?.aborted).toBe(true);
    harness.unmount();
  });
});

function dependencies(
  overrides: Partial<WorkbenchClassOpenDependencies> & {
    workspaceOwner?: WorkspaceRuntimeOwner;
  } = {},
): WorkbenchClassOpenDependencies {
  const workspaceOwner = overrides.workspaceOwner ?? owner("owner-a");
  const currentWorkspaceRootRef = mutableRef<string | null>("/project");
  return {
    cancelJavaScriptTypeScriptLanguageServerRequest: vi.fn(async () => undefined),
    currentWorkspaceRootRef,
    intelligenceMode: "lightSmart",
    javaScriptTypeScriptLanguageServerFeaturesGateway: {
      workspaceSymbols: vi.fn(),
    } as never,
    javaScriptTypeScriptLanguageServerRuntimeStatus: null,
    javaScriptTypeScriptRuntimeStatusByRootRef: mutableRef({}),
    javaScriptTypeScriptLanguageServerRuntimeStatusRef: mutableRef(null),
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot: null,
    javaScriptTypeScriptLanguageServerRuntimeStatusRootRef: mutableRef(null),
    languageServerFeaturesGateway: {
      workspaceSymbols: vi.fn(async () => []),
    } as never,
    languageServerRuntimeStatus: null,
    languageServerRuntimeStatusByRootRef: mutableRef({}),
    languageServerRuntimeStatusRef: mutableRef(null),
    languageServerRuntimeStatusRoot: null,
    languageServerRuntimeStatusRootRef: mutableRef(null),
    projectSymbolSearch: {
      searchProjectSymbols: vi.fn(async () => []),
    },
    reportError: vi.fn(),
    resolveWorkspaceRuntimeOwner: () => workspaceOwner,
    setMessage: vi.fn(),
    workspaceRoot: "/project",
    ...overrides,
  };
}

function renderClassOpen(deps: WorkbenchClassOpenDependencies) {
  const root = createRoot(document.createElement("div"));
  let current: WorkbenchClassOpen | null = null;
  const currentDeps = deps;
  function Harness() {
    current = useWorkbenchClassOpen(currentDeps);
    return null;
  }
  act(() => root.render(<Harness />));
  return {
    value: () => {
      if (!current) throw new Error("hook is not mounted");
      return current;
    },
    rerender: () =>
      act(() => {
        root.render(<Harness />);
      }),
    unmount: () => act(() => root.unmount()),
  };
}

function runningWorkspaceSymbolStatus(): LanguageServerRuntimeStatus {
  return {
    capabilities: {
      ...emptyLanguageServerCapabilities(),
      workspaceSymbol: true,
    },
    kind: "running",
    rootPath: "/project",
    sessionId: 7,
  };
}

function mutableRef<T>(current: T): MutableRefObject<T> {
  return { current };
}

function owner(ownerKey: string): WorkspaceRuntimeOwner {
  return {
    executionRoot: "/project",
    ownerKey: ownerKey as never,
  };
}

function symbol() {
  return {
    column: 1,
    containerName: "App",
    fullyQualifiedName: "App.User",
    kind: "class" as const,
    lineNumber: 1,
    name: "User",
    path: "/project/User.ts",
    relativePath: "User.ts",
  };
}

function deferred<T>() {
  let resolveValue: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve;
  });
  return {
    promise,
    resolve(value: T) {
      resolveValue?.(value);
    },
  };
}
