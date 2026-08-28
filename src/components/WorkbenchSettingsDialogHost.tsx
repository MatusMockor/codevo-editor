import type { AppSettings, SettingsSection, WorkspaceSettings } from "../domain/settings";
import type { AgentProviderManagementSurface } from "../application/useAgentProviderManagement";
import type { AgentProviderSignInSurface } from "../application/useAgentProviderSignIn";
import type { SystemFontGateway } from "../domain/systemFonts";
import type { WorkspaceTrustState } from "../domain/trust";
import type { PhpToolAvailability, WorkspaceDescriptor } from "../domain/workspace";
import { NodeLaunchConfigurationsDialog } from "./NodeLaunchConfigurationsDialog";
import { SettingsDialog } from "./SettingsDialog";
import {
  useNodeLaunchConfigurationsDialogController,
  type NodeLaunchConfigurationFileGateway,
} from "./useNodeLaunchConfigurationsDialogController";

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

export interface WorkbenchSettingsDialogHostProps {
  readonly providerManagement?: AgentProviderManagementSurface | null;
  readonly systemFontGateway: SystemFontGateway;
  readonly workbench: WorkbenchSettingsModel;
  readonly workspaceFiles: NodeLaunchConfigurationFileGateway;
}

export function WorkbenchSettingsDialogHost({
  providerManagement = null,
  systemFontGateway,
  workbench,
  workspaceFiles,
}: WorkbenchSettingsDialogHostProps) {
  const nodeLaunchDialog = useNodeLaunchConfigurationsDialogController({
    isOpen: workbench.nodeLaunchConfigurationsOpen,
    onClose: workbench.closeNodeLaunchConfigurations,
    rootPath: workbench.workspaceRoot,
    workspaceFiles,
    workspaceId: workbench.workspaceIdentityDescriptor?.workspaceId ?? null,
    workspaceTrusted: workbench.workspaceTrust?.trusted === true,
  });

  return (
    <>
      <SettingsDialog
        appSettings={workbench.appSettings}
        gitDetectedRepositoryMappings={workbench.gitRepositoryMappings
          .map((mapping) => mapping.rootRelativePath)
          .filter((path) => path !== "")}
        initialSection={workbench.settingsInitialSection}
        isOpen={workbench.settingsOpen}
        onClose={() => workbench.setSettingsOpen(false)}
        onOpenJavaScriptTypeScriptServiceLog={workbench.openJavaScriptTypeScriptServiceLog}
        onOpenNodeLaunchConfigurations={workbench.openNodeLaunchConfigurations}
        onRestartJavaScriptTypeScriptService={workbench.restartJavaScriptTypeScriptService}
        onSave={({ appSettings, trusted, workspaceSettings }) =>
          workbench.saveWorkbenchSettings(appSettings, workspaceSettings, trusted)
        }
        phpTools={workbench.phpTools}
        providerManagement={providerManagement}
        providerSignIn={workbench.agents?.providerSignIn ?? null}
        systemFontGateway={systemFontGateway}
        workspaceDescriptor={workbench.workspaceDescriptor}
        workspaceRoot={workbench.workspaceRoot}
        workspaceSettings={workbench.workspaceSettings}
        workspaceTrust={workbench.workspaceTrust}
      />
      <NodeLaunchConfigurationsDialog {...nodeLaunchDialog} />
    </>
  );
}
