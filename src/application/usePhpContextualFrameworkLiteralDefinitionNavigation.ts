import { useCallback, type MutableRefObject } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  phpFrameworkSupportsValidation,
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRelativePath } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  type PhpFrameworkLiteralNavigationDependencies,
  type PhpFrameworkLiteralNavigationTarget,
} from "./phpFrameworkLiteralNavigation";

interface OpenNavigationOptions {
  readOnly?: boolean;
}

export type PhpContextualFrameworkLiteralDefinitionRequest =
  | {
      kind: "route";
      missingMessage: string;
      name: string;
    }
  | {
      key: string;
      kind: "config";
      missingMessage: string;
    }
  | {
      kind: "env";
      missingMessage: string;
      name: string;
    }
  | {
      key: string;
      kind: "translation";
      missingMessage: string;
    }
  | {
      kind: "view";
      missingMessage: string;
      name: string;
    }
  | {
      kind: "validationTable";
      tableName: string;
    };

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
  supportsStringLiterals: boolean;
  workspaceRoot: string | null;
}

export interface PhpContextualFrameworkLiteralDefinitionNavigation {
  goToPhpFrameworkLiteralDefinition(
    request: PhpContextualFrameworkLiteralDefinitionRequest,
  ): Promise<boolean>;
}

export function usePhpContextualFrameworkLiteralDefinitionNavigation({
  activeDocument,
  currentWorkspaceRootRef,
  frameworkLiteralNavigationDependencies,
  openNavigationTarget,
  providers,
  setMessage,
  supportsStringLiterals,
  workspaceRoot,
}: PhpContextualFrameworkLiteralDefinitionNavigationDependencies): PhpContextualFrameworkLiteralDefinitionNavigation {
  const goToPhpFrameworkLiteralDefinition = useCallback(
    async (
      request: PhpContextualFrameworkLiteralDefinitionRequest,
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (
        !requestedRoot ||
        !activeDocument ||
        activeDocument.language !== "php" ||
        !supportsStringLiterals
      ) {
        return false;
      }

      if (
        request.kind === "validationTable" &&
        !phpFrameworkSupportsValidation(providers)
      ) {
        return false;
      }

      const target = await resolveContextualFrameworkLiteralTarget(
        request,
        activeDocument,
        frameworkLiteralNavigationDependencies,
      );

      if (!isRequestedRootActive()) {
        return false;
      }

      if (!target) {
        if ("missingMessage" in request) {
          setMessage(request.missingMessage);
        }

        return false;
      }

      if (
        request.kind === "validationTable" &&
        workspaceRelativePath(requestedRoot, target.path) === null
      ) {
        return false;
      }

      const opened = await openNavigationTarget(
        target.path,
        target.position,
        target.label,
      );

      if (!isRequestedRootActive()) {
        return false;
      }

      return opened;
    },
    [
      activeDocument,
      currentWorkspaceRootRef,
      frameworkLiteralNavigationDependencies,
      openNavigationTarget,
      providers,
      setMessage,
      supportsStringLiterals,
      workspaceRoot,
    ],
  );

  return { goToPhpFrameworkLiteralDefinition };
}

async function resolveContextualFrameworkLiteralTarget(
  request: PhpContextualFrameworkLiteralDefinitionRequest,
  activeDocument: EditorDocument,
  dependencies: PhpFrameworkLiteralNavigationDependencies,
): Promise<PhpFrameworkLiteralNavigationTarget | null> {
  if (request.kind === "route") {
    const routes = await dependencies.collectNamedRouteTargets(
      activeDocument.content,
      activeDocument.path,
    );
    const target = routes.find(
      (route) =>
        route.name.toLowerCase() === request.name.toLowerCase(),
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

  if (request.kind === "config") {
    const target = await dependencies.findConfigTarget(request.key);

    return target
      ? {
          kind: "config",
          label: target.key,
          path: target.path,
          position: target.position,
        }
      : null;
  }

  if (request.kind === "env") {
    const target = await dependencies.findEnvTarget(request.name);

    return target
      ? {
          kind: "env",
          label: target.name,
          path: target.path,
          position: target.position,
        }
      : null;
  }

  if (request.kind === "translation") {
    const target = await dependencies.findTranslationTarget(request.key);

    return target
      ? {
          kind: "translation",
          label: target.key,
          path: target.path,
          position: target.position,
        }
      : null;
  }

  if (request.kind === "validationTable") {
    const targets =
      await dependencies.findPhpLaravelValidationRuleModelTargets?.(
        request.tableName,
      );
    const target = targets?.[0];

    return target
      ? {
          kind: "validationTable",
          label: target.label,
          path: target.path,
          position: target.position,
        }
      : null;
  }

  const target = await dependencies.findViewTarget(request.name);

  return target
    ? {
        kind: "view",
        label: target.name,
        path: target.path,
        position: target.position,
      }
    : null;
}
