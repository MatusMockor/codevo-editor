import { useCallback, useMemo, useRef, useState } from "react";
import {
  defaultWorkspaceSettings,
  type AppSettings,
  type WorkspaceSettings,
} from "../../domain/settings";
import { boundedPendingWorkspaceSettingsLoadsFor } from "../workbenchController/boundedPendingWorkspaceSettingsLoads";
import { initialAppSettingsFrom } from "../workbenchController/initialAppSettings";
import { useWorkbenchSettingsPersistence } from "../workbenchController/useWorkbenchSettingsPersistence";
import { createWorkspaceSettingsByRootSnapshot } from "../workspaceSettingsForRoot";
import { createWorkspaceSettingsSaveCoordinator } from "../workspaceSettingsSaveCoordinator";
import type { AgentAppControllerPorts } from "./agentAppPorts";
import type { AgentWorkspaceRuntimeGateways } from "./agentWorkspaceRuntimes";
import { useAgentGitDiscoveryBridge } from "./useAgentGitStatus";
import { useAgentNotices } from "./useAgentNotices";
import { useAgentWorkspaceAuthority } from "./useAgentWorkspaceAuthority";
import { useAgentWorkspaceTransition } from "./useAgentWorkspaceTransition";
import { useAgentWorkspaceTrustState } from "./useAgentWorkspaceTrustState";

type ReportError = (source: string, error: unknown) => void;

export function useAgentWorkspaceSession(ports: AgentAppControllerPorts) {
  const { agentGateways, settingsGateway, workspace } = ports;
  const [appSettings, setAppSettings] = useState<AppSettings>(
    initialAppSettingsFrom(settingsGateway),
  );
  const [workspaceSettings, setWorkspaceSettings] =
    useState<WorkspaceSettings>(defaultWorkspaceSettings);
  const appSettingsRef = useRef(appSettings);
  const workspaceSettingsRef = useRef(workspaceSettings);
  const hasRestoredRef = useRef(false);
  const workspaceSettingsByRoot = useMemo(() => createWorkspaceSettingsByRootSnapshot(), []);
  const workspaceSettingsSaveCoordinator = useMemo(
    () => createWorkspaceSettingsSaveCoordinator(),
    [],
  );
  const workspaceSettingsLoadByRootRef = useRef(
    boundedPendingWorkspaceSettingsLoadsFor(settingsGateway),
  );
  const reportErrorRef = useRef<ReportError>(() => undefined);
  const forwardReportError = useCallback<ReportError>(
    (source, error) => reportErrorRef.current(source, error),
    [],
  );

  const authority = useAgentWorkspaceAuthority({
    fileChangeGateway: workspace.fileChanges,
    identityGateway: workspace.identity,
    reportError: forwardReportError,
  });
  const notices = useAgentNotices({
    currentWorkspaceRootRef: authority.currentWorkspaceRootRef,
    isBenignError: ports.isBenignError,
  });
  reportErrorRef.current = notices.reportError;

  const persistence = useWorkbenchSettingsPersistence({
    appSettingsRef,
    currentWorkspaceRootRef: authority.currentWorkspaceRootRef,
    reportError: notices.reportError,
    setAppSettings,
    setWorkspaceSettings,
    settingsGateway,
    workspaceIdentityByRootRef: authority.workspaceIdentityByRootRef,
    workspaceSettingsByRoot,
    workspaceSettingsRef,
    workspaceSettingsSaveCoordinator,
  });
  const settingsPort = useMemo(
    () => ({
      appSettingsRef,
      applyAppSettings: persistence.applyAppSettings,
      applyWorkspaceSettings: persistence.applyWorkspaceSettings,
      persistAppSettings: persistence.persistAppSettings,
      settingsGateway,
      workspaceSettingsByRoot,
      workspaceSettingsLoadByRootRef,
      workspaceSettingsRef,
      workspaceSettingsSaveCoordinator,
    }),
    [
      persistence.applyAppSettings,
      persistence.applyWorkspaceSettings,
      persistence.persistAppSettings,
      settingsGateway,
      workspaceSettingsByRoot,
      workspaceSettingsSaveCoordinator,
    ],
  );
  const hydratedListenerRef = useRef<(hydrated: true) => void>(() => undefined);
  const resolveWorkspaceHome = agentGateways.resolveWorkspaceHome;
  const startup = useMemo(
    () => ({
      hasRestoredRef,
      onAppSettingsHydrated: (hydrated: true) => hydratedListenerRef.current(hydrated),
      resolveWorkspaceHome,
    }),
    [resolveWorkspaceHome],
  );
  const runtimeGateways = useMemo<AgentWorkspaceRuntimeGateways>(
    () => ({
      runtimeLifecycle: ports.workspaceRuntimeLifecycleGateway,
      terminal: ports.terminalGateway,
    }),
    [ports.terminalGateway, ports.workspaceRuntimeLifecycleGateway],
  );
  const gitBridge = useAgentGitDiscoveryBridge();
  const transition = useAgentWorkspaceTransition({
    authority,
    git: gitBridge.port,
    identityGateway: workspace.identity,
    reportError: notices.reportError,
    runtimeGateways,
    scriptsWorkspaceReader: workspace.files,
    settings: settingsPort,
    startup,
    trustGateway: ports.workspaceTrustGateway,
  });
  const trust = useAgentWorkspaceTrustState(transition.activeWorkspace, transition.workspaceTrust);

  return {
    appSettings,
    appSettingsRef,
    authority,
    gitBridge,
    hydratedListenerRef,
    notices,
    persistence,
    runtimeGateways,
    transition,
    trust,
    workspaceSettings,
    workspaceSettingsByRoot,
    workspaceSettingsRef,
  };
}
