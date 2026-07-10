import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import {
  phpLaravelRelationStringCompletionContextAt,
  phpLaravelRouteActionMethodCompletionContextAt,
} from "../domain/phpNavigation";
import type { PhpFrameworkMethodCompletionProviderAdapter } from "./phpFrameworkMethodCompletionProviderAdapter";

export interface PhpLaravelMethodCompletionProviderAdapterDependencies {
  collectPhpLaravelRelationCompletionsForClass(
    className: string,
  ): Promise<PhpMethodCompletion[]>;
  collectPhpMethodsForClass(className: string): Promise<PhpMethodCompletion[]>;
  ensurePhpFrameworkSourceCollectionsLoaded(rootPath: string): Promise<void>;
  resolvePhpClassReference(source: string, className: string): string | null;
  resolvePhpEloquentBuilderModelType(
    source: string,
    position: EditorPosition,
    expression: string,
  ): Promise<string | null>;
  resolvePhpExpressionType(
    source: string,
    position: EditorPosition,
    expression: string,
  ): Promise<string | null>;
  resolvePhpLaravelRelationPathOwnerType(
    className: string,
    relationNames: readonly string[],
  ): Promise<string | null>;
}

export function createPhpLaravelMethodCompletionProviderAdapter({
  collectPhpLaravelRelationCompletionsForClass,
  collectPhpMethodsForClass,
  ensurePhpFrameworkSourceCollectionsLoaded,
  resolvePhpClassReference,
  resolvePhpEloquentBuilderModelType,
  resolvePhpExpressionType,
  resolvePhpLaravelRelationPathOwnerType,
}: PhpLaravelMethodCompletionProviderAdapterDependencies): PhpFrameworkMethodCompletionProviderAdapter {
  return {
    ensureSourceCollectionsLoadedForAccess: ({
      accessContext,
      rootPath,
      staticAccessContext,
    }) => {
      if (!accessContext && !staticAccessContext) {
        return;
      }

      // Warm the per-root migration + provider caches off the hot path so
      // model-attribute columns and provider-registered Builder macros surface
      // once ready. Fire-and-forget: this request is served from whatever is
      // already cached.
      void ensurePhpFrameworkSourceCollectionsLoaded(rootPath);
    },
    relationStringCompletions: async ({
      isRequestStillCurrent,
      position,
      source,
    }) => {
      const relationContext = phpLaravelRelationStringCompletionContextAt(
        source,
        position,
      );

      if (!relationContext) {
        return null;
      }

      const staticClassName = relationContext.className
        ? resolvePhpClassReference(source, relationContext.className)
        : null;
      const receiverModelType = relationContext.receiverExpression
        ? await resolvePhpEloquentBuilderModelType(
            source,
            position,
            relationContext.receiverExpression,
          )
        : null;

      if (!isRequestStillCurrent()) {
        return [];
      }

      const receiverType =
        !receiverModelType && relationContext.receiverExpression
          ? await resolvePhpExpressionType(
              source,
              position,
              relationContext.receiverExpression,
            )
          : null;

      if (!isRequestStillCurrent()) {
        return [];
      }

      const relationBaseOwnerType =
        staticClassName ?? receiverModelType ?? receiverType;
      const relationOwnerType = relationBaseOwnerType
        ? await resolvePhpLaravelRelationPathOwnerType(
            relationBaseOwnerType,
            relationContext.previousRelationNames ?? [],
          )
        : null;

      if (!isRequestStillCurrent()) {
        return [];
      }

      if (!relationOwnerType) {
        return [];
      }

      const normalizedPrefix = relationContext.prefix.toLowerCase();
      const relations =
        await collectPhpLaravelRelationCompletionsForClass(relationOwnerType);

      if (!isRequestStillCurrent()) {
        return [];
      }

      return relations
        .filter((relation) =>
          relation.name.toLowerCase().startsWith(normalizedPrefix),
        )
        .sort((left, right) =>
          phpMethodCompletionSortOrder(left, right, normalizedPrefix),
        )
        .slice(0, 80);
    },
    routeActionCompletions: async ({
      isRequestStillCurrent,
      position,
      source,
    }) => {
      const routeActionContext =
        phpLaravelRouteActionMethodCompletionContextAt(source, position);

      if (!routeActionContext) {
        return null;
      }

      const resolvedClassName = resolvePhpClassReference(
        source,
        routeActionContext.className,
      );

      if (!resolvedClassName) {
        return [];
      }

      const methods = await collectPhpMethodsForClass(resolvedClassName);

      if (!isRequestStillCurrent()) {
        return [];
      }

      const normalizedPrefix = routeActionContext.prefix.toLowerCase();

      return phpMethodCompletionsWithStableMetadata(
        methods
          .filter((method) =>
            phpLaravelRouteActionMethodCompletionMatches(
              method,
              normalizedPrefix,
            ),
          )
          .sort((left, right) =>
            phpMethodCompletionSortOrder(left, right, normalizedPrefix),
          )
          .slice(0, 80),
      );
    },
  };
}

function phpLaravelRouteActionMethodCompletionMatches(
  method: PhpMethodCompletion,
  normalizedPrefix: string,
): boolean {
  if ((method.kind ?? "method") !== "method") {
    return false;
  }

  if (method.isStatic) {
    return false;
  }

  if (method.visibility && method.visibility !== "public") {
    return false;
  }

  return method.name.toLowerCase().startsWith(normalizedPrefix);
}

function phpMethodCompletionSortOrder(
  left: PhpMethodCompletion,
  right: PhpMethodCompletion,
  normalizedPrefix: string,
): number {
  const leftExact = left.name.toLowerCase() === normalizedPrefix ? 0 : 1;
  const rightExact = right.name.toLowerCase() === normalizedPrefix ? 0 : 1;

  if (leftExact !== rightExact) {
    return leftExact - rightExact;
  }

  return left.name.localeCompare(right.name);
}

function phpMethodCompletionsWithStableMetadata(
  completions: PhpMethodCompletion[],
): PhpMethodCompletion[] {
  return completions.map(phpMethodCompletionWithStableMetadata);
}

function phpMethodCompletionWithStableMetadata(
  completion: PhpMethodCompletion,
): PhpMethodCompletion {
  if (!completion.visibility) {
    return completion;
  }

  const { visibility, ...stableCompletion } = completion;

  Object.defineProperty(stableCompletion, "visibility", {
    configurable: true,
    enumerable: false,
    value: visibility,
  });

  return stableCompletion;
}
