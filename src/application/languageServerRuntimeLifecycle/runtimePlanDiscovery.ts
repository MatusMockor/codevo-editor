import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { LanguageServerGateway, LanguageServerPlan } from "../../domain/languageServer";
import type { WorkspaceSettings } from "../../domain/settings";
import type { PhpToolAvailability, PhpToolGateway } from "../../domain/workspace";
import type { WorkspaceRuntimeOwner } from "../../domain/workspaceRuntimeOwner";
import { javaScriptTypeScriptLanguageServerOptions } from "../javaScriptTypeScriptLanguageServerSettings";
import {
  createWorkbenchNotice,
  replaceWorkbenchNoticeGroup,
  type WorkbenchNotice,
} from "../workbenchNotice";

interface RuntimePlanDiscoveryDependencies {
  workspaceSettingsRef: MutableRefObject<WorkspaceSettings>;
  languageServerGateway: LanguageServerGateway;
  phpToolGateway: PhpToolGateway;
  runtimeOwnerForRoot: (rootPath: string, owner?: WorkspaceRuntimeOwner) => WorkspaceRuntimeOwner;
  ownerRevision: (owner: WorkspaceRuntimeOwner) => number;
  isOwnerRevisionCurrent: (owner: WorkspaceRuntimeOwner, revision: number) => boolean;
  isCurrentRuntimeOwner: (owner: WorkspaceRuntimeOwner) => boolean;
  setPhpTools: Dispatch<SetStateAction<PhpToolAvailability | null>>;
  setLanguageServerPlan: Dispatch<SetStateAction<LanguageServerPlan | null>>;
  setJavaScriptTypeScriptLanguageServerPlan: Dispatch<SetStateAction<LanguageServerPlan | null>>;
  setNotices: Dispatch<SetStateAction<WorkbenchNotice[]>>;
  reportError: (source: string, error: unknown) => void;
  reportErrorForActiveWorkspaceRoot: (
    rootPath: string | null | undefined,
    source: string,
    error: unknown,
  ) => void;
}

export function useRuntimePlanDiscovery(dependencies: RuntimePlanDiscoveryDependencies) {
  const {
    workspaceSettingsRef,
    languageServerGateway,
    phpToolGateway,
    runtimeOwnerForRoot,
    ownerRevision,
    isOwnerRevisionCurrent,
    isCurrentRuntimeOwner,
    setPhpTools,
    setLanguageServerPlan,
    setJavaScriptTypeScriptLanguageServerPlan,
    setNotices,
    reportError,
    reportErrorForActiveWorkspaceRoot,
  } = dependencies;

  const refreshLanguageServerPlan = useCallback(
    async (rootPath: string, owner?: WorkspaceRuntimeOwner) => {
      const requestedOwner = runtimeOwnerForRoot(rootPath, owner);
      const requestedRevision = ownerRevision(requestedOwner);

      try {
        const plan = await languageServerGateway.planPhpLanguageServer(
          rootPath,
          phpLanguageServerOptions(workspaceSettingsRef.current),
        );

        if (
          isOwnerRevisionCurrent(requestedOwner, requestedRevision) &&
          isCurrentRuntimeOwner(requestedOwner)
        ) {
          setLanguageServerPlan(plan);
        }
        return plan;
      } catch (error) {
        if (!isOwnerRevisionCurrent(requestedOwner, requestedRevision)) {
          return null;
        }

        if (!isCurrentRuntimeOwner(requestedOwner)) {
          return null;
        }

        setLanguageServerPlan(null);
        reportError("Language Server", error);
        return null;
      }
    },
    [
      isCurrentRuntimeOwner,
      isOwnerRevisionCurrent,
      languageServerGateway,
      ownerRevision,
      reportError,
      runtimeOwnerForRoot,
      setLanguageServerPlan,
      workspaceSettingsRef,
    ],
  );

  const runPhpWorkspaceProbe = useCallback(
    async (rootPath: string, owner?: WorkspaceRuntimeOwner) => {
      const requestedOwner = runtimeOwnerForRoot(rootPath, owner);
      const requestedRevision = ownerRevision(requestedOwner);

      try {
        const tools = await phpToolGateway.detectPhpTools(rootPath);
        const phpSetupNoticeGroup = `phpactor-setup:${rootPath}`;

        if (!isOwnerRevisionCurrent(requestedOwner, requestedRevision)) {
          return;
        }

        if (!isCurrentRuntimeOwner(requestedOwner)) {
          return;
        }

        setPhpTools(tools);

        if (tools.phpactor) {
          setNotices((current) => replaceWorkbenchNoticeGroup(current, phpSetupNoticeGroup, []));
          await refreshLanguageServerPlan(rootPath, requestedOwner);
          return;
        }

        setNotices((current) =>
          replaceWorkbenchNoticeGroup(current, phpSetupNoticeGroup, [
            createWorkbenchNotice(
              "warning",
              "PHP IDE Engine",
              "Install the managed PHP IDE engine (one-click user profile bootstrap) to enable hover, completion, definition, and implementation support.",
              phpSetupNoticeGroup,
            ),
          ]),
        );
        await refreshLanguageServerPlan(rootPath, requestedOwner);
      } catch (error) {
        if (!isOwnerRevisionCurrent(requestedOwner, requestedRevision)) {
          return;
        }

        if (!isCurrentRuntimeOwner(requestedOwner)) {
          return;
        }

        reportErrorForActiveWorkspaceRoot(rootPath, "PHP Tools", error);
      }
    },
    [
      isCurrentRuntimeOwner,
      isOwnerRevisionCurrent,
      ownerRevision,
      phpToolGateway,
      refreshLanguageServerPlan,
      reportErrorForActiveWorkspaceRoot,
      runtimeOwnerForRoot,
      setNotices,
      setPhpTools,
    ],
  );

  const refreshJavaScriptTypeScriptLanguageServerPlan = useCallback(
    async (
      rootPath: string,
      typeScriptVersionPreference = workspaceSettingsRef.current.javaScriptTypeScriptVersion,
      owner?: WorkspaceRuntimeOwner,
      requestIsValid: () => boolean = () => true,
    ) => {
      const requestedOwner = runtimeOwnerForRoot(rootPath, owner);
      const requestedRevision = ownerRevision(requestedOwner);

      try {
        const plan = await languageServerGateway.planJavaScriptTypeScriptLanguageServer(rootPath, {
          ...javaScriptTypeScriptLanguageServerOptions(workspaceSettingsRef.current),
          typeScriptVersionPreference,
        });

        if (
          requestIsValid() &&
          isOwnerRevisionCurrent(requestedOwner, requestedRevision) &&
          isCurrentRuntimeOwner(requestedOwner)
        ) {
          setJavaScriptTypeScriptLanguageServerPlan(plan);
        }

        return plan;
      } catch (error) {
        if (!requestIsValid()) {
          return null;
        }

        if (!isOwnerRevisionCurrent(requestedOwner, requestedRevision)) {
          return null;
        }

        if (!isCurrentRuntimeOwner(requestedOwner)) {
          return null;
        }

        setJavaScriptTypeScriptLanguageServerPlan(null);
        reportErrorForActiveWorkspaceRoot(rootPath, "JavaScript/TypeScript", error);
        return null;
      }
    },
    [
      isCurrentRuntimeOwner,
      isOwnerRevisionCurrent,
      languageServerGateway,
      ownerRevision,
      reportErrorForActiveWorkspaceRoot,
      runtimeOwnerForRoot,
      setJavaScriptTypeScriptLanguageServerPlan,
      workspaceSettingsRef,
    ],
  );

  return {
    refreshJavaScriptTypeScriptLanguageServerPlan,
    refreshLanguageServerPlan,
    runPhpWorkspaceProbe,
  };
}

function phpLanguageServerOptions(settings: WorkspaceSettings) {
  return {
    intelephensePath: settings.intelephensePath,
    phpBackend: settings.phpBackend,
    phpactorPath: settings.phpactorPath,
  };
}
