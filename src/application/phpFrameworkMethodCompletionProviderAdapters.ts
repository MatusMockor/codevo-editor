import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { activePhpFrameworkMethodCompletionAdapter } from "./phpFrameworkMethodCompletionAdapterRegistry";
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
  return activePhpFrameworkMethodCompletionAdapter(
    frameworkRuntime,
    genericPhpFrameworkMethodCompletionProviderAdapter,
    [
      {
        providerId: "laravel",
        createAdapter: () =>
          createPhpLaravelMethodCompletionProviderAdapter(laravelDependencies),
      },
    ],
  );
}
