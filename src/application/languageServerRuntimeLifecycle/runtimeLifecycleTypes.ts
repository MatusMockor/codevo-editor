import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { LanguageServerGateway, LanguageServerPlan } from "../../domain/languageServer";
import type {
  LanguageServerRuntimeGateway,
  LanguageServerRuntimeStatus,
} from "../../domain/languageServerRuntime";
import type { TerminalGateway } from "../../domain/terminal";
import type { WorkspaceTrustState } from "../../domain/trust";
import type {
  ProjectRuntimeStopResult,
  WorkspaceRuntimeLifecycleGateway,
} from "../../domain/workspaceRuntimeLifecycle";
import type { WorkspaceRuntimeOwner } from "../../domain/workspaceRuntimeOwner";
import type {
  AppSettings,
  BackgroundRuntimePolicy,
  WorkspaceSettings,
} from "../../domain/settings";
import type { IntelligenceMode, PhpToolAvailability, PhpToolGateway } from "../../domain/workspace";
import type { WorkbenchNotice } from "../workbenchNotice";

export interface LanguageServerRuntimeLifecycleDependencies {
  workspaceRoot: string | null;
  workspaceRuntimeOwner?: WorkspaceRuntimeOwner | null;
  workspaceTrust: WorkspaceTrustState | null;
  intelligenceMode: IntelligenceMode;
  workspaceSettings: WorkspaceSettings;
  shouldAutoStartJavaScriptTypeScriptLanguageServer: boolean;
  phpLanguageServerAutostartRetryVersion: number;

  languageServerPlan: LanguageServerPlan | null;
  javaScriptTypeScriptLanguageServerPlan: LanguageServerPlan | null;
  languageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  languageServerRuntimeStatusRoot: string | null;
  javaScriptTypeScriptLanguageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  javaScriptTypeScriptLanguageServerRuntimeStatusRoot: string | null;

  appSettingsRef: MutableRefObject<AppSettings>;
  workspaceSettingsRef: MutableRefObject<WorkspaceSettings>;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  autoStartedLanguageServerRootRef: MutableRefObject<string | null>;
  phpLanguageServerAutostartAttemptsByRootRef: MutableRefObject<Record<string, number>>;
  manuallyStoppedPhpLanguageServerRootsRef: MutableRefObject<Set<string>>;
  autoStartedJavaScriptTypeScriptLanguageServerRootRef: MutableRefObject<string | null>;
  lastLanguageServerCrashRef: MutableRefObject<string | null>;
  languageServerRuntimeStatusByRootRef: MutableRefObject<
    Record<string, LanguageServerRuntimeStatus>
  >;
  javaScriptTypeScriptLanguageServerRuntimeStatusRef: MutableRefObject<LanguageServerRuntimeStatus | null>;
  javaScriptTypeScriptLanguageServerRuntimeStatusRootRef: MutableRefObject<string | null>;
  javaScriptTypeScriptRuntimeStatusByRootRef: MutableRefObject<
    Record<string, LanguageServerRuntimeStatus>
  >;

  setPhpTools: Dispatch<SetStateAction<PhpToolAvailability | null>>;
  setLanguageServerPlan: Dispatch<SetStateAction<LanguageServerPlan | null>>;
  setJavaScriptTypeScriptLanguageServerPlan: Dispatch<SetStateAction<LanguageServerPlan | null>>;
  setLanguageServerRuntimeStatus: Dispatch<SetStateAction<LanguageServerRuntimeStatus | null>>;
  setLanguageServerRuntimeStatusRoot: Dispatch<SetStateAction<string | null>>;
  setJavaScriptTypeScriptLanguageServerRuntimeStatus: Dispatch<
    SetStateAction<LanguageServerRuntimeStatus | null>
  >;
  setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot: Dispatch<SetStateAction<string | null>>;
  setMessage: Dispatch<SetStateAction<string | null>>;
  setNotices: Dispatch<SetStateAction<WorkbenchNotice[]>>;
  setPhpLanguageServerAutostartRetryVersion: Dispatch<SetStateAction<number>>;

  phpToolGateway: PhpToolGateway;
  languageServerGateway: LanguageServerGateway;
  languageServerRuntimeGateway: LanguageServerRuntimeGateway;
  javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway;
  workspaceRuntimeLifecycleGateway: WorkspaceRuntimeLifecycleGateway;
  terminalGateway: TerminalGateway;

  clearLanguageServerDiagnosticsForRoot: (rootPath: string, owner?: WorkspaceRuntimeOwner) => void;
  clearJavaScriptTypeScriptDiagnosticsForRoot: (
    rootPath: string | null | undefined,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
  resetLanguageServerDiagnosticsForRoot: (
    rootPath: string | null | undefined,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
  resetJavaScriptTypeScriptDiagnosticsForRoot: (
    rootPath: string | null | undefined,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
  prepareLanguageServerDiagnosticsForRuntimeStart: (
    rootPath: string | null | undefined,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
  prepareJavaScriptTypeScriptDiagnosticsForRuntimeStart: (
    rootPath: string | null | undefined,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
  resetLanguageServerDocuments: () => void;
  resetJavaScriptTypeScriptLanguageServerDocuments: () => void;
  isLanguageServerSessionCurrentForRoot: (rootPath: string, sessionId: number) => boolean;
  reportError: (source: string, error: unknown) => void;
  reportLanguageServerCrash: (error: unknown) => void;
  reportLanguageServerError: (error: unknown) => void;
  reportLanguageServerErrorForActiveWorkspaceRoot: (
    rootPath: string | null | undefined,
    error: unknown,
  ) => void;
  reportErrorForActiveWorkspaceRoot: (
    rootPath: string | null | undefined,
    source: string,
    error: unknown,
  ) => void;
}

export interface LanguageServerRuntimeLifecycle {
  refreshLanguageServerPlan: (
    rootPath: string,
    owner?: WorkspaceRuntimeOwner,
  ) => Promise<LanguageServerPlan | null>;
  runPhpWorkspaceProbe: (rootPath: string, owner?: WorkspaceRuntimeOwner) => Promise<void>;
  refreshJavaScriptTypeScriptLanguageServerPlan: (
    rootPath: string,
    typeScriptVersionPreference?: WorkspaceSettings["javaScriptTypeScriptVersion"],
    owner?: WorkspaceRuntimeOwner,
    requestIsValid?: () => boolean,
  ) => Promise<LanguageServerPlan | null>;
  clearManualPhpLanguageServerStop: (rootPath: string, owner?: WorkspaceRuntimeOwner) => void;
  forgetLanguageServerRuntimeStatuses: (rootPath: string, owner?: WorkspaceRuntimeOwner) => void;
  isLanguageServerSessionActiveForRoot: (rootPath: string, sessionId: number) => boolean;
  isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot: (
    rootPath: string,
    sessionId: number,
  ) => boolean;
  isJavaScriptTypeScriptLanguageServerSessionActiveForRoot: (
    rootPath: string,
    sessionId: number,
  ) => boolean;
  handleLanguageServerRuntimeStatus: (
    status: LanguageServerRuntimeStatus,
    fallbackRootPath?: string,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
  handleJavaScriptTypeScriptLanguageServerRuntimeStatus: (
    status: LanguageServerRuntimeStatus,
    fallbackRootPath?: string,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
  stopLanguageServerRuntime: (
    rootPath?: string,
    owner?: WorkspaceRuntimeOwner,
  ) => Promise<LanguageServerRuntimeStatus | null>;
  stopJavaScriptTypeScriptLanguageServerRuntime: (
    rootPath?: string,
    owner?: WorkspaceRuntimeOwner,
  ) => Promise<LanguageServerRuntimeStatus | null>;
  stopProjectRuntimes: (
    rootPath?: string,
    owner?: WorkspaceRuntimeOwner,
  ) => Promise<ProjectRuntimeStopResult>;
  stopBackgroundProjectRuntimes: (
    policy: BackgroundRuntimePolicy,
    activeRootPath: string | null,
    previousRootPath: string | null,
  ) => Promise<void>;
  startLanguageServer: () => Promise<void>;
  stopLanguageServer: () => Promise<void>;
  restartJavaScriptTypeScriptService: () => Promise<void>;
}
