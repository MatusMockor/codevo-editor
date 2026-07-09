import type {
  PhpDiagnosticContextStrategy,
  PhpDiagnosticEditorPosition,
} from "./phpDiagnosticContextStrategy";

export interface PhpLaravelDiagnosticContextStrategyAdapterDependencies {
  ensurePhpFrameworkSourceCollectionsLoaded(rootPath: string): Promise<void>;
  phpClassHasLaravelDynamicWhere(
    className: string,
    methodName: string,
  ): Promise<boolean>;
  phpClassHasLaravelLocalScope(
    className: string,
    methodName: string,
  ): Promise<boolean>;
  resolvePhpEloquentBuilderModelType(
    source: string,
    position: PhpDiagnosticEditorPosition,
    receiverExpression: string,
  ): Promise<string | null>;
}

export function createPhpLaravelDiagnosticContextStrategyAdapter({
  ensurePhpFrameworkSourceCollectionsLoaded,
  phpClassHasLaravelDynamicWhere,
  phpClassHasLaravelLocalScope,
  resolvePhpEloquentBuilderModelType,
}: PhpLaravelDiagnosticContextStrategyAdapterDependencies): PhpDiagnosticContextStrategy {
  return {
    ensureFrameworkSourceCollectionsLoaded: (rootPath) => {
      void ensurePhpFrameworkSourceCollectionsLoaded(rootPath);
    },
    memberMethodExists: async ({
      methodName,
      position,
      receiverExpression,
      source,
    }) => {
      const builderModelType = await resolvePhpEloquentBuilderModelType(
        source,
        position,
        receiverExpression,
      );

      if (!builderModelType) {
        return false;
      }

      return phpClassHasLaravelMethod(
        builderModelType,
        methodName,
        phpClassHasLaravelLocalScope,
        phpClassHasLaravelDynamicWhere,
      );
    },
    staticMethodExists: async ({ className, methodName }) => {
      if (!className) {
        return false;
      }

      return phpClassHasLaravelMethod(
        className,
        methodName,
        phpClassHasLaravelLocalScope,
        phpClassHasLaravelDynamicWhere,
      );
    },
  };
}

async function phpClassHasLaravelMethod(
  className: string,
  methodName: string,
  phpClassHasLaravelLocalScope: (
    className: string,
    methodName: string,
  ) => Promise<boolean>,
  phpClassHasLaravelDynamicWhere: (
    className: string,
    methodName: string,
  ) => Promise<boolean>,
): Promise<boolean> {
  const hasScopeMethod = await phpClassHasLaravelLocalScope(
    className,
    methodName,
  );
  const hasDynamicWhereMethod = await phpClassHasLaravelDynamicWhere(
    className,
    methodName,
  );

  return hasScopeMethod || hasDynamicWhereMethod;
}
