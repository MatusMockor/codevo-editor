import type { ComponentProps } from "react";
import type { useWorkbenchController } from "../application/useWorkbenchController";
import type { QuickOpen } from "./QuickOpen";

export function quickOpenProps(
  workbench: ReturnType<typeof useWorkbenchController>,
): ComponentProps<typeof QuickOpen> {
  return {
    isLoading: workbench.quickOpenLoading,
    isOpen: workbench.quickOpenOpen,
    isTruncated: workbench.quickOpenTruncated,
    onChangeQuery: workbench.setQuickOpenQuery,
    onClose: () => workbench.setQuickOpenOpen(false),
    onOpen: workbench.openSearchResult,
    onOpenCurrentFileLocation: workbench.openCurrentFileLocation,
    query: workbench.quickOpenQuery,
    request: workbench.quickOpenRequest,
    results: workbench.quickOpenResults,
  };
}
