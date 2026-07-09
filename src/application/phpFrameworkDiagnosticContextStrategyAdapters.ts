import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  genericPhpDiagnosticContextStrategy,
  type PhpDiagnosticContextStrategy,
} from "./phpDiagnosticContextStrategy";
import {
  createPhpLaravelDiagnosticContextStrategyAdapter,
  type PhpLaravelDiagnosticContextStrategyAdapterDependencies,
} from "./phpLaravelDiagnosticContextStrategyAdapter";

export interface PhpFrameworkDiagnosticContextStrategyAdapterDependencies
  extends PhpLaravelDiagnosticContextStrategyAdapterDependencies {
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider">;
}

export function createPhpFrameworkDiagnosticContextStrategyAdapters({
  frameworkRuntime,
  ...laravelDependencies
}: PhpFrameworkDiagnosticContextStrategyAdapterDependencies): PhpDiagnosticContextStrategy {
  if (!frameworkRuntime.hasProvider("laravel")) {
    return genericPhpDiagnosticContextStrategy;
  }

  return createPhpLaravelDiagnosticContextStrategyAdapter(laravelDependencies);
}
