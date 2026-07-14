import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  genericPhpDiagnosticContextStrategy,
  type PhpDiagnosticContextStrategy,
  type PhpDiagnosticEditorPosition,
} from "./phpDiagnosticContextStrategy";
import {
  createPhpLaravelDiagnosticContextStrategyAdapter,
} from "./phpLaravelDiagnosticContextStrategyAdapter";
import {
  activePhpFrameworkSemanticAdapter,
  type PhpFrameworkSemanticAdapterContribution,
} from "./phpFrameworkSemanticAdapterRegistry";

export interface PhpFrameworkDiagnosticContextStrategyAdapterDependencies {
  ensurePhpFrameworkSourceCollectionsLoaded(rootPath: string): Promise<void>;
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider" | "supports">;
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

export function createPhpFrameworkDiagnosticContextStrategyAdapters({
  ensurePhpFrameworkSourceCollectionsLoaded,
  frameworkRuntime,
  phpClassHasDynamicBuilderFinder,
  phpClassHasNamedBuilderScope,
  resolvePhpFrameworkBuilderModelType,
}: PhpFrameworkDiagnosticContextStrategyAdapterDependencies): PhpDiagnosticContextStrategy {
  const contributions: readonly PhpFrameworkSemanticAdapterContribution<PhpDiagnosticContextStrategy>[] =
    [
      {
        capability: "eloquentModelSemantics",
        createAdapter: () =>
          createPhpLaravelDiagnosticContextStrategyAdapter({
            ensurePhpFrameworkSourceCollectionsLoaded,
            phpClassHasLaravelDynamicWhere: phpClassHasDynamicBuilderFinder,
            phpClassHasLaravelLocalScope: phpClassHasNamedBuilderScope,
            resolvePhpEloquentBuilderModelType:
              resolvePhpFrameworkBuilderModelType,
          }),
      },
    ];

  return activePhpFrameworkSemanticAdapter(
    frameworkRuntime,
    contributions,
    genericPhpDiagnosticContextStrategy,
  );
}
