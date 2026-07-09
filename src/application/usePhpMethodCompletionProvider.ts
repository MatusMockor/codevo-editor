import { useCallback, useMemo, type MutableRefObject } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  phpMemberAccessCompletionContextAt,
  phpStaticAccessCompletionContextAt,
  type PhpMethodCompletion,
} from "../domain/phpMethodCompletions";
import {
  phpFrameworkValidationRuleCompletions,
  phpFrameworkValidationRuleReferenceAt,
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import {
  phpLaravelRelationStringCompletionContextAt,
  phpLaravelRouteActionMethodCompletionContextAt,
} from "../domain/phpNavigation";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { phpFrameworkRuntimeContextFromDependencies } from "./phpFrameworkRuntimeDependencies";
import {
  resolvePhpFrameworkLiteralCompletions,
  type PhpFrameworkLiteralCompletionDependencies,
} from "./phpFrameworkLiteralCompletions";
import {
  resolvePhpFrameworkScopedCompletions,
  type PhpFrameworkScopedCompletionDependencies,
} from "./phpFrameworkScopedCompletions";
import { phpTraitThisCompletionContextAt } from "./phpTraitThisCompletionContext";

export interface PhpMethodCompletionProviderDependencies
  extends Omit<
      PhpFrameworkLiteralCompletionDependencies,
      "isRequestStillCurrent"
    >,
    Omit<PhpFrameworkScopedCompletionDependencies, "isRequestStillCurrent"> {
  activeDocument: EditorDocument | null;
  activePhpFrameworkProviders: readonly PhpFrameworkProvider[];
  collectPhpLaravelRelationCompletionsForClass(
    className: string,
  ): Promise<PhpMethodCompletion[]>;
  collectPhpMethodsForClass(className: string): Promise<PhpMethodCompletion[]>;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  ensurePhpFrameworkSourceCollectionsLoaded(rootPath: string): Promise<void>;
  frameworkRuntime?: PhpFrameworkRuntimeContext;
  isLaravelFrameworkActive?: boolean;
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
  resolvePhpReceiverMethodCompletions(
    source: string,
    position: EditorPosition,
    receiverExpression: string,
    traitThisContext?: ReturnType<typeof phpTraitThisCompletionContextAt>,
  ): Promise<PhpMethodCompletion[]>;
  resolvePhpStaticMethodCompletions(
    source: string,
    className: string,
  ): Promise<PhpMethodCompletion[]>;
  workspaceRoot: string | null;
}

export interface PhpMethodCompletionProvider {
  providePhpMethodCompletions(
    source: string,
    position: EditorPosition,
  ): Promise<PhpMethodCompletion[]>;
}

export function usePhpMethodCompletionProvider({
  activeDocument,
  activePhpFrameworkProviders,
  collectAuthGuardTargets,
  collectBroadcastConnectionTargets,
  collectCacheStoreTargets,
  collectConfigTargets,
  collectDatabaseConnectionTargets,
  collectEnvTargets,
  collectGateAbilityTargets,
  collectLogChannelTargets,
  collectMailMailerTargets,
  collectMiddlewareAliasTargets,
  collectNamedRouteTargets,
  collectPasswordBrokerTargets,
  collectPhpLaravelRelationCompletionsForClass,
  collectPhpMethodsForClass,
  collectQueueConnectionTargets,
  collectRedisConnectionTargets,
  collectStorageDiskTargets,
  collectTranslationTargets,
  collectViewTargets,
  currentWorkspaceRootRef,
  ensurePhpFrameworkSourceCollectionsLoaded,
  frameworkRuntime,
  isLaravelFrameworkActive: legacyIsLaravelFrameworkActive = false,
  resolvePhpClassReference,
  resolvePhpEloquentBuilderModelType,
  resolvePhpExpressionType,
  resolvePhpLaravelRelationPathOwnerType,
  resolvePhpReceiverMethodCompletions,
  resolvePhpStaticMethodCompletions,
  workspaceRoot,
}: PhpMethodCompletionProviderDependencies): PhpMethodCompletionProvider {
  const activeFrameworkRuntime = phpFrameworkRuntimeContextFromDependencies({
    activePhpFrameworkProviders,
    frameworkRuntime,
    isLaravelFrameworkActive: legacyIsLaravelFrameworkActive,
  });
  const frameworkProviders = activeFrameworkRuntime.providers;
  const isLaravelFrameworkActive =
    activeFrameworkRuntime.isLaravel;
  const methodCompletionStrategy = useMemo(
    () =>
      createPhpMethodCompletionProviderStrategy({
        collectPhpLaravelRelationCompletionsForClass,
        collectPhpMethodsForClass,
        ensurePhpFrameworkSourceCollectionsLoaded,
        isLaravelFrameworkActive,
        resolvePhpClassReference,
        resolvePhpEloquentBuilderModelType,
        resolvePhpExpressionType,
        resolvePhpLaravelRelationPathOwnerType,
      }),
    [
      collectPhpLaravelRelationCompletionsForClass,
      collectPhpMethodsForClass,
      ensurePhpFrameworkSourceCollectionsLoaded,
      isLaravelFrameworkActive,
      resolvePhpClassReference,
      resolvePhpEloquentBuilderModelType,
      resolvePhpExpressionType,
      resolvePhpLaravelRelationPathOwnerType,
    ],
  );

  const providePhpMethodCompletions = useCallback(
    async (
      source: string,
      position: EditorPosition,
    ): Promise<PhpMethodCompletion[]> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot) {
        return [];
      }

      const literalCompletions = await resolvePhpFrameworkLiteralCompletions(
        {
          activeDocument: activeDocument
            ? {
                content: source,
                path: activeDocument.path,
              }
            : null,
          position,
          providers: frameworkProviders,
          source,
        },
        {
          collectConfigTargets,
          collectEnvTargets,
          collectNamedRouteTargets,
          collectTranslationTargets,
          collectViewTargets,
          isRequestStillCurrent: isRequestedRootActive,
        },
      );

      if (literalCompletions !== null) {
        return literalCompletions;
      }

      const scopedCompletions = await resolvePhpFrameworkScopedCompletions(
        {
          activeDocument: activeDocument
            ? {
                path: activeDocument.path,
              }
            : null,
          frameworkRuntime: activeFrameworkRuntime,
          position,
          source,
        },
        {
          collectAuthGuardTargets,
          collectBroadcastConnectionTargets,
          collectCacheStoreTargets,
          collectDatabaseConnectionTargets,
          collectGateAbilityTargets,
          collectLogChannelTargets,
          collectMailMailerTargets,
          collectMiddlewareAliasTargets,
          collectPasswordBrokerTargets,
          collectQueueConnectionTargets,
          collectRedisConnectionTargets,
          collectStorageDiskTargets,
          isRequestStillCurrent: isRequestedRootActive,
        },
      );

      if (scopedCompletions !== null) {
        return scopedCompletions;
      }

      const routeActionCompletions =
        await methodCompletionStrategy.routeActionCompletions({
          isRequestStillCurrent: isRequestedRootActive,
          position,
          source,
        });

      if (routeActionCompletions !== null) {
        return routeActionCompletions;
      }

      const validationRuleContext = phpFrameworkValidationRuleReferenceAt(
        source,
        position,
        frameworkProviders,
      );

      if (validationRuleContext) {
        return phpFrameworkValidationRuleCompletions(
          validationRuleContext.prefix,
          frameworkProviders,
        )
          .slice(0, 80)
          .map((rule) => ({
            declaringClassName: "Laravel validation rule",
            insertText: rule.insertText,
            kind: "config",
            name: rule.name,
            parameters: "",
            returnType: null,
          }));
      }

      const relationCompletions =
        await methodCompletionStrategy.relationStringCompletions({
          isRequestStillCurrent: isRequestedRootActive,
          position,
          source,
        });

      if (relationCompletions !== null) {
        return relationCompletions;
      }

      const accessContext = phpMemberAccessCompletionContextAt(source, position);
      const staticAccessContext = phpStaticAccessCompletionContextAt(
        source,
        position,
      );

      methodCompletionStrategy.ensureSourceCollectionsLoadedForAccess({
        accessContext,
        rootPath: requestedRoot,
        staticAccessContext,
      });

      const traitThisContext = accessContext
        ? phpTraitThisCompletionContextAt(source, position)
        : null;

      const methods = staticAccessContext
        ? await resolvePhpStaticMethodCompletions(
            source,
            staticAccessContext.className,
          )
        : accessContext
          ? await resolvePhpReceiverMethodCompletions(
              source,
              position,
              accessContext.receiverExpression,
              traitThisContext,
            )
          : [];

      if (!isRequestedRootActive()) {
        return [];
      }

      const normalizedPrefix = (
        staticAccessContext?.prefix ??
        accessContext?.prefix ??
        ""
      ).toLowerCase();

      return phpMethodCompletionsWithStableMetadata(
        methods
          .filter((method) =>
            method.name.toLowerCase().startsWith(normalizedPrefix),
          )
          .sort((left, right) =>
            phpMethodCompletionSortOrder(left, right, normalizedPrefix),
          )
          .slice(0, 80),
      );
    },
    [
      activeDocument,
      collectAuthGuardTargets,
      collectBroadcastConnectionTargets,
      collectCacheStoreTargets,
      collectConfigTargets,
      collectDatabaseConnectionTargets,
      collectEnvTargets,
      collectGateAbilityTargets,
      collectLogChannelTargets,
      collectMailMailerTargets,
      collectMiddlewareAliasTargets,
      collectNamedRouteTargets,
      collectPasswordBrokerTargets,
      collectPhpLaravelRelationCompletionsForClass,
      collectPhpMethodsForClass,
      collectQueueConnectionTargets,
      collectRedisConnectionTargets,
      collectStorageDiskTargets,
      collectTranslationTargets,
      collectViewTargets,
      currentWorkspaceRootRef,
      activeFrameworkRuntime,
      frameworkProviders,
      methodCompletionStrategy,
      resolvePhpReceiverMethodCompletions,
      resolvePhpStaticMethodCompletions,
      workspaceRoot,
    ],
  );

  return { providePhpMethodCompletions };
}

export function phpNormalizedReceiverExpressionIsThis(
  receiverExpression: string,
): boolean {
  return receiverExpression.trim().replace(/\?->/g, "->") === "$this";
}

function phpMethodCompletionsWithStableMetadata(
  completions: PhpMethodCompletion[],
): PhpMethodCompletion[] {
  return completions.map(phpMethodCompletionWithStableMetadata);
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

interface PhpMethodCompletionProviderStrategy {
  ensureSourceCollectionsLoadedForAccess(
    context: PhpMethodCompletionAccessStrategyContext,
  ): void;
  relationStringCompletions(
    context: PhpMethodCompletionRequestStrategyContext,
  ): Promise<PhpMethodCompletion[] | null>;
  routeActionCompletions(
    context: PhpMethodCompletionRequestStrategyContext,
  ): Promise<PhpMethodCompletion[] | null>;
}

interface PhpMethodCompletionProviderStrategyOptions {
  collectPhpLaravelRelationCompletionsForClass(
    className: string,
  ): Promise<PhpMethodCompletion[]>;
  collectPhpMethodsForClass(className: string): Promise<PhpMethodCompletion[]>;
  ensurePhpFrameworkSourceCollectionsLoaded(rootPath: string): Promise<void>;
  isLaravelFrameworkActive: boolean;
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

interface PhpMethodCompletionRequestStrategyContext {
  isRequestStillCurrent: () => boolean;
  position: EditorPosition;
  source: string;
}

interface PhpMethodCompletionAccessStrategyContext {
  accessContext: ReturnType<typeof phpMemberAccessCompletionContextAt>;
  rootPath: string;
  staticAccessContext: ReturnType<typeof phpStaticAccessCompletionContextAt>;
}

function createPhpMethodCompletionProviderStrategy({
  collectPhpLaravelRelationCompletionsForClass,
  collectPhpMethodsForClass,
  ensurePhpFrameworkSourceCollectionsLoaded,
  isLaravelFrameworkActive,
  resolvePhpClassReference,
  resolvePhpEloquentBuilderModelType,
  resolvePhpExpressionType,
  resolvePhpLaravelRelationPathOwnerType,
}: PhpMethodCompletionProviderStrategyOptions): PhpMethodCompletionProviderStrategy {
  if (!isLaravelFrameworkActive) {
    return genericPhpMethodCompletionProviderStrategy;
  }

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

const genericPhpMethodCompletionProviderStrategy: PhpMethodCompletionProviderStrategy =
  {
    ensureSourceCollectionsLoadedForAccess: () => undefined,
    relationStringCompletions: async () => null,
    routeActionCompletions: async () => null,
  };
