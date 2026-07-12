import type * as Monaco from "monaco-editor";
import {
  composerManifestContextAt,
  composerPackageHoverMarkdown,
} from "../domain/composerManifestIntelligence";
import type { ComposerPackageDescriptor } from "../domain/workspace";
import { modelPath } from "./phpMonacoDocumentContext";

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
  const request = composerManifestRequest(context, model, position);

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
  const request = composerManifestRequest(context, model, position);

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

function composerManifestRequest(
  context: ComposerManifestMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
) {
  const workspace = context.getWorkspace();

  if (!workspace) {
    return null;
  }

  const path = modelPath(model);

  if (!path || !isComposerManifestPathInWorkspace(path, workspace.rootPath)) {
    return null;
  }

  const source = model.getValue();
  const offset = model.getOffsetAt(position);
  const manifestContext = composerManifestContextAt(source, offset);

  if (!manifestContext) {
    return null;
  }

  return { manifestContext, offset, source, workspace };
}

function isComposerManifestPathInWorkspace(
  path: string,
  workspaceRoot: string,
): boolean {
  const normalizedPath = normalizedPathKey(path);
  const normalizedRoot = normalizedPathKey(workspaceRoot).replace(/\/$/, "");

  if (!normalizedRoot || !normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return false;
  }

  const segments = normalizedPath.split("/");

  return segments[segments.length - 1] === "composer.json";
}

function normalizedPathKey(path: string): string {
  const normalized = path.split("\\").join("/");

  if (/^[A-Za-z]:\//.test(normalized)) {
    return normalized.toLowerCase();
  }

  return normalized;
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

function jsonStringContentRangeAt(
  source: string,
  offset: number,
): { end: number; start: number } | null {
  let start = -1;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (start < 0) {
      if (character === '"') {
        start = index + 1;
      }

      continue;
    }

    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      continue;
    }

    if (character !== '"') {
      continue;
    }

    if (offset >= start && offset <= index) {
      return { end: index, start };
    }

    start = -1;
  }

  return null;
}

function monacoRangeForOffsets(
  monaco: MonacoApi,
  model: MonacoModel,
  start: number,
  end: number,
): Monaco.Range {
  const startPosition = model.getPositionAt(start);
  const endPosition = model.getPositionAt(end);

  return new monaco.Range(
    startPosition.lineNumber,
    startPosition.column,
    endPosition.lineNumber,
    endPosition.column,
  );
}
