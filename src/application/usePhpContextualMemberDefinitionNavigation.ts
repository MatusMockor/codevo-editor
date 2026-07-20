import { useCallback, type MutableRefObject } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  phpClassConstantPositionOrNull,
  resolvePhpClassName,
  type PhpIdentifierContext,
  type PhpMethodDefinitionHint,
} from "../domain/phpNavigation";
import { phpParameterTypeForVariable } from "../domain/phpParameterTypes";
import {
  phpMixinClassNames,
  phpTraitClassNames,
} from "../domain/phpMethodCompletions";
import { phpSuperTypeReferences } from "../domain/phpNavigation";
import type { EditorDocument, WorkspaceDescriptor } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { PhpFrameworkRelationStringContext } from "./phpFrameworkContextualMemberDefinitionNavigationAdapter";
import { createPhpFrameworkContextualMemberDefinitionNavigationAdapters } from "./phpFrameworkContextualMemberDefinitionNavigationAdapters";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { canNavigate, type NavigationRequest } from "./navigationRequest";

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

export interface PhpContextualMemberDefinitionNavigationDependencies {
  activeDocument: EditorDocument | null;
  activeEditorPositionRef: MutableRefObject<EditorPosition | null>;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  frameworkRuntime: PhpFrameworkRuntimeContext;
  openDirectPhpMethodTarget(
    className: string,
    methodName: string,
    request?: NavigationRequest,
  ): Promise<boolean>;
  openNavigationTarget(
    path: string,
    position: EditorPosition,
    label: string,
    options?: OpenNavigationOptions,
    request?: NavigationRequest,
  ): Promise<boolean>;
  openPhpClassTarget(
    className: string,
    label: string,
    request?: NavigationRequest,
  ): Promise<boolean>;
  openPhpLaravelDynamicWhereTarget(
    className: string,
    methodName: string,
    request?: NavigationRequest,
  ): Promise<boolean>;
  openPhpMethodHintTarget(
    hint: PhpMethodDefinitionHint,
    request?: NavigationRequest,
  ): Promise<boolean>;
  readNavigationFileContent(
    path: string,
    request?: NavigationRequest,
  ): Promise<string>;
  resolvePhpClassReference(source: string, className: string): string | null;
  resolvePhpClassSourcePaths(className: string): Promise<readonly string[]>;
  resolvePhpFrameworkBuilderModelType?(
    source: string,
    position: EditorPosition,
    expression: string,
  ): Promise<string | null>;
  resolvePhpEloquentBuilderModelType?(
    source: string,
    position: EditorPosition,
    expression: string,
  ): Promise<string | null>;
  resolvePhpExpressionType(
    source: string,
    position: EditorPosition,
    expression: string,
  ): Promise<string | null>;
  resolvePhpFrameworkRelationPathOwnerType?(
    ownerType: string,
    relationPath: readonly string[],
  ): Promise<string | null>;
  resolvePhpLaravelRelationPathOwnerType?(
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
    request?: NavigationRequest,
  ): Promise<boolean>;
  goToPhpLaravelRelationStringDefinition(
    context: PhpFrameworkRelationStringContext,
    request?: NavigationRequest,
  ): Promise<boolean>;
  goToPhpMethodCallDefinition(
    context: PhpMethodCallContext,
    request?: NavigationRequest,
  ): Promise<boolean>;
  goToPhpStaticMethodCallDefinition(
    context: PhpStaticMethodCallContext,
    request?: NavigationRequest,
  ): Promise<boolean>;
}

export function usePhpContextualMemberDefinitionNavigation({
  activeDocument,
  activeEditorPositionRef,
  currentWorkspaceRootRef,
  frameworkRuntime,
  openDirectPhpMethodTarget,
  openNavigationTarget,
  openPhpClassTarget,
  openPhpLaravelDynamicWhereTarget,
  openPhpMethodHintTarget,
  readNavigationFileContent,
  resolvePhpClassReference,
  resolvePhpClassSourcePaths,
  resolvePhpFrameworkBuilderModelType,
  resolvePhpEloquentBuilderModelType,
  resolvePhpExpressionType,
  resolvePhpFrameworkRelationPathOwnerType,
  resolvePhpLaravelRelationPathOwnerType,
  setMessage,
  workspaceDescriptor,
  workspaceRoot,
}: PhpContextualMemberDefinitionNavigationDependencies): PhpContextualMemberDefinitionNavigation {
  const resolvePhpBuilderModelType =
    resolvePhpFrameworkBuilderModelType ??
    resolvePhpEloquentBuilderModelType ??
    (async () => null);
  const resolvePhpRelationPathOwnerType =
    resolvePhpFrameworkRelationPathOwnerType ??
    resolvePhpLaravelRelationPathOwnerType ??
    (async () => null);
  const navigationAdapterForRequest = useCallback(
    (request?: NavigationRequest) =>
      createPhpFrameworkContextualMemberDefinitionNavigationAdapters({
        frameworkRuntime,
        dependencies: {
          openDirectMethodTarget: (className, methodName) =>
            request
              ? openDirectPhpMethodTarget(className, methodName, request)
              : openDirectPhpMethodTarget(className, methodName),
          openDynamicMethodTarget: (className, methodName) =>
            request
              ? openPhpLaravelDynamicWhereTarget(
                  className,
                  methodName,
                  request,
                )
              : openPhpLaravelDynamicWhereTarget(className, methodName),
          resolveBuilderModelType: async (source, position, expression) =>
            resolvePhpBuilderModelType(source, position, expression),
          resolveExpressionType: resolvePhpExpressionType,
          resolveRelationPathOwnerType: async (ownerType, relationPath) =>
            resolvePhpRelationPathOwnerType(ownerType, relationPath),
        },
      }),
    [
      frameworkRuntime,
      openDirectPhpMethodTarget,
      openPhpLaravelDynamicWhereTarget,
      resolvePhpBuilderModelType,
      resolvePhpExpressionType,
      resolvePhpRelationPathOwnerType,
    ],
  );

  const openDirectPhpClassConstantTarget = useCallback(
    async (
      className: string,
      constantName: string,
      request?: NavigationRequest,
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);
      const isNavigationActive = () =>
        isRequestedRootActive() && canNavigate(request);

      if (
        !requestedRoot ||
        !requestedDescriptor?.php ||
        !isNavigationActive()
      ) {
        return false;
      }

      const visitedClassNames = new Set<string>();
      const openConstantInClassHierarchy = async (
        candidateClassName: string,
      ): Promise<boolean> => {
        const normalizedCandidate = candidateClassName
          .trim()
          .replace(/^\\+/, "");
        const visitedKey = normalizedCandidate.toLowerCase();

        if (!normalizedCandidate || visitedClassNames.has(visitedKey)) {
          return false;
        }

        if (!isNavigationActive()) {
          return false;
        }

        visitedClassNames.add(visitedKey);

        const sourcePaths = await resolvePhpClassSourcePaths(
          normalizedCandidate,
        );

        if (!isNavigationActive()) {
          return false;
        }

        for (const path of sourcePaths) {
          if (!isNavigationActive()) {
            return false;
          }

          try {
            const content = request
              ? await readNavigationFileContent(path, request)
              : await readNavigationFileContent(path);

            if (!isNavigationActive()) {
              return false;
            }

            const position = phpClassConstantPositionOrNull(
              content,
              constantName,
            );

            if (position) {
              if (!isNavigationActive()) {
                return false;
              }

              const opened = request
                ? await openNavigationTarget(
                    path,
                    position,
                    constantName,
                    {},
                    request,
                  )
                : await openNavigationTarget(path, position, constantName);

              return isNavigationActive() && opened;
            }

            for (const traitName of phpTraitClassNames(content)) {
              const resolvedTraitName = resolvePhpClassReference(
                content,
                traitName,
              );

              const opened = resolvedTraitName
                ? await openConstantInClassHierarchy(resolvedTraitName)
                : false;

              if (!isNavigationActive()) {
                return false;
              }

              if (opened) {
                return true;
              }
            }

            for (const mixinName of phpMixinClassNames(content)) {
              const resolvedMixinName = resolvePhpClassReference(
                content,
                mixinName,
              );

              const opened = resolvedMixinName
                ? await openConstantInClassHierarchy(resolvedMixinName)
                : false;

              if (!isNavigationActive()) {
                return false;
              }

              if (opened) {
                return true;
              }
            }

            for (const superTypeName of phpSuperTypeReferences(content)) {
              const resolvedSuperTypeName = resolvePhpClassReference(
                content,
                superTypeName,
              );

              const opened = resolvedSuperTypeName
                ? await openConstantInClassHierarchy(resolvedSuperTypeName)
                : false;

              if (!isNavigationActive()) {
                return false;
              }

              if (opened) {
                return true;
              }
            }
          } catch {
            if (!isNavigationActive()) {
              return false;
            }

            continue;
          }
        }

        return false;
      };

      const opened = await openConstantInClassHierarchy(className);

      return isNavigationActive() && opened;
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
    async (
      context: PhpMethodCallContext,
      request?: NavigationRequest,
    ): Promise<boolean> => {
      if (!activeDocument || !canNavigate(request)) {
        return false;
      }

      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        !requestedRoot ||
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);
      const isNavigationActive = () =>
        isRequestedRootActive() && canNavigate(request);
      const navigationAdapter = navigationAdapterForRequest(request);
      const position = activeEditorPositionRef.current ?? {
        column: 1,
        lineNumber: 1,
      };
      const receiverType = await resolvePhpExpressionType(
        activeDocument.content,
        position,
        context.receiverExpression || `$${context.variableName}`,
      );

      if (!isNavigationActive()) {
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
        if (!isNavigationActive()) {
          return false;
        }

        const hintTargetOpened = request
          ? await openPhpMethodHintTarget(frameworkHint, request)
          : await openPhpMethodHintTarget(frameworkHint);

        return isNavigationActive() && hintTargetOpened;
      }

      if (resolvedVariableType) {
        if (!isNavigationActive()) {
          return false;
        }

        const directTargetOpened = request
          ? await openDirectPhpMethodTarget(
              resolvedVariableType,
              context.methodName,
              request,
            )
          : await openDirectPhpMethodTarget(
              resolvedVariableType,
              context.methodName,
            );

        if (!isNavigationActive()) {
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
          ? await resolvePhpBuilderModelType(
              activeDocument.content,
              position,
              builderReceiverExpression,
            )
          : null;

      if (!isNavigationActive()) {
        return false;
      }

      const builderScopeMethodName = builderModelType
        ? navigationAdapter.localScopeMethodName(context.methodName)
        : null;

      if (builderModelType && builderScopeMethodName) {
        if (!isNavigationActive()) {
          return false;
        }

        const scopeTargetOpened = request
          ? await openDirectPhpMethodTarget(
              builderModelType,
              builderScopeMethodName,
              request,
            )
          : await openDirectPhpMethodTarget(
              builderModelType,
              builderScopeMethodName,
            );

        if (!isNavigationActive()) {
          return false;
        }

        if (scopeTargetOpened) {
          return true;
        }
      }

      const dynamicWhereResult = await navigationAdapter.dynamicWhereDefinition(
        {
          className: builderModelType,
          isRequestStillCurrent: isNavigationActive,
          methodName: context.methodName,
        },
      );

      if (!isNavigationActive()) {
        return false;
      }

      if (dynamicWhereResult.opened) {
        return true;
      }

      if (!isNavigationActive()) {
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
      navigationAdapterForRequest,
      openDirectPhpMethodTarget,
      openPhpMethodHintTarget,
      resolvePhpBuilderModelType,
      resolvePhpExpressionType,
      setMessage,
      workspaceRoot,
    ],
  );

  const goToPhpStaticMethodCallDefinition = useCallback(
    async (
      context: PhpStaticMethodCallContext,
      request?: NavigationRequest,
    ): Promise<boolean> => {
      if (!activeDocument || !canNavigate(request)) {
        return false;
      }

      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        !requestedRoot ||
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);
      const isNavigationActive = () =>
        isRequestedRootActive() && canNavigate(request);
      const navigationAdapter = navigationAdapterForRequest(request);
      const className = resolvePhpClassReference(
        activeDocument.content,
        context.className,
      );

      if (!className) {
        return false;
      }

      if (!isNavigationActive()) {
        return false;
      }

      const directTargetOpened = request
        ? await openDirectPhpMethodTarget(
            className,
            context.methodName,
            request,
          )
        : await openDirectPhpMethodTarget(className, context.methodName);

      if (!isNavigationActive()) {
        return false;
      }

      if (directTargetOpened) {
        return true;
      }

      const scopeMethodName = navigationAdapter.localScopeMethodName(
        context.methodName,
      );

      if (scopeMethodName) {
        if (!isNavigationActive()) {
          return false;
        }

        const scopeTargetOpened = request
          ? await openDirectPhpMethodTarget(
              className,
              scopeMethodName,
              request,
            )
          : await openDirectPhpMethodTarget(className, scopeMethodName);

        if (!isNavigationActive()) {
          return false;
        }

        if (scopeTargetOpened) {
          return true;
        }
      }

      const dynamicWhereResult = await navigationAdapter.dynamicWhereDefinition(
        {
          className,
          isRequestStillCurrent: isNavigationActive,
          methodName: context.methodName,
        },
      );

      if (!isNavigationActive()) {
        return false;
      }

      if (dynamicWhereResult.opened) {
        return true;
      }

      const builderTargetClassName =
        navigationAdapter.staticBuilderTargetClassName(context.methodName);

      if (builderTargetClassName) {
        if (!isNavigationActive()) {
          return false;
        }

        const builderTargetOpened = request
          ? await openDirectPhpMethodTarget(
              builderTargetClassName,
              context.methodName,
              request,
            )
          : await openDirectPhpMethodTarget(
              builderTargetClassName,
              context.methodName,
            );

        if (!isNavigationActive()) {
          return false;
        }

        if (builderTargetOpened) {
          return true;
        }
      }

      if (!isNavigationActive()) {
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
      navigationAdapterForRequest,
      openDirectPhpMethodTarget,
      resolvePhpClassReference,
      setMessage,
      workspaceRoot,
    ],
  );

  const goToPhpClassConstantDefinition = useCallback(
    async (
      context: PhpClassConstantContext,
      request?: NavigationRequest,
    ): Promise<boolean> => {
      if (!activeDocument || !canNavigate(request)) {
        return false;
      }

      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        !requestedRoot ||
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);
      const isNavigationActive = () =>
        isRequestedRootActive() && canNavigate(request);
      const className = resolvePhpClassReference(
        activeDocument.content,
        context.className,
      );

      if (!className) {
        return false;
      }

      if (!isNavigationActive()) {
        return false;
      }

      const constantTargetOpened = request
        ? await openDirectPhpClassConstantTarget(
            className,
            context.constantName,
            request,
          )
        : await openDirectPhpClassConstantTarget(
            className,
            context.constantName,
          );

      if (!isNavigationActive()) {
        return false;
      }

      if (constantTargetOpened) {
        return true;
      }

      if (!isNavigationActive()) {
        return false;
      }

      const classTargetOpened = request
        ? await openPhpClassTarget(className, context.className, request)
        : await openPhpClassTarget(className, context.className);

      return isNavigationActive() && classTargetOpened;
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
    async (
      context: PhpFrameworkRelationStringContext,
      request?: NavigationRequest,
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);
      const isNavigationActive = () =>
        isRequestedRootActive() && canNavigate(request);

      if (!requestedRoot || !activeDocument || !isNavigationActive()) {
        return false;
      }

      const position = activeEditorPositionRef.current ?? {
        column: 1,
        lineNumber: 1,
      };
      const result = await navigationAdapterForRequest(
        request,
      ).relationStringDefinition({
        context,
        isRequestStillCurrent: isNavigationActive,
        position,
        source: activeDocument.content,
      });

      if (!isNavigationActive()) {
        return false;
      }

      if (result.opened) {
        return true;
      }

      if (result.failureMessage) {
        if (!isNavigationActive()) {
          return false;
        }

        setMessage(result.failureMessage);
      }

      return false;
    },
    [
      activeDocument,
      activeEditorPositionRef,
      currentWorkspaceRootRef,
      navigationAdapterForRequest,
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
