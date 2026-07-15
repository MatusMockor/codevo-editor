import { useCallback, type MutableRefObject } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpIdentifierContext } from "../domain/phpNavigation";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { canNavigate, type NavigationRequest } from "./navigationRequest";

type PhpMemberPropertyContext = Extract<
  PhpIdentifierContext,
  { kind: "memberPropertyAccess" }
>;

export interface PhpMemberPropertyDefinitionNavigationDependencies {
  activeDocument: EditorDocument | null;
  activeEditorPositionRef: MutableRefObject<EditorPosition | null>;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  openDirectPhpMethodTarget(
    className: string,
    methodName: string,
    request?: NavigationRequest,
  ): Promise<boolean>;
  openDirectPhpPropertyTarget(
    className: string,
    propertyName: string,
    request?: NavigationRequest,
  ): Promise<boolean>;
  openPhpClassTarget(
    className: string,
    label: string,
    request?: NavigationRequest,
  ): Promise<boolean>;
  openPhpLaravelModelAttributeTarget(
    className: string,
    attributeName: string,
    request?: NavigationRequest,
  ): Promise<boolean>;
  phpClassHierarchyHasProperty(
    className: string,
    propertyName: string,
  ): Promise<boolean>;
  resolvePhpExpressionType(
    source: string,
    position: EditorPosition,
    expression: string,
  ): Promise<string | null>;
  setMessage(message: string | null): void;
  workspaceRoot: string | null;
}

export interface PhpMemberPropertyDefinitionNavigation {
  goToPhpMemberPropertyDefinition(
    context: PhpMemberPropertyContext,
    request?: NavigationRequest,
  ): Promise<boolean>;
}

export function usePhpMemberPropertyDefinitionNavigation({
  activeDocument,
  activeEditorPositionRef,
  currentWorkspaceRootRef,
  openDirectPhpMethodTarget,
  openDirectPhpPropertyTarget,
  openPhpClassTarget,
  openPhpLaravelModelAttributeTarget,
  phpClassHierarchyHasProperty,
  resolvePhpExpressionType,
  setMessage,
  workspaceRoot,
}: PhpMemberPropertyDefinitionNavigationDependencies): PhpMemberPropertyDefinitionNavigation {
  const goToPhpMemberPropertyDefinition = useCallback(
    async (
      context: PhpMemberPropertyContext,
      request?: NavigationRequest,
    ): Promise<boolean> => {
      if (!activeDocument) {
        return false;
      }

      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        !requestedRoot ||
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);
      const isNavigationActive = () =>
        isRequestedRootActive() && canNavigate(request);

      if (!isNavigationActive()) {
        return false;
      }

      const position =
        activeEditorPositionRef.current ?? { column: 1, lineNumber: 1 };
      const receiverExpression =
        context.receiverExpression || `$${context.variableName}`;

      if (!isNavigationActive()) {
        return false;
      }

      const receiverType = await resolvePhpExpressionType(
        activeDocument.content,
        position,
        receiverExpression,
      );

      if (!isNavigationActive()) {
        return false;
      }

      if (!receiverType) {
        if (!isNavigationActive()) {
          return false;
        }

        setMessage(
          `No typed target found for ${context.receiverExpression}->${context.propertyName}.`,
        );
        return false;
      }

      if (!isNavigationActive()) {
        return false;
      }

      const propertyExists = await phpClassHierarchyHasProperty(
        receiverType,
        context.propertyName,
      );

      if (!isNavigationActive()) {
        return false;
      }

      if (propertyExists) {
        if (!isNavigationActive()) {
          return false;
        }

        const methodTargetOpened = request
          ? await openDirectPhpMethodTarget(
              receiverType,
              context.propertyName,
              request,
            )
          : await openDirectPhpMethodTarget(
              receiverType,
              context.propertyName,
            );

        if (!isNavigationActive()) {
          return false;
        }

        if (methodTargetOpened) {
          return true;
        }
      }

      if (propertyExists) {
        if (!isNavigationActive()) {
          return false;
        }

        const attributeTargetOpened = request
          ? await openPhpLaravelModelAttributeTarget(
              receiverType,
              context.propertyName,
              request,
            )
          : await openPhpLaravelModelAttributeTarget(
              receiverType,
              context.propertyName,
            );

        if (!isNavigationActive()) {
          return false;
        }

        if (attributeTargetOpened) {
          return true;
        }
      }

      if (propertyExists) {
        if (!isNavigationActive()) {
          return false;
        }

        const propertyTypeClassName = await resolvePhpExpressionType(
          activeDocument.content,
          position,
          `${receiverExpression}->${context.propertyName}`,
        );

        if (!isNavigationActive()) {
          return false;
        }

        if (propertyTypeClassName) {
          if (!isNavigationActive()) {
            return false;
          }

          const typeClassOpened = request
            ? await openPhpClassTarget(
                propertyTypeClassName,
                shortPhpName(propertyTypeClassName),
                request,
              )
            : await openPhpClassTarget(
                propertyTypeClassName,
                shortPhpName(propertyTypeClassName),
              );

          if (!isNavigationActive()) {
            return false;
          }

          if (typeClassOpened) {
            return true;
          }
        }
      }

      if (propertyExists) {
        if (!isNavigationActive()) {
          return false;
        }

        const propertyTargetOpened = request
          ? await openDirectPhpPropertyTarget(
              receiverType,
              context.propertyName,
              request,
            )
          : await openDirectPhpPropertyTarget(
              receiverType,
              context.propertyName,
            );

        if (!isNavigationActive()) {
          return false;
        }

        if (propertyTargetOpened) {
          return true;
        }
      }

      if (!isNavigationActive()) {
        return false;
      }

      setMessage(
        `No relation method found for ${receiverType}::${context.propertyName}().`,
      );
      return false;
    },
    [
      activeDocument,
      activeEditorPositionRef,
      currentWorkspaceRootRef,
      openDirectPhpMethodTarget,
      openDirectPhpPropertyTarget,
      openPhpClassTarget,
      openPhpLaravelModelAttributeTarget,
      phpClassHierarchyHasProperty,
      resolvePhpExpressionType,
      setMessage,
      workspaceRoot,
    ],
  );

  return { goToPhpMemberPropertyDefinition };
}

function shortPhpName(className: string): string {
  const parts = className.split("\\");
  return parts[parts.length - 1] || className;
}
