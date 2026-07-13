import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  genericPhpFrameworkClassMemberCollectionProviderAdapter,
  type PhpFrameworkClassMemberCollectionProviderAdapter,
} from "./phpFrameworkClassMemberCollectionProviderAdapter";
import {
  createPhpLaravelClassMemberCollectionProviderAdapter,
} from "./phpLaravelClassMemberCollectionProviderAdapter";

export interface PhpFrameworkClassMemberCollectionProviderAdapterDependencies {
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider">;
  resolvePhpFrameworkDeclaredType(
    source: string,
    typeName: string | null,
  ): string | null;
}

export function createPhpFrameworkClassMemberCollectionProviderAdapters({
  frameworkRuntime,
  resolvePhpFrameworkDeclaredType,
}: PhpFrameworkClassMemberCollectionProviderAdapterDependencies): PhpFrameworkClassMemberCollectionProviderAdapter {
  if (!frameworkRuntime.hasProvider("laravel")) {
    return genericPhpFrameworkClassMemberCollectionProviderAdapter;
  }

  return createPhpLaravelClassMemberCollectionProviderAdapter({
    resolvePhpDeclaredType: resolvePhpFrameworkDeclaredType,
  });
}
