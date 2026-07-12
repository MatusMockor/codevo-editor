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

export interface PhpFrameworkDiagnosticContextStrategyContribution {
  readonly providerId: string;
  create(): PhpDiagnosticContextStrategy;
}

export function activePhpFrameworkDiagnosticContextStrategy(
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider">,
  contributions: readonly PhpFrameworkDiagnosticContextStrategyContribution[],
): PhpDiagnosticContextStrategy {
  const contribution = contributions.find(({ providerId }) =>
    frameworkRuntime.hasProvider(providerId),
  );

  if (!contribution) {
    return genericPhpDiagnosticContextStrategy;
  }

  return contribution.create();
}

export function createPhpFrameworkDiagnosticContextStrategyAdapters({
  frameworkRuntime,
  ...laravelDependencies
}: PhpFrameworkDiagnosticContextStrategyAdapterDependencies): PhpDiagnosticContextStrategy {
  const contributions: readonly PhpFrameworkDiagnosticContextStrategyContribution[] =
    [
      {
        providerId: "laravel",
        create: () =>
          createPhpLaravelDiagnosticContextStrategyAdapter(
            laravelDependencies,
          ),
      },
    ];

  return activePhpFrameworkDiagnosticContextStrategy(
    frameworkRuntime,
    contributions,
  );
}
