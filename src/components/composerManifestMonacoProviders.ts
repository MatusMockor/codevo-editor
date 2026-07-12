import type * as Monaco from "monaco-editor";
import {
  composerManifestContextAt,
  composerPackageHoverMarkdown,
} from "../domain/composerManifestIntelligence";
import type { ComposerPackageDescriptor } from "../domain/workspace";
import {
  jsonStringContentRangeAt,
  manifestRequest,
  monacoRangeForOffsets,
} from "./jsonManifestMonacoProviderKit";

type MonacoApi = typeof Monaco;
type MonacoModel = Monaco.editor.ITextModel;
type MonacoPosition = Monaco.Position;

export interface ComposerManifestWorkspace {
  packages: readonly ComposerPackageDescriptor[];
  rootPath: string;
}

export interface ComposerManifestMonacoProviderContext {
  getWorkspace(): ComposerManifestWorkspace | null;
}

let activeWorkspaceRegistration: {
  id: symbol;
  workspace: ComposerManifestWorkspace;
} | null = null;

export function registerActiveComposerManifestWorkspace(
  workspace: ComposerManifestWorkspace,
): () => void {
  const id = Symbol("composerManifestWorkspace");
  activeWorkspaceRegistration = { id, workspace };

  return () => {
    if (activeWorkspaceRegistration?.id !== id) {
      return;
    }

    activeWorkspaceRegistration = null;
  };
}

export function activeComposerManifestWorkspace(): ComposerManifestWorkspace | null {
  return activeWorkspaceRegistration?.workspace ?? null;
}

export function registerComposerManifestMonacoProviders(
  monaco: MonacoApi,
  context: ComposerManifestMonacoProviderContext,
): Monaco.IDisposable {
  const hover = monaco.languages.registerHoverProvider("json", {
    provideHover: (model, position) =>
      provideComposerManifestHover(monaco, context, model, position),
  });
  const completion = monaco.languages.registerCompletionItemProvider("json", {
    triggerCharacters: ['"'],
    provideCompletionItems: (model, position) =>
      provideComposerManifestCompletions(monaco, context, model, position),
  });

  return {
    dispose: () => {
      hover.dispose();
      completion.dispose();
    },
  };
}

export function provideComposerManifestHover(
  monaco: MonacoApi,
  context: ComposerManifestMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Monaco.languages.Hover | null {
  const request = manifestRequest(
    context,
    model,
    position,
    "composer.json",
    composerManifestContextAt,
  );

  if (!request?.manifestContext.keyPosition || !request.manifestContext.packageName) {
    return null;
  }

  const descriptor = request.workspace.packages.find(
    (composerPackage) =>
      composerPackage.name === request.manifestContext.packageName,
  );
  const stringRange = jsonStringContentRangeAt(request.source, request.offset);

  return {
    contents: [
      {
        value: composerPackageHoverMarkdown(
          request.manifestContext.packageName,
          descriptor,
        ),
      },
    ],
    range: stringRange
      ? monacoRangeForOffsets(monaco, model, stringRange.start, stringRange.end)
      : undefined,
  };
}

export function provideComposerManifestCompletions(
  monaco: MonacoApi,
  context: ComposerManifestMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Monaco.languages.CompletionList | null {
  const request = manifestRequest(
    context,
    model,
    position,
    "composer.json",
    composerManifestContextAt,
  );

  if (!request?.manifestContext.keyPosition) {
    return null;
  }

  const presentPackageNames = composerManifestPackageNames(request.source);
  const stringRange = jsonStringContentRangeAt(request.source, request.offset);
  const range = stringRange
    ? monacoRangeForOffsets(monaco, model, stringRange.start, stringRange.end)
    : new monaco.Range(
        position.lineNumber,
        position.column,
        position.lineNumber,
        position.column,
      );
  const suggestions = request.workspace.packages
    .filter((composerPackage) => !presentPackageNames.has(composerPackage.name))
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((composerPackage) => ({
      detail: composerPackage.version
        ? `Installed version: ${composerPackage.version}`
        : "Installed package",
      insertText: composerPackage.name,
      kind: monaco.languages.CompletionItemKind.Module,
      label: composerPackage.name,
      range,
    }));

  return { suggestions };
}

function composerManifestPackageNames(source: string): Set<string> {
  const parsed = JSON.parse(source) as Record<string, unknown>;
  const names = new Set<string>();

  for (const section of ["require", "require-dev"] as const) {
    const dependencies = parsed[section];

    if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) {
      continue;
    }

    for (const name of Object.keys(dependencies)) {
      names.add(name);
    }
  }

  return names;
}
