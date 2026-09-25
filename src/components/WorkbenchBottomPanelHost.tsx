import type { useWorkbenchController } from "../application/useWorkbenchController";
import { workbenchPanelPlacement } from "../domain/editorDrawer";
import { BottomPanel } from "./BottomPanel";
import {
  workbenchBottomPanelHostProps,
  type BottomPanelHostInput,
} from "./workbenchBottomPanelHostPresenter";

export interface WorkbenchBottomPanelHostProps extends Omit<
  BottomPanelHostInput,
  "onCloseSearch" | "search" | "workbench"
> {
  readonly workbench: ReturnType<typeof useWorkbenchController>;
  onSetDockedTextSearchOpen(open: boolean): void;
}

export function WorkbenchBottomPanelHost({
  onSetDockedTextSearchOpen,
  workbench,
  ...input
}: WorkbenchBottomPanelHostProps) {
  return (
    <BottomPanel
      {...workbenchBottomPanelHostProps({
        ...input,
        onCloseSearch: () => onSetDockedTextSearchOpen(false),
        search: null,
        workbench,
      })}
      hidden={
        !workbenchPanelPlacement(workbench.bottomPanelView, workbench.bottomPanelVisible).terminal
      }
    />
  );
}
