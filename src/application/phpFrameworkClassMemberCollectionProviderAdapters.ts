import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  genericPhpFrameworkClassMemberCollectionProviderAdapter,
  type PhpFrameworkClassMemberCollectionProviderAdapter,
} from "./phpFrameworkClassMemberCollectionProviderAdapter";
import {
  createPhpLaravelClassMemberCollectionProviderAdapter,
} from "./phpLaravelClassMemberCollectionProviderAdapter";

export interface PhpFrameworkClassMemberCollectionProviderAdapterDependencies {
  frameworkRuntime?: Pick<PhpFrameworkRuntimeContext, "hasProvider">;
  isLaravelFrameworkActive?: boolean;
  resolvePhpFrameworkDeclaredType(
    source: string,
    typeName: string | null,
  ): string | null;
}

export function createPhpFrameworkClassMemberCollectionProviderAdapters({
  frameworkRuntime,
  isLaravelFrameworkActive = false,
  resolvePhpFrameworkDeclaredType,
}: PhpFrameworkClassMemberCollectionProviderAdapterDependencies): PhpFrameworkClassMemberCollectionProviderAdapter {
  if (frameworkRuntime && !frameworkRuntime.hasProvider("laravel")) {
    return genericPhpFrameworkClassMemberCollectionProviderAdapter;
  }

  if (!frameworkRuntime && !isLaravelFrameworkActive) {
    return genericPhpFrameworkClassMemberCollectionProviderAdapter;
  }

  return createPhpLaravelClassMemberCollectionProviderAdapter({
    resolvePhpDeclaredType: resolvePhpFrameworkDeclaredType,
  });
}
