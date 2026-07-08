import { shouldStartLanguageServer } from "../domain/intelligence";
import type { LanguageServerPlan } from "../domain/languageServer";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import { createPhpactorSetupGuide } from "../domain/languageServerSetup";
import type {
  IntelligenceMode,
  PhpToolAvailability,
  WorkspaceDescriptor,
} from "../domain/workspace";
import type { Command } from "./commandRegistry";

interface WorkbenchSmartCommandsOptions {
  intelligenceMode: IntelligenceMode;
  languageServerPlan: LanguageServerPlan | null;
  languageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  languageServerRuntimeStatusRoot: string | null;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
  phpTools: PhpToolAvailability | null;
  installingManagedPhpactor: boolean;
  isLanguageServerActiveForWorkspace: (
    status: LanguageServerRuntimeStatus | null,
    statusRoot: string | null,
    workspaceRoot: string | null | undefined,
  ) => boolean;
  toggleSmartMode: Command["run"];
  showPhpactorSetup: Command["run"];
  installManagedPhpactor: Command["run"];
  startLanguageServer: Command["run"];
  stopLanguageServer: Command["run"];
}

export function workbenchSmartCommands({
  intelligenceMode,
  languageServerPlan,
  languageServerRuntimeStatus,
  languageServerRuntimeStatusRoot,
  workspaceDescriptor,
  workspaceRoot,
  phpTools,
  installingManagedPhpactor,
  isLanguageServerActiveForWorkspace,
  toggleSmartMode,
  showPhpactorSetup,
  installManagedPhpactor,
  startLanguageServer,
  stopLanguageServer,
}: WorkbenchSmartCommandsOptions): Command[] {
  return [
    {
      id: "smart.toggle",
      title: "Toggle IDE Mode",
      category: "Intelligence",
      isEnabled: (context) => context.hasWorkspace,
      run: toggleSmartMode,
    },
    {
      id: "smart.phpactorSetup",
      title: "Show PHPactor Setup",
      category: "Intelligence",
      isEnabled: () => Boolean(createPhpactorSetupGuide(languageServerPlan)),
      run: showPhpactorSetup,
    },
    {
      id: "smart.installManagedPhpactor",
      title: "Install Managed PHP IDE Engine",
      category: "Intelligence",
      isEnabled: () =>
        Boolean(
          workspaceRoot &&
            workspaceDescriptor?.php &&
            !phpTools?.phpactor &&
            !installingManagedPhpactor,
        ),
      run: installManagedPhpactor,
    },
    {
      id: "smart.startLanguageServer",
      title: "Start PHP Language Server",
      category: "Intelligence",
      isEnabled: () =>
        shouldStartLanguageServer(intelligenceMode) &&
        languageServerPlan?.status === "ready" &&
        !isLanguageServerActiveForWorkspace(
          languageServerRuntimeStatus,
          languageServerRuntimeStatusRoot,
          workspaceRoot,
        ),
      run: startLanguageServer,
    },
    {
      id: "smart.stopLanguageServer",
      title: "Stop PHP Language Server",
      category: "Intelligence",
      isEnabled: () =>
        isLanguageServerActiveForWorkspace(
          languageServerRuntimeStatus,
          languageServerRuntimeStatusRoot,
          workspaceRoot,
        ),
      run: stopLanguageServer,
    },
  ];
}
