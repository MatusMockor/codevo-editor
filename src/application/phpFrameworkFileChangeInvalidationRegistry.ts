import { collectActiveContributions } from "./phpFrameworkContributionRegistry";
import {
  fileChangeInvalidationContributionForDescriptor,
  type PhpFrameworkFileChangeInvalidationContributionCatalog,
} from "./phpFrameworkFileChangeInvalidationContributionCatalog";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

export function createPhpFrameworkFileChangeInvalidator({
  contributions,
  frameworkRuntime,
}: {
  contributions: PhpFrameworkFileChangeInvalidationContributionCatalog;
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "providers">;
}): (rootPath: string, path: string) => void {
  const descriptors = collectActiveContributions({
    frameworkRuntime,
    select: (provider) => provider.fileChangeInvalidations,
  });

  return (rootPath, path) => {
    for (const descriptor of descriptors) {
      const contribution = fileChangeInvalidationContributionForDescriptor(
        contributions,
        descriptor,
      );
      contribution?.invalidate({ rootPath, path });
    }
  };
}
