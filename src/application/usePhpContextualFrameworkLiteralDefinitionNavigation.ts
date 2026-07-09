import { useCallback, type MutableRefObject } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpIdentifierContext } from "../domain/phpNavigation";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { phpFrameworkSupportsCapability } from "./phpFrameworkCapabilityGuards";
import {
  type PhpFrameworkLiteralNavigationDependencies,
  type PhpFrameworkLiteralNavigationTarget,
} from "./phpFrameworkLiteralNavigation";

interface OpenNavigationOptions {
  readOnly?: boolean;
}

export type PhpContextualFrameworkLiteralContext = Extract<
  PhpIdentifierContext,
  | { kind: "laravelNamedRouteString" }
  | { kind: "laravelConfigString" }
  | { kind: "laravelEnvString" }
  | { kind: "laravelTranslationString" }
  | { kind: "laravelViewString" }
>;

export interface PhpContextualFrameworkLiteralDefinitionNavigationDependencies {
  activeDocument: EditorDocument | null;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  frameworkLiteralNavigationDependencies: PhpFrameworkLiteralNavigationDependencies;
  openNavigationTarget(
    path: string,
    position: EditorPosition,
    label: string,
    options?: OpenNavigationOptions,
  ): Promise<boolean>;
  providers: readonly PhpFrameworkProvider[];
  setMessage(message: string | null): void;
  workspaceRoot: string | null;
}

export interface PhpContextualFrameworkLiteralDefinitionNavigation {
  goToPhpFrameworkLiteralDefinition(
    context: PhpContextualFrameworkLiteralContext,
  ): Promise<boolean>;
}

export function usePhpContextualFrameworkLiteralDefinitionNavigation({
  activeDocument,
  currentWorkspaceRootRef,
  frameworkLiteralNavigationDependencies,
  openNavigationTarget,
  providers,
  setMessage,
  workspaceRoot,
}: PhpContextualFrameworkLiteralDefinitionNavigationDependencies): PhpContextualFrameworkLiteralDefinitionNavigation {
  const goToPhpFrameworkLiteralDefinition = useCallback(
    async (
      context: PhpContextualFrameworkLiteralContext,
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (
        !requestedRoot ||
        !activeDocument ||
        activeDocument.language !== "php" ||
        !phpFrameworkSupportsCapability(providers, "stringLiterals")
      ) {
        return false;
      }

      const target = await resolveContextualFrameworkLiteralTarget(
        context,
        activeDocument,
        frameworkLiteralNavigationDependencies,
      );

      if (!isRequestedRootActive()) {
        return false;
      }

      if (!target) {
        setMessage(missingMessageForContext(context));
        return false;
      }

      return openNavigationTarget(target.path, target.position, target.label);
    },
    [
      activeDocument,
      currentWorkspaceRootRef,
      frameworkLiteralNavigationDependencies,
      openNavigationTarget,
      providers,
      setMessage,
      workspaceRoot,
    ],
  );

  return { goToPhpFrameworkLiteralDefinition };
}

async function resolveContextualFrameworkLiteralTarget(
  context: PhpContextualFrameworkLiteralContext,
  activeDocument: EditorDocument,
  dependencies: PhpFrameworkLiteralNavigationDependencies,
): Promise<PhpFrameworkLiteralNavigationTarget | null> {
  if (context.kind === "laravelNamedRouteString") {
    const routes = await dependencies.collectNamedRouteTargets(
      activeDocument.content,
      activeDocument.path,
    );
    const target = routes.find(
      (route) =>
        route.name.toLowerCase() === context.routeName.toLowerCase(),
    );

    return target
      ? {
          kind: "route",
          label: target.name,
          path: target.path,
          position: target.position,
        }
      : null;
  }

  if (context.kind === "laravelConfigString") {
    const target = await dependencies.findConfigTarget(context.configKey);

    return target
      ? {
          kind: "config",
          label: target.key,
          path: target.path,
          position: target.position,
        }
      : null;
  }

  if (context.kind === "laravelEnvString") {
    const target = await dependencies.findEnvTarget(context.envName);

    return target
      ? {
          kind: "env",
          label: target.name,
          path: target.path,
          position: target.position,
        }
      : null;
  }

  if (context.kind === "laravelTranslationString") {
    const target = await dependencies.findTranslationTarget(
      context.translationKey,
    );

    return target
      ? {
          kind: "translation",
          label: target.key,
          path: target.path,
          position: target.position,
        }
      : null;
  }

  const target = await dependencies.findViewTarget(context.viewName);

  return target
    ? {
        kind: "view",
        label: target.name,
        path: target.path,
        position: target.position,
      }
    : null;
}

function missingMessageForContext(
  context: PhpContextualFrameworkLiteralContext,
): string {
  if (context.kind === "laravelNamedRouteString") {
    return `No Laravel route named ${context.routeName} found.`;
  }

  if (context.kind === "laravelConfigString") {
    return `No Laravel config key ${context.configKey} found.`;
  }

  if (context.kind === "laravelEnvString") {
    return `No Laravel env key ${context.envName} found.`;
  }

  if (context.kind === "laravelTranslationString") {
    return `No Laravel translation key ${context.translationKey} found.`;
  }

  return `No Laravel view named ${context.viewName} found.`;
}
