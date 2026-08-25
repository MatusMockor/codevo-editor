import type { useWorkbenchController } from "../application/useWorkbenchController";
import { BottomPanel } from "./BottomPanel";
import { dockedTextSearchProps } from "./dockedTextSearchProps";
import { TextSearch } from "./TextSearch";
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
  const search = (
    <TextSearch {...dockedTextSearchProps({ setOpen: onSetDockedTextSearchOpen, workbench })} />
  );

  return (
    <BottomPanel
      {...workbenchBottomPanelHostProps({
        ...input,
        onCloseSearch: () => onSetDockedTextSearchOpen(false),
        search,
        workbench,
      })}
    />
  );
}
