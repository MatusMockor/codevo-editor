import { useCallback, useMemo } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  phpMethodCompletionsFromSource,
  type PhpMethodCompletion,
} from "../domain/phpMethodCompletions";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import { phpReceiverExpressionTypeInSource } from "../domain/phpSemanticEngine";
import { createPhpFrameworkMethodCompletionSemanticsAdapters } from "./phpFrameworkMethodCompletionSemanticsAdapters";
import { phpFrameworkRuntimeContextFromDependencies } from "./phpFrameworkRuntimeDependencies";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

export interface PhpTraitThisCompletionContext {
  contextualThisClassName: string | null;
  declaringClassName: string;
  memberSource: string;
}

interface PhpFrameworkSourceRegistryContext {
  workspaceSources: readonly string[];
}

export interface PhpMethodCompletionResolverDependencies {
  activePhpFrameworkProviders: readonly PhpFrameworkProvider[];
  collectPhpFrameworkSyntheticMethodsForClass(
    className: string,
    options?: { isStatic?: boolean },
  ): Promise<PhpMethodCompletion[]>;
  collectPhpMethodsForClass(className: string): Promise<PhpMethodCompletion[]>;
  currentPhpFrameworkSourceContext(): PhpFrameworkSourceRegistryContext;
  frameworkRuntime?: PhpFrameworkRuntimeContext;
  isLaravelFrameworkActive?: boolean;
  phpNormalizedReceiverExpressionIsThis(receiverExpression: string): boolean;
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
}

export interface PhpMethodCompletionResolvers {
  resolvePhpReceiverMethodCompletions(
    source: string,
    position: EditorPosition,
    receiverExpression: string,
    traitThisContext?: PhpTraitThisCompletionContext | null,
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
    activePhpFrameworkProviders,
    collectPhpFrameworkSyntheticMethodsForClass,
    collectPhpMethodsForClass,
    currentPhpFrameworkSourceContext,
    frameworkRuntime,
    isLaravelFrameworkActive: legacyIsLaravelFrameworkActive = false,
    phpNormalizedReceiverExpressionIsThis,
    resolvePhpClassReference,
    resolvePhpEloquentBuilderModelType,
    resolvePhpExpressionType,
  } = dependencies;
  const activeFrameworkRuntime = useMemo(
    () =>
      phpFrameworkRuntimeContextFromDependencies({
        activePhpFrameworkProviders,
        frameworkRuntime,
        isLaravelFrameworkActive: legacyIsLaravelFrameworkActive,
      }),
    [
      activePhpFrameworkProviders,
      frameworkRuntime,
      legacyIsLaravelFrameworkActive,
    ],
  );
  const frameworkProviders = activeFrameworkRuntime.providers;
  const frameworkSemantics = useMemo(
    () =>
      createPhpFrameworkMethodCompletionSemanticsAdapters({
        collectPhpFrameworkSyntheticMethodsForClass,
        frameworkRuntime: activeFrameworkRuntime,
        resolvePhpEloquentBuilderModelType,
      }),
    [
      collectPhpFrameworkSyntheticMethodsForClass,
      activeFrameworkRuntime,
      resolvePhpEloquentBuilderModelType,
    ],
  );

  const resolvePhpReceiverMethodCompletions = useCallback(
    async (
      source: string,
      position: EditorPosition,
      receiverExpression: string,
      traitThisContext: PhpTraitThisCompletionContext | null = null,
    ): Promise<PhpMethodCompletion[]> => {
      if (
        traitThisContext &&
        phpNormalizedReceiverExpressionIsThis(receiverExpression)
      ) {
        const semanticOptions = traitThisContext.contextualThisClassName
          ? {
              contextualThisClassName: traitThisContext.contextualThisClassName,
              frameworkProviders,
            }
          : { frameworkProviders };
        const declaringClassName =
          phpReceiverExpressionTypeInSource(
            source,
            position,
            receiverExpression,
            semanticOptions,
          ) ?? traitThisContext.declaringClassName;
        const { workspaceSources } = currentPhpFrameworkSourceContext();

        return phpMethodCompletionsFromSource(
          traitThisContext.memberSource,
          declaringClassName,
          {
            frameworkProviders,
            frameworkSourceContext:
              workspaceSources.length > 0 ? { workspaceSources } : undefined,
          },
        );
      }

      const resolvedReceiverType = await resolvePhpExpressionType(
        source,
        position,
        receiverExpression,
      );
      const receiverMethods = resolvedReceiverType
        ? await collectPhpMethodsForClass(resolvedReceiverType)
        : [];
      const completionGroups = await frameworkSemantics.receiverCompletionGroups({
        collectPhpMethodsForClass,
        position,
        receiverExpression,
        receiverMethods,
        resolvedReceiverType,
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
    [
      collectPhpMethodsForClass,
      frameworkSemantics,
      resolvePhpClassReference,
    ],
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
