import type { AgentRailWorkingSectionPreferencePort } from "../../application/agentRailWorkingSectionPreferencePort";
import type { AgentThreadOpenerSource } from "../../application/agentThreadOpener";
import { settleAgentThreadMutation } from "../../application/agentThreadMutationOutcome";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import type { AppUpdaterSurface } from "../../application/useAppUpdater";
import type { SystemFontGateway } from "../../domain/systemFonts";
import { writeClipboardText } from "../clipboardText";
import type { SettingsAgentActivity, SettingsEnvironment } from "./settingsPageProps";
import type { WorkbenchSettingsModel } from "./workbenchSettingsModel";

export interface SettingsEnvironmentInput {
  readonly agentRailWorkingSectionPreference?: AgentRailWorkingSectionPreferencePort | null;
  readonly agentThreadOpener?: AgentThreadOpenerSource | null;
  readonly appUpdater: AppUpdaterSurface | null;
  readonly providerManagement: AgentProviderManagementSurface | null;
  readonly systemFontGateway: SystemFontGateway;
  readonly workbench: WorkbenchSettingsModel;
}

export function settingsEnvironment({
  agentRailWorkingSectionPreference = null,
  agentThreadOpener = null,
  appUpdater,
  providerManagement,
  systemFontGateway,
  workbench,
}: SettingsEnvironmentInput): SettingsEnvironment {
  return {
    agentActivity: settingsAgentActivity(workbench, agentThreadOpener),
    agentProjects: workbench.agents?.agentProjects?.projects ?? [],
    agentRailWorkingSectionPreference,
    appUpdater,
    gitDetectedRepositoryMappings: workbench.gitRepositoryMappings
      .map((mapping) => mapping.rootRelativePath)
      .filter((path) => path !== ""),
    hasWorkspace: Boolean(workbench.workspaceRoot),
    onCopyInstallCommand: writeClipboardText,
    onOpenJavaScriptTypeScriptServiceLog: workbench.openJavaScriptTypeScriptServiceLog,
    onRestartJavaScriptTypeScriptService: workbench.restartJavaScriptTypeScriptService,
    phpTools: workbench.phpTools,
    providerManagement,
    providerSignIn: workbench.agents?.providerSignIn ?? null,
    systemFontGateway,
    workspaceDescriptor: workbench.workspaceDescriptor,
    workspaceRoot: workbench.workspaceRoot,
  };
}

function settingsAgentActivity(
  workbench: WorkbenchSettingsModel,
  opener: AgentThreadOpenerSource | null,
): SettingsAgentActivity | null {
  const { agents, setSettingsOpen } = workbench;
  if (agents === undefined) return null;
  const { accountUsage, refreshAccountUsage, threads, unarchive } = agents;
  if (threads === undefined || accountUsage === undefined) return null;
  if (refreshAccountUsage === undefined || unarchive === undefined) return null;
  return {
    threads,
    accountUsage,
    turnLog: agents.turnLog ?? null,
    refreshAccountUsage,
    unarchive: (threadId) => {
      void settleAgentThreadMutation(unarchive(threadId));
    },
    openThread:
      opener === null
        ? undefined
        : (threadId) => {
            if (opener.current()?.openThread(threadId) !== true) return;
            setSettingsOpen(false);
          },
  };
}
