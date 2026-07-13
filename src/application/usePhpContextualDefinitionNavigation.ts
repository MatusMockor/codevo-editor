import { useCallback, type MutableRefObject } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpIdentifierContext } from "../domain/phpNavigation";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import type { EditorDocument } from "../domain/workspace";
import {
  type PhpFrameworkIdentifierDefinitionHandler,
} from "./phpFrameworkIdentifierDefinitionNavigation";
import { resolvePhpIdentifierContextAt } from "./phpFrameworkIdentifierContextResolverRegistry";

type PhpContextHandler<Kind extends PhpIdentifierContext["kind"]> = (
  context: Extract<PhpIdentifierContext, { kind: Kind }>,
) => Promise<boolean>;

export interface PhpContextualDefinitionNavigationDependencies {
  activeDocument: EditorDocument | null;
  activeEditorPositionRef: MutableRefObject<EditorPosition | null>;
  goToPhpFrameworkIdentifierDefinition: PhpFrameworkIdentifierDefinitionHandler;
  goToPhpClassConstantDefinition: PhpContextHandler<"classConstant">;
  goToPhpClassIdentifierDefinition(name: string): Promise<boolean>;
  goToPhpMemberPropertyDefinition: PhpContextHandler<"memberPropertyAccess">;
  goToPhpMethodCallDefinition: PhpContextHandler<"methodCall">;
  goToPhpStaticMethodCallDefinition: PhpContextHandler<"staticMethodCall">;
  providers: readonly PhpFrameworkProvider[];
}

export interface PhpContextualDefinitionNavigation {
  goToContextualPhpDefinition(): Promise<boolean>;
}

export function usePhpContextualDefinitionNavigation({
  activeDocument,
  activeEditorPositionRef,
  goToPhpClassConstantDefinition,
  goToPhpClassIdentifierDefinition,
  goToPhpFrameworkIdentifierDefinition,
  goToPhpMemberPropertyDefinition,
  goToPhpMethodCallDefinition,
  goToPhpStaticMethodCallDefinition,
  providers,
}: PhpContextualDefinitionNavigationDependencies): PhpContextualDefinitionNavigation {
  const goToContextualPhpDefinition = useCallback(async (): Promise<boolean> => {
    if (!activeDocument || activeDocument.language !== "php") {
      return false;
    }

    const editorPosition = activeEditorPositionRef.current;

    if (!editorPosition) {
      return false;
    }

    const context = resolvePhpIdentifierContextAt(
      activeDocument.content,
      editorPosition,
      providers,
    );

    if (!context) {
      return false;
    }

    if (context.kind === "methodCall") {
      return goToPhpMethodCallDefinition(context);
    }

    if (context.kind === "memberPropertyAccess") {
      return goToPhpMemberPropertyDefinition(context);
    }

    if (context.kind === "staticMethodCall") {
      return goToPhpStaticMethodCallDefinition(context);
    }

    if (context.kind === "classConstant") {
      return goToPhpClassConstantDefinition(context);
    }

    const openedFrameworkTarget =
      await goToPhpFrameworkIdentifierDefinition(context);

    if (openedFrameworkTarget) {
      return true;
    }

    if (context.kind === "classIdentifier") {
      return goToPhpClassIdentifierDefinition(context.name);
    }

    return false;
  }, [
    activeDocument,
    activeEditorPositionRef,
    goToPhpClassConstantDefinition,
    goToPhpClassIdentifierDefinition,
    goToPhpFrameworkIdentifierDefinition,
    goToPhpMemberPropertyDefinition,
    goToPhpMethodCallDefinition,
    goToPhpStaticMethodCallDefinition,
    providers,
  ]);

  return { goToContextualPhpDefinition };
}
