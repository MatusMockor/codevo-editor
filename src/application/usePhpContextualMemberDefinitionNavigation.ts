import { useCallback, useMemo, type MutableRefObject } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  phpClassConstantPositionOrNull,
  phpParameterTypeForVariable,
  resolvePhpClassName,
  type PhpIdentifierContext,
  type PhpMethodDefinitionHint,
} from "../domain/phpNavigation";
import {
  phpMixinClassNames,
  phpTraitClassNames,
} from "../domain/phpMethodCompletions";
import { phpSuperTypeReferences } from "../domain/phpNavigation";
import type {
  EditorDocument,
  WorkspaceDescriptor,
} from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  createPhpFrameworkContextualMemberDefinitionNavigationAdapters,
} from "./phpFrameworkContextualMemberDefinitionNavigationAdapters";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

interface OpenNavigationOptions {
  readOnly?: boolean;
}

type PhpMethodCallContext = Extract<
  PhpIdentifierContext,
  { kind: "methodCall" }
>;
type PhpStaticMethodCallContext = Extract<
  PhpIdentifierContext,
  { kind: "staticMethodCall" }
>;
type PhpClassConstantContext = Extract<
  PhpIdentifierContext,
  { kind: "classConstant" }
>;
type PhpLaravelRelationStringContext = Extract<
  PhpIdentifierContext,
  { kind: "laravelRelationString" }
>;

export interface PhpContextualMemberDefinitionNavigationDependencies {
  activeDocument: EditorDocument | null;
  activeEditorPositionRef: MutableRefObject<EditorPosition | null>;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  frameworkRuntime?: PhpFrameworkRuntimeContext;
  isLaravelFrameworkActive?: boolean;
  openDirectPhpMethodTarget(
    className: string,
    methodName: string,
  ): Promise<boolean>;
  openNavigationTarget(
    path: string,
    position: EditorPosition,
    label: string,
    options?: OpenNavigationOptions,
  ): Promise<boolean>;
  openPhpClassTarget(className: string, label: string): Promise<boolean>;
  openPhpLaravelDynamicWhereTarget(
    className: string,
    methodName: string,
  ): Promise<boolean>;
  openPhpMethodHintTarget(hint: PhpMethodDefinitionHint): Promise<boolean>;
  readNavigationFileContent(path: string): Promise<string>;
  resolvePhpClassReference(source: string, className: string): string | null;
  resolvePhpClassSourcePaths(className: string): Promise<readonly string[]>;
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
  setMessage(message: string | null): void;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

export interface PhpContextualMemberDefinitionNavigation {
  goToPhpClassConstantDefinition(
    context: PhpClassConstantContext,
  ): Promise<boolean>;
  goToPhpLaravelRelationStringDefinition(
    context: PhpLaravelRelationStringContext,
  ): Promise<boolean>;
  goToPhpMethodCallDefinition(context: PhpMethodCallContext): Promise<boolean>;
  goToPhpStaticMethodCallDefinition(
    context: PhpStaticMethodCallContext,
  ): Promise<boolean>;
}

export function usePhpContextualMemberDefinitionNavigation({
  activeDocument,
  activeEditorPositionRef,
  currentWorkspaceRootRef,
  frameworkRuntime,
  isLaravelFrameworkActive: legacyIsLaravelFrameworkActive = false,
  openDirectPhpMethodTarget,
  openNavigationTarget,
  openPhpClassTarget,
  openPhpLaravelDynamicWhereTarget,
  openPhpMethodHintTarget,
  readNavigationFileContent,
  resolvePhpClassReference,
  resolvePhpClassSourcePaths,
  resolvePhpEloquentBuilderModelType,
  resolvePhpExpressionType,
  resolvePhpLaravelRelationPathOwnerType,
  setMessage,
  workspaceDescriptor,
  workspaceRoot,
}: PhpContextualMemberDefinitionNavigationDependencies): PhpContextualMemberDefinitionNavigation {
  const isLaravelFrameworkActive = frameworkRuntime
    ? frameworkRuntime.hasProvider("laravel")
    : legacyIsLaravelFrameworkActive;
  const navigationAdapter = useMemo(
    () =>
      createPhpFrameworkContextualMemberDefinitionNavigationAdapters({
        frameworkRuntime,
        isLaravelFrameworkActive: legacyIsLaravelFrameworkActive,
      }),
    [frameworkRuntime, legacyIsLaravelFrameworkActive],
  );

  const openDirectPhpClassConstantTarget = useCallback(
    async (className: string, constantName: string): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !requestedDescriptor?.php) {
        return false;
      }

      const visitedClassNames = new Set<string>();
      const openConstantInClassHierarchy = async (
        candidateClassName: string,
      ): Promise<boolean> => {
        const normalizedCandidate = candidateClassName.trim().replace(/^\\+/, "");
        const visitedKey = normalizedCandidate.toLowerCase();

        if (!normalizedCandidate || visitedClassNames.has(visitedKey)) {
          return false;
        }

        if (!isRequestedRootActive()) {
          return false;
        }

        visitedClassNames.add(visitedKey);

        for (const path of await resolvePhpClassSourcePaths(normalizedCandidate)) {
          if (!isRequestedRootActive()) {
            return false;
          }

          try {
            const content = await readNavigationFileContent(path);

            if (!isRequestedRootActive()) {
              return false;
            }

            const position = phpClassConstantPositionOrNull(content, constantName);

            if (position) {
              if (!isRequestedRootActive()) {
                return false;
              }

              return openNavigationTarget(path, position, constantName);
            }

            for (const traitName of phpTraitClassNames(content)) {
              const resolvedTraitName = resolvePhpClassReference(
                content,
                traitName,
              );

              if (
                resolvedTraitName &&
                (await openConstantInClassHierarchy(resolvedTraitName))
              ) {
                return true;
              }
            }

            for (const mixinName of phpMixinClassNames(content)) {
              const resolvedMixinName = resolvePhpClassReference(
                content,
                mixinName,
              );

              if (
                resolvedMixinName &&
                (await openConstantInClassHierarchy(resolvedMixinName))
              ) {
                return true;
              }
            }

            for (const superTypeName of phpSuperTypeReferences(content)) {
              const resolvedSuperTypeName = resolvePhpClassReference(
                content,
                superTypeName,
              );

              if (
                resolvedSuperTypeName &&
                (await openConstantInClassHierarchy(resolvedSuperTypeName))
              ) {
                return true;
              }
            }
          } catch {
            if (!isRequestedRootActive()) {
              return false;
            }

            continue;
          }
        }

        return false;
      };

      return openConstantInClassHierarchy(className);
    },
    [
      currentWorkspaceRootRef,
      openNavigationTarget,
      readNavigationFileContent,
      resolvePhpClassReference,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const goToPhpMethodCallDefinition = useCallback(
    async (context: PhpMethodCallContext): Promise<boolean> => {
      if (!activeDocument) {
        return false;
      }

      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        !requestedRoot ||
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);
      const position =
        activeEditorPositionRef.current ?? { column: 1, lineNumber: 1 };
      const receiverType = await resolvePhpExpressionType(
        activeDocument.content,
        position,
        context.receiverExpression || `$${context.variableName}`,
      );

      if (!isRequestedRootActive()) {
        return false;
      }

      const variableType = context.variableName
        ? phpParameterTypeForVariable(
            activeDocument.content,
            position,
            context.variableName,
          )
        : null;
      const resolvedVariableType =
        receiverType ??
        (variableType
          ? resolvePhpClassName(activeDocument.content, variableType)
          : null);
      const frameworkHint = navigationAdapter.requestMethodDefinitionHint(
        resolvedVariableType,
        context.methodName,
      );

      if (frameworkHint) {
        const hintTargetOpened = await openPhpMethodHintTarget(frameworkHint);

        return isRequestedRootActive() && hintTargetOpened;
      }

      if (resolvedVariableType) {
        const directTargetOpened = await openDirectPhpMethodTarget(
          resolvedVariableType,
          context.methodName,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        if (directTargetOpened) {
          return true;
        }
      }

      const builderReceiverExpression =
        context.receiverExpression ||
        (context.variableName ? `$${context.variableName}` : null);
      const builderModelType =
        builderReceiverExpression &&
        navigationAdapter.supportsBuilderModelNavigation()
          ? await resolvePhpEloquentBuilderModelType(
            activeDocument.content,
            position,
            builderReceiverExpression,
          )
        : null;

      if (!isRequestedRootActive()) {
        return false;
      }

      const builderScopeMethodName = builderModelType
        ? navigationAdapter.localScopeMethodName(context.methodName)
        : null;

      if (builderModelType && builderScopeMethodName) {
        const scopeTargetOpened = await openDirectPhpMethodTarget(
          builderModelType,
          builderScopeMethodName,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        if (scopeTargetOpened) {
          return true;
        }
      }

      const dynamicWhereTargetClassName =
        navigationAdapter.dynamicWhereTargetClassName(builderModelType);

      if (dynamicWhereTargetClassName) {
        const dynamicWhereTargetOpened = await openPhpLaravelDynamicWhereTarget(
          dynamicWhereTargetClassName,
          context.methodName,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        if (dynamicWhereTargetOpened) {
          return true;
        }
      }

      if (!isRequestedRootActive()) {
        return false;
      }

      setMessage(
        `No typed target found for ${context.receiverExpression}->${context.methodName}().`,
      );
      return false;
    },
    [
      activeDocument,
      activeEditorPositionRef,
      currentWorkspaceRootRef,
      navigationAdapter,
      openDirectPhpMethodTarget,
      openPhpLaravelDynamicWhereTarget,
      openPhpMethodHintTarget,
      resolvePhpEloquentBuilderModelType,
      resolvePhpExpressionType,
      setMessage,
      workspaceRoot,
    ],
  );

  const goToPhpStaticMethodCallDefinition = useCallback(
    async (context: PhpStaticMethodCallContext): Promise<boolean> => {
      if (!activeDocument) {
        return false;
      }

      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        !requestedRoot ||
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);
      const className = resolvePhpClassReference(
        activeDocument.content,
        context.className,
      );

      if (!className) {
        return false;
      }

      const directTargetOpened = await openDirectPhpMethodTarget(
        className,
        context.methodName,
      );

      if (!isRequestedRootActive()) {
        return false;
      }

      if (directTargetOpened) {
        return true;
      }

      const scopeMethodName = navigationAdapter.localScopeMethodName(
        context.methodName,
      );

      if (scopeMethodName) {
        const scopeTargetOpened = await openDirectPhpMethodTarget(
          className,
          scopeMethodName,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        if (scopeTargetOpened) {
          return true;
        }
      }

      const dynamicWhereTargetClassName =
        navigationAdapter.dynamicWhereTargetClassName(className);
      const dynamicWhereTargetOpened = dynamicWhereTargetClassName
        ? await openPhpLaravelDynamicWhereTarget(
            dynamicWhereTargetClassName,
            context.methodName,
          )
        : false;

      if (!isRequestedRootActive()) {
        return false;
      }

      if (dynamicWhereTargetOpened) {
        return true;
      }

      const builderTargetClassName =
        navigationAdapter.staticBuilderTargetClassName(context.methodName);

      if (builderTargetClassName) {
        const builderTargetOpened = await openDirectPhpMethodTarget(
          builderTargetClassName,
          context.methodName,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        if (builderTargetOpened) {
          return true;
        }
      }

      if (!isRequestedRootActive()) {
        return false;
      }

      setMessage(
        `No typed target found for ${context.className}::${context.methodName}().`,
      );
      return false;
    },
    [
      activeDocument,
      currentWorkspaceRootRef,
      navigationAdapter,
      openDirectPhpMethodTarget,
      openPhpLaravelDynamicWhereTarget,
      resolvePhpClassReference,
      setMessage,
      workspaceRoot,
    ],
  );

  const goToPhpClassConstantDefinition = useCallback(
    async (context: PhpClassConstantContext): Promise<boolean> => {
      if (!activeDocument) {
        return false;
      }

      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        !requestedRoot ||
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);
      const className = resolvePhpClassReference(
        activeDocument.content,
        context.className,
      );

      if (!className) {
        return false;
      }

      const constantTargetOpened = await openDirectPhpClassConstantTarget(
        className,
        context.constantName,
      );

      if (!isRequestedRootActive()) {
        return false;
      }

      if (constantTargetOpened) {
        return true;
      }

      return openPhpClassTarget(className, context.className);
    },
    [
      activeDocument,
      currentWorkspaceRootRef,
      openDirectPhpClassConstantTarget,
      openPhpClassTarget,
      resolvePhpClassReference,
      workspaceRoot,
    ],
  );

  const goToPhpLaravelRelationStringDefinition = useCallback(
    async (context: PhpLaravelRelationStringContext): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !isLaravelFrameworkActive || !activeDocument) {
        return false;
      }

      const position =
        activeEditorPositionRef.current ?? { column: 1, lineNumber: 1 };
      const staticClassName = context.className
        ? resolvePhpClassName(activeDocument.content, context.className)
        : null;
      const receiverModelType = context.receiverExpression
        ? await resolvePhpEloquentBuilderModelType(
            activeDocument.content,
            position,
            context.receiverExpression,
          )
        : null;

      if (!isRequestedRootActive()) {
        return false;
      }

      const receiverType =
        !receiverModelType && context.receiverExpression
          ? await resolvePhpExpressionType(
              activeDocument.content,
              position,
              context.receiverExpression,
            )
          : null;

      if (!isRequestedRootActive()) {
        return false;
      }

      const relationBaseOwnerType =
        staticClassName ?? receiverModelType ?? receiverType;
      const relationOwnerType = relationBaseOwnerType
        ? await resolvePhpLaravelRelationPathOwnerType(
            relationBaseOwnerType,
            context.previousRelationNames ?? [],
          )
        : null;

      if (!isRequestedRootActive()) {
        return false;
      }

      if (!relationOwnerType) {
        setMessage(`No typed target found for relation ${context.relationName}.`);
        return false;
      }

      if (!isRequestedRootActive()) {
        return false;
      }

      const openedRelation = await openDirectPhpMethodTarget(
        relationOwnerType,
        context.relationName,
      );

      if (!isRequestedRootActive()) {
        return false;
      }

      if (openedRelation) {
        return true;
      }

      if (!isRequestedRootActive()) {
        return false;
      }

      setMessage(
        `No relation method found for ${relationOwnerType}::${context.relationName}().`,
      );
      return false;
    },
    [
      activeDocument,
      activeEditorPositionRef,
      currentWorkspaceRootRef,
      isLaravelFrameworkActive,
      openDirectPhpMethodTarget,
      resolvePhpEloquentBuilderModelType,
      resolvePhpExpressionType,
      resolvePhpLaravelRelationPathOwnerType,
      setMessage,
      workspaceRoot,
    ],
  );

  return {
    goToPhpClassConstantDefinition,
    goToPhpLaravelRelationStringDefinition,
    goToPhpMethodCallDefinition,
    goToPhpStaticMethodCallDefinition,
  };
}
