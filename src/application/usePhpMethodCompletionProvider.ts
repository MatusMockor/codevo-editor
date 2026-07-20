import { useCallback, useMemo } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  phpMemberAccessCompletionContextAt,
  phpStaticAccessCompletionContextAt,
  type PhpMethodCompletion,
} from "../domain/phpMethodCompletions";
import {
  phpNamedArgumentCompletionContextAt,
  phpNamedArgumentCallableMembersFromSource,
  phpNamedArgumentCompletions,
  phpNamedArgumentFunctionIdentity,
  type PhpNamedArgumentCompletionContext,
} from "../domain/phpNamedArgumentCompletions";
import type { ProjectSymbolSearchGateway } from "../domain/projectSymbols";
import {
  phpFrameworkValidationRuleCompletions,
  phpFrameworkValidationRuleReferenceAt,
} from "../domain/phpFrameworkValidationDispatch";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { createPhpFrameworkMethodCompletionProviderAdapters } from "./phpFrameworkMethodCompletionProviderAdapters";
import {
  phpFrameworkMethodCompletionProviderDependencyExtrasForRuntime,
  usePhpFrameworkMethodCompletionProviderDependencyAdapterResults,
  type PhpFrameworkMethodCompletionProviderDependencyAdapterHookDependencies,
} from "./phpFrameworkMethodCompletionProviderDependencyAdapters";
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
  phpTraitDeclarationCompletionContextAt,
  phpTraitThisCompletionContextAt,
} from "./phpTraitThisCompletionContext";

export interface PhpMethodCompletionProviderDependencies
  extends
    Omit<PhpFrameworkLiteralCompletionDependencies, "isRequestStillCurrent">,
    Omit<PhpFrameworkScopedCompletionDependencies, "isRequestStillCurrent">,
    PhpFrameworkMethodCompletionProviderDependencyAdapterHookDependencies {
  activeDocument: EditorDocument | null;
  collectPhpFrameworkRelationCompletionsForClass(
    className: string,
  ): Promise<PhpMethodCompletion[]>;
  collectPhpMethodsForClass(className: string): Promise<PhpMethodCompletion[]>;
  ensurePhpFrameworkSourceCollectionsLoaded(rootPath: string): Promise<void>;
  frameworkRuntime: PhpFrameworkRuntimeContext;
  phpVersionConstraint?: string | null;
  projectSymbolSearch: ProjectSymbolSearchGateway;
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
    isRequestStillCurrent?: () => boolean,
  ): Promise<PhpMethodCompletion[]>;
  resolvePhpTraitHostClassNames(traitClassName: string): Promise<string[]>;
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
  collectQueueConnectionTargets,
  collectRedisConnectionTargets,
  collectStorageDiskTargets,
  collectTranslationTargets,
  collectViewTargets,
  currentWorkspaceRootRef,
  ensurePhpFrameworkSourceCollectionsLoaded,
  frameworkRuntime,
  joinWorkspacePath,
  phpVersionConstraint = null,
  projectSymbolSearch,
  readNavigationFileContent,
  relativeWorkspacePath,
  resolvePhpClassReference,
  resolvePhpFrameworkBuilderModelType,
  resolvePhpExpressionType,
  resolvePhpFrameworkRelationPathOwnerType,
  resolvePhpReceiverMethodCompletions,
  resolvePhpStaticMethodCompletions,
  resolvePhpTraitHostClassNames,
  workspaceRoot,
}: PhpMethodCompletionProviderDependencies): PhpMethodCompletionProvider {
  const frameworkProviders = frameworkRuntime.providers;
  const methodDependencyAdapterResults =
    usePhpFrameworkMethodCompletionProviderDependencyAdapterResults({
      currentWorkspaceRootRef,
      joinWorkspacePath,
      readNavigationFileContent,
      relativeWorkspacePath,
      workspaceRoot,
    });
  const methodDependencyExtras =
    phpFrameworkMethodCompletionProviderDependencyExtrasForRuntime(
      frameworkRuntime,
      methodDependencyAdapterResults,
    );
  const methodCompletionAdapter = useMemo(
    () =>
      createPhpFrameworkMethodCompletionProviderAdapters({
        collectPhpFrameworkRelationCompletionsForClass,
        collectPhpMethodsForClass,
        ensurePhpFrameworkSourceCollectionsLoaded,
        frameworkRuntime,
        ...methodDependencyExtras,
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
      methodDependencyExtras,
      resolvePhpClassReference,
      resolvePhpFrameworkBuilderModelType,
      resolvePhpExpressionType,
      resolvePhpFrameworkRelationPathOwnerType,
    ],
  );

  const resolvePhpTraitThisContext = useCallback(
    async (
      source: string,
      position: EditorPosition,
      receiverExpression: string,
    ): Promise<ReturnType<typeof phpTraitThisCompletionContextAt>> => {
      const sameSourceTraitThisContext = phpTraitThisCompletionContextAt(
        source,
        position,
      );
      const traitDeclarationContext = phpNormalizedReceiverExpressionIsThis(
        receiverExpression,
      )
        ? phpTraitDeclarationCompletionContextAt(source, position)
        : null;
      const traitHostClassNames = traitDeclarationContext
        ? await resolvePhpTraitHostClassNames(
            traitDeclarationContext.declaringClassName,
          )
        : [];
      const crossFileTraitHostClassNames = sameSourceTraitThisContext
        ? traitHostClassNames.filter(
            (className) =>
              className.toLowerCase() !==
              sameSourceTraitThisContext.declaringClassName.toLowerCase(),
          )
        : traitHostClassNames;

      if (sameSourceTraitThisContext) {
        return {
          ...sameSourceTraitThisContext,
          hostClassNames: crossFileTraitHostClassNames,
        };
      }

      if (traitDeclarationContext) {
        return {
          contextualThisClassName: null,
          declaringClassName: traitDeclarationContext.declaringClassName,
          hostClassNames: crossFileTraitHostClassNames,
          memberSource: traitDeclarationContext.memberSource,
        };
      }

      return null;
    },
    [resolvePhpTraitHostClassNames],
  );

  const resolveNamedArgumentCallableMembers = useCallback(
    async (
      namedArgumentContext: PhpNamedArgumentCompletionContext,
      source: string,
      position: EditorPosition,
      isRequestStillCurrent: () => boolean,
    ): Promise<PhpMethodCompletion[]> => {
      const callTarget = namedArgumentContext.callTarget;

      if (callTarget.kind === "local-callable") {
        return phpNamedArgumentCallableMembersFromSource(
          source,
          namedArgumentContext,
          position,
        );
      }

      if (callTarget.kind === "function") {
        const localMembers = phpNamedArgumentCallableMembersFromSource(
          source,
          namedArgumentContext,
          position,
        );
        if (localMembers.length > 0) {
          return localMembers;
        }

        const identity = phpNamedArgumentFunctionIdentity(
          source,
          namedArgumentContext,
          position,
        );
        if (!workspaceRoot || !identity) {
          return [];
        }

        const shortName = identity.split("\\").pop();
        if (!shortName) {
          return [];
        }

        const symbols = await projectSymbolSearch.searchProjectSymbols(
          workspaceRoot,
          shortName,
          50,
        );
        if (!isRequestStillCurrent()) {
          return [];
        }

        const normalizedIdentity = identity.replace(/^\\+/, "").toLowerCase();
        const target = symbols.find(
          (symbol) =>
            symbol.kind === "function" &&
            symbol.fullyQualifiedName.replace(/^\\+/, "").toLowerCase() ===
              normalizedIdentity,
        );
        if (!target) {
          return [];
        }

        const targetSource = await readNavigationFileContent(target.path);
        if (!isRequestStillCurrent()) {
          return [];
        }

        return phpNamedArgumentCallableMembersFromSource(targetSource, {
          ...namedArgumentContext,
          callTarget: {
            functionName: `\\${identity.replace(/^\\+/, "")}`,
            kind: "function",
          },
        });
      }

      if (callTarget.kind === "constructor") {
        const resolvedClassName = resolvePhpClassReference(
          source,
          callTarget.className,
        );

        if (!resolvedClassName) {
          return [];
        }

        return collectPhpMethodsForClass(resolvedClassName);
      }

      if (callTarget.kind === "static-method") {
        return resolvePhpStaticMethodCompletions(source, callTarget.className);
      }

      const traitThisContext = await resolvePhpTraitThisContext(
        source,
        position,
        callTarget.receiverExpression,
      );

      if (!isRequestStillCurrent()) {
        return [];
      }

      return resolvePhpReceiverMethodCompletions(
        source,
        position,
        callTarget.receiverExpression,
        traitThisContext,
        isRequestStillCurrent,
      );
    },
    [
      collectPhpMethodsForClass,
      projectSymbolSearch,
      readNavigationFileContent,
      resolvePhpClassReference,
      resolvePhpReceiverMethodCompletions,
      resolvePhpStaticMethodCompletions,
      resolvePhpTraitThisContext,
      workspaceRoot,
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

      const literalStringAdapterCompletions =
        await methodCompletionAdapter.literalStringCompletions({
          activeDocumentPath: activeDocument?.path ?? null,
          isRequestStillCurrent: isRequestedRootActive,
          position,
          source,
        });

      if (literalStringAdapterCompletions !== null) {
        return literalStringAdapterCompletions;
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

      const namedArgumentContext = phpNamedArgumentCompletionContextAt(
        source,
        position,
        phpVersionConstraint,
      );

      if (namedArgumentContext) {
        const callableMembers = await resolveNamedArgumentCallableMembers(
          namedArgumentContext,
          source,
          position,
          isRequestedRootActive,
        );

        if (!isRequestedRootActive()) {
          return [];
        }

        const namedArgumentCompletions = phpNamedArgumentCompletions(
          namedArgumentContext,
          callableMembers,
        );

        if (namedArgumentCompletions.length > 0) {
          return phpMethodCompletionsWithStableMetadata(
            namedArgumentCompletions.slice(0, 80),
          );
        }
      }

      const accessContext = phpMemberAccessCompletionContextAt(
        source,
        position,
      );
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
        ? await resolvePhpTraitThisContext(
            source,
            position,
            accessContext.receiverExpression,
          )
        : null;

      if (!isRequestedRootActive()) {
        return [];
      }

      const methods = staticAccessContext
        ? await resolvePhpStaticMethodCompletions(
            source,
            staticAccessContext.className,
          )
        : accessContext
          ? (
              await resolvePhpReceiverMethodCompletions(
                source,
                position,
                accessContext.receiverExpression,
                traitThisContext,
                isRequestedRootActive,
              )
            ).filter((method) => !method.isEnumCase)
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
      collectQueueConnectionTargets,
      collectRedisConnectionTargets,
      collectStorageDiskTargets,
      collectTranslationTargets,
      collectViewTargets,
      currentWorkspaceRootRef,
      frameworkRuntime,
      frameworkProviders,
      methodCompletionAdapter,
      resolveNamedArgumentCallableMembers,
      resolvePhpReceiverMethodCompletions,
      resolvePhpStaticMethodCompletions,
      resolvePhpTraitThisContext,
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
