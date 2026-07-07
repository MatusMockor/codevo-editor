import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

export interface LatteRuntimeActiveDocument {
  path: string;
}

export interface LatteRuntimeDependencies {
  currentWorkspaceRootRef: { readonly current: string | null };
  frameworkIntelligence: {
    providers: readonly PhpFrameworkProvider[];
  };
  getActiveDocument(): LatteRuntimeActiveDocument | null;
  isSemanticIntelligenceActive: boolean;
  toRelativePath(rootPath: string, path: string): string;
  workspaceRoot: string | null;
}

export interface LatteRuntimeCapabilities {
  supportsLattePresenterLinkIntelligence(
    providers: readonly PhpFrameworkProvider[],
  ): boolean;
  supportsLatteTemplateIntelligence(
    providers: readonly PhpFrameworkProvider[],
  ): boolean;
}

export interface LatteWorkspaceContext {
  isRequestedRootActive(): boolean;
  requestedRoot: string;
}

export function activeLatteWorkspaceContext(
  deps: LatteRuntimeDependencies,
  capabilities: LatteRuntimeCapabilities,
): LatteWorkspaceContext | null {
  if (!isLatteSemanticActive(deps, capabilities)) {
    return null;
  }

  const requestedRoot = deps.workspaceRoot;

  if (!requestedRoot) {
    return null;
  }

  return {
    isRequestedRootActive: () =>
      workspaceRootKeysEqual(deps.currentWorkspaceRootRef.current, requestedRoot),
    requestedRoot,
  };
}

export function currentTemplatePath(
  deps: LatteRuntimeDependencies,
  requestedRoot: string,
): string {
  const document = deps.getActiveDocument();

  if (!document) {
    return "";
  }

  return deps.toRelativePath(requestedRoot, document.path);
}

export function evictOtherRootCacheEntries<Entry>(
  cache: Record<string, Entry>,
  requestedRoot: string | null,
): void {
  for (const cachedRoot of Object.keys(cache)) {
    if (workspaceRootKeysEqual(cachedRoot, requestedRoot)) {
      continue;
    }

    delete cache[cachedRoot];
  }
}

export function isLattePresenterLinkIntelligenceActive(
  deps: LatteRuntimeDependencies,
  capabilities: LatteRuntimeCapabilities,
): boolean {
  return capabilities.supportsLattePresenterLinkIntelligence(
    deps.frameworkIntelligence.providers,
  );
}

export function isLatteSemanticActive(
  deps: LatteRuntimeDependencies,
  capabilities: LatteRuntimeCapabilities,
): boolean {
  return (
    deps.isSemanticIntelligenceActive &&
    capabilities.supportsLatteTemplateIntelligence(
      deps.frameworkIntelligence.providers,
    )
  );
}

export function offsetAtEditorPosition(
  source: string,
  position: EditorPosition,
): number {
  const lines = source.split("\n");
  const targetLine = Math.max(0, position.lineNumber - 1);

  if (targetLine >= lines.length) {
    return source.length;
  }

  let offset = 0;

  for (let line = 0; line < targetLine; line += 1) {
    offset += (lines[line]?.length ?? 0) + 1;
  }

  const column = Math.max(0, position.column - 1);

  return offset + Math.min(column, lines[targetLine]?.length ?? 0);
}
