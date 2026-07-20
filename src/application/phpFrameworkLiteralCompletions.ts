import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import {
  phpFrameworkConfigCompletionContextAt,
  phpFrameworkEnvCompletionContextAt,
  phpFrameworkTranslationCompletionContextAt,
} from "../domain/phpFrameworkLiteralDispatch";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import { phpFrameworkRouteCompletionContextAt } from "../domain/phpFrameworkTargetCapabilities";
import { phpFrameworkViewCompletionContextAt } from "../domain/phpFrameworkTemplateDispatch";
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

const PLAIN_LITERAL_COMPLETION_BEHAVIOR = {
  insertTextMode: "plain",
  triggerParameterHints: false,
} satisfies PhpMethodCompletion["completionBehavior"];

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
      .map((route) => {
        const declaringClassName = route.relativePath ?? getFileName(route.path);

        return {
          declaringClassName,
          ...laravelLiteralCompletionBehavior(routeContext.provider),
          ...laravelLiteralCompletionMetadata(
            routeContext.provider,
            "route",
            declaringClassName,
            route.name,
          ),
          insertText: insertText({
            name: route.name,
            prefix: routeContext.reference.prefix,
          }),
          kind: "route",
          name: route.name,
          parameters: "",
          returnType: null,
        };
      });
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
        ...laravelLiteralCompletionBehavior(translationContext.provider),
        ...laravelLiteralCompletionMetadata(
          translationContext.provider,
          "translation",
          target.relativePath,
          target.key,
        ),
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
        ...laravelLiteralCompletionBehavior(envContext.provider),
        ...laravelLiteralCompletionMetadata(
          envContext.provider,
          "env",
          target.relativePath,
          target.name,
        ),
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
        ...laravelLiteralCompletionBehavior(configContext.provider),
        ...laravelLiteralCompletionMetadata(
          configContext.provider,
          "config",
          target.relativePath,
          target.key,
        ),
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
        ...laravelLiteralCompletionBehavior(viewContext.provider),
        ...laravelLiteralCompletionMetadata(
          viewContext.provider,
          "view",
          view.relativePath,
          view.name,
        ),
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

function laravelLiteralCompletionBehavior(
  provider: PhpFrameworkProvider,
): Partial<Pick<PhpMethodCompletion, "completionBehavior">> {
  if (provider.id !== "laravel") {
    return {};
  }

  return {
    completionBehavior: PLAIN_LITERAL_COMPLETION_BEHAVIOR,
  };
}

function laravelLiteralCompletionMetadata(
  provider: PhpFrameworkProvider,
  kind: "config" | "env" | "route" | "translation" | "view",
  declaringClassName: string,
  name: string,
): Partial<Pick<PhpMethodCompletion, "detail" | "documentation">> {
  if (provider.id !== "laravel") {
    return {};
  }

  if (kind === "route") {
    return {
      detail: `Laravel route - ${declaringClassName}`,
      documentation: `Laravel named route\n\n${name}`,
    };
  }

  return {
    detail: `Laravel ${kind} - ${declaringClassName}`,
    documentation: `Laravel ${kind}\n\n${name}`,
  };
}
