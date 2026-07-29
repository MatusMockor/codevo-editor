import { useDockedTextSearchOpen, type DockedTextSearchDependencies } from "./useDockedTextSearch";
import {
  useWorkbenchTextSearch,
  type WorkbenchTextSearch,
  type WorkbenchTextSearchDependencies,
} from "./useWorkbenchTextSearch";

type DockedPanelDependencies = Omit<DockedTextSearchDependencies, "setTextSearchOpen">;

export interface WorkbenchDockedTextSearchDependencies
  extends WorkbenchTextSearchDependencies, DockedPanelDependencies {}

export interface WorkbenchDockedTextSearch extends Omit<WorkbenchTextSearch, "setTextSearchOpen"> {
  setTextSearchOpen(open: boolean): void;
}

export function useWorkbenchDockedTextSearch({
  bottomPanelViewRef,
  bottomPanelVisible,
  setBottomPanelView,
  setBottomPanelVisible,
  workspaceKey,
  ...textSearchDependencies
}: WorkbenchDockedTextSearchDependencies): WorkbenchDockedTextSearch {
  const textSearch = useWorkbenchTextSearch(textSearchDependencies);
  const setDockedTextSearchOpen = useDockedTextSearchOpen({
    bottomPanelViewRef,
    bottomPanelVisible,
    setBottomPanelView,
    setBottomPanelVisible,
    setTextSearchOpen: textSearch.setTextSearchOpen,
    workspaceKey,
  });
  return {
    ...textSearch,
    setTextSearchOpen: setDockedTextSearchOpen,
  };
}
