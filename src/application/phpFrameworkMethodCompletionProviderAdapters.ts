import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  genericPhpFrameworkMethodCompletionProviderAdapter,
  type PhpFrameworkMethodCompletionProviderAdapter,
} from "./phpFrameworkMethodCompletionProviderAdapter";
import {
  createPhpLaravelMethodCompletionProviderAdapter,
  type PhpLaravelMethodCompletionProviderAdapterDependencies,
} from "./phpLaravelMethodCompletionProviderAdapter";

export interface PhpFrameworkMethodCompletionProviderAdapterDependencies
  extends PhpLaravelMethodCompletionProviderAdapterDependencies {
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider">;
}

export function createPhpFrameworkMethodCompletionProviderAdapters({
  frameworkRuntime,
  ...laravelDependencies
}: PhpFrameworkMethodCompletionProviderAdapterDependencies): PhpFrameworkMethodCompletionProviderAdapter {
  if (!frameworkRuntime.hasProvider("laravel")) {
    return genericPhpFrameworkMethodCompletionProviderAdapter;
  }

  return createPhpLaravelMethodCompletionProviderAdapter(laravelDependencies);
}
