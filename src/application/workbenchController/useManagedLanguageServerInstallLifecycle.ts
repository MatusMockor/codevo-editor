import {
  useCallback,
  useEffect,
  useRef,
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
import type { ManagedLanguageServerInstallRequest } from "../../domain/managedLanguageServerInstall";
import type { WorkspaceIdentityDescriptor } from "../workspaceIdentityGatewayPort";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import { replaceWorkbenchNoticeGroup, type WorkbenchNotice } from "../workbenchNotice";

interface ManagedLanguageServerInstallCommandsInput {
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly currentWorkspaceIdentityDescriptorRef: MutableRefObject<WorkspaceIdentityDescriptor | null>;
  readonly installingManagedPhpactor: boolean;
  readonly installingManagedTypeScriptLanguageServer: boolean;
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
  readonly workspaceIdentityDescriptor: WorkspaceIdentityDescriptor | null;
  readonly workspaceRoot: string | null;
}

function managedInstallAuthorityFor(
  rootPath: string | null,
  identity: WorkspaceIdentityDescriptor | null,
): ManagedLanguageServerInstallRequest | null {
  if (!rootPath || !identity) return null;
  if (
    !workspaceRootKeysEqual(rootPath, identity.selectedPath) &&
    !workspaceRootKeysEqual(rootPath, identity.canonicalRoot)
  ) {
    return null;
  }
  if (
    typeof identity.admissionToken !== "number" ||
    !Number.isSafeInteger(identity.admissionToken) ||
    identity.admissionToken <= 0
  ) {
    return null;
  }
  return {
    admissionToken: identity.admissionToken,
    rootPath,
    workspaceId: identity.workspaceId,
  };
}

function managedInstallAuthoritiesEqual(
  left: ManagedLanguageServerInstallRequest | null,
  right: ManagedLanguageServerInstallRequest | null,
): boolean {
  return (
    left !== null &&
    right !== null &&
    left.admissionToken === right.admissionToken &&
    left.workspaceId === right.workspaceId &&
    left.rootPath === right.rootPath
  );
}

export function useManagedLanguageServerInstallCommands({
  currentWorkspaceIdentityDescriptorRef,
  currentWorkspaceRootRef,
  installingManagedPhpactor,
  installingManagedTypeScriptLanguageServer,
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
  workspaceIdentityDescriptor,
  workspaceRoot,
}: ManagedLanguageServerInstallCommandsInput) {
  const installingManagedPhpactorAuthorityRef = useRef<ManagedLanguageServerInstallRequest | null>(
    null,
  );
  const installingManagedTypeScriptLanguageServerAuthorityRef =
    useRef<ManagedLanguageServerInstallRequest | null>(null);
  const isCurrentWorkspaceAuthority = useCallback(
    (authority: ManagedLanguageServerInstallRequest) =>
      managedInstallAuthoritiesEqual(
        authority,
        managedInstallAuthorityFor(
          currentWorkspaceRootRef.current,
          currentWorkspaceIdentityDescriptorRef.current,
        ),
      ),
    [currentWorkspaceIdentityDescriptorRef, currentWorkspaceRootRef],
  );

  const installManagedPhpactor = useCallback(async () => {
    if (!workspaceRoot || !workspaceDescriptor?.php) return;
    const authority = managedInstallAuthorityFor(workspaceRoot, workspaceIdentityDescriptor);
    if (!authority) return;
    if (
      installingManagedPhpactor &&
      managedInstallAuthoritiesEqual(installingManagedPhpactorAuthorityRef.current, authority)
    ) {
      return;
    }

    setInstallingManagedPhpactor(true);
    installingManagedPhpactorAuthorityRef.current = authority;
    try {
      await phpToolGateway.installManagedPhpactor(authority);
    } catch (error) {
      if (
        managedInstallAuthoritiesEqual(installingManagedPhpactorAuthorityRef.current, authority)
      ) {
        installingManagedPhpactorAuthorityRef.current = null;
        setInstallingManagedPhpactor(false);
      }
      if (isCurrentWorkspaceAuthority(authority)) {
        reportLanguageServerError(error);
      }
    }
  }, [
    installingManagedPhpactor,
    installingManagedPhpactorAuthorityRef,
    isCurrentWorkspaceAuthority,
    phpToolGateway,
    reportLanguageServerError,
    setInstallingManagedPhpactor,
    workspaceDescriptor,
    workspaceIdentityDescriptor,
    workspaceRoot,
  ]);

  const handleManagedPhpactorInstallCompletion = useCallback(
    async (event: ManagedPhpactorInstallCompletionEvent) => {
      if (!managedInstallAuthoritiesEqual(installingManagedPhpactorAuthorityRef.current, event)) {
        return;
      }

      installingManagedPhpactorAuthorityRef.current = null;
      setInstallingManagedPhpactor(false);
      if (event.error && isCurrentWorkspaceAuthority(event)) {
        reportLanguageServerError(event.error);
        return;
      }
      if (event.error || !isCurrentWorkspaceAuthority(event)) return;

      try {
        const tools = await phpToolGateway.detectPhpTools(event.rootPath);
        if (!isCurrentWorkspaceAuthority(event)) return;
        if (tools.phpactor) {
          setNotices((current) =>
            replaceWorkbenchNoticeGroup(current, `phpactor-setup:${event.rootPath}`, []),
          );
        }
        if (!isCurrentWorkspaceAuthority(event)) return;
        setPhpTools(tools);
        if (!isCurrentWorkspaceAuthority(event)) return;
        await refreshLanguageServerPlan(event.rootPath);
        if (!isCurrentWorkspaceAuthority(event)) return;
        setLanguageServerSetupOpen(false);
        if (!isCurrentWorkspaceAuthority(event)) return;
        setMessage("Installed managed PHP IDE engine.");
      } catch (error) {
        if (isCurrentWorkspaceAuthority(event)) {
          reportLanguageServerError(error);
        }
      }
    },
    [
      installingManagedPhpactorAuthorityRef,
      isCurrentWorkspaceAuthority,
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
    const authority = managedInstallAuthorityFor(workspaceRoot, workspaceIdentityDescriptor);
    if (!authority) return;
    if (
      installingManagedTypeScriptLanguageServer &&
      managedInstallAuthoritiesEqual(
        installingManagedTypeScriptLanguageServerAuthorityRef.current,
        authority,
      )
    ) {
      return;
    }

    installingManagedTypeScriptLanguageServerAuthorityRef.current = authority;
    setInstallingManagedTypeScriptLanguageServer(true);
    try {
      await phpToolGateway.installManagedTypeScriptLanguageServer(authority);
    } catch (error) {
      if (
        managedInstallAuthoritiesEqual(
          installingManagedTypeScriptLanguageServerAuthorityRef.current,
          authority,
        )
      ) {
        installingManagedTypeScriptLanguageServerAuthorityRef.current = null;
        setInstallingManagedTypeScriptLanguageServer(false);
        if (isCurrentWorkspaceAuthority(authority)) {
          reportJavaScriptTypeScriptLanguageServerError(error);
        }
      }
    }
  }, [
    installingManagedTypeScriptLanguageServer,
    installingManagedTypeScriptLanguageServerAuthorityRef,
    isCurrentWorkspaceAuthority,
    phpToolGateway,
    reportJavaScriptTypeScriptLanguageServerError,
    setInstallingManagedTypeScriptLanguageServer,
    workspaceIdentityDescriptor,
    workspaceRoot,
  ]);

  const handleManagedTypeScriptInstallCompletion = useCallback(
    async (event: ManagedTypeScriptInstallCompletionEvent) => {
      if (
        !managedInstallAuthoritiesEqual(
          installingManagedTypeScriptLanguageServerAuthorityRef.current,
          event,
        )
      ) {
        return;
      }
      installingManagedTypeScriptLanguageServerAuthorityRef.current = null;
      setInstallingManagedTypeScriptLanguageServer(false);
      if (!isCurrentWorkspaceAuthority(event)) return;
      if (event.error) {
        reportJavaScriptTypeScriptLanguageServerError(event.error);
        return;
      }
      try {
        await refreshJavaScriptTypeScriptLanguageServerPlan(event.rootPath);
      } catch (error) {
        if (isCurrentWorkspaceAuthority(event)) {
          reportJavaScriptTypeScriptLanguageServerError(error);
        }
        return;
      }
      if (!isCurrentWorkspaceAuthority(event)) return;
      setMessage("Installed managed TypeScript IDE engine.");
    },
    [
      installingManagedTypeScriptLanguageServerAuthorityRef,
      isCurrentWorkspaceAuthority,
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
