import type { PhpFrameworkFileChangeInvalidationDescriptor } from "../domain/phpFrameworkProviders";
import { collectActiveContributions } from "./phpFrameworkContributionRegistry";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

export interface PhpFrameworkFileChangeInvalidationDependencies {
  invalidateBladeComponentNamesForPath(rootPath: string, path: string): void;
  invalidateBladeViewDataEntriesForPath(rootPath: string, path: string): void;
  invalidateLatteExpressionDataForPath(rootPath: string, path: string): void;
  invalidateNeonConfigForPath(rootPath: string, path: string): void;
}

export function createPhpFrameworkFileChangeInvalidator({
  frameworkRuntime,
  ...dependencies
}: PhpFrameworkFileChangeInvalidationDependencies & {
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "providers">;
}): (rootPath: string, path: string) => void {
  const descriptors = collectActiveContributions({
    frameworkRuntime,
    select: (provider) => provider.fileChangeInvalidations,
  });

  return (rootPath, path) => {
    for (const descriptor of descriptors) {
      invalidateDescriptorForPath(descriptor, dependencies, rootPath, path);
    }
  };
}

function invalidateDescriptorForPath(
  descriptor: PhpFrameworkFileChangeInvalidationDescriptor,
  dependencies: PhpFrameworkFileChangeInvalidationDependencies,
  rootPath: string,
  path: string,
): void {
  switch (descriptor.kind) {
    case "bladeComponentNames":
      dependencies.invalidateBladeComponentNamesForPath(rootPath, path);
      return;
    case "bladeViewDataEntries":
      dependencies.invalidateBladeViewDataEntriesForPath(rootPath, path);
      return;
    case "latteExpressionData":
      dependencies.invalidateLatteExpressionDataForPath(rootPath, path);
      return;
    case "neonConfig":
      dependencies.invalidateNeonConfigForPath(rootPath, path);
      return;
  }
}
