import {
  isLaravelEloquentBuilderMethodName,
  phpLaravelScopeMethodName,
} from "../domain/phpFrameworkLaravel";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  phpLaravelRequestMethodDefinition,
  resolvePhpClassName,
} from "../domain/phpNavigation";
import type { PhpFrameworkContextualMemberDefinitionNavigationAdapter } from "./phpFrameworkContextualMemberDefinitionNavigationAdapter";
import type { PhpFrameworkContextualMemberDefinitionNavigationContribution } from "./phpFrameworkContextualMemberDefinitionNavigationAdapters";

const ELOQUENT_BUILDER_CLASS_NAME = "Illuminate\\Database\\Eloquent\\Builder";

export interface PhpLaravelContextualMemberDefinitionNavigationAdapterDependencies {
  openDirectPhpMethodTarget(
    className: string,
    methodName: string,
  ): Promise<boolean>;
  openPhpLaravelDynamicWhereTarget(
    className: string,
    methodName: string,
  ): Promise<boolean>;
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
    ownerType: string,
    relationPath: readonly string[],
  ): Promise<string | null>;
}

export function createPhpLaravelContextualMemberDefinitionNavigationAdapter({
  openDirectPhpMethodTarget,
  openPhpLaravelDynamicWhereTarget,
  resolvePhpEloquentBuilderModelType,
  resolvePhpExpressionType,
  resolvePhpLaravelRelationPathOwnerType,
}: PhpLaravelContextualMemberDefinitionNavigationAdapterDependencies): PhpFrameworkContextualMemberDefinitionNavigationAdapter {
  return {
    dynamicWhereDefinition: async ({
      className,
      isRequestStillCurrent,
      methodName,
    }) => {
      if (!className || !isRequestStillCurrent()) {
        return { opened: false };
      }

      const opened = await openPhpLaravelDynamicWhereTarget(
        className,
        methodName,
      );

      if (!isRequestStillCurrent()) {
        return { opened: false };
      }

      return { opened };
    },
    relationStringDefinition: async ({
      context,
      isRequestStillCurrent,
      position,
      source,
    }) => {
      if (!isRequestStillCurrent()) {
        return { opened: false };
      }

      const staticClassName = context.className
        ? resolvePhpClassName(source, context.className)
        : null;
      const receiverModelType = context.receiverExpression
        ? await resolvePhpEloquentBuilderModelType(
            source,
            position,
            context.receiverExpression,
          )
        : null;

      if (!isRequestStillCurrent()) {
        return { opened: false };
      }

      const receiverType =
        !receiverModelType && context.receiverExpression
          ? await resolvePhpExpressionType(
              source,
              position,
              context.receiverExpression,
            )
          : null;

      if (!isRequestStillCurrent()) {
        return { opened: false };
      }

      const relationBaseOwnerType =
        staticClassName ?? receiverModelType ?? receiverType;
      const relationOwnerType = relationBaseOwnerType
        ? await resolvePhpLaravelRelationPathOwnerType(
            relationBaseOwnerType,
            context.previousRelationNames ?? [],
          )
        : null;

      if (!isRequestStillCurrent()) {
        return { opened: false };
      }

      if (!relationOwnerType) {
        return {
          failureMessage: `No typed target found for relation ${context.relationName}.`,
          opened: false,
        };
      }

      const opened = await openDirectPhpMethodTarget(
        relationOwnerType,
        context.relationName,
      );

      if (!isRequestStillCurrent()) {
        return { opened: false };
      }

      if (opened) {
        return { opened: true };
      }

      return {
        failureMessage: `No relation method found for ${relationOwnerType}::${context.relationName}().`,
        opened: false,
      };
    },
    supportsBuilderModelNavigation: () => true,
    requestMethodDefinitionHint: phpLaravelRequestMethodDefinition,
    localScopeMethodName: phpLaravelScopeMethodName,
    staticBuilderTargetClassName: (methodName) => {
      if (!isLaravelEloquentBuilderMethodName(methodName)) {
        return null;
      }

      return ELOQUENT_BUILDER_CLASS_NAME;
    },
  };
}

export function createPhpLaravelContextualMemberDefinitionNavigationContribution(
  deps: PhpLaravelContextualMemberDefinitionNavigationAdapterDependencies,
): PhpFrameworkContextualMemberDefinitionNavigationContribution {
  return {
    providerId: "laravel",
    id: "laravel-contextual-member-definition-navigation",
    priority: 100,
    createAdapter: () =>
      createPhpLaravelContextualMemberDefinitionNavigationAdapter(deps),
  };
}
