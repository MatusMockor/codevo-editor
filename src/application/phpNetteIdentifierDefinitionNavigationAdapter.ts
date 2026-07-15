import type { MutableRefObject } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpIdentifierContext } from "../domain/phpNavigation";
import type { EditorDocument } from "../domain/workspace";
import type { PhpFrameworkIdentifierDefinitionNavigationAdapter } from "./phpFrameworkIdentifierDefinitionNavigation";
import { canNavigate, type NavigationRequest } from "./navigationRequest";
import { offsetAtEditorPosition } from "./neonIntelligenceRuntime";

export interface PhpNetteIdentifierDefinitionNavigationAdapterDependencies {
  activeDocument: EditorDocument | null;
  activeEditorPositionRef: MutableRefObject<EditorPosition | null>;
  providePhpNetteInjectionDefinition(
    source: string,
    offset: number,
    request?: NavigationRequest,
  ): Promise<boolean>;
}

export function createPhpNetteIdentifierDefinitionNavigationAdapter({
  activeDocument,
  activeEditorPositionRef,
  providePhpNetteInjectionDefinition,
}: PhpNetteIdentifierDefinitionNavigationAdapterDependencies): PhpFrameworkIdentifierDefinitionNavigationAdapter {
  return {
    goToDefinition: async (
      context: PhpIdentifierContext,
      request?: NavigationRequest,
    ): Promise<boolean> => {
      if (
        !canNavigate(request) ||
        context.kind !== "classIdentifier" ||
        !activeDocument ||
        activeDocument.language !== "php"
      ) {
        return false;
      }

      const position = activeEditorPositionRef.current;

      if (!position) {
        return false;
      }

      if (!canNavigate(request)) {
        return false;
      }

      const source = activeDocument.content;
      const offset = offsetAtEditorPosition(source, position);
      const handled = request
        ? await providePhpNetteInjectionDefinition(source, offset, request)
        : await providePhpNetteInjectionDefinition(source, offset);

      if (!canNavigate(request)) {
        return false;
      }

      return handled;
    },
  };
}
