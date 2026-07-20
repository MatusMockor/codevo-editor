import type { PhpFrameworkFileChangeInvalidationContribution } from "./phpFrameworkFileChangeInvalidationContributions";

export interface PhpBladeFileChangeInvalidationDependencies {
  invalidateBladeComponentNamesForPath(rootPath: string, path: string): void;
  invalidateBladeViewDataEntriesForPath(rootPath: string, path: string): void;
}

export function createPhpBladeFileChangeInvalidationContributions({
  invalidateBladeComponentNamesForPath,
  invalidateBladeViewDataEntriesForPath,
}: PhpBladeFileChangeInvalidationDependencies): readonly PhpFrameworkFileChangeInvalidationContribution[] {
  return [
    {
      id: "blade-component-names",
      supports: (descriptor) => descriptor.kind === "bladeComponentNames",
      invalidate: ({ rootPath, path }) =>
        invalidateBladeComponentNamesForPath(rootPath, path),
    },
    {
      id: "blade-view-data-entries",
      supports: (descriptor) => descriptor.kind === "bladeViewDataEntries",
      invalidate: ({ rootPath, path }) =>
        invalidateBladeViewDataEntriesForPath(rootPath, path),
    },
  ];
}
