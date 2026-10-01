import { useCallback } from "react";

export function useSourceLocationOpener(
  openNavigationTarget: (
    filePath: string,
    position: { readonly column: number; readonly lineNumber: number },
    label: string,
    options?: { readonly shouldCommit?: () => boolean },
  ) => Promise<boolean>,
) {
  return useCallback(
    (
      filePath: string,
      lineNumber: number,
      column = 1,
      shouldCommit?: () => boolean,
    ): Promise<boolean> =>
      openNavigationTarget(
        filePath,
        { column, lineNumber },
        filePath,
        shouldCommit ? { shouldCommit } : undefined,
      ),
    [openNavigationTarget],
  );
}
