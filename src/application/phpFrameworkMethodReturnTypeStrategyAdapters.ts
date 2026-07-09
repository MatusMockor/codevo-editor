import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  genericPhpMethodReturnTypeStrategy,
  type PhpMethodReturnTypeStrategy,
} from "./phpMethodReturnTypeStrategy";
import {
  createPhpLaravelMethodReturnTypeStrategyAdapter,
  type PhpLaravelMethodReturnTypeStrategyAdapterDependencies,
} from "./phpLaravelMethodReturnTypeStrategyAdapter";

export interface PhpFrameworkMethodReturnTypeStrategyAdapterDependencies
  extends PhpLaravelMethodReturnTypeStrategyAdapterDependencies {
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider">;
}

export function createPhpFrameworkMethodReturnTypeStrategyAdapters({
  frameworkRuntime,
  ...laravelDependencies
}: PhpFrameworkMethodReturnTypeStrategyAdapterDependencies): PhpMethodReturnTypeStrategy {
  if (!frameworkRuntime.hasProvider("laravel")) {
    return genericPhpMethodReturnTypeStrategy;
  }

  return createPhpLaravelMethodReturnTypeStrategyAdapter(laravelDependencies);
}
