import { useCallback, useMemo, type MutableRefObject } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  isLaravelCollectionFluentMethod,
  isLaravelCollectionTerminalModelMethod,
  isLaravelEloquentBuilderCollectionMethod,
  isLaravelEloquentBuilderFluentMethod,
  isLaravelEloquentBuilderTerminalModelMethod,
  isLaravelEloquentModelBuilderFactoryMethod,
  isLaravelEloquentStaticBuilderMethod,
  phpLaravelCollectionModelTypeCandidate,
  phpLaravelEloquentBuilderModelTypeCandidate,
} from "../domain/phpFrameworkLaravel";
import {
  phpFrameworkContainerExpressionClassName,
  phpFrameworkQueryCallbackContextForVariable,
} from "../domain/phpFrameworkProviders";
import {
  phpAssignmentExpressionForVariableBefore,
  phpDocRawTypeForVariableBefore,
  phpMethodCallExpression,
  phpNewExpressionClassName,
  phpReceiverExpressionTypeInSource,
  phpStaticCallExpression,
} from "../domain/phpSemanticEngine";
import { phpExtendsClassName } from "../domain/phpNavigation";
import type { WorkspaceDescriptor } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { PhpLaravelCarrierKind } from "./usePhpLaravelMethodGenericModelType";
import { phpClassDocGenericCollectionModelTypeCandidate } from "./usePhpLaravelRelationResolver";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { createPhpFrameworkSemanticTypeExtensions } from "./phpFrameworkSemanticTypeExtensions";

export type PhpLaravelModelTypeResolver = (
  source: string,
  position: EditorPosition,
  expression: string,
  depth?: number,
) => Promise<string | null>;

export interface UsePhpLaravelModelTypeResolversOptions {
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  frameworkRuntime: PhpFrameworkRuntimeContext;
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
  resolvePhpClassReference: (
    source: string,
    className: string,
  ) => string | null;
  readNavigationFileContent: (path: string) => Promise<string>;
  resolvePhpClassSourcePaths: (className: string) => Promise<string[]>;
  resolvePhpLaravelMethodGenericModelType: (
    carrierKind: PhpLaravelCarrierKind,
    className: string,
    methodName: string,
  ) => Promise<string | null>;
  resolvePhpLaravelRelationPathOwnerType: (
    className: string,
    previousRelationNames?: readonly string[],
  ) => Promise<string | null>;
  resolvePhpMethodReturnType: (
    className: string,
    methodName: string,
  ) => Promise<string | null>;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

export function usePhpLaravelModelTypeResolvers({
  currentWorkspaceRootRef,
  frameworkRuntime,
  phpClassHasLaravelDynamicWhere,
  phpClassHasLaravelLocalScope,
  resolvePhpClassPropertyOrRelationType,
  readNavigationFileContent,
  resolvePhpClassReference,
  resolvePhpClassSourcePaths,
  resolvePhpLaravelMethodGenericModelType,
  resolvePhpLaravelRelationPathOwnerType,
  resolvePhpMethodReturnType,
  workspaceDescriptor,
  workspaceRoot,
}: UsePhpLaravelModelTypeResolversOptions) {
  const frameworkProviders = frameworkRuntime.providers;
  const typeExtensions = useMemo(
    () =>
      createPhpFrameworkSemanticTypeExtensions({
        providers: frameworkProviders,
      }),
    [frameworkProviders],
  );
  const supportsEloquentModelSemantics = frameworkRuntime.supports(
    "eloquentModelSemantics",
  );

  const resolvePhpEloquentBuilderModelType = useCallback(
    async (
      source: string,
      position: EditorPosition,
      expression: string,
      depth = 0,
    ): Promise<string | null> => {
      if (!supportsEloquentModelSemantics || depth > 5) {
        return null;
      }

      const normalizedExpression = expression.trim();
      const resolvePhpModelExpressionType = async (
        expression: string,
        modelDepth: number,
      ): Promise<string | null> => {
        if (modelDepth > 5) {
          return null;
        }

        const normalizedModelExpression = expression.trim();
        const directType = phpReceiverExpressionTypeInSource(
          source,
          position,
          normalizedModelExpression,
          { typeExtensions },
        );

        if (directType) {
          return resolvePhpClassReference(source, directType);
        }

        const modelVariableMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(
          normalizedModelExpression,
        );
        const modelAssignmentExpression = modelVariableMatch?.[1]
          ? phpAssignmentExpressionForVariableBefore(
              source,
              position,
              modelVariableMatch[1],
            )
          : null;

        if (modelAssignmentExpression) {
          return resolvePhpModelExpressionType(
            modelAssignmentExpression,
            modelDepth + 1,
          );
        }

        const constructedClassName =
          phpNewExpressionClassName(normalizedModelExpression) ??
          phpFrameworkContainerExpressionClassName(
            normalizedModelExpression,
            frameworkProviders,
          );

        if (constructedClassName) {
          return resolvePhpClassReference(source, constructedClassName);
        }

        const modelMethodCall = phpMethodCallExpression(
          normalizedModelExpression,
        );

        if (modelMethodCall) {
          const receiverType = await resolvePhpModelExpressionType(
            modelMethodCall.receiverExpression,
            modelDepth + 1,
          );

          return receiverType
            ? resolvePhpMethodReturnType(
                receiverType,
                modelMethodCall.methodName,
              )
            : null;
        }

        const modelStaticCall = phpStaticCallExpression(
          normalizedModelExpression,
        );

        if (modelStaticCall) {
          const className = resolvePhpClassReference(
            source,
            modelStaticCall.className,
          );

          return className
            ? resolvePhpMethodReturnType(className, modelStaticCall.methodName)
            : null;
        }

        return null;
      };
      const variableMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(
        normalizedExpression,
      );

      if (variableMatch?.[1]) {
        const callbackContext = phpFrameworkQueryCallbackContextForVariable(
          source,
          position,
          variableMatch[1],
          frameworkProviders,
        );

        if (callbackContext) {
          const callbackMorphModelType =
            callbackContext.morphTypeClassNames?.length === 1
              ? resolvePhpClassReference(
                  source,
                  callbackContext.morphTypeClassNames[0] ?? "",
                )
              : null;

          if (callbackMorphModelType) {
            return callbackMorphModelType;
          }

          const callbackHostModelType = callbackContext.modelClassName
            ? resolvePhpClassReference(source, callbackContext.modelClassName)
            : callbackContext.receiverExpression
              ? await resolvePhpEloquentBuilderModelType(
                  source,
                  position,
                  callbackContext.receiverExpression,
                  depth + 1,
                )
              : null;
          const callbackRelationOwnerType =
            callbackHostModelType &&
            callbackContext.previousRelationNames?.length
              ? await resolvePhpLaravelRelationPathOwnerType(
                  callbackHostModelType,
                  callbackContext.previousRelationNames,
                )
              : callbackHostModelType;
          const callbackRelationModelType =
            callbackRelationOwnerType && callbackContext.relationName
              ? await resolvePhpClassPropertyOrRelationType(
                  callbackRelationOwnerType,
                  callbackContext.relationName,
                  true,
                )
              : null;

          if (callbackRelationModelType || callbackHostModelType) {
            return callbackRelationModelType ?? callbackHostModelType;
          }
        }

        const phpDocType = phpDocRawTypeForVariableBefore(
          source,
          position,
          variableMatch[1],
        );
        const phpDocGenericModelTypeCandidate = phpDocType
          ? phpLaravelEloquentBuilderModelTypeCandidate(source, phpDocType)
          : null;
        const phpDocGenericModelType = phpDocGenericModelTypeCandidate
          ? resolvePhpClassReference(source, phpDocGenericModelTypeCandidate)
          : null;

        if (phpDocGenericModelType) {
          return phpDocGenericModelType;
        }

        const assignmentExpression = phpAssignmentExpressionForVariableBefore(
          source,
          position,
          variableMatch[1],
        );

        if (assignmentExpression) {
          return resolvePhpEloquentBuilderModelType(
            source,
            position,
            assignmentExpression,
            depth + 1,
          );
        }
      }

      const methodCall = phpMethodCallExpression(normalizedExpression);

      if (methodCall) {
        const directReceiverType = phpReceiverExpressionTypeInSource(
          source,
          position,
          methodCall.receiverExpression,
          { typeExtensions },
        );
        const constructedReceiverType =
          directReceiverType ??
          phpNewExpressionClassName(methodCall.receiverExpression) ??
          phpFrameworkContainerExpressionClassName(
            methodCall.receiverExpression,
            frameworkProviders,
          );
        const receiverType = constructedReceiverType
          ? resolvePhpClassReference(source, constructedReceiverType)
          : null;
        const methodGenericModelType = receiverType
          ? await resolvePhpLaravelMethodGenericModelType(
              "builder",
              receiverType,
              methodCall.methodName,
            )
          : null;

        if (methodGenericModelType) {
          return methodGenericModelType;
        }
      }

      if (
        methodCall &&
        isLaravelEloquentModelBuilderFactoryMethod(methodCall.methodName)
      ) {
        return resolvePhpModelExpressionType(
          methodCall.receiverExpression,
          depth + 1,
        );
      }

      if (
        methodCall &&
        (isLaravelEloquentBuilderFluentMethod(methodCall.methodName) ||
          isLaravelEloquentBuilderTerminalModelMethod(methodCall.methodName))
      ) {
        return resolvePhpEloquentBuilderModelType(
          source,
          position,
          methodCall.receiverExpression,
          depth + 1,
        );
      }

      if (methodCall) {
        const receiverModelType = await resolvePhpEloquentBuilderModelType(
          source,
          position,
          methodCall.receiverExpression,
          depth + 1,
        );

        if (
          receiverModelType &&
          (await phpClassHasLaravelLocalScope(
            receiverModelType,
            methodCall.methodName,
          ))
        ) {
          return receiverModelType;
        }

        if (
          receiverModelType &&
          (await phpClassHasLaravelDynamicWhere(
            receiverModelType,
            methodCall.methodName,
          ))
        ) {
          return receiverModelType;
        }
      }

      const staticCall = phpStaticCallExpression(normalizedExpression);
      const staticCallClassName = staticCall
        ? resolvePhpClassReference(source, staticCall.className)
        : null;

      if (
        staticCall &&
        staticCallClassName &&
        (await phpClassHasLaravelLocalScope(
          staticCallClassName,
          staticCall.methodName,
        ))
      ) {
        return staticCallClassName;
      }

      if (
        staticCall &&
        staticCallClassName &&
        (await phpClassHasLaravelDynamicWhere(
          staticCallClassName,
          staticCall.methodName,
        ))
      ) {
        return staticCallClassName;
      }

      if (
        staticCall &&
        (isLaravelEloquentStaticBuilderMethod(staticCall.methodName) ||
          isLaravelEloquentBuilderTerminalModelMethod(staticCall.methodName))
      ) {
        return staticCallClassName;
      }

      if (staticCall && staticCallClassName) {
        const staticGenericModelType =
          await resolvePhpLaravelMethodGenericModelType(
            "builder",
            staticCallClassName,
            staticCall.methodName,
          );

        if (staticGenericModelType) {
          return staticGenericModelType;
        }
      }

      return null;
    },
    [
      frameworkProviders,
      phpClassHasLaravelDynamicWhere,
      phpClassHasLaravelLocalScope,
      resolvePhpClassPropertyOrRelationType,
      resolvePhpClassReference,
      resolvePhpLaravelMethodGenericModelType,
      resolvePhpLaravelRelationPathOwnerType,
      resolvePhpMethodReturnType,
      supportsEloquentModelSemantics,
      typeExtensions,
    ],
  );

  const resolvePhpCollectionModelTypeFromClass = useCallback(
    async (className: string): Promise<string | null> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !requestedDescriptor?.php) {
        return null;
      }

      const visitedClassNames = new Set<string>();

      const resolveCollection = async (
        candidateClassName: string,
      ): Promise<string | null> => {
        const normalizedClassName = candidateClassName
          .trim()
          .replace(/^\\+/, "");
        const visitedKey = normalizedClassName.toLowerCase();

        if (!normalizedClassName || visitedClassNames.has(visitedKey)) {
          return null;
        }

        visitedClassNames.add(visitedKey);

        if (!isRequestedRootActive()) {
          return null;
        }

        for (const path of await resolvePhpClassSourcePaths(
          normalizedClassName,
        )) {
          if (!isRequestedRootActive()) {
            return null;
          }

          try {
            const content = await readNavigationFileContent(path);

            if (!isRequestedRootActive()) {
              return null;
            }

            const genericModelType =
              phpClassDocGenericCollectionModelTypeCandidate(content);
            const resolvedGenericModelType = genericModelType
              ? resolvePhpClassReference(content, genericModelType)
              : null;

            if (resolvedGenericModelType) {
              return resolvedGenericModelType;
            }

            const parentClassName = phpExtendsClassName(content);
            const resolvedParentClassName = parentClassName
              ? resolvePhpClassReference(content, parentClassName)
              : null;
            const parentModelType = resolvedParentClassName
              ? await resolveCollection(resolvedParentClassName)
              : null;

            if (!isRequestedRootActive()) {
              return null;
            }

            if (parentModelType) {
              return parentModelType;
            }
          } catch {
            if (!isRequestedRootActive()) {
              return null;
            }

            continue;
          }
        }

        if (!isRequestedRootActive()) {
          return null;
        }

        return null;
      };

      const modelType = await resolveCollection(className);

      if (!isRequestedRootActive()) {
        return null;
      }

      return modelType;
    },
    [
      currentWorkspaceRootRef,
      readNavigationFileContent,
      resolvePhpClassReference,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const resolvePhpLaravelCollectionModelType = useCallback(
    async (
      source: string,
      position: EditorPosition,
      expression: string,
      depth = 0,
    ): Promise<string | null> => {
      if (!supportsEloquentModelSemantics || depth > 5) {
        return null;
      }

      const normalizedExpression = expression.trim();
      const directCollectionType = phpReceiverExpressionTypeInSource(
        source,
        position,
        normalizedExpression,
        { typeExtensions },
      );
      const resolvedDirectCollectionType = directCollectionType
        ? resolvePhpClassReference(source, directCollectionType)
        : null;
      const directCollectionModelType = resolvedDirectCollectionType
        ? await resolvePhpCollectionModelTypeFromClass(
            resolvedDirectCollectionType,
          )
        : null;

      if (directCollectionModelType) {
        return directCollectionModelType;
      }

      const variableMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(
        normalizedExpression,
      );

      if (variableMatch?.[1]) {
        const phpDocType = phpDocRawTypeForVariableBefore(
          source,
          position,
          variableMatch[1],
        );
        const phpDocGenericModelTypeCandidate = phpDocType
          ? phpLaravelCollectionModelTypeCandidate(source, phpDocType)
          : null;
        const phpDocGenericModelType = phpDocGenericModelTypeCandidate
          ? resolvePhpClassReference(source, phpDocGenericModelTypeCandidate)
          : null;

        if (phpDocGenericModelType) {
          return phpDocGenericModelType;
        }

        const assignmentExpression = phpAssignmentExpressionForVariableBefore(
          source,
          position,
          variableMatch[1],
        );

        if (assignmentExpression) {
          return resolvePhpLaravelCollectionModelType(
            source,
            position,
            assignmentExpression,
            depth + 1,
          );
        }
      }

      const methodCall = phpMethodCallExpression(normalizedExpression);

      if (
        methodCall &&
        isLaravelCollectionTerminalModelMethod(methodCall.methodName)
      ) {
        return resolvePhpLaravelCollectionModelType(
          source,
          position,
          methodCall.receiverExpression,
          depth + 1,
        );
      }

      if (
        methodCall &&
        isLaravelCollectionFluentMethod(methodCall.methodName)
      ) {
        return resolvePhpLaravelCollectionModelType(
          source,
          position,
          methodCall.receiverExpression,
          depth + 1,
        );
      }

      if (
        methodCall &&
        isLaravelEloquentBuilderCollectionMethod(methodCall.methodName)
      ) {
        return resolvePhpEloquentBuilderModelType(
          source,
          position,
          methodCall.receiverExpression,
          depth + 1,
        );
      }

      if (methodCall) {
        const directReceiverType = phpReceiverExpressionTypeInSource(
          source,
          position,
          methodCall.receiverExpression,
          { typeExtensions },
        );
        const constructedReceiverType =
          directReceiverType ??
          phpNewExpressionClassName(methodCall.receiverExpression) ??
          phpFrameworkContainerExpressionClassName(
            methodCall.receiverExpression,
            frameworkProviders,
          );
        const receiverType = constructedReceiverType
          ? resolvePhpClassReference(source, constructedReceiverType)
          : null;
        const methodGenericModelType = receiverType
          ? await resolvePhpLaravelMethodGenericModelType(
              "collection",
              receiverType,
              methodCall.methodName,
            )
          : null;

        if (methodGenericModelType) {
          return methodGenericModelType;
        }
      }

      const staticCall = phpStaticCallExpression(normalizedExpression);
      const staticCallClassName = staticCall
        ? resolvePhpClassReference(source, staticCall.className)
        : null;
      const staticGenericModelType =
        staticCall && staticCallClassName
          ? await resolvePhpLaravelMethodGenericModelType(
              "collection",
              staticCallClassName,
              staticCall.methodName,
            )
          : null;

      if (staticGenericModelType) {
        return staticGenericModelType;
      }

      return null;
    },
    [
      frameworkProviders,
      resolvePhpClassReference,
      resolvePhpCollectionModelTypeFromClass,
      resolvePhpEloquentBuilderModelType,
      resolvePhpLaravelMethodGenericModelType,
      supportsEloquentModelSemantics,
      typeExtensions,
    ],
  );

  return {
    resolvePhpEloquentBuilderModelType,
    resolvePhpLaravelCollectionModelType,
  };
}
