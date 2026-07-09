import type { EditorPosition } from "../domain/languageServerFeatures";
import { netteCreateComponentFactoryContexts } from "../domain/netteComponents";
import {
  componentClassCandidatePathsForTemplate,
  presenterCandidatePathsForTemplate,
} from "../domain/nettePathResolution";
import { phpTypeNamesEqual } from "../domain/phpTypes";

export interface NetteCurrentClassDependencies {
  joinPath(rootPath: string, relativePath: string): string;
  openTarget(
    path: string,
    position: EditorPosition,
    label: string,
  ): Promise<boolean>;
  readFileContent(path: string): Promise<string>;
  resolveDeclaredType(source: string, typeHint: string | null): string | null;
  searchText(
    rootPath: string,
    query: string,
    limit: number,
  ): Promise<{ path: string }[]>;
}

export interface NetteCurrentClassContext {
  createComponentSearchLimit: number;
  deps: NetteCurrentClassDependencies;
  isRequestedRootActive(): boolean;
  phpExtension: string;
  requestedRoot: string;
  supportsComponentFactoryViewData: boolean;
  templateRelativePath: string;
}

const CREATE_COMPONENT_CONTEXT_SEARCH_QUERY = "createComponent";

export async function currentNetteControlClassName(
  context: NetteCurrentClassContext,
): Promise<string | null> {
  const { deps, isRequestedRootActive, requestedRoot, templateRelativePath } =
    context;

  for (const relativePath of componentClassCandidatePathsForTemplate(
    templateRelativePath,
  )) {
    if (!isRequestedRootActive()) {
      return null;
    }

    let source: string;

    try {
      source = await deps.readFileContent(
        deps.joinPath(requestedRoot, relativePath),
      );
    } catch {
      if (!isRequestedRootActive()) {
        return null;
      }

      continue;
    }

    if (!isRequestedRootActive()) {
      return null;
    }

    const className = phpPrimaryClassName(source);

    if (!className) {
      continue;
    }

    return phpQualifiedClassName(source, className);
  }

  return null;
}

export async function currentNettePresenterClassName(
  context: NetteCurrentClassContext,
): Promise<string | null> {
  const { deps, isRequestedRootActive, requestedRoot, templateRelativePath } =
    context;

  for (const relativePath of presenterCandidatePathsForTemplate(
    templateRelativePath,
  )) {
    if (!isRequestedRootActive()) {
      return null;
    }

    let source: string;

    try {
      source = await deps.readFileContent(
        deps.joinPath(requestedRoot, relativePath),
      );
    } catch {
      if (!isRequestedRootActive()) {
        return null;
      }

      continue;
    }

    if (!isRequestedRootActive()) {
      return null;
    }

    const className = phpPrimaryClassName(source);

    if (!className) {
      continue;
    }

    return phpQualifiedClassName(source, className);
  }

  return currentNetteFactoryPresenterClassName(context);
}

export async function resolveNetteControlVariableDefinition(
  context: NetteCurrentClassContext,
): Promise<boolean> {
  const { deps, isRequestedRootActive, requestedRoot, templateRelativePath } =
    context;

  for (const relativePath of componentClassCandidatePathsForTemplate(
    templateRelativePath,
  )) {
    if (!isRequestedRootActive()) {
      return false;
    }

    const path = deps.joinPath(requestedRoot, relativePath);
    let source: string;

    try {
      source = await deps.readFileContent(path);
    } catch {
      if (!isRequestedRootActive()) {
        return false;
      }

      continue;
    }

    if (!isRequestedRootActive()) {
      return false;
    }

    const className = phpPrimaryClassName(source);
    const position = className
      ? phpClassPositionInSource(source, className)
      : null;

    return deps.openTarget(
      path,
      position ?? { column: 1, lineNumber: 1 },
      "$control",
    );
  }

  return false;
}

async function currentNetteFactoryPresenterClassName(
  context: NetteCurrentClassContext,
): Promise<string | null> {
  const {
    createComponentSearchLimit,
    deps,
    isRequestedRootActive,
    phpExtension,
    requestedRoot,
    supportsComponentFactoryViewData,
  } = context;

  if (!supportsComponentFactoryViewData) {
    return null;
  }

  const controlClassName = await currentNetteControlClassName(context);

  if (!isRequestedRootActive() || !controlClassName) {
    return null;
  }

  const results = await deps.searchText(
    requestedRoot,
    CREATE_COMPONENT_CONTEXT_SEARCH_QUERY,
    createComponentSearchLimit,
  );

  if (!isRequestedRootActive()) {
    return null;
  }

  const visitedPaths = new Set<string>();

  for (const result of results) {
    if (!isRequestedRootActive()) {
      return null;
    }

    if (visitedPaths.has(result.path) || !result.path.endsWith(phpExtension)) {
      continue;
    }

    visitedPaths.add(result.path);

    let source: string;

    try {
      source = await deps.readFileContent(result.path);
    } catch {
      if (!isRequestedRootActive()) {
        return null;
      }

      continue;
    }

    if (!isRequestedRootActive()) {
      return null;
    }

    const presenterClassName = phpPrimaryClassName(source);

    if (!presenterClassName?.endsWith("Presenter")) {
      continue;
    }

    const matchedFactory = netteCreateComponentFactoryContexts(source).some(
      (factory) => {
        if (!factory.controlClass) {
          return false;
        }

        const resolved =
          deps.resolveDeclaredType(source, factory.controlClass) ??
          factory.controlClass;

        return phpTypeNamesEqual(resolved, controlClassName);
      },
    );

    if (!matchedFactory) {
      continue;
    }

    return phpQualifiedClassName(source, presenterClassName);
  }

  return null;
}

export function phpPrimaryClassName(source: string): string | null {
  const match = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(source);
  const className = match?.[1]?.trim() ?? "";

  return className.length > 0 ? className : null;
}

export function phpClassPositionInSource(
  source: string,
  className: string,
): EditorPosition | null {
  const pattern = new RegExp(`\\bclass\\s+${escapeRegExp(className)}\\b`);
  const match = pattern.exec(source);

  if (!match) {
    return null;
  }

  return editorPositionAtOffset(
    source,
    match.index + match[0].length - className.length,
  );
}

export function phpNamespaceName(source: string): string | null {
  const match = /\bnamespace\s+([^;{]+)\s*[;{]/.exec(source);
  const namespace = match?.[1]?.trim() ?? "";

  return namespace.length > 0 ? namespace : null;
}

function phpQualifiedClassName(source: string, className: string): string {
  const namespace = phpNamespaceName(source);

  return namespace ? `${namespace}\\${className}` : className;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function editorPositionAtOffset(source: string, offset: number): EditorPosition {
  const clamped = Math.max(0, Math.min(offset, source.length));
  const before = source.slice(0, clamped);
  const lineStart = before.lastIndexOf("\n") + 1;

  return { column: clamped - lineStart + 1, lineNumber: before.split("\n").length };
}
