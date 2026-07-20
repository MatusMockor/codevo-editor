import { useCallback, useMemo } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import { phpObjectTypeCandidates } from "../domain/phpObjectTypeCandidates";
import { phpReceiverExpressionTypeInSource } from "../domain/phpSemanticEngine";
import { createPhpFrameworkSemanticTypeExtensions } from "./phpFrameworkSemanticTypeExtensions";
import { createPhpFrameworkMethodCompletionSemanticsAdapters } from "./phpFrameworkMethodCompletionSemanticsAdapters";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { phpFrameworkMemberCompletionContributions } from "./phpFrameworkMemberCompletionContributions";
import {
  createPhpMemberCompletionCollector,
  type PhpMemberCompletionCollector,
} from "./phpMemberCompletionContribution";
import {
  phpMethodCompletionReconciliationIdentity,
  phpMethodCompletionSemanticIdentity,
} from "./usePhpClassMemberCollectors";

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
  memberCompletionCollector?: PhpMemberCompletionCollector;
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
    memberCompletionCollector: injectedMemberCompletionCollector,
    phpNormalizedReceiverExpressionIsThis,
    resolvePhpClassReference,
    resolvePhpFrameworkBuilderModelType,
    resolvePhpExpressionType,
  } = dependencies;
  const frameworkProviders = frameworkRuntime.providers;
  const memberCompletionCollector = useMemo(
    () =>
      injectedMemberCompletionCollector ??
      createPhpMemberCompletionCollector(
        phpFrameworkMemberCompletionContributions(frameworkRuntime),
      ),
    [frameworkRuntime, injectedMemberCompletionCollector],
  );
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

        const traitMethods = memberCompletionCollector.collect(
          traitThisContext.traitMemberSource ?? traitThisContext.memberSource,
          declaringClassName,
          { includeNonPublicMembers: true },
          workspaceSources,
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
            memberCompletionCollector.collect(
              traitThisContext.sameSourceHost.memberSource,
              traitThisContext.sameSourceHost.className,
              { includeNonPublicMembers: true },
              workspaceSources,
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
      memberCompletionCollector,
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

export function mergePhpMethodCompletions(
  ...groups: PhpMethodCompletion[][]
): PhpMethodCompletion[] {
  const completions = new Map<string, PhpMethodCompletion>();

  for (const group of groups) {
    for (const completion of group) {
      const key = phpMethodCompletionSemanticIdentity(completion);

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
  const traitMap = phpMethodCompletionMap(traitMethods);

  if (hostMethodGroups.length === 0) {
    return Array.from(traitMap.values());
  }

  const hostMaps = hostMethodGroups.map(phpMethodCompletionMap);
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
    const method =
      effectiveMethods.find((candidate) => candidate.kind === "scope") ??
      effectiveMethods[0];

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

function phpMethodCompletionMap(
  methods: readonly PhpMethodCompletion[],
): Map<string, PhpMethodCompletion> {
  const completions = new Map<string, PhpMethodCompletion>();

  for (const method of methods) {
    const key = phpMethodCompletionReconciliationIdentity(method);
    const existing = completions.get(key);

    if (!existing) {
      completions.set(key, method);
      continue;
    }

    if (existing.kind !== "scope" && method.kind === "scope") {
      completions.set(key, method);
    }
  }

  return completions;
}
