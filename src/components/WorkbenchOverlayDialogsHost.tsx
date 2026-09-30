import type { AgentProviderManagementSurface } from "../application/useAgentProviderManagement";
import type { LanguageServerPlan } from "../domain/languageServer";
import { LanguageServerSetup } from "./LanguageServerSetup";
import {
  WorkbenchAppUpdaterHost,
  type WorkbenchAppUpdaterHostProps,
} from "./WorkbenchAppUpdaterHost";

export interface WorkbenchOverlayDialogsHostProps extends Omit<
  WorkbenchAppUpdaterHostProps,
  "onOpenAgentSettings" | "providerManagement" | "workbench" | "workspaceTrusted"
> {
  readonly workbench: WorkbenchAppUpdaterHostProps["workbench"] & {
    readonly agents: {
      readonly configureAgentCli: () => void;
      readonly providerManagement: AgentProviderManagementSurface;
    };
    readonly languageServerPlan: LanguageServerPlan | null;
    readonly languageServerSetupOpen: boolean;
  };
}

export function WorkbenchOverlayDialogsHost({
  workbench,
  ...updaterProps
}: WorkbenchOverlayDialogsHostProps) {
  return (
    <>
      <LanguageServerSetup
        isInstallingManagedPhpactor={workbench.installingManagedPhpactor}
        isOpen={workbench.languageServerSetupOpen}
        onClose={() => workbench.setLanguageServerSetupOpen(false)}
        onInstallManagedPhpactor={workbench.installManagedPhpactor}
        plan={workbench.languageServerPlan}
      />
      <WorkbenchAppUpdaterHost
        {...updaterProps}
        onOpenAgentSettings={workbench.agents.configureAgentCli}
        providerManagement={workbench.agents.providerManagement}
        workbench={workbench}
        workspaceTrusted={workbench.workspaceTrust?.trusted === true}
      />
    </>
  );
}
