// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useLanguageServerDiagnosticsSubscriptions,
  type LanguageServerDiagnosticsRuntimeKind,
  type LanguageServerDiagnosticsSubscriptionsDependencies,
} from "./useLanguageServerDiagnosticsSubscriptions";
import type {
  DiagnosticsCoalescer,
  DiagnosticsFlushScheduler,
} from "../domain/diagnosticsCoalescer";
import type {
  DiagnosticsUnsubscribeFn,
  LanguageServerDiagnosticEvent,
  LanguageServerDiagnosticsGateway,
} from "../domain/languageServerDiagnostics";
import { fileUriFromPath } from "../domain/languageServerDocumentSync";
import {
  createLegacyWorkspaceRuntimeOwner,
  createWorkspaceRuntimeOwner,
  transferWorkspaceRuntimeOwner,
  type WorkspaceRuntimeOwner,
} from "../domain/workspaceRuntimeOwner";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ROOT = "/workspace";

type MutableRef<T> = { current: T };

interface Deferred<T> {
  promise: Promise<T>;
  reject(error: unknown): void;
  resolve(value: T): void;
}

interface FakeCoalescer {
  coalescer: DiagnosticsCoalescer;
  dispose: ReturnType<typeof vi.fn>;
  dropOwner: ReturnType<typeof vi.fn>;
  enqueue: ReturnType<typeof vi.fn>;
  sink: (event: LanguageServerDiagnosticEvent) => void;
}

interface DiagnosticsGatewayHarness {
  gateway: LanguageServerDiagnosticsGateway;
  listeners: ((event: LanguageServerDiagnosticEvent) => void)[];
  subscribeDiagnostics: ReturnType<typeof vi.fn>;
}

function ref<T>(value: T): MutableRef<T> {
  return { current: value };
}

function createDeferred<T>(): Deferred<T> {
  let resolveValue: ((value: T) => void) | null = null;
  let rejectValue: ((error: unknown) => void) | null = null;
  const promise = new Promise<T>((resolve, reject) => {
    resolveValue = resolve;
    rejectValue = reject;
  });

  return {
    promise,
    reject(error: unknown) {
      rejectValue?.(error);
    },
    resolve(value: T) {
      resolveValue?.(value);
    },
  };
}

function fakeCoalescer(
  sink: (event: LanguageServerDiagnosticEvent) => void = vi.fn(),
): FakeCoalescer {
  const dispose = vi.fn();
  const dropOwner = vi.fn();
  const enqueue = vi.fn();
  return {
    coalescer: {
      dispose,
      dropOwner,
      enqueue,
    } as unknown as DiagnosticsCoalescer,
    dispose,
    dropOwner,
    enqueue,
    sink,
  };
}

function eventFor(path = `${ROOT}/app/User.php`): LanguageServerDiagnosticEvent {
  return {
    diagnostics: [],
    rootPath: ROOT,
    sessionId: 1,
    uri: fileUriFromPath(path),
    version: null,
  };
}

function immediateGateway(): DiagnosticsGatewayHarness {
  const listeners: DiagnosticsGatewayHarness["listeners"] = [];
  const subscribeDiagnostics = vi.fn(
    async (listener: (event: LanguageServerDiagnosticEvent) => void) => {
      listeners.push(listener);
      return vi.fn();
    },
  );

  return {
    gateway: { subscribeDiagnostics },
    listeners,
    subscribeDiagnostics,
  };
}

function deferredGateway(
  deferred: Deferred<DiagnosticsUnsubscribeFn>,
): DiagnosticsGatewayHarness {
  const listeners: DiagnosticsGatewayHarness["listeners"] = [];
  const subscribeDiagnostics = vi.fn(
    (listener: (event: LanguageServerDiagnosticEvent) => void) => {
      listeners.push(listener);
      return deferred.promise;
    },
  );

  return {
    gateway: { subscribeDiagnostics },
    listeners,
    subscribeDiagnostics,
  };
}

const scheduler: DiagnosticsFlushScheduler = {
  cancel: vi.fn(),
  schedule: vi.fn(() => 1),
};

function baseDependencies(
  overrides: Partial<LanguageServerDiagnosticsSubscriptionsDependencies> = {},
): {
  coalescers: FakeCoalescer[];
  dependencies: LanguageServerDiagnosticsSubscriptionsDependencies;
  javaScriptTypeScriptGateway: DiagnosticsGatewayHarness;
  phpGateway: DiagnosticsGatewayHarness;
} {
  const coalescers: FakeCoalescer[] = [];
  const phpGateway = immediateGateway();
  const javaScriptTypeScriptGateway = immediateGateway();
  const dependencies: LanguageServerDiagnosticsSubscriptionsDependencies = {
    workspaceRoot: ROOT,
    currentWorkspaceRootRef: ref(ROOT),
    diagnosticsFlushSchedulerRef: ref(scheduler),
    languageServerDiagnosticsCoalescerRef: ref(null),
    javaScriptTypeScriptDiagnosticsCoalescerRef: ref(null),
    languageServerDiagnosticsGateway: phpGateway.gateway,
    javaScriptTypeScriptLanguageServerDiagnosticsGateway:
      javaScriptTypeScriptGateway.gateway,
    createDiagnosticsCoalescer: vi.fn((sink) => {
      const coalescer = fakeCoalescer(sink);
      coalescers.push(coalescer);
      return coalescer.coalescer;
    }),
    applyLanguageServerDiagnostics: vi.fn(),
    applyJavaScriptTypeScriptLanguageServerDiagnostics: vi.fn(),
    reportLanguageServerError: vi.fn(),
    reportJavaScriptTypeScriptLanguageServerError: vi.fn(),
    ...overrides,
  };

  return {
    coalescers,
    dependencies,
    javaScriptTypeScriptGateway,
    phpGateway,
  };
}

let mountedRoot: Root | null = null;
let container: HTMLDivElement | null = null;

function renderHook(
  dependencies: LanguageServerDiagnosticsSubscriptionsDependencies,
): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  mountedRoot = createRoot(container);

  function Harness() {
    useLanguageServerDiagnosticsSubscriptions(dependencies);
    return null;
  }

  act(() => {
    mountedRoot?.render(<Harness />);
  });
}

async function flushAsyncTurns(count = 4): Promise<void> {
  await act(async () => {
    for (let index = 0; index < count; index += 1) {
      await Promise.resolve();
    }
  });
}

afterEach(() => {
  if (mountedRoot) {
    act(() => {
      mountedRoot?.unmount();
    });
  }
  mountedRoot = null;
  container?.remove();
  container = null;
  vi.clearAllMocks();
});

describe("useLanguageServerDiagnosticsSubscriptions", () => {
  it("subscribes both diagnostic gateways and enqueues events while mounted", async () => {
    const { coalescers, dependencies, javaScriptTypeScriptGateway, phpGateway } =
      baseDependencies();

    renderHook(dependencies);
    await flushAsyncTurns();

    const phpEvent = eventFor();
    const tsEvent = eventFor(`${ROOT}/src/App.ts`);

    act(() => {
      phpGateway.listeners[0]?.(phpEvent);
      javaScriptTypeScriptGateway.listeners[0]?.(tsEvent);
    });

    expect(coalescers[0]?.enqueue).toHaveBeenCalledWith(phpEvent);
    expect(coalescers[1]?.enqueue).toHaveBeenCalledWith(tsEvent);

    coalescers[0]?.sink(phpEvent);
    coalescers[1]?.sink(tsEvent);

    expect(dependencies.applyLanguageServerDiagnostics).toHaveBeenCalledWith(
      phpEvent,
    );
    expect(
      dependencies.applyJavaScriptTypeScriptLanguageServerDiagnostics,
    ).toHaveBeenCalledWith(tsEvent);

    act(() => {
      mountedRoot?.unmount();
    });

    act(() => {
      phpGateway.listeners[0]?.(eventFor());
      javaScriptTypeScriptGateway.listeners[0]?.(eventFor(`${ROOT}/src/App.ts`));
    });

    expect(coalescers[0]?.enqueue).toHaveBeenCalledTimes(1);
    expect(coalescers[1]?.enqueue).toHaveBeenCalledTimes(1);
    expect(coalescers[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(coalescers[1]?.dispose).toHaveBeenCalledTimes(1);
    expect(dependencies.languageServerDiagnosticsCoalescerRef.current).toBeNull();
    expect(
      dependencies.javaScriptTypeScriptDiagnosticsCoalescerRef.current,
    ).toBeNull();
  });

  it("disposes a late subscription result after cleanup", async () => {
    const phpDeferred = createDeferred<DiagnosticsUnsubscribeFn>();
    const tsDeferred = createDeferred<DiagnosticsUnsubscribeFn>();
    const phpDispose = vi.fn();
    const tsDispose = vi.fn();
    const phpGateway = deferredGateway(phpDeferred);
    const javaScriptTypeScriptGateway = deferredGateway(tsDeferred);
    const { coalescers, dependencies } = baseDependencies({
      languageServerDiagnosticsGateway: phpGateway.gateway,
      javaScriptTypeScriptLanguageServerDiagnosticsGateway:
        javaScriptTypeScriptGateway.gateway,
    });

    renderHook(dependencies);

    act(() => {
      mountedRoot?.unmount();
    });

    phpDeferred.resolve(phpDispose);
    tsDeferred.resolve(tsDispose);
    await flushAsyncTurns();

    expect(phpDispose).toHaveBeenCalledTimes(1);
    expect(tsDispose).toHaveBeenCalledTimes(1);
    expect(coalescers[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(coalescers[1]?.dispose).toHaveBeenCalledTimes(1);
  });

  it("captures one owner for alias events, coalescer keys, sinks, and cleanup", async () => {
    const owner = createWorkspaceRuntimeOwner("workspace-id", ROOT);
    const { coalescers, dependencies, javaScriptTypeScriptGateway, phpGateway } =
      baseDependencies({
        workspaceRuntimeOwner: owner,
        resolveCurrentWorkspaceRuntimeOwner: () => owner,
        resolveWorkspaceRuntimeOwnerForDiagnosticsEvent: () => owner,
      });

    renderHook(dependencies);
    await flushAsyncTurns();

    const firstAliasEvent = eventFor();
    const secondAliasEvent = {
      ...eventFor(),
      rootPath: "/workspace-alias",
      version: 2,
    };

    act(() => {
      phpGateway.listeners[0]?.(firstAliasEvent);
      phpGateway.listeners[0]?.(secondAliasEvent);
      javaScriptTypeScriptGateway.listeners[0]?.(secondAliasEvent);
    });

    expect(coalescers[0]?.enqueue).toHaveBeenNthCalledWith(
      1,
      firstAliasEvent,
      owner.ownerKey,
    );
    expect(coalescers[0]?.enqueue).toHaveBeenNthCalledWith(
      2,
      secondAliasEvent,
      owner.ownerKey,
    );
    expect(coalescers[1]?.enqueue).toHaveBeenCalledWith(
      secondAliasEvent,
      owner.ownerKey,
    );

    coalescers[0]?.sink(secondAliasEvent);
    coalescers[1]?.sink(secondAliasEvent);

    expect(dependencies.applyLanguageServerDiagnostics).toHaveBeenCalledWith(
      secondAliasEvent,
      owner,
    );
    expect(
      dependencies.applyJavaScriptTypeScriptLanguageServerDiagnostics,
    ).toHaveBeenCalledWith(secondAliasEvent, owner);

    act(() => {
      mountedRoot?.unmount();
    });

    expect(coalescers[0]?.dropOwner).toHaveBeenCalledWith(owner.ownerKey);
    expect(coalescers[1]?.dropOwner).toHaveBeenCalledWith(owner.ownerKey);
  });

  it("keeps identical PHP and TS sessions in separate owner namespaces", async () => {
    const foregroundOwner = createWorkspaceRuntimeOwner("foreground-id", ROOT);
    const backgroundRoot = "/background-workspace";
    const phpBackgroundOwner = createWorkspaceRuntimeOwner(
      "php-background-id",
      backgroundRoot,
    );
    const typeScriptBackgroundOwner = createWorkspaceRuntimeOwner(
      "typescript-background-id",
      backgroundRoot,
    );
    const ambiguousOwner = createWorkspaceRuntimeOwner("other-id", ROOT);
    const ambiguousOwners = [foregroundOwner, ambiguousOwner];
    const ownersByRuntimeKind = {
      php: new Map([[1, phpBackgroundOwner]]),
      typescript: new Map([[1, typeScriptBackgroundOwner]]),
    };
    const resolveEventOwner = vi.fn(
      (
        event: LanguageServerDiagnosticEvent,
        runtimeKind: LanguageServerDiagnosticsRuntimeKind,
      ) => {
        if (event.rootPath === ROOT && ambiguousOwners.length > 1) {
          return null;
        }

        if (event.rootPath !== backgroundRoot) {
          return null;
        }

        return ownersByRuntimeKind[runtimeKind].get(event.sessionId) ?? null;
      },
    );
    const { coalescers, dependencies, javaScriptTypeScriptGateway, phpGateway } =
      baseDependencies({
        workspaceRuntimeOwner: foregroundOwner,
        resolveCurrentWorkspaceRuntimeOwner: () => foregroundOwner,
        resolveWorkspaceRuntimeOwnerForDiagnosticsEvent: resolveEventOwner,
      });

    renderHook(dependencies);
    await flushAsyncTurns();

    const backgroundEvent = {
      ...eventFor(`${backgroundRoot}/app/Background.php`),
      rootPath: backgroundRoot,
    };
    const ambiguousSameRootEvent = {
      ...eventFor(),
      diagnostics: [],
    };

    act(() => {
      phpGateway.listeners[0]?.(backgroundEvent);
      javaScriptTypeScriptGateway.listeners[0]?.(backgroundEvent);
      phpGateway.listeners[0]?.(ambiguousSameRootEvent);
      javaScriptTypeScriptGateway.listeners[0]?.(ambiguousSameRootEvent);
    });

    expect(coalescers[0]?.enqueue).toHaveBeenCalledOnce();
    expect(coalescers[0]?.enqueue).toHaveBeenCalledWith(
      backgroundEvent,
      phpBackgroundOwner.ownerKey,
    );
    expect(coalescers[1]?.enqueue).toHaveBeenCalledOnce();
    expect(coalescers[1]?.enqueue).toHaveBeenCalledWith(
      backgroundEvent,
      typeScriptBackgroundOwner.ownerKey,
    );

    coalescers[0]?.sink(backgroundEvent);
    coalescers[1]?.sink(backgroundEvent);

    expect(dependencies.applyLanguageServerDiagnostics).toHaveBeenCalledWith(
      backgroundEvent,
      phpBackgroundOwner,
    );
    expect(
      dependencies.applyJavaScriptTypeScriptLanguageServerDiagnostics,
    ).toHaveBeenCalledWith(backgroundEvent, typeScriptBackgroundOwner);
    expect(resolveEventOwner).toHaveBeenCalledWith(backgroundEvent, "php");
    expect(resolveEventOwner).toHaveBeenCalledWith(
      backgroundEvent,
      "typescript",
    );
    expect(dependencies.applyLanguageServerDiagnostics).not.toHaveBeenCalledWith(
      backgroundEvent,
      foregroundOwner,
    );
    expect(
      dependencies.applyJavaScriptTypeScriptLanguageServerDiagnostics,
    ).not.toHaveBeenCalledWith(backgroundEvent, foregroundOwner);
  });

  it("preserves legacy event roots while rejecting rootless publications", async () => {
    const owner = createLegacyWorkspaceRuntimeOwner(ROOT);
    const { coalescers, dependencies, javaScriptTypeScriptGateway, phpGateway } =
      baseDependencies({ workspaceRuntimeOwner: owner });

    renderHook(dependencies);
    await flushAsyncTurns();

    const rootlessEvent = { ...eventFor(), rootPath: "" };
    const backgroundEvent = {
      ...eventFor("/background-workspace/app/Background.php"),
      rootPath: "/background-workspace",
    };

    act(() => {
      phpGateway.listeners[0]?.(rootlessEvent);
      javaScriptTypeScriptGateway.listeners[0]?.(rootlessEvent);
      phpGateway.listeners[0]?.(backgroundEvent);
      javaScriptTypeScriptGateway.listeners[0]?.(backgroundEvent);
    });

    expect(coalescers[0]?.enqueue).toHaveBeenCalledOnce();
    expect(coalescers[0]?.enqueue).toHaveBeenCalledWith(backgroundEvent);
    expect(coalescers[1]?.enqueue).toHaveBeenCalledOnce();
    expect(coalescers[1]?.enqueue).toHaveBeenCalledWith(backgroundEvent);

    coalescers[0]?.sink(backgroundEvent);
    coalescers[1]?.sink(backgroundEvent);

    expect(dependencies.applyLanguageServerDiagnostics).toHaveBeenCalledWith(
      backgroundEvent,
    );
    expect(dependencies.applyLanguageServerDiagnostics).toHaveBeenCalledOnce();
    expect(
      dependencies.applyJavaScriptTypeScriptLanguageServerDiagnostics,
    ).toHaveBeenCalledWith(backgroundEvent);
    expect(
      dependencies.applyJavaScriptTypeScriptLanguageServerDiagnostics,
    ).toHaveBeenCalledOnce();

    act(() => {
      mountedRoot?.unmount();
    });

    expect(coalescers[0]?.dropOwner).not.toHaveBeenCalled();
    expect(coalescers[1]?.dropOwner).not.toHaveBeenCalled();
  });

  it("isolates same-root owner generations while accepting a same-ID alias", async () => {
    const subscribedOwner = createWorkspaceRuntimeOwner("workspace-a", ROOT);
    let currentOwner: WorkspaceRuntimeOwner = transferWorkspaceRuntimeOwner(
      subscribedOwner,
      "/workspace-alias",
    );
    const aliasPhpDeferred = createDeferred<DiagnosticsUnsubscribeFn>();
    const aliasTsDeferred = createDeferred<DiagnosticsUnsubscribeFn>();
    const alias = baseDependencies({
      workspaceRuntimeOwner: subscribedOwner,
      resolveCurrentWorkspaceRuntimeOwner: () => currentOwner,
      languageServerDiagnosticsGateway: deferredGateway(aliasPhpDeferred).gateway,
      javaScriptTypeScriptLanguageServerDiagnosticsGateway:
        deferredGateway(aliasTsDeferred).gateway,
    });

    renderHook(alias.dependencies);
    const aliasPhpError = new Error("alias php failure");
    const aliasTsError = new Error("alias ts failure");
    aliasPhpDeferred.reject(aliasPhpError);
    aliasTsDeferred.reject(aliasTsError);
    await flushAsyncTurns();

    expect(alias.dependencies.reportLanguageServerError).toHaveBeenCalledWith(
      aliasPhpError,
    );
    expect(
      alias.dependencies.reportJavaScriptTypeScriptLanguageServerError,
    ).toHaveBeenCalledWith(aliasTsError);

    act(() => {
      mountedRoot?.unmount();
    });

    const replacementOwner = createWorkspaceRuntimeOwner("workspace-b", ROOT);
    currentOwner = replacementOwner;
    const stalePhpDeferred = createDeferred<DiagnosticsUnsubscribeFn>();
    const staleTsDeferred = createDeferred<DiagnosticsUnsubscribeFn>();
    const stale = baseDependencies({
      workspaceRuntimeOwner: subscribedOwner,
      resolveCurrentWorkspaceRuntimeOwner: () => currentOwner,
      languageServerDiagnosticsGateway: deferredGateway(stalePhpDeferred).gateway,
      javaScriptTypeScriptLanguageServerDiagnosticsGateway:
        deferredGateway(staleTsDeferred).gateway,
    });

    renderHook(stale.dependencies);
    stalePhpDeferred.reject(new Error("stale php generation"));
    staleTsDeferred.reject(new Error("stale ts generation"));
    await flushAsyncTurns();

    expect(stale.dependencies.reportLanguageServerError).not.toHaveBeenCalled();
    expect(
      stale.dependencies.reportJavaScriptTypeScriptLanguageServerError,
    ).not.toHaveBeenCalled();
  });

  it("reports subscription errors only for the still-active workspace root", async () => {
    const phpDeferred = createDeferred<DiagnosticsUnsubscribeFn>();
    const tsDeferred = createDeferred<DiagnosticsUnsubscribeFn>();
    const phpGateway = deferredGateway(phpDeferred);
    const javaScriptTypeScriptGateway = deferredGateway(tsDeferred);
    const { dependencies } = baseDependencies({
      languageServerDiagnosticsGateway: phpGateway.gateway,
      javaScriptTypeScriptLanguageServerDiagnosticsGateway:
        javaScriptTypeScriptGateway.gateway,
    });

    renderHook(dependencies);

    const phpError = new Error("php subscription failed");
    const tsError = new Error("ts subscription failed");
    phpDeferred.reject(phpError);
    tsDeferred.reject(tsError);
    await flushAsyncTurns();

    expect(dependencies.reportLanguageServerError).toHaveBeenCalledWith(phpError);
    expect(
      dependencies.reportJavaScriptTypeScriptLanguageServerError,
    ).toHaveBeenCalledWith(tsError);

    const stalePhpDeferred = createDeferred<DiagnosticsUnsubscribeFn>();
    const staleTsDeferred = createDeferred<DiagnosticsUnsubscribeFn>();
    const stalePhpGateway = deferredGateway(stalePhpDeferred);
    const staleTsGateway = deferredGateway(staleTsDeferred);
    const stale = baseDependencies({
      currentWorkspaceRootRef: ref("/other-workspace"),
      languageServerDiagnosticsGateway: stalePhpGateway.gateway,
      javaScriptTypeScriptLanguageServerDiagnosticsGateway: staleTsGateway.gateway,
    });

    act(() => {
      mountedRoot?.unmount();
    });
    renderHook(stale.dependencies);

    stalePhpDeferred.reject(new Error("stale php"));
    staleTsDeferred.reject(new Error("stale ts"));
    await flushAsyncTurns();

    expect(stale.dependencies.reportLanguageServerError).not.toHaveBeenCalled();
    expect(
      stale.dependencies.reportJavaScriptTypeScriptLanguageServerError,
    ).not.toHaveBeenCalled();
  });
});
