import { useCallback } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import {
  isLaravelCollectionFluentMethod,
  isLaravelCollectionTerminalModelMethod,
  isLaravelDatabaseConnectionType,
  isLaravelDatabaseQueryBuilderFactoryMethod,
  isLaravelDatabaseQueryBuilderFluentMethod,
  isLaravelDatabaseQueryBuilderType,
  isLaravelEloquentBuilderCollectionMethod,
  isLaravelEloquentBuilderFluentMethod,
  isLaravelEloquentBuilderTerminalModelMethod,
  isLaravelEloquentModelBuilderFactoryMethod,
  isLaravelEloquentModelFluentMethod,
  isLaravelEloquentStaticBuilderMethod,
  phpLaravelResolvedModelTypeCandidate,
} from "../domain/phpFrameworkLaravel";
import {
  phpFrameworkContainerExpressionClassName,
  phpFrameworkMethodCallReturnTypeFromSource,
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import {
  phpAssignmentExpressionForVariableBefore,
  phpClassStringCallExpression,
  phpDocRawTypeForVariableBefore,
  phpFunctionReturnsClassStringArgument,
  phpLaravelQueryCallbackContextForVariable,
  phpMethodCallExpression,
  phpNewExpressionClassName,
  phpPropertyAccessExpression,
  phpReceiverExpressionTypeInSource,
  phpStaticCallExpression,
} from "../domain/phpSemanticEngine";
import type { PhpLaravelModelTypeResolver } from "./usePhpLaravelModelTypeResolvers";
import {
  laravelFacadeTargetClassName,
  type PhpMethodReturnTypeResolver,
} from "./usePhpMethodReturnTypeResolver";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

export type PhpExpressionTypeResolver = (
  source: string,
  position: EditorPosition,
  expression: string,
  depth?: number,
) => Promise<string | null>;

export interface UsePhpExpressionTypeResolverOptions {
  activePhpFrameworkProviders: readonly PhpFrameworkProvider[];
  collectPhpMethodsForClass: (
    className: string,
  ) => Promise<PhpMethodCompletion[]>;
  frameworkRuntime?: PhpFrameworkRuntimeContext;
  isLaravelFrameworkActive?: boolean;
  phpClassHasLaravelDynamicWhere: (
    className: string,
    methodName: string,
  ) => Promise<boolean>;
  phpClassHasLaravelLocalScope: (
    className: string,
    methodName: string,
  ) => Promise<boolean>;
  resolvePhpClassPropertyOrRelationType: (
    className: string,
    propertyName: string,
    includeCollectionRelations?: boolean,
  ) => Promise<string | null>;
  resolvePhpClassReference: (source: string, className: string) => string | null;
  resolvePhpEloquentBuilderModelType: PhpLaravelModelTypeResolver;
  resolvePhpFrameworkBoundConcrete: (
    className: string,
  ) => Promise<string | null>;
  resolvePhpFrameworkReturnTypeReference: (
    source: string,
    typeName: string | null,
  ) => string | null;
  resolvePhpLaravelCollectionModelType: PhpLaravelModelTypeResolver;
  resolvePhpMethodReturnType: PhpMethodReturnTypeResolver;
  resolvePhpSemanticTypeReference: (
    source: string,
    typeName: string | null,
  ) => string | null;
}

export function usePhpExpressionTypeResolver({
  activePhpFrameworkProviders,
  collectPhpMethodsForClass,
  frameworkRuntime,
  isLaravelFrameworkActive: legacyIsLaravelFrameworkActive = false,
  phpClassHasLaravelDynamicWhere,
  phpClassHasLaravelLocalScope,
  resolvePhpClassPropertyOrRelationType,
  resolvePhpClassReference,
  resolvePhpEloquentBuilderModelType,
  resolvePhpFrameworkBoundConcrete,
  resolvePhpFrameworkReturnTypeReference,
  resolvePhpLaravelCollectionModelType,
  resolvePhpMethodReturnType,
  resolvePhpSemanticTypeReference,
}: UsePhpExpressionTypeResolverOptions) {
  const frameworkProviders =
    frameworkRuntime?.providers ?? activePhpFrameworkProviders;
  const isLaravelFrameworkActive =
    frameworkRuntime?.isLaravel ?? legacyIsLaravelFrameworkActive;

  const phpClassMethodReturnsClassStringArgument = useCallback(
    async (className: string, methodName: string): Promise<boolean> => {
      const methods = await collectPhpMethodsForClass(className);

      return methods.some(
        (method) =>
          method.kind !== "property" &&
          method.name.toLowerCase() === methodName.toLowerCase() &&
          Boolean(method.classStringTemplate),
      );
    },
    [collectPhpMethodsForClass],
  );

  const resolvePhpExpressionType: PhpExpressionTypeResolver = useCallback(
    async (
      source: string,
      position: EditorPosition,
      expression: string,
      depth = 0,
    ): Promise<string | null> => {
      if (depth > 8) {
        return null;
      }

      const resolveBoundFrameworkMethodCallReturnType = async (
        candidateExpression: string,
      ): Promise<string | null> => {
        const methodCall = phpMethodCallExpression(candidateExpression.trim());

        if (!methodCall) {
          return null;
        }

        const directReceiverType = phpReceiverExpressionTypeInSource(
          source,
          position,
          methodCall.receiverExpression,
          { frameworkProviders },
        );
        const receiverType = directReceiverType
          ? resolvePhpClassReference(source, directReceiverType)
          : null;
        const boundReceiverType = receiverType
          ? await resolvePhpFrameworkBoundConcrete(receiverType)
          : null;
        const boundReceiverReturnType =
          boundReceiverType &&
          boundReceiverType.toLowerCase() !== receiverType?.toLowerCase()
            ? await resolvePhpMethodReturnType(
                boundReceiverType,
                methodCall.methodName,
              )
            : null;

        return boundReceiverReturnType;
      };

      const variableMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(
        expression.trim(),
      );
      const assignmentExpression = variableMatch?.[1]
        ? phpAssignmentExpressionForVariableBefore(
            source,
            position,
            variableMatch[1],
          )
        : null;

      if (
        assignmentExpression &&
        variableMatch?.[1] &&
        !phpDocRawTypeForVariableBefore(source, position, variableMatch[1])
      ) {
        const boundAssignmentType =
          await resolveBoundFrameworkMethodCallReturnType(assignmentExpression);

        if (boundAssignmentType) {
          return boundAssignmentType;
        }

        const frameworkAssignmentType = resolvePhpFrameworkReturnTypeReference(
          source,
          phpReceiverExpressionTypeInSource(
            source,
            position,
            assignmentExpression,
            { frameworkProviders },
          ),
        );

        if (frameworkAssignmentType) {
          return frameworkAssignmentType;
        }

        const assignmentType = await resolvePhpExpressionType(
          source,
          position,
          assignmentExpression,
          depth + 1,
        );

        if (assignmentType) {
          return assignmentType;
        }
      }

      const directType = phpReceiverExpressionTypeInSource(
        source,
        position,
        expression,
        { frameworkProviders },
      );

      if (directType) {
        return resolvePhpSemanticTypeReference(source, directType);
      }

      if (assignmentExpression) {
        const assignmentType = await resolvePhpExpressionType(
          source,
          position,
          assignmentExpression,
          depth + 1,
        );

        if (assignmentType) {
          return assignmentType;
        }
      }

      if (
        isLaravelFrameworkActive &&
        variableMatch?.[1] &&
        phpLaravelQueryCallbackContextForVariable(
          source,
          position,
          variableMatch[1],
        )
      ) {
        const callbackBuilderModelType = await resolvePhpEloquentBuilderModelType(
          source,
          position,
          expression,
          depth + 1,
        );

        if (callbackBuilderModelType) {
          return "Illuminate\\Database\\Eloquent\\Builder";
        }
      }

      const constructedClassName =
        phpNewExpressionClassName(expression) ??
        phpFrameworkContainerExpressionClassName(
          expression,
          frameworkProviders,
        );

      if (constructedClassName) {
        return resolvePhpClassReference(source, constructedClassName);
      }

      const classStringCall = phpClassStringCallExpression(expression);

      if (classStringCall) {
        const argumentType = resolvePhpClassReference(
          source,
          classStringCall.argumentClassName,
        );
        let returnsArgumentType = false;

        if (classStringCall.kind === "functionCall") {
          returnsArgumentType = phpFunctionReturnsClassStringArgument(
            source,
            classStringCall.functionName,
          );
        }

        if (classStringCall.kind === "staticCall") {
          const ownerType = resolvePhpClassReference(
            source,
            classStringCall.className,
          );
          returnsArgumentType = ownerType
            ? await phpClassMethodReturnsClassStringArgument(
                ownerType,
                classStringCall.methodName,
              )
            : false;
        }

        if (classStringCall.kind === "methodCall") {
          const receiverType = await resolvePhpExpressionType(
            source,
            position,
            classStringCall.receiverExpression,
            depth + 1,
          );
          returnsArgumentType = receiverType
            ? await phpClassMethodReturnsClassStringArgument(
                receiverType,
                classStringCall.methodName,
              )
            : false;
        }

        if (returnsArgumentType && argumentType) {
          return argumentType;
        }
      }

      const propertyAccess = phpPropertyAccessExpression(expression);

      if (propertyAccess) {
        const receiverType = await resolvePhpExpressionType(
          source,
          position,
          propertyAccess.receiverExpression,
          depth + 1,
        );
        const propertyType = receiverType
          ? await resolvePhpClassPropertyOrRelationType(
              receiverType,
              propertyAccess.propertyName,
            )
          : null;

        if (propertyType) {
          return propertyType;
        }
      }

      const methodCall = phpMethodCallExpression(expression);

      if (methodCall) {
        if (
          isLaravelFrameworkActive &&
          isLaravelCollectionTerminalModelMethod(methodCall.methodName)
        ) {
          const collectionPropertyAccess = phpPropertyAccessExpression(
            methodCall.receiverExpression,
          );
          const collectionPropertyReceiverType = collectionPropertyAccess
            ? await resolvePhpExpressionType(
                source,
                position,
                collectionPropertyAccess.receiverExpression,
                depth + 1,
              )
            : null;
          const collectionRelationModelType =
            collectionPropertyReceiverType && collectionPropertyAccess
              ? await resolvePhpClassPropertyOrRelationType(
                  collectionPropertyReceiverType,
                  collectionPropertyAccess.propertyName,
                  true,
                )
              : null;

          if (collectionRelationModelType) {
            return collectionRelationModelType;
          }

          const modelType = await resolvePhpLaravelCollectionModelType(
            source,
            position,
            methodCall.receiverExpression,
            depth + 1,
          );

          if (modelType) {
            return modelType;
          }
        }

        if (
          isLaravelFrameworkActive &&
          isLaravelEloquentModelBuilderFactoryMethod(methodCall.methodName)
        ) {
          const modelType = await resolvePhpEloquentBuilderModelType(
            source,
            position,
            expression,
            depth + 1,
          );

          if (modelType) {
            return "Illuminate\\Database\\Eloquent\\Builder";
          }
        }

        if (
          isLaravelFrameworkActive &&
          isLaravelEloquentBuilderTerminalModelMethod(methodCall.methodName)
        ) {
          let relationExpression = methodCall.receiverExpression;
          let relationCall = phpMethodCallExpression(relationExpression);

          while (
            relationCall &&
            (isLaravelEloquentBuilderCollectionMethod(relationCall.methodName) ||
              isLaravelCollectionFluentMethod(relationCall.methodName))
          ) {
            relationExpression = relationCall.receiverExpression;
            relationCall = phpMethodCallExpression(relationExpression);
          }

          const relationPropertyAccess =
            phpPropertyAccessExpression(relationExpression);
          const relationReceiverType = relationCall
            ? await resolvePhpExpressionType(
                source,
                position,
                relationCall.receiverExpression,
                depth + 1,
              )
            : relationPropertyAccess
              ? await resolvePhpExpressionType(
                  source,
                  position,
                  relationPropertyAccess.receiverExpression,
                  depth + 1,
                )
              : null;
          const relationMemberName =
            relationCall?.methodName ?? relationPropertyAccess?.propertyName ?? null;
          const relationModelType =
            relationReceiverType && relationMemberName
              ? await resolvePhpClassPropertyOrRelationType(
                  relationReceiverType,
                  relationMemberName,
                  true,
                )
              : null;

          if (relationModelType) {
            return relationModelType;
          }

          const modelType = await resolvePhpEloquentBuilderModelType(
            source,
            position,
            methodCall.receiverExpression,
            depth + 1,
          );

          if (modelType) {
            return modelType;
          }
        }

        if (
          isLaravelFrameworkActive &&
          isLaravelEloquentBuilderCollectionMethod(methodCall.methodName)
        ) {
          const modelType = await resolvePhpEloquentBuilderModelType(
            source,
            position,
            methodCall.receiverExpression,
            depth + 1,
          );

          if (modelType) {
            return "Illuminate\\Database\\Eloquent\\Collection";
          }
        }

        if (
          isLaravelFrameworkActive &&
          isLaravelCollectionFluentMethod(methodCall.methodName)
        ) {
          const modelType = await resolvePhpLaravelCollectionModelType(
            source,
            position,
            methodCall.receiverExpression,
            depth + 1,
          );

          if (modelType) {
            return "Illuminate\\Database\\Eloquent\\Collection";
          }
        }

        if (
          isLaravelFrameworkActive &&
          isLaravelEloquentBuilderFluentMethod(methodCall.methodName)
        ) {
          const modelType = await resolvePhpEloquentBuilderModelType(
            source,
            position,
            methodCall.receiverExpression,
            depth + 1,
          );

          if (modelType) {
            return "Illuminate\\Database\\Eloquent\\Builder";
          }
        }

        if (
          isLaravelFrameworkActive &&
          isLaravelDatabaseQueryBuilderFactoryMethod(methodCall.methodName)
        ) {
          const receiverType = await resolvePhpExpressionType(
            source,
            position,
            methodCall.receiverExpression,
            depth + 1,
          );

          if (receiverType && isLaravelDatabaseConnectionType(receiverType)) {
            return "Illuminate\\Database\\Query\\Builder";
          }
        }

        if (
          isLaravelFrameworkActive &&
          isLaravelDatabaseQueryBuilderFluentMethod(methodCall.methodName)
        ) {
          const receiverType = await resolvePhpExpressionType(
            source,
            position,
            methodCall.receiverExpression,
            depth + 1,
          );

          if (receiverType && isLaravelDatabaseQueryBuilderType(receiverType)) {
            return "Illuminate\\Database\\Query\\Builder";
          }
        }

        const localScopeModelType = isLaravelFrameworkActive
          ? await resolvePhpEloquentBuilderModelType(
              source,
              position,
              methodCall.receiverExpression,
              depth + 1,
            )
          : null;

        if (
          localScopeModelType &&
          (await phpClassHasLaravelLocalScope(
            localScopeModelType,
            methodCall.methodName,
          ))
        ) {
          return "Illuminate\\Database\\Eloquent\\Builder";
        }

        if (
          localScopeModelType &&
          (await phpClassHasLaravelDynamicWhere(
            localScopeModelType,
            methodCall.methodName,
          ))
        ) {
          return "Illuminate\\Database\\Eloquent\\Builder";
        }

        const receiverType = await resolvePhpExpressionType(
          source,
          position,
          methodCall.receiverExpression,
          depth + 1,
        );
        const receiverModelType =
          isLaravelFrameworkActive && receiverType
            ? phpLaravelResolvedModelTypeCandidate(source, receiverType)
            : null;

        if (
          receiverModelType &&
          (await phpClassHasLaravelLocalScope(
            receiverModelType,
            methodCall.methodName,
          ))
        ) {
          return "Illuminate\\Database\\Eloquent\\Builder";
        }

        const boundReceiverType = receiverType
          ? await resolvePhpFrameworkBoundConcrete(receiverType)
          : null;
        const boundReceiverReturnType =
          boundReceiverType &&
          boundReceiverType.toLowerCase() !== receiverType?.toLowerCase()
            ? await resolvePhpMethodReturnType(
                boundReceiverType,
                methodCall.methodName,
              )
            : null;

        if (boundReceiverReturnType) {
          return boundReceiverReturnType;
        }

        const frameworkReturnType = phpFrameworkMethodCallReturnTypeFromSource(
          source,
          methodCall.methodName,
          receiverType,
          methodCall.receiverExpression,
          frameworkProviders,
          expression,
        );
        const resolvedFrameworkReturnType = frameworkReturnType
          ? resolvePhpFrameworkReturnTypeReference(source, frameworkReturnType)
          : null;

        if (resolvedFrameworkReturnType) {
          return resolvedFrameworkReturnType;
        }

        if (
          isLaravelFrameworkActive &&
          receiverType &&
          isLaravelEloquentModelFluentMethod(methodCall.methodName)
        ) {
          return receiverType;
        }

        return receiverType
          ? resolvePhpMethodReturnType(receiverType, methodCall.methodName)
          : null;
      }

      const staticCall = phpStaticCallExpression(expression);

      if (staticCall) {
        const className = resolvePhpClassReference(source, staticCall.className);
        const facadeTargetClassName = isLaravelFrameworkActive && className
          ? (laravelFacadeTargetClassName(className) ?? className)
          : null;
        const facadeOrClassName = facadeTargetClassName ?? className;

        if (
          isLaravelFrameworkActive &&
          className &&
          isLaravelEloquentBuilderTerminalModelMethod(staticCall.methodName)
        ) {
          return className;
        }

        if (
          isLaravelFrameworkActive &&
          className &&
          isLaravelEloquentStaticBuilderMethod(staticCall.methodName)
        ) {
          return "Illuminate\\Database\\Eloquent\\Builder";
        }

        if (
          isLaravelFrameworkActive &&
          facadeOrClassName &&
          isLaravelDatabaseQueryBuilderFactoryMethod(staticCall.methodName) &&
          isLaravelDatabaseConnectionType(facadeOrClassName)
        ) {
          return "Illuminate\\Database\\Query\\Builder";
        }

        if (
          isLaravelFrameworkActive &&
          className &&
          (await phpClassHasLaravelLocalScope(className, staticCall.methodName))
        ) {
          return "Illuminate\\Database\\Eloquent\\Builder";
        }

        if (
          isLaravelFrameworkActive &&
          className &&
          (await phpClassHasLaravelDynamicWhere(className, staticCall.methodName))
        ) {
          return "Illuminate\\Database\\Eloquent\\Builder";
        }

        return className
          ? resolvePhpMethodReturnType(className, staticCall.methodName)
          : null;
      }

      return null;
    },
    [
      frameworkProviders,
      resolvePhpEloquentBuilderModelType,
      resolvePhpLaravelCollectionModelType,
      resolvePhpClassReference,
      resolvePhpClassPropertyOrRelationType,
      phpClassMethodReturnsClassStringArgument,
      phpClassHasLaravelLocalScope,
      phpClassHasLaravelDynamicWhere,
      isLaravelFrameworkActive,
      resolvePhpFrameworkBoundConcrete,
      resolvePhpFrameworkReturnTypeReference,
      resolvePhpMethodReturnType,
      resolvePhpSemanticTypeReference,
    ],
  );

  return { resolvePhpExpressionType };
}
