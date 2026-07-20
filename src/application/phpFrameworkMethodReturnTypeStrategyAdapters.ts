import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { activePhpFrameworkSemanticAdapter } from "./phpFrameworkSemanticAdapterRegistry";
import {
  type PhpContextualMethodReturnTypeStrategy,
  genericPhpMethodReturnTypeStrategy,
} from "./phpMethodReturnTypeStrategy";
import { createPhpLaravelMethodReturnTypeStrategyAdapter } from "./phpLaravelMethodReturnTypeStrategyAdapter";
import { createPhpNetteMethodReturnTypeStrategyAdapter } from "./phpNetteMethodReturnTypeStrategyAdapter";
import { createPhpNetteDatabaseTypeResolver } from "./phpNetteDatabaseTypeResolver";

export interface PhpFrameworkMethodReturnTypeStrategyAdapterDependencies {
  frameworkRuntime: Pick<
    PhpFrameworkRuntimeContext,
    "hasProvider" | "supports"
  >;
  resolvePhpFrameworkBuilderModelType(
    source: string,
    position: EditorPosition,
    expression: string,
  ): Promise<string | null>;
  resolvePhpFrameworkProjectMorphMapModelType(): Promise<string | null>;
  isWorkspaceCurrent(): boolean;
  readPhpClassSource(path: string, className: string): Promise<string>;
  resolvePhpClassSourcePaths(className: string): Promise<string[]>;
}

export function createPhpFrameworkMethodReturnTypeStrategyAdapters({
  frameworkRuntime,
  isWorkspaceCurrent,
  readPhpClassSource,
  resolvePhpClassSourcePaths,
  resolvePhpFrameworkBuilderModelType,
  resolvePhpFrameworkProjectMorphMapModelType,
}: PhpFrameworkMethodReturnTypeStrategyAdapterDependencies): PhpContextualMethodReturnTypeStrategy {
  const netteDatabaseTypeResolver = createPhpNetteDatabaseTypeResolver({
    isActive: isWorkspaceCurrent,
    readClassSource: readPhpClassSource,
    resolveClassSourcePaths: resolvePhpClassSourcePaths,
  });
  const strategy = activePhpFrameworkSemanticAdapter(
    frameworkRuntime,
    [
      {
        capability: "eloquentModelSemantics",
        id: "laravel-method-return-types",
        priority: 100,
        createAdapter: () =>
          createPhpLaravelMethodReturnTypeStrategyAdapter({
            resolvePhpEloquentBuilderModelType:
              resolvePhpFrameworkBuilderModelType,
            resolvePhpFrameworkProjectMorphMapModelType:
              resolvePhpFrameworkProjectMorphMapModelType,
          }),
      },
      {
        capability: "netteDatabaseSemantics",
        id: "nette-database-method-return-types",
        priority: 100,
        createAdapter: () =>
          createPhpNetteMethodReturnTypeStrategyAdapter(
            netteDatabaseTypeResolver,
          ),
      },
    ],
    genericPhpMethodReturnTypeStrategy,
  );
  const netteStrategy = frameworkRuntime.supports("netteDatabaseSemantics")
    ? createPhpNetteMethodReturnTypeStrategyAdapter(netteDatabaseTypeResolver)
    : null;

  return {
    ...strategy,
    async resolveDeclaredMethodReturnType(context) {
      if (netteStrategy) {
        return netteStrategy.resolveDeclaredMethodReturnType(context);
      }

      const override = await strategy.declaredReturnTypeOverride({
        lateStaticClassName: context.lateStaticClassName,
        methodName: context.methodName,
        methodReturnExpressions: context.methodReturnExpressions,
        returnType: context.resolvedReturnType,
      });

      return override ?? context.resolvedReturnType;
    },
  };
}
