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

export interface LanguageServerDiagnosticsSubscriptionsDependencies {
  workspaceRoot: string | null | undefined;
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
  applyLanguageServerDiagnostics: (event: LanguageServerDiagnosticEvent) => void;
  applyJavaScriptTypeScriptLanguageServerDiagnostics: (
    event: LanguageServerDiagnosticEvent,
  ) => void;
  reportLanguageServerError: (error: unknown) => void;
  reportJavaScriptTypeScriptLanguageServerError: (error: unknown) => void;
}

export function useLanguageServerDiagnosticsSubscriptions({
  workspaceRoot,
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
    const coalescer = createDiagnosticsCoalescer(
      applyLanguageServerDiagnostics,
      diagnosticsFlushSchedulerRef.current,
    );
    languageServerDiagnosticsCoalescerRef.current = coalescer;

    languageServerDiagnosticsGateway
      .subscribeDiagnostics((event) => {
        if (!active) {
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
        if (
          !active ||
          (workspaceRoot &&
            !workspaceRootKeysEqual(currentWorkspaceRootRef.current, workspaceRoot))
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
    workspaceRoot,
  ]);

  useEffect(() => {
    let active = true;
    let unsubscribe: DiagnosticsUnsubscribeFn | null = null;
    const coalescer = createDiagnosticsCoalescer(
      applyJavaScriptTypeScriptLanguageServerDiagnostics,
      diagnosticsFlushSchedulerRef.current,
    );
    javaScriptTypeScriptDiagnosticsCoalescerRef.current = coalescer;

    javaScriptTypeScriptLanguageServerDiagnosticsGateway
      .subscribeDiagnostics((event) => {
        if (!active) {
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
        if (
          !active ||
          (workspaceRoot &&
            !workspaceRootKeysEqual(currentWorkspaceRootRef.current, workspaceRoot))
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
    workspaceRoot,
  ]);
}
