import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type {
  ManagedPhpactorInstallCompletionEvent,
  ManagedPhpactorInstallUnsubscribeFn,
  ManagedTypeScriptInstallCompletionEvent,
  PhpToolAvailability,
  PhpToolGateway,
  WorkspaceDescriptor,
} from "../../domain/workspace";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import { replaceWorkbenchNoticeGroup, type WorkbenchNotice } from "../workbenchNotice";

interface ManagedLanguageServerInstallCommandsInput {
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly installingManagedPhpactor: boolean;
  readonly installingManagedPhpactorRootRef: MutableRefObject<string | null>;
  readonly installingManagedTypeScriptLanguageServer: boolean;
  readonly installingManagedTypeScriptLanguageServerRootRef: MutableRefObject<string | null>;
  readonly phpToolGateway: PhpToolGateway;
  readonly refreshJavaScriptTypeScriptLanguageServerPlan: (rootPath: string) => Promise<unknown>;
  readonly refreshLanguageServerPlan: (rootPath: string) => Promise<unknown>;
  readonly reportJavaScriptTypeScriptLanguageServerError: (error: unknown) => void;
  readonly reportLanguageServerError: (error: unknown) => void;
  readonly setInstallingManagedPhpactor: Dispatch<SetStateAction<boolean>>;
  readonly setInstallingManagedTypeScriptLanguageServer: Dispatch<SetStateAction<boolean>>;
  readonly setLanguageServerSetupOpen: Dispatch<SetStateAction<boolean>>;
  readonly setMessage: Dispatch<SetStateAction<string | null>>;
  readonly setNotices: Dispatch<SetStateAction<WorkbenchNotice[]>>;
  readonly setPhpTools: Dispatch<SetStateAction<PhpToolAvailability | null>>;
  readonly workspaceDescriptor: WorkspaceDescriptor | null;
  readonly workspaceRoot: string | null;
}

export function useManagedLanguageServerInstallCommands({
  currentWorkspaceRootRef,
  installingManagedPhpactor,
  installingManagedPhpactorRootRef,
  installingManagedTypeScriptLanguageServer,
  installingManagedTypeScriptLanguageServerRootRef,
  phpToolGateway,
  refreshJavaScriptTypeScriptLanguageServerPlan,
  refreshLanguageServerPlan,
  reportJavaScriptTypeScriptLanguageServerError,
  reportLanguageServerError,
  setInstallingManagedPhpactor,
  setInstallingManagedTypeScriptLanguageServer,
  setLanguageServerSetupOpen,
  setMessage,
  setNotices,
  setPhpTools,
  workspaceDescriptor,
  workspaceRoot,
}: ManagedLanguageServerInstallCommandsInput) {
  const installManagedPhpactor = useCallback(async () => {
    if (!workspaceRoot || !workspaceDescriptor?.php) return;
    if (
      installingManagedPhpactor &&
      workspaceRootKeysEqual(installingManagedPhpactorRootRef.current, workspaceRoot)
    ) {
      return;
    }

    setInstallingManagedPhpactor(true);
    const targetWorkspaceRoot = workspaceRoot;
    installingManagedPhpactorRootRef.current = targetWorkspaceRoot;
    try {
      await phpToolGateway.installManagedPhpactor(targetWorkspaceRoot);
    } catch (error) {
      if (workspaceRootKeysEqual(installingManagedPhpactorRootRef.current, targetWorkspaceRoot)) {
        installingManagedPhpactorRootRef.current = null;
        setInstallingManagedPhpactor(false);
      }
      if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, targetWorkspaceRoot)) {
        reportLanguageServerError(error);
      }
    }
  }, [
    currentWorkspaceRootRef,
    installingManagedPhpactor,
    installingManagedPhpactorRootRef,
    phpToolGateway,
    reportLanguageServerError,
    setInstallingManagedPhpactor,
    workspaceDescriptor,
    workspaceRoot,
  ]);

  const handleManagedPhpactorInstallCompletion = useCallback(
    async (event: ManagedPhpactorInstallCompletionEvent) => {
      const targetWorkspaceRoot = event.root;
      if (!workspaceRootKeysEqual(installingManagedPhpactorRootRef.current, targetWorkspaceRoot)) {
        return;
      }

      installingManagedPhpactorRootRef.current = null;
      setInstallingManagedPhpactor(false);
      const installFailedForActiveWorkspace =
        event.error && workspaceRootKeysEqual(currentWorkspaceRootRef.current, targetWorkspaceRoot);
      if (installFailedForActiveWorkspace) {
        reportLanguageServerError(event.error);
        return;
      }
      if (
        event.error ||
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, targetWorkspaceRoot)
      ) {
        return;
      }

      try {
        const tools = await phpToolGateway.detectPhpTools(targetWorkspaceRoot);
        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, targetWorkspaceRoot)) return;
        if (tools.phpactor) {
          setNotices((current) =>
            replaceWorkbenchNoticeGroup(current, `phpactor-setup:${targetWorkspaceRoot}`, []),
          );
        }
        setPhpTools(tools);
        await refreshLanguageServerPlan(targetWorkspaceRoot);
        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, targetWorkspaceRoot)) return;
        setLanguageServerSetupOpen(false);
        setMessage("Installed managed PHP IDE engine.");
      } catch (error) {
        if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, targetWorkspaceRoot)) {
          reportLanguageServerError(error);
        }
      }
    },
    [
      currentWorkspaceRootRef,
      installingManagedPhpactorRootRef,
      phpToolGateway,
      refreshLanguageServerPlan,
      reportLanguageServerError,
      setInstallingManagedPhpactor,
      setLanguageServerSetupOpen,
      setMessage,
      setNotices,
      setPhpTools,
    ],
  );

  const installManagedTypeScriptLanguageServer = useCallback(async () => {
    if (!workspaceRoot || !phpToolGateway.installManagedTypeScriptLanguageServer) return;
    if (
      installingManagedTypeScriptLanguageServer &&
      workspaceRootKeysEqual(
        installingManagedTypeScriptLanguageServerRootRef.current,
        workspaceRoot,
      )
    ) {
      return;
    }

    const targetWorkspaceRoot = workspaceRoot;
    installingManagedTypeScriptLanguageServerRootRef.current = targetWorkspaceRoot;
    setInstallingManagedTypeScriptLanguageServer(true);
    try {
      await phpToolGateway.installManagedTypeScriptLanguageServer(targetWorkspaceRoot);
    } catch (error) {
      if (
        workspaceRootKeysEqual(
          installingManagedTypeScriptLanguageServerRootRef.current,
          targetWorkspaceRoot,
        )
      ) {
        installingManagedTypeScriptLanguageServerRootRef.current = null;
        setInstallingManagedTypeScriptLanguageServer(false);
        if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, targetWorkspaceRoot)) {
          reportJavaScriptTypeScriptLanguageServerError(error);
        }
      }
    }
  }, [
    currentWorkspaceRootRef,
    installingManagedTypeScriptLanguageServer,
    installingManagedTypeScriptLanguageServerRootRef,
    phpToolGateway,
    reportJavaScriptTypeScriptLanguageServerError,
    setInstallingManagedTypeScriptLanguageServer,
    workspaceRoot,
  ]);

  const handleManagedTypeScriptInstallCompletion = useCallback(
    async (event: ManagedTypeScriptInstallCompletionEvent) => {
      if (
        !workspaceRootKeysEqual(
          installingManagedTypeScriptLanguageServerRootRef.current,
          event.root,
        )
      ) {
        return;
      }
      installingManagedTypeScriptLanguageServerRootRef.current = null;
      setInstallingManagedTypeScriptLanguageServer(false);
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, event.root)) return;
      if (event.error) {
        reportJavaScriptTypeScriptLanguageServerError(event.error);
        return;
      }
      try {
        await refreshJavaScriptTypeScriptLanguageServerPlan(event.root);
      } catch (error) {
        if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, event.root)) {
          reportJavaScriptTypeScriptLanguageServerError(error);
        }
        return;
      }
      if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, event.root)) {
        setMessage("Installed managed TypeScript IDE engine.");
      }
    },
    [
      currentWorkspaceRootRef,
      installingManagedTypeScriptLanguageServerRootRef,
      refreshJavaScriptTypeScriptLanguageServerPlan,
      reportJavaScriptTypeScriptLanguageServerError,
      setInstallingManagedTypeScriptLanguageServer,
      setMessage,
    ],
  );

  return {
    handleManagedPhpactorInstallCompletion,
    handleManagedTypeScriptInstallCompletion,
    installManagedPhpactor,
    installManagedTypeScriptLanguageServer,
  } as const;
}

interface ManagedLanguageServerInstallSubscriptionsInput {
  readonly handleManagedPhpactorInstallCompletion: (
    event: ManagedPhpactorInstallCompletionEvent,
  ) => Promise<void>;
  readonly handleManagedTypeScriptInstallCompletion: (
    event: ManagedTypeScriptInstallCompletionEvent,
  ) => Promise<void>;
  readonly phpToolGateway: PhpToolGateway;
  readonly reportError: (source: string, error: unknown) => void;
}

export function useManagedLanguageServerInstallSubscriptions({
  handleManagedPhpactorInstallCompletion,
  handleManagedTypeScriptInstallCompletion,
  phpToolGateway,
  reportError,
}: ManagedLanguageServerInstallSubscriptionsInput): void {
  useEffect(() => {
    let active = true;
    let unsubscribe: ManagedPhpactorInstallUnsubscribeFn | null = null;
    phpToolGateway
      .subscribeManagedPhpactorInstall((event) => {
        if (active) void handleManagedPhpactorInstallCompletion(event);
      })
      .then((dispose) => {
        if (!active) {
          dispose();
          return;
        }
        unsubscribe = dispose;
      })
      .catch((error) => {
        if (active) reportError("Language Server", error);
      });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [handleManagedPhpactorInstallCompletion, phpToolGateway, reportError]);

  useEffect(() => {
    if (!phpToolGateway.subscribeManagedTypeScriptLanguageServerInstall) return;
    let active = true;
    let unsubscribe: (() => void) | null = null;
    void phpToolGateway
      .subscribeManagedTypeScriptLanguageServerInstall((event) => {
        if (active) void handleManagedTypeScriptInstallCompletion(event);
      })
      .then((dispose) => {
        if (!active) {
          dispose();
          return;
        }
        unsubscribe = dispose;
      })
      .catch((error) => {
        if (active) reportError("JavaScript/TypeScript", error);
      });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [handleManagedTypeScriptInstallCompletion, phpToolGateway, reportError]);
}
