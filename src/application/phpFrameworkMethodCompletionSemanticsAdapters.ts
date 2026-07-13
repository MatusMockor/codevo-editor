import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { activePhpFrameworkMethodCompletionAdapter } from "./phpFrameworkMethodCompletionAdapterRegistry";
import {
  genericPhpMethodCompletionSemantics,
  type PhpFrameworkMethodCompletionSemanticsAdapter,
} from "./phpFrameworkMethodCompletionSemantics";
import {
  createPhpLaravelMethodCompletionSemanticsAdapter,
} from "./phpLaravelMethodCompletionSemanticsAdapter";

export interface PhpFrameworkMethodCompletionSemanticsAdapterDependencies {
  collectPhpFrameworkSyntheticMethodsForClass(
    className: string,
    options?: { isStatic?: boolean },
  ): Promise<PhpMethodCompletion[]>;
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider">;
  resolvePhpFrameworkBuilderModelType(
    source: string,
    position: EditorPosition,
    expression: string,
  ): Promise<string | null>;
}

export function createPhpFrameworkMethodCompletionSemanticsAdapters({
  collectPhpFrameworkSyntheticMethodsForClass,
  frameworkRuntime,
  resolvePhpFrameworkBuilderModelType,
}: PhpFrameworkMethodCompletionSemanticsAdapterDependencies): PhpFrameworkMethodCompletionSemanticsAdapter {
  return activePhpFrameworkMethodCompletionAdapter(
    frameworkRuntime,
    genericPhpMethodCompletionSemantics,
    [
      {
        providerId: "laravel",
        createAdapter: () =>
          createPhpLaravelMethodCompletionSemanticsAdapter({
            collectPhpFrameworkSyntheticMethodsForClass,
            resolvePhpEloquentBuilderModelType:
              resolvePhpFrameworkBuilderModelType,
          }),
      },
    ],
  );
}
