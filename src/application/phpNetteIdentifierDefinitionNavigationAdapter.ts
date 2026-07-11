import type { MutableRefObject } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpIdentifierContext } from "../domain/phpNavigation";
import type { EditorDocument } from "../domain/workspace";
import type { PhpFrameworkIdentifierDefinitionNavigationAdapter } from "./phpFrameworkIdentifierDefinitionNavigation";
import { offsetAtEditorPosition } from "./neonIntelligenceRuntime";

export interface PhpNetteIdentifierDefinitionNavigationAdapterDependencies {
  activeDocument: EditorDocument | null;
  activeEditorPositionRef: MutableRefObject<EditorPosition | null>;
  providePhpNetteInjectionDefinition(
    source: string,
    offset: number,
  ): Promise<boolean>;
}

export function createPhpNetteIdentifierDefinitionNavigationAdapter({
  activeDocument,
  activeEditorPositionRef,
  providePhpNetteInjectionDefinition,
}: PhpNetteIdentifierDefinitionNavigationAdapterDependencies): PhpFrameworkIdentifierDefinitionNavigationAdapter {
  return {
    goToDefinition: async (context: PhpIdentifierContext): Promise<boolean> => {
      if (
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

      return providePhpNetteInjectionDefinition(
        activeDocument.content,
        offsetAtEditorPosition(activeDocument.content, position),
      );
    },
  };
}
