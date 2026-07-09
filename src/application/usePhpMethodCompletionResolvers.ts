import { useCallback, useMemo } from "react";
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
  collectPhpLaravelDynamicWhereMethodsForClass(
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

interface LaravelMethodCompletionSemantics {
  facadeTargetClassName(className: string): string | null;
  receiverCompletionGroups(
    context: ReceiverCompletionSemanticsContext,
  ): Promise<MethodCompletionGroups>;
  staticCompletionGroups(
    context: StaticCompletionSemanticsContext,
  ): Promise<MethodCompletionGroups>;
}

interface ReceiverCompletionSemanticsContext {
  collectPhpMethodsForClass(
    className: string,
  ): Promise<PhpMethodCompletion[]>;
  position: EditorPosition;
  receiverExpression: string;
  receiverMethods: PhpMethodCompletion[];
  resolvedReceiverType: string | null;
  source: string;
}

interface StaticCompletionSemanticsContext {
  className: string;
  methods: PhpMethodCompletion[];
  source: string;
}

interface MethodCompletionGroups {
  baseMethods: PhpMethodCompletion[];
  dynamicWhereMethods: PhpMethodCompletion[];
  localScopeMethods: PhpMethodCompletion[];
}

export function usePhpMethodCompletionResolvers(
  dependencies: PhpMethodCompletionResolverDependencies,
): PhpMethodCompletionResolvers {
  const {
    activePhpFrameworkProviders,
    collectPhpLaravelDynamicWhereMethodsForClass,
    collectPhpMethodsForClass,
    currentPhpFrameworkSourceContext,
    frameworkRuntime,
    isLaravelFrameworkActive: legacyIsLaravelFrameworkActive = false,
    phpNormalizedReceiverExpressionIsThis,
    resolvePhpClassReference,
    resolvePhpEloquentBuilderModelType,
    resolvePhpExpressionType,
  } = dependencies;
  const frameworkProviders =
    frameworkRuntime?.providers ?? activePhpFrameworkProviders;
  const isLaravelFrameworkActive =
    frameworkRuntime?.isLaravel ?? legacyIsLaravelFrameworkActive;
  const frameworkSemantics = useMemo(
    () =>
      createLaravelMethodCompletionSemantics({
        collectPhpLaravelDynamicWhereMethodsForClass,
        isLaravelFrameworkActive,
        resolvePhpEloquentBuilderModelType,
      }),
    [
      collectPhpLaravelDynamicWhereMethodsForClass,
      isLaravelFrameworkActive,
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

function createLaravelMethodCompletionSemantics({
  collectPhpLaravelDynamicWhereMethodsForClass,
  isLaravelFrameworkActive,
  resolvePhpEloquentBuilderModelType,
}: Pick<
  PhpMethodCompletionResolverDependencies,
  | "collectPhpLaravelDynamicWhereMethodsForClass"
  | "resolvePhpEloquentBuilderModelType"
> & {
  isLaravelFrameworkActive: boolean;
}): LaravelMethodCompletionSemantics {
  if (!isLaravelFrameworkActive) {
    return genericMethodCompletionSemantics;
  }

  return {
    facadeTargetClassName: laravelFacadeTargetClassName,
    async receiverCompletionGroups(context) {
      const builderModelType = await resolvePhpEloquentBuilderModelType(
        context.source,
        context.position,
        context.receiverExpression,
      );
      const localScopeModelType =
        builderModelType ??
        (context.resolvedReceiverType
          ? phpLaravelResolvedModelTypeCandidate(
              context.source,
              context.resolvedReceiverType,
            )
          : null);
      const localScopeSourceMethods =
        await collectReceiverLocalScopeSourceMethods(
          localScopeModelType,
          context.resolvedReceiverType,
          context.receiverMethods,
          context.collectPhpMethodsForClass,
        );
      const dynamicWhereMethods = builderModelType
        ? await collectPhpLaravelDynamicWhereMethodsForClass(builderModelType)
        : [];

      return {
        baseMethods: receiverBaseMethods(
          context.receiverMethods,
          localScopeModelType,
          context.resolvedReceiverType,
        ),
        dynamicWhereMethods,
        localScopeMethods: localScopeModelType
          ? phpLaravelLocalScopeCompletionsFromMethods(localScopeSourceMethods)
          : [],
      };
    },
    async staticCompletionGroups({ className, methods, source }) {
      return {
        baseMethods: phpLaravelResolvedModelTypeCandidate(source, className)
          ? phpLaravelStaticModelMemberCompletionsFromMethods(methods)
          : methods.filter((method) => method.isStatic),
        dynamicWhereMethods:
          await collectPhpLaravelDynamicWhereMethodsForClass(className, {
            isStatic: true,
          }),
        localScopeMethods: phpLaravelStaticLocalScopeCompletionsFromMethods(
          methods,
        ),
      };
    },
  };
}

const genericMethodCompletionSemantics: LaravelMethodCompletionSemantics = {
  facadeTargetClassName() {
    return null;
  },
  async receiverCompletionGroups({ receiverMethods }) {
    return {
      baseMethods: receiverMethods.filter((method) => method.kind !== "scope"),
      dynamicWhereMethods: [],
      localScopeMethods: [],
    };
  },
  async staticCompletionGroups({ methods }) {
    return {
      baseMethods: methods.filter((method) => method.isStatic),
      dynamicWhereMethods: [],
      localScopeMethods: [],
    };
  },
};

async function collectReceiverLocalScopeSourceMethods(
  localScopeModelType: string | null,
  resolvedReceiverType: string | null,
  receiverMethods: PhpMethodCompletion[],
  collectPhpMethodsForClass: (
    className: string,
  ) => Promise<PhpMethodCompletion[]>,
): Promise<PhpMethodCompletion[]> {
  if (!localScopeModelType) {
    return [];
  }

  if (localScopeModelType === resolvedReceiverType) {
    return receiverMethods;
  }

  return collectPhpMethodsForClass(localScopeModelType);
}

function receiverBaseMethods(
  receiverMethods: PhpMethodCompletion[],
  localScopeModelType: string | null,
  resolvedReceiverType: string | null,
): PhpMethodCompletion[] {
  if (localScopeModelType && localScopeModelType === resolvedReceiverType) {
    return receiverMethods.filter(
      (method) => !isPhpLaravelLocalScopeSourceMethod(method),
    );
  }

  return receiverMethods.filter((method) => method.kind !== "scope");
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
