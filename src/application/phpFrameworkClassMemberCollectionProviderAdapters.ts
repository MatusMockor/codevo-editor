import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  genericPhpFrameworkClassMemberCollectionProviderAdapter,
  type PhpFrameworkClassMemberCollectionProviderAdapter,
} from "./phpFrameworkClassMemberCollectionProviderAdapter";
import {
  createPhpLaravelClassMemberCollectionProviderAdapter,
  type PhpLaravelClassMemberCollectionProviderAdapterDependencies,
} from "./phpLaravelClassMemberCollectionProviderAdapter";

export interface PhpFrameworkClassMemberCollectionProviderAdapterDependencies
  extends PhpLaravelClassMemberCollectionProviderAdapterDependencies {
  frameworkRuntime?: Pick<PhpFrameworkRuntimeContext, "hasProvider">;
  isLaravelFrameworkActive?: boolean;
}

export function createPhpFrameworkClassMemberCollectionProviderAdapters({
  frameworkRuntime,
  isLaravelFrameworkActive = false,
  ...laravelDependencies
}: PhpFrameworkClassMemberCollectionProviderAdapterDependencies): PhpFrameworkClassMemberCollectionProviderAdapter {
  if (frameworkRuntime && !frameworkRuntime.hasProvider("laravel")) {
    return genericPhpFrameworkClassMemberCollectionProviderAdapter;
  }

  if (!frameworkRuntime && !isLaravelFrameworkActive) {
    return genericPhpFrameworkClassMemberCollectionProviderAdapter;
  }

  return createPhpLaravelClassMemberCollectionProviderAdapter(
    laravelDependencies,
  );
}
