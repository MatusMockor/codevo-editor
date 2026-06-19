import type * as Monaco from "monaco-editor";
import {
  canUseLanguageServerFeature,
  toLanguageServerTextDocumentPosition,
  type LanguageServerFeaturesGateway,
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

type MonacoApi = typeof Monaco;
type MonacoModel = Monaco.editor.ITextModel;
type MonacoPosition = Monaco.Position;
type Disposable = Monaco.IDisposable;

export interface LanguageServerMonacoProviderContext {
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
}

export function registerLanguageServerMonacoProviders(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
): Disposable {
  const hover = monaco.languages.registerHoverProvider("php", {
    provideHover: (model, position) => provideHover(monaco, context, model, position),
  });
  const completion = monaco.languages.registerCompletionItemProvider("php", {
    triggerCharacters: ["$", ">", "'", "\""],
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
        provideCodeActions(monaco, model, range, actionContext),
    },
    {
      providedCodeActionKinds: ["quickfix"],
    },
  );

  return {
    dispose: () => {
      hover.dispose();
      completion.dispose();
      signature.dispose();
      codeActions.dispose();
    },
  };
}

function provideCodeActions(
  monaco: MonacoApi,
  model: MonacoModel,
  range: Monaco.Range,
  context: Monaco.languages.CodeActionContext,
): Monaco.languages.CodeActionList {
  if (context.only && !context.only.startsWith("quickfix")) {
    return emptyCodeActionList();
  }

  const actions = context.markers
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

  return {
    actions,
    dispose: () => undefined,
  };
}

function emptyCodeActionList(): Monaco.languages.CodeActionList {
  return {
    actions: [],
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
    await context.flushPendingDocumentChange(request.path);
    const hover = await context.featuresGateway.hover(
      request.rootPath,
      request.position,
    );

    if (!hover) {
      return null;
    }

    return {
      contents: [{ value: hover.contents }],
    };
  } catch (error) {
    context.reportError(error);
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
  const methodSuggestions = await phpMethodSuggestions(
    monaco,
    context,
    documentContext.activeDocument.content,
    position,
    range,
  );
  const isMemberOrStaticCompletion = Boolean(
    phpMemberAccessCompletionContextAt(
      documentContext.activeDocument.content,
      position,
    ) ||
      phpStaticAccessCompletionContextAt(
        documentContext.activeDocument.content,
        position,
      ) ||
      phpLaravelRelationStringCompletionContextAt(
        documentContext.activeDocument.content,
        position,
      ),
  );
  const variableSuggestions: Monaco.languages.CompletionItem[] =
    methodSuggestions.length > 0 || isMemberOrStaticCompletion
      ? []
      : phpVariableCompletionsAt(
          documentContext.activeDocument.content,
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
    await context.flushPendingDocumentChange(request.path);
    const completion = await context.featuresGateway.completion(
      request.rootPath,
      request.position,
    );
    const lspSuggestions = completion.items.map((item, index) => {
      const kind = monacoCompletionKindFromLspKind(monaco, item.kind);
      const insert = lspCompletionInsert(monaco, item, kind);

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
        sortText: `1_${String(index).padStart(4, "0")}`,
      };
    });

    return {
      suggestions: dedupeCompletionItems(monaco, [
        ...suggestions,
        ...lspSuggestions,
      ]),
    };
  } catch (error) {
    context.reportError(error);
    return { suggestions };
  }
}

async function phpMethodSuggestions(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  source: string,
  position: MonacoPosition,
  range: ReturnType<typeof completionRange>,
): Promise<Monaco.languages.CompletionItem[]> {
  if (!context.providePhpMethodCompletions) {
    return [];
  }

  try {
    const methods = await context.providePhpMethodCompletions(source, position);

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
      kind:
        item.kind === "relation"
          ? monaco.languages.CompletionItemKind.Reference
          : item.kind === "route"
          ? monaco.languages.CompletionItemKind.Value
          : item.kind === "property"
          ? monaco.languages.CompletionItemKind.Property
          : monaco.languages.CompletionItemKind.Method,
      label: phpMethodCompletionLabel(item),
      range,
      sortText: `0_${String(index).padStart(4, "0")}`,
    }));
  } catch (error) {
    context.reportError(error);
    return [];
  }
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
      documentContext.activeDocument.content,
      position,
    );

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
    context.reportError(error);
    return null;
  }
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

  return `${item.name}($0)`;
}

function phpParameterLabel(parameter: PhpMethodParameter): string {
  const type = parameter.type ? `${parameter.type} ` : "";
  const defaultValue =
    parameter.defaultValue !== null ? ` = ${parameter.defaultValue}` : "";

  return `${type}${parameter.name}${defaultValue}`;
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
  };
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
  feature: "completion" | "hover",
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

  if (path !== activeDocument.path) {
    return null;
  }

  const status = context.getRuntimeStatus();

  if (status?.kind !== "running") {
    return null;
  }

  if (!canUseLanguageServerFeature(status.capabilities, feature)) {
    return null;
  }

  return {
    path,
    position: toLanguageServerTextDocumentPosition(path, position),
    rootPath,
  };
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
