import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { activePhpFrameworkSemanticAdapter } from "./phpFrameworkSemanticAdapterRegistry";
import {
  genericPhpFrameworkClassMemberCollectionProviderAdapter,
  type PhpFrameworkClassMemberCollectionProviderAdapter,
} from "./phpFrameworkClassMemberCollectionProviderAdapter";
import {
  createPhpLaravelClassMemberCollectionProviderAdapter,
} from "./phpLaravelClassMemberCollectionProviderAdapter";

export interface PhpFrameworkClassMemberCollectionProviderAdapterDependencies {
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider" | "supports">;
  resolvePhpFrameworkDeclaredType(
    source: string,
    typeName: string | null,
  ): string | null;
}

export function createPhpFrameworkClassMemberCollectionProviderAdapters({
  frameworkRuntime,
  resolvePhpFrameworkDeclaredType,
}: PhpFrameworkClassMemberCollectionProviderAdapterDependencies): PhpFrameworkClassMemberCollectionProviderAdapter {
  return activePhpFrameworkSemanticAdapter(
    frameworkRuntime,
    [
      {
        capability: "eloquentModelSemantics",
        createAdapter: () =>
          createPhpLaravelClassMemberCollectionProviderAdapter({
            resolvePhpDeclaredType: resolvePhpFrameworkDeclaredType,
          }),
      },
    ],
    genericPhpFrameworkClassMemberCollectionProviderAdapter,
  );
}
