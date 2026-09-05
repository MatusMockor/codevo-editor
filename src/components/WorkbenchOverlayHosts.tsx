import type { WorkbenchComposition } from "../workbenchComposition";
import { DirtyCloseDecisionDialogHost } from "./DirtyCloseDecisionDialogHost";
import { QuickInputDialogHost } from "./QuickInputDialogHost";

interface WorkbenchOverlayHostsProps {
  readonly composition: Pick<
    WorkbenchComposition,
    "dirtyCloseDecisionCoordinator" | "quickInputCoordinator"
  >;
  readonly workbench: {
    readonly workspaceIdentityDescriptor: {
      readonly workspaceId: string;
    } | null;
    readonly workspaceRoot: string | null;
  };
}

/** Global declarative overlay hosts kept outside the already-large App shell. */
export function WorkbenchOverlayHosts({ composition, workbench }: WorkbenchOverlayHostsProps) {
  return (
    <>
      <DirtyCloseDecisionDialogHost coordinator={composition.dirtyCloseDecisionCoordinator} />
      <QuickInputDialogHost
        coordinator={composition.quickInputCoordinator}
        workspaceScope={
          workbench.workspaceIdentityDescriptor?.workspaceId ?? workbench.workspaceRoot
        }
      />
    </>
  );
}
