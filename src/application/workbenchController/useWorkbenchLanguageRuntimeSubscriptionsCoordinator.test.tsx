// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import {
  DiagnosticsCoalescer,
  type DiagnosticsFlushScheduler,
} from "../../domain/diagnosticsCoalescer";
import type {
  DiagnosticsUnsubscribeFn,
  LanguageServerDiagnosticEvent,
  LanguageServerDiagnosticsGateway,
} from "../../domain/languageServerDiagnostics";
import { emptyLanguageServerCapabilities } from "../../domain/languageServerRuntime";
import {
  createWorkspaceRuntimeOwner,
  type WorkspaceRuntimeOwner,
} from "../../domain/workspaceRuntimeOwner";
import { WorkspaceRuntimeOwnerClaimRegistry } from "../workspaceRuntimeOwnerClaimRegistry";
import {
  useWorkbenchLanguageRuntimeEventOwnerResolver,
  useWorkbenchLanguageRuntimeSessionCurrency,
  useWorkbenchLanguageRuntimeSubscriptionsCoordinator,
} from "./useWorkbenchLanguageRuntimeSubscriptionsCoordinator";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";

describe("language runtime subscription ownership", () => {
  it("isolates PHP and TypeScript across A1 to B to A2 and drops torn-down callbacks", async () => {
    const ownerA1 = createWorkspaceRuntimeOwner("workspace-a", ROOT);
    const ownerB = createWorkspaceRuntimeOwner("workspace-b", ROOT);
    const ownerA2 = createWorkspaceRuntimeOwner("workspace-a", ROOT);
    const registry = new WorkspaceRuntimeOwnerClaimRegistry();
    const phpStatuses = { current: {} as Record<string, ReturnType<typeof running>> };
    const typeScriptStatuses = { current: {} as Record<string, ReturnType<typeof running>> };
    const ownerByRoot = { current: {} as Record<string, WorkspaceRuntimeOwner> };
    const currentRoot = { current: ROOT as string | null };
    const phpStatus = { current: null as ReturnType<typeof running> | null };
    const phpStatusRoot = { current: null as string | null };
    const phpGateway = subscriptionGateway();
    const typeScriptGateway = subscriptionGateway();
    const scheduler = new DeterministicScheduler();
    const phpApplied: unknown[] = [];
    const typeScriptApplied: unknown[] = [];
    const errors: unknown[] = [];
    const phpCoalescerRef = { current: null as DiagnosticsCoalescer | null };
    const typeScriptCoalescerRef = { current: null as DiagnosticsCoalescer | null };
    const currentSession = {
      current: null as ((rootPath: string, sessionId: number) => boolean) | null,
    };
    const container = document.createElement("div");
    const root = createRoot(container);

    function Harness({ owner }: { readonly owner: WorkspaceRuntimeOwner }) {
      const resolveEventOwner = useWorkbenchLanguageRuntimeEventOwnerResolver({
        javaScriptTypeScriptRuntimeStatusByRootRef: typeScriptStatuses,
        languageServerRuntimeStatusByRootRef: phpStatuses,
        workspaceRuntimeOwnerClaimsRef: { current: registry },
      });
      currentSession.current = useWorkbenchLanguageRuntimeSessionCurrency({
        languageServerRuntimeStatusByRootRef: phpStatuses,
        languageServerRuntimeStatusRef: phpStatus,
        languageServerRuntimeStatusRootRef: phpStatusRoot,
        workspaceRuntimeOwnerByTabRef: ownerByRoot,
      });
      useWorkbenchLanguageRuntimeSubscriptionsCoordinator({
        applyJavaScriptTypeScriptLanguageServerDiagnostics: (event, eventOwner) => {
          typeScriptApplied.push({ event, owner: eventOwner });
        },
        applyJavaScriptTypeScriptLanguageServerDiagnosticsBatch: (events) => {
          typeScriptApplied.push(...events);
        },
        applyLanguageServerDiagnostics: (event, eventOwner) => {
          phpApplied.push({ event, owner: eventOwner });
        },
        applyLanguageServerDiagnosticsBatch: (events) => {
          phpApplied.push(...events);
        },
        createDiagnosticsCoalescer: (sink, flushScheduler) =>
          new DiagnosticsCoalescer(sink, flushScheduler),
        currentWorkspaceRootRef: currentRoot,
        diagnosticsFlushSchedulerRef: { current: scheduler },
        javaScriptTypeScriptDiagnosticsCoalescerRef: typeScriptCoalescerRef,
        javaScriptTypeScriptLanguageServerDiagnosticsGateway: typeScriptGateway.gateway,
        languageServerDiagnosticsCoalescerRef: phpCoalescerRef,
        languageServerDiagnosticsGateway: phpGateway.gateway,
        reportJavaScriptTypeScriptLanguageServerError: (error) => errors.push(error),
        reportLanguageServerError: (error) => errors.push(error),
        resolveCurrentWorkspaceRuntimeOwner: () => ownerByRoot.current[ROOT] ?? null,
        resolveWorkspaceRuntimeOwnerForDiagnosticsEvent: resolveEventOwner,
        workspaceRoot: ROOT,
        workspaceRuntimeOwner: owner,
      });
      return null;
    }

    const activate = async (
      owner: WorkspaceRuntimeOwner,
      generation: number,
      phpSessionId: number,
      typeScriptSessionId: number,
    ) => {
      registry.register(owner, [ROOT], generation);
      ownerByRoot.current[ROOT] = owner;
      phpStatuses.current[owner.ownerKey] = running(phpSessionId);
      typeScriptStatuses.current[owner.ownerKey] = running(typeScriptSessionId);
      phpStatus.current = phpStatuses.current[owner.ownerKey];
      phpStatusRoot.current = ROOT;
      await act(async () => {
        root.render(createElement(Harness, { owner }));
        await Promise.resolve();
      });
    };

    await activate(ownerA1, 1, 11, 21);
    const phpA1 = phpGateway.listeners[0];
    const typeScriptA1 = typeScriptGateway.listeners[0];
    expect(requireCurrentSession(currentSession)(ROOT, 11)).toBe(true);

    await activate(ownerB, 2, 12, 22);
    const phpB = phpGateway.listeners[1];
    const typeScriptB = typeScriptGateway.listeners[1];
    expect(requireCurrentSession(currentSession)(ROOT, 11)).toBe(false);

    await activate(ownerA2, 3, 13, 23);
    const phpA2 = phpGateway.listeners[2];
    const typeScriptA2 = typeScriptGateway.listeners[2];
    expect(requireCurrentSession(currentSession)(ROOT, 11)).toBe(false);
    expect(requireCurrentSession(currentSession)(ROOT, 13)).toBe(true);

    act(() => {
      phpA1?.(event(11, "a1.php"));
      typeScriptA1?.(event(21, "a1.ts"));
      phpB?.(event(12, "b.php"));
      typeScriptB?.(event(22, "b.ts"));
      phpA2?.(event(13, "a2.php"));
      typeScriptA2?.(event(13, "wrong-runtime.ts"));
      typeScriptA2?.(event(23, "a2.ts"));
    });
    scheduler.flush();

    expect(phpApplied).toEqual([{ event: event(13, "a2.php"), owner: ownerA2 }]);
    expect(typeScriptApplied).toEqual([{ event: event(23, "a2.ts"), owner: ownerA2 }]);
    expect(errors).toEqual([]);

    act(() => {
      phpA2?.(event(13, "queued-after-teardown.php"));
      root.unmount();
      phpA2?.(event(13, "late-after-teardown.php"));
      typeScriptA2?.(event(23, "late-after-teardown.ts"));
    });
    scheduler.flushCancelled();

    expect(phpApplied).toHaveLength(1);
    expect(typeScriptApplied).toHaveLength(1);
    expect(phpGateway.disposals).toEqual([1, 1, 1]);
    expect(typeScriptGateway.disposals).toEqual([1, 1, 1]);
    expect(phpCoalescerRef.current).toBeNull();
    expect(typeScriptCoalescerRef.current).toBeNull();
  });
});

function requireCurrentSession(ref: {
  readonly current: ((rootPath: string, sessionId: number) => boolean) | null;
}) {
  if (!ref.current) throw new Error("Session currency hook did not render");
  return ref.current;
}

function running(sessionId: number) {
  return {
    capabilities: emptyLanguageServerCapabilities(),
    kind: "running" as const,
    rootPath: ROOT,
    sessionId,
  };
}

function event(sessionId: number, name: string): LanguageServerDiagnosticEvent {
  return {
    diagnostics: [],
    rootPath: ROOT,
    sessionId,
    uri: `file://${ROOT}/${name}`,
    version: null,
  };
}

function subscriptionGateway(): {
  readonly disposals: number[];
  readonly gateway: LanguageServerDiagnosticsGateway;
  readonly listeners: ((event: LanguageServerDiagnosticEvent) => void)[];
} {
  const listeners: ((event: LanguageServerDiagnosticEvent) => void)[] = [];
  const disposals: number[] = [];
  return {
    disposals,
    gateway: {
      subscribeDiagnostics: async (listener) => {
        listeners.push(listener);
        let disposed = false;
        const dispose: DiagnosticsUnsubscribeFn = () => {
          if (disposed) return;
          disposed = true;
          disposals.push(1);
        };
        return dispose;
      },
    },
    listeners,
  };
}

class DeterministicScheduler implements DiagnosticsFlushScheduler {
  private nextHandle = 1;
  private readonly active = new Map<number, () => void>();
  private readonly cancelled: (() => void)[] = [];

  cancel = (handle: number) => {
    const callback = this.active.get(handle);
    if (!callback) return;
    this.active.delete(handle);
    this.cancelled.push(callback);
  };

  schedule = (flush: () => void) => {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.active.set(handle, flush);
    return handle;
  };

  flush(): void {
    const callbacks = [...this.active.values()];
    this.active.clear();
    callbacks.forEach((callback) => callback());
  }

  flushCancelled(): void {
    const callbacks = this.cancelled.splice(0);
    callbacks.forEach((callback) => callback());
  }
}
