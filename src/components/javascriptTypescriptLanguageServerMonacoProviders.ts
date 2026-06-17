import type * as Monaco from "monaco-editor";
import {
  canUseLanguageServerFeature,
  pathFromLanguageServerUri,
  toLanguageServerTextDocumentPosition,
  type LanguageServerCodeAction,
  type LanguageServerCodeActionCommand,
  type LanguageServerCodeActionContext,
  type LanguageServerFeaturesGateway,
  type LanguageServerFormattingOptions,
  type LanguageServerLocation,
  type LanguageServerRange,
  type LanguageServerTextEdit,
  type LanguageServerWorkspaceEdit,
} from "../domain/languageServerFeatures";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import type { EditorDocument } from "../domain/workspace";

type MonacoApi = typeof Monaco;
type MonacoModel = Monaco.editor.ITextModel;
type MonacoPosition = Monaco.Position;
type Disposable = Monaco.IDisposable;
type WorkspaceEditContext = {
  path: string;
  versionId: number | undefined;
};

interface LanguageServerBackedCodeAction extends Monaco.languages.CodeAction {
  __languageServerAction?: LanguageServerCodeAction;
  __workspaceEditContext?: WorkspaceEditContext;
  __workspaceRoot?: string;
}

interface ExecuteCommandPayload {
  command: LanguageServerCodeActionCommand;
  rootPath: string;
}

const EXECUTE_LANGUAGE_SERVER_COMMAND_ID =
  "mockor.javascriptTypeScript.executeLanguageServerCommand";

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
  const commandDisposable = monaco.editor.addCommand({
    id: EXECUTE_LANGUAGE_SERVER_COMMAND_ID,
    run: async (_accessor, payload: ExecuteCommandPayload | undefined) => {
      if (!payload) {
        return;
      }

      try {
        const edit = await context.featuresGateway.executeCommand(
          payload.rootPath,
          payload.command,
        );

        if (edit) {
          applyWorkspaceEditToOpenModels(monaco, edit);
        }
      } catch (error) {
        context.reportError(error);
      }
    },
  });
  disposables.push(commandDisposable);

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

    if (registry.registerReferenceProvider) {
      disposables.push(
        registry.registerReferenceProvider(language, {
          provideReferences: (model, position) =>
            provideReferences(monaco, context, model, position),
        }),
      );
    }

    if (registry.registerRenameProvider) {
      disposables.push(
        registry.registerRenameProvider(language, {
          provideRenameEdits: (model, position, newName) =>
            provideRenameEdits(monaco, context, model, position, newName),
        }),
      );
    }

    if (registry.registerCodeActionProvider) {
      disposables.push(
        registry.registerCodeActionProvider(
          language,
          {
            provideCodeActions: (model, range, actionContext) =>
              provideCodeActions(monaco, context, model, range, actionContext),
            resolveCodeAction: (action) =>
              resolveCodeAction(monaco, context, action),
          },
          {
            providedCodeActionKinds: [
              "quickfix",
              "refactor",
              "source",
              "source.fixAll",
              "source.organizeImports",
            ],
          },
        ),
      );
    }

    if (registry.registerDocumentFormattingEditProvider) {
      disposables.push(
        registry.registerDocumentFormattingEditProvider(language, {
          provideDocumentFormattingEdits: (model, options) =>
            provideDocumentFormattingEdits(monaco, context, model, options),
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

async function provideReferences(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.Location[] | null> {
  const request = featureRequestContext(context, model, position, "references");

  if (!request) {
    return null;
  }

  try {
    await context.flushPendingDocumentChange(request.path);
    const locations = await context.featuresGateway.references(
      request.rootPath,
      request.position,
    );

    return toMonacoLocations(monaco, locations);
  } catch (error) {
    context.reportError(error);
    return null;
  }
}

async function provideRenameEdits(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  newName: string,
): Promise<Monaco.languages.WorkspaceEdit | null> {
  const request = featureRequestContext(context, model, position, "rename");

  if (!request) {
    return null;
  }

  try {
    await context.flushPendingDocumentChange(request.path);
    const edit = await context.featuresGateway.rename(
      request.rootPath,
      request.position,
      newName,
    );

    return edit
      ? toMonacoWorkspaceEdit(monaco, workspaceEditContext(model), edit)
      : null;
  } catch (error) {
    context.reportError(error);
    return null;
  }
}

async function provideCodeActions(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  range: Monaco.Range,
  actionContext: Monaco.languages.CodeActionContext,
): Promise<Monaco.languages.CodeActionList> {
  const request = documentRequestContext(context, model, "codeAction");

  if (!request) {
    return emptyCodeActionList();
  }

  try {
    await context.flushPendingDocumentChange(request.path);
    const actions = await context.featuresGateway.codeActions(
      request.rootPath,
      request.path,
      toLanguageServerRange(range),
      toLanguageServerCodeActionContext(monaco, actionContext),
    );

    return {
      actions: actions.flatMap((action) =>
        toMonacoCodeAction(
          monaco,
          workspaceEditContext(model),
          request.rootPath,
          action,
          actionContext,
        ),
      ),
      dispose: () => undefined,
    };
  } catch (error) {
    context.reportError(error);
    return emptyCodeActionList();
  }
}

async function resolveCodeAction(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  action: Monaco.languages.CodeAction,
): Promise<Monaco.languages.CodeAction> {
  const backedAction = action as LanguageServerBackedCodeAction;

  if (!backedAction.__languageServerAction || !backedAction.__workspaceRoot) {
    return action;
  }

  try {
    const resolved = await context.featuresGateway.resolveCodeAction(
      backedAction.__workspaceRoot,
      backedAction.__languageServerAction,
    );
    const [mapped] = toMonacoCodeAction(
      monaco,
      backedAction.__workspaceEditContext ?? {
        path: "",
        versionId: undefined,
      },
      backedAction.__workspaceRoot,
      resolved,
      {
        markers: action.diagnostics ?? [],
        only: action.kind ?? undefined,
        trigger: monaco.languages.CodeActionTriggerType.Invoke,
      },
    );

    return mapped ? { ...action, ...mapped } : action;
  } catch (error) {
    context.reportError(error);
    return action;
  }
}

async function provideDocumentFormattingEdits(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  options: Monaco.languages.FormattingOptions,
): Promise<Monaco.languages.TextEdit[]> {
  const request = documentRequestContext(context, model, "formatting");

  if (!request) {
    return [];
  }

  try {
    await context.flushPendingDocumentChange(request.path);
    const edits = await context.featuresGateway.formatting(
      request.rootPath,
      request.path,
      toLanguageServerFormattingOptions(options),
    );

    return edits.map((edit) => toMonacoTextEdit(monaco, edit));
  } catch (error) {
    context.reportError(error);
    return [];
  }
}

function featureRequestContext(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  feature:
    | "completion"
    | "definition"
    | "hover"
    | "implementation"
    | "references"
    | "rename",
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

function documentRequestContext(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  feature: "codeAction" | "formatting",
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

function toMonacoWorkspaceEdit(
  monaco: MonacoApi,
  context: WorkspaceEditContext,
  edit: LanguageServerWorkspaceEdit,
): Monaco.languages.WorkspaceEdit {
  return {
    edits: Object.entries(edit.changes).flatMap(([uri, edits]) => {
      const path = pathFromLanguageServerUri(uri);

      if (!path) {
        return [];
      }

      const resource = monaco.Uri.file(path);
      const versionId = context.path === path ? context.versionId : undefined;

      return edits.map((textEdit) => ({
        resource,
        textEdit: toMonacoTextEdit(monaco, textEdit),
        versionId,
      }));
    }),
  };
}

function toMonacoTextEdit(
  monaco: MonacoApi,
  edit: LanguageServerTextEdit,
): Monaco.languages.TextEdit {
  return {
    range: toMonacoRange(monaco, edit.range),
    text: edit.newText,
  };
}

function toMonacoRange(
  monaco: MonacoApi,
  range: LanguageServerRange,
): Monaco.Range {
  return new monaco.Range(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1,
  );
}

function toLanguageServerRange(range: Monaco.Range): LanguageServerRange {
  return {
    end: {
      character: Math.max(0, range.endColumn - 1),
      line: Math.max(0, range.endLineNumber - 1),
    },
    start: {
      character: Math.max(0, range.startColumn - 1),
      line: Math.max(0, range.startLineNumber - 1),
    },
  };
}

function toLanguageServerCodeActionContext(
  monaco: MonacoApi,
  context: Monaco.languages.CodeActionContext,
): LanguageServerCodeActionContext {
  return {
    diagnostics: context.markers.map((marker) => ({
      code: markerCode(marker),
      message: marker.message,
      range: {
        end: {
          character: Math.max(0, marker.endColumn - 1),
          line: Math.max(0, marker.endLineNumber - 1),
        },
        start: {
          character: Math.max(0, marker.startColumn - 1),
          line: Math.max(0, marker.startLineNumber - 1),
        },
      },
      severity: lspDiagnosticSeverity(monaco, marker.severity),
      source: marker.source ?? null,
    })),
    only: context.only ? [context.only] : null,
  };
}

function markerCode(marker: Monaco.editor.IMarkerData): string | number | null {
  if (!marker.code) {
    return null;
  }

  if (typeof marker.code === "string" || typeof marker.code === "number") {
    return marker.code;
  }

  return marker.code.value;
}

function lspDiagnosticSeverity(
  monaco: MonacoApi,
  severity: Monaco.MarkerSeverity,
): number | null {
  if (severity === monaco.MarkerSeverity.Error) {
    return 1;
  }

  if (severity === monaco.MarkerSeverity.Warning) {
    return 2;
  }

  if (severity === monaco.MarkerSeverity.Info) {
    return 3;
  }

  if (severity === monaco.MarkerSeverity.Hint) {
    return 4;
  }

  return null;
}

function toMonacoCodeAction(
  monaco: MonacoApi,
  editContext: WorkspaceEditContext,
  rootPath: string,
  action: LanguageServerCodeAction,
  context: Monaco.languages.CodeActionContext,
): Monaco.languages.CodeAction[] {
  if (!action.edit && !action.command && action.data == null) {
    return [];
  }

  const codeAction: LanguageServerBackedCodeAction = {
    __languageServerAction: action,
    __workspaceEditContext: editContext,
    __workspaceRoot: rootPath,
    diagnostics: context.markers,
    ...(action.command
      ? {
          command: {
            arguments: [
              {
                command: action.command,
                rootPath,
              } satisfies ExecuteCommandPayload,
            ],
            id: EXECUTE_LANGUAGE_SERVER_COMMAND_ID,
            title: action.command.title || action.title,
          },
        }
      : {}),
    ...(action.edit
      ? { edit: toMonacoWorkspaceEdit(monaco, editContext, action.edit) }
      : {}),
    isPreferred: action.isPreferred,
    kind: action.kind ?? "quickfix",
    title: action.title,
  };

  return [codeAction];
}

function emptyCodeActionList(): Monaco.languages.CodeActionList {
  return {
    actions: [],
    dispose: () => undefined,
  };
}

function toLanguageServerFormattingOptions(
  options: Monaco.languages.FormattingOptions,
): LanguageServerFormattingOptions {
  return {
    insertSpaces: options.insertSpaces,
    tabSize: options.tabSize,
  };
}

function workspaceEditContext(model: MonacoModel): WorkspaceEditContext {
  return {
    path: modelPath(model),
    versionId:
      typeof model.getVersionId === "function" ? model.getVersionId() : undefined,
  };
}

function applyWorkspaceEditToOpenModels(
  monaco: MonacoApi,
  edit: LanguageServerWorkspaceEdit,
): void {
  const modelsByPath = new Map(
    monaco.editor.getModels().map((model) => [modelPath(model), model]),
  );

  Object.entries(edit.changes).forEach(([uri, edits]) => {
    const path = pathFromLanguageServerUri(uri);
    const model = path ? modelsByPath.get(path) : null;

    if (!model) {
      return;
    }

    model.pushEditOperations(
      [],
      edits.map((textEdit) => ({
        range: toMonacoRange(monaco, textEdit.range),
        text: textEdit.newText,
      })),
      () => null,
    );
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
