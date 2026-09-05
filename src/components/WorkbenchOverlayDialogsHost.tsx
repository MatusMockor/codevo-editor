import type { LanguageServerPlan } from "../domain/languageServer";
import { LanguageServerSetup } from "./LanguageServerSetup";
import {
  WorkbenchAppUpdaterHost,
  type WorkbenchAppUpdaterHostProps,
} from "./WorkbenchAppUpdaterHost";

export interface WorkbenchOverlayDialogsHostProps extends Omit<
  WorkbenchAppUpdaterHostProps,
  "workbench"
> {
  readonly workbench: WorkbenchAppUpdaterHostProps["workbench"] & {
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
      <WorkbenchAppUpdaterHost {...updaterProps} workbench={workbench} />
    </>
  );
}
