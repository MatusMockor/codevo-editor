import { useEffect, type MutableRefObject } from "react";
import {
  type DiagnosticsCoalescer,
  type DiagnosticsFlushScheduler,
} from "../domain/diagnosticsCoalescer";
import type {
  DiagnosticsUnsubscribeFn,
  LanguageServerDiagnosticEvent,
  LanguageServerDiagnosticsGateway,
} from "../domain/languageServerDiagnostics";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";

export type LanguageServerDiagnosticsRuntimeKind = "php" | "typescript";

export interface LanguageServerDiagnosticsSubscriptionsDependencies {
  workspaceRoot: string | null | undefined;
  workspaceRuntimeOwner?: WorkspaceRuntimeOwner | null;
  resolveCurrentWorkspaceRuntimeOwner?: () => WorkspaceRuntimeOwner | null;
  resolveWorkspaceRuntimeOwnerForDiagnosticsEvent?: (
    event: LanguageServerDiagnosticEvent,
    runtimeKind: LanguageServerDiagnosticsRuntimeKind,
  ) => WorkspaceRuntimeOwner | null;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  diagnosticsFlushSchedulerRef: MutableRefObject<DiagnosticsFlushScheduler>;
  languageServerDiagnosticsCoalescerRef: MutableRefObject<DiagnosticsCoalescer | null>;
  javaScriptTypeScriptDiagnosticsCoalescerRef: MutableRefObject<DiagnosticsCoalescer | null>;
  languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway;
  javaScriptTypeScriptLanguageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway;
  createDiagnosticsCoalescer: (
    sink: (event: LanguageServerDiagnosticEvent) => void,
    scheduler: DiagnosticsFlushScheduler,
  ) => DiagnosticsCoalescer;
  applyLanguageServerDiagnostics: (
    event: LanguageServerDiagnosticEvent,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
  applyJavaScriptTypeScriptLanguageServerDiagnostics: (
    event: LanguageServerDiagnosticEvent,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
  reportLanguageServerError: (error: unknown) => void;
  reportJavaScriptTypeScriptLanguageServerError: (error: unknown) => void;
}

function isLegacyWorkspaceRuntimeOwner(
  owner: WorkspaceRuntimeOwner | null | undefined,
): boolean {
  if (!owner) {
    return false;
  }

  return workspaceRootKeysEqual(owner.ownerKey, owner.executionRoot);
}

function stableWorkspaceRuntimeOwner(
  owner: WorkspaceRuntimeOwner | null | undefined,
): WorkspaceRuntimeOwner | undefined {
  if (isLegacyWorkspaceRuntimeOwner(owner)) {
    return undefined;
  }

  return owner ?? undefined;
}

function diagnosticsEventOwner(
  event: LanguageServerDiagnosticEvent,
  subscriptionOwner: WorkspaceRuntimeOwner | null | undefined,
  resolveOwner:
    | ((
        event: LanguageServerDiagnosticEvent,
        runtimeKind: LanguageServerDiagnosticsRuntimeKind,
      ) => WorkspaceRuntimeOwner | null)
    | undefined,
  runtimeKind: LanguageServerDiagnosticsRuntimeKind,
): WorkspaceRuntimeOwner | null | undefined {
  if (!event.rootPath) {
    return null;
  }

  const resolvedOwner = resolveOwner?.(event, runtimeKind);
  if (resolvedOwner) {
    return stableWorkspaceRuntimeOwner(resolvedOwner);
  }

  if (!stableWorkspaceRuntimeOwner(subscriptionOwner)) {
    return undefined;
  }

  return null;
}

export function useLanguageServerDiagnosticsSubscriptions({
  workspaceRoot,
  workspaceRuntimeOwner,
  resolveCurrentWorkspaceRuntimeOwner,
  resolveWorkspaceRuntimeOwnerForDiagnosticsEvent,
  currentWorkspaceRootRef,
  diagnosticsFlushSchedulerRef,
  languageServerDiagnosticsCoalescerRef,
  javaScriptTypeScriptDiagnosticsCoalescerRef,
  languageServerDiagnosticsGateway,
  javaScriptTypeScriptLanguageServerDiagnosticsGateway,
  createDiagnosticsCoalescer,
  applyLanguageServerDiagnostics,
  applyJavaScriptTypeScriptLanguageServerDiagnostics,
  reportLanguageServerError,
  reportJavaScriptTypeScriptLanguageServerError,
}: LanguageServerDiagnosticsSubscriptionsDependencies): void {
  useEffect(() => {
    let active = true;
    let unsubscribe: DiagnosticsUnsubscribeFn | null = null;
    const subscriptionOwner = stableWorkspaceRuntimeOwner(workspaceRuntimeOwner);
    const ownerByEvent = new WeakMap<
      LanguageServerDiagnosticEvent,
      WorkspaceRuntimeOwner
    >();
    const routedOwnerKeys = new Set<string>();
    const coalescer = createDiagnosticsCoalescer(
      (event) => {
        const eventOwner = ownerByEvent.get(event);
        if (eventOwner) {
          applyLanguageServerDiagnostics(event, eventOwner);
          return;
        }

        applyLanguageServerDiagnostics(event);
      },
      diagnosticsFlushSchedulerRef.current,
    );
    languageServerDiagnosticsCoalescerRef.current = coalescer;

    languageServerDiagnosticsGateway
      .subscribeDiagnostics((event) => {
        if (!active) {
          return;
        }

        const eventOwner = diagnosticsEventOwner(
          event,
          workspaceRuntimeOwner,
          resolveWorkspaceRuntimeOwnerForDiagnosticsEvent,
          "php",
        );
        if (eventOwner === null) {
          return;
        }

        if (eventOwner) {
          ownerByEvent.set(event, eventOwner);
          routedOwnerKeys.add(eventOwner.ownerKey);
          coalescer.enqueue(event, eventOwner.ownerKey);
          return;
        }

        coalescer.enqueue(event);
      })
      .then((dispose) => {
        if (!active) {
          dispose();
          return;
        }

        unsubscribe = dispose;
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        if (
          subscriptionOwner &&
          resolveCurrentWorkspaceRuntimeOwner &&
          resolveCurrentWorkspaceRuntimeOwner()?.ownerKey !==
            subscriptionOwner.ownerKey
        ) {
          return;
        }

        if (
          !subscriptionOwner &&
          workspaceRoot &&
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, workspaceRoot)
        ) {
          return;
        }

        reportLanguageServerError(error);
      });

    // The subscription (and its coalescer) is re-established per workspace root.
    // Disposing the coalescer here only discards events buffered in the current
    // frame for the root being switched AWAY from; those belong to the now
    // background tab (filtered by the sink guards anyway) and the active tab's
    // server re-publishes its own diagnostics, so no active-view diagnostic is
    // lost. The buffer is flushed once per frame while a root stays active.
    return () => {
      active = false;
      unsubscribe?.();
      routedOwnerKeys.forEach((ownerKey) => coalescer.dropOwner(ownerKey));
      coalescer.dispose();
      if (languageServerDiagnosticsCoalescerRef.current === coalescer) {
        languageServerDiagnosticsCoalescerRef.current = null;
      }
    };
  }, [
    applyLanguageServerDiagnostics,
    createDiagnosticsCoalescer,
    currentWorkspaceRootRef,
    diagnosticsFlushSchedulerRef,
    languageServerDiagnosticsCoalescerRef,
    languageServerDiagnosticsGateway,
    reportLanguageServerError,
    resolveCurrentWorkspaceRuntimeOwner,
    resolveWorkspaceRuntimeOwnerForDiagnosticsEvent,
    workspaceRoot,
    workspaceRuntimeOwner,
  ]);

  useEffect(() => {
    let active = true;
    let unsubscribe: DiagnosticsUnsubscribeFn | null = null;
    const subscriptionOwner = stableWorkspaceRuntimeOwner(workspaceRuntimeOwner);
    const ownerByEvent = new WeakMap<
      LanguageServerDiagnosticEvent,
      WorkspaceRuntimeOwner
    >();
    const routedOwnerKeys = new Set<string>();
    const coalescer = createDiagnosticsCoalescer(
      (event) => {
        const eventOwner = ownerByEvent.get(event);
        if (eventOwner) {
          applyJavaScriptTypeScriptLanguageServerDiagnostics(
            event,
            eventOwner,
          );
          return;
        }

        applyJavaScriptTypeScriptLanguageServerDiagnostics(event);
      },
      diagnosticsFlushSchedulerRef.current,
    );
    javaScriptTypeScriptDiagnosticsCoalescerRef.current = coalescer;

    javaScriptTypeScriptLanguageServerDiagnosticsGateway
      .subscribeDiagnostics((event) => {
        if (!active) {
          return;
        }

        const eventOwner = diagnosticsEventOwner(
          event,
          workspaceRuntimeOwner,
          resolveWorkspaceRuntimeOwnerForDiagnosticsEvent,
          "typescript",
        );
        if (eventOwner === null) {
          return;
        }

        if (eventOwner) {
          ownerByEvent.set(event, eventOwner);
          routedOwnerKeys.add(eventOwner.ownerKey);
          coalescer.enqueue(event, eventOwner.ownerKey);
          return;
        }

        coalescer.enqueue(event);
      })
      .then((dispose) => {
        if (!active) {
          dispose();
          return;
        }

        unsubscribe = dispose;
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        if (
          subscriptionOwner &&
          resolveCurrentWorkspaceRuntimeOwner &&
          resolveCurrentWorkspaceRuntimeOwner()?.ownerKey !==
            subscriptionOwner.ownerKey
        ) {
          return;
        }

        if (
          !subscriptionOwner &&
          workspaceRoot &&
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, workspaceRoot)
        ) {
          return;
        }

        reportJavaScriptTypeScriptLanguageServerError(error);
      });

    // See the PHP diagnostics effect: the coalescer is re-established per root
    // and only discards the current frame's buffer for the switched-away root.
    return () => {
      active = false;
      unsubscribe?.();
      routedOwnerKeys.forEach((ownerKey) => coalescer.dropOwner(ownerKey));
      coalescer.dispose();
      if (javaScriptTypeScriptDiagnosticsCoalescerRef.current === coalescer) {
        javaScriptTypeScriptDiagnosticsCoalescerRef.current = null;
      }
    };
  }, [
    applyJavaScriptTypeScriptLanguageServerDiagnostics,
    createDiagnosticsCoalescer,
    currentWorkspaceRootRef,
    diagnosticsFlushSchedulerRef,
    javaScriptTypeScriptDiagnosticsCoalescerRef,
    javaScriptTypeScriptLanguageServerDiagnosticsGateway,
    reportJavaScriptTypeScriptLanguageServerError,
    resolveCurrentWorkspaceRuntimeOwner,
    resolveWorkspaceRuntimeOwnerForDiagnosticsEvent,
    workspaceRoot,
    workspaceRuntimeOwner,
  ]);
}
