import { useEffect, useMemo, useRef } from "react";
import type { JsTestRunnableScope } from "../domain/jsTestRunSelection";
import type { JsTestExplorerScopeRunnerPort } from "./useJsTestRunSelectionCommands";

export interface JsTestExplorerScopeLifecycle {
  canCancelTestRun(): boolean;
  canRerunFailedTests(): boolean;
  canRerunLastRun(): boolean;
  canRunScope(scope: JsTestRunnableScope): boolean;
  cancelTestRun(): Promise<boolean>;
  rerunFailedTests(): Promise<boolean>;
  rerunLastRun(): Promise<boolean>;
  runScope(scope: JsTestRunnableScope): Promise<boolean>;
}

/**
 * Stable, fail-closed adapter over the Test Explorer lifecycle.
 * It deliberately has no terminal/process surface and never starts a second lifecycle.
 */
export function useJsTestExplorerScopeRunnerPort(
  lifecycle: JsTestExplorerScopeLifecycle,
): JsTestExplorerScopeRunnerPort {
  const lifecycleRef = useRef(lifecycle);
  lifecycleRef.current = lifecycle;
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  return useMemo(
    () =>
      Object.freeze({
        canCancelTestRun: () => {
          try {
            return mountedRef.current && lifecycleRef.current.canCancelTestRun() === true;
          } catch {
            return false;
          }
        },
        canRerunFailedTests: () => {
          try {
            return mountedRef.current && lifecycleRef.current.canRerunFailedTests() === true;
          } catch {
            return false;
          }
        },
        canRerunLastRun: () => {
          try {
            return mountedRef.current && lifecycleRef.current.canRerunLastRun() === true;
          } catch {
            return false;
          }
        },
        canRunScope: (scope: JsTestRunnableScope) => {
          try {
            return mountedRef.current && lifecycleRef.current.canRunScope(scope) === true;
          } catch {
            return false;
          }
        },
        cancelTestRun: async () => {
          try {
            if (!mountedRef.current) return false;
            const capturedLifecycle = lifecycleRef.current;
            const accepted = await capturedLifecycle.cancelTestRun();
            return (
              mountedRef.current && lifecycleRef.current === capturedLifecycle && accepted === true
            );
          } catch {
            return false;
          }
        },
        rerunFailedTests: async () => {
          try {
            if (!mountedRef.current) return false;
            const capturedLifecycle = lifecycleRef.current;
            const accepted = await capturedLifecycle.rerunFailedTests();
            return (
              mountedRef.current && lifecycleRef.current === capturedLifecycle && accepted === true
            );
          } catch {
            return false;
          }
        },
        rerunLastRun: async () => {
          try {
            if (!mountedRef.current) return false;
            const capturedLifecycle = lifecycleRef.current;
            const accepted = await capturedLifecycle.rerunLastRun();
            return (
              mountedRef.current && lifecycleRef.current === capturedLifecycle && accepted === true
            );
          } catch {
            return false;
          }
        },
        runScope: async (scope: JsTestRunnableScope) => {
          try {
            if (!mountedRef.current) return false;
            const capturedLifecycle = lifecycleRef.current;
            const accepted = await capturedLifecycle.runScope(scope);
            return (
              mountedRef.current && lifecycleRef.current === capturedLifecycle && accepted === true
            );
          } catch {
            return false;
          }
        },
      }),
    [],
  );
}
