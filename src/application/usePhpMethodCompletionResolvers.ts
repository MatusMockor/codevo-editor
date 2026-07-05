import { useCallback } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  phpMethodCompletionsFromSource,
  type PhpMethodCompletion,
} from "../domain/phpMethodCompletions";
import {
  isPhpLaravelLocalScopeSourceMethod,
  phpLaravelLocalScopeCompletionsFromMethods,
  phpLaravelResolvedModelTypeCandidate,
  phpLaravelStaticLocalScopeCompletionsFromMethods,
  phpLaravelStaticModelMemberCompletionsFromMethods,
} from "../domain/phpFrameworkLaravel";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import { phpReceiverExpressionTypeInSource } from "../domain/phpSemanticEngine";

export interface PhpTraitThisCompletionContext {
  contextualThisClassName: string | null;
  declaringClassName: string;
  memberSource: string;
}

interface PhpLaravelSourceContext {
  workspaceSources: readonly string[];
}

export interface PhpMethodCompletionResolverDependencies {
  activePhpFrameworkProviders: readonly PhpFrameworkProvider[];
  collectPhpLaravelDynamicWhereMethodsForClass(
    className: string,
    options?: { isStatic?: boolean },
  ): Promise<PhpMethodCompletion[]>;
  collectPhpMethodsForClass(className: string): Promise<PhpMethodCompletion[]>;
  currentPhpLaravelSourceContext(): PhpLaravelSourceContext;
  isLaravelFrameworkActive: boolean;
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
    collectPhpLaravelDynamicWhereMethodsForClass,
    collectPhpMethodsForClass,
    currentPhpLaravelSourceContext,
    isLaravelFrameworkActive,
    phpNormalizedReceiverExpressionIsThis,
    resolvePhpClassReference,
    resolvePhpEloquentBuilderModelType,
    resolvePhpExpressionType,
  } = dependencies;

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
              frameworkProviders: activePhpFrameworkProviders,
            }
          : { frameworkProviders: activePhpFrameworkProviders };
        const declaringClassName =
          phpReceiverExpressionTypeInSource(
            source,
            position,
            receiverExpression,
            semanticOptions,
          ) ?? traitThisContext.declaringClassName;
        const { workspaceSources } = currentPhpLaravelSourceContext();

        return phpMethodCompletionsFromSource(
          traitThisContext.memberSource,
          declaringClassName,
          {
            frameworkProviders: activePhpFrameworkProviders,
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
      const builderModelType = await resolvePhpEloquentBuilderModelType(
        source,
        position,
        receiverExpression,
      );
      const receiverModelType =
        !builderModelType && isLaravelFrameworkActive && resolvedReceiverType
          ? phpLaravelResolvedModelTypeCandidate(source, resolvedReceiverType)
          : null;
      const localScopeModelType = builderModelType ?? receiverModelType;
      const localScopeSourceMethods =
        localScopeModelType && localScopeModelType === resolvedReceiverType
          ? receiverMethods
          : localScopeModelType
            ? await collectPhpMethodsForClass(localScopeModelType)
            : [];
      const localScopeMethods = localScopeModelType
        ? phpLaravelLocalScopeCompletionsFromMethods(
            localScopeSourceMethods,
          )
        : [];
      const dynamicWhereMethods = builderModelType
        ? await collectPhpLaravelDynamicWhereMethodsForClass(builderModelType)
        : [];

      const receiverMethodsForMerge =
        localScopeModelType && localScopeModelType === resolvedReceiverType
          ? receiverMethods.filter(
              (method) => !isPhpLaravelLocalScopeSourceMethod(method),
            )
          : receiverMethods.filter((method) => method.kind !== "scope");

      return mergePhpMethodCompletions(
        receiverMethodsForMerge,
        localScopeMethods,
        dynamicWhereMethods,
      );
    },
    [
      activePhpFrameworkProviders,
      collectPhpLaravelDynamicWhereMethodsForClass,
      collectPhpMethodsForClass,
      currentPhpLaravelSourceContext,
      isLaravelFrameworkActive,
      phpNormalizedReceiverExpressionIsThis,
      resolvePhpEloquentBuilderModelType,
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

      const facadeTargetClassName = isLaravelFrameworkActive
        ? laravelFacadeTargetClassName(resolvedClassName)
        : null;
      const methods = await collectPhpMethodsForClass(
        facadeTargetClassName ?? resolvedClassName,
      );

      if (isLaravelFrameworkActive && facadeTargetClassName) {
        return methods;
      }

      const dynamicWhereMethods =
        await collectPhpLaravelDynamicWhereMethodsForClass(resolvedClassName, {
          isStatic: true,
        });
      const isLaravelModelStaticAccess =
        isLaravelFrameworkActive &&
        phpLaravelResolvedModelTypeCandidate(source, resolvedClassName);
      const baseMethods = isLaravelModelStaticAccess
        ? phpLaravelStaticModelMemberCompletionsFromMethods(methods)
        : methods.filter((method) => method.isStatic);

      return mergePhpMethodCompletions(
        baseMethods,
        isLaravelFrameworkActive
          ? phpLaravelStaticLocalScopeCompletionsFromMethods(methods)
          : [],
        dynamicWhereMethods,
      );
    },
    [
      collectPhpLaravelDynamicWhereMethodsForClass,
      collectPhpMethodsForClass,
      isLaravelFrameworkActive,
      resolvePhpClassReference,
    ],
  );

  return {
    resolvePhpReceiverMethodCompletions,
    resolvePhpStaticMethodCompletions,
  };
}

function laravelFacadeTargetClassName(className: string): string | null {
  const normalizedClassName = className.replace(/^\\+/, "").toLowerCase();
  const targets: Record<string, string> = {
    "illuminate\\support\\facades\\app": "Illuminate\\Contracts\\Foundation\\Application",
    "illuminate\\support\\facades\\cache": "Illuminate\\Cache\\CacheManager",
    "illuminate\\support\\facades\\config": "Illuminate\\Config\\Repository",
    "illuminate\\support\\facades\\db": "Illuminate\\Database\\DatabaseManager",
    "illuminate\\support\\facades\\event": "Illuminate\\Events\\Dispatcher",
    "illuminate\\support\\facades\\file": "Illuminate\\Filesystem\\Filesystem",
    "illuminate\\support\\facades\\gate": "Illuminate\\Contracts\\Auth\\Access\\Gate",
    "illuminate\\support\\facades\\log": "Psr\\Log\\LoggerInterface",
    "illuminate\\support\\facades\\queue": "Illuminate\\Queue\\QueueManager",
    "illuminate\\support\\facades\\route": "Illuminate\\Routing\\Router",
    "illuminate\\support\\facades\\schema": "Illuminate\\Database\\Schema\\Builder",
    "illuminate\\support\\facades\\storage": "Illuminate\\Filesystem\\FilesystemManager",
    "illuminate\\support\\facades\\validator": "Illuminate\\Validation\\Factory",
    "illuminate\\support\\facades\\view": "Illuminate\\View\\Factory",
  };

  return targets[normalizedClassName] ?? null;
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
