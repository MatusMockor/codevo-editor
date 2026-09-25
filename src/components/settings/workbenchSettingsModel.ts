import type { AgentAccountUsageRefreshOutcome } from "../../application/agentAccountUsageRefresh";
import type { AgentTurnLogFactsSource } from "../../application/agentTurnLogStatusStore";
import type {
  AgentThreadMutationResult,
  AgentThreadView,
} from "../../application/agentThreadPorts";
import type { AgentAccountUsageLoadState } from "../../domain/agentAccountUsage";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { AgentProviderSignInSurface } from "../../application/useAgentProviderSignIn";
import type { AppSettings, SettingsSection, WorkspaceSettings } from "../../domain/settings";
import type { WorkspaceTrustState } from "../../domain/trust";
import type { PhpToolAvailability, WorkspaceDescriptor } from "../../domain/workspace";

export interface WorkbenchSettingsModel {
  readonly appSettings: AppSettings;
  readonly closeNodeLaunchConfigurations: () => void;
  readonly gitRepositoryMappings: readonly { readonly rootRelativePath: string }[];
  readonly nodeLaunchConfigurationsOpen: boolean;
  readonly openNodeLaunchConfigurations: () => void;
  readonly openJavaScriptTypeScriptServiceLog: () => Promise<void>;
  readonly phpTools: PhpToolAvailability | null;
  readonly restartJavaScriptTypeScriptService: () => Promise<void>;
  readonly saveWorkbenchSettings: (
    appSettings: AppSettings,
    workspaceSettings: WorkspaceSettings,
    trusted: boolean | null,
  ) => Promise<void>;
  readonly settingsInitialSection: SettingsSection;
  readonly settingsOpen: boolean;
  readonly setSettingsOpen: (open: boolean) => void;
  readonly workspaceDescriptor: WorkspaceDescriptor | null;
  readonly workspaceIdentityDescriptor: { readonly workspaceId: string } | null;
  readonly workspaceRoot: string | null;
  readonly workspaceSettings: WorkspaceSettings;
  readonly workspaceTrust: WorkspaceTrustState | null;
  readonly agents?: {
    readonly providerSignIn: AgentProviderSignInSurface;
    readonly agentProjects?: { readonly projects: readonly AgentProjectDescriptor[] };
    readonly threads?: ReadonlyArray<AgentThreadView>;
    readonly accountUsage?: Readonly<Record<"claudeCode" | "codex", AgentAccountUsageLoadState>>;
    readonly turnLog?: AgentTurnLogFactsSource | null;
    readonly refreshAccountUsage?: (
      provider: "claudeCode" | "codex",
    ) => Promise<AgentAccountUsageRefreshOutcome>;
    readonly unarchive?: (threadId: string) => AgentThreadMutationResult | void;
  };
}
