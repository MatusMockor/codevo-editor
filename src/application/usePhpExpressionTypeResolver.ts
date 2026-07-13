import { useCallback, useMemo } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
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
  type PhpMethodCallExpression,
  type PhpStaticCallExpression,
  phpMethodCallExpression,
  phpNewExpressionClassName,
  phpPropertyAccessExpression,
  phpReceiverExpressionTypeInSource,
  phpStaticCallExpression,
} from "../domain/phpSemanticEngine";
import type { PhpFrameworkDatabaseExpressionTypeAdapter } from "./phpFrameworkDatabaseExpressionTypeAdapter";
import type { PhpFrameworkBuilderMagicExpressionTypeAdapter } from "./phpFrameworkBuilderMagicExpressionTypeAdapter";
import type { PhpFrameworkModelFluentExpressionTypeAdapter } from "./phpFrameworkModelFluentExpressionTypeAdapter";
import type { PhpFrameworkModelBuilderTransitionExpressionTypeAdapter } from "./phpFrameworkModelBuilderTransitionExpressionTypeAdapter";
import type { PhpFrameworkQueryCallbackVariableExpressionTypeAdapter } from "./phpFrameworkQueryCallbackVariableExpressionTypeAdapter";
import type { PhpFrameworkTerminalModelRecoveryExpressionTypeAdapter } from "./phpFrameworkTerminalModelRecoveryExpressionTypeAdapter";
import type { PhpMethodReturnTypeResolver } from "./usePhpMethodReturnTypeResolver";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { createPhpExpressionTypeAdapterBundle } from "./phpExpressionTypeAdapterRegistry";

export type PhpExpressionTypeResolver = (
  source: string,
  position: EditorPosition,
  expression: string,
  depth?: number,
) => Promise<string | null>;

export type PhpFrameworkModelCarrierTypeResolver = (
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
  frameworkRuntime: PhpFrameworkRuntimeContext;
  phpClassHasDynamicBuilderFinder: (
    className: string,
    methodName: string,
  ) => Promise<boolean>;
  phpClassHasNamedBuilderScope: (
    className: string,
    methodName: string,
  ) => Promise<boolean>;
  resolvePhpClassPropertyOrRelationType: (
    className: string,
    propertyName: string,
    includeCollectionRelations?: boolean,
  ) => Promise<string | null>;
  resolvePhpClassReference: (source: string, className: string) => string | null;
  resolvePhpBuilderModelType: PhpFrameworkModelCarrierTypeResolver;
  resolvePhpFrameworkBoundConcrete: (
    className: string,
  ) => Promise<string | null>;
  resolvePhpFrameworkReturnTypeReference: (
    source: string,
    typeName: string | null,
  ) => string | null;
  resolvePhpCollectionModelType: PhpFrameworkModelCarrierTypeResolver;
  resolvePhpMethodReturnType: PhpMethodReturnTypeResolver;
  resolvePhpSemanticTypeReference: (
    source: string,
    typeName: string | null,
  ) => string | null;
}

export function usePhpExpressionTypeResolver({
  collectPhpMethodsForClass,
  frameworkRuntime,
  phpClassHasDynamicBuilderFinder,
  phpClassHasNamedBuilderScope,
  resolvePhpClassPropertyOrRelationType,
  resolvePhpClassReference,
  resolvePhpBuilderModelType,
  resolvePhpFrameworkBoundConcrete,
  resolvePhpFrameworkReturnTypeReference,
  resolvePhpCollectionModelType,
  resolvePhpMethodReturnType,
  resolvePhpSemanticTypeReference,
}: UsePhpExpressionTypeResolverOptions) {
  const frameworkProviders = frameworkRuntime.providers;
  const expressionTypeStrategy = useMemo(
    () => {
      const adapterBundle = createPhpExpressionTypeAdapterBundle({
        frameworkRuntime,
        phpClassHasDynamicBuilderFinder,
        phpClassHasNamedBuilderScope,
        resolvePropertyOrRelationType: resolvePhpClassPropertyOrRelationType,
      });

      return createPhpExpressionTypeStrategy({
        ...adapterBundle,
        resolvePhpBuilderModelType,
        resolvePhpCollectionModelType,
      });
    },
    [
      frameworkRuntime,
      phpClassHasDynamicBuilderFinder,
      phpClassHasNamedBuilderScope,
      resolvePhpClassPropertyOrRelationType,
      resolvePhpBuilderModelType,
      resolvePhpCollectionModelType,
    ],
  );

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

      const strategyVariableType = await expressionTypeStrategy.variableType({
        frameworkProviders,
        position,
        resolveBuilderModelType: () =>
          resolvePhpBuilderModelType(
            source,
            position,
            expression,
            depth + 1,
          ),
        source,
        variableName: variableMatch?.[1] ?? null,
      });

      if (strategyVariableType) {
        return strategyVariableType;
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
        let resolvedReceiverType: string | null | undefined;
        const resolveReceiverType = async (): Promise<string | null> => {
          if (resolvedReceiverType !== undefined) {
            return resolvedReceiverType;
          }

          resolvedReceiverType = await resolvePhpExpressionType(
            source,
            position,
            methodCall.receiverExpression,
            depth + 1,
          );

          return resolvedReceiverType;
        };

        const strategyReturnType = await expressionTypeStrategy.methodCallType({
          depth,
          expression,
          methodCall,
          position,
          resolvePhpExpressionType,
          resolveReceiverType,
          source,
        });

        if (strategyReturnType) {
          return strategyReturnType;
        }

        const receiverType = await resolveReceiverType();

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

        const strategyReceiverReturnType =
          expressionTypeStrategy.receiverMethodCallType({
            methodName: methodCall.methodName,
            receiverType,
          });

        if (strategyReceiverReturnType) {
          return strategyReceiverReturnType;
        }

        return receiverType
          ? resolvePhpMethodReturnType(receiverType, methodCall.methodName)
          : null;
      }

      const staticCall = phpStaticCallExpression(expression);

      if (staticCall) {
        const className = resolvePhpClassReference(source, staticCall.className);

        const strategyReturnType = await expressionTypeStrategy.staticCallType({
          className,
          staticCall,
        });

        if (strategyReturnType) {
          return strategyReturnType;
        }

        return className
          ? resolvePhpMethodReturnType(className, staticCall.methodName)
          : null;
      }

      return null;
    },
    [
      expressionTypeStrategy,
      frameworkProviders,
      resolvePhpClassReference,
      resolvePhpClassPropertyOrRelationType,
      phpClassMethodReturnsClassStringArgument,
      resolvePhpFrameworkBoundConcrete,
      resolvePhpFrameworkReturnTypeReference,
      resolvePhpMethodReturnType,
      resolvePhpSemanticTypeReference,
    ],
  );

  return { resolvePhpExpressionType };
}

interface PhpExpressionTypeStrategy {
  methodCallType: (
    context: PhpExpressionMethodCallStrategyContext,
  ) => Promise<string | null>;
  receiverMethodCallType: PhpFrameworkModelFluentExpressionTypeAdapter["receiverMethodCallType"];
  staticCallType: (
    context: PhpExpressionStaticCallStrategyContext,
  ) => Promise<string | null>;
  variableType: PhpFrameworkQueryCallbackVariableExpressionTypeAdapter["variableType"];
}

interface PhpExpressionTypeStrategyOptions {
  builderMagicExpressionTypeAdapter: PhpFrameworkBuilderMagicExpressionTypeAdapter;
  databaseExpressionTypeAdapter: PhpFrameworkDatabaseExpressionTypeAdapter;
  modelBuilderTransitionExpressionTypeAdapter: PhpFrameworkModelBuilderTransitionExpressionTypeAdapter;
  modelFluentExpressionTypeAdapter: PhpFrameworkModelFluentExpressionTypeAdapter;
  queryCallbackVariableExpressionTypeAdapter: PhpFrameworkQueryCallbackVariableExpressionTypeAdapter;
  terminalModelRecoveryExpressionTypeAdapter: PhpFrameworkTerminalModelRecoveryExpressionTypeAdapter;
  resolvePhpBuilderModelType: PhpFrameworkModelCarrierTypeResolver;
  resolvePhpCollectionModelType: PhpFrameworkModelCarrierTypeResolver;
}

interface PhpExpressionMethodCallStrategyContext {
  depth: number;
  expression: string;
  methodCall: PhpMethodCallExpression;
  position: EditorPosition;
  resolvePhpExpressionType: PhpExpressionTypeResolver;
  resolveReceiverType: () => Promise<string | null>;
  source: string;
}

interface PhpExpressionStaticCallStrategyContext {
  className: string | null;
  staticCall: PhpStaticCallExpression;
}

function createPhpExpressionTypeStrategy({
  builderMagicExpressionTypeAdapter,
  databaseExpressionTypeAdapter,
  modelBuilderTransitionExpressionTypeAdapter,
  modelFluentExpressionTypeAdapter,
  queryCallbackVariableExpressionTypeAdapter,
  terminalModelRecoveryExpressionTypeAdapter,
  resolvePhpBuilderModelType,
  resolvePhpCollectionModelType,
}: PhpExpressionTypeStrategyOptions): PhpExpressionTypeStrategy {
  return {
    methodCallType: async ({
      depth,
      expression,
      methodCall,
      position,
      resolvePhpExpressionType,
      resolveReceiverType,
      source,
    }) => {
      const modelBuilderTransitionMethodCallType =
        await modelBuilderTransitionExpressionTypeAdapter.methodCallType({
          methodName: methodCall.methodName,
          resolveCollectionTerminalModelType: () =>
            terminalModelRecoveryExpressionTypeAdapter.collectionTerminalModelType(
              {
                receiverExpression: methodCall.receiverExpression,
                resolveCollectionModelType: () =>
                  resolvePhpCollectionModelType(
                    source,
                    position,
                    methodCall.receiverExpression,
                    depth + 1,
                  ),
                resolveExpressionType: (candidateExpression) =>
                  resolvePhpExpressionType(
                    source,
                    position,
                    candidateExpression,
                    depth + 1,
                  ),
              },
            ),
          resolveModelFactoryModelType: () =>
            resolvePhpBuilderModelType(
              source,
              position,
              expression,
              depth + 1,
            ),
          resolveBuilderTerminalModelType: () =>
            terminalModelRecoveryExpressionTypeAdapter.builderTerminalModelType(
              {
                receiverExpression: methodCall.receiverExpression,
                resolveBuilderModelType: () =>
                  resolvePhpBuilderModelType(
                    source,
                    position,
                    methodCall.receiverExpression,
                    depth + 1,
                  ),
                resolveExpressionType: (candidateExpression) =>
                  resolvePhpExpressionType(
                    source,
                    position,
                    candidateExpression,
                    depth + 1,
                  ),
              },
            ),
          resolveBuilderModelType: () =>
            resolvePhpBuilderModelType(
              source,
              position,
              methodCall.receiverExpression,
              depth + 1,
            ),
          resolveCollectionModelType: () =>
            resolvePhpCollectionModelType(
              source,
              position,
              methodCall.receiverExpression,
              depth + 1,
            ),
        });

      if (modelBuilderTransitionMethodCallType) {
        return modelBuilderTransitionMethodCallType;
      }

      const databaseMethodCallType =
        await databaseExpressionTypeAdapter.methodCallType({
          methodName: methodCall.methodName,
          resolveReceiverType,
        });

      if (databaseMethodCallType) {
        return databaseMethodCallType;
      }

      const builderMagicMethodCallType =
        await builderMagicExpressionTypeAdapter.methodCallType({
          methodName: methodCall.methodName,
          resolveBuilderModelType: () =>
            resolvePhpBuilderModelType(
              source,
              position,
              methodCall.receiverExpression,
              depth + 1,
            ),
          resolveReceiverType,
          source,
        });

      if (builderMagicMethodCallType) {
        return builderMagicMethodCallType;
      }

      return null;
    },
    receiverMethodCallType:
      modelFluentExpressionTypeAdapter.receiverMethodCallType,
    staticCallType: async ({ className, staticCall }) => {
      const modelBuilderTransitionStaticCallType =
        await modelBuilderTransitionExpressionTypeAdapter.staticCallType({
          className,
          methodName: staticCall.methodName,
        });

      if (modelBuilderTransitionStaticCallType) {
        return modelBuilderTransitionStaticCallType;
      }

      const databaseStaticCallType =
        databaseExpressionTypeAdapter.staticCallType({
          className,
          methodName: staticCall.methodName,
        });

      if (databaseStaticCallType) {
        return databaseStaticCallType;
      }

      const builderMagicStaticCallType =
        await builderMagicExpressionTypeAdapter.staticCallType({
          className,
          methodName: staticCall.methodName,
        });

      if (builderMagicStaticCallType) {
        return builderMagicStaticCallType;
      }

      return null;
    },
    variableType: queryCallbackVariableExpressionTypeAdapter.variableType,
  };
}
