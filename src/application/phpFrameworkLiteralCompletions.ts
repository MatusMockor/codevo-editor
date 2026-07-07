import {
  phpLaravelConfigCompletionInsertText,
} from "../domain/phpLaravelConfig";
import {
  phpLaravelEnvCompletionInsertText,
  phpLaravelEnvReferenceContextAt,
} from "../domain/phpLaravelEnv";
import {
  phpLaravelJsonTranslationCompletionInsertText,
  phpLaravelTranslationCompletionInsertText,
} from "../domain/phpLaravelTranslations";
import {
  phpLaravelViewCompletionInsertText,
} from "../domain/phpLaravelViews";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import {
  phpFrameworkConfigReferenceAt,
  phpFrameworkRouteReferenceAt,
  phpFrameworkTranslationReferenceAt,
  phpFrameworkViewReferenceAt,
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import { getFileName } from "../domain/workspace";

export interface PhpFrameworkLiteralCompletionDocument {
  content: string;
  path: string;
}

export interface PhpFrameworkLiteralRouteCompletionTarget {
  name: string;
  path: string;
  relativePath?: string | null;
}

export interface PhpFrameworkLiteralConfigCompletionTarget {
  key: string;
  relativePath: string;
}

export interface PhpFrameworkLiteralTranslationCompletionTarget {
  key: string;
  relativePath: string;
}

export interface PhpFrameworkLiteralEnvCompletionTarget {
  name: string;
  relativePath: string;
}

export interface PhpFrameworkLiteralViewCompletionTarget {
  name: string;
  relativePath: string;
}

export interface PhpFrameworkLiteralCompletionDependencies {
  collectConfigTargets: () => Promise<
    readonly PhpFrameworkLiteralConfigCompletionTarget[]
  >;
  collectEnvTargets: () => Promise<
    readonly PhpFrameworkLiteralEnvCompletionTarget[]
  >;
  collectNamedRouteTargets: (
    currentSource: string,
    currentPath: string,
  ) => Promise<readonly PhpFrameworkLiteralRouteCompletionTarget[]>;
  collectTranslationTargets: () => Promise<
    readonly PhpFrameworkLiteralTranslationCompletionTarget[]
  >;
  collectViewTargets: () => Promise<
    readonly PhpFrameworkLiteralViewCompletionTarget[]
  >;
  isRequestStillCurrent: () => boolean;
}

export interface PhpFrameworkLiteralCompletionRequest {
  activeDocument: PhpFrameworkLiteralCompletionDocument | null;
  isLaravelFrameworkActive: boolean;
  position: EditorPosition;
  providers: readonly PhpFrameworkProvider[];
  source: string;
}

export async function resolvePhpFrameworkLiteralCompletions(
  request: PhpFrameworkLiteralCompletionRequest,
  dependencies: PhpFrameworkLiteralCompletionDependencies,
): Promise<PhpMethodCompletion[] | null> {
  const { activeDocument, isLaravelFrameworkActive, position, providers, source } =
    request;

  const routeContext = phpFrameworkRouteReferenceAt(source, position, providers);

  if (routeContext && activeDocument) {
    const normalizedPrefix = routeContext.prefix.toLowerCase();
    const routes = await dependencies.collectNamedRouteTargets(
      activeDocument.content,
      activeDocument.path,
    );

    if (!dependencies.isRequestStillCurrent()) {
      return [];
    }

    return routes
      .filter((route) => route.name.toLowerCase().startsWith(normalizedPrefix))
      .slice(0, 80)
      .map((route) => ({
        declaringClassName: route.relativePath ?? getFileName(route.path),
        insertText: phpNamedRouteCompletionInsertText(
          route.name,
          routeContext.prefix,
        ),
        kind: "route",
        name: route.name,
        parameters: "",
        returnType: null,
      }));
  }

  const translationContext = phpFrameworkTranslationReferenceAt(
    source,
    position,
    providers,
  );

  if (translationContext && activeDocument) {
    const normalizedPrefix = translationContext.prefix.toLowerCase();
    const targets = await dependencies.collectTranslationTargets();

    if (!dependencies.isRequestStillCurrent()) {
      return [];
    }

    return targets
      .filter((target) => target.key.toLowerCase().startsWith(normalizedPrefix))
      .slice(0, 80)
      .map((target) => ({
        declaringClassName: target.relativePath,
        insertText: target.relativePath.endsWith(".json")
          ? phpLaravelJsonTranslationCompletionInsertText(
              target.key,
              translationContext.prefix,
            )
          : phpLaravelTranslationCompletionInsertText(
              target.key,
              translationContext.prefix,
            ),
        kind: "translation",
        name: target.key,
        parameters: "",
        returnType: null,
      }));
  }

  const envContext = phpLaravelEnvReferenceContextAt(source, position);

  if (isLaravelFrameworkActive && envContext && activeDocument) {
    const normalizedPrefix = envContext.prefix.toLowerCase();
    const targets = await dependencies.collectEnvTargets();

    if (!dependencies.isRequestStillCurrent()) {
      return [];
    }

    return targets
      .filter((target) => target.name.toLowerCase().startsWith(normalizedPrefix))
      .slice(0, 80)
      .map((target) => ({
        declaringClassName: target.relativePath,
        insertText: phpLaravelEnvCompletionInsertText(target.name),
        kind: "env",
        name: target.name,
        parameters: "",
        returnType: null,
      }));
  }

  const configContext = phpFrameworkConfigReferenceAt(source, position, providers);

  if (configContext && activeDocument) {
    const normalizedPrefix = configContext.prefix.toLowerCase();
    const targets = await dependencies.collectConfigTargets();

    if (!dependencies.isRequestStillCurrent()) {
      return [];
    }

    return targets
      .filter((target) => target.key.toLowerCase().startsWith(normalizedPrefix))
      .slice(0, 80)
      .map((target) => ({
        declaringClassName: target.relativePath,
        insertText: phpLaravelConfigCompletionInsertText(
          target.key,
          configContext.prefix,
        ),
        kind: "config",
        name: target.key,
        parameters: "",
        returnType: null,
      }));
  }

  const viewContext = phpFrameworkViewReferenceAt(source, position, providers);

  if (viewContext && activeDocument) {
    const normalizedPrefix = viewContext.prefix.toLowerCase();
    const views = await dependencies.collectViewTargets();

    if (!dependencies.isRequestStillCurrent()) {
      return [];
    }

    return views
      .filter((view) => view.name.toLowerCase().startsWith(normalizedPrefix))
      .slice(0, 80)
      .map((view) => ({
        declaringClassName: view.relativePath,
        insertText: phpLaravelViewCompletionInsertText(
          view.name,
          viewContext.prefix,
        ),
        kind: "view",
        name: view.name,
        parameters: "",
        returnType: null,
      }));
  }

  return null;
}

function phpNamedRouteCompletionInsertText(
  routeName: string,
  prefix: string,
): string {
  const lastDotIndex = prefix.lastIndexOf(".");

  if (lastDotIndex < 0) {
    return routeName;
  }

  return routeName.slice(lastDotIndex + 1);
}
