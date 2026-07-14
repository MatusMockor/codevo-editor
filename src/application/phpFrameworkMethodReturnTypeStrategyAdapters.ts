import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { activePhpFrameworkSemanticAdapter } from "./phpFrameworkSemanticAdapterRegistry";
import {
  genericPhpMethodReturnTypeStrategy,
  type PhpMethodReturnTypeStrategy,
} from "./phpMethodReturnTypeStrategy";
import {
  createPhpLaravelMethodReturnTypeStrategyAdapter,
} from "./phpLaravelMethodReturnTypeStrategyAdapter";

export interface PhpFrameworkMethodReturnTypeStrategyAdapterDependencies {
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider" | "supports">;
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
  return activePhpFrameworkSemanticAdapter(
    frameworkRuntime,
    [
      {
        capability: "eloquentModelSemantics",
        createAdapter: () =>
          createPhpLaravelMethodReturnTypeStrategyAdapter({
            resolvePhpEloquentBuilderModelType:
              resolvePhpFrameworkBuilderModelType,
            resolvePhpFrameworkProjectMorphMapModelType:
              resolvePhpFrameworkProjectMorphMapModelType,
          }),
      },
    ],
    genericPhpMethodReturnTypeStrategy,
  );
}
