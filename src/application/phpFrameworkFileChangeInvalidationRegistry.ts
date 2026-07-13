import type { PhpFrameworkFileChangeInvalidationDescriptor } from "../domain/phpFrameworkProviders";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

export interface PhpFrameworkFileChangeInvalidationDependencies {
  invalidateBladeComponentNamesForPath(rootPath: string, path: string): void;
  invalidateBladeViewDataEntriesForPath(rootPath: string, path: string): void;
  invalidateNeonConfigForPath(rootPath: string, path: string): void;
}

export function createPhpFrameworkFileChangeInvalidator({
  frameworkRuntime,
  ...dependencies
}: PhpFrameworkFileChangeInvalidationDependencies & {
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "providers">;
}): (rootPath: string, path: string) => void {
  const descriptors = frameworkRuntime.providers.flatMap(
    (provider) => provider.fileChangeInvalidations ?? [],
  );

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
    case "neonConfig":
      dependencies.invalidateNeonConfigForPath(rootPath, path);
      return;
  }
}
