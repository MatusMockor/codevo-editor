import type * as Monaco from "monaco-editor";
import {
  pathFromLanguageServerUri,
  type LanguageServerCodeActionCommand,
  type LanguageServerDocumentLink,
  type LanguageServerLocation,
  type LanguageServerWorkspaceEdit,
  type LanguageServerWorkspaceSymbol,
} from "../../domain/languageServerFeatures";
import { mergeAliasedWorkspaceEditDocumentChanges } from "../../domain/workspaceEditDocuments";
import { modelPath, toWorkspaceMonacoUri } from "../phpMonacoDocumentContext";
import { monacoSymbolKind, toMonacoRange, toMonacoTextEdit } from "../languageServerMonacoMappings";
import { isPathInWorkspaceRoot } from "./providerRequestLifecycle";
import type { MonacoApi, MonacoWorkspaceSymbol } from "./providerRegistrationTypes";

type MonacoModel = Monaco.editor.ITextModel;

export interface WorkspaceEditContext {
  readonly path: string | null;
  readonly versionId: number | undefined;
}

export interface LanguageServerBackedLink extends Monaco.languages.ILink {
  __documentLifecycleIdentity?: number;
  __languageServerLink?: LanguageServerDocumentLink;
  __languageServerSessionId?: number;
  __sourcePath?: string;
  __workspaceRoot?: string;
}

export function toMonacoWorkspaceEdit(
  monaco: MonacoApi,
  context: WorkspaceEditContext,
  edit: LanguageServerWorkspaceEdit,
  rootPath: string,
): Monaco.languages.WorkspaceEdit {
  const canonicalEdit = mergeAliasedWorkspaceEditDocumentChanges(edit);

  return {
    edits: Object.entries(canonicalEdit.changes).flatMap(([uri, edits]) => {
      const path = pathFromLanguageServerUri(uri);

      if (!path || !isPathInWorkspaceRoot(rootPath, path)) {
        return [];
      }

      const resource = toWorkspaceMonacoUri(monaco, rootPath, path);

      if (!resource) {
        return [];
      }

      const versionId = context.path === path ? context.versionId : undefined;
      return edits.map((textEdit) => ({
        resource,
        textEdit: toMonacoTextEdit(monaco, textEdit),
        versionId,
      }));
    }),
  };
}

export function toMonacoLocation(
  monaco: MonacoApi,
  rootPath: string,
  location: LanguageServerLocation,
  limitToOpenModels = false,
): Monaco.languages.Location[] {
  const path = pathFromLanguageServerUri(location.uri);

  if (!path || !isPathInWorkspaceRoot(rootPath, path)) {
    return [];
  }

  const uri = toWorkspaceMonacoUri(monaco, rootPath, path);

  if (!uri || (limitToOpenModels && !monaco.editor.getModel(uri))) {
    return [];
  }

  return [{ range: toMonacoRange(monaco, location.range), uri }];
}

export function toMonacoShowReferencesCommand(
  monaco: MonacoApi,
  rootPath: string,
  command: LanguageServerCodeActionCommand,
): Monaco.languages.Command | undefined {
  const [uri, position, locations] = command.arguments ?? [];
  const sourceUri = toMonacoFileUri(monaco, rootPath, uri);
  const monacoPosition = toMonacoCommandPosition(position);

  if (!sourceUri || !monacoPosition || !Array.isArray(locations)) {
    return undefined;
  }

  return {
    arguments: [
      sourceUri,
      monacoPosition,
      locations.flatMap((location) =>
        toMonacoLocation(monaco, rootPath, location as LanguageServerLocation),
      ),
    ],
    id: "editor.action.showReferences",
    title: command.title,
  };
}

function toMonacoFileUri(
  monaco: MonacoApi,
  rootPath: string,
  value: unknown,
): ReturnType<MonacoApi["Uri"]["file"]> | null {
  if (typeof value !== "string") {
    return null;
  }

  const path = pathFromLanguageServerUri(value);

  if (!path || !isPathInWorkspaceRoot(rootPath, path)) {
    return null;
  }

  return toWorkspaceMonacoUri(monaco, rootPath, path);
}

function toMonacoCommandPosition(value: unknown): Monaco.IPosition | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const line = (value as { line?: unknown }).line;
  const character = (value as { character?: unknown }).character;

  if (typeof line !== "number" || typeof character !== "number") {
    return null;
  }

  return {
    column: Math.max(1, character + 1),
    lineNumber: Math.max(1, line + 1),
  };
}

export function toMonacoWorkspaceSymbol(
  monaco: MonacoApi,
  rootPath: string,
  symbol: LanguageServerWorkspaceSymbol,
): MonacoWorkspaceSymbol[] {
  if (!symbol.location) {
    return [];
  }

  const [location] = toMonacoLocation(monaco, rootPath, symbol.location);

  return location
    ? [
        {
          ...(symbol.containerName ? { containerName: symbol.containerName } : {}),
          kind: monacoSymbolKind(monaco, symbol.kind),
          location,
          name: symbol.name,
        },
      ]
    : [];
}

export function toMonacoDocumentLink(
  monaco: MonacoApi,
  rootPath: string,
  sourcePath: string,
  sessionId: number,
  lifecycleIdentity: number | null | undefined,
  link: LanguageServerDocumentLink,
): LanguageServerBackedLink {
  return {
    ...(lifecycleIdentity == null ? {} : { __documentLifecycleIdentity: lifecycleIdentity }),
    __languageServerLink: link,
    __languageServerSessionId: sessionId,
    __sourcePath: sourcePath,
    __workspaceRoot: rootPath,
    range: toMonacoRange(monaco, link.range),
    tooltip: link.tooltip ?? undefined,
    url: link.target ?? undefined,
  };
}

export function workspaceEditContext(model: MonacoModel): WorkspaceEditContext {
  return {
    path: modelPath(model),
    versionId: typeof model.getVersionId === "function" ? model.getVersionId() : undefined,
  };
}
