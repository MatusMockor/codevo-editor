import type { ComponentProps } from "react";
import type { useWorkbenchController } from "../application/useWorkbenchController";
import type { TextSearch } from "./TextSearch";

interface DockedTextSearchPropsInput {
  readonly setOpen: (open: boolean) => void;
  readonly workbench: ReturnType<typeof useWorkbenchController>;
}

export function dockedTextSearchProps({
  setOpen,
  workbench,
}: DockedTextSearchPropsInput): ComponentProps<typeof TextSearch> {
  return {
    dismissedPaths: workbench.dismissedTextSearchPaths,
    hasMoreResults: workbench.textSearchHasMoreResults,
    isLoading: workbench.textSearchLoading,
    isOpen: workbench.textSearchOpen,
    onChangeOptions: workbench.setTextSearchOptions,
    onChangeQuery: workbench.setTextSearchQuery,
    onChangeReplacement: workbench.setTextReplacement,
    onClose: () => setOpen(false),
    onDismissFile: workbench.dismissTextSearchFile,
    onLoadMore: workbench.loadMoreTextSearchResults,
    onOpen: workbench.openTextSearchResult,
    onReplaceAll: workbench.replaceAllInPath,
    onReplaceInFile: workbench.replaceInFile,
    onRestoreDismissedFiles: workbench.restoreDismissedTextSearchFiles,
    options: workbench.textSearchOptions,
    query: workbench.textSearchQuery,
    replaceBusy: workbench.textReplaceBusy,
    replacement: workbench.textReplacement,
    resultCountLowerBound: workbench.textSearchResultCountLowerBound,
    results: workbench.textSearchResults,
    resultsTruncated: workbench.textSearchResultsTruncated,
  };
}
