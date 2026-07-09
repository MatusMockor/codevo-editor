import {
  isPhpLaravelLocalScopeSourceMethod,
  phpLaravelLocalScopeCompletionsFromMethods,
  phpLaravelResolvedModelTypeCandidate,
  phpLaravelStaticLocalScopeCompletionsFromMethods,
  phpLaravelStaticModelMemberCompletionsFromMethods,
} from "../domain/phpFrameworkLaravel";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpFrameworkMethodCompletionSemanticsAdapter } from "./phpFrameworkMethodCompletionSemantics";

export interface PhpLaravelMethodCompletionSemanticsAdapterDependencies {
  collectPhpLaravelDynamicWhereMethodsForClass(
    className: string,
    options?: { isStatic?: boolean },
  ): Promise<PhpMethodCompletion[]>;
  resolvePhpEloquentBuilderModelType(
    source: string,
    position: EditorPosition,
    expression: string,
  ): Promise<string | null>;
}

export function createPhpLaravelMethodCompletionSemanticsAdapter({
  collectPhpLaravelDynamicWhereMethodsForClass,
  resolvePhpEloquentBuilderModelType,
}: PhpLaravelMethodCompletionSemanticsAdapterDependencies): PhpFrameworkMethodCompletionSemanticsAdapter {
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
