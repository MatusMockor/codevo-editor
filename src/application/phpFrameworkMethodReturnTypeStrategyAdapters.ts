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
import { createPhpNetteMethodReturnTypeStrategyAdapter } from "./phpNetteMethodReturnTypeStrategyAdapter";
import type { PhpNetteDatabaseTypeResolver } from "./phpNetteDatabaseTypeResolver";

export interface PhpFrameworkMethodReturnTypeStrategyAdapterDependencies {
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider" | "supports">;
  resolvePhpFrameworkBuilderModelType(
    source: string,
    position: EditorPosition,
    expression: string,
  ): Promise<string | null>;
  resolvePhpFrameworkProjectMorphMapModelType(): Promise<string | null>;
  netteDatabaseTypeResolver: PhpNetteDatabaseTypeResolver;
}

export function createPhpFrameworkMethodReturnTypeStrategyAdapters({
  frameworkRuntime,
  netteDatabaseTypeResolver,
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
      {
        capability: "netteDatabaseSemantics",
        createAdapter: () =>
          createPhpNetteMethodReturnTypeStrategyAdapter(
            netteDatabaseTypeResolver,
          ),
      },
    ],
    genericPhpMethodReturnTypeStrategy,
  );
}
