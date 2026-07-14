import { useCallback, useMemo, type MutableRefObject } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import { detectNetteRedrawControlCompletionAt } from "../domain/netteAjaxSnippets";
import {
  phpMemberAccessCompletionContextAt,
  phpStaticAccessCompletionContextAt,
  type PhpMethodCompletion,
} from "../domain/phpMethodCompletions";
import {
  phpFrameworkValidationRuleCompletions,
  phpFrameworkValidationRuleReferenceAt,
} from "../domain/phpFrameworkProviders";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { createPhpFrameworkMethodCompletionProviderAdapters } from "./phpFrameworkMethodCompletionProviderAdapters";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  resolvePhpFrameworkLiteralCompletions,
  type PhpFrameworkLiteralCompletionDependencies,
} from "./phpFrameworkLiteralCompletions";
import {
  resolvePhpFrameworkScopedCompletions,
  type PhpFrameworkScopedCompletionDependencies,
} from "./phpFrameworkScopedCompletions";
import {
  phpNetteRedrawControlSnippetNameCompletions,
  type NetteSnippetCompletionTarget,
} from "./netteAjaxSnippetCompletions";
import { phpTraitThisCompletionContextAt } from "./phpTraitThisCompletionContext";

export interface PhpMethodCompletionProviderDependencies
  extends Omit<
      PhpFrameworkLiteralCompletionDependencies,
      "isRequestStillCurrent"
    >,
    Omit<PhpFrameworkScopedCompletionDependencies, "isRequestStillCurrent"> {
  activeDocument: EditorDocument | null;
  collectPhpFrameworkRelationCompletionsForClass(
    className: string,
  ): Promise<PhpMethodCompletion[]>;
  collectPhpMethodsForClass(className: string): Promise<PhpMethodCompletion[]>;
  collectNetteRedrawControlSnippetTargets(
    currentPhpPath: string,
  ): Promise<readonly NetteSnippetCompletionTarget[]>;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  ensurePhpFrameworkSourceCollectionsLoaded(rootPath: string): Promise<void>;
  frameworkRuntime: PhpFrameworkRuntimeContext;
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
  collectPhpFrameworkRelationCompletionsForClass,
  collectPhpMethodsForClass,
  collectNetteRedrawControlSnippetTargets,
  collectQueueConnectionTargets,
  collectRedisConnectionTargets,
  collectStorageDiskTargets,
  collectTranslationTargets,
  collectViewTargets,
  currentWorkspaceRootRef,
  ensurePhpFrameworkSourceCollectionsLoaded,
  frameworkRuntime,
  resolvePhpClassReference,
  resolvePhpFrameworkBuilderModelType,
  resolvePhpExpressionType,
  resolvePhpFrameworkRelationPathOwnerType,
  resolvePhpReceiverMethodCompletions,
  resolvePhpStaticMethodCompletions,
  workspaceRoot,
}: PhpMethodCompletionProviderDependencies): PhpMethodCompletionProvider {
  const frameworkProviders = frameworkRuntime.providers;
  const methodCompletionAdapter = useMemo(
    () =>
      createPhpFrameworkMethodCompletionProviderAdapters({
        collectPhpFrameworkRelationCompletionsForClass,
        collectPhpMethodsForClass,
        ensurePhpFrameworkSourceCollectionsLoaded,
        frameworkRuntime,
        resolvePhpClassReference,
        resolvePhpFrameworkBuilderModelType,
        resolvePhpExpressionType,
        resolvePhpFrameworkRelationPathOwnerType,
      }),
    [
      collectPhpFrameworkRelationCompletionsForClass,
      collectPhpMethodsForClass,
      ensurePhpFrameworkSourceCollectionsLoaded,
      frameworkRuntime,
      resolvePhpClassReference,
      resolvePhpFrameworkBuilderModelType,
      resolvePhpExpressionType,
      resolvePhpFrameworkRelationPathOwnerType,
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

      const offset = offsetAtPosition(source, position);

      if (
        frameworkRuntime.hasProvider("nette") &&
        activeDocument &&
        detectNetteRedrawControlCompletionAt(source, offset)
      ) {
        const targets = await collectNetteRedrawControlSnippetTargets(
          activeDocument.path,
        );

        if (!isRequestedRootActive()) {
          return [];
        }

        return phpNetteRedrawControlSnippetNameCompletions(
          source,
          offset,
          targets,
        ) ?? [];
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
          frameworkRuntime,
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
        await methodCompletionAdapter.routeActionCompletions({
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
        await methodCompletionAdapter.relationStringCompletions({
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

      methodCompletionAdapter.ensureSourceCollectionsLoadedForAccess({
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
      collectPhpFrameworkRelationCompletionsForClass,
      collectPhpMethodsForClass,
      collectNetteRedrawControlSnippetTargets,
      collectQueueConnectionTargets,
      collectRedisConnectionTargets,
      collectStorageDiskTargets,
      collectTranslationTargets,
      collectViewTargets,
      currentWorkspaceRootRef,
      frameworkRuntime,
      frameworkProviders,
      methodCompletionAdapter,
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

function offsetAtPosition(source: string, position: EditorPosition): number {
  let line = 1;
  let column = 1;

  for (let index = 0; index < source.length; index += 1) {
    if (line === position.lineNumber && column === position.column) {
      return index;
    }

    if (source[index] === "\n") {
      line += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return source.length;
}
