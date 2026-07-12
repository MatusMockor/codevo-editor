import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { activePhpFrameworkMethodCompletionAdapter } from "./phpFrameworkMethodCompletionAdapterRegistry";
import {
  genericPhpMethodCompletionSemantics,
  type PhpFrameworkMethodCompletionSemanticsAdapter,
} from "./phpFrameworkMethodCompletionSemantics";
import {
  createPhpLaravelMethodCompletionSemanticsAdapter,
  type PhpLaravelMethodCompletionSemanticsAdapterDependencies,
} from "./phpLaravelMethodCompletionSemanticsAdapter";

export interface PhpFrameworkMethodCompletionSemanticsAdapterDependencies
  extends PhpLaravelMethodCompletionSemanticsAdapterDependencies {
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider">;
}

export function createPhpFrameworkMethodCompletionSemanticsAdapters({
  frameworkRuntime,
  ...laravelDependencies
}: PhpFrameworkMethodCompletionSemanticsAdapterDependencies): PhpFrameworkMethodCompletionSemanticsAdapter {
  return activePhpFrameworkMethodCompletionAdapter(
    frameworkRuntime,
    genericPhpMethodCompletionSemantics,
    [
      {
        providerId: "laravel",
        createAdapter: () =>
          createPhpLaravelMethodCompletionSemanticsAdapter(
            laravelDependencies,
          ),
      },
    ],
  );
}
