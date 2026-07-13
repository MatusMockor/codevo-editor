import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  genericPhpMethodReturnTypeStrategy,
  type PhpMethodReturnTypeStrategy,
} from "./phpMethodReturnTypeStrategy";
import {
  createPhpLaravelMethodReturnTypeStrategyAdapter,
} from "./phpLaravelMethodReturnTypeStrategyAdapter";

export interface PhpFrameworkMethodReturnTypeStrategyAdapterDependencies {
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider">;
  resolvePhpFrameworkBuilderModelType(
    source: string,
    position: EditorPosition,
    expression: string,
  ): Promise<string | null>;
  resolvePhpFrameworkProjectMorphMapModelType(): Promise<string | null>;
}

export function createPhpFrameworkMethodReturnTypeStrategyAdapters({
  frameworkRuntime,
  resolvePhpFrameworkBuilderModelType,
  resolvePhpFrameworkProjectMorphMapModelType,
}: PhpFrameworkMethodReturnTypeStrategyAdapterDependencies): PhpMethodReturnTypeStrategy {
  if (!frameworkRuntime.hasProvider("laravel")) {
    return genericPhpMethodReturnTypeStrategy;
  }

  return createPhpLaravelMethodReturnTypeStrategyAdapter({
    resolvePhpEloquentBuilderModelType: resolvePhpFrameworkBuilderModelType,
    resolvePhpLaravelProjectMorphMapModelType:
      resolvePhpFrameworkProjectMorphMapModelType,
  });
}
