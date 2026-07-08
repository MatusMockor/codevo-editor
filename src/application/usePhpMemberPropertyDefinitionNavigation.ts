import { useCallback, type MutableRefObject } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpIdentifierContext } from "../domain/phpNavigation";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

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
  ): Promise<boolean>;
  openDirectPhpPropertyTarget(
    className: string,
    propertyName: string,
  ): Promise<boolean>;
  openPhpClassTarget(className: string, label: string): Promise<boolean>;
  openPhpLaravelModelAttributeTarget(
    className: string,
    attributeName: string,
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
    async (context: PhpMemberPropertyContext): Promise<boolean> => {
      if (!activeDocument) {
        return false;
      }

      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        !requestedRoot ||
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);
      const position =
        activeEditorPositionRef.current ?? { column: 1, lineNumber: 1 };
      const receiverExpression =
        context.receiverExpression || `$${context.variableName}`;
      const receiverType = await resolvePhpExpressionType(
        activeDocument.content,
        position,
        receiverExpression,
      );

      if (!isRequestedRootActive()) {
        return false;
      }

      if (!receiverType) {
        setMessage(
          `No typed target found for ${context.receiverExpression}->${context.propertyName}.`,
        );
        return false;
      }

      const propertyExists = await phpClassHierarchyHasProperty(
        receiverType,
        context.propertyName,
      );

      if (!isRequestedRootActive()) {
        return false;
      }

      if (propertyExists) {
        const methodTargetOpened = await openDirectPhpMethodTarget(
          receiverType,
          context.propertyName,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        if (methodTargetOpened) {
          return true;
        }
      }

      if (propertyExists) {
        const attributeTargetOpened = await openPhpLaravelModelAttributeTarget(
          receiverType,
          context.propertyName,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        if (attributeTargetOpened) {
          return true;
        }
      }

      if (propertyExists) {
        const propertyTypeClassName = await resolvePhpExpressionType(
          activeDocument.content,
          position,
          `${receiverExpression}->${context.propertyName}`,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        if (propertyTypeClassName) {
          const typeClassOpened = await openPhpClassTarget(
            propertyTypeClassName,
            shortPhpName(propertyTypeClassName),
          );

          if (!isRequestedRootActive()) {
            return false;
          }

          if (typeClassOpened) {
            return true;
          }
        }
      }

      if (propertyExists) {
        const propertyTargetOpened = await openDirectPhpPropertyTarget(
          receiverType,
          context.propertyName,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        if (propertyTargetOpened) {
          return true;
        }
      }

      if (!isRequestedRootActive()) {
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
