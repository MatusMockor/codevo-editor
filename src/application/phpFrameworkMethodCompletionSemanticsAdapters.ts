import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
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
  if (!frameworkRuntime.hasProvider("laravel")) {
    return genericPhpMethodCompletionSemantics;
  }

  return createPhpLaravelMethodCompletionSemanticsAdapter(
    laravelDependencies,
  );
}
