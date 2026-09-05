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
  readonly agents?: { readonly providerSignIn: AgentProviderSignInSurface };
}
