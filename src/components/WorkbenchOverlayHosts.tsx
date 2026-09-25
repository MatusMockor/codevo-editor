import type { WorkbenchComposition } from "../workbenchComposition";
import { DirtyCloseDecisionDialogHost } from "./DirtyCloseDecisionDialogHost";
import { QuickInputDialogHost } from "./QuickInputDialogHost";
import { WorkspaceTrustDialogHost } from "./projects/WorkspaceTrustDialogHost";

interface WorkbenchOverlayHostsProps {
  readonly composition: Pick<
    WorkbenchComposition,
    "dirtyCloseDecisionCoordinator" | "quickInputCoordinator" | "workspaceTrustPrompt"
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
      <WorkspaceTrustDialogHost
        prompt={composition.workspaceTrustPrompt}
        workspaceScope={
          workbench.workspaceIdentityDescriptor?.workspaceId ?? workbench.workspaceRoot
        }
      />
    </>
  );
}
