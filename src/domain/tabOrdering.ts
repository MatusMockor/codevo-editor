export type TabDropPosition = "before" | "after";

interface ReorderVisibleTabsInput {
  openPaths: string[];
  previewPath: string | null;
  fromPath: string;
  toPath: string;
  position: TabDropPosition;
}

interface ReorderedVisibleTabs {
  openPaths: string[];
  previewPath: string | null;
}

export function reorderPaths(
  paths: string[],
  fromPath: string,
  toPath: string,
  position: TabDropPosition,
): string[] {
  const fromIndex = paths.indexOf(fromPath);
  const toIndex = paths.indexOf(toPath);

  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
    return [...paths];
  }

  const reordered = paths.filter((path) => path !== fromPath);
  const targetIndex = reordered.indexOf(toPath);
  const insertionIndex = position === "before" ? targetIndex : targetIndex + 1;
  reordered.splice(insertionIndex, 0, fromPath);

  return reordered;
}

export function reorderVisibleTabs({
  openPaths,
  previewPath,
  fromPath,
  toPath,
  position,
}: ReorderVisibleTabsInput): ReorderedVisibleTabs {
  const fromIsRegular = openPaths.includes(fromPath);
  const toIsRegular = openPaths.includes(toPath);
  const fromIsPreview = previewPath === fromPath;
  const toIsPreview = previewPath === toPath;

  if (
    (!fromIsRegular && !fromIsPreview) ||
    (!toIsRegular && !toIsPreview) ||
    fromPath === toPath
  ) {
    return { openPaths: [...openPaths], previewPath };
  }

  if (fromIsPreview) {
    return {
      openPaths: reorderPaths(
        [...openPaths, fromPath],
        fromPath,
        toPath,
        position,
      ),
      previewPath: null,
    };
  }

  if (toIsPreview) {
    return {
      openPaths: [
        ...openPaths.filter((path) => path !== fromPath),
        fromPath,
      ],
      previewPath,
    };
  }

  return {
    openPaths: reorderPaths(openPaths, fromPath, toPath, position),
    previewPath,
  };
}
