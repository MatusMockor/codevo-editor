// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useLanguageServerDiagnosticsSubscriptions,
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
  enqueue: ReturnType<typeof vi.fn>;
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

function fakeCoalescer(): FakeCoalescer {
  const dispose = vi.fn();
  const enqueue = vi.fn();
  return {
    coalescer: {
      dispose,
      enqueue,
    } as unknown as DiagnosticsCoalescer,
    dispose,
    enqueue,
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
    createDiagnosticsCoalescer: vi.fn(() => {
      const coalescer = fakeCoalescer();
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
