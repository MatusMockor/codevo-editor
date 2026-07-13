import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { ResolvedEditorConfig } from "../domain/editorConfig";
import type { LanguageServerPlan } from "../domain/languageServer";
import type { LanguageServerFeaturesGateway } from "../domain/languageServerFeatures";
import {
  isLanguageServerActive,
  type LanguageServerRuntimeGateway,
  type LanguageServerRuntimeStatus,
} from "../domain/languageServerRuntime";
import type { WorkspaceSettings } from "../domain/settings";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  javaScriptTypeScriptLanguageServerConfiguration,
  javaScriptTypeScriptSettingsChangeKind,
} from "./javaScriptTypeScriptLanguageServerSettings";

export interface JavaScriptTypeScriptSettingsChangeInput {
  previousSettings: WorkspaceSettings;
  nextSettings: WorkspaceSettings;
  rootPath: string;
  requestIsCurrent: () => boolean;
}

export interface JavaScriptTypeScriptLanguageServerSettingsDependencies {
  workspaceRoot: string | null;
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  activeEditorConfigRef: MutableRefObject<ResolvedEditorConfig>;
  autoStartedJavaScriptTypeScriptLanguageServerRootRef: MutableRefObject<
    string | null
  >;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  javaScriptTypeScriptLanguageServerFeaturesGateway: LanguageServerFeaturesGateway;
  javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway;
  javaScriptTypeScriptLanguageServerRuntimeStatus:
    | LanguageServerRuntimeStatus
    | null;
  javaScriptTypeScriptLanguageServerRuntimeStatusRoot: string | null;
  isJavaScriptTypeScriptLanguageServerSessionActiveForRoot: (
    rootPath: string,
    sessionId: number,
  ) => boolean;
  refreshJavaScriptTypeScriptLanguageServerPlan: (
    rootPath: string,
    typeScriptVersionPreference?: WorkspaceSettings["javaScriptTypeScriptVersion"],
  ) => Promise<LanguageServerPlan | null>;
  reportErrorForActiveWorkspaceRoot: (
    rootPath: string | null | undefined,
    source: string,
    error: unknown,
  ) => void;
  setMessage: Dispatch<SetStateAction<string | null>>;
  stopJavaScriptTypeScriptLanguageServerRuntime: (
    rootPath?: string,
  ) => Promise<LanguageServerRuntimeStatus | null>;
}

export interface JavaScriptTypeScriptLanguageServerSettings {
  applyJavaScriptTypeScriptSettingsChange: (
    input: JavaScriptTypeScriptSettingsChangeInput,
  ) => Promise<void>;
  openJavaScriptTypeScriptServiceLog: () => Promise<void>;
}

export function useJavaScriptTypeScriptLanguageServerSettings(
  dependencies: JavaScriptTypeScriptLanguageServerSettingsDependencies,
): JavaScriptTypeScriptLanguageServerSettings {
  const {
    workspaceRoot,
    activeDocumentRef,
    activeEditorConfigRef,
    autoStartedJavaScriptTypeScriptLanguageServerRootRef,
    currentWorkspaceRootRef,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerRuntimeGateway,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
    refreshJavaScriptTypeScriptLanguageServerPlan,
    reportErrorForActiveWorkspaceRoot,
    setMessage,
    stopJavaScriptTypeScriptLanguageServerRuntime,
  } = dependencies;

  const applyJavaScriptTypeScriptSettingsChange = useCallback(
    async ({
      previousSettings,
      nextSettings,
      rootPath,
      requestIsCurrent,
    }: JavaScriptTypeScriptSettingsChangeInput) => {
      const changeKind = javaScriptTypeScriptSettingsChangeKind(
        previousSettings,
        nextSettings,
      );

      if (
        changeKind === "configuration" &&
        nextSettings.javaScriptTypeScriptService === "auto" &&
        isRunningLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          rootPath,
        )
      ) {
        const requestedSessionId =
          javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;

        try {
          await javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeConfiguration(
            rootPath,
            javaScriptTypeScriptLanguageServerConfiguration(
              nextSettings,
              activeEditorConfigRef.current,
              activeDocumentRef.current,
            ),
          );
        } catch (error) {
          if (
            isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
              rootPath,
              requestedSessionId,
            )
          ) {
            throw error;
          }
        }
      }

      if (!requestIsCurrent()) {
        return;
      }

      if (changeKind !== "restart") {
        return;
      }

      autoStartedJavaScriptTypeScriptLanguageServerRootRef.current = null;
      await refreshJavaScriptTypeScriptLanguageServerPlan(
        rootPath,
        nextSettings.javaScriptTypeScriptVersion,
      );

      if (!requestIsCurrent()) {
        return;
      }

      if (
        !isLanguageServerActiveForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          rootPath,
        ) &&
        !isCrashedLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          rootPath,
        )
      ) {
        return;
      }

      await stopJavaScriptTypeScriptLanguageServerRuntime(rootPath);

      if (!requestIsCurrent()) {
        return;
      }
    },
    [
      activeDocumentRef,
      activeEditorConfigRef,
      autoStartedJavaScriptTypeScriptLanguageServerRootRef,
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      refreshJavaScriptTypeScriptLanguageServerPlan,
      stopJavaScriptTypeScriptLanguageServerRuntime,
    ],
  );

  const openJavaScriptTypeScriptServiceLog = useCallback(async () => {
    if (!workspaceRoot) {
      setMessage(
        "Open a workspace before opening the JavaScript/TypeScript service log.",
      );
      return;
    }

    const requestedRoot = workspaceRoot;

    try {
      const logPath =
        await javaScriptTypeScriptLanguageServerRuntimeGateway.openLog(
          requestedRoot,
        );

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      setMessage(
        logPath
          ? `Opened JavaScript/TypeScript service log: ${logPath}`
          : "JavaScript/TypeScript service log is unavailable in this runtime.",
      );
    } catch (error) {
      reportErrorForActiveWorkspaceRoot(
        requestedRoot,
        "JavaScript/TypeScript",
        error,
      );
    }
  }, [
    currentWorkspaceRootRef,
    javaScriptTypeScriptLanguageServerRuntimeGateway,
    reportErrorForActiveWorkspaceRoot,
    setMessage,
    workspaceRoot,
  ]);

  return {
    applyJavaScriptTypeScriptSettingsChange,
    openJavaScriptTypeScriptServiceLog,
  };
}

function isRunningLanguageServerForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  statusRoot: string | null,
  workspaceRoot: string | null | undefined,
): status is Extract<LanguageServerRuntimeStatus, { kind: "running" }> {
  if (!isLanguageServerStatusForWorkspace(status, statusRoot, workspaceRoot)) {
    return false;
  }

  return status.kind === "running";
}

function isLanguageServerActiveForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  statusRoot: string | null,
  workspaceRoot: string | null | undefined,
): boolean {
  return (
    isLanguageServerStatusForWorkspace(status, statusRoot, workspaceRoot) &&
    isLanguageServerActive(status)
  );
}

function isCrashedLanguageServerForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  statusRoot: string | null,
  workspaceRoot: string | null | undefined,
): boolean {
  return (
    isLanguageServerStatusForWorkspace(status, statusRoot, workspaceRoot) &&
    status.kind === "crashed"
  );
}

function isLanguageServerStatusForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  statusRoot: string | null,
  workspaceRoot: string | null | undefined,
): status is LanguageServerRuntimeStatus {
  if (!workspaceRoot || !status) {
    return false;
  }

  const rootedStatus =
    status.rootPath ?? (status.kind === "stopped" ? statusRoot : null);

  return (
    Boolean(rootedStatus) && workspaceRootKeysEqual(rootedStatus, workspaceRoot)
  );
}
