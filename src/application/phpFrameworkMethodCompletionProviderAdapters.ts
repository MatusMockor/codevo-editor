import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  composePhpFrameworkMethodCompletionProviderAdapters,
  type PhpFrameworkMethodCompletionProviderAdapter,
} from "./phpFrameworkMethodCompletionProviderAdapter";
import {
  createPhpLaravelMethodCompletionProviderAdapter,
} from "./phpLaravelMethodCompletionProviderAdapter";
import {
  createPhpNetteMethodCompletionProviderAdapter,
} from "./phpNetteMethodCompletionProviderAdapter";
import type { NetteSnippetCompletionTarget } from "./netteAjaxSnippetCompletions";

export interface PhpFrameworkMethodCompletionProviderAdapterDependencies {
  collectPhpFrameworkRelationCompletionsForClass(
    className: string,
  ): Promise<PhpMethodCompletion[]>;
  collectPhpMethodsForClass(className: string): Promise<PhpMethodCompletion[]>;
  collectNetteRedrawControlSnippetTargets?(
    currentPhpPath: string,
  ): Promise<readonly NetteSnippetCompletionTarget[]>;
  ensurePhpFrameworkSourceCollectionsLoaded(rootPath: string): Promise<void>;
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider"> &
    Partial<Pick<PhpFrameworkRuntimeContext, "supports">>;
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
  collectNetteRedrawControlSnippetTargets,
  ensurePhpFrameworkSourceCollectionsLoaded,
  frameworkRuntime,
  resolvePhpClassReference,
  resolvePhpFrameworkBuilderModelType,
  resolvePhpExpressionType,
  resolvePhpFrameworkRelationPathOwnerType,
}: PhpFrameworkMethodCompletionProviderAdapterDependencies): PhpFrameworkMethodCompletionProviderAdapter {
  return composePhpFrameworkMethodCompletionProviderAdapters(
    [
      frameworkRuntime.supports?.("eloquentModelSemantics") === true
        ? createPhpLaravelMethodCompletionProviderAdapter({
            collectPhpFrameworkRelationCompletionsForClass,
            collectPhpMethodsForClass,
            ensurePhpFrameworkSourceCollectionsLoaded,
            resolvePhpClassReference,
            resolvePhpEloquentBuilderModelType:
              resolvePhpFrameworkBuilderModelType,
            resolvePhpExpressionType,
            resolvePhpLaravelRelationPathOwnerType:
              resolvePhpFrameworkRelationPathOwnerType,
          })
        : null,
      frameworkRuntime.supports?.("netteRedrawControlSnippetCompletions") ===
        true && collectNetteRedrawControlSnippetTargets
        ? createPhpNetteMethodCompletionProviderAdapter({
            collectNetteRedrawControlSnippetTargets,
          })
        : null,
    ].filter(
      (
        adapter,
      ): adapter is PhpFrameworkMethodCompletionProviderAdapter =>
        adapter !== null,
    ),
  );
}
