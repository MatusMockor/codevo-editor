import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  genericPhpDiagnosticContextStrategy,
  type PhpDiagnosticContextStrategy,
  type PhpDiagnosticEditorPosition,
} from "./phpDiagnosticContextStrategy";
import {
  createPhpLaravelDiagnosticContextStrategyAdapter,
} from "./phpLaravelDiagnosticContextStrategyAdapter";

export interface PhpFrameworkDiagnosticContextStrategyAdapterDependencies {
  ensurePhpFrameworkSourceCollectionsLoaded(rootPath: string): Promise<void>;
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider">;
  phpClassHasDynamicBuilderFinder(
    className: string,
    methodName: string,
  ): Promise<boolean>;
  phpClassHasNamedBuilderScope(
    className: string,
    methodName: string,
  ): Promise<boolean>;
  resolvePhpFrameworkBuilderModelType(
    source: string,
    position: PhpDiagnosticEditorPosition,
    receiverExpression: string,
  ): Promise<string | null>;
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
  ensurePhpFrameworkSourceCollectionsLoaded,
  frameworkRuntime,
  phpClassHasDynamicBuilderFinder,
  phpClassHasNamedBuilderScope,
  resolvePhpFrameworkBuilderModelType,
}: PhpFrameworkDiagnosticContextStrategyAdapterDependencies): PhpDiagnosticContextStrategy {
  const contributions: readonly PhpFrameworkDiagnosticContextStrategyContribution[] =
    [
      {
        providerId: "laravel",
        create: () =>
          createPhpLaravelDiagnosticContextStrategyAdapter({
            ensurePhpFrameworkSourceCollectionsLoaded,
            phpClassHasLaravelDynamicWhere: phpClassHasDynamicBuilderFinder,
            phpClassHasLaravelLocalScope: phpClassHasNamedBuilderScope,
            resolvePhpEloquentBuilderModelType:
              resolvePhpFrameworkBuilderModelType,
          }),
      },
    ];

  return activePhpFrameworkDiagnosticContextStrategy(
    frameworkRuntime,
    contributions,
  );
}
