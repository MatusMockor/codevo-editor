import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  phpFrameworkConfigLiteralTarget,
  phpFrameworkEnvLiteralTarget,
  phpFrameworkStringLiteralHelperAt,
  phpFrameworkSupportsStringLiterals,
  phpFrameworkTranslationLiteralTarget,
  phpFrameworkViewLiteralTarget,
  phpFrameworkViewReferenceAt,
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";

export interface PhpFrameworkLiteralNavigationDocument {
  content: string;
  path: string;
}

export interface PhpFrameworkLiteralNavigationTarget {
  kind: "config" | "env" | "route" | "translation" | "view";
  label: string;
  path: string;
  position: EditorPosition;
}

export interface PhpFrameworkLiteralRouteTarget {
  name: string;
  path: string;
  position: EditorPosition;
}

export interface PhpFrameworkLiteralNavigationDependencies {
  collectNamedRouteTargets: (
    currentSource: string,
    currentPath: string,
  ) => Promise<readonly PhpFrameworkLiteralRouteTarget[]>;
  findConfigTarget: (
    configKey: string,
  ) => Promise<{ key: string; path: string; position: EditorPosition } | null>;
  findEnvTarget: (
    envName: string,
  ) => Promise<{ name: string; path: string; position: EditorPosition } | null>;
  findTranslationTarget: (
    translationKey: string,
  ) => Promise<{ key: string; path: string; position: EditorPosition } | null>;
  findViewTarget: (
    viewName: string,
  ) => Promise<{ name: string; path: string; position: EditorPosition } | null>;
}

export interface PhpFrameworkLiteralNavigationRequest {
  activeDocument: PhpFrameworkLiteralNavigationDocument | null;
  offset: number;
  position: EditorPosition;
  providers: readonly PhpFrameworkProvider[];
  source: string;
}

export async function resolvePhpFrameworkLiteralNavigationTarget(
  request: PhpFrameworkLiteralNavigationRequest,
  dependencies: PhpFrameworkLiteralNavigationDependencies,
): Promise<PhpFrameworkLiteralNavigationTarget | null> {
  const { activeDocument, offset, position, providers, source } = request;

  if (!phpFrameworkSupportsStringLiterals(providers)) {
    return null;
  }

  const viewReference = phpFrameworkViewReferenceAt(source, position, providers);

  if (viewReference) {
    const target = await dependencies.findViewTarget(viewReference.name);

    return target
      ? {
          kind: "view",
          label: target.name,
          path: target.path,
          position: target.position,
        }
      : null;
  }

  const match = phpFrameworkStringLiteralHelperAt(source, offset, providers);

  if (!match) {
    return null;
  }

  if (match.helper === "config") {
    if (!phpFrameworkConfigLiteralTarget(match.literal, providers)) {
      return null;
    }

    const target = await dependencies.findConfigTarget(match.literal);

    return target
      ? {
          kind: "config",
          label: target.key,
          path: target.path,
          position: target.position,
        }
      : null;
  }

  if (match.helper === "view") {
    if (!phpFrameworkViewLiteralTarget(match.literal, providers)) {
      return null;
    }

    const target = await dependencies.findViewTarget(match.literal);

    return target
      ? {
          kind: "view",
          label: target.name,
          path: target.path,
          position: target.position,
        }
      : null;
  }

  if (match.helper === "trans") {
    if (!phpFrameworkTranslationLiteralTarget(match.literal, providers)) {
      return null;
    }

    const target = await dependencies.findTranslationTarget(match.literal);

    return target
      ? {
          kind: "translation",
          label: target.key,
          path: target.path,
          position: target.position,
        }
      : null;
  }

  if (match.helper === "env") {
    if (!phpFrameworkEnvLiteralTarget(match.literal, providers)) {
      return null;
    }

    const target = await dependencies.findEnvTarget(match.literal);

    return target
      ? {
          kind: "env",
          label: target.name,
          path: target.path,
          position: target.position,
        }
      : null;
  }

  if (match.helper === "route") {
    if (!activeDocument) {
      return null;
    }

    const routes = await dependencies.collectNamedRouteTargets(
      activeDocument.content,
      activeDocument.path,
    );
    const target = routes.find(
      (route) => route.name.toLowerCase() === match.literal.toLowerCase(),
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

  return null;
}
