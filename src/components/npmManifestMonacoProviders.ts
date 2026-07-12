import type * as Monaco from "monaco-editor";
import {
  npmManifestContextAt,
  npmPackageHoverMarkdown,
  type NpmDependencySection,
} from "../domain/npmManifestIntelligence";
import type { NpmPackageDescriptor } from "../domain/workspace";
import {
  jsonStringContentRangeAt,
  manifestRequest,
  monacoRangeForOffsets,
} from "./jsonManifestMonacoProviderKit";

type MonacoApi = typeof Monaco;
type MonacoModel = Monaco.editor.ITextModel;
type MonacoPosition = Monaco.Position;

export interface NpmManifestWorkspace {
  packages: readonly NpmPackageDescriptor[];
  rootPath: string;
}

export interface NpmManifestMonacoProviderContext {
  getWorkspace(): NpmManifestWorkspace | null;
}

let activeWorkspaceRegistration: { id: symbol; workspace: NpmManifestWorkspace } | null = null;

export function registerActiveNpmManifestWorkspace(workspace: NpmManifestWorkspace): () => void {
  const id = Symbol("npmManifestWorkspace");
  activeWorkspaceRegistration = { id, workspace };
  return () => {
    if (activeWorkspaceRegistration?.id !== id) {
      return;
    }
    activeWorkspaceRegistration = null;
  };
}

export function activeNpmManifestWorkspace(): NpmManifestWorkspace | null {
  return activeWorkspaceRegistration?.workspace ?? null;
}

export function registerNpmManifestMonacoProviders(monaco: MonacoApi, context: NpmManifestMonacoProviderContext): Monaco.IDisposable {
  const hover = monaco.languages.registerHoverProvider("json", {
    provideHover: (model, position) => provideNpmManifestHover(monaco, context, model, position),
  });
  const completion = monaco.languages.registerCompletionItemProvider("json", {
    triggerCharacters: ['"'],
    provideCompletionItems: (model, position) => provideNpmManifestCompletions(monaco, context, model, position),
  });
  return { dispose: () => { hover.dispose(); completion.dispose(); } };
}

export function provideNpmManifestHover(monaco: MonacoApi, context: NpmManifestMonacoProviderContext, model: MonacoModel, position: MonacoPosition): Monaco.languages.Hover | null {
  const request = manifestRequest(
    context,
    model,
    position,
    "package.json",
    npmManifestContextAt,
  );
  if (!request?.manifestContext.keyPosition || !request.manifestContext.packageName) {
    return null;
  }
  const descriptor = request.workspace.packages.find((npmPackage) => npmPackage.name === request.manifestContext.packageName);
  const hoverDescriptor = npmManifestHoverDescriptor(
    request.source,
    request.manifestContext.section,
    request.manifestContext.packageName,
    descriptor,
  );
  const stringRange = jsonStringContentRangeAt(request.source, request.offset);
  return {
    contents: [{ value: npmPackageHoverMarkdown(request.manifestContext.packageName, hoverDescriptor) }],
    range: stringRange ? monacoRangeForOffsets(monaco, model, stringRange.start, stringRange.end) : undefined,
  };
}

function npmManifestHoverDescriptor(
  source: string,
  section: NpmDependencySection,
  packageName: string,
  descriptor: NpmPackageDescriptor | undefined,
): NpmPackageDescriptor {
  const parsed = JSON.parse(source) as Record<string, unknown>;
  const dependencies = parsed[section];
  const declaredRange = dependencies && typeof dependencies === "object" && !Array.isArray(dependencies)
    ? (dependencies as Record<string, unknown>)[packageName]
    : null;

  return {
    declaredRange: typeof declaredRange === "string" ? declaredRange : descriptor?.declaredRange ?? "Unknown",
    dev: section === "devDependencies",
    installedVersion: descriptor?.installedVersion ?? null,
    installPath: descriptor?.installPath ?? null,
    name: packageName,
  };
}

export function provideNpmManifestCompletions(monaco: MonacoApi, context: NpmManifestMonacoProviderContext, model: MonacoModel, position: MonacoPosition): Monaco.languages.CompletionList | null {
  const request = manifestRequest(
    context,
    model,
    position,
    "package.json",
    npmManifestContextAt,
  );
  if (!request?.manifestContext.keyPosition) {
    return null;
  }
  const presentNames = npmManifestPackageNames(request.source, request.manifestContext.section);
  const stringRange = jsonStringContentRangeAt(request.source, request.offset);
  const range = stringRange
    ? monacoRangeForOffsets(monaco, model, stringRange.start, stringRange.end)
    : new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column);
  const suggestions = request.workspace.packages
    .filter((npmPackage) => !presentNames.has(npmPackage.name))
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((npmPackage) => ({
      detail: npmPackage.installedVersion ? `Installed version: ${npmPackage.installedVersion}` : `Declared range: ${npmPackage.declaredRange}`,
      insertText: npmPackage.name,
      kind: monaco.languages.CompletionItemKind.Module,
      label: npmPackage.name,
      range,
    }));
  return { suggestions };
}

function npmManifestPackageNames(source: string, section: NpmDependencySection): Set<string> {
  const parsed = JSON.parse(source) as Record<string, unknown>;
  const dependencies = parsed[section];
  if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) {
    return new Set();
  }
  return new Set(Object.keys(dependencies));
}
