import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

export interface PhpFrameworkFileChangeInvalidationDependencies {
  invalidateBladeComponentNamesForPath(rootPath: string, path: string): void;
  invalidateBladeViewDataEntriesForPath(rootPath: string, path: string): void;
  invalidateNeonConfigForPath(rootPath: string, path: string): void;
}

interface PhpFrameworkFileChangeInvalidationContribution {
  readonly providerId: string;
  invalidateForPath(
    dependencies: PhpFrameworkFileChangeInvalidationDependencies,
    rootPath: string,
    path: string,
  ): void;
}

const PHP_FRAMEWORK_FILE_CHANGE_INVALIDATION_CONTRIBUTIONS: readonly PhpFrameworkFileChangeInvalidationContribution[] =
  [
    {
      providerId: "laravel",
      invalidateForPath: (dependencies, rootPath, path) => {
        dependencies.invalidateBladeComponentNamesForPath(rootPath, path);
        dependencies.invalidateBladeViewDataEntriesForPath(rootPath, path);
      },
    },
    {
      providerId: "nette",
      invalidateForPath: (dependencies, rootPath, path) => {
        dependencies.invalidateNeonConfigForPath(rootPath, path);
      },
    },
  ];

export function createPhpFrameworkFileChangeInvalidator({
  frameworkRuntime,
  ...dependencies
}: PhpFrameworkFileChangeInvalidationDependencies & {
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider">;
}): (rootPath: string, path: string) => void {
  const activeContributions =
    PHP_FRAMEWORK_FILE_CHANGE_INVALIDATION_CONTRIBUTIONS.filter(
      ({ providerId }) => frameworkRuntime.hasProvider(providerId),
    );

  return (rootPath, path) => {
    for (const contribution of activeContributions) {
      contribution.invalidateForPath(dependencies, rootPath, path);
    }
  };
}
