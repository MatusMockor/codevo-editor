import type { WorkbenchNotice } from "../application/workbenchNotice";
import type { WorkbenchComposition } from "../workbenchComposition";
import { DirtyCloseDecisionDialogHost } from "./DirtyCloseDecisionDialogHost";
import {
  NoticeToastHost,
  type NoticeToastRenderer,
} from "./NoticeToastHost";
import { QuickInputDialogHost } from "./QuickInputDialogHost";

interface WorkbenchOverlayHostsProps {
  readonly composition: Pick<
    WorkbenchComposition,
    "dirtyCloseDecisionCoordinator" | "quickInputCoordinator"
  >;
  readonly renderNotice: NoticeToastRenderer;
  readonly workbench: {
    readonly notices: WorkbenchNotice[];
    readonly workspaceIdentityDescriptor: {
      readonly workspaceId: string;
    } | null;
    readonly workspaceRoot: string | null;
  };
}

/** Global declarative overlay hosts kept outside the already-large App shell. */
export function WorkbenchOverlayHosts({
  composition,
  renderNotice,
  workbench,
}: WorkbenchOverlayHostsProps) {
  return (
    <>
      <NoticeToastHost
        notices={workbench.notices}
        renderNotice={renderNotice}
      />
      <DirtyCloseDecisionDialogHost
        coordinator={composition.dirtyCloseDecisionCoordinator}
      />
      <QuickInputDialogHost
        coordinator={composition.quickInputCoordinator}
        workspaceScope={
          workbench.workspaceIdentityDescriptor?.workspaceId ??
          workbench.workspaceRoot
        }
      />
    </>
  );
}
