import type * as Monaco from "monaco-editor";
import {
  canUseLanguageServerFeature,
  pathFromLanguageServerUri,
  toLanguageServerTextDocumentPosition,
  type LanguageServerFeaturesGateway,
  type LanguageServerLocation,
} from "../domain/languageServerFeatures";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import type { EditorDocument } from "../domain/workspace";

type MonacoApi = typeof Monaco;
type MonacoModel = Monaco.editor.ITextModel;
type MonacoPosition = Monaco.Position;
type Disposable = Monaco.IDisposable;

export interface JavaScriptTypeScriptLanguageServerProviderContext {
  featuresGateway: LanguageServerFeaturesGateway;
  flushPendingDocumentChange(path: string): Promise<void>;
  getActiveDocument(): EditorDocument | null;
  getRuntimeStatus(): LanguageServerRuntimeStatus | null;
  getWorkspaceRoot?(): string | null;
  reportError(error: unknown): void;
}

export function registerJavaScriptTypeScriptLanguageServerMonacoProviders(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
): Disposable {
  const languages = ["javascript", "typescript"];
  const registry = monaco.languages as Partial<typeof monaco.languages>;
  const disposables: Disposable[] = [];

  languages.forEach((language) => {
    if (registry.registerHoverProvider) {
      disposables.push(
        registry.registerHoverProvider(language, {
          provideHover: (model, position) =>
            provideHover(monaco, context, model, position),
        }),
      );
    }

    if (registry.registerCompletionItemProvider) {
      disposables.push(
        registry.registerCompletionItemProvider(language, {
          triggerCharacters: [".", "'", "\"", "/", "@", "<"],
          provideCompletionItems: (model, position) =>
            provideCompletionItems(monaco, context, model, position),
        }),
      );
    }

    if (registry.registerDefinitionProvider) {
      disposables.push(
        registry.registerDefinitionProvider(language, {
          provideDefinition: (model, position) =>
            provideDefinition(monaco, context, model, position),
        }),
      );
    }

    if (registry.registerImplementationProvider) {
      disposables.push(
        registry.registerImplementationProvider(language, {
          provideImplementation: (model, position) =>
            provideImplementation(monaco, context, model, position),
        }),
      );
    }
  });

  return {
    dispose: () => {
      disposables.forEach((disposable) => disposable.dispose());
    },
  };
}

async function provideHover(
  _monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.Hover | null> {
  const request = featureRequestContext(context, model, position, "hover");

  if (!request) {
    return null;
  }

  try {
    await context.flushPendingDocumentChange(request.path);
    const hover = await context.featuresGateway.hover(
      request.rootPath,
      request.position,
    );

    return hover ? { contents: [{ value: hover.contents }] } : null;
  } catch (error) {
    context.reportError(error);
    return null;
  }
}

async function provideCompletionItems(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.CompletionList> {
  const request = featureRequestContext(context, model, position, "completion");

  if (!request) {
    return { suggestions: [] };
  }

  try {
    await context.flushPendingDocumentChange(request.path);
    const completion = await context.featuresGateway.completion(
      request.rootPath,
      request.position,
    );
    const word = model.getWordUntilPosition(position);
    const range = {
      endColumn: word.endColumn,
      endLineNumber: position.lineNumber,
      startColumn: word.startColumn,
      startLineNumber: position.lineNumber,
    };

    return {
      suggestions: completion.items.map((item, index) => {
        const kind = monacoCompletionKindFromLspKind(monaco, item.kind);
        const insert = completionInsert(monaco, item, kind);

        return {
          detail: item.detail || undefined,
          documentation: item.documentation || undefined,
          insertText: insert.insertText,
          ...(insert.command ? { command: insert.command } : {}),
          ...(insert.insertTextRules
            ? { insertTextRules: insert.insertTextRules }
            : {}),
          kind,
          label: item.label,
          range,
          sortText: `0_${String(index).padStart(4, "0")}`,
        };
      }),
    };
  } catch (error) {
    context.reportError(error);
    return { suggestions: [] };
  }
}

async function provideDefinition(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.Definition | null> {
  const request = featureRequestContext(context, model, position, "definition");

  if (!request) {
    return null;
  }

  try {
    await context.flushPendingDocumentChange(request.path);
    const locations = await context.featuresGateway.definition(
      request.rootPath,
      request.position,
    );

    return toMonacoLocations(monaco, locations);
  } catch (error) {
    context.reportError(error);
    return null;
  }
}

async function provideImplementation(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.Definition | null> {
  const request = featureRequestContext(
    context,
    model,
    position,
    "implementation",
  );

  if (!request) {
    return null;
  }

  try {
    await context.flushPendingDocumentChange(request.path);
    const locations = await context.featuresGateway.implementation(
      request.rootPath,
      request.position,
    );

    return toMonacoLocations(monaco, locations);
  } catch (error) {
    context.reportError(error);
    return null;
  }
}

function featureRequestContext(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  feature: "completion" | "definition" | "hover" | "implementation",
) {
  const status = context.getRuntimeStatus();

  if (
    status?.kind !== "running" ||
    !canUseLanguageServerFeature(status.capabilities, feature)
  ) {
    return null;
  }

  const activeDocument = context.getActiveDocument();
  const rootPath = context.getWorkspaceRoot?.() ?? null;

  if (
    !rootPath ||
    !activeDocument ||
    !isJavaScriptTypeScriptDocument(activeDocument) ||
    modelPath(model) !== activeDocument.path
  ) {
    return null;
  }

  return {
    path: activeDocument.path,
    position: toLanguageServerTextDocumentPosition(activeDocument.path, {
      column: position.column,
      lineNumber: position.lineNumber,
    }),
    rootPath,
  };
}

function toMonacoLocations(
  monaco: MonacoApi,
  locations: LanguageServerLocation[],
): Monaco.languages.Location[] {
  return locations.flatMap((location) => {
    const path = pathFromLanguageServerUri(location.uri);

    if (!path) {
      return [];
    }

    return [
      {
        range: new monaco.Range(
          location.range.start.line + 1,
          location.range.start.character + 1,
          location.range.end.line + 1,
          location.range.end.character + 1,
        ),
        uri: monaco.Uri.file(path),
      },
    ];
  });
}

function completionInsert(
  monaco: MonacoApi,
  item: {
    detail: string | null;
    insertText: string | null;
    kind: number | null;
    label: string;
  },
  kind: Monaco.languages.CompletionItemKind,
): {
  command?: Monaco.languages.Command;
  insertText: string;
  insertTextRules?: Monaco.languages.CompletionItemInsertTextRule;
} {
  const insertText = item.insertText || item.label;

  if (/\$(?:\d+|\{)/.test(insertText)) {
    return {
      insertText,
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    };
  }

  if (
    kind !== monaco.languages.CompletionItemKind.Method &&
    kind !== monaco.languages.CompletionItemKind.Function
  ) {
    return { insertText };
  }

  const name = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(insertText.trim())?.[0];

  if (!name) {
    return { insertText };
  }

  const hasKnownParameters = hasParameters(item.detail || "", name);

  return {
    command: hasKnownParameters
      ? {
          id: "editor.action.triggerParameterHints",
          title: "Trigger parameter hints",
        }
      : undefined,
    insertText: hasKnownParameters ? `${name}($0)` : `${name}()$0`,
    insertTextRules:
      monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  };
}

function hasParameters(detail: string, name: string): boolean {
  const match = new RegExp(`${escapeRegExp(name)}\\s*\\(([^)]*)\\)`).exec(
    detail,
  );

  return Boolean(match?.[1].trim());
}

function monacoCompletionKindFromLspKind(
  monaco: MonacoApi,
  kind: number | null | undefined,
): Monaco.languages.CompletionItemKind {
  switch (kind) {
    case 2:
      return monaco.languages.CompletionItemKind.Method;
    case 3:
      return monaco.languages.CompletionItemKind.Function;
    case 5:
      return monaco.languages.CompletionItemKind.Field;
    case 6:
      return monaco.languages.CompletionItemKind.Variable;
    case 7:
      return monaco.languages.CompletionItemKind.Class;
    case 8:
      return monaco.languages.CompletionItemKind.Interface;
    case 9:
      return monaco.languages.CompletionItemKind.Module;
    case 10:
      return monaco.languages.CompletionItemKind.Property;
    case 12:
      return monaco.languages.CompletionItemKind.Value;
    case 13:
      return monaco.languages.CompletionItemKind.Enum;
    case 14:
      return monaco.languages.CompletionItemKind.Keyword;
    case 15:
      return monaco.languages.CompletionItemKind.Snippet;
    case 17:
      return monaco.languages.CompletionItemKind.File;
    case 20:
      return monaco.languages.CompletionItemKind.EnumMember;
    case 21:
      return monaco.languages.CompletionItemKind.Constant;
    default:
      return monaco.languages.CompletionItemKind.Text;
  }
}

function modelPath(model: MonacoModel): string {
  return model.uri.fsPath || model.uri.path;
}

function isJavaScriptTypeScriptDocument(document: EditorDocument): boolean {
  return document.language === "javascript" || document.language === "typescript";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
