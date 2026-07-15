import { useCallback, type MutableRefObject } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpIdentifierContext } from "../domain/phpNavigation";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import type { EditorDocument } from "../domain/workspace";
import { canNavigate, type NavigationRequest } from "./navigationRequest";
import { resolvePhpIdentifierContextAt } from "./phpFrameworkIdentifierContextResolverRegistry";

type PhpContextHandler<Kind extends PhpIdentifierContext["kind"]> = (
  context: Extract<PhpIdentifierContext, { kind: Kind }>,
  request?: NavigationRequest,
) => Promise<boolean>;

type PhpFrameworkIdentifierDefinitionHandler = (
  context: PhpIdentifierContext,
  request?: NavigationRequest,
) => Promise<boolean>;

type PhpClassIdentifierDefinitionHandler = (
  name: string,
  request?: NavigationRequest,
) => Promise<boolean>;

export interface PhpContextualDefinitionNavigationDependencies {
  activeDocument: EditorDocument | null;
  activeEditorPositionRef: MutableRefObject<EditorPosition | null>;
  goToPhpFrameworkIdentifierDefinition: PhpFrameworkIdentifierDefinitionHandler;
  goToPhpClassConstantDefinition: PhpContextHandler<"classConstant">;
  goToPhpClassIdentifierDefinition: PhpClassIdentifierDefinitionHandler;
  goToPhpMemberPropertyDefinition: PhpContextHandler<"memberPropertyAccess">;
  goToPhpMethodCallDefinition: PhpContextHandler<"methodCall">;
  goToPhpStaticMethodCallDefinition: PhpContextHandler<"staticMethodCall">;
  providers: readonly PhpFrameworkProvider[];
}

export interface PhpContextualDefinitionNavigation {
  goToContextualPhpDefinition(request?: NavigationRequest): Promise<boolean>;
}

async function invokeNavigationHandler<Argument>(
  handler: (argument: Argument, request?: NavigationRequest) => Promise<boolean>,
  argument: Argument,
  request?: NavigationRequest,
): Promise<boolean> {
  const handled = request
    ? await handler(argument, request)
    : await handler(argument);

  if (!canNavigate(request)) {
    return false;
  }

  return handled;
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
  const goToContextualPhpDefinition = useCallback(async (
    request?: NavigationRequest,
  ): Promise<boolean> => {
    if (!canNavigate(request)) {
      return false;
    }

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
      const handled = await invokeNavigationHandler(
        goToPhpMethodCallDefinition,
        context,
        request,
      );

      if (!canNavigate(request)) {
        return false;
      }

      return handled;
    }

    if (context.kind === "memberPropertyAccess") {
      const handled = await invokeNavigationHandler(
        goToPhpMemberPropertyDefinition,
        context,
        request,
      );

      if (!canNavigate(request)) {
        return false;
      }

      return handled;
    }

    if (context.kind === "staticMethodCall") {
      const handled = await invokeNavigationHandler(
        goToPhpStaticMethodCallDefinition,
        context,
        request,
      );

      if (!canNavigate(request)) {
        return false;
      }

      return handled;
    }

    if (context.kind === "classConstant") {
      const handled = await invokeNavigationHandler(
        goToPhpClassConstantDefinition,
        context,
        request,
      );

      if (!canNavigate(request)) {
        return false;
      }

      return handled;
    }

    const openedFrameworkTarget = await invokeNavigationHandler(
      goToPhpFrameworkIdentifierDefinition,
      context,
      request,
    );

    if (!canNavigate(request)) {
      return false;
    }

    if (openedFrameworkTarget) {
      return true;
    }

    if (context.kind === "classIdentifier") {
      const handled = await invokeNavigationHandler(
        goToPhpClassIdentifierDefinition,
        context.name,
        request,
      );

      if (!canNavigate(request)) {
        return false;
      }

      return handled;
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
