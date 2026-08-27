import { useCallback } from "react";
import type { LanguageServerDiagnosticEvent } from "../../domain/languageServerDiagnostics";
import type { LanguageServerRuntimeStatus } from "../../domain/languageServerRuntime";
import type { WorkspaceRuntimeOwner } from "../../domain/workspaceRuntimeOwner";
import { useDiagnostics } from "../useDiagnostics";
import {
  type LanguageServerDiagnosticsRuntimeKind,
  useLanguageServerDiagnosticsSubscriptions,
} from "../useLanguageServerDiagnosticsSubscriptions";
import type { WorkspaceRuntimeOwnerClaimRegistry } from "../workspaceRuntimeOwnerClaimRegistry";
import { isLanguageServerSessionCurrentForOwnerOrLegacy } from "./languageServerStatusPolicy";

type DiagnosticsDependencies = Omit<
  Parameters<typeof useDiagnostics>[0],
  "isLanguageServerSessionCurrentForRoot"
>;
type DiagnosticsSubscriptionDependencies = Parameters<
  typeof useLanguageServerDiagnosticsSubscriptions
>[0];

export interface WorkbenchLanguageRuntimeEventOwnerResolverDependencies {
  readonly javaScriptTypeScriptRuntimeStatusByRootRef: {
    readonly current: Record<string, LanguageServerRuntimeStatus>;
  };
  readonly languageServerRuntimeStatusByRootRef: {
    readonly current: Record<string, LanguageServerRuntimeStatus>;
  };
  readonly workspaceRuntimeOwnerClaimsRef: {
    readonly current: Pick<WorkspaceRuntimeOwnerClaimRegistry, "resolveDiagnosticsEvent">;
  };
}

export function useWorkbenchLanguageRuntimeEventOwnerResolver({
  javaScriptTypeScriptRuntimeStatusByRootRef,
  languageServerRuntimeStatusByRootRef,
  workspaceRuntimeOwnerClaimsRef,
}: WorkbenchLanguageRuntimeEventOwnerResolverDependencies) {
  return useCallback(
    (
      event: LanguageServerDiagnosticEvent,
      runtimeKind: LanguageServerDiagnosticsRuntimeKind,
    ): WorkspaceRuntimeOwner | null => {
      if (!event.rootPath) return null;
      return workspaceRuntimeOwnerClaimsRef.current.resolveDiagnosticsEvent(
        event,
        runtimeKind,
        languageServerRuntimeStatusByRootRef.current,
        javaScriptTypeScriptRuntimeStatusByRootRef.current,
      );
    },
    [
      javaScriptTypeScriptRuntimeStatusByRootRef,
      languageServerRuntimeStatusByRootRef,
      workspaceRuntimeOwnerClaimsRef,
    ],
  );
}

export interface WorkbenchLanguageRuntimeSessionCurrencyDependencies {
  readonly languageServerRuntimeStatusByRootRef: {
    readonly current: Record<string, LanguageServerRuntimeStatus>;
  };
  readonly languageServerRuntimeStatusRef: {
    readonly current: LanguageServerRuntimeStatus | null;
  };
  readonly languageServerRuntimeStatusRootRef: { readonly current: string | null };
  readonly workspaceRuntimeOwnerByTabRef: {
    readonly current: Record<string, WorkspaceRuntimeOwner>;
  };
}

export function useWorkbenchLanguageRuntimeSessionCurrency({
  languageServerRuntimeStatusByRootRef,
  languageServerRuntimeStatusRef,
  languageServerRuntimeStatusRootRef,
  workspaceRuntimeOwnerByTabRef,
}: WorkbenchLanguageRuntimeSessionCurrencyDependencies) {
  return useCallback(
    (rootPath: string, sessionId: number) =>
      isLanguageServerSessionCurrentForOwnerOrLegacy(
        languageServerRuntimeStatusByRootRef.current,
        workspaceRuntimeOwnerByTabRef.current[rootPath],
        languageServerRuntimeStatusRef.current,
        languageServerRuntimeStatusRootRef.current,
        rootPath,
        sessionId,
      ),
    [
      languageServerRuntimeStatusByRootRef,
      languageServerRuntimeStatusRef,
      languageServerRuntimeStatusRootRef,
      workspaceRuntimeOwnerByTabRef,
    ],
  );
}

export interface WorkbenchLanguageDiagnosticsSessionCoordinatorDependencies extends WorkbenchLanguageRuntimeSessionCurrencyDependencies {
  readonly diagnostics: DiagnosticsDependencies;
}

export function useWorkbenchLanguageDiagnosticsSessionCoordinator({
  diagnostics,
  ...currencyDependencies
}: WorkbenchLanguageDiagnosticsSessionCoordinatorDependencies) {
  const isLanguageServerSessionCurrentForRoot =
    useWorkbenchLanguageRuntimeSessionCurrency(currencyDependencies);
  return {
    ...useDiagnostics({ ...diagnostics, isLanguageServerSessionCurrentForRoot }),
    isLanguageServerSessionCurrentForRoot,
  };
}

export function useWorkbenchLanguageRuntimeSubscriptionsCoordinator(
  dependencies: DiagnosticsSubscriptionDependencies,
): void {
  useLanguageServerDiagnosticsSubscriptions(dependencies);
}
