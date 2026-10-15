import type { AgentMcpServersSurface } from "../../application/agentMcpServersSurface";
import type { CodexRateLimitResetGateway } from "../../application/codexRateLimitResetGateway";
import type { AgentRailWorkingSectionPreferencePort } from "../../application/agentRailWorkingSectionPreferencePort";
import type { AgentThreadOpenerSource } from "../../application/agentThreadOpener";
import { settleAgentThreadMutation } from "../../application/agentThreadMutationOutcome";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import type { AppUpdaterSurface } from "../../application/useAppUpdater";
import type { SystemFontGateway } from "../../domain/systemFonts";
import { TauriCodexRateLimitResetGateway } from "../../infrastructure/tauriCodexRateLimitResetGateway";
import { writeClipboardText } from "../clipboardText";
import type { SettingsAgentActivity, SettingsEnvironment } from "./settingsPageProps";
import type { WorkbenchSettingsModel } from "./workbenchSettingsModel";

export interface SettingsEnvironmentInput {
  readonly codexRateLimitResetGateway?: CodexRateLimitResetGateway | null;
  readonly agentMcpServers?: AgentMcpServersSurface | null;
  readonly agentRailWorkingSectionPreference?: AgentRailWorkingSectionPreferencePort | null;
  readonly agentThreadOpener?: AgentThreadOpenerSource | null;
  readonly appUpdater: AppUpdaterSurface | null;
  readonly providerManagement: AgentProviderManagementSurface | null;
  readonly systemFontGateway: SystemFontGateway;
  readonly workbench: WorkbenchSettingsModel;
}

const LOCAL_CODEX_RESETS = new TauriCodexRateLimitResetGateway();

export function settingsEnvironment({
  codexRateLimitResetGateway = LOCAL_CODEX_RESETS,
  agentMcpServers = null,
  agentRailWorkingSectionPreference = null,
  agentThreadOpener = null,
  appUpdater,
  providerManagement,
  systemFontGateway,
  workbench,
}: SettingsEnvironmentInput): SettingsEnvironment {
  return {
    codexRateLimitResetGateway:
      workbench.agents?.accountUsageSource === "remote" ? null : codexRateLimitResetGateway,
    agentActivity: settingsAgentActivity(workbench, agentThreadOpener),
    agentMcpServers,
    agentProjects: workbench.agents?.agentProjects?.projects ?? [],
    agentRailWorkingSectionPreference,
    appUpdater,
    gitDetectedRepositoryMappings: workbench.gitRepositoryMappings
      .map((mapping) => mapping.rootRelativePath)
      .filter((path) => path !== ""),
    hasWorkspace: Boolean(workbench.workspaceRoot),
    onCopyInstallCommand: writeClipboardText,
    providerManagement,
    providerSignIn: workbench.agents?.providerSignIn ?? null,
    systemFontGateway,
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
    accountUsageSource: agents.accountUsageSource ?? "local",
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
