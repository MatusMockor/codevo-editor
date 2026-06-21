import type * as Monaco from "monaco-editor";
import {
  canUseLanguageServerFeature,
  pathFromLanguageServerUri,
  toLanguageServerTextDocumentPosition,
  type LanguageServerCodeAction,
  type LanguageServerCodeActionCommand,
  type LanguageServerCodeActionContext,
  type LanguageServerFeaturesGateway,
  type LanguageServerLocation,
  type LanguageServerRange,
  type LanguageServerSelectionRange,
  type LanguageServerTextEdit,
  type LanguageServerTextDocumentPosition,
  type LanguageServerWorkspaceEdit,
  type LanguageServerWorkspaceEditEvent,
  type LanguageServerWorkspaceEditGateway,
} from "../domain/languageServerFeatures";
import { isLanguageServerDocument } from "../domain/languageServerDocumentSync";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import { phpLaravelRelationStringCompletionContextAt } from "../domain/phpNavigation";
import {
  phpMemberAccessCompletionContextAt,
  phpMethodParameters,
  phpStaticAccessCompletionContextAt,
  type PhpMethodCompletion,
  type PhpMethodParameter,
  type PhpMethodSignature,
} from "../domain/phpMethodCompletions";
import { phpVariableCompletionsAt } from "../domain/phpScopeCompletions";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

type MonacoApi = typeof Monaco;
type MonacoModel = Monaco.editor.ITextModel;
type MonacoPosition = Monaco.Position;
type Disposable = Monaco.IDisposable;
type WorkspaceEditContext = {
  path: string | null;
  versionId: number | undefined;
};
export interface PhpWorkspaceEditApplicationContext {
  editedOpenPaths: string[];
  rootPath: string;
}
export type PhpWorkspaceEditApplier = (
  edit: LanguageServerWorkspaceEdit,
  context: PhpWorkspaceEditApplicationContext,
) => Promise<void> | void;

interface LanguageServerBackedCodeAction extends Monaco.languages.CodeAction {
  __languageServerAction?: LanguageServerCodeAction;
  __languageServerSessionId?: number;
  __workspaceEditContext?: WorkspaceEditContext;
  __workspaceRoot?: string;
}

interface ExecuteCommandPayload {
  command: LanguageServerCodeActionCommand;
  rootPath: string;
  sessionId: number;
}

const EXECUTE_PHP_LANGUAGE_SERVER_COMMAND_ID =
  "mockor.php.executeLanguageServerCommand";

export interface LanguageServerMonacoProviderContext {
  applyWorkspaceEdit?: PhpWorkspaceEditApplier;
  featuresGateway: LanguageServerFeaturesGateway;
  flushPendingDocumentChange(path: string): Promise<void>;
  getActiveDocument(): EditorDocument | null;
  getRuntimeStatus(): LanguageServerRuntimeStatus | null;
  getWorkspaceRoot?(): string | null;
  providePhpMethodCompletions?(
    source: string,
    position: MonacoPosition,
  ): Promise<PhpMethodCompletion[]>;
  providePhpMethodSignature?(
    source: string,
    position: MonacoPosition,
  ): Promise<PhpMethodSignature | null>;
  reportError(error: unknown): void;
  workspaceEditGateway?: LanguageServerWorkspaceEditGateway;
}

export function registerLanguageServerMonacoProviders(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
): Disposable {
  let workspaceEditUnsubscribe: (() => void) | null = null;
  let workspaceEditSubscriptionDisposed = false;
  const workspaceEditSubscriptionDisposable = {
    dispose: () => {
      workspaceEditSubscriptionDisposed = true;
      workspaceEditUnsubscribe?.();
      workspaceEditUnsubscribe = null;
    },
  };

  if (context.workspaceEditGateway) {
    context.workspaceEditGateway
      .subscribeWorkspaceEdits((event) => {
        void applyWorkspaceEditEvent(monaco, context, event).catch((error) => {
          reportErrorForActiveWorkspaceEditEvent(context, event, error);
        });
      })
      .then((unsubscribe) => {
        if (workspaceEditSubscriptionDisposed) {
          unsubscribe();
          return;
        }

        workspaceEditUnsubscribe = unsubscribe;
      })
      .catch((error) => context.reportError(error));
  }

  const command = monaco.editor.addCommand({
    id: EXECUTE_PHP_LANGUAGE_SERVER_COMMAND_ID,
    run: async (_accessor, payload: ExecuteCommandPayload | undefined) => {
      if (!payload) {
        return;
      }

      if (
        payload.sessionId == null ||
        !isStoredLanguageServerPayloadActive(
          context,
          payload.rootPath,
          payload.sessionId,
        )
      ) {
        return;
      }

      try {
        const edit = await context.featuresGateway.executeCommand(
          payload.rootPath,
          payload.command,
        );

        if (
          !isStoredLanguageServerPayloadActive(
            context,
            payload.rootPath,
            payload.sessionId,
          )
        ) {
          return;
        }

        if (edit) {
          await applyWorkspaceEditWithOpenModels(
            monaco,
            context,
            edit,
            payload.rootPath,
          );
        }
      } catch (error) {
        if (
          isStoredLanguageServerPayloadActive(
            context,
            payload.rootPath,
            payload.sessionId,
          )
        ) {
          context.reportError(error);
        }
      }
    },
  });
  const hover = monaco.languages.registerHoverProvider("php", {
    provideHover: (model, position) => provideHover(monaco, context, model, position),
  });
  const completion = monaco.languages.registerCompletionItemProvider("php", {
    triggerCharacters: ["$", ">", ":", "'", "\""],
    provideCompletionItems: (model, position) =>
      provideCompletionItems(monaco, context, model, position),
  });
  const signature = monaco.languages.registerSignatureHelpProvider("php", {
    signatureHelpRetriggerCharacters: [","],
    signatureHelpTriggerCharacters: ["(", ","],
    provideSignatureHelp: (model, position) =>
      provideSignatureHelp(monaco, context, model, position),
  });
  const codeActions = monaco.languages.registerCodeActionProvider(
    "php",
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
  );
  const selectionRange = monaco.languages.registerSelectionRangeProvider("php", {
    provideSelectionRanges: (model, positions) =>
      provideSelectionRanges(monaco, context, model, positions),
  });
  const rename = monaco.languages.registerRenameProvider
    ? monaco.languages.registerRenameProvider("php", {
        provideRenameEdits: (model, position, newName) =>
          provideRenameEdits(monaco, context, model, position, newName),
        resolveRenameLocation: (model, position) =>
          prepareRename(monaco, context, model, position),
      })
    : { dispose: () => undefined };
  const references = monaco.languages.registerReferenceProvider
    ? monaco.languages.registerReferenceProvider("php", {
        provideReferences: (model, position) =>
          provideReferences(monaco, context, model, position),
      })
    : { dispose: () => undefined };
  const declaration = monaco.languages.registerDeclarationProvider
    ? monaco.languages.registerDeclarationProvider("php", {
        provideDeclaration: (model, position) =>
          provideDeclaration(monaco, context, model, position),
      })
    : { dispose: () => undefined };
  const typeDefinition = monaco.languages.registerTypeDefinitionProvider
    ? monaco.languages.registerTypeDefinitionProvider("php", {
        provideTypeDefinition: (model, position) =>
          provideTypeDefinition(monaco, context, model, position),
      })
    : { dispose: () => undefined };

  return {
    dispose: () => {
      workspaceEditSubscriptionDisposable.dispose();
      command.dispose();
      hover.dispose();
      completion.dispose();
      signature.dispose();
      codeActions.dispose();
      selectionRange.dispose();
      rename.dispose();
      references.dispose();
      declaration.dispose();
      typeDefinition.dispose();
    },
  };
}

async function prepareRename(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<(Monaco.languages.RenameLocation & Monaco.languages.Rejection) | null> {
  const request = featureRequestContext(context, model, position, "prepareRename");

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return null;
    }

    const prepareRename = await context.featuresGateway.prepareRename(
      request.rootPath,
      request.position,
    );

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    if (!prepareRename?.range || prepareRename.defaultBehavior) {
      return defaultRenameLocation(model, position);
    }

    const range = toMonacoRange(monaco, prepareRename.range);

    return {
      range,
      text: prepareRename.placeholder ?? model.getValueInRange(range),
    };
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return null;
  }
}

async function provideRenameEdits(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  newName: string,
): Promise<Monaco.languages.WorkspaceEdit | null> {
  const request = featureRequestContext(context, model, position, "rename");

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return null;
    }

    const edit = await context.featuresGateway.rename(
      request.rootPath,
      request.position,
      newName,
    );

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    if (!edit) {
      return null;
    }

    if (context.applyWorkspaceEdit) {
      await applyWorkspaceEditWithOpenModels(
        monaco,
        context,
        edit,
        request.rootPath,
      );

      if (!isFeatureRequestActive(context, request)) {
        return null;
      }

      return { edits: [] };
    }

    return toMonacoWorkspaceEdit(
      monaco,
      workspaceEditContext(model),
      edit,
      request.rootPath,
    );
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return null;
  }
}

async function provideReferences(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.Location[] | null> {
  return provideNavigationLocations(
    monaco,
    context,
    model,
    position,
    "references",
    (rootPath, requestPosition) =>
      context.featuresGateway.references(rootPath, requestPosition),
  );
}

async function provideDeclaration(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.Location[] | null> {
  return provideNavigationLocations(
    monaco,
    context,
    model,
    position,
    "declaration",
    (rootPath, requestPosition) =>
      context.featuresGateway.declaration(rootPath, requestPosition),
  );
}

async function provideTypeDefinition(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.Location[] | null> {
  return provideNavigationLocations(
    monaco,
    context,
    model,
    position,
    "typeDefinition",
    (rootPath, requestPosition) =>
      context.featuresGateway.typeDefinition(rootPath, requestPosition),
  );
}

async function provideNavigationLocations(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  feature: "declaration" | "references" | "typeDefinition",
  requestLocations: (
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ) => Promise<LanguageServerLocation[]>,
): Promise<Monaco.languages.Location[] | null> {
  const request = featureRequestContext(context, model, position, feature);

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return null;
    }

    const locations = await requestLocations(request.rootPath, request.position);

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    return locations.flatMap((location) =>
      toMonacoLocation(monaco, request.rootPath, location),
    );
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return null;
  }
}

function defaultRenameLocation(
  model: MonacoModel,
  position: MonacoPosition,
): (Monaco.languages.RenameLocation & Monaco.languages.Rejection) | null {
  const word = model.getWordAtPosition(position);

  if (!word) {
    return {
      rejectReason: "Cannot rename this symbol.",
    } as Monaco.languages.RenameLocation & Monaco.languages.Rejection;
  }

  return {
    range: {
      endColumn: word.endColumn,
      endLineNumber: position.lineNumber,
      startColumn: word.startColumn,
      startLineNumber: position.lineNumber,
    },
    text: word.word,
  };
}

async function provideCodeActions(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  range: Monaco.Range,
  actionContext: Monaco.languages.CodeActionContext,
): Promise<Monaco.languages.CodeActionList> {
  const localActions = provideLocalCodeActions(
    monaco,
    model,
    range,
    actionContext,
  );
  const request = featureDocumentRequestContext(context, model, "codeAction");

  if (!request) {
    return codeActionList(localActions);
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return codeActionList(localActions);
    }

    const actions = await context.featuresGateway.codeActions(
      request.rootPath,
      request.path,
      toLanguageServerRange(range),
      toLanguageServerCodeActionContext(monaco, actionContext),
    );

    if (!isFeatureRequestActive(context, request)) {
      return codeActionList(localActions);
    }

    return codeActionList([
      ...actions.flatMap((action) =>
        toMonacoCodeAction(
          monaco,
          workspaceEditContext(model),
          request.rootPath,
          request.sessionId,
          action,
          actionContext,
        ),
      ),
      ...localActions,
    ]);
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);

    return codeActionList(localActions);
  }
}

async function resolveCodeAction(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  action: Monaco.languages.CodeAction,
): Promise<Monaco.languages.CodeAction> {
  const backedAction = action as LanguageServerBackedCodeAction;

  if (
    !backedAction.__languageServerAction ||
    !backedAction.__workspaceRoot ||
    backedAction.__languageServerSessionId == null ||
    !isStoredLanguageServerPayloadActive(
      context,
      backedAction.__workspaceRoot,
      backedAction.__languageServerSessionId,
    )
  ) {
    return action;
  }

  try {
    const resolved = await context.featuresGateway.resolveCodeAction(
      backedAction.__workspaceRoot,
      backedAction.__languageServerAction,
    );

    if (
      !isStoredLanguageServerPayloadActive(
        context,
        backedAction.__workspaceRoot,
        backedAction.__languageServerSessionId,
      )
    ) {
      return action;
    }

    const [mapped] = toMonacoCodeAction(
      monaco,
      backedAction.__workspaceEditContext ?? {
        path: null,
        versionId: undefined,
      },
      backedAction.__workspaceRoot,
      backedAction.__languageServerSessionId,
      resolved,
      {
        markers: action.diagnostics ?? [],
        only: action.kind ?? undefined,
        trigger: monaco.languages.CodeActionTriggerType.Invoke,
      },
    );

    return mapped ? { ...action, ...mapped } : action;
  } catch (error) {
    if (
      isStoredLanguageServerPayloadActive(
        context,
        backedAction.__workspaceRoot,
        backedAction.__languageServerSessionId,
      )
    ) {
      context.reportError(error);
    }

    return action;
  }
}

function provideLocalCodeActions(
  monaco: MonacoApi,
  model: MonacoModel,
  range: Monaco.Range,
  context: Monaco.languages.CodeActionContext,
): Monaco.languages.CodeAction[] {
  if (context.only && !context.only.startsWith("quickfix")) {
    return [];
  }

  return context.markers
    .filter(isUnexpectedBareIdentifierMarker)
    .filter((marker) => markerTouchesRange(marker, range))
    .map((marker) => ({
      diagnostics: [marker],
      edit: {
        edits: [
          {
            resource: model.uri,
            textEdit: {
              range: new monaco.Range(
                marker.startLineNumber,
                marker.startColumn,
                marker.endLineNumber,
                marker.endColumn,
              ),
              text: "",
            },
            versionId: model.getVersionId(),
          },
        ],
      },
      isPreferred: true,
      kind: "quickfix",
      title: "Remove unexpected identifier",
    }));
}

function codeActionList(
  actions: Monaco.languages.CodeAction[],
): Monaco.languages.CodeActionList {
  return {
    actions,
    dispose: () => undefined,
  };
}

function isUnexpectedBareIdentifierMarker(
  marker: Monaco.editor.IMarkerData,
): boolean {
  return (
    marker.source === "PHP Syntax" &&
    /^Unexpected bare PHP identifier "[^"]+"\.$/.test(marker.message)
  );
}

function markerTouchesRange(
  marker: Monaco.editor.IMarkerData,
  range: Monaco.Range,
): boolean {
  if (marker.endLineNumber < range.startLineNumber) {
    return false;
  }

  if (marker.startLineNumber > range.endLineNumber) {
    return false;
  }

  if (
    marker.startLineNumber === range.endLineNumber &&
    marker.startColumn > range.endColumn
  ) {
    return false;
  }

  if (
    marker.endLineNumber === range.startLineNumber &&
    marker.endColumn < range.startColumn
  ) {
    return false;
  }

  return true;
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
      data: markerData(marker),
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
    triggerKind: codeActionTriggerKind(monaco, context.trigger),
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

function markerData(marker: Monaco.editor.IMarkerData): unknown | null {
  return (marker as Monaco.editor.IMarkerData & { data?: unknown }).data ?? null;
}

function codeActionTriggerKind(
  monaco: MonacoApi,
  trigger: Monaco.languages.CodeActionTriggerType | undefined,
): number | null {
  if (trigger === monaco.languages.CodeActionTriggerType.Invoke) {
    return 1;
  }

  if (trigger === 2) {
    return 2;
  }

  return null;
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
  sessionId: number,
  action: LanguageServerCodeAction,
  context: Monaco.languages.CodeActionContext,
): Monaco.languages.CodeAction[] {
  if (!action.edit && !action.command && action.data == null && !action.disabled) {
    return [];
  }

  const codeAction: LanguageServerBackedCodeAction = {
    __languageServerAction: action,
    __languageServerSessionId: sessionId,
    __workspaceEditContext: editContext,
    __workspaceRoot: rootPath,
    diagnostics: context.markers,
    ...(action.command
      ? {
          command: toMonacoLanguageServerCommand(
            rootPath,
            sessionId,
            action.command,
            action.title,
          ),
        }
      : {}),
    ...(action.edit
      ? {
          edit: toMonacoWorkspaceEdit(
            monaco,
            editContext,
            action.edit,
            rootPath,
          ),
        }
      : {}),
    ...(action.disabled
      ? {
          disabled: action.disabled.reason,
        }
      : {}),
    isPreferred: action.isPreferred,
    kind: action.kind ?? "quickfix",
    title: action.title,
  };

  return [codeAction];
}

function toMonacoLanguageServerCommand(
  rootPath: string,
  sessionId: number,
  command: LanguageServerCodeActionCommand,
  fallbackTitle: string,
): Monaco.languages.Command {
  return {
    arguments: [
      {
        command,
        rootPath,
        sessionId,
      } satisfies ExecuteCommandPayload,
    ],
    id: EXECUTE_PHP_LANGUAGE_SERVER_COMMAND_ID,
    title: command.title || fallbackTitle,
  };
}

function toMonacoWorkspaceEdit(
  monaco: MonacoApi,
  context: WorkspaceEditContext,
  edit: LanguageServerWorkspaceEdit,
  rootPath: string,
): Monaco.languages.WorkspaceEdit {
  return {
    edits: Object.entries(edit.changes).flatMap(([uri, edits]) => {
      const path = pathFromLanguageServerUri(uri);

      if (!path) {
        return [];
      }

      if (!isPathInWorkspaceRoot(rootPath, path)) {
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

function toMonacoLocation(
  monaco: MonacoApi,
  rootPath: string,
  location: LanguageServerLocation,
): Monaco.languages.Location[] {
  const path = pathFromLanguageServerUri(location.uri);

  if (!path || !isPathInWorkspaceRoot(rootPath, path)) {
    return [];
  }

  return [
    {
      range: toMonacoRange(monaco, location.range),
      uri: monaco.Uri.file(path),
    },
  ];
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

function flattenSelectionRange(
  monaco: MonacoApi,
  selectionRange: LanguageServerSelectionRange,
): Monaco.languages.SelectionRange[] {
  const ranges: Monaco.languages.SelectionRange[] = [];
  let current: LanguageServerSelectionRange | null = selectionRange;

  while (current) {
    ranges.push({ range: toMonacoRange(monaco, current.range) });
    current = current.parent;
  }

  return ranges;
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
): string[] {
  const editedOpenPaths: string[] = [];
  const modelsByPath = new Map(
    monaco.editor.getModels().map((model) => [modelPath(model), model]),
  );

  Object.entries(edit.changes).forEach(([uri, edits]) => {
    const path = pathFromLanguageServerUri(uri);
    const model = path ? modelsByPath.get(path) : null;

    if (!path || !model || edits.length === 0) {
      return;
    }

    if (!isWorkspaceEditVersionCurrentForModel(edit, uri, model)) {
      editedOpenPaths.push(path);
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
    editedOpenPaths.push(path);
  });

  return editedOpenPaths;
}

async function applyWorkspaceEditWithOpenModels(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  edit: LanguageServerWorkspaceEdit,
  rootPath: string,
): Promise<void> {
  const scopedEdit = workspaceEditForRoot(edit, rootPath);
  const editedOpenPaths = applyWorkspaceEditToOpenModels(monaco, scopedEdit);

  await context.applyWorkspaceEdit?.(scopedEdit, {
    editedOpenPaths,
    rootPath,
  });
}

async function applyWorkspaceEditEvent(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  event: LanguageServerWorkspaceEditEvent,
): Promise<void> {
  if (!isWorkspaceEditEventActive(context, event)) {
    return;
  }

  await applyWorkspaceEditWithOpenModels(
    monaco,
    context,
    event.edit,
    event.rootPath,
  );
}

function workspaceEditForRoot(
  edit: LanguageServerWorkspaceEdit,
  rootPath: string,
): LanguageServerWorkspaceEdit {
  const changes = Object.fromEntries(
    Object.entries(edit.changes).filter(([uri]) => {
      const path = pathFromLanguageServerUri(uri);

      return path ? isPathInWorkspaceRoot(rootPath, path) : false;
    }),
  );
  const documentVersions = Object.fromEntries(
    Object.entries(edit.documentVersions ?? {}).filter(([uri]) => {
      const path = pathFromLanguageServerUri(uri);

      return path ? isPathInWorkspaceRoot(rootPath, path) : false;
    }),
  );
  const fileOperations = (edit.fileOperations ?? []).filter((operation) => {
    const uris =
      operation.kind === "rename"
        ? [operation.oldUri, operation.newUri]
        : [operation.uri];

    return uris.every((uri) => {
      const path = pathFromLanguageServerUri(uri);

      return path ? isPathInWorkspaceRoot(rootPath, path) : false;
    });
  });

  return {
    ...(fileOperations.length > 0 ? { fileOperations } : {}),
    ...(Object.keys(documentVersions).length > 0
      ? { documentVersions }
      : {}),
    changes,
  };
}

function isWorkspaceEditVersionCurrentForModel(
  edit: LanguageServerWorkspaceEdit,
  uri: string,
  model: MonacoModel,
): boolean {
  const editVersion = edit.documentVersions?.[uri];

  if (typeof editVersion !== "number") {
    return true;
  }

  return (
    typeof model.getVersionId === "function" &&
    model.getVersionId() === editVersion
  );
}

async function provideHover(
  _monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.Hover | null> {
  const request = featureRequestContext(context, model, position, "hover");

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return null;
    }

    const hover = await context.featuresGateway.hover(
      request.rootPath,
      request.position,
    );

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    if (!hover) {
      return null;
    }

    return {
      contents: [{ value: hover.contents }],
    };
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return null;
  }
}

async function provideCompletionItems(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.CompletionList> {
  const documentContext = activePhpDocumentContext(context, model);

  if (!documentContext) {
    return { suggestions: [] };
  }

  const word = model.getWordUntilPosition(position);
  const range = completionRange(model, position, word);
  const source = modelSource(model, documentContext.activeDocument.content);
  const methodSuggestions = await phpMethodSuggestions(
    monaco,
    context,
    source,
    position,
    range,
    documentContext,
  );

  if (!isPhpDocumentContextActive(context, documentContext)) {
    return { suggestions: [] };
  }

  const memberAccessCompletionContext = phpMemberAccessCompletionContextAt(
    source,
    position,
  );
  const staticAccessCompletionContext = phpStaticAccessCompletionContextAt(
    source,
    position,
  );
  const relationStringCompletionContext =
    phpLaravelRelationStringCompletionContextAt(source, position);
  const isMemberOrStaticAccessCompletion = Boolean(
    memberAccessCompletionContext || staticAccessCompletionContext,
  );
  const isScopedCompletion = Boolean(
    isMemberOrStaticAccessCompletion || relationStringCompletionContext,
  );
  const variableSuggestions: Monaco.languages.CompletionItem[] =
    methodSuggestions.length > 0 || isScopedCompletion
      ? []
      : phpVariableCompletionsAt(
          source,
          position,
        ).map((item, index) => ({
          detail: item.detail,
          insertText: item.name,
          kind: monaco.languages.CompletionItemKind.Variable,
          label: item.name,
          range,
          sortText: `0_${String(index).padStart(4, "0")}`,
        }));
  const suggestions = [...methodSuggestions, ...variableSuggestions];
  const request = featureRequestContext(context, model, position, "completion");

  if (!request) {
    return { suggestions };
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return { suggestions: [] };
    }

    const completion = await context.featuresGateway.completion(
      request.rootPath,
      request.position,
    );

    if (!isFeatureRequestActive(context, request)) {
      return { suggestions: [] };
    }

    const lspSuggestions = completion.items.flatMap((item, index) => {
      const kind = monacoCompletionKindFromLspKind(monaco, item.kind);

      if (
        isMemberOrStaticAccessCompletion &&
        !phpLspCompletionAllowedInMemberContext(
          monaco,
          item,
          kind,
          Boolean(staticAccessCompletionContext),
        )
      ) {
        return [];
      }

      const insert = lspCompletionInsert(monaco, item, kind);

      return [{
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
        sortText: `1_${String(index).padStart(4, "0")}`,
      }];
    });

    return {
      suggestions: dedupeCompletionItems(monaco, [
        ...suggestions,
        ...lspSuggestions,
      ]),
    };
  } catch (error) {
    if (isFeatureRequestActive(context, request)) {
      context.reportError(error);
      return { suggestions };
    }

    return { suggestions: [] };
  }
}

async function phpMethodSuggestions(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  source: string,
  position: MonacoPosition,
  range: ReturnType<typeof completionRange>,
  request: { rootPath: string; sessionId: number | null },
): Promise<Monaco.languages.CompletionItem[]> {
  if (!context.providePhpMethodCompletions) {
    return [];
  }

  try {
    const methods = await context.providePhpMethodCompletions(source, position);

    if (!isPhpDocumentContextActive(context, request)) {
      return [];
    }

    return methods.map((item, index) => ({
      command:
        item.kind !== "property" &&
        item.kind !== "relation" &&
        item.kind !== "route" &&
        phpMethodParameters(item.parameters).length
          ? {
              id: "editor.action.triggerParameterHints",
              title: "Trigger parameter hints",
            }
          : undefined,
      detail: phpMethodDetail(item),
      documentation: phpMethodDocumentation(item),
      insertText: phpMethodSnippet(item),
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      kind: phpMethodCompletionKind(monaco, item),
      label: phpMethodCompletionLabel(item),
      range,
      sortText: `0_${String(index).padStart(4, "0")}`,
    }));
  } catch (error) {
    if (isPhpDocumentContextActive(context, request)) {
      context.reportError(error);
    }
    return [];
  }
}

const invalidPhpMemberCompletionNames = new Set([
  "class",
  "const",
  "function",
  "interface",
  "namespace",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "trait",
  "use",
]);

function phpLspCompletionAllowedInMemberContext(
  monaco: MonacoApi,
  item: {
    detail: string | null;
    documentation: string | null;
    insertText: string | null;
    label: string;
  },
  kind: Monaco.languages.CompletionItemKind,
  allowConstants: boolean,
): boolean {
  const labelName = phpCallableCompletionName(item.label);

  if (labelName && invalidPhpMemberCompletionNames.has(labelName.toLowerCase())) {
    return false;
  }

  if (
    kind === monaco.languages.CompletionItemKind.Method ||
    kind === monaco.languages.CompletionItemKind.Property ||
    kind === monaco.languages.CompletionItemKind.Field
  ) {
    return true;
  }

  if (kind === monaco.languages.CompletionItemKind.Constant) {
    return allowConstants;
  }

  if (
    kind !== monaco.languages.CompletionItemKind.Function &&
    kind !== monaco.languages.CompletionItemKind.Text
  ) {
    return false;
  }

  if (!labelName) {
    return false;
  }

  return completionItemValuesLookLikeSignature(item, item.insertText, labelName);
}

async function provideSignatureHelp(
  _monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.SignatureHelpResult | null> {
  const documentContext = activePhpDocumentContext(context, model);

  if (!documentContext || !context.providePhpMethodSignature) {
    return null;
  }

  try {
    const signature = await context.providePhpMethodSignature(
      modelSource(model, documentContext.activeDocument.content),
      position,
    );

    if (!isPhpDocumentContextActive(context, documentContext)) {
      return null;
    }

    if (!signature) {
      return null;
    }

    return {
      dispose: () => undefined,
      value: {
        activeParameter: Math.min(
          signature.argumentIndex,
          Math.max(0, signature.parameters.length - 1),
        ),
        activeSignature: 0,
        signatures: [
          {
            documentation: signature.method.declaringClassName,
            label: phpMethodSignatureLabel(signature.method),
            parameters: signature.parameters.map((parameter) => ({
              label: phpParameterLabel(parameter),
            })),
          },
        ],
      },
    };
  } catch (error) {
    if (isPhpDocumentContextActive(context, documentContext)) {
      context.reportError(error);
    }
    return null;
  }
}

async function provideSelectionRanges(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  positions: MonacoPosition[],
): Promise<Monaco.languages.SelectionRange[][] | null> {
  const request = featureDocumentRequestContext(context, model, "selectionRange");

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return null;
    }

    const selectionRanges = await context.featuresGateway.selectionRanges(
      request.rootPath,
      request.path,
      positions.map((position) => ({
        character: Math.max(0, position.column - 1),
        line: Math.max(0, position.lineNumber - 1),
      })),
    );

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    return selectionRanges.map((selectionRange) =>
      flattenSelectionRange(monaco, selectionRange),
    );
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return null;
  }
}

function phpMethodCompletionKind(
  monaco: MonacoApi,
  item: PhpMethodCompletion,
): Monaco.languages.CompletionItemKind {
  if (item.kind === "relation") {
    return monaco.languages.CompletionItemKind.Field;
  }

  if (item.kind === "route") {
    return monaco.languages.CompletionItemKind.Value;
  }

  if (item.kind === "property") {
    return monaco.languages.CompletionItemKind.Property;
  }

  return monaco.languages.CompletionItemKind.Method;
}

function phpMethodDetail(item: PhpMethodCompletion): string {
  if (item.kind === "relation") {
    const returnType = item.returnType ? `: ${item.returnType}` : "";

    return `${item.declaringClassName}::${item.name} relation${returnType}`;
  }

  if (item.kind === "property") {
    const returnType = item.returnType ? `: ${item.returnType}` : "";

    return `${item.declaringClassName}::$${item.name}${returnType}`;
  }

  if (item.kind === "route") {
    return `Laravel route - ${item.declaringClassName}`;
  }

  const parameters = item.parameters ? `(${item.parameters})` : "()";
  const returnType = item.returnType ? `: ${item.returnType}` : "";

  return `${item.declaringClassName}::${item.name}${parameters}${returnType}`;
}

function phpMethodDocumentation(item: PhpMethodCompletion): string {
  if (item.kind === "relation") {
    return `Laravel relation\n\n${item.declaringClassName}::${item.name}()`;
  }

  if (item.kind === "property") {
    return `Property\n\n${item.declaringClassName}::$${item.name}`;
  }

  if (item.kind === "route") {
    return `Laravel named route\n\n${item.name}`;
  }

  const parameters = phpMethodParameters(item.parameters);

  if (!parameters.length) {
    return `Method\n\n${item.declaringClassName}::${item.name}()`;
  }

  return [
    "Method",
    "",
    `${item.declaringClassName}::${item.name}()`,
    "",
    ...parameters.map((parameter) => `- ${phpParameterLabel(parameter)}`),
  ].join("\n");
}

function phpMethodCompletionLabel(
  item: PhpMethodCompletion,
): Monaco.languages.CompletionItemLabel {
  return {
    description:
      item.kind === "relation"
        ? `relation - ${item.declaringClassName}`
        : item.kind === "route"
        ? `route - ${item.declaringClassName}`
        : item.kind === "property"
        ? `property - ${item.declaringClassName}`
        : `method - ${item.declaringClassName}`,
    detail:
      item.kind === "property" || item.kind === "relation" || item.kind === "route"
        ? ""
        : "()",
    label: item.name,
  };
}

function phpMethodSignatureLabel(item: PhpMethodCompletion): string {
  const parameters = item.parameters ? `(${item.parameters})` : "()";
  const returnType = item.returnType ? `: ${item.returnType}` : "";

  return `${item.name}${parameters}${returnType}`;
}

function phpMethodSnippet(item: PhpMethodCompletion): string {
  if (item.insertText) {
    return item.insertText;
  }

  if (item.kind === "property" || item.kind === "relation" || item.kind === "route") {
    return item.name;
  }

  const parameters = phpMethodParameters(item.parameters);

  if (!parameters.length) {
    return `${item.name}()$0`;
  }

  const requiredParameters = parameters.filter((parameter) => !parameter.optional);

  if (!requiredParameters.length) {
    return `${item.name}($0)`;
  }

  const placeholders = requiredParameters.map(
    (parameter, index) =>
      `\${${index + 1}:${snippetPlaceholderText(parameter.name)}}`,
  );

  return `${item.name}(${placeholders.join(", ")})$0`;
}

function phpParameterLabel(parameter: PhpMethodParameter): string {
  const type = parameter.type ? `${parameter.type} ` : "";
  const defaultValue =
    parameter.defaultValue !== null ? ` = ${parameter.defaultValue}` : "";

  return `${type}${parameter.name}${defaultValue}`;
}

function snippetPlaceholderText(value: string): string {
  const name = value.replace(/^\.\.\./, "").replace(/^\$/, "") || "value";

  return name.replace(/[$}\\]/g, "\\$&");
}

function lspCompletionInsert(
  monaco: MonacoApi,
  item: {
    detail: string | null;
    documentation: string | null;
    insertText: string | null;
    label: string;
  },
  kind: Monaco.languages.CompletionItemKind,
): {
  command?: Monaco.languages.Command;
  insertText: string;
  insertTextRules?: Monaco.languages.CompletionItemInsertTextRule;
} {
  const insertText = item.insertText || item.label;

  if (containsSnippetPlaceholder(insertText)) {
    return {
      insertText,
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    };
  }

  if (!isCallableCompletionKind(monaco, kind)) {
    const textCallableName = phpCallableCompletionName(item.label) ??
      phpCallableCompletionName(insertText);

    if (
      !textCallableName ||
      !completionItemValuesLookLikeSignature(item, insertText, textCallableName)
    ) {
      return { insertText };
    }

    const parameterState = lspCompletionParameterState(item, textCallableName);
    const hasParameters = parameterState !== "none";

    return {
      command: hasParameters
        ? {
            id: "editor.action.triggerParameterHints",
            title: "Trigger parameter hints",
          }
        : undefined,
      insertText: hasParameters
        ? `${textCallableName}($0)`
        : `${textCallableName}()$0`,
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    };
  }

  const name =
    phpCallableCompletionName(item.label) ?? phpCallableCompletionName(insertText);

  if (!name) {
    return { insertText };
  }

  const parameterState = lspCompletionParameterState(item, name);
  const hasParameters = parameterState !== "none";

  return {
    command: hasParameters
      ? {
          id: "editor.action.triggerParameterHints",
          title: "Trigger parameter hints",
        }
      : undefined,
    insertText: hasParameters ? `${name}($0)` : `${name}()$0`,
    insertTextRules:
      monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  };
}

function containsSnippetPlaceholder(insertText: string): boolean {
  return /\$(?:\d+|\{)/.test(insertText);
}

function completionItemValuesLookLikeSignature(
  item: {
    detail?: string | null;
    documentation?: unknown;
    insertText?: string | null;
    label: Monaco.languages.CompletionItem["label"] | string;
  },
  insertText: string | null | undefined,
  name: string,
): boolean {
  const documentation =
    typeof item.documentation === "string" ? item.documentation : null;

  return [
    completionItemLabelText(item.label),
    item.insertText,
    insertText,
    item.detail,
    documentation,
  ]
    .filter((candidate): candidate is string => typeof candidate === "string")
    .some((candidate) => completionLabelLooksLikeSignature(candidate, name));
}

function isCallableCompletionKind(
  monaco: MonacoApi,
  kind: Monaco.languages.CompletionItemKind,
): boolean {
  return (
    kind === monaco.languages.CompletionItemKind.Method ||
    kind === monaco.languages.CompletionItemKind.Function
  );
}

function phpCallableCompletionName(value: string): string | null {
  return /^[A-Za-z_][A-Za-z0-9_]*/.exec(value.trim())?.[0] ?? null;
}

function lspCompletionParameterState(
  item: {
    detail: string | null;
    documentation: string | null;
    insertText: string | null;
    label: string;
  },
  name: string,
): "hasParameters" | "none" | "unknown" {
  const candidates = [
    item.label,
    item.insertText ?? "",
    item.detail ?? "",
    item.documentation ?? "",
  ];

  for (const candidate of candidates) {
    const state = callableParameterState(candidate, name);

    if (state !== "unknown") {
      return state;
    }
  }

  return "unknown";
}

function callableParameterState(
  value: string,
  name: string,
): "hasParameters" | "none" | "unknown" {
  const match = new RegExp(`${escapeRegExp(name)}\\s*\\(([^)]*)\\)`).exec(value);

  if (!match) {
    return "unknown";
  }

  return match[1].trim() ? "hasParameters" : "none";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function activePhpDocumentContext(
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
) {
  const activeDocument = context.getActiveDocument();
  const rootPath = context.getWorkspaceRoot?.() ?? null;

  if (!activeDocument || !rootPath) {
    return null;
  }

  if (activeDocument.language !== "php") {
    return null;
  }

  const path = modelPath(model);

  if (path !== activeDocument.path) {
    return null;
  }

  return {
    activeDocument,
    path,
    rootPath,
    sessionId: runningRuntimeSessionIdForRoot(context, rootPath),
  };
}

function modelSource(model: MonacoModel, fallbackSource: string): string {
  try {
    return model.getValue();
  } catch {
    return fallbackSource;
  }
}

function completionRange(
  model: MonacoModel,
  position: MonacoPosition,
  word: { endColumn: number; startColumn: number },
) {
  const line = model.getLineContent?.(position.lineNumber) ?? "";
  const characterBeforeWord = line[word.startColumn - 2] || "";
  const startColumn =
    characterBeforeWord === "$"
      ? Math.max(1, word.startColumn - 1)
      : word.startColumn;

  return {
    endColumn: word.endColumn,
    endLineNumber: position.lineNumber,
    startColumn,
    startLineNumber: position.lineNumber,
  };
}

function dedupeCompletionItems(
  monaco: MonacoApi,
  items: Monaco.languages.CompletionItem[],
): Monaco.languages.CompletionItem[] {
  const seen = new Set<string>();
  const unique: Monaco.languages.CompletionItem[] = [];

  for (const item of items) {
    const key = completionItemDedupeKey(monaco, item);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(item);
  }

  return unique;
}

function completionItemDedupeKey(
  monaco: MonacoApi,
  item: Monaco.languages.CompletionItem,
): string {
  const callableName = completionItemCallableDedupeName(monaco, item);

  if (callableName) {
    return `callable:${callableName.toLowerCase()}`;
  }

  const label = completionItemLabelText(item.label);

  if (
    item.kind === monaco.languages.CompletionItemKind.Property ||
    item.kind === monaco.languages.CompletionItemKind.Field
  ) {
    return `property:${label.toLowerCase()}`;
  }

  return `${item.kind}:${label.toLowerCase()}`;
}

function completionItemCallableDedupeName(
  monaco: MonacoApi,
  item: Monaco.languages.CompletionItem,
): string | null {
  const label = completionItemLabelText(item.label);
  const callableName = phpCallableCompletionName(label);

  if (!callableName) {
    return null;
  }

  if (isCallableCompletionKind(monaco, item.kind)) {
    return callableName;
  }

  if (completionItemValuesLookLikeSignature(item, item.insertText, callableName)) {
    return callableName;
  }

  if (
    typeof item.label !== "string" &&
    item.label.detail &&
    completionLabelLooksLikeSignature(
      `${item.label.label}${item.label.detail}`,
      callableName,
    )
  ) {
    return callableName;
  }

  return null;
}

function completionLabelLooksLikeSignature(value: string, name: string): boolean {
  return new RegExp(`(?:^|::|\\b)${escapeRegExp(name)}\\s*\\(`).test(value);
}

function completionItemLabelText(
  label: Monaco.languages.CompletionItem["label"],
): string {
  return typeof label === "string" ? label : label.label;
}

function monacoCompletionKindFromLspKind(
  monaco: MonacoApi,
  kind: number | null,
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
    case 10:
      return monaco.languages.CompletionItemKind.Property;
    case 21:
      return monaco.languages.CompletionItemKind.Constant;
    default:
      return monaco.languages.CompletionItemKind.Text;
  }
}

function featureRequestContext(
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  feature:
    | "completion"
    | "declaration"
    | "hover"
    | "prepareRename"
    | "references"
    | "rename"
    | "typeDefinition",
) {
  const request = featureDocumentRequestContext(context, model, feature);

  if (!request) {
    return null;
  }

  return {
    ...request,
    position: toLanguageServerTextDocumentPosition(request.path, position),
  };
}

function featureDocumentRequestContext(
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  feature:
    | "codeAction"
    | "completion"
    | "declaration"
    | "hover"
    | "prepareRename"
    | "references"
    | "rename"
    | "selectionRange"
    | "typeDefinition",
) {
  const activeDocument = context.getActiveDocument();
  const rootPath = context.getWorkspaceRoot?.() ?? null;

  if (!activeDocument || !rootPath) {
    return null;
  }

  if (!isLanguageServerDocument(activeDocument)) {
    return null;
  }

  const path = modelPath(model);

  if (!path || path !== activeDocument.path) {
    return null;
  }

  const status = runningRuntimeStatusForRoot(context, rootPath);

  if (!status || !canUseLanguageServerFeature(status.capabilities, feature)) {
    return null;
  }

  return { path, rootPath, sessionId: status.sessionId };
}

async function flushPendingDocumentChangeForActiveRequest(
  context: LanguageServerMonacoProviderContext,
  request: { path: string; rootPath: string; sessionId: number },
): Promise<boolean> {
  await context.flushPendingDocumentChange(request.path);

  return isFeatureRequestActive(context, request);
}

function runningRuntimeSessionIdForRoot(
  context: LanguageServerMonacoProviderContext,
  rootPath: string,
): number | null {
  return runningRuntimeStatusForRoot(context, rootPath)?.sessionId ?? null;
}

function runningRuntimeStatusForRoot(
  context: LanguageServerMonacoProviderContext,
  rootPath: string,
): Extract<LanguageServerRuntimeStatus, { kind: "running" }> | null {
  const status = context.getRuntimeStatus();

  if (
    status?.kind === "running" &&
    Boolean(status.rootPath) &&
    workspaceRootKeysEqual(status.rootPath, rootPath)
  ) {
    return status;
  }

  return null;
}

function isFeatureRequestActive(
  context: LanguageServerMonacoProviderContext,
  request: { rootPath: string; sessionId: number },
): boolean {
  return isStoredLanguageServerPayloadActive(
    context,
    request.rootPath,
    request.sessionId,
  );
}

function isPhpDocumentContextActive(
  context: LanguageServerMonacoProviderContext,
  request: { rootPath: string; sessionId: number | null },
): boolean {
  return request.sessionId == null
    ? isStoredWorkspaceRootActive(context, request.rootPath)
    : isStoredLanguageServerPayloadActive(
        context,
        request.rootPath,
        request.sessionId,
      );
}

function isStoredLanguageServerPayloadActive(
  context: LanguageServerMonacoProviderContext,
  rootPath: string,
  sessionId: number,
): boolean {
  if (!isStoredWorkspaceRootActive(context, rootPath)) {
    return false;
  }

  return runningRuntimeSessionIdForRoot(context, rootPath) === sessionId;
}

function reportErrorForActiveRequest(
  context: LanguageServerMonacoProviderContext,
  request: { rootPath: string; sessionId: number },
  error: unknown,
): void {
  if (!isFeatureRequestActive(context, request)) {
    return;
  }

  context.reportError(error);
}

function reportErrorForActiveWorkspaceEditEvent(
  context: LanguageServerMonacoProviderContext,
  event: LanguageServerWorkspaceEditEvent,
  error: unknown,
): void {
  if (!isWorkspaceEditEventActive(context, event)) {
    return;
  }

  context.reportError(error);
}

function isStoredWorkspaceRootActive(
  context: LanguageServerMonacoProviderContext,
  rootPath: string,
): boolean {
  const activeRootPath = context.getWorkspaceRoot?.() ?? null;

  return Boolean(activeRootPath && workspaceRootKeysEqual(activeRootPath, rootPath));
}

function isWorkspaceEditEventActive(
  context: LanguageServerMonacoProviderContext,
  event: LanguageServerWorkspaceEditEvent,
): boolean {
  const workspaceRoot = context.getWorkspaceRoot?.() ?? null;

  if (!workspaceRoot) {
    return false;
  }

  if (!event.rootPath || !workspaceRootKeysEqual(event.rootPath, workspaceRoot)) {
    return false;
  }

  return runningRuntimeSessionIdForRoot(context, event.rootPath) === event.sessionId;
}

function isPathInWorkspaceRoot(rootPath: string, path: string): boolean {
  const normalizedRootPath = normalizedWorkspacePath(rootPath);
  const normalizedPath = normalizedWorkspacePath(path);

  return (
    normalizedPath === normalizedRootPath ||
    normalizedPath.startsWith(`${normalizedRootPath}/`)
  );
}

function normalizedWorkspacePath(path: string): string {
  return path.trim().split("\\").join("/").replace(/\/+$/, "");
}

function modelPath(model: MonacoModel): string | null {
  const uri = model.uri;

  if (uri.fsPath) {
    return uri.fsPath;
  }

  if (uri.path) {
    return decodeURIComponent(uri.path);
  }

  return null;
}
