import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import {
  phpFrameworkConfigCompletionContextAt,
  phpFrameworkEnvCompletionContextAt,
  phpFrameworkRouteCompletionContextAt,
  phpFrameworkTranslationCompletionContextAt,
  phpFrameworkViewCompletionContextAt,
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
  position: EditorPosition;
  providers: readonly PhpFrameworkProvider[];
  source: string;
}

export async function resolvePhpFrameworkLiteralCompletions(
  request: PhpFrameworkLiteralCompletionRequest,
  dependencies: PhpFrameworkLiteralCompletionDependencies,
): Promise<PhpMethodCompletion[] | null> {
  const { activeDocument, position, providers, source } = request;

  const routeContext = phpFrameworkRouteCompletionContextAt(
    source,
    position,
    providers,
  );

  if (routeContext && activeDocument) {
    const insertText = routeContext.provider.routes?.completionInsertText;

    if (!insertText) {
      return [];
    }

    const normalizedPrefix = routeContext.reference.prefix.toLowerCase();
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
        insertText: insertText({
          name: route.name,
          prefix: routeContext.reference.prefix,
        }),
        kind: "route",
        name: route.name,
        parameters: "",
        returnType: null,
      }));
  }

  const translationContext = phpFrameworkTranslationCompletionContextAt(
    source,
    position,
    providers,
  );

  if (translationContext && activeDocument) {
    const insertText = translationContext.provider.translations
      ?.completionInsertText;

    if (!insertText) {
      return [];
    }

    const normalizedPrefix = translationContext.reference.prefix.toLowerCase();
    const targets = await dependencies.collectTranslationTargets();

    if (!dependencies.isRequestStillCurrent()) {
      return [];
    }

    return targets
      .filter((target) => target.key.toLowerCase().startsWith(normalizedPrefix))
      .slice(0, 80)
      .map((target) => ({
        declaringClassName: target.relativePath,
        insertText: insertText({
          key: target.key,
          prefix: translationContext.reference.prefix,
          relativePath: target.relativePath,
        }),
        kind: "translation",
        name: target.key,
        parameters: "",
        returnType: null,
      }));
  }

  const envContext = phpFrameworkEnvCompletionContextAt(
    source,
    position,
    providers,
  );

  if (envContext && activeDocument) {
    const insertText = envContext.provider.env?.completionInsertText;

    if (!insertText) {
      return [];
    }

    const normalizedPrefix = envContext.reference.prefix.toLowerCase();
    const targets = await dependencies.collectEnvTargets();

    if (!dependencies.isRequestStillCurrent()) {
      return [];
    }

    return targets
      .filter((target) => target.name.toLowerCase().startsWith(normalizedPrefix))
      .slice(0, 80)
      .map((target) => ({
        declaringClassName: target.relativePath,
        insertText: insertText({
          name: target.name,
          prefix: envContext.reference.prefix,
        }),
        kind: "env",
        name: target.name,
        parameters: "",
        returnType: null,
      }));
  }

  const configContext = phpFrameworkConfigCompletionContextAt(
    source,
    position,
    providers,
  );

  if (configContext && activeDocument) {
    const insertText = configContext.provider.config?.completionInsertText;

    if (!insertText) {
      return [];
    }

    const normalizedPrefix = configContext.reference.prefix.toLowerCase();
    const targets = await dependencies.collectConfigTargets();

    if (!dependencies.isRequestStillCurrent()) {
      return [];
    }

    return targets
      .filter((target) => target.key.toLowerCase().startsWith(normalizedPrefix))
      .slice(0, 80)
      .map((target) => ({
        declaringClassName: target.relativePath,
        insertText: insertText({
          key: target.key,
          prefix: configContext.reference.prefix,
        }),
        kind: "config",
        name: target.key,
        parameters: "",
        returnType: null,
      }));
  }

  const viewContext = phpFrameworkViewCompletionContextAt(
    source,
    position,
    providers,
  );

  if (viewContext && activeDocument) {
    const insertText = viewContext.provider.templating?.completionInsertText;

    if (!insertText) {
      return [];
    }

    const normalizedPrefix = viewContext.reference.prefix.toLowerCase();
    const views = await dependencies.collectViewTargets();

    if (!dependencies.isRequestStillCurrent()) {
      return [];
    }

    return views
      .filter((view) => view.name.toLowerCase().startsWith(normalizedPrefix))
      .slice(0, 80)
      .map((view) => ({
        declaringClassName: view.relativePath,
        insertText: insertText({
          name: view.name,
          prefix: viewContext.reference.prefix,
        }),
        kind: "view",
        name: view.name,
        parameters: "",
        returnType: null,
      }));
  }

  return null;
}
