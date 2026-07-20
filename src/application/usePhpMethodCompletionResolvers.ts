import { useCallback, useMemo } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  phpMethodCompletionsFromSource,
  type PhpMethodCompletion,
} from "../domain/phpMethodCompletions";
import { phpObjectTypeCandidates } from "../domain/phpObjectTypeCandidates";
import { phpReceiverExpressionTypeInSource } from "../domain/phpSemanticEngine";
import { createPhpFrameworkSemanticTypeExtensions } from "./phpFrameworkSemanticTypeExtensions";
import { createPhpFrameworkMethodCompletionSemanticsAdapters } from "./phpFrameworkMethodCompletionSemanticsAdapters";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

export interface PhpTraitThisCompletionContext {
  contextualThisClassName: string | null;
  declaringClassName: string;
  hostClassNames?: readonly string[];
  memberSource: string;
  sameSourceHost?: {
    className: string;
    memberSource: string;
  };
  traitMemberSource?: string;
}

interface PhpFrameworkSourceRegistryContext {
  workspaceSources: readonly string[];
}

export interface PhpMethodCompletionResolverDependencies {
  collectPhpFrameworkSyntheticMethodsForClass(
    className: string,
    options?: { isStatic?: boolean },
  ): Promise<PhpMethodCompletion[]>;
  collectPhpMethodsForClass(
    className: string,
    options?: { includeNonPublicMembers?: boolean },
  ): Promise<PhpMethodCompletion[]>;
  currentPhpFrameworkSourceContext(): PhpFrameworkSourceRegistryContext;
  frameworkRuntime: PhpFrameworkRuntimeContext;
  phpNormalizedReceiverExpressionIsThis(receiverExpression: string): boolean;
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
}

export interface PhpMethodCompletionResolvers {
  resolvePhpReceiverMethodCompletions(
    source: string,
    position: EditorPosition,
    receiverExpression: string,
    traitThisContext?: PhpTraitThisCompletionContext | null,
    isRequestStillCurrent?: () => boolean,
  ): Promise<PhpMethodCompletion[]>;
  resolvePhpStaticMethodCompletions(
    source: string,
    className: string,
  ): Promise<PhpMethodCompletion[]>;
}

export function usePhpMethodCompletionResolvers(
  dependencies: PhpMethodCompletionResolverDependencies,
): PhpMethodCompletionResolvers {
  const {
    collectPhpFrameworkSyntheticMethodsForClass,
    collectPhpMethodsForClass,
    currentPhpFrameworkSourceContext,
    frameworkRuntime,
    phpNormalizedReceiverExpressionIsThis,
    resolvePhpClassReference,
    resolvePhpFrameworkBuilderModelType,
    resolvePhpExpressionType,
  } = dependencies;
  const frameworkProviders = frameworkRuntime.providers;
  const typeExtensions = useMemo(
    () =>
      createPhpFrameworkSemanticTypeExtensions({
        providers: frameworkProviders,
      }),
    [frameworkProviders],
  );
  const frameworkSemantics = useMemo(
    () =>
      createPhpFrameworkMethodCompletionSemanticsAdapters({
        collectPhpFrameworkSyntheticMethodsForClass,
        frameworkRuntime,
        resolvePhpFrameworkBuilderModelType,
      }),
    [
      collectPhpFrameworkSyntheticMethodsForClass,
      frameworkRuntime,
      resolvePhpFrameworkBuilderModelType,
    ],
  );

  const resolvePhpReceiverMethodCompletions = useCallback(
    async (
      source: string,
      position: EditorPosition,
      receiverExpression: string,
      traitThisContext: PhpTraitThisCompletionContext | null = null,
      isRequestStillCurrent: () => boolean = () => true,
    ): Promise<PhpMethodCompletion[]> => {
      if (
        traitThisContext &&
        phpNormalizedReceiverExpressionIsThis(receiverExpression)
      ) {
        const semanticOptions = traitThisContext.contextualThisClassName
          ? {
              contextualThisClassName: traitThisContext.contextualThisClassName,
              typeExtensions,
            }
          : { typeExtensions };
        const declaringClassName =
          phpReceiverExpressionTypeInSource(
            source,
            position,
            receiverExpression,
            semanticOptions,
          ) ?? traitThisContext.declaringClassName;
        const { workspaceSources } = currentPhpFrameworkSourceContext();

        const traitMethods = phpMethodCompletionsFromSource(
          traitThisContext.traitMemberSource ?? traitThisContext.memberSource,
          declaringClassName,
          {
            frameworkProviders,
            frameworkSourceContext:
              workspaceSources.length > 0 ? { workspaceSources } : undefined,
            includeNonPublicMembers: true,
          },
        );

        if (
          !traitThisContext.hostClassNames &&
          !traitThisContext.sameSourceHost
        ) {
          return traitMethods;
        }

        const hostMethodGroups: PhpMethodCompletion[][] = [];

        if (traitThisContext.sameSourceHost) {
          hostMethodGroups.push(
            phpMethodCompletionsFromSource(
              traitThisContext.sameSourceHost.memberSource,
              traitThisContext.sameSourceHost.className,
              {
                frameworkProviders,
                frameworkSourceContext:
                  workspaceSources.length > 0
                    ? { workspaceSources }
                    : undefined,
                includeNonPublicMembers: true,
              },
            ),
          );
        }

        for (const hostClassName of traitThisContext.hostClassNames ?? []) {
          const hostMethods = await collectPhpMethodsForClass(hostClassName, {
            includeNonPublicMembers: true,
          });

          if (!isRequestStillCurrent()) {
            return [];
          }

          hostMethodGroups.push(hostMethods);
        }

        return mergePhpTraitAndHostMethodCompletions(
          traitMethods,
          hostMethodGroups,
        );
      }

      const resolvedReceiverType = await resolvePhpExpressionType(
        source,
        position,
        receiverExpression,
      );
      const receiverTypeCandidates =
        phpObjectTypeCandidates(resolvedReceiverType);

      if (receiverTypeCandidates.length > 1) {
        return [];
      }

      const receiverType = receiverTypeCandidates[0] ?? null;
      const receiverMethods = receiverType
        ? await collectPhpMethodsForClass(receiverType)
        : [];
      const completionGroups =
        await frameworkSemantics.receiverCompletionGroups({
          collectPhpMethodsForClass,
          position,
          receiverExpression,
          receiverMethods,
          resolvedReceiverType: receiverType,
          source,
        });

      return mergePhpMethodCompletions(
        completionGroups.baseMethods,
        completionGroups.localScopeMethods,
        completionGroups.dynamicWhereMethods,
      );
    },
    [
      collectPhpMethodsForClass,
      currentPhpFrameworkSourceContext,
      frameworkSemantics,
      typeExtensions,
      frameworkProviders,
      phpNormalizedReceiverExpressionIsThis,
      resolvePhpExpressionType,
    ],
  );

  const resolvePhpStaticMethodCompletions = useCallback(
    async (
      source: string,
      className: string,
    ): Promise<PhpMethodCompletion[]> => {
      const resolvedClassName = resolvePhpClassReference(source, className);

      if (!resolvedClassName) {
        return [];
      }

      const facadeTargetClassName =
        frameworkSemantics.facadeTargetClassName(resolvedClassName);
      const methods = await collectPhpMethodsForClass(
        facadeTargetClassName ?? resolvedClassName,
      );

      if (facadeTargetClassName) {
        return methods;
      }

      const completionGroups = await frameworkSemantics.staticCompletionGroups({
        className: resolvedClassName,
        methods,
        source,
      });

      return mergePhpMethodCompletions(
        completionGroups.baseMethods,
        completionGroups.localScopeMethods,
        completionGroups.dynamicWhereMethods,
      );
    },
    [collectPhpMethodsForClass, frameworkSemantics, resolvePhpClassReference],
  );

  return {
    resolvePhpReceiverMethodCompletions,
    resolvePhpStaticMethodCompletions,
  };
}

function mergePhpMethodCompletions(
  ...groups: PhpMethodCompletion[][]
): PhpMethodCompletion[] {
  const completions = new Map<string, PhpMethodCompletion>();

  for (const group of groups) {
    for (const completion of group) {
      const key = `${completion.kind ?? "method"}:${completion.name.toLowerCase()}`;

      if (!completions.has(key)) {
        completions.set(key, completion);
      }
    }
  }

  return Array.from(completions.values());
}

export function mergePhpTraitAndHostMethodCompletions(
  traitMethods: PhpMethodCompletion[],
  hostMethodGroups: readonly PhpMethodCompletion[][],
): PhpMethodCompletion[] {
  const traitMap = new Map(
    traitMethods.map((method) => [phpMethodCompletionKey(method), method]),
  );

  if (hostMethodGroups.length === 0) {
    return Array.from(traitMap.values());
  }

  const hostMaps = hostMethodGroups.map(
    (methods) =>
      new Map(
        methods.map((method) => [phpMethodCompletionKey(method), method]),
      ),
  );
  const candidateKeys = new Set([
    ...traitMap.keys(),
    ...hostMaps.flatMap((hostMethods) => Array.from(hostMethods.keys())),
  ]);
  const merged = new Map<string, PhpMethodCompletion>();

  for (const key of candidateKeys) {
    const effectiveMethods = hostMaps
      .map((hostMethods) => hostMethods.get(key) ?? traitMap.get(key))
      .filter((candidate): candidate is PhpMethodCompletion =>
        Boolean(candidate),
      );

    if (effectiveMethods.length !== hostMaps.length) {
      continue;
    }

    const returnTypes = new Set(
      effectiveMethods.map((candidate) => candidate.returnType ?? null),
    );
    const method = effectiveMethods[0];

    if (!method) {
      continue;
    }

    merged.set(
      key,
      returnTypes.size === 1 ? method : { ...method, returnType: null },
    );
  }

  return Array.from(merged.values());
}

function phpMethodCompletionKey(completion: PhpMethodCompletion): string {
  return `${completion.kind ?? "method"}:${completion.name.toLowerCase()}`;
}
