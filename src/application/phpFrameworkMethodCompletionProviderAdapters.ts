import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { activePhpFrameworkMethodCompletionAdapter } from "./phpFrameworkMethodCompletionAdapterRegistry";
import {
  genericPhpFrameworkMethodCompletionProviderAdapter,
  type PhpFrameworkMethodCompletionProviderAdapter,
} from "./phpFrameworkMethodCompletionProviderAdapter";
import {
  createPhpLaravelMethodCompletionProviderAdapter,
} from "./phpLaravelMethodCompletionProviderAdapter";

export interface PhpFrameworkMethodCompletionProviderAdapterDependencies {
  collectPhpFrameworkRelationCompletionsForClass(
    className: string,
  ): Promise<PhpMethodCompletion[]>;
  collectPhpMethodsForClass(className: string): Promise<PhpMethodCompletion[]>;
  ensurePhpFrameworkSourceCollectionsLoaded(rootPath: string): Promise<void>;
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider">;
  resolvePhpClassReference(source: string, className: string): string | null;
  resolvePhpFrameworkBuilderModelType(
    source: string,
    position: EditorPosition,
    expression: string,
  ): Promise<string | null>;
  resolvePhpExpressionType(
    source: string,
    position: EditorPosition,
    expression: string,
  ): Promise<string | null>;
  resolvePhpFrameworkRelationPathOwnerType(
    className: string,
    relationNames: readonly string[],
  ): Promise<string | null>;
}

export function createPhpFrameworkMethodCompletionProviderAdapters({
  collectPhpFrameworkRelationCompletionsForClass,
  collectPhpMethodsForClass,
  ensurePhpFrameworkSourceCollectionsLoaded,
  frameworkRuntime,
  resolvePhpClassReference,
  resolvePhpFrameworkBuilderModelType,
  resolvePhpExpressionType,
  resolvePhpFrameworkRelationPathOwnerType,
}: PhpFrameworkMethodCompletionProviderAdapterDependencies): PhpFrameworkMethodCompletionProviderAdapter {
  return activePhpFrameworkMethodCompletionAdapter(
    frameworkRuntime,
    genericPhpFrameworkMethodCompletionProviderAdapter,
    [
      {
        providerId: "laravel",
        createAdapter: () =>
          createPhpLaravelMethodCompletionProviderAdapter({
            collectPhpFrameworkRelationCompletionsForClass,
            collectPhpMethodsForClass,
            ensurePhpFrameworkSourceCollectionsLoaded,
            resolvePhpClassReference,
            resolvePhpEloquentBuilderModelType:
              resolvePhpFrameworkBuilderModelType,
            resolvePhpExpressionType,
            resolvePhpLaravelRelationPathOwnerType:
              resolvePhpFrameworkRelationPathOwnerType,
          }),
      },
    ],
  );
}
